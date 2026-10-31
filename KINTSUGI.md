# KINTSUGI

Repairs in this repo are marked, not hidden. Each fix carries the same gold line in three
places: a `kintsugi:` comment at the repair site, a `Kintsugi:` trailer on the commit, and a
row here. Where the repair has no comment syntax (a lockfile, package.json), the seam lives
in the trailer and this ledger only. The ledger is append-only.

A row never claims a review before one exists. Review status names the reviewer, the verdict
and the reviewed SHA. Security repairs describe the class of fix, never how to exploit the break.

| Date | What broke | How it was mended | Mended by / reviewed by | Gold line |
|---|---|---|---|---|
| 2026-10-31 | An unused dependency carried twelve vulnerable packages into production installs. | Removed it; refreshed wrangler; declared Node 22 (0c317e3, a7e8246). | CeeCee / Codex audit of 0c317e3: fail, 1 MEDIUM non-security, fixed in a7e8246; no re-audit (stop rule) | what was never called still came to the table — / we cleared the empty chair, and the room breathes. |
