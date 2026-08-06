import { Module } from '@nestjs/common';

import { BoardModule } from '../board/board.module';
import { ElementController } from './element.controller';
import { ElementRepository } from './element.repository';
import { ElementService } from './element.service';

/**
 * PrismaService не импортируется: PrismaModule помечен @Global (SLT-12).
 *
 * BoardModule импортируется ради ОДНОГО провайдера — BoardService с его `assertAccessible`
 * (единственное, что board-модуль экспортирует наружу). Зависимость направлена только сюда:
 * board-модуль про element-модуль в DI ничего не знает и знать не должен, иначе получился бы
 * цикл, который Nest пришлось бы разруливать через forwardRef — верный признак того, что
 * граница между модулями проведена не там.
 *
 * Контракты элемента (`ElementDto`, `ELEMENT_SELECT`) board-модуль импортирует отсюда как
 * обычные типы и константы, без участия DI: чтение содержимого доски отдаёт ту же форму, что и
 * мутации, — одну на приложение.
 *
 * `exports: [ElementService]` (SLT-38): предсказанный в этом же комментарии потребитель настал —
 * realtime-модуль зовёт `upsertEntity`/`patchVersioned`/`removeVersioned` для WS-мутаций
 * элементов. ElementRepository наружу по-прежнему НЕ уходит, по той же причине, что и у доски:
 * мимо сервиса до данных дотягиваться нельзя, откуда бы ни звали — из контроллера или из gateway.
 */
@Module({
  imports: [BoardModule],
  controllers: [ElementController],
  providers: [ElementRepository, ElementService],
  exports: [ElementService],
})
export class ElementModule {}
