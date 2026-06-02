import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Create a Prisma client bound to a Cloudflare D1 database.
 * Bindings live on the request env, so this is called per request
 * (e.g. createDb(getCloudflareContext().env.DB)) rather than as a global singleton.
 */
export function createDb(d1: D1Database): PrismaClient {
  const adapter = new PrismaD1(d1);
  return new PrismaClient({ adapter });
}

export type Db = ReturnType<typeof createDb>;

let cached: { env: CloudflareEnv; db: PrismaClient } | null = null;

/**
 * Get a Prisma client for the current request's D1 binding.
 * Memoized per Worker isolate (env identity is stable across requests in an isolate),
 * so we don't rebuild a client on every call within or across requests.
 */
export function getDb(): PrismaClient {
  const { env } = getCloudflareContext();
  if (cached && cached.env === env) return cached.db;
  const db = createDb(env.DB);
  cached = { env, db };
  return db;
}
