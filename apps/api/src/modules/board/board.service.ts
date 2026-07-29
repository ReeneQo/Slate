import { Injectable, NotFoundException } from '@nestjs/common';

import { BoardRepository } from './board.repository';
import { type BoardDto, toBoardDto } from './dto/board.dto';
import type { CreateBoardDto } from './dto/create-board.dto';
import { type ElementDto, toElementDto } from './dto/element.dto';
import type { UpdateBoardDto } from './dto/update-board.dto';

/**
 * Бизнес-логика доски. PrismaService не инжектит и не импортирует — в БД ходит только через
 * BoardRepository.
 *
 * Ответственность слоя ровно две: превратить «репозиторий ничего не нашёл» в ответ клиенту и
 * смапить сущность в DTO. Обе решаются здесь, а не в контроллере, потому что от транспорта не
 * зависят: тот же сценарий из WebSocket-хендлера (этап 3) или из CLI-скрипта должен вести
 * себя одинаково.
 *
 * `userId` в каждом методе — не «контекст запроса», а часть условия выборки. Сервис не
 * спрашивает «кто это?», он получает идентификатор от контроллера, который берёт его из сессии.
 */
@Injectable()
export class BoardService {
  constructor(private readonly boardRepository: BoardRepository) {}

  /**
   * Владелец — переданный `userId`, и другого источника у него нет. `dto` даёт только title:
   * в CreateBoardDto поля `ownerId` не существует, поэтому подменить владельца телом запроса
   * нельзя даже теоретически (а глобальный `whitelist: true` срежет его ещё на входе).
   */
  async create(userId: string, dto: CreateBoardDto): Promise<BoardDto> {
    const board = await this.boardRepository.create({ ownerId: userId, title: dto.title });

    return toBoardDto(board);
  }

  /** «Мои доски»: только принадлежащие пользователю, без элементов и без счётчиков. */
  async findAllOwned(userId: string): Promise<BoardDto[]> {
    const boards = await this.boardRepository.findAllOwnedBy(userId);

    return boards.map((board) => toBoardDto(board));
  }

  /** @throws {NotFoundException} доска не существует ИЛИ принадлежит другому пользователю */
  async findOne(boardId: string, userId: string): Promise<BoardDto> {
    const board = await this.boardRepository.findAccessible(boardId, userId);

    if (board === null) {
      throw boardNotFound();
    }

    return toBoardDto(board);
  }

  /**
   * Содержимое холста — живые элементы доски.
   *
   * `null` от репозитория означает «доски нет в моей области видимости» и превращается в 404;
   * пустая доска — это `[]`. Разница существенна для клиента: в первом случае он уходит с
   * экрана доски, во втором рисует пустой холст.
   *
   * @throws {NotFoundException} доска не существует ИЛИ принадлежит другому пользователю
   */
  async findElements(boardId: string, userId: string): Promise<ElementDto[]> {
    const elements = await this.boardRepository.findElements(boardId, userId);

    if (elements === null) {
      throw boardNotFound();
    }

    return elements.map((element) => toElementDto(element));
  }

  /** @throws {NotFoundException} доска не существует ИЛИ принадлежит другому пользователю */
  async update(boardId: string, userId: string, dto: UpdateBoardDto): Promise<BoardDto> {
    const board = await this.boardRepository.updateAccessible(boardId, userId, {
      title: dto.title,
    });

    if (board === null) {
      throw boardNotFound();
    }

    return toBoardDto(board);
  }

  /** @throws {NotFoundException} доска не существует ИЛИ принадлежит другому пользователю */
  async remove(boardId: string, userId: string): Promise<void> {
    const isDeleted = await this.boardRepository.deleteAccessible(boardId, userId);

    if (!isDeleted) {
      throw boardNotFound();
    }
  }
}

/**
 * 404, а НЕ 403 — на чужую доску тоже.
 *
 * 403 означает «ресурс существует, но тебе нельзя», то есть сам статус подтверждает
 * существование доски. Перебирая id, посторонний отличал бы занятые идентификаторы от
 * свободных: 403 — доска есть, 404 — нет. Это утечка, пусть и небольшая: она выдаёт факт
 * работы над проектом, объём чужих данных, а вместе с уязвимостью где-то ещё — готовый список
 * целей. Модель Slate: чужая доска для меня НЕ СУЩЕСТВУЕТ.
 *
 * Отсюда же общая фабрика вместо `throw new NotFoundException(...)` по месту. Различие между
 * «не существует» и «не твоя» не должно просочиться в текст сообщения: два разных текста
 * раскрывают ровно то, что скрывает одинаковый статус. Единственная формулировка делает такую
 * утечку невозможной, а не «маловероятной».
 *
 * Это паттерн на весь блок 3: element-модуль (SLT-20) наследует его — доступ к элементу
 * определяется доступом к его доске, и отказ выглядит так же.
 */
function boardNotFound(): NotFoundException {
  return new NotFoundException('Доска не найдена');
}
