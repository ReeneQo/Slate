import { parseElementData } from './element-data.schema';

/**
 * Геометрия — единственная часть элемента, которую не проверяет ни БД (jsonb хранит что угодно),
 * ни class-validator (форма зависит от типа фигуры). Значит, кроме этих тестов, её не проверяет
 * никто.
 */
describe('parseElementData', () => {
  describe('rect и ellipse', () => {
    it('принимает габаритную коробку', () => {
      const result = parseElementData('rect', { width: 120, height: 80 });

      expect(result).toEqual({ isValid: true, data: { width: 120, height: 80 } });
    });

    it('описывает эллипс той же коробкой, что и прямоугольник', () => {
      // Не «пока совпало»: эллипс рисуется вписанным в bounding box, поэтому схема одна.
      expect(parseElementData('ellipse', { width: 10, height: 10 }).isValid).toBe(true);
    });

    it('отвергает геометрию чужой фигуры', () => {
      // Самый вероятный баг клиента: сменил тип, забыл пересобрать data.
      const result = parseElementData('rect', { points: [0, 0, 10, 10] });

      expect(result.isValid).toBe(false);
    });

    it('отвергает нечисловые размеры', () => {
      const result = parseElementData('rect', { width: '120', height: 80 });

      expect(result.isValid).toBe(false);
    });

    it('отвергает лишние ключи, а не проглатывает их', () => {
      // Проглоченный radius означал бы, что клиент считает его сохранённым, а сервер о нём не
      // знает: расхождение всплывёт у второго пользователя, открывшего доску.
      const result = parseElementData('rect', { width: 10, height: 10, radius: 4 });

      expect(result.isValid).toBe(false);
    });

    it('называет в ошибке поле и тип фигуры', () => {
      const result = parseElementData('rect', { width: 10 });

      expect(result.isValid).toBe(false);
      expect(result).toMatchObject({
        errors: [expect.stringContaining('data.height') as string],
      });
      expect(result).toMatchObject({ errors: [expect.stringContaining('rect') as string] });
    });
  });

  describe('line', () => {
    it('принимает плоский массив координат', () => {
      const result = parseElementData('line', { points: [0, 0, 10, 10] });

      expect(result).toEqual({ isValid: true, data: { points: [0, 0, 10, 10] } });
    });

    it('отвергает нечётную длину — последняя координата осталась бы без пары', () => {
      const result = parseElementData('line', { points: [0, 0, 10, 10, 20] });

      expect(result.isValid).toBe(false);
    });

    it('отвергает линию короче двух точек', () => {
      const result = parseElementData('line', { points: [0, 0] });

      expect(result.isValid).toBe(false);
    });

    it('отвергает массив, в котором не только числа', () => {
      const result = parseElementData('line', { points: [0, 0, '10', 10] });

      expect(result.isValid).toBe(false);
    });
  });

  it('отвергает не-объект', () => {
    // Дошло бы сюда только мимо @IsObject в DTO — например, из WebSocket-хендлера этапа 3,
    // где DTO-классов не будет.
    expect(parseElementData('rect', null).isValid).toBe(false);
    expect(parseElementData('rect', 'width=120').isValid).toBe(false);
  });
});
