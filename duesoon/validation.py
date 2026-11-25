"""Input validation for assignment payloads."""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, List, Tuple


def _number(data, key, lo, hi, errors, required=True):
    value = data.get(key)
    if value is None:
        if required:
            errors.append(f"{key} is required")
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors.append(f"{key} must be a number")
        return None
    if not lo <= value <= hi:
        errors.append(f"{key} must be between {lo} and {hi}")
        return None
    return float(value)


def validate_assignment(data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Return (clean_data, errors). Never trusts the client."""
    errors: List[str] = []
    clean: Dict[str, Any] = {}

    for key, limit in (("title", 120), ("course", 60)):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{key} is required")
        elif len(value.strip()) > limit:
            errors.append(f"{key} must be at most {limit} characters")
        else:
            clean[key] = value.strip()

    try:
        clean["due"] = date.fromisoformat(str(data.get("due"))).isoformat()
    except ValueError:
        errors.append("due must be a date like 2026-12-01")

    start_raw = data.get("start")
    clean["start"] = None
    if start_raw not in (None, ""):
        try:
            clean["start"] = date.fromisoformat(str(start_raw)).isoformat()
        except ValueError:
            errors.append("start must be a date like 2026-11-20")
    if clean["start"] and clean.get("due") and clean["start"] > clean["due"]:
        errors.append("start must not be after due")

    clean["weight"] = _number(data, "weight", 0, 100, errors)
    clean["hours"] = _number(data, "hours", 0.25, 200, errors)
    clean["score"] = _number(data, "score", 0, 100, errors, required=False)
    clean["done"] = 1 if (data.get("done") or clean["score"] is not None) else 0
    return clean, errors


_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def validate_allocations(raw) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Validate the hours a student assigns to specific days. Rows with 0 hours are dropped."""
    if not isinstance(raw, list) or len(raw) > 366:
        return [], ["allocations must be a list (max 366 days)"]
    out: List[Dict[str, Any]] = []
    errors: List[str] = []
    seen = set()
    for i, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            errors.append(f"row {i}: invalid entry")
            continue
        try:
            day = date.fromisoformat(str(item.get("day"))).isoformat()
        except ValueError:
            errors.append(f"row {i}: day must be a date like 2026-11-20")
            continue
        hours = item.get("hours")
        if isinstance(hours, bool) or not isinstance(hours, (int, float)) or not 0 <= hours <= 24:
            errors.append(f"row {i}: hours must be between 0 and 24")
            continue
        start_time = item.get("start_time") or None
        if start_time is not None and (not isinstance(start_time, str) or not _TIME.match(start_time)):
            errors.append(f"row {i}: start_time must look like 18:30")
            continue
        if day in seen:
            errors.append(f"row {i}: {day} appears twice for this assignment")
            continue
        seen.add(day)
        if hours > 0:
            out.append({"day": day, "hours": float(hours), "start_time": start_time,
                        "done": bool(item.get("done"))})
    return out, errors
