import {
  type AssertExact,
  BOARD_TITLE_MAX_LENGTH,
  type CreateBoardInput,
  type ExactKeys,
} from '@slate/shared-types';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Вход создания доски.
 *
 * `ownerId` здесь НЕТ — и это главное свойство этого класса, а не упущение. Владелец берётся
 * из сессии (`@Authorized('id')`), потому что тело запроса пишет клиент: поле `ownerId` во
 * входе означало бы «создай доску от имени любого пользователя по его id». Плюс второй
 * барьер, уже настроенный глобально: `ValidationPipe({ whitelist: true })` срезает поля вне
 * DTO, так что присланный `ownerId` не доживает даже до контроллера.
 *
 * `title` опционален: в схеме у него `@default("Untitled")`. Дефолт держит БД, а не сервер, —
 * иначе значение существует в двух местах и однажды разойдётся. Отсутствующий title
 * (`undefined`) Prisma в INSERT не включает, и колонку заполняет сам Postgres.
 *
 * `@IsNotEmpty` при опциональном поле не противоречие: не присылать название можно, а
 * присылать пустую строку — нет. Пустая строка это не «дефолт», а доска без имени в
 * интерфейсе, и молча подменять её на «Untitled» значило бы решать за пользователя.
 *
 * `implements CreateBoardInput` — привязка к общему контракту (@slate/shared-types). Валидация
 * остаётся на class-validator: она встроена в Nest-овый ValidationPipe и знает про DI. А вот
 * ФОРМА входа теперь одна на фронт и бэк, и компилятор её стережёт — расхождение полей падает
 * на сборке, а не 400-ым у пользователя. Границу длины оба берут из той же константы, так что
 * `@MaxLength` и zod-схема разойтись не могут.
 */
export class CreateBoardDto implements CreateBoardInput {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Название не может быть пустым' })
  @MaxLength(BOARD_TITLE_MAX_LENGTH, {
    message: `Название не длиннее ${BOARD_TITLE_MAX_LENGTH} символов`,
  })
  title?: string;
}

/**
 * `implements` проверяет контракт в ОДНУ сторону: поля схемы обязаны быть в классе. Про лишние
 * поля класса он молчит — и молчал бы как раз в опасном случае: поле, которое бэк принимает, а
 * контракт не описывает, фронт не увидит вовсе. Эта сверка закрывает вторую сторону.
 */
export type _CreateBoardDtoKeys = AssertExact<
  ExactKeys<keyof CreateBoardDto, keyof CreateBoardInput>
>;
