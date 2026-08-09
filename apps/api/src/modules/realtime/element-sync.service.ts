import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { upsertElementSchema } from '@slate/shared-types';

import { ElementService } from '../element/element.service';
import {
  type AppSocket,
  boardRoom,
  type ElementCreateAckResult,
  type ElementDeleteAckResult,
  elementDeletePayloadSchema,
  type ElementMutationRejectReason,
  type ElementUpdateAckResult,
  elementUpdatePayloadSchema,
  extractElementId,
  isInBoardRoom,
  toElementSyncDto,
} from './realtime.types';

/**
 * Двусторонняя синхронизация мутаций элементов (SLT-38, 3.3) — сервер начинает диктовать
 * изменения клиентам, впервые с начала этапа 3 (до сих пор поток был односторонним: клиент →
 * HTTP-autosave → персист, без broadcast обратно, SLT-27).
 *
 * ПЕРСИСТ — ЦЕЛИКОМ ЧЕРЕЗ ElementService, тот же, что у HTTP PUT/PATCH/DELETE (SLT-20). Ни
 * Prisma, ни ElementRepository здесь не видно вовсе — тот же инвариант, что развёл контроллер и
 * сервис: единственная точка правды о том, как элемент сохраняется, одна на оба транспорта.
 * `upsertEntity`/`patchVersioned`/`removeVersioned` — три метода, добавленные ElementService
 * именно под этот вызов; HTTP-путь (`upsert`/`patch`/`remove`) их не использует и не меняется.
 *
 * АВТОРИЗАЦИЯ — членство сокета в комнате доски (SLT-33), проверяется ДО обращения к
 * персист-слою: `isInBoardRoom` читает `socket.rooms`, а не переспрашивает BoardService —
 * комната и так гарантирует то же самое, что WS join_board уже проверил один раз, и повторный
 * поход в БД на каждую мутацию (autosave-путь, десятки в минуту) был бы лишним. Владение
 * элементом/доской ВСЁ РАВНО перепроверяется на уровне ElementService (тот же scope, что у
 * HTTP) — комната не заменяет эту проверку, а лишь добавляет требование «сейчас смотришь на
 * эту доску», которого у HTTP нет и не может быть.
 *
 * ИСКЛЮЧЕНИЯ HTTP-ПУТИ (BadRequestException/ConflictException/NotFoundException — те же классы,
 * что бросает `ElementService.upsert`/`upsertEntity`) здесь ЛОВЯТСЯ и переводятся в доменную
 * причину ack'а, а НЕ пробрасываются наружу: WS-канал не знает, что такое HTTP-статус, отказ
 * едет назад ack-callback'ом (см. `mapUpsertRejectReason`). `patchVersioned`/`removeVersioned`,
 * в отличие от `upsertEntity`, вообще не бросают — они спроектированы под этот вызов и сразу
 * отдают исход (см. их докстринг в ElementService), try/catch для них не нужен.
 *
 * BROADCAST — `socket.to(room)`, НЕ `server.in(room)`: тот же приём анти-эха, что у курсоров
 * (CursorService) — отправитель применил мутацию оптимистично локально и своё же событие
 * обратно получать не должен. Летит ПОЛНЫЙ элемент (не дельта) — идемпотентность, простота
 * клиентского мерджа (замена целиком) и устойчивость к пропущенным сообщениям (см. докстринг
 * ElementBroadcastPayload в realtime.types). Комната броадкаста — АВТОРИТЕТНЫЙ boardId с
 * персист-слоя (`element.boardId` из вернувшейся сущности), а не тот, что прислал клиент в
 * payload: payload'ный boardId участвует только в предварительной проверке членства, довериться
 * ему для адреса broadcast значило бы вещать по слову клиента, а не по факту, где элемент
 * реально лежит.
 */
@Injectable()
export class ElementSyncService {
  private readonly logger = new Logger(ElementSyncService.name);

  constructor(private readonly elementService: ElementService) {}

  /**
   * `element_create` — создание/замена/воскрешение по клиентскому id (та же тройная семантика,
   * что у HTTP PUT, SLT-20). `id` приходит В ПОЛЕЗНОЙ НАГРУЗКЕ, не в URL — на WS его негде
   * больше взять.
   */
  async handleCreate(socket: AppSocket, payload: unknown): Promise<ElementCreateAckResult> {
    const id = extractElementId(payload);
    const parsedInput = upsertElementSchema.safeParse(payload);

    if (id === null || !parsedInput.success) {
      return { ok: false, reason: 'invalid_payload' };
    }

    const input = parsedInput.data;

    if (!isInBoardRoom(socket, input.boardId)) {
      this.logger.debug(`element_create denied: user=${socket.data.userId} board=${input.boardId}`);
      return { ok: false, reason: 'access_denied' };
    }

    try {
      const { element } = await this.elementService.upsertEntity(id, socket.data.userId, input);
      const dto = toElementSyncDto(element);

      socket
        .to(boardRoom(element.boardId))
        .emit('element_created', { element: dto, userId: socket.data.userId });

      return { ok: true, element: dto };
    } catch (error) {
      return { ok: false, reason: mapUpsertRejectReason(error) };
    }
  }

  /** `element_update` — версионированный PATCH: изменения применяются только при совпавшей version. */
  async handleUpdate(socket: AppSocket, payload: unknown): Promise<ElementUpdateAckResult> {
    const parsed = elementUpdatePayloadSchema.safeParse(payload);

    if (!parsed.success) {
      return { ok: false, reason: 'invalid_payload' };
    }

    const { boardId, id, version, changes } = parsed.data;

    if (!isInBoardRoom(socket, boardId)) {
      this.logger.debug(`element_update denied: user=${socket.data.userId} board=${boardId}`);
      return { ok: false, reason: 'access_denied' };
    }

    const outcome = await this.elementService.patchVersioned(
      id,
      socket.data.userId,
      changes,
      version,
    );

    switch (outcome.status) {
      case 'applied': {
        const dto = toElementSyncDto(outcome.element);

        socket
          .to(boardRoom(outcome.element.boardId))
          .emit('element_updated', { element: dto, userId: socket.data.userId });

        return { ok: true, element: dto };
      }
      case 'version_conflict':
        return {
          ok: false,
          reason: 'version_conflict',
          element: toElementSyncDto(outcome.element),
        };
      case 'not_found':
        return { ok: false, reason: 'not_found' };
      case 'forbidden':
        return { ok: false, reason: 'forbidden' };
      case 'invalid_payload':
        return { ok: false, reason: 'invalid_payload' };
    }
  }

  /** `element_delete` — версионированное мягкое удаление: та же проверка version, что у update. */
  async handleDelete(socket: AppSocket, payload: unknown): Promise<ElementDeleteAckResult> {
    const parsed = elementDeletePayloadSchema.safeParse(payload);

    if (!parsed.success) {
      return { ok: false, reason: 'invalid_payload' };
    }

    const { boardId, id, version } = parsed.data;

    if (!isInBoardRoom(socket, boardId)) {
      this.logger.debug(`element_delete denied: user=${socket.data.userId} board=${boardId}`);
      return { ok: false, reason: 'access_denied' };
    }

    const outcome = await this.elementService.removeVersioned(id, socket.data.userId, version);

    switch (outcome.status) {
      case 'applied':
        socket.to(boardRoom(boardId)).emit('element_deleted', {
          id: outcome.id,
          version: outcome.version,
          userId: socket.data.userId,
        });

        return { ok: true, id: outcome.id, version: outcome.version };
      case 'version_conflict':
        return {
          ok: false,
          reason: 'version_conflict',
          element: toElementSyncDto(outcome.element),
        };
      case 'not_found':
        return { ok: false, reason: 'not_found' };
      case 'forbidden':
        return { ok: false, reason: 'forbidden' };
    }
  }
}

/**
 * HTTP-исключения `ElementService.upsertEntity` (тот же код, что у PUT, SLT-20/41) → доменная
 * причина ack'а. `ConflictException` покрывает ОБА 409-случая upsert'а (id занят другой доской,
 * смена типа существующего элемента) — они и на HTTP делят один текст по той же причине (см.
 * `elementIdTaken`/`elementTypeChanged`): различать их снаружи нечем и не нужно.
 *
 * `ForbiddenException` (SLT-41) — `forbiddenWrite()` из board-модуля: сокет в комнате (иначе
 * `isInBoardRoom` отклонил бы раньше, до вызова `upsertEntity` вообще), но роль `viewer` —
 * создавать/заменять/воскрешать элемент не может.
 */
function mapUpsertRejectReason(
  error: unknown,
): Exclude<ElementMutationRejectReason, 'version_conflict'> {
  if (error instanceof ConflictException) {
    return 'conflict';
  }

  if (error instanceof NotFoundException) {
    return 'not_found';
  }

  if (error instanceof ForbiddenException) {
    return 'forbidden';
  }

  if (error instanceof BadRequestException) {
    return 'invalid_payload';
  }

  throw error;
}
