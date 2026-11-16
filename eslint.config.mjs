// ESLint flat config. Lint runs with --max-warnings 0 (see AGENTS.md, "Lint has
// no warning tier"), so every rule enforced here is effectively an error.
// Generated output is never linted (AGENTS.md, "Build output is never a gate target"):
// recovered/ holds a compiled bundle pulled from Cloudflare, not source.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      ".wrangler/",
      "dist/",
      "coverage/",
      "recovered/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // Node-run tooling (this file, scripts/*.mjs): no type information, Node globals.
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  },
);
