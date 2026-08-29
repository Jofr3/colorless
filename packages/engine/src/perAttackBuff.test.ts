import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import { boostedAttackDamage } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PER_ATTACK_BUFF_DECK,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.102.0 → 0.103.0 — the PER-ATTACK DAMAGE BUFF (P3-M5 long tail, D155):
//
//   "During your next turn, this Pokémon's {AttackName} attack does {N} more
//    damage (before applying Weakness and Resistance)."
//
// Taken as item 1a of D154's remainder list, which priced it as "the cheapest
// item on this page" with the code open — and it is: D154 built the ADDRESSING
// and D149 built the READ STEP, so the slice is one anchor, one op, one field,
// one reader and one term.
//
// ⚠️ THE POPULATIONS ARE NAMED, AND THE ROW COUNT EVERY EARLIER CENSUS QUOTED IS
// WRONG. D154's finding was that the local D1 holds FIVE sets and `FIXTURE_POOL`
// fields cards from a sixth, so a census owes its SCOPE. Re-running it here found
// the other half: the catalog holds **890 rows**, not the 978 repeated in roughly
// twenty census comments in `effects.ts` (`select set_id, count(*) from cards
// group by set_id` → sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24, and
// `select count(*) from cards` → 890, against a file last written 2026-07-27).
// Nothing behavioural turns on it; what turns on it is that a number copied
// forward through twenty comments was never the number any of them measured.
//
// Against those 890 rows and all three text columns, `more damage (before
// applying` returns ONE row, and `FIXTURE_POOL` was swept SEPARATELY and returned
// none — so unlike D154 there is no fielded-but-uncatalogued sibling. The mirror
// family (`less damage (before applying`) returns FIVE rows, which makes D149's
// "5 printings" FOUR in the catalog and §D151's "six rows" FIVE: both counted
// Pidove swsh10.5-061, of fixture provenance. Same failure, same direction.
//
// ⚠️ AND SEE D160/D162 — THIS IS THE ONE HEADER IN THE FAMILY WHOSE CENSUS DID NOT
// SURVIVE THE RE-RUN INTACT, SO READ THE PARAGRAPH ABOVE AS PROVENANCE AND NOT AS
// A COUNT. The 890 / 5 is the OUTAGE-WINDOW catalog: the local D1 had silently
// dropped all 88 `swsh10.5` rows to an uncheckpointed WAL, D160 re-ingested them
// (978 rows / 6 sets) and re-ran this census against the restored catalog. This
// slice's OWN anchor is untouched — `more damage (before applying` still returns
// exactly ONE row (Seismitoad sv03-052). But BOTH downward corrections above
// REVERSE: `less damage (before applying` returns SIX rows and not five (Pidove
// swsh10.5-061 is CATALOGUED, not of fixture provenance), so §D149's "5 printings"
// and §D151's "six rows" were EXACT all along and the corrections to FOUR and FIVE
// were the missing set speaking. D160's generalisation, and this paragraph is its
// worked example: a count a query cannot reproduce is not thereby WRONG — the
// query owes its SCOPE.
//
// Four things the slice turns on:
//
//   • THE RECORD IS D154's WITH ONE KEY ADDED, AND IS STILL A SECOND FIELD. This
//     is the first time in this family that D131's widen-don't-add test PASSES on
//     the shape, so the refusal is made on the READ: `lockedAttackIndex`'s consumer
//     REFUSES the index it returns and this one PAYS it, so one field would bar
//     the very attack the card bought. Driven on one body, not argued;
//   • IT IS A SECOND TERM AND NOT A FOLD INTO `attackerPreWRBonus`, on exactly ONE
//     of D149's three grounds — that function scans `passivesOf`, which a §9
//     Ability-lock aura SUPPRESSES — and the pool cannot build the board that
//     shows it, so a fixture does (`fix-booster-ability` + Ting-Lu ex);
//   • IT REPORTS IN THE EXISTING `DAMAGE_DEALT.bonus` FIELD, where D149's debuff
//     needed one of its own. The row carries one number per STEP AND DIRECTION —
//     `reduction` has summed catalog + installed since D147, `debuff` installed +
//     aura since D151 — so a new field would be the first split by SOURCE;
//   • IT GATES NO ACTION, which is checked rather than assumed: both projections
//     publish the attack's PRINTED damage string, which no pre-W/R adjustment has
//     ever moved.

/** The ONE catalogued sentence, byte-for-byte off the local D1 row. */
const ECHOED_VOICE =
  "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).";
/** …and the constructed two-attack witness's, because the printing has ONE attack
    and "the buff is on the ATTACK" is unobservable on a card with one index. */
const ECHO_CHORUS =
  "During your next turn, this Pokémon's Echo Chorus attack does 100 more damage (before applying Weakness and Resistance).";

/** Seismitoad's only attack, spelled as a constant so a case that means "index 0
    because it is the boosted one" cannot be read as "index 0 because everything
    is index 0" (D144's trap, and this card is the shape that hides it). */
const ECHOED_VOICE_INDEX = 0;
/** fix-echoer's pair: the buff names index 1 and index 0 is a plain 20. */
const ECHO_CHORUS_INDEX = 1;
const ECHO_TAP_INDEX = 0;

/** One seed for the whole suite: nothing in this family flips a coin — the one
    printing carries none — so a seed table would describe a shuffle rather than a
    rule (D143's move, inherited by every durated slice since). */
const SEED = 21;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

/** Run a one-op program from P1's chair as an ATTACK's effect — the shape the
    CONSTRUCTED cases need (`preventBlock.test.ts`'s move). The op never parks, so
    the run is always `done` and the assertion says so rather than assuming it. */
function runOne(state: GameState, program: readonly EffectOp[], events: GameEvent[]): GameState {
  const result = runProgram(state, program, { seat: "p1", invokedBy: "attack" }, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    BOOSTER goes on P1's Active with the {W} its attacks cost; P2 fields fix-titan
    (340 HP, NO attacks) so nothing here ends in `ko:takePrizes` before a window
    opens — and so the KO-boundary case below has a body that can survive one
    unboosted swing. */
function ready(booster: string, water = 3): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: PER_ATTACK_BUFF_DECK, p2: PER_ATTACK_BUFF_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", booster);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return attachFromDeck(state, "p1", "fix-water-energy", water);
}

/** `ready`, then the named attack DECLARED — asserting the row actually landed,
    so a board that failed to install can never leave a case asserting a number
    against nothing. Returns P2's turn (the turn BEFORE the window). */
function boosted(booster: string, index: number, water?: number) {
  const { state, events } = mustApply(ready(booster, water), {
    type: "attack",
    seat: "p1",
    index,
  });
  const row = find(events, "ATTACK_BOOSTED");
  if (row === undefined) throw new Error(`${booster} idx ${String(index)} boosted nothing`);
  return { state, events, row };
}

/** …and one more turn on, which IS the window (the stamp is `+ 2`). */
function inWindow(state: GameState): GameState {
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The datum: the catalog row, the fixtures, and the deriver.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried, not inherited", () => {
  it("carries Seismitoad's NAME, attack INDEX and effect string verbatim", () => {
    // ⚠️ EVERY FIELD, INCLUDING THE ONES THE ROW DOES NOT HAVE (D151's rule after
    // 40 pool fixtures turned out to be missing a printed Ability or attack). The
    // card is NEW to the pool at D155, so there is no partial fixture to inherit —
    // but the absences are asserted anyway, because that is the assertion a later
    // completion would move.
    const toad = FIXTURE_POOL["sv03-052"];
    expect(toad?.name).toBe("Seismitoad");
    expect(toad?.hp).toBe(170);
    expect(toad?.stage).toBe("Stage2");
    expect(toad?.evolveFrom).toBe("Palpitoad");
    expect(toad?.types).toEqual(["Water"]);
    expect(toad?.retreat).toBe(3);
    expect(toad?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(toad?.resistances ?? null).toBeNull();
    // Its printed Ability IS on the fixture though nothing reads it — "Quaking
    // Zone" is a cross-board attack-COST aura this engine has no shape for, and
    // the fixture carries what the card prints (D151's rule, which avoids both of
    // that census's failure modes at once).
    expect(toad?.abilities?.[0]?.name).toBe("Quaking Zone");
    expect(toad?.abilities?.[0]?.effect).toContain("cost {C} more");
    // ONE attack, which is the fact that forced a constructed witness below.
    expect(toad?.attacks).toHaveLength(1);
    expect(toad?.attacks?.[ECHOED_VOICE_INDEX]).toEqual({
      cost: ["Water", "Water"],
      name: "Echoed Voice",
      damage: 120,
      effect: ECHOED_VOICE,
    });
  });

  it("derives ONE op with BOTH captures — the name and the amount", () => {
    expect(deriveAttackEffect(ECHOED_VOICE)).toEqual([
      { op: "boostAttack", attack: "Echoed Voice", amount: 100 },
    ]);
    // …and the constructed witness's sentence, which differs in the captured noun
    // alone: two names through one anchor is what makes the capture a capture
    // rather than a literal (D120's "does exactly one token vary?" answered by the
    // pool for the amount and by the fixture for the name).
    expect(deriveAttackEffect(ECHO_CHORUS)).toEqual([
      { op: "boostAttack", attack: "Echo Chorus", amount: 100 },
    ]);
  });

  it("folds the CAPTURE's apostrophes — pinned by a constructed sentence", () => {
    // D137's contract is that a punctuation-normalising re-ingest produces the
    // SAME VALUE, and this anchor's capture is a proper noun that can carry one.
    // No printing exercises it ("Echoed Voice" is straight and so is every other
    // attack name in the family), and `clauseApostrophe.test.ts` sweeps what the
    // FIXTURES print — so the claim is pinned here, on a sentence nobody prints,
    // rather than left to a sweep that structurally cannot reach it.
    //
    // The INSTALL-side half of the same fold is not re-pinned here: D154's
    // `fix-curly-barrer` already witnesses it, and since D155 both ops resolve the
    // printed noun through ONE helper (`printedAttackIndex`, interpreter.ts), so
    // that one card is load-bearing for both.
    const straight =
      "During your next turn, this Pokémon's Slip 'n' Roll attack does 40 more damage (before applying Weakness and Resistance).";
    const curly = straight.replaceAll("'", "’");
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(straight));
    expect(deriveAttackEffect(curly)).toEqual([
      { op: "boostAttack", attack: "Slip 'n' Roll", amount: 40 },
    ]);
  });

  it("matches a CURLY printed attack name and prints the CARD's spelling", () => {
    // ⚠️ THIS CASE EXISTS BECAUSE A MUTATION SURVIVED, WHICH IS D154's RULE PAYING
    // OUT ON THE SLICE THAT INHERITED IT. The install writes the RESOLVED row's own
    // `name` onto the log row rather than the op's folded token; mutating that to
    // print the token failed NOTHING, because every attack name this anchor reaches
    // in the pool is spelled straight. `fix-curly-booster` is the witness — a card
    // whose attack NAME and effect string are both U+2019, i.e. what a
    // punctuation-normalising re-ingest actually produces.
    //
    // The sentence folds to the straight spelling (so the op matches), the shared
    // resolver folds the card's `name` (so the index resolves), and the ROW prints
    // the card's own curly spelling (so a player holding the card reads back the
    // words on it). Three different lines, one board.
    const { events } = boosted("fix-curly-booster", 1, 2);
    expect(
      deriveAttackEffect(FIXTURE_POOL["fix-curly-booster"]?.attacks?.[1]?.effect ?? ""),
    ).toEqual([{ op: "boostAttack", attack: "Slip 'n' Roll", amount: 100 }]);
    expect(find(events, "ATTACK_BOOSTED")?.attack).toBe("Slip ’n’ Roll");
  });

  it("the anchor refuses the whole neighbourhood, and each refusal is a warrant", () => {
    for (const text of [
      // A printed ZERO: it would install a record that changes no arithmetic and
      // emit a row announcing a bonus that does not exist — worse than an unread
      // sentence, so it stays LOUD (every neighbouring arm's guard).
      "During your next turn, this Pokémon's Echoed Voice attack does 0 more damage (before applying Weakness and Resistance).",
      // The OTHER parenthetical, which is the whole taxonomy: the same sentence
      // reading "(after applying …)" is a different STEP and this anchor must not
      // reach it. The pool prints no such sentence at all, which is why it is
      // constructed here and refused on sight.
      "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (after applying Weakness and Resistance).",
      // No parenthetical at all — the step unstated, which is a sentence this
      // engine has no place to put.
      "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage.",
      // The OPPONENT-side reading, which the pool does not print anywhere. It is
      // refused on the subject noun phrase, exactly as `weakenDefenderAttacks`'s
      // pair is refused by the self anchors: a `target` field with one reachable
      // value would be a second way to say the op's own name.
      "During your opponent's next turn, the Defending Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
      // The lowercase mid-sentence form a gated printing would carry — the guard
      // the capitalised "During" plus `^…$` is, and the reason no /i appears
      // anywhere in this file (effects.ts's standing note).
      "Flip a coin. If heads, during your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // …and the THREE neighbours that DERIVE, asserted as different programs rather
    // than as nulls, because a `toBeNull` here would be false and a drift between
    // them is invisible on any board. The per-attack BAR is one verb away and
    // writes a different FIELD; the pre-W/R DEBUFF is one word away inside the
    // parenthetical and points at the other body; the incoming REDUCTION is the
    // other parenthetical entirely.
    expect(
      deriveAttackEffect("During your next turn, this Pokémon can't use Echoed Voice."),
    ).toEqual([{ op: "preventAttackUse", attack: "Echoed Voice" }]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, the Defending Pokémon's attacks do 20 less damage (before applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "weakenDefenderAttacks", amount: 20 }]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "reduceDamage", amount: 30 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The install: the record, the row, and the `+ 2` window.
// ─────────────────────────────────────────────────────────────────────────────

describe("the install — the address is resolved once, by the helper D154 wrote", () => {
  it("stamps { turn: +2, attackIndex, amount } and names the attack on the row", () => {
    const before = ready("sv03-052");
    expect(before.turn).toBe(2);
    const uid = activeUid(before, "p1");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: ECHOED_VOICE_INDEX,
    });
    expect(find(events, "ATTACK_BOOSTED")).toEqual({
      type: "ATTACK_BOOSTED",
      seat: "p1",
      uid,
      attack: "Echoed Voice",
      amount: 100,
    });
    // The RECORD, and its three halves are three different claims: the stamp is
    // the installing turn + 2 (D143's number, the holder's own next turn), the
    // index is the resolution of the printed noun, and the amount is the capture.
    expect(state.players.p1.active?.boostedAttack).toEqual({
      turn: 2 + 2,
      attackIndex: ECHOED_VOICE_INDEX,
      amount: 100,
    });
    // …and NOT the per-attack BAR, which is the field a shared record would have
    // written and the one thing no board can tell apart from this one by shape.
    expect(state.players.p1.active?.lockedAttacks).toEqual([]);
  });

  it("the ROW ORDER is the printed order — the damage, then the rider", () => {
    const { events } = boosted("sv03-052", ECHOED_VOICE_INDEX);
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_BOOSTED"));
  });

  it("installs NOTHING when the printed name matches no attack on the holder", () => {
    // Unreachable off the one printing — it names its own attack — so it is a
    // CONSTRUCTED case and it is pinned as one. A bonus on an attack the card does
    // not have is inert, and the honest representation of inert is ABSENCE: no
    // record, and NO ROW, because a row would tell a player about a payoff that
    // cannot arrive (D140/D146).
    const state = ready("sv03-052");
    const events: GameEvent[] = [];
    const after = runOne(state, [{ op: "boostAttack", attack: "Surf", amount: 100 }], events);
    expect(after.players.p1.active?.boostedAttack ?? null).toBeNull();
    expect(types(events)).toEqual([]);
  });

  it("never PARKS and consumes no rng", () => {
    const before = ready("sv03-052");
    const { state } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: ECHOED_VOICE_INDEX,
    });
    // Nothing is asked, so the turn ends inline (§5.3) rather than stopping on a
    // prompt — and the rng cursor is untouched, which is what makes the whole
    // suite seed-insensitive beyond the shuffle.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.rngState).toBe(before.rngState);
  });

  it("a re-install that says the SAME thing is silent; a larger amount wins", () => {
    // Unreachable off the one printing (an attack ends the turn and the window is
    // the holder's own next turn), so this is constructed — and it is the case
    // that separates this op's merge from `preventAttackUse`'s. That record has no
    // number, so a re-install is a bare early return; this one carries one, so the
    // rule is `reduceDamage`'s `Math.max`: a second installation may never leave
    // the holder with less than one of them printed.
    const state = ready("sv03-052");
    const first: GameEvent[] = [];
    const once = runOne(state, [{ op: "boostAttack", attack: "Echoed Voice", amount: 100 }], first);
    expect(types(first)).toEqual(["ATTACK_BOOSTED"]);

    const same: GameEvent[] = [];
    const twice = runOne(once, [{ op: "boostAttack", attack: "Echoed Voice", amount: 100 }], same);
    expect(types(same)).toEqual([]);
    expect(twice.players.p1.active?.boostedAttack).toEqual(once.players.p1.active?.boostedAttack);

    const bigger: GameEvent[] = [];
    const merged = runOne(
      once,
      [{ op: "boostAttack", attack: "Echoed Voice", amount: 150 }],
      bigger,
    );
    expect(find(bigger, "ATTACK_BOOSTED")?.amount).toBe(150);
    expect(merged.players.p1.active?.boostedAttack?.amount).toBe(150);
    // …and a SMALLER one changes nothing and says nothing, which is the half of
    // `Math.max` a `?:` would get wrong in the direction nobody looks at.
    const smaller: GameEvent[] = [];
    const kept = runOne(
      merged,
      [{ op: "boostAttack", attack: "Echoed Voice", amount: 20 }],
      smaller,
    );
    expect(types(smaller)).toEqual([]);
    expect(kept.players.p1.active?.boostedAttack?.amount).toBe(150);
  });

  it("a re-install naming a DIFFERENT attack replaces the record outright", () => {
    // The merge is per-ADDRESS and not per-BODY: the amount is a property of the
    // pair, so keeping the larger of two bonuses on two different attacks would be
    // a rule about which sentence was declared last (D154's own refusal of a
    // merge rule, on the number instead of the index). Constructed — the pool
    // prints one of these sentences.
    const state = ready("fix-echoer", 4);
    const events: GameEvent[] = [];
    let after = runOne(state, [{ op: "boostAttack", attack: "Echo Chorus", amount: 150 }], events);
    after = runOne(after, [{ op: "boostAttack", attack: "Echo Tap", amount: 30 }], events);
    expect(after.players.p1.active?.boostedAttack).toEqual({
      turn: 4,
      attackIndex: ECHO_TAP_INDEX,
      amount: 30,
    });
    // …so INSIDE the window the previously boosted index is worth nothing again,
    // read through the reader rather than off the field (the reader is where the
    // turn comparison lives, so a case that only read the record would not have
    // asserted the rule).
    const window = inWindow(must(applyAction(after, { type: "endTurn", seat: "p1" })));
    const body = must0(window.players.p1.active);
    expect(boostedAttackDamage(window, body, ECHO_CHORUS_INDEX)).toBe(0);
    expect(boostedAttackDamage(window, body, ECHO_TAP_INDEX)).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The window — the holder's own next turn, driven across real turn boundaries.
// ─────────────────────────────────────────────────────────────────────────────

describe("the window is the HOLDER's own next turn — driven, not asserted", () => {
  it("is not live in between, is live on the holder's next turn, and expires", () => {
    const { state: installed } = boosted("sv03-052", ECHOED_VOICE_INDEX);
    const body = () => must0(installed.players.p1.active);
    // Installed on turn 2, stamped 4. Turn 3 is the OPPONENT's.
    expect(installed.turn).toBe(3);
    expect(boostedAttackDamage(installed, body(), ECHOED_VOICE_INDEX)).toBe(0);

    const window = inWindow(installed);
    expect(window.turn).toBe(4);
    expect(boostedAttackDamage(window, must0(window.players.p1.active), ECHOED_VOICE_INDEX)).toBe(
      100,
    );

    let later = must(applyAction(window, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(6);
    // A stamp whose window has passed simply stops answering — nobody cleared it,
    // and the record is still there (D124's rule, asserted on both halves).
    expect(later.players.p1.active?.boostedAttack).toEqual({
      turn: 4,
      attackIndex: ECHOED_VOICE_INDEX,
      amount: 100,
    });
    expect(boostedAttackDamage(later, must0(later.players.p1.active), ECHOED_VOICE_INDEX)).toBe(0);
  });

  it("a `+ 1` stamp would be a bonus that never arrives — D143's failure inverted", () => {
    // The mirror of the trap D143 named: `+ 1` names the OPPONENT's turn, on which
    // the holder cannot attack at all, so the whole payoff the card is balanced
    // around would silently never happen and nothing would look wrong. Asserted as
    // arithmetic on the record rather than by rebuilding the engine: the stamp is
    // two away from the install and the turn in between belongs to the other seat.
    const { state } = boosted("sv03-052", ECHOED_VOICE_INDEX);
    const stamp = must0(state.players.p1.active).boostedAttack?.turn;
    expect(stamp).toBe(4);
    // Turn 3 is the turn a `+ 1` stamp would have named, and P1 cannot declare on
    // it at all — asserted through the engine's own refusal rather than off turn
    // parity, so the claim is "the holder could not have used it", which is the
    // whole of why the window has to be two away.
    expect(state.turn).toBe(3);
    const refused = applyAction(state, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("WRONG_SEAT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The buff is on the ATTACK — the claim the one printing cannot make.
// ─────────────────────────────────────────────────────────────────────────────

describe("the bonus is addressed to ONE index", () => {
  it("pays the named attack and NOT its sibling, on one body on one turn", () => {
    // ⚠️ THE CENTRAL CLAIM OF THE SLICE, AND IT IS UNOBSERVABLE ON THE PRINTING.
    // Seismitoad has one attack, so a build that keyed the record on the BODY
    // would pass every case above. `fix-echoer` is the constructed two-attack
    // witness: the sentence on index 1 names index 1, and index 0 is a plain 20.
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    const boostedHit = mustApply(window, {
      type: "attack",
      seat: "p1",
      index: ECHO_CHORUS_INDEX,
    });
    const paid = find(boostedHit.events, "DAMAGE_DEALT");
    expect(paid?.base).toBe(100);
    expect(paid?.bonus).toBe(100);
    expect(paid?.dealt).toBe(200);

    // …the SIBLING, on the same body inside the same window, from a board that is
    // byte-identical up to the declaration.
    const plainHit = mustApply(window, { type: "attack", seat: "p1", index: ECHO_TAP_INDEX });
    const unpaid = find(plainHit.events, "DAMAGE_DEALT");
    expect(unpaid?.base).toBe(20);
    expect(unpaid?.bonus).toBeUndefined();
    expect(unpaid?.dealt).toBe(20);
  });

  it("one body carries the BAR and the BUFF at once — why the record is not shared", () => {
    // ⚠️ THE DRIVEN FORM OF D155's DESIGN ANSWER. D131's widen-don't-add test
    // PASSES on the shape here — `{ turn, attackIndex, amount }` minus `amount` is
    // D154's record byte for byte — so the refusal has to be made on the READ, and
    // this is it: `lockedAttackIndexes`'s consumer REFUSES the index it returns and
    // `boostedAttackDamage`'s PAYS it. One field would hand `attack.ts`'s §8 gate
    // the index of the attack the card just bought.
    //
    // CONSTRUCTED, and said so: the two sentences are printed on different cards,
    // so no line of play puts both on one body. What the board proves is that the
    // engine keeps them apart, which is the property a merged field would lose.
    const state = ready("fix-echoer", 4);
    const events: GameEvent[] = [];
    let armed = runOne(state, [{ op: "boostAttack", attack: "Echo Chorus", amount: 100 }], events);
    armed = runOne(armed, [{ op: "preventAttackUse", attack: "Echo Tap" }], events);
    expect(must0(armed.players.p1.active).boostedAttack).toEqual({
      turn: 4,
      attackIndex: ECHO_CHORUS_INDEX,
      amount: 100,
    });
    expect(must0(armed.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: ECHO_TAP_INDEX },
    ]);

    const window = inWindow(must(applyAction(armed, { type: "endTurn", seat: "p1" })));
    expect(window.turn).toBe(4);
    // The BARRED index is refused…
    const refused = applyAction(window, { type: "attack", seat: "p1", index: ECHO_TAP_INDEX });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("ATTACK_PREVENTED");
    // …and the BOOSTED one resolves, at +100. A single shared field could produce
    // at most one of these two lines.
    const paid = mustApply(window, { type: "attack", seat: "p1", index: ECHO_CHORUS_INDEX });
    expect(find(paid.events, "DAMAGE_DEALT")?.dealt).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The §8.5 step — the printed parenthetical, and the field the row reports in.
// ─────────────────────────────────────────────────────────────────────────────

describe("it lands BEFORE Weakness and Resistance — driven both ways", () => {
  it("Skeledirge ex takes 240 unboosted and 440 boosted, and the order is the difference", () => {
    // ⚠️ THE BOARD IS TWO CARDS AND NO SURGERY. Skeledirge ex sv02-037 is 340 HP
    // and ×2 WATER; Seismitoad's Echoed Voice is a printed 120 Water.
    //   printed order  : (120 + 100) × 2 = 440
    //   reversed order :  120 × 2 + 100  = 340
    // Both are lethal here, so the KO is not the witness — the NUMBER is, and it is
    // re-derived from the row's own reported fields in BOTH placements through the
    // engine's own `applyDamageModifier` (D149's oracle, inherited).
    let state = ready("sv03-052", 4);
    state = setActiveFromDeck(state, "p2", "sv02-037");
    const unboosted = mustApply(state, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    const first = find(unboosted.events, "DAMAGE_DEALT");
    expect(first?.bonus).toBeUndefined();
    expect(first?.dealt).toBe(240);
    // …and it SURVIVES, which is what makes the boosted swing below a change of
    // outcome and not only of arithmetic.
    expect(unboosted.state.players.p2.active?.damage).toBe(240);

    const window = inWindow(unboosted.state);
    let armed = setActiveFromDeck(window, "p2", "sv02-037");
    armed = attachFromDeck(armed, "p1", "fix-water-energy", 0);
    const hit = mustApply(armed, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    const row = find(hit.events, "DAMAGE_DEALT");
    expect(row?.base).toBe(120);
    expect(row?.bonus).toBe(100);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe(440);

    // The oracle: the same reported fields, both placements, asserted to DIFFER —
    // so the parenthetical is load-bearing rather than decorative on this board.
    const base = row?.base ?? 0;
    const bonus = row?.bonus ?? 0;
    const printed = applyDamageModifier(base + bonus, row?.weakness ?? null);
    const reversed = applyDamageModifier(base, row?.weakness ?? null) + bonus;
    expect(printed).toBe(440);
    expect(reversed).toBe(340);
    expect(row?.dealt).toBe(printed);
  });

  it("commutes with RESISTANCE, which is why only Weakness makes the order visible", () => {
    // Pinned as arithmetic on the engine's own modifier, D149's move: Resistance
    // subtracts, this number adds, and two additions commute. So a board with a
    // Resistance and no Weakness cannot tell the two placements apart, and a suite
    // that only drove one would be measuring nothing.
    const resistance = { op: "subtract", amount: 30 } as const;
    expect(applyDamageModifier(120 + 100, resistance)).toBe(
      applyDamageModifier(120, resistance) + 100,
    );
  });

  it("the KO boundary is two printed declarations — 120, then a boosted 220", () => {
    // fix-titan is 340 HP with NO attacks. Unboosted, two Echoed Voices are 240 and
    // it lives; the second one boosted is 220, and 120 + 220 is exactly 340. The
    // buff is the whole difference between a survivable exchange and a Knock Out,
    // driven off printed numbers rather than asserted off the record.
    const { state: installed } = boosted("sv03-052", ECHOED_VOICE_INDEX, 4);
    expect(installed.players.p2.active?.damage).toBe(120);
    const window = inWindow(installed);
    const { state: after, events } = mustApply(window, {
      type: "attack",
      seat: "p1",
      index: ECHOED_VOICE_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(220);
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(after.players.p2.active?.damage ?? 340).toBe(340);
  });

  it("SUMS with the catalog half into ONE `bonus` field — the row's standing shape", () => {
    // ⚠️ THIS IS THE REPORTED-FIELD DECISION AS A BOARD. `reduction` has summed a
    // catalog half with an attack-installed one since D147 and `debuff` an
    // installed half with an aura since D151, so the row carries one number per
    // STEP AND DIRECTION rather than one per card. A new `boost` field would have
    // been the first split by SOURCE — and D149's `debuff` is a second field
    // because it is the other DIRECTION, which is the distinction this case pins.
    let state = ready("sv03-052", 4);
    state = attachToolFromDeck(state, "p1", "active", "sv01-197"); // Vitality Band: +10 pre-W/R
    const installed = mustApply(state, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    // The install turn: the Tool alone.
    expect(find(installed.events, "DAMAGE_DEALT")?.bonus).toBe(10);

    const window = inWindow(installed.state);
    const { events } = mustApply(window, { type: "attack", seat: "p1", index: ECHOED_VOICE_INDEX });
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.bonus).toBe(110);
    expect(row?.dealt).toBe(230);
    // …and the log prints the SUM in one crumb, which is the reader-facing half of
    // the same decision.
    const line = render(events, window).find((r) => r.text.includes("boosted"));
    expect(line?.text).toContain("· boosted +110");
  });

  it("SURVIVES a §9 Ability lock that switches the catalog half OFF", () => {
    // ⚠️ THE ONE GROUND THAT DECIDES FOLD-vs-SECOND-TERM, AS A BOARD RATHER THAN A
    // PARAGRAPH. `attackerPreWRBonus` folds `passivesOf`, which SUPPRESSES the
    // holder's own printed passive under a §9 Ability-lock aura — and an attack
    // INSTALLATION must be immune, because an installation is not an Ability.
    // D149's other two grounds are silent for a number that only ever adds (a
    // positive is reported fine, and it can never drive the subtotal negative), so
    // this is the whole argument.
    //
    // ⚠️ AND THE POOL CANNOT BUILD THIS BOARD, WHICH IS WHY A FIXTURE DOES.
    // `damageBonusBeforeWR` has exactly ONE producer in the registry — Vitality
    // Band, a TOOL — and `passivesOf` suppresses only the holder's OWN printed
    // passive, so no printing can put a suppressible pre-W/R bonus on a body.
    // `fix-booster-ability` prints +30 as an Ability; Ting-Lu ex's "Cursed Land"
    // locks a DAMAGED non-ex Active. Both halves said out loud.
    let state = ready("fix-booster-ability", 3);
    state = setActiveFromDeck(state, "p2", "sv02-127");
    const events: GameEvent[] = [];
    const armed = runOne(state, [{ op: "boostAttack", attack: "Hum", amount: 100 }], events);
    const window = inWindow(must(applyAction(armed, { type: "endTurn", seat: "p1" })));

    // UNDAMAGED: the Ability is live, so the row reports 30 + 100 in one field.
    const free = mustApply(window, { type: "attack", seat: "p1", index: 0 });
    expect(find(free.events, "DAMAGE_DEALT")?.bonus).toBe(130);

    // DAMAGED: Cursed Land's `requiresDamage` gate is met, the printed Ability is
    // suppressed, and the INSTALLED half is untouched. A fold would have lost both.
    const locked = mustApply(setDamage(window, "p1", 10), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(find(locked.events, "DAMAGE_DEALT")?.bonus).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The log row.
// ─────────────────────────────────────────────────────────────────────────────

describe("the row renders under the seat that owns the boosted Pokémon", () => {
  it("names the attack and the number, read back under BOTH seats", () => {
    // ⚠️ RENDERED AND READ RATHER THAN REASONED ABOUT (D154's rule, which found a
    // row that was FALSE where a predecessor's was merely stilted). This op has no
    // defender arm, so the row is always the actor's own — ACTIVE voice, like
    // DAMAGE_REDUCTION_APPLIED's and RECOIL_ARMED's. The other seat is rendered
    // anyway, because "always the actor's own" is a claim about the OP and the
    // renderer cannot know it.
    const { state, events } = boosted("sv03-052", ECHOED_VOICE_INDEX);
    // The declaration ENDS the turn (§5.3), so the rendered batch runs on past the
    // rider into the opponent's draw — the row is found by its content rather than
    // by position, which is also what makes the assertion read as one claim.
    const rows = render(events, state);
    expect(rows.find((r) => r.text.includes("more damage next turn"))).toEqual({
      who: "p1",
      text: "Seismitoad's Echoed Voice does 100 more damage next turn",
    });

    // The same event filed under the OTHER seat: the wording is seat-INDEPENDENT
    // because "next turn" means the NAMED player's own next turn under this
    // family's seat rule, which is exactly what the `+ 2` stamp encodes (D148's
    // finding). Unreachable off any printing — the op has no defender arm — so it
    // is a constructed render, and it is what turns "always the actor's own" from
    // a claim about the op into a claim about the ROW.
    const installed = find(events, "ATTACK_BOOSTED");
    expect(installed).toBeDefined();
    expect(render(installed === undefined ? [] : [{ ...installed, seat: "p2" }], state)).toEqual([
      { who: "p2", text: "Seismitoad's Echoed Voice does 100 more damage next turn" },
    ]);
  });

  it("naming the attack is REQUIRED, not decoration — the bare row would be false", () => {
    // D154 found this on the bar and it is sharper on the buff: a fix-echoer whose
    // "Echo Chorus" is boosted still has an "Echo Tap" that is not, so a row saying
    // only "<name> does 100 more damage next turn" would promise a bonus on BOTH —
    // and false in the direction that makes a player declare the wrong attack.
    // Read as a pair on one body, which is the form the claim actually takes.
    const { state, events } = boosted("fix-echoer", ECHO_CHORUS_INDEX, 4);
    const text =
      render(events, state).find((r) => r.text.includes("more damage next turn"))?.text ?? "";
    expect(text).toContain("Echo Chorus");
    expect(text).not.toContain("Echo Tap");
    // …and the card really does have the other attack, so the row is narrowing
    // something rather than restating the whole body.
    expect(FIXTURE_POOL["fix-echoer"]?.attacks).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 sheds it — the three clears, and the sweep that keeps them together.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 sheds it — and here that is a LOSS rather than an escape", () => {
  it("EVOLVING inside the window throws the bonus away — a played line", () => {
    // The window is the HOLDER's own next turn, so this is a line a player takes —
    // and the FIRST entry on the §10 clear list that a player takes by MISTAKE.
    // The evolved body has ONE attack, so a stale index would pay a bonus to a
    // different attack on a different card: the failure ruled out is "boosted
    // somewhere else", not "still boosted".
    //
    // Constructed base, and said so: Seismitoad is a Stage 2 and the catalog prints
    // nothing that evolves from it, so this route needs `fix-echoer`.
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    expect(window.players.p1.active?.boostedAttack).toEqual({
      turn: 4,
      attackIndex: ECHO_CHORUS_INDEX,
      amount: 100,
    });
    const held = handFromDeck(window, "p1", "fix-echoer-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-echoer-stage1"),
      target: { spot: "active" },
    });
    expect(evolved.players.p1.active?.boostedAttack).toBeNull();
    // …and the evolved body's only attack pays nothing extra, which is the half a
    // surviving record would have got wrong invisibly.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.bonus).toBeUndefined();
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });

  it("RETREATING inside the window sheds it — the holder's own route", () => {
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    expect(window.players.p1.bench.length).toBeGreaterThan(0);
    const { state: retreated } = mustApply(window, {
      type: "retreat",
      seat: "p1",
      // fix-echoer's printed retreat is 1, so exactly one attached energy pays it.
      discardEnergy: must0(window.players.p1.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    const wasActive = retreated.players.p1.bench.at(-1);
    expect(wasActive?.boostedAttack ?? null).toBeNull();
  });

  it("a FORCED switch sheds it too — the opponent's route into the same clear", () => {
    // Boss's Orders played by the OPPONENT on the turn before the window: the body
    // leaves the Active Spot and the record goes with it. The same four literals
    // every durated field is on, which is why the set is SWEPT below.
    const state = handFromDeck(
      boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state,
      "p2",
      "sv02-172",
      1,
    );
    const boostedUid = activeUid(state, "p1");
    let gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    }).state;
    if (gusted.phase.kind === "effect:choose") {
      gusted = must(
        applyAction(gusted, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = gusted.players.p1.bench.find((p) => p.stack.includes(boostedUid));
    expect(benched).toBeDefined();
    expect(benched?.boostedAttack ?? null).toBeNull();
  });

  it("the clear-set is the SAME set every durated field is on — swept, not listed", () => {
    // D149's rule: the clear-set is literals that have to agree with nothing making
    // them. The sweep is STRUCTURAL — the ELEVEN durated keys (TEN before D434) are read off ONE body
    // that has been through the clear, so a literal that forgot the new field fails
    // on the field rather than on a board somebody remembered to write.
    // 🆕🆕 D432 — the NO-WEAKNESS bar joins the swept set. It is read STRUCTURALLY
    // here for the reason its own suite states: §8.5 applies Weakness only to the
    // ACTIVE, so once a body has been through a §10 clear there is no number left
    // that could witness the bar's absence. The field is the only witness there is.
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    const held = handFromDeck(window, "p1", "fix-echoer-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-echoer-stage1"),
      target: { spot: "active" },
    });
    // 🆕🆕 D434 — the SCHEDULED counter placement joins the swept set, and it is read
    // STRUCTURALLY for a reason of its own: the record's whole effect is in the
    // future, so after a §10 clear there is no number that could witness its absence
    // until a Checkup that will never place anything. The field IS the witness.
    const body = must0(evolved.players.p1.active);
    expect({
      attackBlock: body.attackBlock,
      attackLockedTurn: body.attackLockedTurn,
      retreatLockedTurn: body.retreatLockedTurn,
      damageReduction: body.damageReduction,
      noWeaknessTurn: body.noWeaknessTurn,
      scheduledEffect: body.scheduledEffect,
      attackDamageDebuff: body.attackDamageDebuff,
      installedRecoil: body.installedRecoil,
      lockedAttacks: body.lockedAttacks,
      boostedAttack: body.boostedAttack,
      retreatBlocked: body.retreatBlocked,
    }).toEqual({
      attackBlock: null,
      attackLockedTurn: null,
      retreatLockedTurn: null,
      damageReduction: null,
      noWeaknessTurn: null,
      scheduledEffect: null,
      attackDamageDebuff: null,
      installedRecoil: null,
      lockedAttacks: [],
      boostedAttack: null,
      retreatBlocked: false,
    });
  });

  it("a KO'd holder takes it out of play, and the promoted body carries nothing", () => {
    // The fourth literal (`makeInPlay`) read from the other end: a fresh body has
    // no record, so a bench Pokémon promoted after the boosted one dies is not
    // paid a bonus it never bought.
    // The install lands on P1's turn 2 and the record is stamped 4; the KO comes
    // on the OPPONENT's turn 3, i.e. INSIDE the gap and before the window opens,
    // which is the only sequencing a real board produces.
    let state = boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state;
    state = benchFromDeck(state, "p1", "fix-attacker");
    state = setDamage(state, "p1", 140); // fix-echoer is 150 HP; Bite is 30
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    let killed = mustApply(state, { type: "attack", seat: "p2", index: 0 }).state;
    expect(killed.phase.kind === "ko:promote" || killed.phase.kind === "ko:takePrizes").toBe(true);
    if (killed.phase.kind === "ko:takePrizes") {
      killed = must(applyAction(killed, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    }
    if (killed.phase.kind === "ko:promote") {
      killed = must(applyAction(killed, { type: "promote", seat: "p1", benchIndex: 0 }));
    }
    expect(killed.players.p1.active?.boostedAttack ?? null).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The projections — the question D154 owed and this slice does not.
// ─────────────────────────────────────────────────────────────────────────────

describe("it gates no ACTION, so it owes no payability projection", () => {
  it("leaves every attack row playable and the PRINTED damage unchanged", () => {
    // ⚠️ CHECKED RATHER THAN ASSUMED, WHICH IS THE POINT OF THE CASE. D154 was the
    // first durated field to change `redactedAttacksOf` and GameHud, so "a buff
    // probably gates nothing" is exactly the assumption that would have been worth
    // testing. It does not: nothing here refuses a declaration.
    //
    // And the panel deliberately does NOT show the number. Both projections publish
    // `attack.damage` straight off the catalog, which no pre-W/R adjustment has
    // ever moved — Vitality Band, Choice Belt, Defiance Band, Practice Studio and
    // Binding Mochi are all invisible there too — so surfacing this one alone would
    // report a single source of a number the panel does not claim to compute.
    const window = inWindow(boosted("fix-echoer", ECHO_CHORUS_INDEX, 4).state);
    const view = redactGame(window, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    for (const attack of view.attacks) expect(attack.playable, attack.name).toBe(true);
    expect(view.attacks[ECHO_CHORUS_INDEX]?.damage).toBe("100");
    expect(view.attacks[ECHO_TAP_INDEX]?.damage).toBe("20");
    // …and the engine agrees with the panel on both rows, which is the property
    // that matters: neither offers a button the server refuses.
    for (const index of [ECHO_TAP_INDEX, ECHO_CHORUS_INDEX]) {
      expect(applyAction(window, { type: "attack", seat: "p1", index }).ok).toBe(true);
    }
  });

  it("the OPPONENT's view is unchanged — the record leaks nothing across the wire", () => {
    const window = inWindow(boosted("sv03-052", ECHOED_VOICE_INDEX).state);
    const view = redactGame(window, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });
});
