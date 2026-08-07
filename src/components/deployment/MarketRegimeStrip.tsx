import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Pencil, TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { InfoHint } from '@/components/InfoHint';


const INDICATOR = 'NIFTY_CAPE';
const LONG_TERM_MEDIAN = 24; // seed — user can override

interface Props {
  onCapeChange?: (cape: number | null, median: number) => void;
}

function zone(cape: number): { label: string; color: string; bg: string } {
  if (cape < 20) return { label: 'Cheap', color: 'text-emerald-600', bg: 'bg-emerald-500/10 border-emerald-500/30' };
  if (cape < 25) return { label: 'Fair', color: 'text-amber-600', bg: 'bg-amber-500/10 border-amber-500/30' };
  if (cape < 30) return { label: 'Expensive', color: 'text-orange-600', bg: 'bg-orange-500/10 border-orange-500/30' };
  return { label: 'Bubble', color: 'text-red-600', bg: 'bg-red-500/10 border-red-500/30' };
}

export function MarketRegimeStrip({ onCapeChange }: Props) {
  const [cape, setCape] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('market_indicators')
        .select('value, as_of')
        .eq('indicator', INDICATOR)
        .order('as_of', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setCape(Number(data.value));
        setAsOf(data.as_of);
        onCapeChange?.(Number(data.value), LONG_TERM_MEDIAN);
      } else {
        onCapeChange?.(null, LONG_TERM_MEDIAN);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const v = parseFloat(draft);
    if (isNaN(v) || v <= 0 || v > 100) { toast.error('Enter a valid CAPE (0–100)'); return; }
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from('market_indicators')
      .upsert({ indicator: INDICATOR, value: v, as_of: today, source: 'manual' }, { onConflict: 'indicator,as_of' });
    if (error) { toast.error('Failed to save'); return; }
    setCape(v);
    setAsOf(today);
    setEditing(false);
    onCapeChange?.(v, LONG_TERM_MEDIAN);
    toast.success('NIFTY CAPE updated');
  };

  const z = cape != null ? zone(cape) : null;
  const delta = cape != null ? cape - LONG_TERM_MEDIAN : 0;
  const DeltaIcon = delta > 0.5 ? TrendingUp : delta < -0.5 ? TrendingDown : Minus;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">Market Regime · NIFTY 50 Shiller PE (CAPE)</p>
            <p className="text-[11px] text-muted-foreground">Cyclically-adjusted PE using 10Y real earnings — smooths out earnings cycles.</p>
          </div>
        </div>
        {!editing && (
          <button
            onClick={() => { setDraft(cape?.toString() ?? ''); setEditing(true); }}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
          >
            <Pencil className="w-3 h-3" /> Update
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            step="0.1"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="e.g. 24.5"
            autoFocus
            className="w-32 px-2 py-1.5 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button onClick={save} className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90">Save</button>
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground">Cancel</button>
          <span className="text-[11px] text-muted-foreground">
            Source: <a href="https://www.niftyindices.com/reports/historical-data" target="_blank" rel="noreferrer" className="underline">niftyindices.com</a> monthly EPS or trendlyne.
          </span>
        </div>
      ) : cape != null && z ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-muted/40 rounded-md p-3">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider inline-flex items-center gap-1">
              Current CAPE
              <InfoHint title="Shiller PE (CAPE)" side="bottom" formula="index price ÷ 10-year average inflation-adjusted EPS" caveat="Entered manually — refresh it periodically from niftyindices.com or Trendlyne.">
                Cyclically-adjusted PE. Using a decade of real earnings instead of one year removes the distortion of boom or bust profits, which makes it a far more stable gauge of whether the whole market is expensive.
              </InfoHint>
            </p>
            <p className="text-2xl font-bold text-foreground font-mono">{cape.toFixed(1)}</p>
            <p className="text-[10px] text-muted-foreground">as of {asOf}</p>
          </div>
          <div className={`rounded-md p-3 border ${z.bg}`}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
              Regime
              <InfoHint title="Regime zones" side="bottom" formula="< 20 Cheap · 20–25 Fair · 25–30 Expensive · > 30 Bubble">
                Buckets the current CAPE into a market stance. This regime feeds the ticker signal below with a 16% weight, so market context tempers every individual stock verdict.
              </InfoHint>
            </p>
            <p className={`text-2xl font-bold ${z.color}`}>{z.label}</p>
            <p className="text-[10px] text-muted-foreground">
              {z.label === 'Cheap' && 'Deploy aggressively'}
              {z.label === 'Fair' && 'Neutral positioning'}
              {z.label === 'Expensive' && 'Trim / build cash'}
              {z.label === 'Bubble' && 'Defensive stance'}
            </p>
          </div>
          <div className="bg-muted/40 rounded-md p-3">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider inline-flex items-center gap-1">
              Long-term Median
              <InfoHint title="Long-term median" side="bottom">The roughly 20-year median NIFTY CAPE ({LONG_TERM_MEDIAN}), used as the neutral reference line. Anything above it is historically expensive territory.</InfoHint>
            </p>
            <p className="text-2xl font-bold text-foreground font-mono">{LONG_TERM_MEDIAN}</p>
            <p className="text-[10px] text-muted-foreground">~20Y avg</p>
          </div>
          <div className="bg-muted/40 rounded-md p-3">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider inline-flex items-center gap-1">
              Deviation
              <InfoHint title="Deviation vs median" side="bottom" formula="current CAPE − long-term median">How far the market is stretched from its historical norm. Large positive deviations have historically preceded weaker 5–10 year forward returns; negative deviations, stronger ones.</InfoHint>
            </p>
            <p className={`text-2xl font-bold font-mono flex items-center gap-1 ${delta > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
              <DeltaIcon className="w-4 h-4" />
              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
            </p>
            <p className="text-[10px] text-muted-foreground">vs median</p>
          </div>

        </div>
      ) : (
        <div className="text-xs text-muted-foreground py-2">
          No CAPE entered yet. Click <span className="font-semibold text-foreground">Update</span> to add the current NIFTY 50 Shiller PE — this overlays a market-regime factor on every ticker signal.
        </div>
      )}
    </div>
  );
}
