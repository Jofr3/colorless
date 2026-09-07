import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackEffect,
  deriveAttackPreDamage,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PRE_DAMAGE_FAMILY_DECK,
  attachFromDeck,
  attachToolFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// 0.330.0 → 0.331.0 — 🆕🆕 D429: CLOSING THE PRE-DAMAGE FAMILY.
//
//   71: "Before doing damage, discard all Pokémon Tools and Special Energy from your
//        opponent's Active Pokémon."
//   72: "Before doing damage, discard all Pokémon Tools from this Pokémon. If you
//        can't discard any, this attack does nothing."
//   74: "Before doing damage, discard all Pokémon Tools from your opponent's Active
//        Pokémon. If you discarded a Pokémon Tool in this way, your opponent's Active
//        Pokémon is now Paralyzed."
//
// **3 sentences / 3 legal printings** (corpus lines 71, 72 and 74) over
// `legalAttackCorpus()`'s 640 sentences / 1,732 printings — the `legal_standard = 1`
// attack column. ⚠️ **THE RATIO IS BAD AND IT IS THE POINT, NOT AN OVERSIGHT.** One
// printing per sentence is the worst yield of any slice in this run. What the slice
// buys instead is stated as a claim rather than as a hope, and §1 measures it: the
// pre-damage seam gains the RESULT CHANNEL that two of these three sentences cannot
// be written without, and the `Before doing damage, ` head is left with **no unread
// remainder in this column at all** — so the next sentence in this family is a new
// shape rather than a fifth near-miss.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 ① **THE RESULT CHANNEL, AND HOW PARKING STAYED UNWRITABLE.**
//
// D428's `applyAttackPreDamage` returned a bare `GameState`, and its doc block said
// the SIGNATURE was what forbade a park. Rows 72 and 74 both condition on **what the
// act just did** — *"If you can't discard any…"*, *"If you discarded a Pokémon Tool in
// this way…"* — so a board alone cannot carry the answer, and the return widened to
// `AttackPreDamageResult = { state, tools, cancelled }`.
//
// The property survives, and NOT because the record is "nearly a `GameState`". A park
// is `RunResult`'s `{ kind: "parked"; prompt; cont }` — it is the PROMPT and the
// CONTINUATION a parking member would have to hand back, and `settleProgram` is the
// only thing that turns one into a playable `ApplyResult`. This record holds a board,
// a `number` and a `boolean`: plain data the caller reads and discards. Nothing in it
// can be drained, and it is assignable to neither `ApplyResult` nor `RunResult`. The
// rule is written at the type so the NEXT widening is safe too: **fields may be added
// when the caller CONSUMES AND DISCARDS them; never when a resolver would have to
// DRAIN them.** §8 drives the observable form of that on every board this suite has.
//
// 🛑 ② **WHERE ROW 72's CANCEL LANDS, AND WHY IT IS NOT A FOURTH COPY OF D125.**
// The consequent is D125's exactly — no damage, no W/R, no effect ops, no triggers —
// but the ANTECEDENT is new: D125's requirement gate reads a BOARD FACT before
// anything has happened, and this reads the RESULT of an act the attack already
// performed. So the branch lives at the pre-damage call site, immediately after the
// two rebinds, and it ENDS through `finishAttack` — the same call the confusion-tails
// path, D125 and D126 all make. §4 drives that the §8.1 sweep still runs (a lethal
// board is Knocked Out on the cancel path) and that the §5.3 turn still ends,
// because a cancelled attack is an attack that was USED.
//
// ⚠️ **AND THE CALL SITE TESTS `cancelled`, NEVER `kind`.** Which members print a
// cancel branch is the union's business. A `kind` test at the §8.5 site would be
// D222's hand-spelled reader of a closed union — correct today and quiet the day a
// fifth sentence prints the same branch.
//
// 🛑 ③ **THE ATTACKER OBJECT HAD D428's STALE-LOCAL DEFECT, AND WORSE.** D428 found
// `defender` stale and rebound it. This slice asked the same question of the ATTACKER
// before row 72 started writing to that board, and the answer is yes, in two flavours:
//   · a NUMBER THAT DOES NOT MOVE — `attackerPreWRBonus(next, active, …)` folds the
//     attacker's own attached Tools, so a discarded Vitality Band `sv01-197` still
//     adds its +10 if §8.5 reads the pre-strip snapshot (§4 drives the 110/100 pair);
//   · a STATE RESURRECTION — the §9 counterattack site spells
//     `{ ...active, damage: active.damage + recoil }` and writes it BACK with
//     `withActive`, so a stale binding **puts the discarded Tool back on the board**
//     ~500 lines after it was filed into the discard pile: a physical card in two
//     zones at once. D428's stale local was invisible-but-inert; this one duplicates
//     a card. §4 drives both, and `D429-own-strip-not-rebound` is that build.
//
// 🛑 ④ **ROW 74's CONSEQUENT GOES THROUGH THE INTERPRETER'S OWN `applyStatus`.** That
// function already owns §11's `effectRefused` and §12's printed `statusImmunities`;
// re-deriving either at the pre-damage seam would be a second reader of one rule
// (D222). It was EXPORTED for this, and the export is safe for the same reason the
// seam exists: it is total and returns a board, so it cannot smuggle a park in. §5
// drives the immunity arm with Therapeutic Energy `sv02-193`, which is the control
// that makes "the Paralysis landed" mean something.
//
// 🛑 ⑤ **ROW 71's SPECIAL-ENERGY DISCARD REUSES `ENERGY_DISCARDED` AND `isSpecialEnergy`.**
// Both existed. No new event type, no new predicate: the second zone cost one `push`
// and one `filter`. "Special" is the CARD CLASS and not an energy TYPE, so a Basic
// Energy on the same body stays attached — §3 drives that as the control, because it
// is the one distinction an "all Energy" mis-build erases.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ **THE IDS ARE UNRESOLVED AND ARE NOT INVENTED** (D425). This checkout has no D1
// — no local sqlite, no remote credentials — so the three cards printing these
// sentences cannot be named. The SENTENCES are measurable off the committed corpus and
// every rung below reads them from it rather than from a transcription.

/** One seed for the whole suite. Nothing here flips a coin and every Active, Tool,
    Energy and damage total is placed by surgery, so a seed table would describe a
    shuffle rather than a rule (D143's move, D428's inheritance). */
const SEED = 11;

/** The three printed sentences, read out of the corpus itself rather than transcribed,
    so no copy in this file can drift from the bytes the reader is anchored on (D415).
    `at(-1)` of a filter that must be length 1 would hide a duplicate; §1 pins the
    count first and these are taken only after that. */
const CORPUS = legalAttackCorpus();
const ROW71 =
  "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.";
const ROW72 =
  "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing.";
const ROW73 =
  "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.";
const ROW74 =
  "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon. If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.";

/** The literal head the whole family shares — what a prefix stripper would take off. */
const HEAD = "Before doing damage, ";

/** `fix-preseam`'s indices. Four sentences, one null control and one loud row. */
const IDX = { purge: 0, pry: 1, shed: 2, lock: 3, plain: 4, loud: 5 } as const;

const CHESTPLATE = "sv01-192"; // Tool: −30 after W/R on an {F} holder
const BAND = "sv01-197"; // Tool: the ATTACKER's +10 before W/R
const HELMET = "sv01-193"; // Tool: 20 counters back on the ATTACKER when its holder is hit
const THERAPEUTIC = "sv02-193"; // Special Energy: §12 — the holder can't be Paralyzed
const BASIC = "fix-energy"; // Basic Energy: the card-class control

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

/** A board with `fix-preseam` Active for `seat` and `fix-seamwall` Active opposite,
    two Colorless attached to the attacker. The turn is handed to `seat` by ending the
    OTHER seat's first turn, so §4's going-first ban is never in the way. */
function board(seat: Seat = "p1", defender = "fix-seamwall"): GameState {
  const decks = { p1: PRE_DAMAGE_FAMILY_DECK, p2: PRE_DAMAGE_FAMILY_DECK };
  let state = driveSetup(SEED, decks, { first: other(seat) });
  state = setActiveFromDeck(state, seat, "fix-preseam");
  state = setActiveFromDeck(state, other(seat), defender);
  state = attachFromDeck(state, seat, BASIC, 2);
  return mustApply(state, { type: "endTurn", seat: other(seat) }).state;
}

/** The opponent-side board every row-71 / row-73 / row-74 comparison runs on: the
    defender wears a Tool, a Special Energy and a Basic Energy AT ONCE, so the three
    sentences differ only in which of the three they take. */
function armedDefender(seat: Seat = "p1"): GameState {
  let state = board(seat);
  state = attachToolFromDeck(state, other(seat), "active", CHESTPLATE);
  state = attachFromDeck(state, other(seat), THERAPEUTIC, 1);
  state = attachFromDeck(state, other(seat), BASIC, 1);
  return state;
}

function swing(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat, index });
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((event) => event.type === type) as
    | Extract<GameEvent, { type: T }>
    | undefined;
}

/** What §8.5 said it dealt to the defending Active. `undefined` means no row at all,
    which is what a cancelled attack produces. */
function dealt(events: GameEvent[]): number | undefined {
  return find(events, "DAMAGE_DEALT")?.dealt;
}

/** The §9 counterattack total this swing put back on the attacker. Non-zero only when
    the DEFENDER wears Rocky Helmet, which is the board §4 uses to make the recoil site —
    the one that would resurrect a stale attacker binding — actually run. */
function recoil(events: GameEvent[]): number {
  return events
    .filter((e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack")
    .reduce((sum, e) => sum + (e.type === "COUNTERS_PLACED" ? e.amount : 0), 0);
}

/** The rendered log, flattened to `{ who, text }`. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The uid of `cardId` as it sits ATTACHED to `seat`'s Active — read off the board
    rather than off `cardIdByUid`, because a deck holds four copies and the surgery
    helpers take whichever one is first in the deck, not first in the id map. */
function attachedUid(state: GameState, seat: Seat, cardId: string): string | undefined {
  const active = state.players[seat].active;
  return [...(active?.tools ?? []), ...(active?.energy ?? [])].find(
    (uid) => state.cardIdByUid[uid] === cardId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the three sentences, the population, and the claim that justifies the ratio.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the sentences, measured live over the legal column", () => {
  it("is THREE sentences at ONE legal printing each, and they are the corpus's bytes", () => {
    for (const sentence of [ROW71, ROW72, ROW74]) {
      const rows = CORPUS.filter(([, text]) => text === sentence);
      expect(rows, sentence).toHaveLength(1);
      expect(rows[0]?.[0], sentence).toBe(1);
    }
    // ⚠️ EVERY APOSTROPHE BYTE IS MEASURED, NOT REMEMBERED (D421), and row 72's is in
    // "can't" rather than in a possessive — a different word, the same byte. The
    // column holds ZERO U+2019 anywhere, so the readers' `['’]` classes are DEFENSIVE.
    expect(ROW71).toContain("opponent's");
    expect(ROW72).toContain("can't");
    expect(ROW74).toContain("opponent's");
    for (const sentence of [ROW71, ROW72, ROW74]) expect(sentence.includes("’")).toBe(false);
    expect(CORPUS.some(([, text]) => text.includes("’"))).toBe(false);
  });

  it("🛑 the FAMILY is now CLOSED: all four openers are claimed, and the fifth row is not one", () => {
    // The published pattern, so its edges stay visible rather than being inherited as
    // a fact (D424/D425): `/[Bb]efore doing damage/` over all 640 sentences.
    const family = CORPUS.filter(([, s]) => /[Bb]efore doing damage/.test(s));
    expect(family).toHaveLength(5);
    const openers = family.filter(([, s]) => s.startsWith(HEAD));
    expect(openers).toHaveLength(4);
    // 🛑 THE CLAIM THIS SLICE IS FOR. At D428 exactly ONE of the four was claimed; all
    // four are now, so this rung goes RED the day a re-ingest adds a fifth opener —
    // which is the only thing that can reopen the prefix-stripper question below.
    for (const [, s] of openers) expect(deriveAttackPreDamage(s), s).not.toBeNull();
    expect(openers.map(([, s]) => s).sort()).toEqual([ROW71, ROW72, ROW73, ROW74].sort());
    // …and the fifth row carries the clause as its SECOND sentence, where no
    // front-anchored reader can see it. It is NOT this family and stays refused here.
    const mid = family.filter(([, s]) => !s.startsWith(HEAD));
    expect(mid).toHaveLength(1);
    expect(deriveAttackPreDamage(mid[0]?.[1] ?? "")).toBeNull();
    expect(mid[0]?.[1]).toContain("Before doing damage, you may attach");
  });

  it("🛑 THE PREFIX STRIPPER, RE-PRICED AFTER THE FAMILY WAS CLAIMED: still ZERO", () => {
    // D428 refused a `splitAttackPreDamageClause` on the measurement that ZERO of the
    // four remainders is claimed by any reader. Claiming the four sentences WHOLE does
    // not change that — a whole-sentence anchor never makes its own remainder readable
    // — so the refusal is re-measured rather than assumed to have expired.
    const openers = CORPUS.filter(([, s]) => s.startsWith(HEAD));
    expect(openers).toHaveLength(4);
    const bought = openers.filter(([, s]) => {
      const rest = s.slice(HEAD.length);
      const capped = rest.charAt(0).toUpperCase() + rest.slice(1);
      return resolvedByAnyReader(rest) || resolvedByAnyReader(capped);
    });
    expect(bought).toEqual([]);
    // ⚠️ THE CONTROL THAT MAKES THE ZERO MEAN SOMETHING (D424): the instrument is not
    // simply answering "no" to everything.
    expect(resolvedByAnyReader("Your opponent's Active Pokémon is now Asleep.")).toBe(true);
    // …and D428's stated falsifier — "two or more pre-damage remainders claimed by a
    // reader that already exists" — is now UNREACHABLE for this head, because the head
    // has no unclaimed sentence left. Pinned so the sentence in effects.ts is not prose.
    const unclaimed = openers.filter(([, s]) => !resolvedByAnyReader(s));
    expect(unclaimed).toEqual([]);
  });

  it("the reader SURFACE stands still at 13 — three sentences, no new instrument", () => {
    // One reader for the whole family rather than four, so this slice moves the census
    // figures by PRINTINGS and not by instrument shape. Contrast D428, which moved
    // 12 → 13 by adding `deriveAttackPreDamage` itself.
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackPreDamage");
    // Neither splitter and no registry row: all three sentences leave the RAW residue
    // and the split-aware residue by the same 1 / 1 each.
    for (const sentence of [ROW71, ROW72, ROW74]) {
      expect(splitAttackGateClause(sentence), sentence).toBeNull();
      expect(splitAttackTrailingClause(sentence), sentence).toBeNull();
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });

  it("⚠️ the `/Pokémon Tool/` sweep is TEN rows and this slice claims FOUR of them", () => {
    // D428 measured the ten and corrected a brief that listed eight. Re-run here rather
    // than inherited, and the new fact is the SPLIT: this slice takes the sweep's
    // unresolved remainder from FIVE to TWO (rows 71, 72 and 74 were three of the five
    // at D428's head), which is the honest residue this family leaves behind. The two
    // survivors are the parking *"up to 2"* row §8 refuses on the population and the
    // hand-reveal discard, neither of which carries the pre-damage head.
    const tools = CORPUS.filter(([, s]) => /Pokémon Tool/.test(s));
    expect(tools).toHaveLength(10);
    expect(tools.filter(([, s]) => deriveAttackPreDamage(s) !== null)).toHaveLength(4);
    expect(tools.filter(([, s]) => !resolvedByAnyReader(s))).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation: four members, one reader, and the boundaries it holds.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the boundaries the four anchors hold", () => {
  it("derives four DISTINCT closed shapes, each with `kind` as its only key", () => {
    expect(deriveAttackPreDamage(ROW71)).toEqual({
      kind: "discardOpponentActiveToolsAndSpecialEnergy",
    });
    expect(deriveAttackPreDamage(ROW72)).toEqual({ kind: "discardOwnToolsElseCancel" });
    expect(deriveAttackPreDamage(ROW73)).toEqual({ kind: "discardOpponentActiveTools" });
    expect(deriveAttackPreDamage(ROW74)).toEqual({
      kind: "discardOpponentActiveToolsThenParalyze",
    });
    const kinds = [ROW71, ROW72, ROW73, ROW74].map((s) => deriveAttackPreDamage(s)?.kind);
    expect(new Set(kinds).size).toBe(4);
    for (const sentence of [ROW71, ROW72, ROW73, ROW74]) {
      expect(Object.keys(deriveAttackPreDamage(sentence) ?? {}), sentence).toEqual(["kind"]);
    }
  });

  it("🛑 the U+2019 re-ingest derives IDENTICALLY for all four, not merely non-null", () => {
    // D136/D137's shape: equality with the straight form. A non-null check would pass
    // on a reader that folded one sentence into another's member.
    for (const sentence of [ROW71, ROW72, ROW73, ROW74]) {
      const curly = sentence.replaceAll("'", "’");
      expect(curly, sentence).not.toBe(sentence);
      expect(deriveAttackPreDamage(curly), sentence).toEqual(deriveAttackPreDamage(sentence));
    }
  });

  it("🛑 ROW 73 IS THE ONE-AXIS NEIGHBOUR OF BOTH 71 AND 74, and all three stay distinct", () => {
    // The whole risk of four anchors on one head is that one swallows another. Row 73
    // is a strict PREFIX of row 74 and differs from row 71 by exactly the four words
    // "and Special Energy" — so if any anchor were unanchored or non-greedy in the
    // wrong place, these three would collapse into one.
    expect(ROW74.startsWith(ROW73)).toBe(true);
    expect(ROW71.replace(" and Special Energy", "")).toBe(ROW73);
    expect(deriveAttackPreDamage(ROW73)?.kind).toBe("discardOpponentActiveTools");
    expect(deriveAttackPreDamage(ROW74)?.kind).toBe("discardOpponentActiveToolsThenParalyze");
    expect(deriveAttackPreDamage(ROW71)?.kind).toBe(
      "discardOpponentActiveToolsAndSpecialEnergy",
    );
  });

  it("🛑 THE NEAR-MISSES ARE REFUSED, AND EACH DIFFERS ON EXACTLY ONE AXIS (D427)", () => {
    // Every string below is one of the four printed sentences with ONE printed feature
    // changed, so a refusal names which feature did the refusing.
    // ① the STATUS WORD in row 74's consequent…
    expect(deriveAttackPreDamage(ROW74.replace("Paralyzed", "Asleep"))).toBeNull();
    // ② …the VICTIM in row 72's act…
    expect(
      deriveAttackPreDamage(ROW72.replace("from this Pokémon", "from your opponent's Pokémon")),
    ).toBeNull();
    // ③ …the CARD CLASS in row 71's second zone…
    expect(deriveAttackPreDamage(ROW71.replace("Special Energy", "Energy"))).toBeNull();
    // ④ …and the TIMING head, dropped from row 73.
    expect(deriveAttackPreDamage(ROW73.slice(HEAD.length))).toBeNull();
    // ⚠️ THE ADMISSIONS BESIDE THE REFUSALS (D424): the reader still says YES to all
    // four printed strings, so "it refuses everything" is excluded on the same axis.
    for (const sentence of [ROW71, ROW72, ROW73, ROW74]) {
      expect(deriveAttackPreDamage(sentence), sentence).not.toBeNull();
    }
  });

  it("🛑 the OTHER pre-damage-adjacent row stays with its OWN reader", () => {
    // *"…before this attack does damage…"* is a `deriveAttackRequirement` does-nothing
    // gate built since D125, 2 printings, and D428's own suite caught a doc block
    // claiming that spelling appears nowhere in this column. It appears; it is not this
    // family; and this rung is what keeps the two families from merging.
    const otherSpelling = CORPUS.filter(([, s]) => /before this attack does damage/i.test(s));
    expect(otherSpelling).toHaveLength(1);
    expect(otherSpelling[0]?.[0]).toBe(2);
    expect(deriveAttackPreDamage(otherSpelling[0]?.[1] ?? "")).toBeNull();
    expect(resolvedByAnyReader(otherSpelling[0]?.[1] ?? "")).toBe(true);
  });

  it("🛑 row 74 does NOT compose through the trailing splitter — measured, not assumed", () => {
    // D424 gained a free printing when a compound composed and D426 gained none; the
    // mechanism, not the outcome, is what predicts it (D426): `splitAttackTrailingClause`
    // composes when `deriveAttackEffect` already reads the TAIL. It does not read this
    // one, before this slice or after it — so row 74 needed its own arm, and the reason
    // is pinned rather than described.
    expect(splitAttackTrailingClause(ROW74)).toBeNull();
    expect(
      deriveAttackEffect(
        "If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
    // …and the same for row 72's cancel tail, which reads like D125's clause and is not
    // one: "any" refers back to the first sentence's act and means nothing alone.
    expect(splitAttackTrailingClause(ROW72)).toBeNull();
    expect(deriveAttackEffect("If you can't discard any, this attack does nothing.")).toBeNull();
  });

  it("the demonstrator body carries the identical bytes at every index", () => {
    const attacks = FIXTURE_POOL["fix-preseam"]?.attacks ?? [];
    expect(attacks).toHaveLength(6);
    expect(attacks[IDX.purge]?.effect).toBe(ROW71);
    expect(attacks[IDX.pry]?.effect).toBe(ROW73);
    expect(attacks[IDX.shed]?.effect).toBe(ROW72);
    expect(attacks[IDX.lock]?.effect).toBe(ROW74);
    // The null control prints the SAME 100 damage and NO effect, which is what makes
    // every comparison below a one-axis one.
    expect(attacks[IDX.plain]?.effect ?? null).toBeNull();
    for (const i of [IDX.purge, IDX.pry, IDX.shed, IDX.lock, IDX.plain]) {
      expect(attacks[i]?.damage, String(i)).toBe(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — 🛑 ROW 71: TWO ZONES, and both of them move a number.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — row 71 takes the Tool AND the Special Energy, and leaves the Basic", () => {
  it("🛑 ONE board, THREE indices: the TOOL half moves the damage, and it is pre-damage", () => {
    // The defender wears Rock Chestplate (−30 after W/R), Therapeutic Energy (a REAL
    // Special Energy) and a Basic Energy, all at once. The three swings differ ONLY in
    // the printed sentence, so "the Tool changed the number" and "the discard changed
    // the number" are two claims measured on one board (D427).
    const armed = armedDefender();
    expect(dealt(swing(armed, IDX.plain).events)).toBe(70); // no sentence at all
    expect(dealt(swing(armed, IDX.pry).events)).toBe(100); // row 73 — Tools only
    expect(dealt(swing(armed, IDX.purge).events)).toBe(100); // row 71 — Tools + Special
    // Stated as a delta, because the delta IS D407's built-but-dead defect: a hook
    // placed after §8.5 gives 70 for all three.
    expect(
      (dealt(swing(armed, IDX.purge).events) ?? 0) - (dealt(swing(armed, IDX.plain).events) ?? 0),
    ).toBe(30);
  });

  it("🛑 THE SECOND ZONE MOVES NO NUMBER, AND THAT IS MEASURED RATHER THAN ASSUMED", () => {
    // ⚠️ **THE HONEST FORM OF THIS CLAIM, AND IT IS D428's VITALITY-BAND CONTROL ONE
    // ZONE OVER.** The Tool half of row 71 carries the ORDER (the rung above); the
    // Special-Energy half is a ZONE move and nothing more, because **no §8.5 read in
    // `attack.ts` consults the DEFENDER's attached Energy**. `passivesOf` does fold an
    // attached Energy's `passive` (D174), so the shape exists — but the three
    // pool-resident Special Energy passives are `statusImmunities` (§12, read by
    // `applyStatus`), `preventAttackEffects` (§11, read by `effectRefused`) and
    // `onKoPrizeReduction` (flow.ts's §8.1 sweep), and none of them is a §8.5 damage
    // term. So the second zone's ordering is UNOBSERVABLE on today's pool, and this
    // rung says so instead of dressing a state write up as a number.
    const armed = armedDefender();
    expect(dealt(swing(armed, IDX.pry).events)).toBe(dealt(swing(armed, IDX.purge).events));
  });

  it("🛑 the SECOND ZONE is a CARD CLASS: the Basic Energy on the same body survives", () => {
    // The one distinction an "all Energy" mis-build erases. `isSpecialEnergy` is a card
    // read, not a type read, so the Basic stays exactly where it was.
    const armed = armedDefender();
    const before = armed.players.p2.active?.energy ?? [];
    expect(before).toHaveLength(2);
    const { state } = swing(armed, IDX.purge);
    const after = state.players.p2.active?.energy ?? [];
    expect(after).toHaveLength(1);
    expect(state.cardIdByUid[after[0] ?? ""]).toBe(BASIC);
    // …and the Special Energy really left play, into its OWNER's pile.
    const specialUid = attachedUid(armed, "p2", THERAPEUTIC);
    expect(state.players.p2.discard).toContain(specialUid);
    expect(state.players.p1.discard).not.toContain(specialUid);
    // ⚠️ AND ROW 73 ON THE SAME BOARD LEAVES IT ALONE — the one-axis control, because
    // rows 71 and 73 differ by exactly the four words "and Special Energy".
    const pried = swing(armed, IDX.pry).state;
    expect(pried.players.p2.active?.energy).toEqual(before);
    expect(pried.players.p2.discard).not.toContain(specialUid);
  });

  it("TWO EVENTS AND NOT ONE: the Tool row and the Energy row, in printed noun order", () => {
    const { state, events } = swing(armedDefender(), IDX.purge);
    const tools = find(events, "TOOLS_DISCARDED");
    const energy = find(events, "ENERGY_DISCARDED");
    expect(tools?.seat).toBe("p2");
    expect(tools?.actor).toBe("p1");
    expect(energy?.seat).toBe("p2");
    expect(energy?.actor).toBe("p1");
    expect(energy?.from).toEqual({ spot: "active" });
    // Both name the same host, and it is the TOP-CARD uid rather than the spot.
    expect(tools?.host).toBe(state.players.p2.active?.stack.at(-1));
    expect(energy?.host).toBe(tools?.host);
    // The printed noun order — Tools, then Special Energy — in the batch and in the pile.
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("TOOLS_DISCARDED")).toBeLessThan(kinds.indexOf("ENERGY_DISCARDED"));
    expect(kinds.indexOf("ENERGY_DISCARDED")).toBeLessThan(kinds.indexOf("DAMAGE_DEALT"));
    const pile = state.players.p2.discard;
    expect(pile.indexOf(tools?.uids[0] ?? "")).toBeLessThan(pile.indexOf(energy?.uids[0] ?? ""));
  });

  it("a body with ONLY a Special Energy still files the Energy row and NO Tool row", () => {
    // The two zones are independent: neither push is gated on the other having happened,
    // which `D429-second-zone-alone-is-a-no-op` is the mutant for.
    let onlyEnergy = board();
    onlyEnergy = attachFromDeck(onlyEnergy, "p2", THERAPEUTIC, 1);
    const { state, events } = swing(onlyEnergy, IDX.purge);
    expect(find(events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(find(events, "ENERGY_DISCARDED")?.uids).toHaveLength(1);
    expect(state.players.p2.active?.energy).toEqual([]);
  });

  it("🛑 a body with NEITHER is a silent no-op — no rows, identical damage", () => {
    const bare = board();
    expect(dealt(swing(bare, IDX.plain).events)).toBe(100);
    const { events } = swing(bare, IDX.purge);
    expect(dealt(events)).toBe(100);
    expect(events.filter((e) => e.type === "TOOLS_DISCARDED")).toEqual([]);
    expect(events.filter((e) => e.type === "ENERGY_DISCARDED")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — 🛑 ROW 72: the ATTACKER's own Tools, the rebind, and the printed cancel.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — row 72 strips *this Pokémon*, and cancels when it cannot", () => {
  /** The attacker wears a Vitality Band; the defender wears a Spiky Energy so the §9
      counterattack site — the one that RESURRECTS a stale attacker binding — actually
      runs. */
  function banded(seat: Seat = "p1"): GameState {
    let state = board(seat);
    state = attachToolFromDeck(state, seat, "active", BAND);
    state = attachToolFromDeck(state, other(seat), "active", HELMET);
    return state;
  }

  it("🛑 THE NUMBER MOVES: 110 with the Band, 100 once the attack discards its own", () => {
    // `attackerPreWRBonus` folds the ATTACKER's attached Tools, so the Band's +10 is
    // the figure the pre-damage strip removes. The two indices print the same cost and
    // the same 100 damage and differ only in the sentence.
    const armed = banded();
    expect(dealt(swing(armed, IDX.plain).events)).toBe(110);
    expect(dealt(swing(armed, IDX.shed).events)).toBe(100);
  });

  it("🛑 …and the delta is 10, which is the DEFECT a missing rebind ships", () => {
    // Stated as a delta, because the delta IS D428's stale-local defect on the other
    // side of the table: a build that writes the discard into `next` and keeps reading
    // the declaration snapshot gives 110 for BOTH and looks correct everywhere else.
    const armed = banded();
    expect((dealt(swing(armed, IDX.plain).events) ?? 0) - (dealt(swing(armed, IDX.shed).events) ?? 0)).toBe(10);
  });

  it("🛑 THE RESURRECTION: the §9 counterattack must not put the Tool back", () => {
    // The recoil site spells `{ ...attackerBody, damage: … }` and writes it back with
    // `withActive`. Reading the DECLARATION snapshot there would restore `tools`
    // several hundred lines after the card was filed into the discard pile — the same
    // physical card in two zones at once, which no damage assertion can see.
    const armed = banded();
    const bandUid = attachedUid(armed, "p1", BAND);
    expect(armed.players.p1.active?.tools).toEqual([bandUid]);
    const { state, events } = swing(armed, IDX.shed);
    expect(recoil(events)).toBe(20); // the write really happened
    expect(state.players.p1.active?.damage).toBe(20);
    expect(state.players.p1.active?.tools).toEqual([]); // …and it did not restore
    expect(state.players.p1.discard.filter((u) => u === bandUid)).toHaveLength(1);
  });

  it("the Tool goes to the ATTACKER's own pile, and the event names one seat twice", () => {
    const armed = banded();
    const bandUid = attachedUid(armed, "p1", BAND);
    const { state, events } = swing(armed, IDX.shed);
    const row = find(events, "TOOLS_DISCARDED");
    // ⚠️ THE FIRST PRODUCER IN THE ENGINE WITH `seat === actor` on this event. §7.4
    // sends a Tool back to its holder's controller, and here that is the attacker.
    expect(row?.seat).toBe("p1");
    expect(row?.actor).toBe("p1");
    expect(row?.uids).toEqual([bandUid]);
    expect(row?.host).toBe(armed.players.p1.active?.stack.at(-1));
    expect(state.players.p1.discard).toContain(bandUid);
    expect(state.players.p2.discard).not.toContain(bandUid);
  });

  it("🛑 THE CANCEL: no Tool on this Pokémon and the attack does NOTHING", () => {
    // No damage row at all, and the defender is untouched — D125's consequent exactly.
    const bare = board();
    const { state, events } = swing(bare, IDX.shed);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(0);
    expect(find(events, "ATTACK_FAILED")?.reason).toBe("preDamage");
    // ⚠️ AND NO TOOLS_DISCARDED ROW EITHER: the silent-no-op rule means the failure row
    // is the whole of what a reader is told, which is why it is a FOURTH reason and not
    // a reuse of "requirement".
    expect(find(events, "TOOLS_DISCARDED")).toBeUndefined();
  });

  it("🛑 …and the TURN STILL ENDS, because a cancelled attack is an attack that was USED", () => {
    const bare = board();
    const { state, events } = swing(bare, IDX.shed);
    expect(find(events, "TURN_ENDED")).toBeDefined();
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.turn).toBe(3);
    // …and the attacker is stamped as having USED the attack, exactly as D125's path
    // stamps it — `finishAttack` is the shared ending rather than a copied one.
    expect(state.players.p1.active?.usedAttack).toEqual({ name: "Shed Gear", turn: 2 });
  });

  it("🛑 …and §8.1 STILL SWEEPS on the cancelled path, with the control that says so", () => {
    // A defender already at its 300 HP is Knocked Out by `finishAttack`'s sweep even
    // though this attack dealt nothing — which is the half of D125's rule that a
    // hand-written `return err(...)` would silently drop.
    const lethal = setDamage(board(), "p2", 300);
    const cancelled = swing(lethal, IDX.shed);
    expect(find(cancelled.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(cancelled.events, "KNOCKED_OUT")).toBeDefined();
    // THE CONTROL: on a board that is NOT lethal the same cancelled swing files no KO,
    // so the rung above is about the sweep and not about "this path always emits one".
    expect(find(swing(board(), IDX.shed).events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("the log row names the ACT, not a condition that was never printed", () => {
    // D421 — a log row is a claim with the same standing as a predicate. The default
    // arm of `ATTACK_FAILED`'s ternary says "its condition was not met", which is false
    // of a sentence with no condition in it.
    const bare = board();
    const { state, events } = swing(bare, IDX.shed);
    const rows = rendered(state, events);
    expect(rows.map((r) => r.text)).toContain(
      "Fixseam's attack did nothing — it had no Pokémon Tool to discard",
    );
    for (const row of rows) expect(row.text).not.toContain("its condition was not met");
  });

  it("row 72 does NOT touch the opponent's Tools — the other half of *this Pokémon*", () => {
    // A build that read the wrong seat passes every rung above on a bare-attacker board.
    let both = board();
    both = attachToolFromDeck(both, "p1", "active", BAND);
    both = attachToolFromDeck(both, "p2", "active", CHESTPLATE);
    const { state, events } = swing(both, IDX.shed);
    expect(state.players.p1.active?.tools).toEqual([]);
    expect(state.players.p2.active?.tools).toHaveLength(1);
    expect(find(events, "TOOLS_DISCARDED")?.seat).toBe("p1");
    // …and the defender's Chestplate is therefore STILL subtracting: 110 − 10 − 30.
    expect(dealt(events)).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — 🛑 ROW 74: a consequent conditioned on the RESULT of the act.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — row 74 Paralyzes only when a Tool was actually discarded", () => {
  it("🛑 a Tool WAS discarded: the opponent's Active is now Paralyzed, before the damage", () => {
    let tooled = board();
    tooled = attachToolFromDeck(tooled, "p2", "active", CHESTPLATE);
    const { state, events } = swing(tooled, IDX.lock);
    expect(find(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(find(events, "STATUS_APPLIED")?.status).toBe("paralyzed");
    expect(state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    // The discard is still pre-damage, so row 73's number move happens here too.
    expect(dealt(events)).toBe(100);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("TOOLS_DISCARDED")).toBeLessThan(kinds.indexOf("STATUS_APPLIED"));
    expect(kinds.indexOf("STATUS_APPLIED")).toBeLessThan(kinds.indexOf("DAMAGE_DEALT"));
  });

  it("🛑 THE CONTROL: no Tool to discard and there is NO Paralysis at all", () => {
    // The defect this rung exists for is a build that applies the status
    // unconditionally — `D429-row74-status-unconditional`. Every other assertion in
    // this section passes on that build.
    const bare = board();
    const { state, events } = swing(bare, IDX.lock);
    expect(find(events, "TOOLS_DISCARDED")).toBeUndefined();
    expect(find(events, "STATUS_APPLIED")).toBeUndefined();
    expect(find(events, "STATUS_PREVENTED")).toBeUndefined();
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    // …and the damage is identical either way, so the difference really is the status.
    expect(dealt(events)).toBe(100);
  });

  it("🛑 a SPECIAL ENERGY on the body does NOT satisfy the printed *Pokémon Tool*", () => {
    // Row 71 discards two card classes; row 74's condition names ONE. A result channel
    // that counted "cards moved" rather than "Tools moved" would Paralyze here.
    let energyOnly = board();
    energyOnly = attachFromDeck(energyOnly, "p2", THERAPEUTIC, 1);
    const { state, events } = swing(energyOnly, IDX.lock);
    // Row 74 takes Tools only, so nothing moves and nothing lands.
    expect(find(events, "ENERGY_DISCARDED")).toBeUndefined();
    expect(find(events, "STATUS_APPLIED")).toBeUndefined();
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("🛑 §12's IMMUNITY refuses the Paralysis and the Tool is discarded ANYWAY", () => {
    // Therapeutic Energy `sv02-193` prints "can't be affected by those Special
    // Conditions". Going through the interpreter's own `applyStatus` is what buys this
    // for free: a second implementation at the pre-damage seam would have had to
    // re-derive §11's `effectRefused` and §12's `statusImmunities` (D222).
    let immune = board();
    immune = attachToolFromDeck(immune, "p2", "active", CHESTPLATE);
    immune = attachFromDeck(immune, "p2", THERAPEUTIC, 1);
    const { state, events } = swing(immune, IDX.lock);
    expect(find(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(find(events, "STATUS_PREVENTED")?.status).toBe("paralyzed");
    expect(find(events, "STATUS_APPLIED")).toBeUndefined();
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    // …and the damage still moved, so the refusal is about the CONDITION and not about
    // the act: the Chestplate is gone either way.
    expect(dealt(events)).toBe(100);
  });

  it("row 73 on the SAME tooled board Paralyzes NOTHING — the sentence-level control", () => {
    // Rows 73 and 74 differ by one appended sentence. Without this rung, "the Paralysis
    // landed" could be a property of the pre-damage seam rather than of row 74.
    let tooled = board();
    tooled = attachToolFromDeck(tooled, "p2", "active", CHESTPLATE);
    const { state, events } = swing(tooled, IDX.pry);
    expect(find(events, "TOOLS_DISCARDED")).toBeDefined();
    expect(find(events, "STATUS_APPLIED")).toBeUndefined();
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — BOTH SEATS, for all three sentences.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — both seats: *your opponent's* and *this Pokémon* are relative", () => {
  it("🛑 p2 attacking: row 71 strips p1's Active, row 74 Paralyzes p1's Active", () => {
    // D361's rule. A build that hard-coded the victim seat passes every p1 case above.
    const mirrored = armedDefender("p2");
    const purge = swing(mirrored, IDX.purge, "p2");
    expect(find(purge.events, "TOOLS_DISCARDED")?.seat).toBe("p1");
    expect(find(purge.events, "TOOLS_DISCARDED")?.actor).toBe("p2");
    expect(find(purge.events, "ENERGY_DISCARDED")?.seat).toBe("p1");
    expect(purge.state.players.p1.active?.tools).toEqual([]);
    expect(purge.state.players.p1.active?.energy).toHaveLength(1); // the BASIC survived
    expect(dealt(purge.events)).toBe(100);

    let tooled = board("p2");
    tooled = attachToolFromDeck(tooled, "p1", "active", CHESTPLATE);
    const lock = swing(tooled, IDX.lock, "p2");
    expect(lock.state.players.p1.active?.conditions.rotation).toBe("paralyzed");
    expect(lock.state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("🛑 p2 attacking: row 72 strips p2's OWN Active, and cancels on p2's own bare body", () => {
    let armed = board("p2");
    armed = attachToolFromDeck(armed, "p2", "active", BAND);
    armed = attachToolFromDeck(armed, "p1", "active", BAND);
    const shed = swing(armed, IDX.shed, "p2");
    expect(shed.state.players.p2.active?.tools).toEqual([]);
    expect(shed.state.players.p1.active?.tools).toHaveLength(1);
    expect(find(shed.events, "TOOLS_DISCARDED")?.seat).toBe("p2");
    expect(find(shed.events, "TOOLS_DISCARDED")?.actor).toBe("p2");

    // …and the cancel is seat-relative too: p1's Tool is no help to p2's sentence.
    let onlyOpponent = board("p2");
    onlyOpponent = attachToolFromDeck(onlyOpponent, "p1", "active", BAND);
    const cancelled = swing(onlyOpponent, IDX.shed, "p2");
    expect(find(cancelled.events, "ATTACK_FAILED")?.reason).toBe("preDamage");
    expect(find(cancelled.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(cancelled.state.players.p1.active?.tools).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the loud path: nothing is skipped, in EITHER direction.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — ATTACK_EFFECT_SKIPPED, both directions", () => {
  it("none of the three new indices is reported as skipped, on ANY of their boards", () => {
    const armed = armedDefender();
    const bare = board();
    for (const index of [IDX.purge, IDX.shed, IDX.lock]) {
      expect(find(swing(armed, index).events, "ATTACK_EFFECT_SKIPPED"), String(index)).toBeUndefined();
      // …including the boards where the act did NOTHING, so "simulated" is a property
      // of the SENTENCE and not of whether anything happened — the cancelled swing too.
      expect(find(swing(bare, index).events, "ATTACK_EFFECT_SKIPPED"), String(index)).toBeUndefined();
    }
  });

  it("🛑 THE ATTRIBUTION CONTROL — index 5's unread sentence IS still reported", () => {
    // Without this the rung above passes on a build where the report was broken
    // outright, which is the vacuous-guard shape this repo keeps finding (D200→D214).
    const skipped = find(swing(board(), IDX.loud).events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe("Each player draws 3 cards.");
    expect(resolvedByAnyReader("Each player draws 3 cards.")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — 🛑 THE RESULT CHANNEL, DRIVEN BOTH WAYS, and the park still unwritable.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the result channel, and the property it did not cost", () => {
  it("🛑 `tools` DRIVEN BOTH WAYS through row 74's consequent", () => {
    // The channel is not directly observable — it is a module-private return type — so
    // it is driven through the two decisions it feeds. `tools > 0` and `tools === 0` on
    // ONE board pair, differing only in whether a Tool is attached.
    let tooled = board();
    tooled = attachToolFromDeck(tooled, "p2", "active", CHESTPLATE);
    expect(swing(tooled, IDX.lock).state.players.p2.active?.conditions.rotation).toBe(
      "paralyzed",
    );
    expect(swing(board(), IDX.lock).state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("🛑 `cancelled` DRIVEN BOTH WAYS through row 72's branch", () => {
    let armed = board();
    armed = attachToolFromDeck(armed, "p1", "active", BAND);
    expect(find(swing(armed, IDX.shed).events, "ATTACK_FAILED")).toBeUndefined();
    expect(dealt(swing(armed, IDX.shed).events)).toBe(100);
    expect(find(swing(board(), IDX.shed).events, "ATTACK_FAILED")?.reason).toBe("preDamage");
    expect(dealt(swing(board(), IDX.shed).events)).toBeUndefined();
  });

  it("🛑 the seam STILL NEVER PARKS — the board is playable the instant it returns", () => {
    // The observable form of "the widened return cannot carry a decision". If any
    // pre-damage member could park, the phase after the swing would be `effect:choose`
    // and `pending` would be non-empty — and §8.5 would have had to survive it.
    const boards: [string, GameState][] = [
      ["armed", armedDefender()],
      ["bare", board()],
      ["banded", attachToolFromDeck(board(), "p1", "active", BAND)],
      ["tooled", attachToolFromDeck(board(), "p2", "active", CHESTPLATE)],
    ];
    for (const [label, start] of boards) {
      for (const index of [IDX.purge, IDX.shed, IDX.lock]) {
        const { state } = swing(start, index);
        expect(state.phase.kind, `${label}/${index}`).not.toBe("effect:choose");
        expect(state.pending, `${label}/${index}`).toEqual([]);
      }
    }
  });

  it("🛑 the PARKING sibling is still REFUSED, pinned on the POPULATION (D423)", () => {
    // *"Discard up to 2 Pokémon Tools from your opponent's Pokémon."* is the corpus row
    // whose "up to 2" over a multi-body board is a genuine decision — exactly the
    // sentence that would force a parking pre-damage member. It carries no
    // *"Before doing damage,"* head, so it belongs at the program TAIL, and it stays
    // unbuilt. Asserted over the whole column rather than on one string.
    const claimed = CORPUS.filter(([, s]) => deriveAttackPreDamage(s) !== null).map(([, s]) => s);
    expect(claimed.sort()).toEqual([ROW71, ROW72, ROW73, ROW74].sort());
    for (const s of claimed) expect(/up to|you may|choose/i.test(s), s).toBe(false);
    const UP_TO_2 = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";
    expect(CORPUS.filter(([, s]) => s === UP_TO_2)).toHaveLength(1);
    expect(deriveAttackPreDamage(UP_TO_2)).toBeNull();
    expect(resolvedByAnyReader(UP_TO_2)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — persistence: `MATCH_RECORD_VERSION` stays 26, driven both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — nothing persisted moves, and it is DRIVEN rather than argued", () => {
  it("🛑 `MATCH_RECORD_VERSION` STAYS 26 — no field, no op, no continuation key", () => {
    // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from
    // this package, so this rung drives the SHAPES it governs rather than the number.
    // Four of them, and each is a way this slice could have owed a bump:
    //   ① a new `GameState` / `InPlayPokemon` FIELD — none: `tools`, `energy`,
    //      `discard` and `conditions.rotation` all predate this slice;
    //   ② a new `EffectOp` INHABITANT reaching `phase.cont` — none: the pre-damage
    //      shape is deliberately not an `EffectOp`, and row 74's `applyStatus` op is
    //      constructed at the call site and never enters a program;
    //   ③ a new key on the effect CONTINUATION — none: this seam never parks;
    //   ④ the WIDENED RETURN — `AttackPreDamageResult` is a local value, not a
    //      persisted carrier, which is the one axis D427 warns is easy to get wrong by
    //      reasoning from a carrier's NAME. Driven below rather than argued.
    const armed = armedDefender();
    const { state: after } = swing(armed, IDX.purge);
    expect(after.phase.kind).toBe("turn:action");
    expect(after.pending).toEqual([]);
    expect("cont" in after.phase).toBe(false);
    // The stripped body's key set, as a LITERAL rather than a diff, so "every body grew
    // a key" cannot hide inside a same-tree comparison (aquaWash's rule).
    expect(Object.keys(after.players.p2.active ?? {}).sort()).toEqual([
      "attackBlock",
      "attackDamageDebuff",
      "attackLockedTurn",
      "boostedAttack",
      "conditions",
      "damage",
      "damageReduction",
      "energy",
      "evolvedTurn",
      "healedTurn",
      "installedRecoil",
      "lockedAttacks",
      "markers",
      // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
      "noWeaknessTurn",
      "promotedTurn",
      "retreatBlocked",
      "retreatLockedTurn",
      "scheduledEffect",
      "stack",
      "tools",
      "turnPlayed",
      "usedAttack",
    ]);
    // …and the Paralysis lands in the `rotation` slot that has held it since M2, not
    // in a new one.
    let tooled = board();
    tooled = attachToolFromDeck(tooled, "p2", "active", CHESTPLATE);
    const paralyzed = swing(tooled, IDX.lock).state.players.p2.active?.conditions;
    expect(Object.keys(paralyzed ?? {}).sort()).toEqual([
      "burned",
      "poisonDamage",
      "rotation",
    ]);
  });

  it("🛑 a v26 record round-trips BOTH DIRECTIONS through every new sentence", () => {
    for (const [label, start, index] of [
      ["row71", armedDefender(), IDX.purge],
      ["row72", attachToolFromDeck(board(), "p1", "active", BAND), IDX.shed],
      ["row72-cancelled", board(), IDX.shed],
      ["row74", attachToolFromDeck(board(), "p2", "active", CHESTPLATE), IDX.lock],
    ] as [string, GameState, number][]) {
      // BACKWARD: a record written by an older deploy — the board serialized BEFORE
      // this slice's code could have touched it — rehydrates and answers identically.
      const rehydrated = JSON.parse(JSON.stringify(start)) as GameState;
      const live = swing(start, index);
      const replayed = swing(rehydrated, index);
      expect(JSON.stringify(replayed.events), label).toBe(JSON.stringify(live.events));
      expect(JSON.stringify(replayed.state), label).toBe(JSON.stringify(live.state));
      // FORWARD: the board this slice produces survives the same trip unchanged.
      const after = JSON.parse(JSON.stringify(live.state)) as GameState;
      expect(JSON.stringify(after), label).toBe(JSON.stringify(live.state));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — purity, and the version pin.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — purity and the version", () => {
  it("🛑 the swing mutates NOTHING it was given — deep-frozen boards resolve", () => {
    // Strict mode makes any write to a frozen object throw, so this is the whole
    // no-mutation claim rather than a sample of it. Driven on the board that writes to
    // BOTH sides (row 71 empties two zones on the defender) and on the one that writes
    // to the attacker's own body (row 72), which is the path this slice added.
    const frozenArmed = deepFreeze(armedDefender());
    const purge = swing(frozenArmed, IDX.purge);
    expect(frozenArmed.players.p2.active?.tools).toHaveLength(1);
    expect(frozenArmed.players.p2.active?.energy).toHaveLength(2);
    expect(purge.state.players.p2.active?.tools).toEqual([]);
    expect(purge.state.players.p2.active?.energy).toHaveLength(1);

    const frozenBanded = deepFreeze(attachToolFromDeck(board(), "p1", "active", BAND));
    const shed = swing(frozenBanded, IDX.shed);
    expect(frozenBanded.players.p1.active?.tools).toHaveLength(1);
    expect(shed.state.players.p1.active?.tools).toEqual([]);

    // The reader is pure too — same input, equal output, and it does not memoise a
    // mutable object across calls.
    for (const sentence of [ROW71, ROW72, ROW74]) {
      const first = deriveAttackPreDamage(sentence);
      const second = deriveAttackPreDamage(sentence);
      expect(first, sentence).toEqual(second);
      expect(first, sentence).not.toBe(second);
    }
  });

  it("the engine version is pinned, and it is THIS slice's pin", () => {
    // 🆕🆕 D429 — the FIFTEENTH `engineVersion` assertion in the suite (fourteen
    // inherited plus this one) and the EIGHTEENTH site overall, counting
    // `packages/engine/package.json`, `index.ts`'s declaration and `D275`'s mutant
    // anchor. ⚠️ D427 named the mechanism — **every note counts the pins it INHERITED
    // and never the one it is about to AUTHOR** — and D428 was the first note to get it
    // right. This line is the one being authored.
    expect(engineVersion).toBe("0.379.0");
  });
});
