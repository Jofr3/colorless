import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { lockedAttackIndexes } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, engineVersion, programFor, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  UNTIL_LEAVES_ACTIVE_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.322.0 → 0.323.0 — 🆕🆕 D421: THE UNTIL-IT-LEAVES-ACTIVE BAR, and the first
// entry in `InPlayPokemon.lockedAttacks` whose duration is a BOARD EVENT rather
// than a number.
//
//   "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot."
//
// **5 legal printings, ONE distinct sentence** — `censusAttackCorpus.ts` holds a
// single row at count 5, so the five printings are byte-identical BY THE ROW
// rather than by inspection, and the string occurs in no other row, so it is
// STANDALONE and never a compound tail. Both halves are swept in §1 rather than
// described.
//
// ⚠️ **THE PRINTINGS ARE ALL ONE CARD IN FIVE RARITIES, AND THE IDS ARE KNOWN.**
// Gouging Fire ex `sv05-038` (Double rare), `sv05-188` (Ultra rare), `sv05-204`
// (Special illustration rare), `sv05-214` (Hyper rare) and `svp-144` (Promo),
// re-verified CARD BY CARD against tcgdex — the ingest's own upstream — on
// 2026-08-26: all five `legal.standard = true`, regulation mark H, 230 HP, Basic,
// {R}, retreat 2, ×2 Water, no Resistance and no Ability, with "Heat Blast"
// ({R}{C}, 60, no effect) at index 0 and "Blaze Blitz" ({R}{R}{C}, 260 + this
// sentence) at **index 1** on every one of them.
//
// 🛑 **AND THE FIXTURE IS STILL A `fix-*` KEY, WHICH IS A DIFFERENT SITUATION
// FROM D408's AND IS WORTH THE SENTENCE.** That slice used synthetic ids because
// the printings were UNKNOWN to this container; here they are known and the ROW is
// what is missing — the local D1 holds six sets and neither `sv05` nor `svp`, and
// `catalogManifest.test.ts` (c) asserts `CATALOG_MANIFEST.absent` is EMPTY, so a
// real-id fixture would REDDEN that guard rather than strengthen this suite. What
// this buys instead of an id is that every SCALAR on the fixture is transcribed
// rather than chosen (`testFixtures.ts`), and §8 pins the transcription.
//
// FOUR THINGS THE SLICE TURNS ON:
//
//   • **A LITERAL ROW, NOT A CAPTURE.** D121's criterion: the varying axis holds
//     ONE name, so a `([A-Z].+?)` template would parameterise over a pool of one.
//     §2 proves the row is LITERAL by near-miss rather than by asserting the
//     regex — every rewrite one token away is refused;
//   • **AN OPTIONAL RIDER, NOT A NEW FIELD OR A NEW OP.** `until: "leavesActive"`
//     is the same key with the same value on the op (effects.ts), the record
//     (types.ts) and the log row (events.ts). D131's widen-don't-add test PASSES
//     here where D154 ran it and it failed: strip `until` and what is left is
//     `preventAttackUse`'s previous inhabitant, meaning exactly what it meant;
//   • **NO NEW CLEAR SITE, WHICH IS D408's CRITERION EVALUATED.** *"until it
//     leaves the Active Spot"* is machinery `lockedAttacks` already owns: all
//     THREE §10 literals shed the list unconditionally. Three is not "more than
//     three", so this is a SENTENCE slice and not a state slice. §5 drives all
//     three through the REAL action;
//   • **`MATCH_RECORD_VERSION` STAYS 26**, and it is DRIVEN IN BOTH DIRECTIONS in
//     §9 rather than argued: a v26 record whose entry OMITS the key replays as an
//     ordinary next-turn lock, and one that carries it replays as the bar.
//
// SEED-FREE: the sentence flips nothing, so a seed table would describe a shuffle
// rather than a rule. §3 pins that with an unchanged `rngState`.

/** The printed sentence, byte for byte off `legalAttackCorpus()`. */
const BLAZE_BLITZ_BAR = "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot.";

/** The two indices of the barrer, and the whole point of the pair: the bar names
    1 and 0 must stay legal for the rest of the game. */
const BLAZE_BLITZ = 1;
const HEAT_BLAST = 0;

/** ONE seed for the whole suite; the board it produces is asserted by `ready`
    rather than assumed. */
const SEED = 21;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

function render(
  events: GameEvent[],
  state: GameState,
  names: Record<Seat, string> = { p1: "Ember", p2: "Tide" },
): { who: string; text: string }[] {
  const ctx: LogContext = { names, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The error code a declaration comes back with, or `null` when it applies. */
function refusal(state: GameState, seat: Seat, index: number): string | null {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
}

function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** The barrer on `seat`'s Active with the {R}{R}{C} its named attack costs, on
    `seat`'s own turn 2. The OTHER seat opens and passes, so this turn carries no
    §4 first-turn attack restriction, and it fields `fix-titan` (340 HP, NO
    attacks) so that no case here ever reaches `ko:takePrizes` — 260 + 60 is 320
    and the body survives both. */
function ready(seat: Seat = "p1"): GameState {
  const opener = other(seat);
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: UNTIL_LEAVES_ACTIVE_DECK, p2: UNTIL_LEAVES_ACTIVE_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, seat, "fix-gougingfire");
  state = setActiveFromDeck(state, opener, "fix-titan");
  state = attachFromDeck(state, seat, "fix-fire-energy", 2);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  if (state.turn !== 2) throw new Error(`ready() expected turn 2, got ${String(state.turn)}`);
  return state;
}

/** `ready`, then "Blaze Blitz" DECLARED — asserting the bar actually landed, so
    no case below can assert "nothing was refused" against a board that barred
    nothing. Returns the OTHER seat's turn 3. */
function barred(seat: Seat = "p1"): { state: GameState; events: GameEvent[]; row: GameEvent } {
  const { state, events } = mustApply(ready(seat), { type: "attack", seat, index: BLAZE_BLITZ });
  const row = find(events, "ATTACK_LOCKED");
  if (row === undefined) throw new Error(`${seat} barred nothing`);
  return { state, events, row };
}

/** Pass both seats until it is `seat`'s turn again, `count` times. */
function laterTurns(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    if (next.phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
    if (next.phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${next.phase.kind}`);
    if (next.phase.seat !== seat) next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** TEST SURGERY: write the list straight onto a seat's Active, for the cases the
    merge rule reaches and no line of play does (a re-install landing on a live
    unbounded bar, and a v26 record's entry with the rider ABSENT). Said so rather
    than skipped, per the family's standing rule. */
function setLocks(state: GameState, seat: Seat, locks: InPlayPokemon["lockedAttacks"]): GameState {
  const side = state.players[seat];
  const active = must0(side.active);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, lockedAttacks: locks } } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE DATUM: the corpus row, byte for byte, and what it says about SHAPE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, and the two claims the corpus row makes", () => {
  it("is on the corpus EXACTLY ONCE, at 5 printings — so all five are byte-identical", () => {
    // The row is `<legal printings> <sentence>`, one line per DISTINCT sentence,
    // so a single row at count 5 is a claim about SPELLING and not only about
    // size: five printings that differed by one byte would be two rows.
    const rows = legalAttackCorpus().filter(([, sentence]) => sentence === BLAZE_BLITZ_BAR);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(5);
  });

  it("is STANDALONE — the words appear in no other corpus sentence, so it is never a tail", () => {
    // 🛑 THE CLAIM THAT DECIDES THE ARM'S SHAPE. D410's and D412's anchors exist
    // ONLY to be reached through `splitAttackTrailingClause`, because the pool
    // never prints their clause alone; this one is the opposite and the sweep is
    // what says so, over all 640 sentences rather than over the ones remembered.
    const carrying = legalAttackCorpus().filter(([, sentence]) =>
      sentence.includes("until it leaves the Active Spot"),
    );
    expect(carrying.map(([, sentence]) => sentence)).toEqual([BLAZE_BLITZ_BAR]);
    // …and the whole row IS the whole sentence: nothing precedes it and nothing
    // follows, which is what makes a `^…$` anchor the right instrument.
    expect(carrying[0]?.[1].startsWith("This Pokémon")).toBe(true);
    expect(carrying[0]?.[1].endsWith("Active Spot.")).toBe(true);
  });

  it("🛑 THE BYTE GUARD: the apostrophe is U+0027, NOT the curly U+2019", () => {
    // ⚠️ THIS CASE EXISTS BECAUSE THE SLICE WAS HANDED THE OPPOSITE CLAIM. The
    // brief said the sentence carries U+2019 in "can't" and asked for it to be
    // checked byte for byte — and the check says otherwise: the corpus row, and
    // all five tcgdex rows it was ingested from, spell the STRAIGHT apostrophe.
    // `CATALOG_MANIFEST.curlyApostropheAnywhere` has been 0 for the whole catalog
    // since D156, and this sentence is not the exception.
    //
    // So the `['’]` class in the anchor is the family's STANDING INSURANCE against
    // a punctuation-normalising re-ingest (D136/D137), not a transcription of
    // today's bytes — which is exactly what `clauseApostrophe.test.ts` exists to
    // keep true, and is asserted in the other direction two cases down.
    const codePoints = [...BLAZE_BLITZ_BAR].map((c) => c.codePointAt(0) ?? 0);
    expect(BLAZE_BLITZ_BAR).toContain("can't");
    expect(BLAZE_BLITZ_BAR).not.toContain("’");
    expect(codePoints).not.toContain(0x2019);
    // The ONLY non-ASCII code point in the sentence is the é of "Pokémon" — every
    // other byte is plain ASCII, stated as an enumeration so a smart-quote or a
    // non-breaking space introduced by an editor cannot pass unnoticed.
    expect([...new Set(codePoints.filter((cp) => cp > 0x7f))]).toEqual([0x00e9]);
  });

  it("the fixture carries the row — every field, including the ones it does not have", () => {
    // D151's rule: the ABSENCES are asserted too, because they are what a later
    // completion would move. Every scalar here is TRANSCRIBED from tcgdex
    // (2026-08-26); only the key and the name are synthetic, and the name keeps
    // the printed " ex" because that is the engine's only channel for a rule box.
    const card = FIXTURE_POOL["fix-gougingfire"];
    expect(card?.name).toBe("fix-gougingfire ex");
    expect(card?.hp).toBe(230);
    expect(card?.stage).toBe("Basic");
    expect(card?.types).toEqual(["Fire"]);
    expect(card?.retreat).toBe(2);
    expect(card?.weaknesses).toEqual([{ type: "Water", value: "×2" }]);
    expect(card?.resistances ?? null).toBeNull();
    expect(card?.abilities ?? null).toBeNull();
    expect(card?.evolveFrom ?? null).toBeNull();
    // 🛑 THE INDEX IS THE DATUM THE INSTALL RESOLVES THE PRINTED NOUN TO, and it
    // is 1 on all five printings — asserted rather than assumed, because a fixture
    // that dropped index 0 would renumber the very thing this slice addresses.
    expect(card?.attacks).toHaveLength(2);
    expect(card?.attacks?.[HEAT_BLAST]).toEqual({
      cost: ["Fire", "Colorless"],
      name: "Heat Blast",
      damage: 60,
    });
    expect(card?.attacks?.[BLAZE_BLITZ]).toEqual({
      cost: ["Fire", "Fire", "Colorless"],
      name: "Blaze Blitz",
      damage: 260,
      effect: BLAZE_BLITZ_BAR,
    });
    // …and the program arrives by TEXT DERIVATION, not from a registry row that
    // would silently take over the seam every board below drives.
    expect(programFor("fix-gougingfire")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVATION, and the LITERAL-ROW proof.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — one arm, one op, and the row is LITERAL", () => {
  it("derives `preventAttackUse` with the SPELLED noun and the `until` rider", () => {
    expect(deriveAttackEffect(BLAZE_BLITZ_BAR)).toEqual([
      { op: "preventAttackUse", attack: "Blaze Blitz", until: "leavesActive" },
    ]);
  });

  it("🛑 THE LITERAL-ROW PROOF: every near-miss rewrite is REFUSED", () => {
    // ⚠️ A LITERAL ROW IS ONLY A LITERAL ROW IF IT REFUSES THE NEIGHBOURHOOD, and
    // the way to say that is not to assert the regex — it is to hand the reader
    // the sentences a `(.+?)` capture would have swallowed and watch it decline.
    // D121's criterion is a claim about the CATALOG (one name on the varying
    // axis); these are the claims about the READER that follow from taking it.
    for (const text of [
      // …the same shape with ANOTHER attack name. A capture would take it; the
      // literal row does not, and no card prints it.
      "This Pokémon can't use Heat Blast again until it leaves the Active Spot.",
      // …the name of the sibling family's attack, which IS printed in this pool —
      // one word of the sentence away from a real reading, and still refused.
      "This Pokémon can't use Slashing Steel again until it leaves the Active Spot.",
      // …"again" dropped: a different English sentence, and not one the column
      // prints.
      "This Pokémon can't use Blaze Blitz until it leaves the Active Spot.",
      // …the trailing period dropped, which is what an anchor without `$` admits.
      "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot",
      // …a leading clause, which is what an anchor without `^` admits: this is the
      // shape a compound would arrive in, and the corpus prints none.
      "Discard an Energy from this Pokémon. This Pokémon can't use Blaze Blitz again until it leaves the Active Spot.",
      // …the OTHER Pokémon: "that Pokémon" is the pronoun spelling D410's family
      // uses across the table, and it must not reach a SELF-side install.
      "That Pokémon can't use Blaze Blitz again until it leaves the Active Spot.",
      // …lowercased "Active Spot", the drift a paraphrase produces. No /i, so the
      // capital is load-bearing.
      "This Pokémon can't use Blaze Blitz again until it leaves the Active spot.",
      // …the empty name, which no card prints and which a capture would have to
      // guard against with a quantifier it does not need here at all.
      "This Pokémon can't use  again until it leaves the Active Spot.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("…and the CURLY spelling is admitted, which is the standing insurance", () => {
    // The class in the anchor exists against a punctuation-normalising re-ingest,
    // not against today's bytes (§1's byte guard measured that). D137's contract
    // is that the two spellings produce the SAME VALUE and never merely a non-null
    // one, so the assertion is an equality with the straight reading rather than a
    // `not.toBeNull()`.
    expect(deriveAttackEffect(BLAZE_BLITZ_BAR.replace("can't", "can’t"))).toEqual(
      deriveAttackEffect(BLAZE_BLITZ_BAR),
    );
  });

  it("the four neighbouring anchors keep their own sentences, and none takes this one", () => {
    // ⚠️ ASSERTED AS DIFFERENT PROGRAMS RATHER THAN AS NULLS, which is the sharper
    // claim on a family whose members share an op and a record: a reader that
    // drifted between two of these would produce a board carrying the right fact
    // with the wrong duration, and no `toBeNull` anywhere could see it.
    expect(deriveAttackEffect("During your next turn, this Pokémon can't use Blaze Blitz.")).toEqual(
      [{ op: "preventAttackUse", attack: "Blaze Blitz" }],
    );
    expect(deriveAttackEffect("During your next turn, this Pokémon can't use attacks.")).toEqual([
      { op: "preventAttack" },
    ]);
    expect(deriveAttackEffect("During your next turn, this Pokémon can't attack.")).toEqual([
      { op: "preventAttack" },
    ]);
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Blaze Blitz attack does 100 more damage (before applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "boostAttack", attack: "Blaze Blitz", amount: 100 }]);
    // 🛑 AND THE PAIR THAT MATTERS MOST, SPELLED AS ONE ASSERTION: D154's arm and
    // this one produce the SAME op with the SAME noun and differ ONLY in the
    // rider. That is the whole of "a widening rather than a sixth op" — and it is
    // also the one difference no board can see if a reader drifts, because both
    // programs resolve, both install, and both grey exactly one row.
    const next = deriveAttackEffect("During your next turn, this Pokémon can't use Blaze Blitz.");
    const bar = deriveAttackEffect(BLAZE_BLITZ_BAR);
    expect(bar?.[0]).not.toEqual(next?.[0]);
    expect({ ...(bar?.[0] as Record<string, unknown>), until: undefined }).toEqual({
      ...(next?.[0] as Record<string, unknown>),
      until: undefined,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE INSTALL: the record, the row, and the stamp that is provenance.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the install writes an entry with NO window", () => {
  it("stamps the INSTALL turn, the resolved index and the rider, and names the attack", () => {
    const before = ready();
    const uid = activeUid(before, "p1");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BLAZE_BLITZ,
    });
    expect(find(events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid,
      attack: "Blaze Blitz",
      until: "leavesActive",
    });
    // 🛑 THE TURN IS 2 — THE INSTALLING TURN — AND NOT 4. Declaring ENDS the turn
    // (§5.3), so a `2` here names a turn its holder has already spent: the number
    // is PROVENANCE and no reader compares it (types.ts). Stamping `+ 2` would
    // have made a build that dropped the rider degrade silently into D154's
    // next-turn lock; stamping the install turn makes it produce a bar that never
    // bites once, which §4 can see on the very next turn.
    expect(before.turn).toBe(2);
    expect(state.players.p1.active?.lockedAttacks).toEqual([
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    // …and NOT the whole-Pokémon lock, which is the field a widening of the wrong
    // op would have written and the one thing no board can tell apart.
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    // The printed 260 landed and the 340 HP victim survived it, so every window
    // below opens on a live board rather than on a Knock Out.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(260);
  });

  it("the ROW ORDER is the printed order — the damage, then the drawback", () => {
    const { events } = barred();
    const order = types(events);
    expect(order.indexOf("ATTACK_LOCKED")).toBeGreaterThan(order.indexOf("DAMAGE_DEALT"));
  });

  it("no ATTACK_EFFECT_SKIPPED — in either direction", () => {
    // The LOUD path is what an unclaimed sentence takes, so its absence on the
    // barred attack is the claim "this reader took it". The CONTROL is index 0,
    // which prints no effect at all: a build that emitted the loud row for every
    // declaration would satisfy the first assertion's negation and not this one.
    const { events } = barred();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const sibling = mustApply(ready(), { type: "attack", seat: "p1", index: HEAT_BLAST });
    expect(types(sibling.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(sibling.events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });

  it("never PARKS and consumes no rng — the seed-free claim, made directly", () => {
    const before = ready();
    const { state } = mustApply(before, { type: "attack", seat: "p1", index: BLAZE_BLITZ });
    expect(state.rngState).toBe(before.rngState);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // …no continuation at all, so there is no `pendingOp` to persist (§9).
    expect("cont" in state.phase).toBe(false);
  });

  it("installs NOTHING when the printed name matches no attack on the holder", () => {
    // Unreachable off all five printings — every one names its own attack — so it
    // is CONSTRUCTED and said so. The op is fed through the real deriver so only
    // the HOLDER is substituted, and the contract is D154's unchanged: a bar on an
    // attack the card does not have is inert, and the honest shape of inert is
    // absence.
    const before = ready();
    const program = deriveAttackEffect(BLAZE_BLITZ_BAR);
    expect(program).not.toBeNull();
    const events: GameEvent[] = [];
    const result = runProgram(before, program ?? [], { seat: "p2", invokedBy: "attack" }, events);
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    // P2's Active is fix-titan, which prints no attacks at all.
    expect(result.state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
    expect(events).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE HEADLINE: the bar survives every turn, and the sibling never does.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — there is no window, and that is driven across real turn boundaries", () => {
  it("bites on the OPPONENT's turn, on the holder's next, and four turns later", () => {
    const { state } = barred();
    // Turn 3 is the opponent's — and the reader answers anyway, because the entry
    // carries no window. A turn-stamped entry would say nothing here.
    expect(state.turn).toBe(3);
    expect(lockedAttackIndexes(state, must0(state.players.p1.active))).toEqual([BLAZE_BLITZ]);
    for (const rounds of [1, 2, 3]) {
      const later = laterTurns(state, "p1", rounds);
      expect(later.phase).toEqual({ kind: "turn:action", seat: "p1" });
      expect(lockedAttackIndexes(later, must0(later.players.p1.active)), `+${rounds}`).toEqual([
        BLAZE_BLITZ,
      ]);
      expect(refusal(later, "p1", BLAZE_BLITZ), `+${rounds}`).toBe("ATTACK_PREVENTED");
    }
  });

  it("…and the sibling stays legal the whole time — the CONTROL that keeps it honest", () => {
    // Without this the refusals above could be passing because the board could not
    // attack at all. The Energy is still attached, the §4 first-turn ban is long
    // past, and index 0 APPLIES rather than merely not being ATTACK_PREVENTED.
    const window = laterTurns(barred().state, "p1", 1);
    expect(refusal(window, "p1", HEAT_BLAST)).toBeNull();
    const { events } = mustApply(window, { type: "attack", seat: "p1", index: HEAT_BLAST });
    expect(types(events)).toContain("DAMAGE_DEALT");
    // …and using the sibling does not re-write, extend or disturb the bar.
    expect(types(events)).not.toContain("ATTACK_LOCKED");
  });

  it("the refusal NAMES the barred attack, and a bad index still reports the INDEX", () => {
    const window = laterTurns(barred().state, "p1", 1);
    const result = applyAction(window, { type: "attack", seat: "p1", index: BLAZE_BLITZ });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Blaze Blitz");
    // The gate order is unchanged by the rider: a bogus index on a barred body
    // must report the index, not the bar.
    expect(refusal(window, "p1", 7)).toBe("BAD_ATTACK_INDEX");
  });

  it("BOTH SEATS — P2 installs it on its own body and is refused on its own turn", () => {
    // `seat` owns the BARRED Pokémon, and here that seat is the one that went
    // SECOND in the setup rather than first. Driven end to end because a rider
    // read off the wrong side of the table is exactly the failure D410's own
    // mutant row describes, one duration over.
    const { state, row } = barred("p2");
    expect(row).toMatchObject({ seat: "p2", attack: "Blaze Blitz", until: "leavesActive" });
    expect(state.players.p2.active?.lockedAttacks).toEqual([
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    // …and P1's own body carries nothing at all, so the install did not leak.
    expect(state.players.p1.active?.lockedAttacks ?? []).toEqual([]);
    const window = laterTurns(state, "p2", 1);
    expect(refusal(window, "p2", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    expect(refusal(window, "p2", HEAT_BLAST)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §10: ALL THREE CLEARS, each through the REAL action.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the bar is lifted by leaving the Active Spot, and by nothing else", () => {
  it("RETREATING lifts it — the holder's own route, and the printed one", () => {
    // The sentence names this line explicitly, which makes it the one route this
    // slice cannot leave to the swept clear-set: retreat the barred body, promote
    // something else, and the bar is gone with it.
    const window = laterTurns(barred().state, "p1", 1);
    const active = must0(window.players.p1.active);
    expect(lockedAttackIndexes(window, active)).toEqual([BLAZE_BLITZ]);
    const { state: retreated } = mustApply(window, {
      type: "retreat",
      seat: "p1",
      // The printed retreat is 2, so exactly two attached Energy pay it.
      discardEnergy: active.energy.slice(0, 2),
      promoteBenchIndex: 0,
    });
    const wasActive = retreated.players.p1.bench.at(-1);
    expect(wasActive?.lockedAttacks ?? []).toEqual([]);
  });

  it("…and a body brought BACK is free to use it again — the whole printed reading", () => {
    // 🛑 THE ASSERTION THE SENTENCE IS ACTUALLY ABOUT, and the one a clear-set
    // sweep cannot make: "until it leaves the Active Spot" is not a synonym for
    // "forever", and the only way to say so is to leave and come back. Retreat on
    // the window turn, Switch back on the next one, and declare.
    const window = laterTurns(barred().state, "p1", 1);
    const active = must0(window.players.p1.active);
    let state = mustApply(window, {
      type: "retreat",
      seat: "p1",
      discardEnergy: active.energy.slice(0, 2),
      promoteBenchIndex: 0,
    }).state;
    state = laterTurns(state, "p1", 1);
    // Switch the barred body back into the Active Spot and re-arm it. The Energy
    // went to the discard with the retreat, so it is re-attached by surgery —
    // which is a statement about the COST and not about the bar.
    state = handFromDeck(state, "p1", "sv01-194", 1);
    const switched = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-194"),
    }).state;
    const back = must0(switched.players.p1.active);
    expect(back.lockedAttacks).toEqual([]);
    const armed = attachFromDeck(
      attachFromDeck(switched, "p1", "fix-fire-energy", 2),
      "p1",
      "fix-energy",
      1,
    );
    expect(refusal(armed, "p1", BLAZE_BLITZ)).toBeNull();
    // …and declaring it installs the bar AGAIN, on the new turn, which is what
    // "again" means in the printed sentence.
    const { state: re, events } = mustApply(armed, {
      type: "attack",
      seat: "p1",
      index: BLAZE_BLITZ,
    });
    expect(types(events)).toContain("ATTACK_LOCKED");
    // The barred body is still Active (declaring does not move it) and carries a
    // FRESH entry stamped with the turn it was installed on — the same body, a
    // second bar, and no trace of the first, which §10 shed at the retreat.
    expect(armed.turn).toBe(6);
    expect(must0(re.players.p1.active).lockedAttacks).toEqual([
      { turn: 6, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
  });

  it("a real SWITCH lifts it — `switchInto` on the holder's OWN board", () => {
    // sv01-194 Switch (Item, `switchActive`), played as the action rather than
    // called as a function: this is the second of the three §10 literals and the
    // one that lives in `interpreter.ts` rather than in `turn.ts`.
    const window = laterTurns(barred().state, "p1", 1);
    const barredUid = activeUid(window, "p1");
    const held = handFromDeck(window, "p1", "sv01-194", 1);
    const { state: switched, events } = mustApply(held, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(held, "p1", "sv01-194"),
    });
    expect(types(events)).toContain("POKEMON_SWITCHED");
    const benched = switched.players.p1.bench.find((p) => p.stack.includes(barredUid));
    expect(benched).toBeDefined();
    expect(benched?.lockedAttacks ?? []).toEqual([]);
  });

  it("🛑 EVOLVING lifts it too — the DISCREPANCY, DECIDED and pinned rather than met", () => {
    // ⚠️ THE PRINTED SENTENCE DOES NOT SAY THIS, AND THE ENGINE DOES IT ANYWAY.
    // "until it leaves the Active Spot" names ONE event, and evolving is not that
    // event: the body never leaves the spot. `evolveOnto` sheds `lockedAttacks`
    // unconditionally, so an evolution inside the bar frees the barred index.
    //
    // 🛑 THE CALL: KEEP IT, and the ground is the RULEBOOK rather than the
    // sentence. §10 removes the effects of ATTACKS when a Pokémon evolves, and
    // this bar IS an effect of an attack — so the general rule governs and the
    // printed clause names the OTHER way out rather than the only one. That is the
    // same reading every field on this body already takes (D142's block, D143's
    // lock, D147's reduction, D154's per-attack bar), and taking it differently
    // here would make ONE entry in ONE list behave unlike its eight neighbours on
    // three hand-written literals that nothing makes agree.
    //
    // 🛑 AND IT IS PINNED BECAUSE THE ALTERNATIVE IS AN ACCIDENT. If a later slice
    // decides the printed clause is exhaustive, this case is what goes red and
    // tells them a decision was made rather than a site forgotten — which is the
    // whole difference between the two, and the reason D414's rule says to write
    // the correction as a guard and not as a paragraph.
    //
    // ⚠️ AND THE EVOLVED BODY HAS ONE ATTACK, so a clear that failed would leave
    // an index pointing at NOTHING: the failure this rules out is not "still
    // barred", it is "barred somewhere else".
    const window = laterTurns(barred().state, "p1", 1);
    expect(must0(window.players.p1.active).lockedAttacks).toHaveLength(1);
    const held = handFromDeck(window, "p1", "fix-gouging-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-gouging-stage1"),
      target: { spot: "active" },
    });
    expect(must0(evolved.players.p1.active).lockedAttacks).toEqual([]);
    expect(lockedAttackIndexes(evolved, must0(evolved.players.p1.active))).toEqual([]);
    // …and the evolved body attacks on the same turn, which is §10's rule and not
    // a leniency.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("the clear-set is the SAME set every durated field is on — swept, not listed", () => {
    // D149's rule, and the reason this slice adds no clear site: the three §10
    // literals are hand-kept and nothing makes them agree, so the new fact is read
    // off ONE body that has been through one of them beside the NINE that were
    // already there.
    // 🆕🆕 D432 — the NO-WEAKNESS bar joins the swept set. It is read STRUCTURALLY
    // here for the reason its own suite states: §8.5 applies Weakness only to the
    // ACTIVE, so once a body has been through a §10 clear there is no number left
    // that could witness the bar's absence. The field is the only witness there is.
    const window = laterTurns(barred().state, "p1", 1);
    const held = handFromDeck(window, "p1", "fix-gouging-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-gouging-stage1"),
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
      damageReduction: body.damageReduction,
      noWeaknessTurn: body.noWeaknessTurn,
      scheduledEffect: body.scheduledEffect,
      attackDamageDebuff: body.attackDamageDebuff,
      installedRecoil: body.installedRecoil,
      lockedAttacks: body.lockedAttacks,
      retreatBlocked: body.retreatBlocked,
      retreatLockedTurn: body.retreatLockedTurn,
      boostedAttack: body.boostedAttack,
    }).toEqual({
      attackBlock: null,
      attackLockedTurn: null,
      damageReduction: null,
      noWeaknessTurn: null,
      scheduledEffect: null,
      attackDamageDebuff: null,
      installedRecoil: null,
      lockedAttacks: [],
      retreatBlocked: false,
      retreatLockedTurn: null,
      boostedAttack: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE MERGE RULE: both of `addLockedAttack`'s predicates had to branch.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — `addLockedAttack` keeps an unbounded bar, and adds it only once", () => {
  it("IDEMPOTENT on the index alone — a re-install on a LATER turn adds nothing", () => {
    // ⚠️ CONSTRUCTED, AND SAID SO. A second install of THIS op cannot land on a
    // live record of THIS op in play: installing means declaring "Blaze Blitz",
    // and the bar forbids exactly that until the body leaves — at which point §10
    // has emptied the list. The surgery says which of the two idempotence keys
    // `addLockedAttack` implements.
    //
    // 🛑 AND THE TURN IS DELIBERATELY DIFFERENT FROM THE EXISTING ENTRY'S. The
    // turn-stamped key is the PAIR (turn, index); with the rider the key is the
    // INDEX and the rider alone, because an unbounded bar re-installed later is
    // the same fact and not a new one. Comparing the turn here appends a duplicate
    // — a repeated index in both payability projections and a second log row about
    // a bar the player already has.
    const state = setLocks(ready(), "p1", [
      { turn: 1, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [{ op: "preventAttackUse", attack: "Blaze Blitz", until: "leavesActive" }],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    expect(must0(result.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 1, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    expect(events).toEqual([]);
    // …and a DIFFERENT index is still APPENDED, so the key is the index and not
    // "any bar at all".
    const second: GameEvent[] = [];
    const added = runProgram(
      state,
      [{ op: "preventAttackUse", attack: "Heat Blast", until: "leavesActive" }],
      { seat: "p1", invokedBy: "attack" },
      second,
    );
    if (added.kind !== "done") throw new Error(`expected done, got ${added.kind}`);
    expect(must0(added.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 1, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
      { turn: 2, attackIndex: HEAT_BLAST, until: "leavesActive" },
    ]);
    expect(types(second)).toEqual(["ATTACK_LOCKED"]);
  });

  it("🛑 THE PRUNE DOES NOT COLLECT IT — a later write leaves the unbounded bar alone", () => {
    // ⚠️ THIS IS THE HALF THAT WOULD HAVE SHIPPED SILENTLY. The garbage rule drops
    // entries whose `turn` is strictly behind `now`, which is sound for a stamp
    // and fatal for provenance: the bar's `turn` is the INSTALL turn and is behind
    // `now` from the following turn onwards, so an unbranched prune deletes a live,
    // unbounded bar on the next write — D165's own defect a third time, this time
    // inside the rule that exists to bound the list.
    //
    // Driven as a PLAYED LINE: the body is barred on turn 2, and on turn 4 it
    // declares the SIBLING, whose own printing installs nothing — so the write that
    // exercises the prune is the surgery-free one below.
    const window = laterTurns(barred().state, "p1", 1);
    expect(window.turn).toBe(4);
    // A stale turn-stamped entry beside the bar, so the prune is proved to be
    // RUNNING rather than merely harmless: the stale one must go and the bar stay.
    const mixed = setLocks(window, "p1", [
      { turn: 2, attackIndex: HEAT_BLAST },
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    const events: GameEvent[] = [];
    const result = runProgram(
      mixed,
      [{ op: "preventAttackUse", attack: "Heat Blast" }],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    expect(must0(result.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
      { turn: 6, attackIndex: HEAT_BLAST },
    ]);
    // …and the bar is still the thing the reader answers with, on the write's own
    // turn, which is what every prune mutant throws away.
    expect(lockedAttackIndexes(result.state, must0(result.state.players.p1.active))).toEqual([
      BLAZE_BLITZ,
    ]);
  });

  it("a turn-stamped entry beside it still EXPIRES by arithmetic — the two rules coexist", () => {
    // The reader's two clauses on one body: the bar answers on every turn and the
    // stamp answers on exactly one, so a build that dropped either clause reports
    // a different set here.
    const state = setLocks(laterTurns(barred().state, "p1", 1), "p1", [
      { turn: 4, attackIndex: HEAT_BLAST },
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    expect(state.turn).toBe(4);
    expect(lockedAttackIndexes(state, must0(state.players.p1.active))).toEqual([
      HEAT_BLAST,
      BLAZE_BLITZ,
    ]);
    const later = laterTurns(state, "p1", 1);
    expect(later.turn).toBe(6);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([BLAZE_BLITZ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE LOG: a third phrasing, because the second one would be FALSE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the row says how long, and it says it under either seat", () => {
  it("prints the PRINTED duration, not 'next turn'", () => {
    const { state, row } = barred();
    expect(render([row], state)).toEqual([
      {
        who: "p1",
        text: "fix-gougingfire ex can't use Blaze Blitz again until it leaves the Active Spot",
      },
    ]);
  });

  it("…and the two OLDER phrasings are unmoved — the discriminator, in three cells", () => {
    // ⚠️ D412's RULE: a guard for a newly-split fact needs the halves that were
    // already correct as CONTROLS. Driving only the new branch proves the new code
    // runs; driving only the old ones stays green through the entire defect. Three
    // rows off ONE renderer, on one body, differing only in the event's riders.
    const { state, row } = barred();
    const uid = activeUid(state, "p1");
    expect(render([{ type: "ATTACK_LOCKED", seat: "p1", uid }], state)).toEqual([
      { who: "p1", text: "fix-gougingfire ex can't attack next turn" },
    ]);
    expect(
      render([{ type: "ATTACK_LOCKED", seat: "p1", uid, attack: "Blaze Blitz" }], state),
    ).toEqual([{ who: "p1", text: "fix-gougingfire ex can't use Blaze Blitz next turn" }]);
    // …and the new one, which must differ from BOTH.
    const wide = render([row], state)[0]?.text ?? "";
    expect(wide).not.toBe("fix-gougingfire ex can't use Blaze Blitz next turn");
    expect(wide).toContain("until it leaves the Active Spot");
  });

  it("reads identically with the seat NAMES swapped — the seat rule is untouched", () => {
    // The wording carries no player name and no "next turn" at all, so unlike the
    // two branches above it cannot even be false under the other seat. Driven
    // rather than argued, because this family has got a mirrored render wrong once
    // already (D148's bare wording).
    const { state, row } = barred();
    expect(render([row], state, { p1: "Tide", p2: "Ember" })).toEqual(render([row], state));
    // …and the same row rendered from the OTHER seat's install files under p2,
    // which is the voice rule (`seat` owns the BARRED Pokémon) on a second board.
    const mirror = barred("p2");
    expect(render([mirror.row], mirror.state)[0]?.who).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PROJECTION, and the purity pair.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the panel greys exactly the barred row, on every turn", () => {
  it("greys index 1 and OFFERS index 0 — and agrees with the §8 gate on both", () => {
    // ⚠️ `redactedAttacksOf` and `GameHud` both read `lockedAttackIndexes` and take
    // the set WHOLE, so neither needed a branch for this rider — VERIFIED by
    // reading them (`redact.ts`, `GameHud.tsx`) and DRIVEN here on the server side,
    // which is D412's rule in the order it asks for. What is new is that the set
    // is non-empty on turns no stamp names, so a build that kept the turn
    // comparison renders a completely normal panel that rejects one press.
    const window = laterTurns(barred().state, "p1", 2);
    const view = redactGame(window, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[BLAZE_BLITZ]?.name).toBe("Blaze Blitz");
    expect(view.attacks[BLAZE_BLITZ]?.playable).toBe(false);
    expect(view.attacks[HEAT_BLAST]?.name).toBe("Heat Blast");
    expect(view.attacks[HEAT_BLAST]?.playable).toBe(true);
    expect(refusal(window, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    expect(refusal(window, "p1", HEAT_BLAST)).toBeNull();
    // …and the CONTROL: the same board with the list emptied offers BOTH rows, so
    // "false" cannot be passing because the panel was unpayable anyway.
    const free = redactGame(setLocks(window, "p1", []), "p1").phase;
    if (free.kind !== "turn:action") throw new Error("expected turn:action");
    for (const attack of free.attacks) expect(attack.playable, attack.name).toBe(true);
  });

  it("the OPPONENT's view carries nothing — the bar leaks nothing across the wire", () => {
    const window = laterTurns(barred().state, "p1", 1);
    const view = redactGame(window, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });

  it("never mutates the state it was given — the purity PAIR, install and refusal", () => {
    // Both directions off one frozen board: the write (an install that appends an
    // entry) and the read (a declaration the bar refuses). A reducer that mutated
    // either would throw under `deepFreeze` rather than return a wrong answer.
    const before = ready();
    deepFreeze(before);
    expect(() => applyAction(before, { type: "attack", seat: "p1", index: BLAZE_BLITZ })).not.toThrow();
    const window = laterTurns(barred().state, "p1", 1);
    deepFreeze(window);
    expect(() => applyAction(window, { type: "attack", seat: "p1", index: BLAZE_BLITZ })).not.toThrow();
    expect(refusal(window, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE PERSISTED QUESTION: `MATCH_RECORD_VERSION` stays 26, driven BOTH ways.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — a v26 record still means what it meant, and this one is readable too", () => {
  it("🛑 A v26 ENTRY WITH THE KEY ABSENT REPLAYS AS AN ORDINARY NEXT-TURN LOCK", () => {
    // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN rather than asserted
    // against the constant. The bump trigger is a MISSING REQUIRED FIELD on a
    // persisted structure (D386/D393/D412 at this exact address); this slice adds
    // an OPTIONAL key to `LockedAttack`, so the question is whether a record
    // written by the PREVIOUS deploy still reads as what that deploy meant.
    //
    // The v26 shape is BUILT rather than imagined — the entry is written with the
    // key genuinely ABSENT and the whole board JSON round-tripped, which is what
    // persistence actually does to it — and then REPLAYED through `applyAction`.
    const window = laterTurns(barred().state, "p1", 1);
    expect(window.turn).toBe(4);
    const legacy = JSON.parse(
      JSON.stringify(setLocks(window, "p1", [{ turn: 4, attackIndex: BLAZE_BLITZ }])),
    ) as GameState;
    const entry = must0(legacy.players.p1.active).lockedAttacks[0];
    // ABSENT, not `undefined` — the distinction D124 refuses to blur, and the one
    // a `toEqual` would hide.
    expect(entry).toBeDefined();
    expect("until" in (entry ?? {})).toBe(false);
    // IT READS AS D154's LOCK: live on the turn it names…
    expect(lockedAttackIndexes(legacy, must0(legacy.players.p1.active))).toEqual([BLAZE_BLITZ]);
    expect(refusal(legacy, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    // …and DEAD two turns on, with nothing having cleared it, which is the half a
    // build that treated absence as "unbounded" would fail.
    const later = laterTurns(legacy, "p1", 1);
    expect(later.turn).toBe(6);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([]);
    expect(refusal(later, "p1", BLAZE_BLITZ)).toBeNull();
    // …and it is NOT RETIRED: the version gate refuses a record that is missing a
    // key this deploy's type says is always there, and this deploy's in-play
    // Pokémon carry exactly the keys the previous one wrote. Asserted as a LITERAL
    // key-set comparison in both directions, because a diff between two boards
    // from ONE build is blind to a key that grew on both (D279).
    const live = must0(laterTurns(barred().state, "p1", 1).players.p1.active);
    expect(Object.keys(must0(legacy.players.p1.active)).sort()).toEqual(Object.keys(live).sort());
  });

  it("…and an entry WITH the key survives the same round trip — the other direction", () => {
    // The control the case above needs: if the replay path silently dropped
    // unknown keys, the first case would pass for the wrong reason.
    const window = laterTurns(barred().state, "p1", 1);
    const saved = JSON.parse(JSON.stringify(window)) as GameState;
    expect(must0(saved.players.p1.active).lockedAttacks).toEqual([
      { turn: 2, attackIndex: BLAZE_BLITZ, until: "leavesActive" },
    ]);
    expect(refusal(saved, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    const later = laterTurns(saved, "p1", 2);
    expect(refusal(later, "p1", BLAZE_BLITZ)).toBe("ATTACK_PREVENTED");
    expect(refusal(later, "p1", HEAT_BLAST)).toBeNull();
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the fixtures ARE the deck, and the deck is 60.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the cast", () => {
  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(UNTIL_LEAVES_ACTIVE_DECK).toHaveLength(60);
    for (const id of new Set(UNTIL_LEAVES_ACTIVE_DECK)) expect(FIXTURE_POOL[id], id).toBeDefined();
  });

  it("the evolve route's Stage 1 names the barrer and prints ONE attack", () => {
    const stage1 = FIXTURE_POOL["fix-gouging-stage1"];
    expect(stage1?.stage).toBe("Stage1");
    expect(stage1?.evolveFrom).toBe("fix-gougingfire ex");
    expect(stage1?.evolveFrom).toBe(FIXTURE_POOL["fix-gougingfire"]?.name);
    // ONE attack, which is what makes a surviving index 1 point at nothing.
    expect(stage1?.attacks).toHaveLength(1);
  });
});
