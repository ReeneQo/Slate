import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { SessionGenerationService } from '../auth/sessions/session-generation.service';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';
import { type AppSocket, boardIdsFromRooms } from './realtime.types';

/** Раз в 20-30с — уборка призраков presence и сверка поколений сессий (SLT-35, п.5). */
const TICK_INTERVAL_MS = 25_000;

/**
 * Единственный периодический таймер на инстанс: две заботы, не связанные друг с другом по сути, но
 * объединённые общим триггером — «раз в N секунд пройтись по сокетам ЭТОГО инстанса».
 *
 * 1. Уборка протухших presence-членов + leave-дельты (п.5a) — страховка для негрейсфул-случаев:
 *    инстанс убит без штатного `disconnecting`, и score в Redis просто перестаёт обновляться.
 *    `PresenceService.sweep` сам решает, нужна ли дельта; здесь только перебор активных досок.
 *
 * 2. Сверка sessionGen (п.5b, вклеенный долг SLT-31/32 — «выйти везде» обязан рвать уже открытые
 *    сокеты, а не только не пускать новые запросы). СЕРВЕРНЫЙ таймер, а не клиентский heartbeat: это
 *    security-механизм, и он не должен зависеть от добросовестности клиента — клиентский heartbeat
 *    привёл бы лишь к выпадению юзера из presence по TTL, а сокет остался бы жив.
 *
 *    Расхождение снимка (см. `SocketData.sessionGen`, ws-auth.middleware) с актуальным поколением →
 *    `socket.disconnect(true)`. Отдельного вызова presence-уборки здесь НЕТ: `disconnect(true)`
 *    проходит тот же путь, что и обычное клиентское отключение (`disconnecting` → `disconnect`),
 *    и слушатель `disconnecting`, поставленный в `RealtimeGateway.handleConnection`, делает уборку
 *    сам. Дублировать её здесь — значит завести второй источник того же побочного эффекта.
 *
 * Список активных досок для (1) и список сокетов для (2) — это `server.sockets.sockets`, то есть
 * сокеты, реально подключённые к ЭТОМУ инстансу: отдельного реестра заводить не нужно, io-сервер
 * это уже знает.
 */
@Injectable()
export class PresenceSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceSweeperService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly presenceService: PresenceService,
    private readonly sessionGeneration: SessionGenerationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Presence tick failed: ${message}`);
      });
    }, TICK_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const sockets = [...this.gateway.server.sockets.sockets.values()];

    // Сверка поколений — до уборки presence: инвалидированный сокет вот-вот сам вызовет её через
    // disconnect → disconnecting, второй раз пересчитывать его доски в sweepBoards незачем.
    await this.reconcileSessionGenerations(sockets);
    await this.sweepBoards(sockets);
  }

  /** п.5b — по одному сокету за раз. MGET-батч по userId возможен, см. развилку в отчёте SLT-35. */
  private async reconcileSessionGenerations(sockets: AppSocket[]): Promise<void> {
    await Promise.all(
      sockets.map(async (socket) => {
        const current = await this.sessionGeneration.getCurrent(socket.data.userId);

        if (current !== socket.data.sessionGen) {
          this.logger.debug(
            `WS invalidated by session generation: user=${socket.data.userId} socket=${socket.id}`,
          );
          socket.disconnect(true);
        }
      }),
    );
  }

  /** п.5a — доски этого инстанса выведены из комнат живых (на этот момент) сокетов. */
  private async sweepBoards(sockets: AppSocket[]): Promise<void> {
    const boardIds = new Set<string>();

    for (const socket of sockets) {
      for (const boardId of boardIdsFromRooms(socket.rooms)) {
        boardIds.add(boardId);
      }
    }

    const server = this.gateway.server;
    await Promise.all([...boardIds].map((boardId) => this.presenceService.sweep(server, boardId)));
  }
}
