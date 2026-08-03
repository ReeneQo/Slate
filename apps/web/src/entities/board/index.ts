/**
 * Публичная поверхность сущности board. Внешние слои (features/widgets) импортируют
 * `@/entities/board`, а не внутренние файлы — раскладка (api/model) остаётся деталью реализации.
 */
export { createBoard, deleteBoard, getBoards } from './api';
export type { Board } from './model/types';
