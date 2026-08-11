import { BadGatewayException, Injectable } from '@nestjs/common';

import { ConfigService } from '../../../config/config.service';
import { OAuthProvider } from './oauth-provider';
import type { NormalizedProfile, OAuthMode, RawTokens } from './types';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_BASE = 'https://api.github.com';

/** read:user — профиль (id/login/name/avatar). user:email — доступ к /user/emails. */
const SCOPES = ['read:user', 'user:email'];

/**
 * GitHub API ТРЕБУЕТ User-Agent на каждом запросе — без него 403 без внятного тела.
 * Значение произвольное, главное — не пустое.
 */
const USER_AGENT = 'Slate-App';

/** Ответ token_url при `Accept: application/json` (без него GitHub отдаёт form-urlencoded). */
interface GithubTokenResponse {
  access_token?: string;
  error?: string;
}

/** Подмножество полей GET /user, которое реально используется. */
interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

/** Элемент массива GET /user/emails. */
interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * GitHub-реализация OAuth-провайдера.
 *
 * Намеренно НЕ добавляет `access_type=offline`/`prompt=select_account` — это Google-
 * параметры авторизации, GitHub OAuth Apps их не понимает.
 */
@Injectable()
export class GithubOAuthProvider extends OAuthProvider {
  readonly name = 'github';

  constructor(private readonly config: ConfigService) {
    super();
  }

  getAuthUrl(state: string, mode: OAuthMode): string {
    const { clientId } = this.config.oauth.github;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: this.redirectUri(mode),
      scope: SCOPES.join(' '),
      state,
    });

    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, mode: OAuthMode): Promise<RawTokens> {
    const { clientId, clientSecret } = this.config.oauth.github;

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: this.redirectUri(mode),
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      // Без этого заголовка GitHub отвечает `application/x-www-form-urlencoded`
      // вместо JSON — тело пришлось бы парсить вручную query-string парсером.
      headers: { Accept: 'application/json' },
      body,
    });

    const data = (await response.json()) as GithubTokenResponse;

    if (!response.ok || !data.access_token) {
      // Не-2xx или ответ без access_token — сбой на стороне GitHub (upstream), а не вина
      // пользователя: 502, а не 401. Тело ответа GitHub наружу не идёт намеренно.
      throw new BadGatewayException('GitHub недоступен, попробуйте позже');
    }

    return { accessToken: data.access_token };
  }

  async fetchProfile(accessToken: string): Promise<NormalizedProfile> {
    const [user, emails] = await Promise.all([
      this.getUser(accessToken),
      this.getEmails(accessToken),
    ]);

    const primaryEmail = emails.find((entry) => entry.primary);

    return {
      provider: this.name,
      providerAccountId: String(user.id),
      email: primaryEmail?.email ?? null,
      emailVerified: primaryEmail?.verified === true,
      displayName: user.name ?? user.login,
      avatarUrl: user.avatar_url,
    };
  }

  private redirectUri(mode: OAuthMode): string {
    const path = mode === 'link' ? 'oauth/link/callback/github' : 'oauth/callback/github';

    return `${this.config.app.baseUrl}/api/auth/${path}`;
  }

  private async getUser(accessToken: string): Promise<GithubUser> {
    const response = await this.githubGet(`${API_BASE}/user`, accessToken);

    if (!response.ok) {
      // Как и в exchangeCode — сбой upstream (GitHub API), не вина пользователя.
      throw new BadGatewayException('GitHub недоступен, попробуйте позже');
    }

    return (await response.json()) as GithubUser;
  }

  private async getEmails(accessToken: string): Promise<GithubEmail[]> {
    const response = await this.githubGet(`${API_BASE}/user/emails`, accessToken);

    if (!response.ok) {
      throw new BadGatewayException('GitHub недоступен, попробуйте позже');
    }

    return (await response.json()) as GithubEmail[];
  }

  private githubGet(url: string, accessToken: string): Promise<Response> {
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
      },
    });
  }
}
