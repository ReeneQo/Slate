import { Module } from '@nestjs/common';

import { UserModule } from '../user/user.module';
import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';
import { BoardMemberController } from './board-member.controller';
import { BoardMemberRepository } from './board-member.repository';
import { BoardMemberService } from './board-member.service';

/**
 * PrismaService не импортируется: PrismaModule помечен @Global (SLT-12).
 *
 * Экспортируется BoardService — и только он, ровно как и планировалось в SLT-19. Спрос
 * появился: element-модуль обязан проверить доступ к доске перед вставкой элемента
 * (`assertAccessible`). BoardRepository наружу при этом НЕ уходит — иначе element-модуль
 * дотянулся бы до данных доски мимо сервиса, и правила доступа начали бы обходиться снаружи.
 * Внешняя граница модуля — один вход.
 *
 * ШЕРИНГ (SLT-42) — board-территория, НЕ отдельный Nest-модуль (тикет, решение 5): членство
 * (`BoardMember`) — часть жизненного цикла доски, а не самостоятельный домен, и заводить ради
 * него `BoardMemberModule` значило бы плодить модульные границы без нового потребителя снаружи.
 * `BoardMemberService`/`BoardMemberRepository`/`BoardMemberController` регистрируются здесь же,
 * рядом с board-эквивалентами; наружу, как и раньше, уходит только `BoardService`.
 *
 * `UserModule` импортируется ради `UserService.findByEmail` — резолв приглашаемого
 * (`BoardMemberService.resolveInvitee`, SLT-42 решение 1). Зависимость направлена только сюда:
 * user-модуль про board ничего не знает, цикла в DI не возникает.
 */
@Module({
  imports: [UserModule],
  controllers: [BoardController, BoardMemberController],
  providers: [BoardRepository, BoardService, BoardMemberRepository, BoardMemberService],
  exports: [BoardService],
})
export class BoardModule {}
