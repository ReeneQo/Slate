import type { Server, Socket } from 'socket.io';

/**
 * Типы транспорта realtime. Здесь — только фундамент этапа 3 (SLT-32): соединение и его
 * аутентификация. Бизнес-события (presence, курсоры, синхронизация элементов) появятся в
 * 3.2–3.4 и лягут в карты событий ниже — сейчас они пусты сознательно.
 *
 * Карты типизированы как `Record<string, never>`, а НЕ пустым интерфейсом `interface X {}`:
 * eslint (`no-empty-object-type`) справедливо запрещает второе — пустой интерфейс совместим
 * с чем угодно и молча гасит типизацию. `Record<string, never>` же означает ровно «событий
 * пока нет» и при этом удовлетворяет ограничению `EventsMap` дженериков socket.io
 * (значение-`never` присваиваемо сигнатуре обработчика). Первое событие 3.2 заменит нужную
 * карту на именованный интерфейс.
 */
export type ServerToClientEvents = Record<string, never>;
export type ClientToServerEvents = Record<string, never>;
export type InterServerEvents = Record<string, never>;

/**
 * Данные, привязанные к сокету на всё время соединения (`socket.data`).
 *
 * `userId` кладёт сюда ws-auth-middleware ПОСЛЕ успешной проверки сессии — анонимный сокет до
 * этой точки не доходит (соединение отклоняется на handshake). Поэтому поле обязательное, а не
 * опциональное: к моменту, когда до `socket.data` дотянется обработчик события, пользователь
 * уже гарантированно опознан. Presence этапа 3.2 добавит сюда свои поля рядом.
 */
export interface SocketData {
  userId: string;
}

/** Типизированный socket.io-сервер приложения. Дженерики фиксируют контракт событий и данных. */
export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Типизированный сокет одного клиента — с тем же контрактом, что и сервер. */
export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
