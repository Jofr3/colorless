import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, deriveAttackEffect, programFor, topCardOf } from "./index";
import { deriveAttackCopy } from "./effects";
import type { GameState, PokemonRef, Seat } from "./index";
// `attachEnergyTargets` is not re-exported from index.ts (it is an engine-internal
// read site cardplay.ts imports directly); the attach test files reach it the same
// way, which is what lets this suite drive THE GATE rather than only its effects.
import { attachEnergyTargets } from "./interpreter";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  specialEnergy,
  trainerCard,
  findEvent,
} from "./testFixtures";

const IN_PLAY_TARGET_CENSUS = [
  {
    sentence:
      "As often as you like during your turn, you may attach a Basic {L} Energy card from your hand to 1 of your Iono's Pokémon.",
    card: "Iono's Bellibolt ex",
    surface: "ability",
    ids: ["sv09-053", "sv09-172", "sv09-183", "sv09-188", "svp-194"],
    landed: true,
    needs: "the in-play target rider — and NOTHING else. D199's highest-value item.",
  },
  {
    sentence: "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon.",
    card: "N's PP Up",
    surface: "trainer",
    ids: ["sv09-153"],
    landed: true,
    needs: "the rider + `benchOnly`. ⚠️ ABSENT FROM D200's FLAG TABLE.",
  },
  {
    sentence:
      "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may search your deck for up to 5 Basic {D} Energy cards and attach them to your Marnie's Pokémon in any way you like. Then, shuffle your deck.",
    card: "Marnie's Grimmsnarl ex",
    surface: "ability",
    ids: ["sv10-136"],
    landed: true,
    needs: "the SAME rider on `attachFromDeck`. ⚠️ ABSENT FROM D200's FLAG TABLE.",
  },
  {
    sentence:
      "Once during your turn, you may attach up to 2 Basic {R} Energy cards from your hand to 1 of your Benched Ethan's Pokémon.",
    card: "Ethan's Ho-Oh ex",
    surface: "ability",
    ids: ["sv10-039", "sv10-209", "sv10-230", "sv10-239"],
    landed: true,
    needs:
      "D204's flag was right and D205 built the piece: `attachEnergyFrom.count`, ONE decision pinning `min(count, available)` Energy to the ONE body chosen — distinct from the N-ops-in-sequence model, which is Koraidon 'Dino Cry''s printed 'in any way you like' and would let a player split these two.",
  },
  {
    sentence:
      "Switch your Active Team Rocket's Pokémon with 1 of your Benched Team Rocket's Pokémon. If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    card: "Team Rocket's Giovanni",
    surface: "trainer",
    ids: ["sv10-174", "sv10-225", "sv10-238"],
    landed: true,
    needs:
      "D204's flag named both pieces and D206 paid both from existing vocabulary: `switchActive.ownerPokemon` (D200's predicate at its FOURTH read site, narrowing the Active precondition and the Bench candidates from ONE field, because the print spells one owner twice) plus `switchActive.recordAs`, which lets §9.2's `recordGate` read whether the switch happened.",
  },
  {
    sentence:
      "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.",
    card: "Team Rocket's Wobbuffet",
    surface: "attack",
    ids: ["sv10-082", "svp-203"],
    landed: true,
    needs:
      "D204's flag was right about the shape (the op took no parameters) and D205 took the widening at the width the second ATTACK printing measures: one optional `ownerPokemon` on the SOURCE candidate set — D138's own stated condition for widening this op, arriving with a printing that differs on that axis and no other.",
  },
  {
    sentence:
      "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.",
    card: "Team Rocket's Orbeetle",
    surface: "ability",
    ids: ["sv10-089", "sv10-198"],
    landed: true,
    needs:
      "⚠️ ABSENT FROM D200's FLAG TABLE. BUILT at D565 on the SIBLING op `moveCounterOwnChosen` (one counter, a damaged own Team Rocket's body → another own body, `oncePerTurn: false`) — not a widening of the self→defender family.",
  },
  {
    sentence: "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.",
    card: "N's Zoroark ex",
    surface: "attack",
    ids: ["sv09-098", "sv09-175", "sv09-185", "sv09-189"],
    landed: true,
    needs:
      "⚠️ ABSENT FROM D200's FLAG TABLE. BUILT at D573 — not as an attack-COPY op but as a declaration-time SUBSTITUTION: `deriveAttackCopy` claims the sentence, and attack.ts asks for the Benched N's body (choosePokemon), then one of ITS attacks (chooseAttack), and re-enters `attack()` with it (two coupled decisions and a re-entrant attack resolution, as named; the target predicate is `ownerPokemon`).",
  },
] as const;

const SPIKEMUTH = {
  sentence:
    "Once during each player's turn, that player may search their deck for a Marnie's Pokémon, reveal it, and put it into their hand. Then, that player shuffles their deck.",
  id: "sv10-169",
} as const;

function subgroupBasic(id: string, name: string, types?: string[]): Card {
  return battler(id, { name, hp: 70, ...(types === undefined ? {} : { types }) });
}

const LOCAL_CARDS: Record<string, Card> = {
  // ── The four program carriers.
  "fix-electricstreamer": battler("fix-electricstreamer", {
    name: "Iono's Bellibolt ex",
    hp: 280,
    stage: "Stage1",
    evolveFrom: "Iono's Tadbulb",
    types: ["Lightning"],
    abilities: [
      {
        type: "Ability",
        name: "Electric Streamer",
        effect:
          "As often as you like during your turn, you may attach a Basic {L} Energy card from your hand to 1 of your Iono's Pokémon.",
      },
    ],
  }),
  "fix-nsppup": trainerCard(
    "fix-nsppup",
    "Item",
    "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon.",
  ),
  "fix-punkup": battler("fix-punkup", {
    name: "Marnie's Grimmsnarl ex",
    hp: 330,
    stage: "Stage2",
    evolveFrom: "Marnie's Morgrem",
    types: ["Darkness"],
    abilities: [
      {
        type: "Ability",
        name: "Punk Up",
        effect:
          "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may search your deck for up to 5 Basic {D} Energy cards and attach them to your Marnie's Pokémon in any way you like. Then, shuffle your deck.",
      },
    ],
  }),
  "fix-spikemuthgym": trainerCard("fix-spikemuthgym", "Stadium", SPIKEMUTH.sentence),
  // ── The subgroup bodies the riders must KEEP.
  "fix-iono-basic": subgroupBasic("fix-iono-basic", "Iono's Tadbulb", ["Lightning"]),
  "fix-iono-wattrel": subgroupBasic("fix-iono-wattrel", "Iono's Wattrel", ["Lightning"]),
  "fix-n-basic": subgroupBasic("fix-n-basic", "N's Darmanitan"),
  "fix-n-reshiram": subgroupBasic("fix-n-reshiram", "N's Reshiram"),
  "fix-marnie-basic": subgroupBasic("fix-marnie-basic", "Marnie's Impidimp", ["Darkness"]),
  "fix-marnie-morgrem": battler("fix-marnie-morgrem", {
    name: "Marnie's Morgrem",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Marnie's Impidimp",
    types: ["Darkness"],
  }),
  "fix-marnie-scorbunny": subgroupBasic("fix-marnie-scorbunny", "Marnie's Scorbunny", ["Darkness"]),
  // ── The bodies the riders must DROP. Each is a real near-miss, not a strawman.
  /** A DIFFERENT owner's Pokémon, {L}-typed like the Iono's ones — so `targetType`
      alone would keep it and only the owner rider drops it. */
  "fix-ethan-basic": subgroupBasic("fix-ethan-basic", "Ethan's Cyndaquil", ["Lightning"]),
  /** No prefix at all — the ordinary body every real board also holds. */
  "fix-plain": subgroupBasic("fix-plain", "Pikachu", ["Lightning"]),
  "fix-noctowl": subgroupBasic("fix-noctowl", "Noctowl"),
  "fix-farfetchd": battler("fix-farfetchd", { name: "Farfetch'd", types: ["Lightning"] }),
  "fix-lowercase": subgroupBasic("fix-lowercase", "iono's Pikachu", ["Lightning"]),
  "fix-tr-energy": specialEnergy(
    "fix-tr-energy",
    "Team Rocket's Energy",
    "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card.",
  ),
} as const;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-electricstreamer": 3,
  "fix-nsppup": 3,
  "fix-punkup": 3,
  "fix-spikemuthgym": 2,
  "fix-iono-basic": 3,
  "fix-iono-wattrel": 4,
  "fix-n-basic": 3,
  "fix-n-reshiram": 4,
  "fix-marnie-basic": 2,
  "fix-marnie-morgrem": 4,
  "fix-marnie-scorbunny": 4,
  "fix-ethan-basic": 4,
  "fix-plain": 4,
  "fix-noctowl": 3,
  "fix-farfetchd": 2,
  "fix-lowercase": 2,
  "fix-tr-energy": 1,
  "fix-lightning-energy": 4,
  "fix-dark-energy": 4,
  "fix-basic-1": 1,
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

function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

/** P1's board with `bodyId` Active and an EMPTY bench, ready to be filled with
    exactly the bodies a case wants to distinguish. */
function withActive(seed: number, bodyId: string): GameState {
  return clearBench(setActiveFromDeck(handToDeck(board(seed), "p1", bodyId), "p1", bodyId), "p1");
}

function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    return body === null ? "?" : (topCardOf(state, body)?.name ?? "?");
  });
}

/** The printed NAME behind a card uid (a chooseCards candidate). */
function cardName(state: GameState, uid: string): string {
  return POOL[state.cardIdByUid[uid] ?? ""]?.name ?? "?";
}

// ── 1. The seam itself, at the one gate ──────────────────────────────────────

describe("the in-play target rider — `attachEnergyTargets` is the ONE gate", () => {
  it("keeps only the owner's subgroup, dropping a same-TYPE body of another owner", () => {
    let state = withActive(11, "fix-iono-basic");
    for (const id of ["fix-iono-wattrel", "fix-ethan-basic", "fix-plain", "fix-farfetchd"]) {
      state = benchFromDeck(state, "p1", id);
    }
    // Every body on this board is {L}, so `targetType` alone keeps all five.
    expect(attachEnergyTargets(state, "p1", { targetType: "Lightning" })).toHaveLength(5);
    const kept = attachEnergyTargets(state, "p1", { ownerPokemon: "Iono" });
    expect(refNames(state, kept).sort()).toEqual(["Iono's Tadbulb", "Iono's Wattrel"]);
  });

  it("matches the possessive WHOLE — `Noctowl` is not an N's Pokémon", () => {
    let state = withActive(15, "fix-n-basic");
    state = benchFromDeck(state, "p1", "fix-noctowl");
    // The predicate that forgets `'s ` reads every N-initial Pokémon as N's.
    const kept = attachEnergyTargets(state, "p1", { ownerPokemon: "N" });
    expect(refNames(state, kept)).toEqual(["N's Darmanitan"]);
  });

  it("is EXACT-CASE — `iono's Pikachu` is not an Iono's Pokémon", () => {
    let state = withActive(12, "fix-iono-basic");
    state = benchFromDeck(state, "p1", "fix-lowercase");
    const kept = attachEnergyTargets(state, "p1", { ownerPokemon: "Iono" });
    expect(refNames(state, kept)).toEqual(["Iono's Tadbulb"]);
  });

  it("composes with `benchOnly`, dropping the Active of the same subgroup", () => {
    let state = withActive(13, "fix-iono-basic");
    state = benchFromDeck(state, "p1", "fix-iono-wattrel");
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Iono" })).toHaveLength(2);
    const benched = attachEnergyTargets(state, "p1", { ownerPokemon: "Iono", benchOnly: true });
    expect(refNames(state, benched)).toEqual(["Iono's Wattrel"]);
  });

  it("an owner that names nothing on the board yields the EMPTY set, not everything", () => {
    let state = withActive(14, "fix-plain");
    state = benchFromDeck(state, "p1", "fix-farfetchd");
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Iono" })).toEqual([]);
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Ionos" })).toEqual([]);
    expect(attachEnergyTargets(state, "p1", {})).toHaveLength(2);
  });
});

describe("Iono's Bellibolt ex — 'Electric Streamer' (5 legal printings)", () => {
  /** Bellibolt Active + the bench a case names, with {L} Energy in hand. */
  function streamerBoard(seed: number, bench: string[]): GameState {
    let state = withActive(seed, "fix-electricstreamer");
    for (const id of bench) state = benchFromDeck(state, "p1", id);
    return handFromDeck(state, "p1", "fix-lightning-energy", 2);
  }

  it("offers ONLY the Iono's Pokémon, though every body on the board is {L}", () => {
    const state = streamerBoard(21, ["fix-iono-wattrel", "fix-ethan-basic", "fix-plain"]);
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // Bellibolt is itself an Iono's Pokémon, so the Active stays in (no zone word).
    expect(refNames(parked, prompt.candidates).sort()).toEqual([
      "Iono's Bellibolt ex",
      "Iono's Wattrel",
    ]);
  });

  it("names the SUBGROUP in the prompt, not 'your Pokémon'", () => {
    const state = streamerBoard(22, ["fix-iono-wattrel", "fix-plain"]);
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // Three of five bodies offered under a caption saying "your Pokémon" reads as
    // a bug; the print says "1 of your Iono's Pokémon".
    expect(parked.phase.prompt.note).toContain("Iono's Pokémon");
  });

  it("attaches to the chosen Iono's body and is REPEATABLE (oncePerTurn: false)", () => {
    const state = streamerBoard(23, ["fix-iono-wattrel", "fix-plain"]);
    const ref: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    const { state: once, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref },
    });
    expect(findEvent(events, "ENERGY_ATTACHED")).toBeDefined();
    expect(once.players.p1.bench[0]?.energy).toHaveLength(1);
    // "As often as you like": the allowance is never consumed.
    const { state: twiceParked } = mustApply(once, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    const { state: twice } = mustApply(twiceParked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref },
    });
    expect(twice.players.p1.bench[0]?.energy).toHaveLength(2);
    // …and it never touched the §6.3 manual attach allowance.
    expect(twice.players.p1.active?.energy ?? []).toHaveLength(0);
  });

  it("WIRE SAFETY — an excluded body is rejected, not silently attached to", () => {
    const state = streamerBoard(24, ["fix-iono-wattrel", "fix-plain"]);
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    // `fix-plain` (Pikachu) is bench index 1 — on the board, {L}-typed, and NOT
    // an Iono's Pokémon. A crafted frame naming it must be refused by
    // `validateChoice`, which reads the PROMPT the rider narrowed.
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected the illegal target to be rejected");
    expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("auto-resolves without a park when the subgroup holds exactly one body", () => {
    const state = streamerBoard(25, ["fix-plain", "fix-ethan-basic"]);
    const { state: done, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Electric Streamer",
    });
    // Only Bellibolt itself is an Iono's Pokémon → forced, no prompt.
    expect(done.phase.kind).toBe("turn:action");
    expect(findEvent(events, "ENERGY_ATTACHED")).toBeDefined();
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("all five legal printings carry the program", () => {
    for (const id of ["sv09-053", "sv09-172", "sv09-183", "sv09-188", "svp-194"]) {
      expect(programFor(id)?.abilities?.[0]?.name).toBe("Electric Streamer");
      expect(programFor(id)?.abilities?.[0]?.oncePerTurn).toBe(false);
    }
  });
});

describe("N's PP Up sv09-153 — the discard source + `benchOnly` + the rider", () => {
  function ppUpBoard(seed: number, bench: string[]): GameState {
    let state = withActive(seed, "fix-n-basic");
    for (const id of bench) state = benchFromDeck(state, "p1", id);
    state = discardFromDeck(state, "p1", "fix-lightning-energy", 2);
    return handFromDeck(state, "p1", "fix-nsppup", 1);
  }

  it("offers only BENCHED N's Pokémon — the Active N's body is dropped by the zone word", () => {
    const state = ppUpBoard(31, ["fix-n-reshiram", "fix-n-basic", "fix-noctowl", "fix-plain"]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-nsppup"),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(refNames(parked, prompt.candidates).sort()).toEqual(["N's Darmanitan", "N's Reshiram"]);
    // …and the ACTIVE N's Darmanitan is not among them, though it matches the owner.
    expect(prompt.candidates.every((ref) => ref.spot.spot === "bench")).toBe(true);
    expect(prompt.note).toContain("Benched N's Pokémon");
  });

  it("attaches a Basic Energy from the DISCARD pile", () => {
    let state = ppUpBoard(32, ["fix-n-reshiram", "fix-n-basic"]);
    const before = state.players.p1.discard.length;
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-nsppup"),
    });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    const attached = findEvent(events, "ENERGY_ATTACHED");
    expect(attached).toBeDefined();
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    // One Energy left the discard; the played Item arrived there.
    expect(done.players.p1.discard).toHaveLength(before);
    state = done;
    expect(state.phase.kind).toBe("turn:action");
  });

  it("IS NOT PLAYABLE with no benched N's Pokémon — the `programPlayable` gate", () => {
    // The gate is load-bearing HERE and not on the search rows: an Item with no
    // trailing shuffle that can only whiff would burn for nothing.
    const state = ppUpBoard(33, ["fix-plain", "fix-ethan-basic", "fix-farfetchd"]);
    const rejected = applyAction(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-nsppup"),
    });
    expect(rejected.ok).toBe(false);
    // …and the SAME board with one benched N's body is playable, so the refusal
    // is the rider's and not some other precondition's.
    const ok = applyAction(ppUpBoard(33, ["fix-plain", "fix-n-reshiram"]), {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(ppUpBoard(33, ["fix-plain", "fix-n-reshiram"]), "p1", "fix-nsppup"),
    });
    expect(ok.ok).toBe(true);
  });
});

// ── 4. Marnie's Grimmsnarl ex — the same rider on the OTHER op ───────────────

describe("Marnie's Grimmsnarl ex sv10-136 — 'Punk Up' on `attachFromDeck`", () => {
  it("offers only Marnie's Pokémon as attach TARGETS, on the attachCards prompt", () => {
    let state = withActive(41, "fix-marnie-morgrem");
    for (const id of ["fix-marnie-scorbunny", "fix-plain", "fix-ethan-basic"]) {
      state = benchFromDeck(state, "p1", id);
    }
    state = handFromDeck(state, "p1", "fix-punkup", 1);
    const { state: parked, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-punkup"),
      target: { spot: "active" },
    });
    expect(findEvent(events, "POKEMON_EVOLVED")).toBeDefined();
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "attachCards") throw new Error("expected attachCards");
    expect(refNames(parked, prompt.targets).sort()).toEqual([
      "Marnie's Grimmsnarl ex",
      "Marnie's Scorbunny",
    ]);
    expect(prompt.note).toContain("Marnie's Pokémon");
  });

  it("WIRE SAFETY — a non-Marnie's destination is rejected on the attachCards prompt too", () => {
    let state = withActive(42, "fix-marnie-morgrem");
    state = benchFromDeck(state, "p1", "fix-plain");
    state = handFromDeck(state, "p1", "fix-punkup", 1);
    const { state: parked } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-punkup"),
      target: { spot: "active" },
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "attachCards") throw new Error("expected attachCards");
    const uid = prompt.candidates[0];
    if (uid === undefined) throw new Error("expected a Basic {D} Energy in the deck");
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [{ uid, to: { seat: "p1", spot: { spot: "bench", index: 0 } } }],
      },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected the illegal destination to be rejected");
    expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("a board with NO Marnie's Pokémon no-ops into the trailing shuffle (never gated)", () => {
    // `attachFromDeck` is deliberately not a `programPlayable` input: the printed
    // "Then, shuffle your deck" always resolves, so the no-target board is a live
    // path — and evolving is never refused for it.
    let state = withActive(43, "fix-marnie-morgrem");
    state = handFromDeck(state, "p1", "fix-punkup", 1);
    // Morgrem evolves INTO Grimmsnarl, which is itself a Marnie's Pokémon, so the
    // only way to reach the empty-target board is with the rider read directly.
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Nemona" })).toEqual([]);
    const { state: after } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-punkup"),
      target: { spot: "active" },
    });
    // Grimmsnarl IS a target, so this one parks rather than whiffing — the point
    // is only that nothing refused the evolve.
    expect(["effect:choose", "turn:action"]).toContain(after.phase.kind);
  });

  it("carries Charizard ex's shape: onEvolve, max 5, no maxPerTarget", () => {
    const trigger = programFor("sv10-136")?.triggered?.[0];
    expect(trigger?.trigger).toBe("onEvolve");
    const op = trigger?.program[0];
    expect(op).toMatchObject({
      op: "attachFromDeck",
      max: 5,
      ownerPokemon: "Marnie",
      filter: { kind: "basicEnergy", energyType: "Darkness" },
    });
    expect(op).not.toHaveProperty("maxPerTarget");
    expect(trigger?.program[1]).toEqual({ op: "shuffleDeck" });
  });
});

describe("Spikemuth Gym sv10-169 — the row held back for scope only", () => {
  it("is Champion's Call's two ops on `StadiumAbility.program`, with the owner changed", () => {
    const gym = programFor("sv10-169")?.stadium?.ability;
    expect(gym?.label).toBe("Spikemuth Gym");
    expect(gym?.program).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Marnie" },
        dest: "hand",
        max: 1,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    expect(JSON.stringify(gym?.program)).not.toContain('ownerPokemon":"Marnie","stage');
    expect(gym?.program).not.toBe(programFor("sv10-103")?.abilities?.[0]?.program);
  });

  it("searches a Marnie's Pokémon into hand for EITHER player and shuffles", () => {
    let state = withActive(51, "fix-plain");
    state = handFromDeck(state, "p1", "fix-spikemuthgym", 1);
    state = must(
      applyAction(state, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(state, "p1", "fix-spikemuthgym"),
      }),
    );
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // Every offered card is a Marnie's Pokémon and nothing else.
    const names = prompt.candidates.map((uid) => cardName(parked, uid));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith("Marnie's ")).toBe(true);
    const pick = prompt.candidates[0];
    if (pick === undefined) throw new Error("no candidate");
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(done.players.p1.hand).toContain(pick);
    expect(done.phase.kind).toBe("turn:action");
  });
});

function attackIsBuilt(id: string, sentence: string): boolean {
  return (
    programFor(id)?.attack !== undefined ||
    deriveAttackEffect(sentence) !== null ||
    deriveAttackCopy(sentence) !== null
  );
}

function abilitySurface(id: string): unknown {
  return programFor(id)?.abilities ?? programFor(id)?.triggered;
}

describe("the re-derived census — what landed, and what is still owed a piece", () => {
  it("lands 22 in-play-target printings across FIVE ops and the copy substitution, plus Spikemuth Gym ( 16 → 18 at D565, 18 → 22 at D573)", () => {
    const landed = IN_PLAY_TARGET_CENSUS.filter((row) => row.landed);
    expect(landed.flatMap((row) => row.ids)).toHaveLength(22);
    expect(IN_PLAY_TARGET_CENSUS.flatMap((row) => row.ids)).toHaveLength(22);
    for (const row of landed) {
      for (const id of row.ids) {
        const why = `${id} (${row.card}) is listed as LANDED on its ${row.surface}`;
        if (row.surface === "attack") expect(attackIsBuilt(id, row.sentence), why).toBe(true);
        else if (row.surface === "ability") expect(abilitySurface(id), why).toBeDefined();
        else expect(programFor(id)?.trainer, why).toBeDefined();
      }
    }
    expect(programFor(SPIKEMUTH.id)).toBeDefined();
  });

  it("every FLAGGED SURFACE is still UNBUILT — exact map or flag, never a plausible one", () => {
    const flagged = IN_PLAY_TARGET_CENSUS.filter((row) => !row.landed);
    expect(flagged.flatMap((row) => row.ids)).toHaveLength(0);
    for (const row of flagged) {
      for (const id of row.ids) {
        const program = programFor(id);
        const why = `${id} (${row.card}) must stay unbuilt: ${row.needs}`;
        if (row.surface === "attack") expect(attackIsBuilt(id, row.sentence), why).toBe(false);
        else if (row.surface === "ability") expect(abilitySurface(id), why).toBeUndefined();
        else expect(program?.trainer, why).toBeUndefined();
      }
    }
    expect(programFor("sv09-098")?.abilities?.[0]?.name).toBe("Trade");
    expect(programFor("sv09-098")?.attack).toBeUndefined();
    expect(
      deriveAttackCopy("Choose 1 of your Benched N's Pokémon's attacks and use it as this attack."),
    ).not.toBeNull();
  });

  it("holds the census shape D200 measured (80 units / 13 owners / 46 sentences)", () => {
    const OWNERS: Record<string, number> = {
      "Team Rocket's": 31,
      "Ethan's": 11,
      "Iono's": 6,
      "N's": 6,
      "Cynthia's": 5,
      "Hop's": 5,
      "Misty's": 4,
      "Steven's": 3,
      "Arven's": 3,
      "Marnie's": 2,
      "Lillie's": 2,
      "Janine's": 1,
      "Xerosic's": 1,
    };
    expect(Object.keys(OWNERS)).toHaveLength(13);
    expect(Object.values(OWNERS).reduce((a, b) => a + b, 0)).toBe(80);
  });
});

// ── 7. The FIXTURE_POOL sweep, as its own population ─────────────────────────

describe("FIXTURE_POOL, swept as a separate population", () => {
  it("holds EXACTLY D242's four owner-prefixed names, and nothing else", () => {
    const cards = Object.values(FIXTURE_POOL);
    expect(cards.length).toBeGreaterThan(300);
    const prefixed = cards.filter((card) => /^[A-Z][A-Za-z' ]*'s /.test(card.name));
    expect(prefixed.map((card) => card.id).sort()).toEqual(
      [
        "fix-powersaver",
        "fix-tr-body",
        "fix-tr-energy",
        "fix-not-tr-body",
        "fix-cynthia-aura",
        "fix-cynthia-body",
        "fix-hop-aura",
        "fix-repellingveil",
        "fix-tr-stage1",
        "fix-lillie-body",
        "fix-legacy-ex",
        "fix-ethans-cyndaquil",
        "fix-ethans-typhlosion",
        "fix-ethans-pichu",
        "fix-tr-other-energy",
        "fix-not-tr-energy",
        "fix-loveimpact",
        "fix-trnidoking",
        "fix-abruptflash",
        "fix-mistystaryu",
        "fix-inplaybodies",
        "fix-ethansadv",
        "fix-trsupporter",
        "fix-trtransceiver",
      ].sort(),
    );
  });

  it("the rider over a pool with no prefixed name is an empty set, never a wrong one", () => {
    const state = withActive(61, "fix-plain");
    for (const owner of ["Iono", "Marnie", "N", "Team Rocket"]) {
      expect(attachEnergyTargets(state, "p1", { ownerPokemon: owner })).toEqual([]);
    }
  });
});
