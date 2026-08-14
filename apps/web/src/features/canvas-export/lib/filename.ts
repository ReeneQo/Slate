/**
 * Санитизация произвольной строки под имя файла (SLT-66): режем путе-разделители, кавычки и
 * прочие символы, недопустимые в именах файлов на основных ФС (Windows строже всех — берём её
 * запретный набор), схлопываем пробелы/повторы в один дефис, обрезаем дефисы по краям.
 */
export function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** YYYY-MM-DD в локальном времени (не UTC — имя файла отражает дату юзера, не сервера). */
function formatDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Имя PNG-файла экспорта доски (SLT-66, решение 7): `slate-{имя-или-id}-{YYYY-MM-DD}.png`. Имя
 * доски в приоритете, санитизуется; пусто/undefined после санитизации → id доски (санитизация id
 * не нужна — uuid уже безопасен для ФС).
 */
export function buildExportFilename(
  boardTitle: string | undefined,
  boardId: string,
  date: Date,
): string {
  const sanitizedTitle = boardTitle ? sanitizeFilenamePart(boardTitle) : '';
  const base = sanitizedTitle || boardId;
  return `slate-${base}-${formatDateStamp(date)}.png`;
}
