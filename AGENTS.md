# brook

Brook is fleet overwatch: one Cloudflare Worker (`src/index.ts`) fronting a single SQLite-backed Durable Object that wakes hourly on a cron, scans the GitHub org, reads the fleet-bridge registry, records agent check-ins and session telemetry, and serves public daemon pages. It is written in TypeScript and has no build step of its own; wrangler bundles it at deploy time. There is no published package. The owner picks what gets worked on; agents carry it through to a reviewed pull request.

**This file holds the _rules_: the conventions a reviewer cites against a diff.** It is loaded in full on every turn, so it stays complete enough to work from on its own. The rules are adapted from Cliff Hall's `modelcontextprotocol/inspector` `AGENTS.md`; where the owner ruled differently, the ruling is what is written here. The repo has no skills yet, so there are no procedures to point to.

## Contributing

**The owner picks the work; an agent carries it through to a reviewed pull request.** This repo is public, so **anything merged here is public, and merging is the owner's act.** An agent opens the PR and stops there.

**Every PR must reference an issue. No exceptions.** The PR body's first line is `Closes NOR-<NUMBER>` (or `Refs NOR-<NUMBER>` when the PR is one part of a larger ticket). If there is no issue yet, create it first.

- **Repo**: `NorthwoodsSentinel/brook` (public)
- **Issue tracker**: Linear, team key `NOR`
- **Develop branch**: `main`. Cut feature branches from it; every PR targets it. What is live is whatever was last deployed (see [Cloudflare work](#cloudflare-work-ours)), which is not necessarily `main`.

## Issue-driven Work Style

- **Before starting work, check Linear for the relevant ticket.** Every item of work is a real Linear issue; **never create a duplicate.**
  - **A privately reported vulnerability is the one exception**: it is tracked privately until the reviewed fix is ready. Accepting and publishing an advisory stay human-gated; never automate either.
- **Label work run through this process** (one process label, name not yet set by the owner) and **label by type, exactly one of `bug` / `enhancement` / `documentation` / `chore` / `question`.**
- **`Backlog` means filed, not approved; `Todo` means approved by the owner.** An agent starts work only on a ticket in `Todo`.
- **`Done` means the work shipped** (its PR merged, or it is a parent whose last sub-issue closed). Anything else is `Canceled` or `Duplicate`, never `Done`.
- **When work begins**, assign the issue, set it **In Progress**, and create the feature branch in a new git worktree, never by switching branches in a shared checkout.
- **When work is complete**, run `npm run format` then `npm run local:gate`, **sign off every commit** (`git commit -s`), open a PR against `main`, and set the ticket **In Review**.
- **After opening a PR, run a Codex review loop** (`codex exec --sandbox read-only`). Fix what it finds in the PR's own scope and run it again. Stop on the **first** clean round, with no confirming round. **Two failed rounds in a row: stop, leave the PR open, and list the open findings in it.** Decline scope expansion: pre-existing behavior and hardening the issue did not ask for become new issues, not more commits.
- **If new tasks are discovered during development, create issues.** They arrive in `Backlog`.
- **Pace bulk GitHub writes: 1 s between requests, never in parallel.**

### Responding to Code Reviews

- Judge each suggestion against the issue the PR closes. Fix defects in what the PR added; decline, with a reason, suggestions that expand it.
- Reply in the review comment's own thread; a rollup comment does not discharge it. Post the PR-level summary in addition.

## Always test new or modified code

- **Ensure all code has corresponding tests.** The bar is the source's: **≥ 90 on all four dimensions (lines, statements, functions, branches), per file**, and **CI enforces it**: a PR that drops any file below the bar fails. (The owner's ruling: the source's way stands until there is a reason to depart.) `npm run coverage` runs Vitest with V8 coverage over `src/**/*.ts`.
- **An exclusion is an exact path, one per entry, never a glob, with a comment naming its follow-up ticket.** There are none today. Never lower the threshold to pass.
- **A genuinely unreachable branch is annotated at the source, never waved through by lowering the gate.**
- **A coverage `include` is a whitelist, and a run that measures fewer files than it should must fail loudly.** `scripts/verify-coverage-scope.mjs`, the last step of `npm run coverage`, fails naming every git-tracked `src/**/*.ts` file that was not measured and is not excluded by exact path, and prints the count it checked. Fix a failure by fixing the globs, never by excusing the file.
- **Keep the exact test filename pattern** (`test/**/*.test.ts`). A test file the pattern misses is silently skipped while the run still exits 0.
- **How the Worker is tested.** The tests run `src/index.ts` under Node, not workerd. `vitest.config.mts` aliases `cloudflare:workers` to `test/support/cloudflare-workers.ts`, which supplies only the `DurableObject` base class. `test/support/sql.ts` backs `ctx.storage.sql` with `node:sqlite`, so every query runs against a real SQLite engine. Outbound `fetch` (GitHub) is stubbed per test by URL. **A rule about what the code does is asserted at runtime, through a request and the rows it leaves behind, not read out of the source.**
- **A test that races is fixed with an awaited condition or a mocked clock (`vi.spyOn(Date, "now")`), never with headroom.**

## Mandatory pre-push gate

`local:gate` runs `format:check`, `lint`, `typecheck` and `coverage` (tests plus the per-file bar plus the scope check), in that order. CI (`.github/workflows/ci.yml`) runs the same four steps on every pull request.

- **ALWAYS run `npm run format` before committing.** The gate runs the non-fixing `format:check`.
- **`npm run local:gate` is the mandatory pre-push command.** It runs every check CI runs. `npm test` alone is not a substitute.
- **The CI workflow never deploys and holds no secrets.** Its actions are pinned to a commit SHA, and `timeout-minutes` is declared.

## Waiting on long-running work

**When you are waiting for something to finish, arm a notifier and stop. Never spend turns polling.** Background the command, or a single `until` loop that exits on the condition. State the harness cannot observe (a CI run, a remote review) is polled inside **one** backgrounded loop with an interval of 30 s or more. **If a notifier is already armed, that settles it: wait.**

## Build output is never a gate target

**No gate (lint, format, typecheck, coverage) may read generated output.** Each scope says so in its own ignore list: `node_modules/`, `.wrangler/`, `dist/`, `coverage/`, and `recovered/`.

- **`recovered/` is build output, not source.** It holds the compiled bundle pulled from Cloudflare on 2026-08-10 (see `recovered/README.md`). Never edit it, lint it, format it, or deploy from it.
- **When a build starts writing to a new location, add it to every scope's ignore list in the same change.** Never widen an ignore to silence a finding in first-party code.

## Lint has no warning tier

**`lint` runs with `--max-warnings 0`, so a warning fails the gate exactly as an error does.**

- **Do not silence a finding to satisfy the gate.** Fix it. If a rule genuinely must be waived on one line, use its inline disable comment **with a one-line justification**. Widening an ignore list or dropping a rule is not a fix.

## Typescript instructions

- Use TypeScript for all new code. NEVER use `any` as a type. Unchecked input (a parsed request body, a GitHub response) gets a named type that says so (`JsonBody`, `GitHubRepo`), and SQL reads name their row shape with `exec<Row>()`.
- NEVER suppress error types (e.g. `no-unused-vars`, `no-explicit-any`) in the TypeScript or ESLint configuration to satisfy the linter or compiler.
- AVOID double casts (`as unknown as T`). Where one is unavoidable (in this repo, only in test support, to hand a partial runtime object to a type that describes the whole one), it carries an inline comment saying why it is safe.
- **NEVER leave a promise floating.** Every promise is awaited, returned, terminated with `.catch(…)`, or discarded with `void` plus a one-line reason. `@typescript-eslint/no-floating-promises` enforces it.
- **Every new file carries a header comment explaining its purpose and the reasoning behind it.** This applies to new files and files a change touches; there is no bulk migration.
- Two tsconfigs: `tsconfig.json` checks `src/` alone against `@cloudflare/workers-types`; `tsconfig.test.json` adds the tests and Node types, with `skipLibCheck` because the two sets of global type declarations collide (the source's base tsconfig sets it too).

## Cloudflare work (OURS)

**OURS: none of this section comes from the Inspector**, which ships an npm package and has no Worker.

- **Deploying the Worker is the release, and it is the owner's act.** Every `wrangler deploy` counts, `npm run deploy` included. Nothing in this repo deploys from CI, and an agent never runs a deploy.
- **The live Worker and `main` have diverged before.** `recovered/README.md` records a deploy from a working tree that was never committed. Do not assume `main` is what is running.
- **Secrets are handled by name only, and their values never pass through a chat or a committed file.** The Worker reads `GITHUB_TOKEN` and `BROOK_API_KEY` as secrets; `GITHUB_ORG`, `FLEET_BRIDGE_REPO` and the three `ALERT_THRESHOLD_*` values are vars in `wrangler.toml`.
- **Check Cloudflare's current documentation before writing Cloudflare code**, and cite the page and the date it was read.
- **Local and deployed results are separate results, and each record names its target** (Node under Vitest, local workerd, or the deployed Worker with its version id). CI runs only the first.

## Only the owner does

- Picking new work.
- Merging into this public repo, or anything else public or sent to other people.
- Spending.
- Secrets, repository settings, and branch protection.
- Deploying the Worker, and any command against the live Cloudflare account.
