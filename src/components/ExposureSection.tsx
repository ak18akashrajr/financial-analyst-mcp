import type { ExposureBreakdown } from '@/types/portfolio';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { Globe } from 'lucide-react';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

// Vivid bento palette inspired by the reference: greens, blues, ambers, violets, corals.
const BENTO_PALETTE = [
  { bg: 'bg-[#22c55e]', text: 'text-emerald-950' },
  { bg: 'bg-[#3b82f6]', text: 'text-blue-50' },
  { bg: 'bg-[#f59e0b]', text: 'text-amber-950' },
  { bg: 'bg-[#a78bfa]', text: 'text-violet-950' },
  { bg: 'bg-[#fb7185]', text: 'text-rose-950' },
  { bg: 'bg-[#14b8a6]', text: 'text-teal-950' },
  { bg: 'bg-[#f472b6]', text: 'text-pink-950' },
  { bg: 'bg-[#facc15]', text: 'text-yellow-950' },
];

// Flexible bento span recipes keyed by item count, indexed by sorted rank.
// Designed on a 6-column grid so tiles snap into clean mosaic shapes.
const BENTO_RECIPES: Record<number, string[]> = {
  1: ['col-span-6 row-span-2'],
  2: ['col-span-4 row-span-2', 'col-span-2 row-span-2'],
  3: ['col-span-4 row-span-2', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  4: ['col-span-3 row-span-2', 'col-span-3 row-span-1', 'col-span-2 row-span-1', 'col-span-1 row-span-1'],
  5: ['col-span-3 row-span-2', 'col-span-3 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  6: ['col-span-3 row-span-2', 'col-span-3 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-3 row-span-1', 'col-span-3 row-span-1'],
  7: ['col-span-3 row-span-2', 'col-span-3 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-3 row-span-1', 'col-span-3 row-span-1'],
  8: ['col-span-3 row-span-2', 'col-span-3 row-span-2', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
};

function getSpans(count: number): string[] {
  const capped = Math.min(count, 8);
  return BENTO_RECIPES[capped] || BENTO_RECIPES[8];
}

interface BentoProps {
  items: ExposureBreakdown[];
  mask: (v: string) => string;
  iconFor: (label: string) => React.ComponentType<{ className?: string }>;
  emptyMessage: string;
}

function BentoGrid({ items, mask, iconFor, emptyMessage }: BentoProps) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyMessage}</p>;
  }
  const sorted = [...items].sort((a, b) => b.percent - a.percent).slice(0, 8);
  const spans = getSpans(sorted.length);

  return (
    <div className="grid grid-cols-6 auto-rows-[78px] gap-3">
      {sorted.map((item, i) => {
        const color = BENTO_PALETTE[i % BENTO_PALETTE.length];
        const span = spans[i];
        const Icon = iconFor(item.label);
        const isLarge = span.includes('row-span-2');
        return (
          <div
            key={item.label}
            className={`${color.bg} ${color.text} ${span} rounded-2xl p-3.5 flex flex-col justify-between relative overflow-hidden transition-transform hover:scale-[1.01]`}
          >
            <div className="flex items-start justify-between gap-2">
              <Icon className={`${isLarge ? 'w-5 h-5' : 'w-4 h-4'} opacity-80 shrink-0`} />
              <span className="text-[10px] font-mono opacity-80 text-right leading-tight">
                {mask(fmtRaw(item.value))}
              </span>
            </div>
            <div>
              <p className={`${isLarge ? 'text-4xl' : 'text-2xl'} font-bold leading-none tracking-tight`}>
                {item.percent.toFixed(0)}%
              </p>
              <p className={`${isLarge ? 'text-sm mt-1.5' : 'text-[11px] mt-1'} font-semibold opacity-90 truncate`}>
                {item.label}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  geography: ExposureBreakdown[];
  category: ExposureBreakdown[];
}

export function ExposureSection({ geography, category }: Props) {
  const { mask } = usePrivacy();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="rounded-2xl border border-border bg-card p-4 lg:col-span-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Geography Exposure</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Bento</span>
        </div>
        <BentoGrid
          items={geography}
          mask={mask}
          iconFor={() => Globe}
          emptyMessage="No data — tag your holdings with geography."
        />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 lg:col-span-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Category Exposure</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Bento</span>
        </div>
        <BentoGrid
          items={category}
          mask={mask}
          iconFor={getCategoryIcon}
          emptyMessage="No data — tag your holdings with a category."
        />
      </div>
    </div>
  );
}
