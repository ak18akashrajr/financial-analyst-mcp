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
*   **🤖 Portfolio AI Chatbot:** Talk directly with a smart financial assistant powered by **Gemini 2.5 Flash** and **LLaMA 3.1** via Supabase Edge Functions with context about your live holdings.
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
├── supabase/
│   ├── migrations/      # SQL database schema and RLS policies
│   └── functions/       # Deno Edge Functions (fetch-prices, portfolio-ai, etc.)
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
4.  **Deploy Edge Functions:**
    ```bash
    npx supabase functions deploy --use-api
    ```
5.  **Set Secrets for AI Edge Function:**
    ```bash
    npx supabase secrets set GROQ_API_KEY="your_groq_key" LOVABLE_API_KEY="your_lovable_key"
    ```

---

## 🧪 Testing

Run unit tests using Vitest:
```bash
npm test
```
