"""SQLite helpers (stdlib sqlite3, one connection per request)."""
import sqlite3

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS assignments (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    title  TEXT NOT NULL,
    course TEXT NOT NULL,
    due    TEXT NOT NULL,
    start  TEXT,
    weight REAL NOT NULL DEFAULT 0,
    hours  REAL NOT NULL DEFAULT 1,
    score  REAL,
    done   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS allocations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    day           TEXT NOT NULL,
    hours         REAL NOT NULL,
    start_time    TEXT,
    done          INTEGER NOT NULL DEFAULT 0,
    UNIQUE (assignment_id, day)
);
CREATE TABLE IF NOT EXISTS day_capacity (
    day   TEXT PRIMARY KEY,
    hours REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS subjects (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT DEFAULT '#A3907C'
);
CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'materials',
    UNIQUE (subject_id, name)
);
CREATE TABLE IF NOT EXISTS files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id     INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    stored_name   TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size          INTEGER NOT NULL,
    uploaded_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS todos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    due_date   TEXT,
    priority   TEXT DEFAULT 'Medium',
    category   TEXT DEFAULT 'Task'
);
CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lectures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id  INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    position   INTEGER NOT NULL,
    file_id    INTEGER REFERENCES files(id) ON DELETE CASCADE,
    youtube_id TEXT,
    watched    INTEGER NOT NULL DEFAULT 0,
    resume_at  REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS file_text (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    text    TEXT NOT NULL
);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")  # enables ON DELETE CASCADE
    return g.db


def close_db(_exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    conn = get_db()
    conn.executescript(SCHEMA)
    # Migration for databases created before assignments had a start date.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(assignments)")}
    allocation_columns = {row["name"] for row in conn.execute("PRAGMA table_info(allocations)")}
    if "done" not in allocation_columns:
        conn.execute("ALTER TABLE allocations ADD COLUMN done INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    if "start" not in columns:
        conn.execute("ALTER TABLE assignments ADD COLUMN start TEXT")
        conn.commit()
    subject_columns = {row["name"] for row in conn.execute("PRAGMA table_info(subjects)")}
    if "color" not in subject_columns:
        conn.execute("ALTER TABLE subjects ADD COLUMN color TEXT DEFAULT '#A3907C'")
        conn.commit()
    todo_columns = {row["name"] for row in conn.execute("PRAGMA table_info(todos)")}
    if "due_date" not in todo_columns:
        conn.execute("ALTER TABLE todos ADD COLUMN due_date TEXT")
        conn.commit()
    if "priority" not in todo_columns:
        conn.execute("ALTER TABLE todos ADD COLUMN priority TEXT DEFAULT 'Medium'")
        conn.commit()
    if "category" not in todo_columns:
        conn.execute("ALTER TABLE todos ADD COLUMN category TEXT DEFAULT 'Task'")
        conn.commit()
