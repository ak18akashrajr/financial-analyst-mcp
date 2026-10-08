import { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Headline message shown in the box. */
  text: string;
  /** Optional supporting line under the headline (what to do / why it's empty). Full-size only. */
  description?: string;
  /** Icon shown in the badge above the text. Defaults to an inbox on full-size states. */
  icon?: ReactNode;
  /** Optional call to action (a link or button) rendered under the text. Full-size only. */
  action?: ReactNode;
  /** Smaller padding/text for use inside dense lists or small card areas. */
  compact?: boolean;
  className?: string;
}

/** Dashed-border placeholder for a section, table or list with nothing to show. */
export function EmptyState({ text, description, icon, action, compact, className }: EmptyStateProps) {
  if (compact) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground',
          className,
        )}
      >
        {icon && <div className="mb-1.5 flex justify-center text-muted-foreground">{icon}</div>}
        {text}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center animate-in fade-in duration-300',
        className,
      )}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <p className="text-sm font-medium text-foreground">{text}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
