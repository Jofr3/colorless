// @vitest-environment jsdom
// M4 slice 2 HUD wiring: the Trainer/Ability controls in TurnPanel and the
// effect:choose dialogs dispatch the right engine actions. Real engine states
// via the fixtures; a dispatch spy captures what the buttons send (the engine
// itself is covered by cardplay.test.ts).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState } from "@luminous/engine";
import {
  ABILITY_DECK,
  RARE_CANDY_DECK,
  SNIPE_DECK,
  SPECIAL_ENERGY_DECK,
  STADIUM_TOOL_DECK,
  TRAINER_DECK,
  attachFromDeck,
  benchFromDeck,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
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

    expect(screen.getByRole("dialog", { name: "Search your deck" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take none" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
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
    fireEvent.click(rows[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Confirm 2" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call.type).toBe("resolveEffect");
    if (call.type === "resolveEffect") {
      expect(call.choice.kind).toBe("pokemonMulti");
      if (call.choice.kind === "pokemonMulti") expect(call.choice.refs).toHaveLength(2);
    }
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
