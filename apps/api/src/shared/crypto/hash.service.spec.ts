import { HashService } from './hash.service';

/**
 * argon2 гоняем на ПРОДОВЫХ параметрах (m=19456 KiB, t=2, p=1) — намеренно.
 *
 * Соблазн опустить memoryCost ради скорости надо гасить: тогда тест проверял бы не тот
 * режим, в котором сервис работает, и «зелёный» не означал бы ничего про реальные хеши.
 * Плата за честность — время: каждый hash() по построению занимает десятки миллисекунд,
 * поэтому поднимаем таймаут, а не ослабляем алгоритм. Вызовов держим ровно столько,
 * сколько нужно для утверждений.
 */
const ARGON2_TIMEOUT_MS = 30_000;

const PASSWORD = 'correct horse battery staple';
const WRONG_PASSWORD = 'Correct horse battery staple';

describe('HashService', () => {
  const hashService = new HashService();

  it(
    'возвращает хеш, не совпадающий с исходным паролем',
    async () => {
      const hash = await hashService.hash(PASSWORD);

      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(PASSWORD);
      // Пароль не должен встречаться в хеше даже как подстрока.
      expect(hash).not.toContain(PASSWORD);
    },
    ARGON2_TIMEOUT_MS,
  );

  it(
    'использует argon2id с заданными параметрами',
    async () => {
      const hash = await hashService.hash(PASSWORD);

      // Параметры argon2 хранит внутри самой строки хеша. Проверяем именно её префикс:
      // так тест поймает и молчаливую смену алгоритма, и съехавшие memory/time cost —
      // ровно то, ради чего параметры были заданы явно, а не оставлены на дефолтах.
      expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    },
    ARGON2_TIMEOUT_MS,
  );

  it(
    'подтверждает верный пароль',
    async () => {
      const hash = await hashService.hash(PASSWORD);

      await expect(hashService.verify(hash, PASSWORD)).resolves.toBe(true);
    },
    ARGON2_TIMEOUT_MS,
  );

  it(
    'отклоняет неверный пароль',
    async () => {
      const hash = await hashService.hash(PASSWORD);

      await expect(hashService.verify(hash, WRONG_PASSWORD)).resolves.toBe(false);
    },
    ARGON2_TIMEOUT_MS,
  );

  it(
    'даёт разные хеши для одного пароля (соль случайна)',
    async () => {
      const [first, second] = await Promise.all([
        hashService.hash(PASSWORD),
        hashService.hash(PASSWORD),
      ]);

      // Одинаковые хеши означали бы отсутствие соли: радужная таблица вскрыла бы разом
      // всех пользователей с одинаковым паролем.
      expect(first).not.toBe(second);
      await expect(hashService.verify(second, PASSWORD)).resolves.toBe(true);
    },
    ARGON2_TIMEOUT_MS,
  );
});
