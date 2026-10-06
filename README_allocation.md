# Teacher-Aware Student Allocation

Students are **not** split into fixed equal sections first. For each subject the system decides how many students each qualified teacher should take, then the timetable is generated around those sections.

```
Teacher feedback / preferences + history (SQLite)
        -> ML recommendation (advisory, backend/ml/class_size.py)
        -> Deterministic allocation engine (server/src/services/engine/allocationEngine.ts)
        -> Hard-constraint check -> Preview -> HOD confirm -> SQLite
```

The LLM only picks a tool; ML only recommends; **the backend engine is the final decision-maker.** ML never writes to the database - the backend stores its output in `class_predictions`.

## Rules
Hard (never exceeded): teacher max class size (unless the HOD sets `admin_override_max`), room capacity, remaining teaching hours, no student schedule clash on reallocation.
Soft (steer the split): teacher preferred size, ML expected size, historical successful size, workload balance, avoiding tiny sections.

Preference precedence for a teacher's preferred size: subject preference > teacher-wide preference (`subject_code='*'`) > historical average > `rules.default_section_size`.
Student choices are honoured up to the teacher's hard cap; overflow is redistributed.

## Data (migration 006/007)
`teacher_preferences`, `teacher_feedback`, `historical_allocations`, `class_predictions`, `sections.allocation_basis` (explains each section). Student demand and teacher capacity are derived from existing tables (`student_choices`, `staff`). Migration 007 only widens `changes.type` to allow `reallocation`.

## API (`/api/allocation`)
`PUT/GET /preferences`, `POST/GET /feedback`, `POST /predictions/refresh`, `GET /predictions`, `GET /distribution/:subject?total=&exclude=&ml=0`, `POST /seed-synthetic`.
Staged reallocations use the existing `/api/changes/preview` (`type: "reallocation"`), `/confirm`, `/revert`.

## Chatbot tools (HOD only; Zod-validated; audit-logged)
`predict_class_demand`, `suggest_student_distribution`, `simulate_teacher_allocation` (what-if by default; `stage: true` creates a draft that still needs HOD confirmation).

## Reallocation scope
When a teacher is unavailable, their students move to **other existing sections of the same subject** (those already have a clash-free timetable). If those sections are at room capacity or teacher maximum, students are reported as *unresolved* rather than silently overfilling; the preview lists the HOD's options.

## ML evaluation (SYNTHETIC data)
Chronological hold-out (train 2012-13..2022-23, test 2023-24..2025-26), see `backend/ml/models/class_size_metrics.json`:

| Model | MAE | RMSE | R2 |
|---|---|---|---|
| Equal distribution | 8.85 | 15.10 | -1.08 |
| Preferred-proportional | 7.35 | 14.53 | -0.92 |
| Random Forest (active) | 1.41 | 2.23 | 0.954 |
| XGBoost | 1.52 | 2.27 | 0.953 |

**Caveat:** the dataset (~2,000 rows) is generated, and its generator builds in the very relationships the model learns, so these scores show the pipeline works - not that it will predict real college demand. Retrain on real historical allocations when available (`POST /api/forecast/class-size/train`).

## UI
- **Teacher Allocation** (`/allocation`): suggested distribution vs equal split (click a teacher to mark them unavailable), teacher preferred/max editor (HOD-only override), feedback form, ML evaluation + "Refresh recommendations".
- **Manage Changes -> Teacher Reallocation**: pick unavailable teachers, preview per-section before/after with limits, confirm or discard; history shows moved/unplaced counts and supports revert.
- **Generate -> Section Splitter**: each section's size is drawn against the teacher's preferred size, hard limit and ML recommendation; hover for the rule used.
