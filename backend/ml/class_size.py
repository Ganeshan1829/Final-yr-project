"""
Teacher-level class-size prediction (advisory ML layer).

Architecture rule: this module is PURE. It never reads or writes the timetable database.
  historical data (CSV) -> ML model -> recommendation (JSON) -> TypeScript allocation engine
The backend stores the recommendation and the deterministic engine makes the final, constraint-checked decision.

Data: the training file is SYNTHETIC (generated here, every row flagged data_origin=SYNTHETIC). It encodes plausible
relationships (teacher comfort size, demand, room limits, lab effects) but does NOT represent real college data.
Replace it with real exports (same columns) when available.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

from backend.ml.config import MODELS_DIR, SEED_DIR

SYNTHETIC_FILE = SEED_DIR / "synthetic_class_allocations.csv"
MODEL_FILE = MODELS_DIR / "class_size_model.joblib"
METRICS_FILE = MODELS_DIR / "class_size_metrics.json"

# Attribute-based features (no teacher/subject IDs) so the model generalises to any teacher.
FEATURES: List[str] = [
    "student_demand",          # students expected for the subject this year
    "n_teachers",              # teachers available for the subject
    "equal_share",             # student_demand / n_teachers (baseline value, also a feature)
    "prev_enrollment",         # subject enrollment last year
    "prev_class_size",         # this teacher's class size for the subject last year (NaN if none)
    "teacher_preferred",       # teacher feedback: preferred class size
    "teacher_max",             # teacher feedback: maximum manageable
    "subject_experience_years",
    "feedback_overcrowd_rate", # share of past classes the teacher flagged as overcrowded
    "feedback_interaction",    # mean interaction quality (1-5) from past feedback
    "hist_attendance",         # teacher's mean attendance in past classes
    "prev_allocation_share",   # teacher's share of the subject last year (NaN if none)
    "is_lab",
    "credits",
    "semester",
    "year_index",
    "room_capacity",
]

# Columns that describe the outcome and must never be used as inputs.
FORBIDDEN_FEATURES = {"class_size", "attendance_rate", "data_origin", "teacher_id", "subject_code"}


def validate_features_no_leakage(features: List[str]) -> None:
    bad = FORBIDDEN_FEATURES.intersection(features)
    if bad:
        raise ValueError(f"Forbidden/leaky features in model input: {sorted(bad)}")


# --------------------------------------------------------------------------------------
# Synthetic data
# --------------------------------------------------------------------------------------
def generate_synthetic_dataset(seed: int = 7, n_subjects: int = 48, n_teachers: int = 46) -> pd.DataFrame:
    """~2,000 rows: one row per (academic_year, subject, teacher) with realistic dependencies."""
    rng = np.random.default_rng(seed)
    years = [f"{y}-{str(y + 1)[2:]}" for y in range(2012, 2026)]

    teachers = []
    for i in range(n_teachers):
        pref = int(rng.choice([18, 20, 22, 25, 28, 30, 32, 35, 38, 40], p=[.06, .1, .1, .14, .12, .16, .1, .1, .06, .06]))
        teachers.append(
            {
                "teacher_id": f"T{i + 1:03d}",
                "preferred": pref,
                "max": pref + int(rng.integers(5, 13)),
                "experience": float(rng.uniform(1, 25)),
                "interaction_base": float(rng.uniform(3.0, 4.8)),
                "crowd_sens": float(rng.uniform(0.5, 1.5)),
            }
        )

    departments = ["CSE", "ECE", "MECH", "CIVIL", "MATH"]
    subjects = []
    for j in range(n_subjects):
        is_lab = int(rng.random() < 0.25)
        subjects.append(
            {
                "subject_code": f"SYN{j + 1:03d}",
                "department": departments[j % len(departments)],
                "semester": int(rng.integers(1, 9)),
                "credits": int(rng.choice([2, 3, 4])),
                "is_lab": is_lab,
                "base_demand": float(rng.uniform(40, 150) if not is_lab else rng.uniform(40, 110)),
                "growth": float(rng.uniform(-0.01, 0.05)),
                "room_capacity": 45 if is_lab else int(rng.choice([60, 70, 80])),
                "team": [int(x) for x in rng.choice(n_teachers, size=int(rng.integers(3, 5)), replace=False)],
            }
        )

    rows: List[Dict[str, Any]] = []
    prev_size: Dict[tuple, int] = {}
    prev_total: Dict[str, int] = {}
    prev_share: Dict[tuple, float] = {}
    crowd_hist: Dict[str, List[int]] = {}
    inter_hist: Dict[str, List[float]] = {}
    att_hist: Dict[str, List[float]] = {}

    for yi, year in enumerate(years):
        covid = 0.85 if year in ("2020-21",) else 1.0
        for sj in subjects:
            demand = int(
                max(
                    20,
                    sj["base_demand"] * (1 + sj["growth"]) ** yi * covid * rng.normal(1.0, 0.06),
                )
            )
            # who is available this year (teachers drop out occasionally)
            avail = [t for t in sj["team"] if rng.random() > 0.12] or sj["team"][:2]
            weights = np.array([teachers[t]["preferred"] * rng.normal(1.0, 0.12) for t in avail])
            raw = demand * weights / weights.sum()
            caps = np.array([min(teachers[t]["max"], sj["room_capacity"]) for t in avail], dtype=float)
            sizes = np.minimum(raw, caps)
            # redistribute overflow to teachers with headroom
            for _ in range(5):
                left = demand - sizes.sum()
                if left < 0.5:
                    break
                head = caps - sizes
                if head.sum() <= 0:
                    break
                sizes = sizes + np.minimum(head, left * head / head.sum())
            sizes = np.round(sizes).astype(int)
            n_t = len(avail)
            for k, t in enumerate(avail):
                T = teachers[t]
                tid = T["teacher_id"]
                size = int(sizes[k])
                over = max(0, size - T["preferred"])
                attendance = float(np.clip(0.92 - 0.004 * over * T["crowd_sens"] - (0.02 if sj["is_lab"] else 0) + rng.normal(0, 0.015), 0.5, 0.99))
                overcrowded = int(size > T["preferred"] + 0.25 * (T["max"] - T["preferred"]) and rng.random() < 0.8)
                interaction = float(np.clip(T["interaction_base"] - 0.03 * over * T["crowd_sens"] + rng.normal(0, 0.2), 1, 5))
                key = (sj["subject_code"], tid)
                ch, ih, ah = crowd_hist.get(tid, []), inter_hist.get(tid, []), att_hist.get(tid, [])
                rows.append(
                    {
                        "academic_year": year,
                        "year_index": yi,
                        "subject_code": sj["subject_code"],
                        "teacher_id": tid,
                        "department": sj["department"],
                        "semester": sj["semester"],
                        "credits": sj["credits"],
                        "is_lab": sj["is_lab"],
                        "room_capacity": sj["room_capacity"],
                        "student_demand": demand,
                        "n_teachers": n_t,
                        "equal_share": round(demand / n_t, 3),
                        "prev_enrollment": prev_total.get(sj["subject_code"], np.nan),
                        "prev_class_size": prev_size.get(key, np.nan),
                        "prev_allocation_share": prev_share.get(key, np.nan),
                        "teacher_preferred": T["preferred"],
                        "teacher_max": T["max"],
                        "subject_experience_years": round(T["experience"] + yi * 0.5, 2),
                        "feedback_overcrowd_rate": round(float(np.mean(ch)), 3) if ch else np.nan,
                        "feedback_interaction": round(float(np.mean(ih)), 3) if ih else np.nan,
                        "hist_attendance": round(float(np.mean(ah)), 4) if ah else np.nan,
                        "class_size": size,
                        "attendance_rate": round(attendance, 4),
                        "data_origin": "SYNTHETIC",
                    }
                )
                prev_size[key] = size
                prev_share[key] = size / demand
                crowd_hist.setdefault(tid, []).append(overcrowded)
                inter_hist.setdefault(tid, []).append(interaction)
                att_hist.setdefault(tid, []).append(attendance)
            prev_total[sj["subject_code"]] = demand

    return pd.DataFrame(rows)


def ensure_synthetic_file(force: bool = False) -> Path:
    if force or not SYNTHETIC_FILE.exists():
        SYNTHETIC_FILE.parent.mkdir(parents=True, exist_ok=True)
        generate_synthetic_dataset().to_csv(SYNTHETIC_FILE, index=False)
    return SYNTHETIC_FILE


# --------------------------------------------------------------------------------------
# Training / evaluation
# --------------------------------------------------------------------------------------
def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 4),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def _preferred_share_baseline(df: pd.DataFrame) -> np.ndarray:
    """Heuristic baseline: split demand proportionally to teachers' preferred sizes (what the engine does with no ML)."""
    grp = df.groupby(["academic_year", "subject_code"])["teacher_preferred"].transform("sum")
    return (df["student_demand"] * df["teacher_preferred"] / grp).to_numpy()


def train_class_size_models(test_years: int = 3, csv_path: Optional[Path] = None) -> Dict[str, Any]:
    """
    Chronological split: the last `test_years` academic years are held out (never trained on).
    Compares: equal distribution, preferred-proportional heuristic, Random Forest, XGBoost.
    Persists the best ML model only if it beats the equal-distribution baseline on MAE.
    """
    validate_features_no_leakage(FEATURES)
    path = Path(csv_path) if csv_path else ensure_synthetic_file()
    df = pd.read_csv(path)
    years = sorted(df["academic_year"].unique())
    test_ys = years[-test_years:]
    train, test = df[~df["academic_year"].isin(test_ys)], df[df["academic_year"].isin(test_ys)]
    X_tr, y_tr, X_te, y_te = train[FEATURES], train["class_size"], test[FEATURES], test["class_size"].to_numpy()

    rf = RandomForestRegressor(n_estimators=120, min_samples_leaf=4, random_state=42, n_jobs=-1).fit(X_tr, y_tr)
    xgb = XGBRegressor(
        n_estimators=400, learning_rate=0.05, max_depth=4, subsample=0.9, colsample_bytree=0.9,
        random_state=42, tree_method="hist", n_jobs=1,
    ).fit(X_tr, y_tr)

    results = {
        "equal_distribution": _metrics(y_te, test["equal_share"].to_numpy()),
        "preferred_proportional": _metrics(y_te, _preferred_share_baseline(test)),
        "random_forest": _metrics(y_te, rf.predict(X_te)),
        "xgboost": _metrics(y_te, xgb.predict(X_te)),
    }
    best_name = min(["random_forest", "xgboost"], key=lambda n: results[n]["mae"])
    beats_equal = results[best_name]["mae"] < results["equal_distribution"]["mae"]
    beats_heuristic = results[best_name]["mae"] < results["preferred_proportional"]["mae"]

    report = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "data_origin": "SYNTHETIC - not real college data",
        "rows_total": int(len(df)),
        "rows_train": int(len(train)),
        "rows_test": int(len(test)),
        "train_years": [y for y in years if y not in test_ys],
        "test_years": test_ys,
        "split": "chronological hold-out (test years never seen in training)",
        "metrics": results,
        "best_ml_model": best_name,
        "beats_equal_distribution": beats_equal,
        "beats_preferred_proportional": beats_heuristic,
        "model_active": bool(beats_equal),
        "features": FEATURES,
        "note": (
            "ML output is advisory. The deterministic allocation engine enforces teacher max, room capacity, "
            "workload and holidays and makes the final decision."
        ),
    }
    if beats_equal:
        joblib.dump({"model": rf if best_name == "random_forest" else xgb, "name": best_name, "features": FEATURES, "report": report}, MODEL_FILE)
    METRICS_FILE.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def get_class_size_report() -> Dict[str, Any]:
    if METRICS_FILE.exists():
        return json.loads(METRICS_FILE.read_text(encoding="utf-8"))
    return {"model_active": False, "message": "No class-size model trained yet. POST /api/forecast/class-size/train"}


# --------------------------------------------------------------------------------------
# Prediction (pure)
# --------------------------------------------------------------------------------------
def predict_class_sizes(requests: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    requests: [{subject_code, student_demand, is_lab, credits, semester, room_capacity, prev_enrollment?,
                teachers: [{staff_id, teacher_preferred, teacher_max, ...optional history...}]}]
    Returns per-teacher expected class size. Nothing is persisted here.
    """
    if not MODEL_FILE.exists():
        raise RuntimeError("Class-size model is not available (not trained or did not beat the baseline).")
    bundle = joblib.load(MODEL_FILE)
    model, feats = bundle["model"], bundle["features"]

    flat: List[Dict[str, Any]] = []
    meta: List[tuple] = []
    for r in requests:
        teachers = r.get("teachers") or []
        n_t = max(1, len(teachers))
        demand = float(r["student_demand"])
        for t in teachers:
            flat.append(
                {
                    "student_demand": demand,
                    "n_teachers": n_t,
                    "equal_share": demand / n_t,
                    "prev_enrollment": r.get("prev_enrollment", np.nan),
                    "prev_class_size": t.get("prev_class_size", np.nan),
                    "teacher_preferred": float(t["teacher_preferred"]),
                    "teacher_max": float(t["teacher_max"]),
                    "subject_experience_years": t.get("subject_experience_years", 5.0),
                    "feedback_overcrowd_rate": t.get("feedback_overcrowd_rate", np.nan),
                    "feedback_interaction": t.get("feedback_interaction", np.nan),
                    "hist_attendance": t.get("hist_attendance", np.nan),
                    "prev_allocation_share": t.get("prev_allocation_share", np.nan),
                    "is_lab": int(r.get("is_lab", 0)),
                    "credits": r.get("credits", 3),
                    "semester": r.get("semester", 5),
                    "year_index": r.get("year_index", 14),
                    "room_capacity": r.get("room_capacity", 60),
                }
            )
            meta.append((r["subject_code"], t["staff_id"]))
    if not flat:
        return {"model": bundle["name"], "predictions": []}
    X = pd.DataFrame(flat)[feats].astype(float)
    pred = model.predict(X)
    return {
        "model": bundle["name"],
        "data_origin": "SYNTHETIC training data",
        "predictions": [
            {"subject_code": s, "staff_id": t, "predicted_students": round(float(max(0.0, p)), 2)}
            for (s, t), p in zip(meta, pred)
        ],
    }
