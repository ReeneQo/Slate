import type { BoardMemberRole, Prisma } from '@slate/database';

/**
 * ЕДИНСТВЕННОЕ определение «эта доска доступна этому пользователю» (SLT-19, расширено SLT-41).
 *
 * Возвращает не булево значение, а ОБЛАСТЬ ВИДИМОСТИ запроса — фрагмент `where`. Разница
 * принципиальная, и она в двух вещах:
 *
 * 1. Безопасность чтения. Вариант «прочитать доску, потом сравнить ownerId» означает, что
 *    чужая строка уже в памяти процесса: она попадёт в стек ошибки, в дамп, в лог отладки.
 *    Здесь БД просто не отдаёт то, к чему нет доступа, — данных, которых нельзя показывать,
 *    в приложении не существует.
 * 2. Атомарность записи. PATCH и DELETE применяют scope в том же запросе, что и мутацию.
 *    Отдельная проверка «можно ли» перед отдельным `update` оставляет окно между ними
 *    (TOCTOU): доска может исчезнуть ровно в этом промежутке.
 *
 * ЧТЕНИЕ: владелец ИЛИ участник ЛЮБОЙ роли (viewer тоже читатель, SLT-41) — отсюда `OR` с
 * веткой по `BoardMember` без фильтра по `role`. Роль решает не «пускать ли», а «что можно
 * сделать» — этим занимается `getAccessLevel`/`canWrite`, а не эта функция.
 *
 * ЗАПИСЬ. Не всякая мутация вправе опираться на этот scope без разбора:
 *  - мутации ЭЛЕМЕНТОВ (SLT-20/38) действительно доступны editor'у, и там этот же scope,
 *    вклеенный в `accessibleElementScope`, — правильная граница (после отдельной проверки
 *    роли ≥ editor через `canWrite`, см. ElementService);
 *  - мутации САМОЙ ДОСКИ (переименование, удаление) остаются owner-only и НЕ используют эту
 *    функцию (`BoardRepository.updateAccessible`/`deleteAccessible` берут `{ ownerId }`
 *    напрямую) — управление жизненным циклом доски не входит в полномочия editor'а по
 *    решению SLT-41, симметрично тому, что управление шерингом (SLT-42) остаётся у owner'а.
 *
 * Тип возврата — `{ OR: Prisma.BoardWhereInput[] }`, и это тоже намеренно: такая форма
 * подходит и `BoardWhereInput` (findFirst/findMany), и `BoardWhereUniqueInput` (update/delete
 * через extendedWhereUnique).
 */
export function accessibleBoardScope(userId: string): { OR: Prisma.BoardWhereInput[] } {
  return { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
}

/**
 * Уровень доступа: `null` — доступа нет, иначе роль. `owner` — неявная высшая роль (SLT-41,
 * решение 2): она в `Board.ownerId`, а не в `BoardMember` — владельцу не заводится member-запись.
 */
export type AccessLevel = 'owner' | BoardMemberRole | null;

/** Форма доски, достаточная для резолва уровня — то, что нужно выбрать (`select`) вызывающему. */
export interface AccessResolvableBoard {
  ownerId: string;
  /** Отфильтровано по конкретному userId на стороне запроса — здесь не более одной записи. */
  members: { role: BoardMemberRole }[];
}

/**
 * Резолвит найденную под `accessibleBoardScope` строку в уровень доступа. `null` на входе ⇒
 * `null` на выходе — под scope ничего не нашлось, доступа нет.
 *
 * Owner проверяется ПЕРВЫМ и не заглядывает в `members` — по построению схемы (SLT-41,
 * решение 2) владельцу member-запись не заводится, но порядок проверки не полагается на это
 * молчаливо: явная ветка `ownerId === userId` короче и не зависит от инварианта соседней таблицы.
 *
 * Общая для BoardRepository (уровень для доски целиком) и ElementRepository (уровень доски
 * ЧЕРЕЗ связь элемента) — единственное определение «как читать эту форму», применённое к двум
 * разным корням запроса. Дублировать эти три строки в обоих репозиториях значило бы завести
 * два места, которые обязаны рассуждать одинаково и когда-нибудь разъедутся.
 */
export function resolveAccessLevel(
  board: AccessResolvableBoard | null,
  userId: string,
): AccessLevel {
  if (board === null) {
    return null;
  }

  if (board.ownerId === userId) {
    return 'owner';
  }

  return board.members[0]?.role ?? null;
}

/**
 * Хватает ли уровня доступа, чтобы писать (SLT-41, решение 3). `owner`/`editor` — да, `viewer`
 * и `null` — нет. Единственное место, где сравнение «роль ≥ editor» записано явно: вызывающие
 * (ElementService — HTTP PATCH/PUT/DELETE и WS `element_*`) зовут этот предикат, а не
 * сравнивают роль инлайн по месту — иначе правило «кто умеет писать» разъехалось бы по файлам.
 */
export function canWrite(access: AccessLevel): boolean {
  return access === 'owner' || access === 'editor';
}
