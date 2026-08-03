import type { ReactElement } from 'react';
import { Navigate, useParams } from 'react-router';

import { ROUTES } from '@/shared/config';
import { BoardCanvas } from '@/widgets/canvas';

/**
 * Роут холста доски (`/boards/:id`). Тонкий стык композиции: достаёт boardId из маршрута и отдаёт
 * его виджету холста (SLT-27 Р8 — boardId только из роута). Живёт в app/routes, как и прежняя
 * заглушка: это уровень маршрутизации, а не доменная фича.
 *
 * `:id` по шаблону роута всегда присутствует, но useParams типизирует его как optional — пустой id
 * возможен лишь при кривой ручной ссылке, тогда уводим на список досок, а не рендерим холст без
 * доски.
 */
export function BoardCanvasRoute(): ReactElement {
  const { id } = useParams();

  if (!id) {
    return <Navigate to={ROUTES.home} replace />;
  }

  return <BoardCanvas boardId={id} />;
}
