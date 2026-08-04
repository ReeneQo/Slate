import { Module } from '@nestjs/common';

import { CryptoModule } from '../../shared/crypto/crypto.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsModule } from './sessions/sessions.module';

/**
 * Сборка блока 2: UserModule даёт доступ к данным (только через UserService — репозиторий
 * оттуда не экспортирован), SessionsModule — жизненный цикл сессии, CryptoModule — verify
 * пароля при логине.
 *
 * Троттлинг ЗДЕСЬ БОЛЬШЕ НЕ настраивается. Раньше ThrottlerModule.forRootAsync жил в этом
 * модуле, потому что лимиты нужны были ровно auth-роутам. В SLT-30 троттлинг стал глобальным
 * (infrastructure/throttler): guard висит через APP_GUARD на всех роутах, а конкретные
 * login/register-лимиты остались метаданными `@Throttle` на методах контроллера — они
 * переопределяют глобальный `default`, guard читает их рефлексией без импорта модуля здесь.
 */
@Module({
  imports: [UserModule, SessionsModule, CryptoModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
