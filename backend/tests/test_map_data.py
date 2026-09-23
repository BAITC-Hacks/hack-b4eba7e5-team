"""Объединение районов карты сохраняет покрытие и исходные ID расчёта."""

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
    assert names["almaty"] == "Алматы"
    display_names = names | {"almaty": "Алматы и Сарайшык"}
    assert DISTRICTS["type"] == "FeatureCollection"
    assert len(FEATURES) == len(DISTRICTS["features"]) == 5
    assert set(FEATURES) == set(names)
    for district_id, feature in FEATURES.items():
        properties = feature["properties"]
        assert properties["id"] == district_id
        assert properties["case_district"] is True
        assert properties["name"] == display_names[district_id]
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
        # Основные территории Алматы и Сарайшыка выбирают один район кейса.
        ("almaty", (71.54731723372703, 51.1550554)),
        ("almaty", (71.56586805666397, 51.1127271)),
    ],
)
def test_each_regression_point_belongs_to_one_district(district_id, point):
    assert [key for key, feature in FEATURES.items() if contains(feature, point)] == [district_id]


def test_almaty_union_dissolves_old_border_and_preserves_exterior():
    feature = FEATURES["almaty"]
    properties = feature["properties"]
    assert properties["merged_from"] == ["almaty", "sarayshyk"]
    assert properties["osm_id"] == 3482819
    assert properties["osm_ids"] == [3482819, 19733918]
    assert properties["label_point"] == [71.56586805666397, 51.1127271]
    assert feature["geometry"]["type"] == "MultiPolygon"
    assert len(polygons(feature)) == 2

    # В середине прежней общей границы теперь внутренняя область одного полигона.
    point = (71.57690068414514, 51.13394477660166)
    assert contains(feature, point)
    perimeter = 0
    area = 0
    for polygon in polygons(feature):
        assert len(polygon) == 1
        area += ring_area(polygon[0])
        for start, end in pairwise(polygon[0]):
            dx, dy = end[0] - start[0], end[1] - start[1]
            length = math.hypot(dx, dy)
            perimeter += length
            projection = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length**2
            fraction = min(1, max(0, projection))
            nearest = (start[0] + fraction * dx, start[1] + fraction * dy)
            assert math.dist(point, nearest) > 0.03
    # Метрики объединения исходных областей без их общей внутренней границы.
    assert area == pytest.approx(0.019881103949005025, abs=1e-12, rel=0)
    assert perimeter == pytest.approx(0.8961629432247398, abs=1e-12, rel=0)


def test_district_coverage_and_detached_parts_are_preserved():
    assert {key: len(polygons(feature)) for key, feature in FEATURES.items()} == {
        "almaty": 2,
        "baikonur": 3,
        "yesil": 2,
        "saryarka": 1,
        "nura": 1,
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
