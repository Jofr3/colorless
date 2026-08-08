import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { firstTurnAttackBanned, passivesOf } from "./continuous";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, programFor, redactGame } from "./index";
import { isFirstTurnOf } from "./types";
import {
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deckOf,
  battler,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// 0.190.0 → 0.191.0 — D277, THE §4 ATTACK LICENCE. `trainerFirstTurnExempt`'s
// ATTACK twin, named as owed since D230 and built here on the ONE printing whose
// sentence is about the BODY rather than about one attack.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CENSUS — `%during your first turn%`, the ladder, RUNG BY RUNG.
// ─────────────────────────────────────────────────────────────────────────────
//
// The handoff sent this slice to find a SECOND CONSUMER of
// `BoardCondition.yourFirstTurn` (D275), on the reasoning that D275 had measured
// the phrase only far enough to find its own row. The ladder was run against the
// remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a, 3,786 rows) on
// 2026-08-08, at `legal_standard = 1`, over ALL THREE text columns.
//
//   RUNG 1 — GLOB '*during your first turn*'
//     abilities_json 15 · attacks_json 13 · effect 8  =  36 printings
//                                                        15 names
//                                                        15 distinct column texts
//                                                        10 distinct first-turn CLAUSES
//   RUNG 2 — GLOB '*your first turn*' MINUS rung 1
//     abilities_json 0 · attacks_json 0 · effect 0    =  ZERO
//
// ⚠️ **THE NAME AND SENTENCE COUNTS WERE RE-DERIVED AND THE INHERITED PAIR WAS
// WRONG BOTH TIMES.** An earlier pass at this ladder recorded "14 names and 8
// sentences"; `COUNT(DISTINCT name)` returns **15**, and `COUNT(DISTINCT <col>)`
// per column returns 6 · 5 · 4 = **15** full texts, which collapse to **10**
// distinct first-turn clauses once the reprint pairs that share one clause are
// merged (Volbeat+Exeggcute, Illumise+Scream Tail ex, Carmine+Proton, Call
// Bell+Chill Teaser Toy, Karrablast+Shelmet modulo the partner name). A census
// whose group table lists 15 rows and whose prose says 14 is not a census.
//
// 🛑 **RUNG 2 IS AN EMPTY SET, WHICH IS ITSELF THE ANSWER TO A QUESTION THE
// HANDOFF ASKED**: the phrase is spelled EXACTLY ONE WAY in this pool, so rung 1
// is the whole population and no third rung exists. (Reported because a rung that
// returns nothing is a measurement, not a dead end — D276's `coinFlipGate.otherwise`
// zero is the same shape.)
//
// The 36, GROUPED BY NAME and split CARD-read vs BOARD-read the way D265 split
// its own — and every one re-queried rather than carried:
//
//   ABILITY column (15)
//     3  Eevee            sv08-143/sv08.5-074/svp-173  "…it can EVOLVE during your first turn…"
//     3  Eevee ex         sv08.5-075 +2                REMINDER TEXT — a false positive
//     3  Meloetta ex      sv10.5b-044/-159/-167        "…this Pokémon can use ATTACKS…"  ← THIS ROW
//     2  Karrablast       sv10.5b-009 +1               "…it can EVOLVE…" (partner-gated)
//     2  Shelmet          sv10.5w-008 +1               "…it can EVOLVE…" (partner-gated)
//     2  Fan Rotom        sv07-118/sv08.5-085          BUILT (D275) — the only BARE gate
//   ATTACK column (13)
//     7  Terapagos ex     sv07-128 +6   "If you go SECOND, you CAN'T use this attack…"
//     2  Scream Tail ex   sv06-094 +1   "…only if you go second, and only during…"
//     2  Exeggcute        sv08-001 +1   "If you go first, you can use THIS ATTACK…"
//     1  Illumise         sv06-010      "…only if you go second, and only during…"
//     1  Volbeat          sv06-009      "If you go first, you can use THIS ATTACK…"
//   EFFECT column (8)
//     4  Carmine          sv06-145 +3   BUILT (D223) — `trainerFirstTurnExempt`
//     2  T. Rocket's Proton sv10-177 +1 BUILT (D224) — the same flag
//     1  Call Bell        sv08-165      "…only if you go second, and only during…"
//     1  Chill Teaser Toy sv08-166      "…only if you go second, and only during…"
//
// 🛑 **AND THE CENSUS SAYS THE SLICE IT WAS SENT ON DOES NOT EXIST. THERE IS NO
// SECOND CONSUMER OF `BoardCondition.yourFirstTurn` IN THIS POOL.** Fan Rotom's
// *"Once during your first turn"* is the ONLY bare gate among the 36. Every other
// printing is one of three other things:
//   (a) an EXEMPTION that LIFTS a §4 ban rather than IMPOSING one — this row, plus
//       the seven evolve-licence printings (Eevee 3, Karrablast 2, Shelmet 2). A
//       `playableIf` cannot spell a licence: `conditionHolds` narrows what may be
//       done, and these sentences WIDEN it. **The member is a refusal; these are
//       permissions, and the two do not share a field.**
//   (b) qualified by a GOING-ORDER clause the member cannot spell — "only if you
//       go second, and only during your first turn" (5 printings). That is a
//       CONJUNCTION over a `goingSecond` predicate this vocabulary does not have,
//       and `BoardCondition` has no `allOf` member (nor a `not` — effects.ts says
//       why). Naming it precisely: **the missing mechanism is a going-order
//       predicate, not a first-turn one.**
//   (c) reminder text restating the standard rule (Eevee ex, 3) — a false positive
//       the phrase match cannot tell from a real clause, and the reason this
//       census reads SENTENCES rather than counting rows.
//
// **`BoardCondition.yourFirstTurn`'s POPULATION IS STILL 2 AND THE PHRASE'S IS 36.**
// ⚠️ THAT ALSO CORRECTS A CLAIM IN THE SHIPPED TREE: `yourFirstTurn`'s own doc
// block in effects.ts called Fan Rotom's 2 printings *"the whole population of
// `%during your first turn%` this engine can spell"*. It was true of the MEMBER
// and false of the PHRASE, and D275 wrote it having measured only far enough to
// find its own row. The doc block is corrected in this slice's diff.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT WAS BUILT, AND WHY THIS PRINTING RATHER THAN THE BIGGER GROUPS.
// ─────────────────────────────────────────────────────────────────────────────
//
// Of the 36, twelve are already built (Fan Rotom 2, Carmine 4, Proton 2 — and the
// remaining 3 Eevee ex are reminder text with nothing to build). Of the 21 left,
// the groups rank 7 (Terapagos ex) · 3 (Eevee) · 3 (Meloetta ex) · 2+2 (Karrablast /
// Shelmet) · 2 (Exeggcute) · 2 (Scream Tail ex) · 1+1+1 (Illumise, Call Bell,
// Chill Teaser Toy). **THE BIGGEST GROUP IS NOT THE CHEAPEST ROW**, which is
// D238's rule restated, and each refusal below NAMES its missing mechanism:
//
//   • **Terapagos ex (7) — REFUSED.** Two mechanisms, not one. The gate is the
//     going-order predicate of (b) above, and the attack it gates is
//     *"30 damage for each of your Benched Pokémon"* beside a second attack that
//     prevents damage from a FILTERED attacker class. Biggest group, biggest row.
//   • **Eevee (3) — BUILT AT D278. Karrablast / Shelmet (4) — STILL REFUSED.**
//     *"it can evolve during your first turn OR THE TURN YOU PLAY IT"* lifts TWO
//     bans at once, and D278 confirmed the count by reading the handler: §4/§10's
//     first-turn evolve ban (`isFirstTurnOf`) and §10's `turnPlayed >= state.turn`
//     summoning sickness — ⚠️ **BOTH IN `evolve`, turn.ts.** An earlier version of
//     this paragraph said *"cardplay.ts"*; that file carries only RARE CANDY's
//     pair, which D278 established is a DIFFERENT rule (Rare Candy prints its own
//     restriction) and which the licence deliberately does not reach. A licence
//     that lifts one ban is a card that is wrong in the quiet direction.
//     ⚠️ **AND A SECOND CORRECTION**: this paragraph said Karrablast/Shelmet's
//     partner gate was *"`yourBenchHasNamed`'s sentence on a field that does not
//     exist"*. **The member DOES exist** (effects.ts, Falinks `sv06-160`) and is
//     **BENCH-ONLY by construction** — its doc block refuses the Active Spot
//     because the printed word is "Bench". These four print **"in play"**, so the
//     gap is a SECOND member (`yourNamedPokemonInPlay`), not a wider reading of
//     the first. **That is the next row on this phrase.**
//   • **Volbeat (1) / Exeggcute (2) — REFUSED, AND THE REASON IS A SHAPE.** Their
//     licence (one shared clause, "If you go first, you can use THIS ATTACK during
//     your first turn.") names an ATTACK INDEX where Meloetta ex's names the BODY,
//     so it wants a PER-INDEX field beside `CardProgram.attack`, not this row's
//     per-BODY one. ⚠️ **AN INHERITED VERSION OF THIS PARAGRAPH ARGUED IT FROM A
//     BODY COUNT AND THE BODY COUNT IS FALSE**: Volbeat does carry a second attack
//     ("Coordinated Strike") the licence must not reach, but **Exeggcute carries
//     exactly ONE attack on BOTH printings** (`json_array_length(attacks_json)`
//     = 1 for `sv08-001` and `sv08-192`). The referent is the argument; the
//     layout is an accident, and a per-body flag on Exeggcute would be
//     indistinguishable today and wrong on the first reprint that adds an attack.
//     Exeggcute is doubly blocked anyway: *"search your deck for a card that
//     evolves from this Pokémon and put it onto this Pokémon to evolve it"* needs
//     a `searchDeck` destination that EVOLVES A NAMED BODY, and the `dest` union
//     has no such value.
//   • **Illumise / Scream Tail ex / Call Bell / Chill Teaser Toy (5) — REFUSED on
//     the going-order predicate of (b), and each also on its own second half.**
//
// **THAT LEAVES MELOETTA EX**, whose sentence — *"If you go first, this Pokémon can
// use attacks during your first turn."* — is a licence on the BODY, lifts exactly
// ONE ban, and needs no vocabulary this engine lacks.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PRICE, RE-DERIVED.
// ─────────────────────────────────────────────────────────────────────────────
//
// ONE `PassiveEffects` boolean (`attackFirstTurnExempt`), ONE term in the
// `passivesOf` fold, ONE new `continuous.ts` predicate (`firstTurnAttackBanned`)
// and THREE call sites re-pointed at it. **THE THIRD SITE IS THE POINT.**
// `state.turn === 1` was spelled as a LITERAL in three places — `attack.ts`'s §8
// gate, `redact.ts`'s `banned` and `GameHud`'s `firstTurnBan` — and a licence wired
// into two of them is a live bug in the third with NO type error to announce it.
// The expression is now extracted and read three times (D276's extract-don't-copy
// rule, applied to a comparison rather than to a traversal).
//
// ⚠️ **`state.turn === 1` IS NOT `isFirstTurnOf`, AND UNIFYING THEM WOULD INVENT A
// BAN.** §4 forbids the going-FIRST player from attacking on their first turn and
// says nothing about the going-second player's, which is turn 2. `isFirstTurnOf`
// is TRUE at turn 2 for that seat. §3 below drives the difference rather than
// asserting it in prose, because the two predicates agree on every board except
// exactly one and that board is the whole content of the distinction.
//
// ⚠️ **THE ROW IS THE ABILITY AND NOT THE CARD.** Meloetta ex's only attack,
// "Echoed Voice", prints *"During your next turn, this Pokémon's Echoed Voice
// attack does 80 more damage"* — REFUSED, and the missing mechanism named: a
// per-body, per-ATTACK-NAME, next-turn damage stamp. `InPlayPokemon` carries two
// per-body attack stamps (`attackLockedTurn`, `lockedAttacks`) and both are
// PROHIBITIONS. The printed 30 still resolves from the catalog with the effect
// skipped, which is what makes the licence drivable without it.

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** The printed text, once, byte-for-byte, shared by all three printings. */
const DEBUT_PERFORMANCE_TEXT =
  "If you go first, this Pokémon can use attacks during your first turn.";

/** The attack's printed text — carried so the fixture is the card, and so the
    REFUSAL above is visible to anyone reading the fixture rather than the note. */
const ECHOED_VOICE_TEXT =
  "During your next turn, this Pokémon's Echoed Voice attack does 80 more damage (before applying Weakness and Resistance).";

const DEBUT_IDS = ["sv10.5b-044", "sv10.5b-159", "sv10.5b-167"] as const;

/** A Meloetta ex printing, carrying the catalog's OWN hp (200), type
    (`Psychic`), retreat (1) and attack cost ({P}) — read off the D1 row rather
    than invented. The ids are REAL, so `programFor` resolves the shipped
    `DEBUT_PERFORMANCE` row rather than a stand-in.
    ⚠️ **THE RETREAT WAS `2` UNTIL THE ROW WAS RE-QUERIED AND THE CARD SAYS `1`.**
    Nothing in this suite retreats, so it was invisible — which is exactly why a
    fixture that claims to BE the printing gets every scalar re-read, not just the
    ones the assertions happen to touch (D146). */
function meloetta(id: string): Card {
  return battler(id, {
    name: "Meloetta ex",
    hp: 200,
    retreat: 1,
    types: ["Psychic"],
    abilities: [{ type: "Ability", name: "Debut Performance", effect: DEBUT_PERFORMANCE_TEXT }],
    attacks: [
      { cost: ["Psychic"], name: "Echoed Voice", damage: 30, effect: ECHOED_VOICE_TEXT },
    ],
  });
}

/** The CONTROL body: same type, same attack cost, same printed damage, NO
    Ability. 🛑 **THE SUITE IS VACUOUS WITHOUT IT** — every "the licence works"
    assertion below passes just as happily on a build that deleted the §4 ban
    outright, and this body is the only thing that can tell the two apart. */
const UNLICENSED = "fix-unlicensed";

const LOCAL_CARDS: Record<string, Card> = {
  "sv10.5b-044": meloetta("sv10.5b-044"),
  "sv10.5b-159": meloetta("sv10.5b-159"),
  "sv10.5b-167": meloetta("sv10.5b-167"),
  [UNLICENSED]: battler(UNLICENSED, {
    name: "Unlicensed Singer",
    hp: 200,
    retreat: 1,
    types: ["Psychic"],
    attacks: [{ cost: ["Psychic"], name: "Echoed Voice", damage: 30 }],
  }),
  "fix-psy-energy": typedEnergy("fix-psy-energy", "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The TWELFTH seeded deck (D270's rule: a seeded suite gets its own deck). */
const DEBUT_DECK = deckOf({
  "sv10.5b-044": 4,
  "sv10.5b-159": 4,
  "sv10.5b-167": 4,
  [UNLICENSED]: 4,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-basic-1": 4,
  "fix-psy-energy": 20,
  "fix-energy": 18,
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

/** D275's `localSetup` verbatim in shape: the FIRST PLAYER is a PARAMETER, so
    every assertion below can be made from BOTH seats under BOTH assignments.
    ⚠️ A ONE-SEAT BOARD IS VACUOUS ON A PER-SEAT FACT, and "turn 1 belongs to the
    going-first player" is exactly such a fact. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DEBUT_DECK, p2: DEBUT_DECK }, cardPool: POOL });
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

/** A board at turn 1 with `seat`'s Active set to `activeId`, ONE {P} attached
    (so the cost is payable and a refusal can only be the §4 ban) and a benched
    body behind it.
    ⚠️ THE BENCH BODY IS LOAD-BEARING — §14.2 makes an empty Bench a LOSS the
    moment the Active leaves, and a `gameOver` board proves nothing about a gate. */
function board(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  return attachFromDeck(state, seat, "fix-psy-energy", 1);
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

const SEEDS = [7, 23, 41, 66, 90] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — the printed sentence, as data.
// ─────────────────────────────────────────────────────────────────────────────

describe("Meloetta ex — the three printings as registry data", () => {
  it("all THREE ids resolve to ONE program that is the licence and nothing else", () => {
    for (const id of DEBUT_IDS) {
      // `toEqual` on the WHOLE program, not on the one field: a row that also
      // grew an `abilities` entry or an `attack` program would pass a field probe
      // and would be a different card.
      expect(programFor(id), id).toEqual({ passive: { attackFirstTurnExempt: true } });
      // ⚠️ A `passive`, NOT an `abilities` entry — the printed sentence has no
      // "Once during your turn", nothing to activate and no cost. POWER_SAVER's
      // classification, mirrored.
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.attack, id).toBeUndefined();
      // …and NOT the Trainer-side flag, which is the twin this row is NOT.
      expect(programFor(id)?.trainerFirstTurnExempt, id).toBeUndefined();
    }
    // All three share ONE object (D8's reprint rule).
    expect(new Set(DEBUT_IDS.map((id) => programFor(id))).size).toBe(1);
  });

  it("the fixtures carry the printed bytes VERBATIM, and the REFUSED attack too", () => {
    for (const id of DEBUT_IDS) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(DEBUT_PERFORMANCE_TEXT);
      expect(POOL[id]?.name, id).toBe("Meloetta ex");
      // Every SCALAR off the D1 row, not just the ones the assertions use — the
      // retreat was wrong at `2` for a whole slice because nothing here retreats.
      expect(POOL[id]?.hp, id).toBe(200);
      expect(POOL[id]?.retreat, id).toBe(1);
      expect(POOL[id]?.stage, id).toBe("Basic");
      expect(POOL[id]?.types, id).toEqual(["Psychic"]);
      // ONE attack on the printing — the count the per-index refusal above turns
      // on for Exeggcute, pinned here for the card this row IS.
      expect(POOL[id]?.attacks?.length, id).toBe(1);
      // The attack whose effect this slice REFUSES is present with its printed
      // text, so the refusal is visible at the fixture rather than only in a note.
      expect(POOL[id]?.attacks?.[0]?.effect, id).toBe(ECHOED_VOICE_TEXT);
    }
    // The CONTROL body is the same card minus the Ability — asserted, because a
    // control that quietly differs in cost or type proves the wrong thing.
    // ⚠️ `null`, not `undefined` — `battler` spreads a `blank` whose `abilities`
    // is an explicit null, and a `toBeUndefined()` here goes red on a fixture that
    // is perfectly correct. Normalised rather than loosened.
    expect(POOL[UNLICENSED]?.abilities ?? []).toEqual([]);
    expect(POOL[UNLICENSED]?.attacks?.[0]?.cost).toEqual(POOL["sv10.5b-044"]?.attacks?.[0]?.cost);
    expect(POOL[UNLICENSED]?.types).toEqual(POOL["sv10.5b-044"]?.types);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The fold — `passivesOf`, and the §9 channel it rides.
// ─────────────────────────────────────────────────────────────────────────────

describe("D277 — `attackFirstTurnExempt` in the passivesOf fold", () => {
  it("is TRUE for a licensed body and FALSE for one without — the attribution control", () => {
    const licensed = board(SEEDS[0], "p1", "p1", "sv10.5b-044");
    expect(passivesOf(licensed, activeOf(licensed, "p1")).attackFirstTurnExempt).toBe(true);
    // Without this half every assertion in this file passes on a fold that hard
    // codes `true` — D214's vacuous-guard shape.
    const plain = board(SEEDS[0], "p1", "p1", UNLICENSED);
    expect(passivesOf(plain, activeOf(plain, "p1")).attackFirstTurnExempt).toBe(false);
  });

  it("a BOOLEAN and not a list — two licensed sources say the same thing", () => {
    // The shape argument, driven: `cantAttackUnless` COLLECTS because a message
    // must name one condition; this field has no message and no provenance, so it
    // is an OR. A licensed body with a second licensed source still reads `true`,
    // and there is nothing a read site could have wanted a list for.
    const licensed = board(SEEDS[1], "p2", "p2", "sv10.5b-159");
    expect(typeof passivesOf(licensed, activeOf(licensed, "p2")).attackFirstTurnExempt).toBe(
      "boolean",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The predicate — `firstTurnAttackBanned`, and the one board where the
//    WRONG reader disagrees with it.
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️ **D281 WIDENED `firstTurnAttackBanned` WITH AN ATTACK INDEX** — a second
// licence for the same §4 ban is printed on ONE ATTACK (Volbeat `sv06-009`,
// Exeggcute `sv08-001`/`-192`) instead of as an Ability on the body. Every call
// below therefore carries a trailing `0`, and every one of them is UNAFFECTED by
// it: none of these bodies carries an `attackGate`, so the new arm returns
// undefined and the passive read one line up decides, exactly as it did at D277.
// That is the point of asserting it here rather than only in the new suite — the
// widening had to leave the whole-body licence answering identically.
describe("D277 — `firstTurnAttackBanned`, the extracted §4 read", () => {
  it("bans an unlicensed body on turn 1 and licenses the Meloetta — under BOTH assignments", () => {
    for (const first of ["p1", "p2"] as const) {
      const plain = board(SEEDS[0], first, first, UNLICENSED);
      expect(plain.turn, `${first}`).toBe(1);
      expect(firstTurnAttackBanned(plain, activeOf(plain, first), 0), `${first}`).toBe(true);
      const licensed = board(SEEDS[0], first, first, "sv10.5b-044");
      expect(firstTurnAttackBanned(licensed, activeOf(licensed, first), 0), `${first}`).toBe(false);
    }
  });

  it("🛑 IS NOT `isFirstTurnOf` — turn 2 is the going-SECOND seat's first turn and is FREE", () => {
    // 🛑 THE ONE BOARD THE TWO PREDICATES DISAGREE ON, AND THE WHOLE CONTENT OF
    // THE DISTINCTION. §4 bans the going-FIRST player from attacking on their
    // first turn ONLY. A build that unified this read with the §4 EVOLVE ban's
    // `isFirstTurnOf` would answer TRUE here and refuse a perfectly legal turn-2
    // attack — a rule nobody printed, on the seat that is already behind.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      const turn2 = passTurns(board(SEEDS[2], first, second, UNLICENSED), 1);
      expect(turn2.turn, `${first}`).toBe(2);
      // The wrong reader says the ban applies…
      expect(isFirstTurnOf(turn2, second), `${first}`).toBe(true);
      // …and the right one says it does not, on an UNLICENSED body so the licence
      // cannot be what is doing the work.
      expect(firstTurnAttackBanned(turn2, activeOf(turn2, second), 0), `${first}`).toBe(false);
    }
  });

  it("is FALSE for every body from turn 2 onward — the licence changes nothing there", () => {
    for (const activeId of [UNLICENSED, "sv10.5b-167"]) {
      let state = board(SEEDS[3], "p1", "p1", activeId);
      for (let turn = 2; turn <= 6; turn += 1) {
        state = passTurns(state, 1);
        expect(state.turn, `${activeId}@${turn}`).toBe(turn);
        const seat = state.phase.kind === "turn:action" ? state.phase.seat : "p1";
        expect(
          firstTurnAttackBanned(state, activeOf(state, seat), 0),
          `${activeId}@${turn}`,
        ).toBe(false);
      }
    }
  });

  it("takes NO seat — it is a fact about the turn number and about the body", () => {
    // Both seats' bodies are asked on the SAME turn-1 board and answer about
    // THEMSELVES: the going-first seat's unlicensed Active is banned, and so is
    // the off-turn seat's — the predicate never had a seat to get wrong. (The
    // off-turn answer is unreachable from `attack`, whose turn gate runs first;
    // it is asserted because `redactGame` asks it for the non-turn viewer.)
    // ⚠️ BOTH Actives are set explicitly. The setup places whatever Basic the
    // shuffle dealt, and this deck contains Meloetta — so an unset opponent Active
    // makes this case answer about a card the test did not choose. (It did, on
    // seed 90, which is how the line was found.)
    let state = board(SEEDS[4], "p1", "p1", UNLICENSED);
    state = setActiveFromDeck(state, "p2", UNLICENSED);
    expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 0)).toBe(true);
    expect(firstTurnAttackBanned(state, activeOf(state, "p2"), 0)).toBe(true);
    const licensed = setActiveFromDeck(state, "p2", "sv10.5b-044");
    expect(firstTurnAttackBanned(licensed, activeOf(licensed, "p2"), 0)).toBe(false);
    expect(firstTurnAttackBanned(licensed, activeOf(licensed, "p1"), 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The §8 gate — DRIVEN, both directions, every seed.
// ─────────────────────────────────────────────────────────────────────────────

describe("D277 — the §4 ban and its licence, driven through `attack`", () => {
  it("REFUSES an unlicensed turn-1 attack with FIRST_TURN_ATTACK and spends nothing", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(seed, first, first, UNLICENSED);
        const result = applyAction(state, { type: "attack", seat: first, index: 0 });
        expect(result.ok, `${seed}/${first}`).toBe(false);
        if (result.ok) throw new Error("expected a refusal");
        expect(result.error.code, `${seed}/${first}`).toBe("FIRST_TURN_ATTACK");
      }
    }
  });

  it("ALLOWS the licensed turn-1 attack, and the damage really lands", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const second = first === "p1" ? "p2" : "p1";
        const state = board(seed, first, first, "sv10.5b-044");
        const before = activeOf(state, second).damage;
        const result = applyAction(state, { type: "attack", seat: first, index: 0 });
        expect(result.ok, `${seed}/${first}`).toBe(true);
        if (!result.ok) throw new Error(result.error.code);
        // 🛑 NOT JUST `ok` — an `ok` that dealt no damage would pass a gate test
        // and would mean the declaration was swallowed. The printed 30 lands even
        // though the attack's own EFFECT is refused (see the header).
        expect(activeOf(result.state, second).damage, `${seed}/${first}`).toBeGreaterThan(before);
      }
    }
  });

  it("the licence is spent on TURN 1 ONLY — it is not a general attack permit", () => {
    // The mirror of §3's turn sweep, driven: the same body attacks legally on its
    // own later turns for reasons that have nothing to do with this field, so a
    // build that made the flag mean "may always attack" is indistinguishable here
    // — which is why the REFUSAL case above is the load-bearing half and this one
    // only pins that the licence broke nothing.
    const state = passTurns(board(SEEDS[0], "p1", "p1", "sv10.5b-159"), 2);
    expect(state.turn).toBe(3);
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("🛑 a §9 ABILITY-LOCK SILENCES THE LICENCE AND HANDS THE §4 BAN BACK", () => {
    // THE REASON THE FIELD RIDES `passivesOf` RATHER THAN BEING READ OFF `top`.
    // Klefki `sv01-096` "Mischievous Lock" darkens every Basic's Ability on both
    // boards while it is Active — and "Debut Performance" is a printed Ability, so
    // a licensed Meloetta under the lock may not attack on turn 1 after all.
    // A build that read the catalog row directly would be shorter and would get
    // this wrong SILENTLY.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = board(SEEDS[1], first, first, "sv10.5b-167");
      // The control FIRST: without the lock the same board is licensed.
      expect(firstTurnAttackBanned(state, activeOf(state, first), 0), `${first}`).toBe(false);
      state = setActiveFromDeck(state, second, "sv01-096");
      expect(firstTurnAttackBanned(state, activeOf(state, first), 0), `${first}`).toBe(true);
      const result = applyAction(state, { type: "attack", seat: first, index: 0 });
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("FIRST_TURN_ATTACK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The OTHER TWO READ SITES — the projections that must not drift.
// ─────────────────────────────────────────────────────────────────────────────

describe("D277 — the three payability projections of ONE rule", () => {
  it("`redactedAttacksOf` greys the unlicensed turn-1 row and un-greys the licensed one", () => {
    for (const first of ["p1", "p2"] as const) {
      const plain = redactGame(board(SEEDS[2], first, first, UNLICENSED), first);
      const plainPhase = plain.phase;
      if (plainPhase.kind !== "turn:action") throw new Error(`expected turn:action, got ${plainPhase.kind}`);
      expect(plainPhase.attacks.length, `${first}`).toBe(1);
      expect(plainPhase.attacks.every((a) => !a.playable), `${first}`).toBe(true);
      // The NON-VACUOUS control: the {P} was attached all along, so the only
      // reason the row was dead is the §4 ban — and the licence revives it.
      const licensed = redactGame(board(SEEDS[2], first, first, "sv10.5b-044"), first);
      const licensedPhase = licensed.phase;
      if (licensedPhase.kind !== "turn:action") throw new Error("expected turn:action");
      expect(licensedPhase.attacks[0]?.playable, `${first}`).toBe(true);
    }
  });

  it("and it agrees with `attack` on EVERY seed — the two sites read one function", () => {
    // 🛑 THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG THIS EXTRACTION PREVENTS.
    // Before D277 each site spelled `state.turn === 1` for itself; a licence wired
    // into one of them would leave the other offering (or refusing) a button the
    // engine disagrees with. This drives the agreement rather than trusting it.
    for (const seed of SEEDS) {
      for (const activeId of [UNLICENSED, "sv10.5b-044", "sv10.5b-159", "sv10.5b-167"]) {
        const state = board(seed, "p1", "p1", activeId);
        const view = redactGame(state, "p1");
        const phase = view.phase;
        if (phase.kind !== "turn:action") throw new Error("expected turn:action");
        const offered = phase.attacks[0]?.playable === true;
        const accepted = applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok;
        expect(offered, `${seed}/${activeId}`).toBe(accepted);
      }
    }
  });
});
