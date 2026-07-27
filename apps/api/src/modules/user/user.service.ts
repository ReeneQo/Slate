import { Injectable } from '@nestjs/common';

import { HashService } from '../../shared/crypto/hash.service';
import type { SafeUser, UserWithHash } from './entities/user.entity';
import { UserRepository } from './user.repository';

/** Вход сервиса: пароль ОТКРЫТЫЙ. Хеширование — ответственность этого слоя. */
export interface CreateUserInput {
  email: string;
  password: string;
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
   */
  async create({ email, password, displayName }: CreateUserInput): Promise<SafeUser> {
    const passwordHash = await this.hashService.hash(password);

    return this.userRepository.create({ email, passwordHash, displayName });
  }

  findById(id: string): Promise<SafeUser | null> {
    return this.userRepository.findById(id);
  }

  findByEmail(email: string): Promise<SafeUser | null> {
    return this.userRepository.findByEmail(email);
  }

  /** Только для проверки пароля при логине (SLT-16). Всем остальным — findByEmail. */
  findByEmailWithHash(email: string): Promise<UserWithHash | null> {
    return this.userRepository.findByEmailWithHash(email);
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
}
