import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { countEnergyInPlay } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction, engineVersion, programFor } from "./index";
import {
  BOARD_ENERGY_DECK,
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.311.0 → 0.312.0 — 🆕🆕 D407: THE BOARD-WIDE OWN-ENERGY COUNT.
//
//   "This attack does 30 more damage for each {G} Energy attached to all of your
//    Pokémon."   — 1 sentence, 4 LEGAL printings
//
// THE ZONE D196 REFUSED `energyOnSelf`, BOUGHT ELEVEN SLICES LATER BECAUSE THE POOL
// MOVED AND NOT BECAUSE THE ARGUMENT DID. D196 measured the board-wide spelling of
// the attacker's own Energy as UNPRINTED and declined the field on exactly that
// ground; D406 found the sentence in the committed `legal_standard = 1` attack
// column while pricing a Tool count one resource over and left `toolCountScaling.
// test.ts` §2 pinning it as unread. This slice builds it, and NO new member, NO new
// counter, NO new op and NO new state were needed: `countEnergyInPlay` has answered
// "how much Energy is attached to all of X's Pokémon" since D193 and is what
// `energyOnOpponent`'s `zone: "board"` arm already delegates to at the OTHER end of
// the table.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
// The evaluator has FIVE ways to be wrong and every one of them is a real
// neighbouring arm rather than a straw:
//
//   ⑴ THE SEAT. The printed word is "all of YOUR Pokémon" and the attack damages
//      the opponent, so the two seats are opposite ends of one swing —
//      `energyOnOpponent`'s board arm reads `defenderSeat` five lines up in the
//      same `switch` and is otherwise the IDENTICAL expression. §4's canonical
//      board holds 4 {G} on the attacker's side and 8 on the defender's.
//   ⑵ THE ZONE. This is the whole slice: `undefined` means the ATTACKING BODY and
//      "board" means §6.3's "in play", Active **plus** Bench. The canonical board
//      splits 1 on the Active and 3 on the Bench, so the shipped (zone-less)
//      reading says 1 and a Bench-only one says 3.
//   ⑶ THE FILTER. The printed noun is "{G} Energy" and the cost is `{C}`, so the
//      card that pays for the attack is one the count must REFUSE. An untyped read
//      of the same board says 5.
//   ⑷ PROVISION, NOT THE PRINTED NAME (D118). A wildcard Luminous counts toward
//      {G} for exactly as long as it does everywhere else, and stops the moment a
//      second Special demotes it to {C} — driven in BOTH directions, because that
//      is the reading this arm inherits by delegating rather than one it chooses.
//   ⑸ CARDS, NOT UNITS. One Luminous provides every type and is still ONE card, so
//      it moves the count by 1 rather than by the size of the type table.
//
// ⚠️ **AND THE BASE IS KEPT, WHICH IS THE SIXTH THING AND THE ONLY ONE THAT IS NOT
// AN ARM.** The sentence carries "more" (D145/D167's discriminator), so it lands on
// the ADDITIVE fold and `scaledBase` keeps the printed `20+`. The fixture's base is
// 20 and its per-unit 30 precisely so that "the base was dropped" and "one fewer
// Energy was counted" are different numbers.
//
// ⚠️ **THE MEMBER IS ADDITIVE-ONLY ON THIS ZONE, AND THAT IS AN ABSENCE THIS SUITE
// PINS RATHER THAN AN OVERSIGHT.** The `×` spelling of a board-wide OWN Energy
// count is printed nowhere in the legal attack column, so `SELF_ENERGY_MULTIPLY`
// keeps its bare "this Pokémon" tail — the exact mirror of `energyOnOpponent`,
// whose `×` reader carries the zone and whose `+` reader hard-codes one.

/** The printed sentence, byte for byte off `legalAttackCorpus()` — the committed
    `legal_standard = 1` attack column. `Pokémon` carries the real é (U+00E9) and
    there is no apostrophe anywhere in it. */
const BOARD_ENERGY =
  "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.";

/** The SHIPPED spelling this member has read since D196 — same fold, same filter,
    one zone in. It is the control for the optional field's POLARITY: it must keep
    producing the zone-LESS shape, or every one of the family's 21 legal printings
    silently starts counting the whole board. */
const SELF_ENERGY = "This attack does 30 more damage for each {G} Energy attached to this Pokémon.";

/** 🛑 **THE REAL CATALOG NEAR MISS, AND IT IS ONE WORD WIDER THAN THE ANCHOR.**
    1 legal printing, and it names a SUBGROUP of the same zone rather than the zone.
    A widening spelled `all of your .* Pokémon` scores it off the whole board and
    authors a card the catalog does not print (D120).

    🆕🆕 **D470 — IT IS BUILT NOW, AND THE RUNG BELOW IS RE-POINTED RATHER THAN
    DELETED OR FLIPPED** (D438/D444/D447: a `toBeNull` on a sentence the catalog
    PRINTS is a liability with an expiry date — D449/D467 — and the repair is a new
    TRUE claim that keeps the old one's discrimination). What the old `toBeNull`
    could catch was *"a widening of THIS anchor swallows the subgroup and scores it
    off the whole board"*, and that is still exactly what must not happen. So the rung
    now asserts the derived VALUE and, in particular, that it CARRIES A FILTER naming
    `Iono` — a reading that scored the whole board would produce the same shape as
    `BOARD_ENERGY` and fail here — while the three OTHER readers keep their nulls,
    unchanged and still true. */
const OWNER_PREFIXED_BOARD =
  "This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon.";

/** The `×` twin of the built sentence. **PRINTED NOWHERE** — the column's only
    bare-fold "attached to all of your Pokémon" sentence counts Pokémon TOOLS
    (D406) — so this is an ABSENCE and is pinned as such. */
const UNPRINTED_MULTIPLY =
  "This attack does 30 damage for each {G} Energy attached to all of your Pokémon.";

/** The OPPONENT-side board spelling on the ADDITIVE fold, printed nowhere either —
    which is why `OPPONENT_ENERGY_SCALE` hard-codes `zone: "active"` and why this
    slice is the mirror of that refusal rather than a copy of it. */
const UNPRINTED_OPPONENT_ADDITIVE =
  "This attack does 30 more damage for each {G} Energy attached to all of your opponent's Pokémon.";

/** One seed for the whole suite. Nothing here flips a coin and every Active, every
    Benched body and every attached card is placed by surgery, so a seed table would
    describe a shuffle rather than a rule (D143's move). */
const SEED = 11;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both Actives are placed by surgery and BOTH Benches are cleared to
    nothing: every number this suite reads is a POPULATION, so a body the setup
    shuffle happened to place would move the answer silently. ONE `fix-energy` is
    attached to pay the printed `{C}` — and it is also the Energy the `{G}` filter
    must refuse, which is why the cost is Colorless and not Grass. */
function board(by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  const foe = opener;
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: BOARD_ENERGY_DECK, p2: BOARD_ENERGY_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-boardgrass");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-bigbody");
  return clearBench(state, foe);
}

/** Attach `active` onto the seat's Active, then create one `fix-bigbody` per entry
    of `bench` and attach that entry's cards to it. The two lists are independent on
    purpose: the BODY count and the ENERGY count must be able to disagree, or ⑵ and
    the body-count near miss are untestable. */
function dress(
  state: GameState,
  seat: Seat,
  active: readonly string[],
  bench: readonly (readonly string[])[],
): GameState {
  let next = state;
  for (const id of active) next = attachFromDeck(next, seat, id, 1);
  for (const [index, cards] of bench.entries()) {
    next = benchFromDeck(next, seat, "fix-bigbody");
    for (const id of cards) next = attachBenchFromDeck(next, seat, index, id, 1);
  }
  return next;
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

const G = "fix-grass-energy";
const C = "fix-energy";

/** 🛑 **THE CANONICAL BOARD, AND EVERY WRONG ANSWER ON IT IS A DIFFERENT NUMBER.**
    The attacker's Active wears the {C} that paid the cost plus 1 {G}; bench[0] wears
    2 {G} and bench[1] wears 1 {G}. The defender wears 6 {G} on its Active and 2 on
    its one benched body. So:

      truth (own board, {G} only)          4 → **140**
      the seat flipped (their board)       8 → 260
      their Active alone                   6 → 200
      the ATTACKING BODY alone (D196)      1 →  50
      the Bench alone                      3 → 110
      the whole own board, UNTYPED         5 → 170
      the own Active, UNTYPED              2 →  80
      own bodies in play                   3 → 110
      own benched BODIES                   2 →  80

    Every wrong reading is a distinct number and none of them is 4. */
function canonical(by: Seat = "p1"): GameState {
  const foe = by === "p1" ? "p2" : "p1";
  const state = dress(board(by), by, [G], [[G, G], [G]]);
  return dress(state, foe, [G, G, G, G, G, G], [[G, G]]);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data and the population.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, its population, and the fixture that carries it", () => {
  it("the column prints it FOUR times, on exactly one record", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === BOARD_ENERGY);
    expect(rows).toHaveLength(1);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(4);
  });

  it("🛑 and it is the column's ONLY board-wide OWN-side Energy sentence", () => {
    // The measurement the zone rests on, and the one D196 made in the other
    // direction against a pool that no longer says this. If a second spelling
    // existed — an untyped one, a `×` one, or a second type filter — this rung
    // names it and the shape decisions above would have to be re-argued.
    const family = legalAttackCorpus().filter(
      ([, s]) => s.includes("Energy attached to all of your") && !s.includes("opponent"),
    );
    expect(family.map(([, s]) => s)).toEqual([OWNER_PREFIXED_BOARD, BOARD_ENERGY]);
    // …and the owner-prefixed row is the ONE near miss, at 1 printing. It is in the
    // list above rather than filtered out of it, so its existence is asserted here
    // and its REFUSAL asserted in §2 — two claims, not one.
    expect(family.find(([, s]) => s === OWNER_PREFIXED_BOARD)?.[0]).toBe(1);
  });

  it("carries fix-boardgrass's WHOLE printed card, `20+` marker included", () => {
    // The whole list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode). ⚠️ THE TRAILING "+" IS LOAD-BEARING: it is the marker this fold
    // consumes, and it is 20 rather than 30 so that a dropped base and a missed
    // Energy are different numbers.
    expect(FIXTURE_POOL["fix-boardgrass"]?.attacks).toEqual([
      {
        cost: ["Colorless"],
        name: "Verdant Surge",
        damage: "20+",
        effect: BOARD_ENERGY,
      },
    ]);
  });

  it("AUTHORS nothing — the printing is read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the
    // claim that says the text path is the one being driven below.
    expect(programFor("fix-boardgrass")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader, and the optional field's polarity.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — deriveAttackDamageBonus: the zone D196 refused", () => {
  it("reads the printed sentence as energyOnSelf at zone 'board', typed {G}", () => {
    expect(deriveAttackDamageBonus(BOARD_ENERGY)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Grass" },
    });
  });

  it("🛑 the SHIPPED spelling still produces the ZONE-LESS shape — the field's polarity", () => {
    // The whole reason the field is OPTIONAL rather than required: `undefined` is
    // the ATTACKING BODY, so the 21 legal printings that reached this arm before
    // D407 are byte-identical afterwards. A producer that emitted `zone: "board"`
    // unconditionally — or a default that meant "board" when the field is absent —
    // would silently score every Energy on the board for all of them, and this is
    // the rung that goes red for it.
    const shipped = deriveAttackDamageBonus(SELF_ENERGY);
    expect(shipped).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: "Grass" },
    });
    expect(shipped?.count).not.toHaveProperty("zone");
  });

  it("🛑 the OWNER-PREFIXED board is a SUBGROUP and not the zone — D470 builds it as one", () => {
    // 1 real legal printing. ⚠️ **THE OLD CLAIM WAS `toBeNull` AND IT EXPIRED AT
    // D470**; this is its re-pointing, and the discrimination it has to preserve is
    // that the subgroup is NOT scored off the whole board. A widened
    // `SELF_ENERGY_SCALE` would answer the shape `BOARD_ENERGY` answers — zone
    // "board", NO filter — so the `filter` assertion is the one that goes red for it.
    expect(deriveAttackDamageBonus(OWNER_PREFIXED_BOARD)).toEqual({
      per: 20,
      count: {
        kind: "energyOnSelf",
        zone: "board",
        energyType: "Lightning",
        filter: { kind: "ownerPokemon", owner: "Iono" },
      },
    });
    // …and the sentence THIS anchor owns still carries NO filter, which is the other
    // half of the same claim: one sentence names the zone, the other names a subgroup
    // of it, and they must not derive to the same thing.
    expect(deriveAttackDamageBonus(BOARD_ENERGY)?.count).not.toHaveProperty("filter");
    // The three OTHER readers are unchanged and still refuse it — the original rung's
    // "every reader in the family, not merely this one" half, kept verbatim.
    expect(deriveAttackDamageMultiplier(OWNER_PREFIXED_BOARD)).toBeNull();
    expect(deriveAttackDamagePenalty(OWNER_PREFIXED_BOARD)).toBeNull();
    expect(deriveAttackEffect(OWNER_PREFIXED_BOARD)).toBeNull();
  });

  it("🛑 ADDITIVE-ONLY on this zone: the `×` twin is an ABSENCE and stays loud", () => {
    // The column prints no bare-fold board-wide OWN Energy sentence at all, so
    // `SELF_ENERGY_MULTIPLY` keeps its "this Pokémon" tail. Turns red the moment
    // somebody widens the multiply pattern "for symmetry".
    expect(deriveAttackDamageMultiplier(UNPRINTED_MULTIPLY)).toBeNull();
    expect(deriveAttackDamageBonus(UNPRINTED_MULTIPLY)).toBeNull();
    // …while the `×` reader's OWN zone-less spelling still answers, so the null
    // above is a statement about the ZONE rather than about a dead reader.
    expect(
      deriveAttackDamageMultiplier("This attack does 30 damage for each Energy attached to this Pokémon."),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", energyType: null } });
  });

  it("🛑 the OPPONENT-side board on the ADDITIVE fold is still unprinted and still refused", () => {
    // D193's refusal, unchanged by this slice and asserted rather than assumed:
    // the two zone captures sit on OPPOSITE folds, so widening one says nothing
    // about the other.
    expect(deriveAttackDamageBonus(UNPRINTED_OPPONENT_ADDITIVE)).toBeNull();
    expect(deriveAttackDamageBonus(
      "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.",
    )?.count).toEqual({ kind: "energyOnOpponent", zone: "active", energyType: null });
  });

  it("the whole-sentence anchor holds at both ends, on the capital, and on the filter", () => {
    // The family's stated anchor discipline: no /i, a required trailing period, a
    // capital `This`, and no leading or trailing text.
    expect(
      deriveAttackDamageBonus(
        "this attack does 30 more damage for each {G} Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon",
      ),
    ).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${BOARD_ENERGY}`)).toBeNull();
    expect(deriveAttackDamageBonus(`${BOARD_ENERGY} Discard an Energy from this Pokémon.`)).toBeNull();
    // A printed 0 adds nothing and stays LOUD — the guard every arm in both
    // families carries.
    expect(
      deriveAttackDamageBonus(
        "This attack does 0 more damage for each {G} Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
    // An UNRESOLVABLE filter stays LOUD rather than quietly counting everything —
    // the distinction the whole `attachedEnergyFilter` shape exists for, and it
    // must survive on the NEW zone and not only on the old one. `{C}` is
    // deliberately absent from the token table.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {C} Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
    // 🆕🆕 **D500 — `Basic` IS NO LONGER THE UNRESOLVABLE CASE, AND THE RUNG KEEPS ITS
    // JOB BY NAMING WHAT REPLACED IT.** The token is in `CLAUSE_ENERGY_TOKENS` now and
    // resolves to the card CATEGORY `"basic"` on this zone as on every other. What
    // still holds the "stays LOUD" half of this rung is the `{C}` case directly above
    // and the junk case directly below — and the pair matters, because `{C}`'s absence
    // is a DECISION that could be revisited while a bogus word's is not.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Basic Energy attached to all of your Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: "basic" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Fancy Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
  });

  it("the `per`, the filter and the zone are all CAPTURES, on constructed text", () => {
    // Labelled as constructed rather than presented as a card (D121). Three
    // different amounts, two different filters and the absent filter, all on the
    // new zone: a hard-coded 30, a hard-coded "Grass" or a hard-coded zone each
    // fails exactly one of these.
    expect(
      deriveAttackDamageBonus(BOARD_ENERGY.replace("30 more", "50 more")),
    ).toEqual({ per: 50, count: { kind: "energyOnSelf", zone: "board", energyType: "Grass" } });
    expect(
      deriveAttackDamageBonus(BOARD_ENERGY.replace("{G} ", "")),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: null } });
    expect(
      deriveAttackDamageBonus(BOARD_ENERGY.replace("{G}", "Special")),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: "special" } });
    // D118's dual notation reaches the new zone too, through the SHARED token
    // table rather than a local lookup.
    expect(
      deriveAttackDamageBonus(BOARD_ENERGY.replace("{G}", "Water")),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: "Water" } });
  });

  it("the OTHER readers refuse the built sentence — one fold, not four", () => {
    expect(deriveAttackDamageMultiplier(BOARD_ENERGY)).toBeNull();
    expect(deriveAttackDamagePenalty(BOARD_ENERGY)).toBeNull();
    expect(deriveAttackEffect(BOARD_ENERGY)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the counter this arm delegates to, verified rather than inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — countEnergyInPlay on the ATTACKER's side, and the readings it separates", () => {
  it("counts Active PLUS Bench, and a bare board is 0 for the filtered read", () => {
    // "All of your Pokémon" is §6.3's "in play" — Active + Bench and nothing else.
    // Driven as a three-way split rather than asserted: the {C} that pays the cost
    // is on the Active throughout, so the UNTYPED read is never 0 and the two
    // readings can be told apart at every step.
    const bare = board();
    expect(countEnergyInPlay(bare, "p1", "Grass")).toBe(0);
    expect(countEnergyInPlay(bare, "p1", null)).toBe(1);
    expect(countEnergyInPlay(dress(bare, "p1", [G], []), "p1", "Grass")).toBe(1);
    expect(countEnergyInPlay(dress(bare, "p1", [], [[G, G]]), "p1", "Grass")).toBe(2);
    expect(countEnergyInPlay(dress(bare, "p1", [G], [[G, G]]), "p1", "Grass")).toBe(3);
  });

  it("🛑 PROVISION, not the printed name — a wildcard counts, and a demotion stops it", () => {
    // D118's rule, and the reason this arm may delegate at all: an Energy that can
    // pay a {G} cost is exactly an Energy a {G} sentence counts. Luminous provides
    // every type, so it counts here; attach a SECOND Special to the same body and
    // it is demoted to {C} and stops counting — on a board where nothing else
    // moved, no card left, and no counter changed. Only a provision-based read
    // behaves this way; a "was a Luminous ever attached" read cannot.
    const wild = dress(board(), "p1", [], [["sv02-191"]]);
    expect(countEnergyInPlay(wild, "p1", "Grass")).toBe(1);
    const demoted = attachBenchFromDeck(wild, "p1", 0, "fix-special", 1);
    expect(demoted.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(countEnergyInPlay(demoted, "p1", "Grass")).toBe(0);
    // …and the UNTYPED read is unmoved across the demotion, which is what says the
    // two cards are still there and only the PROVISION changed.
    expect(countEnergyInPlay(wild, "p1", null)).toBe(2);
    expect(countEnergyInPlay(demoted, "p1", null)).toBe(3);
  });

  it("🛑 CARDS, not units: one wildcard moves the count by ONE", () => {
    // A Luminous provides every type in the table. If this counted UNITS rather
    // than cards it would move the {G} total by more than one, and the same card
    // would be counted again under {R}, {W} and every other filter as though the
    // board held nine Energy. It is one card, and it counts once per filter.
    const bare = dress(board(), "p1", [], [[G]]);
    expect(countEnergyInPlay(bare, "p1", "Grass")).toBe(1);
    const wild = attachBenchFromDeck(bare, "p1", 0, "sv02-191", 1);
    expect(countEnergyInPlay(wild, "p1", "Grass")).toBe(2);
    expect(countEnergyInPlay(wild, "p1", "Fire")).toBe(1);
    expect(countEnergyInPlay(wild, "p1", null)).toBe(3);
  });

  it("the {C} that pays the cost is REFUSED by the {G} filter", () => {
    // ⑶, at the counter rather than at the fold. `fix-energy` is a Basic Colorless
    // and Colorless is not in the vocabulary at all, so a board that can legally
    // attack still counts 0.
    const bare = board();
    expect(bare.players.p1.active?.energy).toHaveLength(1);
    expect(countEnergyInPlay(bare, "p1", "Grass")).toBe(0);
    expect(countEnergyInPlay(dress(bare, "p1", [C, C], []), "p1", "Grass")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the fold on a real board: base + per × count.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the `+` fold on a live board", () => {
  it("🛑 the canonical board really does separate every candidate reading", () => {
    // D214's attribution control applied to a SET of readings: a rung that only
    // exercises boards where the candidates agree is the vacuous guard this repo
    // keeps rediscovering. Asserted BEFORE any damage is read, so a later drift in
    // the fixture deck cannot quietly collapse two of them onto one number.
    const state = canonical();
    const mine = state.players.p1;
    expect(countEnergyInPlay(state, "p1", "Grass")).toBe(4);
    expect(countEnergyInPlay(state, "p1", null)).toBe(5);
    expect(countEnergyInPlay(state, "p2", "Grass")).toBe(8);
    expect(mine.active?.energy).toHaveLength(2);
    expect(mine.bench).toHaveLength(2);
    expect(mine.bench.reduce((n, p) => n + p.energy.length, 0)).toBe(3);
    expect(state.players.p2.active?.energy).toHaveLength(6);
  });

  it("deals 20 + 30 × the {G} on the ATTACKER's whole board", () => {
    const { events } = swing(canonical());
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 120, dealt: 140 });
  });

  it("🛑 the PRINTED BASE IS KEPT: an Energy-free board still deals the printed 20", () => {
    // The `+` fold's half of the discriminator. A build that dropped the base — the
    // `×` fold's behaviour, one reader over — deals 0 here and emits no
    // DAMAGE_DEALT row at all, and would be green on every other rung in this file.
    const { events } = swing(board());
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
    expect(events.some((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toBe(false);
  });

  it("🛑 the ZONE is the whole board: the BENCH counts, and it is the slice", () => {
    // The shipped (zone-less) reading deals 20 here — the Active holds only the {C}
    // that paid — and the truth is 110. This is the single rung that goes red if
    // the `zone` field is dropped, ignored, or never emitted by the producer.
    const state = dress(board(), "p1", [], [[G, G], [G]]);
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(find(swing(state).events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      scaled: 90,
      dealt: 110,
    });
  });

  it("🛑 the SEAT is the attacker's: the opponent's whole board is invisible", () => {
    // The defender wears 8 {G} and the attacker none. A `defenderSeat` read — the
    // arm five lines up in the same switch, and the identical expression otherwise
    // — deals 260 here; the truth is the bare printed 20.
    const state = dress(board(), "p2", [G, G, G, G, G, G], [[G, G]]);
    expect(countEnergyInPlay(state, "p2", "Grass")).toBe(8);
    const dealt = find(swing(state).events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("🛑 the FILTER bites on a live board: four {C} across the side score nothing", () => {
    // ⑶ at the fold. Every body holds Colorless and the printed noun is {G}, so an
    // untyped read deals 140 here and the truth is the printed 20.
    const state = dress(board(), "p1", [C], [[C], [C]]);
    expect(countEnergyInPlay(state, "p1", null)).toBe(4);
    expect(find(swing(state).events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 20 });
  });

  it("🛑 a WILDCARD on the BENCH scores, and its DEMOTION un-scores it", () => {
    // ⑷ driven through the whole fold rather than at the counter alone: the two
    // things this slice delegates for — the zone and the provision reading — are
    // both live in this one pair of boards, and neither of them is the attacking
    // body's own Energy.
    const wild = dress(board(), "p1", [], [["sv02-191"]]);
    expect(find(swing(wild).events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      scaled: 30,
      dealt: 50,
    });
    const demoted = attachBenchFromDeck(wild, "p1", 0, "fix-special", 1);
    const dealt = find(swing(demoted).events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("the count is READ AT DECLARATION and scales linearly across the whole range", () => {
    // One board per {G} count, so the arm is `base + per × count` rather than a
    // threshold or a saturating read. The Energy is split across the Active and the
    // Bench at every step, so no single zone can produce the sequence on its own.
    for (const [active, bench, expected] of [
      [[G], [], 50],
      [[G], [[G]], 80],
      [[G], [[G, G]], 110],
      [[G], [[G, G], [G]], 140],
      [[G, G], [[G, G], [G]], 170],
    ] as const) {
      const state = dress(board(), "p1", active, bench);
      expect(find(swing(state).events, "DAMAGE_DEALT")?.dealt).toBe(expected);
    }
  });

  it("BODIES are not the resource: three bare benched Pokémon score nothing", () => {
    // `yourBenchCount` reads exactly this board as 3 and would deal 110. The Energy
    // count reads it as 0 and deals the printed 20.
    const state = dress(board(), "p1", [], [[], [], []]);
    expect(state.players.p1.bench).toHaveLength(3);
    expect(find(swing(state).events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 20 });
  });

  it("the seats are symmetric — p2 attacking reads p2's board", () => {
    // The evaluator takes `attackerSeat`, so the same board mirrored gives the same
    // number. A hard-coded "p1" would pass every rung above and fail here.
    const { events } = swing(canonical("p2"), "p2");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 120, dealt: 140 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the persisted question, asked and answered.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the persisted question, and the version pair", () => {
  it("🛑 MATCH_RECORD_VERSION STAYS 25 — a DamageCountSource field is never persisted", () => {
    // Argued from where the field is STORED, not from the file it is declared in:
    // `zone` lives inside a DERIVED `AttackDamageBonus` computed from card text and
    // consumed in the same tick. Nothing parks it, no `EffectOp` carries it, and no
    // `MatchRecord` field holds one — so no v25 record could ever have contained a
    // `DamageCountSource` in the first place, let alone this field on one.
    // DRIVEN rather than argued (`selfEnergyScaling.test.ts`'s idiom, and
    // `MATCH_RECORD_VERSION` is not an exported constant to assert against): the two
    // things that could park are an `EffectOp` and a program, and this sentence
    // produces neither.
    expect(deriveAttackEffect(BOARD_ENERGY)).toBeNull();
    expect(programFor("fix-boardgrass")).toBeUndefined();
    expect(deriveAttackDamageBonus(BOARD_ENERGY)).not.toBeNull();
    // 🆕🆕 D416 — 0.319.0 → **0.320.0**, moved with the behaviour: THE PARKING KO PAIR (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2 printings — **2 sentences / 6 printings**, both claimed WHOLE by `deriveAttackEffect`) is a WIDENING — ONE new PARKING `EffectOp` (`knockOutChosen`, required `target` plus two optional riders) reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep, ZERO new persisted record fields — so the engine version moves and `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads).
    // 🆕🆕 D417 — 0.320.0 → **0.321.0**, moved with the behaviour: THE TRAILING CANCEL (*"Discard a Stadium in play. If you can't, this attack does nothing."*, Eternatus `sv08-141`, **1 legal printing**) gains a TWELFTH whole-sentence reader, `deriveAttackCancelRequirement` — the anaphoric cancel `deriveAttackRequirement`'s leading `^If` could never see. `MATCH_RECORD_VERSION` **STAYS 26**, asked rather than assumed: the reader returns an EXISTING `BoardCondition` through the EXISTING requirement channel and adds NO persisted field, so no v26 record gains a shape this deploy would not already read.
    expect(engineVersion).toBe("0.400.0");
  });
});
