import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { passivesOf, seatDamageReduction } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  ALWAYS_ON_REDUCTION_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 0.106.1 → 0.107.0 — the ALWAYS-ON POST-W/R DAMAGE REDUCTIONS (P3-M5 long tail,
// D161), the last two unread rows of §D147's twenty-printing "after applying
// Weakness and Resistance" group:
//
//   "The {F} Pokémon this card is attached to takes 30 less damage from attacks
//    from your opponent's Pokémon (after applying Weakness and Resistance)."
//                                          (Rock Chestplate sv01-192, a TOOL)
//   "All of your Pokémon take 10 less damage from attacks from your opponent's
//    Pokémon (after applying Weakness and Resistance)."
//                          (Hariyama sv02-113 "Arm Thrust Practice", an ABILITY)
//
// ⚠️ THE CENSUS WAS RE-RUN AGAINST THE RESTORED CATALOG AND THE COUNT DID NOT MOVE,
// WHICH IS ITSELF THE FINDING. Every 2026-08-03 census in this repo ran against the
// SHRUNKEN 890 / 5 catalog and D160 marked them all as floors — but §D147's census
// is dated 2026-08-02 and D156's own reconstruction uses it as PROOF that
// `swsh10.5` was present that day (it lists Pidove swsh10.5-061 as a query result).
// So this family's numbers were always measured against SIX sets, and re-running
// them against the restored 978 / 6 returns them unchanged: `less damage` over all
// three text columns is 31 rows, the "after applying Weakness and Resistance" half
// is 20, and `from attacks from your opponent's Pokémon` — the string that
// separates these two printings from the other eighteen — returns exactly these
// TWO rows in the whole catalog. A floor and a total can coincide; what makes the
// difference sayable is the DATE of the query, not its result.
//
// ⚠️ TWO POPULATIONS, SWEPT SEPARATELY (D156's rule). The local D1 is 978 rows /
// 6 sets (sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24, swsh10.5 88);
// `FIXTURE_POOL` is a different population that also fields synthetic `fix-*`
// bodies the catalog will never hold. The catalog returns the two rows above; the
// pool printed NEITHER sentence on any fixture and held NEITHER card before this
// slice.
//
// ⚠️ TWO MECHANISMS, NOT ONE FIELD WITH A GATE, AND THE READ SITES ARE THE GROUND
// (D155's rule; "they are both reductions" is not one). Both sentences subtract the
// same number at the same step of §8.5. What they do not share is WHOSE BODY the
// rule belongs to, and that decides four separate things:
//
//   |                     | Rock Chestplate            | Hariyama                 |
//   |---------------------|----------------------------|--------------------------|
//   | source of the rule  | the damaged body's own Tool | ANY Pokémon on its side |
//   | rides               | `passivesOf`               | a dedicated seat scan    |
//   | §9 Ability-lock     | CANNOT reach it (a TOOL)   | SUPPRESSES it            |
//   | Feint Attack        | NULLS it                   | nulls only the SELF part |
//
// A shared record would be paid by a consumer that refuses it (D155's test, and
// the ground is the same one D159 used on three axes at once): `passivesOf` folds
// the HOLDER's own catalog row and could never answer for a body it is not, and a
// §9 gate reaching an attached Tool would be false about a card that is not an
// Ability.
//
// ⚠️ AND THE `ignoreWR` ROW IS NEW IN KIND. Every earlier member of this family
// answers Feint Attack the same way at every SITE, because its source could never
// BE its target (D151's Entei is the opponent's Active; D159's Thundurus shields
// only the Bench it is not on). Hariyama's aura is SELF-INCLUSIVE, so its source
// set CONTAINS its target set and the answer is decided PER BOARD: a sniped
// Hariyama loses its own 10 and keeps a teammate's, off one declaration of one
// printed attack. That is the sharpest thing in the slice and it is driven against
// itself below.

/** The two printed sentences, byte-for-byte off the local D1 rows (2026-08-03,
    978 rows / 6 sets). */
const ROCK_CHESTPLATE =
  "The {F} Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).";
const ARM_THRUST_PRACTICE =
  "All of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).";

/** One seed for the whole suite: nothing in this family flips a coin, so a seed
    table would describe a shuffle rather than a rule (D143's move, D147's
    inheritance). Forretress is therefore only ever declared at INDEX 1 — its
    index-0 "Continuous Spin" is an until-tails multiply. */
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
const ATTACKERS = {
  "fix-attacker": {
    card: "fix-attacker",
    index: 1,
    energy: [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // FIRE "Flame" (60)
  "fix-attacker-bite": { card: "fix-attacker", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // the same body's idx-0 "Bite" (30)
  "fix-sniper": { card: "fix-sniper", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Spread Shot" (30 + 20 each benched)
  "sv01-069": { card: "sv01-069", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // Rotom — "Linear Attack" (opponentAny 20, deals)
  "fix-feint": { card: "fix-feint", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Feint Attack" (opponentAny 50, ignoreWR)
  "sv02-127": { card: "sv02-127", index: 0, energy: [{ id: "fix-fighting-energy", count: 3 }] }, // Ting-Lu ex — "Land Scoop" (150) + Cursed Land
  "sv01-139": {
    card: "sv01-139",
    index: 1,
    energy: [
      { id: "fix-metal-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
  }, // Forretress — "Rolling Shell" (90, installs 50)
} as const;

type Attacker = keyof typeof ATTACKERS;

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both bodies are placed by surgery and BOTH benches are cleared,
    because every clause in this family is read off the CURRENT board at damage time
    and a stray displaced body would be a silent extra aura target. */
function board(attacker: Attacker, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: ALWAYS_ON_REDUCTION_DECK, p2: ALWAYS_ON_REDUCTION_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKERS[attacker].card);
  state = clearBench(state, by);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

/** The seat's benched body carrying `cardId` (found by card id, not by slot — a
    board built by successive surgeries does not put it at index 0). */
function benchedIndex(state: GameState, seat: Seat, cardId: string): number {
  const at = state.players[seat].bench.findIndex(
    (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === cardId,
  );
  if (at < 0) throw new Error(`${seat} has no benched ${cardId}`);
  return at;
}

function rowFor(events: GameEvent[], uid: string | undefined) {
  return findAll(events, "DAMAGE_DEALT").find((e) => e.uid === uid);
}

/** Answer a parked `opponentAny` snipe by naming one of P2's spots — the one move
    that lets a single printed declaration hit a source and a non-source. */
function aimAt(parked: GameState, spot: { spot: "active" } | { spot: "bench"; index: number }) {
  if (parked.phase.kind !== "effect:choose") throw new Error("the snipe did not park");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const pick = prompt.candidates.find(
    (ref) =>
      ref.seat === "p2" &&
      ref.spot.spot === spot.spot &&
      (spot.spot === "active" || (ref.spot.spot === "bench" && ref.spot.index === spot.index)),
  );
  if (pick === undefined) throw new Error("no such candidate");
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [pick] },
  });
}

/** A live DURATED reduction written straight onto a body (D147's `withReduction`,
    re-declared here so this suite's boards stay its own). Used for the ONE claim no
    printed board can reach — all THREE sources of the number live at once. */
function withInstalledReduction(state: GameState, seat: Seat, amount: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, damageReduction: { turn: state.turn, amount } } },
    },
  };
}

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The data: the catalog rows, the fixtures, and the registry rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — re-queried, not inherited", () => {
  it("carries every NAME, printed Ability and printed attack verbatim", () => {
    // ⚠️ D146's rule at its sharpest: verify by QUERY, never by recognition. Both
    // ids re-queried per printing against the RESTORED catalog, and both are cards
    // this repo had never fielded — sv02-113 really is Hariyama, a FIGHTING Stage 1
    // from Makuhita, and sv01-192 really is Rock Chestplate, `trainer_type = Tool`.
    expect(FIXTURE_POOL["sv02-113"]).toMatchObject({
      name: "Hariyama",
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Makuhita",
      hp: 140,
      types: ["Fighting"],
      retreat: 3,
      weaknesses: [{ type: "Psychic", value: "×2" }],
    });
    expect(FIXTURE_POOL["sv02-113"]?.abilities).toEqual([
      { type: "Ability", name: "Arm Thrust Practice", effect: ARM_THRUST_PRACTICE },
    ]);
    // The whole printed attack list, so the fixture cannot be wrong by OMISSION
    // (D156's failure mode) and so no later slice indexes into a short list.
    expect(FIXTURE_POOL["sv02-113"]?.attacks).toEqual([
      { cost: ["Fighting", "Colorless", "Colorless"], name: "Rocket Slap", damage: 120 },
    ]);
    expect(FIXTURE_POOL["sv01-192"]).toMatchObject({
      category: "Trainer",
      trainerType: "Tool",
      effect: ROCK_CHESTPLATE,
    });
  });

  it("AUTHORS both printings on TWO programs, and neither is an attack", () => {
    expect(programFor("sv01-192")?.passive).toEqual({
      damageReductionAfterWRIfType: { amount: 30, type: "Fighting" },
    });
    expect(programFor("sv02-113")?.passive).toEqual({
      // 🆕 D321 — a RECORD rather than a bare number: the field gained four
      // riders with Stone Palace / Curly Wall and Hariyama prints none of them,
      // so the unmarked print is now `{ amount }` alone.
      seatDamageReductionAfterWR: { amount: 10 },
    });
    // Nothing here reaches the deriver: one sentence is a Tool's, the other an
    // Ability's, and neither card has an authored attack program.
    for (const id of ["sv01-192", "sv02-113"] as const) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
  });

  it("…and BOTH sentences STAY LOUD as attack text", () => {
    // An always-on aura derived into a one-shot op would install a one-turn stamp
    // onto whoever declared the attack. D147/D151/D159's re-pointed witness,
    // widened to the last two sentences of the group.
    for (const text of [ROCK_CHESTPLATE, ARM_THRUST_PRACTICE]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // The DURATED cousin — the same words minus the "from your opponent's Pokémon"
    // clause and plus a duration prefix — still derives, so the family's taxonomy
    // is unchanged by the always-on half landing and neither sentence reaches the
    // other's reader.
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "reduceDamage", amount: 30 }]);
  });

  it("is the WHOLE mapped set — the census, SWEPT out of the pool rather than listed", () => {
    // D145's move (D147/D159's inheritance): discover the producers from the
    // registry so a third row added without a case fails HERE.
    //
    // ⚠️ WHAT THIS SWEEP DOES NOT TRAVERSE, said rather than left: it enumerates
    // `FIXTURE_POOL`, so a registry row for a card with NO fixture is invisible to
    // it — D149's blind spot, named again because it is still open.
    const typed = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.damageReductionAfterWRIfType !== undefined,
    );
    expect(typed).toEqual(["sv01-192"]);
    const seatWide = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.seatDamageReductionAfterWR !== undefined,
    );
    expect(seatWide).toEqual(["sv02-113"]);
    // ⚠️ AND THE OTHER SIXTEEN ROWS OF §D147's "AFTER W/R" GROUP ARE ASSERTED
    // BESIDE THEM, because the claim this slice closes is about the GROUP: four
    // always-on Ability printings (built since 0.x) plus fourteen durated attack
    // printings (D147) plus these two is twenty, which is what the census returns.
    const ungated = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.damageReductionAfterWR !== undefined,
    );
    // ⚠️ D192 — PARTITIONED RATHER THAN EXTENDED, because this census's claim is
    // about PRINTINGS and two of the rows it now returns are SYNTHETIC.
    // `fix-suppresswall` and `fix-resistwall` carry Copperajah's −30 on bodies
    // that ALSO carry a Weakness / a Resistance — a combination no card in the
    // pool prints, and the reason they had to be invented (damageSuppression.test.ts
    // argues it). Splitting keeps the real-card arithmetic above exact while
    // leaving the sweep live: a FOURTH real row, or a THIRD fixture row, still
    // fails here.
    expect(ungated.filter((id) => !id.startsWith("fix-")).sort()).toEqual([
      "sv01-121",
      "sv02-150",
      "sv03-174",
    ]);
    // ⚠️ D240 ADDS A THIRD, AND IT SHARES THE VERY SAME PROGRAM OBJECT. The
    // damage-CAP suite needs one body on which "post-Weakness" and
    // "post-REDUCTION" give different answers, and `FIX_SUPPRESS_WALL`'s −30 is
    // exactly the number that makes Slam's 70 land on a 40 cap. The program is
    // shared rather than re-declared: a second literal 30 would be a second chance
    // to disagree with the reading.
    expect(ungated.filter((id) => id.startsWith("fix-")).sort()).toEqual([
      "fix-carapace-tough",
      "fix-resistwall",
      "fix-suppresswall",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mechanism 1 — Rock Chestplate: the gate names the HOLDER, so `passivesOf`
// resolves it and the four read sites take a ZERO diff.
// ─────────────────────────────────────────────────────────────────────────────

describe("Rock Chestplate — the HOLDER's type gate, folded inside passivesOf", () => {
  it("⚠️ pays into `damageReductionAfterWR` ITSELF, which is why no read site moved", () => {
    // The whole shape of this half of the slice: the number does not arrive at the
    // sites through a new channel, it arrives inside the field they have summed
    // since 0.x. D131's one-reading-one-implementation, read across the
    // catalog/gate boundary rather than the catalog/state one.
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(30);
  });

  it("READS THE HOLDER's types and not the ATTACKER's — the ends are NOT swapped", () => {
    // ⚠️ THE INHERITED NOTE SAID THIS WAS "`preventsAttackerType` WITH THE ENDS
    // SWAPPED". The DATUM is the same (`Card.types`); the PLACEMENT is not. D159's
    // gate names the ATTACKER, a body `passivesOf` does not have, so it had to be
    // resolved at the read sites. This one names the body being folded. Driven by
    // the one board that separates the two readings: a FIRE attacker into a
    // FIGHTING holder. If the gate read the attacker, {F} would miss and the
    // reduction would vanish.
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const { events } = swing(state, "fix-attacker");
    // Flame 60, no Weakness (Hariyama is ×2 Psychic), 30 from the Tool + 10 from
    // Hariyama's own seat-wide aura.
    expect(find(events, "DAMAGE_DEALT")?.reduction).toBe(40);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("MISSES a holder of another type — on a PRINTED card, not a synthetic one", () => {
    // Forretress is METAL. The identical Tool on the identical site pays nothing,
    // and the only surviving reduction is the benched Hariyama's seat-wide 10.
    let state = board("fix-attacker", "sv01-139");
    state = benchFromDeck(state, "p2", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(0);
    const { events } = swing(state, "fix-attacker");
    // 60 × 2 (Forretress is ×2 Fire) − 10 = 110.
    expect(find(events, "DAMAGE_DEALT")?.reduction).toBe(10);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(110);
  });

  it("SUMS over sources rather than taking the last — two Tools on one holder", () => {
    // The shape decision this field makes, and the reason it is a SCALAR where
    // D159's type gate had to COLLECT: two sources contributing two AMOUNTS fold to
    // their sum with nothing lost. §7.4's one-Tool cap is deliberately not enforced
    // by the surgery (Revavroom ex's "Tune-Up" raises it in the real game).
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(60);
  });

  it("is LIVE-READ off the TOP card — the gate is not resolved once at attach", () => {
    // `basicHpBonus`'s documented behaviour on the other axis of the same printed
    // idiom: evolving the holder can end a Tool's effect with the Tool still
    // attached. Driven here by moving the Tool between two bodies of different
    // types on one state rather than by an evolution the pool cannot print (no
    // {F} → non-{F} line exists in the catalog).
    let state = board("fix-attacker", "sv02-113");
    state = benchFromDeck(state, "p2", "sv01-139");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    state = attachToolFromDeck(state, "p2", benchedIndex(state, "p2", "sv01-139"), "sv01-192");
    const active = state.players.p2.active;
    const benched = state.players.p2.bench[benchedIndex(state, "p2", "sv01-139")];
    if (active === null || benched === undefined) throw new Error("board not built");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(30);
    expect(passivesOf(state, benched).damageReductionAfterWR).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mechanism 2 — Hariyama: the seat-wide scan.
// ─────────────────────────────────────────────────────────────────────────────

describe("seatDamageReduction — the aura-scan family's NINTH member", () => {
  it("has NO source clause and NO target clause — the printed sentence scopes neither", () => {
    // ⚠️ THE INHERITED NOTE SAID THIS WAS "`benchShieldedByActive` WITH THE BENCH
    // CLAUSE DROPPED". Dropping only the target clause would leave an ACTIVE-only
    // source, and Hariyama's sentence has no "As long as this Pokémon is in the
    // Active Spot" either. What is left once both go is `hasFreeRetreatAura`'s
    // shape. Both halves driven: a BENCHED Hariyama shields the Active, and an
    // ACTIVE Hariyama shields the Bench.
    let state = board("fix-attacker", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all")).toBe(10);

    let other = board("fix-attacker", "sv02-113");
    other = benchFromDeck(other, "p2", "fix-bigbody");
    const benched = other.players.p2.bench[benchedIndex(other, "p2", "fix-bigbody")];
    if (benched === undefined) throw new Error("no benched body");
    expect(seatDamageReduction(other, benched, "all")).toBe(10);
  });

  it("is SELF-INCLUSIVE — the source shields itself", () => {
    // "ALL of your Pokémon" includes the one printing the Ability. Contrast
    // `benchShieldedFromDamage`, whose target clause makes its source immune to its
    // own shield.
    const state = board("fix-attacker", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all")).toBe(10);
  });

  it("SUMS over sources — `opposingRetreatSurcharge`'s answer, not `opposingAttackDebuff`'s", () => {
    // Two Hariyama in play are two printed effects, and a deck may run four. D151
    // refused the loop because ITS source clause named one spot; this one names a
    // whole side, so a first-match scan would silently drop the second.
    let state = board("fix-attacker", "sv02-113");
    state = benchFromDeck(state, "p2", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all")).toBe(20);
    const { events } = swing(state, "fix-attacker");
    expect(find(events, "DAMAGE_DEALT")?.reduction).toBe(20);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });

  it("is OWN-SIDE ONLY — no aura reaches across the table", () => {
    // The seat is DERIVED from the body's own uid, so a Hariyama on the ATTACKING
    // side does nothing for the defender. Dropping the `continue` that skips the
    // wrong side would make this board read 10.
    let state = board("fix-attacker", "fix-bigbody");
    state = benchFromDeck(state, "p1", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all")).toBe(0);
    expect(find(swing(state, "fix-attacker").events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });

  it("⚠️ …and the OWN-SIDE early return is UNREACHABLE-as-a-difference, asserted not assumed", () => {
    // Mutating `return taken` to `if (taken > 0) return taken` — i.e. letting the
    // scan fall through to the OTHER side when this one yields nothing — survives
    // every board, and the reason is structural rather than a gap in effort: a top
    // uid is in exactly ONE zone of ONE side, so the `holders.some(...)` clause
    // above has already picked the only seat that could match and the second
    // iteration cannot get past it. The early return is kept — it is the honest
    // expression of "no other side can shield it", and `hasFreeRetreatAura` carries
    // the identical line for the identical reason — with the unreachability turned
    // into an ASSERTION here rather than left as a comment (D159's move on its two
    // deliberate survivors). Driven on a board where BOTH sides hold a source, the
    // shape a "sum both sides" bug would need.
    let state = board("fix-attacker", "sv02-113");
    state = benchFromDeck(state, "p1", "sv02-113");
    state = benchFromDeck(state, "p1", "sv02-113");
    const uids = new Set<string>();
    for (const seat of ["p1", "p2"] as const) {
      const side = state.players[seat];
      for (const p of side.active === null ? side.bench : [side.active, ...side.bench]) {
        const uid = p.stack.at(-1);
        if (uid === undefined) throw new Error("empty stack");
        expect(uids.has(uid)).toBe(false); // no uid is on two sides — the whole argument
        uids.add(uid);
      }
    }
    const defender = state.players.p2.active;
    const attacker = state.players.p1.active;
    if (defender === null || attacker === null) throw new Error("board not built");
    // p2 has ONE source (itself); p1 has TWO. Neither total leaks across.
    expect(seatDamageReduction(state, defender, "all")).toBe(10);
    expect(seatDamageReduction(state, attacker, "all")).toBe(20);
  });

  it("is LIVE-READ — nothing is stamped, so losing the source ends it immediately", () => {
    // Every read site passes the CURRENT state and this scan is pure, which is the
    // whole of the PARK/PERSIST answer: no key on `InPlayPokemon`, so
    // `MATCH_RECORD_VERSION` does not move. Removing the benched source from the
    // same state ends the aura with no clear site anywhere.
    let state = board("fix-attacker", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(seatDamageReduction(state, active, "all")).toBe(10);
    const stripped = clearBench(state, "p2");
    const strippedActive = stripped.players.p2.active;
    if (strippedActive === null) throw new Error("no Active");
    expect(seatDamageReduction(stripped, strippedActive, "all")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The four §8.5 read sites — one printed attacker each.
// ─────────────────────────────────────────────────────────────────────────────

describe("the four damage sites — each driven by its own printed attack", () => {
  it("attack.ts's MAIN HIT", () => {
    const state = board("fix-attacker", "sv02-113");
    const { events } = swing(state, "fix-attacker");
    expect(find(events, "DAMAGE_DEALT")?.reduction).toBe(10);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });

  it("⚠️ spreadDamage — the BENCH, reachable off a printed card for the FIRST time", () => {
    // D147's installed half can only ever be live on an ACTIVE (installing needs an
    // attack and leaving the spot clears it), so this site and `placeSnipe`'s bench
    // arm have carried the reduction term unreachably since 0.96.0 and are guarded
    // there only "for the reason `attackDamageBlocked` is consulted". "All of your
    // Pokémon" carries no zone clause, so the guard becomes a live rule.
    let state = board("fix-sniper", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    state = benchFromDeck(state, "p2", "fix-titan");
    const { events } = swing(state, "fix-sniper");
    const rows = findAll(events, "DAMAGE_DEALT");
    // 30 to the Active − 10; 20 to each benched − 10, INCLUDING the source itself.
    expect(rows.map((r) => r.dealt)).toEqual([20, 10, 10]);
    for (const r of rows) expect(r.reduction).toBe(10);
  });

  it("snipeActive AND placeSnipe — one `opponentAny` declaration, aimed two ways", () => {
    // A lone opposing Pokémon makes `opponentAny` a forced pick rather than a park,
    // which is the cheapest way to reach `snipeActive` with no prompt in the way.
    const alone = board("sv01-069", "sv02-113");
    const { events } = swing(alone, "sv01-069");
    expect(find(events, "DAMAGE_DEALT")?.reduction).toBe(10);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    // …and the same declaration aimed at the BENCH is `placeSnipe`'s damage arm.
    let state = board("sv01-069", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    const at = benchedIndex(state, "p2", "sv02-113");
    const uid = benchTopUid(state, "p2", at);
    const done = aimAt(swing(state, "sv01-069").state, { spot: "bench", index: at });
    expect(rowFor(done.events, uid)?.reduction).toBe(10);
    expect(rowFor(done.events, uid)?.dealt).toBe(10);
  });

  it("⚠️ ALL THREE SOURCES sum into ONE number — the claim no printed board can make", () => {
    // Catalog-gated (Rock Chestplate 30) + installed (D147's stamp 50) + seat-wide
    // (Hariyama 10) = 90, reported as ONE `reduction`. No printing can reach this
    // board: the installed half needs an attack, and no {F} body in the catalog
    // prints one — so it is driven with a constructed record, D146/D147's precedent
    // for pinning a rule no card can reach.
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    state = withInstalledReduction(state, "p2", 50);
    const { events } = swing(state, "fix-attacker");
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.reduction).toBe(90);
    expect(row?.dealt).toBe(0);
    // ⚠️ AND A CLAMPED ZERO IS NOT A PREVENTION — D147's rule, inherited unchanged
    // by summing into the number it guarded. The same 0 is two different facts.
    expect(row?.prevented).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The §8.5 ORDERING — the printed parenthetical, driven both ways.
// ─────────────────────────────────────────────────────────────────────────────

/** D147's oracle: re-derive the row from its OWN reported fields, in the printed
    order and in the reversed one, through the engine's own `applyDamageModifier`
    so a bug there cannot hide behind a matching bug here. */
function pipeline(
  row: {
    base: number;
    weakness: DamageModifier | null;
    resistance: DamageModifier | null;
    reduction?: number;
  },
  order: "printed" | "reversed",
): number {
  const reduction = row.reduction ?? 0;
  if (order === "printed") {
    const afterWR = applyDamageModifier(
      applyDamageModifier(row.base, row.weakness),
      row.resistance,
    );
    return Math.max(0, Math.max(0, afterWR) - reduction);
  }
  const reduced = Math.max(0, row.base - reduction);
  return Math.max(
    0,
    applyDamageModifier(applyDamageModifier(reduced, row.weakness), row.resistance),
  );
}

describe("the printed parenthetical — `after applying Weakness and Resistance`", () => {
  it("⚠️ the two new sources sit at D147's STEP, and a Weakness makes it observable", () => {
    // Forretress is ×2 Fire. Flame 60 into it with a benched Hariyama:
    // printed  → 60 × 2 − 10 = 110
    // reversed → (60 − 10) × 2 = 100
    // The order question this slice owes is exactly the one D147 answered, and the
    // new sources inherit the answer by being SUMMED into the same number rather
    // than applied at a step of their own — which is what makes the diff a `+`.
    let state = board("fix-attacker", "sv01-139");
    state = benchFromDeck(state, "p2", "sv02-113");
    const row = find(swing(state, "fix-attacker").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    expect(row.dealt).toBe(110);
    expect(pipeline(row, "printed")).toBe(row.dealt);
    expect(pipeline(row, "reversed")).toBe(100);
    expect(pipeline(row, "reversed")).not.toBe(row.dealt);
  });

  it("…and the Tool's 30 answers the same way, on the same body", () => {
    // Rock Chestplate on an {F} Active. Hariyama is ×2 Psychic, so the observable
    // board needs a Weakness the pool prints against it: fix-attacker is FIRE, so
    // the two boards are separated by the DEFENDER rather than by the attacker.
    // 60 flat − (30 + 10) = 20 with no multiplicative step, and the reduction is
    // then re-derived against a constructed Weakness to show the placement.
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const row = find(swing(state, "fix-attacker").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    expect(row.weakness).toBeNull();
    expect(row.dealt).toBe(20);
    // Resistance and the reduction are both ADDITIVE and COMMUTE, so the
    // parenthetical can only ever bite on the MULTIPLICATIVE step — pinned as
    // arithmetic rather than posed as a board (D147's last census row).
    expect(
      pipeline({ ...row, weakness: null, resistance: { op: "subtract", amount: 30 } }, "printed"),
    ).toBe(
      pipeline({ ...row, weakness: null, resistance: { op: "subtract", amount: 30 } }, "reversed"),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feint Attack — the per-BOARD `ignoreWR` split, the slice's sharpest reading.
// ─────────────────────────────────────────────────────────────────────────────

describe("`ignoreWR` — decided PER BOARD, because the source set contains the target set", () => {
  it("⚠️ NULLS the target's OWN 10 and leaves a TEAMMATE's, off ONE declaration", () => {
    // One board, one printed attack, two picks. `fix-feint` is `opponentAny`, so a
    // benched Hariyama and a benched non-source are both legal targets of the same
    // declaration — which is what makes this an asymmetry rather than two boards.
    let state = board("fix-feint", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    state = benchFromDeck(state, "p2", "fix-titan");
    const hariyama = benchedIndex(state, "p2", "sv02-113");
    const titan = benchedIndex(state, "p2", "fix-titan");
    const hariyamaUid = benchTopUid(state, "p2", hariyama);
    const titanUid = benchTopUid(state, "p2", titan);

    const parked = swing(state, "fix-feint").state;
    const atSelf = aimAt(parked, { spot: "bench", index: hariyama });
    // The aura's only source IS the pick, so "any effects on that Pokémon" reaches
    // all of it: no reduction at all.
    expect(rowFor(atSelf.events, hariyamaUid)?.reduction).toBeUndefined();
    expect(rowFor(atSelf.events, hariyamaUid)?.dealt).toBe(50);

    const atTeammate = aimAt(parked, { spot: "bench", index: titan });
    // The source is a DIFFERENT body, so the clause does not reach it and the 10
    // stands — D151's `placeSnipe` reading, on the same state as the line above.
    expect(rowFor(atTeammate.events, titanUid)?.reduction).toBe(10);
    expect(rowFor(atTeammate.events, titanUid)?.dealt).toBe(40);
  });

  it("…and a NO-`ignoreWR` control on the same body proves the aura was live", () => {
    // Without the control, the first case above passes just as well if the aura had
    // never been live on Hariyama at all (D151/D159's rule). Rotom's "Linear Attack"
    // is the same `opponentAny` shape without the clause.
    let state = board("sv01-069", "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113");
    const hariyama = benchedIndex(state, "p2", "sv02-113");
    const uid = benchTopUid(state, "p2", hariyama);
    const done = aimAt(swing(state, "sv01-069").state, { spot: "bench", index: hariyama });
    expect(rowFor(done.events, uid)?.reduction).toBe(10);
    expect(rowFor(done.events, uid)?.dealt).toBe(10);
  });

  it("⚠️ at snipeActive too — a sniped Hariyama keeps a BENCHED Hariyama's 10", () => {
    // The same reading at the other arm, and the case that shows the answer is
    // "the target's own contribution" rather than "the whole aura": the Active
    // Hariyama loses its own 10 and the benched one's still lands.
    let state = board("fix-feint", "sv02-113");
    state = benchFromDeck(state, "p2", "sv02-113");
    const done = aimAt(swing(state, "fix-feint").state, { spot: "active" });
    const row = rowFor(done.events, activeUid(state, "p2"));
    expect(row?.reduction).toBe(10);
    expect(row?.dealt).toBe(40);
  });

  it("NULLS Rock Chestplate outright — a Tool IS an effect on that Pokémon", () => {
    // The holder-side half needs no new answer: it rides `passivesOf`, which
    // `ignoreWR` has nulled since 0.x. The contrast with the line above is the whole
    // of the two mechanisms' fourth axis.
    let state = board("fix-feint", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    state = benchFromDeck(state, "p2", "fix-titan"); // a second candidate, so the pick PARKS
    const done = aimAt(swing(state, "fix-feint").state, { spot: "active" });
    expect(rowFor(done.events, activeUid(state, "p2"))?.reduction).toBeUndefined();
    expect(rowFor(done.events, activeUid(state, "p2"))?.dealt).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the Ability-lock reaches ONE of the two mechanisms, on ONE board.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the lock silences the ABILITY and cannot reach the TOOL", () => {
  it("⚠️ ONE board, ONE field flipped: a damaged Hariyama keeps its Tool and loses its aura", () => {
    // Ting-Lu ex "Cursed Land" is the only lock in the registry that can be live
    // beside these auras: every lock is Active-gated on its SOURCE, so the locking
    // body has to be the attacking one too, and its target predicate ("your
    // opponent's Pokémon in play that have any damage counters on them, except for
    // Pokémon ex") reaches a Stage 1 where Klefki/Spiritomb reach Basics only.
    //
    // Land Scoop is 150 and Hariyama is 140 HP, so the board carries 10 damage —
    // which is ALSO the switch that arms the lock. One state, one field.
    let base = board("sv02-127", "sv02-113");
    base = attachToolFromDeck(base, "p2", "active", "sv01-192");

    const unlocked = swing(base, "sv02-127");
    // Tool 30 + own aura 10 = 40 → 110 dealt.
    expect(find(unlocked.events, "DAMAGE_DEALT")?.reduction).toBe(40);
    expect(find(unlocked.events, "DAMAGE_DEALT")?.dealt).toBe(110);

    const locked = swing(setDamage(base, "p2", 10), "sv02-127");
    // The Ability is silenced; the Tool is not an Ability and keeps paying.
    expect(find(locked.events, "DAMAGE_DEALT")?.reduction).toBe(30);
    expect(find(locked.events, "DAMAGE_DEALT")?.dealt).toBe(120);
  });

  it("locks a BENCHED source too — the aura's reachability follows the SOURCE", () => {
    // Cursed Land says "your opponent's Pokémon in play", with no zone clause on
    // the target of the lock, so a benched Hariyama with damage on it stops
    // shielding the whole side. D113's rule, applied to the ninth scan.
    let state = board("sv02-127", "fix-titan");
    state = benchFromDeck(state, "p2", "sv02-113");
    const at = benchedIndex(state, "p2", "sv02-113");
    expect(find(swing(state, "sv02-127").events, "DAMAGE_DEALT")?.dealt).toBe(140);
    const damaged = setBenchDamage(state, "p2", at, 10);
    expect(find(swing(damaged, "sv02-127").events, "DAMAGE_DEALT")?.dealt).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE, and the §11 / action-gate answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the log row — rendered under BOTH seats and READ", () => {
  it("⚠️ NO ROW MOVED: the number lands in the existing `DAMAGE_DEALT.reduction`", () => {
    // D155's invariant — the row carries one number per STEP AND DIRECTION, never
    // one per card. `reduction` has summed catalog + installed since D147 and now
    // sums a third source; a field of its own would have been the first split by
    // SOURCE in this family's history. An always-on reduction that FIRES emits no
    // event of its own either, which is Bouffalant's rule verbatim (D140/D146:
    // loudness is owed to UNREAD text, and this text is now read).
    let state = board("fix-attacker", "sv02-113");
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const { state: after, events } = swing(state, "fix-attacker");
    expect(events.some((e) => e.type === "DAMAGE_REDUCTION_APPLIED")).toBe(false);
    const rows = rendered(after, events);
    // The row is filed under the DEFENDER's seat and RENDERS under the ATTACKER's
    // (D136's finding 1 / D159's note), so the crumb has to be true read from the
    // attacker's chair — "reduced 40" is a fact about the damage, not a claim about
    // whose card did it. Read, not inferred.
    const hit = rows.find((r) => r.text.includes("· reduced 40"));
    expect(hit?.who).toBe("p1");
    expect(hit?.text).toBe("dealt 20 damage to Hariyama · reduced 40");
    expect(rows.filter((r) => r.text.includes("reduced"))).toHaveLength(1);
  });

  it("…and reads identically when the OTHER seat is shielded", () => {
    // The same sentence under the other name: nothing in the crumb is seat-relative,
    // which is the whole reason no new arm was needed. Rendered and read rather than
    // inferred (D157's fourth voice rule).
    let state = board("fix-attacker", "sv02-113", "p2");
    state = attachToolFromDeck(state, "p1", "active", "sv01-192");
    const { state: after, events } = swing(state, "fix-attacker", "p2");
    const hit = rendered(after, events).find((r) => r.text.includes("· reduced 40"));
    expect(hit?.who).toBe("p2");
    expect(hit?.text).toBe("dealt 20 damage to Hariyama · reduced 40");
  });
});

describe("the structural answers", () => {
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 10", () => {
    // Both fields live on the CATALOG (`registry.ts` `PassiveEffects`) and both
    // readers are pure functions of the current state. The dodges were priced and
    // REFUSED (D155's rule): a "shielded" number cached on `InPlayPokemon` would go
    // stale on a Boss's Orders, a retreat, a promotion or a KO of the source, and
    // would have bought a version bump for nothing. Pinned as an ABSENCE, which is
    // the only way a no-bump claim can be checked.
    const state = board("fix-attacker", "sv02-113");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active).sort()).toEqual(
      [
        "attackBlock",
        "attackDamageDebuff",
        "attackLockedTurn",
        "boostedAttack",
        "conditions",
        "damage",
        "damageReduction",
        "energy",
        // 🆕🆕 D386 — `healedTurn` JOINS THE LIST (a second per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 22 → 23 with it). THIS slice still wrote
        // nothing: the pin is on the HEAD's key set, so it moves whenever anybody adds a
        // key, and what it asserts is that none of them was added HERE.
        "evolvedTurn",
        "healedTurn",
        "installedRecoil",
        "lockedAttacks",
        "markers",
        // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        // 🆕🆕 D412 — the SELF-installed §11 retreat lock's stamp (MATCH_RECORD_VERSION 25 → 26).
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        // 🆕🆕 D394 — `usedAttack` JOINS THE LIST (a FOURTH per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 24 → 25 with it). THIS slice still
        // wrote nothing; the pin is on the HEAD's key set.
        "usedAttack",
      ].sort(),
    );
  });

  it("GATES NO ACTION — the payability projection takes a zero diff", () => {
    // Checked rather than assumed (question 5). Neither printed sentence says
    // "can't be used": a reduced attack is weaker, never illegal, and neither field
    // touches cost or legality. So `redactedAttacksOf` and `GameHud` need no arm,
    // and the shielded seat's own attacks stay exactly as payable as before.
    let shielded = board("fix-attacker", "fix-bigbody");
    shielded = setActiveFromDeck(shielded, "p1", "sv02-113");
    shielded = clearBench(shielded, "p1");
    shielded = attachToolFromDeck(shielded, "p1", "active", "sv01-192");
    shielded = attachFromDeck(shielded, "p1", "fix-fighting-energy", 1);
    shielded = attachFromDeck(shielded, "p1", "fix-energy", 2);
    // The HUD projection offers Rocket Slap with the aura and the Tool both live on
    // the declaring body — swept rather than sampled, and the gate agrees.
    const view = redactGame(shielded, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(1);
    expect(view.attacks[0]).toMatchObject({ index: 0, name: "Rocket Slap", playable: true });
    expect(applyAction(shielded, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});
