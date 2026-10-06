# Smart Timetable and Resource Planning System
## Module 1: Inputs and Upload Web Application

Module 1 is the foundational intake subsystem of the **Smart Timetable and Resource Planning System**. It collects all inputs required by the scheduling engine, verifies structural file integrity without modifying raw data, stores raw ingested records into SQLite, and provides a real-time readiness dashboard.

Subsequent modules (Rule-based ETL, Section Splitter, OR-Tools Timetable Engine, Calendar, Dashboard, and Chatbot) consume data initialized by this module.

---

## Architecture & Technology Stack

### Frontend (`/client`)
- **Core:** React 18, TypeScript (strict mode), Vite 6
- **Routing:** React Router v7
- **Data & State Management:** TanStack Query (React Query v5)
- **Forms & Validation:** `react-hook-form` with `zod` schema resolvers
- **Styling:** Tailwind CSS with custom enterprise design tokens:
  - Palette: Navy (`#0B2545`), Accent Blue (`#1F6FEB`), Page Background (`#F5F7FA`), Cards (`#FFFFFF` with 1px `#E3E8EF` border), Status tones (Success `#1E7F5C`, Warning `#B7791F`, Error `#B42318`)
  - Typography: Inter font, 14px base, 600 weight headings, tabular numbers
- **Components & Icons:** Lucide React icons (16-18px outline), custom component suite (`Button`, `Badge`, `Card`, `Table`, `Drawer`, `Dialog`, `FormField`, `Stat`, `EmptyState`, `Skeleton`, `PageHeader`)
- **File Ingestion & Feedback:** `react-dropzone` and `sonner` toasts

### Backend (`/server`)
- **Runtime & Server:** Node.js, Express, TypeScript (strict mode)
- **Database:** SQLite database located at `server/data/app.db` via built-in high-performance `node:sqlite`
- **File Parsing & Validation:** PapaParse (CSV), SheetJS `xlsx` (Excel first-sheet parser), Multer (memory buffer storage, 10MB limit)
- **Security & Logging:** Helmet, CORS (locked to Vite dev origin), Pino and `pino-http` logging
- **Backend-Only Chatbot Services:** Dedicated typed services for `events` and `leave` with business validation rules against uploaded rooms and faculty

### Monorepo Structure
- **npm Workspaces:** Unified root `package.json` coordinating `/client` and `/server`
- **Sample Benchmark Data:** Realistic sample CSVs in `/sample-data`

---

## Folder Structure

```
project 2 main/
├── package.json               # Root workspace package.json
├── tsconfig.json              # Root TypeScript config
├── vitest.config.ts           # Vitest unit & E2E test runner config
├── .env.example               # Environment variables template
├── sample-data/               # Benchmark CSV datasets
│   ├── students_choices.csv   # 960 rows (160 students x 6 course electives)
│   ├── subjects.csv           # 8 courses
│   ├── rooms.csv              # 17 campus venues
│   ├── staff.csv              # 14 faculty members
│   ├── holidays.csv           # 11 institutional holidays
│   ├── rules.csv              # Academic rules & timings
│   ├── events.csv             # Campus symposium & workshop events
│   └── leave.csv              # Faculty leave applications
├── server/
│   ├── package.json           # Server dependencies & scripts
│   ├── tsconfig.json          # Server TypeScript config
│   ├── data/                  # SQLite database location (app.db)
│   ├── uploads/               # Stored uploaded files by dataset
│   └── src/
│       ├── index.ts           # Express server entry point & middleware
│       ├── db.ts              # SQLite database schema initialization
│       ├── schemas/
│       │   ├── datasets.ts    # Single shared dataset definitions & schema
│       │   └── rules.ts       # Rules Zod schema & CSV converters
│       ├── services/
│       │   ├── validator.ts   # CSV/XLSX parser and structural validator
│       │   ├── uploadService.ts # Ingestion, storage, preview & template service
│       │   ├── rulesService.ts  # Rules persistence & CSV import/export
│       │   ├── holidaysService.ts # Holidays CRUD & date bounds validation
│       │   ├── readinessService.ts # Readiness calculation service
│       │   ├── eventsService.ts  # Backend-only event service & validation
│       │   └── leaveService.ts   # Backend-only leave service & validation
│       ├── routes/            # REST API route handlers
│       │   ├── schemas.ts     # GET /api/schemas
│       │   ├── datasets.ts    # GET /api/datasets, POST upload, preview, template
│       │   ├── rules.ts       # GET/PUT /api/rules, import, export
│       │   ├── holidays.ts    # CRUD /api/holidays, import
│       │   ├── sample.ts      # POST /api/sample/load
│       │   ├── readiness.ts   # GET /api/readiness
│       │   ├── events.ts      # POST/GET/DELETE /api/events
│       │   └── leave.ts       # POST/GET/DELETE /api/leave
│       ├── middleware/
│       │   └── errorHandler.ts # Central standardized error handler
│       └── scripts/
│           ├── generateSampleData.ts # Sample CSV generator
│           └── seedChatbotInputs.ts  # Seed events.csv & leave.csv
├── client/
│   ├── package.json           # Client dependencies & scripts
│   ├── tsconfig.json          # Client TypeScript config
│   ├── vite.config.ts         # Vite configuration with /api proxy to port 4000
│   ├── tailwind.config.js     # Enterprise theme tokens
│   ├── src/
│   │   ├── main.tsx           # React DOM root
│   │   ├── App.tsx            # App router & providers
│   │   ├── index.css          # CSS variables & typography
│   │   ├── lib/
│   │   │   ├── api.ts         # Typed API client
│   │   │   └── utils.ts       # Formatting utilities
│   │   ├── schemas/
│   │   │   └── rules.ts       # Client-side rules schema
│   │   ├── components/
│   │   │   ├── common/        # Shared enterprise UI components
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Badge.tsx
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── Table.tsx
│   │   │   │   ├── Drawer.tsx
│   │   │   │   ├── Dialog.tsx
│   │   │   │   ├── FormField.tsx
│   │   │   │   ├── Stat.tsx
│   │   │   │   ├── EmptyState.tsx
│   │   │   │   ├── Skeleton.tsx
│   │   │   │   └── PageHeader.tsx
│   │   │   └── layout/
│   │   │       └── AppLayout.tsx # Navy sidebar & 4-step workflow bar
│   │   └── pages/
│   │       ├── Overview.tsx      # Landing readiness dashboard
│   │       ├── UploadCenter.tsx  # Drag-and-drop intake cards & preview drawer
│   │       ├── RulesForm.tsx     # Academic policy & period schedule form
│   │       ├── Holidays.tsx      # Holidays table with inline add form
│   │       └── ValidationPlaceholder.tsx # Module 2 placeholder
└── tests/
    ├── validator.test.ts      # Unit tests for CSV/XLSX parser and validator
    ├── rules.test.ts          # Unit tests for Rules Zod schema
    └── e2e_api.test.ts        # Acceptance criteria & end-to-end API tests
```

---

## Getting Started

### Prerequisites
- **Node.js**: v20 or newer (Node 22 / 24 supported with zero native compilation)
- **npm**: v10 or newer

### Installation
Clone or open the project folder in your terminal and install dependencies:
```bash
npm install
```

### Running Locally
To launch both the backend server (port 4000) and the Vite frontend (port 5173) concurrently:
```bash
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser.

### Seeding Chatbot Inputs
To seed `sample-data/events.csv` and `sample-data/leave.csv` into the backend services:
```bash
npm run seed:chatbot-inputs
```

### Running Tests
Execute the full Vitest suite (17 tests covering validation, rules, parity, and acceptance criteria):
```bash
npm test
```

### Building for Production
Build both client bundle and server TypeScript:
```bash
npm run build
```

### Type Checking & Linting
```bash
npm run lint
```

---

## Environment Variables

Copy `.env.example` to `.env` if custom configuration is needed:
```bash
cp .env.example .env
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `4000` | Port for Express backend API |
| `NODE_ENV` | `development` | Set to `development` or `production` |
| `LOG_LEVEL` | `info` | Pino logging level (`info`, `debug`, `warn`, `error`) |

---

## How to Add a New Dataset Schema

All dataset schemas are centralized in one single file: `server/src/schemas/datasets.ts`.

To add a new dataset:

1. Open `server/src/schemas/datasets.ts`.
2. Add your dataset definition into `DATASET_SCHEMAS`:
   ```typescript
   export const DATASET_SCHEMAS: Record<string, DatasetDefinition> = {
     // ... existing datasets ...
     equipment: {
       id: 'equipment',
       name: 'Laboratory Equipment',
       description: 'Specialized lab instruments and software licenses',
       isRequired: false,
       keyColumns: ['equipment_id'],
       columns: [
         { name: 'equipment_id', label: 'Equipment ID', type: 'string', required: true, isKey: true },
         { name: 'equipment_name', label: 'Equipment Name', type: 'string', required: true },
         { name: 'room_id', label: 'Assigned Room', type: 'string', required: true },
         { name: 'quantity', label: 'Quantity', type: 'number', required: true },
         { name: 'status', label: 'Status', type: 'enum', required: true, enums: ['operational', 'maintenance'] }
       ]
     }
   };
   ```
3. Add the ID to `ALL_UPLOADABLE_DATASET_IDS`:
   ```typescript
   export const ALL_UPLOADABLE_DATASET_IDS = [
     'students_choices',
     'subjects',
     'rooms',
     'staff',
     'holidays',
     'equipment'
   ] as const;
   ```
4. The schema is automatically:
   - Exposed through `GET /api/schemas`
   - Validated on upload (`POST /api/datasets/equipment/upload`)
   - Downloadable as a CSV template (`GET /api/datasets/equipment/template`)
   - Rendered as an upload card in the Upload Center UI
   - Tracked in the Overview readiness checklist

---

## Module 2: Rule-Based ETL, Clean Database & Validation

Module 2 takes raw uploaded datasets (`dataset_rows`), validates them against fixed deterministic rules, applies safe non-guessing auto-fixes (trim, casing, duplicate drops, safe blank fills), records every issue in `etl_issues`, and atomically replaces the normalized clean database tables in a single SQLite transaction if and only if there are zero blocking errors.

### 1. How the ETL Works

1. **Deterministic & No AI:**
   - Every rule is pure code with zero guessing.
   - Raw uploaded data (`dataset_rows`) is never mutated.
   - Every modification is logged as an issue with `severity: 'warning'`, `action_taken` (`fixed`, `filled`, `removed`, `dropped`), `original_value`, and `new_value`.
2. **Execution Pipeline Order:**
   - **Step 1: Dataset-level Normalization & In-dataset Rules:**
     - String trimming & case normalization.
     - Type and blank checks on critical keys (quarantining unfillable rows).
     - Duplicate detection & conflicting choice resolution.
     - Deterministic blank fills from peer rows or configured rules.
     - Dataset boundary & value checks.
   - **Step 2: Cross-dataset Consistency Rules:**
     - `SUB-012`: Computer lab availability for lab subjects.
     - `SUB-013`: Qualified faculty availability per subject.
     - `SUB-014`: Zero student demand warnings.
     - `ROM-009`: Classroom capacity against `max_section_size`.
     - `STF-010`: Commitments exceeding maximum hours.
     - `STF-011`: Faculty load across cleaned student choices vs available teaching hours.
3. **Transaction Semantics (`writeCleanData`):**
   - **Status `passed` (0 errors):** Cleans child tables first and inserts all validated records into normalized tables (`subjects`, `rooms`, `staff`, `staff_subjects`, `students`, `student_choices`, `holidays_clean`) within a single `BEGIN TRANSACTION; ... COMMIT;`. Any exception triggers `ROLLBACK;`.
   - **Status `failed` (>= 1 error):** Writes issues to `etl_issues` but leaves clean tables untouched.
   - **Stale State:** Any re-upload of a dataset or rule modification automatically marks the latest run as stale (`stale = 1`), requiring a re-run before proceeding to generation.

### 2. How to Read an Issue

Every reported issue adheres to the following specification:
- `rule_code`: Identifier such as `STU-001`, `ROM-008`, `STF-011`.
- `dataset`: Ingestion source (`rules`, `subjects`, `rooms`, `staff`, `holidays`, `students_choices`, or `cross_dataset`).
- `row_number`: 1-based row index in the raw file (0 for table-wide/cross-dataset issues).
- `column_name`: Cell column name or composite key (e.g., `CS6101/ST001`).
- `severity`:
  - `error`: Blocks the pipeline. Clean database tables are NOT touched.
  - `warning`: Reported for auditability. Does NOT block clean table synchronization. All auto-fixes produce warnings.
- `action_taken`: `fixed`, `filled`, `removed`, `dropped`, `quarantined`, or `blocked`.
- `original_value`: Original raw string or null.
- `new_value`: Sanitized value or null.
- `message`: Explicit, human-readable reason.

### 3. How to Add a Rule

1. Create or open the appropriate dataset rule file in `server/src/etl/rules/` (e.g., `subjectsRules.ts`).
2. Define your rule adhering to the `RuleDefinition` interface:
   ```typescript
   import { RuleDefinition, EtlContext } from '../types.js';

   export const ruleSub015: RuleDefinition = {
     code: 'SUB-015',
     dataset: 'subjects',
     severity: 'warning',
     description: 'Subject name should not exceed 100 characters',
     run: (ctx: EtlContext) => {
       for (const row of ctx.datasets.subjects) {
         if (row.data.subject_name && row.data.subject_name.length > 100) {
           ctx.report({
             rule_code: 'SUB-015',
             dataset: 'subjects',
             row_number: row.row_number,
             column: 'subject_name',
             severity: 'warning',
             original_value: row.data.subject_name,
             new_value: row.data.subject_name.substring(0, 100),
             action_taken: 'fixed',
             message: 'Subject name truncated to 100 characters',
           });
           row.data.subject_name = row.data.subject_name.substring(0, 100);
         }
       }
     },
   };
   ```
3. Register the rule in `server/src/etl/registry.ts`:
   ```typescript
   registerRule(ruleSub015);
   ```
4. The rule runner automatically discovers and executes it in order with zero changes to `runner.ts`. `GET /api/etl/rules` and the Validation Page rule catalog drawer will immediately show it.

---

## Acceptance Criteria Verification (Module 1 & 2)

- [x] **Acceptance Criterion 1 (Clean Baseline):** With clean sample data, ETL passes with 0 errors, 8 warnings (all `STF-011` faculty load warnings). Clean row counts: `student_choices` 960, `subjects` 8, `rooms` 17, `staff` 14, `holidays_clean` 11.
- [x] **Acceptance Criterion 2 (Dirty Fixable):** With `students_choices_DIRTY_fixable.csv`, ETL passes with 0 errors and logs STU-001 x15, STU-002 x10, STU-003 x12, STU-004 x5, STU-005 x16, and STU-012 x2. Clean student choices rows: 958.
- [x] **Acceptance Criterion 3 (Dirty Blocking):** With blocking errors, ETL fails with errors, clean database tables remain unchanged, and every error has its row number and column.
- [x] **Acceptance Criterion 4 (No Lab Room):** Without an active computer lab, ETL fails with `SUB-012` on both lab subjects naming the missing computer lab.
- [x] **Acceptance Criterion 5 (Schema Completeness):** Clean tables (`students`, `student_choices`, `staff_subjects`, etc.) are populated; `sections`, `timetable_slots`, and `calendar_sessions` exist and are empty for Module 3.
- [x] **Acceptance Criterion 6 (Stale Invalidation):** Re-uploading any dataset marks the last run as stale (`stale = 1`), displays the stale notice, and disables "Proceed to Generate".
- [x] **Seamless Setup & Tests:** `npm test` passes all 49 tests, and both client and server build cleanly.

