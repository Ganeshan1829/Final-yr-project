"""Train an XGBoost model that predicts registered_students for each course.
Run:  python train_xgboost.py
Needs: pip install xgboost pandas scikit-learn
"""
import pandas as pd, numpy as np, xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

df = pd.read_csv("historical_enrollment_extended.csv")
TARGET = "registered_students"
# sections_opened, avg_section_size, staff_shortfall come FROM the target -> never use as features
CAT = ["department", "term", "course_type", "topic_category"]
NUM = ["semester_no", "cohort_size", "industry_demand_index", "prev_year_registered", "staff_available",
       "credits", "has_lab", "topic_trend_index", "rival_elective_trend", "dept_placement_rate_prev",
       "prereq_pass_rate", "course_age_years", "is_first_offering", "covid_flag"]
X = df[CAT + NUM].copy()
for c in CAT:
    X[c] = X[c].astype("category")
y = df[TARGET]

tr, va, te = (df.split == "train"), (df.split == "val"), (df.split == "test")
model = xgb.XGBRegressor(
    n_estimators=1500, learning_rate=0.03, max_depth=5, subsample=0.85, colsample_bytree=0.85,
    min_child_weight=3, reg_lambda=2.0, enable_categorical=True, tree_method="hist",
    early_stopping_rounds=60, random_state=42)
model.fit(X[tr], y[tr], eval_set=[(X[va], y[va])], verbose=False)

def report(name, mask):
    p = model.predict(X[mask]); t = y[mask]
    print(f"{name:5s} MAE={mean_absolute_error(t,p):6.2f}  RMSE={np.sqrt(mean_squared_error(t,p)):6.2f}  R2={r2_score(t,p):.3f}")
report("train", tr); report("val", va); report("test", te)

# Baseline to beat: "same as last year"
base = df.loc[te, "prev_year_registered"].fillna(df.loc[te, "cohort_size"] * 0.7)
print(f"Baseline (last year's number) test MAE = {mean_absolute_error(y[te], base):.2f}")
for ct in ["core", "elective"]:
    m = te & (df.course_type == ct)
    print(f"  test {ct:8s} MAE = {mean_absolute_error(y[m], model.predict(X[m])):.2f}")

imp = pd.Series(model.feature_importances_, index=X.columns).sort_values(ascending=False)
print("\nTop features:\n", imp.head(8).round(3).to_string())

# Predict next year (2026-27)
fc = pd.read_csv("forecast_input_2026-27.csv")
Xf = fc[CAT + NUM].copy()
for c in CAT:
    Xf[c] = pd.Categorical(Xf[c], categories=X[c].cat.categories)
fc["predicted_registered"] = np.clip(np.round(model.predict(Xf)), 8, fc.cohort_size.values).astype(int)
fc["predicted_sections"] = np.ceil(fc.predicted_registered / 30).astype(int)   # the section splitter does this part
fc.to_csv("forecast_2026-27_predictions.csv", index=False)
print("\nSaved forecast_2026-27_predictions.csv")
model.save_model("demand_xgb.json")
