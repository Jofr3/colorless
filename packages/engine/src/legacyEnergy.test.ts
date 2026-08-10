import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import {
  ANY_ENERGY,
  applyAction,
  costMet,
  createGame,
  deriveAttackEffect,
  engineVersion,
  programFor,
  providedEnergy,
} from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  LEGACY_PRIZE_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
} from "./testFixtures";

// D298 — LEGACY ENERGY `sv06-167`, AND THE REFUSAL WHOSE CONCLUSION HELD WHILE
// HALF ITS REASON WAS FIVE SLICES STALE.
//
// ── THE PRINTED TEXT, RE-QUERIED IN FULL ────────────────────────────────────
// Remote D1 `luminous` (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-09, ONE
// flat `WHERE id = 'sv06-167'` over every column — the whole row, not the first
// 90 characters D292 read:
//
//   "As long as this card is attached to a Pokémon, it provides every type of
//    Energy but provides only 1 Energy at a time.
//
//    If the Pokémon this card is attached to is Knocked Out by damage from an
//    attack from your opponent's Pokémon, that player takes 1 fewer Prize card.
//    This effect of your Legacy Energy can't be applied more than once per game."
//
// `category = 'Energy'`, `energy_type = 'Special'`, `rarity = 'ACE SPEC Rare'`,
// `regulation_mark = 'H'`, `legal_standard = 1`, `legal_expanded = 1`, and
// `attacks_json` / `abilities_json` / `types_json` / `trainer_type` all NULL.
//
// ── THE INHERITED REFUSAL, RE-TYPED RATHER THAN REPEATED ────────────────────
// `mistEnergy.test.ts` has recorded this row for five slices as
//
//     "a PRIZE-COUNT modifier on the holder's KO, once per game.
//      Needs a prize hook AND a per-game latch; §14 has neither."
//
// 🛑 **THE CONCLUSION HELD AND HALF THE REASON WAS STALE.** The prize hook is
// §8.1's, not §14's, and it has existed since **D164**: `koPrizeReduction` /
// `planPrizes` (flow.ts) already read the BYTE-SIMILAR Munkidori ex antecedent —
// *"is Knocked Out by damage from an attack from your opponent's Pokémon"* — and
// already decrement a planned Prize. The ATTACHED-CARD scan has existed since
// **D174** (`passivesOf`'s third source class) and its §8.1 KO-time twin since
// **D141** (`koRecoilOf`, Vengeful Punch `sv03-197`, the identical antecedent
// borne by a TOOL). What was actually missing was ONE thing: the latch.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
// ONE extracted type (`KoPrizeReduction`, with `requiresInPlay` widened to
// optional), ONE new `PassiveEffects` field, ONE collector in `passivesOf`, ONE
// helper plus ONE closure in `planPrizes`, ONE `GameState` field and its setup
// line. **NO new op, prompt kind, choice kind, event TYPE, error code, deriver
// arm or regex**; `packages/schema`, `redact.ts` and `src/` take a ZERO diff for
// the FIFTH slice running.
//
// ── AND THE FAMILY CLOSES AT 2 OF 2, WHICH IS WHY BOTH ARE BUILT ────────────
// `legal_standard = 1 AND instr(effect,'fewer Prize') > 0` returns **9** rows.
// Seven are Lacey `sv07-139`/`-166`/`-172`/`sv08.5-114`/`-175` and Emcee's Hype
// `sv10-163`/`-220`, every one printing *"If your opponent has 3 or fewer Prize
// cards **remaining**"* — a board condition on a Supporter, a different sentence
// on a different surface. The other two are this Energy and **Lillie's Pearl
// `sv09-151`**, a Pokémon TOOL printing the same consequent with an OWNER gate
// and no cap. Building only the Energy would have justified an `EnergyProgram`
// field that the Tool could never reach; building both put the field on
// `PassiveEffects`, where ONE fold already walks both slots.
//
// 🛑 AND THE TWO PRINTINGS DISAGREE ON EVERY RIDER, WHICH IS THE GUARD D279 ASKED
// FOR: the Pearl refuses an unprefixed holder and may fire every turn; the Energy
// admits any holder and fires once per game. Reusing a mechanism copies the
// sentence it was written for, so both sentences are driven.

const LEGACY_PRINTED =
  "As long as this card is attached to a Pokémon, it provides every type of Energy but provides only 1 Energy at a time.\n\nIf the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card. This effect of your Legacy Energy can't be applied more than once per game.";
const PEARL_PRINTED =
  "If the Lillie's Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card.";
/** Munkidori ex's, carried verbatim because the whole claim is that this row
    RE-USES its antecedent rather than authoring a second reading of it. */
const OH_NO_YOU_DONT =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card.";

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30

/** `fix-legacy-ex` is worth TWO Prizes (the `ex` suffix is in its NAME) and
    `fix-lillie-body` one, which is what lets a DECREMENT be told from a ZEROING. */
const EX_PRIZES = 2;

interface Board {
  holder?: string;
  /** Copies of Legacy Energy on the holder. */
  legacy?: number;
  pearl?: boolean;
  /** HP of damage already on the holder — Bite adds 30. */
  damage?: number;
  /** Extra bodies on the holder's bench, so a KO does not empty the board. */
  bench?: string[];
}

/** P2 (going first) fields the holder with its attachments, then the turn passes
    to P1, who fields `fix-attacker` with one {C}. `ohNoYouDont.test.ts`'s `field`
    with this row's cast — deliberately the same shape, because the two suites read
    the same printed antecedent at the same site. */
function field(seed: number, opts: Board = {}): GameState {
  let state = driveSetup(seed, { p1: LEGACY_PRIZE_DECK, p2: LEGACY_PRIZE_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", opts.holder ?? "fix-legacy-ex");
  state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
  for (const id of opts.bench ?? ["fix-bigbody"]) state = benchFromDeck(state, "p2", id);
  if (opts.pearl === true) state = attachToolFromDeck(state, "p2", "active", "fix-lillies-pearl");
  if (opts.legacy !== undefined) state = attachFromDeck(state, "p2", "fix-legacy-energy", opts.legacy);
  state = setDamage(state, "p2", opts.damage ?? 240);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The Prize count the KO actually parks on, or 0 when no `takePrizes` stage was
    queued at all — read off the PHASE rather than off the events, because the
    phase is what the player is asked. */
function parkedPrizes(state: GameState): number {
  return state.phase.kind === "ko:takePrizes" ? state.phase.count : 0;
}

function reductions(events: GameEvent[]): Extract<GameEvent, { type: "PRIZE_REDUCED" }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: "PRIZE_REDUCED" }> => {
    return e.type === "PRIZE_REDUCED";
  });
}

/** A board straight out of `createGame` — before setup, before anything. */
function freshGame(): GameState {
  return must(
    createGame({
      seed: 7,
      decks: { p1: LEGACY_PRIZE_DECK, p2: LEGACY_PRIZE_DECK },
      cardPool: FIXTURE_POOL,
    }) as never,
  );
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ROWS ARE DATA — and the provision half was already built.
// ─────────────────────────────────────────────────────────────────────────────

describe("the two registry rows, and the half of Legacy Energy that costs nothing", () => {
  it("🛑 the PROVISION is Luminous Energy's line VERBATIM — one wildcard unit", () => {
    // "provides every type of Energy but provides only 1 Energy at a time" IS
    // `[ANY_ENERGY]`, and `costMet` has consumed it since M4 slice 5. Asserted
    // against the OTHER printing of the same string rather than against a
    // literal, so the claim is "identical to a shipped row" and not "looks right".
    expect(programFor("sv06-167")?.energy?.provides).toEqual([ANY_ENERGY]);
    expect(programFor("sv06-167")?.energy?.provides).toEqual(
      programFor("sv02-191")?.energy?.provides,
    );
    // 🛑 ONE unit, not two: the count is printed and `costMet` consumes a FLAT
    // LIST, so a row with a second entry would pay a two-symbol cost this card
    // refuses. D262's multiset trap, one printing over.
    expect(programFor("sv06-167")?.energy?.provides).toHaveLength(1);
    expect(costMet(["Psychic"], [ANY_ENERGY])).toBe(true);
    expect(costMet(["Psychic", "Water"], [ANY_ENERGY])).toBe(false);
  });

  it("carries NO conditional provision and NO on-attach arm — both are ABSENT from the print", () => {
    // The sentence prints its wildcard UNCONDITIONALLY, which is what separates
    // it from Neo Upper `sv05-162` and Prism `sv10.5b-086` (both gate the same
    // clause on the holder's stage) and from Reversal `sv04-266` (a Prize
    // comparison). A row that grew a gate would be authoring text this card lacks.
    expect(programFor("sv06-167")?.energy?.promoteOnHolderStage).toBeUndefined();
    expect(programFor("sv06-167")?.energy?.demoteWithOtherSpecial).toBeUndefined();
    expect(programFor("sv06-167")?.energy?.onAttach).toBeUndefined();
  });

  it("🛑 the PRIZE half sits on `energy.passive`, which is D174's third source class", () => {
    expect(programFor("sv06-167")?.energy?.passive?.onKoPrizeReduction).toEqual({
      by: 1,
      oncePerGame: "Legacy Energy",
    });
    // No owner gate: this card admits ANY holder. The Pearl is the one that gates.
    expect(
      programFor("sv06-167")?.energy?.passive?.onKoPrizeReduction?.requiresHolderOwner,
    ).toBeUndefined();
    // And NO board clause either — `requiresInPlay` is Munkidori's alone.
    expect(
      programFor("sv06-167")?.energy?.passive?.onKoPrizeReduction?.requiresInPlay,
    ).toBeUndefined();
  });

  it("Lillie's Pearl is a TOOL's `passive`, gated on the HOLDER and uncapped", () => {
    expect(programFor("sv09-151")?.passive?.onKoPrizeReduction).toEqual({
      by: 1,
      requiresHolderOwner: "Lillie",
    });
    // 🛑 The Tool authors NO `energy` entry and the Energy NO top-level `passive`:
    // the two slots are what `passivesOf` folds, and a row in the wrong one would
    // be silently unread.
    expect(programFor("sv09-151")?.energy).toBeUndefined();
    expect(programFor("sv06-167")?.passive).toBeUndefined();
  });

  it("both printings share their program with their `fix-*` demonstrator", () => {
    // Not merely equal — the SAME object, so the once-per-game key cannot drift
    // between the real id and the fixture the boards below actually field.
    expect(programFor("fix-legacy-energy")).toBe(programFor("sv06-167"));
    expect(programFor("fix-lillies-pearl")).toBe(programFor("sv09-151"));
    expect(FIXTURE_POOL["fix-legacy-energy"]?.effect).toBe(LEGACY_PRINTED);
    expect(FIXTURE_POOL["fix-lillies-pearl"]?.effect).toBe(PEARL_PRINTED);
  });

  it("neither sentence is an ATTACK's, so no deriver may claim either", () => {
    // Both live on the bare `effect` column — the column censuses in this repo
    // have repeatedly been blind to (D164's finding, still worth a line).
    expect(deriveAttackEffect(LEGACY_PRINTED)).toBeNull();
    expect(deriveAttackEffect(PEARL_PRINTED)).toBeNull();
  });

  it("⚠️ D164's ABILITY row is UNTOUCHED by the type extraction", () => {
    // `requiresInPlay` went from REQUIRED to optional. Munkidori ex still carries
    // it, and its absence must not have become the row's new default anywhere.
    expect(programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction).toEqual({
      by: 1,
      requiresInPlay: "Pecharunt ex",
    });
    expect(FIXTURE_POOL["sv06.5-037"]?.abilities?.[0]?.effect).toBe(OH_NO_YOU_DONT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FOLD — `passivesOf` reaches BOTH attach slots, and only those.
// ─────────────────────────────────────────────────────────────────────────────

describe("passivesOf collects the reduction off an attached card, on either slot", () => {
  it("🛑 an ENERGY and a TOOL both reach `koPrizeReductions` — one fold, two slots", () => {
    const energyOnly = field(3, { legacy: 1 });
    const toolOnly = field(3, { pearl: true });
    expect(passivesOf(energyOnly, activeOf(energyOnly, "p2")).koPrizeReductions).toEqual([
      { by: 1, oncePerGame: "Legacy Energy" },
    ]);
    expect(passivesOf(toolOnly, activeOf(toolOnly, "p2")).koPrizeReductions).toEqual([
      { by: 1, requiresHolderOwner: "Lillie" },
    ]);
  });

  it("🛑 a body wearing BOTH offers TWO entries — the list is not a scalar", () => {
    // The interface field's own claim: two attached sources on one body carry
    // DIFFERENT riders, so a summed `by` would spend the Energy's cap on a Prize
    // the Tool reduced. TOOLS come before ENERGY in `sources`, and the ORDER is
    // asserted because the two entries are not interchangeable.
    const both = field(3, { legacy: 1, pearl: true });
    expect(passivesOf(both, activeOf(both, "p2")).koPrizeReductions).toEqual([
      { by: 1, requiresHolderOwner: "Lillie" },
      { by: 1, oncePerGame: "Legacy Energy" },
    ]);
  });

  it("a bare body collects NOTHING, and neither does the ABILITY carrier", () => {
    // The attribution control. Without it every assertion above would pass on a
    // fold that pushed unconditionally. And Munkidori ex's reduction is a
    // TRIGGERED ability, so it must NOT appear in this list — the two carriers
    // are read at two different places in `planPrizes`.
    const bare = field(3);
    expect(passivesOf(bare, activeOf(bare, "p2")).koPrizeReductions).toEqual([]);
    const munkidori = field(3, { holder: "sv06.5-037", damage: 0 });
    expect(passivesOf(munkidori, activeOf(munkidori, "p2")).koPrizeReductions).toEqual([]);
  });

  it("the wildcard provision is LIVE off the same attachment", () => {
    const state = field(3, { legacy: 1 });
    expect(providedEnergy(state, activeOf(state, "p2"))).toEqual([ANY_ENERGY]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE REDUCTION ON A REAL KNOCK OUT.
// ─────────────────────────────────────────────────────────────────────────────

describe("the Prize reduction — driven through a real attack Knock Out", () => {
  it("🛑 2 → 1 off the ENERGY, and it is a DECREMENT rather than a zeroing", () => {
    const done = mustApply(field(1, { legacy: 1 }), bite);
    expect(parkedPrizes(done.state)).toBe(EX_PRIZES - 1);
    expect(reductions(done.events)).toEqual([
      { type: "PRIZE_REDUCED", seat: "p2", uid: expect.any(String), by: 1, count: 1 },
    ]);
    // The control: the same board with nothing attached parks on the face value.
    expect(parkedPrizes(mustApply(field(1), bite).state)).toBe(EX_PRIZES);
  });

  it("🛑 2 → 1 off the TOOL, on a holder its owner gate ADMITS", () => {
    const done = mustApply(field(1, { pearl: true }), bite);
    expect(parkedPrizes(done.state)).toBe(EX_PRIZES - 1);
    expect(reductions(done.events)).toHaveLength(1);
  });

  it("🛑 THE OWNER GATE REFUSES AN UNPREFIXED HOLDER — the board D279 asks for", () => {
    // `fix-pearl-nobody` is "Clefairy" to `fix-lillie-body`'s "Lillie's Clefairy":
    // same HP, same attack, same Prize value, and ONLY the name differs. A build
    // that reused Legacy Energy's ungated read would reduce here.
    const gated = mustApply(field(1, { holder: "fix-pearl-nobody", damage: 50, pearl: true }), bite);
    expect(parkedPrizes(gated.state)).toBe(1);
    expect(reductions(gated.events)).toEqual([]);
    // …and the SAME Pearl on the SAME board reduces once the holder is prefixed.
    const admitted = mustApply(field(1, { holder: "fix-lillie-body", damage: 50, pearl: true }), bite);
    expect(parkedPrizes(admitted.state)).toBe(0);
    expect(reductions(admitted.events)).toHaveLength(1);
    // 🛑 The ENERGY has no such gate, so the very same unprefixed body IS reduced.
    const ungated = mustApply(field(1, { holder: "fix-pearl-nobody", damage: 50, legacy: 1 }), bite);
    expect(parkedPrizes(ungated.state)).toBe(0);
    expect(reductions(ungated.events)).toHaveLength(1);
  });

  it("🛑 the two COMPOUND on one body: 2 → 1 → 0, and the clamp is over the RUNNING total", () => {
    const done = mustApply(field(1, { legacy: 1, pearl: true }), bite);
    expect(parkedPrizes(done.state)).toBe(0);
    expect(reductions(done.events).map((e) => e.count)).toEqual([1, 0]);
    // No `takePrizes` stage is queued at all when the count reaches 0 — the same
    // path Glimmora's guard takes, reached by a different road.
    expect(done.state.phase.kind).not.toBe("ko:takePrizes");
  });

  it("🛑 THE POSSESSIVE REFUSES A KO ON THE ATTACKER'S OWN BOARD — a Rocky Helmet board", () => {
    // *"from your OPPONENT'S Pokémon"*. `attackerSeat === ref.seat` is the holder
    // dying on the ATTACKER's own side, which `finishAttack` sweeps too because it
    // passes BOTH seats — so the possessive is load-bearing rather than decorative
    // (D164's clause, re-used rather than re-derived). The only way to reach that
    // board is a retaliation: P2's Active wears a Rocky Helmet, so Bite puts 20 HP
    // back on P1's own attacker, which is already one hit from death and dies in
    // the SAME sweep with a Legacy Energy attached.
    let state = field(1, { holder: "fix-lillie-body", damage: 50 });
    state = attachToolFromDeck(state, "p2", "active", "sv01-193"); // Rocky Helmet
    state = attachFromDeck(state, "p1", "fix-legacy-energy", 1);
    state = setDamage(state, "p1", 110); // `fix-attacker` is 120 HP
    expect(passivesOf(state, activeOf(state, "p1")).koPrizeReductions).toHaveLength(1);

    const done = mustApply(state, bite);
    // BOTH bodies died on one sweep, and only P2's carried a live clause.
    expect(done.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(2);
    // 🛑 P1's Legacy Energy did NOT fire: no reduction names p1, and the cap it
    // would have spent is untouched. A build that dropped the possessive would
    // reduce here and be green on every other board in this file.
    expect(reductions(done.events).map((e) => e.seat)).toEqual([]);
    expect(done.state.oncePerGameSpent.p1).toEqual([]);
  });

  it("🛑 a CHECKUP Knock Out is refused — `attackerSeat` is undefined there", () => {
    // The clause is "by damage from an attack". A poisoned holder finished at the
    // Checkup dies for real and its Prize is NOT reduced. This is the refusal that
    // makes the reduction a CAUSE-conditioned one rather than an on-KO one, and it
    // is the same board D164 drives one carrier over.
    let state = field(2, { legacy: 1, damage: 250 });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    // P1 ends its turn; the Checkup poisons P2's Active for its last 10 HP.
    const done = mustApply(state, { type: "endTurn", seat: "p1" });
    // 🛑 THE KO REALLY HAPPENED — without this the assertion below is vacuous and
    // would pass just as happily on a body that survived the Checkup.
    expect(done.events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    expect(reductions(done.events)).toEqual([]);
    expect(parkedPrizes(done.state)).toBe(EX_PRIZES);
    expect(done.state.oncePerGameSpent.p2).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE LATCH — the one thing that was genuinely missing.
// ─────────────────────────────────────────────────────────────────────────────

describe("`oncePerGameSpent` — the per-game latch, and the only new GameState field", () => {
  it("is EMPTY on a fresh board, for both seats", () => {
    const game = freshGame();
    expect(game.oncePerGameSpent).toEqual({ p1: [], p2: [] });
  });

  it("🛑 is stamped with the printed EFFECT's name — not a card id and not a uid", () => {
    const done = mustApply(field(1, { legacy: 1 }), bite);
    expect(done.state.oncePerGameSpent).toEqual({ p1: [], p2: ["Legacy Energy"] });
    // The key is what makes `sv06-167` and `fix-legacy-energy` ONE cap. Read off
    // the program rather than re-typed, so a rename cannot pass this file.
    expect(done.state.oncePerGameSpent.p2).toEqual([
      programFor("sv06-167")?.energy?.passive?.onKoPrizeReduction?.oncePerGame,
    ]);
  });

  it("🛑 A SECOND Knock Out with a SECOND copy attached is NOT reduced", () => {
    // The whole sentence. Two Legacy Energy on one board is not a legal DECK (one
    // ACE SPEC), but it is an expressible BOARD — and it is also what a recovered
    // and re-attached copy looks like, which is how the cap is actually reached in
    // play. Both bodies are `ex`, so both would be 2 → 1 without the latch.
    let state = field(1, { legacy: 1, bench: ["fix-legacy-ex", "fix-bigbody"] });
    const first = mustApply(state, bite);
    expect(parkedPrizes(first.state)).toBe(1);
    expect(first.state.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);

    // Take the Prize, promote, and hand a SECOND wired body to the same attacker.
    state = mustApply(first.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    state = mustApply(state, { type: "promote", seat: "p2", benchIndex: 0 }).state;
    state = attachFromDeck(state, "p2", "fix-legacy-energy", 1);
    state = setDamage(state, "p2", 240);
    expect(passivesOf(state, activeOf(state, "p2")).koPrizeReductions).toHaveLength(1);

    // P2's turn, then P1 attacks again into the second holder.
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const second = mustApply(state, bite);
    expect(reductions(second.events)).toEqual([]);
    expect(parkedPrizes(second.state)).toBe(EX_PRIZES);
    expect(second.state.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);
  });

  it("🛑 IS NOT SPENT WHEN THERE IS NOTHING LEFT TO REDUCE — the `count === 0` break", () => {
    // A 1-Prize `Lillie's ` holder wearing BOTH: the Pearl takes 1 → 0 first, and
    // "that player takes 1 fewer Prize card" than none is not an application of
    // the effect. A build that ran the arithmetic anyway would burn the cap on a
    // Knock Out that reduced nothing — green on every board above, wrong here.
    const done = mustApply(field(1, { holder: "fix-lillie-body", damage: 50, legacy: 1, pearl: true }), bite);
    expect(parkedPrizes(done.state)).toBe(0);
    expect(reductions(done.events)).toHaveLength(1);
    expect(done.state.oncePerGameSpent.p2).toEqual([]);
  });

  it("is PER-SEAT — one player's Knock Out cannot consume the other's cap", () => {
    const done = mustApply(field(1, { legacy: 1 }), bite);
    expect(done.state.oncePerGameSpent.p1).toEqual([]);
    expect(done.state.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);
  });

  it("the TOOL has no cap at all and stamps nothing", () => {
    const done = mustApply(field(1, { pearl: true }), bite);
    expect(done.state.oncePerGameSpent).toEqual({ p1: [], p2: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. COMPOSITION with the two on-KO Prize mechanisms that were already here.
// ─────────────────────────────────────────────────────────────────────────────

describe("the attached reduction composes with D164's ABILITY and D155's GUARD", () => {
  it("🛑 Munkidori ex wearing a Legacy Energy pays BOTH — 2 → 1 → 0", () => {
    // The ability arm `continue`d before this slice, so an attached source on an
    // on-KO-Ability body would have been silently skipped. Every push in
    // `planPrizes` now goes through one closure, and this is the board that says so.
    // Munkidori ex is 210 HP and worth 2 Prizes; Pecharunt ex on its Bench is the
    // printed board clause, matched by NAME.
    const state = field(4, {
      holder: "sv06.5-037",
      damage: 190,
      legacy: 1,
      bench: ["sv06.5-039", "fix-bigbody"],
    });
    const done = mustApply(state, bite);
    expect(reductions(done.events).map((e) => e.count)).toEqual([1, 0]);
    expect(done.state.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);
    expect(done.state.phase.kind).not.toBe("ko:takePrizes");
  });

  it("Glimmora's on-KO Prize GUARD is untouched by the new field", () => {
    // The sibling that ZEROES rather than decrements. It carries no
    // `onKoPrizeReduction` and must not have acquired one.
    expect(programFor("sv02-126")?.triggered?.[0]?.onKoPrizeGuard).toBe("coinFlipPrevent");
    expect(programFor("sv02-126")?.triggered?.[0]?.onKoPrizeReduction).toBeUndefined();
    expect(programFor("sv02-126")?.passive?.onKoPrizeReduction).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE POPULATION — measured, and it CLOSES.
// ─────────────────────────────────────────────────────────────────────────────

describe("the population of the printed sentence — 2 of 2, and the residue moves", () => {
  it("⚠️ ENUMERATES every card in the pool carrying the reduction — a sweep, not a list", () => {
    // A POPULATION claim belongs to a POOL SWEEP rather than to any one board
    // (D261's headline loss). It goes RED on a new FIXTURE as much as on new code,
    // which is the point: a third carrier arriving in silence is what this catches.
    const carriers = Object.keys(FIXTURE_POOL)
      .filter((id) => {
        const program = programFor(id);
        return (
          program?.passive?.onKoPrizeReduction !== undefined ||
          program?.energy?.passive?.onKoPrizeReduction !== undefined
        );
      })
      .sort();
    // ⚠️ THE VIEW IS `FIXTURE_POOL` AND NOT THE REGISTRY MAP, which is not
    // exported — `neoUpperEnergy.test.ts`'s sweep verbatim, and the reason the
    // REAL ids are absent here: the committed manifest holds no `sv06` and no
    // `sv09` row, so neither may be added as a real-id fixture. Both real ids are
    // pinned by §1's assertions and asserted to share their fixture's program.
    expect(carriers).toEqual(["fix-legacy-energy", "fix-lillies-pearl"]);
  });

  it("🛑 the Special Energy residue is now TWO, and this file owns the correction", () => {
    // `mistEnergy.test.ts` has carried the residue since D261 and D262 re-homed it
    // once already. `sv06-167` leaves it BUILT; `sv06-166` and `sv10-182` remain,
    // each with a blocker that is still real.
    expect(programFor("sv06-167"), "sv06-167 is BUILT at D298").toBeDefined();
    for (const id of ["sv06-166", "sv10-182"]) {
      expect(programFor(id), `${id} is counted UNBUILT`).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MATCH_RECORD_VERSION — the BUMP, driven in BOTH directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_RECORD_VERSION 16 → 17 — and it is DRIVEN, not argued", () => {
  it("🛑 the persisted `GameState` carries EXACTLY these keys", () => {
    // THE LITERAL KEY ANCHOR (D279's pairing rule): a diff between two boards from
    // ONE build is blind to "every state grew a key", because the key sits on both
    // sides. This names them, and the list has grown by exactly ONE.
    const game = freshGame();
    const revived = JSON.parse(JSON.stringify(game)) as GameState;
    expect(Object.keys(revived).sort()).toEqual([
      "allowances",
      "cardIdByUid",
      "cardPool",
      "firstPlayer",
      "handPlayLockedTurn",
      "lastKoTurn",
      "oncePerGameSpent",
      "pending",
      "phase",
      "players",
      "rngState",
      "stadium",
      "turn",
    ]);
  });

  it("🛑 FORWARD: a version-16 record WITHOUT the key THROWS on the first reduction", () => {
    // The direction the repo's rule tests — "can the PREVIOUS deploy's RECORD hold
    // the new TYPE". It cannot: the field is INDEXED before it is compared
    // (`next.oncePerGameSpent[ref.seat]`), so an old record resumed under this
    // deploy dies the moment a Legacy Energy holder is Knocked Out. `lastKoTurn`'s
    // shape at D271 — the fourth such field and the second that does not read back
    // benignly. Rebuilt by DELETING the key off a real board, not by hand-rolling
    // a state.
    const live = field(1, { legacy: 1 });
    const { oncePerGameSpent: _dropped, ...old } = live;
    const stale = old as unknown as GameState;
    expect("oncePerGameSpent" in stale).toBe(false);
    expect(() => applyAction(stale, bite)).toThrow();
  });

  it("🛑 BACKWARD: a version-17 board round-trips through JSON with the latch intact", () => {
    const spent = mustApply(field(1, { legacy: 1 }), bite).state;
    const revived = JSON.parse(JSON.stringify(spent)) as GameState;
    expect(revived.oncePerGameSpent).toEqual(spent.oncePerGameSpent);
    // …and the revived board still refuses a second application, so the latch is
    // carried by the RECORD and not by anything in memory.
    const next = mustApply(revived, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    expect(next.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);
  });

  it("no new `GameEvent` TYPE, no new prompt kind, no new error code", () => {
    // What moved: ONE `GameState` field and ONE `PassiveEffects` field. The
    // reduction reports through `PRIZE_REDUCED`, which D164 authored.
    const done = mustApply(field(1, { legacy: 1 }), bite);
    expect(reductions(done.events)).toHaveLength(1);
    expect(new Set(done.events.map((e) => e.type)).has("PRIZE_REDUCED")).toBe(true);
  });
});

describe("the engine version", () => {
  it("moved to 0.215.0 with the new field, and the two files agree", () => {
    // BEHAVIOUR moved inside `packages/engine` (a `GameState` field, a fold field,
    // a flow.ts arm and two registry rows), so the number moves. The manifest and
    // the exported constant are asserted TOGETHER — the tie IS the assertion, and
    // either drifting alone is the defect (D275). 🛑 THIS FILE NOW OWNS THE
    // LITERAL; `tonguePull.test.ts` kept the tie and the direction when it handed
    // it over, which is the same handoff it received from `aquaWash.test.ts`.
    // 🆕 D299 re-pointed the pair (0.209.0 → 0.210.0) for `returnBenched`, and
    // left the literal HERE rather than moving it again: this file's own reason
    // for owning it — a slice whose behaviour is inside `packages/engine` — is
    // still true of D299, and a literal that changes hands every slice is a
    // literal nobody is guarding.
    // 🆕 D300 re-pointed it again (0.210.0 → 0.211.0) for Prism Energy, on the
    // same terms: `registry.ts` and `continuous.ts` both moved. ⚠️ **AND THIS IS
    // THE VERSION THAT DID *NOT* MOVE BESIDE IT** — `MATCH_RECORD_VERSION` is 17
    // at both ends of D300, grepped rather than assumed, because a provision is
    // recomputed and never persisted. Two version literals, two different
    // answers, and only one of them has a guard: this one.
    // 🆕 D302 re-pointed it again (0.211.0 → 0.212.0) for Reversal Energy, on the
    // same terms once more: `registry.ts`, `continuous.ts` AND `cards.ts` moved.
    // ⚠️ **AND `MATCH_RECORD_VERSION` IS 17 AT BOTH ENDS AGAIN, GREPPED AT BOTH
    // ENDS** — the third consecutive slice where these two literals give different
    // answers, and the reason is unchanged: a provision is recomputed, never
    // persisted. D302's row reads the PRIZE ARRAYS as well as the holder, which is
    // a wider read and still not a written one.
    // 🆕 D307 re-pointed it again (0.212.0 -> 0.213.0) for the
    // EVOLVE-FROM-DECK family, and on DIFFERENT terms from the four slices above:
    // this one moved `effects.ts`, `interpreter.ts`, `types.ts` and
    // `packages/schema` rather than the registry/continuous pair, so it is the
    // first re-point in this block whose behaviour is a new OP rather than a new
    // provision. ⚠️ **AND `MATCH_RECORD_VERSION` IS 17 AT BOTH ENDS FOR THE
    // FOURTH CONSECUTIVE SLICE, GREPPED AT BOTH ENDS** - the reason is a NEW one
    // this time and is written into `match.ts`: the op parks, so a stored phase
    // CAN hold it, but no version-17 deploy could author it (D125's condition),
    // which is the direction the record version does not protect.
    // 🆕 D308 re-pointed it again (0.213.0 -> 0.214.0) for the ITERATED half of
    // that same family, on D307's terms: `effects.ts` and `interpreter.ts` moved
    // and the registry did not. ⚠️ **AND `packages/schema` DID *NOT* MOVE THIS
    // TIME** — D307's one `dest` word was the whole schema diff, and this slice's
    // surface is an op plus an optional field, neither of which the wire types
    // name. ⚠️ **`MATCH_RECORD_VERSION` IS 17 AT BOTH ENDS FOR THE FIFTH
    // CONSECUTIVE SLICE, GREPPED AT BOTH ENDS**, on the same D125 condition D307
    // wrote into `match.ts`: `cont.rest` can now hold a QUEUE of scheduled ops,
    // and no version-17 deploy can author one.
    // 🆕 D309 re-pointed it again (0.214.0 -> 0.215.0) for the BODY-CHOICE half of
    // the same family, on D307's and D308's terms: `effects.ts` and
    // `interpreter.ts` moved and the registry did not. 🛑 **AND THIS IS THE SLICE
    // WHERE THE TWO LITERALS FINALLY MOVE TOGETHER** — `MATCH_RECORD_VERSION` is
    // **17 at the start and 18 at the end**, GREPPED AT BOTH ENDS, ending a
    // five-slice run of "two version literals, two different answers". The reason
    // is the one D125's condition does not excuse: D308's field was RENAMED rather
    // than widened, so it is the OLDER deploy that authors a spelling THIS deploy
    // misreads. ⚠️ **THE COMMENT THREE PARAGRAPHS UP IS THE GUARD DOING ITS JOB**:
    // "only one of them has a guard: this one" is exactly why the grep happened.
    // 🆕 D313 re-pointed it again (0.218.0 -> 0.219.0) for the DESTINATION axis of
    // `returnSelf`. ⚠️ **`MATCH_RECORD_VERSION` IS 18 AT BOTH ENDS, GREPPED AT BOTH
    // ENDS**, and the classification is the D125 one at its sharpest: BOTH new op
    // fields are OPTIONAL, so no version-18 deploy can author either — and the one
    // shape that WOULD have forced a bump is the one this slice deliberately did
    // not take. Making `dest` REQUIRED is a rename in disguise: the old deploy
    // authors `{op:"returnSelf"}` and this deploy would have had to guess. It reads
    // it as the deck instead, and `assassinsReturn.test.ts` §6 drives a
    // reconstructed v18 park to prove it.
    // 🆕 D314 re-pointed it again (0.219.0 -> 0.220.0) for Eldegoss `sv07-011`
    // "Breezy Gift", and this re-point is on the WEAKEST terms of any in this
    // block: the whole behaviour change is ONE registry row of three EXISTING
    // ops. No op, no field, no event, no reader. ⚠️ **AND IT IS THE ONE THAT
    // CAUGHT THE AUTHOR OUT**, which is the argument for the tie stated better
    // than any of the paragraphs above: D314 ran a full green `bun run check`,
    // THEN bumped the two version literals, and re-ran only `tsc`, `biome` and
    // two suites — so this rung was RED at the commit and the MUTATION SWEEP
    // reported it, as FIVE `D298-*` rows whose baseline suite was red before
    // anything was mutated. 🛑 **A VERSION BUMP IS A BEHAVIOUR CHANGE TO THIS
    // FILE, AND THE ONLY GATE THAT SEES IT IS THE FULL `check`.** ⚠️
    // **`MATCH_RECORD_VERSION` IS 18 AT BOTH ENDS, GREPPED AT BOTH ENDS**: with
    // no op, no op field and no event added, there is nothing a v18 deploy could
    // fail to author and nothing this deploy could misread — the emptiest SKIP in
    // this block, and recorded rather than assumed for that reason.
    // 🆕 D315 re-pointed it again (0.220.0 -> 0.221.0) for Team Rocket's Nidorina
    // `sv10-115` "Dark Awakening" — a NEW op, a new deriver arm and the FOURTH
    // `continuationOps` member, so this re-point is on much stronger terms than
    // D314's. 🛑 **AND D314's LESSON WAS APPLIED RATHER THAN RE-LEARNED**: the
    // literal was grepped (`git grep "0.220.0"`) BEFORE the bump, this file came
    // back as the one that guards it, and the bump and this rung were changed in
    // the same commit with a FULL `check` run AFTER. ⚠️ **`MATCH_RECORD_VERSION`
    // IS 18 AT BOTH ENDS**: a new union MEMBER is a widening — a v18 deploy cannot
    // author the op, so no v18 record holds one.
    expect(engineVersion).toBe("0.221.0");
    expect(manifest.version).toBe("0.221.0");
    expect(manifest.version).toBe(engineVersion);
  });
});
