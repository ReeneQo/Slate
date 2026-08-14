/**
 * Публичная поверхность фичи board-list. Внешние слои (widgets) импортируют `@/features/board-list`,
 * а не внутренние файлы — раскладка (api/model/ui/lib) остаётся деталью реализации.
 *
 * `useBoardRole`/`useBoardTitle` торчат наружу отдельно от экрана: widgets/canvas (SLT-43,
 * роль-гейт; SLT-66, имя файла экспорта) — тоже потребитель, у него нет причин рендерить список
 * досок, только знать роль/название текущей.
 */
export { useBoardRole } from './model/useBoardRole';
export { useBoardTitle } from './model/useBoardTitle';
export { BoardList } from './ui/BoardList';
