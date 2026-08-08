import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { type ElementListItemDto, toElementListItemDto } from '../element/dto/element.dto';
import type { AccessLevel } from './board.access';
import { BoardRepository } from './board.repository';
import { type BoardDto, toBoardDto } from './dto/board.dto';
import type { CreateBoardDto } from './dto/create-board.dto';
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

  /**
   * Уровень доступа пользователя к доске — единая точка входа для ВСЕХ потребителей вне
   * board-модуля (SLT-41, замена булевой `canAccess` из SLT-19).
   *
   * Возвращает не «да/нет», а РОЛЬ: `null` (доступа нет) | `'viewer'` | `'editor'` | `'owner'`.
   * Раньше здесь напрашивались бы ДВА метода — булев `canAccess` для доступа и отдельный
   * `getRole` для роли, — и вызывающему, которому нужна роль (проверка перед мутацией),
   * пришлось бы ходить в БД дважды. Здесь один запрос отвечает на оба вопроса сразу: «пускать»
   * решает `access !== null`, «пускать ли писать» — `canWrite(access)` (board.access.ts).
   *
   * Единственный вход для ДРУГИХ модулей: element-модуль читает и пишет доступ ИМЕННО отсюда,
   * WebSocket-шлюз (SLT-33) авторизует `join_board` тем же вызовом. `NotFoundException` здесь
   * не бросается — это транспорт-нейтральное ядро, а не HTTP-хелпер: HTTP-контроллеры и
   * WS-обработчики сами решают, во что превратить `null`/`'viewer'` (404, 403 или доменный
   * reject-ack), — см. `boardNotFound`/`forbiddenWrite` и их использование в ElementService.
   *
   * Наружу отдан сервис, а не репозиторий (см. board.module): так у других модулей нет способа
   * дотянуться до данных доски мимо правил доступа.
   */
  getAccess(boardId: string, userId: string): Promise<AccessLevel> {
    return this.boardRepository.getAccessLevel(boardId, userId);
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
  async findElements(boardId: string, userId: string): Promise<ElementListItemDto[]> {
    const elements = await this.boardRepository.findElements(boardId, userId);

    if (elements === null) {
      throw boardNotFound();
    }

    return elements.map((element) => toElementListItemDto(element));
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
 *
 * Экспортируется ради ОДНОГО случая: вставка элемента в доску, которую удалили между проверкой
 * доступа и записью. Отказ там про доску, а не про элемент, и текст обязан совпасть с этим —
 * иначе клиент по одному сценарию узнаёт «доски нет», а по другому «элемент не найден», хотя
 * событие одно. Своя копия строки в element-модуле разошлась бы с этой при первой же правке.
 */
export function boardNotFound(): NotFoundException {
  return new NotFoundException('Доска не найдена');
}

/**
 * 403 на мутацию от участника с ролью `viewer` (SLT-41, решение 3).
 *
 * Осознанно ОТДЕЛЬНЫЙ статус от `boardNotFound` (404), а не тот же самый. 404-политика этого
 * модуля прячет СУЩЕСТВОВАНИЕ ресурса от постороннего — а viewer не посторонний: доска (и
 * элементы на ней) ему открыто видны на чтение, `getAccess` уже вернул не-null. Скрывать факт
 * существования ресурса, который сам же отдаёшь на GET той же сессии, было бы не защитой, а
 * бессмысленной несогласованностью ответов. 403 здесь ничего не раскрывает: viewer и так знает,
 * что доска существует, — статус лишь называет настоящую причину отказа (недостаточно роли), а
 * не притворяется, что ресурса нет.
 *
 * Один текст на все причины отказа записи (viewer на доске, viewer в WS-комнате) — по тому же
 * принципу, что у `boardNotFound`: причина не должна разъезжаться по формулировкам в разных
 * местах кода, которые однажды разойдутся.
 */
export function forbiddenWrite(): ForbiddenException {
  return new ForbiddenException('Недостаточно прав для изменения');
}
