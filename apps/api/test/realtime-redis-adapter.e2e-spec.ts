import type { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import {
  type BoardJoinResult,
  boardRoom,
  type ClientToServerEvents,
  type InterServerEvents,
  type SocketData,
} from '../src/modules/realtime/realtime.types';
import { startTwoInstanceApps, type TwoInstanceApps } from './helpers/multi-instance';

/**
 * E2E Redis-адаптера socket.io (SLT-34) — ключевой DoD задачи.
 *
 * Без адаптера broadcast в комнату доходит только до сокетов ЭТОГО инстанса. Проверить это можно
 * лишь на НЕСКОЛЬКИХ инстансах: два клиента подключены к разным Nest-приложениям, оба входят в одну
 * комнату board:<id>, инстанс-1 делает broadcast — и он обязан дойти до клиента на инстансе-2 через
 * Redis pub/sub. На одном инстансе этот тест был бы зелёным и без адаптера, поэтому он и ценен.
 *
 * Событие броадкаста (`adapter_probe`) объявлено ЛОКАЛЬНО в тесте и в модель приложения не входит:
 * presence/sync (3.2/3.3) добавят свои события сами. Здесь важен транспорт, а не конкретное событие —
 * тест играет за будущий presence, инициируя ту же операцию `io.to(room).emit(...)`.
 */

/** Полезная нагрузка тестового броадкаста. Маркер — чтобы отличить своё событие от чужого шума. */
interface AdapterProbePayload {
  marker: string;
}

/** Локальная карта серверных событий: ровно один зонд, не входящий в модель приложения
 * (ServerToClientEvents, SLT-35) — расширяем её здесь кастом на тестовое событие, не трогая src. */
type ProbeServerEvents = {
  adapter_probe: (payload: AdapterProbePayload) => void;
};

/** Таймаут ожидания сетевого события: щедрый, но конечный — иначе провал завис бы вместо падения. */
const EVENT_TIMEOUT_MS = 5_000;

/** Подключить socket.io-client к инстансу с session-кукой в handshake. Резолвится на 'connect',
 * падает на 'connect_error' (в т.ч. отказ ws-auth) — чтобы провал аутентификации был виден сразу. */
function connectClient(url: string, cookie: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      forceNew: true,
    });

    const timer = setTimeout(() => {
      client.close();
      reject(new Error(`Сокет не подключился к ${url} за ${EVENT_TIMEOUT_MS} мс`));
    }, EVENT_TIMEOUT_MS);

    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once('connect_error', (error) => {
      clearTimeout(timer);
      client.close();
      reject(new Error(`connect_error на ${url}: ${error.message}`));
    });
  });
}

/** Отправить join_board и дождаться ack-исхода. Промис на ack, а не отдельное событие — так и
 * устроен контракт (SLT-33): клиент узнаёт исход входа именно из callback'а. */
function joinBoard(client: ClientSocket, boardId: string): Promise<BoardJoinResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`join_board не получил ack за ${EVENT_TIMEOUT_MS} мс`)),
      EVENT_TIMEOUT_MS,
    );

    client.emit('join_board', { boardId }, (result: BoardJoinResult) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

/** Дождаться одного события на клиенте с таймаутом. */
function once<T>(client: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Событие '${event}' не пришло за ${EVENT_TIMEOUT_MS} мс`)),
      EVENT_TIMEOUT_MS,
    );

    client.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Redis adapter (e2e, multi-instance)', () => {
  let apps: TwoInstanceApps;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    apps = await startTwoInstanceApps();
  });

  afterAll(async () => {
    // Сокеты закрываются до приложений: живой клиент на закрывающемся сервере — это лишний
    // reconnect-шум и потенциальный open handle.
    for (const client of clients) {
      client.close();
    }
    await apps?.stop();
  });

  it('доставляет broadcast из комнаты доски с одного инстанса на клиент другого', async () => {
    const { cookie, boardId } = await apps.createMemberAndBoard();

    // Клиент-1 на инстансе-1 (с него пойдёт broadcast), клиент-2 на инстансе-2 (он проверяет приём).
    const [client1, client2] = await Promise.all([
      connectClient(apps.url1, cookie),
      connectClient(apps.url2, cookie),
    ]);
    clients.push(client1, client2);

    // Оба входят в ОДНУ комнату — каждый на своём инстансе. Вход авторизован (доска своя) → ok.
    const [join1, join2] = await Promise.all([
      joinBoard(client1, boardId),
      joinBoard(client2, boardId),
    ]);
    expect(join1).toEqual({ ok: true });
    expect(join2).toEqual({ ok: true });

    // Cross-instance членство: инстанс-1 видит В КОМНАТЕ и свой сокет, и удалённый с инстанса-2 —
    // это возможно только через Redis-адаптер (иначе fetchSockets вернул бы лишь локальный, длина 1).
    const socketsInRoom = await apps.server1.in(boardRoom(boardId)).fetchSockets();
    expect(socketsInRoom).toHaveLength(2);

    // Слушатель ставим ДО broadcast, иначе гонка: событие могло бы прийти раньше подписки.
    const received = once<AdapterProbePayload>(client2, 'adapter_probe');

    // Broadcast с инстанса-1 в комнату. Каст — потому что событие тестовое и в модели приложения
    // (ServerToClientEvents) его нет; транспорт при этом самый настоящий.
    const payload: AdapterProbePayload = { marker: 'cross-instance' };
    (
      apps.server1 as unknown as Server<
        ClientToServerEvents,
        ProbeServerEvents,
        InterServerEvents,
        SocketData
      >
    )
      .to(boardRoom(boardId))
      .emit('adapter_probe', payload);

    // Ядро DoD: событие, отправленное на инстансе-1, получено клиентом инстанса-2.
    await expect(received).resolves.toEqual(payload);
  });
});
