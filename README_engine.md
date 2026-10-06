# Module 3: Timetable Engine Documentation

## Overview
Module 3 is the core scheduling, optimization, and curricular planning engine of the Smart Timetable System. It transitions clean, normalized datasets from Module 2 (ETL) into clash-free weekly master schedules and full semester academic calendars.

```
                    ┌────────────────────────┐
                    │ Module 2: Clean DB     │
                    │ (Passed Validation Run)│
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │ Part 1: Section        │
                    │ Splitter & Sizing      │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │ Part 2: Weekly Solver  │
                    │ (Google OR-Tools       │
                    │  CP-SAT, Python 3.11)  │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │ Part 3: Semester       │
                    │ Calendar & Holidays    │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │ Part 4: Hours Check    │
                    │ & Make-up Proposals    │
                    └────────────────────────┘
```

---

## 1. Part 1 — Section Splitter

### Splitting Logic
- **Student Choice Preservation**: Preserves student faculty choices recorded during elective selection day.
- **Mandatory Cohort Batching**: For common subjects and labs where no elective choices were recorded, partitions the student cohort across qualified staff.
- **Physical Room Capacity Guard**: When splitting cohorts for lab classes (or specialized rooms), sections are capped by the maximum available room capacity (e.g. computer lab limit of 40–45 students) rather than theoretical cohort maximums.
- **Workload Limits**: Validates that assigned hours do not violate faculty contract teaching limits (`max_hours_per_week - hours_committed_elsewhere`).
- **Mid-Semester Intake Changes**: Enables manual section size editing with immediate room capacity verification, automatically marking downstream timetable and calendar schedules as **stale**.

---

## 2. Part 2 — Weekly Timetable Solver (Google OR-Tools CP-SAT)

The weekly scheduling solver is implemented in `server/engine/solve_week.py` using **Google OR-Tools CP-SAT (Constraint Programming - Satisfiability)**.

### Hard Constraints (Must NEVER be violated)
1. **Faculty Exclusivity**: No faculty member teaches two sections at the same day and period.
2. **Room Exclusivity**: No classroom or laboratory is occupied by two sections at the same day and period.
3. **Student Conflict Avoidance**: No student group or section with shared enrollments has concurrent classes.
4. **Room Capacity**: Every scheduled room must have `capacity >= section.size`.
5. **Room Type Requirement**: Lab subjects strictly schedule into `computer_lab`; theory lectures schedule into theory classrooms.
6. **Required Hours Delivery**: Each section receives exactly its prescribed `hours_per_week`.
7. **Lab Block Consecutiveness**: Lab sessions are scheduled as consecutive periods (e.g. 2 or 3 hours back-to-back) in the same room on the same day.
8. **Faculty Daily Limits**: Teaching periods per day do not exceed `max_staff_periods_per_day` (default 4).
9. **Pinned Slots**: User-pinned slots are locked and preserved across solver runs.

### Soft Objectives & Penalties
Configured in `server/engine/solver_config.json`:
- `wasted_seats` (Weight: 1): Penalizes assigning small sections to large auditoriums.
- `staff_gaps` (Weight: 5): Encourages compact faculty daily schedules without dead hours.
- `staff_consecutive_excess` (Weight: 10): Avoids faculty teaching more than 2 consecutive hours without a break.
- `subject_daily_repeat` (Weight: 8): Spreads theory lectures across different days rather than same-day repetitions.
- `late_period_load` (Weight: 2): Soft preference for morning and early afternoon periods over late-day slots.

### Infeasibility Diagnosis
If mathematical constraints make a clash-free schedule impossible, the pre-check and solver diagnostics return plain-English explanations:
- *Example*: `"Infeasible: 8 lab sections require computer labs, but 0 active computer lab rooms are available in the facility."`
- *Example*: `"Infeasible: Section CS311-S1 has size 54, but the largest available computer_lab room has capacity 45."`

### 100% Determinism
- Fixed random seed: `42`.
- Single-threaded search: `num_workers = 1`.
- Running the solver repeatedly on identical data produces identical schedules, objectives, and slot assignments.

---

## 3. Part 3 — Semester Calendar Expansion

### Academic Dates & Holiday Skipping
- Repeats the weekly master schedule across the entire semester duration (`semester_start` to `semester_end`, e.g. July 6 to November 27, 2026).
- Dates falling on gazetted public holidays (`holidays_clean` where `ignored = 0`) are skipped with status `skipped_holiday`.
- Approved faculty leaves are skipped for their respective sections with status `skipped_leave`.
- Campus-wide university symposiums or exam events are skipped with status `skipped_event`.

---

## 4. Part 4 — Curricular Hours Check & Make-up Proposals

### Shortfall Calculation
For every section:
$$\text{Shortfall Hours} = \max(0, \text{Required Hours} - \text{Delivered Hours})$$

### Automated Make-up Suggestions
- For sections experiencing a shortfall, the engine deterministically identifies clash-free open slots (e.g. Saturdays or open weekday periods).
- **One-Click Approval**: Clicking **Approve** immediately inserts the session into `calendar_sessions` with status `makeup` and decrements the shortfall count.

---

## 5. API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/engine/status` | GET | Engine status, Python/OR-Tools readiness, validation gate |
| `/api/engine/split` | POST | Runs section splitter |
| `/api/engine/sections` | GET | List all sections with size and faculty |
| `/api/engine/sections/:id/edit-size` | POST | Preview or confirm section size change |
| `/api/engine/solve` | POST | Launches OR-Tools CP-SAT weekly timetable solver |
| `/api/engine/solver-status` | GET | Live progress and latest solver run |
| `/api/engine/timetable` | GET | Weekly timetable slots with faculty/room/section filters |
| `/api/engine/calendar` | POST | Expands master schedule across semester dates |
| `/api/engine/calendar` | GET | List calendar sessions with date/month filtering |
| `/api/engine/hours-summary` | GET | Curricular hours delivery and shortfall report |
| `/api/engine/makeups` | GET | List proposed make-up sessions |
| `/api/engine/makeups/:id/approve` | POST | Approve make-up session and update calendar |
| `/api/engine/makeups/:id/reject` | POST | Reject make-up session |
| `/api/engine/export/timetable.csv` | GET | Download weekly timetable as CSV |
| `/api/engine/export/hours.csv` | GET | Download hours delivery summary as CSV |

---

## 6. Verification & Test Commands

```bash
# Run all Vitest tests (62 unit and integration tests)
npm test

# Run specific engine test suites
npx vitest run tests/engine_splitter.test.ts
npx vitest run tests/engine_solver.test.ts
npx vitest run tests/engine_calendar.test.ts

# Run Python OR-Tools solver unit tests
python -m pytest server/engine/tests

# Build client and server bundles
npm run build
```
