"""Endpoints for the student's own scheduling choices: hours per day per assignment,
and how many study hours are available on specific dates."""
from __future__ import annotations

from datetime import date

from flask import Blueprint, jsonify, request

from . import db
from .validation import validate_allocations

bp = Blueprint("schedule", __name__, url_prefix="/api")


def err(message, status=400):
    return jsonify({"errors": message if isinstance(message, list) else [message]}), status


def iso_day(value):
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return None


def assignment_exists(assignment_id):
    return db.get_db().execute("SELECT 1 FROM assignments WHERE id = ?", (assignment_id,)).fetchone()


@bp.get("/assignments/<int:assignment_id>/allocations")
def get_allocations(assignment_id):
    if not assignment_exists(assignment_id):
        return err("not found", 404)
    rows = db.get_db().execute("SELECT day, hours, start_time, done FROM allocations "
                               "WHERE assignment_id = ? ORDER BY day", (assignment_id,))
    return jsonify([{**dict(r), "done": bool(r["done"])} for r in rows])


@bp.put("/assignments/<int:assignment_id>/allocations")
def put_allocations(assignment_id):
    if not assignment_exists(assignment_id):
        return err("not found", 404)
    rows, errors = validate_allocations((request.get_json(silent=True) or {}).get("allocations"))
    if errors:
        return err(errors)
    conn = db.get_db()
    conn.execute("DELETE FROM allocations WHERE assignment_id = ?", (assignment_id,))
    conn.executemany("INSERT INTO allocations (assignment_id, day, hours, start_time, done) VALUES (?, ?, ?, ?, ?)",
                     [(assignment_id, r["day"], r["hours"], r["start_time"], int(r["done"])) for r in rows])
    conn.commit()
    return jsonify(rows)


@bp.patch("/assignments/<int:assignment_id>/allocations/<day>")
def patch_allocation(assignment_id, day):
    """Tick/untick or re-time ONE day's session. If that day was only auto-planned,
    this pins it as the student's own session (creating it with the given hours)."""
    if not assignment_exists(assignment_id):
        return err("not found", 404)
    day = iso_day(day)
    if day is None:
        return err("day must be a date like 2026-11-20")
    data = request.get_json(silent=True) or {}
    conn = db.get_db()
    row = conn.execute("SELECT * FROM allocations WHERE assignment_id = ? AND day = ?",
                       (assignment_id, day)).fetchone()
    hours = data.get("hours", row["hours"] if row else None)
    if isinstance(hours, bool) or not isinstance(hours, (int, float)) or not 0.25 <= hours <= 24:
        return err("hours must be between 0.25 and 24")
    done = int(bool(data.get("done", row["done"] if row else 0)))
    conn.execute("INSERT INTO allocations (assignment_id, day, hours, done) VALUES (?, ?, ?, ?) "
                 "ON CONFLICT(assignment_id, day) DO UPDATE SET hours = excluded.hours, done = excluded.done",
                 (assignment_id, day, float(hours), done))
    conn.commit()
    return jsonify({"day": day, "hours": float(hours), "start_time": row["start_time"] if row else None,
                    "done": bool(done)})


@bp.get("/capacity")
def list_capacity():
    rows = db.get_db().execute("SELECT day, hours FROM day_capacity ORDER BY day")
    return jsonify([dict(r) for r in rows])


@bp.put("/capacity/<day>")
def set_capacity(day):
    day = iso_day(day)
    hours = (request.get_json(silent=True) or {}).get("hours")
    if day is None:
        return err("day must be a date like 2026-11-20")
    if isinstance(hours, bool) or not isinstance(hours, (int, float)) or not 0 <= hours <= 24:
        return err("hours must be between 0 and 24 (0 means a day off)")
    conn = db.get_db()
    conn.execute("INSERT INTO day_capacity (day, hours) VALUES (?, ?) "
                 "ON CONFLICT(day) DO UPDATE SET hours = excluded.hours", (day, float(hours)))
    conn.commit()
    return jsonify({"day": day, "hours": float(hours)})


@bp.delete("/capacity/<day>")
def delete_capacity(day):
    day = iso_day(day)
    if day is None:
        return err("day must be a date like 2026-11-20")
    conn = db.get_db()
    conn.execute("DELETE FROM day_capacity WHERE day = ?", (day,))
    conn.commit()
    return "", 204
