import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { generateTaxReport, getHarvestableLots, hasSameDayReentry, TaxReport } from '@/lib/taxCalculator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { Eye, EyeOff, ArrowLeft, TrendingDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Transaction, Category } from '@/types/portfolio';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const TaxesContent = () => {
  const { hidden, toggle, mask } = usePrivacy();
  const fmtV = (n: number) => mask(fmt(n));

  const [report, setReport] = useState<TaxReport | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [txnRes, priceRes, metaRes] = await Promise.all([
        supabase.from('transactions').select('*'),
        supabase.from('current_prices').select('*'),
        supabase.from('symbol_metadata').select('*'),
      ]);

      const txns: Transaction[] = (txnRes.data || []).map(t => ({
        id: t.id, symbol: t.symbol, type: t.type as 'BUY' | 'SELL',
        quantity: Number(t.quantity), price: Number(t.price), date: t.date,
      }));

      const prices: Record<string, number> = {};
      for (const p of priceRes.data || []) prices[p.symbol] = Number(p.price);

      const meta: Record<string, { category?: Category }> = {};
      for (const m of metaRes.data || []) meta[m.symbol] = { category: m.sector as Category };

      setTransactions(txns);
      setReport(generateTaxReport(txns, prices, meta));
      setLoading(false);
    }
    load();
  }, []);

  const harvestableLots = report ? getHarvestableLots(report) : [];
  const totalHarvestableLoss = harvestableLots.reduce((s, l) => s + l.gain, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Generating tax report...</p>
      </div>
    );
  }

  if (!report || report.holdings.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">No holdings to assess.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/overview" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-foreground">Tax Report</h1>
              <p className="text-xs text-muted-foreground">
                Hypothetical tax if all holdings sold today • Indian Tax Law FY 2026–27
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={toggle}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
            >
              {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {hidden ? 'Show' : 'Hide'}
            </button>
          </div>
        </div>

        {/* Tax Summary */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Tax Liability Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total STCG', value: fmtV(report.totalSTCG), color: '' },
              { label: 'Total LTCG', value: fmtV(report.totalLTCG), color: '' },
              { label: 'LTCG Exemption (§112A)', value: fmtV(report.ltcgExemption), color: 'text-green-500' },
              { label: 'STCG Tax', value: fmtV(report.stcgTax), color: 'text-orange-500' },
              { label: 'LTCG Tax', value: fmtV(report.ltcgTax), color: 'text-orange-500' },
              { label: 'Total Tax + 4% Cess', value: fmtV(report.totalTaxWithCess), color: 'text-red-500' },
            ].map(item => (
              <div key={item.label} className="p-3 rounded-md bg-muted/30 border border-border">
                <p className="text-[10px] text-muted-foreground leading-tight">{item.label}</p>
                <p className={`text-sm font-bold mt-1 ${item.color || 'text-foreground'}`}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tax Rules Reference */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Applicable Tax Rates (FY 2026–27)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-md bg-muted/20 border border-border space-y-1">
              <p className="font-semibold text-foreground">Equity / ETF / Index / Mutual Fund</p>
              <p className="text-muted-foreground">STCG (≤12 months): <span className="text-foreground font-medium">20%</span> §111A</p>
              <p className="text-muted-foreground">LTCG (&gt;12 months): <span className="text-foreground font-medium">12.5%</span> §112A</p>
              <p className="text-muted-foreground">LTCG Exempt up to: <span className="text-foreground font-medium">₹1,25,000/yr</span></p>
            </div>
            <div className="p-3 rounded-md bg-muted/20 border border-border space-y-1">
              <p className="font-semibold text-foreground">Gold / Bonds / Real Estate / Others</p>
              <p className="text-muted-foreground">STCG (≤24 months): <span className="text-foreground font-medium">Slab Rate (~30%)</span></p>
              <p className="text-muted-foreground">LTCG (&gt;24 months): <span className="text-foreground font-medium">12.5%</span> §112</p>
              <p className="text-muted-foreground">No LTCG exemption threshold</p>
            </div>
          </div>
        </div>

        {/* Per-Symbol Breakdown */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Holdings Tax Breakdown (FIFO)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 font-medium text-muted-foreground">Symbol</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Category</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Qty</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Principal Allocated</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Current Value</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Gain</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">STCG</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">LTCG</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Est. Tax (pre-exempt.)</th>
                </tr>
              </thead>
              <tbody>
                {report.holdings.map(h => (
                  <tr key={h.symbol} className="border-b border-border hover:bg-muted/20 transition-colors">
                    <td className="p-3 font-semibold text-foreground">{h.symbol}</td>
                    <td className="p-3 text-muted-foreground">{h.category}</td>
                    <td className="p-3 text-right text-foreground">{h.totalQuantity.toFixed(2)}</td>
                    <td className="p-3 text-right text-foreground">{fmtV(h.totalInvested)}</td>
                    <td className="p-3 text-right text-foreground">{fmtV(h.totalCurrentValue)}</td>
                    <td className={`p-3 text-right font-medium ${h.totalGain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {fmtV(h.totalGain)}
                    </td>
                    <td className="p-3 text-right text-orange-500">{fmtV(h.stcgAmount)}</td>
                    <td className="p-3 text-right text-orange-500">{fmtV(h.ltcgAmount)}</td>
                    <td className="p-3 text-right font-medium text-red-500">{fmtV(h.stcgTax + h.ltcgTax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Precise Tax Payable Summary */}
        <div className="rounded-lg border-2 border-red-500/30 bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">💰 Exact Tax Payable — If You Sell Everything Today</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">A. Total Short-Term Capital Gains (STCG)</span>
              <span className="text-foreground font-medium">{fmtV(report.totalSTCG)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">B. Total Long-Term Capital Gains (LTCG)</span>
              <span className="text-foreground font-medium">{fmtV(report.totalLTCG)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">C. LTCG Exemption under §112A (max ₹1,25,000)</span>
              <span className="text-green-500 font-medium">− {fmtV(report.ltcgExemption)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">D. Taxable STCG (A)</span>
              <span className="text-foreground font-medium">{fmtV(report.taxableSTCG)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">E. Taxable LTCG (B − C)</span>
              <span className="text-foreground font-medium">{fmtV(report.taxableLTCG)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">F. STCG Tax (Equity @20% / Others @30%)</span>
              <span className="text-orange-500 font-medium">{fmtV(report.stcgTax)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">G. LTCG Tax @12.5% on taxable LTCG</span>
              <span className="text-orange-500 font-medium">{fmtV(report.ltcgTax)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">H. Total Tax (F + G)</span>
              <span className="text-red-500 font-medium">{fmtV(report.totalTax)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">I. Health & Education Cess @4%</span>
              <span className="text-red-500 font-medium">{fmtV(report.cess)}</span>
            </div>
            <div className="flex justify-between py-2 bg-red-500/10 rounded-md px-3 mt-2">
              <span className="text-foreground font-bold text-sm">J. Total Tax Payable (H + I)</span>
              <span className="text-red-500 font-bold text-sm">{fmtV(report.totalTaxWithCess)}</span>
            </div>

            {/* Post-tax returns */}
            {(() => {
              const totalCurrentValue = report.holdings.reduce((s, h) => s + h.totalCurrentValue, 0);
              const totalInvested = report.holdings.reduce((s, h) => s + h.totalInvested, 0);
              const totalGains = report.totalSTCG + report.totalLTCG;
              const postTaxGains = totalGains - report.totalTaxWithCess;
              const postTaxValue = totalCurrentValue - report.totalTaxWithCess;
              return (
                <>
                  <div className="border-t-2 border-dashed border-border mt-3 pt-3 space-y-2">
                    <div className="flex justify-between py-1.5 border-b border-border">
                      <span className="text-muted-foreground">K. Total Current Value (all holdings)</span>
                      <span className="text-foreground font-medium">{fmtV(totalCurrentValue)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border">
                      <span className="text-muted-foreground">L. Total Principal Allocated</span>
                      <span className="text-foreground font-medium">{fmtV(totalInvested)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border">
                      <span className="text-muted-foreground">M. Total Gains (A + B)</span>
                      <span className={`font-medium ${totalGains >= 0 ? 'text-green-500' : 'text-red-500'}`}>{fmtV(totalGains)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-border">
                      <span className="text-muted-foreground">N. Post-Tax Profit (M − J)</span>
                      <span className={`font-medium ${postTaxGains >= 0 ? 'text-green-500' : 'text-red-500'}`}>{fmtV(postTaxGains)}</span>
                    </div>
                    <div className="flex justify-between py-2 bg-green-500/10 rounded-md px-3 mt-2">
                      <span className="text-foreground font-bold text-sm">Amount You Receive Post Tax (K − J)</span>
                      <span className="text-green-500 font-bold text-sm">{fmtV(postTaxValue)}</span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Note: §87A rebate is NOT available on capital gains (STCG/LTCG) from FY 2025–26 onwards.
            Surcharge may apply based on total income bracket — not included above.
          </p>
        </div>

        {/* Harvestable Losses (Tax-Loss Harvesting) — collapsible toggle, same pattern as FIFO Lot Details */}
        <details className="rounded-lg border border-border bg-card overflow-hidden">
          <summary className="p-4 cursor-pointer list-none hover:bg-muted/20 transition-colors">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-red-500" /> Harvestable Losses
              {harvestableLots.length > 0 && (
                <span className="text-[10px] font-medium text-red-500">
                  ({harvestableLots.length} lot{harvestableLots.length > 1 ? 's' : ''})
                </span>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              Lots currently sitting below cost. Selling one before FY-end realizes the loss, which can offset other
              capital gains this year. India has no formal wash-sale rule, but re-buying the same stock the same day
              is worth flagging — it can look like a transaction with no real change in economic position if
              scrutinized. ⚠ below means this symbol has had a same-day BUY + SELL before.
            </p>
          </summary>
          {harvestableLots.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">No lots are currently sitting at a loss. 🎯</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Symbol</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Buy Date</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Qty</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Buy Price</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">CMP</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Days Held</th>
                    <th className="text-center p-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Harvestable Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {harvestableLots.map((lot, i) => (
                    <tr key={`${lot.symbol}-${lot.buyDate}-${i}`} className="border-b border-border hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-semibold text-foreground">
                        {lot.symbol}
                        {hasSameDayReentry(lot.symbol, transactions) && (
                          <span title="Same-day BUY + SELL activity detected for this symbol before — review the wash-sale-style caveat above.">
                            {' '}⚠
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-foreground">{new Date(lot.buyDate).toLocaleDateString('en-IN')}</td>
                      <td className="p-3 text-right text-foreground">{lot.quantity.toFixed(2)}</td>
                      <td className="p-3 text-right text-foreground">{fmtV(lot.buyPrice)}</td>
                      <td className="p-3 text-right text-foreground">{fmtV(lot.currentPrice)}</td>
                      <td className="p-3 text-right text-foreground">{lot.holdingDays}</td>
                      <td className="p-3 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          lot.isLongTerm ? 'bg-green-500/10 text-green-500' : 'bg-orange-500/10 text-orange-500'
                        }`}>
                          {lot.isLongTerm ? 'LTCG' : 'STCG'}
                        </span>
                      </td>
                      <td className="p-3 text-right font-medium text-red-500">{fmtV(lot.gain)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-red-500/5">
                    <td colSpan={7} className="p-3 text-right font-semibold text-foreground">Total Harvestable Loss</td>
                    <td className="p-3 text-right font-bold text-red-500">{fmtV(totalHarvestableLoss)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </details>

        {/* FIFO Lot Details (expandable per symbol) */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">FIFO Lot Details</h2>
          {report.holdings.map(h => (
            <details key={h.symbol} className="rounded-lg border border-border bg-card overflow-hidden">
              <summary className="p-3 cursor-pointer text-sm font-medium text-foreground hover:bg-muted/20 transition-colors">
                {h.symbol} — {h.lots.length} lot{h.lots.length > 1 ? 's' : ''}
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-t border-b border-border bg-muted/20">
                      <th className="text-left p-2 pl-3 font-medium text-muted-foreground">Buy Date</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Buy Price</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">CMP</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Days Held</th>
                      <th className="text-center p-2 font-medium text-muted-foreground">Type</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Gain</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Tax Rate</th>
                      <th className="text-right p-2 pr-3 font-medium text-muted-foreground">Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.lots.map((lot, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="p-2 pl-3 text-foreground">{new Date(lot.buyDate).toLocaleDateString('en-IN')}</td>
                        <td className="p-2 text-right text-foreground">{lot.quantity.toFixed(2)}</td>
                        <td className="p-2 text-right text-foreground">{fmtV(lot.buyPrice)}</td>
                        <td className="p-2 text-right text-foreground">{fmtV(lot.currentPrice)}</td>
                        <td className="p-2 text-right text-foreground">{lot.holdingDays}</td>
                        <td className="p-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            lot.isLongTerm
                              ? 'bg-green-500/10 text-green-500'
                              : 'bg-orange-500/10 text-orange-500'
                          }`}>
                            {lot.isLongTerm ? 'LTCG' : 'STCG'}
                          </span>
                        </td>
                        <td className={`p-2 text-right font-medium ${lot.gain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {fmtV(lot.gain)}
                        </td>
                        <td className="p-2 text-right text-muted-foreground">{(lot.taxRate * 100).toFixed(1)}%</td>
                        <td className="p-2 pr-3 text-right text-red-500">{fmtV(lot.taxAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            <strong>Disclaimer:</strong> This is a hypothetical estimate assuming all holdings are sold today.
            Actual tax may vary based on your income slab, surcharge applicability, and specific transaction details.
            STCG slab-rate assets use 30% as upper estimate. Consult a qualified CA for filing.
            Tax rules as per Indian Income Tax Act, FY 2026–27 (Budget 2026 — rates unchanged from FY 2025–26).
            Gold/Silver ETFs from Apr 2025 onwards: 12-month holding for LTCG @12.5%.
          </p>
        </div>
      </div>
    </div>
  );
};

const Taxes = () => (
  <PrivacyProvider>
    <TaxesContent />
  </PrivacyProvider>
);

export default Taxes;
