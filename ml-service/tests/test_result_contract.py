"""Unit tests for the pure ContainerResult assembly (no external I/O)."""

from app.pipeline.result import assemble_result


_CONTRACT_KEYS = {
    "tier",
    "modelVersion",
    "roofAreaSqft",
    "roofAreaSquares",
    "numFacets",
    "numStructures",
    "wasteFactor",
    "confidenceScore",
    "pdfKey",
    "overlayKey",
    "imageryKey",
    "facets",
    "edges",
}

_FACET_KEYS = {
    "structureIndex",
    "facetIndex",
    "footprintAreaSqft",
    "areaSqft",
    "pitch",
    "pitchDegrees",
    "pitchConfidence",
    "orientation",
    "polygon",
}

_EDGE_KEYS = {
    "edgeType",
    "lengthFt",
    "geometry",
    "leftFacetIndex",
    "rightFacetIndex",
}


def _sample_facets():
    return [
        {
            "facet_index": 0,
            "structure_index": 0,
            "footprint_area_sqft": 1200.0,
            "area_sqft": 1300.0,
            "pitch": "6/12",
            "pitch_degrees": 26.57,
            "pitch_confidence": "high",
            "orientation": "S",
            "polygon": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
        },
        {
            "facet_index": 1,
            "structure_index": 0,
            "footprint_area_sqft": 800.0,
            "area_sqft": 900.0,
            "pitch": None,
            "pitch_degrees": None,
            "pitch_confidence": None,
            "orientation": "N",
            "polygon": {"type": "Polygon", "coordinates": [[[1, 1], [2, 1], [2, 2], [1, 1]]]},
        },
    ]


def _measurements():
    return {
        "roof_area_sqft": 2000.0,
        "roof_area_squares": 20.0,
        "num_structures": 1,
        "waste_factor": 12.0,
        "confidence_score": 0.9,
    }


def test_all_contract_keys_present():
    result = assemble_result(
        _measurements(),
        _sample_facets(),
        [],
        {"pdfKey": "reports/r1/report.pdf", "overlayKey": "reports/r1/overlay.png", "imageryKey": "imagery/x.png"},
        "full",
        "v1.0",
    )
    assert set(result.keys()) == _CONTRACT_KEYS
    assert result["tier"] == "full"
    assert result["modelVersion"] == "v1.0"
    assert result["pdfKey"] == "reports/r1/report.pdf"
    assert result["overlayKey"] == "reports/r1/overlay.png"
    assert result["imageryKey"] == "imagery/x.png"
    assert result["wasteFactor"] == 12.0
    assert result["confidenceScore"] == 0.9

    for f in result["facets"]:
        assert set(f.keys()) == _FACET_KEYS


def test_num_facets_matches_list_length():
    facets = _sample_facets()
    result = assemble_result(
        _measurements(), facets, [], {}, "full", "v1.0"
    )
    assert result["numFacets"] == len(facets) == len(result["facets"])
    # missing keys default to None
    assert result["pdfKey"] is None
    assert result["overlayKey"] is None
    assert result["imageryKey"] is None


def test_edge_index_mapping_by_facet_index():
    facets = _sample_facets()
    edges = [
        {
            "edge_type": "ridge",
            "length_ft": 30.0,
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            "left_facet_id": 0,   # references facet_index 0 -> result index 0
            "right_facet_id": 1,  # references facet_index 1 -> result index 1
        },
        {
            "edge_type": "eave",
            "length_ft": 10.0,
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 0]]},
            "left_facet_id": None,
            "right_facet_id": None,
        },
    ]
    result = assemble_result(_measurements(), facets, edges, {}, "full", "v1.0")

    assert len(result["edges"]) == 2
    for e in result["edges"]:
        assert set(e.keys()) == _EDGE_KEYS

    assert result["edges"][0]["leftFacetIndex"] == 0
    assert result["edges"][0]["rightFacetIndex"] == 1
    assert result["edges"][1]["leftFacetIndex"] is None
    assert result["edges"][1]["rightFacetIndex"] is None


def test_edge_index_mapping_by_facet_object():
    facets = _sample_facets()
    # Reference the actual facet objects (identity-based mapping)
    edges = [
        {
            "edge_type": "hip",
            "length_ft": 15.0,
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [2, 2]]},
            "left_facet_id": facets[1],
            "right_facet_id": facets[0],
        },
    ]
    result = assemble_result(_measurements(), facets, edges, {}, "full", "v1.0")
    assert result["edges"][0]["leftFacetIndex"] == 1
    assert result["edges"][0]["rightFacetIndex"] == 0
