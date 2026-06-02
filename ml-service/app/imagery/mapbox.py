from __future__ import annotations

import io
import math
from typing import Optional, Tuple

import numpy as np
import requests

from app.config import MAPBOX_ACCESS_TOKEN
from app.imagery.naip import ImageryMetadata


def fetch_mapbox(
    lat: float,
    lon: float,
    zoom: int = 18,
    size: int = 1024,
) -> Optional[Tuple[np.ndarray, ImageryMetadata]]:
    """Fetch satellite imagery from the Mapbox Static Images API.

    Returns (HxWx3 RGB numpy array, ImageryMetadata) or None on failure.

    GSD (metres/pixel) is approximated as:
        156543.03 * cos(lat_rad) / 2^zoom
    """
    if not MAPBOX_ACCESS_TOKEN:
        return None

    gsd = 156543.03 * math.cos(math.radians(lat)) / (2 ** zoom)

    url = (
        f"https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/"
        f"{lon},{lat},{zoom}/{size}x{size}"
        f"?access_token={MAPBOX_ACCESS_TOKEN}"
    )

    try:
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
    except requests.RequestException:
        return None

    try:
        from PIL import Image

        img = Image.open(io.BytesIO(resp.content)).convert("RGB")
        array = np.array(img)
    except Exception:
        return None

    metadata = ImageryMetadata(source="mapbox", gsd=gsd, capture_date=None)
    return array, metadata
