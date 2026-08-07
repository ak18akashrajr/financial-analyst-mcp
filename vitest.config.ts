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
