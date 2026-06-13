from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime

class CanonicalAIEvent(BaseModel):
    """
    The Canonical Event. 
    Total enough to hold every source without loss.
    Narrow enough to mean something.
    """
    event_id: str = Field(description="Deterministic hash of (source, source_event_id)")
    
    timestamp: datetime
    source: str = Field(description="Vendor name, e.g., openai, anthropic")
    source_event_id: str = Field(description="The vendor's original ID")
    identity_id: Optional[str] = Field(default=None, description="Resolved later")
    
    action: str = Field(description="e.g., chat.completions, messages")
    model_name: str
    
    tokens_prompt: int = 0
    tokens_completion: int = 0
    total_tokens: int = 0
    
    cost_usd: Optional[float] = Field(default=None, description="Revisable cost field, can arrive late")
    latency_ms: Optional[int] = None
    
    raw_payload: Dict[str, Any] = Field(description="Stored for replay and drift detection")
