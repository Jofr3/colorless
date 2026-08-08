import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { rareCandyOptions } from "./cardplay";
import { passivesOf } from "./continuous";
import { evolveEarlyLicensed } from "./interpreter";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, programFor } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  setActiveFromDeck,
} from "./testFixtures";

// 0.191.0 → 0.192.0 — D278, THE §4/§10 EVOLVE LICENCE. D277's §4 ATTACK licence
// one rule over, and the FIRST printing in this engine whose ONE sentence lifts
// TWO different bans spelled in two different files.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CENSUS — the evolve-licence group, RUNG BY RUNG, re-queried not carried.
// ─────────────────────────────────────────────────────────────────────────────
//
// Run against the remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a,
// 3,786 rows) on 2026-08-08, at `legal_standard = 1`, over ALL THREE text
// columns (`abilities_json`, `attacks_json`, `effect`).
//
//   RUNG 1 — the three NAMES the D277 handoff hands over, `%first turn%`
//     Eevee 3 · Karrablast 2 · Shelmet 2                    =  7 printings
//     …and all seven printed texts reproduced EXACTLY as inherited. The two
//     Eevee/partner sentences are byte-identical per name.
//   RUNG 2 — POOL-WIDE '%evolve during your first turn%', all three columns
//     10 printings · 4 names · 4 distinct ability texts
//     = the 7 above + **Eevee ex `sv08.5-075`/`-167`/`svp-174` (3)**
//   RUNG 3 — POOL-WIDE '%the turn you play it%', all three columns
//     the SAME 10. The second half of the sentence is spelled ONE way in this
//     pool, so rung 2 is the whole population and no fourth rung exists.
//   RUNG 4 — Rare Candy REACHABILITY for the three bodies
//     SELECT … stage='Stage2' AND evolve_from IN (SELECT name … WHERE
//     evolve_from IN ('Eevee','Karrablast','Shelmet'))  →  **EMPTY SET**
//
// 🛑 **RUNG 2's EXTRA THREE ARE THE REMINDER TEXT, AND THEY ARE THE BEST
// EVIDENCE IN THE POOL THAT THE LICENCE LIFTS *TWO* BANS.** Eevee ex's "Rainbow
// DNA" ends *"(This Pokémon can't evolve during your first turn or the turn you
// play it.)"* — the **exact negation** of Eevee's licence, printed by the game
// itself as a restatement of the standard rule. The pair is not an inference from
// this engine's code; it is printed on a card. (Rainbow DNA's own first sentence
// — *"can evolve into any Pokémon ex that evolves from Eevee"* — is a DIFFERENT
// mechanism and is REFUSED here with its name: it widens the `evolveFrom` chain,
// and `evolve` compares `targetTopCard.name !== evolvesFrom` with no override.)
//
// The enumeration adds up: 3 (this row) + 2 + 2 (partner-gated, refused) + 3
// (reminder, nothing to build) = **10**. A census that does not add up is not a
// census (D277's rule, applied to its own successor row).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO BANS — VERIFIED IN THE CODE, NOT INHERITED FROM THE HANDOFF.
// ─────────────────────────────────────────────────────────────────────────────
//
// `evolve` (turn.ts) refused on TWO independent lines before this slice, 53
// lines apart, with two different codes:
//
//   1. `isFirstTurnOf(state, action.seat)`      → FIRST_TURN_EVOLVE   (§4/§10)
//   2. `target.turnPlayed >= state.turn`        → EVOLVE_TOO_SOON     (§10)
//
// **IT IS TWO, NOT ONE AND NOT THREE.** The count was checked by READING the
// handler rather than by trusting the handoff: there is no third refusal on the
// evolve path (the `turnGate`, the hand checks, the `evolveFrom` match and the
// bench-index decode are not timing rules), and line 2 is ONE line encoding TWO
// rules — "came into play this turn" AND "already evolved this turn", since
// `placeEvolution` stamps `turnPlayed`. The licence lifts the first of those and
// **cannot be observed lifting the second**, because evolving replaces the top
// card and so removes the very Ability that granted it.
//
// ⚠️ `rareCandy` / `rareCandyOptions` (cardplay.ts) carry a coinciding pair —
// three more ban lines — and the licence DELIBERATELY DOES NOT REACH THEM. See
// §6 below: Rare Candy prints its OWN restriction, so those two clauses are not
// §4/§10 arriving second-hand, and an Ability on the target cannot lift a
// restriction printed on a different card about its own use.
//
// 🛑 **WHY LIFTING ONLY BAN 1 IS THE QUIET BUG, AND THE FIXTURE THAT PROVES IT.**
// A SETUP Pokémon carries `turnPlayed = 0` (turn.ts says so explicitly), and
// `0 >= 1` is false — so on turn 1, the board this licence is most obviously
// tested on, **ban 2 never fires at all**. Every turn-1 assertion in this file
// would be green on a build that wired only ban 1. The case that separates them
// is §5's "ALLOWS the LICENSED body played THIS turn": a LATER turn, a body
// played THAT turn, promoted into the Active Spot. It is the reason the field is
// called `evolveEarlyExempt` and not `evolveFirstTurnExempt`.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT WAS BUILT, AND WHAT WAS REFUSED.
// ─────────────────────────────────────────────────────────────────────────────
//
//   • **BUILT — Eevee ×3.** ONE `PassiveEffects` boolean (`evolveEarlyExempt`),
//     ONE ZONE-GATED term in the `passivesOf` fold, ONE new `continuous.ts`
//     predicate (`evolveEarlyLicensed`) and TWO ban lines re-pointed at it.
//     ZERO new `BoardCondition` members, ZERO new `EffectOp` members, ZERO new
//     `GameState` fields, and `MATCH_RECORD_VERSION` **14, unchanged** — nothing
//     is persisted, the licence is a catalog fact re-derived on every read.
//   • **REFUSED — Karrablast `sv10.5b-009`/`-094`, Shelmet `sv10.5w-008`/`-093`
//     (4), AND THE MISSING MECHANISM IS NAMED.** *"If you have Shelmet in play,
//     this Pokémon can evolve during your first turn or the turn you play it."*
//     ⚠️ **AN INHERITED CLAIM IS WRONG HERE AND IS CORRECTED**: D277's header
//     called their gate *"`yourBenchHasNamed`'s sentence on a field that does not
//     exist"*. **The member DOES exist** (effects.ts, Falinks `sv02-119`) — and
//     it is **BENCH-ONLY BY CONSTRUCTION**, its own doc block saying *"the Active
//     Spot is deliberately not consulted, because the printed word is Bench"*.
//     The printed word on Karrablast/Shelmet is **"in play"**, which is Active +
//     Bench. So the gap is a SECOND member (`yourNamedPokemonInPlay`) and not a
//     wider reading of the first — and these four ALSO print no Active-Spot
//     clause, so the flag would additionally have to split from its zone gate.
//     **Two mechanisms for 4 printings; Eevee's 3 need neither.**
//   • **REFUSED — Eevee ex ×3 (reminder text) and Rainbow DNA's chain widening**,
//     named above.
//
//   • **REFUSED — the `rareCandy` sites (3 ban lines), AND THE REFUSAL IS A
//     READING RATHER THAN A GAP.** Rare Candy prints *"You can't use this card
//     during your first turn or on a Basic Pokémon that was put into play this
//     turn."* — its own restriction, coinciding with §4/§10 clause for clause,
//     which is exactly why one reader has served both and why the distinction is
//     easy to miss. An Ability on the TARGET does not lift a restriction printed
//     on a DIFFERENT card about its own use. ⚠️ **AND RUNG 4 SAYS NO BOARD IN
//     THIS CATALOG CAN TELL THE TWO READINGS APART** — zero Standard Stage 2
//     chains from Eevee — so the decision is DRIVEN below off a LOCAL
//     Stage-1/Stage-2 chain. An unreachable decision that no test pins is a
//     decision nobody can ever find, let alone correct.

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** The printed text, once, byte-for-byte, shared by all three printings. */
const BOOSTED_EVOLUTION_TEXT =
  "As long as this Pokémon is in the Active Spot, it can evolve during your first turn or the turn you play it.";

/** Eevee's attack text — carried so the fixture is the card rather than the
    subset the assertions happen to touch (D277's re-queried retreat, as a rule). */
const RECKLESS_CHARGE_TEXT = "This Pokémon also does 10 damage to itself.";

const BOOSTED_IDS = ["sv08-143", "sv08.5-074", "svp-173"] as const;

/** An Eevee printing, carrying the catalog's OWN hp (50), retreat (1), type
    (`Colorless`), stage (`Basic`) and attack (2×{C} "Reckless Charge", 30) —
    every scalar read off the D1 row on 2026-08-08 rather than invented. The ids
    are REAL, so `programFor` resolves the shipped `BOOSTED_EVOLUTION` row. */
function eevee(id: string): Card {
  return battler(id, {
    name: "Eevee",
    hp: 50,
    retreat: 1,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "Boosted Evolution", effect: BOOSTED_EVOLUTION_TEXT }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Reckless Charge",
        damage: 30,
        effect: RECKLESS_CHARGE_TEXT,
      },
    ],
  });
}

/** The CONTROL body: the same card with the Ability removed and NOTHING else
    changed — same NAME included, deliberately, so ONE evolution fixture serves
    both arms and the two boards differ in exactly one thing.
    🛑 **THE SUITE IS VACUOUS WITHOUT IT.** Every "the licence works" assertion
    below passes just as happily on a build that deleted the §4 evolve ban
    outright, and this body is the only thing that can tell those apart. */
const UNLICENSED = "fix-plain-eevee";

/** The Stage 1 that evolves from Eevee — a LOCAL fixture, because the point is
    the TIMING rule and not any particular Eeveelution. */
const STAGE1 = "fix-eeveelution";
/** The Stage 2 that bridges Eevee → Stage 2 for Rare Candy. ⚠️ **NO SUCH CARD
    EXISTS IN STANDARD** (census rung 4 returned an empty set) — it is here so the
    `rareCandy` half of the licence is DRIVEN rather than merely wired, which is
    the difference between an engine invariant and a comment claiming one. */
const STAGE2 = "fix-eeveestage2";

const LOCAL_CARDS: Record<string, Card> = {
  "sv08-143": eevee("sv08-143"),
  "sv08.5-074": eevee("sv08.5-074"),
  "svp-173": eevee("svp-173"),
  [UNLICENSED]: battler(UNLICENSED, {
    name: "Eevee",
    hp: 50,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Reckless Charge",
        damage: 30,
        effect: RECKLESS_CHARGE_TEXT,
      },
    ],
  }),
  [STAGE1]: battler(STAGE1, {
    name: "Eeveelution",
    stage: "Stage1",
    evolveFrom: "Eevee",
    hp: 110,
    types: ["Colorless"],
  }),
  [STAGE2]: battler(STAGE2, {
    name: "Eeveelution Prime",
    stage: "Stage2",
    evolveFrom: "Eeveelution",
    hp: 170,
    types: ["Colorless"],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The THIRTEENTH seeded deck (D270's rule: a seeded suite gets its own deck).
    ⚠️ `fix-basic-1` is load-bearing — §14.2 makes an empty Bench a LOSS the
    moment the Active leaves, and a `gameOver` board proves nothing about a gate. */
const EEVEE_DECK = deckOf({
  "sv08-143": 4,
  "sv08.5-074": 4,
  "svp-173": 4,
  [UNLICENSED]: 4,
  [STAGE1]: 8,
  [STAGE2]: 4,
  "sv01-191": 4, // Rare Candy — the REFUSED site, driven off a local chain
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-basic-1": 4,
  "fix-energy": 22,
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

/** D275/D277's `localSetup` verbatim in shape: the FIRST PLAYER is a PARAMETER,
    so every assertion below can be made from BOTH seats under BOTH assignments.
    ⚠️ A ONE-SEAT BOARD IS VACUOUS ON A PER-SEAT FACT, and §4's evolve ban — which
    binds BOTH seats, unlike §4's attack ban — is exactly such a fact. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: EEVEE_DECK, p2: EEVEE_DECK }, cardPool: POOL });
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

/** A board with `seat`'s Active set to `activeId`, a benched body behind it and
    `count` copies of the Stage 1 in hand. `setActiveFromDeck` stamps
    `turnPlayed = 0` — the SETUP stamp, which is exactly what makes ban 2 quiet on
    turn 1 (see the header). */
function board(seed: number, first: Seat, seat: Seat, activeId: string, stage1 = 1): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  return handFromDeck(state, seat, STAGE1, stage1);
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

function benchAt(state: GameState, seat: Seat, index: number): InPlayPokemon {
  const pokemon = state.players[seat].bench[index];
  if (pokemon === undefined) throw new Error(`${seat} has no bench[${String(index)}]`);
  return pokemon;
}

function handUidOf(state: GameState, seat: Seat, cardId: string): string {
  const uid = state.players[seat].hand.find((h) => state.cardIdByUid[h] === cardId);
  if (uid === undefined) throw new Error(`${seat} has no ${cardId} in hand`);
  return uid;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** TEST SURGERY: stamp `seat`'s ACTIVE as having come into play on the turn now
    being played — "the turn you play it", the half of the sentence a turn-1 board
    cannot show. Written as a stamp rather than as a scripted bench-play +
    promotion because the promotion needs a Switch this deck does not run; the
    resulting board is the one a Switch would produce (a Basic played this turn,
    now Active), which is a REAL, legal board. */
function stampPlayedThisTurn(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...side.active, turnPlayed: state.turn } },
    },
  };
}

function evolveActive(seat: Seat, uid: string) {
  return { type: "evolve", seat, uid, target: { spot: "active" } } as const;
}

const SEEDS = [7, 23, 41, 66, 90] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — the printed sentence, as data.
// ─────────────────────────────────────────────────────────────────────────────

describe("Eevee 'Boosted Evolution' — the three printings as registry data", () => {
  it("all THREE ids resolve to ONE program that is the licence and nothing else", () => {
    for (const id of BOOSTED_IDS) {
      // `toEqual` on the WHOLE program, not on the one field: a row that also grew
      // an `abilities` entry or an `attack` program would pass a field probe and
      // would be a different card.
      expect(programFor(id), id).toEqual({ passive: { evolveEarlyExempt: { activeOnly: true } } });
      // ⚠️ A `passive`, NOT an `abilities` entry — the printed sentence has no
      // "Once during your turn", nothing to activate and no cost.
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.attack, id).toBeUndefined();
      // …and NOT either of the two neighbouring first-turn flags, which is the
      // claim the registry's three adjacent rows make and one edit could break.
      expect(programFor(id)?.passive?.attackFirstTurnExempt, id).toBeUndefined();
      expect(programFor(id)?.trainerFirstTurnExempt, id).toBeUndefined();
    }
    // All three share ONE object (D8's reprint rule).
    expect(new Set(BOOSTED_IDS.map((id) => programFor(id))).size).toBe(1);
  });

  it("the fixtures carry the printed bytes VERBATIM — every scalar, not just the read ones", () => {
    for (const id of BOOSTED_IDS) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(BOOSTED_EVOLUTION_TEXT);
      expect(POOL[id]?.abilities?.[0]?.name, id).toBe("Boosted Evolution");
      expect(POOL[id]?.name, id).toBe("Eevee");
      // Every SCALAR off the D1 row. D277's Meloetta retreat was wrong at `2` for
      // a whole slice because nothing in that suite retreated — a claim no
      // assertion reads is not guarded by a green suite.
      expect(POOL[id]?.hp, id).toBe(50);
      expect(POOL[id]?.retreat, id).toBe(1);
      expect(POOL[id]?.stage, id).toBe("Basic");
      expect(POOL[id]?.evolveFrom, id).toBeNull();
      expect(POOL[id]?.types, id).toEqual(["Colorless"]);
      // ONE attack, at its printed index, with its printed cost/damage/effect.
      expect(POOL[id]?.attacks?.length, id).toBe(1);
      expect(POOL[id]?.attacks?.[0]?.name, id).toBe("Reckless Charge");
      expect(POOL[id]?.attacks?.[0]?.damage, id).toBe(30);
      expect(POOL[id]?.attacks?.[0]?.cost, id).toEqual(["Colorless", "Colorless"]);
      expect(POOL[id]?.attacks?.[0]?.effect, id).toBe(RECKLESS_CHARGE_TEXT);
    }
    // The CONTROL differs in the ABILITY and in nothing else — asserted, because
    // a control that quietly differs in name, hp or stage proves the wrong thing.
    // ⚠️ `?? []` and not `toBeUndefined()`: `battler` spreads a `blank` whose
    // `abilities` is an explicit null (D277's normalisation, reused).
    expect(POOL[UNLICENSED]?.abilities ?? []).toEqual([]);
    expect(POOL[UNLICENSED]?.name).toBe(POOL["sv08-143"]?.name);
    expect(POOL[UNLICENSED]?.hp).toBe(POOL["sv08-143"]?.hp);
    expect(POOL[UNLICENSED]?.stage).toBe(POOL["sv08-143"]?.stage);
    expect(POOL[UNLICENSED]?.types).toEqual(POOL["sv08-143"]?.types);
    // …and the chain the whole suite rests on really links.
    expect(POOL[STAGE1]?.evolveFrom).toBe("Eevee");
    expect(POOL[STAGE2]?.evolveFrom).toBe(POOL[STAGE1]?.name);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The fold — `passivesOf`, its ZONE gate, and the §9 channel it rides.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — `evolveEarlyExempt` in the passivesOf fold", () => {
  it("carries ONE UNCONDITIONAL entry for a licensed ACTIVE and NONE for one without", () => {
    // ⚠️ D279 CHANGED THIS FIELD'S SHAPE FROM A BOOLEAN TO A LIST, and these
    // assertions moved with it rather than being deleted. `[undefined]` is "one
    // live licence with NOTHING LEFT TO CHECK" — Eevee's zone clause was consumed
    // by the fold — and `toEqual` on the WHOLE list is deliberate: a probe like
    // `.length > 0` would stay green on a fold that pushed a stray condition.
    const licensed = board(SEEDS[0], "p1", "p1", "sv08-143");
    expect(passivesOf(licensed, activeOf(licensed, "p1")).evolveEarlyExempt).toEqual([undefined]);
    // Without this half every assertion in this file passes on a fold that always
    // pushes — D214's vacuous-guard shape.
    const plain = board(SEEDS[0], "p1", "p1", UNLICENSED);
    expect(passivesOf(plain, activeOf(plain, "p1")).evolveEarlyExempt).toEqual([]);
  });

  it("🛑 is EMPTY on the BENCH — the printed 'As long as this Pokémon is in the Active Spot'", () => {
    // THE CLAUSE THE FOLD RESOLVES, AND THE ONE A READ-SITE BUILD WOULD HAVE
    // DROPPED. The SAME card, the SAME board, one zone over.
    //
    // ⚠️ AND D279's MIRROR: this assertion is about EEVEE, whose sentence PRINTS
    // the Active-Spot clause. `stimulatedEvolution.test.ts` asserts the OPPOSITE
    // for Karrablast, which prints no such clause — the zone gate is per-printing
    // and this `it` must not be read as a fact about the field.
    let state = board(SEEDS[1], "p2", "p2", UNLICENSED);
    state = benchFromDeck(state, "p2", "sv08.5-074");
    const benched = benchAt(state, "p2", state.players.p2.bench.length - 1);
    expect(passivesOf(state, benched).evolveEarlyExempt).toEqual([]);
    // …and the control: the identical card IS licensed once it is the Active.
    const active = board(SEEDS[1], "p2", "p2", "sv08.5-074");
    expect(passivesOf(active, activeOf(active, "p2")).evolveEarlyExempt).toEqual([undefined]);
  });

  it("a LIST and not a boolean — D279's shape, and why the change was forced", () => {
    // 🛑 THIS `it` SAID THE OPPOSITE AT D278 AND IS KEPT RATHER THAN DELETED,
    // BECAUSE THE ARGUMENT IT RECORDS IS WHAT CHANGED. D278 folded to a boolean
    // on the ground that "two licensed sources say the same thing and no message
    // names one". That held while the only antecedent was about the HOLDER'S
    // ZONE, which the fold can answer. Karrablast's is about the SEAT'S BOARD,
    // and `passivesOf` has no seat — so the clause must survive the fold intact
    // and be evaluated at the read site, which is exactly `cantAttackUnless`'s
    // shape. The list is not provenance; it is UNFINISHED EVALUATION.
    const licensed = board(SEEDS[2], "p1", "p1", "svp-173");
    expect(Array.isArray(passivesOf(licensed, activeOf(licensed, "p1")).evolveEarlyExempt)).toBe(
      true,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The predicate — `evolveEarlyLicensed`, the ONE read five ban lines share.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — `evolveEarlyLicensed`, the extracted §4/§10 read", () => {
  it("licenses the Eevee and refuses the control — under BOTH going-order assignments", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const licensed = board(SEEDS[0], first, seat, "sv08-143");
        expect(evolveEarlyLicensed(licensed, seat, activeOf(licensed, seat)), `${first}/${seat}`).toBe(
          true,
        );
        const plain = board(SEEDS[0], first, seat, UNLICENSED);
        expect(evolveEarlyLicensed(plain, seat, activeOf(plain, seat)), `${first}/${seat}`).toBe(false);
      }
    }
  });

  it("🛑 a §9 ABILITY-LOCK SILENCES THE LICENCE AND HANDS BOTH BANS BACK", () => {
    // THE REASON THE FIELD RIDES `passivesOf` RATHER THAN BEING READ OFF `top`.
    // Klefki `sv01-096` "Mischievous Lock" darkens every Basic's Ability on both
    // boards while it is Active — and "Boosted Evolution" is a printed Ability on
    // a BASIC, so a locked Eevee may not evolve early after all. A build that read
    // the catalog row directly would be shorter and would get this wrong SILENTLY.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = board(SEEDS[1], first, first, "svp-173");
      // The control FIRST: without the lock the same board is licensed.
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `${first}`).toBe(true);
      state = setActiveFromDeck(state, second, "sv01-096");
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `${first}`).toBe(false);
      // …and the ban is really handed back at the handler, not only at the read.
      const uid = handUidOf(state, first, STAGE1);
      const result = applyAction(state, evolveActive(first, uid));
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. BAN 1 — §4's first-turn evolve ban, DRIVEN, both directions, every seed.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — BAN 1 (§4/§10 first turn) and its licence, through `evolve`", () => {
  it("REFUSES an unlicensed first-turn evolve with FIRST_TURN_EVOLVE — BOTH seats", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        // ⚠️ §4's EVOLVE ban binds BOTH seats (unlike §4's ATTACK ban, D277) — so
        // the case is driven on the seat whose turn it is under each assignment,
        // which is turn 1 for the going-first seat and turn 2 for the other.
        const second = first === "p1" ? "p2" : "p1";
        const t1 = board(seed, first, first, UNLICENSED);
        expect(t1.turn, `${seed}/${first}`).toBe(1);
        const r1 = applyAction(t1, evolveActive(first, handUidOf(t1, first, STAGE1)));
        expect(r1.ok, `${seed}/${first}`).toBe(false);
        if (r1.ok) throw new Error("expected a refusal");
        expect(r1.error.code, `${seed}/${first}`).toBe("FIRST_TURN_EVOLVE");

        const t2 = passTurns(board(seed, first, second, UNLICENSED), 1);
        expect(t2.turn, `${seed}/${first}`).toBe(2);
        const r2 = applyAction(t2, evolveActive(second, handUidOf(t2, second, STAGE1)));
        expect(r2.ok, `${seed}/${first}`).toBe(false);
        if (r2.ok) throw new Error("expected a refusal");
        expect(r2.error.code, `${seed}/${first}`).toBe("FIRST_TURN_EVOLVE");
      }
    }
  });

  it("ALLOWS the licensed first-turn evolve, and the Stage 1 really lands on the stack", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(seed, first, first, "sv08-143");
        const uid = handUidOf(state, first, STAGE1);
        const result = applyAction(state, evolveActive(first, uid));
        expect(result.ok, `${seed}/${first}`).toBe(true);
        if (!result.ok) throw new Error(result.error.code);
        // 🛑 NOT JUST `ok` — an `ok` that placed nothing would pass a gate test.
        const active = activeOf(result.state, first);
        expect(active.stack[active.stack.length - 1], `${seed}/${first}`).toBe(uid);
        // …and the licence is GONE the instant the Eevee stops being the top card,
        // which is what makes the "twice in one turn" half of ban 2 unobservable.
        expect(evolveEarlyLicensed(result.state, first, active), `${seed}/${first}`).toBe(false);
      }
    }
  });

  it("the ban still binds the OTHER seat's licensed body — the licence is per-BODY", () => {
    // A licensed Eevee on p2's board does not license p1's evolve, and vice versa:
    // the read takes the TARGET, so there is no seat-wide channel to leak through.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = board(SEEDS[3], first, first, UNLICENSED);
      state = setActiveFromDeck(state, second, "sv08-143");
      const result = applyAction(state, evolveActive(first, handUidOf(state, first, STAGE1)));
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. BAN 2 — "or the turn you play it". THE CASE THAT SEPARATES THE TWO BUILDS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — BAN 2 (§10 came into play this turn), the half turn 1 cannot show", () => {
  it("🛑 REFUSES an unlicensed body played THIS turn with EVOLVE_TOO_SOON, on a LATER turn", () => {
    for (const first of ["p1", "p2"] as const) {
      // Turn 3 — nobody's first turn, so BAN 1 is silent and only BAN 2 can speak.
      const state = stampPlayedThisTurn(passTurns(board(SEEDS[0], first, first, UNLICENSED), 2), first);
      expect(state.turn, `${first}`).toBe(3);
      expect(activeOf(state, first).turnPlayed, `${first}`).toBe(3);
      const result = applyAction(state, evolveActive(first, handUidOf(state, first, STAGE1)));
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("EVOLVE_TOO_SOON");
    }
  });

  it("🛑 ALLOWS the LICENSED body played THIS turn — the clause a one-ban build drops", () => {
    // 🛑 THE LOAD-BEARING CASE OF THE WHOLE SLICE. A build that wired the licence
    // into BAN 1 alone is green on every other assertion in this file — including
    // every turn-1 one, because a setup Pokémon carries `turnPlayed = 0` and
    // `0 >= 1` is false — and RED here, and only here.
    for (const first of ["p1", "p2"] as const) {
      const state = stampPlayedThisTurn(passTurns(board(SEEDS[0], first, first, "sv08-143"), 2), first);
      expect(state.turn, `${first}`).toBe(3);
      expect(activeOf(state, first).turnPlayed, `${first}`).toBe(3);
      const uid = handUidOf(state, first, STAGE1);
      const result = applyAction(state, evolveActive(first, uid));
      expect(result.ok, `${first}`).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      const active = activeOf(result.state, first);
      expect(active.stack[active.stack.length - 1], `${first}`).toBe(uid);
    }
  });

  it("🛑 BOTH bans fire at once on turn 1 for a body played turn 1, and ONE licence lifts BOTH", () => {
    // The board where the two bans OVERLAP — the going-first seat's turn 1 with a
    // body stamped this turn. The control reports BAN 1 (it is checked first); the
    // licensed body evolves anyway, which is only possible if BOTH were lifted.
    for (const first of ["p1", "p2"] as const) {
      const plain = stampPlayedThisTurn(board(SEEDS[4], first, first, UNLICENSED), first);
      expect(plain.turn, `${first}`).toBe(1);
      expect(activeOf(plain, first).turnPlayed, `${first}`).toBe(1);
      const r = applyAction(plain, evolveActive(first, handUidOf(plain, first, STAGE1)));
      expect(r.ok, `${first}`).toBe(false);
      if (r.ok) throw new Error("expected a refusal");
      expect(r.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");

      const licensed = stampPlayedThisTurn(board(SEEDS[4], first, first, "sv08.5-074"), first);
      expect(applyAction(licensed, evolveActive(first, handUidOf(licensed, first, STAGE1))).ok).toBe(
        true,
      );
    }
  });

  it("does NOT license a BENCHED body played this turn — the Active-Spot clause, at the handler", () => {
    // The fold's zone gate, driven through `evolve` rather than through
    // `passivesOf`: the same licensed card, on the bench, played this turn, on a
    // turn that is nobody's first. Ban 2 stands.
    let state = passTurns(board(SEEDS[2], "p1", "p1", UNLICENSED), 2);
    state = benchFromDeck(state, "p1", "sv08-143");
    const index = state.players.p1.bench.length - 1;
    const side = state.players.p1;
    const bench = [...side.bench];
    const benched = benchAt(state, "p1", index);
    bench[index] = { ...benched, turnPlayed: state.turn };
    state = { ...state, players: { ...state.players, p1: { ...side, bench } } };
    const result = applyAction(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, "p1", STAGE1),
      target: { spot: "bench", index },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("EVOLVE_TOO_SOON");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE OTHER THREE BAN LINES — `rareCandy` and its HUD projection.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — the licence DOES NOT reach the Rare Candy sites (§7.1)", () => {
  /** A Rare Candy board: `seat`'s Active is `activeId`, with a Rare Candy and the
      bridging Stage 2 in hand. ⚠️ The Stage 1 must be in the POOL for
      `stage2EvolvesFromBasic` to bridge — it is, and both decks run it. */
  function candyBoard(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
    let state = board(seed, first, seat, activeId);
    state = handFromDeck(state, seat, "sv01-191", 1);
    return handFromDeck(state, seat, STAGE2, 1);
  }

  function candyAction(state: GameState, seat: Seat) {
    return {
      type: "rareCandy",
      seat,
      uid: handUidOf(state, seat, "sv01-191"),
      evolutionUid: handUidOf(state, seat, STAGE2),
      target: { spot: "active" },
    } as const;
  }

  it("🛑 REFUSES a first-turn Rare Candy on a LICENSED Eevee — the card's OWN restriction", () => {
    // 🛑 THE DECISION THIS SLICE MADE AND WROTE DOWN, PINNED SO THE NEXT SLICE
    // ARGUES WITH A TEST RATHER THAN WITH A COMMENT. Rare Candy prints its own
    // two-clause restriction — *"You can't use this card during your first turn or
    // on a Basic Pokémon that was put into play this turn."* — which COINCIDES
    // with §4/§10 but is not inherited from it. An Ability printed on the TARGET
    // cannot lift a restriction printed on a DIFFERENT card about its own use, so
    // the licence stops at `evolve`. ⚠️ AND THE CHOICE IS UNOBSERVABLE IN THE REAL
    // CATALOG (census rung 4: no Standard Stage 2 chains from Eevee), which is
    // exactly why it is driven here off a LOCAL chain — an unreachable decision
    // that no test pins is a decision nobody can ever find.
    for (const first of ["p1", "p2"] as const) {
      const licensed = candyBoard(SEEDS[0], first, first, "sv08-143");
      // The control FIRST: the very same body IS licensed for a plain `evolve` on
      // this very board, so the refusal below is about the CARD and not the body.
      expect(evolveEarlyLicensed(licensed, first, activeOf(licensed, first)), `${first}`).toBe(true);
      expect(applyAction(licensed, evolveActive(first, handUidOf(licensed, first, STAGE1))).ok).toBe(
        true,
      );
      const refused = applyAction(licensed, candyAction(licensed, first));
      expect(refused.ok, `${first}`).toBe(false);
      if (refused.ok) throw new Error("expected a refusal");
      expect(refused.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");
    }
  });

  it("🛑 REFUSES Rare Candy on a LICENSED body played THIS turn, on a later turn too", () => {
    // Ban 2's half of the same decision: the licence lifts it at `evolve` on this
    // exact board (asserted first, so this is a difference between SITES and not
    // between boards) and does not lift it here.
    for (const first of ["p1", "p2"] as const) {
      const state = stampPlayedThisTurn(
        passTurns(candyBoard(SEEDS[1], first, first, "svp-173"), 2),
        first,
      );
      expect(state.turn, `${first}`).toBe(3);
      expect(applyAction(state, evolveActive(first, handUidOf(state, first, STAGE1))).ok).toBe(true);
      const refused = applyAction(state, candyAction(state, first));
      expect(refused.ok, `${first}`).toBe(false);
      if (refused.ok) throw new Error("expected a refusal");
      expect(refused.error.code, `${first}`).toBe("EVOLVE_TOO_SOON");
    }
  });

  it("`rareCandyOptions` MIRRORS the handler — no option on turn 1, licensed or not", () => {
    // THE PROJECTION THAT MUST NOT DRIFT. It agrees with the handler by keeping
    // the seat-wide early return, which is only correct while the handler ignores
    // the licence — so this case is the one that reddens if a future slice moves
    // one of the two and forgets the other (D277's payability-sites lesson).
    for (const first of ["p1", "p2"] as const) {
      const plain = candyBoard(SEEDS[2], first, first, UNLICENSED);
      expect(rareCandyOptions(plain, first), `${first}`).toEqual([]);
      const licensed = candyBoard(SEEDS[2], first, first, "sv08-143");
      expect(rareCandyOptions(licensed, first), `${first}`).toEqual([]);
    }
  });

  it("…and OFFERS the option once BOTH bans are genuinely clear — the non-vacuous control", () => {
    // 🛑 WITHOUT THIS, THE THREE `toEqual([])` ASSERTIONS ABOVE ARE VACUOUS: a
    // projection that returned `[]` for every board would satisfy all of them, and
    // an assertion that can only fail by GROWING is the shape that hides a missed
    // branch. This board differs from the ones above ONLY in the turn number.
    const state = passTurns(candyBoard(SEEDS[3], "p1", "p1", "sv08-143"), 2);
    expect(state.turn).toBe(3);
    const options = rareCandyOptions(state, "p1");
    expect(options.length).toBe(1);
    expect(options[0]?.target).toEqual({ spot: "active" });
    // ⚠️ A CONTAINMENT ASSERTION AND A TYPE ONE, not `toEqual` on a literal list:
    // two turns of draws can put a SECOND copy of the Stage 2 in hand, and a
    // suite that pinned the exact list would be seed-fragile for a reason that
    // has nothing to do with this rule. Both halves still fail by SHRINKING.
    expect(options[0]?.stage2Uids).toContain(handUidOf(state, "p1", STAGE2));
    for (const uid of options[0]?.stage2Uids ?? []) {
      expect(state.cardIdByUid[uid]).toBe(STAGE2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE LICENCE IS NOT A GENERAL PERMIT — the sweep that bounds it.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — what the licence does NOT do", () => {
  it("leaves the §10 EVOLVE_MISMATCH rule alone — it lifts TIMING and nothing else", () => {
    // A licensed Eevee still cannot be evolved by a card that does not evolve
    // FROM it. The licence widens WHEN, never WHAT — a build that returned early
    // on `licensed` would pass every timing case above and fail here.
    const state = board(SEEDS[0], "p1", "p1", "sv08-143");
    const wrong = handFromDeck(state, "p1", STAGE2, 1);
    const result = applyAction(wrong, evolveActive("p1", handUidOf(wrong, "p1", STAGE2)));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("EVOLVE_MISMATCH");
  });

  it("does not license the seat's OTHER bodies — an unlicensed bench body is still too soon", () => {
    let state = passTurns(board(SEEDS[1], "p1", "p1", "sv08-143"), 2);
    state = benchFromDeck(state, "p1", UNLICENSED);
    const index = state.players.p1.bench.length - 1;
    const side = state.players.p1;
    const bench = [...side.bench];
    const benched = benchAt(state, "p1", index);
    bench[index] = { ...benched, turnPlayed: state.turn };
    state = { ...state, players: { ...state.players, p1: { ...side, bench } } };
    const result = applyAction(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, "p1", STAGE1),
      target: { spot: "bench", index },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("EVOLVE_TOO_SOON");
  });

  it("still refuses a body that already evolved this turn — ban 2's OTHER rule survives", () => {
    // `turnPlayed >= state.turn` encodes "came into play this turn" AND "already
    // evolved this turn". Evolving REPLACES the top card, so the Eevee's licence
    // dies with the step that stamps the field — and the second evolve is refused
    // on a board where the first was legal. This is the conflation being harmless
    // rather than resolved, pinned so a future split has a case to point at.
    const state = board(SEEDS[0], "p1", "p1", "sv08-143", 2);
    const first = handUidOf(state, "p1", STAGE1);
    const evolved = must(applyAction(state, evolveActive("p1", first)));
    const second = state.players.p1.hand.filter((h) => state.cardIdByUid[h] === STAGE1)[1];
    if (second === undefined) throw new Error("expected a second Stage 1 in hand");
    const result = applyAction(evolved, evolveActive("p1", second));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // EVOLVE_MISMATCH, not EVOLVE_TOO_SOON: the top card is now the Stage 1, and
    // nothing in this deck evolves from it. Recorded as what it IS rather than as
    // what the rule is named — the second evolve is refused either way.
    expect(result.error.code).toBe("EVOLVE_MISMATCH");
  });
});
