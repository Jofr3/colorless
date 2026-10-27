import { describe, expect, it } from "vitest";
import { ipKey } from "./clientIp";

describe("ipKey", () => {
  it("keeps an IPv4 address whole", () => {
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
  });

  it("reduces an IPv6 address to its /64, however it is written", () => {
    const prefix = "2001:db8:0:12::/64";
    expect(ipKey("2001:db8:0:12::1")).toBe(prefix);
    expect(ipKey("2001:0DB8:0000:0012:abcd:1:2:3")).toBe(prefix);
    expect(ipKey("2001:db8::12:0:0:0:9")).toBe("2001:db8:0:12::/64");
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
  });
});
