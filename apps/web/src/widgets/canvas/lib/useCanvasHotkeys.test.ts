import { describe, expect, it } from 'vitest';

import { matchesDelete, matchesRedo, matchesUndo } from './useCanvasHotkeys';

/**
 * Минимальный KeyboardEvent для матчеров — тесты запускаются в node-окружении (без jsdom), а
 * матчеры читают только key/code/ctrlKey/metaKey/shiftKey, поэтому реальный конструктор не нужен.
 */
function keyEvent(init: {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key ?? '',
    code: init.code ?? '',
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
  } as KeyboardEvent;
}

describe('matchesDelete', () => {
  it('матчит Delete и Backspace без модификаторов', () => {
    expect(matchesDelete(keyEvent({ key: 'Delete' }))).toBe(true);
    expect(matchesDelete(keyEvent({ key: 'Backspace' }))).toBe(true);
  });

  it('НЕ матчит с Ctrl или Meta (не гасить системные комбо)', () => {
    expect(matchesDelete(keyEvent({ key: 'Backspace', ctrlKey: true }))).toBe(false);
    expect(matchesDelete(keyEvent({ key: 'Backspace', metaKey: true }))).toBe(false);
  });

  it('НЕ матчит прочие клавиши', () => {
    expect(matchesDelete(keyEvent({ key: 'a' }))).toBe(false);
  });
});

describe('matchesUndo', () => {
  it('матчит Ctrl+Z и Cmd+Z (по e.code — раскладко-независимо)', () => {
    expect(matchesUndo(keyEvent({ code: 'KeyZ', ctrlKey: true }))).toBe(true);
    expect(matchesUndo(keyEvent({ code: 'KeyZ', metaKey: true }))).toBe(true);
  });

  it('матчит независимо от e.key (не-латинская раскладка шлёт другой key на той же физической клавише)', () => {
    expect(matchesUndo(keyEvent({ code: 'KeyZ', key: 'я', ctrlKey: true }))).toBe(true);
  });

  it('Ctrl+Shift+Z НЕ матчит undo (это redo)', () => {
    expect(matchesUndo(keyEvent({ code: 'KeyZ', ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('голая Z без модификатора НЕ матчит', () => {
    expect(matchesUndo(keyEvent({ code: 'KeyZ' }))).toBe(false);
  });
});

describe('matchesRedo', () => {
  it('матчит Ctrl+Shift+Z и Cmd+Shift+Z', () => {
    expect(matchesRedo(keyEvent({ code: 'KeyZ', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesRedo(keyEvent({ code: 'KeyZ', metaKey: true, shiftKey: true }))).toBe(true);
  });

  it('матчит Ctrl+Y (Windows-конвенция)', () => {
    expect(matchesRedo(keyEvent({ code: 'KeyY', ctrlKey: true }))).toBe(true);
  });

  it('НЕ матчит голый Shift+Z без Ctrl/Cmd', () => {
    expect(matchesRedo(keyEvent({ code: 'KeyZ', shiftKey: true }))).toBe(false);
  });

  it('НЕ матчит Ctrl+Z без Shift (это undo)', () => {
    expect(matchesRedo(keyEvent({ code: 'KeyZ', ctrlKey: true }))).toBe(false);
  });
});
