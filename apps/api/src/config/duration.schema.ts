import { z } from 'zod';

type DurationUnit = 'ms' | 's' | 'm' | 'h' | 'd';

const MS_PER_UNIT: Record<DurationUnit, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Целое число + одна из единиц, без пробелов и дробей: "7d", "24h", "500ms".
 * Дробные и составные ("1.5d", "1d12h") намеренно не поддержаны — под конфиг
 * этого хватает, а разбор составных длительностей — лишняя сложность (KISS).
 */
const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

/**
 * Человекочитаемая длительность из env ("7d", "24h", "30m") → миллисекунды.
 *
 * .regex() выполняется первым и проверяет формат ДО .transform() — невалидная строка
 * оседает на этом шаге с понятным сообщением, а не доходит до парсинга как NaN.
 * Поэтому внутри .transform() совпадение уже гарантировано, и exec() безопасно
 * не возвращает null.
 */
export const durationToMs = z
  .string()
  .regex(DURATION_PATTERN, 'ожидается формат <число><ms|s|m|h|d>, например "7d" или "500ms"')
  .transform((value) => {
    const match = DURATION_PATTERN.exec(value)!;
    const amount = match[1]!;
    const unit = match[2]! as DurationUnit;
    return Number(amount) * MS_PER_UNIT[unit];
  })
  .refine((ms) => ms > 0, 'ожидается положительная длительность (> 0)');
