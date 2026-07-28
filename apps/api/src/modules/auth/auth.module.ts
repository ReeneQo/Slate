import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { CryptoModule } from '../../shared/crypto/crypto.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsModule } from './sessions/sessions.module';

/** Потолок по умолчанию для роутов без явного @Throttle. */
const DEFAULT_THROTTLE = { name: 'default', limit: 30, ttl: 60_000 };

/**
 * Сборка блока 2: UserModule даёт доступ к данным (только через UserService — репозиторий
 * оттуда не экспортирован), SessionsModule — жизненный цикл сессии, CryptoModule — verify
 * пароля при логине.
 *
 * ThrottlerModule.forRoot стоит ЗДЕСЬ, а не в AppModule, по устройству самого пакета:
 * модуль не помечен @Global, он лишь экспортирует свои провайдеры. Значит регистрация в
 * корне не сделала бы их видимыми для AuthModule — Nest резолвит зависимости по графу
 * импортов, а не по принципу «где-то выше в дереве». Раз throttling нужен сейчас ровно
 * auth-роутам, его конфиг живёт рядом с ними. Когда лимиты понадобятся board-модулю
 * (SLT-17), это переезжает в общий @Global-модуль — иначе второй forRoot заведёт ВТОРОЕ
 * хранилище счётчиков, и лимиты станут независимыми в каждом модуле.
 *
 * Дефолт — подстраховка на случай нового роута, где @Throttle забыли: пусть у него будет
 * хоть какой-то потолок. Реальные лимиты login/register заданы на методах контроллера.
 *
 * Storage — встроенный, в памяти процесса. Для одного инстанса этого достаточно, но при
 * горизонтальном масштабировании счётчики окажутся у каждого пода свои, и фактический
 * лимит умножится на их число. Лечится Redis-хранилищем — Redis у нас уже поднят, но это
 * отдельная задача, а не побочный эффект этой.
 */
@Module({
  imports: [
    UserModule,
    SessionsModule,
    CryptoModule,
    ThrottlerModule.forRoot({ throttlers: [DEFAULT_THROTTLE] }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
