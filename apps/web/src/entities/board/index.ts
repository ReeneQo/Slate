/**
 * Публичная поверхность сущности board. Внешние слои (features/widgets) импортируют
 * `@/entities/board`, а не внутренние файлы — раскладка (api/model) остаётся деталью реализации.
 */
export {
  createBoard,
  deleteBoard,
  getBoardMembers,
  getBoards,
  inviteMember,
  removeMember,
  updateMemberRole,
} from './api';
export type { Board, BoardListItem, BoardMember } from './model/types';
