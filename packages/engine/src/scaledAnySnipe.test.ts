import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import {
  SCALED_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.349.0 → 0.350.0 — 🆕🆕🆕 **D448: A COUNT SOURCE ON THE SNIPE'S OWN AMOUNT.**
//
// *"This attack does {20|30} damage to 1 of your opponent's Pokémon **for each Energy
// attached to this Pokémon**. (Don't apply Weakness and Resistance for Benched
// Pokémon.)"* — `censusAttackCorpus.ts` lines **552** and **570**, **2 sentences / 3
// legal printings**. Claimed WHOLE by `deriveAttackEffect`'s arm 6d through ONE
// widening of the SHIPPED anchor `CHOSEN_ANY_TARGET` and ONE new optional op field,
// `damageChosen.perEnergyOnSelf`.
//
// 🛑 **THE WORK ORDER'S PREMISE DID NOT SURVIVE, AND IT IS THE MOST USEFUL THING THIS
// FILE RECORDS.** It said a `DamageCountSource` "folds into the attack's own damage in
// attack.ts's §8.5 pipeline" and that a snipe's amount cannot carry a count today, so
// this slice would be *"a fold reaching a new consumer, or a second parallel fold"*.
// **The second, parallel fold has existed since Wo-Chien "Covetous Ivy"**:
// `snipeAmount` (interpreter.ts) multiplies `damageChosen.amount` by a board fact and
// has done so at both call sites — the inline run and the resumed pick — for dozens of
// decisions. This slice gives that fold its SECOND inhabitant. It builds no fold.
//
// ⚠️ **AND THE TWO FOLDS CANNOT BE MERGED HERE, WHICH IS A COST AND NOT A PREFERENCE.**
// `scaledAttackDamage` lives in `attack.ts`, which imports `interpreter.ts` — reaching
// it from the interpreter is a cycle — and its signature takes the attack's printed
// `cost`, which `EffectContext` does not carry (`extraEnergyUnitsBeyondCost` is the
// member that needs it). So the snipe's fold speaks the OP's riders, and the price of
// collapsing those riders into one `DamageCountSource` field is written out beside
// `perEnergyOnSelf` in `effects.ts`, with the trigger that overturns the refusal.
//
// 🛑 **§8.5 IS NOT SKIPPED AND THAT IS DRIVEN RATHER THAN REASONED (§4).** The scaling
// happens in `snipeAmount` BEFORE `placeSnipe` is called, so everything downstream is
// byte-identical to the unscaled path: an Active pick still runs `snipeActive`'s full
// Weakness/Resistance/shield/§11 pipeline, and a Bench pick still stays flat. The board
// below reads 60 on the Bench and 120 on the Active FROM ONE OP ON ONE BOARD.
//
// ⚠️ **THE GROUP INDEX SHIFTED, D447's TRAP.** The printed count clause sits BETWEEN the
// noun and the period, so D437's append-after-the-parens trick is unavailable:
// `ignoreWR` moved from group 3 to group 4 and the number word from 4 to 5. §2 keeps
// Umbreon `sv03-130` and both count-2 spellings as live regression rungs, because
// neither the compiler nor a type sees a `match[n]`.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The two printed sentences, transcribed byte for byte off the committed column. */
const SCALED_20 =
  "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SCALED_30 =
  "This attack does 30 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The ONE-AXIS control: `SCALED_20` with the count clause deleted, which is the
    shipped bare any-target snipe this reader has claimed since 0.38.0. */
const PLAIN_20 =
  "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** `fix-scaledsnipe`'s attack indices, named so a board reads as a sentence. */
const IDX = { scaled20: 0, scaled30: 1, plain20: 2, bothRiders: 3 } as const;

/** Setup with BOTH Actives pinned to fix-lightning-weak (×2 Lightning, 130 HP, empty
    Bench — a deterministic {L}-weak Defender), then open P1's turn 2. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: SCALED_SNIPE_DECK, p2: SCALED_SNIPE_DECK },
    { first: "p2", active: { p1: "fix-lightning-weak", p2: "fix-lightning-weak" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `fix-scaledsnipe` carrying `energy` {L} Energy CARDS and `plain` Colorless
    ones; P2 keeps its fix-lightning-weak Active and its Bench holds exactly `benched`. */
function scaled(
  seed: number,
  opts: { energy: number; plain?: number; benched?: readonly string[] },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-scaledsnipe");
  state = attachFromDeck(state, "p1", "fix-lightning-energy", opts.energy);
  if (opts.plain !== undefined) state = attachFromDeck(state, "p1", "fix-energy", opts.plain);
  for (const body of opts.benched ?? []) state = benchFromDeck(state, "p2", body);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the population: what is claimed, measured off the committed column.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the two printed sentences, and what they cost the residue", () => {
  it("both are in the legal attack column at the printing counts this slice claims", () => {
    // ⚠️ A brief's printing count is a FLOOR until it is read off the corpus (D445).
    // Read here rather than quoted: 2 + 1 = the 3 printings every census note names.
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(SCALED_20)).toBe(2);
    expect(rows.get(SCALED_30)).toBe(1);
    // …and the one-axis control is a REAL printed sentence too, which is what makes it
    // a control rather than an invented near-miss (D183: author against printed bytes).
    // ⚠️ It is corpus line **553**, sitting immediately BELOW line 552 in the sorted
    // column: the two differ by exactly the clause this slice reads, and the diff of
    // this file therefore reads as one sentence with a rider rather than as two.
    expect(rows.get(PLAIN_20)).toBe(1);
  });

  it("all three resolve through the reader SURFACE, and the surface did not grow", () => {
    // Asked of the surface rather than of one reader — D447's correction to its own
    // first draft. The arm sits inside `deriveAttackEffect`; no fourteenth reader.
    for (const s of [SCALED_20, SCALED_30, PLAIN_20]) expect(resolvedByAnyReader(s), s).toBe(true);
  });

  it("🛑 the scaled family is CLOSED at these two, and the rest is refused BY NAME", () => {
    // The loosest plausible shape for "a chosen-target hit whose amount scales":
    // every corpus sentence carrying BOTH `for each` and `damage to `. Ten sentences.
    // 🛑 **WHAT THIS PATTERN CANNOT SEE, MEASURED RATHER THAN GUESSED — AND IT MISSES
    // ONE.** A hit spelled with COUNTERS says *"put N damage counters on"* where this
    // family says *"does N damage to"*, and the column prints exactly such a scaled
    // chosen-target hit at corpus line 412, **3 printings** — the largest single
    // printing count in the whole scaled-snipe class and invisible to the grep above.
    // It is named in (d) below. The other spelling asked for, *"times the number of"*,
    // returns ZERO rows over all 640 and is the one negative that holds.
    // ⚠️ This is D310's rule with a family in place of a catalog: **ask the census
    // twice, once with the columns widened and once with the literal shortened.**
    const family = legalAttackCorpus().filter(
      // /i on the head, because ONE member spells it "For each …" at the start of the
      // sentence — a case-sensitive `includes` reports NINE and silently drops it.
      ([, t]) => /for each/i.test(t) && t.includes("damage to "),
    );
    expect(family).toHaveLength(10);
    const unbuilt = family.filter(([, t]) => !resolvedByAnyReader(t)).map(([, t]) => t);
    // 🆕🛑 **D465 — EIGHT → SEVEN, AND THE ROW THAT LEFT WAS NEVER A MEMBER OF THIS
    // FAMILY AT ALL.** This is the SECOND thing the grep above cannot see, and it is
    // the opposite failure from the one already recorded: that block says the pattern
    // MISSES a real member (corpus line 412, spelled with counters). This one says it
    // OVER-INCLUDES a non-member — `t.includes("damage to ")` matches *"damage to
    // ITSELF"*, so corpus line 500, a RECOIL on the attacker's own body, has been
    // sitting in this "chosen-target hit" population since the rung was written.
    // ⚠️ **RE-POINTED, NOT DELETED (D418), AND NOT MERELY DECREMENTED.** A count that
    // silently steps 8 → 7 records that something left and says nothing about WHAT;
    // the two assertions below name it, pin what it derives to, and pin the ONE fact
    // that makes it a non-member — its op is `damageSelf`, not `damageChosen`, so
    // nothing about it bears on whether the scaled CHOSEN-hit family is closed.
    // ⚠️ **AND THE DISCRIMINATION IS SHARPER THAN THE COUNT IT REPLACES**: the old
    // `toHaveLength(8)` could not tell "D465 built the self-hit" from "a reader
    // widened past the count clause and ate a chosen-target row". The pair below can —
    // it goes red on the second and stays green only on the first.
    // 🆕🛑 **D489 — SEVEN → SIX, AND THE ROW THAT LEFT WAS THE ONE THIS RUNG'S FIRST
    // BULLET REFUSED ON THE REFERENT.** Re-pointed rather than decremented, on the same
    // reasoning D465 used one line up: a count that steps 7 → 6 records that something
    // left and says nothing about WHAT, and cannot tell "D489 built the hand discard"
    // from "a reader widened past the count clause and ate a chosen-target row". The
    // pair below names the row, pins the op it derives to, and keeps every other
    // refusal in this rung intact (D438: name what now owns it and keep the refusals).
    // 🆕🛑 **D505 — SIX → FIVE, AND THE ROW THAT LEFT IS THE ONE BULLET (c)
    // REFUSED ON THE OP.** Re-pointed rather than decremented, for the third time in this
    // rung and on the same reasoning: a count that steps 6 → 5 records that something left
    // and says nothing about WHAT, and cannot tell *"D505 gave `spreadDamage` the rider"*
    // from *"a reader widened past the count clause and ate a chosen-target row"*. The pair
    // under (c) names the row and pins the op and the rider it derives to.
    expect(unbuilt).toHaveLength(5);
    // (e) THE SELF-HIT THE PATTERN OVER-INCLUDES — corpus line 500, 1 printing, BUILT
    //     at D465. Not a refusal at all: it is here so the 8 → 7 step is attributable.
    const SELF_RECOIL_SCALED = "This Pokémon also does 10 damage to itself for each damage counter on it.";
    expect(family.map(([, t]) => t)).toContain(SELF_RECOIL_SCALED);
    expect(unbuilt).not.toContain(SELF_RECOIL_SCALED);
    // …and the op it derives to is the one that says it was never this family's: a
    // `damageSelf` on the ATTACKER, with no `target`, no `count` and no arity.
    expect(deriveAttackEffect(SELF_RECOIL_SCALED)).toEqual([
      { op: "damageSelf", amount: 10, perDamageCounterOnSelf: true },
    ]);
    // (a) THE DISCARD-COUNT HEAD — corpus line 138, 2 printings. **BUILT AT D489.**
    //
    //     🛑 **THE REFUSAL THIS BULLET CARRIED IS CORRECTED IN PLACE AND DATED (D442),
    //     NOT DELETED, BECAUSE IT WAS FALSE ON THE DAY IT WAS WRITTEN AND SAYING SO IS
    //     THE FINDING.** It read: *"…counts a quantity the sentence's OWN HEAD produced.
    //     That is a CROSS-CLAUSE REFERENCE, not a board fact: `snipeAmount` is handed
    //     `(op, state, ctx)` and there is no state field, no `EffectSlot` and no
    //     `EffectContext` key that carries 'how many cards the previous op moved'."*
    //     The premise is right and the conclusion does not follow (D450/D451's shape):
    //     the quantity does not have to travel through `state` or `EffectContext` at
    //     all, because the run's §9.2 `EffectRecord` already carries it and **both of
    //     `snipeAmount`'s call sites already had that record in scope** — `stepOp` takes
    //     it as a parameter and `applyChoice` takes it as a parameter. The whole channel
    //     was a fourth argument. ⚠️ **The bullet was scoped to the FUNCTION'S SIGNATURE
    //     and read as a statement about the ENGINE** — D456's rule verbatim, one file
    //     over.
    //
    //     🛑 **AND THE CLAIM IS RE-POINTED ONTO THE OP RATHER THAN ONTO
    //     `.not.toBeNull()`** (D438's polarity rule, D465's move in this same file): a
    //     bare "it now resolves" is TRUE under a reader widened to swallow the whole
    //     column, which is exactly the build the surrounding refusals exist to forbid.
    //     What discriminates is the SLOT — the rider names the address the head files.
    const HAND_SCALED_SNIPE =
      "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(family.map(([, t]) => t)).toContain(HAND_SCALED_SNIPE);
    expect(unbuilt).not.toContain(HAND_SCALED_SNIPE);
    expect(deriveAttackEffect(HAND_SCALED_SNIPE)).toEqual([
      {
        op: "payFromHand",
        count: "any",
        cap: 3,
        to: "discard",
        filter: { kind: "anyEnergy" },
        recordAs: "discarded",
      },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perRecorded: "discarded",
      },
    ]);
    // (b) THE TARGET-DEPENDENT COUNT — corpus line 551, 1 printing. *"…for each damage
    //     counter on THAT Pokémon"* counts on the body the player has not chosen yet,
    //     so the multiplier is unknown when `stepOp` builds the prompt. Every rung in
    //     §4 below rests on the opposite fact: `snipeNote` quotes the folded amount, so
    //     the caption and the damage cannot disagree. A per-TARGET amount would make
    //     `snipeAmount(op, state, ctx)` a function of a fourth argument that does not
    //     exist until `applyChoice`, and would make the prompt unable to quote itself.
    //     Refused on the ARITY OF THE FOLD, which is a different reason from (a).
    expect(unbuilt).toContain(
      "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
    // (c) THE SPREAD TWIN — corpus line 517, 3 printings, the largest unbuilt printing
    //     count in the whole bench family. **BUILT AT D505.**
    //
    //     🛑 **THE REFUSAL THIS BULLET CARRIED WAS TRUE IN ITS PREMISE AND WRONG IN ITS
    //     CONCLUSION, AND IT IS CORRECTED IN PLACE AND DATED (D442) RATHER THAN DELETED.**
    //     It read: *"Its op is `spreadDamage`, which is `{target, amount}` and carries NO
    //     scaling field at all and no park to hang one on; `perTakenPrize` and
    //     `perEnergyOnSelf` are `damageChosen` riders and do not transfer."* Every clause
    //     of that was a true description of the head it was written at. What does not
    //     follow is *"and so the row is blocked"* (D450/D451's shape, and this rung's
    //     third instance of it): a rider does not have to TRANSFER, it has to be SPELLED
    //     on the second op — and `snipeAmount` takes a STRUCTURAL parameter
    //     (`{ amount; perTakenPrize?; perEnergyOnSelf?; perRecorded? }`), so the fold
    //     accepted the widened op UNCHANGED. ⚠️ **AND "no park to hang one on" READ A
    //     PERSISTENCE FACT AS AN EXPRESSIVENESS ONE**: not parking is exactly what made
    //     the rider FREE of `MATCH_RECORD_VERSION`, not what made it impossible.
    //
    //     🛑 **RE-POINTED ONTO THE OP AND THE RIDER, NOT ONTO `.not.toBeNull()`** (D438's
    //     polarity rule, and this rung's own move at (a) and (d)): a bare *"it now
    //     resolves"* is TRUE under a reader widened to swallow the whole column. What
    //     discriminates is the RIDER — and the FLAT sibling beside it, which must NOT
    //     have gained one.
    const SPREAD_SCALED =
      "This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(family.map(([, t]) => t)).toContain(SPREAD_SCALED);
    expect(unbuilt).not.toContain(SPREAD_SCALED);
    expect(deriveAttackEffect(SPREAD_SCALED)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 10, perTakenPrize: true },
    ]);
    // …and the FLAT twin one corpus line down is UNMOVED and carries no rider, which is
    // the control that keeps the assertion above a statement about the clause rather than
    // about the anchor (D424).
    expect(
      deriveAttackEffect(
        "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 10 }]);
    // (d) THE COUNTER-SPELLED SCALED SNIPE — corpus line 412, 3 printings, the member
    //     the family grep above cannot see and the largest single printing count in
    //     the whole scaled-chosen-hit class. Its OP is this one (`damageChosen`, arity
    //     1, `opponentAny`, `deals` absent because counters are the printed unit) and
    //     its count IS a `DamageCountSource` this engine already ships
    //     (`cardsInDiscardPile` with a typed Basic Energy filter).
    //     It was refused THREE ways over at D448: (i) NO ANCHOR CLAIMS THE VERB AT ALL —
    //     the *unscaled* twin one line below it, corpus line 413, at 1 printing, was
    //     unbuilt too; (ii) the count needs a PAYLOAD no boolean rider can carry; (iii)
    //     the tail *"Then, shuffle those Energy cards into your deck."* shuffles back the
    //     very cards the count read — a second mechanism at a different seam (D442).
    //     🆕🛑 **D449 — THIS RUNG WAS BUILT TO REDDEN THE DAY THE VERB BECAME READABLE,
    //     AND IT DID: reason (i) IS SPENT.** `deriveAttackEffect` claims the unscaled
    //     twin through arm 23b. **RE-POINTED, NOT DELETED** (D418), and re-pointed onto
    //     the two reasons that survive — which is why the assertions below now say the
    //     twin is BUILT and the scaled row is not, rather than saying both are unread.
    //     ⚠️ **THE DISCRIMINATION THE OLD CLAIM PROVIDED IS KEPT AND SHARPENED**: the
    //     old pair could only say "nobody reads either"; the new pair says "the reader
    //     stops exactly at the count clause", which goes red on a reader that widened
    //     past it — a state the old assertion could not distinguish from correctness.
    //     ⚠️ **AND THE NEW EXPIRY DATE IS THE TAIL RATHER THAN THE VERB**: the head
    //     ALONE and the tail ALONE are both asserted unread here, so a slice that builds
    //     either one reddens this rung and re-asks the collapse's price.
    const COUNTER_SCALED =
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";
    const COUNTER_PLAIN = "Put 2 damage counters on 1 of your opponent's Pokémon.";
    const rows2 = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows2.get(COUNTER_SCALED)).toBe(3);
    expect(rows2.get(COUNTER_PLAIN)).toBe(1);
    expect(resolvedByAnyReader(COUNTER_SCALED)).toBe(false);
    // 🆕 D449 — was `false`; the twin is BUILT, and it derives to the op this whole
    // family would have to scale, which is what makes the refusal above a PRICE and no
    // longer a blockage.
    expect(resolvedByAnyReader(COUNTER_PLAIN)).toBe(true);
    expect(deriveAttackEffect(COUNTER_PLAIN)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
    // the two halves of the scaled row, each unread on its own — reason (iii), executable
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile.",
      ),
    ).toBeNull();
    expect(deriveAttackEffect("Then, shuffle those Energy cards into your deck.")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader, and the group shift the widening forced.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — `deriveAttackEffect` reads the count clause as one op rider", () => {
  it("reads both printed amounts as a count-1 opponentAny snipe with `perEnergyOnSelf`", () => {
    expect(deriveAttackEffect(SCALED_20)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
        perEnergyOnSelf: true,
      },
    ]);
    expect(deriveAttackEffect(SCALED_30)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
        perEnergyOnSelf: true,
      },
    ]);
  });

  it("🛑 the ONE-AXIS control: deleting the clause gives the shipped BARE op, unchanged", () => {
    // D399's rule — a near-miss proves nothing about a guard it never reaches — read
    // from the other side: this is the resolving sentence with ONE clause removed, and
    // the op it yields is byte-identical to the one this arm has returned since D400.
    // So the rider, and not the anchor or the arity or the target, is what moved.
    expect(deriveAttackEffect(PLAIN_20)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack", deals: true },
    ]);
  });

  it("🛑 the group shift did NOT lose `ignoreWR` — Umbreon and both count-2 spellings", () => {
    // ⚠️ THE REGRESSION THIS SLICE WAS MOST LIKELY TO SHIP. The count clause took group
    // 3, so the W/R tail is group 4 and the number word group 5. Nothing types a
    // `match[n]`, so these three rungs are the only thing between the widening and a
    // silently-restored Weakness on the one sentence printed to remove it.
    expect(deriveAttackEffect("This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.")).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 50,
        count: 1,
        source: "attack",
        deals: true,
        ignoreWR: true,
      },
    ]);
    // the count-2 spelling with the plural number word — group 5's agreement test
    expect(deriveAttackEffect("This attack does 30 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.")).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 30,
        count: 2,
        source: "attack",
        deals: true,
        ignoreWR: true,
      },
    ]);
    // …and the DISAGREEING spelling is still refused, which is the half a shifted index
    // would break silently in the other direction (the guard reading `undefined`).
    expect(
      deriveAttackEffect("This attack does 30 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon."),
    ).toBeNull();
  });

  it("🛑 the UNPRINTED PAIR is refused LOUDLY rather than resolved on one rider", () => {
    // The anchor structurally admits a sentence carrying BOTH the count clause and the
    // W/R tail; the legal column prints ZERO of them, so resolving one would be
    // authoring rather than reading (D190b). It falls to `ATTACK_EFFECT_SKIPPED`
    // exactly as a printed 0 and a disagreeing number word already do.
    expect(
      deriveAttackEffect("This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. This attack's damage isn't affected by Weakness or Resistance."),
    ).toBeNull();
    // …and the measurement behind that refusal, run over the whole column rather than
    // asserted: no printed sentence spells both clauses.
    const both = legalAttackCorpus().filter(
      ([, t]) =>
        t.includes("for each Energy attached to this Pokémon") &&
        t.includes("isn't affected by Weakness or Resistance"),
    );
    expect(both).toHaveLength(0);
  });

  it("the near-misses, each the resolving sentence with ONE token changed", () => {
    // Every refused string here is `SCALED_20` with a single edit, and its unflipped
    // twin is asserted to resolve in the same `it` — D400's discipline, inherited.
    const pairs: readonly (readonly [string, string, string])[] = [
      // a printed 0 amount buys nothing, the shipped guard, unmoved by the new group
      ["a printed 0 amount", SCALED_20.replace("does 20", "does 0"), SCALED_20],
      // a printed 0 arity parks nobody — the second positivity guard, also unmoved
      ["a printed 0 arity", SCALED_20.replace("to 1 of", "to 0 of"), SCALED_20],
      // the TYPED spelling is deliberately NOT admitted: zero legal printings carry it,
      // so a `(?:(.+) )?` group here would resolve a sentence nobody prints (D190b).
      [
        "a typed Energy clause",
        SCALED_20.replace("for each Energy", "for each {L} Energy"),
        SCALED_20,
      ],
      // the count clause must name THIS Pokémon; the board-wide zone is the DEFENDER
      // fold's spelling and has no printing on a chosen-target hit at all
      [
        "the board-wide zone",
        SCALED_20.replace("attached to this Pokémon", "attached to all of your Pokémon"),
        SCALED_20,
      ],
      // the clause rides the OPPONENT-side noun only; "your Pokémon" is a different
      // target the anchor has never claimed, and the clause does not smuggle it in
      [
        "an own-side target noun",
        SCALED_20.replace("your opponent's Pokémon", "your Pokémon"),
        SCALED_20,
      ],
      // the lookalike é falls off the path silently, this family's standing reason
      ["a lookalike `Pokemon`", SCALED_20.replace(/Pokémon/g, "Pokemon"), SCALED_20],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${SCALED_20}`, SCALED_20],
    ];
    for (const [why, refused, admitted] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(admitted), `ADMITTED beside ${why}`).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the widening, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — a new optional rider on a PERSISTED op, and the record version does not move", () => {
  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in both directions", () => {
    // 🛑 **WHICH OF THE TWO SITUATIONS THIS IS, ASKED RATHER THAN INHERITED.** It is NOT
    // "the type is unpersisted": `damageChosen` PARKS — this very op parks whenever the
    // opponent fields anything at all, because `opponentAny` offers the Active plus the
    // Bench and `count` is 1 — so the literal genuinely rides
    // `GameState.phase.cont.pendingOp` into a stored match record. It is the OTHER
    // situation: a WIDENING, where every value a v29 deploy could have written still
    // means exactly what it meant.
    //
    // **DIRECTION 1 — every byte string a v29 deploy could have written is unchanged.**
    // No v29 record carries this key, and its ABSENCE has one meaning before and after:
    // an unscaled hit. Driven through JSON rather than asserted on the object, because
    // the claim is about BYTES.
    const preSlice = [
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true}',
      '{"op":"damageChosen","target":"opponentBench","amount":40,"count":1,"source":"attack","deals":true,"perTakenPrize":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    expect(JSON.parse(preSlice[0] as string)).toEqual(deriveAttackEffect(PLAIN_20)?.[0]);
    // ⚠️ AND THE SIBLING RIDER IS THE ONE THAT PROVES THIS IS A WIDENING RATHER THAN A
    // RENAME. `perTakenPrize` was NOT re-spelled — the second byte string above still
    // derives from its own printed sentence — which is exactly the half D435 says is
    // not free. A collapse into one `DamageCountSource` field would have failed here.
    expect(
      deriveAttackEffect(
        "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      )?.[0],
    ).toEqual(JSON.parse(preSlice[1] as string));

    // **DIRECTION 2 — the NEW value cannot appear in any record an older deploy wrote,
    // and this deploy round-trips it byte for byte.** D125's widening test: the key's
    // presence AND its absence both still mean what the writer said, and the new value
    // is unreachable backwards.
    const fresh = deriveAttackEffect(SCALED_20)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true,"perEnergyOnSelf":true}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);

    // **DIRECTION 3 — a v29 record that LOSES the key degrades LOUDLY ENOUGH, which is
    // D421's criterion applied rather than copied.** A dropped rider makes the snipe
    // deal `amount` where the card prints `amount × N`, i.e. a strictly SMALLER number
    // that is off by a factor the board can read — not a plausible neighbouring
    // behaviour. ⚠️ It IS invisible at exactly one Energy, which is the same exposure
    // `perTakenPrize` has carried at one taken Prize since Covetous Ivy shipped; stated
    // rather than claimed away, and it is why §4 drives the fold at THREE.
    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "perEnergyOnSelf" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(PLAIN_20)?.[0]);
  });

  it("the engine version moved and the two spellings agree", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: the fold is real, and §8.5 is NOT skipped.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the amount scales, and every step the unscaled snipe honours is honoured", () => {
  it("🛑 the multiplier is the ATTACHED ENERGY COUNT — 1 → 20, 3 → 60, on one sentence", () => {
    // The lone Active is the only candidate, so the count-1 snipe auto-takes and the
    // number in DAMAGE_DEALT is the whole measurement. ×2 Lightning doubles it, so the
    // pair below reads 40 and 120 — and the RATIO is 3, which is the fold.
    const one = mustApply(scaled(1, { energy: 1 }), { type: "attack", seat: "p1", index: IDX.scaled20 });
    expect(find(one.events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 40 });
    const three = mustApply(scaled(2, { energy: 3 }), { type: "attack", seat: "p1", index: IDX.scaled20 });
    expect(find(three.events, "DAMAGE_DEALT")).toMatchObject({ base: 60, dealt: 120 });
    expect(three.state.players.p2.active?.damage).toBe(120);
    // …and the PRINTED 30 on the same board is 30 × 3 = 90, doubled to 180: a second
    // amount so the multiplication is not confusable with a hard-coded 60.
    const heavy = mustApply(scaled(3, { energy: 3 }), { type: "attack", seat: "p1", index: IDX.scaled30 });
    expect(find(heavy.events, "DAMAGE_DEALT")).toMatchObject({ base: 90, dealt: 180 });
    // 🛑 AND THE COUNT IS **CARDS, NOT A TYPE** — the printed clause is untyped and
    // `countAttachedEnergy` counts cards. TWO {L} plus ONE Colorless is still THREE, so
    // the same 60. ⚠️ On an all-{L} board this rung and the one two lines up are the
    // SAME NUMBER, which is why the deck carries a second Energy print: a build that
    // passed a TYPE — `SELF_ENERGY_MULTIPLY`'s shape, one reader over, and the nearest
    // wrong edit — would read 2 here and 3 above, and only THIS board can tell them apart.
    const mixed = mustApply(scaled(11, { energy: 2, plain: 1 }), {
      type: "attack",
      seat: "p1",
      index: IDX.scaled20,
    });
    expect(find(mixed.events, "DAMAGE_DEALT")).toMatchObject({ base: 60, dealt: 120 });
  });

  it("🛑 the CONTROL on the same body does NOT scale — index 2 stays at the printed 20", () => {
    // The one-axis control driven on a BOARD rather than only through the reader: same
    // fixture, same three Energy, same target, clause deleted → 20 × 2 = 40 and not 120.
    // Without this rung "the damage was 120" is equally consistent with a build that
    // scales every any-target snipe.
    const { events } = mustApply(scaled(4, { energy: 3 }), {
      type: "attack",
      seat: "p1",
      index: IDX.plain20,
    });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 40 });
  });

  it("🛑 §8.5 IS RUN ON THE ACTIVE PICK AND NOT ON THE BENCH PICK — one op, one board", () => {
    // The question the work order said to DRIVE rather than reason about. The SAME
    // scaled op, the SAME 60, on two bodies of the SAME card: the Active takes
    // Weakness (60 × 2 = 120) and the Benched one stays flat at 60, with `weakness`
    // and `resistance` reported null there. That is `placeSnipe`'s split — `snipeActive`
    // on the Active arm, the local flat pipeline on the Bench arm — and the scaled
    // amount reaches both, because `snipeAmount` folds BEFORE `placeSnipe` is called.
    const state = scaled(5, { energy: 3, benched: ["fix-lightning-weak"] });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: IDX.scaled20 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    // 🛑 THE CAPTION QUOTES THE FOLDED AMOUNT, not the printed one. `snipeNote` is
    // handed `snipeAmount`'s result, so a dialog can never contradict the damage it is
    // about to do — the rule that also makes the target-dependent sentence (§1) refusable.
    expect(prompt.note).toContain("60 damage each");
    expect(prompt.note).toContain("of your opponent's Pokémon");
    // the BENCH pick — flat, W/R absent by construction (§8.5)
    const benchHit = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(find(benchHit.events, "DAMAGE_DEALT")).toMatchObject({
      base: 60,
      weakness: null,
      resistance: null,
      dealt: 60,
    });
    expect(benchHit.state.players.p2.bench[0]?.damage).toBe(60);
    expect(benchHit.state.players.p2.active?.damage).toBe(0);
    // the ACTIVE pick on the SAME parked board — the full §8.5 pipeline, 60 × 2
    const activeHit = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(activeHit.events, "DAMAGE_DEALT")).toMatchObject({
      base: 60,
      weakness: { op: "multiply", amount: 2 },
      dealt: 120,
    });
    expect(activeHit.state.players.p2.bench[0]?.damage).toBe(0);
  });

  it("🛑 the fold is re-run at the PICK and agrees with the one the prompt quoted", () => {
    // `applyChoice`'s `damageChosen` arm recomputes `snipeAmount` from state rather
    // than carrying the number across the park. That is the shipped design (its own
    // comment says the count is unchanged because no KO intervenes) and this rider
    // adds a SECOND thing that could have changed — an attachment — so the claim is
    // driven: the parked prompt's caption and the resumed hit name the same 60.
    const state = scaled(6, { energy: 3, benched: ["fix-lightning-weak"] });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: IDX.scaled20 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.note).toContain("60 damage each");
    // …and the op that rode the park carries the rider, which is the persisted half
    if (parked.phase.cont === undefined) throw new Error("expected a continuation");
    expect(parked.phase.cont.pendingOp).toMatchObject({
      op: "damageChosen",
      amount: 20,
      perEnergyOnSelf: true,
    });
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 60, dealt: 60 });
  });

  it("the ATTACKER's own pre-W/R bonus still lands INSIDE the fold's result", () => {
    // Vitality Band's +10 is an effect on the ATTACKER, so `snipeActive` adds it after
    // the scale and before Weakness: (20 × 2 + 10) × 2 = 100, not (20 + 10) × 2 × 2.
    // The rung exists because "the bonus was applied to the printed amount instead of
    // the folded one" is a defect no single-Energy board can see.
    let state = scaled(7, { energy: 2 });
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    // ⚠️ the Tool is an Energy-free attachment, so the count is still 2: 20 × 2 = 40.
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: IDX.scaled20 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 40,
      bonus: 10,
      weakness: { op: "multiply", amount: 2 },
      dealt: 100,
    });
  });

  it("the UNPRINTED PAIR on the same body reaches the loud skip path, not a board", () => {
    // index 3 carries the count clause AND the W/R tail. The reader refuses it, so the
    // attack resolves with no program at all — the control that says §2's refusal is
    // the READER's and not an accident of the anchor's position in the arm list.
    const { events, state: done } = mustApply(scaled(8, { energy: 3 }), {
      type: "attack",
      seat: "p1",
      index: IDX.bothRiders,
    });
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeDefined();
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("never mutates the state it was given (purity — through the scaled active arm)", () => {
    const state = scaled(9, { energy: 3 });
    deepFreeze(state);
    expect(() =>
      applyAction(state, { type: "attack", seat: "p1", index: IDX.scaled20 }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — ZERO, and what is actually reachable.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — a zero multiplier, and the honest reachability answer", () => {
  it("🛑 the 0 doctrine is SHARED with `perTakenPrize` and is NOT a candidate question", () => {
    // ⚠️ `parkOrForce`'s doctrine (0 candidates silent, 1 forced, ≥2 park) is about
    // CANDIDATES; this is about the AMOUNT, and `damageChosen` does not use
    // `parkOrForce` at all. `stepOp`'s own answer is stronger than a silent no-op: the
    // `amount <= 0` guard sits BEFORE the park is built, so a zero-scaled snipe asks
    // NOTHING — no prompt, no dialog, no decision the player then discovers was empty.
    // `placeSnipe` guards a second time on the resumed path. This slice adds neither
    // guard; it inherits both, which is why the rider is free at this seam.
    //
    // 🛑 AND THE HONEST HALF: a zero is UNREACHABLE for these two printings, so no rung
    // here drives one and none pretends to. §8 pays an attack's cost from Energy
    // attached to the Active, so a costed attack has at least one Energy card on it
    // when its program runs; `countAttachedEnergy` counts CARDS, so the multiplier is
    // ≥ 1 by the time `snipeAmount` is asked. Writing a 0-Energy board would need a
    // free-cost printing of this sentence, which the catalog does not have — the
    // vacuous guard `conventions.md` says to leave out rather than test around.
    // What IS driven is that the minimum is 1 and that it is the printed amount:
    const { events } = mustApply(scaled(10, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: IDX.scaled20,
    });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20 });
    // …and the guard the doctrine rests on is the one Covetous Ivy already exercises
    // at zero taken Prizes, which is a REACHABLE zero and is pinned in its own suite.
    // The two riders reach the identical `amount <= 0` line; nothing here re-tests it.
    expect(
      deriveAttackEffect(
        "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      )?.[0],
    ).toMatchObject({ perTakenPrize: true });
  });
});
