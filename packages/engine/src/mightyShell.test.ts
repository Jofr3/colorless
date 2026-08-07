import { describe, expect, it } from "vitest";
import { attackerHasSpecialEnergy, passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  MIGHTY_SHELL_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.167.0 → 0.168.0 — Carracosta "Mighty Shell" (P3-M5 long tail, D252):
// "Prevent all damage from and effects of attacks done to this Pokémon by your
// opponent's Pokémon that have any Special Energy attached."
//
// THE FOURTH MEMBER OF THE ATTACKER-PROPERTY PREVENT FAMILY, AND THE FIRST ONE
// THAT STOPS EFFECTS AS WELL AS DAMAGE — the half D251 measured, named and refused
// to build. `preventDamageFromExV` (Mimikyu "Safeguard", D107) gates on the
// attacker's RULE BOX; `preventDamageFromTypes` (Dachsbun/Bellibolt, D159) on its
// printed TYPES; `preventDamageFromHasAbility` (Cornerstone Stance, D251) on
// whether its card carries an Ability. All three are the NARROW printed spelling —
// they stop damage and nothing else — and all three are CARD reads.
//
// THIS ONE IS DIFFERENT ON BOTH AXES AT ONCE, which is why it is a second rule and
// not a fourth value of the first:
//   • the gate is a BOARD read. "have any Special Energy attached" is a fact about
//     attachments, so the predicate takes an `InPlayPokemon` and `state`
//     (continuous.ts `attackerHasSpecialEnergy`) and CANNOT live in `cards.ts`
//     beside its three siblings, which know nothing about `GameState`;
//   • the prevention is the WIDE printed spelling, so it is read at FIVE sites
//     rather than four: attack.ts's main hit, interpreter.ts's spread, `deals` and
//     snipe arms, PLUS `attackEffectRefused`.
//
// 🆕 **AND THE FIFTH SITE COST ONE GATE RATHER THAN EIGHT, WHICH IS THE MEASURED
// ANSWER TO THE QUESTION D251's HANDOFF CALLED "THE WHOLE UNKNOWN".**
// `attackEffectRefused` is the one funnel every attack-borne effect already passes
// through — EIGHT call sites in interpreter.ts (`stepOp`'s discard, `applyStatus`,
// `preventRetreat`, `preventAttack`, `preventChosenAttack`,
// `weakenDefenderAttacks`, `healEachAll`, `moveCountersToDefender`) — and until
// this slice it read exactly one channel, the INSTALLED §11 block. The aura joins
// it there and not one of the eight ops changed. Two of the eight are driven below
// on real boards, deliberately, because "the funnel is the rule" is a claim about
// more than one op or it is not a claim.
//
// ⚠️ THE CENSUS, TRANSCRIBED SO THE COUNT IS RE-DERIVABLE RATHER THAN INHERITED.
// Run against the remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a) on
// 2026-08-07:
//
//   SELECT lower(json_extract(a.value,'$.effect')) AS s, COUNT(*) n,
//          group_concat(c.id) ids
//   FROM cards c, json_each(c.abilities_json) a
//   WHERE c.legal_standard = 1
//     AND lower(json_extract(a.value,'$.effect')) LIKE '%and effects of attacks%'
//   GROUP BY s ORDER BY n DESC;
//
// returns NINE printings on FOUR sentences — D251's handoff figure, re-derived to
// the digit for the TWENTIETH row running:
//
//   3  …from your opponent's TERA Pokémon done to this Pokémon.   sv08-042/-217/-237
//   3  As long as this Pokémon is on your BENCH, …                sv06-020/-171/sv10-048
//   2  …by your opponent's Pokémon that have any Special Energy   ← THIS ROW
//      attached.                                                  sv10.5b-023/-107
//   1  …done to your BENCHED Pokémon.                             sv05-024
//
// 🛑 **AND THE 3-PRINTING GROUP AT THE TOP IS UNBUILDABLE, WHICH THE SLICE CHECKED
// FIRST RATHER THAN ASSUMED — D243's REASON, CONFIRMED BY QUERY.** "Tera" is a
// BANNER, and `SELECT suffix, COUNT(*) FROM cards WHERE legal_standard = 1 GROUP BY
// suffix` returns exactly two rows: `null` (1,668) and `ex` (353). There is no
// third value and no other column carries it — Milotic ex `sv08-042` and Terapagos
// ex `sv07-128` are both plain `suffix = 'ex'`, so nothing in the ingested catalog
// can tell a Tera Pokémon from any other. **The addressable group is 6, not 9.**
//
// ⚠️ THE WIDENING LADDER, THREE RUNGS, WITH THE FALSE POSITIVES NAMED RATHER THAN
// COUNTED.
//   • `%special energy attached%` over `abilities_json`, legal only — returns this
//     sentence plus Luminous Energy's own holder condition and two "…this attack
//     does N more damage" attack riders (`deriveAttackDamageBonus`'s, already
//     built). Zero unbuilt neighbours.
//   • `%and effects of attacks%` over `abilities_json` — the 4 sentences above.
//   • `%and effects of attacks%` over ALL THREE text columns — adds the ATTACK
//     column's "during your opponent's next turn" INSTALLATIONS, which are
//     `attackBlockOf`'s wide spelling and were built at D142, plus the effects-ONLY
//     printings that carry the printed reminder "(Damage is not an effect.)". Those
//     last are the SAME rule without the damage half and are a measured backlog row
//     rather than a false positive.

const bite = { type: "attack", seat: "p1", index: 0 } as const;
const spread = { type: "attack", seat: "p1", index: 1 } as const;
const yawn = { type: "attack", seat: "p1", index: 4 } as const;
const clutch = { type: "attack", seat: "p1", index: 5 } as const;
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Setup, field the holder in P2's ACTIVE spot, hand the turn to P1, who fields
    `attackerId` and attaches ONE copy of `energyId`.

    ⚠️ `energyId` IS THE ONLY THING THAT MOVES BETWEEN A PREVENTED BOARD AND AN
    UNPREVENTED ONE IN THIS WHOLE SUITE, which is what makes every assertion below
    about THIS gate and not about a neighbour: `fix-shellcracker` has no Ability
    and no rule box, so the other three prevention fields are dead on every board
    here, and both Energy pay the same {C} cost. */
function fight(attackerId: string, energyId: string): GameState {
  let state = driveSetup(1, { p1: MIGHTY_SHELL_DECK, p2: MIGHTY_SHELL_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-mightyshell");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", energyId, 1);
}

/** The BENCH path: P2's Active is a plain 200 HP body and the holder sits on the
    Bench, where the DAMAGE half still protects it — the sentence has no
    Active-Spot clause. Setup also auto-benches the dominant fix-bigbody, so the
    holder is not necessarily bench[0]: find it by card id. */
function fightBench(energyId: string): GameState {
  let state = driveSetup(1, { p1: MIGHTY_SHELL_DECK, p2: MIGHTY_SHELL_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", "fix-mightyshell");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", energyId, 1);
}

function benchedHolder(state: GameState) {
  return state.players.p2.bench.find(
    (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "fix-mightyshell",
  );
}

/** Declare a chosen-target attack and resolve the prompt onto the ref at `spot`.
    An `opponentAny` snipe with more than one candidate PARKS in `effect:choose`
    (setup auto-benches the dominant fix-bigbody, so there always is more than
    one) — the two-step is the shape, not an accident of this board. */
function snipeAt(state: GameState, index: number, spot: "active" | "holderBench") {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find(
          (c) =>
            c.spot.spot === "bench" &&
            parked.cardIdByUid[parked.players.p2.bench[c.spot.index]?.stack.at(-1) ?? ""] ===
              "fix-mightyshell",
        );
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("Mighty Shell — the registry data row", () => {
  it("authors both printings as a bare preventDamageAndEffectsFromSpecialEnergy passive", () => {
    for (const id of ["sv10.5b-023", "sv10.5b-107"]) {
      expect(programFor(id)?.passive, id).toEqual({
        preventDamageAndEffectsFromSpecialEnergy: true,
      });
    }
  });

  // ⚠️ ONE OBJECT SHARED BY BOTH, which is the claim the coverage count is actually
  // making: two printings of ONE card, so a second object (or a duplicated id)
  // would inflate what this slice bought.
  it("shares ONE program object across both ids and the demonstrator", () => {
    const program = programFor("sv10.5b-023");
    for (const id of ["sv10.5b-107", "fix-mightyshell"]) {
      expect(programFor(id), id).toBe(program);
    }
  });

  // The three fields it is NOT. Asserted on each FIELD rather than on the whole
  // passive object — D250's rule about the narrowest carrier of a claim.
  it("writes none of the three sibling prevention fields", () => {
    const passive = programFor("sv10.5b-023")?.passive;
    expect(passive?.preventDamageFromExV).toBeUndefined();
    expect(passive?.preventDamageFromType).toBeUndefined();
    expect(passive?.preventDamageFromHasAbility).toBeUndefined();
  });

  // 🛑 AND THE CONVERSE, WHICH IS THE SHARPEST CROSS-SLICE CLAIM THIS FILE MAKES.
  // D251's five printings say "prevent all damage from attacks" and NOT "from and
  // effects of", so they must not acquire the effects half by living in the same
  // fold. An engine that treated the narrow spelling as implying the wide one
  // would give five real cards a protection their text does not print.
  it("D251's NARROW printings do not acquire the effects half", () => {
    for (const id of ["sv06-112", "sv06-199", "sv06-215", "sv08.5-058", "sv08.5-160"]) {
      expect(programFor(id)?.passive?.preventDamageAndEffectsFromSpecialEnergy, id).toBeUndefined();
    }
  });
});

describe("attackerHasSpecialEnergy — the attacker-side predicate (continuous.ts)", () => {
  it("is TRUE once an UNAUTHORED Special Energy is attached and FALSE before", () => {
    const bare = fight("fix-shellcracker", "fix-energy");
    const armed = fight("fix-shellcracker", "fix-special");

    expect(attackerHasSpecialEnergy(bare, bare.players.p1.active ?? undefined)).toBe(false);
    expect(attackerHasSpecialEnergy(armed, armed.players.p1.active ?? undefined)).toBe(true);
  });

  // 🛑 THE READ IS THE CARD CLASS AND NOT THE REGISTRY, which is what stops the
  // gate quietly narrowing to the Special Energy this build happens to implement:
  // `fix-special` has no `EnergyProgram` at all and still counts.
  it("counts an AUTHORED Special (Luminous sv02-191) the same way", () => {
    const armed = fight("fix-shellcracker", "sv02-191");

    expect(attackerHasSpecialEnergy(armed, armed.players.p1.active ?? undefined)).toBe(true);
    expect(programFor("fix-special")).toBeUndefined();
  });

  // The conservative direction, `preventsAttackerType`'s verbatim: three of the
  // five read sites hold the attacking body as an optional.
  it("is FALSE for an unresolvable attacking body", () => {
    const state = fight("fix-shellcracker", "fix-special");

    expect(attackerHasSpecialEnergy(state, undefined)).toBe(false);
  });

  // 🛑 IT IS A BOARD READ AND NOT A CARD READ, which is the whole reason it is in
  // continuous.ts: the SAME card is on both sides of these two assertions.
  it("answers about the BODY and not the printing — same card, both answers", () => {
    const bare = fight("fix-shellcracker", "fix-energy");
    const armed = fight("fix-shellcracker", "fix-special");
    const id = (s: GameState) => s.cardIdByUid[s.players.p1.active?.stack.at(-1) ?? ""];

    expect(id(bare)).toBe(id(armed));
    expect(attackerHasSpecialEnergy(bare, bare.players.p1.active ?? undefined)).toBe(false);
    expect(attackerHasSpecialEnergy(armed, armed.players.p1.active ?? undefined)).toBe(true);
  });
});

describe("Mighty Shell — the main hit (attack.ts, read site 1 of 5)", () => {
  it("a Special-Energy attacker's Bite is fully prevented — 0 damage, flagged", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 0, prevented: true });
  });

  it("the SAME attacker holding a BASIC Energy deals full damage", () => {
    const state = fight("fix-shellcracker", "fix-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(30);
  });

  // 🛑 THE GATE READS THE ATTACKER'S ATTACHMENTS AND NEVER THE HOLDER'S. A build
  // that read the defender's would pass every board where only the holder carries
  // Energy — which is most of them, since the holder never needs to attack.
  it("a Special Energy on the HOLDER does not prevent anything", () => {
    let state = driveSetup(1, { p1: MIGHTY_SHELL_DECK, p2: MIGHTY_SHELL_DECK }, { first: "p2" });
    state = setActiveFromDeck(state, "p2", "fix-mightyshell");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-shellcracker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
  });
});

describe("Mighty Shell — the spread and snipe arms (read sites 2, 3 and 4 of 5)", () => {
  // No Active-Spot clause on the sentence, so the DAMAGE half protects a BENCHED
  // holder too.
  it("prevents the benched holder's share of a spread", () => {
    const state = fightBench("fix-special");
    const uid = benchedHolder(state)?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(events.some((e) => e.type === "DAMAGE_DEALT" && e.uid === uid && e.dealt === 0)).toBe(
      true,
    );
    expect(benchedHolder(done)?.damage).toBe(0);
  });

  it("does NOT prevent the spread when the attacker holds only a Basic Energy", () => {
    const state = fightBench("fix-energy");
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);

    expect(benchedHolder(done)?.damage).toBe(20);
  });

  it("prevents a chosen-target snipe onto the benched holder", () => {
    const state = fightBench("fix-special");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "holderBench");

    expect(benchedHolder(done)?.damage).toBe(0);
  });

  it("prevents a chosen-target snipe onto the holder in the ACTIVE spot", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { state: done, events } = snipeAt(state, 2, "active");

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  // ⚠️ `ignoreWR` NULLS IT, and that is the family's shape rather than this
  // printing's: the aura is an effect ON the damaged Pokémon, so "isn't affected
  // by … any effects on that Pokémon" reaches it exactly as it reaches the three
  // narrow siblings beside it.
  it("Feint Attack's ignoreWR nulls the prevention — 50 lands on the holder", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 3, "active");

    expect(done.players.p2.active?.damage).toBe(50);
  });
});

describe("Mighty Shell — the EFFECTS half (interpreter.ts attackEffectRefused, site 5 of 5)", () => {
  // 🛑 THE HALF THE PRINTED SENTENCE IS LONGER FOR, AND THE ONE NO EARLIER MEMBER
  // OF THIS FAMILY HAS. Yawn is `applyStatus`, the first of the two ops driven
  // here.
  it("refuses an attack's STATUS and announces the refusal", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2" });
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(done.players.p2.active?.conditions?.rotation).toBe("none");
  });

  it("…and the SAME attack from a Basic-Energy attacker puts the holder to sleep", () => {
    const state = fight("fix-shellcracker", "fix-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions?.rotation).toBe("asleep");
  });

  // 🛑 A SECOND OP BEHIND THE SAME GATE, WHICH IS WHAT MAKES THIS A CLAIM ABOUT THE
  // FUNNEL RATHER THAN ABOUT `applyStatus`. Clutch is `preventRetreat` — a
  // different op, a different event, one shared refusal.
  it("refuses an attack's RETREAT LOCK too — the funnel, not the op", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, clutch);

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(types(events)).not.toContain("RETREAT_BLOCKED");
    expect(done.players.p2.active?.retreatBlocked).toBe(false);
  });

  it("…and lets the retreat lock land when the attacker holds a Basic Energy", () => {
    const state = fight("fix-shellcracker", "fix-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, clutch);

    expect(types(events)).toContain("RETREAT_BLOCKED");
    expect(done.players.p2.active?.retreatBlocked).toBe(true);
  });

  // ⚠️ THE DAMAGE HALF AND THE EFFECTS HALF ARE ONE FIELD, so an attack that does
  // both must have both refused on one board — the printed sentence's whole shape
  // in a single assertion.
  it("refuses damage AND effect from one attack — Yawn's 0 damage is not the point", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const bites = mustApply(state, bite);
    const yawns = mustApply(state, yawn);

    expect(find(bites.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(yawns.events)).toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("Mighty Shell — §9, and it must switch BOTH halves", () => {
  // The HOLDER's aura IS an Ability, so a lock over it must switch the prevention
  // off. Klefki is Active-gated, so the locking body has to be the attacking body.
  it("a lock over the HOLDER switches the DAMAGE half off", () => {
    const state = fight("sv01-096", "fix-special");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, joust);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
    expect(done.players.p2.active?.damage).toBe(10);
  });

  it("…and `passivesOf` is where that answer is made", () => {
    const state = fight("sv01-096", "fix-special");
    const holder = state.players.p2.active;
    if (holder === null || holder === undefined) throw new Error("no active");

    expect(passivesOf(state, holder).preventDamageAndEffectsFromSpecialEnergy).toBe(false);
  });

  // 🛑 AND THE EFFECTS HALF MUST GO WITH IT, which is a SEPARATE assertion because
  // it is a separate read site: `attackEffectRefused` reads the fold through
  // `passivesOf` for exactly this reason, and a build that read the holder's
  // catalog row straight off its top card would keep refusing effects under a lock.
  // ⚠️ Klefki prints no status attack, so the LOCK is fielded on P1's BENCH — its
  // "Mischievous Lock" is Active-gated on its source, so a benched Klefki is the
  // control and the ACTIVE one is the case.
  it("a lock over the HOLDER switches the EFFECTS half off as well", () => {
    let locked = driveSetup(1, { p1: MIGHTY_SHELL_DECK, p2: MIGHTY_SHELL_DECK }, { first: "p2" });
    locked = setActiveFromDeck(locked, "p2", "fix-mightyshell");
    locked = mustApply(locked, { type: "endTurn", seat: "p2" }).state;
    locked = setActiveFromDeck(locked, "p1", "sv01-096");
    locked = attachFromDeck(locked, "p1", "fix-special", 1);
    deepFreeze(locked);

    // Klefki's own attack carries no effect, so the EFFECTS half is read at the
    // fold rather than through an op here — the same value `attackEffectRefused`
    // consults, one function call earlier.
    const holder = locked.players.p2.active;
    if (holder === null || holder === undefined) throw new Error("no active");
    expect(passivesOf(locked, holder).preventDamageAndEffectsFromSpecialEnergy).toBe(false);

    const { events } = mustApply(locked, joust);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("Mighty Shell — the fold (continuous.ts passivesOf)", () => {
  it("reports the flag on the holder and FALSE on every other body", () => {
    const state = fightBench("fix-special");
    const holder = benchedHolder(state);
    const active = state.players.p2.active;
    if (holder === undefined || active === null || active === undefined)
      throw new Error("board not set up");

    expect(passivesOf(state, holder).preventDamageAndEffectsFromSpecialEnergy).toBe(true);
    expect(passivesOf(state, active).preventDamageAndEffectsFromSpecialEnergy).toBe(false);
  });

  // A boolean and not a list, and the reason is in the field's doc: the gate names
  // no VALUE, so an OR over N sources is lossless. The assertion that keeps that
  // honest is that the fold's OTHER three prevention fields are untouched by it —
  // four prevention gates, four independent answers on one body.
  it("leaves the three sibling prevention fields alone", () => {
    const state = fightBench("fix-special");
    const holder = benchedHolder(state);
    if (holder === undefined) throw new Error("no benched holder");
    const fold = passivesOf(state, holder);

    expect(fold.preventDamageAndEffectsFromSpecialEnergy).toBe(true);
    expect(fold.preventDamageFromHasAbility).toBe(false);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
  });

  // ⚠️ THE FOLD IS BOARD-INDEPENDENT ON THE ATTACKER AXIS: the holder's flag says
  // nothing about who is attacking, which is why the predicate is resolved at the
  // FIVE read sites and not here. Same holder, no attacker at all, same answer.
  it("does not consult the attacker — the flag is a fact about the HOLDER only", () => {
    const armed = fight("fix-shellcracker", "fix-special");
    const bare = fight("fix-shellcracker", "fix-energy");
    const a = armed.players.p2.active;
    const b = bare.players.p2.active;
    if (a === null || a === undefined || b === null || b === undefined)
      throw new Error("no active");

    expect(passivesOf(armed, a).preventDamageAndEffectsFromSpecialEnergy).toBe(true);
    expect(passivesOf(bare, b).preventDamageAndEffectsFromSpecialEnergy).toBe(true);
  });
});

describe("Mighty Shell — the fixture cast", () => {
  // D250's rule: the pool is swept for the SENTENCE before a fixture is appended,
  // and the sentence lives on the fixture so a census can SEE it (a comment cannot
  // go red).
  it("the demonstrator carries the printed sentence verbatim", () => {
    expect(FIXTURE_POOL["fix-mightyshell"]?.abilities?.[0]?.effect).toBe(
      "Prevent all damage from and effects of attacks done to this Pokémon by your opponent's Pokémon that have any Special Energy attached.",
    );
  });

  // The attacker's three negatives, asserted rather than assumed: no Ability, no
  // rule box, no printed type the holder is weak to. Without them a prevented
  // board could be some other gate's.
  it("the attacker arms none of the three sibling gates", () => {
    const attacker = FIXTURE_POOL["fix-shellcracker"];

    expect(attacker?.abilities ?? []).toEqual([]);
    expect(attacker?.name).toBe("fix-shellcracker");
    expect(FIXTURE_POOL["fix-mightyshell"]?.weaknesses ?? []).toEqual([]);
  });

  // All five read sites are reachable from ONE body, which is the property that
  // keeps "the attacker has a Special Energy" constant across all five.
  it("the attacker prints one attack per read site, six in all", () => {
    expect((FIXTURE_POOL["fix-shellcracker"]?.attacks ?? []).map((a) => a.name)).toEqual([
      "Bite",
      "Spread Shot",
      "Pebble Toss",
      "Feint Attack",
      "Yawn",
      "Clutch",
    ]);
  });
});
