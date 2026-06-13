from typing import Dict, Any, Type
from datetime import datetime
from models import CanonicalAIEvent
from database import generate_event_id

class StructuralDriftException(Exception):
    """Raised when a vendor changes their payload structure silently."""
    pass

class BaseParser:
    source_name: str
    
    def parse(self, raw_payload: Dict[str, Any]) -> CanonicalAIEvent:
        self.check_drift(raw_payload)
        return self._extract(raw_payload)
        
    def check_drift(self, raw_payload: Dict[str, Any]):
        """
        Structural drift detection.
        Catches the move the day it ships so the tool's cost doesn't silently go to zero.
        """
        pass
        
    def _extract(self, raw_payload: Dict[str, Any]) -> CanonicalAIEvent:
        raise NotImplementedError

class OpenAIParser(BaseParser):
    source_name = "openai"
    
    def check_drift(self, raw_payload: Dict[str, Any]):
        if "id" not in raw_payload:
            raise StructuralDriftException("OpenAI payload missing 'id'")
        
        # If 'usage' is missing, it's a silent breakage that breaks dashboards!
        if "usage" not in raw_payload:
            raise StructuralDriftException("OpenAI payload missing 'usage' - SILENT BREAKAGE PREVENTED")
            
        if "prompt_tokens" not in raw_payload["usage"]:
             raise StructuralDriftException("OpenAI usage missing 'prompt_tokens'")
             
    def _extract(self, raw_payload: Dict[str, Any]) -> CanonicalAIEvent:
        source_event_id = raw_payload["id"]
        event_id = generate_event_id(self.source_name, source_event_id)
        
        return CanonicalAIEvent(
            event_id=event_id,
            timestamp=datetime.fromtimestamp(raw_payload.get("created", datetime.now().timestamp())),
            source=self.source_name,
            source_event_id=source_event_id,
            action=raw_payload.get("object", "chat.completion"),
            model_name=raw_payload.get("model", "unknown"),
            tokens_prompt=raw_payload["usage"]["prompt_tokens"],
            tokens_completion=raw_payload["usage"].get("completion_tokens", 0),
            total_tokens=raw_payload["usage"].get("total_tokens", 0),
            cost_usd=None, # Cost often arrives out of band later
            raw_payload=raw_payload
        )

class ClaudeParser(BaseParser):
    source_name = "anthropic"
    
    def check_drift(self, raw_payload: Dict[str, Any]):
        if "id" not in raw_payload:
            raise StructuralDriftException("Claude payload missing 'id'")
        if "usage" not in raw_payload:
            raise StructuralDriftException("Claude payload missing 'usage' - SILENT BREAKAGE PREVENTED")
            
    def _extract(self, raw_payload: Dict[str, Any]) -> CanonicalAIEvent:
        source_event_id = raw_payload["id"]
        event_id = generate_event_id(self.source_name, source_event_id)
        
        # Claude uses different keys for usage than OpenAI
        return CanonicalAIEvent(
            event_id=event_id,
            timestamp=datetime.now(), # Claude doesn't always send created timestamp
            source=self.source_name,
            source_event_id=source_event_id,
            action=raw_payload.get("type", "message"),
            model_name=raw_payload.get("model", "unknown"),
            tokens_prompt=raw_payload["usage"].get("input_tokens", 0),
            tokens_completion=raw_payload["usage"].get("output_tokens", 0),
            total_tokens=raw_payload["usage"].get("input_tokens", 0) + raw_payload["usage"].get("output_tokens", 0),
            cost_usd=None, 
            raw_payload=raw_payload
        )

class GeminiParser(BaseParser):
    source_name = "google"
    
    def check_drift(self, raw_payload: Dict[str, Any]):
        if "id" not in raw_payload: # Assuming a custom id is wrapped, or using a fallback
            pass # We'll generate one if missing for gemini
        if "usageMetadata" not in raw_payload:
            raise StructuralDriftException("Gemini payload missing 'usageMetadata' - SILENT BREAKAGE PREVENTED")
            
    def _extract(self, raw_payload: Dict[str, Any]) -> CanonicalAIEvent:
        source_event_id = raw_payload.get("id", f"gemini-{datetime.now().timestamp()}")
        event_id = generate_event_id(self.source_name, source_event_id)
        
        usage = raw_payload.get("usageMetadata", {})
        return CanonicalAIEvent(
            event_id=event_id,
            timestamp=datetime.now(),
            source=self.source_name,
            source_event_id=source_event_id,
            action="generateContent",
            model_name=raw_payload.get("modelVersion", "gemini-1.5-pro"),
            tokens_prompt=usage.get("promptTokenCount", 0),
            tokens_completion=usage.get("candidatesTokenCount", 0),
            total_tokens=usage.get("totalTokenCount", 0),
            cost_usd=None,
            raw_payload=raw_payload
        )

class CohereParser(BaseParser):
    source_name = "cohere"
    
    def check_drift(self, raw_payload: Dict[str, Any]):
        if "id" not in raw_payload:
            raise StructuralDriftException("Cohere payload missing 'id'")
        if "meta" not in raw_payload or "billed_units" not in raw_payload.get("meta", {}):
            raise StructuralDriftException("Cohere payload missing 'meta.billed_units'")

    def _extract(self, raw_payload: Dict[str, Any]) -> CanonicalAIEvent:
        source_event_id = raw_payload["id"]
        event_id = generate_event_id(self.source_name, source_event_id)
        
        billed_units = raw_payload.get("meta", {}).get("billed_units", {})
        total_tokens = billed_units.get("input_tokens", 0) + billed_units.get("output_tokens", 0)

        return CanonicalAIEvent(
            event_id=event_id,
            timestamp=datetime.now(),
            source=self.source_name,
            source_event_id=source_event_id,
            action="generate",
            model_name="command-r-plus", # Defaulting for example
            tokens_prompt=billed_units.get("input_tokens", 0),
            tokens_completion=billed_units.get("output_tokens", 0),
            total_tokens=total_tokens,
            cost_usd=None,
            raw_payload=raw_payload
        )

class ParserRegistry:
    """A dispatch layer for multiple format generations live in the wild at once."""
    _parsers: Dict[str, BaseParser] = {}
    
    @classmethod
    def register(cls, parser_class: Type[BaseParser]):
        cls._parsers[parser_class.source_name] = parser_class()
        
    @classmethod
    def get_parser(cls, source: str) -> BaseParser:
        if source not in cls._parsers:
            raise ValueError(f"No parser registered for source: {source}")
        return cls._parsers[source]

ParserRegistry.register(OpenAIParser)
ParserRegistry.register(ClaudeParser)
ParserRegistry.register(GeminiParser)
ParserRegistry.register(CohereParser)
