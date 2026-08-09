import type { BoardMemberRole } from '@slate/database';
import {
  type BoardListItemResponse,
  boardListResponseSchema,
  type BoardMemberListResponse,
  boardMemberListResponseSchema,
  type BoardMemberResponse,
  boardMemberResponseSchema,
  type BoardResponse,
  boardResponseSchema,
  type ElementListItemResponse,
  elementListResponseSchema,
  type ElementResponse,
  elementResponseSchema,
  type InviteMemberInput,
} from '@slate/shared-types';

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

export function boardMembersUrl(boardId: string): string {
  return `${BOARDS_URL}/${boardId}/members`;
}

export function boardMemberUrl(boardId: string, userId: string): string {
  return `${boardMembersUrl(boardId)}/${userId}`;
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

/**
 * Формы ответов приходят из @slate/shared-types, и это не экономия на объявлениях.
 *
 * Раньше здесь лежали свои интерфейсы — то есть тест сверял ответ с ОЖИДАНИЯМИ ТЕСТА, а не с
 * контрактом, который обещан клиенту. Расхождение между обещанным и отданным такой тест
 * заметить не мог в принципе: обе стороны правились одним человеком в один заход.
 *
 * Здесь же проходит вторая половина связки «схема ↔ бэкенд». Входы привязаны к контракту
 * статически (DTO объявлены через `implements`), а выходы так привязать нельзя: `createdAt` —
 * `Date` в памяти сервера и строка на проводе. Поэтому выходы проверяются РАНТАЙМОМ, на живых
 * телах ответов, и падение здесь означает ровно одно: сервер отдаёт не то, что обещает пакет.
 */
export type {
  BoardListItemResponse,
  BoardMemberListResponse,
  BoardMemberResponse,
  BoardResponse,
  ElementListItemResponse,
  ElementResponse,
};

/**
 * Разбор тела ответа схемой контракта.
 *
 * `parse`, а не `safeParse`: тело, не прошедшее схему, — это провал теста, и упасть он должен
 * сразу и с перечнем расхождений от zod, а не через десять строк на `undefined.id`.
 * Возвращённое значение типизировано, так что дальше `as` в тестах не нужен вовсе.
 */
export function parseBoardResponse(body: unknown): BoardResponse {
  return boardResponseSchema.parse(body);
}

export function parseBoardListResponse(body: unknown): BoardListItemResponse[] {
  return boardListResponseSchema.parse(body);
}

export function parseBoardMemberResponse(body: unknown): BoardMemberResponse {
  return boardMemberResponseSchema.parse(body);
}

export function parseBoardMemberListResponse(body: unknown): BoardMemberListResponse {
  return boardMemberListResponseSchema.parse(body);
}

export function parseElementResponse(body: unknown): ElementResponse {
  return elementResponseSchema.parse(body);
}

export function parseElementListResponse(body: unknown): ElementListItemResponse[] {
  return elementListResponseSchema.parse(body);
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

  // Разбор схемой прямо в фикстуре: доски создаются почти в каждом сценарии, так что контракт
  // ответа проверяется десятки раз без единой строчки в самих тестах.
  return parseBoardResponse(response.body);
}

/**
 * Заводит участника доски НАПРЯМУЮ через Prisma, минуя API. С SLT-42 есть честный путь —
 * `inviteMember` ниже, — но этот хелпер остаётся: тесты доступа (SLT-41), которым важна только
 * РОЛЬ на доске, а не флоу приглашения, не обязаны тащить за собой инвайт (лишний email, лишняя
 * регистрация второго аккаунта ради того, кого приглашают). Два пути осознанно сосуществуют:
 * этот — для тестов ДОСТУПА, `inviteMember` — для тестов самого ШЕРИНГА.
 */
export async function addBoardMember(
  testApp: TestApp,
  boardId: string,
  userId: string,
  role: BoardMemberRole,
): Promise<void> {
  await testApp.prisma.boardMember.create({ data: { boardId, userId, role } });
}

/** Приглашение участника через настоящий API (SLT-42) — с разбором ответа схемой контракта. */
export async function inviteMember(
  agent: TestAgent,
  boardId: string,
  input: InviteMemberInput,
): Promise<BoardMemberResponse> {
  const response = await agent.post(boardMembersUrl(boardId)).send(input);

  if (response.status !== 201) {
    throw new Error(
      `Приглашение не удалось (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return parseBoardMemberResponse(response.body);
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
