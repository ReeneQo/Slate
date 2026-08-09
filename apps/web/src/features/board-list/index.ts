/**
 * Публичная поверхность фичи board-list. Внешние слои (widgets) импортируют `@/features/board-list`,
 * а не внутренние файлы — раскладка (api/model/ui/lib) остаётся деталью реализации.
 *
 * `useBoardRole` торчит наружу отдельно от экрана: widgets/canvas (SLT-43, роль-гейт) — тоже
 * потребитель, у него нет причин рендерить список досок, только знать роль текущей.
 */
export { useBoardRole } from './model/useBoardRole';
export { BoardList } from './ui/BoardList';
