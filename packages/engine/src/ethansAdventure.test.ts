import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  ETHANS_ADVENTURE_DECK,
  FIXTURE_POOL,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
} from "./testFixtures";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ETHANS_ADVENTURE_DECK, p2: ETHANS_ADVENTURE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function deckUids(state: GameState, id: string): string[] {
  return state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === id);
}

/** Play `id` out of p1's hand and return the parked chooseCards prompt with it.
    Neither this card nor the Energy Search control carries a cost op, so the
    FIRST park is the search in both cases. */
function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const uid = handUid(withCard, "p1", id);
  const { state: parked, events } = mustApply(withCard, {
    type: "playTrainer",
    seat: "p1",
    uid,
  });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt, events, seeded: withCard };
}

const ETHANS_ADVENTURE_IDS = ["sv10-165", "sv10-221", "sv10-236"] as const;

describe("D337 — Ethan's Adventure, a flat cap over an owner-prefixed union", () => {
  // ── §1 THE PRINTED SHAPE, READ OFF THE REGISTRY BEFORE ANY BOARD RUNS ──────

  it("the registry resolves a program for all THREE printings AND for the demonstrator", () => {
    for (const id of ETHANS_ADVENTURE_IDS) expect(programFor(id), id).toBeDefined();
    expect(programFor("fix-ethansadventure")).toBeDefined();
  });

  it("the three printings share ONE program object — reprints, not three authorings", () => {
    const first = programFor("sv10-165");
    for (const id of ETHANS_ADVENTURE_IDS) expect(programFor(id), id).toBe(first);
    expect(programFor("fix-ethansadventure")).toBe(first);
  });

  it("the program is `anyOf` under a FLAT cap — and carries NO `also`", () => {
    const op = programFor("fix-ethansadventure")?.trainer?.[0];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    expect(op).toEqual({
      op: "searchDeck",
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "ownerPokemon", owner: "Ethan" },
          { kind: "basicEnergy", energyType: "Fire" },
        ],
      },
      dest: "hand",
      max: 3,
      reveal: true,
    });
    expect(op.also).toBeUndefined();
  });

  it("the row is TWO ops and the second is the printed trailing shuffle", () => {
    const program = programFor("fix-ethansadventure");
    expect(program?.trainer).toHaveLength(2);
    expect(program?.trainer?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("the `ownerPokemon` member carries NO `stage` — the print names none", () => {
    const op = programFor("fix-ethansadventure")?.trainer?.[0];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    if (op.filter.kind !== "anyOf") throw new Error("expected an anyOf filter");
    const [pokemon] = op.filter.filters;
    if (pokemon?.kind !== "ownerPokemon") throw new Error("expected ownerPokemon first");
    expect(pokemon.stage).toBeUndefined();
    expect(pokemon.owner).toBe("Ethan");
  });

  it("the demonstrator carries the printed bytes, and all three printings are Supporters", () => {
    expect(FIXTURE_POOL["fix-ethansadventure"]?.effect).toBe(
      "Search your deck for up to 3 in any combination of Ethan's Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    );
    expect(FIXTURE_POOL["fix-ethansadventure"]?.trainerType).toBe("Supporter");
  });

  // ── §2 THE UNION — WHAT IT ADMITS AND WHAT IT REFUSES ─────────────────────

  it("offers BOTH members — an Ethan's Pokémon and a Basic {R} Energy", () => {
    const state = board(3);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).toContain(deckUids(parked, "fix-ethans-cyndaquil")[0]);
    expect(prompt.candidates).toContain(deckUids(parked, "fix-fire-energy")[0]);
  });

  it("admits an Ethan's STAGE 2 — the printed noun carries no stage", () => {
    const state = board(4);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).toContain(deckUids(parked, "fix-ethans-typhlosion")[0]);
  });

  it("admits an Ethan's {L} Pokémon — the noun is OWNER-narrowed, not TYPE-narrowed", () => {
    const state = board(5);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).toContain(deckUids(parked, "fix-ethans-pichu")[0]);
  });

  it("REFUSES a {R} Pokémon with no owner prefix — one printed word apart", () => {
    const state = board(6);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    // Same category, same stage, same type as `fix-ethans-cyndaquil`; the ONLY
    // difference is the printed possessive.
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-plain-cyndaquil")[0]);
  });

  it("REFUSES a Basic Energy of another type — the printed {R} on the second member", () => {
    const state = board(7);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-grass-energy")[0]);
  });

  it('REFUSES a SPECIAL Energy — the printed "Basic"', () => {
    const state = board(8);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-special")[0]);
  });

  it("REFUSES an owner-prefixed NON-Pokémon — `ownerPokemon`'s category conjunct", () => {
    const state = board(9);
    const { prompt, parked } = play(state, "fix-ethansadventure");
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-tr-energy")[0]);
  });

  it("the ATTRIBUTION CONTROL — Energy Search offers what this card refuses", () => {
    const state = board(10);
    const { prompt, parked } = play(state, "sv01-172");
    expect(prompt.candidates).toContain(deckUids(parked, "fix-grass-energy")[0]);
    expect(prompt.candidates).toContain(deckUids(parked, "fix-fire-energy")[0]);
    expect(prompt.candidates).not.toContain(deckUids(parked, "fix-ethans-cyndaquil")[0]);
    expect(prompt.max).toBe(1);
  });

  // ── §3 THE FLAT CAP — "IN ANY COMBINATION", NOT "ONE OF EACH" ─────────────

  it("the cap is a FLAT 3 over the whole union, and carries no per-group caps", () => {
    const state = board(11);
    const { prompt } = play(state, "fix-ethansadventure");
    expect(prompt.max).toBe(3);
    expect(prompt.caps ?? []).toEqual([]);
  });

  it('THREE ETHAN\'S POKÉMON IS A LEGAL ANSWER — "in any combination", not "one of each"', () => {
    const state = board(12);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const b = deckUids(parked, "fix-ethans-typhlosion")[0] as string;
    const c = deckUids(parked, "fix-ethans-pichu")[0] as string;
    expect(new Set([a, b, c]).size).toBe(3);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a, b, c] },
    });

    expect(done.phase.kind).toBe("turn:action");
    for (const uid of [a, b, c]) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.deck).not.toContain(uid);
    }
    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.reveal).toBe(true);
    expect(new Set(searched?.uids)).toEqual(new Set([a, b, c]));
  });

  it("THREE BASIC {R} ENERGY IS ALSO LEGAL — the union's OTHER member, alone", () => {
    const state = board(13);
    const { parked } = play(state, "fix-ethansadventure");
    const energy = deckUids(parked, "fix-fire-energy").slice(0, 3);
    expect(energy).toHaveLength(3);

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: energy },
    });
    expect(done.phase.kind).toBe("turn:action");
    for (const uid of energy) expect(done.players.p1.hand).toContain(uid);
  });

  it("A MIXTURE IS LEGAL — two Pokémon and one Energy, the printed grammar", () => {
    const state = board(14);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const b = deckUids(parked, "fix-ethans-pichu")[0] as string;
    const e = deckUids(parked, "fix-fire-energy")[0] as string;

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a, b, e] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toContain(a);
    expect(done.players.p1.hand).toContain(b);
    expect(done.players.p1.hand).toContain(e);
  });

  it("REFUSES a FOURTH card — the flat total is the only thing bounding the answer", () => {
    const state = board(15);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const b = deckUids(parked, "fix-ethans-typhlosion")[0] as string;
    const c = deckUids(parked, "fix-ethans-pichu")[0] as string;
    const d = deckUids(parked, "fix-fire-energy")[0] as string;
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, b, c, d] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("REFUSES a refused card even inside an otherwise legal answer", () => {
    // The union is a filter on EVERY uid in the answer, not a property of the
    // answer's size: two admitted cards plus one refused one is under the cap and
    // must still be rejected.
    const state = board(16);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const e = deckUids(parked, "fix-fire-energy")[0] as string;
    const bad = deckUids(parked, "fix-plain-cyndaquil")[0] as string;
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, e, bad] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it('takes FEWER than the cap — the printed "up to"', () => {
    const state = board(17);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toContain(a);
  });

  it('takes NOTHING — the empty answer the printed "up to" also permits', () => {
    const state = board(18);
    const { parked } = play(state, "fix-ethansadventure");
    const handBefore = parked.players.p1.hand.length;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand.length).toBe(handBefore);
  });

  // ── §4 THE CAPTION — THE CLAUSE THE PRICE WAS FLAGGED ON ──────────────────

  it('the caption joins with " or " — the THIRD witness, settled at D264', () => {
    const state = board(19);
    const { prompt } = play(state, "fix-ethansadventure");
    expect(prompt.note).toBe(
      "Search your deck for up to 3 Ethan's Pokémon or Basic Fire Energy cards into your hand.",
    );
  });

  it("the caption spells NO serial comma — this is the single-group arm", () => {
    const state = board(20);
    const { prompt } = play(state, "fix-ethansadventure");
    expect(prompt.note).not.toContain(", and ");
    expect(prompt.note).not.toContain(" and ");
    expect(prompt.note).toContain(" or ");
  });

  // ── §5 THE EPILOGUE — THE PRINTED SHUFFLE AND THE PLAYED CARD ─────────────

  it('the deck is SHUFFLED after the search — the printed "Then, shuffle your deck"', () => {
    const state = board(21);
    const { parked } = play(state, "fix-ethansadventure");
    const a = deckUids(parked, "fix-ethans-cyndaquil")[0] as string;
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a] },
    });
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  it("the Supporter itself is in the DISCARD once the row resolves", () => {
    const state = board(22);
    const withCard = handFromDeck(state, "p1", "fix-ethansadventure", 1);
    const uid = handUid(withCard, "p1", "fix-ethansadventure");
    const { state: parked } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
    expect(parked.players.p1.discard).toContain(uid);
  });
});
