from database import get_connection

def get_weekly_active_ai_users():
    """
    Solves the 'One definition of using AI' problem.
    "The fix is one implementation over the canonical event, in terms that don't depend on the source's unit of work."
    
    Instead of having 3 different dashboards calculate "active user" differently
    (e.g., one counting OpenAI chats, one counting Claude API pings), 
    we define it ONCE on top of the Canonical Event.
    
    Definition: A user is an "Active AI User" this week if they generated > 0 tokens 
    across ANY AI provider in the last 7 days.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    # We query the canonical events table. 
    # We don't care if it was OpenAI or Claude, we just care if they used tokens.
    cursor.execute("""
        SELECT COUNT(DISTINCT identity_id) as active_users
        FROM events
        WHERE timestamp >= date('now', '-7 days')
        AND total_tokens > 0
        AND identity_id IS NOT NULL
    """)
    
    result = cursor.fetchone()
    conn.close()
    
    return result['active_users']

if __name__ == "__main__":
    # Simulate calculating the single source of truth metric
    active_users = get_weekly_active_ai_users()
    print(f"=== Oximy Core Metrics ===")
    print(f"Single Source of Truth - Active AI Users this week: {active_users}")
    print("This number is guaranteed consistent across all dashboards because it queries the canonical event.")
