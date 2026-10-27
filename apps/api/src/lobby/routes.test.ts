import { isValidLobbyCode } from "@colorless/schema";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Env } from "../env";
import { resetLogThrottle } from "../http/log";
import app from "../index";

type SeenRequest = { instance: string; url: string; method: string; upgrade: string | null };

/** An Env whose LOBBY namespace records every stub fetch and answers with the
    scripted handler. The other bindings stay undefined — any touch throws. */
function envWithLobby(handler: (seen: SeenRequest) => Response): { env: Env; seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: (input: Request | string, init?: RequestInit) => {
        const request = typeof input === "string" ? new Request(input, init) : input;
        const record: SeenRequest = {
          instance: id.name,
          url: request.url,
          method: request.method,
          upgrade: request.headers.get("Upgrade"),
        };
        seen.push(record);
        return Promise.resolve(handler(record));
      },
    }),
  };
  return { env: { LOBBY: namespace } as unknown as Env, seen };
}

describe("POST /lobby", () => {
  it("mints a valid code claimed through the code's own DO", async () => {
    const { env, seen } = envWithLobby(() => Response.json({}, { status: 201 }));
    const res = await app.request("/lobby", { method: "POST" }, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string };
    expect(isValidLobbyCode(body.code)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      instance: body.code,
      url: "https://lobby-do/create",
      method: "POST",
    });
  });

  it("retries a colliding code and returns the successful draw", async () => {
    let calls = 0;
    const { env, seen } = envWithLobby(() =>
      Response.json({}, { status: ++calls === 1 ? 409 : 201 }),
    );
    const res = await app.request("/lobby", { method: "POST" }, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string };
    expect(seen).toHaveLength(2);
    expect(seen[1]?.instance).toBe(body.code);
  });

  it("gives up after five straight collisions", async () => {
    const { env, seen } = envWithLobby(() => Response.json({}, { status: 409 }));
    const res = await app.request("/lobby", { method: "POST" }, env);
    expect(res.status).toBe(503);
    expect(seen).toHaveLength(5);
  });
});

describe("GET /lobby/:code/ws", () => {
  const marker = () => new Response("do-reached", { headers: { "x-marker": "do" } });

  it("404s malformed codes without touching the namespace", async () => {
    const { env, seen } = envWithLobby(marker);
    for (const code of ["ABC", "ABCDE", "abcd", "AB0D"]) {
      const res = await app.request(`/lobby/${code}/ws`, {}, env);
      expect(res.status).toBe(404);
    }
    expect(seen).toHaveLength(0);
  });

  it("426s a plain GET without an upgrade header", async () => {
    const { env, seen } = envWithLobby(marker);
    const res = await app.request("/lobby/ABCD/ws", {}, env);
    expect(res.status).toBe(426);
    expect(seen).toHaveLength(0);
  });

  it("forwards a websocket upgrade to the code's DO and returns its response", async () => {
    const { env, seen } = envWithLobby(marker);
    const res = await app.request("/lobby/ABCD/ws", { headers: { Upgrade: "websocket" } }, env);
    expect(res.headers.get("x-marker")).toBe("do");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      instance: "ABCD",
      url: "https://lobby-do/ws",
      upgrade: "websocket",
    });
  });
});

describe("per-IP limits on POST /lobby and the /ws upgrade", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLogThrottle();
  });

  /** A rate-limit binding allowing `limit` calls per key, recording each key it is asked for. */
  function fakeLimiter(limit: number) {
    const counts = new Map<string, number>();
    const keys: string[] = [];
    const binding = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return { success: count <= limit };
      },
    };
    return { binding, keys };
  }

  const from = (ip: string, headers: Record<string, string> = {}) => ({
    headers: { "cf-connecting-ip": ip, ...headers },
  });

  const logged = (warn: MockInstance<typeof console.warn>) =>
    warn.mock.calls.map(([line]) => JSON.parse(String(line)));

  it("429s an address over the create budget and lets another through", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, seen } = envWithLobby(() => Response.json({}, { status: 201 }));
    const limited = { ...env, LOBBY_CREATE_LIMIT: fakeLimiter(2).binding };
    const post = (ip: string) => app.request("/lobby", { method: "POST", ...from(ip) }, limited);
    expect((await post("203.0.113.9")).status).toBe(201);
    expect((await post("203.0.113.9")).status).toBe(201);
    const refused = await post("203.0.113.9");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
    expect(await refused.json()).toEqual({ error: "too many requests" });
    expect((await post("198.51.100.7")).status).toBe(201);
    expect(seen).toHaveLength(3);
    expect(logged(warn)).toEqual([{ evt: "lobby", kind: "rate_limited", route: "create" }]);
  });

  it("counts only upgrades that would reach a DO, keyed by the IPv6 /64", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, seen } = envWithLobby(
      () => new Response("do-reached", { headers: { "x-marker": "do" } }),
    );
    const limiter = fakeLimiter(1);
    const limited = { ...env, LOBBY_SOCKET_LIMIT: limiter.binding };
    const upgrade = { Upgrade: "websocket" };
    const socket = (code: string, ip: string, headers: Record<string, string> = upgrade) =>
      app.request(`/lobby/${code}/ws`, from(ip, headers), limited);
    expect((await socket("ABC", "2001:db8::1")).status).toBe(404);
    expect((await socket("ABCD", "2001:db8::1", {})).status).toBe(426);
    expect((await socket("ABCD", "2001:db8::1")).headers.get("x-marker")).toBe("do");
    expect((await socket("ABCD", "2001:db8::2")).status).toBe(429);
    expect(limiter.keys).toEqual(["2001:db8:0:0::/64", "2001:db8:0:0::/64"]);
    expect(seen).toHaveLength(1);
  });

  it("lets requests through when the binding fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env } = envWithLobby(() => Response.json({}, { status: 201 }));
    const broken = { limit: () => Promise.reject(new Error("limiter unavailable")) };
    const res = await app.request(
      "/lobby",
      { method: "POST" },
      { ...env, LOBBY_CREATE_LIMIT: broken },
    );
    expect(res.status).toBe(201);
    expect(logged(warn)).toEqual([
      { evt: "lobby", kind: "limiter_error", route: "create", error: "Error" },
    ]);
  });
});
