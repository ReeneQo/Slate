import { Module } from '@nestjs/common';

/**
 * Корневой модуль. Сюда подключаются доменные модули из `modules/`
 * и инфраструктура из `infrastructure/` по мере их появления.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
