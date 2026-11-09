import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { afterResponse } from "./afterResponse";
import { resetLogThrottle } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
  resetLogThrottle();
});

const failing = async () => {
  throw new Error("R2 PUT failed");
};

describe("afterResponse", () => {
  it("keeps a failure out of the response and logs it with the route by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = new Hono().get("/things/:id", async (c) => {
      await afterResponse(c, failing);
      return c.text("ok");
    });
    const res = await app.request("/things/7");
    expect(res.status).toBe(200);
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { evt: "after_response", kind: "failed", route: "/things/:id", error: "Error", quota: false },
    ]);
  });

  it("flags a failure that reads as a spent quota, without its message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = new Hono().get("/", async (c) => {
      await afterResponse(c, async () => {
        throw new TypeError("KV put() limit exceeded for the day.");
      });
      return c.text("ok");
    });
    expect((await app.request("/")).status).toBe(200);
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { evt: "after_response", kind: "failed", route: "/", error: "TypeError", quota: true },
    ]);
  });

  it("hands a failure to the caller's onError instead", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn();
    const app = new Hono().get("/", async (c) => {
      await afterResponse(c, failing, onError);
      return c.text("ok");
    });
    expect((await app.request("/")).status).toBe(200);
    expect(onError).toHaveBeenCalledWith(new Error("R2 PUT failed"));
    expect(warn).not.toHaveBeenCalled();
  });
});
