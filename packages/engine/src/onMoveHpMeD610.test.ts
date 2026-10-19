import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { effectiveMaxHp } from "./continuous";
import type { GameAction, GameState, InPlayPokemon, PokemonRef, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setBenchDamage,
  specialEnergy,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D610 — WP37a: THE FIRST PART OF THE `me` ON-MOVE / AS-OFTEN / HP PASSIVES ──
//
// 8 printed texts / 16 `me` printings on seven new registry objects. Every id and text measured on the
// LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard = 1`; before this slice
// the ids appeared in the tree only as Mega Venusaur ex's rule-box fixture (D582) and Tyrantrum's
// Wreak Havoc fixture (D595), neither of which reads a program. One new piece:
// `hpBonus.requiresEnergyCount` (plus `requiresEnergyType` widened to "special"). Left and named (§9):
// Fall Back to Reload ×2 [🆕🆕🆕 D636 (D539): BUILT at D636], Last-Ditch Catch ×3, [🆕🆕🆕 D628 (D539): Last-Ditch Catch BUILT at D628 (A1)] Luminous Wing ×4 (WP37b) and five passives.
// Two new readings, both ⚠️ UNRULED: R-HL1 (§6), Holes resolves before Palafin's Zero to Hero, with no
// Knock Out check between them [🆕🆕🆕 D625 (D610 MINOR 2): R-HL1 INVERTS D356's principle (turn.ts, Magearna "Auto Heal": the turn player's own effects resolve first when two triggers answer one moment), and its listed reversal "Zero to Hero first" IS D356's order. The departure is the reading because under D356's order Holes' subject has already gone to the deck and Holes does nothing; still UNRULED.]; R-MR1 (§4), Metal Road's printed moment is Buzzing Boost's use-time gate,
// so a use later the same turn sweeps {M} attached to the Bench after the move.

const SOLAR_TRANSFER =
  "As often as you like during your turn, you may use this Ability. Move a Basic {G} Energy from 1 of your Pokémon to another of your Pokémon.";
const BUBBLE_GATHERING =
  "As often as you like during your turn, you may use this Ability. Move an Energy from 1 of your other Pokémon to this Pokémon.";
const METAL_ROAD =
  "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may use this Ability. Move any amount of {M} Energy from your other Pokémon to this Pokémon.";
const SWIRLING_PROSE =
  "As long as this Pokémon is in the Active Spot, whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Confused.";
const HOLES =
  "Whenever your opponent's Active Pokémon moves to the Bench during their turn, place 2 damage counters on that Pokémon.";
const SCALE_UP = "If this Pokémon has 6 or more {G} Energy attached, it gets +250 HP.";
const SCALE_UP_30TH = "If this Pokémon has 6 or more Grass Energy attached, it gets +250 HP.";
const GUTSY = "If this Pokémon has any Special Energy attached, it gets +150 HP.";
const ZERO_TO_HERO =
  "Once during your turn, when this Pokémon moves from the Active Spot to the Bench, you may search your deck for a Palafin ex and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.";

const VENUSAUR = ["me01-003", "me01-155", "me01-177", "mep-013"] as const;
const AZUMARILL = "me02.5-084";
const COBALION = ["me04-064", "me04-103"] as const;
const MISMAGIUS = ["me02-036", "me02-112"] as const;
const DUGTRIO = ["me02.5-101", "me02.5-239"] as const;
const EXEGGUTOR = ["mep-094", "30th-002", "30th-129"] as const;
const TYRANTRUM = ["mep-066", "me03-045"] as const;

const PALAFIN = "sv06-060"; // "Zero to Hero" (D565) — the R-HL1 case in §6
const PALAFIN_EX = "sv06-061";
const SWITCH = "sv01-194"; // Item — "Switch your Active Pokémon with 1 of your Benched Pokémon."
const BOSS = "sv02-172"; // Supporter — the gust
const FREE = "fix-basic-0"; // retreat 0
const BASIC = "fix-basic-1";
const G = "d610-grass";
const R = "d610-fire";
const M = "d610-metal";
const SP = "d610-special";

const body = (id: string, name: string, ability: string, text: string, over: Partial<Card>): Card =>
  battler(id, {
    name,
    abilities: [{ type: "Ability", name: ability, effect: text }],
    ...over,
  } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [VENUSAUR[0]]: body(VENUSAUR[0], "Mega Venusaur ex", "Solar Transfer", SOLAR_TRANSFER, {
    stage: "Stage2",
    evolveFrom: "Ivysaur",
    hp: 380,
    types: ["Grass"],
    retreat: 4,
  }),
  [AZUMARILL]: body(AZUMARILL, "Azumarill ex", "Bubble Gathering", BUBBLE_GATHERING, {
    stage: "Stage1",
    evolveFrom: "Marill",
    hp: 270,
    types: ["Psychic"],
    retreat: 2,
  }),
  [COBALION[0]]: body(COBALION[0], "Cobalion ex", "Metal Road", METAL_ROAD, {
    hp: 210,
    types: ["Metal"],
    retreat: 2,
  }),
  [MISMAGIUS[0]]: body(MISMAGIUS[0], "Mismagius ex", "Swirling Prose", SWIRLING_PROSE, {
    stage: "Stage1",
    evolveFrom: "Misdreavus",
    hp: 260,
    types: ["Psychic"],
    retreat: 1,
  }),
  [DUGTRIO[0]]: body(DUGTRIO[0], "Team Rocket's Dugtrio", "Holes", HOLES, {
    stage: "Stage1",
    evolveFrom: "Team Rocket's Diglett",
    hp: 100,
    types: ["Fighting"],
    retreat: 1,
  }),
  [EXEGGUTOR[0]]: body(EXEGGUTOR[0], "Alolan Exeggutor", "Scale Up", SCALE_UP, {
    stage: "Stage1",
    evolveFrom: "Exeggcute",
    hp: 150,
    types: ["Grass"],
    retreat: 4,
  }),
  [EXEGGUTOR[1]]: body(EXEGGUTOR[1], "Alolan Exeggutor", "Scale Up", SCALE_UP_30TH, {
    stage: "Stage1",
    hp: 150,
    types: ["Grass"],
    retreat: 4,
  }),
  [TYRANTRUM[0]]: body(TYRANTRUM[0], "Tyrantrum", "Tyrannically Gutsy", GUTSY, {
    stage: "Stage2",
    evolveFrom: "Tyrunt",
    hp: 180,
    types: ["Fighting"],
    retreat: 3,
  }),
  [PALAFIN]: body(PALAFIN, "Palafin", "Zero to Hero", ZERO_TO_HERO, {
    stage: "Stage1",
    evolveFrom: "Finizen",
    hp: 100,
    types: ["Water"],
    retreat: 1,
  }),
  [PALAFIN_EX]: body(
    PALAFIN_EX,
    "Palafin ex",
    "Hero's Spirit",
    "Put this Pokémon into play only with the effect of Palafin's Zero to Hero Ability.",
    { stage: "Stage1", evolveFrom: "Finizen", hp: 340, types: ["Water"], retreat: 2 },
  ),
  [G]: typedEnergy(G, "Grass"),
  [R]: typedEnergy(R, "Fire"),
  [M]: typedEnergy(M, "Metal"),
  [SP]: specialEnergy(SP, "D610 Special Energy"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [VENUSAUR[0]]: 2,
  [AZUMARILL]: 2,
  [COBALION[0]]: 2,
  [MISMAGIUS[0]]: 2,
  [DUGTRIO[0]]: 2,
  [EXEGGUTOR[0]]: 1,
  [EXEGGUTOR[1]]: 1,
  [TYRANTRUM[0]]: 1,
  [SWITCH]: 2,
  [BOSS]: 2,
  [PALAFIN]: 1,
  [PALAFIN_EX]: 1,
  [FREE]: 9,
  [BASIC]: 9,
  [G]: 11,
  [R]: 4,
  [M]: 6,
  [SP]: 2,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}
function refusal(result: ReturnType<typeof applyAction>): { code: string; message: string } {
  if (result.ok) throw new Error("expected a refusal");
  return { code: result.error.code, message: result.error.message };
}

/** Both hands back into the decks and every Prize swapped for deck filler, so each named card is
    findable by `lay` (D602's `p1Turn`). */
function reset(state: GameState): GameState {
  let next = state;
  for (const s of ["p1", "p2"] as const) {
    const side = next.players[s];
    let deck = [...side.deck, ...side.hand];
    const filler = (u: string) => [FREE, BASIC].includes(next.cardIdByUid[u] as string);
    const prizes = side.prizes.map((u) => {
      if (filler(u)) return u;
      const swap = deck.find(filler);
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    next = { ...next, players: { ...next.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return next;
}

/** Setup with p2 first, both Actives a Basic from hand; then the clock walks to `seat`'s turn ≥ 3. */
function turnOf(seat: Seat, seed = 6101): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === seat && state.turn >= 3) return reset(state);
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** `seat`'s board: `active` and `bench`, from the deck. */
function lay(state: GameState, seat: Seat, active: string, bench: readonly string[]): GameState {
  let next = clearBench(setActiveFromDeck(state, seat, active), seat);
  for (const id of bench) next = benchFromDeck(next, seat, id);
  return next;
}

const ACTIVE = { spot: "active" } as const;
const benchAt = (index: number) => ({ spot: "bench", index }) as const;
const use = (
  state: GameState,
  abilityName: string,
  target: typeof ACTIVE | ReturnType<typeof benchAt>,
) =>
  applyAction(deepFreeze(state), {
    type: "useAbility",
    seat: "p1",
    target,
    abilityName,
  } as GameAction);
const retreat = (state: GameState, seat: Seat) =>
  applyAction(deepFreeze(state), {
    type: "retreat",
    seat,
    discardEnergy: [],
    promoteBenchIndex: 0,
  });
function playTrainer(state: GameState, seat: Seat, cardId: string) {
  const withCard = handFromDeck(state, seat, cardId, 1);
  return applyAction(deepFreeze(withCard), {
    type: "playTrainer",
    seat,
    uid: handUid(withCard, seat, cardId),
  });
}
function movePrompt(state: GameState): {
  movable: { uid: string; from: PokemonRef }[];
  destinations: PokemonRef[];
  max: number;
  note?: string;
  anySource?: true;
} {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "moveEnergy")
    throw new Error(`expected a moveEnergy park, got ${state.phase.kind}`);
  return state.phase.prompt as unknown as ReturnType<typeof movePrompt>;
}
const answer = (state: GameState, picks: { uid: string; dest: PokemonRef }[]) =>
  applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "moveEnergy", picks },
  } as GameAction);
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const top = (p: InPlayPokemon | null | undefined) => p?.stack.at(-1);
const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const p1Bench = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

describe("D610 §1 — the programs: seven objects over 16 printings", () => {
  const ability = (id: string) => programFor(id)?.abilities?.[0];
  const trigger = (id: string) => programFor(id)?.triggered?.[0];

  it("each family is ONE object under the printed name, on every one of its ids", () => {
    const families: readonly (readonly [readonly string[], string])[] = [
      [VENUSAUR, "abilities"],
      [[AZUMARILL], "abilities"],
      [COBALION, "abilities"],
      [MISMAGIUS, "triggered"],
      [DUGTRIO, "triggered"],
      [EXEGGUTOR, "passive"],
      [TYRANTRUM, "passive"],
    ];
    expect(families.flatMap(([ids]) => ids)).toHaveLength(16);
    for (const [ids, key] of families)
      for (const id of ids) {
        expect(Object.keys(programFor(id) ?? {}), id).toEqual([key]);
        expect(programFor(id), id).toBe(programFor(ids[0] as string));
      }
    expect(new Set(families.map(([ids]) => programFor(ids[0] as string))).size).toBe(7);
  });

  it("the two as-often movers and Metal Road", () => {
    expect(ability(VENUSAUR[0])).toEqual({
      name: "Solar Transfer",
      oncePerTurn: false,
      activeOnly: false,
      program: [{ op: "moveEnergy", filter: { kind: "basicEnergy", energyType: "Grass" }, max: 1 }],
    });
    expect(ability(AZUMARILL)).toEqual({
      name: "Bubble Gathering",
      oncePerTurn: false,
      activeOnly: false,
      program: [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "othersToSelf" }],
    });
    expect(ability(COBALION[0])).toEqual({
      name: "Metal Road",
      oncePerTurn: true,
      activeOnly: true,
      playableIf: { kind: "yourActivePromotedThisTurn" },
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "providesEnergy", energyType: "Metal" },
          max: "any",
          route: "othersToSelf",
          anySource: true,
        },
      ],
    });
    // Metal Road's frame is Buzzing Boost's (`sv10-003`), the same printed "when this Pokémon moves
    // from your Bench to the Active Spot".
    const buzzing = programFor("sv10-003")?.abilities?.[0];
    expect([buzzing?.oncePerTurn, buzzing?.activeOnly, buzzing?.playableIf]).toEqual([
      true,
      true,
      { kind: "yourActivePromotedThisTurn" },
    ]);
  });

  it("the two watched triggers ride Lava Zone's moment; only Swirling Prose prints the Active-Spot clause", () => {
    const lava = programFor("sv05-029")?.triggered?.[0];
    expect(trigger(MISMAGIUS[0])).toEqual({
      name: "Swirling Prose",
      trigger: "onActiveMovedToBench",
      opponentAction: true,
      activeOnly: true,
      program: [{ op: "applyStatus", target: "defender", status: "confused" }],
    });
    expect(trigger(DUGTRIO[0])).toEqual({
      name: "Holes",
      trigger: "onActiveMovedToBench",
      opponentAction: true,
      program: [{ op: "damageSubject", amount: 20 }],
    });
    expect([lava?.trigger, lava?.opponentAction]).toEqual(["onActiveMovedToBench", true]);
    for (const [id, text] of [
      [MISMAGIUS[0], SWIRLING_PROSE],
      [DUGTRIO[0], HOLES],
    ] as const) {
      expect(trigger(id)?.activeOnly === true, id).toBe(
        text.startsWith("As long as this Pokémon is in the Active Spot"),
      );
      expect(text.includes("you may"), id).toBe(false);
      expect(trigger(id)?.optional, id).toBeUndefined();
    }
  });

  it("the two HP passives: a count threshold and the card class", () => {
    expect(programFor(EXEGGUTOR[0])?.passive).toEqual({
      hpBonus: { amount: 250, requiresEnergyType: "Grass", requiresEnergyCount: 6 },
    });
    expect(programFor(TYRANTRUM[0])?.passive).toEqual({
      hpBonus: { amount: 150, requiresEnergyType: "special" },
    });
  });
});

describe("D610 §2 — Solar Transfer: a Basic {G} Energy between your Pokémon, as often as you like", () => {
  it("offers only Basic {G} (not {R}, not a Special); moves it; and is used again the same turn", () => {
    let state = lay(turnOf("p1"), "p1", VENUSAUR[0], [BASIC, BASIC]);
    state = attachBenchFromDeck(attachBenchFromDeck(state, "p1", 0, G, 2), "p1", 0, R, 1);
    state = attachFromDeck(attachFromDeck(state, "p1", SP, 1), "p1", G, 1);
    const parked = must(use(state, "Solar Transfer", ACTIVE));
    const prompt = movePrompt(parked);
    expect(prompt.note).toBe(
      "Move a Basic Grass Energy from 1 of your Pokémon to another of your Pokémon.",
    );
    expect(
      new Set(
        idsOf(
          parked,
          prompt.movable.map((m) => m.uid),
        ),
      ),
    ).toEqual(new Set([G]));
    expect(prompt.movable).toHaveLength(3);
    const fromBench = prompt.movable.find((m) => m.from.spot.spot === "bench") as { uid: string };
    const once = must(answer(parked, [{ uid: fromBench.uid, dest: p1Bench(1) }]));
    expect(idsOf(once, once.players.p1.bench[1]?.energy ?? [])).toEqual([G]);
    expect(once.allowances.abilitiesUsed).toEqual([]);
    const again = movePrompt(must(use(once, "Solar Transfer", ACTIVE)));
    expect(again.movable).toHaveLength(3);
  });

  it("from the Bench too, and refused when no Basic {G} Energy is in play", () => {
    let state = lay(turnOf("p1"), "p1", BASIC, [VENUSAUR[0]]);
    expect(refusal(use(attachFromDeck(state, "p1", R, 2), "Solar Transfer", benchAt(0))).code).toBe(
      "NO_LEGAL_TARGET",
    );
    state = attachFromDeck(state, "p1", G, 1);
    // The free route offers every own body as a destination (the validator refuses the source itself).
    expect(movePrompt(must(use(state, "Solar Transfer", benchAt(0)))).destinations).toEqual([
      P1_ACTIVE,
      p1Bench(0),
    ]);
  });
});

describe("D610 §3 — Bubble Gathering: an Energy from 1 of your other Pokémon to this Pokémon", () => {
  it("the destination is this body; its own Energy is not offered; one source per answer", () => {
    let state = lay(turnOf("p1"), "p1", BASIC, [AZUMARILL, BASIC]);
    state = attachFromDeck(attachFromDeck(state, "p1", R, 1), "p1", SP, 1);
    state = attachBenchFromDeck(attachBenchFromDeck(state, "p1", 0, G, 1), "p1", 1, M, 1);
    const parked = must(use(state, "Bubble Gathering", benchAt(0)));
    const prompt = movePrompt(parked);
    expect(prompt.note).toBe("Move an Energy from 1 of your other Pokémon to this Pokémon.");
    expect(prompt.destinations).toEqual([p1Bench(0)]);
    expect(
      new Set(
        idsOf(
          parked,
          prompt.movable.map((m) => m.uid),
        ),
      ),
    ).toEqual(new Set([R, SP, M]));
    expect(prompt.anySource).toBeUndefined();
    const fromActive = prompt.movable.find((m) => parked.cardIdByUid[m.uid] === SP) as {
      uid: string;
    };
    const fromBench = prompt.movable.find((m) => parked.cardIdByUid[m.uid] === M) as {
      uid: string;
    };
    expect(prompt.max).toBe(1);
    expect(
      answer(parked, [
        { uid: fromActive.uid, dest: p1Bench(0) },
        { uid: fromBench.uid, dest: p1Bench(0) },
      ]).ok,
    ).toBe(false);
    const done = must(answer(parked, [{ uid: fromActive.uid, dest: p1Bench(0) }]));
    expect(idsOf(done, done.players.p1.bench[0]?.energy ?? [])).toEqual([G, SP]);
    // As often as you like: a second use the same turn parks again.
    expect(movePrompt(must(use(done, "Bubble Gathering", benchAt(0)))).movable).toHaveLength(2);
  });
});

describe("D610 §4 — Metal Road: after moving up from the Bench, any {M} Energy from your other Pokémon", () => {
  /** p1 retreats a retreat-0 Active into Cobalion ex; two benched bodies carry {M}, {G} and {M}. */
  function promoted(): GameState {
    let state = lay(turnOf("p1"), "p1", FREE, [COBALION[0], BASIC, BASIC]);
    state = attachBenchFromDeck(attachBenchFromDeck(state, "p1", 1, M, 1), "p1", 1, G, 1);
    state = attachBenchFromDeck(state, "p1", 2, M, 1);
    return must(retreat(state, "p1"));
  }

  it("moves any amount of {M} (only {M}) from several bodies onto Cobalion; once per turn", () => {
    const state = promoted();
    expect(
      state.players.p1.active !== null && state.cardIdByUid[top(state.players.p1.active) ?? ""],
    ).toBe(COBALION[0]);
    const parked = must(use(state, "Metal Road", ACTIVE));
    const prompt = movePrompt(parked);
    expect(prompt.note).toBe(
      "Move any amount of Metal Energy from your other Pokémon to this Pokémon.",
    );
    expect(prompt.destinations).toEqual([P1_ACTIVE]);
    expect(prompt.anySource).toBe(true);
    expect(
      idsOf(
        parked,
        prompt.movable.map((m) => m.uid),
      ),
    ).toEqual([M, M]);
    const done = must(
      answer(
        parked,
        prompt.movable.map((m) => ({ uid: m.uid, dest: P1_ACTIVE })),
      ),
    );
    expect(idsOf(done, done.players.p1.active?.energy ?? [])).toEqual([M, M]);
    expect(refusal(use(done, "Metal Road", ACTIVE)).code).toBe("ABILITY_ALREADY_USED");
  });

  it("refused for a Cobalion that did not move up this turn, and on the Bench", () => {
    let state = lay(turnOf("p1"), "p1", COBALION[0], [BASIC]);
    state = attachBenchFromDeck(state, "p1", 0, M, 1);
    const still = refusal(use(state, "Metal Road", ACTIVE));
    expect(still.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(still.message).toContain("moved from your Bench to the Active Spot this turn");
    // The Active DID move up this turn, but it is a BASIC; Cobalion is on the Bench.
    let other = lay(turnOf("p1"), "p1", FREE, [BASIC, COBALION[0]]);
    other = attachBenchFromDeck(other, "p1", 0, M, 1);
    other = must(retreat(other, "p1"));
    const at = other.players.p1.bench.findIndex(
      (b) => other.cardIdByUid[top(b) ?? ""] === COBALION[0],
    );
    expect(refusal(use(other, "Metal Road", benchAt(at))).code).toBe("ABILITY_ACTIVE_ONLY");
  });

  it("🛑 R-MR1 (UNRULED): the moment is read as a use-time gate — {M} attached to the Bench AFTER the move is swept up too", () => {
    // The print allows the use only when Cobalion moves up (2 {M} on the Bench then). The gate is
    // re-checked at use time, so a later attach from hand onto a Benched Pokémon rides the sweep:
    // the reading AFFORDS here (it does not only refuse, as Buzzing Boost's doc once claimed).
    let state = promoted();
    state = handFromDeck(state, "p1", M, 1);
    state = must(
      applyAction(deepFreeze(state), {
        type: "attachEnergy",
        seat: "p1",
        uid: handUid(state, "p1", M),
        target: benchAt(0),
      } as GameAction),
    );
    const parked = must(use(state, "Metal Road", ACTIVE));
    const prompt = movePrompt(parked);
    expect(idsOf(parked, prompt.movable.map((m) => m.uid))).toEqual([M, M, M]);
    const done = must(
      answer(
        parked,
        prompt.movable.map((m) => ({ uid: m.uid, dest: P1_ACTIVE })),
      ),
    );
    expect(idsOf(done, done.players.p1.active?.energy ?? [])).toEqual([M, M, M]);
  });
});

/** p1 holds `watcher` (Active) and `benched`; p2 holds a retreat-0 Active and exactly one benched
    BASIC (a Switch or a Boss's Orders over one body never parks). */
function watched(seat: Seat, watcher: string, benched: readonly string[]): GameState {
  return lay(lay(turnOf(seat), "p1", watcher, [BASIC, ...benched]), "p2", FREE, [BASIC]);
}
const rotation = (state: GameState, seat: Seat) => state.players[seat].active?.conditions.rotation;
/** `seat`'s Active with `damage` on it. */
function hurt(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...(side.active as InPlayPokemon), damage } },
    },
  };
}

describe("D610 §5 — Swirling Prose: the opponent's new Active is Confused, while Mismagius is Active", () => {
  it("p2 retreats on p2's turn: p2's new Active is Confused, the body that moved is not", () => {
    const after = must(retreat(watched("p2", MISMAGIUS[0], []), "p2"));
    expect(after.cardIdByUid[top(after.players.p2.active) ?? ""]).toBe(BASIC);
    expect(rotation(after, "p2")).toBe("confused");
    expect(after.players.p2.bench.map((b) => b.conditions.rotation)).toEqual(["none"]);
  });

  it("a Switch moves it too (the second mover)", () => {
    const after = must(playTrainer(watched("p2", MISMAGIUS[0], []), "p2", SWITCH));
    expect(rotation(after, "p2")).toBe("confused");
  });

  it("silent with Mismagius on the Bench, and on a Boss's Orders during p1's own turn", () => {
    const benched = must(retreat(watched("p2", BASIC, [MISMAGIUS[0]]), "p2"));
    expect(rotation(benched, "p2")).toBe("none");
    const gusted = must(playTrainer(watched("p1", MISMAGIUS[0], []), "p1", BOSS));
    expect(gusted.cardIdByUid[top(gusted.players.p2.active) ?? ""]).toBe(BASIC);
    expect(rotation(gusted, "p2")).toBe("none");
  });
});

describe("D610 §6 — Holes: 2 damage counters on the opponent's Active that moved to the Bench", () => {
  it("p2 retreats: the body that moved takes 20, from Dugtrio on the Bench; the new Active takes none", () => {
    const before = watched("p2", BASIC, [DUGTRIO[0]]);
    const moved = top(before.players.p2.active);
    const after = must(retreat(before, "p2"));
    const benched = after.players.p2.bench.find((b) => top(b) === moved);
    expect(benched?.damage).toBe(20);
    expect(after.players.p2.active?.damage).toBe(0);
  });

  it("silent on a Boss's Orders during p1's own turn", () => {
    const gusted = must(playTrainer(watched("p1", BASIC, [DUGTRIO[0]]), "p1", BOSS));
    expect(gusted.players.p2.bench.map((b) => b.damage)).toEqual([0]);
  });

  it("two Dugtrio place 4 (no \"doesn't stack\" is printed); lethal counters Knock the body Out for p1's Prize", () => {
    const two = must(retreat(watched("p2", DUGTRIO[0], [DUGTRIO[0]]), "p2"));
    expect(two.players.p2.bench.map((b) => b.damage)).toEqual([40]);
    // fix-basic-0 has 60 HP: 40 damage + 20 is lethal.
    const after = must(retreat(hurt(watched("p2", BASIC, [DUGTRIO[0]]), "p2", 40), "p2"));
    expect(after.phase.kind).toBe("ko:takePrizes");
    expect(after.phase.kind === "ko:takePrizes" && after.phase.seat).toBe("p1");
  });

  it("a Switch moves it too (`switchInto`, the second mover): the counters go on the body that MOVED, and lethal ones Knock it Out", () => {
    const before = watched("p2", BASIC, [DUGTRIO[0]]);
    const moved = top(before.players.p2.active);
    const promotedUid = top(before.players.p2.bench[0]);
    const after = must(playTrainer(before, "p2", SWITCH));
    expect(top(after.players.p2.active)).toBe(promotedUid);
    expect(after.players.p2.active?.damage).toBe(0);
    expect(after.players.p2.bench.map((b) => [top(b), b.damage])).toEqual([[moved, 20]]);
    const lethal = must(
      playTrainer(hurt(watched("p2", BASIC, [DUGTRIO[0]]), "p2", 40), "p2", SWITCH),
    );
    expect(lethal.phase.kind).toBe("ko:takePrizes");
    expect(lethal.phase.kind === "ko:takePrizes" && lethal.phase.seat).toBe("p1");
  });

  it("🛑 R-HL1 (UNRULED): Holes resolves BEFORE Palafin's Zero to Hero, with no Knock Out check between them (🆕🆕🆕 D625: this inverts D356's turn-player-first order; the reversal is D356's)", () => {
    // [🆕🆕🆕 D625 (D610 MINOR 2): R-HL1 INVERTS D356's principle (turn.ts, Magearna "Auto Heal": the turn player's own effects resolve first when two triggers answer one moment), and its listed reversal "Zero to Hero first" IS D356's order. The departure is the reading because under D356's order Holes' subject has already gone to the deck and Holes does nothing; still UNRULED.]
    // p2's Palafin (100 HP) has 80 damage and retreats (one Energy pays the cost). Holes makes it
    // 100 — lethal on Palafin — and then Zero to Hero swaps Palafin ex (340 HP) in, the damage riding
    // along: no Knock Out and no Prize. The control without a Palafin ex in the deck (R-ZH2: the
    // search fails) shows the same counters Knock Palafin Out.
    const board = (withEx: boolean): GameState => {
      let state = lay(lay(turnOf("p2"), "p1", BASIC, [DUGTRIO[0]]), "p2", PALAFIN, [BASIC]);
      state = hurt(attachFromDeck(state, "p2", R, 1), "p2", 80);
      if (withEx) return state;
      const side = state.players.p2;
      const ex = side.deck.find((u) => state.cardIdByUid[u] === PALAFIN_EX) as string;
      return {
        ...state,
        players: {
          ...state.players,
          p2: { ...side, deck: side.deck.filter((u) => u !== ex), discard: [...side.discard, ex] },
        },
      };
    };
    const go = (state: GameState) =>
      must(
        applyAction(deepFreeze(state), {
          type: "retreat",
          seat: "p2",
          discardEnergy: [...(state.players.p2.active?.energy ?? [])],
          promoteBenchIndex: 0,
        }),
      );
    const swapped = go(board(true));
    expect(swapped.phase.kind).toBe("turn:action");
    expect(
      swapped.players.p2.bench.map((b) => [swapped.cardIdByUid[top(b) ?? ""], b.damage]),
    ).toEqual([[PALAFIN_EX, 100]]);
    expect(swapped.players.p1.prizes).toHaveLength(6);
    const knocked = go(board(false));
    expect(knocked.phase.kind).toBe("ko:takePrizes");
    expect(knocked.phase.kind === "ko:takePrizes" && knocked.phase.seat).toBe("p1");
  });
});

describe("D610 §7 — Scale Up: 6 or more {G} Energy attached, +250 HP", () => {
  it("150 at five {G}, 400 at six; {R} Energy does not count; the `30th` 'Grass Energy' face is the same object", () => {
    for (const id of [EXEGGUTOR[0], EXEGGUTOR[1]]) {
      let state = lay(turnOf("p1"), "p1", id, []);
      state = attachFromDeck(attachFromDeck(state, "p1", G, 5), "p1", R, 2);
      expect(effectiveMaxHp(state, state.players.p1.active as InPlayPokemon), id).toBe(150);
      state = attachFromDeck(state, "p1", G, 1);
      expect(effectiveMaxHp(state, state.players.p1.active as InPlayPokemon), id).toBe(400);
    }
  });
});

describe("D610 §8 — Tyrannically Gutsy: any Special Energy attached, +150 HP", () => {
  it("180 with Basic Energy only, 330 with one Special Energy, on the Bench too", () => {
    let state = lay(turnOf("p1"), "p1", BASIC, [TYRANTRUM[0]]);
    state = attachBenchFromDeck(state, "p1", 0, G, 2);
    expect(effectiveMaxHp(state, state.players.p1.bench[0] as InPlayPokemon)).toBe(180);
    state = attachBenchFromDeck(state, "p1", 0, SP, 1);
    expect(effectiveMaxHp(state, state.players.p1.bench[0] as InPlayPokemon)).toBe(330);
    // The damage it now survives, through a real Knock Out check (the end-of-turn sweep): 200 on the
    // 330 body stays in play; the same 200 with the Special Energy gone (180) is a Knock Out for p2.
    const damaged = setBenchDamage(state, "p1", 0, 200);
    const survives = must(applyAction(deepFreeze(damaged), { type: "endTurn", seat: "p1" }));
    expect(
      survives.players.p1.bench.map((b) => [survives.cardIdByUid[top(b) ?? ""], b.damage]),
    ).toEqual([[TYRANTRUM[0], 200]]);
    const bare = {
      ...damaged,
      players: {
        ...damaged.players,
        p1: {
          ...damaged.players.p1,
          bench: damaged.players.p1.bench.map((b, i) =>
            i === 0 ? { ...b, energy: b.energy.filter((u) => damaged.cardIdByUid[u] !== SP) } : b,
          ),
        },
      },
    };
    const knocked = must(applyAction(deepFreeze(bare), { type: "endTurn", seat: "p1" }));
    expect(knocked.phase.kind).toBe("ko:takePrizes");
    expect(knocked.phase.kind === "ko:takePrizes" && knocked.phase.seat).toBe("p2");
  });
});

describe("D610 §9 — what WP37 leaves, and the version", () => {
  it("the dropped and out-of-scope texts stay unkeyed (Meowth ex keeps only its attack key) (🆕🆕🆕 D628 (D539): WITHDRAWN for Meowth ex — \"Last-Ditch Catch\" is keyed since D628; Clawitzer stays dropped) (🆕🆕🆕 D631 (D539): WITHDRAWN for Kingambit, Garbodor, Decidueye ex ×2, Bastiodon ×3 and Yveltal — keyed since D631) (🆕🆕🆕 D636 (D539): WITHDRAWN for Clawitzer — keyed since D636)", () => {
    // 🆕🆕🆕 D636 (D539) — Clawitzer ×2 is keyed at D636 (L1 + Clawitzer, `nextTurnLocksD636.test.ts`).
    for (const id of [
      ...["me01-038", "me01-141"], // Clawitzer "Fall Back to Reload"
    ])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    // 🆕🆕🆕 D631 (D539) — the WP37 rest is keyed at D631 (P1, `passiveRestMeD631.test.ts`).
    for (const id of [
      "me02.5-148", // Kingambit "Supreme Overlord"
      "me04-057", // Garbodor "Gloomy Garbage"
      ...["me03-012", "me03-100"], // Decidueye ex "Sniper's Eye"
      ...["mep-085", "me05-062", "me05-093"], // Bastiodon "Ancient Bulwark"
      "30th-100", // Yveltal "Life-Locked"
    ])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    // 🆕🆕🆕 D614 (D539) — Mega Clefable ex ×4 "Luminous Wing" (WP37b) left this list: keyed at D614
    // (`abilityShieldMeD614.test.ts`).
    for (const id of ["mep-072", "me03-031", "me03-103", "me03-119"])
      expect(programFor(id)?.passive, id).toEqual({ preventAbilityEffects: true });
    // 🆕🆕🆕 D628 — Meowth ex ×3 carry "Last-Ditch Catch" (onBenchMoveMeD628.test.ts §2).
    for (const id of ["me03-062", "me03-107", "me03-121"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["attack", "triggered"]);
  });

  it("is built at engine 0.540.0", () => {
    expect(engineVersion).toBe("0.540.0");
  });
});
