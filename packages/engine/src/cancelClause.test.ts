import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackCancelRequirement,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D417 — THE TRAILING, ANAPHORIC CANCEL: A READER, NOT A MECHANISM.
//
// D380 shipped `discardStadium` and named the one printing it could not reach in as
// many words: *"`stadiumInPlay` ANSWERS IT ON THE BOARD FACT WHILE THE SKELETON
// STILL REFUSES IT … `ATTACK_DOES_NOTHING` is anchored `^If` and Eternatus
// `sv08-141` prints its clause TRAILING and ANAPHORIC. **THE MEMBER WAS RIGHT AND
// THE READER WAS MISSING**, which is a different refusal from "no vocabulary".*
//
//   Eternatus `sv08-141` "World Ender" ({R}{D}{D}, 230)
//     *"Discard a Stadium in play. If you can't, this attack does nothing."*
//     **1 legal printing**
//
// 🛑 **NOTHING NEW RESOLVES ANYTHING. THE WHOLE SLICE IS AN ANCHOR, A SPLITTER, A
// ONE-ROW TABLE AND A JOIN.** The head is already `deriveAttackEffect`'s
// (`discardStadium`, D380); the board fact is already `stadiumInPlay` (D378); the
// cancel already has a site — D125's requirement gate, in front of the §8.5
// pipeline, whose comment states the semantics this sentence needs: *"the printed
// words are 'this attack does nothing', so nothing is exactly what may happen — no
// damage, no W/R, no effect ops, no triggers."* This slice buys **zero**
// `EffectOp`s, **zero** `BoardCondition` members, **zero** events and **zero**
// prompts.
//
// 🛑 **AND AN OP THAT ABORTS WAS NEVER ON THE TABLE — D125 CLOSED IT.** An effect
// PROGRAM runs at `attack.ts`'s TAIL, strictly AFTER the damage pipeline, and no op
// can retract damage already dealt. *A derived shape is classified by WHERE IN
// RESOLUTION IT LANDS, not by how its sentence reads.* §3's empty-zone board is
// what makes that a measurement rather than a paragraph: the aborting-op build
// deals **230** and then declines to discard; the requirement build deals **0**.
//
// ### THE ONE DESIGN QUESTION, AND THE CATALOG FORCED THE ANSWER
//
// 🛑 **THE TABLE IS KEYED ON THE *HEAD SENTENCE*, NOT ON THE CLAUSE.** The printed
// clause is byte-identical on every member of this family — it carries no referent
// of its own, which is exactly what makes it ANAPHORIC — so a clause-keyed table
// could hold one row and would answer the whole family with it. *"If you can't,"*
// means **a Stadium is in play** behind Eternatus's discard and **a Basic {G}
// Energy card in hand** behind the column's other printing. The referent is the
// head, so the head is the key (D137's `literalClauseRow` idiom).
//
// ⚠️ **THAT IS WHAT MAKES A SECOND MEMBER COST A ROW AND NOTHING ELSE**, which is
// D380's bar for this build: *"a split built for one card serves one card, and it
// must be GENERAL OVER ITS BODY the way `splitAttackRequirementClause` is general
// over its leading one."* The anchor, the splitter, the reader and the site are all
// blind to WHICH head is printed. §1's last rung drives that literally — it adds a
// row to a LOCAL copy of the lookup and shows the same four functions answer a
// second head with no other change.
//
// ⚠️ **THE VACUITY MODES, NAMED BEFORE THE BUILD AND EACH DRIVEN:**
//   • the ACCOUNTING GUARD could be dropped and every board below would still be
//     green — an unmapped head would then be stripped and its cancel silently
//     deleted, so §1 drives the column's OTHER anaphoric printing and requires a
//     refusal on all four functions;
//   • the whole reader could be dropped and the RESOLVING board would still be
//     green (a Stadium in play cancels nothing) — §3's empty-zone board is the only
//     one that moves, which is why it asserts the ABSENCE of damage rather than the
//     presence of an event;
//   • the fold could be written as a second gate instead of a second SOURCE for the
//     existing one, and §3 would still pass — §2 pins the two readers as mutually
//     exclusive over all 1,732 legal units, which is what makes the `??` a join.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** Eternatus `sv08-141` "World Ender", as PRINTED — transcribed byte-for-byte off
    `censusAttackCorpus.ts`, where it stands at **1 legal printing**. */
const ETERNATUS = "Discard a Stadium in play. If you can't, this attack does nothing.";
/** Its head — `deriveAttackEffect`'s since D380. */
const HEAD = "Discard a Stadium in play.";
/** Its trailing clause, which is the SAME bytes on every member of the family. */
const CLAUSE = "If you can't, this attack does nothing.";
/** The column's OTHER anaphoric printing, and the reason this is a family rather
    than a card: the "can't" points at a HAND COST, so the head resolves to a
    different board fact entirely. **1 legal printing**, byte-for-byte from the
    corpus, and this slice deliberately leaves it UNMAPPED and LOUD. */
const OGERPON = "Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing.";

/** ⚠️ **THE NEAR MISS A LOOSER CLAUSE GROUP WOULD HAVE SWALLOWED**, byte-for-byte
    from the corpus at **2 legal printings**: a cancel whose "can't" NAMES its own
    referent and is therefore NOT anaphoric at all. Reading it needs the head's
    ARITHMETIC ("6 cards in this way"), not the head's identity, so it is a
    different build and must stay refused. */
const NAMED_REFERENT =
  "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.";

/** D378's LEADING spelling of the very same board fact — the sentence that must
    keep going to `deriveAttackRequirement` and must never reach this reader. **2
    legal printings** (Fan Rotom `sv07-118`/`sv08.5-085`). */
const LEADING_STADIUM = "If there is no Stadium in play, this attack does nothing.";

// ── the local pool (FIXTURE_POOL untouched — D190's idiom, D275's `cardPool`) ───

/** 🛑 A `fix-*` KEY AND NOT `sv08-141`. The printed EFFECT TEXT is the only thing
    under test and it is transcribed exactly; the scalars around it are a stand-in,
    which a real id would have to justify against `catalogManifest.ts` (D156).
    Cost and base damage are D380's own reading of the print ({R}{D}{D}, 230);
    `hp: 300` so the attacker is never the thing that dies, and `types: ["Darkness"]`
    read by nothing here. */
const WORLD_ENDER = "fix-d417-worldender";

/** A second body carrying a head this engine reads and a cancel it does NOT — the
    accounting guard's subject on a BOARD rather than in a string. Its printed
    sentence is the column's other anaphoric printing, so nothing is constructed. */
const UNMAPPED_CANCEL = "fix-d417-unmapped";

const LOCAL_CARDS: Record<string, Card> = {
  [WORLD_ENDER]: battler(WORLD_ENDER, {
    name: "Fixnatus",
    hp: 300,
    retreat: 2,
    types: ["Darkness"],
    attacks: [
      {
        cost: ["Fire", "Darkness", "Darkness"],
        name: "World Ender",
        damage: 230,
        effect: ETERNATUS,
      },
    ],
  }),
  [UNMAPPED_CANCEL]: battler(UNMAPPED_CANCEL, {
    name: "Fixgerpon",
    hp: 300,
    retreat: 2,
    types: ["Grass"],
    attacks: [
      {
        cost: ["Fire", "Darkness", "Darkness"],
        name: "Unmapped Cancel",
        damage: 230,
        effect: OGERPON,
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Beach Court — the NEUTRAL Stadium: it changes a Basic's retreat cost and nothing
    else, so a board carrying it separates "the zone is occupied" from every number
    this file reads. Six copies because setup takes 7 to hand and 6 to Prizes before
    a case can reach the deck (D376), and these boards play it from EITHER seat. */
const BEACH_COURT = "sv01-167";

/** 4 + 4 + 6 + 4 + 6 + 8 + 28 = **60**. `fix-bigbody` is the dominant mulligan-free
    starter; `fix-titan` (340 HP, no attacks, no Rule Box) is the defender on every
    damage board, because it is the only body in this pool that survives a printed
    230 — a KO would end the case before the number could be read. */
const DECK = deckOf({
  [WORLD_ENDER]: 4,
  [UNMAPPED_CANCEL]: 4,
  [BEACH_COURT]: 6,
  "fix-titan": 4,
  "fix-fire-energy": 6,
  "fix-dark-energy": 8,
  "fix-bigbody": 28,
});

/** THREE SEEDS (D270's rule). No coin is flipped anywhere on this seam — the gate
    is a board read and the op is a deterministic zone move — so three is the
    family's default rather than five. */
const SEEDS = [4171, 4187, 4201] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** `driveSetup`'s script against a LOCAL `cardPool` — that helper hard-codes
    `FIXTURE_POOL`, and D275's rule is that a slice's own bodies stay out of the
    shared pool. P2 goes first on every board here, so P1's attack step opens on
    turn 2 without a first-turn ban (§4). */
function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** Put a Beach Court into `seat`'s hand and PLAY it, so the shared §7.3 zone is
    filled by the rules rather than by surgery. ⚠️ A CONSTRUCTED `state.stadium`
    would have been green and dead (D310/D314/D318): what is under test is that the
    Stadium the rules put in the zone is the one the gate reads. */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, BEACH_COURT, 1);
  const uid = handUid(withCard, seat, BEACH_COURT);
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

/** Setup, then P1's turn 2 with `attacker` Active and its printed cost paid, a
    340 HP `fix-titan` opposite, both Benches cleared, and the Stadium zone either
    occupied by P2's Beach Court (`stadium: true`) or EMPTY. P2 has to play the
    Stadium on its OWN turn, which is why the choice is made here. */
function board(seed: number, stadium: boolean, attacker: string = WORLD_ENDER): GameState {
  let state = localSetup(seed);
  if (stadium) state = playStadium(state, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attacker);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = attachFromDeck(state, "p1", "fix-dark-energy", 2);
  return state;
}

const attack = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: 0 });

describe("§1 — the reader: an exact value, four anchors, and a table that refuses", () => {
  it("🛑 reads Eternatus's printed sentence to `stadiumInPlay`, and splits it in two", () => {
    // The POSITIVE fact, exactly as `deriveAttackRequirement` hands one back:
    // `attack.ts` cancels when it does NOT hold (D125's polarity, unchanged).
    expect(deriveAttackCancelRequirement(ETERNATUS)).toEqual({ kind: "stadiumInPlay" });
    expect(splitAttackCancelClause(ETERNATUS)).toEqual({ head: HEAD, clause: CLAUSE });
    // …and the head it hands back is a sentence the engine ALREADY reads whole,
    // which is what makes the printing resolve rather than merely cancel.
    expect(deriveAttackEffect(HEAD)).toEqual([{ op: "discardStadium" }]);
    // The clause is a CAPTURE, not a reconstruction: the two halves rejoin to the
    // printed string byte for byte, so nothing can be lost in the split.
    expect(`${HEAD} ${CLAUSE}`).toBe(ETERNATUS);
  });

  it("🛑 the ANCHORS: leading text, a missing period, and lower case are each refused", () => {
    // Trailing text after the clause — the `$`. A cancel is the LAST sentence or it
    // is not this reader's.
    expect(splitAttackCancelClause(`${ETERNATUS} Then, draw a card.`)).toBeNull();
    expect(deriveAttackCancelRequirement(`${ETERNATUS} Then, draw a card.`)).toBeNull();
    // The required trailing period — the same anchor every reader in this file
    // carries, and the one a hand-typed sentence loses first.
    expect(splitAttackCancelClause(ETERNATUS.slice(0, -1))).toBeNull();
    expect(deriveAttackCancelRequirement(ETERNATUS.slice(0, -1))).toBeNull();
    // No /i anywhere: the printed sentence is capitalised and so is the key.
    expect(splitAttackCancelClause(ETERNATUS.toLowerCase())).toBeNull();
    expect(deriveAttackCancelRequirement(ETERNATUS.toLowerCase())).toBeNull();
    // LEADING TEXT in front of the head. The head group is greedy, so the head
    // becomes the WHOLE two-sentence prefix, which the table does not carry — the
    // accounting guard refuses it rather than silently reading past a sentence.
    expect(splitAttackCancelClause(`Flip a coin. ${ETERNATUS}`)).toBeNull();
    expect(deriveAttackCancelRequirement(`Flip a coin. ${ETERNATUS}`)).toBeNull();
    // Whitespace is trimmed, which is the one thing that is NOT an anchor.
    expect(splitAttackCancelClause(`  ${ETERNATUS}  `)).toEqual({ head: HEAD, clause: CLAUSE });
  });

  it("🛑 the `^If`-LEADING form still goes to D125's reader and never to this one", () => {
    // D378's spelling of the SAME board fact, printed at the front. The two readers
    // partition this family by where the clause sits, and each refuses the other's
    // string — which is what lets `attack.ts` join them with a `??`.
    expect(deriveAttackRequirement(LEADING_STADIUM)).toEqual({ kind: "stadiumInPlay" });
    expect(deriveAttackCancelRequirement(LEADING_STADIUM)).toBeNull();
    expect(splitAttackCancelClause(LEADING_STADIUM)).toBeNull();
    // …and the reverse: the trailing printing is invisible to `^If`, which is the
    // gap D380 named and this slice closes.
    expect(deriveAttackRequirement(ETERNATUS)).toBeNull();
    expect(splitAttackRequirementClause(ETERNATUS)).toBeNull();
  });

  it("🛑 the TABLE refuses an unmapped head — the accounting guard, on both printings", () => {
    // The column's other anaphoric printing. Its CLAUSE is byte-identical to
    // Eternatus's, so a clause-keyed table would answer it with `stadiumInPlay` and
    // cancel a hand-cost attack on a Stadium read. Its head is not carried, so all
    // four functions refuse and the whole printed string stays LOUD.
    expect(OGERPON.endsWith(CLAUSE)).toBe(true);
    expect(splitAttackCancelClause(OGERPON)).toBeNull();
    expect(deriveAttackCancelRequirement(OGERPON)).toBeNull();
    expect(deriveAttackRequirement(OGERPON)).toBeNull();
    expect(deriveAttackEffect(OGERPON)).toBeNull();
    // A head this engine reads is still not enough — the TABLE decides, not the
    // reader surface. This printed sentence is claimed by `deriveAttackEffect`…
    const READ_HEAD = "Discard 3 Energy from this Pokémon.";
    expect(deriveAttackEffect(READ_HEAD)).not.toBeNull();
    // …and is still refused here, because no row carries it. **A SPLITTER GUARDED
    // BY "SOME READER CLAIMS THE HEAD" RATHER THAN BY THE TABLE WOULD SHIP THIS
    // ONE**, and would answer it with whatever condition the table's single row
    // happens to hold.
    expect(splitAttackCancelClause(`${READ_HEAD} ${CLAUSE}`)).toBeNull();
    expect(deriveAttackCancelRequirement(`${READ_HEAD} ${CLAUSE}`)).toBeNull();
  });

  it("🛑 the NAMED-REFERENT cancel is refused: this reader is for the ANAPHORIC one", () => {
    // 2 legal printings, and the clause between "can't" and the comma is exactly
    // what makes them a different build: they name their own referent, so reading
    // them needs the head's ARITHMETIC rather than the head's identity.
    expect(NAMED_REFERENT.includes("If you can't discard 6 cards in this way,")).toBe(true);
    expect(splitAttackCancelClause(NAMED_REFERENT)).toBeNull();
    expect(deriveAttackCancelRequirement(NAMED_REFERENT)).toBeNull();
    // …and it is really in the pool, so this is a refusal and not a straw man.
    expect(units(corpus().filter(([, s]) => s === NAMED_REFERENT))).toBe(2);
  });

  it("🛑 the APOSTROPHE CLASS is live: a U+2019 reprint of the clause still reads", () => {
    // D136/D137 — "can't" is a contraction, and two slices lost time to an anchor
    // that spelled only U+0027. The whole 978-card pool holds zero U+2019 today, so
    // this is a guard against a re-ingest rather than a live printing.
    const curly = ETERNATUS.replace("can't", "can’t");
    expect(curly).not.toBe(ETERNATUS);
    expect(deriveAttackCancelRequirement(curly)).toEqual({ kind: "stadiumInPlay" });
    // …and the clause handed back is the PRINTED bytes, not a reconstruction, so a
    // caller asserting WHICH clause it accounted for sees what the card says.
    expect(splitAttackCancelClause(curly)?.clause).toBe(CLAUSE.replace("can't", "can’t"));
    // The HEAD's own U+2019 fold is `literalClauseRow`'s and is inert on this key
    // (it spells no apostrophe) — asserted so the next row inherits a live guard.
    expect(HEAD.includes("'")).toBe(false);
  });

  it("🛑🛑 GENERAL OVER ITS BODY: a second member costs a ROW and nothing else", () => {
    // D380's bar, driven literally. The anchor, the splitter and the reader are all
    // blind to WHICH head is printed — the only card-specific byte in the slice is
    // the table key — so this rung re-derives the whole reader over a LOCAL copy of
    // the lookup carrying a second row, and shows the same shape answers a second
    // family member with no other change. It is a MODEL of the table, labelled as
    // one: the shipped table still carries exactly one row (§2 prices it).
    const rows = new Map<string, string>([
      [HEAD, "stadiumInPlay"],
      ["Discard a Basic {G} Energy card from your hand.", "yourHandHasBasicGrass"],
    ]);
    const split = (text: string): { head: string; kind: string } | null => {
      const m = /^(.+\.) (If you can['’]t, this attack does nothing\.)$/.exec(text.trim());
      if (m === null) return null;
      const kind = rows.get(m[1] ?? "");
      return kind === undefined ? null : { head: m[1] ?? "", kind };
    };
    // Both of the column's anaphoric printings resolve, to DIFFERENT facts…
    expect(split(ETERNATUS)?.kind).toBe("stadiumInPlay");
    expect(split(OGERPON)?.kind).toBe("yourHandHasBasicGrass");
    // …and the guard still refuses a head no row carries, which is the property the
    // extra row must not cost.
    expect(split(`Discard your hand. ${CLAUSE}`)).toBeNull();
    // 🛑 The two heads that would have collided under a CLAUSE-keyed table: the
    // clause is the same bytes and the answers are not.
    expect(split(ETERNATUS)?.kind).not.toBe(split(OGERPON)?.kind);
  });
});

describe("§2 — the whole legal column: what this reader claims, and what it cannot", () => {
  it("🛑 claims 1 sentence / 1 legal printing, and it is Eternatus's", () => {
    const claimed = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    expect([claimed.length, units(claimed)]).toEqual([1, 1]);
    expect(claimed.map(([, s]) => s)).toEqual([ETERNATUS]);
    // The ANAPHORIC family in this population is TWO printings and this slice takes
    // ONE — so the reader is measured against the family it belongs to rather than
    // against itself, and the other one is named above and refused below.
    const anaphoric = corpus().filter(([, s]) => s.endsWith(CLAUSE));
    expect([anaphoric.length, units(anaphoric)]).toEqual([2, 2]);
    expect(anaphoric.map(([, s]) => s).sort()).toEqual([OGERPON, ETERNATUS].sort());
    // 🛑 THE ANTI-SATURATION RUNG (D379's trap). A reader that answered everything
    // would satisfy the line above too. The unclaimed member is asserted UNCLAIMED
    // by name, so a successor who widens the anchor instead of adding a row reddens
    // here rather than shipping green.
    expect(deriveAttackCancelRequirement(OGERPON)).toBeNull();
  });

  it("🛑 the two requirement readers are MUTUALLY EXCLUSIVE over all 1,732 units", () => {
    // This is what makes `attack.ts`'s `leadingRequirement ?? cancelRequirement` a
    // JOIN rather than a precedence: no printed string can make both non-null, so
    // the `??` never chooses and the order of its two operands is not a commitment.
    const all = corpus();
    expect(all.length).toBe(640);
    expect(units(all)).toBe(1732);
    const both = all.filter(
      ([, s]) => deriveAttackRequirement(s) !== null && deriveAttackCancelRequirement(s) !== null,
    );
    expect([both.length, units(both)]).toEqual([0, 0]);
    // …and both are really running over this column, which is what stops the line
    // above being vacuous.
    const leading = all.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([leading.length, units(leading)]).toEqual([9, 18]);
  });

  it("🛑 it claims nothing the three OLDER strippers claim, and takes nothing off them", () => {
    // The pairwise disjointness lives in `splitOrder.test.ts` §6 as a tripwire over
    // all four; this is the half that belongs with the READER: the sentence this
    // slice takes was refused by every one of the three before it, and still is.
    expect(splitAttackGateClause(ETERNATUS)).toBeNull();
    expect(splitAttackRequirementClause(ETERNATUS)).toBeNull();
    // 🛑 AND `splitAttackTrailingClause` REFUSES IT FOR A NAMED REASON, not by
    // accident: its tail must be a sentence `deriveAttackEffect` claims, and a
    // does-nothing clause is not one. That is the collision this build would have
    // had, spelled as the condition that fails.
    expect(deriveAttackEffect(CLAUSE)).toBeNull();
    expect(splitAttackTrailingClause(ETERNATUS)).toBeNull();
  });
});

describe("§3 — a REAL BOARD, driven BOTH WAYS off the one printed sentence", () => {
  it.each(SEEDS)("seed %i — a Stadium in play: the attack RESOLVES and the zone is vacated", (seed) => {
    const before = board(seed, true);
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Beach Court in the zone");
    expect(stadium.owner).toBe("p2");
    const p1Discard = before.players.p1.discard.length;

    const result = attack(before);
    const state = result.state;

    // The gate HOLDS, so §8.5 runs: a flat printed 230 on a 340 HP body with no
    // Weakness and no Resistance, which survives so the number can be read.
    expect(types(result.events)).not.toContain("ATTACK_FAILED");
    expect(find(result.events, "DAMAGE_DEALT")?.dealt).toBe(230);
    expect(state.players.p2.active?.damage).toBe(230);
    expect(types(result.events)).not.toContain("KNOCKED_OUT");
    // …and the HEAD resolved too: the zone is empty and the card is in its OWNER's
    // pile, not the actor's (D380's ownership line, re-driven through this seam).
    expect(state.stadium).toBeNull();
    expect(state.players.p2.discard).toContain(stadium.uid);
    expect(state.players.p1.discard).toHaveLength(p1Discard);
    expect(find(result.events, "STADIUM_DISCARDED")?.seat).toBe("p2");
    // 🛑 THE PROGRAM RUNS AT THE TAIL, AFTER THE PIPELINE — D125's placement, read
    // off the event ORDER rather than asserted in prose.
    const order = types(result.events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("STADIUM_DISCARDED"));
    // BOTH printed sentences are accounted for, so nothing is reported as skipped.
    expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it.each(SEEDS)("seed %i — 🛑 NO Stadium: the attack does NOTHING, and 230 is the proof", (seed) => {
    const before = board(seed, false);
    expect(before.stadium).toBeNull();
    const uid = before.players.p1.active?.stack[0];
    if (uid === undefined) throw new Error("expected P1's Active");
    const p1Discard = before.players.p1.discard.length;
    const p2Discard = before.players.p2.discard.length;

    const result = attack(before);
    const state = result.state;

    // The event, with D125's reason — the confusion path's row, one gate later.
    expect(find(result.events, "ATTACK_FAILED")).toEqual({
      type: "ATTACK_FAILED",
      seat: "p1",
      uid,
      reason: "requirement",
    });
    // 🛑🛑 **NOTHING IS EXACTLY WHAT HAPPENED, AND THE ABSENCE OF DAMAGE IS THE
    // WHOLE POINT.** An op that aborted from inside the program — the shape D125
    // closed — would deal this attack's printed 230 FIRST and then decline to
    // discard, and would be green on every other line in this file. It is asserted
    // as an absence AND as a number, because a defender at 0 damage is the only
    // form the claim survives a widened event union in.
    expect(types(result.events)).not.toContain("DAMAGE_DEALT");
    expect(types(result.events)).not.toContain("COUNTERS_PLACED");
    expect(types(result.events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.damage).toBe(0);
    // No effect ops ran. ⚠️ NAMED RATHER THAN OVERCLAIMED: this row's condition and
    // its head read the SAME singleton zone, so on this board the discard would have
    // been a silent no-op anyway (§8.6) and the absence below cannot tell a skipped
    // program from an empty one. The DAMAGE lines above are what carry the claim.
    expect(types(result.events)).not.toContain("STADIUM_DISCARDED");
    expect(state.players.p1.discard).toHaveLength(p1Discard);
    expect(state.players.p2.discard).toHaveLength(p2Discard);
    expect(state.phase.kind).not.toBe("effect:choose");
    // The sentence was SIMULATED — a cancelled attack is not a skipped effect, and
    // the HEAD is simulated by `deriveAttackEffect` rather than by the requirement.
    expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // 🛑 THE TURN STILL ENDS. A cancelled attack is an attack that was USED, which
    // is why the gate returns through `finishAttack` rather than with a bare state.
    expect(types(result.events)).toContain("TURN_ENDED");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it.each(SEEDS)("seed %i — the CONTROL: an UNMAPPED cancel stays LOUD and is not gated", (seed) => {
    // The accounting guard on a board. This body prints the column's OTHER anaphoric
    // sentence, whose head no row carries — so the split does not fire, no
    // requirement is read, the WHOLE printed string is reported, and the attack is
    // NOT cancelled on an empty zone. Delete the guard and this rung goes red twice:
    // the report shrinks to the head and the attack starts cancelling.
    const result = attack(board(seed, false, UNMAPPED_CANCEL));
    expect(types(result.events)).not.toContain("ATTACK_FAILED");
    expect(find(result.events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({ effect: OGERPON });
    expect(find(result.events, "DAMAGE_DEALT")?.dealt).toBe(230);
  });
});
