from app.utils.geo import property_bbox, location_hash, polygon_area_sqft, pitch_to_rise_run, area_with_pitch


def test_property_bbox():
    bbox = property_bbox(39.7392, -104.9903, size_m=40)
    min_lon, min_lat, max_lon, max_lat = bbox
    assert min_lat < 39.7392 < max_lat
    assert min_lon < -104.9903 < max_lon


def test_location_hash_deterministic():
    h1 = location_hash(39.7392, -104.9903)
    h2 = location_hash(39.7392, -104.9903)
    assert h1 == h2
    assert len(h1) == 12


def test_polygon_area_sqft():
    square = [[0, 0], [100, 0], [100, 100], [0, 100]]
    area = polygon_area_sqft(square, gsd=0.6)
    assert 38_000 < area < 39_500  # 60m x 60m ≈ 38,750 sqft


def test_pitch_to_rise_run():
    assert pitch_to_rise_run(26.57) == "6/12"


def test_area_with_pitch():
    surface = area_with_pitch(1000.0, 26.57)
    assert surface > 1000.0
