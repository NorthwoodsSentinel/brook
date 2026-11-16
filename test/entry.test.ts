// The Worker entrypoint (default export): rate limiting, the POST body-size gate,
// forwarding to the singleton Durable Object, and the cron handler's authenticated
// /check. The Durable Object namespace is a stub that records what it was handed.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { makeEnv } from "./support/brook";

function namespace() {
  const forwarded: Request[] = [];
  const stub = {
    fetch: vi.fn(async (req: Request) => {
      forwarded.push(req);
      return new Response("from-do");
    }),
  };
  const ns = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => stub),
  };
  return {
    // Double cast: the entrypoint calls only idFromName() and get(), which the stub
    // implements; the rest of DurableObjectNamespace is unused.
    ns: ns as unknown as DurableObjectNamespace,
    stub,
    forwarded,
    raw: ns,
  };
}

function req(path: string, ip: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", ip);
  return new Request(`https://brook.test${path}`, { ...init, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker.fetch", () => {
  it("forwards to the brook-singleton Durable Object", async () => {
    const { ns, raw, forwarded } = namespace();
    const res = await worker.fetch(
      req("/status", "10.0.0.1"),
      makeEnv({ BROOK: ns }),
    );
    expect(await res.text()).toBe("from-do");
    expect(raw.idFromName).toHaveBeenCalledWith("brook-singleton");
    expect(forwarded[0].url).toBe("https://brook.test/status");
  });

  it("allows one /check per IP per minute", async () => {
    const { ns } = namespace();
    const env = makeEnv({ BROOK: ns });
    expect((await worker.fetch(req("/check", "10.0.0.2"), env)).status).toBe(
      200,
    );
    const limited = await worker.fetch(req("/check", "10.0.0.2"), env);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "Rate limited. Try again later.",
    });
    expect(limited.headers.get("X-Frame-Options")).toBe("DENY");
    expect((await worker.fetch(req("/check", "10.0.0.3"), env)).status).toBe(
      200,
    );

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    expect((await worker.fetch(req("/check", "10.0.0.2"), env)).status).toBe(
      200,
    );
  });

  it("allows 60 other private requests per IP per minute, then resets", async () => {
    const { ns } = namespace();
    const env = makeEnv({ BROOK: ns });
    for (let i = 0; i < 60; i++) {
      expect((await worker.fetch(req("/status", "10.0.0.4"), env)).status).toBe(
        200,
      );
    }
    expect((await worker.fetch(req("/status", "10.0.0.4"), env)).status).toBe(
      429,
    );

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    expect((await worker.fetch(req("/status", "10.0.0.4"), env)).status).toBe(
      200,
    );
  });

  it("does not rate limit the public pages", async () => {
    const { ns } = namespace();
    const env = makeEnv({ BROOK: ns });
    for (let i = 0; i < 65; i++) {
      expect((await worker.fetch(req("/daemon", "10.0.0.5"), env)).status).toBe(
        200,
      );
      expect(
        (await worker.fetch(req("/daemon/scout", "10.0.0.5"), env)).status,
      ).toBe(200);
    }
  });

  it("buckets requests without CF-Connecting-IP under 'unknown'", async () => {
    const { ns } = namespace();
    const env = makeEnv({ BROOK: ns });
    const bare = () => new Request("https://brook.test/check");
    expect((await worker.fetch(bare(), env)).status).toBe(200);
    expect((await worker.fetch(bare(), env)).status).toBe(429);
  });

  it("rejects a POST whose Content-Length exceeds 64KB, before the Durable Object sees it", async () => {
    const { ns, forwarded } = namespace();
    const env = makeEnv({ BROOK: ns });
    const big = req("/checkin", "10.0.0.6", {
      method: "POST",
      headers: { "Content-Length": String(64 * 1024 + 1) },
    });
    const res = await worker.fetch(big, env);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "Request body too large (64KB max)",
    });
    expect(forwarded).toHaveLength(0);
  });

  it("forwards a POST within the size limit, or with no Content-Length", async () => {
    const { ns, forwarded } = namespace();
    const env = makeEnv({ BROOK: ns });
    const sized = req("/checkin", "10.0.0.7", {
      method: "POST",
      headers: { "Content-Length": "10" },
    });
    expect((await worker.fetch(sized, env)).status).toBe(200);
    const unsized = req("/checkin", "10.0.0.7", { method: "POST" });
    expect((await worker.fetch(unsized, env)).status).toBe(200);
    expect(forwarded).toHaveLength(2);
  });
});

describe("worker.scheduled", () => {
  it("calls /check on the singleton with the bearer token, inside waitUntil", async () => {
    const { ns, forwarded } = namespace();
    const waits: Promise<unknown>[] = [];
    // Double cast: scheduled() calls only ctx.waitUntil(), which this object
    // implements; the rest of ExecutionContext is unused.
    const ctx = {
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    } as unknown as ExecutionContext;
    await worker.scheduled(
      {} as ScheduledEvent,
      makeEnv({ BROOK: ns, BROOK_API_KEY: "cron-key" }),
      ctx,
    );
    await Promise.all(waits);
    expect(waits).toHaveLength(1);
    expect(forwarded[0].url).toBe("https://brook/check");
    expect(forwarded[0].headers.get("Authorization")).toBe("Bearer cron-key");
  });
});
