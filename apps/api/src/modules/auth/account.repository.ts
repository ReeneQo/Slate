import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@slate/database';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ACCOUNT_SELECT, type AccountEntity } from './entities/account.entity';

/** Код Prisma для нарушения unique-constraint. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Чем закончилась попытка привязать Account. Различает именно репозиторий — только он видит
 * коды Prisma (та же граница, что у `CreateMemberOutcome` в BoardMemberRepository).
 *
 * `already-linked` — нарушение `@@unique([provider, providerAccountId])`: два параллельных
 * callback с одним и тем же providerAccountId (см. loginOAuth в OAuthService). Гонка
 * резолвится ЗДЕСЬ, а не у вызывающего: репозиторий перечитывает уже созданную первым запросом
 * запись и отдаёт её тем же путём, что и `created`, — вызывающему не нужно знать, что была
 * гонка, он просто получает Account для входа.
 */
export type CreateAccountOutcome =
  | { status: 'created'; account: AccountEntity }
  | { status: 'already-linked'; account: AccountEntity };

/**
 * Единственная точка доступа к Prisma для модели Account. OAuthService про Prisma не знает —
 * резолв входа (три ветки) обращается сюда, а не к `prisma.account.*` напрямую.
 *
 * «Тупой», как и остальные репозитории проекта: ни одной бизнес-проверки (email/verified —
 * забота OAuthService), только перевод ошибки ORM на язык домена.
 */
@Injectable()
export class AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Повторный вход: ищет привязку по паре (provider, providerAccountId). */
  findByProviderAccount(
    provider: string,
    providerAccountId: string,
  ): Promise<AccountEntity | null> {
    return this.prisma.account.findFirst({
      where: { provider, providerAccountId },
      select: ACCOUNT_SELECT,
    });
  }

  /**
   * Привязывает провайдера к пользователю: новый вход (ветка 3) или автолинковка к
   * существующему аккаунту по verified-email (ветка 2).
   *
   * `tx` — опциональный клиент транзакции: ветка 3 создаёт User и Account атомарно
   * (`prisma.$transaction`, см. OAuthService.loginOAuth), и репозиторий обязан писать через
   * ТОТ ЖЕ клиент, иначе вставки уйдут в разные транзакции и атомарность станет фикцией.
   * Ветка 2 (автолинковка к уже существующему User) tx не передаёт — там нечего связывать
   * атомарно, Account создаётся сам по себе.
   */
  async createForUser(
    userId: string,
    provider: string,
    providerAccountId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<CreateAccountOutcome> {
    const client = tx ?? this.prisma;

    try {
      const account = await client.account.create({
        data: { userId, provider, providerAccountId },
        select: ACCOUNT_SELECT,
      });

      return { status: 'created', account };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const existing = await this.findByProviderAccount(provider, providerAccountId);

        if (existing === null) {
          // P2002 говорит, что строка существует, а findFirst её не находит — это не гонка,
          // а нарушенная целостность (например, чужая транзакция откатилась ПОСЛЕ конфликта
          // вставки). Дальше молчать нельзя: вызывающий не сможет разрешить это сам.
          throw new InternalServerErrorException(
            'Account сообщил о конфликте, но повторное чтение не нашло запись',
          );
        }

        return { status: 'already-linked', account: existing };
      }

      throw error;
    }
  }
}

/**
 * Перевод ошибки ORM на язык домена — единственное, что репозиторию позволено решать про
 * ошибки. У Account ровно один unique помимо первичного ключа — (provider, providerAccountId),
 * поэтому любой P2002 при вставке — это он. Email-конфликты (EmailAlreadyTakenError) сюда не
 * попадают в принципе: это другая модель, другой репозиторий, другой catch (см. UserRepository).
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
