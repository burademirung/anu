# Anu

**Automated roof-measurement reports from public aerial imagery and LiDAR — built entirely on Cloudflare.**

Anu is a **free** web platform for roofing contractors. A user enters a property
address; Anu generates a measurement report — total roof area, per-facet area and
pitch, edge lengths (ridge / hip / valley / rake / eave), a material waste factor, and
a confidence score — rendered as an on-screen overlay and a downloadable PDF. It uses
free government data (USDA **NAIP** aerial imagery + USGS **3DEP LiDAR**) and
**OpenStreetMap** building footprints, positioning it as a low-cost alternative to
commercial aerial-measurement tools. **Free for everyone, unlimited reports.**

---

## Table of contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Report lifecycle (end-to-end)](#report-lifecycle-end-to-end)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Data model](#data-model)
- [Cloudflare resources & bindings](#cloudflare-resources--bindings)
- [Local development](#local-development)
- [Testing](#testing)
- [Configuration & secrets](#configuration--secrets)
- [Deployment](#deployment)
- [Try it](#try-it)
- [Roadmap](#roadmap)

---

## How it works

A roof report is produced from three free public data sources, combined for accuracy:

1. **OpenStreetMap building footprints** (Overpass API) — the precise building outline at
   the geocoded address (the polygon that *contains* the point, with address/nearest
   fallbacks). This replaced an earlier CV approach: NAIP at ~60 cm/px is too coarse for
   reliable footprint segmentation, whereas OSM footprints (largely ML-derived, e.g.
   Microsoft Buildings) are more accurate and free of training cost.
2. **NAIP aerial imagery** (Microsoft Planetary Computer STAC) — fetched via
   **Cloud-Optimized GeoTIFF windowed reads** (HTTP range requests pull only the ~1024²
   window, ~3 MB instead of ~400 MB) for the overlay and visual context.
3. **USGS 3DEP LiDAR** (Entwine Point Tiles, via PDAL) — the 3-D roof geometry. Iterative
   **RANSAC plane-fitting** segments the point cloud into facets; plane normals give pitch
   and orientation; plane intersections are classified into edge types.

When LiDAR is available the report is **full** (per-facet pitch, edges, waste factor);
where it isn't (~1% of the US), it degrades to a **basic** footprint-area report and the
user can input pitch manually.

---

## Architecture

Everything runs on Cloudflare. The web app is a single Worker; the heavy Python pipeline
runs as a Cloudflare **Container**; persistence is **D1** (SQLite) and **R2**; async work
flows through **Queues**; rate-limiting and per-user quota use **Durable Objects**.

```
Browser ──https──▶  ┌──────────────────────────────────────────────────────────┐
                    │  Web Worker  (Next.js 16.2 via @opennextjs/cloudflare)     │
                    │  • NextAuth v5 (JWT)   • dashboard + report viewer         │
                    │  • REST API routes     • edge middleware (verifies JWT)    │
                    │  bindings: DB(D1) · BUCKET(R2) · QUEUE · RATE_LIMITER ·     │
                    │            QUOTA · CONTAINER · ASSETS                       │
                    └───────┬───────────────────────────────┬────────────────────┘
              enqueue job   │                               │  read / write
                            ▼                               ▼
                   Cloudflare Queue  "anu-reports"     D1 (SQLite)  ── source of truth
                     (+ "anu-reports-dlq")             users · properties · reports
                            │ consume                  report_facets · report_edges
                            ▼
                   queue() consumer  (same Worker)  ── the ONLY job-path DB writer
                     processing → invoke Container → write result to D1 → completed
                     on error → failed + retry (Queue backoff; exhausted → DLQ)
                            │ HTTP  POST /process   (via getContainer(env.CONTAINER))
                            ▼
                   Cloudflare Container  (Python / FastAPI, stateless)
                     OSM footprint · NAIP COG (rasterio) · LiDAR (PDAL) ·
                     RANSAC plane-fit · measurer · reporter (PDF + overlay)
                     uploads artifacts to R2 (S3 API) · returns JSON result
                     holds NO DB creds — only R2 S3 keys
                            │ PUT pdf / overlay / imagery
                            ▼
                        R2 bucket  "anu"
```

**Key design decisions**

- **The Worker is the sole DB writer for the job path.** The container is stateless
  compute: it runs the pipeline, writes artifacts to R2, and *returns* a structured JSON
  result. The Worker's queue consumer persists that result to D1. The container holds no
  database credentials.
- **Postgres-isms replaced with Cloudflare primitives.** Celery + Redis broker → Queues;
  Redis sliding-window rate-limit → a Durable Object; the Postgres advisory-lock used for
  quota → a per-user Durable Object (single-threaded, so "count → reserve" is atomic);
  MinIO → R2; Postgres → D1 (SQLite).
- **Status via polling, not SSE.** A long-held SSE stream fights Worker limits, so the
  report viewer polls a small JSON endpoint every 2 s until the report reaches a terminal
  state, then refreshes.

---

## Report lifecycle (end-to-end)

1. **Address → coordinates.** The new-report page geocodes the address via the **US Census
   Geocoder** (free, no API key required, US-only) → `{ lat, lon, addressNormalized }`.
2. **`POST /api/reports`** (Web Worker): authenticates (NextAuth), checks the
   **rate-limit Durable Object** (per-IP + per-user), and consumes a slot from the
   **per-user quota Durable Object** if applicable. Finds/creates the
   `Property` (per-user dedup within ~50 m), inserts a `Report` row as `queued`, then
   `env.QUEUE.send({ reportId, propertyId, lat, lon })`. Returns immediately.
3. **Queue consumer** (`queue()` handler in the same Worker): marks the report
   `processing`, then calls the container via `getContainer(env.CONTAINER).fetch("…/process")`.
4. **Container `POST /process`**: runs the pipeline (OSM → NAIP → LiDAR → RANSAC →
   measure → render), uploads the **PDF**, **overlay PNG**, and **imagery** to R2, and
   returns a JSON `ContainerResult` (measurements + facets + edges + R2 object keys).
5. **Persist.** The consumer validates the result and writes the report fields, facet
   rows, and edge rows to **D1** (mapping each edge's facet *indices* to the created facet
   row IDs), then marks the report `completed`. On any error it marks it `failed` and lets
   the Queue retry (with backoff; exhausted messages go to the dead-letter queue).
6. **View.** The report viewer (a server component) shows the overlay (streamed from R2
   through an authenticated route), the measurement summary, the facet table, and the edge
   summary, with a **PDF download**. While processing, a small client `StatusPoller`
   polls `GET /api/reports/[id]/status` and refreshes on completion. Users can override a
   facet's pitch (`PATCH …/facets/[facetId]/pitch`), which recomputes surface area from the
   immutable footprint and updates report totals.

---

## Repository layout

```
.
├── README.md
├── web/                         # Next.js app → Cloudflare Worker (OpenNext)
│   ├── app/                     # App Router: pages + API routes
│   │   ├── (auth)/              # login / register
│   │   ├── dashboard/           # reports, new report, settings
│   │   └── api/                 # reports, properties/geocode, health
│   ├── components/              # report-viewer (overlay, facet table, summary), UI
│   ├── db/                      # schema.ts (Drizzle ORM table definitions)
│   ├── lib/                     # db.ts (getDb() → Drizzle D1 client), s3 (R2),
│   │                            #   rate-limit, enums, json-columns, auth,
│   │                            #   container-contract, container-client,
│   │                            #   queue-consumer, report-writer
│   ├── durable-objects/         # rate-limiter.ts (RateLimiterDO), quota.ts (QuotaDO)
│   ├── containers/              # anu-ml.ts (AnuMLContainer — the ML container binding)
│   ├── custom-worker.ts         # Worker entry: re-exports OpenNext fetch + queue() + DOs + Container
│   ├── migrations/              # D1 SQL migrations (applied via `wrangler d1 migrations`)
│   ├── wrangler.jsonc           # bindings: D1, R2, Queues, Durable Objects, Container, assets
│   ├── open-next.config.ts      # OpenNext Cloudflare adapter config
│   ├── next.config.ts           # security headers + OpenNext dev init
│   └── __tests__/               # Vitest unit tests
├── ml-service/                  # Python pipeline → Cloudflare Container
│   ├── app/
│   │   ├── main.py              # FastAPI: GET /health, POST /process
│   │   ├── pipeline/            # orchestrator, fetcher, building_footprints, stitcher,
│   │   │                        #   plane_fitter, edge_extractor, measurer, reporter, result
│   │   ├── imagery/             # naip.py (STAC COG), mapbox.py, elevation.py (3DEP)
│   │   └── utils/               # geo.py (coords/GSD), storage.py (R2 via boto3)
│   ├── tests/                   # pytest (geo, plane_fitter, measurer, result contract)
│   ├── requirements.txt
│   └── Dockerfile               # GDAL base; runs uvicorn app.main:app as non-root
└── docs/superpowers/
    ├── specs/                   # system design
    └── plans/                   # phased implementation + the deploy runbook (plan 05)
```

---

## Tech stack

**Web (`web/`)**
- Next.js **16.2** (App Router) on Cloudflare Workers via **`@opennextjs/cloudflare`**
- React 19 · TypeScript · Tailwind CSS 4
- **Drizzle ORM** (`drizzle-orm/d1`) — schema at `web/db/schema.ts`, client via `getDb()`
  in `web/lib/db.ts`. Drizzle is wasm-free and runs natively on Cloudflare Workers
  (Prisma's WASM engine does not bundle through OpenNext).
- **NextAuth v5** (JWT sessions; credentials + optional Google OAuth; bcrypt)
- **`@cloudflare/containers`** (Container binding) · **Vitest** (unit tests)

**ML service (`ml-service/`)** — Python 3.12, FastAPI + Uvicorn
- `rasterio` / GDAL (COG windowed reads) · **PDAL** (LiDAR) · `shapely` · `scipy` /
  `numpy` (RANSAC plane fit) · `Pillow` · `reportlab` (PDF) · `pystac-client` (STAC) ·
  `boto3` (R2 S3 API)

**Platform** — Cloudflare Workers · D1 · R2 · Queues · Durable Objects · Containers.
Geocoding: **US Census Geocoder** (free, no API key, US-only).

> All dependencies are pinned to their latest releases as of mid-2026.

---

## Data model

D1 / SQLite, via Drizzle ORM (schema at `web/db/schema.ts`). Enums are stored as validated
strings (`web/lib/enums.ts`); GeoJSON columns are stored as TEXT and (de)serialized via
`web/lib/json-columns.ts`. D1 migrations are plain SQL files in `web/migrations/`, applied
via `wrangler d1 migrations apply`.

- **users** — email, name, company, `passwordHash`, `monthlyReportLimit` (null = unlimited).
- **properties** — owner, raw + normalized address, lat/lon, optional parcel boundary,
  cached imagery source/date/path, `lidarAvailable`. Indexed by `userId` and `(lat, lon)`.
- **reports** — `status` (`queued` | `processing` | `completed` | `failed`), `tier`
  (`full` | `basic`), model version, roof area (sqft + squares), facet/structure counts,
  waste factor, confidence, R2 keys for pdf/overlay, retry/error fields, timestamps.
- **report_facets** — per facet: `structureIndex`, `facetIndex`, immutable
  `footprintAreaSqft`, derived `areaSqft`, `pitch` (e.g. `6/12`), `pitchDegrees`,
  `pitchConfidence` (`measured` | `user_provided`), `orientation`, `polygon` (GeoJSON).
- **report_edges** — `edgeType` (`ridge` | `hip` | `valley` | `rake` | `eave` |
  `flashing`), `lengthFt`, `geometry` (GeoJSON), and nullable `leftFacetId`/`rightFacetId`
  FKs (cascade on report delete; set-null on facet delete).

---

## Cloudflare resources & bindings

Declared in `web/wrangler.jsonc`:

| Binding | Type | Name | Purpose |
|---|---|---|---|
| `DB` | D1 | `anu` | source of truth (users, properties, reports, facets, edges) |
| `BUCKET` | R2 | `anu` | report PDFs, overlays, cached imagery |
| `QUEUE` | Queue (producer) | `anu-reports` | enqueue report jobs (+ `anu-reports-dlq`) |
| `RATE_LIMITER` | Durable Object | `RateLimiterDO` | sliding-window rate limiting |
| `QUOTA` | Durable Object | `QuotaDO` | per-user monthly report quota |
| `CONTAINER` | Container (DO-backed) | `AnuMLContainer` | the Python ML pipeline (`POST /process`, port 8000) |
| `ASSETS` | Assets | — | static assets (OpenNext) |

Custom classes (`RateLimiterDO`, `QuotaDO`, `AnuMLContainer`) are re-exported from
`web/custom-worker.ts` so the Worker runtime can bind them.

---

## Local development

Prereqs: Node 20+ and npm. Python 3.12 only needed to run the ML pipeline/tests.

```bash
# Web app
cd web
npm install
npx wrangler d1 migrations apply anu --local          # create + migrate a local D1 (Miniflare)
cp .dev.vars.example .dev.vars                         # fill in local secret values
npm run cf:dev                                         # wrangler dev (Worker runtime, all bindings local)
#   or: npm run dev   (next dev; getCloudflareContext bindings via OpenNext dev shim)
```

Useful scripts (`web/package.json`): `cf:build` (`opennextjs-cloudflare build`),
`cf:preview`, `cf:dev`, `test` (Vitest), `lint`.

```bash
# ML service (optional, for pipeline work)
cd ml-service
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt          # note: rasterio/PDAL need GDAL system libs
uvicorn app.main:app --reload --port 8000
```

> The local Worker (`wrangler dev --local`) runs against Miniflare's local D1/R2/Queues/DOs
> — no Cloudflare account needed for development.

---

## Testing

```bash
cd web && npx vitest run            # web unit tests (enums, json-columns, db round-trip,
                                    #   r2 helper, rate-limit/quota DOs, container contract,
                                    #   report-writer, queue consumer, health)
cd ml-service && python3 -m pytest tests/ -q   # geo, plane-fitter, measurer, result contract
```

The web suite includes a **schema round-trip** test that applies the real D1 migration SQL
to an in-process SQLite database and exercises the Drizzle ORM client, so schema and
DDL can't silently drift. The report-writer test round-trips a full container result
(report + facets + edges with FK mapping) the same way.

---

## Configuration & secrets

Secrets are **not** committed. Locally they live in `web/.dev.vars` (see
`web/.dev.vars.example`); in production they're set with `wrangler secret put`.

**Web Worker secrets**

| Name | Purpose |
|---|---|
| `NEXTAUTH_SECRET` | JWT session signing (random 32+ chars) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token (for signed URL generation) |
| `R2_ENDPOINT` / `R2_BUCKET` | R2 S3 endpoint and bucket name |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional Google OAuth |

No `DATABASE_URL` is needed — the D1 database is accessed via the `DB` Workers binding.
Geocoding uses the US Census Geocoder and requires no API key.

**Container env** (see `ml-service/.env.example`) — `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The container reaches R2 over the S3 API (Workers
bindings don't extend into containers), so it needs an R2 API token.

`MAPBOX_ACCESS_TOKEN` is an optional env var for the container's fallback aerial imagery
only; it is not required for geocoding and not a required secret.

---

## Deployment

The app is live at **`https://anu-web.burademirung.workers.dev`**. The full,
copy-pasteable operator runbook is in [`docs/DEPLOY.md`](docs/DEPLOY.md).
In short:

```bash
cd web
npx wrangler login
npx wrangler d1 create anu          # then put the returned database_id in wrangler.jsonc
npx wrangler r2 bucket create anu
npx wrangler queues create anu-reports && npx wrangler queues create anu-reports-dlq
npx wrangler d1 migrations apply anu --remote
# pre-build + push the ML container image (required before first deploy):
wrangler containers build ../ml-service -t anu-ml:v1 -p
# set Worker secrets (wrangler secret put …) and the container's R2 env (dashboard)
npm run cf:build
OPEN_NEXT_DEPLOY=1 npx wrangler deploy   # deploy the Worker (bypass OpenNext's deploy wrapper)
```

Requires a **Workers Paid** plan (Containers, Queues, and Durable Objects need it) and a
Docker daemon (colima works headless) to build the container image. See `docs/DEPLOY.md`
for the full runbook.

---

## Try it

The live site is at **`https://anu-web.burademirung.workers.dev`**. Demo accounts are
seeded and shown on the login page and home-page hero:

| Email | Password | Reports |
|---|---|---|
| `demo@anu.dev` | `AnuDemo2026!` | 6 sample reports |
| `solo@anu.dev` | `AnuDemo2026!` | 3 sample reports |

Anu is completely free — no subscription or payment required.

---

## Roadmap

Deferred, intentionally out of the current scope:

- **Cloudflare Cron Triggers** for stale-job recovery (re-queue stuck reports) and
  cleanup (delete >90-day reports + their R2 objects).
- **Cross-user imagery cache** (reuse a cached NAIP tile across nearby properties).
- **Custom domain** (currently `*.workers.dev`).
- **Password reset email** (Resend) and broader Google OAuth.
- **Cloudflare-native CI** (a `wrangler deploy` GitHub Action).
