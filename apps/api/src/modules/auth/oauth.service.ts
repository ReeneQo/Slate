import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';

import type { OAuthProvider } from './providers/oauth-provider';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';
import { OAuthStateService } from './providers/oauth-state.service';
import type { NormalizedProfile } from './providers/types';

/**
 * OAuth-хендшейк ДО резолва входа: выдача authorize-URL и обмен code→нормализованный
 * профиль. Отдельно от `AuthService` намеренно — тот отвечает за сценарии пароля
 * (register/login/logout) и не знает про провайдеров/state; здесь свой набор зависимостей
 * (реестр провайдеров, Redis-state), и смешивать их в одном сервисе означало бы раздувать
 * AuthService конструктором ради несвязанной ответственности.
 *
 * `resolveProfile` — граница SLT-52: возвращает профиль и НЕ создаёт User/Account, не
 * трогает Prisma, не вклеивает сессию. Резолв входа (существующий/новый/линковка) и вызов
 * этого метода из callback-роута — SLT-54.
 */
@Injectable()
export class OAuthService {
  constructor(
    private readonly registry: OAuthProviderRegistry,
    private readonly state: OAuthStateService,
  ) {}

  /**
   * Выдаёт authorize-URL для входа. Режим здесь всегда `'login'` — вход в приложение;
   * `mode='link'` (привязка провайдера к существующему аккаунту) появится в SLT-56 отдельным
   * эндпоинтом, не этим.
   */
  async getConnectUrl(providerName: string): Promise<{ url: string }> {
    const provider = this.getProviderOrThrow(providerName);
    const state = await this.state.create(providerName, 'login');

    return { url: provider.getAuthUrl(state, 'login') };
  }

  /**
   * Сверяет state, обменивает code на токен и возвращает нормализованный профиль.
   *
   * `stored.provider !== provider` ловит подмену: state, выпущенный для одного провайдера,
   * предъявлен на callback другого. Ответ на оба случая — один и тот же 401 без деталей,
   * иначе различие в сообщении само стало бы утечкой (подтверждало бы существование
   * настоящего state под другим провайдером).
   */
  async resolveProfile(
    providerName: string,
    code: string,
    state: string,
  ): Promise<NormalizedProfile> {
    const provider = this.getProviderOrThrow(providerName);
    const stored = await this.state.consume(state);

    if (stored === null || stored.provider !== providerName) {
      throw new UnauthorizedException('Недействительный или истёкший state');
    }

    const tokens = await provider.exchangeCode(code, stored.mode);

    return provider.fetchProfile(tokens.accessToken);
  }

  private getProviderOrThrow(providerName: string): OAuthProvider {
    const provider = this.registry.get(providerName);

    if (!provider) {
      throw new BadRequestException(`Неизвестный OAuth-провайдер: ${providerName}`);
    }

    return provider;
  }
}
