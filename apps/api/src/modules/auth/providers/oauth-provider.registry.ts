import { Injectable } from '@nestjs/common';

import { GithubOAuthProvider } from './github-oauth.provider';
import type { OAuthProvider } from './oauth-provider';

/**
 * Реестр OAuth-провайдеров по имени (`'github'` → инстанс). Единственное место, которое
 * знает про ВСЕ провайдеры разом — `OAuthService` работает только с этим реестром и не
 * ссылается на конкретные классы-провайдеры.
 *
 * Новый провайдер (вне этой таски) — новый параметр конструктора и одна строка в Map,
 * без изменений в OAuthService/AuthController.
 */
@Injectable()
export class OAuthProviderRegistry {
  private readonly providers: Map<string, OAuthProvider>;

  constructor(githubProvider: GithubOAuthProvider) {
    this.providers = new Map([[githubProvider.name, githubProvider]]);
  }

  get(name: string): OAuthProvider | undefined {
    return this.providers.get(name);
  }
}
