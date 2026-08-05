import type { RedisService } from '../../infrastructure/redis/redis.service';
import { PresenceService } from './presence.service';
import type { AppServer, AppSocket } from './realtime.types';

/**
 * Юнит PresenceService изолирует ровно правила sorted-set-логики: кто онлайн, когда эмитится
 * дельта, что переживает уборку протухших. Настоящего Redis здесь нет — вместо `RedisService`
 * подставлен ЖИВОЙ фейк sorted set (ZADD/ZREM/ZRANGEBYSCORE/ZREMRANGEBYSCORE/EXPIRE с реальной
 * score-семантикой и `(`-эксклюзивными границами), а не мок отдельных вызовов: сервис проверяется
 * на РЕАЛЬНОМ поведении хранилища (дедупликация userId, отсечение по порогу), а не на том, что он
 * дёрнул нужный метод с нужными аргументами — семантика Redis тут и есть предмет теста.
 *
 * `Date.now()` управляется `jest.useFakeTimers` — тесты протухания/heartbeat не могут зависеть от
 * реального времени выполнения.
 */

const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const BOARD_ROOM = `board:${BOARD_ID}`;
const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const OTHER_USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd7';

const ONLINE_THRESHOLD_MS = 60_000;

/** Живой фейк одного Redis sorted set — ровно те команды, которыми пользуется PresenceService. */
class FakeSortedSetRedis {
  private readonly sets = new Map<string, Map<string, number>>();

  zadd(key: string, score: number, member: string): Promise<number> {
    const set = this.setFor(key);
    const isNew = !set.has(member);
    set.set(member, score);
    return Promise.resolve(isNew ? 1 : 0);
  }

  zrem(key: string, member: string): Promise<number> {
    return Promise.resolve(this.setFor(key).delete(member) ? 1 : 0);
  }

  zrangebyscore(key: string, min: string, max: string): Promise<string[]> {
    const [minScore, minExclusive] = parseBound(min);
    const [maxScore, maxExclusive] = parseBound(max);

    const members = [...this.setFor(key).entries()]
      .filter(
        ([, score]) =>
          (minExclusive ? score > minScore : score >= minScore) &&
          (maxExclusive ? score < maxScore : score <= maxScore),
      )
      .map(([member]) => member);

    return Promise.resolve(members);
  }

  async zremrangebyscore(key: string, min: string, max: string): Promise<number> {
    const members = await this.zrangebyscore(key, min, max);
    const set = this.setFor(key);
    members.forEach((member) => set.delete(member));
    return members.length;
  }

  zrange(key: string): Promise<string[]> {
    return Promise.resolve([...this.setFor(key).keys()]);
  }

  expire(): Promise<number> {
    return Promise.resolve(1);
  }

  membersOf(key: string): string[] {
    return [...this.setFor(key).keys()];
  }

  private setFor(key: string): Map<string, number> {
    let set = this.sets.get(key);

    if (!set) {
      set = new Map();
      this.sets.set(key, set);
    }

    return set;
  }
}

function parseBound(bound: string): [number, boolean] {
  if (bound === '+inf') return [Number.POSITIVE_INFINITY, false];
  if (bound === '-inf') return [Number.NEGATIVE_INFINITY, false];
  if (bound.startsWith('(')) return [Number(bound.slice(1)), true];
  return [Number(bound), false];
}

function createService() {
  const redis = new FakeSortedSetRedis();
  const service = new PresenceService({ client: redis } as unknown as RedisService);
  return { service, redis };
}

/** Заглушка сокета: id, userId, комнаты и `to`/`emit`, которых касается PresenceService. */
function fakeSocket(userId: string, socketId: string) {
  const toEmit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit: toEmit });
  const emit = jest.fn();
  const socket = {
    id: socketId,
    data: { userId, sessionGen: 0 },
    rooms: new Set<string>(),
    to,
    emit,
  } as unknown as AppSocket;

  return { socket, to, toEmit, emit };
}

describe('PresenceService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('вход сокета добавляет member в sorted set, список онлайна содержит userId, эмитятся join и snapshot', async () => {
    // Arrange
    const { service } = createService();
    const { socket, to, toEmit, emit } = fakeSocket(USER_ID, 'socket-1');

    // Act
    await service.join(socket, { boardId: BOARD_ID });

    // Assert
    expect(await service.getOnlineUserIds(BOARD_ID)).toEqual([USER_ID]);
    expect(to).toHaveBeenCalledWith(BOARD_ROOM);
    expect(toEmit).toHaveBeenCalledWith('presence_join', { userId: USER_ID });
    expect(emit).toHaveBeenCalledWith('presence_snapshot', { userIds: [USER_ID] });
  });

  it('игнорирует join/leave с кривым payload, не трогая sorted set', async () => {
    // Arrange
    const { service } = createService();
    const { socket, emit } = fakeSocket(USER_ID, 'socket-1');

    // Act
    await service.join(socket, { boardId: 42 });

    // Assert
    expect(await service.getOnlineUserIds(BOARD_ID)).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  describe('мультивкладка', () => {
    it('второй сокет того же userId не порождает повторный presence_join, а входит в тот же онлайн-userId', async () => {
      // Arrange
      const { service } = createService();
      const { socket: tab1 } = fakeSocket(USER_ID, 'socket-1');
      const { socket: tab2, to: to2 } = fakeSocket(USER_ID, 'socket-2');

      // Act
      await service.join(tab1, { boardId: BOARD_ID });
      await service.join(tab2, { boardId: BOARD_ID });

      // Assert: юзер уже был онлайн — второй join вообще не трогает broadcast (только snapshot себе).
      expect(await service.getOnlineUserIds(BOARD_ID)).toEqual([USER_ID]);
      expect(to2).not.toHaveBeenCalled();
    });

    it('leave одной вкладки оставляет юзера онлайн; leave второй — офлайн с presence_leave', async () => {
      // Arrange
      const { service } = createService();
      const { socket: tab1, toEmit: toEmit1 } = fakeSocket(USER_ID, 'socket-1');
      const { socket: tab2, toEmit: toEmit2 } = fakeSocket(USER_ID, 'socket-2');
      await service.join(tab1, { boardId: BOARD_ID }); // первый в комнате — сам себе шлёт presence_join
      await service.join(tab2, { boardId: BOARD_ID });
      toEmit1.mockClear(); // отсекаем presence_join из join выше — интересует только leave-ветка

      // Act: выходит первая вкладка
      await service.leave(tab1, { boardId: BOARD_ID });

      // Assert: юзер всё ещё онлайн благодаря второй вкладке — сама уходящая вкладка дельту не шлёт
      expect(await service.getOnlineUserIds(BOARD_ID)).toEqual([USER_ID]);
      expect(toEmit1).not.toHaveBeenCalledWith('presence_leave', expect.anything());

      // Act: выходит вторая (последняя) вкладка
      await service.leave(tab2, { boardId: BOARD_ID });

      // Assert: юзер офлайн, дельта leave эмитится ИМЕННО с уходящего сокета
      expect(await service.getOnlineUserIds(BOARD_ID)).toEqual([]);
      expect(toEmit2).toHaveBeenCalledWith('presence_leave', { userId: USER_ID });
    });
  });

  it('heartbeat обновляет score — member не протухает по истечении исходного порога', async () => {
    // Arrange
    const { service } = createService();
    const { socket } = fakeSocket(USER_ID, 'socket-1');
    await service.join(socket, { boardId: BOARD_ID });
    socket.rooms.add(BOARD_ROOM);

    // Act: почти на пороге — heartbeat продлевает жизнь члена
    jest.setSystemTime(ONLINE_THRESHOLD_MS - 5_000);
    await service.heartbeat(socket);

    // время снова почти у порога, но уже от обновлённого heartbeat-score
    jest.setSystemTime(ONLINE_THRESHOLD_MS - 5_000 + (ONLINE_THRESHOLD_MS - 5_000));

    // Assert
    expect(await service.getOnlineUserIds(BOARD_ID)).toEqual([USER_ID]);
  });

  it('протухший member (score старше порога) отсекается из списка и физически убирается', async () => {
    // Arrange
    const { service, redis } = createService();
    const { socket } = fakeSocket(USER_ID, 'socket-1');
    await service.join(socket, { boardId: BOARD_ID });

    // Act: 61с без heartbeat — за порогом офлайна
    jest.setSystemTime(ONLINE_THRESHOLD_MS + 1_000);
    const online = await service.getOnlineUserIds(BOARD_ID);

    // Assert
    expect(online).toEqual([]);
    expect(redis.membersOf(`presence:board:${BOARD_ID}`)).toEqual([]);
  });

  it('sweep убирает протухших членов и эмитит presence_leave через переданный server, если userId ушёл в офлайн', async () => {
    // Arrange
    const { service, redis } = createService();
    const { socket } = fakeSocket(USER_ID, 'socket-1');
    await service.join(socket, { boardId: BOARD_ID });

    const toEmit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit: toEmit });
    const server = { to } as unknown as AppServer;

    // Act
    jest.setSystemTime(ONLINE_THRESHOLD_MS + 1_000);
    await service.sweep(server, BOARD_ID);

    // Assert
    expect(redis.membersOf(`presence:board:${BOARD_ID}`)).toEqual([]);
    expect(to).toHaveBeenCalledWith(BOARD_ROOM);
    expect(toEmit).toHaveBeenCalledWith('presence_leave', { userId: USER_ID });
  });

  it('sweep не эмитит ничего, если протухших членов нет', async () => {
    // Arrange
    const { service } = createService();
    const { socket } = fakeSocket(USER_ID, 'socket-1');
    await service.join(socket, { boardId: BOARD_ID });

    const toEmit = jest.fn();
    const server = { to: jest.fn().mockReturnValue({ emit: toEmit }) } as unknown as AppServer;

    // Act: ещё в пределах порога
    await service.sweep(server, BOARD_ID);

    // Assert
    expect(toEmit).not.toHaveBeenCalled();
  });

  it('leaveAll убирает сокет со всех досок, в комнатах которых он состоит, и шлёт дельты по каждой', async () => {
    // Arrange
    const { service } = createService();
    const OTHER_BOARD_ID = '019fa5b1-0000-7000-8000-000000000002';
    const { socket, toEmit } = fakeSocket(USER_ID, 'socket-1');
    await service.join(socket, { boardId: BOARD_ID });
    await service.join(socket, { boardId: OTHER_BOARD_ID });
    socket.rooms.add(BOARD_ROOM);
    socket.rooms.add(`board:${OTHER_BOARD_ID}`);
    toEmit.mockClear(); // отсекаем presence_join от join выше — интересует только leaveAll

    // Act
    await service.leaveAll(socket);

    // Assert
    expect(await service.getOnlineUserIds(BOARD_ID)).toEqual([]);
    expect(await service.getOnlineUserIds(OTHER_BOARD_ID)).toEqual([]);
    expect(toEmit).toHaveBeenCalledWith('presence_leave', { userId: USER_ID });
    expect(toEmit).toHaveBeenCalledTimes(2);
  });

  it('разные userId на одной доске остаются независимы друг от друга', async () => {
    // Arrange
    const { service } = createService();
    const { socket: userSocket } = fakeSocket(USER_ID, 'socket-1');
    const { socket: otherSocket } = fakeSocket(OTHER_USER_ID, 'socket-2');

    // Act
    await service.join(userSocket, { boardId: BOARD_ID });
    await service.join(otherSocket, { boardId: BOARD_ID });

    // Assert
    const online = await service.getOnlineUserIds(BOARD_ID);
    expect(online).toHaveLength(2);
    expect(online).toEqual(expect.arrayContaining([USER_ID, OTHER_USER_ID]));
  });
});
