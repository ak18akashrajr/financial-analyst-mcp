import { Card } from '@/components/ui/card';
import { ACCEPTED_TRADE_OFFS, TRADE_OFF_AREAS, type AcceptedTradeOff } from '@/lib/acceptedTradeOffs';

const Field = ({ label, children }: { label: string; children: string }) => (
  <div>
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
    <p className="text-xs text-foreground/90 leading-relaxed">{children}</p>
  </div>
);

function Entry({ t }: { t: AcceptedTradeOff }) {
  return (
    <Card className="rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h4 className="text-sm font-semibold text-foreground">{t.title}</h4>
        <span className="flex items-center gap-2 whitespace-nowrap">
          {t.resolvedOn && (
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
              Resolved {t.resolvedOn}
            </span>
          )}
          <span className="text-[10px] font-mono text-muted-foreground">accepted {t.acceptedOn}</span>
        </span>
      </div>
      <Field label="The trade-off">{t.tradeOff}</Field>
      <Field label="Why it was accepted">{t.whyAccepted}</Field>
      <Field label="What you will see">{t.impact}</Field>
      <Field label="Revisit when">{t.revisitWhen}</Field>
      <p className="text-[10px] font-mono text-muted-foreground break-words">{t.source}</p>
    </Card>
  );
}

/** Dev Zone tab: the register of design trade-offs the project has knowingly accepted. */
export function TradeOffsTab() {
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Known limits that were weighed and deliberately accepted — so they are not mistaken for bugs, and so the
        reasoning is not lost. Currently covers the net-worth movement audit (Charts → Seasonality and Reports →
        What Moved Your Net Worth). {ACCEPTED_TRADE_OFFS.length} entries.
      </p>
      {TRADE_OFF_AREAS.map((area) => {
        const entries = ACCEPTED_TRADE_OFFS.filter((t) => t.area === area);
        if (entries.length === 0) return null;
        return (
          <section key={area} className="space-y-3" aria-label={area}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              {area} <span className="text-muted-foreground font-medium">· {entries.length}</span>
            </h3>
            {entries.map((t) => <Entry key={t.id} t={t} />)}
          </section>
        );
      })}
    </div>
  );
}
