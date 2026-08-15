import type { Card } from "@luminous/schema";
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
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── D341 — "…AND PUT THEM BACK **IN ANY ORDER**": THE FIRST PROMPT IN THIS
//    ENGINE WHOSE ANSWER IS A SEQUENCE. ────────────────────────────────────────
//
// ── THE TWO PRINTED SENTENCES ───────────────────────────────────────────────
//   (i)  "Look at the top **4** cards of your deck and put them back in any
//        order."                    — Iron Valiant `sv05-080` "Calculation",
//                                      attack index 0, cost {P}. **1 legal.**
//   (ii) "Look at the top **5** cards of your **opponent's** deck and put them
//        back in any order."        — Team Rocket's Dottler `sv10-088`
//                                      "Disruptive Radar" and Gothorita
//                                      `sv10.5w-042`/`-125` "Fortunate Eye",
//                                      attack index 0. **3 legal.**
//   **4 Standard-legal printings on 2 sentences, ALL on `attacks_json`.**
//
// ── THE CENSUS, RE-RUN AT THIS HEAD AT TWO WIDTHS AND ON THE CONSTRUCTION ────
// Every figure re-queried against remote D1 `luminous` (3,786 rows, 2,021
// `legal_standard`) on 2026-08-15 rather than inherited from the work order.
//
//   (a) THE CONSTRUCTION — `instr(<col>,'in any order') > 0`, all three columns
//       in ONE 3-arm `UNION ALL` (D340's shape; the compound cap is 5 arms):
//         `effect`          8 rows / 6 legal
//         `attacks_json`    7 rows / 5 legal
//         `abilities_json`  0 rows / 0 legal
//       TOTAL **15 printings / 11 legal on 7 sentences.**
//       8 + 7 + 0 = 15 ✅   6 + 5 + 0 = 11 ✅
//
//   (b) THIS ARM'S GRAMMAR — the construction UNDER THIS VERB AND THIS ZONE:
//       `instr(attacks_json,'deck and put them back in any order') > 0`:
//         6 rows / **4 legal** — `sv05-080`, `sv10-088`, `sv10.5w-042`,
//         `sv10.5w-125` legal; `sv03-135`/`sv03-214` (Absol ex) not.
//
// 🛑 **(a) MINUS (b) IS THE FINDING, AND IT IS WHY THE WORK ORDER'S UNIT WAS
//    WRONG.** The backlog priced this residue as *Deduction Kit `sv08-171`,
//    **1 legal***. The construction holds **eleven** legal printings, and
//    Deduction Kit is **not the cheapest member of its own family** — it prints
//    sentence (i) verbatim PLUS *"**, or** shuffle them and put them on the bottom
//    of your deck"*, a second printed decision on the same cards. The seven
//    sentences, and what each owes ON TOP of the ordered answer:
//      • **(i)** and **(ii)** — NOTHING. **THIS ROW.** 4 legal.
//      • *"Search your deck for 2 cards, shuffle your deck, then put those cards
//        on top of it in any order."* — Ciphermaniac's Codebreaking `sv05-145`/
//        `-198`/`sv08.5-104` (3 legal, `effect`) and Dialga `sv08-135` "Time
//        Manipulation" (1 legal, `attacks_json`). Owes: the ordered cards come out
//        of a SEARCH of the whole deck and land on a top that was just shuffled —
//        a `searchDeck` whose picks are then sequenced onto the deck, which is a
//        second park behind the first.
//      • *"Put 2 cards from your hand on the bottom of your deck in any order."* —
//        Kofu `sv07-138`/`-165` (2 legal, `effect`). Owes: a HAND source and a
//        BOTTOM destination, i.e. the ordered answer over a different zone pair
//        entirely, plus the printed "if you do" draw gate.
//      • *"Look at the top 3 cards of your deck and put them back in any order,
//        **or** shuffle them and put them on the bottom of your deck."* —
//        Deduction Kit `sv08-171` (1 legal, `effect`). Owes: the printed
//        two-armed `or`.
//        ✅ **BUILT AT D344 — `const DEDUCTION_KIT` in `registry.ts`, and the
//        `or` cost TWO OPTIONAL FIELDS ON `reorderTop` PLUS ONE OP**, not the
//        prompt kind this list implies. `otherwise` carries the second arm's ops,
//        `otherwiseNote` its printed words, `orderCards.alt` renders them, and
//        the answer is the EMPTY ordering. ⚠️ **THE LINE ABOVE IS LEFT STANDING
//        BECAUSE IT IS STILL TRUE OF *THIS FILE*'s ANCHOR** — `deriveAttackEffect`
//        must go on refusing the sentence, and the refusal is now LOAD-BEARING in
//        a way it was not while the card was unbuilt: a floating match would
//        half-build a card the registry already builds whole.
//      • *"Look at the top 5 cards of your deck and discard any number of them.
//        Put the other cards back in any order."* — Raifort `sv06-161`/
//        `sv08.5-142` (**0 legal**). Owes: a `lookAtTopN` whose LEFTOVERS are then
//        ordered — two parks, one sentence. Recorded as a SHAPE, not a row.
//
// ── 🛑 THE SUMMAND THIS ROW MOVES, AND WHAT IT IS KEYED ON ──────────────────
// `BUILT.attack` = **1,164 raw + 16 registry + 13 split = 1,193** at head, and all
// three summands were RE-DERIVED by opening their authorities (`censusAtHead`'s
// `resolved` sum and `precociousEvolution`'s `rawHead`) rather than taken from the
// work order. This handoff's three were ACCURATE.
//
// THIS ROW MOVES THE **RAW** SUMMAND, **KEYED ON THE READERS**: 1,164 → **1,168**,
// so `BUILT.attack` 1,193 → **1,197**.
//   * the REGISTRY summand cannot move — this row authors NO `registry.ts` entry
//     at all, so `registryCardIds()` stands still and D314's converse guard over
//     `REGISTRY_ATTACKS` cannot fire (it fired at D338 and D339, which authored
//     registry rows; it did not fire at D340, which authored none, and it does not
//     fire here for the same reason);
//   * the SPLIT summand cannot move — neither sentence carries a gate clause;
//   * and `raw.length` (the NON-attack registry census) stands still with it,
//     along with `raw[raw.length - 1]`, which is an INSERTION-ORDER assertion and
//     therefore the rung most easily moved by accident. **The three summands are
//     keyed on three different instruments and this row moves exactly one** —
//     D338's distinction, and the FIRST time since D326 that the moving one is raw.
//
// 🛑 **AND THE DIFFERENCE `precociousEvolution` PINS MOVES WITH IT, WHERE IT
//    STOOD STILL AT D339 AND D340.** `head − rawDelta − splitDelta` held at 1,187
//    through two slices that moved the REGISTRY summand; because this slice moves
//    the RAW one and `rawDelta`/`splitDelta` (4 and 2, the precocious sentences)
//    are untouched, the difference goes 1,187 → **1,191**. **WHICH RUNGS MOVE
//    FOLLOWS FROM WHICH SUMMAND, NOT FROM THE SIZE OF THE DIFF.**
//
// ── ⚠️ THE OTHER THREE `BUILT` COLUMNS STAND STILL, AND IT IS MEASURED ──────
// All four ids carry `abilities_json IS NULL` **AND** `effect IS NULL` **AND**
// `category = 'Pokemon'` (remote D1, 2026-08-15), so no ability reader, no
// trainer reader and no Energy reader can see either sentence at all.
//
// ── 🛑 THE FIXTURE POOL IS LOCAL, AND HERE THAT IS TWO COSTS AVOIDED ────────
// `catalogManifest.test.ts` classifies every real-looking fixture id against a
// generated manifest of six sets (sv01/sv02/sv03/sv06.5/sve/swsh10.5). **`sv05`,
// `sv10` and `sv10.5w` are none of them**, so a body in the SHARED `FIXTURE_POOL`
// would owe a `fix-*` demonstrator key AND redden `revealClause`'s `swept.size`
// (27) AND `raw.length` (672) — the three costs D335/D336/D337 paid and D338/D339/
// D340 avoided. Every id here is driven on a LOCAL `cardPool` (D275's idiom) and
// §9 asserts this file's emptiness against `FIXTURE_POOL` rather than claiming it.

/** Iron Valiant `sv05-080` "Calculation" — sentence (i), the OWN-deck arm. */
const PRINTED_OWN = "Look at the top 4 cards of your deck and put them back in any order.";
/** Gothorita `sv10.5w-042` "Fortunate Eye" — sentence (ii), the OPPONENT arm. */
const PRINTED_OPP =
  "Look at the top 5 cards of your opponent's deck and put them back in any order.";

const IRON_VALIANT = "sv05-080";
const DOTTLER = "sv10-088";
const GOTHORITA_A = "sv10.5w-042";
const GOTHORITA_B = "sv10.5w-125";
/** The four Standard-legal printings, in catalog order. */
const LEGAL_IDS = [IRON_VALIANT, DOTTLER, GOTHORITA_A, GOTHORITA_B] as const;

const PSYCHIC_ENERGY = "d341-energy";
const WALL = "d341-wall";
/** Six distinguishable deck fillers, so a re-sequenced top is observable by NAME
    and not only by uid — a permutation of five identical cards is indistinguishable
    from the identity, which would make every ordering assertion vacuous. */
const FILLERS = ["d341-f1", "d341-f2", "d341-f3", "d341-f4", "d341-f5", "d341-f6"] as const;

const LOCAL_CARDS: Record<string, Card> = {
  [IRON_VALIANT]: battler(IRON_VALIANT, {
    name: "Iron Valiant",
    hp: 130,
    retreat: 1,
    types: ["Psychic"],
    attacks: [
      { cost: ["Psychic"], name: "Calculation", effect: PRINTED_OWN },
      { cost: ["Psychic", "Psychic", "Colorless"], name: "Majestic Sword", damage: "100+" },
    ],
  }),
  [DOTTLER]: battler(DOTTLER, {
    name: "Team Rocket's Dottler",
    hp: 90,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Team Rocket's Blipbug",
    attacks: [
      {
        cost: ["Colorless"],
        name: "Disruptive Radar",
        effect: "Look at the top 5 cards of your opponent's deck and put them back in any order.",
      },
      { cost: ["Psychic", "Colorless"], name: "Super Psy Bolt", damage: 30 },
    ],
  }),
  [GOTHORITA_A]: battler(GOTHORITA_A, {
    name: "Gothorita",
    hp: 80,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Gothita",
    attacks: [
      { cost: ["Psychic"], name: "Fortunate Eye", effect: PRINTED_OPP },
      { cost: ["Psychic", "Colorless"], name: "Psyshot", damage: 40 },
    ],
  }),
  [GOTHORITA_B]: battler(GOTHORITA_B, {
    name: "Gothorita",
    hp: 80,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Gothita",
    attacks: [
      { cost: ["Psychic"], name: "Fortunate Eye", effect: PRINTED_OPP },
      { cost: ["Psychic", "Colorless"], name: "Psyshot", damage: 40 },
    ],
  }),
  [PSYCHIC_ENERGY]: typedEnergy(PSYCHIC_ENERGY, "Psychic"),
  [WALL]: battler(WALL, {
    name: "D341 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  ...Object.fromEntries(
    FILLERS.map((id, i) => [
      id,
      battler(id, {
        name: `D341 Filler ${String(i + 1)}`,
        hp: 200,
        retreat: 1,
        types: ["Colorless"],
        attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
      }),
    ]),
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 4 + 4 + 4 + 4 + 16 + 4 + 6×4 = 60.
const DECK = deckOf({
  [IRON_VALIANT]: 4,
  [DOTTLER]: 4,
  [GOTHORITA_A]: 4,
  [GOTHORITA_B]: 4,
  [PSYCHIC_ENERGY]: 16,
  [WALL]: 4,
  ...Object.fromEntries(FILLERS.map((id) => [id, 4])),
});

const ATTACK = { type: "attack", seat: "p1", index: 0 } as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
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

/** TEST SURGERY — `count` Energy onto p1's Active, taken off p1's deck so every
    uid stays in exactly one zone. Both attacks cost a single Energy. */
function fuel(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === PSYCHIC_ENERGY).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} ${PSYCHIC_ENERGY}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** TEST SURGERY — replace `seat`'s deck outright. The whole subject of this op is
    a deck's ORDER, so every ordering assertion needs a KNOWN starting sequence;
    seeding by shuffle would make the assertions depend on the rng. */
function setDeck(state: GameState, seat: Seat, deck: readonly string[]): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], deck: [...deck] } },
  };
}

/** A board with `attacker` Active for p1 on p1's turn and a 330 HP Wall opposite. */
function board(seed: number, attacker: string): GameState {
  let state = localSetup(seed, "p2");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLERS[0]);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", attacker);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLERS[1]);
  return fuel(state, 1);
}

/** The catalog ids of the first `n` cards of `seat`'s deck, top first. */
function topIds(state: GameState, seat: Seat, n: number): string[] {
  return state.players[seat].deck.slice(0, n).map((uid) => state.cardIdByUid[uid] ?? "?");
}

function attack(state: GameState): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, ATTACK);
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function answer(state: GameState, uids: readonly string[], seat: Seat = "p1") {
  return applyAction(state, {
    type: "resolveEffect",
    seat,
    choice: { kind: "orderCards", uids: [...uids] },
  });
}

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "orderCards") {
    throw new Error(`wrong prompt: ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 the reader — the four legal printings derive and the two illegal ones do not", () => {
  it("sentence (i) derives to a bare own-deck reorder of the printed window", () => {
    expect(deriveAttackEffect(PRINTED_OWN)).toEqual<EffectOp[]>([{ op: "reorderTop", n: 4 }]);
  });

  it("sentence (ii) derives to the SAME op plus `side`, and nothing else moves", () => {
    // The two readings differ in EXACTLY the printed possessive — D135's rule, and
    // the reason both arms live in one alternation rather than two constants.
    expect(deriveAttackEffect(PRINTED_OPP)).toEqual<EffectOp[]>([
      { op: "reorderTop", n: 5, side: "opponent" },
    ]);
  });

  it("all FOUR legal printings resolve off their own catalog text", () => {
    for (const id of LEGAL_IDS) {
      const card = LOCAL_CARDS[id];
      if (card?.category !== "Pokemon") throw new Error(`${id} is not a Pokémon`);
      const effect = card.attacks?.[0]?.effect;
      if (effect === undefined) throw new Error(`${id} attack 0 has no effect text`);
      expect(deriveAttackEffect(effect)).not.toBeNull();
    }
  });

  it("the two GOTHORITA printings carry BYTE-IDENTICAL text and derive identically", () => {
    // `sv10.5w-042` and `sv10.5w-125` are the same card in two slots. If the two
    // ever diverge in the catalog this is the rung that says so, rather than the
    // count silently dropping to 3.
    const a = LOCAL_CARDS[GOTHORITA_A];
    const b = LOCAL_CARDS[GOTHORITA_B];
    if (a?.category !== "Pokemon" || b?.category !== "Pokemon") throw new Error("not Pokémon");
    expect(a.attacks?.[0]?.effect).toBe(b.attacks?.[0]?.effect);
  });

  it("🛑 Absol ex's *either player's* deck is REFUSED — a printed SIDE CHOICE", () => {
    // `sv03-135`/`sv03-214`, both `legal_standard = 0`. The refusal is by the
    // pattern and not by a guard: the sentence needs a second decision (whose
    // deck) BEFORE the ordering one, and building it would ship a union value no
    // legal printing reaches (D331).
    expect(
      deriveAttackEffect(
        "Look at the top 3 cards of either player's deck and put them back in any order.",
      ),
    ).toBeNull();
  });

  it("🛑 the four NEIGHBOURING `in any order` sentences are all refused", () => {
    // Every one of these is a real printed sentence in the same construction, and
    // each owes a mechanism this op does not have. A reader that admitted any of
    // them would half-build a card — the failure mode `ATTACK_LOOK_TOP_*`'s own
    // anchors exist to prevent.
    for (const sentence of [
      // Deduction Kit `sv08-171` — this arm's sentence PLUS a printed `or`.
      "Look at the top 3 cards of your deck and put them back in any order, or shuffle them and put them on the bottom of your deck.",
      // Raifort `sv06-161`/`sv08.5-142` — a discard, then a reorder of the rest.
      "Look at the top 5 cards of your deck and discard any number of them. Put the other cards back in any order.",
      // Kofu `sv07-138`/`-165` — from the HAND, to the BOTTOM.
      "Put 2 cards from your hand on the bottom of your deck in any order.",
    ]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
    }
  });

  it("🆕 D342 — the SEARCH neighbour is no longer NULL, and THIS arm still refuses it", () => {
    // 🛑 THE ROW MOVED UNDER THIS ASSERTION, WHICH IS WHY IT IS NOW TWO CLAIMS
    // INSTEAD OF ONE. Ciphermaniac's Codebreaking / Dialga `sv08-135` sat in the
    // list above as "refused, and owes a mechanism this op does not have"; D342
    // built it, so `deriveAttackEffect` no longer returns null and the old row
    // would have gone red for the RIGHT reason with the WRONG message.
    //
    // What this file actually claimed — and still claims — is narrower and is the
    // half worth keeping: **`ATTACK_REORDER_TOP` does not read this sentence.**
    // The program it derives to is a THREE-op search-and-order, not this arm's
    // bare one-op reorder, so the two anchors have not come to overlap.
    const search =
      "Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order.";
    const derived = deriveAttackEffect(search);
    expect(derived).not.toBeNull();
    expect(derived?.map((op) => op.op)).toEqual(["shuffleDeck", "searchDeck", "reorderTop"]);
    // 🛑 AND THE DISTINGUISHING CLAIM: whatever reads it, it is NOT a bare
    // `reorderTop` program. A floating `ATTACK_REORDER_TOP` would produce exactly
    // that, and would silently drop the printed search.
    expect(derived).not.toEqual<EffectOp[]>([{ op: "reorderTop", n: 2 }]);
  });

  it("🛑 THE TRAILING ANCHOR IS LOAD-BEARING RATHER THAN HYGIENIC", () => {
    // D234's dropped-`$` mutant, and on THIS arm the consequence is not a stray
    // clause but a silently DIFFERENT CARD: Deduction Kit's sentence is this one
    // plus ", or …", so a floating match drops a printed alternative the player is
    // entitled to. Asserted from the outside — the two strings share a prefix and
    // only the anchor tells them apart.
    //
    // 🆕🛑 **D344 SHARPENED THIS FROM A HYPOTHETICAL INTO A COLLISION.** When this
    // was written the alternative was unbuilt, so a floating match dropped a
    // clause NOBODY had implemented. `sv08-171` is now an authored registry row,
    // so the same floating match would derive a bare `reorderTop` for a card the
    // engine builds correctly one file over — two readings of one printing, and
    // the deriver's would silently win on the attack surface. **A REFUSAL GETS
    // MORE LOAD-BEARING, NOT LESS, THE DAY THE THING IT REFUSES GETS BUILT.**
    const withTail =
      "Look at the top 3 cards of your deck and put them back in any order, or shuffle them and put them on the bottom of your deck.";
    expect(
      withTail.startsWith("Look at the top 3 cards of your deck and put them back in any order"),
    ).toBe(true);
    expect(deriveAttackEffect(withTail)).toBeNull();
  });

  it("🛑 the window is DIGITS — `Number`'s grammar cannot size a deck window", () => {
    // D240's surviving mutant, inherited: `Number("4e1")` is 40 and
    // `Number("0x28")` is 40, so a `.+` capture feeding `Number` would let one
    // malformed catalog row open a forty-card window.
    for (const n of ["4e1", "0x28", "4.5", " 4", "four"]) {
      expect(
        deriveAttackEffect(
          `Look at the top ${n} cards of your deck and put them back in any order.`,
        ),
      ).toBeNull();
    }
  });

  it("the printed-number guard refuses 0 and refuses an absurd window", () => {
    expect(
      deriveAttackEffect("Look at the top 0 cards of your deck and put them back in any order."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Look at the top 999 cards of your deck and put them back in any order."),
    ).toBeNull();
  });

  it("BOTH spellings of the possessive apostrophe read as the opponent arm", () => {
    // D136/D137's `['’]` rule. The catalog carries the straight quote today; a
    // re-ingest carrying the typographic one must not silently drop three
    // printings into `null`.
    expect(
      deriveAttackEffect(
        "Look at the top 5 cards of your opponent’s deck and put them back in any order.",
      ),
    ).toEqual<EffectOp[]>([{ op: "reorderTop", n: 5, side: "opponent" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 the park — the window is offered in DECK ORDER and the note names the deck", () => {
  it("Iron Valiant parks on `orderCards` with the top 4 of p1's OWN deck, top first", () => {
    const state = seededOwn(3);
    const before = topIds(state, "p1", 4);
    const { state: parked } = attack(state);
    const prompt = parkedPrompt(parked);
    expect(prompt.candidates).toHaveLength(4);
    // The offer IS the current top, in current order — the identity permutation
    // has to be a reachable answer, and the dialog needs the order it starts from.
    expect(prompt.candidates.map((uid) => parked.cardIdByUid[uid])).toEqual(before);
  });

  it("the note speaks to the ANSWERER and names WHOSE deck, on both arms", () => {
    const own = parkedPrompt(attack(seededOwn(4)).state);
    expect(own.note).toBe("Put these cards back on top of your deck in any order.");
    const opp = parkedPrompt(attack(seededOpp(7)).state);
    expect(opp.note).toBe("Put these cards back on top of your opponent's deck in any order.");
  });

  it("🛑 the note prints NO number, unlike every other look caption", () => {
    // `lookNote`'s lesson pointed the other way (D333/D334): `op.n` is the printed
    // WINDOW and the offer is `min(n, deck.length)`, so a caption naming 5 over a
    // 2-card deck would contradict the dialog beside it. There is nothing for a
    // number to be a claim about here — the count is not a decision.
    const short = parkedPrompt(attack(seededOpp(9, 2)).state);
    expect(short.candidates).toHaveLength(2);
    expect(short.note).not.toMatch(/\d/);
  });

  it("Gothorita and Dottler park on the OPPONENT's cards, not the controller's", () => {
    for (const id of [DOTTLER, GOTHORITA_A, GOTHORITA_B]) {
      const state = seededOpp(11, 5, id);
      const expected = topIds(state, "p2", 5);
      const parked = attack(state).state;
      const prompt = parkedPrompt(parked);
      expect(prompt.candidates.map((uid) => parked.cardIdByUid[uid])).toEqual(expected);
      // And NONE of them is a card of the controller's — the whole point of `side`.
      expect(prompt.candidates.every((uid) => !parked.players.p1.deck.includes(uid))).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 the degenerate windows — no decision, no park, but the LOOK is announced", () => {
  it("a 1-card deck does NOT park: one ordering is not a decision", () => {
    const state = seededOpp(13, 1);
    const { state: done, events } = attack(state);
    expect(done.phase.kind).not.toBe("effect:choose");
    // …and the row still fires, D241's rule: the looker learned the top card.
    expect(find(events, "DECK_TOP_REORDERED")?.count).toBe(1);
  });

  it("an EMPTY deck does not park and still announces a look of 0", () => {
    const state = seededOpp(17, 0);
    const { state: done, events } = attack(state);
    expect(done.phase.kind).not.toBe("effect:choose");
    const row = find(events, "DECK_TOP_REORDERED");
    expect(row?.count).toBe(0);
  });

  it("🛑 the announced COUNT is what was LOOKED AT, never the printed window", () => {
    // A 2-card deck under a printed top-5 taught the looker two cards. Announcing
    // five would be a claim about cards nobody saw — `lookAtTopN`'s whiff branch
    // guards on `top.length` for the same reason, and this is that rule transferred.
    const { events } = attack(seededOpp(19, 2));
    expect(find(events, "DECK_TOP_REORDERED")?.count).toBe(2);
  });

  it("a 2-card window DOES park — two is the smallest real decision", () => {
    expect(parkedPrompt(attack(seededOpp(23, 2)).state).candidates).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 the apply — the ANSWER'S POSITIONS are the whole effect", () => {
  it("the deck top is re-sequenced into the answered order and nothing else moves", () => {
    const state = seededOwn(29);
    const before = [...state.players.p1.deck];
    const parked = attack(state).state;
    const prompt = parkedPrompt(parked);
    const reversed = [...prompt.candidates].reverse();
    const done = must(answer(parked, reversed));
    expect(done.players.p1.deck.slice(0, 4)).toEqual(reversed);
    // Everything UNDER the window is byte-identical — the splice replaces exactly
    // `uids.length` slots and re-derives the tail off the live deck.
    expect(done.players.p1.deck.slice(4)).toEqual(before.slice(4));
    expect(done.players.p1.deck).toHaveLength(before.length);
  });

  it("the IDENTITY permutation is a legal answer and leaves the deck untouched", () => {
    // "Put them back in any order" prints no "you may": leaving the order alone is
    // an ANSWER the player gives, not a decline they take.
    const state = seededOwn(31);
    const before = [...state.players.p1.deck];
    const parked = attack(state).state;
    const done = must(answer(parked, parkedPrompt(parked).candidates));
    expect(done.players.p1.deck).toEqual(before);
  });

  it("🛑 the OPPONENT arm orders the OPPONENT's deck, AND THE NEW TOP IS WHAT THEY DRAW", () => {
    // 🛑 THE FIRST DRAFT OF THIS RUNG ASSERTED `p2.deck.slice(0, 5) === rotated`
    // AND WAS SIMPLY FALSE — the board was never too narrow (D340's distinction).
    // This is an ATTACK, so its epilogue ends p1's turn, the Checkup runs and p2
    // STARTS THEIR TURN, which draws. The engine was right and the assertion was
    // a claim about a state that no longer exists by the time the action returns.
    //
    // ✅ AND THE REPAIR IS STRICTLY SHARPER THAN THE THING IT REPLACES: what the
    // card is FOR is deciding which card the opponent draws next, and that is now
    // what is asserted. The rest of the ordered window sits under it, in order.
    const state = seededOpp(37, 5);
    const ownBefore = [...state.players.p1.deck];
    const parked = attack(state).state;
    const rotated = [...parkedPrompt(parked).candidates];
    const head = rotated.shift();
    if (head === undefined) throw new Error("empty window");
    rotated.push(head);
    const done = must(answer(parked, rotated));
    const drawn = rotated[0];
    if (drawn === undefined) throw new Error("empty ordering");
    expect(done.players.p2.hand).toContain(drawn);
    expect(done.players.p2.deck.slice(0, 4)).toEqual(rotated.slice(1));
    // The controller's own deck is untouched — the failure this rung exists for is
    // an apply that read `ctx.seat` where the park read the opponent.
    expect(done.players.p1.deck).toEqual(ownBefore);
  });

  it("no card is created or destroyed — counted over deck AND hand, not deck alone", () => {
    // The same correction, stated as arithmetic: the turn hand-off draws, so a
    // deck-only conservation law is false for the seat whose turn begins. Deck +
    // hand is the invariant the reorder actually preserves.
    const state = seededOpp(41, 5);
    const held = (s: GameState, seat: Seat) =>
      s.players[seat].deck.length + s.players[seat].hand.length;
    const before = [held(state, "p1"), held(state, "p2")];
    const parked = attack(state).state;
    const done = must(answer(parked, [...parkedPrompt(parked).candidates].reverse()));
    expect([held(done, "p1"), held(done, "p2")]).toEqual(before);
  });

  it("the resolve emits NO second `DECK_TOP_REORDERED` row", () => {
    // The row reports the LOOK, which happened when the op parked. A second row
    // here would claim the deck top was read twice.
    const parked = attack(seededOwn(43)).state;
    const result = answer(parked, [...parkedPrompt(parked).candidates].reverse());
    if (!result.ok) throw new Error("answer refused");
    expect(result.events.filter((e) => e.type === "DECK_TOP_REORDERED")).toHaveLength(0);
  });

  it("the program finishes and the turn returns to the controller", () => {
    const parked = attack(seededOwn(47)).state;
    const done = must(answer(parked, [...parkedPrompt(parked).candidates].reverse()));
    // The attack's own tail ran: this is an attack, so the turn ends through it.
    expect(done.phase.kind).not.toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 validateChoice — a PERMUTATION, which is three refusals the `cards` arm has never had to make", () => {
  it("a SHORT answer is refused — it would destroy the cards it left out", () => {
    const parked = attack(seededOwn(53)).state;
    const result = answer(parked, parkedPrompt(parked).candidates.slice(0, 3));
    expect(result.ok).toBe(false);
  });

  it("an EMPTY answer is refused — there is no printed decline", () => {
    const parked = attack(seededOwn(59)).state;
    expect(answer(parked, []).ok).toBe(false);
  });

  it("a LONG answer is refused", () => {
    const parked = attack(seededOwn(61)).state;
    const c = parkedPrompt(parked).candidates;
    expect(answer(parked, [...c, c[0] ?? ""]).ok).toBe(false);
  });

  it("a REPEATED uid is refused — one physical card cannot occupy two slots", () => {
    const parked = attack(seededOwn(67)).state;
    const c = parkedPrompt(parked).candidates;
    const first = c[0];
    if (first === undefined) throw new Error("empty window");
    expect(answer(parked, [first, first, c[2] ?? "", c[3] ?? ""]).ok).toBe(false);
  });

  it("🛑 an UNOFFERED uid is refused — it would drag a card up from BELOW the window", () => {
    // `lookAtTopN`'s rule: the print let the player see the top N, so an answer
    // naming index N would promote a card nobody looked at.
    const parked = attack(seededOwn(71)).state;
    const c = parkedPrompt(parked).candidates;
    const deeper = parked.players.p1.deck[4];
    if (deeper === undefined) throw new Error("deck too short");
    expect(answer(parked, [deeper, c[1] ?? "", c[2] ?? "", c[3] ?? ""]).ok).toBe(false);
  });

  it("a WRONG-KIND answer is refused", () => {
    const parked = attack(seededOwn(73)).state;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...parkedPrompt(parked).candidates] },
    });
    expect(result.ok).toBe(false);
  });

  it("a NON-STRING entry off the wire is refused", () => {
    // The `string[]` type is a claim about the action, not about the JSON — the
    // `attachCards` arm's rule, and a P4 client is checked by this function alone.
    const parked = attack(seededOwn(79)).state;
    const c = parkedPrompt(parked).candidates;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "orderCards",
        uids: [7 as unknown as string, c[1] ?? "", c[2] ?? "", c[3] ?? ""],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("every refusal leaves the park standing, so the game is not soft-locked", () => {
    const parked = attack(seededOwn(83)).state;
    const refused = answer(parked, []);
    expect(refused.ok).toBe(false);
    // The phase is unchanged, so the correct answer still lands.
    expect(must(answer(parked, [...parkedPrompt(parked).candidates].reverse()))).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 redaction — the deck's OWNER must not learn their own top", () => {
  it("🛑 the OPPONENT's projection carries no card identity from the prompt", () => {
    // The strongest confidentiality claim this op makes: on three of the four
    // printings the seat whose deck it is must not see what the looker saw. If
    // this rung fails the failure is a LEAK, not a red board.
    const parked = attack(seededOpp(89, 5)).state;
    const prompt = parkedPrompt(parked);
    const victimView = redactGame(parked, "p2");
    const serialized = JSON.stringify(victimView);
    for (const uid of prompt.candidates) {
      expect(serialized).not.toContain(uid);
    }
  });

  it("the ANSWERER's projection carries the full ordered window", () => {
    const parked = attack(seededOpp(97, 5)).state;
    const prompt = parkedPrompt(parked);
    const view = redactGame(parked, "p1");
    const wire = view.phase.kind === "effect:choose" ? view.phase.prompt : null;
    if (wire === null || wire.kind !== "orderCards") throw new Error("no orderCards prompt");
    expect(wire.candidates.map((c: { id: string }) => c.id)).toEqual([...prompt.candidates]);
    // ORDER-PRESERVING: the redactor must not sort or group, because the order it
    // passes through is the state the player is reordering FROM.
    expect(wire.candidates.every((c: { name: string }) => typeof c.name === "string")).toBe(true);
  });

  it("the own-deck arm reaches its own controller unchanged", () => {
    const parked = attack(seededOwn(101)).state;
    const view = redactGame(parked, "p1");
    const wire = view.phase.kind === "effect:choose" ? view.phase.prompt : null;
    if (wire === null || wire.kind !== "orderCards") throw new Error("no orderCards prompt");
    expect(wire.candidates).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 the event and its log row — count-only, and the voice follows the actor", () => {
  it("`seat` is the DECK'S OWNER and `actor` is the looker, on the opponent arm", () => {
    const { events } = attack(seededOpp(103, 5));
    const row = find(events, "DECK_TOP_REORDERED");
    expect(row).toEqual({ type: "DECK_TOP_REORDERED", seat: "p2", actor: "p1", count: 5 });
  });

  it("on the own-deck arm the two seats coincide", () => {
    const { events } = attack(seededOwn(107));
    const row = find(events, "DECK_TOP_REORDERED");
    expect(row).toEqual({ type: "DECK_TOP_REORDERED", seat: "p1", actor: "p1", count: 4 });
  });

  it("🛑 the row names NO card — the whole confidentiality rule in one assertion", () => {
    const { state: parked, events } = attack(seededOpp(109, 5));
    const row = find(events, "DECK_TOP_REORDERED");
    if (row === undefined) throw new Error("no row");
    const serialized = JSON.stringify(row);
    for (const uid of parkedPrompt(parked).candidates) {
      expect(serialized).not.toContain(uid);
    }
  });

  it("the log VOICE is ACTIVE for the own-deck look and PASSIVE for the opponent's", () => {
    // D153's rule, and this op is the first for which both voices are reachable
    // from the printed text rather than from a field.
    //
    // ⚠️ THE NAME IS NOT IN THE SEGMENTS. Rows are SEAT-keyed and the seat→name
    // relabel is the render layer's job (log.ts's own header says so), so the
    // assertion pairs the seat with the wording — asserting "Ash looked" would
    // have been testing `viewLogEntries`, in the wrong package.
    const own = logRows(attack(seededOwn(113)));
    expect(own).toContainEqual([
      "p1",
      "looked at the top 4 cards of their deck and put them back in a chosen order",
    ]);
    const opp = logRows(attack(seededOpp(127, 5)));
    expect(opp).toContainEqual([
      "p2",
      "had the top 5 cards of their deck looked at and put back in a chosen order",
    ]);
    // The row is filed under the VICTIM and never credits them with the action.
    expect(opp.some(([seat, text]) => seat === "p2" && text.startsWith("looked"))).toBe(false);
  });

  it("the row singularises at a count of 1", () => {
    expect(
      logRows(attack(seededOpp(131, 1)))
        .map(([, t]) => t)
        .join("\n"),
    ).toContain("top 1 card of their deck");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§8 the census arithmetic this row is accountable for", () => {
  it("FOUR legal printings on TWO sentences, and the two sums agree", () => {
    // (b)'s split re-added against its own total: 1 own-deck + 3 opponent-deck = 4.
    const own = LEGAL_IDS.filter((id) => {
      const card = LOCAL_CARDS[id];
      return card?.category === "Pokemon" && card.attacks?.[0]?.effect === PRINTED_OWN;
    });
    const opp = LEGAL_IDS.filter((id) => {
      const card = LOCAL_CARDS[id];
      return card?.category === "Pokemon" && card.attacks?.[0]?.effect === PRINTED_OPP;
    });
    expect(own).toHaveLength(1);
    expect(opp).toHaveLength(3);
    expect(own.length + opp.length).toBe(LEGAL_IDS.length);
  });

  it("every id derives, so the raw summand steps by exactly the printing count", () => {
    // The raw summand is READER-keyed over the committed legal corpus, so it moves
    // by the number of legal printings whose text these readers now resolve — 4.
    const resolved = LEGAL_IDS.filter((id) => {
      const card = LOCAL_CARDS[id];
      if (card?.category !== "Pokemon") return false;
      const effect = card.attacks?.[0]?.effect;
      return effect !== undefined && deriveAttackEffect(effect) !== null;
    });
    expect(resolved).toHaveLength(4);
  });

  it("the engine version has moved PAST D341's bump and the anchor has moved on", () => {
    // 🆕 D342 — RE-POINTED, not deleted. This rung was D341's "the version moved
    // with the op, in the same commit"; the live anchor now lives in
    // `derivedSearchTopOrder.test.ts` beside the slice that owns the current
    // number, and what survives here is the weaker, PERMANENT claim: whatever the
    // version is, it is not below the one this file's op shipped in. A file that
    // pins an exact version it does not own goes red on every later slice for a
    // reason that has nothing to do with its own subject.
    expect(engineVersion >= "0.247.0").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§9 this suite adds NOTHING to the shared fixture pool", () => {
  it("🛑 every local id is absent from `FIXTURE_POOL`", () => {
    // D275's idiom, and here it is what keeps `catalogManifest`'s six-set
    // classification and `raw.length` standing still: `sv05`, `sv10` and
    // `sv10.5w` are none of the manifest's sets, so a shared-pool body would owe
    // a `fix-*` demonstrator key.
    // 🛑 **D343 — TWO STALE FIGURES REMOVED FROM THIS NOTE, ONE OF THEM ROTTEN
    // BEFORE D343 TOUCHED ANYTHING.** It read "`revealClause`'s `swept.size`
    // (27) and `raw.length` (672)". `raw.length` has been **675** since D342 and
    // nothing reddened, because a number in a comment is not a rung. And
    // `swept.size` is now **103** on a population of `registryCardIds()` ∪ the
    // pool, so staying out of `FIXTURE_POOL` no longer keeps this suite out of
    // that sweep at all. Both figures are dropped rather than re-pinned — the
    // assertions that own them live in `censusAtHead` and `revealClause`.
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });

  it("the four real catalog ids are real ids and not `fix-*` keys", () => {
    for (const id of LEGAL_IDS) {
      expect(id.startsWith("fix-")).toBe(false);
    }
  });
});

// ── helpers used above, defined after the suites they serve ─────────────────

/** 🛑 TRUNCATE `seat`'s deck to its OWN first `size` uids. Seeding by CARD ID was
    the first draft and it was seed-fragile: which copies of a filler survive the
    opening hand and the six prizes depends on the rng, so `uidFor` threw on some
    seeds and not others. Uids are distinct BY CONSTRUCTION, and every ordering
    assertion in this file compares uids, so taking the deck's own head is both
    robust and strictly more faithful — the window under test is a real dealt
    deck's real top. */
function seedDeck(state: GameState, seat: Seat, size: number): GameState {
  const deck = state.players[seat].deck;
  if (deck.length < size) throw new Error(`${seat}'s deck is shorter than ${String(size)}`);
  return setDeck(state, seat, deck.slice(0, size));
}

/** A board where p1 attacks with Iron Valiant over a six-card own deck. */
function seededOwn(seed: number): GameState {
  return seedDeck(board(seed, IRON_VALIANT), "p1", 6);
}

/** A board where p1 attacks with `attacker` (an opponent-deck printing) over a p2
    deck truncated to exactly `size` cards. */
function seededOpp(seed: number, size = 5, attacker: string = GOTHORITA_A): GameState {
  return seedDeck(board(seed, attacker), "p2", size);
}

/** Every action row as a `[seat, text]` pair — rows are SEAT-keyed in this
    package and the name only appears at render time. */
function logRows(run: { state: GameState; events: readonly GameEvent[] }): [string, string][] {
  const ctx: LogContext = { names: { p1: "Ash", p2: "Gary" }, state: run.state, elapsed: "+00:00" };
  return logFromEvents(run.events, ctx).flatMap((r) =>
    r.kind === "action"
      ? [[r.who, r.segments.map((seg) => seg.text).join("")] as [string, string]]
      : [],
  );
}
