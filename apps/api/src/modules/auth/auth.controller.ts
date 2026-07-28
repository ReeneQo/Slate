import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Authorization } from '../../shared/decorators/authorization.decorator';
import { Authorized } from '../../shared/decorators/authorized.decorator';
import type { UserResponseDto } from '../user/dto/user-response.dto';
import { AuthService } from './auth.service';
import type { AuthUserDto } from './dto/auth-user.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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
 * Транспортный слой: принять, отдать, назначить статус. Ни одного правила — все решения
 * принимает AuthService.
 *
 * `@UseGuards(ThrottlerGuard)` висит на контроллере, а не регистрируется глобально через
 * APP_GUARD: сейчас лимиты нужны ровно этим роутам, а глобальный guard молча накрыл бы и
 * `/health`, который оркестратор дёргает пробами каждые несколько секунд. Когда появятся
 * board-роуты (SLT-17), throttling логично поднять до глобального — но вместе с осознанным
 * `@SkipThrottle()` на health, а не задним числом, разбираясь, почему мигает readiness.
 *
 * `req`/`res` прокидываются в сервис, потому что сессия физически живёт на них
 * (express-session вешает `req.session`, кука снимается через `res.clearCookie`).
 * Это единственное место, где auth знает про Express.
 */
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  getMe(@Authorized('id') userId: string): Promise<UserResponseDto> {
    return this.authService.getMe(userId);
  }
}
