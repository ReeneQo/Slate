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
import {
  AccountNotLinkedError,
  EmailConflictError,
  LastAuthMethodError,
  OAuthEmailNotVerifiedError,
  OAuthNoEmailError,
  ProviderAlreadyLinkedError,
} from './oauth.errors';
import type { OAuthProvider } from './providers/oauth-provider';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';
import { OAuthStateService } from './providers/oauth-state.service';
import type { NormalizedProfile, OAuthMode } from './providers/types';

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
   * Выдаёт authorize-URL. `mode` по умолчанию `'login'` (вход в приложение) — единственный
   * вызывающий до SLT-56 (`AuthController.connectOAuth`) явно его не передавал. `mode='link'`
   * (SLT-56, привязка провайдера к уже залогиненному пользователю) — свой, отдельный роут
   * `oauth/link/connect/:provider`, а не смена поведения этого.
   */
  async getConnectUrl(providerName: string, mode: OAuthMode = 'login'): Promise<{ url: string }> {
    const provider = this.getProviderOrThrow(providerName);
    const state = await this.state.create(providerName, mode);

    return { url: provider.getAuthUrl(state, mode) };
  }

  /**
   * Сверяет state, обменивает code на токен и возвращает нормализованный профиль.
   *
   * `stored.provider !== provider` ловит подмену: state, выпущенный для одного провайдера,
   * предъявлен на callback другого. Ответ на оба случая — один и тот же 401 без деталей,
   * иначе различие в сообщении само стало бы утечкой (подтверждало бы существование
   * настоящего state под другим провайдером).
   *
   * `expectedMode` (SLT-56) — та же логика для режима: login-callback обязан принимать ТОЛЬКО
   * state, выпущенный под `'login'`, link-callback — только под `'link'`. Без этой сверки
   * login-state, украденный/подсунутый в link-callback, привязал бы GitHub-аккаунт злоумышленника
   * к сессии жертвы (и наоборот — link-state в login-callback обошёл бы саму идею линковки).
   * Единый 401 без уточнения причины — по той же причине, что и провал сверки provider выше.
   */
  async resolveProfile(
    providerName: string,
    code: string,
    state: string,
    expectedMode: OAuthMode,
  ): Promise<NormalizedProfile> {
    const provider = this.getProviderOrThrow(providerName);
    const stored = await this.state.consume(state);

    if (stored === null || stored.provider !== providerName || stored.mode !== expectedMode) {
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

  /**
   * Привязка провайдера к УЖЕ залогиненному пользователю (SLT-56) — принципиально ОТДЕЛЬНАЯ
   * логика от `loginOAuth`. Игнорирует `profile.email` целиком: не ищет и не создаёт User, не
   * гейтит на `emailVerified` — тот email принадлежит провайдер-аккаунту, а не решению
   * «к какому Slate-пользователю привязать» (это уже решено — им является `userId` из сессии).
   * Работает ТОЛЬКО с парой (provider, providerAccountId) + переданным userId.
   *
   * Идемпотентна: повторная привязка уже привязанного (к ТОМУ ЖЕ userId) провайдера —
   * успешный no-op, а не ошибка (повторный клик на «Привязать GitHub» не должен падать).
   * К ДРУГОМУ userId — конфликт.
   *
   * Гонка (два параллельных link-callback на один providerAccountId) резолвится так же, как в
   * loginOAuth: `AccountRepository.createForUser` ловит P2002 и перечитывает запись
   * (`already-linked`). Здесь эта ветка ветвится ещё раз по userId — от неё, а не от 500,
   * зависит финальный результат.
   */
  async linkProfile(userId: string, profile: NormalizedProfile): Promise<void> {
    const existing = await this.accountRepository.findByProviderAccount(
      profile.provider,
      profile.providerAccountId,
    );

    if (existing) {
      if (existing.userId === userId) {
        return;
      }

      throw new ProviderAlreadyLinkedError();
    }

    const outcome = await this.accountRepository.createForUser(
      userId,
      profile.provider,
      profile.providerAccountId,
    );

    if (outcome.status === 'already-linked' && outcome.account.userId !== userId) {
      throw new ProviderAlreadyLinkedError();
    }
  }

  /**
   * Отвязка провайдера от уже залогиненного пользователя (SLT-56).
   *
   * Порядок проверок важен: сначала убеждаемся, что вообще есть что отвязывать (иначе
   * `hasPassword`/`countByUser` считались бы напрасно), потом защита «последнего способа
   * входа» — БЕЗ пароля отвязать единственный Account нельзя, иначе пользователю нечем будет
   * войти. `accountsCount` считается ДО удаления и включает сам отвязываемый Account, поэтому
   * `<= 1` значит «это последний, и пароля тоже нет». Если пароль есть, отвязать можно всегда —
   * сам пароль остаётся способом входа.
   */
  async unlinkProfile(userId: string, provider: string): Promise<void> {
    const targetAccount = await this.accountRepository.findByUserAndProvider(userId, provider);

    if (targetAccount === null) {
      throw new AccountNotLinkedError();
    }

    const user = await this.userService.findByIdWithHash(userId);

    if (user === null) {
      throw new InternalServerErrorException('Сессия ссылается на несуществующего пользователя');
    }

    const hasPassword = this.userService.hasPassword(user);
    const accountsCount = await this.accountRepository.countByUser(userId);

    if (!hasPassword && accountsCount <= 1) {
      throw new LastAuthMethodError();
    }

    await this.accountRepository.deleteByUserAndProvider(userId, provider);
  }

  private getProviderOrThrow(providerName: string): OAuthProvider {
    const provider = this.registry.get(providerName);

    if (!provider) {
      throw new BadRequestException(`Неизвестный OAuth-провайдер: ${providerName}`);
    }

    return provider;
  }
}
