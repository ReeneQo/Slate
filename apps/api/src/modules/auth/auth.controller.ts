import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ConfigService } from '../../config/config.service';
import { Authorization } from '../../shared/decorators/authorization.decorator';
import { Authorized } from '../../shared/decorators/authorized.decorator';
import type { UserResponseDto } from '../user/dto/user-response.dto';
import { AuthService } from './auth.service';
import type { AuthUserDto } from './dto/auth-user.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  AccountNotLinkedError,
  EmailConflictError,
  LastAuthMethodError,
  OAuthEmailNotVerifiedError,
  OAuthNoEmailError,
  ProviderAlreadyLinkedError,
} from './oauth.errors';
import { OAuthService } from './oauth.service';
import { SessionsService } from './sessions/sessions.service';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Лимиты подобраны по цене ошибки для КАЖДОЙ стороны, а не «на глаз».
 *
 * login — 5 попыток / 15 минут. Живой человек, забывший пароль, укладывается в 5 попыток
 * почти всегда; для перебора же этот потолок означает ~480 попыток в сутки с адреса, что
 * делает словарную атаку бессмысленной, не мешая при этом обычному пользователю.
 *
 * register — 3 / час. Регистрация штука разовая, поэтому лимит агрессивнее: он режет
 * массовое создание мусорных аккаунтов, а заодно перебор занятых email через 409-ответы.
 */
const LOGIN_THROTTLE = { limit: 5, ttl: 15 * MINUTE_MS };
const REGISTER_THROTTLE = { limit: 3, ttl: HOUR_MS };

/**
 * connect — 10 / минуту. Роут ничего не проверяет и не создаёт (только генерирует state и
 * отдаёт URL), поэтому лимит не про подбор, а про то, чтобы не давать штамповать
 * одноразовые state-записи в Redis бесконечным потоком запросов.
 */
const OAUTH_CONNECT_THROTTLE = { limit: 10, ttl: MINUTE_MS };

/**
 * callback — 10 / минуту, тот же ориентир, что и у connect: сюда тоже нельзя прийти без
 * валидного одноразового state (он потребляется `resolveProfile` и не подбирается), поэтому
 * лимит не про перебор, а про то, чтобы не дать превратить роут в источник нагрузки на GitHub
 * и БД повторными запросами.
 */
const OAUTH_CALLBACK_THROTTLE = { limit: 10, ttl: MINUTE_MS };

/**
 * Транспортный слой: принять, отдать, назначить статус. Ни одного правила — все решения
 * принимает AuthService.
 *
 * ThrottlerGuard тут БОЛЬШЕ НЕ висит через `@UseGuards`: в SLT-30 он стал глобальным
 * (APP_GUARD, infrastructure/throttler) и накрывает все роуты. Держать его ещё и здесь
 * значило бы прогнать guard на запрос дважды и удвоить инкремент счётчика, вдвое занизив
 * лимит. Остались только `@Throttle` на login/register — они переопределяют глобальный
 * `default` до боевых значений; глобальный guard читает их рефлексией.
 *
 * `req`/`res` прокидываются в сервис, потому что сессия физически живёт на них
 * (express-session вешает `req.session`, кука снимается через `res.clearCookie`).
 * Это единственное место, где auth знает про Express.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oauthService: OAuthService,
    private readonly sessionsService: SessionsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 201 — статус Nest по умолчанию для POST, и здесь он корректен: ресурс (пользователь)
   * действительно создан. Поэтому @HttpCode не нужен.
   */
  @Post('register')
  @Throttle({ default: REGISTER_THROTTLE })
  register(@Req() request: Request, @Body() dto: RegisterDto): Promise<AuthUserDto> {
    return this.authService.register(request, dto);
  }

  /**
   * @HttpCode(200) обязателен: Nest по умолчанию отвечает на POST 201 Created, а логин
   * ничего не создаёт — он проверяет учётные данные и возвращает существующего
   * пользователя. 201 дезинформировал бы и клиента, и любого, кто читает логи.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LOGIN_THROTTLE })
  login(@Req() request: Request, @Body() dto: LoginDto): Promise<AuthUserDto> {
    return this.authService.login(request, dto);
  }

  /**
   * 204 No Content: отдавать нечего, а `{ success: true }` — это поле, которое фронт обязан
   * проверять, чтобы узнать то же самое, что уже сказал статус.
   *
   * `@Res({ passthrough: true })` — не косметика: без `passthrough` Nest отдаёт управление
   * ответом целиком нам, и возвращённое из метода значение вместе с @HttpCode просто
   * игнорируется, а запрос висит до таймаута. С флагом res доступен для clearCookie,
   * но отвечает по-прежнему Nest.
   *
   * Guard намеренно НЕ вешаем: выход обязан работать и по протухшей сессии. Иначе
   * пользователь с невалидной кукой получает 401 на logout и остаётся с этой кукой —
   * ровно в том состоянии, из которого хотел выйти.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    return this.authService.logout(request, response);
  }

  /**
   * «Выйти на всех устройствах» (SLT-31).
   *
   * Под `@Authorization()`: отозвать сессии может только сам вошедший пользователь, и userId
   * берётся из его сессии, а не из тела — иначе это была бы кнопка «разлогинить кого угодно».
   * Пароль повторно не спрашиваем (отложено в SLT-22).
   *
   * 204 No Content по тем же причинам, что и обычный logout: отдавать нечего. Тонкость —
   * инициатор НЕ выходит немедленно: его кука ещё валидна на вид, но несёт устаревшее
   * поколение, поэтому вылетит с 401 на следующем же защищённом запросе (см. logoutAll).
   * Guard здесь НУЖЕН (в отличие от logout): чтобы знать, чьё поколение двигать, требуется
   * живая сессия.
   */
  @Post('logout-all')
  @Authorization()
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(@Authorized('id') userId: string): Promise<void> {
    return this.authService.logoutAll(userId);
  }

  /**
   * Путь именно `/auth/me`, а не корневой `/me`.
   *
   * Это вопрос о СЕССИИ («кто я по этой куке»), и фронт задаёт его при старте приложения,
   * чтобы восстановить вход, — то есть он про аутентификацию, а не про профиль. Корневой
   * `/me` потребовал бы второго контроллера ради одного роута и размыл бы границу: когда
   * в блоке 4 появится редактирование профиля, оно ляжет в `/users/me` у user-модуля, и
   * два «me» на разных префиксах будут честно означать две разные вещи.
   *
   * Throttle тут не нужен: роут под guard'ом, дёргается один раз на загрузку страницы и
   * ничего не перебирает.
   */
  @Get('me')
  @Authorization()
  getMe(
    @Authorized('id') userId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    return this.authService.getMe(userId, request, response);
  }

  /**
   * Выдаёт authorize-URL GitHub для входа. Редирект инициирует ФРОНТ (`window.location =
   * url`), не бэк — здесь только генерация одноразового state и сборка URL.
   *
   * Граница SLT-52: сам callback (`/oauth/callback/:provider`) с резолвом входа и редиректом
   * на фронт — SLT-54, его в этом контроллере ещё нет.
   */
  @Get('oauth/connect/:provider')
  @Throttle({ default: OAUTH_CONNECT_THROTTLE })
  connectOAuth(@Param('provider') provider: string): Promise<{ url: string }> {
    return this.oauthService.getConnectUrl(provider);
  }

  /**
   * Callback GitHub OAuth (SLT-54) — ТОЛЬКО login-путь (`/oauth/callback/:provider`), не
   * `/oauth/link/callback` (линковка — SLT-56, отдельный роут). Здесь единственное место во
   * всём auth, где транспорт (redirect на фронт) неотделим от оркестрации нескольких сервисов
   * за один запрос: state/code нужно свести с профилем, профиль — с решением о входе, вход —
   * с сессией, и на любом отказе увести пользователя обратно на `/login` с читаемой причиной,
   * а не бросить голый 401/502/500 в адресную строку браузера. Сама бизнес-логика (три ветки
   * резолва) при этом НЕ здесь — она в `OAuthService.loginOAuth`; контроллер её не повторяет,
   * только переводит результат/ошибку в HTTP-редирект.
   *
   * `@Res()` БЕЗ `passthrough`: ответ — это редирект, а не JSON, поэтому Nest не должен
   * пытаться сериализовать возвращаемое значение (см. докстринг logout — там `passthrough`
   * оставляет ответ Nest'у; здесь наоборот, отвечаем сами).
   *
   * Отсутствие `code`/`state` — это не наша 500 (см. точки сверки SLT-54): чаще всего
   * пользователь отменил авторизацию на стороне GitHub, тот в этом случае бьёт на callback без
   * `code`. Ветка проверяется ДО обращения к `oauthService`, чтобы не звать `resolveProfile`
   * заведомо без параметров, которые ему нужны.
   */
  @Get('oauth/callback/:provider')
  @Throttle({ default: OAUTH_CALLBACK_THROTTLE })
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const origin = this.config.app.allowedOrigin;

    if (!code || !state) {
      response.redirect(`${origin}/login?error=oauthFailed`);
      return;
    }

    try {
      const profile = await this.oauthService.resolveProfile(provider, code, state, 'login');
      const user = await this.oauthService.loginOAuth(profile);

      await this.sessionsService.saveSession(request, user);

      response.redirect(`${origin}/`);
    } catch (error) {
      response.redirect(`${origin}/login?error=${mapOAuthErrorToCode(error)}`);
    }
  }

  /**
   * Выдаёт authorize-URL GitHub для ПРИВЯЗКИ провайдера к уже залогиненному пользователю
   * (SLT-56) — отдельный роут от `oauth/connect/:provider` (тот всегда `mode='login'`, SLT-52).
   * `@Authorization()`: линковка без сессии не имеет смысла — привязывать провайдера НЕКУДА.
   */
  @Get('oauth/link/connect/:provider')
  @Authorization()
  @Throttle({ default: OAUTH_CONNECT_THROTTLE })
  connectOAuthLink(@Param('provider') provider: string): Promise<{ url: string }> {
    return this.oauthService.getConnectUrl(provider, 'link');
  }

  /**
   * Callback линковки (SLT-56) — ОТДЕЛЬНЫЙ роут от `oauth/callback/:provider` (тот login,
   * SLT-54, его не трогаем). Та же форма ответа (redirect, `@Res()` без `passthrough` — см.
   * докстринг `oauthCallback`), но своя логика резолва: `resolveProfile(..., 'link')` (сверка
   * mode отклонит login-state) и `linkProfile`, а не `loginOAuth` — сессию линковка не трогает,
   * пользователь уже вошёл.
   *
   * `@Authorization()` обязателен: `userId` для `linkProfile` берётся из СЕССИИ (см.
   * `Authorized`-декоратор), а не из state/профиля — иначе привязка происходила бы «от имени
   * гостя», для кого угодно.
   *
   * Целевая страница после успеха — временный дашборд (`/?linked=github`): куда именно вести
   * пользователя (страница профиля) уточнит SLT-58, здесь такой страницы ещё нет.
   */
  @Get('oauth/link/callback/:provider')
  @Authorization()
  @Throttle({ default: OAUTH_CALLBACK_THROTTLE })
  async oauthLinkCallback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Authorized('id') userId: string,
    @Res() response: Response,
  ): Promise<void> {
    const origin = this.config.app.allowedOrigin;

    if (!code || !state) {
      response.redirect(`${origin}/?error=oauthFailed`);
      return;
    }

    try {
      const profile = await this.oauthService.resolveProfile(provider, code, state, 'link');

      await this.oauthService.linkProfile(userId, profile);

      response.redirect(`${origin}/?linked=github`);
    } catch (error) {
      response.redirect(`${origin}/?error=${mapOAuthLinkErrorToCode(error)}`);
    }
  }

  /**
   * Отвязка провайдера (SLT-56). JSON-ответ, НЕ redirect: вызывается обычным XHR с фронта
   * (кнопка «Отвязать» в профиле, SLT-58), а не браузерной навигацией — в отличие от
   * link/callback, сюда не приходят через `window.location`.
   *
   * 204 No Content — тот же стиль, что и у `BoardController.remove`/`ElementController` DELETE:
   * отдавать нечего, а `{ success: true }` было бы полем, дублирующим то, что уже сказал статус.
   *
   * Доменные ошибки (`AccountNotLinkedError`/`LastAuthMethodError`) переводятся в HTTP здесь же,
   * а не проброшены как есть — тот же приём, что `AuthService.createUser` для
   * `EmailAlreadyTakenError`: перевод живёт рядом с местом, где ошибка возникает по сценарию,
   * а не размазан по сервису, который её бросает.
   */
  @Delete('oauth/link/unlink/:provider')
  @Authorization()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: OAUTH_CALLBACK_THROTTLE })
  async unlinkOAuth(
    @Param('provider') provider: string,
    @Authorized('id') userId: string,
  ): Promise<void> {
    try {
      await this.oauthService.unlinkProfile(userId, provider);
    } catch (error) {
      if (error instanceof AccountNotLinkedError) {
        throw new NotFoundException(error.message);
      }

      if (error instanceof LastAuthMethodError) {
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }
}

/**
 * Перевод доменной/HTTP-ошибки резолва входа в код для `?error=` на фронте (SLT-58 его
 * отрисует). Живёт здесь, а не в сервисе: это чисто транспортное решение — «каким query-
 * параметром рассказать фронту, что пошло не так», сервис про query-параметры знать не должен.
 *
 * Порядок веток значения не имеет (типы не пересекаются), но `instanceof` — не `error.name`:
 * так же, как EmailAlreadyTakenError, доменные ошибки различаются по классу, а не по строке.
 */
function mapOAuthErrorToCode(error: unknown): string {
  if (error instanceof OAuthNoEmailError) {
    return 'noEmail';
  }

  if (error instanceof OAuthEmailNotVerifiedError) {
    return 'emailNotVerified';
  }

  // Гонка ветки 3 (Р4): email был свободен на проверке, занят на вставке — конкурентная
  // password-регистрация или параллельный OAuth-вход. Не `emailNotVerified`: тут как раз
  // verified, причина другая — аккаунт с этим email уже существует.
  if (error instanceof EmailConflictError) {
    return 'emailConflict';
  }

  // UnauthorizedException — недействительный/истёкший/подменённый state (SLT-52).
  // BadGatewayException — GitHub недоступен на обмене code→token или на fetchProfile.
  // Оба — сбой самого OAuth-хендшейка, не наша внутренняя ошибка, поэтому один код.
  if (error instanceof UnauthorizedException || error instanceof BadGatewayException) {
    return 'oauthFailed';
  }

  return 'serverError';
}

/**
 * Перевод ошибки резолва ЛИНКОВКИ (`oauthLinkCallback`) в код для `?error=`. Отдельная функция
 * от `mapOAuthErrorToCode`: наборы ошибок не пересекаются (`linkProfile` не бросает
 * `OAuthNoEmailError`/`OAuthEmailNotVerifiedError`/`EmailConflictError` — линковка не работает
 * с email, см. докстринг `OAuthService.linkProfile`), а `ProviderAlreadyLinkedError` для
 * login-резолва не существует вовсе.
 */
function mapOAuthLinkErrorToCode(error: unknown): string {
  if (error instanceof ProviderAlreadyLinkedError) {
    return 'alreadyLinked';
  }

  // UnauthorizedException — недействительный/истёкший state ИЛИ провал mode-сверки (login-state
  // подсунут в link-callback). BadGatewayException — GitHub недоступен на обмене/fetchProfile.
  if (error instanceof UnauthorizedException || error instanceof BadGatewayException) {
    return 'oauthFailed';
  }

  return 'serverError';
}
