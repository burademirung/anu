from __future__ import annotations

import math
from typing import List, Optional, Tuple

import numpy as np
from scipy.spatial import ConvexHull


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _normal_to_pitch(normal: np.ndarray) -> float:
    """Return pitch angle in degrees (0 = horizontal, 90 = vertical).

    Pitch is the angle between the plane and the horizontal, i.e.
    acos(|nz| / |n|) converted to degrees.
    """
    norm = float(np.linalg.norm(normal))
    if norm < 1e-12:
        return 0.0
    n = np.asarray(normal, dtype=float) / norm
    # Clamp to [-1, 1] to guard against floating-point overshoot
    nz_abs = min(abs(float(n[2])), 1.0)
    # Round away sub-micro-radian noise so that a perfectly horizontal normal
    # returns exactly 0.0
    pitch = math.degrees(math.acos(nz_abs))
    return round(pitch, 10)


def _normal_to_orientation(normal: np.ndarray) -> str:
    """Convert a plane normal to a compass direction string.

    Uses the XY components of the normal to determine which way the slope
    faces.
    """
    n = normal / (np.linalg.norm(normal) + 1e-12)
    angle_deg = math.degrees(math.atan2(float(n[0]), float(n[1]))) % 360.0

    compass = [
        (22.5,  "N"),
        (67.5,  "NE"),
        (112.5, "E"),
        (157.5, "SE"),
        (202.5, "S"),
        (247.5, "SW"),
        (292.5, "W"),
        (337.5, "NW"),
        (360.0, "N"),
    ]
    for threshold, direction in compass:
        if angle_deg < threshold:
            return direction
    return "N"


def _pitch_to_rise_run(pitch_deg: float) -> str:
    """Express pitch as a rise/12 string (e.g. '6/12')."""
    rise = round(math.tan(math.radians(pitch_deg)) * 12)
    return f"{int(rise)}/12"


def _fit_plane(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray) -> Tuple[np.ndarray, float]:
    """Fit a plane through three points.

    Returns (unit_normal, d) where the plane equation is n·x = d.
    """
    v1 = p1 - p0
    v2 = p2 - p0
    normal = np.cross(v1, v2)
    norm = np.linalg.norm(normal)
    if norm < 1e-12:
        # Degenerate — return a vertical plane
        normal = np.array([0.0, 0.0, 1.0])
        d = float(p0[2])
    else:
        normal = normal / norm
        d = float(np.dot(normal, p0))
    return normal, d


def _inlier_mask(
    points: np.ndarray,
    normal: np.ndarray,
    d: float,
    threshold: float,
) -> np.ndarray:
    """Return boolean mask of points within *threshold* of the plane."""
    distances = np.abs(points @ normal - d)
    return distances < threshold


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fit(
    points: np.ndarray,
    max_planes: int = 10,
    threshold: float = 0.15,
    min_points: int = 20,
) -> List[dict]:
    """Iterative RANSAC plane fitting.

    Repeatedly finds the dominant plane in *points*, extracts its inliers, and
    continues on the remaining points until no plane with >= *min_points*
    inliers can be found or *max_planes* planes have been extracted.

    Similar planes (normals within 10 degrees of each other) are merged by
    averaging their normals and combining their inlier sets.

    Args:
        points:     Nx3 float array of 3-D point coordinates.
        max_planes: Maximum number of planes to extract.
        threshold:  RANSAC distance threshold (same units as *points*).
        min_points: Minimum inliers required to accept a plane.

    Returns:
        List of plane dicts, each containing::

            {
                "normal":   np.ndarray shape (3,),
                "d":        float,
                "inliers":  np.ndarray shape (Mx3),
            }
    """
    remaining = points.copy()
    planes: List[dict] = []

    rng = np.random.default_rng(0)

    for _ in range(max_planes):
        if len(remaining) < min_points:
            break

        best_normal: Optional[np.ndarray] = None
        best_d: float = 0.0
        best_count: int = 0
        best_mask: Optional[np.ndarray] = None

        n_iter = min(200, len(remaining) * (len(remaining) - 1) * (len(remaining) - 2) // 6)
        n_iter = max(n_iter, 50)

        for _ in range(n_iter):
            idx = rng.choice(len(remaining), 3, replace=False)
            try:
                normal, d = _fit_plane(
                    remaining[idx[0]], remaining[idx[1]], remaining[idx[2]]
                )
            except Exception:
                continue

            mask = _inlier_mask(remaining, normal, d, threshold)
            count = int(mask.sum())

            if count > best_count:
                best_count = count
                best_normal = normal
                best_d = d
                best_mask = mask

        if best_normal is None or best_count < min_points:
            break

        inliers = remaining[best_mask]
        remaining = remaining[~best_mask]

        planes.append({
            "normal": best_normal,
            "d": best_d,
            "inliers": inliers,
        })

    # --- Merge similar planes (normals within 10 degrees) ---
    merged: List[dict] = []
    used = [False] * len(planes)

    for i, plane_i in enumerate(planes):
        if used[i]:
            continue
        group_normals = [plane_i["normal"]]
        group_inliers = [plane_i["inliers"]]
        used[i] = True

        for j, plane_j in enumerate(planes):
            if used[j]:
                continue
            cos_angle = abs(float(np.dot(plane_i["normal"], plane_j["normal"])))
            cos_angle = min(cos_angle, 1.0)
            angle_deg = math.degrees(math.acos(cos_angle))
            if angle_deg < 10.0:
                group_normals.append(plane_j["normal"])
                group_inliers.append(plane_j["inliers"])
                used[j] = True

        avg_normal = np.mean(group_normals, axis=0)
        norm = np.linalg.norm(avg_normal)
        if norm > 1e-12:
            avg_normal /= norm

        all_inliers = np.vstack(group_inliers)
        avg_d = float(np.mean(all_inliers @ avg_normal))

        merged.append({
            "normal": avg_normal,
            "d": avg_d,
            "inliers": all_inliers,
        })

    return merged


def planes_to_facets(
    planes: List[dict],
    roof_polygon: dict,
) -> List[dict]:
    """Convert RANSAC planes to structured facet dicts.

    Args:
        planes:       Output of :func:`fit`.
        roof_polygon: GeoJSON Polygon representing the overall roof footprint.

    Returns:
        List of facet dicts with keys: ``facet_index``, ``footprint_area_sqft``,
        ``area_sqft``, ``pitch``, ``pitch_degrees``, ``pitch_confidence``,
        ``orientation``, ``polygon``.
    """
    # Metres → feet conversion factor
    M_TO_FT = 3.28084
    M2_TO_FT2 = M_TO_FT ** 2

    facets = []
    for idx, plane in enumerate(planes):
        normal = plane["normal"]
        inliers = plane["inliers"]

        pitch_deg = _normal_to_pitch(normal)
        pitch_str = _pitch_to_rise_run(pitch_deg)
        orientation = _normal_to_orientation(normal)

        # XY convex hull for the footprint polygon
        xy = inliers[:, :2]
        if len(xy) >= 3:
            try:
                hull = ConvexHull(xy)
                hull_pts = xy[hull.vertices].tolist()
                hull_pts.append(hull_pts[0])  # close ring
                footprint_area_m2 = hull.volume  # area in 2-D
            except Exception:
                hull_pts = xy.tolist()
                hull_pts.append(hull_pts[0])
                footprint_area_m2 = 0.0
        else:
            hull_pts = xy.tolist()
            if hull_pts:
                hull_pts.append(hull_pts[0])
            footprint_area_m2 = 0.0

        footprint_area_sqft = footprint_area_m2 * M2_TO_FT2

        # Surface area = footprint / cos(pitch)
        cos_pitch = math.cos(math.radians(pitch_deg))
        if cos_pitch < 1e-6:
            area_sqft = footprint_area_sqft
        else:
            area_sqft = footprint_area_sqft / cos_pitch

        facets.append({
            "facet_index": idx,
            "footprint_area_sqft": round(footprint_area_sqft, 2),
            "area_sqft": round(area_sqft, 2),
            "pitch": pitch_str,
            "pitch_degrees": round(pitch_deg, 2),
            "pitch_confidence": "measured",
            "orientation": orientation,
            "polygon": {
                "type": "Polygon",
                "coordinates": [hull_pts],
            },
        })

    return facets
