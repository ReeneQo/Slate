/**
 * Скачивание data URL как файла (SLT-66) — временный `<a download>`, программный клик, немедленный
 * cleanup. Ни одной существующей download-утилиты в проекте нет (проверено), и тянуть библиотеку
 * под один клик по ссылке незачем — нативного API достаточно.
 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
