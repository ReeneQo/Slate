import { describe, expect, it } from 'vitest';

import { mapOAuthLinkErrorCode, mapOAuthLoginErrorCode } from './mapOAuthCode';

describe('mapOAuthLoginErrorCode', () => {
  it('noEmail → просьба открыть email или зарегистрироваться паролем', () => {
    expect(mapOAuthLoginErrorCode('noEmail')).toContain('email');
  });

  it('emailConflict → войдите паролем', () => {
    expect(mapOAuthLoginErrorCode('emailConflict')).toBe(
      'Этот email уже зарегистрирован. Войдите паролем.',
    );
  });

  it('неизвестный код → общее сообщение (не падает)', () => {
    expect(mapOAuthLoginErrorCode('somethingNew')).toBe('Что-то пошло не так. Попробуйте позже.');
  });
});

describe('mapOAuthLinkErrorCode', () => {
  it('alreadyLinked → привязан к другому аккаунту', () => {
    expect(mapOAuthLinkErrorCode('alreadyLinked')).toBe(
      'Этот GitHub уже привязан к другому аккаунту',
    );
  });

  it('неизвестный код → общее сообщение (не падает)', () => {
    expect(mapOAuthLinkErrorCode('somethingNew')).toBe('Что-то пошло не так. Попробуйте позже.');
  });
});
