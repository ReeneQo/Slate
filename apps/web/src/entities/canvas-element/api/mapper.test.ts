import type { ElementListItemResponse } from '@slate/shared-types';
import { describe, expect, it } from 'vitest';

import type { CanvasElement } from '../model/types';
import { fromResponse, toUpsertInput } from './mapper';

const boardId = '018f1a2b-3c4d-7e6f-8a9b-0c1d2e3f4a5b';

/** Общие поля фигуры без version — ровно форма ElementResponse (её на проводе НЕТ, SLT-38/39). */
const shape = {
  id: '018f1a2b-3c4d-7e6f-8a9b-0c1d2e3f4a6c',
  type: 'rect' as const,
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

/** Клиентский элемент — та же фигура плюс version (SLT-39), которой в ElementResponse нет. */
const element: CanvasElement = { ...shape, version: 3 };

describe('toUpsertInput', () => {
  it('снимает id и version (в тело создания не входят), добавляет boardId, остальное поле-в-поле', () => {
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
    expect('version' in input).toBe(false);
  });
});

describe('fromResponse', () => {
  it('снимает серверный контекст (boardId, createdAt, updatedAt), геометрию сохраняет', () => {
    const response: ElementListItemResponse = {
      ...shape,
      version: 3,
      boardId,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };

    const mapped = fromResponse(response);

    expect(mapped).toEqual({ ...shape, version: 3 });
    expect('boardId' in mapped).toBe(false);
    expect('createdAt' in mapped).toBe(false);
  });

  it('version берётся из ответа как есть (SLT-40) — не дефолтится в 0', () => {
    const response: ElementListItemResponse = {
      ...shape,
      version: 7,
      boardId,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };

    expect(fromResponse(response).version).toBe(7);
  });

  it('round-trip: fromResponse ∘ (ответ на toUpsertInput) восстанавливает геометрию И version', () => {
    // Сервер эхом возвращает тело + свои поля; клиент снимает их обратно. version теперь едет
    // в GET-ответе как есть (SLT-40) — разрыв, задокументированный раньше в mapper.ts, закрыт.
    const serverEcho: ElementListItemResponse = {
      ...toUpsertInput(element, boardId),
      id: element.id,
      version: element.version,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    } as ElementListItemResponse;

    expect(fromResponse(serverEcho)).toEqual({ ...shape, version: 3 });
  });
});
