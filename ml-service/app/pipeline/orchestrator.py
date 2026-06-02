"""Stateless ML pipeline orchestrator for the Anu ML service.

Uses OpenStreetMap building footprints (via Overpass API) instead of U-Net
segmentation. This gives accurate building outlines from Microsoft Building
Footprints data imported into OSM, with no ML training needed.

The container holds NO database credentials. ``run_pipeline`` runs the full
pipeline, uploads artifacts to R2, and RETURNS a ``ContainerResult`` dict
(camelCase keys) for the calling Worker to persist.
"""
from __future__ import annotations

import io
import logging

import numpy as np
from fastapi import HTTPException
from PIL import Image

from app import config
from app.utils import geo, storage
from app.pipeline import fetcher, stitcher, lidar, plane_fitter, edge_extractor, measurer
from app.pipeline import reporter, building_footprints, roof_estimator
from app.pipeline.result import assemble_result
from app.imagery.naip import ImageryMetadata

logger = logging.getLogger(__name__)

MAX_STRUCTURES = 5
MAX_ROOF_AREA_SQFT = 50_000


def run_pipeline(report_id: str, property_id: str, lat: float, lon: float) -> dict:
    """Run the pipeline and RETURN a ContainerResult dict.

    Every report is a *full* report. Real data is used where available; gaps
    are filled with principled estimates so a complete report is always
    produced (and ``confidence_score`` reflects how much was estimated):

    1. Building footprint from OSM (retries/mirrors); synthesized if OSM has none.
    2. Aerial imagery (NAIP) for visual context (best-effort).
    3. Roof facets/edges: real LiDAR pitch when available, otherwise a hip-roof
       estimate from the footprint geometry.
    4. Measurements (always full: surface area + waste factor).
    5. PDF + overlay, uploaded to R2.

    Does NO database access. On failure, raises HTTPException so the calling
    Worker treats the run as a retryable failure.
    """
    try:
        # Step 1: Get building footprint from OSM, or synthesize one.
        logger.info("Fetching building footprint at (%.4f, %.4f)", lat, lon)
        primary = building_footprints.get_property_building(lat, lon)
        synthesized = False
        if not primary:
            logger.warning(
                "No OSM building near (%.4f, %.4f) — synthesizing footprint", lat, lon
            )
            primary = building_footprints.synthesize_footprint(lat, lon)
            synthesized = True

        all_buildings = [primary]

        logger.info(
            "Property: %s — %.0f sqft footprint, %d structures (synthesized=%s)",
            primary.get("address") or "unnamed",
            primary["footprint_area_sqft"],
            len(all_buildings),
            synthesized,
        )

        # Step 2: Fetch aerial imagery for visual context
        bbox = geo.property_bbox(lat, lon)
        try:
            image, img_metadata = fetcher.fetch(lat, lon, bbox)
            image, scale_factor = stitcher.normalize(image)
            effective_gsd = img_metadata.gsd * scale_factor
        except Exception as e:
            logger.warning("Imagery fetch failed: %s — generating report without image", e)
            image = np.zeros((1024, 1024, 3), dtype=np.uint8)
            img_metadata = ImageryMetadata(source="none", gsd=0.6, capture_date=None)
            effective_gsd = 0.6

        roof_polygons = [b["polygon"] for b in all_buildings]
        facets: list = []
        edges: list = []

        # Step 3: Real LiDAR pitch where available, else estimate the roof.
        # A synthesized footprint has no real building to measure, so we skip
        # LiDAR entirely and estimate.
        lidar_points = None if synthesized else lidar.fetch(bbox)
        pitch_source = "measured" if lidar_points is not None else "estimated"

        if lidar_points is not None:
            for i, building in enumerate(all_buildings):
                polygon = building["polygon"]
                clipped = lidar.clip_to_polygon(lidar_points, polygon)
                clipped = lidar.remove_ground_points(clipped)

                if len(clipped) >= config.MIN_LIDAR_POINTS:
                    planes = plane_fitter.fit(clipped)
                    poly_facets = plane_fitter.planes_to_facets(planes, polygon)
                    for f in poly_facets:
                        f["structure_index"] = i
                        f["facet_index"] = len(facets) + f.get("facet_index", 0)
                    facets.extend(poly_facets)
                    edges.extend(edge_extractor.extract(planes, poly_facets))
                else:
                    # LiDAR too sparse for this structure — estimate it.
                    bf, be = roof_estimator.estimate(
                        polygon, building["footprint_area_sqft"], lat,
                        structure_index=i, facet_start_index=len(facets),
                    )
                    facets.extend(bf)
                    edges.extend(be)
        else:
            for i, building in enumerate(all_buildings):
                bf, be = roof_estimator.estimate(
                    building["polygon"], building["footprint_area_sqft"], lat,
                    structure_index=i, facet_start_index=len(facets),
                )
                facets.extend(bf)
                edges.extend(be)

        tier = "full"
        measurements = measurer.calculate_full(roof_polygons, facets, edges, effective_gsd)
        measurements["num_structures"] = len(all_buildings)

        # Confidence reflects how much of the report was measured vs estimated.
        low_conf = bool(primary.get("_low_confidence"))
        if synthesized:
            confidence = 0.62
        elif pitch_source == "measured":
            confidence = 0.82 if low_conf else 0.93
        else:  # real footprint, estimated pitch
            confidence = 0.72 if low_conf else 0.80
        measurements["confidence_score"] = round(confidence, 2)

        logger.info(
            "Measurements: %.0f sqft, %d structures, %d facets, %.0f%% confidence (pitch=%s)",
            measurements["roof_area_sqft"],
            measurements["num_structures"],
            measurements.get("num_facets", len(facets)),
            confidence * 100,
            pitch_source,
        )

        # Step 5: Generate report artifacts and upload to R2
        report_data = reporter.assemble(
            measurements, roof_polygons, facets, edges, tier, img_metadata
        )

        imagery_key = None
        if image is not None and image.any():
            img_buf = io.BytesIO()
            Image.fromarray(image.astype(np.uint8)).save(img_buf, format="PNG")
            img_buf.seek(0)
            imagery_key = storage.upload_imagery(
                f"imagery/{geo.location_hash(lat, lon)}.png", img_buf.getvalue()
            )

        # Use the ACTUAL bbox from the COG read (not a calculated approximation)
        image_bbox = getattr(img_metadata, "bbox", None)
        overlay_bytes = reporter.to_overlay(image, roof_polygons, facets, image_bbox=image_bbox)
        pdf_bytes = reporter.to_pdf(report_data, image, overlay_bytes=overlay_bytes)

        pdf_key = storage.upload_pdf(report_id, pdf_bytes)
        overlay_key = storage.upload_overlay(report_id, overlay_bytes)

        result = assemble_result(
            measurements=measurements,
            facets=facets,
            edges=edges,
            keys={
                "pdfKey": pdf_key,
                "overlayKey": overlay_key,
                "imageryKey": imagery_key,
            },
            tier=tier,
            model_version=config.ML_MODEL_VERSION,
        )

        logger.info(
            "Report %s completed: %s tier, %.0f sqft, %d structures",
            report_id, tier,
            measurements["roof_area_sqft"],
            measurements["num_structures"],
        )

        return result

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Pipeline failed for report %s: %s", report_id, exc)
        raise HTTPException(status_code=500, detail=f"pipeline failed: {exc}") from exc
