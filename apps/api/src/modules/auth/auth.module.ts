import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { RedisService } from '../../infrastructure/redis/redis.service';
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
 * ThrottlerModule стоит ЗДЕСЬ, а не в AppModule, по устройству самого пакета:
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
 * Storage — Redis, а не встроенный in-memory. Целевая топология — несколько инстансов за
 * балансировщиком; при памяти процесса каждый под считал бы лимит у себя, и фактический
 * потолок умножился бы на их число (плюс сброс счётчиков на рестарте). Общий счётчик в
 * Redis делает лимит единым на весь кластер.
 *
 * forRootAsync + инъекция RedisService: переиспользуем ЕДИНЫЙ command-клиент из
 * infrastructure/redis, а не заводим второй коннект. Троттлер шлёт обычные атомарные
 * команды (Lua-скрипт inc+expire), не pub/sub — делить основной клиент безопасно, это
 * ровно тот кейс, под который «один клиент» и задуман. Адаптеру передаётся уже готовый
 * ioredis-инстанс: в этой ветке конструктора он НЕ ставит disconnectRequired, поэтому его
 * onModuleDestroy не рвёт наш общий коннект — владелец жизненного цикла остаётся один
 * (RedisService).
 */
@Module({
  imports: [
    UserModule,
    SessionsModule,
    CryptoModule,
    ThrottlerModule.forRootAsync({
      // RedisModule помечен @Global — RedisService доступен для инъекции без imports.
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [DEFAULT_THROTTLE],
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
