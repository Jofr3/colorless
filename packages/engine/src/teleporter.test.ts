import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
  must,
  findEvent,
  driveSetup,
} from "./testFixtures";

const PRINTED =
  "Once during your turn, if this Pokémon is in the Active Spot, you may shuffle it and all attached cards into your deck.";

/** Dudunsparce's, kept here as the CONTROL for the clause this one prints —
    the pair is the whole reason `activeOnly` is a print and not a convenience. */
const DUDUNSPARCE_PRINTED =
  "Once during your turn, you may draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck.";

const CROBAT_PRINTED =
  "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)";

const ABRA = "sv06-080";
const FILLER = "fix-d312-filler";
const TOOL = "fix-d312-tool";
const ENERGY = "fix-d312-energy";

const LOCAL_CARDS: Record<string, Card> = {
  [ABRA]: battler(ABRA, {
    name: "Abra",
    hp: 70,
    stage: "Basic",
    retreat: 1,
    types: ["Psychic"],
    abilities: [{ type: "Ability", name: "Teleporter", effect: PRINTED }],
    attacks: [{ cost: ["Psychic"], name: "Beam", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D312 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TOOL]: trainerCard(TOOL, "Tool", "Attach to 1 of your Pokémon."),
  [ENERGY]: typedEnergy(ENERGY, "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({ [ABRA]: 4, [TOOL]: 2, [FILLER]: 16, [ENERGY]: 38 });

const SEEDS = [3121, 3127] as const;

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** p1 on its own turn with the Abra ACTIVE and `bench` filler bodies behind it —
    the ONLY board this card's Ability is legal on, which is the point. */
function active(bench: number, seed: number = SEEDS[0]): GameState {
  let state = localSetup(seed, "p2");
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", ABRA);
  state = clearBench(state, "p1");
  for (let i = 0; i < bench; i += 1) state = benchFromDeck(state, "p1", FILLER);
  return state;
}

/** p1 with a FILLER Active and the Abra BENCHED at index 0 — the board the
    printed Active-Spot clause REFUSES. */
function benched(seed: number = SEEDS[0]): GameState {
  let state = localSetup(seed, "p2");
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", FILLER);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", ABRA);
  return state;
}

const USE_ACTIVE = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Teleporter",
} as const;

const USE_BENCH = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Teleporter",
} as const;

/** TEST SURGERY — hang an Energy and a Tool on p1's ACTIVE, so "all ATTACHED
    cards" has something to be about. Both come off the deck, so every uid stays
    in exactly one zone. */
function loadActive(state: GameState): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.find((u) => state.cardIdByUid[u] === ENERGY);
  const tool = side.deck.find((u) => state.cardIdByUid[u] === TOOL);
  if (energy === undefined || tool === undefined) throw new Error("deck lacks an energy/tool");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, energy], tools: [...body.tools, tool] },
        deck: side.deck.filter((u) => u !== energy && u !== tool),
      },
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §1 — the print, the population, and the registry row that maps it", () => {
  it("the fixture carries the printed sentence VERBATIM", () => {
    expect(POOL[ABRA]?.abilities?.[0]?.effect).toBe(PRINTED);
    expect(POOL[ABRA]?.abilities?.[0]?.name).toBe("Teleporter");
  });

  it("the PRONOUN is the whole census correction — and the clause is the whole `activeOnly`", () => {
    expect(PRINTED).not.toContain("this Pokémon and all attached cards");
    expect(PRINTED).toContain("it and all attached cards");
    expect(DUDUNSPARCE_PRINTED).toContain("this Pokémon and all attached cards");
    expect(DUDUNSPARCE_PRINTED).not.toContain("it and all attached cards");
    // THE CONTROL PAIR. One card prints the Active-Spot clause and the other does
    // not, so neither flag is a convenience: both are transcriptions.
    expect(PRINTED).toContain("if this Pokémon is in the Active Spot");
    expect(DUDUNSPARCE_PRINTED).not.toContain("Active Spot");
  });

  it("the WORD-ORDER width is a THIRD axis, and neither earlier fix could reach it", () => {
    expect(CROBAT_PRINTED).not.toContain("this Pokémon and all attached cards");
    expect(CROBAT_PRINTED).not.toContain("it and all attached cards");
    expect(CROBAT_PRINTED).not.toContain("and all attached cards");
    expect(CROBAT_PRINTED).not.toContain("attached cards"); // ← the widest noun order
    // It matches only when the noun and the participle swap places.
    expect(CROBAT_PRINTED).toContain("cards attached to this Pokémon");
    // And it is the SAME mechanism: the body leaves play with its attachments.
    expect(CROBAT_PRINTED).toContain("put this Pokémon into your hand");
  });

  it("the registry row is `returnSelf` and NOTHING else — no wrapper, no gate", () => {
    const ability = programFor(ABRA)?.abilities?.[0];
    expect(ability?.name).toBe("Teleporter");
    expect(ability?.program).toEqual([{ op: "returnSelf", dest: "deck" }]);
    expect(JSON.stringify(ability?.program)).not.toContain("optional");
  });

  it("`activeOnly` is TRUE, `oncePerTurn` is the bare form, and nothing else is set", () => {
    const ability = programFor(ABRA)?.abilities?.[0];
    expect(ability?.activeOnly).toBe(true);
    // The Dudunsparce control, live off the registry rather than off this file.
    expect(programFor("sv05-129")?.abilities?.[0]?.activeOnly).toBe(false);
    expect(ability?.oncePerTurn).toBe(true); // not "sharedByName" — no rider is printed
    expect(ability?.playableIf).toBeUndefined();
    expect(ability?.remainingHpAtMost).toBeUndefined();
    expect(ability?.endsTurn).toBeUndefined();
  });

  it("the id is a registry key and there is NO reprint — one printing, one row", () => {
    const ids = registryCardIds();
    expect(ids).toContain(ABRA);
    const sharing = ids.filter((id) => programFor(id) === programFor(ABRA));
    expect(sharing).toEqual([ABRA]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §2 — the removal: the body and everything on it go into the deck", () => {
  for (const seed of SEEDS) {
    it(`shuffles the whole stack away and refills the spot (seed ${seed})`, () => {
      const before = loadActive(active(2, seed));
      const body = before.players.p1.active;
      if (body === null) throw new Error("no Active");
      const stack = [...body.stack, ...body.energy, ...body.tools];
      expect(stack).toHaveLength(3); // the Abra card, one Energy, one Tool
      const deckBefore = before.players.p1.deck.length;

      const { state: after, events } = apply(before, USE_ACTIVE);

      const deck = new Set(after.players.p1.deck);
      for (const uid of stack) expect(deck.has(uid), uid).toBe(true);
      expect(after.players.p1.deck).toHaveLength(deckBefore + 3);
      // Nothing leaked into another zone.
      for (const uid of stack) {
        expect(after.players.p1.hand).not.toContain(uid);
        expect(after.players.p1.discard).not.toContain(uid);
      }

      const returned = findEvent(events, "POKEMON_RETURNED");
      expect(returned).toMatchObject({ seat: "p1", actor: "p1", dest: "deck" });
      expect(new Set(returned?.uids ?? [])).toEqual(new Set(stack));
      expect(events.map((e) => e.type)).toContain("SHUFFLE");
    });
  }

  it("a SECOND Abra behind it is a promotion CANDIDATE, and it may teleport in turn", () => {
    let state = active(1);
    state = benchFromDeck(state, "p1", ABRA);
    expect(state.players.p1.bench).toHaveLength(2);
    const { state: after } = apply(state, USE_ACTIVE);
    // A Bench of TWO is a real choice, so the spot stays empty until it is answered.
    expect(after.phase).toEqual({ kind: "ko:promote", seat: "p1" });
    const abraIndex = after.players.p1.bench.findIndex(
      (b) => after.cardIdByUid[b.stack.at(-1) ?? ""] === ABRA,
    );
    expect(abraIndex).toBeGreaterThanOrEqual(0);
    const promoted = must(
      applyAction(after, { type: "promote", seat: "p1", benchIndex: abraIndex }),
    );
    // The second Abra is now Active and its OWN once-per-turn is untouched.
    expect(promoted.cardIdByUid[promoted.players.p1.active?.stack.at(-1) ?? ""]).toBe(ABRA);
    const { state: again } = apply(promoted, USE_ACTIVE);
    expect(again.cardIdByUid[again.players.p1.active?.stack.at(-1) ?? ""]).toBe(FILLER);
    expect(again.players.p1.bench).toHaveLength(0);
    expect(again.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §3 — the §8.1 PROMOTION, which THIS card owes UNCONDITIONALLY", () => {
  it("a Bench of TWO asks — PROMOTION_REQUIRED and the ko:promote phase", () => {
    const { state: after, events } = apply(active(2), USE_ACTIVE);
    expect(after.players.p1.active).toBeNull();
    expect(after.phase).toEqual({ kind: "ko:promote", seat: "p1" });
    expect(findEvent(events, "PROMOTION_REQUIRED")).toMatchObject({ seat: "p1" });
    const promoted = must(applyAction(after, { type: "promote", seat: "p1", benchIndex: 1 }));
    expect(promoted.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(promoted.players.p1.active).not.toBeNull();
    expect(promoted.players.p1.bench).toHaveLength(1);
  });

  it("a Bench of ONE does NOT ask — the M1 no-choice doctrine, auto-resolved", () => {
    const { state: after, events } = apply(active(1), USE_ACTIVE);
    expect(after.players.p1.active).not.toBeNull();
    expect(after.players.p1.bench).toHaveLength(0);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    // A choice with no choice in it is not a choice, so no prompt is raised.
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
  });

  it("a Bench of NONE is the §14.2 LOSS — and it costs no code at all", () => {
    const { state: after, events } = apply(active(0), USE_ACTIVE);
    expect(after.phase.kind).toBe("gameOver");
    const over = findEvent(events, "GAME_OVER");
    expect(over?.outcome).toMatchObject({ result: "win", winner: "p2" });
  });

  it("the promotion is queued by the SEAM and not by a Knock Out — no KO event fires", () => {
    const before = active(2);
    const prizes = before.players.p2.prizes.length;
    const { state: after, events } = apply(before, USE_ACTIVE);
    const types = events.map((e) => e.type);
    expect(types).not.toContain("KNOCKED_OUT");
    expect(types).not.toContain("PRIZES_TAKEN");
    expect(after.players.p2.prizes).toHaveLength(prizes);
    expect(after.pending.filter((s) => s.kind === "promote")).toEqual([
      { kind: "promote", seat: "p1" },
    ]);
    expect(after.phase).toEqual({ kind: "ko:promote", seat: "p1" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §4 — `activeOnly` REFUSES the bench, which is the printed clause", () => {
  it("a BENCHED Abra cannot teleport", () => {
    const result = applyAction(benched(), USE_BENCH);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // The refusal is the Ability gate, not a missing ability or a wrong seat.
    expect(result.error.code).not.toBe("WRONG_SEAT");
  });

  it("…and the CONTROL: a benched DUDUNSPARCE still may, on the same engine", () => {
    expect(programFor("sv05-129")?.abilities?.[0]?.activeOnly).toBe(false);
    expect(programFor(ABRA)?.abilities?.[0]?.activeOnly).toBe(true);
  });

  it("the board is untouched by the refusal — no partial removal", () => {
    const before = benched();
    const stackBefore = before.players.p1.bench[0]?.stack ?? [];
    const deckBefore = before.players.p1.deck.length;
    const result = applyAction(before, USE_BENCH);
    expect(result.ok).toBe(false);
    // The refused action left the Abra standing with its stack intact.
    expect(before.players.p1.bench[0]?.stack).toEqual(stackBefore);
    expect(before.players.p1.deck).toHaveLength(deckBefore);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §5 — the family's remaining printings, asserted UNBUILT", () => {
  const UNBUILT = [
    "sv06-043", // Poliwrath — a decision in front of the DAMAGE FOLD, not a field
  ] as const;

  it("the one bare refusal left carries NO registry program", () => {
    for (const id of UNBUILT) expect(programFor(id), id).toBeUndefined();
    for (const id of ["sv06.5-015", "sv09-068", "sv10-122"]) {
      expect(programFor(id), id).toBeDefined();
    }
  });

  it("the five INDEX-PRECISE rows are now index-precise BUILDS — the lesson survives the build", () => {
    const comfey = programFor("sv09-068");
    expect(comfey?.attack?.[0]).toBeDefined();
    expect(comfey?.attack?.[1]).toEqual([{ op: "returnSelf", dest: "hand" }]);
    expect(comfey?.abilities).toBeUndefined();

    for (const id of ["sv10-122", "sv10-217", "sv10-234", "sv10-242"]) {
      const crobat = programFor(id);
      expect(crobat?.triggered, id).toHaveLength(1);
      expect(crobat?.attack?.[0], id).toBeDefined();
      expect(crobat?.attack?.[1], id).toBeUndefined();
    }

    // Revavroom ex — index 1 ONLY. Index 0 is "Accelerator Flash", a
    // moved-from-the-Bench conditional this engine does not read, and it must stay
    // UNSIMULATED rather than inherit the self-discard.
    for (const id of ["sv06.5-015", "sv06.5-081"]) {
      expect(programFor(id)?.attack?.[0], id).toBeUndefined();
      expect(programFor(id)?.attack?.[1], id).toEqual([{ op: "returnSelf", dest: "discard" }]);
    }
  });

  it("the built half of the family is exactly TWELVE printings — re-pointed at D314", () => {
    const built = [
      "sv05-129",
      "sv08.5-080",
      ABRA,
      "sv08-131",
      "sv09-068",
      "sv06.5-015",
      "sv06.5-081",
      "sv10-122",
      "sv10-217",
      "sv10-234",
      "sv10-242",
      "sv07-011",
    ];
    expect(built).toHaveLength(12);
    for (const id of built) expect(programFor(id), id).toBeDefined();
    expect(programFor("sv05-129")).toBe(programFor("sv08.5-080"));
    expect(programFor(ABRA)).not.toBe(programFor("sv05-129"));
    expect(programFor("sv08-131")).not.toBe(programFor(ABRA));
    for (const id of ["sv05-129", "sv08.5-080", ABRA]) {
      expect(programFor(id)?.abilities, id).toHaveLength(1);
    }
    for (const id of ["sv08-131", "sv09-068", "sv06.5-015", "sv06.5-081", "sv07-011"]) {
      expect(programFor(id)?.abilities, id).toBeUndefined();
    }
    for (const id of ["sv10-122", "sv10-217", "sv10-234", "sv10-242"]) {
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.triggered, id).toHaveLength(1);
    }
  });
});
