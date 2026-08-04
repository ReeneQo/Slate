import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { Authorization } from '../../shared/decorators/authorization.decorator';
import { Authorized } from '../../shared/decorators/authorized.decorator';
import type { ElementDto } from '../element/dto/element.dto';
import { BoardService } from './board.service';
import type { BoardDto } from './dto/board.dto';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';

/**
 * Транспорт: принять, отдать, назначить статус. Ни одного правила — все решения принимает
 * BoardService.
 *
 * `@Authorization()` висит на КЛАССЕ, а не на каждом методе. Это не экономия шести строк:
 * защита по умолчанию означает, что новый роут, добавленный сюда в SLT-20 или позже,
 * оказывается закрытым сам собой, а открыть его можно только осознанно. Обратный порядок
 * (декоратор на методах) когда-нибудь заканчивается одним незакрытым роутом, которого не видно
 * ни в типах, ни в тестах — и он же и будет дырой.
 *
 * `@Authorized('id')` берёт идентификатор из СЕССИИ. Ни один эндпоинт не принимает userId или
 * ownerId параметром или в теле — иначе владение задавал бы клиент.
 *
 * `ParseUUIDPipe` на `:id` не косметика. В схеме id — `@db.Uuid`, и Prisma, получив строку
 * «abc», уронит запрос ошибкой конвертации, то есть 500 на кривой ссылке. Пайп превращает это
 * в честный 400 ещё до слоя данных. Версию UUID пайпу намеренно не задаём: id досок — uuid v7
 * (`@default(uuid(7))`), а `ParseUUIDPipe({ version: '4' })` отверг бы их все.
 *
 * Throttling здесь СВОИХ декораторов не имеет — и это правильно. С SLT-30 глобальный
 * ThrottlerGuard (APP_GUARD) накрывает все роуты общим baseline (`default`, 100/мин на
 * клиента), поэтому board-роуты защищены сами собой, без строчки на контроллере. Точечные
 * декораторы нужны только там, где поведение отличается от baseline: `@SkipThrottle` на
 * `/health`, `@Throttle` на autosave-пути элементов. У досок такой нужды нет.
 */
@Controller('boards')
@Authorization()
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  /** 201 — дефолт Nest для POST, и он здесь верен: доска действительно создана. */
  @Post()
  create(@Authorized('id') userId: string, @Body() dto: CreateBoardDto): Promise<BoardDto> {
    return this.boardService.create(userId, dto);
  }

  @Get()
  findAll(@Authorized('id') userId: string): Promise<BoardDto[]> {
    return this.boardService.findAllOwned(userId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) boardId: string,
    @Authorized('id') userId: string,
  ): Promise<BoardDto> {
    return this.boardService.findOne(boardId, userId);
  }

  /**
   * Содержимое доски отдельным запросом, а не полем в `GET /boards/:id`. Метаданные нужны
   * списку и заголовку экрана, элементы — только холсту, и на большой доске их тысячи:
   * склеив их в один ответ, мы бы заставили каждый дешёвый запрос платить за самый дорогой.
   */
  @Get(':id/elements')
  findElements(
    @Param('id', ParseUUIDPipe) boardId: string,
    @Authorized('id') userId: string,
  ): Promise<ElementDto[]> {
    return this.boardService.findElements(boardId, userId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) boardId: string,
    @Authorized('id') userId: string,
    @Body() dto: UpdateBoardDto,
  ): Promise<BoardDto> {
    return this.boardService.update(boardId, userId, dto);
  }

  /**
   * 204 No Content: отдавать нечего. `{ success: true }` был бы полем, которое фронт обязан
   * проверять, чтобы узнать то же самое, что уже сказал статус.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) boardId: string,
    @Authorized('id') userId: string,
  ): Promise<void> {
    return this.boardService.remove(boardId, userId);
  }
}
