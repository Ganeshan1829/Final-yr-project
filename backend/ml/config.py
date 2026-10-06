import os
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Database configuration (shared SQLite DB with Express backend)
DB_PATH = Path(os.environ.get("SQLITE_DB_PATH", BASE_DIR / "server" / "data" / "app.db"))

DB_PATH.parent.mkdir(parents=True, exist_ok=True)  # fresh clones have no server/data yet

# Models storage directory
MODELS_DIR = BASE_DIR / "backend" / "ml" / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Seed files directory
SEED_DIR = BASE_DIR / "backend" / "ml" / "seed"
if not SEED_DIR.exists():
    SEED_DIR = BASE_DIR / "server" / "ml" / "seed"

HISTORICAL_SEED_FILE = SEED_DIR / "historical_enrollment_extended.csv"
FORECAST_INPUT_SEED_FILE = SEED_DIR / "forecast_input_2026-27.csv"

# Model hyperparameters per specification
DEFAULT_HYPERPARAMETERS = {
    "n_estimators": 1500,
    "learning_rate": 0.03,
    "max_depth": 5,
    "subsample": 0.85,
    "colsample_bytree": 0.85,
    "min_child_weight": 3,
    "reg_lambda": 2.0,
    "enable_categorical": True,
    "tree_method": "hist",
    "early_stopping_rounds": 60,
    "random_state": 42,
}

DEFAULT_SECTION_SIZE = 30
DEFAULT_TARGET_YEAR = "2026-27"
