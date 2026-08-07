import { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info } from 'lucide-react';

interface Props {
  title: string;
  children: ReactNode;
  trigger: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}

/**
 * Click-to-audit wrapper. The `trigger` is rendered as-is (already styled by parent)
 * and made clickable. The popover exposes formula + inputs + per-row math so the
 * user can verify every number instead of trusting the summary.
 */
export function AuditPopover({ title, children, trigger, align = 'start', className }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`text-left w-full group cursor-help ${className ?? ''}`}
          aria-label={`Show source calculation for ${title}`}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[420px] max-h-[520px] overflow-auto p-0">
        <div className="sticky top-0 bg-card border-b border-border px-4 py-2.5 flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold text-foreground">Source · {title}</p>
        </div>
        <div className="px-4 py-3 text-xs text-foreground space-y-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

export const Formula = ({ children }: { children: ReactNode }) => (
  <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-2 font-mono text-[11px] text-foreground leading-relaxed">
    {children}
  </div>
);

export const AuditSection = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
    {children}
  </div>
);

export const AuditTable = ({
  headers,
  rows,
  footer,
}: {
  headers: string[];
  rows: Array<Array<string | number | ReactNode>>;
  footer?: Array<string | number | ReactNode>;
}) => (
  <div className="rounded-md border border-border overflow-hidden">
    <table className="w-full text-[11px] font-mono">
      <thead className="bg-secondary/60">
        <tr>
          {headers.map((h, i) => (
            <th key={i} className={`px-2 py-1.5 font-medium text-muted-foreground ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-t border-border/60">
            {r.map((c, ci) => (
              <td key={ci} className={`px-2 py-1 ${ci === 0 ? 'text-left text-foreground' : 'text-right text-foreground/90'}`}>{c}</td>
            ))}
          </tr>
        ))}
        {footer && (
          <tr className="border-t border-border bg-secondary/40 font-semibold">
            {footer.map((c, ci) => (
              <td key={ci} className={`px-2 py-1.5 ${ci === 0 ? 'text-left' : 'text-right'}`}>{c}</td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

export const SourceBadge = ({ source }: { source: 'live' | 'historical' | 'cost-fallback' | 'none' | 'snapshot' | 'formula' }) => {
  const map: Record<string, string> = {
    live: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    historical: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
    'cost-fallback': 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    none: 'bg-red-500/10 text-red-600 border-red-500/30',
    snapshot: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
    formula: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
  };
  const label: Record<string, string> = {
    live: 'Live price',
    historical: 'Historical close',
    'cost-fallback': 'Cost basis (no price)',
    none: 'No data',
    snapshot: 'Net-worth snapshot',
    formula: 'Formula',
  };
  return <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${map[source]}`}>{label[source]}</span>;
};
