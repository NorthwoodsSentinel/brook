// The scan loop (Brook.runCheck), driven through GET /check, /webhook and alarm().
// GitHub is stubbed by URL; every assertion reads what landed in SQLite or the
// returned alerts, which is what the live worker would store.
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { call, hoursAgo, json, makeBrook, stubFetch } from "./support/brook";

interface CheckResult {
  alerts: Array<{
    id: string;
    type: string;
    severity: string;
    message: string;
    read: boolean;
  }>;
  summary: string;
}

async function check(
  brook: ReturnType<typeof makeBrook>["brook"],
  path = "/check",
): Promise<CheckResult> {
  const res = await call(brook, path);
  expect(res.status).toBe(200);
  return (await res.json()) as CheckResult;
}

function commit(sha: string, message = "msg", date = new Date().toISOString()) {
  return { sha, commit: { message, author: { date } } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runCheck: repo discovery", () => {
  it("lists org repos with the token, records them and reports a small batch of new repos as info", async () => {
    const fetchMock = stubFetch([
      [
        "/orgs/Org/repos",
        () => json([{ name: "alpha", private: true }, { name: "beta" }]),
      ],
      ["/fleet-bridge/commits", () => json([commit("b1")])],
      ["/commits?since=", () => json([])],
    ]);
    const { brook, sql } = makeBrook();
    const result = await check(brook);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/orgs/Org/repos?per_page=100&sort=updated",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-github-token",
        }),
      }),
    );
    expect(result.alerts).toEqual([
      expect.objectContaining({
        type: "new_repo",
        severity: "info",
        message: "New repo(s): alpha, beta",
        read: false,
      }),
    ]);
    expect(result.summary).toContain("Brook check complete (manual,");
    expect(result.summary).toContain("Repos: 2 checked, 2 new");
    const repos = sql
      .exec("SELECT name, last_commit_sha, is_private FROM repos ORDER BY name")
      .toArray();
    expect(repos).toEqual([
      { name: "alpha", last_commit_sha: "", is_private: 1 },
      { name: "beta", last_commit_sha: "", is_private: 0 },
    ]);
    const checks = sql
      .exec("SELECT trigger, repos_checked, alerts_generated FROM checks")
      .toArray();
    expect(checks).toEqual([
      { trigger: "manual", repos_checked: 2, alerts_generated: 1 },
    ]);
    expect(
      sql.exec("SELECT value FROM meta WHERE key = 'total_checks'").toArray(),
    ).toEqual([{ value: "1" }]);
  });

  it("sends no Authorization header when no GitHub token is set", async () => {
    const fetchMock = stubFetch([["/orgs/Org/repos", () => json([])]]);
    const { brook } = makeBrook({ GITHUB_TOKEN: "" });
    await check(brook);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/orgs/Org/repos?per_page=100&sort=updated",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
        }),
      }),
    );
  });

  it("raises a critical alert when more new repos appear than the threshold allows", async () => {
    stubFetch([
      [
        "/orgs/Org/repos",
        () => json([{ name: "a" }, { name: "b" }, { name: "c" }]),
      ],
    ]);
    const { brook } = makeBrook({ ALERT_THRESHOLD_REPOS: "" });
    const result = await check(brook);
    expect(result.alerts).toEqual([
      expect.objectContaining({
        type: "new_repo",
        severity: "critical",
        message: "3 new repos created: a, b, c",
      }),
    ]);
  });

  it("raises no new-repo alert for repos it already knows", async () => {
    stubFetch([
      ["/orgs/Org/repos", () => json([{ name: "known" }])],
      ["/repos/Org/known/commits?since=", () => json([])],
    ]);
    const { brook, sql } = makeBrook();
    await check(brook);
    sql.exec("DELETE FROM alerts");
    const second = await check(brook);
    expect(second.alerts).toEqual([]);
    expect(second.summary).toContain("Repos: 1 checked, 0 new");
  });

  it("falls back to the user repos endpoint, keeping only repos under the org", async () => {
    stubFetch([
      ["/orgs/Org/repos", () => json({ message: "nope" }, 404)],
      [
        "/user/repos",
        () =>
          json([
            { name: "mine", full_name: "Org/mine" },
            { name: "other", full_name: "Else/other" },
            { name: "x" },
          ]),
      ],
    ]);
    const { brook } = makeBrook();
    const result = await check(brook);
    expect(result.summary).toContain("Repos: 1 checked, 1 new");
  });

  it("checks nothing when both repo endpoints refuse", async () => {
    stubFetch([
      ["/orgs/Org/repos", () => json({}, 401)],
      ["/user/repos", () => json({}, 401)],
    ]);
    const { brook } = makeBrook();
    const result = await check(brook);
    expect(result.summary).toContain("Repos: 0 checked, 0 new");
  });

  it("records a git warning when the GitHub call throws", async () => {
    stubFetch([
      [
        "/orgs/Org/repos",
        () => {
          throw new Error("network down");
        },
      ],
    ]);
    const { brook } = makeBrook();
    const result = await check(brook);
    expect(result.alerts).toEqual([
      expect.objectContaining({
        type: "git",
        severity: "warn",
        message: "GitHub API call failed: Error: network down",
      }),
    ]);
  });
});

describe("runCheck: commits", () => {
  it("counts new commits, stores the newest sha and flags large commits", async () => {
    const commits = Array.from({ length: 6 }, (_, i) =>
      commit(`s${i}`, `subject ${i}\nbody`),
    );
    stubFetch([
      ["/orgs/Org/repos", () => json([{ name: "big", private: false }])],
      ["/repos/Org/big/commits?since=", () => json(commits)],
      ["/repos/Org/big/commits/s0", () => json({ stats: { total: 500 } })],
      ["/repos/Org/big/commits/s1", () => json({ stats: { total: 5 } })],
      ["/repos/Org/big/commits/s2", () => json({})],
      ["/repos/Org/big/commits/s3", () => json({}, 500)],
      [
        "/repos/Org/big/commits/s4",
        () => {
          throw new Error("detail failed");
        },
      ],
    ]);
    const { brook, sql } = makeBrook({ ALERT_THRESHOLD_FILES: "" });
    const result = await check(brook);
    expect(result.alerts).toContainEqual(
      expect.objectContaining({
        type: "volume",
        severity: "warn",
        message: 'Large commit in big: 500 changes — "subject 0"',
      }),
    );
    expect(
      result.alerts.filter((a) => a.message.startsWith("Large commit")),
    ).toHaveLength(1);
    expect(result.summary).toContain("Commits: 6 since last check");
    expect(
      sql
        .exec("SELECT last_commit_sha FROM repos WHERE name = 'big'")
        .toArray(),
    ).toEqual([{ last_commit_sha: "s0" }]);
  });

  it("keeps the stored sha when a later scan finds no new commits", async () => {
    let round = 0;
    stubFetch([
      ["/orgs/Org/repos", () => json([{ name: "r", private: true }])],
      [
        "/repos/Org/r/commits?since=",
        () => json(round++ === 0 ? [commit("first")] : []),
      ],
    ]);
    const { brook, sql } = makeBrook();
    await check(brook);
    await check(brook);
    expect(
      sql.exec("SELECT last_commit_sha, is_private FROM repos").toArray(),
    ).toEqual([{ last_commit_sha: "first", is_private: 1 }]);
  });

  it("asks GitHub for commits since the last stored check", async () => {
    const fetchMock = stubFetch([
      ["/orgs/Org/repos", () => json([{ name: "r" }])],
      ["/repos/Org/r/commits?since=", () => json([])],
    ]);
    const { brook, sql } = makeBrook();
    await brook.init();
    sql.exec(
      "INSERT INTO meta (key, value) VALUES ('last_check_ts', '2026-01-01T00:00:00.000Z')",
    );
    await check(brook);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(
      "https://api.github.com/repos/Org/r/commits?since=2026-01-01T00:00:00.000Z&per_page=50",
    );
  });

  it("skips a repo whose commit listing fails or throws, and keeps going", async () => {
    stubFetch([
      [
        "/orgs/Org/repos",
        () => json([{ name: "bad" }, { name: "boom" }, { name: "good" }]),
      ],
      ["/repos/Org/bad/commits", () => json({}, 409)],
      [
        "/repos/Org/boom/commits",
        () => {
          throw new Error("boom");
        },
      ],
      ["/repos/Org/good/commits?since=", () => json([commit("g1")])],
    ]);
    const { brook, sql } = makeBrook();
    const result = await check(brook);
    expect(result.summary).toContain("Commits: 1 since last check");
    expect(sql.exec("SELECT name FROM repos").toArray()).toEqual([
      { name: "good" },
    ]);
  });

  it("raises a critical volume alert above the commit threshold", async () => {
    stubFetch([
      ["/orgs/Org/repos", () => json([{ name: "busy" }])],
      [
        "/repos/Org/busy/commits?since=",
        () => json(Array.from({ length: 21 }, (_, i) => commit(`c${i}`))),
      ],
    ]);
    const { brook } = makeBrook({ ALERT_THRESHOLD_COMMITS: "" });
    const result = await check(brook);
    expect(result.alerts).toContainEqual(
      expect.objectContaining({
        type: "volume",
        severity: "critical",
        message: "High volume: 21 commits across org since last check",
      }),
    );
  });
});

describe("runCheck: fleet-bridge drift", () => {
  it("warns when the fleet-bridge has not moved in over 24 hours", async () => {
    stubFetch([
      ["/orgs/Org/repos", () => json([])],
      [
        "/repos/Org/fleet-bridge/commits?per_page=5",
        () => json([commit("b", "m", hoursAgo(30))]),
      ],
    ]);
    const { brook } = makeBrook();
    const result = await check(brook);
    expect(result.alerts).toEqual([
      expect.objectContaining({
        type: "drift",
        severity: "warn",
        message:
          "Fleet-bridge has not been updated in 30 hours. Agents may be going dark.",
      }),
    ]);
  });

  it("stays quiet for a recent update, an empty history or a refused call", async () => {
    for (const route of [
      () => json([commit("b", "m", hoursAgo(1))]),
      () => json([]),
      () => json({}, 404),
    ]) {
      stubFetch([
        ["/orgs/Org/repos", () => json([])],
        ["/repos/Org/fleet-bridge/commits?per_page=5", route],
      ]);
      const { brook } = makeBrook();
      const result = await check(brook);
      expect(result.alerts).toEqual([]);
    }
  });

  it("records an info alert when the fleet-bridge check throws", async () => {
    stubFetch([
      ["/orgs/Org/repos", () => json([])],
      [
        "/repos/Org/fleet-bridge/commits?per_page=5",
        () => {
          throw new Error("bridge down");
        },
      ],
    ]);
    const { brook } = makeBrook();
    const result = await check(brook);
    expect(result.alerts).toEqual([
      expect.objectContaining({
        type: "drift",
        severity: "info",
        message: "Could not check fleet-bridge: Error: bridge down",
      }),
    ]);
  });
});

describe("runCheck: fragmentation signal", () => {
  const registry = [
    "| Time | Agent | What | Where |",
    "|---|---|---|---|",
    "| 09:00 | Margin | substrate vault restore | lares |",
    "| 10:00 | CeeCee | substrate vault audit | mac |",
    "| 11:00 | CeeCee | fleet bridge approved | mac |",
    "| 11:30 | Margin | fleet bridge approved | lares |",
    "| short |",
    "not a table row",
  ].join("\n");

  it("records topics shared by more than one agent, skipping the stoplist", async () => {
    const fetchMock = stubFetch([
      ["/orgs/Org/repos", () => json([])],
      [
        "raw.githubusercontent.com/Org/fleet-bridge/main/registry/",
        () => new Response(registry),
      ],
    ]);
    const { brook, sql } = makeBrook();
    await check(brook);
    const today = new Date().toISOString().split("T")[0];
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(
      `https://raw.githubusercontent.com/Org/fleet-bridge/main/registry/${today}.md`,
    );
    const frag = sql
      .exec("SELECT key, value FROM meta WHERE key LIKE 'frag_%' ORDER BY key")
      .toArray();
    // "fleet", "bridge" and "approved" are shared too but sit on the stoplist; words of
    // four letters or fewer are never keywords.
    expect(frag).toEqual([
      { key: "frag_substrate", value: "margin,ceecee" },
      { key: "frag_vault", value: "margin,ceecee" },
    ]);
  });

  it("ignores a missing registry file or a failing fetch", async () => {
    for (const route of [
      () => new Response("missing", { status: 404 }),
      () => {
        throw new Error("raw down");
      },
    ]) {
      stubFetch([
        ["/orgs/Org/repos", () => json([])],
        ["raw.githubusercontent.com", route],
      ]);
      const { brook, sql } = makeBrook();
      const result = await check(brook);
      expect(result.alerts).toEqual([]);
      expect(
        sql.exec("SELECT key FROM meta WHERE key LIKE 'frag_%'").toArray(),
      ).toEqual([]);
    }
  });
});

describe("runCheck: triggers", () => {
  it("runs on /webhook and on the Durable Object alarm, logging each trigger", async () => {
    stubFetch([["/orgs/Org/repos", () => json([])]]);
    const { brook, sql } = makeBrook();
    await check(brook, "/webhook");
    await brook.alarm();
    const triggers = sql
      .exec("SELECT trigger FROM checks ORDER BY id")
      .toArray();
    expect(triggers).toEqual([{ trigger: "webhook" }, { trigger: "cron" }]);
    expect(
      sql.exec("SELECT value FROM meta WHERE key = 'total_checks'").toArray(),
    ).toEqual([{ value: "2" }]);
  });
});
