import pytest
from server.engine.solve_week import solve_weekly_timetable

def test_solver_finds_feasible_solution():
    data = {
        "sections": [
            {
                "id": 1,
                "subject_code": "CS101",
                "staff_id": "STF01",
                "section_label": "CS101-S1",
                "size": 30,
                "required_room_type": "classroom",
                "hours_per_week": 3,
                "is_lab": 0,
                "lab_block_periods": 0
            },
            {
                "id": 2,
                "subject_code": "CS102",
                "staff_id": "STF02",
                "section_label": "CS102-S1",
                "size": 30,
                "required_room_type": "classroom",
                "hours_per_week": 3,
                "is_lab": 0,
                "lab_block_periods": 0
            },
            {
                "id": 3,
                "subject_code": "CS103L",
                "staff_id": "STF01",
                "section_label": "CS103L-S1",
                "size": 25,
                "required_room_type": "computer_lab",
                "hours_per_week": 2,
                "is_lab": 1,
                "lab_block_periods": 2
            }
        ],
        "rooms": [
            {
                "room_id": "R101",
                "room_name": "Classroom 101",
                "room_type": "classroom",
                "capacity": 40,
                "status": "active"
            },
            {
                "room_id": "R102",
                "room_name": "Classroom 102",
                "room_type": "classroom",
                "capacity": 40,
                "status": "active"
            },
            {
                "room_id": "LAB1",
                "room_name": "Computer Lab 1",
                "room_type": "computer_lab",
                "capacity": 30,
                "status": "active"
            }
        ],
        "rules": {
            "working_days": ["MON", "TUE", "WED", "THU", "FRI"],
            "periods_per_day": 7,
            "max_consecutive_theory_periods": 2,
            "max_staff_periods_per_day": 4
        },
        "student_conflicts": [
            [1, 3]  # Students in CS101 also attend CS103L
        ],
        "pinned_slots": [],
        "params": {
            "time_limit_seconds": 10,
            "num_workers": 2,
            "random_seed": 42
        }
    }

    res = solve_weekly_timetable(data)
    assert res["status"] in ("optimal", "feasible")
    assert len(res["slots"]) == 8  # 3 + 3 + 2
    assert res["clashes"]["room_clashes"] == 0
    assert res["clashes"]["staff_clashes"] == 0
    assert res["clashes"]["section_clashes"] == 0

    # Verify lab block is consecutive
    lab_slots = [s for s in res["slots"] if s["section_id"] == 3]
    assert len(lab_slots) == 2
    assert lab_slots[0]["day_of_week"] == lab_slots[1]["day_of_week"]
    assert lab_slots[0]["room_id"] == lab_slots[1]["room_id"]
    periods = sorted([lab_slots[0]["period"], lab_slots[1]["period"]])
    assert periods[1] == periods[0] + 1


def test_solver_diagnoses_infeasible_lab_room():
    data = {
        "sections": [
            {
                "id": 10,
                "subject_code": "CS999L",
                "staff_id": "STF01",
                "section_label": "CS999L-S1",
                "size": 30,
                "required_room_type": "computer_lab",
                "hours_per_week": 3,
                "is_lab": 1,
                "lab_block_periods": 3
            }
        ],
        "rooms": [
            {
                "room_id": "R101",
                "room_name": "Classroom 101",
                "room_type": "classroom",
                "capacity": 50,
                "status": "active"
            }
        ],
        "rules": {
            "working_days": ["MON", "TUE", "WED", "THU", "FRI"],
            "periods_per_day": 7
        },
        "params": {"time_limit_seconds": 5, "random_seed": 42}
    }

    res = solve_weekly_timetable(data)
    assert res["status"] == "infeasible"
    assert res["diagnosis"] is not None
    assert "computer lab" in res["diagnosis"].lower()


def test_solver_determinism():
    data = {
        "sections": [
            {
                "id": 1,
                "subject_code": "CS101",
                "staff_id": "STF01",
                "section_label": "CS101-S1",
                "size": 30,
                "required_room_type": "classroom",
                "hours_per_week": 3,
                "is_lab": 0,
                "lab_block_periods": 0
            },
            {
                "id": 2,
                "subject_code": "CS102",
                "staff_id": "STF02",
                "section_label": "CS102-S1",
                "size": 30,
                "required_room_type": "classroom",
                "hours_per_week": 3,
                "is_lab": 0,
                "lab_block_periods": 0
            }
        ],
        "rooms": [
            {
                "room_id": "R101",
                "room_name": "Classroom 101",
                "room_type": "classroom",
                "capacity": 40,
                "status": "active"
            }
        ],
        "rules": {
            "working_days": ["MON", "TUE", "WED", "THU", "FRI"],
            "periods_per_day": 7,
            "max_consecutive_theory_periods": 2,
            "max_staff_periods_per_day": 4
        },
        "params": {
            "time_limit_seconds": 5,
            "random_seed": 42
        }
    }

    res1 = solve_weekly_timetable(data)
    res2 = solve_weekly_timetable(data)

    assert res1["status"] == res2["status"]
    assert res1["objective"] == res2["objective"]
    assert len(res1["slots"]) == len(res2["slots"])
    slots1 = [(s["section_id"], s["day_of_week"], s["period"], s["room_id"]) for s in res1["slots"]]
    slots2 = [(s["section_id"], s["day_of_week"], s["period"], s["room_id"]) for s in res2["slots"]]
    assert sorted(slots1) == sorted(slots2)
