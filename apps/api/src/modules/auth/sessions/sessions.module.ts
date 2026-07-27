import { Module } from '@nestjs/common';

import { SessionsService } from './sessions.service';

/**
 * Сессии — часть домена auth, поэтому модуль живёт в `modules/auth/`, а не в `shared/`:
 * защита от session fixation и правило «в сессии только userId» — это правила входа,
 * а не универсальная утилита. AuthModule (SLT-16) появится рядом и заберёт этот сервис.
 *
 * RedisService здесь не импортируется: сервис работает с `req.session`, а сам Redis
 * подключён как store у middleware (session.factory, вызывается из main.ts).
 * ConfigService приходит из глобального ConfigModule.
 */
@Module({
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
