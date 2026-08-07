import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePrivacy } from '@/contexts/PrivacyContext';
import type { DerivedHolding, PortfolioSummary } from '@/types/portfolio';
import { attribution, fmtUsd, holdingsInUsd, latestRate, type FxRate } from '@/lib/fx';
import { ArrowUpRight, DollarSign, TrendingDown, TrendingUp } from 'lucide-react';

interface Props {
  holdings: DerivedHolding[];
  summary: PortfolioSummary;
}

export function DollarReturnsCard({ holdings, summary }: Props) {
  const { mask } = usePrivacy();
  const [rates, setRates] = useState<FxRate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Most recent 3000 daily rates (descending), reversed to ascending for lookups.
      const { data } = await supabase
        .from('fx_rates')
        .select('date, rate, source')
        .eq('pair', 'USDINR')
        .order('date', { ascending: false })
        .limit(3000);
      if (!alive) return;
      setRates(
        (data ?? [])
          .map((r) => ({ date: r.date as string, rate: Number(r.rate), source: (r.source as string) ?? 'unknown' }))
          .reverse()
      );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const spotRow = useMemo(() => latestRate(rates), [rates]);
  const spot = spotRow?.rate ?? 0;

  const view = useMemo(() => {
    if (!spot) return null;
    const rows = holdingsInUsd(holdings, rates, spot);
    const investedUsd = rows.reduce((s, r) => s + r.investedUsd, 0);
    const currentUsd = rows.reduce((s, r) => s + r.currentUsd, 0);
    const attr = attribution(summary.investedValue, summary.currentValue, investedUsd, currentUsd, spot);
    return {
      aumUsd: summary.totalPortfolioValue / spot,
      investedUsd,
      usdReturnPct: attr.totalUsdReturnPct,
      drag: attr.totalUsdReturnPct - summary.totalPnlPercent,
    };
  }, [spot, rates, holdings, summary]);

  const dollars = (n: number) => mask(fmtUsd(n));

  return (
    <Link
      to="/dollar-adjusted-returns"
      className="block rounded-2xl border border-border bg-card p-5 hover:border-foreground/30 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-foreground/5 text-foreground flex items-center justify-center">
            <DollarSign className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground tracking-tight">Dollar-Adjusted Returns</p>
            <p className="text-[11px] text-muted-foreground">Hard-currency view of AUM and alpha</p>
          </div>
        </div>
        <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading FX data…</p>
      ) : !view ? (
        <p className="text-xs text-muted-foreground">
          No USD-INR rates stored yet — open the deep dive to fetch them.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Cell label="USD-Denominated AUM" value={dollars(view.aumUsd)} />
            <Cell label="Capital Deployed (USD)" value={dollars(view.investedUsd)} />
            <Cell
              label="USD Return"
              value={`${view.usdReturnPct >= 0 ? '+' : ''}${view.usdReturnPct.toFixed(2)}%`}
              tone={view.usdReturnPct >= 0 ? 'gain' : 'loss'}
            />
            <Cell
              label="INR Return"
              value={`${summary.totalPnlPercent >= 0 ? '+' : ''}${summary.totalPnlPercent.toFixed(2)}%`}
              tone={summary.totalPnlPercent >= 0 ? 'gain' : 'loss'}
            />
          </div>
          <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border/70 text-[11px] flex-wrap">
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                view.drag >= 0 ? 'text-gain' : 'text-loss'
              }`}
            >
              {view.drag >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              Currency {view.drag >= 0 ? 'tailwind' : 'drag'} {view.drag >= 0 ? '+' : ''}
              {view.drag.toFixed(2)}%
            </span>
            <span className="font-mono text-muted-foreground">
              USDINR {spot.toFixed(4)} · {spotRow?.source} · {spotRow?.date}
            </span>
          </div>
        </>
      )}
    </Link>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</p>
      <p
        className={`mt-1 text-base font-semibold tracking-tight truncate ${
          tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
