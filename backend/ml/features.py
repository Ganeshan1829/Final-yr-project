from typing import List, Set, Tuple
import numpy as np
import pandas as pd

TARGET: str = "registered_students"

CATEGORICAL_FEATURES: List[str] = [
    "department",
    "term",
    "course_type",
    "topic_category",
]

NUMERIC_FEATURES: List[str] = [
    "semester_no",
    "cohort_size",
    "industry_demand_index",
    "prev_year_registered",
    "staff_available",
    "credits",
    "has_lab",
    "topic_trend_index",
    "rival_elective_trend",
    "dept_placement_rate_prev",
    "prereq_pass_rate",
    "course_age_years",
    "is_first_offering",
    "covid_flag",
    "prev2_year_registered",
    "registered_trend_3y",
]

ALL_FEATURES: List[str] = CATEGORICAL_FEATURES + NUMERIC_FEATURES

# Strict leakage guard: these columns must NEVER be used as model inputs
FORBIDDEN_FEATURES: Set[str] = {
    "sections_opened",
    "avg_section_size",
    "staff_shortfall",
    "split",
    "record_id",
    "is_synthetic",
    "registered_students",
}

def validate_features_no_leakage(feature_list: List[str]) -> None:
    """Enforce strict leakage guard. Raises ValueError if any forbidden column is found."""
    found_forbidden = set(feature_list).intersection(FORBIDDEN_FEATURES)
    if found_forbidden:
        raise ValueError(
            f"LEAKAGE GUARD VIOLATION: Forbidden features detected in model input: {found_forbidden}"
        )

def parse_year_start(year_str: str) -> int:
    """Convert academic year string (e.g. '2024-25') to starting year integer (2024)."""
    try:
        return int(str(year_str).split("-")[0].strip())
    except Exception:
        return 0

def format_academic_year(start_year: int) -> str:
    """Format starting year integer to academic year string (e.g. 2026 -> '2026-27')."""
    end_yy = (start_year + 1) % 100
    return f"{start_year}-{end_yy:02d}"

def compute_lag_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Rebuild prev_year_registered, prev2_year_registered, and registered_trend_3y
    strictly from historical registered_students for each (department, subject_code).
    Missing lags stay NaN (never imputed).
    """
    df = df.copy()
    if "start_year" not in df.columns:
        df["start_year"] = df["academic_year"].apply(parse_year_start)

    # Sort chronologically
    df = df.sort_values(by=["department", "subject_code", "term", "start_year"]).reset_index(drop=True)

    # Dictionary of (dept, subject_code, term, start_year) -> registered_students
    has_target = TARGET in df.columns
    reg_lookup = {}
    if has_target:
        for _, row in df.iterrows():
            if pd.notna(row.get(TARGET)):
                key = (row["department"], row["subject_code"], row["term"], int(row["start_year"]))
                reg_lookup[key] = float(row[TARGET])

    prev1_list = []
    prev2_list = []
    trend_list = []

    for _, row in df.iterrows():
        dept = row["department"]
        subj = row["subject_code"]
        term = row["term"]
        sy = int(row["start_year"])

        # Look up year t-1 and year t-2
        val_t_minus_1 = reg_lookup.get((dept, subj, term, sy - 1))
        val_t_minus_2 = reg_lookup.get((dept, subj, term, sy - 2))

        # Fallback to existing prev_year_registered in row if lookup not present (e.g. single year forecast input)
        if val_t_minus_1 is None and "prev_year_registered" in row and pd.notna(row["prev_year_registered"]):
            try:
                val_t_minus_1 = float(row["prev_year_registered"])
            except Exception:
                val_t_minus_1 = np.nan

        if val_t_minus_1 is None:
            val_t_minus_1 = np.nan
        if val_t_minus_2 is None:
            val_t_minus_2 = np.nan

        # Trend over 3 years: change between year t-1 and year t-2
        if not np.isnan(val_t_minus_1) and not np.isnan(val_t_minus_2):
            trend = float(val_t_minus_1 - val_t_minus_2)
        else:
            trend = np.nan

        prev1_list.append(val_t_minus_1)
        prev2_list.append(val_t_minus_2)
        trend_list.append(trend)

    df["prev_year_registered"] = prev1_list
    df["prev2_year_registered"] = prev2_list
    df["registered_trend_3y"] = trend_list

    return df

def prepare_features_df(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
    """
    Extract X (categorical + numeric features) and y from dataframe.
    Validates that no forbidden features are included.
    """
    validate_features_no_leakage(ALL_FEATURES)

    X = df[ALL_FEATURES].copy()
    for col in CATEGORICAL_FEATURES:
        X[col] = X[col].astype("category")

    for col in NUMERIC_FEATURES:
        X[col] = pd.to_numeric(X[col], errors="coerce")

    y = pd.to_numeric(df[TARGET], errors="coerce") if TARGET in df.columns else pd.Series(dtype=float)
    return X, y
