// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Container, type Ticker } from "pixi.js";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import type { CardViewTarget } from "../pixi/CardView";
import type { BoardState, CardModel, PileState, PlayerId } from "../types";
import { AnimatedCardsLayer } from "./AnimatedCardsLayer";

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
    isDragging = false;
    constructor({ id }: { id: string }) {
      this.id = id;
      mocks.constructed(this);
    }
    setTarget = vi.fn((target: CardViewTarget) => {
      this.target = target;
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
    hide = vi.fn();
    update = vi.fn();
  },
}));

interface TestView {
  id: string;
  slingTo: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setPresentationOptions: ReturnType<typeof vi.fn>;
  setTarget: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}
const energy = (id: string): CardModel => ({ id, name: id, cardId: id, type: "energy" });
function state(discarded = false, multiple = false) {
  const energies = discarded
    ? [energy("kept")]
    : [energy("paid"), ...(multiple ? [energy("paid-2")] : []), energy("kept")];
  const active: CardModel = {
    id: "active",
    name: "Active",
    cardId: "active",
    type: "pokemon",
    attached: { tools: [], energies },
  };
  const bench: CardModel = { id: "bench", name: "Bench", cardId: "bench", type: "pokemon" };
  const board: BoardState = {
    stadium: null,
    you: {
      hand: [],
      active: discarded ? bench : active,
      bench: [discarded ? active : bench],
      prizesRemaining: 0,
      faceUpPrizes: [],
    },
    opponent: { hand: [], active: null, bench: [], prizesRemaining: 0, faceUpPrizes: [] },
  };
  const piles: Record<PlayerId, PileState> = {
    you: {
      deckCount: 40,
      discard: discarded ? [energy("paid"), ...(multiple ? [energy("paid-2")] : [])] : [],
    },
    opponent: { deckCount: 40, discard: [] },
  };
  return { board, piles };
}
function Scene({
  discarded = false,
  multiple = false,
}: { discarded?: boolean; multiple?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const { board, piles } = state(discarded, multiple);
  return (
    <div ref={root}>
      {[board.you.active, ...board.you.bench]
        .flatMap((card) => (card ? [card, ...(card.attached?.energies ?? [])] : []))
        .map((card) => (
          <div key={card.id} data-card-anchor="true" data-card-id={card.id} />
        ))}
      <div data-card-pile="discard" data-card-owner="you">
        <div>
          <button type="button">Discard</button>
        </div>
      </div>
      <AnimatedCardsLayer
        board={board}
        piles={piles}
        turnNumber={1}
        perspectivePlayer="you"
        backDesign="twilight"
        playmatRef={root}
        onMoveCard={() => {}}
      />
    </div>
  );
}
const ticker = {
  add: vi.fn<(callback: (ticker: Ticker) => void) => void>(),
  remove: vi.fn(),
};
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
  ticker.add.mockClear();
  ticker.remove.mockClear();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const pile = this.tagName === "BUTTON";
    return {
      x: pile ? 600 : 200,
      y: pile ? 400 : 100,
      left: pile ? 600 : 200,
      top: pile ? 400 : 100,
      right: pile ? 680 : 240,
      bottom: pile ? 510 : 155,
      width: pile ? 80 : 40,
      height: pile ? 110 : 55,
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

describe("discarded attached Energy animation", () => {
  it("staggers multiple energies and cleans each up after its own landing", async () => {
    const { rerender } = render(<Scene multiple />);
    await waitFor(() => expect(mocks.constructed.mock.calls.length).toBeGreaterThan(0));
    const first = view("paid");
    const second = view("paid-2");
    await waitFor(() => expect(second.setTarget).toHaveBeenCalled());
    rerender(<Scene discarded multiple />);
    advance(0.016);
    expect(first.slingTo).toHaveBeenCalledOnce();
    expect(second.slingTo).not.toHaveBeenCalled();
    advance(0.08);
    expect(second.slingTo).toHaveBeenCalledOnce();
    advance(0.56);
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).not.toHaveBeenCalled();
    advance(0.1);
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it("retains the removed Energy view, flies to the discard, then destroys it", async () => {
    const { rerender } = render(<Scene />);
    await waitFor(() => expect(mocks.constructed.mock.calls.length).toBeGreaterThan(0));
    const paid = view("paid");
    await waitFor(() => expect(paid.setTarget).toHaveBeenCalled());
    const kept = view("kept");
    rerender(<Scene discarded />);
    expect(paid.destroy).not.toHaveBeenCalled();
    expect(paid.setPresentationOptions).toHaveBeenLastCalledWith({ slotLocked: true });
    expect(paid.setTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 20, y: 27.5, zIndex: 10_000 }),
      true,
    );
    advance(0.016);
    expect(paid.slingTo).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 440,
        y: 355,
        width: 80,
        height: 110,
        placement: { owner: "you", zone: "stadium" },
      }),
    );
    expect(paid.update).toHaveBeenCalled();
    expect(kept.slingTo).not.toHaveBeenCalled();
    advance(0.7);
    expect(paid.destroy).toHaveBeenCalledOnce();
    expect(kept.destroy).not.toHaveBeenCalled();
  });

  it("disposes an unfinished flight when the layer unmounts", async () => {
    const { rerender, unmount } = render(<Scene />);
    await waitFor(() => expect(mocks.constructed.mock.calls.length).toBeGreaterThan(0));
    const paid = view("paid");
    await waitFor(() => expect(paid.setTarget).toHaveBeenCalled());
    rerender(<Scene discarded />);
    expect(paid.destroy).not.toHaveBeenCalled();
    unmount();
    expect(paid.destroy).toHaveBeenCalledOnce();
  });

  it("uses the immediate discard update with reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const { rerender } = render(<Scene />);
    await waitFor(() => expect(mocks.constructed.mock.calls.length).toBeGreaterThan(0));
    const paid = view("paid");
    await waitFor(() => expect(paid.setTarget).toHaveBeenCalled());
    rerender(<Scene discarded />);
    expect(paid.destroy).toHaveBeenCalledOnce();
    expect(paid.slingTo).not.toHaveBeenCalled();
  });
});
