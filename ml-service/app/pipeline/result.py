"""Pure result-assembly for the Anu ML container.

Builds the ``ContainerResult`` dict (camelCase keys) returned by ``/process``.
This module has NO heavy imports (no numpy/rasterio/fastapi) so it can be unit
tested in isolation. Edge facet references are mapped to facet INDICES.
"""
from __future__ import annotations

from typing import Optional


def facet_index_map(facets: list[dict]) -> dict:
    """Map a facet reference to its INDEX in *facets*.

    Edges reference facets by their ``facet_index`` value (and, for safety,
    also by Python object identity). The returned map lets us translate those
    references into the position of the facet in the result ``facets`` list.
    """
    index_map: dict = {}
    for i, f in enumerate(facets):
        index_map[id(f)] = i
        fi = f.get("facet_index")
        if fi is not None and fi not in index_map:
            index_map[fi] = i
    return index_map


def resolve_facet_index(ref, index_map: dict) -> Optional[int]:
    """Resolve an edge facet reference to a facet INDEX (or None)."""
    if ref is None:
        return None
    # Direct facet object
    if id(ref) in index_map:
        return index_map[id(ref)]
    # dict carrying a facet_index
    if isinstance(ref, dict):
        return index_map.get(ref.get("facet_index"))
    # plain facet_index value (int)
    return index_map.get(ref)


def assemble_result(
    measurements: dict,
    facets: list[dict],
    edges: list[dict],
    keys: dict,
    tier: str,
    model_version: str,
) -> dict:
    """Build the ContainerResult dict. PURE: no I/O, no DB, no network.

    *keys* carries ``pdfKey`` / ``overlayKey`` / ``imageryKey`` (any may be None).
    Edge facet references (``left_facet_id`` / ``right_facet_id``) are mapped to
    the INDEX of the referenced facet within the returned ``facets`` list.
    """
    index_map = facet_index_map(facets)

    result_facets = []
    for idx, f in enumerate(facets):
        result_facets.append({
            "structureIndex": int(f.get("structure_index", 0)),
            "facetIndex": idx,
            "footprintAreaSqft": f.get("footprint_area_sqft"),
            "areaSqft": f.get("area_sqft"),
            "pitch": f.get("pitch"),
            "pitchDegrees": f.get("pitch_degrees"),
            "pitchConfidence": f.get("pitch_confidence"),
            "orientation": f.get("orientation"),
            "polygon": f.get("polygon"),
        })

    result_edges = []
    for e in edges:
        result_edges.append({
            "edgeType": e.get("edge_type"),
            "lengthFt": e.get("length_ft"),
            "geometry": e.get("geometry"),
            "leftFacetIndex": resolve_facet_index(e.get("left_facet_id"), index_map),
            "rightFacetIndex": resolve_facet_index(e.get("right_facet_id"), index_map),
        })

    return {
        "tier": tier,
        "modelVersion": model_version,
        "roofAreaSqft": measurements.get("roof_area_sqft", 0.0),
        "roofAreaSquares": measurements.get("roof_area_squares", 0.0),
        "numFacets": len(result_facets),
        "numStructures": measurements.get("num_structures", 0),
        "wasteFactor": measurements.get("waste_factor"),
        "confidenceScore": measurements.get("confidence_score", 0.0),
        "pdfKey": keys.get("pdfKey"),
        "overlayKey": keys.get("overlayKey"),
        "imageryKey": keys.get("imageryKey"),
        "facets": result_facets,
        "edges": result_edges,
    }
