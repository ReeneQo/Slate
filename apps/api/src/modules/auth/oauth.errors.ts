/**
 * Доменные ошибки резолва OAuth-входа (OAuthService.loginOAuth). Не HttpException — по той же
 * причине, что и EmailAlreadyTakenError (см. user.errors.ts): решение «какой это HTTP/redirect»
 * принимает вызывающий (callback-роут в AuthController), а не сам резолв.
 */

/**
 * Провайдер не отдал ни одного email вообще. Slate требует email у пользователя (форма
 * регистрации его тоже требует) — входа без него нет, а не «заведём аккаунт без почты».
 */
export class OAuthNoEmailError extends Error {
  constructor() {
    super('OAuth-провайдер не предоставил email');
    this.name = 'OAuthNoEmailError';
  }
}

/**
 * Найден существующий User с тем же email, но провайдер НЕ подтвердил владение им
 * (`emailVerified === false`). Автолинковка в этом случае означала бы молча привязать чужой
 * GitHub-аккаунт к Slate-аккаунту по email, который никто не проверял, — отказываем.
 */
export class OAuthEmailNotVerifiedError extends Error {
  constructor(public readonly email: string) {
    super(`Email не подтверждён провайдером: ${email}`);
    this.name = 'OAuthEmailNotVerifiedError';
  }
}

/**
 * Гонка ветки 3 (новый пользователь): на момент проверки email был свободен, но к моменту
 * вставки его заняла конкурентная password-регистрация (или другой параллельный OAuth-вход
 * на тот же email) — `UserRepository.create` отдал `EmailAlreadyTakenError` на P2002.
 *
 * ОТДЕЛЬНАЯ ошибка, а не `OAuthEmailNotVerifiedError`: здесь email как раз verified — причина
 * отказа другая (аккаунт с этим email уже существует, просто появился позже нашей проверки),
 * и подсунуть пользователю «email не подтверждён» было бы неправдой, которая не объясняет,
 * что делать. Правильный путь для юзера — войти паролем и привязать GitHub вручную (SLT-56).
 */
export class EmailConflictError extends Error {
  constructor(public readonly email: string) {
    super(`Email уже зарегистрирован: ${email}`);
    this.name = 'EmailConflictError';
  }
}

/**
 * Привязка (SLT-56, `OAuthService.linkProfile`): (provider, providerAccountId) уже привязан
 * к ДРУГОМУ пользователю. К ТОМУ ЖЕ пользователю — не ошибка (см. докстринг linkProfile,
 * идемпотентный no-op).
 */
export class ProviderAlreadyLinkedError extends Error {
  constructor() {
    super('Этот аккаунт GitHub уже привязан к другому пользователю');
    this.name = 'ProviderAlreadyLinkedError';
  }
}

/** Отвязка (`OAuthService.unlinkProfile`) провайдера, которого у пользователя нет. */
export class AccountNotLinkedError extends Error {
  constructor() {
    super('Этот способ входа не привязан к вашему аккаунту');
    this.name = 'AccountNotLinkedError';
  }
}

/**
 * Отвязка последнего способа входа без пароля (`OAuthService.unlinkProfile`): у пользователя
 * нет `passwordHash`, а отвязываемый Account — единственный. Текст намеренно не обещает
 * «сначала задайте пароль» — эндпоинта смены/установки пароля без OAuth ещё нет в UI.
 */
export class LastAuthMethodError extends Error {
  constructor() {
    super('Нельзя отвязать единственный способ входа в аккаунт');
    this.name = 'LastAuthMethodError';
  }
}
