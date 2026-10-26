import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { cardSchema } from "@colorless/schema";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { matchesFilter } from "./cards";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { POKEMON_TYPES } from "./effectTypes";
import { POKEMON_TYPE_BY_CODE } from "./deriver/vocabulary";
import { applyAction, programFor, topCardOf } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
  driveSetup,
} from "./testFixtures";

/** The printed sentence, verbatim — the byte source for every case below. */
const VOLT_SWITCH = "Switch this Pokémon with 1 of your Benched {L} Pokémon.";

const BARE = "Switch this Pokémon with 1 of your Benched Pokémon.";

/** U+2019, spelled as an escape — the two apostrophes render nearly identically,
    so the curly one is always written where a reader can see it. */
const RSQUO = "’";

const VOLT_SWITCH_FILE_LINE = 499;

// ── The board ────────────────────────────────────────────────────────────────

/** The attacker. Both printed sentences of the family sit on ONE body at fixed
    indices, so every "this sentence and not that one" case below is a
    same-fixture comparison rather than a two-board one. */
const ATTACKER: Card = battler("fix-voltswitch", {
  name: "Fixavolt",
  hp: 120,
  types: ["Lightning"],
  attacks: [
    { cost: ["Colorless"], name: "Volt Switch", damage: 10, effect: VOLT_SWITCH },
    { cost: ["Colorless"], name: "Plain Switch", damage: 10, effect: BARE },
  ],
});

const DUAL: Card = battler("fix-volt-dual", {
  name: "Fixtricity",
  hp: 90,
  types: ["Metal", "Lightning"],
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-voltswitch": ATTACKER,
  "fix-volt-dual": DUAL,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-voltswitch": 2,
  "fix-volt-dual": 4,
  "fix-lightning-1": 6,
  "fix-basic-1": 8,
  "fix-titan": 4,
  "fix-energy": 36,
});

/** Attack indices on `fix-voltswitch`, by name rather than by memory (§1 pins
    both against the fixture). */
const VOLT = 0;
const PLAIN = 1;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(localSetup(101, by === "p1" ? "p2" : "p1"), { type: "endTurn", seat: foe }),
  );
  state = setActiveFromDeck(state, by, "fix-voltswitch");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

function benched(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

function mixed(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  const state = benched(bare(by), by, [
    "fix-lightning-1",
    "fix-basic-1",
    "fix-volt-dual",
    "fix-basic-1",
  ]);
  return benched(state, foe, ["fix-lightning-1", "fix-lightning-1", "fix-basic-1"]);
}

function noMatch(by: Seat = "p1"): GameState {
  return benched(bare(by), by, ["fix-basic-1", "fix-basic-1", "fix-titan", "fix-basic-1"]);
}

/** The ONE-match board: `parkOrForce` auto-applies at a single candidate, so this
    swings with **no prompt at all**. The `noMatch` board's control on ONE axis. */
function oneMatch(by: Seat = "p1"): GameState {
  return benched(bare(by), by, ["fix-basic-1", "fix-lightning-1", "fix-basic-1"]);
}

function emptyBench(by: Seat = "p1"): GameState {
  return bare(by);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

/** The parked `choosePokemon` prompt, narrowed — a state that is not parked fails
    HERE with the reason rather than three lines later on an undefined. */
function choosePrompt(state: GameState): { candidates: readonly PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

/** The printed NAME of every body a ref list points at. */
function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    return body === null || body === undefined ? "?" : (topCardOf(state, body)?.name ?? "?");
  });
}

function activeName(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return topCardOf(state, active)?.name ?? "?";
}

function pick(seat: Seat, index: number) {
  return {
    type: "resolveEffect",
    seat,
    choice: { kind: "pokemon", ref: { seat, spot: { spot: "bench", index } } },
  } as const;
}

describe("§1 — the bytes, and the corpus row they come from", () => {
  it("is a REAL corpus row at the cited FILE LINE, carrying exactly 1 printing", () => {
    const rows = legalAttackCorpus();
    const index = rows.findIndex(([, text]) => text === VOLT_SWITCH);
    expect(index, "the printed sentence is not in the corpus").toBeGreaterThanOrEqual(0);
    expect(index + 53).toBe(VOLT_SWITCH_FILE_LINE);
    expect(rows[index]?.[0]).toBe(1);
    expect(rows.find(([, text]) => text === BARE)?.[0]).toBe(7);
  });

  it("carries NO APOSTROPHE OF EITHER CLASS — so the anchor carries no `['’]`", () => {
    expect(VOLT_SWITCH).not.toContain("'");
    expect(VOLT_SWITCH).not.toContain(RSQUO);
    // The control — the exact seat swap DOES carry one, so "no apostrophe" is a
    // fact about this sentence rather than about this file's ability to look. It
    // is also the string an over-wide anchor starts admitting, and it stays null.
    const SWAPPED = "Switch this Pokémon with 1 of your opponent's Benched {L} Pokémon.";
    expect(SWAPPED).toContain("'");
    expect(deriveAttackEffect(SWAPPED)).toBeNull();
  });

  it("is the fixture's string, at the index this file addresses by constant", () => {
    const attacks = LOCAL_CARDS["fix-voltswitch"]?.attacks ?? [];
    expect(attacks[VOLT]?.effect).toBe(VOLT_SWITCH);
    expect(attacks[VOLT]?.name).toBe("Volt Switch");
    // Its bare sibling sits beside it on the SAME body — the control for every
    // board case below.
    expect(attacks[PLAIN]?.effect).toBe(BARE);
    expect(attacks[PLAIN]?.name).toBe("Plain Switch");
  });

  it("hands nothing to the COIN or the DAMAGE readers — one sentence, one seam", () => {
    expect(deriveAttackCoinFlip(VOLT_SWITCH)).toBeNull();
    expect(deriveAttackDamageBonus(VOLT_SWITCH)).toBeNull();
    expect(splitAttackGateClause(VOLT_SWITCH)).toBeNull();
    expect(splitAttackTrailingClause(VOLT_SWITCH)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE ARM: THE DERIVED VALUE, AND WHAT THE NARROWING IS WORTH
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derived program, by VALUE", () => {
  it("derives to `switchActive` carrying the printed type — and nothing else", () => {
    expect(deriveAttackEffect(VOLT_SWITCH)).toEqual([
      { op: "switchActive", targetType: "Lightning" },
    ]);
  });

  it("the BARE sibling still derives to the FIELD-LESS op — the two differ by the rider", () => {
    const bareProgram = deriveAttackEffect(BARE);
    expect(bareProgram).toEqual([{ op: "switchActive" }]);
    expect(bareProgram?.[0]).not.toHaveProperty("targetType");
    const typed = deriveAttackEffect(VOLT_SWITCH);
    expect(typed).not.toEqual(bareProgram);
    expect(Object.keys(typed?.[0] ?? {}).sort()).toEqual(["op", "targetType"]);
  });

  it("reads EVERY code the map spells, generated FROM the map rather than listed", () => {
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackEffect(`Switch this Pokémon with 1 of your Benched {${code}} Pokémon.`),
        code,
      ).toEqual([{ op: "switchActive", targetType: type }]);
    }
    // The map is TOTAL over the type vocabulary, so the loop above is the whole
    // of it rather than a sample.
    expect(new Set(Object.values(POKEMON_TYPE_BY_CODE))).toEqual(new Set(POKEMON_TYPES));
  });

  it("an UNREADABLE code stays LOUD rather than defaulting to a type", () => {
    for (const code of ["Q", "X", "B", "A"]) {
      expect(POKEMON_TYPE_BY_CODE[code], code).toBeUndefined();
      expect(
        deriveAttackEffect(`Switch this Pokémon with 1 of your Benched {${code}} Pokémon.`),
        code,
      ).toBeNull();
    }
  });

  it("the anchor is WHOLE-STRING and commits to CASE — the rewrites it refuses", () => {
    const refused = [
      "switch this Pokémon with 1 of your Benched {L} Pokémon.",
      "Switch This Pokémon with 1 of your Benched {L} Pokémon.",
      // The `$`: a trailing clause and the missing terminator.
      VOLT_SWITCH.slice(0, -1),
      // The `^`: a LEADING clause. Real shape — every compound in this family puts
      // a whole mechanic in front of the switch.
      `Draw a card. ${VOLT_SWITCH}`,
      "Switch this Pokémon with 2 of your Benched {L} Pokémon.",
      // The SEAT.
      "Switch this Pokémon with 1 of your opponent's Benched {L} Pokémon.",
      // The BRACES: an unbraced type word is a different printed notation and this
      // anchor does not claim it (the pool prints both notations, split by set).
      "Switch this Pokémon with 1 of your Benched Lightning Pokémon.",
      // A MULTI-CHARACTER code — the greedy-capture mistake this file's anchors
      // are audited for. `([A-Z])` is one character on purpose.
      "Switch this Pokémon with 1 of your Benched {LW} Pokémon.",
    ];
    for (const text of refused) expect(deriveAttackEffect(text), text).toBeNull();
    // …and the real sentence is not in that list by construction, which is what
    // stops the loop above from being a list of strings nobody checked.
    expect(refused).not.toContain(VOLT_SWITCH);
    expect(deriveAttackEffect(VOLT_SWITCH)).not.toBeNull();
  });

  it("the `$` refusal is demonstrated at the SPLIT, because the loud path is gone (D464)", () => {
    const compound = `${VOLT_SWITCH} Draw a card.`;
    expect(deriveAttackEffect(compound)).toBeNull();
    expect(splitAttackTrailingClause(compound)).toEqual({
      head: VOLT_SWITCH,
      tail: "Draw a card.",
    });
    const composed = legalAttackCorpus().filter(
      ([, text]) => text !== VOLT_SWITCH && text.startsWith(VOLT_SWITCH),
    );
    expect(composed).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE BOARD: THE NARROWING NARROWS
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the parked candidate list is the printed subgroup", () => {
  it("offers the two {L} bodies and NEITHER Colorless one, on a four-body Bench", () => {
    const { state } = swing(mixed(), VOLT);
    const { candidates } = choosePrompt(state);
    expect(refNames(state, candidates).sort()).toEqual(["Fixtricity", "fix-lightning-1"]);
    // Read as REFS too, so "two names" cannot pass on a list pointing at the wrong
    // spots — the dual body is at bench index 2 and the plain {L} at index 0.
    expect(candidates.map((r) => r.spot.spot === "bench" && r.spot.index).sort()).toEqual([0, 2]);
    // …and every candidate is on the ATTACKER's side. A seat inversion would offer
    // three bodies from p2, which is why p2's Bench is stocked with {L} at all.
    for (const ref of candidates) expect(ref.seat).toBe("p1");
  });

  it("the BARE sibling on the SAME body and the SAME board offers all FOUR", () => {
    const { state } = swing(mixed(), PLAIN);
    const { candidates } = choosePrompt(state);
    expect(refNames(state, candidates).sort()).toEqual([
      "Fixtricity",
      "fix-basic-1",
      "fix-basic-1",
      "fix-lightning-1",
    ]);
    expect(candidates).toHaveLength(4);
  });

  it("the DUAL-TYPE body is offered — MEMBERSHIP, not `types[0]` equality", () => {
    expect(DUAL.types).toEqual(["Metal", "Lightning"]);
    expect(DUAL.types?.[0]).not.toBe("Lightning");
    expect(matchesFilter(DUAL, { kind: "typedPokemon", pokemonType: "Lightning" })).toBe(true);
    expect(matchesFilter(DUAL, { kind: "typedPokemon", pokemonType: "Metal" })).toBe(true);
    expect(matchesFilter(DUAL, { kind: "typedPokemon", pokemonType: "Water" })).toBe(false);
    const { state } = swing(mixed(), VOLT);
    expect(refNames(state, choosePrompt(state).candidates)).toContain("Fixtricity");
  });

  it("the PROMPT CAPTION names the printed subgroup — D273's noun, at a new surface", () => {
    const { state } = swing(mixed(), VOLT);
    expect(choosePrompt(state).note).toBe("Switch to which Benched Lightning Pokémon?");
    const { state: plain } = swing(mixed(), PLAIN);
    expect(choosePrompt(plain).note).toBe("Switch to which Benched Pokémon?");
  });

  it("answering promotes the chosen {L} body, and the attack's damage still lands", () => {
    const { state: parked } = swing(mixed(), VOLT);
    const { state: done, events } = mustApply(parked, pick("p1", 2));
    expect(activeName(done, "p1")).toBe("Fixtricity");
    expect(findEvent(events, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(done.phase.kind).toBe("turn:action");
    // The §8.5 hit ran BEFORE the program, on the body that declared — so the
    // defender took 10 even though the attacker left the Active Spot.
    expect(done.players.p2.active?.damage).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE THREE ENDINGS, AND THE CONTROL THAT TELLS TWO OF THEM APART
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — `parkOrForce`'s three arms, reached through the narrowing", () => {
  it("ZERO matches on a NON-EMPTY Bench: no park, no switch, no row", () => {
    const before = noMatch();
    expect(before.players.p1.bench).toHaveLength(4);
    const { state: done, events } = swing(before, VOLT);
    expect(done.phase.kind).toBe("turn:action");
    expect(activeName(done, "p1")).toBe("Fixavolt");
    expect(events.filter((e) => e.type === "POKEMON_SWITCHED")).toEqual([]);
    // The §8.5 damage still lands — the attack RESOLVED, it just had nobody to
    // switch with. A build that refused the declaration would fail here.
    expect(done.players.p2.active?.damage).toBe(10);
    // …and the loud channel does NOT fire: the sentence is SIMULATED, so a zero
    // candidate set is a legitimate ending rather than an unread sentence.
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toEqual([]);
  });

  it("the SAME board under the BARE sibling DOES park — the one-axis control", () => {
    const { state } = swing(noMatch(), PLAIN);
    expect(state.phase.kind).toBe("effect:choose");
    expect(choosePrompt(state).candidates).toHaveLength(4);
  });

  it("ONE match: `parkOrForce` FORCES it — the switch happens with no prompt", () => {
    const { state: done, events } = swing(oneMatch(), VOLT);
    expect(done.phase.kind).toBe("turn:action");
    expect(activeName(done, "p1")).toBe("fix-lightning-1");
    expect(findEvent(events, "POKEMON_SWITCHED")?.seat).toBe("p1");
  });

  it("an EMPTY Bench also ends silently — `noMatch`'s control on the other axis", () => {
    const before = emptyBench();
    expect(before.players.p1.bench).toEqual([]);
    const { state: done, events } = swing(before, VOLT);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.filter((e) => e.type === "POKEMON_SWITCHED")).toEqual([]);
    // …and the BARE sibling ends silently here too, which is what makes the
    // `noMatch` pair above a claim about the FILTER rather than about the Bench.
    const { state: plain } = swing(emptyBench(), PLAIN);
    expect(plain.phase.kind).toBe("turn:action");
  });

  it("the SECOND SEAT reads its own Bench — the claim is about the CONTROLLER", () => {
    const { state } = swing(mixed("p2"), VOLT, "p2");
    const { candidates } = choosePrompt(state);
    expect(refNames(state, candidates).sort()).toEqual(["Fixtricity", "fix-lightning-1"]);
    for (const ref of candidates) expect(ref.seat).toBe("p2");
    const { state: done } = mustApply(state, pick("p2", 0));
    expect(activeName(done, "p2")).toBe("fix-lightning-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE ANCHOR PAIR: WHICH MECHANISM SUPPLIES THE DISJOINTNESS
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the two self-switch anchors are STRUCTURALLY disjoint", () => {
  it("no string can match both — so the arm carries no guard and the ORDER is legibility", () => {
    const family = [
      BARE,
      VOLT_SWITCH,
      "You may switch this Pokémon with 1 of your Benched Pokémon.",
      "Flip a coin. If heads, switch this Pokémon with 1 of your Benched Pokémon.",
    ];
    const programs = family.map((text) => JSON.stringify(deriveAttackEffect(text)));
    expect(new Set(programs).size, "two family members derive to the same program").toBe(4);
    for (const text of family) expect(deriveAttackEffect(text), text).not.toBeNull();
  });

  it("the typed anchor claims EXACTLY ONE corpus row, and it is the cited line", () => {
    const claimed = legalAttackCorpus().filter(([, text]) => {
      const program = deriveAttackEffect(text);
      return (
        program?.length === 1 && program[0]?.op === "switchActive" && "targetType" in program[0]
      );
    });
    expect(claimed.map(([, text]) => text)).toEqual([VOLT_SWITCH]);
    expect(claimed[0]?.[0]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE POOL, SWEPT AS ITS OWN POPULATION
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — why this file owns a local pool", () => {
  it("`FIXTURE_POOL` HAS NO DUAL-TYPE LIGHTNING BODY — measured, not assumed", () => {
    const dualLightning = Object.values(FIXTURE_POOL).filter(
      (card) => (card.types ?? []).length > 1 && (card.types ?? []).includes("Lightning"),
    );
    expect(dualLightning).toEqual([]);
    // The two halves separately, so a future pool that gains one reddens the rung
    // above with a reason rather than a bare zero.
    expect(
      Object.values(FIXTURE_POOL).filter((card) => (card.types ?? []).includes("Lightning")).length,
    ).toBeGreaterThan(0);
    expect(
      Object.values(FIXTURE_POOL).filter((card) => (card.types ?? []).length > 1).length,
    ).toBeGreaterThan(0);
  });

  it("adds NO `FIXTURE_POOL` id — the local ids are local", () => {
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE REGISTRY IS NOT INVOLVED
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the gain is the RAW reader summand alone", () => {
  it("no registry row serves this sentence, so the census summands stay DISJOINT", () => {
    expect(programFor("sv07-053")?.attack).toBeUndefined();
    const carriers = Object.keys(FIXTURE_POOL).filter((id) =>
      (FIXTURE_POOL[id]?.attacks ?? []).some((attack) => attack.effect === VOLT_SWITCH),
    );
    expect(carriers).toEqual([]);
  });

  it("`resolvedByAnyReader` now claims it, and the reader that owns it is named", () => {
    expect(resolvedByAnyReader(VOLT_SWITCH)).toBe(true);
    expect(deriveAttackEffect(VOLT_SWITCH)).not.toBeNull();
    for (const read of [deriveAttackCoinFlip, deriveAttackDamageBonus]) {
      expect(read(VOLT_SWITCH)).toBeNull();
    }
  });
});

describe("§9 — the `Ancient`/`Future` banner is DATA-BLOCKED, and the falsifier is executable", () => {
  it("the persisted `Card` carries NO field that could classify the banner", () => {
    expect(Object.keys(cardSchema.shape).sort()).toEqual(
      [
        "abilities",
        "attacks",
        "category",
        "effect",
        "energyType",
        "evolveFrom",
        "hp",
        "id",
        "illustrator",
        "image",
        "legal",
        "localId",
        "name",
        "rarity",
        "regulationMark",
        "resistances",
        "retreat",
        "setId",
        "stage",
        "trainerType",
        "types",
        "variants",
        "weaknesses",
      ].sort(),
    );
  });

  it("a NAME-keyed table cannot answer it either — the banner is a per-PRINTING fact", () => {
    const named = Object.values(FIXTURE_POOL).filter((card) => /Ancient|Future/.test(card.name));
    expect(named).toEqual([]);
  });

  it("the residue holds 12 sentences / 17 printings on the banner, and NONE derives", () => {
    const banner = legalAttackCorpus().filter(([, text]) => /Ancient|Future/.test(text));
    expect(banner).toHaveLength(12);
    expect(banner.reduce((total, [printings]) => total + printings, 0)).toBe(17);
    const readerClaimed = banner.filter(([, text]) => resolvedByAnyReader(text)).map(([, t]) => t);
    expect(readerClaimed.sort()).toEqual(
      [
        "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.",
        "During your opponent's next turn, prevent all damage done to each of your Future Pokémon by attacks from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this effect ends.",
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.",
        "If you played a Future Supporter card from your hand during this turn, this attack does 100 more damage.",
        "If your opponent has any Future Pokémon in play, this attack does 120 more damage.",
        "This attack does 10 more damage for each Ancient card in your discard pile.",
        "This attack does 30 damage for each of your Ancient Pokémon in play.",
      ].sort(),
    );
    for (const [, text] of banner) {
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
    }
  });

  it("it is FOUR carriers and not one mechanism, so the data alone would not close it", () => {
    const banner = legalAttackCorpus().filter(([, text]) => /Ancient|Future/.test(text));
    const damageShaped = banner.filter(([, text]) => /this attack does/i.test(text));
    const effectShaped = banner.filter(([, text]) => !/this attack does/i.test(text));
    expect(damageShaped.length).toBeGreaterThan(0);
    expect(effectShaped.length).toBeGreaterThan(0);
  });

  it("the ADJACENT row this slice DID take shows what the difference is", () => {
    expect(deriveAttackEffect(VOLT_SWITCH)).toEqual([
      { op: "switchActive", targetType: "Lightning" },
    ]);
    expect(
      deriveAttackEffect("Switch this Pokémon with 1 of your Benched Ancient Pokémon."),
    ).toBeNull();
    const corpus = legalAttackCorpus();
    expect(
      corpus.some(
        ([, text]) => text === "Switch this Pokémon with 1 of your Benched Ancient Pokémon.",
      ),
    ).toBe(false);
    const printedSlot = corpus.filter(([, text]) => text.includes("Benched Ancient Pokémon"));
    expect(printedSlot).toHaveLength(2);
    for (const [, text] of printedSlot) expect(deriveAttackEffect(text), text).toBeNull();
  });
});
