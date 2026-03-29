/**
 * BROOK — Fleet Overwatch
 *
 * A sleeping guardian for multi-agent AI fleets.
 * Durable Object on Cloudflare that wakes hourly or on webhook,
 * checks fleet health, logs state, alerts on anomalies, and goes back to sleep.
 *
 * Watches: GitHub repos, fleet-bridge registry, agent drift
 * Does NOT: run inference, modify files, instruct agents
 * Observer only.
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
}

// Public endpoints — no auth required
const PUBLIC_PATHS = new Set(["/", "/daemon"]);
// Everything else requires Bearer token

// "The only way to do great work is to love what you do — and then defend it." — Henry Rollins
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function secureResponse(body: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(body, { ...init, headers });
}

function secureJsonResponse(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) : str;
}

interface Alert {
  id: string;
  ts: string;
  type: "git" | "drift" | "fragmentation" | "volume" | "new_repo";
  severity: "info" | "warn" | "critical";
  message: string;
  read: boolean;
}

interface RepoState {
  name: string;
  lastCommitSha: string;
  lastChecked: string;
  isPrivate: boolean;
}

interface RegistryEntry {
  time: string;
  agent: string;
  what: string;
  where: string;
  status: string;
}

// ─── Durable Object: Brook ───────────────────────────────────────

export class Brook extends DurableObject<Env> {

  async init() {
    // Create tables on first wake
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
    `);
    // Migrate existing agents table if missing new columns
    try { this.ctx.storage.sql.exec(`ALTER TABLE agents ADD COLUMN context TEXT DEFAULT ''`); } catch {}
    try { this.ctx.storage.sql.exec(`ALTER TABLE agents ADD COLUMN capabilities TEXT DEFAULT ''`); } catch {}
  }

  // ─── Core check loop ──────────────────────────────────────────

  async runCheck(trigger: string): Promise<{ alerts: Alert[]; summary: string }> {
    await this.init();
    const start = Date.now();
    const newAlerts: Alert[] = [];
    const org = this.env.GITHUB_ORG;
    const token = this.env.GITHUB_TOKEN;

    // ─── Step 1: Git scan ───────────────────────────────────────

    const headers: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "User-Agent": "brook-overwatch/0.1",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let repos: any[] = [];
    try {
      // Try org endpoint first, fall back to user repos filtered by org
      let res = await fetch(`https://api.github.com/orgs/${org}/repos?per_page=100&sort=updated`, { headers });
      if (res.ok) {
        repos = await res.json() as any[];
      } else {
        // Classic tokens may need user endpoint
        res = await fetch(`https://api.github.com/user/repos?per_page=100&sort=updated&type=all`, { headers });
        if (res.ok) {
          const allRepos = await res.json() as any[];
          repos = allRepos.filter((r: any) => r.full_name?.startsWith(`${org}/`));
        }
      }
    } catch (e) {
      newAlerts.push(this.makeAlert("git", "warn", `GitHub API call failed: ${e}`));
    }

    // Check for new repos
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

    // Check each repo for new commits
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

          // Check for large commits
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
            } catch { /* skip detail fetch failures */ }
          }

          // Update stored state
          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO repos (name, last_commit_sha, last_checked, is_private)
             VALUES (?, ?, ?, ?)`,
            repo.name, commits[0].sha, new Date().toISOString(), repo.private ? 1 : 0
          );
        } else {
          // No new commits, just update check time
          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO repos (name, last_commit_sha, last_checked, is_private)
             VALUES (?, COALESCE((SELECT last_commit_sha FROM repos WHERE name = ?), ''), ?, ?)`,
            repo.name, repo.name, new Date().toISOString(), repo.private ? 1 : 0
          );
        }
      } catch { /* skip repos that fail */ }
    }

    // Volume alert
    if (totalNewCommits > parseInt(this.env.ALERT_THRESHOLD_COMMITS || "20")) {
      newAlerts.push(this.makeAlert("volume", "critical",
        `High volume: ${totalNewCommits} commits across org since last check`));
    }

    // ─── Step 2: Fleet-bridge check ─────────────────────────────

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

    // ─── Step 3: Fragmentation check ────────────────────────────

    try {
      const regRes = await fetch(
        `https://raw.githubusercontent.com/${org}/${this.env.FLEET_BRIDGE_REPO}/main/registry/2026-03-24.md`,
        { headers }
      );
      if (regRes.ok) {
        const regText = await regRes.text();
        const lines = regText.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Time'));

        // Look for duplicate topics across agents
        const topicAgentMap = new Map<string, Set<string>>();
        for (const line of lines) {
          const cols = line.split('|').map(c => c.trim()).filter(c => c);
          if (cols.length >= 3) {
            const agent = cols[1]?.toLowerCase();
            const what = cols[2]?.toLowerCase();
            if (agent && what) {
              // Extract keywords
              const keywords = what.split(/\s+/).filter(w => w.length > 4);
              for (const kw of keywords) {
                if (!topicAgentMap.has(kw)) topicAgentMap.set(kw, new Set());
                topicAgentMap.get(kw)!.add(agent);
              }
            }
          }
        }

        // Flag topics that appear across agents without explicit cross-reference
        for (const [topic, agents] of topicAgentMap) {
          if (agents.size > 1 && !['approved', 'moser', 'archie', 'ceecee', 'fleet', 'bridge'].includes(topic)) {
            // This is signal, not necessarily an alert — log it
            this.setMeta(`frag_${topic}`, Array.from(agents).join(','));
          }
        }
      }
    } catch { /* registry may not exist yet for today's date */ }

    // ─── Step 4: Store and sleep ────────────────────────────────

    const duration = Date.now() - start;

    // Store new alerts
    for (const alert of newAlerts) {
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO alerts (id, ts, type, severity, message, read) VALUES (?, ?, ?, ?, ?, 0)`,
        alert.id, alert.ts, alert.type, alert.severity, alert.message
      );
    }

    // Log check
    this.ctx.storage.sql.exec(
      `INSERT INTO checks (ts, trigger, repos_checked, alerts_generated, duration_ms)
       VALUES (?, ?, ?, ?, ?)`,
      new Date().toISOString(), trigger, repos.length, newAlerts.length, duration
    );

    this.setMeta("last_check_ts", new Date().toISOString());
    this.setMeta("total_checks", String(parseInt(this.getMeta("total_checks") || "0") + 1));

    const summary = [
      `Brook check complete (${trigger}, ${duration}ms)`,
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
        return secureJsonResponse(
          { error: "Unauthorized. Bearer token required for private endpoints." },
          { status: 401 }
        );
      }
    }

    // ─── Private endpoints ────────────────────────────────────
    if (path === "/status") {
      return this.handleStatus();
    }
    if (path === "/check") {
      const result = await this.runCheck("manual");
      return secureJsonResponse(result);
    }
    if (path === "/alerts") {
      return this.handleAlerts(url);
    }
    if (path === "/silence") {
      const id = url.searchParams.get("id");
      if (id) {
        this.ctx.storage.sql.exec("UPDATE alerts SET read = 1 WHERE id = ?", id);
        return secureJsonResponse({ ok: true });
      }
      return secureJsonResponse({ error: "id required" }, { status: 400 });
    }
    if (path === "/webhook") {
      const result = await this.runCheck("webhook");
      return secureJsonResponse(result);
    }
    if (path === "/checkin" && request.method === "POST") {
      return this.handleCheckin(request);
    }
    if (path === "/checkout" && request.method === "POST") {
      return this.handleCheckout(request);
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
      return secureJsonResponse(rows);
    }

    return secureJsonResponse({
      name: "Brook — Fleet Overwatch",
      version: "0.1.0",
      public: ["/daemon"],
      private: ["/status", "/check", "/alerts", "/silence?id=X", "/webhook", "/history", "/fleet", "/checkin (POST)", "/checkout (POST)"],
      auth: "Bearer token required for private endpoints",
    });  // "No dress rehearsal, this is our life" — Gord Downie
  }

  // ─── Cron handler ─────────────────────────────────────────────

  async alarm() {
    await this.runCheck("cron");
  }

  // ─── Fleet agent tracking ──────────────────────────────────────

  private async handleCheckin(request: Request): Promise<Response> {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return secureJsonResponse({ error: "Invalid JSON body" }, { status: 400 });
    }
    const name = truncate(String(body.name || ""), 128);
    const machine = truncate(String(body.machine || "unknown"), 128);
    const workingOn = truncate(String(body.working_on || ""), 1024);
    const context = truncate(String(body.context || ""), 1024);
    const capabilities = truncate(String(body.capabilities || ""), 1024);

    if (!name) return secureJsonResponse({ error: "name required" }, { status: 400 });

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

    return secureJsonResponse({ ok: true, agent: name, status: "online" });
  }

  // Agents publish what they built — goes into the shared registry
  private async handlePublish(request: Request): Promise<Response> {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return secureJsonResponse({ error: "Invalid JSON body" }, { status: 400 });
    }
    const agent = truncate(String(body.agent || ""), 128);
    const items = body.items; // array of { what, location, status }

    if (!agent || !items || !Array.isArray(items)) {
      return secureJsonResponse({ error: "agent and items[] required" }, { status: 400 });
    }

    const ts = new Date().toISOString();
    for (const item of items) {
      this.ctx.storage.sql.exec(
        `INSERT INTO agent_registry (agent, ts, what, location, status)
         VALUES (?, ?, ?, ?, ?)`,
        agent, ts, item.what || "", item.location || "", item.status || ""
      );
    }

    return secureJsonResponse({ ok: true, agent, published: items.length });
  }

  // Query a specific agent's state and registry
  private handleAgentQuery(name: string): Response {
    const agent = this.ctx.storage.sql.exec(
      "SELECT * FROM agents WHERE name = ?", name
    ).toArray();

    if (agent.length === 0) {
      return secureJsonResponse({ error: "Agent not found" }, { status: 404 });
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

    return secureJsonResponse({
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
    });
  }

  private async handleCheckout(request: Request): Promise<Response> {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return secureJsonResponse({ error: "Invalid JSON body" }, { status: 400 });
    }
    const name = truncate(String(body.name || ""), 128);

    if (!name) return secureJsonResponse({ error: "name required" }, { status: 400 });

    this.ctx.storage.sql.exec(
      `UPDATE agents SET status = 'offline', last_checkout = ? WHERE name = ?`,
      new Date().toISOString(), name
    );

    return secureJsonResponse({ ok: true, agent: name, status: "offline" });
  }

  private handleFleet(): Response {
    const agents = this.ctx.storage.sql.exec(
      "SELECT * FROM agents ORDER BY last_checkin DESC"
    ).toArray();

    // Mark agents stale if no checkin in 2 hours
    const now = Date.now();
    const enriched = agents.map((a: any) => {
      const lastCheckin = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
      const hoursSince = (now - lastCheckin) / (1000 * 60 * 60);
      let displayStatus = a.status;
      if (a.status === "online" && hoursSince > 2) displayStatus = "stale";
      return { ...a, displayStatus, hoursSinceCheckin: Math.round(hoursSince * 10) / 10 };
    });

    return secureJsonResponse({ agents: enriched });
  }

  // ─── Per-agent public daemon page ───────────────────────────────

  private handleAgentDaemon(name: string): Response {
    const agent = this.ctx.storage.sql.exec(
      "SELECT * FROM agents WHERE name = ?", name
    ).toArray();

    if (agent.length === 0) {
      return secureResponse("Agent not found", { status: 404 });
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
      `<tr><td class="dim">${escapeHtml((r.ts || '').split('T')[0])}</td><td>${escapeHtml(r.what)}</td><td class="dim">${escapeHtml(r.status)}</td></tr>`
    ).join('\n      ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(a.name)} — Fleet Agent</title>
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
  <h1>${escapeHtml(a.name)}</h1>
  <p class="meta">Machine: ${escapeHtml(a.machine || 'unknown')} · <span class="status">${escapeHtml(displayStatus)}</span> · Last checkin: ${hoursSince}h ago</p>

  ${a.working_on ? `<h2>Currently Working On</h2><p>${escapeHtml(a.working_on)}</p>` : ''}
  ${a.context ? `<h2>Context</h2><p>${escapeHtml(a.context)}</p>` : ''}
  ${a.capabilities ? `<h2>Capabilities</h2><p>${escapeHtml(a.capabilities)}</p>` : ''}

  ${registry.length > 0 ? `
  <h2>Recently Built</h2>
  <table>
    <tr><th>Date</th><th>What</th><th>Status</th></tr>
    ${registryRows}
  </table>` : '<h2>Recently Built</h2><p class="dim">No published items yet.</p>'}

  <div class="footer">
    <a href="/daemon">← Back to Fleet</a> · Brook v0.1.0
  </div>
</body>
</html>`;

    return secureResponse(html, {
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
  <title>Brook — Fleet Overwatch</title>
  <style>
    body { font-family: 'Berkeley Mono', 'SF Mono', monospace; background: #0a0a0a; color: #c4a35a; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1 { color: #e8d5a3; font-size: 1.4em; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px; }
    h2 { color: #c4a35a; font-size: 1.1em; margin-top: 28px; }
    .status { color: #4a9; }
    .dim { color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { text-align: left; padding: 4px 12px 4px 0; font-size: 0.85em; }
    th { color: #888; }
    .private { color: #666; }
    .public { color: #4a9; }
    a { color: #c4a35a; }
    .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #2a2a2a; color: #444; font-size: 0.8em; }
  </style>
</head>
<body>
  <h1>Brook — Fleet Overwatch</h1>
  <p class="dim">A sleeping guardian for your AI fleet. Wakes hourly. Watches git, fleet-bridge, drift. Observer only.</p>

  <h2>Status</h2>
  <p><span class="status">Operational</span> · Last check: ${lastCheck} · Total checks: ${totalChecks} · Unread alerts: ${(unreadCount[0] as any)?.count || 0}</p>

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
        return `<tr><td><a href="/daemon/${escapeHtml(a.name)}">${escapeHtml(a.name)}</a></td><td style="color:${sc}">${escapeHtml(ds)}</td><td class="dim">${escapeHtml(a.machine || '')}</td><td class="dim">${escapeHtml((a.working_on || '').substring(0, 80))}</td></tr>`;
      }).join('\n    ') + '</table>';
  })()}</div>

  <h2>Monitored Repositories (${repos.length})</h2>
  <table>
    <tr><th>Repo</th><th>Visibility</th><th>Last Checked</th></tr>
    ${repos.map((r: any) => `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="${r.private ? 'private' : 'public'}">${r.private ? 'private' : 'public'}</td>
      <td class="dim">${escapeHtml(r.lastChecked || 'never')}</td>
    </tr>`).join('\n    ')}
  </table>

  <h2>What Brook Watches</h2>
  <ul>
    <li>New repository creation</li>
    <li>Commit volume and large changes</li>
    <li>Fleet-bridge activity and drift</li>
    <li>Agent fragmentation signals</li>
  </ul>

  <h2>What Brook Does Not Do</h2>
  <ul>
    <li>No AI inference. Pure logic.</li>
    <li>No content judgment. Tracks activity, not meaning.</li>
    <li>No action. Observer only. Never pushes code or instructs agents.</li>
  </ul>

  <div class="footer">
    Brook v0.1.0 · Cloudflare Durable Object · <a href="https://github.com/NorthwoodsSentinel/brook">GitHub</a>
  </div>
</body>
</html>`;

    return secureResponse(html, {
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

    const recentAlerts = this.ctx.storage.sql.exec(
      "SELECT * FROM alerts WHERE read = 0 ORDER BY ts DESC LIMIT 5"
    ).toArray();

    return secureJsonResponse({
      status: "awake",
      lastCheck,
      totalChecks: parseInt(totalChecks),
      knownRepos: (repoCount[0] as any)?.count || 0,
      unreadAlerts: (unreadAlerts[0] as any)?.count || 0,
      recentAlerts,
    });
  }

  private handleAlerts(url: URL): Response {
    const unreadOnly = url.searchParams.get("unread") !== "false";
    const where = unreadOnly ? "WHERE read = 0" : "";
    const rows = this.ctx.storage.sql.exec(
      `SELECT * FROM alerts ${where} ORDER BY ts DESC LIMIT 50`
    ).toArray();
    return secureJsonResponse(rows);
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
    ctx.waitUntil(stub.fetch(new Request("https://brook/check")));
  },
};
