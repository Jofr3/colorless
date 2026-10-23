import { otherSeat, type GameAction, type PokemonTarget, type PokemonRef } from "@colorless/engine";
import type { RedactedCard, RedactedGame } from "@colorless/schema";
import { decodeFields } from "./wire";
import type { LocalGameSetup } from "../game/localHost";
import { moveToAction } from "../game/moveToAction";
import { loadSimulatorSave, clearSimulatorSave } from "../game/simulatorSave";
import { effectMenu } from "./simulatorChoices";
import { viewLogEntries } from "../game/viewLog";
import { usedTrainersForTurn } from "../game/usedTrainers";
import { SimulatorOrder } from "./simulatorOrder";
import { LUA_ART_SLOTS } from "./artworkCache";
import { LocalTableSource, type HistoryStep, type TableSource } from "./tableSource";
import { LuaOnlineMatch, onlineGate } from "./onlineTable";
import {
  boardRows,
  cardActionRows,
  EmitFrame,
  type EmitEvents,
  type EmitState,
  headerRow,
  infoRows,
  menuRows,
  sidebarRows,
  type TablePiles,
  tableRows,
} from "./simulatorRows";

const HISTORY_COMMANDS = new Map<string, HistoryStep>([
  ["previous", "previousTurn"],
  ["next", "nextTurn"],
  ["undoAction", "undoAction"],
  ["redoAction", "redoAction"],
  ["undoTurn", "undoTurn"],
  ["redoTurn", "redoTurn"],
]);

/** Where a pending Rare Candy lands when hand card `uid` is dropped on
    `zone`/`index`, or null when that drop is not one of the phase's options. */
export function rareCandyTarget(
  phase: RedactedGame["phase"],
  zone: string | undefined,
  index: string | undefined,
  uid: string,
): PokemonTarget | null {
  const target: PokemonTarget | null =
    zone === "active"
      ? { spot: "active" }
      : zone === "bench" && Number.isInteger(Number(index))
        ? { spot: "bench", index: Number(index) }
        : null;
  if (!target || phase.kind !== "turn:action") return null;
  const matches = phase.rareCandy.some(
    (option) =>
      option.target.spot === target.spot &&
      (option.target.spot !== "bench" ||
        (target.spot === "bench" && option.target.index === target.index)) &&
      option.stage2.some((e) => e.uid === uid),
  );
  return matches ? target : null;
}

/** A colour key of frontend/lua/ui/theme.lua; Lua falls back to blue for unknown keys. */
export type ThemeColour =
  | "red"
  | "blue"
  | "green"
  | "gold"
  | "orange"
  | "paleGreen"
  | "tray"
  | "profile"
  | "ink"
  | "panel"
  | "white"
  | "paper"
  | "jokerGrey"
  | "grey"
  | "textDark"
  | "money"
  | "paleGold"
  | "purple";
export interface SimOption {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** Visual de-emphasis without blocking selection replacement. */
  dimmed?: boolean;
  selected?: boolean;
  card?: RedactedCard;
  colour?: ThemeColour;
  /** Board/prize menus: the top-card uid or `prize:<index>` Lua highlights. */
  uid?: string;
  /** Sidebar placement: primary (blue, big), danger (red), minor. */
  slot?: "primary" | "danger" | "minor";
}
export type SimMenuKind =
  | "list"
  | "confirm"
  | "cards"
  | "board"
  | "prizes"
  | "coin"
  | "log"
  | "pile";
export interface SimMenu {
  kind: SimMenuKind;
  title: string;
  note?: string;
  options: SimOption[];
  footer?: SimOption[];
  mandatory?: boolean;
  hideTargetOutline?: boolean;
  /** Selected Adrena-Brain source stays raised while choosing its destination. */
  counterSourceUid?: string;
  counterTransfer?: boolean;
}
/** An action attached to a card (Balatro's use/sell buttons). Targeted actions
 * share a `group` and name their `targetUid`; Lua collapses them into one
 * button that turns the table into a target picker. */
export interface SimCardAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  colour?: ThemeColour;
  targetUid?: string;
  group?: string;
  cost?: readonly string[];
  /** Printed damage, drawn at the right of an attack row. */
  damage?: string;
}
/** Lua renders a full table. The table source remains the sole rules/state owner. */
export class LuaSimulator {
  source: TableSource | null = null;
  menu: SimMenu | null = null;
  message = "";
  revision = 0;
  private menuId = 0;
  // Artwork for the last emit: the board, and each menu option by index.
  private boardArt = new Map<string, string>();
  private menuArt: ([string, string] | null)[] = [];
  // The page of the open card modal, reported by Lua as option indices.
  private menuWindow = { menuId: "", first: 0, size: 0 };
  private active = false;
  private handlers = new Map<string, () => void>();
  private pendingRareCandy: string | null = null;
  private knockedOut: readonly string[] = [];
  private cardOrder = new SimulatorOrder(0);
  private unsubscribe = () => {};
  // Online: the frame, prompt and refusal last turned into menus.
  private seen: RedactedGame | null = null;
  private promptKey = "";
  private rejected: unknown = null;
  private matchKey = "";
  constructor(
    private publish: (raw: string) => void,
    private route: (page: string, id?: string, replace?: boolean) => void,
    private images: (cards: { id: string; url: string }[]) => void = () => {},
    private onlineSource: (code: string) => TableSource | null = () => null,
  ) {}
  private get local() {
    return this.source instanceof LocalTableSource ? this.source : null;
  }
  private get online() {
    return this.source instanceof LuaOnlineMatch ? this.source : null;
  }
  /** The local hot-seat host, for tests and debugging. */
  get host() {
    return this.local?.host ?? null;
  }
  view(): RedactedGame | null {
    return this.source?.view() ?? null;
  }
  /** Stage resolved Items/Supporters without changing the engine's discard
   * order or making those cards unavailable to recovery effects. */
  private tablePiles(view: RedactedGame): TablePiles {
    const src = this.source;
    const used = new Set(
      src
        ? usedTrainersForTurn(viewLogEntries(src.log(), view.seat), view.turn).map((c) => c.id)
        : [],
    );
    const split = (owner: "you" | "opponent") => {
      const discard = view.board[owner].discard;
      const played = discard.filter(
        (c) => used.has(c.id) && (c.trainerType === "Item" || c.trainerType === "Supporter"),
      );
      if (owner === "you" && this.pendingRareCandy) {
        const candy = view.board.you.hand.find((c) => c.id === this.pendingRareCandy);
        if (candy) played.push(candy);
      }
      const held = new Set(played.map((c) => c.id));
      return { played, discard: discard.filter((c) => !held.has(c.id)) };
    };
    return { you: split("you"), opponent: split("opponent") };
  }
  allowed(action: GameAction) {
    const v = this.view();
    const allowed = this.source?.allowed(action);
    return allowed ?? (!!v && onlineGate(action, v));
  }
  /** Seats whose deck was shuffled by the last accepted action ("you" /
      "opponent" / "both"), emitted once so the table can riffle the pile. */
  private shuffled = "";
  dispatch(action: GameAction) {
    const src = this.source;
    if (!src) return;
    if (
      this.pendingRareCandy &&
      (action.type !== "rareCandy" || action.uid !== this.pendingRareCandy)
    ) {
      this.message = "Finish Rare Candy or cancel it first.";
      this.emit();
      return;
    }
    src.send(action);
    if (this.online) {
      // No optimism: the next frame (or refusal) rebuilds the prompt.
      this.pendingRareCandy = null;
      this.menu = null;
      this.message = "";
      this.emit();
      return;
    }
    const events = src.takeEvents();
    this.knockedOut = events.knockedOut;
    const error = src.lifecycle().error;
    this.message = error ?? "";
    if (error === null) {
      this.pendingRareCandy = null;
      this.menu = null;
      this.persist();
      this.prompt(events.counterSource);
      const flips = events.coin;
      if (flips) {
        this.menuId++;
        this.menu = {
          kind: "coin",
          title: flips.title,
          note: flips.flips
            .map((f) => `${f.player}: ${f.result === "heads" ? "Heads" : "Tails"}`)
            .join("\n"),
          mandatory: true,
          options: [
            {
              label: "Continue",
              run: () => {
                this.menu = null;
                this.prompt();
                this.emit();
              },
            },
          ],
        };
      }
    }
    // A turn draw always joins the end, even if this UID has an old cosmetic
    // position from an earlier hand (for example after being shuffled back).
    for (const d of this.local?.turnDraws() ?? [])
      this.cardOrder.move(d.seat, "hand", d.hand, d.uid, d.hand.length - 1);
    if (events.shuffled.length > 0) this.shuffled = this.seats(events.shuffled);
    this.emit();
  }
  persist() {
    if (this.local && !this.local.persist())
      this.message = "Could not save this game. Browser storage may be full.";
  }
  open(setup: LocalGameSetup | null = loadSimulatorSave()) {
    this.bind(setup ? new LocalTableSource(setup) : null);
  }
  private bind(source: TableSource | null) {
    this.release();
    this.active = true;
    this.source = source;
    this.reset();
    this.unsubscribe = source?.subscribe(() => this.changed()) ?? (() => {});
    if (source) this.prompt();
    this.emit();
  }
  /** Let the bound table go (an online one hands the lobby back). */
  private release() {
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.source?.release?.();
  }
  private reset() {
    const src = this.source;
    const online = this.online;
    this.knockedOut = [];
    this.pendingRareCandy = null;
    this.shuffled = "";
    this.menu = null;
    this.message = "";
    this.seen = src?.view() ?? null;
    this.rejected = online?.rejection() ?? null;
    this.matchKey = src?.matchId() ?? "";
    // Online order is cosmetic and never saved.
    this.cardOrder = online
      ? new SimulatorOrder(0, false)
      : new SimulatorOrder(Number(src?.matchId() ?? 0));
  }
  /** A pushed change: online frames, refusals, presence and catalogue fills. */
  private changed() {
    const online = this.online;
    if (online) {
      if (online.matchId() !== this.matchKey) {
        this.reset();
        this.prompt();
      }
      const v = online.view();
      if (v !== this.seen) {
        this.seen = v;
        const events = online.takeEvents();
        this.knockedOut = events.knockedOut;
        this.shuffled = this.seats(events.shuffled);
        this.message = "";
        // Keep a half-made answer while its prompt is unchanged.
        if (!this.menu || (this.menu.mandatory && this.key(v) !== this.promptKey)) {
          this.menu = null;
          this.prompt(events.counterSource);
        }
      }
      const error = online.rejection();
      if (error !== this.rejected) {
        this.rejected = error;
        if (error) {
          this.message = error.reason;
          if (!this.menu) this.prompt();
        }
      }
    }
    this.emit();
  }
  private key(v: RedactedGame | null) {
    return JSON.stringify(v ? [v.phase, v.waitingOn] : null);
  }
  /** Absolute seats to the table's "you" / "opponent" / "both". */
  private seats(shuffled: readonly string[]) {
    const seat = this.view()?.seat;
    if (shuffled.length === 0 || !seat) return "";
    const mine = shuffled.includes(seat);
    const theirs = shuffled.includes(otherSeat(seat));
    return mine && theirs ? "both" : mine ? "you" : "opponent";
  }
  private restart() {
    const next = this.local?.nextGame();
    if (!next) return;
    if (!next.ok) {
      this.message = next.message;
      this.emit();
      return;
    }
    this.open(next.setup);
    this.persist();
  }
  action(label: string, action: GameAction, colour: ThemeColour = "blue"): SimOption {
    return { label, colour, disabled: !this.allowed(action), run: () => this.dispatch(action) };
  }
  private cancelRareCandy() {
    this.pendingRareCandy = null;
    this.message = "";
    this.emit();
  }
  choose(
    title: string,
    options: SimOption[],
    note = "",
    mandatory = false,
    kind: SimMenuKind = "list",
    footer?: SimOption[],
  ) {
    this.menuId++;
    this.menu = { kind, title, options, note, mandatory, footer };
    this.emit();
  }
  prompt(selectedCounterSource?: PokemonRef) {
    if (this.local?.autoSteps()) this.persist();
    this.menuId++;
    const v = this.view();
    this.promptKey = this.key(v);
    if (!v) return;
    // Online the table answers only its own decisions; Prizes are auto-taken.
    if (this.online && (v.waitingOn !== "you" || v.phase.kind === "ko:takePrizes")) return;
    const seat = v.seat;
    const p = v.phase;
    if (p.kind === "effect:choose" && p.prompt) {
      this.menu = effectMenu(this, p.prompt, selectedCounterSource);
    } else if (p.kind === "ko:takePrizes") {
      const picked = new Set<number>();
      const draw = () => {
        this.menu = {
          kind: "prizes",
          title: `Take ${p.count} Prize card${p.count > 1 ? "s" : ""}`,
          note: "Click the Prize cards you want, then confirm.",
          mandatory: true,
          options: Array.from({ length: v.board.you.prizesRemaining }, (_, i) => ({
            label: `Prize ${i + 1}`,
            uid: `prize:${i}`,
            selected: picked.has(i),
            run: () => {
              if (picked.has(i)) picked.delete(i);
              else if (picked.size < p.count) picked.add(i);
              draw();
              this.emit();
            },
          })),
          footer: [this.action("Take", { type: "takePrizes", seat, prizeIndices: [...picked] })],
        };
      };
      draw();
    } else if (p.kind === "ko:promote") {
      this.menu = {
        kind: "board",
        title: "Choose your new Active Pokémon",
        note: "Click a Benched Pokémon.",
        mandatory: true,
        hideTargetOutline: true,
        options: v.board.you.bench.map((c, i) => ({
          ...this.action(c.name, { type: "promote", seat, benchIndex: i }),
          uid: c.id,
          card: c,
        })),
      };
    }
  }
  targets() {
    const v = this.view();
    if (!v) return [];
    return [
      ...(v.board.you.active
        ? [{ card: v.board.you.active, target: { spot: "active" } as PokemonTarget }]
        : []),
      ...v.board.you.bench.map((card, index) => ({
        card,
        target: { spot: "bench", index } as PokemonTarget,
      })),
    ];
  }
  /** Every action a card offers right now, keyed by its uid (own hand and
   * in-play cards, plus the Stadium's ability). */
  cardActions(): Map<string, SimCardAction[]> {
    const out = new Map<string, SimCardAction[]>();
    const v = this.view();
    if (!v) return out;
    const seat = v.seat;
    const p = v.phase;
    const push = (uid: string, a: SimCardAction) => {
      const list = out.get(uid) ?? [];
      list.push(a);
      out.set(uid, list);
    };
    const act = (
      uid: string,
      label: string,
      action: GameAction,
      colour: ThemeColour = "blue",
      extra: Partial<SimCardAction> = {},
    ) =>
      push(uid, {
        label,
        colour,
        disabled: !this.allowed(action),
        run: () => this.dispatch(action),
        ...extra,
      });
    if (this.pendingRareCandy && p.kind === "turn:action") {
      const candy = this.pendingRareCandy;
      for (const option of p.rareCandy) {
        for (const evolution of option.stage2) {
          act(
            evolution.uid,
            `Evolve ${option.basicName}`,
            {
              type: "rareCandy",
              seat,
              uid: candy,
              target: option.target,
              evolutionUid: evolution.uid,
            },
            "green",
            { targetUid: option.basicUid, group: "evolve" },
          );
        }
      }
      push(candy, { label: "Cancel", colour: "orange", run: () => this.cancelRareCandy() });
      return out;
    }
    for (const card of v.board.you.hand) {
      const uid = card.id;
      if (p.kind === "setup:place") {
        act(uid, "Place Active", { type: "setupPlaceActive", seat, uid });
        act(uid, "Place on Bench", { type: "setupPlaceBench", seat, uid });
      } else if (p.kind === "turn:action") {
        if (card.category === "Pokemon") {
          act(uid, "Bench", { type: "playBasicToBench", seat, uid });
          for (const { card: targetCard, target } of this.targets())
            act(uid, `Evolve ${targetCard.name}`, { type: "evolve", seat, uid, target }, "green", {
              targetUid: targetCard.id,
              group: "evolve",
            });
        } else if (card.category === "Trainer") {
          const trainer = p.trainers.find((t) => t.uid === uid);
          if (trainer?.rareCandy) {
            for (const target of p.rareCandy)
              for (const evolution of target.stage2)
                act(uid, `${target.basicName} → ${evolution.name}`, {
                  type: "rareCandy",
                  seat,
                  uid,
                  target: target.target,
                  evolutionUid: evolution.uid,
                });
          } else if (card.trainerType === "Tool" || card.trainerType === "Pokémon Tool") {
            for (const { card: targetCard, target } of this.targets())
              act(
                uid,
                `Attach to ${targetCard.name}`,
                { type: "attachTool", seat, uid, target },
                "blue",
                { targetUid: targetCard.id, group: "tool" },
              );
          } else act(uid, "Play", { type: "playTrainer", seat, uid });
        } else if (card.category === "Energy") {
          for (const { card: targetCard, target } of this.targets())
            act(
              uid,
              `Attach to ${targetCard.name}`,
              { type: "attachEnergy", seat, uid, target },
              "blue",
              { targetUid: targetCard.id, group: "attach" },
            );
        }
      }
    }
    if (p.kind === "turn:action") {
      for (const { card, target } of this.targets()) {
        const uid = card.id;
        for (const a of p.abilities)
          if (JSON.stringify(a.target) === JSON.stringify(target))
            push(uid, {
              label: a.abilityName,
              colour: "red",
              group: "ability",
              disabled: a.disabled,
              run: () =>
                this.dispatch({
                  type: "useAbility",
                  seat,
                  target: a.target,
                  abilityName: a.abilityName,
                }),
            });
        if (target.spot === "active") {
          for (const a of p.attacks)
            act(uid, a.name, { type: "attack", seat, index: a.index }, "red", {
              cost: a.effectiveCost ?? a.cost,
              damage: a.damage ?? "",
            });
        }
        for (const a of p.discardable ?? [])
          if (JSON.stringify(a.target) === JSON.stringify(target))
            act(uid, a.label, { type: "discardFromPlay", seat, target: a.target }, "red");
      }
      if (v.board.stadium && p.stadiumAbility)
        push(v.board.stadium.id, {
          label: p.stadiumAbility.label,
          colour: "red",
          group: "ability",
          disabled: p.stadiumAbility.disabled,
          run: () => this.dispatch({ type: "useStadiumAbility", seat }),
        });
    }
    return out;
  }
  /** Retreat: pick the Benched Pokémon on the table, then the Energy to discard
   * as a card row; both steps are skipped when the choice is forced. */
  retreat(promote?: number) {
    const v = this.view();
    if (!v || v.phase.kind !== "turn:action") return;
    const seat = v.seat;
    const cost = v.phase.retreat?.cost ?? 0;
    const energies = v.board.you.active?.attached?.energies ?? [];
    if (promote === undefined) {
      this.choose(
        "Retreat to which Pokémon?",
        v.board.you.bench.map((c, i) => ({
          label: c.name,
          uid: c.id,
          card: c,
          run: () => this.retreat(i),
        })),
        cost ? `Retreat cost: ${cost} Energy.` : "Retreating is free.",
        false,
        "board",
      );
      return;
    }
    const bench = promote;
    // No real choice when every attached Energy is the same card: pay from
    // the first ones rather than opening a picker.
    const allAlike = energies.every((c) => c.cardId === energies[0]?.cardId);
    if (cost === 0 || energies.length <= cost || allAlike) {
      this.dispatch({
        type: "retreat",
        seat,
        discardEnergy: energies.slice(0, cost).map((c) => c.id),
        promoteBenchIndex: bench,
      });
      return;
    }
    const picked = new Set<string>();
    const draw = () => {
      this.menuId++;
      this.menu = {
        kind: "cards",
        title: "",
        options: energies.map((c) => ({
          label: c.name,
          card: c,
          uid: c.id,
          selected: picked.has(c.id),
          run: () => {
            if (picked.has(c.id)) picked.delete(c.id);
            else if (picked.size < cost) picked.add(c.id);
            draw();
            this.emit();
          },
        })),
        footer: [
          {
            label: "Discard",
            colour: "blue",
            disabled: picked.size !== cost,
            run: () =>
              this.dispatch({
                type: "retreat",
                seat,
                discardEnergy: [...picked],
                promoteBenchIndex: bench,
              }),
          },
        ],
      };
    };
    draw();
    this.emit();
  }
  history(type: HistoryStep) {
    const local = this.local;
    if (!local) return;
    if (this.pendingRareCandy) {
      this.cancelRareCandy();
      return;
    }
    local.history(type);
    this.knockedOut = [];
    this.menu = null;
    this.message = "";
    this.persist();
    this.prompt();
    this.emit();
  }
  sidebar(): SimOption[] {
    const v = this.view();
    if (this.online) return v ? this.onlineSidebar(v) : [];
    if (!v) return [{ label: "Choose decks", slot: "primary", run: () => this.route("sandbox") }];
    const seat = v.seat;
    const p = v.phase;
    if (this.pendingRareCandy)
      return [
        {
          label: "Cancel Rare Candy",
          colour: "orange",
          slot: "primary",
          run: () => this.cancelRareCandy(),
        },
      ];
    if (p.kind === "setup:chooseFirst")
      return [
        {
          ...this.action("P1 first", { type: "chooseFirstPlayer", seat, first: "p1" }),
          slot: "primary",
        },
        {
          ...this.action("P2 first", { type: "chooseFirstPlayer", seat, first: "p2" }),
          slot: "primary",
        },
        {
          ...this.action(
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
      ];
    if (p.kind === "setup:place")
      return [
        {
          ...this.action("Ready", { type: "setupReady", seat }, seat === "p2" ? "red" : "blue"),
          slot: "primary",
        },
      ];
    if (p.kind === "turn:action") {
      // Attacks, Retreat and Abilities live on the Active card's attached
      // buttons; the panel keeps End turn and the undo/redo history.
      const history = (
        label: string,
        type: "undoAction" | "redoAction" | "undoTurn" | "redoTurn",
      ): SimOption => ({
        label,
        colour: "red",
        slot: "minor",
        disabled: !this.local?.canStep(type),
        run: () => this.history(type),
      });
      return [
        { ...this.action("End turn", { type: "endTurn", seat }, "red"), slot: "primary" },
        history("Undo turn", "undoTurn"),
        history("Undo action", "undoAction"),
        { label: "New game", colour: "red", slot: "minor", run: () => this.command("newgame") },
        history("Redo action", "redoAction"),
        history("Redo turn", "redoTurn"),
      ];
    }
    if (p.kind === "gameOver")
      return [
        {
          label: "New game",
          colour: "red",
          slot: "danger",
          run: () => this.command("newgame"),
        },
      ];
    return [];
  }
  /** Online: no hot-seat history, no new game; Rematch once it is over. */
  private onlineSidebar(v: RedactedGame): SimOption[] {
    const seat = v.seat;
    const p = v.phase;
    const sent = this.online?.lifecycle().flags.includes("rematch-sent");
    if (this.pendingRareCandy)
      return [
        {
          label: "Cancel Rare Candy",
          colour: "orange",
          slot: "primary",
          run: () => this.cancelRareCandy(),
        },
      ];
    if (p.kind === "setup:chooseFirst" && v.waitingOn === "you")
      return [
        {
          ...this.action("Go first", { type: "chooseFirstPlayer", seat, first: seat }),
          slot: "primary",
        },
        {
          ...this.action("Go second", { type: "chooseFirstPlayer", seat, first: otherSeat(seat) }),
          slot: "primary",
        },
      ];
    if (p.kind === "setup:place" && !p.ready.you)
      return [
        {
          ...this.action("Ready", { type: "setupReady", seat }, seat === "p2" ? "red" : "blue"),
          slot: "primary",
        },
      ];
    if (p.kind === "turn:action" && v.activePlayer === "you")
      return [{ ...this.action("End turn", { type: "endTurn", seat }, "red"), slot: "primary" }];
    if (v.outcome)
      return [
        {
          label: sent ? "Waiting..." : "Rematch",
          colour: "red",
          slot: "danger",
          disabled: sent,
          run: () => this.command("rematch"),
        },
      ];
    return [];
  }
  /** The open modal's page first, then its neighbours, the board, the rest. */
  private publishImages() {
    const ordered = new Map<string, string>();
    const add = (entry: [string, string] | null | undefined) => {
      if (entry && !ordered.has(entry[0])) ordered.set(entry[0], entry[1]);
    };
    const { menuId, first, size } = this.menuWindow;
    if (menuId === String(this.menuId) && size > 0)
      for (const d of [0, 1, -1, 2, -2])
        for (let i = first + d * size; i < first + (d + 1) * size; i++) add(this.menuArt[i]);
    for (const entry of this.boardArt) add(entry);
    for (const entry of this.menuArt) add(entry);
    this.images([...ordered].slice(0, LUA_ART_SLOTS).map(([id, url]) => ({ id, url })));
  }
  /** Commands Lua may send while no table is bound. */
  private readonly anytimeCommands = new Map<string, (args: string[]) => void>([
    ["menu-page", (args) => this.onMenuPage(args)],
    ["resume", () => this.route(loadSimulatorSave() ? "simulator" : "sandbox")],
    ["open", (args) => this.onOpen(args)],
    ["close", () => this.onClose()],
  ]);
  /** Commands that act on the bound table; ignored while inactive. */
  private readonly tableCommands = new Map<string, (args: string[]) => void>([
    ["cancelRareCandy", () => this.cancelRareCandy()],
    ["invoke", (args) => this.onInvoke(args)],
    ["dismiss", () => this.onDismiss()],
    ["rematch", () => this.online?.rematch()],
    ["history", (args) => this.onHistory(args)],
    ["choosedecks", () => this.onChooseDecks()],
    ["newgame", () => this.onNewGame()],
    ["concede", () => this.onConcede()],
    ["leave", () => this.onLeave()],
    ["log", () => this.onLog()],
    ["pile", (args) => this.onPile(args)],
    ["retreat", (args) => this.onRetreat(args)],
    ["reorder", (args) => this.onReorder(args)],
    ["move", (args) => this.onMove(args)],
  ]);
  command(raw: string) {
    const fields = decodeFields(raw);
    if (!fields) return;
    const [cmd = "", ...args] = fields;
    const anytime = this.anytimeCommands.get(cmd);
    if (anytime) return anytime(args);
    if (this.active) this.tableCommands.get(cmd)?.(args);
  }
  private onMenuPage(args: string[]) {
    this.menuWindow = {
      menuId: args[0] ?? "",
      first: Number(args[1]) || 0,
      size: Number(args[2]) || 0,
    };
    this.publishImages();
  }
  private onOpen(args: string[]) {
    if (args[0] !== "online") {
      this.open();
      return;
    }
    // `open\tonline\t<code>`: the lobby's live match, or back to its modal.
    const code = args[1] ?? "";
    const source = this.onlineSource(code);
    if (source) this.bind(source);
    else {
      this.release();
      this.active = false;
      this.route("online", code, true);
    }
  }
  private onClose() {
    this.release();
    this.active = false;
    this.menu = null;
    this.pendingRareCandy = null;
  }
  private onInvoke(args: string[]) {
    if (Number(args[0]) === this.revision) this.handlers.get(args[1] ?? "")?.();
  }
  private onDismiss() {
    if (this.menu?.mandatory) return;
    this.menu = null;
    // A decision may have arrived behind the closed menu.
    if (this.online) this.prompt();
    this.emit();
  }
  private onHistory(args: string[]) {
    if (!this.local || this.menu) return;
    const type = HISTORY_COMMANDS.get(args[0] ?? "");
    if (type) this.history(type);
  }
  private onChooseDecks() {
    if (this.online || this.menu) return;
    this.choose(
      "Start new game with different decks?",
      [
        {
          label: "Choose decks",
          colour: "red",
          run: () => {
            clearSimulatorSave();
            this.route("sandbox");
          },
        },
      ],
      "",
      false,
      "confirm",
    );
  }
  private onNewGame() {
    if (!this.local || this.menu) return;
    this.choose(
      "Start a new game?",
      [{ label: "New game", colour: "red", run: () => this.restart() }],
      "",
      false,
      "confirm",
    );
  }
  private onConcede() {
    if (!this.source || this.menu) return;
    const seat = this.view()?.seat;
    if (!seat) return;
    this.choose(
      this.online ? "Concede the match?" : "Concede the game?",
      [this.action("Concede", { type: "concede", seat }, "red")],
      this.online
        ? "Your opponent wins immediately. This can't be undone."
        : "Your opponent wins immediately.",
    );
  }
  private onLeave() {
    // Online the canvas already asked (press again to confirm): bye now.
    const online = this.online;
    if (online) {
      this.release();
      this.active = false;
      online.leave();
    } else this.persist();
    this.route("home");
  }
  private onLog() {
    if (!this.source) return;
    const names = this.source.names();
    const seat = this.view()?.seat;
    this.choose(
      "Game log",
      [],
      this.source
        .log()
        .map((e) =>
          e.kind === "turn"
            ? `turn\t\t\tTurn ${e.turn}`
            : [
                e.who,
                e.who === "system" ? "" : e.who === seat ? names.you : names.opponent,
                e.elapsed,
                e.segments.map((s) => s.text).join(""),
              ].join("\t"),
        )
        .join("\n"),
      false,
      "log",
    );
  }
  private onPile(args: string[]) {
    if (!this.source || this.menu) return;
    const v = this.view();
    if (!v) return;
    const piles = this.tablePiles(v);
    const side = args[0] === "opponent" ? piles.opponent : piles.you;
    this.choose(
      "",
      side.discard
        .slice()
        .reverse()
        .map((card) => ({ label: card.name, card, uid: card.id, run: () => {}, disabled: true })),
      "",
      false,
      "pile",
    );
  }
  private onRetreat(args: string[]) {
    if (!this.source || this.menu) return;
    const index = Number(args[0]);
    this.retreat(Number.isInteger(index) && index >= 0 ? index : undefined);
  }
  private onReorder(args: string[]) {
    if (!this.source || this.menu) return;
    const [zone, uid, index] = args;
    if (zone !== "hand" && zone !== "bench") return;
    const src = this.source;
    const v = this.view();
    if (!v) return;
    const seat = v.seat;
    const cards =
      zone === "hand"
        ? v.board.you.hand
            .filter((c) => c.id !== this.pendingRareCandy)
            .map((c) => ({ uid: c.id, key: c.id }))
        : v.board.you.bench.map((c, i) => ({ uid: c.id, key: src.benchKey("you", i) }));
    const card = cards.find((c) => c.uid === uid);
    if (!card) return;
    this.cardOrder.move(
      seat,
      zone,
      cards.map((c) => c.key),
      card.key,
      Number(index),
    );
    this.message = "";
    this.emit();
  }
  private onMove(args: string[]) {
    if (!this.source || this.menu) return;
    const [uid, fromZone, fromIndex, zone, index] = args;
    if (
      !uid ||
      !["hand", "bench", "active"].includes(fromZone ?? "") ||
      !["active", "bench", "playmat", "stadium"].includes(zone ?? "")
    )
      return;
    const src = this.source;
    const v = this.view();
    if (!v) return;
    const phase = v.phase;
    if (this.pendingRareCandy) {
      const target = fromZone === "hand" ? rareCandyTarget(phase, zone, index, uid) : null;
      if (target) {
        this.dispatch({
          type: "rareCandy",
          seat: v.seat,
          uid: this.pendingRareCandy,
          target,
          evolutionUid: uid,
        });
      } else {
        this.message = "Drag a matching Stage 2 onto its Basic Pokemon, or cancel Rare Candy.";
        this.emit();
      }
      return;
    }
    const candy =
      phase.kind === "turn:action"
        ? phase.trainers.find((t) => t.uid === uid && t.rareCandy)
        : undefined;
    if (fromZone === "hand" && zone === "playmat" && candy) {
      if (candy.disabled) this.message = candy.reason ?? "No valid Rare Candy evolution right now.";
      else {
        this.pendingRareCandy = uid;
        this.message = "";
      }
      this.emit();
      return;
    }
    const action = moveToAction(
      {
        cardId: uid,
        from: {
          owner: "you",
          zone: fromZone as "hand" | "bench" | "active",
          index: Number(fromIndex),
        },
        to:
          zone === "stadium"
            ? { owner: "global", zone: "stadium" }
            : zone === "active" || zone === "playmat"
              ? { owner: "you", zone }
              : { owner: "you", zone: "bench", index: Number(index) },
      },
      {
        board: src.board(),
        viewerSeat: v.seat,
        phaseKind: phase.kind,
        isViewerTurn: phase.kind === "turn:action" && v.activePlayer === "you",
      },
    );
    if (action) this.dispatch(action);
    else if (fromZone === "hand") {
      this.message = "That card cannot go there right now.";
      this.emit();
    }
  }
  /** The one-shot events this emit hands to Lua; later emits do not repeat them. */
  private takeEmitEvents(): EmitEvents {
    const shuffled = this.shuffled;
    this.shuffled = "";
    return { shuffled };
  }
  private emitState(): EmitState {
    const src = this.source;
    return {
      src,
      view: this.view(),
      names: src?.names(),
      online: !!this.online,
      turns: this.local?.turns(),
      message: this.message,
      pendingRareCandy: this.pendingRareCandy,
      knockedOut: this.knockedOut,
      menu: this.menu,
      menuId: this.menuId,
      cardOrder: this.cardOrder,
      now: Date.now(),
    };
  }
  emit() {
    if (!this.active) return;
    const events = this.takeEmitEvents();
    const revision = ++this.revision;
    const s = this.emitState();
    const { src, view: v } = s;
    const f = new EmitFrame();
    headerRow(f, s, revision, events);
    tableRows(f, s);
    if (v && src) {
      boardRows(f, s, v, src, this.tablePiles(v));
      if (!s.menu) cardActionRows(f, this.cardActions());
    }
    sidebarRows(f, this.sidebar(), !!s.menu);
    if (s.menu) menuRows(f, s.menu, s.menuId);
    if (src) infoRows(f, src);
    this.handlers = f.handlers;
    this.boardArt = f.art;
    this.menuArt = f.menuArt;
    this.publishImages();
    this.publish(f.rows.join("\n"));
  }
}
