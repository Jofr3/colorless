import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  discardFromDeck,
  setActiveFromDeck,
  specialEnergy,
  typedEnergy,
  findEvent,
  driveSetup,
} from "./testFixtures";

const MAGNETON = "svp-153";
const MAGNETON_PROMO = "svp-159";
const MAGNETON_SURGING = "sv08-059";
const MAGNETON_IDS = [MAGNETON, MAGNETON_PROMO, MAGNETON_SURGING] as const;

const ABILITY = "Overvolt Discharge";
const MAGNETON_TEXT =
  "Once during your turn, you may attach up to 3 Basic Energy cards from your discard pile to your {L} Pokémon in any way you like. If you use this Ability, this Pokémon is Knocked Out.";

/** A second {L} body with NO Ability — a destination and never a source, so a case
    that attaches "to another {L} Pokémon" is not secretly attaching to a Magneton. */
const LIGHTNING_A = "fix-d346-lightning-a";
const LIGHTNING_B = "fix-d346-lightning-b";
/** A NON-{L} body: excluded by `targetType` and by nothing else. */
const FIGHTING = "fix-d346-fighting";
const WALL = "fix-d346-wall";
const ENERGY_L = "fix-d346-energy-lightning";
const ENERGY_F = "fix-d346-energy-fighting";
const ENERGY_W = "fix-d346-energy-water";
const ENERGY_SPECIAL = "fix-d346-energy-special";

const LOCAL_CARDS: Record<string, Card> = Object.fromEntries([
  ...MAGNETON_IDS.map((id) => [
    id,
    battler(id, {
      name: "Magneton",
      stage: "Stage1",
      evolveFrom: "Magnemite",
      hp: 100,
      retreat: 1,
      types: ["Lightning"],
      weaknesses: [{ type: "Fighting", value: "×2" }],
      abilities: [{ type: "Ability", name: ABILITY, effect: MAGNETON_TEXT }],
      attacks: [{ cost: ["Lightning", "Colorless"], name: "Electric Ball", damage: 40 }],
    }),
  ]),
  [
    LIGHTNING_A,
    battler(LIGHTNING_A, {
      name: "D346 Lightning A",
      hp: 120,
      retreat: 1,
      types: ["Lightning"],
      attacks: [{ cost: ["Lightning"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    LIGHTNING_B,
    battler(LIGHTNING_B, {
      name: "D346 Lightning B",
      hp: 120,
      retreat: 1,
      types: ["Lightning"],
      attacks: [{ cost: ["Lightning"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    FIGHTING,
    battler(FIGHTING, {
      name: "D346 Fighting",
      hp: 120,
      retreat: 1,
      types: ["Fighting"],
      attacks: [{ cost: ["Fighting"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    WALL,
    battler(WALL, {
      name: "D346 Wall",
      hp: 330,
      retreat: 1,
      types: ["Colorless"],
      attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    }),
  ],
  [ENERGY_L, typedEnergy(ENERGY_L, "Lightning")],
  [ENERGY_F, typedEnergy(ENERGY_F, "Fighting")],
  [ENERGY_W, typedEnergy(ENERGY_W, "Water")],
  [ENERGY_SPECIAL, specialEnergy(ENERGY_SPECIAL, "D346 Special Energy")],
]) as Record<string, Card>;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// Every body this suite seats is drawn OUT OF THE DECK by the fixture helpers, so
// these counts are the deepest board any case builds rather than decoration.
const DECK = deckOf({
  [MAGNETON]: 4,
  [MAGNETON_PROMO]: 4,
  [MAGNETON_SURGING]: 4,
  [LIGHTNING_A]: 6,
  [LIGHTNING_B]: 6,
  [FIGHTING]: 6,
  [WALL]: 8,
  [ENERGY_L]: 8,
  [ENERGY_F]: 6,
  [ENERGY_W]: 4,
  [ENERGY_SPECIAL]: 4,
});

function step(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** Seat exactly the bodies each side names, Active first, on p1's turn. */
function board(spec: { p1: readonly string[]; p2: readonly string[] }, seed = 4): GameState {
  let state = localSetup(seed, "p1");
  for (const seat of ["p1", "p2"] as const) {
    const ids = seat === "p1" ? spec.p1 : spec.p2;
    state = setActiveFromDeck(state, seat, ids[0] ?? WALL);
    state = clearBench(state, seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

function discharge(
  state: GameState,
  target: { spot: "active" } | { spot: "bench"; index: number },
) {
  return step(state, { type: "useAbility", seat: "p1", target, abilityName: ABILITY });
}

/** Answer one `attachEnergyFrom` park with a destination. Asserts the park shape on
    the way through, so a case that stopped parking fails HERE rather than by
    quietly landing fewer cards. */
function attachTo(state: GameState, ref: PokemonRef) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  return step(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
}

function energyCount(state: GameState, ref: PokemonRef): number {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return body?.energy.length ?? 0;
}

describe("D346 §1 — the registry row, read off the LIVE registry", () => {
  it("all THREE printings resolve to ONE program object, by identity", () => {
    const first = programFor(MAGNETON);
    expect(first).toBeDefined();
    for (const id of MAGNETON_IDS) expect(programFor(id), id).toBe(first);
  });

  it("the program is THREE `attachEnergyFrom` ops and NOT `count: 3`", () => {
    const program = programFor(MAGNETON)?.abilities?.[0]?.program;
    expect(program).toHaveLength(4);
    const attaches = program?.slice(0, 3) ?? [];
    expect(attaches).toEqual([
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
      { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
    ]);
    // …and no `count` anywhere in the program, which is the same claim from the
    // other side and survives a re-ordering of the fields above.
    expect(JSON.stringify(program)).not.toContain("count");
  });

  it("`knockOutSelf` is LAST, field-free, and the ONLY non-attach op", () => {
    const program = programFor(MAGNETON)?.abilities?.[0]?.program;
    expect(program?.[3]).toEqual({ op: "knockOutSelf" });
    // Field-free: the op carries nothing, so `toEqual` above is the whole shape.
    expect(Object.keys(program?.[3] ?? {})).toEqual(["op"]);
  });

  it("the Ability is `oncePerTurn`, NOT `activeOnly`, and named as printed", () => {
    const ability = programFor(MAGNETON)?.abilities?.[0];
    expect(ability?.name).toBe(ABILITY);
    expect(ability?.oncePerTurn).toBe(true);
    // The sentence names no spot, so a BENCHED Magneton discharges and dies on the
    // Bench — which is how the card is played, and the case below drives it.
    expect(ability?.activeOnly).toBe(false);
  });

  it("all THREE ids are in the live registry and no fourth rode along", () => {
    const ids = new Set(registryCardIds());
    for (const id of MAGNETON_IDS) expect(ids.has(id), id).toBe(true);
    const named = registryCardIds().filter((id) =>
      programFor(id)?.abilities?.some((a) => a.name === ABILITY),
    );
    expect(named.sort()).toEqual([...MAGNETON_IDS].sort());
  });

  it("`knockOutSelf` now has exactly THREE producers in the whole registry", () => {
    const objects = new Set(
      registryCardIds()
        .map((id) => programFor(id))
        .filter((program) =>
          [...(program?.abilities ?? []), ...(program?.triggered ?? [])].some((ability) =>
            ability.program.some((op) => op.op === "knockOutSelf"),
          ),
        ),
    );
    expect(objects.size).toBe(3);
  });
});

describe("D346 §2 — the DISTRIBUTION: three cards, three bodies, three parks", () => {
  it("three attaches land on THREE DIFFERENT {L} Pokémon, then the host dies", () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A, LIGHTNING_B], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 3);
    const host = state.players.p1.active?.stack.at(-1);

    let cur = discharge(state, { spot: "active" }).state;
    cur = attachTo(cur, benchRef(0)).state; // #1 → Lightning A
    cur = attachTo(cur, benchRef(1)).state; // #2 → Lightning B
    const { state: after, events } = attachTo(cur, ACTIVE); // #3 → the Magneton itself

    expect(energyCount(after, benchRef(0))).toBe(1);
    expect(energyCount(after, benchRef(1))).toBe(1);
    // …and the printed cost resolves on the SAME resume as the last attach.
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(host);
    expect(after.players.p1.active).toBeNull();
  });

  it("…and it may equally land ALL THREE on ONE body — the split is the PLAYER's", () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 3);
    let cur = discharge(state, { spot: "active" }).state;
    for (const _ of [0, 1, 2]) cur = attachTo(cur, benchRef(0)).state;
    expect(energyCount(cur, benchRef(0))).toBe(3);
  });

  it("the three parks are SEQUENTIAL, not one compound prompt", () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 3);
    let cur = discharge(state, { spot: "active" }).state;
    for (const _ of [0, 1]) {
      if (cur.phase.kind !== "effect:choose") throw new Error("expected a park");
      expect(cur.phase.prompt.kind).toBe("choosePokemon");
      cur = attachTo(cur, benchRef(0)).state;
    }
    if (cur.phase.kind !== "effect:choose") throw new Error("expected a third park");
    expect(cur.phase.prompt.kind).toBe("choosePokemon");
  });
});

describe("D346 §3 — the two printed NOUNS, each narrowing a different thing", () => {
  it("`targetType` is the DESTINATION noun: a non-{L} body is never offered", () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A, FIGHTING, WALL], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const parked = discharge(state, { spot: "active" }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const candidates = parked.phase.prompt.candidates;
    // The Magneton (Active, {L}) and Lightning A (bench 0) only — the {F} body and
    // the {C} Wall are excluded by `targetType` and by nothing else.
    expect(candidates).toHaveLength(2);
    expect(candidates.some((c) => c.spot.spot === "bench" && c.spot.index === 1)).toBe(false);
    expect(candidates.some((c) => c.spot.spot === "bench" && c.spot.index === 2)).toBe(false);
  });

  it("NO `energyType`: a Basic {F} and a Basic {W} are BOTH attachable", () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_F, 1);
    state = discardFromDeck(state, "p1", ENERGY_W, 1);
    let cur = discharge(state, { spot: "active" }).state;
    cur = attachTo(cur, benchRef(0)).state;
    if (cur.phase.kind !== "effect:choose" || cur.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected the card question");
    }
    const offered = cur.phase.prompt.candidates;
    expect(offered.map((u) => cur.cardIdByUid[u])).toEqual([ENERGY_F, ENERGY_W]);
    cur = step(cur, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [offered[1] as string] },
    }).state;
    const { state: after } = attachTo(cur, benchRef(0));
    expect(energyCount(after, benchRef(0))).toBe(2);
    expect(after.players.p1.bench[0]?.energy).toEqual([offered[1], offered[0]]);
  });

  it('…but a SPECIAL Energy is out of reach — the printed word is "Basic"', () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_SPECIAL, 3);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(result.ok).toBe(false);
  });
});

describe('D346 §4 — the printed "UP TO", and the KO that is not conditional on it', () => {
  it("one card in the pile attaches ONE and the host STILL dies", () => {
    // `min(3, available)`: ops 2 and 3 find nothing and no-op silently, and the KO
    // is not gated on how many landed — "If you use this Ability" is the whole
    // condition.
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const host = state.players.p1.active?.stack.at(-1);
    const parked = discharge(state, { spot: "active" }).state;
    const { state: after, events } = attachTo(parked, benchRef(0));
    expect(energyCount(after, benchRef(0))).toBe(1);
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(host);
  });

  it("the Knock Out is a real §8.1 one: the OPPONENT takes a Prize, mid-p1's-turn", () => {
    let state = board({ p1: [WALL, MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const parked = discharge(state, { spot: "bench", index: 0 }).state;
    const { state: after } = attachTo(parked, benchRef(1));
    // p1 blew up its OWN body, so the Prize is p2's — during p1's turn.
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p2");
    expect(after.phase.count).toBe(1);
    const { state: done } = step(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] });
    expect(done.players.p2.prizes).toHaveLength(5);
    // A BENCHED Knock Out owes no promotion, so the turn comes straight back.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("Energy attached to the HOST dies with it — the order is load-bearing", () => {
    let state = board({ p1: [WALL, MAGNETON], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const host = benchTopUid(state, "p1", 0);
    const parked = discharge(state, { spot: "bench", index: 0 }).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const { state: after } = attachTo(parked, benchRef(0));
    expect(after.players.p1.discard).toContain(host);
    expect(after.players.p1.bench).toHaveLength(0);
  });

  it("an ACTIVE discharge empties the Active Spot and owes a promotion", () => {
    let state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 1);
    const parked = discharge(state, { spot: "active" }).state;
    const { state: after } = attachTo(parked, benchRef(0));
    expect(after.players.p1.active).toBeNull();
    // The promotion is §8.1's, queued once the whole program settled — not the op's.
    const phases = [after.phase.kind];
    expect(phases.some((k) => k === "ko:takePrizes" || k === "ko:promote")).toBe(true);
  });
});

describe("D346 §5 — the GATE, and the design call it makes", () => {
  it("an empty discard pile REFUSES the Ability rather than offering a bare suicide", () => {
    const state = board({ p1: [MAGNETON, LIGHTNING_A], p2: [WALL] });
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(result.ok).toBe(false);
  });

  it("the gate's OTHER arm is UNREACHABLE on this card, and that is a fact about the print", () => {
    let state = board({ p1: [WALL, MAGNETON, FIGHTING], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 3);
    const host = benchTopUid(state, "p1", 0);
    let after = discharge(state, { spot: "bench", index: 0 }).state;
    let events: GameEvent[] = [];
    for (const _ of [0, 1, 2]) {
      const answered = attachTo(after, benchRef(0));
      after = answered.state;
      events = [...events, ...answered.events];
    }
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(host);
    // Nothing reached the {F} body: it was never a candidate.
    expect(after.players.p1.bench.every((b) => b.energy.length === 0)).toBe(true);
    expect(after.players.p1.discard).toContain(host);
  });

  it("the once-per-turn lock is PER BODY: the second Magneton still discharges", () => {
    // Nothing prints "you can't use more than 1 Overvolt Discharge Ability each
    // turn", so `oncePerTurn` is the default per-body scope: two Magneton are two
    // uses and two Prizes given up.
    let state = board({ p1: [WALL, MAGNETON, MAGNETON_PROMO, LIGHTNING_A], p2: [WALL] });
    state = discardFromDeck(state, "p1", ENERGY_L, 6);
    let cur = discharge(state, { spot: "bench", index: 0 }).state;
    for (const _ of [0, 1, 2]) cur = attachTo(cur, benchRef(2)).state;
    // The first Magneton is gone; the second slid down to index 0 and is unlocked.
    const settled =
      cur.phase.kind === "ko:takePrizes"
        ? step(cur, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state
        : cur;
    expect(settled.players.p1.bench).toHaveLength(2);
    const second = applyAction(settled, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: ABILITY,
    });
    expect(second.ok).toBe(true);
  });
});

describe("D346 §6 — the attribution controls", () => {
  it("the local fixture really carries the REGISTRY program, not just Ability TEXT", () => {
    for (const id of MAGNETON_IDS) expect(programFor(id), id).toBeDefined();
    for (const id of MAGNETON_IDS) {
      expect(LOCAL_CARDS[id]?.abilities?.[0]?.name, id).toBe(ABILITY);
    }
  });

  it("the fixture's Ability text is the catalog's, character for character", () => {
    // The round-trip this file can run and `effects.ts` cannot: a fixture that
    // paraphrases the print is a different card being tested under the right name.
    expect(MAGNETON_TEXT).toContain("in any way you like");
    expect(MAGNETON_TEXT).toContain("If you use this Ability, this Pokémon is Knocked Out.");
    expect(MAGNETON_TEXT).toContain("up to 3 Basic Energy cards from your discard pile");
    expect(MAGNETON_TEXT).toContain("to your {L} Pokémon");
  });

  it("nothing this suite adds reached `FIXTURE_POOL` — the census cost is ZERO", () => {
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(Object.hasOwn(FIXTURE_POOL, id), id).toBe(false);
    }
  });
});
