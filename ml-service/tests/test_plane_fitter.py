import numpy as np
import pytest
from app.pipeline.plane_fitter import fit, _normal_to_pitch


def test_fit_single_plane():
    np.random.seed(42)
    n = 200
    x = np.random.uniform(0, 10, n)
    y = np.random.uniform(0, 10, n)
    z = 5.0 + 0.5 * x + np.random.normal(0, 0.05, n)
    points = np.column_stack([x, y, z])
    planes = fit(points, threshold=0.2)
    assert len(planes) >= 1


def test_normal_to_pitch_horizontal():
    assert _normal_to_pitch(np.array([0, 0, 1])) == 0.0


def test_normal_to_pitch_45():
    normal = np.array([0, np.sin(np.radians(45)), np.cos(np.radians(45))])
    assert pytest.approx(_normal_to_pitch(normal), abs=1.0) == 45.0
