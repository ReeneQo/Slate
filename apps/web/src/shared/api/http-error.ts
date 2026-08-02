/**
 * Типизированная ошибка транспортного слоя. Любой не-2xx ответ превращается в неё — верхние
 * слои (react-query в SLT-26) по `status` различают 401/403/404/409/422, а по `payload`
 * достают сообщение бэка. Ошибку НЕ глотаем и НЕ возвращаем null: `request` её выбрасывает.
 *
 * `ApiError` — доменно-нейтральна: знает про HTTP-статус и сырой payload, но не про auth/
 * board/element. Разбор payload'а под конкретную фичу — забота вызывающего слоя.
 */

/**
 * Форма тела ошибки, которую реально отдаёт бэк Slate. Глобального exception-filter нет —
 * это дефолтный shape Nest `HttpException`:
 *  - `statusCode` дублирует HTTP-статус;
 *  - `message` — строка (`UnauthorizedException('...')`) ИЛИ массив строк (ValidationPipe,
 *    `BadRequestException(errors)`), поэтому тип объединённый;
 *  - `error` — короткая метка класса ошибки (`'Unauthorized'`, `'Bad Request'`), бывает не всегда.
 *
 * Тип описывает ожидаемое, но `payload` в `ApiError` остаётся `unknown`: доверять форме чужого
 * ответа на 100% нельзя (прокси/сеть могут вернуть HTML или пустоту), поэтому есть type-guard.
 */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;

    // Цепочка прототипов рвётся при транспиляции class → ES5-подобной функции; без этого
    // `instanceof ApiError` может врать. Target у нас ES2022, но фикс дешёвый и снимает
    // класс трудноуловимых багов раз и навсегда.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** Type-guard для верхних слоёв: сузить `unknown` из catch до `ApiError`. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Совпадает ли payload с ожидаемым Nest-shape. Не выбрасывает, только сужает тип. */
function isApiErrorBody(payload: unknown): payload is ApiErrorBody {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    'statusCode' in payload
  );
}

/**
 * Достаёт человекочитаемое сообщение из payload для `Error.message` (devtools, логи).
 * Не для UI: конечный текст форматирует фича, знающая контекст. Массив messages (валидация)
 * склеиваем через `; `, чтобы ничего не потерять.
 */
export function extractErrorMessage(status: number, payload: unknown): string {
  if (isApiErrorBody(payload)) {
    const { message } = payload;
    return Array.isArray(message) ? message.join('; ') : message;
  }
  return `Request failed with status ${status}`;
}
