import { defineConfig } from "prisma/config";

// D1/SQLite via driver adapter: the database URL is supplied at runtime by
// @prisma/adapter-d1 (see web/lib/db.ts), not here. Migrations live in
// web/migrations/ and are applied with `wrangler d1 migrations apply`,
// not Prisma Migrate — so no `migrations.path` / `datasource.url` is set.
export default defineConfig({
  schema: "prisma/schema.prisma",
});
