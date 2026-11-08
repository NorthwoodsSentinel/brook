# NOR-259 design: per-repo watermarks, scan only repos the listing shows as pushed

## Problem (live, brook 55020c8b @ 4193fbb, 2026-11-08 21:00Z)
175 repos, SUBREQUEST_BUDGET 45 (Workers Free). Every run leaves ~135 repos unscanned, so
`scanIncomplete` is always true and the single global `last_check_ts` never advances (stuck at
16:00:50Z). Each run's `since` window grows by an hour, commit lists get longer and cost more budget,
and the "Repo scan incomplete" warning fires every hour forever. "New repo(s): fleet-substrate" also
repeats hourly, because a repo is inserted into `repos` only after a commit scan reaches it.

## Outcome wanted
Every commit pushed to a listed repo's default branch is eventually seen (never skipped), within the
budget, and the warning fires only when something is actually unseen.

## Design
1. Schema: `ALTER TABLE repos ADD COLUMN since_ts TEXT` (try/catch like the agents migrations).
   Existing rows get `since_ts = meta.last_check_ts` (the stuck global) on first run, once.
2. Listing (unchanged, budget-capped) returns `pushed_at` for every repo at 0 extra subrequests.
3. Every listed repo is upserted into `repos` right after the listing (name, is_private), keeping its
   existing `last_commit_sha` and `since_ts`. New-repo alerts fire once, at first listing.
4. A repo is DIRTY when `since_ts` is null (never fully scanned) or `pushed_at` > `since_ts`, or
   `pushed_at` is missing/unparseable (fail toward scanning). Clean repos cost 0 subrequests.
5. Scan dirty repos only, oldest `since_ts` first (null first), so a starved repo can't stay starved:
   each run drains from the back of the queue. Per repo: `commits?since=<that repo's since_ts>`
   (null → the old global fallback). Large-commit detail logic unchanged.
6. A repo's `since_ts` advances to the RUN START only when its own scan was complete (list ok, not
   truncated, no failed detail). Skipped details stay alert-only, as today.
7. `unscanned` = dirty repos not reached this run. The incomplete warning fires only if
   unscanned/failed/truncated > 0 or the listing failed/truncated. Clean repos count as covered.
8. Global `last_check_ts` keeps its meaning for /status ("everything seen up to"): set to the minimum
   `since_ts` across listed repos after the run (display only; no longer drives `since`).
9. Listing failed or truncated: repos not listed are not marked anything; warning as today.

## Assumptions to attack
- GitHub's repo `pushed_at` moves on every push to any branch, including merges and web edits. If a
  default-branch commit can land without moving `pushed_at`, step 4 skips it. (Is there such a path?)
- `pushed_at` vs `since_ts` clock: both are GitHub/Worker UTC; `since` is inclusive, so the boundary
  commit may be seen twice, never zero times.
- Steady state: dirty repos per hour ≈ repos actually pushed that hour (low single digits), well under 45.

## Not in scope
Cloudflare paid plan (Rob's decision list). Non-default branches (unchanged behaviour).
