import { ReactNode, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface InfoHintProps {
  /** Short heading shown in bold at the top of the hint. */
  title: string;
  /** Plain-language explanation of what this element does. */
  children: ReactNode;
  /** Optional formula / method line rendered in mono type. */
  formula?: string;
  /** Optional caveat, shown in amber. */
  caveat?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/**
 * Small "?" affordance that explains the purpose of a metric, tab or control.
 * Hover on desktop, tap on touch devices (controlled open state).
 */
export function InfoHint({ title, children, formula, caveat, side = 'top', className }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label={`What is ${title}?`}
          className={`inline-flex items-center justify-center text-muted-foreground/70 hover:text-primary transition-colors align-middle ${className ?? ''}`}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[300px] p-3 space-y-1.5">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{children}</p>
        {formula && (
          <p className="text-[10px] font-mono leading-relaxed text-foreground/80 bg-muted/60 rounded px-1.5 py-1">
            {formula}
          </p>
        )}
        {caveat && <p className="text-[10px] leading-relaxed text-amber-500">⚠ {caveat}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Label + inline hint, for stat card headers. */
export function LabelWithHint({
  label,
  className,
  ...hint
}: InfoHintProps & { label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      {label}
      <InfoHint {...hint} />
    </span>
  );
}
