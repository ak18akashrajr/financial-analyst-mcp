import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface PageSkeletonProps {
  /** Placeholder back-arrow + title/subtitle row, for pages that gate their whole body (including header) on `loading`. */
  showHeader?: boolean;
  /** Number of placeholder stat cards in the summary row. */
  statCount?: number;
  /** Placeholder block for the page's main chart/table. */
  withChart?: boolean;
  className?: string;
}

/**
 * Generic loading placeholder for a data page — a plausible silhouette (header,
 * stat-card row, chart block) rather than a per-page pixel match, so a page doesn't
 * flash from blank to fully-populated once its data arrives.
 */
export function PageSkeleton({ showHeader = false, statCount = 4, withChart = true, className }: PageSkeletonProps) {
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
      {withChart && (
        <Card className="p-4">
          <Skeleton className="h-64 w-full" />
        </Card>
      )}
    </div>
  );
}
