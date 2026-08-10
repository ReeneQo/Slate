import { Transform } from 'class-transformer';

/**
 * Тримит строковое поле на transform-фазе `ValidationPipe` (`plainToClass`), ДО валидации.
 *
 * Зачем отдельный декоратор, а не инлайновый `@Transform` на каждом DTO: без него `"   "`
 * (одни пробелы) проходит `@IsNotEmpty` — она проверяет длину строки, а не то, что в ней есть
 * непробельный символ. Один общий декоратор — одно место, где это исправлено, вместо повторения
 * одной и той же стрелочной функции по каждому полю каждого DTO.
 *
 * Guard на `typeof value === 'string'` обязателен: `@Transform` в class-transformer видит
 * значение ДО валидации типа, и не-строка (число, `undefined`, вложенный объект) не должна
 * ронять трансформ — за то, что это вообще строка, отвечает `@IsString` рядом.
 */
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
