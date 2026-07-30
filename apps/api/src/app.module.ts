import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import type { AppConfig } from './config/env.schema';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { BoardModule } from './modules/board/board.module';
import { ElementModule } from './modules/element/element.module';
import { HealthModule } from './modules/health/health.module';
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
      ],
    };
  }
}
