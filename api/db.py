import os
import sqlite3
import json
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

logger = logging.getLogger("TrafficMonitor.API.DB")

DB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
DB_PATH = os.path.join(DB_DIR, "incidents.db")


def get_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    try:
        with conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                camera_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                zone_id INTEGER NOT NULL,
                origin TEXT NOT NULL,
                confirmed_at TEXT NOT NULL,
                cleared_at TEXT,
                peak_conf REAL NOT NULL,
                bbox_json TEXT NOT NULL,
                involved_ids_json TEXT NOT NULL,
                snapshot_path TEXT,
                clip_path TEXT,
                verdict TEXT,
                verdict_note TEXT,
                verdict_at TEXT,
                settings_json TEXT NOT NULL,
                model_info_json TEXT NOT NULL,
                is_deleted INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS verdict_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                old_verdict TEXT,
                new_verdict TEXT NOT NULL,
                note TEXT,
                changed_at TEXT NOT NULL,
                FOREIGN KEY (incident_id) REFERENCES incidents (id)
            );

            CREATE TABLE IF NOT EXISTS cameras (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source TEXT NOT NULL,
                lat REAL,
                lng REAL,
                notes TEXT,
                settings_profile_json TEXT,
                ignore_region_json TEXT,
                is_deleted INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notification_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                camera_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER DEFAULT 1,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_incidents_cam_time ON incidents(camera_id, confirmed_at);
            CREATE INDEX IF NOT EXISTS idx_incidents_verdict ON incidents(verdict);
            CREATE INDEX IF NOT EXISTS idx_notif_incident ON notification_logs(incident_id);
            CREATE INDEX IF NOT EXISTS idx_notif_cam_time ON notification_logs(camera_id, created_at);
            """)

            # Seed default cameras if table is empty
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM cameras")
            if cur.fetchone()[0] == 0:
                now = datetime.now(timezone.utc).isoformat()
                default_cams = [
                    ("cam_01", "Camera 01: North Junction", "sample1", 28.6139, 77.2090, "North approach intersection CCTV", now),
                    ("cam_02", "Camera 02: Highway Merge", "sample2", 28.6150, 77.2105, "Multi-lane arterial merge point", now),
                    ("cam_03", "Camera 03: South Crosswalk", "sample1", 28.6120, 77.2075, "High-pedestrian crosswalk junction", now),
                    ("cam_04", "Camera 04: West Plaza", "sample2", 28.6110, 77.2060, "Rotary interchange and plaza feed", now),
                ]
                cur.executemany("""
                INSERT INTO cameras (id, name, source, lat, lng, notes, settings_profile_json, ignore_region_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, '{}', '[]', ?)
                """, default_cams)
                logger.info("Initialized database schema and seeded default cameras.")
    finally:
        conn.close()


def insert_incident(
    incident_id: str,
    camera_id: str,
    session_id: str,
    zone_id: int,
    origin: str,
    confirmed_at: str,
    peak_conf: float,
    bbox: List[float],
    involved_ids: List[int],
    snapshot_path: Optional[str],
    clip_path: Optional[str],
    settings: Dict[str, Any],
    model_info: Dict[str, Any],
) -> Dict[str, Any]:
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
            INSERT OR REPLACE INTO incidents (
                id, camera_id, session_id, zone_id, origin,
                confirmed_at, peak_conf, bbox_json, involved_ids_json,
                snapshot_path, clip_path, settings_json, model_info_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                incident_id,
                camera_id,
                session_id,
                zone_id,
                origin,
                confirmed_at,
                peak_conf,
                json.dumps(bbox),
                json.dumps(involved_ids),
                snapshot_path,
                clip_path,
                json.dumps(settings),
                json.dumps(model_info),
            ))
        return get_incident(incident_id) or {}
    finally:
        conn.close()


def update_incident_cleared(incident_id: str, cleared_at: str, final_peak_conf: Optional[float] = None):
    conn = get_connection()
    try:
        with conn:
            if final_peak_conf is not None:
                conn.execute("""
                UPDATE incidents
                SET cleared_at = ?, peak_conf = MAX(peak_conf, ?)
                WHERE id = ?
                """, (cleared_at, final_peak_conf, incident_id))
            else:
                conn.execute("""
                UPDATE incidents
                SET cleared_at = ?
                WHERE id = ?
                """, (cleared_at, incident_id))
    finally:
        conn.close()


def update_incident_verdict(incident_id: str, verdict: Optional[str], note: Optional[str] = None) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("SELECT verdict FROM incidents WHERE id = ?", (incident_id,))
            row = cur.fetchone()
            if not row:
                return None
            old_verdict = row["verdict"]

            now = datetime.now(timezone.utc).isoformat()
            conn.execute("""
            UPDATE incidents
            SET verdict = ?, verdict_note = ?, verdict_at = ?
            WHERE id = ?
            """, (verdict, note, now, incident_id))

            conn.execute("""
            INSERT INTO verdict_audit (incident_id, old_verdict, new_verdict, note, changed_at)
            VALUES (?, ?, ?, ?, ?)
            """, (incident_id, old_verdict, verdict or "none", note or "", now))

        return get_incident(incident_id)
    finally:
        conn.close()


def soft_delete_incident(incident_id: str, delete: bool = True) -> bool:
    conn = get_connection()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("UPDATE incidents SET is_deleted = ? WHERE id = ?", (1 if delete else 0, incident_id))
            return cur.rowcount > 0
    finally:
        conn.close()


def get_incident(incident_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,))
        row = cur.fetchone()
        if not row:
            return None
        return _format_incident_row(dict(row))
    finally:
        conn.close()


def get_incident_audit(incident_id: str) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM verdict_audit WHERE incident_id = ? ORDER BY changed_at ASC", (incident_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def list_incidents(
    camera_id: Optional[str] = None,
    verdict: Optional[str] = None,
    origin: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    search: Optional[str] = None,
    include_deleted: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> Tuple[List[Dict[str, Any]], int]:
    conn = get_connection()
    try:
        clauses = []
        params: List[Any] = []

        if not include_deleted:
            clauses.append("is_deleted = 0")

        if camera_id:
            clauses.append("camera_id = ?")
            params.append(camera_id)

        if verdict:
            if verdict == "unreviewed":
                clauses.append("verdict IS NULL")
            else:
                clauses.append("verdict = ?")
                params.append(verdict)

        if origin:
            clauses.append("origin = ?")
            params.append(origin)

        if from_date:
            clauses.append("confirmed_at >= ?")
            params.append(from_date)

        if to_date:
            clauses.append("confirmed_at <= ?")
            params.append(to_date)

        if search:
            clauses.append("(id LIKE ? OR verdict_note LIKE ? OR camera_id LIKE ?)")
            pattern = f"%{search}%"
            params.extend([pattern, pattern, pattern])

        where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""

        cur = conn.cursor()
        count_query = f"SELECT COUNT(*) FROM incidents {where_sql}"
        cur.execute(count_query, params)
        total_count = cur.fetchone()[0]

        data_query = f"""
        SELECT * FROM incidents
        {where_sql}
        ORDER BY confirmed_at DESC
        LIMIT ? OFFSET ?
        """
        cur.execute(data_query, params + [limit, offset])
        rows = [_format_incident_row(dict(r)) for r in cur.fetchall()]
        return rows, total_count
    finally:
        conn.close()


def get_stats(from_date: Optional[str] = None, to_date: Optional[str] = None, camera_id: Optional[str] = None) -> Dict[str, Any]:
    conn = get_connection()
    try:
        clauses = ["is_deleted = 0"]
        params: List[Any] = []

        if from_date:
            clauses.append("confirmed_at >= ?")
            params.append(from_date)
        if to_date:
            clauses.append("confirmed_at <= ?")
            params.append(to_date)
        if camera_id:
            clauses.append("camera_id = ?")
            params.append(camera_id)

        where_sql = "WHERE " + " AND ".join(clauses)

        cur = conn.cursor()

        # Total incidents
        cur.execute(f"SELECT COUNT(*) FROM incidents {where_sql}", params)
        total_incidents = cur.fetchone()[0]

        # By verdict
        cur.execute(f"""
        SELECT COALESCE(verdict, 'unreviewed') as v, COUNT(*) as c
        FROM incidents {where_sql}
        GROUP BY v
        """, params)
        by_verdict = {row["v"]: row["c"] for row in cur.fetchall()}

        # By origin
        cur.execute(f"""
        SELECT origin, COUNT(*) as c
        FROM incidents {where_sql}
        GROUP BY origin
        """, params)
        by_origin = {row["origin"]: row["c"] for row in cur.fetchall()}

        # Alerts by hour of day (UTC)
        cur.execute(f"""
        SELECT strftime('%H', confirmed_at) as hr, COUNT(*) as c
        FROM incidents {where_sql}
        GROUP BY hr
        ORDER BY hr ASC
        """, params)
        by_hour = [{"hour": int(row["hr"] or 0), "count": row["c"]} for row in cur.fetchall()]

        # Alerts by day
        cur.execute(f"""
        SELECT strftime('%Y-%m-%d', confirmed_at) as dt, COUNT(*) as c
        FROM incidents {where_sql}
        GROUP BY dt
        ORDER BY dt ASC
        """, params)
        by_day = [{"date": row["dt"], "count": row["c"]} for row in cur.fetchall()]

        # Per camera breakdown
        cur.execute(f"""
        SELECT camera_id, COUNT(*) as c
        FROM incidents {where_sql}
        GROUP BY camera_id
        """, params)
        per_camera = {row["camera_id"]: row["c"] for row in cur.fetchall()}

        # Operator review counts
        reviewed_count = (by_verdict.get("true_accident", 0) +
                          by_verdict.get("false_alarm", 0) +
                          by_verdict.get("unsure", 0))
        false_alarm_count = by_verdict.get("false_alarm", 0)
        true_accident_count = by_verdict.get("true_accident", 0)
        unsure_count = by_verdict.get("unsure", 0)

        false_alarm_share = (false_alarm_count / reviewed_count) if reviewed_count > 0 else 0.0

        return {
            "total_incidents": total_incidents,
            "reviewed_count": reviewed_count,
            "unreviewed_count": by_verdict.get("unreviewed", 0),
            "true_accident_count": true_accident_count,
            "false_alarm_count": false_alarm_count,
            "unsure_count": unsure_count,
            "false_alarm_share": round(false_alarm_share, 4),
            "by_verdict": by_verdict,
            "by_origin": by_origin,
            "by_hour": by_hour,
            "by_day": by_day,
            "per_camera": per_camera,
            "time_range": {"from": from_date, "to": to_date},
            "camera_filter": camera_id,
            "insufficient_data": reviewed_count < 20,
            "operator_caveat": "Based only on incidents an operator reviewed. Missed accidents are not counted and are not measurable here.",
        }
    finally:
        conn.close()


# Cameras CRUD
def list_cameras() -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM cameras WHERE is_deleted = 0 ORDER BY id ASC")
        return [_format_camera_row(dict(r)) for r in cur.fetchall()]
    finally:
        conn.close()


def get_camera(camera_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM cameras WHERE id = ? AND is_deleted = 0", (camera_id,))
        row = cur.fetchone()
        if not row:
            return None
        return _format_camera_row(dict(row))
    finally:
        conn.close()


def upsert_camera(
    camera_id: str,
    name: str,
    source: str,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    notes: Optional[str] = None,
    settings_profile: Optional[Dict[str, Any]] = None,
    ignore_region: Optional[List[List[float]]] = None,
) -> Dict[str, Any]:
    conn = get_connection()
    try:
        now = datetime.now(timezone.utc).isoformat()
        with conn:
            conn.execute("""
            INSERT INTO cameras (id, name, source, lat, lng, notes, settings_profile_json, ignore_region_json, created_at, is_deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                source = excluded.source,
                lat = excluded.lat,
                lng = excluded.lng,
                notes = excluded.notes,
                settings_profile_json = excluded.settings_profile_json,
                ignore_region_json = excluded.ignore_region_json,
                is_deleted = 0
            """, (
                camera_id,
                name,
                source,
                lat,
                lng,
                notes or "",
                json.dumps(settings_profile or {}),
                json.dumps(ignore_region or []),
                now,
            ))
            cur = conn.cursor()
            cur.execute("SELECT * FROM cameras WHERE id = ? AND is_deleted = 0", (camera_id,))
            row = cur.fetchone()
            if row:
                return _format_camera_row(dict(row))
        return {}
    finally:
        conn.close()


def delete_camera(camera_id: str) -> bool:
    conn = get_connection()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("UPDATE cameras SET is_deleted = 1 WHERE id = ?", (camera_id,))
            return cur.rowcount > 0
    finally:
        conn.close()


def _format_incident_row(row: Dict[str, Any]) -> Dict[str, Any]:
    row["bbox"] = json.loads(row.get("bbox_json") or "[]")
    row["involved_vehicle_ids"] = json.loads(row.get("involved_ids_json") or "[]")
    row["settings"] = json.loads(row.get("settings_json") or "{}")
    row["model_info"] = json.loads(row.get("model_info_json") or "{}")
    return row


def _format_camera_row(row: Dict[str, Any]) -> Dict[str, Any]:
    row["settings_profile"] = json.loads(row.get("settings_profile_json") or "{}")
    row["ignore_region"] = json.loads(row.get("ignore_region_json") or "[]")
    return row


def log_notification(
    incident_id: str,
    camera_id: str,
    channel: str,
    status: str,
    attempts: int = 1,
    last_error: Optional[str] = None,
) -> int:
    """Insert or update a notification delivery record in notification_logs."""
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            cur = conn.cursor()
            # Check if record exists for this incident and channel
            cur.execute(
                "SELECT id FROM notification_logs WHERE incident_id = ? AND channel = ?",
                (incident_id, channel),
            )
            existing = cur.fetchone()
            if existing:
                log_id = existing["id"]
                cur.execute("""
                UPDATE notification_logs
                SET status = ?, attempts = ?, last_error = ?, updated_at = ?
                WHERE id = ?
                """, (status, attempts, last_error, now, log_id))
                return log_id
            else:
                cur.execute("""
                INSERT INTO notification_logs (
                    incident_id, camera_id, channel, status, attempts, last_error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (incident_id, camera_id, channel, status, attempts, last_error, now, now))
                return cur.lastrowid
    finally:
        conn.close()


def get_incident_notifications(incident_id: str) -> List[Dict[str, Any]]:
    """Fetch all notification delivery logs for a specific incident."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM notification_logs WHERE incident_id = ? ORDER BY id ASC",
            (incident_id,),
        )
        return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def list_recent_notifications(limit: int = 50) -> List[Dict[str, Any]]:
    """List most recent notification delivery logs across all channels."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM notification_logs ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()

