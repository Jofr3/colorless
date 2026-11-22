import { describe, expect, it, vi } from "vitest";
import { withHistory, type SidebarHost } from "./simulatorSidebar";
import type { TableHistory, TableSource } from "./tableSource";
import type { SimMenu } from "./simulatorTypes";

const host: SidebarHost = { action: vi.fn(), command: vi.fn(), history: vi.fn() };
const history: TableHistory = {
  turns: () => ({ index: 0, count: 1 }),
  canStep: () => true,
  step: vi.fn(),
};
const menu: SimMenu = {
  kind: "cards",
  title: "",
  options: [],
  footer: [{ label: "0/1", colour: "blue", run: vi.fn() }],
  mandatory: true,
};
const source = (mode: TableSource["mode"]) => ({ mode, history }) as unknown as TableSource;
const labels = (m: SimMenu) => (m.footer ?? []).map((o) => o.label);

describe("withHistory", () => {
  it("puts Undo left of a hot-seat prompt's confirm button", () => {
    expect(labels(withHistory(host, source("local"), menu))).toEqual(["Undo", "0/1"]);
  });
  it("never offers Undo on an online prompt", () => {
    expect(labels(withHistory(host, source("online"), menu))).toEqual(["0/1"]);
  });
});
