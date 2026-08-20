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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Deno edge functions import the Supabase client by URL; map that
      // exact specifier to the npm package already in node_modules so the
      // same source files can be unit-tested under Vitest/Node.
      "https://esm.sh/@supabase/supabase-js@2.100.1": "@supabase/supabase-js",
    },
  },
});
