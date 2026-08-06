/**
 * Детерминированный цвет участника по userId (SLT-37): курсор и аватар одного юзера должны быть
 * одного цвета БЕЗ координации между клиентами — каждый вычисляет тот же цвет из того же userId
 * независимо, серверу для этого ничего передавать не нужно.
 *
 * Палитра — фиксированный конечный набор различимых цветов, а не произвольный HSL из хеша: так
 * все цвета заведомо контрастны фону холста и друг другу, что не гарантировать при случайном hue.
 */
const PALETTE = [
  '#c2613d',
  '#3d7fc2',
  '#3dc27f',
  '#c23d9e',
  '#c2a13d',
  '#7f3dc2',
  '#3dc2c2',
  '#c23d3d',
  '#6bc23d',
  '#3d4ec2',
] as const;

/** Хеш строки (djb2-подобный) → индекс палитры. Один и тот же userId всегда даёт один индекс. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function colorForUserId(userId: string): string {
  const index = hashString(userId) % PALETTE.length;
  // Индекс всегда в границах палитры (остаток от деления на её длину) — non-null assertion
  // отражает этот инвариант, а не глушит реальную возможность undefined.
  return PALETTE[index]!;
}
