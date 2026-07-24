// Единая точка входа пакета @slate/database.
// Реэкспорт СГЕНЕРИРОВАННОГО Prisma-клиента: класс `PrismaClient`, namespace `Prisma`,
// enum-ы (`$Enums`) и типы моделей.
//
// Инстанс здесь НАМЕРЕННО не создаётся — пакет отдаёт КЛАСС, не объект подключения.
// Синглтон-обёртка (`PrismaService extends PrismaClient` с Nest lifecycle) живёт в
// `apps/api` (SLT-12): один инстанс на приложение управляется DI. Инстанс в пакете
// открыл бы лишние подключения к БД и сломал бы управление жизненным циклом.
//
// Клиент генерится в CJS (schema.prisma: moduleFormat="cjs"), т.к. Nest компилируется
// SWC в CommonJS и require() ESM-модуля дал бы ERR_REQUIRE_ESM. Расширение '.js' в
// импорте — из importFileExtension="js": NodeNext резолвит его в соседний '.ts' при
// typecheck и в '.js' в собранном dist.
export * from '../generated/client/client.js';
