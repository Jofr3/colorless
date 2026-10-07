// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Container } from "pixi.js";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { placementPredicateFor } from "../../game/placement";
import type { CardViewTarget } from "../pixi/CardView";
import type { BoardState, CardModel, CardMoveRequest } from "../types";
import { AnimatedCardsLayer } from "./AnimatedCardsLayer";
import { PlayerSide } from "./PlayerSide";

const mocks = vi.hoisted(() => ({ constructed: vi.fn(), createApplication: vi.fn() }));
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
    destroy = () => this.container.destroy();
    setHovered = vi.fn();
    updateHoverPoint = vi.fn();
    shake = vi.fn();
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
}
function view(id: string): TestView {
  const found = mocks.constructed.mock.calls.find(([candidate]) => candidate.id === id)?.[0];
  if (!found) throw new Error(`Missing view ${id}`);
  return found as TestView;
}
function pokemon(id: string, stage = "Basic"): CardModel {
  return { id, name: id, cardId: id, type: "pokemon", stage };
}
function Scene({
  stage,
  onMove,
  targets = [],
  isViewerTurn = true,
  activeStage = "Basic",
}: {
  stage: string;
  onMove: (move: CardMoveRequest) => void;
  targets?: readonly string[];
  isViewerTurn?: boolean;
  activeStage?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const board: BoardState = {
    stadium: null,
    you: {
      hand: [{ ...pokemon("dragged", stage), evolutionTargetIds: targets }],
      active: pokemon("active", activeStage),
      bench: [pokemon("bench-0"), pokemon("bench-1", "Stage1")],
      prizesRemaining: 0,
      faceUpPrizes: [],
    },
    opponent: { hand: [], active: null, bench: [], prizesRemaining: 0, faceUpPrizes: [] },
  };
  return (
    <div ref={root} data-testid="root">
      <div data-card-anchor="true" data-card-id="dragged" />
      <PlayerSide owner="you" side="bottom" player={board.you} benchLimit={5} />
      <AnimatedCardsLayer
        board={board}
        turnNumber={1}
        perspectivePlayer="you"
        backDesign="twilight"
        playmatRef={root}
        onMoveCard={onMove}
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
    if (id || this.dataset.cardZone === "bench" || isActive) {
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
    ticker: { add: vi.fn(), remove: vi.fn() },
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
  const { getByTestId } = render(<Scene stage="Basic" onMove={vi.fn()} />);
  await waitFor(() => expect(view("dragged").target).toBeTruthy());
  const first = view("bench-0");
  const previousX = first.target.x;
  first.setTarget.mockClear();
  pointer(getByTestId("root"), "pointerdown", 390, 450);
  pointer(getByTestId("root"), "pointermove", 260, 250);
  expect(first.setTarget).toHaveBeenCalled();
  expect(first.target.x).not.toBe(previousX);
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
