// Builders shared by the test files: a Brook Durable Object over a fresh in-memory
// SQLite database, a request helper that sends the bearer token by default, and a
// fetch stub that answers by URL so the GitHub scan never leaves the process.
import { vi } from "vitest";
import { Brook } from "../../src/index";
import { createSql, createState, type FakeSql } from "./sql";

export type Env = ConstructorParameters<typeof Brook>[1];

export const API_KEY = "test-api-key";

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    // Double cast: the Durable Object under test is constructed directly, so it
    // never reaches its own namespace binding; the entry tests pass a stub here.
    BROOK: undefined as unknown as DurableObjectNamespace,
    GITHUB_TOKEN: "test-github-token",
    BROOK_API_KEY: API_KEY,
    GITHUB_ORG: "Org",
    FLEET_BRIDGE_REPO: "fleet-bridge",
    ALERT_THRESHOLD_COMMITS: "20",
    ALERT_THRESHOLD_FILES: "100",
    ALERT_THRESHOLD_REPOS: "2",
    ...overrides,
  };
}

export function makeBrook(overrides: Partial<Env> = {}): {
  brook: Brook;
  sql: FakeSql;
  env: Env;
} {
  const sql = createSql();
  const env = makeEnv(overrides);
  const brook = new Brook(createState(sql), env);
  return { brook, sql, env };
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  auth?: string | null;
}

export function request(path: string, opts: CallOptions = {}): Request {
  const headers: Record<string, string> = {};
  const auth = opts.auth === undefined ? `Bearer ${API_KEY}` : opts.auth;
  if (auth !== null) headers["Authorization"] = auth;
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  return new Request(`https://brook.test${path}`, {
    method: opts.method ?? "GET",
    headers,
    body,
  });
}

export function call(
  brook: Brook,
  path: string,
  opts: CallOptions = {},
): Promise<Response> {
  return brook.fetch(request(path, opts));
}

export type Route = (url: string) => Response | Promise<Response>;

// Stub global fetch. Each route is matched by substring, first match wins; an
// unmatched URL answers 404 so a missing route shows up as a skipped step.
export function stubFetch(routes: Array<[string, Route]>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    for (const [match, route] of routes) {
      if (url.includes(match)) return route(url);
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

export function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}
