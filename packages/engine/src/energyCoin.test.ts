import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { EffectPrompt, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf, specialEnergy, trainerCard, typedEnergy } from "./testFixtures";

// D355 — ENERGY COIN, AND THE ONE THING IT BUYS: `coinFlipGate.coins`, THE
// PRINTED COIN COUNT WITH AN ALL-HEADS READING.
//
// "Flip 2 coins. If both of them are heads, search your deck for a Basic Energy
//  card and attach it to 1 of your Pokémon. Then, shuffle your deck."
//                  (Energy Coin sv10.5b-081 — an Item, 1 Standard-legal printing)
//
// ── THE CENSUS, RE-VERIFIED RATHER THAN COPIED ──────────────────────────────
// The clause *"both of them are heads"* over ALL THREE text columns (remote D1
// `luminous` `735f0fb5-…`, 2026-08-16):
//     effect          2 printings / 2 sentences / **1 legal**
//     attacks_json    4 printings / 3 sentences /   0 legal
//     abilities_json  0
//     ─────────────────────────────────────────────────────
//     total           6 printings / 5 sentences / **1 legal**
// and the ONE legal printing IS this card. Row 10's remaining half is therefore
// again *the entire Standard-legal population of its clause*, for the fourth
// slice running. D354's figure reproduced exactly.
//
// ⚠️ **THE EXTRACTOR WAS CONTROLLED AND THE FIRST CUT WAS WRONG, WHICH IS THE
// WHOLE REASON THE CONTROL IS MANDATORY.** `json_extract(value,'$.text')` over
// `attacks_json` returned **ZERO ROWS** and looked like a clean answer; a raw
// `attacks_json LIKE '%both of them are heads%'` control returned FOUR. The
// attack text key is **`$.effect`**, the same key the resume point warns about
// for abilities. A false zero in a census is invisible: it reads as "nothing
// else prints this", which is the conclusion the slice is trying to reach.
//
// ── STEP 3: THE SENTENCE THE SENTENCE RESTS ON ──────────────────────────────
// *"Flip 2 coins"* over all three columns is **63 printings / 25 sentences / 40
// legal** (2/2/1 + 59/21/38 + 2/2/1) — but almost all of the attack column is
// `deriveAttackCoinFlip`'s `perHeads` family, read by a DIFFERENT reader in front
// of the §8.5 pipeline (`attack.ts` never reads `coinFlipGate`). In the two
// columns this op actually serves, the all-heads GATE family is `%are heads%` =
// **2 printings / 1 sentence shape / 1 legal**: Delivery Drone `sv02-178`
// (rotated) and this card. There is no 3-coin all-heads form outside attack text.
//
// ── STEP 4: IS THIS THE CHEAPEST THING THAT SENTENCE BUYS? ──────────────────
// **IT IS THE ONLY THING**, for the fourth slice running.
//
// ── ⚠️ THE `mutants.ts` SCAN CAME BACK **FULL**, SO REPAIRS WERE OWED ────────
// A byte-range overlap of every mutant `find` against the function this slice
// edits, **with the extractor verified against two known-present controls
// first** (`ownerNoun`'s body → `D204-ownerNoun`; `switchBenchNarrowing` → four
// D273 rows):
//     runProgram body  (interpreter.ts 39651–43814)  D269-otherwise-is-never-spliced
//                                                    D269-arms-are-swapped
//                                                    D269-both-arms-run
// 🛑 **AND THE FIRST EXTRACTOR WAS BROKEN AND THE CONTROLS ARE WHAT CAUGHT IT.**
// Balancing braces from the first `{` after the marker closes on
// `record: EffectRecord = {}` **in the parameter list** — it reported a 478-byte
// `runProgram` body and **NONE**. Control 2 came back empty and exposed it; the
// fix balances the parameter parens first. **AN OVERLAP SCRIPT THAT SILENTLY
// MATCHES NOTHING LOOKS EXACTLY LIKE GOOD NEWS** (D354's warning, paid).
// **THE REPAIRS CAME TO ZERO**, and by construction rather than by luck: all
// three rows quote ONE line, the ternary that picks the arm, and this slice
// widens `face` (to "the unanimous face, or `null` when the coins disagree")
// instead of replacing the comparison with a predicate. The line stands byte for
// byte and the corpus-wide anchor loop returned 0 of 1060 after the edit.
//
// ── THE ENGINE DIFF, AND WHY IT IS ONE KEY AND NOT TWO ──────────────────────
//   • `coinFlipGate.coins?: number` — ABSENT means ONE (D104/D135's minimal
//     shape). A SECOND key (`coins` + `requireAllHeads`) is refused by this
//     repo's standing rule: two keys on one axis can be set to contradict —
//     `coins: 1, requireAllHeads: true` — and no reading of any print says what
//     that means. The precedent for one key widened is on this very op TWICE
//     (`onTails` D144, `otherwise` D269).
//   • `runProgram` takes N flips, files N `ATTACK_EFFECT_COIN_FLIP` rows in
//     printed order, and then reads the unanimous face.
// ZERO new ops, prompt kinds, choice kinds, events, error codes, `GameState`
// fields, `CardFilter` members, regexes, deriver arms or `programPlayable` arms.
// `MATCH_RECORD_VERSION` **STAYS 21** — D144's shape exactly.
//
// ⚠️ **WHAT THIS SUITE CAN AND CANNOT PUT RED, SAID UP FRONT** (the guard rule):
// * Ignoring `coins` (flipping once) is caught by §1, which counts the coin rows.
// * Reading the count but filing ONE summary row is caught by §1 too — the rows
//   are counted, not the verdict.
// * ANY-heads instead of ALL-heads is caught by §2, whose sweep drives boards
//   whose faces are HT and TH and asserts the whiff on both.
// * Reading only the FIRST coin is caught by §2's TH board; reading only the
//   LAST is caught by its HT board. **Neither is reachable from an all-heads or
//   an all-tails board**, which is why §2 asserts its own coverage of all four
//   face pairs before believing itself.
// * Swapping the arms is caught by §2, stated against the faces read off the
//   SAME log rather than against a chosen seed (D269's idiom).
// * Hoisting `shuffleDeck` out of the gate is caught by §5 — a losing flip files
//   NO shuffle row, which is `POKE_BALL`'s ruling driven rather than quoted.
// * Widening the attach's `max` is caught by §4; narrowing its filter to one
//   Energy type is caught by §4's two differently-typed Basic Energy.
// * Adding a `targetType`/`benchOnly` the card does not print is caught by §4,
//   which asserts the Active IS offered.
// * A regression on the ONE-coin form (every gate authored before this slice) is
//   caught by §3, which drives two REAL registry cards and counts their rows.

const ENERGY_COIN = "sv10.5b-081";

/** 🆕 D357 — D356's id, named here ONLY so §6's ordering rung has a NAME to be
    ahead of rather than a `raw.length` it cannot fail against. **A CARRIED ID
    ROTS** (D353's `sv09-160`): `sv09-107` is Magearna, verified against the
    registry's own key set by §6's `indexOf`, which returns -1 for a wrong id and
    would make that rung red rather than silently true. */
const MAGEARNA = "sv09-107";

/** The printed sentence, byte for byte off the remote D1 (2026-08-16), authored
    against the print rather than a paraphrase (D183's class). */
const ENERGY_COIN_TEXT =
  "Flip 2 coins. If both of them are heads, search your deck for a Basic Energy " +
  "card and attach it to 1 of your Pokémon. Then, shuffle your deck.";

/** ⚠️ **REAL IDS ON A LOCAL `cardPool` (D275's idiom), AND `FIXTURE_POOL` IS NOT
    TOUCHED** — for the FIFTEENTH slice running. `catalogManifest.ts` measures a
    **978-row / 6-set** local catalog (sv01/sv02/sv03/sv06.5/sve/swsh10.5) holding
    no `sv10.5b` row at all, so a shared-pool body would owe a `fix-*` key AND a
    manifest classification, where a LOCAL pool owes neither. **A FIXTURE IS A
    CENSUS POPULATION** (D348) — §6 asserts BY ID that nothing here reached it.
    ⚠️ **AND THE GUARD COVERS EVERY ID THIS SUITE NAMES, NOT THE ONE IT IS ABOUT**
    (D354's defect (D), which D354 itself reproduced on its supporting bodies): §6
    checks every local id against BOTH `FIXTURE_POOL` and `registryCardIds()`.
    ⚠️ **A CARRIED ID ROTS, INCLUDING FROM MEMORY** — D353 wrote `sv09-160` for
    Mist Energy and D1 said that id is **Maractus**. The one real id below was read
    out of the remote D1 in the session that wrote this file, with its `category`,
    `trainer_type` and `set_id` (Trainer / Item / sv10.5b). */
const BODY = "d355-body"; // the Active — a plain Basic, no program, no types claim
const BENCHED = "d355-benched"; // a second target, so "1 of your Pokémon" is a CHOICE
const WATER = "d355-water-energy"; // Basic Energy — the filter is UNQUALIFIED,
const FIRE = "d355-fire-energy"; // …so TWO different types must both be offered
const SPECIAL = "d355-special-energy"; // a SPECIAL Energy — must never be offered
const FILLER = "d355-filler"; // a Pokémon in the deck — must never be offered

const LOCAL_CARDS: Record<string, Card> = {
  [ENERGY_COIN]: trainerCard(ENERGY_COIN, "Item", ENERGY_COIN_TEXT),
  [BODY]: battler(BODY, { name: "D355 Body", hp: 70, types: ["Water"] }),
  [BENCHED]: battler(BENCHED, { name: "D355 Benched", hp: 80, types: ["Fire"] }),
  [WATER]: typedEnergy(WATER, "Water"),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [SPECIAL]: specialEnergy(SPECIAL, "D355 Special Energy"),
  [FILLER]: battler(FILLER, { name: "D355 Filler", hp: 60, types: ["Colorless"] }),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [ENERGY_COIN]: 4,
  [BODY]: 12,
  [BENCHED]: 8,
  [WATER]: 8,
  [FIRE]: 8,
  [SPECIAL]: 8,
  [FILLER]: 12,
});

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const BENCH_0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
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

/** TEST SURGERY — p1 holds exactly ONE Energy Coin, has a named Active and one
    benched body, and p1's DECK is exactly `deck` (everything else goes
    underneath). ⚠️ THE NAMED CARDS ARE THE WHOLE SEARCHABLE DECK: `attachFromDeck`
    offers every match in the deck, so a stray Basic Energy left behind would
    silently widen the candidate list and make §4's cap vacuous. */
function board(seed: number, deck: readonly string[]): GameState {
  const state = localSetup(seed);
  const side = state.players.p1;
  const rest = [...side.deck, ...side.hand];
  const take = (cardId: string): string => {
    const uid = rest.find((u) => state.cardIdByUid[u] === cardId);
    if (uid === undefined) throw new Error(`p1 has no ${cardId}`);
    rest.splice(rest.indexOf(uid), 1);
    return uid;
  };
  const coin = take(ENERGY_COIN);
  const activeUid = take(BODY);
  const benchUid = take(BENCHED);
  const deckUids = deck.map(take);
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, hand: [coin], deck: deckUids, active: body(activeUid), bench: [body(benchUid)] },
    },
  };
}

function play(state: GameState): { state: GameState; events: GameEvent[] } {
  const uid = state.players.p1.hand[0];
  if (uid === undefined) throw new Error("p1 holds nothing");
  const result = applyAction(state, { type: "playTrainer", seat: "p1", uid });
  if (!result.ok) throw new Error(`playTrainer failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

/** EVERY face this program filed, IN PRINTED ORDER — the whole subject of §1 and
    the thing every assertion in §2 is stated against (D269's idiom: read the face
    off the SAME log, never off a chosen seed). */
function facesOf(events: readonly GameEvent[]): string[] {
  return events
    .filter((e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_COIN_FLIP" }> =>
      e.type === "ATTACK_EFFECT_COIN_FLIP",
    )
    .map((e) => e.result);
}

function typesOf(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "attachCards") {
    throw new Error(`expected attachCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function attach(
  state: GameState,
  assignments: { uid: string; to: PokemonRef }[],
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  });
  if (!result.ok) throw new Error(`resolveEffect failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

/** The card NAMES of the Energy on a body, so an assertion reads as the print
    does rather than as a uid list. */
function energyNamesOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const spot = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (spot?.energy ?? []).map((uid) => POOL[state.cardIdByUid[uid] ?? ""]?.name ?? "?");
}

const SEEDS = Array.from({ length: 220 }, (_, i) => i + 1);
const DEFAULT_DECK = [WATER, FIRE, SPECIAL, FILLER];

// ── 1. THE COUNT IS THE PRINTED COUNT, AND EVERY FLIP IS ANNOUNCED ───────────

describe("D355 §1 — `coins` is how many coins the sentence prints", () => {
  it("🛑 files EXACTLY TWO coin rows on every board — not one, and not a verdict", () => {
    // ⚠️ THE ROWS ARE COUNTED, NOT THE OUTCOME. A build that read `coins` to decide
    // the branch but filed one summary row would be green on every outcome
    // assertion in this file and would make "heads then tails" and "both heads"
    // indistinguishable in the history. "Flip 2 coins" is TWO coins of public
    // information, so it is two rows in printed order.
    const widths = new Set<number>();
    for (const seed of SEEDS) {
      const { events } = play(board(seed, DEFAULT_DECK));
      const faces = facesOf(events);
      widths.add(faces.length);
      for (const face of faces) expect(["heads", "tails"]).toContain(face);
      expect(events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP").every((e) => e.seat === "p1")).toBe(true);
    }
    expect([...widths]).toEqual([2]);
  });
});

// ── 2. ALL-HEADS, AND THE TWO MIXED PAIRS THAT ARE THE WHOLE POINT ───────────

describe("D355 §2 — the branch runs IFF the coins are unanimous on heads", () => {
  it("🛑 the four face pairs, each driven — and the coverage asserted BEFORE the verdict", () => {
    // 🛑 **WITHOUT THE COVERAGE ASSERTION THE WHOLE SWEEP IS VACUOUS**, and it is
    // vacuous in a way that looks green: an ANY-heads build is correct on HH and on
    // TT, a FIRST-coin-only build is correct on HH/TT/HT, and a LAST-coin-only build
    // is correct on HH/TT/TH. The mixed pairs are the ONLY witnesses that separate
    // the four readings, so the pairs actually reached are asserted as a SET before
    // any conclusion is drawn from the sweep.
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = board(seed, DEFAULT_DECK);
      const { state: after, events } = play(state);
      const faces = facesOf(events);
      seen.add(faces.join("-"));
      const allHeads = faces.every((f) => f === "heads");
      // The gate's ONLY observable: did the search happen? `attachFromDeck` parks,
      // so an all-heads board is in `effect:choose` and every other board is not.
      expect(after.phase.kind === "effect:choose").toBe(allHeads);
      // …and the shuffle rides the same arm (§5 states this as its own claim).
      expect(typesOf(events).includes("SHUFFLE")).toBe(false);
    }
    expect(seen).toEqual(
      new Set(["heads-heads", "heads-tails", "tails-heads", "tails-tails"]),
    );
  });

  it("🛑 HEADS-then-TAILS whiffs — the witness against reading only the FIRST coin", () => {
    const board_ = firstBoardWithFaces(["heads", "tails"]);
    expect(board_.state.phase.kind).not.toBe("effect:choose");
    expect(typesOf(board_.events)).not.toContain("SHUFFLE");
  });

  it("🛑 TAILS-then-HEADS whiffs — the witness against reading only the LAST coin", () => {
    const board_ = firstBoardWithFaces(["tails", "heads"]);
    expect(board_.state.phase.kind).not.toBe("effect:choose");
    expect(typesOf(board_.events)).not.toContain("SHUFFLE");
  });

  it("TAILS-TAILS whiffs too — unanimity alone is not the clause", () => {
    // ⚠️ THE ONE A "the coins agree" BUILD GETS WRONG. Unanimity is necessary and
    // not sufficient: the print names the FACE. An all-tails board is agreement on
    // the losing face and must whiff exactly as a mixed board does — the same arm,
    // for a different reason, which is what `onTails` would invert.
    const board_ = firstBoardWithFaces(["tails", "tails"]);
    expect(board_.state.phase.kind).not.toBe("effect:choose");
  });

  it("HEADS-HEADS parks on the attach — driven to the Energy actually landing", () => {
    const board_ = firstBoardWithFaces(["heads", "heads"]);
    const prompt = promptOf(board_.state);
    const pick = prompt.candidates[0] as string;
    const { state: done } = attach(board_.state, [{ uid: pick, to: ACTIVE }]);
    expect(energyNamesOn(done, ACTIVE)).toHaveLength(1);
  });
});

/** The FIRST seed in `SEEDS` whose program filed exactly `faces` — so every case
    above is driven on a real board rather than on a stubbed event list, and the
    seed is a RESULT rather than a constant somebody has to keep true. */
function firstBoardWithFaces(faces: readonly string[]): {
  state: GameState;
  events: GameEvent[];
} {
  for (const seed of SEEDS) {
    const played = play(board(seed, DEFAULT_DECK));
    if (facesOf(played.events).join("-") === faces.join("-")) return played;
  }
  throw new Error(`no seed in SEEDS produced ${faces.join("-")}`);
}

// ── 3. THE ONE-COIN FORM IS UNCHANGED, AND IT IS DRIVEN ──────────────────────

describe("D355 §3 — absent `coins` is ONE coin, byte for byte", () => {
  it("🛑 every gate authored before this slice still takes exactly one flip", () => {
    // ⚠️ **THE REGRESSION THIS WIDENING COULD HAVE CAUSED, DRIVEN RATHER THAN
    // ARGUED.** `coins` is optional and `?? 1` is the whole of its default, so the
    // claim "the widening is invisible to every existing program" rests on ONE
    // expression. Two REAL registry cards whose programs carry a bare
    // `coinFlipGate` are asserted by id: Poké Ball `sv01-185` and Pokémon Catcher
    // `sv01-178`. Both are registry keys TODAY (measured here, not recalled), so a
    // build that defaulted to 2 — or that made `coins` required — is red by name.
    for (const id of ["sv01-185", "sv01-178"]) {
      expect(programFor(id)).toBeDefined();
    }
    const program = programFor("sv01-185");
    const gate = program?.trainer?.[0];
    expect(gate?.op).toBe("coinFlipGate");
    // ABSENT rather than `1` — D104/D135's minimal shape, and the reason the
    // default is invisible to `toEqual` comparisons against hand-authored rows.
    expect(gate !== undefined && "coins" in gate).toBe(false);
  });

  it("this card's authored row spells `coins: 2` and nothing else new", () => {
    const program = programFor(ENERGY_COIN);
    expect(program).toBeDefined();
    const gate = program?.trainer?.[0];
    // `toEqual`, not `toMatchObject` — D269's lesson on the OTHER optional field:
    // a `toMatchObject` cannot see an extra key, and `onTails` here would silently
    // make the card fire on double TAILS while every count assertion stayed green.
    expect(gate).toEqual({
      op: "coinFlipGate",
      coins: 2,
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable (arrays are not callable).
      then: [
        { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1 },
        { op: "shuffleDeck" },
      ],
    });
    // …and the whole program is that ONE gate: no second sentence, no trailing op.
    expect(program?.trainer).toHaveLength(1);
  });
});

// ── 4. THE ATTACH HALF — ALREADY BUILT, AND PINNED SO IT STAYS THAT WAY ──────

describe("D355 §4 — 'a Basic Energy card' to '1 of your Pokémon'", () => {
  it("offers BOTH Basic Energy types and neither the Special nor the Pokémon", () => {
    // The filter is UNQUALIFIED — "a Basic Energy card", no type named — so a build
    // that copied X-Boot's `energyType` rider from one door down is red here. The
    // Special Energy and the Pokémon in the same deck are the negative half.
    const board_ = firstBoardWithFaces(["heads", "heads"]);
    const prompt = promptOf(board_.state);
    const names = prompt.candidates
      .map((uid) => POOL[board_.state.cardIdByUid[uid] ?? ""]?.name ?? "?")
      .sort();
    expect(names).toEqual(["Fire Energy", "Water Energy"]);
  });

  it("attaches at most ONE, and the ACTIVE is an eligible target", () => {
    // "attach **it** to **1** of your Pokémon" — `max: 1` and NO target rider, so
    // the Active is in the set (a `benchOnly` copied from a neighbour is red here)
    // and the benched body is too.
    const board_ = firstBoardWithFaces(["heads", "heads"]);
    const prompt = promptOf(board_.state);
    expect(prompt.max).toBe(1);
    expect(prompt.targets).toEqual([ACTIVE, BENCH_0]);
  });

  it("the Energy lands on the BENCHED body when that is the answer", () => {
    const board_ = firstBoardWithFaces(["heads", "heads"]);
    const prompt = promptOf(board_.state);
    const pick = prompt.candidates[0] as string;
    const { state: done, events } = attach(board_.state, [{ uid: pick, to: BENCH_0 }]);
    expect(energyNamesOn(done, BENCH_0)).toHaveLength(1);
    expect(energyNamesOn(done, ACTIVE)).toEqual([]);
    expect(typesOf(events)).toContain("SHUFFLE");
  });

  it("a deck holding NO Basic Energy is a live path — it whiffs into the shuffle", () => {
    // `attachFromDeck` has NO `programPlayable` gate, by its own doc: the card
    // prints "Then, shuffle your deck", a clause that always resolves, so "no
    // eligible card" is never "no effect" (ruling/284). The Item is still spent.
    for (const seed of SEEDS) {
      const played = play(board(seed, [SPECIAL, FILLER]));
      if (facesOf(played.events).join("-") !== "heads-heads") continue;
      expect(played.state.phase.kind).not.toBe("effect:choose");
      expect(typesOf(played.events)).toContain("SHUFFLE");
      return;
    }
    throw new Error("no seed in SEEDS produced heads-heads");
  });
});

// ── 5. THE SHUFFLE IS INSIDE THE GATE — POKÉ BALL'S RULING, DRIVEN ───────────

describe("D355 §5 — a losing flip does not touch the deck", () => {
  it("🛑 NO shuffle row on any board that is not all-heads", () => {
    // `POKE_BALL`'s ruling, already in `registry.ts`: the search AND the shuffle are
    // both gated, because on the losing face nothing was searched. ⚠️ THIS IS NOT
    // COSMETIC ON A SEEDED ENGINE — the deck ORDER is the next draw, so hoisting
    // `shuffleDeck` out of the gate changes what the player draws next turn on
    // three boards out of four. A build that hoisted it is red on every row here.
    let losing = 0;
    for (const seed of SEEDS) {
      const { state: after, events } = play(board(seed, DEFAULT_DECK));
      if (facesOf(events).join("-") === "heads-heads") continue;
      losing += 1;
      expect(typesOf(events)).not.toContain("SHUFFLE");
      // …and the deck is byte-identical, which is the claim the row NAME makes.
      expect(after.players.p1.deck).toEqual(board(seed, DEFAULT_DECK).players.p1.deck);
    }
    expect(losing).toBeGreaterThan(0);
  });
});

// ── 6. THE FIXTURE IS A CENSUS POPULATION, AND THE BATON ─────────────────────

describe("D355 §6 — the pool, the registry keys, and the expiring insertion-order pin", () => {
  it("🛑 THE BATON WAS HANDED ON AT D356 — this is now a CONTIGUITY claim", () => {
    // (D347 → D349 → D350 → D351 → D352 → D353 → D354 → this file.)
    // `censusAtHead`'s `raw[raw.length - 1]` is keyed on INSERTION ORDER and has
    // gone red on a constant nobody touched THIRTEEN consecutive times. **No grep
    // of any census FIGURE NAME reaches it** — only a grep of `registry.ts`'s
    // id-map tail does.
    // ⚠️ **THE WIDTH IS `slice(-1)`.** The width is the number of ids the LAST
    // slice added, and D355 added exactly ONE. Copying a previous width is how a
    // pin silently starts asserting a neighbour's row.
    // ⚠️ It is SPENT the moment the next registry row lands, which is what it is
    // for. **Re-point it; do not delete it** — the CONTIGUITY claims in
    // `remainingHpWindow.test.ts` §6, `invitingWink.test.ts` §7,
    // `pyroDance.test.ts` §7, `metalMaker.test.ts` §8, `spikeClad.test.ts` §8 and
    // now `xBoot.test.ts` §6 are a DIFFERENT assertion and do not substitute.
    //
    // 🆕🆕 **D356 SPENT IT, AND RE-POINTED IT RATHER THAN DELETING IT.** It went
    // red at `['sv09-107']` — the FOURTEENTH consecutive slice on which this
    // constant expires without being touched, and the tenth on which that was
    // predicted before the run. The LIVE expiring pin now sits in
    // `autoHeal.test.ts` §7 at width **1** (D356 added exactly ONE id,
    // `sv09-107`). What stays here is the PERMANENT half — the claim that this
    // slice's one id is a CONTIGUOUS block at the position it was inserted, which
    // is true forever and cannot expire. This file joins the six that stand still:
    // `remainingHpWindow.test.ts` §6, `invitingWink.test.ts` §7,
    // `pyroDance.test.ts` §7, `metalMaker.test.ts` §8, `spikeClad.test.ts` §8 and
    // `xBoot.test.ts` §6.
    // ⚠️ **THE TWO KINDS ARE DIFFERENT ASSERTIONS AND NEITHER SUBSTITUTES FOR THE
    // OTHER**: a contiguity claim never goes red on a neighbour's insert, which is
    // exactly what makes it useless as a tripwire and permanent as a fact.
    //
    // 🆕🛑 **D357 — WHAT STOOD HERE WAS A PAIR OF TAUTOLOGIES AND THEY ARE
    // REPLACED, NOT DELETED.** The claim in the comment was real; the assertions
    // under it could not fail:
    //   `expect(raw.slice(at, at + 1)).toEqual([ENERGY_COIN])` with
    //   `at = raw.indexOf(ENERGY_COIN)` is true for ANY array containing the id,
    //   and `expect(at).toBeLessThan(raw.length)` is true for any `at >= 0`.
    // ⚠️ **A WIDTH-1 CONTIGUITY CLAIM HAS NO CONTENT** — one element is always a
    // contiguous block. The permanent claims that DO have content assert a
    // NEIGHBOUR (`metalMaker.test.ts` §8 spans 3 slots for 2 of its own ids) or a
    // width of 2+ (`spikeClad.test.ts` §8, `pyroDance.test.ts` §7). This slice
    // added exactly ONE id, so the honest permanent claim here is an ORDERING one.
    // ⚠️ **AND THE SAME TAUTOLOGY PAIR WAS COPIED INTO `xBoot.test.ts` §6** — D355
    // wrote the pattern when it took the baton, D356 copied it forward, and the
    // review named ONE site. Both are repaired. **A RUNG THAT READS AS COVERAGE
    // AND ISN'T IS WORSE THAN NO RUNG**, because it is what stops the next reader
    // from looking.
    const raw = registryCardIds();
    const at = raw.indexOf(ENERGY_COIN);
    expect(at).toBeGreaterThanOrEqual(0);
    // 1. THE BATON REALLY DID MOVE ON: this id is no longer the TAIL of the map.
    //    ⚠️ This was FALSE the day D355 shipped it — which is exactly what makes
    //    it an assertion rather than a decoration.
    expect(at).toBeLessThan(raw.length - 1);
    // 2. …and it is ahead of D356's id, which is what *"ahead of everything D356
    //    and later appended"* means with a name in it rather than a `raw.length`.
    expect(at).toBeLessThan(raw.indexOf(MAGEARNA));
  });

  it("🛑 the +1 on `raw.length` is EXACTLY this one id — the ONLY real id here", () => {
    const keys = new Set(registryCardIds());
    expect(keys.has(ENERGY_COIN)).toBe(true);
    expect(registryCardIds().filter((id) => id === ENERGY_COIN).length).toBe(1);
    // ⚠️ D353's defect (D), and D354's sharpening of it: the guard must cover every
    // id the SUITE names, not the one it is ABOUT. D354's first draft reached for
    // `sv02-097`, which was already a `FIXTURE_POOL` member AND already a registry
    // key carrying a live `passive`. Every supporting body here is synthetic
    // (D351's `d351-fighter` idiom) and every one is asserted against BOTH.
    for (const id of Object.keys(LOCAL_CARDS)) {
      if (id === ENERGY_COIN) continue;
      expect(keys.has(id)).toBe(false);
    }
  });

  it("nothing this suite defines reached `FIXTURE_POOL` — asserted by ID", () => {
    // **A FIXTURE IS A CENSUS POPULATION** (D348). `catalogManifest.test.ts` and
    // `clauseApostrophe.test.ts` sweep `FIXTURE_POOL`, and `sv10.5b` is not among
    // `catalogManifest`'s six sets, so a shared-pool body would have owed a
    // `fix-*` key AND a manifest classification. The local pool owes neither.
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });
});

// ── 7. THE CENSUS, PINNED AS THE NEGATIVES IT ACTUALLY IS ────────────────────

describe("D355 §7 — what row 10's closure leaves behind", () => {
  it("🛑 ROW 10 IS CLOSED — both halves of it are now built", () => {
    // The ability half closed at D354 (Steven's Metagross ex `sv10-145`), the
    // `effectIds` half closes here. `censusAtHead`'s `ROWS` non-attack total falls
    // 7 → 6 and row 10's own residue is 0.
    expect(programFor("sv10-145")).toBeDefined();
    expect(programFor(ENERGY_COIN)).toBeDefined();
  });

  it("🛑 row 12's ability half is BUILT — this negative is SPENT", () => {
    // ⚠️ **RECORDED AS SPENT RATHER THAN REWRITTEN TO NAME A DIFFERENT BLOCKER**
    // (xBoot.test.ts §5's idiom, and the rule this page keeps naming).
    // This assertion read `toBeUndefined()` and said *"`triggers.ts` has no such
    // trigger point, for 1 legal printing"*. **THE RATIO WAS RIGHT AND THE PRICE
    // WAS WRONG, AND THEY ARE DIFFERENT CLAIMS.** The population really is one
    // legal printing — D356 re-censused it and got the same 3 / 0 / 0 with 1 legal.
    // But `onEnergyAttach` had been a `TriggerTiming` since D319, the moment was
    // already fired at turn.ts §6.2, `triggersOf` had partitioned self/opponent,
    // and `activeOnly` predates all of it — so the "whole new trigger point" this
    // line priced was machinery already standing. What was actually owed was a
    // self-direction sweep and one new op. **A REFUSAL INHERITED IS NOT A
    // MEASUREMENT.** The suite that owns this card is `autoHeal.test.ts`.
    expect(programFor("sv09-107")).toBeDefined();
  });

  it("🛑 the LIVE residue is now ONE, and row 9's five are not it", () => {
    // Row 9's five `effectIds` are all refused on grounds no engine slice can
    // reach: Reboot Pod `sv05-158` and Glass Trumpet `sv07-135`/`sv08.5-110` (no
    // catalog column classifies the Ancient/Future banner), and Powerglass
    // `sv06.5-063`/`sv06.5-097` (a whole new end-of-turn Tool trigger point).
    // ⚠️ **A COUNT IS NOT A RESIDUE** — that row is the standing example, and after
    // this slice it is the ONLY thing standing between `ROWS`' total of 6 and a
    // live residue of 1.
    for (const id of ["sv05-158", "sv07-135", "sv08.5-110", "sv06.5-063", "sv06.5-097"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});
