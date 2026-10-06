# Phase 3: Management Changes Engine & Advanced Chatbot

This document details Phase 3 of the Smart Timetable System, comprising **Part A (Management Changes Engine)** and **Part B (Advanced Chatbot)**.

---

## 1. Architectural Philosophy

1. **AI Only Talks and Calls Tools**:
   - The chatbot LLM never calculates hours, searches schedules, or solves conflicts.
   - All factual queries, feasibility checks, substitute rankings, and timetable manipulations are performed by **deterministic TypeScript services** using SQLite and CP-SAT solvers.
2. **Preview-Only & Explicit Confirmation**:
   - Neither the chatbot nor the changes engine ever auto-commits modifications to active timetable tables (`calendar_sessions`, `timetable_slots`, `sections`).
   - Every proposal creates a staged `changes` record (`status = 'preview'`).
   - The user must explicitly inspect the proposed diff and click **"Confirm & Apply"**.
3. **Deterministic Decision Trees**:
   - Substitute selection follows strict tie-breaking (same department, qualified subject tag, fewest weekly teaching hours, lowest `staff_id`).
   - Saturday makeup scheduling adheres to calendar order and max 2 hours/day limits.
   - Intake capacity overflow uses the exact `delta` solver: swap to larger room $\to$ split section if allowed $\to$ reject with actionable explanation.

---

## 2. Part A: Management Changes Engine

### Supported Changes & Deterministic Resolvers

| Change Type | Primary Impact | Deterministic Decision Order |
|---|---|---|
| **Leave** (`leave`) | Staff unavailable on `[start_date, end_date]` | 1. Find substitute teacher with lowest workload who teaches the subject.<br>2. If no substitute, find free regular slot on calendar.<br>3. If no regular slot, schedule Saturday makeup (max 2 hrs/day).<br>4. If impossible, mark as unscheduled shortfall. |
| **Events** (`event`) | Room or full institution unavailable | 1. **Institution/Full Day**: Cancel all sessions; schedule Saturday makeups.<br>2. **Room Event**: Check vacant rooms with `capacity >= enrolled_size` at the same period; if none, schedule makeup. |
| **Intake Change** (`intake`) | Enrolled students change in `section_id` | 1. If `new_size <= current_room.capacity`, keep current room.<br>2. If overflow, search vacant rooms with `capacity >= new_size`.<br>3. If none, evaluate section split if within cohort bounds.<br>4. Otherwise flag room capacity deficit. |

### Stale Detection & Fingerprinting
- Every preview computes an MD5 timetable fingerprint based on all rows in `timetable_slots` and `calendar_sessions`.
- Before confirming a preview, the engine re-checks current fingerprint against `base_timetable_fingerprint`.
- If the timetable was modified in the interim, confirmation is aborted with `409 Conflict (stale_preview)`.

### Revert Mechanics
- When a change is confirmed, the previous state of modified rows (`calendar_sessions`, `timetable_slots`, `sections`, `leave`) is snapshotted into `applied_fixes` and `management_change_log`.
- Reverting a confirmed change performs a transactional rollback, restoring previous room IDs, staff IDs, session statuses, and dates, and marks the change record as `reverted`.

---

## 3. Part B: Advanced Chatbot

### 14 Deterministic Tools

| Tool Name | Role Allowed | Description |
|---|---|---|
| `get_my_schedule` | Student, Staff, HOD | Fetch personal schedule for a given date or range. |
| `get_room_availability` | Staff, HOD | Check room occupancy status at a specific date/period. |
| `get_staff_workload` | Staff, HOD | View weekly and daily teaching hours for faculty. |
| `check_course_hours` | Student, Staff, HOD | Compare planned vs conducted syllabus hours. |
| `explain_conflict` | HOD | Detailed diagnosis of conflicting sessions or room collisions. |
| `find_substitute_candidates` | HOD | Deterministic ranked list of replacement faculty. |
| `find_makeup_options` | Staff, HOD | Available regular slots or Saturday slots for makeup. |
| `simulate_leave` | HOD | Preview impact of a faculty leave request without saving. |
| `simulate_event` | HOD | Preview impact of booking a room or institution event. |
| `simulate_intake_change` | HOD | Preview room and split requirements for student count changes. |
| `get_underutilized_rooms` | HOD | Analytics on rooms with low occupancy or excess idle time. |
| `get_wasted_seat_capacity` | HOD | Audit sections assigned to rooms far larger than section size. |
| `get_staff_teaching_gaps` | HOD | Identify faculty with large idle windows between classes. |
| `get_syllabus_shortfall_risks` | HOD | Flag courses projected to fall short of required hours. |

### Security & Role Enforcement
- **Server-Side Enforcement**: Tool permissions are validated in `tools.ts` using the authenticated role header (`x-user-role`). Prompts cannot bypass permission checks.
- **Prompt Injection Defense**: Inputs are sanitized against system prompt overrides and delimiter escaping.
- **Audit Logging**: All tool invocations and user queries are recorded in `audit_log` with timestamp, user ID, role, tool name, arguments, and execution duration.

### Bilingual Support (Tamil & English)
- The system automatically detects Tamil Unicode characters (`[\u0B80-\u0BFF]`) or accepts explicit language header `x-user-language: ta`.
- Replies are presented in conversational Tamil with key terms (Room IDs, Course codes) maintained for clarity.
- Machine-assisted translation notice is displayed in the UI when Tamil is active.

---

## 4. LLM Provider Configuration

The chatbot supports multiple providers configured via environment variables:

```bash
# Provider selection: 'mock' (default), 'gemini', 'openai', 'groq', 'anthropic'
LLM_PROVIDER=mock

# Required when using an external provider:
LLM_API_KEY=your_api_key_here
LLM_MODEL=gemini-1.5-pro  # or gpt-4o, claude-3-5-sonnet, llama-3.1-70b
```

### Mock Provider (Offline & Testing)
When `LLM_PROVIDER=mock` (or when no API key is configured), the system runs an intelligent rule-based keyword & intent dispatcher that extracts entities, executes the deterministic tools, and constructs structured responses with preview cards and follow-up suggestion chips.

---

## 5. Frontend Pages & Components

1. **Management Changes Page** (`/changes`):
   - Leave, Events, and Intake submission forms.
   - Interactive preview comparison showing affected sessions, proposed fixes, and diff summary.
   - Confirm & Apply with instant validation feedback.
   - Audit history drawer with one-click **Revert** capability.
   - Stale preview alert badges.

2. **AI Assistant Page & Chat Panel** (`/assistant`):
   - Conversational chat interface with quick suggestion chips.
   - Tool execution pills showing exactly which deterministic tool was queried.
   - Staged preview cards inside the chat with direct **"Confirm & Apply"** action buttons.
   - Role switcher dropdown in header for instant testing as `HOD`, `Staff`, or `Student`.
   - English / Tamil language toggle (`EN` / `தமிழ்`).

---

## 6. Testing & Verification

Run all test suites:

```bash
# Node / TypeScript backend tests (76 Vitest tests)
npm test

# Python CP-SAT solver tests (9 Pytest tests)
npm run test:python

# Client TypeScript lint check
npm run lint --workspace=client

# Server TypeScript build
npm run build --workspace=server
```
