import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import {
  ATTACK_LOCK_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  types,
} from "./testFixtures";

// 0.91.0 → 0.92.0 — the SELF-LOCK (P3-M5 long tail, D143):
//
//   "During your next turn, this Pokémon can't attack."                (20 printings)
//   "Put {N} damage counters on 1 of your opponent's Pokémon.
//    During your next turn, this Pokémon can't attack."                ( 2 printings)
//
// Taken as item 1 of D142's remainder list, which priced it at TWO printings. The
// census run for THIS question (rather than read off D142's duration table) found
// the bare sentence is the SAME sentence on TWENTY more, so the slice is 22 and
// not 2 — D142's own rule that a census run for one purpose is a floor for every
// other, applied to D142's own census.
//
// Four things it turns on:
//
//   • THE STAMP IS `state.turn + 2`, and that is the whole slice. D142's block
//     prints "during your OPPONENT's next turn" and stamps + 1; this prints
//     "during YOUR next turn". Declaring an attack ends the turn (§5.3), so the
//     holder's next turn is two away — and a + 1 stamp would be live only on a
//     turn its holder could not act on anyway, silently deleting the drawback the
//     card is balanced around. Every window case below is DRIVEN across real turn
//     boundaries rather than asserted off the field;
//   • it is a SECOND stamped field on `InPlayPokemon`, not a widening of the
//     first, because the two windows are different NUMBERS on the same body — and
//     a case installs both on one Pokémon to show it;
//   • it gates a DECLARATION, so the refusal is an `ATTACK_PREVENTED` rejection
//     (§12's Asleep gate, not §12's Confusion flip) and there is no event to
//     emit; the HUD projection has to agree with the gate, or a locked player
//     gets a button the server will refuse;
//   • its §10 early clears are D142's with the REACHABILITY INVERTED. That block's
//     window is the opponent's turn, so its evolve clear was unreachable by
//     construction; this window is the HOLDER's own, so retreating out and
//     evolving are both LINES OF PLAY — and both are driven as such.

const BARE_TEXT = "During your next turn, this Pokémon can't attack.";
const COMPOUND_TEXT =
  "Put 9 damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon can't attack.";
/** The compound's first sentence ALONE.
    🛑🛑 **D449 — THE DOC BLOCK HERE WAS FALSE AND THE ASSERTION BELOW HAS BEEN
    RE-POINTED.** It read: *"Printed nowhere in the pool as an attack (every other
    printing of that noun phrase is an Ability), which is why there is no bare any-zone
    anchor and why this must stay null."* The first clause was measured on the LOCAL D1
    (978 cards / 6 sets, D143); on `legal_standard = 1` the sentence is printed as an
    attack at **1 legal printing** (`censusAttackCorpus.ts` line 413) and has been since
    the column was committed. D449 built the bare anchor (`COUNTER_PUT_ON_OPPONENT_ANY`,
    arm 23b), so this string now DERIVES — to the compound's FIRST OP and nothing else.
    ⚠️ **THE CLAIM THIS CONSTANT CARRIES IS UNCHANGED AND IS STILL THE ONE THAT MATTERS**
    (D418's second half — after re-pointing, ask what the old claim could catch that the
    new one cannot): the point was never *"nothing reads this string"*, it was *"arm 25
    is not a PREFIX MATCH"*. A prefix reader would place the counters and silently drop
    the drawback, and the assertion below now says exactly that — one op here, TWO there
    — which goes red on a prefix reader where a bare `toBeNull` no longer could. */
const PUT_HALF_ONLY = "Put 9 damage counters on 1 of your opponent's Pokémon.";

/** Ninetales' 9 counters in HP (§12 — one counter = 10). */
const NINE_COUNTERS_HP = 90;

/** ONE seed for the whole suite. Neither printed sentence flips a coin, so there
    is nothing to sweep for and no seed table to pin — the determinism claim is
    made directly instead, by an unchanged `rngState` across a whole
    park-and-resolve (below). The value is arbitrary; the board it produces is
    asserted rather than assumed by `armed`. */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. P2's
    Active is fix-titan (340 HP, NO attacks) unless a case replaces it, so the
    installer's printed damage cannot end the turn on a Knock Out and derail a
    window assertion. `installer` goes on P1's Active with exactly the Energy its
    INDEX-1 attack costs — both cards print the mapped sentence at index 1. */
function armed(installer: "sv01-048" | "sv03-029"): GameState {
  let state = must(
    applyAction(driveSetup(SEED, { p1: ATTACK_LOCK_DECK, p2: ATTACK_LOCK_DECK }, { first: "p2" }), {
      type: "endTurn",
      seat: "p2",
    }),
  );
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = setActiveFromDeck(state, "p1", installer);
  // The displaced setup Active is now on P1's bench, which is what the retreat
  // and switch cases need — asserted, because a bench-less board would make three
  // of them vacuous.
  if (state.players.p1.bench.length === 0) throw new Error("armed() left P1 with no bench");
  if (state.turn !== 2) throw new Error(`armed() expected turn 2, got ${state.turn}`);
  state =
    installer === "sv01-048"
      ? attachFromDeck(attachFromDeck(state, "p1", "fix-water-energy", 2), "p1", "fix-energy", 1)
      : attachFromDeck(state, "p1", "fix-fire-energy", 2);
  return state;
}

/** `armed`, then the install declared and (for the compound) its pick resolved —
    the board every window case starts from. Asserts the lock actually landed
    rather than trusting the sentence, so a deriver regression can never leave a
    case asserting "nothing was refused" against a board that never locked
    anything. Returns P2's turn 3. */
function installed(installer: "sv01-048" | "sv03-029"): GameState {
  const { state, events } = mustApply(armed(installer), { type: "attack", seat: "p1", index: 1 });
  let next = state;
  let rows = events;
  if (next.phase.kind === "effect:choose") {
    const resolved = mustApply(next, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    next = resolved.state;
    rows = [...rows, ...resolved.events];
  }
  if (find(rows, "ATTACK_LOCKED") === undefined) {
    throw new Error(`${installer} installed no lock`);
  }
  if (next.turn !== 3) throw new Error(`expected P2's turn 3, got ${next.turn}`);
  return next;
}

/** Hand the turn back to P1 — the LOCKED turn, `state.turn + 2` from the install. */
function heldTurn(state: GameState): GameState {
  const next = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (next.turn !== 4) throw new Error(`expected the holder's turn 4, got ${next.turn}`);
  return next;
}

/** The engine's rejection code for an action, or `"ok"`. */
function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

describe("the self-lock — derived, not authored", () => {
  it("derives the BARE sentence to a bare `preventAttack`", () => {
    expect(deriveAttackEffect(BARE_TEXT)).toEqual([{ op: "preventAttack" }]);
    // No fields at all (D138's shape): every token that varies among the
    // neighbouring sentences is FIXED here — the window is the printed words
    // "your next turn", the holder is the printed words "this Pokémon" — so
    // `toEqual` alone would not catch a stray key. Assert the key set.
    const op = (deriveAttackEffect(BARE_TEXT) as EffectOp[])[0] as object;
    expect(Object.keys(op)).toEqual(["op"]);
    // The typographic apostrophe derives identically — a re-ingest that changes
    // only punctuation must not silently un-simulate TWENTY printings (D136/D137),
    // and here the exposed slot is a CONTRACTION rather than a possessive, which
    // is exactly the slot D137 found two whole tables missing.
    expect(deriveAttackEffect(BARE_TEXT.replace(/'/g, "’"))).toEqual([{ op: "preventAttack" }]);
  });

  it("derives the COMPOUND to TWO ops in PRINTED ORDER", () => {
    expect(deriveAttackEffect(COMPOUND_TEXT)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: NINE_COUNTERS_HP,
        count: 1,
        source: "attack",
      },
      { op: "preventAttack" },
    ]);
    // THREE apostrophe slots on one sentence — a possessive and two contractions —
    // and the D137 hazard (classing one and not the others) would leave this
    // deriving under a re-ingest while the bare sentence stopped. Equality with
    // the straight form, never merely non-null (D136's shape).
    expect(deriveAttackEffect(COMPOUND_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(COMPOUND_TEXT),
    );
  });

  it("the compound's SECOND op is byte-identical to the bare sentence's only op", () => {
    // The two-sentences-one-anchor claim, asserted rather than argued: the
    // compound is not a separate reading of the lock, it is the SAME rider printed
    // behind another action. If the two ever diverge, one of the two anchors has
    // grown a meaning the other has not.
    const compound = deriveAttackEffect(COMPOUND_TEXT) as EffectOp[];
    expect(compound[1]).toEqual((deriveAttackEffect(BARE_TEXT) as EffectOp[])[0]);
  });

  it("reads the compound's FIRST SENTENCE alone as ONE op — the anchor is not a prefix", () => {
    // The whole safety property of this family is that an unrecognised remainder
    // stays LOUD. A reader that matched sentence one as a prefix would place the
    // counters and silently drop the drawback, which is strictly worse than not
    // reading the card: it would ship an attack the catalog does not print.
    // 🆕🛑 **D449 — THIS WAS `toBeNull` UNTIL THE BARE ANCHOR EXISTED.** The bare
    // sentence is a real legal printing and is now claimed by arm 23b, so nullity
    // stopped being the true statement. The DISCRIMINATION is preserved rather than
    // dropped: the bare string yields ONE op, the compound yields TWO, and the first of
    // the two is byte-identical to the bare one — which is precisely what a prefix
    // reader would break, and precisely what a `toBeNull` could no longer detect.
    expect(deriveAttackEffect(PUT_HALF_ONLY)).toHaveLength(1);
    expect(deriveAttackEffect(COMPOUND_TEXT)).toHaveLength(2);
    expect((deriveAttackEffect(PUT_HALF_ONLY) as EffectOp[])[0]).toEqual(
      (deriveAttackEffect(COMPOUND_TEXT) as EffectOp[])[0],
    );
    expect(deriveAttackEffect(PUT_HALF_ONLY)).not.toContainEqual({ op: "preventAttack" });
    // …and that sentence is not a hypothetical — the pool prints it SIX times,
    // every one an ABILITY (Dusclops sv06.5-019/-069/sv08.5-036, Dusknoir
    // sv06.5-020/-070/sv08.5-037 "Cursed Blast"), lowercase and mid-sentence, which
    // is what the capitalised "Put" plus `^…$` refuses without an /i flag.
    // 🆕 D345 — **THIS LINE SAID FOUR AND THE CATALOG SAYS SIX**, and it had said
    // four since before the Prismatic Evolutions reprints landed. Corrected here
    // together with the two in `effects.ts` and the one in `counterPut.test.ts`:
    // four prose sites, one stale enumeration, none of them visible to `tsc`.
    // ⚠️ AND THE CLAIM ITSELF IS UNCHANGED BY D345 BUILDING THE CARD — the six are
    // ABILITIES, this anchor is the ATTACK reader, and a registry row is the other
    // surface. The assertion below is still `toBeNull` and still means it.
    expect(
      deriveAttackEffect(
        "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.",
      ),
    ).toBeNull();
  });

  it("is anchored end to end", () => {
    for (const text of [
      `Then, ${BARE_TEXT}`,
      BARE_TEXT.slice(0, -1),
      BARE_TEXT.toLowerCase(),
      `${COMPOUND_TEXT} Draw a card.`,
      COMPOUND_TEXT.slice(0, -1),
      // The two halves joined without the printed space.
      COMPOUND_TEXT.replace(". During", ".During"),
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), which states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${BARE_TEXT}\n`)).toEqual([{ op: "preventAttack" }]);
  });

  it("refuses the TWO self-lock printings it deliberately does not map", () => {
    // Every one is real text from the local D1 (2026-08-02, 978 cards / 6 sets), and each
    // is refused by a different property of the whole-sentence anchor. The list a
    // future slice inherits instead of re-censusing (effects.ts carries it too).
    for (const text of [
      // An OPTIONAL damage bonus whose acceptance installs the lock (Copperajah
      // sv06.5-042) — a player decision in FRONT of the §8.5 pipeline.
      "You may do 100 more damage. If you do, during your next turn, this Pokémon can't attack.",
      // TWO consequents on ONE flip (Dragonite ex sv03-159), D142's Squawkabilly
      // refusal in another family.
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("…and the THIRD is now MAPPED — the TAILS gate, re-pointed rather than deleted", () => {
    // ⚠️ RE-POINTED, NOT DELETED (D134's move, D143's habit). This sentence was
    // this file's sharpest stays-LOUD witness at 0.92.0 — "`coinFlipGate` runs its
    // body on HEADS only, so this is a field or an op the engine has not got". D144
    // gave it the field, so the row moves from a NULL to a SHAPE claim, which is a
    // strictly stronger assertion: the gated program's `then` is THIS anchor's own
    // output, byte for byte, and the two anchors stay disjoint readings of one
    // rider printed two ways.
    const gated = deriveAttackEffect(
      "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
    );
    expect(gated).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: deriveAttackEffect(BARE_TEXT),
      },
    ]);
    // …and this anchor does NOT claim the gated string, which is what keeps the
    // capitalised "During" plus `^…$` load-bearing rather than decorative.
    expect(gated).not.toEqual(deriveAttackEffect(BARE_TEXT));
  });

  it("refuses the PER-ATTACK lock — the field warrant this anchor still declines", () => {
    // ⚠️ RE-POINTED TWICE, NEVER DELETED, AND THE TITLE HAS OUTLIVED BOTH MOVES.
    // This case held BOTH field warrants at 0.92.0–0.96.0: the OPPONENT-side lock
    // (which would earn `preventAttack` a `target`) and the PER-ATTACK lock (which
    // would earn it an attack address). D148 took the first, so those rows moved
    // OUT of the null list and into the shape claim below. D154 took the SELF side
    // of the second — as a SEPARATE op rather than a field, D131's widen-don't-add
    // test having FAILED on it — so those two rows move the same way, and what
    // stays LOUD here is the OPPONENT-side twin alone. The claim this file makes
    // is now the strongest it has ever made: not "unmapped", but that THIS anchor
    // reaches none of the four programs below, each of which is a different op.
    for (const text of [
      // A TRAINER-scoped lock on a different turn and a whole board (Geeta
      // sv03-188/-218/-226) — not an attack effect at all, and refused here by
      // every property at once.
      "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck. During this turn, your Pokémon can't attack. (This includes Pokémon that come into play this turn.)",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // …and the two rows that MOVED (D148). Both now derive, both point at the
    // DEFENDER, and neither is reachable from this file's anchor — which is the
    // claim a `toBeNull` used to make weakly and this makes exactly. A build whose
    // self-lock anchor drifted onto either string would install the drawback on
    // the WRONG SEAT, and that is a failure no board looks wrong on: the attacker
    // simply cannot attack next turn and the defender is untouched.
    expect(
      deriveAttackEffect(
        "Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
      { op: "preventAttack", target: "defender" },
    ]);
    expect(
      deriveAttackEffect(
        "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.",
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    // …and the two rows that MOVED AT D154, on the same principle: both now
    // derive, both derive a DIFFERENT OP, and neither is reachable from this
    // file's anchor. Radiant Blastoise swsh10.5-018's card has ONE attack and
    // Munkidori ex sv06.5-037's has ONE attack, which is precisely why they are
    // the pair to assert here — on a one-attack card a per-attack bar and a
    // whole-Pokémon lock are observationally identical on the board, so ONLY the
    // derived program can tell a reader that drifted between them apart.
    expect(
      deriveAttackEffect("During your next turn, this Pokémon can't use Torrential Cannon."),
    ).toEqual([{ op: "preventAttackUse", attack: "Torrential Cannon" }]);
    expect(
      deriveAttackEffect("During your next turn, this Pokémon can't use Dirty Headbutt."),
    ).toEqual([{ op: "preventAttackUse", attack: "Dirty Headbutt" }]);
    // …and the row that MOVED AT D155, re-pointed for the same reason a third
    // time. Seismitoad sv03-052's "Echoed Voice" shares this file's four opening
    // words, its holder and its `+ 2` window, and it is the one neighbour whose
    // card has ONE attack AND whose op writes a DIFFERENT FIELD — so a reader that
    // drifted from the bar onto the buff would leave a board on which nothing
    // looks wrong until a number is 100 too big. Only the derived program can say
    // so, which is why it is asserted here rather than left as a `toBeNull`.
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "boostAttack", attack: "Echoed Voice", amount: 100 }]);
    // …and the LAST row this file carried as a `toBeNull`, RE-POINTED at D157 (a
    // fourth time, and this file's warrant list is now empty of per-attack
    // sentences). Medicham sv01-111 "Acu-Punch-Ture" and Oranguru sv02-094
    // "Plotter's Command" print the OPPONENT-side twin, and it derives a THIRD op:
    // no capture at all, because "that attack" is anaphoric and the address is a
    // PARK. It is the sentence a reader might think `target: "defender"` or D154's
    // `preventAttackUse` reaches — neither does, and the op comparison is the only
    // thing that can say so, because on the board this op writes the SAME FIELD
    // D154's does onto the SAME kind of body. A drifted reader would install the
    // right record on the wrong seat, which is a board nothing looks wrong on.
    expect(
      deriveAttackEffect(
        "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      ),
    ).toEqual([{ op: "preventChosenAttack" }]);
    // …and NONE of them is what THIS file's anchor derives, asserted rather
    // than reasoned about: the bare self-lock's program carries no `target` at
    // all and no `attack`, so an absent key, `"defender"` and a named attack are
    // three different programs from three different sentences.
    expect(deriveAttackEffect(BARE_TEXT)).toEqual([{ op: "preventAttack" }]);
  });

  it("refuses a printed ZERO on the compound but accepts the ungrammatical singular", () => {
    // A printed "Put 0 damage counters" would PARK the attacker on a choice with
    // no possible outcome AND install a drawback for nothing — worse than an
    // unread sentence, so it stays LOUD.
    expect(deriveAttackEffect(COMPOUND_TEXT.replace("9 damage", "0 damage"))).toBeNull();
    // "Put 1 damage counters …" is unprinted and ungrammatical, and it DERIVES —
    // D131's call for "the top 1 cards", D135's for the unprinted "Heal all damage
    // …" and D139/D140's for this same capture. Refusing it would be a claim about
    // the INGEST, not about the game.
    expect(deriveAttackEffect(COMPOUND_TEXT.replace("9 damage", "1 damage"))).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 10, count: 1, source: "attack" },
      { op: "preventAttack" },
    ]);
  });

  it("costs zero registry rows — both cards simulate off their printed text", () => {
    // `programFor(id)?.attack` rather than `programFor(id)`: a row on the CARD is
    // not a row on the ATTACK (D139/D140).
    expect(programFor("sv01-048")).toBeUndefined();
    expect(programFor("sv03-029")).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim, at INDEX 1 on both", () => {
    // The index is a CHECKED fact rather than a guess (D139 found Pour Tea at 1
    // the same way): both cards have two attacks and the mapped sentence is on the
    // second, so a suite that assumed 0 would have simulated the wrong attack.
    expect(FIXTURE_POOL["sv01-048"]?.attacks?.[1]).toEqual({
      cost: ["Water", "Water", "Colorless"],
      name: "Aqua Slash",
      damage: 120,
      effect: BARE_TEXT,
    });
    expect(FIXTURE_POOL["sv03-029"]?.attacks?.[1]).toEqual({
      cost: ["Fire", "Fire"],
      name: "Nine-Tailed Dance",
      effect: COMPOUND_TEXT,
    });
    // Ninetales prints NO `damage` at index 1 — the counters plus the lock are the
    // whole visible result — while Alomomola prints 120, so the pair covers both
    // sides of D125's tail question.
    expect(FIXTURE_POOL["sv03-029"]?.attacks?.[1]?.damage).toBeUndefined();
    // Index 0 on both is a plain hit with NO effect text: the control that proves
    // no program leaks across indices, and the attack a locked body is refused.
    expect(FIXTURE_POOL["sv01-048"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv03-029"]?.attacks?.[0]?.effect).toBeUndefined();
    for (const text of [BARE_TEXT, COMPOUND_TEXT]) {
      expect(text).toContain("can't");
      expect(text).not.toContain("’");
    }
  });
});

describe("the self-lock — installing it", () => {
  it("stamps `state.turn + 2` and announces it in the actor's voice", () => {
    const state = armed("sv01-048");
    const installer = activeUid(state, "p1");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });

    expect(find(events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid: installer,
    });
    // ⚠️ THE + 2, WRITTEN DOWN ONCE AND DRIVEN EVERYWHERE BELOW. Turn 2 installed
    // it; turn 3 is the OPPONENT's (declaring an attack ends the turn, §5.3) and
    // turn 4 is the holder's next one, which is the printed window.
    expect(done.players.p1.active?.attackLockedTurn).toBe(4);
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Attacker-relative, like every "self" op: nothing on the opponent's board and
    // nothing on either Bench carries a lock.
    expect(done.players.p2.active?.attackLockedTurn).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) expect(benched.attackLockedTurn).toBeNull();
    }
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("keeps the printed 120 — a D125 tail board, damage AND a drawback", () => {
    const { events, state: done } = mustApply(armed("sv01-048"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const order = types(events);
    // The §8.5 hit lands FIRST and the lock rides the tail behind it, which is
    // where every EffectOp runs — and free rather than lucky here, since the
    // lock's whole effect is in the future (D125's placement rule).
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_LOCKED"));
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    expect(done.players.p2.active?.damage).toBe(120);
  });

  it("the COMPOUND parks on the pick and installs the lock on the RESUMED tail", () => {
    const state = armed("sv03-029");
    const installer = activeUid(state, "p1");
    const opened = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // Sentence one PARKS — the opponent has an Active and a Bench, so which body
    // takes the counters is a real decision. The lock has NOT installed yet.
    expect(opened.state.phase.kind).toBe("effect:choose");
    expect(types(opened.events)).not.toContain("ATTACK_LOCKED");
    expect(opened.state.players.p1.active?.attackLockedTurn).toBeNull();
    // Ninetales prints no damage, so nothing has happened on the board at all.
    expect(types(opened.events)).not.toContain("DAMAGE_DEALT");

    const resolved = mustApply(opened.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    const order = types(resolved.events);
    // PRINTED ORDER, across the park: the counters, then the drawback.
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("ATTACK_LOCKED"));
    expect(find(resolved.events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid: installer,
    });
    expect(resolved.state.players.p1.active?.attackLockedTurn).toBe(4);
    expect(resolved.state.turn).toBe(3);
  });

  it("places the counters FLAT on the chosen ACTIVE — §8.5 does not touch them", () => {
    // ⚠️ THE ARM THAT DID NOT EXIST BEFORE THIS SLICE. `damageChosen` has offered
    // the Active since Fezandipiti ex "Cruel Arrow", but only ever with `deals`,
    // so `placeSnipe`'s Active branch ran the full §8.5 pipeline. Ninetales is the
    // first printing to offer the Active to a PLACEMENT, and a placed counter is
    // not attack damage in this engine (D138/D139) — being printed on an attack
    // does not make it one.
    let state = armed("sv03-029");
    // fix-titan is neutral; use a body with a real ×2 so the claim can fail.
    state = setActiveFromDeck(state, "p2", "sv01-048"); // Alomomola, ×2 Lightning
    const opened = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const resolved = mustApply(opened.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(find(resolved.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      amount: NINE_COUNTERS_HP,
      // D139/D140's field, reaching the log through a THIRD producer.
      source: "attack",
    });
    // 90, not 180 and not 45: no Weakness, no Resistance, no reduction passive,
    // and no `DAMAGE_DEALT` row at all.
    expect(resolved.state.players.p2.active?.damage).toBe(NINE_COUNTERS_HP);
    expect(types(resolved.events)).not.toContain("DAMAGE_DEALT");
  });

  it("places them flat on a BENCH pick too, and can Knock it Out", () => {
    let state = armed("sv03-029");
    state = benchFromDeck(state, "p2", "fix-basic-1"); // 60 HP — 90 counters is lethal
    const benchIndex = state.players.p2.bench.length - 1;
    const opened = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const resolved = mustApply(opened.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [{ seat: "p2", spot: { spot: "bench", index: benchIndex } }],
      },
    });
    const order = types(resolved.events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(find(resolved.events, "PRIZES_OWED")).toMatchObject({ seat: "p1" });
    // …and the LOCK still installed, behind the Knock Out it caused. A build that
    // stopped the program at the KO would silently hand the attacker a free turn.
    expect(order.indexOf("ATTACK_LOCKED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(resolved.state.phase.kind).toBe("ko:takePrizes");
  });

  it("auto-takes with no park when the opponent has ONLY an Active", () => {
    // `opponentAny` candidates are never empty during an attack (the Active is
    // always there), so the degenerate board is one candidate rather than none —
    // the mandatory-snipe auto-take, not a whiff. The lock lands inline.
    let state = armed("sv03-029");
    state = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, bench: [] } },
    };
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(NINE_COUNTERS_HP);
    expect(find(events, "ATTACK_LOCKED")).toBeDefined();
    expect(done.players.p1.active?.attackLockedTurn).toBe(4);
  });

  it("does not inherit down the attack index — index 0 installs nothing", () => {
    for (const installer of ["sv01-048", "sv03-029"] as const) {
      const { state: done, events } = mustApply(armed(installer), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      expect(types(events)).not.toContain("ATTACK_LOCKED");
      expect(done.players.p1.active?.attackLockedTurn).toBeNull();
    }
  });

  it("takes NO coin — the rngState is unchanged across a whole park-and-resolve", () => {
    // Neither sentence flips anything, so this suite needs no seed table at all
    // (D142's did). Pinned rather than assumed: a future arm that wrapped either
    // sentence in a `coinFlipGate` would fail here.
    const before = armed("sv03-029");
    const opened = mustApply(before, { type: "attack", seat: "p1", index: 1 });
    const resolved = mustApply(opened.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(resolved.state.rngState).toBe(before.rngState);
    expect(types([...opened.events, ...resolved.events])).not.toContain("ATTACK_EFFECT_COIN_FLIP");
  });
});

describe("the self-lock — the WINDOW, driven across four turn boundaries", () => {
  it("is NOT live on the opponent's turn — the turn between install and window", () => {
    // The + 1 mutation's tombstone. A stamp of `state.turn + 1` would put the
    // window HERE, on a turn the holder cannot act on at all, and the card's
    // entire printed drawback would vanish without a single test noticing.
    const state = installed("sv01-048");
    expect(state.turn).toBe(3);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    // The OPPONENT attacks normally inside it — the lock is not a board-wide
    // effect and never touched their body.
    let opponentTurn = setActiveFromDeck(state, "p2", "fix-attacker");
    opponentTurn = attachFromDeck(opponentTurn, "p2", "fix-energy", 1);
    const { events } = mustApply(opponentTurn, { type: "attack", seat: "p2", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("refuses BOTH of the holder's attacks on the window turn", () => {
    for (const installer of ["sv01-048", "sv03-029"] as const) {
      const held = heldTurn(installed(installer));
      expect(held.players.p1.active?.attackLockedTurn).toBe(held.turn);
      // ⚠️ THE LOCK IS ON THE POKÉMON, NOT ON THE ATTACK. Index 1 installed it and
      // index 0 is a different attack on the same card — and both are refused.
      // That is the assertion separating this family from the EIGHT printings
      // that say "this Pokémon can't use {AttackName}", which leave the card's
      // other attack legal and which this engine deliberately leaves LOUD.
      expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
      expect(refusal(held, "p1", 0)).toBe("ATTACK_PREVENTED");
    }
  });

  it("is a REJECTION, not a resolved attack — nothing is spent and the turn stays", () => {
    // §12's shape, not §12's other shape: an Asleep Active cannot DECLARE, while a
    // Confused one declares and then flips. "Can't attack" is the first kind, so
    // the action is illegal — no events, no rng, no turn end. An ATTACK_FAILED
    // here would burn the player's whole turn on a button the server had already
    // decided to refuse.
    const held = heldTurn(installed("sv01-048"));
    deepFreeze(held);
    const result = applyAction(held, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ATTACK_PREVENTED");
      expect(result.error.message).toContain("§11");
    }
    // The board is untouched: still P1's turn, still their Energy, still their HP.
    expect(held.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(held.players.p1.active?.energy).toHaveLength(3);
  });

  it("expires by arithmetic — the holder attacks again two turns later", () => {
    let state = heldTurn(installed("sv01-048"));
    expect(refusal(state, "p1", 1)).toBe("ATTACK_PREVENTED");
    // Turn 5 is P2's, turn 6 is P1's again — and the stamp still says 4.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(6);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    // …and the NEW install replaces the stale stamp rather than accumulating on
    // top of it. Two installs, four turns apart, one number.
    expect(done.players.p1.active?.attackLockedTurn).toBe(8);
  });

  it("does NOT lift at the Checkup that ends the installer's own turn", () => {
    // D112's §13.4 paralysis clock — cleared in `runCheckup` for `endedSeat` —
    // would have. Installing ends P1's turn, so a Checkup runs immediately with
    // `endedSeat` = p1, the holder's OWN seat; that clock lifts this lock a full
    // turn before its window opens. The install events carry that whole Checkup,
    // which is what makes this assertable at all.
    const { state: done, events } = mustApply(armed("sv01-048"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).toContain("TURN_STARTED");
    expect(done.players.p1.active?.attackLockedTurn).toBe(4);
    // …nor at the Checkup ending the OPPONENT's turn, the one immediately before
    // the window opens.
    const held = heldTurn(done);
    expect(held.players.p1.active?.attackLockedTurn).toBe(4);
  });

  it("gates ONLY attacking — every other turn action is still legal", () => {
    // TOTAL IN BOTH DIRECTIONS over the turn:action vocabulary, swept rather than
    // sampled (D140/D142's move): a lock that leaked into retreating, attaching or
    // evolving would be a Special Condition wearing a stamp, and §12 is precisely
    // what this field is not.
    const held = heldTurn(installed("sv01-048"));
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");

    // ATTACH ENERGY — the §5.2 allowance is untouched.
    const withEnergy = handFromDeck(held, "p1", "fix-energy", 1);
    expect(
      applyAction(withEnergy, {
        type: "attachEnergy",
        seat: "p1",
        uid: handUid(withEnergy, "p1", "fix-energy"),
        target: { spot: "active" },
      }).ok,
    ).toBe(true);
    // PLAY A BASIC TO THE BENCH.
    const withBasic = handFromDeck(held, "p1", "fix-titan", 1);
    expect(
      applyAction(withBasic, {
        type: "playBasicToBench",
        seat: "p1",
        uid: handUid(withBasic, "p1", "fix-titan"),
      }).ok,
    ).toBe(true);
    // RETREAT (§11) — the lock is not `retreatBlocked`.
    expect(
      applyAction(held, {
        type: "retreat",
        seat: "p1",
        discardEnergy: (held.players.p1.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }).ok,
    ).toBe(true);
    // PLAY A TRAINER.
    const withTrainer = handFromDeck(held, "p1", "sv01-194", 1);
    expect(
      applyAction(withTrainer, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(withTrainer, "p1", "sv01-194"),
      }).ok,
    ).toBe(true);
    // END THE TURN.
    expect(applyAction(held, { type: "endTurn", seat: "p1" }).ok).toBe(true);
  });

  it("is NOT a §12 condition — a different code, and no status anywhere", () => {
    const held = heldTurn(installed("sv01-048"));
    expect(held.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    // The §12 gate one line above it in `attack.ts` reports its own code, and the
    // ORDER is deliberate: an Asleep AND locked Pokémon says Asleep, because that
    // is the reason nearer the top of the rulebook and the one a player can act on
    // (waking up is a Checkup flip; the lock is not).
    const asleep = setConditions(held, "p1", { rotation: "asleep" });
    expect(refusal(asleep, "p1", 1)).toBe("STATUS_PREVENTS_ATTACK");
  });

  it("the HUD projection agrees with the gate, attack by attack", () => {
    // ⚠️ NOT DECORATION. `redactedAttacksOf` folds the §4 ban and the §12
    // immobilize gate into one `playable` boolean, and it is the ONLY thing
    // standing between a locked player and a button the server refuses. Swept over
    // both attacks in both directions rather than sampled.
    const held = heldTurn(installed("sv01-048"));
    const locked = redactGame(held, "p1").phase;
    if (locked.kind !== "turn:action") throw new Error(`expected turn:action, got ${locked.kind}`);
    expect(locked.attacks).toHaveLength(2);
    for (const attack of locked.attacks) {
      expect(attack.playable, `attack ${attack.index} offered under a lock`).toBe(false);
      expect(refusal(held, "p1", attack.index)).toBe("ATTACK_PREVENTED");
    }
    // …and two turns later the same projection offers them again, so the assertion
    // above is about the LOCK rather than about an unpayable cost.
    let later = must(applyAction(held, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    const free = redactGame(later, "p1").phase;
    if (free.kind !== "turn:action") throw new Error(`expected turn:action, got ${free.kind}`);
    expect(free.attacks.some((a) => a.playable)).toBe(true);
  });
});

describe("the self-lock — the §10 early clears, every one a LINE OF PLAY", () => {
  it("RETREATING clears it, and a Switch brings the body back able to attack", () => {
    // THE SHARPEST CLEAR IN THE SLICE, and one D142's block could never have: this
    // window is the HOLDER's own turn, so the whole sequence is theirs. Retreat the
    // locked Pokémon (§10 sheds the effects of attacks), Switch it back in, attack
    // with it — three legal actions on one turn, and the drawback is gone.
    let held = heldTurn(installed("sv01-048"));
    const locked = activeUid(held, "p1");
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");

    held = must(
      applyAction(held, {
        type: "retreat",
        seat: "p1",
        discardEnergy: (held.players.p1.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }),
    );
    const benched = held.players.p1.bench.find((p) => p.stack.includes(locked));
    expect(benched?.attackLockedTurn).toBeNull();

    // …and GONE rather than merely unread. Switch it back and it attacks.
    held = handFromDeck(held, "p1", "sv01-194", 1);
    const switched = mustApply(held, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(held, "p1", "sv01-194"),
    });
    let back = switched.state;
    if (back.phase.kind === "effect:choose") {
      const index = back.players.p1.bench.findIndex((p) => p.stack.includes(locked));
      expect(index).toBeGreaterThanOrEqual(0);
      back = must(
        applyAction(back, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index } } },
        }),
      );
    }
    expect(activeUid(back, "p1")).toBe(locked);
    expect(back.players.p1.active?.attackLockedTurn).toBeNull();
    // The retreat discarded 2 of its 3 Energy, so put the cost back and declare.
    back = attachFromDeck(back, "p1", "fix-water-energy", 2);
    const { events } = mustApply(back, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    // …and the fresh declaration installs a FRESH window — "applied twice", with
    // both applications real rather than surgeried.
    expect(find(events, "ATTACK_LOCKED")).toBeDefined();
  });

  it("a Boss's Orders from the OPPONENT clears it — the gift they did not mean to give", () => {
    // The forced half of the same move, played on the turn BEFORE the window. The
    // opponent drags the locked body off the Active Spot to hit something softer,
    // and §10 un-locks it on the way out.
    let state = installed("sv01-048");
    const locked = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    state = handFromDeck(state, "p2", "sv02-172", 1);
    const gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    });
    let next = gusted.state;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = next.players.p1.bench.find((p) => p.stack.includes(locked));
    expect(benched?.attackLockedTurn).toBeNull();
    // Silent: the POKEMON_SWITCHED row already tells the story (D112's call).
    expect(types(gusted.events)).not.toContain("ATTACK_LOCKED");
  });

  it("EVOLVING clears it, and the evolved body attacks the same turn", () => {
    // ⚠️ THE INVERSION OF D142. That block's evolve clear was unreachable by
    // construction — its window is the opponent's turn and nobody evolves on
    // someone else's — so it could only be pinned by a state surgery. THIS window
    // is the holder's own, so evolving out of the lock is a real line, and it is
    // driven as one: no surgery anywhere in this case.
    let held = heldTurn(installed("sv01-048"));
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    held = handFromDeck(held, "p1", "fix-mola-stage1", 1);
    const { state: done, events } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-mola-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.attackLockedTurn).toBeNull();
    // §10 carried the Energy through, so the evolution attacks immediately.
    const attacked = mustApply(done, { type: "attack", seat: "p1", index: 0 });
    expect(find(attacked.events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });

  it("a KNOCKED OUT holder takes the lock out of play with the stack", () => {
    // The promoted body is a DIFFERENT Pokémon and carries no lock — the fact that
    // makes this a per-Pokémon effect rather than a per-player one.
    let state = installed("sv01-048");
    state = setDamage(state, "p1", 100); // 110 HP Alomomola, 30 incoming from Bite
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: koed, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(koed.phase.kind).toBe("ko:takePrizes");
    let next = must(applyAction(koed, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p1", benchIndex: 0 }));
    }
    // Turn 4 is the window the dead Pokémon stamped — and the new Active is free.
    expect(next.turn).toBe(4);
    expect(next.players.p1.active?.attackLockedTurn).toBeNull();
  });
});

describe("the self-lock — two windows on ONE body", () => {
  it("carries D142's block and D143's lock at once, on two different turns", () => {
    // ⚠️ THE ARGUMENT FOR A SECOND FIELD, MADE ON A BOARD RATHER THAN IN A DOC.
    // The block's window is `install + 1` and the lock's is `install + 2`, so a
    // single `turn` could hold at most one of them. No card in the pool prints
    // both sentences, so the BLOCK half is surgeried onto a body whose lock is
    // real — which is the honest way round: the claim is about the two fields
    // coexisting, not about a card.
    let state = installed("sv01-048");
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: installed() places the Active.
          active: { ...state.players.p1.active!, attackBlock: { turn: 3, effects: true } },
        },
      },
    };
    // TURN 3 — the block's window. The opponent's attack is prevented, and the
    // lock is inert because it is not this turn.
    let attacker = setActiveFromDeck(state, "p2", "fix-attacker");
    attacker = attachFromDeck(attacker, "p2", "fix-energy", 1);
    const blocked = mustApply(attacker, { type: "attack", seat: "p2", index: 0 });
    expect(find(blocked.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });

    // TURN 4 — the lock's window, reached by the attack itself ENDING turn 3
    // (§5.3). The block has expired by arithmetic while the lock is live: one
    // turn apart, one body, and no single number describes both.
    const held = blocked.state;
    expect(held.turn).toBe(4);
    expect(held.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    expect(held.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(held.players.p1.active?.attackLockedTurn).toBe(4);
  });
});

describe("the self-lock — the §10 clear set is SWEPT, not listed", () => {
  /** Every field on `InPlayPokemon` that §10 sheds when a Pokémon leaves the
      Active Spot or evolves, with a NON-default value to shed. Discovered by
      construction rather than by listing the fields three call sites happen to
      mention: the assertion below is that all three routes shed the SAME set. */
  function fullyEncumbered(pokemon: InPlayPokemon, retreatBlocked: boolean): InPlayPokemon {
    return {
      ...pokemon,
      // CONFUSED rather than Asleep: §12 lets a Confused Pokémon retreat, and
      // this case needs all three §10 routes to be legal on one board. It is shed
      // by exactly the same line.
      conditions: { rotation: "confused", poisonDamage: 20, burned: true },
      // ⚠️ PARAMETERISED, and the reason is a structural fact worth stating: a
      // §11 retreat-blocked Pokémon CANNOT RETREAT, so the retreat route can
      // never be entered carrying that field set. Its clear of `retreatBlocked`
      // is unreachable by construction — turn.ts says so in its own comment —
      // and the other two routes carry it.
      retreatBlocked,
      attackBlock: { turn: 99, effects: true },
      attackLockedTurn: 99,
      // 🆕🆕 D412 — the self-installed retreat lock's stamp. ⚠️ AND IT IS **NOT**
      // PARAMETERISED THE WAY `retreatBlocked` ONE FIELD UP IS, WHICH IS THE
      // DIFFERENCE BETWEEN A FLAG AND A STAMP RATHER THAN AN OVERSIGHT. The
      // boolean blocks the retreat route by existing, so that route can never be
      // entered carrying it; a stamp only blocks on the turn it NAMES, and 99 is
      // not that turn — so all three routes carry this field and all three must
      // shed it. `99` is the same not-this-turn sentinel the two lines above use.
      retreatLockedTurn: 99,
      // 🆕🆕 D432 — the NO-WEAKNESS bar's stamp, and it is `retreatLockedTurn`'s
      // case one line up verbatim: a STAMP rather than a flag, so `99` (not this
      // turn) blocks no route and all three carry it. ⚠️ IT IS ALSO THE ONE FIELD
      // IN THIS SET WHOSE CLEAR NO NUMBER COULD WITNESS — §8.5 applies Weakness
      // only to the ACTIVE, so after every one of these three routes the body is
      // either benched or a different Pokémon and there is no Weakness step left
      // for the bar to have removed. `stillSet` reading the FIELD is the whole
      // witness, which is exactly what this sweep is for.
      noWeaknessTurn: 99,
      // 🆕🆕 D434 — the SCHEDULED counter placement, `retreatLockedTurn`'s and
      // `noWeaknessTurn`'s case again: a stamp for turn 99 is not this turn, so it
      // blocks no route and all three carry it.
      scheduledEffect: { turn: 99, kind: "counters", amount: 90 },
      // 🛑🛑 AND THE FIVE FIELDS BELOW ARE A REPAIR, NOT THIS SLICE'S FIELD (D418's
      // move: remove the premise instead of arguing with it). This helper's own
      // comment says the sweep is "discovered by construction rather than by listing
      // the fields three call sites happen to mention" — and `stillSet` listed
      // EIGHT names against ELEVEN durated fields on the literals, so the
      // three-route AGREEMENT was never checked for `damageReduction`,
      // `attackDamageDebuff`, `installedRecoil`, `lockedAttacks` or `boostedAttack`.
      // A short list makes a claim NARROWER rather than FALSE, which is why nothing
      // ever reddened (D419). Adding a field to a swept set re-reads the set (D432),
      // and the set is now the whole durated family.
      damageReduction: { turn: 99, amount: 20 },
      attackDamageDebuff: { turn: 99, amount: 20 },
      installedRecoil: { turn: 99, amount: 40 },
      lockedAttacks: [{ turn: 99, attackIndex: 0 }],
      boostedAttack: { turn: 99, attackIndex: 0, amount: 20 },
    };
  }

  /** What survived — the fields whose §10 value is not the shed one. */
  function stillSet(pokemon: InPlayPokemon | null | undefined): string[] {
    if (pokemon === null || pokemon === undefined) return ["<missing>"];
    const set: string[] = [];
    if (pokemon.conditions.rotation !== "none") set.push("rotation");
    if (pokemon.conditions.poisonDamage !== 0) set.push("poisonDamage");
    if (pokemon.conditions.burned) set.push("burned");
    if (pokemon.retreatBlocked) set.push("retreatBlocked");
    if (pokemon.attackBlock !== null) set.push("attackBlock");
    if (pokemon.attackLockedTurn !== null) set.push("attackLockedTurn");
    if (pokemon.retreatLockedTurn !== null) set.push("retreatLockedTurn");
    if (pokemon.noWeaknessTurn !== null) set.push("noWeaknessTurn"); // 🆕🆕 D432
    if (pokemon.scheduledEffect !== null) set.push("scheduledEffect"); // 🆕🆕 D434
    // 🆕🆕 D434 — the five the list had never carried; see `fullyEncumbered`.
    if (pokemon.damageReduction !== null) set.push("damageReduction");
    if (pokemon.attackDamageDebuff !== null) set.push("attackDamageDebuff");
    if (pokemon.installedRecoil !== null) set.push("installedRecoil");
    if (pokemon.lockedAttacks.length > 0) set.push("lockedAttacks");
    if (pokemon.boostedAttack !== null) set.push("boostedAttack");
    return set;
  }

  function encumbered(state: GameState, retreatBlocked: boolean): GameState {
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: heldTurn keeps the Active.
          active: fullyEncumbered(state.players.p1.active!, retreatBlocked),
        },
      },
    };
  }

  it("all THREE §10 routes shed the SAME fields — retreat, forced switch, evolve", () => {
    // ⚠️ THE HAZARD THIS EXISTS FOR. The three clears are three hand-written
    // object literals in two files (`clearOnLeavingActive` and `placeEvolution` in
    // turn.ts, `switchInto` in interpreter.ts). Nothing makes them agree, and a
    // 🆕🆕 D434 — FOUR routes, not three: `devolveEach` (interpreter.ts, D433) is a
    // fourth hand-written literal of the same set and this sweep does not reach it.
    // Stated as a known gap rather than left implied; `devolveEach.test.ts` §7 pins
    // that literal field by field on both sides (cleared AND kept), which is the
    // stronger shape, and `delayedCounters.test.ts` §7 drives all four for the field
    // this slice adds.
    // a fourth stamped field would have to be added to all three by hand with
    // nothing failing if one were missed — which is the concrete cost the
    // "generalise `attackBlock` into installed effects" question is really about.
    // Until that question is answered, THIS is the thing that fails.
    const held = heldTurn(installed("sv01-048"));
    const base = encumbered(held, true);
    const locked = activeUid(base, "p1");

    // 1. RETREAT (turn.ts clearOnLeavingActive) — on the one board it can be
    // entered from, i.e. without the retreat block that would refuse the action.
    const retreatable = encumbered(held, false);
    const retreated = must(
      applyAction(retreatable, {
        type: "retreat",
        seat: "p1",
        discardEnergy: (retreatable.players.p1.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }),
    );
    const afterRetreat = stillSet(retreated.players.p1.bench.find((p) => p.stack.includes(locked)));

    // 2. FORCED SWITCH (interpreter.ts switchInto), via the Switch Item.
    const withSwitch = handFromDeck(base, "p1", "sv01-194", 1);
    let switched = must(
      applyAction(withSwitch, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(withSwitch, "p1", "sv01-194"),
      }),
    );
    if (switched.phase.kind === "effect:choose") {
      switched = must(
        applyAction(switched, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const afterSwitch = stillSet(switched.players.p1.bench.find((p) => p.stack.includes(locked)));

    // 3. EVOLVE (turn.ts placeEvolution).
    const withEvo = handFromDeck(base, "p1", "fix-mola-stage1", 1);
    const evolved = must(
      applyAction(withEvo, {
        type: "evolve",
        seat: "p1",
        uid: handUid(withEvo, "p1", "fix-mola-stage1"),
        target: { spot: "active" },
      }),
    );
    const afterEvolve = stillSet(evolved.players.p1.active);

    // Every route sheds EVERYTHING, and — the load-bearing half — they agree.
    expect(afterRetreat).toEqual([]);
    expect(afterSwitch).toEqual([]);
    expect(afterEvolve).toEqual([]);
    // …and the encumbered body really was encumbered, so the three assertions
    // above are about the clears rather than about a board that never carried
    // anything.
    expect(stillSet(base.players.p1.active)).toEqual([
      "rotation",
      "poisonDamage",
      "burned",
      "retreatBlocked",
      "attackBlock",
      "attackLockedTurn",
      "retreatLockedTurn",
      "noWeaknessTurn", // 🆕🆕 D432
      "scheduledEffect", // 🆕🆕 D434
      // 🆕🆕 D434 — the five `stillSet` never carried, in `stillSet`'s push order.
      "damageReduction",
      "attackDamageDebuff",
      "installedRecoil",
      "lockedAttacks",
      "boostedAttack",
    ]);
  });
});
