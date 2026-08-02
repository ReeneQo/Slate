import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ElementType } from '@slate/database';
import { type ElementData, parseElementData } from '@slate/shared-types';

import { boardNotFound, BoardService } from '../board/board.service';
import { type ElementDto, toElementDto } from './dto/element.dto';
import type { PatchElementDto } from './dto/patch-element.dto';
import type { UpsertElementDto } from './dto/upsert-element.dto';
import {
  ElementRepository,
  type PatchElementData,
  type ReplaceElementData,
} from './element.repository';

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
 * Бизнес-логика элемента холста. PrismaService не инжектит и не импортирует — в БД ходит
 * только через ElementRepository. Про `deletedAt` тоже не знает: мягкое удаление целиком
 * закрыто слоем данных, здесь оно видно лишь как слово «воскресить» в названии сценария.
 *
 * Проверка доступа устроена двумя разными способами, и разница принципиальна:
 *
 * 1. Мутации СУЩЕСТВУЮЩЕГО элемента (замена, PATCH, удаление) несут scope доски прямо в своём
 *    `where` — отдельной проверки нет и быть не должно, иначе появится окно между «можно» и
 *    «пишем».
 * 2. ВСТАВКА нового элемента — единственный случай, где сузить запрос нечем: строки ещё не
 *    существует. Здесь и только здесь вызывается `boardService.assertAccessible`.
 *
 * Оба способа опираются на ОДНО определение доступа из SLT-19 (`accessibleBoardScope`), а не на
 * две независимые проверки: шеринг этапа 3 добавит ветку в одном месте, и элементы станут
 * доступны участникам сами собой.
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
    const shape = toElementShape(dto, this.parseData(dto.type, dto.data));
    const existing = await this.elementRepository.findInvariantsIncludingDeleted(elementId, userId);

    if (existing === null) {
      return this.createElement(elementId, userId, dto.boardId, shape);
    }

    // Дальше — ветка замены, и здесь действуют инварианты элемента. Оба сравнения бесплатны:
    // строка уже прочитана тем же запросом, который решил «создавать или заменять».

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

    return { element: toElementDto(element), isCreated: false };
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
    const isDeleted = await this.elementRepository.softDeleteAccessible(elementId, userId);

    if (!isDeleted) {
      throw elementNotFound();
    }
  }

  /**
   * Вставка. Доступ к доске проверяется ЗДЕСЬ и только здесь — см. комментарий класса.
   *
   * `board-missing` — не дубль этой проверки, а её гонка: доску удалили между `assertAccessible`
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
  ): Promise<UpsertElementResult> {
    await this.boardService.assertAccessible(boardId, userId);

    const outcome = await this.elementRepository.create({ id: elementId, boardId, ...shape });

    switch (outcome.status) {
      case 'created':
        return { element: toElementDto(outcome.element), isCreated: true };
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
function toPatchChanges(dto: PatchElementDto): PatchElementData {
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
