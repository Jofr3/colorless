import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveSetup, KNOCKOUT_DECK, MIXED_DECK, RARE_CANDY_DECK } from "@colorless/engine/testing";
import { redactGame } from "@colorless/engine";
import type { LogCue, SeatLogEntry } from "@colorless/schema";
import { LuaSimulator } from "./simulator";
import type { SimMenu } from "./simulatorTypes";
import {
  ANNOUNCE_LOG_ROWS,
  type AnnounceInput,
  announcement,
  NOTHING_HEARD,
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
import { type RowKind, WIRE_ROWS, wireColumn } from "./wireFields";
import { memoryStorage } from "../test/storageStub";

const SIM = WIRE_ROWS.sim;
const at =
  <K extends RowKind>(kind: K) =>
  (row: string[], field: K["fields"][number]) =>
    row[wireColumn(kind, field)];
const header = at(SIM.header);
const option = at(SIM.option);
const cardAction = at(SIM.cardAction);
const sidebar = at(SIM.sidebar);
const card = at(SIM.card);
const SHUFFLED = wireColumn(SIM.header, "shuffled");
const ANNOUNCE = wireColumn(SIM.header, "announce");

let keys = 0;
beforeEach(() => {
  keys = 0;
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  // A restart keys its game from the CSPRNG. A fixed stream of keys keeps the walks repeatable;
  // the emit test's one shuffle is a mulligan in a restarted game, so the stream is one whose
  // deals reach one.
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (array instanceof Uint8Array) {
      keys++;
      for (let i = 0; i < array.length; i++) array[i] = (keys * 131 + i * 7 + 9) & 255;
    }
    return array;
  });
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  const rev = header(rows[0] ?? [], "revision") ?? "";
  const ids = (keep: (row: string[]) => string | undefined) =>
    rows.flatMap((x) => {
      const token = keep(x);
      return token ? [token] : [];
    });
  const menu = ids((x) =>
    (x[0] === "O" || x[0] === "F") && option(x, "disabled") === "false"
      ? option(x, "token")
      : undefined,
  );
  const liveAction = (x: string[]) => x[0] === "K" && cardAction(x, "disabled") === "false";
  const attacks = ids((x) =>
    liveAction(x) && cardAction(x, "hasCost") === "true" ? cardAction(x, "token") : undefined,
  );
  const buttons = ids((x) =>
    liveAction(x) ? cardAction(x, "token") : x[0] === "A" ? sidebar(x, "token") : undefined,
  );
  const own = rows.filter(
    (x) => x[0] === "C" && card(x, "owner") === "you" && card(x, "zone") === "hand",
  );
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
    sim.command(
      encodeFields(["move", card(c, "uid") ?? "", "hand", card(c, "index") ?? "", to, "0"]),
    );
  } else sim.command("dismiss");
}

describe("LuaSimulator.emit", () => {
  it("a re-emit repeats every row but the revision, the consumed shuffle and the announcement", () => {
    let shuffles = 0;
    let announced = 0;
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
        expect(Number(header(headAgain, "revision"))).toBe(Number(header(head, "revision")) + 1);
        expect(headAgain[SHUFFLED]).toBe("");
        expect(headAgain[ANNOUNCE]).toBe("");
        const rest_ = (h: string[]) =>
          h.filter((_, i) => i !== 0 && i !== SHUFFLED && i !== ANNOUNCE);
        expect(rest_(headAgain)).toEqual(rest_(head));
        expect(restAgain).toEqual(rest);
        if (head[SHUFFLED]) shuffles++;
        if (head[ANNOUNCE]) announced++;
      }
    }
    expect(shuffles).toBeGreaterThan(0);
    expect(announced).toBeGreaterThan(100);
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
      messageSerial: 0,
      warning: "",
      announce: "",
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

describe("announcement", () => {
  const names = { you: "Ash", opponent: "Brock" };
  const base = redactGame(driveSetup(4, { p1: MIXED_DECK, p2: MIXED_DECK }), "p1");
  const row = (who: "p1" | "p2" | "system", text: string, cues?: LogCue[]): SeatLogEntry => ({
    kind: "action",
    who,
    elapsed: "+0:01",
    segments: [{ text }],
    ...(cues && { cues }),
  });
  const input = (over: Partial<AnnounceInput> = {}): AnnounceInput => ({
    view: base,
    names,
    log: [],
    match: "m",
    title: "Your turn",
    hint: "",
    menu: null,
    ...over,
  });
  /** What an emit of `next` says after an emit of `first`. */
  const saidAfter = (first: Partial<AnnounceInput>, next: Partial<AnnounceInput>) =>
    announcement(announcement(NOTHING_HEARD, input(first)).heard, input(next)).text;

  it("says where the table stands once, and nothing for an unchanged emit", () => {
    const first = announcement(NOTHING_HEARD, input({ log: [row("p1", "drew a card")] }));
    expect(first.text).toBe("Your turn.");
    expect(announcement(first.heard, input({ log: [row("p1", "drew a card")] })).text).toBe("");
  });

  it("reads the rows appended since the last emit after the player's name", () => {
    const old = [row("p1", "drew a card")];
    const log: SeatLogEntry[] = [
      ...old,
      row("p2", "Onix used Tackle"),
      row("p2", "dealt 30 damage to Pikachu"),
      { kind: "turn", turn: 4 },
      row("system", "Checkup"),
    ];
    expect(saidAfter({ log: old }, { log })).toBe(
      "Brock: Onix used Tackle. Brock: dealt 30 damage to Pikachu. Turn 4. Checkup.",
    );
  });

  it("keeps the newest rows of a long batch, and every Knock Out", () => {
    const ko = base.board.opponent.active;
    if (!ko) throw Error("Missing Active");
    const v = structuredClone(base);
    v.board.opponent.active = null;
    v.board.opponent.discard.push(ko);
    const log = [
      row("p2", "Knocked Out", [{ kind: "knockOut", seat: "p2", uid: ko.id }]),
      ...Array.from({ length: ANNOUNCE_LOG_ROWS + 2 }, (_, i) => row("p1", `step ${i}`)),
    ];
    const said = saidAfter({}, { log, view: v });
    expect(said.startsWith(`Knocked out: Brock's ${ko.name}. Ash: step 2. `)).toBe(true);
    expect(said).not.toContain("step 1.");
    expect(said).toContain(`Ash: step ${ANNOUNCE_LOG_ROWS + 1}.`);
  });

  it("keeps the action that started a batch and its damage when a Knock Out ends the turn", () => {
    const ko = base.board.opponent.active;
    if (!ko) throw Error("Missing Active");
    const v = structuredClone(base);
    v.board.opponent.active = null;
    v.board.opponent.discard.push(ko);
    const log: SeatLogEntry[] = [
      row("p1", "Miraidon ex used Photon Blaster"),
      {
        kind: "action",
        who: "p1",
        elapsed: "+0:01",
        segments: [
          { text: "dealt " },
          { text: "220", tone: "damage" },
          { text: ` damage to ${ko.name}` },
        ],
      },
      row("p2", `${ko.name} was Knocked Out`, [{ kind: "knockOut", seat: "p2", uid: ko.id }]),
      row("p1", "takes 2 prize cards"),
      row("p1", "took 2 prize cards — 2 left"),
      row("p2", "promoted Miraidon ex to Active"),
      row("p1", "ended their turn"),
      { kind: "turn", turn: 6 },
      row("p2", "drew a card"),
      ...Array.from({ length: 2 }, (_, i) => row("p2", `step ${i}`)),
    ];
    const said = saidAfter({}, { log, view: v });
    expect(said.startsWith("Ash: Miraidon ex used Photon Blaster. Ash: dealt 220 damage to")).toBe(
      true,
    );
    expect(said).toContain(`Knocked out: Brock's ${ko.name}.`);
    // The generic rows still keep only the newest.
    expect(said).not.toContain("takes 2 prize cards");
    expect(said).toContain("Brock: step 1.");
  });

  it("says a Knock Out was the viewer's own Pokémon", () => {
    const ko = base.board.you.active;
    if (!ko) throw Error("Missing Active");
    const v = structuredClone(base);
    v.board.you.active = null;
    v.board.you.discard.push(ko);
    const log = [row("p1", "Knocked Out", [{ kind: "knockOut", seat: "p1", uid: ko.id }])];
    expect(saidAfter({}, { log, view: v })).toBe(`Knocked out: your ${ko.name}.`);
  });

  it("counts the Prizes either player takes", () => {
    const mine = structuredClone(base);
    mine.board.you.prizesRemaining = base.board.you.prizesRemaining - 1;
    expect(saidAfter({}, { view: mine })).toBe(`+1 Prize, ${mine.board.you.prizesRemaining} left.`);
    const theirs = structuredClone(base);
    theirs.board.opponent.prizesRemaining = base.board.opponent.prizesRemaining - 2;
    expect(saidAfter({}, { view: theirs })).toBe(
      `Brock took 2 Prizes, ${theirs.board.opponent.prizesRemaining} left.`,
    );
  });

  it("says who won and why once, in place of the log's win row", () => {
    const over = structuredClone(base);
    over.phase = { kind: "gameOver" };
    over.outcome = { result: "win", winner: "opponent", reason: "deckOut" };
    const log = [row("system", "Brock wins — Ash cannot draw")];
    const first = announcement(NOTHING_HEARD, input()).heard;
    const ended = announcement(first, input({ view: over, log, title: "Brock wins" }));
    expect(ended.text).toBe("Brock wins. No cards left to draw.");
    expect(announcement(ended.heard, input({ view: over, log, title: "Brock wins" })).text).toBe(
      "",
    );
  });

  it("reads a prompt's title, note and hint when it opens, not on each rebuild", () => {
    const v = structuredClone(base);
    v.phase = { kind: "effect:choose", prompt: { kind: "confirm", note: "Use it?" } };
    const menu: SimMenu = { kind: "list", title: "Do you want to use Drive Off?", options: [] };
    const prompt = { view: v, menu, hint: "Draw a card first.", title: "Choose your next move" };
    const opened = announcement(announcement(NOTHING_HEARD, input()).heard, input(prompt));
    expect(opened.text).toBe("Do you want to use Drive Off? Draw a card first.");
    expect(announcement(opened.heard, input({ ...prompt, menu: { ...menu } })).text).toBe("");
    const coin: SimMenu = {
      kind: "coin",
      title: "Bite",
      note: "Ash: Heads\nAsh: Tails",
      options: [],
    };
    const flips = [row("p1", "flipped heads", [{ kind: "coin", seat: "p1", face: "heads" }])];
    expect(saidAfter({}, { menu: coin, log: flips })).toBe("Bite. Ash: Heads. Ash: Tails.");
  });

  it("leaves a tray's and the log's opening words to the tray, which says them as it opens", () => {
    const v = structuredClone(base);
    v.phase = { kind: "effect:choose", prompt: { kind: "confirm", note: "Pick" } };
    const hint = "Search your deck for a Basic Pokémon onto your Bench.";
    const played = [row("p1", "played Nest Ball")];
    const tray: SimMenu = { kind: "cards", title: "", options: [] };
    // The untitled tray prints the hint as its instruction and reads it.
    expect(saidAfter({}, { view: v, hint, menu: tray, log: played })).toBe(
      "Ash: played Nest Ball.",
    );
    // A titled tray reads its title and note, but not the hint.
    const titled: SimMenu = {
      kind: "cards",
      title: "Choose 2",
      note: "From your deck",
      options: [],
    };
    expect(saidAfter({}, { view: v, hint, menu: titled })).toBe(`${hint}`);
    const log: SimMenu = {
      kind: "log",
      title: "Game log",
      note: "p1\tAsh\t0:01\tdrew",
      options: [],
    };
    expect(saidAfter({}, { menu: log })).toBe("");
    const pile: SimMenu = { kind: "pile", title: "", options: [] };
    expect(saidAfter({}, { menu: pile })).toBe("");
  });
});
