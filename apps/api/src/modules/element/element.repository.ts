import { Injectable } from '@nestjs/common';
import { type ElementType, Prisma } from '@slate/database';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { accessibleElementScope } from './element.access';
import type { ElementData } from './element-data.schema';
import { ELEMENT_SELECT, type ElementEntity, LIVE_ELEMENT_WHERE } from './entities/element.entity';

/** Коды Prisma, у которых здесь есть доменное значение. Выше по стеку про них знать не положено. */
const UNIQUE_VIOLATION = 'P2002';
const FOREIGN_KEY_VIOLATION = 'P2003';
const RECORD_NOT_FOUND = 'P2025';

/** Общие поля фигуры — всё, кроме идентичности (`id`, `boardId`) и служебного (`version`). */
interface ElementShape {
  type: ElementType;
  x: number;
  y: number;
  angle: number;
  opacity: number;
  stroke: string;
  /** `null` — без заливки. Не `undefined`: PUT заменяет фигуру целиком, «не трогать» тут нет. */
  fill: string | null;
  strokeWidth: number;
  seed: number;
  order: number;
  /**
   * Уже проверенная геометрия, а не «что прислали». Тип `ElementData` вместо
   * `Prisma.InputJsonValue` — это граница, работающая в обе стороны: репозиторий не примет
   * непроверенный объект, а сервису не приходится импортировать типы Prisma, чтобы позвать
   * репозиторий (иначе ORM протекла бы в слой логики через сигнатуру).
   */
  data: ElementData;
}

/** Вставка. `id` приходит от КЛИЕНТА (SLT-13), `boardId` — проверенный сервисом. */
export interface CreateElementData extends ElementShape {
  id: string;
  boardId: string;
}

/** Полная замена. `boardId` отсутствует намеренно: перемещать элемент между досками нечем. */
export type ReplaceElementData = ElementShape;

/** Частичное обновление: `undefined` ⇒ колонки нет в UPDATE. `fill: null` ⇒ снять заливку. */
export interface PatchElementData {
  x?: number;
  y?: number;
  angle?: number;
  opacity?: number;
  stroke?: string;
  fill?: string | null;
  strokeWidth?: number;
  order?: number;
  data?: ElementData;
}

/**
 * То, что у элемента задаётся при создании и потом не меняется никогда.
 *
 * `boardId` — перемещение между досками не реализуем (граница SLT-20). `type` — прямоугольник
 * не превращается в линию: тип определяет форму `data`, и смена одного без другого оставила бы
 * в БД `rect` с `points` внутри. Оба ограничения проверяются в одном месте — upsert'ом, потому
 * что PATCH этих полей вообще не принимает.
 */
export interface ElementInvariants {
  boardId: string;
  type: ElementType;
}

/**
 * Чем закончилась вставка. Вариантов три, и различать их обязан именно репозиторий: только он
 * видит коды Prisma. Дальше это уже доменные факты, из которых сервис выбирает HTTP-статус —
 * та же граница, что у `null` в board-репозитории.
 */
export type CreateElementOutcome =
  | { status: 'created'; element: ElementEntity }
  | { status: 'id-taken' }
  | { status: 'board-missing' };

/**
 * Единственная точка доступа к Prisma для элемента.
 *
 * Устроен так же, как BoardRepository: бизнес-правил нет, а ПРОВЕРКА ДОСТУПА есть — в виде
 * области видимости запроса (`accessibleElementScope`), вклеенной в тот же `where`, что и
 * мутация. Методы с суффиксом `Accessible` физически не могут прочитать или изменить элемент
 * чужой доски. Что показать пользователю, когда строка не нашлась, решает сервис.
 *
 * ФИЛЬТР МЯГКОГО УДАЛЕНИЯ ЖИВЁТ ЗДЕСЬ. `LIVE_ELEMENT_WHERE` стоит по умолчанию во всех
 * методах, кроме двух, и это не соглашение, а свойство слоя: сервис про `deletedAt` не знает
 * и потому не может его забыть. Исключения ровно два, оба с говорящими именами:
 *
 * - `findInvariantsIncludingDeleted` — upsert обязан УВИДЕТЬ удалённую строку, иначе
 *   воскрешение выродится в попытку вставить элемент с занятым первичным ключом;
 * - `replaceAccessible` — оно и есть воскрешение: снимает `deletedAt` вместе с заменой полей.
 *
 * Инкремент `version` — тоже здесь, и по той же причине, что у доски: одна точка на всё
 * приложение, атомарно средствами БД (`version = version + 1`), а не «прочитать, прибавить,
 * записать». На этот счётчик обопрётся оптимистическая блокировка этапа 3, и пропущенный
 * инкремент сломал бы её незаметно.
 */
@Injectable()
export class ElementRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Вставка элемента с КЛИЕНТСКИМ id.
   *
   * Область видимости в `INSERT` не вклеить — сужать нечего, строки ещё не существует. Поэтому
   * доступ к доске проверяет сервис ДО вызова, а здесь ловится последствие гонки: между
   * проверкой и вставкой доску могли удалить, и тогда падает внешний ключ (P2003). Без этого
   * catch редкий, но абсолютно реальный сценарий отдавал бы 500.
   *
   * P2002 — первичный ключ занят: элемент с таким id уже есть и лежит вне области видимости
   * пользователя (иначе сервис нашёл бы его раньше и пошёл заменять, а не создавать).
   */
  async create({ id, boardId, ...shape }: CreateElementData): Promise<CreateElementOutcome> {
    try {
      const element = await this.prisma.element.create({
        data: { id, boardId, ...shape },
        select: ELEMENT_SELECT,
      });

      return { status: 'created', element };
    } catch (error) {
      if (isPrismaError(error, UNIQUE_VIOLATION)) {
        return { status: 'id-taken' };
      }

      if (isPrismaError(error, FOREIGN_KEY_VIOLATION)) {
        return { status: 'board-missing' };
      }

      throw error;
    }
  }

  /**
   * Живой элемент, если он на доступной пользователю доске. `null` ⇒ элемента нет, он удалён
   * или лежит на чужой доске — три разные причины и один ответ; различать их снаружи нечем и
   * не нужно.
   *
   * Нужен PATCH'у, когда тот меняет `data`: форма геометрии зависит от `type`, а `type` в
   * запросе PATCH не приходит — его знает только строка в БД.
   */
  findAccessible(elementId: string, userId: string): Promise<ElementEntity | null> {
    return this.prisma.element.findFirst({
      where: { ...accessibleElementScope(elementId, userId), ...LIVE_ELEMENT_WHERE },
      select: ELEMENT_SELECT,
    });
  }

  /**
   * Неизменяемые поля элемента — ВКЛЮЧАЯ мягко удалённый. Имя длинное намеренно: это
   * единственный способ прочитать удалённую строку, и вызов такого метода обязан быть заметен
   * в diff'е.
   *
   * Читаются ровно два поля, и вместе они не случайно: `boardId` и `type` — это всё, что у
   * элемента не меняется НИКОГДА. Остальные поля тут же будут перезаписаны заменой, читать их
   * значит тянуть из БД мусор.
   *
   * Один запрос отвечает сразу на три вопроса upsert'а: существует ли строка под этим
   * клиентским id, на той ли она доске и той ли природы. Спрашивать `type` отдельно было бы не
   * только лишним round-trip'ом, но и окном между чтениями, в котором ответы разъедутся.
   */
  findInvariantsIncludingDeleted(
    elementId: string,
    userId: string,
  ): Promise<ElementInvariants | null> {
    return this.prisma.element.findFirst({
      where: accessibleElementScope(elementId, userId),
      select: { boardId: true, type: true },
    });
  }

  /**
   * Полная замена (она же воскрешение). `null` ⇒ элемент недоступен или не существует.
   *
   * `deletedAt: null` пишется ВСЕГДА, а не только когда элемент удалён: ветка «если был удалён —
   * воскресить» означала бы сначала прочитать состояние, а потом решать, то есть лишний запрос
   * и окно между ним и записью. Присвоение `null` удалённому элементу и присвоение `null`
   * живому — одна и та же операция с одинаковым результатом.
   *
   * `LIVE_ELEMENT_WHERE` здесь отсутствует ОСОЗНАННО: именно этот метод должен доставать
   * удалённую строку. Единственное место в модуле, где мягкое удаление игнорируется при записи.
   */
  async replaceAccessible(
    elementId: string,
    userId: string,
    shape: ReplaceElementData,
  ): Promise<ElementEntity | null> {
    try {
      // `await` внутри try обязателен: без него промис уедет наружу и catch не сработает.
      return await this.prisma.element.update({
        where: accessibleElementScope(elementId, userId),
        data: { ...shape, deletedAt: null, version: { increment: 1 } },
        select: ELEMENT_SELECT,
      });
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Частичное обновление ЖИВОГО элемента. `null` ⇒ элемент недоступен, не существует или
   * удалён: воскрешать через PATCH нельзя, для этого есть PUT.
   *
   * Поля со значением `undefined` Prisma в UPDATE не включает, поэтому «менять только
   * присланное» получается само собой — сервису достаточно не подставлять значения за клиента.
   */
  async patchAccessible(
    elementId: string,
    userId: string,
    { data: geometry, ...changes }: PatchElementData,
  ): Promise<ElementEntity | null> {
    try {
      return await this.prisma.element.update({
        where: { ...accessibleElementScope(elementId, userId), ...LIVE_ELEMENT_WHERE },
        data: {
          ...changes,
          // Ключ добавляется только когда геометрия действительно прислана: `data: undefined`
          // Prisma игнорирует, но явное отсутствие ключа честнее — из объекта видно, что
          // именно уходит в UPDATE.
          ...(geometry === undefined ? {} : { data: geometry }),
          version: { increment: 1 },
        },
        select: ELEMENT_SELECT,
      });
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Мягкое удаление. `false` ⇒ элемент недоступен, не существует или УЖЕ удалён.
   *
   * `LIVE_ELEMENT_WHERE` в условии делает операцию идемпотентной по состоянию: повторный DELETE
   * не переставит `deletedAt` на новое время. Иначе «когда удалили» менялось бы при каждом
   * ретрае клиента — а именно на это время обопрётся отмена удаления в реалтайме.
   *
   * `version` инкрементится и здесь: для клиента исчезновение фигуры — такая же ревизия, как её
   * перемещение. Пропусти мы инкремент, доска изменилась бы, а счётчик — нет.
   */
  async softDeleteAccessible(elementId: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.element.update({
        where: { ...accessibleElementScope(elementId, userId), ...LIVE_ELEMENT_WHERE },
        data: { deletedAt: new Date(), version: { increment: 1 } },
        select: { id: true },
      });

      return true;
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) {
        return false;
      }

      throw error;
    }
  }
}

/** Перевод ошибки ORM на язык домена — единственное, что репозиторию позволено решать про ошибки. */
function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
