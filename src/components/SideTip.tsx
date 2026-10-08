import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SideTipProps {
  /** Tooltip text; when empty/undefined the child renders untouched. */
  label?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

/**
 * Themed, instant-ish tooltip for icon-only controls (collapsed sidebar, profile button). Replaces
 * the native `title` attribute, which waits ~1s, looks different on every OS and ignores the app
 * theme. The child must be a single element that accepts a ref (a button or router link). Needs a
 * surrounding TooltipProvider.
 */
export function SideTip({ label, side = 'right', children }: SideTipProps) {
  if (!label) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="px-2 py-1 text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
