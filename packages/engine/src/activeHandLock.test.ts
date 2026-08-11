import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, handPlayBarred, programFor, redactGame } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// D284 — THE CONTINUOUS SEAT-WIDE BAR ON THE PLAY, AND THE FOURTH READ SITE.
//
// THE SENTENCES. Two of them, and the second is why `HandPlayClass` is wider
// than `StampedHandPlayClass`:
//
//   "As long as this Pokémon is in the Active Spot, your opponent can't play any
//    Item cards from their hand."
//        — Tyranitar `sv09-095` "Daunting Gaze", 1 legal printing.
//   "As long as this Pokémon is in the Active Spot, your opponent can't play any
//    Item cards or Pokémon Tool cards from their hand."
//        — Jellicent ex `sv10.5w-045`/`-160`/`-168` "Oceanic Curse", 3 legal
//          printings, `abilities_json` BYTE-IDENTICAL across all three.
//
// ── THE CENSUS, AND WHY THE SLICE IS 4 AND NOT 7 ────────────────────────────
//
// 🛑 **THE POPULATION WAS RE-QUERIED IN THE VOCABULARY, NOT IN THE SENTENCE**,
// which is D283's own lesson spent rather than repeated. Remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-08, `legal_standard = 1`,
// one row of `SUM(instr(col,…)>0)` per column (D283's compound-SELECT limit):
//
//     predicate                                   ability  attack  effect
//     instr(col, "can't play")                        7       9       0
//     instr(col, "your opponent can't play")          7       0       0
//     instr(col, "your opponent can't")               7       0       0
//     instr(col, "cannot play") / "be played"         0       0       0
//
// ⚠️ **THE THIRD RUNG IS THE ONE WORTH HAVING**: every continuous *"your opponent
// can't X"* Ability in Standard is a PLAY bar — the mechanism reaches no further
// than the sentence does on this surface, which is the OPPOSITE of what the same
// widening did for D283 (2 → 8) and is a real answer rather than a null result.
// `at_cont` (`instr(attacks_json, "in the Active Spot, your opponent can't")`)
// is **0**: no attack prints the continuous window, so this family has no attack
// half at all and `BUILT.attack` cannot move.
//
// 🛑 **AND THE SEVEN ROWS ARE FIVE SENTENCES, NOT ONE.** The handoff (and
// D283's own note in effects.ts, now corrected) recorded all seven as carrying
// *"while this Pokémon is in the Active Spot"*. **GENESECT `sv06.5-040` DOES
// NOT** — its window is *"If this Pokémon has a Pokémon Tool attached"*. That
// was the cheapest possible thing to check and it was asserted rather than
// measured; §1 below pins all five sentences byte-exact so the claim cannot go
// stale again in the same direction. ⚠️ The engine already KNEW: effects.ts's
// `yourActiveHasToolAttached` block and `toolClause.test.ts` both name this card
// as a near miss sharing that exact prefix. **A CLAIM CONTRADICTED BY THE
// CODEBASE'S OWN COMMENTS IS THE CHEAPEST KIND TO CATCH.**
//
// ── WHAT IS REFUSED, WITH THE MISSING MECHANISM NAMED ───────────────────────
//
// Three of the seven. Each refusal is asserted in §1 as "no program", so an
// accidental build would redden here rather than pass unremarked:
//   • Copperajah `sv06.5-042` — Stadium. The CLASS is spellable (`"Stadium"` is
//     a `Card.trainerType`); the READ is not. `playTrainer` hands a Stadium to
//     `playStadium` on the line ABOVE this gate, and `redactedTrainersOf` skips
//     Stadium rows entirely. **MISSING: a Stadium payability mirror on the wire.**
//   • Team Rocket's Arbok `sv10-113` — *"any Pokémon that has an Ability … except
//     for Team Rocket's Pokémon"*. Not a `trainerType` at all: a POKÉMON play,
//     narrowed by a filter and re-widened by an owner-prefix exception.
//     **MISSING: a play-from-hand gate for the Pokémon surface** — the same seam
//     Bronzong `sv05-069` was refused at by D283.
//   • Genesect `sv06.5-040` — ACE SPEC, behind the Tool-attached window above.
//     **MISSING: an engine-side ACE SPEC classifier.** `Card.rarity` carries the
//     string (`"ACE SPEC Rare"`, 33 legal rows), but ACE SPEC is a RARITY axis
//     ORTHOGONAL to `trainerType` — an ACE SPEC may be an Item, a Supporter, a
//     Stadium or a Tool — so it is a second dimension of the question and not a
//     member of this union.
//
// ── WHAT THE SLICE COST ─────────────────────────────────────────────────────
//
// ONE `PassiveEffects` field carrying a CLASS LIST, ONE widened `HandPlayClass`,
// ONE new `continuous.ts` scan, ONE new read site (`cardplay.ts attachTool`).
// ZERO new `EffectOp`s, ZERO new `ErrorCode`s (`HAND_PLAY_BLOCKED` is REUSED —
// same rule, same refusal, and a second code would make the two sources
// distinguishable to a client that has no business telling them apart), ZERO new
// events, ZERO new `GameState` fields, ZERO `src/` files and ZERO
// `MATCH_RECORD_VERSION` movement.
//
// 🛑 **`handPlayBarred` IS WIDENED, NOT PARALLELED, AND THE COMPILER PICKED THE
// HOME.** The passive half needs `programFor` and `disabledAbilityUids`, and
// `registry.ts` imports `types.ts`, so the reader could not stay beside the field
// it reads — it moved to `continuous.ts` and the stamp's arithmetic stayed behind
// as `stampedBarFor`. Every existing call site took a ZERO-line diff.
//
// ── THE HAZARDS THIS SUITE IS SHAPED AROUND ────────────────────────────────
//
// ⚠️ **A ONE-SENTENCE BOARD IS VACUOUS ON A TWO-SENTENCE FAMILY.** Tyranitar and
// Jellicent ex differ ONLY in the length of the class list, so a build that
// ignored the array and barred `["Item","Tool"]` for both is green on every
// Jellicent board and on every Item assertion. §3 drives the Tool through
// TYRANITAR'S board and requires it to LAND — the one assertion that separates
// the two printed sentences.
//
// ⚠️ **A TRAINER-ONLY SUITE IS VACUOUS ON THE TOOL HALF.** Tools never reach
// `playTrainer`, so a bar wired only there honours Jellicent's sentence at
// exactly half — Items refused, Tools landing — and no `playTrainer` assertion
// can see it. §3 goes through `attachTool`.
//
// ⚠️ **AND THE PERSPECTIVE IS THE EASY ONE TO INVERT.** The sentence is printed
// on the BARRING body and reads *"your opponent can't play"*, so a build that
// asked about the seat's OWN Active is green on nothing — but one that forgot the
// flip in ONE of the four read sites is green everywhere except there. §5 drives
// both seats under both first-player assignments and asserts the barring seat's
// own hand stays free.

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows.
// ─────────────────────────────────────────────────────────────────────────────

const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";
const OCEANIC_CURSE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards or Pokémon Tool cards from their hand.";
/** The three REFUSED sentences, pinned so the refusals stay checkable. */
const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";
const POTENT_GLARE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Pokémon that has an Ability from their hand, except for Team Rocket's Pokémon.";
/** 🛑 THE ONE THAT IS NOT AN ACTIVE-SPOT SENTENCE AT ALL. */
const ACE_NULLIFIER_TEXT =
  "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.";

const TYRANITAR = "sv09-095";
const JELLICENT = "sv10.5w-045";
const JELLICENT_2 = "sv10.5w-160";
const JELLICENT_3 = "sv10.5w-168";
const COPPERAJAH = "sv06.5-042";
const ARBOK = "sv10-113";
const GENESECT = "sv06.5-040";

/** Potion — an Item with a board precondition every fixture below satisfies (a
    damaged own Pokémon), so a refusal at its row can only ever be a RULE. */
const ITEM = "sv01-188";
/** Professor's Research — the Supporter CONTROL. Tyranitar and Jellicent bar
    Items; a build that collapsed the class list to "any Trainer" refuses this. */
const SUPPORTER = "sv01-189";
/** Vitality Band — a Pokémon TOOL with a simulated passive, so `attachTool`'s
    "is it simulated" gate cannot be what refuses it. */
const TOOL = "sv01-197";
/** Bravery Charm — a SECOND Tool, so §3 can attach one after the other without
    §7.4's one-Tool-per-Pokémon cap being the reason a second attempt fails. */
const TOOL_2 = "sv02-173";
/** Ting-Lu ex "Cursed Land" — the §9 lock, and the ONE in the pool that can
    reach these bodies. Klefki/Spiritomb silence BASICS only; Tyranitar is a
    Stage 2 and Jellicent ex a Stage 1, so neither is reachable from them.
    ⚠️ IT EXEMPTS POKÉMON ex, which makes §7 a PAIR rather than a single claim. */
const TING_LU = "sv02-127";
/** The CONTROL body: same board, same hands, NO Ability. Every "the bar bites"
    assertion below passes just as happily on a build that refused every Item. */
const PLAIN = "fix-plain-barrier";

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** Tyranitar `sv09-095`, carrying the catalog's own HP/type/stage. The id is
    REAL, so `programFor` resolves the shipped `DAUNTING_GAZE` row rather than a
    stand-in. ⚠️ NO ATTACKS — this suite never swings, and an attack would give
    every refusal below a second possible explanation. */
function tyranitar(id: string): Card {
  return battler(id, {
    name: "Tyranitar",
    hp: 180,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    abilities: [{ type: "Ability", name: "Daunting Gaze", effect: DAUNTING_GAZE_TEXT }],
  });
}

/** Jellicent ex — the two-class printing. ⚠️ THE `ex` SUFFIX IS CARRIED BY THE
    NAME AND NOT BY A FIELD (`pokemonSuffixOf`, cards.ts — tcgdex drops its own
    suffix column at ingest), and §7's §9 pair turns on it: Ting-Lu ex exempts
    Pokémon ex, so a fixture named "Jellicent" would silently flip that test. */
function jellicent(id: string): Card {
  return battler(id, {
    name: "Jellicent ex",
    hp: 280,
    retreat: 2,
    types: ["Water"],
    stage: "Stage1",
    abilities: [{ type: "Ability", name: "Oceanic Curse", effect: OCEANIC_CURSE_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [TYRANITAR]: tyranitar(TYRANITAR),
  [JELLICENT]: jellicent(JELLICENT),
  [JELLICENT_2]: jellicent(JELLICENT_2),
  [JELLICENT_3]: jellicent(JELLICENT_3),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Barrier",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage2",
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The FIFTEENTH seeded deck (D270's rule: a seeded suite gets its own deck).
    ⚠️ ALL FOUR REAL IDS ARE IN IT, not only the two the boards drive most often
    — `setActiveFromDeck` pulls from the deck, so a reprint named only in §1's
    catalog check would otherwise be untestable on a board. */
const LOCK_DECK = deckOf({
  [TYRANITAR]: 4,
  [JELLICENT]: 4,
  [JELLICENT_2]: 1,
  [JELLICENT_3]: 1,
  [PLAIN]: 4,
  [TING_LU]: 2,
  [ITEM]: 4,
  [SUPPORTER]: 4,
  [TOOL]: 3,
  [TOOL_2]: 2,
  "fix-basic-1": 4,
  "fix-energy": 27,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [6101, 6113, 6121, 6133] as const;

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

/** D275's `localSetup`, with the FIRST PLAYER as a PARAMETER — a one-seat board
    is vacuous on a per-seat fact, and "whose hand is barred" is exactly one. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: LOCK_DECK, p2: LOCK_DECK }, cardPool: POOL });
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

/** `barrier` holds `barrierId` in the ACTIVE SPOT; both seats hold an Item, a
    Supporter and two Tools, and both have a damaged Active so Potion always has
    a legal target and a refusal at its row can only be the rule under test.
    ⚠️ THE BENCH BODY IS LOAD-BEARING — §14.2 makes an empty Bench a LOSS the
    moment the Active leaves, and a `gameOver` board proves nothing about a bar. */
function board(seed: number, first: Seat, barrier: Seat, barrierId: string): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, barrier, barrierId);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, "fix-basic-1");
  state = setActiveFromDeck(state, victim, PLAIN);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, "fix-basic-1");
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, ITEM, 1);
    state = handFromDeck(state, seat, SUPPORTER, 1);
    state = handFromDeck(state, seat, TOOL, 1);
    state = handFromDeck(state, seat, TOOL_2, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk the clock so `seat` is the one to move. Both a bar and its absence are
    only observable on the barred player's OWN turn — every other refusal below
    would be the phase gate wearing the rule's name. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 4; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** Play `cardId` from `seat`'s hand and report the error code, or "OK". Every
    assertion goes through this so a green "the bar refuses" line can never be a
    refusal for the WRONG reason. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

/** The §7.4 twin — the read site `playTrainer` cannot reach. */
function attach(state: GameState, seat: Seat, cardId: string, spot: "bench" | "active" = "bench"): string {
  const uid = handUid(state, seat, cardId);
  const target =
    spot === "active" ? ({ spot: "active" } as const) : ({ spot: "bench", index: 0 } as const);
  const result = applyAction(deepFreeze(state), { type: "attachTool", seat, uid, target });
  return result.ok ? "OK" : result.error.code;
}

/** The wire projection's own answer for the same row — the payability mirror
    D223 found costs more than the field it mirrors. */
function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  const uid = handUid(state, seat, cardId);
  return phase.trainers.find((t) => t.uid === uid)?.disabled;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CATALOG — five sentences, four built, three refused BY NAME.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §1 — the census, and which of it this vocabulary reaches", () => {
  it("the FOUR built printings carry the field, and the class list is the printed one", () => {
    expect(programFor(TYRANITAR)?.passive?.preventOpponentHandPlay).toEqual(["Item"]);
    for (const id of [JELLICENT, JELLICENT_2, JELLICENT_3]) {
      expect(programFor(id)?.passive?.preventOpponentHandPlay, id).toEqual(["Item", "Tool"]);
    }
    // 🛑 THE DISJOINTNESS IS THE CLAIM, NOT THE PRESENCE. A build that gave both
    // sentences the same list is green on every "Item is barred" assertion in
    // this file; only the LENGTHS tell the two printed sentences apart.
    expect(programFor(TYRANITAR)?.passive?.preventOpponentHandPlay).not.toContain("Tool");
  });

  it("the three REPRINTS share ONE program object — the reprint idiom, asserted", () => {
    expect(programFor(JELLICENT_2)).toBe(programFor(JELLICENT));
    expect(programFor(JELLICENT_3)).toBe(programFor(JELLICENT));
    // ⚠️ AND THE OTHER SENTENCE IS NOT THAT OBJECT — a shared-object claim that
    // did not check the negative would pass on a build with ONE program for all
    // four ids, which is exactly the collapse the line above rules out.
    expect(programFor(TYRANITAR)).not.toBe(programFor(JELLICENT));
  });

  it("🆕 D291 — ALL THREE ONCE-REFUSED PRINTINGS NOW CARRY A PROGRAM, AND EACH ON ITS OWN FIELD", () => {
    // D284 asserted all THREE refusals rather than leaving them implicit, so that
    // a future slice building one had to DELETE a line naming the missing
    // mechanism instead of quietly widening a table. **THAT MECHANISM HAS NOW
    // FIRED THREE TIMES AND WORKED EVERY TIME:**
    //   • D285 built ARBOK's (a play-from-hand gate for the Pokémon surface).
    //   • D287 built COPPERAJAH's (a `handPlayBarred` read inside `playStadium`).
    //   • 🆕 D291 built GENESECT's (an engine-side ACE SPEC classifier over
    //     `Card.rarity`, plus a holder-state window that walks the Bench).
    // ⚠️ **AND THE LAST EDIT IS THE ONE THAT PROVES THE DESIGN.** D284's line here
    // read `expect(programFor(GENESECT)).toBeUndefined()`; it went RED the moment
    // `sv06.5-040` entered the registry and could not be made green by any amount
    // of widening — only by writing down what the row now carries, below. **THE
    // REFUSAL COST A DELIBERATE EDIT AT EVERY ONE OF THE THREE BUILDS**, which is
    // the whole reason D284 spent three assertions on rows it was not building.
    //
    // 🛑 **THE THREE FIELDS ARE THREE, AND THAT IS THE ASSERTION.** A build that
    // collapsed any two of them into one wider field would be green on every
    // "the bar bites" line in this file and RED here.
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(programFor(ARBOK)?.passive?.preventOpponentPokemonPlay).toBeDefined();
    expect(programFor(GENESECT)?.passive?.preventOpponentAceSpecPlayWhileToolAttached).toBe(true);
    // ⚠️ AND GENESECT IS NOT ON THE CLASS FIELD AT ALL, WHICH IS THE POINT OF THE
    // WHOLE SLICE. `HandPlayClass` is EXACTLY `Card.trainerType` (D287) and stayed
    // that way: ACE SPEC is a RARITY axis ORTHOGONAL to it, so the row is a SECOND
    // PREDICATE crossed with the class question, never a fifth member of it. A
    // build that had added `"AceSpec"` to the union would light this line.
    expect(programFor(GENESECT)?.passive?.preventOpponentHandPlay).toBeUndefined();
    // The printed noun is pinned so the claim cannot be quietly re-read as a
    // `trainerType` one.
    expect(ACE_NULLIFIER_TEXT).toContain("any ACE SPEC cards from their hand");
  });

  it("🛑 GENESECT'S WINDOW IS *NOT* THE ACTIVE SPOT — the inherited claim, corrected", () => {
    // D283 recorded all seven printings as carrying "while this Pokémon is in the
    // Active Spot". Four of the other six do; this one prints a HOLDER-STATE
    // window readable from any zone, which is why the one-Active scan cannot
    // express it and why the refusal has TWO reasons rather than one.
    expect(ACE_NULLIFIER_TEXT.startsWith("If this Pokémon has a Pokémon Tool attached")).toBe(true);
    expect(ACE_NULLIFIER_TEXT).not.toContain("in the Active Spot");
    for (const text of [
      DAUNTING_GAZE_TEXT,
      OCEANIC_CURSE_TEXT,
      MASSIVE_BODY_TEXT,
      POTENT_GLARE_TEXT,
    ]) {
      expect(text.startsWith("As long as this Pokémon is in the Active Spot,")).toBe(true);
    }
    // ⚠️ AND THE FIXTURES SAY WHAT THE CATALOG SAYS — a fixture that drifted from
    // the printed sentence would test a card nobody printed.
    expect(POOL[TYRANITAR]?.abilities?.[0]?.effect).toBe(DAUNTING_GAZE_TEXT);
    for (const id of [JELLICENT, JELLICENT_2, JELLICENT_3]) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(OCEANIC_CURSE_TEXT);
    }
  });

  it("the two BUILT sentences differ in exactly the class slot — the anchor's shape", () => {
    // The one-class and two-class spellings are the SAME sentence with a longer
    // noun phrase, which is why they are one field and two registry rows rather
    // than two fields (D252's rule read in the permissive direction).
    expect(OCEANIC_CURSE_TEXT.replace(" or Pokémon Tool cards", "")).toBe(DAUNTING_GAZE_TEXT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BAR BITES — and the CONTROL that makes the claim mean anything.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §2 — the bar, and the control body", () => {
  it("an opposing TYRANITAR in the Active Spot refuses the Item", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("🛑 THE CONTROL — the same board with a body that prints NOTHING lets it through", () => {
    // Without this every assertion in this file is green on a build that refuses
    // every Item on every board.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      expect(play(state, "p2", ITEM)).toBe("OK");
    }
  });

  it("the SUPPORTER is untouched — the class list is read, not collapsed to a flag", () => {
    for (const barrier of [TYRANITAR, JELLICENT] as const) {
      const state = turnOf(board(SEEDS[0], "p1", "p1", barrier), "p2");
      expect(play(state, "p2", SUPPORTER), barrier).toBe("OK");
      expect(play(state, "p2", ITEM), barrier).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("the predicate answers per CLASS, at the reader, on the same board", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(state, "p2", "Supporter", undefined)).toBe(false);
    expect(handPlayBarred(state, "p2", "Tool", undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE TOOL HALF — the fourth read site, and the assertion that separates the
//    two printed sentences.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §3 — attachTool, the read site playTrainer cannot reach", () => {
  it("🛑 AN OPPOSING JELLICENT ex REFUSES THE TOOL ATTACH", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", JELLICENT), "p2");
      expect(attach(state, "p2", TOOL)).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("🛑 AND TYRANITAR DOES NOT — the one assertion that tells the two sentences apart", () => {
    // A build that ignored the array and barred ["Item","Tool"] for BOTH rows is
    // green on every other line in this file. This is the line it fails.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(attach(state, "p2", TOOL)).toBe("OK");
      // …and the Item on the SAME board is still refused, so the Tool landing is
      // not the bar being absent altogether.
      expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("the CONTROL body lets the Tool through, so the refusal is the rule and not §7.4", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(attach(state, "p2", TOOL)).toBe("OK");
    // ⚠️ AND A SECOND TOOL ON A SECOND HOST TOO — proving the Jellicent refusal
    // above is not the one-Tool-per-Pokémon cap arriving early.
    expect(attach(state, "p2", TOOL_2, "active")).toBe("OK");
  });

  it("the bar is ABOVE §7.4's own mechanics — a barred seat is not told about the slot", () => {
    // ORDER, driven rather than argued: with the bench host ALREADY carrying a
    // Tool, an unbarred seat gets TOOL_ALREADY_ATTACHED and a barred one still
    // gets HAND_PLAY_BLOCKED. A gate placed below §7.4's checks would report the
    // slot to a player the rules never let attempt the attach at all.
    const open = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    const filled = must(
      applyAction(open, {
        type: "attachTool",
        seat: "p2",
        uid: handUid(open, "p2", TOOL),
        target: { spot: "bench", index: 0 },
      }),
    );
    expect(attach(filled, "p2", TOOL_2)).toBe("TOOL_ALREADY_ATTACHED");
    // The SAME occupied slot, on a board whose opposing Active bars the class.
    // Built by occupying the slot on the barred board directly (a Tool that
    // arrived before the Jellicent came Active), because splicing one board's
    // `players` onto another's would carry uids the other board never dealt.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const host = barred.players.p2.bench[0];
    if (host === undefined) throw new Error("no benched host");
    const barredFilled: GameState = {
      ...barred,
      players: {
        ...barred.players,
        p2: {
          ...barred.players.p2,
          bench: [{ ...host, tools: [handUid(barred, "p2", TOOL)] }, ...barred.players.p2.bench.slice(1)],
        },
      },
    };
    expect(attach(barredFilled, "p2", TOOL_2)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE WINDOW — continuous, and ACTIVE-ONLY.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §4 — the printed window", () => {
  it("🛑 A BENCHED JELLICENT BARS NOTHING — the source clause is read", () => {
    // "As long as this Pokémon is in the Active Spot" collapses the holder loop
    // to ONE read. A build that scanned the whole board (`hasFreeRetreatAura`'s
    // shape rather than `seatShieldedFromSupporterEffects`'s) is green on every
    // other line in this file.
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", PLAIN);
      state = benchFromDeck(state, "p1", JELLICENT);
      state = turnOf(state, "p2");
      expect(play(state, "p2", ITEM)).toBe("OK");
      expect(attach(state, "p2", TOOL)).toBe("OK");
    }
  });

  it("the bar is CONTINUOUS, not turn-scoped — it survives the turn boundary", () => {
    // D283's stamp expires by arithmetic; this one expires when the body leaves
    // the Active Spot and never otherwise. Driven across two full rounds.
    let state = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = turnOf(state, "p2");
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = turnOf(state, "p2");
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    // ⚠️ AND IT LEAVES WITH THE BODY, in the same run — the other half of
    // "continuous", and the half a stamp could never have.
    const lifted = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: null } } };
    expect(handPlayBarred(lifted, "p2", "Item", undefined)).toBe(false);
  });

  it("NOTHING WAS PERSISTED — the barred board's stamp record is empty on both seats", () => {
    // The whole difference from D283 stated as a board fact: the bar is derived,
    // so no write happened anywhere and `handPlayLockedTurn` is untouched.
    const state = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    for (const seat of ["p1", "p2"] as const) {
      expect(state.handPlayLockedTurn[seat]).toEqual({
        Item: null,
        Supporter: null,
        evolve: null,
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE PERSPECTIVE FLIP — "your opponent", from both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §5 — whose hand is barred", () => {
  it("🛑 THE BARRING SEAT'S OWN HAND IS FREE — from both seats, under both assignments", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const barrier of ["p1", "p2"] as const) {
        const victim = barrier === "p1" ? "p2" : "p1";
        const seeded = board(SEEDS[0], first, barrier, JELLICENT);
        const label = `${first}/${barrier}`;
        // The holder plays its own Item and attaches its own Tool freely…
        const own = turnOf(seeded, barrier);
        expect(play(own, barrier, ITEM), label).toBe("OK");
        expect(attach(own, barrier, TOOL), label).toBe("OK");
        // …and the seat across the table cannot.
        const other = turnOf(seeded, victim);
        expect(play(other, victim, ITEM), label).toBe("HAND_PLAY_BLOCKED");
        expect(attach(other, victim, TOOL), label).toBe("HAND_PLAY_BLOCKED");
      }
    }
  });

  it("the reader answers per SEAT on one board, with no turn term at all", () => {
    // ⚠️ THE PREDICATE HAS NO TURN COMPARISON, unlike its stamped half — a
    // continuous bar is a standing fact and is true off-turn too. The PHASE gate
    // is what stops an off-turn play, and that is a different rule.
    const state = board(SEEDS[0], "p1", "p2", TYRANITAR);
    expect(handPlayBarred(state, "p1", "Item", undefined)).toBe(true);
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. BOTH HALVES OF THE PAYABILITY MIRROR (D223's finding, inherited by name).
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §6 — the wire mirror agrees with the engine", () => {
  it("the barred Item row is GREYED, and the Supporter beside it is not", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    expect(wireDisabled(state, "p2", ITEM)).toBe(true);
    expect(wireDisabled(state, "p2", SUPPORTER)).toBe(false);
  });

  it("the CONTROL board greys neither — so the grey is the bar and not the row", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(wireDisabled(state, "p2", ITEM)).toBe(false);
    expect(wireDisabled(state, "p2", SUPPORTER)).toBe(false);
  });

  it("the mirror and the engine agree on every row of every board — the sweep", () => {
    // ⚠️ ROW BY ROW RATHER THAN CASE BY CASE: an afford-then-reject defect is one
    // row disagreeing, and a `some`-shaped check would miss it.
    for (const barrier of [TYRANITAR, JELLICENT, PLAIN] as const) {
      for (const cardId of [ITEM, SUPPORTER] as const) {
        const state = turnOf(board(SEEDS[1], "p2", "p1", barrier), "p2");
        const label = `${barrier}/${cardId}`;
        const engineSaid = play(state, "p2", cardId) !== "OK";
        expect(wireDisabled(state, "p2", cardId), label).toBe(engineSaid);
      }
    }
  });

  it("⚠️ THE MIRRORS LIST NO TOOL ROW AT ALL — stated, because it looks like a gap", () => {
    // Tools attach by DRAG, so `redactedTrainersOf` skips them and
    // `src/features/game/placement.ts` answers off a REDACTED board with "fine
    // legality … stays the engine's (the pill)". The Tool half therefore has ONE
    // read site and not three, which is why this slice took a ZERO `src/` diff.
    const state = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const phase = redactGame(state, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    const toolUid = handUid(state, "p2", TOOL);
    expect(phase.trainers.find((t) => t.uid === toolUid)).toBeUndefined();
    // …and the engine still refuses it, which is the whole of the feedback.
    expect(attach(state, "p2", TOOL)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. §9 SUPPRESSION — and it is a PAIR, because the lock in the pool exempts ex.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §7 — Klefki's family takes the bar down", () => {
  /** Ting-Lu ex Active on the BARRED seat, with the barring body damaged.
      "Cursed Land" reaches the opponent's damaged Pokémon in play EXCEPT
      Pokémon ex — so it silences Tyranitar and not Jellicent ex, which is a
      real pair rather than one claim written twice. */
  function underCursedLand(barrierId: string): GameState {
    let state = board(SEEDS[0], "p1", "p1", barrierId);
    state = setActiveFromDeck(state, "p2", TING_LU);
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = setDamage(state, "p1", 20);
    state = handFromDeck(state, "p2", ITEM, 1);
    state = handFromDeck(state, "p2", TOOL, 1);
    return turnOf(state, "p2");
  }

  it("🛑 A SILENCED TYRANITAR BARS NOTHING — the bar rides passivesOf's §9 rule", () => {
    // A build that read `programFor(top.id)?.passive` at the funnel instead of
    // going through `disabledAbilityUids` is green everywhere else in this file.
    const state = underCursedLand(TYRANITAR);
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
    expect(play(state, "p2", ITEM)).toBe("OK");
  });

  it("AND JELLICENT ex IS EXEMPT — so the §9 claim is the lock and not the board", () => {
    // Same board, same damage, same lock. The only difference is the printed
    // suffix, which is what makes the line above a §9 assertion rather than a
    // "this board happens to allow it" assertion.
    const state = underCursedLand(JELLICENT);
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(attach(state, "p2", TOOL)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. MATCH_RECORD_VERSION — the NO-BUMP, driven in both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §8 — the version does NOT move, and that is driven", () => {
  it("🛑 A BARRED BOARD AND AN UNBARRED ONE ARE THE SAME PERSISTED SHAPE", () => {
    // ⚠️ A DIFF BETWEEN TWO BOARDS FROM ONE BUILD IS A HALF-GUARD (D279), so the
    // diff is PAIRED with the literal key list — the same anchor D280/D281/D282
    // installed and D283 watched all three of them fire.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const plain = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(handPlayBarred(barred, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(plain, "p2", "Item", undefined)).toBe(false);
    expect(Object.keys(barred).sort()).toEqual(Object.keys(plain).sort());
    expect(Object.keys(barred).sort()).toEqual(
      [
        "allowances",
        "cardIdByUid",
        "cardPool",
        "firstPlayer",
        "handPlayLockedTurn",
        "lastKoMarks",
        "lastKoTurn",
        "oncePerGameSpent",
        "pending",
        "phase",
        "players",
        "rngState",
        "stadium",
        "turn",
      ].sort(),
    );
  });

  it("🆕 D285 — THE PERSISTED KEYS ARE EXACTLY THREE, AND `\"Tool\"` IS STILL NOT ONE", () => {
    // D284's line read "STILL EXACTLY TWO": `HandPlayClass` had gained `"Tool"`
    // and, had `handPlayLockedTurn` been keyed by it, every board would have grown
    // a key NO WRITER CAN SET. D285 added a third key that a writer CAN set
    // (Bronzong stamps `"evolve"`), which is the distinction the two unions draw —
    // so the number moved and the PRINCIPLE did not. `"Tool"` and `"bench"`, the
    // two members reachable only from a passive, are both still absent.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    for (const seat of ["p1", "p2"] as const) {
      const keys = Object.keys(barred.handPlayLockedTurn[seat]).sort();
      expect(keys).toEqual(["Item", "Supporter", "evolve"].sort());
      expect(keys).not.toContain("Tool");
      expect(keys).not.toContain("bench");
    }
  });

  it("🛑 AN OLD RECORD READS BACK IDENTICALLY — a JSON round trip keeps the bar", () => {
    // The bar is reconstituted entirely from fields v15 ALREADY persists
    // (`players[].active` + `cardPool`), so a record written before this deploy
    // resumes with the bar computed rather than missing. Driven through a real
    // serialize/parse rather than a structural argument about it.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const round = JSON.parse(JSON.stringify(barred)) as GameState;
    expect(round).toEqual(barred);
    expect(handPlayBarred(round, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(round, "p2", "Tool", undefined)).toBe(true);
    // …and the real play path agrees on the revived record, not just the reader.
    expect(play(round, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
  });

  it("🛑 NO PERSISTED STRUCTURE MENTIONS THE NEW KEY — the whole-registry sweep", () => {
    // The other half of "it persists nothing": the field is CATALOG data, so it
    // must appear in `programFor` and NOWHERE in a serialized board. A sweep
    // rather than a spot check, because a leak would be one key on one body.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const persisted = JSON.stringify({ ...barred, cardPool: undefined });
    expect(persisted).not.toContain("preventOpponentHandPlay");
    // ⚠️ THE ATTRIBUTION CONTROL: the sweep is only meaningful if the string is
    // findable at all, and `cardPool` is not where a bar would leak to.
    expect(JSON.stringify(programFor(JELLICENT))).toContain("preventOpponentHandPlay");
    // And no body grew a key either — the `InPlayPokemon` record this rule was
    // deliberately NOT stamped onto.
    const plain = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    const bodyKeys = (s: GameState): string[] => Object.keys(s.players.p1.active ?? {}).sort();
    expect(bodyKeys(barred)).toEqual(bodyKeys(plain));
    expect(Object.keys(barred.allowances).sort()).toEqual(Object.keys(plain.allowances).sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. THE TWO SOURCES COMPOSE — one funnel, two writers, no double-count.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §9 — the widened funnel, with both sources live", () => {
  it("the STAMPED source still answers through the same reader", () => {
    // D283's half, driven through the re-homed function — the regression this
    // slice's move could most plausibly have caused, since `handPlayBarred`
    // changed file, changed signature's class union, and gained a disjunct.
    const state = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    const stamped: GameState = {
      ...state,
      handPlayLockedTurn: {
        ...state.handPlayLockedTurn,
        p2: { Item: state.turn, Supporter: null, evolve: null },
      },
    };
    expect(handPlayBarred(stamped, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(stamped, "p2", "Supporter", undefined)).toBe(false);
    expect(play(stamped, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    // 🛑 AND THE STAMP CANNOT REACH THE TOOL CLASS — `stampedBarFor` turns
    // `"Tool"` away by construction, so a Tool attach on a stamped board lands.
    expect(handPlayBarred(stamped, "p2", "Tool", undefined)).toBe(false);
    expect(attach(stamped, "p2", TOOL)).toBe("OK");
  });

  it("BOTH sources on one board is still one refusal, and lifting one is not lifting both", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    const both: GameState = {
      ...state,
      handPlayLockedTurn: {
        ...state.handPlayLockedTurn,
        p2: { Item: state.turn, Supporter: state.turn, evolve: null },
      },
    };
    expect(play(both, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(both, "p2", SUPPORTER)).toBe("HAND_PLAY_BLOCKED");
    // Drop the STAMP and the Item is still barred by the body; the Supporter,
    // which only the stamp named, comes back. An OR that had collapsed to either
    // single source fails one of these two lines.
    const passiveOnly: GameState = { ...both, handPlayLockedTurn: state.handPlayLockedTurn };
    expect(play(passiveOnly, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(passiveOnly, "p2", SUPPORTER)).toBe("OK");
  });
});
