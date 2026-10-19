import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { owesToolTrim, toolCapOf, toolTrimStages } from "./continuous";
import type { GameAction, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D643 — Y1a: MULTI ADAPTER ──
//
// Rotom ex `me02-029` / `-111` / `-126` "Multi Adapter" on the NEW `PassiveEffects.toolCapForName` (continuous.ts
// `toolCapOf`, read at both `attachTool` arms), and its second sentence as a STATE CHECK: continuous.ts
// `toolTrimStages` queues the NEW persisted `PendingStage` `toolTrim` at flow.ts `advance`'s entry and in index.ts
// `applyAction` on a board back at `turn:action`; flow.ts `runToolTrim` runs the NEW `trimTools` op, which parks the
// shipped `discardTools` prompt at an exact `total` for the OWNER (R-MAD1 … R-MAD4). Text off the LOCAL D1
// (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-10, `legal_standard = 1`. Driven on a LOCAL `cardPool` (D275).

const MULTI_ADAPTER_TEXT =
  'Each of your Pokémon that has "Rotom" in its name may have up to 2 Pokémon Tool cards attached. If this Ability goes away, discard Pokémon Tools from those Pokémon until only 1 remains on each.';
const ROTOM_EX = ["me02-029", "me02-111", "me02-126"] as const;
const FLUTTER = "sv05-078"; // Flutter Mane "Midnight Fluttering": the opposing Active has no Abilities
const RUFFIAN = "sv09-157"; // Ruffian: a Tool and a Special Energy off 1 of the opponent's Pokémon
const BAND = "sv01-197"; // Vitality Band
const CHARM = "sv02-173"; // Bravery Charm
const DEFIANCE = "sv01-169"; // Defiance Band
const BELT = "sv02-176"; // Choice Belt

const STRIKER = "d643-striker"; // {C}, 400 HP: Hit 30 / Crush 300
const FILLER = "d643-filler"; // {C}, 400 HP
const ROTOM = "d643-rotom"; // a plain "Rotom", 400 HP, no Ability
const PLAIN = "d643-plain"; // a non-Rotom Basic, 400 HP
const E = "fix-energy";
const SPARE = "d643-spare";

const MOVES: Card["attacks"] = [
  { cost: ["Colorless"], name: "Hit", damage: 30 },
  { cost: ["Colorless"], name: "Crush", damage: 300 },
];
const CRUSH = 1; // 0 is "Hit"
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const mon = (id: string, name: string, hp: number, types: string[], attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types, retreat: 1, attacks, ...extra });
const tool = (id: string, name: string): Card => ({ ...trainerCard(id, "Tool", `${name}.`), name });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    ROTOM_EX.map((id) => [
      id,
      mon(id, "Rotom ex", 190, ["Lightning"], [{ cost: ["Lightning", "Colorless"], name: "Thunderbolt", damage: 130, effect: "Discard all Energy from this Pokémon." }], {
        abilities: [{ type: "Ability", name: "Multi Adapter", effect: MULTI_ADAPTER_TEXT }],
      } as Partial<Card>),
    ]),
  ),
  [FLUTTER]: mon(FLUTTER, "Flutter Mane", 90, ["Psychic"], MOVES, {
    abilities: [{ type: "Ability", name: "Midnight Fluttering", effect: "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering." }],
  } as Partial<Card>),
  [RUFFIAN]: { ...trainerCard(RUFFIAN, "Supporter", "Choose 1 of your opponent's Pokémon. Discard a Pokémon Tool and a Special Energy from that Pokémon."), name: "Ruffian" },
  [BAND]: tool(BAND, "Vitality Band"),
  [CHARM]: tool(CHARM, "Bravery Charm"),
  [DEFIANCE]: tool(DEFIANCE, "Defiance Band"),
  [BELT]: tool(BELT, "Choice Belt"),
  [STRIKER]: mon(STRIKER, "D643 Striker", 400, ["Colorless"], MOVES),
  [FILLER]: mon(FILLER, "D643 Filler", 400, ["Colorless"], TAP),
  [ROTOM]: mon(ROTOM, "Rotom", 400, ["Lightning"], TAP),
  [PLAIN]: mon(PLAIN, "D643 Plain", 400, ["Colorless"], TAP),
  [SPARE]: typedEnergy(SPARE, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [ROTOM_EX[0]]: 1,
  [ROTOM_EX[1]]: 1,
  [ROTOM_EX[2]]: 1,
  [FLUTTER]: 1,
  [RUFFIAN]: 1,
  [BAND]: 2,
  [CHARM]: 2,
  [DEFIANCE]: 1,
  [BELT]: 1,
  [STRIKER]: 1,
  [FILLER]: 30,
  [ROTOM]: 2,
  [PLAIN]: 2,
  [E]: 6,
  [SPARE]: 8,
});
const BOARD_IDS = Object.keys(LOCAL).filter((id) => id !== SPARE).concat([E]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own SECOND turn (P2 went first; every turn passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6430, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

/** TEST SURGERY — every Prize whose id is a board id swapped with a SPARE from the deck. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const kept = new Set(BOARD_IDS);
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!kept.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !kept.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active `attacker` (one {C} attached) over `p1Bench`; P2's Active `defender` over `p2Bench`. */
function table(attacker: string, defender: string, p2Bench: readonly string[] = [], p1Bench: readonly string[] = []): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  state = attachFromDeck(state, "p1", E, 1);
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of p2Bench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** TEST SURGERY — Tools put straight on `seat`'s body at `target`. */
function withTools(state: GameState, seat: Seat, target: "active" | number, ids: readonly string[]): GameState {
  return ids.reduce((next, id) => attachToolFromDeck(next, seat, target, id), state);
}

type AttachTarget = Extract<GameAction, { type: "attachTool" }>["target"];
const attachTool = (state: GameState, seat: Seat, id: string, target: AttachTarget = { spot: "active" }) => {
  const held = handFromDeck(state, seat, id, 1);
  return applyAction(held, { type: "attachTool", seat, uid: handUid(held, seat, id), target });
};
const body = (state: GameState, seat: Seat, at: "active" | number): InPlayPokemon => {
  const side = state.players[seat];
  const found = at === "active" ? side.active : side.bench[at];
  if (found === null || found === undefined) throw new Error(`no ${seat} body at ${String(at)}`);
  return found;
};
const toolIds = (state: GameState, seat: Seat, at: "active" | number) =>
  body(state, seat, at).tools.map((uid) => state.cardIdByUid[uid]);
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const answer = (state: GameState, seat: Seat, uids: readonly string[]) =>
  applyAction(state, { type: "resolveEffect", seat, choice: { kind: "discardTools", uids: [...uids] } } as GameAction);

describe("D643 §1 — the print and the registry rows", () => {
  it("three keys on ONE NEW object: a `passive` raise for bodies named Rotom", () => {
    expect(programFor(ROTOM_EX[0])).toEqual({ passive: { toolCapForName: { nameContains: "Rotom", cap: 2 } } });
    expect(programFor(ROTOM_EX[1])).toBe(programFor(ROTOM_EX[0]));
    expect(programFor(ROTOM_EX[2])).toBe(programFor(ROTOM_EX[0]));
  });

  it("the engine is 0.541.0", () => {
    expect(engineVersion).toBe("0.541.0");
  });
});

describe("D643 §2 — the cap at `attachTool` (`toolCapOf`)", () => {
  it("an Active Rotom ex takes a second Tool and refuses a third", () => {
    let state = table(STRIKER, FILLER);
    state = clearBench(setActiveFromDeck(state, "p1", ROTOM_EX[0]), "p1");
    state = must(attachTool(state, "p1", BAND));
    state = must(attachTool(state, "p1", CHARM));
    expect(toolIds(state, "p1", "active")).toEqual([BAND, CHARM]);
    const third = handFromDeck(state, "p1", DEFIANCE, 1);
    const refused = applyAction(third, { type: "attachTool", seat: "p1", uid: handUid(third, "p1", DEFIANCE), target: { spot: "active" } });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("TOOL_ALREADY_ATTACHED");
    expect(refused.error.message).toBe("at most 2 Pokémon Tools on this Pokémon (Multi Adapter)");
  });

  it("a benched holder raises a benched plain Rotom; a non-Rotom body keeps one (R-MAD3)", () => {
    const state = table(STRIKER, FILLER, [], [ROTOM_EX[1], ROTOM, PLAIN]);
    const rotom = withTools(state, "p1", 1, [BAND]);
    expect(toolCapOf(rotom, "p1", body(rotom, "p1", 1))).toBe(2);
    const second = must(attachTool(rotom, "p1", CHARM, { spot: "bench", index: 1 }));
    expect(toolIds(second, "p1", 1)).toEqual([BAND, CHARM]);
    const plain = withTools(state, "p1", 2, [BAND]);
    expect(toolCapOf(plain, "p1", body(plain, "p1", 2))).toBe(1);
    const refused = attachTool(plain, "p1", CHARM, { spot: "bench", index: 2 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe("one Tool per Pokémon (§7.4)");
  });

  it("the holder raises only its OWN board: the opponent's Rotom keeps one", () => {
    const state = table(STRIKER, ROTOM, [], [ROTOM_EX[0]]);
    expect(toolCapOf(state, "p2", body(state, "p2", "active"))).toBe(1);
    expect(toolCapOf(state, "p1", body(state, "p1", 0))).toBe(2);
  });

  it("with no holder in play a Rotom keeps one", () => {
    const state = table(STRIKER, FILLER, [], [ROTOM]);
    expect(toolCapOf(state, "p1", body(state, "p1", 0))).toBe(1);
  });

  it("§9: an opposing Active Flutter Mane silences an Active Rotom ex, so its second Tool is refused", () => {
    let state = table(STRIKER, FLUTTER);
    state = clearBench(setActiveFromDeck(state, "p1", ROTOM_EX[0]), "p1");
    state = withTools(state, "p1", "active", [BAND]);
    expect(toolCapOf(state, "p1", body(state, "p1", "active"))).toBe(1);
    const held = handFromDeck(state, "p1", CHARM, 1);
    expectErr(held, { type: "attachTool", seat: "p1", uid: handUid(held, "p1", CHARM), target: { spot: "active" } }, "TOOL_ALREADY_ATTACHED");
  });
});

describe("D643 §3 — the trim when the holder leaves play (`advance`'s state check, R-MAD1)", () => {
  /** P2: Active Rotom ex (Band + Charm), Benched plain Rotom (Defiance + Belt); P1 Crushes the Rotom ex. */
  function koBoard(): GameState {
    let state = table(STRIKER, ROTOM_EX[0], [ROTOM]);
    state = withTools(state, "p2", "active", [BAND, CHARM]);
    return withTools(state, "p2", 0, [DEFIANCE, BELT]);
  }

  it("the KO leaves the benched Rotom over its cap: P2 is asked first, EXACTLY 1 of its two Tools", () => {
    const state = koBoard();
    expect(toolTrimStages(state, "p1")).toEqual([]);
    const hit = mustApply(state, { type: "attack", seat: "p1", index: CRUSH });
    expect(of(hit.events, "KNOCKED_OUT")).toHaveLength(1);
    expect(hit.state.phase.kind).toBe("effect:choose");
    if (hit.state.phase.kind !== "effect:choose") return;
    expect(hit.state.phase.seat).toBe("p2");
    expect(hit.state.phase.prompt).toMatchObject({
      kind: "discardTools",
      scope: { kind: "total", count: 1 },
      note: "Rotom can have only 1 Pokémon Tool attached: discard 1.",
    });
    const offered = hit.state.phase.prompt.kind === "discardTools" ? hit.state.phase.prompt.discardable : [];
    expect(offered.map((o) => hit.state.cardIdByUid[o.uid])).toEqual([DEFIANCE, BELT]);
    expect(offered.every((o) => o.from.seat === "p2" && o.from.spot.spot === "bench")).toBe(true);
    // The Prize has not been taken yet: the trim is in FRONT of the sweep's stages.
    expect(hit.state.players.p1.prizes).toHaveLength(6);
  });

  it("the owner's answer discards the picked Tool, then the Prize and the promotion follow", () => {
    const hit = mustApply(koBoard(), { type: "attack", seat: "p1", index: CRUSH });
    const belt = body(hit.state, "p2", 0).tools[1] as string;
    const done = answer(hit.state, "p2", [belt]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(toolIds(done.state, "p2", 0)).toEqual([DEFIANCE]);
    expect(done.state.players.p2.discard).toContain(belt);
    expect(of(done.events, "TOOLS_DISCARDED")).toEqual([
      { type: "TOOLS_DISCARDED", seat: "p2", actor: "p2", uids: [belt], host: body(hit.state, "p2", 0).stack.at(-1), when: "trimmed" },
    ]);
    // The sweep's stages follow in their order: P1's Prize pick (2: a Pokémon ex), then P2's forced promotion.
    expect(done.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 2 });
    const taken = mustApply(done.state, { type: "takePrizes", seat: "p1", prizeIndices: [0, 1] });
    expect(taken.state.players.p1.prizes).toHaveLength(4); // a Pokémon ex: 2 Prizes
    expect(taken.state.players.p2.active?.stack.map((u) => taken.state.cardIdByUid[u])).toEqual([ROTOM]);
    expect(toolIds(taken.state, "p2", "active")).toEqual([DEFIANCE]);
  });

  it("the answer is held to the offer and the exact count", () => {
    const hit = mustApply(koBoard(), { type: "attack", seat: "p1", index: CRUSH });
    const [defiance, belt] = body(hit.state, "p2", 0).tools as [string, string];
    for (const uids of [[], [defiance, belt]]) {
      const refused = answer(hit.state, "p2", uids);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.message).toBe("discard exactly 1 Pokémon Tools");
    }
    const stray = answer(hit.state, "p2", [hit.state.players.p2.deck[0] as string]);
    expect(stray.ok).toBe(false);
  });

  it("two Tools of ONE card ask nothing: the newer comes off inline (the M1 rule)", () => {
    let state = table(STRIKER, ROTOM_EX[0], [ROTOM]);
    state = withTools(state, "p2", 0, [BAND, BAND]);
    const [older, newer] = body(state, "p2", 0).tools as [string, string];
    const hit = mustApply(state, { type: "attack", seat: "p1", index: CRUSH });
    expect(hit.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 2 });
    expect(body(hit.state, "p2", 0).tools).toEqual([older]);
    expect(hit.state.players.p2.discard).toContain(newer);
    expect(of(hit.events, "TOOLS_DISCARDED").map((e) => e.when)).toEqual(["trimmed"]);
  });

  it("a second holder keeps the cap: nothing is trimmed (R-MAD2)", () => {
    let state = table(STRIKER, ROTOM_EX[0], [ROTOM, ROTOM_EX[1]]);
    state = withTools(state, "p2", 0, [DEFIANCE, BELT]);
    const hit = mustApply(state, { type: "attack", seat: "p1", index: CRUSH });
    expect(of(hit.events, "TOOLS_DISCARDED")).toEqual([]);
    const rotom = [hit.state.players.p2.active, ...hit.state.players.p2.bench].find(
      (b) => b !== null && hit.state.cardIdByUid[b.stack.at(-1) ?? ""] === ROTOM,
    );
    expect(rotom?.tools).toHaveLength(2);
  });

  it("a non-Rotom body carrying two Tools (surgery) is never trimmed", () => {
    let state = table(STRIKER, ROTOM_EX[0], [PLAIN]);
    state = withTools(state, "p2", 0, [DEFIANCE, BELT]);
    expect(owesToolTrim(state, "p2", body(state, "p2", 0))).toBe(false);
    const hit = mustApply(state, { type: "attack", seat: "p1", index: CRUSH });
    expect(of(hit.events, "TOOLS_DISCARDED")).toEqual([]);
  });

  it("the log row names the trim", () => {
    const hit = mustApply(koBoard(), { type: "attack", seat: "p1", index: CRUSH });
    const belt = body(hit.state, "p2", 0).tools[1] as string;
    const done = answer(hit.state, "p2", [belt]);
    if (!done.ok) throw new Error(done.error.code);
    const ctx: LogContext = { names: { p1: "Ana", p2: "Bo" }, state: done.state, elapsed: formatElapsed(0) };
    const rows = logFromEvents(done.events, ctx).flatMap((entry) =>
      entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((seg) => seg.text).join("") }],
    );
    expect(rows).toContainEqual({ who: "p2", text: "discarded Choice Belt from Bo's Rotom — Multi Adapter no longer applies" });
  });
});

describe("D643 §4 — the trim when a §9 lock arrives (`applyAction`'s state check, R-MAD1)", () => {
  it("P1 retreats into Flutter Mane: P2's Active Rotom ex loses the raise and P2 trims on P1's turn", () => {
    let state = table(STRIKER, ROTOM_EX[0], [], [FLUTTER]);
    state = withTools(state, "p2", "active", [BAND, CHARM]);
    const energy = state.players.p1.active?.energy[0] as string;
    const retreated = mustApply(state, { type: "retreat", seat: "p1", discardEnergy: [energy], promoteBenchIndex: 0 });
    expect(retreated.state.phase.kind).toBe("effect:choose");
    if (retreated.state.phase.kind !== "effect:choose") return;
    expect(retreated.state.phase.seat).toBe("p2");
    expect(retreated.state.phase.prompt).toMatchObject({ kind: "discardTools", scope: { kind: "total", count: 1 } });
    const band = body(retreated.state, "p2", "active").tools[0] as string;
    const done = answer(retreated.state, "p2", [band]);
    if (!done.ok) throw new Error(done.error.code);
    expect(toolIds(done.state, "p2", "active")).toEqual([CHARM]);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("an unlocked board back at `turn:action` queues nothing", () => {
    let state = table(STRIKER, ROTOM_EX[0], [], [FILLER]);
    state = withTools(state, "p2", "active", [BAND, CHARM]);
    const energy = state.players.p1.active?.energy[0] as string;
    const retreated = mustApply(state, { type: "retreat", seat: "p1", discardEnergy: [energy], promoteBenchIndex: 0 });
    expect(retreated.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(toolIds(retreated.state, "p2", "active")).toEqual([BAND, CHARM]);
  });
});

describe("D643 §5 — Ruffian on a two-Tool Rotom ex parks an EXACT pick (R-MAD4)", () => {
  it("one Tool exactly, the controller's choice", () => {
    let state = table(STRIKER, ROTOM_EX[0]);
    state = withTools(state, "p2", "active", [BAND, CHARM]);
    const held = handFromDeck(state, "p1", RUFFIAN, 1);
    const played = mustApply(held, { type: "playTrainer", seat: "p1", uid: handUid(held, "p1", RUFFIAN) });
    let now = played.state;
    if (now.phase.kind === "effect:choose" && now.phase.prompt.kind === "choosePokemon") {
      now = mustApply(now, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } },
      } as GameAction).state;
    }
    expect(now.phase.kind).toBe("effect:choose");
    if (now.phase.kind !== "effect:choose") return;
    expect(now.phase.prompt).toMatchObject({
      kind: "discardTools",
      scope: { kind: "total", count: 1 },
      note: "Discard a Pokémon Tool from that Pokémon.",
    });
    const refused = answer(now, "p1", []);
    expect(refused.ok).toBe(false);
    const charm = body(now, "p2", "active").tools[1] as string;
    const done = answer(now, "p1", [charm]);
    if (!done.ok) throw new Error(done.error.code);
    expect(toolIds(done.state, "p2", "active")).toEqual([BAND]);
  });
});
