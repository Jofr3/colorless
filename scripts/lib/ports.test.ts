import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { freePort, portAvailable, reservePorts, systemPort } from "./ports";

const HOST = "127.0.0.1";
const open: Server[] = [];

function listen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    open.push(server);
    server.once("error", reject);
    server.listen(port, HOST, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}

afterEach(async () => {
  await Promise.all(
    open.splice(0).map((server) => new Promise((done) => server.close(() => done(undefined)))),
  );
});

describe("portAvailable", () => {
  it("is false for a bound port and true once it is released", async () => {
    const port = await listen(0);
    expect(await portAvailable(HOST, port)).toBe(false);
    await new Promise((done) => open.pop()?.close(() => done(undefined)));
    expect(await portAvailable(HOST, port)).toBe(true);
  });
});

describe("freePort", () => {
  it("skips a bound port and a port it already gave, and never repeats one", async () => {
    const busy = await listen(0);
    const first = await freePort(HOST, busy);
    expect(first).toBeGreaterThan(busy);
    const second = await freePort(HOST, busy);
    expect(second).toBeGreaterThan(busy);
    expect(second).not.toBe(first);
  });

  it("skips reserved ports", async () => {
    const base = await systemPort();
    reservePorts([base + 1, base + 2]);
    const port = await freePort(HOST, base + 1);
    expect(port).toBeGreaterThan(base + 2);
  });

  it("takes exactly the override, and fails when it is bound", async () => {
    const busy = await listen(0);
    await expect(freePort(HOST, 2000, String(busy))).rejects.toThrow(
      `No available port on ${HOST} in ${busy}–${busy}.`,
    );
  });

  it("rejects an override that is not a usable port", async () => {
    for (const bad of ["abc", "80", "70000", "8000.5"])
      await expect(freePort(HOST, 2000, bad)).rejects.toThrow(`Invalid port: ${bad}`);
  });
});

describe("systemPort", () => {
  it("hands out distinct free ports", async () => {
    const ports = await Promise.all([systemPort(), systemPort(), systemPort()]);
    expect(new Set(ports).size).toBe(3);
    for (const port of ports) expect(await portAvailable(HOST, port)).toBe(true);
  });

  it("records what it hands out, so freePort never gives the same port", async () => {
    const port = await systemPort();
    expect(await freePort(HOST, port)).not.toBe(port);
  });
});
