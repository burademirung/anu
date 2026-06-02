from app.pipeline.measurer import _calculate_waste


def test_waste_simple_gable():
    assert _calculate_waste(0, 0, 20.0, 2) == 10.0


def test_waste_hip_roof():
    assert _calculate_waste(0, 4, 26.57, 4) == 14.0


def test_waste_complex_capped():
    assert _calculate_waste(3, 6, 40.0, 8) == 25.0


def test_waste_steep():
    assert _calculate_waste(0, 0, 35.0, 2) == 13.0
