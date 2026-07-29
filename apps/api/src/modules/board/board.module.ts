import { Module } from '@nestjs/common';

import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';

/**
 * PrismaService не импортируется: PrismaModule помечен @Global (SLT-12).
 *
 * `exports` нет вообще — наружу модуль отдаёт только HTTP. Экспортировать нечего, пока никто
 * не спрашивает: SLT-20 (мутации элементов) понадобится проверка доступа к доске, и тогда
 * отсюда уедет BoardService — но НЕ BoardRepository. Иначе element-модуль дотянется до данных
 * мимо сервиса, и правила доступа начнут обходиться снаружи. Внешняя граница модуля — один вход.
 */
@Module({
  controllers: [BoardController],
  providers: [BoardRepository, BoardService],
})
export class BoardModule {}
