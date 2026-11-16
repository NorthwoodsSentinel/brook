// The Durable Object's HTTP surface (Brook.fetch): the auth gate, the public schema
// catalog and daemon pages, agent check-in/out/publish, telemetry, status and alerts.
// Requests go straight to the Durable Object; state is read back from SQLite.
import { describe, expect, it } from "vitest";
import {
  API_KEY,
  call,
  hoursAgo,
  makeBrook,
  minutesAgo,
} from "./support/brook";

describe("auth gate", () => {
  it("refuses private endpoints without the right bearer token", async () => {
    const { brook } = makeBrook();
    for (const auth of [null, "Bearer wrong", API_KEY + "x"]) {
      const res = await call(brook, "/status", { auth });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error:
          "Unauthorized. Bearer token required for private endpoints. Schema discovery at GET /schemas (public).",
      });
      expect(res.headers.get("Content-Security-Policy")).toContain(
        "default-src 'none'",
      );
    }
  });

  it("refuses every token when no API key is configured", async () => {
    const { brook } = makeBrook({ BROOK_API_KEY: "" });
    expect((await call(brook, "/status", { auth: "Bearer " })).status).toBe(
      401,
    );
  });

  it("serves the service index at / without a token", async () => {
    const { brook } = makeBrook();
    const res = await call(brook, "/", { auth: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: "Brook — Fleet Overwatch",
      version: "0.1.0",
    });
  });

  it("answers unknown or method-mismatched private paths with the service index", async () => {
    const { brook } = makeBrook();
    for (const path of ["/nope", "/silence", "/checkin", "/agent/"]) {
      const res = await call(brook, path);
      expect(await res.json()).toMatchObject({
        name: "Brook — Fleet Overwatch",
      });
    }
  });

  it("treats /daemon/ with no agent name as public and returns the service index", async () => {
    const { brook } = makeBrook();
    const res = await call(brook, "/daemon/", { auth: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Brook — Fleet Overwatch" });
  });
});

describe("schema catalog", () => {
  it("lists every schema publicly", async () => {
    const { brook } = makeBrook();
    const res = await call(brook, "/schemas", { auth: null });
    const body = (await res.json()) as {
      ok: boolean;
      data: { schemas: Array<{ slug: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.data.schemas.map((s) => s.slug)).toEqual([
      "fleet_telemetry_post",
      "checkin_post",
      "checkout_post",
      "publish_post",
      "silence_post",
    ]);
  });

  it("returns one schema by slug, and a 404 naming the options for an unknown slug", async () => {
    const { brook } = makeBrook();
    const one = await call(brook, "/schemas/checkin_post", { auth: null });
    expect(await one.json()).toMatchObject({
      ok: true,
      data: { schema: { endpoint: "POST /checkin" } },
    });

    const missing = await call(brook, "/schemas/nope", { auth: null });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });

    const empty = await call(brook, "/schemas/", { auth: null });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({
      ok: true,
      data: { doc: expect.any(String) },
    });
  });
});

describe("agents", () => {
  it("checks an agent in, truncating long fields, and keeps earlier context when none is sent", async () => {
    const { brook, sql } = makeBrook();
    const first = await call(brook, "/checkin", {
      method: "POST",
      body: {
        name: "n".repeat(80),
        machine: "lares",
        working_on: "w",
        context: "ctx",
        capabilities: "cap",
      },
    });
    expect(await first.json()).toEqual({
      ok: true,
      agent: "n".repeat(64),
      status: "online",
    });

    await call(brook, "/checkin", {
      method: "POST",
      body: { name: "n".repeat(64) },
    });
    expect(
      sql
        .exec(
          "SELECT status, machine, working_on, context, capabilities FROM agents",
        )
        .toArray(),
    ).toEqual([
      {
        status: "online",
        machine: "unknown",
        working_on: "",
        context: "ctx",
        capabilities: "cap",
      },
    ]);
  });

  it("rejects a check-in without a name or with invalid JSON", async () => {
    const { brook } = makeBrook();
    const noName = await call(brook, "/checkin", { method: "POST", body: {} });
    expect(noName.status).toBe(400);
    expect(await noName.json()).toEqual({ error: "name required" });
    const bad = await call(brook, "/checkin", { method: "POST", rawBody: "{" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("checks an agent out", async () => {
    const { brook, sql } = makeBrook();
    await call(brook, "/checkin", { method: "POST", body: { name: "margin" } });
    const res = await call(brook, "/checkout", {
      method: "POST",
      body: { name: "margin" },
    });
    expect(await res.json()).toEqual({
      ok: true,
      agent: "margin",
      status: "offline",
    });
    const row = sql
      .exec("SELECT status, last_checkout FROM agents")
      .toArray()[0];
    expect(row.status).toBe("offline");
    expect(row.last_checkout).toEqual(expect.any(String));

    expect(
      (await call(brook, "/checkout", { method: "POST", body: {} })).status,
    ).toBe(400);
    expect(
      (await call(brook, "/checkout", { method: "POST", rawBody: "x" })).status,
    ).toBe(400);
  });

  it("publishes registry items for an agent", async () => {
    const { brook, sql } = makeBrook();
    const res = await call(brook, "/publish", {
      method: "POST",
      body: {
        agent: "margin",
        items: [{ what: "vault", location: "lares", status: "done" }, {}],
      },
    });
    expect(await res.json()).toEqual({
      ok: true,
      agent: "margin",
      published: 2,
    });
    expect(
      sql
        .exec(
          "SELECT agent, what, location, status FROM agent_registry ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      { agent: "margin", what: "vault", location: "lares", status: "done" },
      { agent: "margin", what: "", location: "", status: "" },
    ]);
  });

  it("rejects a publish without an agent or an items array", async () => {
    const { brook } = makeBrook();
    for (const body of [
      { items: [] },
      { agent: "a" },
      { agent: "a", items: "x" },
    ]) {
      const res = await call(brook, "/publish", { method: "POST", body });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "agent and items[] required" });
    }
    expect(
      (await call(brook, "/publish", { method: "POST", rawBody: "[" })).status,
    ).toBe(400);
  });

  it("reports one agent with its registry, marking a silent online agent stale", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.exec(
      "INSERT INTO agents (name, status, last_checkin, machine) VALUES ('old', 'online', ?, 'lares')",
      hoursAgo(5),
    );
    sql.exec(
      "INSERT INTO agents (name, status, last_checkin) VALUES ('fresh', 'online', ?)",
      hoursAgo(1),
    );
    sql.exec("INSERT INTO agents (name, status) VALUES ('never', 'offline')");
    sql.exec(
      "INSERT INTO agent_registry (agent, ts, what) VALUES ('old', ?, 'thing')",
      hoursAgo(6),
    );

    const old = (await (await call(brook, "/agent/old")).json()) as Record<
      string,
      unknown
    >;
    expect(old).toMatchObject({
      name: "old",
      status: "stale",
      machine: "lares",
      hoursSinceCheckin: 5,
    });
    expect(old.built).toEqual([expect.objectContaining({ what: "thing" })]);
    expect(await (await call(brook, "/agent/fresh")).json()).toMatchObject({
      status: "online",
    });
    expect(await (await call(brook, "/agent/never")).json()).toMatchObject({
      status: "offline",
      last_checkin: null,
    });

    const missing = await call(brook, "/agent/ghost");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Agent not found" });
  });

  it("lists the fleet with a display status per agent", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.exec(
      "INSERT INTO agents (name, status, last_checkin) VALUES ('a', 'online', ?)",
      hoursAgo(3),
    );
    sql.exec(
      "INSERT INTO agents (name, status, last_checkin) VALUES ('b', 'online', ?)",
      hoursAgo(0.5),
    );
    sql.exec("INSERT INTO agents (name, status) VALUES ('c', 'offline')");
    const body = (await (await call(brook, "/fleet")).json()) as {
      agents: Array<{ name: string; displayStatus: string }>;
    };
    expect(
      Object.fromEntries(body.agents.map((a) => [a.name, a.displayStatus])),
    ).toEqual({
      a: "stale",
      b: "online",
      c: "offline",
    });
  });
});

describe("alerts, status and history", () => {
  async function seeded() {
    const made = makeBrook();
    await made.brook.init();
    made.sql.exec(
      "INSERT INTO alerts (id, ts, type, severity, message, read) VALUES ('a1', '2026-01-01', 'git', 'warn', 'one', 0)",
    );
    made.sql.exec(
      "INSERT INTO alerts (id, ts, type, severity, message, read) VALUES ('a2', '2026-01-02', 'git', 'warn', 'two', 1)",
    );
    return made;
  }

  it("lists unread alerts by default and all alerts with unread=false", async () => {
    const { brook } = await seeded();
    expect(
      ((await (await call(brook, "/alerts")).json()) as unknown[]).length,
    ).toBe(1);
    expect(
      ((await (await call(brook, "/alerts?unread=false")).json()) as unknown[])
        .length,
    ).toBe(2);
  });

  it("silences an alert by id, truncating the id, and rejects a missing id or bad JSON", async () => {
    const { brook, sql } = await seeded();
    const ok = await call(brook, "/silence", {
      method: "POST",
      body: { id: "a1" },
    });
    expect(await ok.json()).toEqual({ ok: true });
    expect(
      sql.exec("SELECT read FROM alerts WHERE id = 'a1'").toArray(),
    ).toEqual([{ read: 1 }]);

    const missing = await call(brook, "/silence", { method: "POST", body: {} });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "id required" });
    expect(
      (await call(brook, "/silence", { method: "POST", body: null })).status,
    ).toBe(400);
    expect(
      (await call(brook, "/silence", { method: "POST", rawBody: "nope" }))
        .status,
    ).toBe(400);
  });

  it("reports status from stored state", async () => {
    const { brook, sql } = await seeded();
    expect(await (await call(brook, "/status")).json()).toMatchObject({
      status: "awake",
      lastCheck: "never",
      totalChecks: 0,
      knownRepos: 0,
      unreadAlerts: 1,
    });
    sql.exec(
      "INSERT INTO meta (key, value) VALUES ('last_check_ts', 'T'), ('total_checks', '7')",
    );
    sql.exec("INSERT INTO repos (name) VALUES ('r')");
    expect(await (await call(brook, "/status")).json()).toMatchObject({
      lastCheck: "T",
      totalChecks: 7,
      knownRepos: 1,
    });
  });

  it("returns the last 24 checks, newest first", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    for (let i = 0; i < 30; i++) {
      sql.exec(
        "INSERT INTO checks (ts, trigger) VALUES (?, 'cron')",
        `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      );
    }
    const rows = (await (await call(brook, "/history")).json()) as Array<{
      ts: string;
    }>;
    expect(rows).toHaveLength(24);
    expect(rows[0].ts).toBe("2026-01-01T00:00:29Z");
  });
});

describe("fleet telemetry", () => {
  it("inserts new sessions and keeps the start time of a session that stays active", async () => {
    const { brook, sql } = makeBrook();
    const res = await call(brook, "/fleet-telemetry", {
      method: "POST",
      body: {
        sessions: [
          { agent: "Gemini", query_count: 5, domains: ["a", "b"], local: true },
          { agent: "Mirror", query_count: "x", domains: "not-an-array" },
          { query_count: 1 },
        ],
      },
    });
    expect(await res.json()).toEqual({ ok: true, updated: 3 });
    expect(
      sql
        .exec(
          "SELECT agent, query_count, domains, is_local FROM fleet_sessions ORDER BY agent",
        )
        .toArray(),
    ).toEqual([
      { agent: "Gemini", query_count: 5, domains: "a,b", is_local: 1 },
      { agent: "Mirror", query_count: 0, domains: "", is_local: 0 },
    ]);

    sql.exec(
      "UPDATE fleet_sessions SET session_start = 'kept' WHERE agent = 'Gemini'",
    );
    sql.exec(
      "UPDATE fleet_sessions SET status = 'idle', session_start = 'reset-me' WHERE agent = 'Mirror'",
    );
    await call(brook, "/fleet-telemetry", {
      method: "POST",
      body: {
        sessions: [
          { agent: "Gemini", query_count: 2_000_000 },
          { agent: "Mirror" },
        ],
      },
    });
    const rows = sql
      .exec(
        "SELECT agent, status, session_start, query_count FROM fleet_sessions ORDER BY agent",
      )
      .toArray();
    expect(rows[0]).toMatchObject({
      agent: "Gemini",
      status: "active",
      session_start: "kept",
      query_count: 999999,
    });
    expect(rows[1]).toMatchObject({ agent: "Mirror", status: "active" });
    expect(rows[1].session_start).not.toBe("reset-me");
  });

  it("marks sessions idle when absent from the batch for over 10 minutes", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.exec(
      "INSERT INTO fleet_sessions (agent, status, last_seen) VALUES ('gone', 'active', ?)",
      minutesAgo(30),
    );
    sql.exec(
      "INSERT INTO fleet_sessions (agent, status, last_seen) VALUES ('recent', 'active', ?)",
      minutesAgo(2),
    );
    await call(brook, "/fleet-telemetry", {
      method: "POST",
      body: { sessions: [{ agent: "here" }] },
    });
    const status = Object.fromEntries(
      sql
        .exec("SELECT agent, status FROM fleet_sessions")
        .toArray()
        .map((r) => [r.agent, r.status]),
    );
    expect(status).toEqual({ gone: "idle", recent: "active", here: "active" });
  });

  it("rejects a telemetry post without a sessions array or with bad JSON", async () => {
    const { brook } = makeBrook();
    for (const body of [{}, { sessions: "x" }, null]) {
      const res = await call(brook, "/fleet-telemetry", {
        method: "POST",
        body,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "sessions[] required" });
    }
    expect(
      (await call(brook, "/fleet-telemetry", { method: "POST", rawBody: "{" }))
        .status,
    ).toBe(400);
  });

  async function modeFor(
    active: string[],
    extra: (sql: ReturnType<typeof makeBrook>["sql"]) => void = () => {},
  ) {
    const { brook, sql } = makeBrook();
    await brook.init();
    for (const agent of active) {
      sql.exec(
        "INSERT INTO fleet_sessions (agent, status, last_seen, session_start) VALUES (?, 'active', ?, ?)",
        agent,
        minutesAgo(1),
        minutesAgo(31),
      );
    }
    extra(sql);
    return (await (await call(brook, "/fleet-telemetry")).json()) as {
      cognitive_mode: string;
      active_count: number;
      sessions: Array<Record<string, unknown>>;
    };
  }

  it("derives the cognitive mode from which agents are active", async () => {
    expect((await modeFor([])).cognitive_mode).toBe("idle");
    expect((await modeFor(["Gemini"])).cognitive_mode).toBe("generative");
    expect((await modeFor(["Mirror"])).cognitive_mode).toBe("generative");
    expect((await modeFor(["Leroy"])).cognitive_mode).toBe("analytical");
    expect((await modeFor(["Leroy-API", "Mirror"])).cognitive_mode).toBe(
      "split-screen",
    );
    expect((await modeFor(["CeeCee"])).cognitive_mode).toBe("build");
    expect((await modeFor(["CeeCee", "Leroy"])).cognitive_mode).toBe(
      "split-screen",
    );
  });

  it("reports durations and auto-idles a stale active session", async () => {
    const body = await modeFor(["Gemini"], (sql) => {
      sql.exec(
        "INSERT INTO fleet_sessions (agent, status, last_seen) VALUES ('stale', 'active', ?)",
        minutesAgo(20),
      );
      sql.exec(
        "INSERT INTO fleet_sessions (agent, status, is_local) VALUES ('blank', 'offline', 1)",
      );
    });
    expect(body.active_count).toBe(1);
    const byAgent = Object.fromEntries(body.sessions.map((s) => [s.agent, s]));
    expect(byAgent.Gemini).toMatchObject({
      status: "active",
      session_duration_min: 30,
      idle_min: 1,
      is_local: false,
    });
    expect(byAgent.stale).toMatchObject({
      status: "idle",
      session_duration_min: 0,
      idle_min: 20,
    });
    expect(byAgent.blank).toMatchObject({
      status: "offline",
      session_duration_min: 0,
      is_local: true,
    });
  });

  it("answers an empty idle view when the telemetry table cannot be read", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.failOn = "FROM fleet_sessions ORDER BY";
    expect(await (await call(brook, "/fleet-telemetry")).json()).toEqual({
      sessions: [],
      cognitive_mode: "idle",
      active_count: 0,
      error: "table_initializing",
    });
  });
});

describe("init", () => {
  it("continues when creating the telemetry table fails", async () => {
    const { brook, sql } = makeBrook();
    sql.failOn = "CREATE TABLE IF NOT EXISTS fleet_sessions";
    await brook.init();
    sql.failOn = undefined;
    expect(
      sql
        .exec("SELECT name FROM sqlite_master WHERE name = 'fleet_sessions'")
        .toArray(),
    ).toEqual([]);
  });

  it("adds the context and capabilities columns to an agents table created before they existed", async () => {
    const { brook, sql } = makeBrook();
    sql.db.exec(
      "CREATE TABLE agents (name TEXT PRIMARY KEY, status TEXT DEFAULT 'offline', last_checkin TEXT, last_checkout TEXT, working_on TEXT, machine TEXT)",
    );
    await brook.init();
    const columns = sql
      .exec("PRAGMA table_info(agents)")
      .toArray()
      .map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(["context", "capabilities"]),
    );
  });
});

describe("daemon pages", () => {
  it("renders the fleet page for an empty fleet", async () => {
    const { brook } = makeBrook();
    const res = await call(brook, "/daemon", { auth: null });
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain(
      "Last check: never · Total checks: 0 · Unread alerts: 0",
    );
    expect(html).toContain("No agents have checked in yet.");
    expect(html).toContain("No fleet telemetry data yet.");
    expect(html).toContain("Monitored Repositories (0)");
  });

  it("renders agents, telemetry and repos, escaping stored text", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.exec(
      "INSERT INTO meta (key, value) VALUES ('last_check_ts', 'T1'), ('total_checks', '3')",
    );
    sql.exec(
      "INSERT INTO alerts (id, ts, type, severity, message) VALUES ('x', 't', 'git', 'warn', 'm')",
    );
    sql.exec(
      "INSERT INTO agents (name, status, last_checkin, machine, working_on) VALUES ('<b>', 'online', ?, 'lares', ?)",
      hoursAgo(0.1),
      "w".repeat(100),
    );
    sql.exec(
      "INSERT INTO agents (name, status, last_checkin) VALUES ('stale one', 'online', ?)",
      hoursAgo(9),
    );
    sql.exec("INSERT INTO agents (name, status) VALUES ('off', 'offline')");
    sql.exec(
      "INSERT INTO fleet_sessions (agent, status, last_seen, session_start, query_count, is_local) VALUES ('CeeCee', 'active', ?, ?, 4, 1)",
      minutesAgo(1),
      minutesAgo(11),
    );
    sql.exec(
      "INSERT INTO fleet_sessions (agent, status, last_seen) VALUES ('Drift', 'active', ?)",
      minutesAgo(45),
    );
    sql.exec(
      "INSERT INTO fleet_sessions (agent, status) VALUES ('Never', 'offline')",
    );
    sql.exec(
      "INSERT INTO repos (name, last_checked, is_private) VALUES ('pub', 'L', 0), ('priv', NULL, 1)",
    );

    const html = await (await call(brook, "/daemon", { auth: null })).text();
    expect(html).toContain(
      "Last check: T1 · Total checks: 3 · Unread alerts: 1",
    );
    expect(html).toContain('<a href="/daemon/%3Cb%3E">&lt;b&gt;</a>');
    expect(html).toContain('<td style="color:#4a9">online</td>');
    expect(html).toContain('<td style="color:#ca4">stale</td>');
    expect(html).toContain('<td style="color:#666">offline</td>');
    expect(html).toContain("w".repeat(80) + "</td>");
    expect(html).not.toContain("w".repeat(81));
    expect(html).toContain(
      'Cognitive Mode: <span style="color:#666;font-weight:bold">BUILD</span>',
    );
    expect(html).toContain("CeeCee <span");
    expect(html).toContain("10m active");
    expect(html).toContain("4 queries");
    expect(html).toContain("idle 45m");
    expect(html).toContain("0 queries");
    expect(html).toContain('<td class="public">public</td>');
    expect(html).toContain('<td class="private">private</td>');
    expect(html).toContain("Monitored Repositories (2)");
  });

  it("colors each cognitive mode on the fleet page", async () => {
    const cases: Array<[string[], string]> = [
      [["Gemini"], 'color:#4a9;font-weight:bold">GENERATIVE'],
      [["Leroy"], 'color:#69b;font-weight:bold">ANALYTICAL'],
      [["Leroy", "Mirror"], 'color:#c4a35a;font-weight:bold">SPLIT-SCREEN ◆'],
      [["CeeCee", "Leroy"], 'color:#c4a35a;font-weight:bold">SPLIT-SCREEN ◆'],
      [["Leroy-API"], 'color:#69b;font-weight:bold">ANALYTICAL'],
      [["Other"], 'color:#666;font-weight:bold">IDLE'],
    ];
    for (const [active, expected] of cases) {
      const { brook, sql } = makeBrook();
      await brook.init();
      for (const agent of active) {
        sql.exec(
          "INSERT INTO fleet_sessions (agent, status, last_seen) VALUES (?, 'active', ?)",
          agent,
          minutesAgo(1),
        );
      }
      expect(
        await (await call(brook, "/daemon", { auth: null })).text(),
      ).toContain(expected);
    }
  });

  it("says the telemetry table is initializing when it cannot be read", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.failOn = "FROM fleet_sessions ORDER BY";
    expect(
      await (await call(brook, "/daemon", { auth: null })).text(),
    ).toContain("Fleet telemetry table initializing...");
  });

  it("renders a per-agent page with what it is doing and what it built", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.exec(
      "INSERT INTO agents (name, status, last_checkin, machine, working_on, context, capabilities) VALUES ('margin', 'online', ?, 'lares', 'w<1>', 'c', 'k')",
      hoursAgo(1),
    );
    sql.exec(
      "INSERT INTO agent_registry (agent, ts, what, status) VALUES ('margin', '2026-11-15T01:00:00Z', 'vault', 'done')",
    );
    sql.exec(
      "INSERT INTO agent_registry (agent, ts, what, location, status) VALUES ('margin', '', '', '', NULL)",
    );
    const res = await call(brook, "/daemon/margin", { auth: null });
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("<title>margin — Fleet Agent</title>");
    expect(html).toContain(
      'Machine: lares · <span class="status">online</span> · Last checkin: 1h ago',
    );
    expect(html).toContain(".status { color: #4a9;");
    expect(html).toContain("<h2>Currently Working On</h2><p>w&lt;1&gt;</p>");
    expect(html).toContain("<h2>Context</h2><p>c</p>");
    expect(html).toContain("<h2>Capabilities</h2><p>k</p>");
    expect(html).toContain(
      '<td class="dim">2026-11-15</td><td>vault</td><td class="dim">done</td>',
    );
  });

  it("renders a sparse per-agent page, stale or offline", async () => {
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.exec(
      "INSERT INTO agents (name, status, last_checkin) VALUES ('stale', 'online', ?)",
      hoursAgo(4),
    );
    sql.exec("INSERT INTO agents (name, status) VALUES ('off', 'offline')");

    const stale = await (
      await call(brook, "/daemon/stale", { auth: null })
    ).text();
    expect(stale).toContain(".status { color: #ca4;");
    expect(stale).toContain("Machine: unknown");
    expect(stale).toContain("No published items yet.");
    expect(stale).not.toContain("Currently Working On");

    const off = await (await call(brook, "/daemon/off", { auth: null })).text();
    expect(off).toContain(".status { color: #666;");

    const missing = await call(brook, "/daemon/ghost", { auth: null });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Agent not found");
  });
});
