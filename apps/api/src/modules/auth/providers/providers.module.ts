import { Module } from '@nestjs/common';

import { GithubOAuthProvider } from './github-oauth.provider';
import { OAuthProviderRegistry } from './oauth-provider.registry';
import { OAuthStateService } from './oauth-state.service';

/**
 * Сборка OAuth-провайдеров. Экспортирует только реестр и state-хранилище — конкретные
 * классы провайдеров (`GithubOAuthProvider`) наружу не уходят: снаружи с провайдером
 * работают исключительно через `OAuthProviderRegistry.get(name)`.
 */
@Module({
  providers: [GithubOAuthProvider, OAuthProviderRegistry, OAuthStateService],
  exports: [OAuthProviderRegistry, OAuthStateService],
})
export class ProvidersModule {}
