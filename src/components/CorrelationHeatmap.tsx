import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Activity } from 'lucide-react';
import type { Transaction } from '@/types/portfolio';

type PriceRow = { symbol: string; date: string; close: number };

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ex = xs[i] - mx, ey = ys[i] - my;
    num += ex * ey;
    dx += ex * ex;
    dy += ey * ey;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

function colorFor(c: number): string {
  if (!Number.isFinite(c)) return 'hsl(var(--muted))';
  // -1 red, 0 neutral, +1 green
  const t = Math.max(-1, Math.min(1, c));
  if (t >= 0) {
    const alpha = 0.15 + t * 0.65;
    return `hsla(152, 60%, 42%, ${alpha})`;
  } else {
    const alpha = 0.15 + (-t) * 0.65;
    return `hsla(0, 72%, 55%, ${alpha})`;
  }
}

/**
 * Takes `transactions` as a prop from the parent's own usePortfolio() call
 * instead of calling usePortfolio() again itself — that second call used to
 * re-fetch transactions/cash_settings/current_prices/symbol_metadata a
 * second time on every visit to /charts, since usePortfolio isn't backed by
 * a shared cache/context. See docs/perf-findings.md#2.
 */
export function CorrelationHeatmap({ transactions }: { transactions: Transaction[] }) {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const symbols = useMemo(
    () => Array.from(new Set(transactions.map(t => t.symbol))).sort(),
    [transactions],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('historical_prices')
        .select('symbol,date,close')
        .order('date', { ascending: true });
      setRows((data as any[] | null)?.map(r => ({ symbol: r.symbol, date: r.date, close: Number(r.close) })) ?? []);
      setLoading(false);
    })();
  }, []);

  const { matrix, cellSymbols } = useMemo(() => {
    // Build daily returns per symbol
    const bySym: Record<string, { date: string; close: number }[]> = {};
    for (const r of rows) {
      if (!symbols.includes(r.symbol)) continue;
      (bySym[r.symbol] ||= []).push({ date: r.date, close: r.close });
    }
    // Determine common dates (intersection)
    const dateSets = Object.values(bySym).map(arr => new Set(arr.map(a => a.date)));
    if (dateSets.length === 0) return { matrix: [] as number[][], cellSymbols: [] as string[] };
    let common = [...dateSets[0]];
    for (let i = 1; i < dateSets.length; i++) common = common.filter(d => dateSets[i].has(d));
    common.sort();
    if (common.length < 5) return { matrix: [], cellSymbols: [] };

    const returnsBySym: Record<string, number[]> = {};
    const cellSyms: string[] = [];
    for (const s of symbols) {
      const arr = bySym[s];
      if (!arr || arr.length < 5) continue;
      const map: Record<string, number> = {};
      for (const a of arr) map[a.date] = a.close;
      const closes = common.map(d => map[d]).filter((v): v is number => Number.isFinite(v));
      if (closes.length < 5) continue;
      const rets: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
      returnsBySym[s] = rets;
      cellSyms.push(s);
    }

    const m = cellSyms.map(s1 => cellSyms.map(s2 => pearson(returnsBySym[s1], returnsBySym[s2])));
    return { matrix: m, cellSymbols: cellSyms };
  }, [rows, symbols]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-4 h-4 text-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Correlation Heatmap</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Pairwise Pearson correlation of daily returns. <span className="text-green-600">Green</span> = move together,{' '}
        <span className="text-red-600">Red</span> = diversifying.
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading historical prices…</p>
      ) : cellSymbols.length < 2 ? (
        <p className="text-xs text-muted-foreground">
          Not enough historical data. Run “Backfill FY26-27 prices” on the Reports page first.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[10px] font-mono border-separate border-spacing-0.5">
            <thead>
              <tr>
                <th className="p-1"></th>
                {cellSymbols.map(s => (
                  <th key={s} className="p-1 text-muted-foreground font-medium [writing-mode:vertical-rl] rotate-180 h-20 align-bottom">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cellSymbols.map((s1, i) => (
                <tr key={s1}>
                  <td className="pr-2 text-right text-muted-foreground font-medium whitespace-nowrap">{s1}</td>
                  {cellSymbols.map((s2, j) => {
                    const v = matrix[i][j];
                    return (
                      <td
                        key={s2}
                        title={`${s1} vs ${s2}: ${Number.isFinite(v) ? v.toFixed(2) : '—'}`}
                        className="w-9 h-9 text-center border border-border/50 rounded-sm"
                        style={{ backgroundColor: colorFor(v), color: Math.abs(v) > 0.6 ? '#fff' : 'hsl(var(--foreground))' }}
                      >
                        {Number.isFinite(v) ? v.toFixed(2) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
