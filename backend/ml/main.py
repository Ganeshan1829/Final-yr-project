from datetime import datetime
import io
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
import pandas as pd

from backend.ml.class_size import (
    ensure_synthetic_file,
    get_class_size_report,
    predict_class_sizes,
    train_class_size_models,
)
from backend.ml.service import (
    generate_predictions,
    get_accuracy_report,
    get_forecast_status,
    get_model_registry,
    get_predictions,
    get_section_plan,
    get_subject_mappings,
    get_target_inputs,
    import_historical_year,
    promote_model_version,
    save_target_inputs,
    seed_historical_data,
    train_demand_model,
    update_subject_mapping,
)

app = FastAPI(
    title="Demand Forecast Service (Phase 2)",
    description="XGBoost-based student demand and course section prediction service",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/api/forecast", tags=["Demand Forecast"])

class TrainRequest(BaseModel):
    target_year: str = "2026-27"
    force_promote: bool = False

class PredictRequest(BaseModel):
    target_year: str = "2026-27"
    section_size: int = 30
    model_version: Optional[str] = None

class SubjectMapUpdate(BaseModel):
    ml_subject_code: str
    engine_subject_code: str

# 1. Status
@router.get("/status")
def status_endpoint() -> Dict[str, Any]:
    return get_forecast_status()

# 2. History Seed
@router.post("/history/seed")
def seed_endpoint() -> Dict[str, Any]:
    try:
        return seed_historical_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 3. History Template Download
@router.get("/history/template")
def template_endpoint():
    template_cols = [
        "academic_year", "term", "department", "semester_no",
        "subject_code", "subject_name", "course_type",
        "cohort_size", "industry_demand_index", "staff_available",
        "registered_students", "credits", "has_lab", "topic_category"
    ]
    df = pd.DataFrame(columns=template_cols)
    csv_str = df.to_csv(index=False)
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="historical_enrollment_template.csv"'}
    )

# 4. History Import (Finished Year Actuals)
@router.post("/history/import")
async def import_endpoint(file: UploadFile = File(...)) -> Dict[str, Any]:
    try:
        contents = await file.read()
        return import_historical_year(contents, file.filename or "import.csv")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 5. Training
@router.post("/train")
def train_endpoint(req: TrainRequest = TrainRequest()) -> Dict[str, Any]:
    try:
        return train_demand_model(target_year=req.target_year, force_promote=req.force_promote)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 6. Inputs & Editable Assumptions
@router.get("/inputs")
def get_inputs_endpoint(target_year: str = Query("2026-27")) -> Dict[str, Any]:
    inputs = get_target_inputs(target_year)
    return {"target_year": target_year, "inputs": inputs, "count": len(inputs)}

@router.put("/inputs")
def save_inputs_endpoint(inputs: List[Dict[str, Any]], target_year: str = Query("2026-27")) -> Dict[str, Any]:
    try:
        return save_target_inputs(target_year, inputs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 7. Predict
@router.post("/predict")
def predict_endpoint(req: PredictRequest = PredictRequest()) -> Dict[str, Any]:
    try:
        return generate_predictions(
            target_year=req.target_year,
            section_size=req.section_size,
            model_version=req.model_version,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except RuntimeError as re:
        raise HTTPException(status_code=400, detail=str(re))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 8. Predictions inspection
@router.get("/predictions")
def get_predictions_endpoint(target_year: Optional[str] = None) -> Dict[str, Any]:
    rows = get_predictions(target_year)
    return {"predictions": rows, "count": len(rows)}

# 9. Runs
@router.get("/runs")
def get_runs_endpoint() -> Dict[str, Any]:
    acc = get_accuracy_report()
    return {"runs": acc.get("runs", [])}

# 10. Run Predictions CSV Export
@router.get("/runs/{run_id}/export.csv")
def export_run_csv_endpoint(run_id: int):
    predictions = get_predictions()
    filtered = [p for p in predictions if p.get("run_id") == run_id]
    if not filtered:
        # Export latest predictions
        filtered = predictions

    df = pd.DataFrame(filtered)
    csv_str = df.to_csv(index=False)
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="forecast_run_{run_id}_predictions.csv"'}
    )

# 11. Section Plan (Module 3 hand-off)
@router.get("/section-plan")
def section_plan_endpoint() -> List[Dict[str, Any]]:
    return get_section_plan()

# 12. Accuracy analysis & Backtest
@router.get("/accuracy")
def accuracy_endpoint() -> Dict[str, Any]:
    return get_accuracy_report()

# 13. Model registry & Promotion
@router.get("/models")
def models_endpoint() -> List[Dict[str, Any]]:
    return get_model_registry()

@router.post("/models/{version}/promote")
def promote_endpoint(version: str, promoted_by: str = Query("HOD")) -> Dict[str, Any]:
    try:
        return promote_model_version(version, promoted_by)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 14. Subject mapping
@router.get("/subject-map")
def subject_map_endpoint() -> List[Dict[str, Any]]:
    return get_subject_mappings()

@router.put("/subject-map")
def update_subject_map_endpoint(payload: SubjectMapUpdate) -> Dict[str, Any]:
    return update_subject_mapping(payload.ml_subject_code, payload.engine_subject_code)

app.include_router(router)

# 8. Teacher-level class-size recommendation (advisory; pure - never writes to the timetable DB)
class TeacherFeatures(BaseModel):
    staff_id: str
    teacher_preferred: float
    teacher_max: float
    prev_class_size: Optional[float] = None
    subject_experience_years: Optional[float] = None
    feedback_overcrowd_rate: Optional[float] = None
    feedback_interaction: Optional[float] = None
    hist_attendance: Optional[float] = None
    prev_allocation_share: Optional[float] = None

class ClassSizeRequest(BaseModel):
    subject_code: str
    student_demand: float
    is_lab: int = 0
    credits: Optional[float] = None
    semester: Optional[int] = None
    room_capacity: Optional[float] = None
    prev_enrollment: Optional[float] = None
    teachers: List[TeacherFeatures]

class ClassSizePredictBody(BaseModel):
    requests: List[ClassSizeRequest]

@router.post("/class-size/train")
def class_size_train_endpoint(regenerate_synthetic: bool = Query(False)) -> Dict[str, Any]:
    try:
        if regenerate_synthetic:
            ensure_synthetic_file(force=True)
        return train_class_size_models()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/class-size/report")
def class_size_report_endpoint() -> Dict[str, Any]:
    return get_class_size_report()

@router.post("/class-size/predict")
def class_size_predict_endpoint(body: ClassSizePredictBody) -> Dict[str, Any]:
    try:
        reqs = [r.model_dump(exclude_none=True) for r in body.requests]
        for r, raw in zip(reqs, body.requests):
            r["teachers"] = [t.model_dump(exclude_none=True) for t in raw.teachers]
        return predict_class_sizes(reqs)
    except RuntimeError as re:
        raise HTTPException(status_code=409, detail=str(re))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def root():
    return {"service": "Demand Forecast Service", "version": "2.0.0", "status": "online"}
