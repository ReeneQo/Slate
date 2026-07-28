import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { HashService } from '../../shared/crypto/hash.service';
import type { SafeUser, UserWithHash } from '../user/entities/user.entity';
import { EmailAlreadyTakenError } from '../user/user.errors';
import type { UserService } from '../user/user.service';
import { AuthService } from './auth.service';
import type { SessionsService } from './sessions/sessions.service';

const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const EMAIL = 'renee@example.test';
const DISPLAY_NAME = 'Renee';
const PASSWORD = 'correct horse battery';
const PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA';

const CREATED_AT = new Date('2026-07-28T10:00:00.000Z');

function createSafeUser(overrides: Partial<SafeUser> = {}): SafeUser {
  return {
    id: USER_ID,
    email: EMAIL,
    displayName: DISPLAY_NAME,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createUserWithHash(overrides: Partial<UserWithHash> = {}): UserWithHash {
  return { ...createSafeUser(), passwordHash: PASSWORD_HASH, ...overrides };
}

/**
 * Заглушки зависимостей.
 *
 * Функции-моки объявлены ОТДЕЛЬНЫМИ переменными и возвращаются наружу вместе с сервисами,
 * а не достаются в тестах как `create`. Причина не стилистическая:
 * `expect(create)` — это передача ссылки на метод, оторванный от объекта, на
 * что справедливо ругается `@typescript-eslint/unbound-method`. Правило полезное и
 * выключать его ради тестов не станем; проще не создавать ситуацию, которую оно ловит.
 * Побочный плюс — в ассертах читается `expect(create)`, без лишнего шума.
 *
 * Каждая типизирована через `jest.MockedFunction<Сервис['метод']>`: разъедься сигнатура
 * реального сервиса с ожиданиями теста — упадёт typecheck, а не тест продолжит зелёным
 * проверять несуществующий контракт.
 *
 * argon2 намеренно медленный, поэтому здесь он подменён. Предмет проверки в этом файле —
 * ЧТО и КОГДА передаётся в verify, а не криптография (её покрывает hash.service.spec.ts).
 */
function createDependencies() {
  const create = jest.fn() as jest.MockedFunction<UserService['create']>;
  const findByEmailWithHash = jest.fn() as jest.MockedFunction<UserService['findByEmailWithHash']>;
  const findByIdWithHash = jest.fn() as jest.MockedFunction<UserService['findByIdWithHash']>;
  const saveSession = jest.fn() as jest.MockedFunction<SessionsService['saveSession']>;
  const destroySession = jest.fn() as jest.MockedFunction<SessionsService['destroySession']>;
  const hash = jest.fn() as jest.MockedFunction<HashService['hash']>;
  const verify = jest.fn() as jest.MockedFunction<HashService['verify']>;

  saveSession.mockResolvedValue(undefined);
  destroySession.mockResolvedValue(undefined);
  hash.mockResolvedValue(PASSWORD_HASH);

  const userService = {
    create,
    findByEmailWithHash,
    findByIdWithHash,
    findById: jest.fn(),
    findByEmail: jest.fn(),
    // Не мок, а настоящее правило: оно тривиально, а подменённое вернуло бы undefined и
    // тихо сломало проверку hasPassword в getMe.
    hasPassword: (user: Pick<UserWithHash, 'passwordHash'>) => user.passwordHash !== null,
  } as unknown as UserService;

  const sessionsService = { saveSession, destroySession } as unknown as SessionsService;
  const hashService = { hash, verify } as unknown as HashService;

  return {
    authService: new AuthService(userService, sessionsService, hashService),
    create,
    findByEmailWithHash,
    findByIdWithHash,
    saveSession,
    destroySession,
    hash,
    verify,
  };
}

const registerInput = { email: EMAIL, displayName: DISPLAY_NAME, password: PASSWORD };

const request = {} as Request;

describe('AuthService', () => {
  describe('register', () => {
    it('создаёт пользователя с нормализованным email', async () => {
      const { authService, create } = createDependencies();
      create.mockResolvedValue(createSafeUser());

      await authService.register(request, {
        ...registerInput,
        email: '  Renee@Example.TEST  ',
      });

      // Нормализация обязана произойти ДО записи: иначе `Renee@…` и `renee@…` станут
      // двумя аккаунтами, которые unique-constraint не считает дубликатом.
      expect(create).toHaveBeenCalledWith({
        email: EMAIL,
        displayName: DISPLAY_NAME,
        password: PASSWORD,
      });
    });

    it('передаёт пароль в UserService открытым, а не хеширует его сам', async () => {
      const { authService, create, hash } = createDependencies();
      create.mockResolvedValue(createSafeUser());

      await authService.register(request, registerInput);

      // Регрессия на двойное хеширование: хешированием владеет UserService.create.
      // Захешируй AuthService пароль ещё раз — в БД ляжет хеш от хеша, и логин перестанет
      // работать навсегда, причём молча: регистрация вернёт честный 201.
      expect(hash).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ password: PASSWORD }));
    });

    it('логинит сразу после регистрации', async () => {
      const { authService, create, saveSession } = createDependencies();
      create.mockResolvedValue(createSafeUser());

      await authService.register(request, registerInput);

      expect(saveSession).toHaveBeenCalledWith(request, createSafeUser());
    });

    it('возвращает AuthUserDto без хеша и без лишних полей', async () => {
      const { authService, create } = createDependencies();
      create.mockResolvedValue(createSafeUser());

      const result = await authService.register(request, registerInput);

      // toEqual, а не toMatchObject: важно, что лишних полей НЕТ. toMatchObject
      // пропустил бы и createdAt, и утёкший passwordHash.
      expect(result).toEqual({ id: USER_ID, email: EMAIL, displayName: DISPLAY_NAME });
    });

    it('превращает занятый email в 409 Conflict', async () => {
      const { authService, create } = createDependencies();
      create.mockRejectedValue(new EmailAlreadyTakenError(EMAIL));

      await expect(authService.register(request, registerInput)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('не ставит сессию, если создание не удалось', async () => {
      const { authService, create, saveSession } = createDependencies();
      create.mockRejectedValue(new EmailAlreadyTakenError(EMAIL));

      await expect(authService.register(request, registerInput)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(saveSession).not.toHaveBeenCalled();
    });

    it('пробрасывает прочие ошибки как есть, не подменяя их на 409', async () => {
      const { authService, create } = createDependencies();
      const databaseIsDown = new Error('connection refused');
      create.mockRejectedValue(databaseIsDown);

      // Упавшая БД обязана остаться пятисоткой. Проглотив её в ConflictException, мы бы
      // показывали пользователю «email занят» во время аварии и не узнали бы об аварии.
      await expect(authService.register(request, registerInput)).rejects.toBe(databaseIsDown);
    });
  });

  describe('login', () => {
    it('при верном пароле ставит сессию и возвращает AuthUserDto', async () => {
      const { authService, findByEmailWithHash, saveSession, verify } = createDependencies();
      findByEmailWithHash.mockResolvedValue(createUserWithHash());
      verify.mockResolvedValue(true);

      const result = await authService.login(request, { email: EMAIL, password: PASSWORD });

      expect(verify).toHaveBeenCalledWith(PASSWORD_HASH, PASSWORD);
      expect(saveSession).toHaveBeenCalledWith(request, createUserWithHash());
      expect(result).toEqual({ id: USER_ID, email: EMAIL, displayName: DISPLAY_NAME });
    });

    it('ищет пользователя по нормализованному email', async () => {
      const { authService, findByEmailWithHash, verify } = createDependencies();
      findByEmailWithHash.mockResolvedValue(createUserWithHash());
      verify.mockResolvedValue(true);

      await authService.login(request, { email: '  Renee@Example.TEST  ', password: PASSWORD });

      // Зеркало нормализации в register. Разойдись эти две — и получим
      // «зарегистрировался, но не могу войти» для всех, кто ввёл email с заглавной.
      expect(findByEmailWithHash).toHaveBeenCalledWith(EMAIL);
    });

    it('при неверном пароле бросает 401 и не трогает сессию', async () => {
      const { authService, findByEmailWithHash, saveSession, verify } = createDependencies();
      findByEmailWithHash.mockResolvedValue(createUserWithHash());
      verify.mockResolvedValue(false);

      await expect(
        authService.login(request, { email: EMAIL, password: 'wrong password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(saveSession).not.toHaveBeenCalled();
    });

    it('для несуществующего email всё равно вызывает verify — по DUMMY_HASH', async () => {
      const { authService, findByEmailWithHash, verify } = createDependencies();
      findByEmailWithHash.mockResolvedValue(null);
      verify.mockResolvedValue(false);

      await expect(
        authService.login(request, { email: 'ghost@example.test', password: PASSWORD }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // Суть timing-защиты. Ранний return в ветке «нет такого email» вернул бы ответ
      // мгновенно, тогда как ветка с существующим email тратит десятки миллисекунд на
      // argon2. Разница измерима снаружи обычным curl и превращает форму логина
      // в оракул «а такой адрес у вас зарегистрирован?».
      expect(verify).toHaveBeenCalledTimes(1);
      // Параметры фиктивного хеша обязаны совпадать с боевыми (ARGON2_OPTIONS в
      // HashService), иначе подстановка считается быстрее настоящей проверки и
      // timing-разница просто меняет знак вместо того, чтобы исчезнуть.
      expect(verify).toHaveBeenCalledWith(
        expect.stringContaining('$argon2id$v=19$m=19456,t=2,p=1$'),
        PASSWORD,
      );
    });

    it('для OAuth-пользователя без пароля не падает на null и отдаёт тот же 401', async () => {
      const { authService, findByEmailWithHash, verify } = createDependencies();
      findByEmailWithHash.mockResolvedValue(createUserWithHash({ passwordHash: null }));
      verify.mockResolvedValue(false);

      await expect(
        authService.login(request, { email: EMAIL, password: PASSWORD }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // verify(null, ...) уронил бы argon2 пятисоткой — и та сообщила бы, что аккаунт
      // существует. Вместо этого null уходит в DUMMY_HASH и получает обычный отказ.
      expect(verify).toHaveBeenCalledWith(
        expect.stringContaining('$argon2id$v=19$m=19456,t=2,p=1$'),
        PASSWORD,
      );
    });

    it('даёт неотличимые ответы для «нет юзера», «нет пароля» и «пароль неверный»', async () => {
      const collectMessage = async (user: UserWithHash | null): Promise<string> => {
        const { authService, findByEmailWithHash, verify } = createDependencies();
        findByEmailWithHash.mockResolvedValue(user);
        verify.mockResolvedValue(false);

        try {
          await authService.login(request, { email: EMAIL, password: PASSWORD });
          throw new Error('ожидался отказ, но login завершился успешно');
        } catch (error) {
          return (error as UnauthorizedException).message;
        }
      };

      const [missingUser, oauthUser, wrongPassword] = await Promise.all([
        collectMessage(null),
        collectMessage(createUserWithHash({ passwordHash: null })),
        collectMessage(createUserWithHash()),
      ]);

      // Разные тексты — тот же оракул, что и разное время, только читаемый глазами.
      expect(missingUser).toBe(wrongPassword);
      expect(oauthUser).toBe(wrongPassword);
    });
  });

  describe('logout', () => {
    it('уничтожает сессию', async () => {
      const { authService, destroySession } = createDependencies();
      const response = {} as Response;

      await authService.logout(request, response);

      expect(destroySession).toHaveBeenCalledWith(request, response);
    });
  });

  describe('getMe', () => {
    it('возвращает полный контракт с hasPassword: true', async () => {
      const { authService, findByIdWithHash } = createDependencies();
      findByIdWithHash.mockResolvedValue(createUserWithHash());

      const result = await authService.getMe(USER_ID);

      expect(result).toEqual({
        id: USER_ID,
        email: EMAIL,
        displayName: DISPLAY_NAME,
        hasPassword: true,
        createdAt: CREATED_AT,
      });
    });

    it('отдаёт hasPassword: false для OAuth-пользователя', async () => {
      const { authService, findByIdWithHash } = createDependencies();
      findByIdWithHash.mockResolvedValue(createUserWithHash({ passwordHash: null }));

      const result = await authService.getMe(USER_ID);

      // Ради этого флага getMe и ходит за выборкой С хешем: из безопасной выборки факт
      // «пароль есть» не выводится, а фронту он нужен, чтобы предложить задать пароль.
      expect(result.hasPassword).toBe(false);
    });

    it('бросает 401, если сессия ссылается на удалённого пользователя', async () => {
      const { authService, findByIdWithHash } = createDependencies();
      findByIdWithHash.mockResolvedValue(null);

      // Именно 401, а не 404: не «ресурс не найден», а «предъявленная кука больше
      // не действительна» — по этому статусу фронт уводит на логин.
      await expect(authService.getMe(USER_ID)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('регрессия: хеш пароля не покидает сервис', () => {
    it('ни один ответ не содержит passwordHash', async () => {
      const { authService, create, findByEmailWithHash, findByIdWithHash, verify } =
        createDependencies();
      create.mockResolvedValue(createSafeUser());
      findByEmailWithHash.mockResolvedValue(createUserWithHash());
      findByIdWithHash.mockResolvedValue(createUserWithHash());
      verify.mockResolvedValue(true);

      const responses = [
        await authService.register(request, registerInput),
        await authService.login(request, { email: EMAIL, password: PASSWORD }),
        await authService.getMe(USER_ID),
      ];

      // Проверяем СЕРИАЛИЗОВАННЫЙ ответ, а не наличие ключа: именно в таком виде объект
      // уходит клиенту, и именно так утечка выглядела в старом проекте. Ключевой риск —
      // маппер через spread: `UserWithHash` структурно совместим с `SafeUser`, поэтому
      // объект с хешем проходит в маппер без единой ошибки типов.
      for (const response of responses) {
        expect(JSON.stringify(response)).not.toContain('passwordHash');
        expect(JSON.stringify(response)).not.toContain(PASSWORD_HASH);
      }
    });
  });
});
