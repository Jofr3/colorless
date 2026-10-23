import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { applyChoice } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  deckOf,
  itemTrainer,
  typedEnergy,
  driveSetup,
} from "./testFixtures";

const METANG_IDS = ["svp-090", "sv05-114"] as const;
const METANG = "sv05-114";
const MORPEKO = "sv06-072";
const HYDREIGON = "sv02-140";

const METAL_TEXT =
  "Once during your turn, you may look at the top 4 cards of your deck and attach " +
  "any number of Basic {M} Energy cards you find there to your Pokémon in any way " +
  "you like. Shuffle the other cards and put them on the bottom of your deck.";
const SNACK_TEXT =
  "Once during your turn, you may look at the top card of your deck. You may discard that card.";

const METAL = "d352-metal-energy";
const FIRE = "d352-fire-energy";
const JUNK = "d352-junk-item";
const BUDDY = "d352-buddy";

const LOCAL_CARDS: Record<string, Card> = Object.fromEntries(
  METANG_IDS.map((id) => [
    id,
    battler(id, {
      name: "Metang",
      stage: "Stage1",
      evolveFrom: "Beldum",
      hp: 100,
      retreat: 2,
      types: ["Metal"],
      abilities: [{ type: "Ability", name: "Metal Maker", effect: METAL_TEXT }],
    }),
  ]),
);
LOCAL_CARDS[MORPEKO] = battler(MORPEKO, {
  name: "Morpeko",
  hp: 70,
  types: ["Lightning"],
  abilities: [{ type: "Ability", name: "Snack Seek", effect: SNACK_TEXT }],
});
LOCAL_CARDS[BUDDY] = battler(BUDDY, { name: "D352 Buddy", hp: 70 });
LOCAL_CARDS[METAL] = typedEnergy(METAL, "Metal");
LOCAL_CARDS[FIRE] = typedEnergy(FIRE, "Fire");
LOCAL_CARDS[JUNK] = itemTrainer(JUNK);

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [METANG]: 4,
  [METANG_IDS[0]]: 2,
  [MORPEKO]: 4,
  [BUDDY]: 14,
  [METAL]: 14,
  [FIRE]: 12,
  [JUNK]: 10,
});

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const BENCH_REF: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p1" });
}

function board(activeId: string, top: readonly string[]): GameState {
  const state = localSetup(4);
  const side = state.players.p1;
  const pool = [...side.deck, ...side.hand];
  const rest = [...pool];
  const take = (cardId: string): string => {
    const uid = rest.find((u) => state.cardIdByUid[u] === cardId);
    if (uid === undefined) throw new Error(`p1 has no ${cardId}`);
    rest.splice(rest.indexOf(uid), 1);
    return uid;
  };
  const activeUid = take(activeId);
  const benchUid = take(BUDDY);
  const topUids = top.map(take);
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
        deck: [...topUids, ...rest, ...side.bench.flatMap((b) => b.stack)],
        active: body(activeUid),
        bench: [body(benchUid)],
      },
    },
  };
}

const useAbility = (state: GameState, abilityName: string) =>
  apply(state, { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName });

function census(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

const metalProgram = (): readonly EffectOp[] => {
  const program = programFor(METANG)?.abilities?.[0]?.program;
  if (program === undefined) throw new Error("Metal Maker has no program");
  return program;
};

describe("D352 §1 — the registry SHAPE, read off `programFor` before any board runs", () => {
  it("Metal Maker is ONE `attachFromTop` and every field is the printed word", () => {
    expect(metalProgram()).toEqual([
      {
        op: "attachFromTop",
        n: 4,
        filter: { kind: "basicEnergy", energyType: "Metal" },
        max: "any",
        restTo: "shuffledBottom",
      },
    ]);
  });

  it("Snack Seek is ONE `lookAtTopN` and it is the deriver's op field for field", () => {
    expect(programFor(MORPEKO)?.abilities?.[0]?.program).toEqual([
      { op: "lookAtTopN", n: 1, filter: { kind: "anyCard" }, max: 1, dest: "discard" },
    ]);
  });

  it("neither program carries an `attack` key — the `BUILT.attack` summand CANNOT move", () => {
    for (const id of [...METANG_IDS, MORPEKO]) {
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    }
  });

  it("both Metang printings share ONE program object; Morpeko has its own", () => {
    expect(programFor(METANG_IDS[0])).toBe(programFor(METANG_IDS[1]));
    expect(programFor(MORPEKO)).not.toBe(programFor(METANG));
  });
});

describe("D352 §2 — the leftovers really go UNDER the deck, shuffled, and announce nothing", () => {
  /** Top 4 = Metal, Fire, Metal, Junk. Two candidates the filter admits, and two
      cards it does not — so the leftovers are never empty and never all-candidates. */
  const TOP = [METAL, FIRE, METAL, JUNK] as const;

  it("two attach to TWO DIFFERENT bodies and the other two land at the BOTTOM", () => {
    const state = board(METANG, TOP);
    const before = census(state, "p1");
    const deckBefore = state.players.p1.deck;
    const [m1, fire, m2, junk] = deckBefore as [string, string, string, string];
    const tailBefore = deckBefore.slice(4);

    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: m1, to: ACTIVE_REF },
          { uid: m2, to: BENCH_REF },
        ],
      },
    });
    const side = done.state.players.p1;

    // The MAP answer: each card named its own destination. This is refutation (c)
    // driven — no `lookAtTopN` `dest` can put two cards on two different bodies.
    expect(side.active?.energy).toEqual([m1]);
    expect(side.bench[0]?.energy).toEqual([m2]);

    expect(side.deck.slice(-2).sort()).toEqual([fire, junk].sort());

    expect(side.deck.slice(0, tailBefore.length)).toEqual(tailBefore);

    expect(side.discard).toEqual(state.players.p1.discard);
    expect(done.events.filter((e) => e.type === "DECK_TOP_DISCARDED")).toEqual([]);
    expect(done.events.filter((e) => e.type === "SHUFFLE")).toEqual([]);

    // Nothing was created or destroyed anywhere on the way.
    expect(census(done.state, "p1")).toEqual(before);
    expect(side.deck).toHaveLength(deckBefore.length - 2);
  });

  it("the two bottomed cards are SHUFFLED — `rngState` is spent and written back", () => {
    const state = board(METANG, TOP);
    const [m1] = state.players.p1.deck as [string];
    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
    });
    // Three cards left over here (Fire, Metal, Junk), so Fisher-Yates really runs.
    expect(done.state.players.p1.deck.slice(-3)).toHaveLength(3);
    expect(done.state.rngState).not.toBe(parked.state.rngState);
  });

  it("a ONE-card leftover consumes no randomness — the loop starts at `length - 1`", () => {
    const state = board(METANG, [METAL, METAL, METAL, FIRE]);
    const deck = state.players.p1.deck;
    const [a, b, c] = deck as [string, string, string];
    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: a, to: ACTIVE_REF },
          { uid: b, to: BENCH_REF },
          { uid: c, to: ACTIVE_REF },
        ],
      },
    });
    expect(done.state.rngState).toBe(parked.state.rngState);
  });
});

describe("D352 §3 — the clause is a COST: it runs on the whiff and on the decline", () => {
  it("a window with NO Metal still bottoms all four", () => {
    const state = board(METANG, [FIRE, JUNK, FIRE, JUNK]);
    const before = census(state, "p1");
    const window = state.players.p1.deck.slice(0, 4);
    const tailBefore = state.players.p1.deck.slice(4);
    // No candidate, so the op never parks — the empty branch is routed through the
    // one apply rather than returning early, which is what keeps the clause charged.
    const done = useAbility(state, "Metal Maker");
    const side = done.state.players.p1;
    expect(side.deck.slice(-4).sort()).toEqual([...window].sort());
    expect(side.deck.slice(0, tailBefore.length)).toEqual(tailBefore);
    expect(side.active?.energy).toEqual([]);
    expect(census(done.state, "p1")).toEqual(before);
  });

  it("attaching NONE still bottoms all four — the decline is not a no-op", () => {
    const state = board(METANG, [METAL, FIRE, METAL, JUNK]);
    const window = state.players.p1.deck.slice(0, 4);
    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    const side = done.state.players.p1;
    expect(side.deck.slice(-4).sort()).toEqual([...window].sort());
    expect(side.active?.energy).toEqual([]);
    expect(side.discard).toEqual(state.players.p1.discard);
  });
});

describe("D352 §4 — the RENAME did not move the discard arm: Tri Howl is unchanged", () => {
  it('`restTo: "discard"` still discards, still emits, still credits the looker', () => {
    const state = board(METANG, [METAL, FIRE, JUNK]);
    const [m1, fire, junk] = state.players.p1.deck as [string, string, string];
    const events: GameEvent[] = [];
    const after = applyChoice(
      state,
      { op: "attachFromTop", n: 3, filter: { kind: "anyEnergy" }, max: "any", restTo: "discard" },
      { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
      { seat: "p1" },
      {},
      events,
    );
    expect(after.players.p1.active?.energy).toEqual([m1]);
    expect(after.players.p1.discard.slice(-2)).toEqual([fire, junk]);
    const rows = events.filter((e) => e.type === "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seat: "p1", actor: "p1", uids: [fire, junk] });
    // The bottomed path is NOT taken: the deck lost the window and gained nothing.
    expect(after.players.p1.deck).toHaveLength(state.players.p1.deck.length - 3);
  });

  it("the registry row for Hydreigon carries the RENAMED key and the same value", () => {
    expect(programFor(HYDREIGON)?.abilities?.[0]?.program).toEqual([
      { op: "attachFromTop", n: 3, filter: { kind: "anyEnergy" }, max: "any", restTo: "discard" },
    ]);
  });
});

describe("D352 §5 — Morpeko: look at one card, and the second 'you may' is the decline", () => {
  it("discarding the top card is the whole effect — no shuffle, no leftovers", () => {
    const state = board(MORPEKO, [JUNK, FIRE]);
    const [top, second] = state.players.p1.deck as [string, string];
    const before = census(state, "p1");
    const parked = useAbility(state, "Snack Seek");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [top] },
    });
    const side = done.state.players.p1;
    expect(side.discard.slice(-1)).toEqual([top]);
    expect(side.deck[0]).toBe(second);
    expect(done.state.rngState).toBe(parked.state.rngState);
    expect(census(done.state, "p1")).toEqual(before);
  });

  it("declining keeps the card on top — and that is the printed second 'you may'", () => {
    // The park's own decline, not a second op: the player is shown one card and
    // answers with it or with nothing. On the decline a shuffle would scramble a
    // top the player deliberately kept, which is the opposite of what the card offers.
    const state = board(MORPEKO, [JUNK, FIRE]);
    const [top] = state.players.p1.deck as [string];
    const parked = useAbility(state, "Snack Seek");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.state.players.p1.deck[0]).toBe(top);
    expect(done.state.players.p1.discard).toEqual(state.players.p1.discard);
  });

  it("it is the ONE id in this slice that `revealClause`'s sweep can see", () => {
    const opsOf = (id: string) =>
      (programFor(id)?.abilities?.[0]?.program ?? []).map((op) => op.op);
    expect(opsOf(MORPEKO)).toEqual(["lookAtTopN"]);
    for (const id of METANG_IDS) expect(opsOf(id), id).toEqual(["attachFromTop"]);
  });
});

describe("D352 §6 — the ability is once per turn and works from the Bench", () => {
  it("a second use in the same turn is refused", () => {
    const state = board(METANG, [METAL, FIRE, JUNK, FIRE]);
    const [m1] = state.players.p1.deck as [string];
    const parked = useAbility(state, "Metal Maker");
    const done = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
    });
    const again = applyAction(done.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Metal Maker",
    });
    expect(again.ok).toBe(false);
  });

  it("`activeOnly` is absent on both rows — §9's default, and the print never says it", () => {
    for (const id of [...METANG_IDS, MORPEKO]) {
      expect(programFor(id)?.abilities?.[0]?.activeOnly, id).toBe(false);
      expect(programFor(id)?.abilities?.[0]?.oncePerTurn, id).toBe(true);
    }
  });
});

describe("D352 §7 — the v20 MISREAD, DRIVEN: why `MATCH_RECORD_VERSION` had to move", () => {
  it("a parked op carrying the OLD `discardRest` key leaves the cards on the deck", () => {
    const state = board(METANG, [METAL, FIRE, JUNK]);
    const [m1, fire, junk] = state.players.p1.deck as [string, string, string];
    const legacyOp = {
      op: "attachFromTop",
      n: 3,
      filter: { kind: "anyEnergy" },
      max: "any",
      discardRest: true,
    } as unknown as EffectOp;
    const events: GameEvent[] = [];
    const after = applyChoice(
      state,
      legacyOp,
      { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
      { seat: "p1" },
      {},
      events,
    );
    // The attach still happens — which is exactly what makes it silent.
    expect(after.players.p1.active?.energy).toEqual([m1]);
    // …and the two cards the record said to DISCARD are still sitting on top.
    expect(after.players.p1.deck.slice(0, 2)).toEqual([fire, junk]);
    expect(after.players.p1.discard).toEqual(state.players.p1.discard);
    expect(events.filter((e) => e.type === "DECK_TOP_DISCARDED")).toEqual([]);
    // The other direction — the SAME op under this deploy's key does pay the cost.
    const fixed: EffectOp = {
      op: "attachFromTop",
      n: 3,
      filter: { kind: "anyEnergy" },
      max: "any",
      restTo: "discard",
    };
    const good = applyChoice(
      state,
      fixed,
      { kind: "attachCards", assignments: [{ uid: m1, to: ACTIVE_REF }] },
      { seat: "p1" },
      {},
      [],
    );
    expect(good.players.p1.discard.slice(-2)).toEqual([fire, junk]);
  });
});

describe("D352 §8 — the census rungs this row is answerable to", () => {
  it("nothing this file defines reached `FIXTURE_POOL` — asserted BY ID", () => {
    for (const id of [...METANG_IDS, MORPEKO, BUDDY, METAL, FIRE, JUNK]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });

  it("the THREE ids are CONTIGUOUS in registry order — the permanent rung", () => {
    const raw = registryCardIds();
    const first = raw.indexOf(METANG_IDS[0]);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(raw.slice(first, first + 3)).toEqual([...METANG_IDS, MORPEKO]);
  });

  it("all THREE real ids are registry keys, and the synthetic bodies are not", () => {
    const keys = new Set(registryCardIds());
    for (const id of [...METANG_IDS, MORPEKO]) expect(keys.has(id), id).toBe(true);
    for (const id of [BUDDY, METAL, FIRE, JUNK]) expect(keys.has(id), id).toBe(false);
  });

  it("the printed sentences are on the fixture bodies, so a census can SEE them", () => {
    for (const id of METANG_IDS) {
      expect(LOCAL_CARDS[id]?.abilities?.[0]?.effect).toBe(METAL_TEXT);
    }
    expect(LOCAL_CARDS[MORPEKO]?.abilities?.[0]?.effect).toBe(SNACK_TEXT);
  });
});
