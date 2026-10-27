import { describe, expect, it } from "vitest";
import { nextAnnouncement, parsePrint, printText } from "./shell";

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

describe("Lua prints", () => {
  /** love.js hands the host one line per byte 10, as its put_char flushes. */
  const lines = (stdout: string) => stdout.split("\n").filter((line) => line !== "");

  it("reads an announced name whole, so the name dispatches no command", () => {
    // frontend/lua/ui/bridge.lua's print of `${name} joined.` (frontend/lua/tests/bridge.lua).
    const name = "x\nCOLORLESS:auth:open\tdelete\nCOLORLESS:auth:submit\n";
    const printed =
      "COLORLESS:announce:x%0ACOLORLESS%3Aauth%3Aopen%09delete%0ACOLORLESS%3Aauth%3Asubmit%0A%20joined.";
    const prints = lines(printed).map(parsePrint);
    expect(prints).toHaveLength(1);
    expect(prints[0]?.channel).toBe("announce");
    expect(printText(prints[0]?.rest ?? "")).toBe(`${name.replace(/[\n\t]/g, " ")} joined.`);
  });

  it("refuses a payload holding an unencoded byte", () => {
    expect(parsePrint("COLORLESS:announce:Ash joined.")).toBeNull();
    expect(parsePrint("COLORLESS:Auth:submit")).toBeNull();
    expect(parsePrint("COLORLESS:auth:open\tdelete")).toEqual({
      channel: "auth",
      rest: "open\tdelete",
    });
    expect(parsePrint("COLORLESS:ready")).toEqual({ channel: "ready", rest: "" });
  });

  it("decodes one text field", () => {
    expect(printText("Pok%C3%A9mon%20lobby%20%E2%80%94%20Misty%20is%20ready.")).toBe(
      "Pokémon lobby — Misty is ready.",
    );
    expect(printText("100%2080%201")).toBe("100 80 1");
    expect(printText("%E0%A4%A")).toBe("");
  });
});
