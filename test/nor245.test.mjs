import assert from "node:assert/strict";
import { fetchAllPages, bridgeAgeHours, commitPageCap, MAX_COMMIT_PAGES } from "../dist/index.mjs";
const mk = (pages) => async (url) => {
  const i = Number(new URL(url).searchParams.get("page") || "1") - 1;
  const h = i + 1 < pages.length ? { link: `<https://api.github.com/x?page=${i + 2}>; rel="next"` } : {};
  return new Response(JSON.stringify(pages[i]), { status: 200, headers: h });
};
const p = (n, off) => Array.from({ length: n }, (_, k) => ({ sha: "s" + (off + k) }));
// 1. commit pagination honours the per-call page cap and reports truncation
let r = await fetchAllPages("https://api.github.com/x?page=1", {}, mk([p(100, 0), p(100, 100), p(30, 200)]), 3);
assert.equal(r.items.length, 230); assert.equal(r.truncated, false); assert.equal(r.pages, 3);
r = await fetchAllPages("https://api.github.com/x?page=1", {}, mk([p(100, 0), p(100, 100), p(30, 200)]), 1);
assert.equal(r.items.length, 100); assert.equal(r.truncated, true); assert.equal(r.pages, 1);
r = await fetchAllPages("https://api.github.com/x?page=1", {}, mk([p(100, 0), p(5, 100)]), 0); // cap floors to 1
assert.equal(r.pages, 1); assert.equal(r.truncated, true);
// page cap (used already counts this repo's first call): never spends a later repo's list call
assert.equal(commitPageCap(45, 11, 34), 1);            // exactly enough for the rest: no extra pages
assert.equal(commitPageCap(45, 11, 33), 2);
assert.equal(commitPageCap(45, 1, 0), MAX_COMMIT_PAGES); // plenty: capped
assert.equal(commitPageCap(45, 44, 10), 1);            // over budget still allows the one list call already counted
// 2. bridge date validation
const now = Date.parse("2026-11-08T12:00:00Z");
assert.equal(bridgeAgeHours([{ commit: { author: { date: "2026-11-07T12:00:00Z" } } }], now), 24);
assert.equal(bridgeAgeHours([{ commit: { author: { date: "not-a-date" } } }], now), null);
assert.equal(bridgeAgeHours([{ commit: { author: {} } }], now), null);
assert.equal(bridgeAgeHours([{ commit: null }], now), null);
assert.equal(bridgeAgeHours([{}], now), null);
assert.equal(bridgeAgeHours([], now), null);
assert.equal(bridgeAgeHours([{ commit: { author: { date: 12345 } } }], now), null);
console.log("nor245: pass");
