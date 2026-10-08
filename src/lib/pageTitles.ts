/** Full, human page names for the browser tab (the nav labels are abbreviated: "Rolling", "Deploy", "AI"). */
export const PAGE_TITLES: Record<string, string> = {
  '/login': 'Sign in',
  '/select-profile': "Who's watching?",
  '/overview': 'Overview',
  '/taxes': 'Tax Report',
  '/charts': 'Charts',
  '/projections': 'Projections',
  '/deployment-plan': 'Deployment Plan',
  '/ai': 'Portfolio AI',
  '/goal-track': 'Goals',
  '/updates': 'Updates',
  '/rolling-returns': 'Rolling Returns',
  '/reports': 'Reports',
  '/dollar-adjusted-returns': 'Dollar-Adjusted Returns',
  '/benchmark': 'Benchmark',
  '/risk-metrics': 'Risk Metrics',
  '/forecast': 'Forecast',
  '/dev-zone': 'Dev Zone',
  '/family-members': 'Family',
};

/** Tab title used where no page-specific name applies (landing page, 404): index.html's own <title>. */
export const DEFAULT_TITLE = "Akash's Real Time Portfolio";

const BRAND = 'Blackcrest';

export function titleForPath(pathname: string): string {
  const page = PAGE_TITLES[pathname.replace(/\/+$/, '') || '/'];
  return page ? `${page} · ${BRAND}` : DEFAULT_TITLE;
}
