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
  it("🛑 the REGISTRY half is exactly 8 printings on 3 sentences, by id", () => {
    const withCount = [...registryAttachOps()]
      .filter(([, ops]) => ops.some((op) => op.count !== undefined))
      .map(([id]) => id)
      .filter((id) => !id.startsWith("fix-"));
    expect(withCount.sort()).toEqual(
      [
        ...QUANTITY_IDS.goldenFlame,
        ...QUANTITY_IDS.battleHardened,
        ...QUANTITY_IDS.spikeClad,
      ].sort(),
    );
    expect(withCount).toHaveLength(8);
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
    expect(registryCardIds()).toHaveLength(713);
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
