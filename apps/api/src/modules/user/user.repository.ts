import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  SAFE_USER_SELECT,
  type SafeUser,
  USER_WITH_HASH_SELECT,
  type UserWithHash,
} from './entities/user.entity';

/** Данные для вставки. `passwordHash` — УЖЕ захешированный: репозиторий не хеширует. */
export interface CreateUserData {
  email: string;
  passwordHash: string;
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

  findByEmail(email: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
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
   */
  findByEmailWithHash(email: string): Promise<UserWithHash | null> {
    return this.prisma.user.findUnique({
      where: { email },
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
   */
  create(data: CreateUserData): Promise<SafeUser> {
    return this.prisma.user.create({
      data,
      select: SAFE_USER_SELECT,
    });
  }
}
