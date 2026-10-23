import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { deriveAttackCopy } from "./effects";
import { applyAction, deriveAttackEffect, programFor, topCardOf } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  findEvent,
  driveSetup,
} from "./testFixtures";

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

// ── The printed sentences, as bytes ──────────────────────────────────────────

/** Ethan's Ho-Oh ex "Golden Flame", verbatim off `abilities_json`. */
const GOLDEN_FLAME =
  "Once during your turn, you may attach up to 2 Basic {R} Energy cards from your hand to 1 of your Benched Ethan's Pokémon.";
/** Team Rocket's Wobbuffet "Rocket Mirror", verbatim off `attacks_json`. */
const ROCKET_MIRROR =
  "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.";
/** Dedenne ex "Tail Swap" — the sentence that BOUGHT the anchor, which must keep
    deriving to the byte-identical field-less op. */
const TAIL_SWAP =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";
const PERPLEXING_TRANSFER =
  "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.";
const EXTENDED_DAMAGRIIIGUS =
  "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";
const NIGHT_JOKER = "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.";
/** Team Rocket's Giovanni — flagged, the parameterised switch + "If you do". */
const GIOVANNI =
  "Switch your Active Team Rocket's Pokémon with 1 of your Benched Team Rocket's Pokémon. If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
const ROCKET_BRAIN =
  "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.";

const LANDED = [
  {
    card: "Ethan's Ho-Oh ex",
    surface: "ability",
    sentence: GOLDEN_FLAME,
    ids: ["sv10-039", "sv10-209", "sv10-230", "sv10-239"],
    legal: 4,
  },
  {
    card: "Team Rocket's Wobbuffet",
    surface: "attack",
    sentence: ROCKET_MIRROR,
    ids: ["sv10-082", "svp-203"],
    legal: 2,
  },
] as const;

function subgroupBasic(id: string, name: string, types?: string[]): Card {
  return battler(id, { name, hp: 90, ...(types === undefined ? {} : { types }) });
}

const LOCAL_CARDS: Record<string, Card> = {
  /** Ethan's Ho-Oh ex — the `count` carrier. A Basic, so it can be surgeried
      Active without an evolution chain; the print's own Basic-ness is why
      "Golden Flame" is usable on turn 1 in a real game. */
  "fix-goldenflame": battler("fix-goldenflame", {
    name: "Ethan's Ho-Oh ex",
    hp: 220,
    types: ["Fire"],
    abilities: [{ type: "Ability", name: "Golden Flame", effect: GOLDEN_FLAME }],
    attacks: [
      {
        name: "Shining Feathers",
        cost: ["Fire", "Fire", "Fire", "Fire"],
        damage: 160,
        effect: "Heal 50 damage from each of your Pokémon.",
      },
    ],
  }),
  /** Team Rocket's Wobbuffet — the counter-move carrier. Its printed idx 0 is
      the move; idx 1 is a plain damaging attack, kept so the index this suite
      declares is a CHOICE the fixture can get wrong rather than the only one. */
  "fix-rocketmirror": battler("fix-rocketmirror", {
    name: "Team Rocket's Wobbuffet",
    hp: 120,
    types: ["Psychic"],
    attacks: [
      { name: "Rocket Mirror", cost: ["Psychic", "Colorless"], effect: ROCKET_MIRROR },
      { name: "Headbutt Bounce", cost: ["Psychic", "Colorless", "Colorless"], damage: 70 },
    ],
  }),
  /** The Dedenne ex sentence on a local body — so the REGRESSION half (the
      unmarked print still derives to the field-less op and still offers every
      benched body) is driven on the same boards as the new half. */
  "fix-tailswap": battler("fix-tailswap", {
    name: "Dedenne ex",
    hp: 200,
    types: ["Psychic"],
    attacks: [{ name: "Tail Swap", cost: ["Psychic", "Colorless"], effect: TAIL_SWAP }],
  }),
  // ── The subgroup bodies each rider must KEEP.
  "fix-ethan-cyndaquil": subgroupBasic("fix-ethan-cyndaquil", "Ethan's Cyndaquil", ["Fire"]),
  "fix-ethan-pichu": subgroupBasic("fix-ethan-pichu", "Ethan's Pichu", ["Lightning"]),
  "fix-tr-nidorino": subgroupBasic("fix-tr-nidorino", "Team Rocket's Nidorino", ["Psychic"]),
  "fix-tr-meowth": subgroupBasic("fix-tr-meowth", "Team Rocket's Meowth", ["Psychic"]),
  // ── The bodies each rider must DROP. Every one is a real near-miss.
  /** A DIFFERENT owner's Pokémon, {R}-typed like the Ethan's ones — so
      `targetType` alone would keep it and only the owner rider drops it. */
  "fix-iono-body": subgroupBasic("fix-iono-body", "Iono's Bellibolt", ["Fire"]),
  /** No prefix at all — the ordinary body every real board also holds. */
  "fix-plain": subgroupBasic("fix-plain", "Pikachu", ["Fire"]),
  "fix-ethanite": subgroupBasic("fix-ethanite", "Ethanite", ["Fire"]),
  "fix-rocketeer": subgroupBasic("fix-rocketeer", "Team Rocketeer", ["Psychic"]),
  "fix-lowercase": subgroupBasic("fix-lowercase", "ethan's Cyndaquil", ["Fire"]),
  /** A 340 HP neutral body — the counter move's defender and bench filler, big
      enough that no pile this file moves causes a Knock Out under an assertion
      that is about candidates rather than about prizes. */
  "fix-bigtitan": battler("fix-bigtitan", { name: "Titan", hp: 340, types: ["Colorless"] }),
} as const;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-goldenflame": 3,
  "fix-rocketmirror": 3,
  "fix-tailswap": 2,
  "sv01-194": 3,
  "fix-ethan-cyndaquil": 4,
  "fix-ethan-pichu": 4,
  "fix-tr-nidorino": 4,
  "fix-tr-meowth": 4,
  "fix-iono-body": 2,
  "fix-plain": 4,
  "fix-ethanite": 2,
  "fix-rocketeer": 3,
  "fix-lowercase": 2,
  "fix-bigtitan": 4,
  "fix-fire-energy": 8,
  "fix-psychic-energy": 5,
  "fix-lightning-energy": 3,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** P1 to move on turn 3, past §4's going-first restrictions. */
function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

function withActive(seed: number, bodyId: string): GameState {
  let state = board(seed);
  for (const id of ["fix-fire-energy", "fix-psychic-energy", "fix-lightning-energy", bodyId]) {
    state = handToDeck(state, "p1", id);
  }
  const base = clearBench(setActiveFromDeck(state, "p1", bodyId), "p1");
  return clearBench(setActiveFromDeck(base, "p2", "fix-bigtitan"), "p2");
}

/** The printed NAME of every body a ref list points at. */
function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    return body === null ? "?" : (topCardOf(state, body)?.name ?? "?");
  });
}

/** The parked `choosePokemon` prompt, narrowed — a state that did NOT park fails
    here with the reason rather than three lines later on an undefined. */
function choosePrompt(state: GameState): {
  candidates: PokemonRef[];
  note: string;
  upTo?: number;
} {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  const prompt = state.phase.prompt;
  return {
    candidates: prompt.candidates,
    note: prompt.note,
    ...(prompt.upTo === undefined ? {} : { upTo: prompt.upTo }),
  };
}

function useAndTake(state: GameState, take?: number): GameState {
  const used = mustApply(state, useGoldenFlame);
  if (used.state.phase.kind !== "effect:choose") return used.state;
  const prompt = used.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  return mustApply(used.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  }).state;
}

const BENCH_0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
const BENCH_1: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 1 } };

function pick(ref: PokemonRef) {
  return { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } } as const;
}

const useGoldenFlame = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Golden Flame",
} as const;

// ── 1. `attachEnergyFrom.count` — the new primitive at its own seam ──────────

describe("`attachEnergyFrom.count` — ONE decision, N Energy, ONE body", () => {
  /** Ho-Oh Active, the named bench, and `fire` {R} in hand. */
  function ohoBoard(seed: number, bench: string[], fire: number): GameState {
    let state = withActive(seed, "fix-goldenflame");
    for (const id of bench) state = benchFromDeck(state, "p1", id);
    return fire === 0 ? state : handFromDeck(state, "p1", "fix-fire-energy", fire);
  }

  it("puts BOTH Energy on the ONE chosen body — the split the old model allowed", () => {
    const state = ohoBoard(31, ["fix-ethan-cyndaquil", "fix-ethan-pichu"], 3);
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { state: done, events } = mustApply(parked, pick(BENCH_0));
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(0);
    // Two ROWS, one per card, each naming its own uid and the SAME target.
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    expect(new Set(attached.map((e) => e.uid)).size).toBe(2);
    expect(attached.map((e) => e.target)).toEqual([
      { spot: "bench", index: 0 },
      { spot: "bench", index: 0 },
    ]);
  });

  it("asks EXACTLY ONCE — the batch is one decision, not two", () => {
    const state = ohoBoard(32, ["fix-ethan-cyndaquil", "fix-ethan-pichu"], 3);
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { state: done } = mustApply(parked, pick(BENCH_0));
    // A second park would leave the phase in effect:choose with one Energy placed.
    expect(done.phase.kind).toBe("turn:action");
  });

  it("takes both Energy OUT of the hand, and only the matching type", () => {
    let state = ohoBoard(33, ["fix-ethan-cyndaquil", "fix-ethan-pichu"], 2);
    state = handFromDeck(state, "p1", "fix-lightning-energy", 2);
    const handBefore = state.players.p1.hand.length;
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { state: done } = mustApply(parked, pick(BENCH_0));
    expect(done.players.p1.hand).toHaveLength(handBefore - 2);
    // `energyType: "Fire"` — the two {L} in hand are untouched, so a build that
    // filled the count from "any Basic Energy" reads four in hand, not two.
    expect(
      done.players.p1.hand.filter((uid) => done.cardIdByUid[uid] === "fix-lightning-energy"),
    ).toHaveLength(2);
  });

  it("'UP TO' — one matching Energy in hand attaches ONE, silently", () => {
    const state = ohoBoard(34, ["fix-ethan-cyndaquil"], 1);
    const parked = mustApply(state, useGoldenFlame).state;
    expect(choosePrompt(parked).upTo).toBe(2);
    const done = useAndTake(state);
    const events = mustApply(parked, pick(BENCH_0)).events;
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    // A shortfall is the PRINT ("up to"), not an error and not a refusal: the
    // Ability was usable and it did what it could.
    expect(
      done.players.p1.hand.filter((uid) => done.cardIdByUid[uid] === "fix-fire-energy"),
    ).toHaveLength(0);
  });

  it("the caption names the COUNT — the one fact the offered rows cannot show", () => {
    const state = ohoBoard(35, ["fix-ethan-cyndaquil", "fix-ethan-pichu"], 3);
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { note } = choosePrompt(parked);
    // "Attach the Energy to which of your …?" is a SINGULAR the print
    // contradicts, and the batch size is invisible from the rows because the
    // whole batch lands on whichever one is picked.
    expect(note).toContain("up to 2 Energy");
    expect(note).toContain("Benched Ethan's Pokémon");
  });

  it("REGRESSION — an op with NO count still attaches exactly one", () => {
    const streamer = programFor("sv09-053")?.abilities?.[0]?.program?.[0];
    expect(streamer).toEqual({
      op: "attachEnergyFrom",
      source: "hand",
      energyType: "Lightning",
      ownerPokemon: "Iono",
    });
    expect(streamer).not.toHaveProperty("count");
  });
});

describe("Ethan's Ho-Oh ex 'Golden Flame' — the 4 legal printings", () => {
  function ohoBoard(seed: number, bench: string[]): GameState {
    let state = withActive(seed, "fix-goldenflame");
    for (const id of bench) state = benchFromDeck(state, "p1", id);
    return handFromDeck(state, "p1", "fix-fire-energy", 3);
  }

  it("offers ONLY the Benched Ethan's Pokémon — not the Active, not another owner", () => {
    const state = ohoBoard(41, [
      "fix-ethan-cyndaquil",
      "fix-iono-body",
      "fix-plain",
      "fix-ethan-pichu",
    ]);
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { candidates } = choosePrompt(parked);
    expect(refNames(parked, candidates).sort()).toEqual(["Ethan's Cyndaquil", "Ethan's Pichu"]);
  });

  it("drops `Ethanite` — the possessive is matched WHOLE, not as a name prefix", () => {
    const state = ohoBoard(42, [
      "fix-ethan-cyndaquil",
      "fix-ethanite",
      "fix-lowercase",
      "fix-ethan-pichu",
    ]);
    const { state: parked } = mustApply(state, useGoldenFlame);
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Ethan's Cyndaquil",
      "Ethan's Pichu",
    ]);
  });

  it("WIRE SAFETY — a crafted frame naming an excluded body is REFUSED", () => {
    const state = ohoBoard(43, ["fix-ethan-cyndaquil", "fix-plain", "fix-ethan-pichu"]);
    const { state: parked } = mustApply(state, useGoldenFlame);
    // Bench index 1 is Pikachu — on the board, {R}-typed, and not a candidate.
    const rejected = applyAction(parked, pick(BENCH_1));
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected the illegal target to be rejected");
    expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("is ONCE per turn — the second use is refused, and the board is unchanged", () => {
    const state = ohoBoard(44, ["fix-ethan-cyndaquil"]);
    const once = useAndTake(state);
    expect(once.players.p1.bench[0]?.energy).toHaveLength(2);
    const again = applyAction(once, useGoldenFlame);
    expect(again.ok).toBe(false);
    // …and it never touched the §6.3 manual attach allowance, which is a
    // different allowance entirely.
    expect(once.players.p1.active?.energy ?? []).toHaveLength(0);
  });

  it("is STILL usable with only ONE matching Energy — the gate is not the count", () => {
    let state = withActive(45, "fix-goldenflame");
    state = benchFromDeck(state, "p1", "fix-ethan-cyndaquil");
    state = handFromDeck(state, "p1", "fix-fire-energy", 1);
    // `programPlayable` refuses an attach that could only whiff. "Up to 2" with
    // one {R} in hand is NOT a whiff — it attaches one, exactly as printed — so a
    // gate written against `count` would refuse the card on a board it works on.
    const done = useAndTake(state);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
  });

  it("is NOT usable with no matching Energy, nor with no Benched Ethan's Pokémon", () => {
    const noEnergy = (() => {
      let state = withActive(46, "fix-goldenflame");
      state = benchFromDeck(state, "p1", "fix-ethan-cyndaquil");
      return handFromDeck(state, "p1", "fix-lightning-energy", 2);
    })();
    // The hand holds Energy, just not {R}: the gate reads the TYPE, not the count.
    expect(applyAction(noEnergy, useGoldenFlame).ok).toBe(false);

    const noTarget = (() => {
      let state = withActive(47, "fix-goldenflame");
      state = benchFromDeck(state, "p1", "fix-plain");
      return handFromDeck(state, "p1", "fix-fire-energy", 2);
    })();
    // Ho-Oh itself is an Ethan's Pokémon but `benchOnly` excludes the Active, so
    // this board has NO eligible target and the Ability cannot be activated.
    expect(applyAction(noTarget, useGoldenFlame).ok).toBe(false);
  });

  it("all 4 legal printings carry ONE shared program object, with the count on it", () => {
    const first = programFor("sv10-039");
    expect(first?.abilities?.[0]?.name).toBe("Golden Flame");
    expect(first?.abilities?.[0]?.oncePerTurn).toBe(true);
    expect(first?.abilities?.[0]?.program).toEqual([
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Fire",
        count: 2,
        ownerPokemon: "Ethan",
        benchOnly: true,
      },
    ]);
    for (const id of ["sv10-039", "sv10-209", "sv10-230", "sv10-239"]) {
      expect(programFor(id), `${id} left the shared program`).toBe(first);
    }
    // The fixture carries the same object, so the driven cases above are the
    // catalog rows and not a look-alike.
    expect(programFor("fix-goldenflame")).toBe(first);
  });
});

// ── 3. The widened counter-move anchor, and the sentences it refuses ─────────

describe("`COUNTER_MOVE_TO_DEFENDER` — one optional capture, three refusals", () => {
  it("reads Wobbuffet's possessive into `ownerPokemon`", () => {
    expect(deriveAttackEffect(ROCKET_MIRROR)).toEqual([
      { op: "moveCountersToDefender", ownerPokemon: "Team Rocket" },
    ]);
  });

  it("leaves Dedenne ex's sentence BYTE-IDENTICAL — the key is omitted, not undefined", () => {
    const derived = deriveAttackEffect(TAIL_SWAP);
    expect(derived).toEqual([{ op: "moveCountersToDefender" }]);
    // `{ ownerPokemon: undefined }` would pass `toEqual` against the object above
    // in some comparisons and fail the registry value-compare in others, which is
    // the trap `CHOSEN_HEAL`'s `zone` arm already documents. Asserted directly.
    expect(derived?.[0]).not.toHaveProperty("ownerPokemon");
  });

  it("REFUSES 'Ancient' — the subgroup with no datum, one adjective away", () => {
    // The capture demands `'s `, so a MARK-subgroup sentence falls through the
    // whole anchor rather than deriving to an op with a permanently empty
    // candidate set — which would be a card whose attack silently does nothing.
    expect(deriveAttackEffect(PERPLEXING_TRANSFER)).toBeNull();
  });

  it("REFUSES the CHOSEN destination — D138's other axis, now a DIFFERENT op", () => {
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).toEqual([{ op: "moveCountersChosen" }]);
  });

  it("refuses a lowercase owner, and a possessive that is not a subgroup", () => {
    // No `/i`: the capture is `[A-Z]`-anchored, matching the exact-case rule the
    // predicate itself enforces. A lowercase prefix is not an owner.
    expect(deriveAttackEffect(ROCKET_MIRROR.replace("Team Rocket's", "team rocket's"))).toBeNull();
    // `'d`, not `'s ` — the Farfetch'd class, on the anchor rather than on the
    // predicate.
    expect(deriveAttackEffect(ROCKET_MIRROR.replace("Team Rocket's", "Farfetch'd"))).toBeNull();
  });

  it("keeps the apostrophe FOLD on both slots (D136/D137)", () => {
    const curly = ROCKET_MIRROR.replaceAll("'", "’");
    // Both possessives — the owner's and "your opponent's" — carry `['’]`, and
    // the fold must produce the SAME value rather than merely a non-null one.
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(ROCKET_MIRROR));
  });
});

describe("Team Rocket's Wobbuffet 'Rocket Mirror' — the 2 legal printings", () => {
  const ROCKET_MIRROR_INDEX = 0;
  /** A pile size that is not an HP, not a printed damage and not a round
      multiple of anything the epilogue computes. */
  const HURT = 80;
  const OTHER_HURT = 30;

  /** Wobbuffet Active with {P}{C} paid, the named bench, each body damaged. */
  function mirrorBoard(seed: number, bench: readonly [string, number][]): GameState {
    let state = withActive(seed, "fix-rocketmirror");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 2);
    for (const [id, damage] of bench) {
      state = benchFromDeck(state, "p1", id);
      state = setBenchDamage(state, "p1", state.players.p1.bench.length - 1, damage);
    }
    return state;
  }

  it("offers ONLY the Benched Team Rocket's Pokémon", () => {
    const state = mirrorBoard(51, [
      ["fix-tr-nidorino", HURT],
      ["fix-plain", OTHER_HURT],
      ["fix-tr-meowth", OTHER_HURT],
      ["fix-rocketeer", HURT],
    ]);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Team Rocket's Meowth",
      "Team Rocket's Nidorino",
    ]);
  });

  it("names the SUBGROUP in the caption, not 'your Benched Pokémon'", () => {
    const state = mirrorBoard(52, [
      ["fix-tr-nidorino", HURT],
      ["fix-tr-meowth", OTHER_HURT],
      ["fix-plain", HURT],
    ]);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    expect(choosePrompt(parked).note).toContain("Benched Team Rocket's Pokémon");
  });

  it("moves the pick's counters — one number, two rows, across the seat boundary", () => {
    const state = mirrorBoard(53, [
      ["fix-tr-nidorino", HURT],
      ["fix-tr-meowth", OTHER_HURT],
    ]);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    const { state: done, events } = mustApply(parked, pick(BENCH_0));
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // The OTHER Team Rocket's body kept its own pile — a build that moved
    // "whatever was on the Bench" reads 110 on the defender.
    expect(done.players.p1.bench[1]?.damage).toBe(OTHER_HURT);
    expect(done.players.p2.active?.damage).toBe(HURT);
    expect(findEvent(events, "HEALED")?.amount).toBe(HURT);
    expect(findEvent(events, "COUNTERS_PLACED")?.amount).toBe(HURT);
  });

  it("WIRE SAFETY — a crafted frame naming a non-subgroup body is REFUSED", () => {
    const state = mirrorBoard(54, [
      ["fix-tr-nidorino", HURT],
      ["fix-plain", HURT],
      ["fix-tr-meowth", OTHER_HURT],
    ]);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    // Bench index 1 is Pikachu — on the board, damaged, and not a candidate.
    // `validateChoice` reads the PROMPT the rider narrowed, never the op, so this
    // is refused by construction rather than by a second copy of the rule.
    const rejected = applyAction(parked, pick(BENCH_1));
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected the illegal source to be rejected");
    expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("is FORCED inline when the subgroup holds exactly one benched body", () => {
    const state = mirrorBoard(55, [
      ["fix-plain", HURT],
      ["fix-tr-nidorino", HURT],
      ["fix-rocketeer", HURT],
    ]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    // Three damaged benched bodies, ONE of them in the subgroup → no prompt.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findEvent(events, "COUNTERS_PLACED")?.amount).toBe(HURT);
    expect(done.players.p1.bench[1]?.damage).toBe(0);
  });

  it("a Bench with NO subgroup body resolves SILENTLY — no prompt, no move", () => {
    const state = mirrorBoard(56, [
      ["fix-plain", HURT],
      ["fix-rocketeer", HURT],
    ]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    // `parkOrForce`'s existing empty-candidate ending, which an empty Bench
    // already took: the attack resolves and the sentence does as much as it can,
    // i.e. nothing. Nothing is healed and nothing is placed.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "HEALED")).toEqual([]);
    expect(all(events, "COUNTERS_PLACED")).toEqual([]);
    expect(done.players.p1.bench[0]?.damage).toBe(HURT);
  });

  it("REGRESSION — the unmarked print still offers EVERY benched body", () => {
    let state = withActive(57, "fix-tailswap");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 2);
    for (const id of ["fix-tr-nidorino", "fix-plain", "fix-rocketeer"]) {
      state = benchFromDeck(state, "p1", id);
      state = setBenchDamage(state, "p1", state.players.p1.bench.length - 1, HURT);
    }
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Dedenne ex's sentence narrows nothing, so all three are candidates and the
    // caption says "your Benched Pokémon" with no possessive in it.
    expect(choosePrompt(parked).candidates).toHaveLength(3);
    expect(choosePrompt(parked).note).toBe(
      "Move the damage counters off which of your Benched Pokémon?",
    );
  });

  it("needs NO registry row — both legal printings resolve through the deriver", () => {
    for (const id of ["sv10-082", "svp-203"]) {
      expect(programFor(id)?.attack, `${id} grew a registry attack`).toBeUndefined();
    }
    expect(deriveAttackEffect(ROCKET_MIRROR)).not.toBeNull();
  });
});

describe("what this slice landed, in LEGAL printings", () => {
  it("lands SIX legal printings across two ops", () => {
    expect(LANDED.reduce((n, row) => n + row.legal, 0)).toBe(6);
    for (const row of LANDED) {
      expect(row.ids, `${row.card}: id list disagrees with its measured legal count`).toHaveLength(
        row.legal,
      );
      for (const id of row.ids) {
        const built =
          row.surface === "attack"
            ? deriveAttackEffect(row.sentence) !== null
            : programFor(id)?.abilities !== undefined;
        expect(built, `${id} (${row.card}) is listed as landed and is not built`).toBe(true);
      }
    }
  });
});

describe("LANDED BY D206 — Team Rocket's Giovanni sv10-174/-225/-238 (3 legal)", () => {
  const IDS = ["sv10-174", "sv10-225", "sv10-238"] as const;

  it("the UNMARKED `switchActive` still offers EVERY benched body — the regression half", () => {
    let state = withActive(61, "fix-plain");
    for (const id of ["fix-tr-nidorino", "fix-plain", "fix-rocketeer"]) {
      state = benchFromDeck(state, "p1", id);
    }
    state = handToDeck(state, "p1", "sv01-194");
    state = handFromDeck(state, "p1", "sv01-194", 1);
    const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === "sv01-194");
    if (uid === undefined) throw new Error("no fix-switch in hand");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Pikachu",
      "Team Rocket's Nidorino",
      "Team Rocketeer",
    ]);
    expect(choosePrompt(parked).note).not.toContain("Team Rocket's");
  });

  it("the 'If you do' seam D205 priced is §9.2's `recordGate`, and it SHIPPED", () => {
    const switchOp = programFor("sv01-194")?.trainer?.[0];
    expect(switchOp).toEqual({ op: "switchActive" });
    expect(switchOp).not.toHaveProperty("recordAs");
    expect(switchOp).not.toHaveProperty("ownerPokemon");
    for (const id of IDS) {
      expect(programFor(id)?.trainer, `${id} lost its D206 program`).toEqual([
        { op: "switchActive", ownerPokemon: "Team Rocket", recordAs: "moved" },
        { op: "recordGate", slot: "moved", ops: [{ op: "gust" }] },
      ]);
    }
  });

  it("names the printed sentence, so the row cannot drift onto another card", () => {
    expect(GIOVANNI).toContain("Team Rocket's Pokémon");
    expect(GIOVANNI).toContain("If you do");
  });
});

describe("LANDED at D565 (was FLAGGED) — Team Rocket's Orbeetle sv10-089/-198 (2 legal)", () => {
  const IDS = ["sv10-089", "sv10-198"] as const;

  it("every counter-move route ends on the OPPONENT's Active — driven", () => {
    let state = withActive(62, "fix-rocketmirror");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 2);
    state = benchFromDeck(state, "p1", "fix-tr-nidorino");
    state = setBenchDamage(state, "p1", 0, 80);
    state = benchFromDeck(state, "p1", "fix-tr-meowth");
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Forced (one damaged? no — both are candidates; the pick is parked), so
    // resolve it explicitly.
    const settled =
      done.phase.kind === "effect:choose" ? mustApply(done, pick(BENCH_0)).state : done;
    expect(settled.players.p1.bench[0]?.damage).toBe(0);
    expect(settled.players.p1.bench[1]?.damage).toBe(0);
    expect(settled.players.p2.active?.damage).toBe(80);
  });

  it("and the amount is the printed word 'all', where Orbeetle prints 1 — so D565 built a SIBLING", () => {
    expect(deriveAttackEffect(TAIL_SWAP)).toEqual([{ op: "moveCountersToDefender" }]);
    expect(ROCKET_BRAIN).toContain("move 1 damage counter");
    expect(ROCKET_BRAIN).toContain("to another of your Pokémon");
    for (const id of IDS) {
      const program = programFor(id);
      expect(program?.abilities, `${id} is built`).toEqual([
        {
          name: "Rocket Brain",
          oncePerTurn: false,
          activeOnly: false,
          program: [{ op: "moveCounterOwnChosen", ownerPokemon: "Team Rocket" }],
        },
      ]);
      expect(program?.triggered, `${id} is not a trigger`).toBeUndefined();
    }
  });
});

describe("FLAGGED — N's Zoroark ex sv09-098/-175/-185/-189 (4 legal)", () => {
  const IDS = ["sv09-098", "sv09-175", "sv09-185", "sv09-189"] as const;

  it("the ATTACK is built on NEITHER of these two routes ( D573: it is built on a THIRD, `deriveAttackCopy`), and the ABILITY is built", () => {
    for (const id of IDS) {
      expect(programFor(id)?.attack, `${id} grew a registry attack`).toBeUndefined();
      expect(programFor(id)?.abilities?.[0]?.name, `${id} lost its Trade Ability`).toBe("Trade");
    }
    expect(deriveAttackEffect(NIGHT_JOKER)).toBeNull();
    expect(deriveAttackCopy(NIGHT_JOKER)).toEqual({ from: "benchOwner", owner: "N" });
  });

  it("names the piece: an attack-COPY, of which the target predicate is the least", () => {
    expect(NIGHT_JOKER).toContain("Benched N's Pokémon's attacks");
    expect(NIGHT_JOKER).toContain("use it as this attack");
  });
});

describe("FLAGGED — the two counter-move sentences the widened anchor refuses", () => {
  it("Cofagrigus sv10.5w-040/-123 (2 legal) — BUILT AT D216, and still not by THIS anchor", () => {
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).toEqual([{ op: "moveCountersChosen" }]);
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
    for (const id of ["sv10.5w-040", "sv10.5w-123"]) {
      expect(programFor(id)?.attack, `${id} grew a registry row`).toBeUndefined();
    }
  });

  it("Flutter Mane sv08-096 (1 legal) — 'Ancient' has NO DATUM to read ( D569: the datum is an engine table; built as a registry row)", () => {
    expect(deriveAttackEffect(PERPLEXING_TRANSFER)).toBeNull();
    expect(programFor("sv08-096")?.attack?.[0]).toEqual([
      { op: "moveCountersToDefender", filter: { kind: "bannerPokemon", banner: "Ancient" } },
    ]);
    const sample = Object.values(FIXTURE_POOL).find((card) => card.category === "Pokemon");
    const keys = Object.keys(sample ?? {});
    expect(keys.filter((key) => /^(regulationMark|banner|subtypes|tags|marks)$/.test(key))).toEqual(
      ["regulationMark"],
    );
    expect(keys).not.toContain("subtypes");
    const roaringMoon = battler("fix-ancient", { name: "Roaring Moon ex", hp: 230 });
    expect(matchesFilter(roaringMoon, { kind: "ownerPokemon", owner: "Ancient" })).toBe(false);
  });
});

// ── 7. FIXTURE_POOL as a SEPARATE population, and MATCH_RECORD_VERSION ───────

describe("FIXTURE_POOL, swept as its own population", () => {
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

  it("holds NO attack that the widened anchor newly resolves", () => {
    const newlyRead = Object.values(FIXTURE_POOL).flatMap((card) =>
      (card.attacks ?? [])
        .map((attack) => attack.effect ?? "")
        .filter((text) => {
          const derived = deriveAttackEffect(text)?.[0];
          return (
            derived?.op === "moveCountersToDefender" &&
            (derived as { ownerPokemon?: string }).ownerPokemon !== undefined
          );
        }),
    );
    expect(newlyRead).toEqual([]);
  });
});

describe("MATCH_RECORD_VERSION — the derivation, not the habit", () => {
  it("STAYS 12, and the park question is asked rather than assumed", () => {
    expect(deriveAttackEffect(TAIL_SWAP)).toEqual([{ op: "moveCountersToDefender" }]);
    const streamer = programFor("sv09-053")?.abilities?.[0]?.program?.[0];
    expect(streamer).not.toHaveProperty("count");
    // And the candidate sets are materialised in `phase.prompt.candidates` rather
    // than recomputed from the op on resume, so a resumed decision does not
    // re-read either parameter to decide what was legal.
    let state = withActive(71, "fix-goldenflame");
    state = benchFromDeck(state, "p1", "fix-ethan-cyndaquil");
    state = benchFromDeck(state, "p1", "fix-ethan-pichu");
    state = handFromDeck(state, "p1", "fix-fire-energy", 2);
    const { state: parked } = mustApply(state, useGoldenFlame);
    expect(choosePrompt(parked).candidates).toHaveLength(2);
  });
});
