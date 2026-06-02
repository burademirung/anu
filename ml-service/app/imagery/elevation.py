from __future__ import annotations

from typing import Optional, Tuple

import numpy as np

# USGS 3DEP LiDAR EPT endpoint (public S3 bucket)
_EPT_ROOT = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public/USGS_LPC_CONUS/ept.json"


def fetch_3dep(
    bbox: Tuple[float, float, float, float],
) -> Optional[np.ndarray]:
    """Fetch USGS 3DEP LiDAR point cloud for *bbox* using PDAL.

    Tries to use PDAL (``pdal`` Python bindings).  If PDAL is not installed
    the function silently returns ``None`` so the pipeline can degrade
    gracefully (PDAL is only available inside Docker).

    Args:
        bbox: ``(min_lon, min_lat, max_lon, max_lat)`` in WGS-84 degrees.

    Returns:
        Nx3 float32 numpy array of (X, Y, Z) points in WGS-84 / EPSG:4326,
        or ``None`` if PDAL is unavailable or the fetch fails.
    """
    try:
        import pdal  # noqa: F401 — may not be installed locally
    except ImportError:
        return None

    min_lon, min_lat, max_lon, max_lat = bbox

    # Build PDAL pipeline as a JSON string
    pipeline_json = f"""
    {{
        "pipeline": [
            {{
                "type": "readers.ept",
                "filename": "{_EPT_ROOT}",
                "bounds": "([ {min_lon}, {max_lon}], [{min_lat}, {max_lat}])"
            }},
            {{
                "type": "filters.reprojection",
                "in_srs": "EPSG:3857",
                "out_srs": "EPSG:4326"
            }}
        ]
    }}
    """

    try:
        pipeline = pdal.Pipeline(pipeline_json)
        pipeline.execute()
        arrays = pipeline.arrays
        if not arrays or len(arrays[0]) == 0:
            return None
        arr = arrays[0]
        x = arr["X"].astype(np.float32)
        y = arr["Y"].astype(np.float32)
        z = arr["Z"].astype(np.float32)
        return np.column_stack([x, y, z])
    except Exception:
        return None
