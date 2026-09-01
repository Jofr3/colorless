// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RedactedGame, RedactedInPlay, RedactedPhase } from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

// The online HUD is driven purely by the redacted wire snapshot (no full engine
// state), so these render it standalone against hand-built RedactedGame views
// and pin that each panel dispatches the right seat-bound action.

// The ko:* dialogs are native <dialog>s that call showModal on mount.
beforeAll(installDomShims);

afterEach(cleanup);

function inPlay(id: string, name: string, extra: Partial<RedactedInPlay> = {}): RedactedInPlay {
  return {
    id,
    cardId: id,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: { damage: 0, hp: 60, conditions: { rotation: "none", poisonDamage: 0, burned: false } },
    attached: { tools: [], energies: [] },
    ...extra,
  };
}

/** A minimal well-formed viewer-relative snapshot; callers override the phase,
    the boards and who is waited on. p1 is "you". */
function game(overrides: {
  phase: RedactedPhase;
  you?: Partial<RedactedGame["board"]["you"]>;
  opponent?: Partial<RedactedGame["board"]["opponent"]>;
  waitingOn?: RedactedGame["waitingOn"];
  turn?: number;
}): RedactedGame {
  const emptySide: RedactedGame["board"]["you"] = {
    hand: [],
    active: null,
    bench: [],
    prizesRemaining: 6,
    deckCount: 53,
    discard: [],
  };
  return {
    seat: "p1",
    turn: overrides.turn ?? 3,
    phase: overrides.phase,
    board: {
      stadium: null,
      you: { ...emptySide, ...overrides.you },
      opponent: { ...emptySide, ...overrides.opponent },
    },
    activePlayer: "you",
    waitingOn: overrides.waitingOn ?? "you",
    outcome: null,
  };
}

/** A turn:action phase with every action list defaulting to empty — callers pass
    only the fields their case exercises (the 3b ability/trainer lists included). */
function turnAction(
  fields: Partial<Extract<RedactedPhase, { kind: "turn:action" }>> = {},
): RedactedPhase {
  return {
    kind: "turn:action",
    attacks: [],
    retreat: null,
    abilities: [],
    trainers: [],
    rareCandy: [],
    stadiumAbility: null,
    ...fields,
  };
}

/** An attached-Energy leaf card (no battle row / attachments). */
function energy(id: string, name: string) {
  return { id, cardId: id, name, category: "Energy" as const, trainerType: null, hasImage: false };
}

/** A revealed prompt-candidate leaf card (chooseCards / attachCards). */
function card(id: string, name: string) {
  return { id, cardId: id, name, category: "Trainer" as const, trainerType: null, hasImage: false };
}

// Wire PokemonRefs (absolute seat) the way the redactor emits them.
const YOU_ACTIVE = { seat: "p1", spot: { spot: "active" } } as const;
const OPP_ACTIVE = { seat: "p2", spot: { spot: "active" } } as const;
const YOU_BENCH0 = { seat: "p1", spot: { spot: "bench", index: 0 } } as const;
const YOU_BENCH1 = { seat: "p1", spot: { spot: "bench", index: 1 } } as const;
const OPP_BENCH0 = { seat: "p2", spot: { spot: "bench", index: 0 } } as const;

describe("OnlineHud — turn:action attack panel", () => {
  const ATTACKS: Extract<RedactedPhase, { kind: "turn:action" }>["attacks"] = [
    { index: 0, name: "Cut", cost: ["Water"], damage: "10", playable: true },
    { index: 1, name: "Big Swing", cost: ["Water", "Water"], damage: "80", playable: false },
  ];

  it("dispatches a seat-bound attack on a playable row and disables an unpayable one", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: turnAction({ attacks: ATTACKS }),
          you: { active: inPlay("sneasel", "Sneasel") },
        })}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cut/ }));
    expect(onAction).toHaveBeenCalledWith({ type: "attack", seat: "p1", index: 0 });

    const unpayable = screen.getByRole<HTMLButtonElement>("button", { name: /Big Swing/ });
    expect(unpayable.disabled).toBe(true);
    onAction.mockClear();
    fireEvent.click(unpayable);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the §4 first-turn note only on turn 1", () => {
    const first = render(
      <OnlineHud
        game={game({
          turn: 1,
          phase: turnAction({ attacks: ATTACKS }),
          you: { active: inPlay("sneasel", "Sneasel") },
        })}
        waitingOn="you"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/first turn/i)).toBeTruthy();
    first.unmount();

    render(
      <OnlineHud
        game={game({
          phase: turnAction({ attacks: ATTACKS }),
          you: { active: inPlay("sneasel", "Sneasel") },
        })}
        waitingOn="you"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByText(/first turn/i)).toBeNull();
  });

  it("renders no panel when it is the opponent's turn", () => {
    const { container } = render(
      <OnlineHud
        game={game({
          phase: turnAction(),
          you: { active: inPlay("sneasel", "Sneasel") },
          waitingOn: "opponent",
        })}
        waitingOn="opponent"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("OnlineHud — turn:action retreat", () => {
  const ENERGY = {
    id: "e1",
    cardId: "water",
    name: "Water Energy",
    category: "Energy" as const,
    trainerType: null,
    hasImage: false,
  };
  const activeWithEnergy = inPlay("sneasel", "Sneasel", {
    attached: { tools: [], energies: [ENERGY] },
  });

  it("opens the retreat dialog and dispatches the picked energy + bench index", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: turnAction({ retreat: { cost: 1, can: true } }),
          you: { active: activeWithEnergy, bench: [inPlay("b", "Bench Sneasel")] },
        })}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    // The panel's Retreat control (labelled with the cost) opens the dialog.
    fireEvent.click(screen.getByRole("button", { name: /Retreat \(1\)/ }));
    // Confirm stays disabled until an energy AND a bench Pokémon are picked.
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /^Retreat$/ });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Water Energy" }));
    fireEvent.click(screen.getByRole("button", { name: /Bench Sneasel/ }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledWith({
      type: "retreat",
      seat: "p1",
      discardEnergy: ["e1"],
      promoteBenchIndex: 0,
    });
  });

  it("disables the retreat control when the server marks it unpayable", () => {
    render(
      <OnlineHud
        game={game({
          phase: turnAction({ retreat: { cost: 2, can: false } }),
          you: { active: inPlay("sneasel", "Sneasel"), bench: [inPlay("b", "Beta")] },
        })}
        waitingOn="you"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    const btn = screen.getByRole<HTMLButtonElement>("button", { name: /Retreat \(2\)/ });
    expect(btn.disabled).toBe(true);
  });
});

describe("OnlineHud — turn:action abilities + trainers (3b)", () => {
  type TurnPhase = Extract<RedactedPhase, { kind: "turn:action" }>;
  const ABILITIES: TurnPhase["abilities"] = [
    {
      target: { spot: "active" },
      abilityName: "Shivery Chill",
      label: "Shivery Chill · Chien-Pao ex (Active)",
      disabled: false,
      reason: null,
    },
    {
      target: { spot: "bench", index: 1 },
      abilityName: "Shivery Chill",
      label: "Shivery Chill · Chien-Pao ex (Bench 2)",
      disabled: true,
      reason: null,
    },
  ];
  const TRAINERS: TurnPhase["trainers"] = [
    { uid: "t1", name: "Professor's Research", disabled: false, reason: null, rareCandy: false },
    {
      uid: "t2",
      name: "Boss's Orders",
      disabled: true,
      reason: "No legal target",
      rareCandy: false,
    },
  ];

  it("dispatches useAbility (seat + target + name) on an enabled ability row", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: turnAction({ abilities: ABILITIES }),
          you: { active: inPlay("chien", "Chien-Pao ex") },
        })}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Shivery Chill · Chien-Pao ex \(Active\)/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Shivery Chill",
    });
    // The Active-only copy sitting on the Bench is a disabled row — a click on it
    // dispatches nothing.
    onAction.mockClear();
    const benched = screen.getByRole<HTMLButtonElement>("button", {
      name: /Shivery Chill · Chien-Pao ex \(Bench 2\)/,
    });
    expect(benched.disabled).toBe(true);
    fireEvent.click(benched);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("dispatches playTrainer (seat + uid) on an enabled trainer row, greying the whiff", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: turnAction({ trainers: TRAINERS }),
          you: { active: inPlay("chien", "Chien-Pao ex") },
        })}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Professor's Research" }));
    expect(onAction).toHaveBeenCalledWith({ type: "playTrainer", seat: "p1", uid: "t1" });
    // Boss's Orders whiffs (server-folded), so its row is disabled and carries the
    // reason for a screen reader.
    const boss = screen.getByRole<HTMLButtonElement>("button", { name: "Boss's Orders" });
    expect(boss.disabled).toBe(true);
    expect(screen.getByText("No legal target")).toBeTruthy();
    onAction.mockClear();
    fireEvent.click(boss);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("dispatches endTurn from the in-panel Pass (the playmat ⟶ is covered by this panel)", () => {
    // The panel renders only while `waitingOn === "you"` on a turn:action — which
    // is exactly when passing is legal — so this button is never disabled, and it
    // is the only pass affordance a real click can reach while the panel is up.
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({ phase: turnAction(), you: { active: inPlay("chien", "Chien-Pao ex") } })}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    const pass = screen.getByRole<HTMLButtonElement>("button", { name: "Pass" });
    expect(pass.disabled).toBe(false);
    fireEvent.click(pass);
    expect(onAction).toHaveBeenCalledWith({ type: "endTurn", seat: "p1" });
  });

  it("renders no ability/trainer sections when the lists are empty", () => {
    render(
      <OnlineHud
        game={game({
          phase: turnAction(),
          you: { active: inPlay("chien", "Chien-Pao ex") },
        })}
        waitingOn="you"
        activePlaced
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByText("Abilities")).toBeNull();
    expect(screen.queryByText("Trainers")).toBeNull();
  });
});

describe("OnlineHud — turn:action Rare Candy (3b-ii)", () => {
  type TurnPhase = Extract<RedactedPhase, { kind: "turn:action" }>;
  const CANDY_ROW: TurnPhase["trainers"][number] = {
    uid: "rc1",
    name: "Rare Candy",
    disabled: false,
    reason: null,
    rareCandy: true,
  };
  const ACTIVE_OPTION: TurnPhase["rareCandy"][number] = {
    target: { spot: "active" },
    basicUid: "b0",
    basicName: "Charmander",
    stage2: [{ uid: "s0", name: "Charizard ex" }],
  };
  const BENCH_OPTION: TurnPhase["rareCandy"][number] = {
    target: { spot: "bench", index: 1 },
    basicUid: "b1",
    basicName: "Squirtle",
    stage2: [{ uid: "s1", name: "Blastoise" }],
  };
  const OPTIONS: TurnPhase["rareCandy"] = [ACTIVE_OPTION, BENCH_OPTION];

  function renderCandy(
    fields: Partial<TurnPhase>,
    onAction: (action: unknown) => void = vi.fn(),
  ) {
    render(
      <OnlineHud
        game={game({
          phase: turnAction({ trainers: [CANDY_ROW], ...fields }),
          you: { active: inPlay("b0", "Charmander") },
        })}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
  }

  it("opens the two-step dialog and dispatches the picked Basic + Stage 2 pair", () => {
    const onAction = vi.fn();
    renderCandy({ rareCandy: OPTIONS }, onAction);
    // The flagged row must NOT play on click (a pair can't ride one dispatch) —
    // it opens the dialog, which asks for the Basic first when there is a choice.
    fireEvent.click(screen.getByRole("button", { name: "Rare Candy" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Squirtle" }));
    // Then the Stage 2s that evolve from it (server-computed — the client never
    // checks the chain), and the pick dispatches the whole pair, seat-bound.
    fireEvent.click(screen.getByRole("button", { name: "Blastoise" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "rareCandy",
      seat: "p1",
      uid: "rc1",
      target: { spot: "bench", index: 1 },
      evolutionUid: "s1",
    });
    // The dialog closes on commit (no second dispatch from a stale pick).
    expect(screen.queryByRole("button", { name: "Blastoise" })).toBeNull();
  });

  it("pre-selects a sole Basic, skipping straight to the Stage 2 pick", () => {
    const onAction = vi.fn();
    renderCandy({ rareCandy: [ACTIVE_OPTION] }, onAction);
    fireEvent.click(screen.getByRole("button", { name: "Rare Candy" }));
    // One option means no choice to make — the dialog opens on the Stage 2 step.
    expect(screen.queryByRole("button", { name: "Charmander" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Charizard ex" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "rareCandy",
      seat: "p1",
      uid: "rc1",
      target: { spot: "active" },
      evolutionUid: "s0",
    });
  });

  it("greys the row with no legal pairing, so the dialog is unreachable", () => {
    const onAction = vi.fn();
    // The server folds "no Basic/Stage-2 pairing right now" into `disabled` and
    // ships an empty list — the row can't be clicked into an empty dialog.
    renderCandy({ trainers: [{ ...CANDY_ROW, disabled: true }], rareCandy: [] }, onAction);
    const row = screen.getByRole<HTMLButtonElement>("button", { name: "Rare Candy" });
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("OnlineHud — ko:takePrizes", () => {
  it("dispatches the picked prize indices once exactly `count` are chosen", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({ phase: { kind: "ko:takePrizes", count: 1 }, you: { prizesRemaining: 4 } })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    const take = screen.getByRole<HTMLButtonElement>("button", { name: /Take 0\/1/ });
    expect(take.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Prize 2" }));
    const armed = screen.getByRole<HTMLButtonElement>("button", { name: /Take 1\/1/ });
    expect(armed.disabled).toBe(false);
    fireEvent.click(armed);
    expect(onAction).toHaveBeenCalledWith({ type: "takePrizes", seat: "p1", prizeIndices: [1] });
  });
});

describe("OnlineHud — ko:promote", () => {
  it("dispatches the chosen bench index directly", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: { kind: "ko:promote" },
          you: { bench: [inPlay("a", "Alpha"), inPlay("b", "Beta")] },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(onAction).toHaveBeenCalledWith({ type: "promote", seat: "p1", benchIndex: 1 });
  });
});

describe("OnlineHud — effect:choose mayDraw (2b-iii-a)", () => {
  it("dispatches resolveEffect{draw:true} on Draw and {draw:false} on Decline", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: { kind: "mayDraw", count: 1, note: "You may draw a card." },
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // The prompt's note is the heading; the two printed answers are the buttons.
    expect(screen.getByText("You may draw a card.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Draw a card" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "mayDraw", draw: true },
    });
    onAction.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "mayDraw", draw: false },
    });
  });

  it("labels the Draw button with the count when more than one", () => {
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: { kind: "mayDraw", count: 2, note: "You may draw 2 cards." },
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Draw 2 cards" })).toBeTruthy();
  });

  it("renders nothing for the viewer the prompt is withheld from (null on the wire)", () => {
    // The server sends the non-answering viewer effect:choose with a null prompt
    // AND waitingOn=opponent; the HUD shows no dialog on the wrong screen.
    const { container } = render(
      <OnlineHud
        game={game({ phase: { kind: "effect:choose", prompt: null }, waitingOn: "opponent" })}
        waitingOn="opponent"
        activePlaced={false}
        onAction={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("OnlineHud — effect:choose public-ref prompts (2b-iii-b)", () => {
  it("choosePokemon: each row dispatches resolveEffect{pokemon, ref} and marks the opponent's", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "choosePokemon",
              candidates: [YOU_ACTIVE, OPP_ACTIVE],
              note: "Choose a Pokémon to switch.",
            },
          },
          you: { active: inPlay("mine", "My Sneasel") },
          opponent: { active: inPlay("theirs", "Their Mareep") },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // The opponent's candidate carries the "opponent" marker (its ref.seat !== own).
    const oppRow = screen.getByRole("button", { name: /Their Mareep/ });
    expect(oppRow.textContent).toContain("opponent");
    fireEvent.click(screen.getByRole("button", { name: /My Sneasel/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: YOU_ACTIVE },
    });
  });

  it("choosePokemonMulti: Confirm is gated to the exact count, then dispatches the refs", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "choosePokemonMulti",
              candidates: [OPP_ACTIVE, YOU_BENCH0],
              min: 2,
              max: 2,
              declinable: false,
              note: "Choose 2 Pokémon.",
            },
          },
          you: { bench: [inPlay("b0", "My Bench")] },
          opponent: { active: inPlay("oa", "Their Active") },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /Confirm 0\/2/ });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Their Active/ }));
    fireEvent.click(screen.getByRole("button", { name: /My Bench/ }));
    const armed = screen.getByRole<HTMLButtonElement>("button", { name: /Confirm 2\/2/ });
    expect(armed.disabled).toBe(false);
    fireEvent.click(armed);
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [OPP_ACTIVE, YOU_BENCH0] },
    });
  });

  it("🆕 D359 choosePokemon: a printed ceiling offers a row PER QUANTITY, plus Take none", () => {
    // The quantity is part of the SAME whole decision as the body (the op's `count`
    // pins the batch to the one body the print names), so it stays inside the row
    // rather than becoming a second dialog. `upTo: 2` therefore offers each body
    // TWICE — the middle answer and the full one — and each click dispatches a
    // single frame carrying both halves.
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "choosePokemon",
              candidates: [YOU_BENCH0],
              upTo: 2,
              note: "Attach up to 2 Energy to which of your Benched Pokémon?",
            },
          },
          you: { bench: [inPlay("b0", "My Bench")] },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /My Bench — attach 1/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: YOU_BENCH0, take: 1 },
    });
    fireEvent.click(screen.getByRole("button", { name: /My Bench — attach 2/ }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: YOU_BENCH0, take: 2 },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Take none$/ }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
  });

  it("🆕 D359 choosePokemon: `upTo: 1` renders the SINGLE row it always did", () => {
    // 🛑 THE LINE THAT KEEPS EVERY PRE-D359 DIALOG BYTE-IDENTICAL. A take-1-or-none
    // pick has exactly ONE non-empty answer, and spelling it `take: 1` on the wire
    // would be a second way to say what a bare ref already says. So `takeOptions`
    // collapses at one, the row carries no quantity suffix, and the dispatched
    // frame is the one D358 shipped.
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "choosePokemon",
              candidates: [YOU_BENCH0],
              upTo: 1,
              note: "Attach the Energy to which of your Metal Pokémon?",
            },
          },
          you: { bench: [inPlay("b0", "My Bench")] },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    expect(screen.queryByRole("button", { name: /attach 1/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /My Bench/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: YOU_BENCH0 },
    });
  });

  it("🆕 D359 choosePokemon: a MANDATORY prompt offers one row and NO Take none", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "choosePokemon",
              candidates: [YOU_BENCH0],
              note: "Switch in which Pokémon?",
            },
          },
          you: { bench: [inPlay("b0", "My Bench")] },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Take none$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /attach/ })).toBeNull();
  });

  it("choosePokemonMulti: a declinable snipe offers Take none at zero picks", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "choosePokemonMulti",
              candidates: [OPP_ACTIVE],
              min: 2,
              max: 2,
              declinable: true,
              note: "You may choose 2 Pokémon.",
            },
          },
          opponent: { active: inPlay("oa", "Their Active") },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Take none$/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [] },
    });
  });

  it("moveEnergy: picks an Energy off a sole source onto a sole destination, then Move", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "moveEnergy",
              movable: [{ uid: "e1", from: YOU_ACTIVE }],
              destinations: [YOU_ACTIVE, YOU_BENCH0],
              max: 1,
              note: "Move an Energy.",
            },
          },
          you: {
            active: inPlay("a", "My Active", {
              attached: { tools: [], energies: [energy("e1", "Water Energy")] },
            }),
            bench: [inPlay("b0", "My Bench")],
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // Sole source + sole destination are pre-chosen; picking the Energy arms Move.
    const move = screen.getByRole<HTMLButtonElement>("button", { name: /Move 0/ });
    expect(move.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Water Energy" }));
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: "e1", dest: YOU_BENCH0 }] },
    });
  });

  it("🆕🆕 D443 moveEnergy: rows on the OPPONENT's board carry the side marker", () => {
    // D443 — this dialog now serves BOTH boards. The wire ref's `seat` is ABSOLUTE
    // (the schema's own doc says so), so the marker is `ref.seat !== seat` exactly
    // as `ChoosePokemonDialog` and `DiscardEnergyDialog` have spelled it for a long
    // time — all four moveEnergy dialogs were the only public-ref ones without it.
    // ⚠️ THE BOARD IS DELIBERATELY A MIRROR: both bodies are named "Mareep", so the
    // marker is the ONLY thing distinguishing the two rows. Without it the dialog
    // asks the player to pick between two identical buttons on two different boards.
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "moveEnergy",
              movable: [{ uid: "e1", from: OPP_ACTIVE }],
              // ⚠️ A MIXED DESTINATION LIST, CONSTRUCTED AND LABELLED SO (D440's
              // rule: a rung over a prompt the engine never emits is a claim about
              // the READER, not about the pool). No `moveEnergy` op can offer both
              // boards at once — `moveEndpoints` reads ONE seat — and that is
              // exactly why the control has to be built: a same-render pair is the
              // only way to show the marker follows `ref.seat` rather than firing
              // on every row, and this dialog is a pure function of its prompt.
              destinations: [OPP_BENCH0, YOU_BENCH0],
              max: 1,
              note: "Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon.",
            },
          },
          you: { active: inPlay("a", "Mareep"), bench: [inPlay("b0", "Mareep")] },
          opponent: {
            active: inPlay("oa", "Mareep", {
              attached: { tools: [], energies: [energy("e1", "Water Energy")] },
            }),
            bench: [inPlay("ob0", "Mareep")],
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // ⚠️ THE ACCESSIBLE NAME CONCATENATES WITHOUT A SPACE ("Mareepopponent") — the
    // shipped markup of the two sibling dialogs verbatim, matched rather than
    // re-spelled — so the query is a regex about the MARKER, not about the spacing.
    // 🛑 THE PAIR, IN ONE RENDER: two destination rows, two identically-named
    // bodies, and exactly ONE marker. Either half alone proves nothing — "every row
    // says opponent" and "no row says opponent" both satisfy a one-sided assertion.
    expect(screen.getByRole("button", { name: /^Mareep\s*opponent$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Mareep$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Mareep\s*opponent$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Water Energy" }));
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));
    // …and the marked row is the one that built the frame, so the marker and the
    // ref it describes cannot have drifted apart.
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: "e1", dest: OPP_BENCH0 }] },
    });
  });

  it("moveEnergy: Move none declines against the first destination", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "moveEnergy",
              movable: [{ uid: "e1", from: YOU_ACTIVE }],
              destinations: [YOU_BENCH0],
              max: 1,
              note: "Move an Energy.",
            },
          },
          you: {
            active: inPlay("a", "My Active", {
              attached: { tools: [], energies: [energy("e1", "Water Energy")] },
            }),
            bench: [inPlay("b0", "My Bench")],
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Move none/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
  });

  it("🆕🆕 D442 moveEnergy: `anyDest` gives each pick its OWN destination", () => {
    // 🛑 THE ONLINE HALF OF THE MAP ANSWER. The board is the SAME shape as the
    // mandatory case below (two Energy on the Active, `min === max === 2`) and the
    // ONLY differences are `anyDest` and a second benched destination — so a build
    // that dropped the rider on the wire, in the projection or in this dialog would
    // pass every assertion there and fail every one here. D226's pair rule: a
    // spread one client can build and the other cannot is a seat-dependent card.
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "moveEnergy",
              movable: [
                { uid: "e1", from: YOU_ACTIVE },
                { uid: "e2", from: YOU_ACTIVE },
              ],
              // The ACTIVE is a destination too, which is what makes the per-pick
              // "other" exclusion observable at all: both Energy sit on it.
              destinations: [YOU_ACTIVE, YOU_BENCH0, YOU_BENCH1],
              max: 2,
              min: 2,
              anyDest: true,
              note: "Move all Energy from this Pokémon to your Benched Pokémon in any way you like.",
            },
          },
          you: {
            active: inPlay("a", "My Active", {
              attached: {
                tools: [],
                energies: [energy("e1", "Water Energy"), energy("e2", "Fire Energy")],
              },
            }),
            bench: [inPlay("b0", "Bench One"), inPlay("b1", "Bench Two")],
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // The destination list mounts only while an Energy is waiting for one — the
    // two-step LOOP, not the shared "Move to:" list of the coupled dialog.
    expect(screen.queryByText("Move to:")).toBeNull();
    // The floor is read here exactly as the coupled dialog reads it.
    expect(screen.queryByRole("button", { name: /Move none/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Water Energy on My Active · Active" }));
    expect(screen.getByText("Move to:")).toBeTruthy();
    // The printed "other", PER PICK: the body this Energy sits on is not offered as
    // its destination — `validateChoice` refuses a self-move per entry, so offering
    // one would be the afford-then-reject D222 named.
    expect(screen.queryByRole("button", { name: "My Active · Active" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bench One · Bench 1" }));
    // A SHORT answer is still refused — one of two, under `min === max === 2`.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Move 1/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy on My Active · Active" }));
    fireEvent.click(screen.getByRole("button", { name: "Bench Two · Bench 2" }));
    fireEvent.click(screen.getByRole("button", { name: /Move 2/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        // 🛑 TWO DIFFERENT DESTINATIONS. A dialog that kept one shared `dest`
        // dispatches the same uids and the same count; the destinations are the
        // only observable, which is why they are what the rung reads.
        picks: [
          { uid: "e1", dest: YOU_BENCH0 },
          { uid: "e2", dest: YOU_BENCH1 },
        ],
      },
    });
  });

  it("🆕 moveEnergy: a FLOOR withholds 'Move none' and holds Move disabled until the pick is WHOLE", () => {
    // 🛑 D441 — Castform's printed *"Move all Energy"*. The board is the SAME
    // shape as the declinable case two tests up (one source, one destination) and
    // the ONLY difference is `min`, so a build that ignored the field would pass
    // every assertion there and fail every one here.
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "moveEnergy",
              movable: [
                { uid: "e1", from: YOU_ACTIVE },
                { uid: "e2", from: YOU_ACTIVE },
              ],
              destinations: [YOU_BENCH0],
              max: 2,
              min: 2,
              note: "Move all Energy from this Pokémon to 1 of your Benched Pokémon.",
            },
          },
          you: {
            active: inPlay("a", "My Active", {
              attached: {
                tools: [],
                energies: [energy("e1", "Water Energy"), energy("e2", "Fire Energy")],
              },
            }),
            bench: [inPlay("b0", "My Bench")],
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // The decline is WITHHELD rather than disabled — the empty answer is not one of
    // this prompt's answers, so it is not a row on screen.
    expect(screen.queryByRole("button", { name: /Move none/ })).toBeNull();
    // …and a SHORT answer cannot be dispatched either, which the missing button
    // alone does not prove: one Energy of two is a legal answer to every other
    // prompt this dialog renders and the engine now refuses it.
    fireEvent.click(screen.getByRole("button", { name: "Water Energy" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Move 1/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy" }));
    fireEvent.click(screen.getByRole("button", { name: /Move 2/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: "e1", dest: YOU_BENCH0 }, { uid: "e2", dest: YOU_BENCH0 }] },
    });
  });

  it("moveEnergy: `anySource` drops the source stage and lets the picks SPAN hosts", () => {
    // 🛑 D226 — N's Plan over the wire. The source stage filters the Energy list
    // to ONE host, so keeping it would make the card's printed answer (one Energy
    // off each of two benched bodies) impossible to build here while the server
    // accepted it — the afford-then-reject defect in its quietest direction, since
    // a picker that never offers the second host reports nothing at all. BOTH HUDs
    // preview `moveEnergy` targets, which is why the rider was priced against its
    // READ SITES and not its field.
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "moveEnergy",
              movable: [
                { uid: "e1", from: YOU_BENCH0 },
                { uid: "e2", from: YOU_BENCH1 },
              ],
              destinations: [YOU_ACTIVE],
              max: 2,
              anySource: true,
              note: "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon.",
            },
          },
          you: {
            active: inPlay("a", "My Active"),
            bench: [
              inPlay("b0", "Bench One", {
                attached: { tools: [], energies: [energy("e1", "Fire Energy")] },
              }),
              inPlay("b1", "Bench Two", {
                attached: { tools: [], energies: [energy("e2", "Water Energy")] },
              }),
            ],
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // No stage A: the host list never renders, and every offered Energy is on one
    // list labelled with the body it sits on.
    expect(screen.queryByText("Choose which Pokémon to move Energy from.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy — Bench One" }));
    fireEvent.click(screen.getByRole("button", { name: "Water Energy — Bench Two" }));
    fireEvent.click(screen.getByRole("button", { name: /Move 2/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: "e1", dest: YOU_ACTIVE }, { uid: "e2", dest: YOU_ACTIVE }] },
    });
  });

  it("discardEnergy: a total-1 pick off the opponent's Active dispatches the uid", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "discardEnergy",
              discardable: [
                { uid: "e1", from: OPP_ACTIVE },
                { uid: "e2", from: OPP_ACTIVE },
              ],
              scope: { kind: "total", count: 1 },
              note: "Discard an Energy from your opponent's Active.",
            },
          },
          opponent: {
            active: inPlay("oa", "Their Active", {
              attached: {
                tools: [],
                energies: [energy("e1", "Fire Energy"), energy("e2", "Water Energy")],
              },
            }),
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    const discard = screen.getByRole<HTMLButtonElement>("button", { name: /Discard 0\/1/ });
    expect(discard.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy" }));
    fireEvent.click(screen.getByRole("button", { name: /Discard 1\/1/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: ["e1"] },
    });
  });
});

describe("OnlineHud — effect:choose hidden-candidate prompts (2b-iii-c)", () => {
  it("chooseCards: a mandatory cost gates Confirm to the count, then dispatches the ids", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "chooseCards",
              candidates: [card("c1", "Card One"), card("c2", "Card Two"), card("c3", "Card Three")],
              min: 2,
              max: 2,
              dest: "discard",
              note: "Discard 2 cards from your hand.",
            },
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // The revealed identities name the rows (no board lookup).
    expect(screen.getByRole("button", { name: "Card One" })).toBeTruthy();
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /Discard 0\/2/ });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Card One" }));
    fireEvent.click(screen.getByRole("button", { name: "Card Three" }));
    const armed = screen.getByRole<HTMLButtonElement>("button", { name: /Discard 2\/2/ });
    expect(armed.disabled).toBe(false);
    fireEvent.click(armed);
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: ["c1", "c3"] },
    });
  });

  it("chooseCards: an 'up to' search into the deck labels Shuffle and can dispatch none", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "chooseCards",
              candidates: [card("d1", "Deck Card")],
              min: 0,
              max: 1,
              dest: "deck",
              note: "You may shuffle a Pokémon into your deck.",
            },
          },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // min:0 → Confirm is live at zero picks, and the verb follows dest:"deck".
    fireEvent.click(screen.getByRole("button", { name: /Shuffle none/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
  });

  it("attachCards: pick a card then a target, then Attach dispatches the assignment", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "attachCards",
              candidates: [card("e1", "Fire Energy")],
              targets: [YOU_ACTIVE, YOU_BENCH0],
              max: 2,
              note: "Attach the revealed Energy.",
            },
          },
          you: { active: inPlay("a", "My Active"), bench: [inPlay("b0", "My Bench")] },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    // Two targets → not a sole-target auto-commit: tap the card, then the target.
    fireEvent.click(screen.getByRole("button", { name: /Fire Energy/ }));
    fireEvent.click(screen.getByRole("button", { name: /My Bench/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Attach 1$/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: "e1", to: YOU_BENCH0 }] },
    });
  });

  it("attachCards: Attach none declines with an empty assignment list", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={game({
          phase: {
            kind: "effect:choose",
            prompt: {
              kind: "attachCards",
              candidates: [card("e1", "Fire Energy")],
              targets: [YOU_ACTIVE],
              max: 2,
              note: "You may attach the revealed Energy.",
            },
          },
          you: { active: inPlay("a", "My Active") },
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Attach none$/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
  });
});
