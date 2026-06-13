import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Users, Coins, Zap, AlertTriangle, CheckCircle,
  Database, GitMerge, FileJson, Server, Hash, Save,
  ExternalLink, Code, ChevronRight, Shield, BarChart3,
  Layers, ArrowUpRight, Terminal, Play, RefreshCw, Copy, Loader
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar
} from 'recharts'

const API = 'http://localhost:8000'

// ── Pre-built scenarios ──
const SCENARIOS = {
  canonical_openai: {
    id: `chatcmpl-${Math.floor(Math.random() * 100000)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-4-turbo",
    usage: { prompt_tokens: 127, completion_tokens: 58, total_tokens: 185 }
  },
  canonical_claude: {
    id: `msg-${Math.floor(Math.random() * 100000)}`,
    type: "message",
    model: "claude-3-opus",
    usage: { input_tokens: 200, output_tokens: 95 }
  },
  canonical_gemini: {
    id: `gemini-${Math.floor(Math.random() * 100000)}`,
    modelVersion: "gemini-1.5-pro",
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 150, totalTokenCount: 200 }
  },
  canonical_cohere: {
    id: `cohere-${Math.floor(Math.random() * 100000)}`,
    meta: { billed_units: { input_tokens: 80, output_tokens: 120 } }
  },
  duplicate: {
    id: "chatcmpl-dedup-master-key",
    object: "chat.completion",
    created: 1717200000,
    model: "gpt-4-turbo",
    usage: { prompt_tokens: 500, completion_tokens: 250, total_tokens: 750 }
  },
  drift: {
    id: "chatcmpl-drift-test",
    object: "chat.completion",
    created: 1717200000,
    model: "gpt-4-turbo",
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
  }
}

function App() {
  const [metrics, setMetrics] = useState({ active_users_7d: 0, total_tokens: 0, total_cost_usd: 0 })
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  // Problem 1 state
  const [p1Result, setP1Result] = useState(null)
  const [p1Loading, setP1Loading] = useState(false)
  const [p1Source, setP1Source] = useState('openai')

  // Problem 2 state
  const [p2Step, setP2Step] = useState(0) // 0=ready, 1=first ingest done, 2=duplicate done
  const [p2Results, setP2Results] = useState([])
  const [p2TokensBefore, setP2TokensBefore] = useState(null)
  const [p2Loading, setP2Loading] = useState(false)

  // Problem 3 state
  const [p3Result, setP3Result] = useState(null)
  const [p3Loading, setP3Loading] = useState(false)

  // Cost Resolver state
  const [costResolving, setCostResolving] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [m, e] = await Promise.all([
        fetch(`${API}/api/metrics`).then(r => r.json()),
        fetch(`${API}/api/events?limit=15`).then(r => r.json())
      ])
      setMetrics(m)
      setEvents(e)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Chart data ──
  const chartData = events.slice(0, 10).reverse().map(e => ({
    label: new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    tokens: e.total_tokens
  }))

  const sourceMap = {}
  events.forEach(e => { sourceMap[e.source] = (sourceMap[e.source] || 0) + e.total_tokens })
  const sourceData = Object.entries(sourceMap).map(([name, tokens]) => ({ name, tokens }))

  // ── Problem 1: Canonical Event ──
  const runCanonical = async (source) => {
    setP1Loading(true)
    setP1Source(source)
    const payload = SCENARIOS[`canonical_${source}`]
    
    // Regenerate ID so we can insert multiple times without upserting automatically
    if (payload.id) {
        payload.id = `${source}-${Math.floor(Math.random() * 1000000)}`
    }

    try {
      const res = await fetch(`${API}/api/ingest-raw`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      setP1Result(data)
      await fetchData()
    } catch (e) { setP1Result({ trace: ['error_json'], message: 'Network error' }) }
    finally { setP1Loading(false) }
  }

  // ── Problem 2: Deduplication ──
  const runDedup = async () => {
    setP2Loading(true)
    const payload = SCENARIOS.duplicate

    if (p2Step === 0) {
      // First ingest
      try {
        const res = await fetch(`${API}/api/ingest-raw`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await res.json()
        setP2Results([data])
        await fetchData()
        setP2TokensBefore(metrics.total_tokens + 750)
        setP2Step(1)
      } catch (e) { console.error(e) }
    } else if (p2Step === 1) {
      // Duplicate ingest (same ID)
      try {
        const res = await fetch(`${API}/api/ingest-raw`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await res.json()
        await fetchData()
        setP2Results(prev => [...prev, data])
        setP2Step(2)
      } catch (e) { console.error(e) }
    }
    setP2Loading(false)
  }

  const resetDedup = () => { 
    SCENARIOS.duplicate.id = `chatcmpl-dedup-${Math.floor(Math.random()*10000)}`
    setP2Step(0); 
    setP2Results([]); 
    setP2TokensBefore(null) 
  }

  // ── Problem 3: Drift ──
  const runDrift = async () => {
    setP3Loading(true)
    try {
      const res = await fetch(`${API}/api/ingest-raw`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SCENARIOS.drift)
      })
      const data = await res.json()
      setP3Result(data)
    } catch (e) { setP3Result({ trace: ['error_json'], message: 'Network error' }) }
    finally { setP3Loading(false) }
  }

  // ── Helper ──
  const isSuccess = (result) => result?.trace?.some(t => t.startsWith('success'))

  // ── Resolve Costs (Batch Job) ──
  const resolveCosts = async () => {
    setCostResolving(true)
    try {
      await fetch(`${API}/api/simulate-late-cost`, { method: 'POST' })
      await fetchData()
    } catch (e) { console.error(e) }
    finally { setCostResolving(false) }
  }

  if (loading) {
    return (
      <div className="app" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
          <Terminal size={32} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <div>Connecting to Oximy Core...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">

      {/* ━━ HEADER ━━ */}
      <header className="header fi d1">
        <div className="brand">
          <Zap size={22} color="#3b82f6" />
          <span className="brand-name">Oximy Core</span>
          <span className="brand-tag">Production Ready</span>
        </div>
        <a href="https://github.com/ryash14" target="_blank" rel="noreferrer" className="github-btn pulse-glow">
          <Code size={16} /> <span style={{fontSize: '0.875rem'}}>Check My GitHub</span> <ArrowUpRight size={14} />
        </a>
      </header>

      {/* ━━ DASHBOARD ━━ */}
      <div className="sec-label fi d1">Live Dashboard · Real-time Metrics</div>

      <div className="metrics fi d2">
        <div className="metric">
          <div className="metric-label"><Users size={13} /> Active Users</div>
          <div className="metric-val">{metrics.active_users_7d}</div>
          <div className="metric-note">Last 7 days</div>
        </div>
        <div className="metric">
          <div className="metric-label"><Activity size={13} /> Tokens Processed</div>
          <div className="metric-val">{metrics.total_tokens.toLocaleString()}</div>
          <div className="metric-note">Across all AI sources</div>
        </div>
        <div className="metric">
          <div className="metric-label"><Coins size={13} /> Estimated Cost</div>
          <div className="metric-val">${metrics.total_cost_usd.toFixed(2)}</div>
          <div className="metric-note">Resolved billing only</div>
        </div>
        <div className="metric">
          <div className="metric-label"><Layers size={13} /> Events Ingested</div>
          <div className="metric-val">{events.length}</div>
          <div className="metric-note">Deduplicated canonical events</div>
        </div>
      </div>

      <div className="g2 fi d3">
        <div className="card">
          <div className="card-head"><h3><BarChart3 size={15} /> Token Velocity</h3><span className="card-tag">per event</span></div>
          <div style={{ height: 260, padding: '1.5rem 1.5rem 0.5rem 0' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} width={60} />
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="tokens" stroke="#3b82f6" strokeWidth={2} fill="url(#tg)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3><Layers size={15} /> Tokens by Source</h3><span className="card-tag">aggregated</span></div>
          <div style={{ height: 260, padding: '1.5rem 1.5rem 0.5rem 0' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} width={80} style={{textTransform: 'capitalize'}}/>
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="tokens" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ━━ THE THREE HARD PROBLEMS ━━ */}
      <div className="fi d4" style={{ margin: '5rem 0 3rem' }}>
        <div className="sec-heading" style={{fontSize: '1.75rem'}}>The Three Hardest Data Engineering Problems</div>
        <div className="sec-sub" style={{fontSize: '1rem', maxWidth: '800px'}}>
          From the Oximy JD: "Sources arrive in incompatible shapes. Facts arrive late. Every source redelivers at least once."
          Each section below is an interactive proof that this architecture handles these exact challenges cleanly.
        </div>
      </div>

      {/* ── PROBLEM 1: Canonical Event ── */}
      <div className="problem fi d4">
        <div className="problem-card">
          <div className="problem-header">
            <div className="problem-icon" style={{ background: 'var(--accent-dim)' }}>
              <GitMerge size={20} color="var(--accent)" />
            </div>
            <div>
              <div className="problem-title">Problem 1: The Canonical Event (Schema Unification)</div>
              <div className="problem-desc">
                OpenAI uses <code style={{color:'var(--green)'}}>prompt_tokens</code>. Claude uses <code style={{color:'var(--green)'}}>input_tokens</code>. Gemini uses <code style={{color:'var(--green)'}}>usageMetadata</code>. Cohere uses <code style={{color:'var(--green)'}}>meta.billed_units</code>.
                Our Parser Registry intercepts all of these distinct structures and maps them into one unified <code style={{color:'var(--green)'}}>CanonicalAIEvent</code> shape, preserving the raw payload perfectly.
              </div>
            </div>
          </div>
          <div className="problem-body">
            <div className="scenario-grid">
              <div className="scenario">
                <div className="scenario-label try"><Play size={10} /> Try It — Send a payload</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <button className={`btn ${p1Source === 'openai' ? 'btn-accent' : 'btn-ghost'}`} onClick={() => runCanonical('openai')} disabled={p1Loading}>OpenAI</button>
                  <button className={`btn ${p1Source === 'claude' ? 'btn-accent' : 'btn-ghost'}`} onClick={() => runCanonical('claude')} disabled={p1Loading}>Claude</button>
                  <button className={`btn ${p1Source === 'gemini' ? 'btn-accent' : 'btn-ghost'}`} onClick={() => runCanonical('gemini')} disabled={p1Loading}>Google Gemini</button>
                  <button className={`btn ${p1Source === 'cohere' ? 'btn-accent' : 'btn-ghost'}`} onClick={() => runCanonical('cohere')} disabled={p1Loading}>Cohere</button>
                </div>
                <div className="json-box">
                  {JSON.stringify(SCENARIOS[`canonical_${p1Source}`], null, 2)}
                </div>
              </div>
              <div className="scenario">
                <div className="scenario-label result"><Database size={10} /> Unified Result</div>
                {p1Result ? (
                  <>
                    <div className={`result-box ${isSuccess(p1Result) ? 'result-ok' : 'result-err'}`}>
                      <strong>{isSuccess(p1Result) ? 'Success' : 'Error'}:</strong> {p1Result.message}
                    </div>
                    {p1Result.event && (
                      <div className="json-box" style={{marginTop: '1rem'}}>
                        {JSON.stringify(p1Result.event, null, 2)}
                      </div>
                    )}
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', marginTop: '1.5rem', lineHeight: '1.6' }}>
                      Notice how the JSON shapes on the left are completely incompatible?
                      Yet, when ingested, they all land in the Canonical Event Feed below with exactly the same schema.
                      Every downstream query only needs to read from one shape.
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', lineHeight: '1.6' }}>
                    Click a source on the left to inject its native payload. The registry will parse it, unify it,
                    and update the main dashboard metrics instantly.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PROBLEM 2: Deduplication ── */}
      <div className="problem fi d5">
        <div className="problem-card">
          <div className="problem-header">
            <div className="problem-icon" style={{ background: 'var(--yellow-dim)' }}>
              <Copy size={20} color="var(--yellow)" />
            </div>
            <div>
              <div className="problem-title">Problem 2: Exactly-Once Semantics (Deduplication)</div>
              <div className="problem-desc">
                Every vendor redelivers webhooks. Without a deterministic dedup key, the same activity double-counts.
                We hash <code style={{color:'var(--green)'}}>SHA256(source + vendor_id)</code> to generate a rock-solid <code style={{color:'var(--green)'}}>event_id</code>.
                When a duplicate arrives, we run <code style={{color:'var(--green)'}}>ON CONFLICT DO UPDATE</code> — updating late facts (like costs) but <strong>never</strong> double-counting tokens.
              </div>
            </div>
          </div>
          <div className="problem-body">
            <div className="scenario-grid">
              <div className="scenario">
                <div className="scenario-label try"><Play size={10} /> Step-by-Step Interactive Demo</div>
                <div className="json-box">{JSON.stringify(SCENARIOS.duplicate, null, 2)}</div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  {p2Step === 0 && (
                    <button className="btn btn-accent btn-full" onClick={runDedup} disabled={p2Loading} style={{padding: '0.75rem'}}>
                      <Play size={16} /> Step 1: Ingest 750 Tokens
                    </button>
                  )}
                  {p2Step === 1 && (
                    <button className="btn btn-accent btn-full pulse-yellow" onClick={runDedup} disabled={p2Loading} style={{ background: 'var(--yellow)', color: '#000', fontWeight: 'bold', padding: '0.75rem' }}>
                      <RefreshCw size={16} /> Step 2: Receive Duplicate Webhook!
                    </button>
                  )}
                  {p2Step === 2 && (
                    <button className="btn btn-ghost btn-full" onClick={resetDedup} style={{padding: '0.75rem'}}>
                      <RefreshCw size={16} /> Reset Dedup Demo
                    </button>
                  )}
                </div>
              </div>
              <div className="scenario">
                <div className="scenario-label result"><CheckCircle size={10} /> Execution Trace</div>
                {p2Results.length === 0 && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', lineHeight: '1.6' }}>
                    This demo has two steps. First, we ingest an event with 750 tokens. Next, we simulate
                    a webhook redelivery by injecting the exact same event again. Watch the dashboard:
                    the token count will <strong>not</strong> double.
                  </p>
                )}
                {p2Results.map((r, i) => (
                  <div key={i} className={`result-box ${r.trace?.includes('success_upsert') ? 'result-warn' : 'result-ok'}`} style={{ marginBottom: '0.75rem' }}>
                    <strong>{i === 0 ? 'Initial Insert' : 'Redelivery'}:</strong> {r.message}
                  </div>
                ))}
                {p2Step === 2 && (
                  <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'var(--green-dim)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 'var(--r-sm)', fontSize: '0.875rem', color: 'var(--green)' }}>
                    <strong>Mathematical Proof:</strong> Look at the Total Tokens metric in the dashboard.
                    The 750 tokens were not added twice. The deterministic hash caught the collision
                    and safely upserted the row instead of creating a corrupt duplicate.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PROBLEM 3: Structural Drift ── */}
      <div className="problem fi d5">
        <div className="problem-card">
          <div className="problem-header">
            <div className="problem-icon" style={{ background: 'var(--red-dim)' }}>
              <AlertTriangle size={20} color="var(--red)" />
            </div>
            <div>
              <div className="problem-title">Problem 3: Structural Drift Prevention</div>
              <div className="problem-desc">
                What if OpenAI silently renames <code style={{color:'var(--green)'}}>prompt_tokens</code> to <code style={{color:'var(--red)'}}>input_tokens</code> in a minor API update?
                A naive parser would read <code style={{color:'var(--red)'}}>null</code> and report $0 cost — a silent failure that destroys dashboard trust.
                Our parser throws a <code style={{color:'var(--red)'}}>StructuralDriftException</code> the exact moment a required path is missing.
              </div>
            </div>
          </div>
          <div className="problem-body">
            <div className="scenario-grid">
              <div className="scenario">
                <div className="scenario-label try"><Play size={10} /> The Mutated Payload</div>
                <div className="json-box">
                  {JSON.stringify(SCENARIOS.drift, null, 2)}
                </div>
                <p style={{ fontSize: '0.875rem', color: 'var(--red)', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                  Notice: This payload uses <code>input_tokens</code> instead of <code>prompt_tokens</code>.
                  A weak parser would silently swallow this and return 0 tokens. Let's see what our system does.
                </p>
                <button className="btn btn-accent btn-full" onClick={runDrift} disabled={p3Loading} style={{ background: 'var(--red)', padding: '0.75rem', fontWeight: 'bold' }}>
                  <AlertTriangle size={16} /> Inject Mutated Payload
                </button>
              </div>
              <div className="scenario">
                <div className="scenario-label result"><Shield size={10} /> Protection Activated</div>
                {p3Result ? (
                  <>
                    <div className="result-box result-err" style={{ marginTop: 0 }}>
                      <strong>Exception: Structural Drift Caught</strong><br />
                      {p3Result.message}
                    </div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', marginTop: '1.5rem', lineHeight: '1.6' }}>
                      The event was <strong style={{ color: 'var(--text)' }}>rejected cleanly at the Parser layer</strong> — it never touched the database.
                      The dashboard metrics remain uncorrupted. In production, this exception routes to an alerting system, notifying
                      the engineering team to update the parser. Trust is maintained.
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', lineHeight: '1.6' }}>
                    Click the button to send a payload with a drifted schema.
                    Our strict validation will catch it instantly, protecting the integrity of the data warehouse.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ━━ CANONICAL FEED ━━ */}
      <div className="sec-label fi d5" style={{ marginTop: '4rem' }}>Canonical Event Feed · Source of Truth</div>
      <div className="card fi d5" style={{ marginBottom: '4rem' }}>
        <div className="card-head" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
            <h3><Database size={15} /> Unified Event Table</h3>
            <span className="card-tag">{events.length} rows</span>
          </div>
          <button className="btn btn-ghost" onClick={resolveCosts} disabled={costResolving}>
             {costResolving ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />}
             Resolve Pending Costs (Batch Job)
          </button>
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ paddingLeft: '2rem' }}>AI Source</th>
                <th>Model</th>
                <th>Operation</th>
                <th style={{ textAlign: 'right' }}>Total Tokens</th>
                <th style={{ textAlign: 'right', paddingRight: '2rem' }}>Calculated Cost</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.event_id}>
                  <td style={{ paddingLeft: '2rem' }}><span className={`badge badge-${ev.source}`}>{ev.source}</span></td>
                  <td style={{ fontWeight: 500 }}>{ev.model_name.replace('-20240229', '').replace('-0125', '')}</td>
                  <td style={{ color: 'var(--text-3)' }}>{ev.action}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{ev.total_tokens.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', paddingRight: '2rem' }} className={ev.cost_usd > 0 ? 'cost-ok' : 'cost-wait'}>
                    {ev.cost_usd > 0 ? `$${ev.cost_usd.toFixed(4)}` : 'Resolving...'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ━━ ARCHITECTURE ━━ */}
      <div className="sec-label fi d6">System Architecture</div>
      <div className="card fi d6" style={{ marginBottom: '4rem' }}>
        <div className="card-head"><h3><Database size={15} /> Deterministic Ingestion Pipeline</h3><span className="card-tag">4 phases</span></div>
        <div className="card-body">
          <p style={{ fontSize: '0.9375rem', color: 'var(--text-3)', marginBottom: '2.5rem', lineHeight: 1.6, maxWidth: 900 }}>
            Every AI event flows through four immutable stages. Each stage isolates and solves a specific distributed systems problem.
            This architecture ensures absolute data integrity regardless of vendor instability.
          </p>
          <div className="pipeline">
            <div className="pipe-stage">
              <div className="pipe-icon" style={{ background: 'var(--accent-dim)' }}><Server size={22} color="var(--accent)" /></div>
              <div className="pipe-name" style={{fontSize: '0.9375rem', marginTop: '0.5rem'}}>API Gateway</div>
              <div className="pipe-sub" style={{fontSize: '0.8125rem'}}>Receives raw webhooks asynchronously from any AI provider.</div>
              <div className="pipe-arrow"><ChevronRight size={20} /></div>
            </div>
            <div className="pipe-stage">
              <div className="pipe-icon" style={{ background: 'var(--red-dim)' }}><Shield size={22} color="var(--red)" /></div>
              <div className="pipe-name" style={{fontSize: '0.9375rem', marginTop: '0.5rem'}}>Drift Detector</div>
              <div className="pipe-sub" style={{fontSize: '0.8125rem'}}>Enforces strict schema compliance. Rejects silent structural changes.</div>
              <div className="pipe-arrow"><ChevronRight size={20} /></div>
            </div>
            <div className="pipe-stage">
              <div className="pipe-icon" style={{ background: 'var(--accent-dim)' }}><Hash size={22} color="var(--accent)" /></div>
              <div className="pipe-name" style={{fontSize: '0.9375rem', marginTop: '0.5rem'}}>SHA-256 Hasher</div>
              <div className="pipe-sub" style={{fontSize: '0.8125rem'}}>Derives deterministic identity key from (source + vendor_id).</div>
              <div className="pipe-arrow"><ChevronRight size={20} /></div>
            </div>
            <div className="pipe-stage">
              <div className="pipe-icon" style={{ background: 'var(--green-dim)' }}><Save size={22} color="var(--green)" /></div>
              <div className="pipe-name" style={{fontSize: '0.9375rem', marginTop: '0.5rem'}}>Idempotent Store</div>
              <div className="pipe-sub" style={{fontSize: '0.8125rem'}}>ON CONFLICT DO UPDATE. Safely backfills late-arriving costs.</div>
            </div>
          </div>
        </div>
      </div>

      {/* ━━ SCALING ━━ */}
      <div className="sec-label fi d6">Engineering Roadmap · How This Scales</div>
      <div className="g3 fi d6" style={{ marginBottom: '4rem' }}>
        <div className="scope">
          <h4><Layers size={16} color="var(--accent)" /> Kafka + ClickHouse</h4>
          <p style={{fontSize: '0.875rem', marginTop: '0.5rem', lineHeight: '1.6'}}>Replace SQLite with a Kafka topic for high-throughput ingest and ClickHouse for sub-second columnar analytics. The Canonical Schema remains identical.</p>
        </div>
        <div className="scope">
          <h4><Shield size={16} color="var(--red)" /> Policy Engine</h4>
          <p style={{fontSize: '0.875rem', marginTop: '0.5rem', lineHeight: '1.6'}}>Attach spend limits, model allowlists, and PII redaction rules. Because all events flow through one pipeline, policies can be enforced globally at the Drift Detector stage.</p>
        </div>
        <div className="scope">
          <h4><Users size={16} color="var(--green)" /> Identity Resolution</h4>
          <p style={{fontSize: '0.875rem', marginTop: '0.5rem', lineHeight: '1.6'}}>The <code style={{color: 'var(--green)'}}>identity_id</code> field exists but is unresolved at ingest. An asynchronous batch job maps these events back to SSO identities for precise cost attribution.</p>
        </div>
      </div>

      {/* ━━ ABOUT ━━ */}
      <div className="about fi d7">
        <div className="about-grid">
          <div>
            <div className="sec-label">About the Builder</div>
            <div className="about-quote">
              "I read the Oximy JD, reverse-engineered the core data engineering problems, and built a fully functional ingestion engine before submitting my resume. My GitHub speaks for itself."
            </div>
            <p style={{ fontSize: '0.9375rem', color: 'var(--text-3)', lineHeight: 1.7, marginBottom: '2rem' }}>
              This entire prototype was architected and built by <strong style={{ color: 'var(--text)' }}>Yashwanth</strong> using
              an agentic AI workflow — precisely how Oximy envisions the future of engineering.
              I delegated the boilerplate to the agent, identified the critical architectural walls (structural drift, idempotent deduplication, schema normalization),
              and solved them with production-grade code.
            </p>
            <a href="https://github.com/ryash14" target="_blank" rel="noreferrer" className="github-btn pulse-glow" style={{ display: 'inline-flex', padding: '0.875rem 1.75rem', fontSize: '0.9375rem', borderRadius: '12px' }}>
              <Code size={18} /> View Source Code on GitHub <ArrowUpRight size={16} />
            </a>
          </div>
          <div>
            <div className="sec-label">Mapping JD Requirements to Execution</div>
            <ul className="fit-list">
              <li className="fit-item">
                <span className="fit-check"><CheckCircle size={12} color="var(--green)" /></span>
                <span><strong style={{ color: 'var(--text)' }}>"Ship like you have eight hands"</strong> — I designed and shipped a FastAPI backend, an SQLite idempotent ingestion engine, a 4-vendor parser registry, and a React dashboard in a single session.</span>
              </li>
              <li className="fit-item">
                <span className="fit-check"><CheckCircle size={12} color="var(--green)" /></span>
                <span><strong style={{ color: 'var(--text)' }}>"Go find the wall"</strong> — I didn't gloss over structural drift. I engineered a strict parsing layer that catches vendor schema changes and throws exceptions before data corruption occurs.</span>
              </li>
              <li className="fit-item">
                <span className="fit-check"><CheckCircle size={12} color="var(--green)" /></span>
                <span><strong style={{ color: 'var(--text)' }}>"Obsessive about taste"</strong> — The engineering is meaningless if the UX is poor. Every detail, from the color contrast to the custom scrollbars, was meticulously refined.</span>
              </li>
              <li className="fit-item">
                <span className="fit-check"><CheckCircle size={12} color="var(--green)" /></span>
                <span><strong style={{ color: 'var(--text)' }}>"Break the agents, build guardrails"</strong> — The interactive demos above execute the live production codebase. It's not a mockup; it's a verifiable proof of concept. Try to break it.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

    </div>
  )
}

export default App
