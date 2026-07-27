import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CryptoModule } from './crypto.module';
import { HashService } from './hash.service';

/**
 * Потребитель с зависимостью, объявленной ТИПОМ параметра конструктора (без @Inject).
 *
 * Он здесь не случайно и не для красоты. Разрешить такую зависимость Nest может только
 * прочитав `design:paramtypes` — метаданные, которые эмитит транcформер при
 * `decoratorMetadata: true`. Если бы smoke-тест просто доставал HashService, он бы
 * прошёл ДАЖЕ со сломанным конфигом: у HashService конструктор без аргументов, разрешать
 * там нечего. Проверка была бы холостой.
 */
@Injectable()
class HashConsumer {
  constructor(readonly hashService: HashService) {}
}

/**
 * Тест инфраструктуры раннера, а не бизнес-логики.
 *
 * Он ловит ровно один класс дефектов: @swc/jest НЕ читает .swcrc сам, и если ему не
 * передать transform.decoratorMetadata, DI в тестах ломается. Причём ломается ТИХО —
 * проверено снятием флага: Nest не бросает «can't resolve dependencies», а не видит у
 * конструктора параметров вовсе и подставляет undefined. Поэтому утверждение здесь —
 * `toBeInstanceOf`, а не `toBeDefined()` на самом потребителе: второе прошло бы и на
 * сломанном конфиге. Чистые тесты (HashService, маппер) в том же прогоне остаются
 * зелёными — они и спрятали бы дефект до SLT-16, где DI понадобится по-настоящему.
 *
 * Prisma сюда намеренно не затянута: UserModule через UserRepository тянет PrismaService
 * и рантайм-импорт @slate/database, а тот резолвится в СОБРАННЫЙ dist пакета. Тесты
 * зависели бы от сборки воркспейса — тогда turbo-таску test пришлось бы вешать на ^build.
 * CryptoModule даёт ту же проверку метаданных без этой связи.
 */
describe('CryptoModule (smoke: DI в тестовой среде)', () => {
  it('компилирует тестовый модуль и резолвит провайдер по типу', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CryptoModule],
      providers: [HashConsumer],
    }).compile();

    const consumer = moduleRef.get(HashConsumer);

    expect(consumer.hashService).toBeInstanceOf(HashService);

    await moduleRef.close();
  });

  it('эмитит design:paramtypes для конструктора', () => {
    // Дублирует проверку выше на уровень ниже — чтобы при поломке было видно ПРИЧИНУ
    // («метаданных нет»), а не только следствие («Nest не смог разрешить зависимость»).
    const paramTypes: unknown = Reflect.getMetadata('design:paramtypes', HashConsumer);

    expect(paramTypes).toEqual([HashService]);
  });
});
