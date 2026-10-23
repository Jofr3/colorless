import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
  must,
  firstBasicInHand,
} from "./testFixtures";

const DUSCLOPS = "sv06.5-019";
const DUSCLOPS_REPRINT = "sv06.5-069";
const DUSCLOPS_PRISMATIC = "sv08.5-036";
const DUSKNOIR = "sv06.5-020";
const DUSKNOIR_REPRINT = "sv06.5-070";
const DUSKNOIR_PRISMATIC = "sv08.5-037";

const DUSCLOPS_IDS = [DUSCLOPS, DUSCLOPS_REPRINT, DUSCLOPS_PRISMATIC] as const;
const DUSKNOIR_IDS = [DUSKNOIR, DUSKNOIR_REPRINT, DUSKNOIR_PRISMATIC] as const;

const MAGNETON_IDS = ["svp-153", "svp-159", "sv08-059"] as const;

const CLAUSE = "If you use this Ability, this Pokémon is Knocked Out.";
const DUSCLOPS_TEXT = `Once during your turn, you may put 5 damage counters on 1 of your opponent's Pokémon. ${CLAUSE}`;
const DUSKNOIR_TEXT = `Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. ${CLAUSE}`;

const WEAK_TO_PSYCHIC = "fix-d345-psychic-weak";
const WALL = "fix-d345-wall";
const CHAFF = "fix-d345-chaff";
const AURA = "sv09-037";
const ENERGY = "fix-d345-energy";

const LOCAL_CARDS: Record<string, Card> = Object.fromEntries([
  ...DUSCLOPS_IDS.map((id) => [
    id,
    battler(id, {
      name: "Dusclops",
      stage: "Stage1",
      evolveFrom: "Duskull",
      hp: 90,
      retreat: 2,
      types: ["Psychic"],
      abilities: [{ type: "Ability", name: "Cursed Blast", effect: DUSCLOPS_TEXT }],
      attacks: [{ cost: ["Psychic", "Psychic"], name: "Will-O-Wisp", damage: 50 }],
    }),
  ]),
  ...DUSKNOIR_IDS.map((id) => [
    id,
    battler(id, {
      name: "Dusknoir",
      stage: "Stage2",
      evolveFrom: "Dusclops",
      hp: 160,
      retreat: 3,
      types: ["Psychic"],
      abilities: [{ type: "Ability", name: "Cursed Blast", effect: DUSKNOIR_TEXT }],
      attacks: [
        {
          cost: ["Psychic", "Psychic", "Colorless"],
          name: "Shadow Bind",
          effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
          damage: 150,
        },
      ],
    }),
  ]),
  [
    WEAK_TO_PSYCHIC,
    battler(WEAK_TO_PSYCHIC, {
      name: "D345 Psychic-weak",
      hp: 200,
      retreat: 1,
      types: ["Fighting"],
      weaknesses: [{ type: "Psychic", value: "×2" }],
      attacks: [{ cost: ["Fighting"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    WALL,
    battler(WALL, {
      name: "D345 Wall",
      hp: 330,
      retreat: 1,
      types: ["Colorless"],
      attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    CHAFF,
    battler(CHAFF, {
      name: "D345 Chaff",
      hp: 60,
      retreat: 1,
      types: ["Colorless"],
      attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    AURA,
    battler(AURA, {
      name: "Ludicolo",
      stage: "Stage2",
      evolveFrom: "Lombre",
      hp: 150,
      retreat: 2,
      types: ["Grass"],
      abilities: [
        {
          type: "Ability",
          name: "Vibrant Dance",
          effect:
            "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack.",
        },
      ],
      attacks: [{ cost: ["Grass", "Colorless", "Colorless"], name: "Solar Beam", damage: 120 }],
    }),
  ],
  [ENERGY, typedEnergy(ENERGY, "Psychic")],
]) as Record<string, Card>;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 6 × 4 + 8 + 8 + 8 + 4 + 8 = 60. Every body this suite seats is drawn OUT OF THE
// DECK by the fixture helpers, so these counts are the deepest board any case
// builds rather than decoration.
const DECK = deckOf({
  [DUSCLOPS]: 4,
  [DUSCLOPS_REPRINT]: 4,
  [DUSCLOPS_PRISMATIC]: 4,
  [DUSKNOIR]: 4,
  [DUSKNOIR_REPRINT]: 4,
  [DUSKNOIR_PRISMATIC]: 4,
  [WEAK_TO_PSYCHIC]: 8,
  [WALL]: 8,
  [CHAFF]: 8,
  [AURA]: 4,
  [ENERGY]: 8,
});

function step(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
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

function activeUid(state: GameState, seat: Seat): string {
  const uid = state.players[seat].active?.stack.at(-1);
  if (uid === undefined) throw new Error(`${seat} has no Active`);
  return uid;
}

function blast(state: GameState, target: { spot: "active" } | { spot: "bench"; index: number }) {
  return step(state, { type: "useAbility", seat: "p1", target, abilityName: "Cursed Blast" });
}

describe("D345 §1 — the two registry rows, read off the LIVE registry", () => {
  it("each card's THREE printings resolve to ONE program object, by identity", () => {
    for (const ids of [DUSCLOPS_IDS, DUSKNOIR_IDS]) {
      const first = programFor(ids[0]);
      expect(first).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(first);
    }
  });

  it("the two SENTENCES are two DISTINCT objects — D199's near-twin rule", () => {
    // One field apart (50 vs 130) and still two objects, because two printed
    // sentences are two things. Asserted by identity in BOTH directions so a
    // future edit that collapses them into a factory call goes red here.
    expect(programFor(DUSCLOPS)).not.toBe(programFor(DUSKNOIR));
    expect(programFor(DUSCLOPS)).not.toEqual(programFor(DUSKNOIR));
  });

  it("each program carries an `abilities` table and NOTHING else", () => {
    for (const id of [DUSCLOPS, DUSKNOIR]) {
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
      expect(programFor(id)?.abilities, id).toHaveLength(1);
    }
  });

  it("the ability is `Cursed Blast`, once per turn PER BODY, with no spot clause", () => {
    for (const id of [DUSCLOPS, DUSKNOIR]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name, id).toBe("Cursed Blast");
      // The DEFAULT scope, not `"sharedByName"` — nothing here prints "you can't
      // use more than 1 Cursed Blast Ability each turn", so two Dusclops on one
      // board are two uses.
      expect(ability?.oncePerTurn, id).toBe(true);
      // The sentence names no spot, so a BENCHED body blasts (§3 drives it).
      expect(ability?.activeOnly, id).toBe(false);
      // No printed board gate and no per-body gate.
      expect(ability?.playableIf, id).toBeUndefined();
    }
  });

  it("the program is the printed order: the snipe, THEN the self-Knock-Out", () => {
    expect(programFor(DUSCLOPS)?.abilities?.[0]?.program).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 50, count: 1, source: "ability" },
      { op: "knockOutSelf" },
    ]);
    expect(programFor(DUSKNOIR)?.abilities?.[0]?.program).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 130, count: 1, source: "ability" },
      { op: "knockOutSelf" },
    ]);
  });

  it("the amounts are HP and the ×10 was done at the PRODUCER — 5 → 50, 13 → 130", () => {
    // The one place a reader of `damageChosen` can be off by a factor of ten. The
    // printed COUNTERS are read back out of the fixture text so this cannot drift
    // from the card: the number in the sentence times ten is the number in the op.
    for (const [id, text] of [
      [DUSCLOPS, DUSCLOPS_TEXT],
      [DUSKNOIR, DUSKNOIR_TEXT],
    ] as const) {
      const printed = Number(/put (\d+) damage counters/.exec(text)?.[1]);
      const op = programFor(id)?.abilities?.[0]?.program?.[0];
      expect(op, id).toMatchObject({ op: "damageChosen", amount: printed * 10 });
    }
  });

  it("the snipe carries NO rider — not optional, not `deals`, not `ignoreWR`", () => {
    for (const id of [DUSCLOPS, DUSKNOIR]) {
      const op = programFor(id)?.abilities?.[0]?.program?.[0];
      // The printed "you may" governs USING the Ability; once used, the placement
      // is mandatory. `optional` is Hawlucha's auto-fired TRIGGER shape.
      expect(op).not.toHaveProperty("optional");
      // "put damage counters" is not damage: flat, no W/R (§4 drives it).
      expect(op).not.toHaveProperty("deals");
      expect(op).not.toHaveProperty("ignoreWR");
    }
  });

  it("`knockOutSelf` is FIELD-FREE, and that is the census rather than a shortcut", () => {
    for (const id of [DUSCLOPS, DUSKNOIR]) {
      expect(programFor(id)?.abilities?.[0]?.program?.[1]).toEqual({ op: "knockOutSelf" });
    }
    expect(Object.keys(programFor(DUSCLOPS)?.abilities?.[0]?.program?.[1] ?? {})).toEqual(["op"]);
  });

  it("all SIX ids are in the live registry and no seventh rode along", () => {
    const ids = new Set(registryCardIds());
    for (const id of [...DUSCLOPS_IDS, ...DUSKNOIR_IDS]) expect(ids.has(id), id).toBe(true);
    // The pool of ids carrying THIS ability name is exactly the six — a seventh
    // would mean Magneton was quietly authored on the strength of the shared op.
    const named = registryCardIds().filter((id) =>
      programFor(id)?.abilities?.some((a) => a.name === "Cursed Blast"),
    );
    expect(named.sort()).toEqual([...DUSCLOPS_IDS, ...DUSKNOIR_IDS].sort());
  });
});

describe("D346 — §2's REFUSAL IS SPENT: the clause's THIRD sentence is BUILT", () => {
  it("Magneton ×3 IS authored, on ONE object, sharing this op", () => {
    const first = programFor(MAGNETON_IDS[0]);
    expect(first).toBeDefined();
    for (const id of MAGNETON_IDS) expect(programFor(id), id).toBe(first);
    expect(first?.abilities?.[0]?.name).toBe("Overvolt Discharge");
  });

  it("`knockOutSelf` has exactly THREE producers in the whole registry", () => {
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

describe("D345 §3 — Cursed Blast from the BENCH: the counters land, the host dies", () => {
  it("parks on the opponent's WHOLE board, Active first — `opponentAny`", () => {
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF, CHAFF] });
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.note).toContain("of your opponent's Pokémon");
  });

  it("5 counters land FLAT on a benched pick, and the Dusclops is Knocked Out", () => {
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF] });
    const blaster = benchTopUid(state, "p1", 0);
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 50, source: "ability" });
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(after.players.p2.bench[0]?.damage).toBe(50);
    // And the printed cost: the host is Knocked Out in the SAME resolution.
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(blaster);
    expect(after.players.p1.bench).toHaveLength(0);
  });

  it("the Knock Out is a real §8.1 one: the OPPONENT takes a Prize, mid-p1's-turn", () => {
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF] });
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    // p1 blew up its OWN body, so the Prize is p2's — during p1's turn, which is
    // the whole oddity of this card and exactly what §8.1 says.
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p2");
    expect(after.phase.count).toBe(1); // not an `ex`
    const { state: done } = step(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] });
    expect(done.players.p2.prizes).toHaveLength(5);
    expect(done.players.p1.prizes).toHaveLength(6);
    // A BENCHED Knock Out owes no promotion, so the turn comes straight back.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("the whole stack goes to the KO'd side's discard, not the opponent's", () => {
    const state = board({ p1: [WALL, DUSKNOIR], p2: [WALL, CHAFF] });
    const blaster = benchTopUid(state, "p1", 0);
    const before = state.players.p1.discard.length;
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(events, "KNOCKED_OUT")?.seat).toBe("p1");
    expect(after.players.p1.discard).toContain(blaster);
    expect(after.players.p1.discard.length).toBe(before + 1);
    expect(after.players.p2.discard).not.toContain(blaster);
  });

  it("the once-per-turn lock is PER BODY: two Dusclops, two blasts, two Prizes", () => {
    let state = board({ p1: [WALL, DUSCLOPS, DUSCLOPS_REPRINT], p2: [WALL, CHAFF] });
    for (const _ of [0, 1]) {
      const parked = blast(state, { spot: "bench", index: 0 }).state;
      if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
      const after = step(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
      }).state;
      if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
      state = step(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state;
    }
    // 100 HP of counters on one benched CHAFF (60 HP) would have KO'd it, so the
    // second blast is aimed at the same body only through the prompt above — the
    // point here is the two SELF Knock Outs and the two Prizes they bought p2.
    expect(state.players.p2.prizes).toHaveLength(4);
    expect(state.players.p1.bench).toHaveLength(0);
  });
});

describe("D345 §4 — 'is Knocked Out' is NOT damage, and the counters are NOT attack damage", () => {
  it("the counters stay FLAT on a Weakness-matching ACTIVE — no ×2", () => {
    // `opponentAny` lands on the Active, which for an ATTACK would run §8.5. This
    // is a PLACEMENT (`source: "ability"`, no `deals`), so Weakness never fires:
    // 50 on a ×2-Psychic body is 50, and the Dusclops is Psychic.
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WEAK_TO_PSYCHIC, CHAFF] });
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(50);
    expect(after.players.p2.active?.damage).toBe(50); // 50, not 100
  });

  it("the host dies with NO `DAMAGED`/`COUNTERS_PLACED` row of its own", () => {
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF] });
    const blaster = benchTopUid(state, "p1", 0);
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    const aboutTheHost = events.filter(
      (e) => "uid" in e && e.uid === blaster && e.type !== "ABILITY_USED",
    );
    expect(aboutTheHost.map((e) => e.type)).toEqual(["KNOCKED_OUT"]);
  });

  it("an HP AURA on the host's own side is read AT THE MOMENT THE OP RUNS", () => {
    expect(programFor(AURA)?.passive?.seatHpBonus).toEqual({
      ability: "Vibrant Dance",
      amount: 40,
      noStack: true,
    });
    const state = board({ p1: [WALL, DUSCLOPS, AURA], p2: [WALL, CHAFF] });
    const blaster = benchTopUid(state, "p1", 0);
    // 90 printed + 40 seat-wide = 130, and the op must meet the EFFECTIVE number.
    expect(state.players.p1.bench[0]?.damage).toBe(0);
    const { state: parked } = blast(state, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(blaster);
    // Exactly ONE body left play, and it is not the Ludicolo: the aura raises the
    // whole side's maximum, so a mark aimed at the wrong body would kill the
    // SOURCE of the number it was aiming at.
    expect(events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(1);
    expect(after.players.p1.bench).toHaveLength(1);
    expect(after.players.p1.bench[0]?.stack.at(-1)).not.toBe(blaster);
  });

  it("an ALREADY-DAMAGED host is not healed by the marking — `Math.max`, not `=`", () => {
    const seeded = board({ p1: [WALL, DUSCLOPS], p2: [WALL, CHAFF] });
    const damaged: GameState = {
      ...seeded,
      players: {
        ...seeded.players,
        p1: {
          ...seeded.players.p1,
          bench: seeded.players.p1.bench.map((body, i) =>
            i === 0 ? { ...body, damage: 80 } : body,
          ),
        },
      },
    };
    const { state: parked } = blast(damaged, { spot: "bench", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
  });
});

describe("D345 §5 — the ACTIVE Spot: §8.1's promotion, through the shared seam", () => {
  it("an ACTIVE Dusknoir blasts, dies, and owes a PROMOTION after the Prize", () => {
    // TWO benched bodies behind the blaster on purpose: §8.1's promotion
    // AUTO-RESOLVES on a Bench of one, so a single body would hide the stage this
    // case exists to show.
    const state = board({ p1: [DUSKNOIR, CHAFF, WALL], p2: [WALL, CHAFF] });
    const blaster = activeUid(state, "p1");
    const { state: parked } = blast(state, { spot: "active" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(130);
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(blaster);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    const { state: promoting } = step(after, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    });
    // The Active Spot is empty and §8.1 owes the refill — queued by
    // `resolveMidTurnKnockOuts`, the SAME seam `returnSelf` rides.
    if (promoting.phase.kind !== "ko:promote") throw new Error("expected ko:promote");
    expect(promoting.phase.seat).toBe("p1");
    expect(promoting.players.p1.active).toBeNull();
    const { state: done } = step(promoting, {
      type: "promote",
      seat: "p1",
      benchIndex: 0,
    });
    expect(done.players.p1.active).not.toBeNull();
    // …and the turn is STILL p1's: this is a mid-turn Knock Out, not an attack.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("a blaster with an EMPTY Bench behind it loses the game (§14.2)", () => {
    const state = board({ p1: [DUSCLOPS], p2: [WALL, CHAFF] });
    const { state: parked } = blast(state, { spot: "active" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after } = step(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    const settled =
      after.phase.kind === "ko:takePrizes"
        ? step(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state
        : after;
    if (settled.phase.kind !== "gameOver")
      throw new Error(`expected gameOver, got ${settled.phase.kind}`);
    expect(settled.phase.outcome).toEqual({ result: "win", winner: "p2", reason: "noPokemon" });
  });
});

describe("D345 §6 — the FORCED path: one candidate, no park, same two ops", () => {
  it("an opponent with only an Active auto-takes the snipe and still costs the host", () => {
    // `damageChosen` is mandatory (no `optional`), so a single candidate
    // auto-resolves and the whole program runs synchronously. That is the branch
    // where a self-KO authored as a PARK-only tail would silently never fire.
    const state = board({ p1: [WALL, DUSCLOPS], p2: [WALL] });
    const blaster = benchTopUid(state, "p1", 0);
    const { state: after, events } = blast(state, { spot: "bench", index: 0 });
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 50, seat: "p2" });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(blaster);
  });

  it("a board with NOTHING to snipe is refused at the ACTION layer, so the cost is never paid for nothing", () => {
    const seeded = board({ p1: [WALL, DUSCLOPS], p2: [WALL] });
    const empty: GameState = {
      ...seeded,
      players: {
        ...seeded.players,
        p2: { ...seeded.players.p2, active: null, bench: [] },
      },
    };
    const refused = applyAction(empty, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Cursed Blast",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.error.code).toBe("NO_LEGAL_TARGET");
    // …and the SAME board with the Active put back is playable, which is what
    // makes the refusal a statement about the candidate set rather than about
    // this suite's surgery.
    expect(
      applyAction(seeded, {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index: 0 },
        abilityName: "Cursed Blast",
      }).ok,
    ).toBe(true);
  });
});
