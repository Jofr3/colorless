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
  return { kind: "turn:action", attacks: [], retreat: null, abilities: [], trainers: [], ...fields };
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
    { uid: "t1", name: "Professor's Research", disabled: false, reason: null },
    { uid: "t2", name: "Boss's Orders", disabled: true, reason: "No legal target" },
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
      choice: { kind: "moveEnergy", uids: ["e1"], dest: YOU_BENCH0 },
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
      choice: { kind: "moveEnergy", uids: [], dest: YOU_BENCH0 },
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
