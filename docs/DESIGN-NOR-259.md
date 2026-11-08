# NOR-259 design v3: track default-branch head SHAs, not timestamps

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

## v3 changes (answers Codex design review of v2, ~/nws/reviews/nor259/design-v2: architecture accepted, 7 findings)
- F1 diverged: commits returned by compare are processed (volume/large-commit) for BOTH `ahead` and
  `diverged` (compare = BASE..HEAD); `diverged`/`behind` additionally warns "history rewritten".
  `behind` returns no new commits; it warns and re-baselines.
- F2 empty repos: head_sha NULL = "unknown" (awaiting migration); head_sha '' = "known empty". A known-empty
  repo that gets a head is reconciled by listing `commits?sha=<target>&per_page=100` (all commits are new),
  with the same persisted progress as F3. Never treated as a rewrite.
- F3 large reconciles: new columns `target_sha TEXT`, `next_page INTEGER`. When a repo goes pending, target_sha
  is fixed to the head seen then. Each run resumes compare(head_sha...target_sha) / the commit listing at
  next_page, processes those pages, and stores next_page. Done = last page reached: head_sha = target_sha,
  target_sha/next_page cleared, pending=0. If the live head has moved past target meanwhile, the next run
  enqueues a new reconcile target..current. So every reconcile makes progress each turn and finishes.
- F4 migration: `meta.head_tracking_version`. A run whose heads listing is COMPLETE (per F5) baselines every
  listed row with head_sha NULL (no commit review), then sets version=1 and emits ONE info alert with the count
  and the stuck last_check_ts. If the listing is incomplete, nothing is marked migrated and no alert fires;
  the next run tries again. After version=1, a NULL row that reappears (was unlisted) is baselined with its own
  warn "re-baselined <repo> without review (absent from listing since migration)".
- F5 GraphQL completeness: the heads listing is complete only if every page has HTTP 2xx, no `errors`, a
  valid organization.repositories connection, every node has a non-empty `name`, `pageInfo{hasNextPage
  endCursor}` is present, and the last page has hasNextPage=false within the budget. Otherwise: listing
  incomplete (warning; no migration; no watermark), and repos seen on complete pages are still processed.
- F6 `identical`: clears pending with no alert.
- F7 watermark: `last_check_ts` = this run's START time, set only when the heads listing was complete AND no
  repo is pending after the run.

## Test plan (Codex attack cases go in unchanged)
Mock GraphQL + compare + commits endpoints with: ahead; diverged with new commits; behind; identical;
404 base; known-empty → first commit; >250 compare across three runs with a budget that allows one page per
run (must finish on run 3, never re-process page 1); migration with truncated first listing then complete;
GraphQL 200 with `errors`; missing pageInfo; hasNextPage=true at budget; rotating cursor with one always-
failing repo (others still reconcile); watermark only on complete+zero-pending, equal to run start.
