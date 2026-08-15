import { useMemo } from 'react';
import { ResponsiveContainer, Treemap } from 'recharts';
import type { ExposureBreakdown } from '@/types/portfolio';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { Globe } from 'lucide-react';

function fmtRaw(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

// Same vivid palette as the previous bento layout: greens, blues, ambers, violets, corals.
const EXPOSURE_PALETTE = [
  { bg: 'bg-[#22c55e]', text: 'text-emerald-950' },
  { bg: 'bg-[#3b82f6]', text: 'text-blue-50' },
  { bg: 'bg-[#f59e0b]', text: 'text-amber-950' },
  { bg: 'bg-[#a78bfa]', text: 'text-violet-950' },
  { bg: 'bg-[#fb7185]', text: 'text-rose-950' },
  { bg: 'bg-[#14b8a6]', text: 'text-teal-950' },
  { bg: 'bg-[#f472b6]', text: 'text-pink-950' },
  { bg: 'bg-[#facc15]', text: 'text-yellow-950' },
];

const MAX_TILES = 8;
// Inset (px) applied inside each treemap cell so tiles read as separated blocks, not a solid mosaic.
const TILE_INSET = 4;
// Cells smaller than this (in px, on either axis) switch to a compact layout to avoid overflow.
const COMPACT_WIDTH = 90;
const COMPACT_HEIGHT = 64;

interface TreemapDatum {
  name: string;
  value: number;
  label: string;
  percent: number;
  displayValue: string;
  colorIndex: number;
  isPrimary: boolean;
  Icon: React.ComponentType<{ className?: string }>;
}

// Recharts clones this element per node, spreading the node's data (plus computed
// x/y/width/height for its cell) onto it as props.
function ExposureTile(props: Partial<TreemapDatum> & { x?: number; y?: number; width?: number; height?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, label, percent, displayValue, colorIndex = 0, isPrimary, Icon } = props;
  if (width <= 0 || height <= 0 || !label || !Icon) return null;

  const color = EXPOSURE_PALETTE[colorIndex % EXPOSURE_PALETTE.length];
  const isCompact = width < COMPACT_WIDTH || height < COMPACT_HEIGHT;
  const percentClass = isCompact ? 'text-lg' : isPrimary ? 'text-4xl' : 'text-2xl';
  const labelClass = isCompact ? 'text-[10px] mt-0.5' : isPrimary ? 'text-sm mt-1.5' : 'text-[11px] mt-1';
  const iconClass = isCompact ? 'w-3.5 h-3.5' : isPrimary ? 'w-5 h-5' : 'w-4 h-4';

  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <div style={{ width: '100%', height: '100%', padding: TILE_INSET }}>
        <div
          className={`${color.bg} ${color.text} h-full w-full rounded-2xl p-3.5 flex flex-col justify-between overflow-hidden transition-transform hover:scale-[1.02]`}
        >
          <div className="flex items-start justify-between gap-2">
            <Icon className={`${iconClass} opacity-80 shrink-0`} />
            {!isCompact && (
              <span className="text-[10px] font-mono opacity-80 text-right leading-tight truncate">
                {displayValue}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className={`${percentClass} font-bold leading-none tracking-tight`}>{percent?.toFixed(0)}%</p>
            <p className={`${labelClass} font-semibold opacity-90 truncate`}>{label}</p>
          </div>
        </div>
      </div>
    </foreignObject>
  );
}

interface ExposureTreemapProps {
  items: ExposureBreakdown[];
  mask: (v: string) => string;
  iconFor: (label: string) => React.ComponentType<{ className?: string }>;
  emptyMessage: string;
}

function ExposureTreemap({ items, mask, iconFor, emptyMessage }: ExposureTreemapProps) {
  const data = useMemo<TreemapDatum[]>(() => {
    const sorted = [...items].sort((a, b) => b.percent - a.percent).slice(0, MAX_TILES);
    return sorted.map((item, i) => ({
      name: item.label,
      value: item.value,
      label: item.label,
      percent: item.percent,
      displayValue: mask(fmtRaw(item.value)),
      colorIndex: i,
      isPrimary: i === 0,
      Icon: iconFor(item.label),
    }));
  }, [items, mask, iconFor]);

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <Treemap
        data={data}
        dataKey="value"
        aspectRatio={4 / 3}
        stroke="transparent"
        isAnimationActive={false}
        content={<ExposureTile />}
      />
    </ResponsiveContainer>
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
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Treemap</span>
        </div>
        <ExposureTreemap
          items={geography}
          mask={mask}
          iconFor={() => Globe}
          emptyMessage="No data — tag your holdings with geography."
        />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 lg:col-span-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Category Exposure</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Treemap</span>
        </div>
        <ExposureTreemap
          items={category}
          mask={mask}
          iconFor={getCategoryIcon}
          emptyMessage="No data — tag your holdings with a category."
        />
      </div>
    </div>
  );
}
