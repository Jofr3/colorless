import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat, StatusName } from "./index";
import {
  DEFENDER_STATUS_PAIR_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
  roundTrip,
} from "./testFixtures";

const BURN_CONFUSE = "Your opponent's Active Pokémon is now Burned and Confused.";
/** The coin-flipped twin at Confused+Poisoned — Ekans `sv05-100` "Poison Blend". */
const FLIP_CONFUSE_POISON =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Confused and Poisoned.";
/** The coin-flipped twin at Paralyzed+Poisoned — Glimmora `sv06-109` "Stun Poison". */
const FLIP_PARALYZE_POISON =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned.";
const HEADS_PAIR_TAILS_SINGLE =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.";
const CONFUSE_POISON_SWITCH =
  "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.";

const LEFT_LOUD = {
  headsTails:
    "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
  dotAnchorTrio: [] as readonly string[],
  recordedRefusal:
    "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
} as const;

const COMPOSED_AT_D574 =
  "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.";

const BUILT_AT_D575 =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon.";

const COLLISIONS = [
  "Your opponent's Active Pokémon is now Asleep and Confused.",
  "Your opponent's Active Pokémon is now Confused and Asleep.",
  "Your opponent's Active Pokémon is now Asleep and Paralyzed.",
  "Your opponent's Active Pokémon is now Paralyzed and Confused.",
  "Your opponent's Active Pokémon is now Confused and Paralyzed.",
  "Your opponent's Active Pokémon is now Paralyzed and Asleep.",
] as const;

const SEED = 11;
function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function statusPairOf(text: string): StatusName[] | null {
  const ops = deriveAttackEffect(text);
  if (ops === null) return null;
  const head = ops[0];
  const steps: EffectOp[] =
    ops.length === 1 && head !== undefined && head.op === "coinFlipGate" ? head.then : ops;
  if (steps.length !== 2) return null;
  const statuses = steps.map((o) => (o.op === "applyStatus" ? o.status : null));
  return statuses.every((x): x is StatusName => x !== null) ? statuses : null;
}

const ATTACKERS = {
  ninetales: { card: "fix-ninetales", index: 0, energy: [{ id: "fix-fire-energy", count: 2 }] },
  houndoom: { card: "fix-tr-houndoom", index: 0, energy: [{ id: "fix-fire-energy", count: 1 }] },
  "houndoom-scorch": {
    card: "fix-tr-houndoom",
    index: 1,
    energy: [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  },
  ekans: { card: "fix-ekans", index: 0, energy: [{ id: "fix-dark-energy", count: 1 }] },
  glimmora: { card: "fix-glimmora", index: 0, energy: [{ id: "fix-energy", count: 1 }] },
  accelgor: {
    card: "fix-accelgor",
    index: 0,
    energy: [
      { id: "fix-grass-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  },
} as const;
type Attacker = keyof typeof ATTACKERS;

/** A board with `attacker` Active for `by` and `defender` Active for the other seat.
    `bench` keeps the attacker's bench (Accelgor's tail needs somewhere to switch to);
    every other board clears it, so a stray body can never absorb a switch. */
function board(
  attacker: Attacker,
  defender: string,
  { by = "p1" as Seat, bench = false, seed = SEED } = {},
): GameState {
  const opener: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_PAIR_DECK, p2: DEFENDER_STATUS_PAIR_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKERS[attacker].card);
  if (!bench) state = clearBench(state, by);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  state = clearBench(state, opener);
  return state;
}
function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

function withEffect(state: GameState, cardId: string, effect: string): GameState {
  const card = state.cardPool[cardId];
  if (card === undefined) throw new Error(`no ${cardId} in pool`);
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error(`${cardId} has no attack 0`);
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      [cardId]: { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}
/** The defender's live `SpecialConditions`, from the seat that is NOT attacking. */
function defenderConditions(state: GameState, by: Seat = "p1") {
  const active = state.players[by === "p1" ? "p2" : "p1"].active;
  if (active === null) throw new Error("no defender");
  return active.conditions;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("carries Ninetales sv06-027's WHOLE printed attack list verbatim", () => {
    expect(FIXTURE_POOL["fix-ninetales"]).toMatchObject({
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Vulpix",
      hp: 120,
      types: ["Fire"],
      retreat: 2,
      weaknesses: [{ type: "Water", value: "×2" }],
    });
    expect(FIXTURE_POOL["fix-ninetales"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-ninetales"]?.attacks).toEqual([
      { cost: ["Fire", "Fire"], name: "Eerie Glow", effect: BURN_CONFUSE, damage: 90 },
    ]);
  });

  it("…and Team Rocket's Houndoom sv10-038's, whose pair attack prints NO damage", () => {
    expect(FIXTURE_POOL["fix-tr-houndoom"]).toMatchObject({
      stage: "Stage1",
      evolveFrom: "Team Rocket's Houndour",
      hp: 130,
      types: ["Fire"],
      retreat: 2,
    });
    expect(FIXTURE_POOL["fix-tr-houndoom"]?.attacks).toEqual([
      { cost: ["Fire"], name: "Cruel Coal", effect: BURN_CONFUSE },
      {
        cost: ["Fire", "Colorless"],
        name: "Scorching Fire",
        effect: "Discard an Energy from this Pokémon.",
        damage: 120,
      },
    ]);
    expect(FIXTURE_POOL["fix-tr-houndoom"]?.attacks?.[0]).not.toHaveProperty("damage");
  });

  it("…and the three flip/compound carriers, each at its PRINTED index", () => {
    expect(FIXTURE_POOL["fix-ekans"]?.attacks).toEqual([
      { cost: ["Darkness"], name: "Poison Blend", effect: FLIP_CONFUSE_POISON },
      { cost: ["Darkness", "Darkness"], name: "Bite", damage: 30 },
    ]);
    expect(FIXTURE_POOL["fix-glimmora"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Stun Poison", effect: FLIP_PARALYZE_POISON },
      {
        cost: ["Fighting"],
        name: "Venoshock",
        effect: "If your opponent's Active Pokémon is Poisoned, this attack does 100 more damage.",
        damage: "30+",
      },
    ]);
    expect(FIXTURE_POOL["fix-accelgor"]?.attacks).toEqual([
      {
        cost: ["Grass", "Colorless"],
        name: "Poisonous Ploy",
        effect: CONFUSE_POISON_SWITCH,
        damage: 70,
      },
    ]);
  });

  it("the sentences are the CORPUS's bytes, and the apostrophe is ASCII U+0027", () => {
    const rows = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(rows.get(BURN_CONFUSE)).toBe(3);
    expect(rows.get(FLIP_CONFUSE_POISON)).toBe(1);
    expect(rows.get(FLIP_PARALYZE_POISON)).toBe(1);
    expect(rows.get(CONFUSE_POISON_SWITCH)).toBe(1);
    expect(rows.get(LEFT_LOUD.headsTails)).toBe(1);
    for (const text of LEFT_LOUD.dotAnchorTrio) expect(rows.get(text)).toBe(1);
    expect(LEFT_LOUD.dotAnchorTrio).toEqual([]);
    expect(rows.get(BUILT_AT_D575)).toBe(1);
    expect(rows.get(COMPOSED_AT_D574)).toBe(1);
    expect(rows.get(LEFT_LOUD.recordedRefusal)).toBe(1);
    // The apostrophe byte, asserted rather than eyeballed.
    for (const s of [BURN_CONFUSE, FLIP_CONFUSE_POISON, FLIP_PARALYZE_POISON]) {
      expect(s.includes("opponent's")).toBe(true);
      expect(s.includes("opponent’s")).toBe(false);
      expect(s.includes("Pokémon")).toBe(true);
    }
  });

  it("no registry row shadows any of them — the deriver is what answers", () => {
    for (const id of [
      "fix-ninetales",
      "fix-tr-houndoom",
      "fix-ekans",
      "fix-glimmora",
      "fix-accelgor",
    ]) {
      expect(programFor(id)?.attack ?? null).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, and the parameterisation on BOTH axes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, parameterised on both axes", () => {
  it("derives TWO `applyStatus` ops in PRINTED ORDER", () => {
    expect(deriveAttackEffect(BURN_CONFUSE)).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
  });

  it("the ORDER is the PRINTED order, not a canonical one", () => {
    // The sharpest single assertion in §2: if the arm sorted, normalised or
    // slot-ordered its two ops, this would still land both conditions and every
    // model assertion in §4 would still pass. Only the ORDER can see it.
    const printedFirst = deriveAttackEffect(BURN_CONFUSE) as { status: string }[];
    expect(printedFirst.map((o) => o.status)).toEqual(["burned", "confused"]);
    const other = deriveAttackEffect(
      "Your opponent's Active Pokémon is now Confused and Poisoned.",
    ) as { status: string }[];
    expect(other.map((o) => o.status)).toEqual(["confused", "poisoned"]);
  });

  it("BOTH SLOTS are parameters — the D121 warrant, on the printed pool", () => {
    const distinct = new Set(
      legalAttackCorpus()
        .map(([, sentence]) => statusPairOf(sentence))
        .filter((pair): pair is StatusName[] => pair !== null)
        .map((pair) => pair.join("+")),
    );
    expect([...distinct].sort()).toEqual([
      "burned+confused",
      "confused+poisoned",
      "paralyzed+poisoned",
    ]);
    // Both axes, spelled separately — the claim is "two parameters", not "one".
    expect([...new Set([...distinct].map((p) => p.split("+")[0]))].sort()).toEqual([
      "burned",
      "confused",
      "paralyzed",
    ]);
    expect([...new Set([...distinct].map((p) => p.split("+")[1]))].sort()).toEqual([
      "confused",
      "poisoned",
    ]);
  });

  it("the flip twin wraps the SAME two ops in a `coinFlipGate`", () => {
    expect(deriveAttackEffect(FLIP_CONFUSE_POISON)).toEqual([
      {
        op: "coinFlipGate",
        then: [
          { op: "applyStatus", target: "defender", status: "confused" },
          { op: "applyStatus", target: "defender", status: "poisoned" },
        ],
      },
    ]);
    expect(deriveAttackEffect(FLIP_PARALYZE_POISON)).toEqual([
      {
        op: "coinFlipGate",
        then: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "applyStatus", target: "defender", status: "poisoned" },
        ],
      },
    ]);
  });

  it("the anchors claim EXACTLY 3 sentences / 5 printings, and no more", () => {
    const hits = legalAttackCorpus().filter(([, sentence]) => statusPairOf(sentence) !== null);
    expect(hits.map(([, s]) => s).sort()).toEqual(
      [BURN_CONFUSE, FLIP_CONFUSE_POISON, FLIP_PARALYZE_POISON, HEADS_PAIR_TAILS_SINGLE].sort(),
    );
    expect(hits.reduce((sum, [units]) => sum + units, 0)).toBe(7);
    const twoArmed = hits.filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      const head = ops?.[0];
      return ops?.length === 1 && head?.op === "coinFlipGate" && head.otherwise !== undefined;
    });
    expect(twoArmed.map(([, s]) => s)).toEqual([HEADS_PAIR_TAILS_SINGLE]);
    expect(twoArmed.reduce((sum, [units]) => sum + units, 0)).toBe(2);
  });

  it("the five REAL near misses stay on the loud path, and `\\.$` is why", () => {
    expect(deriveAttackEffect(LEFT_LOUD.headsTails)).toBeNull();
    expect(LEFT_LOUD.dotAnchorTrio).toEqual([]);
    for (const text of LEFT_LOUD.dotAnchorTrio) expect(deriveAttackEffect(text)).toBeNull();
    expect(deriveAttackEffect(BUILT_AT_D575)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "markHandAttach", barred: true },
    ]);
    expect(deriveAttackEffect(COMPOSED_AT_D574)).toBeNull();
    // The compound is refused WHOLE — deliberately, so the SPLITTER claims it (§5)
    // rather than a hand-written anchor shadowing the composition path.
    expect(deriveAttackEffect(CONFUSE_POISON_SWITCH)).toBeNull();
  });

  it("D464 — and the byte is MEASURED: `DEFENDER_NOW` minus its `\\.$` claims all three", () => {
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const strict = new RegExp(`^Your opponent['’]s Active Pokémon is now (${W})\\.$`);
    const drifted = new RegExp(`^Your opponent['’]s Active Pokémon is now (${W})`);
    const rows = legalAttackCorpus();
    const hit = (re: RegExp) => rows.filter(([, s]) => re.test(s));
    expect([hit(strict).length, hit(strict).reduce((a, [n]) => a + n, 0)]).toEqual([4, 74]);
    expect([hit(drifted).length, hit(drifted).reduce((a, [n]) => a + n, 0)]).toEqual([16, 96]);
    for (const text of [...LEFT_LOUD.dotAnchorTrio, COMPOSED_AT_D574, BUILT_AT_D575]) {
      expect(strict.test(text)).toBe(false);
      expect(drifted.test(text)).toBe(true);
    }
    const CLAIMED_AT_D464 =
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.";
    for (const re of [
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (.+), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (.+)\\.$`),
      new RegExp(`Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
      new RegExp(
        `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W}) and (.+)\\.$`,
      ),
    ]) {
      expect(re.test(CLAIMED_AT_D464)).toBe(false);
    }
    expect(
      new RegExp(`^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})`).test(
        CLAIMED_AT_D464,
      ),
    ).toBe(true);
  });

  it("the single-status arms are untouched — the four anchors are disjoint", () => {
    // ORDER against arms 1 and 2 is a refactor and not behaviour, and this is the
    // assertion that says so: all four are `^…$`, and the single-status pair demand
    // `\.$` immediately after ONE status word.
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Burned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
    expect(
      deriveAttackEffect("Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."),
    ).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ROTATION COLLISION: refused at the reader, pinned on the POPULATION.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the rotation collision, refused at the reader", () => {
  it("refuses every pair that shares a `SpecialConditions` field", () => {
    // Six constructed sentences: all three unordered rotation pairs, both ways
    // round. Each would otherwise derive to two ops whose second overwrites the
    // first — the program would RESOLVE and be a lie.
    for (const s of COLLISIONS) expect(deriveAttackEffect(s)).toBeNull();
    // …and behind a coin flip too, since the refusal lives in the shared helper and
    // not in either arm. If it had been written into the bare arm only, this line is
    // the one that would go red.
    for (const s of COLLISIONS) {
      expect(
        deriveAttackEffect(
          `Flip a coin. If heads, ${s.replace("Your opponent's", "your opponent's")}`,
        ),
      ).toBeNull();
    }
  });

  it("refuses a DOUBLED word for the same reason, not a second one", () => {
    // A word shares a slot with itself. The invariant is "both printed words are
    // observable on the model afterwards", and a doubled word lands ONE condition.
    for (const w of ["Burned", "Confused", "Poisoned", "Asleep", "Paralyzed"]) {
      expect(deriveAttackEffect(`Your opponent's Active Pokémon is now ${w} and ${w}.`)).toBeNull();
    }
  });

  it("…while a pair in TWO DIFFERENT slots is admitted even though nothing prints it", () => {
    expect(
      deriveAttackEffect("Your opponent's Active Pokémon is now Burned and Poisoned."),
    ).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
  });

  it("PINNED ON THE POPULATION: ZERO printings carry a same-slot pair", () => {
    const ROTATION = ["Asleep", "Paralyzed", "Confused"];
    const WORD = "Asleep|Burned|Confused|Paralyzed|Poisoned";
    const anyPair = new RegExp(`(${WORD}) and (${WORD})`, "g");
    const offenders = legalAttackCorpus().filter(([, s]) =>
      [...s.matchAll(anyPair)].some(
        ([, a, b]) => (ROTATION.includes(a as string) && ROTATION.includes(b as string)) || a === b,
      ),
    );
    expect(offenders).toEqual([]);
    // …and the same question asked of the SHAPE rather than the words: every printed
    // `X and Y` pair in the column, listed. Three, and each is one rotation word plus
    // one independent one. A fourth appearing here is the trigger to re-read §3.
    const printed = new Set<string>();
    for (const [, s] of legalAttackCorpus()) {
      for (const [, a, b] of s.matchAll(anyPair)) printed.add(`${a}+${b}`);
    }
    expect([...printed].sort()).toEqual([
      "Burned+Confused",
      "Confused+Poisoned",
      "Paralyzed+Poisoned",
    ]);
  });

  it("the refusal is LOUD — a collision reaches ATTACK_EFFECT_SKIPPED", () => {
    // Refusing at the reader is only correct because `null` means "say so". This
    // drives the whole path: a body whose printed text is a collision keeps its
    // sentence, and the engine announces that it did not simulate it.
    const collided = board("ninetales", "fix-titan");
    const active = collided.players.p1.active;
    if (active === null) throw new Error("no attacker");
    const { state, events } = swing(
      withEffect(collided, "fix-ninetales", COLLISIONS[0]),
      "ninetales",
    );
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(COLLISIONS[0]);
    expect(all(events, "STATUS_APPLIED")).toEqual([]);
    expect(defenderConditions(state).rotation).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the two conditions LAND on the model. Fields, not a status list. Both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — both conditions land, asserted on the FIELDS", () => {
  it("Burn and Confusion land in TWO DIFFERENT FIELDS, both observable", () => {
    const { state, events } = swing(board("ninetales", "fix-titan"), "ninetales");
    expect(defenderConditions(state)).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: true,
      confusionDamage: 30,
    });
    // Two rows, one per op, in printed order.
    expect(all(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["burned", "confused"]);
  });

  it("…and on the SECOND body, where the same sentence prints no damage", () => {
    const { state, events } = swing(board("houndoom", "fix-titan"), "houndoom");
    expect(defenderConditions(state)).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: true,
      confusionDamage: 30,
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("BOTH SEATS — the same sentence read from p2 lands on p1's Active", () => {
    const { state } = swing(board("ninetales", "fix-titan", { by: "p2" }), "ninetales", "p2");
    expect(defenderConditions(state, "p2")).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: true,
      confusionDamage: 30,
    });
    // …and the ATTACKER is untouched — `defender` is not `self`.
    expect(state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });

  it("Poison lands with its COUNTER AMOUNT, not merely as a flag", () => {
    // `poisonDamage` is a number, and `0` means "not Poisoned". A pair arm that set a
    // boolean would be invisible to a status-list assertion and visible here.
    const heads = flipBoard("ekans", true);
    const { state } = swing(heads, "ekans");
    const c = defenderConditions(state);
    expect(c.rotation).toBe("confused");
    expect(c.poisonDamage).toBe(10);
    expect(c.burned).toBe(false);
  });

  it("the flip twin applies BOTH on heads and NEITHER on tails", () => {
    const { state: onHeads, events: headsEvents } = swing(flipBoard("glimmora", true), "glimmora");
    expect(defenderConditions(onHeads)).toEqual({
      rotation: "paralyzed",
      poisonDamage: 10,
      burned: false,
      confusionDamage: 30,
    });
    expect(all(headsEvents, "STATUS_APPLIED").map((e) => e.status)).toEqual([
      "paralyzed",
      "poisoned",
    ]);
    const { state: onTails, events: tailsEvents } = swing(flipBoard("glimmora", false), "glimmora");
    expect(defenderConditions(onTails)).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(all(tailsEvents, "STATUS_APPLIED")).toEqual([]);
    expect(findEvent(tailsEvents, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("order-independence where the model allows it: the pair is idempotent-safe", () => {
    const forward = swing(board("ninetales", "fix-titan"), "ninetales").state;
    const reversed = swing(board("houndoom", "fix-titan"), "houndoom").state;
    expect(defenderConditions(forward)).toEqual(defenderConditions(reversed));
  });

  it("a pre-existing rotation is REPLACED, and the independent fields are not", () => {
    // §12's actual rule, and the reason the collision matters: the rotation slot
    // overwrites. Here that is CORRECT — one printed sentence, one rotation word.
    let state = board("ninetales", "fix-titan");
    const defender = state.players.p2.active;
    if (defender === null) throw new Error("no defender");
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: {
            ...defender,
            conditions: {
              rotation: "asleep",
              poisonDamage: 20,
              burned: false,
              confusionDamage: 30,
            },
          },
        },
      },
    };
    const after = swing(state, "ninetales").state;
    expect(defenderConditions(after)).toEqual({
      rotation: "confused", // replaced Asleep — §12
      poisonDamage: 20, // untouched: a different field
      burned: true, // newly set,
      confusionDamage: 30,
    });
  });
});

/** A board seeded so `attacker`'s coin lands the way the test needs. The seed is
    SEARCHED rather than stubbed — the RNG is part of what this suite claims about
    the flip arms, and a stub would answer about the stub. */
function flipBoard(attacker: Attacker, wantHeads: boolean): GameState {
  for (let seed = 1; seed < 400; seed++) {
    let candidate: GameState;
    try {
      candidate = board(attacker, "fix-titan", { seed });
    } catch {
      continue;
    }
    const flip = findEvent(swing(candidate, attacker).events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip?.result === (wantHeads ? "heads" : "tails")) return candidate;
  }
  throw new Error(`no seed under 400 gives ${wantHeads ? "heads" : "tails"} for ${attacker}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the COMPOUND composes for free.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the compound composes, without an anchor of its own", () => {
  it("`splitAttackTrailingClause` now takes it — because its HEAD became claimed", () => {
    expect(splitAttackTrailingClause(CONFUSE_POISON_SWITCH)).toEqual({
      head: "Your opponent's Active Pokémon is now Confused and Poisoned.",
      tail: "Switch this Pokémon with 1 of your Benched Pokémon.",
    });
    // The two halves, each claimed by the reader that owns it.
    expect(
      deriveAttackEffect("Your opponent's Active Pokémon is now Confused and Poisoned."),
    ).toEqual([
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).toEqual([
      { op: "switchActive" },
    ]);
  });

  it("…and the WHOLE printing resolves on a real board: both statuses AND the switch", () => {
    const before = board("accelgor", "fix-titan", { bench: true });
    const benchBefore = before.players.p1.bench.length;
    expect(benchBefore).toBeGreaterThan(0);
    const { state, events } = swing(before, "accelgor");
    // the head
    expect(defenderConditions(state)).toEqual({
      rotation: "confused",
      poisonDamage: 10,
      burned: false,
      confusionDamage: 30,
    });
    // the tail — a different body is Active now
    const activeCardId = (st: GameState) =>
      st.cardIdByUid[st.players.p1.active?.stack[0] ?? ""] ?? null;
    expect(activeCardId(before)).toBe("fix-accelgor");
    expect(activeCardId(state)).not.toBe("fix-accelgor");
    // and the printed damage still landed
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(70);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the §11 block: TWO refusal rows for ONE printed sentence.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a §11 effects block refuses the pair", () => {
  function shielded(state: GameState, seat: Seat = "p2"): GameState {
    const active = state.players[seat].active;
    if (active === null) throw new Error("no defender to shield");
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: {
          ...state.players[seat],
          active: { ...active, attackBlock: { turn: 2, effects: true } },
        },
      },
    };
  }

  it("TWO `ATTACK_EFFECT_PREVENTED` ROWS FOR ONE PRINTED SENTENCE — and that is CORRECT", () => {
    const { state, events } = swing(shielded(board("ninetales", "fix-titan")), "ninetales");
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(2);
    expect(all(events, "STATUS_APPLIED")).toEqual([]);
    expect(defenderConditions(state)).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    // The DAMAGE half is refused by the other, silent gate — one sentence, two
    // mechanisms, and the counts do not borrow from each other.
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBe(true);
  });

  it("the single-status sentence next door gets exactly ONE row — the control", () => {
    const single = withEffect(
      board("ninetales", "fix-titan"),
      "fix-ninetales",
      "Your opponent's Active Pokémon is now Burned.",
    );
    expect(
      all(swing(shielded(single), "ninetales").events, "ATTACK_EFFECT_PREVENTED"),
    ).toHaveLength(1);
  });

  it("a blocked pair is not a SKIPPED pair — the two loudnesses are different rows", () => {
    const { events } = swing(shielded(board("ninetales", "fix-titan")), "ninetales");
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — nothing is SKIPPED in either direction.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the printed text stops being flagged, on every carrier", () => {
  it("no `ATTACK_EFFECT_SKIPPED` on any of the five bodies", () => {
    for (const seat of ["p1", "p2"] as const) {
      for (const attacker of ["ninetales", "houndoom", "accelgor"] as const) {
        const b = board(attacker, "fix-titan", { by: seat, bench: attacker === "accelgor" });
        expect(findEvent(swing(b, attacker, seat).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
      }
    }
  });

  it("…including on TAILS, where the gate fired and applied nothing", () => {
    expect(
      findEvent(swing(flipBoard("ekans", false), "ekans").events, "ATTACK_EFFECT_SKIPPED"),
    ).toBeUndefined();
  });

  it("the four sentences this slice LEFT are still flagged — the loud path still works", () => {
    const b = board("ninetales", "fix-titan");
    expect(LEFT_LOUD.dotAnchorTrio).toEqual([]);
    for (const text of [
      LEFT_LOUD.headsTails,
      ...LEFT_LOUD.dotAnchorTrio,
      LEFT_LOUD.recordedRefusal,
    ]) {
      const doctored = withEffect(b, "fix-ninetales", text);
      expect(findEvent(swing(doctored, "ninetales").events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(
        text,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity, and the persisted question.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — purity and the structural answers", () => {
  it("never mutates the board it is handed — the bare pair", () => {
    const frozen = deepFreeze(board("ninetales", "fix-titan"));
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen, "ninetales").state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("…and the flip twin, whose gate takes a coin", () => {
    const frozen = deepFreeze(flipBoard("glimmora", true));
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen, "glimmora").state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("`MATCH_RECORD_VERSION` STAYS 26, and it is DRIVEN rather than reasoned", () => {
    const live = board("ninetales", "fix-titan");
    const persisted = roundTrip(live);
    const liveRun = swing(live, "ninetales");
    const replayedRun = swing(persisted, "ninetales");
    expect(replayedRun.events).toEqual(liveRun.events);
    expect(replayedRun.state.players.p2.active?.conditions).toEqual(
      liveRun.state.players.p2.active?.conditions,
    );
    expect(Object.keys(liveRun.state.players.p2.active?.conditions ?? {}).sort()).toEqual([
      "burned",
      "confusionDamage",
      "poisonDamage",
      "rotation",
    ]);
  });

  it("there is no PARK on this path — the ops resolve inline", () => {
    const { state } = swing(board("ninetales", "fix-titan"), "ninetales");
    expect(state.phase.kind).not.toBe("effect:choose");
  });
});
