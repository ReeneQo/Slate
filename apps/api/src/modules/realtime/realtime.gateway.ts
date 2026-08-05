import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';

import { BoardRoomService } from './board-room.service';
import type { AppSocket, BoardJoinResult } from './realtime.types';

/**
 * WebSocket-gateway приложения — точка входа realtime-транспорта (SLT-32, фундамент этапа 3).
 *
 * Аутентификация НЕ здесь. Она стоит на connection-level middleware в адаптере (`io.use`), и
 * сюда сокет попадает уже опознанным: до `handleConnection` доходит только тот, у кого в сессии
 * был userId, — аноним отклонён на handshake. Поэтому `socket.data.userId` тут гарантированно
 * заполнен (см. ws-auth.middleware и SocketData).
 *
 * Помимо логирования connect/disconnect gateway ведёт членство в комнатах досок (SLT-33):
 * `join_board`/`leave_board`. Тонкость сохранена сознательно — как контроллер в этой архитектуре,
 * gateway лишь принимает событие и делегирует BoardRoomService; проверка доступа, вход/выход из
 * комнаты и логирование — там. Presence (3.2) и синхронизация элементов (3.3) сядут сюда такими
 * же обработчиками сверху.
 *
 * Namespace и путь оставлены дефолтными (`/`, `/socket.io`): CORS и session-middleware вешает
 * адаптер на уровне io-сервера, конфигурировать их в декораторе не нужно — иначе появился бы
 * второй источник настроек транспорта рядом с адаптером.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly boardRoomService: BoardRoomService) {}

  handleConnection(client: AppSocket): void {
    this.logger.log(`WS connected: user=${client.data.userId} socket=${client.id}`);
  }

  handleDisconnect(client: AppSocket): void {
    this.logger.log(`WS disconnected: user=${client.data.userId} socket=${client.id}`);
  }

  /**
   * Вход в комнату доски. Возврат обработчика Nest передаёт в ack-callback клиента — поэтому
   * исход (в комнате / отказ с причиной) едет назад именно так, без отдельного события.
   */
  @SubscribeMessage('join_board')
  handleJoinBoard(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() payload: unknown,
  ): Promise<BoardJoinResult> {
    return this.boardRoomService.joinBoard(client, payload);
  }

  /** Выход из комнаты доски. Без ack — выход не отклоняется и идемпотентен (см. BoardRoomService). */
  @SubscribeMessage('leave_board')
  handleLeaveBoard(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    return this.boardRoomService.leaveBoard(client, payload);
  }
}
