import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ElementType } from '@slate/database';
import { type ElementData, parseElementData, type PatchElementInput } from '@slate/shared-types';

import { canWrite } from '../board/board.access';
import { boardNotFound, BoardService, forbiddenWrite } from '../board/board.service';
import { type ElementDto, toElementDto } from './dto/element.dto';
import type { PatchElementDto } from './dto/patch-element.dto';
import type { UpsertElementDto } from './dto/upsert-element.dto';
import {
  ElementRepository,
  type PatchElementData,
  type ReplaceElementData,
} from './element.repository';
import type { ElementEntity } from './entities/element.entity';

/**
 * Результат upsert'а. Флаг нужен ровно одному месту — контроллеру, который выбирает между 201
 * и 200. В DTO ему делать нечего: это свойство ОПЕРАЦИИ, а не элемента, и в теле ответа оно
 * стало бы полем, которое клиент обязан читать, чтобы узнать то же, что уже сказал статус.
 */
export interface UpsertElementResult {
  element: ElementDto;
  isCreated: boolean;
}

/**
 * Исход версионированного PATCH (SLT-38, `ElementService.patchVersioned`). Формой похож на
 * `CreateElementOutcome` репозитория: конечный набор случаев решает вызывающий, а не try/catch
 * по HTTP-исключениям — реалтайм-слой их не бросает (см. докстринг `patchVersioned`).
 *
 * `forbidden` (SLT-41) — доступ к доске есть, но роль `viewer`: пишет только `editor`/`owner`
 * (см. `canWrite`, board.access.ts). Отдельный от `not_found` случай осознанно: viewer не
 * посторонний — доска ему видна на чтение, и подменять недостаточность роли на «доски нет»
 * значило бы врать про причину отказа тому, кто и так знает, что доска существует.
 */
export type VersionedPatchOutcome =
  | { status: 'applied'; element: ElementEntity }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'invalid_payload' }
  | { status: 'version_conflict'; element: ElementEntity };

/** Исход версионированного DELETE (SLT-38, `ElementService.removeVersioned`). См. `VersionedPatchOutcome`. */
export type VersionedRemovalOutcome =
  | { status: 'applied'; id: string; version: number }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'version_conflict'; element: ElementEntity };

/**
 * Причина, по которой ОДИН элемент батч-мутации (SLT-68) не применился, БЕЗ `version_conflict` —
 * та несёт актуальный элемент и разбирается отдельно (см. `BatchConflictEntry`). Подмножество
 * статусов `VersionedPatchOutcome`/`VersionedRemovalOutcome`, кроме `applied`.
 */
export type BatchItemFailureKind = 'not_found' | 'forbidden' | 'invalid_payload';

/**
 * Запись конфликта в батче — ОДНА корзина на все причины отказа отдельного элемента (Р2,
 * зафиксировано на точке сверки SLT-68), а не четыре отдельных списка: с точки зрения вызывающего
 * (ElementSyncService) все они означают одно — «этот элемент не применился», `element` есть только
 * у `version_conflict`, потому что только там его есть смысл прикладывать (LWW).
 */
export type BatchConflictEntry =
  | { id: string; kind: 'version_conflict'; element: ElementEntity }
  | { id: string; kind: BatchItemFailureKind };

/** Исход батч-PATCH (`ElementService.batchPatchVersioned`, SLT-68). Поэлементный успех — не all-or-nothing. */
export interface BatchPatchResult {
  applied: ElementEntity[];
  conflicts: BatchConflictEntry[];
}

/** Исход батч-DELETE (`ElementService.batchRemoveVersioned`, SLT-68). См. `BatchPatchResult`. */
export interface BatchRemovalResult {
  applied: { id: string; version: number }[];
  conflicts: BatchConflictEntry[];
}

/**
 * Бизнес-логика элемента холста. PrismaService не инжектит и не импортирует — в БД ходит
 * только через ElementRepository. Про `deletedAt` тоже не знает: мягкое удаление целиком
 * закрыто слоем данных, здесь оно видно лишь как слово «воскресить» в названии сценария.
 *
 * Проверка ДОСТУПА (видно ли мне вообще этот элемент) устроена двумя разными способами:
 *
 * 1. Мутации СУЩЕСТВУЮЩЕГО элемента (замена, PATCH, удаление) несут scope доски прямо в своём
 *    `where` — отдельной проверки нет и быть не должно, иначе появится окно между «можно» и
 *    «пишем».
 * 2. ВСТАВКА нового элемента — единственный случай, где сузить запрос нечем: строки ещё не
 *    существует. Здесь доступ спрашивается заранее, через `boardService.getAccess`.
 *
 * Оба способа опираются на ОДНО определение доступа (`accessibleBoardScope`/`accessibleElementScope`,
 * SLT-19, расширено SLT-41), а не на две независимые проверки.
 *
 * Проверка РОЛИ (SLT-41: хватает ли её, чтобы ПИСАТЬ) — поверх этого, отдельным шагом, и только
 * там, где операция — запись: `createElement`/replace-ветка `upsertEntity` зовут
 * `boardService.getAccess`+`canWrite` (boardId уже под рукой), `patch`/`remove` — через
 * `assertCanWriteElement` (elementId под рукой, boardId ещё нет), `patchVersioned`/`removeVersioned` —
 * тот же `elementRepository.getAccessLevel`+`canWrite`, но без исключений (см. их докстринги).
 * Читающие сценарии (`findAccessible`, geometry-чтения) роль не спрашивают вовсе — viewer читает
 * наравне с editor'ом.
 */
@Injectable()
export class ElementService {
  constructor(
    private readonly elementRepository: ElementRepository,
    private readonly boardService: BoardService,
  ) {}

  /**
   * `PUT /elements/:id` — создать, заменить или воскресить элемент по клиентскому id.
   *
   * Почему один эндпоинт на три исхода. Холст рисует фигуру немедленно и не ждёт сервер:
   * идентификатор существует ДО первой записи (uuid v7 на клиенте, SLT-13), а autosave
   * повторяет запрос при каждом изменении и при каждом восстановлении связи. Клиент в этот
   * момент не знает и не должен знать, дошла ли предыдущая попытка, — значит запрос обязан быть
   * идемпотентным по состоянию: «пусть элемент :id выглядит вот так». Раздельные POST и PUT
   * заставили бы клиента вести учёт того, что уже сохранено, и этот учёт разошёлся бы с
   * реальностью при первом же обрыве связи.
   *
   * Порядок шагов не случаен: сначала геометрия (чистая проверка, без обращения к БД), потом
   * поиск строки, и только затем запись — невалидный запрос не должен доходить до базы.
   *
   * Свобода замены не абсолютна: `boardId` и `type` — инварианты элемента, и при замене они
   * обязаны совпасть с хранимыми (см. ветки ниже). Проверять их можно даром — строку всё равно
   * читаем, чтобы понять, создавать или заменять.
   *
   * @throws {BadRequestException} `data` не соответствует `type`
   * @throws {NotFoundException} доска недоступна, не существует, либо элемент исчез в процессе
   * @throws {ConflictException} id занят элементом другой доски или фигурой другого типа
   */
  async upsert(
    elementId: string,
    userId: string,
    dto: UpsertElementDto,
  ): Promise<UpsertElementResult> {
    const { element, isCreated } = await this.upsertEntity(elementId, userId, dto);

    return { element: toElementDto(element), isCreated };
  }

  /**
   * То же самое, что `upsert`, но отдаёт СЫРУЮ сущность вместо HTTP DTO.
   *
   * Единственная причина существования метода рядом с `upsert` — version. WS-каналу мутаций
   * (SLT-38, `element_create`) она нужна для ack и broadcast, а HTTP-контракт её сознательно не
   * показывает (см. ELEMENT_SELECT / toElementDto). Вся бизнес-логика — целиком здесь, ОДНА
   * точка на оба входа; `upsert` — тонкая обёртка, которая просто мапит результат в DTO для
   * HTTP-ответа. Поведение и исключения HTTP-пути не меняются ни на бит: это чистый вынос кода,
   * а не новая ветка.
   */
  async upsertEntity(
    elementId: string,
    userId: string,
    dto: UpsertElementDto,
  ): Promise<{ element: ElementEntity; isCreated: boolean }> {
    const shape = toElementShape(dto, this.parseData(dto.type, dto.data));
    const existing = await this.elementRepository.findInvariantsIncludingDeleted(elementId, userId);

    if (existing === null) {
      return this.createElement(elementId, userId, dto.boardId, shape);
    }

    // Ветка замены — а замена (и воскрешение) есть ЗАПИСЬ, значит нужна роль ≥ editor (SLT-41),
    // не просто доступ. `existing` найден под accessibleElementScope (viewer тоже проходит,
    // scope читательский), поэтому здесь нужна ОТДЕЛЬНАЯ проверка роли — `findInvariantsIncludingDeleted`
    // её не даёт. `boardService.getAccess`, а не `elementRepository.getAccessLevel`: у нас уже есть
    // `existing.boardId` из этого же чтения, второй поход через элемент был бы лишним.
    const access = await this.boardService.getAccess(existing.boardId, userId);

    if (!canWrite(access)) {
      // access === null теоретически недостижимо (existing уже прошёл accessibleElementScope на
      // той же доске), но это не тот инвариант, на который стоит полагаться молча — на границе
      // ролевой проверки отказ формулируется явно, а не оставляется падать на undefined.
      throw access === null ? elementNotFound() : forbiddenWrite();
    }

    // Дальше — инварианты элемента. Оба сравнения бесплатны: строка уже прочитана тем же
    // запросом, который решил «создавать или заменять».

    // Элемент есть, но лежит на ДРУГОЙ моей доске. Перемещение между досками не реализуем
    // (граница SLT-20), а молча записать его в присланную доску нельзя — это и было бы
    // перемещением. 409: конфликт состояния, а не ошибка запроса.
    if (existing.boardId !== dto.boardId) {
      throw elementIdTaken();
    }

    // Природа элемента задаётся при создании и не меняется: под этим id уже лежит фигура
    // другого типа. Проверка живёт ЗДЕСЬ, а не в DTO, потому что нарушение видно только рядом
    // с состоянием — тело запроса само по себе безупречно (`type` и `data` согласованы).
    if (existing.type !== dto.type) {
      throw elementTypeChanged();
    }

    const element = await this.elementRepository.replaceAccessible(elementId, userId, shape);

    // null означает, что строка исчезла между поиском и записью. Ответ тот же, что и на
    // «элемента нет», потому что для клиента это и есть «нет».
    if (element === null) {
      throw elementNotFound();
    }

    return { element, isCreated: false };
  }

  /**
   * Версионированное частичное обновление (WS `element_update`, SLT-38): то же правило, что у
   * `patch`, плюс оптимистическая блокировка — и, в отличие от `patch`, отдаёт ИСХОД, а не
   * бросает HTTP-исключения. Реалтайм-слой не работает с NestJS-статусами: отказ едет назад
   * ack-callback'ом с доменной причиной (см. RealtimeGateway/ElementSyncService), а не как
   * `NotFoundException`/`BadRequestException` — тот же принцип, что развёл бросающие HTTP-хелперы
   * и транспорт-нейтральный `boardService.getAccess` у доски.
   *
   * `version_conflict` несёт АКТУАЛЬНЫЙ элемент — не потому что репозиторий его вернул (при
   * несовпадении version `patchAccessibleVersioned` отдаёт `null`, теряя строку), а отдельным
   * чтением ПОСЛЕ отказа: клиенту (SLT-40) нужно свежее состояние для refetch-and-reapply без
   * лишнего round-trip'а. Отдельным запросом также различаются «элемента нет вовсе» и «версия
   * устарела» — на уровне самого conditional update это одно и то же P2025/`null`.
   */
  async patchVersioned(
    elementId: string,
    userId: string,
    changes: PatchElementInput,
    expectedVersion: number,
  ): Promise<VersionedPatchOutcome> {
    const patchChanges = toPatchChanges(changes);
    const hasGeometryChange = changes.data !== undefined;

    if (!hasGeometryChange && !hasAnyChange(patchChanges)) {
      return { status: 'invalid_payload' };
    }

    // Роль ≥ editor (SLT-41) — до любого чтения/записи геометрии: viewer'у нет смысла тратить
    // ещё один round-trip на данные, которые он всё равно не сможет записать.
    const access = await this.elementRepository.getAccessLevel(elementId, userId);

    if (access === null) {
      return { status: 'not_found' };
    }

    if (!canWrite(access)) {
      return { status: 'forbidden' };
    }

    let geometry: ElementData | undefined;

    if (hasGeometryChange) {
      const stored = await this.elementRepository.findAccessible(elementId, userId);

      if (stored === null) {
        return { status: 'not_found' };
      }

      const result = parseElementData(stored.type, changes.data);

      if (!result.isValid) {
        return { status: 'invalid_payload' };
      }

      geometry = result.data;
    }

    const element = await this.elementRepository.patchAccessibleVersioned(
      elementId,
      userId,
      expectedVersion,
      { ...patchChanges, ...(geometry === undefined ? {} : { data: geometry }) },
    );

    if (element !== null) {
      return { status: 'applied', element };
    }

    const current = await this.elementRepository.findAccessible(elementId, userId);

    return current === null
      ? { status: 'not_found' }
      : { status: 'version_conflict', element: current };
  }

  /**
   * Версионированное мягкое удаление (WS `element_delete`, SLT-38). Тот же исходный принцип,
   * что у `patchVersioned`: исход вместо исключения, актуальный элемент в `version_conflict` —
   * отдельным чтением после отказа.
   */
  async removeVersioned(
    elementId: string,
    userId: string,
    expectedVersion: number,
  ): Promise<VersionedRemovalOutcome> {
    // Роль ≥ editor (SLT-41) — та же проверка и в том же месте, что у patchVersioned.
    const access = await this.elementRepository.getAccessLevel(elementId, userId);

    if (access === null) {
      return { status: 'not_found' };
    }

    if (!canWrite(access)) {
      return { status: 'forbidden' };
    }

    const removed = await this.elementRepository.softDeleteAccessibleVersioned(
      elementId,
      userId,
      expectedVersion,
    );

    if (removed !== null) {
      return { status: 'applied', id: removed.id, version: removed.version };
    }

    const current = await this.elementRepository.findAccessible(elementId, userId);

    return current === null
      ? { status: 'not_found' }
      : { status: 'version_conflict', element: current };
  }

  /**
   * Батч-версия `patchVersioned` (WS `element_batch_update`, SLT-68) — переиспользует ЕЁ целиком,
   * по одному вызову на элемент, а НЕ заводит вторую бизнес-логику рядом (роль, geometry-парсинг,
   * conditional update — всё то же самое, что у одиночного PATCH).
   *
   * ПОЭЛЕМЕНТНЫЙ УСПЕХ, не `$transaction` (Р2/Р3, зафиксировано на точке сверки SLT-68):
   * `Promise.all` НЕЗАВИСИМЫХ вызовов. Каждый элемент уже атомарен на уровне СВОЕЙ
   * conditional-update-инструкции (`patchAccessibleVersioned` — одна SQL-инструкция
   * `UPDATE...WHERE id=? AND version=?`, см. её докстринг в ElementRepository); элементы батча
   * адресуются РАЗНЫМИ id — разными строками, гонок между ними нет и быть не может. Обернуть это в
   * `prisma.$transaction` было бы неверно: транзакция в этом проекте (см. `OAuthService.loginOAuth`,
   * единственный прецедент) значит «всё или ничего», а конфликт версии ОДНОГО элемента обязан
   * применить/отклонить только его, не откатывая остальные N-1, — прямо противоположная гарантия.
   */
  async batchPatchVersioned(
    userId: string,
    items: { id: string; version: number; changes: PatchElementInput }[],
  ): Promise<BatchPatchResult> {
    const outcomes = await Promise.all(
      items.map(async (item) => ({
        id: item.id,
        outcome: await this.patchVersioned(item.id, userId, item.changes, item.version),
      })),
    );

    const applied: ElementEntity[] = [];
    const conflicts: BatchConflictEntry[] = [];

    for (const { id, outcome } of outcomes) {
      switch (outcome.status) {
        case 'applied':
          applied.push(outcome.element);
          break;
        case 'version_conflict':
          conflicts.push({ id, kind: 'version_conflict', element: outcome.element });
          break;
        default:
          conflicts.push({ id, kind: outcome.status });
      }
    }

    return { applied, conflicts };
  }

  /** Батч-версия `removeVersioned` (WS `element_batch_delete`, SLT-68). См. `batchPatchVersioned`. */
  async batchRemoveVersioned(
    userId: string,
    items: { id: string; version: number }[],
  ): Promise<BatchRemovalResult> {
    const outcomes = await Promise.all(
      items.map(async (item) => ({
        id: item.id,
        outcome: await this.removeVersioned(item.id, userId, item.version),
      })),
    );

    const applied: { id: string; version: number }[] = [];
    const conflicts: BatchConflictEntry[] = [];

    for (const { id, outcome } of outcomes) {
      switch (outcome.status) {
        case 'applied':
          applied.push({ id: outcome.id, version: outcome.version });
          break;
        case 'version_conflict':
          conflicts.push({ id, kind: 'version_conflict', element: outcome.element });
          break;
        default:
          conflicts.push({ id, kind: outcome.status });
      }
    }

    return { applied, conflicts };
  }

  /**
   * `PATCH /elements/:id` — меняет только присланные поля.
   *
   * Отдельный сценарий рядом с PUT нужен из-за объёма трафика: перетаскивание фигуры шлёт
   * координаты десятки раз в секунду, и гонять при этом всю геометрию и стили — лишние байты на
   * каждом кадре. Плюс на этапе 3 частичное изменение куда легче слить с чужим: два клиента,
   * подвинувшие разные фигуры, конфликтуют только если тронули одно поле.
   *
   * @throws {BadRequestException} пустое тело или `data` не соответствует типу элемента
   * @throws {NotFoundException} элемент недоступен, не существует или удалён
   */
  async patch(elementId: string, userId: string, dto: PatchElementDto): Promise<ElementDto> {
    const changes = toPatchChanges(dto);
    const hasGeometryChange = dto.data !== undefined;

    if (!hasGeometryChange && !hasAnyChange(changes)) {
      throw emptyPatch();
    }

    // Роль ≥ editor (SLT-41): PATCH — запись, `patchAccessible` ниже проверяет лишь ДОСТУП
    // (scope расширен до owner ∪ любой member), а не роль — её проверяет этот хелпер.
    await this.assertCanWriteElement(elementId, userId);

    const geometry = hasGeometryChange
      ? await this.parseStoredData(elementId, userId, dto.data)
      : undefined;

    const element = await this.elementRepository.patchAccessible(elementId, userId, {
      ...changes,
      ...(geometry === undefined ? {} : { data: geometry }),
    });

    if (element === null) {
      throw elementNotFound();
    }

    return toElementDto(element);
  }

  /**
   * `DELETE /elements/:id` — мягкое удаление: строка остаётся, но пропадает из выдач.
   *
   * Отдельного restore-эндпоинта нет намеренно: воскрешение делает тот же PUT, которым фигура
   * сохраняется. Для клиента undo — это «нарисовать её обратно», то есть тот же запрос с тем же
   * id; второй маршрут ради того же действия означал бы вторую ветку логики с собственными
   * правилами доступа.
   *
   * @throws {NotFoundException} элемент недоступен, не существует или уже удалён
   */
  async remove(elementId: string, userId: string): Promise<void> {
    // Роль ≥ editor (SLT-41) — см. `assertCanWriteElement` и её докстринг.
    await this.assertCanWriteElement(elementId, userId);

    const isDeleted = await this.elementRepository.softDeleteAccessible(elementId, userId);

    if (!isDeleted) {
      throw elementNotFound();
    }
  }

  /**
   * Роль ≥ editor на существующем элементе, брошенная как HTTP-исключение (SLT-41) — общий
   * write-хелпер `patch`/`remove`. Не размазан инлайн по обоим методам: правило «кто умеет
   * писать элемент» должно жить в одном месте, а не сравниваться `access === 'viewer'` дважды.
   *
   * `elementNotFound()` на `access === null`, а не `forbiddenWrite()`: посторонний (не-member)
   * не должен узнать о существовании элемента из статуса 403 — та же 404-политика, что и у
   * `patchAccessible`/`softDeleteAccessible` ниже. `forbiddenWrite()` — только когда доступ ЕСТЬ,
   * но роли не хватает (viewer): ему доска и элемент видны, скрывать факт существования нечем.
   */
  private async assertCanWriteElement(elementId: string, userId: string): Promise<void> {
    const access = await this.elementRepository.getAccessLevel(elementId, userId);

    if (access === null) {
      throw elementNotFound();
    }

    if (!canWrite(access)) {
      throw forbiddenWrite();
    }
  }

  /**
   * Вставка. Доступ к доске проверяется ЗДЕСЬ и только здесь — см. комментарий класса.
   *
   * Вставка — запись, значит нужна роль ≥ editor (SLT-41), не просто доступ: `boardService.getAccess`
   * отдаёт уровень, `canWrite` решает, хватает ли его. `access === null` (доски не видно вовсе) и
   * `'viewer'` (видно, но нельзя писать) — РАЗНЫЕ причины и разные ответы (`boardNotFound`/
   * `forbiddenWrite`), в отличие от «id-taken» ниже, где различать нарочно нечем.
   *
   * `board-missing` — не дубль этой проверки, а её гонка: доску удалили между проверкой доступа
   * и `INSERT`. Ответ — тот же 404 про доску (текст берётся из board-модуля, а не пишется
   * заново), потому что событие для клиента одно: доски, в которую он пишет, больше нет.
   *
   * `id-taken` — первичный ключ занят элементом ВНЕ области видимости пользователя: будь тот
   * элемент доступен, вызывающий нашёл бы его раньше и пошёл заменять. Текст конфликта общий с
   * веткой «элемент на другой моей доске» намеренно: разные формулировки сообщали бы, чей
   * именно элемент занял id, — ровно та утечка существования, которую закрывает 404-политика
   * SLT-19.
   */
  private async createElement(
    elementId: string,
    userId: string,
    boardId: string,
    shape: ReplaceElementData,
  ): Promise<{ element: ElementEntity; isCreated: boolean }> {
    const access = await this.boardService.getAccess(boardId, userId);

    if (!canWrite(access)) {
      throw access === null ? boardNotFound() : forbiddenWrite();
    }

    const outcome = await this.elementRepository.create({ id: elementId, boardId, ...shape });

    switch (outcome.status) {
      case 'created':
        return { element: outcome.element, isCreated: true };
      case 'board-missing':
        throw boardNotFound();
      case 'id-taken':
        throw elementIdTaken();
    }
  }

  /**
   * Проверить присланную геометрию против типа ХРАНИМОГО элемента.
   *
   * В PATCH `type` не приходит (менять его нельзя), поэтому единственный источник истины о форме
   * `data` — строка в БД. Отсюда лишний запрос, и он оправдан: без него сервер записал бы в
   * `rect` массив `points`, а сломалось бы это у клиента, который откроет доску позже.
   *
   * Читается только когда `data` реально прислана: PATCH координат — самый частый запрос при
   * перетаскивании — остаётся одним обращением к БД.
   */
  private async parseStoredData(
    elementId: string,
    userId: string,
    data: unknown,
  ): Promise<ElementData> {
    const stored = await this.elementRepository.findAccessible(elementId, userId);

    if (stored === null) {
      throw elementNotFound();
    }

    return this.parseData(stored.type, data);
  }

  /** @throws {BadRequestException} геометрия не соответствует типу фигуры */
  private parseData(type: ElementType, data: unknown): ElementData {
    const result = parseElementData(type, data);

    if (!result.isValid) {
      throw new BadRequestException(result.errors);
    }

    return result.data;
  }
}

/**
 * Полное тело PUT → форма фигуры для слоя данных.
 *
 * `fill ?? null` — единственное место, где отсутствие поля превращается в значение, и это не
 * подстановка дефолта, а семантика PUT: замена целиком. Оставь мы `undefined`, Prisma не
 * включила бы колонку в UPDATE, и у заменённой фигуры сохранилась бы СТАРАЯ заливка — то есть
 * два одинаковых PUT'а дали бы разный результат в зависимости от прошлого состояния.
 *
 * Поля перечислены поимённо, а не разложены спредом: DTO — это вход, и всё, что в него
 * когда-нибудь добавят, не должно автоматически уезжать в БД.
 */
function toElementShape(dto: UpsertElementDto, data: ElementData): ReplaceElementData {
  return {
    type: dto.type,
    x: dto.x,
    y: dto.y,
    angle: dto.angle,
    opacity: dto.opacity,
    stroke: dto.stroke,
    fill: dto.fill ?? null,
    strokeWidth: dto.strokeWidth,
    seed: dto.seed,
    order: dto.order,
    data,
  };
}

/**
 * Тело PATCH → изменения для слоя данных, без геометрии (её проверяют отдельно).
 *
 * `undefined` переносится как есть, и это осознанно: именно он означает «поле не присылали», и
 * Prisma не включит такую колонку в UPDATE. А вот `fill: null` — присланное значение, оно
 * доедет до базы и снимет заливку.
 */
function toPatchChanges(dto: PatchElementDto | PatchElementInput): PatchElementData {
  return {
    x: dto.x,
    y: dto.y,
    angle: dto.angle,
    opacity: dto.opacity,
    stroke: dto.stroke,
    fill: dto.fill,
    strokeWidth: dto.strokeWidth,
    order: dto.order,
  };
}

/**
 * Прислали ли вообще что-нибудь.
 *
 * Считается по СОБРАННОМУ объекту изменений, а не по ключам DTO: у класса с полями без
 * инициализаторов набор собственных ключей зависит от настроек компиляции
 * (`useDefineForClassFields`), и `Object.keys(dto).length === 0` проверял бы не данные, а
 * конфигурацию сборки.
 */
function hasAnyChange(changes: PatchElementData): boolean {
  return Object.values(changes).some((value) => value !== undefined);
}

/**
 * 404 на чужой элемент — так же, как на чужую доску (SLT-19). Причина та же: 403 подтвердил бы,
 * что элемент существует, и перебором id можно было бы отличать занятые идентификаторы от
 * свободных. Чужой элемент для меня НЕ СУЩЕСТВУЕТ.
 *
 * Один текст на все причины (нет / удалён / не твой) — тоже оттуда: разные формулировки
 * раскрывают ровно то, что скрывает одинаковый статус.
 */
function elementNotFound(): NotFoundException {
  return new NotFoundException('Элемент не найден');
}

/**
 * 409, а не 404 и не 400.
 *
 * Запрос корректен, права есть — не сходится СОСТОЯНИЕ: под этим id уже лежит элемент другой
 * доски. 404 здесь врал бы (PUT обязан создавать, и клиент повторял бы запрос вечно), а 400
 * обвинял бы тело запроса, с которым всё в порядке. 409 говорит как есть: повторять бесполезно,
 * нужен другой идентификатор.
 */
function elementIdTaken(): ConflictException {
  return new ConflictException('Элемент с таким идентификатором принадлежит другой доске');
}

/**
 * Смена типа существующего элемента — тоже 409, и по той же причине: тело запроса корректно,
 * не сходится состояние.
 *
 * Почему это вообще запрещено, хотя PUT по смыслу заменяет ресурс целиком. Тип определяет
 * форму `data`, то есть у `rect` и `line` разная природа, а не разное оформление: «замена»
 * прямоугольника линией под тем же id — это не изменение фигуры, а подмена одной другой.
 * Практически такой запрос означает баг клиента (перепутал id при сохранении) или гонку двух
 * вкладок, и оба случая лучше показать вслух, чем записать в БД.
 *
 * Отдельный текст от `elementIdTaken` здесь безопасен: обе ветки видны только владельцу доски
 * (чужой элемент под scope не находится вовсе), так что сообщение ничего не раскрывает — оно
 * лишь объясняет, ЧТО именно не сошлось, чтобы клиент не ретраил вечно один и тот же запрос.
 */
function elementTypeChanged(): ConflictException {
  return new ConflictException('Тип существующего элемента изменить нельзя');
}

/**
 * Пустой PATCH — ошибка, а не «успешно ничего не поменяли»: он инкрементил бы version и трогал
 * updatedAt, то есть тихо портил данные (та же логика, что у UpdateBoardDto в SLT-19).
 */
function emptyPatch(): BadRequestException {
  return new BadRequestException('Не передано ни одного поля для изменения');
}
