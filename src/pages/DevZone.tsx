import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Terminal, RefreshCw, AlertTriangle, OctagonAlert, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Search,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { supabase } from '@/integrations/supabase/client';

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

type Tab = 'app-logs' | 'audit-trail';

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

const DevZone = () => {
  const [tab, setTab] = useState<Tab>('app-logs');

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
                <p className="text-[10px] text-muted-foreground">Application logs &amp; MCP audit trail</p>
              </div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5">
        <div className="mb-4 flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
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
        </div>

        <p className="mb-4 text-[11px] text-muted-foreground">
          Showing the latest {ROW_LIMIT} rows. Info-level edge-function logs aren't persisted here —
          use <code className="rounded bg-muted px-1 py-0.5 font-mono">supabase functions logs &lt;fn&gt;</code> for
          full stdout output.
        </p>

        {tab === 'app-logs' ? <AppLogsTab /> : <AuditTrailTab />}
      </div>
    </div>
  );
};

export default DevZone;
