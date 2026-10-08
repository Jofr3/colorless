// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Container, type Ticker } from "pixi.js";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import type { CardViewTarget } from "../pixi/CardView";
import type { BoardState, CardModel, PlayerId } from "../types";
import { prizeSlots } from "../utils/piles";
import { AnimatedCardsLayer } from "./AnimatedCardsLayer";

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  createApplication: vi.fn(),
  stage: vi.fn(),
}));
vi.mock("../../../lib/pixi/createPixiApplication", () => ({
  createPixiApplication: mocks.createApplication,
}));
vi.mock("../../../lib/animation/gsapPixi", () => ({ ensureGsapPixi: vi.fn() }));
vi.mock("../pixi/CardView", () => ({
  CardView: class {
    id: string;
    textureUrl: string;
    container = new Container();
    target: CardViewTarget | null = null;
    isDragging = false;
    constructor({ id, textureUrl }: { id: string; textureUrl: string }) {
      this.id = id;
      this.textureUrl = textureUrl;
      mocks.constructed(this);
    }
    setTarget = vi.fn((target: CardViewTarget) => {
      this.target = target;
      this.container.visible = true;
    });
    setRenderParent = (parent: Container) => {
      if (this.container.parent !== parent) parent.addChild(this.container);
    };
    getTargetSnapshot = () => this.target;
    getPosition = () => ({ x: this.target?.x ?? 0, y: this.target?.y ?? 0 });
    slingTo = vi.fn();
    destroy = vi.fn(() => this.container.destroy());
    setHovered = vi.fn();
    stopPress = vi.fn();
    setPresentationOptions = vi.fn();
    setTextureUrl = vi.fn();
    setReducedMotion = vi.fn();
    setPlaymatSize = vi.fn();
    hide = vi.fn(() => {
      this.container.visible = false;
    });
    update = vi.fn();
  },
}));
interface TestView {
  id: string;
  textureUrl: string;
  container: Container;
  target: CardViewTarget | null;
  setTextureUrl: ReturnType<typeof vi.fn>;
  setTarget: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}
const card = (id: string): CardModel => ({
  id,
  cardId: id,
  name: id,
  type: "trainer",
  imageUrl: `${id}.png`,
});
function Scene({ awarded = false, owner = "you" }: { awarded?: boolean; owner?: PlayerId }) {
  const root = useRef<HTMLDivElement>(null);
  const side = {
    hand: [card("existing")],
    active: null,
    bench: [],
    prizesRemaining: 2,
    faceUpPrizes: [],
  };
  const board: BoardState = {
    stadium: null,
    you: { ...side },
    opponent: { ...side },
    [owner]: {
      ...side,
      hand: awarded ? [...side.hand, card("prize-1"), card("prize-2")] : side.hand,
      prizesRemaining: awarded ? 0 : 2,
    },
  };
  return (
    <div ref={root} data-testid="root">
      {(["you", "opponent"] as const).map((player) => (
        <div key={player}>
          <div data-card-anchor="true" data-card-id={`back-deck-${player}`} />
          {prizeSlots(board[player].prizesRemaining, player === "opponent").map(
            (present, index) => (
              <div key={index} data-prize-source={index} data-card-owner={player}>
                {present && (
                  <div data-card-anchor="true" data-card-id={`back-prize-${player}-${index}`} />
                )}
              </div>
            ),
          )}
        </div>
      ))}
      {board.you.hand.map((model) => (
        <div key={model.id} data-card-anchor="true" data-card-id={model.id} />
      ))}
      <AnimatedCardsLayer
        board={board}
        perspectivePlayer="you"
        backDesign="twilight"
        turnNumber={2}
        playmatRef={root}
        onMoveCard={() => {}}
        onSetupAnimationChange={mocks.stage}
      />
    </div>
  );
}
const ticker = { add: vi.fn<(callback: (ticker: Ticker) => void) => void>(), remove: vi.fn() };
let time = 1000;
function advance(seconds: number) {
  time += seconds * 1000;
  const tick = ticker.add.mock.calls[0]?.[0];
  if (!tick) throw new Error("Missing ticker");
  act(() => tick({ deltaMS: 16 } as Ticker));
}
function view(id: string): TestView {
  const found = mocks.constructed.mock.calls.find(([candidate]) => candidate.id === id)?.[0] as
    | TestView
    | undefined;
  if (!found) throw new Error(`Missing ${id}`);
  return found;
}
beforeAll(installDomShims);
beforeEach(() => {
  time = 1000;
  mocks.constructed.mockClear();
  mocks.stage.mockClear();
  ticker.add.mockClear();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const prizeSlot = this.dataset.prizeSource;
    const left =
      this.dataset.testid === "root"
        ? 0
        : prizeSlot !== undefined
          ? 600 + Number(prizeSlot) * 50
          : this.dataset.cardId?.startsWith("back-deck")
            ? 100
            : 400;
    const top = this.dataset.testid === "root" ? 0 : prizeSlot !== undefined ? 300 : 700;
    return {
      x: left,
      y: top,
      left,
      top,
      right: left + 40,
      bottom: top + 60,
      width: 40,
      height: 60,
      toJSON: () => ({}),
    };
  });
  mocks.createApplication.mockImplementation(async () => ({
    stage: new Container(),
    ticker,
    canvas: document.createElement("canvas"),
    destroy: vi.fn(),
    render: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Prize cards flying to the hand", () => {
  it("staggers the final two prizes from their empty grid slots, reveals them on landing and restores the hand", async () => {
    const { rerender } = render(<Scene />);
    await waitFor(() => expect(view("existing").setTarget).toHaveBeenCalled());
    rerender(<Scene awarded />);
    const first = view("setup-deal-1");
    const second = view("setup-deal-2");
    expect(mocks.stage).toHaveBeenLastCalledWith("prize-take");
    expect(view("prize-1").container.visible).toBe(false);
    expect(view("prize-2").container.visible).toBe(false);
    advance(0);
    expect(first.target?.x).toBe(620);
    expect(first.target?.y).toBe(330);
    expect(first.target?.placement).toEqual({ owner: "you", zone: "hand", index: 1 });
    expect(second.setTarget).not.toHaveBeenCalled();
    advance(0.1);
    expect(second.setTarget).toHaveBeenCalled();
    expect(first.setTextureUrl).not.toHaveBeenCalled();
    advance(0.36);
    expect(first.setTextureUrl).toHaveBeenCalledWith("prize-1.png");
    advance(0.41);
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(view("prize-1").container.visible).toBe(true);
    expect(second.destroy).not.toHaveBeenCalled();
    advance(0.1);
    expect(second.destroy).toHaveBeenCalledOnce();
    expect(view("prize-2").container.visible).toBe(true);
    expect(mocks.stage).toHaveBeenLastCalledWith(null);
  });

  it("sends opponents' prizes toward their hidden hand without revealing card faces", async () => {
    const { rerender } = render(<Scene owner="opponent" />);
    await waitFor(() => expect(view("existing").setTarget).toHaveBeenCalled());
    rerender(<Scene owner="opponent" awarded />);
    const flight = view("setup-deal-1");
    advance(0);
    expect(flight.target?.x).toBe(820); // top grid's first occupied slot (4)
    advance(0.46);
    expect(flight.target?.y).toBeLessThan(330);
    expect(flight.setTextureUrl).not.toHaveBeenCalled();
    advance(0.5);
    expect(flight.destroy).toHaveBeenCalledOnce();
  });

  it("collects without flights when reduced motion is requested", async () => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    vi.spyOn(window, "matchMedia").mockReturnValue({ ...media, matches: true });
    const { rerender } = render(<Scene />);
    await waitFor(() => expect(view("existing").setTarget).toHaveBeenCalled());
    rerender(<Scene awarded />);
    expect(
      mocks.constructed.mock.calls.some(([candidate]) => candidate.id.startsWith("setup-deal")),
    ).toBe(false);
    expect(view("prize-1").container.visible).toBe(true);
    expect(mocks.stage).not.toHaveBeenCalled();
  });
});
