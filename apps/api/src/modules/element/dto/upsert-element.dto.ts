import { ElementType } from '@slate/database';
import {
  type AssertExact,
  COLOR_MAX_LENGTH,
  type ExactKeys,
  OPACITY_MAX,
  OPACITY_MIN,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
  type UpsertElementInput,
} from '@slate/shared-types';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Вход `PUT /elements/:id` — ПОЛНОЕ тело элемента.
 *
 * `id` здесь нет: он приходит в URL. Дублировать его в теле значило бы завести два источника
 * одного значения и вопрос «что делать, если они разошлись», у которого нет хорошего ответа.
 *
 * Все поля, кроме `fill`, обязательны — и это следствие семантики PUT, а не строгость ради
 * строгости. PUT заменяет ресурс целиком: пропущенный `angle` должен означать «угол ноль», а
 * не «оставь прежний» (последнее — это PATCH). Пропусти мы поле в Prisma-update как
 * `undefined`, старое значение сохранилось бы, и PUT перестал бы быть идемпотентным: два
 * одинаковых запроса дали бы разное состояние в зависимости от того, что лежало в строке
 * раньше. Требовать поле — единственный способ этого избежать, не заводя серверных дефолтов
 * в довесок к тем, что уже стоят в схеме БД.
 *
 * `fill` — исключение по смыслу: у фигуры без заливки это `null`, то есть отсутствие значения
 * ЕСТЬ значение. Поэтому отсутствие поля сервис трактует как явный `null`, а не «не трогать».
 *
 * `boardId` в теле, а не в URL, — следствие плоского маршрута `/elements/:id` (см. контроллер).
 * Клиенту он известен: фигура рисуется на конкретной доске. Проверку доступа к ЭТОЙ доске
 * делает сервис — сам по себе присланный boardId никаких прав не даёт.
 *
 * Про `implements Omit<UpsertElementInput, 'data'> & { data: unknown }`. В общем контракте
 * `upsertElementSchema` — дискриминированный союз: форма `data` там зависит от `type`, и фронт
 * получает точный тип. Здесь `data` обязана остаться `unknown`, и это не поблажка: до разбора
 * схемой в теле лежит произвольный JSON, а объявить его геометрией прямоугольника значило бы
 * соврать компилятору ровно там, где данные ещё не проверены. Проверку делает сервис
 * (`parseElementData`), и только её результат имеет тип `ElementData`.
 *
 * Остальные поля при этом сверяются с контрактом поимённо. В том числе `type`: он объявлен
 * enum'ом из @slate/database, а контракт требует свой union из трёх литералов, — так расхождение
 * между схемой БД и контрактом ловится компилятором в ОБЕ стороны (лишнее значение в enum'е и
 * лишнее в контракте одинаково ломают сборку).
 */
export class UpsertElementDto implements Omit<UpsertElementInput, 'data'>, HasRawData {
  /** UUID без указания версии: id — uuid v7, `version: '4'` отверг бы их все (как в SLT-19). */
  @IsUUID()
  boardId!: string;

  /**
   * `@IsEnum` от РАНТАЙМ-объекта `ElementType` из @slate/database — в отличие от `import type`
   * в ElementDto, здесь нужно значение. Свой union `'rect' | ...` разъехался бы со схемой
   * молча: добавили фигуру в enum Prisma — валидатор о ней не узнал.
   */
  @IsEnum(ElementType)
  type!: ElementType;

  /** `@IsNumber()` по умолчанию отвергает NaN и Infinity — координата обязана быть конечной. */
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  /** Радианы. Границ нет намеренно: поворот на 7π — законный способ описать тот же угол. */
  @IsNumber()
  angle!: number;

  @IsNumber()
  @Min(OPACITY_MIN)
  @Max(OPACITY_MAX)
  opacity!: number;

  /**
   * Цвет — строка произвольного формата (hex, rgba, имя). Регулярку не ставим: перечень
   * допустимых форматов CSS длиннее, чем польза от проверки, а разбирает их всё равно браузер.
   * Ограничиваем длину — чтобы в колонку не уехал текст произвольного размера.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(COLOR_MAX_LENGTH)
  stroke!: string;

  /** `null` — фигура без заливки. Отсутствие поля сервис приравняет к `null` (см. выше). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COLOR_MAX_LENGTH)
  fill?: string | null;

  @IsNumber()
  @Min(STROKE_WIDTH_MIN)
  @Max(STROKE_WIDTH_MAX)
  strokeWidth!: number;

  /**
   * Сид «рукописной» отрисовки. Генерит клиент, хранит сервер — форма фигуры обязана быть
   * одинаковой у всех, кто открыл доску (SLT-13). Целое: сид это вход ГПСЧ, у дробного
   * значения разные реализации дадут разный результат.
   */
  @IsInt()
  seed!: number;

  /** Дробный индекс (fractional indexing) — вставка между соседями без переписывания порядка. */
  @IsNumber()
  order!: number;

  /**
   * Геометрия. Здесь проверяется только то, что это объект: настоящую форму задаёт `type`, а
   * дискриминированная проверка живёт в @slate/shared-types — одна на PUT и PATCH.
   */
  @IsObject()
  data!: unknown;
}

/**
 * Требование «поле `data` есть, но его содержимое ещё не разобрано». Отдельный интерфейс, а не
 * второй `implements Omit<...>`: `Omit` выбросил бы `data` вместе с типом, и класс мог бы
 * потерять поле целиком, не поссорившись с компилятором.
 */
interface HasRawData {
  data: unknown;
}

/** Сверка на лишние поля класса — см. пояснение в create-board.dto. */
export type _UpsertElementDtoKeys = AssertExact<
  ExactKeys<keyof UpsertElementDto, keyof UpsertElementInput>
>;
