# Demand Forecast (Phase 2, Optional) - ML Module

## Overview

The **Demand Forecast** module is an **optional advisory planning component** within the Smart Timetable System. Its objective is to predict student course enrollment demand **before** student selection day, translating expected numbers of registered students into recommended section counts:

$$\text{predicted\_sections} = \left\lceil \frac{\text{predicted\_registered}}{\text{section\_size}} \right\rceil \quad (\text{default section size} = 30)$$

This enables the Head of Department (HOD) and timetable planners to anticipate faculty workloads, lab requirements, and room capacities well ahead of time.

> **CRITICAL ARCHITECTURAL GUARANTEE:**
> - Demand Forecast is **completely optional**.
> - It **never** modifies real student choices (`student_choices`), raw uploaded tables, or Module 2 clean database tables (`subjects`, `rooms`, `staff`, `students`, `holidays_clean`).
> - The timetable generation engine (Module 3) operates seamlessly with or without this module. If no forecast has been run, `/api/forecast/section-plan` simply returns an empty array `[]`.

---

## 1. The Expanding Window Yearly Cycle

Training adheres strictly to a **chronological expanding window**; data is **never split randomly** across time.

### Annual Cycles
- **Cycle 1:** Train on historical data up to **2025-26** $\rightarrow$ Predict upcoming **2026-27**.
- **Cycle 2:** Add **2026-27** real actuals $\rightarrow$ Train on all data up to **2026-27** $\rightarrow$ Predict **2027-28**.
- **Cycle 3:** Add **2027-28** real actuals $\rightarrow$ Train on all data up to **2027-28** $\rightarrow$ Predict **2028-29** (incorporating 2027-28, 2026-27, and all 22+ preceding years).

### Operational Rules
1. **Target Year Isolation:** The year being predicted is **never** included in training data.
2. **Lag Rebuilding:** Dynamic lag features (`prev_year_registered`, `prev2_year_registered`, `registered_trend_3y`) are automatically recomputed from full history on each cycle.
3. **Missing Lags Stay NaN:** When a course has no prior history (e.g. newly introduced courses or first offerings), lag values remain `NaN` / `None`. They are **never imputed or filled with zero**. XGBoost's histogram tree method (`tree_method="hist"`) natively learns the optimal missing value split directions.
4. **Early Stopping & Refit:** The latest completed historical year serves as the validation set for early stopping (`early_stopping_rounds=60`). Once the optimal iteration is found, the model is refitted across the entire combined dataset (`train + validation`) to maximize predictive accuracy for the upcoming target year.

---

## 2. Feature Schema & Leakage Guard

### Permitted ML Features
- **Categorical:** `department`, `term`, `course_type`, `topic_category`
- **Numerical:**
  - `semester_no`, `cohort_size`, `credits`, `has_lab`, `course_age_years`, `is_first_offering`, `covid_flag`
  - `industry_demand_index`, `topic_trend_index` *(Assumed values for future years)*
  - `staff_available` *(Assumed capacity for future years)*
  - `dept_placement_rate_prev`, `prereq_pass_rate`, `rival_elective_trend`
  - **Dynamic Historical Lags:** `prev_year_registered`, `prev2_year_registered`, `registered_trend_3y`

### Strictly Forbidden Features (Leakage Guard)
The following columns represent post-enrollment timetable outcomes or metadata and are **never** permitted as features:
- `sections_opened`
- `avg_section_size`
- `staff_shortfall`
- `split`
- `record_id`
- `is_synthetic`

This restriction is enforced in code via `validate_features_no_leakage()` in `backend/ml/features.py` and validated by unit tests in `backend/ml/tests/test_forecast.py`.

---

## 3. Champion / Challenger Model Registry

Every training run produces an immutable, versioned model artifact (`v1`, `v2`, etc.) persisted to disk:
- **Automatic Promotion Rule:** A newly trained challenger model is promoted to the **Champion** if and only if its validation MAE on the latest complete year is less than or equal to the current champion's MAE:
  $$\text{Challenger MAE} \le \text{Champion MAE}$$
- **HOD Manual Override:** The HOD can manually review model metrics in the model registry table and promote any historical version via the UI or `POST /api/forecast/models/{version}/promote`.

---

## 4. How to Add a New Year of Actuals

When an academic year completes and actual registration numbers are finalized:
1. Navigate to `/forecast` $\rightarrow$ **1. History** tab.
2. Click **Upload actuals for a finished year**.
3. Download the CSV template if needed (`GET /api/forecast/history/template`).
4. Select your CSV or Excel file containing columns:
   `academic_year, term, department, semester_no, subject_code, subject_name, course_type, cohort_size, registered_students, staff_available, credits, has_lab, ...`
5. Click **Import Actuals**.
   - **Idempotent Upsert:** Re-importing a year completely replaces that year's records; it never duplicates data.
   - **Automatic Stale Detection:** The system flags existing models and predictions as *stale*, reminding the HOD to retrain the model.
   - **Lags Rebuilt:** 1-year, 2-year, and 3-year trend metrics are recalculated dynamically across the entire historical database.

---

## 5. How to Read Accuracy Metrics

- **Validation MAE (Mean Absolute Error):** The average number of students by which the model's prediction deviates from actual enrollment per course. (e.g. `MAE = 14.2` means predictions are within $\pm 14$ students on average).
- **Validation RMSE:** Penalizes larger outlier errors more heavily.
- **Validation $R^2$:** Proportion of variance in student enrollment explained by the model features.
- **Baseline MAE ("Same as Last Year"):** A naive benchmark forecasting that each course will enroll the exact same number of students as the prior year.
- **Improvement %:**
  $$\text{Improvement} = \frac{\text{Baseline MAE} - \text{Model MAE}}{\text{Baseline MAE}} \times 100\%$$
  - If the model beats the baseline, a badge indicates `+X% vs Baseline`.
  - If the model underperforms the baseline, an honest amber warning is displayed in both the training panel and backtest table.
- **Core vs Elective Breakdown:** Separate MAE calculations for mandatory core subjects (predictable demand) versus electives (subject to shifting student preferences).

---

## 6. Prediction Guardrails & Module 3 Hand-off

1. **Prediction Clipping:** Predictions are strictly clipped to the valid domain:
   $$\text{predicted} \in [8, \text{cohort\_size}]$$
2. **Confidence Intervals:** 90% confidence lower and upper bounds are computed using backtest residual standard deviations ($\pm 1.645 \cdot \sigma$).
3. **Module 3 Timetable Hand-off:**
   - Endpoint: `GET /api/forecast/section-plan`
   - Returns a structured list of courses with `predicted_sections`, `predicted_registered`, `staff_available`, and `staff_shortfall`.
   - If no forecast has been executed, it cleanly returns `[]`. The timetable generator continues with standard cohort rules.

---

## 7. Known Limitations & Synthetic Data Notice

- **Synthetic Seed Data:** Historical enrollment data (22 years across 8 departments and 256 courses) is synthetically generated based on realistic curriculum patterns. All records are tagged with `is_synthetic = 1` and displayed with a **Synthetic Data** badge.
- **Assumed Future Indices:** Parameters such as future `industry_demand_index`, `topic_trend_index`, and `staff_available` are assumed values. Planners should calibrate these in the **Assumptions** tab prior to generating predictions.
- **Subject Code Alignment:** Historical subject codes (e.g., `CS601`) may vary from semester engine codes (e.g., `CS6101`). The system maintains a `forecast_subject_map` to normalize and cross-reference course names automatically.

---

## 8. Running Tests

### Run Backend Python / ML Tests (Pytest)
```bash
# Verify leakage guards, expanding window cycle, idempotent imports, and promotion rules
python -m pytest backend/ml/tests -v
# or via npm script
npm run test:python
```

### Run Full System Vitest Tests (Modules 1 & 2)
```bash
# Verify all existing 49 unit, integration, and ETL tests continue to pass
npm test
```

### Run Type Checking & Build
```bash
npm run lint
npm run build
```
