import { afterEach, describe, expect, it, vi } from "vitest";
import { startOAuth } from "./startOAuth";

// The probe's three outcomes. The redirect case can't be exercised against
// wrangler dev until real provider secrets exist, so it's pinned here to the
// fetch spec shape (`redirect: "manual"` cross-origin → an opaqueredirect
// with status 0); the 503 case matches what the local api actually serves.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startOAuth", () => {
  it("navigates to the start url when the probe sees an opaqueredirect", async () => {
    const fetchMock = vi.fn(async () => ({ type: "opaqueredirect", status: 0 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();

    expect(await startOAuth("discord", navigate)).toBe("redirected");

    expect(navigate).toHaveBeenCalledTimes(1);
    const target = navigate.mock.calls[0]?.[0] as string;
    expect(target.endsWith("/auth/oauth/discord")).toBe(true);
    // The probe itself must not follow the redirect and must send the cookie.
    expect(fetchMock).toHaveBeenCalledWith(target, {
      redirect: "manual",
      credentials: "include",
    });
  });

  it("reports 503 as unconfigured without navigating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ type: "basic", status: 503 }) as Response),
    );
    const navigate = vi.fn();

    expect(await startOAuth("google", navigate)).toBe("unconfigured");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reports unexpected statuses and network failures as failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ type: "basic", status: 500 }) as Response),
    );
    const navigate = vi.fn();
    expect(await startOAuth("google", navigate)).toBe("failed");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    expect(await startOAuth("discord", navigate)).toBe("failed");
    expect(navigate).not.toHaveBeenCalled();
  });
});
