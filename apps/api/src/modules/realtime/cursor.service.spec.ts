import { CursorService } from './cursor.service';
import type { AppSocket } from './realtime.types';

/**
 * Юнит CursorService изолирует ровно то, что решает сам сервис: relay курсора остальным членам
 * комнаты, серверный throttle-дроп сверх потолка, отсев неверной формы координат. Redis и
 * настоящего socket.io здесь нет — только заглушка сокета из тех полей, которых касается сервис
 * (`data`, `rooms`, `to`), тем же приёмом, что в presence.service.spec/board-room.service.spec.
 *
 * `Date.now()` управляется `jest.useFakeTimers` — throttle не может зависеть от реального времени
 * выполнения теста.
 */

const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const BOARD_ROOM = `board:${BOARD_ID}`;

/** Заглушка сокета: userId в data, rooms — комнаты досок, to/emit — то, что делает CursorService. */
function fakeSocket(userId: string, socketId: string, rooms: string[] = [BOARD_ROOM]) {
  const toEmit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit: toEmit });
  const socket = {
    id: socketId,
    data: { userId, sessionGen: 0 },
    rooms: new Set(rooms),
    to,
  } as unknown as AppSocket;

  return { socket, to, toEmit };
}

describe('CursorService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('cursor_move', () => {
    it('ретранслирует координаты с userId отправителя другим членам комнаты, не эхо себе', () => {
      // Arrange
      const service = new CursorService();
      const { socket, to, toEmit } = fakeSocket(USER_ID, 'socket-1');

      // Act
      service.handleCursorMove(socket, { x: 12, y: -34 });

      // Assert: relay ИМЕННО через socket.to (не server.in) — эхо отправителю не нужно.
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(toEmit).toHaveBeenCalledWith('cursor_move', { userId: USER_ID, x: 12, y: -34 });
    });

    it('дропает события сверх потолка ~40/сек, не ретранслируя их', () => {
      // Arrange: потолок — 25мс между принятыми событиями (1000/40)
      const service = new CursorService();
      const { socket, toEmit } = fakeSocket(USER_ID, 'socket-1');

      // Act: первое принято, следующие два сразу же — раньше потолка, третье — после
      service.handleCursorMove(socket, { x: 0, y: 0 });
      jest.setSystemTime(10);
      service.handleCursorMove(socket, { x: 1, y: 1 });
      jest.setSystemTime(20);
      service.handleCursorMove(socket, { x: 2, y: 2 });
      jest.setSystemTime(30);
      service.handleCursorMove(socket, { x: 3, y: 3 });

      // Assert: из 4 вызовов за 30мс при потолке 25мс прошло не больше 2, первый — без изменений
      expect(toEmit.mock.calls.length).toBeLessThanOrEqual(2);
      expect(toEmit).toHaveBeenCalledWith('cursor_move', { userId: USER_ID, x: 0, y: 0 });
    });

    it('пропускает события после того, как между ними прошло больше порога throttle', () => {
      // Arrange
      const service = new CursorService();
      const { socket, toEmit } = fakeSocket(USER_ID, 'socket-1');

      // Act
      service.handleCursorMove(socket, { x: 0, y: 0 });
      jest.setSystemTime(30); // больше 25мс — не дропается
      service.handleCursorMove(socket, { x: 5, y: 5 });

      // Assert
      expect(toEmit).toHaveBeenCalledTimes(2);
      expect(toEmit).toHaveBeenNthCalledWith(2, 'cursor_move', { userId: USER_ID, x: 5, y: 5 });
    });

    it.each([
      ['NaN', { x: NaN, y: 0 }],
      ['Infinity', { x: 0, y: Infinity }],
      ['не число', { x: '1', y: 2 }],
      ['нет полей', {}],
    ])(
      'молча дропает payload с некорректными координатами (%s), не ретранслируя',
      (_label, payload) => {
        // Arrange
        const service = new CursorService();
        const { socket, toEmit } = fakeSocket(USER_ID, 'socket-1');

        // Act
        service.handleCursorMove(socket, payload);

        // Assert
        expect(toEmit).not.toHaveBeenCalled();
      },
    );

    it('ретранслирует во все комнаты досок, в которых сокет состоит', () => {
      // Arrange
      const OTHER_BOARD_ROOM = 'board:019fa5b1-0000-7000-8000-000000000002';
      const service = new CursorService();
      const { socket, to } = fakeSocket(USER_ID, 'socket-1', [BOARD_ROOM, OTHER_BOARD_ROOM]);

      // Act
      service.handleCursorMove(socket, { x: 1, y: 1 });

      // Assert
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(to).toHaveBeenCalledWith(OTHER_BOARD_ROOM);
    });
  });

  describe('cursor_leave', () => {
    it('ретранслирует уход курсора остальным членам комнаты с userId, без throttle и валидации', () => {
      // Arrange
      const service = new CursorService();
      const { socket, to, toEmit } = fakeSocket(USER_ID, 'socket-1');

      // Act
      service.handleCursorLeave(socket);

      // Assert
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(toEmit).toHaveBeenCalledWith('cursor_leave', { userId: USER_ID });
    });

    it('не троттлится — подряд идущие cursor_leave ретранслируются все', () => {
      // Arrange
      const service = new CursorService();
      const { socket, toEmit } = fakeSocket(USER_ID, 'socket-1');

      // Act
      service.handleCursorLeave(socket);
      service.handleCursorLeave(socket);

      // Assert
      expect(toEmit).toHaveBeenCalledTimes(2);
    });
  });
});
