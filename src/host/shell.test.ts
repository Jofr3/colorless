import { describe, expect, it } from "vitest";
import { nextAnnouncement } from "./shell";

describe("nextAnnouncement", () => {
  it("changes the live region's text even when the same message repeats", () => {
    const first = nextAnnouncement("", "Can't be played online.");
    const second = nextAnnouncement(first, "Can't be played online.");
    const third = nextAnnouncement(second, "Can't be played online.");
    expect(first).toBe("Can't be played online.");
    expect(second).not.toBe(first);
    expect(second.trim()).toBe(first);
    expect(third).toBe(first);
  });
});
