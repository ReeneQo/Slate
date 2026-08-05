import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  type AppServer,
  type AppSocket,
  boardIdsFromRooms,
  boardRoom,
  extractBoardId,
} from './realtime.types';

/** Порог офлайна: 60с молчания = 3 пропущенных heartbeat (клиент шлёт `presence_ping` раз в 20с). */
const ONLINE_THRESHOLD_MS = 60_000;

/**
 * TTL ключа комнаты в Redis. Не про живость участников (та решается по score members, см. ниже) —
 * про то, чтобы ключи заброшенных/опустевших досок сами вымылись из Redis, а не копились вечно.
 * Продлевается на каждый ZADD (join и heartbeat), поэтому активная комната никогда его не достигает.
 */
const ROOM_KEY_TTL_SECONDS = 300;

/** Ключ sorted set присутствия одной доски. Формат — домен presence, не инфраструктура Redis. */
function presenceKey(boardId: string): string {
  return `presence:board:${boardId}`;
}

/** member sorted set: `<userId>:<socketId>` — per-socket гранулярность под мультивкладку. */
function presenceMember(userId: string, socketId: string): string {
  return `${userId}:${socketId}`;
}

/** userId не может содержать `:` (UUID), поэтому срез до первого разделителя однозначен. */
function userIdFromMember(member: string): string {
  return member.slice(0, member.indexOf(':'));
}

/**
 * Presence — реестр «кто сейчас онлайн на доске» (SLT-35, 3.2), фундамент под курсоры (SLT-36) и
 * presence-UI (SLT-37).
 *
 * Хранилище — ОДИН sorted set на комнату (`presence:board:<boardId>`), member — `userId:socketId`,
 * score — timestamp последнего heartbeat. НЕ hash `{userId: count}`: в multi-instance-топологии
 * (SLT-34) негрейсфул-смерть инстанса не продлевает и не истекает счётчик в hash сама по себе (TTL
 * общий на весь ключ, его продлевают ЖИВЫЕ юзеры) — призрак повис бы в списке навсегда. В sorted set
 * каждый member стареет ИНДИВИДУАЛЬНО по своему score, и `ZRANGEBYSCORE` отсекает протухших без
 * per-key TTL и без SCAN. Это корректность by design для нескольких инстансов за балансировщиком, а
 * не оптимизация.
 *
 * Дельты (`presence_join`/`presence_leave`) — на уровне userId, НЕ socketId: эмитятся только когда
 * счётчик живых сокетов юзера переходит 0→1 или 1→0. Каждый публичный метод поэтому снимает список
 * живых userId ДО операции и ПОСЛЕ — вторая вкладка того же юзера входит в тот же «уже онлайн» список
 * и дельты не порождает. Broadcast идёт обычным `socket.to(room).emit`/`server.to(room).emit`:
 * Redis-адаптер (SLT-34) разносит его на все инстансы прозрачно, этот сервис про него не знает.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Сокет входит в presence доски (после успешного `join_board`, см. RealtimeGateway). ZADD
   * члена, продление TTL ключа, дельта `presence_join` при переходе юзера 0→1 и — сразу следом —
   * снимок текущего онлайна ТОЛЬКО этому сокету (`presence_snapshot`): единичное чтение Redis,
   * а не опрос других инстансов, он и есть единый источник правды.
   *
   * Payload разбирается тем же `extractBoardId`, что и `BoardRoomService` — независимо: presence
   * не знает, что решил room-слой, и наоборот, но оба защищены от кривого ввода одним парсером.
   */
  async join(socket: AppSocket, payload: unknown): Promise<void> {
    const boardId = extractBoardId(payload);

    if (boardId === null) {
      return;
    }

    const userId = socket.data.userId;
    const now = Date.now();

    await this.cleanupGhosts(boardId, now);
    const wasOnline = (await this.readAliveUserIds(boardId, now)).has(userId);

    const key = presenceKey(boardId);
    await this.redis.client.zadd(key, now, presenceMember(userId, socket.id));
    await this.redis.client.expire(key, ROOM_KEY_TTL_SECONDS);

    if (!wasOnline) {
      this.logger.debug(`Presence join: user=${userId} board=${boardId}`);
      socket.to(boardRoom(boardId)).emit('presence_join', { userId });
    }

    const snapshot = [...(await this.readAliveUserIds(boardId, now))];
    socket.emit('presence_snapshot', { userIds: snapshot });
  }

  /** Явный выход сокета (`leave_board`). Симметричен `join`, без снимка — выходящему он не нужен. */
  async leave(socket: AppSocket, payload: unknown): Promise<void> {
    const boardId = extractBoardId(payload);

    if (boardId === null) {
      return;
    }

    await this.exit(socket, boardId);
  }

  /**
   * Уборка ВСЕХ досок сокета разом — по факту его отключения (graceful или разорванного).
   *
   * Источник списка досок — `socket.rooms` (сам socket.io), а не отдельный реестр `socket →
   * boardId[]`: тот дублировал бы то, что транспорт и так знает. Вызывается из `disconnecting`
   * (не `disconnect`!) — на этом событии `socket.rooms` ещё не очищен socket.io, это единственная
   * точка, где он доступен (см. RealtimeGateway.handleConnection).
   */
  async leaveAll(socket: AppSocket): Promise<void> {
    for (const boardId of boardIdsFromRooms(socket.rooms)) {
      await this.exit(socket, boardId);
    }
  }

  /**
   * Прикладной heartbeat (`presence_ping`, раз в 20с с клиента). БЕЗ boardId в payload — событие
   * продлевает score сразу на всех досках, в комнатах которых сейчас состоит сокет (обычно одна).
   * Не порождает дельт: юзер и так уже числится онлайн, meняется только "свежесть" score.
   *
   * Свой heartbeat, а не транспортный ping socket.io: presence-семантика («юзер онлайн») отделена
   * от keepalive транспорта («жив ли физический сокет») — разная ответственность, разные тайминги.
   * Presence-TTL не должен зависеть от настроек транспорта.
   */
  async heartbeat(socket: AppSocket): Promise<void> {
    const userId = socket.data.userId;
    const now = Date.now();

    await Promise.all(
      boardIdsFromRooms(socket.rooms).map(async (boardId) => {
        const key = presenceKey(boardId);
        await this.redis.client.zadd(key, now, presenceMember(userId, socket.id));
        await this.redis.client.expire(key, ROOM_KEY_TTL_SECONDS);
      }),
    );
  }

  /** Список онлайн-userId доски: лениво чистит протухших участников, затем читает живых. */
  async getOnlineUserIds(boardId: string, now = Date.now()): Promise<string[]> {
    await this.cleanupGhosts(boardId, now);
    return [...(await this.readAliveUserIds(boardId, now))];
  }

  /**
   * Серверный тик (см. PresenceSweeperService), часть 5a: страховка для негрейсфул-случаев, где
   * `disconnecting` не сработал (инстанс убит без штатного закрытия сокета) — score стареет сам,
   * а этот метод физически убирает протухших членов и, если из-за уборки какой-то userId лишился
   * ПОСЛЕДНЕГО члена, эмитит `presence_leave`. Explicit `server`, а не `socket.to`: тик не привязан
   * ни к какому сокету-инициатору, эмитить нужно из io-сервера напрямую.
   *
   * До/после снимаются `readAllUserIds` (СЫРОЕ членство, без фильтра по alive-порогу), а НЕ
   * `readAliveUserIds`: к моменту, когда сюда доходит очередь конкретного члена, он уже стал
   * "неживым" по тому же самому порогу — обычный `getOnlineUserIds` его и так больше не покажет,
   * без единого события. Именно физическое удаление ЗДЕСЬ — первый и единственный момент, когда
   * можно сравнить "был ли ещё членом секунду назад" с "остался ли хоть один член после уборки", и
   * только так поймать переход 1→0 для эмита ретроактивной дельты.
   */
  async sweep(server: AppServer, boardId: string, now = Date.now()): Promise<void> {
    const before = await this.readAllUserIds(boardId);
    const removed = await this.cleanupGhosts(boardId, now);

    if (removed === 0) {
      return;
    }

    const after = await this.readAllUserIds(boardId);

    for (const userId of before) {
      if (!after.has(userId)) {
        this.logger.debug(`Presence swept: user=${userId} board=${boardId}`);
        server.to(boardRoom(boardId)).emit('presence_leave', { userId });
      }
    }
  }

  /** Общее ядро join/leave/leaveAll: ZREM члена + дельта `presence_leave` при переходе юзера 1→0. */
  private async exit(socket: AppSocket, boardId: string): Promise<void> {
    const userId = socket.data.userId;
    const key = presenceKey(boardId);

    await this.redis.client.zrem(key, presenceMember(userId, socket.id));

    const stillOnline = (await this.readAliveUserIds(boardId, Date.now())).has(userId);

    if (!stillOnline) {
      this.logger.debug(`Presence leave: user=${userId} board=${boardId}`);
      socket.to(boardRoom(boardId)).emit('presence_leave', { userId });
    }
  }

  /** Чистое чтение живых userId (score в пределах порога) — БЕЗ побочной уборки Redis. */
  private async readAliveUserIds(boardId: string, now: number): Promise<Set<string>> {
    const members = await this.redis.client.zrangebyscore(
      presenceKey(boardId),
      `(${now - ONLINE_THRESHOLD_MS}`,
      '+inf',
    );

    return new Set(members.map(userIdFromMember));
  }

  /** СЫРОЕ чтение всех userId-членов, включая уже протухших по alive-порогу. Только для sweep. */
  private async readAllUserIds(boardId: string): Promise<Set<string>> {
    const members = await this.redis.client.zrange(presenceKey(boardId), 0, -1);

    return new Set(members.map(userIdFromMember));
  }

  /** Физически убирает членов со score старше порога. Возвращает число удалённых (0 ⇒ уборки не было). */
  private cleanupGhosts(boardId: string, now: number): Promise<number> {
    return this.redis.client.zremrangebyscore(
      presenceKey(boardId),
      '-inf',
      `(${now - ONLINE_THRESHOLD_MS}`,
    );
  }
}
