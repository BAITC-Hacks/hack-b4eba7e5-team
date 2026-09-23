"""Граница Нуры не должна повторно выделяться как часть Есиля."""

import json
import math
from itertools import pairwise
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DISTRICTS = json.loads((ROOT / "frontend/src/data/districts.json").read_text())
FEATURES = {feature["id"]: feature for feature in DISTRICTS["features"]}


def polygons(feature):
    geometry = feature["geometry"]
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    assert geometry["type"] == "MultiPolygon"
    return geometry["coordinates"]


def inside_ring(point, ring):
    x, y = point
    inside = False
    for (ax, ay), (bx, by) in pairwise(ring):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return inside


def contains(feature, point):
    return any(
        inside_ring(point, polygon[0]) and not any(inside_ring(point, hole) for hole in polygon[1:])
        for polygon in polygons(feature)
    )


def ring_area(ring):
    # Сдвиг начала координат уменьшает погрешность для маленьких колец.
    ox, oy = ring[0]
    return (
        abs(math.fsum((ax - ox) * (by - oy) - (bx - ox) * (ay - oy) for (ax, ay), (bx, by) in pairwise(ring)))
        / 2
    )


def test_district_ids_match_case_data():
    dataset = json.loads((ROOT / "docs/dataset.json").read_text())
    names = {district["id"]: district["name"] for district in dataset["districts"]}
    assert DISTRICTS["type"] == "FeatureCollection"
    assert len(FEATURES) == len(DISTRICTS["features"]) == 6
    assert set(FEATURES) == set(names) | {"sarayshyk"}
    for district_id, feature in FEATURES.items():
        properties = feature["properties"]
        assert properties["id"] == district_id
        assert properties["case_district"] is (district_id in names)
        if district_id in names:
            assert properties["name"] == names[district_id]
        assert contains(feature, properties["label_point"])


@pytest.mark.parametrize(
    ("district_id", "point"),
    [
        # Точки строго внутри трёх пересечений исходного Есиля.
        ("nura", (71.31603618965619, 51.1008961)),
        ("baikonur", (71.428376469375, 51.15179875)),
        ("saryarka", (71.42817782997935, 51.1519612)),
        ("yesil", (71.46458522327926, 51.0399738)),
        # Отдельные части MultiPolygon нельзя удалять как дубли.
        ("almaty", (71.76886129088197, 51.15387925)),
        ("baikonur", (71.31733800947865, 51.28433265)),
        ("baikonur", (71.66573768103129, 51.3302766)),
        ("yesil", (71.40464334056625, 50.87198835)),
        ("sarayshyk", (71.56586805666397, 51.1127271)),
    ],
)
def test_each_regression_point_belongs_to_one_district(district_id, point):
    assert [key for key, feature in FEATURES.items() if contains(feature, point)] == [district_id]


def test_district_coverage_and_detached_parts_are_preserved():
    assert {key: len(polygons(feature)) for key, feature in FEATURES.items()} == {
        "almaty": 2,
        "baikonur": 3,
        "yesil": 2,
        "saryarka": 1,
        "nura": 1,
        "sarayshyk": 1,
    }
    area = 0
    for feature in FEATURES.values():
        coordinates = []
        for polygon in polygons(feature):
            for ring in polygon:
                assert len(ring) >= 4 and ring[0] == ring[-1]
                assert all(len(point) == 2 and all(math.isfinite(value) for value in point) for point in ring)
                coordinates.extend(ring)
            area += ring_area(polygon[0]) - sum(ring_area(hole) for hole in polygon[1:])
        assert feature["properties"]["bounds"] == [
            min(point[0] for point in coordinates),
            min(point[1] for point in coordinates),
            max(point[0] for point in coordinates),
            max(point[1] for point in coordinates),
        ]
    # Площадь объединения исходных шести геометрий, измеренная при импорте.
    assert area == pytest.approx(0.10276142071370954, abs=1e-12, rel=0)
