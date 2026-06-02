from __future__ import annotations

from typing import List


def _calculate_waste(
    num_valleys: int,
    num_hips: int,
    max_pitch: float,
    num_facets: int,
) -> float:
    """Estimate material waste percentage for a roof.

    Formula: base 10% + 2%/valley + 1%/hip + 3% if pitch>33.69 + 2% if facets>6, capped 25%.
    """
    waste = 10.0
    waste += num_valleys * 2.0
    waste += num_hips * 1.0
    if max_pitch > 33.69:
        waste += 3.0
    if num_facets > 6:
        waste += 2.0
    return min(waste, 25.0)


def calculate_full(
    roof_polygons: List[dict],
    facets: List[dict],
    edges: List[dict],
    gsd: float,
) -> dict:
    """Full measurement — uses facet surface areas plus waste factor."""
    total_area = sum(f.get("area_sqft", 0.0) for f in facets)

    edge_counts: dict = {}
    for edge in edges:
        etype = edge.get("edge_type", "unknown")
        edge_counts[etype] = edge_counts.get(etype, 0) + 1

    num_valleys = edge_counts.get("valley", 0)
    num_hips = edge_counts.get("hip", 0)
    num_facets = len(facets)

    max_pitch = max((f.get("pitch_degrees") or 0.0 for f in facets), default=0.0)

    waste = _calculate_waste(num_valleys, num_hips, max_pitch, num_facets)

    return {
        "roof_area_sqft": round(total_area, 1),
        "roof_area_squares": round(total_area / 100, 2),
        "num_facets": num_facets,
        "num_structures": len(roof_polygons),
        "waste_factor": waste,
        "confidence_score": 0.85,
    }


def calculate_basic(
    roof_polygons: List[dict],
    facets: List[dict],
    gsd: float,
) -> dict:
    """Basic measurement — sums footprint areas only (no waste factor)."""
    total_area = sum(f.get("footprint_area_sqft", 0.0) for f in facets)

    return {
        "roof_area_sqft": round(total_area, 1),
        "roof_area_squares": round(total_area / 100, 2),
        "num_facets": len(facets),
        "num_structures": len(roof_polygons),
        "waste_factor": None,
        "confidence_score": 0.70,
    }
