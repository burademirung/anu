"""Coordinate and geometry utilities for the Anu ML service."""

import hashlib
import math
from typing import List, Tuple


def property_bbox(lat: float, lon: float, size_m: float = 40) -> Tuple[float, float, float, float]:
    """Return a bounding box centred on (lat, lon) with half-side *size_m* metres.

    Returns (min_lon, min_lat, max_lon, max_lat).
    """
    half = size_m / 2.0
    lat_delta = half / 111_000.0
    lon_delta = half / (111_000.0 * math.cos(math.radians(lat)))

    min_lat = lat - lat_delta
    max_lat = lat + lat_delta
    min_lon = lon - lon_delta
    max_lon = lon + lon_delta
    return (min_lon, min_lat, max_lon, max_lat)


def location_hash(lat: float, lon: float) -> str:
    """Return the first 12 hex characters of the MD5 of lat/lon rounded to 4 dp."""
    key = f"{round(lat, 4)},{round(lon, 4)}"
    return hashlib.md5(key.encode(), usedforsecurity=False).hexdigest()[:12]


def polygon_area_sqft(polygon_coords: List[List[float]], gsd: float) -> float:
    """Compute the area of a polygon defined in pixel coordinates.

    Uses the shoelace formula, then converts from pixels² to metres² via *gsd*
    (ground sample distance in metres/pixel) and finally to square feet.

    Parameters
    ----------
    polygon_coords:
        List of [x, y] pixel coordinate pairs (the polygon need not be closed).
    gsd:
        Ground sample distance in metres per pixel.

    Returns
    -------
    Area in square feet.
    """
    n = len(polygon_coords)
    area_px2 = 0.0
    for i in range(n):
        x0, y0 = polygon_coords[i]
        x1, y1 = polygon_coords[(i + 1) % n]
        area_px2 += x0 * y1 - x1 * y0
    area_m2 = abs(area_px2) / 2.0 * (gsd ** 2)
    area_sqft = area_m2 * 10.7639
    return area_sqft


def pitch_to_rise_run(pitch_degrees: float) -> str:
    """Convert a roof pitch in degrees to the conventional "N/12" string.

    The rise is rounded to the nearest whole number.
    """
    rise = round(math.tan(math.radians(pitch_degrees)) * 12)
    return f"{rise}/12"


def area_with_pitch(footprint_sqft: float, pitch_degrees: float) -> float:
    """Return the actual roof surface area given its footprint and pitch.

    Surface area = footprint / cos(pitch).
    """
    return footprint_sqft / math.cos(math.radians(pitch_degrees))
