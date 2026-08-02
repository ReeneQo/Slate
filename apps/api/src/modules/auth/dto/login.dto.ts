import {
  type AssertExact,
  type ExactKeys,
  type LoginInput,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@slate/shared-types';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Вход логина.
 *
 * Границы те же, что при регистрации, и берутся из общих констант (@slate/shared-types) —
 * той же, что и zod-схема фронта, поэтому `@MinLength`/`@MaxLength` и валидация формы разойтись
 * не могут. Верхняя особенно важна ИМЕННО здесь: логин — единственный анонимный эндпоинт,
 * который гарантированно доходит до argon2 (по DUMMY_HASH — даже для несуществующего email).
 * Без MaxLength любой заставляет сервер молоть мегабайтные строки, не имея ни одного аккаунта.
 *
 * Сообщения валидации сознательно нейтральные и НЕ говорят, существует ли такой email:
 * различать «нет пользователя» и «неверный пароль» — значит бесплатно отдать оракул для
 * перебора базы адресов. Единый ответ на оба случая формирует AuthService.
 *
 * `implements LoginInput` — привязка к общему контракту. Валидация остаётся на class-validator
 * (встроена в Nest ValidationPipe, знает про DI), а ФОРМА входа теперь одна на фронт и бэк, и
 * компилятор её стережёт: расхождение полей падает на сборке, а не 400-ым у пользователя.
 */
export class LoginDto implements LoginInput {
  @IsEmail({}, { message: 'Некорректный email' })
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Пароль не короче ${PASSWORD_MIN_LENGTH} символов` })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: `Пароль не длиннее ${PASSWORD_MAX_LENGTH} символов` })
  password!: string;
}

/**
 * `implements` проверяет контракт в ОДНУ сторону: поля схемы обязаны быть в классе. Про лишние
 * поля класса он молчит — и молчал бы в опасном случае: поле, которое бэк принимает, а контракт
 * не описывает, фронт не увидит вовсе. Эта сверка закрывает вторую сторону.
 */
export type _LoginDtoKeys = AssertExact<ExactKeys<keyof LoginDto, keyof LoginInput>>;
