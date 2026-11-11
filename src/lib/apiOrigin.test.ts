import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOrigin, apiUrl, apiWebSocketUrl } from "./apiOrigin";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function pageHost(hostname: string): void {
  vi.stubGlobal("location", { hostname });
}

describe("apiOrigin", () => {
  it("defaults to wrangler dev's local port", () => {
    expect(apiOrigin()).toBe("http://localhost:8787");
  });

  it("reads VITE_API_ORIGIN and strips a trailing slash", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com/");
    expect(apiOrigin()).toBe("https://api.example.com");
  });

  it("keeps a dev page's loopback name, so its writes are same-site", () => {
    pageHost("127.0.0.1");
    expect(apiOrigin()).toBe("http://127.0.0.1:8787");
    pageHost("localhost");
    expect(apiOrigin()).toBe("http://localhost:8787");
  });

  it("uses localhost for a dev page on any other host", () => {
    pageHost("192.168.1.20");
    expect(apiOrigin()).toBe("http://localhost:8787");
  });

  it("ignores the page's host outside dev", () => {
    vi.stubEnv("DEV", false);
    pageHost("127.0.0.1");
    expect(apiOrigin()).toBe("http://localhost:8787");
  });

  it("prefers VITE_API_ORIGIN over the page's loopback name", () => {
    vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:41234");
    pageHost("127.0.0.1");
    expect(apiOrigin()).toBe("http://127.0.0.1:41234");
  });
});

describe("apiUrl", () => {
  it("prefixes the path with the origin", () => {
    expect(apiUrl("/lobby")).toBe("http://localhost:8787/lobby");
  });
});

describe("apiWebSocketUrl", () => {
  it("derives ws:// from an http origin", () => {
    expect(apiWebSocketUrl("/lobby/ABCD/ws")).toBe("ws://localhost:8787/lobby/ABCD/ws");
  });

  it("follows a dev page's loopback name", () => {
    pageHost("127.0.0.1");
    expect(apiWebSocketUrl("/lobby/ABCD/ws")).toBe("ws://127.0.0.1:8787/lobby/ABCD/ws");
  });

  it("derives wss:// from an https origin", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com");
    expect(apiWebSocketUrl("/lobby/ABCD/ws")).toBe("wss://api.example.com/lobby/ABCD/ws");
  });
});
