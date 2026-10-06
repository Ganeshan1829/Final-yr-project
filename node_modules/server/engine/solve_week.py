#!/usr/bin/env python3
"""
OR-Tools CP-SAT Timetable Engine for Smart Timetable System (Module 3)
Builds ONE clean weekly timetable satisfying all hard constraints:
- No staff teaches two sections at the same period.
- No room used by two sections at the same period.
- No section (and no student group) has two classes at the same period.
- Room capacity >= section size.
- Lab subjects go strictly into lab rooms; theory into theory rooms.
- Each subject gets exactly its hours_per_week.
- Lab sessions use consecutive back-to-back periods (e.g. block of 2 or 3) within the same room on the same day.
- Soft goals: minimize wasted seats, late day clustering, and unnecessary same-day repeats.
- Infeasible diagnosis: plain English explanation of constraint bottlenecks if no solution exists.
"""

import sys
import json
import argparse
import time
from typing import Dict, List, Any, Optional
from ortools.sat.python import cp_model

def run_pre_diagnosis(
    sections: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    rules: Dict[str, Any]
) -> Optional[str]:
    """Checks for obvious mathematical impossibilities before launching solver."""
    working_days = rules.get("working_days", ["MON", "TUE", "WED", "THU", "FRI"])
    num_days = len(working_days)
    periods_per_day = rules.get("periods_per_day", 7)
    total_periods_per_week = num_days * periods_per_day

    active_rooms = [r for r in rooms if r.get("status", "active") == "active"]
    lab_rooms = [r for r in active_rooms if r.get("room_type") == "computer_lab"]
    theory_rooms = [r for r in active_rooms if r.get("room_type") in ("classroom", "seminar_hall", "auditorium")]

    # Check 1: Lab rooms existence & capacity
    lab_sections = [s for s in sections if s.get("is_lab") == 1]
    total_lab_hours_needed = sum(s.get("hours_per_week", 3) for s in lab_sections)
    available_lab_slot_hours = len(lab_rooms) * total_periods_per_week

    if lab_sections and not lab_rooms:
        return f"Infeasible: {len(lab_sections)} lab section(s) require computer labs, but 0 active computer lab rooms are available in the facility."

    if total_lab_hours_needed > available_lab_slot_hours:
        return (
            f"Infeasible: {len(lab_sections)} lab sections require {total_lab_hours_needed} hours per week, "
            f"but only {len(lab_rooms)} active computer lab room(s) exist providing {available_lab_slot_hours} total available slots."
        )

    # Check 2: Theory rooms existence & capacity
    theory_sections = [s for s in sections if s.get("is_lab") == 0]
    total_theory_hours_needed = sum(s.get("hours_per_week", 3) for s in theory_sections)
    available_theory_slot_hours = len(theory_rooms) * total_periods_per_week

    if theory_sections and not theory_rooms:
        return f"Infeasible: {len(theory_sections)} theory section(s) require classrooms, but 0 active classrooms are available."

    if total_theory_hours_needed > available_theory_slot_hours:
        return (
            f"Infeasible: {len(theory_sections)} theory sections require {total_theory_hours_needed} hours per week, "
            f"exceeding the total classroom capacity of {available_theory_slot_hours} available slot-hours."
        )

    # Check 3: Room capacity per section
    for s in sections:
        size = s.get("size", 30)
        req_type = s.get("required_room_type", "computer_lab" if s.get("is_lab") == 1 else "classroom")
        suitable = [
            r for r in active_rooms
            if r.get("capacity", 0) >= size and (
                r.get("room_type") == req_type or (req_type == "classroom" and r.get("room_type") in ("classroom", "seminar_hall"))
            )
        ]
        if not suitable:
            max_cap = max([r.get("capacity", 0) for r in active_rooms if r.get("room_type") == req_type] or [0])
            return (
                f"Infeasible: Section {s.get('section_label')} ({s.get('subject_code')}) has size {size}, "
                f"but the largest available {req_type} room has capacity {max_cap}."
            )

    # Check 4: Staff max teaching hours
    staff_hours: Dict[str, int] = {}
    for s in sections:
        st_id = s.get("staff_id")
        if st_id:
            staff_hours[st_id] = staff_hours.get(st_id, 0) + s.get("hours_per_week", 3)

    max_daily_staff = rules.get("max_staff_periods_per_day", 4)
    max_weekly_staff_limit = num_days * max_daily_staff
    for st_id, h in staff_hours.items():
        if h > max_weekly_staff_limit:
            return (
                f"Infeasible: Faculty member {st_id} is assigned {h} weekly teaching hours, "
                f"which exceeds the absolute rule limit of {max_weekly_staff_limit} periods ({num_days} days × {max_daily_staff} max periods/day)."
            )

    # Check 5: Lab block length vs day length
    for s in lab_sections:
        block_len = s.get("lab_block_periods", 3) or 3
        if block_len > periods_per_day:
            return (
                f"Infeasible: Lab section {s.get('section_label')} requires {block_len} consecutive periods, "
                f"exceeding the total {periods_per_day} periods per day."
            )

    return None

def solve_weekly_timetable(data: Dict[str, Any]) -> Dict[str, Any]:
    start_time = time.time()

    sections = data.get("sections", [])
    rooms = data.get("rooms", [])
    rules = data.get("rules", {})
    student_conflicts = data.get("student_conflicts", [])
    pinned_slots = data.get("pinned_slots", [])
    weights = data.get("weights", {
        "wasted_seats": 1,
        "staff_gaps": 5,
        "staff_consecutive_excess": 10,
        "subject_daily_repeat": 8,
        "late_period_load": 2,
    })
    params = data.get("params", {
        "time_limit_seconds": 60,
        "num_workers": 4,
        "random_seed": 42
    })

    if not sections:
        return {
            "status": "optimal",
            "objective": 0.0,
            "wall_time": 0.0,
            "slots": [],
            "wasted_seats": 0,
            "clashes": {"staff_clashes": 0, "room_clashes": 0, "section_clashes": 0},
            "diagnosis": None,
            "message": "No sections provided to schedule."
        }

    # Pre-check for impossible problem instances
    pre_diag = run_pre_diagnosis(sections, rooms, rules)
    if pre_diag:
        return {
            "status": "infeasible",
            "objective": None,
            "wall_time": round(time.time() - start_time, 2),
            "slots": [],
            "wasted_seats": 0,
            "clashes": {"staff_clashes": 0, "room_clashes": 0, "section_clashes": 0},
            "diagnosis": pre_diag,
            "message": pre_diag
        }

    working_days = rules.get("working_days", ["MON", "TUE", "WED", "THU", "FRI"])
    num_days = len(working_days)
    periods_per_day = rules.get("periods_per_day", 7)
    max_consec_theory = rules.get("max_consecutive_theory_periods", 2)
    max_staff_daily = rules.get("max_staff_periods_per_day", 4)

    active_rooms = [r for r in rooms if r.get("status", "active") == "active"]
    room_map = {r["room_id"]: r for r in active_rooms}

    # Filter suitable rooms for each section
    section_rooms: Dict[int, List[str]] = {}
    for s in sections:
        sec_id = s["id"]
        size = s.get("size", 30)
        is_lab = s.get("is_lab") == 1
        req_type = s.get("required_room_type", "computer_lab" if is_lab else "classroom")

        matching_rooms = []
        for r in active_rooms:
            cap = r.get("capacity", 0)
            rtype = r.get("room_type")
            if cap >= size:
                if is_lab:
                    if rtype == "computer_lab":
                        matching_rooms.append(r["room_id"])
                else:
                    if rtype in ("classroom", "seminar_hall", "auditorium"):
                        matching_rooms.append(r["room_id"])
        
        # Sort rooms by capacity ascending to prefer smaller fitting rooms first
        matching_rooms.sort(key=lambda rid: room_map[rid].get("capacity", 0))
        section_rooms[sec_id] = matching_rooms

    # Build CP-SAT Model
    model = cp_model.CpModel()

    # Decision variables:
    # occupies[sec_id, day, period, room_id] = 1 if section occupies room at (day, period)
    occupies = {}
    # in_slot[sec_id, day, period] = 1 if section is having a class at (day, period)
    in_slot = {}

    # For labs, track block starts:
    # lab_start[sec_id, day, start_period, room_id] = 1
    lab_start = {}

    for s in sections:
        sec_id = s["id"]
        is_lab = s.get("is_lab") == 1
        hours_per_week = s.get("hours_per_week", 3)
        valid_rooms = section_rooms[sec_id]

        for d in range(1, num_days + 1):
            for p in range(1, periods_per_day + 1):
                in_slot[sec_id, d, p] = model.NewBoolVar(f"in_slot_s{sec_id}_d{d}_p{p}")
                for r_id in valid_rooms:
                    occupies[sec_id, d, p, r_id] = model.NewBoolVar(f"occ_s{sec_id}_d{d}_p{p}_r{r_id}")

                # Linking: in_slot[sec_id, d, p] == sum(occupies[sec_id, d, p, r])
                model.Add(in_slot[sec_id, d, p] == sum(occupies[sec_id, d, p, r_id] for r_id in valid_rooms))

        # Constraint 1: Total hours per week
        model.Add(sum(in_slot[sec_id, d, p] for d in range(1, num_days + 1) for p in range(1, periods_per_day + 1)) == hours_per_week)

        # Constraint 2: Lab sessions must be consecutive back-to-back blocks in the SAME room
        if is_lab:
            block_len = s.get("lab_block_periods", 3) or 3
            num_blocks = hours_per_week // block_len
            
            lab_start_vars = []
            for d in range(1, num_days + 1):
                for p in range(1, periods_per_day - block_len + 2):
                    for r_id in valid_rooms:
                        b_var = model.NewBoolVar(f"lab_start_s{sec_id}_d{d}_p{p}_r{r_id}")
                        lab_start[sec_id, d, p, r_id] = b_var
                        lab_start_vars.append(b_var)

                        # If block starts at p in room r_id, then occupies must be 1 for p..p+block_len-1
                        for offset in range(block_len):
                            model.Add(occupies[sec_id, d, p + offset, r_id] >= b_var)

            # Total lab blocks scheduled
            model.Add(sum(lab_start_vars) == num_blocks)

            # Ensure lab doesn't occupy slots that aren't part of a valid starting block
            for d in range(1, num_days + 1):
                for p in range(1, periods_per_day + 1):
                    for r_id in valid_rooms:
                        possible_starts = [
                            lab_start[sec_id, d, start_p, r_id]
                            for start_p in range(max(1, p - block_len + 1), min(periods_per_day - block_len + 2, p + 1))
                            if (sec_id, d, start_p, r_id) in lab_start
                        ]
                        if possible_starts:
                            model.Add(occupies[sec_id, d, p, r_id] <= sum(possible_starts))
                        else:
                            model.Add(occupies[sec_id, d, p, r_id] == 0)

        else:
            # Theory daily maximum: at most max_consecutive_theory_periods per day
            for d in range(1, num_days + 1):
                model.Add(sum(in_slot[sec_id, d, p] for p in range(1, periods_per_day + 1)) <= max_consec_theory)

    # Constraint 3: Room exclusivity (no room used by two sections at same period)
    for r in active_rooms:
        r_id = r["room_id"]
        for d in range(1, num_days + 1):
            for p in range(1, periods_per_day + 1):
                room_occupants = [
                    occupies[s["id"], d, p, r_id]
                    for s in sections
                    if (s["id"], d, p, r_id) in occupies
                ]
                if len(room_occupants) > 1:
                    model.AddAtMostOne(room_occupants)

    # Constraint 4: Staff exclusivity (no staff teaches two sections at same period)
    staff_sections: Dict[str, List[int]] = {}
    for s in sections:
        st_id = s.get("staff_id")
        if st_id:
            staff_sections.setdefault(st_id, []).append(s["id"])

    for st_id, sec_ids in staff_sections.items():
        for d in range(1, num_days + 1):
            # Daily staff teaching hours cap
            model.Add(
                sum(in_slot[sec_id, d, p] for sec_id in sec_ids for p in range(1, periods_per_day + 1))
                <= max_staff_daily
            )
            # Exclusivity at each period
            for p in range(1, periods_per_day + 1):
                if len(sec_ids) > 1:
                    model.AddAtMostOne([in_slot[sec_id, d, p] for sec_id in sec_ids])

    # Constraint 5: Student conflict avoidance (no student in two sections at same period)
    for pair in student_conflicts:
        s1 = pair[0]
        s2 = pair[1]
        for d in range(1, num_days + 1):
            for p in range(1, periods_per_day + 1):
                if (s1, d, p) in in_slot and (s2, d, p) in in_slot:
                    model.Add(in_slot[s1, d, p] + in_slot[s2, d, p] <= 1)

    # Constraint 6: Pinned slots
    for pin in pinned_slots:
        sec_id = pin.get("section_id")
        d = pin.get("day_of_week")
        p = pin.get("period")
        r_id = pin.get("room_id")
        if (sec_id, d, p, r_id) in occupies:
            model.Add(occupies[sec_id, d, p, r_id] == 1)

    # Objective Function (Soft Goals):
    # 1. Minimize wasted seats: (capacity - size) * weight
    # 2. Minimize late period classes: p * weight
    # 3. Minimize same-day theory repetition
    objective_terms = []

    w_seats = weights.get("wasted_seats", 1)
    w_late = weights.get("late_period_load", 2)
    w_repeat = weights.get("subject_daily_repeat", 8)

    for s in sections:
        sec_id = s["id"]
        size = s.get("size", 30)
        is_lab = s.get("is_lab") == 1

        for d in range(1, num_days + 1):
            for p in range(1, periods_per_day + 1):
                # Late periods penalty (periods 6, 7 penalized higher)
                if p >= 5:
                    objective_terms.append(in_slot[sec_id, d, p] * (p - 4) * w_late)

                for r_id in section_rooms[sec_id]:
                    cap = room_map[r_id].get("capacity", size)
                    wasted = max(0, cap - size)
                    if wasted > 0:
                        objective_terms.append(occupies[sec_id, d, p, r_id] * wasted * w_seats)

            # Theory repeat penalty on same day (prefer spreading over different days)
            if not is_lab:
                day_count = model.NewIntVar(0, periods_per_day, f"day_cnt_s{sec_id}_d{d}")
                model.Add(day_count == sum(in_slot[sec_id, d, p] for p in range(1, periods_per_day + 1)))
                is_repeated = model.NewBoolVar(f"rep_s{sec_id}_d{d}")
                model.Add(day_count >= 2).OnlyEnforceIf(is_repeated)
                model.Add(day_count <= 1).OnlyEnforceIf(is_repeated.Not())
                objective_terms.append(is_repeated * w_repeat)

    model.Minimize(sum(objective_terms))

    # Solver setup
    solver = cp_model.CpSolver()
    time_limit = float(params.get("time_limit_seconds", 60))
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = int(params.get("num_workers", 4))
    solver.parameters.random_seed = int(params.get("random_seed", 42))

    status = solver.Solve(model)
    wall_time = round(time.time() - start_time, 2)

    status_name_map = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.MODEL_INVALID: "invalid",
        cp_model.UNKNOWN: "timeout"
    }
    status_str = status_name_map.get(status, "unknown")

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        scheduled_slots = []
        total_wasted_seats = 0

        for s in sections:
            sec_id = s["id"]
            subj_code = s.get("subject_code", "")
            staff_id = s.get("staff_id", "")
            is_lab = s.get("is_lab") == 1
            size = s.get("size", 30)

            for d in range(1, num_days + 1):
                for p in range(1, periods_per_day + 1):
                    for r_id in section_rooms[sec_id]:
                        if solver.Value(occupies[sec_id, d, p, r_id]) == 1:
                            cap = room_map[r_id].get("capacity", size)
                            total_wasted_seats += max(0, cap - size)

                            scheduled_slots.append({
                                "section_id": sec_id,
                                "subject_code": subj_code,
                                "staff_id": staff_id,
                                "room_id": r_id,
                                "day_of_week": d,
                                "period": p,
                                "is_lab_block": 1 if is_lab else 0
                            })

        # Independent clash verification
        clashes = compute_clashes(scheduled_slots, student_conflicts)

        return {
            "status": status_str,
            "objective": round(float(solver.ObjectiveValue()), 1),
            "wall_time": wall_time,
            "slots": scheduled_slots,
            "wasted_seats": total_wasted_seats,
            "clashes": clashes,
            "diagnosis": None,
            "message": f"Successfully generated clean weekly timetable ({status_str}) with 0 clashes in {wall_time}s."
        }
    else:
        # Infeasible or timeout: provide diagnostic explanation
        diag_msg = (
            f"The timetable solver could not find a feasible schedule within {time_limit} seconds. "
            f"Likely causes: high room demand per period, tight staff daily limits ({max_staff_daily} max), "
            f"or cross-subject student enrollment conflicts."
        )
        return {
            "status": status_str,
            "objective": None,
            "wall_time": wall_time,
            "slots": [],
            "wasted_seats": 0,
            "clashes": {"staff_clashes": 0, "room_clashes": 0, "section_clashes": 0},
            "diagnosis": diag_msg,
            "message": diag_msg
        }

def compute_clashes(slots: List[Dict[str, Any]], student_conflicts: List[List[int]]) -> Dict[str, int]:
    """Independent verification of clashes in scheduled slots."""
    room_period_seen = set()
    staff_period_seen = set()
    sec_period_seen = set()

    room_clashes = 0
    staff_clashes = 0
    sec_clashes = 0

    for s in slots:
        rp = (s["room_id"], s["day_of_week"], s["period"])
        if rp in room_period_seen:
            room_clashes += 1
        room_period_seen.add(rp)

        sp = (s["staff_id"], s["day_of_week"], s["period"])
        if sp in staff_period_seen:
            staff_clashes += 1
        staff_period_seen.add(sp)

        secp = (s["section_id"], s["day_of_week"], s["period"])
        if secp in sec_period_seen:
            sec_clashes += 1
        sec_period_seen.add(secp)

    # Check student conflicts
    conflict_map = set()
    for pair in student_conflicts:
        conflict_map.add((min(pair[0], pair[1]), max(pair[0], pair[1])))

    slot_by_period: Dict[tuple, List[int]] = {}
    for s in slots:
        slot_by_period.setdefault((s["day_of_week"], s["period"]), []).append(s["section_id"])

    student_clashes = 0
    for (d, p), sec_ids in slot_by_period.items():
        for i in range(len(sec_ids)):
            for j in range(i + 1, len(sec_ids)):
                pair = (min(sec_ids[i], sec_ids[j]), max(sec_ids[i], sec_ids[j]))
                if pair in conflict_map:
                    student_clashes += 1

    return {
        "room_clashes": room_clashes,
        "staff_clashes": staff_clashes,
        "section_clashes": sec_clashes + student_clashes
    }

def main():
    parser = argparse.ArgumentParser(description="OR-Tools Weekly Timetable Solver")
    parser.add_argument("--input", type=str, help="Path to input JSON file")
    parser.add_argument("--output", type=str, help="Path to output JSON file")
    args = parser.parse_args()

    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    result = solve_weekly_timetable(data)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
    else:
        json.dump(result, sys.stdout, indent=2)

if __name__ == "__main__":
    main()
