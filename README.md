# Financial Analyst Portfolio Tracker

A premium, interactive web application built with **React**, **TypeScript**, **TailwindCSS**, and **Supabase**. This dashboard serves as a comprehensive financial analyst assistant, allowing users to track net worth, manage asset holdings, analyze tax liabilities, simulate future financial goals, and converse with an AI analyst grounded in their live portfolio data.

---

## 🚀 Key Features

*   **📊 Net Worth & Cash Management:** Live tracking of liquid/vault cash, credit card debt, PF balances, and historical net worth over time.
*   **📈 Holdings & Transaction Tracking:** Log purchase/sale transactions for stocks and other assets with automatic average cost basis calculation.
*   **🌐 Geographic & Sector Exposure:** Analyze concentration risk and asset exposure broken down by sectors, categories, and geographies.
*   **⚙️ Advanced Performance Analytics:**
    *   **Rolling Returns:** Analyze stock/index performance over rolling timeframes.
    *   **Dollar Adjusted Returns:** Estimate real gains by adjusting for currency fluctuations.
    *   **Seasonality Heatmap:** Monthly returns visualizer to spot historical trends.
*   **🎯 Goal Planning & Projections:** Track financial target goals and assign allocations from your active portfolio.
*   **💸 Taxes Dashboard:** Automatically calculate Short-Term Capital Gains (STCG) and Long-Term Capital Gains (LTCG) based on tax rules and transaction dates.
*   **🤖 Portfolio AI Chatbot:** Talk directly with a smart financial assistant backed by a real **Model Context Protocol (MCP) server** exposing live portfolio tools (holdings, exposure, risk metrics, stress tests, benchmark comparisons). Runs on **Groq (`gpt-oss-20b`/`gpt-oss-120b`, two-tier routed for cost)** by default, or **Claude Sonnet 5** automatically if an Anthropic key is configured — see [`docs/llm-mcp-agent-plan.md`](docs/llm-mcp-agent-plan.md) for the architecture.
*   **📝 Quarterly/Annual Reports:** Generate summaries, performance commentary, and outlooks.

---

## 🛠️ Technology Stack

*   **Frontend:** React (v18), TypeScript, Vite, TailwindCSS, Shadcn/ui components, Lucide icons, Recharts (for charts & graphs).
*   **State & Queries:** `@tanstack/react-query` (React Query) for performant cache management.
*   **Backend Database:** Supabase (PostgreSQL with Row Level Security).
*   **Edge Functions:** Deno-based Supabase Edge Functions for third-party API fetches (pricing, FX rates) and LLM streaming.
*   **Testing:** Vitest for unit/integration tests and Playwright for browser testing.

---

## 📂 Project Structure

```text
├── docs/
│   └── llm-mcp-agent-plan.md  # Portfolio AI architecture: real MCP server + multi-provider agent
├── supabase/
│   ├── migrations/      # SQL database schema and RLS policies
│   └── functions/
│       ├── _shared/            # Portfolio data/calculations, MCP tool registry, LLM provider adapters
│       ├── portfolio-mcp-server/  # Real MCP (JSON-RPC) server exposing portfolio tools
│       ├── portfolio-ai/       # Agent backend: tool-use loop against the MCP server
│       └── ...                 # fetch-prices, fetch-fx-rates, etc.
├── src/
│   ├── components/      # UI components (HoldingsTable, CashSection, charts, etc.)
│   ├── contexts/        # React context providers
│   ├── hooks/           # Custom React hooks
│   ├── integrations/    # Supabase Client connection config
│   ├── pages/           # Page routes (Taxes, Projections, AI, Reports, etc.)
│   └── test/            # Vitest unit tests
├── index.html           # SPA root HTML
├── vite.config.ts       # Vite config
├── package.json         # Dependency manifest
└── .env.example         # Template for environment variables
```

---

## ⚙️ Local Development Setup

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18+)
*   [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) (required for database & function deployments)

### 1. Clone & Install Dependencies
Navigate to the project root and run:
```bash
npm install --legacy-peer-deps
```
*(Note: `--legacy-peer-deps` is recommended due to dependency tree conflicts between `@types/react` and `react-markdown`.)*

### 2. Configure Environment Variables
Create a `.env` file in the root directory:
```ini
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_PUBLISHABLE_KEY="your-anon-key"
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="your-anon-key"
VITE_SUPABASE_PROJECT_ID="your-project-ref"
```

### 3. Run Development Server
```bash
npm run dev
```
Open **[http://localhost:8080](http://localhost:8080)** in your browser to view the application.

---

## 🗄️ Database & Edge Functions Deployment

To point the application to your own Supabase instance:

1.  **Authenticate CLI:**
    ```bash
    npx supabase login
    ```
2.  **Link Local Repo:**
    ```bash
    npx supabase@1.190.0 link --project-ref your-project-ref-id
    ```
    *(Note: Using pinned CLI `v1.190.0` prevents strict ISO timezone validation errors on manually created API keys.)*
3.  **Deploy Database Schemas:**
    ```bash
    npx supabase@1.190.0 db push
    ```
4.  **Deploy Edge Functions:** (this deploys both `portfolio-mcp-server` and `portfolio-ai`, among others)
    ```bash
    npx supabase functions deploy --use-api
    ```
5.  **Set Secrets for the AI Agent:**
    ```bash
    npx supabase secrets set GROQ_API_KEY="your_groq_key"
    ```
    `GROQ_API_KEY` is required — it's the default provider (`gpt-oss-20b`/`gpt-oss-120b`, routed
    by query complexity). To upgrade to Claude Sonnet 5 instead, also set:
    ```bash
    npx supabase secrets set ANTHROPIC_API_KEY="your_anthropic_key"
    ```
    When `ANTHROPIC_API_KEY` is present, the agent uses Claude exclusively — no code changes
    needed to switch. See [`docs/llm-mcp-agent-plan.md`](docs/llm-mcp-agent-plan.md) for details.
6.  **Create your login account:** the app is gated by real Supabase Auth (email + password),
    single-user. Go to your project's **Supabase Dashboard → Authentication → Users → Add user**
    and create one account for yourself — there is no signup flow in the app itself. The session
    is scoped to the browser tab (expires when it's closed, not persisted indefinitely). See
    [`docs/auth-rls-plan.md`](docs/auth-rls-plan.md) for the full security rationale.

---

## 🌐 Frontend Deployment (Vercel, free tier)

The backend (Supabase) is already public once you've completed the steps above — the only
remaining piece is hosting the built static frontend so it's reachable from any device.

1.  **Push to GitHub** (already done for this repo — Vercel deploys straight from the connected
    branch on every push).
2.  **Import the repo on [vercel.com](https://vercel.com)** → New Project → select this
    repository. Vercel auto-detects Vite; [`vercel.json`](vercel.json) pins the build command
    and adds the SPA rewrite rule react-router needs (all paths fall back to `index.html`).
3.  **Set environment variables** in Vercel → Project Settings → Environment Variables (same
    values as your local `.env` — these are the public anon key, safe to expose client-side):
    ```
    VITE_SUPABASE_URL
    VITE_SUPABASE_PUBLISHABLE_KEY
    VITE_SUPABASE_PROJECT_ID
    ```
4.  **Deploy.** Vercel gives you a free `https://<project>.vercel.app` URL with HTTPS,
    auto-redeploying on every push to `main`. A custom domain can be attached for free under
    Project Settings → Domains.

---

## 🧪 Testing

Run unit tests using Vitest:
```bash
npm test
```
