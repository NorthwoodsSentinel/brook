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
| 2026-11-08 | The repo listing read only the first page (98 of 175 repos), and per-repo fetch failures were swallowed, so a scan that hit a limit still looked complete. | Follow pagination on the API host only; count failed and unscanned repos under a subrequest budget and alert on either (72c815b + fix-once). | CeeCee / swarm round on 72c815b (Codex + council): fail, fixed once here; final Codex audit pending on this SHA | what we could not see we called quiet — / now the empty rooms are counted out loud. |
