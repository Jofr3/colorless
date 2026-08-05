// POST /lobby + GET /lobby/:code/ws against a scripted DO namespace (no
// workers runtime under vitest): code minting with collision retry, strict
// code validation, upgrade-header gating, and that the socket route forwards
// the original upgrade request to the right instance's internal /ws path.

import { isValidLobbyCode } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
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
