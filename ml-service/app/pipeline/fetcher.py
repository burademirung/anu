from __future__ import annotations

from typing import Tuple

import numpy as np

from app.imagery.naip import ImageryMetadata, fetch_naip
from app.imagery.mapbox import fetch_mapbox


def fetch(
    lat: float, lon: float, bbox: Tuple[float, float, float, float]
) -> Tuple[np.ndarray, ImageryMetadata]:
    """Fetch imagery for the given location.

    Tries NAIP (Planetary Computer) first; falls back to Mapbox satellite.
    Raises RuntimeError if both sources fail.
    """
    result = fetch_naip(lat, lon, bbox)
    if result is not None:
        return result

    result = fetch_mapbox(lat, lon)
    if result is not None:
        return result

    raise RuntimeError(
        f"All imagery sources failed for lat={lat}, lon={lon}"
    )
