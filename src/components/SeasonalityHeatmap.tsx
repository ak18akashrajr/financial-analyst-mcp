import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CalendarDays } from 'lucide-react';
import { usePrivacy } from '@/contexts/PrivacyContext';

type Snap = { recorded_at: string; net_worth: number };

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

function fyFor(d: Date) {
  // Indian FY starts April
  const y = d.getFullYear();
  return d.getMonth() >= 3 ? y : y - 1;
}

function fyMonthIdx(d: Date) {
  // 0=Apr ... 11=Mar
  return (d.getMonth() - 3 + 12) % 12;
}

function colorFor(pct: number): string {
  if (!Number.isFinite(pct)) return 'hsl(var(--muted) / 0.3)';
  const t = Math.max(-10, Math.min(10, pct)) / 10;
  if (t >= 0) return `hsla(152, 60%, 42%, ${0.15 + t * 0.7})`;
  return `hsla(0, 72%, 55%, ${0.15 + -t * 0.7})`;
}

export function SeasonalityHeatmap() {
  const { hidden } = usePrivacy();
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('net_worth_history')
        .select('recorded_at,net_worth')
        .order('recorded_at', { ascending: true });
      setSnaps((data as any[] | null)?.map(r => ({ recorded_at: r.recorded_at, net_worth: Number(r.net_worth) })) ?? []);
      setLoading(false);
    })();
  }, []);

  const { fys, grid } = useMemo(() => {
    // Last snapshot per (FY, month) → take last for end-of-month value
    type Key = string;
    const lastInMonth: Record<Key, { d: Date; v: number }> = {};
    for (const s of snaps) {
      const d = new Date(s.recorded_at);
      const key = `${fyFor(d)}-${fyMonthIdx(d)}`;
      const cur = lastInMonth[key];
      if (!cur || d > cur.d) lastInMonth[key] = { d, v: s.net_worth };
    }
    const allFY = Array.from(new Set(snaps.map(s => fyFor(new Date(s.recorded_at))))).sort();
    const g: (number | null)[][] = allFY.map(fy => {
      const row: (number | null)[] = [];
      for (let m = 0; m < 12; m++) {
        const cur = lastInMonth[`${fy}-${m}`]?.v ?? null;
        // previous month value (could be prior FY's Mar when m=0)
        const prevKey = m === 0 ? `${fy - 1}-11` : `${fy}-${m - 1}`;
        const prev = lastInMonth[prevKey]?.v ?? null;
        if (cur == null || prev == null || prev === 0) row.push(null);
        else row.push(((cur - prev) / prev) * 100);
      }
      return row;
    });
    return { fys: allFY, grid: g };
  }, [snaps]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Seasonality · Monthly Net-Worth Returns</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Month-over-month % change in net worth. Indian FY (Apr → Mar). Cells empty when no snapshot exists.
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading snapshots…</p>
      ) : fys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No net-worth history yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[10px] font-mono border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="p-1 text-muted-foreground font-medium">FY</th>
                {MONTHS.map(m => (
                  <th key={m} className="p-1 text-muted-foreground font-medium w-12">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fys.map((fy, i) => (
                <tr key={fy}>
                  <td className="pr-2 text-muted-foreground font-medium whitespace-nowrap">FY{String(fy).slice(-2)}-{String(fy + 1).slice(-2)}</td>
                  {grid[i].map((v, j) => (
                    <td
                      key={j}
                      title={v == null ? 'No data' : `${MONTHS[j]}: ${v.toFixed(2)}%`}
                      className="w-12 h-10 text-center border border-border/50 rounded-sm"
                      style={{ backgroundColor: colorFor(v ?? NaN), color: v != null && Math.abs(v) > 5 ? '#fff' : 'hsl(var(--foreground))' }}
                    >
                      {hidden ? '••' : v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
