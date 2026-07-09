import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOrigin, apiUrl, apiWebSocketUrl } from "./apiOrigin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apiOrigin", () => {
  it("defaults to wrangler dev's local port", () => {
    expect(apiOrigin()).toBe("http://localhost:8787");
  });

  it("reads VITE_API_ORIGIN and strips a trailing slash", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com/");
    expect(apiOrigin()).toBe("https://api.example.com");
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

  it("derives wss:// from an https origin", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com");
    expect(apiWebSocketUrl("/lobby/ABCD/ws")).toBe("wss://api.example.com/lobby/ABCD/ws");
  });
});
