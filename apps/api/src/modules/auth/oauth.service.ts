import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { SafeUser } from '../user/entities/user.entity';
import { EmailAlreadyTakenError } from '../user/user.errors';
import { UserService } from '../user/user.service';
import { AccountRepository } from './account.repository';
import { EmailConflictError, OAuthEmailNotVerifiedError, OAuthNoEmailError } from './oauth.errors';
import type { OAuthProvider } from './providers/oauth-provider';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';
import { OAuthStateService } from './providers/oauth-state.service';
import type { NormalizedProfile } from './providers/types';

/**
 * OAuth-хендшейк ДО резолва входа: выдача authorize-URL и обмен code→нормализованный
 * профиль. Отдельно от `AuthService` намеренно — тот отвечает за сценарии пароля
 * (register/login/logout) и не знает про провайдеров/state; здесь свой набор зависимостей
 * (реестр провайдеров, Redis-state), и смешивать их в одном сервисе означало бы раздувать
 * AuthService конструктором ради несвязанной ответственности.
 *
 * `resolveProfile` — граница SLT-52: возвращает профиль и НЕ создаёт User/Account, не
 * трогает Prisma, не вклеивает сессию. Резолв входа (существующий/новый/линковка) — `loginOAuth`
 * (SLT-54); сессию поверх её результата вклеивает уже callback-роут в AuthController, тем же
 * `SessionsService.saveSession`, что и password-логин.
 *
 * `PrismaService` инжектится СЮДА только ради `$transaction` — границы транзакции для ветки
 * «новый пользователь» (User+Account атомарно). Сервис не выполняет ни одного запроса к модели
 * напрямую (`prisma.user.*`/`prisma.account.*`): те идут исключительно через `UserService` и
 * `AccountRepository`, которым при необходимости передаётся клиент транзакции. Открыть
 * транзакцию — не то же самое, что сходить в БД мимо репозитория.
 */
@Injectable()
export class OAuthService {
  constructor(
    private readonly registry: OAuthProviderRegistry,
    private readonly state: OAuthStateService,
    private readonly userService: UserService,
    private readonly accountRepository: AccountRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Выдаёт authorize-URL для входа. Режим здесь всегда `'login'` — вход в приложение;
   * `mode='link'` (привязка провайдера к существующему аккаунту) появится в SLT-56 отдельным
   * эндпоинтом, не этим.
   */
  async getConnectUrl(providerName: string): Promise<{ url: string }> {
    const provider = this.getProviderOrThrow(providerName);
    const state = await this.state.create(providerName, 'login');

    return { url: provider.getAuthUrl(state, 'login') };
  }

  /**
   * Сверяет state, обменивает code на токен и возвращает нормализованный профиль.
   *
   * `stored.provider !== provider` ловит подмену: state, выпущенный для одного провайдера,
   * предъявлен на callback другого. Ответ на оба случая — один и тот же 401 без деталей,
   * иначе различие в сообщении само стало бы утечкой (подтверждало бы существование
   * настоящего state под другим провайдером).
   */
  async resolveProfile(
    providerName: string,
    code: string,
    state: string,
  ): Promise<NormalizedProfile> {
    const provider = this.getProviderOrThrow(providerName);
    const stored = await this.state.consume(state);

    if (stored === null || stored.provider !== providerName) {
      throw new UnauthorizedException('Недействительный или истёкший state');
    }

    const tokens = await provider.exchangeCode(code, stored.mode);

    return provider.fetchProfile(tokens.accessToken);
  }

  /**
   * Резолв входа по нормализованному профилю — три ветки, СТРОГО в этом порядке.
   *
   * Порядок неслучаен: ветка 1 (уже привязанный Account) обязана идти первой, иначе повторный
   * вход того же человека каждый раз заново искал бы его по email и рисковал бы упереться в
   * `emailVerified === false`, если он тем временем сменил primary-email на GitHub без
   * подтверждения, — реальный вход сломался бы там, где раньше работал.
   *
   * 1. Account уже привязан → тот же пользователь, что и раньше.
   * 2. Account нет, но есть User с тем же email → автолинковка, ЕСЛИ провайдер подтвердил
   *    владение email (`emailVerified === true`); иначе отказ — молча прицепить чужой GitHub
   *    к существующему Slate-аккаунту по непроверенному email нельзя.
   * 3. Ни того, ни другого → новый пользователь: User и Account создаются АТОМАРНО.
   */
  async loginOAuth(profile: NormalizedProfile): Promise<SafeUser> {
    const existingAccount = await this.accountRepository.findByProviderAccount(
      profile.provider,
      profile.providerAccountId,
    );

    if (existingAccount) {
      const user = await this.userService.findById(existingAccount.userId);

      if (user === null) {
        // Account ссылается на несуществующего User — нарушенная целостность (не должно
        // происходить при onDelete: Cascade на связи, см. schema.prisma), а не обычный отказ
        // входа. Молчать нельзя: дальше решать нечего, это баг данных, а не ветка сценария.
        throw new InternalServerErrorException('Account ссылается на несуществующего пользователя');
      }

      return user;
    }

    if (profile.email === null) {
      throw new OAuthNoEmailError();
    }

    // Вынесено в переменную, а не читается как `profile.email` дальше: TS сужает
    // `string | null` до `string` по проверке выше только для ЛОКАЛЬНОГО биндинга, а не для
    // повторного доступа к свойству объекта — а ниже `email` уходит в замыкание транзакции.
    const email = profile.email;

    const existingUser = await this.userService.findByEmail(email);

    if (existingUser) {
      if (!profile.emailVerified) {
        throw new OAuthEmailNotVerifiedError(email);
      }

      // Гонка (два параллельных callback на один providerAccountId) резолвится внутри
      // AccountRepository — оба исхода отдают Account, привязанный к existingUser, так что
      // здесь неважно, `created` это или `already-linked`.
      await this.accountRepository.createForUser(
        existingUser.id,
        profile.provider,
        profile.providerAccountId,
      );

      return existingUser;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await this.userService.createOAuthUser(
          { email, displayName: profile.displayName },
          tx,
        );

        await this.accountRepository.createForUser(
          user.id,
          profile.provider,
          profile.providerAccountId,
          tx,
        );

        return user;
      });
    } catch (error) {
      // Гонка с password-регистрацией (или параллельным OAuth-входом) на тот же email между
      // проверкой выше и вставкой: `$transaction` уже откатился штатно (Prisma откатывает
      // interactive-транзакцию сама, как только колбэк бросает) — ловим ошибку СНАРУЖИ, а не
      // внутри колбэка, чтобы не мешать этому откату, и только здесь решаем, во что она
      // превращается для вызывающего. Любая другая ошибка транзакции пробрасывается как есть.
      if (error instanceof EmailAlreadyTakenError) {
        throw new EmailConflictError(email);
      }

      throw error;
    }
  }

  private getProviderOrThrow(providerName: string): OAuthProvider {
    const provider = this.registry.get(providerName);

    if (!provider) {
      throw new BadRequestException(`Неизвестный OAuth-провайдер: ${providerName}`);
    }

    return provider;
  }
}
