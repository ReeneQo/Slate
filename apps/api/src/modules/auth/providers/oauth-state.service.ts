import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { OAuthMode } from './types';

/** Ключ state в Redis. Формат — доменное решение auth, RedisService про него не знает. */
function oauthStateKey(value: string): string {
  return `oauth:state:${value}`;
}

/** 10 минут — достаточно, чтобы пройти экран согласия GitHub, и достаточно коротко для CSRF-токена. */
const STATE_TTL_SECONDS = 600;

/**
 * Хранит одноразовый state-параметр OAuth-хендшейка в Redis: CSRF-защита authorize-URL
 * (без state callback принял бы code, добытый третьей стороной) плюс привязка к
 * провайдеру/режиму, под которые он выпущен.
 *
 * `randomBytes` (node:crypto), а не `Math.random` — state должен быть непредсказуем,
 * иначе его можно было бы подобрать/предсказать и подделать callback.
 */
@Injectable()
export class OAuthStateService {
  constructor(private readonly redis: RedisService) {}

  /** Генерирует state, кладёт (provider, mode) в Redis с TTL и возвращает сам state. */
  async create(provider: string, mode: OAuthMode): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const payload = JSON.stringify({ provider, mode });

    await this.redis.client.set(oauthStateKey(state), payload, 'EX', STATE_TTL_SECONDS);

    return state;
  }

  /**
   * Сверяет state и СРАЗУ удаляет его (`GETDEL` — атомарно, одной командой): повторное
   * предъявление того же state (replay) обязано провалиться, а не пройти второй раз.
   *
   * null — state не найден (не существовал, истёк или уже использован). Отличать эти
   * случаи друг от друга смысла нет: снаружи все они означают одно — «начни заново».
   */
  async consume(state: string): Promise<{ provider: string; mode: OAuthMode } | null> {
    const raw = await this.redis.client.getdel(oauthStateKey(state));

    if (raw === null) {
      return null;
    }

    return JSON.parse(raw) as { provider: string; mode: OAuthMode };
  }
}
