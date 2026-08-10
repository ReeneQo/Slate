import {
  type AssertExact,
  DISPLAY_NAME_MAX_LENGTH,
  type ExactKeys,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type RegisterInput,
} from '@slate/shared-types';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import { Trim } from '../../../shared/decorators/trim.decorator';

/**
 * Вход регистрации.
 *
 * Границы длины пароля/имени берутся из общих констант (@slate/shared-types) — той же, что и
 * zod-схема фронта. MIN пароля — нижняя планка NIST SP 800-63B; MAX — защита сервера от
 * argon2-DoS (рационал — в auth.constants.ts). Правил сложности НЕТ намеренно: тот же стандарт
 * от них отговаривает.
 *
 * `passwordRepeat` из старого проекта не переносим. Совпадение двух полей — свойство ФОРМЫ, а
 * не запроса: сервер получает один пароль. Проверяет это фронт (SLT-25), там же, где оба поля.
 *
 * Поле называется `displayName`, а не `name` — ровно как колонка в схеме: разные имена по краям
 * одного пути данных означают маппинг «туда-обратно» и вопрос «это точно то же поле?».
 *
 * `implements RegisterInput` — форма входа одна на фронт и бэк, компилятор стережёт расхождение.
 */
export class RegisterDto implements RegisterInput {
  @IsEmail({}, { message: 'Некорректный email' })
  email!: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Имя не может быть пустым' })
  @MaxLength(DISPLAY_NAME_MAX_LENGTH, {
    message: `Имя не длиннее ${DISPLAY_NAME_MAX_LENGTH} символов`,
  })
  displayName!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Пароль не короче ${PASSWORD_MIN_LENGTH} символов` })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: `Пароль не длиннее ${PASSWORD_MAX_LENGTH} символов` })
  password!: string;
}

/** Сверка ключей в обе стороны — `implements` молчит про лишние поля класса (см. login.dto.ts). */
export type _RegisterDtoKeys = AssertExact<ExactKeys<keyof RegisterDto, keyof RegisterInput>>;
