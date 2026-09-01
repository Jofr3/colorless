// @vitest-environment jsdom
// M4 slice 2 HUD wiring: the Trainer/Ability controls in TurnPanel and the
// effect:choose dialogs dispatch the right engine actions. Real engine states
// via the fixtures; a dispatch spy captures what the buttons send (the engine
// itself is covered by cardplay.test.ts).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState } from "@luminous/engine";
import { applyAction } from "@luminous/engine";
import {
  ABILITY_DECK,
  ATTACH_FROM_TOP_DECK,
  ATTACK_DISCARD_DECK,
  ATTACK_PARK_DECK,
  BOARD_CONDITION_DECK,
  DECK_BOTTOM_DECK,
  DISCARD_ENERGY_DECK,
  EMERGENCY_DECK,
  FIRST_TURN_SUPPORTER_DECK,
  HAND_COST_DECK,
  HEAL_UPTO_DECK,
  MOVE_ENERGY_DECK,
  NS_PLAN_DECK,
  ONKO_DECK,
  PROVIDES_ENERGY_DECK,
  RARE_CANDY_DECK,
  SNIPE_DECK,
  SPECIAL_ENERGY_DECK,
  OPPONENT_ENERGY_MOVE_DECK,
  SPREAD_ENERGY_MOVE_DECK,
  STADIUM_TOOL_DECK,
  TRAINER_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
  toDeckTop,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const both = { p1: TRAINER_DECK, p2: TRAINER_DECK };

/** Setup, then open P1's turn 2 (P2 first → ending their turn 1 unblocks P1's
    unrestricted first turn, so Supporters play). */
function p1Turn2(seed: number, decks: { p1: string[]; p2: string[] }): GameState {
  const state = driveSetup(seed, decks, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Rebuild p1's hand exactly: every dealt card back into the deck, then `ids`
    dealt off it. The cost dialog's whole behaviour turns on hand CONTENTS (the
    candidate set) and hand SIZE (whether the cost parks at all), so the dealt
    hand would make these assertions seed-dependent. */
function withHand(state: GameState, ids: readonly string[]): GameState {
  const side = state.players.p1;
  let next: GameState = {
    ...state,
    players: { ...state.players, p1: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
  };
  for (const id of ids) next = handFromDeck(next, "p1", id, 1);
  return next;
}

function renderHud(state: GameState, dispatch: (action: GameAction) => void) {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />,
  );
}

describe("TurnPanel — Trainer controls", () => {
  it("lists playable Trainers and dispatches playTrainer on click", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-181", 1); // Nest Ball (Item)
    state = handFromDeck(state, "p1", "sv01-189", 1); // Professor's Research (Supporter)
    const nestBall = handUid(state, "p1", "sv01-181");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByText("Trainers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sv01-181" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "playTrainer", seat: "p1", uid: nestBall });
    // The Supporter is offered too (P1's turn 2 is unrestricted).
    expect((screen.getByRole("button", { name: "sv01-189" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("greys a Supporter out once one is played this turn (§7.2)", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-189", 1);
    state = { ...state, allowances: { ...state.allowances, supporterPlayed: true } };
    renderHud(state, vi.fn());
    expect((screen.getByRole("button", { name: "sv01-189" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("greys a Supporter out on the §4 first turn — and NOT one that prints the exemption", () => {
    // D223 — the LOCAL HUD's half of Carmine's flag. Two Supporters, one board,
    // one render: `fix-carmine` prints "If you go first, you may use this card
    // during your first turn." and Nemona (sv01-180) prints nothing.
    //
    // ⚠️ THE DEFECT THIS CLOSES IS THE QUIETER DIRECTION OF THE HUD/ENGINE
    // MISMATCH. `playableTrainers` greys every Supporter on `game.turn === 1`
    // itself, so a flag honoured only by cardplay.ts would leave Carmine legal to
    // the engine and UNCLICKABLE here — and nobody clicks a dead-looking row, so
    // nothing would ever report it. Both rows are asserted in the SAME render, so
    // the test cannot pass by the §4 grey-out having been deleted outright.
    const decks = { p1: FIRST_TURN_SUPPORTER_DECK, p2: FIRST_TURN_SUPPORTER_DECK };
    let state = driveSetup(3, decks, { first: "p1" }); // turn 1 IS p1's
    expect(state.turn).toBe(1);
    state = handFromDeck(state, "p1", "fix-carmine", 1);
    state = handFromDeck(state, "p1", "sv01-180", 1);
    const carmine = handUid(state, "p1", "fix-carmine");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(
      (screen.getByRole("button", { name: "fix-carmine" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole("button", { name: "sv01-180" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // …and the lit row really dispatches the play the engine accepts.
    fireEvent.click(screen.getByRole("button", { name: "fix-carmine" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "playTrainer", seat: "p1", uid: carmine });
  });

  it("offers a Stadium as a button, greyed by the §7.3 gates (played / same name)", () => {
    const decks = { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK };
    let state = p1Turn2(1, decks);
    state = handFromDeck(state, "p1", "sv01-167", 1); // Beach Court
    const beachCourt = handUid(state, "p1", "sv01-167");
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Beach Court" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "playTrainer", seat: "p1", uid: beachCourt });
    cleanup();

    // Played: a SAME-named copy is greyed (the engine would reject it)…
    let played = mustApply(state, { type: "playTrainer", seat: "p1", uid: beachCourt }).state;
    played = handFromDeck(played, "p1", "sv01-167", 1);
    renderHud(played, vi.fn());
    expect(
      (screen.getByRole("button", { name: "Beach Court" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();

    // …and so is a DIFFERENT Stadium this turn (one Stadium play per turn).
    const withOther = handFromDeck(played, "p1", "sv03-192", 1);
    renderHud(withOther, vi.fn());
    expect(
      (screen.getByRole("button", { name: "Pokémon League Headquarters" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // A Tool never becomes a button — attaching is a board drag.
    const withTool = handFromDeck(withOther, "p1", "sv01-197", 1);
    cleanup();
    renderHud(withTool, vi.fn());
    expect(screen.queryByRole("button", { name: "sv01-197" })).toBeNull();
  });
});

describe("TurnPanel — Ability controls", () => {
  it("lists an Active activated Ability and dispatches useAbility", () => {
    let state = p1Turn2(3, { p1: ABILITY_DECK, p2: ABILITY_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-061"); // Chien-Pao ex active
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByText("Abilities")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Shivery Chill/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Shivery Chill",
    });
  });

  it("greys an Active-only Ability on a BENCHED copy — the §9 spot gate is mirrored", () => {
    // Chien-Pao's Shivery Chill is `activeOnly`; a benched copy's row must be
    // dead BEFORE the click, or the row looks live and the engine refuses it
    // with ABILITY_ACTIVE_ONLY — the unmirrored-gate failure (a lit row, a
    // click, and only the reject pill left to explain). Mirror-tested in both
    // directions: the row is grey AND the engine refuses the same action.
    let state = p1Turn2(3, { p1: ABILITY_DECK, p2: ABILITY_DECK });
    state = benchFromDeck(state, "p1", "sv02-061"); // Chien-Pao ex on the Bench
    const index = state.players.p1.bench.length - 1;
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    const row = screen.getByRole("button", {
      name: `Shivery Chill · Chien-Pao ex (Bench ${index + 1})`,
    }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(dispatch).not.toHaveBeenCalled();
    const refused = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index },
      abilityName: "Shivery Chill",
    });
    expect(refused.ok).toBe(false);
  });

  it("🆕 D310 — greys a PER-BODY HP gate on a healthy body, and names the printed clause", () => {
    // Pidove `sv05-133`: "if this Pokémon's remaining HP is 30 or less". The
    // §9 gate `conditionHolds` cannot express (it takes a seat and no uid), so the
    // HUD reads it through the shared `abilityBodyGateMet` rather than re-deriving
    // it — a per-body rule spelled in three places is D222's afford-then-reject.
    let state = p1Turn2(3, { p1: EMERGENCY_DECK, p2: EMERGENCY_DECK });
    state = benchFromDeck(state, "p1", "fix-emergencyevolution");
    const index = state.players.p1.bench.length - 1;
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    const row = screen.getByRole("button", {
      name: `Emergency Evolution · Pidove (Bench ${index + 1})`,
    }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(dispatch).not.toHaveBeenCalled();
    // `getAllByText`: setup can deal a second Pidove onto the bench, and every
    // healthy copy carries the same printed clause. The COUNT is what matters —
    // one greyed row per gated body — not that exactly one exists.
    expect(
      screen.getAllByText("Only if this Pokémon's remaining HP is 30 or less").length,
    ).toBeGreaterThan(0);
    // The mirror, in the direction that matters: the engine refuses the same call.
    expect(
      applyAction(state, {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index },
        abilityName: "Emergency Evolution",
      }).ok,
    ).toBe(false);
  });

  it("🆕 D310 — lights the SAME row at the printed boundary, exactly where the engine opens", () => {
    // 70 − 40 = 30, the printed "or less" at its exact edge. The pair of rungs is
    // the whole guard: one board grey and refused, one board lit and accepted.
    let state = p1Turn2(3, { p1: EMERGENCY_DECK, p2: EMERGENCY_DECK });
    state = benchFromDeck(state, "p1", "fix-emergencyevolution");
    const index = state.players.p1.bench.length - 1;
    // `setDamage` is Active-only; the gate's whole point is that it works on the
    // BENCH, so the counter goes on by surgery here.
    const bench = [...state.players.p1.bench];
    const body = bench[index];
    if (body === undefined || body === null) throw new Error("no benched Pidove");
    bench[index] = { ...body, damage: 40 };
    state = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, bench } },
    };
    renderHud(state, vi.fn());

    expect(
      (
        screen.getByRole("button", {
          name: `Emergency Evolution · Pidove (Bench ${index + 1})`,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      applyAction(state, {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index },
        abilityName: "Emergency Evolution",
      }).ok,
    ).toBe(true);
  });

  it("greys an Ability whose printed hand COST cannot be paid, with the reason", () => {
    // The §7.5 gate the Trainer rows have always mirrored, on the OTHER printed
    // wording ("You must discard a Basic {G} Energy card from your hand in order
    // to use this Ability"). Without it the row looks live, the click is refused
    // with ABILITY_COST_UNMET, and the HUD never says why — the exact failure the
    // Trainer list's own comment names.
    let state = p1Turn2(3, { p1: SNIPE_DECK, p2: SNIPE_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-015"); // Meowscarada ex
    state = benchFromDeck(state, "p2", "fix-basic-1"); // a legal snipe target
    state = withHand(state, ["fix-basic-1"]); // no Basic {G} to pay with
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    const row = screen.getByRole("button", { name: /Bouquet Magic/ }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(dispatch).not.toHaveBeenCalled();
    expect(
      screen.getByText("Only if you discard a Basic Grass Energy card from your hand"),
    ).toBeTruthy();
  });

  it("lights the same Ability once the cost is payable", () => {
    let state = p1Turn2(3, { p1: SNIPE_DECK, p2: SNIPE_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-015");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = withHand(state, ["fix-grass-energy"]);
    renderHud(state, vi.fn());
    expect(
      (screen.getByRole("button", { name: /Bouquet Magic/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("names WHERE each copy sits, and greys only the one that used its Ability", () => {
    // Skwovet ×2 is the first board with two identical Ability rows. The
    // once-per-turn allowance is per Pokémon, so after one use exactly one row is
    // dead — and DOM order is not something a screen reader reads off a button.
    let state = p1Turn2(3, { p1: DECK_BOTTOM_DECK, p2: DECK_BOTTOM_DECK });
    state = setActiveFromDeck(state, "p1", "sv01-151");
    state = benchFromDeck(state, "p1", "sv01-151");
    const benchLabel = `Nest Stash · Skwovet (Bench ${state.players.p1.bench.length})`;
    renderHud(state, vi.fn());

    const active = screen.getByRole("button", {
      name: "Nest Stash · Skwovet (Active)",
    }) as HTMLButtonElement;
    const benched = screen.getByRole("button", { name: benchLabel }) as HTMLButtonElement;
    expect(active.disabled).toBe(false);
    expect(benched.disabled).toBe(false);

    const used = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Nest Stash",
    }).state;
    cleanup();
    renderHud(used, vi.fn());
    expect(
      (screen.getByRole("button", { name: "Nest Stash · Skwovet (Active)" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: benchLabel }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("TurnPanel — Rare Candy (§7.1)", () => {
  const both = { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK };

  /** p1 first, advanced to turn 3 (their SECOND turn — past the §4/§7.1
      first-turn ban), with a setup fix-basic-1 Active (turnPlayed 0). */
  function p1Turn3(seed: number): GameState {
    let state = driveSetup(seed, both, {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    });
    while (state.turn < 3) {
      if (state.phase.kind !== "turn:action") throw new Error(`unexpected phase ${state.phase.kind}`);
      state = mustApply(state, { type: "endTurn", seat: state.phase.seat }).state;
    }
    return state;
  }

  it("opens the Rare Candy dialog (not playTrainer) and dispatches rareCandy", () => {
    let state = p1Turn3(4);
    state = handFromDeck(state, "p1", "sv01-191", 1); // Rare Candy
    state = handFromDeck(state, "p1", "fix-stage2", 1); // the Stage 2
    const rareUid = handUid(state, "p1", "sv01-191");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    // Clicking Rare Candy opens the dialog — it must NOT dispatch playTrainer.
    fireEvent.click(screen.getByRole("button", { name: "Rare Candy" }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Rare Candy" })).toBeTruthy();

    // One Basic in play → the Stage 2 pick shows directly. Picking dispatches.
    fireEvent.click(screen.getAllByRole("button", { name: "fix-stage2" })[0] as HTMLElement);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call).toMatchObject({
      type: "rareCandy",
      seat: "p1",
      uid: rareUid,
      target: { spot: "active" },
    });
    if (call.type === "rareCandy") expect(state.cardIdByUid[call.evolutionUid]).toBe("fix-stage2");
  });

  it("greys Rare Candy out when no Basic in play links to a Stage 2 in hand", () => {
    // Evolve the Active off Basic (empty bench) → no legal Rare Candy target.
    let state = p1Turn3(4);
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    const stage1 = handUid(state, "p1", "fix-stage1");
    state = mustApply(state, { type: "evolve", seat: "p1", uid: stage1, target: { spot: "active" } }).state;
    state = handFromDeck(state, "p1", "sv01-191", 1);
    renderHud(state, vi.fn());
    expect((screen.getByRole("button", { name: "Rare Candy" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("effect:choose — the search dialog (chooseCards)", () => {
  it("renders the parked search and dispatches resolveEffect on 'Take none'", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-181", 1);
    const uid = handUid(state, "p1", "sv01-181");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    expect(state.phase.kind).toBe("effect:choose");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByRole("dialog", { name: "Choose cards" })).toBeTruthy();
    // The DECLINABLE branch: the counter says "up to", and Confirm is live at 0.
    expect(screen.getByText("Pick up to 1 (0/1).")).toBeTruthy();
    const takeNone = screen.getByRole("button", { name: "Take none" }) as HTMLButtonElement;
    expect(takeNone.disabled).toBe(false);
    fireEvent.click(takeNone);
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
  });

  it("the declinable branch's NON-empty pick reads and dispatches as 'Take N'", () => {
    // The "up to" path with something actually selected was untested: every other
    // declinable case clicks "Take none" immediately, so the whole Take-N label
    // and the pressed-row state were unpinned.
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-181", 1); // Nest Ball
    const uid = handUid(state, "p1", "sv01-181");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const first = prompt.candidates[0] as string;
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    const row = screen.getAllByRole("button", { name: "fix-basic-1" })[0] as HTMLElement;
    fireEvent.click(row);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Pick up to 1 (1/1).")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take 1" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [first] },
    });
  });
});

describe("effect:choose — the MANDATORY cost dialog (chooseCards min > 0)", () => {
  /** Ultra Ball parked on its printed cost: the Item plus three
      DISTINGUISHABLE others, so the pick is a real question (identical cards
      collapse and would resolve with no dialog at all). */
  function parkedCost(): GameState {
    let state = p1Turn2(1, { p1: HAND_COST_DECK, p2: HAND_COST_DECK });
    state = withHand(state, ["sv01-196", "fix-item", "fix-grass-energy", "fix-special"]);
    const uid = handUid(state, "p1", "sv01-196");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected the cost to park");
    return state;
  }

  it("reads as an EXACT pick, not an 'up to' — and Confirm is dead until it is met", () => {
    const state = parkedCost();
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    // The heading is the card's own instruction; the counter must NOT say "up
    // to", which would advertise a decline resolveEffect will reject — and it
    // says outright that the cost cannot be declined, because the ABSENCE of a
    // "Take none" button is not something a screen reader announces.
    expect(screen.getByText("Discard 2 cards from your hand.")).toBeTruthy();
    expect(
      screen.getByText("Pick 2 (0/2). Pick 2 more — this pick can't be declined."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take none" })).toBeNull();
    // The verb is DISCARD, not "Take" — a cost is spent, not gained — and it
    // carries the denominator, since Confirm is the only self-describing surface
    // a keyboard user reaches once it becomes focusable.
    const confirm = screen.getByRole("button", { name: "Discard 0/2" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    // A dead button must not dispatch a rejection either.
    fireEvent.click(confirm);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("announces the running count in ONE region that survives the transition", () => {
    // The counter is the dialog's only live region (role=status via <output>) and
    // must stay MOUNTED through short -> satisfied: that transition is when
    // Confirm becomes reachable, and a region that unmounts on satisfaction says
    // nothing at the only moment it had something to say.
    const state = parkedCost();
    renderHud(state, vi.fn());
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("Pick 2 (0/2). Pick 2 more — this pick can't be declined.");
    fireEvent.click(screen.getByRole("button", { name: "fix-item" }));
    expect(live.textContent).toBe("Pick 2 (1/2). Pick 1 more — this pick can't be declined.");
    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    // Same node, satisfied text — not a removal, which announces nothing.
    expect(screen.getByRole("status")).toBe(live);
    expect(live.textContent).toBe("Pick 2 (2/2). Ready.");
  });

  it("stays disabled one card short, and dispatches the exact pick at the count", () => {
    const state = parkedCost();
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    fireEvent.click(screen.getByRole("button", { name: "fix-item" }));
    // ONE short: Confirm is still dead — the failure mode this replaces is a
    // player clicking Confirm and being told no by the engine.
    expect(
      (screen.getByRole("button", { name: "Discard 1/2" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    const confirm = screen.getByRole("button", { name: "Discard 2/2" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "cards",
        uids: [handUid(state, "p1", "fix-item"), handUid(state, "p1", "fix-special")],
      },
    });
  });

  it("marks over-cap rows aria-disabled rather than letting them go silently inert", () => {
    const state = parkedCost();
    renderHud(state, vi.fn());
    // (rows read by card NAME — typedEnergy names itself "Grass Energy")
    const grass = () => screen.getByRole("button", { name: "Grass Energy" }) as HTMLButtonElement;
    expect(grass().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "fix-item" }));
    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    // At the cap the unpicked row is refused — and SAYS so. A silently inert
    // button is the one thing the live region cannot announce, since clicking it
    // changes nothing.
    expect(grass().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(grass());
    expect(screen.getByText("Pick 2 (2/2). Ready.")).toBeTruthy();
    expect(grass().getAttribute("aria-pressed")).toBe("false");
    // It stays FOCUSABLE — the rows are how you read the offer.
    expect(grass().disabled).toBe(false);
    // Deselecting frees the slot again, and the row goes live again with it.
    fireEvent.click(screen.getByRole("button", { name: "fix-item" }));
    expect(grass().getAttribute("aria-disabled")).toBeNull();
  });

  it("a count-1 cost is exact too (Earthen Vessel) — not a declinable 'up to 1'", () => {
    // Four of the six cards in the family are count 1, and none was covered:
    // `min > 0` mutated to `min > 1` turned every one of them back into a
    // declinable dialog whose Confirm dispatches an empty pick the engine rejects.
    let state = p1Turn2(1, { p1: HAND_COST_DECK, p2: HAND_COST_DECK });
    state = withHand(state, ["sv06.5-096", "fix-item", "fix-grass-energy"]);
    const uid = handUid(state, "p1", "sv06.5-096");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected the cost to park");
    renderHud(state, vi.fn());

    expect(screen.getByText("Discard a card from your hand.")).toBeTruthy();
    expect(screen.getByText("Pick 1 (0/1). Pick 1 more — this pick can't be declined.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take none" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Discard 0/1" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "fix-item" }));
    expect(
      (screen.getByRole("button", { name: "Discard 1/1" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("a SECOND chooseCards park in one play starts empty (Ultra Ball: cost, then search)", () => {
    // Ultra Ball is the codebase's likeliest double-park on ONE prompt kind. If
    // promptKey did not discriminate them, the cost's picks would survive into
    // the search — rendering rows that do not exist, with no decline and Escape
    // swallowed, i.e. an unescapable dialog.
    let state = p1Turn2(1, { p1: HAND_COST_DECK, p2: HAND_COST_DECK });
    state = withHand(state, ["sv01-196", "fix-item", "fix-grass-energy", "fix-special"]);
    const uid = handUid(state, "p1", "sv01-196");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected the cost to park");
    const costPrompt = state.phase.prompt;
    if (costPrompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // Pay it through the engine, landing on Ultra Ball's own deck search.
    state = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: costPrompt.candidates.slice(0, 2) },
    }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected the search to park");
    const searchPrompt = state.phase.prompt;
    if (searchPrompt.kind !== "chooseCards") throw new Error("expected chooseCards");

    renderHud(state, vi.fn());
    // The second park is the DECLINABLE search, rendered from scratch: no
    // selection carried over, and "Take none" is live again.
    expect(screen.getByText("Pick up to 1 (0/1).")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Take none" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByRole("status")?.textContent).toBe("Pick up to 1 (0/1).");
  });
});

describe("the hand cost paid UNDER THE DECK (Dendra, M5)", () => {
  const deckBottomDecks = { p1: DECK_BOTTOM_DECK, p2: DECK_BOTTOM_DECK };

  /** Dendra parked on its payment: the Supporter plus three DISTINGUISHABLE
      others, so the pick is a real question rather than a collapse. */
  function parkedDendra(): GameState {
    let state = p1Turn2(1, deckBottomDecks);
    state = withHand(state, ["sv02-179", "fix-item", "fix-grass-energy", "fix-water-energy"]);
    const uid = handUid(state, "p1", "sv02-179");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected the payment to park");
    return state;
  }

  it("says PUT UNDER DECK, not discard — the verb follows the destination", () => {
    const state = parkedDendra();
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    // Same mandatory dialog as Ultra Ball's, one word apart: a player must be
    // able to tell "this card is gone" from "this card is at the bottom of my
    // deck", and the heading + button are where that lives.
    expect(
      screen.getByText(
        "Put a card from your hand on the bottom of your deck. If you do, draw cards until you have 5 cards in your hand.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Pick 1 (0/1). Pick 1 more — this pick can't be declined.",
    );
    expect(screen.queryByRole("button", { name: "Take none" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Discard/ })).toBeNull();
    const confirm = screen.getByRole("button", { name: "Put under deck 0/1" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "fix-item" }));
    const ready = screen.getByRole("button", { name: "Put under deck 1/1" }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [handUid(state, "p1", "fix-item")] },
    });
  });

  it("greys the card out on a hand of nothing else, with the printed reason", () => {
    // The HUD must mirror the engine's gate (the D46 doctrine): a Dendra alone in
    // hand is dead, and it is dead at exactly the moment a player reaches for it.
    let state = p1Turn2(1, deckBottomDecks);
    state = withHand(state, ["sv02-179"]);
    renderHud(state, vi.fn());
    const button = screen.getByRole("button", { name: /sv02-179/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText("Only if you put another card from your hand on the bottom of your deck"),
    ).toBeTruthy();
  });

  it("lights the card up again the moment a second card is in hand", () => {
    let state = p1Turn2(1, deckBottomDecks);
    state = withHand(state, ["sv02-179", "fix-item"]);
    renderHud(state, vi.fn());
    expect((screen.getByRole("button", { name: /sv02-179/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("effect:choose — the target dialog (choosePokemon)", () => {
  it("renders the parked heal target and dispatches resolveEffect with a ref", () => {
    let state = p1Turn2(2, both);
    state = setDamage(state, "p1", 50);
    // Give P1 a Bench Pokémon so Potion must CHOOSE (active + bench = 2 targets).
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    const benchUid = handUid(state, "p1", "fix-basic-1");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: benchUid }).state;
    state = handFromDeck(state, "p1", "sv01-188", 1); // Potion
    const potion = handUid(state, "p1", "sv01-188");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid: potion }).state;
    expect(state.phase.kind).toBe("effect:choose");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByRole("dialog", { name: "Choose a Pokémon" })).toBeTruthy();
    // The Active is offered first — clicking it dispatches the heal target.
    const buttons = screen.getAllByRole("button");
    const target = buttons.find((b) => b.textContent && b.textContent.length > 0);
    if (target === undefined) throw new Error("no target button");
    fireEvent.click(target);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call.type).toBe("resolveEffect");
    if (call.type === "resolveEffect") expect(call.choice.kind).toBe("pokemon");
  });
});

describe("🆕 D359 effect:choose — the printed CEILING on the target dialog", () => {
  /** The heal board above, re-parked with a ceiling on the prompt. Hand-built
      rather than driven from a card: every printing that produces a `upTo > 1`
      park lives in `sv08`/`sv09`/`sv10`, none of which the local HUD pool holds,
      and the claim here is about the DIALOG rather than about a card. The engine
      side is driven end to end on real ids in `attachQuantity.test.ts`. */
  function parkedWith(upTo: number | undefined): GameState {
    let state = p1Turn2(2, both);
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    const benchUid = handUid(state, "p1", "fix-basic-1");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: benchUid }).state;
    return {
      ...state,
      phase: {
        kind: "effect:choose",
        seat: "p1",
        prompt: {
          kind: "choosePokemon",
          candidates: [{ seat: "p1", spot: { spot: "bench", index: 0 } }],
          ...(upTo === undefined ? {} : { upTo }),
          note: "Attach up to 2 Energy to which of your Pokémon?",
        },
        cont: { pendingOp: { op: "drawCards", count: 1 }, rest: [], ctx: { seat: "p1" } },
      },
    } as GameState;
  }

  it("offers a row PER QUANTITY above one, each dispatching body AND quantity", () => {
    const dispatch = vi.fn();
    renderHud(parkedWith(2), dispatch);
    const rows = screen
      .getAllByRole("button")
      .filter((b) => (b.textContent ?? "").includes("attach"));
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0] as HTMLElement);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect") throw new Error("expected resolveEffect");
    expect(call.choice).toEqual({
      kind: "pokemon",
      ref: { seat: "p1", spot: { spot: "bench", index: 0 } },
      take: 1,
    });
  });

  it("🛑 `upTo: 1` renders the SINGLE row it always did — the pre-D359 frame", () => {
    const dispatch = vi.fn();
    renderHud(parkedWith(1), dispatch);
    expect(screen.getAllByRole("button").filter((b) => (b.textContent ?? "").includes("attach")))
      .toHaveLength(0);
    expect(screen.getByRole("button", { name: /^Take none$/ })).toBeTruthy();
  });

  it("a MANDATORY prompt offers neither a quantity nor a Take none", () => {
    const dispatch = vi.fn();
    renderHud(parkedWith(undefined), dispatch);
    expect(screen.queryByRole("button", { name: /^Take none$/ })).toBeNull();
    expect(screen.getAllByRole("button").filter((b) => (b.textContent ?? "").includes("attach")))
      .toHaveLength(0);
  });
});

describe("effect:choose — the snipe multi-target dialog (choosePokemonMulti)", () => {
  const snipeDecks = { p1: SNIPE_DECK, p2: SNIPE_DECK };

  /** p1's turn with a Hawlucha "Flying Entry" parked on its multi-snipe: 3
      opponent Benched Pokémon (>2), so it parks on choosePokemonMulti (max 2). */
  function parkedSnipe(seed: number): GameState {
    let state = p1Turn2(seed, snipeDecks);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = handFromDeck(state, "p1", "sv01-118", 1); // Hawlucha
    const uid = handUid(state, "p1", "sv01-118");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return state;
  }

  it("renders the parked targets and dispatches resolveEffect with multiple refs", () => {
    const state = parkedSnipe(4);
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByRole("dialog", { name: "Choose Pokémon" })).toBeTruthy();
    // The 3 opponent Benched candidates are the only buttons besides Confirm.
    const rows = screen.getAllByRole("button", { name: /fix-basic-1/ });
    expect(rows.length).toBe(3);
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.click(rows[2] as HTMLElement);
    // aria-pressed is the only per-row readback of what is selected.
    expect(rows.map((r) => r.getAttribute("aria-pressed"))).toEqual(["true", "false", "true"]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm 2/2" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call.type).toBe("resolveEffect");
    if (call.type !== "resolveEffect") throw new Error("expected resolveEffect");
    if (call.choice.kind !== "pokemonMulti") throw new Error("expected pokemonMulti");
    // WHICH Pokémon, not just how many: the counters land where the player
    // clicked, so a dialog dispatching "the first `max` candidates" — which
    // passes any length-only assertion — would damage the wrong bodies.
    const prompt = state.phase.kind === "effect:choose" ? state.phase.prompt : null;
    if (prompt?.kind !== "choosePokemonMulti") throw new Error("expected the snipe prompt");
    expect(call.choice.refs).toEqual([prompt.candidates[0], prompt.candidates[2]]);
  });

  it("refuses a third pick at the cap, and SAYS the row is refused", () => {
    // The cap is reached on every mandatory pick (min === max), so a silently
    // inert row is not an edge case here — and a click that changes nothing is
    // the one thing the live region cannot announce (ChooseCardsDialog's rule).
    const state = parkedSnipe(4);
    renderHud(state, vi.fn());
    const rows = screen.getAllByRole("button", { name: /fix-basic-1/ });
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.click(rows[1] as HTMLElement);
    const third = rows[2] as HTMLElement;
    expect(third.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(third);
    expect(third.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("Pick 2 (2/2).");
    // Deselecting frees the slot, and the refused row goes live again.
    fireEvent.click(rows[0] as HTMLElement);
    expect(third.getAttribute("aria-disabled")).toBeNull();
  });

  it("can Take none (the snipe is 'you may')", () => {
    const state = parkedSnipe(4);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Take none" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [] },
    });
  });

  it("refuses ONE of the two — 'you may choose 2' is all-or-nothing, not 'up to 2'", () => {
    // The gap the engine rejects and the dialog must not offer: none is legal
    // (the printed "you may"), two is legal, one is not. Confirm carries the
    // denominator so the state is readable at the only surface a keyboard user
    // reaches once it becomes focusable again.
    const state = parkedSnipe(4);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    const rows = screen.getAllByRole("button", { name: /fix-basic-1/ });
    fireEvent.click(rows[0] as HTMLElement);
    const confirm = screen.getByRole("button", { name: "Confirm 1/2" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(dispatch).not.toHaveBeenCalled();
    // The live region says both ways out — the count still needed, and the
    // decline, which the absence of a button announces to nobody. It is ONE node
    // that survives short → satisfied: a region that unmounts when the pick
    // becomes legal says nothing at the only moment it had something to say.
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("Pick 2 (1/2). Pick 1 more, or none at all.");
    fireEvent.click(rows[1] as HTMLElement);
    expect(screen.getByRole("status")).toBe(live);
    expect(live.textContent).toBe("Pick 2 (2/2).");
    // Deselecting both returns to the legal empty answer, "Take none" and all —
    // and the region says the decline is allowed, which nothing else announces.
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.click(rows[1] as HTMLElement);
    // At zero the empty answer is itself legal, so the region stops asking for
    // more and says the decline is allowed — the state the missing button means.
    expect(live.textContent).toBe("Pick 2 (0/2). Taking none is allowed.");
    expect((screen.getByRole("button", { name: "Take none" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("a MANDATORY snipe offers no decline at all (Meowscarada ex — the cost is paid)", () => {
    // The same dialog under the other printed sentence: "put 3 damage counters on
    // 1 of your opponent's Benched Pokémon" behind an irreversible {G}-discard
    // cost. No "you may" on the placement, so there is no "Take none" — the
    // failure this replaces is paying the cost and then placing nothing.
    let state = p1Turn2(4, snipeDecks);
    state = setActiveFromDeck(state, "p1", "sv02-015");
    state = handFromDeck(state, "p1", "fix-grass-energy", 1);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Bouquet Magic",
    }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected the snipe to park");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByText("Choose 1 of your opponent's Benched Pokémon (3 damage counters each).")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Pick 1 (0/1). Pick 1 more.");
    expect(screen.queryByRole("button", { name: "Take none" })).toBeNull();
    const confirm = screen.getByRole("button", { name: "Confirm 0/1" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: /fix-basic-1/ })[0] as HTMLElement);
    const ready = screen.getByRole("button", { name: "Confirm 1/1" }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect") throw new Error("expected resolveEffect");
    if (call.choice.kind !== "pokemonMulti") throw new Error("expected pokemonMulti");
    expect(call.choice.refs).toHaveLength(1);
  });
});

describe("effect:choose — the 'up to' pick (Saguaro, choosePokemonMulti min 0)", () => {
  const healDecks = { p1: HEAL_UPTO_DECK, p2: HEAL_UPTO_DECK };

  /** p1's turn with Saguaro parked over 3 of their own Pokémon (min 0, max 2)
      — the first prompt of this kind where min ≠ max, so a PARTIAL pick is a
      legal answer no earlier consumer of the dialog allowed. */
  function parkedHeal(seed: number): GameState {
    let state = p1Turn2(seed, healDecks);
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = handFromDeck(state, "p1", "sv02-187", 1);
    const uid = handUid(state, "p1", "sv02-187");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return state;
  }

  it("confirms a PARTIAL pick — 1 of max 2 dispatches, with no denominator on the button", () => {
    // Under every exact prompt "Confirm 1/2" is a disabled gap; under "up to 2"
    // one pick IS a legal answer, so the button is live and carries no
    // denominator ("Confirm 1" — there is no count the player owes).
    const state = parkedHeal(3);
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(
      screen.getByText("Choose up to 2 of your Pokémon and heal 50 damage from each of them."),
    ).toBeTruthy();
    // The live region says the pick is bounded, not owed.
    expect(screen.getByRole("status").textContent).toBe("Pick up to 2 (0/2).");
    // The candidates are the viewer's OWN Pokémon — no "opponent" badge.
    expect(screen.queryByText("opponent")).toBeNull();
    const rows = screen.getAllByRole("button", { name: /fix-basic-1/ });
    expect(rows.length).toBe(3);
    fireEvent.click(rows[1] as HTMLElement);
    expect(screen.getByRole("status").textContent).toBe("Pick up to 2 (1/2).");
    const confirm = screen.getByRole("button", { name: "Confirm 1" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect") throw new Error("expected resolveEffect");
    if (call.choice.kind !== "pokemonMulti") throw new Error("expected pokemonMulti");
    const prompt = state.phase.kind === "effect:choose" ? state.phase.prompt : null;
    if (prompt?.kind !== "choosePokemonMulti") throw new Error("expected the heal prompt");
    expect(call.choice.refs).toEqual([prompt.candidates[1]]);
  });

  it("offers Take none — 'up to' declines without a printed 'you may'", () => {
    const state = parkedHeal(3);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Take none" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [] },
    });
  });

  it("every field rides promptKey — min, max, declinable and the candidates each remount", () => {
    // The hazard is LATENT (no live path parks choosePokemonMulti twice with no
    // render between), but the key's doc claims the discrimination and until
    // now nothing pinned it — gutting the whole key to "pokemonMulti" passed
    // the suite. The attachCards belt technique: a real park, one prompt field
    // swapped; if the segment rides the key the dialog remounts and the pick is
    // gone, if not the stale pick survives and the assertion fails.
    const first = parkedHeal(3);
    if (first.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = first.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected the heal prompt");
    const patches = [
      { min: 1 },
      { max: 1 },
      { declinable: true },
      { candidates: prompt.candidates.slice(0, 2) },
    ];
    for (const patch of patches) {
      const second: GameState = {
        ...first,
        phase: { ...first.phase, prompt: { ...prompt, ...patch } },
      };
      const view = (s: GameState) => (
        <GameHud
          game={s}
          projection={projectGameState(s, "p1")}
          viewerSeat="p1"
          names={NAMES}
          dispatch={() => {}}
          onPlayAgain={() => {}}
        />
      );
      const { rerender, unmount } = render(view(first));
      const row = screen.getAllByRole("button", { name: /fix-basic-1/ })[0] as HTMLElement;
      fireEvent.click(row);
      expect(row.getAttribute("aria-pressed")).toBe("true");
      rerender(view(second));
      const rows = screen.getAllByRole("button", { name: /fix-basic-1/ });
      expect(rows.every((r) => r.getAttribute("aria-pressed") === "false")).toBe(true);
      unmount();
    }
  });
});

describe("effect:choose — the move-energy dialog (moveEnergy)", () => {
  const moveDecks = { p1: MOVE_ENERGY_DECK, p2: MOVE_ENERGY_DECK };

  /** p1's turn with Energy Switch parked: one Basic Energy on the Active (the
      only source, so it auto-selects) and a distinctly-named benched destination. */
  function parkedMove(seed: number, energies = 1): GameState {
    let state = p1Turn2(seed, moveDecks);
    state = benchFromDeck(state, "p1", "fix-basic-2"); // a distinct destination at index 0
    state = attachFromDeck(state, "p1", "fix-fire-energy", energies); // Basic Energy on the Active
    state = handFromDeck(state, "p1", "sv01-173", 1); // Energy Switch
    const uid = handUid(state, "p1", "sv01-173");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return state;
  }

  it("moves the picked Energy to the chosen destination", () => {
    const state = parkedMove(1);
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByRole("dialog", { name: "Move Energy" })).toBeTruthy();
    // The Active is the only source, so it auto-selects — its Energy + the
    // destination render straight away.
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "fix-basic-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Move 1" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call.type).toBe("resolveEffect");
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    expect(call.choice.picks).toHaveLength(1);
    expect(call.choice.picks[0]?.dest.spot).toEqual({ spot: "bench", index: 0 });
  });

  it("declines with 'Move none'", () => {
    const state = parkedMove(2);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Move none" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call.type).toBe("resolveEffect");
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    // D442 — the decline is `picks: []` and names NO destination; the arbitrary
    // `prompt.destinations[0]` the old frame had to carry is gone.
    expect(call.choice.picks).toEqual([]);
  });

  it("🆕 a FLOOR withholds 'Move none' and holds Move disabled until the pick is WHOLE", () => {
    // 🛑 D441 — Castform's printed *"Move all Energy from this Pokémon to 1 of
    // your Benched Pokémon."* The board is the very one the two tests above use,
    // and the ONLY difference is the prompt's `min`: a build that ignored the field
    // would pass both of them and fail every line here.
    //
    // ⚠️ THE PROMPT IS PATCHED RATHER THAN DERIVED, AND THAT IS A CLAIM ABOUT THE
    // READER (D440). `MOVE_ENERGY_DECK` fields Energy Switch and Poppy, neither of
    // which prints a mandatory quantifier; the engine-side park is DRIVEN off a real
    // printing in `derivedMoveAllEnergy.test.ts`, and what is under test here is the
    // dialog's response to a prompt shape, which is a function of the prompt.
    // TWO movable Energy, deliberately: at ONE the floor and the pre-existing
    // `pickedUids.length > 0` agree on every answer, so a build ignoring `min`
    // would render an identical dialog. The Confirm rung below is only reachable
    // above one.
    const base = parkedMove(4, 2);
    if (base.phase.kind !== "effect:choose" || base.phase.prompt.kind !== "moveEnergy") {
      throw new Error("expected a parked moveEnergy prompt");
    }
    const movable = base.phase.prompt.movable;
    expect(movable).toHaveLength(2);
    const state: GameState = {
      ...base,
      phase: {
        ...base.phase,
        prompt: {
          ...base.phase.prompt,
          max: movable.length,
          min: movable.length,
          note: "Move all Energy from this Pokémon to 1 of your Benched Pokémon.",
        },
      },
    };
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    // The decline is WITHHELD, not disabled — the empty answer is not one of this
    // prompt's answers, so it is not a row on screen at all.
    expect(screen.queryByRole("button", { name: "Move none" })).toBeNull();
    // …and the heading is the card's own sentence rather than an "up to" the print
    // does not carry.
    expect(screen.getByRole("dialog", { name: "Move Energy" }).textContent).toContain(
      "Move all Energy from this Pokémon to 1 of your Benched Pokémon.",
    );
    // Confirm is dead until the pick is complete, and live once it is.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Move 0" }).disabled).toBe(true);
    const rows = screen.getAllByRole("button", { name: "Fire Energy" });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0] as HTMLElement);
    // 🛑 ONE OF TWO IS STILL SHORT. This is the rung the pre-slice `pickedUids.length
    // > 0` cannot pass, and the only one in this file that can tell the floor from
    // the family's standing "at least one".
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Move 1" }).disabled).toBe(true);
    fireEvent.click(rows[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "fix-basic-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Move 2" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    expect(call.choice.picks.map((pick) => pick.uid)).toEqual(movable.map((m) => m.uid));
    // 🛑 THE CONTROL, on the UNPATCHED prompt: the decline IS on screen. Without
    // it "no Move none button" passes on a dialog that renders no buttons at all.
    dispatch.mockClear();
    renderHud(base, dispatch);
    expect(screen.getAllByRole("button", { name: "Move none" }).length).toBeGreaterThan(0);
  });

  it("with two sources, picks a source (the multi-source stage) then its Energy + a destination", () => {
    let state = p1Turn2(3, moveDecks);
    // Distinct-named source Pokémon: fix-basic-1 Active, fix-basic-2 benched.
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-basic-2");
    // Poppy (any Energy) with Energy on BOTH → two sources, so the source picker shows.
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // on the Active (fix-basic-1)
    state = attachBenchFromDeck(state, "p1", 0, "fix-water-energy", 1); // on the Bench (fix-basic-2)
    state = handFromDeck(state, "p1", "sv03-193", 1); // Poppy
    const uid = handUid(state, "p1", "sv03-193");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(screen.getByRole("dialog", { name: "Move Energy" })).toBeTruthy();
    // Stage A: two sources → pick the Active (fix-basic-1).
    fireEvent.click(screen.getByRole("button", { name: "fix-basic-1" }));
    // Stage B: its Energy (Fire) + the destination (the OTHER Pokémon, fix-basic-2).
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "fix-basic-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Move 1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call.type).toBe("resolveEffect");
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    expect(call.choice.picks).toHaveLength(1);
    // The destination is the benched fix-basic-2 (index 0), not the source Active.
    expect(call.choice.picks[0]?.dest.spot).toEqual({ spot: "bench", index: 0 });
  });

  it("with TWO destinations nothing is pre-chosen — the pick is the player's", () => {
    // The other side of the sole-destination pre-select: it must fire ONLY when
    // the destination is forced. Every other dialog test in this file leaves
    // exactly one destination after the source is chosen, so without this a
    // dialog that simply always took `dests[0]` would pass the whole suite while
    // silently sending Energy to the wrong Pokémon on any 3-Pokémon board.
    let state = p1Turn2(9, moveDecks);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-basic-2"); // index 0
    state = benchFromDeck(state, "p1", "fix-basic-1"); // index 1 — the one we want
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // the Active is the SOLE source
    state = handFromDeck(state, "p1", "sv01-173", 1); // Energy Switch
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-173"),
    }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy" }));
    // Energy picked, destination still open → Confirm must stay shut. (The Active
    // is the source, so it is not among the destinations: the "fix-basic-1"
    // button here is unambiguously the BENCHED one at index 1.)
    expect((screen.getByRole("button", { name: "Move 1" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "fix-basic-2" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "fix-basic-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Move 1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    // Index 1, NOT the first offered destination.
    expect(call.choice.picks[0]?.dest.spot).toEqual({ spot: "bench", index: 1 });
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("'← Back' clears the previous source's pick, so the answer is never mixed", () => {
    // The source picker is re-enterable, and `reset()` is what keeps that honest.
    // Without its `setPickedUids([])`, going Back and choosing another source
    // would dispatch the FIRST source's Energy — and the engine would ACCEPT it
    // (validateChoice only requires one common source and dest ≠ source), so it
    // is a silent wrong move rather than a rejection.
    let state = p1Turn2(10, moveDecks);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // on the Active
    state = attachBenchFromDeck(state, "p1", 0, "fix-water-energy", 1); // on the Bench
    state = handFromDeck(state, "p1", "sv03-193", 1); // Poppy — two sources
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv03-193"),
    }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const onBench = state.players.p1.bench[0]?.energy[0];

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(screen.getByRole("button", { name: "fix-basic-1" })); // source A: the Active
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy" })); // …and its Energy
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    fireEvent.click(screen.getByRole("button", { name: "fix-basic-2" })); // source B: the Bench
    // The count restarts at 0 — the Fire pick did not survive the change.
    expect((screen.getByRole("button", { name: "Move 0" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Water Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Move 1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    expect(call.choice.picks.map((pick) => pick.uid)).toEqual([onBench]); // source B's, not A's
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("D226 — with `anySource` there is NO source stage, and the picks may SPAN hosts", () => {
    // 🛑 THE READ SITE THAT MAKES N's PLAN ANSWERABLE. The source stage is not
    // decoration: it FILTERS the Energy list down to one host, so a dialog that
    // kept it would leave the card's whole point — one Energy off each of two
    // benched bodies — unreachable from the UI while the engine accepted it. The
    // last line is the one that ties the two halves together: the answer this
    // dialog builds is APPLIED to the real state.
    let state = p1Turn2(12, { p1: NS_PLAN_DECK, p2: NS_PLAN_DECK });
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-basic-2"); // index 0
    state = benchFromDeck(state, "p1", "fix-basic-2"); // index 1
    state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
    state = attachBenchFromDeck(state, "p1", 1, "fix-water-energy", 1);
    state = handFromDeck(state, "p1", "fix-nsplan", 1);
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-nsplan"),
    }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const fire = state.players.p1.bench[0]?.energy[0];
    const water = state.players.p1.bench[1]?.energy[0];

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    // No stage A at all — not even the auto-selected one a single-host board gets.
    expect(screen.queryByText("Choose which Pokémon to move Energy from.")).toBeNull();
    // Every offered Energy is listed at once, each naming the body it sits on
    // (nothing else on screen implies it once the stage is gone). Two IDENTICALLY
    // named hosts, so the rows are told apart by their Energy — which is the case
    // a host-less label would silently collapse.
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy — fix-basic-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Water Energy — fix-basic-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Move 2" }));

    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    expect(call.choice.picks.map((pick) => pick.uid)).toEqual([fire, water]);
    // D442 — EVERY pick names the same destination, which is what a coupled
    // (`anyDest`-less) prompt's answer means and what `validateChoice` re-checks.
    expect(call.choice.picks.map((pick) => pick.dest.spot)).toEqual([
      { spot: "active" },
      { spot: "active" },
    ]);
    expect(applyAction(state, call).ok).toBe(true);
  });
});

describe("effect:choose — the attach-cards dialog (attachFromTop)", () => {
  const attachDecks = { p1: ATTACH_FROM_TOP_DECK, p2: ATTACH_FROM_TOP_DECK };

  /** Electric Generator parked: two benched {L} bodies (the only legal targets —
      the Active is Colorless AND the card prints "Benched") and `candidates`
      Basic {L} Energy seeded on top of the deck. */
  function parkedAttach(seed: number, candidates: number): GameState {
    let state = p1Turn2(seed, attachDecks);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-lightning-1"); // Bench 1
    state = benchFromDeck(state, "p1", "fix-lightning-1"); // Bench 2
    state = handFromDeck(state, "p1", "sv01-170", 1);
    // Fill the rest of the top 5 with non-candidates, spread over TWO ids so no
    // single print has to survive the setup deal (deepest layer first).
    const pad = 5 - candidates;
    state = toDeckTop(state, "p1", "fix-item", Math.max(0, pad - 2));
    state = toDeckTop(state, "p1", "fix-fire-energy", Math.min(2, pad));
    state = toDeckTop(state, "p1", "fix-lightning-energy", candidates);
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-170"),
    }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return state;
  }

  /** The candidate rows — two prints of one Energy, so they share a NAME and are
      told apart only by position (which is the honest situation: they are two
      physical cards off the deck top). */
  const cardRows = () => screen.getAllByRole("button", { name: /Lightning Energy/ });

  it("pairs each card with its OWN destination", () => {
    // The shape that makes this dialog different from every sibling: the answer
    // is a MAP. A dialog that collected one shared destination would pass a
    // single-card test and quietly put both Energy on the same Pokémon here.
    const state = parkedAttach(1, 2);
    const [first, second] = state.players.p1.deck;
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(screen.getByRole("dialog", { name: "Attach cards" })).toBeTruthy();
    // No card is waiting for a destination yet, so no target list is mounted.
    expect(screen.queryByRole("button", { name: "fix-lightning-1 · Bench 2" })).toBeNull();

    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 2" }));
    // The target list closes again — the loop is back to "pick a card".
    expect(screen.queryByRole("button", { name: "fix-lightning-1 · Bench 2" })).toBeNull();
    fireEvent.click(cardRows()[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Attach 2" }));

    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "attachCards") {
      throw new Error("expected an attachCards resolveEffect");
    }
    expect(call.choice.assignments).toEqual([
      { uid: first, to: { seat: "p1", spot: { spot: "bench", index: 1 } } },
      { uid: second, to: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    ]);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("clicking an assigned card takes it back", () => {
    // The only undo: a parked decision cannot be dismissed, so a misplaced attach
    // has to be reversible in the dialog or the player is stuck with it.
    const state = parkedAttach(2, 2);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 1" }));
    expect(screen.getByRole("button", { name: "Attach 1" })).toBeTruthy();
    // Its row now names its destination — WITH the spot, since two benched
    // Pokémon share the name and the readback is the only confirmation of which
    // one was chosen. Asserted on the visible text as well as the accessible
    // name, or a dialog that rendered empty buttons would pass this suite.
    expect(screen.getByText("→ fix-lightning-1 · Bench 1")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Lightning Energy → fix-lightning-1 · Bench 1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Attach none" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "attachCards") {
      throw new Error("expected an attachCards resolveEffect");
    }
    expect(call.choice.assignments).toEqual([]);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("refuses a further card at the printed cap rather than silently ignoring it", () => {
    // Three candidates, "up to 2": the third row must say it is closed off (the
    // DiscardEnergyDialog rule) — and clicking it must not open a target list,
    // which would let the player build an answer the engine then rejects.
    const state = parkedAttach(3, 3);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(cardRows()).toHaveLength(3);
    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 1" }));
    fireEvent.click(cardRows()[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 2" }));

    const third = cardRows()[2] as HTMLElement;
    expect(third.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(third);
    expect(screen.queryByRole("button", { name: "fix-lightning-1 · Bench 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Attach 2" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "attachCards") {
      throw new Error("expected an attachCards resolveEffect");
    }
    expect(call.choice.assignments).toHaveLength(2);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("announces the count and the pending card, and says what to do at the cap", () => {
    // The <output> live region is the only thing that announces the running count
    // (aria-pressed is spoken for the focused row alone) and the only thing that
    // announces the target list appearing. At the cap it must not tell the player
    // to "pick a card" — that is precisely what a click then refuses.
    const state = parkedAttach(4, 2);
    renderHud(state, vi.fn());
    expect(screen.getByText("Attaching 0/2. Pick a card, then where it goes.")).toBeTruthy();
    fireEvent.click(cardRows()[0] as HTMLElement);
    expect(screen.getByText("Attaching 0/2. Where does Lightning Energy go?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 1" }));
    fireEvent.click(cardRows()[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 2" }));
    expect(screen.getByText("Attaching 2/2. Tap an attached card to move it.")).toBeTruthy();
    // The prompt's own sentence is rendered, not a hardcoded heading.
    expect(
      screen.getByRole("heading", {
        name:
          state.phase.kind === "effect:choose" && state.phase.prompt.kind === "attachCards"
            ? state.phase.prompt.note
            : "",
      }),
    ).toBeTruthy();
  });

  it("marks a card WAITING for a destination as current, not as pressed", () => {
    // Confirm dispatches `assignments`, which does not hold the pending card — so
    // announcing it `aria-pressed` would promise an attach that never happens.
    // The two states must be distinguishable to AT, not just to the eye.
    const state = parkedAttach(5, 2);
    renderHud(state, vi.fn());
    fireEvent.click(cardRows()[0] as HTMLElement);
    const pendingRow = cardRows()[0] as HTMLElement;
    expect(pendingRow.getAttribute("aria-pressed")).toBe("false");
    expect(pendingRow.getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 1" }));
    const assignedRow = screen.getByRole("button", {
      name: "Lightning Energy → fix-lightning-1 · Bench 1",
    });
    expect(assignedRow.getAttribute("aria-pressed")).toBe("true");
    expect(assignedRow.getAttribute("aria-current")).toBeNull();
  });

  it("releasing one card leaves another card's pending pick alone", () => {
    const state = parkedAttach(6, 2);
    renderHud(state, vi.fn());
    fireEvent.click(cardRows()[0] as HTMLElement); // card A…
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 1" })); // …assigned
    fireEvent.click(cardRows()[1] as HTMLElement); // card B — pending
    // Release A. B is a different decision and must survive, target list included.
    fireEvent.click(
      screen.getByRole("button", { name: "Lightning Energy → fix-lightning-1 · Bench 1" }),
    );
    expect(screen.getByText("Attaching 0/2. Where does Lightning Energy go?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "fix-lightning-1 · Bench 2" })).toBeTruthy();
  });

  it("a SECOND park in the same turn starts empty (the prompt key remounts it)", () => {
    // The dialog's picks are local state keyed on the prompt. If that key ever
    // stopped discriminating, a stale uid would render no row (so it could not be
    // released) while every dispatch — "Attach none" included — was rejected as
    // not-offered, and the phase would never change: an unescapable dialog. This
    // drives two real parks through one mounted GameHud.
    const first = parkedAttach(7, 2);
    const dispatch = vi.fn();
    const { rerender } = render(
      <GameHud
        game={first}
        projection={projectGameState(first, "p1")}
        viewerSeat="p1"
        names={NAMES}
        dispatch={dispatch}
        onPlayAgain={() => {}}
      />,
    );
    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "fix-lightning-1 · Bench 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Attach 1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;

    // Resolve it for real, then play the SECOND Electric Generator.
    let next = mustApply(first, call).state;
    next = handFromDeck(next, "p1", "sv01-170", 1);
    next = toDeckTop(next, "p1", "fix-fire-energy", 3);
    next = toDeckTop(next, "p1", "fix-lightning-energy", 2);
    next = mustApply(next, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(next, "p1", "sv01-170"),
    }).state;
    if (next.phase.kind !== "effect:choose") throw new Error("expected a second park");

    rerender(
      <GameHud
        game={next}
        projection={projectGameState(next, "p1")}
        viewerSeat="p1"
        names={NAMES}
        dispatch={dispatch}
        onPlayAgain={() => {}}
      />,
    );
    // A fresh decision: nothing carried over from the first look.
    expect(screen.getByRole("button", { name: "Attach none" })).toBeTruthy();
    expect(screen.queryByText(/→ fix-lightning-1/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Attach none" }));
    const second = dispatch.mock.calls[1]?.[0] as GameAction;
    expect(applyAction(next, second).ok).toBe(true);
  });
});

describe("TurnPanel — special energy payability (§6.4)", () => {
  const both = { p1: SPECIAL_ENERGY_DECK, p2: SPECIAL_ENERGY_DECK };

  /** fix-attacker's Flame is a typed cost ([Fire][Colorless], attack index 1);
      Bite is [Colorless] (index 0). The HUD reads payability through the same
      providedEnergy the engine checks — a Luminous wildcard should ENABLE Flame. */
  function attackButton(name: string): HTMLButtonElement {
    const button = screen.getByText(name).closest("button");
    if (button === null) throw new Error(`no ${name} attack button`);
    return button as HTMLButtonElement;
  }

  it("a Luminous wildcard enables a typed attack in the HUD (lockstep with the engine)", () => {
    let state = p1Turn2(1, both);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous → the Fire
    state = attachFromDeck(state, "p1", "fix-energy", 1); // Colorless → the [C]
    renderHud(state, vi.fn());
    expect(attackButton("Flame").disabled).toBe(false);
  });

  it("disables the typed attack when Luminous is demoted by another Special Energy", () => {
    let state = p1Turn2(2, both);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous
    state = attachFromDeck(state, "p1", "sv02-190", 1); // Jet — demotes Luminous to {C}
    renderHud(state, vi.fn());
    // Now [Colorless, Colorless]: Flame ([Fire][C]) is unpayable...
    expect(attackButton("Flame").disabled).toBe(true);
    // ...but Bite ([C]) is still enabled.
    expect(attackButton("Bite").disabled).toBe(false);
  });
});

describe("effect:choose — an on-KO trigger parks the KO'd, NON-turn player (M4 slice 9)", () => {
  it("surfaces the on-KO search to the KO'd player (P2) and dispatches resolveEffect for them", () => {
    // P1 (turn 2) Knocks Out P2's fix-onko Active; after P1 takes the prize, the
    // fix-onko's on-KO Ability parks on P2's decision — mid-P1's-turn. The HUD
    // renders for the WAITING player (P2), not the turn owner.
    let state = p1Turn2(4, { p1: ONKO_DECK, p2: ONKO_DECK });
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1); // pays Bite [C]
    state = setActiveFromDeck(state, "p2", "fix-onko");
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    state = mustApply(state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(state.phase.seat).toBe("p2");

    // Render for P2 (the KO'd player who owes the decision), not P1.
    const dispatch = vi.fn();
    render(
      <GameHud
        game={state}
        projection={projectGameState(state, "p2")}
        viewerSeat="p2"
        names={NAMES}
        dispatch={dispatch}
        onPlayAgain={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Choose cards" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take none" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [] },
    });
  });
});

describe("TurnPanel — a printed play gate greys the button out (M5 board conditions)", () => {
  it("disables Fighting Au Lait until P1 is behind on Prizes, then enables it", () => {
    // The engine rejects the play with PLAY_CONDITION_NOT_MET while the prize
    // counts are level, so the HUD must not offer a button that can only fail —
    // it evaluates the SAME BoardCondition (public state, safe client-side).
    let state = p1Turn2(1, { p1: BOARD_CONDITION_DECK, p2: BOARD_CONDITION_DECK });
    state = handFromDeck(state, "p1", "sv02-181", 1); // Fighting Au Lait
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    const button = screen.getByRole("button", { name: "sv02-181" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();

    // P2 takes prizes → P1 is now behind, and the same card becomes playable.
    cleanup();
    const behind = setPrizes(state, "p2", 3);
    const uid = handUid(behind, "p1", "sv02-181");
    renderHud(behind, dispatch);
    const enabled = screen.getByRole("button", { name: "sv02-181" }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    expect(dispatch).toHaveBeenCalledWith({ type: "playTrainer", seat: "p1", uid });
    // "the button dispatched" is only half the claim — the engine must actually
    // TAKE what an enabled button sends, or the grey-out is calibrated wrong.
    expect(applyAction(behind, { type: "playTrainer", seat: "p1", uid }).ok).toBe(true);
  });

  it("explains the greyed row instead of silently disabling it", () => {
    // Disabling the button removes the reject pill the player used to get on
    // click, so the printed rule has to survive somewhere reachable: the row's
    // tooltip and an sr-only line (a disabled button is out of the tab order).
    let state = p1Turn2(1, { p1: BOARD_CONDITION_DECK, p2: BOARD_CONDITION_DECK });
    state = handFromDeck(state, "p1", "sv02-181", 1);
    renderHud(state, vi.fn());
    const reason = "Only if you have more Prize cards remaining than your opponent";
    // Scoped to Fighting Au Lait's own row — the fixture gated Supporter in this
    // deck greys out for the same reason, which is itself the right behaviour.
    const button = screen.getByRole("button", { name: "sv02-181" });
    const row = button.closest("li");
    expect(row?.getAttribute("title")).toBe(reason);
    expect(row?.textContent).toContain(reason);
    // …and the reason stays OUT of the button's accessible name, which the other
    // tests (and a screen reader announcing the control) match on exactly.
    expect(button.textContent).toBe("sv02-181");
  });

  it("greys Ultra Ball out when its printed hand COST cannot be paid (§7.5)", () => {
    // The SECOND producer of PLAY_CONDITION_NOT_MET. playTrainer rejects an
    // unpayable cost exactly as it rejects an unmet board condition, so the same
    // doctrine applies — and this is the row that is dead most often: a hand of
    // [Ultra Ball, one other card] is the ordinary late-game state.
    let state = p1Turn2(1, { p1: HAND_COST_DECK, p2: HAND_COST_DECK });
    state = withHand(state, ["sv01-196", "fix-item"]); // 1 OTHER card — one short
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    const button = screen.getByRole("button", { name: "sv01-196" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();
    // The printed rule survives where the reject pill used to be — and it says
    // "other", the word that makes the count correct.
    const reason = "Only if you discard 2 other cards from your hand";
    const row = button.closest("li");
    expect(row?.getAttribute("title")).toBe(reason);
    expect(row?.textContent).toContain(reason);

    // One more card in hand → payable, enabled, and the engine TAKES it (the
    // grey-out is calibrated against the engine, not guessed).
    cleanup();
    const payable = withHand(state, ["sv01-196", "fix-item", "fix-grass-energy"]);
    const uid = handUid(payable, "p1", "sv01-196");
    renderHud(payable, dispatch);
    const enabled = screen.getByRole("button", { name: "sv01-196" }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    expect(enabled.closest("li")?.getAttribute("title")).toBeNull();
    expect(applyAction(payable, { type: "playTrainer", seat: "p1", uid }).ok).toBe(true);
  });

  it("counts the played card OUT of its own cost — the printed 'other'", () => {
    // Ultra Ball alone in hand is hand.length === 1, and two copies is
    // hand.length === 2: a gate reading the raw hand size would call the second
    // one playable. Both must be refused; three copies is the first payable one.
    const base = p1Turn2(1, { p1: HAND_COST_DECK, p2: HAND_COST_DECK });
    for (const hand of [["sv01-196"], ["sv01-196", "sv01-196"]]) {
      cleanup();
      renderHud(withHand(base, hand), vi.fn());
      expect(
        (screen.getAllByRole("button", { name: "sv01-196" })[0] as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    cleanup();
    // Three copies: two of them pay for the third, so it is legal — the "other"
    // exclusion is about the PLAYED card, not about the card's name.
    renderHud(withHand(base, ["sv01-196", "sv01-196", "sv01-196"]), vi.fn());
    expect(
      (screen.getAllByRole("button", { name: "sv01-196" })[0] as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("leaves an UNGATED Trainer alone (Falkner has no playableIf)", () => {
    let state = p1Turn2(1, { p1: BOARD_CONDITION_DECK, p2: BOARD_CONDITION_DECK });
    state = handFromDeck(state, "p1", "sv02-180", 1); // Falkner — no Stadium in play
    renderHud(state, vi.fn());
    // Falkner's Stadium condition gates a DRAW inside its program, not the play
    // itself: the card is always legal and the button stays live.
    expect((screen.getByRole("button", { name: "sv02-180" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("effect:choose — the discard-energy dialog (discardEnergy, M5)", () => {
  const hammerDecks = { p1: DISCARD_ENERGY_DECK, p2: DISCARD_ENERGY_DECK };

  it("picks one Energy off the opponent's board and dispatches it (scope 'one')", () => {
    // fix-hammer is the opponentChosen arm without Crushing Hammer's coin gate.
    // Two Energy on the opponent's Active makes WHICH a real question, so it parks.
    let state = p1Turn2(1, hammerDecks);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = handFromDeck(state, "p1", "fix-hammer", 1);
    const uid = handUid(state, "p1", "fix-hammer");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(screen.getByRole("dialog", { name: "Discard Energy" })).toBeTruthy();
    // MANDATORY — there is no "Discard none", and Confirm is dead until a pick.
    expect(screen.queryByRole("button", { name: /none/i })).toBeNull();
    expect((screen.getByRole("button", { name: "Discard 0/1" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 1/1" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    expect(call.choice.uids).toHaveLength(1);
    // Round-trips through the engine — the HUD's answer is one the engine accepts.
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("Giacomo's sweep asks for one per Pokémon, grouped by host (scope 'each')", () => {
    let state = p1Turn2(7, hammerDecks);
    // Distinctly-named hosts, so the two group headers can be told apart.
    state = setActiveFromDeck(state, "p2", "fix-basic-1");
    state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-special", 1); // Active — forced
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special-2", 1); // bench 0 — a choice
    state = handFromDeck(state, "p1", "sv02-182", 1);
    const uid = handUid(state, "p1", "sv02-182");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    // Two groups, three candidates; the confirm counts against the GROUPS.
    // The legend carries the SPOT too, so two same-named hosts stay distinct.
    // Every group also names its SIDE — the dialog serves the opponent's board
    // (here) and the viewer's own Active (the self-discard attack cost).
    expect(screen.getByRole("group", { name: "fix-basic-1 · Active · opponent" })).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "fix-basic-2 · Bench 1 · opponent" }),
    ).toBeTruthy();
    // The Active's group holds ONE candidate, so it is not a question — it comes
    // PRE-ANSWERED, leaving only the two-Energy bench Pokémon to decide. Without
    // that seeding the player would have to re-click a forced pick before Confirm
    // could ever light up.
    expect((screen.getByRole("button", { name: "Discard 1/2" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const forced = screen.getAllByRole("button", { name: "fix-special" })[0] as HTMLElement;
    expect(forced.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "fix-special-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 2/2" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    expect(call.choice.uids).toHaveLength(2);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("a second pick within one Pokémon REPLACES the first (never two off one host)", () => {
    let state = p1Turn2(8, hammerDecks);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    state = handFromDeck(state, "p1", "sv02-182", 1);
    const uid = handUid(state, "p1", "sv02-182");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    fireEvent.click(screen.getByRole("button", { name: "fix-special-2" }));
    // Still 1 of 1 — the second click swapped the pick rather than adding to it,
    // which is the coupling the engine would otherwise reject on the wire.
    fireEvent.click(screen.getByRole("button", { name: "Discard 1/1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    expect(call.choice.uids).toHaveLength(1);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("scope 'one': picking on a SECOND Pokémon clears the first group's pick", () => {
    // The other half of the "one" rule — the previous test swaps WITHIN a group,
    // this one ACROSS groups. Two uids would be two hosts, which the engine
    // rejects ("discard exactly 1 Energy"), so the clear has to happen in the HUD.
    let state = p1Turn2(1, hammerDecks);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1);
    state = handFromDeck(state, "p1", "fix-hammer", 1);
    const uid = handUid(state, "p1", "fix-hammer");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const benchUid = state.players.p2.bench[0]?.energy[0] as string;

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    // Two hosts → two groups, each programmatically labelled by its Pokémon:
    // every row reads "fix-…", so the header is the only disambiguator and it
    // has to be exposed, not just painted above the list.
    const bench = screen.getByRole("group", { name: "fix-basic-2 · Bench 1 · opponent" });
    expect(bench.querySelectorAll("button")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "fix-energy" }));
    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    // Still one pick — the first host's Energy was dropped, not kept alongside.
    fireEvent.click(screen.getByRole("button", { name: "Discard 1/1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    expect(call.choice.uids).toEqual([benchUid]);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("clicking the picked Energy again clears it — Confirm goes dead, but re-picking works", () => {
    // The decision is MANDATORY and Escape is swallowed, so a deselect that could
    // not be undone would be a soft-lock: pin that the dialog always has a way out.
    let state = p1Turn2(1, hammerDecks);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = handFromDeck(state, "p1", "fix-hammer", 1);
    const uid = handUid(state, "p1", "fix-hammer");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;

    renderHud(state, vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    expect((screen.getByRole("button", { name: "Discard 0/1" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "fix-energy" }));
    expect((screen.getByRole("button", { name: "Discard 1/1" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("Mawile's on-bench Ability reaches the SAME dialog (ability origin, not a Trainer)", () => {
    // discardEnergy's third arm (`opponentActive`) and its only non-Trainer
    // origin: the dialog must mount off a bench-play trigger too.
    let state = p1Turn2(3, hammerDecks);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    state = handFromDeck(state, "p1", "sv03-143", 1);
    const uid = handUid(state, "p1", "sv03-143");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(screen.getByRole("dialog", { name: "Discard Energy" })).toBeTruthy();
    expect(
      screen.getByText("Discard a Special Energy from your opponent's Active Pokémon."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "fix-special-2" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 1/1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("an ATTACK's parked effect reaches the same dialog, and the answer ends the turn", () => {
    // The fourth origin (M5): the park comes from an ATTACK, not a card play, so
    // the HUD reaches it through the attackEpilogue stage rather than a turn
    // action. The dialog is unchanged — the prompt is what carries the origin.
    let state = p1Turn2(4, { p1: ATTACK_PARK_DECK, p2: ATTACK_PARK_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-028"); // Paldean Tauros
    state = setActiveFromDeck(state, "p2", "fix-bigbody"); // survives, so no KO tail
    state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(screen.getByRole("dialog", { name: "Discard Energy" })).toBeTruthy();
    // The card's own printed sentence, about the viewer's OWN Pokémon.
    expect(screen.getByText("Discard an Energy from this Pokémon.")).toBeTruthy();
    // Two attached prints → two candidates, not the three cards on the board —
    // asserted through the group, which pins the host legend at the same time.
    const group = screen.getByRole("group", { name: "Paldean Tauros · Active" });
    expect(group.querySelectorAll("button")).toHaveLength(2);
    // No `opponent` marker: this host is the viewer's own Active.
    expect(screen.queryByRole("group", { name: /opponent/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "fix-energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 1/1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    // The engine accepts it AND the attack finishes — the turn passes to p2.
    const applied = applyAction(state, call);
    if (!applied.ok) throw new Error("expected the engine to accept the HUD's answer");
    expect(applied.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("scope 'total' with count 2 takes TWO off one Pokémon — the multi-pick the 'each' rule forbade", () => {
    // Slither Wing's "Discard 2 Energy from this Pokémon" is the first prompt
    // whose answer is two Energy off the SAME host, which is exactly what the
    // one-pick-per-group rule used to prevent. Three distinguishable Energy
    // attached ({F} ×2 + a filler), so choosing 2 of 3 is a real question.
    let state = p1Turn2(6, { p1: ATTACK_DISCARD_DECK, p2: ATTACK_DISCARD_DECK });
    state = setActiveFromDeck(state, "p1", "sv06.5-026"); // Slither Wing
    state = setActiveFromDeck(state, "p2", "fix-bigbody"); // survives, so no KO tail
    state = attachFromDeck(state, "p1", "fix-fighting-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    // ⚠️ INDEX 1 — Smashing Wing's PRINTED number, behind "Iron Smasher" (D173).
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(screen.getByText("Discard 2 Energy from this Pokémon.")).toBeTruthy();
    // The count is spelled out, not left to the Confirm button's fraction.
    expect(screen.getByText("Pick 2 Energy to discard (0/2).")).toBeTruthy();
    // Both interchangeable {F} copies are offered: the pick may want two of a
    // class, so collapsing them to one row would make "discard both" unanswerable.
    const group = screen.getByRole("group", { name: "Slither Wing · Active" });
    expect(group.querySelectorAll("button")).toHaveLength(3);

    const attached = [...(state.players.p1.active?.energy ?? [])];
    const fighting = screen.getAllByRole("button", { name: "Fighting Energy" });
    fireEvent.click(fighting[0] as HTMLElement);
    expect(
      (screen.getByRole("button", { name: "Discard 1/2" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(fighting[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Discard 2/2" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    // WHICH two, not just how many: a handler recording the wrong row would still
    // round-trip through the engine, since any offered pair is a legal answer.
    expect(call.choice.uids).toEqual([attached[0], attached[1]]);
    const applied = applyAction(state, call);
    if (!applied.ok) throw new Error("expected the engine to accept the HUD's answer");
    expect(applied.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("at the cap a further pick is REFUSED, and deselecting one keeps the other", () => {
    // Two rules the count-1 dialog could never express, so both are new here:
    // (1) no silent eviction — a click at 2/2 changes nothing, rather than
    // un-pressing a row the user is not looking at (and which may be identical by
    // name to its neighbour); (2) deselect removes ONE pick, not the whole answer.
    // The decision is MANDATORY and Escape is swallowed, so a deselect that
    // over-cleared would be a soft-lock risk, and one that under-cleared a trap.
    let state = p1Turn2(7, { p1: ATTACK_DISCARD_DECK, p2: ATTACK_DISCARD_DECK });
    state = setActiveFromDeck(state, "p1", "sv06.5-026");
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = attachFromDeck(state, "p1", "fix-fighting-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    // ⚠️ INDEX 1 — Smashing Wing's PRINTED number (D173).
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const attached = [...(state.players.p1.active?.energy ?? [])];

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    const fighting = screen.getAllByRole("button", { name: "Fighting Energy" });
    // Pick out of BOARD ORDER, so "refused" can't be confused with any rule that
    // silently reshuffles the answer toward the board's own order.
    fireEvent.click(fighting[1] as HTMLElement);
    fireEvent.click(fighting[0] as HTMLElement);
    // At the cap the third row SAYS it is closed off — a silently inert row is
    // the one state the <output> live region cannot announce, since nothing
    // changes. It stays focusable (aria-disabled, not `disabled`): the rows are
    // how a keyboard user reads the offer.
    const spare = screen.getByRole("button", { name: "fix-energy" }) as HTMLButtonElement;
    expect(spare.getAttribute("aria-disabled")).toBe("true");
    expect(spare.disabled).toBe(false);
    fireEvent.click(spare);
    expect(spare.getAttribute("aria-pressed")).toBe("false");
    // Deselect ONE — the other survives, so Confirm goes to 1/2 and not 0/2.
    fireEvent.click(fighting[1] as HTMLElement);
    expect(
      (screen.getByRole("button", { name: "Discard 1/2" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // …and re-picking is always possible: there is no way to strand the dialog.
    fireEvent.click(screen.getByRole("button", { name: "fix-energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 2/2" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    expect(call.choice.uids).toEqual([attached[0], attached[2]]);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("an ATTACK's opponent-side twin reaches the dialog with the `opponent` legend", () => {
    // The other new origin: the park is about the OPPONENT's board and comes from
    // an attack, so the host legend must carry the side marker while the answer
    // still drains the attack epilogue and hands the turn over.
    let state = p1Turn2(1, { p1: ATTACK_DISCARD_DECK, p2: ATTACK_DISCARD_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-072"); // Pincurchin
    state = setActiveFromDeck(state, "p2", "fix-bigbody"); // survives the 70
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 3);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(
      screen.getByText("Discard an Energy from your opponent's Active Pokémon."),
    ).toBeTruthy();
    const group = screen.getByRole("group", { name: "fix-bigbody · Active · opponent" });
    expect(group.querySelectorAll("button")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "fix-special" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 1/1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    const applied = applyAction(state, call);
    if (!applied.ok) throw new Error("expected the engine to accept the HUD's answer");
    expect(applied.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the NON-deciding seat is shown no dialog, even though its projection carries the prompt", () => {
    // D17 rule one, and it is load-bearing rather than cosmetic here: projection
    // hands `pendingDecision` — prompt and all — to BOTH viewers (deliberate, and
    // pinned by its own tests), so the `acting` gate is the only thing keeping the
    // non-decider from seeing and clicking someone else's decision.
    let state = p1Turn2(8, { p1: ATTACK_PARK_DECK, p2: ATTACK_PARK_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-028");
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const projection = projectGameState(state, "p2");
    expect(projection.waitingOn).toBe("opponent");
    expect(projection.pendingDecision?.kind).toBe("effectChoose"); // it IS carried…

    const dispatch = vi.fn();
    render(
      <GameHud
        game={state}
        projection={projection}
        viewerSeat="p2"
        names={NAMES}
        dispatch={dispatch}
        onPlayAgain={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull(); // …and never rendered
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("the providesEnergy filter (M5) — the typed discard and Fire Off", () => {
  const decks = { p1: PROVIDES_ENERGY_DECK, p2: PROVIDES_ENERGY_DECK };

  it("the typed discard dialog names the TYPE, and offers only Energy that provides it", () => {
    // Kilowattrel's "Discard a {L} Energy". The heading reads the full type name
    // rather than the printed brace code, because the rows below it are card
    // NAMES — heading and offer must speak one vocabulary. And the offer is the
    // filter made visible: the Luminous is there (a wildcard PROVIDES {L}), the
    // Fire Energy is not, though all three sit on the same Pokémon.
    let state = p1Turn2(40, decks);
    state = setActiveFromDeck(state, "p1", "sv01-079"); // Kilowattrel
    state = setActiveFromDeck(state, "p2", "fix-titan"); // survives, so no KO tail
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous — the wildcard
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // never a candidate
    // ⚠️ INDEX 1 — Thunder Blast's PRINTED number, behind "Skill Dive" (D173).
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(screen.getByText("Discard a Lightning Energy from this Pokémon.")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Kilowattrel · Active" });
    expect(group.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Luminous Energy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fire Energy" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Luminous Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 1/1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy resolveEffect");
    }
    const applied = applyAction(state, call);
    if (!applied.ok) throw new Error("expected the engine to accept the HUD's answer");
    expect(applied.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("Fire Off is a TurnPanel button, and its move dialog pre-selects the sole destination", () => {
    // The second consumer, end to end through the HUD. Two things are new here:
    // the Ability is offered from the BENCH (it is not activeOnly), and the
    // benchToActive route leaves exactly ONE destination — which the dialog
    // treats as already chosen, so "Move 1" enables on the Energy pick alone.
    // Without that, every use of an as-often-as-you-like Ability would cost a
    // redundant click on the only legal target.
    let state = p1Turn2(41, decks);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = setActiveFromDeck(state, "p2", "fix-titan");
    state = benchFromDeck(state, "p1", "sv01-041"); // Armarouge, benched
    const index = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", index, "fix-fire-energy", 1);

    const dispatch = vi.fn();
    renderHud(state, dispatch);
    // The row names WHERE the Pokémon is, not just which card it is: two copies
    // of one card carry the same Ability name, and DOM order is not something a
    // screen reader can read off a button (Skwovet ×2 is the first such board).
    fireEvent.click(screen.getByRole("button", { name: `Fire Off · Armarouge (Bench ${index + 1})` }));
    const use = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(use).toEqual({
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index },
      abilityName: "Fire Off",
    });

    const parked = applyAction(state, use);
    if (!parked.ok) throw new Error("expected Fire Off to park");
    cleanup();
    const dispatch2 = vi.fn();
    renderHud(parked.state, dispatch2);
    expect(
      screen.getByText("Move a Fire Energy from 1 of your Benched Pokémon to your Active Pokémon."),
    ).toBeTruthy();
    // The destination row renders as already selected — the player can see WHERE
    // it goes, without having to confirm the only option.
    expect(
      screen.getByRole("button", { name: "fix-basic-1" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy" }));
    fireEvent.click(screen.getByRole("button", { name: "Move 1" }));
    const call = dispatch2.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    expect(call.choice.picks[0]?.dest.spot).toEqual({ spot: "active" });
    expect(applyAction(parked.state, call).ok).toBe(true);
  });
});

describe("MoveEnergySpreadDialog — the printed 'in any way you like' (D442)", () => {
  const SPREAD_CYCLONE = 63; // fix-trainerops — Kilowattrel's sentence
  const FREE_FLOW = 64; // fix-trainerops — the declinable free-route spread

  /** `fix-trainerops` Active with two Colorless Energy and a Bench of two
      `fix-basic-1`, then the attack. The two benched bodies are IDENTICALLY named,
      which is the board the SPOT readback exists for — and the one a dialog that
      labelled destinations by name alone would silently collapse. */
  function parkedSpread(index: number, ownBench = 2): GameState {
    let state = p1Turn2(0x5c21, { p1: SPREAD_ENERGY_MOVE_DECK, p2: SPREAD_ENERGY_MOVE_DECK });
    state = setActiveFromDeck(state, "p1", "fix-trainerops");
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = mustApply(state, { type: "attack", seat: "p1", index }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return state;
  }

  it("🛑 assigns each Energy its OWN destination and dispatches the MAP", () => {
    // THE READ SITE THAT MAKES THESE THREE PRINTINGS ANSWERABLE (D226's rule for
    // `anySource`, one endpoint over): the engine accepts a spread, so a dialog that
    // kept the single-destination wizard would leave the card's whole point
    // unreachable from the UI while the server accepted it. The last line ties the
    // halves together — the answer this dialog builds is APPLIED to the real state.
    const state = parkedSpread(SPREAD_CYCLONE);
    const [first, second] = state.players.p1.active?.energy as [string, string];
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    // No source stage and no shared "Move to:" list — the destination list mounts
    // only while ONE Energy is waiting for it.
    expect(screen.queryByText("Choose which Pokémon to move Energy from.")).toBeNull();
    expect(screen.queryByText("Move to:")).toBeNull();

    // Two IDENTICALLY LABELLED Energy rows — the same card on the same host — so the
    // rows are addressed by INDEX. That is the shape the map answer is for: they are
    // interchangeable as cards and distinguishable only by where they end up.
    const energyRows = () =>
      screen.getAllByRole("button", { name: "fix-energy on fix-trainerops · Active" });
    expect(energyRows()).toHaveLength(2);
    fireEvent.click(energyRows()[0] as Element);
    expect(screen.getByText("Move to:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "fix-basic-1 · Bench 1" }));
    // The assigned row's accessible NAME now carries its destination ("→ fix-basic-1
    // · Bench 1"), so the unassigned one is what `energyRows()` still returns —
    // which is the readback the dialog exists to give and is asserted by using it.
    expect(energyRows()).toHaveLength(1);
    expect(
      screen.getByRole("button", {
        name: "fix-energy on fix-trainerops · Active → fix-basic-1 · Bench 1",
      }),
    ).toBeTruthy();
    fireEvent.click(energyRows()[0] as Element);
    fireEvent.click(screen.getByRole("button", { name: "fix-basic-1 · Bench 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Move 2" }));

    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    expect(call.choice.picks.map((pick) => pick.uid).sort()).toEqual([first, second].sort());
    // 🛑 TWO DIFFERENT DESTINATIONS. A dialog that kept one shared `dest` dispatches
    // the same uids and the same count, so the destinations are the only observable.
    expect(call.choice.picks.map((pick) => pick.dest.spot)).toEqual([
      { spot: "bench", index: 0 },
      { spot: "bench", index: 1 },
    ]);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("withholds 'Move none' under the printed floor, and offers it without one", () => {
    // D441's floor on the spread dialog, and its CONTROL on the same screen shape:
    // Kilowattrel's "Move all" is mandatory, the free-route "You may move any
    // amount" is not, and the button is the only thing that differs.
    renderHud(parkedSpread(SPREAD_CYCLONE), vi.fn());
    expect(screen.queryByRole("button", { name: "Move none" })).toBeNull();
    cleanup();
    renderHud(parkedSpread(FREE_FLOW), vi.fn());
    expect(screen.getByRole("button", { name: "Move none" })).toBeTruthy();
  });

  it("a pick's own host is NOT offered as its destination", () => {
    // The printed "other", per pick — `validateChoice` refuses a self-move on every
    // entry, so offering one would be the afford-then-reject D222 named. On the free
    // route the Active is BOTH a source and a destination, which is the only board
    // where the exclusion is visible at all.
    const state = parkedSpread(FREE_FLOW);
    renderHud(state, vi.fn());
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "fix-energy on fix-trainerops · Active",
      })[0] as Element,
    );
    expect(screen.getByRole("button", { name: "fix-basic-1 · Bench 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "fix-trainerops · Active" })).toBeNull();
  });
});

describe("MoveEnergyDialog on the OPPONENT's board (D443)", () => {
  const STATIC_FLICK = 66; // fix-trainerops — "Move an Energy from 1 of your opponent's Pokémon…"
  const SELF_TO_BENCH = 14; // fix-trainerops — D229's own-board sentence, the CONTROL

  /** p1 attacks; the offer is entirely on p2's board. Both of p2's benched bodies
      are `fix-basic-1`, and p1's bench holds one too — which is the whole point:
      in a mirror match the rows are same-named across the table, so the ONLY thing
      that tells a player which board they are picking on is the side marker. */
  function parkedCross(index: number): GameState {
    let state = p1Turn2(0x5c43, { p1: OPPONENT_ENERGY_MOVE_DECK, p2: OPPONENT_ENERGY_MOVE_DECK });
    state = setActiveFromDeck(state, "p1", "fix-trainerops");
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = attachFromDeck(state, "p2", "fix-energy", 2);
    state = attachBenchFromDeck(state, "p2", 0, "fix-energy", 1);
    state = mustApply(state, { type: "attack", seat: "p1", index }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return state;
  }

  it("🛑 marks every row that is not the viewer's, and the answer still applies", () => {
    // D412's SHAPE, AND THE ONE THE ENGINE HALF CANNOT SEE: the board is right, the
    // prompt is right, the wire is right — and the dialog offers `fix-basic-1` twice
    // over two boards with nothing to tell them apart. Every OTHER public-ref dialog
    // in this file's component has carried `ref.seat !== viewerSeat` for a long time;
    // all four moveEnergy dialogs lacked it until D443.
    const state = parkedCross(STATIC_FLICK);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    // ⚠️ THE ACCESSIBLE NAME CONCATENATES WITHOUT A SPACE ("fix-bigbodyopponent"),
    // because the marker is a sibling `<span>` with no text node between it and the
    // name — which is the shipped markup of `ChoosePokemonDialog` and
    // `ChoosePokemonMultiDialog` verbatim, so this dialog matches its siblings
    // rather than inventing a third spelling. Queried by regex so the assertion is
    // about the MARKER being present, not about that spacing.
    // The source stage: p2's Active and their bench 0 both hold movable Energy, so
    // the dialog asks WHICH source first — and both rows are the opponent's.
    expect(screen.getByRole("button", { name: /^fix-bigbody\s*opponent$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^fix-bigbody\s*opponent$/ }));
    // …then the destinations, which are also all theirs.
    fireEvent.click(
      screen.getAllByRole("button", { name: /^fix-basic-1\s*opponent$/ })[0] as Element,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "fix-energy" })[0] as Element);
    fireEvent.click(screen.getByRole("button", { name: "Move 1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "moveEnergy") {
      throw new Error("expected a moveEnergy resolveEffect");
    }
    // The answer the marked rows built is APPLIED to the real state — the half that
    // ties the marker to a legal frame rather than to a string in the DOM.
    expect(call.choice.picks[0]?.dest.seat).toBe("p2");
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("THE CONTROL: the own-board sentence marks nothing", () => {
    // Without this, "the rows say opponent" would pass on a dialog that says it on
    // every row (D424 — a refusal rung owes an admission on the same axis, read the
    // other way round). Same component, same board, same attacker; D229's sentence.
    const state = parkedCross(SELF_TO_BENCH);
    renderHud(state, vi.fn());
    expect(screen.getByRole("button", { name: "fix-basic-1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /opponent/ })).toBeNull();
  });
});
