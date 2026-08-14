import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  DRAYTON_WINDOW_DECK,
  FIXTURE_POOL,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
} from "./testFixtures";

// D332 — DRAYTON `sv08-174`/`-232`/`-244`/`sv08.5-172`, THE DOUBLE-FILTER
// WINDOW, AND THE HALF OF ITS OWN PRICE THAT WAS FALSE.
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Look at the top 7 cards of your deck. You may reveal **a Pokémon and a
//    Trainer card** you find there and put them into your hand. Shuffle the
//    other cards back into your deck."
//   Supporter, **4 Standard-legal printings and they are the whole population.**
//
// ── THE CENSUS, AT THREE WIDTHS AND OVER ALL THREE TEXT COLUMNS ─────────────
// Re-run against the remote D1 `luminous` at THIS head (2026-08-14) rather than
// inherited, and every per-column split is re-added against its own total,
// because a split that does not sum is the cheapest census check there is.
//
//   (a) `instr(<col>,'a Pokémon and a Trainer card') > 0` — the CONJUNCTION:
//         `effect`         4 rows / 4 legal — the four Drayton, only.
//         `attacks_json`   0 rows / 0 legal.
//         `abilities_json` 0 rows / 0 legal.
//       TOTAL 4 rows / 4 legal.  4 + 0 + 0 = 4 ✅   4 + 0 + 0 = 4 ✅
//       The REVERSED word order, `'a Trainer card and a Pokémon'`, returns
//       **0 rows over all three columns** — so the population is closed under
//       word order too, not merely under the one literal that was convenient.
//
//   (b) `instr(<col>,'Look at the top') > 0` — the OP, widened off the
//       conjunction so a different noun pair cannot hide behind it:
//         `effect`         25 rows / 14 legal
//         `attacks_json`   23 rows / 15 legal
//         `abilities_json`  0 rows /  0 legal
//       TOTAL 48 rows / 29 legal. 25 + 23 + 0 = 48 ✅  14 + 15 + 0 = 29 ✅
//       Of those 29 legal, Drayton's 4 are the ONLY ones taking a bounded number
//       of each of TWO kinds. The near misses are worth naming because they are
//       what the arity was measured against: Bug Catching Set `sv06-143`/
//       `sv08.5-102` (2 legal) prints *"up to 2 in any combination of {G}
//       Pokémon and Basic {G} Energy cards"* — a UNION under ONE shared cap,
//       which is `anyOf` with a flat `max: 2` and needs nothing from this slice —
//       and Roto-Stick `sv08.5-127` (1 legal) prints *"any number of Supporter
//       cards"*, which is an unbounded `max` and also not this.
//
//   (c) `instr(<col>,', and a ') > 0` — the THREE-AND-FOUR-noun form, i.e. the
//       arity this slice deliberately does NOT ship:
//         `effect`          3 rows / 3 legal — Larry's Skill `sv08.5-115`/`-139`
//                           (*"a Pokémon, a Supporter card, and a Basic Energy
//                           card"*, 2 legal) and Secret Box `sv06-163` (FOUR
//                           nouns, 1 legal).
//         `attacks_json`    0 rows / 0 legal.
//         `abilities_json`  0 rows / 0 legal.
//       TOTAL 3 rows / 3 legal.  3 + 0 + 0 = 3 ✅   2 + 1 = 3 ✅
//
// 🛑 **SO ARITY TWO IS A MEASUREMENT AND NOT A CONVENIENCE.** Every `lookAtTopN`
//    printing in the pool takes either ONE kind or exactly TWO; the three- and
//    four-noun sentences all sit on `searchDeck`, a different op with a different
//    park. `also` is therefore a single pair rather than a list — D331's rule
//    against shipping a value no printing spells — while the PROMPT half
//    (`chooseCards.caps`) is a list, so the `searchDeck` slice that eventually
//    takes Larry's Skill and Secret Box buys only its own op field.
//
// ── WHAT THE `DROPPED` ROW PRICED, AND THE CLAUSE THAT WAS FALSE ────────────
// The row read: *"TWO filters on one `lookAtTopN` window. The op takes one
// `filter` and one `max`; this sentence takes one of each of two kinds out of a
// SHARED window, which two sequential ops cannot express … **One op field or a
// second `max`.**"*
//
// ✅ **THE FIRST CLAUSE IS TRUE, AND READING THE PARK MAKES IT SHARPER THAN THE
//    ROW DID.** The window is `deck.slice(0, op.n)` recomputed at every op, so a
//    second `lookAtTopN` sees a deck the first one has already taken from: the
//    card at index `n` slides INTO the window and becomes takeable though nobody
//    looked at it. The obvious repair — a second op at `n - 1` — is right on the
//    take-one path and WRONG on the decline, which this printed "you may"
//    permits: take no Pokémon and index 6 is unreachable for the Trainer.
//
// 🛑 **"ONE OP FIELD OR A SECOND `max`" IS THE FALSE HALF, AND IT IS FALSE IN
//    EXACTLY THE CLAUSE THAT MADE THE ROW CHEAP.** `lookAtTopN.max` is forwarded
//    straight into `prompt.max`, and `validateChoice` (cardplay.ts) enforces ONE
//    FLAT TOTAL shared by all six `chooseCards` producers. A second `max` on the
//    OP is therefore invisible to the only thing that checks a wire answer: under
//    a total of 2 a client takes TWO Pokémon and the printed conjunction is gone.
//    The cap had to reach the PROMPT, and the prompt has a wire tail.
//
// 🛑 **AND THE PIECE THE ROW TREATED AS THE OBSTACLE WAS FREE ALL ALONG.**
//    `{ kind: "anyOf" }` has been in `CardFilter` since D245 and produces exactly
//    this candidate set. It is not used here because it captions a DISJUNCTION —
//    `retrieveNoun`'s `anyOf` arm joins its members with **" or "**, deliberately,
//    because a union asked about one card reads that way — while Drayton prints a
//    conjunction of two SEPARATELY CAPPED nouns, which no single filter expresses
//    whatever its caption says. That conclusion is unchanged.
//
// ⚠️ **CORRECTED AT D333: THIS PARAGRAPH ALSO CALLED THAT ARM "UNREACHABLE FROM
//    ANY PROMPT", AND IT WAS NOT — IT HAD BEEN LIVE SINCE D264.** Lana's Aid
//    `sv06-155`/`-207`/`-219` parks a `chooseCards` whose note IS that arm's
//    output, asserted byte for byte in `legalNonAttackPrograms.test.ts` under a
//    case literally named *"the `anyOf` arm's first witness"*. This file inherited
//    the claim from a stale comment in `interpreter.ts` that D264 never moved, and
//    then passed it forward into the resume point, which sent D333 to build Bug
//    Catching Set as *"`anyOf`'s first live prompt consumer"* — its THIRD.
//    **A STALE COMMENT PROPAGATES FURTHER THAN A STALE NUMBER, BECAUSE NOTHING CAN
//    GO RED ON IT**, and the check that would have caught it is the one this repo
//    already runs on every count: ask which query, or which line, produced the
//    claim you are about to repeat.
//
// 🆕 **THE LESSON: THE PRICE NAMED THE RIGHT OP AND THE WRONG PIECE OF IT.**
//    D331's row named the right piece and the wrong READER. This one names the
//    right op, the right window and the wrong HALF: it priced the candidate set
//    (already free) and not the cap (which crosses a validator with six
//    producers). **A `needs` STRING CAN BE RIGHT ABOUT WHAT IS HARD AND WRONG
//    ABOUT WHICH PART OF IT IS HARD** — and the way to tell is to read the thing
//    that CHECKS the answer, not the thing that OFFERS it.

const DRAYTON_IDS = ["sv08-174", "sv08-232", "sv08-244", "sv08.5-172"] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The uid of the deck card at `index` (0 = top) in p1's deck. */
function deckAt(state: GameState, index: number): string {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`p1 deck has no card at index ${index}`);
  return uid;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so a Supporter is legal (§7.2). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DRAYTON_WINDOW_DECK, p2: DRAYTON_WINDOW_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** A seeded top 7: **two** Pokémon, **two** Trainers and three cards that are
    neither, with a Pokémon and a Trainer buried at indices 7 and 8 so the window
    boundary is observable from both filters at once.

    🛑 THE SECOND OF EACH KIND IS THE WHOLE POINT. A window holding one Pokémon
    and one Trainer is admitted in full by the flat `max` of 2, so every
    assertion in this file would pass with `caps` deleted. */
function seeded(state: GameState): GameState {
  let next = state;
  next = toDeckTop(next, "p1", "fix-basic-2", 1); // index 8 — a Pokémon PAST the window
  next = toDeckTop(next, "p1", "sv01-189", 1); // index 7 — a Trainer PAST the window
  next = toDeckTop(next, "p1", "fix-energy", 3); // indices 4-6 — neither kind
  next = toDeckTop(next, "p1", "fix-item", 1); // index 3 — Trainer #2
  next = toDeckTop(next, "p1", "sv01-189", 1); // index 2 — Trainer #1
  next = toDeckTop(next, "p1", "fix-basic-2", 1); // index 1 — Pokémon #2
  next = toDeckTop(next, "p1", "fix-basic-1", 1); // index 0 — Pokémon #1
  return next;
}

/** Play `id` out of p1's hand and return the parked chooseCards prompt with it. */
function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const seededState = seeded(withCard);
  const uid = handUid(seededState, "p1", id);
  const { state: parked } = mustApply(seededState, { type: "playTrainer", seat: "p1", uid });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt };
}

describe("D332 — Drayton, the double-filter lookAtTopN window", () => {
  it("the registry resolves a program for every one of the four printings", () => {
    // 🛑 D330's finding, kept as a standing check: a filter or an op field can be
    // wired at every site, type-check everywhere and have ZERO printed consumers.
    // These four keys plus the `fix-drayton` demonstrator below are what stop
    // `also` from being that.
    for (const id of DRAYTON_IDS) {
      expect(programFor(id), id).toBeDefined();
    }
    expect(programFor("fix-drayton")).toBeDefined();
  });

  it("the four printings share ONE program object — reprints, not four authorings", () => {
    const first = programFor("sv08-174");
    for (const id of DRAYTON_IDS) expect(programFor(id), id).toBe(first);
  });

  it("the demonstrator's program carries `also`, and Great Ball's does not", () => {
    // The attribution control, read off the registry before any board runs it:
    // Great Ball is this program with the field REMOVED, so every difference the
    // boards below observe is attributable to `also` and to nothing else.
    const drayton = programFor("fix-drayton")?.trainer?.[0];
    const greatBall = programFor("sv02-183")?.trainer?.[0];
    if (drayton?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (greatBall?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(drayton.n).toBe(greatBall.n);
    expect(drayton.filter).toEqual(greatBall.filter);
    expect(drayton.max).toBe(greatBall.max);
    expect(drayton.also).toEqual({ filter: { kind: "trainerCard" }, max: 1 });
    expect(greatBall.also).toBeUndefined();
  });

  it("the fixture pool prints the sentence this slice built", () => {
    // 🛑 D330's other half: a program can be reachable from the catalog and
    // unreachable from the only pool the tests own. The printed bytes are what
    // the boards below actually play.
    expect(FIXTURE_POOL["fix-drayton"]?.effect).toContain("a Pokémon and a Trainer card");
    expect(FIXTURE_POOL["fix-drayton"]?.trainerType).toBe("Supporter");
  });

  it("offers the UNION of both filters out of the top 7, and nothing else", () => {
    const state = board(1);
    const window0 = [0, 1, 2, 3, 4, 5, 6].map((i) => deckAt(seeded(state), i));
    const { prompt } = play(state, "fix-drayton");

    const candidates = new Set(prompt.candidates);
    // Two Pokémon + two Trainers = 4 of the 7 looked-at cards…
    expect(candidates.size).toBe(4);
    for (const i of [0, 1, 2, 3]) expect(candidates.has(window0[i] as string), `${i}`).toBe(true);
    // …and the three that are NEITHER kind are refused, which is what proves the
    // union is a union of the two filters and not "the whole window".
    for (const i of [4, 5, 6]) expect(candidates.has(window0[i] as string), `${i}`).toBe(false);
  });

  it("does NOT reach past the window — a Trainer and a Pokémon at 7 and 8 are unreachable", () => {
    const state = board(2);
    const seededState = seeded(state);
    const deepTrainer = deckAt(seededState, 7);
    const deepPokemon = deckAt(seededState, 8);
    const { prompt } = play(state, "fix-drayton");

    // The boundary is observable from BOTH filters at once, which a single-filter
    // window check cannot show: `also` is scanned over the same `top`, so a
    // second filter reading the whole deck would surface here and only here.
    expect(prompt.candidates).not.toContain(deepTrainer);
    expect(prompt.candidates).not.toContain(deepPokemon);
  });

  it("caps each kind at 1 while the TOTAL is 2 — the printed conjunction", () => {
    const state = board(3);
    const { prompt } = play(state, "fix-drayton");
    const seededState = seeded(state);

    expect(prompt.max).toBe(2); // 1 + 1, the sum of the printed caps
    expect(prompt.min).toBe(0); // "you may" — declining is a legal answer
    expect(prompt.dest).toBe("hand");
    expect(prompt.caps).toHaveLength(2);

    const pokemon = [deckAt(seededState, 0), deckAt(seededState, 1)];
    const trainers = [deckAt(seededState, 2), deckAt(seededState, 3)];
    expect(prompt.caps?.[0]).toEqual({ uids: pokemon, max: 1 });
    expect(prompt.caps?.[1]).toEqual({ uids: trainers, max: 1 });
  });

  it("the caption prints the conjunction the card prints, not `anyOf`'s ' or '", () => {
    const state = board(4);
    const { prompt } = play(state, "fix-drayton");
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Pokémon and a Trainer card into your hand.",
    );
    // And it is not the disjunction the free candidate set would have produced.
    expect(prompt.note).not.toContain(" or ");
  });

  it("takes ONE of each — both land in hand, both are named in the reveal", () => {
    const state = board(5);
    const { parked } = play(state, "fix-drayton");
    const seededState = seeded(state);
    const pokemon = deckAt(seededState, 0);
    const trainer = deckAt(seededState, 2);
    const handBefore = parked.players.p1.hand.length;

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pokemon, trainer] },
    });

    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toContain(pokemon);
    expect(done.players.p1.hand).toContain(trainer);
    expect(done.players.p1.hand.length).toBe(handBefore + 2);
    expect(done.players.p1.deck).not.toContain(pokemon);
    expect(done.players.p1.deck).not.toContain(trainer);
    // `reveal: true` is the printed "you may reveal", so both are named.
    const revealed = find(events, "DECK_TOP_REVEALED");
    expect(revealed?.reveal).toBe(true);
    expect(new Set(revealed?.uids)).toEqual(new Set([pokemon, trainer]));
  });

  it("🛑 REFUSES TWO POKÉMON — the answer the flat `max` alone would have allowed", () => {
    // THE ROW'S PRICE, DRIVEN. Two Pokémon is two cards out of the offered
    // candidates with no uid repeated, so every check that existed before this
    // slice passes it: `uids.length <= prompt.max` (2 <= 2), `uids ⊆ candidates`,
    // no duplicate. Only `caps` refuses it. Delete the field and this is the case
    // that goes green while the card silently stops printing "and".
    const state = board(6);
    const { parked } = play(state, "fix-drayton");
    const seededState = seeded(state);
    const [pokemonA, pokemonB] = [deckAt(seededState, 0), deckAt(seededState, 1)];

    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [pokemonA, pokemonB] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("🛑 REFUSES TWO TRAINERS — the same defect on the OTHER cap", () => {
    // The mirror, and it is not redundant: a `caps` array built with both entries
    // pointing at the first filter's uids would refuse two Pokémon and admit two
    // Trainers, which is a defect the case above cannot see.
    const state = board(7);
    const { parked } = play(state, "fix-drayton");
    const seededState = seeded(state);
    const [trainerA, trainerB] = [deckAt(seededState, 2), deckAt(seededState, 3)];

    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [trainerA, trainerB] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("still refuses a THIRD card and a card outside the window", () => {
    const state = board(8);
    const { parked } = play(state, "fix-drayton");
    const seededState = seeded(state);
    const pokemon = deckAt(seededState, 0);
    const trainer = deckAt(seededState, 2);
    const filler = deckAt(seededState, 4); // in the window, in neither filter

    // The flat total still bites (3 > 2)…
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [pokemon, trainer, deckAt(seededState, 1)] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and so does "was it offered", which `caps` must not have weakened.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [filler] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("EITHER HALF ALONE is a legal answer — the two 'you may's are independent", () => {
    const seededState = seeded(board(9));
    for (const [label, index] of [
      ["the Pokémon alone", 0],
      ["the Trainer alone", 2],
    ] as const) {
      const state = board(9);
      const { parked } = play(state, "fix-drayton");
      const only = deckAt(seededState, index);
      const { state: done } = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [only] },
      });
      expect(done.phase.kind, label).toBe("turn:action");
      expect(done.players.p1.hand, label).toContain(only);
    }
  });

  it("DECLINING takes nothing, still announces the look, and still shuffles", () => {
    const state = board(10);
    const { parked } = play(state, "fix-drayton");
    const deckBefore = parked.players.p1.deck.length;
    const handBefore = parked.players.p1.hand.length;

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });

    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand.length).toBe(handBefore);
    expect(done.players.p1.deck.length).toBe(deckBefore);
    // D241 — the look is the announcement, the move only its consequence.
    expect(find(events, "DECK_TOP_REVEALED")?.uids).toEqual([]);
    // The printed "Shuffle the other cards back" is the trailing op, and a
    // decline is not a whiff: it fires either way.
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  it("🛑 THE ATTRIBUTION CONTROL — Great Ball on the SAME seeded window caps at 1 and offers only Pokémon", () => {
    // Identical board, identical seeded top 7, the same op, no `also`. If this
    // prompt and Drayton's were the same, `also` would be doing nothing — which
    // is the vacuous-guard defect a one-of-each window would have hidden.
    const state = board(11);
    const { prompt } = play(state, "sv02-183");
    const seededState = seeded(state);

    expect(prompt.max).toBe(1);
    expect(prompt.caps).toBeUndefined(); // ABSENT, not an empty array
    expect(new Set(prompt.candidates)).toEqual(
      new Set([deckAt(seededState, 0), deckAt(seededState, 1)]),
    );
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Pokémon into your hand.",
    );
  });

  it("a window with no Trainer in it still offers the Pokémon — the halves whiff separately", () => {
    // `candidates.length === 0` is the op's only no-op guard, so a window that
    // satisfies ONE filter must still park. Built by seeding a top 7 of Pokémon
    // and fillers only.
    let state = handFromDeck(board(12), "p1", "fix-drayton", 1);
    state = toDeckTop(state, "p1", "fix-energy", 5);
    state = toDeckTop(state, "p1", "fix-basic-1", 1);
    state = toDeckTop(state, "p1", "fix-basic-2", 1);
    const uid = handUid(state, "p1", "fix-drayton");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const prompt = parked.phase.prompt;
    expect(prompt.candidates).toHaveLength(2); // the two Pokémon
    // The Trainer cap is still PRESENT and still 1 — it caps an empty group, which
    // is what keeps the two halves independent rather than conditional on each
    // other. The total does NOT shrink to the satisfied half.
    expect(prompt.max).toBe(2);
    expect(prompt.caps?.[1]?.uids).toEqual([]);
  });
});
