# Cloudflare Migration — Plan 3 of 5: Job System (Queues + Container Contract)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the synchronous HTTP job dispatch (Next → FastAPI) with a Cloudflare Queue producer + a `queue()` consumer that invokes the ML container and writes results to D1. The container itself is built in Plan 4; here it is abstracted behind a typed client and exercised with a stub, so the whole job path is implemented and tested locally.

**Architecture:** `POST /api/reports` enqueues `{reportId, propertyId, lat, lon}` via `env.QUEUE.send`. A `queue()` handler (exported from `custom-worker.ts` alongside `fetch` and the DOs) processes each message: mark `processing` → call `callContainer(env, payload)` → write the structured result to D1 via a `report-writer` module → mark `completed`. On any throw: mark `failed` and rethrow so Cloudflare Queues retries (with backoff; exhausted → DLQ). The container call is the one boundary stubbed until Plan 4.

**Tech Stack:** Cloudflare Queues, Durable-Object-backed Container binding (typed now, bound in Plan 4), D1/Prisma, Vitest + local SQLite.

**Scope:** Spec §5 (job system) + the §1 "Worker is sole DB writer" shift. Out of scope: the Python container implementation (Plan 4) and remote deploy/secrets (Plan 5). All work verifies locally.

**Entry state:** Plan 2 complete. `reports/route.ts` POST still calls `dispatchJob()` from `lib/ml-client.ts` (HTTP to a FastAPI service that won't exist on Cloudflare). `custom-worker.ts` exports `fetch` + `RateLimiterDO` + `QuotaDO`.

---

### Task 1: Container contract types

**Files:** Create `web/lib/container-contract.ts`; Test `web/__tests__/lib/container-contract.test.ts`

Defines the request/response shape between the consumer Worker and the ML container (spec §5). Pure types + a runtime validator so a malformed container response fails loudly rather than writing garbage to D1.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isContainerResult } from "@/lib/container-contract";

const good = {
  tier: "full", modelVersion: "v1.0",
  roofAreaSqft: 2000, roofAreaSquares: 20, numFacets: 4, numStructures: 1,
  wasteFactor: 14, confidenceScore: 0.9,
  pdfKey: "reports/r1/report.pdf", overlayKey: "reports/r1/overlay.png", imageryKey: "imagery/x.png",
  facets: [{ structureIndex: 0, facetIndex: 0, footprintAreaSqft: 1000, areaSqft: 1100, pitch: "6/12", pitchDegrees: 26.57, pitchConfidence: "measured", orientation: "S", polygon: { type: "Polygon", coordinates: [] } }],
  edges: [{ edgeType: "ridge", lengthFt: 30, geometry: { type: "LineString", coordinates: [] }, leftFacetIndex: 0, rightFacetIndex: null }],
};

describe("isContainerResult", () => {
  it("accepts a well-formed full result", () => expect(isContainerResult(good)).toBe(true));
  it("rejects missing tier", () => expect(isContainerResult({ ...good, tier: undefined })).toBe(false));
  it("rejects a non-array facets", () => expect(isContainerResult({ ...good, facets: "x" })).toBe(false));
  it("rejects null", () => expect(isContainerResult(null)).toBe(false));
});
```

- [ ] **Step 2: Run it — FAIL** (`cd web && npx vitest run __tests__/lib/container-contract.test.ts`).

- [ ] **Step 3: Implement `web/lib/container-contract.ts`:**

```ts
export interface ContainerJob {
  reportId: string;
  propertyId: string;
  lat: number;
  lon: number;
}

export interface ContainerFacet {
  structureIndex: number;
  facetIndex: number;
  footprintAreaSqft: number;
  areaSqft: number;
  pitch: string | null;
  pitchDegrees: number | null;
  pitchConfidence: string | null;
  orientation: string | null;
  polygon: unknown; // GeoJSON
}

export interface ContainerEdge {
  edgeType: string;
  lengthFt: number;
  geometry: unknown; // GeoJSON
  leftFacetIndex: number | null;
  rightFacetIndex: number | null;
}

export interface ContainerResult {
  tier: "full" | "basic";
  modelVersion: string;
  roofAreaSqft: number;
  roofAreaSquares: number;
  numFacets: number;
  numStructures: number;
  wasteFactor: number | null;
  confidenceScore: number;
  pdfKey: string | null;
  overlayKey: string | null;
  imageryKey: string | null;
  facets: ContainerFacet[];
  edges: ContainerEdge[];
}

export function isContainerResult(v: unknown): v is ContainerResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    (r.tier === "full" || r.tier === "basic") &&
    typeof r.modelVersion === "string" &&
    typeof r.roofAreaSqft === "number" &&
    typeof r.numFacets === "number" &&
    typeof r.numStructures === "number" &&
    typeof r.confidenceScore === "number" &&
    Array.isArray(r.facets) &&
    Array.isArray(r.edges)
  );
}
```

- [ ] **Step 4: Run it — PASS.**
- [ ] **Step 5: Commit** — `git add web/lib/container-contract.ts web/__tests__/lib/container-contract.test.ts && git commit -m "feat(jobs): container request/result contract + validator"`

---

### Task 2: Report writer (persist a container result to D1)

**Files:** Create `web/lib/report-writer.ts`; Test `web/__tests__/lib/report-writer.test.ts`

This is the TS replacement for the deleted `ml-service/app/db.py`. It writes the report fields + facets + edges in one place. Edges reference facets by INDEX in the contract; the writer maps those to the created facet row IDs (preserving the `leftFacetId`/`rightFacetId` FK semantics).

- [ ] **Step 1: Write the failing test** (round-trips against local SQLite, mirroring Plan 1's schema-roundtrip):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { writeReportResult } from "@/lib/report-writer";
import type { ContainerResult } from "@/lib/container-contract";

let db: PrismaClient; let sqlite: Database.Database; let reportId: string;

beforeAll(async () => {
  const file = join(mkdtempSync(join(tmpdir(), "anu-")), "t.db");
  sqlite = new Database(file);
  sqlite.exec(readFileSync(join(__dirname, "../../migrations/0001_init.sql"), "utf8"));
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  const u = await db.user.create({ data: { email: "a@b.com", name: "A" } });
  const p = await db.property.create({ data: { userId: u.id, addressRaw: "1", addressNormalized: "1", lat: 1, lon: 2 } });
  const r = await db.report.create({ data: { userId: u.id, propertyId: p.id, status: "processing" } });
  reportId = r.id;
});
afterAll(async () => { await db.$disconnect(); sqlite.close(); });

const result: ContainerResult = {
  tier: "full", modelVersion: "v1.0", roofAreaSqft: 2000, roofAreaSquares: 20,
  numFacets: 2, numStructures: 1, wasteFactor: 14, confidenceScore: 0.9,
  pdfKey: "reports/r/p.pdf", overlayKey: "reports/r/o.png", imageryKey: "imagery/i.png",
  facets: [
    { structureIndex: 0, facetIndex: 0, footprintAreaSqft: 1000, areaSqft: 1100, pitch: "6/12", pitchDegrees: 26.57, pitchConfidence: "measured", orientation: "S", polygon: { type: "Polygon", coordinates: [] } },
    { structureIndex: 0, facetIndex: 1, footprintAreaSqft: 900, areaSqft: 980, pitch: "6/12", pitchDegrees: 26.57, pitchConfidence: "measured", orientation: "N", polygon: { type: "Polygon", coordinates: [] } },
  ],
  edges: [{ edgeType: "ridge", lengthFt: 30, geometry: { type: "LineString", coordinates: [] }, leftFacetIndex: 0, rightFacetIndex: 1 }],
};

describe("writeReportResult", () => {
  it("writes report fields, facets, and edges with facet-index→id mapping", async () => {
    await writeReportResult(db, reportId, result);
    const r = await db.report.findUniqueOrThrow({ where: { id: reportId }, include: { facets: true, edges: true } });
    expect(r.status).toBe("completed");
    expect(r.tier).toBe("full");
    expect(r.roofAreaSqft).toBeCloseTo(2000);
    expect(r.pdfUrl).toBe("reports/r/p.pdf");
    expect(r.facets).toHaveLength(2);
    expect(r.edges).toHaveLength(1);
    const edge = r.edges[0];
    const f0 = r.facets.find((f) => f.facetIndex === 0)!;
    const f1 = r.facets.find((f) => f.facetIndex === 1)!;
    expect(edge.leftFacetId).toBe(f0.id);
    expect(edge.rightFacetId).toBe(f1.id);
    expect(JSON.parse(f0.polygon).type).toBe("Polygon");
  });
});
```

- [ ] **Step 2: Run it — FAIL.**

- [ ] **Step 3: Implement `web/lib/report-writer.ts`:**

```ts
import type { PrismaClient } from "@prisma/client";
import type { ContainerResult } from "@/lib/container-contract";
import { toJsonColumn } from "@/lib/json-columns";

/**
 * Persist a container result for a report: update the report row, create facet
 * rows, then create edge rows mapping the contract's facet INDICES to the new
 * facet row IDs. Marks the report completed.
 */
export async function writeReportResult(db: PrismaClient, reportId: string, result: ContainerResult): Promise<void> {
  await db.report.update({
    where: { id: reportId },
    data: {
      status: "completed",
      tier: result.tier,
      modelVersion: result.modelVersion,
      roofAreaSqft: result.roofAreaSqft,
      roofAreaSquares: result.roofAreaSquares,
      numFacets: result.numFacets,
      numStructures: result.numStructures,
      wasteFactor: result.wasteFactor,
      confidenceScore: result.confidenceScore,
      pdfUrl: result.pdfKey,
      overlayUrl: result.overlayKey,
      processingCompletedAt: new Date(),
    },
  });

  // Map facetIndex -> created row id so edges can resolve their FK references.
  const indexToId = new Map<number, string>();
  for (const f of result.facets) {
    const row = await db.reportFacet.create({
      data: {
        reportId,
        structureIndex: f.structureIndex,
        facetIndex: f.facetIndex,
        footprintAreaSqft: f.footprintAreaSqft,
        areaSqft: f.areaSqft,
        pitch: f.pitch,
        pitchDegrees: f.pitchDegrees,
        pitchConfidence: f.pitchConfidence,
        orientation: f.orientation,
        polygon: toJsonColumn(f.polygon) ?? "null",
      },
    });
    indexToId.set(f.facetIndex, row.id);
  }

  for (const e of result.edges) {
    await db.reportEdge.create({
      data: {
        reportId,
        edgeType: e.edgeType,
        lengthFt: e.lengthFt,
        geometry: toJsonColumn(e.geometry) ?? "null",
        leftFacetId: e.leftFacetIndex === null ? null : indexToId.get(e.leftFacetIndex) ?? null,
        rightFacetId: e.rightFacetIndex === null ? null : indexToId.get(e.rightFacetIndex) ?? null,
      },
    });
  }
}
```

- [ ] **Step 4: Run it — PASS.**
- [ ] **Step 5: Commit** — `git add web/lib/report-writer.ts web/__tests__/lib/report-writer.test.ts && git commit -m "feat(jobs): D1 report-writer (replaces ml-service db.py persistence)"`

---

### Task 3: Container client (typed boundary, stubbed until Plan 4)

**Files:** Create `web/lib/container-client.ts`; modify `web/env.d.ts`

- [ ] **Step 1: Add the CONTAINER + QUEUE bindings to `web/env.d.ts`** `CloudflareEnv` (alongside DB/BUCKET/RATE_LIMITER/QUOTA). QUEUE is a `Queue` producer; CONTAINER is a Fetcher-like binding (the Container's Durable Object exposes `fetch`). Use:
```ts
    QUEUE: Queue;
    CONTAINER: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
```
(Import `Queue` type from `@cloudflare/workers-types` at the top of `env.d.ts`.)

- [ ] **Step 2: Implement `web/lib/container-client.ts`:**

```ts
import type { ContainerJob, ContainerResult } from "@/lib/container-contract";
import { isContainerResult } from "@/lib/container-contract";

/** Invoke the ML container's POST /process and return the validated result. */
export async function callContainer(
  container: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> },
  job: ContainerJob,
): Promise<ContainerResult> {
  const res = await container.fetch("https://container/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      report_id: job.reportId,
      property_id: job.propertyId,
      lat: job.lat,
      lon: job.lon,
    }),
  });
  if (!res.ok) throw new Error(`container /process ${res.status}`);
  const data: unknown = await res.json();
  if (!isContainerResult(data)) throw new Error("container returned malformed result");
  return data;
}
```

- [ ] **Step 3: Verify** — `cd web && npx tsc --noEmit` exit 0.
- [ ] **Step 4: Commit** — `git add web/lib/container-client.ts web/env.d.ts && git commit -m "feat(jobs): typed container client + QUEUE/CONTAINER bindings"`

---

### Task 4: Queue consumer

**Files:** Create `web/lib/queue-consumer.ts`; Test `web/__tests__/lib/queue-consumer.test.ts`

- [ ] **Step 1: Write the failing test** (fake db + fake container; assert status transitions and that writer wrote rows):

```ts
import { describe, it, expect, vi } from "vitest";
import { handleQueueBatch } from "@/lib/queue-consumer";

function fakeEnv(containerResult: unknown, ok = true) {
  const updates: any[] = [];
  const db = {
    report: { update: vi.fn(async ({ data }: any) => { updates.push(data); return {}; }) },
    reportFacet: { create: vi.fn(async () => ({ id: "f" })) },
    reportEdge: { create: vi.fn(async () => ({ id: "e" })) },
  };
  const env = {
    DB: {},
    CONTAINER: { fetch: vi.fn(async () => new Response(JSON.stringify(containerResult), { status: ok ? 200 : 500 })) },
  };
  return { env, db, updates };
}

const result = {
  tier: "basic", modelVersion: "v1.0", roofAreaSqft: 1000, roofAreaSquares: 10,
  numFacets: 1, numStructures: 1, wasteFactor: null, confidenceScore: 0.7,
  pdfKey: "p", overlayKey: "o", imageryKey: "i", facets: [], edges: [],
};

describe("handleQueueBatch", () => {
  it("marks processing then completed and acks on success", async () => {
    const { env, db, updates } = fakeEnv(result);
    const msg = { body: { reportId: "r1", propertyId: "p1", lat: 1, lon: 2 }, ack: vi.fn(), retry: vi.fn() };
    await handleQueueBatch({ messages: [msg] } as any, env as any, () => db as any);
    expect(updates[0].status).toBe("processing");
    expect(updates.some((u) => u.status === "completed")).toBe(true);
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("marks failed and retries on container error", async () => {
    const { env, db, updates } = fakeEnv(result, false);
    const msg = { body: { reportId: "r1", propertyId: "p1", lat: 1, lon: 2 }, ack: vi.fn(), retry: vi.fn() };
    await handleQueueBatch({ messages: [msg] } as any, env as any, () => db as any);
    expect(updates.some((u) => u.status === "failed")).toBe(true);
    expect(msg.retry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it — FAIL.**

- [ ] **Step 3: Implement `web/lib/queue-consumer.ts`:**

```ts
import type { PrismaClient } from "@prisma/client";
import type { ContainerJob } from "@/lib/container-contract";
import { callContainer } from "@/lib/container-client";
import { writeReportResult } from "@/lib/report-writer";
import { createDb } from "@/lib/db";

type QueueMessage = { body: ContainerJob; ack: () => void; retry: () => void };
type QueueBatch = { messages: QueueMessage[] };
type ConsumerEnv = { DB: unknown; CONTAINER: { fetch(i: RequestInfo, init?: RequestInit): Promise<Response> } };

/**
 * Process a batch of report jobs. dbFactory is injected for testability;
 * production passes createDb. Each message: processing -> container -> write -> completed.
 * On error: failed + retry() so Cloudflare Queues redelivers (backoff/DLQ via config).
 */
export async function handleQueueBatch(
  batch: QueueBatch,
  env: ConsumerEnv,
  dbFactory: (d1: unknown) => PrismaClient = createDb as never,
): Promise<void> {
  const db = dbFactory(env.DB);
  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      await db.report.update({ where: { id: job.reportId }, data: { status: "processing", processingStartedAt: new Date() } });
      const result = await callContainer(env.CONTAINER, job);
      await writeReportResult(db, job.reportId, result);
      msg.ack();
    } catch (err) {
      await db.report.update({
        where: { id: job.reportId },
        data: { status: "failed", errorMessage: err instanceof Error ? err.message : "processing error" },
      }).catch(() => {});
      msg.retry();
    }
  }
}
```

- [ ] **Step 4: Run it — PASS.**
- [ ] **Step 5: Commit** — `git add web/lib/queue-consumer.ts web/__tests__/lib/queue-consumer.test.ts && git commit -m "feat(jobs): queue consumer (processing->container->write->completed)"`

---

### Task 5: Producer + wire consumer into the worker; remove ml-client

**Files:** modify `web/app/api/reports/route.ts`, `web/custom-worker.ts`, `web/wrangler.jsonc`; delete `web/lib/ml-client.ts` + `web/__tests__/lib/ml-client.test.ts`

- [ ] **Step 1: Producer.** In `web/app/api/reports/route.ts` POST, replace the `dispatchJob({...})` call (and its `import { dispatchJob } from "@/lib/ml-client"`) with a Queue send. The block currently wrapped in `try { await dispatchJob(...) } catch { mark failed + release quota + 503 }` becomes:
```ts
  // Enqueue the job (durable; the queue consumer processes it).
  try {
    const { env } = getCloudflareContext();
    await env.QUEUE.send({
      reportId: report.id,
      propertyId: property.id,
      lat: Number(property.lat),
      lon: Number(property.lon),
    });
  } catch {
    await db.report.update({ where: { id: report.id }, data: { status: "failed", errorMessage: "Could not queue report" } });
    if (quotaStub) await quotaStub.release(month);
    return NextResponse.json({ error: "Could not queue report, please try again" }, { status: 503 });
  }
```
(`getCloudflareContext` is already imported in this file from Task 6 of Plan 2. Keep the premium/free queue priority idea as a comment for now — single queue in this plan.)

- [ ] **Step 2: Wire the consumer into `web/custom-worker.ts`.** It currently does `export default { fetch: handler.fetch }` and re-exports the DOs. Add a `queue` handler:
```ts
import { handleQueueBatch } from "./lib/queue-consumer";
// ...
export default {
  fetch: handler.fetch,
  queue: (batch: MessageBatch, env: CloudflareEnv) => handleQueueBatch(batch as never, env as never),
} satisfies ExportedHandler<CloudflareEnv>;
```
(If `MessageBatch`/`ExportedHandler` generics need the queue body type, use `MessageBatch<unknown>`; keep it compiling. Reuse the existing DO re-exports.)

- [ ] **Step 3: wrangler.jsonc — declare the queue producer + consumer.** Add:
```jsonc
  "queues": {
    "producers": [{ "binding": "QUEUE", "queue": "anu-reports" }],
    "consumers": [{ "queue": "anu-reports", "max_retries": 3, "dead_letter_queue": "anu-reports-dlq" }]
  },
```

- [ ] **Step 4: Delete the obsolete ML HTTP client.** `git rm web/lib/ml-client.ts web/__tests__/lib/ml-client.test.ts`.

- [ ] **Step 5: Verify**
  - `cd web && grep -rn "ml-client\|dispatchJob" app lib __tests__` → nothing.
  - `cd web && npx tsc --noEmit` → exit 0.
  - `cd web && npx vitest run` → all pass.
  - `cd web && npm run cf:build` → succeeds.
  - Background `npx wrangler dev --local` → boots; the log shows the `QUEUE` producer binding registered (consumer registration may warn locally without a created queue — acceptable; note it). Kill it.
  - `cd web && npx eslint .` → 0 errors.

- [ ] **Step 6: Commit** — `git add -A web/app/api/reports/route.ts web/custom-worker.ts web/wrangler.jsonc && git rm web/lib/ml-client.ts web/__tests__/lib/ml-client.test.ts 2>/dev/null; git commit -m "feat(jobs): Queue producer in reports route + consumer wired into worker; drop ml HTTP client"`

---

## Self-Review

**Spec coverage (§5 + §1 sole-writer):** producer (Task 5) ✓; consumer with processing→container→write→completed + failed/retry (Task 4) ✓; container contract request/response (Task 1) ✓; D1 result persistence replacing db.py (Task 2) ✓; queue + DLQ + max_retries config (Task 5) ✓. Premium-priority second queue: noted as a comment, deferred (single queue suffices; spec allows "if needed").

**Placeholder scan:** none — complete code in every code step; the only stub is the container itself (Plan 4), abstracted behind `callContainer` and injected/mocked in tests.

**Type consistency:** `ContainerResult`/`ContainerJob` (Task 1) used by `report-writer` (Task 2), `container-client` (Task 3), `queue-consumer` (Task 4); `writeReportResult(db, reportId, result)` and `callContainer(container, job)` and `handleQueueBatch(batch, env, dbFactory?)` signatures consistent across definition and call sites; `toJsonColumn` reused from Plan 1.

**Handoff to Plan 4:** the container must implement `POST /process` accepting `{report_id, property_id, lat, lon}` and returning JSON satisfying `isContainerResult` (R2 object keys for pdf/overlay/imagery; edges reference facets by `leftFacetIndex`/`rightFacetIndex`). Plan 4 adds the real `CONTAINER` binding (Cloudflare Container) to wrangler + worker; the consumer code does not change.
