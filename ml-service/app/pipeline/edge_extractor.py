from __future__ import annotations

import math
from typing import List

import numpy as np


# Feet per metre
_M_TO_FT = 3.28084


def _line_length_ft(p1: List[float], p2: List[float]) -> float:
    """Euclidean distance between two 2-D points, converted to feet."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return math.hypot(dx, dy) * _M_TO_FT


def _classify_pair(normal_a: np.ndarray, normal_b: np.ndarray) -> str:
    """Classify the edge shared by two planes by their normals.

    Rules (using the angle between the horizontal projections):

    * Normals pointing away from each other (dot product of *xy* parts < 0)
      → **ridge** (two upward slopes meeting at the top).
    * Normals pointing toward each other (dot product > 0)
      → **valley** (two slopes draining inward).
    * Otherwise → **hip** (planes meet at the side of the roof).
    """
    # Work with the XY (horizontal) components only
    ha = np.array([normal_a[0], normal_a[1]])
    hb = np.array([normal_b[0], normal_b[1]])

    mag_a = np.linalg.norm(ha)
    mag_b = np.linalg.norm(hb)

    if mag_a < 1e-9 or mag_b < 1e-9:
        # At least one plane is nearly horizontal — treat as hip
        return "hip"

    dot = float(np.dot(ha / mag_a, hb / mag_b))

    if dot < -0.3:
        return "ridge"
    if dot > 0.3:
        return "valley"
    return "hip"


def _facet_boundary_segments(facet: dict) -> List[tuple]:
    """Return list of (p1, p2) segments from a facet's polygon ring."""
    coords = facet["polygon"]["coordinates"][0]
    segments = []
    for i in range(len(coords) - 1):
        segments.append((coords[i], coords[i + 1]))
    return segments


def extract(planes: List[dict], facets: List[dict]) -> List[dict]:
    """Extract roof edges from fitted planes and facets.

    For each pair of planes, an interior edge (ridge / hip / valley) is
    produced.  Additionally, eave/rake perimeter edges are extracted from the
    outer boundary of each facet polygon.

    Args:
        planes: Output of :func:`app.pipeline.plane_fitter.fit`.
        facets: Output of :func:`app.pipeline.plane_fitter.planes_to_facets`.

    Returns:
        List of edge dicts with keys: ``edge_type``, ``length_ft``,
        ``geometry`` (GeoJSON LineString), ``left_facet_id`` (``None``),
        ``right_facet_id`` (``None``).
    """
    edges: List[dict] = []

    # --- Interior edges between every pair of planes ---
    for i in range(len(planes)):
        for j in range(i + 1, len(planes)):
            normal_a = planes[i]["normal"]
            normal_b = planes[j]["normal"]

            edge_type = _classify_pair(normal_a, normal_b)

            # Represent the shared edge as the line connecting the centroids
            # of the two inlier sets (a lightweight approximation).
            centroid_a = planes[i]["inliers"][:, :2].mean(axis=0).tolist()
            centroid_b = planes[j]["inliers"][:, :2].mean(axis=0).tolist()

            length_ft = _line_length_ft(centroid_a, centroid_b)

            edges.append({
                "edge_type": edge_type,
                "length_ft": round(length_ft, 2),
                "geometry": {
                    "type": "LineString",
                    "coordinates": [centroid_a, centroid_b],
                },
                "left_facet_id": None,
                "right_facet_id": None,
            })

    # --- Perimeter edges (eaves and rakes) from facet boundaries ---
    for facet in facets:
        segments = _facet_boundary_segments(facet)
        pitch_deg = facet.get("pitch_degrees", 0.0)

        # Rake: segments on a sloped facet; Eave: segments where the facet
        # meets a horizontal reference.  A simple heuristic: segments on
        # facets with pitch > 5° that run roughly along the fall-line are
        # rakes; all other perimeter segments are eaves.
        for p1, p2 in segments:
            seg_vec = [p2[0] - p1[0], p2[1] - p1[1]]
            length_ft = _line_length_ft(p1, p2)

            if pitch_deg > 5.0:
                # Determine if segment is along the fall-line (rake) or across
                # it (eave) using the facet's horizontal normal projection.
                normal = facet.get("_normal", None)
                if normal is not None:
                    hx, hy = float(normal[0]), float(normal[1])
                    seg_mag = math.hypot(seg_vec[0], seg_vec[1])
                    if seg_mag > 1e-9:
                        seg_unit = [seg_vec[0] / seg_mag, seg_vec[1] / seg_mag]
                        cross = abs(hx * seg_unit[1] - hy * seg_unit[0])
                        perimeter_type = "rake" if cross < 0.5 else "eave"
                    else:
                        perimeter_type = "eave"
                else:
                    perimeter_type = "eave"
            else:
                perimeter_type = "eave"

            edges.append({
                "edge_type": perimeter_type,
                "length_ft": round(length_ft, 2),
                "geometry": {
                    "type": "LineString",
                    "coordinates": [list(p1), list(p2)],
                },
                "left_facet_id": None,
                "right_facet_id": None,
            })

    return edges
