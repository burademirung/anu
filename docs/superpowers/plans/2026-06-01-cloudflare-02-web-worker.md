# Cloudflare Migration — Plan 2 of 5: Web Worker (OpenNext) + Durable Objects + R2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Run the Anu Next.js app on Cloudflare Workers via `@opennextjs/cloudflare`, restoring a green build by rewiring every DB call site to `createDb(getCloudflareContext().env.DB)`, replacing MinIO with the R2 binding, replacing Redis rate-limiting with a Durable Object, replacing the Postgres advisory-lock quota with a per-user Durable Object, and converting the SSE status stream to a pollable JSON endpoint.

**Architecture:** OpenNext compiles Next.js into a Worker (`.open-next/worker.js`) with an `ASSETS` binding for static files. Cloudflare bindings (`DB`, `BUCKET`, two Durable Objects) live on the request `env`, reached via `getCloudflareContext()`. The two Durable Objects are defined in `web/durable-objects/` and **re-exported from the OpenNext worker entry** so wrangler can bind them. Job dispatch (`dispatchJob`) is left as-is in this plan and swapped to a Cloudflare Queue in Plan 3.

**Tech Stack:** `@opennextjs/cloudflare`, `wrangler`, Next.js 16.2, Durable Objects, R2, D1, Vitest (`@cloudflare/vitest-pool-workers` for worker-context tests).

**Scope:** Subsystem 2 of the migration spec (`docs/superpowers/specs/2026-06-01-cloudflare-migration-design.md` §6, plus the §4 quota DO and §2 rate-limit/R2/status rows). Out of scope: the Cloudflare Queue producer/consumer and ML container (Plan 3/4), and the live remote deploy + secrets provisioning (Plan 5). Everything here is built and verified **locally** (`opennextjs-cloudflare build`, `wrangler dev`, Vitest) — no Cloudflare login required.

**Entry state:** After Plan 1 the app does NOT compile — ~16 files import the removed `{ db }` singleton, and `app/api/reports/route.ts` calls Postgres-only `pg_advisory_xact_lock`. Restoring the build is the first job here.

**Risk gates (fix-forward, no fallbacks):**
- **Gate A (Task 3):** `opennextjs-cloudflare build` must succeed on Next 16.2. If the adapter errors, read its output, consult current OpenNext docs, and patch config/usage — do not downgrade Next.
- **Gate B (Task 5):** custom Durable Objects must be reachable through OpenNext's generated worker. Follow current OpenNext "Durable Objects" docs for the re-export mechanism; verify the binding resolves under `wrangler dev`.

---

### Task 1: Install OpenNext, declare env types, add the `getDb()` accessor

**Files:**
- Modify: `web/package.json` (dep)
- Create: `web/env.d.ts`
- Modify: `web/lib/db.ts`

This is additive — it does not change existing imports yet, so it cannot break more than is already broken.

- [ ] **Step 1: Install the adapter**

Run: `cd web && npm install @opennextjs/cloudflare`

- [ ] **Step 2: Create `web/env.d.ts`** declaring the Cloudflare bindings this plan introduces:

```ts
import type { D1Database, R2Bucket, DurableObjectNamespace } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    RATE_LIMITER: DurableObjectNamespace;
    QUOTA: DurableObjectNamespace;
    // Vars/secrets used by existing code (typed for convenience):
    NEXTAUTH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  }
}

export {};
```

- [ ] **Step 3: Append a request-scoped `getDb()` to `web/lib/db.ts`** (keep `createDb`/`Db` exactly as-is from Plan 1; ADD below them):

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";

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
```

- [ ] **Step 4: Type-check the new code in isolation**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "lib/db.ts|env.d.ts" || echo "no new errors in db.ts/env.d.ts"`
Expected: `no new errors in db.ts/env.d.ts` (other files still error on the old `{ db }` import — that's Task 2's job).

- [ ] **Step 5: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/package.json web/package-lock.json web/env.d.ts web/lib/db.ts
git commit -m "feat(web): install OpenNext, declare CloudflareEnv, add getDb() request accessor"
```

---

### Task 2: Rewire all DB call sites to `getDb()` (restore the build)

**Files (modify — replace the `db` import + add a local `const db = getDb()`):**
- `web/lib/auth.ts`
- `web/app/api/auth/register/route.ts`
- `web/app/api/reports/route.ts`
- `web/app/api/reports/[id]/route.ts`
- `web/app/api/reports/[id]/status/route.ts`
- `web/app/api/reports/[id]/pdf/route.ts`
- `web/app/api/reports/[id]/overlay/route.ts`
- `web/app/api/reports/[id]/imagery/route.ts`
- `web/app/api/reports/[id]/facets/[facetId]/pitch/route.ts`
- `web/app/api/billing/checkout/route.ts`
- `web/app/api/billing/portal/route.ts`
- `web/app/api/billing/status/route.ts`
- `web/app/api/billing/webhook/route.ts`
- `web/app/dashboard/reports/page.tsx`
- `web/app/dashboard/reports/[id]/page.tsx`
- `web/app/dashboard/settings/page.tsx`

**Transformation (apply uniformly):**
1. Replace `import { db } from "@/lib/db";` with `import { getDb } from "@/lib/db";`
2. Inside each function/handler that uses `db` (request scope — route handlers, server-component bodies, NextAuth `authorize`), add `const db = getDb();` BEFORE the first use. Do NOT call `getDb()` at module top level (the Cloudflare context isn't available at import time).
3. Leave all query logic identical.

- [ ] **Step 1: Apply the transformation to every file listed.** For `web/lib/auth.ts`, put `const db = getDb();` inside the `authorize` callback (after the rate-limit block, before `db.user.findUnique`). For server components (the three `.tsx` pages), add `const db = getDb();` at the start of the async component function.

- [ ] **Step 2: Verify no stale singleton imports remain**

Run: `cd web && grep -rn "import { db }" app lib && echo "STALE FOUND" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Type-check the whole project**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0. The only acceptable remaining errors are the Postgres advisory-lock raw SQL in `reports/route.ts` if it references no missing symbols (it type-checks fine as a string) — so tsc should be fully clean. If any `db`-related TS2724 errors remain, a call site was missed; fix it.

- [ ] **Step 4: Run the existing unit tests** (they don't touch these routes, must still pass)

Run: `cd web && npx vitest run`
Expected: 8 files / 12 tests pass (unchanged from Plan 1).

- [ ] **Step 5: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/lib/auth.ts web/app
git commit -m "feat(web): rewire all DB call sites to getDb() (D1 via Cloudflare context)"
```

---

### Task 3: OpenNext config + Cloudflare build (RISK GATE A — Next 16.2)

**Files:**
- Modify: `web/next.config.ts`
- Create: `web/open-next.config.ts`
- Modify: `web/wrangler.jsonc`
- Modify: `web/package.json` (scripts)

- [ ] **Step 1: Replace `web/next.config.ts`** (drop `output: "standalone"`; init OpenNext dev bindings):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

// Enable getCloudflareContext() during `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
```

- [ ] **Step 2: Create `web/open-next.config.ts`:**

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
```

- [ ] **Step 3: Update `web/wrangler.jsonc`** to the OpenNext worker shape (keep the D1 binding from Plan 1; add the worker entry + assets; DO bindings are added in Task 5/6). Use the `migrations` block form D1 wrangler expects (this also resolves the Plan 1 `migrations_dir` top-level warning):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "anu-web",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "anu",
      "database_id": "local-placeholder-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ]
}
```

- [ ] **Step 4: Add scripts to `web/package.json`:**

```json
"cf:build": "opennextjs-cloudflare build",
"cf:preview": "opennextjs-cloudflare preview",
"cf:dev": "wrangler dev"
```

- [ ] **Step 5: RISK GATE A — run the Cloudflare build**

Run: `cd web && npm run cf:build`
Expected: `next build` completes and OpenNext emits `.open-next/worker.js` + `.open-next/assets/`.
**If it fails:** capture the exact error. Consult current `@opennextjs/cloudflare` docs (use context7 / WebFetch on opennext.js.org/cloudflare). Common needs: a specific `compatibility_date`, `nodejs_compat` (already set), or a Next config tweak. Patch and re-run. Do NOT downgrade Next.js. If genuinely blocked after honest effort, report BLOCKED with the full output and what you tried.

- [ ] **Step 6: Add OpenNext build artifacts to `.gitignore`**

Append to `web/.gitignore` (create entries if absent): `.open-next/` and `.wrangler/`.

- [ ] **Step 7: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/next.config.ts web/open-next.config.ts web/wrangler.jsonc web/package.json web/.gitignore
git commit -m "feat(web): OpenNext Cloudflare build config (Next 16.2 -> Worker)"
```

---

### Task 4: Replace MinIO with the R2 binding

**Files:**
- Modify: `web/lib/s3.ts`
- Modify: `web/__tests__/lib/s3.test.ts`
- Modify: `web/app/api/reports/[id]/pdf/route.ts`
- Modify: `web/app/api/reports/[id]/overlay/route.ts`
- Modify: `web/app/api/reports/[id]/imagery/route.ts`
- Modify: `web/package.json` (remove `minio` dep)
- Modify: `web/wrangler.jsonc` (add R2 binding)

- [ ] **Step 1: Replace `web/lib/s3.ts`** with R2-binding helpers (no MinIO):

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** R2 bucket for report artifacts (PDFs, overlays, imagery), bound as BUCKET. */
export function bucket() {
  return getCloudflareContext().env.BUCKET;
}

/** Fetch an object's bytes from R2, or null if it doesn't exist. */
export async function getObjectBytes(key: string): Promise<ArrayBuffer | null> {
  const obj = await bucket().get(key);
  return obj ? await obj.arrayBuffer() : null;
}
```

- [ ] **Step 2: Update each download route** to use `getObjectBytes`. Example for `pdf/route.ts` (apply the analogous change to `overlay` → `image/png` and `imagery` → `image/png`, using `report.overlayUrl` / `property.imageryPath` respectively as those routes already do):

```ts
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getObjectBytes } from "@/lib/s3";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const db = getDb();
  const { id } = await params;
  const report = await db.report.findFirst({
    where: { id, userId: session.user.id },
    select: { pdfUrl: true },
  });
  if (!report?.pdfUrl) return new Response("Not found", { status: 404 });
  const bytes = await getObjectBytes(report.pdfUrl);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="report-${id}.pdf"`,
    },
  });
}
```

- [ ] **Step 3: Replace `web/__tests__/lib/s3.test.ts`** so it no longer asserts a MinIO client. Test the R2 helper against a fake binding:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { BUCKET: { get: async (k: string) => (k === "exists" ? { arrayBuffer: async () => new ArrayBuffer(3) } : null) } },
  }),
}));

import { getObjectBytes } from "@/lib/s3";

describe("r2 storage helper", () => {
  it("returns bytes for an existing key", async () => {
    const b = await getObjectBytes("exists");
    expect(b).toBeInstanceOf(ArrayBuffer);
    expect(b!.byteLength).toBe(3);
  });
  it("returns null for a missing key", async () => {
    expect(await getObjectBytes("missing")).toBeNull();
  });
});
```

- [ ] **Step 4: Remove the MinIO dependency**

Run: `cd web && npm uninstall minio`

- [ ] **Step 5: Add the R2 binding to `web/wrangler.jsonc`** (add this top-level key alongside `d1_databases`):

```jsonc
  "r2_buckets": [
    { "binding": "BUCKET", "bucket_name": "anu" }
  ],
```

- [ ] **Step 6: Verify**

Run: `cd web && npx tsc --noEmit && npx vitest run __tests__/lib/s3.test.ts`
Expected: tsc exit 0; s3 test 2 passing.

- [ ] **Step 7: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/lib/s3.ts web/__tests__/lib/s3.test.ts web/app/api/reports web/package.json web/package-lock.json web/wrangler.jsonc
git commit -m "feat(web): serve report artifacts from R2 binding (drop MinIO)"
```

---

### Task 5: Rate-limit Durable Object (RISK GATE B — DO via OpenNext)

**Files:**
- Create: `web/durable-objects/rate-limiter.ts`
- Modify: `web/lib/rate-limit.ts`
- Delete: `web/lib/redis.ts`
- Modify: `web/__tests__/lib/redis.test.ts` → replace with a rate-limit test
- Modify: `web/wrangler.jsonc` (DO binding + migration)
- Modify: OpenNext worker entry so the DO class is exported (see Gate B)

- [ ] **Step 1: Create `web/durable-objects/rate-limiter.ts`** — a fixed-window counter:

```ts
import { DurableObject } from "cloudflare:workers";

/** Fixed-window rate limiter. One instance per limiter key (e.g. ip:1.2.3.4). */
export class RateLimiterDO extends DurableObject {
  async hit(limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
    const stored = (await this.ctx.storage.get<{ start: number; count: number }>("w")) ?? { start: 0, count: 0 };
    const w = stored.start === windowStart ? stored : { start: windowStart, count: 0 };
    w.count += 1;
    await this.ctx.storage.put("w", w);
    return {
      allowed: w.count <= limit,
      remaining: Math.max(0, limit - w.count),
      resetAt: (windowStart + windowSeconds) * 1000,
    };
  }
}
```

- [ ] **Step 2: Rewrite `web/lib/rate-limit.ts`** to call the DO (preserve the `rateLimit(key, limit, windowSeconds)` signature so call sites are unchanged):

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const { env } = getCloudflareContext();
  const id = env.RATE_LIMITER.idFromName(key);
  const stub = env.RATE_LIMITER.get(id);
  const r = await stub.hit(limit, windowSeconds);
  return { allowed: r.allowed, remaining: r.remaining, resetAt: new Date(r.resetAt) };
}
```

- [ ] **Step 3: Delete Redis** — `rm web/lib/redis.ts`.

- [ ] **Step 4: RISK GATE B — export the DO through the OpenNext worker.** The class must be exported from the deployed worker entry for the binding to resolve. Follow current OpenNext docs for custom Durable Objects (use context7 / WebFetch on opennext.js.org/cloudflare/howtos/durable-objects or the bindings guide). The typical mechanism is a thin custom worker that re-exports OpenNext's default handler AND the DO classes; configure `open-next.config.ts` / wrangler to use it. Implement whatever the current docs specify, then verify in Step 7 that `wrangler dev` starts with the binding registered (no "Durable Object class not exported" error).

- [ ] **Step 5: Add the DO binding + migration to `web/wrangler.jsonc`:**

```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "RATE_LIMITER", "class_name": "RateLimiterDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["RateLimiterDO"] }
  ],
```

- [ ] **Step 6: Replace `web/__tests__/lib/redis.test.ts`** with `web/__tests__/lib/rate-limit.test.ts` testing the DO logic against a fake namespace:

```ts
import { describe, it, expect, vi } from "vitest";

const store = new Map<string, unknown>();
const fakeStub = {
  async hit(limit: number, win: number) {
    const now = Math.floor(Date.now() / 1000);
    const start = Math.floor(now / win) * win;
    const w = (store.get("w") as { start: number; count: number }) ?? { start, count: 0 };
    const cur = w.start === start ? w : { start, count: 0 };
    cur.count += 1; store.set("w", cur);
    return { allowed: cur.count <= limit, remaining: Math.max(0, limit - cur.count), resetAt: (start + win) * 1000 };
  },
};
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { RATE_LIMITER: { idFromName: () => "id", get: () => fakeStub } } }),
}));

import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit (DO-backed)", () => {
  it("allows up to the limit then blocks", async () => {
    let last = await rateLimit("k", 2, 60); // 1
    expect(last.allowed).toBe(true);
    last = await rateLimit("k", 2, 60); // 2
    expect(last.allowed).toBe(true);
    last = await rateLimit("k", 2, 60); // 3 -> over
    expect(last.allowed).toBe(false);
    expect(last.resetAt).toBeInstanceOf(Date);
  });
});
```

Remember to `git rm web/__tests__/lib/redis.test.ts`.

- [ ] **Step 7: Verify**

Run: `cd web && npx vitest run __tests__/lib/rate-limit.test.ts && npm run cf:build`
Then start `wrangler dev` briefly (background) and confirm it boots without DO export errors, then stop it.
Expected: rate-limit test passes; build succeeds; `wrangler dev` registers the `RATE_LIMITER` binding.

- [ ] **Step 8: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add -A web/durable-objects web/lib web/__tests__ web/wrangler.jsonc web/open-next.config.ts
git rm web/lib/redis.ts web/__tests__/lib/redis.test.ts 2>/dev/null || true
git commit -m "feat(web): Durable Object rate limiter (drop Redis)"
```

---

### Task 6: Per-user quota Durable Object (replace the advisory lock)

**Files:**
- Create: `web/durable-objects/quota.ts`
- Modify: `web/app/api/reports/route.ts`
- Modify: `web/wrangler.jsonc` (add QUOTA binding + migration)
- Modify: OpenNext worker entry (re-export `QuotaDO`, same mechanism as Task 5)
- Test: `web/__tests__/lib/quota.test.ts`

The advisory lock existed to serialize "count this month's reports → decide if under limit" against concurrent submissions. A per-user Durable Object is single-threaded, giving that serialization for free. The DO holds a monthly counter keyed by `YYYY-MM`, incremented only when a slot is granted.

- [ ] **Step 1: Create `web/durable-objects/quota.ts`:**

```ts
import { DurableObject } from "cloudflare:workers";

/** One instance per user. Serializes monthly report-quota checks. */
export class QuotaDO extends DurableObject {
  /** Try to consume one report slot for the given month. limit=null means unlimited. */
  async tryConsume(month: string, limit: number | null): Promise<{ granted: boolean; used: number }> {
    if (limit === null) return { granted: true, used: 0 };
    const key = `count:${month}`;
    const used = (await this.ctx.storage.get<number>(key)) ?? 0;
    if (used >= limit) return { granted: false, used };
    await this.ctx.storage.put(key, used + 1);
    return { granted: true, used: used + 1 };
  }

  /** Release a previously-consumed slot (e.g. if report creation later fails). */
  async release(month: string): Promise<void> {
    const key = `count:${month}`;
    const used = (await this.ctx.storage.get<number>(key)) ?? 0;
    if (used > 0) await this.ctx.storage.put(key, used - 1);
  }
}
```

- [ ] **Step 2: Replace the advisory-lock block in `web/app/api/reports/route.ts`** (the `if (user.plan === "free" && user.monthlyReportLimit !== null) { ... $transaction with pg_advisory_xact_lock ... }` block) with a quota-DO consume. Add near the top of POST: `import { getCloudflareContext } from "@opennextjs/cloudflare";`. Replace the block with:

```ts
  // Per-user monthly quota, serialized by a Durable Object (replaces pg advisory lock).
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  let quotaStub: DurableObjectStub<import("@/durable-objects/quota").QuotaDO> | null = null;
  if (user.plan === "free") {
    const { env } = getCloudflareContext();
    const id = env.QUOTA.idFromName(userId);
    quotaStub = env.QUOTA.get(id);
    const { granted } = await quotaStub.tryConsume(month, user.monthlyReportLimit ?? 5);
    if (!granted) {
      return NextResponse.json(
        { error: "Monthly report limit reached. Upgrade to premium for unlimited reports." },
        { status: 403 }
      );
    }
  }
```

Then, in the existing `catch` that marks the report failed when dispatch fails, also release the slot: add `if (quotaStub) await quotaStub.release(month);` before returning the 503. (Type import: add `import type { DurableObjectStub } from "@cloudflare/workers-types";` if needed.)

- [ ] **Step 3: Add the QUOTA binding to `web/wrangler.jsonc`** — add to the `durable_objects.bindings` array `{ "name": "QUOTA", "class_name": "QuotaDO" }`, and add a migration `{ "tag": "v2", "new_sqlite_classes": ["QuotaDO"] }` to the `migrations` array. Re-export `QuotaDO` from the worker entry (same mechanism as Task 5 Gate B).

- [ ] **Step 4: Create `web/__tests__/lib/quota.test.ts`** testing the DO logic directly (instantiate-free pure logic via a fake storage):

```ts
import { describe, it, expect } from "vitest";
import { QuotaDO } from "@/durable-objects/quota";

function makeDO(initial = 0) {
  const mem = new Map<string, number>();
  if (initial) mem.set("count:2026-06", initial);
  const ctx = { storage: { get: async (k: string) => mem.get(k), put: async (k: string, v: number) => void mem.set(k, v) } };
  // @ts-expect-error minimal ctx for unit test
  return new QuotaDO(ctx, {} as never);
}

describe("QuotaDO", () => {
  it("grants until the limit, then denies", async () => {
    const q = makeDO(0);
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(true);
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(true);
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(false);
  });
  it("treats null limit as unlimited", async () => {
    const q = makeDO(999);
    expect((await q.tryConsume("2026-06", null)).granted).toBe(true);
  });
  it("release frees a slot", async () => {
    const q = makeDO(2);
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(false);
    await q.release("2026-06");
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(true);
  });
});
```

- [ ] **Step 5: Verify**

Run: `cd web && npx tsc --noEmit && npx vitest run __tests__/lib/quota.test.ts && npm run cf:build`
Expected: tsc exit 0; quota test 3 passing; build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add -A web/durable-objects web/app/api/reports/route.ts web/wrangler.jsonc web/__tests__/lib/quota.test.ts web/open-next.config.ts
git commit -m "feat(web): per-user quota Durable Object (replace pg advisory lock)"
```

---

### Task 7: Convert SSE status stream to a pollable JSON endpoint

**Files:**
- Modify: `web/app/api/reports/[id]/status/route.ts`
- Modify: `web/app/dashboard/reports/[id]/page.tsx` (or its client child) — adjust the consumer to poll

- [ ] **Step 1: Replace the body of `web/app/api/reports/[id]/status/route.ts`** with a single-shot JSON response (no ReadableStream/SSE):

```ts
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const db = getDb();
  const { id } = await params;
  const report = await db.report.findFirst({
    where: { id, userId: session.user.id },
    select: { status: true, tier: true, errorMessage: true },
  });
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  return Response.json({ status: report.status, tier: report.tier, error: report.errorMessage });
}
```

- [ ] **Step 2: Update the report viewer consumer.** Find where the report page subscribes to the SSE endpoint (an `EventSource` on `/api/reports/[id]/status`). Replace it with polling: fetch the JSON endpoint every 2s while `status` is `queued`/`processing`, stop on `completed`/`failed`, and refresh the view on terminal status. If the existing code is a server component with no client subscription, add a small client component that polls and calls `router.refresh()` on completion. Keep the user-visible behavior (live status → auto-refresh on done) identical.

- [ ] **Step 3: Verify build + tests**

Run: `cd web && npx tsc --noEmit && npm run cf:build && npx vitest run`
Expected: tsc 0; build succeeds; all unit tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/app/api/reports/[id]/status/route.ts web/app/dashboard/reports
git commit -m "feat(web): replace SSE status stream with pollable JSON endpoint"
```

---

### Task 8: Local end-to-end smoke + final build

**Files:** none (verification + any small fixes surfaced)

- [ ] **Step 1: Apply migrations to local D1 and start the worker**

Run (from `web/`):
```bash
cd web
npx wrangler d1 migrations apply anu --local
npm run cf:build
npx wrangler dev &   # background; give it ~8s to boot
```

- [ ] **Step 2: Hit the health endpoint**

Run: `curl -s http://localhost:8787/api/health` (adjust port if wrangler prints a different one)
Expected: JSON `{"status":"ok","timestamp":...,"service":"anu-web"}`. Stop `wrangler dev` afterward.

- [ ] **Step 3: Full test suite + final type-check**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; all suites pass (enums, json-columns, db, schema-roundtrip, s3, rate-limit, quota, ml-client, health).

- [ ] **Step 4: Commit any fixes; otherwise tag the milestone in the log**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add -A web
git commit -m "test(web): local wrangler smoke + full suite green on Workers" --allow-empty
```

---

## Self-Review

**Spec coverage (spec §6 web app + §2/§4 rows):**
- OpenNext Worker build → Task 1, 3 ✓
- All DB call sites on D1 via context → Task 1, 2 ✓
- MinIO → R2 binding (downloads) → Task 4 ✓
- Redis rate-limit → Durable Object → Task 5 ✓
- pg advisory-lock quota → per-user Durable Object → Task 6 ✓
- SSE status → pollable JSON + client poll → Task 7 ✓
- Local verification without Cloudflare login → Task 3/5/8 ✓
- Job dispatch (Queue) → deliberately deferred to Plan 3 (dispatchJob untouched) ✓
- Remote deploy + secrets → deferred to Plan 5 ✓

**Placeholder scan:** No TBD/TODO. The two doc-dependent steps (Gate A build, Gate B DO export) specify goal + verification + which current docs to consult, because their exact API is OpenNext-version-specific and must be confirmed against live docs rather than guessed. All other steps carry complete code.

**Type consistency:** `getDb()` (Task 1) is used uniformly in Tasks 2/4/6/7; `rateLimit(key, limit, windowSeconds)` signature preserved (Task 5) so call sites in `auth.ts`/`reports/route.ts` need no change; `getObjectBytes(key)` (Task 4) used in all three download routes; DO class names `RateLimiterDO`/`QuotaDO` match between class files, wrangler bindings, and migrations.

**Handoff to Plan 3:** `dispatchJob` in `lib/ml-client.ts` and its call in `reports/route.ts` still target the FastAPI HTTP service; Plan 3 replaces the producer with `env.QUEUE.send(...)` and builds the consumer Worker + container contract. The quota DO's `release()` is already wired for the dispatch-failure path and will carry over to the Queue producer.
