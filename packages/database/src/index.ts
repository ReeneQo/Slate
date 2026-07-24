// Единая точка входа пакета @slate/database.
// Реэкспорт СГЕНЕРИРОВАННОГО Prisma-клиента: класс `PrismaClient`, namespace `Prisma`,
// enum-ы (`$Enums`) и типы моделей.
//
// Инстанс здесь НАМЕРЕННО не создаётся — пакет отдаёт КЛАСС, не объект подключения.
// Синглтон-обёртка (`PrismaService extends PrismaClient` с Nest lifecycle) живёт в
// `apps/api` (SLT-12): один инстанс на приложение управляется DI. Инстанс в пакете
// открыл бы лишние подключения к БД и сломал бы управление жизненным циклом.
// Расширение '.ts' обязательно: build идёт под NodeNext (rewriteRelativeImportExtensions
// перепишет его в '.js' в dist). Typecheck (moduleResolution Bundler + allowImportingTsExtensions)
// такой импорт тоже принимает.
export * from '../generated/client/client.ts';
