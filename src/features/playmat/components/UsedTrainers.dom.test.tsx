// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { seatLogEntrySchema } from "@luminous/schema";
import { installDomShims } from "../../../test/domShims";
import { viewLogEntries } from "../../game/viewLog";
import { initialBoard } from "../data/mockPlaymat";
import { PlayerSide } from "./PlayerSide";
import { usedTrainersForTurn } from "../utils/usedTrainers";
import type { LogEntry } from "../types";
import { UsedTrainers } from "./UsedTrainers";

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const play = (id: string, cardId: string, name: string): LogEntry => ({
  kind: "action",
  who: "you",
  elapsed: "+00:01",
  segments: [{ text: `played ${name}` }],
  playedTrainer: { id, cardId, name },
});
const log: LogEntry[] = [
  { kind: "turn", turn: 2 },
  play("old", "sv01-181", "Nest Ball"),
  { kind: "turn", turn: 3 },
  play("ball-1", "sv01-196", "Ultra Ball"),
  play("ball-2", "sv01-196", "Ultra Ball"),
  play("supporter", "sv01-189", "Professor's Research"),
  // A recovered physical card played again is another use, not a deduplicated image.
  play("ball-1", "sv01-196", "Ultra Ball"),
];

function side(turn: number, entries = log) {
  return (
    <PlayerSide
      owner="you"
      side="bottom"
      player={initialBoard.you}
      benchLimit={5}
      usedTrainers={{ turn, cards: usedTrainersForTurn(entries, turn) }}
    />
  );
}

it("animates each used card at rest, on arrival, on hover, and on press", () => {
  vi.useFakeTimers({ toFake: ["performance", "requestAnimationFrame", "cancelAnimationFrame"] });
  const { container, unmount } = render(
    <UsedTrainers cards={usedTrainersForTurn(log, 3)} owner="you" />,
  );
  const layers = [...container.querySelectorAll<HTMLElement>(".used-trainers__juice")];
  expect(layers).toHaveLength(4);
  const initialMotion = layers.map((layer) => layer.style.getPropertyValue("--idle-y"));
  for (const layer of layers)
    expect(Number(layer.style.getPropertyValue("--js"))).not.toBe(1);
  act(() => vi.advanceTimersByTime(48));
  layers.forEach((layer, index) => {
    expect(layer.style.getPropertyValue("--idle-y")).not.toBe(initialMotion[index]);
  });
  const surface = container.querySelector<HTMLElement>(".used-trainers__surface");
  if (!surface) throw new Error("Missing animated used Trainer surface");
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 140,
  } as DOMRect);
  fireEvent.pointerEnter(surface);
  expect(Number(surface.style.getPropertyValue("--s"))).toBeGreaterThan(1);
  const move = new MouseEvent("pointermove", { bubbles: true, clientX: 90, clientY: 10 });
  fireEvent(surface, move);
  act(() => vi.advanceTimersByTime(32));
  expect(Number.parseFloat(surface.style.getPropertyValue("--rx"))).toBeGreaterThan(0);
  expect(Number.parseFloat(surface.style.getPropertyValue("--ry"))).toBeGreaterThan(0);
  fireEvent.pointerLeave(surface);
  expect(surface.style.getPropertyValue("--s")).toBe("1");
  expect(surface.style.getPropertyValue("--rx")).toBe("0deg");
  fireEvent.pointerDown(surface);
  expect(Number(layers[0]?.style.getPropertyValue("--js"))).not.toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps used cards still with reduced motion and still opens the gallery", () => {
  const matchMedia = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    ...matchMedia(query),
    matches: true,
  }));
  const { container } = render(<UsedTrainers cards={usedTrainersForTurn(log, 3)} owner="you" />);
  const layer = container.querySelector<HTMLElement>(".used-trainers__juice");
  expect(layer?.style.getPropertyValue("--js")).toBe("1");
  expect(layer?.style.getPropertyValue("--idle-y")).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /View 4 Trainer/ }));
  expect(screen.getByRole("dialog", { name: "Trainer cards used this turn" })).toBeTruthy();
});

it("shows only the selected turn's plays and opens every use in play order", () => {
  render(side(3));
  fireEvent.click(screen.getByRole("button", { name: "View 4 Trainer cards used this turn" }));
  const dialog = screen.getByRole("dialog", { name: "Trainer cards used this turn" });
  expect(
    within(dialog)
      .getAllByRole("img")
      .map((image) => image.getAttribute("alt")),
  ).toEqual(["Ultra Ball", "Ultra Ball", "Professor's Research", "Ultra Ball"]);
  fireEvent.click(screen.getByRole("button", { name: "Close used Trainer cards" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("updates the open gallery, dismisses with Escape or backdrop, and resets on turn change", () => {
  const { rerender } = render(side(3));
  const open = () => fireEvent.click(screen.getByRole("button", { name: /View .* Trainer/ }));
  open();
  rerender(side(3, [...log, play("stadium", "sv01-167", "Beach Court")]));
  expect(within(screen.getByRole("dialog")).getAllByRole("img")).toHaveLength(5);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  open();
  fireEvent.click(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).toBeNull();
  open();
  rerender(side(4));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: /View .* Trainer/ })).toBeNull();
  rerender(side(2));
  expect(screen.getByRole("button", { name: "View 1 Trainer card used this turn" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps public Trainer identity through wire validation, reload, and viewer changes", () => {
  const wire = { ...play("tool", "sv01-197", "Vitality Band"), who: "p2" };
  const restored = seatLogEntrySchema.parse(JSON.parse(JSON.stringify(wire)));
  const entries = viewLogEntries([{ kind: "turn", turn: 3 }, restored], "p1");
  expect(usedTrainersForTurn(entries, 3).map((card) => card.name)).toEqual(["Vitality Band"]);
  expect(
    usedTrainersForTurn([{ kind: "action", who: "you", elapsed: "", segments: [] }], 3),
  ).toEqual([]);
  expect(usedTrainersForTurn(log, 0)).toEqual([]);
});
