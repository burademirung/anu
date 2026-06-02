"""PDF reporter and overlay generator for the Anu ML service."""

from __future__ import annotations

import io
from typing import List, Optional

import numpy as np
from PIL import Image, ImageDraw

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

from app import config


_FACET_COLORS = [
    (255, 80, 80, 140),
    (80, 200, 80, 140),
    (80, 150, 255, 140),
    (255, 200, 80, 140),
    (200, 80, 255, 140),
    (80, 220, 220, 140),
]


def assemble(
    measurements: dict,
    roof_polygons: List[dict],
    facets: List[dict],
    edges: List[dict],
    tier: str,
    img_metadata,
) -> dict:
    """Assemble a report_data dict suitable for db.save_report()."""
    roof_area_sqft = measurements.get("roof_area_sqft", 0.0)
    roof_area_squares = measurements.get("roof_area_squares", 0.0)
    waste_factor = measurements.get("waste_factor")
    confidence_score = measurements.get("confidence_score", 0.7)
    num_structures = measurements.get("num_structures", len(roof_polygons))
    num_facets = measurements.get("num_facets", len(facets))

    enriched_facets = []
    for idx, f in enumerate(facets):
        ef = dict(f)
        ef.setdefault("structure_index", 0)
        ef.setdefault("facet_index", idx)
        enriched_facets.append(ef)

    return {
        "tier": tier,
        "model_version": config.ML_MODEL_VERSION,
        "roof_area_sqft": round(roof_area_sqft, 2),
        "roof_area_squares": roof_area_squares,
        "num_facets": num_facets,
        "num_structures": num_structures,
        "waste_factor": waste_factor,
        "confidence_score": confidence_score,
        "facets": enriched_facets,
        "edges": edges,
        "imagery_source": img_metadata.source if img_metadata else None,
        "imagery_capture_date": img_metadata.capture_date if img_metadata else None,
    }


def to_pdf(report_data: dict, image: Optional[np.ndarray] = None, overlay_bytes: Optional[bytes] = None) -> bytes:
    """Generate a PDF report using ReportLab, including the map overlay image."""
    from reportlab.platypus import Image as RLImage

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, topMargin=0.4 * inch, bottomMargin=0.4 * inch)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle("Title2", parent=styles["Title"], fontSize=20, spaceAfter=4)
    section_style = ParagraphStyle("Section", parent=styles["Heading2"], fontSize=13, spaceAfter=6)
    tier_badge_style = ParagraphStyle("Tier", parent=styles["Normal"], fontSize=11, textColor=colors.HexColor("#1a73e8"))

    story = []
    story.append(Paragraph("Anu Roof Measurement Report", title_style))
    story.append(Spacer(1, 0.1 * inch))

    tier = report_data.get("tier", "basic").upper()
    story.append(Paragraph(f"Tier: {tier}", tier_badge_style))
    story.append(Spacer(1, 0.1 * inch))

    # Embed the overlay map image
    if overlay_bytes:
        overlay_buf = io.BytesIO(overlay_bytes)
        map_img = RLImage(overlay_buf, width=5.5 * inch, height=5.5 * inch)
        story.append(map_img)
        story.append(Spacer(1, 0.15 * inch))

    story.append(Paragraph("Summary", section_style))

    summary_data = [
        ["Metric", "Value"],
        ["Roof Area (sq ft)", f"{report_data.get('roof_area_sqft', 0):.0f}"],
        ["Roofing Squares", f"{report_data.get('roof_area_squares', 0):.1f}"],
        ["Structures", str(report_data.get("num_structures", 0))],
        ["Facets", str(report_data.get("num_facets", 0))],
        ["Waste Factor (%)", f"{report_data['waste_factor']:.1f}" if report_data.get('waste_factor') is not None else "N/A"],
        ["Confidence", f"{report_data.get('confidence_score', 0):.0%}"],
    ]

    summary_table = Table(summary_data, colWidths=[3 * inch, 3.5 * inch])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a73e8")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 0.2 * inch))

    # Facet details
    facet_list = report_data.get("facets", [])
    if facet_list:
        story.append(Paragraph("Facet Details", section_style))
        facet_data = [["#", "Area (sqft)", "Pitch", "Orientation"]]
        for f in facet_list:
            facet_data.append([
                str(f.get("facet_index", 0) + 1),
                f"{f.get('area_sqft', 0):.0f}",
                str(f.get("pitch") or "N/A"),
                str(f.get("orientation") or "N/A"),
            ])
        ft = Table(facet_data, colWidths=[0.5 * inch, 2 * inch, 1.5 * inch, 2 * inch])
        ft.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#333333")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
        ]))
        story.append(ft)

    story.append(Spacer(1, 0.3 * inch))
    story.append(Paragraph(
        f"Generated by Anu model {report_data.get('model_version', 'v1.0')}",
        styles["Normal"],
    ))

    doc.build(story)
    return buf.getvalue()


def to_overlay(
    image: np.ndarray,
    roof_polygons: List[dict],
    facets: List[dict],
    image_bbox: tuple = None,
) -> bytes:
    """Draw building outline over the aerial image.

    If polygons are in lat/lon (from OSM), image_bbox must be provided
    to convert geographic coordinates to pixel positions.

    Args:
        image: HxWx3 uint8 numpy array (RGB).
        roof_polygons: GeoJSON Polygon dicts.
        facets: Facet dicts with 'polygon' key.
        image_bbox: (min_lon, min_lat, max_lon, max_lat) of the image extent.
    """
    h, w = image.shape[:2]
    pil_img = Image.fromarray(image.astype(np.uint8)).convert("RGBA")
    overlay = Image.new("RGBA", pil_img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    def geo_to_pixel(lon_val, lat_val):
        """Convert lat/lon to pixel coordinates given image bbox."""
        if image_bbox is None:
            return float(lon_val), float(lat_val)  # assume already pixel coords
        min_lon, min_lat, max_lon, max_lat = image_bbox
        x = (lon_val - min_lon) / (max_lon - min_lon) * w
        y = (max_lat - lat_val) / (max_lat - min_lat) * h  # y is flipped
        return x, y

    def is_geo_coords(coords):
        """Check if coordinates are geographic (lat/lon) vs pixel."""
        if not coords:
            return False
        # Lon values are typically -180 to 180, pixel values 0 to 1024
        return any(abs(c[0]) > 180 or abs(c[0]) < -180 or
                   -90 <= c[1] <= 90 for c in coords[:3]
                   if len(c) >= 2 and abs(c[0]) < 360)

    # Draw building outlines with thick colored borders + filled
    for idx, facet in enumerate(facets):
        polygon = facet.get("polygon")
        if not polygon:
            continue
        coords = polygon.get("coordinates", [[]])[0]
        if len(coords) < 3:
            continue

        if is_geo_coords(coords):
            xy = [geo_to_pixel(c[0], c[1]) for c in coords]
        else:
            xy = [(float(c[0]), float(c[1])) for c in coords]

        color = _FACET_COLORS[idx % len(_FACET_COLORS)]
        draw.polygon(xy, fill=color, outline=(255, 255, 255, 255))

    # Draw red outlines for roof polygons
    for polygon in roof_polygons:
        coords = polygon.get("coordinates", [[]])[0]
        if len(coords) < 2:
            continue

        if is_geo_coords(coords):
            xy = [geo_to_pixel(c[0], c[1]) for c in coords]
        else:
            xy = [(float(c[0]), float(c[1])) for c in coords]

        draw.line(xy + [xy[0]], fill=(255, 0, 0, 255), width=3)

    # Add label
    try:
        draw.text((10, 10), "Assessed Building", fill=(255, 0, 0, 255))
    except Exception:
        pass

    composite = Image.alpha_composite(pil_img, overlay)

    # Crop to zoom in on the building (find drawn polygon bounds + padding)
    all_coords = []
    for facet in facets:
        polygon = facet.get("polygon")
        if not polygon:
            continue
        coords = polygon.get("coordinates", [[]])[0]
        if image_bbox and coords:
            for c in coords:
                all_coords.append(geo_to_pixel(c[0], c[1]))
        elif coords:
            all_coords.extend([(float(c[0]), float(c[1])) for c in coords])

    if all_coords:
        xs = [c[0] for c in all_coords]
        ys = [c[1] for c in all_coords]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        # Zoom: building size + 3x padding
        bw = max(xs) - min(xs)
        bh = max(ys) - min(ys)
        pad = max(bw, bh, 80) * 1.5
        crop_left = max(0, int(cx - pad))
        crop_top = max(0, int(cy - pad))
        crop_right = min(w, int(cx + pad))
        crop_bottom = min(h, int(cy + pad))
        composite = composite.crop((crop_left, crop_top, crop_right, crop_bottom))
        # Resize to reasonable display size
        composite = composite.resize((800, 800), Image.LANCZOS)

    buf = io.BytesIO()
    composite.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()
