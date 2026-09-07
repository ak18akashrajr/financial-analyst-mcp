// Separate, standalone Vitest config for the manual, on-demand
// prompt-injection eval — deliberately NOT merged with vitest.config.ts (its
// own `include`/`setupFiles`/jsdom `environment` would otherwise leak in via
// Vitest's array-concatenating mergeConfig and both break this file's plain
// Node environment and start matching every other test file too). A plain
// `npm test` / `vitest run` (what CI actually runs) never references this
// config and never spends real API money.
//
// Run explicitly via `npm run eval:prompt-injection`. See
// supabase/functions/portfolio-ai/eval/prompt-injection.eval.ts and
// docs/prompt-injection-hardening.md for what this actually does and why.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // no DOM needed — this only drives real LLM API calls
    include: ["supabase/functions/portfolio-ai/eval/**/*.eval.ts"],
    // Each case is a real network round trip to a real LLM provider,
    // sometimes across a couple of tool-loop turns — slower than the
    // mocked unit/gate tests this repo's default testTimeout is tuned for.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      // Same alias as vitest.config.ts, copied rather than merged (see doc
      // comment above) — this file imports real production modules
      // (mcp-tools.ts -> portfolio-data.ts, portfolio-ai/index.ts) that
      // import the Supabase client by its Deno `https://esm.sh/...`
      // specifier, which only resolves under Node/Vitest via this alias to
      // the npm package already in node_modules.
      "https://esm.sh/@supabase/supabase-js@2.100.1": "@supabase/supabase-js",
      "https://esm.sh/@supabase/supabase-js@2": "@supabase/supabase-js",
    },
  },
});
