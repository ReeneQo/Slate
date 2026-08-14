import { describe, expect, it } from 'vitest';

import { buildExportFilename, sanitizeFilenamePart } from './filename';

describe('sanitizeFilenamePart (SLT-66)', () => {
  it('пропускает безопасную строку без изменений', () => {
    expect(sanitizeFilenamePart('roadmap-2026')).toBe('roadmap-2026');
  });

  it('заменяет путе-разделители и запрещённые символы на дефис', () => {
    expect(sanitizeFilenamePart('Q3 plan / review: v2?')).toBe('Q3-plan-review-v2');
  });

  it('схлопывает несколько разделителей подряд в один дефис', () => {
    expect(sanitizeFilenamePart('a   /  b')).toBe('a-b');
  });

  it('обрезает дефисы по краям', () => {
    expect(sanitizeFilenamePart('  /board/  ')).toBe('board');
  });

  it('пустая/только-запрещённые строка → пустая строка (вызывающий откатится на id)', () => {
    expect(sanitizeFilenamePart('   ///   ')).toBe('');
  });
});

describe('buildExportFilename (SLT-66)', () => {
  const date = new Date(2026, 7, 14); // 2026-08-14, локальная дата, месяц 0-indexed

  it('с непустым названием доски — санитизует и подставляет его', () => {
    expect(buildExportFilename('Roadmap Q3', 'board-id-1', date)).toBe(
      'slate-Roadmap-Q3-2026-08-14.png',
    );
  });

  it('без названия (undefined) — откат на boardId', () => {
    expect(buildExportFilename(undefined, 'board-id-1', date)).toBe(
      'slate-board-id-1-2026-08-14.png',
    );
  });

  it('название есть, но целиком санитизуется в пустоту — откат на boardId', () => {
    expect(buildExportFilename('///', 'board-id-1', date)).toBe('slate-board-id-1-2026-08-14.png');
  });
});
