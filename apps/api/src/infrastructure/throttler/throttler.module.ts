import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { RedisService } from '../redis/redis.service';
import {
  AUTOSAVE_LIMIT,
  DEFAULT_LIMIT,
  THROTTLER_AUTOSAVE,
  THROTTLER_DEFAULT,
} from './throttle.limits';

/**
 * Глобальный троттлинг всего приложения. До этого модуля лимиты были точечными — жили в
 * AuthModule и висели `@UseGuards(ThrottlerGuard)` только на auth-контроллере. Остальное
 * (board/element CRUD, autosave-путь) не было защищено вовсе.
 *
 * ЧТО ЗДЕСЬ:
 *
 * 1. `APP_GUARD` → ThrottlerGuard. Регистрация guard'а как APP_GUARD делает его глобальным:
 *    Nest применяет его к КАЖДОМУ роуту, а не только к тем, где стоит `@UseGuards`. Именно
 *    поэтому `@UseGuards(ThrottlerGuard)` с auth-контроллера снят — иначе guard отработал бы
 *    дважды на один запрос и СЧЁТЧИК УВЕЛИЧИЛСЯ БЫ НА ДВА, вдвое занизив реальный лимит.
 *
 * 2. Два ИМЕНОВАННЫХ троттлера: `default` (baseline, 100/мин) и `autosave` (щедрый, 600/мин).
 *    В @nestjs/throttler каждый объявленный троттлер применяется ко всем роутам, а запрос
 *    блокируется, если превышен ЛЮБОЙ из них. Роут исключается из конкретного лимита
 *    `@SkipThrottle({ <name>: true })`, а число переопределяется `@Throttle({ <name>: {...} })`.
 *    Так auth-роуты сужают `default` до боевых login/register-лимитов, element-путь уходит
 *    из-под `default` в свой `autosave`, а `/health` исключён из обоих.
 *
 * ПОЧЕМУ APP_GUARD ОБЪЯВЛЕН РЯДОМ С импортом ThrottlerModule, а не в AppModule: провайдер
 * APP_GUARD инстанцируется в контексте модуля, где объявлен, и резолвит зависимости guard'а
 * (storage, options) из ЕГО инъектора. Поэтому ThrottlerModule.forRootAsync импортируется
 * здесь же — так у guard'а есть и хранилище, и конфиг. Декораторам @Throttle/@SkipThrottle на
 * чужих контроллерах импорт не нужен: это просто метаданные, которые глобальный guard читает
 * рефлексией на каждом запросе.
 *
 * Storage — Redis, из общего command-клиента RedisService (SLT-29). Целевая топология —
 * несколько инстансов за балансировщиком: при памяти процесса каждый под считал бы лимит у
 * себя, и фактический потолок умножился бы на их число. Общий счётчик в Redis держит лимит
 * единым на весь кластер. Адаптеру передаётся уже готовый ioredis-инстанс — в этой ветке
 * конструктора он НЕ ставит disconnectRequired, поэтому его onModuleDestroy не рвёт наш общий
 * коннект (владелец жизненного цикла один — RedisService).
 *
 * forRootAsync + инъекция RedisService: RedisModule помечен @Global, поэтому RedisService
 * доступен без явного import.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          { name: THROTTLER_DEFAULT, ...DEFAULT_LIMIT },
          { name: THROTTLER_AUTOSAVE, ...AUTOSAVE_LIMIT },
        ],
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ThrottlerConfigModule {}
