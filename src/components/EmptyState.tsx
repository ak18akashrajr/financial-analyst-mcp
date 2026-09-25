import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Message shown in the box. */
  text: string;
  /** Optional icon rendered above the text. */
  icon?: ReactNode;
  /** Smaller padding/text for use inside dense lists or small card areas. */
  compact?: boolean;
  className?: string;
}

/** Dashed-border placeholder for a section, table or list with nothing to show. */
export function EmptyState({ text, icon, compact, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-border text-center text-muted-foreground',
        compact ? 'px-3 py-4 text-xs' : 'px-4 py-10 text-sm',
        className,
      )}
    >
      {icon && <div className={cn('flex justify-center text-muted-foreground', compact ? 'mb-1.5' : 'mb-2')}>{icon}</div>}
      {text}
    </div>
  );
}
