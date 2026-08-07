import { describe, expect, it } from "vitest";
import { groupShieldedFromAttackEffects, passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  ATTACK_EFFECT_SHIELD_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.175.0 → 0.176.0 — BACKLOG ROW 15-E, THE ATTACK-BORNE EFFECTS-ONLY SHIELD
// (P3-M5 long tail, D260), and the whole remaining BUILDABLE residue of the
// `%prevent%` ability seam:
//
//   sv08-031 Skeledirge "Unaware"
//     "Prevent all effects of attacks used by your opponent's Pokémon done to this
//      Pokémon. (Damage is not an effect.)"
//   sv10-051 Team Rocket's Articuno "Repelling Veil"
//     "Prevent all effects of attacks used by your opponent's Pokémon done to your
//      Basic Team Rocket's Pokémon. (Existing effects are not removed. Damage is
//      not an effect.)"
//
// ── THE CENSUS, RE-DERIVED AT THIS COMMIT AND NOT TRANSCRIBED ─────────────────
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a), 2026-08-07,
// `legal_standard = 1`, GROUPED BY SENTENCE, over ALL THREE text columns via
// `json_each` (`attacks_json`, `abilities_json`, the flat `effect`),
// case-insensitively — D257's ladder discipline, now paying on its fifth
// consecutive row.
//
// RUNG 1 — `%prevent all effects of attacks%` — 3 printings on 3 sentences:
//   ability  1  sv08-031                        ← this row
//   ability  1  sv10-051                        ← this row
//   effect   1  sv05-161                        ← FALSE POSITIVE, and the sharpest
//     one this ladder has ever turned up: a SPECIAL ENERGY printing the same
//     sentence about "the Pokémon this card is attached to". It is NOT an ability
//     row, it is not row 15-E, and it stays UNBUILT — but it is now the seam's
//     ONLY buildable remainder and is written into the backlog rather than lost.
//
// RUNG 2 — `%effects of attacks%` MINUS rung 1 — 26 printings on 6 sentences, and
// every one of them is already accounted for. The false positives, named:
//   ability  3  sv08-042/-217/-237   the TERA banner — permanently UNBUILDABLE
//                                    (the "Tera" word is in NO ingested column)
//   ability  3  sv06-020/-171, sv10-048   BUILT at D253 (Curious Tea Party)
//   ability  2  sv10.5b-023/-107          BUILT at D252 (Mighty Shell)
//   ability  1  sv05-024                  BUILT at D254 (Spherical Shield)
//   attack  15  svp-213, sv05-073, …      BUILT since D142 — the DURATED §11
//   attack   2  sv10.5b-072/-149          spelling, "during your opponent's next
//                                         turn, prevent all damage from and
//                                         effects of attacks done to this Pokémon"
// 🛑 THE ATTACK COLUMN IS NON-ZERO AT THIS RUNG AND THAT IS NOT A NEW ROW — it is
// the §11 installation, and reading it as one would author 17 printings twice.
//
// RUNG 3 — `%all effects%` MINUS rung 2 — 5 printings on 2 sentences, all BUILT at
// D259 (the TRAINER-borne shield: sv06.5-045/-077, sv10-065/-210, sv07-076).
//
// ── THE SHAPE, AND IT IS D259's SPLIT FOR THE SECOND CONSECUTIVE SLICE ────────
// ONE FOLD AND ONE SCAN, settled by READING `passivesOf`'s signature rather than
// by analogy:
//
//     export function passivesOf(state: GameState, pokemon: InPlayPokemon)
//
// It folds PER BODY and takes no seat. "…done to THIS Pokémon" is the body it is
// already about, so Skeledirge is a `preventAttackEffects` flag on that fold.
// "…done to YOUR Basic Team Rocket's Pokémon" is a SET the holder is only one
// member of, which that signature cannot express at all, so Articuno is a SCAN
// (`continuous.ts groupShieldedFromAttackEffects`).
//
// ── ZERO NEW READ SITES, AND THAT IS THE ROW'S WHOLE ECONOMY ──────────────────
// Both sentences are ATTACK-borne and EFFECTS-ONLY, so both are disjuncts INSIDE
// `interpreter.ts effectRefusedOn` — the sole funnel every effect op has consulted
// since D142 and which D259 widened and renamed. `attack.ts` takes a ZERO diff,
// all four §8.5 damage arms take a ZERO diff, and the printed parenthetical
// "(Damage is not an effect.)" is the sentence saying so in print rather than an
// economy the build chose. Every "prevented" board below therefore has a BITE
// beside it that lands its full 30 — the damage half is asserted, not assumed.
//
// ── AND ZERO NEW PREDICATES ───────────────────────────────────────────────────
// "Basic Team Rocket's" is a STAGE word conjoined with an OWNER PREFIX, which is
// `matchesFilter`'s `ownerPokemon` arm exactly (`{ owner, stage }` — D200's prefix
// and D245's stage word). The program carries the filter as DATA. The Standard
// pool holds 34 Basic and 35 non-Basic "Team Rocket's" Pokémon, so the stage
// conjunct is a near-even split rather than a corner case, and `fix-tr-stage1`
// is the one new fixture this row needed to drive it.
//
// ── "(Existing effects are not removed.)" IS A REAL CLAUSE, AND IT COSTS ZERO ──
// It says the aura is a GATE at application time and never a SWEEP over installed
// conditions. `effectRefused` has been exactly that since D142, so the correct
// implementation is to write nothing — and the correct EVIDENCE is a board that
// DRIVES it: put a body Asleep with the shield absent, bring the shield up, and
// watch the Sleep survive while the next Yawn is refused. That board is below.

const BITE = 0;
const YAWN = 4;
const CLUTCH = 5;

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

/** Field P2's Active as `activeId`, wipe the bench that `setActiveFromDeck`
    displaces (D253's `clearBench` rule), bench each of `bench`, then hand the turn
    to P1 with `fix-shellcracker` Active and one {C} attached. Every board in this
    file is one call to this. */
function board(activeId: string, bench: string[] = []): GameState {
  let state = driveSetup(
    1,
    { p1: ATTACK_EFFECT_SHIELD_DECK, p2: ATTACK_EFFECT_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", activeId);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The §9 board: Klefki Active on the ATTACKING seat. "Mischievous Lock" is
    Active-gated and reaches EACH player's Basic Pokémon in play, so from across
    the table it silences both of this row's holders (both fixtures are Basics,
    which is `fix-mightyshell`'s declared divergence reused for its reason).

    ⚠️ **THE §9 CLAIM IS MADE AS A PREDICATE READ AND NOT AS AN ATTACK, AND THAT IS
    A LIMIT OF THE POOL RATHER THAN A CHOICE.** Klefki's own attack is a bare 10
    damage with no effect op on it, so the seat holding the lock cannot also fire
    `applyStatus` — `imperviousShell.test.ts`'s §9 pair has exactly this shape for
    exactly this reason. What the board does prove is the thing the fold exists
    for: a build that read `programFor(top.id)?.passive` at the funnel instead of
    going through `passivesOf`/`disabledAbilityUids` would be green everywhere else
    in this file and silently wrong here. */
function lockedFromAcross(activeId: string, bench: string[] = []): GameState {
  let state = driveSetup(
    1,
    { p1: ATTACK_EFFECT_SHIELD_DECK, p2: ATTACK_EFFECT_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", activeId);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return setActiveFromDeck(state, "p1", "sv01-096");
}

describe("Unaware / Repelling Veil — the registry data rows", () => {
  it("authors sv08-031 as a bare preventAttackEffects passive", () => {
    expect(programFor("sv08-031")?.passive).toEqual({ preventAttackEffects: true });
  });

  // ⚠️ THE FILTER IS DATA AND IT TRANSCRIBES THE PRINTED NOUN PHRASE. Both halves
  // are asserted because both are observable and only one of them existed before
  // D245: the OWNER prefix and the STAGE word.
  it("authors sv10-051 as a preventAttackEffectsForGroup carrying the printed noun phrase", () => {
    expect(programFor("sv10-051")?.passive).toEqual({
      preventAttackEffectsForGroup: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
    });
  });

  // 🛑 THE MERGE THIS ROW REFUSES, IN BOTH DIRECTIONS. One field would hand
  // Skeledirge a group aura it does not print and Articuno a self-only one — and
  // the two are not even the same SHAPE, so the merge is not expressible without
  // giving the fold a seat it does not have.
  it("keeps the two sentences on two fields — neither row carries the other's", () => {
    expect(programFor("sv08-031")?.passive?.preventAttackEffectsForGroup).toBeUndefined();
    expect(programFor("sv10-051")?.passive?.preventAttackEffects).toBeUndefined();
  });

  // ⚠️ AND NEITHER TOUCHES THE THREE NEIGHBOURING SENTENCES, which are one clause
  // away each: D252's attacker predicate, D253's zone clause, D259's channel.
  it("authors nothing on the neighbouring prevention rows", () => {
    for (const id of ["sv10.5b-023", "sv06-020", "sv05-024", "sv06.5-045", "sv07-076"]) {
      expect(programFor(id)?.passive?.preventAttackEffects, id).toBeUndefined();
      expect(programFor(id)?.passive?.preventAttackEffectsForGroup, id).toBeUndefined();
    }
  });

  // 🛑 THE DAMAGE HALF IS ABSENT FROM THE PRINT AND MUST BE ABSENT FROM THE ROW.
  // A build that reached for `preventDamageAndEffects…` here would give both cards
  // an unconditional damage immunity, which is not a subtle mis-reading.
  it("carries NO damage-half field on either row", () => {
    for (const id of ["sv08-031", "sv10-051"]) {
      expect(programFor(id)?.passive?.preventDamageAndEffectsFromSpecialEnergy, id).toBeUndefined();
      expect(programFor(id)?.passive?.preventDamageAndEffectsWhileBenched, id).toBeUndefined();
      expect(programFor(id)?.passive?.preventBenchDamageAndEffects, id).toBeUndefined();
    }
  });

  it("carries the printed sentence on both fixture demonstrators", () => {
    expect(FIXTURE_POOL["fix-unaware"]?.abilities?.[0]?.effect).toBe(
      "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
    );
    expect(FIXTURE_POOL["fix-repellingveil"]?.abilities?.[0]?.effect).toBe(
      "Prevent all effects of attacks used by your opponent's Pokémon done to your Basic Team Rocket's Pokémon. (Existing effects are not removed. Damage is not an effect.)",
    );
  });

  // ⚠️ THE FIXTURE'S NAME IS A LOAD-BEARING FIELD — it must satisfy its OWN filter,
  // because the printed card does (`sv10-051` is a Basic named "Team Rocket's
  // Articuno"). A body named `fix-repellingveil` would make self-inclusion untestable.
  it("names the group holder so it is a member of its own group", () => {
    expect(FIXTURE_POOL["fix-repellingveil"]?.name).toBe("Team Rocket's Fixicuno");
    expect(FIXTURE_POOL["fix-repellingveil"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["fix-tr-stage1"]?.stage).toBe("Stage1");
  });
});

describe("Unaware — the HOLDER rule (a passivesOf fold)", () => {
  it("folds preventAttackEffects onto the holder and onto nobody else", () => {
    const state = board("fix-unaware", ["fix-bigbody"]);
    const holder = state.players.p2.active;
    const neighbour = state.players.p2.bench[0];
    if (holder === null || neighbour === undefined) throw new Error("board not set up");

    expect(passivesOf(state, holder).preventAttackEffects).toBe(true);
    expect(passivesOf(state, neighbour).preventAttackEffects).toBe(false);
  });

  // 🛑 THE FUNNEL, AND THE POINT IS THAT IT IS ONE. Two DIFFERENT effect ops behind
  // one gate is the only arrangement that shows the refusal is a property of the
  // FUNNEL rather than of `applyStatus`.
  it("refuses an attack's applyStatus with ONE announced refusal", () => {
    const state = board("fix-unaware");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("refuses an attack's preventRetreat off the SAME gate", () => {
    const state = board("fix-unaware");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: CLUTCH });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.retreatBlocked).toBe(false);
  });

  // 🛑 "(DAMAGE IS NOT AN EFFECT.)" — THE PRINTED PARENTHETICAL, DRIVEN. This is the
  // single sharpest claim the Skeledirge half makes: a build that reached the §8.5
  // pipeline would pass every assertion above and hand the card total immunity.
  it("lets DAMAGE through in full — the printed parenthetical, on a real board", () => {
    const state = board("fix-unaware");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BITE });

    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });

  // ⚠️ NO ZONE CLAUSE IS PRINTED, so a BENCHED holder answers exactly as an Active
  // one — the opposite of D253's twin, and the difference is observable now that
  // D259's per-candidate filter can aim an effect at a benched body.
  it("answers identically from the BENCH — the sentence prints no zone clause", () => {
    const state = board("fix-bigbody", ["fix-unaware"]);
    const benched = state.players.p2.bench[0];
    if (benched === undefined) throw new Error("no benched holder");

    expect(idOf(state, benched.stack.at(-1))).toBe("fix-unaware");
    expect(passivesOf(state, benched).preventAttackEffects).toBe(true);
  });

  // §9 — the printing IS an Ability, so a lock must switch the flag off. Read
  // through the fold rather than driven as an attack, for `lockedFromAcross`'s
  // stated reason: the seat holding the lock has no effect op to fire.
  it("is silenced by an Ability lock from across the table", () => {
    const state = lockedFromAcross("fix-unaware");
    const holder = state.players.p2.active;
    if (holder === null) throw new Error("no active");

    expect(passivesOf(state, holder).preventAttackEffects).toBe(false);
  });
});

describe("Repelling Veil — the TARGET-GROUP rule (a scan, not a fold)", () => {
  // 🛑 THE CLAIM A FOLD COULD NOT MAKE: the shielded body is NOT the holder. The
  // holder stands on the bench and a plain Team Rocket's Meowth in the Active spot
  // refuses the effect.
  it("shields a group member the holder is NOT, from the bench", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  // ⚠️ SELF-INCLUSIVE, AND THE CATALOG IS THE ARGUMENT: sv10-051 is itself a Basic
  // "Team Rocket's" Pokémon, so no `scope` question is expressible.
  it("shields ITSELF — the source set contains the target set", () => {
    const state = board("fix-repellingveil");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  // 🛑 THE STAGE NEGATIVE — the cell no body in the pool could cover before this
  // slice, and the one a build that dropped `stage` from the filter would fail.
  // 35 legal printings sit in it.
  it("does NOT shield a Stage 1 Team Rocket's Pokémon", () => {
    const state = board("fix-tr-stage1", ["fix-repellingveil"]);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
  });

  // 🛑 THE PREFIX NEGATIVE — "Rival of Team Rocket's Meowth" CONTAINS the prefix and
  // does not start with it, so a naive `includes` would shield it.
  it("does NOT shield a body whose name merely CONTAINS the prefix", () => {
    const state = board("fix-not-tr-body", ["fix-repellingveil"]);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
  });

  // 🛑 THE ATTRIBUTION CONTROL: the same group member, the same attack, no holder
  // anywhere. Without this the suite could not tell "the aura fired" from "Yawn
  // never lands on this body".
  it("does NOT shield a group member with no holder in play", () => {
    const state = board("fix-tr-body");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
  });

  // 🛑 "(DAMAGE IS NOT AN EFFECT.)" ON THIS HALF TOO.
  it("lets DAMAGE through in full onto a shielded group member", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BITE });

    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });

  // §9 PER SOURCE — the lock is on the HOLDER and not on the shielded body, which
  // is the direction that matters: the target here carries no Ability at all.
  it("is silenced by an Ability lock over the SOURCE", () => {
    const state = lockedFromAcross("fix-tr-body", ["fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, target)).toBe(false);
  });
});

describe("groupShieldedFromAttackEffects — the scan itself", () => {
  // SEAT-BLIND on purpose: the caller hands us one of a side's own entries and the
  // scan DERIVES the seat, which is what keeps the funnel's signature untouched.
  it("derives the seat rather than taking one", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, target)).toBe(true);
  });

  // 🛑 THE OWN-SIDE LINE, AND IT IS THE ONE THING THE PRINTED "YOUR" BUYS. P1's
  // Active is `fix-shellcracker` and P2 holds the aura; a scan that walked both
  // sides would shield the ATTACKER's board too.
  it("never reaches across the table — the printed word is YOUR", () => {
    let state = board("fix-tr-body", ["fix-repellingveil"]);
    state = benchFromDeck(state, "p1", "fix-tr-body");
    const across = state.players.p1.bench.find(
      (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "fix-tr-body",
    );
    if (across === undefined) throw new Error("no p1 group body");

    expect(groupShieldedFromAttackEffects(state, across)).toBe(false);
  });

  // ⚠️ IDENTITY IS TOP UID AND NOT `===`: `InPlayPokemon` is rebuilt by value on
  // every damage step, so a reference compare would answer FALSE for the very body
  // the caller handed us one line after it took a hit.
  it("matches by TOP UID, so a rebuilt-by-value copy still answers TRUE", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, { ...target, damage: 10 })).toBe(true);
  });

  it("answers FALSE for a body that is not in play at all", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, { ...target, stack: [] })).toBe(false);
  });

  // 🛑 THE SOURCE LOOP REALLY ITERATES, AND A LATE HOLDER IS THE MUTANT THAT SAYS
  // SO. With three filler bodies benched ahead of it, a scan that read only the
  // Active or only `bench[0]` would answer FALSE — and would still pass every
  // other board in this file, because every one of them benches the holder first.
  it("finds a holder standing LAST on the bench, not just the first body", () => {
    const state = board("fix-tr-body", ["fix-bigbody", "fix-bigbody", "fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, target)).toBe(true);
  });
});

describe("(Existing effects are not removed.) — the printed clause, DRIVEN", () => {
  // 🛑 THE CLAUSE COSTS ZERO LINES AND THAT IS A CLAIM, NOT AN OMISSION. The aura
  // is a GATE at application time and never a SWEEP over installed conditions. So:
  // land the Sleep with no holder in play, THEN bring the holder up, and the Sleep
  // must survive while the NEXT effect is refused. A build that swept `statuses`
  // when the aura came up would pass every other test in this file.
  it("does not retroactively clear a status installed before the shield came up", () => {
    let state = board("fix-tr-body");

    // 1. No holder anywhere — the Yawn lands.
    const first = mustApply(state, { type: "attack", seat: "p1", index: YAWN });
    expect(types(first.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(first.state.players.p2.active?.conditions.rotation).toBe("asleep");

    // 2. The shield comes up on the already-Asleep body's own side.
    state = benchFromDeck(first.state, "p2", "fix-repellingveil");
    expect(state.players.p2.active?.conditions.rotation).toBe("asleep");

    // 3. …and the gate is CLOSED from here on, which is the other half of the
    //    claim: the aura installs nothing and removes nothing, it only refuses.
    const shielded = state.players.p2.active;
    if (shielded === null) throw new Error("no active");
    expect(groupShieldedFromAttackEffects(state, shielded)).toBe(true);

    // 4. …driven, on the next turn's attack: the SAME funnel now refuses, and the
    //    Sleep that was already there is untouched by the refusal.
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const second = mustApply(state, { type: "attack", seat: "p1", index: CLUTCH });

    expect(types(second.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(second.state.players.p2.active?.retreatBlocked).toBe(false);
  });
});
