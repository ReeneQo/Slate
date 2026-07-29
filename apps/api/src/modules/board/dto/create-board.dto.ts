import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { BOARD_TITLE_MAX_LENGTH } from '../board.constants';

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
 */
export class CreateBoardDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Название не может быть пустым' })
  @MaxLength(BOARD_TITLE_MAX_LENGTH, {
    message: `Название не длиннее ${BOARD_TITLE_MAX_LENGTH} символов`,
  })
  title?: string;
}
