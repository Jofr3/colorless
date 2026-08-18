import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programPlayable } from "./cardplay";
import { firstAttachableEnergy } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import { battler, deckOf, itemTrainer, specialEnergy, typedEnergy } from "./testFixtures";

// D353 — SPIKE-CLAD, AND THE ONE THING IT BUYS: `attachEnergyFrom.energyName`,
// THE PRINTED PROPER NAME.
//
// "When you play this Pokémon from your hand to evolve 1 of your Pokémon during
//  your turn, you may attach up to 2 Spiky Energy cards from your discard pile
//  to this Pokémon."
//        (Lycanroc sv09-085 / sv09-166 — an Ability, 2 Standard-legal printings)
//
// ⚠️ **THE CLAUSE, CENSUSED OVER ALL THREE TEXT COLUMNS AND NOT CARRIED FROM
// BACKLOG ROW 9.** Remote D1 `luminous`, 2026-08-16, `json_each(abilities_json)` /
// `json_each(attacks_json)` keyed on **`$.effect`** plus the bare `effect` column,
// filtered to sentences containing `attach` AND any of the fourteen non-basic
// Energy card NAMES the catalog prints. The extractor was verified against three
// KNOWN-PRESENT rows (`sv09-085`, `sv10-145`, `sv09-107`) before any zero in it
// was believed — the false-zero hazard is that the ability text key is `$.effect`
// and NOT `$.text`.
//
// The answer is **2 SENTENCES / 4 PRINTINGS / 2 LEGAL**:
//   • THIS sentence — Lycanroc `sv09-085` + `sv09-166`, both `legal_standard = 1`;
//   • Wigglytuff `sv02-084` + `sv04.5-147`, *"Once during your turn, you may
//     attach a **Therapeutic Energy** card from your hand to 1 of your Pokémon."*
//     — both `legal_standard = 0`, ROTATED.
// 🆕 **SO THE ROW IS NOT MERELY THE CHEAPEST MEMBER OF THE CLAUSE, IT IS THE
// CLAUSE'S ENTIRE STANDARD-LEGAL POPULATION** — D352's shape one slice later, and
// the second consecutive slice where step 4 of the method ("is this the cheapest
// thing that sentence buys?") answered "it is the only thing".
//
// ⚠️ **AND THE ROTATED HALF IS WHY THE FIELD IS NOT A ONE-CARD SPECIAL CASE.**
// Wigglytuff attaches from the **hand** to **1 of your Pokémon**; Lycanroc from
// the **discard pile** to **this Pokémon**, twice. Same narrowing, different
// source zone, different target shape, different count — so `energyName` is
// orthogonal to `source` and to every `AttachTargetRiders` field, which is
// exactly what a field rather than a card-shaped hack looks like. §4 drives the
// rotated shape too, on a synthetic body, so the orthogonality is a MEASUREMENT.
//
// ⚠️ **THE SENTENCE THE SENTENCE RESTS ON WAS ALSO CENSUSED** (step 3). The
// trigger clause *"When you play this Pokémon from your hand to evolve 1 of your
// Pokémon during your turn"* is `trigger: "onEvolve"` and has been BUILT since
// D250 — `registry.ts` carries EIGHT `onEvolve` rows at this head, seven of them
// older than this one. `count: 2` + `toSelf` is `BATTLE_HARDENED`'s own shape
// (D250/D205/D221), and `source: "discard"` is `ASSEMBLE_ALLOY`'s (D234). None of
// it is new; the intersection is.
//
// 🛑 **WHAT THIS SLICE PAID, AND THE REFUTATION THAT PROVES IT HAD TO.**
// ONE new optional op field, `attachEnergyFrom.energyName?: string`, answered by
// the CardFilter predicate the engine already has (`{ kind: "byName", name }`).
// ZERO new predicates, ZERO new ops, ZERO new prompt kinds, ZERO new CardFilter
// kinds, ZERO deriver arms. §3 drives the three no-new-vocabulary spellings that
// would have avoided even that one field and shows each one attaching the WRONG
// card or nothing at all — from SOURCE, on a board, not by argument.
//
// ⚠️ **WHAT THIS SUITE CAN AND CANNOT PUT RED, SAID UP FRONT** (the guard rule):
// * Dropping `energyName` from the registry row is caught by §2's board, which
//   holds Basic {F} Energy in the same discard pile: the attach would take those.
// * Dropping the name test from `attachableEnergies` is the same case.
// * Keeping the name test but ALSO demanding `energyType === "Normal"` is caught
//   by §2 alone — Spiky Energy is a SPECIAL Energy and would become unreachable.
//   That is this slice's ONE design call and it has its own mutant.
// * Dropping `count: 2` lands 1 where it must land 2 (§2).
// * Raising `count` to 3 is caught by the same case — a pile with 3 keeps 1.
// * Dropping `toSelf` is caught by §5: the board holds a SECOND own Pokémon and
//   the op would park instead of forcing, so `EFFECT_PENDING` would appear and
//   the evolved body would not necessarily be fed.
// * Wiring the trigger to `onPlayToBench` is caught by §6, which benches a body
//   and asserts NOTHING fires.
// * Dropping `optional` changes no behaviour today (the flag AUTO-FIRES; see
//   `TriggeredAbility.optional`), so it is killed by §1's DECLARATION snapshot and
//   by nothing else — the same verdict `battleHardened.test.ts` records.
// * The play gate (`cardplay.ts`) and the park guard are NOT reachable from a
//   board trigger, so §7 drives `firstAttachableEnergy` DIRECTLY: it is the one
//   consumer of the narrowing this row's own card cannot exercise, and leaving it
//   undriven would ship three of the four consumers.

const LYCANROC_IDS = ["sv09-085", "sv09-166"] as const;
const LYCANROC = "sv09-085";
const ROCKRUFF = "d353-rockruff";

/** The printed sentence, byte for byte, authored against the print rather than a
    paraphrase (D183's class) and byte-identical on both printings — 221-char
    `abilities_json` on each, remote D1 2026-08-16. */
const SPIKE_CLAD_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, " +
  "you may attach up to 2 Spiky Energy cards from your discard pile to this Pokémon.";

/** ⚠️ **REAL IDS ON A LOCAL `cardPool` (D275's idiom), AND `FIXTURE_POOL` IS NOT
    TOUCHED.** `catalogManifest.ts` is generated off a local sqlite this clone does
    not have and measures a 978-row / 6-set catalog holding no `sv09` row at all,
    so no `fix-*` demonstrator is owed and none is written. **A FIXTURE IS A CENSUS
    POPULATION** (D348) — `catalogManifest.test.ts` and `clauseApostrophe.test.ts`
    both sweep `FIXTURE_POOL`, so §8 asserts by ID that nothing here reached it. */
const SPIKY = "sv09-159"; // Spiky Energy — the REAL Standard-legal printing
const SPIKY_ALT = "sv09-190"; // Spiky Energy — the REAL reprint, same NAME

/** The negatives, and every one of them is load-bearing rather than filler:
    - `MIST` is a DIFFERENT Special Energy. `energyProvidesOf` answers "Colorless"
      for it exactly as it does for Spiky, so it is what an `energyType:
      "Colorless"` spelling would have swallowed (§3).
    - `FIGHTING` is a Basic Energy in the same pile — what a row with NO narrowing
      at all attaches.
    - `THERAPEUTIC` is the ROTATED by-name sentence's card, used in §4 to drive the
      same field through a different source zone and a different target rule. */
// ⚠️ `sv05-161`, NOT `sv09-160`. The first draft of this file wrote `sv09-160`
// from memory; the remote D1 says that id is **Maractus**, a Pokémon. **A CARRIED
// ID ROTS** (D206's class), caught here by re-querying rather than by a test —
// nothing in this suite could have seen it, because a synthetic body under a
// wrong id still behaves.
const MIST = "sv05-161";
const FIGHTING = "d353-fighting";
const THERAPEUTIC = "d353-therapeutic";
const BUDDY = "d353-buddy";
const JUNK = "d353-junk";

const LOCAL_CARDS: Record<string, Card> = Object.fromEntries(
  LYCANROC_IDS.map((id) => [
    id,
    battler(id, {
      name: "Lycanroc",
      stage: "Stage1",
      evolveFrom: "Rockruff",
      hp: 130,
      retreat: 2,
      types: ["Fighting"],
      abilities: [{ type: "Ability", name: "Spike-Clad", effect: SPIKE_CLAD_TEXT }],
    }),
  ]),
);
LOCAL_CARDS[ROCKRUFF] = battler(ROCKRUFF, { name: "Rockruff", hp: 70, types: ["Fighting"] });
LOCAL_CARDS[BUDDY] = battler(BUDDY, { name: "D353 Buddy", hp: 70 });
LOCAL_CARDS[SPIKY] = specialEnergy(SPIKY, "Spiky Energy");
LOCAL_CARDS[SPIKY_ALT] = specialEnergy(SPIKY_ALT, "Spiky Energy");
LOCAL_CARDS[MIST] = specialEnergy(MIST, "Mist Energy");
LOCAL_CARDS[THERAPEUTIC] = specialEnergy(THERAPEUTIC, "Therapeutic Energy");
LOCAL_CARDS[FIGHTING] = typedEnergy(FIGHTING, "Fighting");
LOCAL_CARDS[JUNK] = itemTrainer(JUNK);

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [LYCANROC]: 4,
  [LYCANROC_IDS[1]]: 2,
  [ROCKRUFF]: 6,
  [BUDDY]: 12,
  [SPIKY]: 8,
  [SPIKY_ALT]: 4,
  [MIST]: 6,
  [THERAPEUTIC]: 4,
  [FIGHTING]: 8,
  [JUNK]: 6,
});

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}

function idOf(state: GameState, uid: string): string {
  return state.cardIdByUid[uid] ?? "";
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[idOf(state, h)];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** Pass whole turns until `turn`, leaving the actor in `turn:action`. §4/§10 bars
    BOTH players from evolving on their own first turn, so every board in this file
    runs on turn 3 — the trigger cannot be reached any earlier and saying so is
    cheaper than a `FIRST_TURN_EVOLVE` a reader has to diagnose. */
function passTo(state: GameState, turn: number): GameState {
  let next = state;
  while (next.turn < turn) {
    if (next.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${next.phase.kind} while passing to turn ${turn}`);
    }
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
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

/** TEST SURGERY — p1's Active becomes a Rockruff, `pile` goes into p1's DISCARD in
    that order, `bench` is placed as extra own bodies, and a Lycanroc printing sits
    in hand ready to evolve. Everything is stated rather than drawn, so no count in
    this file is a seed fact. */
function board(
  pile: readonly string[],
  opts: { readonly lycanroc?: string; readonly bench?: readonly string[] } = {},
): { state: GameState; evolveUid: string } {
  const base = passTo(localSetup(7), 3);
  const side = base.players.p1;
  const lycanroc = opts.lycanroc ?? LYCANROC;

  // Pull the exact cards this board needs out of the deck, by id, in order.
  const deck = [...side.deck];
  const take = (cardId: string): string => {
    const index = deck.findIndex((uid) => idOf(base, uid) === cardId);
    if (index < 0) throw new Error(`deck has no ${cardId}`);
    return deck.splice(index, 1)[0] as string;
  };
  const activeUid = take(ROCKRUFF);
  const benchUids = (opts.bench ?? []).map(take);
  const evolveUid = take(lycanroc);
  const pileUids = pile.map(take);

  // The setup's own Active is the BLANK a fresh body is spread from, so every
  // field this suite does not name keeps the shape `createGame` produced.
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });

  const state: GameState = {
    ...base,
    players: {
      ...base.players,
      p1: {
        ...side,
        deck: [...deck, ...side.bench.flatMap((b) => b.stack), ...blank.stack],
        hand: [evolveUid],
        discard: [...side.discard, ...pileUids],
        active: body(activeUid),
        bench: benchUids.map(body),
      },
    },
  };
  return { state, evolveUid };
}

function evolveActive(state: GameState, uid: string): { state: GameState; events: GameEvent[] } {
  return apply(state, { type: "evolve", seat: "p1", uid, target: { spot: "active" } });
}

/** 🆕🆕 D359 — **THE EVOLVE NOW PARKS, AND ANSWERING IT IS THE WHOLE SLICE.**
    *"you may attach **up to 2** Spiky Energy … to this Pokémon"* offers
    `{0, 1, 2}`; until D359 the `toSelf` ref made `parkOrForce` force its lone
    candidate and the controller got two without being asked. Evolves, then
    answers with `take` (absent = the whole printed batch). A whiff never parks
    and is returned as it comes, which is what keeps the empty-pile cases below
    reading exactly as they did. */
function evolveAndTake(
  state: GameState,
  uid: string,
  take?: number,
): { state: GameState; events: GameEvent[] } {
  const evolved = evolveActive(state, uid);
  if (evolved.state.phase.kind !== "effect:choose") return evolved;
  const prompt = evolved.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  const answered = apply(evolved.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  });
  return { state: answered.state, events: [...evolved.events, ...answered.events] };
}

function energyIdsOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (pokemon?.energy ?? []).map((uid) => idOf(state, uid));
}

// ── 1. THE DECLARATION — the shape, by KEY SET, and the shared object ─────────

describe("D353 §1 — the authored row is ONE object over TWO printings", () => {
  it("both printings resolve to the SAME program object", () => {
    // Identity, not deep equality: a second transcription would drift (D183).
    expect(programFor(LYCANROC_IDS[0])).toBe(programFor(LYCANROC_IDS[1]));
  });

  it("the program's KEY SET is exactly `triggered` — so it is wholly non-attack", () => {
    // ⚠️ THIS IS THE ASSERTION `censusAtHead`'s `nonAttackRegistryIds()` +2 RESTS
    // ON, and it is a KEY SET rather than a "has no attack" claim, because the
    // filter is `some(key !== "attack")` and a program with BOTH keys would pass a
    // weaker guard while moving a different census line.
    for (const id of LYCANROC_IDS) {
      expect(Object.keys(programFor(id) ?? {}).sort(), id).toEqual(["triggered"]);
    }
  });

  it("the DECLARATION snapshot — trigger, optionality and the whole op", () => {
    // The only thing that reddens on a dropped `optional`, which auto-fires today
    // and therefore has no behavioural test anywhere. Said out loud, not papered.
    const triggered = programFor(LYCANROC)?.triggered ?? [];
    expect(triggered.length).toBe(1);
    const row = triggered[0];
    expect(row?.name).toBe("Spike-Clad");
    expect(row?.trigger).toBe("onEvolve");
    expect(row?.optional).toBe(true);
    expect(row?.program).toEqual([
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyName: "Spiky Energy",
        count: 2,
        toSelf: true,
      },
    ] satisfies EffectOp[]);
  });

  it("the row carries NONE of the class riders, because `toSelf` authors alone", () => {
    // `attachEnergyFrom.toSelf`'s own doc: a print that names its own body prints
    // no other target rule, so the member IGNORES the class riders rather than
    // refereeing a co-authored one. Asserted by ABSENCE so a future co-author
    // reddens here first.
    const op = (programFor(LYCANROC)?.triggered ?? [])[0]?.program[0] as Record<string, unknown>;
    for (const rider of ["targetType", "basicOnly", "ownerPokemon", "benchOnly", "anyEnergy"]) {
      expect(op, rider).not.toHaveProperty(rider);
    }
  });
});

// ── 2. THE CARD, DRIVEN — and the design call that makes it work ─────────────

describe("D353 §2 — Spike-Clad attaches exactly 2 SPIKY Energy and nothing else", () => {
  it("a pile of 3 Spiky attaches exactly 2, and the third stays in the discard", () => {
    const { state, evolveUid } = board([SPIKY, SPIKY, SPIKY]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY, SPIKY]);
    // `count: 2` and not 3 — the printed "up to 2" is a CAP, and the remainder is
    // what a raised count would eat.
    expect(after.state.players.p1.discard.filter((uid) => idOf(after.state, uid) === SPIKY).length)
      .toBe(1);
    // …and the trigger really fired, rather than the Energy arriving some other way.
    expect(after.events.map((e: GameEvent) => e.type)).toContain("ABILITY_TRIGGERED");
  });

  it("🛑 A SPECIAL ENERGY IS REACHED — the ONE design call, driven", () => {
    // Spiky Energy is `energy_type = 'Special'` (`sv09-159`/`sv09-190`, remote D1
    // 2026-08-16), and `attachableEnergies` has excluded Special Energy at the OP
    // since M5. The name SUBSUMES that test rather than conjoining with it: a
    // proper name picks out exactly one printed card and decides the
    // Basic/Special question by itself. Without the design call this board
    // attaches NOTHING and the card does not work at all.
    const { state, evolveUid } = board([SPIKY]);
    expect(POOL[SPIKY]?.energyType).toBe("Special");
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY]);
  });

  it("a pile of Basic {F} and Mist Energy is UNTOUCHED — the narrowing, both ways", () => {
    // The Basic half catches a row with no narrowing at all; the Mist half catches
    // an `anyEnergy`-only widening AND an `energyType: "Colorless"` spelling, both
    // of which reach Mist Energy. Nothing attaches and nothing leaves the pile.
    const { state, evolveUid } = board([FIGHTING, FIGHTING, MIST, MIST]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([]);
    expect(after.state.players.p1.discard.length).toBe(state.players.p1.discard.length);
  });

  it("a MIXED pile takes the two SPIKY and steps over everything in front of them", () => {
    // The sharpest single case in the file: the Basic {F} and the Mist Energy sit
    // EARLIER in zone order than the Spiky cards, so a narrowing that merely
    // widened the category would take the leading matches and be visibly wrong.
    const { state, evolveUid } = board([FIGHTING, MIST, SPIKY, FIGHTING, SPIKY_ALT, MIST]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY, SPIKY_ALT]);
  });

  it("🛑 the REPRINT counts — the name is a NAME and not an id", () => {
    // `sv09-190` is a different catalog id printing the same card. A narrowing
    // keyed on the id would take one of these and leave the other; the printed
    // word is "Spiky Energy cards", so both are the same card to the player.
    const { state, evolveUid } = board([SPIKY_ALT, SPIKY_ALT]);
    expect(POOL[SPIKY_ALT]?.name).toBe(POOL[SPIKY]?.name);
    expect(SPIKY_ALT).not.toBe(SPIKY);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY_ALT, SPIKY_ALT]);
  });

  it("an EMPTY pile is a silent no-op — the printed 'up to' shortfall", () => {
    const { state, evolveUid } = board([]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([]);
    expect(after.state.phase.kind).not.toBe("effect:choose");
  });

  it("ONE Spiky in the pile attaches ONE — `min(count, available)`, silently", () => {
    const { state, evolveUid } = board([SPIKY, FIGHTING]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY]);
  });
});

// ── 3. THE NO-NEW-VOCABULARY REFUTATION, RUN FROM SOURCE ─────────────────────

describe("D353 §3 — the three spellings that would have avoided the field, refuted", () => {
  // ⚠️ NOT ARGUED — each alternative is BUILT as an `EffectOp` and run through the
  // very consumer the real row uses, on the very pile the real row succeeds on.
  // D351's rule: refute the zero-diff spellings from source before paying a field.
  const pile = [FIGHTING, MIST, SPIKY, SPIKY_ALT];

  function reachable(op: {
    energyType?: string;
    anyEnergy?: true;
    energyName?: string;
  }): string | undefined {
    const { state } = board(pile);
    const uid = firstAttachableEnergy(
      state,
      "p1",
      "discard",
      op.energyType,
      op.anyEnergy,
      op.energyName,
    );
    return uid === undefined ? undefined : idOf(state, uid);
  }

  it("`energyType: \"Colorless\" + anyEnergy` reaches MIST — the wrong card", () => {
    // `energyProvidesOf` (cards.ts) returns "Colorless" for EVERY Special Energy
    // and for every `Normal`-typed Energy whose name is not a basic type word. In
    // Standard that is SEVEN Special names (Boomerang, Enriching, Legacy, Mist,
    // Neo Upper, Spiky, Team Rocket's) plus THREE `Normal`-typed oddballs
    // (Ignition, Prism, Reversal) — remote D1 2026-08-16. The print names ONE card.
    expect(reachable({ energyType: "Colorless", anyEnergy: true })).toBe(MIST);
  });

  it("`anyEnergy` alone reaches the Basic {F} — strictly broader still", () => {
    expect(reachable({ anyEnergy: true })).toBe(FIGHTING);
  });

  it("`energyType: \"Spiky\"` matches the EMPTY SET — the silent-whiff failure", () => {
    // `energyProvidesOf` only ever returns a member of `BASIC_ENERGY_TYPES`, so no
    // card in any zone can answer this. It is not merely wrong, it is INVISIBLY
    // wrong: `programPlayable` refuses an Ability whose attach could only whiff,
    // so the card would stop being offered rather than misbehave.
    expect(reachable({ energyType: "Spiky" })).toBeUndefined();
    expect(reachable({ energyType: "Spiky", anyEnergy: true })).toBeUndefined();
  });

  it("…and the spelling that was PAID reaches exactly the printed card", () => {
    expect(reachable({ energyName: "Spiky Energy" })).toBe(SPIKY);
    // …and a misspelling matches nothing, which is the recorded risk of a bare
    // string field (`AttachTargetRiders.ownerPokemon`'s own doc). Named so a
    // future author knows the failure mode is loud, not silent.
    expect(reachable({ energyName: "Spiky energy" })).toBeUndefined();
    expect(reachable({ energyName: "Spiky Energy card" })).toBeUndefined();
  });
});

// ── 4. THE FIELD IS ORTHOGONAL — the ROTATED sentence's shape, driven ────────

describe("D353 §4 — `energyName` is orthogonal to `source` and to the riders", () => {
  it("the ROTATED by-name sentence's shape works too — HAND source, no `toSelf`", () => {
    // Wigglytuff `sv02-084`/`sv04.5-147`: *"attach a Therapeutic Energy card from
    // your **hand** to 1 of your Pokémon."* Both printings are `legal_standard = 0`
    // so NO registry row is authored for them (D231's rule: a rider is added when a
    // card prints it, and a rotated card does not print into Standard). What is
    // driven here is the FIELD, at the other source zone and with no target rider,
    // so the claim "this is not a card-shaped hack" is a measurement.
    const { state } = board([]);
    const withHand: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, hand: [...state.players.p1.hand] },
      },
    };
    // Move one Therapeutic and one Basic {F} out of the deck and into the hand.
    const deck = [...withHand.players.p1.deck];
    const pull = (cardId: string): string => {
      const index = deck.findIndex((uid) => idOf(withHand, uid) === cardId);
      if (index < 0) throw new Error(`deck has no ${cardId}`);
      return deck.splice(index, 1)[0] as string;
    };
    const fighting = pull(FIGHTING);
    const therapeutic = pull(THERAPEUTIC);
    const handed: GameState = {
      ...withHand,
      players: {
        ...withHand.players,
        p1: {
          ...withHand.players.p1,
          deck,
          hand: [fighting, therapeutic, ...withHand.players.p1.hand],
        },
      },
    };
    // The Basic {F} sits FIRST, so a spelling with no name test takes it.
    expect(idOf(handed, firstAttachableEnergy(handed, "p1", "hand", undefined) ?? "")).toBe(
      FIGHTING,
    );
    const found = firstAttachableEnergy(
      handed,
      "p1",
      "hand",
      undefined,
      undefined,
      "Therapeutic Energy",
    );
    expect(idOf(handed, found ?? "")).toBe(THERAPEUTIC);
  });

  it("the two source zones are independent — a name in the DISCARD is not in the HAND", () => {
    const { state } = board([SPIKY, SPIKY]);
    expect(firstAttachableEnergy(state, "p1", "discard", undefined, undefined, "Spiky Energy"))
      .toBeDefined();
    expect(firstAttachableEnergy(state, "p1", "hand", undefined, undefined, "Spiky Energy"))
      .toBeUndefined();
  });
});

// ── 5. `toSelf` — the evolved body, and the second body that must stay empty ──

describe("D353/D359 §5 — the attach lands on the EVOLVED body, and now it ASKS", () => {
  it("a board with a SECOND own Pokémon still feeds ONLY the evolved one", () => {
    // Dropping `toSelf` reddens this twice: the op would see two eligible own
    // bodies and could land on the Bench. 🆕 D359 — the park is no longer the
    // discriminator (a printed ceiling parks even over one candidate), so the
    // claim is now made where it is actually load-bearing: the offered CANDIDATE
    // LIST is one long and names the Active, and the Bench ends empty.
    const { state, evolveUid } = board([SPIKY, SPIKY], { bench: [BUDDY] });
    const parked = evolveActive(state, evolveUid);
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.candidates).toEqual([ACTIVE_REF]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY, SPIKY]);
    expect(energyIdsOn(after.state, { seat: "p1", spot: { spot: "bench", index: 0 } })).toEqual([]);
  });

  it("🛑🛑 D359 — THE PRINTED *'up to 2'* IS NO LONGER OVER-RESOLVED: {0, 1, 2}", () => {
    // 🆕🆕 **THIS ROW USED TO PIN THE DEFECT AND NOW PINS THE REPAIR.** D358 bought
    // the DECLINE and wrote here, correctly, that this card still would not get it:
    // a declinable park buys {0, 2} and the print says {0, 1, 2} (§9.1 — *"one,
    // two, or none, all legal"*). **WHAT WAS MISSING WAS A QUANTITY AXIS**, and
    // D359 bought it — with NO new op field, because `count` was already the
    // printed ceiling (`attachFromZoneClause` admits `count > 1` through its
    // literal `up to (\d+)` alternative alone) and only the PROMPT and the ANSWER
    // were missing it.
    // ⚠️ **AND THE POPULATION FIGURE THIS ROW CARRIED WAS WRONG TWICE.** D353 wrote
    // "from 5 legal printings to 7" over a list of 6; D358 re-derived 17 off the
    // registry and named this card as one of EIGHT `count: 2` printings. D359
    // re-derived THAT and found **13**, because a registry walk cannot see
    // `deriveAttackEffect`'s three further `count: 2` sentences (Oricorio ×2,
    // Regirock ex ×2, Kilowattrel ex ×1). Three slices, three different figures,
    // and only the last one was measured over BOTH producers.
    const { state, evolveUid } = board([SPIKY, SPIKY]);
    // TWO — the pre-D359 behaviour, still reachable and still the default answer.
    expect(energyIdsOn(evolveAndTake(state, evolveUid).state, ACTIVE_REF)).toEqual([SPIKY, SPIKY]);
    // ONE — the printed middle answer, UNREACHABLE before this slice on this card.
    const one = evolveAndTake(state, evolveUid, 1);
    expect(energyIdsOn(one.state, ACTIVE_REF)).toEqual([SPIKY]);
    // …and the second Spiky is still in the discard pile, not consumed.
    expect(one.state.players.p1.discard.filter((u) => idOf(one.state, u) === SPIKY)).toHaveLength(1);
    // ZERO — the decline, which no route on this card could reach before either:
    // the trigger is a *"you may"*, but a board trigger auto-fires and the pick
    // beneath it was mandatory.
    const parked = evolveActive(state, evolveUid);
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const none = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(energyIdsOn(none.state, ACTIVE_REF)).toEqual([]);
    expect(none.events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(0);
    expect(none.state.players.p1.discard.filter((u) => idOf(none.state, u) === SPIKY)).toHaveLength(
      2,
    );
  });

  it("🆕 D359 — the park carries the printed CEILING and the `toSelf` caption", () => {
    const { state, evolveUid } = board([SPIKY, SPIKY]);
    const parked = evolveActive(state, evolveUid);
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBe(2);
    // The caption D205 removed as unreachable, now reachable and worded: a list of
    // one body must not be introduced as "which of your Pokémon?".
    expect(prompt.note).toBe("Attach up to 2 Energy to this Pokémon?");
  });
});

// ── 6. THE TRIGGER MOMENT — evolve and nothing else ──────────────────────────

describe("D353 §6 — `onEvolve` and not `onPlayToBench`", () => {
  it("benching a Lycanroc-carrying body fires NOTHING", () => {
    // Lycanroc is a Stage 1 and cannot be benched from hand at all, so the case is
    // driven at the trigger's own seam: a Rockruff played to the Bench must not
    // fire, and the discard pile keeps every Spiky Energy.
    const { state } = board([SPIKY, SPIKY]);
    const deck = [...state.players.p1.deck];
    const index = deck.findIndex((uid) => idOf(state, uid) === ROCKRUFF);
    const benchUid = deck.splice(index, 1)[0] as string;
    const withHand: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, deck, hand: [benchUid, ...state.players.p1.hand] },
      },
    };
    const after = apply(withHand, { type: "playBasicToBench", seat: "p1", uid: benchUid });
    expect(after.events.map((e: GameEvent) => e.type)).not.toContain("ABILITY_TRIGGERED");
    expect(energyIdsOn(after.state, { seat: "p1", spot: { spot: "bench", index: 0 } })).toEqual([]);
    expect(
      after.state.players.p1.discard.filter((uid) => idOf(after.state, uid) === SPIKY).length,
    ).toBe(2);
  });

  it("the OTHER printing fires identically — one object, two ids", () => {
    const { state, evolveUid } = board([SPIKY, SPIKY], { lycanroc: LYCANROC_IDS[1] });
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY, SPIKY]);
  });
});

// ── 7. THE FOURTH CONSUMER — the one this card cannot reach ──────────────────

describe("D353 §7 — all FOUR consumers of the narrowing, and the one that needs a direct drive", () => {
  it("🛑 `firstAttachableEnergy` carries the name — the gate/park half", () => {
    // D246 wrote down that `attachableEnergies` is the single read surface and
    // named its four consumers: the park guard in `applyEffectOp`, the apply, this
    // function, and through it `programPlayable` (cardplay.ts) plus both HUD
    // row-lighting mirrors. §2 drives the apply. The park guard and the play gate
    // are unreachable from a BOARD TRIGGER — no gate runs on `onEvolve` — so this
    // is the only place the other three can be exercised at all, and leaving it out
    // would ship a narrowing that reached one consumer of four.
    const { state } = board([FIGHTING, MIST]);
    // A pile with no Spiky in it answers "nothing to attach" to the gate…
    expect(firstAttachableEnergy(state, "p1", "discard", undefined, undefined, "Spiky Energy"))
      .toBeUndefined();
    // …while the UNNARROWED question answers "yes", which is exactly the divergence
    // a gate that ignored the name would produce.
    expect(firstAttachableEnergy(state, "p1", "discard", undefined)).toBeDefined();
  });

  it("🛑 `programPlayable` CARRIES THE NAME — and NO registry row can reach this today", () => {
    // ⚠️ **THIS CASE EXISTS BECAUSE THE MUTANT SURVIVED WITHOUT IT.**
    // `D353-play-gate-ignores-the-name` was probed individually before the sweep and
    // came back **SURVIVED — an undeclared GAP** on the first pass: the drive above
    // exercises the HELPER, and the mutant edits the `cardplay.ts` CALL SITE. Nothing
    // in the registry reaches that call site, because Spike-Clad is a BOARD TRIGGER
    // and no play gate runs on `onEvolve` — so the gate consumer had a name-blind
    // question and a green suite at the same time. **PROBING EACH NEW ROW
    // INDIVIDUALLY IS WHAT FOUND IT**, and the fix is a driven case rather than a
    // declared survivor: a survivor here would have been an allowlist entry over a
    // real divergence.
    //
    // The program is synthetic ON PURPOSE — the day a card prints *"Once during your
    // turn, you may attach a <Named> Energy card…"* into Standard, this is the exact
    // question that decides whether the Ability is offered. The rotated Wigglytuff
    // pair prints precisely that sentence, so the shape is a print rather than an
    // invention.
    const named: EffectOp[] = [
      { op: "attachEnergyFrom", source: "discard", energyName: "Spiky Energy", toSelf: true },
    ];
    // A pile with NO Spiky in it but plenty of ordinary Basic Energy: the gate must
    // refuse, because the only attach the program spells can only whiff.
    const { state: blind } = board([FIGHTING, FIGHTING, MIST]);
    expect(programPlayable(blind, named, "p1")).toBe(false);
    // …and the SAME program on the SAME shape of board WITH the printed card is
    // offered, so the assertion above is a narrowing and not a blanket refusal.
    const { state: live } = board([FIGHTING, SPIKY, MIST]);
    expect(programPlayable(live, named, "p1")).toBe(true);
    // The control that proves the gate is reading the NAME rather than the zone:
    // drop the narrowing and the first board becomes playable.
    const unnamed: EffectOp[] = [{ op: "attachEnergyFrom", source: "discard", toSelf: true }];
    expect(programPlayable(blind, unnamed, "p1")).toBe(true);
  });

  it("the name and the type are not welded — a disagreeing pair matches nothing", () => {
    // No printing spells both, and a program that did would whiff loudly rather
    // than silently prefer one. Recorded as a measurement rather than as a rule.
    const { state } = board([SPIKY, SPIKY]);
    expect(
      firstAttachableEnergy(state, "p1", "discard", "Fighting", undefined, "Spiky Energy"),
    ).toBeUndefined();
  });
});

// ── 8. THE FIXTURE IS A CENSUS POPULATION, AND THE BATON ─────────────────────

describe("D353 §8 — the pool, the registry keys, and the expiring insertion-order pin", () => {
  it("🛑 THE BATON, SPENT AND CONVERTED — the two ids are CONTIGUOUS, forever", () => {
    // 🆕🆕 **D354 SPENT THIS PIN AND CONVERTED IT, exactly as `metalMaker.test.ts`
    // §8, `remainingHpWindow.test.ts` §6, `invitingWink.test.ts` §7 and
    // `pyroDance.test.ts` §7 were converted when the baton left them.** The live
    // EXPIRING form was `expect(raw.slice(-2)).toEqual([...LYCANROC_IDS])`, and
    // D354's one new key (`sv10-145`) made it red on a constant nobody touched —
    // the TWELFTH consecutive slice on which that happened, and it fired here
    // rather than in `censusAtHead.test.ts`, which is what the baton is for.
    //
    // What survives is the CONTIGUITY claim, which stands still forever: these two
    // ids entered the registry together and no later slice may interleave a key
    // between them. It is a DIFFERENT assertion from the last-N pin and does not
    // substitute for it — the live pin now lives in `xBoot.test.ts` §6 at width
    // **1**, because D354 added exactly ONE id.
    // ⚠️ **THE WIDTH IS THE NUMBER OF IDS THE LAST SLICE ADDED**, and copying the
    // previous width is how a pin silently starts asserting a neighbour's row.
    const raw = registryCardIds();
    const at = raw.indexOf(LYCANROC_IDS[0]);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(raw.slice(at, at + 2)).toEqual([...LYCANROC_IDS]);
  });

  it("🛑 the +2 on `raw.length` is EXACTLY the two Lycanroc ids — the Energy ids were already keys", () => {
    // ⚠️ **THE THREE REAL ENERGY IDS IN THIS POOL WERE REGISTRY KEYS BEFORE THIS
    // SLICE**: Spiky Energy `sv09-159`/`sv09-190` and Mist Energy `sv05-161` all
    // carry their own `EnergyProgram` (they are three of `BUILT.specialEnergy`'s
    // 8). So a reader who sized `raw.length`'s step off "how many real catalog ids
    // does this suite name" would be wrong by three — the step is the number of
    // ids this slice ADDED, and this assertion is what says which is which.
    const keys = new Set(registryCardIds());
    for (const id of LYCANROC_IDS) expect(keys.has(id), id).toBe(true);
    for (const id of [SPIKY, SPIKY_ALT, MIST]) expect(keys.has(id), id).toBe(true);
    // …and the synthetic bodies are keys of nothing, which is what keeps the step at 2.
    for (const id of [ROCKRUFF, BUDDY, THERAPEUTIC, FIGHTING, JUNK]) {
      expect(keys.has(id), id).toBe(false);
    }
  });

  it("🛑 NOTHING HERE REACHES `FIXTURE_POOL` — asserted BY ID, not described", () => {
    // **A FIXTURE IS A CENSUS POPULATION** (D348). `catalogManifest.test.ts` and
    // `clauseApostrophe.test.ts` both sweep `FIXTURE_POOL`; this file builds its
    // own `cardPool` from `LOCAL_CARDS` alone and spreads nothing into the shared
    // one, so neither sweep's population moves.
    const local = Object.keys(POOL).sort();
    expect(local).toEqual(Object.keys(LOCAL_CARDS).sort());
    expect(local).toContain(LYCANROC_IDS[0]);
    expect(local.length).toBe(10);
  });

  it("the printed sentence is on the fixture bodies, so a census can SEE it", () => {
    for (const id of LYCANROC_IDS) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(SPIKE_CLAD_TEXT);
      expect(POOL[id]?.abilities?.[0]?.name, id).toBe("Spike-Clad");
    }
  });
});
