# Cloudflare Migration — Plan 1 of 5: Data Layer (Prisma → D1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the web app's persistence layer from PostgreSQL (Prisma `@prisma/adapter-pg`) to Cloudflare D1 (SQLite, `@prisma/adapter-d1`), with a D1 init migration that applies cleanly, a request-scoped Prisma factory, and JSON (de)serialization helpers for the columns that were `jsonb`.

**Architecture:** SQLite has no enums, no `Decimal`, and (in Prisma) no native `Json` — so enums become validated `String`s, `Decimal` becomes `Float`, and `jsonb` columns become `String` (TEXT) holding JSON, wrapped by typed helpers. Prisma's client is created per request from the D1 binding (`createDb(env.DB)`) rather than a process-wide singleton, because Cloudflare bindings live on the request env, not `process.env`. All work is verifiable offline: the schema round-trips through a `better-sqlite3`-backed Prisma client in Node tests, and the D1 migration applies via `wrangler d1 migrations apply --local` (Miniflare) with no Cloudflare account.

**Tech Stack:** Prisma 7.5, `@prisma/adapter-d1`, `@prisma/adapter-better-sqlite3` (tests only), `wrangler`, `@cloudflare/workers-types`, Vitest.

**Scope:** This plan is subsystem 1 of the migration spec (`docs/superpowers/specs/2026-06-01-cloudflare-migration-design.md` §4). It does NOT wire the binding into Next.js/OpenNext (Plan 2), nor change any API route's query logic beyond what the type changes force. It produces a working, independently-testable data layer.

---

### Task 1: Swap database dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Remove Postgres deps, add D1 + tooling deps**

Run (from `web/`):

```bash
cd web
npm uninstall @prisma/adapter-pg pg @types/pg
npm install @prisma/adapter-d1
npm install -D @prisma/adapter-better-sqlite3 better-sqlite3 @types/better-sqlite3 wrangler @cloudflare/workers-types
```

- [ ] **Step 2: Verify the dependency set**

Run: `cd web && node -e "const p=require('./package.json'); console.log(['@prisma/adapter-pg','pg'].filter(d=>p.dependencies[d]).join(',')||'pg-removed'); console.log(p.dependencies['@prisma/adapter-d1']?'d1-present':'d1-MISSING')"`
Expected: prints `pg-removed` then `d1-present`.

- [ ] **Step 3: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/package.json web/package-lock.json
git commit -m "build: swap pg deps for D1 (adapter-d1 + sqlite test tooling)"
```

---

### Task 2: Rewrite the Prisma schema for SQLite

**Files:**
- Modify: `web/prisma/schema.prisma`

SQLite/Prisma constraints applied: `provider = "sqlite"`; all `enum` blocks deleted and their fields become `String`; every `Decimal`/`Decimal?` becomes `Float`/`Float?`; every `Json`/`Json?` becomes `String`/`String?`; `@db.Date` removed. Relations, indexes, `@map`, `@default(uuid())`, `@updatedAt`, and `onDelete` are preserved unchanged.

- [ ] **Step 1: Replace the entire schema file with the SQLite version**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
}

// NOTE: SQLite/Prisma has no native enums. These were enums in Postgres and are
// now validated in application code (see web/lib/enums.ts). Allowed values:
//   plan:            free | premium
//   status:          queued | processing | completed | failed
//   tier:            full | basic
//   imagerySource:   naip | mapbox
//   pitchConfidence: measured | user_provided
//   edgeType:        ridge | hip | valley | rake | eave | flashing

model User {
  id                    String     @id @default(uuid())
  email                 String     @unique
  name                  String
  companyName           String?    @map("company_name")
  passwordHash          String?    @map("password_hash")
  plan                  String     @default("free")
  stripeCustomerId      String?    @map("stripe_customer_id")
  stripeSubscriptionId  String?    @map("stripe_subscription_id")
  monthlyReportLimit    Int?       @default(5) @map("monthly_report_limit")
  createdAt             DateTime   @default(now()) @map("created_at")
  updatedAt             DateTime   @updatedAt @map("updated_at")

  properties Property[]
  reports    Report[]

  @@map("users")
}

model Property {
  id                  String    @id @default(uuid())
  userId              String    @map("user_id")
  addressRaw          String    @map("address_raw")
  addressNormalized   String    @map("address_normalized")
  lat                 Float
  lon                 Float
  parcelBoundary      String?   @map("parcel_boundary")
  imagerySource       String?   @map("imagery_source")
  imageryCaptureDate  DateTime? @map("imagery_capture_date")
  imageryPath         String?   @map("imagery_path")
  lidarAvailable      Boolean?  @map("lidar_available")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  user    User     @relation(fields: [userId], references: [id])
  reports Report[]

  @@index([userId])
  @@index([lat, lon])
  @@map("properties")
}

model Report {
  id                    String    @id @default(uuid())
  propertyId            String    @map("property_id")
  userId                String    @map("user_id")
  status                String    @default("queued")
  tier                  String?
  modelVersion          String?   @map("model_version")
  roofAreaSqft          Float?    @map("roof_area_sqft")
  roofAreaSquares       Float?    @map("roof_area_squares")
  numFacets             Int?      @map("num_facets")
  numStructures         Int?      @map("num_structures")
  wasteFactor           Float?    @map("waste_factor")
  confidenceScore       Float?    @map("confidence_score")
  pdfUrl                String?   @map("pdf_url")
  overlayUrl            String?   @map("overlay_url")
  retryCount            Int       @default(0) @map("retry_count")
  errorMessage          String?   @map("error_message")
  processingStartedAt   DateTime? @map("processing_started_at")
  processingCompletedAt DateTime? @map("processing_completed_at")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  property Property      @relation(fields: [propertyId], references: [id])
  user     User          @relation(fields: [userId], references: [id])
  facets   ReportFacet[]
  edges    ReportEdge[]

  @@index([userId, createdAt])
  @@index([status])
  @@index([userId, status])
  @@map("reports")
}

model ReportFacet {
  id                String    @id @default(uuid())
  reportId          String    @map("report_id")
  structureIndex    Int       @map("structure_index")
  facetIndex        Int       @map("facet_index")
  footprintAreaSqft Float     @map("footprint_area_sqft")
  areaSqft          Float     @map("area_sqft")
  pitch             String?
  pitchDegrees      Float?    @map("pitch_degrees")
  pitchConfidence   String?   @map("pitch_confidence")
  orientation       String?
  polygon           String
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  report     Report       @relation(fields: [reportId], references: [id], onDelete: Cascade)
  leftEdges  ReportEdge[] @relation("LeftFacet")
  rightEdges ReportEdge[] @relation("RightFacet")

  @@index([reportId])
  @@map("report_facets")
}

model ReportEdge {
  id           String  @id @default(uuid())
  reportId     String  @map("report_id")
  edgeType     String  @map("edge_type")
  lengthFt     Float   @map("length_ft")
  geometry     String
  leftFacetId  String? @map("left_facet_id")
  rightFacetId String? @map("right_facet_id")

  report     Report       @relation(fields: [reportId], references: [id], onDelete: Cascade)
  leftFacet  ReportFacet? @relation("LeftFacet", fields: [leftFacetId], references: [id], onDelete: SetNull)
  rightFacet ReportFacet? @relation("RightFacet", fields: [rightFacetId], references: [id], onDelete: SetNull)

  @@index([reportId])
  @@map("report_edges")
}
```

- [ ] **Step 2: Validate and generate the client**

Run: `cd web && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` and `Generated Prisma Client`. No "enum is not supported" / "Decimal is not supported" / "Json is not supported" errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/prisma/schema.prisma
git commit -m "feat(db): port Prisma schema to SQLite (enums->String, Decimal->Float, Json->TEXT)"
```

---

### Task 3: Typed enum constants + value guards

**Files:**
- Create: `web/lib/enums.ts`
- Test: `web/__tests__/lib/enums.test.ts`

Centralizes the values that used to be Postgres enums so routes validate writes (e.g. a report `status` or facet `pitchConfidence`) instead of relying on the DB to reject bad strings.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { PLAN, REPORT_STATUS, EDGE_TYPE, isEdgeType, isReportStatus } from "@/lib/enums";

describe("enums", () => {
  it("exposes the full value sets", () => {
    expect(PLAN).toEqual(["free", "premium"]);
    expect(REPORT_STATUS).toEqual(["queued", "processing", "completed", "failed"]);
    expect(EDGE_TYPE).toEqual(["ridge", "hip", "valley", "rake", "eave", "flashing"]);
  });

  it("guards accept valid values and reject invalid ones", () => {
    expect(isReportStatus("completed")).toBe(true);
    expect(isReportStatus("done")).toBe(false);
    expect(isEdgeType("ridge")).toBe(true);
    expect(isEdgeType("gutter")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run __tests__/lib/enums.test.ts`
Expected: FAIL — cannot resolve `@/lib/enums`.

- [ ] **Step 3: Write the implementation**

```ts
export const PLAN = ["free", "premium"] as const;
export const REPORT_STATUS = ["queued", "processing", "completed", "failed"] as const;
export const REPORT_TIER = ["full", "basic"] as const;
export const IMAGERY_SOURCE = ["naip", "mapbox"] as const;
export const PITCH_CONFIDENCE = ["measured", "user_provided"] as const;
export const EDGE_TYPE = ["ridge", "hip", "valley", "rake", "eave", "flashing"] as const;

export type Plan = (typeof PLAN)[number];
export type ReportStatus = (typeof REPORT_STATUS)[number];
export type ReportTier = (typeof REPORT_TIER)[number];
export type ImagerySource = (typeof IMAGERY_SOURCE)[number];
export type PitchConfidence = (typeof PITCH_CONFIDENCE)[number];
export type EdgeType = (typeof EDGE_TYPE)[number];

const guard = <T extends readonly string[]>(set: T) =>
  (v: unknown): v is T[number] => typeof v === "string" && (set as readonly string[]).includes(v);

export const isPlan = guard(PLAN);
export const isReportStatus = guard(REPORT_STATUS);
export const isReportTier = guard(REPORT_TIER);
export const isImagerySource = guard(IMAGERY_SOURCE);
export const isPitchConfidence = guard(PITCH_CONFIDENCE);
export const isEdgeType = guard(EDGE_TYPE);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run __tests__/lib/enums.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/lib/enums.ts web/__tests__/lib/enums.test.ts
git commit -m "feat(db): typed enum constants and value guards (replaces PG enums)"
```

---

### Task 4: JSON column helpers

**Files:**
- Create: `web/lib/json-columns.ts`
- Test: `web/__tests__/lib/json-columns.test.ts`

The `polygon`, `geometry`, and `parcelBoundary` columns are now TEXT. These helpers are the single place that serializes on write and parses on read, so route code never hand-rolls `JSON.parse`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toJsonColumn, fromJsonColumn } from "@/lib/json-columns";

describe("json-columns", () => {
  it("round-trips a GeoJSON polygon", () => {
    const poly = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const stored = toJsonColumn(poly);
    expect(typeof stored).toBe("string");
    expect(fromJsonColumn(stored)).toEqual(poly);
  });

  it("treats null/undefined as null both ways", () => {
    expect(toJsonColumn(null)).toBeNull();
    expect(toJsonColumn(undefined)).toBeNull();
    expect(fromJsonColumn(null)).toBeNull();
  });

  it("returns null for unparseable stored text instead of throwing", () => {
    expect(fromJsonColumn("not json{")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run __tests__/lib/json-columns.test.ts`
Expected: FAIL — cannot resolve `@/lib/json-columns`.

- [ ] **Step 3: Write the implementation**

```ts
/** Serialize a value for a TEXT-backed JSON column. null/undefined -> null. */
export function toJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

/** Parse a TEXT-backed JSON column. null or malformed -> null (never throws). */
export function fromJsonColumn<T = unknown>(stored: string | null | undefined): T | null {
  if (stored === null || stored === undefined) return null;
  try {
    return JSON.parse(stored) as T;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run __tests__/lib/json-columns.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/lib/json-columns.ts web/__tests__/lib/json-columns.test.ts
git commit -m "feat(db): JSON (de)serialization helpers for TEXT-backed columns"
```

---

### Task 5: Request-scoped Prisma factory over D1

**Files:**
- Modify: `web/lib/db.ts`
- Modify: `web/__tests__/lib/db.test.ts`

Cloudflare bindings (the D1 database) are not on `process.env` — they arrive on the request `env`. So `db.ts` exports a `createDb(d1)` factory instead of a process-wide singleton. Plan 2 will call it with `getCloudflareContext().env.DB`. The existing test, which imported the singleton, is updated to exercise the factory against a `better-sqlite3` Prisma client so it runs in plain Node.

- [ ] **Step 1: Replace `web/lib/db.ts`**

```ts
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import type { D1Database } from "@cloudflare/workers-types";

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
```

- [ ] **Step 2: Replace `web/__tests__/lib/db.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db";

describe("createDb", () => {
  it("is a factory that returns a Prisma client exposing the migrated models", () => {
    // Minimal D1-shaped stub: adapter construction must not touch the connection.
    const fakeD1 = { prepare: () => ({}), batch: async () => [], exec: async () => ({}) };
    const db = createDb(fakeD1 as never);
    for (const model of ["user", "property", "report", "reportFacet", "reportEdge"] as const) {
      expect(db[model]).toBeDefined();
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd web && npx vitest run __tests__/lib/db.test.ts`
Expected: PASS — the factory builds a client and the five model delegates are present. (Constructing `PrismaD1` does not open a connection, so the stub suffices.)

- [ ] **Step 4: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/lib/db.ts web/__tests__/lib/db.test.ts
git commit -m "feat(db): request-scoped createDb(d1) factory over @prisma/adapter-d1"
```

---

### Task 6: Generate the D1 init migration SQL

**Files:**
- Create: `web/migrations/0001_init.sql`
- Delete: `web/prisma/migrations/` (the Postgres migration is obsolete)

D1 migrations are plain `.sql` files applied by wrangler, not Prisma Migrate. We derive the SQLite DDL from the schema with `prisma migrate diff` and store it where wrangler expects it.

- [ ] **Step 1: Generate SQLite DDL from the schema**

Run (from `web/`):

```bash
cd web
mkdir -p migrations
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > migrations/0001_init.sql
```

- [ ] **Step 2: Verify the generated SQL targets SQLite**

Run: `cd web && grep -c "CREATE TABLE" migrations/0001_init.sql && grep -iqs "PRAGMA\|TEXT\|REAL\|INTEGER" migrations/0001_init.sql && echo "sqlite-ddl-ok"`
Expected: prints `5` (users, properties, reports, report_facets, report_edges) then `sqlite-ddl-ok`. The file must NOT contain Postgres types like `JSONB`, `DECIMAL`, or `CREATE TYPE ... AS ENUM`.

- [ ] **Step 3: Remove the obsolete Postgres migrations**

Run: `cd web && rm -rf prisma/migrations`

- [ ] **Step 4: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/migrations/0001_init.sql
git rm -r --cached web/prisma/migrations 2>/dev/null || true
git add -A web/prisma
git commit -m "feat(db): D1 init migration SQL; drop obsolete Postgres migration"
```

---

### Task 7: Minimal wrangler config + local D1 apply (offline verification)

**Files:**
- Create: `web/wrangler.jsonc`

A minimal wrangler config declares the `DB` D1 binding and points at the `migrations/` dir so we can apply migrations to a **local** Miniflare D1 with no Cloudflare account. Plan 2 expands this config with R2/Queue/DO bindings and the OpenNext worker entry. The `database_id` is a placeholder until Plan 5 provisions the real database.

- [ ] **Step 1: Create `web/wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "anu-web",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "migrations_dir": "migrations",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "anu",
      "database_id": "local-placeholder-0000-0000-000000000000"
    }
  ]
}
```

- [ ] **Step 2: Apply the migration to a local D1 and confirm the tables exist**

Run (from `web/`):

```bash
cd web
npx wrangler d1 migrations apply anu --local
npx wrangler d1 execute anu --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected: migration `0001_init.sql` reports applied; the SELECT lists `_cf_KV` (Miniflare bookkeeping is fine) plus `properties`, `report_edges`, `report_facets`, `reports`, `users`.

- [ ] **Step 3: Round-trip a row through Prisma against local SQLite (Node, offline)**

This proves the generated client + DDL actually work together. Create `web/__tests__/lib/schema-roundtrip.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";

let db: PrismaClient;
let sqlite: Database.Database;

beforeAll(() => {
  const file = join(mkdtempSync(join(tmpdir(), "ep-")), "test.db");
  sqlite = new Database(file);
  // Apply the same DDL wrangler applies to D1.
  sqlite.exec(readFileSync(join(__dirname, "../../migrations/0001_init.sql"), "utf8"));
  db = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: `file:${file}` }) });
});

afterAll(async () => {
  await db.$disconnect();
  sqlite.close();
});

describe("schema round-trip on SQLite", () => {
  it("creates a user -> property -> report -> facet and reads them back", async () => {
    const user = await db.user.create({ data: { email: "a@b.com", name: "A" } });
    const prop = await db.property.create({
      data: { userId: user.id, addressRaw: "1 St", addressNormalized: "1 St", lat: 40.1, lon: -74.2 },
    });
    const report = await db.report.create({
      data: { propertyId: prop.id, userId: user.id, status: "completed", roofAreaSqft: 2000.5 },
    });
    await db.reportFacet.create({
      data: {
        reportId: report.id, structureIndex: 0, facetIndex: 0,
        footprintAreaSqft: 1000, areaSqft: 1100,
        polygon: JSON.stringify({ type: "Polygon", coordinates: [] }),
      },
    });

    const loaded = await db.report.findUniqueOrThrow({
      where: { id: report.id },
      include: { facets: true, property: true },
    });
    expect(loaded.status).toBe("completed");
    expect(loaded.roofAreaSqft).toBeCloseTo(2000.5);
    expect(loaded.property.lat).toBeCloseTo(40.1);
    expect(loaded.facets).toHaveLength(1);
    expect(JSON.parse(loaded.facets[0].polygon).type).toBe("Polygon");
  });
});
```

- [ ] **Step 4: Run the round-trip test**

Run: `cd web && npx vitest run __tests__/lib/schema-roundtrip.test.ts`
Expected: PASS (1 passing) — confirms the D1 DDL + generated Prisma client agree on every column type.

- [ ] **Step 5: Run the whole web test suite to confirm nothing regressed**

Run: `cd web && npx vitest run`
Expected: all suites pass (`enums`, `json-columns`, `db`, `schema-roundtrip`, plus the pre-existing `redis`/`s3`/`ml-client`/`health` tests — those still pass because Plan 1 didn't touch them).

- [ ] **Step 6: Commit**

```bash
cd /Users/vladimirkamenev/Documents/DeGenito/eagle
git add web/wrangler.jsonc web/__tests__/lib/schema-roundtrip.test.ts
git commit -m "feat(db): minimal wrangler config + offline D1 migration & round-trip test"
```

---

## Self-Review

**Spec coverage (spec §4 — Data Layer):**
- provider → sqlite, adapter-d1 → Task 1, 2, 5 ✓
- enums → String + app validation → Task 2 (schema) + Task 3 (guards) ✓
- Json → TEXT → Task 2 (schema) + Task 4 (helpers) ✓
- Decimal → Float → Task 2 ✓
- migrations regenerated for SQLite, applied via wrangler → Task 6, 7 ✓
- Quota Durable Object: explicitly deferred to Plan 3 (job system) — not this plan ✓
- Cross-user cache / stale-job / cleanup: spec marks out of scope ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the command and expected output. The `database_id` placeholder in Task 7 is intentional and labeled (real value provisioned in Plan 5). ✓

**Type consistency:** `createDb(d1: D1Database)` defined in Task 5 is used consistently; enum value arrays in Task 3 exactly match the schema comment in Task 2 and the original Postgres enums (`free|premium`, `queued|processing|completed|failed`, `full|basic`, `naip|mapbox`, `measured|user_provided`, `ridge|hip|valley|rake|eave|flashing`); `toJsonColumn`/`fromJsonColumn` names match between Task 4 definition and usage. ✓

**Handoff note:** Plan 2 must (a) call `createDb(getCloudflareContext().env.DB)` wherever routes imported the old `db` singleton, (b) wrap `polygon`/`geometry`/`parcelBoundary` reads/writes with the Task 4 helpers, and (c) validate enum-typed writes with the Task 3 guards.
