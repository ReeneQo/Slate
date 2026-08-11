import { Injectable } from '@nestjs/common';
import type { Prisma } from '@slate/database';

import { HashService } from '../../shared/crypto/hash.service';
import type { SafeUser, UserWithHash } from './entities/user.entity';
import { UserRepository } from './user.repository';

/** Вход сервиса: пароль ОТКРЫТЫЙ. Хеширование — ответственность этого слоя. */
export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
}

/** Вход OAuth-регистрации (SLT-54): пароля нет как класса, хешировать нечего. */
export interface CreateOAuthUserInput {
  email: string;
  displayName: string;
}

/**
 * Бизнес-логика пользователя. PrismaService не инжектит и не импортирует — в БД ходит
 * только через UserRepository. Это и есть весь смысл слоя: подменив репозиторий, сервис
 * тестируется без базы, а смена ORM не расползается за пределы одного файла.
 *
 * Пока методы тонкие, и это нормально: сервис — заранее определённое место, куда придут
 * правила (проверка занятого email, нормализация, аудит) в SLT-16. Пробрасывать
 * репозиторий мимо сервиса ради экономии одной строки — значит развести два разных пути
 * к данным и потом искать, в каком из них забыли проверку.
 */
@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly hashService: HashService,
  ) {}

  /**
   * Открытый пароль хешируется ЗДЕСЬ и дальше не живёт: в репозиторий уходит уже хеш.
   * Так репозиторий физически не может записать пароль в открытом виде — даже по ошибке,
   * потому что он его не видит.
   *
   * Занятость email НЕ проверяется заранее: между SELECT и INSERT есть окно, в которое
   * проходят оба параллельных запроса (TOCTOU), и единственная настоящая защита — это
   * unique-constraint в БД. Репозиторий переводит его нарушение в EmailAlreadyTakenError,
   * а та прозрачно летит вызывающему — см. AuthService.register.
   *
   * @throws {EmailAlreadyTakenError} email занят
   */
  async create({ email, password, displayName }: CreateUserInput): Promise<SafeUser> {
    const passwordHash = await this.hashService.hash(password);

    return this.userRepository.create({ email, passwordHash, displayName });
  }

  /**
   * Создание OAuth-пользователя (SLT-54, ветка 3 резолва входа): `passwordHash: null` через
   * ТОТ ЖЕ путь, что и password-регистрация, но БЕЗ хеширования — хешировать нечего, пароля
   * нет как класса (не «пустая строка», а его отсутствие, ровно как читает `login` в
   * AuthService через `?? DUMMY_HASH`).
   *
   * `tx` пробрасывается насквозь до репозитория: OAuthService создаёт User и Account в одной
   * `prisma.$transaction`, и этот метод — единственная точка, где transaction-клиент входит
   * в модуль user. Без `tx` (сюда, впрочем, не попадает — вызывающий всегда в транзакции)
   * работал бы как обычная вставка.
   *
   * @throws {EmailAlreadyTakenError} email занят — гонка с параллельной регистрацией/входом
   * на тот же email, резолвится вызывающим (см. OAuthService.loginOAuth).
   */
  createOAuthUser(
    { email, displayName }: CreateOAuthUserInput,
    tx?: Prisma.TransactionClient,
  ): Promise<SafeUser> {
    return this.userRepository.create({ email, passwordHash: null, displayName }, tx);
  }

  findById(id: string): Promise<SafeUser | null> {
    return this.userRepository.findById(id);
  }

  /**
   * Нормализует email ЗДЕСЬ, а не полагается на нормализованный вход: `findByEmail` — общая
   * точка входа для auth (login) и board-sharing (резолв приглашаемого по email), и только
   * один из этих вызывающих исторически нормализовал email сам. Раз найти пользователя по
   * email в принципе означает «этот email нечувствителен к регистру» (см. функциональный
   * индекс `lower(email)` в БД), эта нормализация — инвариант метода, а не забота вызывающего.
   */
  findByEmail(email: string): Promise<SafeUser | null> {
    return this.userRepository.findByEmail(normalizeEmail(email));
  }

  /** Batch-резолв по id (см. UserRepository.findManyByIds) — для presence-снимка (SLT-37). */
  findManyByIds(ids: string[]): Promise<SafeUser[]> {
    return this.userRepository.findManyByIds(ids);
  }

  /**
   * Только для проверки пароля при логине (SLT-16). Всем остальным — findByEmail.
   * Нормализация — по той же причине, что и в findByEmail.
   */
  findByEmailWithHash(email: string): Promise<UserWithHash | null> {
    return this.userRepository.findByEmailWithHash(normalizeEmail(email));
  }

  /**
   * Только для GET /auth/me: там в контракте есть `hasPassword`, а вывести его из
   * безопасной выборки нельзя — в ней нет хеша. Всем остальным — findById.
   */
  findByIdWithHash(id: string): Promise<UserWithHash | null> {
    return this.userRepository.findByIdWithHash(id);
  }

  /**
   * «У пользователя есть пароль» ⇔ хеш не null (null — регистрация через OAuth).
   *
   * Наружу уходит именно этот флаг, а не хеш: клиенту нужно знать лишь, показывать ли
   * форму смены пароля. Принимает `Pick<..., 'passwordHash'>`, а не весь объект —
   * функции стоит просить ровно то, что она читает.
   */
  hasPassword(user: Pick<UserWithHash, 'passwordHash'>): boolean {
    return user.passwordHash !== null;
  }

  /** Прозрачная замена хеша при логине (SLT-44) — см. UserRepository.updatePasswordHash. */
  updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    return this.userRepository.updatePasswordHash(id, passwordHash);
  }
}

/**
 * Нормализация email перед записью и перед поиском.
 *
 * Регистр в почте не значим, а вводят адрес то так, то эдак. Без приведения `User@mail.ru`
 * и `user@mail.ru` — две разные строки: unique-constraint не считает их дубликатом
 * (получаются два аккаунта на один ящик), а поиск «неправильным» регистром не находит
 * существующего пользователя.
 *
 * Экспортирована отсюда (а не дублирована): AuthService нормализует email ПЕРЕД записью
 * (register) и, defense-in-depth, ещё раз перед поиском (login) — используя ЭТУ ЖЕ функцию,
 * а не вторую копию `trim().toLowerCase()`, которая рано или поздно разойдётся с этой.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
