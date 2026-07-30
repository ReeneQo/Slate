import { Module } from '@nestjs/common';

import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';

/**
 * PrismaService не импортируется: PrismaModule помечен @Global (SLT-12).
 *
 * Экспортируется BoardService — и только он, ровно как и планировалось в SLT-19. Спрос
 * появился: element-модуль обязан проверить доступ к доске перед вставкой элемента
 * (`assertAccessible`). BoardRepository наружу при этом НЕ уходит — иначе element-модуль
 * дотянулся бы до данных доски мимо сервиса, и правила доступа начали бы обходиться снаружи.
 * Внешняя граница модуля — один вход.
 */
@Module({
  controllers: [BoardController],
  providers: [BoardRepository, BoardService],
  exports: [BoardService],
})
export class BoardModule {}
