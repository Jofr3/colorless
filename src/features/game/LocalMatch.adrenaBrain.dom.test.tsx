// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction, redactGame, type GameState } from "@luminous/engine";
import { redactedEffectPromptSchema } from "@luminous/schema";
import {
  ALL_BASIC_DECK,
  battler,
  driveSetup,
  typedEnergy,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import type { PlaymatViewProps } from "../playmat/PlaymatView";
import { LocalMatch } from "./LocalMatch";
import { OnlineMatch } from "../online/components/OnlineMatch";
import { adrenaBrainDecision, ADRENA_BRAIN_HOLD_MS, ADRENA_BRAIN_SHAKE_MS } from "./useAdrenaBrain";

const cardsLayer = vi.fn();
vi.mock("../playmat/components/AnimatedCardsLayer", () => ({
  AnimatedCardsLayer: (props: PlaymatViewProps) => {
    cardsLayer(props);
    return props.cardSelection?.candidates.map((card) => (
      <button
        key={card.id}
        type="button"
        data-testid={`select-${card.id}`}
        onClick={() => props.cardSelection?.onSelect(card.id)}
      >
        {card.name}
      </button>
    ));
  },
}));

beforeAll(installDomShims);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  cardsLayer.mockClear();
});

function brainBoard(multiple = false, seat: "p1" | "p2" = "p1") {
  const state = driveSetup(
    3,
    { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK },
    {
      first: seat,
      bench: { p1: ["fix-basic-1", "fix-basic-1"], p2: ["fix-basic-1", "fix-basic-1"] },
    },
  );
  const own = state.players[seat];
  if (!own.active || own.hand[0] === undefined) throw new Error("Expected an Active and Energy");
  const uid = own.active.stack.at(-1);
  if (uid === undefined) throw new Error("Expected an Active uid");
  const energy = own.hand[0];
  state.cardIdByUid[uid] = "sv06-095";
  state.cardIdByUid[energy] = "adrena-dark";
  state.cardPool["sv06-095"] = battler("sv06-095", {
    name: "Munkidori",
    hp: 110,
    abilities: [
      {
        type: "Ability",
        name: "Adrena-Brain",
        effect:
          "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.",
      },
    ],
  });
  state.cardPool["adrena-dark"] = typedEnergy("adrena-dark", "Darkness");
  own.hand.shift();
  own.active.energy.push(energy);
  own.active.damage = 50;
  if (multiple && own.bench[0]) own.bench[0].damage = 40;
  return state;
}

function mount(state: GameState) {
  const onSave = vi.fn();
  const rendered = render(
    <StrictMode>
      <MemoryRouter>
        <LocalMatch
          setup={{ state, events: [], names: { p1: "One", p2: "Two" }, startedAt: 0 }}
          onPlayAgain={() => {}}
          onSave={onSave}
        />
      </MemoryRouter>
    </StrictMode>,
  );
  return { onSave, ...rendered };
}
const layer = () => cardsLayer.mock.calls.at(-1)?.[0] as PlaymatViewProps;
const select = (id: string) => fireEvent.click(screen.getByTestId(`select-${id}`));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("Adrena-Brain board selection", () => {
  it.each(["p1", "p2"] as const)(
    "requires both card clicks, holds for a second, then transfers instantly as the shake starts (%s)",
    (seat) => {
      mount(brainBoard(false, seat));
      const source = layer().board.you.active;
      const target = layer().board.opponent.active;
      if (!source || !target) throw new Error("Expected both Actives");
      fireEvent.click(screen.getByRole("button", { name: /Adrena-Brain/ }));
      expect(layer().cardSelection?.candidates.map((card) => card.id)).toEqual([source.id]);
      expect(layer().cardSelection?.selectedIds).toEqual([]);
      expect(layer().cardSelection?.abilityCardId).toBe(source.id);
      expect(screen.queryByRole("dialog", { name: "Choose a Pokémon" })).toBeNull();
      select(source.id);
      expect(layer().cardSelection?.selectedIds).toEqual([source.id]);
      expect(layer().cardSelection?.candidates.map((card) => card.id)).toContain(target.id);
      expect(screen.queryByRole("button", { name: "Move 4 damage counters" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Move 2 damage counters" }));
      const chooseTarget = layer().cardSelection?.onSelect;
      act(() => {
        chooseTarget?.(target.id);
        chooseTarget?.(target.id);
      });
      expect(layer().cardSelection?.selectedIds).toEqual([source.id, target.id]);
      expect(layer().cardSelection?.candidates).toEqual([]);
      advance(ADRENA_BRAIN_HOLD_MS - 1);
      expect(layer().cardSelection?.phase).toBe("hold");
      expect(layer().board.you.active?.battle?.damage).toBe(50);
      expect(layer().board.opponent.active?.battle?.damage).toBe(0);
      advance(1);
      expect(layer().cardSelection?.phase).toBe("shake");
      expect(layer().cardSelection?.abilityCardId).toBe(source.id);
      expect(layer().cardSelection?.selectedIds).toEqual([source.id, target.id]);
      expect(layer().cardSelection?.count).toBe(2);
      expect(layer().board.you.active?.battle?.damage).toBe(30);
      expect(layer().board.opponent.active?.battle?.damage).toBe(20);
      expect(screen.getByRole("button", { name: "Pass turn" }).hasAttribute("disabled")).toBe(true);
      advance(ADRENA_BRAIN_SHAKE_MS - 1);
      expect(layer().cardSelection?.phase).toBe("shake");
      expect(layer().board.opponent.active?.battle?.damage).toBe(20);
      advance(1);
      expect(layer().cardSelection).toBeUndefined();
      expect(layer().board.you.active?.battle?.damage).toBe(30);
      expect(layer().board.opponent.active?.battle?.damage).toBe(20);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("offers only damaged sources and moves a benched source's counters to the chosen opponent Bench", () => {
    mount(brainBoard(true));
    const active = layer().board.you.active;
    const source = layer().board.you.bench[0];
    const clean = layer().board.you.bench[1];
    const target = layer().board.opponent.bench[1];
    if (!active || !source || !clean || !target) throw new Error("Expected board cards");
    fireEvent.click(screen.getByRole("button", { name: /Adrena-Brain/ }));
    expect(layer().cardSelection?.candidates.map((card) => card.id)).toEqual([
      active.id,
      source.id,
    ]);
    act(() => layer().cardSelection?.onSelect(clean.id));
    expect(layer().cardSelection?.selectedIds).toEqual([]);
    select(source.id);
    expect(layer().cardSelection?.abilityCardId).toBe(active.id);
    select(target.id);
    advance(ADRENA_BRAIN_HOLD_MS);
    advance(ADRENA_BRAIN_SHAKE_MS);
    expect(layer().board.you.active?.battle?.damage).toBe(50);
    expect(layer().board.you.bench[0]?.battle?.damage).toBe(10);
    expect(layer().board.opponent.bench[1]?.battle?.damage).toBe(30);
  });

  it("marks the benched Munkidori that activated the ability when another copy is Active", () => {
    const state = brainBoard(true);
    const caster = state.players.p1.bench[1];
    const casterUid = caster?.stack.at(-1);
    const energy = state.players.p1.hand.shift();
    if (!caster || casterUid === undefined || energy === undefined)
      throw new Error("Expected caster and Energy");
    state.cardIdByUid[casterUid] = "sv06-095";
    state.cardIdByUid[energy] = "adrena-dark";
    caster.energy.push(energy);
    mount(state);
    fireEvent.click(screen.getByRole("button", { name: "Adrena-Brain · Munkidori (Bench 2)" }));
    expect(layer().cardSelection?.abilityCardId).toBe(layer().board.you.bench[1]?.id);
    const source = layer().board.you.bench[0];
    const target = layer().board.opponent.bench[0];
    if (!source || !target) throw new Error("Expected cards");
    select(source.id);
    select(target.id);
    advance(ADRENA_BRAIN_HOLD_MS);
    expect(layer().cardSelection?.abilityCardId).toBe(casterUid);
    expect(layer().cardSelection?.selectedIds).toEqual([source.id, target.id]);
    advance(ADRENA_BRAIN_SHAKE_MS);
    expect(layer().cardSelection).toBeUndefined();
  });

  it("caps quantities to the selected source's counters and allows moving none", () => {
    const state = brainBoard();
    if (state.players.p1.active) state.players.p1.active.damage = 10;
    mount(state);
    fireEvent.click(screen.getByRole("button", { name: /Adrena-Brain/ }));
    const source = layer().board.you.active;
    if (!source) throw new Error("Expected source");
    select(source.id);
    expect(layer().cardSelection?.count).toBe(1);
    expect(screen.queryByRole("button", { name: "Move 2 damage counters" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move none" }));
    expect(layer().cardSelection).toBeUndefined();
    expect(layer().board.you.active?.battle?.damage).toBe(10);
    expect(layer().board.opponent.active?.battle?.damage).toBe(0);
  });

  it("keeps both cards selected through a knockout and preserves the moved quantity", () => {
    const state = brainBoard();
    const targetUid = state.players.p2.active?.stack.at(-1);
    if (targetUid === undefined || !state.players.p1.active) throw new Error("Expected Actives");
    state.cardIdByUid[targetUid] = "adrena-target";
    state.cardPool["adrena-target"] = battler("adrena-target", { name: "Target", hp: 20 });
    state.players.p1.active.damage = 30;
    mount(state);
    fireEvent.click(screen.getByRole("button", { name: /Adrena-Brain/ }));
    const source = layer().board.you.active;
    const target = layer().board.opponent.active;
    if (!source || !target) throw new Error("Expected cards");
    select(source.id);
    select(target.id);
    advance(ADRENA_BRAIN_HOLD_MS);
    expect(layer().board.you.active?.battle?.damage).toBe(0);
    expect(layer().board.opponent.active).toBeNull();
    expect(layer().cardSelection?.phase).toBe("shake");
    expect(layer().cardSelection?.selectedIds).toEqual([source.id, target.id]);
    expect(layer().cardSelection?.count).toBe(3);
    advance(ADRENA_BRAIN_SHAKE_MS);
    expect(layer().cardSelection).toBeUndefined();
  });

  it("preserves the committed source when resuming and carries it through the online schema", () => {
    const state = brainBoard(true);
    const used = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      abilityName: "Adrena-Brain",
      target: { spot: "active" },
    });
    if (!used.ok) throw new Error(used.error.message);
    const picked = applyAction(used.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    if (!picked.ok) throw new Error(picked.error.message);
    const redacted = redactGame(picked.state, "p1");
    if (redacted.phase.kind !== "effect:choose") throw new Error("Expected choice");
    expect(redactedEffectPromptSchema.parse(redacted.phase.prompt)).toMatchObject({
      counterTransfer: {
        upTo: 3,
        from: { seat: "p1", spot: { spot: "bench", index: 0 } },
        abilitySourceUid: picked.state.players.p1.active?.stack.at(-1),
      },
    });
    expect(adrenaBrainDecision(redacted)).toEqual(adrenaBrainDecision(picked.state));
    expect(redactGame(picked.state, "p2").phase).toEqual({ kind: "effect:choose", prompt: null });
    mount(picked.state);
    expect(layer().cardSelection?.candidates.map((card) => card.id)).toEqual([
      layer().board.you.bench[0]?.id,
    ]);
  });

  it("cancels the delayed answer when the match unmounts", () => {
    const { onSave, unmount } = mount(brainBoard());
    fireEvent.click(screen.getByRole("button", { name: /Adrena-Brain/ }));
    const source = layer().board.you.active;
    const target = layer().board.opponent.active;
    if (!source || !target) throw new Error("Expected cards");
    select(source.id);
    select(target.id);
    onSave.mockClear();
    unmount();
    advance(5000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("uses the same board sequence online and sends each choice to the server once", () => {
    let state = brainBoard(true);
    const onAction = vi.fn((action: Parameters<typeof applyAction>[1]) => {
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
      rerender(view());
    });
    function view() {
      return (
        <MemoryRouter>
          <OnlineMatch
            game={redactGame(state, "p1")}
            log={[]}
            youName="One"
            opponentName="Two"
            opponentAway={null}
            actionError={null}
            onAction={onAction}
            onRematch={() => {}}
          />
        </MemoryRouter>
      );
    }
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole("button", { name: /Adrena-Brain/ }));
    const source = layer().board.you.bench[0];
    const target = layer().board.opponent.bench[1];
    if (!source || !target) throw new Error("Expected cards");
    select(source.id);
    expect(layer().cardSelection?.selectedIds).toEqual([source.id]);
    expect(layer().cardSelection?.abilityCardId).toBe(layer().board.you.active?.id);
    select(target.id);
    advance(ADRENA_BRAIN_HOLD_MS);
    expect(onAction).toHaveBeenCalledTimes(3);
    expect(onAction).toHaveBeenLastCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } }, take: 3 },
    });
    expect(layer().board.you.bench[0]?.battle?.damage).toBe(10);
    expect(layer().board.opponent.bench[1]?.battle?.damage).toBe(30);
    expect(layer().cardSelection?.phase).toBe("shake");
    expect(layer().cardSelection?.count).toBe(3);
    advance(ADRENA_BRAIN_SHAKE_MS);
    expect(layer().cardSelection).toBeUndefined();
    expect(onAction).toHaveBeenCalledTimes(3);
  });

  it("keeps the online selection until the server updates the counters, then starts the shake", () => {
    let state = brainBoard();
    const onAction = vi.fn((action: Parameters<typeof applyAction>[1]) => {
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
      if (action.type !== "resolveEffect") rerender(view());
    });
    function view() {
      return (
        <MemoryRouter>
          <OnlineMatch
            game={redactGame(state, "p1")}
            log={[]}
            youName="One"
            opponentName="Two"
            opponentAway={null}
            actionError={null}
            onAction={onAction}
            onRematch={() => {}}
          />
        </MemoryRouter>
      );
    }
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole("button", { name: /Adrena-Brain/ }));
    const source = layer().board.you.active;
    const target = layer().board.opponent.active;
    if (!source || !target) throw new Error("Expected cards");
    select(source.id);
    select(target.id);
    advance(ADRENA_BRAIN_HOLD_MS);
    expect(layer().cardSelection?.phase).toBe("submitted");
    expect(layer().board.opponent.active?.battle?.damage).toBe(0);
    advance(2000);
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(layer().cardSelection?.selectedIds).toEqual([source.id, target.id]);
    rerender(view());
    expect(layer().cardSelection?.phase).toBe("shake");
    expect(layer().cardSelection?.count).toBe(3);
    expect(layer().board.you.active?.battle?.damage).toBe(20);
    expect(layer().board.opponent.active?.battle?.damage).toBe(30);
    advance(ADRENA_BRAIN_SHAKE_MS);
    expect(layer().cardSelection).toBeUndefined();
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});
