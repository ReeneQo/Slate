/**
 * Единый источник метрик текста (SLT-61) — ЕДИНСТВЕННОЕ место, откуда их берут и Konva.Text
 * (ElementShape), и CSS textarea оверлея (TextEditor). Расхождение чисел между рендером и
 * оверлеем — это ровно тот «прыжок» текста при коммите, которого вся задача старается избежать,
 * поэтому оба потребителя обязаны импортировать эти же значения/функцию, а не заводить свои копии.
 *
 * Живёт в widgets/canvas/lib, а не прямо в ElementShape.tsx: константы, экспортированные из файла
 * React-компонента, ломают react-refresh (`only-export-components`) — HMR перестаёт понимать, что
 * менять при правке файла. Отдельный lib-модуль — тот же приём, что у zoom.ts/useSelection.ts
 * рядом.
 */

/**
 * Множитель fontSize, безразмерный: и Konva.Text.lineHeight, и CSS line-height (без единиц) —
 * оба множители шрифта своего узла, поэтому одно число подходит обеим системам без пересчёта на
 * scale вьюпорта.
 */
export const TEXT_LINE_HEIGHT = 1.2;

/**
 * Сознательно 0. Konva.Text.padding живёт в локальных координатах узла (холст, их же и
 * масштабирует Stage), а CSS padding — в экранных px независимо от холста; чтобы они совпали,
 * оверлею пришлось бы домножать padding на viewport.scale отдельно от паддинга-как-числа шрифта.
 * Это лишняя точка расхождения ради визуального отступа, которого сейчас никто не просил —
 * нулевой паддинг убирает саму возможность разъехаться, а не переносит риск в код оверлея.
 */
export const TEXT_PADDING = 0;

/**
 * Ключ семейства шрифта (data.fontFamily, см. fontFamilySchema в @slate/shared-types) → реальная
 * CSS/Konva font-family строка. data хранит КЛЮЧ, а не готовую CSS-строку (контракт остаётся
 * стабильным, даже если здесь сменится конкретный шрифт за 'sans'/'mono') — маппинг живёт здесь,
 * локально, и его же обязан звать оверлей для CSS font-family textarea (тот же единый источник).
 */
const FONT_FAMILY_CSS: Record<'sans' | 'mono', string> = {
  sans: 'system-ui, sans-serif',
  mono: 'ui-monospace, "Cascadia Code", monospace',
};

export function resolveFontFamily(fontFamily: 'sans' | 'mono'): string {
  return FONT_FAMILY_CSS[fontFamily];
}
