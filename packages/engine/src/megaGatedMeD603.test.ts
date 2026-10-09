import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { isMegaEvolutionPokemonEx, matchesFilter } from "./cards";
import type { BoardCondition } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  trainerCard,
} from "./testFixtures";

// ── 🆕🆕🆕 D603 — WP11: THE MEGA-GATED TEXTS ──
//
// 6 printed texts / 11 `me` printings on six new registry objects, over D582's
// `isMegaEvolutionPokemonEx` read twice: the NEW `BoardCondition.yourMegaExInPlay { type? }` and the
// NEW `CardFilter.megaEvolutionEx`. Every id and text measured on the LOCAL D1
// (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard = 1`; no id was referenced in
// the tree before this slice except Mega Signal `me01-121`, a Trainer face in
// `megaEvolutionRuleD582.test.ts`. Dropped and named: Latios `me01-101` "Lustrous Assist" (a gate on a
// NAMED Active's Bench-to-Active move) and Wally's Compassion ×3 (an all-Energy-to-hand consequent on
// the healed body). Excluded by the brief: Tremendous Bomb ×2, Ange Floette, Core Memory (§9).

const EXCITED_TURBO =
  "As often as you like during your turn, if you have any {R} Mega Evolution Pokémon ex in play, you may use this Ability. Attach a Basic {R} Energy card from your hand to 1 of your Benched {R} Pokémon.";
const EXCITED_HEAL =
  "Once during your turn, if you have any {G} Mega Evolution Pokémon ex in play, you may use this Ability. Heal 60 damage from 1 of your Pokémon.";
const EXCITED_DASH =
  "Once during your turn, if this Pokémon is on your Bench, and if you have any Mega Evolution Pokémon ex in play, you may use this Ability. Switch this Pokémon with your Active Pokémon.";
const EXCITED_POWER =
  "If you have any {D} Mega Evolution Pokémon ex in play, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const MEGA_SIGNAL_TEXT =
  "Search your deck for a Mega Evolution Pokémon ex, reveal it, and put it into your hand. Then, shuffle your deck.";
const JETT_TEXT = "Draw a card for each of your opponent's Mega Evolution Pokémon ex in play.";

const ORICORIO = ["mep-024", "me02-018", "me02-110"] as const;
const LUDICOLO = ["me02-007", "me02-095"] as const;
const LINOONE = "me02-082";
const SEVIPER = "me02-062";
const MEGA_SIGNAL = ["me01-121", "me01-171", "me02.5-193"] as const;
const JETT = "me05-079";

/** [name, the keyed printings, the printed text]. */
const TEXTS: readonly (readonly [string, readonly string[], string])[] = [
  ["Excited Turbo", ORICORIO, EXCITED_TURBO],
  ["Excited Heal", LUDICOLO, EXCITED_HEAL],
  ["Excited Dash", [LINOONE], EXCITED_DASH],
  ["Excited Power", [SEVIPER], EXCITED_POWER],
  ["Mega Signal", MEGA_SIGNAL, MEGA_SIGNAL_TEXT],
  ["Jett", [JETT], JETT_TEXT],
];

const abilityOf = (id: string) => programFor(id)?.abilities?.[0];

describe("D603 §1 — the programs: six objects over 11 printings", () => {
  it("every printing of a text is on ONE object, six objects in all", () => {
    expect(TEXTS.flatMap(([, ids]) => ids)).toHaveLength(11);
    for (const [name, ids] of TEXTS)
      for (const id of ids) {
        expect(programFor(id), `${name} ${id}`).toBeDefined();
        expect(programFor(id), id).toBe(programFor(ids[0] as string));
      }
    expect(new Set(TEXTS.map(([, ids]) => programFor(ids[0] as string))).size).toBe(6);
  });

  it("Excited Turbo: repeatable, the {R} gate, a Basic {R} from hand to a Benched {R}", () => {
    expect(Object.keys(programFor(ORICORIO[0]) ?? {})).toEqual(["abilities"]);
    expect(abilityOf(ORICORIO[0])).toEqual({
      name: "Excited Turbo",
      oncePerTurn: false,
      activeOnly: false,
      playableIf: { kind: "yourMegaExInPlay", type: "Fire" },
      program: [
        { op: "attachEnergyFrom", source: "hand", energyType: "Fire", targetType: "Fire", benchOnly: true },
      ],
    });
  });

  it("Excited Heal: once per Pokémon, the {G} gate, heal 60 from 1", () => {
    expect(abilityOf(LUDICOLO[0])).toEqual({
      name: "Excited Heal",
      oncePerTurn: true,
      activeOnly: false,
      playableIf: { kind: "yourMegaExInPlay", type: "Grass" },
      program: [{ op: "healChosen", amount: 60 }],
    });
  });

  it("Excited Dash: once per Pokémon, Bench only, the UNTYPED gate, Showtime's switch", () => {
    expect(abilityOf(LINOONE)).toEqual({
      name: "Excited Dash",
      oncePerTurn: true,
      activeOnly: false,
      benchOnly: true,
      playableIf: { kind: "yourMegaExInPlay" },
      program: [{ op: "switchActive", fromSource: true }],
    });
    expect(abilityOf(LINOONE)?.program).toEqual(programFor("sv09-018")?.abilities?.[0]?.program);
  });

  it("Excited Power: a passive +120 before W/R on the {D} gate", () => {
    expect(programFor(SEVIPER)).toEqual({
      passive: { damageBonusBeforeWRIf: { amount: 120, cond: { kind: "yourMegaExInPlay", type: "Darkness" } } },
    });
  });

  it("Mega Signal: a Mega Evolution Pokémon ex, reveal, hand, shuffle; Jett: a card per opponent's Mega ex", () => {
    expect(programFor(MEGA_SIGNAL[0])).toEqual({
      trainer: [
        { op: "searchDeck", filter: { kind: "megaEvolutionEx" }, dest: "hand", max: 1, reveal: true },
        { op: "shuffleDeck" },
      ],
    });
    expect(programFor(JETT)).toEqual({
      trainer: [
        {
          op: "drawCards",
          count: 1,
          per: { kind: "pokemonInPlay", seat: "opponent", filter: { kind: "megaEvolutionEx" } },
        },
      ],
    });
  });

  it("no printed attack is registry-keyed (each keeps deriving)", () => {
    for (const [, ids] of TEXTS) for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
  });
});

// ── ON A BOARD ──

const MEGA_R = "d603-mega-fire"; // "Mega Camerupt ex", {R}
const MEGA_G = "d603-mega-grass"; // "Mega Venusaur ex", {G}
const MEGA_D = "d603-mega-dark"; // "Mega Absol ex", {D}, a 200 attack
const PLAIN_EX = "d603-plain-ex"; // "Charizard ex", {R}: an ex that is not a Mega
const MEGANIUM = "d603-meganium"; // "Meganium", {G}: "Mega" with no space
const FIRE = "d603-fire"; // a {R} Basic
const FILLER = "d603-filler"; // a {C} Basic, 300 HP

const ability = (name: string, text: string) => [{ type: "Ability", name, effect: text }];
const mega = (id: string, name: string, type: string, over: Partial<Card> = {}): Card =>
  battler(id, { name, hp: 300, types: [type], retreat: 2, ...over } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    ORICORIO.map((id) => [
      id,
      battler(id, {
        name: "Oricorio ex",
        hp: 190,
        types: ["Fire"],
        abilities: ability("Excited Turbo", EXCITED_TURBO),
        attacks: [{ cost: ["Fire", "Fire", "Colorless"], name: "Fire Wing", damage: 110 }],
      } as Partial<Card>),
    ]),
  ),
  ...Object.fromEntries(
    LUDICOLO.map((id) => [
      id,
      battler(id, {
        name: "Ludicolo",
        stage: "Stage2",
        evolveFrom: "Lombre",
        hp: 160,
        types: ["Grass"],
        retreat: 2,
        abilities: ability("Excited Heal", EXCITED_HEAL),
        attacks: [{ cost: ["Grass", "Colorless"], name: "Lunge Out", damage: 120 }],
      } as Partial<Card>),
    ]),
  ),
  [LINOONE]: battler(LINOONE, {
    name: "Linoone",
    stage: "Stage1",
    evolveFrom: "Zigzagoon",
    hp: 100,
    types: ["Colorless"],
    abilities: ability("Excited Dash", EXCITED_DASH),
    attacks: [{ cost: ["Colorless"], name: "Slash", damage: 70 }],
  } as Partial<Card>),
  [SEVIPER]: battler(SEVIPER, {
    name: "Seviper",
    hp: 120,
    types: ["Darkness"],
    abilities: ability("Excited Power", EXCITED_POWER),
    attacks: [{ cost: ["Darkness", "Darkness", "Darkness"], name: "Pitch-Black Fangs", damage: 120 }],
  } as Partial<Card>),
  ...Object.fromEntries(
    MEGA_SIGNAL.map((id) => [id, { ...trainerCard(id, "Item", MEGA_SIGNAL_TEXT), name: "Mega Signal" }]),
  ),
  [JETT]: { ...trainerCard(JETT, "Supporter", JETT_TEXT), name: "Jett" },
  [MEGA_R]: mega(MEGA_R, "Mega Camerupt ex", "Fire"),
  [MEGA_G]: mega(MEGA_G, "Mega Venusaur ex", "Grass"),
  [MEGA_D]: mega(MEGA_D, "Mega Absol ex", "Darkness", {
    attacks: [{ cost: ["Darkness"], name: "Cut", damage: 200 }],
  } as Partial<Card>),
  [PLAIN_EX]: mega(PLAIN_EX, "Charizard ex", "Fire"),
  [MEGANIUM]: mega(MEGANIUM, "Meganium", "Grass"),
  [FIRE]: battler(FIRE, { name: "D603 Fire", hp: 100, types: ["Fire"] }),
  [FILLER]: battler(FILLER, { name: "D603 Filler", hp: 300, types: ["Colorless"], retreat: 1 }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [ORICORIO[0]]: 1,
  [LUDICOLO[0]]: 1,
  [LINOONE]: 1,
  [SEVIPER]: 1,
  [MEGA_SIGNAL[0]]: 1,
  [JETT]: 1,
  [MEGA_R]: 2,
  [MEGA_G]: 1,
  [MEGA_D]: 2,
  [PLAIN_EX]: 1,
  [MEGANIUM]: 1,
  [FIRE]: 1,
  [FILLER]: 20,
  "fix-fire-energy": 8,
  "fix-grass-energy": 4,
  "fix-dark-energy": 8,
  "fix-energy": 6,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's second turn; both hands back into the decks and the Prizes swapped out
    for deck filler, so every named card is findable (D602's `p1Turn`). */
function p1Turn(): GameState {
  const created = createGame({ seed: 6031, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if ([FILLER, "fix-energy"].includes(state.cardIdByUid[u] as string)) return u;
      const swap = deck.find((d) => [FILLER, "fix-energy"].includes(state.cardIdByUid[d] as string));
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** P1: `active` (a FILLER by default), `bench` and exactly `hand`; P2: `foe` (a FILLER by default)
    and `foeBench`. */
function table(opts: {
  active?: string;
  bench?: readonly string[];
  hand?: readonly string[];
  foe?: string;
  foeBench?: readonly string[];
}): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", opts.active ?? FILLER), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.foe ?? FILLER), "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  for (const id of opts.foeBench ?? []) state = benchFromDeck(state, "p2", id);
  const side = state.players.p1;
  let deck = [...side.deck];
  const hand: string[] = [];
  for (const id of opts.hand ?? []) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`p1 deck has no ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, p1: { ...side, hand, deck } } } as GameState;
}

const ACTIVE = { spot: "active" } as const;
const bench = (index: number) => ({ spot: "bench", index }) as const;
const benchRef = (index: number) => ({ seat: "p1", spot: { spot: "bench", index } }) as const;
const use = (state: GameState, abilityName: string, target: typeof ACTIVE | ReturnType<typeof bench>) =>
  applyAction(state, { type: "useAbility", seat: "p1", target, abilityName } as GameAction);
function ok(result: ReturnType<typeof applyAction>) {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}
function refusal(result: ReturnType<typeof applyAction>): { code: string; message: string } {
  if (result.ok) throw new Error("expected a refusal");
  return { code: result.error.code, message: result.error.message };
}
const resolve = (state: GameState, choice: unknown) =>
  ok(applyAction(state, { type: "resolveEffect", seat: "p1", choice } as GameAction));
function prompt(state: GameState): Record<string, unknown> {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt as unknown as Record<string, unknown>;
}
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const top = (state: GameState, seat: Seat, at: "active" | number) => {
  const body = at === "active" ? state.players[seat].active : state.players[seat].bench[at];
  return body === null || body === undefined ? undefined : state.cardIdByUid[body.stack.at(-1) as string];
};
const shuffled = (events: readonly GameEvent[]) =>
  events.filter((e) => e.type === "SHUFFLE").map((e) => (e as { seat: Seat }).seat);
const playTrainer = (state: GameState, id: string) => {
  const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id} in hand`);
  return applyAction(state, { type: "playTrainer", seat: "p1", uid } as GameAction);
};

describe("D603 §2 — the new vocabulary: `megaEvolutionEx` and `yourMegaExInPlay`", () => {
  it("`megaEvolutionEx` is D582's predicate: a Mega ex yes; a plain ex, Meganium and the Trainer Mega Signal no", () => {
    for (const id of [MEGA_R, MEGA_G, MEGA_D]) {
      expect(matchesFilter(POOL[id], { kind: "megaEvolutionEx" }), id).toBe(true);
      expect(isMegaEvolutionPokemonEx(POOL[id] as Card), id).toBe(true);
    }
    for (const id of [PLAIN_EX, MEGANIUM, MEGA_SIGNAL[0], FILLER])
      expect(matchesFilter(POOL[id], { kind: "megaEvolutionEx" }), id).toBe(false);
  });

  it("`yourMegaExInPlay`: YOUR Active or Bench; the type, when printed, is the body's", () => {
    const fire: BoardCondition = { kind: "yourMegaExInPlay", type: "Fire" };
    const grass: BoardCondition = { kind: "yourMegaExInPlay", type: "Grass" };
    const any: BoardCondition = { kind: "yourMegaExInPlay" };
    const benched = table({ bench: [MEGA_R] });
    expect([conditionHolds(benched, "p1", fire), conditionHolds(benched, "p1", grass)]).toEqual([true, false]);
    expect(conditionHolds(benched, "p1", any)).toBe(true);
    const active = table({ active: MEGA_G });
    expect([conditionHolds(active, "p1", fire), conditionHolds(active, "p1", grass)]).toEqual([false, true]);
    expect(conditionHolds(active, "p1", any)).toBe(true);
    // A {R} ex that is not a Mega, and a "Mega"-prefixed name that is not one: neither counts.
    const nearMiss = table({ active: PLAIN_EX, bench: [MEGANIUM] });
    expect([conditionHolds(nearMiss, "p1", fire), conditionHolds(nearMiss, "p1", any)]).toEqual([false, false]);
    // The opponent's Mega ex is not YOURS.
    const theirs = table({ foe: MEGA_R, foeBench: [MEGA_G] });
    expect(conditionHolds(theirs, "p1", any)).toBe(false);
    expect(conditionHolds(theirs, "p2", fire)).toBe(true);
  });

  it("the note is the printed clause, the type spelled out", () => {
    expect(conditionNote({ kind: "yourMegaExInPlay", type: "Fire" })).toBe(
      "you have any Fire Mega Evolution Pokémon ex in play",
    );
    expect(conditionNote({ kind: "yourMegaExInPlay" })).toBe("you have any Mega Evolution Pokémon ex in play");
  });
});

describe("D603 §3 — Excited Turbo: a Basic {R} from hand to a Benched {R}, as often as you like", () => {
  it("offers the Benched {R} bodies only (itself included; not the {R} Active, not a {C}); twice in one turn", () => {
    let state = table({
      active: MEGA_R,
      bench: [ORICORIO[0], FILLER, FIRE],
      hand: ["fix-fire-energy", "fix-fire-energy", "fix-grass-energy"],
    });
    const parked = ok(use(state, "Excited Turbo", bench(0))).state;
    const offer = prompt(parked);
    expect(offer.kind).toBe("choosePokemon");
    expect(offer.candidates).toEqual([benchRef(0), benchRef(2)]);
    state = resolve(parked, { kind: "pokemon", ref: benchRef(2) }).state;
    expect(ids(state, state.players.p1.bench[2]?.energy ?? [])).toEqual(["fix-fire-energy"]);
    state = resolve(ok(use(state, "Excited Turbo", bench(0))).state, { kind: "pokemon", ref: benchRef(0) }).state;
    expect(ids(state, state.players.p1.bench[0]?.energy ?? [])).toEqual(["fix-fire-energy"]);
    expect(ids(state, state.players.p1.hand)).toEqual(["fix-grass-energy"]);
    expect(state.players.p1.active?.energy).toEqual([]);
  });

  it("refused without a {R} Mega ex in play — a {G} Mega, a plain {R} ex — and the reason names the clause", () => {
    for (const active of [MEGA_G, PLAIN_EX]) {
      const result = use(
        table({ active, bench: [ORICORIO[0]], hand: ["fix-fire-energy"] }),
        "Excited Turbo",
        bench(0),
      );
      expect(refusal(result).code, active).toBe("ABILITY_CONDITION_NOT_MET");
      expect(refusal(result).message).toContain("you have any Fire Mega Evolution Pokémon ex in play");
    }
  });

  it("refused when it could only whiff: no Basic {R} Energy in hand", () => {
    const noFire = use(
      table({ active: MEGA_R, bench: [ORICORIO[0]], hand: ["fix-grass-energy"] }),
      "Excited Turbo",
      bench(0),
    );
    expect(refusal(noFire).code).toBe("NO_LEGAL_TARGET");
  });

  it("from the Active Spot too (no spot clause is printed): the one Benched {R} — the Mega ex — takes it", () => {
    const state = table({ active: ORICORIO[0], bench: [FILLER, MEGA_R], hand: ["fix-fire-energy"] });
    const done = ok(use(state, "Excited Turbo", ACTIVE)).state;
    expect(done.phase.kind).toBe("turn:action");
    expect(ids(done, done.players.p1.bench[1]?.energy ?? [])).toEqual(["fix-fire-energy"]);
    expect(done.players.p1.active?.energy).toEqual([]);
  });
});

describe("D603 §4 — Excited Heal: with a {G} Mega ex in play, heal 60 from 1 of your Pokémon", () => {
  it("the chosen body heals 60; once per Pokémon", () => {
    let state = table({ active: MEGA_G, bench: [LUDICOLO[0]] });
    state = setBenchDamage(setDamage(state, "p1", 100), "p1", 0, 30);
    const parked = ok(use(state, "Excited Heal", bench(0))).state;
    expect(prompt(parked).kind).toBe("choosePokemon");
    const done = resolve(parked, { kind: "pokemon", ref: { seat: "p1", spot: { spot: "active" } } }).state;
    expect(done.players.p1.active?.damage).toBe(40);
    expect(done.players.p1.bench[0]?.damage).toBe(30);
    expect(refusal(use(done, "Excited Heal", bench(0))).code).toBe("ABILITY_ALREADY_USED");
  });

  it("refused with only a {R} Mega ex, or Meganium, in play", () => {
    for (const active of [MEGA_R, MEGANIUM]) {
      const state = setDamage(table({ active, bench: [LUDICOLO[0]] }), "p1", 100);
      const result = use(state, "Excited Heal", bench(0));
      expect(refusal(result).code, active).toBe("ABILITY_CONDITION_NOT_MET");
      expect(refusal(result).message).toContain("you have any Grass Mega Evolution Pokémon ex in play");
    }
  });
});

describe("D603 §5 — Excited Dash: on the Bench, with any Mega ex in play, switch with the Active", () => {
  it("any type of Mega ex opens it (untyped): Linoone becomes the Active, the Active goes to the Bench", () => {
    for (const mega of [MEGA_R, MEGA_G, MEGA_D]) {
      const state = table({ active: FILLER, bench: [mega, LINOONE] });
      const done = ok(use(state, "Excited Dash", bench(1))).state;
      expect(done.phase.kind, mega).toBe("turn:action");
      expect(top(done, "p1", "active"), mega).toBe(LINOONE);
      expect(done.players.p1.bench.map((_, i) => top(done, "p1", i)).sort(), mega).toEqual([FILLER, mega].sort());
    }
  });

  it("refused from the Active Spot, and with no Mega ex of YOURS in play (a plain ex; the opponent's Mega)", () => {
    expect(refusal(use(table({ active: LINOONE, bench: [MEGA_R] }), "Excited Dash", ACTIVE)).code).toBe(
      "ABILITY_BENCH_ONLY",
    );
    const plain = use(table({ active: PLAIN_EX, bench: [LINOONE] }), "Excited Dash", bench(0));
    expect(refusal(plain).code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(refusal(plain).message).toContain("you have any Mega Evolution Pokémon ex in play");
    const theirs = use(table({ bench: [LINOONE], foe: MEGA_R }), "Excited Dash", bench(0));
    expect(refusal(theirs).code).toBe("ABILITY_CONDITION_NOT_MET");
  });
});

describe("D603 §6 — Excited Power: with a {D} Mega ex in play, this Pokémon's attacks do 120 more", () => {
  const fangs = (opts: { bench: readonly string[] }) => {
    const state = attachFromDeck(table({ active: SEVIPER, bench: opts.bench }), "p1", "fix-dark-energy", 3);
    return ok(applyAction(state, { type: "attack", seat: "p1", index: 0 } as GameAction)).state;
  };

  it("Pitch-Black Fangs does 120 + 120 with a {D} Mega ex on the Bench", () => {
    expect(fangs({ bench: [MEGA_D] }).players.p2.active?.damage).toBe(240);
  });

  it("…and the printed 120 without one: a {R} Mega ex, a plain ex, nothing", () => {
    for (const bench of [[MEGA_R], [PLAIN_EX], []])
      expect(fangs({ bench }).players.p2.active?.damage, bench.join()).toBe(120);
  });

  it("it is THIS Pokémon's attacks: a Benched Seviper does not boost the {D} Mega ex's own attack", () => {
    const state = attachFromDeck(table({ active: MEGA_D, bench: [SEVIPER] }), "p1", "fix-dark-energy", 1);
    const done = ok(applyAction(state, { type: "attack", seat: "p1", index: 0 } as GameAction)).state;
    expect(done.players.p2.active?.damage).toBe(200);
  });
});

describe("D603 §7 — Mega Signal: a Mega Evolution Pokémon ex from the deck", () => {
  it("offers the Mega ex only (not a plain ex, not Meganium); one goes to the hand, the deck is shuffled", () => {
    const state = table({ hand: [MEGA_SIGNAL[0]] });
    const parked = ok(playTrainer(state, MEGA_SIGNAL[0]));
    const offer = prompt(parked.state);
    expect(offer.kind).toBe("chooseCards");
    expect(offer.max).toBe(1);
    const candidates = offer.candidates as string[];
    expect(new Set(ids(parked.state, candidates))).toEqual(new Set([MEGA_R, MEGA_G, MEGA_D]));
    const pick = candidates.find((u) => parked.state.cardIdByUid[u] === MEGA_D) as string;
    const done = resolve(parked.state, { kind: "cards", uids: [pick] });
    expect(done.state.players.p1.hand).toEqual([pick]);
    expect(shuffled(done.events)).toContain("p1");
  });
});

describe("D603 §8 — Jett: a card for each of your opponent's Mega Evolution Pokémon ex in play", () => {
  it("counts the opponent's Active and Bench Mega ex (2 here), not a plain ex, not YOUR Mega ex", () => {
    const state = table({ active: MEGA_G, hand: [JETT], foe: MEGA_D, foeBench: [MEGA_R, PLAIN_EX, MEGANIUM] });
    const done = ok(playTrainer(state, JETT)).state;
    expect(done.players.p1.hand).toHaveLength(2);
    expect(done.players.p1.hand).toEqual(state.players.p1.deck.slice(0, 2));
    expect(done.allowances.supporterPlayed).toBe(true);
  });

  it("R-PX6 (UNRULED, inherited from Awakening Drum): none in play draws 0 and Jett is still played", () => {
    const state = table({ active: MEGA_G, hand: [JETT], foe: PLAIN_EX });
    const done = ok(playTrainer(state, JETT)).state;
    expect(done.players.p1.hand).toEqual([]);
    expect(done.players.p1.deck).toHaveLength(state.players.p1.deck.length);
    expect(done.allowances.supporterPlayed).toBe(true);
  });
});

describe("D603 §9 — the dropped and excluded texts stay unkeyed, and the version", () => {
  it("Latios, Wally's Compassion ×3, Tremendous Bomb ×2, Ange Floette and Core Memory carry no program", () => {
    for (const id of [
      "me01-101", // Latios "Lustrous Assist" — dropped
      "me01-132", // Wally's Compassion — dropped
      "me01-176",
      "me01-186",
      "me05-082", // Tremendous Bomb — excluded
      "me05-113",
      "me04-075", // Ange Floette — excluded
      "me03-070", // Core Memory — excluded
    ])
      expect(programFor(id), id).toBeUndefined();
  });

  it("is built at engine 0.502.0", () => {
    expect(engineVersion).toBe("0.502.0");
  });
});
