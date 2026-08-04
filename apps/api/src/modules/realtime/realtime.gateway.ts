import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';

import type { AppSocket } from './realtime.types';

/**
 * WebSocket-gateway приложения — точка входа realtime-транспорта (SLT-32, фундамент этапа 3).
 *
 * Аутентификация НЕ здесь. Она стоит на connection-level middleware в адаптере (`io.use`), и
 * сюда сокет попадает уже опознанным: до `handleConnection` доходит только тот, у кого в сессии
 * был userId, — аноним отклонён на handshake. Поэтому `socket.data.userId` тут гарантированно
 * заполнен (см. ws-auth.middleware и SocketData).
 *
 * Пока gateway умеет ровно две вещи — залогировать подключение и отключение. Это сознательно:
 * presence (3.2), синхронизация элементов (3.3) и разрешение конфликтов (3.4) сядут сюда
 * обработчиками событий сверху. Комнат по доске здесь тоже ещё нет — это следующая задача (3.1).
 *
 * Namespace и путь оставлены дефолтными (`/`, `/socket.io`): CORS и session-middleware вешает
 * адаптер на уровне io-сервера, конфигурировать их в декораторе не нужно — иначе появился бы
 * второй источник настроек транспорта рядом с адаптером.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: AppSocket): void {
    this.logger.log(`WS connected: user=${client.data.userId} socket=${client.id}`);
  }

  handleDisconnect(client: AppSocket): void {
    this.logger.log(`WS disconnected: user=${client.data.userId} socket=${client.id}`);
  }
}
