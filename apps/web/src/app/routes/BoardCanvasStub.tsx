import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router';

import { ROUTES } from '@/shared/config';

/**
 * Заглушка холста доски (`/boards/:id`). Холст рисует SLT-27; здесь пока стык навигации: после
 * создания доски (SLT-26) мы уводим сюда, и посадочная страница должна существовать, иначе
 * пользователь попадёт на пустой роут. Живёт в app/routes — временный плейсхолдер уровня
 * композиции, как и раньше BoardsStub, а не доменная фича.
 */
export function BoardCanvasStub(): ReactElement {
  const { id } = useParams();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f7f6f3] text-[#272d36]">
      <h1 className="text-xl font-semibold">Холст доски</h1>
      <p className="text-sm text-[#272d36]/70">id: {id}</p>
      <p className="text-sm text-[#272d36]/70">Рисовалка появится в SLT-27.</p>
      <Link to={ROUTES.home} className="text-sm text-[#c2613d] hover:underline">
        ← К списку досок
      </Link>
    </main>
  );
}
