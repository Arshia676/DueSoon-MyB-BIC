"""Study-plan scheduling. Pure functions: no Flask, no database."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

EPS = 1e-9
# (day, hours, "HH:MM" or None[, done]); `done` defaults to False
Allocation = Tuple


@dataclass(frozen=True)
class Task:
    id: int
    title: str
    course: str
    due: date
    hours: float
    start: Optional[date] = None


def build_plan(tasks: Sequence[Task], today: date, hours_per_day: float,
               capacity: Optional[Mapping[date, float]] = None,
               allocations: Optional[Mapping[int, Sequence[Allocation]]] = None,
               autofill: bool = True) -> dict:
    """Combine the student's own choices with automatic scheduling.

    1. Hours the student pinned to specific days are always honoured.
    2. If `autofill`, the remaining hours of each task are placed earliest-deadline-first,
       only between the task's start date and due date, using whatever capacity is left.
    A session ticked as done always counts as finished work. A session whose date has passed
    without being ticked is "missed": it does not count, and its hours go back into the
    plan (listed in `missed`). Future/today sessions that are not ticked still count as planned.
    `capacity` overrides the default per date (0 = day off). A day where pinned hours
    exceed capacity is reported as overbooked rather than silently changed.
    Anything that could not be placed is returned in `at_risk`.
    """
    if hours_per_day <= 0:
        raise ValueError("hours_per_day must be positive")
    capacity = capacity or {}
    allocations = allocations or {}

    def cap(day: date) -> float:
        return capacity.get(day, hours_per_day)

    used: Dict[date, float] = {}
    days: Dict[date, List[dict]] = {}
    need = {t.id: t.hours for t in tasks}
    by_id = {t.id: t for t in tasks}

    missed: List[dict] = []

    def place(day: date, task: Task, hours: float, manual: bool, start_time: Optional[str] = None,
              done: bool = False):
        used[day] = used.get(day, 0.0) + hours
        need[task.id] -= hours
        if day >= today or done:
            days.setdefault(day, []).append(
                {"task_id": task.id, "title": task.title, "course": task.course,
                 "hours": round(hours, 2), "manual": manual, "start_time": start_time, "done": done})

    for task_id, rows in allocations.items():
        if task_id in by_id:
            for day, hours, start_time, *rest in rows:
                done = bool(rest and rest[0])
                if day < today and not done:
                    missed.append({"task_id": task_id, "title": by_id[task_id].title,
                                   "date": day.isoformat(), "hours": round(hours, 2)})
                    continue
                place(day, by_id[task_id], hours, True, start_time, done)

    if autofill:
        for task in sorted(tasks, key=lambda t: (t.due, t.hours)):
            day = max(task.start or today, today)
            last = max(task.due, today)
            while need[task.id] > EPS and day <= last:
                take = min(need[task.id], cap(day) - used.get(day, 0.0))
                if take > EPS:
                    place(day, task, take, False)
                day += timedelta(days=1)

    at_risk = [{"task_id": t.id, "title": t.title, "due": t.due.isoformat(),
                "short_by_hours": round(need[t.id], 2), "overdue": t.due < today}
               for t in sorted(tasks, key=lambda t: t.due) if need[t.id] > EPS]

    schedule = []
    for day, items in sorted(days.items()):
        items.sort(key=lambda i: i["start_time"] or "99:99")
        total = round(sum(i["hours"] for i in items), 2)
        schedule.append({"date": day.isoformat(), "items": items, "total_hours": total,
                         "capacity": cap(day), "overbooked": total > cap(day) + 1e-6})
    return {"hours_per_day": hours_per_day, "days": schedule, "at_risk": at_risk,
            "missed": sorted(missed, key=lambda m: m["date"])}
