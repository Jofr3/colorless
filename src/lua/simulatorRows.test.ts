import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  driveSetup,
  KNOCKOUT_DECK,
  MIXED_DECK,
  RARE_CANDY_DECK,
} from "../../packages/engine/src/testFixtures";
import { LuaSimulator } from "./simulator";
import {
  boardRows,
  EmitFrame,
  type EmitState,
  headerRow,
  sidebarRows,
  tableRows,
} from "./simulatorRows";
import { SimulatorOrder } from "./simulatorOrder";
import { LocalTableSource } from "./tableSource";
import { encodeFields } from "./wire";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const parse = (raw: string) => raw.split("\n").map((r) => r.split("\t").map(decodeURIComponent));
const setup = (seed: number, deck: typeof MIXED_DECK) => ({
  state: driveSetup(seed, { p1: deck, p2: deck }),
  events: [],
  names: { p1: "Player 1", p2: "Player 2" },
  startedAt: 100 + seed,
});

/** A random click: an offered button (attacks favoured) or a drag of an own card. */
function click(sim: LuaSimulator, raw: string, r: () => number) {
  const rows = parse(raw);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const rev = rows[0]?.[0] ?? "";
  const ids = (keep: (row: string[]) => boolean) =>
    rows.filter((x) => x[1] && keep(x)).map((x) => x[1] ?? "");
  const menu = ids((x) => (x[0] === "O" || x[0] === "F") && x[4] === "false");
  const attacks = ids((x) => x[0] === "K" && x[5] === "false" && x[10] === "true");
  const buttons = ids((x) => (x[0] === "K" && x[5] === "false") || x[0] === "A");
  const own = rows.filter((x) => x[0] === "C" && x[4] === "you" && x[5] === "hand");
  const choice =
    menu.length && r() < 0.8
      ? menu
      : attacks.length && r() < 0.4
        ? attacks
        : own.length && r() < 0.3
          ? null
          : buttons;
  if (choice?.length) sim.command(encodeFields(["invoke", rev, pick(choice) ?? ""]));
  else if (own.length) {
    const c = pick(own) ?? [];
    const to = pick(["active", "bench", "playmat"]) ?? "bench";
    sim.command(encodeFields(["move", c[1] ?? "", "hand", c[6] ?? "", to, "0"]));
  } else sim.command("dismiss");
}

describe("LuaSimulator.emit", () => {
  it("a re-emit repeats every row but the revision and the consumed shuffle", () => {
    let shuffles = 0;
    for (const [seed, deck] of [
      [3, MIXED_DECK],
      [5, KNOCKOUT_DECK],
      [2, RARE_CANDY_DECK],
    ] as const) {
      const r = rng(seed);
      const published: string[] = [];
      const sim = new LuaSimulator(
        (raw) => published.push(raw),
        () => {},
      );
      sim.open(setup(seed, deck));
      for (let i = 0; i < 120; i++) {
        click(sim, published.at(-1) ?? "", r);
        const first = parse(published.at(-1) ?? "");
        sim.emit();
        const again = parse(published.at(-1) ?? "");
        const [head = [], ...rest] = first;
        const [headAgain = [], ...restAgain] = again;
        expect(Number(headAgain[0])).toBe(Number(head[0]) + 1);
        expect(headAgain[19]).toBe("");
        expect(headAgain.slice(1, 19)).toEqual(head.slice(1, 19));
        expect(headAgain.slice(20)).toEqual(head.slice(20));
        expect(restAgain).toEqual(rest);
        if (head[19]) shuffles++;
      }
    }
    expect(shuffles).toBeGreaterThan(0);
  });

  it("the row builders read the state without changing it", () => {
    const src = new LocalTableSource(setup(4, MIXED_DECK));
    const view = src.view();
    const s: EmitState = {
      src,
      view,
      names: src.names(),
      online: false,
      turns: src.turns(),
      message: "",
      pendingRareCandy: null,
      knockedOut: ["p2#1"],
      menu: null,
      menuId: 0,
      cardOrder: new SimulatorOrder(104),
      now: Date.now(),
    };
    const build = () => {
      const f = new EmitFrame();
      headerRow(f, s, 1, { shuffled: "you" });
      tableRows(f, s);
      boardRows(f, s, view, src, {
        you: { played: [], discard: view.board.you.discard },
        opponent: { played: [], discard: view.board.opponent.discard },
      });
      sidebarRows(f, [{ label: "End turn", run: () => {} }], false);
      return f;
    };
    const game = src.host.game;
    const a = build();
    const b = build();
    expect(b.rows).toEqual(a.rows);
    expect([...b.handlers.keys()]).toEqual([...a.handlers.keys()]);
    expect([...b.infoIds]).toEqual([...a.infoIds]);
    expect(src.host.game).toBe(game);
    expect(parse(a.rows.join("\n")).filter((x) => x[0] === "D")).toEqual([["D", "p2#1"]]);
  });
});
