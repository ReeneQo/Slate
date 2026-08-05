import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { BoardRoomService } from './board-room.service';
import { PresenceService } from './presence.service';
import type { AppServer, AppSocket, BoardJoinResult } from './realtime.types';

/**
 * WebSocket-gateway приложения — точка входа realtime-транспорта (SLT-32, фундамент этапа 3).
 *
 * Аутентификация НЕ здесь. Она стоит на connection-level middleware в адаптере (`io.use`), и
 * сюда сокет попадает уже опознанным: до `handleConnection` доходит только тот, у кого в сессии
 * был userId, — аноним отклонён на handshake. Поэтому `socket.data.userId` тут гарантированно
 * заполнен (см. ws-auth.middleware и SocketData).
 *
 * Помимо логирования connect/disconnect gateway ведёт членство в комнатах досок (SLT-33) и presence
 * (SLT-35): `join_board`/`leave_board` дёргают ОБА домена — `BoardRoomService` (комната socket.io) и
 * `PresenceService` (онлайн-реестр в Redis) — каждый своим независимым разбором payload. Это не
 * бизнес-логика в контроллере, а последовательная делегация: gateway не решает НИЧЕГО про доступ или
 * онлайн, он лишь знает порядок вызова (presence — только если членство подтверждено) и передаёт тот
 * же payload обеим службам. `presence_ping` — чистая делегация без условий.
 *
 * Уборка presence при отключении сокета (SLT-35, graceful И оборванное) висит не на `disconnect`
 * (`OnGatewayDisconnect`), а на socket.io-событии `disconnecting`, поставленном в `handleConnection`:
 * к моменту `disconnect` socket.io УЖЕ вывел сокет из всех комнат (`socket.rooms` пуст), а
 * `PresenceService.leaveAll` берёт список досок именно оттуда. `disconnecting` — единственная точка,
 * где комнаты сокета ещё видны.
 *
 * Namespace и путь оставлены дефолтными (`/`, `/socket.io`): CORS и session-middleware вешает
 * адаптер на уровне io-сервера, конфигурировать их в декораторе не нужно — иначе появился бы
 * второй источник настроек транспорта рядом с адаптером.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  /**
   * io-сервер, поднятый кастомным адаптером. Nest заполняет поле после createIOServer — до
   * первого события оно гарантированно готово. Читается двух-инстансным e2e Redis-адаптера
   * (SLT-34: broadcast в комнату доски с одного инстанса, приём — на другом) и серверным
   * presence-тиком (SLT-35, PresenceSweeperService: перебор сокетов инстанса и broadcast leave-
   * дельт вне контекста конкретного события).
   */
  @WebSocketServer()
  readonly server!: AppServer;

  constructor(
    private readonly boardRoomService: BoardRoomService,
    private readonly presenceService: PresenceService,
  ) {}

  handleConnection(client: AppSocket): void {
    this.logger.log(`WS connected: user=${client.data.userId} socket=${client.id}`);

    // См. класс-докстринг: единственная точка, где socket.rooms ещё не очищен на выходе.
    client.on('disconnecting', () => {
      this.presenceService.leaveAll(client).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Presence cleanup on disconnect failed: ${message}`);
      });
    });
  }

  handleDisconnect(client: AppSocket): void {
    this.logger.log(`WS disconnected: user=${client.data.userId} socket=${client.id}`);
  }

  /**
   * Вход в комнату доски. Возврат обработчика Nest передаёт в ack-callback клиента — поэтому
   * исход (в комнате / отказ с причиной) едет назад именно так, без отдельного события.
   *
   * Presence входит В КОМНАТУ ТОЛЬКО при успешном членстве — отказ `board_not_found` не должен
   * тихо всё равно записать сокет в онлайн доски, к которой ему отказано в доступе.
   */
  @SubscribeMessage('join_board')
  async handleJoinBoard(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() payload: unknown,
  ): Promise<BoardJoinResult> {
    const result = await this.boardRoomService.joinBoard(client, payload);

    if (result.ok) {
      await this.presenceService.join(client, payload);
    }

    return result;
  }

  /** Выход из комнаты доски. Без ack — выход не отклоняется и идемпотентен (см. BoardRoomService). */
  @SubscribeMessage('leave_board')
  async handleLeaveBoard(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    await this.boardRoomService.leaveBoard(client, payload);
    await this.presenceService.leave(client, payload);
  }

  /** Прикладной presence-heartbeat (SLT-35). Без ack — клиенту не на что реагировать. */
  @SubscribeMessage('presence_ping')
  handlePresencePing(@ConnectedSocket() client: AppSocket): Promise<void> {
    return this.presenceService.heartbeat(client);
  }
}
