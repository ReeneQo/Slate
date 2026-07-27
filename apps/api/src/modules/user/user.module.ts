import { Module } from '@nestjs/common';

import { CryptoModule } from '../../shared/crypto/crypto.module';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

/**
 * PrismaService не импортируется: PrismaModule помечен @Global (SLT-12).
 *
 * Экспортируется ТОЛЬКО UserService. UserRepository остаётся внутренней деталью —
 * иначе AuthModule (SLT-16) сможет дотянуться до данных мимо сервиса, и правила модуля
 * начнут обходиться снаружи. Внешняя граница модуля — один вход.
 */
@Module({
  imports: [CryptoModule],
  providers: [UserRepository, UserService],
  exports: [UserService],
})
export class UserModule {}
