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
  BOARD_CONDITION_DECK,
  MOVE_ENERGY_DECK,
  ONKO_DECK,
  RARE_CANDY_DECK,
  SNIPE_DECK,
  SPECIAL_ENERGY_DECK,
  STADIUM_TOOL_DECK,
  TRAINER_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
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

    expect(screen.getByRole("dialog", { name: "Choose cards" })).toBeTruthy();
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

describe("effect:choose — the move-energy dialog (moveEnergy)", () => {
  const moveDecks = { p1: MOVE_ENERGY_DECK, p2: MOVE_ENERGY_DECK };

  /** p1's turn with Energy Switch parked: one Basic Energy on the Active (the
      only source, so it auto-selects) and a distinctly-named benched destination. */
  function parkedMove(seed: number): GameState {
    let state = p1Turn2(seed, moveDecks);
    state = benchFromDeck(state, "p1", "fix-basic-2"); // a distinct destination at index 0
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // one Basic Energy on the Active
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
    expect(call.choice.uids).toHaveLength(1);
    expect(call.choice.dest.spot).toEqual({ spot: "bench", index: 0 });
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
    expect(call.choice.uids).toEqual([]);
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
    expect(call.choice.uids).toHaveLength(1);
    // The destination is the benched fix-basic-2 (index 0), not the source Active.
    expect(call.choice.dest.spot).toEqual({ spot: "bench", index: 0 });
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
