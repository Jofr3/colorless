import { otherSeat, type GameAction, type PokemonRef } from "@colorless/engine";
import type { RedactedGame } from "@colorless/schema";
import { decodeFields } from "./wire";
import type { HostState, LocalGameSetup } from "../game/localHost";
import { moveToAction } from "../game/moveToAction";
import { loadSimulatorSave, clearSimulatorSave } from "../game/simulatorSave";
import { effectMenu } from "./simulatorChoices";
import { usedTrainersForTurn } from "../game/usedTrainers";
import { SimulatorOrder } from "./simulatorOrder";
import { LUA_ART_SLOTS } from "./artworkCache";
import { LocalTableSource, type HistoryStep, type TableSource } from "./tableSource";
import { autoStepFor, type CoinFlips } from "./tableEvents";
import {
  actionOption,
  cardActions,
  forcedRetreat,
  promoteMenu,
  rareCandyTarget,
  retreatBenchMenu,
  retreatEnergyMenu,
} from "./simulatorActions";
import type { SimMenu, SimMenuKind, SimOption, ThemeColour } from "./simulatorTypes";
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
  // The frame, prompt and refusal last turned into menus.
  private seen: RedactedGame | null = null;
  private promptKey = "";
  private rejected: object | null = null;
  private matchKey = "";
  constructor(
    private publish: (raw: string) => void,
    private route: (page: string, id?: string, replace?: boolean) => void,
    private images: (cards: { id: string; url: string }[]) => void = () => {},
    private onlineSource: (code: string) => TableSource | null = () => null,
  ) {}
  /** The local hot-seat host, for tests and debugging. */
  get host() {
    return (this.source as Partial<LocalTableSource> | null)?.host ?? null;
  }
  view(): RedactedGame | null {
    return this.source?.view() ?? null;
  }
  /** Stage resolved Items/Supporters without changing the engine's discard
   * order or making those cards unavailable to recovery effects. */
  private tablePiles(view: RedactedGame): TablePiles {
    const src = this.source;
    const used = new Set(src ? usedTrainersForTurn(src.log(), view.turn) : []);
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
    return this.source?.allowed(action) ?? false;
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
    // No optimism: the table's answer, at once or from the server, rebuilds the prompt.
    this.pendingRareCandy = null;
    this.menu = null;
    this.message = "";
    this.settle(() => src.send(action));
  }
  /** Run a change on the table, then emit unless its answer already did. */
  private settle(change: () => void) {
    const revision = this.revision;
    change();
    if (this.revision === revision) this.emit();
  }
  open(setup: LocalGameSetup | HostState | null = loadSimulatorSave()) {
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
    this.knockedOut = [];
    this.pendingRareCandy = null;
    this.shuffled = "";
    this.menu = null;
    this.message = src?.lifecycle().warning ?? "";
    this.seen = src?.view() ?? null;
    this.rejected = src?.lifecycle().error ?? null;
    this.matchKey = src?.matchId() ?? "";
    // Online order is cosmetic and never saved.
    this.cardOrder =
      src?.mode === "online"
        ? new SimulatorOrder(0, false)
        : new SimulatorOrder(Number(src?.matchId() ?? 0));
  }
  /** The table changed: the answer to a send, a pushed frame or refusal, a
   * history step, presence or catalogue fills. */
  private changed() {
    const src = this.source;
    if (!src) return;
    if (src.matchId() !== this.matchKey) {
      this.reset();
      this.prompt();
    }
    const v = src.view();
    if (v !== this.seen) {
      this.seen = v;
      const events = src.takeEvents();
      this.knockedOut = events.knockedOut;
      this.shuffled = this.seats(events.shuffled);
      this.message = src.lifecycle().warning ?? "";
      // Keep a half-made answer while its prompt is unchanged.
      if (!this.menu || (this.menu.mandatory && this.key(v) !== this.promptKey)) {
        this.menu = null;
        this.prompt(events.counterSource);
      }
      this.showCoin(events.coin);
      // A turn draw always joins the end, even if this UID has an old cosmetic
      // position from an earlier hand (for example after being shuffled back).
      for (const d of src.turnDraws?.() ?? [])
        this.cardOrder.move(d.seat, "hand", d.hand, d.uid, d.hand.length - 1);
    }
    const error = src.lifecycle().error;
    if (error !== this.rejected) {
      this.rejected = error;
      if (error) {
        this.message = error.reason;
        if (!this.menu) this.prompt();
      }
    }
    this.emit();
  }
  /** The flips play out over the table; Continue returns to whatever is asked next. */
  private showCoin(coin: CoinFlips | null) {
    if (!coin) return;
    this.menuId++;
    this.menu = {
      kind: "coin",
      title: coin.title,
      note: coin.flips
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
    const error = this.source?.restart?.();
    if (!error) return;
    this.message = error;
    this.emit();
  }
  action(label: string, action: GameAction, colour: ThemeColour = "blue"): SimOption {
    return actionOption(this, label, action, colour);
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
    this.show({ kind, title, options, note, mandatory, footer });
  }
  private show(menu: SimMenu) {
    this.menuId++;
    this.menu = menu;
    this.emit();
  }
  prompt(selectedCounterSource?: PokemonRef) {
    this.menuId++;
    const v = this.view();
    this.promptKey = this.key(v);
    // The table answers only its own decisions, and the source takes the automatic ones.
    if (!v || v.waitingOn !== "you" || autoStepFor(v)) return;
    const p = v.phase;
    if (p.kind === "effect:choose" && p.prompt)
      this.menu = effectMenu(this, p.prompt, selectedCounterSource);
    else if (p.kind === "ko:promote") this.menu = promoteMenu(v, this);
  }
  /** Retreat: pick the Benched Pokémon on the table, then the Energy to discard
   * as a card row; both steps are skipped when the choice is forced. */
  retreat(promote?: number) {
    const v = this.view();
    if (!v || v.phase.kind !== "turn:action") return;
    if (promote === undefined) {
      this.show(retreatBenchMenu(v, (bench) => this.retreat(bench)));
      return;
    }
    const bench = promote;
    const forced = forcedRetreat(v, bench);
    if (forced) {
      this.dispatch(forced);
      return;
    }
    const cost = v.phase.retreat?.cost ?? 0;
    const picked = new Set<string>();
    const toggle = (uid: string) => {
      if (picked.has(uid)) picked.delete(uid);
      else if (picked.size < cost) picked.add(uid);
      this.show(retreatEnergyMenu(v, bench, picked, toggle, this));
    };
    this.show(retreatEnergyMenu(v, bench, picked, toggle, this));
  }
  history(type: HistoryStep) {
    const history = this.source?.history;
    if (!history) return;
    if (this.pendingRareCandy) {
      this.cancelRareCandy();
      return;
    }
    this.knockedOut = [];
    this.menu = null;
    this.message = "";
    this.settle(() => history.step(type));
  }
  sidebar(): SimOption[] {
    const src = this.source;
    if (!src) return [{ label: "Choose decks", slot: "primary", run: () => this.route("sandbox") }];
    const v = src.view();
    if (!v) return [];
    if (this.pendingRareCandy)
      return [
        {
          label: "Cancel Rare Candy",
          colour: "orange",
          slot: "primary",
          run: () => this.cancelRareCandy(),
        },
      ];
    return src.mode === "local" ? this.hotSeatSidebar(v, src) : this.remoteSidebar(v, src);
  }
  /** Both seats at one table: either player's choices, plus the game's history. */
  private hotSeatSidebar(v: RedactedGame, src: TableSource): SimOption[] {
    const seat = v.seat;
    const p = v.phase;
    const flags = src.lifecycle().flags;
    const newGame = (slot: SimOption["slot"]): SimOption[] =>
      flags.includes("newgame")
        ? [{ label: "New game", colour: "red", slot, run: () => this.command("newgame") }]
        : [];
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
      ): SimOption[] =>
        flags.includes("undo")
          ? [
              {
                label,
                colour: "red",
                slot: "minor",
                disabled: !src.history?.canStep(type),
                run: () => this.history(type),
              },
            ]
          : [];
      return [
        { ...this.action("End turn", { type: "endTurn", seat }, "red"), slot: "primary" },
        ...history("Undo turn", "undoTurn"),
        ...history("Undo action", "undoAction"),
        ...newGame("minor"),
        ...history("Redo action", "redoAction"),
        ...history("Redo turn", "redoTurn"),
      ];
    }
    if (p.kind === "gameOver") return newGame("danger");
    return [];
  }
  /** One seat against a remote player: only this seat's decisions; Rematch once it is over. */
  private remoteSidebar(v: RedactedGame, src: TableSource): SimOption[] {
    const seat = v.seat;
    const p = v.phase;
    const flags = src.lifecycle().flags;
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
    if (flags.includes("rematch")) {
      const sent = flags.includes("rematch-sent");
      return [
        {
          label: sent ? "Waiting..." : "Rematch",
          colour: "red",
          slot: "danger",
          disabled: sent,
          run: () => this.command("rematch"),
        },
      ];
    }
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
    ["rematch", () => this.source?.rematch?.()],
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
    this.prompt();
    this.emit();
  }
  private onHistory(args: string[]) {
    if (!this.source?.history || this.menu) return;
    const type = HISTORY_COMMANDS.get(args[0] ?? "");
    if (type) this.history(type);
  }
  private onChooseDecks() {
    const src = this.source;
    if (this.menu || (src && !src.lifecycle().flags.includes("choosedecks"))) return;
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
    if (!this.source?.restart || this.menu) return;
    this.choose(
      "Start a new game?",
      [{ label: "New game", colour: "red", run: () => this.restart() }],
      "",
      false,
      "confirm",
    );
  }
  private onConcede() {
    const src = this.source;
    if (!src || this.menu) return;
    const seat = this.view()?.seat;
    if (!seat) return;
    const online = src.mode === "online";
    this.choose(
      online ? "Concede the match?" : "Concede the game?",
      [this.action("Concede", { type: "concede", seat }, "red")],
      online
        ? "Your opponent wins immediately. This can't be undone."
        : "Your opponent wins immediately.",
    );
  }
  private onLeave() {
    // Online the canvas already asked (press again to confirm): bye now.
    const src = this.source;
    this.release();
    this.active = false;
    src?.leave();
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
      v,
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
      online: src?.mode === "online",
      turns: src?.history?.turns(),
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
      const candy = s.pendingRareCandy;
      const staged = candy ? { uid: candy, cancel: () => this.cancelRareCandy() } : null;
      if (!s.menu) cardActionRows(f, cardActions(v, this, staged));
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
