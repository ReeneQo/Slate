import { z } from 'zod';

import {
  FREEDRAW_POINTS_MAX,
  FREEDRAW_POINTS_MIN,
  LINE_POINTS_MAX,
  LINE_POINTS_MIN,
  SHAPE_SIZE_MAX,
  SHAPE_SIZE_MIN,
} from './element.constants.js';
import type { ElementType } from './element.types.js';

/**
 * Правда о форме `data` — ЗДЕСЬ, в коде, а не в БД. Решение принято ещё в SLT-13: в схеме
 * колонка объявлена как `Json @db.JsonB`, потому что геометрия у разных фигур разная, а
 * заводить под каждую свою таблицу (или два десятка nullable-колонок) значит обслуживать
 * миграцию на каждую новую фигуру. Плата за гибкость ровно одна: такой jsonb БД не проверит,
 * значит проверять обязано приложение — иначе в холст попадёт `{ "width": "боль" }`, и упадёт
 * не сервер, а рендер у всех, кто откроет доску.
 *
 * Почему zod, когда остальной вход бэкенда валидируется class-validator. Проверка здесь
 * ДИСКРИМИНИРОВАННАЯ: допустимая форма `data` зависит от значения `type`, а в PATCH `type`
 * вообще не приходит в запросе — он лежит в БД. То есть проверку нужно уметь запускать не
 * только на границе HTTP, но и в сервисе, уже зная состояние строки. Декоратор так не умеет:
 * он привязан к классу DTO. Схема — обычное значение, её можно позвать откуда угодно, в том
 * числе из WebSocket-хендлера этапа 3, где DTO-классов не будет вовсе.
 *
 * Вторая причина — и ради неё модуль переехал сюда из apps/api (SLT-23): клиент обязан
 * проверять геометрию ТЕМ ЖЕ кодом, а не своей копией правил. class-validator сюда не
 * переехал бы — он тащит за собой декораторы и reflect-metadata, которым в браузере не место.
 */

/**
 * Прямоугольник и эллипс: габаритная коробка. Эллипс описывается той же парой (Konva рисует
 * его вписанным в bounding box), поэтому схема одна на две фигуры — это не «пока совпало», а
 * одна и та же геометрия.
 *
 * `strictObject` — лишние ключи запрещены, и это не педантизм. Молча проглоченный
 * `{ width, height, radius }` означает, что клиент считает, будто сервер хранит `radius`, а
 * сервер о нём не знает: расхождение всплывёт у ВТОРОГО пользователя, открывшего доску.
 * 400 на входе честнее тихого расхождения состояния.
 */
const boxDataSchema = z.strictObject({
  width: z.number().min(SHAPE_SIZE_MIN).max(SHAPE_SIZE_MAX),
  height: z.number().min(SHAPE_SIZE_MIN).max(SHAPE_SIZE_MAX),
});

/**
 * Линия: плоский массив `[x1, y1, x2, y2, ...]` — тот же формат, что у Konva.Line, чтобы
 * клиент не перекладывал точки туда-обратно на каждой отрисовке.
 *
 * Чётность длины проверяется отдельно от границ: массив из трёх чисел отсечёт минимум, а вот
 * из пяти — прошёл бы, и последняя координата осталась бы без пары. Такую линию рендер либо
 * отбросит, либо нарисует по-разному у разных клиентов.
 */
const lineDataSchema = z.strictObject({
  points: z
    .array(z.number())
    .min(LINE_POINTS_MIN)
    .max(LINE_POINTS_MAX)
    .refine((points) => points.length % 2 === 0, {
      message: 'координаты идут парами x/y, длина массива должна быть чётной',
    }),
});

/**
 * Freedraw (карандаш): та же плоская форма `[x1, y1, x2, y2, ...]`, что и у линии, — НЕ
 * переиспользуем `lineDataSchema` напрямую, а заводим отдельную схему с собственными границами
 * (`FREEDRAW_POINTS_MIN/MAX`, см. element.constants.ts): рисование от руки копит на порядки
 * больше точек, чем клик-драг линии, и связывать эти пределы значило бы либо душить линию, либо
 * пускать в неё карандашные объёмы.
 */
const freedrawDataSchema = z.strictObject({
  points: z
    .array(z.number())
    .min(FREEDRAW_POINTS_MIN)
    .max(FREEDRAW_POINTS_MAX)
    .refine((points) => points.length % 2 === 0, {
      message: 'координаты идут парами x/y, длина массива должна быть чётной',
    }),
});

/**
 * Соответствие «тип фигуры → форма её геометрии».
 *
 * `satisfies Record<ElementType, ...>` — не украшение: добавят в `elementTypeSchema` новую
 * фигуру, и этот файл перестанет компилироваться, пока для неё не опишут геометрию. Без такой
 * привязки новая фигура молча получила бы «валидацию» через отсутствующую схему — то есть
 * никакую.
 *
 * Экспортируется, потому что из этой же карты собираются контракты PUT: держать перечень
 * «тип → схема» в двух местах значит однажды описать фигуру здесь и забыть в контракте.
 */
export const ELEMENT_DATA_SCHEMAS = {
  rect: boxDataSchema,
  ellipse: boxDataSchema,
  line: lineDataSchema,
  freedraw: freedrawDataSchema,
} satisfies Record<ElementType, z.ZodType>;

/** Геометрия элемента после проверки — union по типам фигур. */
export type ElementData = z.infer<(typeof ELEMENT_DATA_SCHEMAS)[ElementType]>;

/**
 * Результат разбора. Возврат вместо `throw`: модуль остаётся чистым и ничего не знает про
 * HTTP. Какой статус показать клиенту — решение сервиса, ровно как «строки нет» у репозитория
 * превращается в 404 не там, где обнаружено, а там, где известен сценарий. Для фронта это
 * свойство ещё важнее: там ошибка геометрии — не статус, а подсветка поля в панели.
 */
export type ElementDataResult =
  | { isValid: true; data: ElementData }
  | { isValid: false; errors: string[] };

/**
 * Проверить геометрию против типа фигуры.
 *
 * `data: unknown` — вход из тела запроса, доверия к нему нет по определению. Наружу уходит уже
 * РАЗОБРАННОЕ значение, а не исходное: `strictObject` отбрасывает лишние ключи на этапе
 * парсинга, так что в БД попадает ровно то, что описано схемой.
 */
export function parseElementData(type: ElementType, data: unknown): ElementDataResult {
  const result = ELEMENT_DATA_SCHEMAS[type].safeParse(data);

  if (!result.success) {
    return { isValid: false, errors: formatIssues(type, result.error) };
  }

  return { isValid: true, data: result.data };
}

/**
 * Сообщения об ошибках. Тип фигуры в тексте обязателен: без него `data.points — обязательное
 * поле` не объясняет, почему у прямоугольника вдруг спрашивают points. Клиент в этот момент
 * прислал `type: 'line'` (или элемент в БД — линия), и именно это нужно сказать вслух.
 */
function formatIssues(type: ElementType, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = ['data', ...issue.path].join('.');

    return `${path} (${type}): ${issue.message}`;
  });
}
