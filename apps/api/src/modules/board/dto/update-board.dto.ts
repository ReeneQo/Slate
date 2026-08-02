import {
  type AssertExact,
  BOARD_TITLE_MAX_LENGTH,
  type ExactKeys,
  type UpdateBoardInput,
} from '@slate/shared-types';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Вход переименования доски.
 *
 * `title` ОБЯЗАТЕЛЕН, хотя метод — PATCH. Формально PATCH допускает частичное обновление, но
 * изменяемое поле у доски сейчас ровно одно: запрос без него — это запрос, который ничего не
 * меняет, зато инкрементит version и обновляет updatedAt. То есть тихо портит данные вместо
 * того, чтобы сказать клиенту «ты ничего не передал». 400 честнее.
 *
 * Когда полей станет несколько (цвет фона, настройки сетки), они станут `@IsOptional()`, и
 * тогда же понадобится проверка «передано хотя бы одно» — на уровне класса, а не поля.
 * Заводить её сейчас, при единственном поле, нечего: она была бы копией `@IsNotEmpty`.
 *
 * Почему не `PartialType(CreateBoardDto)` из @nestjs/mapped-types: пакета в зависимостях нет,
 * а тащить его ради инверсии одного `@IsOptional()` — плохой обмен. К тому же связь
 * «обновление = частичное создание» здесь ложная: у создания title опционален из-за дефолта
 * БД, а у обновления обязателен по смыслу операции.
 */
export class UpdateBoardDto implements UpdateBoardInput {
  @IsString()
  @IsNotEmpty({ message: 'Название не может быть пустым' })
  @MaxLength(BOARD_TITLE_MAX_LENGTH, {
    message: `Название не длиннее ${BOARD_TITLE_MAX_LENGTH} символов`,
  })
  title!: string;
}

/** Сверка на лишние поля класса — см. пояснение в create-board.dto. */
export type _UpdateBoardDtoKeys = AssertExact<
  ExactKeys<keyof UpdateBoardDto, keyof UpdateBoardInput>
>;
