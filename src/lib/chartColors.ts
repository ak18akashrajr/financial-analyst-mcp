/**
 * Chart series colours as CSS-variable references (tokens live in src/index.css), so charts follow
 * the light/dark theme and agree with the gain/loss colours used in text and badges elsewhere.
 * SVG presentation attributes (stroke / fill / stopColor) resolve var(), so these work directly in
 * recharts props.
 */
export const CHART_COLORS = {
  gain: 'hsl(var(--gain))',
  loss: 'hsl(var(--loss))',
  blue: 'hsl(var(--chart-blue))',
  amber: 'hsl(var(--chart-amber))',
  sky: 'hsl(var(--chart-sky))',
  slate: 'hsl(var(--chart-slate))',
  muted: 'hsl(var(--muted-foreground))',
} as const;
