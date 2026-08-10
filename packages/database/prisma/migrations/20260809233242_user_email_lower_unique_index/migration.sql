-- DropIndex
DROP INDEX "users_email_key";

-- CreateIndex
-- Функциональный уникальный индекс: Prisma не умеет декларировать `lower(email)` в schema.prisma,
-- поэтому constraint живёт только здесь, raw SQL. normalizeEmail() в AuthService остаётся
-- отдельным слоем нормализации (единообразный вид email в БД), а не заменяет этот индекс — без
-- него гонка на регистр (Test@x.com / test@x.com одновременно) всё ещё проходит мимо
-- unique-constraint.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower(email));
