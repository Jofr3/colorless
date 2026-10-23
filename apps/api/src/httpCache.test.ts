import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { privateRevalidate } from "./httpCache";

// A stand-in for the per-user GETs: the body depends on who asks, the way
// /decks depends on the session cookie.
const app = new Hono();
app.get("/mine", privateRevalidate, (c) => {
  const user = c.req.header("x-user");
  return user ? c.json({ user }) : c.json({ error: "unauthorized" }, 401);
});

describe("privateRevalidate", () => {
  it("stores per-user bodies privately and always revalidates them", async () => {
    const res = await app.request("/mine", { headers: { "x-user": "ash" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
  });

  it("304s an unchanged body and 200s a different caller's", async () => {
    const first = await app.request("/mine", { headers: { "x-user": "ash" } });
    const tag = first.headers.get("etag") ?? "";
    const same = await app.request("/mine", { headers: { "x-user": "ash", "If-None-Match": tag } });
    expect(same.status).toBe(304);
    const other = await app.request("/mine", {
      headers: { "x-user": "misty", "If-None-Match": tag },
    });
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ user: "misty" });
  });

  it("leaves errors without a Cache-Control", async () => {
    const res = await app.request("/mine");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
