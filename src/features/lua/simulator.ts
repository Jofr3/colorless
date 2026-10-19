import {
  applyAction,
  cardOfUid,
  energyProvidesOf,
  otherSeat,
  redactGame,
  type GameAction,
  type PokemonTarget,
} from "@luminous/engine";
import type { Card, RedactedCard, RedactedInPlay, RedactedGame } from "@luminous/schema";
import { encodeFields } from "./account";

/** m6x11plus has no arrow, middle dot, em dash, minus or ellipsis glyphs; the
    engine's log and card text use them, so spell them in ASCII for Lua. */
export function pixelText(text: string): string {
  return text
    .replace(/\s*→\s*/g, " -> ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s*—\s*/g, " - ")
    .replace(/−/g, "-")
    .replace(/…/g, "...");
}
import { initHost, hostReducer, stepTarget } from "../game/useLocalGame";
import { projectGameState, GAME_OVER_DETAIL } from "../game/projection";
import { moveToAction } from "../game/moveToAction";
import { loadSimulatorSave, saveSimulator, clearSimulatorSave } from "../playmat/simulatorSave";
import { cardImageUrl } from "../../lib/api";
import { effectMenu } from "./simulatorChoices";
import { viewLogEntries } from "../game/viewLog";
import { usedTrainersForTurn } from "../playmat/utils/usedTrainers";
import { SimulatorOrder } from "./simulatorOrder";

export interface SimOption {
  label: string;
  run: () => void;
  disabled?: boolean;
  selected?: boolean;
  card?: RedactedCard;
  colour?: string;
  /** Board/prize menus: the top-card uid or `prize:<index>` Lua highlights. */
  uid?: string;
  /** Sidebar placement: primary (blue, big), danger (red), minor. */
  slot?: "primary" | "danger" | "minor";
}
export type SimMenuKind = "list" | "cards" | "board" | "prizes" | "coin" | "log" | "pile";
export interface SimMenu {
  kind: SimMenuKind;
  title: string;
  note?: string;
  options: SimOption[];
  footer?: SimOption[];
  mandatory?: boolean;
  hideTargetOutline?: boolean;
}
/** An action attached to a card (Balatro's use/sell buttons). Targeted actions
 * share a `group` and name their `targetUid`; Lua collapses them into one
 * button that turns the table into a target picker. */
export interface SimCardAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  colour?: string;
  targetUid?: string;
  group?: string;
  cost?: readonly string[];
  /** Printed damage, drawn at the right of an attack row. */
  damage?: string;
}
const RS = "\x1e";
const US = "\x1f";
const HINTS = {
  "setup:chooseFirst": "The coin winner chooses who goes first.",
  "setup:place": "Drag a Basic Pokémon to your Active spot, then fill your Bench and press Ready.",
  "turn:action": "Attach Energy, play Trainers and Pokémon, then attack or end your turn.",
  "ko:takePrizes": "Take your Prize cards.",
  "ko:promote": "Choose a new Active Pokémon from your Bench.",
  "effect:choose": "Resolve the card effect.",
  gameOver: "The game is over.",
} as const;
/** Lua renders a full table. The existing local host remains the sole rules/state owner. */
export class LuaSimulator {
  host: ReturnType<typeof initHost> | null = null;
  menu: SimMenu | null = null;
  message = "";
  revision = 0;
  private menuId = 0;
  private active = false;
  private handlers = new Map<string, () => void>();
  private pendingRareCandy: string | null = null;
  private knockedOut: readonly string[] = [];
  private cardOrder = new SimulatorOrder(0);
  constructor(
    private publish: (raw: string) => void,
    private route: (page: string) => void,
    private images: (cards: { id: string; url: string }[]) => void = () => {},
  ) {}
  view(): RedactedGame | null {
    return this.host && redactGame(this.host.game, this.host.viewerSeat);
  }
  /** Stage resolved Items/Supporters without changing the engine's discard
   * order or making those cards unavailable to recovery effects. */
  private tablePiles(view: RedactedGame) {
    const h = this.host;
    const used = new Set(
      h
        ? usedTrainersForTurn(viewLogEntries(h.log, h.viewerSeat), h.game.turn).map((c) => c.id)
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
    return !!this.host && applyAction(this.host.game, action).ok;
  }
  /** Seats whose deck was shuffled by the last accepted action ("you" /
      "opponent" / "both"), emitted once so the table can riffle the pile. */
  private shuffled = "";
  dispatch(action: GameAction) {
    if (!this.host) return;
    if (
      this.pendingRareCandy &&
      (action.type !== "rareCandy" || action.uid !== this.pendingRareCandy)
    ) {
      this.message = "Finish Rare Candy or cancel it first.";
      this.emit();
      return;
    }
    const before = this.host.log.length;
    this.host = hostReducer(this.host, { action, at: Date.now() });
    this.knockedOut = this.host.knockedOut;
    const seats = new Set<string>();
    for (const e of this.host.log.slice(before)) {
      if (e.kind !== "action" || e.who === "system") continue;
      const text = e.segments.map((s) => s.text).join("");
      if (/shuffled their (deck|hand)/.test(text) && !/bottom of their deck/.test(text))
        seats.add(e.who);
    }
    const flips = this.host.coinFlipPresentation ? this.host.coinFlipBatch : null;
    // The Lua coin overlay replaces the React dice presentation.
    if (this.host.coinFlipPresentation && this.host.coinFlipBatch) {
      this.host = hostReducer(this.host, {
        type: "finishCoinFlip",
        id: this.host.coinFlipBatch.id,
      });
    }
    this.message = this.host.lastError?.message ?? "";
    if (!this.host.lastError) {
      this.pendingRareCandy = null;
      this.menu = null;
      this.persist();
      this.prompt();
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
    if (seats.size > 0) {
      const mine = seats.has(this.host.viewerSeat);
      const theirs = seats.has(otherSeat(this.host.viewerSeat));
      this.shuffled = mine && theirs ? "both" : mine ? "you" : "opponent";
    }
    this.emit();
  }
  persist() {
    if (!this.host) return;
    const h = this.host;
    saveSimulator({
      state: h.game,
      events: [],
      names: h.names,
      startedAt: h.startedAt,
      resume: {
        log: h.log,
        viewerSeat: h.viewerSeat,
        turns: h.turns,
        turnIndex: h.turnIndex,
        latestTurn: h.latestTurn,
        steps: h.steps,
        stepIndex: h.stepIndex,
      },
    });
    if (loadSimulatorSave()?.startedAt !== h.startedAt)
      this.message = "Could not save this game. Browser storage may be full.";
  }
  open(setup = loadSimulatorSave()) {
    this.active = true;
    this.knockedOut = [];
    this.pendingRareCandy = null;
    this.menu = null;
    this.message = "";
    this.host = setup ? initHost(setup) : null;
    this.cardOrder = new SimulatorOrder(this.host?.startedAt ?? 0);
    if (this.host) this.prompt();
    this.emit();
  }
  action(label: string, action: GameAction, colour = "blue"): SimOption {
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
  private takePrizesAutomatically() {
    let taken = false;
    while (this.host?.game.phase.kind === "ko:takePrizes") {
      const h = this.host;
      const phase = h.game.phase;
      if (phase.kind !== "ko:takePrizes") break;
      const next = hostReducer(h, {
        action: {
          type: "takePrizes",
          seat: phase.seat,
          prizeIndices: Array.from(
            { length: phase.count },
            (_, i) => h.game.players[phase.seat].prizes.length - 1 - i,
          ),
        },
        at: Date.now(),
      });
      if (next.lastError || next.game === h.game) break;
      this.host = next;
      taken = true;
    }
    if (taken && this.host) {
      // Prize-taking belongs to the KO that caused it. Undo/redo must not
      // land on a pending automatic pick and immediately perform it again.
      const steps = this.host.steps.filter((step) => step.game.phase.kind !== "ko:takePrizes");
      this.host = { ...this.host, steps, stepIndex: steps.length - 1 };
      this.persist();
    }
  }
  prompt() {
    this.takePrizesAutomatically();
    this.menuId++;
    const v = this.view();
    const h = this.host;
    if (!v || !h) return;
    const seat = h.viewerSeat;
    const p = v.phase;
    if (p.kind === "effect:choose" && p.prompt) {
      this.menu = effectMenu(this, p.prompt);
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
    const h = this.host;
    if (!v || !h) return out;
    const seat = h.viewerSeat;
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
      colour = "blue",
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
        if (target.spot === "active") {
          for (const a of p.attacks)
            act(uid, a.name, { type: "attack", seat, index: a.index }, "red", {
              cost: a.effectiveCost ?? a.cost,
              damage: a.damage ?? "",
            });
          if (p.retreat)
            push(uid, {
              label: "Retreat",
              colour: "blue",
              disabled: !p.retreat.can,
              cost: Array.from({ length: p.retreat.cost }, () => "Colorless"),
              run: () => this.retreat(),
            });
        }
        for (const a of p.abilities)
          if (JSON.stringify(a.target) === JSON.stringify(target))
            push(uid, {
              label: a.abilityName,
              colour: "green",
              disabled: a.disabled,
              run: () =>
                this.dispatch({
                  type: "useAbility",
                  seat,
                  target: a.target,
                  abilityName: a.abilityName,
                }),
            });
        for (const a of p.discardable ?? [])
          if (JSON.stringify(a.target) === JSON.stringify(target))
            act(uid, a.label, { type: "discardFromPlay", seat, target: a.target }, "red");
      }
      if (v.board.stadium && p.stadiumAbility)
        push(v.board.stadium.id, {
          label: p.stadiumAbility.label,
          colour: "green",
          disabled: p.stadiumAbility.disabled,
          run: () => this.dispatch({ type: "useStadiumAbility", seat }),
        });
    }
    return out;
  }
  /** Retreat: pick the Benched Pokémon on the table, then the Energy to discard
   * as a card row; both steps are skipped when the choice is forced. */
  retreat(promote?: number) {
    const h = this.host;
    const v = this.view();
    if (!h || !v || v.phase.kind !== "turn:action") return;
    const seat = h.viewerSeat;
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
        title: `Discard ${cost} Energy to retreat`,
        note: `Choose ${cost} attached Energy card${cost > 1 ? "s" : ""} to discard.`,
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
            label: "Retreat",
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
  history(
    type: "previousTurn" | "nextTurn" | "undoAction" | "redoAction" | "undoTurn" | "redoTurn",
  ) {
    if (!this.host) return;
    if (this.pendingRareCandy) {
      this.cancelRareCandy();
      return;
    }
    this.host = hostReducer(this.host, { type });
    this.knockedOut = [];
    this.menu = null;
    this.message = "";
    this.persist();
    this.prompt();
    this.emit();
  }
  sidebar(): SimOption[] {
    const h = this.host;
    const v = this.view();
    if (!h || !v)
      return [{ label: "Choose decks", slot: "primary", run: () => this.route("sandbox") }];
    const seat = h.viewerSeat;
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
          ...this.action("Player 1 first", { type: "chooseFirstPlayer", seat, first: "p1" }),
          slot: "primary",
        },
        {
          ...this.action("Player 2 first", { type: "chooseFirstPlayer", seat, first: "p2" }),
          slot: "primary",
        },
        {
          ...this.action(
            "Random",
            {
              type: "chooseFirstPlayer",
              seat,
              first: h.game.phase.kind === "setup:chooseFirst" ? h.game.phase.coinWinner : seat,
            },
            "red",
          ),
          slot: "minor",
        },
      ];
    if (p.kind === "setup:drawExtra")
      return [
        {
          ...this.action(`Draw ${p.owed}`, { type: "setupDrawExtra", seat, count: p.owed }),
          slot: "primary",
        },
        {
          ...this.action("Skip draw", { type: "setupDrawExtra", seat, count: 0 }, "red"),
          slot: "minor",
        },
      ];
    if (p.kind === "setup:place")
      return [{ ...this.action("Ready", { type: "setupReady", seat }), slot: "primary" }];
    if (p.kind === "turn:action") {
      // Attacks, Retreat and Abilities live on the Active card's attached
      // buttons; the panel keeps End turn and the undo/redo history.
      const history = (
        label: string,
        type: "undoAction" | "redoAction" | "undoTurn" | "redoTurn",
      ): SimOption => ({
        label,
        colour: "blue",
        slot: "minor",
        disabled: stepTarget(h, type) === null,
        run: () => this.history(type),
      });
      return [
        { ...this.action("End turn", { type: "endTurn", seat }, "red"), slot: "primary" },
        history("Undo action", "undoAction"),
        history("Redo action", "redoAction"),
        history("Undo turn", "undoTurn"),
        history("Redo turn", "redoTurn"),
      ];
    }
    if (p.kind === "gameOver")
      return [
        {
          label: "New game",
          colour: "red",
          slot: "danger",
          run: () => {
            clearSimulatorSave();
            this.route("sandbox");
          },
        },
      ];
    return [];
  }
  command(raw: string) {
    const [cmd, ...args] = raw.split("\t").map(decodeURIComponent);
    if (cmd === "resume") {
      this.route(loadSimulatorSave() ? "simulator" : "sandbox");
      return;
    }
    if (cmd === "open") {
      this.open();
      return;
    }
    if (cmd === "close") {
      this.active = false;
      this.menu = null;
      this.pendingRareCandy = null;
      return;
    }
    if (!this.active) return;
    if (cmd === "cancelRareCandy") {
      this.cancelRareCandy();
      return;
    }
    if (cmd === "invoke") {
      if (Number(args[0]) === this.revision) this.handlers.get(args[1] ?? "")?.();
      return;
    }
    if (cmd === "dismiss") {
      if (!this.menu?.mandatory) {
        this.menu = null;
        this.emit();
      }
      return;
    }
    if (cmd === "history" && this.host && !this.menu) {
      const kinds = {
        previous: "previousTurn",
        next: "nextTurn",
        undoAction: "undoAction",
        redoAction: "redoAction",
        undoTurn: "undoTurn",
        redoTurn: "redoTurn",
      } as const;
      const type = kinds[args[0] as keyof typeof kinds];
      if (type) this.history(type);
      return;
    }
    if (cmd === "new" && !this.menu) {
      this.choose(
        "Start a new game?",
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
        "This replaces the current saved game.",
      );
      return;
    }
    if (cmd === "newgame") {
      clearSimulatorSave();
      this.route("sandbox");
      return;
    }
    if (cmd === "concede" && this.host && !this.menu) {
      const seat = this.host.viewerSeat;
      this.choose(
        "Concede the game?",
        [this.action("Concede", { type: "concede", seat }, "red")],
        "Your opponent wins immediately.",
      );
      return;
    }
    if (cmd === "leave") {
      this.persist();
      this.route("home");
      return;
    }
    if (cmd === "log" && this.host) {
      this.choose(
        "Game log",
        [],
        this.host.log
          .map((e) =>
            e.kind === "turn"
              ? `turn\t\t\tTurn ${e.turn}`
              : [
                  e.who,
                  e.who === "system" ? "" : (this.host?.names[e.who] ?? ""),
                  e.elapsed,
                  e.segments.map((s) => s.text).join(""),
                ].join("\t"),
          )
          .join("\n"),
        false,
        "log",
      );
      return;
    }
    if (cmd === "pile" && this.host && !this.menu) {
      const v = this.view();
      if (!v) return;
      const piles = this.tablePiles(v);
      const side = args[0] === "opponent" ? piles.opponent : piles.you;
      this.choose(
        args[0] === "opponent" ? "Opponent's discard pile" : "Your discard pile",
        side.discard
          .slice()
          .reverse()
          .map((card) => ({ label: card.name, card, uid: card.id, run: () => {}, disabled: true })),
        side.discard.length ? `${side.discard.length} cards, newest first.` : "No discarded cards.",
        false,
        "pile",
      );
      return;
    }
    if (cmd === "retreat" && this.host && !this.menu) {
      const index = Number(args[0]);
      this.retreat(Number.isInteger(index) && index >= 0 ? index : undefined);
      return;
    }
    if (cmd === "reorder" && this.host && !this.menu) {
      const [zone, uid, index] = args;
      if (zone !== "hand" && zone !== "bench") return;
      const seat = this.host.viewerSeat;
      const side = this.host.game.players[seat];
      const cards =
        zone === "hand"
          ? side.hand
              .filter((id) => id !== this.pendingRareCandy)
              .map((id) => ({ uid: id, key: id }))
          : side.bench.map((body) => ({ uid: body.stack.at(-1), key: body.stack[0] ?? "" }));
      const card = cards.find((c) => c.uid === uid);
      if (!card) return;
      this.cardOrder.move(
        seat,
        zone,
        cards.map((c) => c.key),
        card.key,
        Number(index),
      );
      this.emit();
      return;
    }
    if (cmd === "move" && this.host && !this.menu) {
      const [uid, fromZone, fromIndex, zone, index] = args;
      if (
        !uid ||
        !["hand", "bench", "active"].includes(fromZone ?? "") ||
        !["active", "bench", "playmat", "stadium"].includes(zone ?? "")
      )
        return;
      const h = this.host;
      const phase = this.view()?.phase;
      if (this.pendingRareCandy) {
        const target: PokemonTarget | null =
          zone === "active"
            ? { spot: "active" }
            : zone === "bench" && Number.isInteger(Number(index))
              ? { spot: "bench", index: Number(index) }
              : null;
        if (
          fromZone === "hand" &&
          target &&
          phase?.kind === "turn:action" &&
          phase.rareCandy.some(
            (option) =>
              option.target.spot === target.spot &&
              (option.target.spot !== "bench" ||
                (target.spot === "bench" && option.target.index === target.index)) &&
              option.stage2.some((e) => e.uid === uid),
          )
        ) {
          this.dispatch({
            type: "rareCandy",
            seat: h.viewerSeat,
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
        phase?.kind === "turn:action"
          ? phase.trainers.find((t) => t.uid === uid && t.rareCandy)
          : undefined;
      if (fromZone === "hand" && zone === "playmat" && candy) {
        if (candy.disabled)
          this.message = candy.reason ?? "No valid Rare Candy evolution right now.";
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
          board: projectGameState(h.game, h.viewerSeat).board,
          viewerSeat: h.viewerSeat,
          phaseKind: h.game.phase.kind,
          isViewerTurn: h.game.phase.kind === "turn:action" && h.game.phase.seat === h.viewerSeat,
        },
      );
      if (action) this.dispatch(action);
      else if (fromZone === "hand") {
        this.message = "That card cannot go there right now.";
        this.emit();
      }
    }
  }
  private infoRow(card: Card): string {
    const abilities = (card.abilities ?? [])
      .map((a) => [a.name, a.effect ?? "", a.type ?? "Ability"].join(US))
      .join(RS);
    const attacks = (card.attacks ?? [])
      .map((a) =>
        [
          a.name,
          (a.cost ?? []).join(","),
          a.damage === undefined || a.damage === null ? "" : String(a.damage),
          a.effect ?? "",
        ].join(US),
      )
      .join(RS);
    const wr = (list: { type: string; value?: string }[] | null) =>
      list?.[0] ? `${list[0].type}:${list[0].value ?? ""}` : "";
    return encodeFields(
      [
        "I",
        card.id,
        card.category,
        card.trainerType ?? "",
        card.stage ?? "",
        card.hp ?? "",
        (card.category === "Energy" ? [energyProvidesOf(card)] : (card.types ?? [])).join(","),
        card.retreat ?? "",
        wr(card.weaknesses),
        wr(card.resistances),
        card.effect ?? "",
        abilities,
        attacks,
        card.energyType ?? "",
        card.name,
      ].map((f) => pixelText(String(f))),
    );
  }
  emit() {
    if (!this.active) return;
    const h = this.host;
    const v = this.view();
    this.handlers.clear();
    const rows: string[] = [];
    const art = new Map<string, string>();
    const infoIds = new Set<string>();
    const row = (...fields: (string | number | boolean)[]) =>
      rows.push(encodeFields(fields.map((f) => pixelText(String(f)))));
    let token = 0;
    const register = (o: { run: () => void; disabled?: boolean }) => {
      const id = String(++token);
      if (!o.disabled) this.handlers.set(id, o.run);
      return id;
    };
    const noteArt = (c: RedactedCard | undefined) => {
      if (!c || c.cardId === "hidden" || c.cardId === "empty") return;
      infoIds.add(c.cardId);
      if (c.hasImage) art.set(c.cardId, cardImageUrl(c.cardId, "high"));
    };
    const option = (kind: string, o: SimOption) => {
      row(
        kind,
        register(o),
        o.label,
        o.colour ?? "blue",
        !!o.disabled,
        !!o.selected,
        o.card?.cardId ?? "",
        o.uid ?? "",
      );
      noteArt(o.card);
    };
    const outcome = v?.outcome
      ? v.outcome.result === "tie"
        ? "tie"
        : v.outcome.winner === "you"
          ? "win"
          : "loss"
      : "";
    const title = v?.outcome
      ? v.outcome.result === "tie"
        ? "Draw"
        : `${v.outcome.winner === "you" ? h?.names[h.viewerSeat] : h?.names[otherSeat(h.viewerSeat)]} wins`
      : v?.phase.kind === "setup:chooseFirst"
        ? "Choose who goes first"
        : v?.phase.kind === "setup:place"
          ? "Place your Pokémon"
          : v?.phase.kind === "turn:action"
            ? "Your turn"
            : "Choose your next move";
    let hint = v ? (HINTS[v.phase.kind as keyof typeof HINTS] ?? "") : "Choose two decks to start.";
    if (v?.phase.kind === "setup:drawExtra")
      hint = `Your opponent mulliganed. Draw up to ${v.phase.owed} extra card${v.phase.owed === 1 ? "" : "s"}.`;
    if (v?.phase.kind === "ko:takePrizes")
      hint = `Take ${v.phase.count} Prize card${v.phase.count === 1 ? "" : "s"}.`;
    if (v?.phase.kind === "effect:choose" && v.phase.prompt?.note) hint = v.phase.prompt.note;
    if (v?.phase.kind === "gameOver" && v.outcome?.result === "win")
      hint = GAME_OVER_DETAIL[v.outcome.reason];
    if (this.pendingRareCandy)
      hint = "Drag a Stage 2 onto its Basic Pokemon. Escape cancels Rare Candy.";
    const allow = h?.game.allowances;
    row(
      ++this.revision,
      h ? "ready" : "empty",
      h?.names[h.viewerSeat] ?? "",
      h ? h.names[otherSeat(h.viewerSeat)] : "",
      v?.turn ?? 0,
      v?.phase.kind ?? "",
      this.message,
      title,
      hint,
      h?.turnIndex ?? 0,
      h?.turns.length ?? 0,
      v?.waitingOn ?? "",
      v?.activePlayer ?? "",
      h?.viewerSeat ?? "",
      allow?.energyAttached ? 1 : 0,
      allow?.supporterPlayed ? 1 : 0,
      allow?.retreated ? 1 : 0,
      outcome,
      v?.outcome?.result === "win"
        ? GAME_OVER_DETAIL[v.outcome.reason]
        : outcome === "tie"
          ? "Both players ran out of options."
          : "",
      this.shuffled,
    );
    this.shuffled = "";
    if (this.pendingRareCandy) row("R", this.pendingRareCandy);
    for (const uid of this.knockedOut) row("D", uid);
    if (v && h) {
      const piles = this.tablePiles(v);
      const isViewerTurn =
        h.game.phase.kind === "turn:action" && h.game.phase.seat === h.viewerSeat;
      const canDragHand = v.phase.kind === "setup:place" || isViewerTurn;
      const candyEvolutions = new Set(
        v.phase.kind === "turn:action" && this.pendingRareCandy
          ? v.phase.rareCandy.flatMap((option) => option.stage2.map((e) => e.uid))
          : [],
      );
      for (const owner of ["you", "opponent"] as const) {
        const side = v.board[owner];
        const hand = side.hand.filter((c) => owner !== "you" || c.id !== this.pendingRareCandy);
        const seat = owner === "you" ? h.viewerSeat : otherSeat(h.viewerSeat);
        const benchKeys = side.bench.map((c, i) => h.game.players[seat].bench[i]?.stack[0] ?? c.id);
        const handOrder = this.cardOrder.sorted(
          seat,
          "hand",
          hand.map((c) => c.id),
        );
        const benchOrder = this.cardOrder.sorted(seat, "bench", benchKeys);
        row(
          "S",
          owner,
          side.deckCount,
          side.prizesRemaining,
          hand.length,
          piles[owner].discard.length,
          side.mulliganCount ?? 0,
        );
        const cardRow = (c: RedactedCard, zone: string, index: number) => {
          const b = (c as RedactedInPlay).battle;
          const a = (c as RedactedInPlay).attached;
          const full = c.cardId === "hidden" ? undefined : cardOfUid(h.game, c.id);
          // Attached cards travel as "type|uid|cardId" so Lua can draw the
          // real Energy card tucked behind the Pokémon.
          const energies = (a?.energies ?? []).map((e) => {
            const ec = cardOfUid(h.game, e.id);
            // Catalog basic energies carry no `types`; the name is the datum.
            const type = !ec
              ? "Colorless"
              : ec.energyType === "Special"
                ? "Special"
                : energyProvidesOf(ec);
            return [type, e.id, e.cardId].join("|");
          });
          const tools = (a?.tools ?? []).map((t) => [t.id, t.cardId].join("|"));
          const status = b
            ? [
                b.conditions.rotation !== "none" ? b.conditions.rotation : "",
                b.conditions.poisonDamage > 0 ? "poisoned" : "",
                b.conditions.burned ? "burned" : "",
              ].filter(Boolean)
            : [];
          const draggable =
            owner === "you" &&
            c.cardId !== "hidden" &&
            (!this.pendingRareCandy || (zone === "hand" && candyEvolutions.has(c.id))) &&
            ((zone === "hand" && canDragHand) ||
              (zone === "bench" && (v.phase.kind === "setup:place" || isViewerTurn)) ||
              (zone === "active" && isViewerTurn));
          row(
            "C",
            c.id,
            c.cardId,
            c.name,
            owner,
            zone,
            index,
            c.cardId === "hidden",
            c.category,
            c.trainerType ?? "",
            c.stage ?? full?.stage ?? "",
            b?.hp ?? "",
            b?.damage ?? 0,
            energies.join(","),
            tools.join(","),
            status.join(","),
            (full?.types ?? []).join(","),
            draggable,
            zone === "hand"
              ? handOrder.indexOf(c.id)
              : zone === "bench"
                ? benchOrder.indexOf(benchKeys[index] ?? c.id)
                : index,
          );
          noteArt(c);
          for (const e of a?.energies ?? []) noteArt(e);
          for (const t of a?.tools ?? []) noteArt(t);
        };
        hand.forEach((c, i) => cardRow(c, "hand", i));
        if (side.active) cardRow(side.active, "active", 0);
        side.bench.forEach((c, i) => cardRow(c, "bench", i));
        for (const prize of side.faceUpPrizes) cardRow(prize.card, "prize", prize.index);
        piles[owner].played.forEach((c, i) => cardRow(c, "played", i));
        // Send every public discard in its authoritative order so simultaneous
        // cost discards and turn cleanup can animate without guessing the top.
        piles[owner].discard.forEach((c, i) => cardRow(c, "discard", i));
      }
      if (v.board.stadium) {
        const c = v.board.stadium;
        row(
          "C",
          c.id,
          c.cardId,
          c.name,
          "global",
          "stadium",
          0,
          false,
          c.category,
          c.trainerType ?? "",
          "",
          "",
          0,
          "",
          0,
          "",
          "",
          false,
        );
        noteArt(c);
      }
      if (!this.menu) {
        for (const [uid, actions] of this.cardActions())
          for (const a of actions)
            row(
              "K",
              register(a),
              uid,
              a.label,
              a.colour ?? "blue",
              !!a.disabled,
              a.targetUid ?? "",
              a.group ?? "",
              (a.cost ?? []).join(","),
              a.damage ?? "",
            );
      }
    }
    if (!this.menu)
      for (const o of this.sidebar())
        row("A", register(o), o.label, o.colour ?? "blue", !!o.disabled, o.slot ?? "minor");
    if (this.menu) {
      row(
        "M",
        this.menu.kind,
        this.menu.title,
        this.menu.note ?? "",
        !!this.menu.mandatory,
        this.menuId,
        !!this.menu.hideTargetOutline,
      );
      for (const o of this.menu.options) option("O", o);
      for (const o of this.menu.footer ?? []) option("F", o);
    }
    if (h)
      for (const id of infoIds) {
        const card = h.game.cardPool[id];
        if (card) rows.push(this.infoRow(card));
      }
    this.images([...art].slice(0, 64).map(([id, url]) => ({ id, url })));
    this.publish(rows.join("\n"));
  }
}
