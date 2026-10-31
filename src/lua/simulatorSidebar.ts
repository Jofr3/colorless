import { otherSeat, type GameAction } from "@colorless/engine";
import type { RedactedGame } from "@colorless/schema";
import type { HistoryStep, TableSource } from "./tableSource";
import type { SimMenu, SimOption, ThemeColour } from "./simulatorTypes";

/** What the sidebar's buttons reach on the table (LuaSimulator). */
export interface SidebarHost {
  action(label: string, action: GameAction, colour?: ThemeColour): SimOption;
  command(raw: string): void;
  history(type: HistoryStep): void;
}

/** A hot-seat prompt (a promotion, a card's choice) keeps Undo and Redo,
 * which step out of it without answering. */
export function withHistory(host: SidebarHost, src: TableSource | null, menu: SimMenu): SimMenu {
  const history = src?.history;
  if (!history || !menu.mandatory || menu.kind === "coin") return menu;
  const step = (label: string, type: "undoAction" | "redoAction"): SimOption => ({
    label,
    colour: "red",
    disabled: !history.canStep(type),
    run: () => host.history(type),
  });
  return {
    ...menu,
    footer: [...(menu.footer ?? []), step("Undo", "undoAction"), step("Redo", "redoAction")],
  };
}

/** Both seats at one table: either player's choices, plus the game's history. */
export function hotSeatSidebar(host: SidebarHost, v: RedactedGame, src: TableSource): SimOption[] {
  const seat = v.seat;
  const p = v.phase;
  const flags = src.lifecycle().flags;
  const newGame = (slot: SimOption["slot"]): SimOption[] =>
    flags.includes("newgame")
      ? [{ label: "New game", colour: "red", slot, run: () => host.command("newgame") }]
      : [];
  const step = (
    label: string,
    type: "undoAction" | "redoAction" | "undoTurn" | "redoTurn",
  ): SimOption => ({
    label,
    colour: "red",
    slot: "minor",
    disabled: !src.history?.canStep(type),
    run: () => host.history(type),
  });
  // The undo/redo row, on the setup screens as well as the turn.
  const history: SimOption[] = flags.includes("undo")
    ? [
        step("Undo turn", "undoTurn"),
        step("Undo action", "undoAction"),
        ...newGame("minor"),
        step("Redo action", "redoAction"),
        step("Redo turn", "redoTurn"),
      ]
    : [];
  if (p.kind === "setup:chooseFirst")
    return [
      {
        ...host.action("P1 first", { type: "chooseFirstPlayer", seat, first: "p1" }),
        slot: "primary",
      },
      {
        ...host.action("P2 first", { type: "chooseFirstPlayer", seat, first: "p2" }),
        slot: "primary",
      },
      {
        ...host.action(
          "Random",
          {
            type: "chooseFirstPlayer",
            seat,
            // The coin winner is the seat waited on.
            first: v.waitingOn === "opponent" ? otherSeat(seat) : seat,
          },
          "red",
        ),
        slot: "minor",
      },
      ...history,
    ];
  if (p.kind === "setup:place")
    return [
      {
        ...host.action("Ready", { type: "setupReady", seat }, seat === "p2" ? "red" : "blue"),
        slot: "primary",
      },
      ...history,
    ];
  // Attacks, Retreat and Abilities live on the Active card's attached
  // buttons; the panel keeps End turn and the undo/redo history.
  if (p.kind === "turn:action")
    return [
      { ...host.action("End turn", { type: "endTurn", seat }, "red"), slot: "primary" },
      ...history,
    ];
  if (p.kind === "gameOver") return newGame("danger");
  return [];
}

/** One seat against a remote player: only this seat's decisions; Rematch once it is over. */
export function remoteSidebar(host: SidebarHost, v: RedactedGame, src: TableSource): SimOption[] {
  const seat = v.seat;
  const p = v.phase;
  const flags = src.lifecycle().flags;
  if (p.kind === "setup:chooseFirst" && v.waitingOn === "you")
    return [
      {
        ...host.action("Go first", { type: "chooseFirstPlayer", seat, first: seat }),
        slot: "primary",
      },
      {
        ...host.action("Go second", { type: "chooseFirstPlayer", seat, first: otherSeat(seat) }),
        slot: "primary",
      },
    ];
  if (p.kind === "setup:place" && !p.ready.you)
    return [
      {
        ...host.action("Ready", { type: "setupReady", seat }, seat === "p2" ? "red" : "blue"),
        slot: "primary",
      },
    ];
  if (p.kind === "turn:action" && v.activePlayer === "you")
    return [{ ...host.action("End turn", { type: "endTurn", seat }, "red"), slot: "primary" }];
  if (flags.includes("rematch")) {
    const sent = flags.includes("rematch-sent");
    return [
      {
        label: sent ? "Waiting..." : "Rematch",
        colour: "red",
        slot: "danger",
        disabled: sent,
        run: () => host.command("rematch"),
      },
    ];
  }
  return [];
}
