import { describe, expect, it } from 'vitest';

import { matchesDelete, matchesRedo, matchesUndo } from './useCanvasHotkeys';

/**
 * Минимальный KeyboardEvent для матчеров — тесты запускаются в node-окружении (без jsdom), а
 * матчеры читают только key/ctrlKey/metaKey/shiftKey, поэтому реальный конструктор не нужен.
 */
function keyEvent(init: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
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
  it('матчит Ctrl+Z и Cmd+Z', () => {
    expect(matchesUndo(keyEvent({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(matchesUndo(keyEvent({ key: 'z', metaKey: true }))).toBe(true);
  });

  it('матчит верхний регистр Z (Shift-раскладка без shiftKey отдельно не бывает, но key может прийти "Z")', () => {
    expect(matchesUndo(keyEvent({ key: 'Z', ctrlKey: true }))).toBe(true);
  });

  it('Ctrl+Shift+Z НЕ матчит undo (это redo)', () => {
    expect(matchesUndo(keyEvent({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('голая Z без модификатора НЕ матчит', () => {
    expect(matchesUndo(keyEvent({ key: 'z' }))).toBe(false);
  });
});

describe('matchesRedo', () => {
  it('матчит Ctrl+Shift+Z и Cmd+Shift+Z', () => {
    expect(matchesRedo(keyEvent({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesRedo(keyEvent({ key: 'z', metaKey: true, shiftKey: true }))).toBe(true);
  });

  it('матчит Ctrl+Y (Windows-конвенция)', () => {
    expect(matchesRedo(keyEvent({ key: 'y', ctrlKey: true }))).toBe(true);
  });

  it('НЕ матчит голый Shift+Z без Ctrl/Cmd', () => {
    expect(matchesRedo(keyEvent({ key: 'z', shiftKey: true }))).toBe(false);
  });

  it('НЕ матчит Ctrl+Z без Shift (это undo)', () => {
    expect(matchesRedo(keyEvent({ key: 'z', ctrlKey: true }))).toBe(false);
  });
});
