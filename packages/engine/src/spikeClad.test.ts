import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { programPlayable } from "./cardplay";
import { firstAttachableEnergy } from "./interpreter";
import { programFor } from "./registry";
import {
  battler,
  deckOf,
  itemTrainer,
  specialEnergy,
  typedEnergy,
  must,
  driveSetup,
  programmedCardIds,
} from "./testFixtures";

const LYCANROC_IDS = ["sv09-085", "sv09-166"] as const;
const LYCANROC = "sv09-085";
const ROCKRUFF = "d353-rockruff";

const SPIKE_CLAD_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, " +
  "you may attach up to 2 Spiky Energy cards from your discard pile to this Pokémon.";

const SPIKY = "sv09-159";
const SPIKY_ALT = "sv09-190"; // Spiky Energy — the REAL reprint, same NAME

const MIST = "sv05-161";
const FIGHTING = "d353-fighting";
const THERAPEUTIC = "d353-therapeutic";
const BUDDY = "d353-buddy";
const JUNK = "d353-junk";

const LOCAL_CARDS: Record<string, Card> = Object.fromEntries(
  LYCANROC_IDS.map((id) => [
    id,
    battler(id, {
      name: "Lycanroc",
      stage: "Stage1",
      evolveFrom: "Rockruff",
      hp: 130,
      retreat: 2,
      types: ["Fighting"],
      abilities: [{ type: "Ability", name: "Spike-Clad", effect: SPIKE_CLAD_TEXT }],
    }),
  ]),
);
LOCAL_CARDS[ROCKRUFF] = battler(ROCKRUFF, { name: "Rockruff", hp: 70, types: ["Fighting"] });
LOCAL_CARDS[BUDDY] = battler(BUDDY, { name: "D353 Buddy", hp: 70 });
LOCAL_CARDS[SPIKY] = specialEnergy(SPIKY, "Spiky Energy");
LOCAL_CARDS[SPIKY_ALT] = specialEnergy(SPIKY_ALT, "Spiky Energy");
LOCAL_CARDS[MIST] = specialEnergy(MIST, "Mist Energy");
LOCAL_CARDS[THERAPEUTIC] = specialEnergy(THERAPEUTIC, "Therapeutic Energy");
LOCAL_CARDS[FIGHTING] = typedEnergy(FIGHTING, "Fighting");
LOCAL_CARDS[JUNK] = itemTrainer(JUNK);

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [LYCANROC]: 4,
  [LYCANROC_IDS[1]]: 2,
  [ROCKRUFF]: 6,
  [BUDDY]: 12,
  [SPIKY]: 8,
  [SPIKY_ALT]: 4,
  [MIST]: 6,
  [THERAPEUTIC]: 4,
  [FIGHTING]: 8,
  [JUNK]: 6,
});

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}

function idOf(state: GameState, uid: string): string {
  return state.cardIdByUid[uid] ?? "";
}

function passTo(state: GameState, turn: number): GameState {
  let next = state;
  while (next.turn < turn) {
    if (next.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${next.phase.kind} while passing to turn ${turn}`);
    }
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p1" });
}

function board(
  pile: readonly string[],
  opts: { readonly lycanroc?: string; readonly bench?: readonly string[] } = {},
): { state: GameState; evolveUid: string } {
  const base = passTo(localSetup(7), 3);
  const side = base.players.p1;
  const lycanroc = opts.lycanroc ?? LYCANROC;

  // Pull the exact cards this board needs out of the deck, by id, in order.
  const deck = [...side.deck];
  const take = (cardId: string): string => {
    const index = deck.findIndex((uid) => idOf(base, uid) === cardId);
    if (index < 0) throw new Error(`deck has no ${cardId}`);
    return deck.splice(index, 1)[0] as string;
  };
  const activeUid = take(ROCKRUFF);
  const benchUids = (opts.bench ?? []).map(take);
  const evolveUid = take(lycanroc);
  const pileUids = pile.map(take);

  // The setup's own Active is the BLANK a fresh body is spread from, so every
  // field this suite does not name keeps the shape `createGame` produced.
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });

  const state: GameState = {
    ...base,
    players: {
      ...base.players,
      p1: {
        ...side,
        deck: [...deck, ...side.bench.flatMap((b) => b.stack), ...blank.stack],
        hand: [evolveUid],
        discard: [...side.discard, ...pileUids],
        active: body(activeUid),
        bench: benchUids.map(body),
      },
    },
  };
  return { state, evolveUid };
}

function evolveActive(state: GameState, uid: string): { state: GameState; events: GameEvent[] } {
  return apply(state, { type: "evolve", seat: "p1", uid, target: { spot: "active" } });
}

function evolveAndTake(
  state: GameState,
  uid: string,
  take?: number,
): { state: GameState; events: GameEvent[] } {
  const evolved = evolveActive(state, uid);
  if (evolved.state.phase.kind !== "effect:choose") return evolved;
  const prompt = evolved.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  const answered = apply(evolved.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  });
  return { state: answered.state, events: [...evolved.events, ...answered.events] };
}

function energyIdsOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (pokemon?.energy ?? []).map((uid) => idOf(state, uid));
}

// ── 1. THE DECLARATION — the shape, by KEY SET, and the shared object ─────────

describe("D353 §1 — the authored row is ONE object over TWO printings", () => {
  it("both printings resolve to the SAME program object", () => {
    expect(programFor(LYCANROC_IDS[0])).toBe(programFor(LYCANROC_IDS[1]));
  });

  it("the program's KEY SET is exactly `triggered` — so it is wholly non-attack", () => {
    for (const id of LYCANROC_IDS) {
      expect(Object.keys(programFor(id) ?? {}).sort(), id).toEqual(["triggered"]);
    }
  });

  it("the DECLARATION snapshot — trigger, optionality and the whole op", () => {
    // The only thing that reddens on a dropped `optional`, which auto-fires today
    // and therefore has no behavioural test anywhere. Said out loud, not papered.
    const triggered = programFor(LYCANROC)?.triggered ?? [];
    expect(triggered.length).toBe(1);
    const row = triggered[0];
    expect(row?.name).toBe("Spike-Clad");
    expect(row?.trigger).toBe("onEvolve");
    expect(row?.program).toEqual([
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyName: "Spiky Energy",
        count: 2,
        toSelf: true,
      },
    ] satisfies EffectOp[]);
  });

  it("the row carries NONE of the class riders, because `toSelf` authors alone", () => {
    const op = (programFor(LYCANROC)?.triggered ?? [])[0]?.program[0] as Record<string, unknown>;
    for (const rider of ["targetType", "basicOnly", "ownerPokemon", "benchOnly", "anyEnergy"]) {
      expect(op, rider).not.toHaveProperty(rider);
    }
  });
});

// ── 2. THE CARD, DRIVEN — and the design call that makes it work ─────────────

describe("D353 §2 — Spike-Clad attaches exactly 2 SPIKY Energy and nothing else", () => {
  it("a pile of 3 Spiky attaches exactly 2, and the third stays in the discard", () => {
    const { state, evolveUid } = board([SPIKY, SPIKY, SPIKY]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY, SPIKY]);
    // `count: 2` and not 3 — the printed "up to 2" is a CAP, and the remainder is
    // what a raised count would eat.
    expect(
      after.state.players.p1.discard.filter((uid) => idOf(after.state, uid) === SPIKY).length,
    ).toBe(1);
    // …and the trigger really fired, rather than the Energy arriving some other way.
    expect(after.events.map((e: GameEvent) => e.type)).toContain("ABILITY_TRIGGERED");
  });

  it("A SPECIAL ENERGY IS REACHED — the ONE design call, driven", () => {
    const { state, evolveUid } = board([SPIKY]);
    expect(POOL[SPIKY]?.energyType).toBe("Special");
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY]);
  });

  it("a pile of Basic {F} and Mist Energy is UNTOUCHED — the narrowing, both ways", () => {
    const { state, evolveUid } = board([FIGHTING, FIGHTING, MIST, MIST]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([]);
    expect(after.state.players.p1.discard.length).toBe(state.players.p1.discard.length);
  });

  it("a MIXED pile takes the two SPIKY and steps over everything in front of them", () => {
    // The sharpest single case in the file: the Basic {F} and the Mist Energy sit
    // EARLIER in zone order than the Spiky cards, so a narrowing that merely
    // widened the category would take the leading matches and be visibly wrong.
    const { state, evolveUid } = board([FIGHTING, MIST, SPIKY, FIGHTING, SPIKY_ALT, MIST]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY, SPIKY_ALT]);
  });

  it("the REPRINT counts — the name is a NAME and not an id", () => {
    const { state, evolveUid } = board([SPIKY_ALT, SPIKY_ALT]);
    expect(POOL[SPIKY_ALT]?.name).toBe(POOL[SPIKY]?.name);
    expect(SPIKY_ALT).not.toBe(SPIKY);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY_ALT, SPIKY_ALT]);
  });

  it("an EMPTY pile is a silent no-op — the printed 'up to' shortfall", () => {
    const { state, evolveUid } = board([]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([]);
    expect(after.state.phase.kind).not.toBe("effect:choose");
  });

  it("ONE Spiky in the pile attaches ONE — `min(count, available)`, silently", () => {
    const { state, evolveUid } = board([SPIKY, FIGHTING]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY]);
  });
});

// ── 3. THE NO-NEW-VOCABULARY REFUTATION, RUN FROM SOURCE ─────────────────────

describe("D353 §3 — the three spellings that would have avoided the field, refuted", () => {
  const pile = [FIGHTING, MIST, SPIKY, SPIKY_ALT];

  function reachable(op: {
    energyType?: string;
    anyEnergy?: true;
    energyName?: string;
  }): string | undefined {
    const { state } = board(pile);
    const uid = firstAttachableEnergy(
      state,
      "p1",
      "discard",
      op.energyType,
      op.anyEnergy,
      op.energyName,
    );
    return uid === undefined ? undefined : idOf(state, uid);
  }

  it('`energyType: "Colorless" + anyEnergy` reaches MIST — the wrong card', () => {
    expect(reachable({ energyType: "Colorless", anyEnergy: true })).toBe(MIST);
  });

  it("`anyEnergy` alone reaches the Basic {F} — strictly broader still", () => {
    expect(reachable({ anyEnergy: true })).toBe(FIGHTING);
  });

  it('`energyType: "Spiky"` matches the EMPTY SET — the silent-whiff failure', () => {
    expect(reachable({ energyType: "Spiky" })).toBeUndefined();
    expect(reachable({ energyType: "Spiky", anyEnergy: true })).toBeUndefined();
  });

  it("…and the spelling that was PAID reaches exactly the printed card", () => {
    expect(reachable({ energyName: "Spiky Energy" })).toBe(SPIKY);
    // …and a misspelling matches nothing, which is the recorded risk of a bare
    // string field (`AttachTargetRiders.ownerPokemon`'s own doc). Named so a
    // future author knows the failure mode is loud, not silent.
    expect(reachable({ energyName: "Spiky energy" })).toBeUndefined();
    expect(reachable({ energyName: "Spiky Energy card" })).toBeUndefined();
  });
});

// ── 4. THE FIELD IS ORTHOGONAL — the ROTATED sentence's shape, driven ────────

describe("D353 §4 — `energyName` is orthogonal to `source` and to the riders", () => {
  it("the ROTATED by-name sentence's shape works too — HAND source, no `toSelf`", () => {
    const { state } = board([]);
    const withHand: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, hand: [...state.players.p1.hand] },
      },
    };
    // Move one Therapeutic and one Basic {F} out of the deck and into the hand.
    const deck = [...withHand.players.p1.deck];
    const pull = (cardId: string): string => {
      const index = deck.findIndex((uid) => idOf(withHand, uid) === cardId);
      if (index < 0) throw new Error(`deck has no ${cardId}`);
      return deck.splice(index, 1)[0] as string;
    };
    const fighting = pull(FIGHTING);
    const therapeutic = pull(THERAPEUTIC);
    const handed: GameState = {
      ...withHand,
      players: {
        ...withHand.players,
        p1: {
          ...withHand.players.p1,
          deck,
          hand: [fighting, therapeutic, ...withHand.players.p1.hand],
        },
      },
    };
    // The Basic {F} sits FIRST, so a spelling with no name test takes it.
    expect(idOf(handed, firstAttachableEnergy(handed, "p1", "hand", undefined) ?? "")).toBe(
      FIGHTING,
    );
    const found = firstAttachableEnergy(
      handed,
      "p1",
      "hand",
      undefined,
      undefined,
      "Therapeutic Energy",
    );
    expect(idOf(handed, found ?? "")).toBe(THERAPEUTIC);
  });

  it("the two source zones are independent — a name in the DISCARD is not in the HAND", () => {
    const { state } = board([SPIKY, SPIKY]);
    expect(
      firstAttachableEnergy(state, "p1", "discard", undefined, undefined, "Spiky Energy"),
    ).toBeDefined();
    expect(
      firstAttachableEnergy(state, "p1", "hand", undefined, undefined, "Spiky Energy"),
    ).toBeUndefined();
  });
});

// ── 5. `toSelf` — the evolved body, and the second body that must stay empty ──

describe("D353/D359 §5 — the attach lands on the EVOLVED body, and now it ASKS", () => {
  it("a board with a SECOND own Pokémon still feeds ONLY the evolved one", () => {
    const { state, evolveUid } = board([SPIKY, SPIKY], { bench: [BUDDY] });
    const parked = evolveActive(state, evolveUid);
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.candidates).toEqual([ACTIVE_REF]);
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY, SPIKY]);
    expect(energyIdsOn(after.state, { seat: "p1", spot: { spot: "bench", index: 0 } })).toEqual([]);
  });

  it("D359 — THE PRINTED *'up to 2'* IS NO LONGER OVER-RESOLVED: {0, 1, 2}", () => {
    const { state, evolveUid } = board([SPIKY, SPIKY]);
    expect(energyIdsOn(evolveAndTake(state, evolveUid).state, ACTIVE_REF)).toEqual([SPIKY, SPIKY]);
    const one = evolveAndTake(state, evolveUid, 1);
    expect(energyIdsOn(one.state, ACTIVE_REF)).toEqual([SPIKY]);
    // …and the second Spiky is still in the discard pile, not consumed.
    expect(one.state.players.p1.discard.filter((u) => idOf(one.state, u) === SPIKY)).toHaveLength(
      1,
    );
    // ZERO — the decline, which no route on this card could reach before either:
    // the trigger is a *"you may"*, but a board trigger auto-fires and the pick
    // beneath it was mandatory.
    const parked = evolveActive(state, evolveUid);
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const none = apply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(energyIdsOn(none.state, ACTIVE_REF)).toEqual([]);
    expect(none.events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(0);
    expect(none.state.players.p1.discard.filter((u) => idOf(none.state, u) === SPIKY)).toHaveLength(
      2,
    );
  });

  it("D359 — the park carries the printed CEILING and the `toSelf` caption", () => {
    const { state, evolveUid } = board([SPIKY, SPIKY]);
    const parked = evolveActive(state, evolveUid);
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBe(2);
    expect(prompt.note).toBe("Attach up to 2 Energy to this Pokémon?");
  });
});

// ── 6. THE TRIGGER MOMENT — evolve and nothing else ──────────────────────────

describe("D353 §6 — `onEvolve` and not `onPlayToBench`", () => {
  it("benching a Lycanroc-carrying body fires NOTHING", () => {
    // Lycanroc is a Stage 1 and cannot be benched from hand at all, so the case is
    // driven at the trigger's own seam: a Rockruff played to the Bench must not
    // fire, and the discard pile keeps every Spiky Energy.
    const { state } = board([SPIKY, SPIKY]);
    const deck = [...state.players.p1.deck];
    const index = deck.findIndex((uid) => idOf(state, uid) === ROCKRUFF);
    const benchUid = deck.splice(index, 1)[0] as string;
    const withHand: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, deck, hand: [benchUid, ...state.players.p1.hand] },
      },
    };
    const after = apply(withHand, { type: "playBasicToBench", seat: "p1", uid: benchUid });
    expect(after.events.map((e: GameEvent) => e.type)).not.toContain("ABILITY_TRIGGERED");
    expect(energyIdsOn(after.state, { seat: "p1", spot: { spot: "bench", index: 0 } })).toEqual([]);
    expect(
      after.state.players.p1.discard.filter((uid) => idOf(after.state, uid) === SPIKY).length,
    ).toBe(2);
  });

  it("the OTHER printing fires identically — one object, two ids", () => {
    const { state, evolveUid } = board([SPIKY, SPIKY], { lycanroc: LYCANROC_IDS[1] });
    const after = evolveAndTake(state, evolveUid);
    expect(energyIdsOn(after.state, ACTIVE_REF)).toEqual([SPIKY, SPIKY]);
  });
});

// ── 7. THE FOURTH CONSUMER — the one this card cannot reach ──────────────────

describe("D353 §7 — all FOUR consumers of the narrowing, and the one that needs a direct drive", () => {
  it("`firstAttachableEnergy` carries the name — the gate/park half", () => {
    const { state } = board([FIGHTING, MIST]);
    // A pile with no Spiky in it answers "nothing to attach" to the gate…
    expect(
      firstAttachableEnergy(state, "p1", "discard", undefined, undefined, "Spiky Energy"),
    ).toBeUndefined();
    // …while the UNNARROWED question answers "yes", which is exactly the divergence
    // a gate that ignored the name would produce.
    expect(firstAttachableEnergy(state, "p1", "discard", undefined)).toBeDefined();
  });

  it("`programPlayable` CARRIES THE NAME — and NO registry row can reach this today", () => {
    const named: EffectOp[] = [
      { op: "attachEnergyFrom", source: "discard", energyName: "Spiky Energy", toSelf: true },
    ];
    // A pile with NO Spiky in it but plenty of ordinary Basic Energy: the gate must
    // refuse, because the only attach the program spells can only whiff.
    const { state: blind } = board([FIGHTING, FIGHTING, MIST]);
    expect(programPlayable(blind, named, "p1")).toBe(false);
    // …and the SAME program on the SAME shape of board WITH the printed card is
    // offered, so the assertion above is a narrowing and not a blanket refusal.
    const { state: live } = board([FIGHTING, SPIKY, MIST]);
    expect(programPlayable(live, named, "p1")).toBe(true);
    // The control that proves the gate is reading the NAME rather than the zone:
    // drop the narrowing and the first board becomes playable.
    const unnamed: EffectOp[] = [{ op: "attachEnergyFrom", source: "discard", toSelf: true }];
    expect(programPlayable(blind, unnamed, "p1")).toBe(true);
  });

  it("the name and the type are not welded — a disagreeing pair matches nothing", () => {
    const { state } = board([SPIKY, SPIKY]);
    expect(
      firstAttachableEnergy(state, "p1", "discard", "Fighting", undefined, "Spiky Energy"),
    ).toBeUndefined();
  });
});

describe("D353 §8 — the pool and the registry keys", () => {
  it("every printing is a registry key", () => {
    const raw = programmedCardIds();
    for (const id of LYCANROC_IDS) expect(raw).toContain(id);
  });

  it("the +2 on `raw.length` is EXACTLY the two Lycanroc ids — the Energy ids were already keys", () => {
    const keys = new Set(programmedCardIds());
    for (const id of LYCANROC_IDS) expect(keys.has(id), id).toBe(true);
    for (const id of [SPIKY, SPIKY_ALT, MIST]) expect(keys.has(id), id).toBe(true);
    // …and the synthetic bodies are keys of nothing, which is what keeps the step at 2.
    for (const id of [ROCKRUFF, BUDDY, THERAPEUTIC, FIGHTING, JUNK]) {
      expect(keys.has(id), id).toBe(false);
    }
  });

  it("NOTHING HERE REACHES `FIXTURE_POOL` — asserted BY ID, not described", () => {
    const local = Object.keys(POOL).sort();
    expect(local).toEqual(Object.keys(LOCAL_CARDS).sort());
    expect(local).toContain(LYCANROC_IDS[0]);
    expect(local.length).toBe(10);
  });

  it("the printed sentence is on the fixture bodies, so a census can SEE it", () => {
    for (const id of LYCANROC_IDS) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(SPIKE_CLAD_TEXT);
      expect(POOL[id]?.abilities?.[0]?.name, id).toBe("Spike-Clad");
    }
  });
});
