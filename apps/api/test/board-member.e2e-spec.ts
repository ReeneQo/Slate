import {
  boardElementsUrl,
  boardMembersUrl,
  boardMemberUrl,
  BOARDS_URL,
  boardUrl,
  createBoard,
  elementBody,
  elementId,
  elementUrl,
  inviteMember,
  MISSING_BOARD_ID,
  parseBoardListResponse,
  parseBoardMemberListResponse,
  parseBoardMemberResponse,
  type SignedUpUser,
  signUp,
  USER_A,
  USER_B,
} from './helpers/api';
import { startTestApp, type TestApp } from './helpers/test-app';

const MISSING_USER_ID = '019fa5b1-0000-7000-8000-0000000000fd';

/**
 * Сквозные тесты шеринга (SLT-42): приглашение, смена роли, отзыв, список участников, и то, как
 * это связывается с «моими досками» (owned ∪ shared) из SLT-41.
 *
 * Юниты BoardMemberService уже проверили порядок и причины отказов; здесь — доходит ли решение
 * до клиента через весь стек: guard, ValidationPipe, статус-коды, реальные ограничения БД
 * (`@@unique([boardId, userId])`), и что регресс SLT-41 (viewer не пишет) не сломан флоу
 * приглашения через API вместо прямого INSERT.
 */
describe('Board sharing (e2e)', () => {
  let testApp: TestApp;
  let anna: SignedUpUser;
  let boris: SignedUpUser;

  beforeAll(async () => {
    testApp = await startTestApp();
  });

  afterAll(async () => {
    await testApp?.stop();
  });

  beforeEach(async () => {
    await testApp.reset();

    anna = await signUp(testApp, USER_A);
    boris = await signUp(testApp, USER_B);
  });

  describe(`POST ${BOARDS_URL}/:id/members`, () => {
    it('owner приглашает viewer по email — тот появляется в списке и видит доску, но не пишет', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');

      const member = await inviteMember(anna.agent, board.id, {
        email: USER_B.email,
        role: 'viewer',
      });

      expect(member).toEqual({
        id: expect.any(String) as string,
        role: 'viewer',
        createdAt: expect.any(String) as string,
        user: { id: boris.userId, email: USER_B.email, displayName: USER_B.displayName },
      });

      const list = parseBoardListResponse((await boris.agent.get(BOARDS_URL)).body);
      expect(list).toEqual([{ ...board, role: 'viewer' }]);

      const boardRead = await boris.agent.get(boardUrl(board.id));
      const elementsRead = await boris.agent.get(boardElementsUrl(board.id));
      expect(boardRead.status).toBe(200);
      expect(elementsRead.status).toBe(200);

      // Регресс SLT-41: viewer, приглашённый через API, мутировать элементы по-прежнему не может.
      const created = await boris.agent.put(elementUrl(elementId(1))).send(elementBody(board.id));
      expect(created.status).toBe(403);
    });

    it('owner приглашает editor по email — тот мутирует элементы', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'editor' });

      const created = await boris.agent.put(elementUrl(elementId(1))).send(elementBody(board.id));

      expect(created.status).toBe(201);
    });

    it('не-owner (editor/viewer/посторонний) не может приглашать — 404, как rename/delete (SLT-41)', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      const carla = await signUp(testApp, {
        email: 'carla@example.test',
        displayName: 'Carla',
        password: 'yet another horse',
      });
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'editor' });

      const byEditor = await boris.agent
        .post(boardMembersUrl(board.id))
        .send({ email: 'nobody@example.test', role: 'viewer' });
      const byStranger = await carla.agent
        .post(boardMembersUrl(board.id))
        .send({ email: 'nobody@example.test', role: 'viewer' });

      expect(byEditor.status).toBe(404);
      expect(byStranger.status).toBe(404);
    });

    it('само-приглашение owner → 409', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');

      const response = await anna.agent
        .post(boardMembersUrl(board.id))
        .send({ email: USER_A.email, role: 'editor' });

      expect(response.status).toBe(409);
    });

    it('дубль — уже приглашённого пользователя → 409, роль не молчаливо меняется', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'viewer' });

      const response = await anna.agent
        .post(boardMembersUrl(board.id))
        .send({ email: USER_B.email, role: 'editor' });

      expect(response.status).toBe(409);

      const stored = await testApp.prisma.boardMember.findUnique({
        where: { boardId_userId: { boardId: board.id, userId: boris.userId } },
      });
      // Роль осталась прежней — конфликт не превратился в тихий upsert.
      expect(stored?.role).toBe('viewer');
    });

    it('несуществующий email → 404', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');

      const response = await anna.agent
        .post(boardMembersUrl(board.id))
        .send({ email: 'nobody@example.test', role: 'editor' });

      expect(response.status).toBe(404);
    });

    it('на несуществующую доску отвечает 404', async () => {
      const response = await anna.agent
        .post(boardMembersUrl(MISSING_BOARD_ID))
        .send({ email: USER_B.email, role: 'editor' });

      expect(response.status).toBe(404);
    });
  });

  describe(`PATCH ${BOARDS_URL}/:id/members/:userId`, () => {
    it('owner меняет роль участника', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'viewer' });

      const response = await anna.agent
        .patch(boardMemberUrl(board.id, boris.userId))
        .send({ role: 'editor' });

      expect(response.status).toBe(200);
      expect(parseBoardMemberResponse(response.body).role).toBe('editor');

      // Роль сменилась по-настоящему: теперь Борис вправе писать.
      const created = await boris.agent.put(elementUrl(elementId(1))).send(elementBody(board.id));
      expect(created.status).toBe(201);
    });

    it('не-owner не может сменить роль — 404', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'viewer' });

      const response = await boris.agent
        .patch(boardMemberUrl(board.id, boris.userId))
        .send({ role: 'editor' });

      expect(response.status).toBe(404);
    });

    it('несуществующее членство → 404', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');

      const response = await anna.agent
        .patch(boardMemberUrl(board.id, boris.userId))
        .send({ role: 'editor' });

      expect(response.status).toBe(404);
    });

    it('owner не адресуется как участник — PATCH по userId владельца тоже 404', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');

      const response = await anna.agent
        .patch(boardMemberUrl(board.id, anna.userId))
        .send({ role: 'editor' });

      expect(response.status).toBe(404);
    });
  });

  describe(`DELETE ${BOARDS_URL}/:id/members/:userId`, () => {
    it('owner отзывает участника: 204, доступ пропадает', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'viewer' });

      const response = await anna.agent.delete(boardMemberUrl(board.id, boris.userId));

      expect(response.status).toBe(204);
      expect((await boris.agent.get(boardUrl(board.id))).status).toBe(404);
    });

    it('не-owner не может отозвать — 404', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'viewer' });

      const response = await boris.agent.delete(boardMemberUrl(board.id, boris.userId));

      expect(response.status).toBe(404);
    });

    it('несуществующее членство → 404', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');

      const response = await anna.agent.delete(boardMemberUrl(board.id, MISSING_USER_ID));

      expect(response.status).toBe(404);
    });
  });

  describe(`GET ${BOARDS_URL}/:id/members`, () => {
    it('owner видит список участников', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'editor' });

      const response = await anna.agent.get(boardMembersUrl(board.id));
      const members = parseBoardMemberListResponse(response.body);

      expect(response.status).toBe(200);
      expect(members).toHaveLength(1);
      expect(members[0]?.user.id).toBe(boris.userId);
    });

    it('участник (editor/viewer) тоже видит список — это read, не управление', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await inviteMember(anna.agent, board.id, { email: USER_B.email, role: 'viewer' });

      const response = await boris.agent.get(boardMembersUrl(board.id));

      expect(response.status).toBe(200);
      expect(parseBoardMemberListResponse(response.body)).toHaveLength(1);
    });

    it('посторонний → 404', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      const carla = await signUp(testApp, {
        email: 'carla@example.test',
        displayName: 'Carla',
        password: 'yet another horse',
      });

      const response = await carla.agent.get(boardMembersUrl(board.id));

      expect(response.status).toBe(404);
    });

    it('на несуществующую доску отвечает 404', async () => {
      const response = await anna.agent.get(boardMembersUrl(MISSING_BOARD_ID));

      expect(response.status).toBe(404);
    });
  });

  describe(`GET ${BOARDS_URL} — «мои доски» owned ∪ shared (SLT-42)`, () => {
    it('список содержит и свои, и расшаренные доски, каждую со своей ролью', async () => {
      const own = await createBoard(anna.agent, 'Своя доска');
      const shared = await createBoard(anna.agent, 'Расшаренная доска');
      await inviteMember(anna.agent, shared.id, { email: USER_B.email, role: 'editor' });

      // У Бориса своя доска ЕСТЬ тоже — проверяем, что union не путает владение.
      const borisOwn = await createBoard(boris.agent, 'Доска Бориса');

      const response = await boris.agent.get(BOARDS_URL);
      const list = parseBoardListResponse(response.body);

      expect(response.status).toBe(200);
      expect(list).toEqual(
        expect.arrayContaining([
          { ...shared, role: 'editor' },
          { ...borisOwn, role: 'owner' },
        ]),
      );
      expect(list.map((board) => board.id)).not.toContain(own.id);
      expect(list).toHaveLength(2);
    });

    it('не-member по-прежнему не видит чужую доску в списке', async () => {
      await createBoard(anna.agent, 'Доска Анны');

      const response = await boris.agent.get(BOARDS_URL);

      expect(response.body).toEqual([]);
    });
  });
});
