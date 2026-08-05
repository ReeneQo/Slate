import type { SessionGenerationService } from '../auth/sessions/session-generation.service';
import type { PresenceService } from './presence.service';
import { PresenceSweeperService } from './presence-sweeper.service';
import type { RealtimeGateway } from './realtime.gateway';
import type { AppSocket } from './realtime.types';

/**
 * Юнит PresenceSweeperService изолирует ровно логику тика: кого дёрнуть disconnect по расхождению
 * поколения и по каким доскам вызвать sweep. И `PresenceService`, и `SessionGenerationService`
 * подменены моками — их собственная корректность проверяется в своих файлах (presence.service.spec,
 * SLT-31 auth-тесты); здесь под проверкой только оркестрация тика.
 *
 * Таймер (`setInterval`) НЕ тестируется напрямую — `tick` вызывается вручную через `runTick`
 * (обходной путь к приватному методу класса), чтобы не гонять реальные/фейковые таймеры ради
 * содержимого одного прохода.
 */

const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const OTHER_BOARD_ID = '019fa5b1-0000-7000-8000-000000000002';
const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';

function fakeSocket(userId: string, socketId: string, sessionGen: number, rooms: string[]) {
  const disconnect = jest.fn();
  const socket = {
    id: socketId,
    data: { userId, sessionGen },
    rooms: new Set(rooms),
    disconnect,
  } as unknown as AppSocket;

  return { socket, disconnect };
}

function createSweeper(sockets: AppSocket[]) {
  const gateway = {
    server: { sockets: { sockets: new Map(sockets.map((s) => [s.id, s])) } },
  } as unknown as RealtimeGateway;

  const sweep = jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<
    PresenceService['sweep']
  >;
  const presenceService = { sweep } as unknown as PresenceService;

  const getCurrent = jest.fn() as jest.MockedFunction<SessionGenerationService['getCurrent']>;
  const sessionGeneration = { getCurrent } as unknown as SessionGenerationService;

  const sweeper = new PresenceSweeperService(gateway, presenceService, sessionGeneration);

  return { sweeper, sweep, getCurrent };
}

/** Приватный `tick` дёрнут через приведение к `any` — умышленно: у метода нет причин быть публичным. */
function runTick(sweeper: PresenceSweeperService): Promise<void> {
  return (sweeper as unknown as { tick: () => Promise<void> }).tick();
}

describe('PresenceSweeperService', () => {
  it('рвёт сокет с устаревшим поколением сессии (logout-everywhere) и не трогает актуальные', async () => {
    // Arrange: stale — снимок 1, актуальное поколение 2 (был logout-all); fresh — снимки совпадают.
    const { socket: stale, disconnect: staleDisconnect } = fakeSocket(USER_ID, 'stale', 1, []);
    const { socket: fresh, disconnect: freshDisconnect } = fakeSocket('other-user', 'fresh', 0, []);
    const { sweeper, getCurrent } = createSweeper([stale, fresh]);
    getCurrent.mockImplementation((userId: string) => Promise.resolve(userId === USER_ID ? 2 : 0));

    // Act
    await runTick(sweeper);

    // Assert
    expect(staleDisconnect).toHaveBeenCalledWith(true);
    expect(freshDisconnect).not.toHaveBeenCalled();
  });

  it('не рвёт сокет, чьё поколение совпадает с актуальным', async () => {
    // Arrange
    const { socket, disconnect } = fakeSocket(USER_ID, 'socket-1', 0, []);
    const { sweeper, getCurrent } = createSweeper([socket]);
    getCurrent.mockResolvedValue(0);

    // Act
    await runTick(sweeper);

    // Assert
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('вызывает sweep по каждой уникальной доске, в комнатах которых состоят сокеты инстанса', async () => {
    // Arrange: два сокета на одной доске (дедуп) + один на другой.
    const { socket: s1 } = fakeSocket(USER_ID, 'socket-1', 0, [`board:${BOARD_ID}`]);
    const { socket: s2 } = fakeSocket('other-user', 'socket-2', 0, [`board:${BOARD_ID}`]);
    const { socket: s3 } = fakeSocket('third-user', 'socket-3', 0, [`board:${OTHER_BOARD_ID}`]);
    const { sweeper, sweep, getCurrent } = createSweeper([s1, s2, s3]);
    getCurrent.mockResolvedValue(0);

    // Act
    await runTick(sweeper);

    // Assert
    expect(sweep).toHaveBeenCalledTimes(2);
    const sweptBoardIds = sweep.mock.calls.map(([, boardId]) => boardId).sort();
    expect(sweptBoardIds).toEqual([BOARD_ID, OTHER_BOARD_ID].sort());
  });

  it('не вызывает sweep, если ни у одного сокета инстанса нет board-комнат', async () => {
    // Arrange
    const { socket } = fakeSocket(USER_ID, 'socket-1', 0, []);
    const { sweeper, sweep, getCurrent } = createSweeper([socket]);
    getCurrent.mockResolvedValue(0);

    // Act
    await runTick(sweeper);

    // Assert
    expect(sweep).not.toHaveBeenCalled();
  });
});
