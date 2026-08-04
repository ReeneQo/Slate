import { Global, Module } from '@nestjs/common';

import { SessionGenerationService } from './session-generation.service';

/**
 * @Global — и это не «на всякий случай», а следствие того, кто потребитель.
 *
 * Поколение сверяет AuthGuard, а он висит на защищённых роутах ВСЕХ доменных модулей (auth,
 * board, element) через `@Authorization()`. Nest инстанцирует guard в контексте того модуля,
 * чей контроллер обрабатывает запрос, и резолвит его зависимости из ЕГО инъектора — значит
 * `SessionGenerationService` обязан быть доступен в каждом из них. Глобальный модуль раздаёт
 * его без импорта, ровно как это уже сделано для Redis/Prisma/Config.
 *
 * Почему НЕ положили сервис в SessionsModule и не пометили global его: SessionsModule — это
 * ЖИЗНЕННЫЙ ЦИКЛ сессии поверх `req.session` (защита от fixation, правило «в сессии только
 * userId»), сознательно локальный для auth (см. комментарий в app.module про то, что делать
 * его глобальным нельзя). Поколение — отдельная забота: это ИНВАЛИДАЦИЯ, кросс-режущий
 * Redis-счётчик, который читает глобальный guard. Разные оси ответственности — разные модули.
 */
@Global()
@Module({
  providers: [SessionGenerationService],
  exports: [SessionGenerationService],
})
export class SessionGenerationModule {}
