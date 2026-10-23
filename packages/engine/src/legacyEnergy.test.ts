import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import {
  ANY_ENERGY,
  applyAction,
  costMet,
  createGame,
  deriveAttackEffect,
  engineVersion,
  programFor,
  providedEnergy,
} from "./index";
import type { GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  LEGACY_PRIZE_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  activeOf,
} from "./testFixtures";

const LEGACY_PRINTED =
  "As long as this card is attached to a Pokémon, it provides every type of Energy but provides only 1 Energy at a time.\n\nIf the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card. This effect of your Legacy Energy can't be applied more than once per game.";
const PEARL_PRINTED =
  "If the Lillie's Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card.";
const OH_NO_YOU_DONT =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card.";

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30

/** `fix-legacy-ex` is worth TWO Prizes (the `ex` suffix is in its NAME) and
    `fix-lillie-body` one, which is what lets a DECREMENT be told from a ZEROING. */
const EX_PRIZES = 2;

interface Board {
  holder?: string;
  /** Copies of Legacy Energy on the holder. */
  legacy?: number;
  pearl?: boolean;
  /** HP of damage already on the holder — Bite adds 30. */
  damage?: number;
  /** Extra bodies on the holder's bench, so a KO does not empty the board. */
  bench?: string[];
}

function field(seed: number, opts: Board = {}): GameState {
  let state = driveSetup(seed, { p1: LEGACY_PRIZE_DECK, p2: LEGACY_PRIZE_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", opts.holder ?? "fix-legacy-ex");
  state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
  for (const id of opts.bench ?? ["fix-bigbody"]) state = benchFromDeck(state, "p2", id);
  if (opts.pearl === true) state = attachToolFromDeck(state, "p2", "active", "fix-lillies-pearl");
  if (opts.legacy !== undefined)
    state = attachFromDeck(state, "p2", "fix-legacy-energy", opts.legacy);
  state = setDamage(state, "p2", opts.damage ?? 240);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The Prize count the KO actually parks on, or 0 when no `takePrizes` stage was
    queued at all — read off the PHASE rather than off the events, because the
    phase is what the player is asked. */
function parkedPrizes(state: GameState): number {
  return state.phase.kind === "ko:takePrizes" ? state.phase.count : 0;
}

function reductions(events: GameEvent[]): Extract<GameEvent, { type: "PRIZE_REDUCED" }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: "PRIZE_REDUCED" }> => {
    return e.type === "PRIZE_REDUCED";
  });
}

/** A board straight out of `createGame` — before setup, before anything. */
function freshGame(): GameState {
  return must(
    createGame({
      seed: 7,
      decks: { p1: LEGACY_PRIZE_DECK, p2: LEGACY_PRIZE_DECK },
      cardPool: FIXTURE_POOL,
    }) as never,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ROWS ARE DATA — and the provision half was already built.
// ─────────────────────────────────────────────────────────────────────────────

describe("the two registry rows, and the half of Legacy Energy that costs nothing", () => {
  it("the PROVISION is Luminous Energy's line VERBATIM — one wildcard unit", () => {
    expect(programFor("sv06-167")?.energy?.provides).toEqual([ANY_ENERGY]);
    expect(programFor("sv06-167")?.energy?.provides).toEqual(
      programFor("sv02-191")?.energy?.provides,
    );
    expect(programFor("sv06-167")?.energy?.provides).toHaveLength(1);
    expect(costMet(["Psychic"], [ANY_ENERGY])).toBe(true);
    expect(costMet(["Psychic", "Water"], [ANY_ENERGY])).toBe(false);
  });

  it("carries NO conditional provision and NO on-attach arm — both are ABSENT from the print", () => {
    expect(programFor("sv06-167")?.energy?.promoteOnHolderStage).toBeUndefined();
    expect(programFor("sv06-167")?.energy?.demoteWithOtherSpecial).toBeUndefined();
    expect(programFor("sv06-167")?.energy?.onAttach).toBeUndefined();
  });

  it("the PRIZE half sits on `energy.passive`, which is D174's third source class", () => {
    expect(programFor("sv06-167")?.energy?.passive?.onKoPrizeReduction).toEqual({
      by: 1,
      oncePerGame: "Legacy Energy",
    });
    // No owner gate: this card admits ANY holder. The Pearl is the one that gates.
    expect(
      programFor("sv06-167")?.energy?.passive?.onKoPrizeReduction?.requiresHolderOwner,
    ).toBeUndefined();
    // And NO board clause either — `requiresInPlay` is Munkidori's alone.
    expect(
      programFor("sv06-167")?.energy?.passive?.onKoPrizeReduction?.requiresInPlay,
    ).toBeUndefined();
  });

  it("Lillie's Pearl is a TOOL's `passive`, gated on the HOLDER and uncapped", () => {
    expect(programFor("sv09-151")?.passive?.onKoPrizeReduction).toEqual({
      by: 1,
      requiresHolderOwner: "Lillie",
    });
    expect(programFor("sv09-151")?.energy).toBeUndefined();
    expect(programFor("sv06-167")?.passive).toBeUndefined();
  });

  it("both printings share their program with their `fix-*` demonstrator", () => {
    // Not merely equal — the SAME object, so the once-per-game key cannot drift
    // between the real id and the fixture the boards below actually field.
    expect(programFor("fix-legacy-energy")).toBe(programFor("sv06-167"));
    expect(programFor("fix-lillies-pearl")).toBe(programFor("sv09-151"));
    expect(FIXTURE_POOL["fix-legacy-energy"]?.effect).toBe(LEGACY_PRINTED);
    expect(FIXTURE_POOL["fix-lillies-pearl"]?.effect).toBe(PEARL_PRINTED);
  });

  it("neither sentence is an ATTACK's, so no deriver may claim either", () => {
    expect(deriveAttackEffect(LEGACY_PRINTED)).toBeNull();
    expect(deriveAttackEffect(PEARL_PRINTED)).toBeNull();
  });

  it("D164's ABILITY row is UNTOUCHED by the type extraction", () => {
    expect(programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction).toEqual({
      by: 1,
      requiresInPlay: "Pecharunt ex",
    });
    expect(FIXTURE_POOL["sv06.5-037"]?.abilities?.[0]?.effect).toBe(OH_NO_YOU_DONT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FOLD — `passivesOf` reaches BOTH attach slots, and only those.
// ─────────────────────────────────────────────────────────────────────────────

describe("passivesOf collects the reduction off an attached card, on either slot", () => {
  it("an ENERGY and a TOOL both reach `koPrizeReductions` — one fold, two slots", () => {
    const energyOnly = field(3, { legacy: 1 });
    const toolOnly = field(3, { pearl: true });
    expect(passivesOf(energyOnly, activeOf(energyOnly, "p2")).koPrizeReductions).toEqual([
      { by: 1, oncePerGame: "Legacy Energy" },
    ]);
    expect(passivesOf(toolOnly, activeOf(toolOnly, "p2")).koPrizeReductions).toEqual([
      { by: 1, requiresHolderOwner: "Lillie" },
    ]);
  });

  it("a body wearing BOTH offers TWO entries — the list is not a scalar", () => {
    const both = field(3, { legacy: 1, pearl: true });
    expect(passivesOf(both, activeOf(both, "p2")).koPrizeReductions).toEqual([
      { by: 1, requiresHolderOwner: "Lillie" },
      { by: 1, oncePerGame: "Legacy Energy" },
    ]);
  });

  it("a bare body collects NOTHING, and neither does the ABILITY carrier", () => {
    const bare = field(3);
    expect(passivesOf(bare, activeOf(bare, "p2")).koPrizeReductions).toEqual([]);
    const munkidori = field(3, { holder: "sv06.5-037", damage: 0 });
    expect(passivesOf(munkidori, activeOf(munkidori, "p2")).koPrizeReductions).toEqual([]);
  });

  it("the wildcard provision is LIVE off the same attachment", () => {
    const state = field(3, { legacy: 1 });
    expect(providedEnergy(state, activeOf(state, "p2"))).toEqual([ANY_ENERGY]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE REDUCTION ON A REAL KNOCK OUT.
// ─────────────────────────────────────────────────────────────────────────────

describe("the Prize reduction — driven through a real attack Knock Out", () => {
  it("2 → 1 off the ENERGY, and it is a DECREMENT rather than a zeroing", () => {
    const done = mustApply(field(1, { legacy: 1 }), bite);
    expect(parkedPrizes(done.state)).toBe(EX_PRIZES - 1);
    expect(reductions(done.events)).toEqual([
      { type: "PRIZE_REDUCED", seat: "p2", uid: expect.any(String), by: 1, count: 1 },
    ]);
    // The control: the same board with nothing attached parks on the face value.
    expect(parkedPrizes(mustApply(field(1), bite).state)).toBe(EX_PRIZES);
  });

  it("2 → 1 off the TOOL, on a holder its owner gate ADMITS", () => {
    const done = mustApply(field(1, { pearl: true }), bite);
    expect(parkedPrizes(done.state)).toBe(EX_PRIZES - 1);
    expect(reductions(done.events)).toHaveLength(1);
  });

  it("THE OWNER GATE REFUSES AN UNPREFIXED HOLDER — the board D279 asks for", () => {
    // `fix-pearl-nobody` is "Clefairy" to `fix-lillie-body`'s "Lillie's Clefairy":
    // same HP, same attack, same Prize value, and ONLY the name differs. A build
    // that reused Legacy Energy's ungated read would reduce here.
    const gated = mustApply(
      field(1, { holder: "fix-pearl-nobody", damage: 50, pearl: true }),
      bite,
    );
    expect(parkedPrizes(gated.state)).toBe(1);
    expect(reductions(gated.events)).toEqual([]);
    // …and the SAME Pearl on the SAME board reduces once the holder is prefixed.
    const admitted = mustApply(
      field(1, { holder: "fix-lillie-body", damage: 50, pearl: true }),
      bite,
    );
    expect(parkedPrizes(admitted.state)).toBe(0);
    expect(reductions(admitted.events)).toHaveLength(1);
    const ungated = mustApply(
      field(1, { holder: "fix-pearl-nobody", damage: 50, legacy: 1 }),
      bite,
    );
    expect(parkedPrizes(ungated.state)).toBe(0);
    expect(reductions(ungated.events)).toHaveLength(1);
  });

  it("the two COMPOUND on one body: 2 → 1 → 0, and the clamp is over the RUNNING total", () => {
    const done = mustApply(field(1, { legacy: 1, pearl: true }), bite);
    expect(parkedPrizes(done.state)).toBe(0);
    expect(reductions(done.events).map((e) => e.count)).toEqual([1, 0]);
    // No `takePrizes` stage is queued at all when the count reaches 0 — the same
    // path Glimmora's guard takes, reached by a different road.
    expect(done.state.phase.kind).not.toBe("ko:takePrizes");
  });

  it("THE POSSESSIVE REFUSES A KO ON THE ATTACKER'S OWN BOARD — a Rocky Helmet board", () => {
    let state = field(1, { holder: "fix-lillie-body", damage: 50 });
    state = attachToolFromDeck(state, "p2", "active", "sv01-193"); // Rocky Helmet
    state = attachFromDeck(state, "p1", "fix-legacy-energy", 1);
    state = setDamage(state, "p1", 110); // `fix-attacker` is 120 HP
    expect(passivesOf(state, activeOf(state, "p1")).koPrizeReductions).toHaveLength(1);

    const done = mustApply(state, bite);
    // BOTH bodies died on one sweep, and only P2's carried a live clause.
    expect(done.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(2);
    expect(reductions(done.events).map((e) => e.seat)).toEqual([]);
    expect(done.state.oncePerGameSpent.p1).toEqual([]);
  });

  it("a CHECKUP Knock Out is refused — `attackerSeat` is undefined there", () => {
    let state = field(2, { legacy: 1, damage: 250 });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    // P1 ends its turn; the Checkup poisons P2's Active for its last 10 HP.
    const done = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(done.events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    expect(reductions(done.events)).toEqual([]);
    expect(parkedPrizes(done.state)).toBe(EX_PRIZES);
    expect(done.state.oncePerGameSpent.p2).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE LATCH — the one thing that was genuinely missing.
// ─────────────────────────────────────────────────────────────────────────────

describe("`oncePerGameSpent` — the per-game latch, and the only new GameState field", () => {
  it("is EMPTY on a fresh board, for both seats", () => {
    const game = freshGame();
    expect(game.oncePerGameSpent).toEqual({ p1: [], p2: [] });
  });

  it("is stamped with the printed EFFECT's name — not a card id and not a uid", () => {
    const done = mustApply(field(1, { legacy: 1 }), bite);
    expect(done.state.oncePerGameSpent).toEqual({ p1: [], p2: ["Legacy Energy"] });
    // The key is what makes `sv06-167` and `fix-legacy-energy` ONE cap. Read off
    // the program rather than re-typed, so a rename cannot pass this file.
    expect(done.state.oncePerGameSpent.p2).toEqual([
      programFor("sv06-167")?.energy?.passive?.onKoPrizeReduction?.oncePerGame,
    ]);
  });

  it("A SECOND Knock Out with a SECOND copy attached is NOT reduced", () => {
    let state = field(1, { legacy: 1, bench: ["fix-legacy-ex", "fix-bigbody"] });
    const first = mustApply(state, bite);
    expect(parkedPrizes(first.state)).toBe(1);
    expect(first.state.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);

    // Take the Prize, promote, and hand a SECOND wired body to the same attacker.
    state = mustApply(first.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    state = mustApply(state, { type: "promote", seat: "p2", benchIndex: 0 }).state;
    state = attachFromDeck(state, "p2", "fix-legacy-energy", 1);
    state = setDamage(state, "p2", 240);
    expect(passivesOf(state, activeOf(state, "p2")).koPrizeReductions).toHaveLength(1);

    // P2's turn, then P1 attacks again into the second holder.
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const second = mustApply(state, bite);
    expect(reductions(second.events)).toEqual([]);
    expect(parkedPrizes(second.state)).toBe(EX_PRIZES);
    expect(second.state.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);
  });

  it("IS NOT SPENT WHEN THERE IS NOTHING LEFT TO REDUCE — the `count === 0` break", () => {
    const done = mustApply(
      field(1, { holder: "fix-lillie-body", damage: 50, legacy: 1, pearl: true }),
      bite,
    );
    expect(parkedPrizes(done.state)).toBe(0);
    expect(reductions(done.events)).toHaveLength(1);
    expect(done.state.oncePerGameSpent.p2).toEqual([]);
  });

  it("is PER-SEAT — one player's Knock Out cannot consume the other's cap", () => {
    const done = mustApply(field(1, { legacy: 1 }), bite);
    expect(done.state.oncePerGameSpent.p1).toEqual([]);
    expect(done.state.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);
  });

  it("the TOOL has no cap at all and stamps nothing", () => {
    const done = mustApply(field(1, { pearl: true }), bite);
    expect(done.state.oncePerGameSpent).toEqual({ p1: [], p2: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. COMPOSITION with the two on-KO Prize mechanisms that were already here.
// ─────────────────────────────────────────────────────────────────────────────

describe("the attached reduction composes with D164's ABILITY and D155's GUARD", () => {
  it("Munkidori ex wearing a Legacy Energy pays BOTH — 2 → 1 → 0", () => {
    const state = field(4, {
      holder: "sv06.5-037",
      damage: 190,
      legacy: 1,
      bench: ["sv06.5-039", "fix-bigbody"],
    });
    const done = mustApply(state, bite);
    expect(reductions(done.events).map((e) => e.count)).toEqual([1, 0]);
    expect(done.state.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);
    expect(done.state.phase.kind).not.toBe("ko:takePrizes");
  });

  it("Glimmora's on-KO Prize GUARD is untouched by the new field", () => {
    // The sibling that ZEROES rather than decrements. It carries no
    // `onKoPrizeReduction` and must not have acquired one.
    expect(programFor("sv02-126")?.triggered?.[0]?.onKoPrizeGuard).toBe("coinFlipPrevent");
    expect(programFor("sv02-126")?.triggered?.[0]?.onKoPrizeReduction).toBeUndefined();
    expect(programFor("sv02-126")?.passive?.onKoPrizeReduction).toBeUndefined();
  });
});

describe("the population of the printed sentence — 2 of 2, and the residue moves", () => {
  it("ENUMERATES every card in the pool carrying the reduction — a sweep, not a list", () => {
    const carriers = Object.keys(FIXTURE_POOL)
      .filter((id) => {
        const program = programFor(id);
        return (
          program?.passive?.onKoPrizeReduction !== undefined ||
          program?.energy?.passive?.onKoPrizeReduction !== undefined
        );
      })
      .sort();
    expect(carriers).toEqual(["fix-legacy-energy", "fix-lillies-pearl"]);
  });

  it("the Special Energy residue is now TWO, and this file owns the correction ( D577: ONE — Boomerang Energy BUILT; D578: NONE — Team Rocket's Energy BUILT)", () => {
    expect(programFor("sv06-167"), "sv06-167 is BUILT at D298").toBeDefined();
    expect(programFor("sv06-166"), "sv06-166 is BUILT at D577").toBeDefined();
    expect(programFor("sv10-182"), "sv10-182 is BUILT at D578").toBeDefined();
    for (const id of [] as string[]) {
      expect(programFor(id), `${id} is counted UNBUILT`).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MATCH_RECORD_VERSION — the BUMP, driven in BOTH directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_RECORD_VERSION 16 → 17 — and it is DRIVEN, not argued", () => {
  it("the persisted `GameState` carries EXACTLY these keys", () => {
    const game = freshGame();
    const revived = JSON.parse(JSON.stringify(game)) as GameState;
    expect(Object.keys(revived).sort()).toEqual([
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
    ]);
  });

  it("FORWARD: a version-16 record WITHOUT the key THROWS on the first reduction", () => {
    const live = field(1, { legacy: 1 });
    const { oncePerGameSpent: _dropped, ...old } = live;
    const stale = old as unknown as GameState;
    expect("oncePerGameSpent" in stale).toBe(false);
    expect(() => applyAction(stale, bite)).toThrow();
  });

  it("BACKWARD: a version-17 board round-trips through JSON with the latch intact", () => {
    const spent = mustApply(field(1, { legacy: 1 }), bite).state;
    const revived = JSON.parse(JSON.stringify(spent)) as GameState;
    expect(revived.oncePerGameSpent).toEqual(spent.oncePerGameSpent);
    // …and the revived board still refuses a second application, so the latch is
    // carried by the RECORD and not by anything in memory.
    const next = mustApply(revived, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    expect(next.oncePerGameSpent.p2).toEqual(["Legacy Energy"]);
  });

  it("no new `GameEvent` TYPE, no new prompt kind, no new error code", () => {
    const done = mustApply(field(1, { legacy: 1 }), bite);
    expect(reductions(done.events)).toHaveLength(1);
    expect(new Set(done.events.map((e) => e.type)).has("PRIZE_REDUCED")).toBe(true);
  });
});

describe("the engine version", () => {
  it("moved to 0.215.0 with the new field, and the two files agree", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});
