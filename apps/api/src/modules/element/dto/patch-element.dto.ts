import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  COLOR_MAX_LENGTH,
  OPACITY_MAX,
  OPACITY_MIN,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
} from '../element.constants';

/**
 * Вход `PATCH /elements/:id` — частичное обновление: меняется только присланное.
 *
 * Главное свойство класса — чего в нём НЕТ, и это не экономия полей:
 *
 * - `id` — приходит в URL и не меняется в принципе: это первичный ключ, сгенерированный
 *   клиентом. «Смена id» — не обновление, а другой элемент.
 * - `boardId` — перемещение между досками не реализуем (граница SLT-20). Будь поле здесь,
 *   PATCH стал бы способом перенести элемент на другую доску, и это потребовало бы отдельной
 *   ветки авторизации — на доску-источник и на доску-приёмник. Отсутствие поля закрывает
 *   сценарий на уровне типа: то, чего нет во входе, нельзя ни забыть проверить, ни обойти.
 * - `type` — прямоугольник не превращается в линию. Тип определяет форму `data`, и смена
 *   одного без другого оставила бы в БД `rect` с `points` внутри. Полная замена фигуры
 *   доступна через PUT, где `type` и `data` приходят вместе и проверяются вместе.
 * - `seed` — сид отрисовки живёт столько же, сколько сама фигура: изменить его значит
 *   перерисовать «от руки» заново, чего пользователь не просил.
 * - `version` — инкрементит репозиторий, единственной точкой на приложение (SLT-19).
 *
 * `PartialType(UpsertElementDto)` из @nestjs/mapped-types не подошёл бы, даже будь пакет в
 * зависимостях: он сделал бы опциональными ВСЕ поля, включая те четыре, которых здесь быть не
 * должно вовсе.
 *
 * Проверки «прислали хотя бы одно поле» на уровне класса нет намеренно — её делает сервис
 * (см. element.service). Пустой PATCH обязан быть ошибкой: он ничего не меняет, но инкрементит
 * version и трогает updatedAt, то есть тихо портит данные вместо честного 400.
 */
export class PatchElementDto {
  @IsOptional()
  @IsNumber()
  x?: number;

  @IsOptional()
  @IsNumber()
  y?: number;

  @IsOptional()
  @IsNumber()
  angle?: number;

  @IsOptional()
  @IsNumber()
  @Min(OPACITY_MIN)
  @Max(OPACITY_MAX)
  opacity?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COLOR_MAX_LENGTH)
  stroke?: string;

  /**
   * `null` — снять заливку, и это законное изменение, а не «поле не прислали». `@IsOptional()`
   * пропускает и `null`, и `undefined`, а различает их уже сервис: `undefined` не попадает в
   * update, `null` попадает и обнуляет колонку.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COLOR_MAX_LENGTH)
  fill?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(STROKE_WIDTH_MIN)
  @Max(STROKE_WIDTH_MAX)
  strokeWidth?: number;

  @IsOptional()
  @IsNumber()
  order?: number;

  /**
   * Геометрия. Форму проверяет сервис — против `type` из БД: в PATCH типа нет, и какая схема
   * применима, известно только после чтения строки.
   */
  @IsOptional()
  @IsObject()
  data?: unknown;
}
