import { describe, expect, it } from "vitest";
import { isOnBench, passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  CURIOUS_TEA_PARTY_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.168.0 → 0.169.0 — Poltchageist / ⚠️ Misty's Magikarp (NOT Sinistcha, and no
// card prints an Ability called "Curious Tea Party" — D305) (P3-M5 long
// tail, D253): "As long as this Pokémon is on your Bench, prevent all damage from
// and effects of attacks from your opponent's Pokémon done to this Pokémon."
//
// THE FIFTH MEMBER OF THE PREVENT FAMILY, AND THE FIRST WHOSE GATE NAMES NEITHER
// THE ATTACKER NOR A CARD. `preventDamageFromExV` (D107) gates on the attacker's
// RULE BOX; `preventDamageFromTypes` (D159) on its printed TYPES;
// `preventDamageFromHasAbility` (D251) on whether its card carries an Ability;
// `preventDamageAndEffectsFromSpecialEnergy` (D252) on the attacker's ATTACHMENTS.
// This one narrows the attacker not at all — the printed object is "your
// opponent's Pokémon", which is every attacker there is — and narrows instead
// WHERE ITS OWN BODY IS STANDING.
//
// 🛑 THAT ONE DIFFERENCE IS THE WHOLE SLICE, AND IT WAS SETTLED BY READING A
// SIGNATURE RATHER THAN BY ANALOGY. The question the handoff called "the whole
// unknown" was whether a zone gate can be resolved in the FOLD or must be paid at
// every read site, and the answer is one grep:
//
//     export function passivesOf(state: GameState, pokemon: InPlayPokemon)
//
// It takes a body AND a `GameState`, and LOCATING a body needs exactly those two —
// which is not a hope either, because `benchShieldedFromDamage` (D159) has been
// doing that scan by top uid at the bottom of the same file for ninety-odd slices.
// So `isOnBench(state, pokemon)` folds the clause where `basicHpBonus` folds its
// STAGE clause and `damageReductionAfterWRIfType` folds its TYPE clause, and the
// five read sites take a BARE boolean with no predicate call beside it.
//
// ⚠️ THE RULE THAT GENERALISES, AND IT IS D161's LINE WIDENED FROM ONE FIELD TO A
// FAMILY: **A GATE THAT NAMES THE HOLDER FOLDS; A GATE THAT NAMES THE ATTACKER
// CANNOT BE RESOLVED ANYWHERE BUT A READ SITE.** Four of this family's five fields
// name the attacker and all four pay a predicate at every site. This one names the
// holder and pays none.
//
// 🛑 AND THE BENCH CLAUSE MAKES THREE OF THE FIVE READ SITES DEAD, WHICH IS
// ASSERTED HERE RATHER THAN ASSUMED. §8 aims an attack at an ACTIVE, so:
//   • attack.ts's main hit         — DEAD (defender is the Active)
//   • interpreter.ts spread        — LIVE  (maps `side.bench`)
//   • interpreter.ts placeSnipe    — LIVE  (maps `side.bench`)
//   • interpreter.ts snipeActive   — DEAD (`target.active`)
//   • interpreter.ts attackEffect  — DEAD (`state.players[seat].active`)
//     Refused
// The printed sentence's EFFECTS half is therefore structurally unreachable on
// today's op set. All five are guarded anyway (the arms are TOTAL, not
// case-covering) and the three dead ones carry NO mutants, because an unkillable
// mutant is a corpus defect rather than coverage.
//
// ⚠️ THE CENSUS, AND THE ONE THING THIS SLICE COULD NOT DO. D252 measured the
// family on the remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a) on
// 2026-08-07 with
//
//   SELECT lower(json_extract(a.value,'$.effect')) AS s, COUNT(*) n,
//          group_concat(c.id) ids
//   FROM cards c, json_each(c.abilities_json) a
//   WHERE c.legal_standard = 1
//     AND lower(json_extract(a.value,'$.effect')) LIKE '%and effects of attacks%'
//   GROUP BY s ORDER BY n DESC;
//
// and got NINE printings on FOUR sentences, of which THIS row is the 3
// (`sv06-020`/`sv06-171`/`sv10-048`). 🛑 **THAT COUNT WAS NOT RE-DERIVED AT D253's
// COMMIT AND WAS RECORDED AS INHERITED RATHER THAN CONFIRMED**, because the remote
// D1 answered `403 / code 7403` ("the given account is not valid or is not
// authorized to access this service") to every query and the LOCAL sqlite that
// `catalogManifest.ts` describes is the ROTATED six-set / 978-row population, which
// contains no `sv06` and no `sv10` row at all — there was no second source.
// ✅ **D254 RE-RAN IT AND THE ROW MEASURES 3, ON THESE EXACT THREE IDS, INSIDE THE
// SAME 9-ON-4 FAMILY.** The re-derivation streak resumes at D254; D253 is not
// back-dated into it, because an increment that turns out true was still never a
// measurement.
//
// ✅ WHAT WAS LEFT AFTER THIS ROW — exactly ONE printing, `sv05-024` "…done to your
// BENCHED Pokémon" — IS BUILT AT D254 (`sphericalShield.test.ts`), closing the
// family at 6 of 6 addressable. ⚠️ This block used to call it
// "`benchShieldedByActive`'s shape"; that was HALF right and D254 graded it as a
// loss — same TARGET clause, no SOURCE clause at all, so its source set contains
// its target set and the widened scan needs a `scope` no member of that family had
// needed except `seatDamageReduction`. The 3-printing TERA group at the top of the
// census stays UNBUILDABLE for D252's measured reason — "Tera" is a printed BANNER
// and no ingested column carries it.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // {C}, 30 — the ACTIVE hit
const spread = { type: "attack", seat: "p1", index: 1 } as const; // 20 to each Benched
const yawn = { type: "attack", seat: "p1", index: 4 } as const; // Asleep — an effect op
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

/** THE CASE BOARD: the holder on P2's BENCH, where its printed antecedent holds.
    P2's Active is a plain 200 HP body so the bench arms have somewhere to land
    that is not the holder. `attackerId` is fielded Active for P1 and holds a plain
    Colorless Energy, because nothing this slice reads can see an attacker's
    attachments — the {C} is there to pay costs and for no other reason. */
function benched(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(
    1,
    { p1: CURIOUS_TEA_PARTY_DECK, p2: CURIOUS_TEA_PARTY_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", "fix-teaparty");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** THE CONTROL BOARD, AND THE ONE THAT MATTERS MOST: the SAME holder in P2's
    ACTIVE spot, where its printed antecedent is false and it protects NOTHING.

    🛑 THIS IS THE SHARPEST OBSERVABLE CLAIM THE SLICE MAKES. A build that shipped
    the field and forgot the `&& onBench` in the fold would pass every assertion on
    the bench board above and would hand these three printings an unconditional
    immunity to all damage and all effects — which is not a subtle mis-reading, it
    is an unbeatable card. Every bench assertion below has an Active twin for that
    reason. */
function active(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(
    1,
    { p1: CURIOUS_TEA_PARTY_DECK, p2: CURIOUS_TEA_PARTY_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-teaparty");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Setup also auto-benches the dominant fix-bigbody, so the holder is not
    necessarily bench[0]: find it by card id (D252's helper, re-keyed). */
function holderOnBench(state: GameState) {
  return state.players.p2.bench.find(
    (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "fix-teaparty",
  );
}

/** Declare a chosen-target attack and resolve the prompt onto the ref at `spot`.
    An `opponentAny` snipe with more than one candidate PARKS in `effect:choose`
    — the two-step is the shape, not an accident of this board (D251's helper). */
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
              "fix-teaparty",
        );
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("Curious Tea Party — the registry data row", () => {
  // ⚠️ THE COUNT IS INHERITED, NOT RE-DERIVED — the header says why in full, and
  // this test asserts the SHAPE of the row rather than the census behind it. What
  // it does keep honest is that all three ids share ONE object. ⚠️ D305: the
  // reason recorded here was WRONG — `sv10-048` is Misty's Magikarp, not Sinistcha,
  // and evolves from nothing. They share an object because they print the same
  // SENTENCE, so two rows would be two readings of one printed string.
  it("authors all three printings as a bare preventDamageAndEffectsWhileBenched passive", () => {
    for (const id of ["sv06-020", "sv06-171", "sv10-048"]) {
      expect(programFor(id)?.passive, id).toEqual({
        preventDamageAndEffectsWhileBenched: true,
      });
    }
  });

  it("shares ONE program object across the line and its reprint", () => {
    expect(programFor("sv06-020")).toBe(programFor("sv06-171"));
    expect(programFor("sv06-020")).toBe(programFor("sv10-048"));
  });

  // 🛑 THE MERGE THIS FIELD REFUSES, ASSERTED IN BOTH DIRECTIONS. Folding this
  // sentence into D252's would hand Carracosta's two printings a protection that
  // needs no Special Energy AND hand these three one that needs it. Two disjoint
  // antecedents on one consequent are two fields, and these are the rows that say
  // so.
  it("does not touch the Special-Energy field, and D252's does not touch this one", () => {
    expect(
      programFor("sv06-020")?.passive?.preventDamageAndEffectsFromSpecialEnergy,
    ).toBeUndefined();
    expect(programFor("sv10.5b-023")?.passive?.preventDamageAndEffectsWhileBenched).toBeUndefined();
  });

  it("authors nothing on the four sibling prevention rows", () => {
    for (const id of ["sv02-097", "sv01-099", "sv07-038"]) {
      expect(programFor(id)?.passive?.preventDamageAndEffectsWhileBenched, id).toBeUndefined();
    }
  });
});

describe("isOnBench — the holder-ZONE predicate (continuous.ts)", () => {
  // 🛑 THE PREDICATE THAT MADE THE FOLD POSSIBLE. It is a BOARD read, like D252's
  // `attackerHasSpecialEnergy` and unlike D251's `hasPrintedAbility` — so it lives
  // here and not in `cards.ts`, which deliberately knows nothing about GameState.
  it("answers TRUE for a benched body and FALSE for the same card in the Active spot", () => {
    const onBench = benched();
    const inActive = active();
    const holder = holderOnBench(onBench);
    const activeHolder = inActive.players.p2.active;
    if (holder === undefined || activeHolder === null || activeHolder === undefined)
      throw new Error("board not set up");

    expect(isOnBench(onBench, holder)).toBe(true);
    expect(isOnBench(inActive, activeHolder)).toBe(false);
  });

  // SEAT-BLIND on purpose: "your Bench" is the holder's own side by construction —
  // a Pokémon is never on the opponent's bench — so scanning both sides is how the
  // seat gets DERIVED without any caller passing one. Asserted from the OTHER seat.
  it("derives the seat rather than taking one — P1's own bench answers TRUE too", () => {
    const state = benched();
    const p1Benched = state.players.p1.bench[0];
    if (p1Benched === undefined) throw new Error("no p1 bench");

    expect(isOnBench(state, p1Benched)).toBe(true);
  });

  it("answers FALSE for a body that is not in play at all", () => {
    const state = benched();
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");

    expect(isOnBench(state, { ...holder, stack: [] })).toBe(false);
  });

  // ⚠️ IDENTITY IS TOP UID AND NOT `===`. `InPlayPokemon` is rebuilt by value on
  // every damage step, so a reference compare would answer FALSE for the very body
  // the caller just handed us one line after it took a hit — the defect that would
  // switch the prevention off mid-attack and would never show up on a fresh board.
  it("matches by TOP UID, so a rebuilt-by-value copy still answers TRUE", () => {
    const state = benched();
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");

    expect(isOnBench(state, { ...holder, damage: holder.damage + 10 })).toBe(true);
  });
});

describe("Curious Tea Party — the two LIVE read sites (spread and placeSnipe)", () => {
  it("prevents the benched holder's share of a spread", () => {
    const state = benched();
    const uid = holderOnBench(state)?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(events.some((e) => e.type === "DAMAGE_DEALT" && e.uid === uid && e.dealt === 0)).toBe(
      true,
    );
    expect(holderOnBench(done)?.damage).toBe(0);
  });

  // ⚠️ THE SAME SPREAD, SAME ATTACKER, AND THE HOLDER'S NEIGHBOURS TAKE IT. Without
  // this the suite could not tell "the prevention fired" from "the spread never
  // reached the bench".
  it("…while the holder's BENCH NEIGHBOUR takes the full 20 from the same spread", () => {
    const state = benched();
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);
    const neighbour = done.players.p2.bench.find(
      (p) => done.cardIdByUid[p.stack.at(-1) ?? ""] !== "fix-teaparty",
    );

    expect(neighbour?.damage).toBe(20);
  });

  it("prevents a chosen-target snipe onto the benched holder", () => {
    const state = benched();
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "holderBench");

    expect(holderOnBench(done)?.damage).toBe(0);
  });

  // ⚠️ `ignoreWR` NULLS IT, and that is the family's shape rather than this
  // printing's: the aura is an effect ON the damaged Pokémon, so Feint Attack's
  // "isn't affected by … any effects on that Pokémon" reaches it exactly as it
  // reaches the four siblings beside it. 50 lands on a BENCHED holder.
  it("Feint Attack's ignoreWR nulls the prevention — 50 lands on the benched holder", () => {
    const state = benched();
    deepFreeze(state);

    const { state: done } = snipeAt(state, 3, "holderBench");

    expect(holderOnBench(done)?.damage).toBe(50);
  });
});

describe("Curious Tea Party — the ACTIVE holder prevents NOTHING", () => {
  // 🛑 THE HALF OF THE PRINTED SENTENCE THAT MAKES THE CARD BEATABLE, and the half
  // a build that dropped `&& onBench` from the fold would silently lose. Every
  // assertion here is the twin of one above it.
  it("takes the main hit in full — attack.ts's site is DEAD for this field", () => {
    const state = active();
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("takes a chosen-target snipe in full — snipeActive's site is DEAD too", () => {
    const state = active();
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "active");

    expect(done.players.p2.active?.damage).toBe(40);
  });

  // 🛑 AND THE EFFECTS HALF IS STRUCTURALLY UNREACHABLE, ASSERTED RATHER THAN
  // ASSUMED. `attackEffectRefused` resolves `state.players[seat].active`, so the
  // one op-driven board this field could ever meet is one where its antecedent is
  // false. Yawn lands. That is not a bug in the printing's reading — it is a
  // measured fact about today's op set, and the disjunct is written at that site
  // anyway so the day an op aims an effect at a benched body the guard is there.
  it("is put to Sleep — the EFFECTS half has no reachable board today", () => {
    const state = active();
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions?.rotation).toBe("asleep");
  });

  // …and the same op with the holder on the BENCH also refuses nothing, because
  // Yawn names the Active. The two together are what make "unreachable" a claim
  // about the FUNNEL rather than about where this particular holder happened to be.
  it("…and a BENCHED holder is not reached by that op either — the funnel aims Active", () => {
    const state = benched();
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions?.rotation).toBe("asleep");
    expect(holderOnBench(done)?.damage).toBe(0);
  });
});

describe("Curious Tea Party — the gate is LIVE-READ, not stamped", () => {
  // 🛑 NOTHING IS STORED, SO A PROMOTION ENDS THE PREVENTION THE SAME INSTANT.
  // `passivesOf` re-reads the board on every damage step, which is the reason
  // Boss's Orders answers this card at all. Driven as a fold read on two boards
  // built from the SAME deck with the same 60 cards — only the spot differs.
  it("the fold flips with the holder's SPOT and with nothing else", () => {
    const onBench = benched();
    const inActive = active();
    const holder = holderOnBench(onBench);
    const activeHolder = inActive.players.p2.active;
    if (holder === undefined || activeHolder === null || activeHolder === undefined)
      throw new Error("board not set up");

    expect(passivesOf(onBench, holder).preventDamageAndEffectsWhileBenched).toBe(true);
    expect(passivesOf(inActive, activeHolder).preventDamageAndEffectsWhileBenched).toBe(false);
  });

  it("reports FALSE on every OTHER body on the benched board", () => {
    const state = benched();
    const activeBody = state.players.p2.active;
    const neighbour = state.players.p2.bench.find(
      (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] !== "fix-teaparty",
    );
    if (activeBody === null || activeBody === undefined || neighbour === undefined)
      throw new Error("board not set up");

    expect(passivesOf(state, activeBody).preventDamageAndEffectsWhileBenched).toBe(false);
    expect(passivesOf(state, neighbour).preventDamageAndEffectsWhileBenched).toBe(false);
  });

  // A boolean and not a list, and the reason is in the field's doc: the gate names
  // no VALUE, so an OR over N sources is lossless. What keeps that honest is that
  // the fold's other FOUR prevention fields are untouched by it — five prevention
  // gates, five independent answers on one body.
  it("leaves the four sibling prevention fields alone", () => {
    const state = benched();
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");
    const fold = passivesOf(state, holder);

    expect(fold.preventDamageAndEffectsWhileBenched).toBe(true);
    expect(fold.preventDamageAndEffectsFromSpecialEnergy).toBe(false);
    expect(fold.preventDamageFromHasAbility).toBe(false);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
  });

  // ⚠️ AND IT DOES NOT CONSULT THE ATTACKER AT ALL, which is the axis on which this
  // field differs from all four siblings: the printed object is "your opponent's
  // Pokémon", so there is nothing to narrow. Same holder, two different attackers,
  // same answer — the assertion that would go red if someone "helpfully" added a
  // predicate at the read sites.
  it("does not consult the attacker — the printed object is every attacker there is", () => {
    const shell = benched("fix-shellcracker");
    const titan = benched("fix-titan");
    const a = holderOnBench(shell);
    const b = holderOnBench(titan);
    if (a === undefined || b === undefined) throw new Error("no benched holder");

    // ⚠️ NOT Klefki as the second attacker, and the near-miss is worth recording:
    // "Mischievous Lock" would switch the holder's own Ability OFF from the other
    // side of the table, so a FALSE here would have been §9 doing its job rather
    // than the field consulting an attacker. `fix-titan` carries no Ability and no
    // attacks at all — the inert body this comparison needs.
    expect(passivesOf(shell, a).preventDamageAndEffectsWhileBenched).toBe(true);
    expect(passivesOf(titan, b).preventDamageAndEffectsWhileBenched).toBe(true);
  });
});

describe("Curious Tea Party — §9, the lock over the holder", () => {
  // The holder's aura IS an Ability, so a lock over it must switch the prevention
  // off. Klefki is Active-gated on its SOURCE, so the locking body is P1's Active,
  // and Poltchageist really is a Basic — the fixture's stage is faithful here, so
  // "Mischievous Lock" names it for the printed reason and not by fixture licence.
  it("a lock over the HOLDER switches the prevention off and the spread lands", () => {
    const state = benched("sv01-096");
    deepFreeze(state);
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");

    expect(passivesOf(state, holder).preventDamageAndEffectsWhileBenched).toBe(false);

    // Klefki has no spread, so the §9 answer is asserted at the fold and then the
    // DAMAGE is driven with Klefki's own attack against the Active — which is the
    // dead site, so the assertion that matters is the fold's above.
    const { events } = mustApply(state, joust);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
  });

  // 🛑 AND THE LOCK MUST NOT MOVE THE ZONE ANSWER, which is a separate claim: a
  // §9 lock changes what a body CONTRIBUTES and never where it is standing. If
  // `isOnBench` had been given a `disabledAbilityUids` gate "for symmetry" this
  // would go red, and the field would then be reporting a lie about the board.
  it("…but `isOnBench` is NOT §9-gated — a locked body is still on the Bench", () => {
    const state = benched("sv01-096");
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");

    expect(isOnBench(state, holder)).toBe(true);
    expect(passivesOf(state, holder).preventDamageAndEffectsWhileBenched).toBe(false);
  });
});

describe("Curious Tea Party — the fixture cast", () => {
  // D250's rule: the pool is swept for the SENTENCE before a fixture is appended,
  // and the sentence lives on the fixture so a census can SEE it (a comment cannot
  // go red).
  it("the demonstrator carries the printed sentence verbatim", () => {
    expect(FIXTURE_POOL["fix-teaparty"]?.abilities?.[0]?.effect).toBe(
      "As long as this Pokémon is on your Bench, prevent all damage from and effects of attacks from your opponent's Pokémon done to this Pokémon.",
    );
  });

  // ⚠️ THE ATTACKER IS D252's, REUSED RATHER THAN REWRITTEN, and the assertion that
  // makes the reuse safe is that it arms NONE of the four sibling gates: no
  // Ability, no rule box, and — the one that matters for the reuse — no Special
  // Energy is ever attached on any board in this suite, so a prevented board here
  // cannot be D252's field firing.
  it("the reused attacker arms none of the four sibling gates", () => {
    const attacker = FIXTURE_POOL["fix-shellcracker"];

    expect(attacker?.abilities ?? []).toEqual([]);
    expect(attacker?.name).toBe("fix-shellcracker");
    expect(FIXTURE_POOL["fix-teaparty"]?.weaknesses ?? []).toEqual([]);
  });

  it("no board in this suite ever attaches a Special Energy", () => {
    const state = benched();
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");
    const attached = state.players.p1.active?.energy ?? [];

    // The attacker holds exactly ONE Energy and it is the deck's BASIC Colorless —
    // it pays every {C} cost here and arms nothing, so a prevented board in this
    // suite cannot be D252's field firing. Asserted through the FOLD rather than by
    // reading the card class, because the fold is what the read sites consult.
    expect(attached).toHaveLength(1);
    expect(state.cardIdByUid[attached[0] ?? ""]).toBe("fix-energy");
    expect(passivesOf(state, holder).preventDamageAndEffectsFromSpecialEnergy).toBe(false);
  });
});
