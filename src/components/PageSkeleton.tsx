import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface PageSkeletonProps {
  /** Placeholder back-arrow + title/subtitle row, for pages that gate their whole body (including header) on `loading`. */
  showHeader?: boolean;
  /** Number of placeholder stat cards in the summary row. */
  statCount?: number;
  /** Placeholder block for the page's main content. */
  withChart?: boolean;
  /** Shape of that main block: a chart area (default) or a table (header row + body rows). */
  variant?: 'chart' | 'table';
  className?: string;
}

/**
 * Generic loading placeholder for a data page — a plausible silhouette (header,
 * stat-card row, chart block) rather than a per-page pixel match, so a page doesn't
 * flash from blank to fully-populated once its data arrives.
 */
export function PageSkeleton({ showHeader = false, statCount = 4, withChart = true, variant = 'chart', className }: PageSkeletonProps) {
  return (
    <div className={cn('space-y-5', className)} role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {showHeader && (
        <div className="flex items-center gap-3">
          <Skeleton className="w-4 h-4 rounded-full shrink-0" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      )}
      {statCount > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: statCount }).map((_, i) => (
            <Card key={i} className="p-4 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-16" />
            </Card>
          ))}
        </div>
      )}
      {withChart && variant === 'chart' && (
        <Card className="p-4">
          <Skeleton className="h-64 w-full" />
        </Card>
      )}
      {withChart && variant === 'table' && <TableSkeletonCard />}
    </div>
  );
}

function TableSkeletonCard({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="p-4 space-y-3" data-testid="table-skeleton">
      <Skeleton className="h-4 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </Card>
  );
}

interface GridSkeletonProps {
  rows?: number;
  cols?: number;
  /** Accessible loading message (also keeps the original 'Loading …' wording findable). */
  label: string;
  className?: string;
}

/**
 * Loading placeholder for heatmap-style sections (correlation, seasonality): a rows×cols grid of
 * small cells, so the card keeps roughly the footprint it will have once data arrives instead of
 * collapsing to a single line of text and then jumping.
 */
export function GridSkeleton({ rows = 5, cols = 12, label, className }: GridSkeletonProps) {
  return (
    <div className={cn('space-y-1.5', className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-1.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-7 w-10 shrink-0 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Loading placeholder for a small stat-cell grid inside a card (e.g. the FX summary card). */
export function StatGridSkeleton({ cells = 4, label, className }: { cells?: number; label: string; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-3', className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: cells }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}
