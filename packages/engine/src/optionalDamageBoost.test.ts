import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { parseAttackDamage } from "./cards";
import { attackReaderSurface, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackOptionalBoost, optionalBoostProgram, ATTACK_READERS } from "./effects";
import type { EffectOp } from "./effectTypes";
import { deriveAttackEffect, applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
  walkProgram,
  must,
  findEvent,
  driveSetup,
  programmedCardIds,
} from "./testFixtures";

const POLIWRATH_TEXT =
  "You may do 120 more damage. If you do, shuffle this Pokémon and all attached cards into your deck.";
const GURDURR_TEXT =
  "You may do 30 more damage. If you do, this Pokémon also does 30 damage to itself.";
const DONDOZO_TEXT =
  "You may do 120 more damage. If you do, this Pokémon also does 50 damage to itself.";
const COPPERAJAH_TEXT =
  "You may do 100 more damage. If you do, during your next turn, this Pokémon can't attack.";

/** Poliwrath's OTHER printed attack — the index-precision control, and a sentence
    `deriveAttackEffect` has read since 0.x. */
const HYPNOSIS_TEXT = "Your opponent's Active Pokémon is now Asleep.";

const POLIWRATH = "sv06-043";
const GURDURR = "sv06-104";
const COPPERAJAH = "sv06.5-042";
const WALL = "fix-d316-wall";
const FILLER = "fix-d316-filler";
const RESIST = "fix-d316-resist";
const WEAK = "fix-d316-weak";
const WATER = "fix-d316-water";
const FIGHT = "fix-d316-fight";
const METAL = "fix-d316-metal";
/** The ATTRIBUTION CONTROL's card — the SAME antecedent with a consequent no
    anchor reads, so the sentence must stay on the loud path. */
const UNREAD = "fix-d316-unread";
const UNREAD_TEXT = "You may do 30 more damage. If you do, hum a little tune.";

const LOCAL_CARDS: Record<string, Card> = {
  [POLIWRATH]: battler(POLIWRATH, {
    name: "Poliwrath",
    hp: 170,
    stage: "Stage2",
    evolveFrom: "Poliwhirl",
    retreat: 3,
    types: ["Water"],
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      { cost: ["Water"], name: "Hypnosis", effect: HYPNOSIS_TEXT },
      {
        cost: ["Colorless", "Colorless"],
        name: "Jumping Uppercut",
        damage: "120+",
        effect: POLIWRATH_TEXT,
      },
    ],
  }),
  [GURDURR]: battler(GURDURR, {
    name: "Gurdurr",
    hp: 100,
    stage: "Stage1",
    evolveFrom: "Timburr",
    retreat: 2,
    types: ["Fighting"],
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [
      { cost: ["Fighting"], name: "Knuckle Punch", damage: 20 },
      {
        cost: ["Fighting", "Colorless", "Colorless"],
        name: "Superpower",
        damage: "50+",
        effect: GURDURR_TEXT,
      },
    ],
  }),
  [COPPERAJAH]: battler(COPPERAJAH, {
    name: "Copperajah",
    hp: 200,
    stage: "Stage1",
    evolveFrom: "Cufant",
    retreat: 4,
    types: ["Metal"],
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    attacks: [
      {
        cost: ["Metal", "Metal", "Metal", "Colorless"],
        name: "Nasal Lariat",
        damage: "130+",
        effect: COPPERAJAH_TEXT,
      },
    ],
  }),
  // 330 HP — survives Poliwrath's 240 so the arithmetic is readable off the board
  // rather than off a KO.
  [WALL]: battler(WALL, {
    name: "D316 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  /** THE DISCRIMINATOR — Resistance to {W}, so one hit and two hits differ by
      exactly the printed −30. */
  [RESIST]: battler(RESIST, {
    name: "D316 Resist",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    resistances: [{ type: "Water", value: "-30" }],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  /** THE CONTROL — Weakness to {W}, which MULTIPLIES and therefore distributes
      over the split. It cannot tell the two readings apart, and saying so is the
      point of keeping it. */
  [WEAK]: battler(WEAK, {
    name: "D316 Weak",
    hp: 600,
    retreat: 1,
    types: ["Colorless"],
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D316 Filler",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [UNREAD]: battler(UNREAD, {
    name: "D316 Unread",
    hp: 120,
    retreat: 1,
    types: ["Water"],
    attacks: [{ cost: ["Water"], name: "Mystery", damage: "10+", effect: UNREAD_TEXT }],
  }),
  [WATER]: typedEnergy(WATER, "Water"),
  [FIGHT]: typedEnergy(FIGHT, "Fighting"),
  [METAL]: typedEnergy(METAL, "Metal"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [POLIWRATH]: 4,
  [GURDURR]: 4,
  [COPPERAJAH]: 4,
  [WALL]: 4,
  [RESIST]: 4,
  [WEAK]: 4,
  [FILLER]: 4,
  [UNREAD]: 4,
  [WATER]: 8,
  [FIGHT]: 10,
  [METAL]: 10,
});

const SEEDS = [4021, 4099] as const;

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** TEST SURGERY — `count` Energy of one printed type onto p1's Active. */
function fuel(state: GameState, energyId: string, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === energyId).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} × ${energyId}`);
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

/** A board on p1's turn: `attacker` Active with `energy × count` on it, `bench`
    filler bodies behind it, and `defender` standing opposite. */
function board(opts: {
  attacker: string;
  energy: string;
  count: number;
  bench?: number;
  defender?: string;
  seed?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", opts.defender ?? WALL);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = clearBench(state, "p1");
  for (let i = 0; i < (opts.bench ?? 2); i += 1) state = benchFromDeck(state, "p1", FILLER);
  return fuel(state, opts.energy, opts.count);
}

const UPPERCUT = { type: "attack", seat: "p1", index: 1 } as const;
const SUPERPOWER = { type: "attack", seat: "p1", index: 1 } as const;
const LARIAT = { type: "attack", seat: "p1", index: 0 } as const;
const YES = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } } as const;
const NO = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } } as const;

function count(events: readonly GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

/** The other ELEVEN readers, run as one — the disjointness control. */
const OTHER_READERS = ATTACK_READERS.map(({ read }) => read).filter(
  (read) => read !== deriveAttackOptionalBoost,
);

// ────────────────────────────────────────────────────────────────────────────
describe("D316 §1 — the print, and the reading each of the four sentences gets", () => {
  it("the fixtures carry the printed sentences VERBATIM", () => {
    expect(POOL[POLIWRATH]?.attacks?.[1]?.effect).toBe(POLIWRATH_TEXT);
    expect(POOL[POLIWRATH]?.attacks?.[1]?.damage).toBe("120+");
    expect(POOL[POLIWRATH]?.attacks?.[0]?.effect).toBe(HYPNOSIS_TEXT);
    expect(POOL[GURDURR]?.attacks?.[1]?.effect).toBe(GURDURR_TEXT);
    expect(POOL[GURDURR]?.attacks?.[1]?.damage).toBe("50+");
    expect(POOL[COPPERAJAH]?.attacks?.[0]?.effect).toBe(COPPERAJAH_TEXT);
    expect(POOL[COPPERAJAH]?.attacks?.[0]?.damage).toBe("130+");
  });

  it("each sentence reads into its BONUS and the ops its acceptance buys", () => {
    expect(deriveAttackOptionalBoost(POLIWRATH_TEXT)).toEqual({
      bonus: 120,
      ops: [{ op: "returnSelf", dest: "deck" }],
    });
    expect(deriveAttackOptionalBoost(GURDURR_TEXT)).toEqual({
      bonus: 30,
      ops: [{ op: "damageSelf", amount: 30 }],
    });
    expect(deriveAttackOptionalBoost(DONDOZO_TEXT)).toEqual({
      bonus: 120,
      ops: [{ op: "damageSelf", amount: 50 }],
    });
    expect(deriveAttackOptionalBoost(COPPERAJAH_TEXT)).toEqual({
      bonus: 100,
      ops: [{ op: "preventAttack" }],
    });
  });

  it("the ops are BYTE-IDENTICAL to the ones the BARE sentences derive", () => {
    expect(deriveAttackOptionalBoost(GURDURR_TEXT)?.ops).toEqual(
      deriveAttackEffect("This Pokémon also does 30 damage to itself."),
    );
    expect(deriveAttackOptionalBoost(DONDOZO_TEXT)?.ops).toEqual(
      deriveAttackEffect("This Pokémon also does 50 damage to itself."),
    );
    expect(deriveAttackOptionalBoost(COPPERAJAH_TEXT)?.ops).toEqual(
      deriveAttackEffect("During your next turn, this Pokémon can't attack."),
    );
    expect(deriveAttackOptionalBoost(POLIWRATH_TEXT)?.ops).toEqual([
      { op: "returnSelf", dest: "deck" },
    ]);
  });

  it("NO registry ATTACK row is authored for any of the five printings — an ARM serves them all", () => {
    for (const id of [POLIWRATH, GURDURR, COPPERAJAH, "sv10-066", "sv10-211"]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(programFor(COPPERAJAH)?.passive).toBeDefined();
  });

  it("INDEX PRECISION — Poliwrath's other attack is read by a DIFFERENT reader", () => {
    // The sentence at index 0 is `deriveAttackEffect`'s since 0.x and must not
    // inherit anything from index 1's reading. The two readers are disjoint on
    // both strings, in both directions.
    expect(deriveAttackOptionalBoost(HYPNOSIS_TEXT)).toBeNull();
    expect(deriveAttackEffect(HYPNOSIS_TEXT)).not.toBeNull();
    expect(deriveAttackEffect(POLIWRATH_TEXT)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D316 §2 — the REFUSALS, which are what keep an unread sentence loud", () => {
  it("D419 — OTHER_READERS plus the reader under test IS the module's surface", () => {
    expect([...OTHER_READERS.map((read) => read.name), "deriveAttackOptionalBoost"].sort()).toEqual(
      attackReaderSurface(),
    );
  });

  it("all ELEVEN other readers refuse all four sentences", () => {
    for (const text of [POLIWRATH_TEXT, GURDURR_TEXT, DONDOZO_TEXT, COPPERAJAH_TEXT]) {
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const read of OTHER_READERS) expect(read(text), text).toBeNull();
      expect(deriveAttackOptionalBoost(text), text).not.toBeNull();
    }
  });

  it("the ATTRIBUTION CONTROL — a sentence this reader must NOT claim", () => {
    expect(deriveAttackOptionalBoost("Draw a card.")).toBeNull();
    expect(deriveAttackEffect("Draw a card.")).not.toBeNull();
  });

  it("an UNRECOGNISED consequent refuses the WHOLE sentence — never a prefix match", () => {
    // The family's safety property. A reader that swallowed the antecedent and
    // dropped the consequent would ship an attack whose drawback silently
    // vanished, which is strictly worse than not reading it at all.
    for (const tail of [
      "discard 2 Energy from this Pokémon.",
      "your opponent's Active Pokémon is now Paralyzed.",
      "shuffle this Pokémon and all attached cards into your hand.",
      "during your opponent's next turn, this Pokémon can't attack.",
    ]) {
      expect(
        deriveAttackOptionalBoost(`You may do 60 more damage. If you do, ${tail}`),
        tail,
      ).toBeNull();
    }
  });

  it("the consequent's verb is LOWERCASE, and a CAPITAL one is refused", () => {
    expect(
      deriveAttackOptionalBoost(
        "You may do 60 more damage. If you do, This Pokémon also does 30 damage to itself.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalBoost(
        "You may do 60 more damage. If you do, During your next turn, this Pokémon can't attack.",
      ),
    ).toBeNull();
  });

  it("the CURLY apostrophe resolves EQUALLY — the class is on the anchor (D136/D137)", () => {
    const curly = COPPERAJAH_TEXT.replace("can't", "can’t");
    expect(curly).not.toBe(COPPERAJAH_TEXT);
    expect(deriveAttackOptionalBoost(curly)).toEqual(deriveAttackOptionalBoost(COPPERAJAH_TEXT));
  });

  it("a printed ZERO on either number is refused, on both slots", () => {
    // A printed 0 is not a real card and would derive to a silent no-op — the
    // guard `SELF_DAMAGE` and the exact-N discards carry, at both numbers this
    // reader captures.
    expect(
      deriveAttackOptionalBoost(
        "You may do 0 more damage. If you do, this Pokémon also does 30 damage to itself.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalBoost(
        "You may do 60 more damage. If you do, this Pokémon also does 0 damage to itself.",
      ),
    ).toBeNull();
  });

  it("the anchor is WHOLE-STRING — leading or trailing text is refused", () => {
    expect(deriveAttackOptionalBoost(`Draw a card. ${GURDURR_TEXT}`)).toBeNull();
    expect(deriveAttackOptionalBoost(`${GURDURR_TEXT} Draw a card.`)).toBeNull();
  });

  it("the REACH is wider than the census, and it is the arm's own parameterisation", () => {
    // An arm transfers across sets. The catalog prints four of these sentences
    // today; the anchor reads any bonus and any recoil amount, which is what a
    // reprint at a different number costs (nothing).
    expect(
      deriveAttackOptionalBoost(
        "You may do 70 more damage. If you do, this Pokémon also does 90 damage to itself.",
      ),
    ).toEqual({ bonus: 70, ops: [{ op: "damageSelf", amount: 90 }] });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D316 §3 — THE PARK, and the two answers that are both damage", () => {
  for (const seed of SEEDS) {
    it(`the attack parks with NO damage down yet — the base is inside the gate (seed ${seed})`, () => {
      const { state: parked, events } = apply(
        board({ attacker: POLIWRATH, energy: WATER, count: 2, seed }),
        UPPERCUT,
      );
      expect(parked.players.p2.active?.damage).toBe(0);
      expect(count(events, "DAMAGE_DEALT")).toBe(0);
      expect(parked.phase.kind).toBe("effect:choose");
      // The note is the WHOLE printed sentence — the player is agreeing to the
      // drawback as much as to the damage.
      expect(findEvent(events, "EFFECT_PENDING")).toMatchObject({
        seat: "p1",
        note: POLIWRATH_TEXT,
      });
    });
  }

  it("a YES deals base + bonus in ONE hit and then runs the consequent", () => {
    const parked = must(
      applyAction(board({ attacker: POLIWRATH, energy: WATER, count: 2 }), UPPERCUT),
    );
    const { state: done, events } = apply(parked, YES);
    expect(count(events, "DAMAGE_DEALT")).toBe(1);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 240, base: 240 });
    expect(done.players.p2.active?.damage).toBe(240);
    // …and the printed consequent ran: the attacker left the board.
    expect(findEvent(events, "POKEMON_RETURNED")).toMatchObject({ seat: "p1", dest: "deck" });
  });

  it("a NO deals the printed BASE — the arm that did not exist before D316", () => {
    const parked = must(
      applyAction(board({ attacker: POLIWRATH, energy: WATER, count: 2 }), UPPERCUT),
    );
    const { state: done, events } = apply(parked, NO);
    expect(count(events, "DAMAGE_DEALT")).toBe(1);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 120, base: 120 });
    expect(done.players.p2.active?.damage).toBe(120);
    // …and the consequent did NOT run: the attacker is standing, still fuelled.
    expect(done.cardIdByUid[done.players.p1.active?.stack.at(-1) ?? ""]).toBe(POLIWRATH);
    expect(count(events, "POKEMON_RETURNED")).toBe(0);
    // The turn ended anyway (§5.3) — the decline is about the boost only.
    expect(done.phase).toMatchObject({ seat: "p2" });
  });

  it("the OPPONENT cannot answer the attacker's printed 'you may'", () => {
    const parked = must(
      applyAction(board({ attacker: POLIWRATH, energy: WATER, count: 2 }), UPPERCUT),
    );
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "confirm", yes: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("WRONG_SEAT");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D316 §4 — the LOUD path closed: the sentence and its '+' are both simulated", () => {
  it("no ATTACK_EFFECT_SKIPPED on any of the three real boards", () => {
    const runs = [
      [board({ attacker: POLIWRATH, energy: WATER, count: 2 }), UPPERCUT],
      [board({ attacker: GURDURR, energy: FIGHT, count: 3 }), SUPERPOWER],
      [board({ attacker: COPPERAJAH, energy: METAL, count: 4 }), LARIAT],
    ] as const;
    for (const [state, action] of runs) {
      const { events } = apply(state, action);
      expect(count(events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    }
  });

  it("the ATTRIBUTION CONTROL — the SAME antecedent with an unread consequent IS flagged", () => {
    expect(deriveAttackOptionalBoost(UNREAD_TEXT)).toBeNull();
    const { events } = apply(board({ attacker: UNREAD, energy: WATER, count: 1 }), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      effect: UNREAD_TEXT,
      damageModifier: "+",
    });
    // …and the printed base landed the ordinary way, because nothing claimed it.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D316 §5 — §8.5 APPLIED ONCE, ON A BOARD WHERE TWO HITS WOULD DIFFER", () => {
  it("a −30 RESISTANCE is paid ONCE: 240 − 30 = 210, not (120−30) + (120−30)", () => {
    // THE DISCRIMINATOR, and the reason the WHOLE hit moves inside the gate
    // rather than the bonus alone. Two damage ops would each re-enter §8.5 and
    // each subtract the printed 30, landing on 180. One op lands on 210.
    const parked = must(
      applyAction(
        board({ attacker: POLIWRATH, energy: WATER, count: 2, defender: RESIST }),
        UPPERCUT,
      ),
    );
    const { state: done, events } = apply(parked, YES);
    expect(count(events, "DAMAGE_DEALT")).toBe(1);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 210,
      resistance: { op: "subtract", amount: 30 },
    });
    expect(done.players.p2.active?.damage).toBe(210);
    expect(done.players.p2.active?.damage).not.toBe(180);
  });

  it("the DECLINE takes the same Resistance once: 120 − 30 = 90", () => {
    const parked = must(
      applyAction(
        board({ attacker: POLIWRATH, energy: WATER, count: 2, defender: RESIST }),
        UPPERCUT,
      ),
    );
    const { state: done } = apply(parked, NO);
    expect(done.players.p2.active?.damage).toBe(90);
  });

  it("the WEAKNESS CONTROL cannot tell the two readings apart, and that is why it is a control", () => {
    // ×2 DISTRIBUTES over the split (2×120 + 2×120 = 2×240), so a Weakness board
    // is green under both readings. Kept because a suite that only ever drove
    // this board would have proved nothing about the split at all.
    const parked = must(
      applyAction(
        board({ attacker: POLIWRATH, energy: WATER, count: 2, defender: WEAK }),
        UPPERCUT,
      ),
    );
    const { state: done, events } = apply(parked, YES);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 480,
      weakness: { op: "multiply", amount: 2 },
    });
    expect(done.players.p2.active?.damage).toBe(480);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D316 §6 — the other two consequents, on their own real boards", () => {
  it("Gurdurr — a YES deals 80 and takes 30 back; a NO deals 50 and takes nothing", () => {
    const yes = apply(
      must(applyAction(board({ attacker: GURDURR, energy: FIGHT, count: 3 }), SUPERPOWER)),
      YES,
    );
    expect(yes.state.players.p2.active?.damage).toBe(80);
    expect(yes.state.players.p1.active?.damage).toBe(30);

    const no = apply(
      must(applyAction(board({ attacker: GURDURR, energy: FIGHT, count: 3 }), SUPERPOWER)),
      NO,
    );
    expect(no.state.players.p2.active?.damage).toBe(50);
    expect(no.state.players.p1.active?.damage).toBe(0);
  });

  it("Gurdurr's recoil can KNOCK ITSELF OUT — the two-seat epilogue, reached through a confirm", () => {
    // 100 HP and 30 recoil is not lethal on its own, so the board is built with
    // the attacker already damaged: the self-KO the epilogue sweeps is a real
    // ending of this sentence and not a hypothetical.
    let state = board({ attacker: GURDURR, energy: FIGHT, count: 3 });
    const body = state.players.p1.active;
    if (body === null) throw new Error("no Active");
    state = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: { ...body, damage: 80 } } },
    };
    const { state: done, events } = apply(must(applyAction(state, SUPERPOWER)), YES);
    expect(events.filter((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toHaveLength(1);
    // The attacker's own spot is empty and §8.1 owes p1 a promotion before the
    // turn hands over — the epilogue sweeping BOTH seats, reached here through a
    // confirm answer rather than through a registry program.
    expect(findEvent(events, "PRIZES_OWED")).toMatchObject({ seat: "p2", count: 1 });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(events.map((e) => e.type)).toEqual([
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
  });

  it("Copperajah — a YES deals 230 AND installs the lock; a NO deals 130 and installs nothing", () => {
    const yes = apply(
      must(applyAction(board({ attacker: COPPERAJAH, energy: METAL, count: 4 }), LARIAT)),
      YES,
    );
    expect(yes.state.players.p2.active?.damage).toBe(230);
    expect(yes.state.players.p1.active?.attackLockedTurn).not.toBeNull();

    const no = apply(
      must(applyAction(board({ attacker: COPPERAJAH, energy: METAL, count: 4 }), LARIAT)),
      NO,
    );
    expect(no.state.players.p2.active?.damage).toBe(130);
    expect(no.state.players.p1.active?.attackLockedTurn).toBeNull();
  });

  it("the DECLINED Copperajah can attack again next turn, and the ACCEPTED one cannot", () => {
    // The lock is a real board fact and not a flag nobody reads: drive it to the
    // §8 gate that enforces it, on both answers, off the same board.
    for (const [answer, blocked] of [
      [YES, true],
      [NO, false],
    ] as const) {
      let state = apply(
        must(applyAction(board({ attacker: COPPERAJAH, energy: METAL, count: 4 }), LARIAT)),
        answer,
      ).state;
      state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
      const again = applyAction(state, LARIAT);
      expect(again.ok, `${blocked}`).toBe(!blocked);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D316 §7 — THE WIDENING, DRIVEN AT ITS PREMISE RATHER THAN ASSERTED", () => {
  it("`optional.otherwise` — the attack assembler AND, since D557, the registry (Kieran ×5, and since D560 Cradily's two nested picks, by id)", () => {
    // `MATCH_RECORD_VERSION` stays 18 because a v18 deploy cannot AUTHOR this
    // field, so no v18 record can hold one. That is a claim about the producers,
    // and this is the producer set: every registry program, walked structurally.
    const authored: string[] = [];
    let optionalsSeen = 0;
    let programsWalked = 0;
    for (const id of programmedCardIds()) {
      const program = programFor(id);
      if (program === undefined) continue;
      programsWalked += 1;
      const ops: EffectOp[] = [
        ...walkProgram(program.trainer ?? []),
        ...Object.values(program.attack ?? {}).flatMap((list) => walkProgram(list)),
        ...(program.abilities ?? []).flatMap((a) => walkProgram(a.program)),
        ...(program.triggered ?? []).flatMap((t) => walkProgram(t.program)),
      ];
      for (const op of ops) {
        if (op.op !== "optional") continue;
        optionalsSeen += 1;
        if (op.otherwise !== undefined) authored.push(id);
      }
    }
    // THE ATTRIBUTION CONTROL — the sweep really did reach programs and really did
    // find `optional`s, so "none carries `otherwise`" is an answer rather than an
    // empty population.
    expect(programsWalked).toBeGreaterThan(50);
    expect(optionalsSeen).toBeGreaterThan(0);
    expect(authored).toEqual([
      "sv06-154",
      "sv06-206",
      "sv06-218",
      "sv08.5-113",
      "sv08.5-174",
      "sv07-006",
      "sv07-006",
      "me01-120",
      "me01-170",
      "me01-185",
    ]);
    const parked = must(
      applyAction(board({ attacker: POLIWRATH, energy: WATER, count: 2 }), UPPERCUT),
    );
    expect(JSON.stringify(parked)).toContain("otherwise");
  });

  it("a flat `damageDefender` and a slot-keyed one are UNREPRESENTABLE together", () => {
    // The `?: never` idiom, checked as a value rather than as a type comment: the
    // two arms the union admits, and nothing that carries both.
    const flat: EffectOp = { op: "damageDefender", amount: 240 };
    const slotted: EffectOp = { op: "damageDefender", per: 60, count: "discarded" };
    expect(flat).toEqual({ op: "damageDefender", amount: 240 });
    expect(slotted).toEqual({ op: "damageDefender", per: 60, count: "discarded" });
    // @ts-expect-error — the union refuses an op carrying both shapes.
    const both: EffectOp = { op: "damageDefender", amount: 240, per: 60, count: "discarded" };
    expect(both).toBeDefined();
  });

  it("every EXISTING `optional` producer still omits `otherwise` and reads identically", () => {
    expect(programFor("sv08-131")?.attack?.[1]).toEqual([
      {
        op: "optional",
        note: "You may shuffle this Pokémon and all attached cards into your deck.",
        ops: [{ op: "returnSelf", dest: "deck" }],
      },
    ]);
  });
});

describe("D318 §8 — the exported assembler, and the pool that can now reach it", () => {
  it("builds the SAME program the board parks — the export is the code, not a second copy", () => {
    const reading = deriveAttackOptionalBoost(POLIWRATH_TEXT);
    expect(reading).not.toBeNull();
    const built = optionalBoostProgram(reading as never, 120, POLIWRATH_TEXT);
    expect(built).toEqual([
      {
        op: "optional",
        note: POLIWRATH_TEXT,
        ops: [
          { op: "damageDefender", amount: 240 },
          { op: "returnSelf", dest: "deck" },
        ],
        otherwise: [{ op: "damageDefender", amount: 120 }],
      },
    ]);
    const parked = must(
      applyAction(board({ attacker: POLIWRATH, energy: WATER, count: 2 }), UPPERCUT),
    );
    if (parked.phase.kind !== "effect:choose") throw new Error("the attack did not park");
    // The parked continuation's `pendingOp` IS the gate `attack.ts` assembled on a
    // real board, so this equality is the whole attribution control: a divergent
    // inline copy left behind in `attack.ts` fails here and nowhere else.
    expect(parked.phase.cont.pendingOp).toEqual(built[0]);
  });

  it("the DECLINE arm is the printed base for every one of the four sentences, and the base is the caller's", () => {
    // The assembler is a pure function of (reading, base, note) and nothing else,
    // so the base is swept rather than pinned at the one the catalog prints —
    // `FLIP_TAILS_SELF_DAMAGE`'s capture reasoning, one level out.
    for (const [text, base, bonus] of [
      [POLIWRATH_TEXT, 120, 120],
      [GURDURR_TEXT, 50, 30],
      [DONDOZO_TEXT, 120, 120],
      [COPPERAJAH_TEXT, 130, 100],
    ] as const) {
      const reading = deriveAttackOptionalBoost(text);
      expect(reading, text).not.toBeNull();
      for (const trial of [base, 0, 777]) {
        const gate = optionalBoostProgram(reading as never, trial, text)[0];
        expect(gate?.op).toBe("optional");
        if (gate?.op !== "optional") throw new Error("unreachable");
        expect(gate.otherwise, `${text} @ ${trial}`).toEqual([
          { op: "damageDefender", amount: trial },
        ]);
        expect(gate.ops[0], `${text} @ ${trial}`).toEqual({
          op: "damageDefender",
          amount: trial + bonus,
        });
        // The consequent rides BEHIND the hit, in printed order, and is never
        // swallowed — the failure this reader's `^…$` dispatch exists against.
        expect(gate.ops.length).toBe(2);
        expect(gate.note).toBe(text);
      }
    }
  });

  it("`FIXTURE_POOL` can now REACH the shape — the half an exported assembler does not buy", () => {
    // The pool-reachability claim, asserted here rather than only in
    // `programWalk.test.ts`, because that file's pin is a list of op/key pairs and
    // this is the sentence that puts a producer under it.
    const pooled = Object.entries(FIXTURE_POOL).flatMap(([id, card]) =>
      (card.attacks ?? [])
        .map((attack, index) => ({ id, index, text: attack.effect ?? "" }))
        .filter((row) => deriveAttackOptionalBoost(row.text) !== null),
    );
    expect(pooled.map((r) => `${r.id}#${r.index}`)).toEqual(["fix-optionalboost#1"]);
    const card = FIXTURE_POOL["fix-optionalboost"];
    const attack = (card?.attacks ?? [])[1];
    expect(attack?.name).toBe("Superpower");
    expect(attack?.damage).toBe("50+");
    expect(attack?.effect).toBe(GURDURR_TEXT);
    const gate = optionalBoostProgram(
      deriveAttackOptionalBoost(attack?.effect ?? "") as never,
      parseAttackDamage(attack?.damage).base,
      attack?.effect ?? "",
    )[0];
    if (gate?.op !== "optional")
      throw new Error("the pooled fixture does not assemble an `optional`");
    // The whole reason the pin could not move: a NON-EMPTY `otherwise` a shared
    // sweep can walk.
    expect(gate.otherwise).toEqual([{ op: "damageDefender", amount: 50 }]);
    expect(walkProgram([gate]).map((op) => op.op)).toEqual([
      "optional",
      "damageDefender",
      "damageSelf",
      "damageDefender",
    ]);
  });
});
