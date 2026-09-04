import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.ts",
    ],
    // A few edge-function test files dynamically `import("./index.ts")` inside
    // beforeAll to exercise the real Deno.serve handler, and those modules'
    // import chains (LLM provider clients, MCP client, router) are heavy
    // enough that under the full suite — every test file transforming/
    // collecting concurrently — the default 10s hook timeout occasionally
    // trips on a loaded machine, even though each resolves in well under a
    // second running alone. Raised once, globally, rather than patched
    // per-file, since the cause (suite-wide contention) isn't specific to
    // any one file and a future file with the same shape would hit it too.
    hookTimeout: 30000,
    // Same suite-wide-contention story as hookTimeout above, but for test
    // bodies: supabase/functions/portfolio-ai/model-preference-gate.test.ts
    // dynamically imports index.ts per test and drives its real (mocked-
    // provider) tool-call loop end to end, which is fast in isolation
    // (~50-70ms) but occasionally blew past the default 5s test timeout
    // under the full 82-file suite's CPU contention. That alone would just
    // be a flaky failure on its own test, except vitest doesn't cancel a
    // timed-out test's in-flight promises — this file's mocks
    // (quotaMock/groqRunTurnMock/openRouterRunTurnMock) are shared across
    // its `it()`s and only reset in `beforeEach`, so the killed test's
    // abandoned async work kept running and finished mid-*next* test,
    // recording an extra/unexpected call on that later test's mocks
    // (reproduced 2026-09-04: confirmed via a "Test timed out in 5000ms"
    // failure immediately followed by a `toHaveBeenCalledTimes`/
    // `not.toHaveBeenCalled` failure on the very next test in file order).
    // Raised globally for the same reason as hookTimeout: the trigger is
    // suite-wide load, not this one file.
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Deno edge functions import the Supabase client by URL; map that
      // exact specifier to the npm package already in node_modules so the
      // same source files can be unit-tested under Vitest/Node. Two
      // specifiers exist in the wild here: newer functions pin
      // @2.100.1, the older fetch-* functions just use @2 — both need
      // aliasing since Vite/Vitest only matches the exact string.
      "https://esm.sh/@supabase/supabase-js@2.100.1": "@supabase/supabase-js",
      "https://esm.sh/@supabase/supabase-js@2": "@supabase/supabase-js",
    },
  },
});
