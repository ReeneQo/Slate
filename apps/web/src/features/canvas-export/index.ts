/**
 * Публичная поверхность фичи canvas-export (SLT-66). Внешние слои (widgets/canvas) импортируют
 * `@/features/canvas-export`, а не внутренние файлы — раскладка (lib/ui) остаётся деталью
 * реализации.
 *
 * Наружу торчит только кнопка: bbox-математика/pixelRatio/санитизация имени/download — внутренняя
 * механика.
 */
export { ExportButton } from './ui/ExportButton';
