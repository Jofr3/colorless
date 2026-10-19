import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameEvent, GameState, InPlayPokemon } from "./index";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, mustApply, setActiveFromDeck } from "./testFixtures";

// ── 🆕🆕🆕 D622 — R-AM2 RETIRED: THE BARE W/R TAIL IS W/R ONLY ──
//
// *"This attack's damage isn't affected by Weakness or Resistance."* (and Oil Salvo's *"This damage
// isn't …"*) nulls Weakness and Resistance and nothing else. Until D622 the three readers that read it
// set `ignoreWR`, which `placeSnipe` / `snipeActive` also read as the Feint form's *"or by any effects
// on that Pokémon"*, so a bare-tail snipe or spread passed every on-target prevention and reduction
// (R-AM2). The bare readers now add `wrOnly`; `ignoreWR` alone is the Feint form (Iron Crown ex "Twin
// Shotels"), unchanged. The texts below are the LOCAL D1 `attacks_json` effects, byte for byte
// (`legal_standard = 1`): 4 bare texts / 8 printings, 1 Feint text / 6 printings, all `sv`; the `me`
// column prints none of them (§1 measures both corpora). The bodies are file-local demonstrators.

/** Arboliva ex "Oil Salvo" — sv10-023, sv10-207. */
const OIL_SALVO =
  "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.";
/** Flygon ex "Sonic Peridot" — sv08-106, sv08-222. */
const SONIC_PERIDOT =
  "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance.";
/** Vaporeon ex "Severe Squall" — sv08.5-023, sv08.5-149. */
const SEVERE_SQUALL =
  "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.";
/** Sigilyph "Telekinesis" — sv10.5w-038, sv10.5w-121. */
const TELEKINESIS =
  "This attack does 70 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.";
/** Iron Crown ex "Twin Shotels" — the FEINT form, 6 printings. */
const TWIN_SHOTELS =
  "This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.";

const BARE: readonly (readonly [string, string, number])[] = [
  ["Oil Salvo", OIL_SALVO, 2],
  ["Sonic Peridot", SONIC_PERIDOT, 2],
  ["Severe Squall", SEVERE_SQUALL, 2],
  ["Telekinesis", TELEKINESIS, 2],
];

const SNIPER = "d622-sniper-ex"; // "D622 Sniper ex", {P}: the five attacks, cost-free
const TARGET = "d622-target-ex"; // "D622 Target ex": Weakness {P} ×2
const SHIELD = "d622-shield-ex"; // "D622 Shield ex": Resistance {P} −30
const FILLER = "d622-filler";

const ATTACKS: Card["attacks"] = [
  { cost: [], name: "Oil Salvo", effect: OIL_SALVO },
  { cost: [], name: "Sonic Peridot", effect: SONIC_PERIDOT },
  { cost: [], name: "Severe Squall", effect: SEVERE_SQUALL },
  { cost: [], name: "Telekinesis", effect: TELEKINESIS },
  { cost: [], name: "Twin Shotels", effect: TWIN_SHOTELS },
];
const [SALVO, PERIDOT, SQUALL, TELE, SHOTELS] = [0, 1, 2, 3, 4];

const body = (id: string, name: string, extra: Partial<Card> = {}): Card =>
  battler(id, { name, hp: 900, retreat: 0, types: ["Colorless"], attacks: [], ...extra });
const LOCAL: Record<string, Card> = {
  [SNIPER]: body(SNIPER, "D622 Sniper ex", { types: ["Psychic"], attacks: ATTACKS }),
  [TARGET]: body(TARGET, "D622 Target ex", { weaknesses: [{ type: "Psychic", value: "×2" }] }),
  [SHIELD]: body(SHIELD, "D622 Shield ex", { resistances: [{ type: "Psychic", value: "-30" }] }),
  [FILLER]: body(FILLER, "D622 Filler"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({ [SNIPER]: 4, [TARGET]: 6, [SHIELD]: 6, [FILLER]: 44 });

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's first turn (P2 went first and passed). */
function p1Turn(): GameState {
  const created = createGame({ seed: 6220, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** The on-target installations a body can carry this turn (test surgery on its own record). */
type Mark = "block" | "reduce" | "none";
function marked(state: GameState, pokemon: InPlayPokemon, mark: Mark): InPlayPokemon {
  if (mark === "block") return { ...pokemon, attackBlock: { turn: state.turn, effects: false } };
  if (mark === "reduce") return { ...pokemon, damageReduction: { turn: state.turn, amount: 30 } };
  return pokemon;
}

/** P1 attacks with the Sniper; P2's Active is `foe` (marked `mark`), its Bench `bench` (each marked). */
function board(foe: string, mark: Mark, bench: readonly (readonly [string, Mark])[] = [[FILLER, "none"]]): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", SNIPER), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", foe), "p2");
  for (const [id] of bench) state = benchFromDeck(state, "p2", id);
  const side = state.players.p2;
  const active = side.active === null ? null : marked(state, side.active, mark);
  const benched = side.bench.map((b, i) => marked(state, b, bench[i]?.[1] ?? "none"));
  return { ...state, players: { ...state.players, p2: { ...side, active, bench: benched } } };
}

const ACTIVE = { seat: "p2", spot: { spot: "active" } };
const BENCH0 = { seat: "p2", spot: { spot: "bench", index: 0 } };
const pickAll = (refs: unknown[]): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs } }) as GameAction;

/** P1 uses attack `index`, answering every park with `refs`. */
function swing(state: GameState, index: number, refs: unknown[] = []) {
  let { state: next, events } = mustApply(state, { type: "attack", seat: "p1", index });
  for (let n = 0; next.phase.kind === "effect:choose" && n < 8; n++) {
    const step = mustApply(next, pickAll(refs));
    next = step.state;
    events = [...events, ...step.events];
  }
  return { state: next, events };
}
const dealt = (events: readonly GameEvent[]) =>
  events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [{ dealt: e.dealt, weakness: e.weakness, resistance: e.resistance }] : []));

describe("D622 §1 — the readers: the bare tail carries `wrOnly`, the Feint form does not", () => {
  it("each bare text derives `ignoreWR` + `wrOnly` on every op; Twin Shotels derives `ignoreWR` alone", () => {
    for (const [name, text] of BARE) {
      const ops = deriveAttackEffect(text) as Extract<EffectOp, { op: "damageChosen" }>[] | null;
      expect(ops, name).not.toBeNull();
      for (const op of ops ?? []) expect([op.ignoreWR, op.wrOnly], name).toEqual([true, true]);
    }
    const feint = deriveAttackEffect(TWIN_SHOTELS) as Extract<EffectOp, { op: "damageChosen" }>[];
    expect(feint).toHaveLength(1);
    expect([feint[0]?.ignoreWR, feint[0]?.wrOnly]).toEqual([true, undefined]);
  });

  it("measured over BOTH corpora: `ignoreWR` is derived off 5 sentences / 14 printings; `wrOnly` on exactly the 4 bare ones (8)", () => {
    const rows = [...legalAttackCorpus(), ...meAttackCorpus()].flatMap(([n, text]) => {
      const ops = (deriveAttackEffect(text) ?? []) as { ignoreWR?: true; wrOnly?: true }[];
      if (!ops.some((op) => op.ignoreWR === true)) return [];
      return [{ text, n, bare: ops.every((op) => op.wrOnly === true), feint: ops.every((op) => op.wrOnly === undefined) }];
    });
    expect(rows.map((r) => r.text).sort()).toEqual([...BARE.map(([, t]) => t), TWIN_SHOTELS].sort());
    for (const row of rows) {
      const printsEffects = /or by any effects on/.test(row.text);
      expect(row.bare, row.text).toBe(!printsEffects);
      expect(row.feint, row.text).toBe(printsEffects);
    }
    expect(rows.filter((r) => r.bare).reduce((sum, r) => sum + r.n, 0)).toBe(8);
    expect(rows.filter((r) => r.feint).reduce((sum, r) => sum + r.n, 0)).toBe(6);
    // The `me` column prints none of them.
    expect(meAttackCorpus().filter(([, t]) => rows.some((r) => r.text === t))).toEqual([]);
  });
});

describe("D622 §2 — a prevention on the target stops the bare tail (R-AM2 retired); the Feint form passes it", () => {
  it("Oil Salvo: six picks on a blocked Benched body land nothing; beside a blocked Active, on the unblocked Benched body they land", () => {
    const blocked = swing(board(FILLER, "none", [[FILLER, "block"]]), SALVO, [BENCH0]);
    expect(blocked.state.players.p2.bench[0]?.damage).toBe(0);
    const open = swing(board(FILLER, "block", [[FILLER, "none"]]), SALVO, [BENCH0]);
    expect(open.state.players.p2.bench[0]?.damage).toBe(120);
  });

  it("Sonic Peridot and Severe Squall: the blocked ex takes 0, the unblocked ex beside it takes the hit", () => {
    for (const [index, amount] of [
      [PERIDOT, 100],
      [SQUALL, 60],
    ] as const) {
      const benchBlocked = swing(board(TARGET, "none", [[SHIELD, "block"]]), index);
      expect(benchBlocked.state.players.p2.bench[0]?.damage, String(index)).toBe(0);
      expect(benchBlocked.state.players.p2.active?.damage, String(index)).toBe(amount);
      const activeBlocked = swing(board(TARGET, "block", [[SHIELD, "none"]]), index);
      expect(activeBlocked.state.players.p2.active?.damage, String(index)).toBe(0);
      expect(activeBlocked.state.players.p2.bench[0]?.damage, String(index)).toBe(amount);
    }
  });

  it("Telekinesis: a blocked Active and a blocked Benched pick both take 0", () => {
    expect(swing(board(TARGET, "block"), TELE, [ACTIVE]).state.players.p2.active?.damage).toBe(0);
    expect(swing(board(TARGET, "none", [[FILLER, "block"]]), TELE, [BENCH0]).state.players.p2.bench[0]?.damage).toBe(0);
  });

  it("the Feint control: Twin Shotels lands 50 on a blocked Active and a blocked Benched body", () => {
    const hit = swing(board(TARGET, "block", [[FILLER, "block"]]), SHOTELS, [ACTIVE, BENCH0]);
    expect(hit.state.players.p2.active?.damage).toBe(50);
    expect(hit.state.players.p2.bench[0]?.damage).toBe(50);
  });
});

describe("D622 §3 — on the Active the bare tail still skips Weakness and Resistance, and nothing else", () => {
  it("Weakness ×2 and Resistance −30 are both skipped: Telekinesis lands 70 on each", () => {
    const weak = swing(board(TARGET, "none"), TELE, [ACTIVE]);
    expect(dealt(weak.events)).toEqual([{ dealt: 70, weakness: null, resistance: null }]);
    const resist = swing(board(SHIELD, "none"), TELE, [ACTIVE]);
    expect(dealt(resist.events)).toEqual([{ dealt: 70, weakness: null, resistance: null }]);
  });

  it("the spreads skip Weakness on the Active too: Severe Squall lands 60 on a Weakness ×2 ex, not 120", () => {
    expect(swing(board(TARGET, "none"), SQUALL).state.players.p2.active?.damage).toBe(60);
  });

  it("an installed −30 on the target applies to the bare tail (70 → 40) and not to the Feint form (50)", () => {
    expect(swing(board(TARGET, "reduce"), TELE, [ACTIVE]).state.players.p2.active?.damage).toBe(40);
    expect(swing(board(TARGET, "none", [[FILLER, "reduce"]]), TELE, [BENCH0]).state.players.p2.bench[0]?.damage).toBe(40);
    const feint = swing(board(TARGET, "reduce", [[FILLER, "reduce"]]), SHOTELS, [ACTIVE, BENCH0]);
    expect(feint.state.players.p2.active?.damage).toBe(50);
    expect(feint.state.players.p2.bench[0]?.damage).toBe(50);
  });
});

describe("D622 §4 — an in-flight v43 park keeps the reading it was parked under (MRV stays 43)", () => {
  /** A parked state as a 0.504 deploy wrote it: the same op bytes without `wrOnly`. */
  function v43(state: GameState): GameState {
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const strip = (op: EffectOp): EffectOp => {
      if (op.op !== "damageChosen") return op;
      const { wrOnly: _new, ...old } = op;
      return old;
    };
    const cont = state.phase.cont;
    const phase = { ...state.phase, cont: { ...cont, pendingOp: strip(cont.pendingOp), rest: cont.rest.map(strip) } };
    return JSON.parse(JSON.stringify({ ...state, phase })) as GameState;
  }

  it("a parked Telekinesis without `wrOnly` resumes as before (lands through the block); with it, it is stopped", () => {
    const parked = mustApply(board(TARGET, "block"), { type: "attack", seat: "p1", index: TELE }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.cont.pendingOp).toMatchObject({ ignoreWR: true, wrOnly: true });
    expect(mustApply(parked, pickAll([ACTIVE])).state.players.p2.active?.damage).toBe(0);
    const old = v43(parked);
    expect(mustApply(old, pickAll([ACTIVE])).state.players.p2.active?.damage).toBe(70);
  });

  it("a parked Oil Salvo's remaining five ops resume the same way (the rest rides the record too)", () => {
    const parked = mustApply(board(FILLER, "none", [[FILLER, "block"]]), { type: "attack", seat: "p1", index: SALVO })
      .state;
    expect(swing2(v43(parked)).state.players.p2.bench[0]?.damage).toBe(120);
    expect(swing2(parked).state.players.p2.bench[0]?.damage).toBe(0);
  });

  /** Answers every park on BENCH0 (the attack already declared). */
  function swing2(state: GameState) {
    let next = state;
    for (let n = 0; next.phase.kind === "effect:choose" && n < 8; n++) next = mustApply(next, pickAll([BENCH0])).state;
    return { state: next };
  }
});

describe("D622 §5 — the version", () => {
  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.531.0");
  });
});
