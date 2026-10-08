import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHART_COLORS } from '@/lib/chartColors';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');

const CHART_FILES = [
  'src/components/charts/ChartRangeBadge.tsx',
  'src/components/DebtChart.tsx',
  'src/components/NetWorthChart.tsx',
  'src/components/PerformanceAttribution.tsx',
  'src/components/PortfolioCharts.tsx',
  'src/components/projections/FireModule.tsx',
  'src/components/projections/GoalProjection.tsx',
  'src/components/projections/StressReplay.tsx',
  'src/pages/Benchmark.tsx',
  'src/pages/Forecast.tsx',
  'src/pages/Projections.tsx',
  'src/pages/Reports.tsx',
];

describe('chart colour tokens', () => {
  it('every var() referenced by CHART_COLORS is defined for both light and dark themes', () => {
    const css = read('src/index.css');
    const light = css.slice(css.indexOf(':root'), css.indexOf('.dark {'));
    const dark = css.slice(css.indexOf('.dark {'));
    const vars = Object.values(CHART_COLORS).map((v) => /var\((--[\w-]+)\)/.exec(v)![1]);
    for (const name of vars) {
      expect(light, `${name} (light)`).toContain(`${name}:`);
      expect(dark, `${name} (dark)`).toContain(`${name}:`);
    }
  });

  it('chart files use the shared tokens instead of hardcoded hsl()/hex literals', () => {
    for (const file of CHART_FILES) {
      // Reports' categorical pie palette (COLORS) is intentionally a fixed set of distinct hues.
      const src = read(file)
        .split('\n')
        .filter((l) => !l.startsWith('const COLORS'))
        .join('\n');
      expect(src, file).not.toMatch(/hsl\(\s*\d|#[0-9a-fA-F]{6}\b/);
    }
  });
});
