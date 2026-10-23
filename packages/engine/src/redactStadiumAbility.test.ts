import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { applyAction, programFor } from "./index";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  STADIUM_ABILITY_DECK,
  battler,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  trainerCard,
} from "./testFixtures";
import type { GameState, Seat } from "./types";

const BOTH = { p1: STADIUM_ABILITY_DECK, p2: STADIUM_ABILITY_DECK };

/** Setup, then open P1's turn 2 (P2 went first and passed) — no §4 restrictions.
    Borrowed verbatim from `stadiumAbility.test.ts`, which drives the same action
    from the engine side. */
function p1Turn2(seed = 1): GameState {
  return must(
    applyAction(driveSetup(seed, BOTH, { first: "p2" }), { type: "endTurn", seat: "p2" }),
  );
}

/** Put a Stadium into `seat`'s hand and PLAY it — the real `playTrainer` drag the
    online client already supports, not surgery, so the state under test is one a
    live match actually reaches. */
function withStadium(state: GameState, seat: Seat, cardId: string): GameState {
  const next = handFromDeck(state, seat, cardId, 1);
  return must(applyAction(next, { type: "playTrainer", seat, uid: handUid(next, seat, cardId) }));
}

/** The acting seat's offer, or null — the thing the online HUD renders. */
function offerFor(state: GameState, viewer: Seat, spectating = false) {
  const phase = redactGame(state, viewer, spectating).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.stadiumAbility;
}

describe("redactGame — the §7.3 Stadium activation offer, to the ACTOR ALONE", () => {
  it("offers it to the seat whose turn it is and withholds it from the other — from BOTH sides", () => {
    const p1Turn = deepFreeze(withStadium(p1Turn2(1), "p1", "sv03-196")); // Town Store
    expect(offerFor(p1Turn, "p1")).toEqual({
      label: "Town Store",
      disabled: false,
      reason: null,
    });
    expect(offerFor(p1Turn, "p2")).toBeNull();

    // …and again with the seats swapped, so a fold that hard-coded "p1" (or read
    // `state.stadium.owner` instead of the turn) cannot pass. The Stadium is still
    // P1's card here — ownership is NOT the discriminant, the turn is.
    const p2Turn = deepFreeze(must(applyAction(p1Turn, { type: "endTurn", seat: "p1" })));
    expect(p2Turn.stadium?.owner).toBe("p1");
    expect(offerFor(p2Turn, "p2")).toEqual({
      label: "Town Store",
      disabled: false,
      reason: null,
    });
    expect(offerFor(p2Turn, "p1")).toBeNull();
  });

  it("withholds the AFFORDANCE, not the card — which is why the leak test is about the offer", () => {
    const state = deepFreeze(withStadium(p1Turn2(1), "p1", "sv03-196"));
    const opponentView = redactGame(state, "p2");
    expect(opponentView.board.stadium?.name).toBe("Town Store");
    expect(opponentView.phase.kind).toBe("turn:action");
    if (opponentView.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(opponentView.phase.stadiumAbility).toBeNull();
  });

  it("withholds it from a SPECTATOR watching either side (3c-vii)", () => {
    const state = deepFreeze(withStadium(p1Turn2(1), "p1", "sv03-196"));
    expect(offerFor(state, "p1", true)).toBeNull();
    expect(offerFor(state, "p2", true)).toBeNull();
  });

  it("renders NO row for a board with no Stadium, and none for a CONTINUOUS-only one", () => {
    const bare = deepFreeze(p1Turn2(1));
    expect(bare.stadium).toBeNull();
    expect(offerFor(bare, "p1")).toBeNull();
    const beachCourt = deepFreeze(withStadium(p1Turn2(1), "p1", "sv01-167"));
    expect(beachCourt.stadium).not.toBeNull();
    expect(programFor("sv01-167")?.stadium?.ability).toBeUndefined();
    expect(offerFor(beachCourt, "p1")).toBeNull();
  });
});

describe("redactGame — the once-per-turn greying, and the re-arm", () => {
  /** Activate Town Store and answer its `chooseCards` park, landing back on
      turn:action with the allowance spent. */
  function activateTownStore(state: GameState): GameState {
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the search park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    return must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
      }),
    );
  }

  it("greys the row once the turn's activation is spent — and the reason stays null (self-evident)", () => {
    const done = deepFreeze(activateTownStore(withStadium(p1Turn2(1), "p1", "sv03-196")));
    expect(done.phase.kind).toBe("turn:action");
    expect(done.allowances.stadiumAbilityUsed).toBe(true);
    expect(offerFor(done, "p1")).toEqual({
      label: "Town Store",
      disabled: true,
      reason: null,
    });
  });

  it("RE-ARMS for the opponent's own turn — the printed 'once during EACH player's turn'", () => {
    const done = activateTownStore(withStadium(p1Turn2(1), "p1", "sv03-196"));
    const p2Turn = deepFreeze(must(applyAction(done, { type: "endTurn", seat: "p1" })));
    expect(p2Turn.allowances.stadiumAbilityUsed).toBe(false);
    expect(offerFor(p2Turn, "p2")).toEqual({
      label: "Town Store",
      disabled: false,
      reason: null,
    });
    expect(offerFor(p2Turn, "p1")).toBeNull();
  });

  it("keeps the mid-effect `chooseCards` park DIALOGED, to the activator alone", () => {
    const state = withStadium(p1Turn2(1), "p1", "sv03-196");
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    expect(parked.phase.kind).toBe("effect:choose");
    const activator = redactGame(parked, "p1").phase;
    const opponent = redactGame(parked, "p2").phase;
    if (activator.kind !== "effect:choose" || opponent.kind !== "effect:choose") {
      throw new Error("expected effect:choose on both views");
    }
    expect(activator.prompt?.kind).toBe("chooseCards");
    // …and the deck cards the search REVEALED stay off the opponent's wire, the
    // answerer gate this park depends on.
    expect(opponent.prompt).toBeNull();
  });
});

describe("redactGame — the offer AGREES WITH THE ENGINE GATE, state for state", () => {
  it("is pressable EXACTLY when `applyAction` would accept the press", () => {
    const townStore = withStadium(p1Turn2(1), "p1", "sv03-196");
    const { state: parkedThenDone } = mustApply(townStore, {
      type: "useStadiumAbility",
      seat: "p1",
    });
    if (parkedThenDone.phase.kind !== "effect:choose") throw new Error("expected the search park");
    const prompt = parkedThenDone.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const spent = must(
      applyAction(parkedThenDone, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
      }),
    );

    const cases: { name: string; state: GameState; actor: Seat }[] = [
      { name: "no Stadium in play", state: p1Turn2(1), actor: "p1" },
      {
        name: "a continuous-only Stadium",
        state: withStadium(p1Turn2(1), "p1", "sv01-167"),
        actor: "p1",
      },
      { name: "an activated Stadium, unused", state: townStore, actor: "p1" },
      { name: "an activated Stadium, already used", state: spent, actor: "p1" },
      { name: "Artazon, unused", state: withStadium(p1Turn2(2), "p1", "sv02-171"), actor: "p1" },
      { name: "Mesagoza, unused", state: withStadium(p1Turn2(3), "p1", "sv01-178"), actor: "p1" },
      {
        name: "the OPPONENT's turn",
        state: must(applyAction(townStore, { type: "endTurn", seat: "p1" })),
        actor: "p2",
      },
    ];
    const pressable: string[] = [];
    const accepted: string[] = [];
    for (const { name, state, actor } of cases) {
      const offer = offerFor(state, actor);
      if (offer !== null && !offer.disabled) pressable.push(name);
      if (applyAction(state, { type: "useStadiumAbility", seat: actor }).ok) accepted.push(name);
    }
    expect(pressable).toEqual(accepted);
    // A POSITIVE CONTROL on the sweep itself: it must contain both answers, or
    // "equal" is agreement between two empty lists (the vacuous guard again).
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.length).toBeLessThan(cases.length);
  });
});

const LEVINCIA: Card = {
  ...trainerCard("sv09-150", "Stadium", "Once during each player's turn…"),
  name: "Levincia",
  regulationMark: "I",
};

function withLevincia(state: GameState, owner: Seat, lightning: number): GameState {
  const stadiumUid = "levincia-stadium";
  const energyUids = Array.from({ length: lightning }, (_, i) => `levincia-energy-${i}`);
  return {
    ...state,
    // `createGame` stores only the DECKS' cards in `state.cardPool`, so both the
    // Stadium and the Basic {L} Energy it retrieves have to be added here.
    cardPool: {
      ...state.cardPool,
      [LEVINCIA.id]: LEVINCIA,
      "fix-lightning-energy": FIXTURE_POOL["fix-lightning-energy"] as Card,
    },
    cardIdByUid: {
      ...state.cardIdByUid,
      [stadiumUid]: LEVINCIA.id,
      ...Object.fromEntries(energyUids.map((uid) => [uid, "fix-lightning-energy"])),
    },
    stadium: { uid: stadiumUid, owner },
    players: {
      ...state.players,
      [owner]: {
        ...state.players[owner],
        discard: [...state.players[owner].discard, ...energyUids],
      },
    },
  };
}

describe("redactGame — Levincia sv09-150, the Standard-legal driver (D209's finding)", () => {
  it("offers it to the acting seat, withholds it from the opponent, and the press resolves", () => {
    const state = withLevincia(p1Turn2(1), "p1", 2);
    expect(offerFor(state, "p1")).toEqual({ label: "Levincia", disabled: false, reason: null });
    expect(offerFor(state, "p2")).toBeNull();

    // The press the online client can now make — end to end through the engine.
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the retrieval park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.dest).toBe("hand");
    expect(prompt.candidates).toHaveLength(2);
    // And the park is dialoged for the answerer alone — the online client's
    // chooseCards dialog (2b-iii-c) renders exactly this.
    const answererPhase = redactGame(parked, "p1").phase;
    if (answererPhase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(answererPhase.prompt?.kind).toBe("chooseCards");

    const done = must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [...prompt.candidates] },
      }),
    );
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.discard).not.toContain("levincia-energy-0");
    expect(done.players.p1.hand).toContain("levincia-energy-0");
    expect(offerFor(done, "p1")).toEqual({ label: "Levincia", disabled: true, reason: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE `programPlayable` TERM, AND THE HONEST ADMISSION ABOUT IT.

describe('the `programPlayable` term in the fold is correct and, today, UNREACHABLE ( D606 (D539): "UNREACHABLE" is WITHDRAWN — Surfing Beach reaches it; the D606 block below)', () => {
  const STADIUM_ABILITY_IDS = [
    "sv02-171", // Artazon
    "sv03-229", // Artazon (reprint)
    "sv01-178", // Mesagoza
    "sv03-196", // Town Store
    "sv09-150", // Levincia
    "sv10-244", // Levincia (reprint)
    "sv10-169",
    "sv06.5-054",
    "sv10-173", // Team Rocket's Factory
    "sv06-146",
    "me04-080", // Prism Tower
    "me04-111", // Prism Tower
    "me03-077", // Lumiose City
    "me03-111", // Lumiose City
    "mep-028", // Celebratory Fanfare
    "mep-120", // Celebratory Fanfare
  ];

  it("the census is real — every id above carries an ability, and the fixture pool holds no OTHERS", () => {
    for (const id of STADIUM_ABILITY_IDS) {
      expect(programFor(id)?.stadium?.ability).toBeDefined();
    }
    const inPool = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.stadium?.ability !== undefined,
    );
    expect(inPool.sort()).toEqual(["sv01-178", "sv02-171", "sv03-196"]);
  });

  it("NO printed Stadium program can whiff-gate — so no test over the pool can kill this term ( D606 (D539): WITHDRAWN as a claim about EVERY printed Stadium — it holds for the ids listed; Surfing Beach whiff-gates)", () => {
    const base = p1Turn2(1);
    const stripped: GameState = {
      ...base,
      players: {
        p1: { ...base.players.p1, deck: [], hand: [], discard: [], bench: [] },
        p2: { ...base.players.p2, deck: [], hand: [], discard: [], bench: [] },
      },
    };
    for (const id of STADIUM_ABILITY_IDS) {
      const ability = programFor(id)?.stadium?.ability;
      if (ability === undefined) throw new Error(`${id} has no stadium ability`);
      expect(programPlayable(stripped, ability.program, "p1")).toBe(true);
    }
    // The control that makes the loop above mean something: this state DOES make
    // `programPlayable` false for a gated op, so "true" is a fact about these
    // programs and not about this state.
    expect(programPlayable(stripped, [{ op: "gust" }], "p1")).toBe(false);
  });
});

const SURFING_BEACH = "me01-129";
const D606_WATER = "d606-water";

function surfingBeachBoard(benchedWater: boolean): GameState {
  const base = clearBench(p1Turn2(1), "p1");
  const side = base.players.p1;
  const activeUid = side.active?.stack[0] as string;
  const surfUid = "d606-surf-0";
  const waterUid = "d606-water-1";
  const grafted: GameState = {
    ...base,
    cardPool: {
      ...base.cardPool,
      [SURFING_BEACH]: {
        ...trainerCard(
          SURFING_BEACH,
          "Stadium",
          "Once during each player's turn, that player may switch their Active {W} Pokémon with 1 of their Benched {W} Pokémon.",
        ),
        name: "Surfing Beach",
      },
      [D606_WATER]: battler(D606_WATER, { name: "D606 Water", hp: 200, types: ["Water"] }),
    },
    cardIdByUid: {
      ...base.cardIdByUid,
      [surfUid]: SURFING_BEACH,
      [activeUid]: D606_WATER,
      [waterUid]: D606_WATER,
    },
    players: {
      ...base.players,
      p1: { ...side, hand: [...side.hand, surfUid], deck: [...side.deck, waterUid] },
    },
  };
  const played = must(applyAction(grafted, { type: "playTrainer", seat: "p1", uid: surfUid }));
  return benchedWater ? benchFromDeck(played, "p1", D606_WATER) : played;
}

describe("D606 — the `programPlayable` term, REACHED by Surfing Beach", () => {
  it('a {W} Active with no Benched {W}: the row greys "No legal target" and the engine refuses NO_LEGAL_TARGET', () => {
    const board = deepFreeze(surfingBeachBoard(false));
    expect(board.players.p1.bench).toEqual([]);
    expect(offerFor(board, "p1")).toEqual({
      label: "Surfing Beach",
      disabled: true,
      reason: "No legal target",
    });
    const refused = applyAction(board, { type: "useStadiumAbility", seat: "p1" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("a Benched {W} lights the row, and the engine accepts the use", () => {
    const board = deepFreeze(surfingBeachBoard(true));
    expect(offerFor(board, "p1")).toEqual({
      label: "Surfing Beach",
      disabled: false,
      reason: null,
    });
    const { state } = mustApply(board, { type: "useStadiumAbility", seat: "p1" });
    expect(state.cardIdByUid[state.players.p1.active?.stack[0] as string]).toBe(D606_WATER);
    expect(state.players.p1.bench).toHaveLength(1);
  });

  it("the stripped board of the pin above DOES refuse Surfing Beach's program — the inversion, measured", () => {
    const board = surfingBeachBoard(false);
    const ability = programFor(SURFING_BEACH)?.stadium?.ability;
    if (ability === undefined) throw new Error("Surfing Beach has no stadium ability");
    expect(programPlayable(board, ability.program, "p1")).toBe(false);
    expect(programPlayable(surfingBeachBoard(true), ability.program, "p1")).toBe(true);
  });
});
