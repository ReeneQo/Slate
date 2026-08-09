import { zodResolver } from '@hookform/resolvers/zod';
import { type InviteMemberInput, inviteMemberSchema } from '@slate/shared-types';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';

import { mapInviteError } from '../lib/mapShareError';
import { useInviteMember } from '../model/useInviteMember';

interface InviteFormProps {
  boardId: string;
}

/**
 * Форма приглашения: email + роль (editor/viewer) + кнопка. Схема — `inviteMemberSchema` из
 * контракта НАПРЯМУЮ (не локальная обёртка, как у `CreateBoardForm`): в отличие от title доски,
 * у email/role нет клиентского «пустое = легальный дефолт» — оба поля обязательны один в один с
 * бэком, разводить схему не для чего.
 *
 * После успеха форма сбрасывается (email пуст, роль — снова `editor`), а НЕ закрывает диалог:
 * приглашение нескольких участников подряд — обычный сценарий, лишний повторный клик на «открыть»
 * между каждым был бы трением. Список участников обновляет сама мутация (инвалидация, SLT-43).
 */
export function InviteForm({ boardId }: InviteFormProps): ReactElement {
  const inviteMember = useInviteMember(boardId);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: '', role: 'editor' },
  });

  const onSubmit = handleSubmit((values) => {
    inviteMember.mutate(values, {
      onSuccess: () => reset({ email: '', role: 'editor' }),
      onError: (error) => setError('root', { message: mapInviteError(error) }),
    });
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="mb-4">
      <div className="flex gap-2">
        <label htmlFor="invite-email" className="sr-only">
          Email участника
        </label>
        <input
          id="invite-email"
          type="email"
          autoComplete="email"
          placeholder="Email участника"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={(errors.email ?? errors.root) ? 'invite-error' : undefined}
          className="min-w-0 flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-[#272d36] outline-none focus:border-[#c2613d]"
          {...register('email')}
        />
        <label htmlFor="invite-role" className="sr-only">
          Роль
        </label>
        <select
          id="invite-role"
          className="shrink-0 rounded-lg border border-black/15 px-2 py-2 text-sm text-[#272d36] outline-none focus:border-[#c2613d]"
          {...register('role')}
        >
          <option value="editor">Редактор</option>
          <option value="viewer">Наблюдатель</option>
        </select>
        <button
          type="submit"
          disabled={inviteMember.isPending}
          className="shrink-0 rounded-lg bg-[#c2613d] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#a94f30] disabled:opacity-60"
        >
          {inviteMember.isPending ? 'Приглашение…' : 'Пригласить'}
        </button>
      </div>
      {(errors.email ?? errors.root) && (
        <p id="invite-error" role="alert" className="mt-1 text-sm text-red-600">
          {(errors.email ?? errors.root)?.message}
        </p>
      )}
    </form>
  );
}
