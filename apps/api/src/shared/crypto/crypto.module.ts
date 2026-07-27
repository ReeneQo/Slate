import { Module } from '@nestjs/common';

import { HashService } from './hash.service';

/**
 * Криптографические примитивы для доменных модулей. НЕ @Global (в отличие от
 * Prisma/Redis): потребителей мало и они наперечёт — явный импорт держит зависимости
 * видимыми в графе модулей, а не растворёнными в глобальном скоупе.
 *
 * Импортируется UserModule (сейчас) и AuthModule (SLT-16).
 */
@Module({
  providers: [HashService],
  exports: [HashService],
})
export class CryptoModule {}
