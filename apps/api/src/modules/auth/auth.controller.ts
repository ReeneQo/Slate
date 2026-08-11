import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Authorization } from '../../shared/decorators/authorization.decorator';
import { Authorized } from '../../shared/decorators/authorized.decorator';
import type { UserResponseDto } from '../user/dto/user-response.dto';
import { AuthService } from './auth.service';
import type { AuthUserDto } from './dto/auth-user.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { OAuthService } from './oauth.service';

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
}
