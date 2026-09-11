import { describe, expect, it } from "vitest";
import { disabledAbilityUids, passivesOf } from "./continuous";
import { applyAction, programFor } from "./index";
import type {
  CoinFace,
  GameEvent,
  GameState,
  PokemonRef,
  PokemonTarget,
  Seat,
  StatusName,
} from "./index";
import { type LogContext, logFromEvents } from "./log";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  THERAPEUTIC_ENERGY_DECK,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
} from "./testFixtures";

// 0.117.0 → 0.118.0 — THERAPEUTIC ENERGY sv02-193 (P3-M5 long tail, D174).
// 0.118.0 → 0.119.0 — D176 added MOMENTS 3 and 4 to the call-site group below: the
// §7.4 Tool attach and the Checkup's betweenTurns programs, the two routes D174
// claimed were covered for free and were not.
//
//   "As long as this card is attached to a Pokémon, it provides {C} Energy.
//
//    The Pokémon this card is attached to recovers from being Asleep, Confused,
//    or Paralyzed and can't be affected by those Special Conditions."
//
// The §12 status-immunity family's THIRD SENTENCE, its FOURTH printing, and the
// only one of the four that is not a Pokémon. D172 built the other three
// (`PassiveEffects.statusImmunity`, a gate at `applyStatus`, `STATUS_PREVENTED`),
// scoped this one OUT deliberately, and priced it at four edits. It was four edits
// and none of them was the one the price named first.
//
// WHAT IS ACTUALLY NEW, and why this is not statusImmunity.test.ts with an Energy:
//   • A THIRD SOURCE CLASS. `passivesOf`'s `sources` has been [the top card's
//     passive, ...the Tools'] since M4 and had NEVER walked `pokemon.energy`. Every
//     one of the twelve fields that fold READS gained an attached-Energy contributor
//     the day the line landed, which is why the audit is the biggest single item in
//     this slice and is asserted here rather than described in a comment.
//   • THE §9 ANSWER HAS TWO SIGNS NOW. D172 got suppression FREE by riding the
//     fold: a Pokémon's printed passive IS an Ability. An Energy is not, so the new
//     source must be EXEMPT — the same seam, the opposite verdict, and the one
//     board that shows both at once is a locked Pachirisu holding this Energy.
//   • A CONTINUOUS CLEAR, WHICH THIS ENGINE HAD NEVER HAD. Everything before this
//     either APPLIES a condition (`applyStatus`, the only writer) or clears one at a
//     discrete moment (§13's Checkup steps, the three `noConditions()` placements).
//     "Recovers from being" is neither: it is a live effect removing what is already
//     there, and it means an immunity can now arrive AFTER the condition — the one
//     shape §12 immunity has never had in this engine.
//
// ⚠️ AND IT RE-OPENS D172's CHECKUP FINDING, WHICH IS ANSWERED IN FULL BELOW
// (`THE CHECKUP, RE-ANSWERED FROM SCRATCH`). Short version: the CONCLUSION survives,
// the ARGUMENT narrows, and the tripwire D172 armed for this slice did not go red
// because it was armed in a COMMENT.

/** The printed effect, byte-for-byte off the local D1 row — INCLUDING the blank
    line between its two paragraphs, which is how the catalog stores it. */
const PRINTED =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nThe Pokémon this card is attached to recovers from being Asleep, Confused, or Paralyzed and can't be affected by those Special Conditions.";

/** The three conditions the card NAMES, in printed order. Load-bearing twice: it
    is why `PassiveEffects.statusImmunity` had to widen into a list, and it is the
    whole content of both clauses. */
const NAMED: StatusName[] = ["asleep", "confused", "paralyzed"];

/** The two §12 conditions it does NOT name — the negative half of every claim
    below, and the reason "immune" is the wrong word for what this card prints. */
const UNNAMED: StatusName[] = ["burned", "poisoned"];

const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Every attacker this suite declares, with the printed INDEX and the energy its
    cost needs — read off the local D1 per printing (D144's rule). */
const ATTACKS = {
  hypnosis: { card: "fix-statuser", index: 0, energy: 0 }, // → Asleep
  confuseRay: { card: "fix-statuser", index: 1, energy: 0 }, // → Confused
  numbingBolt: { card: "fix-statuser", index: 2, energy: 0 }, // flip → Paralyzed, 10
  toxic: { card: "fix-statuser", index: 5, energy: 0 }, // → Poisoned
  hotBite: { card: "sv01-029", index: 0, energy: 1 }, // Scovillain {C} 20 → Burned
} as const;

type AttackKey = keyof typeof ATTACKS;

/** `by` opens, passes, and the OTHER seat plays turn 2 — so the attacking seat
    carries no §4 first-turn restriction. Both bodies are placed by surgery,
    because every clause on this card is read off the CURRENT board. */
function board(
  attack: AttackKey,
  defender: string,
  opts: { seed?: number; by?: Seat } = {},
): GameState {
  const by: Seat = opts.by ?? "p1";
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        opts.seed ?? SEED,
        { p1: THERAPEUTIC_ENERGY_DECK, p2: THERAPEUTIC_ENERGY_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKS[attack].card);
  if (ATTACKS[attack].energy > 0) state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, opener, defender);
  return state;
}

/** …with `count` Therapeutic Energy already on the DEFENDER, which is the board
    every immunity case below is asked on. */
function boardWithEnergy(attack: AttackKey, defender: string, count = 1, seed = SEED): GameState {
  const state = board(attack, defender, { seed });
  const opener = "p2";
  return attachFromDeck(state, opener, "sv02-193", count);
}

function swing(state: GameState, attack: AttackKey, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKS[attack].index });
}

/** A board where p2 is ON TURN with `card` as its Active. The RECOVERY half never
    attacks — it needs a body, a turn and a hand — so it wants a board named for
    what it is rather than for a declaration it will not make. */
function myTurnWith(card = "fix-bigbody"): GameState {
  return setActiveFromDeck(board("hypnosis", "fix-bigbody", { by: "p2" }), "p2", card);
}

/** Attach `cardId` from p2's hand onto its Active through the REAL §6.2 action. */
function attachFromHand(state: GameState, cardId: string, target: PokemonTarget) {
  const withCard = handFromDeck(state, "p2", cardId, 1);
  return mustApply(withCard, {
    type: "attachEnergy",
    seat: "p2",
    uid: handUid(withCard, "p2", cardId),
    target,
  });
}

const ACTIVE: PokemonTarget = { spot: "active" };

function nextFace(state: GameState): CoinFace {
  return flipCoin(state.rngState)[0];
}

/** The first seed at or after `from` whose board will flip `want` — Numbing Bolt
    is the pool's only Paralysis and it is behind a coin (D172's finding, re-used). */
function seedFlipping(want: CoinFace, defender: string, from = SEED): number {
  for (let seed = from; seed < from + 80; seed += 1) {
    if (nextFace(board("numbingBolt", defender, { seed })) === want) return seed;
  }
  throw new Error(`no seed in [${from}, ${from + 80}) flips ${want}`);
}

function conditionsOf(state: GameState, seat: Seat) {
  return state.players[seat].active?.conditions;
}

function logRows(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "P1", p2: "P2" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function logLines(state: GameState, events: GameEvent[]): string[] {
  return logRows(state, events).map((row) => row.text);
}

/** The immunities/recoveries `passivesOf` reports for a seat's Active. */
function foldOf(state: GameState, seat: Seat) {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return passivesOf(state, active);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CENSUS — re-run as its own question, and it found something D172's did not.
// ─────────────────────────────────────────────────────────────────────────────

describe("THE CENSUS — re-derived over all three columns, and WIDENED", () => {
  it("holds D172's numbers exactly: 4 printings / 3 sentences for the IMMUNITY", () => {
    // ⚠️ THE SWEEP AND ITS SCOPE (D154's rule). Local D1, 978 rows / 6 sets
    // (sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24, swsh10.5 88), 2026-08-03,
    // over ALL THREE text columns (`effect`, `abilities_json`, `attacks_json`),
    // `.schema` read first:
    //
    //   WITH t AS (SELECT id, name, COALESCE(effect,'') e,
    //                COALESCE(abilities_json,'') a, COALESCE(attacks_json,'') k
    //              FROM cards)
    //   SELECT id, name FROM t WHERE (e||a||k) LIKE '%an''t be Burned%' OR …
    //        Paralyzed / Asleep / Confused / Poisoned
    //     OR (e||a||k) LIKE '%affected by%Special Condition%';
    //
    // → the SAME six rows D172 reported, four family + two false positives
    // (sv01-010 Vivillon APPLIES a chosen condition, sv02-136 Sableye READS one),
    // both in `attacks_json`. The catalog half of D172's item was exact and stays
    // exact; the count did not move in either direction.
    const immunityFamily = ["sv01-068", "sv01-099", "sv01-208", "sv02-193"];
    expect(immunityFamily).toHaveLength(4);
    const sentences = new Set([
      "This Pokémon can't be Burned.",
      "This Pokémon can't be Paralyzed.",
      "can't be affected by those Special Conditions",
    ]);
    expect(sentences.size).toBe(3);
    // …and the fourth is the ONLY one whose text lives in `effect`, because it is
    // the only one that is not a Pokémon. That is D172's three-column rule, and it
    // is why any single-column census returns at most two of these four.
    expect(FIXTURE_POOL["sv02-193"]?.effect).toBe(PRINTED);
    for (const id of ["sv01-068", "sv01-099", "sv01-208"]) {
      expect(FIXTURE_POOL[id]?.effect ?? "").toBe("");
    }
  });

  it("⚠️ FINDS A FAMILY D172's SWEEP COULD NOT SEE — `recovers from`, 4 more printings", () => {
    // ⚠️ THE SLICE'S OWN CENSUS FINDING, and it comes from adding ONE pattern.
    // D172 swept "can't be <condition>" and "affected by … Special Condition",
    // which is the IMMUNITY vocabulary. This card's OTHER clause uses a verb neither
    // pattern contains, and sweeping `%recovers from%` over the same three columns
    // returns FOUR MORE ROWS — a whole family nobody has counted:
    //
    //   • sv01-086 / -228 / -245 Gardevoir ex "Miracle Force" ({P}{P}{C}, 190) —
    //     "This Pokémon recovers from ALL Special Conditions." An ATTACK, so the
    //     recovery is DISCRETE: it happens once, at resolution. 3 printings.
    //   • sv01-145 Blissey "Busybody Nurse" — "Once during your turn, you may use
    //     this Ability. Your Active Pokémon recovers from all Special Conditions."
    //     An ACTIVATED Ability, so discrete again. 1 printing.
    //
    // NEITHER IS BUILT, and neither is this slice's sentence: both say "recovers
    // from ALL", both fire at a MOMENT, and both would want an op (`clearStatus`)
    // rather than a continuous field. sv02-193 is the only CONTINUOUS recovery in
    // the catalog, which is exactly why it needed a new mechanism.
    //
    // ✅ **BOTH ARE BUILT AT D177** (`clearStatus.test.ts`), and this assertion is
    // re-pointed rather than deleted: the CENSUS is still this slice's finding, and
    // what changed is only the answer to "is it simulated". The op is the one this
    // comment predicted, and its NAME is asserted so a rename cannot quietly orphan
    // the prediction. The ATTACK half still has no registry `attack` row — it is
    // DERIVED, which is the cheaper outcome than the one priced here.
    expect(programFor("sv01-086")?.attack).toBeUndefined();
    expect(programFor("sv01-145")?.abilities?.[0]?.program).toEqual([{ op: "clearStatus" }]);
    // …and the one built HERE says "recovers from BEING <three names>", not "from
    // all", which is the difference the two mechanisms turn on — CONTINUOUS and
    // per-condition on this side, DISCRETE and total on theirs.
    expect(PRINTED).toContain("recovers from being Asleep, Confused, or Paralyzed");
    expect(PRINTED).not.toContain("all Special Conditions");
  });

  it("swept FIXTURE_POOL as a SEPARATE population (D156), and it is 4 of 5 at D177", () => {
    // The pool is its own population. At D174 exactly ONE of the five printings
    // that print SOME recovery clause was here, and the comment that stood in this
    // spot said the other four were "absent or textless in the pool, so a pool-only
    // sweep would report a family of one and be wrong by four".
    //
    // ⚠️ IT IS NOW FOUR OF FIVE, AND THE ONE THAT MOVED WAS THE ONE THE POOL WAS
    // LYING ABOUT. Gardevoir ex sv01-086 sat here with an EMPTY `attacks` array,
    // declared in `catalogManifest.test.ts`'s `INCOMPLETE` — so for the length of
    // that declaration **a pool census could not see its own subject** while the
    // catalog census could. D177 carried the printed attack (and both reprints, and
    // Blissey), which is the D173 rule applied to the exact fixture D173 missed.
    const recovering = Object.entries(FIXTURE_POOL)
      .filter(([, card]) =>
        [...(card.abilities ?? []), ...(card.attacks ?? [])]
          .map((entry) => entry.effect ?? "")
          .concat(card.effect ?? "")
          .some((text) => text.includes("recovers from")),
      )
      .map(([id]) => id)
      .sort();
    expect(recovering).toEqual(["sv01-086", "sv01-228", "sv01-245", "sv02-193"]);
    // The fifth is Blissey, whose sentence lives in the REGISTRY rather than on the
    // card (`programFor` keys on the id, so an `abilities` array here is inert) —
    // which is the residual limit of ANY pool sweep and is why the catalog is the
    // primary population. The body is in the pool; the sentence is not.
    expect(FIXTURE_POOL["sv01-145"]).toBeDefined();
    expect(programFor("sv01-145")?.abilities?.[0]?.name).toBe("Busybody Nurse");
  });
});

describe("the printed data — carried VERBATIM and PINNED BY ASSERTION", () => {
  it("carries both paragraphs off the D1, blank line included", () => {
    // D172's headline rule: a claim that something is pinned must name the
    // `expect`. THIS is the expect. The card's `effect` is the only text it has —
    // no abilities, no attacks — so a census that greps the pool sees the whole
    // printing or nothing.
    expect(FIXTURE_POOL["sv02-193"]).toMatchObject({
      name: "Therapeutic Energy",
      category: "Energy",
      energyType: "Special",
      effect: PRINTED,
    });
    expect(PRINTED.split("\n\n")).toHaveLength(2);
  });

  it("⚠️ names EXACTLY three conditions, and 'those' is what makes both clauses equal", () => {
    // The load-bearing datum of the whole slice. The recovery clause enumerates
    // three; the immunity clause enumerates NONE and back-references them with the
    // word "those". So the two lists are equal on THIS card as a fact about its
    // grammar — which is precisely why they are two fields written out twice rather
    // than one field read twice.
    const [, second] = PRINTED.split("\n\n");
    expect(second).toContain("recovers from being Asleep, Confused, or Paralyzed");
    expect(second).toContain("can't be affected by those Special Conditions");
    for (const word of ["Asleep", "Confused", "Paralyzed"]) expect(second).toContain(word);
    for (const word of ["Burned", "Poisoned"]) expect(second).not.toContain(word);
  });

  it("⚠️ names the rotation slot's three values, and the engine does NOT key on that", () => {
    // The coincidence that had to be refused. `SpecialConditions.rotation` is
    // "none" | "asleep" | "paralyzed" | "confused" — this card's three names are
    // exactly its three non-none values, so `rotation !== "none"` would behave
    // identically on every board this catalog can build and would be one character
    // shorter. It is NOT what was built: the tokens are the printed words (D118),
    // so a printing naming two of the three stays spellable.
    expect(programFor("sv02-193")?.energy?.passive?.statusRecovery).toEqual(NAMED);
    expect(programFor("sv02-193")?.energy?.passive?.statusImmunities).toEqual(NAMED);
    // The witness that it is a LIST and not a slot: dropping one name changes the
    // answer, which a slot check could not express.
    const state = boardWithEnergy("hypnosis", "fix-bigbody");
    expect(foldOf(state, "p2").statusImmunities).toEqual(NAMED);
    expect(foldOf(state, "p2").statusImmunities).toHaveLength(3);
  });
});

describe("the registry row — the FIRST continuous Special Energy", () => {
  it("authors both clauses under `energy.passive`, and the cost half needs nothing new", () => {
    expect(programFor("sv02-193")?.energy).toEqual({
      provides: ["Colorless"],
      passive: { statusRecovery: NAMED, statusImmunities: NAMED },
    });
    // The first paragraph is Jet Energy's line for Jet Energy's reason — a bare
    // "{C} Energy" with no rider — so nothing in the §6.1 provision path moved.
    expect(programFor("sv02-190")?.energy?.provides).toEqual(["Colorless"]);
  });

  it("⚠️ ENUMERATES every card in the pool with a continuous ENERGY surface — measured", () => {
    // The audit's controlling measurement: this is the complete set of cards whose
    // answer the D174 widening changed, so every OTHER body's fold is byte-identical
    // to what it was before `passivesOf` walked `pokemon.energy`. Swept over
    // FIXTURE_POOL because the REGISTRY map is not exported — the same view every
    // producer sweep in this repo uses, with the same named blind spot (a registry
    // row for a card with no fixture is invisible to it).
    //
    // 🛑 D261 — THIS WENT RED ON A NEW *FIXTURE*, NOT ON NEW CODE, WHICH IS EXACTLY
    // WHAT D260 SAID WOULD HAPPEN TO AN AUDITOR THAT ENUMERATES A POOL. It was the
    // slice's ONLY red in 283 files, and the row that caused it (Mist Energy
    // `sv05-161`) added ZERO engine lines. **RE-HOMED, NEVER DELETED**: the title
    // changes from "is the ONLY" to "ENUMERATES every", because the claim was never
    // that the count is one — it is that the set is KNOWN and every member is
    // deliberate. `fix-mist-energy` is the SECOND, and the first whose field is
    // read on the ATTACK channel rather than in §12.
    const withEnergyPassive = Object.keys(FIXTURE_POOL)
      .filter((id) => programFor(id)?.energy?.passive !== undefined)
      .sort();
    // 🛑 D298 — RED ON A NEW FIXTURE FOR THE SECOND TIME, exactly as D261 said it
    // would be. `fix-legacy-energy` is the surface's THIRD member and the first
    // whose field is read OUTSIDE the damage pipeline altogether — flow.ts's KO
    // sweep, on a body that is about to leave play.
    expect(withEnergyPassive).toEqual(["fix-legacy-energy", "fix-mist-energy", "sv02-193"]);
    expect(programFor("fix-legacy-energy")?.energy?.passive).toEqual({
      onKoPrizeReduction: { by: 1, oncePerGame: "Legacy Energy" },
    });
    // …and the two members write DISJOINT fields, which is what keeps the sweep a
    // measurement rather than a headcount: one is §12 status, one is the §8.5-
    // adjacent effect funnel, and neither carries the other's key.
    expect(programFor("fix-mist-energy")?.energy?.passive).toEqual({
      preventAttackEffects: true,
    });
    expect(programFor("sv02-193")?.energy?.passive?.preventAttackEffects).toBeUndefined();
    expect(programFor("fix-mist-energy")?.energy?.passive?.statusImmunities).toBeUndefined();
    // …and the two older Special Energies still carry NO continuous surface, which
    // is what makes "the interface gained a field, not a behaviour" checkable.
    expect(programFor("sv02-190")?.energy?.passive).toBeUndefined();
    expect(programFor("sv02-191")?.energy?.passive).toBeUndefined();
  });

  it("⚠️ writes NEITHER clause onto `CardProgram.passive`, which is the Pokémon surface", () => {
    // The two surfaces are genuinely distinct, and the sweep in
    // statusImmunity.test.ts is narrow BECAUSE of this rather than by oversight.
    expect(programFor("sv02-193")?.passive).toBeUndefined();
    expect(programFor("sv01-099")?.energy).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SHAPE DECISION — why D172's scalar WIDENED instead of the Energy carrying
// its own list.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the SCALAR WIDENED — the writers were counted again", () => {
  it("has THREE writers now, and the third one names three conditions", () => {
    // The rule, applied literally: *the unit of SHARING is decided by the READ
    // site, the unit of STORAGE by the WRITE sites.* D172 counted TWO writers, each
    // naming one, and made the field a scalar — correctly, on the evidence it had.
    // This slice is the third writer and it cannot be spelled by a scalar, so the
    // storage unit moved. Nothing about the READ site changed: `applyStatus` was
    // already asking `.includes` of a list.
    const writers = [
      programFor("sv01-099")?.passive?.statusImmunities,
      programFor("sv01-068")?.passive?.statusImmunities,
      programFor("sv02-193")?.energy?.passive?.statusImmunities,
    ];
    expect(writers.map((w) => w?.length)).toEqual([1, 1, 3]);
  });

  it("⚠️ keeps ONE shape across BOTH interfaces — the alternative was D131 drift", () => {
    // The road not taken: leave `PassiveEffects.statusImmunity` a scalar and give
    // `EnergyProgram` its own `statusImmunities: StatusName[]`. That would be two
    // shapes for ONE reading, on two interfaces, folded by ONE function — the exact
    // drift D131 names, and strictly worse than the widening D172 declined only
    // because the writer could not reach the field. Asserted as a shape claim: every
    // writer of the immunity, on either surface, writes a `StatusName[]`.
    for (const list of [
      programFor("sv01-099")?.passive?.statusImmunities,
      programFor("sv02-193")?.energy?.passive?.statusImmunities,
    ]) {
      expect(Array.isArray(list)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE THIRD SOURCE CLASS — the expensive edit, and its audit.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ passivesOf's THIRD SOURCE CLASS — an attached ENERGY", () => {
  it("reports the Energy's three conditions off a body with no printed immunity", () => {
    const state = boardWithEnergy("hypnosis", "fix-bigbody");
    expect(foldOf(state, "p2").statusImmunities).toEqual(NAMED);
    expect(foldOf(state, "p2").statusRecovery).toEqual(NAMED);
    // The control on the same board shape: the attacker holds no such Energy.
    expect(foldOf(state, "p1").statusImmunities).toEqual([]);
  });

  it("reports NOTHING for a BASIC energy on the same body — the source is the CARD", () => {
    // Without this the case above passes on a build that turned "has any energy
    // attached" into an immunity.
    let state = board("hypnosis", "fix-bigbody");
    state = attachFromDeck(state, "p2", "fix-energy", 3);
    expect(foldOf(state, "p2").statusImmunities).toEqual([]);
    expect(foldOf(state, "p2").statusRecovery).toEqual([]);
  });

  it("⚠️ SUMS over two attached copies, and does NOT de-duplicate", () => {
    // D172 wrote "NOT de-duplicated" as a design note with no board that could show
    // it. This is that board: two copies of one Energy on one body report six
    // entries, because the read is `.includes` and a repeated entry is
    // indistinguishable from a single one. A `Set` here would be a second collection
    // type for one membership question (D131) — and would also hide a real bug in
    // which the fold visited a source twice.
    const state = boardWithEnergy("hypnosis", "fix-bigbody", 2);
    expect(foldOf(state, "p2").statusImmunities).toHaveLength(6);
    expect(foldOf(state, "p2").statusRecovery).toHaveLength(6);
    // …and the behaviour is unchanged, which is the point of not de-duplicating.
    const { events } = swing(state, "hypnosis");
    expect(findAll(events, "STATUS_PREVENTED")).toHaveLength(1);
  });

  it("⚠️ STACKS the two source classes and keeps them DISTINGUISHABLE, in fold order", () => {
    // Pachirisu ("can't be Paralyzed") holding a Therapeutic Energy. The fold order
    // is [top card, ...tools, ...energy], so the duplicate "paralyzed" appears at
    // both ends — which is the sharpest available statement that these really are
    // two independent sources and not one reading twice.
    const state = boardWithEnergy("hypnosis", "sv01-068");
    expect(foldOf(state, "p2").statusImmunities).toEqual([
      "paralyzed",
      "asleep",
      "confused",
      "paralyzed",
    ]);
    // Only the ENERGY prints a recovery clause, so the recovery list has no
    // Pokémon contribution at all.
    expect(foldOf(state, "p2").statusRecovery).toEqual(NAMED);
  });

  it("⚠️ leaves EVERY OTHER FIELD of the fold at its zero — the audit's measurement", () => {
    // THE AUDIT. Twelve `PassiveEffects` fields silently gained an attached-Energy
    // contributor, and they fold to the ELEVEN keys asserted below. Nine of those
    // have NO writer on any Energy in this catalog, so every body's fold is
    // byte-identical to what D173 shipped — and that is asserted rather than
    // reasoned, because "no card writes it" is exactly the kind of claim that stops
    // being true without anybody noticing. The field-by-field reading of WHETHER an
    // Energy SHOULD reach each one lives in continuous.ts beside the `sources`
    // array; this case pins the consequence.
    const state = boardWithEnergy("hypnosis", "fix-bigbody", 2);
    const fold = foldOf(state, "p2");
    expect(fold.damageReductionAfterWR).toBe(0);
    expect(fold.damageBonusBeforeWR).toBe(0);
    expect(fold.conditionalDamageBonusBeforeWR).toEqual([]);
    expect(fold.targetConditionalDamageBonusBeforeWR).toEqual([]);
    expect(fold.hpBonus).toBe(0);
    expect(fold.damageAttacker).toBe(0);
    expect(fold.damageAttackerOnKo).toBe(0);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
    // The fold returns exactly FIFTEEN keys — a new one added without a re-reading
    // of this audit fails here (D160's "a diff that leaves no assertion expires"),
    // and it has now done exactly that FOUR TIMES: D192 added the twelfth, D208 the
    // thirteenth, D242 the fourteenth and D251 the fifteenth, and each re-read the
    // audit rather than bumping the number. **FOUR consecutive honourings make this
    // a property of the guard rather than of the slices that met it.**
    //
    // ⚠️ THE TWELFTH IS THE FIRST KEY OF THIS FOLD THAT IS READ OFF THE **ATTACKER**
    // (`suppressTargetEffectsOnAttack` — Walking Wake ex "Azure Seas": "Damage from
    // attacks used by this Pokémon isn't affected by any effects on your opponent's
    // Active Pokémon."), so its ENERGY reading is asked from the other side of the
    // table from every key above it. The answer is still the same: a boolean OR,
    // source-blind, `preventDamageFromExV`'s shape exactly, and correct for an
    // Energy that ever printed the sentence. It stays FALSE here, like every other
    // field, because the one live writer is an Ability on a body this board has
    // never held (continuous.ts's `sources` note carries the field-by-field read).
    expect(fold.suppressTargetEffectsOnAttack).toBe(false);
    // ⚠️ D208 ADDS THE THIRTEENTH, AND THE AUDIT IS RE-READ RATHER THAN THE NUMBER
    // BUMPED — this guard's whole purpose, honoured for the second time (D192 was
    // the first). `survivesKoAtFullHp` is the §8.1 KO-survival flag (Pikachu ex
    // "Resolute Heart" / Crustle "Sturdy", 7 printings / 7 Standard-legal).
    //
    // ITS ENERGY READING: **reachable ✔ correct** — a boolean OR, source-blind,
    // `preventDamageFromExV`'s shape exactly, and it would be RIGHT for an Energy
    // that ever printed the sentence (an attached source is not an Ability, so it
    // would correctly survive a §9 lock, which is the same exemption the Tools
    // have always had). There is no Energy writer today, and the one live
    // non-Ability printing of this sentence is a TOOL — Survival Brace sv06-164 —
    // which is unauthored for a reason that has nothing to do with this fold: its
    // second sentence, "Then, discard this card.", needs a self-discard rider.
    //
    // ⚠️ AND IT IS THE FIRST KEY OF THIS FOLD READ AT A DAMAGE **WRITE** RATHER
    // THAN INSIDE THE §8.5 PIPELINE. Every other number here changes `dealt`
    // before it lands; this one clamps the TOTAL after it does. The Energy answer
    // is unaffected by that — the fold does not know where its readers stand — but
    // it is the axis on which a future reader would most easily assume wrong.
    // FALSE here, like every other field, because no body on this board carries it.
    expect(fold.survivesKoAtFullHp).toBe(false);
    // D242 — the fold's fourteenth key, and the second COLLECTED-RAW list beside
    // its two conditional damage-bonus siblings: an always-on §8 attack GATE
    // (`cantAttackUnless`). EMPTY here, like every other field, because no body on
    // this board carries one — and empty rather than absent, which is the property
    // that stops a `?? []` at any read site hiding a wiring break.
    expect(fold.cantAttackUnless).toEqual([]);
    // 🆕 D298 — empty rather than absent, `cantAttackUnless`'s property verbatim:
    // a `?? []` at the read site could otherwise hide a wiring break.
    expect(fold.koPrizeReductions).toEqual([]);
    // D251 — the fold's FIFTEENTH key, and the audit is re-read rather than the
    // number bumped for the FOURTH time (D192, D208, D242, now this).
    // `preventDamageFromHasAbility` is the attacker-HAS-AN-ABILITY prevent
    // (Cornerstone Mask Ogerpon ex, 5 legal printings on one sentence).
    //
    // ITS ENERGY READING: **reachable ✔ correct** — a boolean OR, source-blind,
    // `preventDamageFromExV`'s shape exactly, and it would be RIGHT for an Energy
    // that ever printed the sentence: an attached source is not an Ability, so it
    // would correctly survive a §9 lock. No Energy or Tool writer today — all five
    // printings are Pokémon Abilities. ⚠️ AND ITS §9 ANSWER POINTS BOTH WAYS ON ONE
    // GATE, which is the thing this audit is most likely to get wrong later: a lock
    // over the HOLDER must switch the prevention off (this fold's `disabled` drop
    // does it), while a lock over the ATTACKER must NOT stop it counting as an
    // Ability-haver — that half is `cards.ts hasPrintedAbility`, which reads the
    // printed card and never the board. FALSE here, like every other field.
    expect(fold.preventDamageFromHasAbility).toBe(false);
    // D252 — the fold's SIXTEENTH key, and the audit is re-read rather than the
    // number bumped for the FIFTH consecutive time (D192, D208, D242, D251, now
    // this). `preventDamageAndEffectsFromSpecialEnergy` is the attacker-HAS-A-
    // SPECIAL-ENERGY prevent (Carracosta "Mighty Shell", 2 legal printings on one
    // sentence), and it is the line above's WIDE printed spelling: the same boolean
    // OR, read at FIVE sites rather than four because it stops EFFECTS as well as
    // damage.
    //
    // ITS ENERGY READING: **reachable ✔ correct, and SELF-REFERENTIAL in a way no
    // other field in this fold is** — an attached Energy writing this flag would be
    // folded exactly like the line above, and would correctly survive a §9 lock.
    // But the gate it arms reads the ATTACKER's attachments and never the HOLDER's,
    // so a Special Energy printing this sentence would NOT thereby protect the body
    // it is attached to from itself. That is coherent and it is worth writing down,
    // because "a Special Energy that prevents Special-Energy attackers" is exactly
    // the shape a later reader would assume must be circular. No Energy or Tool
    // writer today — both printings are Pokémon Abilities.
    //
    // ⚠️ AND THIS IS THE FIRST KEY OF THIS FOLD READ OUTSIDE THE DAMAGE PIPELINE
    // ALTOGETHER. `survivesKoAtFullHp` moved the boundary from "changes `dealt`" to
    // "clamps the total"; this one leaves damage behind entirely and is consulted
    // by `interpreter.ts attackEffectRefused`, the funnel for statuses, discards
    // and forced switches. The Energy answer is unaffected — the fold still does
    // not know where its readers stand — but the audit's own scope sentence
    // ("every number here changes `dealt`") is now false, and is retired here
    // rather than left to rot. FALSE on this board, like every other field.
    expect(fold.preventDamageAndEffectsFromSpecialEnergy).toBe(false);
    // D253 — the fold's SEVENTEENTH key, and the audit is RE-READ rather than the
    // number bumped for the SIXTH consecutive time (D192, D208, D242, D251, D252,
    // now this). `preventDamageAndEffectsWhileBenched` is the line above's WIDE
    // spelling AGAIN, with the attacker predicate dropped and a HOLDER-ZONE gate in
    // its place (Poltchageist / ⚠️ Misty's Magikarp — NOT Sinistcha, D305 — 3 legal
    // printings on one sentence).
    //
    // 🛑 ITS ENERGY READING IS THE FIRST IN THIS FOLD THAT IS **REACHABLE, CORRECT,
    // AND NOT SOURCE-BLIND** — and that is a new answer, not a restatement of the
    // sixteen above it. Every other key here is folded from `passive.<key>` alone,
    // so the source (holder's row / Tool / Energy) is the only thing that varies.
    // This one is folded as `passive.<key> === true && onBench`, i.e. the SOURCE is
    // ORed exactly as before but the whole disjunction is then gated on a fact
    // about the HOLDER's spot. An Energy printing "As long as this Pokémon is on
    // your Bench…" would therefore be folded correctly AND would correctly survive
    // a §9 lock — the zone term is not an Ability and `isOnBench` is deliberately
    // NOT §9-gated, because a lock changes what a body contributes and never where
    // it is standing.
    //
    // ⚠️ AND THE ZONE TERM IS WHY THIS KEY CANNOT BE AUDITED BY ITS FALSE ALONE.
    // The board below has the Therapeutic Energy holder in the ACTIVE spot, so this
    // field would read FALSE even if the `&& onBench` were deleted and every writer
    // in the registry were firing — the audit's usual "FALSE like every other
    // field" is uninformative here for the first time in sixteen keys. The real
    // guard is `curiousTeaParty.test.ts`'s bench/Active twin pair, which is where
    // the mutants live; this line records the SHAPE so the next reader of this
    // block does not mistake a structural false for a measured one. No Energy or
    // Tool writer today — all three printings are Pokémon Abilities.
    expect(fold.preventDamageAndEffectsWhileBenched).toBe(false);
    // ⚠️ D255 — the EIGHTEENTH key, and the audit's SECOND non-boolean zero after
    // `preventDamageFromTypes`. Its zero is an EMPTY LIST rather than a FALSE, which
    // is what makes it informative where the key above it is not: an Energy writer
    // pushing into it would show up as a one-element array regardless of where the
    // holder is standing. No Energy or Tool writer today — all five printings are
    // Pokémon Abilities.
    expect(fold.preventDamageFromAttackerClasses).toEqual([]);
    // ⚠️ D257 — the NINETEENTH key, and the audit's FIRST `undefined` zero. Its two
    // predecessors are a FALSE and an EMPTY LIST; this one is a NUMBER-or-nothing,
    // so "no such aura" can only be spelled as absence. That is deliberate rather
    // than incidental — `Infinity` would have been a zero of the same arithmetic
    // kind and would have shielded a body with no such Ability the moment a read
    // site compared against it without a presence check. An Energy writer pushing a
    // threshold in would show up here as a number regardless of where the holder is
    // standing, which makes this zero INFORMATIVE in the way the bench-zone key one
    // line up is not. No Energy or Tool writer today — the one real printing is a
    // Pokémon Ability, which is also why the fold's `Math.min` is unreachable.
    expect(fold.preventDamageAtOrAbove).toBeUndefined();
    // ⚠️ D258 — the TWENTIETH key, an EMPTY LIST like the eighteenth and for a
    // reason NEITHER of its two list-valued neighbours has: this gate names no
    // VALUE (so `preventDamageFromTypes`' argument does not apply) and is not
    // idempotent either (so `preventDamageFromHasAbility`'s boolean does not fit) —
    // two sources are two printed "flip a coin" instructions and therefore two RNG
    // steps. 🛑 AND THIS ZERO IS THE ONE IN THE WHOLE AUDIT THAT GUARDS THE
    // DETERMINISM RATHER THAN AN ANSWER: an Energy writer pushing an entry in would
    // make every board carrying that Energy consume one more coin per damage
    // instance, which no damage assertion anywhere in this suite could see. No
    // Energy or Tool writer today — all five printings are Pokémon Abilities.
    expect(fold.preventDamageOnCoinFlip).toEqual([]);
    // 🆕 D259 — THE TWENTY-FIRST KEY, AND THE FIRST ZERO IN THIS AUDIT THAT IS NOT
    // ABOUT DAMAGE AT ALL. `preventTrainerEffects` is read only at
    // `interpreter.ts effectRefused`'s TRAINER channel; an Energy or Tool writer
    // pushing it true would give its holder a blanket immunity to every Item and
    // Supporter the opponent plays — invisible to every damage assertion in this
    // suite, exactly like the coin-flip zero above it, and observable only here.
    // No Energy or Tool writer today: all four printings are Pokémon Abilities.
    expect(fold.preventTrainerEffects).toBe(false);
    // 🆕 D260 — THE TWENTY-SECOND KEY, AND THE TRAINER ZERO's ATTACK-CHANNEL TWIN.
    // `preventAttackEffects` (Skeledirge `sv08-031` "Unaware") is read only at
    // `interpreter.ts effectRefusedOn`'s ATTACK channel, and its printed sentence
    // has no damage half at all — *"(Damage is not an effect.)"* — so an Energy or
    // Tool writer pushing it true would hand its holder a blanket immunity to every
    // status, every forced switch and every discard an attack can name, and NOT ONE
    // damage assertion in this suite would move. Observable only here, exactly like
    // the two zeros above it. ⚠️ Its GROUP sibling (`preventAttackEffectsForGroup`)
    // is deliberately NOT here — it is a scan field, so it belongs to the
    // enumeration in the next test rather than to this fold.
    //
    // 🛑 D261 — AND THIS IS NOW THE ONLY ZERO IN THE AUDIT WITH A LIVE ENERGY
    // WRITER, WHICH CHANGES WHAT IT MEANS BUT NOT WHETHER IT HOLDS. D260 wrote
    // "no Energy or Tool writer today" one slice ago; Mist Energy `sv05-161` made
    // that false the next slice. The zero SURVIVES because this board's Energy is
    // Therapeutic Energy, and the assertion was never "no Energy can reach this
    // field" — it is **"THIS board's sources do not write it"**. 🛑 THE RESUME
    // POINT PREDICTED THIS LINE WOULD FLIP TO A ONE AND IT DID NOT, and the reason
    // is worth more than the prediction was: a fold assertion is about a BOARD, and
    // a claim about a POPULATION belongs to a pool sweep. The pool sweep is the one
    // that went red (see "ENUMERATES every card in the pool with a continuous
    // ENERGY surface" above), and it is where the population claim now lives.
    expect(fold.preventAttackEffects).toBe(false);
    expect(Object.keys(fold).sort()).toEqual(
      [
        // 🆕 D277 — the §4 attack LICENCE (`attackFirstTurnExempt`), the fold's
        // newest boolean and the MIRROR of `cantAttackUnless` below it. FALSE on
        // this board like every other zero here: Therapeutic Energy licenses
        // nothing, and the claim is about THIS board's sources rather than about
        // the population (the D261 note above, applied a second time).
        "attackFirstTurnExempt",
        "cantAttackUnless",
        "conditionalDamageBonusBeforeWR",
        "damageAttacker",
        "damageAttackerOnKo",
        "damageBonusBeforeWR",
        "damageReductionAfterWR",
        // 🆕 D278 — the §4/§10 EVOLVE licence (`evolveEarlyExempt`), the fold's
        // newest boolean and `attackFirstTurnExempt`'s twin one rule over. FALSE
        // on this board for the same reason and with the same scope: Therapeutic
        // Energy licenses nothing, and the claim is about THIS board's sources.
        // ⚠️ IT IS ALSO THE FIRST FLAG IN THIS LIST WHOSE FOLD LINE CARRIES A
        // ZONE GATE (`&& !onBench`, the printed "in the Active Spot"), so a
        // board that moved the holder to the Bench would read it false even with
        // a real writer attached — which is `preventDamageAndEffectsWhileBenched`'s
        // situation with the sign flipped.
        "evolveEarlyExempt",
        "hpBonus",
        // 🆕 D298 — the fold's newest key, and the audit is RE-READ rather than
        // the number bumped for the umpteenth consecutive time.
        // `koPrizeReductions` is the §8.1 CAUSE-CONDITIONED PRIZE REDUCTION borne
        // by an ATTACHED card (Lillie's Pearl `sv09-151`, a Tool; Legacy Energy
        // `sv06-167`, a Special Energy).
        //
        // 🛑 ITS ENERGY READING IS THE FIRST IN THIS FOLD THAT IS **REACHABLE,
        // CORRECT, AND ALREADY WRITTEN BY A REAL ENERGY** — every other key in
        // this list is audited as "an Energy could reach it and no Energy does".
        // This one has a live Energy writer from the day it landed, and that is
        // the whole point of the field: an Energy is not an Ability, so it sits
        // past the `disabled` term and a §9 lock cannot silence the reduction.
        // ⚠️ AND IT IS READ NOWHERE IN THE DAMAGE PIPELINE AT ALL — its consumer
        // is flow.ts `planPrizes`, inside the KO sweep, on the PRE-KO state. The
        // audit's scope has now widened three times (D208 "clamps the total",
        // D252 "outside the pipeline", now "after the body is already dead").
        // EMPTY here, like every other zero, because this board's Energy is
        // Therapeutic and carries no reduction.
        "koPrizeReductions",
        "preventDamageAndEffectsFromSpecialEnergy",
        "preventDamageAndEffectsWhileBenched",
        "preventDamageAtOrAbove",
        "preventDamageFromAttackerClasses",
        "preventDamageFromExV",
        "preventDamageFromHasAbility",
        "preventDamageFromTypes",
        "preventDamageOnCoinFlip",
        "preventTrainerEffects",
        "preventAttackEffects",
        "statusImmunities",
        "statusRecovery",
        "suppressTargetEffectsOnAttack",
        "survivesKoAtFullHp",
        "targetConditionalDamageBonusBeforeWR",
      ].sort(),
    );
  });

  it("⚠️ does NOT let an Energy reach the fields read by their own board scans", () => {
    // The audit's OTHER half, and the thing that bounds it to twelve fields instead
    // of twenty-three. `disableAbilities` (§9), the seat-wide reduction, the retreat and
    // attack-cost auras and the bench shield are read by dedicated scans off
    // `programFor(top.id)?.passive` on each in-play body — they never consult this
    // fold, so no Energy can ever contribute to them however the interface is
    // typed. Driven on the one that would matter most: an Energy cannot grant a
    // §9 lock, because `disabledAbilityUids` never asks it.
    const state = boardWithEnergy("hypnosis", "fix-bigbody", 2);
    expect(disabledAbilityUids(state).size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the exemption, stated the OTHER way round from D172's.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ §9 — an ENERGY IS NOT AN ABILITY, so the lock must NOT reach it", () => {
  /** Klefki "Mischievous Lock" as the attacker's ACTIVE: Basic Pokémon in play,
      BOTH sides, Klefki itself exempt by name. It reaches Pachirisu (a Basic). */
  function locked(defender: string, energies = 1): GameState {
    let state = boardWithEnergy("hypnosis", defender, energies);
    state = setActiveFromDeck(state, "p1", "sv01-096");
    return state;
  }

  it("⚠️ kills the POKÉMON's immunity and spares the ENERGY's — IN THE SAME CALL", () => {
    // The slice's sharpest single board, and the reason Pachirisu is in this deck.
    // One body, one `passivesOf` call, two sources, two §9 verdicts: the printed
    // Ability is suppressed because it IS an Ability, and the attached Energy is not
    // because it is not. A build that got the exemption wrong in either direction
    // fails here and nowhere else.
    //
    // D171's rule first: the lock is PROVED to contain the holder's uid, so the
    // positive cannot be vacuous.
    const state = locked("sv01-068");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    expect(foldOf(state, "p2").statusImmunities).toEqual(NAMED); // the Energy's three
    expect(foldOf(state, "p2").statusImmunities).not.toContain("burned");
    // Unlocked, the SAME board reports both sources — the delta is the Pokémon's
    // own "paralyzed" entries at the head of the list.
    const unlocked = boardWithEnergy("hypnosis", "sv01-068");
    expect(disabledAbilityUids(unlocked).has(activeUid(unlocked, "p2"))).toBe(false);
    expect(foldOf(unlocked, "p2").statusImmunities).toEqual([
      "paralyzed",
      "asleep",
      "confused",
      "paralyzed",
    ]);
  });

  it("keeps the RECOVERY under the lock too — it is the same source, the same verdict", () => {
    const state = locked("sv01-068");
    expect(foldOf(state, "p2").statusRecovery).toEqual(NAMED);
  });

  it("⚠️ CANNOT be driven end to end either, and it is D172's COUNTING ARGUMENT again", () => {
    // The §9 half of this family could not be watched all the way to a landed
    // condition at D172, and it still cannot — for the identical reason, which is
    // worth re-deriving rather than inheriting because the SOURCE class changed
    // and the argument did not:
    //
    //   • every §12 application in this engine comes from an ATTACK (the deriver's
    //     five arms) or from Armarouge's `activeOnly` trigger, so the source holds
    //     an Active Spot;
    //   • every §9 lock in the registry is `requiresActive` except Spiritomb's,
    //     which narrows to Basic Pokémon V — a suffix no body in this deck has;
    //   • the target must itself be an Active, because `applyStatus` only ever
    //     resolves to `players[seat].active`.
    //
    // Three Active Spots wanted, two available. So the §9 claim is asserted where
    // `applyStatus` actually reads it — on the FOLD, above — and the impossibility
    // is written down. Asserted over the POOL rather than left as a comment: put a
    // Klefki in the Active Spot and the attacker is Klefki, whose only printed
    // attack applies no condition at all.
    expect(programFor("sv01-096")?.passive?.disableAbilities?.requiresActive).toBe(true);
    expect(programFor("sv02-127")?.passive?.disableAbilities?.requiresActive).toBe(true);
    expect(programFor("sv02-089")?.passive?.disableAbilities).toMatchObject({
      stage: "Basic",
      suffix: "V",
    });
    const klefkiAttacks = FIXTURE_POOL["sv01-096"]?.attacks ?? [];
    expect(klefkiAttacks).toHaveLength(1);
    expect(klefkiAttacks[0]?.effect ?? "").not.toMatch(/is now (Asleep|Confused|Paralyzed)/);
  });

  it("⚠️ but the RULE is driven with the lock live where the read actually happens", () => {
    // The strongest board that IS reachable: the lock is live on the body, the
    // aggregation is what `applyStatus` consults, and it reports the Energy's three
    // and nothing else. A build that dropped the Energy into the `disabled` term
    // returns [] here and the immunity silently stops working under any Klefki.
    const state = locked("sv01-068");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    for (const status of NAMED) {
      expect(passivesOf(state, active).statusImmunities.includes(status)).toBe(true);
    }
  });

  it("⚠️ and the Pokémon-side control still DIES under the lock, so the pair is real", () => {
    // Without this, "the Energy survived the lock" could be a build where the lock
    // does nothing at all. Pachirisu with NO Energy, same lock, immunity gone —
    // D172's own case, re-run here as this slice's baseline.
    let state = board("numbingBolt", "sv01-068");
    state = setActiveFromDeck(state, "p1", "sv01-096");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    expect(foldOf(state, "p2").statusImmunities).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE IMMUNITY — all three named conditions, and the two it does not name.
// ─────────────────────────────────────────────────────────────────────────────

describe("THE IMMUNITY — the three NAMED conditions are refused", () => {
  it("refuses ASLEEP, with a control on the identical declaration", () => {
    const immune = swing(boardWithEnergy("hypnosis", "fix-bigbody"), "hypnosis");
    expect(conditionsOf(immune.state, "p2")?.rotation).toBe("none");
    expect(find(immune.events, "STATUS_PREVENTED")).toMatchObject({ status: "asleep" });
    expect(types(immune.events)).not.toContain("STATUS_APPLIED");

    // ⚠️ THE CONTROL IS ASSERTED ON THE EVENT AND NOT ON THE BOARD, ON PURPOSE.
    // Declaring an attack ENDS THE TURN (§5.3), so §13.3's wake-up flip runs inside
    // the same reduction and a heads seed clears the Sleep before the board can be
    // read — a board assertion here would be silently seed-dependent. The refusal
    // above has no such problem: nothing was applied, so nothing can be cleared.
    const control = swing(board("hypnosis", "fix-bigbody"), "hypnosis");
    expect(find(control.events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "asleep" });
    expect(types(control.events)).not.toContain("STATUS_PREVENTED");
    // …and the Checkup really did run on the control and NOT on the immune board,
    // which is the same fact stated where it cannot be mistaken for a coincidence.
    expect(findAll(control.events, "CHECKUP_COIN_FLIP")).toHaveLength(1);
    expect(findAll(immune.events, "CHECKUP_COIN_FLIP")).toHaveLength(0);
  });

  it("refuses CONFUSED, with a control on the identical declaration", () => {
    const immune = swing(boardWithEnergy("confuseRay", "fix-bigbody"), "confuseRay");
    expect(conditionsOf(immune.state, "p2")?.rotation).toBe("none");
    expect(find(immune.events, "STATUS_PREVENTED")).toMatchObject({ status: "confused" });

    const control = swing(board("confuseRay", "fix-bigbody"), "confuseRay");
    expect(conditionsOf(control.state, "p2")?.rotation).toBe("confused");
  });

  it("refuses PARALYZED behind its coin, with a control on the same seed", () => {
    // The pool prints no non-flip Paralysis (D172's finding), so this half is asked
    // through a gate — and the flip still happens, exactly as D172 proved for the
    // Pokémon printings: the immunity gates the APPLICATION, downstream of the coin.
    const seed = seedFlipping("heads", "fix-bigbody");
    const immune = swing(
      attachFromDeck(board("numbingBolt", "fix-bigbody", { seed }), "p2", "sv02-193", 1),
      "numbingBolt",
    );
    expect(find(immune.events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(conditionsOf(immune.state, "p2")?.rotation).toBe("none");
    expect(find(immune.events, "STATUS_PREVENTED")).toMatchObject({ status: "paralyzed" });

    const control = swing(board("numbingBolt", "fix-bigbody", { seed }), "numbingBolt");
    expect(conditionsOf(control.state, "p2")?.rotation).toBe("paralyzed");
    // …and the two boards consumed the SAME number of rng steps, so an immune body
    // does not desynchronise every later flip in the match.
    expect(immune.state.rngState).toBe(control.state.rngState);
  });

  it("⚠️ still takes BURNED — a condition this card does NOT name", () => {
    // The per-condition claim, on the one printing that names three. "Immune" is
    // the wrong word for what this card prints, and the negative is what says so.
    // Asserted on the EVENT and on the §13.2 BURN TICK rather than on the final
    // `burned` flag: the attack ends the turn, so the Checkup's cure flip runs in
    // the same reduction and a heads seed would clear the flag before it could be
    // read. The tick is the proof it was really there.
    const { events } = swing(boardWithEnergy("hotBite", "fix-bigbody"), "hotBite");
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ status: "burned" });
    expect(findAll(events, "COUNTERS_PLACED").filter((e) => e.source === "burn")).toHaveLength(1);
    expect(types(events)).not.toContain("STATUS_PREVENTED");
  });

  it("⚠️ still takes POISONED — the other unnamed condition", () => {
    const { state, events } = swing(boardWithEnergy("toxic", "fix-bigbody"), "toxic");
    expect((conditionsOf(state, "p2")?.poisonDamage ?? 0) > 0).toBe(true);
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ status: "poisoned" });
    expect(types(events)).not.toContain("STATUS_PREVENTED");
  });

  it("names exactly the printed three and neither of the other two", () => {
    const state = boardWithEnergy("hypnosis", "fix-bigbody");
    const immunities = foldOf(state, "p2").statusImmunities;
    for (const status of NAMED) expect(immunities).toContain(status);
    for (const status of UNNAMED) expect(immunities).not.toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE RECOVERY — the mechanism with no precedent.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ THE RECOVERY — a condition already present, cleared by a continuous effect", () => {
  /** The fully LEGAL sequence, with no surgery on `conditions` at all: p2 attacks
      p1's Active with Numbing Bolt and Paralyzes it, the Checkup that ends p2's
      turn leaves the Paralysis in place (§13.4 clears only for the ENDED seat), and
      p1 opens its turn holding a Therapeutic Energy. */
  function paralyzedThenMyTurn(): { state: GameState; uid: string } {
    for (let seed = SEED; seed < SEED + 80; seed += 1) {
      let state = must(
        applyAction(
          driveSetup(
            seed,
            { p1: THERAPEUTIC_ENERGY_DECK, p2: THERAPEUTIC_ENERGY_DECK },
            { first: "p1" },
          ),
          { type: "endTurn", seat: "p1" },
        ),
      );
      state = setActiveFromDeck(state, "p2", "fix-statuser");
      state = setActiveFromDeck(state, "p1", "fix-bigbody");
      if (nextFace(state) !== "heads") continue;
      const swung = mustApply(state, { type: "attack", seat: "p2", index: 2 });
      let next = swung.state;
      if (next.players.p1.active?.conditions.rotation !== "paralyzed") continue;
      if (next.phase.kind !== "turn:action" || next.phase.seat !== "p1") continue;
      next = handFromDeck(next, "p1", "sv02-193", 1);
      return { state: next, uid: handUid(next, "p1", "sv02-193") };
    }
    throw new Error("no seed produced a paralyzed p1 Active on its own turn");
  }

  it("⚠️ RECOVERS a Paralysis the opponent applied LAST TURN — the printed use, end to end", () => {
    // No `setConditions` anywhere: the condition arrived by a real attack, survived
    // a real Checkup, and comes off because a real card was attached by a real
    // action. This is the board D172 said no legal sequence could reach.
    const { state, uid } = paralyzedThenMyTurn();
    expect(state.players.p1.active?.conditions.rotation).toBe("paralyzed");
    const done = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(done.state.players.p1.active?.conditions.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p1",
      statuses: ["paralyzed"],
      reason: "recovered",
    });
    // …and the ENERGY_ATTACHED row comes FIRST: the recovery is a consequence of the
    // attach, not a coincidence beside it.
    const order = types(done.events);
    expect(order.indexOf("ENERGY_ATTACHED")).toBeLessThan(order.indexOf("STATUS_CLEARED"));
  });

  it("⚠️ un-immobilises it, which is the whole point of the card", () => {
    // The behavioural consequence, not just the flag: a Paralyzed Pokémon cannot
    // attack (§12), and after the attach this one can. Asserted through the real
    // action rather than through `isImmobilized`.
    const { state, uid } = paralyzedThenMyTurn();
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(false);
    let next = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    }).state;
    next = setActiveFromDeck(next, "p1", "fix-statuser");
    expect(applyAction(next, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("recovers ASLEEP and CONFUSED the same way", () => {
    for (const rotation of ["asleep", "confused"] as const) {
      let state = myTurnWith();
      state = setConditions(state, "p2", { rotation });
      state = handFromDeck(state, "p2", "sv02-193", 1);
      const done = mustApply(state, {
        type: "attachEnergy",
        seat: "p2",
        uid: handUid(state, "p2", "sv02-193"),
        target: { spot: "active" },
      });
      expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
      expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
        statuses: [rotation],
        reason: "recovered",
      });
    }
  });

  it("⚠️ leaves BURN and POISON exactly where they were — the list is the list", () => {
    // The recovery is per-condition for the immunity's reason. A Burned, Poisoned,
    // Asleep body attached to this Energy wakes up and keeps burning and keeps
    // being poisoned, and the STATUS_CLEARED row names only what came off.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "asleep", burned: true, poisonDamage: 10, confusionDamage: 30 });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(done.state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      burned: true,
      poisonDamage: 10,
      confusionDamage: 30,
    });
    expect(find(done.events, "STATUS_CLEARED")?.statuses).toEqual(["asleep"]);
  });

  it("⚠️ an IMMUNITY WITHOUT a RECOVERY clause clears NOTHING — the two fields are two rules", () => {
    // THE WITNESS FOR THE SHAPE DECISION, and the case that kills the mutant an
    // author would most plausibly write: read `statusImmunities` in
    // `recoverStatuses` and save a field. It is behaviour-identical on the card that
    // prints both clauses — "those Special Conditions" makes the two lists equal —
    // so nothing on sv02-193 could ever tell the difference.
    //
    // Pachirisu can: it prints "This Pokémon can't be Paralyzed." and NOTHING about
    // recovering. Paralyzed by surgery and then handed a plain Basic Energy, the
    // recovery sweep runs over a body whose `statusImmunities` contains exactly the
    // condition it is carrying — and must leave it there, because no printed
    // sentence says otherwise.
    let state = myTurnWith("sv01-068");
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    expect(foldOf(state, "p2").statusImmunities).toEqual(["paralyzed"]);
    expect(foldOf(state, "p2").statusRecovery).toEqual([]);
    const done = attachFromHand(state, "fix-energy", ACTIVE);
    expect(done.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(types(done.events)).not.toContain("STATUS_CLEARED");
  });

  it("says NOTHING when there is nothing to recover — no row on a clean body", () => {
    // A recovery that announced itself on every attach would make the log unreadable
    // and would make "did anything happen" unanswerable.
    const state = myTurnWith();
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(types(done.events)).not.toContain("STATUS_CLEARED");
  });

  it("⚠️ a BASIC energy attached to the same Paralyzed body recovers NOTHING", () => {
    // The control that makes every case above about the CARD rather than about the
    // act of attaching.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    state = handFromDeck(state, "p2", "fix-energy", 1);
    const done = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "fix-energy"),
      target: { spot: "active" },
    });
    expect(done.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(types(done.events)).not.toContain("STATUS_CLEARED");
  });

  it("⚠️ does NOT bring the condition back when the Energy is discarded — it is a WRITE", () => {
    // The design decision, made checkable. A DERIVED view (`effectiveConditionsOf`,
    // subtracting the list at the read sites) would have been the engine's usual
    // idiom for a continuous effect and would be WRONG here: "recovers" is a one-way
    // change, so a body that recovered stays recovered. Driven by stripping the
    // Energy off the board after the recovery.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    state = handFromDeck(state, "p2", "sv02-193", 1);
    const after = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-193"),
      target: { spot: "active" },
    }).state;
    const active = after.players.p2.active;
    if (active === null) throw new Error("no Active");
    const stripped: GameState = {
      ...after,
      players: {
        ...after.players,
        p2: { ...after.players.p2, active: { ...active, energy: [] } },
      },
    };
    expect(foldOf(stripped, "p2").statusRecovery).toEqual([]);
    expect(foldOf(stripped, "p2").statusImmunities).toEqual([]);
    expect(stripped.players.p2.active?.conditions.rotation).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR NAMED MOMENTS — where the invariant is restored, and why those four.
// D174 shipped two and CLAIMED the other two were covered; D176 found they were
// not and wired them, so every route by which a recovery source can newly cover a
// body is a call site with a case underneath it.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the recovery's FOUR CALL SITES, all driven off printed cards", () => {
  it("MOMENT 1 — the §6.2 manual attach (turn.ts)", () => {
    // Driven exhaustively above; asserted here as the seam rather than the rule, so
    // a build that moved the call out of `attachEnergy` fails in a case that names
    // the site.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "confused" });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(find(done.events, "STATUS_CLEARED")?.reason).toBe("recovered");
  });

  it("⚠️ MOMENT 2 — the completion of any effect PROGRAM (flow.ts settleProgram)", () => {
    // Poppy (sv03-193, Supporter): "Move up to 2 Energy from 1 of your Pokémon to
    // another of your Pokémon" — `filter: anyEnergy`, the pool's ONLY program that
    // can move a SPECIAL Energy (every `attachEnergyFrom` route filters to
    // `energyType === "Normal"`). So the Energy arrives on a Paralyzed Active from
    // a BENCHED body, inside a parked program, and the recovery fires when the
    // program settles.
    //
    // This is why the invariant is restored at `settleProgram` and not at five
    // separate interpreter sites: `attachEnergyFrom`, `attachFromDeck`,
    // `attachFromTop` and `moveEnergy` all land there, and a sixth op would too.
    let state = myTurnWith();
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = attachBenchFromDeck(state, "p2", 0, "sv02-193", 1);
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    state = handFromDeck(state, "p2", "sv03-193", 1);
    const energyUid = state.players.p2.bench[0]?.energy[0];
    if (energyUid === undefined) throw new Error("no energy on the bench body");
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv03-193"),
    }).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const dest: PokemonRef = { seat: "p2", spot: { spot: "active" } };
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest }] },
    });
    expect(done.state.players.p2.active?.energy).toContain(energyUid);
    expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p2",
      statuses: ["paralyzed"],
      reason: "recovered",
    });
  });

  it("⚠️ MOMENT 3 — the §7.4 TOOL attach (cardplay.ts attachTool, D176)", () => {
    // D174 wrote "a Tool or an Ability printing the same clause would arrive for
    // free" and it was true of the READ and false of the MOMENT: `passivesOf` has
    // always folded every attached Tool's passive, but a Tool arrives through
    // `attachTool`, which writes `tools: [...]` and returns `ok` WITHOUT running a
    // program — so it reaches neither `settleProgram` nor turn.ts's §6.2 attach.
    // The §7.4 attach is the third route and now carries the call.
    //
    // ⚠️ THE TOOL IS EXP. SHARE PRECISELY BECAUSE IT HAS NO PASSIVE. Its printed
    // sentence is a `triggered` program (D171), so it contributes NOTHING to the
    // fold — which means the recovery this case sees can only have come from the
    // Energy already on the body, and the case therefore measures the MOMENT rather
    // than a second source. A Tool that printed `statusRecovery` itself would prove
    // the same line twice over and would need a registry row this catalog has no
    // reason to carry.
    expect(programFor("sv01-174")?.passive).toBeUndefined();
    let state = myTurnWith();
    state = attachFromDeck(state, "p2", "sv02-193", 1);
    // Surgery, and it has to be: the §6.2 attach above would have cleared the
    // condition on arrival, and the card's OTHER clause refuses it afterwards, so
    // "a recovery source on a body that still carries a named condition" is a board
    // no legal sequence can build (which is the invariant, stated from the inside).
    // It stands in for the printing this seam exists for — a Tool or an Ability
    // whose recovery clause arrives at a moment the Energy's never can.
    state = setConditions(state, "p2", { rotation: "confused" });
    state = handFromDeck(state, "p2", "sv01-174", 1);
    const done = mustApply(state, {
      type: "attachTool",
      seat: "p2",
      uid: handUid(state, "p2", "sv01-174"),
      target: ACTIVE,
    });
    expect(types(done.events)).toContain("TOOL_ATTACHED");
    expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p2",
      statuses: ["confused"],
      reason: "recovered",
    });
  });

  it("⚠️ MOMENT 4 — the completion of a betweenTurns program (triggers.ts, D176)", () => {
    // The ninth `runProgram` call site, and the ONE that does not fold through
    // `settleProgram`: `runCheckupTriggers` takes `.state` off the result inline,
    // deliberately, because a Checkup trigger may not park. D174's "every program
    // lands there" was true of the other eight and false of this one, so the same
    // moment is now named inside that loop.
    //
    // Garganacl's "Blessed Salt" is the vehicle — a real betweenTurns program, on
    // the BENCH (the Ability is not active-only), doing something the recovery does
    // not care about. What is being measured is that a program completing INSIDE the
    // Checkup restores the invariant, which is the property a future betweenTurns
    // ability that attaches an Energy would depend on.
    const build = (withTrigger: boolean): GameState => {
      let state = myTurnWith();
      state = clearBench(state, "p2");
      if (withTrigger) state = benchFromDeck(state, "p2", "sv02-123");
      state = attachFromDeck(state, "p2", "sv02-193", 1);
      return setConditions(state, "p2", { rotation: "confused" });
    };
    const done = mustApply(build(true), { type: "endTurn", seat: "p2" });
    expect(types(done.events)).toContain("ABILITY_TRIGGERED");
    expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p2",
      statuses: ["confused"],
      reason: "recovered",
    });
    // ⚠️ THE NON-VACUOUS CONTROL, and it is what makes this case about the TRIGGER
    // LOOP rather than about §13 in general. The same board with no betweenTurns
    // Ability in play runs the same Checkup and the Confusion SURVIVES it — §13
    // clears Sleep on a flip and Paralysis for the ended seat, and never touches
    // Confusion. So the clear above came from the program-completion seam and from
    // nowhere else in the phase.
    const control = mustApply(build(false), { type: "endTurn", seat: "p2" });
    expect(types(control.events)).not.toContain("ABILITY_TRIGGERED");
    expect(control.state.players.p2.active?.conditions.rotation).toBe("confused");
  });

  it("⚠️ runs AFTER Jet Energy's on-attach switch — and the ORDER IS UNOBSERVABLE, said not assumed", () => {
    // The ordering claim, and it is the slice's DELIBERATE MUTATION SURVIVOR: moving
    // `recoverStatuses` ahead of the §6.1 on-attach arm fails nothing, on any board
    // this catalog can build. That is D172's own survivor shape (an ORDERING, not a
    // guard) and it gets D159/D161/D163/D172's treatment rather than D154's — there
    // is no redundant test to delete, because the call is REQUIRED in both positions
    // and only its POSITION is free. So the unreachability is turned into an
    // ASSERTION instead of left in a comment:
    //
    //   • `switchIfBenched` fires ONLY on a BENCH attach — so the body that gained
    //     the Energy is never the Active the recovery sweep would have looked at
    //     beforehand. 🆕 D261 ADDED A SECOND ARM (`draw`, Enriching Energy
    //     `sv08-191`) AND THE ARGUMENT SURVIVES IT RATHER THAN BEING RE-STATED:
    //     that arm moves cards between the DECK and the HAND, and `recoverStatuses`
    //     reads `players[seat].active.conditions` and nothing else, so the two
    //     cannot observe each other on any board at all — a stronger reason than
    //     the switch's, not a weaker one. ⚠️ The union is enumerated below so a
    //     THIRD arm cannot land without this paragraph being re-read;
    //   • `switchInto` clears every condition on the OUTGOING Active itself
    //     (§11/§12), and the INCOMING body came off the bench, where conditions are
    //     always the zero value;
    //   • and NO CARD prints both an on-attach clause and a continuous recovery, so
    //     the one board on which the two could disagree does not exist.
    //
    // The position is still the meaningful one: a recovery reported BEFORE a switch
    // that was going to clear the condition anyway would be a second sentence about
    // one event, which is the reasoning `preventDamage`'s ordering got at D172.
    let state = myTurnWith();
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = setConditions(state, "p2", { rotation: "asleep" });
    state = handFromDeck(state, "p2", "sv02-190", 1);
    const done = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-190"),
      target: { spot: "bench", index: 0 },
    });
    expect(types(done.events)).toContain("POKEMON_SWITCHED");
    expect(findAll(done.events, "STATUS_CLEARED").map((e) => e.reason)).toEqual(["benched"]);
    // THE UNREACHABILITY, asserted over the pool: no card carries both clauses.
    const bothClauses = Object.keys(FIXTURE_POOL).filter((id) => {
      const energy = programFor(id)?.energy;
      return energy?.onAttach !== undefined && energy?.passive?.statusRecovery !== undefined;
    });
    expect(bothClauses).toEqual([]);
    // 🆕 D261 — AND THE ARM SET ITSELF, ENUMERATED, so the paragraph above cannot
    // silently expire the way its "the only on-attach arm is the bench switch"
    // sentence just did. A THIRD arm lands here as a red line, and whoever adds it
    // has to say why the ordering claim still holds. ⚠️ THE ENUMERATION IS OVER
    // FIXTURE_POOL, so it carries that view's named blind spot: a registry row with
    // no fixture is invisible to it, which is why the two REAL ids are pinned
    // beside it rather than trusted to appear.
    const onAttachArms = Object.keys(FIXTURE_POOL)
      .map((id) => programFor(id)?.energy?.onAttach?.kind)
      .filter((kind) => kind !== undefined);
    expect([...new Set(onAttachArms)].sort()).toEqual(["draw", "switchIfBenched"]);
    expect(programFor("sv02-190")?.energy?.onAttach).toEqual({ kind: "switchIfBenched" });
    expect(programFor("sv08-191")?.energy?.onAttach).toEqual({ kind: "draw", count: 4 });
    expect(programFor("sv02-193")?.energy?.onAttach).toBeUndefined();
  });

  it("⚠️ sweeps the ACTIVE only, and the bench premise is ASSERTED not assumed", () => {
    // `recoverStatuses` looks at `players[seat].active` and nothing else, and the
    // reason is a claim about the whole engine: `applyStatus` resolves only to an
    // Active, and every route off the Active Spot runs `noConditions()`. So a
    // benched body's conditions are the zero value on every reachable board, and a
    // bench arm would be a branch no test could witness (D154's rule). Measured on
    // a board built by real actions rather than trusted.
    const { state } = paralyzedThenMyTurnShared();
    for (const seat of ["p1", "p2"] as const) {
      for (const pokemon of state.players[seat].bench) {
        expect(pokemon.conditions).toEqual({ rotation: "none", poisonDamage: 0, burned: false, confusionDamage: 30 });
      }
    }
  });

  /** The legal paralysis board, shared with the recovery group above. */
  function paralyzedThenMyTurnShared(): { state: GameState } {
    for (let seed = SEED; seed < SEED + 80; seed += 1) {
      let state = must(
        applyAction(
          driveSetup(
            seed,
            { p1: THERAPEUTIC_ENERGY_DECK, p2: THERAPEUTIC_ENERGY_DECK },
            { first: "p1" },
          ),
          { type: "endTurn", seat: "p1" },
        ),
      );
      state = setActiveFromDeck(state, "p2", "fix-statuser");
      state = setActiveFromDeck(state, "p1", "fix-bigbody");
      if (nextFace(state) !== "heads") continue;
      const swung = mustApply(state, { type: "attack", seat: "p2", index: 2 });
      if (swung.state.players.p1.active?.conditions.rotation !== "paralyzed") continue;
      return { state: swung.state };
    }
    throw new Error("no seed produced a paralyzed p1 Active");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CHECKUP, RE-ANSWERED FROM SCRATCH — D172's finding, reopened.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ THE CHECKUP — D172's conclusion SURVIVES, its ARGUMENT NARROWS", () => {
  it("⚠️ makes D172's unreachability claim FALSE — the immunity CAN arrive second now", () => {
    // D172 concluded no Checkup gate was needed and gave TWO reasons:
    //   (a) `applyStatus` is the engine's only WRITER of a §12 condition, so gating
    //       the writer gates everything downstream — STILL TRUE, this slice adds no
    //       writer;
    //   (b) "no legal sequence puts an immunity onto a body that already carries the
    //       condition it refuses" — FALSE AS OF THIS SLICE. Attaching this Energy to
    //       a Paralyzed Active is exactly that sequence, and it is a printed play.
    // The finding is that (b) was load-bearing for the SHAPE of the argument and not
    // for the conclusion, so the conclusion holds on narrower ground.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    const before = foldOf(state, "p2");
    expect(before.statusImmunities).toEqual([]); // no immunity yet…
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    // …and now there is one, on a body that was carrying the condition first.
    expect(foldOf(done.state, "p2").statusImmunities).toEqual(NAMED);
  });

  it("⚠️ STILL needs no Checkup gate, because the RECOVERY closes the window", () => {
    // The re-answer. The window D172 proved unreachable is now reachable, but it
    // cannot SURVIVE: the only printing that can open it also prints "recovers from
    // being", so the condition is gone at the same moment the immunity arrives. A
    // body therefore still never reaches §13 carrying a condition it is immune to,
    // and a Checkup gate would still be a second reading of one rule with no board
    // that could make the two disagree.
    //
    // ⚠️ AND THE CONDITION UNDER WHICH THIS FALLS IS NAMED RATHER THAN LEFT: a
    // printing with a CONTINUOUS immunity and NO recovery clause — an Energy or a
    // Tool saying only "can't be Paralyzed" — would open the window and leave it
    // open, and THAT is when the Checkup owes a gate. The catalog has no such row
    // (all three immunity-without-recovery printings are Pokémon Abilities, which
    // arrive with the body and cannot be attached to one), and that is measured.
    for (const id of ["sv01-068", "sv01-099", "sv01-208"]) {
      expect(FIXTURE_POOL[id]?.category).toBe("Pokemon");
      expect(programFor(id)?.energy).toBeUndefined();
    }
    // Driven: attach, then end the turn through a full §13 — no tick, no flip, no
    // condition, and the Checkup sees a clean body because the attach cleaned it.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "asleep" });
    state = handFromDeck(state, "p2", "sv02-193", 1);
    let next = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-193"),
      target: { spot: "active" },
    }).state;
    const done = mustApply(next, { type: "endTurn", seat: "p2" });
    expect(findAll(done.events, "CHECKUP_COIN_FLIP")).toHaveLength(0);
    expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
    // The non-vacuous control: the same board WITHOUT the attach takes its wake-up
    // flip, so the case above is about the Energy and not about the seed.
    next = state;
    const control = mustApply(next, { type: "endTurn", seat: "p2" });
    expect(findAll(control.events, "CHECKUP_COIN_FLIP")).toHaveLength(1);
  });

  it("keeps `applyStatus` the ONLY writer — this slice adds a CLEAR, never a write", () => {
    // The half of D172's argument that survives untouched, re-asserted because this
    // slice is the first thing since to touch the §12 vocabulary at all. The new
    // mechanism only ever removes: there is no board on which `recoverStatuses` can
    // put a condition on anything.
    const state = myTurnWith();
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(types(done.events)).not.toContain("STATUS_APPLIED");
    expect(done.state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the row speaks the card's own verb", () => {
  it("renders the recovery as the printed word, with the subject resolved", () => {
    // "recovers from being Asleep, Confused, or Paralyzed" — so "recovered from
    // Paralysis" is the card's text with the tense and the subject filled in. It
    // SHARES the "benched" arm, which is deliberate: the same words for the same
    // event, discriminated by `reason` for a consumer that cares.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(logLines(done.state, done.events)).toContain("fix-bigbody recovered from Paralyzed");
  });

  it("is filed under the seat that OWNS the recovering Pokémon", () => {
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "asleep" });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(logRows(done.state, done.events).find((r) => r.text.includes("recovered"))?.who).toBe(
      "p2",
    );
  });

  it("keeps the REFUSAL's row distinct from the RECOVERY's — two clauses, two rows", () => {
    // The two halves of one printed sentence produce two different rows, which is
    // the shortest statement that they are two rules.
    const refused = swing(boardWithEnergy("hypnosis", "fix-bigbody"), "hypnosis");
    expect(logLines(refused.state, refused.events)).toContain("fix-bigbody can't be Asleep");
    expect(logLines(refused.state, refused.events).some((l) => l.includes("recovered"))).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural questions (D124 / D142 / D150 / D155 / D169).
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural questions", () => {
  it("PARK? NO. PERSIST? NO — MATCH_RECORD_VERSION stays 11, DERIVED", () => {
    // D124's test is DIRECTIONAL (D171): can the PREVIOUS deploy's RECORD hold the
    // shape the new code expects? Nothing this slice adds reaches `GameState`:
    // `EnergyProgram.passive` and both new fields live on the CATALOG (registry.ts
    // types), the aggregation is a pure function of the live board and is never
    // stamped, and `STATUS_CLEARED` rides `GameEvent`, which `MatchRecord` does not
    // store (it stores the RENDERED log). The `reason` union WIDENED, and a widened
    // union on an event type is safe in the direction that matters: an old record
    // holds no "recovered" rows because the old code emitted none.
    //
    // ⚠️ AND THE RECOVERY IS A WRITE TO AN EXISTING FIELD, NOT A NEW ONE.
    // `conditions` has held `rotation`/`poisonDamage`/`burned` since M1 and holds
    // exactly those three after this slice — asserted on the in-play object's own
    // keys, which is where a cached-flag dodge would have shown up (D155).
    const state = myTurnWith();
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    const active = done.state.players.p2.active;
    if (active === null) throw new Error("no Active");
    // 🆕🆕🆕 D501 — `confusionDamage` is the FIRST key added to `SpecialConditions`
    // since P3-M3; the rung is widened rather than relaxed, so it still reddens on a
    // sixth key. `MATCH_RECORD_VERSION` 29 -> 30.
    expect(Object.keys(active.conditions).sort()).toEqual([
      "burned",
      "confusionDamage",
      "poisonDamage",
      "rotation",
    ]);
    expect(Object.keys(active)).not.toContain("statusImmunities");
    expect(Object.keys(active)).not.toContain("statusRecovery");
  });

  it("GATES NO ACTION — the Energy pays costs and blocks nothing", () => {
    // D159's fifth question. The printed sentences never say "can't be used"; the
    // card's own first paragraph is a plain {C} provision, so it makes attacks
    // EASIER rather than harder, and nothing touches legality or the §4 rule.
    let state = board("hotBite", "fix-bigbody", { by: "p2" });
    state = attachFromDeck(state, "p2", "sv02-193", 1);
    const done = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(done.events, "ATTACK_DECLARED")).toBeDefined();
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20 });
  });

  it("§11: NOTHING OWED — this slice adds no op at all", () => {
    // D150's classification table is triggered by an op the DERIVER can produce.
    // Both clauses are passives read at existing sites; `applyStatus` is unchanged
    // as an op, and the recovery is a flow-level board fix rather than an op.
    const state = boardWithEnergy("hypnosis", "fix-bigbody");
    expect(state.players.p2.active?.attackBlock).toBeNull();
  });

  it("⚠️ the §11 BLOCK still speaks FIRST — the applyStatus early-return audit, re-run", () => {
    // D169's lesson, FIFTH sighting. `applyStatus`'s three early returns are
    // unchanged and so is their ownership: `active === null` and `uid === undefined`
    // belong to BOTH terms; `attackEffectRefused` belongs to the §11 ATTACK BLOCK
    // alone, and the §12 gate still sits behind it. What CHANGED is the reason the
    // pair is unreachable: D172 argued it from "neither immune PRINTING has an
    // attack that installs a block", and this slice's printing is an ENERGY with no
    // attacks at all — so the same conclusion now holds for a second, simpler reason
    // and the old assertion is extended rather than replaced.
    expect(FIXTURE_POOL["sv02-193"]?.attacks ?? []).toEqual([]);
    for (const id of ["sv01-068", "sv01-099", "sv01-208"] as const) {
      for (const attack of FIXTURE_POOL[id]?.attacks ?? []) {
        expect(attack.effect ?? "").not.toContain("prevent all damage");
      }
    }
  });

  it("MECHANISM DID NOT EXIST — the recovery is genuinely new, and that is measured", () => {
    // D159's fourth question, answered NO for the first time in a while. Everything
    // the immunity half needs pre-existed (D172 built it); the recovery half had no
    // precedent at all — no field cleared anything, and every clear in the engine
    // was a placement or a Checkup step. The witness is the `reason` vocabulary: the
    // five that existed are two placements and three Checkup steps, and "recovered"
    // is the sixth and the first that is neither.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "confused" });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    const cleared = find(done.events, "STATUS_CLEARED");
    expect(cleared?.reason).toBe("recovered");
    expect(["benched", "evolved", "wokeUp", "burnCured", "paralysisEnded"]).not.toContain(
      cleared?.reason,
    );
  });
});

describe("the boards stay legal", () => {
  it("keeps every uid in exactly one zone across an attach that recovers", () => {
    let state = myTurnWith();
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    state = handFromDeck(state, "p2", "sv02-193", 1);
    const before = state;
    const after = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-193"),
      target: { spot: "active" },
    }).state;
    for (const seat of ["p1", "p2"] as const) {
      const count = (s: GameState): number => {
        const side = s.players[seat];
        return (
          side.deck.length +
          side.hand.length +
          side.discard.length +
          side.prizes.length +
          (side.active === null ? 0 : side.active.stack.length + side.active.energy.length) +
          side.bench.reduce((n, p) => n + p.stack.length + p.energy.length, 0)
        );
      };
      expect(count(after)).toBe(count(before));
    }
  });
});
