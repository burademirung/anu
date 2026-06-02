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
from app.pipeline import reporter, building_footprints
from app.pipeline.result import assemble_result
from app.imagery.naip import ImageryMetadata

logger = logging.getLogger(__name__)

MAX_STRUCTURES = 5
MAX_ROOF_AREA_SQFT = 50_000


def run_pipeline(report_id: str, property_id: str, lat: float, lon: float) -> dict:
    """Run the full pipeline and RETURN a ContainerResult dict.

    Does NO database access. Uploads pdf/overlay/imagery artifacts to R2 and
    returns the keys inside the result. On failure, raises an HTTPException so
    the calling Worker treats the run as a retryable failure.

    Pipeline:
    1. Fetch building footprint from OSM (replaces U-Net)
    2. Fetch aerial imagery (NAIP) for visual context
    3. Fetch LiDAR for pitch/slope data
    4. Calculate measurements
    5. Generate PDF + overlay, upload to R2
    """
    try:
        # Step 1: Get building footprint from OSM
        logger.info("Fetching building footprint at (%.4f, %.4f)", lat, lon)
        primary = building_footprints.get_property_building(lat, lon)

        if not primary:
            logger.warning("No building found near (%.4f, %.4f)", lat, lon)
            return assemble_result(
                measurements={
                    "roof_area_sqft": 0.0,
                    "roof_area_squares": 0.0,
                    "num_structures": 0,
                    "waste_factor": None,
                    "confidence_score": 0.0,
                },
                facets=[],
                edges=[],
                keys={"pdfKey": None, "overlayKey": None, "imageryKey": None},
                tier="basic",
                model_version=config.ML_MODEL_VERSION,
            )

        # Use only the primary building at the geocoded address
        all_buildings = [primary]

        logger.info(
            "Property: %s — %.0f sqft footprint, %d structures",
            primary.get("address") or "unnamed",
            primary["footprint_area_sqft"],
            len(all_buildings),
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

        # Step 3: Build facets from footprints
        roof_polygons = [b["polygon"] for b in all_buildings]
        facets = []

        # Step 4: Try LiDAR for pitch data
        lidar_points = lidar.fetch(bbox)
        lidar_available = lidar_points is not None

        if lidar_available:
            tier = "full"
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
                        # Override area with OSM footprint (more accurate)
                        if i == 0 and f.get("facet_index", 0) == 0:
                            f["footprint_area_sqft"] = building["footprint_area_sqft"]
                    facets.extend(poly_facets)
                else:
                    # No LiDAR for this structure — use footprint only
                    facets.append({
                        "facet_index": len(facets),
                        "structure_index": i,
                        "footprint_area_sqft": building["footprint_area_sqft"],
                        "area_sqft": building["footprint_area_sqft"],
                        "pitch": None,
                        "pitch_degrees": None,
                        "pitch_confidence": None,
                        "orientation": None,
                        "polygon": polygon,
                    })

            edges = []
            for i, building in enumerate(all_buildings):
                polygon = building["polygon"]
                clipped = lidar.clip_to_polygon(lidar_points, polygon)
                clipped = lidar.remove_ground_points(clipped)
                if len(clipped) >= config.MIN_LIDAR_POINTS:
                    planes = plane_fitter.fit(clipped)
                    poly_facets = [f for f in facets if f.get("structure_index") == i]
                    poly_edges = edge_extractor.extract(planes, poly_facets)
                    edges.extend(poly_edges)

            measurements = measurer.calculate_full(roof_polygons, facets, edges, effective_gsd)
        else:
            tier = "basic"
            edges = []
            for i, building in enumerate(all_buildings):
                facets.append({
                    "facet_index": i,
                    "structure_index": i,
                    "footprint_area_sqft": building["footprint_area_sqft"],
                    "area_sqft": building["footprint_area_sqft"],
                    "pitch": None,
                    "pitch_degrees": None,
                    "pitch_confidence": None,
                    "orientation": None,
                    "polygon": building["polygon"],
                })
            measurements = measurer.calculate_basic(roof_polygons, facets, effective_gsd)

        # Override area with OSM data (more accurate than pixel-based calculation)
        total_osm_area = sum(b["footprint_area_sqft"] for b in all_buildings)
        measurements["roof_area_sqft"] = round(total_osm_area, 1)
        measurements["roof_area_squares"] = round(total_osm_area / 100, 2)
        measurements["num_structures"] = len(all_buildings)

        # Confidence based on data quality
        confidence = 0.90 if not primary.get("_low_confidence") else 0.70
        if lidar_available:
            confidence = min(confidence + 0.05, 0.95)
        measurements["confidence_score"] = confidence

        logger.info(
            "Measurements: %.0f sqft, %d structures, %.0f%% confidence",
            measurements["roof_area_sqft"],
            measurements["num_structures"],
            confidence * 100,
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
