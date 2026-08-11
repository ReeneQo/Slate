import { Module } from '@nestjs/common';

import { CryptoModule } from '../../shared/crypto/crypto.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { ProvidersModule } from './providers/providers.module';
import { SessionsModule } from './sessions/sessions.module';

/**
 * Сборка блока 2: UserModule даёт доступ к данным (только через UserService — репозиторий
 * оттуда не экспортирован), SessionsModule — жизненный цикл сессии, CryptoModule — verify
 * пароля при логине. ProvidersModule (SLT-52) — OAuth-провайдеры и state-хранилище для
 * OAuthService; тот, в отличие от AuthService, не про пароль/сессию, а про хендшейк ДО
 * резолва входа.
 *
 * Троттлинг ЗДЕСЬ БОЛЬШЕ НЕ настраивается. Раньше ThrottlerModule.forRootAsync жил в этом
 * модуле, потому что лимиты нужны были ровно auth-роутам. В SLT-30 троттлинг стал глобальным
 * (infrastructure/throttler): guard висит через APP_GUARD на всех роутах, а конкретные
 * login/register-лимиты остались метаданными `@Throttle` на методах контроллера — они
 * переопределяют глобальный `default`, guard читает их рефлексией без импорта модуля здесь.
 */
@Module({
  imports: [UserModule, SessionsModule, CryptoModule, ProvidersModule],
  controllers: [AuthController],
  providers: [AuthService, OAuthService],
})
export class AuthModule {}
