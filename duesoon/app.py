"""Flask app factory and JSON API."""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import date

from flask import Flask, jsonify, request

from . import db
from .lectures import bp as lectures_bp
from .opportunities import bp as opportunities_bp
from .schedule_api import bp as schedule_bp
from .subjects import bp as subjects_bp
from .grades import summarize
from .planner import Task, build_plan
from .validation import validate_assignment

EDITABLE = ("title", "course", "due", "start", "weight", "hours", "done")


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="")
    app.config["DATABASE"] = os.environ.get("DUESOON_DB", "duesoon.db")
    app.config["UPLOAD_FOLDER"] = os.path.abspath(os.environ.get("DUESOON_UPLOADS", "uploads"))
    app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("DUESOON_MAX_UPLOAD_MB", "4096")) * 1024 * 1024  # per request (one lecture video each)
    app.config.update(config or {})
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    app.register_blueprint(subjects_bp)
    app.register_blueprint(schedule_bp)
    app.register_blueprint(lectures_bp)
    app.register_blueprint(opportunities_bp)
    app.teardown_appcontext(db.close_db)
    with app.app_context():
        db.init_db()

    @app.errorhandler(413)
    def too_large(_e):
        return jsonify({"errors": ["Upload too large (raise DUESOON_MAX_UPLOAD_MB, default 4096)"]}), 413

    def error(message, status=400):
        return jsonify({"errors": message if isinstance(message, list) else [message]}), status

    def get_row(item_id):
        return db.get_db().execute("SELECT * FROM assignments WHERE id = ?", (item_id,)).fetchone()

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    @app.get("/api/assignments")
    def list_assignments():
        conn = db.get_db()
        sessions = defaultdict(list)
        for r in conn.execute("SELECT assignment_id, day, hours, start_time, done FROM allocations ORDER BY day"):
            sessions[r["assignment_id"]].append({"day": r["day"], "hours": r["hours"],
                                                 "start_time": r["start_time"], "done": bool(r["done"])})
        items = []
        for r in conn.execute("SELECT * FROM assignments ORDER BY done, due"):
            item = dict(r)
            item["sessions"] = sessions[r["id"]]
            item["done_hours"] = sum(x["hours"] for x in item["sessions"] if x["done"])
            items.append(item)
        return jsonify(items)

    @app.post("/api/assignments")
    def create_assignment():
        clean, errors = validate_assignment(request.get_json(silent=True) or {})
        if errors:
            return error(errors)
        conn = db.get_db()
        cur = conn.execute(
            "INSERT INTO assignments (title, course, due, start, weight, hours, score, done) "
            "VALUES (:title, :course, :due, :start, :weight, :hours, :score, :done)", clean)
        conn.commit()
        return jsonify(dict(get_row(cur.lastrowid))), 201

    @app.patch("/api/assignments/<int:item_id>")
    def update_assignment(item_id):
        row = get_row(item_id)
        if row is None:
            return error("not found", 404)
        merged = dict(row)
        merged.update({k: v for k, v in (request.get_json(silent=True) or {}).items() if k in EDITABLE})
        clean, errors = validate_assignment(merged)
        if errors:
            return error(errors)
        conn = db.get_db()
        conn.execute("UPDATE assignments SET title=:title, course=:course, due=:due, start=:start, weight=:weight, "
                     "hours=:hours, score=:score, done=:done WHERE id=:id", {**clean, "id": item_id})
        conn.commit()
        return jsonify(dict(get_row(item_id)))

    @app.delete("/api/assignments/<int:item_id>")
    def delete_assignment(item_id):
        conn = db.get_db()
        if conn.execute("DELETE FROM assignments WHERE id = ?", (item_id,)).rowcount == 0:
            return error("not found", 404)
        conn.commit()
        return "", 204

    @app.get("/api/plan")
    def plan():
        try:
            hours = float(request.args.get("hours_per_day", 3))
            today = date.fromisoformat(request.args.get("today", date.today().isoformat()))
            if hours <= 0:
                raise ValueError
        except ValueError:
            return error("hours_per_day must be positive and today must be YYYY-MM-DD")
        conn = db.get_db()
        tasks = [Task(r["id"], r["title"], r["course"], date.fromisoformat(r["due"]), r["hours"],
                      date.fromisoformat(r["start"]) if r["start"] else None)
                 for r in conn.execute("SELECT * FROM assignments WHERE done = 0")]
        capacity = {date.fromisoformat(r["day"]): r["hours"]
                    for r in conn.execute("SELECT day, hours FROM day_capacity")}
        allocations = defaultdict(list)
        for r in conn.execute("SELECT assignment_id, day, hours, start_time, done FROM allocations"):
            allocations[r["assignment_id"]].append(
                (date.fromisoformat(r["day"]), r["hours"], r["start_time"], bool(r["done"])))
        autofill = request.args.get("autofill", "1") != "0"
        return jsonify(build_plan(tasks, today, hours, capacity, allocations, autofill))

    @app.get("/api/grades")
    def grades():
        try:
            target = float(request.args.get("target", 90))
            if not 0 <= target <= 100:
                raise ValueError
        except ValueError:
            return error("target must be between 0 and 100")
        by_course = defaultdict(list)
        for r in db.get_db().execute("SELECT course, weight, score FROM assignments"):
            by_course[r["course"]].append((r["weight"], r["score"]))
        return jsonify({course: summarize(items, target) for course, items in sorted(by_course.items())})

    return app
