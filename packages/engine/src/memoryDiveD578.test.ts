import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { attackMenuOf, firstTurnAttackBanned, memoryDiveLive } from "./continuous";
import { COPY_FAMILY_MARKER } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  deckOf,
  trainerCard,
  typedEnergy,
  must,
  mustApply as run,
  patchSide,
  driveSetup,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const RELICANTH = "sv05-084";
const RELICANTH_ALT = "sv05-173";
const LOW = "d578m-low";
const SNIPER = "d578m-sniper-low";
const MID = "d578m-mid";
const TOP = "d578m-top";
const SCYTHER = "sv05-001";
const SCIZOR = "sv05-111";
const AXEW = "d578m-axew";
const FRAXURE = "sv10.5b-069";
const HAXORUS = "d578m-haxorus";
const EXEGGCUTE = "sv08-001";
const EXEGGUTOR = "d578m-exeggutor";
const KLEFKI = "sv01-096";
const SEISMITOAD = "sv03-052";
const COPIER = "d578m-copier";
const LITTEN = "d578m-litten";
const TORRACAT = "sv05-033";
const INCINEROAR = "sv05-034";
const CHOOSER = "d578m-chooser";
const TM = "sv08-188";
const PLAIN = "d578m-plain";
const FILLER = "d578m-filler";
const G = "d578m-grass";
const F = "d578m-fighting";
const M = "d578m-metal";
const R = "d578m-fire";

const MEMORY_DIVE_TEXT =
  "Each of your evolved Pokémon can use any attack from its previous Evolutions. (You still need the necessary Energy to use each attack.)";

const poke = (id: string, extra: Partial<Card>): Card =>
  battler(id, { name: id, hp: 900, types: ["Colorless"], ...extra });

const relicanth = (id: string): Card =>
  poke(id, {
    name: "Relicanth",
    hp: 100,
    types: ["Fighting"],
    abilities: [{ type: "Ability", name: "Memory Dive", effect: MEMORY_DIVE_TEXT }],
    attacks: [{ cost: ["Fighting", "Colorless"], name: "Razor Fin", damage: 30 }],
  });

const LOCAL_CARDS: Record<string, Card> = {
  [RELICANTH]: relicanth(RELICANTH),
  [RELICANTH_ALT]: relicanth(RELICANTH_ALT),
  [LOW]: poke(LOW, { name: "Low", attacks: [{ cost: ["Grass"], name: "Low Strike", damage: 20 }] }),
  [SNIPER]: poke(SNIPER, {
    name: "Low",
    attacks: [
      {
        cost: [],
        name: "Pick Off",
        damage: 10,
        effect:
          "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  [MID]: poke(MID, {
    name: "Mid",
    stage: "Stage1",
    evolveFrom: "Low",
    attacks: [{ cost: [], name: "Mid Strike", damage: 40 }],
  }),
  [TOP]: poke(TOP, {
    name: "Top",
    stage: "Stage2",
    evolveFrom: "Mid",
    attacks: [
      { cost: [], name: "Top Strike", damage: 90 },
      { cost: [], name: "Top Slam", damage: 100 },
    ],
  }),
  [SCYTHER]: poke(SCYTHER, {
    name: "Scyther",
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Cut Up", damage: 10 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Slashing Strike",
        effect: "During your next turn, this Pokémon can't use Slashing Strike.",
        damage: 60,
      },
    ],
  }),
  [SCIZOR]: poke(SCIZOR, {
    name: "Scizor ex",
    stage: "Stage1",
    evolveFrom: "Scyther",
    types: ["Metal"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Steel Wing",
        effect:
          "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance).",
        damage: 70,
      },
      {
        cost: ["Metal", "Metal"],
        name: "Cross Breaker",
        effect:
          "Discard up to 2 {M} Energy from this Pokémon. This attack does 120 damage for each card you discarded in this way.",
        damage: "120×",
      },
    ],
  }),
  [LITTEN]: poke(LITTEN, {
    name: "Litten",
    types: ["Fire"],
    attacks: [{ cost: [], name: "Scratch", damage: 10 }],
  }),
  [TORRACAT]: poke(TORRACAT, {
    name: "Torracat",
    stage: "Stage1",
    evolveFrom: "Litten",
    types: ["Fire"],
    attacks: [
      { cost: ["Fire"], name: "Bite", damage: 30 },
      {
        cost: ["Fire", "Colorless", "Colorless"],
        name: "Flare Strike",
        effect: "During your next turn, this Pokémon can't use Flare Strike.",
        damage: 80,
      },
    ],
  }),
  [INCINEROAR]: poke(INCINEROAR, {
    name: "Incineroar ex",
    stage: "Stage2",
    evolveFrom: "Torracat",
    types: ["Fire"],
    attacks: [
      {
        cost: ["Fire", "Colorless", "Colorless", "Colorless", "Colorless"],
        name: "Blaze Blast",
        effect: "Your opponent's Active Pokémon is now Burned.",
        damage: 240,
      },
    ],
  }),
  [AXEW]: poke(AXEW, {
    name: "Axew",
    types: ["Dragon"],
    attacks: [{ cost: [], name: "Scratch", damage: 10 }],
  }),
  [FRAXURE]: poke(FRAXURE, {
    name: "Fraxure",
    stage: "Stage1",
    evolveFrom: "Axew",
    types: ["Dragon"],
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      {
        cost: ["Fighting", "Metal"],
        name: "Boundless Power",
        effect: "During your next turn, this Pokémon can't use attacks.",
        damage: 90,
      },
    ],
  }),
  [HAXORUS]: poke(HAXORUS, {
    name: "Haxorus",
    stage: "Stage2",
    evolveFrom: "Fraxure",
    types: ["Dragon"],
    attacks: [{ cost: [], name: "Axe Chop", damage: 10 }],
  }),
  [EXEGGCUTE]: poke(EXEGGCUTE, {
    name: "Exeggcute",
    types: ["Grass"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Precocious Evolution",
        effect:
          "If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
      },
    ],
  }),
  [EXEGGUTOR]: poke(EXEGGUTOR, {
    name: "Exeggutor",
    stage: "Stage1",
    evolveFrom: "Exeggcute",
    types: ["Grass"],
    attacks: [{ cost: [], name: "Stomp", damage: 30 }],
  }),
  [KLEFKI]: poke(KLEFKI, {
    name: "Klefki",
    types: ["Psychic"],
    abilities: [
      {
        type: "Ability",
        name: "Mischievous Lock",
        effect:
          "As long as this Pokémon is in the Active Spot, Basic Pokémon in play (both yours and your opponent's) have no Abilities, except for Mischievous Lock.",
      },
    ],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [SEISMITOAD]: poke(SEISMITOAD, {
    name: "Seismitoad",
    stage: "Stage2",
    evolveFrom: "Palpitoad",
    types: ["Water"],
    abilities: [
      {
        type: "Ability",
        name: "Quaking Zone",
        effect:
          "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon cost {C} more.",
      },
    ],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [COPIER]: poke(COPIER, {
    name: "D578 Copier",
    attacks: [
      {
        cost: [],
        name: "Foul Play",
        effect: "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.",
      },
    ],
  }),
  [CHOOSER]: poke(CHOOSER, {
    name: "D578 Chooser",
    attacks: [
      {
        cost: [],
        name: "Bind",
        damage: 10,
        effect:
          "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      },
    ],
  }),
  [TM]: {
    ...trainerCard(
      TM,
      "Tool",
      "The Pokémon this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.) If this card is attached to 1 of your Pokémon, discard it at the end of your turn.",
    ),
    name: "Technical Machine: Fluorite",
    attacks: CATALOG_MANIFEST.trainerFaces[TM]?.attacks ?? null,
  },
  [PLAIN]: poke(PLAIN, { name: "D578 Plain", attacks: [{ cost: [], name: "Tap", damage: 10 }] }),
  [FILLER]: poke(FILLER, {
    name: "D578 Filler",
    retreat: 1,
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [G]: typedEnergy(G, "Grass"),
  [F]: typedEnergy(F, "Fighting"),
  [M]: typedEnergy(M, "Metal"),
  [R]: typedEnergy(R, "Fire"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [RELICANTH]: 2,
  [RELICANTH_ALT]: 1,
  [LOW]: 2,
  [SNIPER]: 1,
  [MID]: 2,
  [TOP]: 2,
  [SCYTHER]: 1,
  [SCIZOR]: 1,
  [AXEW]: 1,
  [FRAXURE]: 1,
  [HAXORUS]: 1,
  [EXEGGCUTE]: 1,
  [EXEGGUTOR]: 1,
  [KLEFKI]: 1,
  [SEISMITOAD]: 1,
  [COPIER]: 1,
  [CHOOSER]: 1,
  [TM]: 1,
  [PLAIN]: 2,
  [LITTEN]: 1,
  [TORRACAT]: 1,
  [INCINEROAR]: 1,
  [FILLER]: 15,
  [G]: 4,
  [F]: 3,
  [M]: 3,
  [R]: 1,
  "fix-energy": 7,
});

function rejected(state: GameState, action: GameAction): string {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return result.error.code;
}

function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function pull(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const is = (u: string) => state.cardIdByUid[u] === id;
  const zone = (["deck", "hand", "prizes"] as const).find((z) => side[z].some(is));
  if (zone === undefined) throw new Error(`${seat} has no ${id}`);
  const uid = side[zone].find(is) ?? "";
  if (zone === "prizes") {
    const swap = side.deck.find((u) => !is(u)) ?? "";
    return {
      uid,
      state: patchSide(state, seat, {
        prizes: side.prizes.map((u) => (u === uid ? swap : u)),
        deck: side.deck.filter((u) => u !== swap),
      }),
    };
  }
  return { uid, state: patchSide(state, seat, { [zone]: side[zone].filter((u) => u !== uid) }) };
}

interface Spot {
  id: string;
  under?: readonly string[];
  energy?: readonly string[];
  tools?: readonly string[];
}

/** p1's turn 2: each seat's Active and Bench built from `Spot`s (an evolved body carries its
    `under` cards, bottom first, beneath the top); every hand emptied into the deck. */
function table(opts: {
  p1: Spot;
  p1Bench?: readonly Spot[];
  p2: Spot;
  p2Bench?: readonly Spot[];
}): GameState {
  let state = opened(5783);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy]),
    ];
    state = patchSide(state, seat, {
      hand: [],
      active: null,
      bench: [],
      deck: [...side.deck, ...back],
    });
  }
  const take = (seat: Seat, id: string): string => {
    const pulled = pull(state, seat, id);
    state = pulled.state;
    return pulled.uid;
  };
  const build = (seat: Seat, spot: Spot): InPlayPokemon => {
    const stack = [...(spot.under ?? []), spot.id].map((id) => take(seat, id));
    const energy = (spot.energy ?? []).map((id) => take(seat, id));
    const tools = (spot.tools ?? []).map((id) => take(seat, id));
    return { ...makeInPlay(stack[0] ?? "", 0), stack, energy, tools };
  };
  for (const seat of ["p1", "p2"] as const) {
    const active = build(seat, seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : (opts.p2Bench ?? [])).map((s) =>
      build(seat, s),
    );
    state = patchSide(state, seat, { active, bench });
  }
  return state;
}

const active = (state: GameState, seat: Seat = "p1"): InPlayPokemon =>
  state.players[seat].active as InPlayPokemon;
const names = (state: GameState, seat: Seat = "p1") =>
  attackMenuOf(state, seat, active(state, seat)).map((row) => `${row.attack.name}/${row.origin}`);
const dealt = (events: readonly GameEvent[]) =>
  events.find((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT")
    ?.dealt;

const LINE: Spot = { id: TOP, under: [LOW, MID] };
const DIVER: Spot = { id: RELICANTH };

describe("D578 Memory Dive §1 — the registry row", () => {
  it("both printings carry the ONE object, `memoryDive`, and no attack key (Razor Fin keeps deriving)", () => {
    expect(programFor(RELICANTH)).toEqual({ passive: { memoryDive: true } });
    expect(programFor(RELICANTH_ALT)).toBe(programFor(RELICANTH));
  });
});

describe("D578 Memory Dive §2 — the section: lower stages, bottom to top, AFTER the printed attacks", () => {
  it("a Stage 2 with a Relicanth on the Bench: Top Strike, Top Slam, then Low Strike, Mid Strike", () => {
    const state = table({ p1: LINE, p1Bench: [DIVER], p2: { id: PLAIN } });
    expect(memoryDiveLive(state, "p1")).toBe(true);
    expect(names(state)).toEqual([
      "Top Strike/printed",
      "Top Slam/printed",
      "Low Strike/memoryDive",
      "Mid Strike/memoryDive",
    ]);
    const menu = attackMenuOf(state, "p1", active(state));
    expect(menu.map((r) => [r.card.id, r.sourceIndex])).toEqual([
      [TOP, 0],
      [TOP, 1],
      [LOW, 0],
      [MID, 0],
    ]);
  });

  it("no Relicanth: the printed attacks only", () => {
    const state = table({ p1: LINE, p2: { id: PLAIN } });
    expect(memoryDiveLive(state, "p1")).toBe(false);
    expect(names(state)).toEqual(["Top Strike/printed", "Top Slam/printed"]);
  });

  it("an UNEVOLVED body gets nothing (it has no previous Evolutions)", () => {
    const state = table({ p1: { id: LOW }, p1Bench: [DIVER], p2: { id: PLAIN } });
    expect(names(state)).toEqual(["Low Strike/printed"]);
  });

  it("a stage Rare Candy SKIPPED contributes nothing — the cards in the stack only", () => {
    const state = table({ p1: { id: TOP, under: [LOW] }, p1Bench: [DIVER], p2: { id: PLAIN } });
    expect(names(state)).toEqual([
      "Top Strike/printed",
      "Top Slam/printed",
      "Low Strike/memoryDive",
    ]);
  });

  it("two Relicanth do not stack (one section, no duplicates)", () => {
    const state = table({ p1: LINE, p1Bench: [DIVER, { id: RELICANTH_ALT }], p2: { id: PLAIN } });
    expect(names(state)).toHaveLength(4);
  });

  it("'Each of YOUR evolved Pokémon': the OPPONENT's Relicanth grants p1 nothing", () => {
    const state = table({ p1: LINE, p2: { id: PLAIN }, p2Bench: [DIVER] });
    expect(memoryDiveLive(state, "p1")).toBe(false);
    expect(memoryDiveLive(state, "p2")).toBe(true);
    expect(names(state)).toHaveLength(2);
  });

  it("§9: an Active Klefki (Basic Pokémon have no Abilities) silences the Relicanth — no section", () => {
    const state = table({ p1: LINE, p1Bench: [DIVER], p2: { id: KLEFKI } });
    expect(memoryDiveLive(state, "p1")).toBe(false);
    expect(names(state)).toHaveLength(2);
  });

  it("the wire lists the borrowed rows at their flat indices with their OWN printed costs", () => {
    const state = table({ p1: LINE, p1Bench: [DIVER], p2: { id: PLAIN } });
    const view = redactGame(state, "p1");
    if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(view.phase.attacks.map((a) => [a.index, a.name, a.cost, a.playable])).toEqual([
      [0, "Top Strike", [], true],
      [1, "Top Slam", [], true],
      [2, "Low Strike", ["Grass"], false],
      [3, "Mid Strike", [], true],
    ]);
  });
});

describe("D578 Memory Dive §3 — declaring a borrowed attack (R-MD1: its own cost, every modifier)", () => {
  it("Mid Strike (flat index 3) deals ITS damage and ATTACK_DECLARED names it, at the flat index, with no `as`", () => {
    const state = table({ p1: LINE, p1Bench: [DIVER], p2: { id: PLAIN } });
    const { events } = run(state, { type: "attack", seat: "p1", index: 3 });
    expect(events[0]).toEqual({
      type: "ATTACK_DECLARED",
      seat: "p1",
      uid: active(state).stack[2],
      attack: "Mid Strike",
      index: 3,
    });
    expect(dealt(events)).toBe(40);
  });

  it("Low Strike costs its printed {G}: unmet on Colorless, paid by a {G}", () => {
    const dry = table({
      p1: { ...LINE, energy: ["fix-energy"] },
      p1Bench: [DIVER],
      p2: { id: PLAIN },
    });
    expect(rejected(dry, { type: "attack", seat: "p1", index: 2 })).toBe("ATTACK_COST_UNMET");
    const wet = table({ p1: { ...LINE, energy: [G] }, p1Bench: [DIVER], p2: { id: PLAIN } });
    expect(dealt(run(wet, { type: "attack", seat: "p1", index: 2 }).events)).toBe(20);
  });

  it("under an opposing Quaking Zone ({C} more) the borrowed cost is {G}{C}: one {G} is short, {G}+{C} pays", () => {
    const short = table({ p1: { ...LINE, energy: [G] }, p1Bench: [DIVER], p2: { id: SEISMITOAD } });
    expect(rejected(short, { type: "attack", seat: "p1", index: 2 })).toBe("ATTACK_COST_UNMET");
    const paid = table({
      p1: { ...LINE, energy: [G, "fix-energy"] },
      p1Bench: [DIVER],
      p2: { id: SEISMITOAD },
    });
    expect(dealt(run(paid, { type: "attack", seat: "p1", index: 2 }).events)).toBe(20);
  });

  it("with no Relicanth the same index is BAD_ATTACK_INDEX", () => {
    const state = table({ p1: LINE, p2: { id: PLAIN } });
    expect(rejected(state, { type: "attack", seat: "p1", index: 3 })).toBe("BAD_ATTACK_INDEX");
  });
});

/** After p1's attack ended p1's turn: ends p2's, back to p1's next turn. */
const nextOwnTurn = (state: GameState): GameState =>
  run(state, { type: "endTurn", seat: "p2" }).state;

describe("D578 Memory Dive §4 — R-MD3: whole-body locks and all-attacks boosts reach borrowed rows", () => {
  it("Haxorus borrowing Fraxure's 'Boundless Power' installs its whole-body lock: next turn it cannot attack at all", () => {
    const state = table({
      p1: { id: HAXORUS, under: [AXEW, FRAXURE], energy: [F, M] },
      p1Bench: [DIVER],
      p2: { id: PLAIN },
    });
    expect(names(state)).toEqual([
      "Axe Chop/printed",
      "Scratch/memoryDive",
      "Bite/memoryDive",
      "Boundless Power/memoryDive",
    ]);
    const after = run(state, { type: "attack", seat: "p1", index: 3 });
    expect(dealt(after.events)).toBe(90);
    const back = nextOwnTurn(after.state);
    expect(rejected(back, { type: "attack", seat: "p1", index: 0 })).toBe("ATTACK_PREVENTED");
    expect(rejected(back, { type: "attack", seat: "p1", index: 1 })).toBe("ATTACK_PREVENTED");
    expect(rejected(back, { type: "attack", seat: "p1", index: 3 })).toBe("ATTACK_PREVENTED");
    const later = nextOwnTurn(run(back, { type: "endTurn", seat: "p1" }).state);
    expect(dealt(run(later, { type: "attack", seat: "p1", index: 3 }).events)).toBe(90);
  });

  it("an ALL-ATTACKS boost (`attackIndex: null`) pays a borrowed attack; a NAMED boost at printed index 0 does not", () => {
    const state = table({ p1: LINE, p1Bench: [DIVER], p2: { id: PLAIN } });
    const boosted = (attackIndex: number | null) =>
      patchSide(state, "p1", {
        active: { ...active(state), boostedAttack: { turn: state.turn, attackIndex, amount: 30 } },
      });
    expect(dealt(run(boosted(null), { type: "attack", seat: "p1", index: 3 }).events)).toBe(70);
    expect(dealt(run(boosted(0), { type: "attack", seat: "p1", index: 3 }).events)).toBe(40);
    expect(dealt(run(boosted(0), { type: "attack", seat: "p1", index: 0 }).events)).toBe(120);
  });
});

describe("D578 Memory Dive §5 — R-MD4 (RULED: fixed at the landing): a NAME-keyed self-lock from a borrowed attack binds to the row used", () => {
  it("Scizor ex borrowing Scyther's 'Slashing Strike': the lock binds by NAME; next turn that row is refused (gate and wire); the turn after it is live", () => {
    const state = table({
      p1: { id: SCIZOR, under: [SCYTHER], energy: ["fix-energy", "fix-energy"] },
      p1Bench: [DIVER],
      p2: { id: PLAIN },
    });
    expect(names(state)).toEqual([
      "Steel Wing/printed",
      "Cross Breaker/printed",
      "Cut Up/memoryDive",
      "Slashing Strike/memoryDive",
    ]);
    const after = run(state, { type: "attack", seat: "p1", index: 3 });
    expect(dealt(after.events)).toBe(60);
    expect(after.events.find((e) => e.type === "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid: active(state).stack[1],
      attack: "Slashing Strike",
    });
    expect(after.state.players.p1.active?.lockedAttacks).toEqual([
      { turn: state.turn + 2, attackIndex: -1, attackName: "Slashing Strike" },
    ]);
    const back = nextOwnTurn(after.state);
    expect(rejected(back, { type: "attack", seat: "p1", index: 3 })).toBe("ATTACK_PREVENTED");
    const view = redactGame(back, "p1");
    if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(view.phase.attacks.map((a) => [a.name, a.playable])).toEqual([
      ["Steel Wing", true],
      ["Cross Breaker", false],
      ["Cut Up", true],
      ["Slashing Strike", false],
    ]);
    expect(dealt(run(back, { type: "attack", seat: "p1", index: 2 }).events)).toBe(10);
    // The turn after: the window has passed and the borrowed attack is live again (and re-locks).
    const later = nextOwnTurn(run(back, { type: "endTurn", seat: "p1" }).state);
    const again = run(later, { type: "attack", seat: "p1", index: 3 });
    expect(dealt(again.events)).toBe(60);
    expect(again.events.some((e) => e.type === "ATTACK_LOCKED")).toBe(true);
  });

  it("Incineroar ex borrowing Torracat's 'Flare Strike' (Litten's 'Scratch' below it): the same — bound, refused next turn, live the turn after", () => {
    const state = table({
      p1: { id: INCINEROAR, under: [LITTEN, TORRACAT], energy: [R, "fix-energy", "fix-energy"] },
      p1Bench: [DIVER],
      p2: { id: PLAIN },
    });
    expect(names(state)).toEqual([
      "Blaze Blast/printed",
      "Scratch/memoryDive",
      "Bite/memoryDive",
      "Flare Strike/memoryDive",
    ]);
    const after = run(state, { type: "attack", seat: "p1", index: 3 });
    expect(dealt(after.events)).toBe(80);
    expect(after.state.players.p1.active?.lockedAttacks).toEqual([
      { turn: state.turn + 2, attackIndex: -1, attackName: "Flare Strike" },
    ]);
    const back = nextOwnTurn(after.state);
    expect(rejected(back, { type: "attack", seat: "p1", index: 3 })).toBe("ATTACK_PREVENTED");
    expect(dealt(run(back, { type: "attack", seat: "p1", index: 2 }).events)).toBe(30);
    const later = nextOwnTurn(run(back, { type: "endTurn", seat: "p1" }).state);
    expect(dealt(run(later, { type: "attack", seat: "p1", index: 3 }).events)).toBe(80);
  });

  it("a PRINTED self-lock is unchanged: Scyther's own 'Slashing Strike' (unevolved) still stamps its printed index", () => {
    const state = table({
      p1: { id: SCYTHER, energy: ["fix-energy", "fix-energy"] },
      p2: { id: PLAIN },
    });
    const after = run(state, { type: "attack", seat: "p1", index: 1 });
    expect(after.state.players.p1.active?.lockedAttacks).toEqual([
      { turn: state.turn + 2, attackIndex: 1 },
    ]);
    const back = nextOwnTurn(after.state);
    expect(rejected(back, { type: "attack", seat: "p1", index: 1 })).toBe("ATTACK_PREVENTED");
  });
});

describe("D578 Memory Dive §6 — R-MD5: a borrowed attack keeps its timing gate through its SOURCE card", () => {
  it("turn 1: Exeggutor's printed Stomp is banned; the borrowed 'Precocious Evolution' (Exeggcute's licence) is not", () => {
    const state = table({
      p1: { id: EXEGGUTOR, under: [EXEGGCUTE] },
      p1Bench: [DIVER],
      p2: { id: PLAIN },
    });
    const turnOne: GameState = { ...state, turn: 1 };
    expect(names(turnOne)).toEqual(["Stomp/printed", "Precocious Evolution/memoryDive"]);
    expect(firstTurnAttackBanned(turnOne, active(turnOne), 0)).toBe(true);
    expect(firstTurnAttackBanned(turnOne, active(turnOne), 1)).toBe(false);
    expect(rejected(turnOne, { type: "attack", seat: "p1", index: 0 })).toBe("FIRST_TURN_ATTACK");
  });
});

describe("D578 Memory Dive §7 — R-MD2: copies and imposed attack bars read PRINTED attacks only", () => {
  it("Foul Play against an evolved Active under ITS owner's Memory Dive: one printed candidate — forced, no park", () => {
    const state = table({ p1: { id: COPIER }, p2: { id: MID, under: [LOW] }, p2Bench: [DIVER] });
    expect(attackMenuOf(state, "p2", active(state, "p2"))).toHaveLength(2);
    const { events } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(events.some((e) => e.type === "EFFECT_PENDING")).toBe(false);
    expect(events[0]).toMatchObject({
      type: "ATTACK_DECLARED",
      attack: "Foul Play",
      as: "Mid Strike",
    });
  });

  it("'Choose 1 of your opponent's Active Pokémon's attacks …' offers the two PRINTED attacks, not the borrowed ones", () => {
    const state = table({ p1: { id: CHOOSER }, p2: LINE, p2Bench: [DIVER] });
    expect(attackMenuOf(state, "p2", active(state, "p2"))).toHaveLength(4);
    const parked = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    if (parked.phase.kind !== "effect:choose")
      throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
    expect(parked.phase.prompt).toMatchObject({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Top Strike" },
        { index: 1, name: "Top Slam" },
      ],
    });
  });
});

describe("D578 Memory Dive §8 — a PRINTED-index record survives the menu changing", () => {
  const barred = (state: GameState): GameState =>
    patchSide(state, "p1", {
      active: { ...active(state), lockedAttacks: [{ turn: state.turn, attackIndex: 0 }] },
    });

  it("a bar on printed 0 refuses index 0 and leaves the borrowed rows live — before and after Relicanth leaves play", () => {
    const state = barred(
      table({ p1: { id: MID, under: [LOW], energy: [G] }, p1Bench: [DIVER], p2: { id: PLAIN } }),
    );
    expect(names(state)).toEqual(["Mid Strike/printed", "Low Strike/memoryDive"]);
    expect(rejected(state, { type: "attack", seat: "p1", index: 0 })).toBe("ATTACK_PREVENTED");
    expect(dealt(run(state, { type: "attack", seat: "p1", index: 1 }).events)).toBe(20);
    const view = redactGame(state, "p1");
    if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(view.phase.attacks.map((a) => [a.name, a.playable])).toEqual([
      ["Mid Strike", false],
      ["Low Strike", true],
    ]);
    const gone = patchSide(state, "p1", { bench: [] });
    expect(names(gone)).toEqual(["Mid Strike/printed"]);
    expect(rejected(gone, { type: "attack", seat: "p1", index: 0 })).toBe("ATTACK_PREVENTED");
  });

  it("a NAMED boost on printed 0 still pays index 0 after a TM row is gone (the TM discarded at the turn's end)", () => {
    const state = table({ p1: { id: PLAIN, tools: [TM] }, p2: { id: PLAIN } });
    expect(names(state)).toEqual(["Tap/printed", "Fluorite/tool"]);
    const shed = run(run(state, { type: "endTurn", seat: "p1" }).state, {
      type: "endTurn",
      seat: "p2",
    }).state;
    expect(names(shed)).toEqual(["Tap/printed"]);
    const boosted = patchSide(shed, "p1", {
      active: { ...active(shed), boostedAttack: { turn: shed.turn, attackIndex: 0, amount: 30 } },
    });
    expect(dealt(run(boosted, { type: "attack", seat: "p1", index: 0 }).events)).toBe(40);
  });
});

describe("D578 Memory Dive §9 — a borrowed attack whose effect PARKS resumes correctly", () => {
  it("a lower stage's bench snipe parks on the target and lands after the pick", () => {
    const state = table({
      p1: { id: MID, under: [SNIPER] },
      p1Bench: [DIVER],
      p2: { id: PLAIN },
      p2Bench: [{ id: PLAIN }, { id: FILLER }],
    });
    expect(names(state)).toEqual(["Mid Strike/printed", "Pick Off/memoryDive"]);
    const parked = run(state, { type: "attack", seat: "p1", index: 1 });
    expect(parked.state.phase.kind).toBe("effect:choose");
    const done = run(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "bench", index: 1 } }] },
    } as GameAction);
    expect(done.state.players.p2.bench[1]?.damage).toBe(30);
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
    expect(done.state.players.p2.active?.damage).toBe(10);
    expect(done.events.some((e) => e.type === "TURN_ENDED")).toBe(true);
  });
});

describe("D578 Memory Dive §10 — census: no COPY-family attack is reachable as a borrowed attack", () => {
  const COPY_FAMILY_HOLDERS: readonly (readonly [string, string, string])[] = [
    ["sv06-079", "Clefable", "Stage1"],
    ["sv07-058", "Slowking", "Stage1"],
    ["sv09-098", "N's Zoroark ex", "Stage1"],
    ["sv09-175", "N's Zoroark ex", "Stage1"],
    ["sv09-185", "N's Zoroark ex", "Stage1"],
    ["sv09-189", "N's Zoroark ex", "Stage1"],
    ["sv10-087", "Team Rocket's Mimikyu", "Basic"],
    ["sv10-093", "Ethan's Sudowoodo", "Basic"],
    ["sv10-150", "Team Rocket's Persian ex", "Stage1"],
    ["sv10-219", "Team Rocket's Persian ex", "Stage1"],
    ["svp-218", "Team Rocket's Persian ex", "Stage1"],
    ["sv10.5w-062", "Zoroark", "Stage1"],
    ["sv10.5w-143", "Zoroark", "Stage1"],
  ];

  it("the legal copy-family printings are exactly the 13 holders above", () => {
    const printings = legalAttackCorpus()
      .filter(([, text]) => COPY_FAMILY_MARKER.test(text))
      .reduce((sum, [count]) => sum + count, 0);
    expect(printings).toBe(COPY_FAMILY_HOLDERS.length);
  });
});
