import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  LEFTOVERS_DESTINATION_DECK,
  benchFromDeck,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  toDeckTop,
  trimDeckTo,
} from "./testFixtures";

// D335 — THE LEFTOVERS **DESTINATION**: DRAKLOAK `sv06-129`/`sv08.5-072` "RECON
// DIRECTIVE" AND RIKA `sv04-172`/`-241`/`-258`.
//
// ── THE TWO PRINTED SENTENCES ───────────────────────────────────────────────
//   Drakloak (Ability, on `abilities_json`, 205 chars, 2 Standard-legal printings):
//     "Once during your turn, you may look at the top 2 cards of your deck and put
//      1 of them into your hand. **Put the other card on the bottom of your deck.**"
//   Rika (Supporter, on `effect`, 135 chars, 3 printings, ALL out of Standard):
//     "Look at the top 4 cards of your deck and put 2 of them into your hand.
//      **Shuffle the other cards and put them on the bottom of your deck.**"
//
// D334 shipped the mandatory TAKE (`lookAtTopN.exact`) and left both of these on
// the resume point blocked on a leftovers DESTINATION. This is that destination,
// and it is an AXIS rather than a flag: `restTo?: "discard" | "bottom" |
// "shuffledBottom"`, the D334 boolean RENAMED and widened.
//
// ── THE CENSUS, AT SEVERAL WIDTHS, WORD ORDERS AND CASES, OVER ALL THREE TEXT
//    COLUMNS (remote D1 `luminous`, 3,786 rows / 2,021 `legal_standard`,
//    2026-08-14, re-run at THIS head rather than inherited) ────────────────────
//
//   (a) `instr(<col>,'on the bottom of your deck') > 0` — the widest useful probe:
//         `effect` **12 / 4**, `abilities_json` **8 / 5**, `attacks_json` **1 / 0**
//       — 21 rows / 9 legal in total, and MOST of them are a different op: Dendra
//       ×3 and Kofu ×2 pay from the HAND (`payFromHand to:"deckBottom"`), Skwovet
//       ×3 and Quaquaval move a whole hand, Redeemable Ticket moves PRIZES.
//
//   (b) `instr(<col>,'the other card on the bottom') > 0` — the `"bottom"` clause:
//         `effect` **0**, `abilities_json` **3 / 2**, `attacks_json` **0**.
//       The 3 are Drakloak ×2 (legal, THIS row) and Gothitelle `sv02-092` (0 legal),
//       whose sentence reads *"look at the top 2 cards of your **opponent's** deck
//       and put 1 of them **back**. Put the other card on the bottom of **their**
//       deck."* — a second seat's deck AND a put-back rather than a take, which is
//       census row 11's own residue and not this op.
//       ⚠️ **THE INHERITED PRICE SAID "2 legal" AND THE QUERY SAYS 3 ROWS / 2 LEGAL.**
//       The legal count held; the ROW count did not, and the extra row is the one
//       that would buy `DECK_TOP_REVEALED` the `actor` its doc says it lacks.
//
//   (c) `instr(<col>,'Shuffle the other cards and put') > 0` — the
//       `"shuffledBottom"` clause:
//         `effect` **3 / 0**, `abilities_json` **2 / 2**, `attacks_json` **0**.
//       🛑 **AND THIS IS WHERE THE INHERITED PRICE IS FALSE, FOR THE SIXTH SLICE
//       RUNNING.** The resume point named Rika (3 printings, 0 legal) as this
//       value's whole population. The `abilities_json` half is **Metang "Metal
//       Maker" `sv05-114`/`svp-090`, 2 STANDARD-LEGAL printings** — *"…look at the
//       top 4 cards of your deck and attach any number of Basic {M} Energy cards you
//       find there to your Pokémon in any way you like. **Shuffle the other cards
//       and put them on the bottom of your deck.**"* — the identical clause on
//       `attachFromTop`. So the value has MORE legal printings on the op this slice
//       does NOT touch than on the one it does, and those two ids have sat in census
//       row 11's `abilityIds` since D241 under the assumption that the ATTACH was
//       what blocked them. It never was. (Widening `attachFromTop` is left to the
//       slice that authors Metang — D331's rule against shipping a union value no
//       authored row reaches.)
//
//   (d) THE NEGATIVE PROBES, which is what turns a count into a closed population:
//         `the rest on the bottom` — **0** on all three columns;
//         `beneath your deck` — **0**;
//         `bottom of the deck` (the impersonal article) — **0**;
//         `the other cards on the bottom` over `effect` — **0** (Rika's own noun
//           phrase is split by the verb, which is why probe (c) is the one that
//           finds it and a naive widening of (b) does not);
//         lower-case `shuffle the other` — 3 rows / 2 legal, and every one of them
//           is *"shuffle the other cards **back into your deck**"* inside an ATTACK
//           (Kingdra, Iron Thorns ×2) — a whole-deck shuffle, not this clause.
//
//   (e) THE SPLIT, RE-ADDED: the leftovers-destination family is `"bottom"` 2
//       printings / 2 legal + `"shuffledBottom"` 5 printings / 2 legal = **7
//       printings / 4 legal**, of which this slice authors **5 printings / 2 legal**
//       (Drakloak ×2 legal, Rika ×3 not) and leaves Metang's 2 legal to the op next
//       door. `2 + 5 = 7 ✅`, `2 + 2 = 4 ✅`, `5 + 2 = 7 ✅`. D187's rule: an arm
//       transfers across sets and a registry row does not.
//
// ── WHAT THE ORDERED GREP RETURNED, AND WHY THERE IS NO NEW EVENT ───────────
// `CARD_TO_BOTTOM_OF_DECK` has exactly ONE producer (`bottomFromOpponentHand`) and
// ONE renderer arm (`log.ts`), and its doc names its uid because *"the whole move
// happened face up: the hand was just revealed"*. It is SINGULAR, it is
// HAND-sourced, and it carries an `actor` because the OTHER player chose the card.
// All three refuse a deck-top leftover. **And the sentence that refuses it is the
// argument for the answer**, which is D334's finding one field over:
// `DECK_TOP_DISCARDED`'s qualifying test is *"LEFT THE DECK WITHOUT ANYONE DECIDING
// ABOUT IT"*, and a card put UNDER the deck never left it — so neither new value
// produces that row either. `SHUFFLE` is refused too: it claims the DECK was
// shuffled, where `"shuffledBottom"` randomizes a two-to-four-card tail, and Iono's
// `handRefresh.toBottom` is the in-repo precedent for that distinction.
// **ZERO new events, ZERO renderer arms, ZERO log arms — and the two values are
// told apart by the BOARD and by `rngState`, which is what this file drives.**

function types(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const deckAt = (state: GameState, index: number): string => {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`no card at deck index ${index}`);
  return uid;
};

const cardIdOf = (state: GameState, uid: string): string | undefined => state.cardIdByUid[uid];

/** Every uid p1 holds anywhere, sorted — the card-conservation census. A play may
    move cards between zones but must never create or destroy one. */
function census(state: GameState): string[] {
  const side = state.players.p1;
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards")
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  return state.phase.prompt;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so an Ability and a Supporter are both playable. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: LEFTOVERS_DESTINATION_DECK, p2: LEFTOVERS_DESTINATION_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Drakloak on the BENCH (the Ability is not Active-only), a plain Colorless
    Active, and a seeded top 2 of two DIFFERENT card classes — an Item over an
    Energy, so the taken card and the bottomed card are told apart by card id and
    not only by uid. */
function reconBoard(seed: number): GameState {
  let state = board(seed);
  state = setActiveFromDeck(state, "p1", "fix-basic-1");
  // Rebuild the bench outright: `useAbility` names a bench INDEX, so a suite that
  // let the setup deal whatever Basic it drew would target a different Pokémon per
  // seed (`attachFromTop.test.ts`'s `withBoard` states this rule).
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  state = benchFromDeck(state, "p1", "fix-drakloak");
  // Prepending composes, so seed the DEEPER card first.
  state = toDeckTop(state, "p1", "fix-energy", 1);
  state = toDeckTop(state, "p1", "fix-item", 1);
  return state;
}

const reconDirective = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Recon Directive",
} as const;

/** Rika in hand, and a seeded top 4 of FOUR card classes — an Item, a Supporter,
    a Pokémon and an Energy, in that order from the top. `anyCard` admits all
    four, so a narrowed filter loses rows on three of them. */
function rikaBoard(seed: number): GameState {
  let state = board(seed);
  state = handFromDeck(state, "p1", "fix-rika", 1);
  state = toDeckTop(state, "p1", "fix-energy", 1);
  state = toDeckTop(state, "p1", "fix-basic-1", 1);
  state = toDeckTop(state, "p1", "sv01-189", 1);
  state = toDeckTop(state, "p1", "fix-item", 1);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE REGISTRY ROWS, READ BEFORE ANY BOARD RUNS
// ─────────────────────────────────────────────────────────────────────────────

describe("D335 §1 — the two programs, and the axis they consume", () => {
  it("every printing resolves, reprints share ONE object, and the two cards do NOT", () => {
    // 🛑 D330's finding kept as a standing check: a union value can be wired at
    // every site, type-check everywhere and have ZERO printed consumers. These six
    // keys are what stop `restTo`'s two new values from being that.
    for (const id of ["sv06-129", "sv08.5-072", "sv04-172", "sv04-241", "sv04-258", "fix-drakloak", "fix-rika"]) {
      expect(programFor(id), id).toBeDefined();
    }
    expect(programFor("sv08.5-072")).toBe(programFor("sv06-129"));
    expect(programFor("fix-drakloak")).toBe(programFor("sv06-129"));
    expect(programFor("sv04-241")).toBe(programFor("sv04-172"));
    expect(programFor("sv04-258")).toBe(programFor("sv04-172"));
    expect(programFor("fix-rika")).toBe(programFor("sv04-172"));
    // D199's near-twin rule: three printed sentences, three objects. Each of these
    // was written by reading the one before it, and sharing would make a later edit
    // to one card silently move another that never printed the same words.
    expect(programFor("sv04-172")).not.toBe(programFor("sv06-129"));
    expect(programFor("sv06-129")).not.toBe(programFor("sv05-147"));
    expect(programFor("sv04-172")).not.toBe(programFor("sv05-147"));
  });

  it("both are Explorer's Guidance's op with the DESTINATION moved — read off the registry", () => {
    // The attribution control, before any board runs: naming every field that
    // differs from the row these were modelled on is what makes each board below
    // attributable to one field rather than to "the two cards are different".
    const drakloak = programFor("sv06-129")?.abilities?.[0];
    const rika = programFor("sv04-172")?.trainer?.[0];
    const eg = programFor("sv05-147")?.trainer?.[0];
    if (drakloak === undefined) throw new Error("expected an ability program");
    const recon = drakloak.program[0];
    if (recon?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (rika?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (eg?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");

    // Drakloak — the printed first clause is the ABILITY's, not the op's.
    expect(drakloak.name).toBe("Recon Directive");
    expect(drakloak.oncePerTurn).toBe(true);
    expect(drakloak.activeOnly).toBe(false);
    expect(recon.n).toBe(2);
    expect(recon.filter).toEqual({ kind: "anyCard" });
    expect(recon.max).toBe(1);
    expect(recon.exact).toBe(true);
    expect(recon.restTo).toBe("bottom");
    expect(recon.reveal).toBeUndefined();
    expect(recon.also).toBeUndefined();
    expect(recon.dest).toBeUndefined();

    // Rika — the same op, a wider window, a bigger take, the third destination.
    expect(rika.n).toBe(4);
    expect(rika.filter).toEqual({ kind: "anyCard" });
    expect(rika.max).toBe(2);
    expect(rika.exact).toBe(true);
    expect(rika.restTo).toBe("shuffledBottom");
    expect(rika.reveal).toBeUndefined();
    expect(rika.also).toBeUndefined();
    expect(rika.dest).toBeUndefined();

    // …and the row they were both modelled on differs in exactly ONE field.
    expect(eg.exact).toBe(true);
    expect(eg.restTo).toBe("discard");
    expect(eg.n).toBe(6);
  });

  it("🛑 NEITHER carries a trailing `shuffleDeck`, and the absence is PRINTED on both", () => {
    // 🛑 THE MUTANT THIS KILLS IS THE COPY AN AUTHOR WOULD ACTUALLY MAKE. Great
    // Ball, Pokégear, Hassel, Roto-Stick, Drayton and Bug Catching Set all end
    // "Shuffle the other cards back into your deck" and all carry the trailing op.
    // Neither of these sentences can be spelled that way: Drakloak prints no
    // shuffle at all, and Rika's shuffle reaches the WINDOW and not the deck — a
    // trailing `shuffleDeck` would scramble the 56 cards underneath as well, which
    // is a materially different card.
    expect(programFor("sv06-129")?.abilities?.[0]?.program).toHaveLength(1);
    expect(programFor("sv04-172")?.trainer).toHaveLength(1);
    // The control: the op with the sibling clause DOES carry it.
    expect(programFor("sv02-183")?.trainer?.map((op) => op.op)).toEqual([
      "lookAtTopN",
      "shuffleDeck",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — DRAKLOAK: `restTo: "bottom"`, THE DETERMINISTIC DESTINATION
// ─────────────────────────────────────────────────────────────────────────────

describe("D335 §2 — Recon Directive puts the other card UNDER the deck", () => {
  it("parks on the top 2 with a floor of ONE — the printed take, not a ceiling", () => {
    const state = reconBoard(1);
    const top = [deckAt(state, 0), deckAt(state, 1)];
    const { state: parked } = mustApply(state, reconDirective);
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toEqual(top);
    expect(prompt.dest).toBe("hand");
    // `exact` — the printed "put 1 of them", with no "up to" and no second "you may".
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
  });

  it("🛑 `exact` is INVISIBLE in this caption and visible ONLY in `min`", () => {
    // 🆕 THE CASE D334's ROW COULD NOT DRIVE. `lookNote`'s exactness arm strips the
    // words "up to", and those words only ever appear when `max > 1`; at `max: 1`
    // the caption is the SINGULAR either way. So on THIS row the whole observable
    // difference between `exact` and its absence is `prompt.min` — which makes it
    // the one board in the repo where deleting the flag leaves every string
    // identical and changes what answers are legal. Both halves are asserted here
    // so neither can rot into the other.
    const { state: parked } = mustApply(reconBoard(2), reconDirective);
    const prompt = cardsPrompt(parked);
    expect(prompt.note).toBe("Look at the top 2 cards of your deck and put a card into your hand.");
    expect(prompt.note).not.toContain("up to");
    expect(prompt.min).toBe(1);
  });

  it("🛑 the printed 'you may' is the ABILITY's decline — the TAKE inside it is not", () => {
    // The `exact` + optional interaction nothing in the suite had exercised. A
    // player may leave Recon Directive unused all turn; a player who USES it does
    // not get to look at two cards and take neither.
    const { state: parked } = mustApply(reconBoard(3), reconDirective);
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("the taken card reaches the hand and the OTHER one is at the very bottom", () => {
    const state = reconBoard(4);
    const taken = deckAt(state, 0);
    const leftover = deckAt(state, 1);
    const tail = state.players.p1.deck.slice(2);
    const before = census(state);

    const { state: done } = mustApply(
      mustApply(state, reconDirective).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [taken] } },
    );
    expect(done.players.p1.hand).toContain(taken);
    // THE WHOLE POINT: the leftover is under EVERYTHING, and everything else kept
    // its order. Read as `at(-1)` and as the full sequence, because "the leftover
    // is somewhere in the deck" would pass on a shuffle.
    expect(done.players.p1.deck.at(-1)).toBe(leftover);
    expect(done.players.p1.deck).toEqual([...tail, leftover]);
    // It did NOT leave the deck: the pile is untouched (an Ability discards
    // nothing of its own, unlike the Supporter in §3).
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
    expect(census(done)).toEqual(before);
  });

  it("🛑 NO event says so — not DECK_TOP_DISCARDED, not CARD_TO_BOTTOM_OF_DECK, not SHUFFLE", () => {
    // The whole event finding, driven. The look IS announced (`DECK_TOP_REVEALED`
    // names only the TAKEN card, since the leftover was never public); the bottoming
    // is not, because nothing changed zone and nothing was randomized.
    const state = reconBoard(5);
    const taken = deckAt(state, 0);
    const { state: parked, events: parkEvents } = mustApply(state, reconDirective);
    const { events } = mustApply(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [taken] } });
    const all = [...parkEvents, ...events];
    expect(find(all, "DECK_TOP_REVEALED")?.uids).toEqual([taken]);
    expect(types(all)).not.toContain("DECK_TOP_DISCARDED");
    expect(types(all)).not.toContain("CARD_TO_BOTTOM_OF_DECK");
    expect(types(all)).not.toContain("SHUFFLE");
  });

  it("🛑 and `rngState` is UNTOUCHED — the difference from Rika is not cosmetic", () => {
    const state = reconBoard(6);
    const taken = deckAt(state, 0);
    const { state: done } = mustApply(
      mustApply(state, reconDirective).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [taken] } },
    );
    expect(done.rngState).toBe(state.rngState);
  });

  it("is once per turn, and works from the BENCH (activeOnly: false)", () => {
    const state = reconBoard(7);
    const taken = deckAt(state, 0);
    const { state: done } = mustApply(
      mustApply(state, reconDirective).state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [taken] } },
    );
    // It ran at all, from bench index 0 — the `activeOnly: false` half.
    expect(done.players.p1.hand).toContain(taken);
    expectErr(done, reconDirective, "ABILITY_ALREADY_USED");
  });

  it("a ONE-card deck takes the card and has no leftover to bottom", () => {
    // The short-window path. `exact`'s floor is clamped to the candidate count, so
    // a printed take of 1 against a window of 1 is answerable; `rest` is empty, so
    // the bottoming branch is a no-op and the deck ends EMPTY rather than holding a
    // card it also put in the hand.
    let state = reconBoard(8);
    state = trimDeckTo(state, "p1", 1);
    const only = deckAt(state, 0);
    const { state: parked } = mustApply(state, reconDirective);
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toEqual([only]);
    expect(prompt.min).toBe(1);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [only] },
    });
    expect(done.players.p1.deck).toEqual([]);
    expect(done.players.p1.hand).toContain(only);
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
  });

  it("an EMPTY deck announces nothing at all — nobody looked", () => {
    let state = reconBoard(9);
    state = trimDeckTo(state, "p1", 0);
    const { state: done, events } = mustApply(state, reconDirective);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("DECK_TOP_REVEALED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — RIKA: `restTo: "shuffledBottom"`, THE SECOND PRINTED DECISION
// ─────────────────────────────────────────────────────────────────────────────

describe("D335 §3 — Rika shuffles the other cards and puts them under the deck", () => {
  it("parks on the top 4 with a floor of TWO, and the caption drops the 'up to'", () => {
    const state = rikaBoard(11);
    const top = state.players.p1.deck.slice(0, 4);
    const uid = handUid(state, "p1", "fix-rika");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toEqual(top);
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    // D334's caption arm, on a second consumer: `max > 1` and `exact`, so the words
    // "up to" are gone and the number stays.
    expect(prompt.note).toBe("Look at the top 4 cards of your deck and put 2 cards into your hand.");
    // The window really did hold four different card classes, so `anyCard` is
    // attributable — a narrowed filter would lose three of these rows.
    expect(top.map((u) => cardIdOf(parked, u))).toEqual([
      "fix-item",
      "sv01-189",
      "fix-basic-1",
      "fix-energy",
    ]);
  });

  it("the two taken cards reach the hand and the other two sit UNDER the deck", () => {
    const state = rikaBoard(12);
    const window = state.players.p1.deck.slice(0, 4);
    const [takenA, , , takenD] = window as [string, string, string, string];
    const leftovers = [window[1], window[2]] as string[];
    const tail = state.players.p1.deck.slice(4);
    const uid = handUid(state, "p1", "fix-rika");
    const before = census(state);

    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [takenA, takenD] },
    });
    expect(done.players.p1.hand).toContain(takenA);
    expect(done.players.p1.hand).toContain(takenD);
    // The leftovers are UNDER everything, as a SET — their order among themselves
    // is the shuffle's business and is asserted separately below.
    expect(done.players.p1.deck.slice(-2).sort()).toEqual([...leftovers].sort());
    // 🛑 AND THE 56 CARDS UNDERNEATH KEPT THEIR EXACT ORDER, which is the whole
    // difference between this card and a trailing `shuffleDeck`.
    expect(done.players.p1.deck.slice(0, tail.length)).toEqual(tail);
    expect(census(done)).toEqual(before);
  });

  it("🛑 `rngState` ADVANCES — the printed 'Shuffle' is spent, not decorative", () => {
    const state = rikaBoard(13);
    const window = state.players.p1.deck.slice(0, 4);
    const uid = handUid(state, "p1", "fix-rika");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [window[0] as string, window[1] as string] },
    });
    expect(done.rngState).not.toBe(parked.rngState);
  });

  it("🛑 and the shuffle REORDERS: across seeds the bottom pair comes out both ways", () => {
    // The assertion a single seed cannot make. A two-card shuffle is the identity
    // half the time, so "the leftovers were randomized" is only observable as a
    // DISTRIBUTION — and a build that dropped the `shuffle` call would produce the
    // window's order on every seed. Both orders must appear.
    const orders = new Set<string>();
    for (let seed = 20; seed < 40; seed++) {
      const state = rikaBoard(seed);
      const window = state.players.p1.deck.slice(0, 4);
      const uid = handUid(state, "p1", "fix-rika");
      const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      const { state: done } = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [window[0] as string, window[1] as string] },
      });
      const bottom = done.players.p1.deck.slice(-2);
      orders.add(bottom[0] === window[2] ? "window" : "swapped");
    }
    expect([...orders].sort()).toEqual(["swapped", "window"]);
  });

  it("🛑 NO event says so either — and the ONLY discard is Rika paying for itself", () => {
    const state = rikaBoard(14);
    const window = state.players.p1.deck.slice(0, 4);
    const uid = handUid(state, "p1", "fix-rika");
    const { state: parked, events: parkEvents } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid,
    });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [window[0] as string, window[1] as string] },
    });
    const all = [...parkEvents, ...events];
    expect(types(all)).not.toContain("DECK_TOP_DISCARDED");
    expect(types(all)).not.toContain("CARD_TO_BOTTOM_OF_DECK");
    expect(types(all)).not.toContain("SHUFFLE");
    // ⚠️ THE PILE DELTA IS MEASURED OFF THE PARKED STATE, NOT THE SEEDED ONE —
    // playing a Supporter discards it, so the pile has already gained the card that
    // is asking the question. What matters is that the leftovers did NOT join it.
    expect(done.players.p1.discard).toEqual(parked.players.p1.discard);
    expect(done.players.p1.discard).toContain(uid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE THIRD VALUE, ON THE SAME BOARD (the attribution controls)
// ─────────────────────────────────────────────────────────────────────────────

describe("D335 §4 — the three destinations are three different games", () => {
  it("Explorer's Guidance on this very deck DISCARDS its leftovers instead", () => {
    // The same op, the same `exact`, one field different — and the leftovers leave
    // the deck, ride `DECK_TOP_DISCARDED` and land in the pile. Without this row,
    // "the leftovers went to the bottom" and "the leftovers went somewhere" are the
    // same observation.
    let state = board(15);
    state = handFromDeck(state, "p1", "fix-explorersguidance", 1);
    const window = state.players.p1.deck.slice(0, 6);
    const uid = handUid(state, "p1", "fix-explorersguidance");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [window[0] as string, window[1] as string] },
    });
    const rest = window.slice(2);
    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toEqual(rest);
    for (const leftover of rest) {
      expect(done.players.p1.discard).toContain(leftover);
      expect(done.players.p1.deck).not.toContain(leftover);
    }
  });

  it("Great Ball on this very deck SHUFFLES — the other way a tail can move", () => {
    // The second control, and it is the one that matters for `"bottom"`: a card
    // whose leftovers clause is the trailing `shuffleDeck` reorders the WHOLE deck,
    // so a build that spelled Drakloak's bottoming as a shuffle would look like
    // this instead.
    let state = board(16);
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    const uid = handUid(state, "p1", "sv02-183");
    const { state: parked, events: parkEvents } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid,
    });
    // Great Ball's `max: 1` over `anyPokemon` PARKS (the deck is full of them), so
    // the trailing shuffle only fires on the resolve — the shuffle is the second
    // op of the program and not part of the look.
    const pick = cardsPrompt(parked).candidates[0] as string;
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(types(parkEvents)).not.toContain("SHUFFLE");
    expect(types(events)).toContain("SHUFFLE");
  });
});
