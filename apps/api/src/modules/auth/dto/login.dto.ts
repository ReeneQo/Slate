import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Те же границы, что и при регистрации.
 *
 * Верхняя особенно важна ИМЕННО здесь: логин — единственный анонимный эндпоинт, который
 * гарантированно доходит до argon2 (по DUMMY_HASH — даже для несуществующего email).
 * Без MaxLength любой желающий заставляет сервер молоть мегабайтные строки, не имея ни
 * одного аккаунта. Нижняя граница ничего не защищает, но экономит заведомо провальный
 * verify и — главное — держит форму ошибок одинаковой с регистрацией.
 */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

/**
 * Вход логина.
 *
 * Сообщения валидации сознательно нейтральные и НЕ говорят, существует ли такой email:
 * различать «нет такого пользователя» и «неверный пароль» — значит бесплатно отдать
 * оракул для перебора базы адресов. Единый ответ на оба случая формирует AuthService.
 */
export class LoginDto {
  @IsEmail({}, { message: 'Некорректный email' })
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Пароль не короче ${PASSWORD_MIN_LENGTH} символов` })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: `Пароль не длиннее ${PASSWORD_MAX_LENGTH} символов` })
  password!: string;
}
