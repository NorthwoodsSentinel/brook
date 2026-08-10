# Recovered deployment artifact — 2026-08-10

**This is build output, not source. Do not edit it and do not deploy from it without reading this.**

## Why it exists

This repo's last commit before today was **2026-06-27**. The live worker was deployed from
`wrangler` on **2026-08-05** (twice) and **2026-08-06**, by `robert.chuvala@gmail.com`.

Everything those deploys introduced — the `Neversink` rename, `/context`, `/briefing`,
`/context/search`, `/checkin`, `/checkout`, `/publish`, the persistent-awareness layer — **is not in
this repo.** The TypeScript it was compiled from lives in whatever working tree ran `wrangler
deploy`, which has not been identified.

Until that tree is found, these files are the only surviving artifact of that work.

## What the files are

| file | what it is |
|---|---|
| `2026-08-10-deployed-raw-multipart.txt` | **Authoritative.** Byte-for-byte what the Cloudflare API returned for the live script. |
| `2026-08-10-deployed-bundle.js` | `index.js` extracted from the above. Envelope trimming is approximate — trust the raw file for fidelity. |

**No sourcemap exists.** The bundle references `index.js.map`, but only `index.js` was uploaded, so
the original TypeScript cannot be reconstructed from Cloudflare. Recovery means reading compiled
output: wrangler's `unenv` polyfills are inlined at the top, the actual `src/index.ts` is compiled at
the bottom.

## The live defect this artifact documents

```js
async scheduled(event, env2, ctx) {
  const id = env2.BROOK.idFromName("brook-singleton");
  const stub = env2.BROOK.get(id);
  ctx.waitUntil(stub.fetch(new Request("https://neversink/check")));
}
```

The hourly cron calls `/check` **with no `Authorization` header**. `PUBLIC_PATHS` is only `/` and
`/daemon`, so the Durable Object's guard returns 401. `ctx.waitUntil()` swallows it, observability
was off, and `/status` reports `"awake"` from a stored field rather than a liveness check.

**Result: silent since 2026-08-06T14:09:54 — 42 seconds after the deploy that caused it.** Confirmed
2026-08-10 by calling `/check` manually with the vaulted bearer: it ran, `lastCheck` advanced,
`totalChecks` 2530 → 2532. The worker is fine. Nothing was calling it successfully.

Commit `f6c83fd fix: authenticate cron-triggered /check request` (2026-04-22) is the fix this deploy
reverted.

Observability was enabled on the worker 2026-08-10, so the next cron fire logs the 401 instead of
vanishing.

— CeeCee, 2026-08-10
