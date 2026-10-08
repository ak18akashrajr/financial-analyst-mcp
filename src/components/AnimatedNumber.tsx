import { useEffect, useRef, useState } from 'react';
import { useCountUp } from '@/hooks/useCountUp';
import { cn } from '@/lib/utils';

interface AnimatedNumberProps {
  value: number;
  /** Turns the (possibly fractional, mid-animation) number into display text. */
  format: (n: number) => string;
  /** Briefly tint the number green/red when it later moves up/down (e.g. after a live price refresh). */
  flash?: boolean;
  className?: string;
}

const FLASH_MS = 1200;

/** A number that counts up on first show, glides on change, and optionally flashes its direction. */
export function AnimatedNumber({ value, format, flash = false, className }: AnimatedNumberProps) {
  const display = useCountUp(value);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);
  const previous = useRef(value);

  useEffect(() => {
    if (!flash || previous.current === value) {
      previous.current = value;
      return;
    }
    setDirection(value > previous.current ? 'up' : 'down');
    previous.current = value;
    const t = setTimeout(() => setDirection(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [value, flash]);

  return (
    <span
      className={cn(
        'tabular-nums transition-colors duration-700',
        direction === 'up' && 'text-gain',
        direction === 'down' && 'text-loss',
        className,
      )}
    >
      {format(display)}
    </span>
  );
}
