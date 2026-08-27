import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { parseAttackDamage } from "./cards";
import { attackReaderSurface, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  optionalBoostProgram,
} from "./effects";
import type { EffectOp } from "./effects";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackRequirement,
  applyAction,
  createGame,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
  walkProgram,
} from "./testFixtures";

// ── D316 — "YOU MAY DO {N} MORE DAMAGE. IF YOU DO, …" — A PLAYER DECISION IN
//    FRONT OF §8.5, AND THE TWO FIELDS IT COST. ────────────────────────────────
//
// THE POPULATION, queried against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-10**, WHOLE
// COLUMN read (D306's rule) and at TWO widths across all three text columns —
// `instr(…,'more damage. If you do')` and the shorter, paraphrase-proof
// `instr(…,'may do ')`, both returning the same five rows and NO
// `legal_standard = 0` row anywhere:
//
//   sv06-043    Poliwrath    idx 1 "Jumping Uppercut"  "120+"  bonus 120
//               "…shuffle this Pokémon and all attached cards into your deck."
//   sv06-104    Gurdurr      idx 1 "Superpower"        "50+"   bonus  30
//               "…this Pokémon also does 30 damage to itself."
//   sv10-066    Dondozo ex   idx 1 "Dynamic Dive"      "120+"  bonus 120
//   sv10-211    Dondozo ex   idx 1 (the same sentence, a second printing)
//               "…this Pokémon also does 50 damage to itself."
//   sv06.5-042  Copperajah   idx 0 "Nasal Lariat"      "130+"  bonus 100
//               "…during your next turn, this Pokémon can't attack."
//
// **FIVE legal printings on FOUR distinct sentences, ONE shared antecedent, and
// THREE consequents that were ALL already built** (`returnSelf` D311–D313,
// `damageSelf` since 0.x, `preventAttack` D142/D143). So what this slice bought
// is not a behaviour — it is a NUMBER: which of two amounts the single §8.5 hit
// uses, and who decides.
//
// ── 🛑 THE TWO PRICINGS THIS ROW HAS HAD, AND WHY BOTH WERE WRONG ────────────
//
// D314: *"a decision feeding a conditional damage boost, and no arm spends a
// `recordGate` slot on the damage step"* — as if a §9.2 slot were the cost.
// D315 refuted that by measurement and then over-corrected: *"closing it is a
// change to the damage pipeline."* **The premise both share is TRUE and the
// conclusion does not follow.** `attack.ts` really does fold the printed damage
// before step 4 runs the program, so nothing inside a program can ADD to a hit
// that has landed — but since Chien-Pao ex it has DROPPED the printed base
// whenever the program OWNS the hit (`programDamage`), and `damageDefender`
// re-enters the whole §8.5 pipeline from inside the interpreter. The hit MOVES
// INTO the gate; the pipeline is untouched. §5 below is the board that proves it.
//
// ── 🛑 AND WHY THE **WHOLE** HIT MOVES, NOT THE BONUS ALONE ──────────────────
//
// §8.5 is applied ONCE PER DAMAGE OP. Landing the base pre-program and the bonus
// from inside it is two hits, and the pipeline does not distribute over them:
// Weakness does (2×120 + 2×120 = 2×240 — §5's CONTROL, which cannot tell the two
// readings apart), but Resistance and the defender's reduction are SUBTRACTIONS
// paid once per hit, so a −30 Resistance would be paid TWICE. §5's discriminator
// board is exactly that: 240 − 30 = **210** on one hit versus (120−30) + (120−30)
// = 180 on two. The §8.1 survival clamp and the `DAMAGE_DEALT` row count answer
// the same question a second and third way.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE new reader (`deriveAttackOptionalBoost`, the EIGHTH), ONE optional field on
// `optional` (`otherwise`, the arm the three other gates have always had) and ONE
// flat `amount` arm on `damageDefender`. **NO new op, prompt kind, choice kind,
// event, error code, `GameState` field, `CardFilter` member or registry row**;
// `packages/schema` takes ZERO and `MATCH_RECORD_VERSION` stays 18 — both
// additions are OPTIONAL fields, so both are widenings a v18 deploy cannot
// author. §9 drives that premise rather than asserting the conclusion.

/** The four printed sentences, transcribed off the D1 rows (D306: transcribe,
    never interpolate). */
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

/** The LOCAL pool (D275's idiom) — the three real ids live HERE and not in
    `FIXTURE_POOL`, so no `fix-*` demonstrator and no manifest row is owed. */
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

/** Two seeds — nothing below rests on one shuffle (D270). */
const SEEDS = [4021, 4099] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
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

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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
  // 🆕🆕 D419 — the readers this COMPLEMENT never named (D317, D381, D403, D417), written
  // in NAME order rather than in landing order because the guard in §2 diffs a
  // SORTED list against the module surface.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackDamageSuppression,
];

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

  it("🛑 each sentence reads into its BONUS and the ops its acceptance buys", () => {
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

  it("⚠️ the ops are BYTE-IDENTICAL to the ones the BARE sentences derive", () => {
    // The whole claim of the slice: three consequents already built, so this
    // reader authors no behaviour at all. Each pair is the gated reading beside
    // the bare anchor's own output — `FLIP_TAILS_SELF_DAMAGE`'s shape, one family
    // over, and the reason the recoil amount is CAPTURED rather than pinned.
    expect(deriveAttackOptionalBoost(GURDURR_TEXT)?.ops).toEqual(
      deriveAttackEffect("This Pokémon also does 30 damage to itself."),
    );
    expect(deriveAttackOptionalBoost(DONDOZO_TEXT)?.ops).toEqual(
      deriveAttackEffect("This Pokémon also does 50 damage to itself."),
    );
    expect(deriveAttackOptionalBoost(COPPERAJAH_TEXT)?.ops).toEqual(
      deriveAttackEffect("During your next turn, this Pokémon can't attack."),
    );
    // `returnSelf`'s bare printing is a REGISTRY row rather than a deriver arm
    // (D312, Gholdengo "Surf Back"), so its control is that row's inner op.
    expect(deriveAttackOptionalBoost(POLIWRATH_TEXT)?.ops).toEqual([
      { op: "returnSelf", dest: "deck" },
    ]);
  });

  it("🛑 NO registry ATTACK row is authored for any of the five printings — an ARM serves them all", () => {
    // An arm transfers across sets and a row does not: ONE reader serves four
    // sentences, both Dondozo ex printings and every future reprint of any of
    // them. ⚠️ **AND COPPERAJAH IS THE CASE THAT MAKES THIS AN `attack` TEST AND
    // NOT A `programFor` ONE** — `sv06.5-042` carries a registry row already, for
    // its ABILITY ("Massive Body", a Stadium-play passive). The claim is about the
    // ATTACK half, and a bare `toBeUndefined()` here would have been asserting the
    // wrong thing on a card the slice actually touches.
    for (const id of [POLIWRATH, GURDURR, COPPERAJAH, "sv10-066", "sv10-211"]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(programFor(COPPERAJAH)?.passive).toBeDefined();
  });

  it("⚠️ INDEX PRECISION — Poliwrath's other attack is read by a DIFFERENT reader", () => {
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
  it("🆕🆕 D419 — OTHER_READERS plus the reader under test IS the module's surface", () => {
    // 🛑 THE GUARD THIS COMPLEMENT NEVER HAD, AND A COMPLEMENT IS WHERE A STALE LIST
    // DOES ITS WORST WORK. The rung below asserts that all the OTHER readers refuse
    // all four of this slice's sentences — a claim whose entire force is the word ALL. A list that has fallen
    // behind `effects.ts` does not make that claim FALSE, it makes it NARROWER, and
    // narrower is invisible: the missing reader is simply never asked and the rung
    // stays green. This list ran short of the module until this slice, so the
    // refusal below was quantified over a strict subset of the surface.
    expect([...OTHER_READERS.map((read) => read.name), "deriveAttackOptionalBoost"].sort()).toEqual(
      attackReaderSurface(),
    );
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the refusals would quietly
    // narrow again with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 all ELEVEN other readers refuse all four sentences", () => {
    for (const text of [POLIWRATH_TEXT, GURDURR_TEXT, DONDOZO_TEXT, COPPERAJAH_TEXT]) {
      // 🆕🆕 D419 — THE POSITIVE HALF, TAKEN OFF THE MODULE. "Exactly one reader
      // claims this" is two facts and the loop only ever carried the second;
      // `resolvedByAnyReader` walks whatever `effects.ts` exports today.
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const read of OTHER_READERS) expect(read(text), text).toBeNull();
      expect(deriveAttackOptionalBoost(text), text).not.toBeNull();
    }
  });

  it("the ATTRIBUTION CONTROL — a sentence this reader must NOT claim", () => {
    // D214's rule: without it, "every sentence resolves" would pass just as
    // happily on a broken import.
    expect(deriveAttackOptionalBoost("Draw a card.")).toBeNull();
    expect(deriveAttackEffect("Draw a card.")).not.toBeNull();
  });

  it("🛑 an UNRECOGNISED consequent refuses the WHOLE sentence — never a prefix match", () => {
    // The family's safety property. A reader that swallowed the antecedent and
    // dropped the consequent would ship an attack whose drawback silently
    // vanished, which is strictly worse than not reading it at all.
    for (const tail of [
      "discard 2 Energy from this Pokémon.",
      "your opponent's Active Pokémon is now Paralyzed.",
      "shuffle this Pokémon and all attached cards into your hand.",
      "during your opponent's next turn, this Pokémon can't attack.",
    ]) {
      expect(deriveAttackOptionalBoost(`You may do 60 more damage. If you do, ${tail}`), tail).toBeNull();
    }
  });

  it("⚠️ the consequent's verb is LOWERCASE, and a CAPITAL one is refused", () => {
    // D246's rule: the case is spelled at the anchor, never folded into a `[Tt]`
    // class — the capital is exactly what keeps a whole-sentence reader off a
    // mid-sentence clause, and a class here would give that up in both
    // directions at once.
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

  it("⚠️ the CURLY apostrophe resolves EQUALLY — the class is on the anchor (D136/D137)", () => {
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

  it("⚠️ the REACH is wider than the census, and it is the arm's own parameterisation", () => {
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
      // 🛑 THE BASE IS DROPPED. `scaledBase` is 0 because the reader claimed the
      // printed number, so the pre-program pipeline deals nothing at all and the
      // whole hit is still owed by the program.
      expect(parked.players.p2.active?.damage).toBe(0);
      expect(count(events, "DAMAGE_DEALT")).toBe(0);
      expect(parked.phase.kind).toBe("effect:choose");
      // The note is the WHOLE printed sentence — the player is agreeing to the
      // drawback as much as to the damage.
      expect(find(events, "EFFECT_PENDING")).toMatchObject({ seat: "p1", note: POLIWRATH_TEXT });
    });
  }

  it("🛑 a YES deals base + bonus in ONE hit and then runs the consequent", () => {
    const parked = must(
      applyAction(board({ attacker: POLIWRATH, energy: WATER, count: 2 }), UPPERCUT),
    );
    const { state: done, events } = apply(parked, YES);
    expect(count(events, "DAMAGE_DEALT")).toBe(1);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 240, base: 240 });
    expect(done.players.p2.active?.damage).toBe(240);
    // …and the printed consequent ran: the attacker left the board.
    expect(find(events, "POKEMON_RETURNED")).toMatchObject({ seat: "p1", dest: "deck" });
  });

  it("🛑 a NO deals the printed BASE — the arm that did not exist before D316", () => {
    // ⚠️ THIS IS THE WHOLE FIELD. Before `otherwise`, a decline spliced NOTHING,
    // and with the base suppressed that would have dealt ZERO on a sentence whose
    // printed no still hits for 120.
    const parked = must(
      applyAction(board({ attacker: POLIWRATH, energy: WATER, count: 2 }), UPPERCUT),
    );
    const { state: done, events } = apply(parked, NO);
    expect(count(events, "DAMAGE_DEALT")).toBe(1);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 120, base: 120 });
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
  it("🛑 no ATTACK_EFFECT_SKIPPED on any of the three real boards", () => {
    // Two terms, and BOTH were needed: without `effectSimulated` the sentence is
    // flagged, without `modifierSimulated` the printed "+" is — and every one of
    // the five printings carries one.
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

  it("🛑 the ATTRIBUTION CONTROL — the SAME antecedent with an unread consequent IS flagged", () => {
    // Without this the assertion above would pass on a board where nothing is
    // ever flagged, which is the vacuous shape D214 was written about — and the
    // control shares the antecedent deliberately, so what it isolates is the
    // DISPATCH and not the anchor.
    expect(deriveAttackOptionalBoost(UNREAD_TEXT)).toBeNull();
    const { events } = apply(
      board({ attacker: UNREAD, energy: WATER, count: 1 }),
      { type: "attack", seat: "p1", index: 0 },
    );
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      effect: UNREAD_TEXT,
      damageModifier: "+",
    });
    // …and the printed base landed the ordinary way, because nothing claimed it.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D316 §5 — 🛑 §8.5 APPLIED ONCE, ON A BOARD WHERE TWO HITS WOULD DIFFER", () => {
  it("🛑 a −30 RESISTANCE is paid ONCE: 240 − 30 = 210, not (120−30) + (120−30)", () => {
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
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
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

  it("⚠️ the WEAKNESS CONTROL cannot tell the two readings apart, and that is why it is a control", () => {
    // ×2 DISTRIBUTES over the split (2×120 + 2×120 = 2×240), so a Weakness board
    // is green under both readings. Kept because a suite that only ever drove
    // this board would have proved nothing about the split at all.
    const parked = must(
      applyAction(board({ attacker: POLIWRATH, energy: WATER, count: 2, defender: WEAK }), UPPERCUT),
    );
    const { state: done, events } = apply(parked, YES);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
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

  it("🛑 Gurdurr's recoil can KNOCK ITSELF OUT — the two-seat epilogue, reached through a confirm", () => {
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
    expect(find(events, "PRIZES_OWED")).toMatchObject({ seat: "p2", count: 1 });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    // ⚠️ AND THE ROW SHAPES ARE THE TWO MODELS SIDE BY SIDE, which is worth
    // reading off this one board: the DEFENDER's hit is `DAMAGE_DEALT` (the full
    // §8.5 pipeline, from inside the gate) and the recoil is `COUNTERS_PLACED`
    // (the flat put-counter model `damageSelf` has always used). One sentence,
    // two damage models, and the slice changed neither.
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

  it("🛑 the DECLINED Copperajah can attack again next turn, and the ACCEPTED one cannot", () => {
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
describe("D316 §7 — 🛑 THE WIDENING, DRIVEN AT ITS PREMISE RATHER THAN ASSERTED", () => {
  it("`optional.otherwise` has EXACTLY ONE producer in the whole build, and it is not the registry", () => {
    // `MATCH_RECORD_VERSION` stays 18 because a v18 deploy cannot AUTHOR this
    // field, so no v18 record can hold one. That is a claim about the producers,
    // and this is the producer set: every registry program, walked structurally.
    const authored: string[] = [];
    let optionalsSeen = 0;
    let programsWalked = 0;
    for (const id of registryCardIds()) {
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
    expect(authored).toEqual([]);
    // …and the ONE producer is this reader's assembly site — `optionalBoostProgram`,
    // which lived inside attack.ts until D318 MOVED it into effects.ts so a sweep
    // could build it (see §8). It is still reached from a board only through
    // attack.ts, and the park below is that producer, observed.
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

  it("⚠️ every EXISTING `optional` producer still omits `otherwise` and reads identically", () => {
    // The widening's other half: absent, the field is the empty list, so the
    // splice expression is byte-equivalent to the old one for every producer that
    // predates D316. Gholdengo's row is the shipped witness.
    expect(programFor("sv08-131")?.attack?.[1]).toEqual([
      {
        op: "optional",
        note: "You may shuffle this Pokémon and all attached cards into your deck.",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "returnSelf", dest: "deck" }],
      },
    ]);
  });
});

// ── D318 — THE ASSEMBLY MOVED OUT OF ITS CALL SITE, AND WHY THAT IS A REPAIR
//    RATHER THAN A TIDY-UP. ────────────────────────────────────────────────────
//
// §7 above proves `optional.otherwise` has exactly one producer and that it is
// reachable only through a board. That was true and it was also the DEFECT:
// `programWalk.test.ts` builds its corpus from `deriveAttackEffect` over
// `FIXTURE_POOL` + the registry + the readings fed to it, so a program assembled
// INSIDE `attack.ts` is invisible to it — and its carrier pin read
// `["optional", ["then"]]` for the two slices in which this field was live,
// shipped and running on five printed cards.
//
// 🛑 THE REPAIR IS NOT A BETTER TEST. It is moving the assembly:
// `optionalBoostProgram(reading, base, note)` now lives in `effects.ts` and
// `attack.ts` calls it, so the shape the engine runs is the shape an auditor can
// build. D317 did this for `bonusConsequentProgram` on the very next sentence and
// its `coinFlipGate.otherwise` became that pin's first producer in 48 slices;
// this is the same repair applied backwards, and D150's `programPerHeads.ops`
// lesson at its fourth site.
//
// ⚠️ AND THE EXPORT ALONE WOULD HAVE BEEN GREEN AND DEAD. `FIXTURE_POOL` printed
// this sentence ZERO times — measured at D317's HEAD, `grep -c "You may do"` on
// `testFixtures.ts` — so the sweep would have had nothing to call the assembler
// on and the pin would not have moved by one character. `fix-optionalboost`
// (Gurdurr `sv06-104`'s whole printed card, transcribed off the remote D1) is the
// other half, and the two cases below drive each half separately.

describe("D318 §8 — the exported assembler, and the pool that can now reach it", () => {
  it("builds the SAME program the board parks — the export is the code, not a second copy", () => {
    // 🛑 THE ATTRIBUTION CONTROL D214 asks for. A test that only called the new
    // export would pass on a build where `attack.ts` kept a divergent inline copy
    // — which is the exact failure the move exists to prevent. So the assembled
    // program is compared against the one a REAL BOARD parks, byte for byte.
    const reading = deriveAttackOptionalBoost(POLIWRATH_TEXT);
    expect(reading).not.toBeNull();
    const built = optionalBoostProgram(reading as never, 120, POLIWRATH_TEXT);
    expect(built).toEqual([
      {
        op: "optional",
        note: POLIWRATH_TEXT,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
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
        expect(gate.then[0], `${text} @ ${trial}`).toEqual({
          op: "damageDefender",
          amount: trial + bonus,
        });
        // The consequent rides BEHIND the hit, in printed order, and is never
        // swallowed — the failure this reader's `^…$` dispatch exists against.
        expect(gate.then.length).toBe(2);
        expect(gate.note).toBe(text);
      }
    }
  });

  it("🛑 `FIXTURE_POOL` can now REACH the shape — the half an exported assembler does not buy", () => {
    // The pool-reachability claim, asserted here rather than only in
    // `programWalk.test.ts`, because that file's pin is a list of op/key pairs and
    // this is the sentence that puts a producer under it.
    const pooled = Object.entries(FIXTURE_POOL).flatMap(([id, card]) =>
      (card.attacks ?? [])
        .map((attack, index) => ({ id, index, text: attack.effect ?? "" }))
        .filter((row) => deriveAttackOptionalBoost(row.text) !== null),
    );
    // EXACTLY ONE, and named. A second demonstrator is a finding (two fixtures
    // printing the same family is how a pool grows a silent duplicate), not a
    // shrug — and ZERO is the state D318 found, in which every line of the
    // exported assembler is covered and no sweep answer changes.
    expect(pooled.map((r) => `${r.id}#${r.index}`)).toEqual(["fix-optionalboost#1"]);
    const card = FIXTURE_POOL["fix-optionalboost"];
    const attack = (card?.attacks ?? [])[1];
    expect(attack?.name).toBe("Superpower");
    // The printed "+" is real: the assembler takes the base from the `damage`
    // field, so a fixture printing a FLAT number exercises the wrong half.
    expect(attack?.damage).toBe("50+");
    expect(attack?.effect).toBe(GURDURR_TEXT);
    const gate = optionalBoostProgram(
      deriveAttackOptionalBoost(attack?.effect ?? "") as never,
      parseAttackDamage(attack?.damage).base,
      attack?.effect ?? "",
    )[0];
    if (gate?.op !== "optional") throw new Error("the pooled fixture does not assemble an `optional`");
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
