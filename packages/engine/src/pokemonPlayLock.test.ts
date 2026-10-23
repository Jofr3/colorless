import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  deriveAttackEffect,
  handPlayBarred,
  pokemonPlayBarred,
  programFor,
} from "./index";
import type { GameState, Seat } from "./index";
import {
  completeSetup,
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  must,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows.
// ─────────────────────────────────────────────────────────────────────────────

const JAMMER_TEXT =
  "During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon.";
const POTENT_GLARE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Pokémon that has an Ability from their hand, except for Team Rocket's Pokémon.";
const DARKEST_IMPULSE_TEXT =
  "Whenever your opponent plays a Pokémon from their hand to evolve 1 of their Pokémon, put 4 damage counters on that Pokémon. The effect of Darkest Impulse doesn't stack.";

const BRONZONG = "sv05-069";
const ARBOK = "sv10-113";
const AMPHAROS = "sv10-074";
const COPPERAJAH = "sv06.5-042";
const GENESECT = "sv06.5-040";

/** The CONTROL barrier: same board, no Ability, no attack effect. Every "the bar
    bites" line below passes just as happily on a build that refused every play. */
const PLAIN = "fix-plain-jammer";
/** The evolution CONTROL — a Stage 1 with NO Ability, so Arbok's `only` filter is
    what must let it through and not the absence of a bar. */
const EVO_PLAIN = "fix-stage1";
/** A Stage 1 that HAS an Ability — the card Arbok's noun actually names. */
const EVO_ABILITY = "fix-evo-ability";
/** A Stage 1 that has an Ability AND the owner prefix — the body the printed
    EXCEPTION exempts, and the one an `&&` reading refuses. */
const EVO_ROCKET = "fix-evo-rocket";
/** A Basic with an Ability — the §7.5 half, which only the CONTINUOUS source
    reaches. Named `fix-basic-1`-compatibly so it can be benched from the deck. */
const BASIC_ABILITY = "fix-basic-ability";
/** The Basic CONTROL, straight out of the shared pool. */
const BASIC_PLAIN = "fix-basic-1";

function bronzong(id: string): Card {
  return battler(id, {
    name: "Bronzong",
    hp: 120,
    retreat: 3,
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Bronzor",
    attacks: [
      { name: "Evolution Jammer", cost: ["Psychic"], damage: "30", effect: JAMMER_TEXT },
      { name: "Super Psy Bolt", cost: ["Psychic", "Colorless", "Colorless"], damage: "100" },
    ],
  });
}

function arbok(id: string): Card {
  return battler(id, {
    name: "Team Rocket's Arbok",
    hp: 120,
    retreat: 2,
    types: ["Darkness"],
    stage: "Stage1",
    evolveFrom: "Team Rocket's Ekans",
    abilities: [{ type: "Ability", name: "Potent Glare", effect: POTENT_GLARE_TEXT }],
  });
}

/** A Stage 1 off the fixture evolution line (`fix-basic-1` → here), with `name`
    and `abilities` as the only things that vary — so the three evolution cards
    below differ in EXACTLY the two fields the printed sentence reads. */
function evolution(id: string, name: string, hasAbility: boolean): Card {
  return battler(id, {
    name,
    hp: 90,
    retreat: 2,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    abilities: hasAbility
      ? [{ type: "Ability", name: "Fixture Sense", effect: "Does nothing." }]
      : null,
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [BRONZONG]: bronzong(BRONZONG),
  [ARBOK]: arbok(ARBOK),
  [EVO_ABILITY]: evolution(EVO_ABILITY, EVO_ABILITY, true),
  [EVO_ROCKET]: evolution(EVO_ROCKET, "Team Rocket's Fixture", true),
  [BASIC_ABILITY]: battler(BASIC_ABILITY, {
    name: BASIC_ABILITY,
    hp: 70,
    retreat: 1,
    abilities: [{ type: "Ability", name: "Fixture Sense", effect: "Does nothing." }],
  }),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Jammer",
    hp: 200,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage1",
    attacks: [{ name: "Nothing At All", cost: ["Psychic"], damage: "30" }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const LOCK_DECK = deckOf({
  [BRONZONG]: 4,
  [ARBOK]: 4,
  [PLAIN]: 4,
  [EVO_PLAIN]: 4,
  [EVO_ABILITY]: 4,
  [EVO_ROCKET]: 4,
  [BASIC_ABILITY]: 4,
  [BASIC_PLAIN]: 8,
  "fix-psychic-energy": 24,
});

const SEEDS = [7201, 7213, 7219, 7229] as const;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: LOCK_DECK, p2: LOCK_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
}

function board(seed: number, first: Seat, barrier: Seat, barrierId: string): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, barrier, barrierId);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, BASIC_PLAIN);
  state = setActiveFromDeck(state, victim, PLAIN);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, BASIC_PLAIN);
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, EVO_PLAIN, 1);
    state = handFromDeck(state, seat, EVO_ABILITY, 1);
    state = handFromDeck(state, seat, EVO_ROCKET, 1);
    state = handFromDeck(state, seat, BASIC_ABILITY, 1);
    state = handFromDeck(state, seat, BASIC_PLAIN, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function swing(state: GameState, seat: Seat, index: number): GameState {
  let next = state;
  const energy = next.players[seat].hand.find((h) => next.cardIdByUid[h] === "fix-psychic-energy");
  if (energy === undefined) throw new Error(`${seat} has no energy in hand`);
  next = must(
    applyAction(next, { type: "attachEnergy", seat, uid: energy, target: { spot: "active" } }),
  );
  return must(applyAction(next, { type: "attack", seat, index }));
}

/** Evolve `seat`'s BENCHED `fix-basic-1` using `cardId` from hand, and report the
    error code or "OK". Every assertion goes through this so a green "the bar
    refuses" line can never be a refusal for the WRONG reason. */
function evolve(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), {
    type: "evolve",
    seat,
    uid,
    target: { spot: "bench", index: 0 },
  });
  return result.ok ? "OK" : result.error.code;
}

/** The §7.5 twin — the read site Bronzong's sentence deliberately cannot reach. */
function bench(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playBasicToBench", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE POPULATION, AND WHAT THIS VOCABULARY REACHES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §1 — the census, and the two printings it reaches", () => {
  it("the fixtures carry the PRINTED sentences byte for byte", () => {
    expect(POOL[BRONZONG]?.attacks?.[0]?.effect).toBe(JAMMER_TEXT);
    expect(POOL[ARBOK]?.abilities?.[0]?.effect).toBe(POTENT_GLARE_TEXT);
    // The two windows are DIFFERENT and that is the whole reason there are two
    // sources: one is turn-scoped, one is a standing board fact.
    expect(JAMMER_TEXT.startsWith("During your opponent's next turn,")).toBe(true);
    expect(POTENT_GLARE_TEXT.startsWith("As long as this Pokémon is in the Active Spot,")).toBe(
      true,
    );
  });

  it("BOTH PRINTINGS ARE BUILT — the family's first EXHAUSTIVE row", () => {
    expect(programFor(BRONZONG)).toBeUndefined();
    expect(deriveAttackEffect(JAMMER_TEXT)).toEqual([{ op: "preventHandPlay", bars: "evolve" }]);
    expect(programFor(ARBOK)?.passive?.preventOpponentPokemonPlay).toEqual({
      acts: ["evolve", "bench"],
      only: { kind: "abilityPokemon" },
      except: { kind: "ownerPokemon", owner: "Team Rocket" },
    });
  });

  it("THE ROWS STILL REFUSED, AND THE NEW ONE THE ACT CENSUS TURNED UP", () => {
    expect(programFor(GENESECT)?.passive?.preventOpponentAceSpecPlayWhileToolAttached).toBe(true);
    expect(programFor(GENESECT)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
    expect(programFor(AMPHAROS)?.triggered?.[0]?.opponentAction).toBe(true);
    expect(programFor(AMPHAROS)?.triggered?.[0]?.trigger).toBe("onEvolve");
    expect(programFor(AMPHAROS)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
    expect(programFor(AMPHAROS)?.passive?.preventOpponentHandPlay).toBeUndefined();
    expect(DARKEST_IMPULSE_TEXT.startsWith("Whenever your opponent plays a Pokémon")).toBe(true);
    expect(DARKEST_IMPULSE_TEXT).toContain("from their hand to evolve");
    expect(programFor(ARBOK)).toBeDefined();
  });

  it("the near-miss strings a looser anchor would have swallowed", () => {
    for (const text of [
      // the same act, the CONTINUOUS window — Arbok's family, not this one
      POTENT_GLARE_TEXT,
      // the same act read as a TRIGGER (Ampharos)
      DARKEST_IMPULSE_TEXT,
      // the rider dropped — a bar on EVERY Pokémon play, which nothing prints
      "During your opponent's next turn, they can't play any Pokémon from their hand.",
      // the act swapped for a class the STAMP can already spell
      "During your opponent's next turn, they can't play any Pokémon cards from their hand.",
      // a trailing rider on a sentence the readers do not own
      `This attack does 30 damage. ${JAMMER_TEXT}`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(deriveAttackEffect(JAMMER_TEXT)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE STAMP — Bronzong writes ONE key and it is an ACT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §2 — GameState.handPlayLockedTurn gains an ACT key", () => {
  it("a fresh game has no lock on either seat, for any of the three keys ( D636 (D539): four — `Stadium`)", () => {
    const created = createGame({
      seed: SEEDS[0],
      decks: { p1: LOCK_DECK, p2: LOCK_DECK },
      cardPool: POOL,
    });
    if (!created.ok) throw new Error("createGame failed");
    expect(created.state.handPlayLockedTurn).toEqual({
      p1: { Item: null, Supporter: null, Stadium: null, evolve: null },
      p2: { Item: null, Supporter: null, Stadium: null, evolve: null },
    });
  });

  for (const first of ["p1", "p2"] as const) {
    it(`Evolution Jammer stamps the OPPONENT's next turn and NOTHING else (first: ${first})`, () => {
      const attacker = first;
      const victim = first === "p1" ? "p2" : "p1";
      const state = swing(
        turnOf(board(SEEDS[0], first, attacker, BRONZONG), attacker),
        attacker,
        0,
      );
      // The stamp names the turn the bar APPLIES to, so the reader is one `===`.
      expect(state.handPlayLockedTurn[victim].evolve).toBe(state.turn);
      expect(state.handPlayLockedTurn[victim].Item).toBeNull();
      expect(state.handPlayLockedTurn[victim].Supporter).toBeNull();
      // The ATTACKER's own record is untouched — "their next turn", not "yours".
      expect(state.handPlayLockedTurn[attacker]).toEqual({
        Item: null,
        Supporter: null,
        Stadium: null,
        evolve: null,
      });
    });
  }

  it("the CONTROL body stamps nothing at all", () => {
    // Same board, same swing, an attack with no effect text. Without this every
    // assertion above is green on a build that stamped on every attack.
    const state = swing(turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1", 0);
    for (const seat of ["p1", "p2"] as const) {
      expect(state.handPlayLockedTurn[seat]).toEqual({
        Item: null,
        Supporter: null,
        Stadium: null,
        evolve: null,
      });
    }
  });

  it("the stamp expires by ARITHMETIC — one turn later it is dead with nobody clearing it", () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(pokemonPlayBarred(stamped, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    // Two turns on, the SAME stored number is in the past and reads as no lock.
    const later = turnOf(must(applyAction(stamped, { type: "endTurn", seat: "p2" })), "p2");
    expect(later.handPlayLockedTurn.p2.evolve).toBe(stamped.turn);
    expect(pokemonPlayBarred(later, "p2", "evolve", POOL[EVO_PLAIN])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE EVOLVE GATE — the read site both sources reach.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §3 — turn.ts's evolve gate", () => {
  it("a Bronzong-stamped seat cannot evolve, and the code is HAND_PLAY_BLOCKED", () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(evolve(stamped, "p2", EVO_PLAIN)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(stamped, "p2", EVO_ABILITY)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(stamped, "p2", EVO_ROCKET)).toBe("HAND_PLAY_BLOCKED");
  });

  it("the CONTROL board evolves fine — the refusal above is the rule and not the board", () => {
    const plain = swing(turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1", 0);
    for (const card of [EVO_PLAIN, EVO_ABILITY, EVO_ROCKET]) {
      expect(evolve(plain, "p2", card), card).toBe("OK");
    }
  });

  it("THE BARRING SEAT'S OWN HAND IS FREE — the perspective, from both sides", () => {
    for (const first of ["p1", "p2"] as const) {
      const attacker = first;
      const victim = first === "p1" ? "p2" : "p1";
      const stamped = swing(
        turnOf(board(SEEDS[1], first, attacker, BRONZONG), attacker),
        attacker,
        0,
      );
      expect(evolve(stamped, victim, EVO_PLAIN)).toBe("HAND_PLAY_BLOCKED");
      // Walk to the attacker's own turn: its record was never stamped, so it
      // evolves. A build that stamped the wrong seat is green on the line above.
      const back = turnOf(must(applyAction(stamped, { type: "endTurn", seat: victim })), attacker);
      expect(evolve(back, attacker, EVO_PLAIN)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE ACT SPLIT — Bronzong does NOT reach a bench placement.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §4 — two acts, and the stamp names exactly one", () => {
  it("A BENCH PLACEMENT LANDS ON A BRONZONG-STAMPED BOARD", () => {
    // THE ASSERTION THAT SEPARATES ONE ACT FROM TWO. Bronzong prints "to evolve
    // their Pokémon"; a build with a single `"pokemon"` member bars a Basic the
    // sentence does not mention, and every evolve assertion above stays green.
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(evolve(stamped, "p2", EVO_PLAIN)).toBe("HAND_PLAY_BLOCKED");
    expect(bench(stamped, "p2", BASIC_PLAIN)).toBe("OK");
    expect(bench(stamped, "p2", BASIC_ABILITY)).toBe("OK");
  });

  it('`"bench"` IS NOT A STAMPABLE KEY — the reader turns it away by the type', () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(pokemonPlayBarred(stamped, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    expect(pokemonPlayBarred(stamped, "p2", "bench", POOL[BASIC_PLAIN])).toBe(false);
    const keys = Object.keys(stamped.handPlayLockedTurn.p2);
    expect(keys.sort()).toEqual(["Item", "Supporter", "Stadium", "evolve"].sort());
  });

  it("the TRAINER surface is untouched by an act stamp, and vice versa", () => {
    // The two vocabularies share a record and must not share an answer.
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(handPlayBarred(stamped, "p2", "Item", undefined)).toBe(false);
    expect(handPlayBarred(stamped, "p2", "Supporter", undefined)).toBe(false);
    expect(handPlayBarred(stamped, "p2", "Tool", undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ARBOK — the continuous source, its filter and its exception.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §5 — the continuous bar, narrowed and then re-widened", () => {
  it("THE NOUN IS NARROWED — an Ability-LESS evolution lands under Potent Glare", () => {
    // The assertion a filter-free build fails. Every other Arbok line in this
    // file uses a card that HAS an Ability, which is the natural fixture.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    expect(evolve(state, "p2", EVO_ABILITY)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(state, "p2", EVO_PLAIN)).toBe("OK");
  });

  it("THE EXCEPTION IS SUBTRACTED AND NOT CONJOINED — Team Rocket's Pokémon land", () => {
    // `EVO_ROCKET` satisfies BOTH printed clauses. An `&&` reading bars it; the
    // printed sentence exempts it.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    expect(evolve(state, "p2", EVO_ROCKET)).toBe("OK");
    // …and the exemption is the OWNER PREFIX rather than "it is the barring
    // player's kind of card": the same body is barred by BRONZONG's stamp, which
    // carries no exception (§3), so the two sources cannot be one predicate.
  });

  it("BOTH ACTS, because this sentence bars the PLAY and not one act of it", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    expect(bench(state, "p2", BASIC_ABILITY)).toBe("HAND_PLAY_BLOCKED");
    expect(bench(state, "p2", BASIC_PLAIN)).toBe("OK");
  });

  it("THE FILTERED NOUN IS THE CARD PLAYED, NOT THE BODY IT LANDS ON", () => {
    // Both crossed boards. The target is always a plain `fix-basic-1`, so a build
    // that filtered the TARGET refuses nothing at all — and one that filtered
    // BOTH is green on the first line and red on nothing.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    expect(POOL[BASIC_PLAIN]?.abilities ?? null).toBeNull();
    expect(evolve(state, "p2", EVO_ABILITY)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(state, "p2", EVO_PLAIN)).toBe("OK");
  });

  it("a BENCHED Arbok bars nothing — the Active-Spot window collapses the scan", () => {
    let state = board(SEEDS[0], "p1", "p1", ARBOK);
    state = setActiveFromDeck(state, "p1", PLAIN);
    state = turnOf(state, "p2");
    expect(evolve(state, "p2", EVO_ABILITY)).toBe("OK");
    expect(bench(state, "p2", BASIC_ABILITY)).toBe("OK");
  });

  for (const first of ["p1", "p2"] as const) {
    it(`the perspective flip, from both seats (first: ${first})`, () => {
      for (const barrier of ["p1", "p2"] as const) {
        const victim = barrier === "p1" ? "p2" : "p1";
        const state = board(SEEDS[2], first, barrier, ARBOK);
        expect(pokemonPlayBarred(state, victim, "evolve", POOL[EVO_ABILITY]), victim).toBe(true);
        // The BARRING seat's own hand is free — "your opponent can't play".
        expect(pokemonPlayBarred(state, barrier, "evolve", POOL[EVO_ABILITY]), barrier).toBe(false);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE VERSION BUMP, DRIVEN — AND ITS DIAGNOSIS IS THE *WEAK* ONE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §6 — MATCH_RECORD_VERSION 15 → 16, driven both directions", () => {
  it('A v15 BAG DOES NOT THROW — IT SILENTLY ANSWERS "no lock", WHICH IS THE POINT', () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(pokemonPlayBarred(stamped, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    const { evolve: _dropped, ...v15 } = stamped.handPlayLockedTurn.p2;
    const old = {
      ...stamped,
      handPlayLockedTurn: {
        ...stamped.handPlayLockedTurn,
        p2: v15 as (typeof stamped)["handPlayLockedTurn"]["p2"],
      },
    };
    // No throw — and the bar is GONE, which is the whole reason the version moves.
    expect(() => pokemonPlayBarred(old, "p2", "evolve", POOL[EVO_PLAIN])).not.toThrow();
    expect(pokemonPlayBarred(old, "p2", "evolve", POOL[EVO_PLAIN])).toBe(false);
    // …and it is observable through `applyAction`, not only through the reader:
    // the same board that refused the evolve now accepts it.
    expect(evolve(stamped, "p2", EVO_PLAIN)).toBe("HAND_PLAY_BLOCKED");
    expect(evolve(old, "p2", EVO_PLAIN)).toBe("OK");
  });

  it("AND THE OTHER DIRECTION — the key IS present on every board this build writes", () => {
    for (const seed of SEEDS) {
      const stamped = swing(turnOf(board(seed, "p1", "p1", BRONZONG), "p1"), "p1", 0);
      const plain = swing(turnOf(board(seed, "p1", "p1", PLAIN), "p1"), "p1", 0);
      for (const seat of ["p1", "p2"] as const) {
        expect(Object.keys(stamped.handPlayLockedTurn[seat]).sort()).toEqual(
          Object.keys(plain.handPlayLockedTurn[seat]).sort(),
        );
        expect(Object.keys(stamped.handPlayLockedTurn[seat]).sort()).toEqual(
          ["Item", "Supporter", "Stadium", "evolve"].sort(),
        );
      }
    }
  });

  it("NOTHING ELSE PERSISTED MOVED — no top-level key, no body key, no allowance key", () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    const plain = swing(turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1", 0);
    expect(Object.keys(stamped).sort()).toEqual(Object.keys(plain).sort());
    expect(Object.keys(stamped).sort()).toEqual(
      [
        "allowances",
        "cardIdByUid",
        "cardPool",
        "firstPlayer",
        "handPlayLockedTurn",
        "lastKoMarks",
        "lastKoTurn",
        "oncePerGameSpent",
        "pending",
        "phase",
        "players",
        "recentAttackers",
        "rngState",
        "stadium",
        "turn",
      ].sort(),
    );
    const bodyKeys = (s: GameState): string[] => Object.keys(s.players.p2.active ?? {}).sort();
    expect(bodyKeys(stamped)).toEqual(bodyKeys(plain));
    expect(Object.keys(stamped.allowances).sort()).toEqual(Object.keys(plain.allowances).sort());
  });

  it("a REAL JSON round trip preserves the stamp — the record carries it, not a derivation", () => {
    // Arbok's bar survives a round trip because it is RECOMPUTED; Bronzong's
    // survives only because the number is written down. Both directions asserted
    // on one board, which is what makes the two sources' costs comparable.
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    const reloaded = JSON.parse(JSON.stringify(stamped)) as GameState;
    expect(pokemonPlayBarred(reloaded, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    const arbok = turnOf(board(SEEDS[0], "p1", "p1", ARBOK), "p2");
    const arbokReloaded = JSON.parse(JSON.stringify(arbok)) as GameState;
    expect(arbokReloaded.handPlayLockedTurn.p2.evolve).toBeNull();
    expect(pokemonPlayBarred(arbokReloaded, "p2", "evolve", POOL[EVO_ABILITY])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RARE CANDY IS NOT AN ACT OF THIS SURFACE, AND THAT IS A RULES CALL.
// ─────────────────────────────────────────────────────────────────────────────

describe("D285 §7 — the act that is deliberately NOT reached", () => {
  it("THE READER HAS EXACTLY TWO ACTS AND RARE CANDY IS NEITHER", () => {
    const stamped = swing(turnOf(board(SEEDS[0], "p1", "p1", BRONZONG), "p1"), "p1", 0);
    expect(pokemonPlayBarred(stamped, "p2", "evolve", POOL[EVO_PLAIN])).toBe(true);
    expect(pokemonPlayBarred(stamped, "p2", "bench", POOL[BASIC_PLAIN])).toBe(false);
    expect(handPlayBarred(stamped, "p2", "Item", undefined)).toBe(false);
  });
});
