import { type INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

import { ConfigService } from '../config/config.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { createSessionMiddleware } from '../infrastructure/session/session.factory';

/**
 * Обвязка приложения: префикс, middleware, глобальные пайпы. Всё, что стоит МЕЖДУ
 * созданием Nest-приложения и его запуском.
 *
 * Вынесено из main.ts ровно затем, чтобы e2e поднимали ТО ЖЕ приложение, а не похожее.
 * Пока конфигурация жила в bootstrap, у тестов было два одинаково плохих пути: повторить
 * её у себя — и разойтись при первой же правке, причём разойтись МОЛЧА, тесты остались бы
 * зелёными, — или тестировать голое приложение без сессий и валидации, то есть не то, что
 * уходит в прод.
 *
 * Порядок здесь — часть контракта, а не оформление:
 *
 * 1. helmet первым: заголовки безопасности должны стоять на ЛЮБОМ ответе, включая ошибки
 *    и 404, которые следующие слои могут вернуть раньше, чем дойдёт очередь.
 * 2. session вторым: к моменту работы роутов req.session уже разобран.
 * 3. cors последним из троицы, но до роутов.
 *
 * cookie-parser намеренно НЕ ставим: express-session сам читает и пишет свою куку, а его
 * документация прямо предупреждает о проблемах при расхождении секретов между ним и
 * cookie-parser. res.clearCookie — встроенный метод Express и парсер не требует.
 *
 * Чего здесь НЕТ и почему: `listen` и `enableShutdownHooks` остались в main.ts. Первое —
 * это запуск, а не конфигурация (e2e работают через `app.init()` и обращаются к серверу
 * напрямую, не занимая порт). Второе вешает обработчики SIGTERM/SIGINT на процесс — в
 * Jest-воркере это подписки на сигналы, которые тот использует по-своему.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  // Все маршруты под /api — фронт и будущий reverse-proxy рассчитывают на /api/*.
  app.setGlobalPrefix('api');

  app.use(helmet());

  // Session-store поднят на ОБЩЕМ ioredis-клиенте: достаём его из DI, а не создаём второй
  // коннект. ConfigService берём оттуда же, чтобы конфиг был один и тот же объект, а не
  // заново провалидированная копия.
  app.use(createSessionMiddleware(config, app.get(RedisService).client));

  // CORS для SPA (Vite). Origin — из конфига, credentials — обязателен: без него браузер
  // не отправит session-куку на кросс-origin запрос (5173 → 3000).
  app.enableCors({
    origin: config.app.allowedOrigin,
    credentials: true,
  });

  // Единая валидация входа. whitelist — срезает поля вне DTO, transform — приводит к типам DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
}
