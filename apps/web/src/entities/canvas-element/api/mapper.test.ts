import type { ElementResponse } from '@slate/shared-types';
import { describe, expect, it } from 'vitest';

import type { CanvasElement } from '../model/types';
import { fromResponse, toUpsertInput } from './mapper';

const boardId = '018f1a2b-3c4d-7e6f-8a9b-0c1d2e3f4a5b';

const element: CanvasElement = {
  id: '018f1a2b-3c4d-7e6f-8a9b-0c1d2e3f4a6c',
  type: 'rect',
  x: 10,
  y: 20,
  angle: 0,
  opacity: 1,
  stroke: '#272d36',
  fill: null,
  strokeWidth: 2,
  seed: 42,
  order: 3,
  data: { width: 100, height: 50 },
};

describe('toUpsertInput', () => {
  it('снимает id (уходит в URL) и добавляет boardId, остальное поле-в-поле', () => {
    const input = toUpsertInput(element, boardId);

    expect(input).toEqual({
      boardId,
      type: 'rect',
      x: 10,
      y: 20,
      angle: 0,
      opacity: 1,
      stroke: '#272d36',
      fill: null,
      strokeWidth: 2,
      seed: 42,
      order: 3,
      data: { width: 100, height: 50 },
    });
    expect('id' in input).toBe(false);
  });
});

describe('fromResponse', () => {
  it('снимает серверный контекст (boardId, createdAt, updatedAt), геометрию сохраняет', () => {
    const response: ElementResponse = {
      ...element,
      boardId,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };

    const mapped = fromResponse(response);

    expect(mapped).toEqual(element);
    expect('boardId' in mapped).toBe(false);
    expect('createdAt' in mapped).toBe(false);
  });

  it('round-trip: fromResponse ∘ (ответ на toUpsertInput) возвращает исходный элемент', () => {
    // Сервер эхом возвращает тело + свои поля; клиент снимает их обратно.
    const serverEcho: ElementResponse = {
      ...toUpsertInput(element, boardId),
      id: element.id,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    } as ElementResponse;

    expect(fromResponse(serverEcho)).toEqual(element);
  });
});
