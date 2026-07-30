import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { Authorization } from '../../shared/decorators/authorization.decorator';
import { Authorized } from '../../shared/decorators/authorized.decorator';
import type { ElementDto } from './dto/element.dto';
import { PatchElementDto } from './dto/patch-element.dto';
import { UpsertElementDto } from './dto/upsert-element.dto';
import { ElementService } from './element.service';

/**
 * Транспорт мутаций элемента. Ни одного правила — все решения принимает ElementService.
 *
 * МАРШРУТ ПЛОСКИЙ (`/elements/:id`), а не вложенный в доску (`/boards/:boardId/elements/:id`),
 * и это осознанный выбор. Идентификатор элемента глобально уникален (uuid v7 с клиента), так
 * что доска в пути ничего не адресует — зато становится вторым источником сведений о том, где
 * элемент лежит, и порождает вопрос «что если boardId в пути не совпадает с настоящей доской
 * элемента». Проверять пришлось бы всё равно по БД: путь давал бы иллюзию проверки, ничего не
 * проверяя. Плюс форма готова к реалтайму — в WebSocket-сообщении этапа 3 адресом события
 * будет тот же одиночный id.
 *
 * Чтения элементов здесь НЕТ — ни списка, ни одиночного. Список живёт в board-модуле
 * (`GET /boards/:id/elements`, SLT-19): это содержимое доски, оно грузится целиком при открытии
 * холста и по одному элементу никогда не запрашивается. Заводить `GET /elements/:id` ради
 * симметрии значило бы поддерживать эндпоинт, которого нет в клиентских сценариях.
 *
 * `@Authorization()` на КЛАССЕ — по той же причине, что в BoardController: новый роут,
 * добавленный сюда позже, оказывается закрытым сам собой. `@Authorized('id')` берёт
 * пользователя из СЕССИИ: ни один эндпоинт не принимает userId телом или параметром, иначе
 * владение задавал бы клиент.
 *
 * `ParseUUIDPipe` без указания версии — как в SLT-19: id элементов uuid v7, и `version: '4'`
 * отверг бы их все. Пайп превращает мусорный id в честный 400 до слоя данных; без него Prisma
 * уронила бы запрос ошибкой конвертации `@db.Uuid`, то есть 500 на кривой ссылке.
 */
@Controller('elements')
@Authorization()
export class ElementController {
  constructor(private readonly elementService: ElementService) {}

  /**
   * Upsert по клиентскому id: 201 — если элемент создан, 200 — если заменён или воскрешён.
   *
   * Разные статусы, а не один общий 200, потому что это единственное, чем ответ на создание
   * отличается от ответа на замену: тело в обоих случаях одинаковое. Для autosave разница
   * рабочая — «фигура впервые долетела до сервера» против «обновилась», и клиент узнаёт это
   * бесплатно, без лишнего поля в теле. Так же трактует PUT и HTTP-стандарт (RFC 9110 §9.3.4).
   *
   * `@Res({ passthrough: true })` вместо `@HttpCode`: последний статичен, а статус здесь зависит
   * от исхода операции. `passthrough` оставляет сериализацию ответа Nest'у — без него пришлось
   * бы самому звать `res.json()`, потеряв интерцепторы и единый формат ошибок.
   */
  @Put(':id')
  async upsert(
    @Param('id', ParseUUIDPipe) elementId: string,
    @Authorized('id') userId: string,
    @Body() dto: UpsertElementDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ElementDto> {
    const { element, isCreated } = await this.elementService.upsert(elementId, userId, dto);

    response.status(isCreated ? HttpStatus.CREATED : HttpStatus.OK);

    return element;
  }

  @Patch(':id')
  patch(
    @Param('id', ParseUUIDPipe) elementId: string,
    @Authorized('id') userId: string,
    @Body() dto: PatchElementDto,
  ): Promise<ElementDto> {
    return this.elementService.patch(elementId, userId, dto);
  }

  /**
   * 204 No Content — как и у доски: отдавать нечего. То, что удаление мягкое, снаружи не видно
   * и видно быть не должно: для клиента фигура исчезла с холста, а обратимость — деталь
   * хранения, на которую он не имеет права опираться.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) elementId: string,
    @Authorized('id') userId: string,
  ): Promise<void> {
    return this.elementService.remove(elementId, userId);
  }
}
