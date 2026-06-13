import time
import uuid
import random
from datetime import datetime, timedelta
from database import init_db, ingest_event, get_connection
from parsers import ParserRegistry

def generate_seed_data():
    init_db()
    
    users = ["yashwanth", "alice_eng", "bob_sales", "charlie_product"]
    models = {
        "openai": ["gpt-4-turbo", "gpt-3.5-turbo-0125", "gpt-4o"],
        "anthropic": ["claude-3-opus-20240229", "claude-3-sonnet-20240229"]
    }
    
    print("Seeding database with 50 fake historical events...")
    
    # Let's generate 50 events over the past 7 days
    now = datetime.now()
    
    for i in range(50):
        source = random.choice(["openai", "anthropic"])
        model = random.choice(models[source])
        user = random.choice(users)
        
        # Random time in the last 7 days
        days_ago = random.uniform(0, 7)
        event_time = now - timedelta(days=days_ago)
        
        # Random tokens
        prompt = random.randint(10, 500)
        completion = random.randint(10, 1500)
        
        # Simulate cost (very rough)
        cost = (prompt * 0.00001) + (completion * 0.00003)
        
        if source == "openai":
            payload = {
                "id": f"chatcmpl-{uuid.uuid4().hex[:10]}",
                "object": "chat.completion",
                "created": int(event_time.timestamp()),
                "model": model,
                "usage": {
                    "prompt_tokens": prompt,
                    "completion_tokens": completion,
                    "total_tokens": prompt + completion
                }
            }
        else:
            payload = {
                "id": f"msg_{uuid.uuid4().hex[:10]}",
                "type": "message",
                "model": model,
                "usage": {
                    "input_tokens": prompt,
                    "output_tokens": completion
                }
            }
            
        parser = ParserRegistry.get_parser(source)
        event = parser.parse(payload)
        
        # Override timestamp for Claude since parser uses datetime.now() if not provided
        event.timestamp = event_time
        event.identity_id = user
        event.cost_usd = round(cost, 4)
        
        ingest_event(event)

    conn = get_connection()
    count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    print(f"✅ Seeding complete. Total events in DB: {count}")

if __name__ == "__main__":
    generate_seed_data()
