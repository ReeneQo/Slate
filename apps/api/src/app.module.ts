import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import type { AppConfig } from './config/env.schema';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { ThrottlerConfigModule } from './infrastructure/throttler/throttler.module';
import { AuthModule } from './modules/auth/auth.module';
import { SessionGenerationModule } from './modules/auth/sessions/session-generation.module';
import { BoardModule } from './modules/board/board.module';
import { ElementModule } from './modules/element/element.module';
import { HealthModule } from './modules/health/health.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { UserModule } from './modules/user/user.module';

/**
 * Корневой модуль динамический: валидированный конфиг приходит из main.ts (проверен ДО
 * старта Nest) и прокидывается в ConfigModule.forRoot. Так валидация происходит один раз
 * и явно, а значение течёт в DI без скрытого глобального состояния.
 *
 * ConfigModule/PrismaModule/RedisModule — глобальные: доступны доменным модулям (блок 2+)
 * без повторного импорта.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        PrismaModule,
        RedisModule,
        // @Global: счётчик поколения сессий сверяет AuthGuard, а он работает на защищённых
        // роутах всех доменных модулей. Регистрируется в корне рядом с прочими глобальными
        // (Redis/Prisma), от которых зависит сам (SLT-31).
        SessionGenerationModule,
        // Глобальный троттлинг (APP_GUARD + именованные лимиты default/autosave). Стоит в
        // корне, потому что guard обязан накрыть ВСЕ роуты; исключения задаются точечно
        // декораторами на контроллерах (@SkipThrottle на health, @Throttle на element).
        ThrottlerConfigModule,
        HealthModule,
        UserModule,
        // SessionsModule напрямую здесь больше не нужен — его импортирует AuthModule,
        // единственный его потребитель. Лишний импорт в корне создаёт впечатление, будто
        // сессии доступны всем модулям, тогда как DI так не работает.
        AuthModule,
        BoardModule,
        // ElementModule сам импортирует BoardModule (ему нужен BoardService), но в корне он
        // зарегистрирован явно: иначе его контроллер не попал бы в маршрутизацию — Nest
        // подхватывает контроллеры только у модулей, которые реально включены в граф.
        ElementModule,
        // Realtime-транспорт этапа 3 (SLT-32): WebSocket-gateway. Транспортную обвязку io-сервера
        // (CORS, session, connection-level auth) ставит кастомный адаптер в configureApp — модуль
        // держит только сам gateway.
        RealtimeModule,
      ],
    };
  }
}
