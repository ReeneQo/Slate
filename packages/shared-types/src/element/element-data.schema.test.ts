import { describe, expect, it } from 'vitest';

import { parseElementData } from './element-data.schema.js';

/**
 * Геометрия — единственная часть элемента, которую не проверяет ни БД (jsonb хранит что угодно),
 * ни class-validator (форма зависит от типа фигуры). Значит, кроме этих тестов, её не проверяет
 * никто.
 *
 * Тесты переехали сюда вместе со схемой (SLT-23) и сменили раннер на vitest: жить им положено
 * рядом с проверяемым кодом, а не в приложении, которое этот код всего лишь импортирует.
 * Глобали (`describe`/`it`) импортируются явно — так пакету не нужен конфиг vitest вовсе.
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

  describe('freedraw', () => {
    it('принимает плоский массив координат', () => {
      const result = parseElementData('freedraw', { points: [0, 0, 10, 10] });

      expect(result).toEqual({ isValid: true, data: { points: [0, 0, 10, 10] } });
    });

    it('принимает одиночную точку (клик без движения — точка-клякса)', () => {
      const result = parseElementData('freedraw', { points: [5, 5] });

      expect(result.isValid).toBe(true);
    });

    it('отвергает нечётную длину', () => {
      const result = parseElementData('freedraw', { points: [0, 0, 10, 10, 20] });

      expect(result.isValid).toBe(false);
    });

    it('отвергает пустой массив', () => {
      const result = parseElementData('freedraw', { points: [] });

      expect(result.isValid).toBe(false);
    });

    it('отвергает массив, в котором не только числа', () => {
      const result = parseElementData('freedraw', { points: [0, 0, '10', 10] });

      expect(result.isValid).toBe(false);
    });
  });

  describe('arrow', () => {
    it('переиспользует схему line — те же границы и проверки', () => {
      // arrow геометрически идентична line (два конца отрезка); отдельной arrowDataSchema нет,
      // наконечник — стиль отрисовки, не геометрия.
      const result = parseElementData('arrow', { points: [0, 0, 10, 10] });

      expect(result).toEqual({ isValid: true, data: { points: [0, 0, 10, 10] } });
    });

    it('отвергает стрелку короче двух точек', () => {
      const result = parseElementData('arrow', { points: [0, 0] });

      expect(result.isValid).toBe(false);
    });

    it('называет в ошибке тип arrow, а не line', () => {
      const result = parseElementData('arrow', { points: [0, 0] });

      expect(result).toMatchObject({ errors: [expect.stringContaining('arrow') as string] });
    });
  });

  describe('text', () => {
    it('принимает текст с шрифтом', () => {
      const result = parseElementData('text', { text: 'привет', fontSize: 20, fontFamily: 'sans' });

      expect(result).toEqual({
        isValid: true,
        data: { text: 'привет', fontSize: 20, fontFamily: 'sans' },
      });
    });

    it('принимает пустую строку (валидность геометрии — не то же самое, что isCommittable на клиенте)', () => {
      // parseElementData проверяет ТОЛЬКО форму, не «стоит ли коммитить пустой текст» — это
      // отдельное клиентское правило (isCommittable), пустая строка — законное значение поля.
      const result = parseElementData('text', { text: '', fontSize: 20, fontFamily: 'sans' });

      expect(result.isValid).toBe(true);
    });

    it('отвергает текст длиннее TEXT_MAX_LENGTH', () => {
      const result = parseElementData('text', {
        text: 'a'.repeat(10_001),
        fontSize: 20,
        fontFamily: 'sans',
      });

      expect(result.isValid).toBe(false);
    });

    it('отвергает fontSize меньше нижней границы', () => {
      const result = parseElementData('text', { text: 'a', fontSize: 7, fontFamily: 'sans' });

      expect(result.isValid).toBe(false);
    });

    it('отвергает fontSize больше верхней границы', () => {
      const result = parseElementData('text', { text: 'a', fontSize: 201, fontFamily: 'sans' });

      expect(result.isValid).toBe(false);
    });

    it('принимает границы включительно', () => {
      expect(parseElementData('text', { text: 'a', fontSize: 8, fontFamily: 'mono' }).isValid).toBe(
        true,
      );
      expect(
        parseElementData('text', { text: 'a', fontSize: 200, fontFamily: 'mono' }).isValid,
      ).toBe(true);
    });

    it('отвергает произвольную строку fontFamily — enum закрытый, не свободный CSS font-family', () => {
      const result = parseElementData('text', {
        text: 'a',
        fontSize: 20,
        fontFamily: 'Comic Sans MS',
      });

      expect(result.isValid).toBe(false);
    });

    it('отвергает лишние ключи, а не проглатывает их', () => {
      const result = parseElementData('text', {
        text: 'a',
        fontSize: 20,
        fontFamily: 'sans',
        color: 'red',
      });

      expect(result.isValid).toBe(false);
    });

    it('отвергает геометрию чужой фигуры (points вместо text)', () => {
      const result = parseElementData('text', { points: [0, 0, 10, 10] });

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
