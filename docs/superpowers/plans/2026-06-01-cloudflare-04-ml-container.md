# Cloudflare Migration — Plan 4 of 5: ML Container

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans.

**Goal:** Convert the Python ML service from a Celery worker that writes to Postgres/MinIO into a **stateless Cloudflare Container** exposing `POST /process`, which runs the pipeline, uploads artifacts to R2 (S3 API), and **returns** a JSON result matching the Plan 3 `ContainerResult` contract. Wire the `CONTAINER` binding into the web Worker.

**Architecture:** The container holds NO DB creds. `POST /process {report_id, property_id, lat, lon}` → run pipeline → upload pdf/overlay/imagery to R2 → return `{tier, modelVersion, roof*, facets[], edges[], pdfKey, overlayKey, imageryKey, ...}`. The queue-consumer Worker (Plan 3) calls it and writes the result to D1. The web side accesses the container through a Cloudflare Container binding (a Durable-Object-backed `Container` class re-exported from `custom-worker.ts`).

**Tech Stack:** FastAPI, rasterio/GDAL, PDAL (LiDAR), shapely, scipy, reportlab, boto3 (R2 S3), Cloudflare Containers, `@cloudflare/containers`.

**Scope:** Spec §3 (image slimming) + §5 (container contract) + §1 (stateless container). 

**HARD EXTERNAL GATES (require the operator, not implementable/verifiable here):**
- **G1 — Docker build/push:** building the GDAL-based image and pushing it needs a Docker daemon + the CF account; done at deploy (Plan 5).
- **G2 — Live container binding:** a real Cloudflare Container only runs once deployed; local `wrangler dev` container support is limited/beta. The binding CONFIG + worker class are written and type-checked here; live exercise happens in Plan 5.
Everything else (the Python refactor + its pytest suite, the web binding code) is implemented and verified locally.

**Entry state:** `ml-service/` is a FastAPI+Celery app. `orchestrator.process_report()` writes to Postgres via `db.py` and uploads to MinIO via `utils/storage.py`. U-Net/`segmenter.py`/`training/` are dead. Plan 3 left a typed `callContainer(env.CONTAINER, job)` that POSTs to `/process` and validates the response.

---

### Task 1: Slim dependencies + delete dead code

**Files:** `ml-service/requirements.txt`; delete `ml-service/app/db.py`, `ml-service/app/tasks.py`, `ml-service/app/celeryconfig.py`, `ml-service/app/pipeline/segmenter.py`, `ml-service/app/models/` (unet.py), `ml-service/training/`.

- [ ] **Step 1:** Rewrite `ml-service/requirements.txt` to drop `torch`, `torchvision`, `segmentation-models-pytorch`, `celery[redis]`, `psycopg2-binary`, `minio`, and `open3d` (verify open3d isn't imported by surviving pipeline code first: `grep -rn open3d ml-service/app`; the plane fitter uses scipy/numpy RANSAC). ADD `boto3` (for R2 S3). Keep latest pins from the June-2026 upgrade for: fastapi, uvicorn[standard], pydantic, requests, numpy, Pillow, shapely, reportlab, rasterio, pystac-client, scipy. (PDAL comes from the GDAL base image, not pip.)
- [ ] **Step 2:** Delete the dead files (`git rm`): `app/db.py`, `app/tasks.py`, `app/celeryconfig.py`, `app/pipeline/segmenter.py`, `app/models/unet.py` (and `app/models/__init__.py` if now empty), `training/` (the whole dir). First `grep -rn "segmenter\|app.models\|from app.db\|app.tasks\|celery" ml-service/app` to find references to fix (orchestrator imports `segmenter`? it shouldn't since OSM replaced U-Net — confirm and remove any stale import).
- [ ] **Step 3:** Verify the surviving pytest suite still imports + passes: `cd ml-service && pipx run --spec pytest pytest tests/ -q` (or `python3 -m pytest`). The pure-math tests (`test_geo.py`, `test_plane_fitter.py`, `test_measurer.py`) must pass. Fix any import errors from the deletions.
- [ ] **Step 4:** Commit — `git add -A ml-service && git commit -m "feat(ml): slim deps + delete dead U-Net/Celery/db/MinIO code"`

---

### Task 2: R2 storage helper (boto3) replacing MinIO

**Files:** rewrite `ml-service/app/utils/storage.py`; `ml-service/app/config.py` (R2 env)

- [ ] **Step 1:** In `config.py`, add R2 settings from env: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (default "anu"). Remove the MinIO-specific names if unused elsewhere (grep first).
- [ ] **Step 2:** Rewrite `storage.py` to use a boto3 S3 client pointed at R2:
```python
import boto3
from app.config import R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET

_s3 = None

def _client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
    return _s3

def upload_bytes(key: str, data: bytes, content_type: str) -> str:
    _client().put_object(Bucket=R2_BUCKET, Key=key, Body=data, ContentType=content_type)
    return key

def upload_pdf(report_id: str, data: bytes) -> str:
    return upload_bytes(f"reports/{report_id}/report.pdf", data, "application/pdf")

def upload_overlay(report_id: str, data: bytes) -> str:
    return upload_bytes(f"reports/{report_id}/overlay.png", data, "image/png")

def upload_imagery(key: str, data: bytes) -> str:
    return upload_bytes(key, data, "image/png")
```
- [ ] **Step 3:** `grep -rn "storage\." ml-service/app` and update callers (orchestrator) to the new function names. Keep the pytest suite green (`pytest tests/ -q`). Commit — `git commit -am "feat(ml): R2 (boto3) storage helper, replace MinIO"`

---

### Task 3: Orchestrator returns a result; add POST /process

**Files:** `ml-service/app/pipeline/orchestrator.py`; `ml-service/app/main.py`; Test `ml-service/tests/test_result_contract.py`

- [ ] **Step 1:** Refactor `orchestrator.process_report(...)` into `run_pipeline(report_id, property_id, lat, lon) -> dict` that:
  - does NOT touch any database (remove all `db.*` calls — db.py is deleted),
  - runs the existing pipeline (OSM footprint → imagery → LiDAR → planes/facets/edges → measurements → reporter pdf/overlay),
  - uploads pdf/overlay/imagery to R2 via `storage.upload_*` and collects the keys,
  - returns a dict EXACTLY matching the `ContainerResult` contract (camelCase keys): `tier`, `modelVersion`, `roofAreaSqft`, `roofAreaSquares`, `numFacets`, `numStructures`, `wasteFactor`, `confidenceScore`, `pdfKey`, `overlayKey`, `imageryKey`, `facets` (each with `structureIndex`, `facetIndex`, `footprintAreaSqft`, `areaSqft`, `pitch`, `pitchDegrees`, `pitchConfidence`, `orientation`, `polygon`), `edges` (each with `edgeType`, `lengthFt`, `geometry`, `leftFacetIndex`, `rightFacetIndex`).
  - **Edge facet references:** the pipeline currently references facets by id/object; map them to the facet's INDEX within the returned `facets` list (or null). Build an id→index map when assembling.
  - Wrap the body in try/except: on failure, raise an HTTPException (the Worker treats non-2xx as a retryable failure) — do NOT swallow.
- [ ] **Step 2:** In `main.py`: remove Celery/USE_CELERY/threading and the `POST /jobs` endpoint. Add:
```python
@app.post("/process")
def process(req: JobRequest):
    from app.pipeline.orchestrator import run_pipeline
    return run_pipeline(req.report_id, req.property_id, req.lat, req.lon)
```
Keep `GET /health` and the `JobRequest` model (with the lat/lon Field validation already added).
- [ ] **Step 3:** Add `ml-service/tests/test_result_contract.py` that unit-tests the result-assembly mapping WITHOUT external I/O — e.g. test a helper `assemble_result(measurements, facets, edges, keys, tier, model_version)` (extract this pure function from `run_pipeline`) and assert the dict has all contract keys, `numFacets == len(facets)`, and that an edge referencing two facets maps to their correct indices. (Refactor `run_pipeline` so the pure assembly is a separately testable function.)
- [ ] **Step 4:** `cd ml-service && python3 -m pytest tests/ -q` → all pass. Commit — `git commit -am "feat(ml): run_pipeline returns ContainerResult JSON; POST /process (drop Celery/jobs)"`

---

### Task 4: Slim Dockerfile

**Files:** `ml-service/Dockerfile`

- [ ] **Step 1:** Keep the `ghcr.io/osgeo/gdal:ubuntu-small-3.9.3` base (rasterio/PDAL need GDAL). It already installs pip + requirements and runs as non-root `appuser` (from the security pass). Change the `CMD` to serve `/process` (already `uvicorn app.main:app`). Ensure no Celery worker command remains anywhere. Confirm the image builds conceptually (do NOT actually build — Docker may be unavailable; just ensure the Dockerfile references only surviving files: no `training/`, no `models/`). 
- [ ] **Step 2:** Commit — `git commit -am "feat(ml): Dockerfile serves /process only (no Celery)"`

---

### Task 5: Web-side Container binding (config + worker class)

**Files:** `web/package.json` (add `@cloudflare/containers`); create `web/containers/anu-ml.ts`; `web/custom-worker.ts`; `web/wrangler.jsonc`; `web/lib/container-client.ts` (adjust if the binding API differs)

NOTE: This wires the binding so it deploys; the LIVE container only runs after Plan 5 deploy (gate G2). Verify by type-check + `cf:build`, not by live call.

- [ ] **Step 1:** `cd web && npm install @cloudflare/containers`.
- [ ] **Step 2:** Determine the CURRENT Cloudflare Containers API from docs (WebFetch https://developers.cloudflare.com/containers/ and the `@cloudflare/containers` README via context7). The pattern is a `class AnuMLContainer extends Container` (Durable-Object-backed) with `defaultPort`/`sleepAfter`, bound via wrangler `containers` (image = `../ml-service/Dockerfile` or a built image) + a `durable_objects` binding for the container class. Create `web/containers/anu-ml.ts` accordingly.
- [ ] **Step 3:** Re-export the container class from `web/custom-worker.ts` (like the DOs) and ensure `CONTAINER` resolves. Update `web/env.d.ts` `CONTAINER` type to match the binding (a container DO namespace; expose a `.fetch`-capable instance). Adjust `web/lib/container-client.ts` if obtaining the instance differs from `env.CONTAINER.fetch(...)` (e.g. `getContainer(env.CONTAINER).fetch(...)` or `getRandom`). Keep `callContainer`'s external behavior (POST /process → validated `ContainerResult`).
- [ ] **Step 4:** Add the `containers` block + container DO binding + migration to `web/wrangler.jsonc` per the docs (image build context = `../ml-service`, `instance_type`/`max_instances` as docs specify).
- [ ] **Step 5:** Verify: `cd web && npx tsc --noEmit` exit 0; `npm run cf:build` succeeds; `npx vitest run` all pass (the queue-consumer/container-client tests still mock the binding, so they pass without a live container); `npx eslint .` clean. Do NOT attempt a live container call.
- [ ] **Step 6:** Commit — `git add -A web && git commit -m "feat(web): Cloudflare Container binding for the ML pipeline (live run at deploy)"`

---

## Self-Review
**Spec coverage:** image slimming + dead-code deletion (Task 1) ✓; R2 boto3 storage (Task 2) ✓; stateless run_pipeline returning the contract + POST /process (Task 3) ✓; slim Dockerfile (Task 4) ✓; container binding wired for deploy (Task 5) ✓. DB writes fully removed from the container (db.py deleted; Worker is sole writer) ✓.
**Gates:** G1 (Docker build/push) and G2 (live container) are explicitly deferred to Plan 5 deploy — the code/config is complete and type-checked here.
**Handoff to Plan 5:** Plan 5 builds+pushes the image, provisions D1/R2/Queue/DLQ/container, sets secrets (R2 creds for the container; NEXTAUTH/Stripe/Mapbox for the web worker), and deploys; then exercises the live container via a real report.
