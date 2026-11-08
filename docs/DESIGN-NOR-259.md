# NOR-259 design v2: track default-branch head SHAs, not timestamps

v1 (pushed_at + per-repo since_ts) FAILED Codex design review (~/nws/reviews/nor259/design, 8 findings).
Core reason, accepted: `commits?since=` filters by COMMIT date, so a commit authored last week and pushed
today is never returned. The live code (global since) has the same hole. Timestamps can't be the
correctness mechanism. v2 uses commit identities.

## Problem (live, brook 55020c8b @ 4193fbb)
175 repos, SUBREQUEST_BUDGET 45. The global `last_check_ts` never advances (scan always incomplete), the
since-window grows hourly, the warning fires forever, "New repo(s): fleet-substrate" repeats.

## Outcome wanted
Every commit that becomes reachable from a listed repo's default branch is seen, by identity, within the
budget. Force-pushes that rewrite history are reported, not silently absorbed. The warning fires only when
something is actually unseen.

## Design
1. Schema: `ALTER TABLE repos ADD COLUMN head_sha TEXT`, `ADD COLUMN pending INTEGER DEFAULT 0`,
   `ADD COLUMN pending_since TEXT`, `ADD COLUMN retry_after_run INTEGER DEFAULT 0` (try/catch migrations).
2. Heads, cheaply: one GraphQL query per 100 repos (`organization.repositories(first:100, after:)` →
   `name, isPrivate, defaultBranchRef{ target{ oid } }`). 175 repos = 2 subrequests. This replaces the
   REST listing (same budget cap; same truncation/failure alerts). Repos with no default branch (empty)
   are recorded with head_sha NULL and nothing to scan.
3. New repo (not in `repos`): record its current head as the baseline, alert once ("New repo"), scan
   nothing. This matches README's first-check baseline. A repo that reappears after a listing outage is
   NOT new (row exists) and is reconciled normally from its stored head.
4. Changed head (stored head_sha != current oid): enqueue (pending=1, pending_since=run start if unset).
5. Reconcile pending repos, ordered by a ROTATING cursor (stored `meta.reconcile_cursor`, round-robin over
   pending repo names), not oldest-first, so a repo that keeps failing can't pin the front. A repo that
   fails or truncates gets `retry_after_run = run_no + 1` and is skipped while cursor passes it.
   Per repo: `GET /repos/{o}/{r}/compare/{stored}...{current}` (1 subrequest; GitHub returns up to 250
   commits plus `status` and `total_commits`).
   - status ahead, total_commits <= returned: commits are the new identities → volume/large-commit checks
     as today (details budget-limited, alert-only when skipped), then head_sha=current, pending=0.
   - status ahead, total_commits > returned (over 250): page `compare` per GitHub docs within the budget;
     if not finished, keep pending (truncated), advance nothing.
   - status diverged/behind (force-push or history rewrite): alert "history rewritten on <repo>: <old> →
     <new>" (warn), set head_sha=current, pending=0. Commits that only existed on the rewritten history
     between polls are out of scope (see limits).
   - 404 on the stored SHA (garbage-collected): same alert as diverged, re-baseline.
   - Any other failure: stay pending, failed++.
6. Budget: heads (2) + reconciles (1 each, more for >250) + optional details. Steady state is a few
   changed repos per hour. The migration first run (step 7) is the only spike.
7. Migration: existing rows have head_sha NULL. On the first v2 run, treat every existing repo as a
   baseline (record current head, no commit scan) and emit ONE info alert: "Brook switched to head
   tracking; commits between <stuck last_check_ts> and now were not individually reviewed for <n> repos."
   Honest about the gap instead of draining 135 repos through a commit-date filter that can't be trusted.
8. Warning: "Repo scan incomplete" only when the heads listing failed/truncated or pending repos remain
   after the run (with counts: pending, failed, truncated). `last_check_ts` becomes "time of the last run
   in which every listed repo was reconciled" (display only), so it can't claim coverage after a
   truncated listing: it advances only when the listing was complete AND pending == 0.

## Assumptions to attack
- GraphQL is reachable with the same token (classic or fine-grained with repo read). If GraphQL is
  denied, fall back to the REST listing + `GET /repos/{o}/{r}/commits/{branch}` per repo is too costly:
  the run must alert "head listing unavailable" and not pretend.
- `compare` status semantics (ahead / behind / diverged / identical) and the 250-commit cap per page.

## Known limits (accepted, stated)
- Commits pushed and force-pushed away BETWEEN two polls are invisible to polling. Seeing those needs
  authenticated push webhooks carrying before/after (the current /webhook discards the payload). Ticket it.
- Non-default branches: unchanged (not watched).
- Migration gap in step 7 is reported once, not reconstructed.
