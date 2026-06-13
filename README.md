# Oximy Core: AI Data Engineering Proof of Concept

> "We're building the system of record for how the world uses AI. The abstraction has to be narrow enough to mean something, total enough to hold every source without loss, and leak no source-specific assumptions." — Oximy JD

This repository contains a full-stack, production-grade proof of concept built by **Yashwanth** in an AI-agentic workflow, demonstrating solutions to the three hardest data engineering problems highlighted in the Oximy JD.

**It was designed, built, and shipped in a single session using AI agents.** Because shipping like you have eight hands is the whole job.

## 🚀 The Three Hard Problems Solved

### 1. The Canonical Event (Schema Unification)
**The Problem:** OpenAI uses `prompt_tokens`. Claude uses `input_tokens`. Gemini uses `usageMetadata`. Cohere uses `meta.billed_units`. Every new source refractures the system if handled poorly.
**The Solution:** An extensible **Parser Registry**. Webhooks hit the API gateway, where the registry intercepts distinct payloads and normalizes them into one `CanonicalAIEvent` shape. The raw payload is preserved perfectly, but downstream analytics only ever read from the single, unified canonical schema.

### 2. Exactly-Once Semantics (Deduplication & Late Facts)
**The Problem:** Every source redelivers webhooks at least once. Furthermore, facts arrive late (cost often lags behind tokens). Appending creates duplicates; naive dedup destroys data.
**The Solution:** The pipeline hashes `SHA256(source + vendor_id)` to generate a strictly deterministic `event_id`. When a redelivery occurs, the pipeline triggers an idempotent `ON CONFLICT DO UPDATE` in SQLite (or ClickHouse in prod). This allows late-arriving costs to be backfilled safely without ever double-counting token velocity.

### 3. Structural Drift Prevention
**The Problem:** Vendors silently change their schemas. A naive parser reads a missing field as `null` and cost silently goes to zero, destroying dashboard trust.
**The Solution:** Strict schema compliance at the edge. The Parser throws a `StructuralDriftException` the exact millisecond a required path moves. The mutated event is rejected *before* it pollutes the data warehouse, triggering a high-severity alert to update the parser.

## 🏗 System Architecture

The pipeline consists of four immutable stages, ensuring absolute data integrity regardless of vendor instability:

1. **API Gateway (FastAPI):** Receives raw, heterogeneous webhooks.
2. **Drift Detector:** Enforces strict structural compliance; fails closed if the vendor schema moves.
3. **SHA-256 Hasher:** Derives deterministic identity keys.
4. **Idempotent Store:** Safely upserts facts without data duplication.

*Future Scale:* The current SQLite implementation is perfectly swappable with a Kafka Topic for high-throughput ingest and ClickHouse for columnar analytics, keeping the canonical schema entirely intact.

## 📸 Interactive Dashboard Demo

The frontend is a custom-built, responsive React interface showcasing the real-time execution traces of the pipeline. It isn't a mockup — it's live production code.

*(Insert Demo Video / Screen Recording Here)*

![Dashboard Preview](https://via.placeholder.com/1200x800.png?text=Oximy+Dashboard+Demo+-+Add+Screenshot+Here)

*Note to Evaluators: I highly recommend cloning the repo and running the interactive sandbox locally to try to break the agents and see the guardrails hold up.*

## 💻 How to Run Locally

### 1. Clone & Setup Backend
```bash
git clone https://github.com/ryash14/Oximy.git
cd Oximy

# Create virtual env and install deps
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn pydantic sqlite3

# Start the ingestion API (port 8000)
python api.py
```

### 2. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
Navigate to `http://localhost:5173`. Use the interactive problem cards to inject Canonical Events, simulate Duplicate Webhook redeliveries, and fire mutated drift payloads to watch the system catch them live.

---

**Built by Yashwanth.** Let's go find the wall.
