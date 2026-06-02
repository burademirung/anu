"""Fetch building footprints from OpenStreetMap via Overpass API.

Replaces U-Net segmentation with pre-existing building outlines.
OSM has building footprints for most US addresses, contributed by
Microsoft Building Footprints imports and community mappers.

Returns precise building polygons with accurate area — no ML needed.
"""
from __future__ import annotations

import logging
import math
from typing import List, Optional

import requests
from shapely.geometry import Point, Polygon

logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def fetch_building_footprints(
    lat: float, lon: float, radius_m: float = 100
) -> List[dict]:
    """Query OSM Overpass API for building footprints near a location.

    Args:
        lat: Latitude of the property.
        lon: Longitude of the property.
        radius_m: Search radius in meters (default 100m).

    Returns:
        List of building dicts sorted by distance from (lat, lon), closest first.
        Each dict has: polygon (GeoJSON), footprint_area_sqft, address, distance_m, vertices.
    """
    query = f"""
    [out:json][timeout:25];
    (
      way["building"](around:{radius_m},{lat},{lon});
      relation["building"](around:{radius_m},{lat},{lon});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.warning("Overpass API request failed: %s", e)
        return []

    data = resp.json()
    elements = data.get("elements", [])

    # Build node lookup
    nodes = {}
    for el in elements:
        if el.get("type") == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])

    # Extract buildings
    point = Point(lon, lat)
    buildings = []

    for el in elements:
        if el.get("type") != "way":
            continue
        tags = el.get("tags", {})
        if "building" not in tags:
            continue

        # Get coordinates from node references
        node_ids = el.get("nodes", [])
        coords = [(nodes[n][0], nodes[n][1]) for n in node_ids if n in nodes]

        if len(coords) < 3:
            continue

        try:
            poly = Polygon(coords)
            if not poly.is_valid:
                poly = poly.buffer(0)
        except Exception:
            continue

        # Calculate area in sq ft
        # At this latitude, 1 degree lat ≈ 111km, 1 degree lon ≈ 111km * cos(lat)
        cos_lat = math.cos(math.radians(lat))
        area_m2 = poly.area * (111_000 ** 2) * cos_lat
        area_sqft = area_m2 * 10.7639

        # Distance from geocoded point
        distance_m = point.distance(poly) * 111_000 * cos_lat

        # Address from OSM tags
        addr_parts = []
        if tags.get("addr:housenumber"):
            addr_parts.append(tags["addr:housenumber"])
        if tags.get("addr:street"):
            addr_parts.append(tags["addr:street"])
        address = " ".join(addr_parts) if addr_parts else None

        # Convert to GeoJSON polygon (pixel coords will be set later)
        geojson_coords = [[c[0], c[1]] for c in coords]
        if geojson_coords[0] != geojson_coords[-1]:
            geojson_coords.append(geojson_coords[0])  # close ring

        buildings.append({
            "polygon": {
                "type": "Polygon",
                "coordinates": [geojson_coords],
            },
            "footprint_area_sqft": round(area_sqft, 1),
            "area_sqft": round(area_sqft, 1),
            "address": address,
            "distance_m": round(distance_m, 1),
            "num_vertices": len(coords),
        })

    # Check if any building polygon CONTAINS the geocoded point
    # (most accurate — the point is inside the building footprint)
    for b in buildings:
        coords = b["polygon"].get("coordinates", [[]])[0]
        if len(coords) >= 3:
            poly = Polygon([(c[0], c[1]) for c in coords])
            if poly.contains(point):
                b["distance_m"] = 0.0  # inside the building
                b["_contains_point"] = True

    # Sort: buildings containing the point first, then by distance
    buildings.sort(key=lambda b: (not b.get("_contains_point", False), b["distance_m"]))

    logger.info(
        "Found %d buildings within %dm of (%.4f, %.4f)",
        len(buildings), radius_m, lat, lon,
    )
    if buildings:
        closest = buildings[0]
        logger.info(
            "Closest: %s — %.0f sqft, %.0fm away",
            closest.get("address") or "unnamed",
            closest["footprint_area_sqft"],
            closest["distance_m"],
        )

    return buildings


def get_property_building(
    lat: float, lon: float, address: str = "", max_distance_m: float = 80
) -> Optional[dict]:
    """Get the building footprint for a specific property.

    First tries to match by address in OSM tags. If no address match,
    falls back to the closest building within max_distance_m.
    """
    buildings = fetch_building_footprints(lat, lon, radius_m=150)

    if not buildings:
        return None

    # PRIORITY 1: Building whose polygon CONTAINS the geocoded point
    # This is the most reliable — the geocoder puts the pin inside the building
    for b in buildings:
        if b.get("_contains_point"):
            logger.info("Contains-point match: %s — %.0f sqft",
                        b.get("address") or "unnamed", b["footprint_area_sqft"])
            return b

    # PRIORITY 2: Address match (house number + street name)
    if address:
        parts = address.strip().split()
        house_number = parts[0] if parts and parts[0].isdigit() else None
        street_word = parts[1].lower() if len(parts) > 1 else ""

        for b in buildings:
            b_addr = b.get("address") or ""
            if house_number and street_word:
                if house_number in b_addr and street_word in b_addr.lower():
                    logger.info("Address match: %s", b_addr)
                    return b

    # PRIORITY 3: Closest building
    closest = buildings[0]
    if closest["distance_m"] > max_distance_m:
        logger.warning(
            "Nearest building is %.0fm away (max %dm) — may not be the right property",
            closest["distance_m"], max_distance_m,
        )
        closest["_low_confidence"] = True

    return closest
