import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * @Global — репозитории всех доменных модулей (блок 2+) ходят в БД через PrismaService.
 * Делаем его доступным без импорта в каждый модуль.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
