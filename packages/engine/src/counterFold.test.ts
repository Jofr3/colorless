import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect, engineVersion, logFromEvents } from "./index";
import type { EffectOp, GameEvent, GameState, LogContext } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  COUNTER_FOLD_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 0.351.0 → 0.352.0 — 🆕🆕🆕 **D450: `counterEachAll` REACHED FROM AN ATTACK.**
//
// THREE sentences, THREE legal printings, ONE op that already existed:
//   · `censusAttackCorpus.ts` line **418** — *"Put 6 damage counters on each Pokémon
//     that has an Ability (both yours and your opponent's)."*, arm 23d;
//   · line **415** — *"Put 2 damage counters on each of your opponent's Pokémon."*,
//     arm 23e;
//   · line **414** — the same fold behind the printed window *"…that has any damage
//     counters on it."*, arm 23f.
//
// 🛑 **THE SLICE IS THE OP, NOT THE READER.** `counterEachAll` has been in the union
// since D340 and has had exactly ONE producer — Froslass's registry row — for a hundred
// and ten decisions. D449 measured all three of these sentences as *expressible with
// today's vocabulary and refused anyway*, and named three seams. All three are in one
// function body, and all three are the difference between an ABILITY caller and an
// ATTACK one:
//   (i)   the op HARDCODED `source: "ability"`, so an attack would have filed a
//         `COUNTERS_PLACED` row rendering as *"Ability: 60 damage to X"* — D136's
//         finding 1 for the fourth time on this axis (D138, D139, D140 paid the first
//         three). Now `source: "ability" | "attack"`, REQUIRED, `damageActive`'s and
//         `damageChosen`'s spelling verbatim;
//   (ii)  it made NO `effectRefused` call at all, so §11 was never consulted. Now it is
//         asked PER BODY through D259's `target` parameter, after the narrowing (D433);
//   (iii) it walked BOTH seats unconditionally. Now `side: "both" | "opponent"`,
//         REQUIRED, `disableAbilities.side`'s two words copied rather than invented.
//
// ⚠️ **AND A FOURTH SEAM THE BRIEF DID NOT NAME, FOUND BY READING THE CONSUMER**: the
// `"attack"` arm of `log.ts`'s `COUNTERS_PLACED` switch justifies its SYSTEM voice with
// *"`seat` owns the DAMAGED Pokémon, which for an attack is the attacker's OPPONENT"*.
// `side: "both"` damages the ATTACKER's own bodies, so that sentence stops being
// universal the moment arm 23d ships. The row is still right and the reason is WIDER
// than the one written — a system row names no actor at all — and the arm now says so.
//
// 🛑 **A PREMISE OF THE WORK ORDER THAT DID NOT SURVIVE, AND IT WAS THE REFUSAL.** The
// brief said line 414 *"asks for a BOARD fact"* that `matchesFilter` can never see, and
// that this is therefore *"a permanent boundary of the filter vocabulary"*. The first
// half is TRUE and measured — `matchesFilter(card: Card | undefined, …)` is handed a
// catalog card and never an `InPlayPokemon`, and its own `basicPokemon` arm names that
// as the reason the *"HP or less REMAINING"* printings are unreachable from it. **The
// conclusion does not follow.** A board fact does not have to travel through
// `CardFilter` at all: `damageChosen.damagedOnly` (D437) has read these exact eight
// printed words off an `InPlayPokemon` since it shipped. The rider was reused verbatim
// and the sentence is built. **The boundary was real and it was the wrong boundary.**
//
// 🛑 **`MATCH_RECORD_VERSION` STAYS 29, AND THE REASON IS NOT THE USUAL ONE.** Two
// REQUIRED fields on a shipped op is D386's case — normally a bump. It is free here
// because **no v29 record can contain a `counterEachAll` literal at all**: an `EffectOp`
// reaches storage only through `EffectContinuation`'s `pendingOp` and `rest`, a
// continuation is written only when a program PARKS, this op never parks, and at v29 its
// one producer was a program of length 1. §3 drives that over the serialized bytes in
// three directions, and the LOSS direction is where the argument is actually made.

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function placements(events: readonly GameEvent[]): Extract<
  GameEvent,
  { type: "COUNTERS_PLACED" }
>[] {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "COUNTERS_PLACED" }> => e.type === "COUNTERS_PLACED",
  );
}

/** The three printed sentences, transcribed byte for byte off the committed column. */
const ABILITY_FOLD =
  "Put 6 damage counters on each Pokémon that has an Ability (both yours and your opponent's).";
const BOARD_FOLD = "Put 2 damage counters on each of your opponent's Pokémon.";
const WOUNDED_FOLD =
  "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";

/** `fix-counterfold`'s attack indices, named so a board reads as a sentence. */
const IDX = { ability: 0, board: 1, wounded: 2, plain: 3 } as const;

/** Both Actives pinned to `fix-bigbody` (200 HP, NO printed Ability), p1's turn open.
    The Ability-free default matters: every board below that wants a body IN the
    `abilityPokemon` fold has to say so, so no case is green by accident. */
function table(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COUNTER_FOLD_DECK, p2: COUNTER_FOLD_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `fix-counterfold` with one {L} attached (the {C} cost, and the type that
    arms Bellibolt's clause). Both benches are cleared after the Active surgeries,
    because `setActiveFromDeck` DISPLACES rather than removes. */
function fielded(
  seed: number,
  opts: { defender?: string; mine?: readonly string[]; theirs?: readonly string[] } = {},
): GameState {
  let state = setActiveFromDeck(table(seed), "p1", "fix-counterfold");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
  for (const body of opts.mine ?? []) state = benchFromDeck(state, "p1", body);
  if (opts.defender !== undefined) state = setActiveFromDeck(state, "p2", opts.defender);
  state = clearBench(state, "p2");
  for (const body of opts.theirs ?? []) state = benchFromDeck(state, "p2", body);
  return state;
}

function attack(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the population: what is claimed, and what the family still refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the three printed folds, and the placement family's remaining refusals", () => {
  it("all three are in the legal attack column at the printing counts this slice claims", () => {
    // ⚠️ A brief's printing count is a FLOOR until it is read off the corpus (D445).
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(ABILITY_FOLD)).toBe(1);
    expect(rows.get(BOARD_FOLD)).toBe(1);
    expect(rows.get(WOUNDED_FOLD)).toBe(1);
  });

  it("all three resolve through the reader SURFACE, and the surface did not grow", () => {
    // Asked of the SURFACE rather than of one reader (D447): all three arms sit inside
    // `deriveAttackEffect`, so there is no fourteenth reader.
    for (const s of [ABILITY_FOLD, BOARD_FOLD, WOUNDED_FOLD]) {
      expect(resolvedByAnyReader(s), s).toBe(true);
    }
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the PLACEMENT family closes from TEN rows to SEVEN to TWO, each refusal by name", () => {
    // THE PATTERN, PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425), and it is D449's
    // pattern re-run rather than re-imagined: `/put \d* ?damage counters/i`, case
    // INSENSITIVE with the count OPTIONAL. The /i catches the lowercase mid-sentence
    // Ability printings; the optional count catches the *"until its remaining HP"* rows,
    // which print no number at all. A case-SENSITIVE `Put \d+` reports 16 and drops
    // three of the refusals below.
    const family = legalAttackCorpus().filter(([, t]) => /put \d* ?damage counters/i.test(t));
    expect(family).toHaveLength(19);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(38);
    const unread = family.filter(([, t]) => !resolvedByAnyReader(t));
    // 🆕🆕🆕 **D451 — SEVEN BECAME FOUR AND TWELVE BECAME SEVEN**, and the three that
    // left are the whole of bullet (c) below. ⚠️ **THE TWO NUMBERS DISAGREE FOR THE
    // FIRST TIME IN THIS SECTION'S LIFE**: the HP rows carry 2, 1 and 2 printings where
    // every sentence D449 and D450 claimed carried exactly one, so a slice that stepped
    // both figures by the same 3 would have been wrong in one of them.
    // 🆕🆕 **D456 — FOUR BECAME TWO AND SEVEN BECAME FOUR.** The two that left are the
    // RETALIATION rows, corpus lines 179 and 180 (1 printing and 2), claimed by
    // `deriveAttackEffect` over `installRecoil` — line 179 through D152's anchor with its
    // parenthetical widened to `(?:it|this Pokémon)`, line 180 through the new anchor
    // `SELF_INSTALLED_RECOIL_TAKEN` and the op's widened `amount: number | "damageTaken"`.
    // ⚠️ **THE TWO FIGURES DISAGREE AGAIN, −2 SENTENCES AND −3 PRINTINGS.**
    // They are named here as INEQUALITIES rather than dropped (D418), and the inequality
    // is the stronger rung: a single looser anchor would have claimed both sentences with
    // ONE op and passed any `toContain`-shaped successor to this block.
    // 🆕🆕🆕 D501 — TWO BECAME ONE AND FOUR BECAME THREE; the row that left is
    // corpus FILE LINE 685, named as a POSITIVE below rather than subtracted away.
    // ⚠️ THE TWO FIGURES DISAGREE BY ONE AGAIN, −1 SENTENCE AND −1 PRINTING — and this
    // time they AGREE, because the row is 1/1. Verified off the corpus rather than
    // assumed from the row being singular (D451/D461/D464).
    expect(unread.map(([, t]) => t)).toHaveLength(1);
    expect(unread.reduce((sum, [n]) => sum + n, 0)).toBe(3);
    for (const [text, program] of [
      [
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
        [{ op: "installRecoil", amount: 60 }],
      ],
      [
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
        [{ op: "installRecoil", amount: "damageTaken" }],
      ],
    ] as const) {
      expect(unread.map(([, t]) => t), text).not.toContain(text);
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
    const unbuilt = unread.map(([, t]) => t);
    // …and the three this slice claims are OUT of it, which is the delta stated as an
    // identity rather than as arithmetic in a comment.
    for (const s of [ABILITY_FOLD, BOARD_FOLD, WOUNDED_FOLD]) expect(unbuilt).not.toContain(s);

    // (a) THE SCALED TWIN — corpus line 412, **3 printings**, still the largest unbuilt
    //     row in this family. D448 refused it three ways; D449 spent the first (no
    //     anchor claims the verb). The other two are RE-MEASURED here rather than
    //     inherited and both still hold: the count is `{kind: "cardsInDiscardPile", …}`,
    //     a PAYLOAD no boolean rider carries, and the tail has no reader.
    expect(unbuilt).toContain(
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
    );
    expect(deriveAttackEffect("Then, shuffle those Energy cards into your deck.")).toBeNull();

    // (b) 🆕 THE SCALED FOLD — 1 printing, and it is THIS SLICE'S OWN nearest neighbour
    //     rather than a distant one. *"Put 1 damage **counter** on each of your
    //     opponent's Pokémon for each of your Maushold in play."* is arm 23e's sentence
    //     with a count clause bolted on, and it is refused on TWO axes at once: the
    //     singular noun (which arm 23e's plural `counters` cannot match) and the
    //     `pokemonInPlay` count, which `counterEachAll.amount` is a bare `number` for.
    //     ⚠️ **NAMED HERE BECAUSE IT IS THE ROW A WIDER ANCHOR WOULD HAVE SWALLOWED**,
    //     and swallowing it would have placed a flat 10 where the card prints a scale.
    //     🛑 **AND IT IS NOT IN `unbuilt`, BECAUSE IT IS NOT IN THE LEGAL COLUMN AT
    //     ALL** — 0 Standard-legal printings, which is a fact about the CATALOG and not
    //     about the reader. Stated rather than glossed: a near miss that carries no
    //     legal printing is still a near miss (the anchor must refuse it whatever the
    //     legality column says), and asserting it through `unbuilt` would have been a
    //     claim about the wrong population (D413/D449, the two-populations failure
    //     pointed the other way for once).
    expect(new Map(legalAttackCorpus()).has(1)).toBe(true); // the column really is loaded
    expect(
      legalAttackCorpus().some(([, t]) => t.includes("for each of your Maushold in play")),
    ).toBe(false);

    // (c) THE HP-TARGET ROWS — lines 425, 426 and 427, **5 printings**.
    //     🆕🆕🆕 **SPENT AT D451, AND THIS BULLET GOT THE PREDICATE RIGHT, THE MECHANISM
    //     RIGHT AND THE CONCLUSION WRONG.** *"…until its remaining HP is N"* does compute
    //     the amount FROM THE TARGET; `remainingHpWithin` is a PREDICATE and D451 does
    //     not call it; ONE mechanism does serve all three rows. What does not follow is
    //     *"nothing in this engine subtracts to a target"* — `koSurvivalClamp`
    //     (continuous.ts) has computed `effectiveMaxHp − KO_SURVIVAL_REMAINING_HP` since
    //     D208, which is this arithmetic under another name, and *remaining HP* has had
    //     exactly one definition (`effectiveMaxHp − damage`) since D349. The op is
    //     `counterUntilRemainingHp`; the arms are 23g and 23h.
    //     🛑 **AND THE ONE-AXIS CLAIM THIS BULLET MADE WAS ABOUT THE WRONG SENTENCE.**
    //     It said *"the FIRST of them is now a one-axis near miss of arm 23e"*, meaning
    //     line 425 — the BENCH fold, which really is a fold and really does differ from
    //     arm 23e on the amount alone plus a zone. Lines 426/427 are not folds at all:
    //     they name ONE body, and their near sibling is arm 22 (`damageActive`), not
    //     23e. D451 inherited the seat scoping from neither — the direction lives in
    //     `target`, `damageChosen`'s spelling, and the walk is the op's own.
    for (const s of [
      "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
    ]) {
      expect(unbuilt, s).not.toContain(s);
      expect(deriveAttackEffect(s)?.[0]?.op, s).toBe("counterUntilRemainingHp");
    }
    // …and the FOLD really is the near miss, driven rather than asserted in prose: arm
    // 23e's sentence and line 425 differ on the amount AND on the zone, so the two
    // programs are unequal and neither is null.
    expect(deriveAttackEffect(BOARD_FOLD)).not.toEqual(
      deriveAttackEffect(
        "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.",
      ),
    );

    // (d) THE CONFUSION SUBSTITUTION — 1 printing. Not a placement at all: it RAISES the
    //     Checkup's own per-condition amount, which is a status field reached by a status
    //     op. Refused on the VERB, which reads as this family's only because of one word.
    // 🆕🆕🆕 D501 — corpus FILE LINE 685 LEFT THIS LIST. It is claimed WHOLE by `deriveAttackEffect` through `DEFENDER_CONFUSION_N`, into an `applyStatus` carrying the raised amount — a STATUS op, which is what this family's refusal always said it would be. Re-pointed onto the OP rather than decremented (D465/D488): a count that steps says something left and nothing about what, where naming the op reddens on a reader widened past the count clause and stays green only on the build that actually shipped.
    expect(unbuilt).not.toContain(
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
    );
    expect(
      deriveAttackEffect(
        "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
      ),
    ).toEqual([
      { op: "applyStatus", target: "defender", status: "confused", confusionDamage: 80 },
    ]);

    // (e) THE BOUNDED SELF-PLACEMENT — 1 printing, and it is the row D449's published
    //     pattern could NOT see, carried forward here because a hole a predecessor named
    //     is a hole this slice inherits. `Put up to 9 …` puts the bound between the verb
    //     and the count, so `\d* ?damage counters` misses it; it is refused anyway, on a
    //     consequent that scales off what was placed.
    expect(
      deriveAttackEffect(
        "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the three anchors: what they claim, and what they must refuse.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchors derive their own ops, and the prefix pair stays disjoint", () => {
  it("each sentence derives the exact literal, counters converted to HP at the producer", () => {
    expect(deriveAttackEffect(ABILITY_FOLD)).toEqual([
      {
        op: "counterEachAll",
        amount: 60,
        filter: { kind: "abilityPokemon" },
        side: "both",
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(BOARD_FOLD)).toEqual([
      {
        op: "counterEachAll",
        amount: 20,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(WOUNDED_FOLD)).toEqual([
      {
        op: "counterEachAll",
        amount: 20,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
        damagedOnly: true,
      },
    ]);
  });

  it("🛑 the two opponent anchors are a PREFIX PAIR and the `$` is the whole of the fence", () => {
    // `COUNTER_FOLD_ON_OPPONENT_ALL`'s string is `COUNTER_FOLD_ON_OPPONENT_DAMAGED`'s
    // prefix up to the final `\.`, so a build that dropped the `$` would read the
    // windowed sentence as the bare fold and silently place counters on every body the
    // card exempts. Asserted in BOTH directions — an INEQUALITY of derived programs
    // rather than a nullity, which is the form D449 established for a near-miss rung.
    expect(deriveAttackEffect(BOARD_FOLD)).not.toEqual(deriveAttackEffect(WOUNDED_FOLD));
    // …and the difference is exactly one key, which is what makes the pair a hazard.
    const bare = (deriveAttackEffect(BOARD_FOLD) as EffectOp[])[0] as EffectOp;
    const windowed = (deriveAttackEffect(WOUNDED_FOLD) as EffectOp[])[0] as EffectOp;
    expect(Object.keys(windowed).filter((k) => !Object.keys(bare).includes(k))).toEqual([
      "damagedOnly",
    ]);
  });

  it("refuses every near miss, each on a different axis", () => {
    for (const [why, text] of [
      // THE ZONE WORD, on a sentence the legal column does not carry at all.
      [
        "the Bench-scoped windowed fold",
        "Put 2 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
      ],
      // THE SEAT, dropped: "each Pokémon" with no parenthetical names no side.
      ["no seat and no parenthetical", "Put 2 damage counters on each Pokémon."],
      // THE PARENTHETICAL, dropped from arm 23d — the printed SUBJECT is what the
      // `side` field holds, so a sentence without it has no seat scope to read.
      [
        "the ability fold with the parenthetical removed",
        "Put 6 damage counters on each Pokémon that has an Ability.",
      ],
      // THE SINGULAR NOUN — the scaled fold's own opening, and a real catalog row.
      [
        "one counter, singular",
        "Put 1 damage counter on each of your opponent's Pokémon for each of your Maushold in play.",
      ],
      // THE CASE and the POSITION: Froslass's own registry sentence, which this file's
      // op was born for and which arm 23d must never claim.
      [
        "the lowercase mid-sentence Ability printing",
        "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass.",
      ],
      // A LEADING RIDER pins `^`; a trailing one pins `$`.
      [
        "a gate clause in front",
        "Flip a coin. If heads, put 2 damage counters on each of your opponent's Pokémon.",
      ],
      [
        "a second sentence riding it",
        "Put 2 damage counters on each of your opponent's Pokémon. During your next turn, this Pokémon can't attack.",
      ],
      ["empty", ""],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
    // 🛑 THE DETERMINER — the one near miss that is NOT null and must not be asserted
    // as if it were (D449's rule: a `toBeNull` on a sentence the catalog prints is a
    // liability). *"1 of"* is arm 23b's PICK where *"each of"* is this slice's FOLD, so
    // the claim is an INEQUALITY of derived programs plus both positives beside it.
    const pick = deriveAttackEffect("Put 2 damage counters on 1 of your opponent's Pokémon.");
    expect(pick).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
    expect(pick).not.toEqual(deriveAttackEffect(BOARD_FOLD));
  });

  it("derives the CURLY apostrophe identically, and rejects a NON-BREAKING space", () => {
    // EQUALITY with the straight form, never merely non-null: a non-null check passes on
    // a reader that folded the sentence into some other row.
    for (const s of [ABILITY_FOLD, BOARD_FOLD, WOUNDED_FOLD]) {
      const curly = s.replaceAll("'", "’");
      expect(curly).not.toBe(s);
      expect(deriveAttackEffect(curly), s).toEqual(deriveAttackEffect(s));
    }
    // U+00A0, spelled as an ESCAPE rather than typed: byte-different from an ASCII space
    // and INVISIBLE in a diff, which is the whole reason it is written this way.
    expect(deriveAttackEffect(BOARD_FOLD.replace(" damage", " damage"))).toBeNull();
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${BOARD_FOLD}\n`)).toEqual(deriveAttackEffect(BOARD_FOLD));
  });

  it("accepts the unprinted counts, which is a claim about the GAME and not the INGEST", () => {
    // D131/D135/D139's standing call: an unambiguous sentence the op expresses exactly is
    // derived even where no card prints that number. A printed ZERO is refused instead —
    // both by the arm's `>= 1` guard and again by the interpreter's `amount <= 0`.
    expect(deriveAttackEffect("Put 9 damage counters on each of your opponent's Pokémon.")).toEqual(
      [
        {
          op: "counterEachAll",
          amount: 90,
          filter: { kind: "anyPokemon" },
          side: "opponent",
          source: "attack",
        },
      ],
    );
    expect(deriveAttackEffect("Put 0 damage counters on each of your opponent's Pokémon.")).toBeNull();
    expect(
      deriveAttackEffect(
        "Put 0 damage counters on each Pokémon that has an Ability (both yours and your opponent's).",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted op, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — TWO REQUIRED fields on a shipped op, and the record version does not move", () => {
  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in THREE directions", () => {
    // 🛑 **WHICH SITUATION THIS IS, ASKED RATHER THAN INHERITED.** Adding a REQUIRED key
    // to a persisted structure is D386's case and has cost a bump seven times. What makes
    // it free here is a REACHABILITY fact and nothing softer.

    // **DIRECTION 1 — FORWARD: the literal this deploy writes, whole.** Key sets are
    // asserted rather than eyeballed, because "the object looked right" is how an
    // optional key goes missing.
    const fresh = (deriveAttackEffect(BOARD_FOLD) as EffectOp[])[0] as EffectOp;
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"counterEachAll","amount":20,"filter":{"kind":"anyPokemon"},"side":"opponent","source":"attack"}',
    );
    expect(Object.keys(fresh).sort()).toEqual(["amount", "filter", "op", "side", "source"]);
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
    // …and the registry's own literal, which gained the SAME two keys in the same commit.
    const shroud = programFor("sv06-053")?.triggered?.[0]?.program?.[0] as EffectOp;
    expect(JSON.stringify(shroud)).toBe(
      '{"op":"counterEachAll","amount":10,"filter":{"kind":"abilityPokemon"},"side":"both","source":"ability","exceptNamed":"Froslass"}',
    );

    // **DIRECTION 2 — BACKWARD, AND IT IS THE ONE THAT DECIDES THE VERSION.** An
    // `EffectOp` reaches storage by exactly one route: `EffectContinuation` carries
    // `{pendingOp, rest, ctx, record}` and lives at `GameState.phase.cont`, which
    // `MatchRecord.state` persists. A continuation is written only when a program PARKS.
    // **This op never parks and never could have**, so no v29 record can hold the old
    // three-key literal — there is nothing to read back wrongly.
    //   · the op's own `stepOp` arm returns `{ done }` and never `{ park }`, driven
    //     below on all three arms by the absence of an `effect:choose` phase;
    //   · and at v29 its ONE producer was a program of LENGTH 1, so it could not even
    //     ride `cont.rest` behind somebody else's park. Measured off the LIVE registry
    //     rather than recalled.
    //     ⚠️ THE SWEEP IS OVER `registryCardIds()` AND NOT OVER `FIXTURE_POOL`, which
    //     is D342's repair inherited rather than re-earned: a pool-scoped auditor
    //     audits the pool. Its FOUR program-bearing keys are walked (`attack`,
    //     `abilities`, `triggered`, `trainer`); `energy` and `passive` carry no
    //     `EffectOp[]` at all, which is what makes those four total.
    const authored: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const card = programFor(id);
      if (card === undefined) continue;
      for (const ops of Object.values(card.attack ?? {})) authored.push(ops);
      for (const ability of card.abilities ?? []) authored.push(ability.program);
      for (const trigger of card.triggered ?? []) authored.push(trigger.program);
      if (card.trainer !== undefined) authored.push(card.trainer);
    }
    const producers = authored.filter((ops) => ops.some((o) => o.op === "counterEachAll"));
    expect(producers).toHaveLength(3); // the three Froslass printings, ONE object each
    for (const ops of producers) {
      expect(ops).toHaveLength(1);
      expect(ops[0]?.op).toBe("counterEachAll");
    }
    for (const index of [IDX.ability, IDX.board, IDX.wounded]) {
      const { state } = attack(fielded(20 + index, { theirs: ["fix-bigbody"] }), index);
      expect(state.phase.kind, `index ${index}`).not.toBe("effect:choose");
    }

    // **DIRECTION 3 — THE LOSS DIRECTION, AND IT IS THE ONE THE BRIEF WAS RIGHT TO
    // DEMAND.** A required key added to a shipped op normally degrades a v29 record into
    // a silent wrong answer, and BOTH of these would: a lost `side` leaves the seat
    // switch with no arm (a fold over `undefined`), and a lost `source` files a
    // `COUNTERS_PLACED` whose label matches no arm of `log.ts`'s switch — a row that
    // simply does not render. Neither is a soft landing, and neither is REACHABLE,
    // because direction 2 established there is no record to lose them from. Both halves
    // are stated, because the second alone would read as an excuse.
    for (const key of ["op", "amount", "filter", "side", "source"] as const) {
      const dropped = JSON.parse(
        JSON.stringify(fresh, (k, v) => (k === key ? undefined : v)),
      ) as Record<string, unknown>;
      expect(Object.keys(dropped), key).not.toContain(key);
      // the mutilated record is not the op any producer in this engine emits…
      expect(dropped).not.toEqual(fresh);
      expect(dropped).not.toEqual(shroud);
    }
    // …and the two lost values have NO default anywhere: `side` cannot fall back to
    // `"both"` and `source` cannot fall back to `"ability"`, which are precisely the two
    // values that would have made a loss look like a working board.
    expect(fresh).not.toMatchObject({ side: "both" });
    expect(fresh).not.toMatchObject({ source: "ability" });
  });

  it("the engine version moved and the record version did not", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the BOTH-SEATS fold: the filter, the attacker's own board, and flatness.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — arm 23d walks both boards and the noun decides who is on it", () => {
  it("🛑 counters land on every Ability body on BOTH seats and on nothing else", () => {
    // Four bodies, two on each side, and exactly two of them carry a printed Ability.
    // The attacker itself carries none — deliberately (see the fixture), so "walks my
    // board" cannot be confused with "walks the body it is standing on".
    const state = fielded(30, {
      mine: ["fix-idlebody", "fix-bigbody"],
      defender: "fix-idlebody",
      theirs: ["fix-bigbody"],
    });
    const { state: after, events } = attack(state, IDX.ability);
    const placed = placements(events);
    expect(placed).toHaveLength(2);
    // ONE row per seat, and each row's `seat` owns the DAMAGED body — which on this
    // board is the whole point: a build that filed both under the attacker's seat would
    // read identically on every one-seat board in this file.
    expect(placed.map((e) => e.seat).sort()).toEqual(["p1", "p2"]);
    expect(placed.every((e) => e.amount === 60)).toBe(true);
    // 6 counters = 60 HP, at the PRODUCER.
    expect(after.players.p1.bench[0]?.damage).toBe(60); // own Ability body — the seam
    expect(after.players.p2.active?.damage).toBe(60);
    // …and the three bodies WITHOUT a printed Ability are untouched, including the
    // attacker. Without these the filter is unfalsifiable (D448).
    expect(after.players.p1.active?.damage).toBe(0);
    expect(after.players.p1.bench[1]?.damage).toBe(0);
    expect(after.players.p2.bench[0]?.damage).toBe(0);
  });

  it("a board with NO Ability body anywhere is a silent whiff, not an error", () => {
    const { state: after, events } = attack(
      fielded(31, { mine: ["fix-bigbody"], theirs: ["fix-bigbody"] }),
      IDX.ability,
    );
    expect(placements(events)).toHaveLength(0);
    expect(after.players.p1.active?.damage).toBe(0);
    expect(after.players.p2.active?.damage).toBe(0);
    // the turn still ends on the attack — a whiffed effect is not a refused attack
    expect(find(events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("the placement is FLAT — a ×2 Weakness does not double it", () => {
    // §8.5 does not apply to a PLACED counter (D138/D139), and the catalog prints the
    // rule on Bronzong sv03-145. `fix-lightning-weak` is ×2 Lightning at 130 HP and the
    // attacker is {L}, so a build that routed this through the damage pipeline would
    // read 40 where the print says 20. The `anyPokemon` fold is used because
    // `fix-lightning-weak` carries no Ability and arm 23d would skip it.
    const { state: after } = attack(fielded(32, { defender: "fix-lightning-weak" }), IDX.board);
    expect(after.players.p2.active?.damage).toBe(20);
    // …and the printed-damage control on the SAME body does double, which is what makes
    // the 20 above a measurement rather than a coincidence.
    const { state: control } = attack(fielded(32, { defender: "fix-lightning-weak" }), IDX.plain);
    expect(control.players.p2.active?.damage).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the SEAT: arm 23e reaches one board and stops.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — arm 23e walks the opponent's board only", () => {
  it("🛑 every opponent body takes counters and the attacker's whole board is untouched", () => {
    const state = fielded(40, {
      mine: ["fix-idlebody", "fix-bigbody"],
      theirs: ["fix-bigbody", "fix-lightning-weak"],
    });
    const { state: after, events } = attack(state, IDX.board);
    const placed = placements(events);
    expect(placed).toHaveLength(3); // their Active + both benched bodies
    expect(placed.every((e) => e.seat === "p2")).toBe(true);
    expect(after.players.p2.active?.damage).toBe(20);
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([20, 20]);
    // 🛑 THE SEAT, DRIVEN: p1's own board is the half a `side: "both"` build would ruin,
    // and one of these three bodies carries an Ability so the ability fold's board would
    // have touched it.
    expect(after.players.p1.active?.damage).toBe(0);
    expect(after.players.p1.bench.map((b) => b.damage)).toEqual([0, 0]);
  });

  it("the noun is BARE, so a body with no Ability is in scope where arm 23d skipped it", () => {
    // The same board through both arms: `anyPokemon` admits `fix-bigbody`,
    // `abilityPokemon` does not. Read as an INEQUALITY of boards rather than as two
    // separate claims, because that is what tells the two filters apart.
    const state = fielded(41, { theirs: ["fix-bigbody"] });
    const viaBare = attack(state, IDX.board).state.players.p2;
    const viaAbility = attack(state, IDX.ability).state.players.p2;
    expect(viaBare.active?.damage).toBe(20);
    expect(viaBare.bench[0]?.damage).toBe(20);
    expect(viaAbility.active?.damage).toBe(0);
    expect(viaAbility.bench[0]?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the WINDOW: `damagedOnly`, D437's rider on a walk instead of a pick.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — arm 23f narrows to bodies that already carry damage", () => {
  it("🛑 only the already-damaged bodies take counters, and the control takes them all", () => {
    let state = fielded(50, { theirs: ["fix-bigbody", "fix-bigbody"] });
    state = setDamage(state, "p2", 30); // their Active is wounded
    state = setBenchDamage(state, "p2", 1, 10); // …and the SECOND benched body only
    const { state: after, events } = attack(state, IDX.wounded);
    expect(placements(events)).toHaveLength(2);
    expect(after.players.p2.active?.damage).toBe(50);
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([0, 30]);
    // …and arm 23e on the identical board takes all three, which is the only thing that
    // makes the skipped body above a measurement (D448's one-print-fixture rule).
    const { state: control } = attack(state, IDX.board);
    expect(control.players.p2.active?.damage).toBe(50);
    expect(control.players.p2.bench.map((b) => b.damage)).toEqual([20, 30]);
  });

  it("the threshold is `damage > 0` and not `>= 10`, so a HALVED hit is a candidate", () => {
    // D437's spelling decision, pinned one op over and inherited here rather than
    // re-made: `hasAnyDamageCounters` reads the field, and a 5-damage body IS a
    // candidate. Unreachable off a printing today and constructible as a fixture, which
    // is exactly the case a comment would get wrong.
    let state = fielded(51, { theirs: ["fix-bigbody"] });
    state = setBenchDamage(state, "p2", 0, 5);
    const { state: after } = attack(state, IDX.wounded);
    expect(after.players.p2.active?.damage).toBe(0); // undamaged Active, skipped
    expect(after.players.p2.bench[0]?.damage).toBe(25); // 5 + 20
  });

  it("a board where nothing is damaged is a whiff", () => {
    const { state: after, events } = attack(fielded(52, { theirs: ["fix-bigbody"] }), IDX.wounded);
    expect(placements(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — §11: which printed shield refuses a PLACED counter, and how far it reaches.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the prevention gate, asked PER BODY", () => {
  it("🛑 the EFFECTS shield REFUSES the placement — and the DAMAGE shield does not", () => {
    // A placed counter is NOT damage (D138/D139/D142; the catalog prints the rule on
    // Bronzong sv03-145), so it falls to the EFFECTS half of the family and to nothing
    // else. Neither assertion means anything without the other: "the shield refused it"
    // passes on a build that refuses everything, "the shield let it through" on a build
    // that gates nothing. Four boards, two shields, one axis each.
    //
    // `fix-unaware` — "Prevent all effects of attacks used by your opponent's Pokémon
    // done to this Pokémon. (Damage is not an effect.)"
    const shielded = attack(fielded(60, { defender: "fix-unaware" }), IDX.board);
    expect(find(shielded.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2" });
    expect(placements(shielded.events)).toHaveLength(0);
    expect(shielded.state.players.p2.active?.damage).toBe(0);
    const shieldedControl = attack(fielded(60, { defender: "fix-unaware" }), IDX.plain);
    expect(find(shieldedControl.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20 });
    expect(shieldedControl.state.players.p2.active?.damage).toBe(20);

    // `sv03-078` Bellibolt — "Prevent all damage done to this Pokémon by attacks from
    // your opponent's {L} Pokémon." The attacker is {L}, so the clause is ARMED: it
    // prevents the control outright and must not touch the placement.
    const damageShield = attack(fielded(61, { defender: "sv03-078" }), IDX.board);
    expect(find(damageShield.events, "COUNTERS_PLACED")).toMatchObject({ amount: 20 });
    expect(find(damageShield.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(damageShield.state.players.p2.active?.damage).toBe(20);
    const damageShieldControl = attack(fielded(61, { defender: "sv03-078" }), IDX.plain);
    expect(find(damageShieldControl.events, "DAMAGE_DEALT")).toMatchObject({
      prevented: true,
      dealt: 0,
    });
    expect(damageShieldControl.state.players.p2.active?.damage).toBe(0);
  });

  it("🛑 a shield on ONE body silences exactly that body — the rest of the fold lands", () => {
    // THE WHOLE REASON A SPREAD PLACER IS A DIFFERENT §11 EXPOSURE FROM A SINGLE-TARGET
    // ONE. Refusing the op WHOLE would let one shielded body protect an entire board, a
    // rule no printing states — D259's judgement for a candidate SET, reached here by a
    // walk. Three bodies, one of them shielded, and the assertion is on all three.
    const state = fielded(62, { theirs: ["fix-unaware", "fix-bigbody"] });
    const { state: after, events } = attack(state, IDX.board);
    expect(placements(events)).toHaveLength(2);
    expect(after.players.p2.active?.damage).toBe(20);
    expect(after.players.p2.bench[0]?.damage).toBe(0); // the shielded BENCHED body
    expect(after.players.p2.bench[1]?.damage).toBe(20);
    // ONE prevention row, naming the ONE body — not one per fold and not one per seat.
    const prevented = events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED");
    expect(prevented).toHaveLength(1);
    // ⚠️ **AND THE SHIELDED BODY IS ON THE BENCH, WHICH IS A DIFFERENCE FROM THE SNIPE
    // AND IS STATED RATHER THAN GLOSSED.** `placeSnipe`'s bench branch consults no
    // shield at all (`snipeTargets` deliberately omits `unshieldedRefs` — its own doc
    // block), so the put-counter PICK is gated on the Active alone. A FOLD has no
    // candidate list and no prompt: it touches, so every body it touches is asked. The
    // asymmetry is real, it is the snipe's to resolve, and this rung is the record of it.
  });

  it("the refusal is asked AFTER the narrowing, so a body the sentence never names is silent", () => {
    // D433's ordering rule, driven rather than commented: `fix-unaware` carries a
    // printed Ability, so arm 23d NAMES it and it files a prevention row; under arm 23f
    // it is undamaged, so the window drops it BEFORE the gate and no row is filed at
    // all. Every board is identical under both orderings — the only casualty of getting
    // it backwards is a false log row, which is exactly why it would survive review.
    const named = attack(fielded(63, { defender: "fix-unaware" }), IDX.ability);
    expect(named.events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    const notNamed = attack(fielded(63, { defender: "fix-unaware" }), IDX.wounded);
    expect(notNamed.events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    expect(notNamed.state.players.p2.active?.damage).toBe(0);
  });

  it("🛑 the OWN-SIDE half of the both-seats fold is refused by NOTHING, and the gate says so", () => {
    // D430: every §11 shield in the pool names the ATTACK'S SOURCE and the source it
    // names is always the holder's OPPONENT, so `effectRefusedOn` returns false on
    // `seat === ctx.seat`. A Mist-style shield standing on the ATTACKER's own Bench does
    // not stop the attacker's own printed sentence. Driven because the alternative — a
    // gate that "conservatively" protects everything — is a wrong answer that looks
    // careful, and `side: "both"` is the first placement producer that can reach it.
    const state = fielded(64, { mine: ["fix-unaware"], defender: "fix-idlebody" });
    const { state: after, events } = attack(state, IDX.ability);
    expect(after.players.p1.bench[0]?.damage).toBe(60); // own shielded body: countered
    expect(after.players.p2.active?.damage).toBe(60);
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the Knock Out: the Prize is paid, on either seat, and the cause is DAMAGE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — a lethal placement Knocks Out and pays a Prize to the other seat", () => {
  it("🛑 the opponent-side KO owes the ATTACKER a Prize", () => {
    // The op never KOs; `finishAttack`'s TWO-SEAT sweep does (flow.ts), and `lethalRefs`
    // walks Active AND Bench on both seats — which is what makes the own-side case below
    // work with no code written for it.
    let state = fielded(70, { theirs: ["fix-bigbody"] });
    state = setDamage(state, "p2", 180); // 200 HP at 180 → 20 is exactly lethal
    const { state: after, events } = attack(state, IDX.board);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(find(events, "PRIZES_OWED")).toMatchObject({ seat: "p1", count: 1 });
    // …and the benched body's own placement is not swallowed by the KO
    expect(after.players.p2.bench[0]?.damage).toBe(20);
    expect(after.phase.kind).toBe("ko:takePrizes");
  });

  it("🛑 the OWN-SIDE KO owes the OPPONENT a Prize — D425's seam, reached by a placement", () => {
    // `side: "both"` is the first thing in this engine that can Knock Out the ATTACKER's
    // own body with a placed counter. `collectKnockOutPass` owes each Knock Out's Prize
    // to `otherSeat(entry.ref.seat)`, so the opponent is paid with no code written here
    // or there — and that is precisely the kind of fact that is true by construction and
    // wrong the first time nobody checks it.
    let state = fielded(71, { mine: ["fix-idlebody"], defender: "fix-bigbody" });
    state = setBenchDamage(state, "p1", 0, 140); // 200 HP at 140 → 60 is exactly lethal
    const { events } = attack(state, IDX.ability);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1" });
    expect(find(events, "PRIZES_OWED")).toMatchObject({ seat: "p2", count: 1 });
    // the defender carries no printed Ability, so it is NOT in the fold and this board
    // has exactly one Knock Out — a two-sided batch would make the seat above ambiguous.
    expect(events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(1);
  });

  it("🛑 the KO is BY DAMAGE, and Vengeful Punch is where D414's marker is observable", () => {
    // `koByEffect:<turn>` (types.ts) is stamped by ops that make a body lethal WITHOUT
    // damaging it, and `koRecoilOf` (flow.ts) reads it to decide whether the printed
    // "Knocked Out BY DAMAGE from an attack" recoil is owed. A placed counter DOES place
    // damage, so no marker is stamped and the recoil IS owed — D434's own stated rule
    // reaching a third producer.
    //
    // ⚠️ **THE ABSENCE IS DRIVEN THROUGH ITS READER RATHER THAN READ OFF THE BODY**: the
    // KO'd body is gone by the time the events are inspected, so `markers` cannot be
    // asserted at all. The recoil firing IS the observation, and it goes RED in exactly
    // one direction — a build that stamped the marker here would leave the attacker
    // undamaged.
    let state = fielded(72);
    state = attachToolFromDeck(state, "p2", "active", "sv03-197");
    state = setDamage(state, "p2", 180);
    const { state: after, events } = attack(state, IDX.board);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(after.players.p1.active?.damage).toBe(40); // 4 counters, back onto the attacker
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the log row, and the Ability caller that must not have moved.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — `source` on the wire, and the shipped Ability path unchanged", () => {
  it("🛑 an attack's placement renders in the PRINTED verb and never the word Ability", () => {
    // D136's finding 1, refused at the source for the fourth time on this axis. The
    // `"ability"` arm prints the literal word Ability, which on an attack is false; the
    // `"attack"` arm prints "Put:". This is the assertion that fails the moment somebody
    // "simplifies" the field back into a hardcode.
    const { state: after, events } = attack(fielded(80, { defender: "fix-idlebody" }), IDX.board);
    expect(placements(events).every((e) => e.source === "attack")).toBe(true);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: after, elapsed: "+00:07" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
    const placed = rendered.find((r) => r.text.startsWith("Put:"));
    expect(placed).toBeDefined();
    expect(placed?.who).toBe("system");
    expect(placed?.text).toContain("20");
    expect(placed?.text).not.toContain("Ability");
    // ⚠️ THE SYSTEM VOICE'S STATED REASON NARROWED WITH THIS SLICE AND THE ROW DID NOT.
    // The arm justifies "system" by "`seat` is the attacker's OPPONENT"; on the
    // both-seats fold it is not, and the row is still system-voiced and still correct,
    // because a system row names no actor to get wrong. Driven, not argued.
    const own = attack(fielded(81, { mine: ["fix-idlebody"], defender: "fix-bigbody" }), IDX.ability);
    const ownRows = logFromEvents(own.events, {
      names: { p1: "Ember", p2: "Tide" },
      state: own.state,
      elapsed: "+00:08",
    }).flatMap((entry) =>
      entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
    const ownPlaced = ownRows.find((r) => r.text.startsWith("Put:"));
    expect(ownPlaced?.who).toBe("system");
    expect(placements(own.events)[0]?.seat).toBe("p1"); // the ATTACKER's own body
  });

  it("the registry Ability path is byte-identical across this slice", () => {
    // ⚠️ **THE ONE THING A SEAM SLICE MUST PROVE ABOUT THE CALLER IT DID NOT COME FOR.**
    // `effectRefusedOn` returns false at `ctx.invokedBy !== "attack"`, and a triggered
    // Ability leaves `invokedBy` ABSENT — so Froslass now consults a gate it never used
    // to, is never refused by it, and pushes no event. The whole of `freezingShroud.test.ts`
    // is the real witness; this is the field-level statement of why it stayed green.
    const program = programFor("sv06-053")?.triggered?.[0]?.program;
    expect(program).toEqual([
      {
        op: "counterEachAll",
        amount: 10,
        filter: { kind: "abilityPokemon" },
        side: "both",
        source: "ability",
        exceptNamed: "Froslass",
      },
    ]);
  });
});

// A reference to `applyAction` so the import earns its place: every board above goes
// through `mustApply`, which wraps it — this is the one direct call, and it pins that a
// second attack in the same turn is refused, i.e. that the boards above really did end
// their turn on the attack rather than leaving one open (§8's one-attack rule).
describe("§10 — the attack really is the turn's last action", () => {
  it("refuses a second attack after the fold resolves", () => {
    const { state } = attack(fielded(90, { theirs: ["fix-bigbody"] }), IDX.board);
    expect(applyAction(state, { type: "attack", seat: "p1", index: IDX.board }).ok).toBe(false);
  });
});
