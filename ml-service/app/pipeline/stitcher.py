"""Image normalization for the ML pipeline.

With COG windowed reads, the NAIP fetcher already returns a ~1000x1000
image at native resolution. This module just resizes to the exact
target size the U-Net expects.
"""
from __future__ import annotations

import numpy as np
from typing import Tuple
from PIL import Image as PILImage

PILImage.MAX_IMAGE_PIXELS = 300_000_000


def normalize(image: np.ndarray, target_size: int = 1024) -> Tuple[np.ndarray, float]:
    """Resize image to target_size x target_size.

    Returns:
        (resized_image, scale_factor) where scale_factor = original_width / target_size.
        Effective GSD = original_gsd * scale_factor.
    """
    original_width = image.shape[1]
    scale_factor = original_width / target_size

    pil_img = PILImage.fromarray(image.astype(np.uint8))
    pil_img = pil_img.resize((target_size, target_size), PILImage.LANCZOS)
    return np.array(pil_img), scale_factor
