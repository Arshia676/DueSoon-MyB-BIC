"""Subjects, folders, file uploads, per-subject to-dos and the AI chat endpoint."""
from __future__ import annotations

import os
import re
import sqlite3
import uuid
from collections import defaultdict

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from . import db
from .ai import AIError, ask, build_system_prompt, clean_messages, is_configured, load_config
from .documents import DocumentError, EXTRACTABLE, extension, extract_text, extractable, fit_documents

bp = Blueprint("subjects", __name__, url_prefix="/api")

ALLOWED = {"pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx", "txt", "md", "csv", "png", "jpg",
           "jpeg", "gif", "mp4", "webm", "mov", "m4v", "mkv", "mp3", "wav", "zip", "py", "js", "ts",
           "java", "c", "cpp", "json", "ipynb"}
INLINE = {"pdf", "png", "jpg", "jpeg", "gif", "mp4", "webm", "mov", "m4v", "mkv", "mp3", "wav", "txt", "md"}
KINDS = {"materials", "project", "playlist"}
MAX_DOC_FILES = 5
LANGUAGE = re.compile(r"[^\W\d_][\w \-()]{0,29}")


def err(message, status=400):
    return jsonify({"errors": message if isinstance(message, list) else [message]}), status


def one(sql, args=()):
    return db.get_db().execute(sql, args).fetchone()


def many(sql, args=()):
    return db.get_db().execute(sql, args).fetchall()


def clean_name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 60:
        return None
    return value.strip()


def remove_files(stored_names):
    for name in stored_names:
        try:
            os.remove(os.path.join(current_app.config["UPLOAD_FOLDER"], name))
        except FileNotFoundError:
            pass


# ---- subjects -------------------------------------------------------------

SUBJECT_PALETTE = [
    "#A3907C",  # Taupe
    "#8A9A7B",  # Sage Green
    "#D9886C",  # Soft Terracotta
    "#C88D88",  # Muted Blush Pink
    "#D4A373",  # Warm Ochre / Peach
    "#8D6B4F",  # Warm Brown
    "#7D8C85",  # Moss Grey
    "#B59E87",  # Warm Beige Sand
    "#9A8C98",  # Dusty Mauve
    "#6D6875",  # Slate Plum
]


@bp.get("/subjects")
def list_subjects():
    rows = many("""SELECT s.id, s.name, COALESCE(s.color, '#A3907C') AS color,
        (SELECT COUNT(*) FROM files fl JOIN folders fo ON fl.folder_id = fo.id WHERE fo.subject_id = s.id) AS files,
        (SELECT COUNT(*) FROM todos t WHERE t.subject_id = s.id AND t.done = 0) AS open_todos,
        (SELECT COUNT(*) FROM todos t WHERE t.subject_id = s.id) AS total_todos,
        (SELECT COUNT(*) FROM notes n WHERE n.subject_id = s.id) AS notes_count,
        (SELECT COUNT(*) FROM lectures l JOIN folders fo ON l.folder_id = fo.id WHERE fo.subject_id = s.id) AS lectures_count,
        (SELECT COUNT(*) FROM lectures l JOIN folders fo ON l.folder_id = fo.id WHERE fo.subject_id = s.id AND l.watched = 1) AS watched_lectures
        FROM subjects s ORDER BY s.name""")
    return jsonify([dict(r) for r in rows])


@bp.post("/subjects")
def create_subject():
    data = request.get_json(silent=True) or {}
    name = clean_name(data.get("name"))
    if not name:
        return err("name is required (max 60 characters)")
    raw_color = (data.get("color") or "").strip()
    if not raw_color or not re.match(r"^#(?:[0-9a-fA-F]{3}){1,2}$", raw_color):
        count = one("SELECT COUNT(*) as c FROM subjects")["c"]
        color = SUBJECT_PALETTE[count % len(SUBJECT_PALETTE)]
    else:
        color = raw_color
    conn = db.get_db()
    try:
        cur = conn.execute("INSERT INTO subjects (name, color) VALUES (?, ?)", (name, color))
        conn.executemany("INSERT INTO folders (subject_id, name, kind) VALUES (?, ?, ?)",
                         [(cur.lastrowid, "Lectures", "playlist"), (cur.lastrowid, "Notes", "materials")])
        conn.commit()
    except sqlite3.IntegrityError:
        return err("a subject with that name already exists", 409)
    return jsonify({"id": cur.lastrowid, "name": name, "color": color}), 201


@bp.patch("/subjects/<int:subject_id>")
def update_subject(subject_id):
    subject = one("SELECT * FROM subjects WHERE id = ?", (subject_id,))
    if subject is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    name = subject["name"]
    color = subject["color"] or "#A3907C"
    if "name" in data:
        cleaned = clean_name(data["name"])
        if not cleaned:
            return err("name is required (max 60 characters)")
        if cleaned.lower() != subject["name"].lower():
            exists = one("SELECT 1 FROM subjects WHERE name = ? COLLATE NOCASE AND id != ?", (cleaned, subject_id))
            if exists:
                return err("a subject with that name already exists", 409)
        name = cleaned
    if "color" in data:
        c = (data["color"] or "").strip()
        if re.match(r"^#(?:[0-9a-fA-F]{3}){1,2}$", c):
            color = c
    conn = db.get_db()
    conn.execute("UPDATE subjects SET name = ?, color = ? WHERE id = ?", (name, color, subject_id))
    if name != subject["name"]:
        conn.execute("UPDATE assignments SET course = ? WHERE course = ?", (name, subject["name"]))
    conn.commit()
    return jsonify({"id": subject_id, "name": name, "color": color})


@bp.get("/subjects/<int:subject_id>")
def subject_detail(subject_id):
    subject = one("SELECT * FROM subjects WHERE id = ?", (subject_id,))
    if subject is None:
        return err("not found", 404)
    files = defaultdict(list)
    for f in many("""SELECT fl.id, fl.folder_id, fl.original_name, fl.size, fl.stored_name FROM files fl
                     JOIN folders fo ON fl.folder_id = fo.id WHERE fo.subject_id = ? ORDER BY fl.id""", (subject_id,)):
        files[f["folder_id"]].append({"id": f["id"], "name": f["original_name"], "size": f["size"],
                                      "extractable": extractable(f["original_name"])})
    folders = [{**dict(f), "files": files[f["id"]]}
               for f in many("SELECT * FROM folders WHERE subject_id = ? ORDER BY kind, name", (subject_id,))]
    todos = [dict(t) for t in many("SELECT * FROM todos WHERE subject_id = ? ORDER BY done, id", (subject_id,))]
    notes = [dict(n) for n in many("SELECT id, subject_id, title, content, created_at, updated_at FROM notes WHERE subject_id = ? ORDER BY updated_at DESC", (subject_id,))]
    return jsonify({"id": subject["id"], "name": subject["name"], "color": subject["color"] or "#A3907C",
                    "folders": folders, "todos": todos, "notes": notes})


@bp.delete("/subjects/<int:subject_id>")
def delete_subject(subject_id):
    stored = [r["stored_name"] for r in many(
        "SELECT fl.stored_name FROM files fl JOIN folders fo ON fl.folder_id = fo.id WHERE fo.subject_id = ?",
        (subject_id,))]
    conn = db.get_db()
    if conn.execute("DELETE FROM subjects WHERE id = ?", (subject_id,)).rowcount == 0:
        return err("not found", 404)
    conn.commit()
    remove_files(stored)
    return "", 204


# ---- folders and files ----------------------------------------------------

@bp.post("/subjects/<int:subject_id>/folders")
def create_folder(subject_id):
    if one("SELECT id FROM subjects WHERE id = ?", (subject_id,)) is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    name, kind = clean_name(data.get("name")), data.get("kind", "materials")
    if not name or kind not in KINDS:
        return err("name is required and kind must be 'materials' or 'project'")
    conn = db.get_db()
    try:
        cur = conn.execute("INSERT INTO folders (subject_id, name, kind) VALUES (?, ?, ?)",
                           (subject_id, name, kind))
        conn.commit()
    except sqlite3.IntegrityError:
        return err("that folder already exists in this subject", 409)
    return jsonify({"id": cur.lastrowid, "name": name, "kind": kind}), 201


@bp.delete("/folders/<int:folder_id>")
def delete_folder(folder_id):
    stored = [r["stored_name"] for r in many("SELECT stored_name FROM files WHERE folder_id = ?", (folder_id,))]
    conn = db.get_db()
    if conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,)).rowcount == 0:
        return err("not found", 404)
    conn.commit()
    remove_files(stored)
    return "", 204


@bp.patch("/folders/<int:folder_id>")
def update_folder(folder_id):
    folder = one("SELECT * FROM folders WHERE id = ?", (folder_id,))
    if folder is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    name = clean_name(data.get("name"))
    if not name:
        return err("name is required (max 60 characters)")
    conn = db.get_db()
    try:
        conn.execute("UPDATE folders SET name = ? WHERE id = ?", (name, folder_id))
        conn.commit()
    except sqlite3.IntegrityError:
        return err("that folder already exists in this subject", 409)
    return jsonify({"id": folder_id, "name": name, "kind": folder["kind"]})


def store_upload(conn, folder_id, upload, allowed=ALLOWED):
    """Save one uploaded file safely (random stored name, extension allowlist).

    Returns (file_id, original_name); file_id is None when the type is not allowed.
    """
    original = os.path.basename((upload.filename or "").replace("\\", "/"))
    ext = extension(original)
    if ext not in allowed:
        return None, original
    stored = f"{uuid.uuid4().hex}_{secure_filename(original) or 'file.' + ext}"
    path = os.path.join(current_app.config["UPLOAD_FOLDER"], stored)
    upload.save(path)
    cur = conn.execute("INSERT INTO files (folder_id, stored_name, original_name, size) VALUES (?, ?, ?, ?)",
                       (folder_id, stored, original[:200], os.path.getsize(path)))
    return cur.lastrowid, original


@bp.post("/folders/<int:folder_id>/files")
def upload_files(folder_id):
    folder = one("SELECT kind FROM folders WHERE id = ?", (folder_id,))
    if folder is None:
        return err("not found", 404)
    if folder["kind"] == "playlist":
        return err("this is a lecture playlist: upload videos with the playlist's own upload button")
    saved, rejected = 0, []
    conn = db.get_db()
    for upload in request.files.getlist("files"):
        file_id, original = store_upload(conn, folder_id, upload)
        if file_id is None:
            rejected.append(original or "(unnamed)")
        else:
            saved += 1
    conn.commit()
    return jsonify({"saved": saved, "rejected": rejected}), (201 if saved else 400)


@bp.get("/files/<int:file_id>")
def get_file(file_id):
    row = one("SELECT * FROM files WHERE id = ?", (file_id,))
    if row is None:
        return err("not found", 404)
    ext = row["original_name"].rsplit(".", 1)[-1].lower()
    # Only types browsers render safely open inline; everything else downloads.
    resp = send_from_directory(current_app.config["UPLOAD_FOLDER"], row["stored_name"],
                               download_name=row["original_name"],
                               as_attachment=(ext not in INLINE or request.args.get("download") == "1"))
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@bp.delete("/files/<int:file_id>")
def delete_file(file_id):
    row = one("SELECT stored_name FROM files WHERE id = ?", (file_id,))
    if row is None:
        return err("not found", 404)
    conn = db.get_db()
    conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
    conn.commit()
    remove_files([row["stored_name"]])
    return "", 204


@bp.patch("/files/<int:file_id>")
def update_file(file_id):
    file_row = one("SELECT * FROM files WHERE id = ?", (file_id,))
    if file_row is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    name = file_row["original_name"]
    folder_id = file_row["folder_id"]
    if "name" in data:
        n = (data["name"] or "").strip()
        if n and len(n) <= 200:
            name = n
    if "folder_id" in data:
        target = one("SELECT id, subject_id FROM folders WHERE id = ?", (data["folder_id"],))
        source = one("SELECT subject_id FROM folders WHERE id = ?", (file_row["folder_id"],))
        if target and source and target["subject_id"] == source["subject_id"]:
            folder_id = target["id"]
    conn = db.get_db()
    conn.execute("UPDATE files SET original_name = ?, folder_id = ? WHERE id = ?", (name, folder_id, file_id))
    conn.commit()
    return jsonify({"id": file_id, "name": name, "folder_id": folder_id})


# ---- to-dos ---------------------------------------------------------------

@bp.get("/todos")
def list_all_todos():
    rows = many("""SELECT t.id, t.subject_id, t.text, t.done, t.due_date, t.priority, t.category,
                          s.name as subject_name, COALESCE(s.color, '#A3907C') as subject_color
                   FROM todos t
                   JOIN subjects s ON t.subject_id = s.id
                   ORDER BY t.done ASC,
                            CASE WHEN t.due_date IS NULL OR t.due_date = '' THEN 1 ELSE 0 END,
                            t.due_date ASC, t.id DESC""")
    return jsonify([dict(r) for r in rows])


@bp.post("/subjects/<int:subject_id>/todos")
def create_todo(subject_id):
    if one("SELECT id FROM subjects WHERE id = ?", (subject_id,)) is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    text = data.get("text")
    if not isinstance(text, str) or not text.strip() or len(text.strip()) > 200:
        return err("text is required (max 200 characters)")
    due_date = (data.get("due_date") or "").strip() or None
    priority = (data.get("priority") or "Medium").strip()
    category = (data.get("category") or "Task").strip()
    conn = db.get_db()
    cur = conn.execute("INSERT INTO todos (subject_id, text, due_date, priority, category) VALUES (?, ?, ?, ?, ?)",
                       (subject_id, text.strip(), due_date, priority, category))
    conn.commit()
    return jsonify(dict(one("SELECT * FROM todos WHERE id = ?", (cur.lastrowid,)))), 201


@bp.patch("/todos/<int:todo_id>")
def update_todo(todo_id):
    todo = one("SELECT * FROM todos WHERE id = ?", (todo_id,))
    if todo is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    conn = db.get_db()
    done = (1 if data["done"] else 0) if "done" in data else todo["done"]
    text = (data["text"].strip()[:200]) if "text" in data and isinstance(data["text"], str) and data["text"].strip() else todo["text"]
    due_date = data["due_date"].strip() if "due_date" in data and isinstance(data["due_date"], str) else (todo["due_date"] if "due_date" not in data else None)
    priority = data["priority"] if "priority" in data else todo["priority"]
    category = data["category"] if "category" in data else todo["category"]
    conn.execute("UPDATE todos SET text = ?, done = ?, due_date = ?, priority = ?, category = ? WHERE id = ?",
                 (text, done, due_date, priority, category, todo_id))
    conn.commit()
    return jsonify(dict(one("SELECT * FROM todos WHERE id = ?", (todo_id,))))


@bp.delete("/todos/<int:todo_id>")
def delete_todo(todo_id):
    conn = db.get_db()
    if conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,)).rowcount == 0:
        return err("not found", 404)
    conn.commit()
    return "", 204


# ---- notes (built-in notepad) ---------------------------------------------

@bp.get("/subjects/<int:subject_id>/notes")
def list_notes(subject_id):
    if one("SELECT id FROM subjects WHERE id = ?", (subject_id,)) is None:
        return err("not found", 404)
    rows = many("SELECT id, subject_id, title, content, created_at, updated_at FROM notes WHERE subject_id = ? ORDER BY updated_at DESC", (subject_id,))
    return jsonify([dict(r) for r in rows])


@bp.post("/subjects/<int:subject_id>/notes")
def create_note(subject_id):
    if one("SELECT id FROM subjects WHERE id = ?", (subject_id,)) is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "Untitled Note").strip()[:120]
    content = str(data.get("content") or "")
    conn = db.get_db()
    cur = conn.execute("INSERT INTO notes (subject_id, title, content) VALUES (?, ?, ?)",
                       (subject_id, title or "Untitled Note", content))
    conn.commit()
    row = one("SELECT id, subject_id, title, content, created_at, updated_at FROM notes WHERE id = ?", (cur.lastrowid,))
    return jsonify(dict(row)), 201


@bp.get("/notes/<int:note_id>")
def get_note(note_id):
    row = one("SELECT id, subject_id, title, content, created_at, updated_at FROM notes WHERE id = ?", (note_id,))
    if row is None:
        return err("not found", 404)
    return jsonify(dict(row))


@bp.patch("/notes/<int:note_id>")
def update_note(note_id):
    row = one("SELECT * FROM notes WHERE id = ?", (note_id,))
    if row is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    title = row["title"]
    content = row["content"]
    if "title" in data:
        t = str(data["title"] or "").strip()[:120]
        if t:
            title = t
    if "content" in data:
        content = str(data["content"] or "")
    conn = db.get_db()
    conn.execute("UPDATE notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                 (title, content, note_id))
    conn.commit()
    updated = one("SELECT id, subject_id, title, content, created_at, updated_at FROM notes WHERE id = ?", (note_id,))
    return jsonify(dict(updated))


@bp.delete("/notes/<int:note_id>")
def delete_note(note_id):
    conn = db.get_db()
    if conn.execute("DELETE FROM notes WHERE id = ?", (note_id,)).rowcount == 0:
        return err("not found", 404)
    conn.commit()
    return "", 204


# ---- chat history ---------------------------------------------------------

@bp.get("/subjects/<int:subject_id>/chat/history")
def get_chat_history(subject_id):
    if one("SELECT id FROM subjects WHERE id = ?", (subject_id,)) is None:
        return err("not found", 404)
    rows = many("SELECT id, role, content, created_at FROM chat_messages WHERE subject_id = ? ORDER BY id ASC", (subject_id,))
    return jsonify([dict(r) for r in rows])


@bp.delete("/subjects/<int:subject_id>/chat/history")
def clear_chat_history(subject_id):
    if one("SELECT id FROM subjects WHERE id = ?", (subject_id,)) is None:
        return err("not found", 404)
    conn = db.get_db()
    conn.execute("DELETE FROM chat_messages WHERE subject_id = ?", (subject_id,))
    conn.commit()
    return "", 204


# ---- AI assistant ---------------------------------------------------------

@bp.get("/ai/status")
def ai_status():
    config = load_config()
    return jsonify({"configured": is_configured(config), "provider": config["provider"],
                    "model": config["model"]})


@bp.post("/subjects/<int:subject_id>/documents")
def upload_chat_documents(subject_id):
    """Upload documents (PDF, PPTX, DOCX, text) the assistant can read."""
    if one("SELECT id FROM subjects WHERE id = ?", (subject_id,)) is None:
        return err("not found", 404)
    conn = db.get_db()
    folder = one("SELECT id FROM folders WHERE subject_id = ? AND name = 'Chat uploads'", (subject_id,))
    if folder is None:
        folder_id = conn.execute("INSERT INTO folders (subject_id, name, kind) VALUES (?, 'Chat uploads', 'materials')",
                                 (subject_id,)).lastrowid
    else:
        folder_id = folder["id"]
    files, rejected = [], []
    for upload in request.files.getlist("files"):
        file_id, original = store_upload(conn, folder_id, upload, EXTRACTABLE)
        if file_id is None:
            rejected.append(original or "(unnamed)")
        else:
            files.append({"id": file_id, "name": original})
    conn.commit()
    return jsonify({"files": files, "rejected": rejected}), (201 if files else 400)


def document_text(row):
    """Extracted text for a stored file, cached so big PDFs are only parsed once."""
    cached = one("SELECT text FROM file_text WHERE file_id = ?", (row["id"],))
    if cached is not None:
        return cached["text"]
    path = os.path.join(current_app.config["UPLOAD_FOLDER"], row["stored_name"])
    text = extract_text(path, extension(row["original_name"]))
    conn = db.get_db()
    conn.execute("INSERT OR REPLACE INTO file_text (file_id, text) VALUES (?, ?)", (row["id"], text))
    conn.commit()
    return text


@bp.post("/subjects/<int:subject_id>/chat")
def chat(subject_id):
    subject = one("SELECT * FROM subjects WHERE id = ?", (subject_id,))
    if subject is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    try:
        messages = clean_messages(data.get("messages"))
    except ValueError as exc:
        return err(str(exc))

    language = data.get("language")
    if language in (None, ""):
        language = None
    elif not isinstance(language, str) or not LANGUAGE.fullmatch(language.strip()):
        return err("language must be a language name such as Urdu or Pashto")
    else:
        language = language.strip()

    file_ids = data.get("file_ids") or []
    if (not isinstance(file_ids, list) or len(file_ids) > MAX_DOC_FILES
            or not all(isinstance(i, int) and not isinstance(i, bool) for i in file_ids)):
        return err(f"file_ids must be a list of at most {MAX_DOC_FILES} file ids")

    documents, notes = [], []
    for file_id in dict.fromkeys(file_ids):
        row = one("SELECT fl.* FROM files fl JOIN folders fo ON fl.folder_id = fo.id "
                  "WHERE fl.id = ? AND fo.subject_id = ?", (file_id, subject_id))
        if row is None:
            return err("an attached file does not belong to this subject")
        try:
            text = document_text(row).strip()
        except DocumentError as exc:
            notes.append(f"{row['original_name']}: {exc}")
            continue
        if text:
            documents.append((row["original_name"], text))
        else:
            notes.append(f"{row['original_name']}: no readable text found (a scanned PDF or images can't be read)")
    documents, cut_notes = fit_documents(documents)
    notes += cut_notes

    todos = [r["text"] for r in many("SELECT text FROM todos WHERE subject_id = ? AND done = 0", (subject_id,))]
    assignments = [f"{r['title']} (due {r['due']}, {r['weight']}%)" for r in many(
        "SELECT title, due, weight FROM assignments WHERE course = ? AND done = 0 ORDER BY due LIMIT 10",
        (subject["name"],))]
    folders = defaultdict(list)
    for r in many("""SELECT fo.name AS folder, fl.original_name FROM files fl
                     JOIN folders fo ON fl.folder_id = fo.id WHERE fo.subject_id = ?""", (subject_id,)):
        folders[r["folder"]].append(r["original_name"])

    system = build_system_prompt(subject["name"], todos, assignments, folders, language, documents)
    try:
        reply = ask(messages, system, load_config())
        conn = db.get_db()
        conn.execute("INSERT INTO chat_messages (subject_id, role, content) VALUES (?, 'user', ?)",
                     (subject_id, messages[-1]["content"]))
        conn.execute("INSERT INTO chat_messages (subject_id, role, content) VALUES (?, 'assistant', ?)",
                     (subject_id, reply))
        conn.commit()
        return jsonify({"reply": reply, "notes": notes})
    except AIError as exc:
        return err(str(exc), exc.status)
