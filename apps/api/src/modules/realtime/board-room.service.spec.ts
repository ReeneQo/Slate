import type { BoardService } from '../board/board.service';
import { BoardRoomService } from './board-room.service';
import type { AppSocket } from './realtime.types';

/**
 * Юнит BoardRoomService изолирует ровно одно правило: «доступна доска этому userId → сокет входит
 * в её комнату и ack успешен; недоступна или payload не той формы → сокет НЕ входит и ack — отказ».
 *
 * Настоящих socket.io, БД и board-репозитория здесь нет: доступ подменяется моком `canAccess`
 * (его собственная корректность — забота board.service.spec), а сокет — заглушкой из трёх полей,
 * которых касается сервис: `data.userId` (кого пускаем), `join`/`leave` (что делаем с комнатой).
 * Тот же приём, что в ws-auth.middleware.spec: проверяем решение сервиса, а не транспорт под ним.
 */

const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const BOARD_ROOM = `board:${BOARD_ID}`;

/** Мок board-слоя: сервису нужен ровно один метод — булев `canAccess`. Типизирован, чтобы дрейф сигнатуры ронял компиляцию. */
function createDependencies() {
  const canAccess = jest.fn() as jest.MockedFunction<BoardService['canAccess']>;
  const boardService = { canAccess } as unknown as BoardService;

  return { service: new BoardRoomService(boardService), canAccess };
}

/** Заглушка сокета под то, что читает и вызывает сервис: userId в data, id для логов, join/leave. */
function fakeSocket() {
  const join = jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<AppSocket['join']>;
  const leave = jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<AppSocket['leave']>;
  const socket = { id: 'socket-1', data: { userId: USER_ID }, join, leave } as unknown as AppSocket;

  return { socket, join, leave };
}

describe('BoardRoomService', () => {
  describe('joinBoard', () => {
    it('вводит сокет в комнату доски и отвечает ack-успехом, когда доска доступна пользователю', async () => {
      // Arrange
      const { service, canAccess } = createDependencies();
      const { socket, join } = fakeSocket();
      canAccess.mockResolvedValue(true);

      // Act
      const result = await service.joinBoard(socket, { boardId: BOARD_ID });

      // Assert
      expect(canAccess).toHaveBeenCalledWith(BOARD_ID, USER_ID);
      expect(join).toHaveBeenCalledWith(BOARD_ROOM);
      expect(result).toEqual({ ok: true });
    });

    it('отклоняет вход в чужую или несуществующую доску, не трогая комнату', async () => {
      // Arrange: canAccess === false покрывает оба случая — доски нет ИЛИ она не этого юзера
      // (репозиторий их не различает, и наружу они одинаковы — симметрично HTTP 404).
      const { service, canAccess } = createDependencies();
      const { socket, join } = fakeSocket();
      canAccess.mockResolvedValue(false);

      // Act
      const result = await service.joinBoard(socket, { boardId: BOARD_ID });

      // Assert
      expect(join).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: false, reason: 'board_not_found' });
    });

    it('отклоняет вход при кривом payload, не спрашивая доступ и не трогая комнату', async () => {
      // Arrange: boardId не строка — недоверенный ввод не должен долететь до canAccess/Prisma.
      const { service, canAccess } = createDependencies();
      const { socket, join } = fakeSocket();

      // Act
      const result = await service.joinBoard(socket, { boardId: 42 });

      // Assert
      expect(canAccess).not.toHaveBeenCalled();
      expect(join).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: false, reason: 'board_not_found' });
    });
  });

  describe('leaveBoard', () => {
    it('выводит сокет из комнаты доски без проверки доступа', async () => {
      // Arrange: выход не авторизуется — canAccess вообще не участвует.
      const { service, canAccess } = createDependencies();
      const { socket, leave } = fakeSocket();

      // Act
      await service.leaveBoard(socket, { boardId: BOARD_ID });

      // Assert
      expect(leave).toHaveBeenCalledWith(BOARD_ROOM);
      expect(canAccess).not.toHaveBeenCalled();
    });

    it('игнорирует выход при кривом payload — комнату не трогает', async () => {
      // Arrange
      const { service } = createDependencies();
      const { socket, leave } = fakeSocket();

      // Act
      await service.leaveBoard(socket, undefined);

      // Assert
      expect(leave).not.toHaveBeenCalled();
    });
  });
});
