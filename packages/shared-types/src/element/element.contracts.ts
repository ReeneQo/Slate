import { z } from 'zod';

import type { AssertExact, ExactKeys } from '../exact-keys.js';
import {
  COLOR_MAX_LENGTH,
  OPACITY_MAX,
  OPACITY_MIN,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
} from './element.constants.js';
import type { ElementType } from './element.types.js';
import { ELEMENT_DATA_SCHEMAS } from './element-data.schema.js';

/**
 * Контракты element-эндпоинтов: `PUT /elements/:id` (замена целиком) и `PATCH /elements/:id`
 * (частичное изменение).
 *
 * Про `z.number()` один раз на весь файл: в zod 4 он отвергает и `NaN`, и `Infinity` — ровно
 * как `@IsNumber()` из class-validator на бэке. Координата обязана быть конечной, иначе она
 * доедет до jsonb как `null` и фигура пропадёт с холста у всех, кроме автора.
 */

/**
 * Цвет — строка произвольного формата (hex, rgba, имя). Регулярки нет намеренно: перечень
 * допустимых форматов CSS длиннее, чем польза от такой проверки, а разбирает их всё равно
 * браузер. Ограничиваем длину — чтобы в колонку не уехал текст произвольного размера.
 */
const colorSchema = z.string().min(1).max(COLOR_MAX_LENGTH);

const opacitySchema = z.number().min(OPACITY_MIN).max(OPACITY_MAX);
const strokeWidthSchema = z.number().min(STROKE_WIDTH_MIN).max(STROKE_WIDTH_MAX);

/**
 * Поля PUT, одинаковые у всех фигур. Всё, кроме `fill`, обязательно — и это следствие семантики
 * PUT, а не строгость ради строгости: пропущенный `angle` должен означать «угол ноль», а не
 * «оставь прежний» (последнее — это PATCH). Иначе два одинаковых запроса дали бы разное
 * состояние в зависимости от того, что лежало в строке раньше.
 *
 * `fill` — исключение по смыслу: у фигуры без заливки это `null`, то есть отсутствие значения
 * ЕСТЬ значение. Отсутствие поля сервер трактует как явный `null`, а не «не трогать».
 *
 * `id` в теле нет: он приходит в URL. Дублировать его значило бы завести два источника одного
 * значения и вопрос «что делать, если они разошлись», у которого нет хорошего ответа.
 */
const upsertElementBaseSchema = z.object({
  /** UUID без указания версии: id — uuid v7, проверка на v4 отвергла бы их все. */
  boardId: z.uuid(),
  x: z.number(),
  y: z.number(),
  /** Радианы. Границ нет намеренно: поворот на 7π — законный способ описать тот же угол. */
  angle: z.number(),
  opacity: opacitySchema,
  stroke: colorSchema,
  fill: colorSchema.nullable().optional(),
  strokeWidth: strokeWidthSchema,
  /**
   * Сид «рукописной» отрисовки. Генерит клиент, хранит сервер — форма фигуры обязана быть
   * одинаковой у всех, кто открыл доску (SLT-13). Целое: сид это вход ГПСЧ, у дробного
   * значения разные реализации дадут разный результат.
   */
  seed: z.int(),
  /** Дробный индекс (fractional indexing) — вставка между соседями без переписывания порядка. */
  order: z.number(),
});

/**
 * Одна ветка дискриминированного union'а: тип фигуры + ЕГО геометрия.
 *
 * Схема `data` берётся из ELEMENT_DATA_SCHEMAS, а не пишется здесь заново, — иначе перечень
 * «тип → форма геометрии» существовал бы в двух местах, и новая фигура однажды получила бы
 * описание в одном из них.
 */
function upsertVariantSchema<T extends ElementType>(type: T) {
  return upsertElementBaseSchema.extend({
    type: z.literal(type),
    data: ELEMENT_DATA_SCHEMAS[type],
  });
}

/**
 * Вход `PUT /elements/:id` — полное тело элемента.
 *
 * `discriminatedUnion`, а не «объект с `data: unknown`»: допустимая форма геометрии определяется
 * значением `type`, и союз выражает это в типе. Клиент, собравший `{ type: 'rect', data: {
 * points } }`, узнаёт об ошибке от КОМПИЛЯТОРА, а не от сервера — при том, что сервер всё равно
 * проверит (клиенту не доверяем).
 *
 * На бэке эта схема работает иначе — см. UpsertElementDto: там `data` остаётся `unknown`,
 * потому что значение приходит из JSON до всякой проверки, и типизировать непровалидированное
 * — просто врать компилятору.
 */
export const upsertElementSchema = z.discriminatedUnion('type', [
  upsertVariantSchema('rect'),
  upsertVariantSchema('ellipse'),
  upsertVariantSchema('line'),
  upsertVariantSchema('freedraw'),
  upsertVariantSchema('arrow'),
]);

export type UpsertElementInput = z.infer<typeof upsertElementSchema>;

/**
 * Страховка от неполного союза. `discriminatedUnion` перечисляет ветки руками, и добавленная в
 * `elementTypeSchema` фигура сюда сама не попадёт: контракт молча перестал бы принимать законный
 * тип. Проверка сверяет множество `type` в союзе с перечнем типов и роняет сборку при
 * расхождении в любую сторону.
 */
export type _UpsertCoversAllElementTypes = AssertExact<
  ExactKeys<UpsertElementInput['type'], ElementType>
>;

/**
 * Вход `PATCH /elements/:id` — меняется только присланное.
 *
 * Главное свойство схемы — чего в ней НЕТ:
 *
 * - `id` приходит в URL и не меняется в принципе: «смена id» — не обновление, а другой элемент.
 * - `boardId` — перемещение между досками не реализуем (граница SLT-20). Будь поле здесь, PATCH
 *   стал бы способом перенести элемент на другую доску, и это потребовало бы отдельной ветки
 *   авторизации — на доску-источник и на доску-приёмник.
 * - `type` — прямоугольник не превращается в линию: тип определяет форму `data`, и смена одного
 *   без другого оставила бы в БД `rect` с `points` внутри. Полная замена — через PUT.
 * - `seed` — сид отрисовки живёт столько же, сколько сама фигура.
 *
 * `data` здесь `unknown`, и это единственное место, где геометрия не типизирована. Причина не в
 * лени: в PATCH нет `type`, а форма `data` определяется ИМ. Сервер берёт тип из БД и зовёт
 * `parseElementData`; клиент знает тип из своего состояния и зовёт ту же функцию. Дискриминации
 * на уровне схемы взяться неоткуда — дискриминатора в запросе нет.
 *
 * Проверки «прислали хотя бы одно поле» тут тоже нет: пустой PATCH — ошибка (он инкрементит
 * version и трогает updatedAt, ничего не меняя), но ловит её сервис, где виден весь запрос
 * целиком, а не отдельные поля.
 */
export const patchElementSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  angle: z.number().optional(),
  opacity: opacitySchema.optional(),
  stroke: colorSchema.optional(),
  /** `null` — снять заливку, и это законное изменение, а не «поле не прислали». */
  fill: colorSchema.nullable().optional(),
  strokeWidth: strokeWidthSchema.optional(),
  order: z.number().optional(),
  data: z.unknown().optional(),
});

export type PatchElementInput = z.infer<typeof patchElementSchema>;

/**
 * Элемент в ответе — форма НА ПРОВОДЕ (см. комментарий к boardResponseSchema): даты здесь
 * строки, потому что JSON дат не знает.
 *
 * `strictObject` ловит лишние поля, и для элемента это не теория: в строке лежат `version` и
 * `deletedAt`, которых в ответе быть не должно. Первое — счётчик ревизий под этап 3, второе
 * наружу не нужно вовсе (выборка и так возвращает только живые элементы). Забудь кто-нибудь
 * убрать их из SELECT — тест ответа падает здесь, а не всплывает в бандле у клиента.
 *
 * Геометрия проверяется теми же схемами, что и на входе: сервер не должен возвращать `data`,
 * которую сам бы не принял.
 */
const elementResponseBaseSchema = z.strictObject({
  id: z.uuid(),
  boardId: z.uuid(),
  x: z.number(),
  y: z.number(),
  angle: z.number(),
  opacity: opacitySchema,
  stroke: z.string(),
  /** В ответе поле есть ВСЕГДА: `null` означает фигуру без заливки. */
  fill: z.string().nullable(),
  strokeWidth: strokeWidthSchema,
  seed: z.int(),
  order: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

function elementResponseVariantSchema<T extends ElementType>(type: T) {
  return elementResponseBaseSchema.extend({
    type: z.literal(type),
    data: ELEMENT_DATA_SCHEMAS[type],
  });
}

export const elementResponseSchema = z.discriminatedUnion('type', [
  elementResponseVariantSchema('rect'),
  elementResponseVariantSchema('ellipse'),
  elementResponseVariantSchema('line'),
  elementResponseVariantSchema('freedraw'),
  elementResponseVariantSchema('arrow'),
]);

export type ElementResponse = z.infer<typeof elementResponseSchema>;

/** Та же страховка, что и у входа: новая фигура не должна тихо выпасть из союза ответа. */
export type _ElementResponseCoversAllElementTypes = AssertExact<
  ExactKeys<ElementResponse['type'], ElementType>
>;

/**
 * Элемент в ответе `GET /boards/:id/elements`: та же форма, что `elementResponseSchema`, плюс
 * `version` (SLT-40). Единственное расширение HTTP-контракта — PUT/PATCH-ответы (замена/патч
 * одного элемента) `version` по-прежнему не несут, это оптимистическая блокировка WS-мутаций
 * (SLT-38), а не общее поле элемента; отдельная схема, а не version-поле на `elementResponseSchema`
 * само по себе, чтобы PUT/PATCH не получили его молча вместе с ней.
 *
 * Гидрации он нужен НЕ ради вывода, а ради следующей правки: без реальной version клиент шлёт
 * WS-мутацию с дефолтом 0 и получает ложный `version_conflict` на первой же правке элемента,
 * который эту сессию не касалась ни одна WS-мутация (долг SLT-39, см. api/mapper.ts на фронте).
 */
const elementListItemBaseSchema = elementResponseBaseSchema.extend({
  version: z.int().nonnegative(),
});

function elementListItemVariantSchema<T extends ElementType>(type: T) {
  return elementListItemBaseSchema.extend({
    type: z.literal(type),
    data: ELEMENT_DATA_SCHEMAS[type],
  });
}

export const elementListItemSchema = z.discriminatedUnion('type', [
  elementListItemVariantSchema('rect'),
  elementListItemVariantSchema('ellipse'),
  elementListItemVariantSchema('line'),
  elementListItemVariantSchema('freedraw'),
  elementListItemVariantSchema('arrow'),
]);

export type ElementListItemResponse = z.infer<typeof elementListItemSchema>;

/**
 * Содержимое доски: `GET /boards/:id/elements`. Отдельная схема, а не `z.array(...)` по месту, —
 * чтобы тесты и клиент разбирали список ОДНИМ определением, включая порядок полей и строгость.
 */
export const elementListResponseSchema = z.array(elementListItemSchema);
