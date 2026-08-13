/**
 * Геометрия вьюпорта — чистая математика без DOM/React/домена, поэтому живёт
 * в shared: её используют и стор (entities), и рисование (features), и Konva-обёртка
 * (widgets). Держим тип трансформации в одном месте, чтобы не плодить дубли.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Аффинная трансформация полотна: screen = canvas * scale + offset.
 * Поля named под пропсы <Stage> (x/y — смещение, scale → scaleX/scaleY),
 * чтобы отдавать объект в Konva без переименований.
 *
 * Это персональное состояние вьюпорта (у каждого юзера своё), НЕ часть документа
 * доски — поэтому в бэк и в историю не уходит.
 */
export interface Viewport {
  scale: number;
  x: number;
  y: number;
}

/**
 * Экранные координаты указателя → координаты холста (с учётом pan/zoom).
 * Обратная к screen = canvas * scale + offset. Координаты элементов храним
 * именно в координатах холста, иначе фигуры «поплывут» при зуме/панораме.
 */
export function screenToCanvas(screen: Point, viewport: Viewport): Point {
  return {
    x: (screen.x - viewport.x) / viewport.scale,
    y: (screen.y - viewport.y) / viewport.scale,
  };
}

/**
 * Координаты холста → экранные координаты указателя. Точная инверсия screenToCanvas
 * (screen = canvas * scale + offset) — нужна текстовому оверлею (SLT-61): HTML-элемент ввода
 * живёт в DOM-координатах поверх Stage, а позиция редактируемого текста хранится в координатах
 * холста, поэтому оверлей обязан пересчитывать её при каждом пане/зуме.
 */
export function canvasToScreen(canvas: Point, viewport: Viewport): Point {
  return {
    x: canvas.x * viewport.scale + viewport.x,
    y: canvas.y * viewport.scale + viewport.y,
  };
}
