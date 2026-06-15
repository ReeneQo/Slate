// Контракты API на zod — общие схемы запросов/ответов и DTO,
// разделяемые между apps/api (валидация входа) и apps/web (react-hook-form + zod).
//
// Паттерн (когда добавим zod): объявляем схему, тип выводим из неё —
// один источник правды для рантайм-валидации и статической типизации.
//
//   export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
//   export type LoginDto = z.infer<typeof loginSchema>;
//
// Пока пусто — наполняется на этапе 2 вместе с auth и CRUD досок.
export {};
