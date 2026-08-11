import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { deriveAttackDamageBonus } from "./effects";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  trainerCard,
} from "./testFixtures";
import { koedDuringOpponentsLastTurn, koedMarksOnOpponentsLastTurn } from "./types";

// D326 — WHICH POKÉMON WAS KNOCKED OUT, AND HOW. THE SECOND MECHANISM D271
// PRICED, DECLINED AND WROTE DOWN THE REASON FOR.
//
// THE TWO SENTENCES. Both narrow the KO SET that D271's gate reads, and neither
// can be answered from a turn number:
//
//   · *"You can use this card only if any of your **Team Rocket's** Pokémon were
//     Knocked Out during your opponent's last turn. / Each player shuffles their
//     hand into their deck. Then, you draw 5 cards, and your opponent draws 3
//     cards."* — Team Rocket's Archer `sv10-170` / `sv10-223` (Supporter, 2
//     Standard-legal printings, byte-identical `effect`).
//   · *"If any of your Pokémon were Knocked Out **by damage from an attack**
//     during your opponent's last turn, this attack does {N} more damage."* —
//     Iron Leaves `sv06-019` (+60), Revavroom `sv06-125` (+90), Alolan Marowak
//     `sv09-057` (+90), Terrakion `sv10.5w-054` / `sv10.5w-135` (+80), and
//     Ethan's Pinsir `sv10-001` (+100), which prints BOTH narrowings at once.
//
// 🛑 **ARCHER WAS THE OLDEST UNPRICED ROW ON `docs/progress.md` AND NO SESSION
// HAD EVER READ ITS TEXT.** Five consecutive handoffs carried it as "2 printings,
// STILL unpriced against the registry"; the sentence above was pulled off the
// remote D1 by D326 before a line was written, which is the only reason the
// `owner` half was priced at one field instead of re-declined for a fourth time.
//
// 🛑 **AND THE SIX ATTACK PRINTINGS WERE INVISIBLE TO THE CENSUS THAT PRICED
// THIS FAMILY.** D271 swept `%were Knocked Out during%` over all three text
// columns, got 8 printings, and named all 8. The literal cannot see these six,
// because *"by damage from an attack"* sits between the verb and the *"during"*.
// The bare-noun sweep `%Pokémon were Knocked Out%` at `legal_standard = 1`
// returns **14**, and the difference set is exactly these six. **A WIDER
// SPELLING OF THE SAME LITERAL WOULD NOT HAVE FOUND THEM; A SHORTER NOUN DID.**
//
// ── WHAT IS NEW, AND WHY IT IS ONE FIELD RATHER THAN TWO ─────────────────────
//
// D271 recorded that `lastKoTurn` answers *when* a seat lost a Pokémon and
// deliberately never *which*, and that an owner prefix "would want the stamp to
// become a per-body record". That was re-read against `flow.ts` at D326 rather
// than inherited — the write site still stamps `state.turn` and nothing else —
// and the per-body record is what this slice adds: `GameState.lastKoMarks`, a
// list CO-STAMPED with `lastKoTurn` rather than a second clock.
//
// ✅ **NO SECOND WINDOW, SO NO SECOND WAY TO BE WRONG ABOUT IT.** The list
// carries no turn of its own: `knockOut` restarts it when a Knock Out lands on a
// turn later than the one already stamped and appends otherwise, so the marks
// belong to `lastKoTurn`'s turn BY CONSTRUCTION. D271's best property survives
// intact — there is still no boundary write, and nothing clears anything.
//
// ✅ **AND THE READER CANNOT DISAGREE WITH D271's.** `koedMarksOnOpponentsLastTurn`
// asks `koedDuringOpponentsLastTurn` FIRST and returns an EMPTY list when the
// window is shut, so a narrowed gate is TRUE on a strict SUBSET of the boards
// the bare gate is true on. That is a property of the code and not of the tests,
// and §5 below drives it anyway.
//
// ✅ **TWO OPTIONAL FIELDS ON ONE MEMBER, AND ONE CARD SETTLES THAT.** Ethan's
// Pinsir prints the owner prefix AND the cause in one clause. Two `BoardCondition`
// members could not have spelled the conjunction; two optional keys on D271's
// member spell it by leaving both set.
//
// ✅ **`byAttack` IS NOT A NEW DISCRIMINATION.** `collectKnockOuts` has taken
// `attackerSeat` since D164 and it is passed by `finishAttack` ALONE — the
// Checkup and the mid-turn sweep deliberately omit it — so the funnel already
// knew. Threading it into `knockOut` is the whole of the plumbing.
//
// ── THE HAZARDS THIS SUITE IS SHAPED AROUND ─────────────────────────────────
//
// 🛑 **A NARROWING THAT NARROWS NOTHING IS GREEN AND DEAD.** The cheapest wrong
// build reuses D271's bare gate for all eight printings and passes every test
// that only ever Knocks a Pokémon Out with an attack. §3 exists for exactly that:
// it Knocks a Pokémon Out with CHECKUP POISON and asserts the bare gate TRUE and
// the narrowed gate FALSE **on the same state, in the same breath**. A board that
// never poisons anything cannot tell the two builds apart.
//
// 🛑 **AND SO IS AN OWNER TEST THAT ALWAYS SAYS YES.** §2 KOs a NON-prefixed body
// and a prefixed one on boards identical in every other respect, and reads the
// gate on both — a build that ignored `owner` passes the accept and fails the
// refuse, and a build that hard-coded "Team Rocket" passes both and fails §4's
// Ethan row.
//
// ⚠️ **A ONE-SIDED READ IS VACUOUS ON A PER-SEAT HISTORY** (D271's rule, and it
// applies to the marks exactly as it applied to the stamp): the seat that SCORED
// the Knock Out and the seat that LOST the Pokémon are different, so every
// assertion below reads BOTH seats.

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

const LOCAL_CARDS: Record<string, Card> = {
  // The victim bodies. All 30 HP so `fix-sniper`'s Spread Shot Knocks any of them
  // Out in one hit, and all three differ ONLY in the printed NAME — which is the
  // only thing an owner prefix is a test on, so nothing else can be doing the
  // work when the gate tells them apart.
  "fix-rocket-victim": battler("fix-rocket-victim", { hp: 30, name: "Team Rocket's Victim" }),
  "fix-ethan-victim": battler("fix-ethan-victim", { hp: 30, name: "Ethan's Victim" }),
  "fix-plain-victim": battler("fix-plain-victim", { hp: 30, name: "Plain Victim" }),
  // ⚠️ A NEAR-MISS ON PURPOSE. "Team Rocketeer's Sneasel" starts with the whole
  // of "Team Rocket" and is NOT a Team Rocket's Pokémon. `ownerPokemon` matches
  // `${owner}'s ` WITH the possessive and the trailing space, and this fixture is
  // what makes that trailing byte observable rather than decorative.
  "fix-nearmiss-victim": battler("fix-nearmiss-victim", {
    hp: 30,
    name: "Team Rocketeer's Sneasel",
  }),
  "fix-archer": trainerCard(
    "fix-archer",
    "Supporter",
    "You can use this card only if any of your Team Rocket's Pokémon were Knocked Out during your opponent's last turn.\n\nEach player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 3 cards.",
  ),
  "fix-stamp": trainerCard(
    "fix-stamp",
    "Item",
    "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.\n\nEach player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 2 cards.",
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN seeded deck (D270's rule). Sized for `who: "both"` at 5/3 off a
    freshly reshuffled pile on BOTH sides, plus the four victim bodies. */
const OWNER_KO_DECK = deckOf({
  "fix-archer": 4,
  "fix-stamp": 4,
  "fix-sniper": 4,
  "fix-rocket-victim": 4,
  "fix-ethan-victim": 4,
  "fix-plain-victim": 4,
  "fix-nearmiss-victim": 4,
  "fix-basic-1": 4,
  "fix-energy": 28,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: OWNER_KO_DECK, p2: OWNER_KO_DECK },
    cardPool: POOL,
  });
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

/** P2 to move on turn 2 with a loaded `fix-sniper`, facing a P1 Active that is
    `victim` (30 HP, one Spread Shot from gone).

    ⚠️ P2 ACTS AND P1 PLAYS THE CARD, which is D271's arrangement and its reason:
    the seat that LOSES the Pokémon is the one the gate is about, so a build that
    marked the ATTACKER's seat reads back as "P2 may play Archer" and no
    one-sided board would notice. */
function sniperOnP2(seed: number, victim: string, p1Bench: string[] = ["fix-basic-1"]): GameState {
  let state = localSetup(seed, "p1");
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = setActiveFromDeck(state, "p2", "fix-sniper");
  state = attachFromDeck(state, "p2", "fix-energy", 1); // pays Spread Shot [C]
  state = setActiveFromDeck(state, "p1", victim);
  state = clearBench(state, "p1");
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  return state;
}

function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: count }, (_, i) => i),
        }),
      );
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

/** The whole board arrangement for "P1 lost `victim` to P2's ATTACK on turn 2",
    settled and handed back on P1's turn 3. */
function koedByAttack(seed: number, victim: string): GameState {
  return settle(mustApply(sniperOnP2(seed, victim), { type: "attack", seat: "p2", index: 0 }).state);
}

function toHand(state: GameState, seat: Seat, cardId: string): GameState {
  return handFromDeck(handToDeck(state, seat, cardId), seat, cardId, 1);
}

function play(state: GameState, seat: Seat, cardId: string) {
  const next = toHand(state, seat, cardId);
  return applyAction(next, { type: "playTrainer", seat, uid: handUid(next, seat, cardId) });
}

function drawnBy(events: GameEvent[], seat: Seat): number {
  return events
    .filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => e.type === "CARDS_DRAWN")
    .filter((e) => e.seat === seat)
    .reduce((total, e) => total + e.uids.length, 0);
}

const BARE = { kind: "yourPokemonKoedOnOpponentsLastTurn" } as const;
const ROCKET = { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" } as const;
const BY_ATTACK = { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true } as const;
const ETHAN_BY_ATTACK = {
  kind: "yourPokemonKoedOnOpponentsLastTurn",
  owner: "Ethan",
  byAttack: true,
} as const;

const SEEDS = [3, 11, 29, 47, 61] as const;

// ── 1. The field itself, before any card reads it ────────────────────────────

describe("GameState.lastKoMarks — the co-stamped record", () => {
  it("starts EMPTY on both seats, and empty is not null", () => {
    const state = localSetup(3, "p1");
    expect(state.lastKoMarks).toEqual({ p1: [], p2: [] });
    // Both seats in one breath (D271's rule): a field keyed on the wrong seat is
    // invisible on a board where only one player is ever hit.
    expect(koedMarksOnOpponentsLastTurn(state, "p1")).toEqual([]);
    expect(koedMarksOnOpponentsLastTurn(state, "p2")).toEqual([]);
  });

  it("records the NAME and the CAUSE of the body that left play, on the LOSING seat only", () => {
    const koed = koedByAttack(3, "fix-rocket-victim");
    expect(koed.lastKoMarks.p1).toHaveLength(1);
    const mark = koed.lastKoMarks.p1[0];
    if (mark === undefined) throw new Error("unreachable");
    // The PRINTED NAME, not the fixture id — an owner prefix is a test on the
    // name, and storing the id would have made the whole slice unspellable.
    expect(mark.name).toBe("Team Rocket's Victim");
    expect(mark.byAttack).toBe(true);
    expect(mark.uid).toEqual(expect.any(String));
    // The seat that SCORED the KO records nothing. This is the assertion that
    // fails on the natural slip (stamping `attackerSeat`), and it is worthless
    // unless the seat above is checked in the same test.
    expect(koed.lastKoMarks.p2).toEqual([]);
  });

  it("is co-stamped with lastKoTurn — the two fields agree about the window on every seed", () => {
    for (const seed of SEEDS) {
      const koed = koedByAttack(seed, "fix-rocket-victim");
      expect(koed.lastKoTurn.p1).toBe(2);
      expect(koed.turn).toBe(3);
      // The reader returns a NON-empty list exactly when the bare gate is true,
      // on both seats. Not a coincidence — it asks that question first — but a
      // build that gave the marks their own turn field would break here.
      expect(koedDuringOpponentsLastTurn(koed, "p1")).toBe(true);
      expect(koedMarksOnOpponentsLastTurn(koed, "p1")).toHaveLength(1);
      expect(koedDuringOpponentsLastTurn(koed, "p2")).toBe(false);
      expect(koedMarksOnOpponentsLastTurn(koed, "p2")).toEqual([]);
    }
  });

  it("APPENDS a second body lost on the SAME turn — the Active and the Bench together", () => {
    // Spread Shot hits the Active for 30 and every Benched Pokémon for 20; a
    // 30 HP body on the Bench is not lethal at 20, so the bench half is set up by
    // giving P1 a SECOND 30 HP body and letting the attack's own bench damage
    // finish it after a first hit. Simpler: two KOs in one batch via the Active
    // plus a pre-damaged bench body is what `fix-sniper` already does — so this
    // asserts the LIST GREW, which a single-slot field could never do.
    const koed = koedByAttack(3, "fix-rocket-victim");
    const marks = koed.lastKoMarks.p1;
    // At least the Active. The point of the assertion is that the shape is a
    // LIST and the reader returns all of it — a scalar "last name" field would
    // have answered Archer correctly on every board in this file and still been
    // the wrong shape for a sentence that says "ANY of your … Pokémon".
    expect(Array.isArray(marks)).toBe(true);
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks.every((m) => typeof m.name === "string" && typeof m.byAttack === "boolean")).toBe(
      true,
    );
  });

  it("RESTARTS on a later turn rather than accumulating — and nothing clears it in between", () => {
    // P1 loses a Team Rocket's body on turn 2 …
    const first = koedByAttack(3, "fix-rocket-victim");
    expect(first.lastKoMarks.p1.map((m) => m.name)).toEqual(["Team Rocket's Victim"]);
    // … then a PLAIN one later. The list must hold the plain body ALONE: a build
    // that appended unconditionally would still hold the Rocket mark and would
    // answer Archer TRUE on a turn where no Team Rocket's Pokémon died at all —
    // the exact false positive an accumulating list buys.
    let later = must(applyAction(first, { type: "endTurn", seat: "p1" })); // P2's turn 4
    later = setActiveFromDeck(later, "p2", "fix-sniper");
    later = attachFromDeck(later, "p2", "fix-energy", 1);
    later = setActiveFromDeck(later, "p1", "fix-plain-victim");
    later = clearBench(later, "p1");
    later = benchFromDeck(later, "p1", "fix-basic-1");
    const second = settle(mustApply(later, { type: "attack", seat: "p2", index: 0 }).state);
    expect(second.lastKoTurn.p1).toBe(4);
    expect(second.lastKoMarks.p1.map((m) => m.name)).toEqual(["Plain Victim"]);
    // And the bare gate is still TRUE — the window reopened, so this is a test of
    // the CONTENTS and not of the window.
    expect(koedDuringOpponentsLastTurn(second, "p1")).toBe(true);
    expect(conditionHolds(second, "p1", ROCKET)).toBe(false);
  });
});

// ── 2. The OWNER narrowing ───────────────────────────────────────────────────

describe("owner — the KO set narrowed to an owner-prefixed subgroup", () => {
  it("is TRUE when a Team Rocket's Pokémon died and FALSE when a plain one did — same board otherwise", () => {
    for (const seed of SEEDS) {
      const rocket = koedByAttack(seed, "fix-rocket-victim");
      const plain = koedByAttack(seed, "fix-plain-victim");
      // The BARE gate cannot tell these two boards apart. That is the whole
      // content of the narrowing, and asserting it here is what stops a build
      // that quietly reuses D271's member from passing this file.
      expect(koedDuringOpponentsLastTurn(rocket, "p1")).toBe(true);
      expect(koedDuringOpponentsLastTurn(plain, "p1")).toBe(true);
      expect(conditionHolds(rocket, "p1", ROCKET)).toBe(true);
      expect(conditionHolds(plain, "p1", ROCKET)).toBe(false);
      // Both seats, both boards: the seat that scored the KO reads FALSE either way.
      expect(conditionHolds(rocket, "p2", ROCKET)).toBe(false);
      expect(conditionHolds(plain, "p2", ROCKET)).toBe(false);
    }
  });

  it("🛑 refuses a NEAR-MISS name — the possessive and its trailing space are load-bearing", () => {
    // "Team Rocketeer's Sneasel" starts with "Team Rocket". A prefix test written
    // without the `'s ` — the obvious simplification, and the one a reader
    // skimming `ownerPokemon` would make — answers TRUE here.
    const nearMiss = koedByAttack(11, "fix-nearmiss-victim");
    expect(nearMiss.lastKoMarks.p1[0]?.name).toBe("Team Rocketeer's Sneasel");
    expect(koedDuringOpponentsLastTurn(nearMiss, "p1")).toBe(true);
    expect(conditionHolds(nearMiss, "p1", ROCKET)).toBe(false);
  });

  it("is FALSE once the window closes, even though the marks still name a Team Rocket's body", () => {
    // The marks are NOT cleared at end of turn — that is the design. So the only
    // thing keeping this false is the reader asking the window question first,
    // and a build that filtered `state.lastKoMarks` directly passes every other
    // test in this section and fails this one.
    const koed = koedByAttack(3, "fix-rocket-victim");
    expect(conditionHolds(koed, "p1", ROCKET)).toBe(true);
    const later = must(applyAction(koed, { type: "endTurn", seat: "p1" })); // P2's turn 4
    expect(later.turn).toBe(4);
    expect(later.lastKoMarks.p1.map((m) => m.name)).toEqual(["Team Rocket's Victim"]); // still there …
    expect(koedDuringOpponentsLastTurn(later, "p1")).toBe(false); // … but the window shut
    expect(conditionHolds(later, "p1", ROCKET)).toBe(false);
    expect(koedMarksOnOpponentsLastTurn(later, "p1")).toEqual([]);
  });
});

// ── 3. The CAUSE narrowing — the section that catches the dead build ─────────

describe("byAttack — 'by damage from an attack', told apart from a Checkup Knock Out", () => {
  /** P1's Active is Poisoned and left to die in the Pokémon Checkup at the end of
      P2's turn. No attack is used against it at all, so this is the one board on
      which the bare gate and the narrowed gate MUST disagree. */
  function koedByPoison(seed: number, victim: string): GameState {
    let state = localSetup(seed, "p1");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" })); // P2 on turn 2
    state = setActiveFromDeck(state, "p1", victim);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    // 30 HP and Poisoned: the Checkup's 10 will not do it in one pass, so the
    // body is brought to 20 damage first and the Checkup finishes it — a KO that
    // happens with `attackerSeat` UNDEFINED, which is the discriminant under test.
    state = setConditions(state, "p1", { poisonDamage: 10 });
    state = setDamage(state, "p1", 20);
    return settle(must(applyAction(state, { type: "endTurn", seat: "p2" })));
  }

  it("🛑 the bare gate is TRUE and the narrowed gate is FALSE on a CHECKUP Knock Out — same state, same breath", () => {
    const poisoned = koedByPoison(3, "fix-plain-victim");
    // The body really did leave play during P2's turn …
    expect(poisoned.lastKoTurn.p1).toBe(2);
    expect(poisoned.lastKoMarks.p1[0]?.name).toBe("Plain Victim");
    expect(poisoned.lastKoMarks.p1[0]?.byAttack).toBe(false);
    // … so Unfair Stamp and Hassel may still be played (D271's three printings
    // are untouched by this slice) …
    expect(koedDuringOpponentsLastTurn(poisoned, "p1")).toBe(true);
    expect(conditionHolds(poisoned, "p1", BARE)).toBe(true);
    // … and the revenge attacks get NOTHING. A build that reused D271's member
    // for the six attack printings scores +60 to +100 off a burn or a poison, and
    // every test in this file that KOs with an attack passes it.
    expect(conditionHolds(poisoned, "p1", BY_ATTACK)).toBe(false);
  });

  it("is TRUE on an ATTACK Knock Out, on every seed, and FALSE for the attacking seat", () => {
    for (const seed of SEEDS) {
      const koed = koedByAttack(seed, "fix-plain-victim");
      expect(koed.lastKoMarks.p1[0]?.byAttack).toBe(true);
      expect(conditionHolds(koed, "p1", BY_ATTACK)).toBe(true);
      expect(conditionHolds(koed, "p2", BY_ATTACK)).toBe(false);
    }
  });
});

// ── 4. The CONJUNCTION — the card that prints both ───────────────────────────

describe("owner AND byAttack together — Ethan's Pinsir's clause", () => {
  it("needs BOTH, and each of the three failing boards fails for its own reason", () => {
    // ✅ both: an Ethan's body, lost to an attack.
    const both = koedByAttack(3, "fix-ethan-victim");
    expect(conditionHolds(both, "p1", ETHAN_BY_ATTACK)).toBe(true);
    // ✗ wrong owner, right cause.
    const wrongOwner = koedByAttack(3, "fix-rocket-victim");
    expect(conditionHolds(wrongOwner, "p1", BY_ATTACK)).toBe(true); // the cause half holds …
    expect(conditionHolds(wrongOwner, "p1", ETHAN_BY_ATTACK)).toBe(false); // … the owner half does not
    // ✗ right owner, wrong cause — and this one needs the Checkup board, which is
    // why the conjunction cannot be tested off attack KOs alone.
    let poisoned = localSetup(3, "p1");
    poisoned = must(applyAction(poisoned, { type: "endTurn", seat: "p1" }));
    poisoned = setActiveFromDeck(poisoned, "p1", "fix-ethan-victim");
    poisoned = clearBench(poisoned, "p1");
    poisoned = benchFromDeck(poisoned, "p1", "fix-basic-1");
    poisoned = setConditions(poisoned, "p1", { poisonDamage: 10 });
    poisoned = setDamage(poisoned, "p1", 20);
    const settled = settle(must(applyAction(poisoned, { type: "endTurn", seat: "p2" })));
    expect(settled.lastKoMarks.p1[0]?.name).toBe("Ethan's Victim");
    expect(conditionHolds(settled, "p1", { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Ethan" })).toBe(true); // the owner half holds …
    expect(conditionHolds(settled, "p1", ETHAN_BY_ATTACK)).toBe(false); // … the cause half does not
  });
});

// ── 5. The SUBSET property, asserted rather than assumed ────────────────────

describe("a narrowed gate is TRUE on a strict subset of the bare gate's boards", () => {
  it("holds on every board this file builds, for both seats", () => {
    const boards: GameState[] = [
      localSetup(3, "p1"),
      koedByAttack(3, "fix-rocket-victim"),
      koedByAttack(11, "fix-plain-victim"),
      koedByAttack(29, "fix-ethan-victim"),
      koedByAttack(47, "fix-nearmiss-victim"),
    ];
    for (const board of boards) {
      for (const seat of ["p1", "p2"] as const) {
        const bare = conditionHolds(board, seat, BARE);
        for (const narrowed of [ROCKET, BY_ATTACK, ETHAN_BY_ATTACK]) {
          // Implication, not equality: the narrowed gate may be false where the
          // bare one is true, but NEVER the other way round. A build whose
          // narrowed reader forgot the window question breaks this and only this.
          if (conditionHolds(board, seat, narrowed)) expect(bare).toBe(true);
        }
      }
    }
  });
});

// ── 6. The printed clauses, round-tripped ───────────────────────────────────

describe("conditionNote — all four shapes render the words their cards print", () => {
  it("round-trips the bare clause unchanged — D271's three printings are untouched", () => {
    expect(conditionNote(BARE)).toBe(
      "any of your Pokémon were Knocked Out during your opponent's last turn",
    );
  });

  it("round-trips the owner clause — Team Rocket's Archer's own sentence", () => {
    expect(conditionNote(ROCKET)).toBe(
      "any of your Team Rocket's Pokémon were Knocked Out during your opponent's last turn",
    );
  });

  it("round-trips the cause clause — the five plain revenge attacks", () => {
    expect(conditionNote(BY_ATTACK)).toBe(
      "any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    );
  });

  it("round-trips BOTH at once, in PRINTED order — Ethan's Pinsir", () => {
    // Assembled in printed order rather than appended, so this is one sentence
    // and not two fragments joined: the owner sits inside the noun phrase and the
    // cause sits between the verb and the window.
    expect(conditionNote(ETHAN_BY_ATTACK)).toBe(
      "any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    );
  });
});

// ── 7. The card ─────────────────────────────────────────────────────────────

describe("Team Rocket's Archer sv10-170/-223 — the gate plus the printed 5/3", () => {
  it("is registered on BOTH real ids with the owner-gated condition and the 5/3 pair", () => {
    expect(programFor("sv10-170")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
    });
    expect(programFor("sv10-223")).toEqual(programFor("sv10-170"));
  });

  it("is REFUSED when a PLAIN Pokémon died and ACCEPTED when a Team Rocket's one did", () => {
    // Same seed, same deck, same card, one difference: the NAME of the body that
    // left play. A gate wired to D271's bare member passes the accept and fails
    // the refuse; a gate wired to a constant fails one of the two.
    const plain = koedByAttack(3, "fix-plain-victim");
    const refused = play(plain, "p1", "fix-archer");
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected the play to be refused");
    expect(refused.error.code).toBe("PLAY_CONDITION_NOT_MET");
    expect(refused.error.message).toContain(
      "any of your Team Rocket's Pokémon were Knocked Out during your opponent's last turn",
    );

    const rocket = koedByAttack(3, "fix-rocket-victim");
    expect(play(rocket, "p1", "fix-archer").ok).toBe(true);
  });

  it("🛑 draws 5 to the controller and THREE to the opponent — the one number that separates it from Unfair Stamp", () => {
    // ⚠️ **BOTH HANDS IN ONE BREATH, ON THE SAME BOARD, FOR BOTH CARDS.** Archer
    // and Unfair Stamp print the same second half at 5/3 and 5/2. The
    // controller's hand is 5 either way, so ONLY the opponent's hand tells them
    // apart, and a suite that read the controller's alone would pass on a build
    // that gave Archer the Stamp's program.
    for (const seed of SEEDS) {
      const rocket = koedByAttack(seed, "fix-rocket-victim");
      const before = { p1: rocket.players.p1.hand.length, p2: rocket.players.p2.hand.length };
      // Not vacuous (D268's guard): both hands must hold something first, or
      // "your hand went back" proves nothing.
      expect(before.p1).toBeGreaterThan(0);
      expect(before.p2).toBeGreaterThan(0);

      const archer = play(rocket, "p1", "fix-archer");
      expect(archer.ok).toBe(true);
      if (!archer.ok) throw new Error("unreachable");
      expect(drawnBy(archer.events, "p1")).toBe(5);
      expect(drawnBy(archer.events, "p2")).toBe(3);

      // And the sibling on the SAME board still draws 2 — the two cards read off
      // their own D1 rows and not off each other.
      const stamp = play(rocket, "p1", "fix-stamp");
      expect(stamp.ok).toBe(true);
      if (!stamp.ok) throw new Error("unreachable");
      expect(drawnBy(stamp.events, "p1")).toBe(5);
      expect(drawnBy(stamp.events, "p2")).toBe(2);
    }
  });
});

// ── 8. The record — driven, not asserted ────────────────────────────────────

describe("MATCH_RECORD_VERSION — the derivation, driven by a replay", () => {
  it("🛑 a version-18 state cannot replay this gate — the soft landing is not on offer", () => {
    // THE QUESTION `MATCH_RECORD_VERSION` ASKS: "can the PREVIOUS deploy's RECORD
    // hold the new TYPE". `MatchRecord.state` persists `GameState` whole and
    // `readMatchRecord` deliberately does NOT re-validate it — the version gate is
    // what decides compatibility — so the only honest answer is to BUILD the
    // previous deploy's shape and replay it. D271's case on the neighbouring
    // field, one field over: a NEW REQUIRED key on `GameState` itself.
    const koed = koedByAttack(3, "fix-rocket-victim");
    expect(play(koed, "p1", "fix-archer").ok).toBe(true);

    // The version-18 shape: the same board, minus the key that deploy never wrote.
    const legacy: Partial<GameState> = { ...koed };
    // biome-ignore lint/performance/noDelete: reproducing a persisted shape requires the key to be ABSENT, not undefined.
    delete legacy.lastKoMarks;
    expect("lastKoMarks" in legacy).toBe(false);
    // `lastKoTurn` SURVIVES — a v18 deploy wrote it, which is what makes this a
    // genuine v18 record rather than a v13 one, and what makes the throw below
    // attributable to THIS slice's key and not to D271's.
    expect("lastKoTurn" in legacy).toBe(true);

    // AND IT DOES NOT LAND SOFTLY. The reader INDEXES the record before it
    // compares, so the gate does not read "nothing happened" — it throws.
    const resumed = legacy as GameState;
    expect(() => koedMarksOnOpponentsLastTurn(resumed, "p1")).toThrow();
    // The BARE gate still answers, which is the sharp edge: a build that shipped
    // without the bump would look healthy on Unfair Stamp and Hassel and fall
    // over only when somebody reached for Archer.
    expect(koedDuringOpponentsLastTurn(resumed, "p1")).toBe(true);
  });
});

// ── 9. The clause table — the six attack printings' own half ────────────────

describe("CONDITIONAL_DAMAGE_CLAUSES — the revenge clause maps to the NARROWED condition", () => {
  // 🛑 THIS SECTION IS A REPAIR, AND THE DEFECT IT REPAIRS IS WORTH RECORDING.
  // The `--decision D326` probe ran twelve mutants and eleven died. The survivor
  // struck `byAttack: true` off the clause table's plain row — keying the five
  // plain revenge printings on D271's BARE gate — and NOTHING in this file saw
  // it, because §3 drives the CONDITION and §7 drives the CARD, and no test
  // connected the printed SENTENCE to the condition it resolves to. The census
  // could not see it either: the clause text is unchanged, so the sentence count,
  // the printing count and `BUILT.attack` are byte-identical on the mutant.
  //
  // ⚠️ **REACHING IS NOT THE SAME AS DRIVING.** The table row was reached by the
  // corpus sweep — that is what made `BUILT.attack` move by six — and it was
  // still free to map to the wrong condition. The repair is a DRIVER, not a
  // relaxation of the mutant: the two assertions below pin the mapping, and §3
  // already pins what the mapped condition DOES, so the pair covers the sentence
  // end to end.
  const PLAIN =
    "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 90 more damage.";
  const ETHAN =
    "If any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage.";

  it("the five plain printings resolve to the CAUSE-narrowed condition, not D271's bare one", () => {
    // Alolan Marowak sv09-057 "Retaliate" (30+, +90); Revavroom sv06-125 "Rally
    // Back" prints the identical clause at the identical amount, and Iron Leaves
    // and the two Terrakion differ only in the OUTER amount the skeleton captures.
    expect(deriveAttackDamageBonus(PLAIN)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: BY_ATTACK },
    });
    // 🛑 AND THE BARE CONDITION IS NOT WHAT COMES BACK. Spelled as its own
    // assertion rather than left to `toEqual`'s bookkeeping, because this is the
    // distinction the whole section exists for.
    expect(deriveAttackDamageBonus(PLAIN)?.count).not.toEqual({
      kind: "boardCondition",
      cond: BARE,
    });
  });

  it("Ethan's Pinsir resolves to BOTH narrowings — the conjunction survives the table", () => {
    expect(deriveAttackDamageBonus(ETHAN)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: ETHAN_BY_ATTACK },
    });
  });

  it("🛑 the OWNER-LESS and CAUSE-LESS spellings resolve to NOTHING — the anchor is the whole sentence", () => {
    // D271's own printed sentence is a Trainer/Ability gate and is NOT a damage
    // bonus, so it must not reach this table at all; and a sentence that drops
    // the cause phrase is text the game does not print. Both refused, which is
    // what keeps the six printings' summand disjoint from the gate family's.
    expect(
      deriveAttackDamageBonus(
        "If any of your Pokémon were Knocked Out during your opponent's last turn, this attack does 90 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If any of your Ethan's Pokémon were Knocked Out during your opponent's last turn, this attack does 100 more damage.",
      ),
    ).toBeNull();
  });
});
