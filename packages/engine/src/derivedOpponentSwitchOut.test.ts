import { describe, expect, it } from "vitest";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState } from "./index";
import { applyAction, phaseViewOf, programFor } from "./index";
import { programPlayable } from "./cardplay";
import {
  FIXTURE_POOL,
  TRAINER_OPS_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.143.0 → 0.144.0 — D227, THE OPPONENT-CHOSEN SWITCH-OUT: row 4 of
// `coverage-backlog-legal.md`, and the FIRST op whose whole content is WHO
// ANSWERS.
//
// "Switch out your opponent's Active Pokémon to the Bench. (Your opponent
// chooses the new Active Pokémon.)" — 10 Standard-legal printings bare, 13 across
// the three sentences these arms read.
//
// 🛑 THE BOARD MOVE IS `gust`'s, BYTE FOR BYTE. `opponentSwitchOut` calls the same
// `switchInto` on the same seat over the same candidate set and emits the same
// `POKEMON_SWITCHED` row. The ONLY difference is a `decider` on the park — so this
// file's job is not "did something move" (the gust suite already owns that), it is
// **WHOSE QUESTION IT IS**, on every board where that is observable. Every case
// below that could pass on a crossed build is paired with one that could not.
//
// ⚠️ THE `needs` CELL WAS RE-DERIVED BEFORE THE SLICE OPENED, PER conventions.md,
// AND IT WAS HALF WRONG IN THE CHEAP DIRECTION. It read: *"cross-seat
// `decider`/`answerer` machinery already exists; the op and the HUD offer do
// not."*
//   • **The machinery: TRUE.** `opponentMayDraw` has carried `decider` since 0.x;
//     `settleProgram` files `phase.answerer`, `resolveEffect` gates on it,
//     `phaseViewOf` moves `waitingSeat` and WITHHOLDS the prompt from everyone
//     else.
//   • **The op: TRUE.** It did not exist.
//   • 🛑 **The HUD offer: FALSE — IT COST NOTHING.** `choosePokemon` is already
//     dialoged on BOTH surfaces, `acting` follows `waitingSeat`, and
//     `redactedRefOf` carries an ABSOLUTE `seat`, so the answerer sees their own
//     bodies with the "opponent" badge correctly absent. **Zero client lines.**
//     That is the fourth `needs` cell on this branch to overstate a cost — D199's
//     was the first (7 printings hidden behind one word).
//
// ⚠️ AND THE COUNT WAS RIGHT WHILE THE EDIT ESTIMATE WAS NOT. The row priced "14
// printings for ~4 regex arms + 1 op". 14 legal printings is EXACT (re-derived
// below), but the fourth arm is not an arm: Grimmsnarl `sv07-096`'s "If you do,
// this attack does 160 damage to the new Active Pokémon" is a SECOND §8.5 hit on
// a body that is not the captured defender, which lives in `attack.ts` in front of
// the interpreter. **13 for 3 arms + 1 op**, with the 14th pinned unread below.
//
// ⚠️ A THIRD FINDING, FROM SWEEPING ALL THREE TEXT COLUMNS RATHER THAN THE ONE
// THE ROW CENSUSED: `sv10.5w-023`/`-107` print the ABILITY twin of Iron Bundle's
// compound (2 legal). They are REGISTRY rows, not arms, and are deliberately left
// for their own slice — an activated Ability is a card PLAY and goes through
// `programPlayable`, which has no arm for this op and must not get a speculative
// one. Recorded in `coverage-backlog-legal.md`.

/** The three sentences this slice reads, with the program each derives to and the
    LEGAL printing count measured for it. Census re-derived (not inherited) on
    2026-08-05 against the remote D1 `luminous` — 3,786 rows / 20 sets, 2,021
    `legal_standard = 1` — over `json_each(attacks_json)` +
    `json_extract(value,'$.effect')`, with `GLOB` rather than `LIKE` because
    SQLite's `LIKE` is ASCII case-insensitive and has cost this repo a census.

    Both figures are given per row: `printings` over the whole remote catalog,
    `legalPrintings` over the Standard pool. A count without a population AND a
    legality is not a fact. */
const CLAUSES = [
  {
    text: "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    program: [{ op: "opponentSwitchOut" }] as EffectOp[],
    printings: 19,
    legalPrintings: 10,
  },
  {
    text: "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    program: [
      {
        op: "optional",
        note: "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "opponentSwitchOut" }],
      },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 2,
  },
  {
    text: "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    program: [
      { op: "switchActive", recordAs: "moved" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "recordGate", slot: "moved", then: [{ op: "opponentSwitchOut" }] },
    ] as EffectOp[],
    printings: 8,
    legalPrintings: 1,
  },
] as const;

const BARE = 0;
const MAY = 1;
const COMPOUND = 2;

/** Grimmsnarl `sv07-096` "Goad 'n' Grab" — the family's 14th legal printing, which
    D227 deliberately did not read and **D228 BUILT**. It stays named here because
    it is part of the same census: this file's arithmetic is 13 + 1 = 14 either
    way, and what moved is which side of the `+` the 1 sits on. Its program is
    asserted in `derivedNewActiveDamage.test.ts`; what is asserted HERE is only
    that D227's three anchors still refuse it, which is the property that keeps the
    two slices' sentences disjoint. */
const DAMAGE_RIDER =
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.";

/** The four gust-plus-damage-rider sentences that shared the 14th's mechanism —
    ALSO BUILT AT D228, and kept here for the same reason: "one slice for 8
    printings" was a measured claim, and the measurement is what the next reader
    needs to check the promise against what landed. */
const GUST_DAMAGE_RIDERS = [
  ["Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.", 2],
  ["Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 20 damage to the new Active Pokémon.", 2],
  ["Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 40 damage to the new Active Pokémon.", 2],
  ["Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 70 damage to the new Active Pokémon.", 1],
] as const;

/** U+2019, spelled as an escape: this pair of characters renders nearly
    identically, so the curly one is always written where a reader can see it. */
const RSQUO = "’";

// ── The board. Indices 9-12 on `fix-trainerops`, appended by D227. ──
const KICK_AWAY = 9;
const WINDING_WAVES = 10;
const INTERJET = 11;
const GOAD_N_GRAB = 12;
/** The self-switch D189 appended at 5 — the CONTROL for every "whose question is
    it" case: same prompt kind, same file, opposite seat. */
const SLIP_AWAY = 5;
/** The GUST D181 appended at 2 — the second control, and the sharper one: same
    CANDIDATE SET as this slice's op, answered by the other player. */
const TAUNT = 2;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: TRAINER_OPS_DECK, p2: TRAINER_OPS_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops` and holds `ownBench` benched bodies; p2 has a
    `fix-bigbody` Active and `oppBench` benched ones. Both Benches are set
    explicitly, because every case here is about which side was ASKED. */
function ready(seed: number, ownBench: number, oppBench: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the three anchors — one new op, and two compositions of things that existed", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 13 of the family's 14 legal printings, across 3 sentences", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one anchor would still pass every accept case above.
    expect(CLAUSES).toHaveLength(3);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(13);
    expect(CLAUSES[BARE].legalPrintings).toBe(10);
    expect(CLAUSES[MAY].legalPrintings).toBe(2);
    expect(CLAUSES[COMPOUND].legalPrintings).toBe(1);
    // …and the 14th is the damage rider, so the FAMILY total is 14 and the row's
    // own count holds exact while its edit estimate does not.
    //
    // ⚠️ D228 BUILT THE 14th, AND WHAT THIS LINE ASSERTS CHANGED SHAPE RATHER THAN
    // BEING DELETED. It used to read `toBeNull()` — a claim about the whole
    // deriver, which stops being true the moment a sibling slice lands. What is
    // still THIS file's claim, and is the one that matters for keeping two slices'
    // sentences disjoint, is that none of the THREE ANCHORS ABOVE claims it: the
    // rider is the bare sentence plus a tail, so a bare anchor that lost its `$`
    // would swallow it and silently drop 160 damage (a live mutant, and the reason
    // this is asserted rather than assumed).
    expect(deriveAttackEffect(DAMAGE_RIDER)).not.toEqual(CLAUSES[BARE].program);
    expect(deriveAttackEffect(DAMAGE_RIDER)?.[0]).toEqual({
      op: "opponentSwitchOut",
      recordAs: "moved",
    });
  });

  it("only the BARE arm invents an op; the other two COMPOSE", () => {
    // The honest price of the slice, asserted: one new union member, and two arms
    // whose programs are built entirely out of ops that shipped in earlier slices
    // (`optional` D186, `switchActive`+`recordAs`+`recordGate` D206/D172).
    const kinds = (ops: readonly EffectOp[]): string[] => ops.map((o) => o.op);
    expect(kinds(CLAUSES[BARE].program)).toEqual(["opponentSwitchOut"]);
    expect(kinds(CLAUSES[MAY].program)).toEqual(["optional"]);
    expect(kinds(CLAUSES[COMPOUND].program)).toEqual(["switchActive", "recordGate"]);
    // The compound's shape IS Prime Catcher's registry program with the two ends
    // swapped — one printed action read off two seams, D132's inventory rule.
    const primeCatcher = programFor("sv05-157")?.trainer ?? [];
    expect(kinds(primeCatcher)).toEqual(["gust", "recordGate"]);
  });

  it("the GATED sentence's `then` is BYTE-IDENTICAL to the bare arm's whole program", () => {
    // This family's checkable claim, the same one the four draw anchors carry: a
    // "You may X" must be exactly "X" behind a gate, or the wrapper is quietly
    // building a different card.
    const gated = deriveAttackEffect(CLAUSES[MAY].text)?.[0];
    expect(gated?.op).toBe("optional");
    expect(gated?.op === "optional" ? gated.then : undefined).toEqual(
      deriveAttackEffect(CLAUSES[BARE].text),
    );
    // …and the note is the WHOLE printed sentence, which is what the dialog shows.
    expect(gated?.op === "optional" ? gated.note : undefined).toBe(CLAUSES[MAY].text);
  });

  it("the COMPOUND's antecedent is the bare self-switch plus one recording key", () => {
    // The other composition claim, in the other direction: the first op differs
    // from D189's standalone self-switch by `recordAs` and by nothing else, so a
    // reader of the compound is looking at a program it already understands.
    const [first] = deriveAttackEffect(CLAUSES[COMPOUND].text) ?? [];
    expect(first).toEqual({ op: "switchActive", recordAs: "moved" });
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).toEqual([
      { op: "switchActive" },
    ]);
  });

  it("accepts BOTH apostrophes on all three — deliberately, not accidentally", () => {
    // ⚠️ THE FIRST DRAFT OF THESE ANCHORS HAD NO CURLY CLASS, reasoning from D189's
    // call on the self-switch (which carries NO apostrophe) and from a measured
    // zero in today's catalog. `clauseApostrophe.test.ts` turned red on it, and
    // the rule is the one it enforces: a sentence that CONTAINS an apostrophe must
    // derive identically under a re-ingest that curls it. A measured zero in the
    // catalog is not a reason to narrow a PARSER.
    for (const { text, program } of CLAUSES) {
      const curled = text.replaceAll("'", RSQUO);
      expect(curled).not.toBe(text);
      const derived = deriveAttackEffect(curled);
      expect(derived, curled).not.toBeNull();
      // Equal modulo the `optional` note, which ECHOES its input by design — the
      // one part of a derived program that is supposed to follow the spelling.
      expect(JSON.stringify(derived).replaceAll(RSQUO, "'"), curled).toEqual(
        JSON.stringify(program),
      );
    }
  });

  it("hands no clause to the coin reader, and reads no near-miss of its own", () => {
    for (const { text } of CLAUSES) expect(deriveAttackCoinFlip(text), text).toBeNull();
    expect(deriveAttackCoinFlip(DAMAGE_RIDER)).toBeNull();
    // The two real sentences closest to this family that mean something else. The
    // second is the same mechanic written from the OTHER end (0 legal, rotated),
    // and it is a live witness that the anchor is keyed to the printed bytes and
    // not to the idea.
    for (const text of [
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
      "Your opponent chooses 1 of their Benched Pokémon and switches it with their Active Pokémon. The new Active Pokémon is now Asleep.",
    ]) {
      expect(deriveAttackEffect(text), text).not.toEqual(CLAUSES[BARE].program);
    }
  });

  it("refuses the anchor, punctuation and case rewrites — the parenthetical included", () => {
    const bare = CLAUSES[BARE].text;
    const rewrites = [
      // The parenthetical dropped. It is REMINDER text and the anchor matches it
      // anyway, because it is the only thing in the printed bytes that tells this
      // sentence from a gust. No catalog row drops it (measured: 0 of 33).
      "Switch out your opponent's Active Pokémon to the Bench.",
      // …and the parenthetical alone, which is not a sentence the engine reads.
      "(Your opponent chooses the new Active Pokémon.)",
      // A leading clause — the shape a `$`-only build eats.
      `Draw a card. ${bare}`,
      // A trailing clause — the shape a `^`-only build eats. ⚠️ D228 SWAPPED THE
      // WITNESS HERE, and the reason is worth a line: this row used to be the
      // family's real 14th printing (Grimmsnarl's damage rider), which is now
      // BUILT — so "derives to null" is no longer the property being asserted
      // about it. What this row must still pin is that the BARE anchor does not
      // swallow a tail, so it carries a tail no card prints, and the built rider's
      // disjointness from this anchor is asserted in the arithmetic case above.
      `${bare} Draw a card.`,
      // Case, which these readers commit to.
      bare.toLowerCase(),
      bare.toUpperCase(),
      // The plural the catalog does not print.
      bare.replace("Active Pokémon to the Bench", "Active Pokémon to the Benches"),
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
    // …but outer whitespace is trimmed, like every other sentence this reader
    // takes — asserted so the refusals above are about the ANCHOR and not about
    // the reader being brittle.
    expect(deriveAttackEffect(`  ${bare}  `)).toEqual(CLAUSES[BARE].program);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FIXTURE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries all three of this slice's sentences, and the 14th beside them", () => {
  it("fields the family at indices 9-12, appended and not inserted", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    // 48 at D236 (43 at D235, 35 at D234, 29 at D232, 25 at D231, 20 at D230, 17 at D229, 14
    // at D228, 13 at D227): D228's ungated rider was appended at 13, D229's three
    // energy-move sentences at 14-16, D230's three bench searches at 17-19,
    // D231's five hand searches at 20-24, D232's four opponent-hand sentences at
    // 25-28, D234's six discard-pile attaches at 29-34 and D235's eight
    // deck-search attaches at 35-42, and 9-12 did not move — which is what every
    // constant in this file depends on.
    // ⚠️ FIFTY-FIVE AT D240; **58 at D241**, which appended 55-57 (look at the
    // top N — "Summoning Gate" / "Larimar Rain" / "Dig It Up").
    // `derivedLookAtTop.test.ts` owns 55-57. ELEVEN slices, eleven appends, zero
    // inserts.
    // 🆕🆕 **63 AT D426**, which appended **61-62** — the opponent-chooses hand
    // discard (*"Your opponent discards 2 cards from their hand."* / *"…a card…"*).
    // `opponentHandDiscard.test.ts` owns them, and the append-never-insert
    // discipline this whole paragraph exists for holds again: 0-60 are addressed by
    // constant in a dozen sibling suites and every one of them still means what it
    // meant. ⚠️ NO ORDINAL IS CLAIMED (*"the Nth slice"*) — the running count above
    // was last written at D241 and was already one append behind by D246, which is
    // exactly how a count in a comment rots. The LENGTH is the executable half and
    // it is the line below.
    // 🆕🆕 **68 AT D443**, which appended **66-67** — the OPPONENT-BOARD pair
    // (`derivedOpponentEnergyMove.test.ts` owns them). TWELVE sibling suites carry
    // this pin and all twelve were stepped in one pass, as D442 stepped eleven.
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (`derivedSpreadEnergyMove.test.ts` owns them). ELEVEN sibling suites carry this
    // same length pin and ALL of them were stepped in one pass (D431): a green run
    // after fixing the one that reddened is evidence the runner stopped early.
    expect(attacks).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect(attacks[KICK_AWAY]?.effect).toBe(CLAUSES[BARE].text);
    expect(attacks[WINDING_WAVES]?.effect).toBe(CLAUSES[MAY].text);
    expect(attacks[INTERJET]?.effect).toBe(CLAUSES[COMPOUND].text);
    expect(attacks[GOAD_N_GRAB]?.effect).toBe(DAMAGE_RIDER);
    // D181's and D189's indices are untouched, which is what "appended" means and
    // what nine cases in the sibling suite depend on.
    expect(attacks[TAUNT]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks[SLIP_AWAY]?.effect).toBe("Switch this Pokémon with 1 of your Benched Pokémon.");
  });

  it("▶️ D228 BUILT THE 14th — it no longer STAYS LOUD, and the board says which", () => {
    // ⚠️ THIS CASE USED TO ASSERT THE OPPOSITE, AND KEEPING IT (INVERTED) IS THE
    // POINT. D227 pinned the gap on a live board — one `ATTACK_EFFECT_SKIPPED`
    // row, nobody asked, the opponent's Active unmoved — precisely so the day it
    // was built would show up HERE rather than as a quietly deleted test. The
    // three assertions below are the same three, each flipped.
    //
    // 🛑 AND ONE OF THEM CANNOT BE MERELY FLIPPED, WHICH IS THE FINDING. The old
    // case read `DAMAGE_DEALT.length > 0` and called it "its printed BASE damage
    // lands (the attack works)" — off a `damage: 130` D227's fixture INVENTED.
    // `sv07-096` prints no base damage at all (re-read off the remote D1), so the
    // fixture is corrected and this board now has exactly ONE damage row: the
    // rider's own 160, against the body the opponent promoted.
    const state = ready(31, 1, 2);
    const wasActive = activeUid(state, "p2");
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    // The opponent IS asked (two benched bodies), and they are the answerer.
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(phaseViewOf(parked.state, "p2").waitingSeat).toBe("p2");
    // Nothing has been dealt yet — the whole sentence is behind the answer.
    expect(all(parked.events, "DAMAGE_DEALT")).toHaveLength(0);
    // …and no loud row anywhere, on either half.
    expect(all(parked.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    const target = parked.state.players.p2.bench[0];
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
    });
    // The 160 landed on the PROMOTED body, not on the one that left — and this
    // board's Bench is `fix-basic-1` at 60 HP, so it is also a Knock Out, which is
    // why the promoted body is read off the EVENT rather than off `players.p2`
    // (there is no Active there to read once the rider resolves).
    const dealt = all(done.events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target?.stack[0]);
    expect(dealt[0]?.uid).not.toBe(wasActive);
    expect(dealt[0]?.base).toBe(160);
    expect(all(done.events, "KNOCKED_OUT")[0]?.uid).toBe(target?.stack[0]);
    // …and the body that was switched OUT is on the Bench, untouched.
    expect(done.state.players.p2.bench.some((b) => b.stack[0] === wasActive)).toBe(true);
    expect(all(done.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("the four sentences the 14th shared its mechanism with are built too", () => {
    // D227 priced the split-out row at 8 legal printings — Grimmsnarl plus these
    // four — and this is the arithmetic held against what landed. The programs
    // themselves belong to `derivedNewActiveDamage.test.ts`; what is checked here
    // is only that the count the promise was made with is the count that was paid.
    let riderPrintings = 1; // Grimmsnarl itself
    for (const [text, legal] of GUST_DAMAGE_RIDERS) {
      expect(deriveAttackEffect(text), text).not.toBeNull();
      riderPrintings += legal;
    }
    expect(riderPrintings).toBe(8);
    // …and the distinction D227's block warned the builder about held: the rider
    // is genuine ATTACK damage, where the counter-put sentence one op over is not
    // and never became it (`damageActive`'s own doc: "an effect, not damage").
    const counterPut = deriveAttackEffect("Put 5 damage counters on your opponent's Active Pokémon.");
    expect(counterPut).toEqual([{ op: "damageActive", amount: 50, source: "attack" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE POINT OF THE SLICE — whose question is it?
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — the OPPONENT answers, and that is the whole op", () => {
  it("PARKS on the opponent's Bench with the opponent as ANSWERER", () => {
    const state = ready(41, 2, 3);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: KICK_AWAY });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // 🛑 THE ASSERTION THE WHOLE SLICE IS ABOUT. `seat` is the CONTROLLER (the turn
    // is still p1's and every reader of that field means the program's owner);
    // `answerer` is the seat that must send the resolveEffect.
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.answerer).toBe("p2");
    expect(parked.phase.resumeTail).toBe(true);
    // The candidates are the opponent's OWN Bench — the same set `gust` offers,
    // which is why the seat above is the only thing distinguishing the two.
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(parked.phase.prompt.candidates).toHaveLength(3);
    for (const ref of parked.phase.prompt.candidates) {
      expect(ref.seat).toBe("p2");
      expect(ref.spot.spot).toBe("bench");
    }
    // The note speaks to the ANSWERER about their own board.
    expect(parked.phase.prompt.note).toBe("Choose your new Active Pokémon.");
    // Nothing has moved yet, and the attacker is still where it was.
    expect(activeUid(parked, "p1")).toBe(attacker);
    expect(parked.pending).toEqual([
      // 🆕 D394 — the stage names the ATTACK as well as the attacker.
      { kind: "attackEpilogue", seat: "p1", uid: attacker, attack: "Kick Away" },
    ]);
  });

  it("🛑 REFUSES the CONTROLLER's answer, and accepts the opponent's", () => {
    // The negative control the slice exists for, and the one a build that dropped
    // the `decider` would fail: without it p1 answers and p2 is never asked.
    const { state: parked } = mustApply(ready(42, 1, 2), {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    const choice = { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } } as const;
    const refused = applyAction(parked, { type: "resolveEffect", seat: "p1", choice });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.error.code : undefined).toBe("WRONG_SEAT");
    // …and the same message from the other chair lands.
    const { state: done } = mustApply(parked, { type: "resolveEffect", seat: "p2", choice });
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("the GUST is the same board and the OTHER answerer — the crossed-build control", () => {
    // ⚠️ THE PAIR THAT MAKES THE `decider` LOAD-BEARING. Same seed, same board,
    // same candidate set, same prompt kind: only the seat that owes the answer
    // differs. A build that copied `gust` verbatim would produce the RIGHT board
    // and hand the question to the wrong player, and nothing but this pair sees it.
    const { state: gusted } = mustApply(ready(43, 1, 3), {
      type: "attack",
      seat: "p1",
      index: TAUNT,
    });
    const { state: pushed } = mustApply(ready(43, 1, 3), {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    if (gusted.phase.kind !== "effect:choose" || pushed.phase.kind !== "effect:choose") {
      throw new Error("expected both to park");
    }
    expect(gusted.phase.answerer).toBeUndefined();
    expect(pushed.phase.answerer).toBe("p2");
    // …and the OFFER is identical, which is what isolates the difference to the
    // seat rather than to the candidate computation.
    expect(pushed.phase.prompt.kind === "choosePokemon" ? pushed.phase.prompt.candidates : null)
      .toEqual(gusted.phase.prompt.kind === "choosePokemon" ? gusted.phase.prompt.candidates : []);
  });

  it("moves the OPPONENT's Active, never the attacker's — the other crossed build", () => {
    // The seat mutant one level down: `switchInto` on the wrong side would leave
    // a legal-looking board with the opposite effect.
    const state = ready(44, 2, 1);
    const attacker = activeUid(state, "p1");
    const wasActive = activeUid(state, "p2");
    const wasBenched = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: KICK_AWAY });
    // One benched body → forced, no question to ask (the M1 no-choice rule holds
    // for a cross-seat park exactly as for an own-seat one).
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p2")).toBe(wasBenched);
    expect(done.players.p2.bench[0]?.stack[0]).toBe(wasActive);
    // The attacker did not move, and its own Bench is stocked so a crossed build
    // would have had somewhere to go.
    expect(activeUid(done, "p1")).toBe(attacker);
    expect(done.players.p1.bench).toHaveLength(2);
  });

  it("is a SILENT no-op on an empty opponent Bench — and not a skipped effect", () => {
    const state = ready(45, 2, 0);
    const before = [activeUid(state, "p1"), activeUid(state, "p2")];
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    expect([activeUid(done, "p1"), activeUid(done, "p2")]).toEqual(before);
    expect(done.phase.kind).not.toBe("effect:choose");
    // The sentence WAS read and had no legal target. p1's own Bench is stocked, so
    // a crossed build would have found candidates and moved something.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("the ATTACKER's turn ends only once the OPPONENT has answered", () => {
    // The sequencing an `answerer` on an attack park buys, and the reason the
    // `attackEpilogue` had to be in `pending` behind it: the turn cannot fold while
    // the other player owes a decision, and it must fold the moment they pay it.
    const state = ready(46, 1, 2);
    const { state: parked, events: parkEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    expect(types(parkEvents)).not.toContain("TURN_ENDED");
    // EFFECT_PENDING names the seat that must resolve — the ANSWERER, not the
    // controller (the event's own doc).
    expect(all(parkEvents, "EFFECT_PENDING")[0]?.seat).toBe("p2");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
    });
    expect(types(events)).toContain("TURN_ENDED");
    expect(done.pending).toEqual([]);
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(1);
  });

  it("`phaseViewOf` moves waitingSeat to the opponent and WITHHOLDS the prompt", () => {
    // The projection half, which is what makes this renderable on both surfaces
    // without a line of client code: the answerer is waited on and sees the
    // prompt; the controller is not and does not.
    const { state: parked } = mustApply(ready(47, 1, 3), {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    const forOpponent = phaseViewOf(parked, "p2");
    expect(forOpponent.waitingSeat).toBe("p2");
    expect(forOpponent.activeSeat).toBe("p1"); // the TURN is still the attacker's
    expect(forOpponent.pendingDecision).not.toBeNull();
    const forController = phaseViewOf(parked, "p1");
    expect(forController.waitingSeat).toBe("p2");
    expect(forController.activeSeat).toBe("p1");
    // 🛑 WITHHELD FROM THE CONTROLLER. Without this the attacker's own
    // client would render a dialog for a question it may not answer —
    // afford-then-reject, the class this repo has closed twice.
    expect(forController.pendingDecision).toBeNull();
    // ⚠️ AND THE CANDIDATES REACH THE ANSWERER AS THEIR OWN BODIES — the fact that
    // makes the existing `choosePokemon` dialog correct here with no change. The
    // online HUD badges a candidate "opponent" when `ref.seat !== seat`; for this
    // park that comparison is false for every row.
    const decision = forOpponent.pendingDecision;
    if (decision?.kind !== "effectChoose") throw new Error("expected effectChoose");
    expect(decision.prompt.kind).toBe("choosePokemon");
    if (decision.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(decision.prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE TWO COMPOSITIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — the printed 'You may', two questions to two people", () => {
  it("asks the CONTROLLER first, then the OPPONENT — in that order", () => {
    const state = ready(51, 1, 3);
    const { state: confirming } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: WINDING_WAVES,
    });
    // Question one: the controller's consent.
    if (confirming.phase.kind !== "effect:choose") throw new Error("expected a confirm park");
    expect(confirming.phase.prompt.kind).toBe("confirm");
    expect(confirming.phase.answerer).toBeUndefined();
    expect(confirming.phase.seat).toBe("p1");

    // Question two: the opponent's pick, behind it.
    const { state: choosing } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    if (choosing.phase.kind !== "effect:choose") throw new Error("expected a pokemon park");
    expect(choosing.phase.prompt.kind).toBe("choosePokemon");
    expect(choosing.phase.answerer).toBe("p2");
  });

  it("🆕🆕 D422 — ASKS ON AN EMPTY OPPONENT BENCH TOO, and the YES does nothing", () => {
    // 🛑 THE PRECEDENT D422 CITED, WHICH WAS **UNDRIVEN WHEN IT CITED IT**. D422
    // builds the mirror of this sentence on the ATTACKER's own seat (*"You may
    // switch this Pokémon with 1 of your Benched Pokémon."*) and had to decide
    // what an EMPTY Bench does under an `optional` wrapper, because `optional`
    // ALWAYS parks while the inner op no-ops silently at zero candidates. It chose
    // to ACCEPT the ask, "for consistency with the shipped mirror" — and the
    // shipped mirror's empty-Bench board was asserted nowhere. Two cases up, the
    // BARE sentence's empty-Bench board IS driven (`toHaveLength(0)` on
    // `ATTACK_EFFECT_SKIPPED`), but the bare op never asks, so it says nothing at
    // all about the wrapped one.
    //
    // ⚠️ CITING AN UNPINNED PRECEDENT IS HOW A FALSE CLAIM PROPAGATES, so it is
    // pinned here, in the file that owns the sentence, rather than only in D422's.
    // The behaviour is the SAME on both seats and now both are boards.
    const state = ready(53, 1, 0);
    const before = [activeUid(state, "p1"), activeUid(state, "p2")];
    expect(state.players.p2.bench).toHaveLength(0);
    const { state: confirming } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: WINDING_WAVES,
    });
    // ASKED — on a board where the answer cannot matter.
    if (confirming.phase.kind !== "effect:choose") throw new Error("expected a confirm park");
    expect(confirming.phase.prompt.kind).toBe("confirm");
    expect(confirming.phase.answerer).toBeUndefined();
    // The YES: nothing moves, nobody is asked again, and the attack was USED.
    const { state: done, events } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect([activeUid(done, "p1"), activeUid(done, "p2")]).toEqual(before);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
    // ⚠️ THE CONTROL THAT MAKES THE ABOVE MEAN SOMETHING: the SAME seed with a
    // STOCKED opponent Bench reaches the opponent's park off the same YES. Without
    // it, "the yes did nothing" would be equally true of a broken wrapper.
    const { state: stocked } = mustApply(ready(53, 1, 2), {
      type: "attack",
      seat: "p1",
      index: WINDING_WAVES,
    });
    const { state: reached } = mustApply(stocked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    if (reached.phase.kind !== "effect:choose") throw new Error("expected the opponent park");
    expect(reached.phase.answerer).toBe("p2");
  });

  it("a DECLINE moves nobody and ends the turn — the opponent is never asked", () => {
    const state = ready(52, 1, 3);
    const wasActive = activeUid(state, "p2");
    const { state: confirming } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: WINDING_WAVES,
    });
    const { state: done, events } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p2")).toBe(wasActive);
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });
});

describe("end to end — Iron Bundle's compound, and the gate that is not decoration", () => {
  it("switches the ATTACKER, then hands the OPPONENT their own question", () => {
    const state = ready(61, 2, 3);
    const attacker = activeUid(state, "p1");
    const { state: ownPark } = mustApply(state, { type: "attack", seat: "p1", index: INTERJET });
    // Question one: the attacker's own Bench, answered by the attacker.
    if (ownPark.phase.kind !== "effect:choose") throw new Error("expected the self-switch park");
    expect(ownPark.phase.answerer).toBeUndefined();
    if (ownPark.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(ownPark.phase.prompt.candidates.every((ref) => ref.seat === "p1")).toBe(true);
    // ⚠️ AND THE NOTE CARRIES THE CONSEQUENCE, because `withConsequence` found the
    // gate reading this op's slot. Without the `describeBranch` arm the dialog
    // would describe half the card.
    expect(ownPark.phase.prompt.note).toBe(
      "Switch to which Benched Pokémon? If you do, switch out your opponent's Active Pokémon to the Bench.",
    );

    // Question two: the opponent's Bench, answered by the opponent.
    const { state: oppPark } = mustApply(ownPark, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    expect(activeUid(oppPark, "p1")).not.toBe(attacker);
    if (oppPark.phase.kind !== "effect:choose") throw new Error("expected the gated park");
    expect(oppPark.phase.answerer).toBe("p2");
    expect(oppPark.phase.prompt.note).toBe("Choose your new Active Pokémon.");
  });

  it("🛑 an EMPTY attacker Bench skips the consequent — the gate driven, not argued", () => {
    // ⚠️ THE FIRST BOARD ON WHICH `parkOrForce`'s ZERO-CANDIDATE ENDING IS
    // OBSERVABLE. D189 made it REACHABLE from an attack; nothing until this card
    // could SEE the difference, because no printing put a §9.2 gate behind it. The
    // antecedent files nothing, `recordGateHolds` reads the empty slot as false,
    // and the opponent is never asked — which is the printed "If you do".
    const state = ready(62, 0, 3);
    const attacker = activeUid(state, "p1");
    const wasActive = activeUid(state, "p2");
    expect(state.players.p1.bench).toHaveLength(0);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: INTERJET });
    expect(activeUid(done, "p1")).toBe(attacker); // nobody switched
    expect(activeUid(done, "p2")).toBe(wasActive); // …so nobody was pushed out
    expect(done.phase.kind).not.toBe("effect:choose"); // …and nothing was asked
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
    // The attack was USED — the gate is a printed condition, not a failure.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
    // ⚠️ THE CONTROL THAT MAKES THE CASE ABOVE MEAN SOMETHING: the SAME board with
    // ONE benched body runs the consequent all the way to the opponent's park. If
    // the gate were vacuous both boards would look alike; they do not.
    const { state: reached } = mustApply(ready(62, 1, 3), {
      type: "attack",
      seat: "p1",
      index: INTERJET,
    });
    if (reached.phase.kind !== "effect:choose") throw new Error("expected the gated park");
    expect(reached.phase.answerer).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE SEAM — what this op does NOT reach
// ─────────────────────────────────────────────────────────────────────────────

describe("the seam — the gates and surfaces this op deliberately does not touch", () => {
  it("`programPlayable` gets NO arm, because no card PLAY can reach the op", () => {
    // `gust` has one (an empty opponent Bench makes Boss's Orders unplayable), and
    // copying it here would have been the vacuous guard conventions.md forbids:
    // this op is derived from ATTACK text only, and §8 declares an attack against
    // its ENERGY COST, never against whether its effect can accomplish anything.
    // Driven both ways so the asymmetry is a fact rather than a plan.
    const state = ready(71, 1, 0);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(programPlayable(state, [{ op: "gust" }], "p1")).toBe(false);
    expect(programPlayable(state, [{ op: "opponentSwitchOut" }], "p1")).toBe(true);
    // …and the ATTACK on the same board is used, not refused — the difference the
    // predicate above is about.
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: KICK_AWAY });
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    // No registry row prints this op today, which is what keeps the arm's absence
    // honest rather than lucky.
    const authored = Object.keys(FIXTURE_POOL).filter((id) =>
      [
        ...(programFor(id)?.trainer ?? []),
        ...(programFor(id)?.abilities ?? []).flatMap((a) => a.program),
      ].some((op) => op.op === "opponentSwitchOut"),
    );
    expect(authored).toEqual([]);
  });

  it("carries NO `recordAs`, and the absence is a fact about the catalog", () => {
    // Its two siblings both record, because a printed "If you do" reads their
    // result. No printing puts THIS op on the antecedent side — Iron Bundle puts it
    // on the consequent — so a slot here would be a field no gate could read and
    // no test could kill.
    const bare = deriveAttackEffect(CLAUSES[BARE].text)?.[0];
    expect(bare).toEqual({ op: "opponentSwitchOut" });
    expect(Object.keys(bare ?? {})).toEqual(["op"]);
    // The two that DO record, for contrast — read off the shipped programs.
    expect(programFor("sv05-157")?.trainer?.[0]).toEqual({ op: "gust", recordAs: "moved" });
    expect(deriveAttackEffect(CLAUSES[COMPOUND].text)?.[0]).toHaveProperty("recordAs");
  });
});
