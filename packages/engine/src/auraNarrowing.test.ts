import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { seatPreWRDamageBonus } from "./continuous";
import type { CardFilter } from "./effects";
import type { GameState } from "./index";
import { programFor } from "./index";
import {
  AURA_NARROWING_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const SUNNY_DAY_TEXT =
  "Attacks used by your {G} Pokémon and {R} Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const VICTORY_CHEER_TEXT =
  "Attacks used by your Evolution {R} Pokémon do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const PRIMAL_KNOWLEDGE_TEXT =
  "Attacks used by your Pokémon do 30 more damage to your opponent's Active Evolution Pokémon (before applying Weakness and Resistance).";
const METALLIC_SIGNAL_TEXT =
  "Once during your turn, you may search your deck for up to 2 Evolution {M} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";

const SEED = 43;

/** Setup on P1's turn 3 (two passes past the §4 first-turn ban), both benches
    emptied and both Active spots normalised to the inert `fix-basic-1`, so every
    board below is exactly what its own surgeries put on it. */
function board(): GameState {
  let state = driveSetup(
    SEED,
    { p1: AURA_NARROWING_DECK, p2: AURA_NARROWING_DECK },
    { first: "p1" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", "fix-basic-1"), "p1");
  return clearBench(setActiveFromDeck(state, "p2", "fix-basic-1"), "p2");
}

/** P1 attacks with `attacker`; `benched` aura sources sit on P1's Bench beside it.
    `defender` is P2's Active. One Energy attached — every attack here costs one. */
function attacking(attacker: string, defender: string, ...benched: string[]): GameState {
  let state = clearBench(setActiveFromDeck(board(), "p2", defender), "p2");
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const id of benched) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The damage P1's Active actually deals, off a real declaration. Every attacker
    in this cast prints a base of 50, so the delta from 50 IS the aura. */
function dealt(state: GameState): number | undefined {
  const hit = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  return findEvent(hit.events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SIX REGISTRY ROWS — four programs, three narrowings, one search.
// ─────────────────────────────────────────────────────────────────────────────

describe("D245 — the six registry rows", () => {
  it("authors `sv09-007` as a DISJUNCTION beneficiary and nothing else", () => {
    const program = programFor("sv09-007");
    expect(program?.passive).toEqual({
      seatDamageBonusBeforeWR: {
        amount: 20,
        beneficiary: {
          kind: "anyOf",
          filters: [
            { kind: "typedPokemon", pokemonType: "Grass" },
            { kind: "typedPokemon", pokemonType: "Fire" },
          ],
        },
      },
    });
    expect(program?.passive?.damageBonusBeforeWR).toBeUndefined();
    expect(program?.passive?.seatDamageBonusBeforeWR?.target).toBeUndefined();
  });

  it('authors `sv08-021` at `typedPokemon.stage: "evolution"`', () => {
    expect(programFor("sv08-021")?.passive?.seatDamageBonusBeforeWR).toEqual({
      amount: 10,
      beneficiary: { kind: "typedPokemon", pokemonType: "Fire", stage: "evolution" },
    });
  });

  it("authors `sv07-038` on the TARGET side — the seam the row got wrong", () => {
    const aura = programFor("sv07-038")?.passive?.seatDamageBonusBeforeWR;
    expect(aura).toEqual({ amount: 30, target: { kind: "evolutionPokemon" } });
    expect(programFor("sv07-038")?.passive?.damageBonusBeforeWRIfTarget).toBeUndefined();
    // …and `beneficiary` is ABSENT, not a redundant `anyPokemon`: the printed
    // subject really is "your Pokémon", i.e. no narrowing at all on that end.
    expect(aura?.beneficiary).toBeUndefined();
  });

  it("authors all THREE `sv10.5b` Genesect printings — the sentence no backlog row names", () => {
    for (const id of ["sv10.5b-067", "sv10.5b-161", "sv10.5b-169"]) {
      expect(programFor(id)?.abilities, id).toEqual([
        {
          name: "Metallic Signal",
          oncePerTurn: true,
          activeOnly: false,
          program: [
            {
              op: "searchDeck",
              filter: { kind: "typedPokemon", pokemonType: "Metal", stage: "evolution" },
              dest: "hand",
              max: 2,
              reveal: true,
            },
            { op: "shuffleDeck" },
          ],
        },
      ]);
    }
  });

  it("the six are SIX, and the FIVE printings the family still cannot reach are named", () => {
    const shipped = [
      "sv09-007",
      "sv08-021",
      "sv07-038",
      "sv10.5b-067",
      "sv10.5b-161",
      "sv10.5b-169",
    ];
    expect(new Set(shipped).size).toBe(6);
    for (const id of shipped) expect(programFor(id), id).toBeDefined();
    for (const id of ["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"]) {
      expect(programFor(id)?.passive?.seatDamageBonusBeforeWR, id).toEqual({
        amount: 20,
        beneficiary: { kind: "bannerPokemon", banner: "Future" },
        exceptName: "Iron Crown ex",
      });
    }
  });

  it("the fixture demonstrators carry the printed bytes VERBATIM", () => {
    expect(FIXTURE_POOL["fix-sunnyday"]?.abilities?.[0]?.effect).toBe(SUNNY_DAY_TEXT);
    expect(FIXTURE_POOL["fix-victorycheer"]?.abilities?.[0]?.effect).toBe(VICTORY_CHEER_TEXT);
    expect(FIXTURE_POOL["fix-primalknowledge"]?.abilities?.[0]?.effect).toBe(PRIMAL_KNOWLEDGE_TEXT);
    expect(programFor("fix-sunnyday")).toBe(programFor("sv09-007"));
    expect(programFor("fix-victorycheer")).toBe(programFor("sv08-021"));
    expect(programFor("fix-primalknowledge")).toBe(programFor("sv07-038"));
    expect(FIXTURE_POOL["fix-metallicsignal"]?.abilities?.[0]?.effect).toBe(METALLIC_SIGNAL_TEXT);
    expect(programFor("fix-metallicsignal")).toBe(programFor("sv10.5b-067"));
  });
});

describe("D245 — the search prompt reads the printed STAGE WORD", () => {
  it("captions the offer with the PRINTED stage, not with `basicPokemon`'s", () => {
    const state = clearBench(setActiveFromDeck(board(), "p1", "fix-metallicsignal"), "p1");
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Metallic Signal",
    });
    const phase = parked.phase;
    if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
      throw new Error(`expected a chooseCards park, got ${phase.kind}`);
    }
    expect(phase.prompt.note).toBe(
      "Search your deck for up to 2 Evolution Metal Pokémon into your hand.",
    );
    expect(phase.prompt.candidates.length).toBeGreaterThan(0);
    const offered = new Set(phase.prompt.candidates.map((uid) => parked.cardIdByUid[uid]));
    expect([...offered]).toEqual(["fix-metal-stage1"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. `anyOf` — the union's first COMBINATOR, at `matchesFilter`.
// ─────────────────────────────────────────────────────────────────────────────

describe("D245 — `CardFilter.anyOf`", () => {
  const GRASS_OR_FIRE: CardFilter = {
    kind: "anyOf",
    filters: [
      { kind: "typedPokemon", pokemonType: "Grass" },
      { kind: "typedPokemon", pokemonType: "Fire" },
    ],
  };

  it("admits a body in EITHER arm — the printed 'and' is a UNION", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-grass-attacker"], GRASS_OR_FIRE)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], GRASS_OR_FIRE)).toBe(true);
  });

  it("REFUSES a body in neither arm — it is not `anyPokemon` in disguise", () => {
    // `fix-plain-body` is printed Colorless. Without this the combinator would be
    // indistinguishable from a filter that admits every Pokémon.
    expect(matchesFilter(FIXTURE_POOL["fix-plain-body"], GRASS_OR_FIRE)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-plain-body"], { kind: "anyPokemon" })).toBe(true);
  });

  it("RECURSES — an arm may itself carry a rider, and the rider is honoured", () => {
    const evolutionFireOrGrass: CardFilter = {
      kind: "anyOf",
      filters: [
        { kind: "typedPokemon", pokemonType: "Fire", stage: "evolution" },
        { kind: "typedPokemon", pokemonType: "Grass", stage: "evolution" },
      ],
    };
    expect(matchesFilter(FIXTURE_POOL["fix-fire-stage1"], evolutionFireOrGrass)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-grass-stage1"], evolutionFireOrGrass)).toBe(true);
    // The BASIC {R} body is in the type arm and out of the stage rider, so this is
    // the board that proves the recursion carries the whole inner filter and not
    // just its `kind`.
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], evolutionFireOrGrass)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], GRASS_OR_FIRE)).toBe(true);
  });

  it("an EMPTY list names the EMPTY set, which is what `.some` says", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-grass-attacker"], { kind: "anyOf", filters: [] })).toBe(
      false,
    );
  });

  it("a dangling uid is still FALSE — the top-of-function guard, not the arm", () => {
    expect(matchesFilter(undefined, GRASS_OR_FIRE)).toBe(false);
  });
});

describe('D245 — `typedPokemon.stage` admits `"evolution"`', () => {
  const EVOLUTION_FIRE: CardFilter = {
    kind: "typedPokemon",
    pokemonType: "Fire",
    stage: "evolution",
  };
  const BASIC_FIRE: CardFilter = { kind: "typedPokemon", pokemonType: "Fire", stage: "basic" };
  const ANY_FIRE: CardFilter = { kind: "typedPokemon", pokemonType: "Fire" };

  it("the three readings are THREE DIFFERENT SETS on one pair of bodies", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-fire-stage1"], EVOLUTION_FIRE)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], EVOLUTION_FIRE)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-fire-stage1"], BASIC_FIRE)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], BASIC_FIRE)).toBe(true);
    // …and the unmarked filter admits both, which is what makes the rider a rider.
    expect(matchesFilter(FIXTURE_POOL["fix-fire-stage1"], ANY_FIRE)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], ANY_FIRE)).toBe(true);
  });

  it("the TYPE conjunct still binds — an Evolution of the wrong type is refused", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-grass-stage1"], EVOLUTION_FIRE)).toBe(false);
    expect(
      matchesFilter(FIXTURE_POOL["fix-grass-stage1"], {
        kind: "typedPokemon",
        pokemonType: "Grass",
        stage: "evolution",
      }),
    ).toBe(true);
  });

  it("the TWO STAGE RIDERS now AGREE, which is what the row asked to be checked", () => {
    for (const id of ["fix-fire-stage1", "fix-victorycheer", "fix-grass-stage1", "fix-basic-1"]) {
      const card = FIXTURE_POOL[id];
      const isEvolution = card?.evolveFrom !== undefined && card.evolveFrom !== null;
      expect(matchesFilter(card, { kind: "evolutionPokemon" }), id).toBe(isEvolution);
      // The typed rider agrees with the bare `evolutionPokemon` member wherever the
      // type matches — the same "agree by construction" claim `ownerPokemon`'s
      // doc-comment already makes for its own stage word.
      const typed: CardFilter = {
        kind: "typedPokemon",
        pokemonType: (card?.types?.[0] ?? "Colorless") as never,
        stage: "evolution",
      };
      expect(matchesFilter(card, typed), id).toBe(isEvolution);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE SCAN AND THE DAMAGE — all three narrowings on a real declaration.
// ─────────────────────────────────────────────────────────────────────────────

describe("D245 — the three narrowings on a real board", () => {
  it("SUNNY DAY pays a {G} attacker and a {R} attacker, and no one else", () => {
    expect(dealt(attacking("fix-grass-attacker", "fix-basic-1", "fix-sunnyday"))).toBe(70);
    expect(dealt(attacking("fix-victorycheer", "fix-basic-1", "fix-sunnyday"))).toBe(70);
    expect(dealt(attacking("fix-plain-body", "fix-basic-1", "fix-sunnyday"))).toBe(50);
  });

  it("SUNNY DAY's filter is matched against the ATTACKER, never the SOURCE", () => {
    expect(
      matchesFilter(FIXTURE_POOL["fix-sunnyday"], { kind: "typedPokemon", pokemonType: "Grass" }),
    ).toBe(true);
    expect(
      seatPreWRDamageBonus(
        attacking("fix-plain-body", "fix-basic-1", "fix-sunnyday"),
        "p1",
        FIXTURE_POOL["fix-plain-body"],
      ),
    ).toBe(0);
  });

  it("VICTORY CHEER's source is OUTSIDE its own beneficiary set", () => {
    // The board no other aura in the family can build: Victini is a BASIC {R}
    // body and its own filter says "Evolution {R}". A build that let the source
    // pay itself reads 60 here.
    const selfOnly = attacking("fix-victorycheer", "fix-basic-1");
    expect(dealt(selfOnly)).toBe(50);
    // …while a benched Victini pays an EVOLUTION {R} attacker.
    expect(dealt(attacking("fix-fire-stage1", "fix-basic-1", "fix-victorycheer"))).toBe(60);
    // …and refuses a BASIC {R} one, which is `stage: "evolution"` doing the work
    // at the damage seam rather than only at `matchesFilter`.
    expect(dealt(attacking("fix-victorycheer", "fix-basic-1", "fix-victorycheer"))).toBe(50);
  });

  it("PRIMAL KNOWLEDGE reads the DEFENDER, and the two riders are independent", () => {
    // An EVOLUTION defender takes the 30; a BASIC one does not. The attacker is
    // the same Colorless body on both boards, which is what makes this a target
    // read and not a beneficiary one.
    expect(dealt(attacking("fix-plain-body", "fix-grass-stage1", "fix-primalknowledge"))).toBe(80);
    expect(dealt(attacking("fix-plain-body", "fix-basic-1", "fix-primalknowledge"))).toBe(50);
    const crossed = attacking("fix-plain-body", "fix-grass-stage1", "fix-primalknowledge");
    expect(
      seatPreWRDamageBonus(
        crossed,
        "p1",
        FIXTURE_POOL["fix-plain-body"],
        FIXTURE_POOL["fix-grass-stage1"],
      ),
    ).toBe(30);
    // …and with the defender withheld the aura fails CLOSED, which is
    // `beneficiary`'s conservative direction applied to the other end.
    expect(seatPreWRDamageBonus(crossed, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
  });

  it("the THREE auras STACK, because three printed Abilities are three effects", () => {
    // An Evolution {R} attacker into an Evolution defender, under all three: the
    // disjunction (20, {R} is an arm), the stage filter (10, it is an Evolution
    // {R}) and the target filter (30, the defender is an Evolution) = 110.
    const all = attacking(
      "fix-fire-stage1",
      "fix-grass-stage1",
      "fix-sunnyday",
      "fix-victorycheer",
      "fix-primalknowledge",
    );
    expect(dealt(all)).toBe(50 + 20 + 10 + 30);
  });

  it("is SEAT-RELATIVE — the opponent's narrowed aura never pays you", () => {
    let state = attacking("fix-grass-attacker", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-sunnyday");
    expect(
      seatPreWRDamageBonus(
        state,
        "p1",
        FIXTURE_POOL["fix-grass-attacker"],
        FIXTURE_POOL["fix-basic-1"],
      ),
    ).toBe(0);
    expect(
      seatPreWRDamageBonus(
        state,
        "p2",
        FIXTURE_POOL["fix-grass-attacker"],
        FIXTURE_POOL["fix-basic-1"],
      ),
    ).toBe(20);
  });

  it("§9 — a locked source pays nothing, on all three narrowings", () => {
    const locked = attacking("fix-fire-stage1", "sv01-096", "fix-sunnyday", "fix-victorycheer");
    expect(
      seatPreWRDamageBonus(locked, "p1", FIXTURE_POOL["fix-fire-stage1"], FIXTURE_POOL["sv01-096"]),
    ).toBe(0);
    const lifted = attacking("fix-fire-stage1", "fix-basic-1", "fix-sunnyday", "fix-victorycheer");
    expect(dealt(lifted)).toBe(80);
  });
});
