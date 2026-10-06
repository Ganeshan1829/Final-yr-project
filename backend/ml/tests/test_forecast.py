import io
import json
import math
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.ml.features import (
    ALL_FEATURES,
    FORBIDDEN_FEATURES,
    compute_lag_features,
    validate_features_no_leakage,
)
from backend.ml.model import DemandForecastModel
from backend.ml.main import app
from backend.ml.service import (
    get_section_plan,
    seed_historical_data,
    import_historical_year,
    train_demand_model,
    generate_predictions,
    get_forecast_status,
    promote_model_version,
)
from backend.ml.db import db_session, ensure_tables

@pytest.fixture(autouse=True)
def setup_db():
    ensure_tables()

def test_leakage_guard_forbidden_features():
    """
    CRITICAL TEST:
    Enforce that sections_opened, avg_section_size, staff_shortfall, split,
    record_id, is_synthetic are NEVER in feature set.
    """
    forbidden = {
        "sections_opened",
        "avg_section_size",
        "staff_shortfall",
        "split",
        "record_id",
        "is_synthetic",
        "registered_students",
    }

    # 1. Assert ALL_FEATURES does not contain any forbidden column
    for col in forbidden:
        assert col not in ALL_FEATURES, f"Leakage detected: {col} is in ALL_FEATURES"

    # 2. Assert validator raises on forbidden columns
    for col in forbidden:
        with pytest.raises(ValueError, match="LEAKAGE GUARD VIOLATION"):
            validate_features_no_leakage([col, "cohort_size"])

    # 3. Model feature list must not have forbidden features
    model = DemandForecastModel()
    for col in forbidden:
        assert col not in model.feature_names_

def test_lag_features_and_missing_stays_nan():
    """
    Test that prev_year_registered, prev2_year_registered, and registered_trend_3y
    are built strictly from historical values, and missing lags stay NaN.
    """
    records = [
        {
            "academic_year": "2023-24", "term": "Odd", "department": "CSE",
            "semester_no": 3, "subject_code": "CS301", "subject_name": "Data Structures",
            "course_type": "core", "cohort_size": 100, "registered_students": 95,
        },
        {
            "academic_year": "2024-25", "term": "Odd", "department": "CSE",
            "semester_no": 3, "subject_code": "CS301", "subject_name": "Data Structures",
            "course_type": "core", "cohort_size": 100, "registered_students": 110,
        },
        {
            "academic_year": "2025-26", "term": "Odd", "department": "CSE",
            "semester_no": 3, "subject_code": "CS301", "subject_name": "Data Structures",
            "course_type": "core", "cohort_size": 100, "registered_students": 130,
        },
    ]

    df = pd.DataFrame(records)
    df_lags = compute_lag_features(df)

    r23 = df_lags[df_lags["academic_year"] == "2023-24"].iloc[0]
    r24 = df_lags[df_lags["academic_year"] == "2024-25"].iloc[0]
    r25 = df_lags[df_lags["academic_year"] == "2025-26"].iloc[0]

    # Year 1 (2023-24): No prior years -> all lags must be NaN
    assert pd.isna(r23["prev_year_registered"])
    assert pd.isna(r23["prev2_year_registered"])
    assert pd.isna(r23["registered_trend_3y"])

    # Year 2 (2024-25): 1 prior year -> prev_year is 95, prev2 is NaN, trend is NaN
    assert r24["prev_year_registered"] == 95.0
    assert pd.isna(r24["prev2_year_registered"])
    assert pd.isna(r24["registered_trend_3y"])

    # Year 3 (2025-26): 2 prior years -> prev_year is 110, prev2 is 95, trend is (110 - 95) = 15
    assert r25["prev_year_registered"] == 110.0
    assert r25["prev2_year_registered"] == 95.0
    assert r25["registered_trend_3y"] == 15.0

def test_yearly_cycle_expanding_window():
    """
    Test expanding window time-split across cycles:
    - Cycle 1: target 2026-27 (train up to 2025-26)
    - Cycle 2: target 2027-28 (train up to 2026-27)
    - Cycle 3: target 2028-29 (train up to 2027-28)
    Rule: The year being predicted is NEVER in training. Split is strictly chronological.
    """
    # Create multi-year synthetic history
    rows = []
    years = ["2023-24", "2024-25", "2025-26", "2026-27", "2027-28"]
    for y in years:
        for subj in ["CS101", "CS102"]:
            rows.append({
                "academic_year": y, "term": "Odd", "department": "CSE",
                "semester_no": 1, "subject_code": subj, "subject_name": subj,
                "course_type": "core", "cohort_size": 120, "industry_demand_index": 50.0,
                "staff_available": 5, "registered_students": 110,
                "credits": 3, "has_lab": 0, "topic_category": "general",
                "topic_trend_index": 40.0, "rival_elective_trend": 0.0,
                "dept_placement_rate_prev": 80.0, "prereq_pass_rate": 85.0,
                "course_age_years": 5, "is_first_offering": 0, "covid_flag": 0,
            })
    df = pd.DataFrame(rows)
    df = compute_lag_features(df)

    model = DemandForecastModel({"n_estimators": 10})

    # Cycle 1: target 2026-27
    res1 = model.train_expanding_window(df, target_year="2026-27")
    assert "2026-27" not in res1["train_years"]
    assert "2026-27" not in res1["val_year"]
    assert res1["val_year"] == "2025-26"
    assert "2024-25" in res1["train_years"]

    # Cycle 2: target 2027-28
    res2 = model.train_expanding_window(df, target_year="2027-28")
    assert "2027-28" not in res2["train_years"]
    assert "2027-28" != res2["val_year"]
    assert res2["val_year"] == "2026-27"
    assert "2025-26" in res2["train_years"]

    # Cycle 3: target 2028-29
    res3 = model.train_expanding_window(df, target_year="2028-29")
    assert "2028-29" not in res3["train_years"]
    assert res3["val_year"] == "2027-28"
    assert "2026-27" in res3["train_years"]

def test_idempotent_import():
    """Test that importing a finished year replaces existing records without duplicates."""
    ensure_tables()

    csv_data = """academic_year,term,department,semester_no,subject_code,subject_name,course_type,cohort_size,registered_students
2024-25,Odd,CSE,1,CS101,Math I,core,100,98
2024-25,Odd,CSE,1,CS102,Prog C,core,100,95
"""
    # First import
    res1 = import_historical_year(csv_data.encode("utf-8"), "2024-25.csv")
    assert res1["rowCount"] == 2

    with db_session() as conn:
        cnt1 = conn.execute("SELECT COUNT(*) as c FROM enrollment_history WHERE academic_year = '2024-25'").fetchone()["c"]
        assert cnt1 == 2

    # Second import with updated student numbers
    csv_data_updated = """academic_year,term,department,semester_no,subject_code,subject_name,course_type,cohort_size,registered_students
2024-25,Odd,CSE,1,CS101,Math I,core,100,99
2024-25,Odd,CSE,1,CS102,Prog C,core,100,97
"""
    res2 = import_historical_year(csv_data_updated.encode("utf-8"), "2024-25.csv")
    assert res2["rowCount"] == 2

    with db_session() as conn:
        cnt2 = conn.execute("SELECT COUNT(*) as c FROM enrollment_history WHERE academic_year = '2024-25'").fetchone()["c"]
        assert cnt2 == 2  # Not 4! Idempotent replacement

        row = conn.execute("SELECT registered_students FROM enrollment_history WHERE academic_year = '2024-25' AND subject_code = 'CS101'").fetchone()
        assert row["registered_students"] == 99

def test_versioning_and_champion_rule():
    """
    Test versioning on retrain and champion promotion rules:
    - Retrain increments version (v1 -> v2)
    - Manual promote works
    """
    seed_res = seed_historical_data()
    assert seed_res["total_rows"] > 0

    # Train first model
    res1 = train_demand_model(target_year="2026-27")
    v1 = res1["model_version"]
    assert res1["is_champion"] is True

    # Train second model
    res2 = train_demand_model(target_year="2026-27")
    v2 = res2["model_version"]
    assert v2 != v1

    # Manual override promote
    promote_res = promote_model_version(v1, promoted_by="HOD")
    assert promote_res["success"] is True

    with db_session() as conn:
        champ = conn.execute("SELECT version FROM model_registry WHERE is_champion = 1").fetchone()
        assert champ["version"] == v1

def test_reproducibility():
    """Test that random_state=42 gives reproducible predictions and metrics."""
    with db_session() as conn:
        df = pd.read_sql_query("SELECT * FROM enrollment_history LIMIT 300", conn)

    if df.empty:
        seed_historical_data()
        with db_session() as conn:
            df = pd.read_sql_query("SELECT * FROM enrollment_history LIMIT 300", conn)

    m1 = DemandForecastModel({"n_estimators": 20, "random_state": 42})
    r1 = m1.train_expanding_window(df, target_year="2025-26")

    m2 = DemandForecastModel({"n_estimators": 20, "random_state": 42})
    r2 = m2.train_expanding_window(df, target_year="2025-26")

    assert r1["mae"] == r2["mae"]
    assert r1["rmse"] == r2["rmse"]

def test_section_plan_empty_when_no_run():
    """Hand-off for Module 3: /section-plan returns [] if no run exists."""
    with db_session() as conn:
        conn.execute("DELETE FROM forecast_predictions")

    client = TestClient(app)
    res = client.get("/api/forecast/section-plan")
    assert res.status_code == 200
    assert res.json() == []

def test_prediction_clipping_and_intervals():
    """Test predictions are clipped to [8, cohort_size], sections are ceil(pred / 30)."""
    seed_historical_data()
    pred_res = generate_predictions(target_year="2026-27", section_size=30)

    assert pred_res["count"] > 0
    for p in pred_res["predictions"]:
        cohort = p["cohort_size"]
        pred = p["predicted_registered"]
        low = p["low_interval"]
        high = p["high_interval"]
        sections = p["predicted_sections"]

        # Clip bounds
        assert 8 <= pred <= cohort
        assert 8 <= low <= cohort
        assert 8 <= high <= cohort
        assert low <= high

        # Section calculation
        assert sections == math.ceil(pred / 30.0)

def test_fastapi_endpoints():
    """Test all key FastAPI endpoints via TestClient."""
    client = TestClient(app)

    # 1. Status
    res_status = client.get("/api/forecast/status")
    assert res_status.status_code == 200
    assert "history_count" in res_status.json()

    # 2. Template
    res_temp = client.get("/api/forecast/history/template")
    assert res_temp.status_code == 200
    assert "academic_year" in res_temp.text

    # 3. Inputs
    res_inputs = client.get("/api/forecast/inputs?target_year=2026-27")
    assert res_inputs.status_code == 200
    assert "inputs" in res_inputs.json()

    # 4. Accuracy
    res_acc = client.get("/api/forecast/accuracy")
    assert res_acc.status_code == 200

    # 5. Models
    res_models = client.get("/api/forecast/models")
    assert res_models.status_code == 200

    # 6. Subject map
    res_map = client.get("/api/forecast/subject-map")
    assert res_map.status_code == 200
