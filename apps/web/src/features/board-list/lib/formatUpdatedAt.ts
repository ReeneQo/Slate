/**
 * Формат даты последнего изменения для карточки доски. Список бэк сортирует по `updatedAt`, и
 * интерфейсу нужно показать «когда правил» человекочитаемо.
 *
 * `Intl.DateTimeFormat`, а не сторонняя библиотека дат: одна строка платформенного API против
 * лишней зависимости в бандле (KISS, «без новых библиотек без согласования»). Локаль `ru-RU`
 * фиксирована — интерфейс русскоязычный. Вход — ISO-строка из контракта (JSON дат не знает).
 */
const formatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  // Защита от битой строки: не роняем карточку из-за одной кривой даты.
  if (Number.isNaN(date.getTime())) return '';
  return formatter.format(date);
}
