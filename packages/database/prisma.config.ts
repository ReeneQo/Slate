import { defineConfig } from 'prisma/config';

// datasource.url нужен только Migrate/Studio (SLT-12+). Для `prisma generate` коннект не
// требуется, поэтому переменную берём «мягко» через process.env, чтобы генерация работала без .env.
// Fallback — локальный дев-Postgres из docker-compose (SLT-10). Держать креды в синхроне с ним.
// Валидацию/загрузку env настроим на SLT-12 (dotenv + zod).
const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/slate?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  },
});
