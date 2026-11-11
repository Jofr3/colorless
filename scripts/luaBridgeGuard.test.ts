import { describe, expect, it } from "vitest";
import { luaBridgeReport } from "./lua-bridge-guard";

const report = (path: string, text: string) => luaBridgeReport([{ path, text }]);

describe("lua-bridge-guard", () => {
  it("passes LÖVE drawing and the bridge's own print", () => {
    expect(report("ui/card.lua", "g.print(index,14,10)\nlove.graphics.print('x')").ok).toBe(true);
    expect(report("ui/x.lua", "Bridge.emit('announce',name..' joined.')").ok).toBe(true);
    expect(report("ui/bridge.lua", "print('COLORLESS:'..channel)").ok).toBe(true);
  });

  it.each([
    ["a COLORLESS: print", "print('COLORLESS:announce:'..text)"],
    ["a print at the start of a line", "local x=1\nprint(x)"],
    ["string-call syntax", "if a then print'x' end"],
    ["an alias of the global", "local out=print"],
    ["_G.print", "_G.print(name)"],
    ["io.write", "io.write(name)"],
    ["a COLORLESS: literal", "local prefix='COLORLESS:'"],
  ])("fails %s", (_label, text) => {
    const result = report("main.lua", text);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("frontend/lua/main.lua");
  });

  it("names the line of each hit, every rule it breaks there, in line order", () => {
    const text = "local a=1\nio.write(a)\nlocal b=2\nprint('COLORLESS:x')\nprint(b)";
    expect(report("ui/x.lua", text).lines.filter((line) => line.startsWith("  "))).toEqual([
      "  frontend/lua/ui/x.lua:2: io.write or io.stdout",
      "  frontend/lua/ui/x.lua:4: the global print, a COLORLESS: literal",
      "  frontend/lua/ui/x.lua:5: the global print",
    ]);
  });
});
