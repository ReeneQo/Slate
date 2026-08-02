import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Помечает dist/cjs как CommonJS.
 *
 * Пакет объявлен `"type": "module"`, и Node применяет это ко ВСЕМ `.js` внутри — включая
 * CommonJS-выхлоп tsc. Без маркера require() из apps/api читал бы `exports.foo = ...` как ESM и
 * падал с SyntaxError. Ближайший package.json перекрывает тип для своей поддиректории — это
 * штатный механизм Node, а не хак.
 *
 * Почему отдельный файл, а не `node -e` в строке скрипта: экранирование кавычек внутри JSON
 * делает такую однострочную команду нечитаемой, а объяснить, зачем она нужна, всё равно негде.
 */
const distCjsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cjs');

writeFileSync(
  join(distCjsDir, 'package.json'),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);
