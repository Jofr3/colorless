import { describe, expect, it } from "vitest";
import { passivesOf, preventedByDamageThreshold } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  IMPERVIOUS_SHELL_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.172.0 → 0.173.0 — Drednaw `sv07-044` "Impervious Shell" (P3-M5 long tail,
// D257, backlog row 15-B):
// "Prevent all damage done to this Pokémon by attacks from your opponent's
//  Pokémon if that damage is 200 or more."
//
// ✅ THE CENSUS, RE-RUN AT THIS COMMIT rather than transcribed from the handoff.
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a), all three text
// columns, `legal_standard = 1`, GROUPED BY SENTENCE, case-insensitive.
//
// RUNG 1 — `%if that damage is%`:
//   ability  1 / 1   "…if that damage is 200 or more."              ◀ THIS SLICE
//   attack   2 / 1   "…if that damage is 40 or less."               BUILT D240
//   attack   1 / 1   "…if that damage is 60 or less."               BUILT D240
//   effect   0 / 0
// RUNG 2 — `%damage is%` MINUS rung 1: **18 further sentences and every one is a
//   FALSE POSITIVE**, named rather than counted — "this attack's damage isn't
//   affected by…" (the biggest at 15 printings, then 9, 8, 6, …), the reminder
//   "(damage is not an effect.)" on three prevention printings, and Raticate's
//   "…this Pokémon's Hyper Fang attack's base damage is 240".
// RUNG 3 — (`%prevent%` ∪ `%reduce%` ∪ `%takes N less damage%`) ∧ (`%or more%` ∪
//   `%or less%` ∪ `%at least%`): returns **exactly rung 1's four rows and nothing
//   else**. There is no fifth threshold printing in the pool, in any column.
//
// ✅ AND THE PARENT ROW RE-DERIVES UNCHANGED: `%prevent all damage%` is 22 printings
// on 9 sentences in `abilities_json`, 34 on 9 in `attacks_json` (all of them the
// durated §11 spelling, D255's finding) and 1 on 1 in `c.effect`. This row is the
// last unbuilt ONE of the ability column's 22 that a build can reach — the only
// other residue is the 3-printing TERA group, permanently unbuildable because the
// banner is in NO ingested column (D252's measured reason).
//
// 🛑 THE SHAPE CALL, WRITTEN DOWN BEFORE THE BUILD AND THE EXACT MIRROR OF D256's.
// D253's line: a gate naming the HOLDER folds into `passivesOf`; a gate naming the
// ATTACKER pays a predicate call per site; a rule about a body that is NEITHER
// cannot ride the fold at all. The protected body here is "this Pokémon" — the
// holder itself — so this is the FOLD side, where D256 one slice earlier was the
// SCAN side. ⚠️ THE TWO AUDITORS ARE THE EVIDENCE AND THEY ANSWER OPPOSITELY:
// `therapeuticEnergy.test.ts`'s fold-key list owes a NINETEENTH key (D256 owed
// none) and `attackerFilter.test.ts`'s `preventBenchDamage*` sweep owes NOTHING
// (D256 owed a third line). A shape claim that both auditors confirm is measured.
//
// 🛑 THE FIRST GATE IN THIS FAMILY WHOSE SUBJECT IS THE **NUMBER**. Its seven
// predecessors narrow by a fact about a CARD (a suffix, a type, an Ability, a
// class), about the BOARD (an attachment) or about a ZONE. This one narrows by the
// arithmetic of §8.5 itself — which is why the interesting cases below are not
// "which body" but "which number", and why D240's `wouldDeal` hoist is the whole
// reason the read sites cost four one-line disjuncts.
//
// 🛑 WHICH NUMBER — D240's RULING, RE-STATED AND DRIVEN RATHER THAN RE-DECIDED.
// "That damage" is the damage that would ACTUALLY be placed: post-Weakness,
// post-Resistance, post-reduction, floored at 0. Two boards below turn that from a
// comment into a case, in OPPOSITE directions:
//   • a printed 110 into a ×2 Weakness is 220 and IS prevented — so the threshold
//     is not read against the printed number;
//   • a printed 200 into a −30 Rock Chestplate is 170 and is NOT prevented — so it
//     is not read against the post-W/R number either.
// A build that compared against `amount`, or against `afterWR`, passes one of those
// two boards and fails the other. Neither can be dropped.
//
// 🛑 THE FOUR READ SITES, AND THEY ARE ALL LIVE — A FIRST FOR THIS RUN AND FOR A
// REASON READ OFF THE PRINT RATHER THAN OFF THE ENGINE:
//   • attack.ts main hit          — LIVE (the holder Active)
//   • interpreter.ts spread       — LIVE (the holder benched)
//   • interpreter.ts placeSnipe   — LIVE (bench pick), the `ignoreWR` site
//   • interpreter.ts snipeActive  — LIVE (active pick)
// "Prevent all damage done to THIS Pokémon" names NO zone, so unlike D253, D254 and
// D256 nothing here is dead by construction. `attackEffectRefused` is NOT a read
// site: the sentence has no effects half AND an EFFECT has no damage for a
// threshold to be about (D240's ruling for the installed twin, verbatim). Driven.
//
// ⚠️ FIXTURE DIVERGENCE, RECORDED: `fix-imperviousshell` is 340 HP and `{F}` where
// Drednaw is 140 HP and `{W}`. The HP is `fix-titan`'s number, because the
// sub-threshold arms LAND by design and a 190-damage hit would KO a faithful body
// and stop the file. The TYPE is load-bearing rather than cosmetic: Rock
// Chestplate `sv01-192` gates its −30 on the HOLDER's `{F}`, and that Tool is the
// only printed card in the pool that can drive the post-reduction half of D240's
// ruling on this seam. Nothing this aura reads consults either field.

const crush = { type: "attack", seat: "p1", index: 0 } as const; // 200 — AT the threshold
const nip = { type: "attack", seat: "p1", index: 1 } as const; // 190 — one step below
const tap = { type: "attack", seat: "p1", index: 2 } as const; // 110 — below, 220 after ×2
const bigSpread = { type: "attack", seat: "p1", index: 3 } as const; // 30 + 200 to each bench
const smallSpread = { type: "attack", seat: "p1", index: 4 } as const; // 30 + 20 to each bench
const yawn = { type: "attack", seat: "p1", index: 7 } as const; // Asleep — an effect op

const BOULDER_TOSS = 5; // 200 to 1 of your opponent's Pokémon
const SNEAK_BOULDER = 6; // 200 to 1, `ignoreWR` — the Feint Attack clause

const SENTENCE =
  "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon if that damage is 200 or more.";

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function cardIdAt(state: GameState, p: { stack: string[] }): string | undefined {
  return idOf(state, p.stack.at(-1));
}

/** Find a P2 body on the BENCH by card id. Setup auto-benches the dominant
    `fix-bigbody`, so nothing here may assume `bench[0]` (D252's helper, re-keyed
    for the fifth time). */
function onBench(state: GameState, cardId: string) {
  return state.players.p2.bench.find((p) => cardIdAt(state, p) === cardId);
}

/** THE PRIMARY BOARD: the holder in P2's ACTIVE spot, with the no-Ability control
    (`fix-titan`, also 340 HP) on the Bench beside it.

    🛑 THE CONTROL IS THE POINT OF THE SECOND BODY. Every "prevented" assertion in
    this file has a body one square away that takes the identical number from the
    identical declaration and is NOT shielded — so a green here cannot mean "the
    attack did nothing", which is the failure mode a threshold gate is most prone
    to (200 is a big number, and a board that silently refused the declaration would
    look exactly like a successful prevention). */
function holderActive(holderId = "fix-imperviousshell"): GameState {
  let state = driveSetup(
    1,
    { p1: IMPERVIOUS_SHELL_DECK, p2: IMPERVIOUS_SHELL_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", holderId);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** THE SECOND BOARD: the holder on P2's BENCH under a plain Active, with the
    no-Ability control benched beside it.

    The printed sentence carries NO zone clause, so this must answer exactly as
    `holderActive` does — which is what makes the spread and bench-snipe arms LIVE
    and separates this row from D253/D254/D256, all three of which print one. */
function holderBenched(holderId = "fix-imperviousshell"): GameState {
  let state = driveSetup(
    1,
    { p1: IMPERVIOUS_SHELL_DECK, p2: IMPERVIOUS_SHELL_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", holderId);
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Declare a chosen-target attack and resolve the prompt onto the P2 body whose
    card id is `cardId` (or onto the Active). An `opponentAny` snipe with more than
    one candidate PARKS in `effect:choose` — the two-step is the shape, not an
    accident of this board (D251's helper, reused for the seventh slice running). */
function snipeAt(state: GameState, index: number, spot: "active" | string) {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find((c) => {
          if (c.spot.spot !== "bench") return false;
          const body = parked.players.p2.bench[c.spot.index];
          return body !== undefined && cardIdAt(parked, body) === spot;
        });
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("Impervious Shell — the registry data row", () => {
  it("authors the printing as a bare preventDamageAtOrAbove passive", () => {
    expect(programFor("sv07-044")?.passive).toEqual({ preventDamageAtOrAbove: 200 });
  });

  // 🛑 THE NUMBER IS THE PRINTED ONE, ASSERTED AS A NUMBER AND NOT AS A TRUTH. A
  // boolean field would have made this row look identical to its six predecessors
  // and would have thrown the value away; this is the assertion that says the value
  // survived authoring at all.
  it("stores the printed 200 as a NUMBER, not a flag", () => {
    expect(programFor("sv07-044")?.passive?.preventDamageAtOrAbove).toBe(200);
    expect(typeof programFor("sv07-044")?.passive?.preventDamageAtOrAbove).toBe("number");
  });

  // A claim about `BUILT.attack`, not a detail: Drednaw's printed "Hard Crunch"
  // belongs to the seven text readers, and authoring a row here would move a column
  // this slice reports UNCHANGED for the twelfth time running.
  it("authors NO attack program on the printing", () => {
    expect(programFor("sv07-044")?.attack).toBeUndefined();
  });

  // A SINGLETON — one printed id, no reprint. Asserted so a future ingest that adds
  // one is noticed here rather than silently diverging from the count.
  it("is the ONLY catalog id carrying the field", () => {
    expect(programFor("sv10-010")?.passive?.preventDamageAtOrAbove).toBeUndefined();
    expect(programFor("sv05-024")?.passive?.preventDamageAtOrAbove).toBeUndefined();
    expect(programFor("sv08.5-040")?.passive?.preventDamageAtOrAbove).toBeUndefined();
    expect(programFor("sv02-097")?.passive?.preventDamageAtOrAbove).toBeUndefined();
  });

  // 🛑 THE MERGE THIS FIELD REFUSES, AND IT IS THE ONE D240 ARGUED FROM THE OTHER
  // SIDE. `AttackBlock.maxDamage` is the SAME clause in the opposite polarity — and
  // it is a §11 INSTALLATION with a turn's life written onto the target's own
  // record, where this is a catalog AURA with none. Two CHANNELS, not two tokens.
  it("does NOT ride the installed AttackBlock — the channels are separate", () => {
    for (const id of ["sv10.5w-046", "sv10.5w-127", "sv09-002"]) {
      expect(programFor(id)?.passive?.preventDamageAtOrAbove, id).toBeUndefined();
    }
  });

  // D145's move: discover the fixture demonstrators from the registry rather than
  // naming them, so a third fixture added without a case fails HERE.
  it("has exactly TWO fixture demonstrators in the pool", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageAtOrAbove !== undefined,
    );
    expect(holders).toEqual(["fix-imperviousshell", "fix-imperviousweak"]);
    expect(programFor("fix-imperviousshell")).toBe(programFor("sv07-044"));
    expect(programFor("fix-imperviousweak")).toBe(programFor("sv07-044"));
  });

  // ⚠️ AND THE TWO DEMONSTRATORS DIFFER IN EXACTLY ONE PRINTED FIELD, which is the
  // premise the post-W/R board rests on. If a future edit gave them different HP or
  // different types, the ×2 case would stop being a controlled comparison and would
  // still pass.
  it("the two demonstrators differ ONLY in Weakness", () => {
    const plain = FIXTURE_POOL["fix-imperviousshell"];
    const weak = FIXTURE_POOL["fix-imperviousweak"];
    expect(plain?.hp).toBe(weak?.hp);
    expect(plain?.types).toEqual(weak?.types);
    expect(plain?.weaknesses ?? null).toBeNull();
    expect(weak?.weaknesses).toEqual([{ type: "Grass", value: "×2" }]);
  });

  // The printed bytes, so an arm written from a paraphrase cannot pass (D183).
  it("the demonstrator carries the PRINTED sentence", () => {
    expect(FIXTURE_POOL["fix-imperviousshell"]?.abilities?.[0]?.effect).toBe(SENTENCE);
    expect(FIXTURE_POOL["fix-imperviousweak"]?.abilities?.[0]?.effect).toBe(SENTENCE);
  });
});

describe("preventedByDamageThreshold — the predicate, and it is INCLUSIVE", () => {
  // 🛑 THE BOUNDARY IS THE PRINTED WORD. "200 or more" — so exactly 200 is
  // prevented and 199 is not. The two assertions one apart are the whole content of
  // the comparator, and they are what a `>` mutant dies on.
  it("is `>=`: exactly the threshold is prevented, one below is not", () => {
    expect(preventedByDamageThreshold(200, 200)).toBe(true);
    expect(preventedByDamageThreshold(200, 199)).toBe(false);
    expect(preventedByDamageThreshold(200, 201)).toBe(true);
  });

  // ⚠️ AN ABSENT THRESHOLD SHIELDS NOTHING, and this is why the fold stores
  // `undefined` rather than `Infinity`: a sentinel would be one arithmetic slip
  // away from shielding a body with no such Ability at all.
  it("an ABSENT threshold shields nothing, at any damage including 0", () => {
    expect(preventedByDamageThreshold(undefined, 0)).toBe(false);
    expect(preventedByDamageThreshold(undefined, 999)).toBe(false);
  });

  // A zero-damage hit against a real threshold: the direction that would go wrong
  // if the comparison were ever inverted.
  it("zero damage never trips a positive threshold", () => {
    expect(preventedByDamageThreshold(200, 0)).toBe(false);
  });
});

describe("passivesOf — the fold, and it is a NUMBER rather than a flag", () => {
  it("reports the holder's printed threshold and undefined for a body without one", () => {
    const state = holderActive();
    const active = state.players.p2.active;
    const titan = onBench(state, "fix-titan");
    if (active === null || titan === undefined) throw new Error("board");
    expect(passivesOf(state, active).preventDamageAtOrAbove).toBe(200);
    expect(passivesOf(state, titan).preventDamageAtOrAbove).toBeUndefined();
  });

  // 🛑 §9 — THE WHOLE REASON THE FIELD RIDES THIS FOLD RATHER THAN BEING READ OFF
  // THE TOP CARD AT FOUR SITES. The printing IS a Pokémon Ability, so Klefki's
  // "Mischievous Lock" from ACROSS THE TABLE must switch it off — and the shortest
  // possible build (`programFor(top.id)?.passive` at each damage site) would be
  // green everywhere else in this file and silently wrong here.
  it("a §9 Ability lock SILENCES it — read through the fold, not off the card", () => {
    let state = holderActive();
    state = setActiveFromDeck(state, "p1", "sv01-096");
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(passivesOf(state, active).preventDamageAtOrAbove).toBeUndefined();
  });

  // …and the lock reaches the DAMAGE too, not only the fold. The pair is what makes
  // the §9 claim a behaviour rather than a property read.
  it("…and the 200 then LANDS", () => {
    let state = holderActive();
    state = setActiveFromDeck(state, "p1", "sv01-096");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p2.active?.damage).toBe(10); // Klefki's own Joust, not Crush
  });
});

describe("attack.ts main hit — the FIRST read site, and the boundary", () => {
  it("a 200-damage hit on the Active holder is PREVENTED", () => {
    const state = holderActive();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, crush);
    expect(done.players.p2.active?.damage).toBe(0);
    // ⚠️ A PREVENTED HIT STILL EMITS `DAMAGE_DEALT`, WITH `prevented: true` AND A
    // ZERO — assert the FLAG, not the event count, or a board that refused the
    // declaration outright would read identically.
    const dealt = events.find((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ prevented: true, dealt: 0 });
  });

  // 🛑 THE ATTRIBUTION CONTROL, AND IT IS ONE SQUARE AWAY ON THE SAME BOARD. The
  // no-Ability body takes the identical 200 from the identical attack — so the
  // green above is the Ability's doing and not the attack failing to resolve.
  it("…and the SAME 200 lands in full on the no-Ability control", () => {
    const state = holderActive("fix-titan");
    const { state: done } = mustApply(state, crush);
    expect(done.players.p2.active?.damage).toBe(200);
  });

  // The step BELOW the threshold, on the same body, from the same attacker.
  it("a 190-damage hit LANDS — the gate is a threshold, not a blanket", () => {
    const state = holderActive();
    const { state: done, events } = mustApply(state, nip);
    expect(done.players.p2.active?.damage).toBe(190);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")?.prevented ?? false).toBe(false);
  });
});

describe("🛑 WHICH NUMBER — D240's ruling, driven in BOTH directions", () => {
  // 🛑 POST-WEAKNESS. The attack prints 110, which is below the threshold; the
  // holder's ×2 Weakness makes the placed number 220, which is not. A build that
  // compared the threshold against the attack's PRINTED damage passes every other
  // board in this file and fails here.
  it("a printed 110 doubled to 220 by Weakness IS prevented", () => {
    const state = holderActive("fix-imperviousweak");
    const { state: done, events } = mustApply(state, tap);
    expect(done.players.p2.active?.damage).toBe(0);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ prevented: true });
  });

  // …and the control for it: the SAME 110, the SAME attacker, a holder with no
  // Weakness. 110 < 200, so it lands — which is what makes the board above a
  // statement about the multiplier rather than about the number 110.
  it("…and the same 110 on the un-Weak holder LANDS", () => {
    const state = holderActive();
    const { state: done } = mustApply(state, tap);
    expect(done.players.p2.active?.damage).toBe(110);
  });

  // 🛑 POST-REDUCTION, the other direction and the harder half. Rock Chestplate is a
  // printed {F}-gated −30 Tool, so a 200 hit places 170 — below the threshold — and
  // LANDS. A build that compared against the post-W/R number before reduction would
  // pass the Weakness board above and fail here, which is why neither can be
  // dropped: together they pin the number to exactly `wouldDeal`.
  it("a printed 200 reduced to 170 by Rock Chestplate is NOT prevented", () => {
    let state = holderActive();
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const { state: done, events } = mustApply(state, crush);
    expect(done.players.p2.active?.damage).toBe(170);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")?.prevented ?? false).toBe(false);
  });

  // ⚠️ THE PREMISE THE BOARD ABOVE RESTS ON, PINNED: the Tool's gate really is the
  // holder's `{F}`, and the holder really is `{F}`. If either drifted, the case
  // above would become "a 200 hit lands on a 200-threshold holder" — a FALSE
  // assertion passing for a true one.
  it("…and the reduction is really the Tool's, on a type it really accepts", () => {
    expect(programFor("sv01-192")?.passive?.damageReductionAfterWRIfType).toEqual({
      amount: 30,
      type: "Fighting",
    });
    expect(FIXTURE_POOL["fix-imperviousshell"]?.types).toEqual(["Fighting"]);
    let state = holderActive();
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(30);
  });
});

describe("interpreter.ts — the spread arm, the SECOND read site", () => {
  // The sentence prints no zone clause, so a BENCHED holder is shielded exactly as
  // an Active one is. This is the arm that separates this row from D253's, whose
  // holder gate is the reverse.
  it("a 200-per-body spread is nulled on the benched holder and lands on the control", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, bigSpread);
    expect(onBench(done, "fix-imperviousshell")?.damage).toBe(0);
    // 🛑 the SAME splash, the SAME bench, one square over.
    expect(onBench(done, "fix-titan")?.damage).toBe(200);
    expect(done.players.p2.active?.damage).toBe(30);
    const dealt = events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt.filter((e) => e.type === "DAMAGE_DEALT" && e.prevented === true)).toHaveLength(1);
  });

  // 🛑 THE SITE WHERE THE THRESHOLD IS HARDEST TO TRIP, AND THEREFORE THE ONE THAT
  // PROVES IT IS READ PER TARGET. A spread's per-body number is 20; the attack's own
  // printed damage is 30; neither is near 200. A build that compared the threshold
  // against the ACTIVE's number, or against the attack's printed damage, would
  // shield this bench.
  it("a 20-per-body spread is NOT prevented on the same holder", () => {
    const state = holderBenched();
    const { state: done } = mustApply(state, smallSpread);
    expect(onBench(done, "fix-imperviousshell")?.damage).toBe(20);
    expect(onBench(done, "fix-titan")?.damage).toBe(20);
  });
});

describe("interpreter.ts — the two snipe arms, the THIRD and FOURTH read sites", () => {
  it("placeSnipe onto the BENCHED holder: 200 is prevented, the control takes it", () => {
    const state = holderBenched();
    const { state: shielded } = snipeAt(state, BOULDER_TOSS, "fix-imperviousshell");
    expect(onBench(shielded, "fix-imperviousshell")?.damage).toBe(0);
    const { state: hit } = snipeAt(state, BOULDER_TOSS, "fix-titan");
    expect(onBench(hit, "fix-titan")?.damage).toBe(200);
  });

  it("snipeActive onto the ACTIVE holder: 200 is prevented", () => {
    const state = holderActive();
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "active");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ prevented: true });
  });

  it("…and the same snipe onto the no-Ability Active lands in full", () => {
    const state = holderActive("fix-titan");
    const { state: done } = snipeAt(state, BOULDER_TOSS, "active");
    expect(done.players.p2.active?.damage).toBe(200);
  });
});

describe("🛑 `ignoreWR` — Feint Attack's clause, and it NULLS this prevention", () => {
  // The prevention is a catalog aura ON the damaged Pokémon, so "not affected by any
  // effects on that Pokémon" reaches it exactly as it reaches the reduction passive
  // — D159's grouping, applied to the seventh member of the family.
  it("a 200 that ignores effects on the target LANDS on the Active holder", () => {
    const state = holderActive();
    const { state: done, events } = snipeAt(state, SNEAK_BOULDER, "active");
    expect(done.players.p2.active?.damage).toBe(200);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")?.prevented ?? false).toBe(false);
  });

  it("…and on the BENCHED holder too", () => {
    const state = holderBenched();
    const { state: done } = snipeAt(state, SNEAK_BOULDER, "fix-imperviousshell");
    expect(onBench(done, "fix-imperviousshell")?.damage).toBe(200);
  });

  // 🛑 AND HERE IS THE PART NO OTHER MEMBER OF THIS FAMILY CAN SHOW: `ignoreWR`
  // changes WHICH NUMBER the threshold would be read against, not only whether it is
  // read. On the ×2-Weak holder a Feint-Attack 200 is still 200 (Weakness is
  // ignored), where the ordinary snipe would have been 400. Both are ≥ 200 so the
  // damage is the same either way — the assertion is that the pipeline really did
  // drop the multiplier, which is what makes the reading load-bearing rather than
  // decorative.
  it("ignoreWR drops the Weakness too — 200 lands, not 400", () => {
    const state = holderActive("fix-imperviousweak");
    const { state: done } = snipeAt(state, SNEAK_BOULDER, "active");
    expect(done.players.p2.active?.damage).toBe(200);
  });
});

describe("attackEffectRefused — the gate this field is deliberately NOT on", () => {
  // 🛑 D240's RULING, INHERITED AND DRIVEN. An EFFECT has no damage for a threshold
  // to be about, and the printed sentence has no effects half either — two
  // independent reasons for the same ZERO. So Yawn must still put the holder to
  // sleep, on the very board where a 200 hit is prevented.
  it("the holder is still put to Sleep — a threshold refuses no effect", () => {
    const state = holderActive();
    const { state: done, events } = mustApply(state, yawn);
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
    expect(types(events)).toContain("STATUS_APPLIED");
  });

  // …asserted beside the damage answer on the SAME board, because the pair is the
  // discriminator: one gate says TRUE and the other says FALSE off one field.
  it("…on the same board where the 200 is prevented", () => {
    const state = holderActive();
    expect(mustApply(state, crush).state.players.p2.active?.damage).toBe(0);
    expect(mustApply(state, yawn).state.players.p2.active?.conditions.rotation).toBe("asleep");
  });
});

describe("the fold is a Math.min — declared, and its WRITE SITES are the argument", () => {
  // ⚠️ NO BOARD THIS CATALOG CAN BUILD GIVES ONE BODY TWO WRITERS OF THIS FIELD:
  // one printed id, and no Tool or Energy in the registry writes it. So the min is
  // UNREACHABLE and is declared here and in the corpus (`D257-threshold-fold-max`)
  // rather than faked with a fixture no printing justifies — D130's precedent and
  // D255's lesson, applied before the harness had to teach it again. THIS ASSERTION
  // IS THE PIN: if it ever fails, a second writer has landed and the fold's
  // direction needs re-reading.
  it("no Tool or Energy in the registry writes the field, so the min cannot be driven", () => {
    const writers = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageAtOrAbove !== undefined,
    );
    for (const id of writers) {
      expect(FIXTURE_POOL[id]?.category, id).toBe("Pokemon");
    }
    expect(programFor("sv07-044")?.passive?.preventDamageAtOrAbove).toBe(200);
  });
});
