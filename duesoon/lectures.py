"""Lecture playlists: ordered videos (uploaded files or YouTube links) inside a playlist folder."""
from __future__ import annotations

import os
import re
from urllib.parse import parse_qs, urlparse

from flask import Blueprint, jsonify, request

from . import db
from .playlist import Playlist
from .subjects import err, many, one, remove_files, store_upload

bp = Blueprint("lectures", __name__, url_prefix="/api")

VIDEO_EXT = {"mp4", "webm", "mov", "m4v", "mkv"}
YOUTUBE_ID = re.compile(r"[A-Za-z0-9_-]{11}")


def parse_youtube_id(url):
    """Return the 11-character video id from a YouTube link, or None."""
    if not isinstance(url, str) or not url.strip():
        return None
    url = url.strip()
    try:
        parts = urlparse(url if "://" in url else "https://" + url)
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    host = host[2:] if host.startswith("m.") else host
    if parts.scheme not in ("http", "https"):
        return None
    if host == "youtu.be":
        candidate = parts.path.lstrip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        if parts.path == "/watch":
            candidate = parse_qs(parts.query).get("v", [""])[0]
        else:
            match = re.match(r"^/(?:shorts|embed|live)/([^/?]+)", parts.path)
            candidate = match.group(1) if match else ""
    else:
        return None
    return candidate if YOUTUBE_ID.fullmatch(candidate) else None


def playlist_folder(folder_id):
    return one("SELECT * FROM folders WHERE id = ? AND kind = 'playlist'", (folder_id,))


def ordered_ids(folder_id):
    return [r["id"] for r in many("SELECT id FROM lectures WHERE folder_id = ? ORDER BY position, id", (folder_id,))]


def save_order(conn, ids):
    conn.executemany("UPDATE lectures SET position = ? WHERE id = ?", [(i, lid) for i, lid in enumerate(ids)])
    conn.commit()


def next_position(folder_id):
    return one("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM lectures WHERE folder_id = ?", (folder_id,))["p"]


def title_from_filename(name):
    base = os.path.splitext(name)[0].replace("_", " ").strip()
    return (base or "Lecture")[:120]


@bp.get("/folders/<int:folder_id>/playlist")
def get_playlist(folder_id):
    if playlist_folder(folder_id) is None:
        return err("playlist folder not found", 404)
    rows = {r["id"]: r for r in many(
        "SELECT l.*, f.size FROM lectures l LEFT JOIN files f ON f.id = l.file_id "
        "WHERE l.folder_id = ? ORDER BY l.position, l.id", (folder_id,))}
    playlist = Playlist(rows.keys())          # built in stored order
    lectures = []
    for number, lecture_id in enumerate(playlist, start=1):
        r = rows[lecture_id]
        lectures.append({
            "id": lecture_id, "index": number, "title": r["title"],
            "kind": "youtube" if r["youtube_id"] else "video",
            "file_id": r["file_id"], "youtube_id": r["youtube_id"], "size": r["size"],
            "watched": bool(r["watched"]), "resume_at": r["resume_at"],
            "prev_id": playlist.prev_of(lecture_id), "next_id": playlist.next_of(lecture_id)})
    return jsonify({"lectures": lectures, "total": len(lectures),
                    "watched": sum(1 for x in lectures if x["watched"])})


@bp.post("/folders/<int:folder_id>/lectures")
def upload_lectures(folder_id):
    if playlist_folder(folder_id) is None:
        return err("playlist folder not found", 404)
    conn = db.get_db()
    saved, rejected = 0, []
    for upload in request.files.getlist("files"):      # processed in the order received
        file_id, original = store_upload(conn, folder_id, upload, VIDEO_EXT)
        if file_id is None:
            rejected.append(original or "(unnamed)")
            continue
        conn.execute("INSERT INTO lectures (folder_id, title, position, file_id) VALUES (?, ?, ?, ?)",
                     (folder_id, title_from_filename(original), next_position(folder_id), file_id))
        conn.commit()
        saved += 1
    return jsonify({"saved": saved, "rejected": rejected}), (201 if saved else 400)


@bp.post("/folders/<int:folder_id>/lectures/youtube")
def add_youtube(folder_id):
    if playlist_folder(folder_id) is None:
        return err("playlist folder not found", 404)
    data = request.get_json(silent=True) or {}
    video_id = parse_youtube_id(data.get("url"))
    if video_id is None:
        return err("that doesn't look like a YouTube video link")
    title = data.get("title")
    title = title.strip()[:120] if isinstance(title, str) and title.strip() else f"YouTube lecture {video_id}"
    conn = db.get_db()
    cur = conn.execute("INSERT INTO lectures (folder_id, title, position, youtube_id) VALUES (?, ?, ?, ?)",
                       (folder_id, title, next_position(folder_id), video_id))
    conn.commit()
    return jsonify({"id": cur.lastrowid, "title": title, "youtube_id": video_id}), 201


@bp.post("/lectures/<int:lecture_id>/move")
def move_lecture(lecture_id):
    row = one("SELECT folder_id FROM lectures WHERE id = ?", (lecture_id,))
    if row is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    playlist = Playlist(ordered_ids(row["folder_id"]))
    direction, position = data.get("direction"), data.get("position")
    if direction == "up":
        playlist.move_up(lecture_id)
    elif direction == "down":
        playlist.move_down(lecture_id)
    elif isinstance(position, int) and not isinstance(position, bool) and 1 <= position <= len(playlist):
        playlist.move_to(lecture_id, position - 1)
    else:
        return err("send direction 'up'/'down' or a position between 1 and the playlist length")
    save_order(db.get_db(), playlist.ids())
    return jsonify({"order": playlist.ids()})


@bp.patch("/lectures/<int:lecture_id>")
def update_lecture(lecture_id):
    row = one("SELECT * FROM lectures WHERE id = ?", (lecture_id,))
    if row is None:
        return err("not found", 404)
    data = request.get_json(silent=True) or {}
    title, watched, resume = row["title"], row["watched"], row["resume_at"]
    if "title" in data:
        if not isinstance(data["title"], str) or not data["title"].strip() or len(data["title"].strip()) > 120:
            return err("title must be 1 to 120 characters")
        title = data["title"].strip()
    if "watched" in data:
        watched = 1 if data["watched"] else 0
    if "resume_at" in data:
        value = data["resume_at"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100000:
            return err("resume_at must be a number of seconds")
        resume = float(value)
    conn = db.get_db()
    conn.execute("UPDATE lectures SET title = ?, watched = ?, resume_at = ? WHERE id = ?",
                 (title, watched, resume, lecture_id))
    conn.commit()
    return jsonify({"id": lecture_id, "title": title, "watched": bool(watched), "resume_at": resume})


@bp.delete("/lectures/<int:lecture_id>")
def delete_lecture(lecture_id):
    row = one("SELECT l.folder_id, l.file_id, f.stored_name FROM lectures l LEFT JOIN files f ON f.id = l.file_id "
              "WHERE l.id = ?", (lecture_id,))
    if row is None:
        return err("not found", 404)
    conn = db.get_db()
    conn.execute("DELETE FROM lectures WHERE id = ?", (lecture_id,))
    if row["file_id"] is not None:
        conn.execute("DELETE FROM files WHERE id = ?", (row["file_id"],))
    conn.commit()
    if row["stored_name"]:
        remove_files([row["stored_name"]])
    save_order(conn, ordered_ids(row["folder_id"]))     # close the gap in numbering
    return "", 204
