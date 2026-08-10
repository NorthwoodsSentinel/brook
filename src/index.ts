/**
 * NEVERSINK — Persistent Awareness Layer
 *
 * Evolved from Brook (Fleet Overwatch).
 * A full-stream cognitive substrate on Cloudflare.
 *
 * Holds: structured context events across session boundaries
 * Monitors: GitHub repos, fleet health, agent drift
 * Briefs: agents at session start with full-fidelity context
 *
 * "The stream that never goes dry."
 */

import { DurableObject } from "cloudflare:workers";

interface Env {
  BROOK: DurableObjectNamespace;
  GITHUB_TOKEN: string;
  BROOK_API_KEY: string;
  GITHUB_ORG: string;
  FLEET_BRIDGE_REPO: string;
  ALERT_THRESHOLD_COMMITS: string;
  ALERT_THRESHOLD_FILES: string;
  ALERT_THRESHOLD_REPOS: string;
  NTFY_TOPIC: string;
}

// Public endpoints — no auth required
const PUBLIC_PATHS = new Set(["/", "/daemon"]);

interface Alert {
  id: string;
  ts: string;
  type: "git" | "drift" | "fragmentation" | "volume" | "new_repo";
  severity: "info" | "warn" | "critical";
  message: string;
  read: boolean;
}

// Valid context categories
const VALID_CATEGORIES = new Set([
  "work", "decision", "insight", "meaningful", "thread_open",
  "thread_closed", "artifact", "fire", "cross_ai", "anomaly", "somatic"
]);

// ─── Durable Object: Neversink ──────────────────────────────────

export class Brook extends DurableObject<Env> {

  async init() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        read INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS repos (
        name TEXT PRIMARY KEY,
        last_commit_sha TEXT,
        last_checked TEXT,
        is_private INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        trigger TEXT NOT NULL,
        repos_checked INTEGER DEFAULT 0,
        alerts_generated INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        status TEXT DEFAULT 'offline',
        last_checkin TEXT,
        last_checkout TEXT,
        working_on TEXT,
        machine TEXT,
        context TEXT DEFAULT '',
        capabilities TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS agent_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        ts TEXT NOT NULL,
        what TEXT NOT NULL,
        location TEXT DEFAULT '',
        status TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS context_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT '',
        agent TEXT NOT NULL,
        ts TEXT NOT NULL,
        category TEXT NOT NULL,
        weight INTEGER DEFAULT 5,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT DEFAULT '',
        thread TEXT DEFAULT '',
        expires TEXT DEFAULT ''
      );
    `);
    // Migrate existing tables if needed
    try { this.ctx.storage.sql.exec(`ALTER TABLE agents ADD COLUMN context TEXT DEFAULT ''`); } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE agents ADD COLUMN capabilities TEXT DEFAULT ''`); } catch {}
    // Indexes for context_log
    try { this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_ts ON context_log(ts DESC)`); } catch {}
    try { this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_category ON context_log(category)`); } catch {}
    try { this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_thread ON context_log(thread)`); } catch {}
    try { this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_weight ON context_log(weight DESC)`); } catch {}
    try { this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_agent ON context_log(agent)`); } catch {}
  }

  // ═══════════════════════════════════════════════════════════════
  // NEVERSINK CONTEXT LAYER
  // ═══════════════════════════════════════════════════════════════

  // ─── POST /context — Write context events ─────────────────────

  private async handleContextWrite(request: Request): Promise<Response> {
    const body = await request.json() as any;
    const agent = body.agent;
    const sessionId = body.session_id || "";
    const events = body.events;

    if (!agent) {
      return Response.json({ error: "agent required" }, { status: 400 });
    }

    // Single event or batch
    const eventList = events ? events : [body];

    let written = 0;
    for (const evt of eventList) {
      const category = evt.category;
      const weight = Math.min(10, Math.max(1, parseInt(evt.weight) || 5));
      const title = evt.title;
      const eventBody = evt.body;

      if (!category || !title || !eventBody) continue;
      if (!VALID_CATEGORIES.has(category)) continue;

      this.ctx.storage.sql.exec(
        `INSERT INTO context_log (session_id, agent, ts, category, weight, title, body, tags, thread, expires)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sessionId, agent, new Date().toISOString(), category, weight,
        title, eventBody, evt.tags || "", evt.thread || "", evt.expires || ""
      );
      written++;
    }

    return Response.json({ ok: true, agent, written });
  }

  // ─── GET /briefing — Session startup briefing ─────────────────

  private handleBriefing(url: URL): Response {
    const agent = url.searchParams.get("agent") || "all";
    const full = url.searchParams.get("full") === "true";
    const thread = url.searchParams.get("thread") || "";
    const since = url.searchParams.get("since") || "";
    const now = new Date();

    // Find last checkout for this agent to determine "since last session"
    let sinceTs = since;
    if (!sinceTs && agent !== "all") {
      const agentRow = this.ctx.storage.sql.exec(
        "SELECT last_checkout FROM agents WHERE name = ?", agent
      ).toArray();
      if (agentRow.length > 0 && (agentRow[0] as any).last_checkout) {
        sinceTs = (agentRow[0] as any).last_checkout;
      }
    }
    if (!sinceTs) {
      // Default: last 48 hours
      sinceTs = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    }

    // Time since last checkin
    let sinceDuration = "";
    if (sinceTs) {
      const diffMs = now.getTime() - new Date(sinceTs).getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      sinceDuration = `${hours}h ${mins}m`;
    }

    // 1. Fires — active, not expired, weight >= 7
    const fires = this.ctx.storage.sql.exec(
      `SELECT * FROM context_log
       WHERE category = 'fire'
       AND (expires = '' OR expires > ?)
       AND weight >= 7
       ORDER BY weight DESC, ts DESC
       LIMIT 10`,
      now.toISOString()
    ).toArray();

    // 2. Sentinel alerts — unread alerts from the alerts table
    const sentinelAlerts = this.ctx.storage.sql.exec(
      "SELECT * FROM alerts WHERE read = 0 ORDER BY ts DESC LIMIT 10"
    ).toArray();

    // 3. High-weight context (7+) from last 7 days
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const highWeight = this.ctx.storage.sql.exec(
      `SELECT * FROM context_log
       WHERE weight >= 7 AND ts > ?
       ORDER BY weight DESC, ts DESC
       LIMIT 20`,
      sevenDaysAgo
    ).toArray();

    // 4. Open threads
    const openThreads = this.ctx.storage.sql.exec(
      `SELECT * FROM context_log
       WHERE category = 'thread_open'
       AND title NOT IN (
         SELECT title FROM context_log WHERE category = 'thread_closed'
       )
       ORDER BY weight DESC, ts DESC
       LIMIT 20`
    ).toArray();

    // 5. Recent context since last checkout (or 48h)
    let recentContext;
    if (thread) {
      recentContext = this.ctx.storage.sql.exec(
        `SELECT * FROM context_log
         WHERE thread = ? AND ts > ?
         ORDER BY ts DESC
         LIMIT 50`,
        thread, sinceTs
      ).toArray();
    } else if (full) {
      recentContext = this.ctx.storage.sql.exec(
        `SELECT * FROM context_log
         WHERE ts > ?
         ORDER BY ts DESC
         LIMIT 100`,
        sinceTs
      ).toArray();
    } else {
      // Default: title + tags + category for lower weight, full body for weight >= 7
      recentContext = this.ctx.storage.sql.exec(
        `SELECT id, session_id, agent, ts, category, weight, title,
         CASE WHEN weight >= 7 THEN body ELSE '' END as body,
         tags, thread
         FROM context_log
         WHERE ts > ?
         ORDER BY ts DESC
         LIMIT 50`,
        sinceTs
      ).toArray();
    }

    // 6. Fleet status
    const fleetStatus = this.ctx.storage.sql.exec(
      "SELECT name, status, last_checkin, last_checkout, working_on, machine FROM agents ORDER BY last_checkin DESC"
    ).toArray().map((a: any) => {
      const lc = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
      const hrs = Math.round(((now.getTime() - lc) / (1000 * 60 * 60)) * 10) / 10;
      let ds = a.status;
      if (ds === "online" && hrs > 2) ds = "stale";
      return { ...a, displayStatus: ds, hoursSinceCheckin: hrs };
    });

    return Response.json({
      neversink: "1.0.0",
      briefing_for: agent,
      since_last_session: sinceDuration,
      generated: now.toISOString(),
      fires,
      sentinel_alerts: sentinelAlerts,
      high_weight: highWeight,
      open_threads: openThreads,
      recent_context: recentContext,
      fleet: fleetStatus,
    });
  }

  // ─── GET /context/search — Query context by thread, tag, date ──

  private handleContextSearch(url: URL): Response {
    const thread = url.searchParams.get("thread") || "";
    const tag = url.searchParams.get("tag") || "";
    const category = url.searchParams.get("category") || "";
    const agent = url.searchParams.get("agent") || "";
    const since = url.searchParams.get("since") || "";
    const minWeight = parseInt(url.searchParams.get("min_weight") || "1");
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50"));

    let query = "SELECT * FROM context_log WHERE 1=1";
    const params: any[] = [];

    if (thread) { query += " AND thread = ?"; params.push(thread); }
    if (tag) { query += " AND tags LIKE ?"; params.push(`%${tag}%`); }
    if (category) { query += " AND category = ?"; params.push(category); }
    if (agent) { query += " AND agent = ?"; params.push(agent); }
    if (since) { query += " AND ts > ?"; params.push(since); }
    if (minWeight > 1) { query += " AND weight >= ?"; params.push(minWeight); }

    query += " ORDER BY ts DESC LIMIT ?";
    params.push(limit);

    const rows = this.ctx.storage.sql.exec(query, ...params).toArray();
    return Response.json({ results: rows, count: rows.length });
  }

  // ─── Context decay — clean up expired low-weight events ────────

  private runContextDecay() {
    const now = new Date().toISOString();

    // Remove expired fire events
    this.ctx.storage.sql.exec(
      "DELETE FROM context_log WHERE category = 'fire' AND expires != '' AND expires < ?",
      now
    );

    // Decay by weight and age
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Weight 1-3: keep 7 days
    this.ctx.storage.sql.exec(
      "DELETE FROM context_log WHERE weight <= 3 AND ts < ?",
      sevenDaysAgo
    );

    // Weight 4-6: keep 30 days
    this.ctx.storage.sql.exec(
      "DELETE FROM context_log WHERE weight BETWEEN 4 AND 6 AND ts < ?",
      thirtyDaysAgo
    );

    // Weight 7-8: keep 90 days
    this.ctx.storage.sql.exec(
      "DELETE FROM context_log WHERE weight BETWEEN 7 AND 8 AND ts < ?",
      ninetyDaysAgo
    );

    // Weight 9-10: permanent — never deleted
  }

  // ═══════════════════════════════════════════════════════════════
  // ORIGINAL BROOK FUNCTIONALITY (preserved)
  // ═══════════════════════════════════════════════════════════════

  // ─── Core check loop ──────────────────────────────────────────

  async runCheck(trigger: string): Promise<{ alerts: Alert[]; summary: string }> {
    await this.init();
    const start = Date.now();
    const newAlerts: Alert[] = [];
    const org = this.env.GITHUB_ORG;
    const token = this.env.GITHUB_TOKEN;

    // Run context decay on each check cycle
    this.runContextDecay();

    const headers: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "User-Agent": "neversink/1.0",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let repos: any[] = [];
    let repoFetchOk = false;
    let lastStatus = 0;
    try {
      let res = await fetch(`https://api.github.com/orgs/${org}/repos?per_page=100&sort=updated`, { headers });
      lastStatus = res.status;
      if (res.ok) {
        repos = await res.json() as any[];
        repoFetchOk = true;
      } else {
        res = await fetch(`https://api.github.com/user/repos?per_page=100&sort=updated&type=all`, { headers });
        lastStatus = res.status;
        if (res.ok) {
          const allRepos = await res.json() as any[];
          repos = allRepos.filter((r: any) => r.full_name?.startsWith(`${org}/`));
          repoFetchOk = true;
        }
      }
    } catch (e) {
      newAlerts.push(this.makeAlert("git", "warn", `GitHub API call failed: ${e}`));
    }

    // An HTTP error status is not a thrown exception, so a dead GITHUB_TOKEN
    // left repos=[] -> zero new repos -> zero alerts -> a check that recorded
    // success. Brook ran blind from 2026-06-22 to 2026-08-05 reporting "awake".
    // A failed fetch must never be indistinguishable from "nothing changed".
    if (!repoFetchOk) {
      newAlerts.push(this.makeAlert("git", "critical",
        `GitHub repo fetch FAILED (HTTP ${lastStatus}) for org "${org}". Brook is BLIND, not quiet — every downstream check this cycle is meaningless. Check GITHUB_TOKEN.`));
    }

    const knownRepos = new Set<string>();
    const cursor = this.ctx.storage.sql.exec("SELECT name FROM repos");
    for (const row of cursor) {
      knownRepos.add(row.name as string);
    }

    const newRepos = repos.filter(r => !knownRepos.has(r.name));
    if (newRepos.length > parseInt(this.env.ALERT_THRESHOLD_REPOS || "2")) {
      newAlerts.push(this.makeAlert("new_repo", "critical",
        `${newRepos.length} new repos created: ${newRepos.map((r: any) => r.name).join(", ")}`));
    } else if (newRepos.length > 0) {
      newAlerts.push(this.makeAlert("new_repo", "info",
        `New repo(s): ${newRepos.map((r: any) => r.name).join(", ")}`));
    }

    let totalNewCommits = 0;
    const lastCheck = this.getMeta("last_check_ts") || new Date(Date.now() - 3600000).toISOString();

    for (const repo of repos) {
      try {
        const commitsRes = await fetch(
          `https://api.github.com/repos/${org}/${repo.name}/commits?since=${lastCheck}&per_page=50`,
          { headers }
        );
        if (!commitsRes.ok) continue;
        const commits = await commitsRes.json() as any[];

        if (commits.length > 0) {
          totalNewCommits += commits.length;

          for (const commit of commits.slice(0, 5)) {
            try {
              const detailRes = await fetch(
                `https://api.github.com/repos/${org}/${repo.name}/commits/${commit.sha}`,
                { headers }
              );
              if (detailRes.ok) {
                const detail = await detailRes.json() as any;
                if (detail.stats && detail.stats.total > parseInt(this.env.ALERT_THRESHOLD_FILES || "100")) {
                  newAlerts.push(this.makeAlert("volume", "warn",
                    `Large commit in ${repo.name}: ${detail.stats.total} changes — "${commit.commit.message.split('\n')[0]}"`));
                }
              }
            } catch {}
          }

          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO repos (name, last_commit_sha, last_checked, is_private)
             VALUES (?, ?, ?, ?)`,
            repo.name, commits[0].sha, new Date().toISOString(), repo.private ? 1 : 0
          );
        } else {
          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO repos (name, last_commit_sha, last_checked, is_private)
             VALUES (?, COALESCE((SELECT last_commit_sha FROM repos WHERE name = ?), ''), ?, ?)`,
            repo.name, repo.name, new Date().toISOString(), repo.private ? 1 : 0
          );
        }
      } catch {}
    }

    if (totalNewCommits > parseInt(this.env.ALERT_THRESHOLD_COMMITS || "20")) {
      newAlerts.push(this.makeAlert("volume", "critical",
        `High volume: ${totalNewCommits} commits across org since last check`));
    }

    // Fleet-bridge check
    try {
      const bridgeRes = await fetch(
        `https://api.github.com/repos/${org}/${this.env.FLEET_BRIDGE_REPO}/commits?per_page=5`,
        { headers }
      );
      if (bridgeRes.ok) {
        const bridgeCommits = await bridgeRes.json() as any[];
        if (bridgeCommits.length > 0) {
          const lastBridgeUpdate = new Date(bridgeCommits[0].commit.author.date);
          const hoursSinceUpdate = (Date.now() - lastBridgeUpdate.getTime()) / (1000 * 60 * 60);

          if (hoursSinceUpdate > 24) {
            newAlerts.push(this.makeAlert("drift", "warn",
              `Fleet-bridge has not been updated in ${Math.round(hoursSinceUpdate)} hours. Agents may be going dark.`));
          }
        }
      }
    } catch (e) {
      newAlerts.push(this.makeAlert("drift", "info", `Could not check fleet-bridge: ${e}`));
    }

    // Fragmentation check
    try {
      const regRes = await fetch(
        `https://raw.githubusercontent.com/${org}/${this.env.FLEET_BRIDGE_REPO}/main/registry/2026-03-24.md`,
        { headers }
      );
      if (regRes.ok) {
        const regText = await regRes.text();
        const lines = regText.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Time'));
        const topicAgentMap = new Map<string, Set<string>>();
        for (const line of lines) {
          const cols = line.split('|').map(c => c.trim()).filter(c => c);
          if (cols.length >= 3) {
            const agent = cols[1]?.toLowerCase();
            const what = cols[2]?.toLowerCase();
            if (agent && what) {
              const keywords = what.split(/\s+/).filter(w => w.length > 4);
              for (const kw of keywords) {
                if (!topicAgentMap.has(kw)) topicAgentMap.set(kw, new Set());
                topicAgentMap.get(kw)!.add(agent);
              }
            }
          }
        }
        for (const [topic, agents] of topicAgentMap) {
          if (agents.size > 1 && !['approved', 'moser', 'archie', 'ceecee', 'fleet', 'bridge'].includes(topic)) {
            this.setMeta(`frag_${topic}`, Array.from(agents).join(','));
          }
        }
      }
    } catch {}

    // Store and sleep
    const duration = Date.now() - start;

    // Go LOOK at the always-on workers instead of waiting to be told. A
    // check-in is self-attestation: it only arrives if the watched party is
    // both alive AND remembers to report, so a worker that is perfectly healthy
    // but has no heartbeat code reads identically to a dead one. appsec-gate
    // and finops-do sat "stale" from 2026-06-27 while both were serving 200 the
    // whole time. Polling does not depend on the observed party's cooperation.
    // Instances with no public endpoint (Margin/CeeCee/Caddie) still must check
    // in — they cannot be reached — so the two mechanisms are complementary.
    await this.pollFleetEndpoints(newAlerts);

    // Dedup: an unresolved condition re-alerted every hour with a fresh id, so
    // one stuck condition became hundreds of unread rows (1550 by 2026-08-05,
    // dominated by two repeating messages). A pile that large is unreadable, and
    // an unreadable alert surface is the same as no alert surface. If an
    // identical unread alert (same type+message) already exists, refresh its
    // timestamp instead of stacking a duplicate.
    for (const alert of newAlerts) {
      const dupe = [...this.ctx.storage.sql.exec(
        "SELECT id FROM alerts WHERE read = 0 AND type = ? AND message = ? LIMIT 1",
        alert.type, alert.message
      )];
      if (dupe.length > 0) {
        this.ctx.storage.sql.exec("UPDATE alerts SET ts = ? WHERE id = ?", alert.ts, (dupe[0] as any).id);
        continue;
      }
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO alerts (id, ts, type, severity, message, read) VALUES (?, ?, ?, ?, ?, 0)`,
        alert.id, alert.ts, alert.type, alert.severity, alert.message
      );
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO checks (ts, trigger, repos_checked, alerts_generated, duration_ms)
       VALUES (?, ?, ?, ?, ?)`,
      new Date().toISOString(), trigger, repos.length, newAlerts.length, duration
    );

    this.setMeta("last_check_ts", new Date().toISOString());
    this.setMeta("total_checks", String(parseInt(this.getMeta("total_checks") || "0") + 1));

    // Push summary to phone (batched, not per-alert)
    if (newAlerts.length > 0) {
      const critical = newAlerts.filter(a => a.severity === "critical");
      const warns = newAlerts.filter(a => a.severity === "warn");
      const lines: string[] = [];
      if (critical.length > 0) {
        lines.push(`CRITICAL (${critical.length}):`);
        for (const a of critical.slice(0, 3)) lines.push(`  ${a.message.slice(0, 120)}`);
      }
      if (warns.length > 0) {
        lines.push(`WARN (${warns.length}):`);
        for (const a of warns.slice(0, 3)) lines.push(`  ${a.message.slice(0, 120)}`);
        if (warns.length > 3) lines.push(`  ...and ${warns.length - 3} more`);
      }
      const priority = critical.length > 0 ? 5 : 4;
      const tags = critical.length > 0 ? "rotating_light" : "warning";
      await this.sendPush(
        `Neversink: ${newAlerts.length} alerts`,
        lines.join("\n"),
        priority,
        tags
      );
    }

    // Push active fires as reminders (one batched message)
    await this.pushActiveFires();

    const summary = [
      `Neversink check complete (${trigger}, ${duration}ms)`,
      `Repos: ${repos.length} checked, ${newRepos.length} new`,
      `Commits: ${totalNewCommits} since last check`,
      `Alerts: ${newAlerts.length} generated`,
    ].join('\n');

    return { alerts: newAlerts, summary };
  }

  // ─── HTTP handler ─────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    await this.init();
    const url = new URL(request.url);
    const path = url.pathname;

    // ─── Public endpoints ─────────────────────────────────────
    if (path === "/daemon") {
      return this.handleDaemon();
    }
    if (path.startsWith("/daemon/")) {
      const agentName = path.split("/")[2];
      if (agentName) return this.handleAgentDaemon(agentName);
    }

    // ─── Auth gate for private endpoints ──────────────────────
    if (!PUBLIC_PATHS.has(path)) {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      if (!this.env.BROOK_API_KEY || token !== this.env.BROOK_API_KEY) {
        return Response.json(
          { error: "Unauthorized. Bearer token required for private endpoints." },
          { status: 401 }
        );
      }
    }

    // ─── Neversink context endpoints ─────────────────────────
    if (path === "/context" && request.method === "POST") {
      return this.handleContextWrite(request);
    }
    if (path === "/briefing") {
      return this.handleBriefing(url);
    }
    if (path === "/context/search") {
      return this.handleContextSearch(url);
    }

    // ─── Original Brook endpoints ────────────────────────────
    if (path === "/status") {
      return this.handleStatus();
    }
    if (path === "/check") {
      const result = await this.runCheck("manual");
      return Response.json(result);
    }
    if (path === "/alerts") {
      return this.handleAlerts(url);
    }
    if (path === "/silence") {
      const id = url.searchParams.get("id");
      if (id) {
        this.ctx.storage.sql.exec("UPDATE alerts SET read = 1 WHERE id = ?", id);
        return Response.json({ ok: true });
      }
      // Bulk-clear by age. Silencing 1550 rows one id at a time is not a
      // cleanup path, so the pile just stayed. `?before=<ISO>` marks everything
      // older than that timestamp read, leaving current alerts untouched.
      const before = url.searchParams.get("before");
      if (before) {
        const n = [...this.ctx.storage.sql.exec("SELECT COUNT(*) AS c FROM alerts WHERE read = 0 AND ts < ?", before)];
        this.ctx.storage.sql.exec("UPDATE alerts SET read = 1 WHERE read = 0 AND ts < ?", before);
        return Response.json({ ok: true, silenced: (n[0] as any)?.c ?? 0, before });
      }
      return Response.json({ error: "id or before required" }, { status: 400 });
    }
    if (path === "/webhook") {
      const result = await this.runCheck("webhook");
      return Response.json(result);
    }
    if (path === "/checkin" && request.method === "POST") {
      return this.handleCheckin(request);
    }
    if (path === "/checkout" && request.method === "POST") {
      return this.handleCheckout(request);
    }
    if (path === "/agent/remove" && request.method === "POST") {
      const body: { name: string } = await request.json();
      if (!body.name) return Response.json({ error: "name required" }, { status: 400 });
      this.ctx.storage.sql.exec("DELETE FROM agents WHERE name = ?", body.name);
      return Response.json({ ok: true, removed: body.name });
    }
    if (path === "/fleet") {
      return this.handleFleet();
    }
    if (path === "/publish" && request.method === "POST") {
      return this.handlePublish(request);
    }
    if (path.startsWith("/agent/")) {
      const agentName = path.split("/")[2];
      if (agentName) return this.handleAgentQuery(agentName);
    }
    if (path === "/history") {
      const rows = this.ctx.storage.sql.exec(
        "SELECT * FROM checks ORDER BY ts DESC LIMIT 24"
      ).toArray();
      return Response.json(rows);
    }

    return Response.json({
      name: "Neversink — Persistent Awareness Layer",
      version: "1.0.0",
      evolved_from: "Brook (Fleet Overwatch)",
      public: ["/daemon"],
      context: ["/context (POST)", "/briefing (GET)", "/context/search (GET)"],
      fleet: ["/checkin (POST)", "/checkout (POST)", "/fleet", "/agent/:name", "/publish (POST)"],
      monitoring: ["/status", "/check", "/alerts", "/silence?id=X", "/webhook", "/history"],
      auth: "Bearer token required for private endpoints",
    });
  }

  // ─── Cron handler ─────────────────────────────────────────────

  async alarm() {
    await this.runCheck("cron");
  }

  // ─── Fleet agent tracking ──────────────────────────────────────

  /**
   * Active liveness: probe each publicly-reachable fleet worker's /health.
   * Presence is recorded with presence_source='polled' so an observation Brook
   * made itself is never confused with an agent's self-report.
   */
  private async pollFleetEndpoints(newAlerts: Alert[]): Promise<void> {
    // Additive migration; SQLite has no ADD COLUMN IF NOT EXISTS.
    try {
      this.ctx.storage.sql.exec("ALTER TABLE agents ADD COLUMN presence_source TEXT DEFAULT 'checkin'");
    } catch { /* already present */ }

    const targets: Array<{ name: string; url: string; machine: string; note: string }> = [
      { name: "appsec-gate", url: "https://appsec-gate.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "PR-diff security review, fails closed" },
      { name: "finops-do", url: "https://finops-do.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "daily AI Gateway spend ceiling + reconciliation" },
      { name: "daemon", url: "https://daemon.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "Big Head Todd — canonical context store" },
      { name: "mycelia-api", url: "https://mycelia-api.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "fleet mutual-aid protocol" },
      { name: "bivouac", url: "https://bivouac.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "overnight autonomous coding agent" },
      { name: "sa-dashboard-kit", url: "https://sa-dashboard-kit.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "public SA observability kit" },
    ];

    const now = new Date().toISOString();
    for (const t of targets) {
      let ok = false;
      let detail = "";
      try {
        const res = await fetch(t.url, { method: "GET" });
        ok = res.ok;
        detail = `HTTP ${res.status}`;
      } catch (e) {
        detail = `unreachable: ${e}`;
      }

      if (ok) {
        this.ctx.storage.sql.exec(
          `INSERT INTO agents (name, status, last_checkin, working_on, machine, context, capabilities, presence_source)
           VALUES (?, 'online', ?, ?, ?, '', '', 'polled')
           ON CONFLICT(name) DO UPDATE SET
             status = 'online',
             last_checkin = excluded.last_checkin,
             machine = excluded.machine,
             presence_source = 'polled'`,
          t.name, now, t.note, t.machine
        );
      } else {
        // Only alert for something we have seen alive before — an endpoint that
        // never existed is a config question, not an outage.
        const known = [...this.ctx.storage.sql.exec("SELECT name FROM agents WHERE name = ?", t.name)];
        if (known.length > 0) {
          this.ctx.storage.sql.exec("UPDATE agents SET status = 'offline' WHERE name = ?", t.name);
          newAlerts.push(this.makeAlert("fleet", "critical",
            `${t.name} health probe FAILED (${detail}) — previously reachable, now down.`));
        }
      }
    }
  }

  private async handleCheckin(request: Request): Promise<Response> {
    const body = await request.json() as any;
    const name = body.name;
    const machine = body.machine || "unknown";
    const workingOn = body.working_on || "";
    const context = body.context || "";
    const capabilities = body.capabilities || "";

    if (!name) return Response.json({ error: "name required" }, { status: 400 });

    this.ctx.storage.sql.exec(
      `INSERT INTO agents (name, status, last_checkin, working_on, machine, context, capabilities)
       VALUES (?, 'online', ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         status = 'online',
         last_checkin = excluded.last_checkin,
         working_on = excluded.working_on,
         machine = excluded.machine,
         context = CASE WHEN excluded.context != '' THEN excluded.context ELSE agents.context END,
         capabilities = CASE WHEN excluded.capabilities != '' THEN excluded.capabilities ELSE agents.capabilities END`,
      name, new Date().toISOString(), workingOn, machine, context, capabilities
    );

    return Response.json({ ok: true, agent: name, status: "online" });
  }

  private async handlePublish(request: Request): Promise<Response> {
    const body = await request.json() as any;
    const agent = body.agent;
    const items = body.items;

    if (!agent || !items || !Array.isArray(items)) {
      return Response.json({ error: "agent and items[] required" }, { status: 400 });
    }

    const ts = new Date().toISOString();
    for (const item of items) {
      this.ctx.storage.sql.exec(
        `INSERT INTO agent_registry (agent, ts, what, location, status)
         VALUES (?, ?, ?, ?, ?)`,
        agent, ts, item.what || "", item.location || "", item.status || ""
      );
    }

    return Response.json({ ok: true, agent, published: items.length });
  }

  private handleAgentQuery(name: string): Response {
    const agent = this.ctx.storage.sql.exec(
      "SELECT * FROM agents WHERE name = ?", name
    ).toArray();

    if (agent.length === 0) {
      return Response.json({ error: `Agent '${name}' not found` }, { status: 404 });
    }

    const registry = this.ctx.storage.sql.exec(
      "SELECT ts, what, location, status FROM agent_registry WHERE agent = ? ORDER BY ts DESC LIMIT 50",
      name
    ).toArray();

    const now = Date.now();
    const a = agent[0] as any;
    const lastCheckin = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
    const hoursSince = Math.round(((now - lastCheckin) / (1000 * 60 * 60)) * 10) / 10;
    let displayStatus = a.status;
    if (a.status === "online" && hoursSince > 2) displayStatus = "stale";

    // Include recent context for this agent
    const recentContext = this.ctx.storage.sql.exec(
      "SELECT ts, category, weight, title, tags, thread FROM context_log WHERE agent = ? ORDER BY ts DESC LIMIT 10",
      name
    ).toArray();

    return Response.json({
      name: a.name,
      status: displayStatus,
      machine: a.machine,
      working_on: a.working_on,
      context: a.context,
      capabilities: a.capabilities,
      last_checkin: a.last_checkin,
      last_checkout: a.last_checkout,
      hoursSinceCheckin: hoursSince,
      built: registry,
      recent_context: recentContext,
    });
  }

  private async handleCheckout(request: Request): Promise<Response> {
    const body = await request.json() as any;
    const name = body.name;

    if (!name) return Response.json({ error: "name required" }, { status: 400 });

    this.ctx.storage.sql.exec(
      `UPDATE agents SET status = 'offline', last_checkout = ? WHERE name = ?`,
      new Date().toISOString(), name
    );

    return Response.json({ ok: true, agent: name, status: "offline" });
  }

  private handleFleet(): Response {
    const agents = this.ctx.storage.sql.exec(
      "SELECT * FROM agents ORDER BY last_checkin DESC"
    ).toArray();

    const now = Date.now();
    const enriched = agents.map((a: any) => {
      const lastCheckin = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
      const hoursSince = (now - lastCheckin) / (1000 * 60 * 60);
      let displayStatus = a.status;
      if (a.status === "online" && hoursSince > 2) displayStatus = "stale";
      return { ...a, displayStatus, hoursSinceCheckin: Math.round(hoursSince * 10) / 10 };
    });

    return Response.json({ agents: enriched });
  }

  // ─── Per-agent public daemon page ───────────────────────────────

  private handleAgentDaemon(name: string): Response {
    const agent = this.ctx.storage.sql.exec(
      "SELECT * FROM agents WHERE name = ?", name
    ).toArray();

    if (agent.length === 0) {
      return new Response(`Agent '${name}' not found`, { status: 404 });
    }

    const registry = this.ctx.storage.sql.exec(
      "SELECT ts, what, location, status FROM agent_registry WHERE agent = ? ORDER BY ts DESC LIMIT 20",
      name
    ).toArray();

    const a = agent[0] as any;
    const now = Date.now();
    const lastCheckin = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
    const hoursSince = Math.round(((now - lastCheckin) / (1000 * 60 * 60)) * 10) / 10;
    let displayStatus = a.status;
    if (a.status === "online" && hoursSince > 2) displayStatus = "stale";

    const statusColor = displayStatus === "online" ? "#4a9" : displayStatus === "stale" ? "#ca4" : "#666";

    const registryRows = registry.map((r: any) =>
      `<tr><td class="dim">${(r.ts || '').split('T')[0]}</td><td>${r.what}</td><td class="dim">${r.status}</td></tr>`
    ).join('\n      ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${a.name} — Fleet Agent</title>
  <style>
    body { font-family: 'Berkeley Mono', 'SF Mono', monospace; background: #0a0a0a; color: #c4a35a; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1 { color: #e8d5a3; font-size: 1.4em; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px; }
    h2 { color: #c4a35a; font-size: 1.1em; margin-top: 28px; }
    .status { color: ${statusColor}; font-weight: bold; }
    .dim { color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { text-align: left; padding: 4px 12px 4px 0; font-size: 0.85em; }
    th { color: #888; }
    .meta { color: #888; font-size: 0.85em; margin: 4px 0; }
    a { color: #c4a35a; }
    .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #2a2a2a; color: #444; font-size: 0.8em; }
  </style>
</head>
<body>
  <h1>${a.name}</h1>
  <p class="meta">Machine: ${a.machine || 'unknown'} | <span class="status">${displayStatus}</span> | Last checkin: ${hoursSince}h ago</p>

  ${a.working_on ? `<h2>Currently Working On</h2><p>${a.working_on}</p>` : ''}
  ${a.context ? `<h2>Context</h2><p>${a.context}</p>` : ''}
  ${a.capabilities ? `<h2>Capabilities</h2><p>${a.capabilities}</p>` : ''}

  ${registry.length > 0 ? `
  <h2>Recently Built</h2>
  <table>
    <tr><th>Date</th><th>What</th><th>Status</th></tr>
    ${registryRows}
  </table>` : '<h2>Recently Built</h2><p class="dim">No published items yet.</p>'}

  <div class="footer">
    <a href="/daemon">&larr; Back to Fleet</a> | Neversink v1.0.0
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ─── Public daemon page ────────────────────────────────────────

  private handleDaemon(): Response {
    const lastCheck = this.getMeta("last_check_ts") || "never";
    const totalChecks = this.getMeta("total_checks") || "0";

    const repoRows = this.ctx.storage.sql.exec(
      "SELECT name, last_checked, is_private FROM repos ORDER BY last_checked DESC"
    ).toArray();

    const unreadCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM alerts WHERE read = 0"
    ).toArray();

    const contextCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM context_log"
    ).toArray();

    const highWeightCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM context_log WHERE weight >= 7"
    ).toArray();

    const repos = repoRows.map((r: any) => ({
      name: r.name,
      private: r.is_private === 1,
      lastChecked: r.last_checked,
    }));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neversink — Persistent Awareness</title>
  <style>
    body { font-family: 'Berkeley Mono', 'SF Mono', monospace; background: #0a0a0a; color: #c4a35a; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1 { color: #e8d5a3; font-size: 1.4em; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px; }
    h2 { color: #c4a35a; font-size: 1.1em; margin-top: 28px; }
    .status { color: #4a9; }
    .dim { color: #666; }
    .highlight { color: #e8d5a3; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { text-align: left; padding: 4px 12px 4px 0; font-size: 0.85em; }
    th { color: #888; }
    .private { color: #666; }
    .public { color: #4a9; }
    a { color: #c4a35a; }
    .tagline { color: #666; font-style: italic; margin: 4px 0; }
    .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #2a2a2a; color: #444; font-size: 0.8em; }
  </style>
</head>
<body>
  <h1>Neversink</h1>
  <p class="tagline">The stream that never goes dry. Persistent awareness for Rob's AI fleet.</p>
  <p class="dim">Evolved from Brook. Holds context across session boundaries. Monitors repos, fleet health, and agent drift.</p>

  <h2>Status</h2>
  <p><span class="status">Operational</span> | Last check: ${lastCheck} | Total checks: ${totalChecks} | Unread alerts: ${(unreadCount[0] as any)?.count || 0}</p>
  <p class="dim">Context events: <span class="highlight">${(contextCount[0] as any)?.count || 0}</span> total | <span class="highlight">${(highWeightCount[0] as any)?.count || 0}</span> high-weight (7+)</p>

  <h2>Fleet Agents</h2>
  <div id="agents">${(() => {
    const agents = this.ctx.storage.sql.exec(
      "SELECT name, status, machine, working_on, last_checkin FROM agents ORDER BY last_checkin DESC"
    ).toArray();
    if (agents.length === 0) return '<p class="dim">No agents have checked in yet.</p>';
    return '<table><tr><th>Agent</th><th>Status</th><th>Machine</th><th>Working On</th></tr>' +
      agents.map((a: any) => {
        const lc = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
        const hrs = Math.round(((Date.now() - lc) / (1000 * 60 * 60)) * 10) / 10;
        let ds = a.status;
        if (ds === "online" && hrs > 2) ds = "stale";
        const sc = ds === "online" ? "#4a9" : ds === "stale" ? "#ca4" : "#666";
        return `<tr><td><a href="/daemon/${a.name}">${a.name}</a></td><td style="color:${sc}">${ds}</td><td class="dim">${a.machine || ''}</td><td class="dim">${(a.working_on || '').substring(0, 80)}</td></tr>`;
      }).join('\n    ') + '</table>';
  })()}</div>

  <h2>Monitored Repositories (${repos.length})</h2>
  <table>
    <tr><th>Repo</th><th>Visibility</th><th>Last Checked</th></tr>
    ${repos.map((r: any) => `<tr>
      <td>${r.name}</td>
      <td class="${r.private ? 'private' : 'public'}">${r.private ? 'private' : 'public'}</td>
      <td class="dim">${r.lastChecked || 'never'}</td>
    </tr>`).join('\n    ')}
  </table>

  <h2>Capabilities</h2>
  <ul>
    <li><span class="highlight">Context persistence</span> — structured events survive session boundaries</li>
    <li><span class="highlight">Session briefings</span> — agents get full-fidelity context at startup</li>
    <li><span class="highlight">Fleet tracking</span> — agent checkin/checkout, work registry</li>
    <li><span class="highlight">Repo monitoring</span> — commit volume, new repos, large changes</li>
    <li><span class="highlight">Drift detection</span> — fleet-bridge activity, fragmentation signals</li>
    <li><span class="highlight">Context decay</span> — automatic cleanup by weight and age</li>
  </ul>

  <div class="footer">
    Neversink v1.0.0 | Cloudflare Durable Object | <a href="https://daemon.robert-chuvala.workers.dev">daemon</a> | NorthwoodsSentinel
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private handleStatus(): Response {
    const lastCheck = this.getMeta("last_check_ts") || "never";
    const totalChecks = this.getMeta("total_checks") || "0";

    const unreadAlerts = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM alerts WHERE read = 0"
    ).toArray();

    const repoCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM repos"
    ).toArray();

    const contextCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM context_log"
    ).toArray();

    const recentAlerts = this.ctx.storage.sql.exec(
      "SELECT * FROM alerts WHERE read = 0 ORDER BY ts DESC LIMIT 5"
    ).toArray();

    return Response.json({
      name: "Neversink",
      version: "1.0.0",
      status: "awake",
      lastCheck,
      totalChecks: parseInt(totalChecks),
      knownRepos: (repoCount[0] as any)?.count || 0,
      unreadAlerts: (unreadAlerts[0] as any)?.count || 0,
      contextEvents: (contextCount[0] as any)?.count || 0,
      recentAlerts,
    });
  }

  private handleAlerts(url: URL): Response {
    const unreadOnly = url.searchParams.get("unread") !== "false";
    const where = unreadOnly ? "WHERE read = 0" : "";
    const rows = this.ctx.storage.sql.exec(
      `SELECT * FROM alerts ${where} ORDER BY ts DESC LIMIT 50`
    ).toArray();
    return Response.json(rows);
  }

  private makeAlert(type: Alert["type"], severity: Alert["severity"], message: string): Alert {
    return {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      type,
      severity,
      message,
      read: false,
    };
  }

  private getMeta(key: string): string | null {
    const rows = this.ctx.storage.sql.exec(
      "SELECT value FROM meta WHERE key = ?", key
    ).toArray();
    return rows.length > 0 ? (rows[0] as any).value : null;
  }

  private setMeta(key: string, value: string) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
      key, value
    );
  }

  /**
   * Push notification via ntfy.sh. Non-blocking — never throws.
   */
  private async sendPush(title: string, body: string, priority: number = 3, tags: string = ""): Promise<void> {
    const topic = this.env.NTFY_TOPIC;
    if (!topic) return;

    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: {
          "Title": title,
          "Priority": String(priority),
          "Tags": tags || "satellite",
        },
        body: body,
      });
    } catch { /* non-blocking */ }
  }

  /**
   * Check for active fires in context_log and push reminders.
   */
  private async pushActiveFires(): Promise<void> {
    const now = new Date().toISOString();
    const fires = this.ctx.storage.sql.exec(
      `SELECT title, body, expires FROM context_log
       WHERE category = 'fire' AND weight >= 7
       AND (expires = '' OR expires > ?)
       ORDER BY weight DESC LIMIT 5`,
      now
    ).toArray();

    for (const fire of fires) {
      const f = fire as any;
      const exp = f.expires ? ` (due: ${f.expires.split('T')[0]})` : '';
      await this.sendPush(
        `🔥 ${f.title}`,
        `${f.body}${exp}`,
        4, // high priority
        "fire,warning"
      );
    }
  }
}

// ─── Worker entrypoint ──────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.BROOK.idFromName("brook-singleton");
    const stub = env.BROOK.get(id);
    return stub.fetch(request);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const id = env.BROOK.idFromName("brook-singleton");
    const stub = env.BROOK.get(id);
    ctx.waitUntil(stub.fetch(new Request("https://neversink/check")));
  },
};
