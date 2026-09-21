import { SiteFooter } from '@/components/SiteFooter';
import { PrivacyProvider } from '@/contexts/PrivacyContext';
import { Sparkles, Wrench, Zap, Layers, ArrowUpRight } from 'lucide-react';

interface Update {
  date: string;
  version?: string;
  title: string;
  type: 'feature' | 'fix' | 'improvement' | 'foundation';
  items: string[];
}

const UPDATES: Update[] = [
  {
    date: '2026-09-21',
    version: 'v4.1',
    title: "\"Who's Watching\" profile picker",
    type: 'feature',
    items: [
      'Netflix/Notion-style profile picker shown once per session right after signing in — pick a family member (or "All Family") and land straight in their view',
      'Personalized fading loading sequence greets you by name on the way in',
      'A small avatar button in the nav lets you switch profiles anytime, without signing out',
    ],
  },
  {
    date: '2026-09-17',
    version: 'v4.0',
    title: 'Family portfolio view',
    type: 'feature',
    items: [
      'Track any number of family members, each with their own transactions, cash, and history, plus a combined "All Family" view',
      'Dashboard cash balances are now edited inline from the summary boxes — the separate Cash Management section is gone',
      'Mobile navigation redesigned as a hamburger + drawer menu instead of a horizontal scroll strip',
      'Dashboard greeting and footer now personalize to whichever family member is active',
      'The nav automatically hides advanced/technical pages (Dev Zone, Benchmark, Rolling, Risk Metrics, Forecast) for a member tagged "Parent," keeping their view to the essentials',
      'Removing a family member now requires typing their name to confirm plus a reason, both kept in a deletion history',
      'Every add/edit/delete-transaction and cash edit is now atomic — a failure partway through can no longer leave your numbers half-updated',
    ],
  },
  {
    date: '2026-09-16',
    title: 'Portfolio forecasting',
    type: 'feature',
    items: [
      'New fitted time-series forecast for where your portfolio value is headed, alongside the existing Monte Carlo projections',
      'Forecast now warns when it would be anchored on stale price data instead of silently projecting from outdated numbers',
    ],
  },
  {
    date: '2026-09-11',
    version: 'v3.7',
    title: 'Risk Metrics page + performance pass',
    type: 'feature',
    items: [
      'New /risk-metrics page — Alpha, Sharpe Ratio, and a "Risk per ₹1 of Return" figure for at-a-glance risk-adjusted performance',
      'Long transaction histories now page instead of loading everything at once',
      'Mobile navigation touch targets and squished Projections tabs fixed',
      'Assistant tool calls are now individually time-bounded so one slow call can no longer stall a whole response',
    ],
  },
  {
    date: '2026-09-09',
    version: 'v3.6',
    title: 'Full observability for the AI assistant',
    type: 'improvement',
    items: [
      'Every chat request now carries a traceable ID across tool calls and logs, end to end',
      'Token usage and estimated cost captured per chat request',
      'New Dev Zone tabs for browsing request traces and AI safety events',
      'The assistant now asks a clarifying question instead of guessing when your request is genuinely ambiguous',
      'Chat history now persists when you navigate away from /ai and back',
    ],
  },
  {
    date: '2026-09-08',
    title: 'Ticker autocomplete + AI reliability',
    type: 'improvement',
    items: [
      'Add Transaction now autocompletes ticker symbols from your own transaction history',
      'The AI assistant now refuses to fabricate figures instead of guessing when it skips a tool call it should have made',
      'Added request-size limits to the AI assistant, and patched several flagged dependency vulnerabilities',
    ],
  },
  {
    date: '2026-09-06',
    title: 'Login branding + AI safety hardening',
    type: 'improvement',
    items: [
      'Sign-in screen rebranded with motion and refreshed copy',
      'Added defensive guardrails to the AI assistant against manipulated/adversarial input, backed by a recurring internal evaluation suite',
      'Rolling-return chart no longer plots points before a full trailing window of data exists, avoiding a misleadingly noisy start',
    ],
  },
  {
    date: '2026-08-30',
    version: 'v3.5',
    title: 'OpenRouter as a second AI provider',
    type: 'feature',
    items: [
      'Added an opt-in OpenRouter path (Nemotron 3 Ultra / MiniMax M2.7) alongside the default Groq provider, picked per conversation from the chat UI',
      'Automatic fallback to Groq if OpenRouter fails or hits a quota limit, so a chat never just dead-ends',
    ],
  },
  {
    date: '2026-08-29',
    title: 'Dashboard welcome redesign + login polish',
    type: 'improvement',
    items: [
      'Reworked welcome messages that adapt to the time of day with a more polished, editorial tone',
      'Added session security monitoring, with a sign-out flow and a dedicated Security tab for reviewing activity',
      'Polished the sign-in animation and loading sequence end to end',
    ],
  },
  {
    date: '2026-08-27',
    title: 'Dev Zone + timezone fixes',
    type: 'improvement',
    items: [
      'New Dev Zone page for app-wide log visibility and Supabase/edge-function health checks',
      'AI chat responses restyled with clearer structured rendering',
      'Fixed several local-vs-UTC date boundary bugs affecting period reports and chart date-matching',
      'Dashboard sidebar nav reorganized into groups, with an AUM history graph added to the summary bar',
    ],
  },
  {
    date: '2026-08-26',
    version: 'v3.4',
    title: 'XIRR breakdown + AUM goal tracking',
    type: 'feature',
    items: [
      'Click-to-expand XIRR breakdown on the dashboard — see Overall, ex-PF, and benchmark-relative XIRR side by side',
      'Added an AUM goal line to the net-worth chart, tracking progress toward a target by a target date',
      '"Years to double" now shown next to every XIRR figure',
      'AI assistant and tool calls now retry automatically with backoff on transient failures instead of failing outright',
    ],
  },
  {
    date: '2026-08-24',
    title: 'More AI tools + architecture docs',
    type: 'improvement',
    items: [
      'AI assistant gained a list_transactions tool and now runs multiple tool calls within a turn with bounded concurrency for faster responses',
      'Architecture diagrams added to the README for anyone new to the codebase',
    ],
  },
  {
    date: '2026-08-23',
    title: 'AI assistant polish + app-wide performance',
    type: 'improvement',
    items: [
      'Premium visual polish for the AI chat interface, with an auto-growing message composer',
      'New get_period_performance tool, and fixed the assistant double-counting internal transfers as market loss',
      'Every page now code-splits by route, and several chart queries were batched/scoped to only the data they need — noticeably faster loads across the app',
    ],
  },
  {
    date: '2026-08-22',
    version: 'v3.3',
    title: 'Tax accuracy, multi-year reports, audit trail',
    type: 'feature',
    items: [
      'New Harvestable Losses toggle and reordered Exact Tax Payable on /taxes',
      'Invested amount and average price now correctly use FIFO cost basis instead of raw sell proceeds',
      'Multi-fiscal-year browsing with year-over-year growth added to /reports',
      'Every AI tool call is now recorded to an audit log for traceability',
      'Several redundant database writes eliminated, cutting unnecessary load on every page visit',
    ],
  },
  {
    date: '2026-08-20',
    title: 'AI transparency + security hardening',
    type: 'improvement',
    items: [
      'The AI assistant now shows its real tool-call trace instead of a black-box "thinking" spinner',
      'New performance attribution chart on /charts',
      'Hardened authentication across the AI assistant and its backend endpoints',
      'Added Vercel Web Analytics',
    ],
  },
  {
    date: '2026-08-18',
    version: 'v3.2',
    title: 'Benchmark comparison rebuild + AI guardrails',
    type: 'feature',
    items: [
      'Drag-to-select a point-to-point return range on any chart',
      'Rebuilt the Benchmark comparison page with term tooltips, aligned to the same methodology the AI assistant uses internally',
      'Annualized XIRR badge and tax-loss-harvesting flags added',
      'Added safety and scope guardrails to the AI assistant’s instructions, and test coverage for the core finance calculation modules',
    ],
  },
  {
    date: '2026-08-15',
    title: 'Exposure treemap + CI auto-deploy',
    type: 'improvement',
    items: [
      'Exposure breakdown redesigned as a treemap in place of the old bento grid',
      'Live prices now auto-refresh once on the dashboard’s first load each day',
      'Edge functions now auto-deploy to Supabase on every push to main',
    ],
  },
  {
    date: '2026-08-08',
    version: 'v3.1',
    title: 'Real authentication + RLS lockdown',
    type: 'foundation',
    items: [
      'Replaced the placeholder login with real Supabase Auth behind a single centralized route gate',
      'Row Level Security locked down to authenticated-only across every table',
      'Structured JSON logging added across edge functions for easier debugging',
      'Benchmark price history restored with a dedicated fetch function',
      'Frontend now deploys to Vercel',
    ],
  },
  {
    date: '2026-08-07',
    version: 'v3.0',
    title: 'Real MCP agent architecture',
    type: 'foundation',
    items: [
      'Replaced the old prose-based AI integration with a real JSON-RPC MCP server and a multi-provider agent backend',
      'Frontend now consumes a normalized streaming format for AI responses',
      'Chat responses render markdown tables properly and stay scoped to what was actually asked',
      'Added required test and typecheck gates, plus secret scanning, before anything merges to main',
    ],
  },
  {
    date: '2026-07-13',
    version: 'v2.5',
    title: 'Projections v2 — Goal P(success), SIP Optimizer, FIRE, Stress Lab & Ticker CAPE',
    type: 'feature',
    items: [
      'Portfolio-weighted return & volatility — the engine now derives expected return and vol from your actual per-category exposure (Equity 12%/18%, Debt 7%/4%, Gold 8%/15%, PPF 7.1%/0%, US 10%/16%, Crypto 20%/60%) instead of one blanket assumption',
      'New Goals tab in /projections — pick any goal, get P(goal met) with fan chart (p10/p50/p90) vs the target line, expected surplus and expected shortfall on failing paths',
      'SIP Optimizer — inverse Monte Carlo bisection solves the minimum monthly SIP so probability of hitting your goal ≥ your target confidence (default 80%); also returns a step-up (+10%/yr) equivalent',
      'New FIRE tab — two-phase Monte Carlo (accumulation → drawdown), computes required corpus at retirement (using your SWR), projected p10/p50/p90 corpus, gap and additional SIP needed, portfolio survival probability to life expectancy, and earliest FIRE age reachable on the current trajectory',
      'New Stress Lab tab — replay 2008 GFC, 2020 COVID, and 2000 Dot-com on your current AUM at any equity weight; shows max drawdown, trough value, end value, and recovery time at 12% nominal',
      'Ticker CAPE (Shiller PE) — new fetch-ticker-cape edge function pulls 10Y annual EPS from Yahoo, inflation-adjusts by India CPI, and stores the CAPE in a new ticker_fundamentals table for future factor-#4 override in Deployment signals',
      'All new modules use portfolio-weighted vol from your actual exposure — no hard-coded 18% shortcut',
    ],
  },
  {
    date: '2026-07-11',
    version: 'v2.4',
    title: 'Deployment Signal Transparency — SHAP-style Decomposition + NIFTY CAPE',
    type: 'feature',
    items: [
      'New Market Regime strip at the top of /deployment-plan — shows current NIFTY Shiller PE (CAPE), long-term median, deviation, and zone (Cheap / Fair / Expensive / Bubble); editable inline and persisted to a new market_indicators table',
      'SHAP-style Signal Decomposition card for every ticker analyzed — breaks the BUY/HOLD/AVOID verdict into 6 weighted, transparent factors: PE vs sector median, Forward vs Trailing PE (growth), Price vs 52W range, Earnings yield vs 10Y G-Sec (ERP), Dividend yield, and Market regime (CAPE overlay)',
      'Each factor shows its raw value, benchmark, weight, signed points contribution, and a one-line rationale — no more opaque verdicts',
      'Confidence chip warns when inputs are missing (e.g. no forward PE, no dividend yield) so you know when to trust the signal',
      'Sector benchmark map seeded with ~15 Indian sectors + US tech / broad market — auto-classifies your ticker and picks the right peer median',
    ],
  },
  {
    date: '2026-06-05',

    version: 'v2.3',
    title: 'Quarterly / Half-Yearly / Yearly Reports',
    type: 'feature',
    items: [
      'New /reports page — board-style earnings reports for FY2026-27, with a toggle for Quarterly (Q1–Q4), Half-Yearly (H1/H2), and Full-Year views',
      'Past quarters render as actuals (computed from transactions + net worth history); upcoming quarters show base + conservative projections side-by-side using your live XIRR and SIP target',
      'Executive KPI grid (Net Worth, Invested, Current, P&L) with period-over-period growth, performance trend line, P&L bars, category + geography exposure pies, activity log, and top movers',
      'Editable narrative per period — Executive Summary, Highlights, Risks, Outlook — auto-saved per period for your records',
      'Print-friendly layout — hit "Print / PDF" to export a clean earnings-call-style report',
    ],
  },
  {
    date: '2026-06-01',
    version: 'v2.2',
    title: 'PF (Provident Fund) account',
    type: 'feature',
    items: [
      'New PF Account card in Cash Management — tracks PPF / EPF as long-term savings, with inline edit to update the balance anytime',
      'PF balance is included in Net Worth (treated as redeemable retirement savings) and recorded in the net-worth history snapshots',
      'Summary bar now shows a dedicated PF mini-stat alongside Liquid Cash, Vault Cash, and CC Debt',
    ],
  },
  {
    date: '2026-06-01',
    version: 'v2.1',
    title: 'SIP target tracking + auth fixes',
    type: 'feature',
    items: [
      'Set an editable monthly SIP target on the dashboard — progress bar shows how close you are this month',
      'When the monthly target is achieved, a celebratory message greets you in the SIP / Investment Activity card',
      'Portfolio AI (/ai) is now properly behind the login gate — no more accidental public access',
      'Changelog page header cleaned up — only the changelog content is shown now, no top nav clutter',
    ],
  },
  {
    date: '2026-05-06',
    version: 'v2.0',
    title: 'Dashboard redesign + Compare retired',
    type: 'improvement',
    items: [
      'Removed the Benchmark Comparison feature — page, edge function, cached benchmark history, and top-nav link have all been cleaned up',
      'New unified top navigation — single rounded card with logo, "Personal" badge, tab strip with active underline, and grouped action controls (Prices / Privacy / Theme / Logout)',
      'Net Worth hero card redesigned — clean inline P&L pill, invested vs current footer, monochrome professional tone',
      'Cash Management redesigned with a 3-card grid — credit card debt now rendered as a black VISA-style card (image-2 inspired), Liquid + Vault as icon stat cards',
      'Debt % vs Net Worth chart promoted to the dashboard (right under cash) for at-a-glance debt health',
      'Welcome greeting moved out of the gradient banner into a clean editorial heading at the top of the page',
    ],
  },
  {
    date: '2026-05-05',
    version: 'v1.9',
    title: 'Liveliness, reminders & open changelog',
    type: 'improvement',
    items: [
      'Dynamic dashboard greeting — banner now adapts to day-of-week and time-of-day with curated, motivational copy',
      'Credit card bill reminder — early-month banner with one-click "Pay Now" appears while CC debt is outstanding (auto-hides after payment or after the 5th)',
      'Light theme — clean black & white professional minimalistic palette',
      'Summary bar redesigned — Net Worth promoted to a hero tile, secondary metrics in a denser grid',
      'Changelog page is now publicly accessible — no login required, so anyone can see what shipped',
    ],
  },
  {
    date: '2026-05-05',
    version: 'v1.8',
    title: 'Credit card debt tracking',
    type: 'feature',
    items: [
      'Cash Management now tracks "Money I Owe (ICICI Credit Card)" as a third manual input',
      'Net Worth = Holdings + Liquid Cash + Vault Cash − Credit Card Debt (debt is subtracted)',
      'New "Pay CC Bill" button — deducts the outstanding amount from Vault Cash and resets debt to zero',
      'Charts page: added "Debt % vs Net Worth Over Time" composed chart (debt ratio against gross assets)',
      'Summary bar shows CC Debt as a negative tile when outstanding',
    ],
  },
  {
    date: '2026-05-04',
    version: 'v1.7',
    title: 'Rolling returns + SIP activity',
    type: 'feature',
    items: [
      'New Rolling Returns page (/rolling-returns) — 1Y/3Y/5Y rolling XIRR per holding and overall portfolio, with a monthly chart',
      'XIRR (not CAGR) is used because SIP cash flows are non-uniform — XIRR correctly weighs each contribution by its date',
      'Historical monthly closes are auto-fetched from Yahoo Finance and cached for fast recomputation',
      'New SIP / Investment Activity card on the dashboard — current month invested + average monthly SIP per FY (Apr–Mar)',
      'Top nav: replaced "Updates" with "Rolling" link (changelog still in footer)',
    ],
  },
  {
    date: '2026-05-04',
    version: 'v1.6',
    title: 'Comparisons fix + richer goal details',
    type: 'improvement',
    items: [
      'Benchmark Comparison now compares portfolio holdings (excluding cash) instead of total net worth — apples-to-apples vs indices',
      'Replaced Nifty 500 with Sensex on the comparisons page',
      'Default range is now "Since investing" — anchored to your first BUY transaction',
      'Goal cards are now clickable — popup shows target date, days left, time-used %, and a per-allocation tax breakdown',
      'Tax breakdown now splits STCG (20%) and LTCG (12.5%) using FIFO holding-period matching',
      'Removed the Updates link from the top nav (now reachable via the footer changelog)',
    ],
  },
  {
    date: '2026-05-01',
    version: 'v1.5',
    title: 'Goals, Comparisons & Changelog',
    type: 'feature',
    items: [
      'Goal-Based Investing — tag investments to goals (retirement, house, education, …) with progress tracking at /goal-track',
      'Allocate by amount: split a single holding or cash bucket across multiple goals',
      'Benchmark Comparison page at /comparisons — Nifty 50, Nifty 500, and S&P 500 vs your portfolio (rebased to 100)',
      'New Updates page (/updates) — full project changelog from day one',
      'Site-wide footer with the "Note from Dad" quote and changelog link',
    ],
  },
  {
    date: '2026-04-22',
    title: 'Welcome banner refresh',
    type: 'improvement',
    items: [
      'Added a personalized "Vanakkam Da Mapla!" greeting banner on the dashboard',
      'Switched from Tamil script to English transliteration for readability',
    ],
  },
  {
    date: '2026-04-18',
    title: 'Net worth chart now reflects cash updates',
    type: 'fix',
    items: [
      'Cash balance changes now append to net_worth_history in real time',
      'Chart re-renders immediately after liquid/vault cash edits',
    ],
  },
  {
    date: '2026-04-12',
    title: 'Top navbar revamp',
    type: 'improvement',
    items: [
      'Minimalistic top navbar across all pages with consistent iconography',
      'Quick-access buttons for Charts, Taxes, Projections, Deploy, and AI',
      'Hide-values toggle, theme switcher, and live price refresh inline',
    ],
  },
  {
    date: '2026-04-05',
    title: 'Asset categories & icons',
    type: 'feature',
    items: [
      'Added all major asset categories: Stocks, Mutual Funds, FDs, Gold & Silver, Real Estate, US Stocks/ETFs, PPF/EPF, Crypto, NPS, Custom Assets',
      'Per-category icons rendered in holdings table and exposure breakdown',
    ],
  },
  {
    date: '2026-03-28',
    title: 'Portfolio AI assistant',
    type: 'feature',
    items: [
      'New /ai page with a chat-style assistant powered by Lovable AI',
      'Context-aware: knows your holdings, cash, and recent transactions',
    ],
  },
  {
    date: '2026-03-20',
    title: 'Deployment plan & projections',
    type: 'feature',
    items: [
      '/deployment-plan: rule-based suggestions for deploying idle liquid cash',
      '/projections: long-term portfolio projections with custom CAGR & SIP inputs',
    ],
  },
  {
    date: '2026-03-12',
    title: 'XIRR + tax calculator',
    type: 'feature',
    items: [
      'Annualized XIRR computed across all transactions + current portfolio value',
      'STCG / LTCG tax estimator on /taxes',
    ],
  },
  {
    date: '2026-03-05',
    title: 'Live price fetching via Yahoo Finance',
    type: 'feature',
    items: [
      'fetch-prices edge function pulls regular market prices from Yahoo Finance',
      'fetch-pe-ratio function for fundamentals using auth-crumb flow',
      'Last-fetch timestamp shown in IST',
    ],
  },
  {
    date: '2026-02-25',
    title: 'Exposure breakdown & top movers',
    type: 'feature',
    items: [
      'Geography and category exposure cards with % weightings',
      'Top 3 gainers and losers by P&L %',
    ],
  },
  {
    date: '2026-02-18',
    title: 'Net worth history tracking',
    type: 'foundation',
    items: [
      'Append-only net_worth_history table — every txn or cash edit creates a snapshot',
      'Net Worth Over Time area chart on the dashboard',
    ],
  },
  {
    date: '2026-02-10',
    title: 'Privacy mode + theme toggle',
    type: 'improvement',
    items: [
      'Eye-toggle to mask all monetary values across the app',
      'Light / dark theme switcher with persisted preference',
    ],
  },
  {
    date: '2026-02-01',
    title: 'Login gate',
    type: 'foundation',
    items: [
      'Simple session-based access gate to keep the dashboard private',
    ],
  },
  {
    date: '2026-01-25',
    title: 'Cash management',
    type: 'feature',
    items: [
      'Liquid cash + vault cash buckets with edit-in-place',
      'Net worth = portfolio current value + liquid + vault',
    ],
  },
  {
    date: '2026-01-15',
    title: 'Holdings derived from transactions',
    type: 'foundation',
    items: [
      'Single source of truth: transactions table',
      'Holdings, avg price, invested, P&L all computed in-memory from txn history',
    ],
  },
  {
    date: '2026-01-08',
    title: 'Project foundation',
    type: 'foundation',
    items: [
      'React + Vite + Tailwind + TypeScript scaffold',
      'Lovable Cloud (Supabase) backend with transactions, current_prices, cash_settings, symbol_metadata tables',
      'Add / edit / delete transactions with BUY / SELL types',
    ],
  },
];

const TYPE_META: Record<Update['type'], { label: string; icon: typeof Sparkles; color: string }> = {
  feature: { label: 'Feature', icon: Sparkles, color: 'hsl(213, 75%, 55%)' },
  improvement: { label: 'Improvement', icon: Zap, color: 'hsl(35, 85%, 55%)' },
  fix: { label: 'Fix', icon: Wrench, color: 'hsl(152, 60%, 42%)' },
  foundation: { label: 'Foundation', icon: Layers, color: 'hsl(280, 50%, 55%)' },
};

function UpdatesContent() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-10">
        <header className="mb-10">
          <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground mb-2">Changelog</p>
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground tracking-tight">
            What's new in Portfolio Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-xl">
            A running log of every shipped feature, fix, and improvement — from day one to today.
          </p>
        </header>

        <div className="relative">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden />
          <div className="space-y-10">
            {UPDATES.map((u, i) => {
              const meta = TYPE_META[u.type];
              const Icon = meta.icon;
              return (
                <article key={i} className="relative pl-8">
                  <span
                    className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-background"
                    style={{ backgroundColor: meta.color }}
                    aria-hidden
                  />
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-xs font-mono text-muted-foreground">
                      {new Date(u.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {u.version && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                        {u.version}
                      </span>
                    )}
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                      style={{ color: meta.color, backgroundColor: `${meta.color.replace(')', ', 0.12)').replace('hsl', 'hsla')}` }}
                    >
                      <Icon className="w-3 h-3" />
                      {meta.label}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-foreground mb-2">{u.title}</h2>
                  <ul className="space-y-1.5">
                    {u.items.map((item, j) => (
                      <li key={j} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                        <ArrowUpRight className="w-3.5 h-3.5 mt-1 shrink-0 text-foreground/40" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

const Updates = () => (
  <PrivacyProvider>
    <UpdatesContent />
  </PrivacyProvider>
);

export default Updates;
