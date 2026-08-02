import type { ReactElement, ReactNode } from 'react';

interface AuthCardProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Контейнер auth-страниц: центрированная карточка. Презентационный, без логики. */
export function AuthCard({ title, children, footer }: AuthCardProps): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f6f3] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-6 shadow-lg">
        <h1 className="mb-5 text-xl font-semibold text-[#272d36]">{title}</h1>
        {children}
        {footer && <p className="mt-4 text-center text-sm text-[#272d36]/70">{footer}</p>}
      </div>
    </main>
  );
}
