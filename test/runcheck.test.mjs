// NOR-259: integration tests drive the real Brook.runCheck against a real SQLite (node:sqlite) with a mock GitHub
// (GraphQL heads + REST compare/commits). Cases marked [Codex N] are the adversarial cases from the v3 design review
// (~/nws/reviews/nor259/design-v3, "Required adversarial test cases"), kept as specified.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Brook } from "../dist/index.mjs";

function makeCtx(db = new DatabaseSync(":memory:"), crashAt = null) {
  const exec = (q, ...args) => {
    if (crashAt && crashAt(q, args)) throw new Error("INJECTED CRASH");
    let rows = [];
    if (args.length === 0 && q.trim().split(";").filter(x => x.trim()).length > 1) db.exec(q);
    else rows = db.prepare(q).all(...args);
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  };
  const transactionSync = (fn) => {
    db.exec("BEGIN");
    try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, storage: { sql: { exec }, transactionSync } };
}
const now = Date.now();
const isoAgo = h => new Date(now - h * 3600e3).toISOString();
const C = (sha, total = 1) => ({ sha, commit: { message: "m " + sha }, _total: total });

// world: { repos: [{id,name,oid}], graphql?: fn(page)->override, compare: {"name:base...head": [{status, commits, pages?}]}, history: {"name:sha": commits[]} }
function gh(world) {
  const calls = [];
  const bridge = world.bridge ?? [{ commit: { author: { date: isoAgo(1) } } }];
  const pageSize = world.gqlPageSize ?? 100;
  const commitTotals = {};
  globalThis.fetch = async (url, init = {}) => {
    url = String(url); calls.push(url);
    const u = new URL(url);
    if (u.pathname === "/graphql") {
      const { variables } = JSON.parse(init.body);
      const startIdx = variables.after ? Number(variables.after) : 0;
      const pageNo = Math.floor(startIdx / pageSize) + 1;
      if (world.graphql) { const o = world.graphql(pageNo, startIdx); if (o) return o; }
      const slice = world.repos.slice(startIdx, startIdx + pageSize);
      const hasNext = startIdx + pageSize < world.repos.length;
      const nodes = slice.map(r => ({ id: r.id, name: r.name, isPrivate: false, defaultBranchRef: r.oid ? { target: { oid: r.oid } } : null }));
      return new Response(JSON.stringify({ data: { repositoryOwner: { __typename: "User", repositories: { pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? String(startIdx + pageSize) : null }, nodes } } } }), { status: 200 });
    }
    if (u.pathname === "/repos/o/bridge/commits") return new Response(JSON.stringify(bridge), { status: 200 });
    if (u.host === "raw.githubusercontent.com") return new Response("", { status: 404 });
    let m = u.pathname.match(/^\/repos\/o\/([^/]+)\/compare\/(.+)$/);
    if (m) {
      const key = `${m[1]}:${decodeURIComponent(m[2])}`;
      const spec = world.compare?.[key];
      if (!spec) return new Response("not found", { status: 404 });
      const page = Number(u.searchParams.get("page") || "1");
      const all = spec.commits || [];
      const slice = all.slice((page - 1) * 100, page * 100);
      for (const c of slice) commitTotals[c.sha] = c._total;
      const h = page * 100 < all.length ? { link: `<https://api.github.com${u.pathname}?per_page=100&page=${page + 1}>; rel="next"` } : {};
      return new Response(JSON.stringify({ status: spec.status, total_commits: all.length, commits: slice }), { status: 200, headers: h });
    }
    m = u.pathname.match(/^\/repos\/o\/([^/]+)\/commits$/);
    if (m) {
      const key = `${m[1]}:${u.searchParams.get("sha")}`;
      const all = world.history?.[key] || [];
      const page = Number(u.searchParams.get("page") || "1");
      const slice = all.slice((page - 1) * 100, page * 100);
      for (const c of slice) commitTotals[c.sha] = c._total;
      const h = page * 100 < all.length ? { link: `<https://api.github.com${u.pathname}?sha=x&per_page=100&page=${page + 1}>; rel="next"` } : {};
      return new Response(JSON.stringify(slice), { status: 200, headers: h });
    }
    m = u.pathname.match(/^\/repos\/o\/([^/]+)\/commits\/(.+)$/);
    if (m) {
      if (world.detailFail) return new Response("x", { status: 500 });
      return new Response(JSON.stringify({ stats: { total: commitTotals[m[2]] ?? 1 } }), { status: 200 });
    }
    return new Response("unexpected " + url, { status: 599 });
  };
  return calls;
}
const env = (extra = {}) => ({ GITHUB_ORG: "o", FLEET_BRIDGE_REPO: "bridge", GITHUB_TOKEN: "t", ALERT_THRESHOLD_COMMITS: "100000", ALERT_THRESHOLD_FILES: "500", ALERT_THRESHOLD_REPOS: "1000", ...extra });

// A Brook whose migration already happened, with given repo_heads rows.
async function seeded(rows, e = env(), ctx = makeCtx()) {
  const b = new Brook(ctx, e); await b.init();
  ctx.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('head_tracking_version','1')").run();
  for (const r of rows) ctx.db.prepare("INSERT INTO repo_heads (repo_id,name,is_private,head_sha,target_sha,next_page,pending) VALUES (?,?,0,?,?,?,?)")
    .run(r.id, r.name, r.head, r.target ?? null, r.next ?? null, r.pending ?? 0);
  return { b, ctx };
}
const head = (ctx, id) => ctx.db.prepare("SELECT * FROM repo_heads WHERE repo_id=?").all(id)[0];
const meta = (ctx, k) => ctx.db.prepare("SELECT value FROM meta WHERE key=?").all(k)[0]?.value;
const alerts = (ctx) => ctx.db.prepare("SELECT id, message FROM alerts").all();
const msgs = (r) => r.alerts.map(a => a.message).join(" | ");
const res = [];
async function t(name, fn) { try { await fn(); res.push("PASS  " + name); } catch (e) { res.push("FAIL  " + name + "  " + e.message); } }

// ── migration ──
await t("migration: complete listing baselines legacy repos, ONE disclosure, version=1, new names alert", async () => {
  const ctx = makeCtx(); const b = new Brook(ctx, env()); await b.init();
  ctx.db.prepare("INSERT INTO repos (name,last_commit_sha,last_checked,is_private) VALUES ('a','',?,0),('b','',?,0)").run(isoAgo(5), isoAgo(5));
  ctx.db.prepare("INSERT INTO meta (key,value) VALUES ('last_check_ts',?)").run("2026-11-08T16:00:50.000Z");
  gh({ repos: [{ id: "R1", name: "a", oid: "A" }, { id: "R2", name: "b", oid: "B" }, { id: "R3", name: "c", oid: "Cx" }] });
  const r = await b.runCheck("test");
  assert.equal(meta(ctx, "head_tracking_version"), "1");
  const al = alerts(ctx).filter(a => a.id === "migration:head-tracking-v1");
  assert.equal(al.length, 1); assert.ok(al[0].message.includes("2 repo(s) baselined") && al[0].message.includes("2026-11-08T16:00:50"), al[0].message);
  assert.ok(msgs(r).includes("New repo(s): c"), msgs(r));
  assert.equal(head(ctx, "R1").head_sha, "A");
  await b.runCheck("test"); // second run: no second disclosure
  assert.equal(alerts(ctx).filter(a => a.id.startsWith("migration:")).length, 2);
});
await t("[Codex 13] incomplete listing with a valid first page: no migration marker, no watermark, warning", async () => {
  const ctx = makeCtx(); const b = new Brook(ctx, env());
  gh({ repos: Array.from({ length: 150 }, (_, i) => ({ id: "R" + i, name: "r" + i, oid: "h" + i })),
       graphql: (page) => page === 2 ? new Response(JSON.stringify({ errors: [{ message: "rate limited" }] }), { status: 200 }) : null });
  const r = await b.runCheck("test");
  assert.equal(meta(ctx, "head_tracking_version"), undefined); assert.equal(meta(ctx, "last_check_ts"), undefined);
  assert.ok(msgs(r).includes("head listing INCOMPLETE"), msgs(r));
});
await t("[Codex 7] migration crash after baselines: rolled back, one disclosure after restart", async () => {
  const db = new DatabaseSync(":memory:");
  const crashCtx = makeCtx(db, (q) => q.includes("INSERT OR REPLACE INTO meta") && q.length > 0 && db.prepare("SELECT COUNT(*) n FROM repo_heads").all()[0].n === 2 && !globalThis.__crashed && (globalThis.__crashed = true));
  const b1 = new Brook(crashCtx, env()); await b1.init();
  db.prepare("INSERT INTO repos (name,last_commit_sha,last_checked,is_private) VALUES ('a','',?,0),('b','',?,0)").run(isoAgo(5), isoAgo(5));
  gh({ repos: [{ id: "Ra", name: "a", oid: "A" }, { id: "Rb", name: "b", oid: "B" }] });
  await b1.runCheck("test").catch(() => {});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM repo_heads").all()[0].n, 0, "baselines must roll back with the marker");
  const b2 = new Brook(makeCtx(db), env()); await b2.runCheck("test");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM alerts WHERE id='migration:head-tracking-v1'").all()[0].n, 1);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='head_tracking_version'").all()[0].value, "1");
  delete globalThis.__crashed;
});
await t("[Codex 8] migration crash after marker before alert: rolled back, disclosure exists exactly once", async () => {
  const db = new DatabaseSync(":memory:");
  let armed = true;
  const crashCtx = makeCtx(db, (q) => armed && q.includes("INSERT OR IGNORE INTO alerts") && (armed = false, true));
  const b1 = new Brook(crashCtx, env()); await b1.init();
  db.prepare("INSERT INTO repos (name,last_commit_sha,last_checked,is_private) VALUES ('a','',?,0)").run(isoAgo(5));
  gh({ repos: [{ id: "Ra", name: "a", oid: "A" }] });
  await b1.runCheck("test").catch(() => {});
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='head_tracking_version'").all().length, 0, "marker must roll back with the alert");
  await new Brook(makeCtx(db), env()).runCheck("test");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM alerts WHERE id='migration:head-tracking-v1'").all()[0].n, 1);
});

// ── identity ──
await t("[Codex 1] rename with an intervening commit: commit processed, no new-repo baseline skip", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "alpha", head: "A" }]);
  gh({ repos: [{ id: "R1", name: "beta", oid: "B" }], compare: { "beta:A...B": { status: "ahead", commits: [C("B", 900)] } } });
  const r = await b.runCheck("test");
  const h = head(ctx, "R1"); assert.equal(h.name, "beta"); assert.equal(h.head_sha, "B"); assert.equal(h.pending, 0);
  assert.ok(!msgs(r).includes("New repo"), msgs(r)); assert.ok(msgs(r).includes("Large commit in beta: 900"), msgs(r));
});
await t("[Codex 2] delete + recreate under the same name: new repo, alerts once, baselines; not a rewrite", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "alpha", head: "A" }]);
  gh({ repos: [{ id: "R2", name: "alpha", oid: "X" }] });
  const r = await b.runCheck("test");
  assert.ok(msgs(r).includes("New repo: alpha"), msgs(r)); assert.ok(!msgs(r).includes("rewritten"), msgs(r));
  assert.equal(head(ctx, "R2").head_sha, "X");
});
await t("[Codex 17] 404 caused by replacement: pending old id is not reconciled against the new repo", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "alpha", head: "A", target: "B", next: 1, pending: 1 }]);
  const calls = gh({ repos: [{ id: "R2", name: "alpha", oid: "X" }] });
  const r = await b.runCheck("test");
  assert.ok(!calls.some(c => c.includes("/compare/A...B")), "old id must not be compared by the reused name");
  assert.ok(!msgs(r).includes("rewritten") && !msgs(r).includes("no longer exists"), msgs(r));
  assert.ok(msgs(r).includes("New repo: alpha"), msgs(r));
});

// ── reconcile ──
await t("ahead: commits processed, head advances, watermark at run start", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "B" }], compare: { "a:A...B": { status: "ahead", commits: [C("x"), C("B")] } } });
  const before = Date.now(); const r = await b.runCheck("test");
  assert.equal(head(ctx, "R1").head_sha, "B"); assert.ok(r.summary.includes("Commits: 2"), r.summary);
  assert.ok(Date.parse(meta(ctx, "last_check_ts")) <= before + 50);
});
await t("old-dated commit pushed today is seen (the bug that started NOR-259)", async () => {
  const { b } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  const old = { sha: "OLD", commit: { message: "from last week", author: { date: isoAgo(24 * 7) } }, _total: 800 };
  gh({ repos: [{ id: "R1", name: "a", oid: "OLD" }], compare: { "a:A...OLD": { status: "ahead", commits: [old] } } });
  const r = await b.runCheck("test");
  assert.ok(msgs(r).includes("Large commit in a: 800"), msgs(r));
});
await t("identical clears pending with no alert", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A", target: "B", next: 1, pending: 1 }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "B" }], compare: { "a:A...B": { status: "identical", commits: [] } } });
  const r = await b.runCheck("test");
  assert.equal(head(ctx, "R1").pending, 0); assert.ok(!msgs(r).includes("rewritten"), msgs(r));
});
await t("behind: warns history moved backwards and re-baselines", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "B" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "A" }], compare: { "a:B...A": { status: "behind", commits: [] } } });
  const r = await b.runCheck("test");
  assert.ok(msgs(r).includes("history moved backwards"), msgs(r)); assert.equal(head(ctx, "R1").head_sha, "A");
});
await t("[Codex 16] diverged multi-page (201 commits): all processed once, ONE rewrite warning, done after page 3", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }], env({ SUBREQUEST_BUDGET: "30" }));
  const cs = Array.from({ length: 201 }, (_, i) => C(i === 200 ? "Z" : "d" + i));
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }], compare: { "a:A...Z": { status: "diverged", commits: cs } } });
  const r = await b.runCheck("test");
  assert.ok(r.summary.includes("Commits: 201"), r.summary); assert.equal(head(ctx, "R1").pending, 0);
  assert.equal(alerts(ctx).filter(a => a.id.startsWith("rewrite:")).length, 1);
});
await t("[Codex 11] compare pagination at an exact boundary (200): done after page 2, no page 3", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }], env({ SUBREQUEST_BUDGET: "30" }));
  const calls = gh({ repos: [{ id: "R1", name: "a", oid: "Z" }], compare: { "a:A...Z": { status: "ahead", commits: Array.from({ length: 200 }, (_, i) => C(i === 199 ? "Z" : "e" + i)) } } });
  const r = await b.runCheck("test");
  assert.ok(r.summary.includes("Commits: 200"), r.summary); assert.equal(head(ctx, "R1").pending, 0);
  assert.ok(!calls.some(c => c.includes("page=3")), "no invented page 3");
});
await t("large reconcile across runs: resumes at next_page, never re-processes page 1", async () => {
  // budget 4 = 2 reserved + 1 graphql + 1 compare page per run
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }], env({ SUBREQUEST_BUDGET: "4", ALERT_THRESHOLD_FILES: "100000" }));
  const world = { repos: [{ id: "R1", name: "a", oid: "Z" }], compare: { "a:A...Z": { status: "ahead", commits: Array.from({ length: 250 }, (_, i) => C(i === 249 ? "Z" : "p" + i)) } } };
  let total = 0;
  for (let run = 1; run <= 3; run++) { gh(world); const r = await b.runCheck("t"); total += Number(r.summary.match(/Commits: (\d+)/)[1]); }
  assert.equal(total, 250); assert.equal(head(ctx, "R1").pending, 0); assert.equal(head(ctx, "R1").head_sha, "Z");
});
await t("[Codex 3/15/18] head moves while old target finishes: stays pending for B...C, no watermark, warning", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A", target: "B", next: 1, pending: 1 }], env({ SUBREQUEST_BUDGET: "4" }));
  gh({ repos: [{ id: "R1", name: "a", oid: "C" }], compare: { "a:A...B": { status: "ahead", commits: [C("B")] } } });
  const r = await b.runCheck("test");
  const h = head(ctx, "R1"); assert.equal(h.head_sha, "B"); assert.equal(h.target_sha, "C"); assert.equal(h.pending, 1);
  assert.equal(meta(ctx, "last_check_ts"), undefined); assert.ok(msgs(r).includes("1 repo(s) still pending"), msgs(r));
});
await t("[Codex 4] live head returns to the completing target: clears pending, watermark advances", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A", target: "B", next: 2, pending: 1 }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "B" }], compare: { "a:A...B": { status: "ahead", commits: Array.from({ length: 150 }, (_, i) => C(i === 149 ? "B" : "q" + i)) } } });
  await b.runCheck("test");
  assert.equal(head(ctx, "R1").pending, 0); assert.ok(meta(ctx, "last_check_ts"));
});
await t("[Codex 9] known-empty repo, exactly 100 then more: does not stop at 100", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "" }], env({ SUBREQUEST_BUDGET: "30", ALERT_THRESHOLD_FILES: "100000" }));
  gh({ repos: [{ id: "R1", name: "a", oid: "T" }], history: { "a:T": Array.from({ length: 101 }, (_, i) => C(i === 0 ? "T" : "k" + i)) } });
  const r = await b.runCheck("test");
  assert.ok(r.summary.includes("Commits: 101"), r.summary); assert.equal(head(ctx, "R1").head_sha, "T");
  assert.ok(!msgs(r).includes("rewritten") && !msgs(r).includes("no longer exists"), msgs(r));
});
await t("[Codex 10] known-empty repo, exactly 200: all processed once, done on page 2", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "" }], env({ SUBREQUEST_BUDGET: "30", ALERT_THRESHOLD_FILES: "100000" }));
  const calls = gh({ repos: [{ id: "R1", name: "a", oid: "T" }], history: { "a:T": Array.from({ length: 200 }, (_, i) => C(i === 0 ? "T" : "k" + i)) } });
  const r = await b.runCheck("test");
  assert.ok(r.summary.includes("Commits: 200"), r.summary); assert.equal(head(ctx, "R1").pending, 0);
  assert.ok(!calls.some(c => c.includes("page=3")));
});
await t("[Codex 5] crash after progress write but before alerts: rolled back, commit L alerted exactly once", async () => {
  const db = new DatabaseSync(":memory:");
  const { b } = await seeded([{ id: "R1", name: "a", head: "A", target: "B", next: 1, pending: 1 }], env(), makeCtx(db, (q) => q.includes("SET head_sha") && !globalThis.__c5 && (globalThis.__c5 = true)));
  gh({ repos: [{ id: "R1", name: "a", oid: "B" }], compare: { "a:A...B": { status: "ahead", commits: [C("L", 1000), C("B")] } } });
  await b.runCheck("test").catch(() => {});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM alerts WHERE id LIKE 'large:%'").all()[0].n, 0, "alert must roll back with progress");
  await new Brook(makeCtx(db), env()).runCheck("test");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM alerts WHERE id='large:R1:L'").all()[0].n, 1);
  delete globalThis.__c5;
});
await t("[Codex 6] crash after alert but before progress: rolled back, resumes, one alert", async () => {
  const db = new DatabaseSync(":memory:");
  let armed = true;
  const { b } = await seeded([{ id: "R1", name: "a", head: "A", target: "B", next: 1, pending: 1 }], env(), makeCtx(db, (q) => armed && q.includes("UPDATE repo_heads SET head_sha") && (armed = false, true)));
  gh({ repos: [{ id: "R1", name: "a", oid: "B" }], compare: { "a:A...B": { status: "ahead", commits: [C("L", 1000), C("B")] } } });
  await b.runCheck("test").catch(() => {});
  await new Brook(makeCtx(db), env()).runCheck("test");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM alerts WHERE id='large:R1:L'").all()[0].n, 1);
  assert.equal(db.prepare("SELECT pending FROM repo_heads WHERE repo_id='R1'").all()[0].pending, 0);
});
await t("rotating cursor: a repo that always fails does not starve the others", async () => {
  const rows = [{ id: "R0", name: "bad", head: "A" }, { id: "R1", name: "a", head: "A" }, { id: "R2", name: "b", head: "A" }];
  const { b, ctx } = await seeded(rows, env({ SUBREQUEST_BUDGET: "4" })); // 1 reconcile call per run
  const world = { repos: [{ id: "R0", name: "bad", oid: "B" }, { id: "R1", name: "a", oid: "B" }, { id: "R2", name: "b", oid: "B" }],
    compare: { "a:A...B": { status: "ahead", commits: [C("B")] }, "b:A...B": { status: "ahead", commits: [C("B")] } } }; // bad -> 404? no: give it a failing shape
  world.compare["bad:A...B"] = { status: "weird", commits: [] };
  for (let i = 0; i < 4; i++) { gh(world); await b.runCheck("t"); }
  assert.equal(head(ctx, "R1").pending, 0); assert.equal(head(ctx, "R2").pending, 0); assert.equal(head(ctx, "R0").pending, 1);
});

// ── audit e590c8e fixes ──
await t("[audit F1] pending repo vanishes from a complete listing: warned by name+SHA, not silent", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "gone", head: "A", target: "B", next: 1, pending: 1 }, { id: "R2", name: "a", head: "A" }]);
  gh({ repos: [{ id: "R2", name: "a", oid: "A" }] });
  const r = await b.runCheck("test");
  assert.ok(msgs(r).includes("gone left the listing before its new commits were reviewed (A → B)"), msgs(r));
  assert.equal(alerts(ctx).filter(a => a.id === "vanished:R1:B").length, 1);
});
await t("[audit F1] pending repo absent from an INCOMPLETE listing: kept pending, no vanish claim, no watermark", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "gone", head: "A", target: "B", next: 1, pending: 1 }]);
  gh({ repos: [], graphql: () => new Response(JSON.stringify({ errors: [{ message: "x" }] }), { status: 200 }) });
  const r = await b.runCheck("test");
  assert.equal(head(ctx, "R1").pending, 1); assert.ok(!msgs(r).includes("left the listing"), msgs(r)); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[audit F2] compare says total_commits 101 but sends 100 and no next link: stays pending, failed, no watermark", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }] });
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).includes("/compare/")
    ? new Response(JSON.stringify({ status: "ahead", total_commits: 101, commits: Array.from({ length: 100 }, (_, k) => C("t" + k)) }), { status: 200 })
    : orig(u, i);
  const r = await b.runCheck("test");
  assert.equal(head(ctx, "R1").pending, 1); assert.equal(head(ctx, "R1").head_sha, "A");
  assert.ok(msgs(r).includes("1 failed"), msgs(r)); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[re-audit 9634dc4] last page with MORE commits than total_commits (100 vs 1) is contradictory: stays pending", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }] });
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).includes("/compare/")
    ? new Response(JSON.stringify({ status: "ahead", total_commits: 1, commits: Array.from({ length: 100 }, (_, k) => C("m" + k)) }), { status: 200 })
    : orig(u, i);
  await b.runCheck("test");
  assert.equal(head(ctx, "R1").pending, 1); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[audit F2] compare without total_commits is a failure, not 'done'", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }] });
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).includes("/compare/") ? new Response(JSON.stringify({ status: "ahead", commits: [C("Z")] }), { status: 200 }) : orig(u, i);
  await b.runCheck("test"); assert.equal(head(ctx, "R1").pending, 1);
});
await t("[audit F3] multi-page diverged: the rewrite alert is returned once, not once per page", async () => {
  const { b } = await seeded([{ id: "R1", name: "a", head: "A" }], env({ SUBREQUEST_BUDGET: "30" }));
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }], compare: { "a:A...Z": { status: "diverged", commits: Array.from({ length: 201 }, (_, i) => C(i === 200 ? "Z" : "d" + i)) } } });
  const r = await b.runCheck("test");
  assert.equal(r.alerts.filter(a => a.id.startsWith("rewrite:")).length, 1);
});

await t("[audit 1e8cb56 HIGH] final compare page that doesn't end at the target: not done, stays pending", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "B" }], compare: { "a:A...B": { status: "ahead", commits: [C("X")] } } }); // total 1 == count 1, but X is not B
  await b.runCheck("test");
  assert.equal(head(ctx, "R1").pending, 1); assert.equal(head(ctx, "R1").head_sha, "A"); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[audit 1e8cb56 HIGH] page 2 repeats page 1 (count matches 200) but never reaches the target: not done", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }], env({ SUBREQUEST_BUDGET: "30", ALERT_THRESHOLD_FILES: "100000" }));
  const p1 = Array.from({ length: 100 }, (_, i) => C("r" + i));
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }], compare: { "a:A...Z": { status: "ahead", commits: p1.concat(p1) } } });
  await b.runCheck("test");
  assert.equal(head(ctx, "R1").pending, 1); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[audit 1e8cb56 HIGH] known-empty history whose first commit isn't the target: not done", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "T" }], history: { "a:T": [C("other")] } });
  await b.runCheck("test"); assert.equal(head(ctx, "R1").pending, 1);
});
for (const bad of ['"failed"', '{"message":"failed"}', '[{"message":"x"}]']) {
  await t(`[audit 1e8cb56 MEDIUM] GraphQL errors=${bad} alongside data = incomplete`, async () => {
    const { b, ctx } = await seeded([]);
    gh({ repos: [], graphql: () => new Response(`{"errors":${bad},"data":{"repositoryOwner":{"__typename":"User","repositories":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}`, { status: 200 }) });
    const r = await b.runCheck("test"); assert.ok(msgs(r).includes("GraphQL errors"), msgs(r)); assert.equal(meta(ctx, "last_check_ts"), undefined);
  });
}

await t("[swarm 6effb25 HIGH] diverged multi-page whose final page doesn't end at the target: not done", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }], env({ SUBREQUEST_BUDGET: "30", ALERT_THRESHOLD_FILES: "100000" }));
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }], compare: { "a:A...Z": { status: "diverged", commits: Array.from({ length: 150 }, (_, i) => C("w" + i)) } } });
  await b.runCheck("test");
  assert.equal(head(ctx, "R1").pending, 1); assert.equal(head(ctx, "R1").head_sha, "A"); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[swarm 6effb25 MEDIUM] empty final page on page 3 with total 200: not done (target unverified)", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A", target: "Z", next: 3, pending: 1 }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }] });
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).includes("/compare/") ? new Response(JSON.stringify({ status: "ahead", total_commits: 200, commits: [] }), { status: 200 }) : orig(u, i);
  await b.runCheck("test"); assert.equal(head(ctx, "R1").pending, 1);
});
await t("ahead with zero commits on page 1 (contradictory) is not done", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "Z" }], compare: { "a:A...Z": { status: "ahead", commits: [] } } });
  await b.runCheck("test"); assert.equal(head(ctx, "R1").pending, 1);
});

// ── listing completeness ──
await t("GraphQL 200 with errors = incomplete, no watermark", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  gh({ repos: [], graphql: () => new Response(JSON.stringify({ errors: [{ message: "x" }], data: null }), { status: 200 }) });
  const r = await b.runCheck("test");
  assert.ok(msgs(r).includes("GraphQL errors"), msgs(r)); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("missing pageInfo = incomplete", async () => {
  const { b } = await seeded([]);
  gh({ repos: [], graphql: () => new Response(JSON.stringify({ data: { repositoryOwner: { __typename: "User", repositories: { nodes: [] } } } }), { status: 200 }) });
  const r = await b.runCheck("test"); assert.ok(msgs(r).includes("unexpected response shape"), msgs(r));
});
await t("hasNextPage at the page budget = incomplete", async () => {
  const { b, ctx } = await seeded([], env({ SUBREQUEST_BUDGET: "4" }));
  gh({ repos: Array.from({ length: 5 }, (_, i) => ({ id: "R" + i, name: "r" + i, oid: "h" })), gqlPageSize: 1 });
  const r = await b.runCheck("test");
  assert.ok(msgs(r).includes("page budget reached"), msgs(r)); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[Codex 14] duplicate node across pages = incomplete, no double processing", async () => {
  const { b } = await seeded([]);
  gh({ repos: [{ id: "R1", name: "a", oid: "A" }, { id: "R2", name: "b", oid: "B" }, { id: "R2", name: "b", oid: "B" }], gqlPageSize: 2 });
  const r = await b.runCheck("test"); assert.ok(msgs(r).includes("duplicate node"), msgs(r));
});
await t("[Codex 12] listing is ordered by CREATED_AT ascending (new repos append, earlier pages don't shift)", async () => {
  const { b } = await seeded([]);
  let q = ""; gh({ repos: [], graphql: () => null });
  const orig = globalThis.fetch; globalThis.fetch = async (u, i) => { if (String(u).endsWith("/graphql")) q = JSON.parse(i.body).query; return orig(u, i); };
  await b.runCheck("test"); assert.ok(q.includes("orderBy:{field:CREATED_AT,direction:ASC}"), q);
});

await t("[swarm HIGH] owner is a User account: query uses repositoryOwner (not organization) with ownerAffiliations OWNER", async () => {
  const { b } = await seeded([]);
  let q = ""; gh({ repos: [] });
  const orig = globalThis.fetch; globalThis.fetch = async (u, i) => { if (String(u).endsWith("/graphql")) q = JSON.parse(i.body).query; return orig(u, i); };
  await b.runCheck("test");
  assert.ok(q.includes("repositoryOwner(login:$org)") && !q.includes("organization("), q); assert.ok(q.includes("ownerAffiliations:[OWNER]"), q);
});
await t("[swarm HIGH] GitHub's real not-found shape (null owner + errors) = incomplete, no watermark", async () => {
  const { b, ctx } = await seeded([]);
  gh({ repos: [], graphql: () => new Response(JSON.stringify({ data: { repositoryOwner: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] }), { status: 200 }) });
  const r = await b.runCheck("test"); assert.ok(msgs(r).includes("head listing INCOMPLETE"), msgs(r)); assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[swarm LOW] errors: [] is not treated as a failure", async () => {
  const { b, ctx } = await seeded([]);
  gh({ repos: [], graphql: () => new Response(JSON.stringify({ errors: [], data: { repositoryOwner: { __typename: "User", repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }), { status: 200 }) });
  await b.runCheck("test"); assert.ok(meta(ctx, "last_check_ts"));
});

// ── kept from the pre-NOR-259 suite (bridge + budget) ──
await t("budget caps EVERY subrequest, bridge + registry included", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: "R" + i, name: "r" + i, head: "A" }));
  const { b } = await seeded(rows, env({ SUBREQUEST_BUDGET: "10" }));
  const calls = gh({ repos: rows.map(r => ({ id: r.id, name: r.name, oid: "B" })), compare: Object.fromEntries(rows.map(r => [`${r.name}:A...B`, { status: "ahead", commits: [C("B")] }])) });
  await b.runCheck("test");
  assert.ok(calls.length <= 10, `made ${calls.length} calls on budget 10`); assert.ok(calls.some(c => c.includes("/bridge/commits")));
});
await t("budget below the reserve is rejected loudly and falls back", async () => {
  const { b } = await seeded([], env({ SUBREQUEST_BUDGET: "2" })); gh({ repos: [] });
  const r = await b.runCheck("test"); assert.ok(msgs(r).includes('SUBREQUEST_BUDGET "2" invalid'), msgs(r));
});
await t("empty bridge commit list alerts", async () => {
  const { b } = await seeded([]); gh({ repos: [], bridge: [] });
  const r = await b.runCheck("test"); assert.ok(msgs(r).includes("Fleet-bridge check returned no commits"), msgs(r));
});
for (const bad of ["2026-02-30T00:00:00Z", "", "not-a-date", "2026-11-08", "2099-01-01T00:00:00Z"]) {
  await t(`impossible/missing/future bridge date alerts: ${JSON.stringify(bad)}`, async () => {
    const { b } = await seeded([]); gh({ repos: [], bridge: [{ commit: { author: { date: bad } } }] });
    const r = await b.runCheck("test"); assert.ok(msgs(r).includes("no readable date"), msgs(r));
  });
}
await t("stale bridge still alerts with hours", async () => {
  const { b } = await seeded([]); gh({ repos: [], bridge: [{ commit: { author: { date: isoAgo(30) } } }] });
  const r = await b.runCheck("test"); assert.ok(msgs(r).includes("not been updated in 30 hours"), msgs(r));
});
await t("a failed detail check is alert-only: commit still counted, head still advances", async () => {
  const { b, ctx } = await seeded([{ id: "R1", name: "a", head: "A" }]);
  gh({ repos: [{ id: "R1", name: "a", oid: "B" }], compare: { "a:A...B": { status: "ahead", commits: [C("B")] } }, detailFail: true });
  const r = await b.runCheck("test");
  assert.equal(head(ctx, "R1").head_sha, "B"); assert.ok(msgs(r).includes("1 commit detail(s) failed"), msgs(r));
});

// ── NOR-259 reopen (11-11): transient gateway errors on the listing, and the hourly registry 404 ──
const gqlCount = calls => calls.filter(c => c.endsWith("/graphql")).length;
await t("[reopen] one 502 on the listing is retried: listing completes, no incomplete alert, watermark advances", async () => {
  const { b, ctx } = await seeded([], env({ LISTING_RETRY_BASE_MS: "0" }));
  let n = 0; const calls = gh({ repos: [{ id: "R1", name: "a", oid: "A" }], graphql: () => (++n === 1 ? new Response("bad gateway", { status: 502 }) : null) });
  const r = await b.runCheck("test");
  assert.ok(!msgs(r).includes("incomplete") && !msgs(r).includes("INCOMPLETE"), msgs(r));
  assert.equal(gqlCount(calls), 2); assert.ok(meta(ctx, "last_check_ts"));
});
await t("[reopen] a 504 that persists stays incomplete after 2 retries (3 calls), no watermark", async () => {
  const { b, ctx } = await seeded([], env({ LISTING_RETRY_BASE_MS: "0" }));
  const calls = gh({ repos: [{ id: "R1", name: "a", oid: "A" }], graphql: () => new Response("timeout", { status: 504 }) });
  const r = await b.runCheck("test");
  assert.ok(msgs(r).includes("HTTP 504 after 2 retries"), msgs(r)); assert.equal(gqlCount(calls), 3);
  assert.equal(meta(ctx, "last_check_ts"), undefined);
});
await t("[reopen] a thrown fetch on the listing is retried the same way", async () => {
  const { b, ctx } = await seeded([], env({ LISTING_RETRY_BASE_MS: "0" }));
  let n = 0; gh({ repos: [{ id: "R1", name: "a", oid: "A" }], graphql: () => { if (++n === 1) throw new Error("reset"); return null; } });
  await b.runCheck("test"); assert.ok(meta(ctx, "last_check_ts"));
});
await t("[reopen] a non-gateway error (401) is NOT retried", async () => {
  const { b } = await seeded([], env({ LISTING_RETRY_BASE_MS: "0" }));
  const calls = gh({ repos: [], graphql: () => new Response("unauthorized", { status: 401 }) });
  const r = await b.runCheck("test"); assert.equal(gqlCount(calls), 1); assert.ok(msgs(r).includes("HTTP 401"), msgs(r));
});
await t("[reopen] retries count against the subrequest budget (budget caps every call)", async () => {
  const { b } = await seeded([], env({ LISTING_RETRY_BASE_MS: "0", SUBREQUEST_BUDGET: "4" }));
  const calls = gh({ repos: [{ id: "R1", name: "a", oid: "A" }], graphql: () => new Response("x", { status: 502 }) });
  const r = await b.runCheck("test");
  assert.ok(calls.length <= 4, `made ${calls.length} calls on budget 4`); assert.ok(msgs(r).includes("incomplete"), msgs(r));
});
await t("[reopen] registry 404 (no file today) raises no alert; a registry 500 still warns", async () => {
  const { b } = await seeded([]); gh({ repos: [] });
  const r1 = await b.runCheck("test"); assert.ok(!msgs(r1).includes("Registry check"), msgs(r1));
  const { b: b2 } = await seeded([]); gh({ repos: [] });
  const orig = globalThis.fetch; globalThis.fetch = async (u, i) => (new URL(String(u)).host === "raw.githubusercontent.com" ? new Response("x", { status: 500 }) : orig(u, i));
  const r2 = await b2.runCheck("test"); assert.ok(msgs(r2).includes("Registry check got HTTP 500"), msgs(r2));
});

for (const l of res) console.log(l);
const f = res.filter(l => l.startsWith("FAIL")).length;
console.log(`runcheck: ${res.length - f}/${res.length} passed`);
process.exit(f ? 1 : 0);
