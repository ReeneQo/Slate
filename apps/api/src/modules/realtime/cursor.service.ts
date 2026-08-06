import { Injectable } from '@nestjs/common';

import {
  type AppSocket,
  boardIdsFromRooms,
  boardRoom,
  extractCursorPosition,
} from './realtime.types';

/**
 * Потолок принятых `cursor_move` на сокет: ~40/сек (1000мс / 25мс). Клиент throttle-ит отправку до
 * 20-30/сек (SLT-37), потолок — запас над этим, не жёсткая граница нормального поведения.
 */
const CURSOR_MOVE_MIN_INTERVAL_MS = 25;

/**
 * Курсоры (SLT-36, 3.2) — серверный relay координат поверх presence (SLT-35): курсор шлёт тот, кто
 * уже в комнате доски и онлайн, но сам по себе canvas-курсор presence-членство не меняет и в реестр
 * онлайна (Redis) не пишется — это ОТДЕЛЬНЫЙ канал.
 *
 * Сервер — тупой relay, без хранения: принял координату от сокета A → отдал остальным в комнате.
 * Никакого персиста (ни БД, ни Redis) — курсор эфемерен, переживает ровно до следующего кадра или до
 * ухода из комнаты/офлайна. Redis тут в принципе неуместен: `cursor_move` — hot-path (десятки
 * событий/сек при движении мыши), а throttle-дроп не требует consistency между инстансами — это
 * защита от спама одного сокета, а не лимит ресурса или security-механизм (в отличие от
 * `ThrottlerModule` из SLT-30, который остаётся HTTP-only и сюда не подмешивается).
 *
 * Комната(ы) для relay — те же, что даёт `boardIdsFromRooms(socket.rooms)`: `cursor_move`/
 * `cursor_leave` не несут boardId в payload (курсор — не про конкретную доску, а про сокет), поэтому
 * relay идёт во ВСЕ комнаты, в которых сокет состоит прямо сейчас — тот же приём, что и у
 * `PresenceService.heartbeat`.
 */
@Injectable()
export class CursorService {
  /**
   * Relay `cursor_move` остальным членам комнаты. `socket.to(room)`, НЕ `server.in(room)` — эхо
   * отправителю не нужно, он свою позицию курсора и так знает.
   *
   * Два независимых слоя защиты от недоверенного клиента, оба — молчаливый дроп (не error, не
   * disconnect, не лог: throttle-дроп — штатное поведение под нагрузкой, десятки кадров/сек с
   * активного сокета, а не аномалия — debug-лог на каждый заспамил бы вывод; потерянный кадр
   * курсора незаметен, а спор из-за него того не стоит):
   *   1. Throttle — не чаще одного принятого события в `CURSOR_MOVE_MIN_INTERVAL_MS` на сокет.
   *      In-memory сравнение timestamp на `socket.data`, без таймеров и без Redis (см. класс-докстринг).
   *   2. Валидация формы — `extractCursorPosition` отсекает NaN/Infinity/не-числа. Проверяется
   *      ПОСЛЕ throttle: дешевле сначала отсечь частоту, чем гонять валидацию на каждый кадр спама.
   */
  handleCursorMove(socket: AppSocket, payload: unknown): void {
    const now = Date.now();
    const last = socket.data.lastCursorMoveAt;

    if (last !== undefined && now - last < CURSOR_MOVE_MIN_INTERVAL_MS) {
      return;
    }

    const position = extractCursorPosition(payload);

    if (position === null) {
      return;
    }

    socket.data.lastCursorMoveAt = now;

    const userId = socket.data.userId;

    for (const boardId of boardIdsFromRooms(socket.rooms)) {
      socket.to(boardRoom(boardId)).emit('cursor_move', { userId, x: position.x, y: position.y });
    }
  }

  /**
   * Relay `cursor_leave` остальным членам комнаты. Без throttle (дискретное редкое событие, не
   * поток) и без валидации (у события нет payload — разбирать нечего).
   */
  handleCursorLeave(socket: AppSocket): void {
    const userId = socket.data.userId;

    for (const boardId of boardIdsFromRooms(socket.rooms)) {
      socket.to(boardRoom(boardId)).emit('cursor_leave', { userId });
    }
  }
}
