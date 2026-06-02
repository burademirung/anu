import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "@/db/schema";

/**
 * Create a Drizzle client bound to a Cloudflare D1 database. Drizzle is
 * wasm-free and runs natively on Workers (replaced Prisma, whose WASM engine
 * doesn't bundle through OpenNext).
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;

let cached: { env: CloudflareEnv; db: Db } | null = null;

/**
 * Get a Drizzle client for the current request's D1 binding.
 * Memoized per Worker isolate (env identity is stable across requests).
 */
export function getDb(): Db {
  const { env } = getCloudflareContext();
  if (cached && cached.env === env) return cached.db;
  const db = createDb(env.DB);
  cached = { env, db };
  return db;
}
