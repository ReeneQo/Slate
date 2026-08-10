import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { HashService } from '../../shared/crypto/hash.service';
import { toUserResponse, type UserResponseDto } from '../user/dto/user-response.dto';
import { EmailAlreadyTakenError } from '../user/user.errors';
import { UserService } from '../user/user.service';
import { type AuthUserDto, toAuthUser } from './dto/auth-user.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { SessionGenerationService } from './sessions/session-generation.service';
import { SessionsService } from './sessions/sessions.service';

/**
 * Валидный argon2id-хеш от случайной строки, которую никто никогда не узнает.
 *
 * Нужен ровно для одного: чтобы логин занимал одинаковое время независимо от того,
 * существует ли пользователь. Без него код уходит из ветки «нет такого email» мгновенно,
 * а из ветки «email есть, пароль неверный» — через десятки миллисекунд работы argon2.
 * Разница измеряется обычным curl, и по ней перебирают, какие адреса зарегистрированы,
 * не зная при этом ни одного пароля.
 *
 * Параметры внутри строки (m=19456,t=2,p=1) СОВПАДАЮТ с ARGON2_OPTIONS в HashService —
 * иначе фиктивная проверка считалась бы быстрее настоящей, и timing-разница просто
 * поменяла бы знак вместо того, чтобы исчезнуть. Хеш зашит константой, а не генерируется
 * на старте: генерация — это лишние десятки миллисекунд на каждом бутстрапе и разные
 * значения между инстансами, а секретом он по построению не является.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$/RfxzyPHT6i9Hvz/OQWunw$gO/D5DohVWVolvEGPhWYQdpvyLgH6qiRzAsTRAjot+w';

/**
 * ОДНО сообщение на все причины отказа при входе. «Пользователь не найден» и «неверный
 * пароль» обязаны быть неразличимы — иначе форма логина превращается в бесплатный сервис
 * проверки «а этот email у вас зарегистрирован?».
 */
const INVALID_CREDENTIALS_MESSAGE = 'Неверный email или пароль';

/**
 * Сценарии входа и выхода. Prisma здесь не импортируется и не упоминается: данные идут
 * через UserService, сессия — через SessionsService. Именно поэтому весь файл тестируется
 * моками, без Postgres и Redis.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly sessionsService: SessionsService,
    private readonly hashService: HashService,
    private readonly sessionGeneration: SessionGenerationService,
  ) {}

  /**
   * Регистрация с авто-входом.
   *
   * Занятый email ловится ПОСЛЕ вставки, а не проверяется до неё. Предпроверка
   * (`findByEmail` → «занят?» → `create`) выглядит очевиднее, но она гонка: между чтением
   * и записью помещается второй такой же запрос, оба видят «свободно», и оба идут
   * создавать. Спасает в этот момент только unique-constraint — то есть настоящая проверка
   * всё равно происходит в БД. Предпроверка при этом не бесплатна: лишний round-trip на
   * каждую регистрацию плюс впечатление, будто защита есть в коде. Поэтому единственный
   * источник истины — constraint, а его нарушение приходит сюда доменной ошибкой из
   * репозитория.
   *
   * Пароль здесь НЕ хешируется: это делает UserService.create, который принимает открытый
   * пароль и отдаёт репозиторию уже хеш. Захешировать ещё и тут — значит записать в БД
   * хеш от хеша, и ни один логин после этого не пройдёт.
   *
   * saveSession в конце — «зарегистрировался = вошёл»: заставлять пользователя логиниться
   * сразу после регистрации теми же данными, которые он только что ввёл, нечем оправдать.
   */
  async register(request: Request, dto: RegisterDto): Promise<AuthUserDto> {
    const email = normalizeEmail(dto.email);

    const user = await this.createUser({ ...dto, email });

    await this.sessionsService.saveSession(request, user);

    return toAuthUser(user);
  }

  /**
   * Вход по паролю.
   *
   * Три отказных случая — нет пользователя, у пользователя нет пароля (OAuth), пароль
   * неверный — дают ОДИН ответ: один текст, один статус, одно время. Первые два не должны
   * быть отличимы снаружи от третьего.
   *
   * `verify` вызывается ВСЕГДА, даже когда пользователя нет, — тогда на DUMMY_HASH. Это и
   * есть выравнивание времени; ранний `return` в ветке «нет такого email» обнулил бы весь
   * смысл конструкции.
   *
   * После успешной проверки — best-effort перехеш (SLT-44): если ARGON2_OPTIONS подняли уже
   * ПОСЛЕ того, как этот хеш был записан, старая строка перезаписывается новой на тех же
   * параметрах, которыми хешируются пароли сейчас. Место вставки строго между verify и
   * saveSession: раньше плайн-пароль ещё не проверен, позже (`saveSession` делает
   * `regenerate`) — риска нет, но логике естественнее идти в порядке «проверили → обновили
   * запись → выдали сессию». Сам перехеш никогда не мешает входу: сбой записи в БД
   * проглатывается внутри rehashIfNeeded, а не летит наружу.
   *
   * Отдельно про OAuth-пользователя: `passwordHash === null` — не ошибка и не повод падать.
   * Такой аккаунт заведён без пароля, `??` уводит его в ту же фиктивную проверку, и он
   * получает ровно тот же отказ. Вызов `verify(null, ...)` уронил бы argon2 пятисоткой,
   * которая заодно сообщила бы, что аккаунт существует.
   */
  async login(request: Request, dto: LoginDto): Promise<AuthUserDto> {
    const email = normalizeEmail(dto.email);
    const user = await this.userService.findByEmailWithHash(email);

    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
    const isPasswordValid = await this.hashService.verify(hashToVerify, dto.password);

    if (user === null || user.passwordHash === null || !isPasswordValid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    await this.rehashIfNeeded(user.id, user.passwordHash, dto.password);
    await this.sessionsService.saveSession(request, user);

    return toAuthUser(user);
  }

  /** Выход: сессия уничтожается в хранилище, кука снимается у клиента. */
  logout(request: Request, response: Response): Promise<void> {
    return this.sessionsService.destroySession(request, response);
  }

  /**
   * «Выйти на всех устройствах» (SLT-31).
   *
   * Сдвигает поколение сессий пользователя одним атомарным INCR — и этого достаточно, чтобы
   * ВСЕ ранее выданные сессии перестали проходить сверку в guard'е и получили 401 на
   * следующем же защищённом запросе. Перечислять и удалять сами записи `sess:<sid>` не нужно
   * и невозможно: до чужих идентификаторов не дотянуться, а общий счётчик обесценивает их
   * разом.
   *
   * Вариант «полный»: сюда попадает и ТЕКУЩАЯ сессия инициатора — её снимок тоже остался в
   * прошлом поколении, так что инициатор вылетит вместе со всеми на своём следующем запросе.
   * Перевыпуск его сессии («выйти везде, КРОМЕ текущего устройства») и повторный ввод пароля
   * сознательно отложены в SLT-22 — здесь их нет.
   *
   * Важно, чем это НЕ является: обычный logout поколение не трогает и бьёт ровно одну сессию
   * через destroy. Сдвиг поколения — операция другой мощности и живёт только в этом методе;
   * никакие иные триггеры (смена пароля, удаление аккаунта) его пока не двигают.
   */
  async logoutAll(userId: string): Promise<void> {
    await this.sessionGeneration.bump(userId);
  }

  /**
   * «Кто я по этой куке». Вызывается фронтом на старте приложения, чтобы восстановить
   * состояние входа, поэтому отдаёт ПОЛНЫЙ контракт, включая `hasPassword`.
   *
   * Идёт в БД за актуальными данными, а не берёт их из сессии: в сессии лежит только
   * userId — ровно затем, чтобы переименование или смена email не жили в куке своей жизнью.
   *
   * `findByIdWithHash`, а не `findById`: из безопасной выборки `hasPassword` не вывести —
   * в ней нет хеша. Наружу хеш при этом не уходит, он сворачивается в булев флаг строкой
   * ниже, а маппер перечисляет поля поимённо.
   *
   * null означает, что сессия ссылается на удалённого пользователя, — это 401, а не 404:
   * ресурс не «не найден», а предъявленные учётные данные больше не действительны. Кука в
   * этом случае гасится тем же destroySession, что и обычный logout: иначе клиент получает
   * 401 на каждый следующий /me, но кука-«зомби» на несуществующего пользователя продолжает
   * жить в браузере до истечения TTL.
   */
  async getMe(userId: string, request: Request, response: Response): Promise<UserResponseDto> {
    const user = await this.userService.findByIdWithHash(userId);

    if (user === null) {
      await this.sessionsService.destroySession(request, response);
      throw new UnauthorizedException('Сессия недействительна');
    }

    return toUserResponse(user, this.userService.hasPassword(user));
  }

  /**
   * Best-effort перехеш пароля при логине (SLT-44).
   *
   * «Best-effort» означает: сбой записи НЕ должен ронять логин, поэтому единственная
   * доменная ошибка, которую этот метод может произвести наружу, — отсутствует в принципе,
   * try/catch ловит всё. Пользователь и так уже прошёл verify — отказать ему во входе из-за
   * упавшей фоновой перезаписи хеша было бы явно хуже, чем оставить старый хеш ещё немного.
   *
   * `plainPassword` доступен только здесь и только в этот момент: это единственное место
   * во всём login, где открытый пароль вообще нужен ПОСЛЕ verify.
   */
  private async rehashIfNeeded(
    userId: string,
    currentHash: string,
    plainPassword: string,
  ): Promise<void> {
    if (!this.hashService.needsRehash(currentHash)) {
      return;
    }

    try {
      const newHash = await this.hashService.hash(plainPassword);
      await this.userService.updatePasswordHash(userId, newHash);
    } catch (error) {
      // Пароль/хеш в лог не идут намеренно — только факт сбоя и его причина.
      this.logger.warn('Не удалось перехешировать пароль при логине', error);
    }
  }

  /**
   * Создание с переводом доменной ошибки в HTTP-ответ. Вынесено отдельно, чтобы try/catch
   * не разрывал основной сценарий register и было видно, что ловится ровно один случай.
   */
  private async createUser(input: RegisterDto): Promise<SafeUserResult> {
    try {
      return await this.userService.create(input);
    } catch (error) {
      if (error instanceof EmailAlreadyTakenError) {
        throw new ConflictException('Пользователь с таким email уже существует');
      }

      // Всё остальное (упавший Postgres, битый конфиг) — не наш случай: пробрасываем как
      // есть, чтобы 500 осталась 500, а не превратилась в невнятный 409.
      throw error;
    }
  }
}

/** Возврат UserService.create — вынесен в псевдоним, чтобы не тянуть импорт сущности ради одной подписи. */
type SafeUserResult = Awaited<ReturnType<UserService['create']>>;

/**
 * Нормализация email перед записью и перед поиском.
 *
 * Регистр в почте не значим, а вводят адрес то так, то эдак. Без приведения `User@mail.ru`
 * и `user@mail.ru` — две разные строки: unique-constraint не считает их дубликатом
 * (получаются два аккаунта на один ящик), а логин «неправильным» регистром не находит
 * существующего пользователя.
 *
 * Ключевое — одна и та же функция применяется и в register, и в login. Нормализация только
 * при записи даёт гарантированный баг «зарегистрировался, а войти не могу».
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
