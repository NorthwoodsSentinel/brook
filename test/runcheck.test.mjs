// NOR-245 fix-once: integration tests that drive the real Brook.runCheck against a real SQLite (node:sqlite),
// so the alert and accounting branches are exercised, not just the helpers (Codex audit of 4070c2e).
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Brook } from "../dist/index.mjs";

function makeCtx() {
  const db = new DatabaseSync(":memory:");
  const exec = (q, ...args) => {
    let rows = [];
    if (args.length === 0 && q.trim().split(";").filter(x => x.trim()).length > 1) db.exec(q);
    else rows = db.prepare(q).all(...args);
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  };
  return { db, storage: { sql: { exec } } };
}
const now = Date.now();
const isoAgo = h => new Date(now - h * 3600e3).toISOString();
function gh({ listPages = 1, delay = 0, repos = 3, commitsFor = () => [], detail = () => ({ ok: true, stats: { total: 1 } }), bridge = [{ commit: { author: { date: isoAgo(1) } } }] } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    url = String(url); calls.push(url);
    if (delay) await new Promise(r => setTimeout(r, delay));
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") || "1");
    if (u.pathname.startsWith("/orgs/")) {
      const h = page < listPages ? { link: `<https://api.github.com${u.pathname}?per_page=100&page=${page + 1}>; rel="next"` } : {};
      return new Response(JSON.stringify(Array.from({ length: repos }, (_, i) => ({ name: "r" + ((page - 1) * repos + i), full_name: "o/r" + i }))), { status: 200, headers: h });
    }
    if (u.pathname === "/repos/o/bridge/commits") return new Response(JSON.stringify(bridge), { status: 200 });
    let m = u.pathname.match(/^\/repos\/o\/(r\d+)\/commits$/);
    if (m) {
      const all = commitsFor(m[1]); const per = 100; const slice = all.slice((page - 1) * per, page * per);
      const h = page * per < all.length ? { link: `<https://api.github.com${u.pathname}?per_page=100&page=${page + 1}>; rel="next"` } : {};
      return new Response(JSON.stringify(slice), { status: 200, headers: h });
    }
    m = u.pathname.match(/^\/repos\/o\/(r\d+)\/commits\/(.+)$/);
    if (m) { const d = detail(m[1], m[2]); return d.ok ? new Response(JSON.stringify({ stats: d.stats }), { status: 200 }) : new Response("x", { status: 500 }); }
    if (u.host === "raw.githubusercontent.com") return new Response("", { status: 404 });
    return new Response("unexpected " + url, { status: 599 });
  };
  return calls;
}
const env = (extra = {}) => ({ GITHUB_ORG: "o", FLEET_BRIDGE_REPO: "bridge", GITHUB_TOKEN: "t", ALERT_THRESHOLD_COMMITS: "100000", ALERT_THRESHOLD_FILES: "100000", ALERT_THRESHOLD_REPOS: "1000", ...extra });
async function run(e, setup) {
  const ctx = makeCtx(); const b = new Brook(ctx, e);
  const calls = gh(setup); const r = await b.runCheck("test");
  const checks = ctx.db.prepare("SELECT repos_checked FROM checks").all();
  const lastTs = ctx.db.prepare("SELECT value FROM meta WHERE key='last_check_ts'").all();
  return { ...r, calls, reposChecked: checks.at(-1).repos_checked, windowMoved: lastTs.length > 0, msgs: r.alerts.map(a => a.message).join(" | ") };
}
const commits = n => Array.from({ length: n }, (_, i) => ({ sha: "c" + i, commit: { message: "m" } }));
const res = [];
async function t(name, fn) { try { await fn(); res.push("PASS  " + name); } catch (e) { res.push("FAIL  " + name + "  " + e.message); } }

await t("clean run: all repos fully scanned, window moves, no drift alert", async () => {
  const r = await run(env(), { repos: 3 });
  assert.equal(r.reposChecked, 3); assert.equal(r.windowMoved, true); assert.ok(!r.msgs.includes("Fleet-bridge"), r.msgs);
});
await t("budget caps EVERY subrequest, bridge + registry included", async () => {
  const r = await run(env({ SUBREQUEST_BUDGET: "10" }), { repos: 20 });
  assert.ok(r.calls.length <= 10, `made ${r.calls.length} calls on budget 10`);
  assert.ok(r.calls.some(c => c.includes("/bridge/commits")), "bridge still checked");
});
await t("budget below the reserve is rejected loudly and falls back", async () => {
  const r = await run(env({ SUBREQUEST_BUDGET: "2" }), { repos: 2 });
  assert.ok(r.msgs.includes('SUBREQUEST_BUDGET "2" invalid'), r.msgs);
});
await t("empty bridge commit list alerts", async () => {
  const r = await run(env(), { bridge: [] });
  assert.ok(r.msgs.includes("Fleet-bridge check returned no commits"), r.msgs);
});
for (const bad of ["2026-02-30T00:00:00Z", "", "not-a-date", "2026-11-08"]) {
  await t(`impossible/missing bridge date alerts: ${JSON.stringify(bad)}`, async () => {
    const r = await run(env(), { bridge: [{ commit: { author: { date: bad } } }] });
    assert.ok(r.msgs.includes("no readable date"), r.msgs);
  });
}
await t("stale bridge still alerts with hours", async () => {
  const r = await run(env(), { bridge: [{ commit: { author: { date: isoAgo(30) } } }] });
  assert.ok(r.msgs.includes("not been updated in 30 hours"), r.msgs);
});
await t("a failed commit-detail check means that repo is NOT fully scanned", async () => {
  const r = await run(env(), { repos: 3, commitsFor: n => n === "r1" ? commits(2) : [], detail: () => ({ ok: false }) });
  assert.equal(r.reposChecked, 2); assert.equal(r.windowMoved, false);
});
await t("150 commits in one repo: paginated, counted, window moves when budget allows", async () => {
  const r = await run(env({ SUBREQUEST_BUDGET: "100" }), { repos: 2, commitsFor: n => n === "r0" ? commits(150) : [] });
  assert.ok(r.summary.includes("Commits: 150"), r.summary); assert.equal(r.reposChecked, 2); assert.equal(r.windowMoved, true);
});
await t("150 commits but no spare budget: list cut short, repo not counted, window held, alert", async () => {
  // budget 6 = 1 listing + 2 repo lists + 2 reserved + 1 spare -> the spare is spent... use 5: no spare for page 2
  const r = await run(env({ SUBREQUEST_BUDGET: "5" }), { repos: 2, commitsFor: n => n === "r0" ? commits(150) : [] });
  assert.equal(r.windowMoved, false); assert.ok(r.msgs.includes("1 commit list(s) cut short"), r.msgs);
  assert.equal(r.reposChecked, 1);
});
await t("future bridge date (2099) alerts as unreadable", async () => {
  const r = await run(env(), { bridge: [{ commit: { author: { date: "2099-01-01T00:00:00Z" } } }] });
  assert.ok(r.msgs.includes("no readable date"), r.msgs);
});
await t("window advances to the run START, not its end (commits pushed mid-scan are not skipped)", async () => {
  const ctx = makeCtx(); const b = new Brook(ctx, env());
  gh({ repos: 2, delay: 40 }); // ~5 calls x 40ms: end of run is >= 150ms after start
  const before = Date.now(); await b.runCheck("test");
  const ts = Date.parse(ctx.db.prepare("SELECT value FROM meta WHERE key='last_check_ts'").all()[0].value);
  assert.ok(ts <= before + 50, `last_check_ts ${new Date(ts).toISOString()} is after run start ${new Date(before).toISOString()}`);
});
await t("NOR-251: a 10-page repo listing cannot exceed a small budget", async () => {
  const r = await run(env({ SUBREQUEST_BUDGET: "5" }), { repos: 1, listPages: 10 });
  assert.ok(r.calls.length <= 5, `made ${r.calls.length} calls on budget 5`);
  assert.ok(r.msgs.includes("page cap") || r.msgs.includes("not scanned"), r.msgs);
});
for (const l of res) console.log(l);
const f = res.filter(l => l.startsWith("FAIL")).length;
console.log(`runcheck: ${res.length - f}/${res.length} passed`);
process.exit(f ? 1 : 0);
