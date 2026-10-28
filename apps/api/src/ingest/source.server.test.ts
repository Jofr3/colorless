// The fetch transport against a real HTTP server on localhost: real sockets, a real deadline.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSource } from "./source";

let server: Server;
let baseUrl: string;
const hits = new Map<string, number>();

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "";
    const hit = (hits.get(path) ?? 0) + 1;
    hits.set(path, hit);
    if (path === "/cards/flaky" && hit === 1) {
      response.writeHead(503, { "retry-after": "0" }).end("busy");
    } else if (path === "/cards/stalled") {
      // Never answers.
    } else if (path === "/cards/missing") {
      response.writeHead(404).end();
    } else {
      response.writeHead(200, { "content-type": "application/json" }).end(`{"id":"ok"}`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const instant = async () => {};

describe("createSource over a local server", () => {
  it("retries a 503 and returns the next answer", async () => {
    const source = createSource("fetch", { baseUrl, delayMs: 0, sleep: instant });
    await expect(source.getCard("flaky")).resolves.toEqual({ id: "ok" });
    expect(hits.get("/cards/flaky")).toBe(2);
  });

  it("cuts a request that never answers at its deadline, then gives up", async () => {
    const source = createSource("fetch", {
      baseUrl,
      delayMs: 0,
      sleep: instant,
      timeoutMs: 100,
      retries: 1,
    });
    await expect(source.getCard("stalled")).rejects.toThrow(
      "timed out after 100 ms for /cards/stalled (2 attempts)",
    );
    expect(hits.get("/cards/stalled")).toBe(2);
  });

  it("does not retry a 404", async () => {
    const source = createSource("fetch", { baseUrl, delayMs: 0, sleep: instant });
    await expect(source.getCard("missing")).rejects.toThrow("HTTP 404 for /cards/missing");
    expect(hits.get("/cards/missing")).toBe(1);
  });
});
