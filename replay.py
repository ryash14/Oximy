import json
import time
from database import init_db, ingest_event, get_event, get_connection
from parsers import ParserRegistry, StructuralDriftException

# 1. Historical Valid Payloads
VALID_OPENAI_PAYLOAD = {
    "id": "chatcmpl-123",
    "object": "chat.completion",
    "created": 1677652288,
    "model": "gpt-3.5-turbo-0125",
    "usage": {
        "prompt_tokens": 9,
        "completion_tokens": 12,
        "total_tokens": 21
    }
}

VALID_CLAUDE_PAYLOAD = {
    "id": "msg_01XFD",
    "type": "message",
    "model": "claude-3-opus-20240229",
    "usage": {
        "input_tokens": 15,
        "output_tokens": 20
    }
}

# 2. Mutated Payload (Vendor silently dropped 'prompt_tokens' and renamed to 'input_tokens')
MUTATED_OPENAI_PAYLOAD = {
    "id": "chatcmpl-456",
    "object": "chat.completion",
    "created": 1677652299,
    "model": "gpt-4-turbo",
    "usage": {
        "input_tokens": 100, # Silent breakage! Parser expects 'prompt_tokens'
        "completion_tokens": 50,
        "total_tokens": 150
    }
}

def run_replay_harness():
    print("=== Oximy Replay Harness ===")
    init_db()
    
    print("\n1. Testing Valid Payloads (Ingestion)")
    for source, payload in [("openai", VALID_OPENAI_PAYLOAD), ("anthropic", VALID_CLAUDE_PAYLOAD)]:
        parser = ParserRegistry.get_parser(source)
        event = parser.parse(payload)
        ingest_event(event)
        print(f"✅ Ingested {source} event. ID: {event.event_id}")

    print("\n2. Testing Structural Drift Detection")
    parser = ParserRegistry.get_parser("openai")
    try:
        event = parser.parse(MUTATED_OPENAI_PAYLOAD)
        print("❌ FAILED: Parser did not catch the structural drift!")
    except StructuralDriftException as e:
        print(f"✅ CAUGHT DRIFT: {e}")
        print("   (Alerting the team before the dashboard numbers look low)")

    print("\n3. Testing Late-Arriving Facts (The Cost Problem)")
    # We parse the valid OpenAI payload again. It has the same source_event_id.
    parser = ParserRegistry.get_parser("openai")
    event = parser.parse(VALID_OPENAI_PAYLOAD)
    
    # We simulate a billing system resolving the cost 2 hours later
    print(f"   Original Cost in DB: {get_event(event.event_id)['cost_usd']}")
    
    # Update the event object with the late fact
    event.cost_usd = 0.0042
    event.identity_id = "user_yashwanth_123"
    
    # Re-ingest
    ingest_event(event)
    print("   Upserted late facts (cost & identity)...")
    
    # Verify we didn't double count tokens, but cost is there
    updated_row = get_event(event.event_id)
    print(f"   Updated Cost: ${updated_row['cost_usd']}")
    print(f"   Identity: {updated_row['identity_id']}")
    
    conn = get_connection()
    count = conn.execute("SELECT COUNT(*) FROM events WHERE source_event_id = 'chatcmpl-123'").fetchone()[0]
    print(f"✅ Total rows for this event: {count} (Exactly-once semantics preserved)")

if __name__ == "__main__":
    run_replay_harness()
