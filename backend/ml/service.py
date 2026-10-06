from datetime import datetime
import io
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd

from backend.ml.config import (
    DEFAULT_SECTION_SIZE,
    DEFAULT_TARGET_YEAR,
    FORECAST_INPUT_SEED_FILE,
    HISTORICAL_SEED_FILE,
    MODELS_DIR,
)
from backend.ml.db import db_session, ensure_tables
from backend.ml.features import (
    ALL_FEATURES,
    compute_lag_features,
    parse_year_start,
)
from backend.ml.model import DemandForecastModel

def initialize_service() -> None:
    """Ensure database tables exist and directories are ready."""
    ensure_tables()

def seed_historical_data() -> Dict[str, Any]:
    """Seed historical enrollment data from CSV into enrollment_history table."""
    initialize_service()
    if not HISTORICAL_SEED_FILE.exists():
        raise FileNotFoundError(f"Seed file not found: {HISTORICAL_SEED_FILE}")

    df = pd.read_csv(HISTORICAL_SEED_FILE)
    df = compute_lag_features(df)

    now = datetime.utcnow().isoformat()
    years = sorted(df["academic_year"].unique(), key=parse_year_start)

    with db_session() as conn:
        # Idempotently delete existing historical years in seed
        placeholders = ",".join("?" for _ in years)
        conn.execute(f"DELETE FROM enrollment_history WHERE academic_year IN ({placeholders})", years)

        insert_sql = """
        INSERT INTO enrollment_history (
          record_id, academic_year, term, department, semester_no,
          subject_code, subject_name, course_type, cohort_size,
          industry_demand_index, prev_year_registered, prev2_year_registered,
          registered_trend_3y, staff_available, registered_students,
          sections_opened, avg_section_size, is_synthetic, credits,
          has_lab, topic_category, topic_trend_index, rival_elective_trend,
          dept_placement_rate_prev, prereq_pass_rate, course_age_years,
          is_first_offering, covid_flag, staff_shortfall, split, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """

        rows_to_insert = []
        for _, r in df.iterrows():
            rows_to_insert.append((
                str(r.get("record_id", "")),
                str(r["academic_year"]),
                str(r["term"]),
                str(r["department"]),
                int(r["semester_no"]),
                str(r["subject_code"]),
                str(r["subject_name"]),
                str(r["course_type"]),
                int(r["cohort_size"]),
                float(r["industry_demand_index"]) if pd.notna(r.get("industry_demand_index")) else None,
                float(r["prev_year_registered"]) if pd.notna(r.get("prev_year_registered")) else None,
                float(r["prev2_year_registered"]) if pd.notna(r.get("prev2_year_registered")) else None,
                float(r["registered_trend_3y"]) if pd.notna(r.get("registered_trend_3y")) else None,
                int(r["staff_available"]) if pd.notna(r.get("staff_available")) else None,
                int(r["registered_students"]) if pd.notna(r.get("registered_students")) else None,
                int(r["sections_opened"]) if pd.notna(r.get("sections_opened")) else None,
                float(r["avg_section_size"]) if pd.notna(r.get("avg_section_size")) else None,
                1 if bool(r.get("is_synthetic", True)) else 0,
                int(r.get("credits", 3)),
                1 if bool(r.get("has_lab", 0)) else 0,
                str(r.get("topic_category", "general")),
                float(r["topic_trend_index"]) if pd.notna(r.get("topic_trend_index")) else None,
                float(r["rival_elective_trend"]) if pd.notna(r.get("rival_elective_trend")) else None,
                float(r["dept_placement_rate_prev"]) if pd.notna(r.get("dept_placement_rate_prev")) else None,
                float(r["prereq_pass_rate"]) if pd.notna(r.get("prereq_pass_rate")) else None,
                int(r.get("course_age_years", 0)),
                1 if bool(r.get("is_first_offering", 0)) else 0,
                1 if bool(r.get("covid_flag", 0)) else 0,
                int(r.get("staff_shortfall", 0)),
                str(r.get("split", "train")),
                now,
            ))

        conn.executemany(insert_sql, rows_to_insert)

    # Initialize subject mappings
    sync_subject_mappings()

    return {
        "success": True,
        "message": f"Successfully loaded {len(df)} historical enrollment rows across {len(years)} years.",
        "years": years,
        "total_rows": len(df),
    }

def import_historical_year(file_bytes: bytes, filename: str) -> Dict[str, Any]:
    """Import finished year actuals from CSV or Excel file (atomic, idempotent)."""
    initialize_service()

    if filename.endswith(".xlsx") or filename.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(file_bytes))
    else:
        df = pd.read_csv(io.BytesIO(file_bytes))

    # Required columns tamper check
    required_cols = [
        "academic_year", "term", "department", "semester_no",
        "subject_code", "subject_name", "course_type",
        "cohort_size", "registered_students"
    ]
    missing = [col for col in required_cols if col not in df.columns]
    if missing:
        raise ValueError(f"Uploaded file is missing required columns: {', '.join(missing)}")

    # Standardize and clean
    df["academic_year"] = df["academic_year"].astype(str).str.strip()
    distinct_years = df["academic_year"].unique().tolist()
    if len(distinct_years) == 0:
        raise ValueError("Uploaded file contains no rows or invalid academic years.")

    now = datetime.utcnow().isoformat()

    with db_session() as conn:
        # Idempotently delete existing rows for the imported year(s)
        for y in distinct_years:
            conn.execute("DELETE FROM enrollment_history WHERE academic_year = ?", (y,))

        insert_sql = """
        INSERT INTO enrollment_history (
          record_id, academic_year, term, department, semester_no,
          subject_code, subject_name, course_type, cohort_size,
          industry_demand_index, prev_year_registered, prev2_year_registered,
          registered_trend_3y, staff_available, registered_students,
          sections_opened, avg_section_size, is_synthetic, credits,
          has_lab, topic_category, topic_trend_index, rival_elective_trend,
          dept_placement_rate_prev, prereq_pass_rate, course_age_years,
          is_first_offering, covid_flag, staff_shortfall, split, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """

        rows_to_insert = []
        for idx, r in df.iterrows():
            rows_to_insert.append((
                str(r.get("record_id", f"IMP_{r['academic_year']}_{idx+1}")),
                str(r["academic_year"]),
                str(r["term"]),
                str(r["department"]),
                int(r["semester_no"]),
                str(r["subject_code"]),
                str(r["subject_name"]),
                str(r["course_type"]),
                int(r["cohort_size"]),
                float(r["industry_demand_index"]) if pd.notna(r.get("industry_demand_index")) else None,
                None, None, None, # will recompute lags
                int(r["staff_available"]) if pd.notna(r.get("staff_available")) else None,
                int(r["registered_students"]) if pd.notna(r.get("registered_students")) else None,
                int(r["sections_opened"]) if pd.notna(r.get("sections_opened")) else None,
                float(r["avg_section_size"]) if pd.notna(r.get("avg_section_size")) else None,
                0, # Real actual data
                int(r.get("credits", 3)),
                1 if bool(r.get("has_lab", 0)) else 0,
                str(r.get("topic_category", "general")),
                float(r["topic_trend_index"]) if pd.notna(r.get("topic_trend_index")) else None,
                float(r["rival_elective_trend"]) if pd.notna(r.get("rival_elective_trend")) else None,
                float(r["dept_placement_rate_prev"]) if pd.notna(r.get("dept_placement_rate_prev")) else None,
                float(r["prereq_pass_rate"]) if pd.notna(r.get("prereq_pass_rate")) else None,
                int(r.get("course_age_years", 0)),
                1 if bool(r.get("is_first_offering", 0)) else 0,
                1 if bool(r.get("covid_flag", 0)) else 0,
                int(r.get("staff_shortfall", 0)),
                "actual",
                now,
            ))

        conn.executemany(insert_sql, rows_to_insert)

    # Rebuild lag features across full history
    rebuild_all_lag_features()
    sync_subject_mappings()

    return {
        "success": True,
        "message": f"Successfully imported {len(df)} actual records for academic year(s): {', '.join(distinct_years)}.",
        "years_imported": distinct_years,
        "rowCount": len(df),
    }

def rebuild_all_lag_features() -> None:
    """Rebuild lag features for all records in enrollment_history table."""
    with db_session() as conn:
        all_df = pd.read_sql_query("SELECT * FROM enrollment_history", conn)
        if all_df.empty:
            return

        updated_df = compute_lag_features(all_df)

        update_sql = """
        UPDATE enrollment_history
        SET prev_year_registered = ?, prev2_year_registered = ?, registered_trend_3y = ?
        WHERE id = ?
        """
        updates = []
        for _, r in updated_df.iterrows():
            updates.append((
                float(r["prev_year_registered"]) if pd.notna(r["prev_year_registered"]) else None,
                float(r["prev2_year_registered"]) if pd.notna(r["prev2_year_registered"]) else None,
                float(r["registered_trend_3y"]) if pd.notna(r["registered_trend_3y"]) else None,
                int(r["id"]),
            ))
        conn.executemany(update_sql, updates)

def get_forecast_status() -> Dict[str, Any]:
    """Get current status of Demand Forecast module."""
    initialize_service()
    with db_session() as conn:
        hist_count = conn.execute("SELECT COUNT(*) as cnt FROM enrollment_history").fetchone()["cnt"]
        years_rows = conn.execute("SELECT DISTINCT academic_year FROM enrollment_history").fetchall()
        years = sorted([r["academic_year"] for r in years_rows], key=parse_year_start)

        champion_row = conn.execute(
            "SELECT * FROM model_registry WHERE is_champion = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()

        latest_run_row = conn.execute(
            "SELECT * FROM forecast_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()

        latest_pred_row = conn.execute(
            "SELECT academic_year, COUNT(*) as count FROM forecast_predictions GROUP BY academic_year ORDER BY id DESC LIMIT 1"
        ).fetchone()

        # Stale detection: if new history arrived after latest model training
        is_stale = False
        if champion_row and hist_count > 0:
            latest_history = conn.execute(
                "SELECT MAX(created_at) as max_up FROM enrollment_history"
            ).fetchone()["max_up"]
            if latest_history and latest_history > champion_row["created_at"]:
                is_stale = True

    return {
        "is_enabled": True,
        "history_count": hist_count,
        "available_years": years,
        "champion_model": dict(champion_row) if champion_row else None,
        "latest_run": dict(latest_run_row) if latest_run_row else None,
        "predictions_summary": {
            "target_year": latest_pred_row["academic_year"] if latest_pred_row else None,
            "count": latest_pred_row["count"] if latest_pred_row else 0,
        },
        "is_stale": is_stale,
    }

def train_demand_model(
    target_year: str = DEFAULT_TARGET_YEAR,
    force_promote: bool = False,
) -> Dict[str, Any]:
    """Train XGBoost model using expanding window time-split and version it."""
    initialize_service()

    with db_session() as conn:
        history_df = pd.read_sql_query("SELECT * FROM enrollment_history", conn)

    if history_df.empty:
        raise ValueError("No historical enrollment data found. Please seed or upload history first.")

    model_wrapper = DemandForecastModel()
    metrics = model_wrapper.train_expanding_window(history_df, target_year)

    now = datetime.utcnow().isoformat()

    # Determine next model version
    with db_session() as conn:
        last_version_row = conn.execute("SELECT version FROM model_registry ORDER BY id DESC LIMIT 1").fetchone()
        if last_version_row:
            try:
                curr_v = int(last_version_row["version"].replace("v", ""))
                version = f"v{curr_v + 1}"
            except Exception:
                version = f"v{int(datetime.utcnow().timestamp())}"
        else:
            version = "v1"

    # Save model binary and metadata
    model_filename = f"demand_xgb_{version}.json"
    model_path = MODELS_DIR / model_filename
    model_wrapper.save(model_path)

    # Check champion rule
    with db_session() as conn:
        current_champion = conn.execute(
            "SELECT * FROM model_registry WHERE is_champion = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()

        is_champion = False
        if current_champion is None:
            is_champion = True
        elif force_promote:
            is_champion = True
        elif metrics["mae"] <= current_champion["val_mae"]:
            is_champion = True

        if is_champion and current_champion is not None:
            conn.execute("UPDATE model_registry SET is_champion = 0 WHERE is_champion = 1")

        # Register model
        conn.execute("""
        INSERT INTO model_registry (
          version, created_at, file_path, train_years_json, val_year,
          val_mae, val_rmse, val_r2, baseline_mae, is_champion,
          promoted_at, promoted_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            version,
            now,
            str(model_path),
            json.dumps(metrics["train_years"]),
            metrics["val_year"],
            metrics["mae"],
            metrics["rmse"],
            metrics["r2"],
            metrics["baseline_mae"],
            1 if is_champion else 0,
            now if is_champion else None,
            "system" if is_champion else None,
        ))

        # Record forecast run
        run_cursor = conn.execute("""
        INSERT INTO forecast_runs (
          created_at, model_version, target_year, train_years_json,
          val_year, mae, rmse, r2, baseline_mae, core_mae, elective_mae,
          beats_baseline, pct_improvement, feature_importances_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            now,
            version,
            target_year,
            json.dumps(metrics["train_years"]),
            metrics["val_year"],
            metrics["mae"],
            metrics["rmse"],
            metrics["r2"],
            metrics["baseline_mae"],
            metrics["core_mae"],
            metrics["elective_mae"],
            1 if metrics["beats_baseline"] else 0,
            metrics["pct_improvement"],
            json.dumps(metrics["feature_importances"]),
            "completed",
        ))
        run_id = run_cursor.lastrowid

    return {
        "run_id": run_id,
        "model_version": version,
        "is_champion": is_champion,
        "metrics": metrics,
    }

def get_target_inputs(target_year: str = DEFAULT_TARGET_YEAR) -> List[Dict[str, Any]]:
    """Retrieve editable assumptions and course inputs for target year."""
    initialize_service()

    with db_session() as conn:
        settings_row = conn.execute(
            "SELECT value_json FROM forecast_settings WHERE key = ?",
            (f"inputs_{target_year}",)
        ).fetchone()

        if settings_row:
            return json.loads(settings_row["value_json"])

    # Fallback to seed forecast input if matches default
    if target_year == DEFAULT_TARGET_YEAR and FORECAST_INPUT_SEED_FILE.exists():
        df = pd.read_csv(FORECAST_INPUT_SEED_FILE)
        df["is_assumed"] = True
        return df.to_dict(orient="records")

    # Generate baseline courses from latest available year
    with db_session() as conn:
        latest_year_row = conn.execute(
            "SELECT academic_year FROM enrollment_history ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not latest_year_row:
            return []
        latest_year = latest_year_row["academic_year"]
        courses_df = pd.read_sql_query(
            "SELECT * FROM enrollment_history WHERE academic_year = ?",
            conn,
            params=(latest_year,)
        )

    courses_df["academic_year"] = target_year
    courses_df["registered_students"] = None
    courses_df["is_assumed"] = True
    return courses_df.to_dict(orient="records")

def save_target_inputs(target_year: str, inputs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Persist edited assumptions for target year in forecast_settings."""
    initialize_service()
    now = datetime.utcnow().isoformat()
    with db_session() as conn:
        conn.execute("""
        INSERT INTO forecast_settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
        """, (f"inputs_{target_year}", json.dumps(inputs), now))

    return {"success": True, "message": f"Saved assumptions for {target_year}", "count": len(inputs)}

def generate_predictions(
    target_year: str = DEFAULT_TARGET_YEAR,
    section_size: int = DEFAULT_SECTION_SIZE,
    model_version: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate predictions for target year and save to forecast_predictions."""
    initialize_service()

    with db_session() as conn:
        if model_version:
            model_row = conn.execute(
                "SELECT * FROM model_registry WHERE version = ?", (model_version,)
            ).fetchone()
        else:
            model_row = conn.execute(
                "SELECT * FROM model_registry WHERE is_champion = 1 ORDER BY id DESC LIMIT 1"
            ).fetchone()

        if not model_row:
            raise RuntimeError("No trained model found. Please train a model first.")

        # Ensure a forecast run exists or create one
        latest_run = conn.execute(
            "SELECT id FROM forecast_runs WHERE model_version = ? ORDER BY id DESC LIMIT 1",
            (model_row["version"],)
        ).fetchone()
        run_id = latest_run["id"] if latest_run else None

    # Load model
    model = DemandForecastModel.load(Path(model_row["file_path"]))

    # Prepare input records
    inputs = get_target_inputs(target_year)
    if not inputs:
        raise ValueError(f"No courses available to predict for {target_year}")

    input_df = pd.DataFrame(inputs)

    # Merge lags with historical database
    with db_session() as conn:
        all_hist = pd.read_sql_query("SELECT * FROM enrollment_history", conn)

    combined = pd.concat([all_hist, input_df], ignore_index=True)
    combined = compute_lag_features(combined)

    # Filter target year
    target_df = combined[combined["academic_year"] == target_year].copy()

    # Predict
    predicted_df = model.predict_target_year(target_df, section_size=section_size)

    # Save to forecast_predictions table
    now = datetime.utcnow().isoformat()
    with db_session() as conn:
        if not run_id:
            run_cur = conn.execute("""
            INSERT INTO forecast_runs (
              created_at, model_version, target_year, train_years_json,
              val_year, mae, rmse, r2, baseline_mae, beats_baseline, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                now, model_row["version"], target_year, model_row["train_years_json"],
                model_row["val_year"], model_row["val_mae"], model_row["val_rmse"],
                model_row["val_r2"], model_row["baseline_mae"], 1, "completed"
            ))
            run_id = run_cur.lastrowid

        # Delete prior predictions for this run / target_year
        conn.execute("DELETE FROM forecast_predictions WHERE academic_year = ?", (target_year,))

        insert_sql = """
        INSERT INTO forecast_predictions (
          run_id, academic_year, term, department, semester_no,
          subject_code, subject_name, course_type, cohort_size,
          predicted_registered, low_interval, high_interval,
          predicted_sections, last_year_actual, change_pct,
          staff_available, sections_needed, is_staff_shortfall, is_synthetic
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        pred_rows = []
        for _, r in predicted_df.iterrows():
            pred_rows.append((
                run_id,
                str(target_year),
                str(r["term"]),
                str(r["department"]),
                int(r["semester_no"]),
                str(r["subject_code"]),
                str(r["subject_name"]),
                str(r["course_type"]),
                int(r["cohort_size"]),
                int(r["predicted_registered"]),
                int(r["low_interval"]),
                int(r["high_interval"]),
                int(r["predicted_sections"]),
                int(r["last_year_actual"]) if pd.notna(r.get("last_year_actual")) else None,
                float(r["change_pct"]) if pd.notna(r.get("change_pct")) else None,
                int(r["staff_available"]) if pd.notna(r.get("staff_available")) else None,
                int(r["sections_needed"]),
                int(r["is_staff_shortfall"]),
                1 if bool(r.get("is_synthetic", True)) else 0,
            ))

        conn.executemany(insert_sql, pred_rows)

    return {
        "run_id": run_id,
        "target_year": target_year,
        "model_version": model_row["version"],
        "count": len(predicted_df),
        "total_predicted_students": int(predicted_df["predicted_registered"].sum()),
        "total_predicted_sections": int(predicted_df["predicted_sections"].sum()),
        "staff_shortfall_count": int(predicted_df["is_staff_shortfall"].sum()),
        "predictions": predicted_df.to_dict(orient="records"),
    }

def get_predictions(target_year: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve saved predictions from database."""
    initialize_service()
    with db_session() as conn:
        if target_year:
            rows = conn.execute(
                "SELECT * FROM forecast_predictions WHERE academic_year = ? ORDER BY department, semester_no, subject_code",
                (target_year,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM forecast_predictions ORDER BY id DESC"
            ).fetchall()
        return [dict(r) for r in rows]

def get_section_plan() -> List[Dict[str, Any]]:
    """
    Module 3 Hand-off:
    Returns section planning requirements for the next term.
    Returns [] if no forecast run exists.
    """
    initialize_service()
    with db_session() as conn:
        latest_pred = conn.execute(
            "SELECT academic_year FROM forecast_predictions ORDER BY id DESC LIMIT 1"
        ).fetchone()

        if not latest_pred:
            return []

        rows = conn.execute("""
        SELECT 
          subject_code,
          subject_name,
          department,
          term,
          predicted_sections,
          predicted_registered,
          staff_available,
          is_staff_shortfall as staff_shortfall
        FROM forecast_predictions
        WHERE academic_year = ?
        ORDER BY department, subject_code
        """, (latest_pred["academic_year"],)).fetchall()

        return [dict(r) for r in rows]

def get_accuracy_report() -> Dict[str, Any]:
    """Retrieve accuracy analysis: core vs elective error, feature importances, and rolling 3-year backtest."""
    initialize_service()
    with db_session() as conn:
        runs = conn.execute("SELECT * FROM forecast_runs ORDER BY id DESC LIMIT 10").fetchall()
        champion = conn.execute("SELECT * FROM model_registry WHERE is_champion = 1 LIMIT 1").fetchone()
        history_df = pd.read_sql_query("SELECT * FROM enrollment_history", conn)

    if not runs or history_df.empty:
        return {
            "has_data": False,
            "message": "No training runs recorded yet.",
            "runs": [],
            "rolling_backtest": [],
        }

    latest_run = dict(runs[0])
    feature_importances = json.loads(latest_run.get("feature_importances_json") or "[]")

    # Rolling 3-year backtest comparing model MAE vs simple baseline
    sorted_years = sorted(history_df["academic_year"].unique(), key=parse_year_start)
    rolling_backtest = []

    if len(sorted_years) >= 4:
        eval_years = sorted_years[-3:]
        for test_yr in eval_years:
            try:
                sub_df = history_df[history_df["academic_year"] == test_yr]
                y_true = sub_df["registered_students"].dropna()
                y_base = sub_df["prev_year_registered"].fillna(sub_df["cohort_size"] * 0.7).loc[y_true.index]

                base_mae = round(float(mean_absolute_error(y_true, y_base)), 2)

                # Train temporary model up to test_yr to get authentic expanding backtest
                temp_model = DemandForecastModel()
                res = temp_model.train_expanding_window(history_df, target_year=test_yr)
                model_mae = res["mae"]

                rolling_backtest.append({
                    "year": test_yr,
                    "model_mae": model_mae,
                    "baseline_mae": base_mae,
                    "beats_baseline": model_mae <= base_mae,
                    "improvement_pct": round(((base_mae - model_mae) / base_mae) * 100.0, 1) if base_mae > 0 else 0.0,
                })
            except Exception:
                continue

    return {
        "has_data": True,
        "latest_run": latest_run,
        "champion_model": dict(champion) if champion else None,
        "feature_importances": feature_importances,
        "rolling_backtest": rolling_backtest,
    }

def get_model_registry() -> List[Dict[str, Any]]:
    """List all trained model versions with metrics and champion flag."""
    initialize_service()
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM model_registry ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]

def promote_model_version(version: str, promoted_by: str = "HOD") -> Dict[str, Any]:
    """Manually promote a model version to champion."""
    initialize_service()
    now = datetime.utcnow().isoformat()
    with db_session() as conn:
        target = conn.execute("SELECT * FROM model_registry WHERE version = ?", (version,)).fetchone()
        if not target:
            raise ValueError(f"Model version {version} not found.")

        conn.execute("UPDATE model_registry SET is_champion = 0")
        conn.execute("""
        UPDATE model_registry
        SET is_champion = 1, promoted_at = ?, promoted_by = ?
        WHERE version = ?
        """, (now, promoted_by, version))

    return {"success": True, "message": f"Model {version} successfully promoted to champion.", "version": version}

def sync_subject_mappings() -> None:
    """Synchronize ML subject codes with Module 2 clean engine subjects."""
    initialize_service()
    now = datetime.utcnow().isoformat()
    with db_session() as conn:
        # Get distinct ML subjects
        ml_rows = conn.execute("SELECT DISTINCT subject_code, subject_name FROM enrollment_history").fetchall()
        # Get clean engine subjects if table exists
        try:
            engine_rows = conn.execute("SELECT subject_code, subject_name FROM subjects").fetchall()
            engine_dict = {r["subject_name"].strip().lower(): r["subject_code"] for r in engine_rows}
        except Exception:
            engine_dict = {}

        insert_sql = """
        INSERT INTO forecast_subject_map (
          ml_subject_code, ml_subject_name, engine_subject_code,
          engine_subject_name, match_confidence, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ml_subject_code) DO NOTHING
        """

        to_insert = []
        for r in ml_rows:
            ml_code = r["subject_code"]
            ml_name = r["subject_name"]
            norm_name = ml_name.strip().lower()

            engine_code = engine_dict.get(norm_name)
            confidence = 1.0 if engine_code else 0.0

            to_insert.append((
                ml_code,
                ml_name,
                engine_code,
                ml_name if engine_code else None,
                confidence,
                "auto_matched" if engine_code else "pending_review",
                now,
            ))

        conn.executemany(insert_sql, to_insert)

def get_subject_mappings() -> List[Dict[str, Any]]:
    """Retrieve subject mappings between ML models and scheduling engine."""
    initialize_service()
    sync_subject_mappings()
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM forecast_subject_map ORDER BY ml_subject_code").fetchall()
        return [dict(r) for r in rows]

def update_subject_mapping(ml_subject_code: str, engine_subject_code: str) -> Dict[str, Any]:
    """Manually update subject code mapping."""
    initialize_service()
    now = datetime.utcnow().isoformat()
    with db_session() as conn:
        conn.execute("""
        UPDATE forecast_subject_map
        SET engine_subject_code = ?, status = 'manually_reviewed', updated_at = ?
        WHERE ml_subject_code = ?
        """, (engine_subject_code, now, ml_subject_code))

    return {"success": True, "ml_subject_code": ml_subject_code, "engine_subject_code": engine_subject_code}
