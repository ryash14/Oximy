import sqlite3
import json
import hashlib
from typing import List, Optional
from models import CanonicalAIEvent

DB_FILE = "oximy_events.db"

def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        timestamp TEXT,
        source TEXT,
        source_event_id TEXT,
        identity_id TEXT,
        action TEXT,
        model_name TEXT,
        tokens_prompt INTEGER,
        tokens_completion INTEGER,
        total_tokens INTEGER,
        cost_usd REAL,
        latency_ms INTEGER,
        raw_payload TEXT
    )
    """)
    conn.commit()
    conn.close()

def generate_event_id(source: str, source_event_id: str) -> str:
    """
    Deterministic dedup key. 
    Without a deterministic dedup key the same activity double-counts.
    """
    key_material = f"{source}::{source_event_id}".encode('utf-8')
    return hashlib.sha256(key_material).hexdigest()

def ingest_event(event: CanonicalAIEvent) -> bool:
    """
    Upserts the event.
    Events are born incomplete and backfilled later. They must stay revisable on a stable key.
    If the event already exists, it updates revisable fields (like cost and identity) 
    without double-counting tokens.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
        INSERT INTO events (
            event_id, timestamp, source, source_event_id, identity_id,
            action, model_name, tokens_prompt, tokens_completion, total_tokens,
            cost_usd, latency_ms, raw_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
            identity_id = COALESCE(excluded.identity_id, events.identity_id),
            cost_usd = COALESCE(excluded.cost_usd, events.cost_usd),
            latency_ms = COALESCE(excluded.latency_ms, events.latency_ms),
            -- Raw payload might be updated with more complete facts later
            raw_payload = excluded.raw_payload
        """, (
            event.event_id,
            event.timestamp.isoformat(),
            event.source,
            event.source_event_id,
            event.identity_id,
            event.action,
            event.model_name,
            event.tokens_prompt,
            event.tokens_completion,
            event.total_tokens,
            event.cost_usd,
            event.latency_ms,
            json.dumps(event.raw_payload)
        ))
        conn.commit()
        return True
    except Exception as e:
        print(f"Error ingesting event: {e}")
        return False
    finally:
        conn.close()

def get_event(event_id: str) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM events WHERE event_id = ?", (event_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None
