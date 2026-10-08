import { Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrandedSplashProps {
  /** Fill the viewport (route/auth gates) vs. sit inside a parent that already has height. */
  fullScreen?: boolean;
  className?: string;
}

/**
 * The one "waiting on auth / a lazy route chunk" screen — the brand mark over a thin indeterminate
 * bar, matching the look of LoginLoadingScreen. Replaces the bare "Loading..." line that
 * App/ProtectedRoute/Landing/Login/WhosWatching each rendered separately.
 *
 * It fades in after a short delay (fill-mode-backwards keeps it invisible until then) so an auth
 * check that resolves in a few ms doesn't flash a splash for a single frame.
 */
export function BrandedSplash({ fullScreen = true, className }: BrandedSplashProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center bg-background px-4',
        fullScreen && 'min-h-screen',
        className,
      )}
    >
      <span className="sr-only">Loading…</span>
      <div className="flex w-full max-w-[11rem] flex-col items-center gap-4 animate-in fade-in duration-300 delay-150 fill-mode-backwards">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground text-background">
          <Landmark className="h-6 w-6" />
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full w-2/5 rounded-full bg-primary animate-indeterminate" />
        </div>
      </div>
    </div>
  );
}
