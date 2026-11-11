import { describe, expect, it } from "vitest";
import { loopbackOrigin, pairLine, parseMode } from "./dev-tailnet";

describe("dev-tailnet's arguments", () => {
  it("runs over Tailscale by default and locally with --local", () => {
    expect(parseMode([])).toBe("tailnet");
    expect(parseMode(["--local"])).toBe("local");
  });

  it("refuses anything else, so a typo never falls back to Tailscale", () => {
    expect(() => parseMode(["--locl"])).toThrow("Unknown argument: --locl");
    expect(() => parseMode(["--local", "extra"])).toThrow("Unknown argument: extra");
  });
});

describe("the local pair", () => {
  it("puts the page and the API on the name Vite binds, so they are same-site", () => {
    expect(loopbackOrigin(5191)).toBe("http://127.0.0.1:5191");
  });

  it("prints one line a script can split on spaces and =", () => {
    const line = pairLine(loopbackOrigin(5191), loopbackOrigin(8797), 9239);
    expect(Object.fromEntries(line.split(" ").map((field) => field.split("=")))).toEqual({
      web: "http://127.0.0.1:5191",
      api: "http://127.0.0.1:8797",
      inspector: "9239",
    });
  });
});
