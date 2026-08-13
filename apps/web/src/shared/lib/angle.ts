/**
 * Конверсия угла на границе Konva (SLT-27): модель хранит angle в РАДИАНАХ (контракт,
 * element.contracts.ts), Konva ждёт ГРАДУСЫ (`rotation` проп). Чистая математика без
 * Konva/React — переиспользуется и на чтении (рендер), и на записи (onTransformEnd).
 */

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

export function radToDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

/**
 * Нормализует угол (радианы) в диапазон [0, 2π). Konva.rotation() после нескольких
 * поворотов накапливает значения вне [0, 360) (может уйти в отрицательные или за 360) —
 * без нормализации модель копила бы неограниченно растущий/отрицательный angle, хотя
 * визуально это тот же самый угол. Двойной `% TWO_PI` — на случай отрицательного входа:
 * JS `%` сохраняет знак операнда (-10 % 360 === -10, не 350), поэтому один `%` не сводит
 * отрицательные углы в диапазон сам по себе.
 */
export function normalizeAngle(rad: number): number {
  return ((rad % TWO_PI) + TWO_PI) % TWO_PI;
}
