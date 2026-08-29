import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Terminal, RefreshCw, AlertTriangle, OctagonAlert, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Search, Loader2, Activity, ShieldAlert, LogOut,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { supabase } from '@/integrations/supabase/client';
import { useSecurityIncidents, type SecurityIncident } from '@/contexts/SecurityIncidentsContext';

// One-stop view over everything this app currently persists as a "log":
//   - app_logs   — logger.ts warn/error entries from every edge function (via
//                  _shared/db-log-sink.ts), plus frontend runtime errors (via
//                  src/lib/clientErrorLogging.ts + ErrorBoundary.tsx).
//   - audit_logs — the pre-existing MCP tool-call trail (portfolio-mcp-server).
// info-level edge-function logs are NOT here by design — see the app_logs
// migration's header comment; those remain stdout-only via
// `supabase functions logs <fn>`, same as before this page existed.
const ROW_LIMIT = 200;

type AppLogLevel = 'warn' | 'error';
type AppLogSource = 'edge' | 'frontend';

interface AppLogRow {
  id: string;
  logged_at: string;
  source: string;
  level: string;
  fn: string;
  message: string;
  context: unknown;
}

interface AuditLogRow {
  id: string;
  called_at: string;
  actor: string | null;
  tool_name: string;
  arguments: unknown;
  duration_ms: number;
  success: boolean;
  error: string | null;
}

type Tab = 'status' | 'app-logs' | 'audit-trail' | 'security';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function LevelBadge({ level }: { level: string }) {
  const isError = level === 'error';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      isError ? 'bg-rose-500/10 text-rose-500 border border-rose-500/30' : 'bg-amber-500/10 text-amber-500 border border-amber-500/30'
    }`}>
      {isError ? <OctagonAlert className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {level}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {source}
    </span>
  );
}

/** Pretty-printed JSON context/arguments, shown only when a row is expanded — most rows are
 * scanned by message/tool-name alone, so the raw payload stays collapsed until asked for. */
function JsonBlock({ value }: { value: unknown }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  if (!text || text === '{}' || text === 'null') return null;
  return (
    <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed text-foreground/80">
      {text}
    </pre>
  );
}

function useExpandable() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  return { expanded, toggle };
}

// ---------------------------------------------------------------------------
// System Status — a live view of whether this app's actual dependencies
// (Postgres, Auth, and every edge function) are up and reachable, distinct
// from the App Logs tab above which is a passive history of what already
// went wrong. Two kinds of check:
//   - Core checks make a real round-trip (a PostgREST query, a GoTrue call)
//     and so prove the thing actually works, not just that it's deployed.
//   - Edge function checks send a deliberately unauthenticated POST — every
//     function's requireUser()/service-role check runs before touching the
//     DB or an external API (see e.g.
//     supabase/functions/fetch-prices/index.ts), so a 401 back proves the
//     function is deployed and responding, not that its internal logic
//     succeeds. Good enough as a first signal without spending real
//     quota/rate-limit budget on every page load, and safe to call with just
//     the anon key even for the internal-only portfolio-mcp-server function
//     (it 401s the same way, before ever checking for the service-role key).
//     Deliberately not a raw OPTIONS request — see pingEdgeFunction's own
//     comment for why that doesn't work from a browser.
type CheckStatus = 'checking' | 'ok' | 'error';
type DeepStatus = 'idle' | 'checking' | 'ok' | 'error';

interface CheckResult {
  status: 'ok' | 'error';
  detail: string;
  latencyMs?: number;
}

interface CheckRow {
  id: string;
  label: string;
  group: 'Core' | 'Edge Functions';
  status: CheckStatus;
  detail: string;
  latencyMs?: number;
  deepStatus?: DeepStatus;
  deepDetail?: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const EDGE_FN_TIMEOUT_MS = 6000;

const CORE_CHECKS: { id: string; label: string; run: () => Promise<CheckResult> }[] = [
  {
    id: 'frontend',
    label: 'Frontend (this app)',
    run: async () => ({ status: 'ok', detail: `Rendering · ${import.meta.env.MODE} build` }),
  },
  {
    id: 'database',
    label: 'Database (Postgres via PostgREST)',
    run: async () => {
      const start = performance.now();
      const { error } = await supabase.from('cash_settings').select('id', { count: 'exact', head: true });
      const latencyMs = Math.round(performance.now() - start);
      return error
        ? { status: 'error', detail: error.message, latencyMs }
        : { status: 'ok', detail: 'Query round-trip succeeded', latencyMs };
    },
  },
  {
    id: 'auth',
    label: 'Auth (GoTrue)',
    run: async () => {
      const start = performance.now();
      const { error } = await supabase.auth.getUser();
      const latencyMs = Math.round(performance.now() - start);
      return error
        ? { status: 'error', detail: error.message, latencyMs }
        : { status: 'ok', detail: 'Session token verified', latencyMs };
    },
  },
];

const EDGE_FUNCTIONS: { id: string; label: string }[] = [
  { id: 'portfolio-ai', label: 'Portfolio AI (chat agent)' },
  { id: 'portfolio-mcp-server', label: 'Portfolio MCP Server' },
  { id: 'fetch-prices', label: 'Fetch Prices' },
  { id: 'fetch-fx-rates', label: 'Fetch FX Rates' },
  { id: 'fetch-benchmark-prices', label: 'Fetch Benchmark Prices' },
  { id: 'fetch-historical-prices', label: 'Fetch Historical Prices' },
  { id: 'fetch-pe-ratio', label: 'Fetch P/E Ratio' },
  { id: 'fetch-ticker-cape', label: 'Fetch Ticker CAPE' },
];

async function pingEdgeFunction(id: string): Promise<CheckResult> {
  if (!SUPABASE_URL) return { status: 'error', detail: 'VITE_SUPABASE_URL is not set' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EDGE_FN_TIMEOUT_MS);
  const start = performance.now();
  try {
    // A manually-fired OPTIONS doesn't work here: OPTIONS isn't one of the
    // three CORS-safelisted methods (GET/HEAD/POST), so the browser itself
    // needs to preflight our own OPTIONS request before sending it — and
    // that preflight's response (this same function, since it answers every
    // OPTIONS identically) has no Access-Control-Allow-Methods header, so
    // the browser refuses to send the actual request at all. It surfaces as
    // a generic "Failed to fetch", indistinguishable from the function
    // actually being down.
    //
    // A POST doesn't have this problem — POST *is* CORS-safelisted, so a
    // preflight is only needed for the non-simple headers below, and only
    // Access-Control-Allow-Headers is checked for those, which every
    // function already sends (see buildCorsHeaders). This is the same
    // request shape the app already makes in production, just deliberately
    // unauthenticated: every function's requireUser()/service-role check
    // runs first and rejects with 401 before touching the DB or an external
    // API, so a 401 here means "deployed and responding", not "broken".
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY ?? '' },
      body: '{}',
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - start);
    return res.ok || res.status === 401
      ? { status: 'ok', detail: res.status === 401 ? 'Reachable (401 expected without a session)' : 'Reachable', latencyMs }
      : { status: 'error', detail: `Unexpected HTTP ${res.status}`, latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const detail = isAbort
      ? `Timed out after ${EDGE_FN_TIMEOUT_MS / 1000}s`
      : err instanceof Error ? err.message : 'Network error';
    return { status: 'error', detail, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Deep checks — opt-in only, never run automatically. Unlike the OPTIONS
// ping above, these make a real authenticated call into each function so
// they actually exercise its logic (a live Yahoo Finance round-trip, a real
// LLM turn), not just "is it deployed". That means they cost real quota
// (Yahoo rate limits, portfolio-ai's own rate limiter, LLM tokens) and, for
// the price/historical functions, write real (correct) data back to the
// same tables the app already relies on — so they're gated behind an
// explicit "Run Deep Checks" click, not folded into the page-load checks.
//
// portfolio-mcp-server has no separate deep check: it requires the
// service-role secret (see its requestHasServiceRole() gate), which must
// never reach the browser, so it can only be exercised indirectly —
// portfolio-ai's own deep check calls initialize/listTools/tools-call on it
// as part of a real chat turn.
interface DeepResult {
  status: 'ok' | 'error';
  detail: string;
}

const CHAT_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/portfolio-ai` : '';
const DEEP_CHECK_TIMEOUT_MS = 20000;

/** One transaction's symbol, used as a realistic probe for the price/valuation
 * functions below — deep-checking with real portfolio data instead of an
 * arbitrary ticker, so any data written back is data the app already wants. */
async function getProbeSymbol(): Promise<string | null> {
  const { data, error } = await supabase.from('transactions').select('symbol').limit(1);
  if (error || !data || data.length === 0) return null;
  return (data[0] as { symbol: string }).symbol;
}

async function deepCheckFetchPrices(symbol: string | null): Promise<DeepResult> {
  if (!symbol) return { status: 'error', detail: 'No portfolio symbol to test with' };
  const { data, error } = await supabase.functions.invoke('fetch-prices', { body: { symbols: [symbol] } });
  if (error) return { status: 'error', detail: error.message };
  const price = data?.prices?.[symbol];
  return price != null
    ? { status: 'ok', detail: `Live price for ${symbol}: ${price}` }
    : { status: 'error', detail: `No price returned for ${symbol}` };
}

async function deepCheckHistoricalPrices(symbol: string | null): Promise<DeepResult> {
  if (!symbol) return { status: 'error', detail: 'No portfolio symbol to test with' };
  // Small range/interval — this is a reachability probe, not a real backfill.
  const { data, error } = await supabase.functions.invoke('fetch-historical-prices', {
    body: { symbols: [symbol], range: '5d', interval: '1d' },
  });
  if (error) return { status: 'error', detail: error.message };
  const points = data?.prices?.[symbol];
  return Array.isArray(points) && points.length > 0
    ? { status: 'ok', detail: `${points.length} recent close(s) for ${symbol}` }
    : { status: 'error', detail: `No historical data returned for ${symbol}` };
}

async function deepCheckFxRates(): Promise<DeepResult> {
  const { data, error } = await supabase.functions.invoke('fetch-fx-rates', { body: {} });
  if (error) return { status: 'error', detail: error.message };
  return typeof data?.rate === 'number'
    ? { status: 'ok', detail: `USDINR ${data.rate} as of ${data.date} (${data.source})` }
    : { status: 'error', detail: 'No rate returned' };
}

async function deepCheckBenchmarkPrices(): Promise<DeepResult> {
  const { data, error } = await supabase.functions.invoke('fetch-benchmark-prices', { body: { symbols: ['NIFTY50'] } });
  if (error) return { status: 'error', detail: error.message };
  const points = data?.benchmarks?.NIFTY50;
  if (points?.error) return { status: 'error', detail: points.error };
  return Array.isArray(points) && points.length > 0
    ? { status: 'ok', detail: `${points.length} recent NIFTY50 close(s)` }
    : { status: 'error', detail: 'No benchmark data returned' };
}

async function deepCheckPeRatio(symbol: string | null): Promise<DeepResult> {
  if (!symbol) return { status: 'error', detail: 'No portfolio symbol to test with' };
  const { data, error } = await supabase.functions.invoke('fetch-pe-ratio', { body: { symbol } });
  if (error) return { status: 'error', detail: error.message };
  return data?.symbol === symbol
    ? { status: 'ok', detail: `Trailing P/E for ${symbol}: ${data.trailing_pe ?? 'n/a'}` }
    : { status: 'error', detail: 'Unexpected response shape' };
}

async function deepCheckTickerCape(symbol: string | null): Promise<DeepResult> {
  if (!symbol) return { status: 'error', detail: 'No portfolio symbol to test with' };
  const { data, error } = await supabase.functions.invoke('fetch-ticker-cape', { body: { symbol } });
  if (error) return { status: 'error', detail: error.message };
  if (data?.symbol !== symbol) return { status: 'error', detail: 'Unexpected response shape' };
  return data.cape != null
    ? { status: 'ok', detail: `CAPE for ${symbol}: ${Number(data.cape).toFixed(2)}` }
    : { status: 'ok', detail: `Reachable — no CAPE for ${symbol} (${data.reason ?? 'insufficient data'})` };
}

/** Sends one real (short) chat turn so the full path — auth, rate limiter,
 * portfolio-mcp-server's initialize/listTools, and the LLM provider itself —
 * actually runs, not just the function's own deployment. Stops reading the
 * stream as soon as the first event arrives; it doesn't need the whole reply. */
async function deepCheckPortfolioAi(): Promise<DeepResult> {
  if (!CHAT_URL) return { status: 'error', detail: 'VITE_SUPABASE_URL is not set' };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { status: 'error', detail: 'No active session to authenticate with' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEP_CHECK_TIMEOUT_MS);
  try {
    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with only the word "pong".' }] }),
      signal: controller.signal,
    });
    if (resp.status === 429) return { status: 'error', detail: 'Rate limited — try again in a moment' };
    if (!resp.ok || !resp.body) {
      const body = await resp.json().catch(() => null);
      return { status: 'error', detail: body?.error || `HTTP ${resp.status}` };
    }
    const reader = resp.body.getReader();
    const { done, value } = await reader.read();
    reader.cancel().catch(() => {});
    if (done || !value) return { status: 'error', detail: 'Stream closed with no data' };
    return { status: 'ok', detail: 'Received a live response from the agent (auth, MCP server and LLM all reachable)' };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return { status: 'error', detail: isAbort ? `Timed out after ${DEEP_CHECK_TIMEOUT_MS / 1000}s` : err instanceof Error ? err.message : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
}

const DEEP_CHECKS: Record<string, (symbol: string | null) => Promise<DeepResult>> = {
  'fetch-prices': deepCheckFetchPrices,
  'fetch-historical-prices': deepCheckHistoricalPrices,
  'fetch-fx-rates': deepCheckFxRates,
  'fetch-benchmark-prices': deepCheckBenchmarkPrices,
  'fetch-pe-ratio': deepCheckPeRatio,
  'fetch-ticker-cape': deepCheckTickerCape,
  'portfolio-ai': deepCheckPortfolioAi,
};

function buildInitialRows(): CheckRow[] {
  return [
    ...CORE_CHECKS.map((c) => ({ id: c.id, label: c.label, group: 'Core' as const, status: 'checking' as const, detail: '' })),
    ...EDGE_FUNCTIONS.map((f) => ({
      id: f.id, label: f.label, group: 'Edge Functions' as const, status: 'checking' as const, detail: '',
      deepStatus: (f.id in DEEP_CHECKS ? 'idle' : undefined) as DeepStatus | undefined,
    })),
  ];
}

function StatusDot({ status }: { status: CheckStatus }) {
  if (status === 'checking') return <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-muted-foreground" />;
  if (status === 'ok') return <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />;
  return <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />;
}

function StatusRow({ row }: { row: CheckRow }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <StatusDot status={row.status} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground/90">{row.label}</p>
          <p className={`truncate text-[11px] ${row.status === 'error' ? 'text-rose-500' : 'text-muted-foreground'}`}>
            {row.status === 'checking' ? 'Checking…' : row.detail}
          </p>
        </div>
        {row.latencyMs != null && (
          <span className="shrink-0 text-[10px] font-mono text-muted-foreground">{row.latencyMs}ms</span>
        )}
      </div>
      {row.deepStatus && row.deepStatus !== 'idle' && (
        <div className="flex items-center gap-2 border-t border-border/60 pt-1.5 pl-6">
          {row.deepStatus === 'checking' ? (
            <Loader2 className="w-3 h-3 shrink-0 animate-spin text-sky-500" />
          ) : row.deepStatus === 'ok' ? (
            <CheckCircle2 className="w-3 h-3 shrink-0 text-sky-500" />
          ) : (
            <XCircle className="w-3 h-3 shrink-0 text-rose-500" />
          )}
          <p className={`truncate text-[10px] ${row.deepStatus === 'error' ? 'text-rose-500' : 'text-sky-500'}`}>
            Deep: {row.deepStatus === 'checking' ? 'Checking…' : row.deepDetail}
          </p>
        </div>
      )}
    </div>
  );
}

function StatusGroup({ title, rows }: { title: string; rows: CheckRow[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {rows.map((row) => <StatusRow key={row.id} row={row} />)}
      </div>
    </div>
  );
}

function OverallBanner({ rows, lastRun }: { rows: CheckRow[]; lastRun: Date | null }) {
  const stillChecking = rows.some((r) => r.status === 'checking');
  const errorCount = rows.filter((r) => r.status === 'error').length;

  if (stillChecking) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Running checks…
      </div>
    );
  }
  if (errorCount === 0) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-medium text-emerald-500">
        <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> All systems operational</span>
        {lastRun && <span className="text-[10px] font-normal text-emerald-500/80">Checked {fmtTime(lastRun.toISOString())}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs font-medium text-rose-500">
      <span className="flex items-center gap-2">
        <OctagonAlert className="w-4 h-4" /> {errorCount} of {rows.length} check{errorCount === 1 ? '' : 's'} failing
      </span>
      {lastRun && <span className="text-[10px] font-normal text-rose-500/80">Checked {fmtTime(lastRun.toISOString())}</span>}
    </div>
  );
}

function SystemStatusTab() {
  const [rows, setRows] = useState<CheckRow[]>(buildInitialRows);
  const [running, setRunning] = useState(true);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [deepRunning, setDeepRunning] = useState(false);

  const runAll = useCallback(() => {
    setRunning(true);
    setLastRun(null);
    setRows(buildInitialRows());

    const jobs = [
      ...CORE_CHECKS.map((c) => c.run().then((result) => {
        setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, ...result } : r)));
      })),
      ...EDGE_FUNCTIONS.map((f) => pingEdgeFunction(f.id).then((result) => {
        setRows((prev) => prev.map((r) => (r.id === f.id ? { ...r, ...result } : r)));
      })),
    ];

    Promise.all(jobs).then(() => {
      setRunning(false);
      setLastRun(new Date());
    });
  }, []);

  const runDeepChecks = useCallback(async () => {
    setDeepRunning(true);
    const deepIds = Object.keys(DEEP_CHECKS);
    setRows((prev) => prev.map((r) => (deepIds.includes(r.id) ? { ...r, deepStatus: 'checking', deepDetail: undefined } : r)));

    const symbol = await getProbeSymbol();
    const jobs = deepIds.map((id) =>
      DEEP_CHECKS[id](symbol).then((result) => {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, deepStatus: result.status, deepDetail: result.detail } : r)));
      }),
    );
    await Promise.all(jobs);
    setDeepRunning(false);
  }, []);

  useEffect(() => { runAll(); }, [runAll]);

  return (
    <div className="flex flex-col gap-4">
      <OverallBanner rows={rows} lastRun={lastRun} />

      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Database and Auth checks make a real round-trip. Edge function checks only confirm the function
          is deployed and responding (a 401 to a deliberately unauthenticated request) — not that its
          internal logic (DB writes, external price sources) is working.
        </p>
        <button
          onClick={runAll}
          disabled={running}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
          Recheck
        </button>
      </div>

      <StatusGroup title="Core" rows={rows.filter((r) => r.group === 'Core')} />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Edge Functions</h2>
          <button
            onClick={runDeepChecks}
            disabled={deepRunning}
            title="Makes real calls into each function — live Yahoo Finance lookups and one real Portfolio AI chat turn, counting against its own rate limit and LLM usage."
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-500 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
          >
            <Loader2 className={`w-3.5 h-3.5 ${deepRunning ? 'animate-spin' : 'hidden'}`} />
            {deepRunning ? 'Running deep checks…' : 'Run Deep Checks'}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Deep checks send real requests — live Yahoo Finance lookups for a symbol from your own
          portfolio, and one real chat turn to Portfolio AI (which counts toward its rate limit and
          LLM usage). Portfolio MCP Server has no separate deep check — it's exercised indirectly by
          Portfolio AI's, since only that function is allowed to hold the service-role key it requires.
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {rows.filter((r) => r.group === 'Edge Functions').map((row) => <StatusRow key={row.id} row={row} />)}
        </div>
      </div>
    </div>
  );
}

function AppLogsTab() {
  const [rows, setRows] = useState<AppLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<AppLogLevel | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<AppLogSource | 'all'>('all');
  const [search, setSearch] = useState('');
  const { expanded, toggle } = useExpandable();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('app_logs')
      .select('*')
      .order('logged_at', { ascending: false })
      .limit(ROW_LIMIT);
    if (err) setError(err.message);
    else setRows((data ?? []) as AppLogRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => {
    if (levelFilter !== 'all' && r.level !== levelFilter) return false;
    if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!r.fn.toLowerCase().includes(q) && !r.message.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <FilterBar onRefresh={load} loading={loading}>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as AppLogLevel | 'all')}
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
        >
          <option value="all">All levels</option>
          <option value="error">Error</option>
          <option value="warn">Warn</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as AppLogSource | 'all')}
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
        >
          <option value="all">All sources</option>
          <option value="edge">Edge functions</option>
          <option value="frontend">Frontend</option>
        </select>
        <SearchBox value={search} onChange={setSearch} placeholder="Search function or message..." />
      </FilterBar>

      {error && <ErrorBanner message={error} />}
      {!error && !loading && filtered.length === 0 && (
        <EmptyState text={rows.length === 0 ? "No warnings or errors logged yet — that's a good sign." : 'No rows match these filters.'} />
      )}

      <div className="flex flex-col gap-1.5">
        {filtered.map((row) => (
          <div key={row.id} className="rounded-lg border border-border bg-card">
            <button
              onClick={() => toggle(row.id)}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors"
            >
              {expanded.has(row.id) ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <LevelBadge level={row.level} />
                  <SourceBadge source={row.source} />
                  <span className="text-[11px] font-mono text-muted-foreground">{row.fn}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtTime(row.logged_at)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-foreground/90">{row.message}</p>
                {expanded.has(row.id) && <JsonBlock value={row.context} />}
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditTrailTab() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [search, setSearch] = useState('');
  const { expanded, toggle } = useExpandable();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('audit_logs')
      .select('*')
      .order('called_at', { ascending: false })
      .limit(ROW_LIMIT);
    if (err) setError(err.message);
    else setRows((data ?? []) as AuditLogRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => {
    if (statusFilter === 'success' && !r.success) return false;
    if (statusFilter === 'failed' && r.success) return false;
    if (search.trim() && !r.tool_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <FilterBar onRefresh={load} loading={loading}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'success' | 'failed')}
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
        >
          <option value="all">All calls</option>
          <option value="success">Success only</option>
          <option value="failed">Failed only</option>
        </select>
        <SearchBox value={search} onChange={setSearch} placeholder="Search tool name..." />
      </FilterBar>

      {error && <ErrorBanner message={error} />}
      {!error && !loading && filtered.length === 0 && (
        <EmptyState text={rows.length === 0 ? 'No MCP tool calls recorded yet.' : 'No rows match these filters.'} />
      )}

      <div className="flex flex-col gap-1.5">
        {filtered.map((row) => (
          <div key={row.id} className="rounded-lg border border-border bg-card">
            <button
              onClick={() => toggle(row.id)}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors"
            >
              {expanded.has(row.id) ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {row.success ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                      <CheckCircle2 className="w-3 h-3" /> success
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-500">
                      <XCircle className="w-3 h-3" /> failed
                    </span>
                  )}
                  <span className="text-[11px] font-mono text-foreground/90">{row.tool_name}</span>
                  <span className="text-[10px] text-muted-foreground">{row.duration_ms}ms</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtTime(row.called_at)}</span>
                </div>
                {row.error && <p className="mt-1 text-xs text-rose-500">{row.error}</p>}
                {expanded.has(row.id) && <JsonBlock value={row.arguments} />}
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security tab — docs/session-hijack-detection-plan.md §1, §3, §5. Global
// sign-out (§1) revokes every refresh token for the account; it does NOT
// retroactively invalidate an access token already issued and still inside
// its ~1hr expiry (Supabase Auth doesn't check a revocation list per-request
// by default) — stated up front in the UI, not just the design doc, since
// that's a real gap someone relying on this button should know about.
//
// The incident list (§3) shows the full ack+unack history, not just what the
// app-wide banner is watching for — SecurityIncidentsContext only tracks the
// unacknowledged subset, so this tab does its own query, same pattern as
// AppLogsTab/AuditTrailTab above. Acknowledging here also calls that
// context's refetch() so the banner clears immediately in this tab session.
function GlobalSignOutCard() {
  const [signingOut, setSigningOut] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSignOut = async () => {
    if (!confirm(
      'Sign out of every device and browser using this account?\n\n' +
      'This revokes all refresh tokens, so nothing can log back in without your ' +
      'password again. It does NOT instantly kill an access token already issued ' +
      'and still inside its ~1hr expiry — this stops it being renewed, not an ' +
      'in-progress request.',
    )) return;

    setSigningOut(true);
    setResult(null);
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    setSigningOut(false);
    setResult(
      error
        ? { ok: false, message: error.message }
        : { ok: true, message: 'Signed out everywhere. This tab will redirect to login shortly.' },
    );
  };

  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
      <div className="flex items-start gap-3">
        <LogOut className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Global sign-out</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Revokes every refresh token for this account — use this if you suspect a session has
            been compromised. <strong className="text-foreground/80">Known limitation:</strong> a
            still-valid access token already issued (~1hr expiry) keeps working until it naturally
            expires; this stops it being renewed, it isn't an instant kill switch.
          </p>
          {result && (
            <p className={`mt-2 text-xs font-medium ${result.ok ? 'text-emerald-500' : 'text-rose-500'}`}>
              {result.message}
            </p>
          )}
        </div>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="shrink-0 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-500 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
        >
          {signingOut ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </div>
    </div>
  );
}

function IncidentDiff({ incident }: { incident: SecurityIncident }) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Before</p>
        <JsonBlock value={incident.old_values} />
        {incident.old_values == null && <p className="text-[11px] text-muted-foreground/70 italic">n/a</p>}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">After</p>
        <JsonBlock value={incident.new_values} />
        {incident.new_values == null && <p className="text-[11px] text-muted-foreground/70 italic">n/a</p>}
      </div>
    </div>
  );
}

function SecurityTab() {
  const { refetch: refetchBanner } = useSecurityIncidents();
  const [rows, setRows] = useState<SecurityIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unacknowledged' | 'acknowledged'>('unacknowledged');
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const { expanded, toggle } = useExpandable();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('security_incidents')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(ROW_LIMIT);
    if (err) setError(err.message);
    else setRows((data ?? []) as SecurityIncident[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const acknowledge = async (id: string) => {
    setAcknowledgingId(id);
    const { error: err } = await supabase.from('security_incidents').update({ acknowledged: true }).eq('id', id);
    setAcknowledgingId(null);
    if (err) { setError(err.message); return; }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, acknowledged: true } : r)));
    refetchBanner();
  };

  const filtered = rows.filter((r) => {
    if (statusFilter === 'unacknowledged' && r.acknowledged) return false;
    if (statusFilter === 'acknowledged' && !r.acknowledged) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <GlobalSignOutCard />

      <FilterBar onRefresh={load} loading={loading}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'unacknowledged' | 'acknowledged')}
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
        >
          <option value="unacknowledged">Unacknowledged</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="all">All incidents</option>
        </select>
      </FilterBar>

      {error && <ErrorBanner message={error} />}
      {!error && !loading && filtered.length === 0 && (
        <EmptyState text={rows.length === 0
          ? 'No replay incidents detected yet — that\'s a good sign.'
          : 'No rows match this filter.'} />
      )}

      <div className="flex flex-col gap-1.5">
        {filtered.map((row) => (
          <div key={row.id} className="rounded-lg border border-border bg-card">
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <button
                onClick={() => toggle(row.id)}
                className="flex flex-1 items-start gap-2.5 text-left hover:bg-accent/40 -m-1 p-1 rounded-md transition-colors"
              >
                {expanded.has(row.id) ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-500">
                      <ShieldAlert className="w-3 h-3" /> {row.operation}
                    </span>
                    <span className="text-[11px] font-mono text-foreground/90">{row.table_name}</span>
                    {row.row_id && <span className="text-[10px] font-mono text-muted-foreground">#{row.row_id}</span>}
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtTime(row.detected_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-foreground/90">
                    Session <span className="font-mono">{row.session_id.slice(0, 8)}…</span> replayed from{' '}
                    <span className="font-mono">{row.ip ?? 'unknown IP'}</span>
                    {row.user_agent && <span className="text-muted-foreground"> · {row.user_agent}</span>}
                  </p>
                  {expanded.has(row.id) && <IncidentDiff incident={row} />}
                </div>
              </button>
              {!row.acknowledged ? (
                <button
                  onClick={() => acknowledge(row.id)}
                  disabled={acknowledgingId === row.id}
                  className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {acknowledgingId === row.id ? 'Acknowledging…' : 'Acknowledge'}
                </button>
              ) : (
                <span className="shrink-0 text-[10px] font-medium text-muted-foreground">Acknowledged</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterBar({ children, onRefresh, loading }: { children: React.ReactNode; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        Refresh
      </button>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5">
      <Search className="w-3.5 h-3.5 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-40 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none sm:w-56"
      />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-500">
      Failed to load: {message}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

const VALID_TABS: Tab[] = ['status', 'app-logs', 'audit-trail', 'security'];

const DevZone = () => {
  const [searchParams] = useSearchParams();
  // Lets SecurityIncidentBanner's link (/dev-zone?tab=security) land directly
  // on the Security tab instead of the default System Status view.
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    VALID_TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'status',
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/80 bg-card/70 backdrop-blur-md sticky top-0 z-40 supports-[backdrop-filter]:bg-card/50">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/overview"
              className="text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 -ml-1 hover:bg-muted/60"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-primary/20 to-emerald-500/20 border border-primary/20">
                <Terminal className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-foreground tracking-tight">Dev Zone</h1>
                <p className="text-[10px] text-muted-foreground">System status, application logs, MCP audit trail &amp; security</p>
              </div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5">
        <div className="mb-4 flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
          <button
            onClick={() => setTab('status')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'status' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            System Status
          </button>
          <button
            onClick={() => setTab('app-logs')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'app-logs' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            App Logs
          </button>
          <button
            onClick={() => setTab('audit-trail')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'audit-trail' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Audit Trail
          </button>
          <button
            onClick={() => setTab('security')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'security' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Security
          </button>
        </div>

        {tab !== 'status' && tab !== 'security' && (
          <p className="mb-4 text-[11px] text-muted-foreground">
            Showing the latest {ROW_LIMIT} rows. Info-level edge-function logs aren't persisted here —
            use <code className="rounded bg-muted px-1 py-0.5 font-mono">supabase functions logs &lt;fn&gt;</code> for
            full stdout output.
          </p>
        )}

        {tab === 'status' ? <SystemStatusTab />
          : tab === 'app-logs' ? <AppLogsTab />
          : tab === 'audit-trail' ? <AuditTrailTab />
          : <SecurityTab />}
      </div>
    </div>
  );
};

export default DevZone;
