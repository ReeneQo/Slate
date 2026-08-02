import type { ReactElement } from 'react';
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';

interface FormFieldProps {
  label: string;
  type: 'text' | 'email' | 'password';
  autoComplete?: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
}

/**
 * Поле формы: label + input + сообщение об ошибке. Вынесено, чтобы не дублировать разметку и
 * a11y в каждой форме (DRY). Доступность: `htmlFor`↔`id`, `aria-invalid` при ошибке, ошибка
 * связана с полем через `aria-describedby` и озвучивается скринридером (`role="alert"`).
 */
export function FormField({
  label,
  type,
  autoComplete,
  registration,
  error,
}: FormFieldProps): ReactElement {
  const id = registration.name;
  const errorId = `${id}-error`;

  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-[#272d36]">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-[#272d36] outline-none focus:border-[#c2613d]"
        {...registration}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {error.message}
        </p>
      )}
    </div>
  );
}
