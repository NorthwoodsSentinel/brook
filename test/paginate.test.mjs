import assert from "node:assert/strict";
import { fetchAllPages, MAX_REPO_PAGES } from "../dist/index.mjs";
const mk = (pages, failAt = -1) => async (url) => {
  const i = Number(new URL(url).searchParams.get("page") || "1") - 1;
  if (i === failAt) return new Response("no", { status: 500 });
  const h = i + 1 < pages.length ? { link: `<https://api.github.com/x?page=${i + 2}>; rel="next", <https://api.github.com/x?page=${pages.length}>; rel="last"` } : {};
  return new Response(JSON.stringify(pages[i]), { status: 200, headers: h });
};
const p = (n, off) => Array.from({ length: n }, (_, k) => ({ name: "r" + (off + k) }));
let r = await fetchAllPages("https://api.github.com/x?page=1", {}, mk([p(100, 0), p(75, 100)]));
assert.equal(r.ok, true); assert.equal(r.items.length, 175); assert.equal(r.truncated, false);
r = await fetchAllPages("https://api.github.com/x?page=1", {}, mk([p(98, 0)]));
assert.equal(r.items.length, 98); assert.equal(r.truncated, false);
r = await fetchAllPages("https://api.github.com/x?page=1", {}, mk([p(100, 0), p(75, 100)], 0));
assert.equal(r.ok, false); assert.equal(r.status, 500);
r = await fetchAllPages("https://api.github.com/x?page=1", {}, mk([p(100, 0), p(75, 100)], 1));
assert.equal(r.ok, true); assert.equal(r.items.length, 100); assert.equal(r.truncated, true);
r = await fetchAllPages("https://api.github.com/x?page=1", {}, mk(Array.from({ length: MAX_REPO_PAGES + 2 }, (_, i) => p(1, i))));
assert.equal(r.items.length, MAX_REPO_PAGES); assert.equal(r.truncated, true);
console.log("paginate: 5/5 pass");
// off-host next link: stop and mark truncated, never send the token elsewhere
{
  let calls = [];
  const f = async (url) => { calls.push(url); return new Response(JSON.stringify([{ name: "a" }]), { status: 200, headers: { link: '<https://evil.example/x?page=2>; rel="next"' } }); };
  const r = await fetchAllPages("https://api.github.com/x?page=1", {}, f);
  assert.equal(calls.length, 1); assert.equal(r.truncated, true); assert.equal(r.items.length, 1);
  console.log("off-host: pass");
}
