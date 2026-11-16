// verify-coverage-scope: the coverage gate must show how much it checked.
//
// A coverage run that silently measures fewer files than it should still passes its
// thresholds (Cliff Hall's inspector saw a run drop from 418 files to 11 and stay
// green). This script runs after `vitest run --coverage` and fails, listing each one,
// if any git-tracked src/**/*.ts file is missing from coverage/coverage-summary.json
// without being on the exact-path exclusion list in vitest.config.mts. It prints the
// count it checked so a shrinking scope is visible in the log.
//
// Fix a failure by fixing the include/exclude in vitest.config.mts, never by excusing
// the file here.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const config = (await import(path.join(root, "vitest.config.mts"))).default;
const excluded = new Set(config.test.coverage.exclude);
for (const e of excluded) {
  if (/[*?{}[\]]/.test(e)) {
    console.error(
      `verify-coverage-scope: exclusion "${e}" is a glob; exclusions must be exact paths`,
    );
    process.exit(1);
  }
}

const tracked = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
const summary = JSON.parse(
  readFileSync(path.join(root, "coverage", "coverage-summary.json"), "utf8"),
);
const measured = new Set(
  Object.keys(summary)
    .filter((k) => k !== "total")
    .map((k) => path.relative(root, k)),
);

const missing = tracked.filter((f) => !excluded.has(f) && !measured.has(f));
const staleExclusions = [...excluded].filter((e) => !tracked.includes(e));
if (missing.length || staleExclusions.length) {
  for (const f of missing)
    console.error(
      `verify-coverage-scope: ${f} is tracked but was not measured`,
    );
  for (const e of staleExclusions)
    console.error(
      `verify-coverage-scope: exclusion ${e} names no tracked file`,
    );
  process.exit(1);
}
console.log(
  `verify-coverage-scope: ${measured.size} file(s) measured, ${excluded.size} excluded by exact path, ${tracked.length} tracked: OK`,
);
