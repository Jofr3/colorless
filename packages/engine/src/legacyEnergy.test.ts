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
  if (opts.legacy !== undefined)
    state = attachFromDeck(state, "p2", "fix-legacy-energy", opts.legacy);
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
    const gated = mustApply(
      field(1, { holder: "fix-pearl-nobody", damage: 50, pearl: true }),
      bite,
    );
    expect(parkedPrizes(gated.state)).toBe(1);
    expect(reductions(gated.events)).toEqual([]);
    // …and the SAME Pearl on the SAME board reduces once the holder is prefixed.
    const admitted = mustApply(
      field(1, { holder: "fix-lillie-body", damage: 50, pearl: true }),
      bite,
    );
    expect(parkedPrizes(admitted.state)).toBe(0);
    expect(reductions(admitted.events)).toHaveLength(1);
    // 🛑 The ENERGY has no such gate, so the very same unprefixed body IS reduced.
    const ungated = mustApply(
      field(1, { holder: "fix-pearl-nobody", damage: 50, legacy: 1 }),
      bite,
    );
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
    const done = mustApply(
      field(1, { holder: "fix-lillie-body", damage: 50, legacy: 1, pearl: true }),
      bite,
    );
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
      "lastKoMarks",
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
    // 🆕 D316 re-pointed it again (0.221.0 -> 0.222.0) for *"You may do {N} more
    // damage. If you do, …"* — an eighth attack-text reader plus one optional
    // field on each of two existing ops, so five printings that were loudly
    // skipped now resolve completely. 🛑 **D314's LESSON APPLIED FOR THE SECOND
    // SLICE RUNNING**: `git grep "0.221.0"` was run BEFORE the bump, it returned
    // this file, `index.ts`, `package.json` and the mutation corpus, and all four
    // moved in ONE commit with the full `check` run AFTER it. ⚠️
    // **`MATCH_RECORD_VERSION` IS 18 AT BOTH ENDS**: both additions are OPTIONAL
    // fields, so both are widenings a v18 deploy cannot author.
    // 🆕 D317 re-pointed it again (0.222.0 -> 0.223.0) for *"…this attack does
    // {N} more damage, and {consequent}"* — a NINTH attack-text reader plus an
    // exported assembler, so six printings that were loudly skipped now resolve
    // completely. 🛑 **D314's LESSON APPLIED FOR THE THIRD SLICE RUNNING**:
    // `git grep "0.222.0"` was run BEFORE the bump, it returned this file,
    // `index.ts`, `package.json` and the mutation corpus, and all four moved in
    // ONE commit with the full `check` run AFTER it. ⚠️ **`MATCH_RECORD_VERSION`
    // IS 18 AT BOTH ENDS, AND ON EASIER TERMS THAN D316's**: this slice adds no
    // op, no field and no union member — every op it emits already ships and is
    // already authorable at v18.
    // 🆕 D318 re-pointed it again (0.223.0 -> 0.224.0) for a STRUCTURAL slice
    // with no printed card in it: D316's `optional` assembler moved out of
    // `attack.ts` into `effects.ts` so a sweep can build what the engine runs, and
    // `fix-optionalboost` put a producer in the pool for it to build. 🛑 **D314's
    // LESSON APPLIED FOR THE FOURTH SLICE RUNNING**: `git grep "0.223.0"` was run
    // BEFORE the bump, it returned this file, `index.ts`, `package.json` and the
    // mutation corpus, and all four moved in ONE commit with the full `check` run
    // AFTER it. ⚠️ **`MATCH_RECORD_VERSION` IS 18 AT BOTH ENDS**: a function
    // changed file — no op, no field, no union member, no wire shape.
    // 🆕 D319 re-pointed it again (0.224.0 -> 0.225.0) for the opponent-action
    // trigger family. 🛑 **D314's LESSON APPLIED FOR THE FIFTH SLICE RUNNING**:
    // `git grep "0.224.0"` was run BEFORE the bump, it returned this file,
    // `index.ts`, `package.json` and the mutation corpus, and all four moved in ONE
    // commit with the full `check` run AFTER it. ⚠️ **`MATCH_RECORD_VERSION` IS 18
    // AT BOTH ENDS**: one new op and one new OPTIONAL context field are a WIDENING,
    // and an older record lacking both still parses and still means what it meant.
    // 🆕 D320 re-pointed it again (0.225.0 -> 0.226.0) for that family's THIRD
    // verb, and 🆕 D321 again (0.226.0 -> 0.227.0) for the after-W/R seat aura's
    // second and third sentences. 🛑 **D314's LESSON APPLIED FOR THE SEVENTH SLICE
    // RUNNING**: `git grep "0.226.0"` was run BEFORE the bump, it returned this
    // file, `index.ts`, `package.json` and the mutation corpus, and all four moved
    // in ONE commit with the full `check` run AFTER it. ⚠️ **`MATCH_RECORD_VERSION`
    // IS 18 AT BOTH ENDS**: a registry field widened from a number to a record is
    // a catalog fact re-derived on every read and persisted nowhere.
    // 🆕 D322 re-pointed it again (0.227.0 -> 0.228.0) for the retreat-cost
    // delta's three sentences. 🛑 **D314's LESSON APPLIED FOR THE EIGHTH SLICE
    // RUNNING**: `git grep "0.227.0"` was run BEFORE the bump, it returned this
    // file, `index.ts`, `package.json` and the mutation corpus, and all four moved
    // in ONE commit with the full `check` run AFTER it. ⚠️ **AND THE GREP WAS
    // APPLIED BY HAND RATHER THAN BY A BLANKET `sed`** — D321 clobbered three of
    // its predecessor's history lines with one pass; the declaration and the three
    // assertions move, a NEW history line is appended, no old one is rewritten.
    // 🆕 D323 re-pointed it again (0.228.0 -> 0.229.0) for the §8.1 seat-wide
    // prize bonus. 🛑 **D314's LESSON APPLIED FOR THE NINTH SLICE RUNNING**:
    // `git grep "0.228.0"` was run BEFORE the bump, it returned this file,
    // `index.ts`, `package.json` and the mutation corpus, and all four moved in
    // ONE commit with the full `check` run AFTER it. ⚠️ **`MATCH_RECORD_VERSION`
    // IS 18 AT BOTH ENDS**: a new `GameEvent` variant is a WIDENING, and the
    // bonus is re-derived from the board on every Knock Out.
    // 🆕 D324 re-pointed it again (0.229.0 -> 0.230.0) for the §8.1 max-HP seam.
    // 🆕 D326 re-pointed it again (0.231.0 -> 0.232.0) — the per-body KO record
    // (`lastKoMarks`) and the two narrowings on D271's gate, 8 legal printings.
    // 🆕 D325 re-pointed it again (0.230.0 -> 0.231.0) — the SELF-SCALING half of
    // that same seam, which CLOSES it at 12 legal printings on 5 sentences.
    // 🛑 **D314's LESSON APPLIED FOR THE TENTH SLICE RUNNING**: `git grep
    // "0.229.0"` was run BEFORE the bump, it returned this file, `index.ts`,
    // `package.json` and the mutation corpus, and all four moved in ONE commit
    // with the full `check` run AFTER it. ⚠️ **`MATCH_RECORD_VERSION` IS 18 AT
    // BOTH ENDS**: three registry fields and two derivations, none persisted.
    // 🆕 D327 re-pointed it again (0.232.0 -> 0.233.0) — the cost seam's second
    // and third count sources, 6 legal printings on 2 sentences, and the
    // `%less for each%` family closing at 12 of 12. ⚠️ **`MATCH_RECORD_VERSION`
    // IS 19 AT BOTH ENDS**: two optional registry fields, nothing persisted.
    // 🆕 D328 re-pointed it again (0.233.0 -> 0.234.0) — a REVIEW-FIX
    // session rather than a build slice, and the first entry in this block with no
    // printed card behind it since D318. 🛑 **AND THE TIE CAUGHT THE AUTHOR
    // OUT EXACTLY AS D314's DID**: the first fix ran a full green `check`, THEN
    // bumped `index.ts` and `package.json`, and this rung was RED at that commit —
    // the eleventh slice running to prove that a version bump is a behaviour change
    // to THIS file and only the full `check` sees it. ⚠️ **ONE BUMP FOR THE
    // WHOLE SESSION, NOT ONE PER FIX**: this repo already lands a slice as several
    // commits under one version (D327's three code commits all shipped 0.233.0), so
    // four review fixes under 0.234.0 is the existing practice rather than a
    // shortcut. ⚠️ **`MATCH_RECORD_VERSION` IS 19 AT BOTH ENDS, GREPPED AT
    // BOTH ENDS**: no op, no field, no union member, no `PendingStage` shape and no
    // `GameState` key moved — every fix re-routes a check that already existed.
    // 🆕 D329 re-pointed it again (0.234.0 -> 0.235.0) — the §14 tie guard lifted
    // off the individual pass and onto the whole fixed point, which is a WRONG
    // ANSWER repaired rather than a widening: the stage-by-stage §14 checks the
    // per-pass guard fell through to cannot report a tie at all, because they
    // evaluate after each prize stage and the first empty row wins. ⚠️ **AND THE
    // GREP WAS RUN BEFORE THE BUMP FOR THE TWELFTH SLICE RUNNING**, returning this
    // file, `index.ts` and `package.json`; all three move in ONE commit with the
    // full `check` run AFTER it. ⚠️ **`MATCH_RECORD_VERSION` IS 19 AT BOTH ENDS**:
    // one internal interface and one private helper, nothing persisted.
    // 🆕 D330 re-points it again (0.235.0 -> 0.236.0), and this is the FIRST bump
    // in this series whose whole engine diff is `registry.ts` DATA: two printed
    // cards that did nothing now do something, and no op, field, filter member or
    // event moved. **A version bump is about BEHAVIOUR, not about how much code
    // changed** — Florges and Team Rocket's Petrel are playable at this version
    // and were not at the last one. ⚠️ **AND THE GREP WAS RUN BEFORE THE BUMP FOR
    // THE THIRTEENTH SLICE RUNNING**, returning this file, `index.ts` and
    // `package.json`; all three move in ONE commit with the full `check` AFTER it.
    // ⚠️ **`MATCH_RECORD_VERSION` IS 19 AT BOTH ENDS**: registry rows are data, and
    // a persisted record cannot tell one from another.
    // 🆕 D337 re-points it again (0.242.0 -> 0.243.0) for a row with **ZERO ENGINE
    // DIFF** — Ethan's Adventure, `anyOf` under a FLAT `max`, one `CardProgram` and
    // three id keys — which is the case that shows this literal tracks the BUILD and
    // not the type surface: `packages/schema` and every engine module took a zero
    // diff and the version still moves, because a registry row changes what the
    // engine DOES. `MATCH_RECORD_VERSION` stays 20 for the mirror-image reason: it
    // tracks the persisted SHAPE, and a data row cannot change one.
    // 🆕 D336 re-points it again (0.241.0 -> 0.242.0) for ONE op field ADDED as a LIST
    // (`searchDeck.also`) — and `MATCH_RECORD_VERSION` does NOT move with it, because an
    // old record's absent `also` still means the single-group search it always meant.
    // 🆕 D335 re-pointed it (0.240.0 -> 0.241.0) for ONE op field RENAMED and
    // widened on that same op, and the slice that finally moved
    // `MATCH_RECORD_VERSION` with it (19 -> 20, D309's rename case).
    // 🆕 D334 re-pointed it (0.239.0 -> 0.240.0) for TWO new op fields on one
    // op (`lookAtTopN.exact`, `lookAtTopN.discardRest`) and a third producer on an
    // existing event — no persisted shape moved, so MATCH_RECORD_VERSION stays 19.
    // 🆕 D333 re-pointed it (0.238.0 -> 0.239.0) for ONE op field WIDENED
    // (`lookAtTopN.max` gains `"any"`) and NO wire shape moved — the thirtieth
    // payment, and the first in this run whose bump buys a widening rather than a
    // new field.
    // 🆕 D332 re-pointed it (0.237.0 -> 0.238.0) for a real op field plus a
    // PROMPT field — the first slice in this run whose bump reaches
    // `packages/schema`. And the tie was found to be a FIVE-file fact rather than
    // the four this comment and the resume point both claimed: `lisiasAppeal.test.ts`
    // carries a slice-local pin D331 added, now converted to a non-drifting driver.
    // 🆕 D331 re-points it again (0.236.0 -> 0.237.0), and the contrast with the
    // bump directly above is the thing worth keeping: D330's diff was `registry.ts`
    // DATA and moved this literal; D331's buys a genuine op FIELD (`gust.basicOnly`)
    // and a new exported funnel, and moves it by exactly the same one minor. **The
    // tie measures BEHAVIOUR, and it is deliberately blind to how much code the
    // behaviour cost** — three printings that did nothing now do something, which is
    // the same sentence D330 wrote about two. ⚠️ **AND THE GREP WAS RUN BEFORE THE
    // BUMP FOR THE FOURTEENTH SLICE RUNNING** — returning this file, `index.ts`,
    // `package.json` and, for the twenty-eighth time, `scripts/mutation/mutants.ts`,
    // whose `D275-engine-version-drifts-again` row quotes the LITERAL. That fourth
    // site is not in the sentence above and has never been; it is written down here
    // now so the fifteenth slice greps for four and not three.
    // ⚠️ **`MATCH_RECORD_VERSION` IS 19 AT BOTH ENDS**: `basicOnly` is OPTIONAL, so
    // a v19 record parks `{ op: "gust" }` and reads here as `undefined` — a widening
    // by construction, which D125's condition explicitly does not bump for.
    // 🆕 D338 re-points it again (0.243.0 -> 0.244.0) for a row with **ZERO ENGINE
    // DIFF** for the SECOND consecutive slice — THE FIFTEENTH SLICE RUNNING to return
    // all FOUR sites, and the first to grep for four because the note below said to.
    // ⚠️ **`MATCH_RECORD_VERSION` IS 20 AT BOTH ENDS**: a registry data row adds no op
    // field, no `CardFilter` member and no rename, and the persisted `GameState` key
    // list is untouched — D125's condition is not reached.
    // 🆕 D343 re-points it again (0.248.0 -> 0.249.0) for a row with a REAL
    // engine diff after two consecutive zero-diff slices — THE SIXTEENTH SLICE
    // RUNNING to return all FOUR sites, and the SECOND to grep for four because
    // the note above says to. ⚠️ **`MATCH_RECORD_VERSION` IS 20 AT BOTH ENDS**:
    // `reorderTop.from` and `DECK_TOP_REORDERED.end` are both OPTIONAL ADDED
    // FIELDS — the op is registry-side program vocabulary that is never persisted,
    // and events are rendered into `record.log` rows rather than stored. D125's
    // condition is not reached from either end.
    // 🛑 **AND D343 LEARNED THIS LIST THE EXPENSIVE WAY, TWICE IN ONE CHECK.**
    // Its prediction named `package.json` and `index.ts`'s DOC BLOCK and missed
    // `engineVersion` itself, so six suites went red on a tie no count in the
    // census touches. **THE FOUR SITES ARE A RUNG KEYED ON AN AGREEMENT BETWEEN
    // FILES, WHICH IS NOT A NUMBER AND APPEARS IN NO CENSUS.** Then a SEVENTH
    // suite went red for a different reason: `derivedSearchTopOrder.test.ts`
    // held a SECOND exact pin, written by D342 in the same commit as D342's own
    // lesson against exactly that. D343 converted it to the permanent `>=` claim,
    // so **the count of sites a bump must touch is FOUR again and this file is
    // the only exact pin** — which is what the sentence above has always assumed
    // and had, for one slice, stopped being true.
    // 🆕 D344 re-points it again (0.249.0 -> 0.250.0) for Deduction Kit
    // `sv08-171` — THE SEVENTEENTH SLICE RUNNING to return all FOUR sites, and
    // the THIRD to grep for four because the note above says to. ⚠️
    // **`MATCH_RECORD_VERSION` IS 20 AT BOTH ENDS**, grepped rather than assumed:
    // `reorderTop.otherwise` / `.otherwiseNote` are registry-side program
    // vocabulary that is never persisted (D343's precedent verbatim, one field
    // over), `orderCards.alt` is an ADDED OPTIONAL FIELD on a persisted union so
    // a v20 record cannot hold one (D125's widening test), and
    // `DECK_TOP_TO_BOTTOM` is an EVENT — rendered into `record.log` rows rather
    // than stored. Three widenings, no rename, no required field: D125's
    // condition is not reached from any of the three ends.
    // 🛑 **AND D344 MADE D343's MISTAKE AGAIN, WITH D343's WARNING ON THE PAGE.**
    // Its prediction listed the VERSION as a moving figure and never enumerated
    // the four SITES, so bumping `package.json` alone reddened seven suites on the
    // tie. **A FIGURE NAMED IS NOT THE SAME AS ITS RUNGS ENUMERATED**, and the
    // paragraph above says so in the previous slice's handwriting. Recorded here
    // rather than quietly fixed, because a warning that has now failed twice is
    // evidence about the warning: **the four sites need to be a CHECKLIST in the
    // resume point, not a lesson in a test file nobody reads before editing.**
    // 🆕🆕 D348 — 0.253.0 → **0.254.0**, the counter SPREAD (arm 23a). The FIVE-SITE
    // checklist was read before the first edit and the bump was ONE commit, for the
    // fourth slice running. ⚠️ **AND `MATCH_RECORD_VERSION` STAYS 20, GREPPED RATHER
    // THAN ASSUMED** (`apps/api/src/lobby/match.ts`): the arm emits N repeated
    // `damageChosen` ops, an op authored at M4 slice 8, so there is no new op, no new
    // op FIELD and no new prompt kind — not one persisted byte moves.
    // 🛑 AND THE FIFTH SITE BIT IN A NEW WAY THIS TIME. The D275 mutation anchor
    // survived the bump untouched; what broke was `D276-walk-descends-any-object-array`,
    // whose anchor line in `testFixtures.ts` biome REFLOWED when the slice ran
    // `check --write` over a file it had added two fixtures to. The line was over the
    // width limit and had been one edit from breaking for seventy-two decisions.
    // **The post-biome anchor pass is what caught it; the post-bump pass was clean.**
    // 🆕🆕 D365 — 0.269.0 → **0.270.0**, THREE clause-table rows at ZERO new
    // vocabulary. The bump is for the READER's behaviour changing on five printed
    // strings, not for any new type: a widened deriver is a bump the same way a
    // widened union member is.
    // 🆕 D363 — 0.268.0 → **0.269.0**, and this rung caught the bump BY BEING THE
    // ONLY THING IN THE REPO THAT NAMES BOTH FILES. A slice whose whole diff is
    // one regex, one table row and one split has no reason to grep this file, and
    // the version pair is not derivable from any of them — which is exactly the
    // hole this rung was cut for. The post-bump anchor pass was clean.
    // 🆕🆕 D367 — 0.271.0 → **0.272.0**, ZERO new `BoardCondition` members: SEVEN
    // `CONDITIONAL_DAMAGE_CLAUSES` rows on members that already existed, plus one
    // token map widened (`CLAUSE_POKEMON_TYPES` learns the brace notation its
    // sibling has carried since D118). ⚠️ **A BUMP WITHOUT A NEW MEMBER, AND THE
    // RULE IS THE SAME ONE**: the version tracks whether the readers answer a
    // printed sentence they used to refuse, not whether a union grew. Nine
    // sentences / thirteen legal printings moved from refused to answered, which
    // is a larger behavioural change than D366's four. The post-bump anchor pass
    // was clean.
    // 🆕🆕 D366 — 0.270.0 → **0.271.0**, ONE new `BoardCondition` member
    // (`yourBenchAtLeast`), TWO reader arms and ONE clause-table row. A new union
    // member is a bump for the same reason a widened one is: the reader answers a
    // printed sentence it used to refuse. The post-bump anchor pass was clean.
    // 🆕🆕 D370 — 0.274.0 → **0.275.0**, ONE new `BoardCondition` member
    // (`yourBenchHasType`), TWO reader arms and ONE new anchored PATTERN — the
    // family's third parameterised clause, and the first bump in this run whose
    // purchase is a regex rather than a table row. The rule is unchanged: the
    // version tracks whether the readers answer a printed sentence they used to
    // refuse. The post-bump anchor pass was clean.
    // 🆕🆕 D371 — 0.275.0 → **0.276.0**, ONE new `BoardCondition` member
    // (`opponentActiveHasResistance`), TWO reader arms and ONE new anchored
    // PATTERN — the family's fourth parameterised clause, and the first that reads
    // a printed DEFENSIVE column (`Card.resistances`) rather than an identity one.
    // ⚠️ The interesting half is that the column was ALREADY READ, by §8.5's
    // `resistanceOf`, asking a DIFFERENT question (does it apply to THIS attacker);
    // the member deliberately does not route through it. The post-bump anchor pass
    // was clean.
    // 🆕🆕 D373 — 0.277.0 → **0.278.0**, ONE new `BoardCondition` member
    // (`yourBenchAllDamaged`, the UNIVERSAL over the Bench) reached by ONE literal
    // clause-table row and TWO reader arms. The behaviour change is a NEW ANSWER on a
    // board the engine could already build — an empty Bench is FALSE, chosen rather
    // than inherited — so it is a bump for the ordinary reason and NOT a persisted
    // shape change: `MATCH_RECORD_VERSION` stays 22.
    // 🆕🆕 D372 — 0.276.0 → **0.277.0**, ONE new `BoardCondition` member
    // (`activeEnergyCountsEqual`), TWO reader arms and ONE literal clause-table row
    // — back to a ROW after two consecutive PATTERN bumps, because this sentence
    // varies on no token at all. ⚠️ The behavioural half is a DELEGATION rather than
    // a new reading: `countAttachedEnergy(…, null)` already decided CARDS over units
    // and `attack.ts` already summed the same two operands, so the version moves
    // because the readers answer TWO printed sentences they used to refuse, not
    // because anything about counting Energy changed. The post-bump anchor pass was
    // clean.
    // 🆕🆕 D374 — 0.278.0 -> **0.279.0**: ONE new `BoardCondition` member
    // (`yourActiveHasNamedEnergyAttached`), TWO reader arms, ONE literal clause-table
    // row and ONE new import. ⚠️ The behavioural half is the family's FIRST read of a
    // printed CARD NAME off an ATTACHED card — a reading with no provision twin, so
    // it is deliberately NOT a widening of `yourActiveHasEnergyAttached`. The version
    // moves because the readers answer a printed sentence they used to refuse. The
    // post-bump anchor pass was clean.
    // 🆕🆕 D375 — 0.279.0 -> **0.280.0**: ONE new `BoardCondition` member
    // (`inPlayTypesIntersect`, and it is NULLARY — the first member this family has
    // bought that carries no parameter at all since D368's `yourActiveUndamaged`),
    // TWO reader arms, ONE literal clause-table row and ZERO new imports. ⚠️ The
    // behavioural half is the union's FIRST predicate over two VARIABLE-SIZE SETS:
    // an intersection of the two seats' in-play type sets, where the only other
    // cross-board members compare scalars on named bodies. The version moves because
    // the readers answer a printed sentence they used to refuse. The post-bump anchor
    // pass was clean.
    // 🆕🆕 D376 — 0.280.0 -> **0.281.0**: ONE new `BoardCondition` member
    // (`yourBasicEnergyInDiscardAtLeast`, carrying an `energy` and a `count`), TWO
    // reader arms, ONE literal clause-table row and ZERO new imports. ⚠️ The
    // behavioural half is the union's first FILTERED COUNT OVER A PILE, and it is the
    // INVERSE of the member it sits beside: `yourEnergyInPlayAtLeast` reads PROVISION,
    // correctly, because an Energy in play pays for what it provides — and a discard
    // pile provides nothing, so this one reads the PRINTED CARD through
    // `CardFilter`'s existing `basicEnergy` arm. The version moves because the readers
    // answer a printed sentence they used to refuse. The post-bump anchor pass was
    // clean.
    // 🆕🆕 D377 — 0.281.0 -> **0.282.0**: TWO new `BoardCondition` members
    // (`opponentActiveBurned`, `opponentActiveConfused`, both NULLARY), FOUR reader
    // arms, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows, ONE
    // `ATTACK_REQUIREMENT_CLAUSES` row and ZERO new imports. ⚠️ The behavioural half
    // is one closed printed vocabulary over three MODEL SHAPES — Poison is a counter,
    // Burn a boolean and Confusion one value of a rotation enum — resolved by reading
    // `presentStatuses`, the projection `opponentActiveHasSpecialCondition` has
    // consumed since D116, so both members are provable NARROWINGS of that one.
    // ⚠️ AND `MATCH_RECORD_VERSION` STAYS 22, asked rather than assumed: both members
    // are nullary (nothing to store) and `SpecialConditions` has been in the persisted
    // record since M3 with its SHAPE untouched. The version moves because the readers
    // answer three printed sentences they used to refuse. The post-bump anchor pass
    // was clean.
    // 🆕🆕 D382 — 0.286.0 -> **0.287.0**, THE `. Then, ` JOIN. `MATCH_RECORD_VERSION`
    // STAYS 22, asked rather than assumed: the whole diff is ONE anchor constant and
    // ONE consequent row inside `deriveAttackBonusConsequent`, with NO new `EffectOp`
    // member at all — so every step the widened reading emits could already appear in
    // a v22 record and no v22 byte string means anything different under this one
    // (D335's discriminator). The version moves because the reader answers one printed
    // sentence it used to refuse. The post-bump anchor pass was clean.
    // 🆕🆕 D384 — 0.288.0 -> **0.289.0**, THE STRICT-INEQUALITY TWIN.
    // `MATCH_RECORD_VERSION` STAYS 22, asked rather than assumed: the member
    // (`moreActiveEnergyThanOpponent`) is NULLARY, so there is nothing to store, and a
    // `conditionGate` resolves inline and never parks — no v22 byte string can contain
    // a member that did not exist, and none means anything different under this head
    // (D335's discriminator). The version moves because a reader answers one printed
    // sentence it used to refuse. The post-bump anchor pass was clean.
    // 🆕🆕 D385 — 0.289.0 -> **0.290.0**, THE SECOND CONNECTIVE.
    // `MATCH_RECORD_VERSION` STAYS 22, asked rather than assumed: the one new member
    // (`yourHandNotEmpty`) is NULLARY, so there is nothing to store; a `conditionGate`
    // resolves inline and never parks; and `discardHand` is an EXISTING op with no new
    // field that never parks either, so no continuation shape moves. No v22 byte
    // string can contain a member that did not exist and none means anything different
    // under this head (D335's discriminator). The version moves because a reader
    // answers one printed sentence it used to refuse. The post-bump anchor pass was
    // clean.
    // 🆕🆕 D386 — 0.290.0 -> **0.291.0**, THE HEALED-THIS-TURN CLAUSE, and the FIRST
    // entry on this list that moves `MATCH_RECORD_VERSION` with it: **22 -> 23**. It is
    // OWED rather than argued — `InPlayPokemon` gains a REQUIRED `healedTurn: number |
    // null`, so every in-play Pokémon in a v22 record lacks a key this deploy's type
    // says is always there. A MISSING REQUIRED FIELD is the one case D335's
    // discriminator does not cover, and D124's own bump (1 -> 2) was this exact case at
    // this exact address. The post-bump anchor pass was clean.
    // 🆕🆕 D391 — 0.295.0 -> **0.296.0**, THE TYPED PER-BODY ENERGY THRESHOLD.
    // 🆕🆕 D390 — 0.294.0 -> **0.295.0**, THE OPPONENT-SEAT TYPE READ.
    // `MATCH_RECORD_VERSION` **STAYS 23**, asked rather than assumed. The one new
    // member (`opponentInPlayHasType`) carries a `type: PokemonType` and is stored
    // only inside a DERIVED `CardProgram`, never in a `MatchRecord`; a
    // `conditionGate` resolves inline and never parks; the arm is a pure READ of the
    // opponent's `active`/`bench` that writes nothing; and NO field is added to
    // `InPlayPokemon`, `PlayerSide` or `GameState`. No v23 byte string can contain a
    // member that did not exist and none means anything different under this head
    // (D335's discriminator). The post-bump anchor pass was clean.
    // 🆕🆕 D406 — 0.310.0 -> **0.311.0**, THE COUNTED TOOL SCALER.
    // `MATCH_RECORD_VERSION` **STAYS 25**, asked rather than assumed and argued from
    // WHERE THE NEW MEMBER IS STORED rather than from the file it is declared in. The
    // slice widens `DamageCountSource` — a PARSE-TIME union produced from card text by
    // `deriveAttackDamageMultiplier` and consumed inside `scaledAttackDamage` in the
    // same tick. Nothing in `MatchRecord` or `GameState` holds one: it never reaches
    // `phase.cont.pendingOp` (no op carries it), it is not an `EffectOp` field, and the
    // persisted key list this file anchors is untouched. So D361's "a v25 record cannot
    // contain a member that did not exist" has nothing to bite on — no v25 record could
    // ever have contained a `DamageCountSource` in the first place. `InPlayPokemon.tools`
    // is READ by the new evaluator arm and has been persisted since M4; reading a
    // shipped field is not a shape change. The post-bump anchor pass was clean.
    // 🆕🆕 D405 — 0.309.0 -> **0.310.0**, THE MANDATORY OWN-BOARD ENERGY RETRIEVAL.
    // `MATCH_RECORD_VERSION` **STAYS 25**, asked rather than assumed and answered on the
    // OP. `discardEnergy` PARKS, so it really does ride `GameState.phase.cont.pendingOp`
    // and the question is live — but this arm authors NO new field and NO new union
    // member: `from: "yourActive"` is 0.x, `filter: anyEnergy` is 0.x, `to: "hand"` is
    // D295, and the ABSENT `count` is the shape every pre-D295 self-discard already
    // stored. What is new is only which `from` the destination appears BESIDE, and a
    // v25 record carrying that pair means exactly what each half meant separately.
    // **A NEW COMBINATION OF AN ALREADY-PERSISTABLE VOCABULARY IS NOT A NEW SHAPE**
    // (D361's own test, re-applied rather than cited). The post-bump anchor pass was
    // clean.
    // 🆕🆕 D404 — 0.308.0 -> **0.309.0**, THE MANDATORY HAND WIPE AND REFILL.
    // `MATCH_RECORD_VERSION` **STAYS 25**, asked rather than assumed and answered on
    // the OPS rather than on the file. Both `discardHand` and `drawCards` have been
    // persistable vocabulary since Professor's Research; NEITHER gains a field here,
    // and — unlike the last three slices' ops — neither PARKS, so nothing new can ride
    // `GameState.phase.cont.pendingOp` at all. No union is widened anywhere, so D361's
    // "a v25 record cannot contain a member that did not exist" has nothing to bite
    // on. **A NEW ORDERING OF AN ALREADY-PERSISTABLE PAIR IS NOT A NEW SHAPE** — and
    // the ordering is not even new: `registry.ts` has spelled these two ops in this
    // order on Professor's Research since M4. The post-bump anchor pass was clean.
    // 🆕🆕 D403 — 0.307.0 -> **0.308.0**, THE ADDITIVE HALF OF THE SAME FAMILY.
    // `MATCH_RECORD_VERSION` **STAYS 25**, asked rather than assumed, and this time
    // there were TWO places it could have moved rather than one — both of them on ops
    // that really are persisted (`discardEnergy` PARKS, so it rides
    // `GameState.phase.cont.pendingOp`, and the `damageDefender` rides its `rest`
    // tail). (1) `discardEnergy.from` GAINS `"yourBench"`: a v25 record cannot contain
    // a union member that did not exist when it was written, and no v25 record's
    // meaning changes — D361's own test, and D125's widening-not-a-missing-field
    // distinction. (2) `damageDefender` GAINS `base?: number`: it is OPTIONAL and its
    // ABSENT value is ZERO, which is byte-for-byte the arithmetic every `per`/`count`
    // op has done since D96 — so an older record simply never carries it and reads the
    // same either way. **A NEW REQUIRED FIELD WOULD HAVE BEEN A NEW SHAPE; AN OPTIONAL
    // ONE WITH A SAFE DEFAULT IS A WIDENING**, which is the line D125 drew and D130
    // paid (it added a whole op and did not bump). The post-bump anchor pass was clean.
    // 🆕🆕 D402 — 0.306.0 -> **0.307.0**, THE DISCARD-COUNT-SCALED ATTACK.
    // `MATCH_RECORD_VERSION` **STAYS 25**, asked rather than assumed, and the honest
    // place to ask it was the `from` UNION — which this slice does NOT widen. Both
    // ops are persisted (`discardEnergy` PARKS, so it rides
    // `GameState.phase.cont.pendingOp`, and `damageDefender` rides its `rest` tail),
    // so the question is live and not skippable. The answer is that EVERY value this
    // arm emits was already representable and already authored: `from: "yours"`
    // (D96), `from: "yourActive"` (0.x), `count: "any"` + `cap` (D97),
    // `count: "all"` (0.x), `recordAs: "discarded"` (D96), `filter: providesEnergy`
    // (D191) and `filter: basicEnergy` (M5) — so a v25 record holding this program
    // means exactly what it meant before the arm existed. **NEW COMBINATIONS OF AN
    // ALREADY-PERSISTABLE VOCABULARY ARE NOT A NEW SHAPE** (D361's own test, and its
    // words). The post-bump anchor pass was clean.
    // 🆕🆕 D401 — 0.305.0 -> **0.306.0**, THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE.
    // 🆕🆕 D400 — 0.304.0 -> **0.305.0**, THE ANY-TARGET ARITY.
    // `MATCH_RECORD_VERSION` **STAYS 25**, asked rather than assumed. `damageChosen`
    // PARKS (it rides `GameState.phase.cont.pendingOp`), so the question is a real
    // one — and the answer is that NO FIELD IS ADDED. `count` has been a required
    // `number` on that op since M4 and two registry rows already authored the value 2,
    // so a v25 record can already carry this program and means exactly what it meant.
    // Authoring an EXISTING field at a NEW VALUE is a widening; adding a field is not.
    // The post-bump anchor pass was clean.
    // 🆕🆕 D416 — 0.319.0 → **0.320.0**, moved with the behaviour: THE PARKING KO PAIR (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2 printings — **2 sentences / 6 printings**, both claimed WHOLE by `deriveAttackEffect`) is a WIDENING — ONE new PARKING `EffectOp` (`knockOutChosen`, required `target` plus two optional riders) reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep, ZERO new persisted record fields — so the engine version moves and `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads).
    // 🆕🆕 D417 — 0.320.0 → **0.321.0**, moved with the behaviour: THE TRAILING CANCEL (*"Discard a Stadium in play. If you can't, this attack does nothing."*, Eternatus `sv08-141`, **1 legal printing**) gains a TWELFTH whole-sentence reader, `deriveAttackCancelRequirement` — the anaphoric cancel `deriveAttackRequirement`'s leading `^If` could never see. `MATCH_RECORD_VERSION` **STAYS 26**, asked rather than assumed: the reader returns an EXISTING `BoardCondition` through the EXISTING requirement channel and adds NO persisted field, so no v26 record gains a shape this deploy would not already read.
    // 🆕🆕 D422 — 0.323.0 → **0.324.0**, moved with the behaviour: THE OPTIONAL SELF-SWITCH (*"You may switch this Pokémon with 1 of your Benched Pokémon."*, **3 legal printings** — the last unbuilt sentence of the family D181 opened and D189 half-closed) is a pure READER widening: ONE anchor and ONE `deriveAttackEffect` arm returning `[{ op: "optional", note, then: [{ op: "switchActive" }] }]`, both ops shipped. `MATCH_RECORD_VERSION` **STAYS 26**, DRIVEN rather than asserted (`optionalSelfSwitch.test.ts` §8 round-trips BOTH parks through JSON, replays each through `applyAction`, and compares their key sets against the parks THIS build writes for two SHIPPED sentences — D227's mirror for the `confirm`, D189's bare self-switch for the `choosePokemon`). ZERO new ops, fields, prompt kinds, events, log rows, redactions or persisted shapes, so no v26 record gains a shape this deploy would not already read.
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe("0.400.0");
    expect(manifest.version).toBe(engineVersion);
  });
});
