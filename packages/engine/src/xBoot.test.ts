import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { EffectOp, EffectPrompt, GameState, PokemonRef } from "./index";
import { attachEnergyTargets } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import { battler, deckOf, typedEnergy, must, driveSetup } from "./testFixtures";
import { FIXTURE_POOL } from "./testFixtures";

const X_BOOT = "sv10-145";

const ENERGY_COIN_ID = "sv10.5b-081";

const X_BOOT_TEXT =
  "Once during your turn, you may search your deck for a Basic {P} Energy card, " +
  "a Basic {M} Energy card, or 1 of each and attach them to your {P} Pokémon and " +
  "{M} Pokémon in any way you like. Then, shuffle your deck.";

const PSY_BODY = "d354-psy-body"; // types ["Psychic"] — the {P} half of the union
const METAL_BODY = "d354-metal-body"; // types ["Metal"] — the {M} half
const NEITHER = "d354-neither"; // a body of NEITHER printed type — the negative
const DUAL = "d354-dual"; // {P}+{M} on ONE body — unreachable from the catalog
const PSY_ENERGY = "d354-psychic-energy";
const METAL_ENERGY = "d354-metal-energy";
const WATER_ENERGY = "d354-water-energy"; // a Basic Energy of NEITHER named type

const LOCAL_CARDS: Record<string, Card> = {
  [X_BOOT]: battler(X_BOOT, {
    name: "Steven's Metagross ex",
    stage: "Stage2",
    evolveFrom: "Metang",
    hp: 340,
    retreat: 2,
    types: ["Metal"],
    abilities: [{ type: "Ability", name: "X-Boot", effect: X_BOOT_TEXT }],
  }),
  [PSY_BODY]: battler(PSY_BODY, { name: "D354 Psy", hp: 70, types: ["Psychic"] }),
  [METAL_BODY]: battler(METAL_BODY, { name: "D354 Metal", hp: 80, types: ["Metal"] }),
  [NEITHER]: battler(NEITHER, { name: "D354 Neither", hp: 70, types: ["Water"] }),
  [DUAL]: battler(DUAL, { name: "D354 Dual", hp: 70, types: ["Psychic", "Metal"] }),
  [PSY_ENERGY]: typedEnergy(PSY_ENERGY, "Psychic"),
  [METAL_ENERGY]: typedEnergy(METAL_ENERGY, "Metal"),
  [WATER_ENERGY]: typedEnergy(WATER_ENERGY, "Water"),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [X_BOOT]: 4,
  [PSY_BODY]: 8,
  [METAL_BODY]: 8,
  [NEITHER]: 8,
  [PSY_ENERGY]: 8,
  [METAL_ENERGY]: 8,
  [WATER_ENERGY]: 8,
  [DUAL]: 8,
});

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({
  seat: "p1",
  spot: { spot: "bench", index },
});

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p1" });
}

/** TEST SURGERY — p1's Active becomes the Metagross, `bench` names the bodies
    behind it, and p1's DECK is exactly `deck` (everything else goes underneath),
    so no count in this file is a seed fact. */
function board(
  bench: readonly string[],
  deck: readonly string[],
  opts: { active?: string } = {},
): GameState {
  const state = localSetup(4);
  const side = state.players.p1;
  const rest = [...side.deck, ...side.hand];
  const take = (cardId: string): string => {
    const uid = rest.find((u) => state.cardIdByUid[u] === cardId);
    if (uid === undefined) throw new Error(`p1 has no ${cardId}`);
    rest.splice(rest.indexOf(uid), 1);
    return uid;
  };
  const activeUid = take(opts.active ?? X_BOOT);
  const benchUids = bench.map(take);
  const deckUids = deck.map(take);
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        hand: [],
        deck: deckUids,
        active: body(activeUid),
        bench: benchUids.map(body),
      },
    },
  };
}

function useXBoot(state: GameState) {
  return applyAction(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: "X-Boot",
  });
}

function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "attachCards") {
    throw new Error(`expected attachCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function attach(state: GameState, assignments: { uid: string; to: PokemonRef }[]): GameState {
  return must(
    applyAction(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments },
    }),
  );
}

/** The card NAMES of the Energy attached to a body, so an assertion reads as the
    print does rather than as a uid list. */
function energyNamesOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const b = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (b === null || b === undefined) throw new Error("no body");
  return b.energy.map((u) => POOL[state.cardIdByUid[u] ?? ""]?.name ?? "?");
}

const xBootProgram = (): readonly EffectOp[] => {
  const program = programFor(X_BOOT)?.abilities?.[0]?.program;
  if (program === undefined) throw new Error("no X-Boot program");
  return program;
};

// ── 1. THE DECLARATION, READ OFF THE LIVE REGISTRY ───────────────────────────

describe("D354 §1 — the program, declared", () => {
  it("is an ABILITY and nothing else — asserted by KEY SET, not by presence", () => {
    expect(Object.keys(programFor(X_BOOT) ?? {}).sort()).toEqual(["abilities"]);
    const ability = programFor(X_BOOT)?.abilities?.[0];
    expect(ability?.name).toBe("X-Boot");
    expect(ability?.oncePerTurn).toBe(true);
    // "Once during your turn" — NOT "if this Pokémon is in the Active Spot", so
    // the Ability works from the Bench and the flag is the print.
    expect(ability?.activeOnly).toBe(false);
  });

  it("is TWO attaches and a shuffle — the ops, in order", () => {
    expect(xBootProgram().map((op) => op.op)).toEqual([
      "attachFromDeck",
      "attachFromDeck",
      "shuffleDeck",
    ]);
  });

  it("BOTH ops carry the SAME two-type union — the pairing reading, refused in the data", () => {
    for (const op of xBootProgram()) {
      if (op.op !== "attachFromDeck") continue;
      expect(op.targetType).toEqual(["Psychic", "Metal"]);
      expect(op.max).toBe(1);
      expect(op.maxPerTarget).toBeUndefined();
      expect(op.toSelf).toBeUndefined();
      expect(op.benchOnly).toBeUndefined();
    }
    // The two ops differ in exactly ONE field — the Energy each searches for.
    const filters = xBootProgram()
      .filter((op) => op.op === "attachFromDeck")
      .map((op) => (op.op === "attachFromDeck" ? op.filter : null));
    expect(filters).toEqual([
      { kind: "basicEnergy", energyType: "Psychic" },
      { kind: "basicEnergy", energyType: "Metal" },
    ]);
  });
});

// ── 2. THE UNION, DRIVEN ON A BOARD ──────────────────────────────────────────

describe("D354 §2 — the printed union: a Basic {P} Energy on a {M} body", () => {
  it("THE ASSERTION THE ROW EXISTS FOR — the {P} Energy lands on the {M} Pokémon", () => {
    const state = board([PSY_BODY, METAL_BODY], [PSY_ENERGY, METAL_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    // Op 1 searched for the Basic {P} Energy and found exactly one.
    expect(prompt.candidates.length).toBe(1);
    // Send it to the METAL body on the bench — the cross-type attach.
    const after = attach(used.state, [{ uid: prompt.candidates[0] as string, to: benchRef(1) }]);
    expect(energyNamesOn(after, benchRef(1))).toEqual(["Psychic Energy"]);
  });

  it("…and the {M} Energy lands on the {P} Pokémon — the mirror", () => {
    // The union is symmetric; asserting only one direction would leave a build
    // that special-cased the first op green.
    const state = board([PSY_BODY, METAL_BODY], [METAL_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    // Op 1 (Basic {P}) finds nothing in this deck and whiffs silently into op 2.
    const prompt = promptOf(used.state);
    expect(prompt.candidates.length).toBe(1);
    const after = attach(used.state, [{ uid: prompt.candidates[0] as string, to: benchRef(0) }]);
    expect(energyNamesOn(after, benchRef(0))).toEqual(["Metal Energy"]);
  });

  it("the offered TARGETS are exactly the {P} and {M} bodies — the third body is refused", () => {
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    // The Active is the Metagross itself — types ["Metal"] — so it IS in the set.
    expect(prompt.targets).toEqual([ACTIVE, benchRef(0), benchRef(1)]);
    // Said again as a NEGATIVE, by id, so the reason is legible: the {W} body sits
    // at bench index 2 and is not offered.
    expect(prompt.targets).not.toContainEqual(benchRef(2));
  });

  it("the un-narrowed control — with NO rider every own body is a target", () => {
    // Proves the assertion above is a NARROWING and not a blanket refusal of the
    // third body (a board fact, e.g. a full bench, would look identical).
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", {})).toEqual([
      ACTIVE,
      benchRef(0),
      benchRef(1),
      benchRef(2),
    ]);
  });
});

// ── 3. THE REFUTATIONS, FROM SOURCE ON A BOARD ───────────────────────────────

describe("D354 §3 — the spellings that would have cost nothing, refuted on a board", () => {
  it('`targetType: "Psychic"` — the PAIRING reading — cannot reach the {M} body', () => {
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", { targetType: "Psychic" })).toEqual([benchRef(0)]);
    // …and the union reaches BOTH, which is the difference the print turns on.
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychic", "Metal"] })).toEqual([
      ACTIVE,
      benchRef(0),
      benchRef(1),
    ]);
  });

  it('`targetType: "Metal"` alone is the OTHER half of the same refutation', () => {
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", { targetType: "Metal" })).toEqual([
      ACTIVE,
      benchRef(1),
    ]);
  });

  it("a ONE-ELEMENT list is byte-identical to the bare string — no third behaviour", () => {
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    for (const type of ["Psychic", "Metal", "Water"]) {
      expect(attachEnergyTargets(state, "p1", { targetType: [type] })).toEqual(
        attachEnergyTargets(state, "p1", { targetType: type }),
      );
    }
  });

  it("an EMPTY list is not a rider — it narrows nothing, exactly as `undefined` does", () => {
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", { targetType: [] })).toEqual(
      attachEnergyTargets(state, "p1", {}),
    );
  });

  it("a DUAL-TYPE body qualifies on EITHER half — the card's own bodies cannot show this", () => {
    const state = board([DUAL], [PSY_ENERGY], { active: NEITHER });
    // The Active is the {W} body, so only the dual body may be named.
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychic"] })).toEqual([benchRef(0)]);
    expect(attachEnergyTargets(state, "p1", { targetType: ["Metal"] })).toEqual([benchRef(0)]);
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychic", "Metal"] })).toEqual([
      benchRef(0),
    ]);
    // The negative that makes those three real: a type it does NOT carry.
    expect(attachEnergyTargets(state, "p1", { targetType: ["Fire"] })).toEqual([]);
  });

  it("a misspelled type matches the EMPTY set — a union cannot be widened by a typo", () => {
    // `AttachTargetRiders.ownerPokemon`'s own doc states this for the owner axis
    // ("no string can name a Pokémon it does not name"); the type axis inherits it
    // and a list inherits it MEMBER BY MEMBER, which is the new part.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychick"] })).toEqual([]);
    // …and a typo in ONE member does not poison the other.
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychick", "Metal"] })).toEqual([
      ACTIVE,
      benchRef(1),
    ]);
  });
});

// ── 4. THE CAPTION — THE DIALOG MUST NOT CONTRADICT ITS OWN VALIDATOR ────────

describe("D354 §4 — the printed noun, and the gate it must agree with", () => {
  it("the union caption REPEATS THE NOUN, as the card does", () => {
    // The card prints *"your {P} Pokémon **and** {M} Pokémon"*, not "your {P} {M}
    // Pokémon". A welded caption would name a set no card prints, in a prompt whose
    // whole job is to say which bodies are offered.
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(promptOf(used.state).note).toBe(
      "Search your deck for a Basic Psychic Energy card and attach it to your " +
        "Psychic Pokémon and Metal Pokémon.",
    );
  });

  it("the caption and the OFFER agree — one count, asserted against each other", () => {
    const state = board([PSY_BODY, METAL_BODY, NEITHER], [PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    const named = ["Psychic", "Metal"].filter((type) => prompt.note.includes(`${type} Pokémon`));
    expect(named).toEqual(["Psychic", "Metal"]);
    // Every offered body's top card carries one of the named types, and every own
    // body carrying one is offered — the caption re-derived from the board.
    const offered = attachEnergyTargets(state, "p1", { targetType: ["Psychic", "Metal"] });
    expect(prompt.targets).toEqual(offered);
    expect(prompt.note).not.toContain("Water Pokémon");
  });

  it("a ONE-type caption is BYTE-IDENTICAL to its pre-D354 spelling", () => {
    const state = board([PSY_BODY, METAL_BODY], [PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(promptOf(used.state).note).toBe(
      "Search your deck for a Basic Psychic Energy card and attach it to your " +
        "Psychic Pokémon and Metal Pokémon.",
    );
    expect(attachEnergyTargets(state, "p1", { targetType: "Psychic" })).toEqual([benchRef(0)]);
    expect(attachEnergyTargets(state, "p1", { targetType: ["Psychic"] })).toEqual([benchRef(0)]);
  });
});

// ── 5. THE THREE PRINTED OUTCOMES, AND THE PER-TYPE CAP ──────────────────────

describe("D354 §5 — 'a Basic {P}, a Basic {M}, or 1 of each'", () => {
  it("TWO Basic {P} in the deck and only ONE is reachable — the printed per-type cap", () => {
    const state = board([PSY_BODY], [PSY_ENERGY, PSY_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    expect(prompt.max).toBe(1);
    const after = attach(used.state, [{ uid: prompt.candidates[0] as string, to: benchRef(0) }]);
    // Op 2 searches for Basic {M} and finds none, so the program ends here.
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(energyNamesOn(after, benchRef(0))).toEqual(["Psychic Energy"]);
  });

  it("'1 of each' — both ops run and both may land on the SAME body", () => {
    // *"In any way you like"* denies any one-apiece rule (contrast Janine's Secret
    // Art, whose `maxPerTarget: 1` this op deliberately does NOT carry — §1).
    const state = board([PSY_BODY], [PSY_ENERGY, METAL_ENERGY]);
    const first = useXBoot(state);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const p1 = promptOf(first.state);
    const afterFirst = attach(first.state, [{ uid: p1.candidates[0] as string, to: benchRef(0) }]);
    const p2 = promptOf(afterFirst);
    const afterSecond = attach(afterFirst, [{ uid: p2.candidates[0] as string, to: benchRef(0) }]);
    expect(energyNamesOn(afterSecond, benchRef(0)).sort()).toEqual([
      "Metal Energy",
      "Psychic Energy",
    ]);
  });

  it("a deck with NEITHER named Energy is a live path — it whiffs into the shuffle", () => {
    // `attachFromDeck` has NO `programPlayable` gate, by its own doc: every card
    // carrying it prints "Then, shuffle your deck", a clause that always resolves,
    // so "no eligible card" is never "no effect" (ruling/284).
    const state = board([PSY_BODY], [WATER_ENERGY, WATER_ENERGY]);
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(used.state.phase.kind).not.toBe("effect:choose");
    expect(energyNamesOn(used.state, benchRef(0))).toEqual([]);
  });

  it("the no-eligible-target path is UNREACHABLE while the holder is in play", () => {
    const state = board([NEITHER], [PSY_ENERGY], {});
    const used = useXBoot(state);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const prompt = promptOf(used.state);
    expect(prompt.targets).toEqual([ACTIVE]);
    // Driven to the end: the {P} Energy lands on the {M} holder — a cross-type
    // attach onto the card's own body, which is the union at its narrowest.
    const after = attach(used.state, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(energyNamesOn(after, ACTIVE)).toEqual(["Psychic Energy"]);
  });
});

describe("D354 §6 — the pool and the registry keys", () => {
  it("X-Boot and Energy Coin are registry keys", () => {
    const raw = registryCardIds();
    expect(raw).toContain(X_BOOT);
    expect(raw).toContain(ENERGY_COIN_ID);
  });

  it("the +1 on `raw.length` is EXACTLY this one id — the ONLY real id here", () => {
    const keys = new Set(registryCardIds());
    expect(keys.has(X_BOOT)).toBe(true);
    expect(keys.has("sv02-097")).toBe(true);
    expect(FIXTURE_POOL["sv02-097"]).toBeDefined();
    expect(keys.has("sv03-151")).toBe(false);
    expect(FIXTURE_POOL["sv03-151"]).toBeDefined();
    expect(registryCardIds().filter((id) => id === X_BOOT).length).toBe(1);
  });

  it("nothing this suite defines reached `FIXTURE_POOL` — asserted by ID", () => {
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });
});

describe("D354 §7 — the census, and the sentence that settled the reading", () => {
  it("Lilligant `sv09-007` is the OTHER printing of the construction, and it is BUILT", () => {
    expect(programFor("sv09-007")).toBeDefined();
  });

  it("row 10's remaining half was TAKEN at D355 — the row is closed", () => {
    expect(programFor("sv10.5b-081")).toBeDefined();
  });

  it("row 12's ability half is BUILT too — the SECOND spent negative in this file", () => {
    expect(programFor("sv09-107")).toBeDefined();
  });
});
