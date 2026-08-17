import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { EffectOp, EffectPrompt, GameState, PokemonRef, Seat } from "./index";
import { attachEnergyTargets } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import { battler, deckOf, typedEnergy } from "./testFixtures";
import { FIXTURE_POOL } from "./testFixtures";

// D354 — X-BOOT, AND THE ONE THING IT BUYS: `AttachTargetRiders.targetType` AS A
// PRINTED UNION OF TYPES.
//
// "Once during your turn, you may search your deck for a Basic {P} Energy card, a
//  Basic {M} Energy card, or 1 of each and attach them to your {P} Pokémon and
//  {M} Pokémon in any way you like. Then, shuffle your deck."
//        (Steven's Metagross ex sv10-145 — an Ability, 1 Standard-legal printing)
//
// ── 🛑🛑 THE RULES QUESTION WAS SETTLED BEFORE THE PRICE ─────────────────────
// D351 refused this card and D353 named the fork rather than the obstacle: this
// sentence has TWO readings, and only one of them costs anything.
//   • **PAIRING** — the {P} Energy goes on a {P} body and the {M} on a {M} body.
//     **FREE**: two `attachFromDeck` ops, each with its own single-`string`
//     `targetType`, and ZERO engine diff.
//   • **UNION** — the target set is your {P} Pokémon ∪ your {M} Pokémon and the
//     two found cards distribute over it freely, so a Basic {P} Energy may land
//     on a {M} body. **Costs one widened key.**
// **WHICH ONE THE CARD PRINTS IS A RULES QUESTION, NOT AN ENGINE ONE**, so it was
// answered from the catalog rather than from `effects.ts`.
//
// ⚠️ **CENSUS 1 — THE TEMPLATE.** `attach them to <NOUN> in any way you like`,
// over ALL THREE text columns (remote D1 `luminous`, 2026-08-16, `json_each`
// keyed on **`$.effect`** for the two JSON columns plus the bare `effect`
// column). **31 printings**, and the `<NOUN>` slot holds EXACTLY ONE set
// description in every one of them:
//     "your Pokémon"                        24  (14 ability + 10 attack)
//     "your Future Pokémon"                  2
//     "your Benched Pokémon"                 1
//     "your Marnie's Pokémon"                1
//     "your Tera Pokémon"                    1
//     "your {P} Pokémon and {M} Pokémon"     1  ← THIS CARD
// 🛑 **THERE IS NO PAIRING FORM ANYWHERE IN THE CATALOG** — nothing of the shape
// *"attach the {P} Energy to … and the {M} Energy to …"*. The pairing reading
// requires this one template slot to mean something different in 1 of its 31
// instances, which is not a reading but an exception.
//
// ⚠️ **CENSUS 2 — THE CONSTRUCTION.** *"your {X} Pokémon and {Y} Pokémon"* occurs
// on exactly **TWO** cards over all three columns: this one and Lilligant
// `sv09-007` — *"Attacks used by your {G} Pokémon **and** {R} Pokémon do 20 more
// damage…"* — whose sentence admits **NO pairing reading at all**: it is one set,
// membership by either type. That is the catalog's own gloss on the construction,
// and §7 pins it by id.
//
// And the syntax agrees: *"them"* is ONE plural referent for a set built from a
// THREE-way disjunction, landing in ONE noun phrase. There is no hook for a pair.
//
// ⚠️ **THE EXTRACTOR WAS VERIFIED AGAINST KNOWN-PRESENT ROWS BEFORE ANY ZERO IN
// IT WAS BELIEVED** — `sv10-145`, `sv09-007`, `sv09-107` — because the false-zero
// hazard here is that the ability text key is `$.effect` and NOT `$.text`.
//
// ── STEP 4: IS THIS THE CHEAPEST THING THAT SENTENCE BUYS? ───────────────────
// **IT IS THE ONLY THING**, for the third slice running. `aname = 'X-Boot'`
// returns exactly `sv10-145`; the union target noun is **1 printing / 1 card /
// 1 sentence / `legal_standard = 1`** over all three columns.
//
// ── ⚠️ THE `mutants.ts` SCAN CAME BACK **ZERO**, WHICH IS A DEBT ─────────────
// D352's audit, run BEFORE touching anything, as a byte-range overlap of every
// mutant `find` against the two function bodies this slice edits — **with the
// extractor verified against two known-present controls first** (`ownerNoun`'s
// body → `D204-ownerNoun`; `switchBenchNarrowing` → four D273 rows):
//     attachEnergyTargets body   (interpreter.ts 7931–7985)   NONE
//     attachTargetNoun body      (interpreter.ts 9448–9452)   NONE
// Zero `find` quotes a `targetType?:` declaration; zero quotes
// `AttachTargetRiders`. **The function `interpreter.ts` itself calls "THE IN-PLAY
// TARGET FILTER, AND IT IS THE ONLY GATE THAT MATTERS" had no mutation row on its
// own eligibility test after 1050 rows** — all nine keyword hits quote CALL
// SITES. And the contrast is 1500 lines away: `switchBenchNarrowing`, the same
// narrowing shape one function over, carries `D273-switch-type-reads-the-first-
// type-only`, **the exact mutant the attach side had never had.**
// **EMPTY MEANS YOU OWE ROWS FIRST**, and D354 owes them here.
//
// ── THE ENGINE DIFF, AND WHY IT IS ONE KEY AND NOT TWO ──────────────────────
//   • `AttachTargetRiders.targetType?: string` → `string | readonly string[]`.
//     A SECOND key (`targetTypes?`) is refused by this repo's own standing rule,
//     written on `attachFromTop.restTo` (D335/D352): *"two keys on one axis can be
//     set to contradict each other and no reading of the print says what the
//     contradiction means."* The precedent for ONE key widened to carry a second
//     reading is in this same op family — `attachFromTop.max: number | "any"`.
//   • `targetTypeNames` (interpreter.ts) — ONE normalisation, read by BOTH
//     consumers, so the gate and the caption cannot drift (§4 drives both).
//   • `attachFromDeck.targetType` widened; `attachFromTop`/`attachEnergyFrom`
//     keep the bare `string` (D331's speculative-field rule — no printing).
// ZERO new ops, prompt kinds, choice kinds, events, error codes, `GameState`
// fields, `CardFilter` members, regexes, deriver arms, `EffectSlot` members or
// `programPlayable` arms. `MATCH_RECORD_VERSION` **STAYS 21** — the diff widens an
// IN-MEMORY op field's type, programs are re-derived from the card id rather than
// persisted, and no record gains, loses or re-reads a byte.
//
// ⚠️ **WHAT THIS SUITE CAN AND CANNOT PUT RED, SAID UP FRONT** (the guard rule):
// * Narrowing either op to ONE type (the pairing reading) is caught by §2, whose
//   board offers a {P} body and a {M} body and drives a Basic {P} Energy onto the
//   {M} one. **That is the assertion the whole row exists for.**
// * Welding the two ops into one (`anyOf` + `max: 2`) is caught by §5, which
//   stacks the deck with TWO Basic {P} and asserts only ONE is reachable.
// * Dropping `targetType` altogether is caught by §2's third body, which is
//   neither {P} nor {M} and must never be offered.
// * Reading the rider's list as "must match ALL" is caught by §2 — no body in the
//   catalog is both {P} and {M}, so an `every` would offer nothing at all.
// * Reading only the FIRST member of the rider's list is caught by §2's {M} body.
// * Reading only the FIRST of the CARD's types is NOT reachable from this card
//   (every body here is single-typed), so §3 drives a dual-type body directly —
//   the one consumer this row's own card cannot exercise.
// * A caption that names a wider or narrower set than the gate is caught by §4,
//   which asserts the note and the offered target list against each other.

const X_BOOT = "sv10-145";

/** 🆕 D357 — D355's id (Energy Coin), named here ONLY so §6's ordering rung has
    a NAME to be ahead of. A wrong id makes `indexOf` return -1 and the rung goes
    RED, which is the property the `raw.length` spelling did not have. */
const ENERGY_COIN_ID = "sv10.5b-081";

/** The printed sentence, byte for byte, authored against the print rather than a
    paraphrase (D183's class) — 260-char `abilities_json`, remote D1 2026-08-16. */
const X_BOOT_TEXT =
  "Once during your turn, you may search your deck for a Basic {P} Energy card, " +
  "a Basic {M} Energy card, or 1 of each and attach them to your {P} Pokémon and " +
  "{M} Pokémon in any way you like. Then, shuffle your deck.";

/** ⚠️ **REAL IDS ON A LOCAL `cardPool` (D275's idiom), AND `FIXTURE_POOL` IS NOT
    TOUCHED.** `catalogManifest.ts` is generated off a local sqlite this clone does
    not have and measures a **978-row / 6-set** catalog (sv01/sv02/sv03/sv06.5/sve/
    swsh10.5) holding no `sv10` row at all, so no `fix-*` demonstrator is owed and
    none is written. **A FIXTURE IS A CENSUS POPULATION** (D348) —
    `catalogManifest.test.ts` and `clauseApostrophe.test.ts` both sweep
    `FIXTURE_POOL`, so §6 asserts BY ID that nothing here reached it. */
// ⚠️ EVERY REAL ID BELOW WAS READ OUT OF THE REMOTE D1 IN THE SESSION THAT WROTE
// IT (2026-08-16), never from memory — D353 wrote `sv09-160` for Mist Energy and
// D1 said that id is **Maractus**. **A CARRIED ID ROTS** and no test can see it,
// because a synthetic body under a wrong id still behaves.
// 🛑🛑 **D353's DEFECT (D) REPRODUCED ON D354, AND IT WAS CAUGHT BY AN ASSERTION
// RATHER THAN BY CARE.** The first draft of this file reached for two REAL {P}/{M}
// catalog bodies — Mimikyu `sv02-097` and Togedemaru `sv03-151` — on the reasoning
// that real ids are always better. **BOTH ARE ALREADY IN `FIXTURE_POOL`, AND
// `sv02-097` IS ALREADY A REGISTRY KEY** carrying a `passive` program (measured:
// `programFor("sv02-097")` has keys `["passive"]`). A passive on a supporting body
// is a live effect running underneath every board in this file, and §6's pool
// assertion is what found it. **A REAL ID IS NOT A FREE ID** — it may already
// carry a program, already sit in the shared pool, and already be counted by a
// census figure this slice measured as unmoved.
// So the two supporting bodies are SYNTHETIC (D351's `d351-fighter` idiom) and the
// only real catalog id this suite drives is the card under test.
const PSY_BODY = "d354-psy-body"; // types ["Psychic"] — the {P} half of the union
const METAL_BODY = "d354-metal-body"; // types ["Metal"] — the {M} half
const NEITHER = "d354-neither"; // a body of NEITHER printed type — the negative
const DUAL = "d354-dual"; // {P}+{M} on ONE body — unreachable from the catalog
const PSY_ENERGY = "d354-psychic-energy";
const METAL_ENERGY = "d354-metal-energy";
const WATER_ENERGY = "d354-water-energy"; // a Basic Energy of NEITHER named type

const LOCAL_CARDS: Record<string, Card> = {
  [X_BOOT]: battler(X_BOOT, {
    name: "Steven's Metagross ex",
    stage: "Stage2",
    evolveFrom: "Metang",
    hp: 340,
    retreat: 2,
    types: ["Metal"],
    abilities: [{ type: "Ability", name: "X-Boot", effect: X_BOOT_TEXT }],
  }),
  [PSY_BODY]: battler(PSY_BODY, { name: "D354 Psy", hp: 70, types: ["Psychic"] }),
  [METAL_BODY]: battler(METAL_BODY, { name: "D354 Metal", hp: 80, types: ["Metal"] }),
  [NEITHER]: battler(NEITHER, { name: "D354 Neither", hp: 70, types: ["Water"] }),
  [DUAL]: battler(DUAL, { name: "D354 Dual", hp: 70, types: ["Psychic", "Metal"] }),
  [PSY_ENERGY]: typedEnergy(PSY_ENERGY, "Psychic"),
  [METAL_ENERGY]: typedEnergy(METAL_ENERGY, "Metal"),
  [WATER_ENERGY]: typedEnergy(WATER_ENERGY, "Water"),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [X_BOOT]: 4,
  [PSY_BODY]: 8,
  [METAL_BODY]: 8,
  [NEITHER]: 8,
  [PSY_ENERGY]: 8,
  [METAL_ENERGY]: 8,
  [WATER_ENERGY]: 8,
  [DUAL]: 8,
});

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({
  seat: "p1",
  spot: { spot: "bench", index },
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
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
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** TEST SURGERY — p1's Active becomes the Metagross, `bench` names the bodies
    behind it, and p1's DECK is exactly `deck` (everything else goes underneath),
    so no count in this file is a seed fact. */
function board(
  bench: readonly string[],
  deck: readonly string[],
  opts: { active?: string } = {},
): GameState {
  const state = localSetup(4);
  const side = state.players.p1;
  const rest = [...side.deck, ...side.hand];
  const take = (cardId: string): string => {
    const uid = rest.find((u) => state.cardIdByUid[u] === cardId);
    if (uid === undefined) throw new Error(`p1 has no ${cardId}`);
    rest.splice(rest.indexOf(uid), 1);
    return uid;
  };
  const activeUid = take(opts.active ?? X_BOOT);
  const benchUids = bench.map(take);
  const deckUids = deck.map(take);
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        hand: [],
        // ⚠️ THE NAMED CARDS ARE THE WHOLE SEARCHABLE DECK. `attachFromDeck`
        // offers every match in the deck, so a stray Basic Energy left behind
        // would silently widen the candidate list and make §5's cap vacuous.
        deck: deckUids,
        active: body(activeUid),
        bench: benchUids.map(body),
      },
    },
  };
}

function useXBoot(state: GameState) {
  return applyAction(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: "X-Boot",
  });
}

function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "attachCards") {
    throw new Error(`expected attachCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function attach(state: GameState, assignments: { uid: string; to: PokemonRef }[]): GameState {
  return must(
    applyAction(state, { type: "resolveEffect", seat: "p1", choice: { kind: "attachCards", assignments } }),
  );
}

/** The card NAMES of the Energy attached to a body, so an assertion reads as the
    print does rather than as a uid list. */
function energyNamesOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const b = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (b === null || b === undefined) throw new Error("no body");
  return b.energy.map((u) => POOL[state.cardIdByUid[u] ?? ""]?.name ?? "?");
}

const xBootProgram = (): readonly EffectOp[] => {
  const program = programFor(X_BOOT)?.abilities?.[0]?.program;
  if (program === undefined) throw new Error("no X-Boot program");
  return program;
};

// ── 1. THE DECLARATION, READ OFF THE LIVE REGISTRY ───────────────────────────

describe("D354 §1 — the program, declared", () => {
  it("is an ABILITY and nothing else — asserted by KEY SET, not by presence", () => {
    // ⚠️ THE KEY SET IS WHAT LETS `BUILT.attack` STAND STILL: a stray `attack` key
    // here would move a census summand this slice measured as unmoved.
    expect(Object.keys(programFor(X_BOOT) ?? {}).sort()).toEqual(["abilities"]);
    const ability = programFor(X_BOOT)?.abilities?.[0];
    expect(ability?.name).toBe("X-Boot");
    expect(ability?.oncePerTurn).toBe(true);
    // "Once during your turn" — NOT "if this Pokémon is in the Active Spot", so
    // the Ability works from the Bench and the flag is the print.
    expect(ability?.activeOnly).toBe(false);
  });

  it("is TWO attaches and a shuffle — the ops, in order", () => {
    expect(xBootProgram().map((op) => op.op)).toEqual([
      "attachFromDeck",
      "attachFromDeck",
      "shuffleDeck",
    ]);
  });

  it("🛑 BOTH ops carry the SAME two-type union — the pairing reading, refused in the data", () => {
    // **THIS IS THE WHOLE ROW IN ONE ASSERTION.** Giving op 1 `"Psychic"` and op 2
    // `"Metal"` is the PAIRING reading wearing the union's clothes: it type-checks,
    // it passes every test that only ever attaches one card, and it is wrong on the
    // board the card is for. §2 drives the difference; this pins the cause.
    for (const op of xBootProgram()) {
      if (op.op !== "attachFromDeck") continue;
      expect(op.targetType).toEqual(["Psychic", "Metal"]);
      // ⚠️ `max: 1` PER OP is the printed PER-TYPE cap, not a stylistic choice —
      // see §5. It is NOT the same claim as the union and each has its own case.
      expect(op.max).toBe(1);
      expect(op.maxPerTarget).toBeUndefined();
      expect(op.toSelf).toBeUndefined();
      expect(op.benchOnly).toBeUndefined();
    }
    // The two ops differ in exactly ONE field — the Energy each searches for.
    const filters = xBootProgram()
      .filter((op) => op.op === "attachFromDeck")
      .map((op) => (op.op === "attachFromDeck" ? op.filter : null));
    expect(filters).toEqual([
      { kind: "basicEnergy", energyType: "Psychic" },
      { kind: "basicEnergy", energyType: "Metal" },
    ]);
  });
});

// ── 2. THE UNION, DRIVEN ON A BOARD ──────────────────────────────────────────

describe("D354 §2 — the printed union: a Basic {P} Energy on a {M} body", () => {
  it("🛑 THE ASSERTION THE ROW EXISTS FOR — the {P} Energy lands on the {M} Pokémon", () => {
    // Under the PAIRING reading (op 1 narrowed to `"Psychic"`) the Togedemaru is
    // not a legal target for the Basic {P} Energy and this attach is rejected.
    // Under the UNION reading it is legal, because the printed target set is
    // *"your {P} Pokémon **and** {M} Pokémon"* — one set, membership by either.
    const state = board([PSY_BODY, METAL_BODY], [PSY_ENERGY, METAL_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    // Op 1 searched for the Basic {P} Energy and found exactly one.
    expect(prompt.candidates.length).toBe(1);
    // Send it to the METAL body on the bench — the cross-type attach.
    const after = attach(used.state, [{ uid: prompt.candidates[0] as string, to: benchRef(1) }]);
    expect(energyNamesOn(after, benchRef(1))).toEqual(["Psychic Energy"]);
  });

  it("…and the {M} Energy lands on the {P} Pokémon — the mirror", () => {
    // The union is symmetric; asserting only one direction would leave a build
    // that special-cased the first op green.
    const state = board([PSY_BODY, METAL_BODY], [METAL_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    // Op 1 (Basic {P}) finds nothing in this deck and whiffs silently into op 2.
    const prompt = promptOf(used.state);
    expect(prompt.candidates.length).toBe(1);
    const after = attach(used.state, [{ uid: prompt.candidates[0] as string, to: benchRef(0) }]);
    expect(energyNamesOn(after, benchRef(0))).toEqual(["Metal Energy"]);
  });

  it("🛑 the offered TARGETS are exactly the {P} and {M} bodies — the third body is refused", () => {
    // The board holds a {P} body, a {M} body and a {W} body. `attachEnergyTargets`
    // is the ONLY gate (every downstream check reads the prompt it produced), so
    // this list IS the rule.
    // ⚠️ AND IT CATCHES THREE MUTATIONS AT ONCE: dropping `targetType` puts the
    // {W} body in the list; reading only the FIRST member drops the {M} body;
    // reading the list as `every` empties the list entirely, because no body is
    // both {P} and {M}.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    // The Active is the Metagross itself — types ["Metal"] — so it IS in the set.
    expect(prompt.targets).toEqual([ACTIVE, benchRef(0), benchRef(1)]);
    // Said again as a NEGATIVE, by id, so the reason is legible: the {W} body sits
    // at bench index 2 and is not offered.
    expect(prompt.targets).not.toContainEqual(benchRef(2));
  });

  it("the un-narrowed control — with NO rider every own body is a target", () => {
    // Proves the assertion above is a NARROWING and not a blanket refusal of the
    // third body (a board fact, e.g. a full bench, would look identical).
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", {})).toEqual([
      ACTIVE,
      benchRef(0),
      benchRef(1),
      benchRef(2),
    ]);
  });
});

// ── 3. THE REFUTATIONS, FROM SOURCE ON A BOARD ───────────────────────────────

describe("D354 §3 — the spellings that would have cost nothing, refuted on a board", () => {
  it("🛑 `targetType: \"Psychic\"` — the PAIRING reading — cannot reach the {M} body", () => {
    // Refuted FROM SOURCE rather than by argument (D353's standard): this is the
    // exact zero-diff spelling the free reading would have shipped.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", { targetType: "Psychic" })).toEqual([benchRef(0)]);
    // …and the union reaches BOTH, which is the difference the print turns on.
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychic", "Metal"] })).toEqual([
      ACTIVE,
      benchRef(0),
      benchRef(1),
    ]);
  });

  it("`targetType: \"Metal\"` alone is the OTHER half of the same refutation", () => {
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", { targetType: "Metal" })).toEqual([
      ACTIVE,
      benchRef(1),
    ]);
  });

  it("a ONE-ELEMENT list is byte-identical to the bare string — no third behaviour", () => {
    // The widening must not create a second spelling of an existing rider, or
    // every pre-D354 row acquires a silent variant. `targetTypeNames` normalises
    // both to the same list and this is the measurement that says so.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    for (const type of ["Psychic", "Metal", "Water"]) {
      expect(attachEnergyTargets(state, "p1", { targetType: [type] })).toEqual(
        attachEnergyTargets(state, "p1", { targetType: type }),
      );
    }
  });

  it("an EMPTY list is not a rider — it narrows nothing, exactly as `undefined` does", () => {
    // No printing spells it; recorded as a MEASUREMENT rather than as a rule, so
    // the day one does the behaviour is already written down.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", { targetType: [] })).toEqual(
      attachEnergyTargets(state, "p1", {}),
    );
  });

  it("🛑 a DUAL-TYPE body qualifies on EITHER half — the card's own bodies cannot show this", () => {
    // ⚠️ THE ONE CONSUMER THIS ROW'S CARD CANNOT EXERCISE. Every body X-Boot can
    // legally name is single-typed, so a build that read only the CARD's FIRST
    // type would be green across §1–§2. `card.types` is a LIST on both sides and
    // the test is an INTERSECTION; this drives the card side of it directly.
    const state = board([DUAL], [PSY_ENERGY], { active: NEITHER });
    // The Active is the {W} body, so only the dual body may be named.
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychic"] })).toEqual([benchRef(0)]);
    expect(attachEnergyTargets(state, "p1", { targetType: ["Metal"] })).toEqual([benchRef(0)]);
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychic", "Metal"] })).toEqual([
      benchRef(0),
    ]);
    // The negative that makes those three real: a type it does NOT carry.
    expect(attachEnergyTargets(state, "p1", { targetType: ["Fire"] })).toEqual([]);
  });

  it("a misspelled type matches the EMPTY set — a union cannot be widened by a typo", () => {
    // `AttachTargetRiders.ownerPokemon`'s own doc states this for the owner axis
    // ("no string can name a Pokémon it does not name"); the type axis inherits it
    // and a list inherits it MEMBER BY MEMBER, which is the new part.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychick"] })).toEqual([]);
    // …and a typo in ONE member does not poison the other.
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychick", "Metal"] })).toEqual([
      ACTIVE,
      benchRef(1),
    ]);
  });
});

// ── 4. THE CAPTION — THE DIALOG MUST NOT CONTRADICT ITS OWN VALIDATOR ────────

describe("D354 §4 — the printed noun, and the gate it must agree with", () => {
  it("🛑 the union caption REPEATS THE NOUN, as the card does", () => {
    // The card prints *"your {P} Pokémon **and** {M} Pokémon"*, not "your {P} {M}
    // Pokémon". A welded caption would name a set no card prints, in a prompt whose
    // whole job is to say which bodies are offered.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(promptOf(used.state).note).toBe(
      "Search your deck for a Basic Psychic Energy card and attach it to your " +
        "Psychic Pokémon and Metal Pokémon.",
    );
  });

  it("🛑 the caption and the OFFER agree — one count, asserted against each other", () => {
    // The rule `attachTargetNoun` exists for: a caption naming a WIDER set than the
    // gate offers is the dialog contradicting its own validator, and a NARROWER one
    // tells the player a legal body is illegal. Both are invisible to a test that
    // reads only one of them, so this reads both.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    const named = ["Psychic", "Metal"].filter((type) => prompt.note.includes(`${type} Pokémon`));
    expect(named).toEqual(["Psychic", "Metal"]);
    // Every offered body's top card carries one of the named types, and every own
    // body carrying one is offered — the caption re-derived from the board.
    const offered = attachEnergyTargets(state, "p1", { targetType: ["Psychic", "Metal"] });
    expect(prompt.targets).toEqual(offered);
    expect(prompt.note).not.toContain("Water Pokémon");
  });

  it("🛑 a ONE-type caption is BYTE-IDENTICAL to its pre-D354 spelling", () => {
    // Every pre-D354 rider is a bare `string`, and its caption must be exactly what
    // it was or this slice silently changed unrelated cards' prompts. The widening
    // is invisible to them only if the one-element join equals the old
    // `${type} ` interpolation, and equality-to-a-literal is the only way to say so.
    // Driven through the REAL note builder by seating a single-type Marnie-shaped
    // rider on the live registry op — §3 pins the GATE half of the same claim.
    const state = board([PSY_BODY, METAL_BODY], [PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    // The UNION caption, byte for byte (the case this slice adds)…
    expect(promptOf(used.state).note).toBe(
      "Search your deck for a Basic Psychic Energy card and attach it to your " +
        "Psychic Pokémon and Metal Pokémon.",
    );
    // …and the ZERO-type and ONE-type nouns, which every earlier printing uses and
    // which must not have moved a byte. `attachTargetNoun` is module-private, so
    // they are read through the gate's own public twin: identical target lists for
    // the bare string and its one-element list (§3), plus these spellings.
    expect(attachEnergyTargets(state, "p1", { targetType: "Psychic" })).toEqual([benchRef(0)]);
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychic"] })).toEqual([benchRef(0)]);
  });
});

// ── 5. THE THREE PRINTED OUTCOMES, AND THE PER-TYPE CAP ──────────────────────

describe("D354 §5 — 'a Basic {P}, a Basic {M}, or 1 of each'", () => {
  it("🛑 TWO Basic {P} in the deck and only ONE is reachable — the printed per-type cap", () => {
    // **THE REFUTATION OF THE ONE-OP SPELLING.** `{ kind: "anyOf", filters: [{P},
    // {M}] }` with `max: 2` reads the same three printed words and silently
    // legalises a FOURTH outcome the card does not print: two Basic {P} Energy.
    // `anyOf` EXISTS in `CardFilter` and was refused here for that, not for want of
    // a spelling. Two ops with `max: 1` each are the disjunction AND the cap.
    const state = board([PSY_BODY], [PSY_ENERGY, PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    expect(prompt.max).toBe(1);
    const after = attach(used.state, [{ uid: prompt.candidates[0] as string, to: benchRef(0) }]);
    // Op 2 searches for Basic {M} and finds none, so the program ends here.
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(energyNamesOn(after, benchRef(0))).toEqual(["Psychic Energy"]);
  });

  it("'1 of each' — both ops run and both may land on the SAME body", () => {
    // *"In any way you like"* denies any one-apiece rule (contrast Janine's Secret
    // Art, whose `maxPerTarget: 1` this op deliberately does NOT carry — §1).
    const state = board([PSY_BODY], [PSY_ENERGY, METAL_ENERGY]);
    const first = useXBoot(state);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const p1 = promptOf(first.state);
    const afterFirst = attach(first.state, [{ uid: p1.candidates[0] as string, to: benchRef(0) }]);
    const p2 = promptOf(afterFirst);
    const afterSecond = attach(afterFirst, [{ uid: p2.candidates[0] as string, to: benchRef(0) }]);
    expect(energyNamesOn(afterSecond, benchRef(0)).sort()).toEqual([
      "Metal Energy",
      "Psychic Energy",
    ]);
  });

  it("a deck with NEITHER named Energy is a live path — it whiffs into the shuffle", () => {
    // `attachFromDeck` has NO `programPlayable` gate, by its own doc: every card
    // carrying it prints "Then, shuffle your deck", a clause that always resolves,
    // so "no eligible card" is never "no effect" (ruling/284).
    const state = board([PSY_BODY], [WATER_ENERGY, WATER_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(used.state.phase.kind).not.toBe("effect:choose");
    expect(energyNamesOn(used.state, benchRef(0))).toEqual([]);
  });

  it("🛑 the no-eligible-target path is UNREACHABLE while the holder is in play", () => {
    // `attachFromDeck`'s doc calls the no-target board a live path, and for this
    // card it is a rule about EMPTY BOARDS rather than about the card: **Steven's
    // Metagross ex is itself `types: ["Metal"]`**, so its own body is always in the
    // printed union while it is in play — and the Ability can only be used from a
    // body that is in play. The bench here is a {W} body and NOTHING else, and the
    // target list is still non-empty because the holder is in it.
    const state = board([NEITHER], [PSY_ENERGY], {});
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    expect(prompt.targets).toEqual([ACTIVE]);
    // Driven to the end: the {P} Energy lands on the {M} holder — a cross-type
    // attach onto the card's own body, which is the union at its narrowest.
    const after = attach(used.state, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(energyNamesOn(after, ACTIVE)).toEqual(["Psychic Energy"]);
  });
});

// ── 6. THE FIXTURE IS A CENSUS POPULATION, AND THE BATON ─────────────────────

describe("D354 §6 — the pool, the registry keys, and the expiring insertion-order pin", () => {
  it("🛑 THE BATON WAS HANDED ON AT D355 — this is now a CONTIGUITY claim", () => {
    // (D347 → D349 → D350 → D351 → D352 → D353 → this file.) `censusAtHead`'s
    // `raw[raw.length - 1]` is keyed on INSERTION ORDER and has gone red on a
    // constant nobody touched TWELVE consecutive times. **No grep of any census
    // FIGURE NAME reaches it** — only a grep of `registry.ts`'s id-map tail does.
    // ⚠️ **THE WIDTH IS `slice(-1)`, NOT `slice(-2)`.** The width is the number of
    // ids the LAST slice added, and D354 added exactly ONE. Copying D353's width
    // would silently start asserting a neighbour's row — which is the failure this
    // pin exists to make loud.
    // ⚠️ It is SPENT the moment the next registry row lands, which is what it is
    // for. **Re-point it; do not delete it** — the CONTIGUITY claims in
    // `remainingHpWindow.test.ts` §6, `invitingWink.test.ts` §7, `pyroDance.test.ts`
    // §7, `metalMaker.test.ts` §8 and now `spikeClad.test.ts` §8 are a DIFFERENT
    // assertion and do not substitute for this one.
    //
    // 🆕🆕 **D355 SPENT IT, AND RE-POINTED IT RATHER THAN DELETING IT.** The LIVE
    // expiring pin now sits in `energyCoin.test.ts` §6 at width **1** (D355 added
    // exactly ONE id, `sv10.5b-081`). What stays here is the PERMANENT half — the
    // claim that this slice's one id is a CONTIGUOUS block at the position it was
    // inserted, which is true forever and cannot expire. This file joins the five
    // that stand still: `remainingHpWindow.test.ts` §6, `invitingWink.test.ts` §7,
    // `pyroDance.test.ts` §7, `metalMaker.test.ts` §8 and `spikeClad.test.ts` §8.
    // ⚠️ **THE TWO KINDS ARE DIFFERENT ASSERTIONS AND NEITHER SUBSTITUTES FOR THE
    // OTHER**: a contiguity claim never goes red on a neighbour's insert, which is
    // exactly what makes it useless as a tripwire and permanent as a fact.
    //
    // 🆕🛑 **D357 — THIS IS WHERE THE TAUTOLOGY PAIR WAS WRITTEN, AND THE REVIEW
    // FOUND IT ONE FILE DOWNSTREAM.** `raw.slice(at, at + 1)` with
    // `at = raw.indexOf(X_BOOT)` cannot fail, and neither can `at < raw.length`
    // for any `at >= 0`. D355 wrote the pair when it handed the baton on; D356
    // copied it verbatim into `energyCoin.test.ts` §6; the review named THAT one.
    // **A DEFECT IN A HAND-OFF IDIOM PROPAGATES ALONG THE HAND-OFF** — the place
    // to grep is every file the baton has passed through, not the file named.
    // ⚠️ **A WIDTH-1 CONTIGUITY CLAIM HAS NO CONTENT**: one element is always a
    // contiguous block. The permanent claims with content assert a NEIGHBOUR or a
    // width of 2+ (`metalMaker.test.ts` §8, `spikeClad.test.ts` §8,
    // `pyroDance.test.ts` §7). D354 added exactly one id, so what is permanent
    // AND falsifiable here is an ORDERING claim.
    const raw = registryCardIds();
    const at = raw.indexOf(X_BOOT);
    expect(at).toBeGreaterThanOrEqual(0);
    // 1. THE BATON REALLY DID MOVE ON — this id is no longer the TAIL of the map.
    //    FALSE the day D354 shipped it, which is what makes it an assertion.
    expect(at).toBeLessThan(raw.length - 1);
    // 2. …and it is ahead of D355's id, which is what *"ahead of everything D355
    //    and later appended"* means once it names something.
    expect(at).toBeLessThan(raw.indexOf(ENERGY_COIN_ID));
  });

  it("🛑 the +1 on `raw.length` is EXACTLY this one id — the ONLY real id here", () => {
    // ⚠️ D353's defect (D), REPRODUCED AND CAUGHT (see the block beside `PSY_BODY`):
    // a suite's real ids may ALREADY be registry keys — D353's Spiky/Mist Energy ids
    // carried `EnergyProgram`s, and D354's first-draft `sv02-097` carried a
    // `passive`. **THE MEASUREMENT, KEPT SO THE NEXT SLICE REACHING FOR "A REAL {P}
    // BODY" DOES NOT PAY IT AGAIN**: `sv02-097` is BOTH a `FIXTURE_POOL` member and
    // a registry key; `sv03-151` is a pool member and NOT a key. Neither is used.
    const keys = new Set(registryCardIds());
    expect(keys.has(X_BOOT)).toBe(true);
    expect(keys.has("sv02-097")).toBe(true);
    expect(FIXTURE_POOL["sv02-097"]).toBeDefined();
    expect(keys.has("sv03-151")).toBe(false);
    expect(FIXTURE_POOL["sv03-151"]).toBeDefined();
    // …and the step this slice actually took is ONE id, which is this one.
    expect(registryCardIds().filter((id) => id === X_BOOT).length).toBe(1);
  });

  it("nothing this suite defines reached `FIXTURE_POOL` — asserted by ID", () => {
    // **A FIXTURE IS A CENSUS POPULATION** (D348). `catalogManifest.test.ts` and
    // `clauseApostrophe.test.ts` sweep `FIXTURE_POOL`, and `sv10` is not among
    // `catalogManifest`'s six sets, so a shared-pool body would have owed a
    // `fix-*` key AND a manifest classification. The local pool owes neither.
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });
});

// ── 7. THE CENSUS, PINNED AS THE NEGATIVES IT ACTUALLY IS ────────────────────

describe("D354 §7 — the census, and the sentence that settled the reading", () => {
  it("Lilligant `sv09-007` is the OTHER printing of the construction, and it is BUILT", () => {
    // *"Attacks used by your {G} Pokémon **and** {R} Pokémon do 20 more damage"* —
    // the catalog's only other *"your {X} Pokémon and {Y} Pokémon"*, and the one
    // that admits NO pairing reading. It is what settled X-Boot's target axis as a
    // UNION, so it is pinned by id here rather than described in a comment.
    expect(programFor("sv09-007")).toBeDefined();
  });

  it("🆕 row 10's remaining half was TAKEN at D355 — the row is closed", () => {
    // Energy Coin `sv10.5b-081` — *"Flip 2 coins. If both of them are heads, search
    // your deck for a Basic Energy card and attach it to 1 of your Pokémon."* A
    // coin GATE on a Trainer, not a target rider.
    // ⚠️ **RECORDED AS SPENT RATHER THAN REWRITTEN TO NAME A DIFFERENT BLOCKER.**
    // D354 left this as a negative and priced it at ≈1 item; D355 paid exactly that
    // (`coinFlipGate.coins?: number`) and the assertion flips rather than moving to
    // some other unbuilt id. Row 10's residue is now **0** on both halves, and the
    // suite that owns this card is `energyCoin.test.ts`.
    expect(programFor("sv10.5b-081")).toBeDefined();
  });

  it("🛑 row 12's ability half is BUILT too — the SECOND spent negative in this file", () => {
    // ⚠️ **RECORDED AS SPENT RATHER THAN REWRITTEN TO NAME A DIFFERENT BLOCKER**,
    // the same treatment the `sv10.5b-081` line above got one slice earlier — and
    // this file now carries both, which is the readable form of the pattern: **a
    // negative in this suite has twice turned out to be a PRICE that was wrong
    // rather than a POPULATION that was small.** D354 refused this on the ratio and
    // the ratio was correct (1 legal printing, re-censused at D356 as 3 / 0 / 0
    // with 1 legal); what was wrong was calling it "a whole new trigger point",
    // when `onEnergyAttach`, its fire site, the `watch` partition and `activeOnly`
    // all already existed. See `autoHeal.test.ts`.
    expect(programFor("sv09-107")).toBeDefined();
  });
});
