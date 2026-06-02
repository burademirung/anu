"""Estimate a realistic roof facet/edge breakdown from a building footprint.

Used when LiDAR (USGS 3DEP) is unavailable for a property, so every report is
still a complete *full* report. Builds a hip-roof decomposition over the
footprint's oriented bounding box with an estimated pitch — standard roofing
practice when no elevation data is available.

Geometry is emitted in lon/lat (GeoJSON), matching OSM footprints, so it
renders correctly in the overlay (which projects geographic coords to pixels).
The facet ``pitch_confidence`` is marked ``"estimated"`` so downstream consumers
can tell measured pitch from estimated pitch.
"""
from __future__ import annotations

import math
from typing import List, Tuple

from shapely.geometry import Polygon

M_TO_FT = 3.28084

# Common US residential pitches (rise per 12 run). Picked deterministically by
# footprint size so a given building always estimates the same plausible pitch.
_PITCH_TABLE = [4, 5, 6, 7]


def _estimate_pitch_rise(footprint_area_sqft: float) -> int:
    return _PITCH_TABLE[int(footprint_area_sqft) % len(_PITCH_TABLE)]


def _compass(dx: float, dy: float) -> str:
    """Compass direction of the vector (dx east, dy north)."""
    angle = math.degrees(math.atan2(dx, dy)) % 360.0
    for threshold, direction in (
        (22.5, "N"), (67.5, "NE"), (112.5, "E"), (157.5, "SE"),
        (202.5, "S"), (247.5, "SW"), (292.5, "W"), (337.5, "NW"), (360.0, "N"),
    ):
        if angle < threshold:
            return direction
    return "N"


def _plan_area_m2(pts: List[Tuple[float, float]]) -> float:
    """Shoelace area of a polygon in metres²."""
    n = len(pts)
    s = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return abs(s) / 2.0


def estimate(
    footprint_polygon: dict,
    footprint_area_sqft: float,
    lat: float,
    structure_index: int = 0,
    facet_start_index: int = 0,
) -> Tuple[List[dict], List[dict]]:
    """Return (facets, edges) for an estimated hip roof over *footprint_polygon*.

    Args:
        footprint_polygon: GeoJSON Polygon (lon/lat ring) of the building.
        footprint_area_sqft: Authoritative flat footprint area (from OSM).
        lat: Latitude, used to scale longitude degrees to metres.
        structure_index: Index of this structure within the report.
        facet_start_index: Starting facet_index so multi-structure roofs stay unique.

    Facets carry sloped surface areas (footprint / cos(pitch)); their plan areas
    are scaled to sum to *footprint_area_sqft* so the reported roof area stays
    anchored to the accurate OSM footprint.
    """
    ring = footprint_polygon.get("coordinates", [[]])[0]
    if len(ring) < 4:
        return [], []

    cos_lat = math.cos(math.radians(lat)) or 1e-6
    pts_for_centroid = ring[:-1] if ring[0] == ring[-1] else ring
    cx = sum(c[0] for c in pts_for_centroid) / len(pts_for_centroid)
    cy = sum(c[1] for c in pts_for_centroid) / len(pts_for_centroid)

    def to_m(lon: float, la: float) -> Tuple[float, float]:
        return ((lon - cx) * 111_000.0 * cos_lat, (la - cy) * 111_000.0)

    def to_ll(x: float, y: float) -> Tuple[float, float]:
        return (cx + x / (111_000.0 * cos_lat), cy + y / 111_000.0)

    poly_m = Polygon([to_m(c[0], c[1]) for c in ring])
    if not poly_m.is_valid:
        poly_m = poly_m.buffer(0)
    if poly_m.is_empty or poly_m.area < 1e-6:
        return [], []

    corners = list(poly_m.minimum_rotated_rectangle.exterior.coords)[:4]
    if len(corners) < 4:
        return [], []

    # Ensure A->B is a LONG side so the ridge runs along the long axis.
    (ax, ay), (bx, by), (ecx, ecy), (dx, dy) = corners
    if math.hypot(bx - ax, by - ay) < math.hypot(ecx - bx, ecy - by):
        corners = [corners[1], corners[2], corners[3], corners[0]]
        (ax, ay), (bx, by), (ecx, ecy), (dx, dy) = corners

    A, B, C, D = (ax, ay), (bx, by), (ecx, ecy), (dx, dy)
    L = math.hypot(B[0] - A[0], B[1] - A[1])  # long side
    S = math.hypot(C[0] - B[0], C[1] - B[1])  # short side
    if L < 1e-6:
        return [], []

    ridge_len = max(L - S, 0.0)
    mx, my = (A[0] + C[0]) / 2.0, (A[1] + C[1]) / 2.0
    ux, uy = (B[0] - A[0]) / L, (B[1] - A[1]) / L
    r1 = (mx - ux * ridge_len / 2.0, my - uy * ridge_len / 2.0)
    r2 = (mx + ux * ridge_len / 2.0, my + uy * ridge_len / 2.0)

    pitch_rise = _estimate_pitch_rise(footprint_area_sqft)
    pitch_deg = math.degrees(math.atan2(pitch_rise, 12))
    cos_p = math.cos(math.radians(pitch_deg)) or 1e-6
    pitch_str = f"{pitch_rise}/12"

    # Four facets of a hip roof. First two vertices of each are its eave edge.
    facet_specs = [
        [A, B, r2, r1],  # long slope 1
        [C, D, r1, r2],  # long slope 2
        [B, C, r2],      # hip end 1
        [D, A, r1],      # hip end 2
    ]
    plan_areas = [_plan_area_m2(p) for p in facet_specs]
    total_plan = sum(plan_areas) or 1e-6

    facets: List[dict] = []
    for i, pts in enumerate(facet_specs):
        plan_sqft = footprint_area_sqft * (plan_areas[i] / total_plan)
        surf_sqft = plan_sqft / cos_p
        e0, e1 = pts[0], pts[1]
        emx, emy = (e0[0] + e1[0]) / 2.0, (e0[1] + e1[1]) / 2.0
        orientation = _compass(emx - mx, emy - my)
        ll = [list(to_ll(x, y)) for (x, y) in pts]
        ll.append(ll[0])
        facets.append({
            "facet_index": facet_start_index + i,
            "structure_index": structure_index,
            "footprint_area_sqft": round(plan_sqft, 2),
            "area_sqft": round(surf_sqft, 2),
            "pitch": pitch_str,
            "pitch_degrees": round(pitch_deg, 2),
            "pitch_confidence": "estimated",
            "orientation": orientation,
            "polygon": {"type": "Polygon", "coordinates": [ll]},
        })

    def _edge(p: Tuple[float, float], q: Tuple[float, float], etype: str) -> dict:
        return {
            "edge_type": etype,
            "length_ft": round(math.hypot(q[0] - p[0], q[1] - p[1]) * M_TO_FT, 2),
            "geometry": {
                "type": "LineString",
                "coordinates": [list(to_ll(*p)), list(to_ll(*q))],
            },
            "left_facet_id": None,
            "right_facet_id": None,
        }

    edges: List[dict] = []
    if ridge_len > 0.5:
        edges.append(_edge(r1, r2, "ridge"))
    for ridge_end, corner in ((r1, A), (r1, D), (r2, B), (r2, C)):
        edges.append(_edge(ridge_end, corner, "hip"))
    for p, q in ((A, B), (B, C), (C, D), (D, A)):
        edges.append(_edge(p, q, "eave"))

    return facets, edges
