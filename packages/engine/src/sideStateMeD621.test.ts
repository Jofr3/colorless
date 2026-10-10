import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion, formatElapsed, logFromEvents } from "./index";
import { conditionNote, runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setPrizes,
  trainerCard,
} from "./testFixtures";

// ── 🆕🆕🆕 D621 — WP24c + WP23: PERSISTED SIDE STATE ──
//
// 16 `me` Trainer printings / 5 printed texts on five NEW objects (registry.ts D621 block):
// Gladion's Final Battle and Premium Power Pro (the NEW `SideAttackBonus.attacker`), Acerola's
// Mischief (`installChosenAttackShield` → `PlayerSide.chosenAttackShield`, R-AM1), Roxie's
// Performance (`lockSideRetreat` → `PlayerSide.sideRetreatLock`, R-RP1) and Dawn (Larry's Skill's
// `also` search). Texts measured on the LOCAL D1, 2026-10-09, `legal_standard = 1` on every row;
// driven on the real ids in a LOCAL `cardPool` (D275). Iron Defender `me01-118` / `me05-110` is
// dropped (an Item whose two plays stack on a persisted record D564 overwrites) [🆕🆕🆕 D630 (D539): BUILT at
// D630 on the summed list, `persistedRecordsMeD630.test.ts`].

const GLADION = "me05-077";
const PPP = "me01-124";
const ACEROLA = "me01-113";
const ROXIE = "me04-081";
const DAWN = "me02-087";

/** [me ids, card name, trainer type, printed text] — LOCAL D1 `cards.effect`, byte for byte. */
const TEXTS: readonly (readonly [readonly string[], string, string, string])[] = [
  [
    [GLADION, "me05-108", "me05-118"],
    "Gladion's Final Battle",
    "Supporter",
    "You can use this card only when it is the last card in your hand.\nDuring this turn, attacks used by your Pokémon that don't have a Rule Box do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
  ],
  [
    [PPP, "me01-174", "me02.5-199"],
    "Premium Power Pro",
    "Item",
    "During this turn, attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
  ],
  [
    [ACEROLA, "me01-165", "me01-183", "me02.5-180"],
    "Acerola's Mischief",
    "Supporter",
    "You can use this card only if your opponent has 2 or fewer Prize cards remaining.\n\nChoose 1 of your Pokémon in play. During your opponent's next turn, prevent all damage from and effects of attacks done to that Pokémon by your opponent's Pokémon ex.",
  ],
  [
    [ROXIE, "me04-112", "me04-121"],
    "Roxie's Performance",
    "Supporter",
    "During your opponent's next turn, their Poisoned Pokémon can't retreat. (This includes newly Poisoned Pokémon.)",
  ],
  [
    [DAWN, "me02-118", "me02-129"],
    "Dawn",
    "Supporter",
    "Search your deck for a Basic Pokémon, a Stage 1 Pokémon, and a Stage 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  ],
];

const ME_IDS = TEXTS.flatMap(([ids]) => ids);

describe("D621 §1 — the faces: 16 `me` printings / 5 texts, one object per text", () => {
  it("5 texts / 16 printings, every printing of a text on ONE object, distinct across texts", () => {
    expect(ME_IDS).toHaveLength(16);
    expect(new Set(ME_IDS).size).toBe(16);
    const objects = new Set<unknown>();
    for (const [ids] of TEXTS) {
      const program = programFor(ids[0] as string);
      expect(program, ids[0]).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(program);
      objects.add(program);
    }
    expect(objects.size).toBe(5);
  });

  it("Iron Defender (dropped) stays unkeyed (🆕🆕🆕 D630 (D539): WITHDRAWN — keyed at D630 on the summed list, `persistedRecordsMeD630.test.ts`)", () => {
    for (const id of ["me01-118", "me05-110"]) expect(Object.keys(programFor(id) ?? {}), id).toEqual(["trainer"]);
  });
});

describe("D621 §2 — the registry programs, field for field", () => {
  it("Gladion's Final Battle = Cassiopeia's last-card gate and Black Belt's op at 80, attackers without a Rule Box", () => {
    expect(programFor(GLADION)?.trainerPlayableIf).toEqual(programFor("sv06.5-056")?.trainerPlayableIf);
    expect(programFor(GLADION)).toEqual({
      trainerPlayableIf: { kind: "yourHandExactly", count: 1 },
      trainer: [
        {
          op: "boostSideAttacksThisTurn",
          amount: 80,
          target: { kind: "anyPokemon" },
          attacker: { kind: "anyPokemon", noRuleBox: true },
        },
      ],
    });
  });

  it("Premium Power Pro = the same op at 30 for {F} attackers, no gate", () => {
    expect(programFor(PPP)).toEqual({
      trainer: [
        {
          op: "boostSideAttacksThisTurn",
          amount: 30,
          target: { kind: "anyPokemon" },
          attacker: { kind: "typedPokemon", pokemonType: "Fighting" },
        },
      ],
    });
  });

  it("Acerola's Mischief = the 2-or-fewer gate and the chosen-body shield against Pokémon ex", () => {
    expect(programFor(ACEROLA)).toEqual({
      trainerPlayableIf: { kind: "opponentPrizesRemaining", counts: [0, 1, 2] },
      trainer: [{ op: "installChosenAttackShield", fromClass: { stage: "ex" } }],
    });
    expect(conditionNote({ kind: "opponentPrizesRemaining", counts: [0, 1, 2] })).toMatch(/2/);
  });

  it("Roxie's Performance = the Poisoned retreat lock, no gate", () => {
    expect(programFor(ROXIE)).toEqual({ trainer: [{ op: "lockSideRetreat", status: "poisoned" }] });
  });

  it("Dawn = Larry's Skill's three-noun search without the hand discard, by stage", () => {
    const larry = programFor("sv08.5-115")?.trainer;
    expect(larry?.[0]).toEqual({ op: "discardHand" });
    expect(programFor(DAWN)).toEqual({
      trainer: [
        {
          op: "searchDeck",
          filter: { kind: "basicPokemon" },
          dest: "hand",
          max: 1,
          reveal: true,
          also: [
            { filter: { kind: "stagePokemon", stage: "Stage1" }, max: 1 },
            { filter: { kind: "stagePokemon", stage: "Stage2" }, max: 1 },
          ],
        },
        { op: "shuffleDeck" },
      ],
    });
    expect(programFor(DAWN)?.trainer?.slice(1)).toEqual(larry?.slice(2));
  });
});

// ── ON A BOARD ──

const PLAIN = "d621-plain"; // a Basic {C}, no Rule Box
const MIDDLE = "d621-middle"; // a Stage 1 {C} from D621 Plain
const TOP = "d621-top"; // a Stage 2 {C} from D621 Middle
const BRUTE = "d621-brute"; // "D621 Brute ex", a Basic Pokémon ex
const FIGHTER = "d621-fighter"; // a Basic {F}
const WALL = "d621-wall"; // the defender, 900 HP
const RAIDER = "d621-raider"; // a non-ex attacker: 60 + Paralyzed; a 30 snipe
const RAIDER_EX = "d621-raider-ex"; // "D621 Raider ex", the same attacks
const MEGA = "d621-mega"; // "Mega D621 ex", a Mega Evolution Pokémon ex, the same attacks
const FILLER = "d621-filler";
const CROWN_EX = "d621-crown-ex"; // "D621 Crown ex": the `ignoreWR` attacks of five real Pokémon ex (R-AM2, retired at D622)
const SCOOP_UP = "sv06-162"; // Scoop Up Cyclone (D561): a body leaves play by a real action

const HIT = 50;
const JOLT = 60;
const RAIDER_ATTACKS: Card["attacks"] = [
  { cost: [], name: "Jolt", damage: JOLT, effect: "Your opponent's Active Pokémon is now Paralyzed." },
  {
    cost: [],
    name: "Pick",
    effect:
      "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  },
  // Dragapult ex "Phantom Dive"'s put-counter sentence (sv06-130, me02.5-160 …): placed counters.
  { cost: [], name: "Dive", effect: "Put 6 damage counters on your opponent's Benched Pokémon in any way you like." },
  // Cofagrigus "Extended Damagriiigus" (D216): a counter MOVE onto a chosen opponent body.
  {
    cost: [],
    name: "Swap",
    effect: "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.",
  },
];

/** R-AM2's board: every `ignoreWR` shape a Pokémon ex prints (LOCAL D1 `attacks_json`, byte for byte). */
const SHOTELS = 50;
const CROWN_ATTACKS: Card["attacks"] = [
  // Iron Crown ex "Twin Shotels" (sv05-081 …): the FEINT form — "or by any effects on those Pokémon".
  {
    cost: [],
    name: "Twin Shotels",
    effect:
      "This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.",
  },
  // Arboliva ex "Oil Salvo" (sv10-023 / -207): the BARE tail on a pick-with-replacement snipe.
  {
    cost: [],
    name: "Oil Salvo",
    effect:
      "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.",
  },
  // Vaporeon ex "Severe Squall" (sv08.5-023 / -149): the BARE tail on a classed spread.
  {
    cost: [],
    name: "Severe Squall",
    effect:
      "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
  },
  // Medicham ex "Yoga Kick" (sv07-080 / -161): the BARE tail on the main hit (damage scaled down).
  { cost: [], name: "Yoga Kick", damage: 70, effect: "This attack's damage isn't affected by Weakness or Resistance." },
  // Cornerstone Mask Ogerpon ex "Demolish" (sv06-112 …): the FEINT form on the main hit (damage scaled down).
  {
    cost: [],
    name: "Demolish",
    damage: 70,
    effect:
      "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon.",
  },
];

const mon = (id: string, name: string, types: string[], extra: Partial<Card> = {}): Card =>
  battler(id, {
    name,
    hp: 900,
    types,
    retreat: 0,
    attacks: [{ cost: [], name: "Hit", damage: HIT }],
    ...extra,
  });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    TEXTS.flatMap(([ids, name, type, text]) => ids.map((id) => [id, { ...trainerCard(id, type, text), name }])),
  ),
  [PLAIN]: mon(PLAIN, "D621 Plain", ["Colorless"]),
  [MIDDLE]: mon(MIDDLE, "D621 Middle", ["Colorless"], { stage: "Stage1", evolveFrom: "D621 Plain" }),
  [TOP]: mon(TOP, "D621 Top", ["Colorless"], { stage: "Stage2", evolveFrom: "D621 Middle" }),
  [BRUTE]: mon(BRUTE, "D621 Brute ex", ["Colorless"]),
  [FIGHTER]: mon(FIGHTER, "D621 Fighter", ["Fighting"]),
  [WALL]: mon(WALL, "D621 Wall", ["Colorless"], { attacks: [] }),
  [RAIDER]: mon(RAIDER, "D621 Raider", ["Colorless"], { attacks: RAIDER_ATTACKS }),
  [RAIDER_EX]: mon(RAIDER_EX, "D621 Raider ex", ["Colorless"], { attacks: RAIDER_ATTACKS }),
  [MEGA]: mon(MEGA, "Mega D621 ex", ["Colorless"], { attacks: RAIDER_ATTACKS }),
  [FILLER]: mon(FILLER, "D621 Filler", ["Colorless"], { attacks: [] }),
  [CROWN_EX]: mon(CROWN_EX, "D621 Crown ex", ["Colorless"], { attacks: CROWN_ATTACKS }),
  [SCOOP_UP]: {
    ...trainerCard(SCOOP_UP, "Item", "Put 1 of your Pokémon and all attached cards into your hand."),
    name: "Scoop Up Cyclone",
  },
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [GLADION]: 1,
  [PPP]: 2,
  [ACEROLA]: 1,
  [ROXIE]: 1,
  [DAWN]: 1,
  [PLAIN]: 6,
  [MIDDLE]: 3,
  [TOP]: 3,
  [BRUTE]: 3,
  [FIGHTER]: 3,
  [WALL]: 3,
  [RAIDER]: 2,
  [RAIDER_EX]: 2,
  [MEGA]: 2,
  [FILLER]: 6,
  [CROWN_EX]: 2,
  [SCOOP_UP]: 1,
  "fix-fire-energy": 12,
  "fix-energy": 6, // the prize row
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Hands and prize rows reset: every hand back into the deck, the six `fix-energy` the prize row. */
function reset(state: GameState): GameState {
  let next = state;
  for (const s of ["p1", "p2"] as const) {
    const side = next.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes];
    const prizes = pile.filter((u) => next.cardIdByUid[u] === "fix-energy");
    next = {
      ...next,
      players: { ...next.players, [s]: { ...side, hand: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) } },
    };
  }
  return next;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed: turn 2). */
function p1First(): GameState {
  const created = createGame({ seed: 6211, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  return reset(state);
}

/** P1's SECOND turn (turn 4), hands reset again. */
function p1Later(): GameState {
  let state = must(applyAction(p1First(), { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 4) throw new Error(`expected turn 4, got ${state.turn}`);
  return reset(state);
}

/** P1: `active` + `bench`; P2: `foe` Active + `foeBench`. Hands empty. */
function board(
  active: string,
  bench: readonly string[],
  foe: string = WALL,
  foeBench: readonly string[] = [FILLER],
  base: GameState = p1First(),
): GameState {
  let state = clearBench(setActiveFromDeck(base, "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", foe), "p2");
  for (const id of foeBench) state = benchFromDeck(state, "p2", id);
  return state;
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
function staged(state: GameState, id: string): { state: GameState; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  const uid = next.players.p1.hand.filter((u) => next.cardIdByUid[u] === id).pop();
  return { state: next, uid: uid as string };
}
function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const { state: next, uid } = staged(state, id);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid });
}
function refusal(state: GameState, id: string): string {
  const { state: next, uid } = staged(state, id);
  const result = applyAction(next, { type: "playTrainer", seat: "p1", uid });
  return result.ok ? "applied" : result.error.code;
}
function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}
const attack = (state: GameState, seat: Seat, index = 0) => mustApply(state, { type: "attack", seat, index });
const endTurn = (state: GameState, seat: Seat) => must(applyAction(state, { type: "endTurn", seat }));
const pickRef = (seat: Seat, ref: unknown): GameAction =>
  ({ type: "resolveEffect", seat, choice: { kind: "pokemon", ref } }) as GameAction;
const snipeAt = (ref: unknown): GameAction =>
  ({ type: "resolveEffect", seat: "p2", choice: { kind: "pokemonMulti", refs: [ref] } }) as GameAction;
/** A parked state revived from JSON, the way a `MatchRecord` stores it. */
const revived = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const dealtTo = (events: readonly GameEvent[], uid: string | undefined) =>
  all(events, "DAMAGE_DEALT").find((e) => e.uid === uid);
const topOf = (state: GameState, seat: Seat) => state.players[seat].active?.stack.at(-1);

function rows(events: GameEvent[], state: GameState): string[] {
  const entries = logFromEvents(events, { names: { p1: "Ana", p2: "Bo" }, state, elapsed: formatElapsed(0) });
  return entries.flatMap((e) => (e.kind === "turn" ? [] : [e.segments.map((s) => s.text).join("")]));
}

describe("D621 §3 — Gladion's Final Battle: the last card in hand; +80 for attackers without a Rule Box", () => {
  it("refused with another card in hand; allowed as the last card", () => {
    const state = board(PLAIN, []);
    expect(refusal(handFromDeck(state, "p1", FILLER, 1), GLADION)).toBe("PLAY_CONDITION_NOT_MET");
    expect(refusal(state, GLADION)).toBe("applied");
  });

  it("a non-Rule-Box attacker does 50 + 80 to the Active; the bag holds one entry with the attacker noun", () => {
    const played = play(board(PLAIN, []), GLADION);
    expect(played.state.allowances.sideAttackBonuses).toEqual([
      { amount: 80, target: { kind: "anyPokemon" }, attacker: { kind: "anyPokemon", noRuleBox: true } },
    ]);
    const hit = attack(played.state, "p1");
    expect(dealtTo(hit.events, topOf(hit.state, "p2"))?.dealt).toBe(HIT + 80);
  });

  it("a Pokémon ex attacker (a Rule Box) gets nothing", () => {
    const hit = attack(play(board(BRUTE, []), GLADION).state, "p1");
    expect(dealtTo(hit.events, topOf(hit.state, "p2"))?.dealt).toBe(HIT);
  });

  it("the row names the attackers; the bonus is gone on the next turn", () => {
    const played = play(board(PLAIN, []), GLADION);
    expect(rows(played.events, played.state)).toContain(
      "attacks by Pokémon that don't have a Rule Box do 80 more damage to the opponent's Active Pokémon this turn (before Weakness and Resistance)",
    );
    const later = endTurn(endTurn(played.state, "p1"), "p2");
    expect(later.allowances.sideAttackBonuses).toEqual([]);
  });
});

describe("D621 §4 — Premium Power Pro: +30 for {F} attackers; two Items stack", () => {
  it("a {F} attacker does 50 + 30; a {C} one does 50", () => {
    const fighting = attack(play(board(FIGHTER, []), PPP).state, "p1");
    expect(dealtTo(fighting.events, topOf(fighting.state, "p2"))?.dealt).toBe(HIT + 30);
    const plain = attack(play(board(PLAIN, []), PPP).state, "p1");
    expect(dealtTo(plain.events, topOf(plain.state, "p2"))?.dealt).toBe(HIT);
  });

  it("two plays are two entries, SUMMED: 50 + 60", () => {
    const twice = play(play(board(FIGHTER, []), PPP).state, PPP);
    expect(twice.state.allowances.sideAttackBonuses).toHaveLength(2);
    const hit = attack(twice.state, "p1");
    expect(dealtTo(hit.events, topOf(hit.state, "p2"))?.dealt).toBe(HIT + 60);
  });

  it("an entry with no `attacker` (Black Belt's shape) still pays every attacker", () => {
    const result = runProgram(
      board(PLAIN, []),
      [{ op: "boostSideAttacksThisTurn", amount: 40, target: { kind: "anyPokemon" } }],
      { seat: "p1", invokedBy: "supporter" },
      [],
    );
    if (result.kind !== "done") throw new Error("expected done");
    const hit = attack(result.state, "p1");
    expect(dealtTo(hit.events, topOf(hit.state, "p2"))?.dealt).toBe(HIT + 40);
  });
});

/** P1 plays Acerola's Mischief on a board where P2 has 2 Prizes left (`foe` attacks next turn). */
function acerola(active: string, bench: readonly string[], foe: string, base?: GameState) {
  return play(setPrizes(board(active, bench, foe, [FILLER], base), "p2", 2), ACEROLA);
}

describe("D621 §5 — Acerola's Mischief: one chosen body, no damage or effects from the opponent's Pokémon ex", () => {
  it("refused while the opponent has 3 or more Prizes left; allowed at 2", () => {
    expect(refusal(board(PLAIN, [], RAIDER_EX), ACEROLA)).toBe("PLAY_CONDITION_NOT_MET");
    expect(refusal(setPrizes(board(PLAIN, [], RAIDER_EX), "p2", 2), ACEROLA)).toBe("applied");
  });

  it("a lone Active is forced: the side records its base uid for the opponent's next turn", () => {
    const played = acerola(PLAIN, [], RAIDER_EX);
    const uid = played.state.players.p1.active?.stack[0];
    expect(played.state.players.p1.chosenAttackShield).toEqual({
      turn: played.state.turn + 1,
      uid,
      fromClass: { stage: "ex" },
    });
    expect(all(played.events, "CHOSEN_ATTACK_SHIELD_INSTALLED")).toEqual([
      { type: "CHOSEN_ATTACK_SHIELD_INSTALLED", seat: "p1", uid, fromClass: { stage: "ex" } },
    ]);
    expect(rows(played.events, played.state)).toContain(
      "D621 Plain is protected from damage and effects of attacks by Pokémon ex during the opponent's next turn",
    );
  });

  it("with a Bench it parks over every one of your bodies; the answer survives a JSON round trip", () => {
    const parked = acerola(PLAIN, [FILLER], RAIDER_EX).state;
    const ask = prompt(parked);
    expect(ask.kind).toBe("choosePokemon");
    expect(ask.note).toBe(
      "Choose 1 of your Pokémon in play. During your opponent's next turn, prevent all damage from and effects of attacks done to that Pokémon by your opponent's Pokémon ex.",
    );
    const answered = must(applyAction(revived(parked), pickRef("p1", { seat: "p1", spot: { spot: "bench", index: 0 } })));
    expect(answered.players.p1.chosenAttackShield?.uid).toBe(answered.players.p1.bench[0]?.stack[0]);
  });

  it("the opponent's ex attack (no `ignoreWR`; R-AM2 below) does no damage and its Paralysis is refused; a non-ex attack lands both", () => {
    const window = endTurn(acerola(PLAIN, [], RAIDER_EX).state, "p1");
    const blocked = attack(window, "p2");
    expect(blocked.state.players.p1.active?.damage).toBe(0);
    expect(blocked.state.players.p1.active?.conditions.rotation).toBe("none");
    expect(all(blocked.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);

    const open = endTurn(acerola(PLAIN, [], RAIDER).state, "p1");
    const landed = attack(open, "p2");
    expect(landed.state.players.p1.active?.damage).toBe(JOLT);
    expect(landed.state.players.p1.active?.conditions.rotation).toBe("paralyzed");
  });

  it("a Mega Evolution Pokémon ex is a Pokémon ex: refused too", () => {
    const blocked = attack(endTurn(acerola(PLAIN, [], MEGA).state, "p1"), "p2");
    expect(blocked.state.players.p1.active?.damage).toBe(0);
  });

  it("only the chosen body: the unchosen Benched one takes the ex snipe", () => {
    const parked = acerola(PLAIN, [FILLER], RAIDER_EX).state;
    const chose = must(applyAction(parked, pickRef("p1", { seat: "p1", spot: { spot: "active" } })));
    const snipe = mustApply(endTurn(chose, "p1"), { type: "attack", seat: "p2", index: 1 });
    const hit = must(applyAction(snipe.state, snipeAt({ seat: "p1", spot: { spot: "bench", index: 0 } })));
    expect(hit.players.p1.bench[0]?.damage).toBe(30);
  });

  it("R-AM1 (UNRULED): the shield follows the body to the Bench — the ex snipe onto it is prevented", () => {
    const parked = acerola(PLAIN, [FILLER], RAIDER_EX).state;
    const chose = must(applyAction(parked, pickRef("p1", { seat: "p1", spot: { spot: "active" } })));
    const shielded = chose.players.p1.active?.stack[0];
    const retreated = must(
      applyAction(chose, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }),
    );
    expect(retreated.players.p1.bench[0]?.stack[0]).toBe(shielded);
    const window = endTurn(retreated, "p1");
    // The NEW Active is not the chosen body: the ex hit lands on it.
    expect(attack(window, "p2").state.players.p1.active?.damage).toBe(JOLT);
    const snipe = mustApply(window, { type: "attack", seat: "p2", index: 1 });
    const hit = must(applyAction(snipe.state, snipeAt({ seat: "p1", spot: { spot: "bench", index: 0 } })));
    expect(hit.players.p1.bench[0]?.damage).toBe(0);
  });

  /** P1 shields its Benched FILLER (bench 0) beside a Benched PLAIN (bench 1); `foe` attacks next. */
  function benchShielded(foe: string): GameState {
    const parked = acerola(PLAIN, [FILLER, PLAIN], foe).state;
    return endTurn(must(applyAction(parked, pickRef("p1", { seat: "p1", spot: { spot: "bench", index: 0 } }))), "p1");
  }
  /** Phantom Dive's six one-counter picks, alternating bench 0 / bench 1 (3 each). */
  function dive(window: GameState): { state: GameState; events: GameEvent[] } {
    let { state, events } = attack(window, "p2", 2);
    for (let pick = 0; state.phase.kind === "effect:choose"; pick++) {
      const next = mustApply(state, snipeAt({ seat: "p1", spot: { spot: "bench", index: pick % 2 } }));
      state = next.state;
      events = [...events, ...next.events];
    }
    return { state, events };
  }

  it("D150's gap, closed: Phantom Dive's PLACED counters on the shielded Benched body are refused, a row each", () => {
    const done = dive(benchShielded(RAIDER_EX));
    expect(done.state.players.p1.bench[0]?.damage).toBe(0);
    expect(done.state.players.p1.bench[1]?.damage).toBe(30);
    const shielded = done.state.players.p1.bench[0]?.stack.at(-1);
    expect(all(done.events, "ATTACK_EFFECT_PREVENTED")).toEqual(
      Array.from({ length: 3 }, () => ({ type: "ATTACK_EFFECT_PREVENTED", seat: "p1", uid: shielded })),
    );
    // …and a non-ex attacker's counters land on the same body.
    const open = dive(benchShielded(RAIDER));
    expect(open.state.players.p1.bench[0]?.damage).toBe(30);
    expect(all(open.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });

  it("a counter MOVE onto the shielded Benched body is refused whole; onto the unshielded one it lands", () => {
    const loaded = (window: GameState): GameState => {
      const side = window.players.p2;
      return { ...window, players: { ...window.players, p2: { ...side, bench: [{ ...side.bench[0], damage: 40 } as never] } } };
    };
    const swap = (window: GameState, index: number) => {
      const parked = attack(loaded(window), "p2", 3).state;
      return mustApply(parked, pickRef("p2", { seat: "p1", spot: { spot: "bench", index } }));
    };
    const refused = swap(benchShielded(RAIDER_EX), 0);
    expect(refused.state.players.p1.bench[0]?.damage).toBe(0);
    expect(refused.state.players.p2.bench[0]?.damage).toBe(40);
    expect(all(refused.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(swap(benchShielded(RAIDER_EX), 1).state.players.p1.bench[1]?.damage).toBe(40);
    expect(swap(benchShielded(RAIDER), 0).state.players.p1.bench[0]?.damage).toBe(40);
  });

  it("R-AM1 (UNRULED): and through evolution — the evolved body is still shielded", () => {
    const played = acerola(PLAIN, [], RAIDER_EX, p1Later());
    const evolving = handFromDeck(played.state, "p1", MIDDLE, 1);
    const uid = evolving.players.p1.hand.find((u) => evolving.cardIdByUid[u] === MIDDLE) as string;
    const evolved = must(applyAction(evolving, { type: "evolve", seat: "p1", uid, target: { spot: "active" } }));
    expect(evolved.players.p1.active?.stack).toHaveLength(2);
    expect(attack(endTurn(evolved, "p1"), "p2").state.players.p1.active?.damage).toBe(0);
  });

  it("an already-evolved body is keyed by its BASE card: the record names `stack[0]` and still shields it", () => {
    const base = board(PLAIN, [], RAIDER_EX, [FILLER], p1Later());
    const evolving = handFromDeck(base, "p1", MIDDLE, 1);
    const uid = evolving.players.p1.hand.find((u) => evolving.cardIdByUid[u] === MIDDLE) as string;
    const evolved = must(applyAction(evolving, { type: "evolve", seat: "p1", uid, target: { spot: "active" } }));
    const played = play(setPrizes(evolved, "p2", 2), ACEROLA);
    expect(played.state.players.p1.chosenAttackShield?.uid).toBe(played.state.players.p1.active?.stack[0]);
    expect(attack(endTurn(played.state, "p1"), "p2").state.players.p1.active?.damage).toBe(0);
  });

  it("the window is the opponent's NEXT turn only: two turns later the ex attack lands", () => {
    const window = endTurn(acerola(PLAIN, [], RAIDER_EX).state, "p1");
    const after = endTurn(endTurn(window, "p2"), "p1");
    expect(after.players.p1.chosenAttackShield?.turn).toBeLessThan(after.turn);
    expect(attack(after, "p2").state.players.p1.active?.damage).toBe(JOLT);
  });

  it("R-AM1 (UNRULED): it ends when the body leaves play — scooped and replayed, it is a new Pokémon and the ex snipe lands", () => {
    const shieldedBench = must(
      applyAction(acerola(PLAIN, [FILLER, PLAIN], RAIDER_EX).state, pickRef("p1", { seat: "p1", spot: { spot: "bench", index: 0 } })),
    );
    const uid = shieldedBench.players.p1.bench[0]?.stack[0] as string;
    const scooped = must(applyAction(play(shieldedBench, SCOOP_UP).state, pickRef("p1", { seat: "p1", spot: { spot: "bench", index: 0 } })));
    expect(scooped.players.p1.hand).toContain(uid);
    expect(scooped.players.p1.chosenAttackShield).toBeNull();
    const replayed = must(applyAction(scooped, { type: "playBasicToBench", seat: "p1", uid }));
    const index = replayed.players.p1.bench.findIndex((b) => b.stack[0] === uid);
    const snipe = mustApply(endTurn(replayed, "p1"), { type: "attack", seat: "p2", index: 1 });
    const hit = must(applyAction(snipe.state, snipeAt({ seat: "p1", spot: { spot: "bench", index } })));
    expect(hit.players.p1.bench[index]?.damage).toBe(30);
  });

  // ── R-AM2 (UNRULED): `ignoreWR` attacks from a Pokémon ex, both forms, both channels ──
  // [🆕🆕🆕 D622 (D539): R-AM2 is RETIRED — the bare tail is stopped (`wrOnly`); the Feint form still passes.]

  /** Picks `refs` at every parked prompt of `foe`'s attack `index` (one pick per prompt when `each`). */
  function crown(window: GameState, index: number, refs: unknown[], each = false) {
    let { state, events } = attack(window, "p2", index);
    for (let n = 0; state.phase.kind === "effect:choose" && n < 8; n++) {
      const next = mustApply(state, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "pokemonMulti", refs: each ? [refs[0]] : refs },
      } as GameAction);
      state = next.state;
      events = [...events, ...next.events];
    }
    return { state, events };
  }
  const bench = (index: number) => ({ seat: "p1", spot: { spot: "bench", index } });
  const activeRef = { seat: "p1", spot: { spot: "active" } };

  it("R-AM2: the FEINT form passes the shield by its print — Twin Shotels lands on a shielded Benched and a shielded Active body", () => {
    const benched = crown(benchShielded(CROWN_EX), 0, [bench(0), bench(1)]);
    expect(benched.state.players.p1.bench[0]?.damage).toBe(SHOTELS);
    expect(benched.state.players.p1.bench[1]?.damage).toBe(SHOTELS);
    const parked = acerola(PLAIN, [FILLER], CROWN_EX).state;
    const window = endTurn(must(applyAction(parked, pickRef("p1", activeRef))), "p1");
    const active = crown(window, 0, [activeRef, bench(0)]);
    expect(active.state.players.p1.active?.damage).toBe(SHOTELS);
    expect(all(active.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });

  // 🆕🆕🆕 D622 (D539): R-AM2 RETIRED. The rung below pinned the gap ("Oil Salvo and Severe Squall
  // land", 120 / 60 / 60); the bare tail is `wrOnly` since D622 and the shield stops it. Same boards,
  // flipped numbers; `bareTailD622.test.ts` drives all four bare texts and the in-flight v43 park.
  it("R-AM2 ~~the BARE tail passes it too, by D400/D492's reading of `ignoreWR`~~ (🆕🆕🆕 D622: retired) — Oil Salvo and Severe Squall are stopped by the shield", () => {
    const salvo = crown(benchShielded(CROWN_EX), 1, [bench(0)], true);
    expect(salvo.state.players.p1.bench[0]?.damage).toBe(0);
    const parked = acerola(PLAIN, [BRUTE], CROWN_EX).state;
    const squall = attack(endTurn(must(applyAction(parked, pickRef("p1", bench(0)))), "p1"), "p2", 2);
    expect(squall.state.players.p1.bench[0]?.damage).toBe(0);
    const lone = attack(endTurn(acerola(BRUTE, [], CROWN_EX).state, "p1"), "p2", 2);
    expect(lone.state.players.p1.active?.damage).toBe(0);
    // 🆕🆕🆕 D625 (D622 MINOR 2) — the three `damage` lines above compare 0 with the 0 each body starts at, so they
    // cannot tell "the shield stopped it" from "nothing was aimed there". The DAMAGE_DEALT rows can: every hit
    // was aimed at the shielded body and PREVENTED, 0 dealt (Oil Salvo's six 20s, Severe Squall's 60 twice).
    const rows = (events: readonly GameEvent[]) =>
      events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [[e.base, e.prevented, e.dealt]] : []));
    expect(rows(salvo.events)).toEqual(Array.from({ length: 6 }, () => [20, true, 0]));
    expect(rows(squall.events)).toEqual([[60, true, 0]]);
    expect(rows(lone.events)).toEqual([[60, true, 0]]);
  });

  it("R-AM2: the main hit keeps the forms apart — the bare tail (Yoga Kick) is stopped, the Feint form (Demolish) lands", () => {
    const window = endTurn(acerola(PLAIN, [], CROWN_EX).state, "p1");
    expect(attack(window, "p2", 3).state.players.p1.active?.damage).toBe(0);
    expect(attack(window, "p2", 4).state.players.p1.active?.damage).toBe(70);
  });
});

describe("D621 §6 — Roxie's Performance: the opponent's Poisoned Pokémon can't retreat next turn", () => {
  /** P1 plays Roxie and passes: P2's turn, its Active `poisoned` or not, a Filler on its Bench. */
  function window(poisoned: boolean) {
    const played = play(board(PLAIN, [], WALL), ROXIE);
    let state = endTurn(played.state, "p1");
    if (poisoned) state = setConditions(state, "p2", { poisonDamage: 10 });
    return { played, state };
  }
  const retreat = (state: GameState, seat: Seat) =>
    applyAction(state, { type: "retreat", seat, discardEnergy: [], promoteBenchIndex: 0 });

  it("the record is on the OPPONENT's side, for their next turn; the row is filed under them", () => {
    const { played } = window(false);
    expect(played.state.players.p2.sideRetreatLock).toEqual({ turn: played.state.turn + 1, status: "poisoned" });
    expect(played.state.players.p1.sideRetreatLock).toBeNull();
    expect(all(played.events, "SIDE_RETREAT_LOCKED")).toEqual([
      { type: "SIDE_RETREAT_LOCKED", seat: "p2", status: "poisoned" },
    ]);
    expect(rows(played.events, played.state)).toContain(
      "Poisoned Pokémon can't retreat during their next turn, including newly Poisoned Pokémon",
    );
  });

  it("a Poisoned Active can't retreat; an unpoisoned one can", () => {
    const locked = retreat(window(true).state, "p2");
    expect(locked.ok ? "applied" : locked.error.code).toBe("RETREAT_PREVENTED");
    expect(retreat(window(false).state, "p2").ok).toBe(true);
  });

  it("R-RP1 (UNRULED): read live — a body Poisoned after the play is locked, a cured one is free", () => {
    const { state } = window(false);
    const poisonedNow = setConditions(state, "p2", { poisonDamage: 10 });
    expect(retreat(poisonedNow, "p2").ok).toBe(false);
    expect(retreat(setConditions(poisonedNow, "p2", { poisonDamage: 0 }), "p2").ok).toBe(true);
  });

  it("switch effects are not retreat: a Poisoned Active still switches", () => {
    const result = runProgram(window(true).state, [{ op: "switchActive" }], { seat: "p2", invokedBy: "item" }, []);
    if (result.kind !== "done") throw new Error("expected done");
    expect(result.state.players.p2.active?.stack.at(-1)).not.toBe(window(true).state.players.p2.active?.stack.at(-1));
  });

  it("only that turn: on the opponent's turn after, a Poisoned Active retreats", () => {
    const { state } = window(false);
    const later = setConditions(endTurn(endTurn(state, "p2"), "p1"), "p2", { poisonDamage: 10 });
    expect(retreat(later, "p2").ok).toBe(true);
  });
});

describe("D621 §7 — Dawn: a Basic, a Stage 1 and a Stage 2 Pokémon into the hand", () => {
  it("parks one search with three one-card groups; the three picks go to the hand, named", () => {
    const parked = play(board(PLAIN, []), DAWN).state;
    const ask = prompt(parked);
    if (ask.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${ask.kind}`);
    const deck = parked.players.p1.deck;
    const pick = (id: string) => deck.find((u) => parked.cardIdByUid[u] === id) as string;
    const uids = [pick(PLAIN), pick(MIDDLE), pick(TOP)];
    for (const u of uids) expect(ask.candidates).toContain(u);
    const done = mustApply(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });
    for (const u of uids) expect(done.state.players.p1.hand).toContain(u);
    expect(all(done.events, "DECK_SEARCHED")[0]?.uids).toEqual(uids);
    expect(all(done.events, "SHUFFLE").length).toBeGreaterThan(0);
  });

  it("two Basics are refused: one per group", () => {
    const parked = play(board(PLAIN, []), DAWN).state;
    const basics = parked.players.p1.deck.filter((u) => parked.cardIdByUid[u] === PLAIN).slice(0, 2);
    expect(applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: basics } }).ok).toBe(
      false,
    );
  });
});

describe("D621 §8 — the ids and the version", () => {
  it("no D621 Trainer or body reached `FIXTURE_POOL`; every keyed id is a `me` id", () => {
    for (const id of Object.keys(LOCAL)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    for (const id of ME_IDS) expect(/^me/.test(id), id).toBe(true);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.518.0");
  });
});
