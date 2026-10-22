import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  completeSetup,
  deckOf,
  deepFreeze,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// ── CARD REVISION, BATCH B35 (Attacks) ──
//
// The verified findings from the per-unit audit (docs/reference/card-revision.md "B35"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1
// `cards.attacks_json`, byte for byte below):
//
//   Ceruledge `sv08-035` / `sv08-197` "Cursed Edge" {C}: *"Discard all Special Energy from all of
//   your opponent's Pokémon."*
//   Mega Dragalge ex `me04-065` / `me04-104` / `me04-118` "Corrosive Liquid" {C}{C}: *"Discard all
//   Pokémon Tools and Special Energy from all of your opponent's Pokémon."*
//
// THE BUG. Both derive `discardEnergy { from: "opponentEach", filter: specialEnergy, count: "all" }`.
// The op's ATTACK-channel guard (interpreter.ts `case "discardEnergy"`) asked `effectRefused` with its
// default target — the victim's ACTIVE — and refused the op WHOLE when that one body was shielded. So
// Mist Energy on the opponent's Active protected every Benched Pokémon's Special Energy too, although
// Mist prevents attack effects "done to the Pokémon this card is attached to" and to no other. The
// per-body filter one block down (`unshieldedRefs`) already answered the sweep correctly; the whole-op
// guard now runs only for the single-body arm (`opponentActive`), and a multi-body arm is left to the
// filter. Corrosive Liquid's Tool half (`discardTools all`) always filtered per body, so before the fix
// the two halves of ONE sentence treated the same board differently.

const CURSED_EDGE = "Discard all Special Energy from all of your opponent's Pokémon.";
const BLACK_BLAZE_SLASH = "During your next turn, this Pokémon can't attack.";
const CORROSIVE_LIQUID =
  "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon.";
const PERNICIOUS_POISON =
  "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, place 16 damage counters on that Pokémon instead of 1.";

const CERULEDGE = ["sv08-035", "sv08-197"] as const;
const DRAGALGE = ["me04-065", "me04-104", "me04-118"] as const;

const ceruledge = (id: string): Card =>
  battler(id, {
    name: "Ceruledge",
    hp: 140,
    types: ["Fire"],
    weaknesses: [],
    resistances: [],
    attacks: [
      { cost: ["Colorless"], name: "Cursed Edge", effect: CURSED_EDGE },
      {
        cost: ["Fire", "Fire", "Colorless"],
        name: "Black Blaze Slash",
        effect: BLACK_BLAZE_SLASH,
        damage: 160,
      },
    ],
  });

const dragalge = (id: string): Card =>
  battler(id, {
    name: "Mega Dragalge ex",
    hp: 330,
    types: ["Dragon"],
    weaknesses: [],
    resistances: [],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Corrosive Liquid", effect: CORROSIVE_LIQUID },
      { cost: ["Water", "Darkness"], name: "Pernicious Poison", effect: PERNICIOUS_POISON },
    ],
  });

const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  ...Object.fromEntries(CERULEDGE.map((id) => [id, ceruledge(id)])),
  ...Object.fromEntries(DRAGALGE.map((id) => [id, dragalge(id)])),
};

const MIST = "fix-mist-energy"; // Mist Energy sv05-161's printed sentence and program
const SPECIAL = "fix-special";
const SPECIAL_2 = "fix-special-2";
const WATER = "fix-water-energy";
const TOOL = "fix-tool";

const deckFor = (holder: string) =>
  deckOf({
    [holder]: 4,
    "fix-bigbody": 4,
    "fix-basic-1": 12,
    [MIST]: 4,
    [SPECIAL]: 4,
    [SPECIAL_2]: 4,
    [WATER]: 6,
    [TOOL]: 4,
    "fix-energy": 18,
  });

type Shield = "active" | "bench0" | "none";

/** P1's turn 3: `holder` Active with two Colorless Basic Energy. P2: a 200 HP Active carrying a
    Special Energy and a Tool; Bench 0 carrying a Special Energy, a Basic {W} Energy and a Tool;
    Bench 1 carrying a second Special Energy. `mist` places one Mist Energy on the named body. */
function board(holder: string, mist: Shield, seed = 11): GameState {
  const deck = deckFor(holder);
  const created = createGame({ seed, decks: { p1: deck, p2: deck }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.phase.kind !== "turn:action" || state.phase.seat !== "p1") {
    throw new Error(`expected P1's turn, got ${state.phase.kind}`);
  }
  const back = (s: GameState, seat: Seat) =>
    [holder, "fix-bigbody", "fix-basic-1", MIST, SPECIAL, SPECIAL_2, WATER, TOOL, "fix-energy"].reduce(
      (acc, id) => handToDeck(acc, seat, id),
      s,
    );
  state = back(back(state, "p1"), "p2");
  state = setActiveFromDeck(state, "p1", holder);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 2);

  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  state = attachFromDeck(state, "p2", SPECIAL, 1);
  state = attachToolFromDeck(state, "p2", "active", TOOL);
  state = attachBenchFromDeck(state, "p2", 0, SPECIAL, 1);
  state = attachBenchFromDeck(state, "p2", 0, WATER, 1);
  state = attachToolFromDeck(state, "p2", 0, TOOL);
  state = attachBenchFromDeck(state, "p2", 1, SPECIAL_2, 1);
  if (mist === "active") state = attachFromDeck(state, "p2", MIST, 1);
  if (mist === "bench0") state = attachBenchFromDeck(state, "p2", 0, MIST, 1);
  deepFreeze(state);
  return state;
}

const energyIds = (state: GameState, spot: "active" | number): string[] => {
  const side = state.players.p2;
  const body = spot === "active" ? side.active : side.bench[spot];
  return (body?.energy ?? []).map((uid) => state.cardIdByUid[uid] ?? "?").sort();
};
const toolIds = (state: GameState, spot: "active" | number): string[] => {
  const side = state.players.p2;
  const body = spot === "active" ? side.active : side.bench[spot];
  return (body?.tools ?? []).map((uid) => state.cardIdByUid[uid] ?? "?");
};
const prevented = (events: GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_PREVENTED" }> =>
      e.type === "ATTACK_EFFECT_PREVENTED",
  );
const activeUid = (state: GameState): string => {
  const active = state.players.p2.active;
  if (active === null) throw new Error("P2 has no Active");
  return active.stack[active.stack.length - 1] as string;
};
const bench0Uid = (state: GameState): string => {
  const body = state.players.p2.bench[0];
  if (body === undefined) throw new Error("P2 has no Bench 0");
  return body.stack[body.stack.length - 1] as string;
};

describe("B35 — Cursed Edge: Mist Energy on the Active shields only the Active", () => {
  it.each(CERULEDGE)(
    "%s: Mist on the ACTIVE keeps the Active's Special Energy, every Benched Special Energy is discarded",
    (id) => {
      const state = board(id, "active");
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
      // The Mist holder keeps both its Special Energy (Mist itself is one).
      expect(energyIds(done, "active")).toEqual([SPECIAL, MIST].sort());
      // "from ALL of your opponent's Pokémon" — the unshielded Bench loses every Special Energy.
      expect(energyIds(done, 0)).toEqual([WATER]);
      expect(energyIds(done, 1)).toEqual([]);
      // One refusal row, naming the shielded body and no other.
      expect(prevented(events).map((e) => e.uid)).toEqual([activeUid(state)]);
      const discarded = events.filter((e) => e.type === "ENERGY_DISCARDED");
      expect(discarded).toHaveLength(2);
    },
  );

  it.each(CERULEDGE)("%s: CONTROL — Mist on a Benched body keeps only that body's Special Energy", (id) => {
    const state = board(id, "bench0");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(energyIds(done, "active")).toEqual([]);
    expect(energyIds(done, 0)).toEqual([SPECIAL, MIST, WATER].sort());
    expect(energyIds(done, 1)).toEqual([]);
    expect(prevented(events).map((e) => e.uid)).toEqual([bench0Uid(state)]);
  });
});

describe("B35 — Corrosive Liquid: the Tool half and the Energy half read the same board the same way", () => {
  it.each(DRAGALGE)(
    "%s: Mist on the ACTIVE keeps the Active's Tool and Special Energy; the Bench loses both",
    (id) => {
      const state = board(id, "active");
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
      expect(toolIds(done, "active")).toEqual([TOOL]);
      expect(energyIds(done, "active")).toEqual([SPECIAL, MIST].sort());
      expect(toolIds(done, 0)).toEqual([]);
      expect(energyIds(done, 0)).toEqual([WATER]);
      expect(energyIds(done, 1)).toEqual([]);
      // One refusal per half of the sentence, both on the shielded Active.
      expect(prevented(events).map((e) => e.uid)).toEqual([activeUid(state), activeUid(state)]);
    },
  );

  it.each(DRAGALGE)("%s: CONTROL — no Mist anywhere strips every Tool and Special Energy", (id) => {
    const state = board(id, "none");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(toolIds(done, "active")).toEqual([]);
    expect(toolIds(done, 0)).toEqual([]);
    expect(energyIds(done, "active")).toEqual([]);
    expect(energyIds(done, 0)).toEqual([WATER]);
    expect(energyIds(done, 1)).toEqual([]);
    expect(prevented(events)).toHaveLength(0);
  });
});
