import { Injectable, Logger } from '@nestjs/common';

import { BoardService } from '../board/board.service';
import { type AppSocket, type BoardJoinResult, boardRoom, extractBoardId } from './realtime.types';

/**
 * Членство сокета в комнатах досок (SLT-33): вход с проверкой доступа и выход.
 *
 * Логика комнат живёт ЗДЕСЬ, а не в gateway, ровно по той же причине, по какой бизнес-логика
 * живёт в сервисе, а не в контроллере: gateway — тонкий транспорт (принял событие → делегировал),
 * а «можно ли войти и что при этом сделать с сокетом» — правило, и у правила одно место. Поэтому
 * и зависимость от board-слоя (`BoardService.canAccess`) инжектится сюда, а не в gateway.
 *
 * Модель членства — только комнаты socket.io плюс `userId` на сокете (из ws-auth, SLT-32). Своего
 * реестра `room → Set<userId>` здесь НЕТ: агрегация «кто онлайн на доске» — территория presence
 * (3.2). «Несколько вкладок одного юзера» тут сводится к корректности per-socket: каждый сокет
 * входит и выходит из комнаты сам по себе, и закрытие одной вкладки не трогает комнату второй —
 * это socket.io делает без нашего участия.
 */
@Injectable()
export class BoardRoomService {
  private readonly logger = new Logger(BoardRoomService.name);

  constructor(private readonly boardService: BoardService) {}

  /**
   * Ввести сокет в комнату доски, если она доступна его пользователю.
   *
   * Доступ — тот же инвариант, что на HTTP: `BoardService.canAccess` (булево ядро поверх
   * access-scope репозитория). Отказ выражен доменной причиной, а не HTTP-статусом — 404 в
   * реалтайме не к месту, — и едет назад ack'ом; `board_not_found` намеренно не различает «нет
   * доски» и «не твоя» (симметрично boardNotFound на HTTP).
   *
   * `payload` приходит с провода недоверенным, поэтому boardId извлекается и проверяется как
   * непустая строка ДО запроса в БД (см. extractBoardId): не-строка улетела бы в Prisma-`where`
   * и уронила бы обработчик валидатором ORM мимо ack-канала вместо честного отказа. Кривой
   * payload не ссылается ни на какую доступную доску — тот же `board_not_found`, отдельной
   * причины для «плохого ввода» нет сознательно (иначе клиент по коду отказа отличал бы форму
   * ввода — та же утечка, что скрывает единый 404).
   */
  async joinBoard(socket: AppSocket, payload: unknown): Promise<BoardJoinResult> {
    const boardId = extractBoardId(payload);
    const { userId } = socket.data;

    if (boardId === null || !(await this.boardService.canAccess(boardId, userId))) {
      this.logger.debug(`WS join denied: user=${userId} socket=${socket.id}`);
      return { ok: false, reason: 'board_not_found' };
    }

    await socket.join(boardRoom(boardId));
    this.logger.debug(`WS joined board: user=${userId} board=${boardId} socket=${socket.id}`);

    return { ok: true };
  }

  /**
   * Вывести сокет из комнаты доски. Проверять нечего: выход — отказ от рассылки, а не доступ к
   * данным, и он идемпотентен (`leave` по чужой/несуществующей комнате — no-op). Поэтому ни
   * проверки доступа, ни ack: подтверждать нечего. Кривой payload просто не совпадёт ни с одной
   * реальной комнатой — тихо выходим ни из чего.
   */
  async leaveBoard(socket: AppSocket, payload: unknown): Promise<void> {
    const boardId = extractBoardId(payload);

    if (boardId === null) {
      return;
    }

    await socket.leave(boardRoom(boardId));
    this.logger.debug(
      `WS left board: user=${socket.data.userId} board=${boardId} socket=${socket.id}`,
    );
  }
}
