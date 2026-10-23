import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction } from "./index";
import { attachEnergyTargets, conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  specialEnergy,
  trainerCard,
  typedEnergy,
  must,
  driveSetup,
} from "./testFixtures";

const LAST_DITCH_CATCH =
  'Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck. You can\'t use more than 1 Ability that has "Last-Ditch" in its name each turn.';
const LUSTROUS_ASSIST =
  "Once during your turn, when your Mega Latias ex moves from your Bench to the Active Spot, you may use this Ability. Move any amount of Energy from your Benched Pokémon to your Active Pokémon.";
const LETHARGIC_CHARGE =
  "Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Attach an Energy card from your hand to your Active Larry's Pokémon.";
const CONFIRM_NOTE =
  "You may search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.";

const MEOWTH = ["me03-062", "me03-107", "me03-121"] as const;
const LATIOS = "me01-101";
const KOMALA = "me02.5-175";
const CLAWITZER = ["me01-038", "me01-141"] as const;
const MEGA_LATIAS = "me01-100";

const FREE = "d628-free"; // {C} Basic, retreat 0
const FILLER = "d628-filler"; // {C} Basic, 300 HP
const LARRYS = "d628-larrys"; // "Larry's Tropius", a Larry's Pokémon
const SUPPORTER = "d628-supporter";
const R = "d628-fire";
const W = "d628-water";
const SPECIAL = "d628-special";

const ability = (name: string, effect: string) =>
  ({ abilities: [{ type: "Ability", name, effect }] }) as Partial<Card>;
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    MEOWTH.map((id) => [
      id,
      battler(id, {
        name: "Meowth ex",
        hp: 170,
        types: ["Colorless"],
        retreat: 1,
        attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Tuck Tail", damage: 60 }],
        ...ability("Last-Ditch Catch", LAST_DITCH_CATCH),
      }),
    ]),
  ),
  [LATIOS]: battler(LATIOS, {
    name: "Latios",
    hp: 130,
    types: ["Dragon"],
    retreat: 1,
    attacks: TAP,
    ...ability("Lustrous Assist", LUSTROUS_ASSIST),
  }),
  [MEGA_LATIAS]: battler(MEGA_LATIAS, {
    name: "Mega Latias ex",
    hp: 280,
    types: ["Dragon"],
    retreat: 1,
    attacks: TAP,
  }),
  [KOMALA]: battler(KOMALA, {
    name: "Larry's Komala",
    hp: 90,
    types: ["Colorless"],
    retreat: 2,
    attacks: TAP,
    ...ability("Lethargic Charge", LETHARGIC_CHARGE),
  }),
  [FREE]: battler(FREE, {
    name: "D628 Free",
    hp: 300,
    types: ["Colorless"],
    retreat: 0,
    attacks: TAP,
  }),
  [FILLER]: battler(FILLER, {
    name: "D628 Filler",
    hp: 300,
    types: ["Colorless"],
    retreat: 1,
    attacks: TAP,
  }),
  [LARRYS]: battler(LARRYS, {
    name: "Larry's Tropius",
    hp: 120,
    types: ["Colorless"],
    retreat: 1,
    attacks: TAP,
  }),
  [SUPPORTER]: { ...trainerCard(SUPPORTER, "Supporter", "Draw 2 cards."), name: "D628 Supporter" },
  [R]: typedEnergy(R, "Fire"),
  [W]: typedEnergy(W, "Water"),
  [SPECIAL]: specialEnergy(
    SPECIAL,
    "D628 Special Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.",
  ),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [MEOWTH[0]]: 1,
  [MEOWTH[1]]: 1,
  [MEOWTH[2]]: 1,
  [LATIOS]: 1,
  [MEGA_LATIAS]: 1,
  [KOMALA]: 2,
  [FREE]: 2,
  [LARRYS]: 2,
  [SUPPORTER]: 3,
  [R]: 4,
  [W]: 4,
  [SPECIAL]: 2,
  [FILLER]: 36,
});
function ok(result: ReturnType<typeof applyAction>) {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}
function refusal(result: ReturnType<typeof applyAction>): { code: string; message: string } {
  if (result.ok) throw new Error("expected a refusal");
  return { code: result.error.code, message: result.error.message };
}

/** Setup (P2 first), then P2 / P1 / P2 end their turns → P1's SECOND turn; hands back into the decks and the
    Prizes swapped for filler, so every named card is findable. */
function p1Turn(): GameState {
  let state = driveSetup(6280, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  for (const s of ["p2", "p1", "p2"] as const)
    state = must(applyAction(state, { type: "endTurn", seat: s }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if (state.cardIdByUid[u] === FILLER) return u;
      const swap = deck.find((d) => state.cardIdByUid[d] === FILLER);
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** Move one copy of each id in `ids` from `seat`'s deck into their hand, in order. */
function toHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const hand = [...side.hand];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} deck has no ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck } } };
}

/** P1: `active` and `bench`, hand `hand`; P2: a FILLER Active over an empty Bench. */
function table(opts: {
  active?: string;
  bench?: readonly string[];
  hand?: readonly string[];
}): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", opts.active ?? FILLER), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  return toHand(state, "p1", opts.hand ?? []);
}

const ACTIVE = { spot: "active" } as const;
const bench = (index: number) => ({ spot: "bench", index }) as const;
const P1_ACTIVE = { seat: "p1", spot: { spot: "active" } } as const;
const use = (
  state: GameState,
  abilityName: string,
  target: typeof ACTIVE | ReturnType<typeof bench>,
) => applyAction(state, { type: "useAbility", seat: "p1", target, abilityName } as GameAction);
const resolve = (state: GameState, choice: unknown) =>
  ok(applyAction(state, { type: "resolveEffect", seat: "p1", choice } as GameAction));
const playToBench = (state: GameState, id: string) => {
  const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id} in hand`);
  return ok(applyAction(state, { type: "playBasicToBench", seat: "p1", uid }));
};
const retreat = (state: GameState) =>
  ok(applyAction(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }));
function prompt(state: GameState): Record<string, unknown> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt as unknown as Record<string, unknown>;
}
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const benchIndexOf = (state: GameState, id: string) =>
  state.players.p1.bench.findIndex((b) => state.cardIdByUid[b.stack.at(-1) ?? ""] === id);

describe("D628 §1 — the programs: Meowth ex on D593's object, two new objects, Clawitzer dropped ( D636 (D539): Clawitzer keyed at D636)", () => {
  it("Meowth ex ×3: `Tuck Tail` kept, plus an `onPlayToBench` trigger with the name lock and an inner confirm", () => {
    for (const id of MEOWTH) {
      expect(programFor(id), id).toEqual({
        attack: { 0: [{ op: "returnSelf", dest: "hand" }] },
        triggered: [
          {
            name: "Last-Ditch Catch",
            trigger: "onPlayToBench",
            oncePerTurn: "sharedByName",
            program: [
              {
                op: "optional",
                note: CONFIRM_NOTE,
                then: [
                  {
                    op: "searchDeck",
                    filter: { kind: "supporter" },
                    dest: "hand",
                    max: 1,
                    reveal: true,
                  },
                  { op: "shuffleDeck" },
                ],
              },
            ],
          },
        ],
      });
    }
    expect(programFor(MEOWTH[1])).toBe(programFor(MEOWTH[0]));
    expect(programFor(MEOWTH[2])).toBe(programFor(MEOWTH[0]));
  });

  it("Latios: a use-time gate on a promoted Active named Mega Latias ex; Komala: a Bench-only one-card hand attach", () => {
    expect(programFor(LATIOS)).toEqual({
      abilities: [
        {
          name: "Lustrous Assist",
          oncePerTurn: true,
          activeOnly: false,
          playableIf: {
            kind: "allOf",
            conditions: [
              { kind: "yourActivePromotedThisTurn" },
              { kind: "yourActiveNamed", name: "Mega Latias ex" },
            ],
          },
          program: [
            {
              op: "moveEnergy",
              filter: { kind: "anyEnergy" },
              max: "any",
              route: "benchToActive",
              anySource: true,
            },
          ],
        },
      ],
    });
    expect(programFor(KOMALA)).toEqual({
      abilities: [
        {
          name: "Lethargic Charge",
          oncePerTurn: true,
          activeOnly: false,
          benchOnly: true,
          program: [
            {
              op: "attachFromHand",
              filter: { kind: "anyEnergy" },
              one: true,
              activeOnly: true,
              ownerPokemon: "Larry",
            },
          ],
        },
      ],
    });
  });

  it("Clawitzer ×2 'Fall Back to Reload' stays unkeyed: a hand-attach choice inside the non-parking Active→Bench self sweep ( D636 (D539): WITHDRAWN — keyed at D636 on the persisted moved-to-Bench stamp, `nextTurnLocksD636.test.ts`)", () => {
    for (const id of CLAWITZER)
      expect(programFor(id)?.abilities?.[0]?.name, id).toBe("Fall Back to Reload");
  });
});

describe("D628 §2 — Last-Ditch Catch: bench Meowth ex, confirm, search a Supporter; one Last-Ditch use per turn", () => {
  it("yes: the Supporter is searched, revealed and put into the hand, then the deck is shuffled", () => {
    const state = table({ hand: [MEOWTH[0]] });
    const benched = playToBench(state, MEOWTH[0]);
    expect(of(benched.events, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual([
      "Last-Ditch Catch",
    ]);
    expect(prompt(benched.state)).toStrictEqual({ kind: "confirm", note: CONFIRM_NOTE });
    const searching = resolve(benched.state, { kind: "confirm", yes: true });
    const offer = prompt(searching.state);
    expect(offer.kind).toBe("chooseCards");
    expect(new Set(ids(searching.state, offer.candidates as string[]))).toEqual(
      new Set([SUPPORTER]),
    );
    const pick = (offer.candidates as string[])[0] as string;
    const done = resolve(searching.state, { kind: "cards", uids: [pick] });
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.hand).toEqual([pick]);
    expect(of(done.events, "DECK_SEARCHED")).toEqual([
      { type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: [pick], reveal: true },
    ]);
    expect(of(done.events, "SHUFFLE").length).toBeGreaterThan(0);
    expect(done.state.allowances.abilitiesUsed).toContain("*:Last-Ditch Catch");
  });

  it("no: nothing is searched and the deck is NOT shuffled", () => {
    const state = table({ hand: [MEOWTH[0]] });
    const benched = playToBench(state, MEOWTH[0]);
    const deckBefore = benched.state.players.p1.deck;
    const done = resolve(benched.state, { kind: "confirm", yes: false });
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.deck).toEqual(deckBefore);
    expect(of(done.events, "SHUFFLE")).toEqual([]);
    expect(of(done.events, "DECK_SEARCHED")).toEqual([]);
  });

  it("the name lock: a SECOND Meowth ex benched the same turn fires nothing — even after a declined confirm (R-LDC1, UNRULED)", () => {
    for (const first of [true, false]) {
      const state = table({ hand: [MEOWTH[0], MEOWTH[1]] });
      const benched = playToBench(state, MEOWTH[0]);
      let after = resolve(benched.state, { kind: "confirm", yes: first }).state;
      if (first)
        after = resolve(after, {
          kind: "cards",
          uids: [(prompt(after).candidates as string[])[0]],
        }).state;
      const second = playToBench(after, MEOWTH[1]);
      expect(of(second.events, "ABILITY_TRIGGERED"), String(first)).toEqual([]);
      expect(second.state.phase.kind).toBe("turn:action");
      expect(second.state.players.p1.bench).toHaveLength(2);
    }
  });

  it("the lock is per TURN: a fresh turn's Meowth ex fires again", () => {
    const state = table({ hand: [MEOWTH[0]] });
    const spent = {
      ...state,
      allowances: { ...state.allowances, abilitiesUsed: ["*:Last-Ditch Catch"] },
    };
    expect(of(playToBench(spent, MEOWTH[0]).events, "ABILITY_TRIGGERED")).toEqual([]);
    // A key for another body's Ability does not block it.
    const other = {
      ...state,
      allowances: { ...state.allowances, abilitiesUsed: ["p1#0:Last-Ditch Catch"] },
    };
    expect(
      of(playToBench(other, MEOWTH[0]).events, "ABILITY_TRIGGERED").map((e) => e.ability),
    ).toEqual(["Last-Ditch Catch"]);
  });
});

describe("D628 §3 — Lustrous Assist: after your Mega Latias ex moved up this turn, Bench Energy to the Active", () => {
  /** P1 retreats a retreat-0 Active into Mega Latias ex; Latios and a filler on the Bench carry Energy. */
  function promoted(): GameState {
    let state = table({ active: FREE, bench: [MEGA_LATIAS, LATIOS, FILLER] });
    state = attachBenchFromDeck(attachBenchFromDeck(state, "p1", 1, W, 1), "p1", 2, R, 1);
    state = attachBenchFromDeck(state, "p1", 2, SPECIAL, 1);
    return retreat(state).state;
  }

  it("moves any amount of Energy from several Benched Pokémon onto Mega Latias ex; once per turn", () => {
    const state = promoted();
    expect(state.cardIdByUid[state.players.p1.active?.stack.at(-1) ?? ""]).toBe(MEGA_LATIAS);
    const at = benchIndexOf(state, LATIOS);
    const parked = ok(use(state, "Lustrous Assist", bench(at)));
    const offer = prompt(parked.state);
    expect(offer.kind).toBe("moveEnergy");
    expect(offer.destinations).toEqual([P1_ACTIVE]);
    const movable = offer.movable as { uid: string }[];
    expect(
      new Set(
        ids(
          parked.state,
          movable.map((m) => m.uid),
        ),
      ),
    ).toEqual(new Set([W, R, SPECIAL]));
    const done = resolve(parked.state, {
      kind: "moveEnergy",
      picks: movable.map((m) => ({ uid: m.uid, dest: P1_ACTIVE })),
    });
    expect(new Set(ids(done.state, done.state.players.p1.active?.energy ?? []))).toEqual(
      new Set([W, R, SPECIAL]),
    );
    expect(refusal(use(done.state, "Lustrous Assist", bench(at))).code).toBe(
      "ABILITY_ALREADY_USED",
    );
  });

  it("refused when the Active did not move up this turn, and when the promoted Active is not Mega Latias ex", () => {
    let still = table({ active: MEGA_LATIAS, bench: [LATIOS] });
    still = attachBenchFromDeck(still, "p1", 0, W, 1);
    const notMoved = refusal(use(still, "Lustrous Assist", bench(0)));
    expect(notMoved.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(notMoved.message).toContain(
      "your Active Pokémon moved from your Bench to the Active Spot this turn and your Active Pokémon is Mega Latias ex",
    );
    let other = table({ active: FREE, bench: [FILLER, LATIOS] });
    other = attachBenchFromDeck(other, "p1", 1, W, 1);
    other = retreat(other).state;
    expect(other.cardIdByUid[other.players.p1.active?.stack.at(-1) ?? ""]).toBe(FILLER);
    expect(refusal(use(other, "Lustrous Assist", bench(benchIndexOf(other, LATIOS)))).code).toBe(
      "ABILITY_CONDITION_NOT_MET",
    );
  });

  it("R-LSA1 (UNRULED): the moment is a use-time gate — usable later in the turn, and Latios's own spot is not asked", () => {
    const state = promoted();
    // An intervening action (a manual attach onto the Active) does not close the window.
    const withHand = toHand(state, "p1", [W]);
    const uid = withHand.players.p1.hand[0] as string;
    const attached = must(
      applyAction(withHand, { type: "attachEnergy", seat: "p1", uid, target: ACTIVE }),
    );
    expect(
      ok(use(attached, "Lustrous Assist", bench(benchIndexOf(attached, LATIOS)))).state.phase.kind,
    ).toBe("effect:choose");
  });

  it("`yourActiveNamed` reads the Active's top card by exact name; an empty Active Spot is false", () => {
    const state = table({ active: MEGA_LATIAS });
    expect(conditionHolds(state, "p1", { kind: "yourActiveNamed", name: "Mega Latias ex" })).toBe(
      true,
    );
    expect(conditionHolds(state, "p1", { kind: "yourActiveNamed", name: "Latias ex" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "yourActiveNamed", name: "Mega Latias ex" })).toBe(
      false,
    );
    const empty = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(conditionHolds(empty, "p1", { kind: "yourActiveNamed", name: "Mega Latias ex" })).toBe(
      false,
    );
    expect(conditionNote({ kind: "yourActiveNamed", name: "Mega Latias ex" })).toBe(
      "your Active Pokémon is Mega Latias ex",
    );
  });
});

describe("D628 §4 — Lethargic Charge: from the Bench, the chosen Energy card from hand to your Active Larry's Pokémon", () => {
  const NOTE = "Attach an Energy card from your hand to your Active Larry's Pokémon.";

  it("offers every Energy card in hand (Special too) onto the Active alone; the chosen one is attached; once per turn", () => {
    const state = table({ active: LARRYS, bench: [KOMALA, LARRYS], hand: [R, SUPPORTER, SPECIAL] });
    const parked = ok(use(state, "Lethargic Charge", bench(0)));
    const offer = prompt(parked.state);
    expect(offer.kind).toBe("attachCards");
    expect(offer.max).toBe(1);
    expect(offer.note).toBe(NOTE);
    expect(ids(parked.state, offer.candidates as string[])).toEqual([R, SPECIAL]);
    // The Benched Larry's Pokémon is not a target: "your ACTIVE Larry's Pokémon".
    expect(offer.targets).toEqual([P1_ACTIVE]);
    const special = (offer.candidates as string[])[1] as string;
    const done = resolve(parked.state, {
      kind: "attachCards",
      assignments: [{ uid: special, to: P1_ACTIVE }],
    });
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.active?.energy).toEqual([special]);
    expect(ids(done.state, done.state.players.p1.hand)).toEqual([R, SUPPORTER]);
    // Not the §6.3 manual attach.
    expect(done.state.allowances.energyAttached).toBe(false);
    expect(refusal(use(done.state, "Lethargic Charge", bench(0))).code).toBe(
      "ABILITY_ALREADY_USED",
    );
  });

  it("R-LGC1 (UNRULED): the attach is mandatory — an empty answer attaches the first offered card", () => {
    const state = table({ active: LARRYS, bench: [KOMALA], hand: [W, R] });
    const parked = ok(use(state, "Lethargic Charge", bench(0)));
    const first = (prompt(parked.state).candidates as string[])[0] as string;
    const done = resolve(parked.state, { kind: "attachCards", assignments: [] });
    expect(done.state.players.p1.active?.energy).toEqual([first]);
    expect(ids(done.state, done.state.players.p1.active?.energy ?? [])).toEqual([W]);
    expect(of(done.events, "ENERGY_ATTACHED")).toHaveLength(1);
  });

  it("refused from the Active Spot, with no Energy card in hand, and when the Active is not a Larry's Pokémon", () => {
    expect(
      refusal(use(table({ active: KOMALA, hand: [R] }), "Lethargic Charge", ACTIVE)).code,
    ).toBe("ABILITY_BENCH_ONLY");
    expect(
      refusal(
        use(
          table({ active: LARRYS, bench: [KOMALA], hand: [SUPPORTER] }),
          "Lethargic Charge",
          bench(0),
        ),
      ).code,
    ).toBe("NO_LEGAL_TARGET");
    expect(
      refusal(
        use(
          table({ active: FILLER, bench: [KOMALA, LARRYS], hand: [R] }),
          "Lethargic Charge",
          bench(0),
        ),
      ).code,
    ).toBe("NO_LEGAL_TARGET");
    // Komala itself is a Larry's Pokémon, but only from the Active Spot — where the Ability cannot be used.
    const swapped = table({ active: KOMALA, bench: [KOMALA], hand: [R] });
    expect(ok(use(swapped, "Lethargic Charge", bench(0))).state.phase.kind).toBe("effect:choose");
  });

  it("`activeOnly` on the shared target funnel drops the Bench; absent, the funnel is unchanged", () => {
    const state = table({ active: LARRYS, bench: [LARRYS, FILLER] });
    expect(attachEnergyTargets(state, "p1", { activeOnly: true })).toEqual([P1_ACTIVE]);
    expect(attachEnergyTargets(state, "p1", { activeOnly: true, ownerPokemon: "Larry" })).toEqual([
      P1_ACTIVE,
    ]);
    expect(attachEnergyTargets(state, "p1", { ownerPokemon: "Larry" })).toEqual([
      P1_ACTIVE,
      { seat: "p1", spot: { spot: "bench", index: 0 } },
    ]);
    const stranger = table({ active: FILLER, bench: [LARRYS] });
    expect(
      attachEnergyTargets(stranger, "p1", { activeOnly: true, ownerPokemon: "Larry" }),
    ).toEqual([]);
  });
});
