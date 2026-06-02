from __future__ import annotations

from typing import Optional, Tuple

import numpy as np
from shapely.geometry import Point
from shapely.geometry.polygon import Polygon

from app.config import MIN_LIDAR_POINTS
from app.imagery.elevation import fetch_3dep


def fetch(bbox: Tuple[float, float, float, float]) -> Optional[np.ndarray]:
    """Fetch LiDAR point cloud for *bbox* from USGS 3DEP.

    Returns an Nx3 float32 array, or ``None`` if the fetch fails or returns
    fewer than ``MIN_LIDAR_POINTS`` points.
    """
    points = fetch_3dep(bbox)
    if points is None:
        return None
    if len(points) < MIN_LIDAR_POINTS:
        return None
    return points


def clip_to_polygon(
    points: np.ndarray,
    polygon: dict,
) -> np.ndarray:
    """Clip an Nx3 point array to the footprint of *polygon*.

    Args:
        points: Nx3 numpy array (X, Y, Z).
        polygon: GeoJSON-style Polygon dict with ``"coordinates"`` key.

    Returns:
        Mx3 array containing only points that fall inside *polygon*.
    """
    coords = polygon["coordinates"][0]
    shapely_poly = Polygon(coords)

    mask = np.array(
        [shapely_poly.contains(Point(p[0], p[1])) for p in points],
        dtype=bool,
    )
    return points[mask]


def remove_ground_points(points: np.ndarray) -> np.ndarray:
    """Remove ground-level points, keeping only above-ground returns.

    Discards any point whose Z value is below 70 % of the median Z.

    Args:
        points: Nx3 numpy array (X, Y, Z).

    Returns:
        Filtered Mx3 array.
    """
    if len(points) == 0:
        return points
    z_threshold = 0.70 * float(np.median(points[:, 2]))
    return points[points[:, 2] >= z_threshold]
