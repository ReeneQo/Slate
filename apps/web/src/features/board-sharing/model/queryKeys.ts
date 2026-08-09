/**
 * Ключи кэша react-query для участников доски (SLT-43) — по образцу `boardKeys`
 * (features/board-list): централизованы, чтобы инвалидация после мутаций (invite/patch/remove)
 * ссылалась ровно на тот ключ, которым запрашивался список.
 *
 * `list(boardId)` — фабрика, а не плоский ключ: участники СВОИ у каждой доски, плоский
 * `['board-members']` инвалидировал бы (или путал) кэш чужой доски при мутации на этой.
 */
export const boardMemberKeys = {
  list: (boardId: string) => ['board-members', boardId] as const,
};
