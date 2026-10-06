import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from backend.ml.config import DEFAULT_HYPERPARAMETERS, MODELS_DIR
from backend.ml.features import (
    ALL_FEATURES,
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
    TARGET,
    parse_year_start,
    prepare_features_df,
    validate_features_no_leakage,
)

class DemandForecastModel:
    def __init__(self, hyperparameters: Optional[Dict[str, Any]] = None):
        self.params = dict(DEFAULT_HYPERPARAMETERS)
        if hyperparameters:
            self.params.update(hyperparameters)
        self.model: Optional[xgb.XGBRegressor] = None
        self.categories_: Dict[str, List[Any]] = {}
        self.best_iteration_: int = 1500
        self.residual_std_: float = 12.0
        self.feature_names_: List[str] = ALL_FEATURES

    def train_expanding_window(
        self,
        history_df: pd.DataFrame,
        target_year: str,
    ) -> Dict[str, Any]:
        """
        Train using expanding window time-split:
        - All complete years strictly before target_year are available.
        - Validation year is the latest complete year before target_year.
        - Training years are all years before validation year.
        - Target year is NEVER included in training.
        """
        validate_features_no_leakage(ALL_FEATURES)

        df = history_df.copy()
        if "start_year" not in df.columns:
            df["start_year"] = df["academic_year"].apply(parse_year_start)

        target_start_year = parse_year_start(target_year)

        # Exclude target year and any future years from training
        eligible_df = df[df["start_year"] < target_start_year].copy()
        if eligible_df.empty:
            raise ValueError(f"No historical data available prior to target year {target_year}")

        # Unique years sorted chronologically
        sorted_years = sorted(eligible_df["academic_year"].unique(), key=parse_year_start)
        if len(sorted_years) < 2:
            raise ValueError(f"Need at least 2 complete historical years to train with validation. Found: {sorted_years}")

        val_year = sorted_years[-1]
        val_start_year = parse_year_start(val_year)
        train_years = sorted_years[:-1]

        # Time-split strictly by year
        train_mask = eligible_df["start_year"] < val_start_year
        val_mask = eligible_df["academic_year"] == val_year

        X_eligible, y_eligible = prepare_features_df(eligible_df)

        # Store category categories for robust inference
        for col in CATEGORICAL_FEATURES:
            self.categories_[col] = list(X_eligible[col].cat.categories)

        X_train, y_train = X_eligible[train_mask], y_eligible[train_mask]
        X_val, y_val = X_eligible[val_mask], y_eligible[val_mask]

        # 1. Train on training split with early stopping on validation split
        estimator = xgb.XGBRegressor(**self.params)
        estimator.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

        self.best_iteration_ = getattr(estimator, "best_iteration", None) or 300
        val_preds = estimator.predict(X_val)

        # 2. Compute evaluation metrics on validation year
        mae = float(mean_absolute_error(y_val, val_preds))
        rmse = float(np.sqrt(mean_squared_error(y_val, val_preds)))
        r2 = float(r2_score(y_val, val_preds))

        # Baseline to beat: "same as last year" (prev_year_registered, or cohort_size * 0.7 if missing)
        val_subset = eligible_df[val_mask]
        baseline_preds = val_subset["prev_year_registered"].fillna(val_subset["cohort_size"] * 0.7).values
        baseline_mae = float(mean_absolute_error(y_val, baseline_preds))

        # Core vs Elective breakdown
        core_mask = val_subset["course_type"] == "core"
        elective_mask = val_subset["course_type"] == "elective"

        core_mae = (
            float(mean_absolute_error(y_val[core_mask], val_preds[core_mask.values]))
            if core_mask.sum() > 0
            else None
        )
        elective_mae = (
            float(mean_absolute_error(y_val[elective_mask], val_preds[elective_mask.values]))
            if elective_mask.sum() > 0
            else None
        )

        beats_baseline = mae <= baseline_mae
        pct_improvement = (
            float(((baseline_mae - mae) / baseline_mae) * 100.0)
            if baseline_mae > 0
            else 0.0
        )

        residuals = y_val.values - val_preds
        self.residual_std_ = float(np.std(residuals)) if len(residuals) > 0 else 12.0

        # Feature importances
        importances = estimator.feature_importances_
        feature_importances = [
            {"feature": feat, "importance": round(float(imp), 4)}
            for feat, imp in zip(ALL_FEATURES, importances)
        ]
        feature_importances.sort(key=lambda x: x["importance"], reverse=True)

        # 3. Refit on train + validation using best_iteration so full history is utilized
        refit_params = dict(self.params)
        refit_params.pop("early_stopping_rounds", None)
        refit_params["n_estimators"] = max(50, self.best_iteration_)

        self.model = xgb.XGBRegressor(**refit_params)
        self.model.fit(X_eligible, y_eligible, verbose=False)

        return {
            "target_year": target_year,
            "train_years": train_years,
            "val_year": val_year,
            "all_trained_years": sorted_years,
            "mae": round(mae, 2),
            "rmse": round(rmse, 2),
            "r2": round(r2, 3),
            "baseline_mae": round(baseline_mae, 2),
            "core_mae": round(core_mae, 2) if core_mae is not None else None,
            "elective_mae": round(elective_mae, 2) if elective_mae is not None else None,
            "beats_baseline": beats_baseline,
            "pct_improvement": round(pct_improvement, 1),
            "feature_importances": feature_importances,
            "best_iteration": self.best_iteration_,
            "residual_std": round(self.residual_std_, 2),
        }

    def predict_target_year(
        self,
        forecast_df: pd.DataFrame,
        section_size: int = 30,
    ) -> pd.DataFrame:
        """
        Generate predictions for courses in target year:
        - Clips to [8, cohort_size]
        - Computes 90% prediction intervals [low, high]
        - Computes predicted sections: ceil(predicted_registered / section_size)
        - Computes staff shortfall
        """
        if self.model is None:
            raise RuntimeError("Model has not been trained or loaded.")

        df = forecast_df.copy()
        validate_features_no_leakage(ALL_FEATURES)

        X = df[ALL_FEATURES].copy()
        for col in CATEGORICAL_FEATURES:
            categories = self.categories_.get(col)
            if categories:
                X[col] = pd.Categorical(X[col], categories=categories)
            else:
                X[col] = X[col].astype("category")

        for col in NUMERIC_FEATURES:
            X[col] = pd.to_numeric(X[col], errors="coerce")

        raw_preds = self.model.predict(X)
        cohort_sizes = pd.to_numeric(df["cohort_size"], errors="coerce").fillna(120).values

        # Clip predictions to [8, cohort_size] and round to int
        clipped_preds = np.clip(np.round(raw_preds), 8, cohort_sizes).astype(int)

        # 90% prediction interval: +/- 1.645 * residual_std
        margin = 1.645 * max(5.0, self.residual_std_)
        low_intervals = np.clip(np.round(raw_preds - margin), 8, cohort_sizes).astype(int)
        high_intervals = np.clip(np.round(raw_preds + margin), 8, cohort_sizes).astype(int)

        # Section planning
        predicted_sections = np.ceil(clipped_preds / float(section_size)).astype(int)

        staff_avail = pd.to_numeric(df.get("staff_available", 0), errors="coerce").fillna(5).astype(int).values
        staff_shortfalls = (predicted_sections > staff_avail).astype(int)

        prev_actuals = pd.to_numeric(df.get("prev_year_registered", np.nan), errors="coerce").values
        change_pcts = []
        for pred, prev in zip(clipped_preds, prev_actuals):
            if pd.notna(prev) and prev > 0:
                change_pcts.append(round(((pred - prev) / prev) * 100.0, 1))
            else:
                change_pcts.append(None)

        df["predicted_registered"] = clipped_preds
        df["low_interval"] = low_intervals
        df["high_interval"] = high_intervals
        df["predicted_sections"] = predicted_sections
        df["last_year_actual"] = [int(p) if pd.notna(p) else None for p in prev_actuals]
        df["change_pct"] = change_pcts
        df["is_staff_shortfall"] = staff_shortfalls
        df["sections_needed"] = predicted_sections

        return df

    def save(self, filepath: Path) -> None:
        """Serialize model, category states, and residual metrics."""
        filepath = Path(filepath)
        filepath.parent.mkdir(parents=True, exist_ok=True)

        meta = {
            "params": self.params,
            "categories": self.categories_,
            "best_iteration": self.best_iteration_,
            "residual_std": self.residual_std_,
            "feature_names": self.feature_names_,
        }
        meta_path = filepath.with_suffix(".meta.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        if self.model is not None:
            self.model.save_model(str(filepath))

    @classmethod
    def load(cls, filepath: Path) -> "DemandForecastModel":
        """Load trained model and metadata from disk."""
        filepath = Path(filepath)
        meta_path = filepath.with_suffix(".meta.json")

        inst = cls()
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            inst.params = meta.get("params", DEFAULT_HYPERPARAMETERS)
            inst.categories_ = meta.get("categories", {})
            inst.best_iteration_ = meta.get("best_iteration", 300)
            inst.residual_std_ = meta.get("residual_std", 12.0)
            inst.feature_names_ = meta.get("feature_names", ALL_FEATURES)

        inst.model = xgb.XGBRegressor()
        inst.model.load_model(str(filepath))
        return inst
