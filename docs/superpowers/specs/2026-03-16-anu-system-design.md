# Anu System Design

**Date:** 2026-03-16
**Status:** Draft
**Author:** Design session

## Overview

Anu is a freemium web platform for roofing contractors that uses public aerial imagery and LiDAR data to generate automated roof measurement reports. It competes with EagleView by offering a lower-cost alternative built on freely available government data sources.

### Key Decisions

- **Data sources:** NAIP aerial imagery (visual context + roof footprint detection) combined with USGS 3DEP LiDAR (roof geometry, facets, pitch). Mapbox Satellite as imagery fallback.
- **Measurement approach:** U-Net CV model detects roof footprints from NAIP imagery. LiDAR point cloud plane-fitting extracts 3D roof geometry (facets, pitch, edges). This dual-source approach is more accurate and technically sound than attempting facet segmentation from imagery alone.
- **Target user:** Roofing contractors
- **Business model:** Freemium — free tier gets 5 reports/month, premium ($49/mo or $399/yr) gets unlimited
- **Integrations:** None at launch, standalone web app
- **Team:** Solo developer

### Report Tiers

Reports are generated at two quality levels depending on data availability:

- **Full report** (3DEP LiDAR available — ~99% of US): Total roof area, individual facet breakdown, pitch per facet, edge lengths by type, waste factor, confidence scores. This is the primary product.
- **Basic report** (no LiDAR — ~1% of US): Total roof footprint area with one facet per detected structure (2D footprint, no pitch, no edge breakdown). User can manually input pitch values per facet to convert footprint area to surface area and get waste factor estimates. Report is clearly marked as "basic."

### Accuracy Expectations

Based on published research on similar resolution data:

- **Roof footprint area (from NAIP + U-Net):** ~85-92% IoU. At 60cm/pixel, a typical 2000 sq ft roof occupies ~500 pixels — sufficient for binary roof-vs-background segmentation, but NOT for individual facet detection from imagery alone.
- **Facet geometry (from LiDAR plane fitting):** ~90-95% accuracy. 3DEP data at 2+ points/m² with ±10cm vertical accuracy enables reliable plane segmentation via RANSAC.
- **Pitch (from LiDAR):** ~90-95% accuracy for measured facets.
- **Edge lengths (from LiDAR plane intersections):** ~88-93% accuracy.

These are honest estimates. The product is positioned as "accurate enough for bidding and initial material estimates" — not a replacement for on-site verification for complex jobs.

### Why Not Image-Only Facet Segmentation?

NAIP at 60cm/pixel is too coarse for reliable individual facet segmentation. Published research shows:
- Google's Satellite Sunroof achieved only ~56% IoU at 25cm resolution for roof segmentation
- Reliable facet boundary detection needs ≤30cm resolution
- The AIRS dataset (often cited) is at 7.5cm — 8x higher resolution than NAIP, making it unsuitable for transfer learning to NAIP without severe domain gap

LiDAR-based plane fitting is fundamentally more reliable for 3D roof structure because it directly measures elevation, rather than inferring it from 2D pixels.

---

## 1. System Architecture

Three containers (web, ML API, ML worker), shared Postgres, Redis, and object storage:

```
User (Browser)
    |
    v
+---------------------------+
|  Caddy (reverse proxy)    |
|  - HTTPS termination      |
|  - anu.com -> web  |
+------------+--------------+
             |
             v
+---------------------------+
|  Next.js App (Web + API)  |
|  - Auth (NextAuth)        |
|  - Dashboard UI           |
|  - Report viewer          |
|  - Stripe billing         |
|  - REST API routes        |
+------------+--------------+
             | HTTP POST (internal Docker network)
             v
+-------------------------------+
|  ML Service (FastAPI)         |
|  - REST endpoint for jobs     |
|  - Returns 202 Accepted       |
+-------------------------------+
             | dispatches Celery task
             v
+-------------------------------+
|  ML Worker (Celery)           |
|  - NAIP image fetcher         |
|  - U-Net roof segmentation    |
|  - LiDAR point cloud fetch    |
|  - RANSAC plane fitting       |
|  - Measurement extraction     |
|  - PDF report generation      |
+------------+------------------+
             | write results
             v
+-------------------------------+     +-------------------------------+
|  PostgreSQL (source of truth) |     |  Redis                        |
|  - Users, subscriptions       |     |  - Celery task broker         |
|  - Properties, reports        |     |  - Rate limiting              |
|  - All job state tracking     |     |  - Session caching            |
+-------------------------------+     +-------------------------------+
+-------------------------------+
|  S3-Compatible Storage (MinIO)|
|  - Aerial imagery tiles       |
|  - LiDAR point cloud caches   |
|  - Generated report PDFs      |
|  - Processed roof overlays    |
|  - ML model weights           |
+-------------------------------+
```

### Inter-Service Communication

Next.js communicates with the ML service via HTTP over Docker's internal network (not publicly exposed). The ML service is NOT accessible from the internet.

1. Next.js `POST /api/reports` validates auth, checks rate limits (Redis), checks monthly report quota (Postgres COUNT query with advisory lock)
2. Next.js finds or creates a `property` row for this user (reuse existing if same user has a property within 50m, otherwise create new), then creates a `report` row (status: `queued`, tier: null, model_version: null) in Postgres
3. Next.js calls `POST http://ml-service:8000/jobs` with `{report_id, property_id, lat, lon}` (internal only). Address geocoding already happened in Next.js — the ML service receives coordinates, not addresses.
4. FastAPI endpoint receives the request, dispatches a Celery task, returns `202 Accepted`
5. If the ML service is unreachable (down/timeout), Next.js marks the report as `failed` with error "Processing service unavailable, please try again" and returns 503 to the user
6. Celery worker picks up the task from Redis, runs the pipeline
7. Worker updates the `report` row in Postgres directly at each state transition (queued -> processing -> completed/failed), including setting `tier` and `model_version` once known
8. Next.js frontend receives status updates via SSE (Server-Sent Events) on `GET /api/reports/[id]/status`. The SSE endpoint polls Postgres every 2 seconds for status changes, sends updates to the client, and closes the connection on terminal states (completed/failed) or after a 5-minute timeout. The route uses `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, and returns a `ReadableStream`.

**Postgres is the single source of truth for job state.** Redis/Celery is used purely for task dispatch. If Redis is lost, a recovery cron re-queues reports stuck in `queued` or `processing` status for >10 minutes.

### Report Generation Flow

1. User enters a property address
2. Next.js geocodes via Mapbox Search API, validates the address is in the US, finds/creates property row for this user, creates a report row (status: `queued`, tier: null)
3. Next.js calls ML service internally via HTTP to dispatch the job
4. ML worker fetches NAIP imagery tile from USGS STAC API (Mapbox Satellite as fallback)
5. U-Net segments roof footprint from imagery (binary: roof vs. background)
6. ML worker fetches 3DEP LiDAR point cloud for the roof footprint area
7. If LiDAR available: RANSAC plane fitting extracts roof facets, pitch, and edge geometry
8. If no LiDAR: report is generated as "basic" tier (footprint area only)
9. Measurement calculator computes areas, edge lengths, waste factor
10. Results written to Postgres, overlay images + PDF to MinIO
11. User sees report appear on their dashboard via SSE

### Deployment Target

- Single DigitalOcean Droplet (Premium AMD, 8 vCPU, 16GB RAM, 320GB NVMe, ~$96/mo) running all containers via Docker Compose
- Managed Postgres (DO Managed Database, $15/mo — avoids Supabase free tier pausing issues)
- MinIO for S3-compatible local storage

Rationale for 16GB RAM: The ML worker needs ~4GB baseline (U-Net model ~1.5GB + Open3D ~500MB + inference buffers + LiDAR processing), the ML API needs ~512MB, Next.js needs ~512MB, Redis ~100MB, MinIO ~200MB, Caddy ~50MB, OS ~500MB. Total baseline ~6GB, leaving ~10GB headroom for spikes, ReportLab PDF generation, concurrent image processing buffers, and OS file caching. The 40m x 40m property bounding box cap also serves as a memory safety mechanism — larger extents would increase LiDAR point cloud size and processing memory. The ml-worker 6GB Docker limit should be monitored in production.

---

## 2. Data Pipeline — Imagery & LiDAR Acquisition

### Data Sources (prioritized)

1. **NAIP (National Agriculture Imagery Program)** — 60cm/pixel (some areas 30cm), updated every 2-3 years, covers all US. Free via USGS STAC API (Microsoft Planetary Computer). Used for: visual context and binary roof footprint detection.
2. **USGS 3DEP LiDAR** — 2+ points/m², ±10cm vertical accuracy, ~99% US coverage. Free via USGS 3DEP web services. Used for: 3D roof geometry extraction (facets, pitch, edges). This is the primary measurement source.
3. **Mapbox Satellite** — commercial satellite imagery, ~50cm resolution. Fallback for areas with stale or missing NAIP data. Mapbox TOS permits commercial use through their APIs. Cost: 50,000 free Static Images API requests/month, then usage-based pricing per Mapbox's current rate card.

**Removed from consideration:** Google Maps Static API — their TOS explicitly prohibits tracing building outlines, creating 3D models from imagery, and using content to train ML models. Not viable for this product.

### NAIP Limitations (acknowledged)

- Updated on a 2-3 year cycle per state. Recently built/remodeled roofs may show old imagery. The report should display the imagery capture date so contractors can assess freshness. The STAC metadata `datetime` field provides the capture date (sometimes as a range via `start_datetime`/`end_datetime`). The ML worker normalizes this to a single date (using `start_datetime` when a range is provided) and stores it in `properties.imagery_capture_date`.
- 60cm/pixel is sufficient for binary roof segmentation (~500+ pixels per typical residential roof) but insufficient for individual facet boundary detection from imagery alone. This is why we use LiDAR for facet geometry.

### Pipeline Steps

```
Lat/Lon (from Next.js geocoding)
    |
    v
Property Extent Calculator
    | determines bounding box for imagery fetch
    | residential default: 40m x 40m centered on geocoded point
    | adjustable if parcel boundary available from county GIS
    v
NAIP Tile Fetcher
    | fetches Cloud-Optimized GeoTIFF tiles via STAC API
    | fallback: Mapbox Satellite static image
    v
Image Stitcher
    | composites tiles into single property image
    | normalizes to 1024x1024 RGB at known GSD
    v
U-Net Roof Segmentation
    | binary segmentation: roof (1) vs background (0)
    | outputs: roof footprint polygon(s)
    | if multiple buildings detected: keep all, label by area (primary, secondary)
    v
3DEP LiDAR Fetcher
    | fetches point cloud for the full property bbox (40m x 40m)
    | via USGS 3DEP EPT (Entwine Point Tile) on AWS S3
    | then clips to roof footprint polygon(s) for per-building processing
    | accessed using PDAL (python-pdal) for octree traversal + spatial filtering
    | if unavailable: report marked as "basic" tier
    v
IF LiDAR available:
    RANSAC Plane Fitting
        | segments point cloud into planar regions (roof facets)
        | each plane: normal vector -> slope/pitch, area, orientation
        v
    Edge Extraction
        | plane intersections -> edge lines
        | classify by geometric relationship between adjacent planes:
        |   ridge: two planes slope away (inverted V)
        |   valley: two planes slope toward (V shape)
        |   hip: plane meets two others at ridge terminus
        |   eave: bottom plane edge at roof perimeter
        |   rake: sloped perimeter edge at gable end
        v
    Measurement Calculator
        | total roof area (3D surface area in sq ft + roofing squares)
        | per-facet: area, pitch (rise/run + degrees), orientation
        | per-edge: type, length in feet
        | waste factor (see formula below)
        v
ELSE (no LiDAR):
    Basic Measurement
        | one facet per detected roof polygon (2D footprint area, in sq ft)
        | no pitch, no edge data (user can input pitch manually)
        | marked as "basic" tier
        v
Report Generator
    | assembles structured data
    | generates overlay image (facets colored on aerial photo)
    | generates PDF report via ReportLab
    v
Results -> Postgres + PDF/overlay -> MinIO
```

### Multi-Building Properties

When the U-Net detects multiple distinct roof polygons (e.g., house + detached garage):
- All structures are included in the report
- Each structure is labeled by area rank: "Primary structure", "Secondary structure", etc.
- Measurements are provided per-structure and as a total
- The report viewer allows selecting/deselecting structures from the total

### Waste Factor Formula

Waste factor accounts for material lost to cuts and overlaps on complex roofs. Industry-standard approach:

```
Base waste: 10% (minimum for any roof)
+ 2% per valley
+ 1% per hip
+ 3% if any facet has pitch > 8/12
+ 2% if facet count > 6
= Total waste factor (capped at 25%)

Example: 4-facet hip roof with 6/12 pitch, 4 hips, 0 valleys
= 10% + 0% + 4% + 0% + 0% = 14% waste
```

This formula is configurable — power users may override it in their account settings in a future release.

### Error Handling

- Each pipeline step can fail independently. Orchestrator catches per-step errors and records partial results where possible.
- NAIP fetch fails -> try Mapbox fallback -> if both fail, report marked `failed` ("Imagery unavailable for this location")
- U-Net confidence below threshold (IoU < 0.5 on internal metrics) -> report marked `completed` with low `confidence_score` and warning banner
- LiDAR unavailable -> report generated as "basic" tier (not a failure)
- LiDAR plane fitting finds < 2 planes -> report completed but flagged: "Unable to determine roof facets from elevation data"
- Failed tasks retry up to 3 times with exponential backoff (10s, 60s, 300s)
- Recovery cron: every 5 minutes, re-queue reports stuck in `queued` or `processing` for >10 minutes

---

## 3. Data Model

### Core Entities

**users**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| email | string, unique | |
| name | string | |
| company_name | string, nullable | |
| password_hash | string | |
| plan | enum: free, premium | |
| stripe_customer_id | string, nullable | |
| stripe_subscription_id | string, nullable | needed for subscription management |
| monthly_report_limit | int | default 5 for free, null for premium (unlimited) |
| created_at | timestamp | |
| updated_at | timestamp | |

**properties**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| user_id | FK -> users | |
| address_raw | string | as entered by user |
| address_normalized | string | from Mapbox geocoding |
| lat | decimal | |
| lon | decimal | |
| parcel_boundary | jsonb, nullable | GeoJSON polygon |
| imagery_source | enum: naip, mapbox, nullable | null until ML worker fetches/caches imagery |
| imagery_capture_date | date, nullable | when the source imagery was captured |
| imagery_path | string, nullable | MinIO path to cached imagery tile |
| lidar_available | boolean, nullable | null = unknown (not yet checked), true/false = ML worker checked |
| created_at | timestamp | |
| updated_at | timestamp | |

**reports**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| property_id | FK -> properties | |
| user_id | FK -> users | |
| status | enum: queued, processing, completed, failed | |
| tier | enum: full, basic, nullable | null when queued; set by ML worker once LiDAR availability is known |
| model_version | string, nullable | null when queued; set by ML worker when processing begins |
| roof_area_sqft | decimal, nullable | total 3D surface area (full) or 2D footprint (basic) |
| roof_area_squares | decimal, nullable | roof_area_sqft / 100 |
| num_facets | int, nullable | total across all structures |
| num_structures | int, nullable | count of detected buildings |
| waste_factor | decimal, nullable | null for basic tier without user pitch input |
| confidence_score | decimal, nullable | 0.0-1.0, overall measurement confidence |
| pdf_url | string, nullable | MinIO path |
| overlay_url | string, nullable | MinIO path |
| retry_count | int | default 0, max 3 before permanent failure |
| error_message | string, nullable | |
| processing_started_at | timestamp, nullable | |
| processing_completed_at | timestamp, nullable | |
| created_at | timestamp | |
| updated_at | timestamp | |

**report_facets**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| report_id | FK -> reports | |
| structure_index | int | which building (0 = primary) |
| facet_index | int | within the structure |
| footprint_area_sqft | decimal | 2D horizontal footprint area, never changes after creation |
| area_sqft | decimal | derived: footprint_area_sqft / cos(pitch_angle) when pitch known, else = footprint_area_sqft |
| pitch | string, nullable | e.g. "6/12", null if basic tier |
| pitch_degrees | decimal, nullable | null if basic tier |
| pitch_confidence | enum: measured, user_provided, nullable | null if no pitch data |
| orientation | string, nullable | compass direction facet faces (N, NE, E, etc.) |
| polygon | jsonb | GeoJSON polygon (facet outline in lat/lon) |
| created_at | timestamp | |
| updated_at | timestamp | | updated on manual pitch input |

**report_edges**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| report_id | FK -> reports | |
| edge_type | enum: ridge, hip, valley, rake, eave, flashing | |
| length_ft | decimal | |
| geometry | jsonb | GeoJSON linestring |
| left_facet_id | uuid, FK -> report_facets, nullable, ON DELETE SET NULL | |
| right_facet_id | uuid, FK -> report_facets, nullable, ON DELETE SET NULL | eaves/rakes have only one adjacent facet |

### Key Design Decisions

- **No `edge_types` jsonb on `report_facets`** — edge data lives exclusively in `report_edges` to avoid dual-source inconsistency. The report viewer joins edges to facets via `left_facet_id`/`right_facet_id` foreign keys (enforced referential integrity, unlike the previous `uuid[]` array approach).
- **`model_version` on reports** — tracks which model produced which reports. Enables re-running old reports when the model improves.
- **`confidence_score`** — transparency about measurement quality builds contractor trust.
- **No denormalized report count** — monthly usage enforced by: `SELECT COUNT(*) FROM reports WHERE user_id = $1 AND created_at >= date_trunc('month', now()) AND status != 'failed'`. Uses `pg_advisory_xact_lock(hashtext(user_id::text))` to prevent race conditions on concurrent submissions (hashtext converts uuid to int for the lock function).
- **Postgres is the source of truth for job state** — `reports.status` tracks job progress. Celery/Redis is used only for task dispatch. No separate jobs table.
- **Imagery caching (cross-user, ML worker)** — the ML worker (not Next.js) checks for cached imagery before fetching. It queries ALL properties (regardless of owner) within 50m for an existing `imagery_path`: `SELECT imagery_path, imagery_source, imagery_capture_date FROM properties WHERE imagery_path IS NOT NULL AND lat BETWEEN $1-0.00045 AND $1+0.00045 AND lon BETWEEN $2-0.00045 AND $2+0.00045 LIMIT 1`. If found, the tile is reused and the current property's imagery fields are populated from the cache. Only raw aerial imagery is shared — measurements and reports remain per-user.
- **Geometry as GeoJSON in jsonb** — facet polygons and edge linestrings stored as GeoJSON. Simpler Prisma integration, no PostGIS extension needed at launch. Can migrate to PostGIS geometry columns later if spatial queries are needed.
- **`structure_index` on facets** — supports multi-building properties. Facets belonging to the same structure share a `structure_index`.

### Key Indexes

- `users(email)` UNIQUE — login lookup
- `properties(user_id)` — dashboard listing
- `properties(lat, lon)` — deduplication via bounding box range query: `WHERE lat BETWEEN $1-0.00045 AND $1+0.00045 AND lon BETWEEN $2-0.00045 AND $2+0.00045` (~50m at mid-US latitudes, approximate)
- `reports(user_id, created_at)` — monthly count enforcement
- `reports(status)` — queue monitoring, stale job recovery
- `reports(user_id, status)` — dashboard filtered views
- `report_facets(report_id)` — report viewer
- `report_edges(report_id)` — report viewer

---

## 4. ML Service Design

### Service Structure

```
ml-service/
├── app/
│   ├── main.py              # FastAPI app + health + POST /jobs endpoint
│   ├── tasks.py             # Celery task definitions (sync, not async)
│   ├── config.py            # env vars, model paths, API keys
│   ├── db.py                # Postgres connection (psycopg2/SQLAlchemy)
│   ├── pipeline/
│   │   ├── orchestrator.py  # runs the full pipeline for a job (sync)
│   │   ├── fetcher.py       # pulls NAIP/Mapbox imagery tiles
│   │   ├── stitcher.py      # composites tiles into property image
│   │   ├── segmenter.py     # runs U-Net inference for roof footprint
│   │   ├── lidar.py         # fetches + processes 3DEP LiDAR point cloud
│   │   ├── plane_fitter.py  # RANSAC plane segmentation on LiDAR data
│   │   ├── edge_extractor.py # plane intersections -> classified edges
│   │   ├── measurer.py      # areas, lengths, waste factor calculation
│   │   └── reporter.py      # assembles data + generates PDF (ReportLab)
│   ├── models/
│   │   └── unet.py          # model architecture definition
│   ├── imagery/
│   │   ├── naip.py          # STAC API client for NAIP COGs
│   │   ├── mapbox.py        # Mapbox Satellite static imagery fallback
│   │   └── elevation.py     # USGS 3DEP EPT service client
│   └── utils/
│       ├── geo.py           # coordinate transforms, GSD calculations
│       └── storage.py       # MinIO upload/download helper
├── training/
│   ├── dataset.py           # data loading, augmentation
│   ├── train.py             # training loop
│   ├── evaluate.py          # metrics: IoU, boundary F1
│   └── data/                # training data (gitignored)
├── Dockerfile
└── requirements.txt
```

### Key differences from earlier design:
- **No `geocoder.py`** — geocoding happens in Next.js via Mapbox Search API. The ML service receives lat/lon coordinates.
- **No `google.py`** — Google Maps TOS prohibits this use case. Replaced with `mapbox.py`.
- **Added `db.py`** — ML worker writes directly to Postgres (via psycopg2 or SQLAlchemy, not Prisma).
- **Added `lidar.py` and `plane_fitter.py`** — LiDAR is now the primary geometry source.
- **No `pitch.py`** — pitch comes directly from LiDAR plane normals, computed in `plane_fitter.py`.
- **PDF via ReportLab** (not WeasyPrint) — lighter memory footprint, no system-level dependencies (wkhtmltopdf, pango, etc.), pure Python.

### Pipeline Orchestrator Flow

```python
# NOTE: Synchronous — Celery does not natively support asyncio.
# All I/O uses requests (HTTP) and psycopg2 (Postgres), not async libraries.

def process_report(report_id: str, property_id: str, lat: float, lon: float):
    db.update_report_status(report_id, "processing")

    try:
        # 1. Calculate property extent (40m x 40m default)
        bbox = geo.property_bbox(lat, lon, size_m=40)

        # 2. Fetch aerial imagery (check cross-user cache first)
        cached = db.find_cached_imagery(lat, lon, radius_m=50)
        if cached:
            image, img_metadata = storage.download_imagery(cached.imagery_path)
            # Set imagery fields on THIS property (reusing cached tile)
            db.update_property_imagery(property_id,
                imagery_path=cached.imagery_path,
                imagery_source=cached.imagery_source,
                imagery_capture_date=cached.imagery_capture_date)
        else:
            image, img_metadata = fetcher.fetch(lat, lon, bbox)
            # img_metadata: source (naip/mapbox), GSD, capture_date
            # Store by location hash (not report_id) for cross-user reuse
            imagery_key = f"imagery/{geo.location_hash(lat, lon)}.tif"
            storage.upload(imagery_key, image)
            db.update_property_imagery(property_id,
                imagery_path=imagery_key,
                imagery_source=img_metadata.source,
                imagery_capture_date=img_metadata.capture_date)

        # 3. Segment roof footprint
        roof_polygons = segmenter.predict(image)
        # returns: list of polygons (one per detected building)
        # uses connected components on binary U-Net output

        if not roof_polygons:
            db.update_report(report_id, status="completed",
                             confidence_score=0.0,
                             error_message="No roof detected at this location")
            return

        # 4. Fetch LiDAR data
        lidar_points = lidar.fetch(bbox)
        lidar_available = lidar_points is not None and len(lidar_points) > 100

        if lidar_available:
            # 5. Full report: plane fitting per structure
            all_facets = []
            all_edges = []
            for i, polygon in enumerate(roof_polygons):
                points_in_roof = lidar.clip_to_polygon(lidar_points, polygon)
                planes = plane_fitter.fit(points_in_roof)
                facets = plane_fitter.planes_to_facets(planes, polygon)
                edges = edge_extractor.extract(planes, facets)
                all_facets.extend([(i, f) for f in facets])
                all_edges.extend(edges)

            measurements = measurer.calculate_full(
                roof_polygons, all_facets, all_edges,
                gsd=img_metadata.gsd
            )
            report_data = reporter.assemble(
                measurements, roof_polygons, all_facets, all_edges,
                tier="full", img_metadata=img_metadata
            )
        else:
            # 6. Basic report: footprint area only
            # Create one facet per roof polygon (with 2D footprint area, no pitch)
            # so users can manually input pitch later via the report viewer
            basic_facets = []
            for i, polygon in enumerate(roof_polygons):
                footprint = geo.polygon_area_sqft(polygon, img_metadata.gsd)
                basic_facets.append((i, {
                    "footprint_area_sqft": footprint,
                    "area_sqft": footprint,  # equals footprint until pitch is provided
                    "pitch": None,
                    "pitch_degrees": None,
                    "pitch_confidence": None,
                    "orientation": None,
                    "polygon": polygon
                }))

            measurements = measurer.calculate_basic(
                roof_polygons, basic_facets, gsd=img_metadata.gsd
            )
            report_data = reporter.assemble(
                measurements, roof_polygons, basic_facets, [],
                tier="basic", img_metadata=img_metadata
            )

        # 7. Generate PDF and overlay
        facets_for_overlay = all_facets if lidar_available else basic_facets
        pdf_bytes = reporter.to_pdf(report_data, image)
        overlay_bytes = reporter.to_overlay(image, roof_polygons, facets_for_overlay)

        # 8. Persist
        pdf_url = storage.upload_pdf(report_id, pdf_bytes)
        overlay_url = storage.upload_overlay(report_id, overlay_bytes)
        db.save_report(report_id, report_data, pdf_url, overlay_url)

    except Exception as e:
        db.update_report(report_id, status="failed",
                         error_message=str(e))
        raise  # let Celery handle retry logic
```

### Model Details

**U-Net (Roof Footprint Segmentation)**

- **Architecture:** U-Net with ResNet34 encoder (pretrained on ImageNet), via `segmentation-models-pytorch`
- **Input:** 1024x1024 RGB image tile
- **Output:** Binary mask — background (0) vs roof (1)
- **Post-processing:** Connected components analysis on the binary mask to extract individual roof polygons. Polygons smaller than 20m² are filtered out (noise). This handles multi-building properties.
- **Training data:**
  - Inria Aerial Image Labeling Dataset — 30cm resolution, binary building footprints, covers Austin, Chicago, Vienna, and others. Closest resolution match to NAIP.
  - SpaceNet Building Detection — various resolutions, large-scale.
  - Manual labeling of 200-500 NAIP tiles for fine-tuning (the most important step).
  - Note: AIRS dataset (7.5cm resolution) is NOT used — the 8x resolution gap to NAIP creates a severe domain mismatch.
- **Inference time:** ~30-60 seconds on CPU (4 vCPU), <5 seconds on GPU. Start with CPU.
- **Model weights:** Stored in MinIO, downloaded to worker on startup (not baked into Docker image to keep image size manageable). Versioned by filename: `unet_v1.0.pt`, `unet_v1.1.pt`, etc.

**Docker image note:** The ml-service Dockerfile requires PDAL (C++ library with Python bindings) for LiDAR point cloud processing. PDAL has significant system dependencies (liblas, libgeotiff, PROJ, GDAL). Use the `pdal/pdal` or `osgeo/gdal` base image to avoid manual dependency management. This makes the ML Docker image large (~2-3GB) but avoids build headaches. Example:
```dockerfile
FROM pdal/pdal:2.6 as base
# PDAL, GDAL, PROJ already installed
RUN pip install segmentation-models-pytorch open3d reportlab ...
```

**RANSAC Plane Fitting (Roof Geometry Extraction)**

- **Libraries:** PDAL (python-pdal) for LiDAR point cloud access/filtering, Open3D for RANSAC plane fitting
- **Input:** 3DEP LiDAR point cloud clipped to roof footprint polygon
- **Process:**
  1. Remove ground points (elevation < roof boundary median)
  2. Iterative RANSAC: fit planes, extract inliers, repeat
  3. Each plane → a roof facet with: normal vector (→ pitch), area, boundary polygon
  4. Merge planes with similar normals and adjacent positions (avoids over-segmentation)
- **Output:** List of planar facets with pitch, area, and boundary polygons in geographic coordinates
- **Edge extraction:** Intersection lines between adjacent planes, classified by the angle between their normal vectors

### Concurrency

ML inference is limited to **1 concurrent report** to stay within RAM budget. Celery worker is configured with `--concurrency=1`. Additional jobs queue in Redis and process sequentially.

Throughput estimate: ~60-90 seconds per report on CPU (imagery fetch + U-Net + LiDAR fetch + plane fitting + PDF). At 1 report/minute, the system processes ~1400 reports/day — well beyond early-stage needs.

### Priority Processing (Premium Feature)

Celery is configured with two queues:
- `high` — premium user reports
- `default` — free tier reports

The worker processes `high` queue first: `celery -A app.tasks worker --concurrency=1 -Q high,default`

Premium reports skip ahead of free-tier reports in the queue but don't interrupt in-progress work.

### Celery Configuration

```python
# app/celeryconfig.py
broker_url = "redis://redis:6379/0"
result_backend = None  # results written directly to Postgres, not Celery result store
task_acks_late = True  # tasks acked after completion, not on receipt (survives worker crash)
task_reject_on_worker_lost = True  # re-queue if worker dies mid-task
worker_prefetch_multiplier = 1  # fetch one task at a time (matches concurrency=1)
```

---

## 5. Web Application — UI, Auth & Billing

### Next.js App Structure

```
web/
├── app/
│   ├── layout.tsx                 # root layout, nav, providers
│   ├── page.tsx                   # landing/marketing page
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── forgot-password/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx             # sidebar, plan badge, report count
│   │   ├── page.tsx               # dashboard home — recent reports, quick search
│   │   ├── reports/
│   │   │   ├── page.tsx           # report list
│   │   │   └── [id]/page.tsx      # single report viewer
│   │   ├── new/page.tsx           # new report — address input + confirmation
│   │   └── settings/
│   │       ├── page.tsx           # profile settings
│   │       └── billing/page.tsx   # plan management, usage, invoices
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── reports/
│       │   ├── route.ts           # POST: create, GET: list
│       │   └── [id]/
│       │       ├── route.ts       # GET: detail
│       │       ├── pdf/route.ts   # GET: stream PDF from MinIO (authenticated)
│       │       ├── overlay/route.ts # GET: stream overlay image from MinIO
│       │       ├── imagery/route.ts # GET: stream aerial imagery from MinIO
│       │       ├── status/route.ts # GET: SSE stream for processing status
│       │       └── facets/
│       │           └── [facetId]/
│       │               └── pitch/route.ts # PATCH: manual pitch input
│       ├── properties/
│       │   └── geocode/route.ts   # POST: validate + geocode via Mapbox Search
│       ├── billing/
│       │   ├── checkout/route.ts  # POST: Stripe checkout session
│       │   ├── portal/route.ts    # POST: Stripe billing portal
│       │   └── webhook/route.ts   # POST: Stripe webhook handler
│       └── health/route.ts
├── components/
│   ├── report-viewer/
│   │   ├── RoofOverlay.tsx        # interactive roof diagram on aerial image
│   │   ├── FacetTable.tsx         # tabular facet measurements
│   │   ├── MeasurementSummary.tsx # totals: area, squares, waste
│   │   ├── PitchDiagram.tsx       # visual pitch per facet
│   │   ├── PitchInput.tsx         # manual pitch input for basic-tier reports
│   │   ├── StructureSelector.tsx  # toggle buildings on multi-structure properties
│   │   └── ConfidenceBadge.tsx    # measurement confidence level + tier indicator
│   ├── AddressInput.tsx           # Mapbox Search autocomplete
│   ├── ReportCard.tsx             # report preview card
│   ├── PlanBadge.tsx              # free/premium indicator
│   └── UsageBar.tsx               # X of Y reports used this month
├── lib/
│   ├── db.ts                      # Prisma client
│   ├── ml-client.ts               # HTTP client for ML service (internal)
│   ├── redis.ts                   # Redis client (rate limiting, caching)
│   ├── rate-limit.ts              # Per-user and per-IP rate limiting via Redis
│   ├── stripe.ts                  # Stripe client + helpers
│   ├── auth.ts                    # NextAuth config
│   └── s3.ts                      # MinIO client (file streaming for downloads)
├── scripts/
│   ├── recover-stale-jobs.js      # cron: re-queue stuck reports
│   └── cleanup-free-reports.js    # cron: delete >90 day old free tier reports + MinIO objects
└── prisma/
    └── schema.prisma
```

### Authentication

- NextAuth.js with email/password (credentials provider) + optional Google OAuth
- JWT session strategy (stateless)
- Middleware protects `/dashboard/*` routes
- Login endpoint has its own rate limit: 5 attempts per IP per 15 minutes (prevents brute force)
- Password reset via Resend transactional email

### Address Input

- **Autocomplete:** Mapbox Search Box API (session-based billing — each user search session counts as 1 request regardless of keystrokes). ~1,000 free sessions/month, then $1.00 per 1000 sessions. US addresses only.
- **Server-side geocoding:** Mapbox Geocoding API v6 for address validation after selection. 100,000 free requests/month.
- On selection: geocodes to lat/lon, validates it's a US residential address
- Not Google Places — Google Maps TOS prohibits the downstream use case

### Billing (Stripe)

| | Free Tier | Premium Tier |
|---|-----------|-------------|
| Reports | 5/month | Unlimited |
| Measurements | Full (where LiDAR available) | Full (where LiDAR available) |
| PDF download | Yes | Yes |
| Priority processing | No | Yes (high-priority queue) |
| Report history | Last 90 days | Unlimited |
| Price | $0 | $49/month or $399/year |

**Billing flow:**

1. User hits report limit -> UI shows upgrade prompt with usage bar
2. Click upgrade -> `POST /api/billing/checkout` creates Stripe Checkout session
3. User completes payment on Stripe-hosted page
4. Stripe webhook `checkout.session.completed` -> update user plan and `stripe_subscription_id` in DB
5. Cancellation/changes via Stripe Billing Portal
6. Webhook handles `customer.subscription.updated/deleted` -> sync plan state

**Security: All incoming webhooks MUST verify the Stripe signature** using `STRIPE_WEBHOOK_SECRET` and `stripe.webhooks.constructEvent()`. Without signature verification, an attacker can POST fake events to grant themselves premium access. The webhook endpoint should return 400 for invalid signatures.

### Report Limit Enforcement

```
On POST /api/reports:
  1. Rate limit check (per-IP: 10 req/min, per-user: 30 req/min) via Redis
  2. Check user.plan
  3. If free:
     a. Acquire advisory lock: pg_advisory_xact_lock(hashtext(user_id::text))
     b. SELECT COUNT(*) FROM reports
        WHERE user_id = $1
        AND created_at >= date_trunc('month', now())
        AND status != 'failed'
     c. If count >= monthly_report_limit -> 403 with upgrade prompt
  4. Create report row (status: queued), call ML service
```

### Free Tier Report Cleanup

A daily cron job (via system cron on the Droplet) handles 90-day expiry for free tier.

Foreign keys on `report_facets` and `report_edges` use `ON DELETE CASCADE` (Prisma `onDelete: Cascade`), so deleting a report row automatically removes its children:

```sql
-- 1. Collect MinIO paths for cleanup
SELECT pdf_url, overlay_url FROM reports r
JOIN users u ON r.user_id = u.id
WHERE u.plan = 'free' AND r.created_at < now() - interval '90 days';

-- 2. Delete reports (cascades to facets + edges)
DELETE FROM reports WHERE id IN (...);

-- 3. Script also deletes MinIO objects for collected paths
```

Any future child table of `reports` must also use `ON DELETE CASCADE` to stay compatible with this cleanup.

### Report Viewer (Core Screen)

The single report page shows:
- **Tier badge:** "Full Report" or "Basic Report" prominently displayed
- **Imagery date:** "Based on imagery from [capture_date]" so contractors can assess freshness
- Aerial image with roof overlay (colored facets for full, simple outline for basic) — interactive, zoomable via MapLibre GL JS
- Summary card: total area (sq ft + squares), facet count, waste factor %, confidence score
- For multi-building properties: structure selector toggle
- Facet table (full tier only): per-facet area, pitch, orientation, edge breakdown
- Edge summary (full tier only): total ridge, hip, valley, rake, eave lengths
- Manual pitch input (basic tier or facets missing pitch): dropdown selector per facet
- PDF download button
- "Report generated with model v[version] on [date]" footer

### Manual Pitch Input Flow

When a user submits pitch via `PATCH /api/reports/[id]/facets/[facetId]/pitch`:
1. Update `pitch`, `pitch_degrees`, `pitch_confidence = 'user_provided'` on the facet row
2. Recalculate `area_sqft` for that facet: `footprint_area_sqft / cos(pitch_angle)` (converts 2D footprint to 3D surface area). The `footprint_area_sqft` column is immutable — it always holds the original 2D value, so pitch can be changed multiple times without accumulating errors.
3. Recalculate parent report's `roof_area_sqft` (sum of all facet areas), `roof_area_squares`, and `waste_factor` (pitch affects waste formula)
4. PDF is NOT regenerated automatically (too expensive for MVP). The report viewer always shows live data from Postgres. Users can re-download PDF via a "Regenerate PDF" button that triggers a lightweight re-render.

### Tech Choices

- **Prisma** ORM (type-safe, good Next.js integration)
- **Tailwind CSS** (fast to build solo)
- **MapLibre GL JS** for interactive roof overlay (open-source, no API key needed for rendering, supports GeoJSON overlays natively)
- **Mapbox Search API** for address autocomplete + geocoding
- **ReportLab** for PDF generation (ML service side — lighter than WeasyPrint)

---

## 6. Deployment & Operations

### Infrastructure

```
DigitalOcean Droplet (Premium AMD, 8 vCPU, 16GB RAM, 320GB NVMe, ~$96/mo)
├── Docker Compose
│   ├── caddy      (reverse proxy, HTTPS, port 80/443)
│   ├── web        (Next.js, port 3000, internal)
│   ├── ml-service (FastAPI, port 8000, internal)
│   ├── ml-worker  (Celery, no port, internal)
│   ├── redis      (port 6379, internal)
│   ├── minio      (port 9000/9001, internal)
│   └── uptime-kuma (port 3001, internal — monitoring)
│
├── External managed services
│   ├── PostgreSQL (DO Managed Database, $15/mo)
│   ├── Stripe     (billing)
│   ├── Mapbox     (geocoding + fallback imagery)
│   ├── Resend     (transactional email)
│   └── Domain + Cloudflare (DNS)
```

### Docker Compose

```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [web]
    restart: unless-stopped

  web:
    build: ./web
    expose: ["3000"]
    env_file: .env
    depends_on: [redis]
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 1G

  ml-service:
    build: ./ml-service
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    expose: ["8000"]  # internal only
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M

  ml-worker:
    build: ./ml-service
    command: celery -A app.tasks worker --concurrency=1 -Q high,default --loglevel=info
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 6G  # model inference + LiDAR processing + PDF generation

  redis:
    image: redis:7-alpine
    volumes: ["redis-data:/data"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 3

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes: ["minio-data:/data"]
    expose: ["9000", "9001"]  # internal only
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 30s
      retries: 3

  uptime-kuma:
    image: louislam/uptime-kuma:1
    volumes: ["kuma-data:/app/data"]
    expose: ["3001"]  # internal; access via SSH tunnel or Caddy basic auth
    restart: unless-stopped

volumes:
  caddy-data:
  caddy-config:
  redis-data:
  minio-data:
  kuma-data:
```

### Caddyfile

```
anu.com {
    # flush_interval -1 disables response buffering (required for SSE streaming)
    reverse_proxy web:3000 {
        flush_interval -1
    }
}
```

### File Download Strategy (MVP)

MinIO is internal-only (no public port). Browser access to stored files (PDFs, overlays, imagery) is proxied through Next.js API routes:

- `GET /api/reports/[id]/pdf` — streams the PDF from MinIO to the browser (sets `Content-Disposition: attachment`)
- `GET /api/reports/[id]/overlay` — streams the overlay image for the report viewer
- `GET /api/reports/[id]/imagery` — streams the aerial imagery tile

The Next.js routes authenticate the user, verify they own the report, fetch the object from MinIO over the internal Docker network, and stream it to the browser. This adds ~10ms latency per download but avoids the complexity of presigned URL configuration (MinIO SDK signing against public hostnames through a reverse proxy path-strip is error-prone for a solo developer).

**Future optimization:** When download traffic becomes significant (>1000 downloads/day), switch to presigned URLs with a Caddy `/storage/*` proxy route or move to Cloudflare R2 (which has a native public URL feature). This is a straightforward migration — change the download endpoints to return a redirect to the signed URL instead of streaming.

**CORS:** Not needed. All requests go through `anu.com` (same origin).

### Environment Variables (.env template)

```
# Database
DATABASE_URL=postgresql://user:pass@db-host:5432/anu

# Redis
REDIS_URL=redis://redis:6379/0

# Auth
NEXTAUTH_SECRET=<random-32-char-string>
NEXTAUTH_URL=https://anu.com

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_YEARLY=price_...

# Mapbox
MAPBOX_ACCESS_TOKEN=pk.ey...

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=<access-key>
MINIO_SECRET_KEY=<secret-key>
MINIO_BUCKET=anu

# Email
RESEND_API_KEY=re_...

# ML Service (used by Next.js)
ML_SERVICE_URL=http://ml-service:8000

# ML Worker
ML_MODEL_VERSION=v1.0               # which model weights to download from MinIO on startup
ML_MODEL_PATH=models/unet_v1.0.pt   # MinIO path to model weights file
```

### CI/CD

- GitHub Actions with two workflows:
  - `web.yml` — lint, type-check, build, push Docker image, SSH deploy
  - `ml.yml` — lint, run pipeline tests on fixture data, push Docker image, SSH deploy
- Deploy = SSH into Droplet, `docker compose pull && docker compose up -d`
- Model weights are uploaded to MinIO separately (not part of CI/CD Docker build)

### Monitoring

- **Uptime:** Uptime Kuma (self-hosted on same Droplet, separate Docker container)
- **Logs:** Docker logs (upgrade to Loki when needed). `docker compose logs -f --tail=100` for live debugging.
- **Key metrics (queryable from Postgres):**
  - Report queue depth: `SELECT COUNT(*) FROM reports WHERE status IN ('queued', 'processing')`
  - Processing time: `AVG(processing_completed_at - processing_started_at)` for recent reports
  - Success/failure rate: `COUNT by status` for recent reports
  - Full vs basic tier ratio
  - Free->premium conversion (Stripe dashboard)
  - MAU: `SELECT COUNT(DISTINCT user_id) FROM reports WHERE created_at >= now() - interval '30 days'`
- **Alerting:** Uptime Kuma -> email/Telegram on service down
- **Stale job recovery:** Cron every 5 minutes checks for reports stuck in `queued`/`processing` >10 min

### Cron Jobs

```crontab
# Stale job recovery (re-queue stuck reports where retry_count < 3)
*/5 * * * * cd /opt/anu && docker compose exec -T web node scripts/recover-stale-jobs.js

# Free tier report cleanup (delete >90 day old reports + MinIO objects)
0 3 * * * cd /opt/anu && docker compose exec -T web node scripts/cleanup-free-reports.js

# Monthly report count reset is NOT needed (uses COUNT query, not cached counter)
```

### Backup Strategy

- **Postgres:** Handled by DO Managed Database (automatic daily backups, 7-day retention). Upgrade to higher backup retention when revenue supports it.
- **MinIO:** Bucket versioning enabled. Weekly sync to Cloudflare R2 as offsite backup via `mc mirror`.
- **Redis:** AOF persistence enabled, but data is ephemeral. Loss means re-queuing a few pending tasks (recovered via stale job cron), not data loss.

### Scaling Path

```
Phase 1 (now): Single Droplet, everything co-located, CPU inference
    | hitting CPU limits on ML inference (>500 reports/day sustained)
Phase 2: Separate ML worker to GPU Droplet or Lambda Labs (~$0.50/hr)
    | hitting 1000+ users, web app needs more resources
Phase 3: Move web to Vercel/Railway, ML to dedicated GPU cloud
    | real scale, need horizontal scaling
Phase 4: Kubernetes or managed containers (ECS/Cloud Run)
```

### Cost Estimate

| Item | Monthly Cost |
|------|-------------|
| DO Droplet (8 vCPU, 16GB) | $96 |
| DO Managed Postgres (Basic) | $15 |
| Domain + Cloudflare (DNS only) | $1 |
| Mapbox Search Box (~1k free sessions/mo) | $0-5 |
| Mapbox Satellite (~50k free static images/mo) | $0 |
| Transactional email (Resend, free tier) | $0 |
| Stripe (2.9% + $0.30 per txn) | Variable |
| **Total fixed** | **~$112-117/month** |

Break-even at 3 premium subscribers ($49/mo each = $147).

Note: Mapbox Search Box has a limited free tier (~1,000 sessions/month). If autocomplete usage exceeds this before revenue covers it, consider switching to server-side-only geocoding (Geocoding API, 100k free/month) with no autocomplete, or debouncing autocomplete aggressively.

Note: The higher infrastructure cost vs. the original $49/mo estimate reflects the reality that 8GB RAM was too tight for reliable ML inference + web serving, and Supabase free tier is unsuitable for production (pauses after 7 days of inactivity). This is the honest cost of running this system.
