import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf, typedEnergy } from "./testFixtures";

// ── D351 — *"A BASIC {R} ENERGY CARD, A BASIC {F} ENERGY CARD, **OR 1 OF EACH**"*:
//    A PRINTED DISJUNCTION THAT IS TWO OPS, AND THE GATE THAT COULD NOT SEE IT. ──
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   Infernape `svp-116` / `sv06-033` / `sv06-173` — "Pyro Dance"
//   (`abilities_json`): "Once during your turn, you may attach a Basic {R} Energy
//   card, a Basic {F} Energy card, or 1 of each from your hand to your Pokémon in
//   any way you like."
//   **3 legal printings on ONE byte-identical sentence** — the whole population,
//   remote D1 `luminous` 2026-08-15, `json_each(abilities_json)` keyed on
//   `$.effect` (NOT `$.text` — the false-zero key) and grouped so the unit is a
//   SENTENCE. The extractor was verified against a known-present row BEFORE any
//   zero in this block was believed.
//
// ── HOW THE ROW WAS FOUND ───────────────────────────────────────────────────
//   (1) LARGEST LIVE `ROWS` RESIDUE, **PARSED OUT OF THE ARRAY** rather than read
//       off a handoff figure (a brace-depth scan of `censusAtHead.test.ts`, which
//       is the only way to be sure a comment has not rotted): 8 rows, 10
//       `abilityIds` + 6 `effectIds`. Row 9 = **7**, row 12 = **4**, row 11 = 3,
//       row 10 = 2, rows 0/13/15/16 = 0.
//   (2) Row 9 is the largest and D349 AND D350 both declined it with reasons.
//       **ROW 12 HAD NEVER BEEN CENSUSED AT ALL** — an uncensused row is the one
//       place a genuinely new opportunity can still hide, so that is where the
//       method went.
//   (3) CENSUS THE CLAUSE, NOT THE CARD, over all three text columns.
//       `instr(<col>,'or 1 of each')`:
//         effect          0 printings / 0 legal / 0 sentences
//         abilities_json  4 printings / 4 legal / **2 sentences**
//         attacks_json    0 printings / 0 legal / 0 sentences
//       🛑 **THE FOUR SPAN TWO BACKLOG ROWS**: Infernape ×3 (row 12) and Steven's
//       Metagross ex `sv10-145` "X-Boot" (row **10**). A clause the table files
//       under two different rows is one clause, and only the census says so.
//   (4) IS THE ROW-12 MEMBER THE CHEAPEST THING THAT CLAUSE BUYS? **YES, and the
//       margin is a single word.** X-Boot prints *"attach them to your {P} Pokémon
//       **and** {M} Pokémon"* — a disjunction on the TARGET axis, where
//       `AttachTargetRiders.targetType` is a single `string`, so it wants a union
//       for 1 printing. Pyro Dance prints the bare *"to your Pokémon"* — **no
//       rider at all** — so it wants none, for 3.
//   (5) AND GREP IT. `programFor("svp-116")` was `undefined` at `218107b`; every
//       other hit in the tree was prose, and §2 pins the negative for `sv10-145`.
//
// ── 🛑🛑 THE FINDING: A RESIDUE NOTE THAT NAMED THE WRONG *ROAD* ────────────
// Row 12's own cell has said since D250, in `censusAtHead.test.ts` and in
// `coverage-backlog-legal.md` alike, that this sentence needs
//
//   "a disjunction over energy TYPES `attachFromHand.filter` has no spelling for,
//    plus a cap D247's op deliberately has none of"
//
// — i.e. a FILTER shape and a CAP on `attachFromHand`. Read against the print,
// both halves dissolve at once. *"In any way you like"* means each card names its
// OWN destination, which is `ASSEMBLE_ALLOY`'s reading since D263: **N independent
// `attachEnergyFrom` ops**, never one batch pinned to one body. Two such ops, with
// two `energyType`s, ARE the disjunction and ARE the cap: the {R} half runs against
// the {R} in hand and the {F} half against the {F}, each attaching ONE card because
// `count` is absent. `attachFromHand` was never the road; its own doc says it is
// deliberately unbounded, so under it a hand of four Basic {R} attaches four.
//
// **A CELL CAN BE RIGHT ABOUT THE OBSTACLE AND WRONG ABOUT THE ROAD** — D249's
// finding, met for the second time on this same row, and the third time on this
// page after D345/D346's Magneton. The obstacle was real; it was just somewhere
// else entirely, and no amount of re-reading the cell would have found it.
//
// ── 🛑🛑 THE SECOND FINDING, AND IT IS A PROSE CLAIM THAT WAS NEVER DRIVEN ──
// `ASSEMBLE_ALLOY`'s doc has said since D263, for this exact grammar, that "the
// attach itself PARKS and **a park is declinable by construction**, so nothing is
// forced on the controller". **THAT HALF IS FALSE, AND §5 DRIVES IT.**
// `parkOrForce` has three arms and none of them is a decline: zero candidates is a
// silent no-op, ONE candidate is FORCED (the M1 no-choice rule), and two or more
// park a `choosePokemon` whose only legal answer is `{ kind: "pokemon", ref }` —
// `EffectPrompt` has no optional/`min: 0` member and `resolveEffect` refuses
// anything else with `BAD_EFFECT_CHOICE`. ⚠️ **AND THE OTHER THREE ATTACH OPS ARE
// NOT LIKE THIS** — `attachFromTop`/`attachFromDeck`/`attachFromHand` all produce
// the COMPOUND `attachCards` park, whose own doc says "an empty list is a legal
// decline". Declinability is a property of the PROMPT KIND, not of parking, and
// this op is the one attach route that takes the kind without it. So a controller
// who uses this Ability
// holding one {R} and one {F} attaches BOTH, where the print offers three outcomes
// and lets them take one.
//
// It is shipped that way anyway, and 🆕🆕 **D358 CHANGED THE REASON FROM A PRICE
// TO A RULE.** The declinable park was BOUGHT at D358 (`attachEnergyFrom.declinable`,
// a widened `choosePokemon` prompt, an optional `EffectChoice.pokemon.ref`, a wire
// field, a `validateChoice` arm and a `parkOrForce` flag) — and it was deliberately
// NOT applied to this card.
//
// 🛑 **`ptcg-rules.md` §9.1 IS WHY.** Archaludon ex and Magneton print *"up to N"*,
// which §9.1 says makes every count from 0 to N legal. **THIS CARD PRINTS NO SUCH
// THING.** *"a Basic {R} Energy card, a Basic {F} Energy card, **or 1 of each**"* is
// a DISJUNCTION with three arms and no empty one, and §9.1 also settles the *"you
// may"*: on an ACTIVATED Ability it *"is spent by choosing to use the Ability at
// all, so it adds nothing to the choice that follows"*. So the printed answer set
// here is exactly {R}, {F}, {R,F} — and two independent declinable parks would also
// reach the EMPTY answer, which this sentence does not offer. **Flagging these two
// ops would legalise something unprinted**, which is the one thing a new prompt
// member must never do.
//
// What this card actually owes is *"at least one of the two"*, a coupling BETWEEN
// two ops that no prompt can express — cross-op state (an `EffectRecord` gate, §9.2
// machinery). Refused at D358 ON PRICE, with the rules half settled; 3 legal
// printings. §5 below still pins the behaviour, and `attachDecline.test.ts` §5
// pins the REFUSAL by id so a slice that flags these ops has to come here and
// say why.
//
// ── THE ENGINE DIFF, AND WHY IT IS NOT ZERO ─────────────────────────────────
// The no-new-vocabulary refutation was RUN FROM SOURCE and four spellings were
// tried before one was paid for:
//   (a) two `attachEnergyFrom` ops and NOTHING ELSE — refuted: `programPlayable`
//       is a `for (const op of program)` loop that `return false`s on the first op
//       that could whiff, so a hand holding a Basic {F} and no Basic {R} greys out
//       an Ability the print names as one of its three outcomes;
//   (b) `attachFromHand { filter: anyOf([...]) }` — refuted on the op's own doc:
//       no `max`, by design, so it attaches every matching card in hand;
//   (c) one `attachEnergyFrom` with `count: 2` — refuted on D205: `count` pins the
//       batch to ONE body, which is what *"in any way you like"* denies;
//   (d) each attach wrapped in `{ op: "optional" }` — it WOULD build (this
//       function does not descend into `optional`), and it is refused anyway: the
//       `note` must be the byte-identical printed sentence (D202) and there is one
//       sentence for two ops, so both captions would be invented; and it would
//       make the Ability usable on an EMPTY HAND (D222's afford-then-reject).
//
// So ONE item is paid for, and it is a live correctness FIX rather than a feature:
// `programPlayable`'s attach gate became PROGRAM-scoped
// (`attachAlternativesAllWhiff`). ZERO new ops, ZERO new op FIELDS, ZERO new
// `CardFilter` members, ZERO prompt kinds, ZERO choice kinds, ZERO events, ZERO
// error codes, ZERO `GameState` fields, ZERO wire-schema bytes, ZERO regexes, ZERO
// deriver arms, ZERO `EffectSlot` members. `MATCH_RECORD_VERSION` STAYS 20.
//
// 🛑 **AND THE DEFECT WAS UNREACHABLE FROM A PRINTED ROW UNTIL THIS ONE**, which
// is D345's `damageChosen` finding at its second instance, one op over. Every
// multi-op `attachEnergyFrom` producer that shipped before this is HOMOGENEOUS —
// Koraidon "Dino Cry" is the same Energy out of the same zone twice, so its two
// gates cannot disagree — and Archaludon's `ASSEMBLE_ALLOY`, the other two-op row,
// is an `onEvolve` TRIGGER, and triggers never reach this function at all. §3
// drives BOTH of those as controls, so the claim is a measurement.

const INFERNAPE = "sv06-033";
const INFERNAPE_IDS = ["svp-116", "sv06-033", "sv06-173"] as const;
const X_BOOT = "sv10-145";
const KORAIDON = "sv01-125";
const ARCHALUDON = "sv08-130";

const PYRO_TEXT =
  "Once during your turn, you may attach a Basic {R} Energy card, a Basic {F} " +
  "Energy card, or 1 of each from your hand to your Pokémon in any way you like.";

const FIRE = "d351-fire-energy";
const FIGHTING = "d351-fighting-energy";
const WATER = "d351-water-energy";
const BUDDY = "d351-buddy";
const FIGHTER = "d351-fighter";

/** Real ids on a LOCAL `cardPool` (D275's idiom). ⚠️ **A FIXTURE IS A CENSUS
    POPULATION** (D348) — nothing here goes near `FIXTURE_POOL`, and §7 asserts
    that by id rather than describing it. */
const LOCAL_CARDS: Record<string, Card> = Object.fromEntries(
  INFERNAPE_IDS.map((id) => [
    id,
    battler(id, {
      name: "Infernape",
      stage: "Stage2",
      evolveFrom: "Monferno",
      hp: 160,
      retreat: 2,
      types: ["Fire"],
      abilities: [{ type: "Ability", name: "Pyro Dance", effect: PYRO_TEXT }],
    }),
  ]),
);
LOCAL_CARDS[BUDDY] = battler(BUDDY, { name: "D351 Buddy", hp: 70 });
LOCAL_CARDS[FIGHTER] = battler(FIGHTER, { name: "D351 Fighter", hp: 70, types: ["Fighting"] });
LOCAL_CARDS[FIRE] = typedEnergy(FIRE, "Fire");
LOCAL_CARDS[FIGHTING] = typedEnergy(FIGHTING, "Fighting");
LOCAL_CARDS[WATER] = typedEnergy(WATER, "Water");

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [INFERNAPE]: 4,
  [INFERNAPE_IDS[0]]: 2,
  [INFERNAPE_IDS[2]]: 2,
  [BUDDY]: 16,
  [FIGHTER]: 4,
  [FIRE]: 12,
  [FIGHTING]: 12,
  [WATER]: 8,
});

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const BENCH_REF: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
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

/** TEST SURGERY — p1's Active becomes an Infernape, one Buddy sits on the Bench
    (so the attach has TWO candidates and the park is a real question), and p1's
    hand is exactly the Energy named. Everything else goes back under the deck, so
    no count in this file is a seed fact. */
function board(
  hand: readonly string[],
  opts: { id?: string; bench?: string; discard?: readonly string[] } = {},
): GameState {
  const id = opts.id ?? INFERNAPE;
  const state = localSetup(4);
  const side = state.players.p1;
  const pool = [...side.deck, ...side.hand];
  const take = (cardId: string, from: string[]): string => {
    const uid = from.find((u) => state.cardIdByUid[u] === cardId);
    if (uid === undefined) throw new Error(`p1 has no ${cardId}`);
    from.splice(from.indexOf(uid), 1);
    return uid;
  };
  const rest = [...pool];
  const activeUid = take(id, rest);
  const benchUid = take(opts.bench ?? BUDDY, rest);
  const handUids = hand.map((cardId) => take(cardId, rest));
  const discardUids = (opts.discard ?? []).map((cardId) => take(cardId, rest));
  const returned = side.active === null ? [] : side.active.stack;
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        hand: handUids,
        discard: [...side.discard, ...discardUids],
        deck: [...rest, ...returned, ...side.bench.flatMap((b) => b.stack)],
        active: body(activeUid),
        bench: [body(benchUid)],
      },
    },
  };
}

function usePyro(state: GameState): { state: GameState; events: GameEvent[] } {
  const first = apply(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: "Pyro Dance",
  });
  return { state: first.state, events: [...first.events] };
}

function resolve(state: GameState, ref: PokemonRef): { state: GameState; events: GameEvent[] } {
  const res = apply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
  return { state: res.state, events: [...res.events] };
}

function attachedTypes(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (body === null || body === undefined) throw new Error("no body");
  return body.energy.map((u) => POOL[state.cardIdByUid[u] ?? ""]?.name ?? "?");
}

const pyroProgram = (): readonly EffectOp[] => {
  const program = programFor(INFERNAPE)?.abilities?.[0]?.program;
  if (program === undefined) throw new Error("Pyro Dance has no program");
  return program;
};

describe("D351 §1 — the registry row is TWO ops, and the shape is the print", () => {
  it("all three printings share ONE program object", () => {
    const object = programFor(INFERNAPE_IDS[0]);
    expect(object).toBeDefined();
    for (const id of INFERNAPE_IDS) expect(programFor(id)).toBe(object);
  });

  it("the program is exactly two attachEnergyFrom ops, {R} then {F}, from the HAND", () => {
    expect(pyroProgram()).toEqual([
      { op: "attachEnergyFrom", source: "hand", energyType: "Fire" },
      { op: "attachEnergyFrom", source: "hand", energyType: "Fighting" },
    ]);
  });

  it("…and it carries NO cap, NO target rider and NO `anyEnergy` — asserted by KEY SET", () => {
    // 🛑 A `toEqual` above already pins the whole object, but the ABSENCES are the
    // design and a key-set assertion is what makes them legible as such. `count`
    // would pin the batch to one body (D205) and deny "in any way you like";
    // `targetType`/`benchOnly`/`ownerPokemon` would narrow a target the print
    // leaves bare; `anyEnergy` would make the printed word "Basic" false.
    for (const op of pyroProgram()) {
      expect(Object.keys(op).sort()).toEqual(["energyType", "op", "source"]);
    }
  });

  it("the registry entry carries NO `attack` key — the `BUILT.attack` summand cannot move", () => {
    // ⚠️ THE THREE SUMMANDS OF `BUILT.attack` ARE READER-KEYED AND THIS SLICE IS
    // REGISTRY-KEYED, WHICH ARE DIFFERENT THINGS CALLED `raw` (D350's headline
    // defect). The registry half of that figure is asserted here by KEY SET; the
    // reader half is a three-column census, and §2 pins its zeroes.
    for (const id of INFERNAPE_IDS) {
      expect(Object.keys(programFor(id) ?? {}).sort()).toEqual(["abilities"]);
    }
  });

  it("the sentence is an ABILITY, so no attack reader can see it", () => {
    expect(deriveAttackEffect(PYRO_TEXT)).toBeNull();
  });
});

describe("D351 §2 — the census, pinned as the negatives it actually is", () => {
  it("🆕 THE OTHER PRINTING OF THE SAME CLAUSE IS NOW BUILT — the refusal is SPENT", () => {
    // 🆕🆕 **D354 BOUGHT IT, AND THIS CELL IS RECORDED SPENT RATHER THAN REWRITTEN
    // TO NAME A DIFFERENT BLOCKER.** The refusal D351 wrote here was, verbatim:
    //   "It is REFUSED here on one printed word: *"attach them to your {P} Pokémon
    //    **and** {M} Pokémon"* is a disjunction on the TARGET axis, and
    //    `AttachTargetRiders.targetType` is a single `string`."
    // **EVERY WORD OF THAT WAS TRUE AND IT WAS STILL THE WRONG VERDICT** — not
    // because the obstacle was misread (D351 read it exactly right), but because
    // nobody had asked which of TWO readings the card prints. Under the PAIRING
    // reading the row is FREE: two ops, two single-string `targetType`s, no engine
    // diff at all. D354 settled it from the print — the *"attach them to `<NOUN>`
    // in any way you like"* template is 31 printings whose noun slot holds exactly
    // ONE set description every time and which has NO pairing form anywhere in the
    // catalog — and paid for the union: `targetType` widened to
    // `string | readonly string[]`, ONE key, two readers.
    // ⚠️ **SO THE PRICE THIS CELL QUOTED WAS REAL AND THE READING BEHIND IT WAS
    // NEVER CHECKED.** A refusal that names a true obstacle can still be answering
    // a question the card does not ask (D353's finding, one row over).
    expect(programFor(X_BOOT)).toBeDefined();
  });

  it("🛑 row 12's fourth id is BUILT — this negative is SPENT, and row 12 is CLOSED", () => {
    // ⚠️ **RECORDED AS SPENT RATHER THAN REWRITTEN TO NAME A DIFFERENT BLOCKER.**
    // This read `toBeUndefined()` on the ground that *"`triggers.ts` has no such
    // trigger point"*. It had one: `onEnergyAttach` has been a `TriggerTiming`
    // since D319 and only its OPPONENT direction was populated. D356 populated the
    // self direction. Row 12's ability half goes 1 → **0** and the row is closed.
    // ⚠️ Note the quote this line carried, like every other quote of this card in
    // the repo, DROPPED the sentence's opening clause — *"As long as this Pokémon
    // is in the Active Spot,"*, which is `activeOnly` and is part of why the price
    // read high. See `autoHeal.test.ts`.
    expect(programFor("sv09-107")).toBeDefined();
  });
});

describe("D351 §3 — the gate: the defect, and the two controls that hid it", () => {
  it("🛑 A HAND WITH ONLY THE SECOND TYPE IS PLAYABLE — the defect, driven", () => {
    // THE WHOLE ROW IN ONE ASSERTION. Under the pre-D351 per-op AND this returned
    // FALSE: the first op ({R}) found nothing in hand and vetoed the card, though
    // the print names "a Basic {F} Energy card" as one of its three outcomes.
    const state = board([FIGHTING]);
    expect(programPlayable(state, pyroProgram(), "p1")).toBe(true);
  });

  it("…and so is a hand with only the FIRST type — the mirror", () => {
    const state = board([FIRE]);
    expect(programPlayable(state, pyroProgram(), "p1")).toBe(true);
  });

  it("…and so is a hand with both", () => {
    expect(programPlayable(board([FIRE, FIGHTING]), pyroProgram(), "p1")).toBe(true);
  });

  it("🛑 …but a hand with NEITHER is REFUSED — the relaxation is not a removal", () => {
    // The `or` still refuses when EVERY alternative whiffs, which is ruling/284 at
    // the unit the ruling names. Without this case the change would be
    // indistinguishable from deleting the gate.
    expect(programPlayable(board([WATER, WATER]), pyroProgram(), "p1")).toBe(false);
    expect(programPlayable(board([]), pyroProgram(), "p1")).toBe(false);
  });

  it("CONTROL — the HOMOGENEOUS two-op producer is unmoved (Koraidon 'Dino Cry')", () => {
    // ⚠️ THIS IS WHY THE DEFECT SURVIVED SINCE M5, AND IT IS THE CLAIM THAT MAKES
    // THE RELAXATION SAFE. Koraidon `sv01-125` is the only other ABILITY in the
    // registry with two `attachEnergyFrom` ops, and its two ops are BYTE-IDENTICAL
    // — same type, same zone, same riders — so "this op whiffs" and "every op
    // whiffs" are the same question on every board that exists. Asserted as
    // identity rather than described, then driven on both faces.
    const koraidon = programFor(KORAIDON)?.abilities?.[0]?.program;
    if (koraidon === undefined) throw new Error("Dino Cry has no program");
    const attaches = koraidon.filter((op) => op.op === "attachEnergyFrom");
    expect(attaches).toHaveLength(2);
    expect(attaches[0]).toEqual(attaches[1]);
    // A {F} body on the Bench and Basic {F} Energy in the discard → playable.
    expect(
      programPlayable(board([], { bench: FIGHTER, discard: [FIGHTING] }), koraidon, "p1"),
    ).toBe(true);
    // The same board with the pile empty → refused, exactly as before D351.
    expect(programPlayable(board([], { bench: FIGHTER }), koraidon, "p1")).toBe(false);
    // …and with the pile stocked but NO {F} body in play → refused on the target
    // rider, which is the gate's OTHER conjunct surviving the move out of the loop.
    expect(programPlayable(board([], { discard: [FIGHTING] }), koraidon, "p1")).toBe(false);
  });

  it("CONTROL — the other two-op row is a TRIGGER and never reaches this gate", () => {
    // Archaludon ex `sv08-130` "Assemble Alloy" (D263) is the shape this registry
    // row quotes, but it hangs off `triggered`, not `abilities` — and
    // `programPlayable` is only ever asked of a Trainer play or an Ability use.
    const program = programFor(ARCHALUDON);
    expect(Object.keys(program ?? {}).sort()).toEqual(["triggered"]);
    expect(program?.triggered?.[0]?.program).toHaveLength(2);
  });

  it("CONTROL — a single-op attach program is bit-for-bit unchanged by the relaxation", () => {
    // With ONE attach, "every alternative whiffs" is "this op whiffs", so every
    // producer that shipped before this row answers exactly as it did. Teal Dance
    // (`attachEnergyFrom` + `recordGate`) is the busiest of them.
    const teal = programFor("sv06-025")?.abilities?.[0]?.program;
    if (teal === undefined) throw new Error("Teal Dance has no program");
    expect(teal.filter((op) => op.op === "attachEnergyFrom")).toHaveLength(1);
    expect(programPlayable(board([]), teal, "p1")).toBe(false);
  });

  it("CONTROL — a program with NO attach at all is untouched (the arity guard)", () => {
    // `.every` on an empty list is `true`, so without the `length === 0` guard this
    // predicate would refuse every program in the registry. Driven, not reasoned.
    expect(programPlayable(board([]), [{ op: "drawCards", count: 1 }], "p1")).toBe(true);
  });
});

describe("D351 §4 — the three printed outcomes, driven end to end", () => {
  it("one of each: two parks, two bodies, one {R} and one {F}", () => {
    // *"In any way you like"* is N INDEPENDENT decisions landing on N different
    // bodies (D263), and this is the case that says so: the {R} goes to the Active
    // and the {F} to the Bench, which a `count: 2` batch could never do.
    let state = board([FIRE, FIGHTING]);
    const used = usePyro(state);
    expect(used.state.phase.kind).toBe("effect:choose");
    const first = resolve(used.state, ACTIVE_REF);
    expect(first.state.phase.kind).toBe("effect:choose");
    const second = resolve(first.state, BENCH_REF);
    state = second.state;
    expect(state.phase.kind).toBe("turn:action");
    expect(attachedTypes(state, ACTIVE_REF)).toEqual(["Fire Energy"]);
    expect(attachedTypes(state, BENCH_REF)).toEqual(["Fighting Energy"]);
    expect(state.players.p1.hand).toHaveLength(0);
  });

  it("one of each, BOTH onto the same body — the other end of 'any way you like'", () => {
    let state = board([FIRE, FIGHTING]);
    state = resolve(resolve(usePyro(state).state, ACTIVE_REF).state, ACTIVE_REF).state;
    expect(attachedTypes(state, ACTIVE_REF)).toEqual(["Fire Energy", "Fighting Energy"]);
  });

  it("{F} alone: ONE park, and the {R} half is a silent no-op", () => {
    // 🛑 THE BOARD THE OLD GATE REFUSED. The first op finds no Basic {R} and
    // returns `{ done: state }` without asking anything; the second parks.
    let state = board([FIGHTING]);
    const used = usePyro(state);
    expect(used.state.phase.kind).toBe("effect:choose");
    state = resolve(used.state, BENCH_REF).state;
    expect(state.phase.kind).toBe("turn:action");
    expect(attachedTypes(state, BENCH_REF)).toEqual(["Fighting Energy"]);
    expect(attachedTypes(state, ACTIVE_REF)).toEqual([]);
  });

  it("{R} alone: the mirror, and it lands on the Active", () => {
    let state = board([FIRE]);
    state = resolve(usePyro(state).state, ACTIVE_REF).state;
    expect(attachedTypes(state, ACTIVE_REF)).toEqual(["Fire Energy"]);
  });

  it("the printed 'Basic' holds — a hand of Special-less {W} attaches nothing", () => {
    // `anyEnergy` is absent, so only Basic Energy of the named type is reachable;
    // a Water Basic matches neither op. The Ability is refused rather than used
    // for nothing, which is the gate's REMAINING half working.
    const state = board([WATER]);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Pyro Dance",
    });
    expect(result.ok).toBe(false);
  });

  it("more than one {R} in hand attaches exactly ONE — the printed article", () => {
    // The cap that the row's cell said `attachFromHand` was missing. It is not a
    // field: it is the op, which attaches ONE card per decision unless `count`
    // says otherwise, and `count` is absent.
    let state = board([FIRE, FIRE, FIRE]);
    state = resolve(usePyro(state).state, ACTIVE_REF).state;
    expect(attachedTypes(state, ACTIVE_REF)).toEqual(["Fire Energy"]);
    expect(state.players.p1.hand).toHaveLength(2);
  });
});

describe("D351 §5 — 'you may' and 'once during your turn'", () => {
  it("🛑 THE PARK IS **NOT** DECLINABLE — D263's prose claim, driven and falsified", () => {
    // `ASSEMBLE_ALLOY`'s doc says "a park is declinable by construction, so nothing
    // is forced on the controller". It is not: `choosePokemon` has no optional
    // member and `resolveEffect` refuses everything but a `pokemon` choice. So the
    // controller holding one of each CANNOT take the printed "a Basic {R} Energy
    // card" outcome alone — the {F} follows whether they want it or not.
    // ⚠️ THIS IS THE ONE PLACE THE BUILD DIVERGES FROM THE PRINT, and it is pinned
    // as a MEASUREMENT so that buying a declinable park reddens this line by name.
    // The divergence is inherited, not introduced: it has been the behaviour of
    // `ASSEMBLE_ALLOY`'s *"up to 2"* since D263, on the identical grammar.
    const state = board([FIRE, FIGHTING]);
    const afterFirst = resolve(usePyro(state).state, ACTIVE_REF).state;
    expect(afterFirst.phase.kind).toBe("effect:choose");
    const declined = applyAction(afterFirst, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(declined.ok).toBe(false);
    if (declined.ok) throw new Error("the park accepted a skip");
    expect(declined.error.code).toBe("BAD_EFFECT_CHOICE");
    // …and the only way out of the phase attaches the second Energy.
    const forced = resolve(afterFirst, BENCH_REF).state;
    expect(forced.phase.kind).toBe("turn:action");
    expect(attachedTypes(forced, BENCH_REF)).toEqual(["Fighting Energy"]);
    expect(forced.players.p1.hand).toHaveLength(0);
  });

  it("the Ability is once per turn", () => {
    let state = board([FIRE, FIGHTING]);
    state = resolve(resolve(usePyro(state).state, ACTIVE_REF).state, ACTIVE_REF).state;
    const again = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Pyro Dance",
    });
    expect(again.ok).toBe(false);
  });

  it("it is NOT Active-only — a BENCHED Infernape may use it", () => {
    // The print carries no Active clause, so `activeOnly: false`. Driven by moving
    // the body rather than by reading the flag back.
    const seeded = board([FIRE]);
    const active = seeded.players.p1.active;
    const bench = seeded.players.p1.bench[0];
    if (active === null || bench === undefined) throw new Error("no board");
    const swapped: GameState = {
      ...seeded,
      players: {
        ...seeded.players,
        p1: { ...seeded.players.p1, active: bench, bench: [active] },
      },
    };
    const used = apply(swapped, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Pyro Dance",
    });
    expect(used.state.phase.kind).toBe("effect:choose");
  });
});

describe("D351 §6 — an Energy attachment, not the turn's manual one", () => {
  it("the manual attach-per-turn allowance is untouched by either op", () => {
    // §6.3: the once-a-turn hand attach is a TURN allowance; an effect-driven
    // attach is not it. Two Energy leave the hand and the allowance is still there.
    let state = board([FIRE, FIGHTING, FIRE]);
    state = resolve(resolve(usePyro(state).state, ACTIVE_REF).state, ACTIVE_REF).state;
    const manual = state.players.p1.hand.find(
      (u) => POOL[state.cardIdByUid[u] ?? ""]?.category === "Energy",
    );
    if (manual === undefined) throw new Error("no Energy left in hand");
    const done = apply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: manual,
      target: { spot: "active" },
    });
    expect(attachedTypes(done.state, ACTIVE_REF)).toHaveLength(3);
  });
});

describe("D351 §7 — the pool and the registry, asserted by id", () => {
  it("NOTHING this slice defines reached `FIXTURE_POOL`", () => {
    // ⚠️ **A FIXTURE IS A CENSUS POPULATION** (D348): a body here would move
    // `catalogManifest`'s real-fixture population and `clauseApostrophe`'s
    // derivable sweep, neither of which any grep of this slice's vocabulary
    // reaches. The abstinence is asserted rather than described.
    for (const id of [...INFERNAPE_IDS, BUDDY, FIRE, FIGHTING, WATER]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });

  it("the THREE ids are CONTIGUOUS registry keys, in printed order — permanent", () => {
    // 🆕 **RE-POINTED AT D352, ON SCHEDULE AND EXACTLY AS THIS BLOCK PREDICTED.**
    // The claim that stood here — `raw.slice(-3)` — was the LIVE EXPIRING PIN on
    // `censusAtHead`'s `raw[raw.length - 1]`, and it went red the moment D352
    // appended three keys, in ANOTHER slice's suite, which is precisely what it is
    // for. **It was re-pointed, not deleted**: the live pin now lives in
    // `metalMaker.test.ts` §8 and what stays here is a CONTIGUITY claim, a
    // permanent property of THIS row (three reprints of one card entered the map
    // together, in printed order, and nothing may be interleaved between them).
    // ⚠️ The two are DIFFERENT assertions and neither substitutes for the other:
    // `remainingHpWindow.test.ts` §6 and `invitingWink.test.ts` §7 are the same
    // repair one and two slices earlier, and all three now stand still forever.
    const raw = registryCardIds();
    const first = raw.indexOf(INFERNAPE_IDS[0]);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(raw.slice(first, first + 3)).toEqual([...INFERNAPE_IDS]);
  });

  it("all THREE real ids are registry keys, and the synthetic bodies are not", () => {
    const keys = new Set(registryCardIds());
    for (const id of INFERNAPE_IDS) expect(keys.has(id), id).toBe(true);
    for (const id of [BUDDY, FIRE, FIGHTING, WATER]) expect(keys.has(id), id).toBe(false);
  });
});
