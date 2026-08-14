import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  BUG_CATCHING_DECK,
  FIXTURE_POOL,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
} from "./testFixtures";

// D333 — BUG CATCHING SET `sv06-143`/`sv08.5-102`, THE SHARED CAP OVER A UNION,
// AND A PRICE WHOSE HEADLINE CLAIM WAS SIXTY-NINE DECISIONS STALE.
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Look at the top 7 cards of your deck. You may reveal **up to 2 in any
//    combination of {G} Pokémon and Basic {G} Energy cards** you find there and
//    put them into your hand. Shuffle the other cards back into your deck."
//   Item, **2 Standard-legal printings on one byte-identical `effect`, and they
//   are the whole population of the sentence.**
//
// ── THE CENSUS, AT TWO WIDTHS AND OVER ALL THREE TEXT COLUMNS ──────────────
// Re-run against the remote D1 `luminous` at THIS head (2026-08-14), with every
// per-column split re-added against its own total.
//
//   (a) `instr(<col>,'up to 2 in any combination of') > 0` — the sentence:
//         `effect`         2 rows / 2 legal — these two printings, only.
//         `attacks_json`   0 rows / 0 legal.
//         `abilities_json` 0 rows / 0 legal.
//       TOTAL 2 rows / 2 legal.  2 + 0 + 0 = 2 ✅   2 + 0 + 0 = 2 ✅
//
//   (b) `instr(<col>,'in any combination of') > 0` — the GRAMMAR, widened off
//       the number and the verb so a different cap cannot hide behind it:
//         `effect`         15 rows / 10 legal
//         `attacks_json`    4 rows /  3 legal
//         `abilities_json`  0 rows /  0 legal
//       TOTAL 19 rows / 13 legal. 15 + 4 + 0 = 19 ✅  10 + 3 + 0 = 13 ✅
//       🛑 **AND THE 15 `effect` ROWS ARE FIVE CARDS ON FOUR DIFFERENT OPS**,
//       which is the measurement that matters here: Bug Catching Set ×2
//       (`lookAtTopN`, this row), Ethan's Adventure ×3 (`searchDeck`), Lana's
//       Aid ×3 + Max Rod ×1 + Super Rod ×2 + Tulip ×3 (`discardPileRetrieval`)
//       and Team Rocket's Energy ×1 (a `providesEnergy` aura, a different
//       mechanism entirely). **THE PRINTED GRAMMAR IS AN ANSWER SHAPE, NOT AN
//       OP** — 2 + 3 + 3 + 1 + 2 + 3 + 1 = **15** ✅ — and three of those five
//       cards are already BUILT, which is exactly how this row was priced.
//
// ── WHAT THE RESUME POINT PRICED, AND THE CLAUSE THAT WAS FALSE ────────────
// It read: *"a UNION under ONE SHARED cap, i.e. `anyOf` with a flat `max: 2`,
// which needs **nothing D332 built and nothing else either** … the only cost left
// is the CAPTION — and D332's finding is that `anyOf`'s caption is the `" or "`
// join, which **is** right here … **This would be `anyOf`'s first live prompt
// consumer.**"*
//
// ✅ **THE FIRST CLAUSE IS TRUE AND IS THE WHOLE ROW**: this is `anyOf` under a
//    flat `max: 2`, zero new engine code, zero new op fields, zero deriver arms.
//
// 🛑 **"`anyOf`'s FIRST LIVE PROMPT CONSUMER" IS FALSE, AND IT IS FALSE BY
//    SIXTY-NINE DECISIONS.** `LANAS_AID` (D264) is `discardPileRetrieval` over
//    `anyOf[anyPokemon.noRuleBox, basicEnergy]`; it parks a `chooseCards` whose
//    note IS `retrieveNoun`'s `anyOf` arm, and `legalNonAttackPrograms.test.ts`
//    asserts the rendered string byte for byte under a case named *"the `anyOf`
//    arm's first witness"*. So the caption work the price expected here was done
//    at D264, and **Lana's Aid also prints "in any combination of … and …" and
//    also captions " or "** — the disagreement is not a defect to resolve, it is
//    the established reading, and this row inherits it unchanged.
//
// 🛑 **WHAT WAS ACTUALLY OWED WAS A COMMENT REPAIR, AND ITS ABSENCE PROPAGATED
//    INTO THREE FILES.** `retrieveNoun`'s `anyOf` arm still said *"Unreachable
//    from a prompt today"*. D264 made it reachable and never moved the sentence;
//    D332 then read that dead sentence and quoted it into `draytonWindow.test.ts`
//    AND into `progress.md`'s resume point, which is where this slice's work order
//    got it. **A STALE COMMENT PROPAGATES FURTHER THAN A STALE NUMBER, BECAUSE
//    NOTHING CAN GO RED ON IT** — D332's own "a green-and-dead member" finding,
//    inverted: not a member nothing reaches, but a member something reached while
//    the file went on saying nothing did.
//
// 🆕 **AND THE FIELD THIS ROW DELIBERATELY DOES NOT USE IS THE ONE THAT LOOKS
//    CLOSEST.** D332's `also` is a SECOND cap for a second noun — Drayton takes
//    one of each — where this sentence takes two of EITHER in any mixture. The two
//    printed grammars are one word apart (*"a Pokémon **and** a Trainer card"*
//    versus *"2 **in any combination of** X and Y"*) and mean opposite things
//    about a legal answer: `also` here would refuse the two-Grass-Pokémon take the
//    card explicitly permits. The case below drives exactly that answer.

const BUG_CATCHING_IDS = ["sv06-143", "sv08.5-102"] as const;

/** The uid of the deck card at `index` (0 = top) in p1's deck. */
function deckAt(state: GameState, index: number): string {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`p1 deck has no card at index ${index}`);
  return uid;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BUG_CATCHING_DECK, p2: BUG_CATCHING_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** A seeded top 7 holding one of each of the six things the union has to tell
    apart, plus a SECOND {G} Pokémon — and that second one is not decoration.

    🛑 **TWO OF ONE KIND IS WHAT MAKES THE FLAT CAP OBSERVABLE.** A window with one
    admissible card of each kind is answered identically by `max: 2` and by D332's
    `also: {…, max: 1}` pair, so every assertion here would pass on the wrong
    field. Two {G} Pokémon in the window is the board on which "2 in any
    combination" and "one of each" disagree, and the case below takes both.

    Indices, top first: 0 `fix-grass-basic`, 1 `fix-grass-stage1`,
    2 `fix-grass-energy`, 3 `fix-basic-1`, 4 `fix-energy`, 5 `fix-special`,
    6 `fix-item` — and a further `fix-grass-basic` at 7, PAST the window. */
function seeded(state: GameState): GameState {
  let next = state;
  next = toDeckTop(next, "p1", "fix-grass-basic", 2); // 0,1 → end up at 0 and 7
  next = toDeckTop(next, "p1", "fix-item", 1);
  next = toDeckTop(next, "p1", "fix-special", 1);
  next = toDeckTop(next, "p1", "fix-energy", 1);
  next = toDeckTop(next, "p1", "fix-basic-1", 1);
  next = toDeckTop(next, "p1", "fix-grass-energy", 1);
  next = toDeckTop(next, "p1", "fix-grass-stage1", 1);
  // …and the SECOND {G} Pokémon back on top, which leaves its twin at index 7:
  // the window boundary and the two-of-a-kind board in one seeding.
  next = toDeckTop(next, "p1", "fix-grass-basic", 1);
  return next;
}

function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const seededState = seeded(withCard);
  const uid = handUid(seededState, "p1", id);
  const { state: parked } = mustApply(seededState, { type: "playTrainer", seat: "p1", uid });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { seededState, parked, prompt: parked.phase.prompt };
}

const idOf = (state: GameState, uid: string) => state.cardIdByUid[uid];

describe("D333 — Bug Catching Set, a flat cap over a two-member union", () => {
  it("the registry resolves a program for both printings AND for the demonstrator", () => {
    for (const id of BUG_CATCHING_IDS) expect(programFor(id), id).toBeDefined();
    expect(programFor("fix-bugcatchingset")).toBeDefined();
  });

  it("the two printings share ONE program object — reprints, not two authorings", () => {
    const first = programFor("sv06-143");
    for (const id of BUG_CATCHING_IDS) expect(programFor(id), id).toBe(first);
    expect(programFor("fix-bugcatchingset")).toBe(first);
  });

  it("🛑 the program is `anyOf` under a FLAT cap — and carries no `also`", () => {
    const op = programFor("fix-bugcatchingset")?.trainer?.[0];
    if (op?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(op).toEqual({
      op: "lookAtTopN",
      n: 7,
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Grass" },
          { kind: "basicEnergy", energyType: "Grass" },
        ],
      },
      max: 2,
      reveal: true,
    });
    // 🛑 SPELLED OUT RATHER THAN LEFT TO THE `toEqual`: D332's field is the one an
    // author would reach for off this print, and it is the WRONG one. `also` is a
    // second cap for a second noun; this is one cap over a union.
    expect(op.also).toBeUndefined();
    expect(programFor("fix-bugcatchingset")?.trainer?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("the fixture pool prints the sentence this slice built", () => {
    expect(FIXTURE_POOL["fix-bugcatchingset"]?.effect).toBe(
      "Look at the top 7 cards of your deck. You may reveal up to 2 in any combination of {G} Pokémon and Basic {G} Energy cards you find there and put them into your hand. Shuffle the other cards back into your deck.",
    );
    expect(FIXTURE_POOL["fix-bugcatchingset"]?.trainerType).toBe("Item");
  });

  it("offers the two {G} Pokémon and the Basic {G} Energy — and nothing else", () => {
    const state = board(21);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    expect([...prompt.candidates].sort()).toEqual(
      [deckAt(seededState, 0), deckAt(seededState, 1), deckAt(seededState, 2)].sort(),
    );
    // ⚠️ THE MUTANT THIS KILLS, and it is the one Lana's Aid's row names one op
    // over: `anyOf` read as `.every` rather than `.some`. No card in this window is
    // both a {G} Pokémon and a Basic {G} Energy, so an intersection reading offers
    // an EMPTY prompt — an Item that pays nobody.
    expect(prompt.candidates.length).toBeGreaterThan(0);
  });

  it("⚠️ takes the STAGE 1 {G} Pokémon — the printed noun carries no stage word", () => {
    const state = board(22);
    const { seededState, prompt, parked } = play(state, "fix-bugcatchingset");
    const stage1 = deckAt(seededState, 1);
    expect(idOf(seededState, stage1)).toBe("fix-grass-stage1");
    // ⚠️ THE MUTANT THIS KILLS: `stage: "basic"` on `typedPokemon` — the rider
    // that member has carried since D238, that a plausible build adds off the word
    // "Pokémon", and that this print does not have. It compiles, captions almost
    // right, and silently refuses every Stage 1 and Stage 2 in the window.
    expect(prompt.candidates).toContain(stage1);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [stage1] },
    });
    expect(done.players.p1.hand).toContain(stage1);
    expect(done.players.p1.deck).not.toContain(stage1);
  });

  it("⚠️ refuses the COLORLESS Pokémon — the printed `{G}` on the first member", () => {
    const state = board(23);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    const colorless = deckAt(seededState, 3);
    expect(idOf(seededState, colorless)).toBe("fix-basic-1");
    // ⚠️ THE MUTANT THIS KILLS: `anyPokemon` in place of `typedPokemon{Grass}` —
    // which is Great Ball's own filter, the neighbouring registry row's REAL code,
    // and the copy an author would actually make.
    expect(prompt.candidates).not.toContain(colorless);
  });

  it("⚠️ refuses the COLORLESS Basic Energy — the same `{G}` on the OTHER member", () => {
    const state = board(24);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    const plainEnergy = deckAt(seededState, 4);
    expect(idOf(seededState, plainEnergy)).toBe("fix-energy");
    // ⚠️ BOTH REFUSALS ARE NEEDED AND THEY ARE NOT THE SAME ONE. One member could
    // lose its type while the other kept it, and a board that only checked the
    // Pokémon side would stay green through a `{ kind: "basicEnergy" }` with no
    // `energyType` — Lana's Aid's filter, one registry row over.
    expect(prompt.candidates).not.toContain(plainEnergy);
  });

  it("⚠️ refuses the SPECIAL Energy — the printed word \"Basic\"", () => {
    const state = board(25);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    const special = deckAt(seededState, 5);
    expect(idOf(seededState, special)).toBe("fix-special");
    // ⚠️ THE MUTANT THIS KILLS: `anyEnergy` in place of `basicEnergy` — the call
    // `attachFromTop`'s own doc makes for Hydreigon's "Energy cards", and the wrong
    // one here.
    expect(prompt.candidates).not.toContain(special);
  });

  it("🛑 TWO {G} POKÉMON IS A LEGAL ANSWER — \"in any combination\", not \"one of each\"", () => {
    const state = board(26);
    const { seededState, parked, prompt } = play(state, "fix-bugcatchingset");
    const bothPokemon = [deckAt(seededState, 0), deckAt(seededState, 1)];
    // 🛑 **THE CASE THAT SEPARATES THIS ROW FROM D332's `also`.** Under
    // `also: [{typedPokemon,1},{basicEnergy,1}]` the prompt would carry `caps` and
    // `validateChoice` would REFUSE this answer, which the card explicitly permits.
    // The flat total is the printed "up to 2" and the union is the printed "in any
    // combination of".
    expect(prompt.max).toBe(2);
    expect(prompt.min).toBe(0); // the printed "You may"
    expect(prompt).not.toHaveProperty("caps");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: bothPokemon },
    });
    for (const uid of bothPokemon) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.deck).not.toContain(uid);
    }
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      uids: bothPokemon,
      reveal: true,
    });
    expect(done.phase.kind).toBe("turn:action");
  });

  it("⚠️ a THIRD admissible card is refused — the printed \"up to 2\"", () => {
    const state = board(27);
    const { seededState, parked } = play(state, "fix-bugcatchingset");
    const three = [deckAt(seededState, 0), deckAt(seededState, 1), deckAt(seededState, 2)];
    // The wire validator's flat total, driven rather than asserted about: three
    // cards are OFFERED and only two may be taken, so a build that dropped the cap
    // (or spelled `max: 7`, the window) is caught by a refusal and not by a count.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: three } },
      "BAD_EFFECT_CHOICE",
    );
    // …and the SAME three minus one applies, so the refusal is the CAP and not a
    // broken candidate set (the shape a bare rejection cannot distinguish).
    expect(
      mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: three.slice(0, 2) },
      }).state.phase.kind,
    ).toBe("turn:action");
  });

  it("⚠️ a {G} Pokémon PAST the window is unreachable — `n: 7`", () => {
    const state = board(28);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    const buried = deckAt(seededState, 7);
    expect(idOf(seededState, buried)).toBe("fix-grass-basic");
    // ⚠️ A card the filter ADMITS, sitting one card past the window — so this
    // refusal is attributable to `n` and to nothing about the union.
    expect(prompt.candidates).not.toContain(buried);
  });

  it("🛑 the caption joins with \" or \", exactly as Lana's Aid has since D264", () => {
    const state = board(29);
    const { prompt } = play(state, "fix-bugcatchingset");
    // 🛑 **THE PROSE THE WORK ORDER EXPECTED TO OWE, AND IT WAS SETTLED AT D264.**
    // `retrieveNoun`'s `anyOf` arm joins with " or " where this card prints "and",
    // deliberately: a union predicate asked about ONE card reads as a disjunction.
    // Lana's Aid prints the identical "in any combination of … and …" grammar and
    // captions the identical join, and its own case asserts that string byte for
    // byte. This row inherits the reading rather than changing it — a second
    // witness, not a new decision.
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put up to 2 Grass Pokémon or Basic Grass Energy cards into your hand.",
    );
  });

  it("🛑 GREAT BALL ON THE SAME BOARD OFFERS THE COLORLESS POKÉMON — the control", () => {
    const state = board(30);
    const { seededState, prompt } = play(state, "sv02-183");
    // The SAME op over the SAME seeded window with a WIDER filter and a numeric
    // cap. Without it, "the union narrowed correctly" and "the window happened to
    // be small" are indistinguishable — D214's rule for a shared subject.
    expect(prompt.candidates).toContain(deckAt(seededState, 3)); // the Colorless Pokémon
    expect(prompt.candidates).not.toContain(deckAt(seededState, 2)); // …and NO Energy at all
    expect(prompt.max).toBe(1);
  });
});
