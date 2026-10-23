import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { isTeraPokemon } from "./cards";
import { attackGateOf, attackMenuOf, toolCardSimulated } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { programFor } from "./registry";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { FIXTURE_POOL, battler, deckOf, trainerCard, typedEnergy } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── 🆕🆕🆕 D578 — TECHNICAL MACHINE: FLUORITE `sv08-188` (Tool, 1 legal printing) ──
//
// *"The Pokémon this card is attached to can use the attack on this card. (You still need the
// necessary Energy to use this attack.) If this card is attached to 1 of your Pokémon, discard
// it at the end of your turn."* — "Fluorite" {G}{W}{P}: *"Discard all Energy from this Pokémon,
// and heal all damage from each of your Tera Pokémon."*
//
// The attack text is ~~DATA (`technicalMachines.ts` — the ingest drops a Trainer's attacks)~~
// 🆕 D581: the Tool card's own catalog `attacks` (the ingest keeps a Trainer's printed face since
// D581; `technicalMachines.ts` is deleted), the offer is `attackMenuOf`'s TOOL section (after the
// printed attacks), the program is the registry row's own `attack[0]`, the end-of-turn discard is
// flow.ts `discardEndOfTurnTools`. The TM card here is a LOCAL face on the real id, ~~`attacks: null`
// as the catalog hands it~~ 🆕 D581: carrying the attack the catalog row prints, read off
// `CATALOG_MANIFEST.trainerFaces` (the local D1, measured).

const TM = "sv08-188";
const TM_TEXT =
  "The Pokémon this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.) If this card is attached to 1 of your Pokémon, discard it at the end of your turn.";
const HOLDER = "d578t-holder";
const TERA = "sv07-032"; // Lapras ex — a Tera printing (banners.ts), no registry program
const TERA_2 = "sv08-142"; // Tatsugiri ex — a Tera printing, no registry program
const JAMMING_TOWER = "sv06-153";
const VITALITY_BAND = "sv01-197";
const PLAIN = "d578t-plain";
const FILLER = "d578t-filler";
const G = "d578t-grass";
const W = "d578t-water";
const P = "d578t-psychic";

const body = (id: string, extra: Partial<Card> = {}): Card =>
  battler(id, {
    name: id,
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
    ...extra,
  });

/** 🆕 D581 — the attack the catalog row prints (`apps/api/src/ingest/map.ts` keeps it since D581). */
const TM_ATTACKS = CATALOG_MANIFEST.trainerFaces[TM]?.attacks ?? null;

const LOCAL_CARDS: Record<string, Card> = {
  [TM]: {
    ...trainerCard(TM, "Tool", TM_TEXT),
    name: "Technical Machine: Fluorite",
    attacks: TM_ATTACKS,
  },
  [HOLDER]: body(HOLDER, { name: "D578 Holder" }),
  [TERA]: body(TERA, { name: "Lapras ex" }),
  [TERA_2]: body(TERA_2, { name: "Tatsugiri ex" }),
  [PLAIN]: body(PLAIN, { name: "D578 Plain" }),
  [JAMMING_TOWER]: {
    ...trainerCard(JAMMING_TOWER, "Stadium", "Pokémon Tools in play have no effect."),
    name: "Jamming Tower",
  },
  [VITALITY_BAND]: {
    ...trainerCard(
      VITALITY_BAND,
      "Tool",
      "The attacks of the Pokémon this card is attached to do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    ),
    name: "Vitality Band",
  },
  [FILLER]: body(FILLER, { name: "D578 Filler", retreat: 1 }),
  [G]: typedEnergy(G, "Grass"),
  [W]: typedEnergy(W, "Water"),
  [P]: typedEnergy(P, "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [TM]: 2,
  [HOLDER]: 2,
  [TERA]: 2,
  [TERA_2]: 1,
  [PLAIN]: 2,
  [JAMMING_TOWER]: 1,
  [VITALITY_BAND]: 1,
  [FILLER]: 23,
  [G]: 4,
  [W]: 4,
  [P]: 4,
  "fix-energy": 14,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok)
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function rejected(state: GameState, action: GameAction): string {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return result.error.code;
}

function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function withSide(
  state: GameState,
  seat: Seat,
  patch: Partial<GameState["players"]["p1"]>,
): GameState {
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], ...patch } } };
}

function pull(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const is = (u: string) => state.cardIdByUid[u] === id;
  const zone = (["deck", "hand", "prizes"] as const).find((z) => side[z].some(is));
  if (zone === undefined) throw new Error(`${seat} has no ${id}`);
  const uid = side[zone].find(is) ?? "";
  if (zone === "prizes") {
    const swap = side.deck.find((u) => !is(u)) ?? "";
    return {
      uid,
      state: withSide(state, seat, {
        prizes: side.prizes.map((u) => (u === uid ? swap : u)),
        deck: side.deck.filter((u) => u !== swap),
      }),
    };
  }
  return { uid, state: withSide(state, seat, { [zone]: side[zone].filter((u) => u !== uid) }) };
}

interface Spot {
  id: string;
  energy?: readonly string[];
  tools?: readonly string[];
  damage?: number;
}

/** p1's turn 2: each seat's Active and Bench built from `Spot`s; every hand emptied into the
    deck, then `hand` ids pulled into p1's hand. */
function table(opts: {
  p1: Spot;
  p1Bench?: readonly Spot[];
  p2: Spot;
  p2Bench?: readonly Spot[];
  hand?: readonly string[];
}): GameState {
  let state = opened(5782);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy]),
    ];
    state = withSide(state, seat, {
      hand: [],
      active: null,
      bench: [],
      deck: [...side.deck, ...back],
    });
  }
  const take = (seat: Seat, id: string): string => {
    const pulled = pull(state, seat, id);
    state = pulled.state;
    return pulled.uid;
  };
  const build = (seat: Seat, spot: Spot): InPlayPokemon => {
    const top = take(seat, spot.id);
    const energy = (spot.energy ?? []).map((id) => take(seat, id));
    const tools = (spot.tools ?? []).map((id) => take(seat, id));
    return { ...makeInPlay(top, 0), energy, tools, damage: spot.damage ?? 0 };
  };
  for (const seat of ["p1", "p2"] as const) {
    const active = build(seat, seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : (opts.p2Bench ?? [])).map((s) =>
      build(seat, s),
    );
    state = withSide(state, seat, { active, bench });
  }
  const hand = (opts.hand ?? []).map((id) => take("p1", id));
  return withSide(state, "p1", { hand });
}

const active = (state: GameState, seat: Seat = "p1"): InPlayPokemon =>
  state.players[seat].active as InPlayPokemon;

describe("D578 TM Fluorite §1 — the data and the registry row", () => {
  it("the granted attack is the card JSON's, verbatim — on the CATALOG row (D581)", () => {
    expect(POOL[TM]?.attacks).toBe(TM_ATTACKS);
    expect(TM_ATTACKS).toEqual([
      {
        cost: ["Grass", "Water", "Psychic"],
        name: "Fluorite",
        effect:
          "Discard all Energy from this Pokémon, and heal all damage from each of your Tera Pokémon.",
      },
    ]);
  });

  it("the row grants the Tool's printed attack, its program at index 0, and the end-of-turn discard; the Tool is simulated", () => {
    const program = programFor(TM);
    // 🆕 D581 — a FLAG: the attack is the Tool card's own catalog row, not a registry copy.
    expect(program?.toolAttacks).toBe(true);
    expect(program?.attack?.[0]).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "healEach", amount: "all", banner: "Tera" },
    ]);
    expect(program?.toolDiscardAtEndOfYourTurn).toBe(true);
    expect(toolCardSimulated(POOL[TM] as Card)).toBe(true);
  });

  it("the two Tera bodies the suite heals ARE Tera (banners.ts), the plain one is not", () => {
    expect(isTeraPokemon(POOL[TERA])).toBe(true);
    expect(isTeraPokemon(POOL[TERA_2])).toBe(true);
    expect(isTeraPokemon(POOL[PLAIN])).toBe(false);
  });
});

describe("D578 TM Fluorite §2 — offered only while attached, AFTER the printed attacks", () => {
  it("no TM: one row (the printed Tap); attached from the hand: Fluorite appears at index 1, origin 'tool'", () => {
    const state = table({ p1: { id: HOLDER }, p2: { id: PLAIN }, hand: [TM] });
    expect(attackMenuOf(state, "p1", active(state)).map((r) => r.attack.name)).toEqual(["Tap"]);
    const tmUid = state.players.p1.hand[0] ?? "";
    const attached = run(state, {
      type: "attachTool",
      seat: "p1",
      uid: tmUid,
      target: { spot: "active" },
    }).state;
    const menu = attackMenuOf(attached, "p1", active(attached));
    expect(menu.map((r) => [r.attack.name, r.origin, r.sourceIndex])).toEqual([
      ["Tap", "printed", 0],
      ["Fluorite", "tool", 0],
    ]);
    expect(menu[1]?.card.id).toBe(TM);
  });

  it("the wire lists it as row 1 with its printed cost, unpayable without {G}{W}{P}", () => {
    const state = table({ p1: { id: HOLDER, tools: [TM] }, p2: { id: PLAIN } });
    const view = redactGame(state, "p1");
    if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(view.phase.attacks.map((a) => [a.index, a.name, a.cost, a.playable])).toEqual([
      [0, "Tap", [], true],
      [1, "Fluorite", ["Grass", "Water", "Psychic"], false],
    ]);
  });

  it("an attack index past the menu is BAD_ATTACK_INDEX, and the TM row is gone once the Tool is", () => {
    const state = table({ p1: { id: HOLDER }, p2: { id: PLAIN } });
    expect(rejected(state, { type: "attack", seat: "p1", index: 1 })).toBe("BAD_ATTACK_INDEX");
  });

  it("under Jamming Tower ('Pokémon Tools have no effect') the TM grants nothing — no row", () => {
    const state = table({ p1: { id: HOLDER, tools: [TM] }, p2: { id: PLAIN } });
    const pulled = pull(state, "p1", JAMMING_TOWER);
    const towered: GameState = { ...pulled.state, stadium: { uid: pulled.uid, owner: "p1" } };
    expect(attackMenuOf(towered, "p1", active(towered)).map((r) => r.attack.name)).toEqual(["Tap"]);
    expect(rejected(towered, { type: "attack", seat: "p1", index: 1 })).toBe("BAD_ATTACK_INDEX");
  });

  it("no timing clause rides the TM row (`attackGateOf` through the menu)", () => {
    const state = table({ p1: { id: HOLDER, tools: [TM] }, p2: { id: PLAIN } });
    expect(attackGateOf(state, active(state), 1)).toBeUndefined();
  });
});

describe("D578 TM Fluorite §3 — the cost is the TM's own {G}{W}{P}", () => {
  it("{G}{W} is ATTACK_COST_UNMET; {G}{W}{P} pays", () => {
    const short = table({ p1: { id: HOLDER, tools: [TM], energy: [G, W] }, p2: { id: PLAIN } });
    expect(rejected(short, { type: "attack", seat: "p1", index: 1 })).toBe("ATTACK_COST_UNMET");
    const paid = table({ p1: { id: HOLDER, tools: [TM], energy: [G, W, P] }, p2: { id: PLAIN } });
    expect(run(paid, { type: "attack", seat: "p1", index: 1 }).events[0]).toMatchObject({
      type: "ATTACK_DECLARED",
      attack: "Fluorite",
      index: 1,
    });
  });

  it("three Colorless-providing Energy do not pay a typed cost", () => {
    const state = table({
      p1: { id: HOLDER, tools: [TM], energy: ["fix-energy", "fix-energy", "fix-energy"] },
      p2: { id: PLAIN },
    });
    expect(rejected(state, { type: "attack", seat: "p1", index: 1 })).toBe("ATTACK_COST_UNMET");
  });
});

describe("D578 TM Fluorite §4 — the attack: all Energy discarded, every Tera body fully healed", () => {
  it("discards ALL the holder's Energy and heals all damage from each Tera Pokémon (Active and Bench); a non-Tera body keeps its damage", () => {
    const state = table({
      p1: { id: TERA, tools: [TM], energy: [G, W, P, "fix-energy"], damage: 120 },
      p1Bench: [
        { id: TERA_2, damage: 50 },
        { id: PLAIN, damage: 30 },
      ],
      p2: { id: PLAIN },
    });
    const energy = [...active(state).energy];
    const { state: after, events } = run(state, { type: "attack", seat: "p1", index: 1 });
    expect(after.players.p1.active?.energy).toEqual([]);
    for (const uid of energy) expect(after.players.p1.discard).toContain(uid);
    expect(after.players.p1.active?.damage).toBe(0);
    expect(after.players.p1.bench[0]?.damage).toBe(0);
    expect(after.players.p1.bench[1]?.damage).toBe(30);
    // No damage box: the opponent's Active is untouched.
    expect(after.players.p2.active?.damage).toBe(0);
    expect(events.some((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toBe(false);
  });

  it("the ATTACK_DECLARED row names Fluorite itself — no `as` (not a copy)", () => {
    const state = table({ p1: { id: HOLDER, tools: [TM], energy: [G, W, P] }, p2: { id: PLAIN } });
    const declared = run(state, { type: "attack", seat: "p1", index: 1 }).events.find(
      (e) => e.type === "ATTACK_DECLARED",
    );
    expect(declared).toEqual({
      type: "ATTACK_DECLARED",
      seat: "p1",
      uid: active(state).stack[0],
      attack: "Fluorite",
      index: 1,
    });
  });
});

describe("D578 TM Fluorite §5 — 'discard it at the end of your turn'", () => {
  it("attached and the turn ended WITHOUT attacking: discarded at the owner's turn end (TOOLS_DISCARDED, when 'consumed')", () => {
    const state = table({ p1: { id: HOLDER, tools: [TM] }, p2: { id: PLAIN } });
    const tmUid = active(state).tools[0] ?? "";
    const { state: after, events } = run(state, { type: "endTurn", seat: "p1" });
    expect(after.players.p1.active?.tools).toEqual([]);
    expect(after.players.p1.discard).toContain(tmUid);
    const row = events.find((e) => e.type === "TOOLS_DISCARDED");
    expect(row).toEqual({
      type: "TOOLS_DISCARDED",
      seat: "p1",
      actor: "p1",
      uids: [tmUid],
      host: active(state).stack[0],
      when: "consumed",
    });
    expect(events.findIndex((e) => e.type === "TOOLS_DISCARDED")).toBeLessThan(
      events.findIndex((e) => e.type === "TURN_ENDED"),
    );
  });

  it("after the Fluorite attack ends the turn, the TM is discarded too (and so is a Benched holder's)", () => {
    const state = table({
      p1: { id: HOLDER, tools: [TM], energy: [G, W, P] },
      p1Bench: [{ id: PLAIN, tools: [TM] }],
      p2: { id: PLAIN },
    });
    const tms = [active(state).tools[0], state.players.p1.bench[0]?.tools[0]];
    const after = run(state, { type: "attack", seat: "p1", index: 1 }).state;
    expect(after.players.p1.active?.tools).toEqual([]);
    expect(after.players.p1.bench[0]?.tools).toEqual([]);
    for (const uid of tms) expect(after.players.p1.discard).toContain(uid);
  });

  it("ONLY the TM: another Tool (Vitality Band) on the owner's Bench stays through the same turn end", () => {
    const state = table({
      p1: { id: HOLDER, tools: [TM] },
      p1Bench: [{ id: PLAIN, tools: [VITALITY_BAND] }],
      p2: { id: PLAIN },
    });
    const band = state.players.p1.bench[0]?.tools[0];
    const after = run(state, { type: "endTurn", seat: "p1" }).state;
    expect(after.players.p1.active?.tools).toEqual([]);
    expect(after.players.p1.bench[0]?.tools).toEqual([band]);
  });

  it("NOT at the opponent's turn end: a TM on p2's Pokémon stays through p1's endTurn", () => {
    const state = table({ p1: { id: HOLDER }, p2: { id: PLAIN, tools: [TM] } });
    const after = run(state, { type: "endTurn", seat: "p1" }).state;
    expect(after.players.p2.active?.tools).toHaveLength(1);
  });

  it("a board with no TM ends its turn byte-identically on the Tool axis (no TOOLS_DISCARDED row)", () => {
    const state = table({ p1: { id: HOLDER }, p2: { id: PLAIN } });
    const { events } = run(state, { type: "endTurn", seat: "p1" });
    expect(events.some((e) => e.type === "TOOLS_DISCARDED")).toBe(false);
  });
});

describe("D578 TM Fluorite §6 — the §8 first-turn ban still applies to the TM row", () => {
  it("on turn 1 the going-first player cannot use Fluorite either", () => {
    const state = table({ p1: { id: HOLDER, tools: [TM], energy: [G, W, P] }, p2: { id: PLAIN } });
    const turnOne: GameState = { ...state, turn: 1 };
    expect(rejected(turnOne, { type: "attack", seat: "p1", index: 1 })).toBe("FIRST_TURN_ATTACK");
  });
});

// ── 🆕 D581 — THE TOOL SECTION READS THE TOOL CARD'S OWN PRINTED ATTACKS ──
// The catalog row keeps a Trainer's printed attacks since D581 (`apps/api/src/ingest/map.ts`),
// so `toolAttacks` is a FLAG and the menu row's attack IS the row's object. A Tool that prints
// an attack but whose program grants none (Technical Machine: Blindside `sv04-176`, unbuilt and
// not Standard-legal) adds nothing, and a catalog not re-ingested since D581 (no `attacks` on the
// row) grants nothing either — the deploy-order caveat.
describe("D581 TM Fluorite — the granted attack is the Tool card's catalog row", () => {
  const BLINDSIDE = "sv04-176";
  /** Re-point p1's Active's first Tool uid at `id`, carrying `card` in the state's pool. */
  const retool = (state: GameState, id: string, card: Card): GameState => {
    const uid = active(state).tools[0] ?? "";
    return {
      ...state,
      cardPool: { ...state.cardPool, [id]: card },
      cardIdByUid: { ...state.cardIdByUid, [uid]: id },
    };
  };
  const origins = (state: GameState) =>
    attackMenuOf(state, "p1", active(state)).map((e) => `${e.attack.name}/${e.origin}`);

  it("the menu's Tool row is the catalog row's attack object, at its printed index", () => {
    const state = table({ p1: { id: PLAIN, tools: [TM] }, p2: { id: PLAIN } });
    const row = attackMenuOf(state, "p1", active(state)).find((e) => e.origin === "tool");
    expect(row?.attack).toBe(TM_ATTACKS?.[0]);
    expect(row?.sourceIndex).toBe(0);
    expect(row?.card.id).toBe(TM);
  });

  it("a Tool that PRINTS an attack but whose program grants none adds no row (Blindside, unbuilt)", () => {
    const face = CATALOG_MANIFEST.trainerFaces[BLINDSIDE];
    expect(face?.attacks?.map((a) => a.name)).toEqual(["Blindside"]);
    expect(programFor(BLINDSIDE)).toBeUndefined();
    const blindside: Card = {
      ...trainerCard(BLINDSIDE, "Tool", TM_TEXT),
      name: face?.name ?? BLINDSIDE,
      attacks: face?.attacks ?? null,
    };
    const state = retool(
      table({ p1: { id: PLAIN, tools: [TM] }, p2: { id: PLAIN } }),
      BLINDSIDE,
      blindside,
    );
    expect(origins(state)).toEqual(["Tap/printed"]);
  });

  it("a TM row whose catalog row carries no attacks (not re-ingested since D581) grants nothing", () => {
    const state = table({ p1: { id: PLAIN, tools: [TM] }, p2: { id: PLAIN } });
    expect(origins(state)).toEqual(["Tap/printed", "Fluorite/tool"]);
    const stale = retool(state, TM, { ...(POOL[TM] as Card), attacks: null });
    expect(origins(stale)).toEqual(["Tap/printed"]);
  });
});
