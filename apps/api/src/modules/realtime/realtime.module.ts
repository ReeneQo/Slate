import { Module } from '@nestjs/common';

import { RealtimeGateway } from './realtime.gateway';

/**
 * Realtime-модуль: держит WebSocket-gateway (SLT-32, фундамент этапа 3).
 *
 * Gateway — обычный провайдер Nest: DI инстанцирует его при инициализации приложения, а socket.io
 * привязывает к io-серверу, который поднимает кастомный адаптер (см. session-io.adapter). Границы
 * ответственности здесь важны: МОДУЛЬ владеет доменной частью realtime (обработчики соединения и,
 * позже, событий presence/sync), а АДАПТЕР — транспортной обвязкой io-сервера (CORS, session,
 * connection-level auth). Поэтому ws-auth-middleware, хоть и живёт рядом в этой же папке, в
 * провайдеры модуля не попадает: его подключает адаптер на этапе создания io-сервера, до того как
 * Nest начнёт инстанцировать gateway.
 */
@Module({
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
