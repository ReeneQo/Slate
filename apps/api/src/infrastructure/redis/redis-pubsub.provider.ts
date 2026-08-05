import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { RedisService } from './redis.service';

/**
 * Пара соединений pub/sub для Redis-адаптера socket.io (SLT-34, multi-instance broadcast).
 *
 * ПОЧЕМУ ДВА ОТДЕЛЬНЫХ СОЕДИНЕНИЯ, а не общий command-клиент (RedisService), как у сессий и
 * throttler'а (SLT-29): подписанное соединение Redis переходит в режим subscribe и с этого
 * момента принимает ТОЛЬКО подписочные команды — обычный publish/get/set на нём уже нельзя.
 * Поэтому переиспользовать основной клиент нельзя в принципе, и это осознанное исключение из
 * правила «один клиент»: sub держит подписку, pub публикует, а команды приложения (сессии,
 * throttle, кэш) остаются на своём клиенте. Два — это минимум, которого требует протокол, а не
 * запас на будущее.
 *
 * Соединения — `duplicate()` основного клиента, а НЕ второй Redis-сервер: тот же адрес и опции,
 * отдельные TCP-коннекты к одному инстансу. Адаптер (кастомный IoAdapter, вне DI-графа) получает
 * готовые pub/sub отсюда через configureApp — владелец их жизненного цикла провайдер, не адаптер.
 *
 * Подключение — в onModuleInit (привязано к старту Nest, а не к импорту модуля; заодно падение
 * Redis на старте всплывает сразу).
 *
 * Закрытие — в onApplicationShutdown, а НЕ в onModuleDestroy, и это принципиально. Соединениями
 * пользуется не доменный код, а Redis-адаптер socket.io на уровне ТРАНСПОРТА, и живут они, пока жив
 * io-сервер. Nest в app.close() идёт по порядку: onModuleDestroy → beforeApplicationShutdown →
 * dispose (тут закрывается socket-модуль, и адаптер в последний раз дёргает pub/sub: отписка,
 * рассылка leave) → onApplicationShutdown. Закрой мы соединения в onModuleDestroy — адаптер на
 * dispose слал бы команды в уже закрытый коннект, и ioredis сыпал бы «Connection is closed»
 * (в e2e — незакрытыми промисами, роняющими весь suite). onApplicationShutdown идёт ПОСЛЕ dispose,
 * когда адаптер с соединениями закончил. Закрытие обязательно: иначе в проде висят два коннекта на
 * каждый перезапуск, а в e2e Jest не завершается из-за открытых хендлов.
 */
@Injectable()
export class RedisPubSubProvider implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisPubSubProvider.name);

  readonly pub: Redis;
  readonly sub: Redis;

  constructor(redisService: RedisService) {
    this.pub = redisService.client.duplicate();
    this.sub = redisService.client.duplicate();

    // Тот же резон, что и в RedisService: без 'error'-листенера ioredis сыпет сырые стектрейсы
    // в stderr при каждом разрыве и в пределе всплывает как unhandledRejection. Переподключение
    // ioredis берёт на себя сам — достаточно залогировать.
    for (const [role, client] of [
      ['pub', this.pub],
      ['sub', this.sub],
    ] as const) {
      client.on('error', (error: Error) => {
        this.logger.warn(`Redis ${role} connection error: ${error.message}`);
      });
    }
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.connectLazily(this.pub), this.connectLazily(this.sub)]);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }

  /**
   * Поднять соединение, только если оно ещё «спит» (lazyConnect ⇒ статус 'wait').
   *
   * connect() бросает «Redis is already connecting/connected», если клиент уже НЕ в 'wait', а
   * Redis-адаптер socket.io при создании io-сервера сам подписывает sub (psubscribe → коннект).
   * Порядок биндинга gateway и вызова onModuleInit в Nest не зафиксирован, поэтому к этому хуку
   * соединение может быть уже поднято адаптером — тогда просто ничего не делаем (ioredis буферизует
   * команды до готовности). Явный connect() спящих соединений оставлен ради симметрии с RedisService:
   * падение Redis на старте всплывает здесь, а не отложенно на первом broadcast.
   */
  private async connectLazily(client: Redis): Promise<void> {
    if (client.status === 'wait') {
      await client.connect();
    }
  }
}
