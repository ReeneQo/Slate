import { Module } from '@nestjs/common';

import { BoardModule } from '../board/board.module';
import { BoardRoomService } from './board-room.service';
import { CursorService } from './cursor.service';
import { PresenceService } from './presence.service';
import { PresenceSweeperService } from './presence-sweeper.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Realtime-модуль: держит WebSocket-gateway, комнаты по доске (SLT-33), presence (SLT-35) и
 * курсоры (SLT-36).
 *
 * Все провайдеры — обычные для Nest: DI инстанцирует их при инициализации, а socket.io привязывает
 * gateway к io-серверу, который поднимает кастомный адаптер (см. session-io.adapter). Границы
 * ответственности здесь важны: МОДУЛЬ владеет доменной частью realtime (обработчики соединения,
 * членство в комнатах, онлайн-реестр и, позже, sync), а АДАПТЕР — транспортной обвязкой io-сервера
 * (CORS, session, connection-level auth). Поэтому ws-auth-middleware, хоть и живёт рядом в этой же
 * папке, в провайдеры модуля не попадает: его подключает адаптер на этапе создания io-сервера, до
 * того как Nest начнёт инстанцировать gateway.
 *
 * `SessionGenerationService`, нужный `PresenceSweeperService` для сверки поколений сессий, сюда не
 * импортируется: он раздаётся `@Global()`-модулем (SessionGenerationModule, SLT-31) — тем же путём,
 * что Redis и Config.
 *
 * BoardModule импортируется ради ОДНОГО провайдера — BoardService: BoardRoomService зовёт его
 * `canAccess`, чтобы авторизовать вход в комнату тем же инвариантом, что и HTTP. Зависимость
 * направлена только сюда — board-модуль про realtime в DI не знает, — как и у element-модуля,
 * иначе получился бы цикл.
 */
@Module({
  imports: [BoardModule],
  providers: [
    RealtimeGateway,
    BoardRoomService,
    PresenceService,
    PresenceSweeperService,
    CursorService,
  ],
})
export class RealtimeModule {}
