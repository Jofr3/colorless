import { describe, expect, it } from "vitest";
import { hasRuleBox, pokemonSuffixOf, prizeValueOf } from "./cards";
import { lockedAttackIndexes } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PER_ATTACK_LOCK_DECK,
  RADIANT_LOCK_DECK,
  activeUid,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.101.0 → 0.102.0 — the PER-ATTACK LOCK (P3-M5 long tail, D154):
//
//   "During your next turn, this Pokémon can't use {AttackName}."
//
// Taken as item 1 of D153's remainder list, which had carried it as "the single
// best next item" for three slices — the largest unread count left in the tail.
//
// ⚠️ THE COUNT — AND THIS HEADER IS NOW THE RECORD OF A CORRECTION THAT WAS
// ITSELF WRONG, WHICH IS THE MOST USEFUL THING ON IT.
//
// Every list since §D143 said "8 printings / 6 sentences" on the self side, naming
// Radiant Charizard swsh10.5-011 and Radiant Blastoise swsh10.5-018 beside six
// sv-era ids. D154 queried, found FIVE sets and no `swsh10.5` row at all, and
// corrected the figure DOWN to "6 printings / 4 names". **That correction was an
// artefact of a database that had quietly lost a set**: the local D1 had dropped
// all 88 `swsh10.5` rows to an uncheckpointed WAL between 2026-08-02 and
// 2026-08-03, D160 re-ingested and checkpointed them, and the census re-run
// against the restored catalog returns
//
//   LIKE '%During your next turn, this Pokémon can''t use %'  (all 3 text columns)
//     → 8 rows across 6 NAMES  (local D1, 2026-08-03, 978 cards / 6 sets)
//
// — Lucario sv01-114, Skarmory sv03-142, Greedent ex sv03-179, Munkidori ex
// sv06.5-037/-083/-091, Radiant Charizard swsh10.5-011 and Radiant Blastoise
// swsh10.5-018 — which is §D143's inherited figure EXACTLY. Re-measured at D162
// and re-confirmed row by row, not inherited back.
//
// So D154's lesson stands and gains a second half. The first: **a query cannot see
// a set the database does not have, and nothing about its result says so — a
// census owes its SCOPE, not only its count.** The second, which cost three slices
// to learn: **a query that returns fewer rows than a predecessor is evidence about
// the DATABASE before it is evidence about the predecessor.** D154 corrected an
// inherited number downward on good evidence and was wrong; the honest reading is
// that neither number was ever wrong, they were scopeless.
//
// swsh10.5-018 was fielded throughout (a printing of FIXTURE-POOL provenance for
// as long as its row was missing, and catalogued again since D160); swsh10.5-011
// was in no fixture until D162, whose whole content is that fixture — see the
// section at the foot of this file.
//
// Four things the slice turns on:
//
//   • THE RECORD IS AN ADDRESS, NOT A NUMBER. `InPlayPokemon.lockedAttack` is
//     `{ turn, attackIndex }` — the first durated field in the family that is not
//     a bare stamp or an amount. Its three read sites COMPARE it; nothing sums it;
//   • IT IS A SEPARATE OP AND A SEPARATE FIELD, and both refusals are D131's
//     widen-don't-add test run in the direction that says NO. Stripping `attack`
//     from a hypothetical `preventAttack { attack? }` does not yield the previous
//     arm, and one `attackLockedTurn`-shaped record cannot hold both facts, which
//     is REACHABLE and is driven below on one body on one turn;
//   • IT GATES AN ACTION, so it owes the §8 gate AND both payability projections
//     (`redactedAttacksOf`, GameHud) — and it is the FIRST durated field to owe
//     them, which is the premise §D147's trigger (b) had never met;
//   • THE STAMP IS `state.turn + 2`, D143's number: the sentence prints "During
//     YOUR next turn", so the window is the holder's own. Driven across real turn
//     boundaries rather than asserted off the field.

/** The SIX catalogued sentences, byte-for-byte off the local D1 rows — six names
    over eight rows (Munkidori ex's three rarities are byte-identical). All six are
    catalogued as of D160's re-ingest; the last two were the set the database lost,
    and they are grouped with the rest rather than kept apart because their
    provenance is now the same as everybody else's. */
const SLASHING_STEEL = "During your next turn, this Pokémon can't use Slashing Steel.";
const DIRTY_HEADBUTT = "During your next turn, this Pokémon can't use Dirty Headbutt.";
const SLIP_N_ROLL = "During your next turn, this Pokémon can't use Slip 'n' Roll.";
const ACCELERATING_STAB = "During your next turn, this Pokémon can't use Accelerating Stab.";
const TORRENTIAL_CANNON = "During your next turn, this Pokémon can't use Torrential Cannon.";
/** …and the sixth name, fielded at D162 — the last one to have no fixture. */
const COMBUSTION_BLAST = "During your next turn, this Pokémon can't use Combustion Blast.";

/** Skarmory sv03-142's two attack indices. THE headline pair: the bar lands on
    index 1 and index 0 stays legal, which is the whole difference from D143. */
const SLASHING_STEEL_INDEX = 1;
const PECK_INDEX = 0;
/** Radiant Charizard swsh10.5-011's ONLY attack index — where the bar covers the
    whole card and the panel, which is the cell D143's lock also produces. */
const COMBUSTION_BLAST_INDEX = 0;

/** One seed for the whole suite: nothing in this family flips a coin — none of
    the five printings carries one — so a seed table would describe a shuffle
    rather than a rule (D143's move, inherited by every durated slice since). */
const SEED = 13;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The error code a declaration comes back with, or `null` when it applies. */
function refusal(state: GameState, seat: Seat, index: number): string | null {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    BARRER goes on P1's Active with the energy its named attack costs; P2 fields
    fix-titan (340 HP, NO attacks) so nothing in this suite ends in
    `ko:takePrizes` before a window opens. */
function ready(
  barrer: string,
  energy: { id: string; count: number }[] = [
    { id: "fix-metal-energy", count: 2 },
    { id: "fix-energy", count: 1 },
  ],
): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: PER_ATTACK_LOCK_DECK, p2: PER_ATTACK_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", barrer);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  for (const { id, count } of energy) state = attachFromDeck(state, "p1", id, count);
  return state;
}

/** `ready`, then the named attack DECLARED — asserting the row actually landed,
    so a board that failed to bar can never leave a case asserting "nothing was
    refused" against nothing. Returns P2's turn (the turn BEFORE the window). */
function barred(barrer: string, index: number, energy?: { id: string; count: number }[]) {
  const { state, events } = mustApply(ready(barrer, energy), {
    type: "attack",
    seat: "p1",
    index,
  });
  const row = find(events, "ATTACK_LOCKED");
  if (row === undefined) throw new Error(`${barrer} idx ${String(index)} barred nothing`);
  return { state, events, row };
}

/** …and one more turn on, which IS the window (the stamp is `+ 2`). */
function inWindow(state: GameState): GameState {
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY: write a `lockedAttack` record directly, for the two cases no
    printing reaches (an unresolvable name, and a second install landing on a live
    record). Said so rather than skipped, per the family's standing rule. */
function setLock(state: GameState, seat: Seat, lock: InPlayPokemon["lockedAttacks"]): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, lockedAttacks: lock } } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The datum: the catalog rows, the fixtures, and the deriver.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried per printing, not inherited", () => {
  it("carries every barrer's NAME, attack INDEX and effect string verbatim", () => {
    // ⚠️ EVERY FIELD, INCLUDING THE ONES THE ROW DOES NOT HAVE (D151's rule after
    // 40 pool fixtures turned out to be missing a printed Ability or attack). All
    // four of these cards are NEW to the pool at D154, so there is no partial
    // fixture to inherit — but the absences are asserted anyway, because that is
    // the assertion a later completion would move.
    const skarmory = FIXTURE_POOL["sv03-142"];
    expect(skarmory?.name).toBe("Skarmory");
    expect(skarmory?.hp).toBe(120);
    expect(skarmory?.stage).toBe("Basic");
    expect(skarmory?.types).toEqual(["Metal"]);
    expect(skarmory?.retreat).toBe(1);
    expect(skarmory?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(skarmory?.resistances).toEqual([{ type: "Fighting", value: "-30" }]);
    expect(skarmory?.abilities ?? null).toBeNull();
    expect(skarmory?.evolveFrom ?? null).toBeNull();
    expect(skarmory?.attacks?.[SLASHING_STEEL_INDEX]).toEqual({
      cost: ["Metal", "Metal", "Colorless"],
      name: "Slashing Steel",
      damage: 120,
      effect: SLASHING_STEEL,
    });
    // …and the sibling this whole slice exists to leave alone.
    expect(skarmory?.attacks?.[PECK_INDEX]).toEqual({
      cost: ["Colorless"],
      name: "Peck",
      damage: 20,
    });

    const munkidori = FIXTURE_POOL["sv06.5-037"];
    expect(munkidori?.name).toBe("Munkidori ex");
    expect(munkidori?.hp).toBe(210);
    expect(munkidori?.stage).toBe("Basic");
    expect(munkidori?.types).toEqual(["Darkness"]);
    expect(munkidori?.retreat).toBe(1);
    expect(munkidori?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(munkidori?.resistances ?? null).toBeNull();
    // Its printed Ability IS on the fixture though nothing reads it — the fixture
    // carries what the card prints, which is the rule that avoids both of D151's
    // failure modes at once.
    expect(munkidori?.abilities?.[0]?.name).toBe("Oh No You Don't");
    expect(munkidori?.attacks).toHaveLength(1);
    expect(munkidori?.attacks?.[0]?.name).toBe("Dirty Headbutt");
    expect(munkidori?.attacks?.[0]?.damage).toBe(190);
    expect(munkidori?.attacks?.[0]?.effect).toBe(DIRTY_HEADBUTT);

    const greedent = FIXTURE_POOL["sv03-179"];
    expect(greedent?.name).toBe("Greedent ex");
    expect(greedent?.hp).toBe(260);
    expect(greedent?.stage).toBe("Stage1");
    expect(greedent?.evolveFrom).toBe("Skwovet");
    expect(greedent?.types).toEqual(["Colorless"]);
    expect(greedent?.retreat).toBe(2);
    expect(greedent?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(greedent?.resistances ?? null).toBeNull();
    expect(greedent?.abilities ?? null).toBeNull();
    expect(greedent?.attacks?.[1]?.name).toBe("Slip 'n' Roll");
    expect(greedent?.attacks?.[1]?.damage).toBe(210);
    expect(greedent?.attacks?.[1]?.effect).toBe(SLIP_N_ROLL);

    const lucario = FIXTURE_POOL["sv01-114"];
    expect(lucario?.name).toBe("Lucario");
    expect(lucario?.hp).toBe(130);
    expect(lucario?.stage).toBe("Stage1");
    expect(lucario?.evolveFrom).toBe("Riolu");
    expect(lucario?.types).toEqual(["Fighting"]);
    expect(lucario?.retreat).toBe(2);
    expect(lucario?.weaknesses).toEqual([{ type: "Psychic", value: "×2" }]);
    expect(lucario?.resistances ?? null).toBeNull();
    expect(lucario?.abilities ?? null).toBeNull();
    expect(lucario?.attacks?.[1]?.name).toBe("Accelerating Stab");
    expect(lucario?.attacks?.[1]?.effect).toBe(ACCELERATING_STAB);
  });

  it("the INDEX is not constant across the family — the trap, on six printings", () => {
    // D144 found it, D146 sharpened it, D147 and D152 each hit it again: a suite
    // that assumed one index would simulate the wrong attack on most of a family.
    // Here it is worse than a test hazard, because the ENGINE stores the index —
    // so this is the datum the install resolves, asserted card by card.
    const at = (id: string, name: string) =>
      FIXTURE_POOL[id]?.attacks?.findIndex((a) => a.name === name);
    expect(at("sv06.5-037", "Dirty Headbutt")).toBe(0);
    expect(at("swsh10.5-018", "Torrential Cannon")).toBe(0);
    expect(at("swsh10.5-011", "Combustion Blast")).toBe(0);
    expect(at("sv01-114", "Accelerating Stab")).toBe(1);
    expect(at("sv03-142", "Slashing Steel")).toBe(1);
    expect(at("sv03-179", "Slip 'n' Roll")).toBe(1);
  });

  it("derives ONE op with the printed NAME captured, on all six printings", () => {
    expect(deriveAttackEffect(SLASHING_STEEL)).toEqual([
      { op: "preventAttackUse", attack: "Slashing Steel" },
    ]);
    expect(deriveAttackEffect(DIRTY_HEADBUTT)).toEqual([
      { op: "preventAttackUse", attack: "Dirty Headbutt" },
    ]);
    expect(deriveAttackEffect(ACCELERATING_STAB)).toEqual([
      { op: "preventAttackUse", attack: "Accelerating Stab" },
    ]);
    expect(deriveAttackEffect(TORRENTIAL_CANNON)).toEqual([
      { op: "preventAttackUse", attack: "Torrential Cannon" },
    ]);
    // …and the sixth name, whose printing this anchor could not be tested against
    // for the length of the outage. The anchor did not change to admit it.
    expect(deriveAttackEffect(COMBUSTION_BLAST)).toEqual([
      { op: "preventAttackUse", attack: "Combustion Blast" },
    ]);
    // …and the apostrophe one, whose captured noun carries TWO of them. The
    // fold's own round trip is `clauseApostrophe.test.ts`'s sweep; what this line
    // pins is that the STRAIGHT spelling — the one the catalog actually prints —
    // reaches the op unaltered.
    expect(deriveAttackEffect(SLIP_N_ROLL)).toEqual([
      { op: "preventAttackUse", attack: "Slip 'n' Roll" },
    ]);
  });

  it("the anchor refuses the whole neighbourhood, and each refusal is a warrant", () => {
    for (const text of [
      // The thirteen once-per-turn ABILITY limiters the census turned up — the
      // largest group matching `can't use` in the pool, refused by the capitalised
      // "During" plus `^…$` before anything else is considered.
      "Once during your turn, you may search your deck for a card and put it into your hand. Then, shuffle your deck. You can't use more than 1 Quick Search Ability each turn.",
      // …a TRAINER play gate wearing the same words (Rare Candy sv01-191).
      "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.",
      // …and the empty capture, which no card prints. It is refused by the
      // QUANTIFIER rather than by a guard, and that is stated here because a guard
      // WAS written for it and mutation-checking showed removing it failed
      // nothing: `(.+?)` cannot match an empty string, so the claim is pinned at
      // the place it is actually true.
      "During your next turn, this Pokémon can't use .",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // …and the WHOLE-POKÉMON lock one verb away (D143), which is asserted as a
    // DIFFERENT PROGRAM rather than as a null: it derives, it must keep deriving,
    // and the claim worth making is that the two anchors produce two different ops
    // from two sentences that differ in three words. A `toBeNull` here would have
    // been false; a drift between them is invisible on any board.
    expect(deriveAttackEffect("During your next turn, this Pokémon can't attack.")).toEqual([
      { op: "preventAttack" },
    ]);
    // …and the row that MOVED AT D155 — the durated per-attack BUFF this suite
    // carried as a `toBeNull` warrant (Seismitoad sv03-052 "Echoed Voice"). It
    // took exactly the addressing this slice built and reads at D149's pre-W/R
    // step, so it now derives, and it is asserted as a DIFFERENT OP for the same
    // reason the whole-Pokémon lock above is: the two sentences share their first
    // four words, their holder and their `+ 2` window, and differ only in the
    // verb — which no board can tell apart if a reader drifts between them.
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "boostAttack", attack: "Echoed Voice", amount: 100 }]);
    // …and the row that MOVED AT D157, which is the one this slice's own doc block
    // named as explicitly out of scope: the OPPONENT-side twin (Medicham sv01-111
    // "Acu-Punch-Ture", Oranguru sv02-094 "Plotter's Command"). It derives a THIRD
    // op with NO capture — the address is a PARK — and it is asserted here rather
    // than deleted because it is the sharpest warrant this file has: that op
    // writes the SAME `lockedAttack` record this one does, so a reader that
    // drifted between the two anchors would produce a board where the right
    // durated fact sits on the WRONG SEAT, which no assertion about the record's
    // shape can see.
    expect(
      deriveAttackEffect(
        "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      ),
    ).toEqual([{ op: "preventChosenAttack" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The install: the record, the row, and the `+ 2` window.
// ─────────────────────────────────────────────────────────────────────────────

describe("the install — the address is resolved once, at the site that owns the noun", () => {
  it("stamps { turn: +2, attackIndex } and names the attack on the row", () => {
    const before = ready("sv03-142");
    expect(before.turn).toBe(2);
    const uid = activeUid(before, "p1");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: SLASHING_STEEL_INDEX,
    });
    expect(find(events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid,
      attack: "Slashing Steel",
    });
    // The RECORD, and the two halves of it are two different claims: the stamp is
    // the installing turn + 2 (D143's number, the holder's own next turn), and the
    // index is the resolution of the printed noun.
    expect(state.players.p1.active?.lockedAttacks).toEqual([
      {
        turn: 2 + 2,
        attackIndex: SLASHING_STEEL_INDEX,
      },
    ]);
    // …and NOT the whole-Pokémon lock, which is the field a widening would have
    // written and the one thing no board can tell apart from the record.
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
  });

  it("the ROW ORDER is the printed order — the damage, then the drawback", () => {
    const { events } = barred("sv03-142", SLASHING_STEEL_INDEX);
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeGreaterThan(-1);
    expect(order.indexOf("ATTACK_LOCKED")).toBeGreaterThan(order.indexOf("DAMAGE_DEALT"));
  });

  it("resolves the index PER CARD, never a constant", () => {
    // The trap asserted on the ENGINE rather than on the fixtures: three of the
    // five printings stamp 1 and two stamp 0, and a build that hardcoded either
    // would be right on part of the family with nothing red.
    const skarmory = barred("sv03-142", SLASHING_STEEL_INDEX).state;
    expect(skarmory.players.p1.active?.lockedAttacks.at(-1)?.attackIndex).toBe(1);
    const munkidori = barred("sv06.5-037", 0, [
      { id: "fix-dark-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]).state;
    expect(munkidori.players.p1.active?.lockedAttacks.at(-1)?.attackIndex).toBe(0);
    const greedent = barred("sv03-179", 1, [{ id: "fix-energy", count: 3 }]).state;
    expect(greedent.players.p1.active?.lockedAttacks.at(-1)?.attackIndex).toBe(1);
    const lucario = barred("sv01-114", 1, [
      { id: "fix-fighting-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ]).state;
    expect(lucario.players.p1.active?.lockedAttacks.at(-1)?.attackIndex).toBe(1);
  });

  it("carries the APOSTROPHE name end to end, from the sentence to the log row", () => {
    // Greedent ex is the only printing in the pool whose captured noun carries
    // punctuation, and it exercises three separate spellings of one name: the
    // sentence's, the op's (folded), and the attack row's (as printed). The log
    // prints the CARD's, because a log row is read by a player holding the card.
    const { state, row } = barred("sv03-179", 1, [{ id: "fix-energy", count: 3 }]);
    expect(row.attack).toBe("Slip 'n' Roll");
    expect(render([row], state)).toEqual([
      { who: "p1", text: "Greedent ex can't use Slip 'n' Roll next turn" },
    ]);
  });

  it("matches a CURLY printed attack name — the re-ingest, driven on a card", () => {
    // ⚠️ THE FOLD IS TWO FOLDS, AND THIS CASE IS THE SECOND ONE. The deriver folds
    // its capture (pinned by `clauseApostrophe.test.ts`, which rewrites the
    // SENTENCE); the install folds the HOLDER's printed `name` before comparing.
    // Mutation-checking found the second one free — every catalogued printing
    // spells both halves straight, so no board could tell — which is exactly the
    // "a test that forces a question does not check the answer" shape D150 fixed
    // for the §11 table. A punctuation normaliser rewrites the attack ROW as well
    // as the effect string, and `fix-curly-barrer` is that card.
    const { state, row } = barred("fix-curly-barrer", 1, [{ id: "fix-energy", count: 2 }]);
    expect(state.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    // The op carried the FOLDED noun; the row carries the CARD's own spelling,
    // because a log row is read by a player holding the card.
    expect(row.attack).toBe("Slip ’n’ Roll");
    const window = inWindow(state);
    expect(refusal(window, "p1", 1)).toBe("ATTACK_PREVENTED");
    expect(refusal(window, "p1", 0)).toBeNull();
  });

  it("installs NOTHING when the printed name matches no attack on the holder", () => {
    // Unreachable off every printing — all five name their own attack — so it is
    // CONSTRUCTED and said so. The alternative shapes are both worse: an index of
    // −1 puts a value into a persisted record no read site can act on, and a row
    // emitted anyway tells a player about a drawback that cannot bite.
    const before = ready("sv03-142");
    const { state } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: SLASHING_STEEL_INDEX,
    });
    expect(state.players.p1.active?.lockedAttacks).not.toEqual([]);
    // …now the same op with a name Skarmory does not print, fed through the same
    // deriver so the op is the real shape and only the noun is constructed.
    const bogus = deriveAttackEffect("During your next turn, this Pokémon can't use Hydro Pump.");
    expect(bogus).toEqual([{ op: "preventAttackUse", attack: "Hydro Pump" }]);
    const events2: GameEvent[] = [];
    const after = runOne(before, bogus ?? [], events2);
    expect(after.players.p1.active?.lockedAttacks ?? []).toEqual([]);
    expect(events2).toEqual([]);
  });

  it("never PARKS and consumes no rng", () => {
    const before = ready("sv03-142");
    const { state } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: SLASHING_STEEL_INDEX,
    });
    // The declaration ENDS the turn (§5.3) rather than parking on a choice, and no
    // coin was flipped — the whole family is seed-free for that reason.
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.rngState).toBe(before.rngState);
  });

  it("a re-install that says the SAME thing is silent, a different index is ADDED", () => {
    // Both cases are CONSTRUCTED *for this op*: installing needs an attack, an
    // attack ends the turn, and the window is the holder's own next turn — on
    // which the only attack that could re-install is the very one this record
    // bars. So a second install of THIS op can never land on a live record of
    // THIS op, and the surgery says which of the two rules `addLockedAttack`
    // implements.
    //
    // ⚠️ D165 CHANGED THE SECOND HALF OF THIS CASE, AND THE CHANGE IS THE FIX.
    // It used to assert that a differing index REPLACED the record, on the
    // reasoning that "a later install always stamps a later turn" — true of this
    // op about itself and false about the FIELD, which `lockDefenderAttack` also
    // writes at `+ 1`. The played collision is in `lockedAttackMerge.test.ts`;
    // what is pinned here is that the merge rule is APPENDING at its own site too,
    // so a reader cannot conclude from this file that the last write wins.
    const state = setLock(ready("sv03-142"), "p1", [{ turn: 4, attackIndex: 1 }]);
    const same: GameEvent[] = [];
    const unchanged = runOne(state, [{ op: "preventAttackUse", attack: "Slashing Steel" }], same);
    expect(same).toEqual([]);
    expect(unchanged.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    const moved: GameEvent[] = [];
    const rewritten = runOne(state, [{ op: "preventAttackUse", attack: "Peck" }], moved);
    expect(types(moved)).toEqual(["ATTACK_LOCKED"]);
    expect(rewritten.players.p1.active?.lockedAttacks).toEqual([
      { turn: 4, attackIndex: 1 },
      { turn: 4, attackIndex: 0 },
    ]);
    // …and BOTH are live in the window, which is what "added" means where
    // "replaced" would have quietly meant "one of them was thrown away".
    let window = must(applyAction(rewritten, { type: "endTurn", seat: "p1" }));
    window = must(applyAction(window, { type: "endTurn", seat: "p2" }));
    expect(window.turn).toBe(4);
    expect(lockedAttackIndexes(window, must0(window.players.p1.active))).toEqual([1, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The window: `+ 2`, driven across real turn boundaries.
// ─────────────────────────────────────────────────────────────────────────────

describe("the window is the HOLDER's own next turn — driven, not asserted", () => {
  it("is not live on the turn in between, is live on the holder's next, and expires", () => {
    const { state } = barred("sv03-142", SLASHING_STEEL_INDEX);
    // Turn 3 belongs to the OPPONENT: the stamp is 4, so the reader says nothing.
    expect(state.turn).toBe(3);
    expect(lockedAttackIndexes(state, must0(state.players.p1.active))).toEqual([]);
    // Turn 4 is the holder's own next turn — the window.
    const window = inWindow(state);
    expect(window.turn).toBe(4);
    expect(lockedAttackIndexes(window, must0(window.players.p1.active))).toEqual([
      SLASHING_STEEL_INDEX,
    ]);
    // …and it expires by arithmetic, with nothing having cleared it: the record is
    // STILL THERE two turns later and simply stops answering.
    let later = must(applyAction(window, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(6);
    expect(later.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([]);
  });

  it("a `+ 1` stamp would be a drawback that never bites — the failure D143 named", () => {
    // Stated as a board rather than as arithmetic: turn 3 is the opponent's, so a
    // window stamped there is a window its holder could not have acted in anyway.
    const { state } = barred("sv03-142", SLASHING_STEEL_INDEX);
    const wrong = setLock(state, "p1", [{ turn: state.turn, attackIndex: 1 }]);
    const window = inWindow(wrong);
    expect(lockedAttackIndexes(window, must0(window.players.p1.active))).toEqual([]);
    expect(refusal(window, "p1", SLASHING_STEEL_INDEX)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE HEADLINE: the bar is on the ATTACK, and the card's other attack is legal.
// ─────────────────────────────────────────────────────────────────────────────

describe("the bar is on the ATTACK — the claim D143's field could not make", () => {
  it("refuses the named attack and ALLOWS the sibling, on one board", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    expect(refusal(window, "p1", SLASHING_STEEL_INDEX)).toBe("ATTACK_PREVENTED");
    // …and this is the assertion the whole slice exists for: Peck applies.
    const { events } = mustApply(window, { type: "attack", seat: "p1", index: PECK_INDEX });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("the refusal NAMES the barred attack, which the whole-Pokémon one cannot", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const result = applyAction(window, {
      type: "attack",
      seat: "p1",
      index: SLASHING_STEEL_INDEX,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ATTACK_PREVENTED");
      // The message is the only thing that tells the player their OTHER attack is
      // still available, which is the reason it differs from D143's.
      expect(result.error.message).toContain("Slashing Steel");
    }
  });

  it("a BAD index still reports the index — the gate order, stated as a board", () => {
    // The bar is asked AFTER the index check on purpose: a bogus index on a barred
    // Pokémon must report the index, not the bar. Swap the two gates and this is
    // the only case that moves.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    expect(refusal(window, "p1", 7)).toBe("BAD_ATTACK_INDEX");
  });

  it("is TOTAL over the family — every printing bars its own name and no other", () => {
    const cases: {
      id: string;
      index: number;
      other: number | null;
      energy: { id: string; count: number }[];
    }[] = [
      {
        id: "sv03-142",
        index: 1,
        other: 0,
        energy: [
          { id: "fix-metal-energy", count: 2 },
          { id: "fix-energy", count: 1 },
        ],
      },
      // Munkidori ex's card has ONE attack, so the bar and a whole-Pokémon lock are
      // observationally identical HERE — which is exactly why it is in the sweep:
      // a reader that confused the two would be right on this row.
      {
        id: "sv06.5-037",
        index: 0,
        other: null,
        energy: [
          { id: "fix-dark-energy", count: 2 },
          { id: "fix-energy", count: 1 },
        ],
      },
      { id: "sv03-179", index: 1, other: 0, energy: [{ id: "fix-energy", count: 3 }] },
      {
        id: "sv01-114",
        index: 1,
        other: 0,
        energy: [
          { id: "fix-fighting-energy", count: 1 },
          { id: "fix-energy", count: 2 },
        ],
      },
      // The uncatalogued printing, driven beside the four catalogued ones and
      // labelled as such — its provenance is `FIXTURE_POOL`, not the D1.
      {
        id: "swsh10.5-018",
        index: 0,
        other: null,
        energy: [
          { id: "fix-water-energy", count: 2 },
          { id: "fix-energy", count: 1 },
        ],
      },
    ];
    for (const { id, index, other, energy } of cases) {
      const window = inWindow(barred(id, index, energy).state);
      expect(lockedAttackIndexes(window, must0(window.players.p1.active)), id).toEqual([index]);
      expect(refusal(window, "p1", index), id).toBe("ATTACK_PREVENTED");
      if (other !== null) {
        // The sibling is legal — and it is asserted as APPLYING rather than as
        // "not ATTACK_PREVENTED", because an unpayable cost would satisfy the
        // weaker claim while hiding the same bug.
        expect(refusal(window, "p1", other), id).toBeNull();
      }
    }
  });

  it("leaves the sibling's own reader alone — Lucario's index-0 clause still reads", () => {
    // Lucario is the printing whose OTHER attack is handed to a DIFFERENT reader
    // (`deriveAttackDamageBonus`, D115's family). Barring index 1 must not disturb
    // it, which is the strongest form of "the bar is on the ATTACK" this pool can
    // print: two readers, one card, one barred index.
    const window = inWindow(
      barred("sv01-114", 1, [
        { id: "fix-fighting-energy", count: 1 },
        { id: "fix-energy", count: 2 },
      ]).state,
    );
    const { events } = mustApply(window, { type: "attack", seat: "p1", index: 0 });
    // Its clause is UNMAPPED — the model keeps no last-turn KO record, and
    // `conditionClause.test.ts` pins that fall-through — so the honest reading of
    // index 0 is a printed 30 with the modifier declared SKIPPED. BOTH halves are
    // asserted, because the claim is that barring index 1 changed neither: the
    // LOUD row still fires and the printed base still lands.
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coexistence: the reachability argument for TWO fields, driven.
// ─────────────────────────────────────────────────────────────────────────────

describe("one body carries BOTH locks on ONE turn — why the record is not shared", () => {
  it("a self-barred Greedent ex locked WHOLE by Eiscue ex keeps both facts", () => {
    // THE ARGUMENT FOR A SECOND FIELD, AS A BOARD. Greedent ex bars its own
    // "Slip 'n' Roll" on turn 2 (stamp 4). On turn 3 the opponent's Eiscue ex
    // "Scalding Block" writes D148's whole-Pokémon lock onto the same body with
    // stamp 4 (`state.turn + 1`, the defender arm). On turn 4 BOTH are live — and
    // one `{ turn, attackIndex? }` record could have held only the later write.
    //
    // ⚠️ THE BARRER IS GREEDENT EX RATHER THAN SKARMORY, AND THE REASON IS THE
    // CARD: "Scalding Block" deals a printed 160 and Skarmory has 120 HP, so the
    // board this argument needs is one where the locked body SURVIVES being
    // locked. Greedent ex's 260 is the only printing in the family that does.
    const state = barred("sv03-179", 1, [{ id: "fix-energy", count: 3 }]).state;
    expect(state.turn).toBe(3);
    let p2 = setActiveFromDeck(state, "p2", "sv03-042");
    p2 = attachFromDeck(p2, "p2", "fix-water-energy", 3);
    const { state: locked, events } = mustApply(p2, { type: "attack", seat: "p2", index: 0 });
    // The whole-Pokémon lock landed on P1's Greedent ex, and the per-attack record
    // it was already carrying is untouched beside it.
    expect(find(events, "ATTACK_LOCKED")?.seat).toBe("p1");
    expect(locked.players.p1.active?.attackLockedTurn).toBe(4);
    expect(locked.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    // …and on the shared window BOTH bite: the whole lock refuses EVERY index —
    // including index 0, which the per-attack record leaves alone — and the
    // per-attack record is still there, still live, still naming index 1.
    // No `inWindow` here: declaring ENDED P2's turn (§5.3), so `locked` IS turn 4
    // already — which is the arithmetic the two stamps were chosen to collide on.
    expect(locked.turn).toBe(4);
    expect(refusal(locked, "p1", 0)).toBe("ATTACK_PREVENTED");
    expect(lockedAttackIndexes(locked, must0(locked.players.p1.active))).toEqual([1]);
  });

  it("…and the two rows read differently in the log, under the SAME seat", () => {
    // The pair is the voice answer: D148's row renders under the LOCKED player's
    // name and so does this one, but they must not say the same thing — one bars a
    // Pokémon and one bars an attack, and both are rendered here and READ.
    const state = barred("sv03-179", 1, [{ id: "fix-energy", count: 3 }]);
    let p2 = setActiveFromDeck(state.state, "p2", "sv03-042");
    p2 = attachFromDeck(p2, "p2", "fix-water-energy", 3);
    const { state: locked, events } = mustApply(p2, { type: "attack", seat: "p2", index: 0 });
    // Both rows render under P1 — the seat that owns the LOCKED Pokémon (D136's
    // finding 1), which is the ACTOR on the first and the VICTIM on the second.
    // One seat rule, two agencies, and the wordings differ because what is true
    // differs: a bare "can't attack next turn" on the first row would be FALSE,
    // Greedent ex's index 0 still being legal at that moment.
    expect(render([state.row], state.state)).toEqual([
      { who: "p1", text: "Greedent ex can't use Slip 'n' Roll next turn" },
    ]);
    const whole = find(events, "ATTACK_LOCKED");
    expect(whole).toBeDefined();
    expect(render(whole === undefined ? [] : [whole], locked)).toEqual([
      { who: "p1", text: "Greedent ex can't attack next turn" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the three early clears, SWEPT rather than listed.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 sheds it — the three clears, and the sweep that keeps them together", () => {
  it("EVOLVING inside the window frees the barred attack — a played line", () => {
    // The window is the HOLDER's own next turn, so this is a line a player takes
    // rather than a surgery (contrast D142/D147/D152, whose windows belong to the
    // opponent). And the failure it rules out is not "still barred": the evolved
    // body has ONE attack, so a stale index would point at nothing at all.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    expect(window.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 1 }]);
    const held = handFromDeck(window, "p1", "fix-skarm-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-skarm-stage1"),
      target: { spot: "active" },
    });
    expect(evolved.players.p1.active?.lockedAttacks).toEqual([]);
    // …and the evolved body attacks the same turn, which is the printed line
    // rather than a leniency: §10 sheds the effects of ATTACKS, and this is one.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("RETREATING inside the window sheds it — the holder's own route", () => {
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const bench = window.players.p1.bench;
    expect(bench.length).toBeGreaterThan(0);
    const { state: retreated } = mustApply(window, {
      type: "retreat",
      seat: "p1",
      // Skarmory's printed retreat is 1, so exactly one attached energy pays it.
      discardEnergy: must0(window.players.p1.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    // The barred body is on the Bench now, carrying nothing.
    const wasActive = retreated.players.p1.bench.at(-1);
    expect(wasActive?.lockedAttacks ?? []).toEqual([]);
  });

  it("a FORCED switch sheds it too — the opponent's route into the same clear", () => {
    // Boss's Orders played by the OPPONENT on the turn before the window: the body
    // leaves the Active Spot and the record goes with it. The same three literals
    // that D142/D143/D147/D149/D152 all write, which is why the set is swept.
    const state = handFromDeck(barred("sv03-142", SLASHING_STEEL_INDEX).state, "p2", "sv02-172", 1);
    const barredUid = activeUid(state, "p1");
    let gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    }).state;
    if (gusted.phase.kind === "effect:choose") {
      gusted = must(
        applyAction(gusted, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = gusted.players.p1.bench.find((p) => p.stack.includes(barredUid));
    expect(benched).toBeDefined();
    expect(benched?.lockedAttacks ?? []).toEqual([]);
  });

  it("the clear-set is the SAME set every durated field is on — swept, not listed", () => {
    // D149's rule: the clear-set is swept because it is three literals that have
    // to agree with nothing making them. The sweep here is structural — the ELEVEN
    // durated keys (ELEVEN since D434) are read off ONE body that has been through the clear, so a
    // literal that forgot the new field fails on the field rather than on a board
    // somebody remembered to write.
    // 🆕🆕 D432 — the NO-WEAKNESS bar joins the swept set. It is read STRUCTURALLY
    // here for the reason its own suite states: §8.5 applies Weakness only to the
    // ACTIVE, so once a body has been through a §10 clear there is no number left
    // that could witness the bar's absence. The field is the only witness there is.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const held = handFromDeck(window, "p1", "fix-skarm-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-skarm-stage1"),
      target: { spot: "active" },
    });
    // 🆕🆕 D434 — the SCHEDULED counter placement joins the swept set, and it is read
    // STRUCTURALLY for a reason of its own: the record's whole effect is in the
    // future, so after a §10 clear there is no number that could witness its absence
    // until a Checkup that will never place anything. The field IS the witness.
    // 🛑 AND D432's OWN FINDING WAS STILL OPEN IN THIS FILE — REPAIRED HERE. D432
    // audited the four swept clear-sets and found three missing `retreatLockedTurn`,
    // which D412 never added. This one was ALSO missing `boostedAttack` (D155), and
    // its comment above still said "the NINE durated keys" while its siblings said
    // TEN. Drift is invisible until the next author reads the set as a whole, which
    // is exactly D432's rule; the set is now ELEVEN and all four literals agree.
    const body = must0(evolved.players.p1.active);
    expect({
      attackBlock: body.attackBlock,
      attackLockedTurn: body.attackLockedTurn,
      retreatLockedTurn: body.retreatLockedTurn,
      damageReduction: body.damageReduction,
      noWeaknessTurn: body.noWeaknessTurn,
      scheduledEffect: body.scheduledEffect,
      attackDamageDebuff: body.attackDamageDebuff,
      installedRecoil: body.installedRecoil,
      lockedAttacks: body.lockedAttacks,
      boostedAttack: body.boostedAttack,
      retreatBlocked: body.retreatBlocked,
    }).toEqual({
      attackBlock: null,
      attackLockedTurn: null,
      retreatLockedTurn: null,
      damageReduction: null,
      noWeaknessTurn: null,
      scheduledEffect: null,
      attackDamageDebuff: null,
      installedRecoil: null,
      lockedAttacks: [],
      boostedAttack: null,
      retreatBlocked: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The projections — the first durated field that gates an ACTION.
// ─────────────────────────────────────────────────────────────────────────────

describe("both payability projections agree with the §8 gate, per INDEX", () => {
  it("greys the barred row and OFFERS the sibling", () => {
    // ⚠️ THIS IS THE PROJECTION CASE WITH THE MOST ROOM TO BE WRONG IN THE ENGINE.
    // D143's lock greys every button, so a build that missed it shows a player a
    // panel of dead controls. This one greys exactly ONE row on an otherwise live
    // panel — so a build that folded it into the whole-declaration `banned`
    // boolean, or forgot it entirely, produces a board that looks completely
    // normal and rejects one press.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const view = redactGame(window, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    const barredRow = view.attacks[SLASHING_STEEL_INDEX];
    const sibling = view.attacks[PECK_INDEX];
    expect(barredRow?.name).toBe("Slashing Steel");
    expect(barredRow?.playable).toBe(false);
    expect(sibling?.name).toBe("Peck");
    expect(sibling?.playable).toBe(true);
    // …and the projection AGREES with the gate on both rows, which is the property
    // that matters: neither offers a button the server refuses, and neither hides
    // one it would accept.
    expect(refusal(window, "p1", SLASHING_STEEL_INDEX)).toBe("ATTACK_PREVENTED");
    expect(refusal(window, "p1", PECK_INDEX)).toBeNull();
  });

  it("offers BOTH rows again once the window has passed", () => {
    // So the assertion above is about the BAR rather than about an unpayable cost.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    let later = must(applyAction(window, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    const view = redactGame(later, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    for (const attack of view.attacks) expect(attack.playable, attack.name).toBe(true);
  });

  it("the OPPONENT's view is unchanged — the bar leaks nothing across the wire", () => {
    // `redactedAttacksOf` returns [] for anyone but the turn owner, so the record
    // reaches no projection of the other seat. Asserted because this is the first
    // durated field that reaches a projection AT ALL.
    const window = inWindow(barred("sv03-142", SLASHING_STEEL_INDEX).state);
    const view = redactGame(window, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D162 — THE EIGHTH PRINTING, and the family closes.
// ─────────────────────────────────────────────────────────────────────────────

/** Radiant Charizard's board. Its OWN deck (`RADIANT_LOCK_DECK`) for the reason
    written on that deck: `PER_ATTACK_LOCK_DECK`'s 28 cases are dealt off
    `SEED = 13`, and adding one card to it would move every one of them.

    P2 opens and passes, so P1's turn 2 carries no §4 attack restriction, and P2
    fields fix-titan (340 HP, NO attacks) so nothing here reaches `ko:takePrizes`.
    Combustion Blast costs FIVE — {R} plus four {C} — which is the most expensive
    cost in the family and the reason this helper attaches rather than plays. */
function readyRadiant(): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: RADIANT_LOCK_DECK, p2: RADIANT_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "swsh10.5-011");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 4);
  return state;
}

/** `readyRadiant`, then Combustion Blast declared — asserting the bar landed, so
    no case below can assert "nothing was refused" against nothing. */
function radiantBarred(): { state: GameState; events: GameEvent[]; row: GameEvent } {
  const { state, events } = mustApply(readyRadiant(), {
    type: "attack",
    seat: "p1",
    index: COMBUSTION_BLAST_INDEX,
  });
  const row = find(events, "ATTACK_LOCKED");
  if (row === undefined) throw new Error("Radiant Charizard barred nothing");
  return { state, events, row };
}

describe("the EIGHTH printing — Radiant Charizard swsh10.5-011, unread until the re-ingest", () => {
  // ⚠️ WHAT THIS SECTION IS, STATED BEFORE ITS FIRST ASSERTION, BECAUSE IT IS THE
  // UNUSUAL CASE: it adds a PRINTING and no MECHANISM. D154 built the anchor, the
  // op, the `lockedAttack` record, `lockedAttackIndex`, the §8 gate, the three §10
  // clears and both payability projections, and every one of them reads this card
  // unchanged. The reason it was not fielded then is not a design decision —
  // D154 QUERIED for it and the database did not have it. The local D1 had lost
  // the whole `swsh10.5` set to an uncheckpointed WAL, D160 re-ingested and
  // checkpointed it, and the row prints D154's sentence byte for byte.
  //
  // So the value here is a MEASUREMENT of a claim D154 made and could not test:
  // "the deriver is text-driven and would read it correctly the day a fixture
  // lands". It does. That claim being paid rather than asserted is the whole
  // slice, and it is worth saying that a green suite here would ALSO have been the
  // result if the claim were false in a way this pool cannot print — which is why
  // the cases below drive the projection and the log row and not only the gate.

  it("carries the row verbatim — every field, including the two it does not have", () => {
    // D151's rule: the ABSENCES are asserted too, because they are what a later
    // completion would move. D160 diffed all twelve `swsh10.5` fixtures field by
    // field against the restored rows and found no wrong VALUE on any of them;
    // this is the thirteenth, and it is the first written AFTER the catalog could
    // check it rather than before.
    const charizard = FIXTURE_POOL["swsh10.5-011"];
    expect(charizard?.name).toBe("Radiant Charizard");
    expect(charizard?.hp).toBe(160);
    expect(charizard?.stage).toBe("Basic");
    expect(charizard?.types).toEqual(["Fire"]);
    expect(charizard?.retreat).toBe(3);
    expect(charizard?.weaknesses).toEqual([{ type: "Water", value: "×2" }]);
    expect(charizard?.resistances ?? null).toBeNull();
    expect(charizard?.evolveFrom ?? null).toBeNull();
    // ONE attack, at index 0 — the datum the install resolves the printed noun to.
    expect(charizard?.attacks).toHaveLength(1);
    expect(charizard?.attacks?.[COMBUSTION_BLAST_INDEX]).toEqual({
      cost: ["Fire", "Colorless", "Colorless", "Colorless", "Colorless"],
      name: "Combustion Blast",
      damage: 250,
      effect: COMBUSTION_BLAST,
    });
    // Its printed Ability is CARRIED, and the two text pins below are unchanged
    // since D162.
    expect(charizard?.abilities?.[0]?.name).toBe("Excited Heart");
    expect(charizard?.abilities?.[0]?.effect).toContain("cost Colorless less");
    // ⚠️ RE-POINTED, NOT DELETED. This line read `toBeUndefined()` from D162 until
    // the attack-cost ± slice authored "Excited Heart" — and going RED there was the
    // whole point of writing it: the pin existed so that the id could not gain a
    // program without a test saying WHICH. It now says which. The claim it protects
    // is unchanged in kind — this id's program is a PASSIVE and nothing else, so the
    // per-attack lock this file is about still arrives by TEXT DERIVATION off
    // "Combustion Blast" and not from a registry `attack` map (which would silently
    // take over the very seam every board below drives).
    expect(programFor("swsh10.5-011")).toEqual({
      passive: { attackCostDiscountPerOpponentPrize: 1 },
    });
    expect(programFor("swsh10.5-011")?.attack).toBeUndefined();
  });

  it("has a RULE BOX by NAME PREFIX and is worth ONE Prize — the family's only such body", () => {
    // ⚠️ TWO PREDICATES WITH TWO DIFFERENT SOURCES, AND THIS CARD IS WHERE THEY
    // DISAGREE. `hasRuleBox` is `pokemonSuffixOf` ∪ the literal "Radiant " NAME
    // PREFIX (D40's vocabulary, cards.ts); `prizeValueOf` reads the SUFFIX alone.
    // A Radiant Pokémon therefore has a rule box and is still worth one Prize,
    // which is what the cards print — and it is a combination no other body in
    // this family carries. Pinned because a predicate fed by two independent
    // sources drifts silently: nothing about a per-attack lock would have failed
    // if `hasRuleBox` had quietly stopped matching the prefix.
    const charizard = FIXTURE_POOL["swsh10.5-011"];
    if (charizard === undefined) throw new Error("swsh10.5-011 is not in the pool");
    expect(hasRuleBox(charizard)).toBe(true);
    expect(pokemonSuffixOf(charizard)).toBeNull();
    expect(prizeValueOf(charizard)).toBe(1);
    // The three cells the rest of the family occupies, so the claim is a TABLE and
    // not one card: a suffix rule box is worth 2, and no rule box is worth 1.
    const cell = (id: string) => {
      const card = FIXTURE_POOL[id];
      if (card === undefined) throw new Error(`${id} is not in the pool`);
      return { ruleBox: hasRuleBox(card), prizes: prizeValueOf(card) };
    };
    expect(cell("sv06.5-037")).toEqual({ ruleBox: true, prizes: 2 }); // Munkidori ex
    expect(cell("sv03-179")).toEqual({ ruleBox: true, prizes: 2 }); // Greedent ex
    expect(cell("sv03-142")).toEqual({ ruleBox: false, prizes: 1 }); // Skarmory
    expect(cell("sv01-114")).toEqual({ ruleBox: false, prizes: 1 }); // Lucario
    expect(cell("swsh10.5-011")).toEqual({ ruleBox: true, prizes: 1 }); // the new cell
  });

  it("the family's SIX names are all fielded now — the census closes", () => {
    // ⚠️ THE COUNT, RE-MEASURED AGAINST THE RESTORED CATALOG AND NOT INHERITED.
    // `LIKE '%During your next turn, this Pokémon can''t use %'` across all three
    // text columns returns EIGHT rows across SIX names (Lucario sv01-114, Skarmory
    // sv03-142, Greedent ex sv03-179, Munkidori ex sv06.5-037/-083/-091, Radiant
    // Charizard swsh10.5-011, Radiant Blastoise swsh10.5-018) — §D143's inherited
    // "8 printings / 6 sentences" exactly. D154's correction to "6 rows / 4 names"
    // was the missing set speaking, not a miscount.
    //
    // This case is the FIXTURE-side half of that, and it is a separate population
    // (D154's standing rule): every one of the six names must be printed by a body
    // in the pool, so the sweep below reads what the engine can actually drive.
    // The three Munkidori rarities collapse to one fixture — byte-identical rows —
    // which is why six names come from five ids.
    const printed = new Map<string, string[]>();
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const op = deriveAttackEffect(attack.effect ?? "");
        if (op?.[0]?.op !== "preventAttackUse") continue;
        const existing = printed.get(attack.name);
        if (existing === undefined) printed.set(attack.name, [id]);
        else existing.push(id);
      }
    }
    // SWEPT rather than listed — a seventh name fielded by a later slice appears
    // here the day its fixture lands rather than the day somebody remembers.
    // `fix-curly-barrer` is the U+2019 witness and prints a SIXTH name of its own
    // ("Slip ’n’ Roll", curly), so the pool holds seven distinct spellings for six
    // printed names, and that is stated rather than filtered away.
    //
    // 🆕🆕 **D421 — AND THE SWEEP DID EXACTLY WHAT IT WAS BUILT TO DO: "Blaze
    // Blitz" APPEARED HERE ON ITS OWN.** `fix-gougingfire` prints *"This Pokémon
    // can't use Blaze Blitz again until it leaves the Active Spot."* (5 legal
    // printings — Gouging Fire ex in five rarities), a DIFFERENT SENTENCE claimed by
    // a DIFFERENT arm, and it derives the SAME op because the rider `until:
    // "leavesActive"` is a widening rather than a sixth op. So this line is
    // RE-POINTED rather than filtered: it now says "every fixture whose attack text
    // derives `preventAttackUse`, under EITHER of its two printed durations", which
    // is a strictly wider claim than the one it made and still the claim this file
    // is about — the alternative (excluding the rider here) would have quietly
    // narrowed a swept census back into a hand-kept list.
    expect([...printed.keys()].sort()).toEqual([
      "Accelerating Stab",
      "Blaze Blitz",
      "Combustion Blast",
      "Dirty Headbutt",
      "Slashing Steel",
      "Slip 'n' Roll",
      "Slip ’n’ Roll",
      "Torrential Cannon",
    ]);
    expect(printed.get("Combustion Blast")).toEqual(["swsh10.5-011"]);
  });

  it("bars its own index 0 across a real turn boundary, and the §8 gate refuses it", () => {
    const before = readyRadiant();
    expect(before.turn).toBe(2);
    const uid = activeUid(before, "p1");
    const { state, events, row } = radiantBarred();
    expect(row).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid,
      attack: "Combustion Blast",
    });
    expect(state.players.p1.active?.lockedAttacks).toEqual([
      {
        turn: 2 + 2,
        attackIndex: COMBUSTION_BLAST_INDEX,
      },
    ]);
    // …and NOT the whole-Pokémon lock, which on a ONE-ATTACK card is the drift no
    // board can see. This is the assertion doing the work in this whole section.
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    // The printed 250 landed and fix-titan's 340 survived it, so the window opens
    // on a live board rather than on a KO.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(250);
    const window = inWindow(state);
    expect(window.turn).toBe(4);
    expect(lockedAttackIndexes(window, must0(window.players.p1.active))).toEqual([
      COMBUSTION_BLAST_INDEX,
    ]);
    expect(refusal(window, "p1", COMBUSTION_BLAST_INDEX)).toBe("ATTACK_PREVENTED");
  });

  it("the window CLOSES — the same index is legal again one turn on", () => {
    // So the refusal above is about the BAR and not about a cost this board could
    // never pay. The energy is still attached; only the stamp has expired.
    let later = must(applyAction(inWindow(radiantBarred().state), { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([]);
    expect(refusal(later, "p1", COMBUSTION_BLAST_INDEX)).toBeNull();
  });

  it("the projection greys the ONLY row it renders — D143's picture, a different record", () => {
    // ⚠️ THE CELL THIS FAMILY HAD NEVER OCCUPIED, AND THE REASON THIS PRINTING
    // EARNS BOARDS RATHER THAN A `toEqual`. D154's projection case is Skarmory:
    // exactly ONE row greyed on an otherwise live panel, and its doc block says in
    // so many words that this is where the projection has "more room to be wrong
    // than D143's", because a build that missed it renders a normal-looking board
    // that rejects one press.
    //
    // On a ONE-ATTACK card the same record greys 100% of the panel — which is
    // pixel-for-pixel what D143's whole-Pokémon lock produces. So this is the board
    // where the two projections are INDISTINGUISHABLE to a player and only the
    // record tells them apart, and the honest thing to assert is both halves: the
    // panel is fully dead, AND the field that killed it is `lockedAttack`.
    const window = inWindow(radiantBarred().state);
    const view = redactGame(window, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(1);
    expect(view.attacks[COMBUSTION_BLAST_INDEX]?.name).toBe("Combustion Blast");
    expect(view.attacks[COMBUSTION_BLAST_INDEX]?.playable).toBe(false);
    // The projection AGREES with the gate — neither offers a button the server
    // refuses — and the CAUSE is the per-attack record, with D143's field null.
    expect(refusal(window, "p1", COMBUSTION_BLAST_INDEX)).toBe("ATTACK_PREVENTED");
    expect(window.players.p1.active?.attackLockedTurn).toBeNull();
    expect(window.players.p1.active?.lockedAttacks).toEqual([{ turn: 4, attackIndex: 0 }]);
  });

  it("the log row NAMES the attack — and here the bare wording would have been TRUE", () => {
    // ⚠️ THE VOICE ANSWER, AND THIS PRINTING IS THE ONE THAT INVERTS D154's.
    // D154's branch exists because "can't attack next turn" on a Skarmory that may
    // still declare Peck is not stilted, it is FALSE — false in the direction that
    // makes a player pass a turn they could have attacked on. Radiant Charizard has
    // ONE attack, so the bare wording would have been TRUE here, and the specific
    // wording buys SPECIFICITY rather than correctness.
    //
    // That is worth pinning precisely because it is the weaker case: a reader that
    // drifted onto `preventAttack` would produce a row that is still true, a gate
    // that still refuses, and a panel that still greys — and the ONLY observable
    // that separates them on this card is the words in this assertion.
    const { state, row } = radiantBarred();
    expect(render([row], state)).toEqual([
      { who: "p1", text: "Radiant Charizard can't use Combustion Blast next turn" },
    ]);
    // …and READ under the OTHER seat's names too, because `seat` owns the BARRED
    // Pokémon rather than the actor (D136's finding 1) and the renderer takes the
    // name from the log context. Same row, same seat, the other side's spelling.
    const swapped: LogContext = {
      names: { p1: "Tide", p2: "Ember" },
      state,
      elapsed: "+00:14",
    };
    expect(
      logFromEvents([row], swapped).flatMap((entry) =>
        entry.kind === "turn"
          ? []
          : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
      ),
    ).toEqual([{ who: "p1", text: "Radiant Charizard can't use Combustion Blast next turn" }]);
  });

  it("the OPPONENT's view is unchanged — the bar leaks nothing across the wire", () => {
    const window = inWindow(radiantBarred().state);
    const view = redactGame(window, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers used above that need the engine's own entry points.
// ─────────────────────────────────────────────────────────────────────────────

/** Run a one-op program from P1's chair as an ATTACK's effect — the shape the
    CONSTRUCTED cases need (`preventBlock.test.ts`'s move). The op never parks, so
    the run is always `done` and the assertion says so rather than assuming it. */
function runOne(state: GameState, program: readonly EffectOp[], events: GameEvent[]): GameState {
  const result = runProgram(state, program, { seat: "p1", invokedBy: "attack" }, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}
