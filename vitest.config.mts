// Test and coverage configuration. The coverage bar is the source's (Cliff Hall's
// inspector, clients/web/vite.config.ts): >= 90 on all four dimensions, per file.
// The owner's ruling: the source's way stands until there is a reason to depart.
//
// The Worker runs here under Node, not workerd. `cloudflare:workers` resolves to a
// test shim (test/support/cloudflare-workers.ts) that supplies only the DurableObject
// base class; the Durable Object's SQLite storage is backed by node:sqlite in
// test/support/sql.ts, so every query in src/ runs against a real SQLite engine.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./test/support/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Every source file is gated, including ones no test imports yet: a new file
      // under src/ lands in the gate automatically.
      include: ["src/**/*.ts"],
      // Exact paths only, one per entry, never a glob, so an exclusion can never
      // hide a new file. Each entry names its follow-up. None today.
      exclude: [],
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
