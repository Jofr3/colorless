import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveSetup } from "@colorless/engine/testing";
import { LuaSimulator } from "./simulator";
import { editDestination, editFromCommand, SimulatorEdit } from "./simulatorEdit";
import { fetchCardPool } from "../game/cardPool";
import { loadCardIndex, searchCards } from "../decks/catalog";
import type { BuilderCard } from "../decks/cards";
import { WIRE_ROWS, wireColumn } from "./wireFields";
import { memoryStorage } from "../test/storageStub";

vi.mock("../decks/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../decks/catalog")>()),
  loadCardIndex: vi.fn(() => new Promise(() => {})),
  searchCards: vi.fn(() => []),
}));
vi.mock("../game/cardPool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/cardPool")>()),
  fetchCardPool: vi.fn(async () => ({ pool: {}, missing: [] })),
}));

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const publish = vi.fn();
  const sim = new LuaSimulator(publish, vi.fn());
  sim.open({ state: driveSetup(7), events: [], names: { p1: "A", p2: "B" }, startedAt: 100 });
  return { sim, publish };
}
function editRow(publish: ReturnType<typeof vi.fn>) {
  const rows: string[][] = (publish.mock.lastCall?.[0] ?? "")
    .split("\n")
    .map((s: string) => s.split("\t").map(decodeURIComponent));
  return rows.find((r) => r[0] === "E");
}
const field = (row: string[] | undefined, name: string) =>
  row?.[wireColumn(WIRE_ROWS.sim.edit, name as "state")];

describe("edit-mode commands", () => {
  it("reads Lua's drop zones, an onto drop naming the Active as -1", () => {
    expect(editDestination("hand", "")).toEqual({ zone: "hand" });
    expect(editDestination("onto", "-1")).toEqual({ zone: "onto", target: { spot: "active" } });
    expect(editDestination("onto", "2")).toEqual({
      zone: "onto",
      target: { spot: "bench", index: 2 },
    });
    expect(editDestination("onto", "x")).toBeNull();
    expect(editDestination("playmat", "")).toBeNull();
  });
  it("turns a Prize flip's slot into that Prize's uid", () => {
    expect(editFromCommand(["flip", "1"], (i) => ["a", "b"][i])).toEqual({
      edit: { kind: "flipPrize", uid: "b" },
    });
    expect(editFromCommand(["flip", "9"], () => undefined)).toBeNull();
    expect(editFromCommand(["add", "sv1-1", "bench", ""], () => undefined)).toEqual({
      add: "sv1-1",
      to: { zone: "bench" },
    });
  });
});

describe("edit mode on the hot-seat table", () => {
  it("opens on the turn, moves a hand card to the discard, and undo takes it back", () => {
    const { sim, publish } = setup();
    expect(sim.host?.game.phase.kind).toBe("turn:action");
    expect(field(editRow(publish), "available")).toBe("true");
    sim.command("edit-mode\ton");
    expect(field(editRow(publish), "state")).toBe("on");
    const seat = sim.view()?.seat ?? "p1";
    const uid = sim.host?.game.players[seat].hand[0] ?? "";
    sim.command(`edit\tmove\t${uid}\tdiscard\t`);
    expect(sim.host?.game.players[seat].discard).toContain(uid);
    expect(sim.host?.game.players[seat].hand).not.toContain(uid);
    sim.command("history\tundoAction");
    expect(sim.host?.game.players[seat].hand).toContain(uid);
  });
  it("flips a Prize face up by its slot", () => {
    const { sim } = setup();
    sim.command("edit-mode\ton");
    const seat = sim.view()?.seat ?? "p1";
    const prize = sim.host?.game.players[seat].prizes[2];
    sim.command("edit\tflip\t2");
    expect(sim.host?.game.players[seat].faceUpPrizes).toEqual([prize]);
  });
  it("turns every revealed Prize back face down as edit mode closes", () => {
    const { sim } = setup();
    sim.command("edit-mode\ton");
    const seat = sim.view()?.seat ?? "p1";
    sim.command("edit\tflip\t0");
    sim.command("edit\tflip\t3");
    expect(sim.host?.game.players[seat].faceUpPrizes).toHaveLength(2);
    sim.command("edit-mode\toff");
    expect(sim.host?.game.players[seat].faceUpPrizes).toEqual([]);
    sim.command("history\tundoAction");
    expect(sim.host?.game.players[seat].faceUpPrizes).toHaveLength(2);
  });
  it("shows the seated player's deck top first only while editing", () => {
    const { sim } = setup();
    sim.command("pile\tdeck");
    expect(sim.menu).toBeNull();
    sim.command("edit-mode\ton");
    sim.command("pile\tdeck");
    const seat = sim.view()?.seat ?? "p1";
    expect(sim.menu?.options.map((o) => o.uid)).toEqual(sim.host?.game.players[seat].deck);
  });
  it("keeps an open tray's menu id across its edits, so Lua refreshes it in place", () => {
    const { sim, publish } = setup();
    sim.command("edit-mode\ton");
    sim.command("pile\tdeck");
    const menuRow = () => {
      const rows: string[][] = (publish.mock.lastCall?.[0] ?? "")
        .split("\n")
        .map((s: string) => s.split("\t").map(decodeURIComponent));
      return rows.find((r) => r[0] === "M");
    };
    const id = (row: string[] | undefined) => row?.[wireColumn(WIRE_ROWS.sim.menu, "id")];
    const before = menuRow();
    const seat = sim.view()?.seat ?? "p1";
    const top = sim.host?.game.players[seat].deck[0] ?? "";
    const calls = publish.mock.calls.length;
    sim.command(`edit\tmove\t${top}\thand\t`);
    expect(sim.host?.game.players[seat].hand).toContain(top);
    for (const [raw] of publish.mock.calls.slice(calls))
      expect((raw as string).split("\n").some((r) => r.startsWith("M\t"))).toBe(true);
    expect(id(menuRow())).toBe(id(before));
    expect(sim.menu?.options.map((o) => o.uid)).toEqual(sim.host?.game.players[seat].deck);
  });
  it("ignores an edit while edit mode is off", () => {
    const { sim } = setup();
    const seat = sim.view()?.seat ?? "p1";
    const hand = sim.host?.game.players[seat].hand;
    sim.command(`edit\tmove\t${hand?.[0]}\tdiscard\t`);
    expect(sim.host?.game.players[seat].hand).toEqual(hand);
  });
});

describe("the gallery's prefetch", () => {
  const card = (i: number) =>
    ({ cardId: `c${i}`, name: `Card ${i}`, hasImage: true }) as unknown as BuilderCard;
  it("names the two pages either side, nearest first, and prefetches their cards", async () => {
    vi.mocked(loadCardIndex).mockResolvedValueOnce({} as Awaited<ReturnType<typeof loadCardIndex>>);
    vi.mocked(searchCards).mockReturnValueOnce(Array.from({ length: 50 }, (_, i) => card(i)));
    const edit = new SimulatorEdit(() => {});
    edit.perPage = 10;
    edit.open();
    await vi.waitFor(() => expect(edit.total).toBe(50));
    edit.setPage(3, 10);
    const ids = (cards: readonly BuilderCard[]) => cards.map((c) => c.cardId);
    expect(ids(edit.pageCards())).toEqual(ids(Array.from({ length: 10 }, (_, i) => card(20 + i))));
    const pages = [4, 2, 5, 1].map((p) =>
      Array.from({ length: 10 }, (_, i) => `c${(p - 1) * 10 + i}`),
    );
    expect(ids(edit.nearbyCards())).toEqual(pages.flat());
    expect(edit.art().map(([id]) => id)).toEqual([...ids(edit.pageCards()), ...pages.flat()]);
    await vi.waitFor(() =>
      expect(vi.mocked(fetchCardPool).mock.calls.some(([list]) => list.includes("c40"))).toBe(true),
    );
  });
});
