# ============================================================
#  database.py  –  SQLite Scan History Storage
#  SpectAI – AI Spectacle Recommendation System
# ============================================================

import sqlite3
import json
import uuid
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "spectai.db"


def get_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they don't exist."""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS scans (
                id              TEXT PRIMARY KEY,
                timestamp       TEXT NOT NULL,
                face_shape      TEXT,
                eye_shape       TEXT,
                frame_size      TEXT,
                frame_style     TEXT,
                face_width      REAL,
                face_length     REAL,
                forehead_width  REAL,
                cheekbone_width REAL,
                jaw_width       REAL,
                left_eye_width  REAL,
                right_eye_width REAL,
                eye_height      REAL,
                eye_aspect_ratio REAL,
                pd              REAL,
                lens_width      TEXT,
                bridge_size     TEXT,
                temple_length   TEXT,
                best_color      TEXT,
                confidence_json TEXT,
                raw_json        TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS esp32_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id     TEXT,
                sent_at     TEXT,
                status      TEXT,
                response    TEXT
            )
        """)
        conn.commit()


def save_scan(data: dict) -> str:
    """Insert a scan result and return the scan ID."""
    scan_id = data.get("scan_id") or "SCAN-" + uuid.uuid4().hex[:8].upper()
    ts      = data.get("timestamp") or datetime.utcnow().isoformat()
    conf    = json.dumps(data.get("confidence", {}))
    raw     = json.dumps(data)

    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO scans VALUES (
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
            )
        """, (
            scan_id, ts,
            data.get("face_shape"), data.get("eye_shape"),
            data.get("frame_size"), data.get("frame_style"),
            data.get("face_width"), data.get("face_length"),
            data.get("forehead_width"), data.get("cheekbone_width"),
            data.get("jaw_width"),
            data.get("left_eye_width"), data.get("right_eye_width"),
            data.get("eye_height"), data.get("eye_aspect_ratio"),
            data.get("pd"),
            data.get("lens_width"), data.get("bridge_size"),
            data.get("temple_length"), data.get("best_color"),
            conf, raw
        ))
        conn.commit()
    return scan_id


def get_all_scans(limit: int = 100) -> list:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM scans ORDER BY timestamp DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_scan(scan_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM scans WHERE id = ?", (scan_id,)
        ).fetchone()
    return dict(row) if row else None


def log_esp32(scan_id: str, status: str, response: str = ""):
    ts = datetime.utcnow().isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO esp32_log (scan_id, sent_at, status, response) VALUES (?,?,?,?)",
            (scan_id, ts, status, response)
        )
        conn.commit()


def get_stats() -> dict:
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM scans").fetchone()[0]
        shapes = conn.execute("""
            SELECT face_shape, COUNT(*) as cnt
            FROM scans GROUP BY face_shape ORDER BY cnt DESC
        """).fetchall()
        frames = conn.execute("""
            SELECT frame_style, COUNT(*) as cnt
            FROM scans GROUP BY frame_style ORDER BY cnt DESC
        """).fetchall()
        sizes  = conn.execute("""
            SELECT frame_size, COUNT(*) as cnt
            FROM scans GROUP BY frame_size ORDER BY cnt DESC
        """).fetchall()

    return {
        "total_scans":     total,
        "face_shapes":     [dict(r) for r in shapes],
        "frame_styles":    [dict(r) for r in frames],
        "frame_sizes":     [dict(r) for r in sizes],
    }


# Auto-init on import
init_db()
