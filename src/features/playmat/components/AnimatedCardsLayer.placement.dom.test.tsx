// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Container, type Ticker } from "pixi.js";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { placementPredicateFor } from "../../game/placement";
import type { CardViewTarget } from "../pixi/CardView";
import type {
  BoardState,
  CardModel,
  CardMoveRequest,
  CardSelection,
  CardType,
  PlayerId,
} from "../types";
import { NO_CONDITIONS } from "../types";
import { AnimatedCardsLayer } from "./AnimatedCardsLayer";
import { PlayerSide } from "./PlayerSide";

const mocks = vi.hoisted(() => ({ constructed: vi.fn(), createApplication: vi.fn() }));
const ticker = { add: vi.fn<(callback: (ticker: Ticker) => void) => void>(), remove: vi.fn() };
vi.mock("../../../lib/pixi/createPixiApplication", () => ({
  createPixiApplication: mocks.createApplication,
}));
vi.mock("../../../lib/animation/gsapPixi", () => ({ ensureGsapPixi: vi.fn() }));
vi.mock("../pixi/CardView", () => ({
  CardView: class {
    id: string;
    container = new Container();
    target: CardViewTarget | null = null;
    position = { x: 0, y: 0 };
    isDragging = false;
    constructor({ id }: { id: string }) {
      this.id = id;
      mocks.constructed(this);
    }
    get placement() {
      return this.target?.placement;
    }
    get zIndex() {
      return this.target?.zIndex ?? 0;
    }
    setTarget = vi.fn((target: CardViewTarget) => {
      this.target = target;
      this.position = { x: target.x, y: target.y };
    });
    getTargetSnapshot = () => this.target;
    getPosition = () => this.position;
    getCardCenter = () => this.position;
    hitTest = (point: { x: number; y: number }) =>
      this.target !== null &&
      Math.abs(point.x - this.position.x) < this.target.width / 2 &&
      Math.abs(point.y - this.position.y) < this.target.height / 2;
    dragTo = (x: number, y: number) => {
      this.position = { x, y };
    };
    startDrag = () => {
      this.isDragging = true;
    };
    release = () => {
      this.isDragging = false;
    };
    destroy = vi.fn(() => this.container.destroy());
    setHovered = vi.fn();
    updateHoverPoint = vi.fn();
    shake = vi.fn();
    setSelected = vi.fn();
    setAbilityGlow = vi.fn();
    startPress = vi.fn();
    stopPress = vi.fn();
    setPresentationOptions = vi.fn();
    setTextureUrl = vi.fn();
    setReducedMotion = vi.fn();
    setPlaymatSize = vi.fn();
    hide = vi.fn();
    update = vi.fn();
  },
}));

interface TestView {
  id: string;
  target: CardViewTarget;
  setTarget: ReturnType<typeof vi.fn>;
  shake: ReturnType<typeof vi.fn>;
  setSelected: ReturnType<typeof vi.fn>;
  setAbilityGlow: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setHovered: ReturnType<typeof vi.fn>;
  updateHoverPoint: ReturnType<typeof vi.fn>;
  isDragging: boolean;
}
function view(id: string): TestView {
  const found = mocks.constructed.mock.calls.find(([candidate]) => candidate.id === id)?.[0];
  if (!found) throw new Error(`Missing view ${id}`);
  return found as TestView;
}
function pokemon(id: string, stage = "Basic"): CardModel {
  return { id, name: id, cardId: id, type: "pokemon", stage };
}
const usedTrainers = {
  turn: 1,
  cards: [
    { id: "used", cardId: "sv01-196", name: "Used Trainer", type: "trainer" } satisfies CardModel,
  ],
};
function Scene({
  stage,
  onMove,
  targets = [],
  isViewerTurn = true,
  activeStage = "Basic",
  handType = "pokemon",
  usedTrainerOwner,
  usableTrainerIds,
  benchLimit = 5,
  damaged = false,
  cardSelection,
  activeRemoved = false,
  blueBackPlayer = "you",
}: {
  stage: string;
  onMove: (move: CardMoveRequest) => void;
  targets?: readonly string[];
  isViewerTurn?: boolean;
  activeStage?: string;
  handType?: CardType;
  usedTrainerOwner?: PlayerId;
  usableTrainerIds?: ReadonlySet<string>;
  benchLimit?: number;
  damaged?: boolean;
  cardSelection?: CardSelection;
  activeRemoved?: boolean;
  blueBackPlayer?: PlayerId;
}) {
  const root = useRef<HTMLDivElement>(null);
  const board: BoardState = {
    stadium: null,
    you: {
      hand: [{ ...pokemon("dragged", stage), type: handType, evolutionTargetIds: targets }],
      active: activeRemoved
        ? null
        : {
            ...pokemon("active", activeStage),
            battle: damaged
              ? { damage: 30, hp: 70, conditions: { ...NO_CONDITIONS, burned: true } }
              : undefined,
          },
      bench: [
        {
          ...pokemon("bench-0"),
          battle: damaged
            ? { damage: 20, hp: 60, conditions: { ...NO_CONDITIONS, burned: true } }
            : undefined,
        },
        pokemon("bench-1", "Stage1"),
      ],
      benchLimit,
      prizesRemaining: 0,
      faceUpPrizes: [],
    },
    opponent: { hand: [], active: null, bench: [], prizesRemaining: 0, faceUpPrizes: [] },
  };
  return (
    <div ref={root} data-testid="root">
      <div data-card-anchor="true" data-card-id="dragged" />
      <PlayerSide
        owner="you"
        side="bottom"
        player={board.you}
        benchLimit={benchLimit}
        usedTrainers={usedTrainerOwner === "you" ? usedTrainers : undefined}
      />
      {usedTrainerOwner === "opponent" && (
        <PlayerSide
          owner="opponent"
          side="top"
          player={board.opponent}
          benchLimit={5}
          usedTrainers={usedTrainers}
        />
      )}
      <div data-card-drop-zone="true" data-card-owner="you" data-card-zone="playmat" />
      <button type="button">Other control</button>
      <AnimatedCardsLayer
        board={board}
        turnNumber={1}
        perspectivePlayer="you"
        backDesign="twilight"
        blueBackPlayer={blueBackPlayer}
        playmatRef={root}
        onMoveCard={onMove}
        usableTrainerIds={usableTrainerIds}
        cardSelection={cardSelection}
        placementPredicate={placementPredicateFor({
          phaseKind: "turn:action",
          isViewerTurn,
          isReady: false,
        })}
      />
    </div>
  );
}

beforeAll(installDomShims);
beforeEach(() => {
  mocks.constructed.mockClear();
  ticker.add.mockClear();
  ticker.remove.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const id = this.dataset.cardId;
    const index = this.dataset.cardIndex;
    let x = 0;
    let y = 0;
    let width = 800;
    let height = 600;
    const isActive = id === "active" || this.dataset.cardZone === "active";
    if (this.dataset.usedTrainersDropZone === "true") {
      x = 650;
      y = 100;
      width = 120;
      height = 100;
    } else if (id || this.dataset.cardZone === "bench" || isActive) {
      x = id === "dragged" ? 350 : isActive ? 550 : id === "bench-1" || index === "1" ? 300 : 200;
      y = id === "dragged" ? 400 : isActive ? 100 : 200;
      width = this.dataset.cardZone === "bench" && index === undefined ? 200 : 80;
      height = 100;
    }
    return {
      x,
      y,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height,
      toJSON: () => ({}),
    };
  });
  mocks.createApplication.mockResolvedValue({
    stage: new Container(),
    ticker,
    canvas: document.createElement("canvas"),
    destroy: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function pointer(target: HTMLElement | Window, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(target, event);
}

it("lets a knocked-out selected card finish its shake before removing its view", async () => {
  const onMove = vi.fn();
  const selection: CardSelection = {
    candidates: [],
    selectedIds: ["active", "bench-0"],
    phase: "hold",
    count: 3,
    onSelect: vi.fn(),
  };
  const { rerender } = render(<Scene stage="Basic" onMove={onMove} cardSelection={selection} />);
  await waitFor(() => expect(view("active").target).toBeTruthy());
  const target = view("active");
  rerender(
    <Scene
      stage="Basic"
      onMove={onMove}
      activeRemoved
      cardSelection={{ ...selection, phase: "submitted" }}
    />,
  );
  expect(target.destroy).not.toHaveBeenCalled();
  expect(target.shake).not.toHaveBeenCalled();
  rerender(
    <Scene
      stage="Basic"
      onMove={onMove}
      activeRemoved
      cardSelection={{ ...selection, phase: "shake" }}
    />,
  );
  expect(target.destroy).not.toHaveBeenCalled();
  expect(target.shake).toHaveBeenCalledOnce();
  expect(view("bench-0").shake).toHaveBeenCalledOnce();
  rerender(<Scene stage="Basic" onMove={onMove} activeRemoved />);
  expect(target.destroy).toHaveBeenCalledOnce();
});

it.each([
  ["active", 590, 150, -190, 170],
  ["bench-0", 240, 250, 160, 70],
] as const)(
  "moves %s's damage and status badges with its drag, then returns them on cancellation",
  async (id, x, y, dx, dy) => {
    const onMove = vi.fn();
    const { getByTestId, container, unmount } = render(
      <Scene stage="Basic" onMove={onMove} damaged />,
    );
    await waitFor(() => expect(view(id).target).toBeTruthy());
    const badges = [...container.querySelectorAll<HTMLElement>(`[data-card-badge-for="${id}"]`)];
    const otherId = id === "active" ? "bench-0" : "active";
    const otherBadge = container.querySelector<HTMLElement>(
      `[data-damage-chip][data-card-badge-for="${otherId}"]`,
    );
    expect(badges).toHaveLength(2);
    const root = getByTestId("root");
    pointer(root, "pointerdown", x, y);
    pointer(root, "pointermove", 400, 320);
    const tick = ticker.add.mock.calls[0]?.[0];
    if (!tick) throw new Error("Missing card animation ticker");
    act(() => tick({ deltaMS: 16 } as Ticker));
    for (const badge of badges)
      expect(badge.style.transform).toBe(`translate3d(${dx}px, ${dy}px, 0)`);
    expect(otherBadge?.style.transform).toBe("translate3d(0px, 0px, 0)");
    pointer(window, "pointercancel", 400, 320);
    await waitFor(() => {
      for (const badge of badges) expect(badge.style.transform).toBe("translate3d(0px, 0px, 0)");
    });
    expect(onMove).not.toHaveBeenCalled();
    unmount();
    for (const badge of badges) expect(badge.style.transform).toBe("");
  },
);

it("plays a Trainer dropped over a used card and preserves click-to-open", async () => {
  const onMove = vi.fn();
  const { getByTestId, getByRole, queryByRole, container } = render(
    <Scene
      stage="Basic"
      handType="trainer"
      usedTrainerOwner="you"
      onMove={onMove}
      usableTrainerIds={new Set(["dragged"])}
    />,
  );
  await waitFor(() => expect(view("dragged").target).toBeTruthy());
  const button = getByRole("button", { name: "View 1 Trainer card used this turn" });
  const usedCard = button.querySelector<HTMLElement>("[data-used-trainer-id]");
  if (!usedCard) throw new Error("Missing used Trainer card");
  pointer(getByTestId("root"), "pointerdown", 390, 450);
  pointer(usedCard, "pointermove", 700, 150);
  expect(container.querySelector(".trainer-use-label.is-visible:not(.is-unusable)")).toBeTruthy();
  pointer(usedCard, "pointerup", 700, 150);
  expect(onMove).toHaveBeenCalledExactlyOnceWith({
    cardId: "dragged",
    from: { owner: "you", zone: "hand", index: 0 },
    to: { owner: "you", zone: "playmat" },
  });
  expect(queryByRole("dialog")).toBeNull();
  fireEvent.click(button);
  expect(getByRole("dialog", { name: "Trainer cards used this turn" })).toBeTruthy();
});

it.each([
  {
    handType: "trainer" as const,
    usedTrainerOwner: "you" as const,
    usableTrainerIds: new Set<string>(),
    isViewerTurn: true,
    otherControl: false,
  },
  {
    handType: "trainer" as const,
    usedTrainerOwner: "you" as const,
    usableTrainerIds: new Set(["dragged"]),
    isViewerTurn: false,
    otherControl: false,
  },
  {
    handType: "trainer" as const,
    usedTrainerOwner: "opponent" as const,
    usableTrainerIds: new Set(["dragged"]),
    isViewerTurn: true,
    otherControl: false,
  },
  {
    handType: "energy" as const,
    usedTrainerOwner: "you" as const,
    usableTrainerIds: undefined,
    isViewerTurn: true,
    otherControl: false,
  },
  {
    handType: "trainer" as const,
    usedTrainerOwner: "you" as const,
    usableTrainerIds: new Set(["dragged"]),
    isViewerTurn: true,
    otherControl: true,
  },
])("rejects an unauthorized used-Trainer drop: %j", async ({ otherControl, ...props }) => {
  const onMove = vi.fn();
  const { getByTestId, getByRole } = render(<Scene stage="Basic" onMove={onMove} {...props} />);
  await waitFor(() => expect(view("dragged").target).toBeTruthy());
  const target = getByRole("button", {
    name: otherControl ? "Other control" : "View 1 Trainer card used this turn",
  });
  pointer(getByTestId("root"), "pointerdown", 390, 450);
  pointer(target, "pointermove", 700, 150);
  pointer(target, "pointerup", 700, 150);
  expect(onMove).not.toHaveBeenCalled();
});

it.each([
  ["bench-0", 0, 1, 240, 360],
  ["bench-1", 1, 0, 340, 220],
] as const)(
  "previews and drops %s into a new bench position",
  async (id, fromIndex, toIndex, startX, endX) => {
    const onMove = vi.fn();
    const { getByTestId } = render(<Scene stage="Basic" onMove={onMove} />);
    await waitFor(() => expect(view(id).target).toBeTruthy());
    const sibling = view(fromIndex === 0 ? "bench-1" : "bench-0");
    const previousX = sibling.target.x;
    pointer(getByTestId("root"), "pointerdown", startX, 250);
    pointer(getByTestId("root"), "pointermove", endX, 250);
    expect(sibling.target.x).not.toBe(previousX);
    pointer(window, "pointerup", endX, 250);
    expect(onMove).toHaveBeenCalledExactlyOnceWith({
      cardId: id,
      from: { owner: "you", zone: "bench", index: fromIndex },
      to: { owner: "you", zone: "bench", index: toIndex },
    });
  },
);

it("rejects bench reorder drops during the opponent's turn", async () => {
  const onMove = vi.fn();
  const { getByTestId } = render(<Scene stage="Basic" onMove={onMove} isViewerTurn={false} />);
  await waitFor(() => expect(view("bench-0").target).toBeTruthy());
  pointer(getByTestId("root"), "pointerdown", 240, 250);
  pointer(getByTestId("root"), "pointermove", 360, 250);
  pointer(window, "pointerup", 360, 250);
  expect(onMove).not.toHaveBeenCalled();
});

it.each(["Stage1", "Stage2", "VMAX", "VSTAR"])(
  "keeps Bench cards still and preserves the occupied drop slot for %s",
  async (stage) => {
    const onMove = vi.fn();
    const { getByTestId } = render(<Scene stage={stage} onMove={onMove} />);
    await waitFor(() => expect(view("dragged").target).toBeTruthy());
    const root = getByTestId("root");
    const bench = [view("bench-0"), view("bench-1")];
    const targets = bench.map((card) => card.target);
    for (const card of bench) card.setTarget.mockClear();
    pointer(root, "pointerdown", 390, 450);
    // Right of the first card's center: an erroneous insertion preview
    // would produce index 1 and overwrite this evolution's target index 0.
    pointer(root, "pointermove", 260, 250);
    for (const [index, card] of bench.entries()) {
      expect(card.setTarget).not.toHaveBeenCalled();
      expect(card.target).toEqual(targets[index]);
    }
    pointer(window, "pointerup", 260, 250);
    expect(onMove).toHaveBeenCalledWith({
      cardId: "dragged",
      from: { owner: "you", zone: "hand", index: 0 },
      to: { owner: "you", zone: "bench", index: 0 },
    });
  },
);

it("still opens a new Bench slot for a Basic", async () => {
  const onMove = vi.fn();
  const { getByTestId } = render(<Scene stage="Basic" onMove={onMove} />);
  await waitFor(() => expect(view("dragged").target).toBeTruthy());
  const first = view("bench-0");
  const previousX = first.target.x;
  first.setTarget.mockClear();
  pointer(getByTestId("root"), "pointerdown", 390, 450);
  pointer(getByTestId("root"), "pointermove", 260, 250);
  expect(first.setTarget).toHaveBeenCalled();
  expect(first.target.x).not.toBe(previousX);
  pointer(window, "pointerup", 260, 250);
  expect(onMove).toHaveBeenCalledExactlyOnceWith({
    cardId: "dragged",
    from: { owner: "you", zone: "hand", index: 0 },
    to: { owner: "you", zone: "bench", index: 1 },
  });
});

it("does not open a space or dispatch a Basic over a full Bench", async () => {
  const onMove = vi.fn();
  const { getByTestId } = render(<Scene stage="Basic" onMove={onMove} benchLimit={2} />);
  await waitFor(() => expect(view("dragged").target).toBeTruthy());
  const bench = [view("bench-0"), view("bench-1")];
  for (const card of bench) card.setTarget.mockClear();
  pointer(getByTestId("root"), "pointerdown", 390, 450);
  pointer(getByTestId("root"), "pointermove", 260, 250);
  for (const card of bench) expect(card.setTarget).not.toHaveBeenCalled();
  pointer(window, "pointerup", 260, 250);
  expect(onMove).not.toHaveBeenCalled();
});

it("does not dispatch an evolution dropped onto empty Bench space", async () => {
  const onMove = vi.fn();
  const { getByTestId } = render(<Scene stage="Stage2" onMove={onMove} />);
  await waitFor(() => expect(view("dragged").target).toBeTruthy());
  pointer(getByTestId("root"), "pointerdown", 390, 450);
  pointer(getByTestId("root"), "pointermove", 390, 250);
  pointer(window, "pointerup", 390, 250);
  expect(onMove).not.toHaveBeenCalled();
});

it.each([
  ["you", 0x2695ff, "blue"],
  ["opponent", 0xff3456, "red"],
] as const)(
  "glows only the ability's caster in the %s player's color",
  async (blueBackPlayer, color, tone) => {
    const onMove = vi.fn();
    const selection: CardSelection = {
      candidates: [pokemon("bench-0")],
      selectedIds: [],
      abilityCardId: "active",
      phase: "choose",
      count: 3,
      onSelect: vi.fn(),
    };
    const { container, rerender } = render(
      <Scene
        stage="Basic"
        onMove={onMove}
        blueBackPlayer={blueBackPlayer}
        cardSelection={selection}
      />,
    );
    await waitFor(() => expect(view("active").target).toBeTruthy());
    expect(view("active").setAbilityGlow).toHaveBeenLastCalledWith(color);
    expect(view("active").setSelected).toHaveBeenLastCalledWith(false);
    expect(
      container.querySelector('[data-card-id="active"]')?.getAttribute("data-adrena-ability-glow"),
    ).toBe(tone);
    rerender(
      <Scene
        stage="Basic"
        onMove={onMove}
        blueBackPlayer={blueBackPlayer}
        cardSelection={{ ...selection, selectedIds: ["active", "bench-0"], phase: "shake" }}
      />,
    );
    expect(view("active").setAbilityGlow).toHaveBeenLastCalledWith(color);
    expect(view("bench-0").setAbilityGlow).toHaveBeenLastCalledWith(null);
    rerender(<Scene stage="Basic" onMove={onMove} blueBackPlayer={blueBackPlayer} />);
    expect(view("active").setAbilityGlow).toHaveBeenLastCalledWith(null);
    expect(container.querySelector("[data-adrena-ability-glow]")).toBeNull();
  },
);

it("juices selected Adrena-Brain cards, shakes both once, and disables drags during targeting", async () => {
  const onMove = vi.fn();
  const onSelect = vi.fn();
  const selection: CardSelection = {
    candidates: [pokemon("active")],
    selectedIds: [],
    phase: "choose",
    count: 3,
    onSelect,
  };
  const { getByTestId, getByRole, rerender } = render(
    <Scene stage="Basic" onMove={onMove} cardSelection={selection} />,
  );
  await waitFor(() => expect(view("active").target).toBeTruthy());
  const button = getByRole("button", { name: "Select active for Adrena-Brain" });
  expect(button.style.left).toBe("590px");
  expect(button.style.top).toBe("150px");
  pointer(button, "pointermove", 590, 150);
  expect(view("active").setHovered).toHaveBeenLastCalledWith(true);
  expect(view("active").updateHoverPoint).toHaveBeenLastCalledWith({ x: 590, y: 150 });
  pointer(button, "pointerdown", 590, 150);
  pointer(button, "pointermove", 595, 155);
  pointer(window, "pointerup", 595, 155);
  expect(view("active").isDragging).toBe(false);
  expect(onMove).not.toHaveBeenCalled();
  pointer(getByRole("button", { name: "Other control" }), "pointermove", 590, 150);
  expect(view("active").setHovered).toHaveBeenLastCalledWith(false);
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("active");
  pointer(getByTestId("root"), "pointerdown", 390, 450);
  pointer(getByTestId("root"), "pointermove", 260, 250);
  pointer(window, "pointerup", 260, 250);
  expect(onMove).not.toHaveBeenCalled();
  const selected = {
    ...selection,
    candidates: [],
    selectedIds: ["active", "bench-0"],
    phase: "hold" as const,
  };
  rerender(<Scene stage="Basic" onMove={onMove} cardSelection={selected} />);
  expect(view("active").setSelected).toHaveBeenLastCalledWith(true);
  expect(view("bench-0").setSelected).toHaveBeenLastCalledWith(true);
  expect(view("active").shake).not.toHaveBeenCalled();
  const shaking = { ...selected, phase: "shake" as const };
  rerender(<Scene stage="Basic" onMove={onMove} cardSelection={shaking} />);
  rerender(<Scene stage="Basic" onMove={onMove} cardSelection={{ ...shaking }} />);
  expect(view("active").shake).toHaveBeenCalledOnce();
  expect(view("bench-0").shake).toHaveBeenCalledOnce();
  rerender(<Scene stage="Basic" onMove={onMove} />);
  expect(view("active").setSelected).toHaveBeenLastCalledWith(false);
  expect(view("bench-0").setSelected).toHaveBeenLastCalledWith(false);
});

it.each([
  ["Stage1", "bench-0", 260],
  ["Stage2", "bench-1", 360],
] as const)(
  "shakes the valid %s host once per entry without moving its slot",
  async (stage, targetId, x) => {
    const { getByTestId } = render(<Scene stage={stage} targets={[targetId]} onMove={vi.fn()} />);
    await waitFor(() => expect(view("dragged").target).toBeTruthy());
    const root = getByTestId("root");
    const host = view(targetId);
    const originalTarget = host.target;
    host.setTarget.mockClear();
    pointer(root, "pointerdown", 390, 450);
    pointer(root, "pointermove", x, 250);
    pointer(root, "pointermove", x + 2, 250);
    expect(host.shake).toHaveBeenCalledOnce();
    expect(host.setTarget).not.toHaveBeenCalled();
    expect(host.target).toEqual(originalTarget);
    pointer(root, "pointermove", 390, 250);
    pointer(root, "pointermove", x, 250);
    expect(host.shake).toHaveBeenCalledTimes(2);
    pointer(window, "pointerup", x, 250);
    pointer(root, "pointermove", x, 250);
    expect(host.shake).toHaveBeenCalledTimes(2);
  },
);

it.each([
  ["Stage1", "Basic"],
  ["Stage2", "Stage1"],
])("shakes the real Active slot for a legal %s evolution onto %s", async (stage, activeStage) => {
  const onMove = vi.fn();
  const { getByTestId } = render(
    <Scene stage={stage} activeStage={activeStage} targets={["active"]} onMove={onMove} />,
  );
  await waitFor(() => expect(view("dragged").target).toBeTruthy());
  const root = getByTestId("root");
  const active = view("active");
  const originalTarget = active.target;
  active.setTarget.mockClear();
  pointer(root, "pointerdown", 390, 450);
  pointer(root, "pointermove", 590, 150);
  pointer(root, "pointermove", 592, 152);
  expect(active.shake).toHaveBeenCalledOnce();
  expect(active.target).toEqual(originalTarget);
  expect(active.setTarget).not.toHaveBeenCalled();
  expect(view("bench-0").shake).not.toHaveBeenCalled();
  expect(view("bench-1").shake).not.toHaveBeenCalled();
  pointer(window, "pointerup", 590, 150);
  expect(onMove).toHaveBeenCalledWith({
    cardId: "dragged",
    from: { owner: "you", zone: "hand", index: 0 },
    to: { owner: "you", zone: "active" },
  });
});

it.each([true, false])(
  "does not shake incompatible hosts or off-turn targets (own turn: %s)",
  async (isViewerTurn) => {
    const { getByTestId } = render(
      <Scene
        stage="Stage2"
        targets={isViewerTurn ? [] : ["active", "bench-0"]}
        isViewerTurn={isViewerTurn}
        onMove={vi.fn()}
      />,
    );
    await waitFor(() => expect(view("dragged").target).toBeTruthy());
    const root = getByTestId("root");
    pointer(root, "pointerdown", 390, 450);
    pointer(root, "pointermove", 260, 250);
    pointer(root, "pointermove", 390, 250);
    pointer(root, "pointermove", 590, 150);
    for (const id of ["active", "bench-0", "bench-1"])
      expect(view(id).shake).not.toHaveBeenCalled();
  },
);
