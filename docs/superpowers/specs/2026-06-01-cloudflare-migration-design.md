# Anu → Cloudflare Migration

**Date:** 2026-06-01
**Status:** Approved
**Author:** Design session

## Overview

Migrate the entire Anu stack off the Docker-Compose /
DigitalOcean droplet model and onto Cloudflare primitives. The system must run
**completely on Cloudflare** — web, data, storage, queueing, rate limiting, and the
heavy Python ML pipeline.

**Commitment: no fallbacks.** We target **Next.js 16.2** on the OpenNext Cloudflare
adapter (upgrading from the repo's current 16.1.6) and the Python pipeline on Cloudflare
Containers. Build toolchain uses Node 20/22 (Next 16 requires Node ≥18.18); the deployed
runtime is `workerd` + `nodejs_compat`, not Node itself. If a component resists (adapter
incompatibility, container memory tier), we fix forward — patch/slim/split — rather than
retreat to Next 15 or an off-Cloudflare VM.

Deploy target: a `*.workers.dev` subdomain. Authentication to Cloudflare: the operator
runs `wrangler login` interactively; all other provisioning is driven via wrangler.

## Decisions (locked)

| Concern | Decision |
|---|---|
| ML pipeline runtime | **Cloudflare Containers** (existing Python image, slimmed) |
| Database | **Cloudflare D1** (SQLite) via `@prisma/adapter-d1` |
| Object storage | **R2** |
| Job queue / broker | **Cloudflare Queues** (replaces Celery + Redis broker) |
| Rate limiting | **Durable Object** (replaces Redis sliding window) |
| Quota serialization | **Per-user Durable Object** (replaces `pg_advisory_xact_lock`) |
| Web runtime | **Workers** via `@opennextjs/cloudflare` (Next.js 16.2) |
| Status updates | **Client short-poll** of a JSON endpoint (replaces SSE stream) |
| Reverse proxy | none — Workers handles TLS + routing (Caddy removed) |
| Deploy host | `*.workers.dev` |

## 1. Target Architecture

```
Browser ──https──▶ Web Worker (Next.js / @opennextjs/cloudflare)
                     NextAuth v5 · dashboard · API routes
                     bindings: D1, R2, QUEUE(producer), QUOTA_DO, RATELIMIT_DO
                       │ enqueue                    │ read/write
                       ▼                            ▼
                 Cloudflare Queue "reports"    D1 (SQLite) — source of truth
                       │ consume
                       ▼
                 Queue-Consumer Worker  ← the ONLY job-path DB writer
                   report→processing · invoke Container · write results to D1
                   on error → failed + Queue retry/backoff/DLQ
                   bindings: D1, CONTAINER, R2
                       │ HTTP via Container binding (Durable Object-managed)
                       ▼
                 Cloudflare Container (slim Python image)
                   FastAPI POST /process (synchronous)
                   OSM footprint · NAIP COG (rasterio) · LiDAR (PDAL) ·
                   RANSAC plane-fit · measurer · edge extractor · reporter
                   writes PDF/overlay/imagery to R2 (S3 API); returns JSON
                   holds NO DB creds — only R2 S3 creds + Mapbox token
                       │
                   R2 bucket "anu"
```

### Core architectural shift

- **The Worker is the sole DB writer for the job path.** The container no longer touches
  the database. `ml-service/app/db.py` is deleted. The container runs the pipeline,
  uploads artifacts to R2, and **returns a structured JSON result**; the Queue-consumer
  Worker writes `reports`, `report_facets`, and `report_edges` rows to D1.
- **Status transitions move to the Worker.** `queued` (producer) → `processing`
  (consumer, before container call) → `completed` / `failed` (consumer, after).
- **The container is stateless compute** — horizontally replaceable, holds no DB creds.

## 2. Component Migration

| Today | Becomes | Notes |
|---|---|---|
| Celery + Redis broker | Cloudflare Queue + consumer Worker | Native retries/backoff/DLQ replace Celery retry logic |
| `ml-service/app/db.py` | deleted | Worker persists results |
| FastAPI `POST /jobs` (202 + Celery) | FastAPI `POST /process` (sync, returns result JSON) | Same pipeline inside |
| `ml-service/app/tasks.py` (Celery) | deleted | Queue consumer Worker owns orchestration timing |
| MinIO (`web/lib/s3.ts`, `app/utils/storage.py`) | R2 | Worker via R2 binding; container via R2 S3 API (`boto3`/minio-client → R2 endpoint) |
| Redis rate-limit (`web/lib/rate-limit.ts`, `web/lib/redis.ts`) | Durable Object | DO holds sliding-window counters |
| `pg_advisory_xact_lock` quota (`POST /api/reports`) | per-user Durable Object | Atomic count→insert; DO id = `userId` |
| SSE `GET /api/reports/[id]/status` | plain JSON `GET .../status` + client poll (2s) | Long-held SSE fights Worker limits |
| Prisma `@prisma/adapter-pg` + `pg` | `@prisma/adapter-d1`, `provider="sqlite"` | enums→TEXT, JSONB→TEXT(JSON), Decimal→REAL |
| Caddy (`Caddyfile*`) | removed | Workers does TLS + routing |
| `docker-compose*.yml`, droplet | wrangler + Cloudflare | |
| GitHub Actions (`web.yml`, `ml.yml`) | wrangler deploy + container CI | |

## 3. ML Image Slimming

The U-Net is dead code (replaced by OSM footprints in commit `bef5ca7`), yet the image
installs `torch`, `torchvision`, `segmentation-models-pytorch` (~2 GB+) solely for it.
These are **removed**. `open3d` is removed if the RANSAC path uses only scipy/numpy
(verify during implementation; the plane fitter appears to use a custom scipy RANSAC).

**Kept (load-bearing):** `rasterio`/GDAL (COG windowed reads), PDAL (LiDAR), `shapely`,
`scipy`, `numpy`, `Pillow`, `reportlab`, `fastapi`, `uvicorn`, `pydantic`, `requests`.
**Removed:** `torch`, `torchvision`, `segmentation-models-pytorch`, `celery[redis]`,
`psycopg2-binary`, `minio` (replaced by an R2 S3 client), and `open3d` (pending verify).
`app/models/unet.py`, `app/pipeline/segmenter.py`, and `training/` are deleted.

Slimming lowers the required Container memory tier — directly improving whether the
pipeline fits a Cloudflare Container instance.

## 4. Data Layer (D1 / SQLite)

- Prisma `datasource` provider → `sqlite`; client uses `@prisma/adapter-d1` bound to the
  `DB` D1 binding. Migrations regenerated for SQLite and applied via `wrangler d1 migrations`.
- **Type mapping:** Prisma enums → `String` with app-level validation (SQLite has no
  enums); `Json?` columns persist as TEXT; `Decimal` → `Float` (`REAL`) — measurements do
  not require exact-decimal precision.
- **Quota** (`reports` count for free users): served by a per-user Durable Object that
  serializes `count(this month, status != failed)` → conditional insert. Replaces the
  advisory-lock + COUNT pattern in `POST /api/reports`.
- **Cross-user imagery cache / stale-job recovery / 90-day cleanup**: out of scope for the
  migration (they were specced but unimplemented previously); the cleanup cron becomes a
  Cloudflare Cron Trigger in a later iteration, not this migration.

## 5. Job System

- **Producer:** `POST /api/reports` (web Worker) validates auth, checks rate-limit DO,
  acquires quota via quota DO, inserts a `queued` report, then `env.QUEUE.send({reportId,
  propertyId, lat, lon, tier_priority})`. Premium → higher-priority handling (single queue;
  priority modeled via message attribute or a second queue if needed).
- **Consumer:** a dedicated Worker `queue()` handler. Per message: set `processing`, call
  `env.CONTAINER` `POST /process`, await JSON, write `reports`/`facets`/`edges` to D1, set
  `completed`. On throw: set `failed`, rethrow so Queues retries (max_retries with backoff;
  exhausted → DLQ).
- **Container invocation contract** (the critical interface):
  - Request: `{ report_id, property_id, lat, lon }`
  - Response: `{ tier, model_version, roof_area_sqft, roof_area_squares, num_facets,
    num_structures, waste_factor, confidence_score, pdf_key, overlay_key, imagery_key,
    facets:[...], edges:[...] }` (all artifact keys are R2 object keys).
  - Errors: non-2xx with `{ error }`; consumer marks report failed.

## 6. Web Worker (OpenNext)

- `@opennextjs/cloudflare` adapter; `open-next.config.ts`; `wrangler.jsonc` with bindings
  (D1 `DB`, R2 `BUCKET`, Queue `QUEUE`, DOs `QUOTA_DO`/`RATELIMIT_DO`, secrets).
- NextAuth v5 JWT sessions run in the Worker. `middleware.ts` cookie guard retained.
- R2 download routes (`/api/reports/[id]/{pdf,overlay,imagery}`) read via the R2 binding
  and stream to the browser (same auth-and-stream model as today).
- Status route returns JSON; the report viewer client polls every 2s until terminal.
- `lib/db.ts`, `lib/s3.ts`, `lib/redis.ts`, `lib/rate-limit.ts`, `lib/ml-client.ts`
  rewritten for the new bindings.

## 7. Secrets & Bindings

Set via `wrangler secret put` (web + consumer as needed): `NEXTAUTH_SECRET`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
`STRIPE_PRICE_YEARLY`, `MAPBOX_ACCESS_TOKEN`, optional `GOOGLE_CLIENT_ID/SECRET`.
Container env: R2 S3 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_ENDPOINT`, `R2_BUCKET`) + `MAPBOX_ACCESS_TOKEN`.
Bindings (not secrets): D1 `DB`, R2 `BUCKET`, Queue producer/consumer, Container, DOs.

## 8. Testing

- ML pure-math tests (`test_geo.py`, `test_plane_fitter.py`, `test_measurer.py`) retained;
  run in container CI.
- Web tests migrated to `@cloudflare/vitest-pool-workers` with local D1/Miniflare.
- New end-to-end smoke: enqueue → consumer → **stubbed** container → assert D1 rows +
  report `completed`.
- `wrangler dev` for local iteration; local D1 + local R2 + local Queues.

## 9. Risks (accepted, fix-forward)

1. **Next.js 16.2 on OpenNext** may need adapter patches/config; we fix forward (no Next 15).
2. **Cloudflare Containers (beta)**: cold starts, memory tiers, regional availability.
   Mitigation = §3 slimming; if still over the largest instance we slim/split further.
3. **PDAL/GDAL in the Container image**: large base image; egress to USGS EPT + Planetary
   Computer STAC required (Containers allow egress).
4. **D1 limits** (10 GB/db, query size): ample for current scale.

## 10. Implementation Phasing (one plan)

0. **Provision & skeleton** — wrangler config, create D1/R2/Queue, secrets, deploy a hello
   Worker to `*.workers.dev`.
1. **Data layer** — Prisma → D1 (provider, adapter, regenerated migrations, type mapping).
2. **Web Worker** — OpenNext build/deploy; auth, API routes, R2 download routes,
   client-poll status; rate-limit DO + quota DO; rewrite `lib/*`.
3. **Job system** — Queue producer in `POST /api/reports`; consumer Worker; container
   invocation contract (stubbed container first).
4. **ML Container** — slim image, `POST /process`, R2 writes, results contract; container
   binding; replace Celery/db.py/MinIO.
5. **Integration & deploy** — Stripe webhook, end-to-end on `*.workers.dev`, smoke test,
   cut over.

Out of scope: cross-user imagery cache, stale-job recovery cron, 90-day cleanup,
custom domain, email/forgot-password (Resend). These follow as separate iterations.
