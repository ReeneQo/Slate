/**
 * Публичная поверхность @slate/shared-types — единственный источник правды о контрактах между
 * apps/api и apps/web: границы значений, zod-схемы входов и ответов, выведенные из них типы.
 *
 * Плоский реэкспорт без промежуточных баррелей: пакет маленький, а лишний уровень (`./board`,
 * `./element`) добавил бы только шанс на циклический импорт.
 */
export * from './auth/auth.constants.js';
export * from './auth/auth.contracts.js';
export * from './board/board.constants.js';
export * from './board/board.contracts.js';
export * from './element/element.constants.js';
export * from './element/element.contracts.js';
export * from './element/element.types.js';
export * from './element/element-data.schema.js';
export * from './exact-keys.js';
