import type { SafeUser } from '../entities/user.entity';

/**
 * Форма пользователя, уходящая ЗА пределы модуля (в контроллеры SLT-16 и на фронт).
 *
 * Отдельный тип, а не Prisma-модель: форма ответа — это контракт с клиентом, и он не
 * обязан повторять форму таблицы. Отдавая наружу Prisma-тип, мы бы намертво привязали
 * публичный API к схеме БД — новая колонка автоматически утекала бы в ответ.
 *
 * `hasPassword` вместо самого хеша — правило Slate. В старом проекте с фронтом уезжал
 * весь объект пользователя вместе с полем `password`.
 *
 * `updatedAt` здесь нет намеренно: клиенту он не нужен, а «отдаём всё, что есть» —
 * ровно тот рефлекс, из-за которого в ответы попадает лишнее.
 */
export interface UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  hasPassword: boolean;
  createdAt: Date;
}

/**
 * Маппер сущность → DTO.
 *
 * Поля перечислены ПОИМЁННО, без `{ ...user }`. Это не занудство: `UserWithHash` —
 * структурный супертип `SafeUser`, поэтому такой объект без единой ошибки типов
 * пройдёт в этот параметр, и spread утащил бы `passwordHash` прямо в HTTP-ответ.
 * Явный перечень делает утечку невозможной независимо от того, что передали.
 *
 * `hasPassword` — отдельный аргумент, а не вычисление из `user`: у безопасной выборки
 * хеша нет (в этом её смысл), так что вывести факт из неё нельзя. Пусть его передаёт
 * тот, кто им реально располагает — см. `UserService.hasPassword`.
 */
export function toUserResponse(user: SafeUser, hasPassword: boolean): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    hasPassword,
    createdAt: user.createdAt,
  };
}
