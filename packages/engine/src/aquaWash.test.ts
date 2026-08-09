import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// D296 — THE `discardEnergy` DECLINE, AND THERE WAS NOTHING TO BUILD.
//
// FOUR legal printings, three sentences, all four ATTACKS:
//   • Octillery `sv09-034` "Aqua Wash" ({W}, 20)
//       "You may put an Energy attached to your opponent's Active Pokémon into
//        their hand."
//   • Unfezant `sv05-135` "Opposing Winds" ({C}{C}, 70) and Slowking
//     `sv08.5-019` "Wash the Slate Clean" ({W}{C}{C}, 70) — ONE sentence, two
//     printings:
//       "You may put 2 Energy attached to your opponent's Active Pokémon into
//        their hand."
//   • Paldean Tauros `sv08-039` "Upthrusting Horns" ({C}{C}, 30)
//       "You may put 2 Energy attached to your opponent's Active Stage 2
//        Pokémon into their hand."
//
// ── ⚠️ THE INHERITED REFUSAL, RE-TYPED ───────────────────────────────────────
// D295 measured this population and REFUSED all four, typing the blocker as
// **MISSING: CODE** — *"THE BLOCKER FOR ALL FOUR IS ONE WORD: 'MAY'.
// `discardEnergy` is MANDATORY BY CONSTRUCTION and its doc block says so in as
// many words … so building this is a DELIBERATE RE-OPENING of a written
// contract, not the filling of a gap."*
//
// 🛑 **THERE WAS NO MISSING CODE, AND THE CONTRACT WAS NEVER RE-OPENED.** The
// decline these sentences want is not a rider on `discardEnergy` at all: it is
// `optional` — D186's FOURTH GATE, with producers since D202 — and that op's own
// doc block NAMES `discardEnergy` in its list of ops the wrapper must not double
// up on. It names the exact MODE that must not, too: *"`discardEnergy
// {kind:"upTo"}` … park with a legal EMPTY answer, so the decline the wrapper
// grants is a decline their own prompt already offers. This op is for the inner
// op that has NO empty answer."* The `total` scope these four print is precisely
// that op. **THE WRAPPER WAS WRITTEN FOR THIS SENTENCE TEN SLICES BEFORE THE
// SENTENCE WAS LOOKED AT**, and the paragraph D295 read is TRUE of the op it is
// printed on and silent about the union member next to it.
//
// 🛑 THE GENERAL FORM, WHICH IS THE LESSON: **A CONTRACT WRITTEN ON ONE OP IS
// NOT A CONTRACT ABOUT THE SENTENCE.** "This park has NO decline" is a fact
// about a park. "You may" is a fact about a card. Reading the first as an answer
// to the second cost this row a whole slice — and the type of the refusal was
// wrong, not merely its conclusion: it was never MISSING CODE, it was a MISSING
// COMPOSITION, which is the one kind of blocker that costs nothing to clear.
//
// ── WHY THE WRAPPER AND NOT `count: "any"` + `cap` ───────────────────────────
// `discardEnergy` already carries a declinable mode (`count: "any"`, Chien-Pao
// ex "Hail Blade") with an optional ceiling (`cap`, Mewtwo VSTAR "Psy Purge").
// For Octillery's "an" the two builds would offer the IDENTICAL choice set
// (0..1). For the three "2 Energy" printings they would not: `{count:"any",
// cap:2}` legalises a pick of **ONE**, and "you may put 2" is a decline or a
// pair, never a single. `§4` below drives that difference on a real board.
//
// ── WHAT IS ACTUALLY NEW ─────────────────────────────────────────────────────
// ONE regex, ONE deriver arm, and ONE `BoardCondition` member
// (`opponentActiveIsStage2`, reusing D262's `isStage2Pokemon` VERBATIM) for
// Tauros's restricting adjective — the second mechanism D295 priced this row's
// fourth printing at, and the price held. No new op, no new prompt kind, no new
// choice kind, no new event, no `@luminous/schema` diff, no `src/` diff.
//
// ── THE CENSUS, RE-DERIVED (never inherited) ─────────────────────────────────
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a), 2026-08-08,
// `legal_standard = 1`:
//   • `attacks_json LIKE '%into their hand%'` → **4** (these four; abilities 0)
//   • `attacks_json LIKE '%Active Stage 2 Pok%'` → **1** (Tauros alone)
//   • the wider `attacks_json LIKE '%attached to your opponent%'` sweep returns
//     28 rows; the 24 that are not ours are the "for each Energy attached to
//     your opponent's Active Pokémon" scaling family, which no anchor here can
//     reach.
// ⚠️ THREE ILLEGAL NEAR-MISSES ARE REAL PRINTINGS AND ARE PINNED BELOW:
// Meowscarada `sv01-015` prints Octillery's sentence BYTE FOR BYTE at
// `legal_standard = 0` (so the sentence's DERIVED population is 2 and its LEGAL
// population is 1), and Omanyte `sv03.5-138`/`-180` "Tentacular Return" print
// the MANDATORY twin — the same sentence with the two words "You may" removed.
// Both Omanyte printings are illegal, which is why the anchor REQUIRES "You may"
// instead of carrying an optional group: a `(?:You may )?` build would derive a
// sentence with no Standard-legal printing behind it, i.e. author a card.

const AN = "You may put an Energy attached to your opponent's Active Pokémon into their hand.";
const TWO = "You may put 2 Energy attached to your opponent's Active Pokémon into their hand.";
const TWO_STAGE2 =
  "You may put 2 Energy attached to your opponent's Active Stage 2 Pokémon into their hand.";

/** The inner op, built once. `to: "hand"` is D295's field and `from:
    "opponentActive"` is the hammer family's own arm — this row composes two
    things that already existed and adds a third word in front of them. */
function put(count?: number): EffectOp {
  return {
    op: "discardEnergy",
    from: "opponentActive",
    filter: { kind: "anyEnergy" },
    to: "hand",
    ...(count === undefined ? {} : { count }),
  };
}

function wrapped(note: string, then: EffectOp[]): EffectOp[] {
  return [{ op: "optional", note, then }];
}

/** The three sentences with their LEGAL printing counts, kept as data so the
    arithmetic is asserted rather than described. */
const CLAUSES = [
  { text: AN, program: wrapped(AN, [put()]), legalPrintings: 1, ids: ["sv09-034"] },
  { text: TWO, program: wrapped(TWO, [put(2)]), legalPrintings: 2, ids: ["sv05-135", "sv08.5-019"] },
  {
    text: TWO_STAGE2,
    program: [
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsStage2" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-op list, not a thenable (arrays are not callable).
        then: wrapped(TWO_STAGE2, [put(2)]),
      },
    ] as EffectOp[],
    legalPrintings: 1,
    ids: ["sv08-039"],
  },
] as const;

describe("§0 — the anchor: 3 sentences, 4 legal printings, one regex", () => {
  it("derives each printed sentence to its wrapped program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 4 legal printings across 3 sentences", () => {
    expect(CLAUSES).toHaveLength(3);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(4);
    expect(CLAUSES.flatMap((c) => c.ids)).toEqual([
      "sv09-034",
      "sv05-135",
      "sv08.5-019",
      "sv08-039",
    ]);
  });

  it("wraps the SAME inner op the hammer arm already derives, plus `to` and the count", () => {
    // The family's checkable claim: there is ONE action here and the printed
    // "You may" is a gate in front of it. Read the gate apart rather than
    // re-typing the op — the bare hammer sentence is D142's own anchor, and the
    // only differences this row's inner op carries are the DESTINATION and the
    // count, both of which are named here explicitly.
    const bare = deriveAttackEffect("Discard an Energy from your opponent's Active Pokémon.");
    expect(bare).toEqual([{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }]);
    const gate = deriveAttackEffect(AN)?.[0];
    expect(gate?.op).toBe("optional");
    const inner = gate?.op === "optional" ? gate.then : [];
    expect(inner).toHaveLength(1);
    const only = inner[0];
    expect(only?.op === "discardEnergy" ? only.from : undefined).toBe("opponentActive");
    expect(only?.op === "discardEnergy" ? only.to : undefined).toBe("hand");
    expect(only?.op === "discardEnergy" ? only.count : undefined).toBeUndefined();
  });

  it("carries the printed sentence VERBATIM as the note", () => {
    // The note is what both HUDs render as the dialog's only prose, so the
    // assertion is byte equality with the catalog string. A mutant that rebuilt
    // the sentence from the capture (`You may put ${n} Energy …`) passes for
    // TWO and dies on AN, whose printed word is the article.
    for (const { text } of CLAUSES) {
      const top = deriveAttackEffect(text)?.[0];
      // Tauros's program is gated, so the ask is one level down — descend
      // rather than special-case, so the loop asserts all three sentences.
      const ask = top?.op === "conditionGate" ? top.then[0] : top;
      expect(ask?.op === "optional" ? ask.note : undefined, text).toBe(text);
    }
    // …and the whitespace tolerance the reader documents: the note is the
    // TRIMMED string, which is the sentence.
    const padded = deriveAttackEffect(`  ${AN}\n`)?.[0];
    expect(padded?.op === "optional" ? padded.note : undefined).toBe(AN);
    // …and the note is what BOTH surfaces render, so the sentence with the
    // adjective keeps the adjective — the gate does not eat a printed word.
    const tauros = deriveAttackEffect(TWO_STAGE2)?.[0];
    const inner = tauros?.op === "conditionGate" ? tauros.then[0] : undefined;
    expect(inner?.op === "optional" ? inner.note : "").toContain("Stage 2");
  });

  it("the Stage 2 group is the ONLY difference between TWO and TWO_STAGE2", () => {
    // Stated as string surgery rather than by eye, because the two sentences
    // differ by eight characters and a build that dropped the group would still
    // derive both — to the same program.
    expect(TWO_STAGE2).toBe(TWO.replace("Active Pokémon", "Active Stage 2 Pokémon"));
    const gated = deriveAttackEffect(TWO_STAGE2)?.[0];
    const ungated = deriveAttackEffect(TWO) ?? [];
    // 🛑 The gate is the OUTER op and the "may" sits INSIDE it — the inversion
    // of the printed word order that the arm's own block argues for.
    expect(gated?.op).toBe("conditionGate");
    expect(ungated[0]?.op).toBe("optional");
    // The gate's BODY is the ungated sentence's WHOLE program, with only the
    // note differing (the note is the matched string, so it carries the
    // adjective the gate reads).
    const body = gated?.op === "conditionGate" ? gated.then : [];
    expect(body).toEqual(wrapped(TWO_STAGE2, [put(2)]));
    const bodyAsk = body[0];
    const plainAsk = ungated[0];
    expect(bodyAsk?.op === "optional" ? bodyAsk.then : undefined).toEqual(
      plainAsk?.op === "optional" ? plainAsk.then : undefined,
    );
  });
});

describe("§1 — the near-misses: what an over-wide anchor would eat", () => {
  /** REAL printed sentences from the same sweep. Every entry is a witness. */
  const NEAR_MISSES = [
    // 🛑 THE MANDATORY TWIN — Omanyte sv03.5-138/-180 "Tentacular Return", both
    // `legal_standard = 0`. This is the sentence a `(?:You may )?` group would
    // eat, and deriving it would be authoring a card with no legal printing.
    "Put an Energy attached to your opponent's Active Pokémon into their hand.",
    "Put 2 Energy attached to your opponent's Active Pokémon into their hand.",
    // The SHUFFLE destination (Masquerain sv04-002 "Daunting Eyes") — the same
    // noun phrase, a different zone, and behind an until-tails loop.
    "Flip a coin until you get tails. For each heads, shuffle an Energy attached to your opponent's Active Pokémon into their deck.",
    // The SCALING family, 24 legal printings on this exact noun phrase. Nothing
    // is put anywhere; the phrase is a counter.
    "This attack does 20 more damage for each Energy attached to your opponent's Active Pokémon.",
    "This attack does 20 damage for each Energy attached to your opponent's Active Pokémon.",
    // The hammer's own bare sentence with the wrapper's prefix bolted on — a
    // "You may" over an op whose sentence this anchor does not read.
    "You may discard an Energy from your opponent's Active Pokémon.",
    // The WHOLE-BOARD victim (Chill Teaser Toy sv08-166's body, D295) — a
    // Trainer sentence, `opponentChosen` rather than `opponentActive`, and no
    // attack deriver reads it.
    "You may put an Energy attached to 1 of your opponent's Pokémon into their hand.",
    // ⚠️ NOT LISTED: "Put a Supporter card from your discard pile into your
    // hand." (Phione sv06-055/-175 "Beckon"). It is the OWN-hand family the
    // census separated out, and it DERIVES — through a different reader that
    // predates this slice. Pinned as a POSITIVE below rather than as a
    // near-miss, because a `toBeNull` there would assert the opposite of the
    // truth.
    // The wrong SEAT's hand on this op's own noun phrase.
    "You may put an Energy attached to your Active Pokémon into your hand.",
  ] as const;

  it("refuses every one", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("leaves the OWN-hand family exactly where it was — a positive, not a null", () => {
    // The census separated "into their hand" (4 attacks — this row) from the
    // sentences that put a card in YOUR OWN hand, and Phione `sv06-055`/`-175`
    // "Beckon" is the attack member. It DERIVES, through a reader that predates
    // this slice, so a `toBeNull` here would assert the opposite of the truth —
    // and the claim that matters is that this slice did not disturb it.
    expect(
      deriveAttackEffect("Put a Supporter card from your discard pile into your hand."),
    ).not.toBeNull();
  });

  it("refuses a printed ZERO — the guard every sibling numeric arm carries", () => {
    // Unwrapped this would file a no-op. WRAPPED it is worse: it parks a real
    // decision whose YES leaves the identical board, which is exactly the prompt
    // the M1 no-choice rule exists to refuse.
    expect(deriveAttackEffect(TWO.replace(" 2 ", " 0 "))).toBeNull();
    expect(deriveAttackEffect(TWO_STAGE2.replace(" 2 Energy", " 0 Energy"))).toBeNull();
  });

  it("has no ceiling above zero — the op clamps against the board", () => {
    // Matching every other numeric arm of this reader: a short board gives up
    // everything it has ("do as much as you can"), so a large count is a legal
    // program rather than a malformed one.
    for (const n of [1, 3, 4, 9]) {
      const text = TWO.replace(" 2 ", ` ${n} `);
      expect(deriveAttackEffect(text), text).toEqual(wrapped(text, [put(n)]));
    }
  });

  it("is ANCHORED at both ends and CASE-COMMITTED", () => {
    for (const { text } of CLAUSES) {
      expect(deriveAttackEffect(`${text} Then, shuffle your deck.`), text).toBeNull();
      expect(deriveAttackEffect(`Your opponent's Active Pokémon is now Confused. ${text}`)).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase()), text).toBeNull();
      expect(deriveAttackEffect(text.toUpperCase()), text).toBeNull();
      expect(deriveAttackEffect(text.slice(0, -1)), text).toBeNull(); // no trailing period
    }
  });

  it("folds the apostrophe — a U+2019 re-ingest must not un-derive the row", () => {
    // The D136/D137 hardening every sibling on this noun phrase carries. The
    // assertion is EQUALITY with the straight form, not merely "non-null": the
    // curly variant must derive to the SAME program, note included — which is
    // the one thing a byte-pin on the catalog string cannot say.
    for (const { text, program } of CLAUSES) {
      const curly = text.replace("opponent's", "opponent’s");
      expect(curly, text).not.toBe(text);
      // The note is the MATCHED string, so the curly sentence's note is curly —
      // and that is the ONLY byte that may differ between the two programs.
      const straight = JSON.stringify(program);
      expect(JSON.stringify(deriveAttackEffect(curly)), curly).toBe(
        straight.replace(text, curly),
      );
    }
  });
});

// ── The demonstrator pool. Synthetic `fix-*` bodies declared HERE, not in
//    `testFixtures.ts` — D190/D199/D200's idiom: a fixture id naming a real
//    printing must appear in `catalogManifest.ts`, generated off a LOCAL sqlite
//    that holds none of these four sets. So `FIXTURE_POOL` is untouched and NO
//    `fix-*` demonstrator is owed on the non-attack pool (D287's terms: Pokémon
//    BODIES on a LOCAL `cardPool`). ──

/** Octillery `sv09-034` "Aqua Wash" — the printed row, with the second attack
    kept so "the derived program is on the attack the player declared" is
    checkable rather than assumed.

    ⚠️ EVERY COST IN THIS FILE IS FLATTENED TO {C}: the demonstrators need their
    attacks PAYABLE out of `fix-energy`, and the cost is the one field of the
    printed rows this slice does not read. Stated rather than silent, because a
    fixture that quietly diverges from a print is exactly what
    `catalogManifest.test.ts` exists to catch on the ids it can reach — and it
    cannot reach these (none of `sv05`/`sv08`/`sv08.5`/`sv09` is in the local
    catalog). Octillery's print is {W}; Slowking's is {W}{C}{C}; Tauros's is
    {C}{C}. */
const OCTILLERY: Card = battler("fix-aquawash", {
  hp: 110,
  attacks: [
    { name: "Aqua Wash", cost: ["Colorless"], damage: 20, effect: AN },
    { name: "Octo Beatdown", cost: ["Colorless", "Colorless", "Colorless"], damage: 90 },
  ],
});

/** Slowking `sv08.5-019` "Wash the Slate Clean" — the 2-Energy sentence, and the
    printing Unfezant `sv05-135` "Opposing Winds" shares byte for byte. */
const SLOWKING: Card = battler("fix-washslate", {
  hp: 120,
  attacks: [{ name: "Wash the Slate Clean", cost: ["Colorless"], damage: 70, effect: TWO }],
});

/** Paldean Tauros `sv08-039` "Upthrusting Horns" — the Stage 2 gate. */
const TAUROS: Card = battler("fix-upthrust", {
  hp: 130,
  attacks: [{ name: "Upthrusting Horns", cost: ["Colorless"], damage: 30, effect: TWO_STAGE2 }],
});

/** ⚠️ **THE ATTRIBUTION CONTROL IS IN THE DECK, NOT IN A COMMENT.** The same op,
    the same arm, the same filter, NO wrapper and NO `to` — D142's printed hammer
    twin. Every claim below about "the Energy went to the HAND" and "the player
    was ASKED" is paired with a board where the identical action asks nothing and
    sends the card to the PILE. Without it, a `to` that was silently ignored, or
    an `optional` that spliced unconditionally, would be invisible from inside
    this file: the Energy would still leave the Pokémon and the suite would still
    be green. */
const HAMMER_TWIN: Card = battler("fix-barewash", {
  hp: 110,
  attacks: [
    {
      name: "Bare Wash",
      cost: ["Colorless"],
      damage: 20,
      effect: "Discard an Energy from your opponent's Active Pokémon.",
    },
  ],
});

/** A Stage 2 DEFENDER, and its Basic twin. `stage` is the printed word the
    condition reads (D262: NOT a chain count — a VSTAR sits two evolutions deep
    and is not a Stage 2), so the pair differs in exactly that field plus the
    `evolveFrom` a real Stage 2 carries. */
const STAGE2_BODY: Card = battler("fix-stage2body", {
  hp: 200,
  stage: "Stage2",
  evolveFrom: "fix-stage1body",
});
const STAGE1_BODY: Card = battler("fix-stage1body", {
  hp: 200,
  stage: "Stage1",
  evolveFrom: "fix-basic-1",
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-aquawash": OCTILLERY,
  "fix-washslate": SLOWKING,
  "fix-upthrust": TAUROS,
  "fix-barewash": HAMMER_TWIN,
  "fix-stage2body": STAGE2_BODY,
  "fix-stage1body": STAGE1_BODY,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-aquawash": 4,
  "fix-washslate": 4,
  "fix-upthrust": 4,
  "fix-barewash": 4,
  "fix-stage2body": 4,
  "fix-stage1body": 4,
  "fix-bigbody": 8,
  "fix-basic-1": 4,
  "fix-special": 4,
  "fix-special-2": 4,
  "fix-energy": 16,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

/** P1 to move on turn 3 (past §4), `attackerId` Active over an empty Bench,
    `defenderId` opposite with `energy` attached in the order listed, and BOTH
    hands emptied into their decks — so every hand count in this file is exact
    rather than seed-dependent. */
function matchup(
  seed: number,
  attackerId: string,
  defenderId: string,
  energy: readonly (readonly [string, number])[],
): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = clearBench(setActiveFromDeck(state, "p1", attackerId), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", defenderId), "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 3);
  for (const [id, count] of energy) state = attachFromDeck(state, "p2", id, count);
  let next = state;
  for (const seat of ["p1", "p2"] as const) {
    const side = next.players[seat];
    next = {
      ...next,
      players: { ...next.players, [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
    };
  }
  return next;
}

/** ⚠️ **THE VICTIM'S ZONES ARE READ THROUGH THE WATCHED UIDS, NEVER THROUGH RAW
    LENGTHS.** Every resolve that ends the turn is followed by P2's own
    turn-start draw in the SAME batch, so a bare `hand.length` reports a decline
    as a one-card gain and every count in this file would be off by one for a
    reason that has nothing to do with the op. `watch` is the exact uid list the
    defender had attached before the attack; the three numbers are that list's
    fate. */
function fateOf(state: GameState, watch: readonly string[]) {
  const side = state.players.p2;
  const attached = new Set(side.active?.energy ?? []);
  const hand = new Set(side.hand);
  const discard = new Set(side.discard);
  return {
    attached: watch.filter((uid) => attached.has(uid)).length,
    inHand: watch.filter((uid) => hand.has(uid)).length,
    inDiscard: watch.filter((uid) => discard.has(uid)).length,
  };
}

/** The uids the defender has attached right now — the `watch` list above. */
function attachedUids(state: GameState): string[] {
  return [...(state.players.p2.active?.energy ?? [])];
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Declare the attack at `index` and return the result. */
function attack(state: GameState, index = 0) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function answerConfirm(state: GameState, yes: boolean) {
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
}

describe("§2 — the ask: a printed card parks a confirm carrying its own sentence", () => {
  it("Aqua Wash deals its damage FIRST, then asks", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: parked, events } = attack(state);

    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // The whole prompt: a kind and the printed sentence. No candidates — the
    // decision IS the content.
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: AN });
    // The CONTROLLER answers, not the victim. A build that copied
    // `opponentMayDraw`'s `decider` would put the printed "you" on the wrong
    // screen — and here the wrong screen belongs to the player being robbed.
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.answerer).toBeUndefined();
    // NOTHING has moved yet, on either side of the wrapper.
    expect(fateOf(parked, watch)).toEqual({ attached: 1, inHand: 0, inDiscard: 0 });
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).not.toContain("TURN_ENDED");
  });

  it("THE CONTROL: the hammer twin asks NOTHING and files the card in the PILE", () => {
    // Same op, same arm, same filter, no wrapper and no `to`. This is the whole
    // attribution argument for the file: everything §3 claims is a difference
    // is measured against this board.
    const state = matchup(11, "fix-barewash", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: done, events } = attack(state);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const row = find(events, "ENERGY_DISCARDED");
    expect(row?.seat).toBe("p2");
    expect(row?.to).toBeUndefined(); // THE PILE — the op's own name
    expect(fateOf(done, watch)).toEqual({ attached: 0, inHand: 0, inDiscard: 1 });
  });
});

describe("§3 — the answer: YES moves the card to the victim's HAND, NO moves nothing", () => {
  it("YES puts the Energy in the OPPONENT'S HAND and NOT in anybody's pile", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    const { state: done, events } = answerConfirm(parked, true);

    expect(fateOf(done, watch)).toEqual({ attached: 0, inHand: 1, inDiscard: 0 });
    // …and the ACTOR's own zones are untouched: the destination is a ZONE of the
    // VICTIM's seat, never a crossing (D295's finding, driven from the other arm).
    expect(done.players.p1.hand).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(0);
    const row = find(events, "ENERGY_DISCARDED");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    expect(row?.to).toBe("hand");
    expect(row?.uids).toHaveLength(1);
    // The attack epilogue ran: the turn ended behind the answer.
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("NO moves NOTHING — and still finishes the turn", () => {
    // The half that can be silently wrong. A build that spliced unconditionally
    // (or read the boolean backwards) passes every accept assertion above; and a
    // decline that dropped the queued epilogue would leave the game stuck on
    // P1's turn with the damage already dealt.
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    const { state: done, events } = answerConfirm(parked, false);

    expect(fateOf(done, watch)).toEqual({ attached: 1, inHand: 0, inDiscard: 0 });
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("TURN_ENDED");
    expect(done.turn).toBe(4);
    expect(done.phase.kind).toBe("turn:action");
    // The damage the attack already dealt stays dealt — declining the rider is
    // not declining the attack.
    expect(done.players.p2.active?.damage).toBe(20);
  });

  it("the log row names the VICTIM in the passive voice and says HAND", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const { state: parked } = attack(state);
    const { state: done, events } = answerConfirm(parked, true);
    const ctx: LogContext = { names: { p1: "Ash", p2: "Gary" }, state: done, elapsed: "+00:00" };
    const text = logFromEvents(events, ctx)
      .map((r) => (r.kind === "action" ? r.segments.map((seg) => seg.text).join("") : ""))
      .join("\n");
    // D295's passive voice, reached from the ATTACK channel for the first time:
    // the row is filed under the deck's OWNER and never credits the victim with
    // the action.
    expect(text).toContain("hand");
    expect(text).not.toContain("discard pile");
    expect(text).not.toContain("Gary put");
  });
});

describe("§4 — the COUNT: 'you may put 2' is a decline or a pair, never a single", () => {
  it("takes exactly 2 off a board holding more", () => {
    // Three DISTINCT Energy prints, so nothing collapses and the pick is a real
    // decision behind the confirm — two parks in sequence, which is the
    // sequencing the one-Energy rows cannot exercise.
    const state = matchup(
      29,
      "fix-washslate",
      "fix-bigbody",
      [
        ["fix-energy", 1],
        ["fix-special", 1],
        ["fix-special-2", 1],
      ],
    );
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: TWO });

    const { state: picking } = answerConfirm(parked, true);
    if (picking.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    const prompt = picking.phase.prompt;
    if (prompt.kind !== "discardEnergy") throw new Error("expected a discardEnergy prompt");
    // 🛑 THE SCOPE IS `total: 2`, NOT `upTo`. This is the assertion that
    // separates this build from the `{count:"any", cap:2}` one D295's blocker
    // would have led to: an `upTo` scope legalises a pick of ONE, and the card
    // does not print that answer.
    expect(prompt.scope).toEqual({ kind: "total", count: 2 });
    expect(prompt.discardable).toHaveLength(3);
    expect(prompt.note).toBe(
      "Put 2 Energy attached to your opponent's Active Pokémon into their hand.",
    );

    const uids = prompt.discardable.slice(0, 2).map((d) => d.uid);
    const { state: done, events } = mustApply(picking, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids },
    });
    expect(fateOf(done, watch)).toEqual({ attached: 1, inHand: 2, inDiscard: 0 });
    expect(find(events, "ENERGY_DISCARDED")?.to).toBe("hand");
  });

  it("REFUSES a pick of one where an `upTo` scope would allow it", () => {
    // The sharpest single assertion in the file. `{count:"any", cap:2}` derives
    // a park this board would accept a ONE-uid answer to; `total: 2` does not.
    const state = matchup(
      29,
      "fix-washslate",
      "fix-bigbody",
      [
        ["fix-energy", 1],
        ["fix-special", 1],
        ["fix-special-2", 1],
      ],
    );
    const { state: picking } = answerConfirm(attack(state).state, true);
    if (picking.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    const prompt = picking.phase.prompt;
    if (prompt.kind !== "discardEnergy") throw new Error("expected a discardEnergy prompt");
    const one = applyAction(picking, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [prompt.discardable[0]?.uid ?? ""] },
    });
    expect(one.ok).toBe(false);
    // …and the EMPTY answer is refused too: the decline lives on the wrapper,
    // and offering it twice is exactly what `optional`'s doc block forbids.
    const none = applyAction(picking, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [] },
    });
    expect(none.ok).toBe(false);
  });

  it("does as much as it CAN on a short board — one attached, one taken, no park", () => {
    // "A board holding fewer than N matching Energy gives up all of them" is the
    // op's own rule; behind the wrapper it means the player is asked WHETHER and
    // then nothing further, because there is no choice left.
    const state = matchup(29, "fix-washslate", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    const { state: done } = answerConfirm(parked, true);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(fateOf(done, watch)).toEqual({ attached: 0, inHand: 1, inDiscard: 0 });
  });

  it("KEEPS the interchangeable collapse — three identical Basic Energy ask NOTHING", () => {
    // 🛑 The behaviour `{count:"any"}` would have thrown away: that mode offers
    // every candidate DISTINCTLY (the count is what Hail Blade's damage reads),
    // so three identical {C} would park three rows that all mean the same thing.
    // The `total` scope collapses them to `count` representatives, so the pick
    // is forced and resolves inline — one question (whether), never two.
    const state = matchup(47, "fix-washslate", "fix-bigbody", [["fix-energy", 3]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    const { state: done } = answerConfirm(parked, true);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(fateOf(done, watch)).toEqual({ attached: 1, inHand: 2, inDiscard: 0 });
  });

  it("asks nothing at all when the defender holds NO Energy — but still asks WHETHER", () => {
    // The wrapper is in front of the whiff, not behind it: the op's empty
    // candidate set is a no-op, and the question was already asked. Stated
    // because it is the one UX wart of the outer-wrapper shape and it is
    // deliberate — the printed sentence puts the "may" first.
    const state = matchup(11, "fix-aquawash", "fix-bigbody", []);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    const { state: done, events } = answerConfirm(parked, true);
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(fateOf(done, [])).toEqual({ attached: 0, inHand: 0, inDiscard: 0 });
    expect(types(events)).toContain("TURN_ENDED");
  });
});

describe("§5 — the Stage 2 gate: the adjective is read BEFORE anybody is asked", () => {
  it("asks, and takes, against a Stage 2 defender", () => {
    const state = matchup(11, "fix-upthrust", "fix-stage2body", [["fix-energy", 2]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: TWO_STAGE2 });
    const { state: done } = answerConfirm(parked, true);
    expect(fateOf(done, watch)).toEqual({ attached: 0, inHand: 2, inDiscard: 0 });
  });

  it("🛑 asks NOTHING AT ALL against a Stage 1 defender — no confirm, no park", () => {
    // The gate sits OUTSIDE the wrapper on purpose: "Stage 2" is a board fact
    // settled before anybody is asked, so a build that gated INSIDE would park a
    // Yes/No whose YES is a guaranteed no-op on every board the adjective
    // excludes. A `stage`-blind condition passes the case above and fails here.
    const state = matchup(11, "fix-upthrust", "fix-stage1body", [["fix-energy", 2]]);
    const watch = attachedUids(state);
    const { state: done, events } = attack(state);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(fateOf(done, watch)).toEqual({ attached: 2, inHand: 0, inDiscard: 0 });
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("and nothing against a BASIC defender either", () => {
    const state = matchup(11, "fix-upthrust", "fix-bigbody", [["fix-energy", 2]]);
    const watch = attachedUids(state);
    const { state: done, events } = attack(state);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(fateOf(done, watch)).toEqual({ attached: 2, inHand: 0, inDiscard: 0 });
  });

  it("reads the PRINTED stage word, so the Stage 1 and Stage 2 bodies differ ONLY there", () => {
    // D262's reading, pinned on the fixtures themselves: the two demonstrators
    // are identical apart from `stage` and the name they evolve from, so the
    // §5 pair above cannot be passing for a reason other than the adjective.
    expect(STAGE2_BODY.stage).toBe("Stage2");
    expect(STAGE1_BODY.stage).toBe("Stage1");
    expect(STAGE2_BODY.hp).toBe(STAGE1_BODY.hp);
    expect(STAGE2_BODY.category).toBe(STAGE1_BODY.category);
    // Both are EVOLUTION Pokémon (`evolveFrom` non-null), which is the exact
    // reason `opponentActiveIsEvolution` could not be narrowed into this member.
    expect(STAGE2_BODY.evolveFrom).not.toBeNull();
    expect(STAGE1_BODY.evolveFrom).not.toBeNull();
  });
});

describe("§6 — the wire and the record", () => {
  it("the confirm prompt reaches the CONTROLLER alone, with the printed sentence", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const { state: parked } = attack(state);
    expect(redactGame(parked, "p1").phase).toMatchObject({
      kind: "effect:choose",
      prompt: { kind: "confirm", note: AN },
    });
    // Controller-answered, so the VICTIM's snapshot carries null — and here the
    // gate matters more than usual: the question is about the victim's own
    // Energy, and a dialog on their screen is one they cannot answer.
    const theirs = redactGame(parked, "p2").phase;
    if (theirs.kind !== "effect:choose") throw new Error("expected the park");
    expect(theirs.prompt).toBeNull();
  });

  it("MATCH_RECORD_VERSION STAYS 16 — driven both directions with a literal key anchor", () => {
    // A parked `optional` rides `phase.cont` into the record, and the inner op
    // now carries `to` (D295's field) and, for Tauros, a `cond` inhabitant that
    // did not exist last slice. Neither is a new SHAPE: an old record cannot
    // carry either and does not need to, because the ABSENCE already means what
    // the old record meant. DRIVEN rather than asserted — the parked op's key
    // list is the assertion.
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    const roundTrip = JSON.parse(JSON.stringify(parked)) as GameState;
    if (roundTrip.phase.kind !== "effect:choose") throw new Error("lost the phase");

    // FORWARD: the serialized park is byte-identical to the live one.
    expect(JSON.stringify(roundTrip.phase)).toBe(JSON.stringify(parked.phase));
    // THE ANCHOR: the exact keys the persisted op carries, listed literally, so
    // "every body grew a key" cannot hide inside a same-tree diff.
    const cont = roundTrip.phase.cont;
    const pending = (cont as { pendingOp?: unknown }).pendingOp as Record<string, unknown>;
    expect(Object.keys(pending).sort()).toEqual(["note", "op", "then"]);
    expect(pending.op).toBe("optional");
    const inner = (pending.then as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(inner).sort()).toEqual(["filter", "from", "op", "to"]);

    // BACKWARD: the rehydrated record answers, and reaches the same board the
    // live one does.
    const fromRecord = answerConfirm(deepFreeze(roundTrip), true).state;
    const live = answerConfirm(parked, true).state;
    const watch = attachedUids(parked);
    expect(fateOf(fromRecord, watch)).toEqual({ attached: 0, inHand: 1, inDiscard: 0 });
    expect(fateOf(fromRecord, watch)).toEqual(fateOf(live, watch));
  });

  it("🛑 the new BoardCondition member NEVER REACHES THE RECORD — the gate resolves first", () => {
    // The outer-gate shape's second consequence, and the one that decides the
    // version question: `conditionGate` is evaluated and spliced by `runProgram`
    // BEFORE anything parks, so the only op that persists is the `optional` the
    // gate let through. A new `BoardCondition` inhabitant therefore cannot even
    // appear in a `MatchRecord` from this row — which is a stronger statement
    // than "adding an inhabitant owes no bump", and it is measured rather than
    // argued.
    const state = matchup(11, "fix-upthrust", "fix-stage2body", [["fix-energy", 2]]);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    const serialized = JSON.stringify(parked.phase);
    expect(serialized).not.toContain("opponentActiveIsStage2");
    expect(serialized).not.toContain("conditionGate");
    const roundTrip = JSON.parse(serialized) as GameState["phase"];
    if (roundTrip.kind !== "effect:choose") throw new Error("lost the phase");
    const pending = (roundTrip.cont as { pendingOp?: unknown }).pendingOp as Record<
      string,
      unknown
    >;
    expect(Object.keys(pending).sort()).toEqual(["note", "op", "then"]);
    const inner = (pending.then as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(inner).sort()).toEqual(["count", "filter", "from", "op", "to"]);
    expect(inner.count).toBe(2);
  });
});

describe("§7 — the version", () => {
  it("moved PAST 0.206.0 with the new BoardCondition member, and the two files agree", () => {
    // A new `BoardCondition` inhabitant and a new deriver anchor are both
    // behaviour a card can reach, so the engine version moves. The manifest and
    // the exported constant are asserted TOGETHER — the tie is the assertion,
    // and either drifting alone is the defect.
    // 🆕 D297 moved it again (0.207.0 → 0.208.0), so this suite now asserts the
    // TIE and the DIRECTION rather than re-stating a literal that belongs to
    // whichever slice bumped it last. `tonguePull.test.ts` carries the literal —
    // the same hand-off D296 made to this file.
    expect(manifest.version).toBe(engineVersion);
    expect(manifest.version).not.toBe("0.206.0");
    expect(manifest.version).not.toBe("0.207.0");
  });
});
