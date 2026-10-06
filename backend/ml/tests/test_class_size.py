import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.ml.class_size import (
    FEATURES,
    FORBIDDEN_FEATURES,
    generate_synthetic_dataset,
    predict_class_sizes,
    train_class_size_models,
    validate_features_no_leakage,
)
from backend.ml.main import app


@pytest.fixture(scope="module")
def synthetic_csv(tmp_path_factory):
    path = tmp_path_factory.mktemp("cs") / "syn.csv"
    generate_synthetic_dataset().to_csv(path, index=False)
    return path


def test_synthetic_dataset_is_flagged_and_sized():
    df = generate_synthetic_dataset()
    assert 1800 <= len(df) <= 2300
    assert set(df["data_origin"]) == {"SYNTHETIC"}
    # class sizes of one subject-year add up to the demand (within rounding) and respect room/teacher max
    assert (df["class_size"] <= df[["room_capacity", "teacher_max"]].min(axis=1) + 1).all()


def test_features_have_no_outcome_leakage():
    assert not FORBIDDEN_FEATURES.intersection(FEATURES)
    with pytest.raises(ValueError):
        validate_features_no_leakage(FEATURES + ["class_size"])


def test_training_reports_metrics_and_chronological_split(synthetic_csv):
    report = train_class_size_models(csv_path=synthetic_csv)
    assert report["split"].startswith("chronological")
    assert not set(report["train_years"]) & set(report["test_years"])
    for name in ("equal_distribution", "preferred_proportional", "random_forest", "xgboost"):
        assert {"mae", "rmse", "r2"} <= set(report["metrics"][name])
    assert report["beats_equal_distribution"] is True


def test_predict_endpoint_is_pure_and_returns_per_teacher():
    client = TestClient(app)
    body = {
        "requests": [
            {
                "subject_code": "CS302",
                "student_demand": 60,
                "is_lab": 0,
                "credits": 3,
                "semester": 5,
                "room_capacity": 70,
                "teachers": [
                    {"staff_id": "A", "teacher_preferred": 30, "teacher_max": 40},
                    {"staff_id": "B", "teacher_preferred": 20, "teacher_max": 30},
                ],
            }
        ]
    }
    res = client.post("/api/forecast/class-size/predict", json=body)
    assert res.status_code == 200
    preds = {p["staff_id"]: p["predicted_students"] for p in res.json()["predictions"]}
    assert preds["A"] > preds["B"] > 0
