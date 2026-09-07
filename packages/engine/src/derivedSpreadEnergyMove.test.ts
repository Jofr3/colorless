import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, EffectPrompt, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction, engineVersion, redactGame } from "./index";
import {
  SPREAD_ENERGY_MOVE_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.343.0 → 0.344.0 — D442, THE DESTINATION AXIS OF THE MOVE-ENERGY FAMILY.
//
//   "Move all Energy from this Pokémon to your Benched Pokémon in any way you
//    like."                                                            (1 legal)
//   "You may move any amount of Energy from your Pokémon to your other Pokémon
//    in any way you like."                                             (1 legal)
//   "You may move any amount of {M} Energy from your Pokémon to your other
//    Pokémon in any way you like."                                     (1 legal)
//
// THE SLICE IS ONE FACT: the `moveEnergy` ANSWER becomes a MAP. It was
// `{ uids: string[]; dest: PokemonRef }` — one destination for every pick — which
// is what D441's refusal named, and it is `attachCards`' shipped `assignments`
// shape read one prompt over. Everything else these three sentences need already
// existed: two shipped routes, D441's `"all"`, D244's `"any"`, D226's `anySource`
// and D171's `providesEnergy`.
//
// 🛑 WHY THE RENAME AND NOT AN ADDITIVE `picks?:` BESIDE THE OLD PAIR.
// `{ uids: [a, b], dest: X }` and `{ picks: [{a,X},{b,X}] }` are the SAME ANSWER,
// so keeping both is D359's *"two spellings of one answer"*, refused four lines
// above the member in `interpreter.ts` for `{ ref, take: 0 }`. And the rename is
// free of `MATCH_RECORD_VERSION` for a reason about the TYPE rather than about the
// change: nothing persists an `EffectChoice` — §7 drives that.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did the Energy move". The endpoints are
// `derivedSelfEnergyMove`'s subject and the quantifiers are `derivedMoveAllEnergy`'s.
// What is new is that ONE answer may now name SEVERAL destinations — so every case
// below that a single-destination build could also pass is paired with one it
// cannot, and the COUPLED prompt (no `anyDest`) is the control on every rung.

const SPREAD_ALL = "Move all Energy from this Pokémon to your Benched Pokémon in any way you like.";
const SPREAD_ANY =
  "You may move any amount of Energy from your Pokémon to your other Pokémon in any way you like.";
const SPREAD_TYPED =
  "You may move any amount of {M} Energy from your Pokémon to your other Pokémon in any way you like.";
/** The COUPLED neighbour, one destination clause away — D441's sentence, 2 legal.
    Every rung asserting a spread is paired against this, because "the spread is
    accepted" passes trivially on a build that accepts everything (D424). */
const COUPLED_SIBLING = "Move all Energy from this Pokémon to 1 of your Benched Pokémon.";

const SPREAD_CYCLONE = 63; // fix-trainerops — SPREAD_ALL
const FREE_FLOW = 64; // fix-trainerops — SPREAD_ANY
const METAL_FLOW = 65; // fix-trainerops — SPREAD_TYPED
const SEED = 0x5c21;

/** p2 opens and passes, so p1 plays turn 2 with no §4 first-turn restriction.
    `fix-trainerops` Active carrying `basics` Colorless and `metals` Metal Energy,
    with `ownBench` benched `fix-basic-1` bodies. `benchEnergy` puts Energy on
    bench index 0 as well — the free route's sources include every own body, and a
    board where only the Active can give is one that cannot tell `anySource` from
    its absence. Both sides are set explicitly: a build that reached for the other
    seat's Bench is one `otherSeat` away, and this engine's most-repeated defect. */
function board({
  basics = 2,
  metals = 0,
  ownBench = 2,
  benchEnergy = 0,
}: { basics?: number; metals?: number; ownBench?: number; benchEnergy?: number } = {}): GameState {
  let state = mustApply(
    driveSetup(SEED, { p1: SPREAD_ENERGY_MOVE_DECK, p2: SPREAD_ENERGY_MOVE_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  state = setActiveFromDeck(state, "p1", "fix-trainerops");
  if (basics > 0) state = attachFromDeck(state, "p1", "fix-energy", basics);
  if (metals > 0) state = attachFromDeck(state, "p1", "fix-metal-energy", metals);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  if (benchEnergy > 0) state = attachBenchFromDeck(state, "p1", 0, "fix-energy", benchEnergy);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** The parked moveEnergy prompt, narrowed — and it THROWS rather than returning
    undefined when nothing parked, so a forced build cannot read as an empty one. */
function parked(state: GameState): Extract<EffectPrompt, { kind: "moveEnergy" }> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  return prompt;
}

function events<T extends GameEvent["type"]>(all: GameEvent[], type: T) {
  return all.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The board's refs, spelled once. */
const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const p1Bench = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

describe("§1 — the deriver: two anchors, three sentences, and the edges they must not reach", () => {
  it("derives all three to the shipped routes with the destination rider", () => {
    // 🛑 THE PROGRAM, NOT `!== null` (D438). A boolean is true under the real build
    // AND under one that dropped `anyDest`, which is precisely the build that reads
    // every one of these sentences as its coupled sibling.
    expect(deriveAttackEffect(SPREAD_ALL)).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: "all",
        route: "selfToBench",
        anyDest: true,
      },
    ]);
    expect(deriveAttackEffect(SPREAD_ANY)).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: "any",
        anySource: true,
        anyDest: true,
      },
    ]);
    expect(deriveAttackEffect(SPREAD_TYPED)).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "providesEnergy", energyType: "Metal" },
        max: "any",
        anySource: true,
        anyDest: true,
      },
    ]);
  });

  it("🛑 the COUPLED sibling still derives WITHOUT the rider — the one-axis control", () => {
    // D427: a near-miss that differs on more than one axis tests nothing about
    // either. These two strings agree up to the destination phrase and there only,
    // and their programs must agree up to `anyDest` and there only.
    const coupled = deriveAttackEffect(COUPLED_SIBLING) as EffectOp[];
    const spread = deriveAttackEffect(SPREAD_ALL) as EffectOp[];
    expect(coupled).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" },
    ]);
    expect(Object.hasOwn(coupled[0] as object, "anyDest")).toBe(false);
    expect({ ...(spread[0] as object), anyDest: undefined }).toEqual({
      ...(coupled[0] as object),
      anyDest: undefined,
    });
  });

  it("the TYPED and UNTYPED spreads differ in their FILTER and in nothing else", () => {
    // One anchor with an optional brace group (D247's shipped shape), so the two
    // programs are the same object with one key swapped. A build that read the
    // group and then ignored it — or that emitted `basicEnergy` instead of the
    // provision filter — is exactly what this pair separates.
    const untyped = deriveAttackEffect(SPREAD_ANY) as EffectOp[];
    const typed = deriveAttackEffect(SPREAD_TYPED) as EffectOp[];
    expect({ ...(untyped[0] as object), filter: undefined }).toEqual({
      ...(typed[0] as object),
      filter: undefined,
    });
    expect((typed[0] as { filter: unknown }).filter).toEqual({
      kind: "providesEnergy",
      energyType: "Metal",
    });
  });

  it("every code in the notation map derives, and {C}/{N} are refused", () => {
    // The character class IS `ENERGY_TYPE_BY_CODE`'s key set, so the vocabulary
    // cannot drift from the map and the two codes the map deliberately omits fall
    // to the loud skip path. `{C}` as an ENERGY is the conservative provision
    // fallback for every unauthored Special Energy (that map's own doc), so
    // admitting it would quietly match cards nobody meant.
    const typed = (code: string) =>
      deriveAttackEffect(
        `You may move any amount of {${code}} Energy from your Pokémon to your other Pokémon in any way you like.`,
      );
    for (const [code, type] of Object.entries({
      G: "Grass",
      R: "Fire",
      W: "Water",
      L: "Lightning",
      P: "Psychic",
      F: "Fighting",
      D: "Darkness",
      M: "Metal",
      Y: "Fairy",
    })) {
      expect(typed(code), code).toEqual([
        {
          op: "moveEnergy",
          filter: { kind: "providesEnergy", energyType: type },
          max: "any",
          anySource: true,
          anyDest: true,
        },
      ]);
    }
    expect(typed("C")).toBeNull();
    expect(typed("N")).toBeNull();
  });

  it("🛑 REFUSES the near-misses — a TRAILING clause, a swapped endpoint, a lost 'other'", () => {
    // The `$` witness (D228 at D229's address, third anchor): no member of this
    // family carries a tail in print, so the terminator's witness is CONSTRUCTED
    // and says so. A `$`-less anchor claims the head of a compound and silently
    // ships half the card.
    expect(deriveAttackEffect(`${SPREAD_ALL} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackEffect(`${SPREAD_ANY} Then, shuffle your deck.`)).toBeNull();
    // The OPPONENT-side twin: same verb, same quantifier, same spread.
    // 🆕🆕 **D443 CORRECTED THIS COMMENT'S REASON AND LEFT THE RUNG ALONE.** It read
    // *"the op is own-board on all five `moveEndpoints` branches, so claiming it
    // would move Energy on the wrong board"* — TRUE when written and FALSE from
    // D443, which gave `moveEnergy` a `side?: "opponent"` rider. The refusal
    // SURVIVES for a different and stronger reason: **nothing prints this
    // sentence.** The corpus's opponent-board Energy movers are the two `max: 1`
    // sentences D443 built; the opponent-board SPREAD exists only for damage
    // COUNTERS (corpus row 686, `moveCountersChosen`), so the string below is
    // constructed and no anchor claims it. ⚠️ D413's rule, applied to this file's
    // own rung: a refusal names the condition that would overturn it, that
    // condition BECAME TRUE, and the refusal has to be re-read rather than
    // inherited. Its falsifier is now a population fact, not a mechanism one.
    expect(
      deriveAttackEffect(
        "You may move any amount of Energy from your opponent's Pokémon to their other Pokémon in any way you like.",
      ),
    ).toBeNull();
    // "your other Pokémon" is the printed source exclusion. Without "other" the
    // sentence names a destination set that includes each pick's own host, which
    // is a different rule and no printing spells it.
    expect(
      deriveAttackEffect(
        "You may move any amount of Energy from your Pokémon to your Pokémon in any way you like.",
      ),
    ).toBeNull();
    // …and the un-tailed strings are still claimed, so the four refusals above are
    // not passing on a reader that refuses everything (D424).
    expect(deriveAttackEffect(SPREAD_ALL)).not.toBeNull();
    expect(deriveAttackEffect(SPREAD_ANY)).not.toBeNull();
  });
});

describe("§2 — the prompt: the rider crosses, and its absence crosses too", () => {
  it("the spread park carries `anyDest`; the coupled park carries no such key", () => {
    const spread = parked(swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state);
    expect(spread.anyDest).toBe(true);
    expect(spread.min).toBe(2);
    expect(spread.max).toBe(2);
    expect(spread.destinations).toHaveLength(2);
    // 🛑 D222/D223's failure mode in its purest form is a rider the op knows and
    // the prompt does not: the wire validator, the wire schema and both HUD dialogs
    // read the PROMPT. So the key set is pinned, not just the value.
    expect(Object.keys(spread).sort()).toEqual([
      "anyDest",
      "destinations",
      "kind",
      "max",
      "min",
      "movable",
      "note",
    ]);
    // THE CONTROL: D229's coupled printing on the same deck and the same Active.
    const coupled = parked(swing(board({ basics: 2, ownBench: 2 }), 14).state);
    expect("anyDest" in coupled).toBe(false);
  });

  it("the FREE-route spread carries BOTH riders, and offers every own body at both ends", () => {
    // The first printing in this family to be `anySource` AND `anyDest` at once —
    // sources are every own in-play body, destinations are every own in-play body,
    // and the per-pick exclusion is what makes "other" true rather than a narrowed
    // destination list.
    const prompt = parked(
      swing(board({ basics: 2, ownBench: 2, benchEnergy: 1 }), FREE_FLOW).state,
    );
    expect(prompt.anySource).toBe(true);
    expect(prompt.anyDest).toBe(true);
    expect(prompt.destinations).toHaveLength(3); // Active + two benched
    expect(new Set(prompt.movable.map((m) => m.from.spot.spot))).toEqual(
      new Set(["active", "bench"]),
    );
    // DECLINABLE — the printed "You may … any amount", so no floor at all.
    expect("min" in prompt).toBe(false);
  });

  it("the note is the printed sentence, on all three", () => {
    // D295's caption rule: the heading a player reads is the card's own words, and
    // `anyDest` replaces exactly the words the print replaces.
    expect(parked(swing(board(), SPREAD_CYCLONE).state).note).toBe(SPREAD_ALL);
    expect(parked(swing(board({ benchEnergy: 1 }), FREE_FLOW).state).note).toBe(
      SPREAD_ANY.replace("You may move", "Move"),
    );
    expect(parked(swing(board({ metals: 2, benchEnergy: 1 }), METAL_FLOW).state).note).toBe(
      "Move any amount of Metal Energy from your Pokémon to your other Pokémon in any way you like.",
    );
    // …and the COUPLED sibling's note keeps its "1 of", which is the coupling
    // spelled: one rider, one clause.
    expect(parked(swing(board({ basics: 2, ownBench: 2 }), 14).state).note).toBe(
      "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
    );
  });
});

describe("§3 — the answer: one map, several destinations", () => {
  it("🛑 TWO PICKS LAND ON TWO DIFFERENT BENCHED BODIES", () => {
    // THE ROW THE WHOLE SLICE IS ABOUT. A single-destination build resolves this
    // board too — it simply puts both Energy on one body — so the assertion that
    // discriminates is WHERE they end up, not how many moved.
    const state = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const prompt = parked(state);
    const [first, second] = prompt.movable.map((m) => m.uid) as [string, string];
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: first, dest: p1Bench(0) },
          { uid: second, dest: p1Bench(1) },
        ],
      },
    });
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([first]);
    expect(done.state.players.p1.bench[1]?.energy).toEqual([second]);
    // ONE ROW PER (SOURCE, DESTINATION) PAIR — `ENERGY_MOVED`'s own doc promises
    // that all of a row's uids came off one `from` and land on one `to`, and the
    // log renders it literally. Two destinations, two rows.
    const moved = events(done.events, "ENERGY_MOVED");
    expect(moved).toHaveLength(2);
    expect(moved.map((e) => e.to)).toEqual([
      { spot: "bench", index: 0 },
      { spot: "bench", index: 1 },
    ]);
    expect(moved.every((e) => e.from.spot === "active")).toBe(true);
  });

  it("a spread whose entries AGREE emits exactly the ONE row the coupled answer did", () => {
    // The byte-compatibility claim, driven: with one destination the (source,
    // destination) grouping degenerates to the (source) grouping this function
    // emitted before the map existed. If it did not, every shipped `moveEnergy`
    // board would have gained a row.
    const state = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const uids = parked(state).movable.map((m) => m.uid);
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: uids.map((uid) => ({ uid, dest: p1Bench(1) })),
      },
    });
    const moved = events(done.events, "ENERGY_MOVED");
    expect(moved).toHaveLength(1);
    expect(moved[0]?.uids).toEqual(uids);
    expect(done.state.players.p1.bench[1]?.energy).toEqual(uids);
  });

  it("the FREE route spreads ACROSS sources as well as across destinations", () => {
    // Both riders at once, which is the combination only these two printings have:
    // one Energy off the Active onto a benched body, one off a benched body onto
    // the Active, in ONE answer. A build that kept either coupling refuses it.
    const state = swing(board({ basics: 1, ownBench: 2, benchEnergy: 1 }), FREE_FLOW).state;
    const prompt = parked(state);
    const fromActive = prompt.movable.find((m) => m.from.spot.spot === "active") as {
      uid: string;
    };
    const fromBench = prompt.movable.find((m) => m.from.spot.spot === "bench") as { uid: string };
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: fromActive.uid, dest: p1Bench(1) },
          { uid: fromBench.uid, dest: P1_ACTIVE },
        ],
      },
    });
    expect(done.state.players.p1.bench[1]?.energy).toEqual([fromActive.uid]);
    expect(done.state.players.p1.active?.energy).toEqual([fromBench.uid]);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(2);
  });

  it("the printed decline names NOBODY, and it is still a decline", () => {
    // `picks: []` — where the old shape had to carry an arbitrary `dest` for an
    // answer in which nothing happens to it. The declinable printing is the one
    // that can exercise it.
    const state = swing(board({ basics: 2, ownBench: 2, benchEnergy: 1 }), FREE_FLOW).state;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(0);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
  });
});

describe("§4 — validateChoice: the coupling is now ASSERTED where it used to be a SHAPE", () => {
  it("🛑 a COUPLED prompt REFUSES a two-destination answer", () => {
    // THE RUNG THE RENAME OWES. Under `{ uids, dest }` a mixed-destination answer
    // was unrepresentable; under the map it is representable and must be REFUSED,
    // or Energy Switch and Poppy silently become spread cards. D229's coupled
    // printing, two Energy, two benched destinations.
    const state = swing(board({ basics: 2, ownBench: 2 }), 15).state; // Jet Cyclone, max 3
    const prompt = parked(state);
    expect("anyDest" in prompt).toBe(false);
    const [first, second] = prompt.movable.map((m) => m.uid) as [string, string];
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(1) },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
    // THE ADMISSION on the same axis (D424): the identical answer with the
    // destinations AGREEING is accepted, so the refusal above is about the
    // spreading and not about the frame.
    expect(
      applyAction(state, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(0) },
          ],
        },
      }).ok,
    ).toBe(true);
  });

  it("🛑 the SPREAD prompt admits the very answer the coupled one refuses", () => {
    // The other half of the pair: same frame, same shape, opposite verdict, and
    // the only difference is the prompt's rider. Without this rung the refusal
    // above passes on a build that refuses every mixed-destination answer.
    const state = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const [first, second] = parked(state).movable.map((m) => m.uid) as [string, string];
    expect(
      applyAction(state, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(1) },
          ],
        },
      }).ok,
    ).toBe(true);
  });

  it("the SELF-MOVE rule is PER PICK, and a spread cannot smuggle one past it", () => {
    // D226's generalisation, one endpoint over: under the coupling "no pick's
    // source is the destination" and "the source is not the destination" were the
    // same test. Under `anyDest` only the per-pick reading is right, and a build
    // that checked the FIRST pick's destination against every source (or the last
    // one) would let this through.
    const state = swing(board({ basics: 1, ownBench: 2, benchEnergy: 1 }), FREE_FLOW).state;
    const prompt = parked(state);
    const benched = prompt.movable.find((m) => m.from.spot.spot === "bench") as {
      uid: string;
      from: PokemonRef;
    };
    const active = prompt.movable.find((m) => m.from.spot.spot === "active") as { uid: string };
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: active.uid, dest: p1Bench(1) },
            { uid: benched.uid, dest: benched.from }, // onto the body it sits on
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("refuses an unoffered destination, a repeated uid, and a short mandatory answer", () => {
    const state = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const [first, second] = parked(state).movable.map((m) => m.uid) as [string, string];
    const answer = (picks: { uid: string; dest: PokemonRef }[]) => ({
      type: "resolveEffect" as const,
      seat: "p1" as const,
      choice: { kind: "moveEnergy" as const, picks },
    });
    // The OPPONENT's board is never a destination FOR THIS PROMPT.
    // 🆕🆕 **D443 CORRECTED THIS COMMENT AND THE RUNG STILL PASSES UNCHANGED**, which
    // is the finding: it read *"the op is own-board on every branch"*, and since D443
    // the op has a `side` rider. What actually refuses the frame below has never been
    // the op — `validateChoice`'s `moveEnergy` arm is entirely PROMPT-relative and
    // carries NO seat test of its own, so a `p2` destination is refused here because
    // THIS park did not OFFER one. That is why the widening cost the validator
    // nothing, and `derivedOpponentEnergyMove.test.ts` §3 drives the mirror (a `p1`
    // destination refused by an opponent-board park) so the pair shows the refusal
    // follows the OFFER rather than a hard-coded side.
    expectErr(
      state,
      answer([{ uid: first, dest: { seat: "p2", spot: { spot: "bench", index: 0 } } }]),
      "BAD_EFFECT_CHOICE",
    );
    // One physical card cannot land on two Pokémon.
    expectErr(
      state,
      answer([
        { uid: first, dest: p1Bench(0) },
        { uid: first, dest: p1Bench(1) },
      ]),
      "BAD_EFFECT_CHOICE",
    );
    // D441's floor, on a spread prompt: `min === max === 2`, so one pick is short.
    expectErr(state, answer([{ uid: first, dest: p1Bench(0) }]), "BAD_EFFECT_CHOICE");
    // …and the WHOLE answer is accepted, so none of the three passes on a build
    // that refuses everything.
    expect(
      applyAction(
        state,
        answer([
          { uid: first, dest: p1Bench(0) },
          { uid: second, dest: p1Bench(1) },
        ]),
      ).ok,
    ).toBe(true);
  });
});

describe("§5 — the typed filter: provision, not print", () => {
  it("only the {M} Energy is offered, and the untyped sibling offers both", () => {
    // D118's rule: an attached Energy's type is a PROVISION question, answered on
    // its host (`matchesAttached`). The board carries a Colorless Basic and a Metal
    // Basic on the same body, which is the only shape that can tell the typed
    // filter from `anyEnergy` at all.
    const base = board({ basics: 1, metals: 1, ownBench: 2, benchEnergy: 0 });
    const typed = parked(swing(base, METAL_FLOW).state);
    const untyped = parked(swing(base, FREE_FLOW).state);
    expect(untyped.movable).toHaveLength(2);
    expect(typed.movable).toHaveLength(1);
    const active = base.players.p1.active as { energy: string[] };
    const metalUid = typed.movable[0]?.uid as string;
    expect(base.cardIdByUid[metalUid]).toBe("fix-metal-energy");
    expect(active.energy).toContain(metalUid);
  });

  it("with NO Metal on the board the typed printing is a silent no-op", () => {
    // `movable.length === 0` returns before either quantifier is consulted, so
    // nothing parks and nothing moves — while its untyped sibling on the same
    // board parks. The pair is what makes the filter's emptiness observable.
    const base = board({ basics: 2, metals: 0, ownBench: 2 });
    expect(swing(base, METAL_FLOW).state.phase.kind).not.toBe("effect:choose");
    expect(swing(base, FREE_FLOW).state.phase.kind).toBe("effect:choose");
  });
});

describe("§6 — the wire: the rider crosses, and its absence crosses too", () => {
  it("the redacted prompt carries `anyDest`, and a coupled one carries no key", () => {
    const spread = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const snapshot = redactGame(spread, "p1");
    const wire = snapshot.phase.kind === "effect:choose" ? snapshot.phase.prompt : null;
    if (wire === null || wire.kind !== "moveEnergy")
      throw new Error("expected a wire moveEnergy prompt");
    // 🛑 THE ONLINE HALF (D226's pair, D412's third-read-site rule): a rider the
    // wire drops is a spread the remote player is shown as a coupled decision, with
    // every local assertion above still green.
    expect(wire.anyDest).toBe(true);
    expect(Object.keys(wire).sort()).toEqual([
      "anyDest",
      "destinations",
      "kind",
      "max",
      "min",
      "movable",
      "note",
    ]);
    const coupledWire = redactGame(swing(board({ basics: 2, ownBench: 2 }), 14).state, "p1");
    const coupled = coupledWire.phase.kind === "effect:choose" ? coupledWire.phase.prompt : null;
    if (coupled === null || coupled.kind !== "moveEnergy") throw new Error("expected a wire prompt");
    expect("anyDest" in coupled).toBe(false);
  });
});

describe("§7 — the persisted shape: `MATCH_RECORD_VERSION` stays 29", () => {
  it("🛑 DRIVEN OVER THE SERIALIZED BYTES, in BOTH directions", () => {
    // The rule (`apps/api/src/lobby/match.ts`): *"does the OLD BYTE STRING still
    // mean what it meant"*, and *"a WIDENING is free and a RENAME is not"*.
    //
    // 🛑 **THE RENAME THIS SLICE MAKES IS NOT AT A PERSISTED ADDRESS.** A
    // `MatchRecord` is `{version, seed, startedAt, state, log, names}`; `state` is a
    // `GameState` whose `effect:choose` phase holds a PROMPT and an
    // `EffectContinuation` (`{pendingOp, rest, ctx, record?}`); `log` is the
    // RENDERED `SeatLogEntry[]`. An `EffectChoice` appears in NONE of them — it
    // rides one `resolveEffect` action, is validated, is applied and is gone. So
    // `uids`/`dest` → `picks` is not D359's case; the constant does not reach it.
    //
    // What the constant DOES reach are the two OPTIONAL riders that land in bytes:
    // `anyDest` on the OP (inside `phase.cont.pendingOp`) and `anyDest` on the
    // PROMPT. For both, ABSENT means the single-destination coupling — which is
    // what every writer before this deploy meant — so this is D334's added optional
    // `exact`, twice, and the INVERSE of D359's `upTo`, where absent came to mean
    // MANDATORY against bytes that had meant declinable.
    const live = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    expect(parked(live).anyDest).toBe(true);

    // (a) A v29 RECORD, reconstructed by deleting the keys a v29 writer never wrote
    // — from the PROMPT and from the persisted OP inside `cont` — and replayed
    // through the real action API. D326's and D309's move.
    const v29: GameState = JSON.parse(JSON.stringify(live)) as GameState;
    if (v29.phase.kind !== "effect:choose" || v29.phase.prompt.kind !== "moveEnergy") {
      throw new Error("expected a serialized moveEnergy park");
    }
    const { anyDest: _promptRider, ...coupledPrompt } = v29.phase.prompt;
    const pendingOp = v29.phase.cont.pendingOp as Record<string, unknown>;
    expect(pendingOp.op).toBe("moveEnergy");
    expect(pendingOp.anyDest).toBe(true); // it IS in the bytes — the reason this is asked
    const { anyDest: _opRider, ...coupledOp } = pendingOp;
    const resumed: GameState = {
      ...v29,
      phase: {
        ...v29.phase,
        prompt: coupledPrompt,
        cont: { ...v29.phase.cont, pendingOp: coupledOp as unknown as EffectOp },
      },
    };
    const [first, second] = coupledPrompt.movable.map((m) => m.uid) as [string, string];
    // The v29 park is answerable exactly as it was: every pick to ONE destination
    // goes through, and the SPREAD a v29 writer could never have offered is refused.
    // A build reading the missing key as `anyDest` would silently legalise a spread
    // on Energy Switch, which IS the bump condition — and it does not.
    const coupledAnswer = mustApply(resumed, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: first, dest: p1Bench(0) },
          { uid: second, dest: p1Bench(0) },
        ],
      },
    });
    expect(coupledAnswer.state.players.p1.bench[0]?.energy).toEqual([first, second]);
    expectErr(
      resumed,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(1) },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );

    // (b) THE OTHER DIRECTION: the SAME board WITH the rider accepts the spread, so
    // rung (a) is not passing because the engine refuses every mixed answer.
    expect(
      applyAction(live, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(1) },
          ],
        },
      }).ok,
    ).toBe(true);
  });
});

describe("§8 — the forced arm: one destination is not a spread", () => {
  it("a MANDATORY spread onto a Bench of ONE still applies inline", () => {
    // D441's forced arm, unchanged by the rider and gated on the same test: with
    // the quantity fixed and one body to put it on, the map has exactly one
    // inhabitant whatever `anyDest` says. The ≥2-bench board above is its control.
    const state = board({ basics: 2, ownBench: 1 });
    const done = swing(state, SPREAD_CYCLONE);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(1);
  });

  it("the DECLINABLE spread on the same one-destination board still PARKS", () => {
    // Gated on the FLOOR, not on `destinations.length` alone (D358's shipped
    // defect, named in the arm's own comment): a declinable printing must still
    // ask, because the answer it would be forced into is one the player may refuse.
    const state = board({ basics: 2, ownBench: 1 });
    const parkedFree = swing(state, FREE_FLOW).state;
    expect(parkedFree.phase.kind).toBe("effect:choose");
    expect(parked(parkedFree).destinations.length).toBeGreaterThan(1);
  });
});

describe("§9 — the version block", () => {
  it("the engine version was bumped in the same commit as the behaviour", () => {
    // D208's debt and D275's mutant: `engineVersion` and `packages/engine/package.json`
    // are one fact with two spellings, and the pin is authored HERE rather than
    // inherited (D427 — every note counts the pins it inherited and never the one it
    // is about to author; this is D442's own).
    expect(engineVersion).toBe("0.379.0");
  });
});
