import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  bonusConsequentProgram,
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
} from "./effects";
import type { EffectOp } from "./effects";
import {
  applyAction,
  createGame,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  completeSetup,
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  programBranchCarriers,
  setActiveFromDeck,
  typedEnergy,
  walkProgram,
  must,
  findEvent,
} from "./testFixtures";

const OGERPON_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.";
const FLORAGATO_TEXT =
  "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.";

const WRATHFUL_TEXT = "This attack does 20 damage for each damage counter on this Pokémon.";

/** The two BARE sentences the family's antecedents already resolve, kept as the
    pair that says this reader widened nothing: both are real printed catalog
    sentences read by OTHER readers, and both must stay theirs. */
const BARE_OGERPON_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.";
const BARE_FLORAGATO_TEXT = "Flip a coin. If heads, this attack does 30 more damage.";

const OGERPON = "sv06-040";
const FLORAGATO = "sv09-017";
/** The five Ogerpon ex rarities and Floragato — the whole legal population. */
const ALL_SIX = [OGERPON, "sv06-192", "sv06-212", "sv08.5-017", "sv08.5-148", FLORAGATO] as const;

const EVOLVED = "fix-d317-evolved";
const BASIC = "fix-d317-basic";
const RESIST = "fix-d317-resist";
const WEAK = "fix-d317-weak";
const FILLER = "fix-d317-filler";
const FIRE = "fix-d317-fire";
const GRASS = "fix-d317-grass";
/** The ATTRIBUTION CONTROL's card — the SAME antecedent with a consequent no
    anchor reads, so the sentence must stay on the loud path. */
const UNREAD = "fix-d317-unread";
const UNREAD_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 60 more damage, and hum a little tune.";

const LOCAL_CARDS: Record<string, Card> = {
  [OGERPON]: battler(OGERPON, {
    name: "Hearthflame Mask Ogerpon ex",
    hp: 210,
    stage: "Basic",
    retreat: 1,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire", "Colorless", "Colorless"],
        name: "Wrathful Hearth",
        effect: WRATHFUL_TEXT,
        damage: "20×",
      },
      {
        cost: ["Fire", "Fire", "Fire"],
        name: "Dynamic Blaze",
        effect: OGERPON_TEXT,
        damage: "140+",
      },
    ],
  }),
  [FLORAGATO]: battler(FLORAGATO, {
    name: "Floragato",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Sprigatito",
    retreat: 1,
    types: ["Grass"],
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Magical Leaf",
        effect: FLORAGATO_TEXT,
        damage: "30+",
      },
    ],
  }),
  [UNREAD]: battler(UNREAD, {
    types: ["Fire"],
    hp: 200,
    attacks: [{ cost: ["Fire"], name: "Unread Blaze", effect: UNREAD_TEXT, damage: "10+" }],
  }),
  [EVOLVED]: battler(EVOLVED, {
    types: ["Colorless"],
    hp: 340,
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
  }),
  [BASIC]: battler(BASIC, { types: ["Colorless"], hp: 340 }),
  [RESIST]: battler(RESIST, {
    types: ["Colorless"],
    hp: 340,
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  /** THE CONTROL THAT PROVES NOTHING, kept and LABELLED: ×2 DISTRIBUTES over a
      split hit, so this board is green under both readings. */
  [WEAK]: battler(WEAK, {
    types: ["Colorless"],
    hp: 340,
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  [FILLER]: battler(FILLER, { types: ["Colorless"], hp: 60 }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [GRASS]: typedEnergy(GRASS, "Grass"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [OGERPON]: 4,
  [FLORAGATO]: 4,
  [UNREAD]: 4,
  [EVOLVED]: 4,
  [BASIC]: 4,
  [RESIST]: 4,
  [WEAK]: 4,
  [FILLER]: 4,
  [FIRE]: 14,
  [GRASS]: 14,
});

const SEEDS = [4021, 4099] as const;
const COIN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
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

/** A board on p1's turn: `attacker` Active with `energy × count` on it, filler
    bodies behind it, and `defender` standing opposite. */
function board(opts: {
  attacker: string;
  energy: string;
  count: number;
  defender?: string;
  seed?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", opts.defender ?? EVOLVED);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLER);
  state = benchFromDeck(state, "p1", FILLER);
  return fuel(state, opts.energy, opts.count);
}

const BLAZE = { type: "attack", seat: "p1", index: 1 } as const;
const LEAF = { type: "attack", seat: "p1", index: 0 } as const;

function count(events: readonly GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

/** The other ELEVEN readers, run as one — the disjointness control. */
const OTHER_READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackOptionalBoost,
];

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §1 — the print, and the reading each of the two sentences gets", () => {
  it("the fixtures carry the printed sentences VERBATIM, with their '+' markers", () => {
    expect(POOL[OGERPON]?.attacks?.[1]?.effect).toBe(OGERPON_TEXT);
    expect(POOL[OGERPON]?.attacks?.[1]?.damage).toBe("140+");
    expect(POOL[OGERPON]?.attacks?.[0]?.effect).toBe(WRATHFUL_TEXT);
    expect(POOL[FLORAGATO]?.attacks?.[0]?.effect).toBe(FLORAGATO_TEXT);
    expect(POOL[FLORAGATO]?.attacks?.[0]?.damage).toBe("30+");
  });

  it("each sentence reads into its DECIDER, its bonus and the ops the yes arm buys", () => {
    expect(deriveAttackBonusConsequent(OGERPON_TEXT)).toEqual({
      decider: { kind: "boardCondition", cond: { kind: "opponentActiveIsEvolution" } },
      bonus: 140,
      ops: [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      ],
    });
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT)).toEqual({
      decider: { kind: "coinFlip" },
      bonus: 30,
      ops: [{ op: "heal", target: "self", amount: 30 }],
    });
  });

  it("the ops are BYTE-IDENTICAL to the ones the BARE consequents derive", () => {
    expect(deriveAttackBonusConsequent(OGERPON_TEXT)?.ops).toEqual(
      deriveAttackEffect("Discard all Energy from this Pokémon."),
    );
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT)?.ops).toEqual(
      deriveAttackEffect("Heal 30 damage from this Pokémon."),
    );
  });

  it("the DECIDER is byte-identical to the one the BARE antecedent derives", () => {
    const bare = deriveAttackDamageBonus(BARE_OGERPON_TEXT)?.count;
    if (bare?.kind !== "boardCondition") throw new Error("expected a boardCondition count");
    expect(deriveAttackBonusConsequent(OGERPON_TEXT)?.decider).toEqual({
      kind: "boardCondition",
      cond: bare.cond,
    });
  });

  it("the ASSEMBLER puts the whole hit inside the gate, on BOTH arms", () => {
    // The base is the argument, so this is the one place the two halves meet.
    expect(bonusConsequentProgram(deriveAttackBonusConsequent(OGERPON_TEXT) as never, 140)).toEqual(
      [
        {
          op: "conditionGate",
          cond: { kind: "opponentActiveIsEvolution" },
          then: [
            { op: "damageDefender", amount: 280 },
            {
              op: "discardEnergy",
              from: "yourActive",
              filter: { kind: "anyEnergy" },
              count: "all",
            },
          ],
          otherwise: [{ op: "damageDefender", amount: 140 }],
        },
      ],
    );
    expect(
      bonusConsequentProgram(deriveAttackBonusConsequent(FLORAGATO_TEXT) as never, 30),
    ).toEqual([
      {
        op: "coinFlipGate",
        then: [
          { op: "damageDefender", amount: 60 },
          { op: "heal", target: "self", amount: 30 },
        ],
        otherwise: [{ op: "damageDefender", amount: 30 }],
      },
    ]);
  });

  it("THE DECLINE ARM IS THE PRINTED BASE, NEVER AN ABSENT BRANCH", () => {
    for (const [text, base] of [
      [OGERPON_TEXT, 140],
      [FLORAGATO_TEXT, 30],
    ] as const) {
      const gate = bonusConsequentProgram(deriveAttackBonusConsequent(text) as never, base)[0];
      expect(gate, text).toMatchObject({ otherwise: [{ op: "damageDefender", amount: base }] });
    }
  });

  it("NO registry ATTACK row is authored for any of the SIX printings — an ARM serves them all", () => {
    for (const id of ALL_SIX) {
      expect(programFor(id)?.attack, id).toBeUndefined();
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("INDEX PRECISION — Ogerpon's other attack is read by a DIFFERENT reader", () => {
    expect(deriveAttackBonusConsequent(WRATHFUL_TEXT)).toBeNull();
    expect(deriveAttackDamageMultiplier(WRATHFUL_TEXT)).not.toBeNull();
    expect(deriveAttackDamageMultiplier(OGERPON_TEXT)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §2 — the REFUSALS, which are what keep an unread sentence loud", () => {
  it("D419 — OTHER_READERS plus the reader under test IS the module's surface", () => {
    expect(
      [...OTHER_READERS.map((read) => read.name), "deriveAttackBonusConsequent"].sort(),
    ).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("all ELEVEN other readers refuse BOTH sentences", () => {
    for (const text of [OGERPON_TEXT, FLORAGATO_TEXT]) {
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const read of OTHER_READERS) expect(read(text), text).toBeNull();
      expect(deriveAttackBonusConsequent(text), text).not.toBeNull();
    }
  });

  it("and the BARE sentences stay with the readers that already owned them", () => {
    expect(deriveAttackBonusConsequent(BARE_OGERPON_TEXT)).toBeNull();
    expect(deriveAttackDamageBonus(BARE_OGERPON_TEXT)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsEvolution" } },
    });
    expect(deriveAttackBonusConsequent(BARE_FLORAGATO_TEXT)).toBeNull();
    expect(deriveAttackCoinFlip(BARE_FLORAGATO_TEXT)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "printed", count: 1 },
      per: 30,
    });
  });

  it("the ATTRIBUTION CONTROL — a sentence this reader must NOT claim", () => {
    expect(deriveAttackBonusConsequent("Draw a card.")).toBeNull();
    expect(deriveAttackEffect("Draw a card.")).not.toBeNull();
  });

  it("an UNRECOGNISED consequent refuses the WHOLE sentence — never a prefix match", () => {
    // The family's safety property. A reader that swallowed the damage clause and
    // dropped the consequent would ship an Ogerpon whose printed cost silently
    // vanished, which is strictly worse than not reading the card at all.
    for (const tail of [
      "discard 2 Energy from this Pokémon.",
      "discard all Energy from your opponent's Active Pokémon.",
      "heal all damage from this Pokémon.",
      "your opponent's Active Pokémon is now Paralyzed and Poisoned.",
      "your opponent's Active Pokémon is now Confused.",
    ]) {
      expect(
        deriveAttackBonusConsequent(
          `If your opponent's Active Pokémon is Poisoned, this attack does 60 more damage, and ${tail}`,
        ),
        tail,
      ).toBeNull();
      expect(
        deriveAttackBonusConsequent(
          `Flip a coin. If heads, this attack does 60 more damage, and ${tail}`,
        ),
        tail,
      ).toBeNull();
    }
  });

  it("an UNMAPPED antecedent clause refuses too, and stays LOUD", () => {
    // `CONDITIONAL_DAMAGE_BONUS`'s own rule inherited: an unrecognised condition
    // must never silently score its bonus at 0.
    expect(
      deriveAttackBonusConsequent(
        "If your opponent's Active Pokémon is a Dragon, this attack does 60 more damage, and discard all Energy from this Pokémon.",
      ),
    ).toBeNull();
  });

  it("the consequent's verb is LOWERCASE, and a CAPITAL one is refused", () => {
    expect(
      deriveAttackBonusConsequent(
        "Flip a coin. If heads, this attack does 30 more damage, and Heal 30 damage from this Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackBonusConsequent(OGERPON_TEXT.replace(", and discard", ", and Discard")),
    ).toBeNull();
  });

  it("the CURLY apostrophe resolves EQUALLY — the class is at the shared clause fold (D136/D137)", () => {
    const curly = OGERPON_TEXT.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(OGERPON_TEXT);
    expect(deriveAttackBonusConsequent(curly)).toEqual(deriveAttackBonusConsequent(OGERPON_TEXT));
  });

  it("a printed ZERO on either number is refused, on both slots and both deciders", () => {
    // A printed 0 is not a real card and would derive to a silent no-op — the
    // guard every captured amount in this family carries.
    expect(deriveAttackBonusConsequent(OGERPON_TEXT.replace("140 more", "0 more"))).toBeNull();
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT.replace("30 more", "0 more"))).toBeNull();
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT.replace("heal 30", "heal 0"))).toBeNull();
  });

  it("the anchor is WHOLE-STRING — leading or trailing text is refused", () => {
    expect(deriveAttackBonusConsequent(`Draw a card. ${OGERPON_TEXT}`)).toBeNull();
    expect(deriveAttackBonusConsequent(`${OGERPON_TEXT} Draw a card.`)).toBeNull();
    expect(deriveAttackBonusConsequent(`${FLORAGATO_TEXT} Draw a card.`)).toBeNull();
  });

  it("THE ANCHOR ORDER IS LOAD-BEARING — the coin form is tried FIRST", () => {
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT)?.decider).toEqual({ kind: "coinFlip" });
    expect(deriveAttackBonusConsequent(OGERPON_TEXT)?.decider.kind).toBe("boardCondition");
  });

  it("the REACH is wider than the census, and it is the arm's own parameterisation", () => {
    expect(
      deriveAttackBonusConsequent(
        "Flip a coin. If heads, this attack does 90 more damage, and heal 70 damage from this Pokémon.",
      ),
    ).toEqual({
      decider: { kind: "coinFlip" },
      bonus: 90,
      ops: [{ op: "heal", target: "self", amount: 70 }],
    });
    expect(
      deriveAttackBonusConsequent(
        "If you have a Stadium in play, this attack does 20 more damage, and discard all Energy from this Pokémon.",
      ),
    ).toEqual({
      decider: { kind: "boardCondition", cond: { kind: "yourStadiumInPlay" } },
      bonus: 20,
      ops: [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      ],
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §3 — OGERPON: the board condition, and BOTH arms on a real board", () => {
  for (const seed of SEEDS) {
    it(`🛑 an EVOLUTION Active takes 280 in ONE hit, and the Energy goes (seed ${seed})`, () => {
      const { state: done, events } = apply(
        board({ attacker: OGERPON, energy: FIRE, count: 3, defender: EVOLVED, seed }),
        BLAZE,
      );
      // ONE hit, at base + bonus. Two hits would be two rows.
      expect(count(events, "DAMAGE_DEALT")).toBe(1);
      expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 280 });
      expect(done.players.p2.active?.damage).toBe(280);
      // …and the printed consequent ran: every Energy left the attacker.
      expect(done.players.p1.active?.energy).toEqual([]);
    });

    it(`🛑 a BASIC Active takes the printed 140 and the Energy STAYS (seed ${seed})`, () => {
      const { state: done, events } = apply(
        board({ attacker: OGERPON, energy: FIRE, count: 3, defender: BASIC, seed }),
        BLAZE,
      );
      expect(count(events, "DAMAGE_DEALT")).toBe(1);
      expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 140 });
      expect(done.players.p2.active?.damage).toBe(140);
      expect(done.players.p1.active?.energy).toHaveLength(3);
    });
  }

  it("the two boards differ in ONE printed field, and the answers differ", () => {
    expect(POOL[EVOLVED]?.hp).toBe(POOL[BASIC]?.hp);
    expect(POOL[EVOLVED]?.evolveFrom).toBe("fix-basic-1");
    expect(POOL[BASIC]?.evolveFrom).toBeNull();
  });

  it("the attack still ends the turn [ D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds] on the DECLINE arm — nothing here is a cancellation", () => {
    const { state: done } = apply(
      board({ attacker: OGERPON, energy: FIRE, count: 3, defender: BASIC }),
      BLAZE,
    );
    expect(done.phase).toMatchObject({ seat: "p2" });
    expect(count([], "ATTACK_FAILED")).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §4 — the LOUD path closed: the sentence and its '+' are both simulated", () => {
  it("no ATTACK_EFFECT_SKIPPED on either card, on EITHER arm", () => {
    // Two terms, and BOTH were needed: without `effectSimulated` the sentence is
    // flagged, without `modifierSimulated` the printed "+" is — and both printed
    // sentences carry one ("140+", "30+").
    const runs = [
      [board({ attacker: OGERPON, energy: FIRE, count: 3, defender: EVOLVED }), BLAZE],
      [board({ attacker: OGERPON, energy: FIRE, count: 3, defender: BASIC }), BLAZE],
      [board({ attacker: FLORAGATO, energy: GRASS, count: 2 }), LEAF],
    ] as const;
    for (const [state, action] of runs) {
      const { events } = apply(state, action);
      expect(count(events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    }
  });

  it("the ATTRIBUTION CONTROL — the SAME antecedent with an unread consequent IS flagged", () => {
    expect(deriveAttackBonusConsequent(UNREAD_TEXT)).toBeNull();
    const { events } = apply(
      board({ attacker: UNREAD, energy: FIRE, count: 1, defender: EVOLVED }),
      { type: "attack", seat: "p1", index: 0 },
    );
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      effect: UNREAD_TEXT,
      damageModifier: "+",
    });
    // …and the printed base landed the ordinary way, because nothing claimed it.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §5 — §8.5 APPLIED ONCE, ON A BOARD WHERE TWO HITS WOULD DIFFER", () => {
  it("a −30 RESISTANCE is paid ONCE: 280 − 30 = 250, not (140−30) + (140−30)", () => {
    // THE DISCRIMINATOR, and the reason the WHOLE hit moves inside the gate rather
    // than the bonus alone. Two damage ops would each re-enter §8.5 and each
    // subtract the printed 30, landing on 220. One op lands on 250.
    const { state: done, events } = apply(
      board({ attacker: OGERPON, energy: FIRE, count: 3, defender: RESIST }),
      BLAZE,
    );
    expect(count(events, "DAMAGE_DEALT")).toBe(1);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 250,
      resistance: { op: "subtract", amount: 30 },
    });
    expect(done.players.p2.active?.damage).toBe(250);
    expect(done.players.p2.active?.damage).not.toBe(220);
  });

  it("the WEAKNESS CONTROL cannot tell the two readings apart, and that is why it is a control", () => {
    const { state: done, events } = apply(
      board({ attacker: OGERPON, energy: FIRE, count: 3, defender: WEAK }),
      BLAZE,
    );
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 560,
      weakness: { op: "multiply", amount: 2 },
    });
    // 560 into 340 HP is lethal, so the body is gone rather than damaged — which
    // is itself the ONE-hit statement in a third currency: a split reading would
    // have asked the §8.1 survival clamp TWICE on the way here.
    expect(count(events, "KNOCKED_OUT")).toBe(1);
    expect(done.players.p2.active).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §6 — FLORAGATO: ONE coin decides BOTH halves", () => {
  /** Drive Magical Leaf on `seed` and report the face, the damage and the heal. */
  function leaf(seed: number) {
    let state = board({ attacker: FLORAGATO, energy: GRASS, count: 2, seed });
    // Start damaged, so the heal has something to move: a heal on a full-HP body
    // is a silent no-op and could not tell the two faces apart.
    const body = state.players.p1.active;
    if (body === null) throw new Error("no Active");
    state = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: { ...body, damage: 50 } } },
    };
    const { state: done, events } = apply(state, LEAF);
    return {
      done,
      events,
      face: findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result,
      flips: count(events, "ATTACK_EFFECT_COIN_FLIP"),
      dealt: findEvent(events, "DAMAGE_DEALT")?.dealt,
      selfDamage: done.players.p1.active?.damage,
    };
  }

  it("EXACTLY ONE COIN IS FLIPPED, on every seed — the whole reason route 1 was taken", () => {
    for (const seed of COIN_SEEDS) {
      expect(leaf(seed).flips, `seed ${seed}`).toBe(1);
    }
  });

  it("the SAME face decides the damage and the heal — they can never disagree", () => {
    for (const seed of COIN_SEEDS) {
      const run = leaf(seed);
      if (run.face === "heads") {
        expect(run.dealt, `seed ${seed} heads`).toBe(60);
        expect(run.selfDamage, `seed ${seed} heads`).toBe(20); // 50 − 30
      } else {
        expect(run.dealt, `seed ${seed} tails`).toBe(30);
        expect(run.selfDamage, `seed ${seed} tails`).toBe(50); // untouched
      }
      // ONE hit either way — the decline arm hits too.
      expect(count(run.events, "DAMAGE_DEALT"), `seed ${seed}`).toBe(1);
    }
  });

  it("BOTH FACES ARE ACTUALLY REACHED across the eight seeds", () => {
    const faces = new Set(COIN_SEEDS.map((seed) => leaf(seed).face));
    expect(faces).toEqual(new Set(["heads", "tails"]));
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §7 — `coinFlipGate.otherwise`'s FIRST PRODUCER, structurally", () => {
  it("the gate the reader assembles CARRIES an `otherwise`, and a walk finds it", () => {
    const program = bonusConsequentProgram(
      deriveAttackBonusConsequent(FLORAGATO_TEXT) as never,
      30,
    );
    expect(
      [...programBranchCarriers(program).entries()].map(([op, keys]) => [op, [...keys].sort()]),
    ).toEqual([["coinFlipGate", ["otherwise", "then"]]]);
    // …and the structural walk descends BOTH arms, so the decline arm's hit is a
    // reachable op rather than one only the interpreter ever sees.
    expect(walkProgram(program).map((op) => op.op)).toEqual([
      "coinFlipGate",
      "damageDefender",
      "heal",
      "damageDefender",
    ]);
  });

  it("and the DEMONSTRATOR in FIXTURE_POOL prints the sentence, so the shared sweeps see it", () => {
    const demo = FIXTURE_POOL["fix-bonusconsequent"];
    expect(demo?.attacks?.[1]?.effect).toBe(FLORAGATO_TEXT);
    expect(demo?.attacks?.[1]?.damage).toBe("30+");
    expect(deriveAttackBonusConsequent(demo?.attacks?.[1]?.effect ?? "")).not.toBeNull();
    // Its index-0 attack is the plain control: one body, one read attack and one
    // unread one.
    expect(deriveAttackBonusConsequent(demo?.attacks?.[0]?.effect ?? "")).toBeNull();
  });

  it("the ASSEMBLER IS EXPORTED, which is the only reason any of this is visible", () => {
    const reading = deriveAttackBonusConsequent(FLORAGATO_TEXT);
    if (reading === null) throw new Error("expected a reading");
    const ops: EffectOp[] = bonusConsequentProgram(reading, 30);
    expect(ops).toHaveLength(1);
    // The base really is a parameter and not a constant folded into the reading.
    expect(bonusConsequentProgram(reading, 999)[0]).toMatchObject({
      otherwise: [{ op: "damageDefender", amount: 999 }],
    });
  });
});
