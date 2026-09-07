import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { cardSchema } from "@luminous/schema";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { matchesFilter } from "./cards";
import {
  POKEMON_TYPES,
  POKEMON_TYPE_BY_CODE,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion, programFor, topCardOf } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.366.0 → 0.367.0 — 🆕🆕 D468: THE SELF-SWITCH NARROWED BY A PRINTED BRACE TYPE
// CODE — the ONE residue row whose card CLASS is a persisted column.
//
//   "Switch this Pokémon with 1 of your Benched {L} Pokémon."
//     — Vikavolt `sv07-053` "Volt Switch", **1 Standard-legal printing**,
//       `censusAttackCorpus.ts` **FILE LINE 499**.
//
// ONE anchor (`ATTACK_SELF_SWITCH_TYPED`) and ONE `deriveAttackEffect` arm. **NO
// new op, NO new field, NO new filter member, NO new prompt kind, NO new event, NO
// log row, NO redaction and NO persisted shape**: `switchActive.targetType?:
// PokemonType` has shipped since D273 (Pecharunt ex, 5 legal printings on the
// ABILITY surface), `switchBenchNarrowing` (interpreter.ts) already filters the
// Bench end through `matchesFilter`'s `typedPokemon`, and `switchTargetNoun`
// already spells the type into the prompt caption. **Only the ATTACK-surface
// READER was missing**, which is why this row is built rather than priced: the
// vocabulary already MEANS something on a real board, and a reader that emitted a
// field nothing narrowed would be the parses-but-never-narrows build
// conventions.md forbids.
//
// 🛑🛑 THIS SLICE WAS COMMISSIONED AS THE `Ancient`/`Future` CARD-CLASS AXIS AND
// THAT TARGET WAS REFUSED. The work order named seven residue sentences the
// classifier reaches with a one-token edit and asked for "the coherent subset".
// **The coherent subset of those seven is EMPTY**, and §9 below is the executable
// form of that refusal rather than a paragraph. The short version: the banner is a
// per-PRINTING fact carried by NO field of the persisted `Card`, so every one of
// the seven would need a predicate over a datum that does not exist — D440's
// refused `"Ancient card"` capture exactly, *a filter counting 0 on every board
// forever while `BUILT.attack` steps for it*, which D190b/D199 call strictly worse
// than an unbuilt sentence. What IS buildable beside them is this row, whose
// printed adjective slot holds the OTHER kind of fact: `{L}` is `Card.types`, a
// column this engine has read since D238.
//
// ⚠️ **THE DISJOINTNESS IS STRUCTURAL AND D467 REQUIRES SAYING SO.** The new
// anchor and `ATTACK_SELF_SWITCH` are both `^…$` over the whole sentence and
// disagree on a MANDATORY run of bytes (`Benched Pokémon.` against
// `Benched {X} Pokémon.`), so no string can match both. There is therefore no
// lookahead — a guard nothing could turn red is D205/D208's vacuous guard by
// construction — and the arm's POSITION is legibility rather than behaviour, which
// §5 pins from both sides (a KILLED narrowing row and a DECLARED order row).
//
// ⚠️ **NO NEW `FIXTURE_POOL` ID.** The two bodies this file needs are declared in a
// FILE-LOCAL `cardPool` (D414's idiom, `switchSeam.test.ts`'s shape), so
// `opponentResistanceBonus.test.ts`'s pool-size pin and its eleven-deep
// `ids.length - N` ladder take a **0** term (D452). The census still steps by the
// full sentence and printing counts, because those are keyed on the CORPUS and the
// READERS and not on the pool.
//
// ⚠️ **`clauseApostrophe.test.ts` DOES NOT STEP.** The sentence carries neither
// U+0027 nor U+2019 — asserted on the BYTES in §1, not reasoned from the
// neighbours (D227 and D421 each got exactly this call wrong from a sibling's).
//
// SEED-FREE beyond the shuffles setup needs: the sentence carries no coin.

/** The printed sentence, verbatim — the byte source for every case below. */
const VOLT_SWITCH = "Switch this Pokémon with 1 of your Benched {L} Pokémon.";

/** The BARE sibling D189 built. The control for everything here: same op, same
    prompt kind, same body, no narrowing in front of it. */
const BARE = "Switch this Pokémon with 1 of your Benched Pokémon.";

/** U+2019, spelled as an escape — the two apostrophes render nearly identically,
    so the curly one is always written where a reader can see it. */
const RSQUO = "’";

/** The corpus FILE LINE of the row this slice claims (`fileLine = index + 53`). */
const VOLT_SWITCH_FILE_LINE = 499;

// ── The board ────────────────────────────────────────────────────────────────

/** The attacker. Both printed sentences of the family sit on ONE body at fixed
    indices, so every "this sentence and not that one" case below is a
    same-fixture comparison rather than a two-board one. */
const ATTACKER: Card = battler("fix-voltswitch", {
  name: "Fixavolt",
  hp: 120,
  types: ["Lightning"],
  attacks: [
    { cost: ["Colorless"], name: "Volt Switch", damage: 10, effect: VOLT_SWITCH },
    { cost: ["Colorless"], name: "Plain Switch", damage: 10, effect: BARE },
  ],
});

/** 🛑 **THE DUAL-TYPE BODY, AND IT IS THE REASON THIS FILE HAS A LOCAL POOL AT
    ALL.** `FIXTURE_POOL` holds 32 Lightning bodies and **four** dual-type ones,
    and the four sets are disjoint — measured in §6, not assumed — so no pooled
    card can tell `matchesFilter`'s `typedPokemon` MEMBERSHIP rule apart from a
    `types[0] === type` equality. D273's own doc block names that as the reason the
    rider is a `PokemonType` read through `matchesFilter`; without a dual body the
    claim is unfalsifiable on every board in this repo. */
const DUAL: Card = battler("fix-volt-dual", {
  name: "Fixtricity",
  hp: 90,
  types: ["Metal", "Lightning"],
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-voltswitch": ATTACKER,
  "fix-volt-dual": DUAL,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-voltswitch": 2,
  "fix-volt-dual": 4,
  "fix-lightning-1": 6,
  "fix-basic-1": 8,
  "fix-titan": 4,
  "fix-energy": 36,
});

/** Attack indices on `fix-voltswitch`, by name rather than by memory (§1 pins
    both against the fixture). */
const VOLT = 0;
const PLAIN = 1;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

/** `by` is about to attack with `fix-voltswitch`. The FOE opens and passes, so the
    attacking seat carries no §4 first-turn restriction; BOTH Benches are cleared,
    because every candidate list below is a POPULATION figure and a body the setup
    shuffle happened to seat would move it silently. One `{C}` pays both printed
    costs. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(localSetup(101, by === "p1" ? "p2" : "p1"), { type: "endTurn", seat: foe }),
  );
  state = setActiveFromDeck(state, by, "fix-voltswitch");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

function benched(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

/** 🛑 **THE MIXED BOARD — the one every claim in §3 and §4 is measured on.**

      attacker's side                                defender's side
        Active  fix-voltswitch  {L}                    fix-titan  {C}
        Bench 0 fix-lightning-1 {L}          ✅        fix-lightning-1 {L}
        Bench 1 fix-basic-1     {C}          ✖         fix-lightning-1 {L}
        Bench 2 fix-volt-dual   {M}{L}       ✅        fix-basic-1     {C}
        Bench 3 fix-basic-1     {C}          ✖

    The narrowed candidate set is exactly **2**, and every wrong build reads a
    different list on this ONE board:
      • the UNFILTERED walk (the rider dropped) offers **4**;
      • a `types[0] === "Lightning"` equality offers **1** — it loses the dual body,
        which is the defect D273's rider was shaped to refuse;
      • an "in play" walk would add the Active and offer **3**;
      • a SEAT INVERSION offers the opponent's **3**.
    Four distinguishable candidate lists, one setup. */
function mixed(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  const state = benched(bare(by), by, [
    "fix-lightning-1",
    "fix-basic-1",
    "fix-volt-dual",
    "fix-basic-1",
  ]);
  return benched(state, foe, ["fix-lightning-1", "fix-lightning-1", "fix-basic-1"]);
}

/** 🛑 **THE ZERO-MATCH BOARD — the single sharpest case in the file.** Four benched
    bodies and not one of them `{L}`, so the printed sentence does nothing at all
    while the UNFILTERED build parks a real prompt, takes a real answer and swaps
    the Active. Every end-state assertion a suite writes against the built rows
    stays green under that build (D461: deleting a narrowing yields a SUPERSET, so
    the engine does MORE than the card says and no count goes down) — the only
    thing that separates them is a board where the filter empties the set. */
function noMatch(by: Seat = "p1"): GameState {
  return benched(bare(by), by, ["fix-basic-1", "fix-basic-1", "fix-titan", "fix-basic-1"]);
}

/** The ONE-match board: `parkOrForce` auto-applies at a single candidate, so this
    swings with **no prompt at all**. The `noMatch` board's control on ONE axis. */
function oneMatch(by: Seat = "p1"): GameState {
  return benched(bare(by), by, ["fix-basic-1", "fix-lightning-1", "fix-basic-1"]);
}

/** The EMPTY-Bench board — `noMatch`'s control on the other axis. A silent ending
    here means "there was nobody to switch with"; a silent ending on `noMatch`
    means "the printed narrowing emptied a non-empty Bench", and a suite that drove
    only this one could not tell the two apart. */
function emptyBench(by: Seat = "p1"): GameState {
  return bare(by);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The parked `choosePokemon` prompt, narrowed — a state that is not parked fails
    HERE with the reason rather than three lines later on an undefined. */
function choosePrompt(state: GameState): { candidates: readonly PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

/** The printed NAME of every body a ref list points at. */
function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    return body === null || body === undefined ? "?" : (topCardOf(state, body)?.name ?? "?");
  });
}

function activeName(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return topCardOf(state, active)?.name ?? "?";
}

function pick(seat: Seat, index: number) {
  return {
    type: "resolveEffect",
    seat,
    choice: { kind: "pokemon", ref: { seat, spot: { spot: "bench", index } } },
  } as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED SENTENCE, MEASURED RATHER THAN REMEMBERED
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the bytes, and the corpus row they come from", () => {
  it("is a REAL corpus row at the cited FILE LINE, carrying exactly 1 printing", () => {
    // D452's rule: every entry in a refusal or a claim set is asserted to be a row
    // of the committed corpus, and its PRINTING COUNT is asserted off the corpus
    // too — a set that is merely byte-pinned can drift onto a sentence nobody
    // prints. D459's addition: cite the FILE LINE and quote the TEXT, because the
    // printing count agrees under both citation conventions 44% of the time.
    const rows = legalAttackCorpus();
    const index = rows.findIndex(([, text]) => text === VOLT_SWITCH);
    expect(index, "the printed sentence is not in the corpus").toBeGreaterThanOrEqual(0);
    expect(index + 53).toBe(VOLT_SWITCH_FILE_LINE);
    expect(rows[index]?.[0]).toBe(1);
    // The BARE sibling is a corpus row too, at SEVEN printings — so "1 printing"
    // is a measurement about this row and not a property of the family.
    expect(rows.find(([, text]) => text === BARE)?.[0]).toBe(7);
  });

  it("🛑 carries NO APOSTROPHE OF EITHER CLASS — so the anchor carries no `['’]`", () => {
    // Measured on the bytes. The subject is *this Pokémon* and *your* Bench, so
    // there is no possessive and no contraction, and nothing for a re-ingest to
    // curl. THE CONSEQUENCE, stated so it is not re-derived: `clauseApostrophe`'s
    // derivable-sentence sweep does NOT step for this slice.
    expect(VOLT_SWITCH).not.toContain("'");
    expect(VOLT_SWITCH).not.toContain(RSQUO);
    // The control — the exact seat swap DOES carry one, so "no apostrophe" is a
    // fact about this sentence rather than about this file's ability to look. It
    // is also the string an over-wide anchor starts admitting, and it stays null.
    const SWAPPED = "Switch this Pokémon with 1 of your opponent's Benched {L} Pokémon.";
    expect(SWAPPED).toContain("'");
    expect(deriveAttackEffect(SWAPPED)).toBeNull();
  });

  it("is the fixture's string, at the index this file addresses by constant", () => {
    const attacks = LOCAL_CARDS["fix-voltswitch"]?.attacks ?? [];
    expect(attacks[VOLT]?.effect).toBe(VOLT_SWITCH);
    expect(attacks[VOLT]?.name).toBe("Volt Switch");
    // Its bare sibling sits beside it on the SAME body — the control for every
    // board case below.
    expect(attacks[PLAIN]?.effect).toBe(BARE);
    expect(attacks[PLAIN]?.name).toBe("Plain Switch");
  });

  it("hands nothing to the COIN or the DAMAGE readers — one sentence, one seam", () => {
    expect(deriveAttackCoinFlip(VOLT_SWITCH)).toBeNull();
    expect(deriveAttackDamageBonus(VOLT_SWITCH)).toBeNull();
    // …and it is claimed by no SPLITTER either, so the census gain is the RAW
    // reader summand alone and not a composition (D444's four-way subtraction).
    expect(splitAttackGateClause(VOLT_SWITCH)).toBeNull();
    expect(splitAttackTrailingClause(VOLT_SWITCH)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE ARM: THE DERIVED VALUE, AND WHAT THE NARROWING IS WORTH
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derived program, by VALUE", () => {
  it("derives to `switchActive` carrying the printed type — and nothing else", () => {
    expect(deriveAttackEffect(VOLT_SWITCH)).toEqual([
      { op: "switchActive", targetType: "Lightning" },
    ]);
  });

  it("🛑 the BARE sibling still derives to the FIELD-LESS op — the two differ by the rider", () => {
    // The claim that makes the slice a WIDENING rather than a replacement: the
    // seven shipped printings of the bare sentence emit exactly the byte they
    // always did, and the whole difference between the two programs is the one
    // key the print spells.
    const bareProgram = deriveAttackEffect(BARE);
    expect(bareProgram).toEqual([{ op: "switchActive" }]);
    expect(bareProgram?.[0]).not.toHaveProperty("targetType");
    const typed = deriveAttackEffect(VOLT_SWITCH);
    expect(typed).not.toEqual(bareProgram);
    // …and the difference is EXACTLY one key, read structurally rather than by
    // re-typing the object (D449: an INEQUALITY of derived programs is strictly
    // stronger than a `toBeNull`, and it cannot go green by accident).
    expect(Object.keys(typed?.[0] ?? {}).sort()).toEqual(["op", "targetType"]);
  });

  it("reads EVERY code the map spells, generated FROM the map rather than listed", () => {
    // D442's rule pointed the useful way: the vocabulary comes off the map, so a
    // code added to `POKEMON_TYPE_BY_CODE` is admitted here by construction and a
    // code DROPPED from it reddens this rung instead of silently falling off the
    // built set.
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackEffect(`Switch this Pokémon with 1 of your Benched {${code}} Pokémon.`),
        code,
      ).toEqual([{ op: "switchActive", targetType: type }]);
    }
    // The map is TOTAL over the type vocabulary, so the loop above is the whole
    // of it rather than a sample.
    expect(new Set(Object.values(POKEMON_TYPE_BY_CODE))).toEqual(new Set(POKEMON_TYPES));
  });

  it("🛑 an UNREADABLE code stays LOUD rather than defaulting to a type", () => {
    // A letter the map does not spell is a refusal BY CONSTRUCTION (D239's rule at
    // `PREVENT_DAMAGE_FROM_CLASS`), not by a hand-kept exclusion list. The
    // dangerous alternative is not "throw" — it is DEFAULTING, which would ship a
    // narrowing the card does not print with no channel saying so.
    for (const code of ["Q", "X", "B", "A"]) {
      expect(POKEMON_TYPE_BY_CODE[code], code).toBeUndefined();
      expect(
        deriveAttackEffect(`Switch this Pokémon with 1 of your Benched {${code}} Pokémon.`),
        code,
      ).toBeNull();
    }
  });

  it("🛑 the anchor is WHOLE-STRING and commits to CASE — the rewrites it refuses", () => {
    const refused = [
      // CASE: the lowercase verb is what `ATTACK_FLIP_SELF_SWITCH` and
      // `ATTACK_SELF_SWITCH_THEN_OPPONENT_SWITCH_OUT` print mid-sentence, and
      // folding it into an `[Ss]` would let a clause that merely BEGINS mid-string
      // derive as a whole-string match.
      "switch this Pokémon with 1 of your Benched {L} Pokémon.",
      "Switch This Pokémon with 1 of your Benched {L} Pokémon.",
      // The `$`: a trailing clause and the missing terminator.
      VOLT_SWITCH.slice(0, -1),
      // The `^`: a LEADING clause. Real shape — every compound in this family puts
      // a whole mechanic in front of the switch.
      `Draw a card. ${VOLT_SWITCH}`,
      // The COUNT is literal in this anchor exactly as in its four siblings: every
      // printing prints 1, and `switchActive` parks a single-pick `choosePokemon`.
      "Switch this Pokémon with 2 of your Benched {L} Pokémon.",
      // The SEAT.
      "Switch this Pokémon with 1 of your opponent's Benched {L} Pokémon.",
      // The BRACES: an unbraced type word is a different printed notation and this
      // anchor does not claim it (the pool prints both notations, split by set).
      "Switch this Pokémon with 1 of your Benched Lightning Pokémon.",
      // A MULTI-CHARACTER code — the greedy-capture mistake this file's anchors
      // are audited for. `([A-Z])` is one character on purpose.
      "Switch this Pokémon with 1 of your Benched {LW} Pokémon.",
    ];
    for (const text of refused) expect(deriveAttackEffect(text), text).toBeNull();
    // …and the real sentence is not in that list by construction, which is what
    // stops the loop above from being a list of strings nobody checked.
    expect(refused).not.toContain(VOLT_SWITCH);
    expect(deriveAttackEffect(VOLT_SWITCH)).not.toBeNull();
  });

  it("🛑 the `$` refusal is demonstrated at the SPLIT, because the loud path is gone (D464)", () => {
    // D464's finding, and it applies the moment a sentence becomes derivable: a
    // `^`-end near-miss stays LOUD (nothing claims its head), but its `$`-end twin
    // does NOT — `splitAttackTrailingClause` sees a claimed HEAD and a claimed TAIL
    // and composes them, through a path that is neither the anchor nor the arm. So
    // a rung asserting `toBeNull` on the compound would go red on its first run,
    // and the executable claim is the SPLIT itself.
    const compound = `${VOLT_SWITCH} Draw a card.`;
    expect(deriveAttackEffect(compound)).toBeNull();
    expect(splitAttackTrailingClause(compound)).toEqual({
      head: VOLT_SWITCH,
      tail: "Draw a card.",
    });
    // ⚠️ AND NOTHING IS AUTHORED, because no such compound is printed — checked
    // over the whole 640-row column rather than asserted.
    const composed = legalAttackCorpus().filter(
      ([, text]) => text !== VOLT_SWITCH && text.startsWith(VOLT_SWITCH),
    );
    expect(composed).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE BOARD: THE NARROWING NARROWS
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the parked candidate list is the printed subgroup", () => {
  it("🛑 offers the two {L} bodies and NEITHER Colorless one, on a four-body Bench", () => {
    const { state } = swing(mixed(), VOLT);
    const { candidates } = choosePrompt(state);
    expect(refNames(state, candidates).sort()).toEqual(["Fixtricity", "fix-lightning-1"]);
    // Read as REFS too, so "two names" cannot pass on a list pointing at the wrong
    // spots — the dual body is at bench index 2 and the plain {L} at index 0.
    expect(candidates.map((r) => r.spot.spot === "bench" && r.spot.index).sort()).toEqual([0, 2]);
    // …and every candidate is on the ATTACKER's side. A seat inversion would offer
    // three bodies from p2, which is why p2's Bench is stocked with {L} at all.
    for (const ref of candidates) expect(ref.seat).toBe("p1");
  });

  it("🛑 the BARE sibling on the SAME body and the SAME board offers all FOUR", () => {
    // The one-axis control (D399): identical setup, identical op, one printed token
    // different. Without it "offers two" is consistent with a build that offers two
    // for some reason that has nothing to do with the type.
    const { state } = swing(mixed(), PLAIN);
    const { candidates } = choosePrompt(state);
    expect(refNames(state, candidates).sort()).toEqual([
      "Fixtricity",
      "fix-basic-1",
      "fix-basic-1",
      "fix-lightning-1",
    ]);
    expect(candidates).toHaveLength(4);
  });

  it("🛑 the DUAL-TYPE body is offered — MEMBERSHIP, not `types[0]` equality", () => {
    // D273's rider is a `PokemonType` read through `matchesFilter`'s `typedPokemon`
    // precisely so a `["Metal","Lightning"]` body answers YES to `{L}`. Driven on
    // the board AND at the predicate, because the two can disagree.
    expect(DUAL.types).toEqual(["Metal", "Lightning"]);
    expect(DUAL.types?.[0]).not.toBe("Lightning");
    expect(matchesFilter(DUAL, { kind: "typedPokemon", pokemonType: "Lightning" })).toBe(true);
    expect(matchesFilter(DUAL, { kind: "typedPokemon", pokemonType: "Metal" })).toBe(true);
    expect(matchesFilter(DUAL, { kind: "typedPokemon", pokemonType: "Water" })).toBe(false);
    const { state } = swing(mixed(), VOLT);
    expect(refNames(state, choosePrompt(state).candidates)).toContain("Fixtricity");
  });

  it("the PROMPT CAPTION names the printed subgroup — D273's noun, at a new surface", () => {
    // `switchTargetNoun` has spelled the type since D273 and no ATTACK had ever
    // reached it. The caption must name exactly the set the validator offers, or
    // the dialog contradicts itself (D457: a shared UI predicate needs unshared
    // words).
    const { state } = swing(mixed(), VOLT);
    expect(choosePrompt(state).note).toBe("Switch to which Benched Lightning Pokémon?");
    // The control: the bare sibling's caption is BYTE-IDENTICAL to what it was
    // before this slice, which is what keeps every switch printing before it from
    // quietly changing its prompt.
    const { state: plain } = swing(mixed(), PLAIN);
    expect(choosePrompt(plain).note).toBe("Switch to which Benched Pokémon?");
  });

  it("answering promotes the chosen {L} body, and the attack's damage still lands", () => {
    const { state: parked } = swing(mixed(), VOLT);
    const { state: done, events } = mustApply(parked, pick("p1", 2));
    expect(activeName(done, "p1")).toBe("Fixtricity");
    expect(find(events, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(done.phase.kind).toBe("turn:action");
    // The §8.5 hit ran BEFORE the program, on the body that declared — so the
    // defender took 10 even though the attacker left the Active Spot.
    expect(done.players.p2.active?.damage).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE THREE ENDINGS, AND THE CONTROL THAT TELLS TWO OF THEM APART
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — `parkOrForce`'s three arms, reached through the narrowing", () => {
  it("🛑 ZERO matches on a NON-EMPTY Bench: no park, no switch, no row", () => {
    // ⚠️ THE ROW THAT SEPARATES THIS BUILD FROM THE UNFILTERED ONE. Four benched
    // bodies, none {L}: the printed sentence does nothing, where a build that
    // dropped the rider would park a prompt and swap the Active. Every end-state
    // assertion in §3 is green under that build; only this board reddens.
    const before = noMatch();
    expect(before.players.p1.bench).toHaveLength(4);
    const { state: done, events } = swing(before, VOLT);
    expect(done.phase.kind).toBe("turn:action");
    expect(activeName(done, "p1")).toBe("Fixavolt");
    expect(events.filter((e) => e.type === "POKEMON_SWITCHED")).toEqual([]);
    // The §8.5 damage still lands — the attack RESOLVED, it just had nobody to
    // switch with. A build that refused the declaration would fail here.
    expect(done.players.p2.active?.damage).toBe(10);
    // …and the loud channel does NOT fire: the sentence is SIMULATED, so a zero
    // candidate set is a legitimate ending rather than an unread sentence.
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toEqual([]);
  });

  it("the SAME board under the BARE sibling DOES park — the one-axis control", () => {
    // Without this, "nothing happened" is consistent with a board that could never
    // switch for a reason unrelated to the type (D437: each arity case needs its
    // unnarrowed board as its control).
    const { state } = swing(noMatch(), PLAIN);
    expect(state.phase.kind).toBe("effect:choose");
    expect(choosePrompt(state).candidates).toHaveLength(4);
  });

  it("ONE match: `parkOrForce` FORCES it — the switch happens with no prompt", () => {
    const { state: done, events } = swing(oneMatch(), VOLT);
    expect(done.phase.kind).toBe("turn:action");
    expect(activeName(done, "p1")).toBe("fix-lightning-1");
    expect(find(events, "POKEMON_SWITCHED")?.seat).toBe("p1");
  });

  it("an EMPTY Bench also ends silently — `noMatch`'s control on the other axis", () => {
    // Two boards end the same way for two different reasons, and a suite that drove
    // only one of them could not say which reason it had measured (D424: every
    // refusal owes a neighbouring admission on the same axis).
    const before = emptyBench();
    expect(before.players.p1.bench).toEqual([]);
    const { state: done, events } = swing(before, VOLT);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.filter((e) => e.type === "POKEMON_SWITCHED")).toEqual([]);
    // …and the BARE sibling ends silently here too, which is what makes the
    // `noMatch` pair above a claim about the FILTER rather than about the Bench.
    const { state: plain } = swing(emptyBench(), PLAIN);
    expect(plain.phase.kind).toBe("turn:action");
  });

  it("🛑 the SECOND SEAT reads its own Bench — the claim is about the CONTROLLER", () => {
    // A mirror board gives the same numbers from either chair, which is a real
    // claim and NOT the claim that reading the wrong seat is visible (D445). The
    // inversion evidence comes off ONE board: p2 attacks, p2's own {L} bodies are
    // the candidates, and p1's three-body Bench is what a crossed build would offer.
    const { state } = swing(mixed("p2"), VOLT, "p2");
    const { candidates } = choosePrompt(state);
    expect(refNames(state, candidates).sort()).toEqual(["Fixtricity", "fix-lightning-1"]);
    for (const ref of candidates) expect(ref.seat).toBe("p2");
    const { state: done } = mustApply(state, pick("p2", 0));
    expect(activeName(done, "p2")).toBe("fix-lightning-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE ANCHOR PAIR: WHICH MECHANISM SUPPLIES THE DISJOINTNESS
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the two self-switch anchors are STRUCTURALLY disjoint", () => {
  it("🛑 no string can match both — so the arm carries no guard and the ORDER is legibility", () => {
    // D467's rule, and the half it requires stating: the placement decision follows
    // from WHICH mechanism supplies the disjointness. Here both patterns are `^…$`
    // over the whole sentence and disagree on a MANDATORY run of bytes, so a
    // lookahead would be a guard nothing could ever turn red. Contrast D467's
    // `YOUR_BENCHED_NOUN_SCALE`, whose bare-token capture genuinely overlaps and
    // therefore had to be placed FIRST.
    //
    // Proved over the whole column rather than on a specimen: no corpus sentence is
    // claimed by more than one of the family's spellings.
    const family = [
      BARE,
      VOLT_SWITCH,
      "You may switch this Pokémon with 1 of your Benched Pokémon.",
      "Flip a coin. If heads, switch this Pokémon with 1 of your Benched Pokémon.",
    ];
    const programs = family.map((text) => JSON.stringify(deriveAttackEffect(text)));
    expect(new Set(programs).size, "two family members derive to the same program").toBe(4);
    for (const text of family) expect(deriveAttackEffect(text), text).not.toBeNull();
  });

  it("the typed anchor claims EXACTLY ONE corpus row, and it is the cited line", () => {
    // A population rung rather than a specimen one (D423): the anchor's reach is
    // measured over all 640 rows, so a widening that started claiming a second
    // sentence reddens here even if nobody thought to write that sentence down.
    const claimed = legalAttackCorpus().filter(([, text]) => {
      const program = deriveAttackEffect(text);
      return program?.length === 1 && program[0]?.op === "switchActive" && "targetType" in program[0];
    });
    expect(claimed.map(([, text]) => text)).toEqual([VOLT_SWITCH]);
    expect(claimed[0]?.[0]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE POOL, SWEPT AS ITS OWN POPULATION
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — why this file owns a local pool", () => {
  it("🛑 `FIXTURE_POOL` HAS NO DUAL-TYPE LIGHTNING BODY — measured, not assumed", () => {
    // This is the whole justification for `fix-volt-dual`, and it is a MEASUREMENT
    // rather than a preference: without a dual body the membership rule and a
    // `types[0]` equality answer identically on every board in this repo, so §3's
    // sharpest rung would be unfalsifiable.
    const dualLightning = Object.values(FIXTURE_POOL).filter(
      (card) => (card.types ?? []).length > 1 && (card.types ?? []).includes("Lightning"),
    );
    expect(dualLightning).toEqual([]);
    // The two halves separately, so a future pool that gains one reddens the rung
    // above with a reason rather than a bare zero.
    expect(
      Object.values(FIXTURE_POOL).filter((card) => (card.types ?? []).includes("Lightning")).length,
    ).toBeGreaterThan(0);
    expect(
      Object.values(FIXTURE_POOL).filter((card) => (card.types ?? []).length > 1).length,
    ).toBeGreaterThan(0);
  });

  it("adds NO `FIXTURE_POOL` id — the local ids are local", () => {
    // D452/D465: a `FIXTURE_POOL` id is a census entry with a tax of its own
    // (`opponentResistanceBonus.test.ts` pins the pool SIZE and carries eleven
    // nested `ids.length - N` chains). Keeping these two bodies file-local costs
    // that file a ZERO term, and this rung is what stops a successor "tidying" them
    // into the shared pool without noticing the bill.
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE REGISTRY IS NOT INVOLVED
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the gain is the RAW reader summand alone", () => {
  it("no registry row serves this sentence, so the census summands stay DISJOINT", () => {
    // D457's rule: `censusAtHead.test.ts` requires the reader summand and the
    // registry summand to be disjoint, so a reader arm written over a sentence a
    // registry row already served would REDDEN the census rather than step it. The
    // real card is not in this checkout at all — stated as unresolved rather than
    // invented (D425) — and no pooled id carries the sentence.
    expect(programFor("sv07-053")?.attack).toBeUndefined();
    const carriers = Object.keys(FIXTURE_POOL).filter((id) =>
      (FIXTURE_POOL[id]?.attacks ?? []).some((attack) => attack.effect === VOLT_SWITCH),
    );
    expect(carriers).toEqual([]);
  });

  it("`resolvedByAnyReader` now claims it, and the reader that owns it is named", () => {
    // D438's polarity rule: a positive re-point that only says "some reader takes
    // it" discards a thirteen-way refusal. So the OWNER is named AND every other
    // reader is still asserted to refuse.
    expect(resolvedByAnyReader(VOLT_SWITCH)).toBe(true);
    expect(deriveAttackEffect(VOLT_SWITCH)).not.toBeNull();
    for (const read of [deriveAttackCoinFlip, deriveAttackDamageBonus]) {
      expect(read(VOLT_SWITCH)).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the engine version", () => {
  it("engineVersion is 0.379.0", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE `Ancient` / `Future` BANNER, REFUSED EXECUTABLY
// ─────────────────────────────────────────────────────────────────────────────
//
// 🛑🛑 THIS SECTION IS THE REFUSAL THIS SLICE WAS COMMISSIONED TO OVERTURN, WRITTEN
// AS A TEST INSTEAD OF AS A PARAGRAPH. D428's rule: *a refusal written as prose
// rots; a refusal written as a test cannot* — and D422's: *when you refuse a slice,
// write the CONDITION THAT WOULD REVERSE THE REFUSAL, so a successor can test it in
// one command instead of trusting it.* The banner refusal has now been re-proposed
// as a work order at least twice (D461 and D462 each priced it, D468's brief asked
// for it outright), and every time the reader has had to re-derive it from three
// doc blocks. It is one `expect` away from being self-checking, and this is it.

describe("§9 — the `Ancient`/`Future` banner is DATA-BLOCKED, and the falsifier is executable", () => {
  it("🛑 the persisted `Card` carries NO field that could classify the banner", () => {
    // ⚠️ THE FALSIFIER, AND IT IS THE WHOLE POINT OF THE RUNG: this list is the
    // declared key set of `packages/schema/src/catalog/card.ts`'s `cardSchema`, read
    // OFF THE SCHEMA rather than transcribed, so the day the ingest lands a banner
    // (or any other) column this assertion goes RED and names it. Nothing in
    // `packages/engine` can be that change — the banner is a per-PRINTING fact, and
    // this is the file that would have to learn it.
    expect(Object.keys(cardSchema.shape).sort()).toEqual(
      [
        "abilities",
        "attacks",
        "category",
        "effect",
        "energyType",
        "evolveFrom",
        "hp",
        "id",
        "illustrator",
        "image",
        "legal",
        "localId",
        "name",
        "rarity",
        "regulationMark",
        "resistances",
        "retreat",
        "setId",
        "stage",
        "trainerType",
        "types",
        "variants",
        "weaknesses",
      ].sort(),
    );
  });

  it("🛑 a NAME-keyed table cannot answer it either — the banner is a per-PRINTING fact", () => {
    // The other tempting build, and the reason it is refused rather than merely
    // unbuilt: `pokemonSuffixOf` proves a printed marker CAN survive ingest inside
    // `Card.name` (a Pokémon V is literally named "<Species> V"), so a successor
    // reaching for the same trick is reaching for something that has worked before.
    // It does not work here. Great Tusk ex `sv01-123`/`-230`/`-246` is the same
    // SPECIES as the sv04 Ancient prints and carries no banner at all, so any
    // name-keyed table answers three real cards wrongly with no failure anywhere —
    // D190b/D199's *a wrong-but-plausible program is strictly worse than an unbuilt
    // one*, at the instrument layer.
    //
    // Driven rather than argued: no printed name in this pool carries either word,
    // so a name parse has nothing to read.
    const named = Object.values(FIXTURE_POOL).filter((card) => /Ancient|Future/.test(card.name));
    expect(named).toEqual([]);
  });

  it("🛑 the residue holds 12 sentences / 17 printings on the banner, and NONE derives", () => {
    // ⚠️ PINNED ON THE POPULATION, NEVER ON A SPECIMEN (D423). The count is read off
    // the committed corpus, so it moves when the catalog rotates and cannot drift
    // onto a sentence nobody prints.
    //
    // ⚠️ 17, NOT 16. D462's note records "12 sentences / 16 printings" and D468's
    // work order inherited it; re-measured here over all 640 rows the printing total
    // is SEVENTEEN. A figure copied into prose rots by construction (D432), which is
    // why this one is derived rather than transcribed.
    const banner = legalAttackCorpus().filter(([, text]) => /Ancient|Future/.test(text));
    expect(banner).toHaveLength(12);
    expect(banner.reduce((total, [printings]) => total + printings, 0)).toBe(17);
    // Not one of them is claimed by any reader, any splitter or any registry row.
    for (const [, text] of banner) {
      expect(resolvedByAnyReader(text), text).toBe(false);
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
    }
  });

  it("🛑 it is FOUR carriers and not one mechanism, so the data alone would not close it", () => {
    // D462's finding, kept executable: *price the CARRIERS, not the token.* The
    // eight non-`OPAQUE` rows want the predicate in at least four different places —
    // a `CardFilter` kind, `preventDamage.fromClass` (a one-member union), an op
    // FIELD in the `moveCountersToDefender.ownerPokemon` shape, and a SUPPORTER-CARD
    // predicate for *"If you played an Ancient Supporter card…"*, which is not about
    // a Pokémon at all. The rung below is the cheap half of that claim: the family
    // spans BOTH surfaces the census separates, so no single reader could take it.
    const banner = legalAttackCorpus().filter(([, text]) => /Ancient|Future/.test(text));
    const damageShaped = banner.filter(([, text]) => /this attack does/i.test(text));
    const effectShaped = banner.filter(([, text]) => !/this attack does/i.test(text));
    expect(damageShaped.length).toBeGreaterThan(0);
    expect(effectShaped.length).toBeGreaterThan(0);
  });

  it("🛑 the ADJACENT row this slice DID take shows what the difference is", () => {
    // The whole argument in two lines. Both sentences put a card CLASS in the same
    // printed adjective slot; one class is a persisted column and the other is not,
    // and that — not the shape of the sentence, not the classifier's class name — is
    // what decides which is buildable.
    expect(deriveAttackEffect(VOLT_SWITCH)).toEqual([
      { op: "switchActive", targetType: "Lightning" },
    ]);
    expect(
      deriveAttackEffect("Switch this Pokémon with 1 of your Benched Ancient Pokémon."),
    ).toBeNull();
    // ⚠️ AND THE CONSTRUCTED CONTROL IS LABELLED AS CONSTRUCTED (D440): the switch
    // string above is nobody's printing. It is here because it varies the printed
    // slot on exactly ONE axis (D427), which is the only way to show that the slot
    // is not what is doing the refusing.
    const corpus = legalAttackCorpus();
    expect(
      corpus.some(([, text]) => text === "Switch this Pokémon with 1 of your Benched Ancient Pokémon."),
    ).toBe(false);
    // ⚠️ **BUT THE PRINTED SLOT IS REAL, AND THAT IS THE FINDING RATHER THAN A
    // CAVEAT.** The catalog spells the very phrase `Benched Ancient Pokémon` on TWO
    // residue rows — corpus FILE LINES 272 and 406, the heal and the counter-move —
    // and both stay LOUD. So the constructed sentence is not a straw: its slot is
    // occupied by a real printed noun that this engine cannot read.
    const printedSlot = corpus.filter(([, text]) => text.includes("Benched Ancient Pokémon"));
    expect(printedSlot).toHaveLength(2);
    for (const [, text] of printedSlot) expect(deriveAttackEffect(text), text).toBeNull();
  });
});
