import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction, createGame } from "./index";
import { applyChoice } from "./interpreter";
import { redactGame } from "./redact";
import { programFor, registryCardIds } from "./registry";
import {
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── D359 — `attachEnergyFrom`'s QUANTITY AXIS: THE PRINTED "up to N" TO ONE ───
// ── NAMED BODY, AND A POPULATION THE REGISTRY COULD NOT SEE ──────────────────
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────
// `attachEnergyFrom.count` has meant "up to N onto the ONE body the print names"
// since D205 — its own doc says so: *"`min(count, available)` is what actually
// lands: a hand holding one {R} attaches one, silently, because the print says UP
// TO."* **The engine was spending the printed "up to" against AVAILABILITY and
// never against the player's WILL.** A controller with two {F} in the pile who
// wanted ONE got two, and on the four `toSelf` sentences was never asked at all —
// `parkOrForce` forces a lone candidate, and "this Pokémon" is one candidate by
// construction.
//
// ── 🛑🛑 THE POPULATION, RE-DERIVED OVER **BOTH** PRODUCERS ─────────────────
// D358 measured this residue as *"8 legal printings / 3 sentences / 3 objects"*
// by walking the REGISTRY. **THE REGISTRY IS NOT THE BUILD.** `deriveAttackEffect`
// is this op's second producer and it emits `count: 2` for three more
// Standard-legal sentences no registry walk can reach. Re-derived here off the
// registry AND the deriver, joined to remote D1 `luminous` on `$.effect` (never
// `$.text`, which returns a false zero — the extractor was verified against the
// eight known-present rows before any zero in it was believed), 2026-08-18:
//
//   Ethan's Ho-Oh ex ×4   sv10-039/-209/-230/-239   ability  count 2 + owner/bench
//   Bloodmoon Ursaluna ×2 sv06.5-025, sv08.5-054    ability  count 2 + toSelf
//   Lycanroc ×2           sv09-085/-166             ability  count 2 + toSelf
//   🆕 Oricorio ×2        sv08-026, sv08-089        ATTACK   count 2 + benchOnly
//   🆕 Regirock ex ×2     sv10-101, sv10-214        ATTACK   count 2 + toSelf
//   🆕 Kilowattrel ex ×1  sv08-068                  ATTACK   count 2 + toSelf, gated
//
// **6 sentences / 13 Standard-legal printings, printed {0, 1, 2} on all 13.**
// ⚠️ **AND THE TWO HALVES WERE BROKEN DIFFERENTLY, WHICH IS WHY A DECLINE AXIS
// COULD NEVER HAVE REPAIRED EITHER.** The 8 ABILITY printings reached {0, 2}: an
// activated or triggered *"you may"* buys the empty answer and the ceiling was
// resolved exactly. The 5 ATTACK printings reached **{2} ALONE** — an attack is
// declared and resolves, there is no `optional` anywhere in the program, and even
// the zero was unreachable.
// ⚠️ Koraidon "Dino Cry" is **6** printings (svp-029, sv01-125/-231/-247/-254,
// sv04.5-245), not the 4 the handoff carried, and all six are
// `legal_standard = 0` — excluded because it was MEASURED. It is an *"in any way
// you like"* spread anyway, which is the `anyWay` axis and not this one.
//
// ── 🛑 THE FIRST QUESTION WAS **WHICH PROMPT**, AND IT WAS SETTLED FROM THE
//    CATALOG ────────────────────────────────────────────────────────────────
//   (1) **`ptcg-rules.md` §9.1, verbatim:** *"'Search your deck for **up to 2**
//       Basic Energy cards' (Earthen Vessel) — **one, two, or none, all legal**."*
//       Every k in 0..N is a printed answer, and nothing about that is
//       card-specific.
//   (2) **`count`'s OWN DOC SAYS THE BATCH IS ONE DECISION** — it exists to pin
//       the batch to the ONE body a print NAMES. So the print asks ONE compound
//       question (how many, and onto which body), and the answer rides ONE prompt.
//       A second prompt would contradict a documented reading.
//   (3) **THE SIBLING OP ALREADY RULED ON THE IDENTICAL QUANTIFIER.**
//       `attachFromDeck` reads *"Search your deck for **up to 2** Basic Energy
//       cards and attach them…"* as `max: N` over a park with a floor of ZERO.
//       `attachEnergyFrom` is the one attach route where the printed ceiling
//       collapsed into an exact count.
//   (4) **THE CATALOG CONTRASTS THE QUANTIFIER AGAINST ITS OWN ABSENCE, ON THE
//       SAME OP, THE SAME ZONE AND THE SAME DESTINATION CLAUSE.** Furfrou
//       `sv06.5-051` prints *"Attach **a** Basic Energy card from your discard
//       pile to 1 of your Benched Pokémon"*; Oricorio `sv08-026` prints *"Attach
//       **up to 2** Basic Energy cards from your discard pile to 1 of your Benched
//       Pokémon"*. One op, one zone, one destination, two words apart.
//
// ── THE NO-NEW-VOCABULARY REFUTATIONS, RUN FROM SOURCE (§5) ─────────────────
//   (a) a new OP field (`upTo` beside `count`) — **refused, and the refusal is
//       measured rather than argued**: `count` IS the ceiling. `effects.ts`'s
//       `attachFromZoneClause` admits a count above 1 through its literal
//       `up to (\d+)` alternative ALONE, so no sentence in the catalog can produce
//       `count > 1` without printing the word. §5 drives that from the deriver.
//   (b) a second key on the PROMPT (`upTo` beside D358's `declinable`) — refused
//       by widening instead: at this prompt `declinable` IS `upTo: 1`, and
//       `interpreter.ts` had already written the rule down one member below
//       (*"A prompt with `min: 0` is declinable by construction and does not set
//       it"*). **The OP-level fields are untouched and still never co-occur**,
//       which `attachDecline.test.ts` §1 asserts unedited.
//   (c) route it to the `attachCards` MAP prompt — refused twice over: that
//       prompt asks *which card goes where*, re-opening the distribution `count`
//       exists to close, and its three producers are deck-top / deck-search /
//       hand. **No op in this engine reads the DISCARD PILE into a map prompt**,
//       and three of these six sentences are `source: "discard"`. §5 pins it.
//   (d) two ops instead of one — refused on D205's ground: `count` pins the batch
//       to one body, so two ops would legalise splitting Ethan's Ho-Oh's two
//       Energy across two benched bodies against *"to **1 of** your Benched
//       Ethan's Pokémon"*.
//
// ── 🛑 THE CEILING IS THE PRINTED NUMBER AND IS NEVER CLAMPED TO THE ZONE ────
// `min(count, available)` stays a fact about the APPLY, exactly as it has been
// since D205. ⚠️ **THE FIRST ARGUMENT FOR THAT WAS MEASURED FALSE AND IS RECORDED
// AS SUCH IN §4**: a clamp would NOT leak the hand, because `redactPhase` sends an
// `effect:choose` prompt only to the seat that must answer it. The real argument
// is internal consistency — the park's `note` quotes the PRINTED count verbatim
// (D205), so a clamped ceiling would offer one button under a caption promising
// two, which is one prompt contradicting itself. `chooseCards` reached the same
// conclusion from the other side: *"`max` never needed this — a ceiling above the
// candidate count simply never binds"*.

const ORICORIO = "sv08-026";
const ORICORIO_B = "sv08-089";
const BENCH_BODY = "fix-d359-bench";
const FIRE = "fix-d359-fire";
const WATER = "fix-d359-water";

/** The printed sentence, character-for-character off the remote D1 row for
    `sv08-026`/`sv08-089` (2026-08-18). Both printings carry it byte-identically,
    which is what makes them ONE row of this slice's population. */
const ENERGY_ASSIST =
  "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.";

/** Every catalog id whose BUILD carries an `attachEnergyFrom` with `count`, by
    the sentence that prints it. Re-derived, never inherited (see the header). */
const QUANTITY_IDS = {
  goldenFlame: ["sv10-039", "sv10-209", "sv10-230", "sv10-239"],
  battleHardened: ["sv06.5-025", "sv08.5-054"],
  spikeClad: ["sv09-085", "sv09-166"],
  energyAssist: [ORICORIO, ORICORIO_B],
  regiCharge: ["sv10-101", "sv10-214"],
  returnCharge: ["sv08-068"],
} as const;

/** The real printing, off the remote D1 row (2026-08-18): Oricorio HP 90 Basic
    {R} / retreat 1 / weak {W} ×2, "Energy Assist" {R} (index 0) and "Fireworks"
    {R} 30 (index 1). Held in a LOCAL pool and never in `FIXTURE_POOL` (D275's
    idiom): `catalogManifest.ts` is generated off a six-set catalog that does not
    hold `sv08`, so a shared-pool body would owe a `fix-*` key on `censusAtHead`'s
    `raw.length` line — **and this slice moves NO census figure.** */
const POOL: Record<string, Card> = {
  [ORICORIO]: battler(ORICORIO, {
    name: "Oricorio",
    hp: 90,
    retreat: 1,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      { cost: ["Fire"], name: "Energy Assist", effect: ENERGY_ASSIST },
      { cost: ["Fire"], name: "Fireworks", effect: "Discard an Energy from this Pokémon.", damage: 30 },
    ],
  }),
  [BENCH_BODY]: battler(BENCH_BODY, {
    name: "D359 Bench Body",
    hp: 120,
    retreat: 1,
    types: ["Water"],
    attacks: [{ cost: ["Water"], name: "Tap", damage: 10 }],
  }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [WATER]: typedEnergy(WATER, "Water"),
};

const DECK = deckOf({ [ORICORIO]: 4, [BENCH_BODY]: 16, [FIRE]: 20, [WATER]: 20 });

const ENERGY_ASSIST_IDX = 0;
const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function step(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function idOf(state: GameState, uid: string): string {
  return state.cardIdByUid[uid] ?? "";
}

function firstInHand(state: GameState, seat: "p1" | "p2", cardId: string): string {
  const uid = state.players[seat].hand.find((h) => idOf(state, h) === cardId);
  if (uid === undefined) throw new Error(`no ${cardId} in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstInHand(state, seat, BENCH_BODY) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** §4 bars the going-first player from attacking on turn 1, so every board here
    runs on turn 3 — cheaper to say than to leave as a `FIRST_TURN_ATTACK` a reader
    has to diagnose. */
function passTo(state: GameState, turn: number): GameState {
  let next = state;
  while (next.turn < turn) {
    if (next.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${next.phase.kind} while passing to turn ${turn}`);
    }
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** Oricorio Active with its {R} cost attached, `bench` benched bodies, and a
    discard pile holding `pile` Basic Energy. Built by the shared TEST SURGERY
    helpers rather than by hand: an `InPlayPokemon` assembled inline drops `tools`
    and every passive reader that walks it throws — a board a fixture builds is
    legal-shaped by construction and one a test literal builds is not. */
function ready(
  seed: number,
  { bench = 2, pile = 2 }: { bench?: number; pile?: number } = {},
): GameState {
  let state = passTo(localSetup(seed), 3);
  state = setActiveFromDeck(state, "p1", ORICORIO);
  state = attachFromDeck(state, "p1", FIRE, 1);
  state = clearBench(state, "p1");
  for (let i = 0; i < bench; i++) state = benchFromDeck(state, "p1", BENCH_BODY);
  state = discardFromDeck(state, "p1", WATER, pile);
  return state;
}

function attackWith(state: GameState) {
  return step(state, { type: "attack", seat: "p1", index: ENERGY_ASSIST_IDX });
}

function parkOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
  return prompt;
}

function energyOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (pokemon?.energy ?? []).map((uid) => idOf(state, uid));
}

function all<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Every `attachEnergyFrom` op the REGISTRY authors, paired with the id that owns
    it — `attachDecline.test.ts`'s walker, kept separate rather than exported so
    the two files' claims cannot drift into one shared assumption. */
function registryAttachOps(): Map<string, Extract<EffectOp, { op: "attachEnergyFrom" }>[]> {
  const found = new Map<string, Extract<EffectOp, { op: "attachEnergyFrom" }>[]>();
  const walk = (node: unknown, into: Extract<EffectOp, { op: "attachEnergyFrom" }>[]): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, into);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.op === "attachEnergyFrom") {
      into.push(rec as unknown as Extract<EffectOp, { op: "attachEnergyFrom" }>);
    }
    for (const value of Object.values(rec)) walk(value, into);
  };
  for (const id of registryCardIds()) {
    const ops: Extract<EffectOp, { op: "attachEnergyFrom" }>[] = [];
    walk(programFor(id), ops);
    if (ops.length > 0) found.set(id, ops);
  }
  return found;
}

// ── 1. THE POPULATION, WALKED OFF **BOTH** PRODUCERS ─────────────────────────

describe("D359 §1 — the quantity population, over the registry AND the deriver", () => {
  it("🛑 the REGISTRY half is exactly ~~8~~ printings on 3 sentences, by id (🆕🆕🆕 D582 (D539): *8* WITHDRAWN — 9 since the `me` alias Ethan's Ho-Oh ex `me02.5-026`; 🆕🆕🆕 D587: 11 printings on 4 sentences since Philippe ×2; 🆕🆕🆕 D588: 14 on 5 since Rosa's Encouragement ×3)", () => {
    const withCount = [...registryAttachOps()]
      .filter(([, ops]) => ops.some((op) => op.count !== undefined))
      .map(([id]) => id)
      .filter((id) => !id.startsWith("fix-"));
    expect(withCount.sort()).toEqual(
      [
        ...QUANTITY_IDS.goldenFlame,
        ...QUANTITY_IDS.battleHardened,
        ...QUANTITY_IDS.spikeClad,
        // 🆕🆕🆕 D582 — Ethan's Ho-Oh ex `me02.5-026`, a reprint-alias of `sv10-039` (the SAME
        // `ETHANS_HO_OH_EX` object): the 8 are now 9 printings, still 3 sentences.
        "me02.5-026",
        // 🆕🆕🆕 D587 — Philippe `me04-079` / `-110` (`PHILIPPE`): *"Attach up to 2 Basic {M} Energy
        // cards from your discard pile to 1 of your {M} Pokémon."* — the same `count: 2` reading
        // (the batch pinned to the one named body, the printed {0, 1, 2} on this axis), a fourth
        // sentence. `trainerParamsMeD587.test.ts` §4 drives its park.
        "me04-079",
        "me04-110",
        // 🆕🆕🆕 D588 — Rosa's Encouragement `me03-084` / `-114` / `-123` (`ROSAS_ENCOURAGEMENT`):
        // *"Attach up to 2 Basic Energy cards from your discard pile to 1 of your Stage 2 Pokémon."* —
        // the same `count: 2` reading on the new `stage2Only` rider, a fifth sentence.
        // `trainerParamsMeD588.test.ts` §6 drives its park.
        "me03-084",
        "me03-114",
        "me03-123",
      ].sort(),
    );
    expect(withCount).toHaveLength(14);
  });

  it("🛑🛑 the DERIVER half is 5 more printings the registry cannot see", () => {
    // **THIS IS THE WHOLE OF D358's CENSUS MISS, MADE INTO AN ASSERTION.** That
    // slice walked the registry and reported the residue as 8 printings; these
    // three sentences build through `deriveAttackEffect` and carry no registry row
    // at all, so no registry walk however careful could have found them.
    for (const id of [
      ...QUANTITY_IDS.energyAssist,
      ...QUANTITY_IDS.regiCharge,
      ...QUANTITY_IDS.returnCharge,
    ]) {
      expect(programFor(id), `${id} must have NO registry program`).toBeUndefined();
    }
    const derived: Record<string, EffectOp[] | null> = {
      energyAssist: deriveAttackEffect(ENERGY_ASSIST),
      regiCharge: deriveAttackEffect(
        "Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon.",
      ),
      returnCharge: deriveAttackEffect(
        "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.",
      ),
    };
    expect(derived.energyAssist).toEqual([
      { op: "attachEnergyFrom", source: "discard", benchOnly: true, count: 2 },
    ]);
    expect(derived.regiCharge).toEqual([
      { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", toSelf: true, count: 2 },
    ]);
    // Kilowattrel's is the same op behind a §9.2 gate — the hardest reachable site
    // for this axis, and the one that proves the ceiling is not a property of
    // being a program's FIRST op.
    expect(derived.returnCharge).toEqual([
      { op: "switchActive", recordAs: "moved" },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [
          { op: "attachEnergyFrom", source: "hand", energyType: "Lightning", toSelf: true, count: 2 },
        ],
      },
    ]);
  });

  it("13 printings on 6 sentences — the two halves reconcile rather than agree by luck", () => {
    const groups = Object.values(QUANTITY_IDS);
    expect(groups).toHaveLength(6);
    expect(groups.flat()).toHaveLength(13);
    expect(new Set(groups.flat()).size).toBe(13);
    // 8 registry + 5 deriver, and the split is by PRODUCER rather than by column:
    // three of the six are Abilities and three are attacks, and every attack one
    // is invisible to `programFor`.
    expect(
      [...QUANTITY_IDS.goldenFlame, ...QUANTITY_IDS.battleHardened, ...QUANTITY_IDS.spikeClad],
    ).toHaveLength(8);
    expect(
      [...QUANTITY_IDS.energyAssist, ...QUANTITY_IDS.regiCharge, ...QUANTITY_IDS.returnCharge],
    ).toHaveLength(5);
  });
});

// ── 2. THE PRINTED {0, 1, 2}, DRIVEN END TO END ──────────────────────────────

describe("D359 §2 — Oricorio's printed {0, 1, 2}, all three reachable", () => {
  it("🛑 the park carries the printed CEILING and every Benched body", () => {
    const parked = attackWith(ready(11));
    const prompt = parkOf(parked.state);
    expect(prompt.upTo).toBe(2);
    expect(prompt.candidates).toEqual([benchRef(0), benchRef(1)]);
    // The Active is NOT offered — the printed "Benched" is a live rider.
    expect(prompt.candidates).not.toContainEqual(ACTIVE);
    expect(prompt.note).toBe("Attach up to 2 Energy to which of your Benched Pokémon?");
  });

  it("TWO — the pre-D359 behaviour, still reachable and still what a bare ref means", () => {
    const parked = attackWith(ready(11));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    expect(energyOn(done.state, benchRef(0))).toEqual([WATER, WATER]);
    expect(energyOn(done.state, benchRef(1))).toEqual([]);
    expect(all(done.events, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.state.players.p1.discard.filter((u) => idOf(done.state, u) === WATER)).toHaveLength(0);
  });

  it("🛑 ONE — the printed MIDDLE answer, UNREACHABLE before this slice", () => {
    const parked = attackWith(ready(11));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0), take: 1 },
    });
    expect(energyOn(done.state, benchRef(0))).toEqual([WATER]);
    expect(all(done.events, "ENERGY_ATTACHED")).toHaveLength(1);
    // …and the second Energy is still in the pile. A build that read `op.count`
    // and ignored the answer passes every "something was attached" assertion and
    // fails exactly here.
    expect(done.state.players.p1.discard.filter((u) => idOf(done.state, u) === WATER)).toHaveLength(1);
  });

  it("🛑🛑 ZERO — and on an ATTACK this answer had NO other route to it", () => {
    // The ability half of this population reaches 0 through an activated or
    // triggered *"you may"*. **An attack is declared and resolves**: Oricorio's
    // program holds no `optional`, so before D359 its printed answer set was {2}
    // alone — a strictly worse defect than the abilities', and one no decline flag
    // on the OP could have reached either, since there is nothing to decline.
    const parked = attackWith(ready(11));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
    expect(energyOn(done.state, benchRef(1))).toEqual([]);
    expect(all(done.events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.state.players.p1.discard.filter((u) => idOf(done.state, u) === WATER)).toHaveLength(2);
    expect(done.state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 the batch still lands on ONE body — the quantity did not buy a SPLIT", () => {
    // D205's rule, re-asserted where it is now most at risk: `count` pins the
    // batch to the one body the print names, and the answer names ONE ref. A
    // design that had answered the quantity with a MAP would let these two Energy
    // land on two Pokémon off a sentence that prints "to **1 of** your Benched".
    const parked = attackWith(ready(11));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(1) },
    });
    expect(energyOn(done.state, benchRef(1))).toEqual([WATER, WATER]);
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
  });

  it("`min(count, available)` still holds — a one-card pile attaches one, silently", () => {
    const parked = attackWith(ready(11, { pile: 1 }));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    expect(energyOn(done.state, benchRef(0))).toEqual([WATER]);
  });
});

// ── 3. THE VALIDATOR — every way a quantity can be wrong ─────────────────────

describe("D359 §3 — the validator is the only place the printed ceiling is enforced", () => {
  const reject = (state: GameState, choice: { kind: "pokemon"; ref?: PokemonRef; take?: number }) => {
    const result = applyAction(state, { type: "resolveEffect", seat: "p1", choice });
    if (result.ok) throw new Error("expected the frame to be rejected");
    return result.error;
  };

  it("🛑 a take ABOVE the printed ceiling is refused — the one a crafted frame wants", () => {
    const parked = attackWith(ready(11)).state;
    const error = reject(parked, { kind: "pokemon", ref: benchRef(0), take: 3 });
    expect(error.code).toBe("BAD_EFFECT_CHOICE");
    expect(error.message).toBe("that is not a legal quantity");
  });

  it("a take of ZERO beside a named body is refused — the decline, spelled twice", () => {
    // Not a typo-catcher: the union already spells the decline as the ABSENT ref,
    // and a second spelling is how a §9.2 `recordGate` reading *"if you attached
    // Energy in this way"* gets handed a body with no uids.
    const parked = attackWith(ready(11)).state;
    expect(reject(parked, { kind: "pokemon", ref: benchRef(0), take: 0 }).message).toBe(
      "that is not a legal quantity",
    );
  });

  it("a NON-INTEGER take is refused — a wire number is not a whole one", () => {
    const parked = attackWith(ready(11)).state;
    expect(reject(parked, { kind: "pokemon", ref: benchRef(0), take: 1.5 }).message).toBe(
      "that is not a legal quantity",
    );
  });

  it("a take beside a DECLINE is refused — two answers in one frame", () => {
    const parked = attackWith(ready(11)).state;
    expect(reject(parked, { kind: "pokemon", take: 1 }).message).toBe(
      "a declined choice takes nothing",
    );
  });

  it("🛑 a MANDATORY prompt refuses BOTH the decline and the quantity, separately", () => {
    // The eight mandatory parks (switchActive, gust, healChosen's single arm, the
    // counter moves, both evolve-body continuations) have no referent for "how
    // many", and Boss's Orders prints no *"up to"* to decline. Two rejections with
    // two sentences, because a reader looking at a Pokémon should not be told
    // their message was malformed when it was their card that said no.
    const parked = attackWith(ready(11)).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const phase = parked.phase;
    const prompt = parkOf(parked);
    const { upTo: _dropped, ...mandatory } = prompt;
    const asMandatory: GameState = { ...parked, phase: { ...phase, prompt: mandatory } };
    expect(reject(asMandatory, { kind: "pokemon" }).message).toBe("this choice cannot be declined");
    expect(reject(asMandatory, { kind: "pokemon", ref: benchRef(0), take: 1 }).message).toBe(
      "this choice takes no quantity",
    );
    // …and the ordinary answer to a mandatory prompt is still accepted.
    expect(
      applyAction(asMandatory, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon", ref: benchRef(0) },
      }).ok,
    ).toBe(true);
  });

  it("🛑 the APPLY clamps to the printed count too — the belt behind the validator", () => {
    // `applyChoice` is reachable with a wire-supplied number, and the validator is
    // what refuses an over-take. This drives the BELT directly, because a guard
    // only the validator can reach is a guard nothing tests: the clamp is what
    // keeps a frame that somehow got past the barrier from emptying the pile.
    const parked = attackWith(ready(11, { pile: 4 })).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const events: GameEvent[] = [];
    const after = applyChoice(
      parked,
      parked.phase.cont.pendingOp,
      { kind: "pokemon", ref: benchRef(0), take: 4 },
      parked.phase.cont.ctx,
      events,
    );
    expect(energyOn(after, benchRef(0))).toEqual([WATER, WATER]);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
  });

  it("a ref that is not a candidate is still refused, quantity or no quantity", () => {
    const parked = attackWith(ready(11)).state;
    expect(reject(parked, { kind: "pokemon", ref: ACTIVE, take: 1 }).message).toBe(
      "that Pokémon is not a legal target",
    );
  });

  it("the FULL take may be spelled either way, and both land the same board", () => {
    const bare = step(attackWith(ready(11)).state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    const spelled = step(attackWith(ready(11)).state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0), take: 2 },
    });
    expect(energyOn(spelled.state, benchRef(0))).toEqual(energyOn(bare.state, benchRef(0)));
  });
});

// ── 4. THE WIRE, AND THE CEILING THAT MUST NOT BE CLAMPED ────────────────────

describe("D359 §4 — the redacted prompt, and the leak a clamp would have been", () => {
  it("the REDACTED prompt carries `upTo`, and a mandatory one carries no key at all", () => {
    const parked = attackWith(ready(11)).state;
    const view = redactGame(parked, "p1");
    if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const wire = view.phase.prompt;
    if (wire === null || wire.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(wire.upTo).toBe(2);

    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const phase = parked.phase;
    const { upTo: _dropped, ...mandatory } = parkOf(parked);
    const plainView = redactGame({ ...parked, phase: { ...phase, prompt: mandatory } }, "p1");
    if (plainView.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const plain = plainView.phase.prompt;
    if (plain === null || plain.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(Object.keys(plain).sort()).toEqual(["candidates", "kind", "note"]);
  });

  it("🛑 THE CEILING IS THE PRINTED NUMBER, AND `note` IS WHAT PROVES IT MUST BE", () => {
    // ⚠️ **A CLAIM THIS SLICE MADE AND THEN MEASURED FALSE, CORRECTED HERE RATHER
    // THAN QUIETLY DROPPED.** The first argument for leaving the ceiling unclamped
    // was that clamping it to the matching Energy available would LEAK the
    // controller's hand to the opponent. It would not: `redactPhase` sends an
    // `effect:choose` prompt ONLY to the seat that must answer it and `null` to
    // every other viewer, so no field on this prompt can leak to anyone.
    //
    // **THE REAL ARGUMENT IS INTERNAL CONSISTENCY, AND IT IS SHARPER.** The park's
    // `note` quotes the PRINTED count verbatim ("up to 2 Energy") — it has since
    // D205, deliberately, because the count is the one thing about this park a
    // player cannot read off the offered rows. A `upTo` clamped to the zone would
    // say 1 under a caption saying 2: **one prompt contradicting itself**, with the
    // dialog offering one button and the sentence above it promising two. Driven
    // over three pile sizes, both halves asserted together.
    for (const pile of [1, 2, 4]) {
      const parked = attackWith(ready(11, { pile })).state;
      const prompt = parkOf(parked);
      expect(prompt.upTo, `pile of ${pile}`).toBe(2);
      expect(prompt.note, `pile of ${pile}`).toContain("up to 2 Energy");
    }
  });

  it("the prompt reaches ONLY the answerer, which is why no field on it can leak", () => {
    // The measurement behind the correction above, kept as an assertion so a later
    // slice that widens the gate has to come here first.
    const parked = attackWith(ready(11)).state;
    const opponent = redactGame(parked, "p2");
    if (opponent.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(opponent.phase.prompt).toBeNull();
  });
});

// ── 5. THE REFUTATIONS, RUN FROM SOURCE ON A BOARD ───────────────────────────

describe("D359 §5 — what this slice refused, driven rather than asserted", () => {
  it("🛑 refutation (a): `count > 1` COMES ONLY FROM A PRINTED 'up to N'", () => {
    // **THE MEASURED GROUND FOR AUTHORING NO NEW OP FIELD.** `attachFromZoneClause`
    // offers three alternatives — "an Energy card", "a Basic {X} Energy card", and
    // "up to N Basic {X} Energy cards" — and only the third carries a number. So a
    // sentence that names a quantity WITHOUT the printed hedge is not read at all,
    // which is what makes `count` unambiguously a ceiling and `upTo` beside it a
    // second key on one axis.
    expect(
      deriveAttackEffect("Attach 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Attach 2 Basic {F} Energy cards from your discard pile to this Pokémon."),
    ).toBeNull();
    // …and the hedged form of the SAME sentence is read, with the count.
    const hedged = deriveAttackEffect(ENERGY_ASSIST);
    expect(hedged?.[0]).toMatchObject({ op: "attachEnergyFrom", count: 2 });
    // The unhedged SINGULAR is read too, and carries no count — so "no count" and
    // "a count" are the two printed readings and there is no third.
    const singular = deriveAttackEffect(
      "Attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon.",
    );
    expect(singular?.[0]).not.toHaveProperty("count");
  });

  it("🛑 refutation (b): NO OP FIELD MOVED — `declinable` and `count` still never co-occur", () => {
    // The prompt gained the ceiling; the OP did not. `attachDecline.test.ts` §1
    // asserts this same partition and is UNEDITED by this slice, which is the
    // strongest form the claim can take: a slice that pairs them still has to come
    // there and say why, and this one did not have to.
    for (const [id, ops] of registryAttachOps()) {
      for (const op of ops) {
        expect(op.declinable === true && op.count !== undefined, id).toBe(false);
      }
    }
    // …and every one of the eight registry printings still carries `count` and NOT
    // `declinable`, by id and in both directions.
    for (const id of [
      ...QUANTITY_IDS.goldenFlame,
      ...QUANTITY_IDS.battleHardened,
      ...QUANTITY_IDS.spikeClad,
    ]) {
      const ops = registryAttachOps().get(id) ?? [];
      expect(ops, id).toHaveLength(1);
      expect(ops[0]?.count, id).toBe(2);
      expect(ops[0]?.declinable, id).toBeUndefined();
    }
  });

  it("🛑 refutation (c): the DISCARD-sourced batch parks a REF, never a MAP", () => {
    // The `attachCards` map prompt was the obvious home for "how many, and where",
    // and it is refused twice over. **The zone**: its three producers read the deck
    // TOP, a deck SEARCH and the HAND, and no op in this engine reads the DISCARD
    // PILE into a map prompt (`attachDecline.test.ts` §4 pins that partition off
    // the registry) — while three of this slice's six sentences are
    // `source: "discard"`. **And the shape**: a map answers *which card goes
    // where*, re-opening the distribution `count` exists to close. Driven here on
    // the discard-sourced board: the park is a `choosePokemon`, and the ANSWER
    // carries exactly one ref, so the two Energy cannot be split whatever the
    // client sends.
    const parked = attackWith(ready(11)).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
    expect(parked.phase.prompt.kind).not.toBe("attachCards");
    // A map-shaped answer is refused outright — there is no route from this park
    // to a per-card destination.
    expect(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: parked.players.p1.discard[0] as string, to: benchRef(0) },
            { uid: parked.players.p1.discard[1] as string, to: benchRef(1) },
          ],
        },
      }).ok,
    ).toBe(false);
  });

  it("🛑 refutation (d): the answer set is EXACTLY 0..N — nothing unprinted is legal", () => {
    // The one thing a widened prompt member must never do. Every k in 0..2 lands a
    // board, and every k outside it is refused — so the capability bought is
    // precisely §9.1's *"one, two, or none, all legal"* and not a byte more.
    const landed = [0, 1, 2].map((k) => {
      const parked = attackWith(ready(11)).state;
      const choice = k === 0 ? { kind: "pokemon" as const } : { kind: "pokemon" as const, ref: benchRef(0), take: k };
      return energyOn(step(parked, { type: "resolveEffect", seat: "p1", choice }).state, benchRef(0)).length;
    });
    expect(landed).toEqual([0, 1, 2]);
    for (const bad of [-1, 0, 3, 99]) {
      const parked = attackWith(ready(11)).state;
      expect(
        applyAction(parked, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: benchRef(0), take: bad },
        }).ok,
        `take: ${bad}`,
      ).toBe(false);
    }
  });
});

// ── 6. THE POOL AND THE IDS ──────────────────────────────────────────────────

describe("D359 §6 — the ids this file rests on are real and locally seated", () => {
  it("the local pool carries the printing under test, and none of it reaches FIXTURE_POOL", () => {
    expect(POOL[ORICORIO]?.attacks?.[ENERGY_ASSIST_IDX]?.effect).toBe(ENERGY_ASSIST);
    expect(POOL[ORICORIO]?.attacks?.[ENERGY_ASSIST_IDX]?.name).toBe("Energy Assist");
    // ⚠️ THE SECOND PRINTING IS NOT SEATED AND THAT IS DELIBERATE: it carries the
    // byte-identical sentence, so a second body would test the deriver twice and
    // the board zero extra times. Its presence in the population is asserted from
    // D1 in §1, where the claim actually lives.
    expect(QUANTITY_IDS.energyAssist).toEqual([ORICORIO, ORICORIO_B]);
    expect(Object.keys(POOL).sort()).toEqual([BENCH_BODY, FIRE, ORICORIO, WATER].sort());
  });

  it("🛑 ZERO registry keys were added — this slice moves no census figure", () => {
    // 🆕🆕🆕 D553 — 713 -> **725**: TWELVE registry keys on SEVEN program objects —
    // the simple once-per-turn Abilities (Rapidash, Chandelure, Blissey ex, Swadloon,
    // Mamoswine ex, Sawsbuck, Ethan's Quilava). Real catalog ids and NOT `fix-*` keys
    // (both suites drive a LOCAL `cardPool`, D275's idiom), inserted MID-MAP, and no
    // row authors an `attack` program, so the ATTACK summand cannot move with them.
    // 🆕🆕 D396 — 710 -> **713**: THREE registry keys on ONE program object,
    // Sylveon ex `sv08-086`/`sv08.5-041`/`sv08.5-156` — a bare `attackGate` at index
    // **1** carrying `barredIf`, the SECOND gate in that field at a NON-ZERO index
    // and the first on which the gate NAMES its own attack. Real catalog ids and NOT
    // `fix-*` keys (the suite drives a LOCAL `cardPool`, D275's idiom), and the row
    // authors no `attack` program, so the ATTACK summand cannot move with them.
    // 🆕🆕 D395 — 709 -> **710**: ONE registry key, Miltank `sv08.5-081`
    // — a bare `attackGate` at index **1**, the first gate in that field at a
    // NON-ZERO index. A real catalog id and NOT a `fix-*` key (its suite drives a
    // LOCAL `cardPool`, D275's idiom), and it authors no `attack` program, so the
    // ATTACK summand cannot move with it.
    // 🆕🆕 D391 — 708 -> **709**: ONE `EnergyProgram` key, `fix-grassdouble`, the
    // FIXTURE Special providing `{G}{G}` — the first `provides` row to spell one type
    // TWICE, and the only board on which a CARD count and a UNIT count disagree under a
    // typed filter. A `fix-*` key, so no catalog printing moved with it.
    // 🆕🆕🆕 D554 — 725 -> **740**: FIFTEEN registry keys on NINE program objects —
    // the deck-search Trainers (Hilda, Colress's Tenacity, Cyrano, Hyper Aroma, Team
    // Rocket's Transceiver, Energy Search Pro, Precious Trolley, Boxed Order,
    // Cassiopeia). Real catalog ids and NOT `fix-*` keys (`deckSearchTrainers.test.ts`
    // drives a LOCAL `cardPool`, D275's idiom), inserted MID-MAP, and no row authors
    // an `attack` program, so the ATTACK summand cannot move with them.
    // 🆕🆕🆕 D555 — 740 -> **760**: TWENTY registry keys on TWELVE program objects —
    // the zero-vocabulary Trainers (Cook, Poké Vital A, Iris's Fighting Spirit, Eri,
    // Meddling Memo) and Abilities (Torrid Scales, Ancient Wing, Beckoning Tail,
    // Torrential Whirlpool, Sand Stream, Snow Sink, Wicked Tail). Real catalog ids, no
    // `fix-*` key (`simpleTrainersD555.test.ts` / `simpleAbilitiesD555.test.ts` drive a
    // LOCAL `cardPool`), inserted MID-MAP, and no row authors an `attack` program.
    // 🆕🆕🆕 D556 — 760 -> **779**: NINETEEN registry keys on SEVEN program objects —
    // Black Belt's Training, Team Rocket's Ariana, Billy & O'Nare, Dragon Elixir, Team
    // Rocket's Great Ball, Caretaker and Pecharunt "Toxic Subjugation". Real catalog ids,
    // no `fix-*` key (`sideAttackBonusThisTurn.test.ts` / `conditionalTrainersD556.test.ts`
    // drive a LOCAL `cardPool`), inserted MID-MAP, and no row authors an `attack` program.
    // 🆕🆕🆕 D557 — 779 -> **798**: NINETEEN registry keys on ELEVEN program objects —
    // Kieran, Team Rocket's Venture Bomb, Morty's Conviction, Xerosic's Machinations,
    // Lucian, Arven's Sandwich, Megaton Blower, Brilliant Blender, TM Machine, Dusk Ball
    // and Tool Scrapper. Real catalog ids, no `fix-*` key (`chooseOneTrainersD557.test.ts`
    // / `riderTrainersD557.test.ts` drive a LOCAL `cardPool`), inserted MID-MAP after
    // `svp-149`, and no row authors an `attack` program.
    // 🆕🆕🆕 D558 — 798 -> **816**: EIGHTEEN registry keys on TWELVE program objects —
    // Counter Gain, Hop's Choice Band, Brave Bangle, Air Balloon, Rescue Board, Gravity
    // Gemstone (Tools), Full Metal Lab, Granite Cave, Postwick, N's Castle, Paradise Resort
    // (Stadiums) and Salvatore. Real catalog ids, no `fix-*` key
    // (`continuousToolsStadiumsD558.test.ts` / `salvatoreD558.test.ts` drive a LOCAL
    // `cardPool`), inserted MID-MAP after `sv10.5w-085`, and no row authors an `attack`
    // program.
    // 🆕🆕🆕 D559 — 816 -> **831**: FIFTEEN registry keys on SEVEN program objects — the
    // ability bundle (Lillie's Clefairy ex ×4, Flutter Mane ×3, Gastrodon, Orthworm ex ×2,
    // Maractus ×2, Klinklang ×2, Regirock). Real catalog ids, no `fix-*` key
    // (`abilityBundleD559.test.ts` / `abilityRecoilArmorD559.test.ts` drive a LOCAL
    // `cardPool`), inserted MID-MAP after `sv05-212`, and no row authors an `attack`
    // program.
    // 🆕🆕🆕 D560 — 831 -> **848**: SEVENTEEN registry keys on ELEVEN program objects — the
    // second ability bundle (Drilbur, Team Rocket's Koffing, Thwackey ×2, Slaking ex ×2,
    // Annihilape, Galvantula, Magmortar, Whimsicott ×2, Dachsbun ex ×3, Indeedee ×2,
    // Cradily). Real catalog ids, no `fix-*` key (`abilityTriggersD560.test.ts` /
    // `abilityPassivesD560.test.ts` drive a LOCAL `cardPool`), inserted MID-MAP after
    // `sv09-082`, and no row authors an `attack` program.
    // 🆕🆕🆕 D561 — 848 -> **863**: FIFTEEN registry keys on NINE program objects — the
    // trainer bundle (Perrin ×3, Crispin ×4, Super Potion, Love Ball, Hand Trimmer, Scoop Up
    // Cyclone ×2, Scramble Switch, Academy at Night, Perilous Jungle). Real catalog ids, no
    // `fix-*` key (`trainersD561.test.ts` / `stadiumsD561.test.ts` drive a LOCAL
    // `cardPool`), inserted MID-MAP after `sv07-006`, and no row authors an `attack`
    // program.
    // 🆕🆕🆕 D562 — 863 -> **877**: FOURTEEN registry keys on TWELVE program objects —
    // consumable Tools, Jamming Tower and Festival Grounds (six type Berries, Survival Brace,
    // Deluxe Bomb, Lucky Helmet, Handheld Fan, Jamming Tower ×2, Festival Grounds ×2). Real
    // catalog ids, no `fix-*` key (`toolsD562.test.ts` / `stadiumsD562.test.ts` drive a LOCAL
    // `cardPool`), inserted MID-MAP after `sv05-156`, and no row authors an `attack`
    // program.
    // 🆕🆕🆕 D563 — 877 -> **888**: ELEVEN registry keys on FIVE program objects — Eevee ex
    // ×3 "Rainbow DNA", Noivern "Tuning Echo", Kyurem "Plasma Bane", Feraligatr ×2
    // "Torrential Heart", Palafin ex ×4 "Hero's Spirit". Real catalog ids, no `fix-*` key
    // (`abilityCostEvolveD563.test.ts` / `torrentialHeartD563.test.ts` drive a LOCAL
    // `cardPool`), inserted MID-MAP after `sv08.5-108`, and no row authors an `attack`
    // program.
    // 🆕🆕🆕 D564 — 888 -> **897**: NINE registry keys on FIVE program objects — Jasmine's
    // Gaze ×3, Amarys ×3, Team Rocket's Factory, Community Center, Crobat "Shadowy Envoy"
    // (Caretaker's rider re-authors an EXISTING object on its two existing keys). Real catalog
    // ids, no `fix-*` key (`trainerBundleD564.test.ts` / `sideDamageNextTurnD564.test.ts` drive
    // a LOCAL `cardPool`), inserted MID-MAP after `sv08.5-151`, and no row authors an `attack`
    // program.
    // 🆕🆕🆕 D565 — 897 -> **905**: EIGHT registry keys on FIVE program objects — Misty's
    // Psyduck ×2 "Flustered Leap", Team Rocket's Orbeetle ×2 "Rocket Brain", Farfetch'd
    // "Impromptu Carrier", Palafin "Zero to Hero", Ruffian ×2. Real catalog ids, no `fix-*` key
    // (`abilityBundleD565.test.ts` / `ruffianD565.test.ts` drive a LOCAL `cardPool`), inserted
    // MID-MAP after `sv06.5-029`, and no row authors an `attack` program.
    // 🆕🆕🆕 D566 — 905 -> **914**: NINE registry keys on SIX program objects — Brock's Scouting
    // ×2, Ogre's Mask ×2, Heavy Baton, Amulet of Hope, Powerglass ×2, Team Rocket's Watchtower.
    // Real catalog ids, no `fix-*` key (`trainerBundleD566.test.ts` / `koToolsD566.test.ts`
    // drive a LOCAL `cardPool`), inserted MID-MAP after `sv06-060`, and no row authors an
    // `attack` program.
    // 🆕🆕🆕 D567 — 914 -> **918**: FOUR registry keys on FOUR program objects — Redeemable Ticket,
    // Accompanying Flute, Team Rocket's Bother-Bot (Items) and Grand Tree (Stadium) — all non-attack.
    // 🆕🆕🆕 D568 — 918 -> **935**: SEVENTEEN registry keys on EIGHT program objects — the Tera
    // banner unlock, Slice 1: Sparkling Crystal ×2, Tera Orb, Glass Trumpet ×2, Briar ×4, Milotic ex
    // ×3 "Sparkling Scales", Noctowl ×3 "Jewel Seeker", Azumarill "Glistening Bubbles", and
    // Terapagos `sv08-161` — the ONE row that authors an `attack` key ("Prism Charge"). Real
    // catalog ids, no `fix-*` key (`teraBannerD568.test.ts` drives a LOCAL `cardPool`), inserted
    // MID-MAP after `sv07-136`. (Ho-Oh and Regigigas are deriver arms, not keys.)
    // 🆕🆕🆕 D569 — 935 -> **949**: FOURTEEN registry keys on SEVEN program objects — the Paradox
    // banner unlock, Slice 2 part a: Iron Crown ex ×6 "Cobalt Command", Awakening Drum, Reboot Pod
    // (non-attack), and SIX `attack`-keyed rows — Miraidon ×2 "Peak Acceleration", Great Tusk ×2
    // "Land Collapse", Scream Tail "Supportive Singing", Flutter Mane "Perplexing Transfer". Real
    // catalog ids, no `fix-*` key, inserted MID-MAP after `sv08-161`. (Koraidon ×2, Roaring Moon
    // ×2, Iron Valiant and Slither Wing are deriver arms, not keys.)
    // 🆕🆕🆕 D570 — 949 -> **956**: SEVEN registry keys on ONE program object — Festival Lead
    // (Dipplin ×3, Goldeen ×2, Swirlix, Seaking), all NON-attack (`passive.attackTwiceIf`). Real
    // catalog ids, no `fix-*` key, inserted MID-MAP after D569's rows (`raw[last]` stays put).
    // 🆕🆕🆕 D571 — 956 -> **962**: SIX registry keys on THREE program objects — Iron Thorns ex
    // "Initialization" ×3 (non-attack, `passive.disableAbilities`), Iron Thorns "Destructo-Press"
    // ×2 (ATTACK index 0) and Ignition Energy ×1 (non-attack, `energy`). Real catalog ids, no
    // `fix-*` key, inserted MID-MAP after D570's rows (`raw[last]` stays put).
    // 🆕🆕🆕 D572 — 962 -> **968**: SIX registry keys on FOUR program objects — Munkidori ×3
    // "Adrena-Brain" (`abilities`), Milotic "Mentally Calm" and Huntail "Diver's Catch"
    // (`passive`), Klinklang `sv07-101` "Emergency Rotation" (the NEW `benchFromHand`), ALL
    // non-attack. Real catalog ids, no `fix-*` key, inserted MID-MAP after D571's rows.
    // 🆕🆕🆕 D574 — 968 -> **969**: ONE registry key — Malamar `sv06.5-034` "Colluding Tentacles"
    // (`MALAMAR_COLLUDING_TENTACLES`, an ATTACK row on existing ops), keyed beside Xerosic's Machinations.
    // 🆕🆕🆕 D576 — 969 -> **973**: FOUR registry keys on THREE program objects — the Antique Fossils
    // `sv07-129` / `sv10.5b-080` (`PROTECTIVE_COVER`), `sv07-130` (`PRIMAL_ROOT`), `sv10.5w-079`
    // (`PLUME_PROTECTION`): `playAsPokemon` + `passive`, ALL non-attack. Real catalog ids, no `fix-*`
    // key, inserted MID-MAP after D572's rows (Area Zero Underdepths ×3 is PARKED, D577).
    // 🆕🆕🆕 D577 — 973 -> **979**: SIX registry keys on THREE program objects — Area Zero Underdepths
    // `sv07-131` / `sv07-174` / `sv08.5-094` (`AREA_ZERO_UNDERDEPTHS`, a `stadium`), Boomerang Energy
    // `sv06-166` (`BOOMERANG_ENERGY`, an `energy`) and Tyme `sv08-190` / `sv08.5-143` (`TYME`, a
    // `trainer`): ALL non-attack. Real catalog ids, no `fix-*` key, inserted MID-MAP after D576's rows.
    // (🆕🆕🆕 D577 (D539): *"Area Zero Underdepths ×3 is PARKED, D577"* above is WITHDRAWN — BUILT here.)
    // 🆕🆕🆕 D578 — 979 -> **985**: SIX registry keys on FOUR program objects — Scovillain ex
    // `sv08-037` / `sv08-216` (`DOUBLE_TYPE`, a `passive`), Technical Machine: Fluorite `sv08-188`
    // (`TM_FLUORITE`, `toolAttacks` + `toolDiscardAtEndOfYourTurn` + an `attack` key for its GRANTED
    // attack), Relicanth `sv05-084` / `sv05-173` (`MEMORY_DIVE`, a `passive`) and Team Rocket's Energy
    // `sv10-182` (`TEAM_ROCKETS_ENERGY`, an `energy`). Real catalog ids, no `fix-*` key, inserted
    // MID-MAP after D577's rows; no `attackGate`.
    expect(registryCardIds()).toHaveLength(1222); // (🆕🆕🆕 **D598 +13** — WP32: 13 `me` Ability ids (Mega Gengar ex ×5, Mega Hawlucha ex ×3, Annihilape, Shedinja ×2, Gengar, Pecharunt), MID-MAP, on six NEW non-attack objects; no `attackGate`.) (🆕🆕🆕 **D597 +2** — WP29: Mega Charizard X ex `mep-023` / `mep-029`, MID-MAP, on the NEW attack-only `INFERNO_X` (the `me02` "Inferno X" program; tcgdex prints "[R]"); no `attackGate`.) (🆕🆕🆕 **D594 +2** — WP33a: Luxio `me03-027` "Fighting Roar" and Chesnaught `me04-007` "Needly Armor", MID-MAP, on two NEW passive objects (`FIGHTING_ROAR`, `NEEDLY_ARMOR`), both non-attack; no `attackGate`.) (🆕🆕🆕 **D593 +5** — WP07: Drifblim `mep-006`, Meowth ex `me03-062` / `-107` / `-121` and Emolga `me04-030`, MID-MAP, on three NEW attack-only objects (Balloon Return, Tuck Tail ×3, Sky Return — Lillie's Comfey's "Fade Out" op at each printed index); no `attackGate`.) (🆕🆕🆕 **D591 +19** — WP20a: 19 `me` Pokémon ids, MID-MAP, on seven NEW `abilities` objects (Run Errand ×4, Alluring Wings, Fiery / Flash-Pop / Frosty Flapping ×3 each, Lunar Cycle ×3, Flaring Magic ×2), all non-attack; no `attackGate`.) (🆕🆕🆕 **D590 +13** — WP05: 13 `me` Pokémon ids, MID-MAP, on nine NEW `onEvolve` objects (Psychic Draw ×4 on two, Prison Panic, Energized Steps, Heave-Ho Catcher, Cast-Off Shell ×2, Enriching Melody ×2, Multiplying Cocoon, Haphazard Hammer), all non-attack; no `attackGate`.) (🆕🆕🆕 **D589 +5** — WP08: Mega Greninja ex ×5 (`mep-081`, `me04-022` / `-100` / `-116` / `-122`), MID-MAP, on the NEW `MORTAL_SHURIKEN`, all non-attack; no `attackGate`.) (🆕🆕🆕 **D588 +17** — WP22: 17 `me` Trainer ids, MID-MAP, on eight NEW objects (Canari ×3, Lillie's Determination ×4, Misty's Vitality ×2, Rosa's Encouragement ×3, Rust Syndicate Grunt ×2, Waitress, Hole-Digging Shovel, Lumiose Galette), all non-attack; no `attackGate`.) (🆕🆕🆕 **D587 +19** — WP04: 19 `me` Trainer ids, MID-MAP, on nine NEW objects (Wondrous Patch ×2, Philippe ×2, Jacinthe ×3, Firebreather ×2, Fighting Gong ×3, Tarragon ×2, Poké Pad ×3, Energy Swatter, Repel), all non-attack; no `attackGate`.) (🆕🆕🆕 **D586 +2** — WP03: Carbink `me02.5-117` / `-242` on the new `DOUBLE_TYPE_FP` ({F}{P} copy of Scovillain's `typesInPlay`), MID-MAP, non-attack; no `attackGate`.) (🆕🆕🆕 **D585 +19** — WP19's parameter copies: 19 `me` ids, MID-MAP, on eight NEW objects (Tundra Wall ×2, Wash Out, Powerful a-Salt ×2, Counterattacking Crest ×3, Stone Arms ×2, Scent Collection, Sky Transport ×5, Synchro Pulse ×3), all non-attack; no `attackGate`.) (🆕🆕🆕 **D584 +18** — the `me` alias tier 2: 18 `me` ids, MID-MAP — Ultra Ball ×2, Zoroark `30th-096` and Hop's Pincurchin ex `me02.5-068` on EXISTING objects, fourteen on the eight NEW D584 objects (Smooth Coat ×3, Shell Spikes, Incandescent Body ×2, Aerial Draw ×2, Share Happiness ×2, Intimidating Fang, Dopey Face, Float Up ×2 — the last two attack-only); no `attackGate`.) (🆕🆕🆕 **D583 +1** — Team Rocket's Energy `me02.5-217`, a reprint-alias key on `sv10-182`'s object, inserted MID-MAP; no `attackGate`.) (🆕🆕🆕 **D582 +99** — the Mega Evolution serie's reprint-alias tier: 99 `me` ids on EXISTING program objects, inserted MID-MAP; Terapagos ex `me02.5-179` shares `sv07-128`'s `attackGate`.) (🆕🆕🆕 **D580 +2** — Iron Treads `sv05-118` (`DUAL_CORE`, a `passive`) and Mr. Mime `sv05-063` (an attack-only row), two registry ids inserted MID-MAP; neither carries an `attackGate`.) (🆕🆕🆕 **D579 +1** — Walking Wake `sv06-063`, one attack-only registry id, inserted MID-MAP.)
    for (const id of Object.values(QUANTITY_IDS).flat()) {
      if (programFor(id) === undefined) continue;
      // Every id that DOES have a program had one before this slice: the eight
      // registry printings, unchanged byte for byte.
      expect(
        [...QUANTITY_IDS.goldenFlame, ...QUANTITY_IDS.battleHardened, ...QUANTITY_IDS.spikeClad],
      ).toContain(id);
    }
  });
});
