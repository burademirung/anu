"""NAIP imagery fetcher using Microsoft Planetary Computer STAC API.

Key improvement: uses COG windowed reads via rasterio to fetch ONLY the
property bbox from the Cloud-Optimized GeoTIFF, instead of downloading
the entire multi-GB tile. This gives ~1024x1024 pixels at native 0.6m
resolution for a ~600m property area.
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import requests

logger = logging.getLogger(__name__)

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search"

# We want ~1024 pixels at native GSD. At 0.6m GSD: 1024 * 0.6 = ~614m
# Use 600m bbox to get a nice square image centered on the property
IMAGERY_BBOX_SIZE_M = 600


@dataclass
class ImageryMetadata:
    source: str
    gsd: float
    capture_date: Optional[str]
    bbox: Optional[Tuple[float, float, float, float]] = None  # actual image extent (min_lon, min_lat, max_lon, max_lat)


def fetch_naip(
    lat: float, lon: float, bbox: Tuple[float, float, float, float]
) -> Optional[Tuple[np.ndarray, ImageryMetadata]]:
    """Fetch NAIP imagery for a property using COG windowed reads.

    Instead of downloading the entire tile (12K x 11K pixels), we:
    1. Search STAC for the NAIP item covering this location
    2. Use rasterio to read ONLY the ~1024x1024 pixel window around the property
    3. This fetches ~3MB instead of ~400MB

    Returns (HxWx3 RGB numpy array, ImageryMetadata) or None.
    """
    # Step 1: Expand bbox to ~600m for enough pixels at 0.6m GSD
    import math
    half_m = IMAGERY_BBOX_SIZE_M / 2
    dlat = half_m / 111_000
    dlon = half_m / (111_000 * math.cos(math.radians(lat)))
    imagery_bbox = (lon - dlon, lat - dlat, lon + dlon, lat + dlat)

    # Step 2: Search STAC for the most recent NAIP item
    payload = {
        "collections": ["naip"],
        "bbox": list(imagery_bbox),
        "limit": 1,
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
    }

    try:
        resp = requests.post(STAC_URL, json=payload, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.warning("STAC search failed: %s", e)
        return None

    features = resp.json().get("features", [])
    if not features:
        logger.warning("No NAIP imagery found for lat=%s lon=%s", lat, lon)
        return None

    item = features[0]
    properties = item.get("properties", {})
    gsd = float(properties.get("gsd", 0.6))
    capture_date = properties.get("datetime")

    assets = item.get("assets", {})
    asset = assets.get("image") or next(iter(assets.values()), None)
    if not asset:
        return None

    href = asset.get("href")
    if not href:
        return None

    # Step 3: Try COG windowed read via rasterio (fetches only needed pixels)
    actual_bbox = None
    cog_result = _read_cog_window(href, imagery_bbox)
    if cog_result is not None:
        array, actual_bbox = cog_result
    else:
        array = None

    # If window is too small (property at tile edge), search for adjacent tiles
    if array is not None and (array.shape[0] < 500 or array.shape[1] < 500):
        logger.info("Small window (%dx%d) — property at tile edge, searching more tiles",
                     array.shape[1], array.shape[0])
        multi = _try_multiple_tiles(imagery_bbox, payload)
        if multi is not None:
            array, actual_bbox = multi

    if array is None:
        # Fallback: download full tile and crop center
        logger.warning("COG windowed read failed, falling back to full download + center crop")
        full = _download_full_tile(href)
        if full is not None:
            h, w = full.shape[:2]
            ch, cw = min(1000, h), min(1000, w)
            y0, x0 = (h - ch) // 2, (w - cw) // 2
            array = full[y0:y0+ch, x0:x0+cw]
            actual_bbox = imagery_bbox  # approximate

    if array is None:
        return None

    logger.info(
        "NAIP imagery: %dx%d pixels, GSD=%.2fm, date=%s",
        array.shape[1], array.shape[0], gsd, capture_date,
    )

    metadata = ImageryMetadata(source="naip", gsd=gsd, capture_date=capture_date, bbox=actual_bbox)
    return array, metadata


def _try_multiple_tiles(bbox: Tuple[float, float, float, float], payload: dict) -> Optional[Tuple[np.ndarray, Tuple[float, float, float, float]]]:
    """Search for multiple NAIP tiles and pick the one with the largest window."""
    try:
        multi_payload = {**payload, "limit": 5}
        resp = requests.post(STAC_URL, json=multi_payload, timeout=30)
        resp.raise_for_status()
        features = resp.json().get("features", [])

        best_result = None
        best_pixels = 0

        for item in features:
            assets = item.get("assets", {})
            asset = assets.get("image") or next(iter(assets.values()), None)
            if not asset:
                continue
            href = asset.get("href")
            if not href:
                continue

            result = _read_cog_window(href, bbox)
            if result is not None:
                arr, actual_bbox = result
                pixels = arr.shape[0] * arr.shape[1]
                if pixels > best_pixels:
                    best_result = (arr, actual_bbox)
                    best_pixels = pixels
                    logger.info("Found better tile: %dx%d (%d px)", arr.shape[1], arr.shape[0], pixels)

        return best_result
    except Exception as e:
        logger.warning("Multi-tile search failed: %s", e)
        return None


def _read_cog_window(href: str, bbox: Tuple[float, float, float, float]) -> Optional[Tuple[np.ndarray, Tuple[float, float, float, float]]]:
    """Read a spatial window from a Cloud-Optimized GeoTIFF via HTTP range requests.

    Returns (image_array, actual_bbox_wgs84) or None.
    The actual_bbox is the precise geographic extent of the returned pixels.
    """
    try:
        import rasterio
        from rasterio.warp import transform_bounds
        from rasterio.windows import from_bounds

        with rasterio.open(href) as src:
            # Reproject our WGS84 bbox to the COG's native CRS
            native_bbox = transform_bounds("EPSG:4326", src.crs, *bbox)

            # Convert reprojected bbox to pixel window
            window = from_bounds(*native_bbox, transform=src.transform)

            # Clamp window to image bounds
            img_window = rasterio.windows.Window(0, 0, src.width, src.height)
            window = window.intersection(img_window)

            if window.width < 10 or window.height < 10:
                logger.warning("COG window too small: %s", window)
                return None

            # Read RGB bands for this window only
            num_bands = min(src.count, 3)
            data = src.read(
                list(range(1, num_bands + 1)),
                window=window,
            )

            # Get the ACTUAL geographic bounds of the pixels we read
            actual_native_bounds = rasterio.windows.bounds(window, src.transform)
            actual_wgs84_bounds = transform_bounds(src.crs, "EPSG:4326", *actual_native_bounds)

            array = np.transpose(data, (1, 2, 0))
            if array.shape[2] < 3:
                array = np.repeat(array, 3, axis=2)

            logger.info(
                "COG windowed read: %dx%d pixels, bbox: (%.6f,%.6f)-(%.6f,%.6f)",
                array.shape[1], array.shape[0],
                actual_wgs84_bounds[0], actual_wgs84_bounds[1],
                actual_wgs84_bounds[2], actual_wgs84_bounds[3],
            )
            return array.astype(np.uint8), actual_wgs84_bounds

    except ImportError:
        logger.warning("rasterio not installed — cannot do COG windowed reads")
        return None
    except Exception as e:
        logger.warning("COG windowed read failed: %s", e)
        return None


def _download_full_tile(href: str) -> Optional[np.ndarray]:
    """Fallback: download the entire NAIP tile."""
    try:
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = 300_000_000

        resp = requests.get(href, timeout=120)
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content)).convert("RGB")
        return np.array(img)
    except Exception as e:
        logger.warning("Full tile download failed: %s", e)
        return None
