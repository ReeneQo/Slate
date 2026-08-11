import { Injectable } from '@nestjs/common';
import { Prisma } from '@slate/database';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  SAFE_USER_SELECT,
  type SafeUser,
  USER_WITH_HASH_SELECT,
  type UserWithHash,
} from './entities/user.entity';
import { EmailAlreadyTakenError } from './user.errors';

/** Код Prisma для нарушения unique-constraint. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Данные для вставки. `passwordHash` — УЖЕ захешированный: репозиторий не хеширует.
 * `null` — OAuth-регистрация (SLT-54): у такого пользователя пароля нет вообще, это не
 * «пустой пароль», а его отсутствие как класса (см. `login` в AuthService, ветка `?? DUMMY_HASH`).
 */
export interface CreateUserData {
  email: string;
  passwordHash: string | null;
  displayName: string;
}

/**
 * Единственная точка доступа к Prisma для модели User.
 *
 * Репозиторий намеренно «тупой»: только запросы, ни одной бизнес-проверки, ни одного
 * throw. Проверки «такой email занят», «пароль верный», «пользователь активирован» —
 * это правила, а правила живут в сервисе, в одном месте. Как только репозиторий
 * начинает решать, он перестаёт быть подменяемым в тестах и обрастает второй копией
 * логики (в старом проекте UserService.findById бросал NotFoundException при заявленном
 * `Promise<T | null>` — тип врал вызывающему коду).
 */
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });
  }

  /**
   * `findFirst`, а не `findUnique`: с уходом `@unique` (SLT-44, functional index по
   * `lower(email)`) Prisma больше не считает `email` уникальным полем на уровне типов, и
   * `UserWhereUniqueInput` его не принимает — компилятор потребовал бы `id`. `findFirst`
   * такого ограничения не знает и подходит по смыслу: вызывающий всегда передаёт email,
   * уже пропущенный через `normalizeEmail` (см. AuthService), поэтому точное совпадение
   * `email` матчит не больше одной строки — ту же самую, что находит индекс по `lower()`.
   */
  findByEmail(email: string): Promise<SafeUser | null> {
    return this.prisma.user.findFirst({
      where: { email },
      select: SAFE_USER_SELECT,
    });
  }

  /**
   * Batch-резолв по id — единственным запросом, а не N штук в цикле (SLT-37: presence-снимок
   * может перечислять много юзеров разом). Порядок результата не гарантирован и не совпадает
   * с порядком `ids`; отсутствующие id (например, удалённый юзер) просто не попадают в ответ —
   * вызывающий трактует это как «нет данных», не как ошибку.
   */
  findManyByIds(ids: string[]): Promise<SafeUser[]> {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: SAFE_USER_SELECT,
    });
  }

  /**
   * ЕДИНСТВЕННЫЙ метод, достающий хеш пароля. Только для аутентификации (SLT-16).
   *
   * Отдельный метод, а не флаг `findByEmail(email, { withHash: true })`: флаг вернул бы
   * один union-тип на оба случая, и `.passwordHash` пришлось бы разыменовывать через
   * проверки в местах, где хеш не нужен и не запрашивался. Здесь два разных конкретных
   * типа — компилятор просто не даст обратиться к хешу после безопасного метода.
   *
   * Имя длинное и явное намеренно: `grep -r WithHash` показывает ПОЛНЫЙ список мест,
   * где хеш вообще касается кода. Такой список должен помещаться на экран.
   *
   * `findFirst` по той же причине, что и в findByEmail: `email` больше не `@unique` в схеме
   * (functional index по `lower(email)` живёт только в SQL миграции), поэтому
   * `UserWhereUniqueInput` его не принимает.
   */
  findByEmailWithHash(email: string): Promise<UserWithHash | null> {
    return this.prisma.user.findFirst({
      where: { email },
      select: USER_WITH_HASH_SELECT,
    });
  }

  /**
   * По id, с хешем. Нужен ровно одному сценарию — GET /auth/me, которому в контракте
   * требуется `hasPassword`.
   *
   * Почему нельзя обойтись findById: безопасная выборка НЕ содержит passwordHash
   * (в этом её смысл), а значит из неё физически невозможно вывести, есть ли у
   * пользователя пароль. Факт должен прийти оттуда, где хеш реально доступен.
   *
   * Наружу хеш при этом не уходит: вызывающий сразу сворачивает его в булев флаг
   * через UserService.hasPassword, а маппер перечисляет поля поимённо (см. toUserResponse).
   */
  findByIdWithHash(id: string): Promise<UserWithHash | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: USER_WITH_HASH_SELECT,
    });
  }

  /**
   * `id` не передаём: в схеме на User стоит `@default(uuid(7))` — его генерирует БД.
   * (Ср. Element: там `@default` намеренно НЕТ, потому что холст рисует фигуру до
   * ответа сервера и id должен существовать на клиенте раньше записи.)
   *
   * `select` нужен и на create: без него Prisma возвращает всю вставленную строку,
   * включая только что записанный хеш.
   *
   * `tx` — опциональный клиент транзакции (SLT-54): новый OAuth-пользователь создаётся
   * атомарно вместе с Account (`prisma.$transaction` в OAuthService.loginOAuth), и запись
   * обязана идти через ТОТ ЖЕ клиент — иначе она уйдёт в собственную транзакцию, и «атомарно»
   * станет неправдой. Без tx (password-регистрация) работает как раньше, через `this.prisma`.
   */
  async create(data: CreateUserData, tx?: Prisma.TransactionClient): Promise<SafeUser> {
    const client = tx ?? this.prisma;

    try {
      // `await` внутри try обязателен: без него промис уедет наружу и catch не сработает.
      return await client.user.create({
        data,
        select: SAFE_USER_SELECT,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new EmailAlreadyTakenError(data.email);
      }

      throw error;
    }
  }

  /**
   * Перезапись хеша прозрачным перехешем при логине (SLT-44): параметры argon2 подняли
   * ПОСЛЕ того, как хеш был записан, и мы обновляем его, не заставляя пользователя менять
   * пароль. Вызывающий (AuthService.login) оборачивает вызов в try/catch — сбой записи не
   * должен ронять логин, поэтому здесь она НЕ проглатывается сама, а просто выполняется как
   * обычная мутация.
   */
  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true },
    });
  }
}

/**
 * Единственное исключение из правила «репозиторий не бросает»: это не бизнес-проверка,
 * а ПЕРЕВОД ошибки ORM на язык домена. Сделать его больше негде — код P2002 виден только
 * здесь, а выше по стеку про Prisma знать не положено (см. CLAUDE.md: сервис не знает про ORM).
 *
 * Проверять `meta.target` намеренно не станем: его форма зависит от версии Prisma и
 * коннектора (то массив полей, то имя constraint'а), то есть это ненадёжная опора. У модели
 * User ровно один unique помимо первичного ключа — email; коллизия же uuid v7, который
 * генерирует БД, событие не того порядка вероятности, чтобы под него подстраивать код.
 * Поэтому любой P2002 при вставке пользователя — это занятый email.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
