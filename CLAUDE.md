# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Smart Timetable and Resource Planning System: a multi-stage pipeline (upload → ETL/validation → section splitter + OR-Tools solver → semester calendar → management changes + chatbot), plus an optional ML demand-forecast service. Detailed docs: `README.md` (modules 1–2), `README_engine.md` (module 3), `README_forecast.md` (ML), `README_phase3.md` (changes engine + chatbot).

Three runtimes cooperate:
- **Node/TypeScript** npm workspaces: `server/` (Express, port 4000) and `client/` (React + Vite, port 5173, proxies `/api` to 4000).
- **Python CP-SAT solver** `server/engine/solve_week.py` — spawned as a subprocess (`python`) by `server/src/services/engine/solverService.ts` using temp JSON input/output files. Needs `pip install -r server/engine/requirements.txt` (OR-Tools).
- **Python FastAPI ML service** `backend/ml/` (port 8000, optional) — Express forwards `/api/forecast/*` to it via `server/src/routes/forecastProxy.ts` (`ML_PORT` env). Returns an offline error if not running; the rest of the system works without it.

## Commands

Run from repo root:
- `npm install` — install all workspaces
- `npm run dev` — server + client together (`start.bat` does this too and also launches the ML service by default; `start.bat --no-ml` skips ML; `start.bat --test` runs tests)
- `npm run dev:ml` — ML service only (uvicorn, port 8000); deps in root `requirements.txt`
- `npm test` — Vitest (`tests/**/*.test.ts`, run serially; long timeouts since they hit the real solver)
- `npx vitest run tests/engine_solver.test.ts` — single TS test file; add `-t "name"` for one test
- `npm run test:python` — ML tests (`backend/ml/tests`); `python -m pytest server/engine/tests` for solver tests (`pytest.ini` lists both paths)
- `npm run lint` — `tsc --noEmit` for server and client (no ESLint)
- `npm run build` — `tsc` for server, `tsc && vite build` for client
- `npm run seed:chatbot-inputs` — seed events/leave sample data

Env (`.env.example`): `PORT`, `NODE_ENV`, `LOG_LEVEL`. Chatbot LLM: `LLM_PROVIDER` (`mock` default, offline), `LLM_API_KEY`, `LLM_MODEL`.

## Architecture

- **Database**: SQLite via built-in `node:sqlite` at `server/data/app.db` (Node 22+). Schema is in SQL migrations `server/src/db/migrations/00N_*.sql` applied by `migrationRunner.ts`; data access in `server/src/db/repositories/`. The ML service reads the same DB (`backend/ml/db.py`).
- **Raw vs clean data**: uploads land untouched in `dataset_rows`. The ETL (`server/src/etl/`: `registry.ts` rules, `runner.ts`, `transactionWriter.ts`) is deterministic (no AI), logs every fix/issue to `etl_issues`, and atomically replaces the clean tables only when there are zero blocking errors. The engine requires a passed validation run (see `engineValidator.ts`).
- **Dataset schemas** are defined once in `server/src/schemas/datasets.ts`; adding a dataset there automatically drives the API, upload validation, templates, UI cards and readiness (see README.md "How to Add a New Dataset Schema").
- **Engine pipeline** (`server/src/services/engine/`): `sectionSplitter` → `solverService` (CP-SAT weekly timetable) → `calendarService` (expand over semester, holidays, hours check, makeup proposals). Edits upstream mark downstream timetable/calendar as stale.
- **Changes engine + chatbot** (`services/changes`, `services/chatbot`): the LLM only calls deterministic TS tools (`tools.ts`); nothing auto-commits. Proposals are staged `changes` rows (`preview`), confirmed explicitly, guarded by a timetable fingerprint (409 `stale_preview` on mismatch), and revertible via snapshots.
- **Forecast guarantee**: the ML forecast is advisory only and must never write to student choices, raw tables or clean tables. Features are leakage-guarded (`validate_features_no_leakage` in `backend/ml/features.py`); models are versioned under `backend/ml/models/`.
- **Routes** live in `server/src/routes/` and are mounted in `server/src/index.ts`; client API calls go through `client/src/lib/api.ts`.
