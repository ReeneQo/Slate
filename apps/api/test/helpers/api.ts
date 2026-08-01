import type { TestAgent, TestApp } from './test-app';

/**
 * Доменные хелперы для e2e board и element: маршруты, фикстуры тел запросов и короткий путь
 * «зарегистрировать пользователя → получить агента с живой сессией».
 *
 * Отдельный модуль рядом с test-app, а не внутри него: test-app отвечает за ОКРУЖЕНИЕ
 * (контейнеры, миграции, приложение, очистка) и не должен знать ни одного маршрута предметной
 * области — иначе auth-e2e начал бы зависеть от знаний о досках. Здесь наоборот: только домен,
 * ни одного контейнера.
 *
 * Данные создаются ТОЛЬКО через HTTP, даже когда прямой INSERT был бы короче. Смысл e2e в том,
 * что тест идёт тем же путём, что настоящий клиент: подготовив доску Prisma-запросом, мы бы
 * проверяли чтение по данным, которые никогда не проходили через контроллер, валидацию и
 * присвоение владельца из сессии. Prisma в этих тестах — инструмент ПРОВЕРКИ, а не подготовки.
 */

export const REGISTER_URL = '/api/auth/register';
export const BOARDS_URL = '/api/boards';

export function boardUrl(boardId: string): string {
  return `${BOARDS_URL}/${boardId}`;
}

export function boardElementsUrl(boardId: string): string {
  return `${BOARDS_URL}/${boardId}/elements`;
}

export function elementUrl(elementId: string): string {
  return `/api/elements/${elementId}`;
}

/**
 * Идентификаторы, которых заведомо нет в базе. Формат — настоящий uuid: они проверяют ответ
 * «ресурса нет», а не работу ParseUUIDPipe, у которого свой тест с мусорной строкой.
 */
export const MISSING_BOARD_ID = '019fa5b1-0000-7000-8000-0000000000ff';
export const MISSING_ELEMENT_ID = '019fa5b1-0000-7000-8000-0000000000fe';

/** id элементов генерит КЛИЕНТ (SLT-13), поэтому в тестах они просто заданы литералами. */
export function elementId(suffix: number): string {
  return `019fa5b1-0000-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

export interface TestUser {
  email: string;
  displayName: string;
  password: string;
}

export const USER_A: TestUser = {
  email: 'anna@example.test',
  displayName: 'Anna',
  password: 'correct horse battery',
};

export const USER_B: TestUser = {
  email: 'boris@example.test',
  displayName: 'Boris',
  password: 'another horse battery',
};

/** Форма ответа board-эндпоинтов. Записана здесь, чтобы `res.body` не расползался как any. */
export interface BoardResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ElementResponse {
  id: string;
  boardId: string;
  type: string;
  x: number;
  y: number;
  angle: number;
  opacity: number;
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  seed: number;
  order: number;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Пользователь с живой сессией: агент хранит куку, userId нужен для проверок владения в БД. */
export interface SignedUpUser {
  agent: TestAgent;
  userId: string;
}

/**
 * Регистрация + автовход. Отдельный login не нужен: register сам ставит session-куку (это
 * проверено в auth-e2e), а лишний запрос быстрее упирался бы в лимит throttler'а.
 */
export async function signUp(testApp: TestApp, user: TestUser): Promise<SignedUpUser> {
  const agent = testApp.createAgent();
  const response = await agent.post(REGISTER_URL).send(user);

  if (response.status !== 201) {
    // Молча вернуть сломанного агента значило бы получить падение в середине сценария с
    // невнятным 401 вместо настоящей причины — например, исчерпанного лимита регистраций.
    throw new Error(
      `Регистрация не удалась (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  const { id } = response.body as { id: string };

  return { agent, userId: id };
}

/** Доска через API — с владельцем из сессии агента, а не из тела запроса. */
export async function createBoard(
  agent: TestAgent,
  title = 'Sprint board',
): Promise<BoardResponse> {
  const response = await agent.post(BOARDS_URL).send({ title });

  if (response.status !== 201) {
    throw new Error(`Доска не создана (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body as BoardResponse;
}

/**
 * Полное тело PUT /elements/:id. Обязательны все поля, кроме `fill`, — это семантика замены
 * целиком (SLT-20), а не строгость ради строгости.
 */
export function elementBody(
  boardId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    boardId,
    type: 'rect',
    x: 10,
    y: 20,
    angle: 0,
    opacity: 1,
    stroke: '#1e1e1e',
    strokeWidth: 2,
    seed: 42,
    order: 1,
    data: { width: 120, height: 80 },
    ...overrides,
  };
}

/** Геометрия линии — для сценариев со сменой типа и с несоответствием data типу. */
export const LINE_DATA = { points: [0, 0, 10, 10] };
