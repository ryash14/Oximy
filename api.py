from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from database import get_connection, ingest_event, get_event, generate_event_id, init_db
from metrics import get_weekly_active_ai_users
from parsers import ParserRegistry, StructuralDriftException
import json
import random

app = FastAPI(title="Oximy Core API")

@app.on_event("startup")
def startup_event():
    init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for the Vercel deployment prototype
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/metrics")
def get_metrics():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT SUM(total_tokens) as tokens FROM events")
    tokens = cursor.fetchone()['tokens'] or 0
    cursor.execute("SELECT SUM(cost_usd) as cost FROM events")
    cost = cursor.fetchone()['cost'] or 0.0
    conn.close()
    return {
        "active_users_7d": get_weekly_active_ai_users(),
        "total_tokens": tokens,
        "total_cost_usd": round(cost, 2)
    }

@app.get("/api/events")
def get_events(limit: int = 50):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT event_id, timestamp, source, identity_id, action, model_name, total_tokens, cost_usd 
        FROM events 
        ORDER BY timestamp DESC 
        LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    events = [dict(row) for row in rows]
    return events

@app.post("/api/simulate-late-cost")
def simulate_late_cost():
    conn = get_connection()
    cursor = conn.cursor()
    # Find events with null cost
    cursor.execute("SELECT event_id, total_tokens FROM events WHERE cost_usd IS NULL LIMIT 5")
    rows = cursor.fetchall()
    
    if not rows:
        conn.close()
        return {"status": "success", "message": "No pending costs to resolve."}
        
    resolved_count = 0
    dummy_users = ["usr_a1b2", "usr_c3d4", "usr_e5f6", "usr_g7h8", "usr_i9j0"]
    for row in rows:
        event_id = row['event_id']
        tokens = row['total_tokens']
        # Simulate cost based on tokens (roughly $0.01 per 1k tokens)
        simulated_cost = (tokens / 1000.0) * 0.01
        if simulated_cost == 0:
            simulated_cost = random.uniform(0.001, 0.05)
            
        simulated_identity = random.choice(dummy_users)

        cursor.execute(
            "UPDATE events SET cost_usd = ?, identity_id = ? WHERE event_id = ?",
            (round(simulated_cost, 4), simulated_identity, event_id)
        )
        resolved_count += 1
        
    conn.commit()
    conn.close()
    
    return {"status": "success", "message": f"Resolved costs for {resolved_count} pending events."}

@app.post("/api/simulate-drift")
def simulate_drift():
    mutated_payload = {
        "id": "chatcmpl-mutation123",
        "object": "chat.completion",
        "created": 1677652299,
        "model": "gpt-4-turbo",
        "usage": {
            "input_tokens": 100, 
            "completion_tokens": 50,
            "total_tokens": 150
        }
    }
    
    parser = ParserRegistry.get_parser("openai")
    try:
        event = parser.parse(mutated_payload)
        return {"status": "failed", "message": "Parser missed the drift!"}
    except StructuralDriftException as e:
        return {"status": "drift_caught", "message": str(e)}

@app.post("/api/ingest-raw")
async def ingest_raw(request: Request):
    """
    The endpoint for the Interactive Sandbox. 
    Returns an execution trace to animate the frontend UI.
    """
    try:
        raw_payload = await request.json()
    except Exception:
        return {"trace": ["error_json"], "message": "Invalid JSON format"}
        
    # Step 1: Determine source reliably
    source = "unknown"
    if "object" in raw_payload and raw_payload["object"] == "chat.completion":
        source = "openai"
    elif "type" in raw_payload and raw_payload["type"] == "message":
        source = "anthropic"
    elif "usageMetadata" in raw_payload or "candidatesTokenCount" in str(raw_payload):
        source = "google"
    elif "meta" in raw_payload and "billed_units" in raw_payload["meta"]:
        source = "cohere"
    else:
        # Fallback heuristic
        if "input_tokens" in str(raw_payload) and "meta" not in raw_payload:
            source = "anthropic"
        else:
            source = "openai"
    
    try:
        parser = ParserRegistry.get_parser(source)
    except Exception as e:
        return {"trace": ["error_source"], "message": f"Unknown source format: {source}"}

    # Step 2: Parse & Drift Detection
    try:
        event = parser.parse(raw_payload)
    except StructuralDriftException as e:
        return {"trace": ["drift_caught"], "message": f"Drift Detected: {str(e)}"}
        
    # Step 3: Check if Duplicate for Upsert logic
    existing_event = get_event(event.event_id)
    
    # Step 4: Ingest (Upsert)
    success = ingest_event(event)
    
    if not success:
        return {"trace": ["error_db"], "message": "Database insertion failed"}
        
    if existing_event:
        return {
            "trace": ["success_upsert"], 
            "message": f"Idempotent Upsert: Cost/Identity updated without double-counting tokens.",
            "event_id": event.event_id,
            "event": event.model_dump(exclude={'raw_payload'})
        }
    else:
        return {
            "trace": ["success_insert"], 
            "message": f"Canonical Event Ingested Successfully.",
            "event_id": event.event_id,
            "event": event.model_dump(exclude={'raw_payload'})
        }

if __name__ == "__main__":
    import uvicorn
    print("Starting Oximy API on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
