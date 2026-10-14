import {
  applyAction,
  cardOfUid,
  otherSeat,
  redactGame,
  type GameAction,
  type PokemonTarget,
} from "@luminous/engine";
import type { RedactedCard, RedactedInPlay, RedactedGame } from "@luminous/schema";
import { encodeFields } from "./account";
import { initHost, hostReducer } from "../game/useLocalGame";
import { projectGameState, GAME_OVER_DETAIL } from "../game/projection";
import { moveToAction } from "../game/moveToAction";
import { loadSimulatorSave, saveSimulator, clearSimulatorSave } from "../playmat/simulatorSave";
import { cardImageUrl } from "../../lib/api";
import { effectMenu } from "./simulatorChoices";

export interface SimOption {
  label: string;
  run: () => void;
  disabled?: boolean;
  selected?: boolean;
  card?: RedactedCard;
  colour?: string;
}
export interface SimMenu {
  title: string;
  note?: string;
  options: SimOption[];
  footer?: SimOption[];
  mandatory?: boolean;
}
/** Lua renders a full table. The existing local host remains the sole rules/state owner. */
export class LuaSimulator {
  host: ReturnType<typeof initHost> | null = null;
  menu: SimMenu | null = null;
  message = "";
  revision = 0;
  private menuId = 0;
  private active = false;
  private handlers = new Map<string, () => void>();
  constructor(
    private publish: (raw: string) => void,
    private route: (page: string) => void,
    private images: (cards: { id: string; url: string }[]) => void = () => {},
  ) {}
  view(): RedactedGame | null {
    return this.host && redactGame(this.host.game, this.host.viewerSeat);
  }
  allowed(action: GameAction) {
    return !!this.host && applyAction(this.host.game, action).ok;
  }
  dispatch(action: GameAction) {
    if (!this.host) return;
    this.host = hostReducer(this.host, { action, at: Date.now() });
    const flips = this.host.coinFlipPresentation ? this.host.coinFlipBatch : null;
    // The Lua result dialog replaces the React dice presentation.
    if (this.host.coinFlipPresentation && this.host.coinFlipBatch) {
      this.host = hostReducer(this.host, {
        type: "finishCoinFlip",
        id: this.host.coinFlipBatch.id,
      });
    }
    this.message = this.host.lastError?.message ?? "";
    if (!this.host.lastError) {
      this.menu = null;
      this.persist();
      this.prompt();
      if (flips)
        this.menu = {
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
      },
    });
    if (loadSimulatorSave()?.startedAt !== h.startedAt)
      this.message = "Could not save this game. Browser storage may be full.";
  }
  open(setup = loadSimulatorSave()) {
    this.active = true;
    this.menu = null;
    this.message = "";
    this.host = setup ? initHost(setup) : null;
    if (this.host) this.prompt();
    this.emit();
  }
  action(label: string, action: GameAction, colour = "blue"): SimOption {
    return { label, colour, disabled: !this.allowed(action), run: () => this.dispatch(action) };
  }
  choose(title: string, options: SimOption[], note = "", mandatory = false) {
    this.menuId++;
    this.menu = { title, options, note, mandatory };
    this.emit();
  }
  prompt() {
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
          title: "Take Prize cards",
          note: `Choose ${p.count} Prize cards.`,
          mandatory: true,
          options: Array.from({ length: v.board.you.prizesRemaining }, (_, i) => ({
            label: `Prize ${i + 1}`,
            selected: picked.has(i),
            run: () => {
              if (picked.has(i)) picked.delete(i);
              else if (picked.size < p.count) picked.add(i);
              draw();
              this.emit();
            },
          })),
          footer: [this.action("Confirm", { type: "takePrizes", seat, prizeIndices: [...picked] })],
        };
      };
      draw();
    } else if (p.kind === "ko:promote") {
      this.menu = {
        title: "Choose your Active Pokemon",
        mandatory: true,
        options: v.board.you.bench.map((c, i) => ({
          ...this.action(c.name, { type: "promote", seat, benchIndex: i }),
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
  inspect(uid: string) {
    const v = this.view();
    const h = this.host;
    if (!v || !h) return;
    const seat = h.viewerSeat;
    const p = v.phase;
    const card = [
      ...v.board.you.hand,
      ...this.targets().map((t) => t.card),
      ...v.board.opponent.bench,
      ...(v.board.opponent.active ? [v.board.opponent.active] : []),
      ...(v.board.stadium ? [v.board.stadium] : []),
    ].find((c) => c.id === uid);
    if (!card || card.cardId === "hidden") return;
    const options: SimOption[] = [];
    if (v.board.you.hand.some((c) => c.id === uid)) {
      if (p.kind === "setup:place") {
        options.push(
          this.action("Place Active", { type: "setupPlaceActive", seat, uid }),
          this.action("Place on Bench", { type: "setupPlaceBench", seat, uid }),
        );
      } else if (p.kind === "turn:action") {
        if (card.category === "Pokemon")
          options.push(this.action("Play to Bench", { type: "playBasicToBench", seat, uid }));
        if (card.category === "Trainer") {
          const trainer = p.trainers.find((t) => t.uid === uid);
          if (trainer?.rareCandy) {
            for (const target of p.rareCandy)
              for (const evolution of target.stage2)
                options.push(
                  this.action(`${target.basicName} → ${evolution.name}`, {
                    type: "rareCandy",
                    seat,
                    uid,
                    target: target.target,
                    evolutionUid: evolution.uid,
                  }),
                );
          } else options.push(this.action("Play card", { type: "playTrainer", seat, uid }));
        }
        const type =
          card.category === "Energy"
            ? "attachEnergy"
            : card.category === "Pokemon"
              ? "evolve"
              : card.trainerType === "Tool" || card.trainerType === "Pokémon Tool"
                ? "attachTool"
                : null;
        if (type)
          for (const { card: targetCard, target } of this.targets())
            options.push(
              this.action(`${type === "evolve" ? "Evolve" : "Attach to"} ${targetCard.name}`, {
                type,
                seat,
                uid,
                target,
              }),
            );
      }
    } else if (p.kind === "turn:action") {
      const target = this.targets().find((t) => t.card.id === uid);
      if (target) {
        if (target.target.spot === "active") {
          p.attacks.forEach((a, index) =>
            options.push(
              this.action(
                `${a.name}${a.damage ? ` · ${a.damage}` : ""}`,
                { type: "attack", seat, index },
                "red",
              ),
            ),
          );
          if (p.retreat?.can) options.push({ label: "Retreat", run: () => this.retreat() });
        }
        for (const a of p.abilities)
          if (JSON.stringify(a.target) === JSON.stringify(target.target))
            options.push(
              this.action(a.abilityName, {
                type: "useAbility",
                seat,
                target: a.target,
                abilityName: a.abilityName,
              }),
            );
        for (const a of p.discardable ?? [])
          if (JSON.stringify(a.target) === JSON.stringify(target.target))
            options.push(this.action(a.label, { type: "discardFromPlay", seat, target: a.target }));
      }
      if (v.board.stadium?.id === uid && p.stadiumAbility)
        options.push(this.action(p.stadiumAbility.label, { type: "useStadiumAbility", seat }));
    }
    const full = cardOfUid(h.game, uid);
    const body = card as RedactedInPlay;
    const note = [
      full?.effect,
      ...(full?.abilities ?? []).map((a) => `${a.name}: ${a.effect}`),
      ...(full?.attacks ?? []).map((a) => `${a.name} (${a.damage ?? "—"}): ${a.effect ?? ""}`),
      ...(body.attached?.energies ?? []).map((c) => `Energy: ${c.name}`),
      ...(body.attached?.tools ?? []).map((c) => `Tool: ${c.name}`),
    ]
      .filter(Boolean)
      .join("\n");
    this.choose(
      card.name,
      [{ label: card.name, card, run: () => {}, disabled: true }, ...options],
      note,
    );
  }
  retreat() {
    this.menuId++;
    const h = this.host;
    const v = this.view();
    if (!h || !v || v.phase.kind !== "turn:action") return;
    const seat = h.viewerSeat;
    const picked = new Set<string>();
    let bench = 0;
    const draw = () => {
      this.menu = {
        title: "Retreat",
        note: `Choose a Benched Pokemon and Energy to pay the retreat cost (${v.phase.kind === "turn:action" ? (v.phase.retreat?.cost ?? 0) : 0}).`,
        options: [
          ...v.board.you.bench.map((c, i) => ({
            label: c.name,
            card: c,
            selected: bench === i,
            run: () => {
              bench = i;
              draw();
              this.emit();
            },
          })),
          ...(v.board.you.active?.attached?.energies ?? []).map((c) => ({
            label: `Discard ${c.name}`,
            card: c,
            selected: picked.has(c.id),
            run: () => {
              if (picked.has(c.id)) picked.delete(c.id);
              else picked.add(c.id);
              draw();
              this.emit();
            },
          })),
        ],
        footer: [
          this.action("Retreat", {
            type: "retreat",
            seat,
            discardEnergy: [...picked],
            promoteBenchIndex: bench,
          }),
        ],
      };
    };
    draw();
    this.emit();
  }
  sidebar(): SimOption[] {
    const h = this.host;
    const v = this.view();
    if (!h || !v) return [{ label: "Choose decks", run: () => this.route("sandbox") }];
    const seat = h.viewerSeat;
    const p = v.phase;
    if (p.kind === "setup:chooseFirst")
      return [
        this.action("Player 1 first", { type: "chooseFirstPlayer", seat, first: "p1" }),
        this.action("Player 2 first", { type: "chooseFirstPlayer", seat, first: "p2" }),
        this.action("Random", {
          type: "chooseFirstPlayer",
          seat,
          first: h.game.phase.kind === "setup:chooseFirst" ? h.game.phase.coinWinner : seat,
        }),
      ];
    if (p.kind === "setup:drawExtra")
      return [
        this.action(`Draw ${p.owed}`, { type: "setupDrawExtra", seat, count: p.owed }),
        this.action("Skip draw", { type: "setupDrawExtra", seat, count: 0 }),
      ];
    if (p.kind === "setup:place") return [this.action("Ready", { type: "setupReady", seat })];
    if (p.kind === "turn:action")
      return [
        {
          label: "Attack",
          colour: "blue",
          disabled: !p.attacks.length,
          run: () =>
            this.choose(
              "Choose an attack",
              p.attacks.map((a, index) =>
                this.action(
                  `${a.name}${a.damage ? ` · ${a.damage}` : ""}`,
                  { type: "attack", seat, index },
                  "blue",
                ),
              ),
            ),
        },
        {
          label: "Abilities",
          disabled: !p.abilities.length && !p.stadiumAbility,
          run: () =>
            this.choose("Abilities", [
              ...p.abilities.map((a) =>
                this.action(a.label, {
                  type: "useAbility",
                  seat,
                  target: a.target,
                  abilityName: a.abilityName,
                }),
              ),
              ...(p.stadiumAbility
                ? [this.action(p.stadiumAbility.label, { type: "useStadiumAbility", seat })]
                : []),
            ]),
        },
        { label: "Retreat", disabled: !p.retreat?.can, run: () => this.retreat() },
        this.action("End turn", { type: "endTurn", seat }, "red"),
      ];
    if (p.kind === "gameOver")
      return [
        {
          label: "New game",
          colour: "red",
          run: () => {
            clearSimulatorSave();
            this.route("sandbox");
          },
        },
      ];
    return [
      {
        label: "Continue",
        run: () => {
          this.prompt();
          this.emit();
        },
      },
    ];
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
      return;
    }
    if (!this.active) return;
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
    if (cmd === "card" && !this.menu) {
      this.inspect(args[0] ?? "");
      return;
    }
    if (cmd === "history" && this.host && !this.menu) {
      this.host = hostReducer(this.host, {
        type: args[0] === "previous" ? "previousTurn" : "nextTurn",
      });
      this.message = "";
      this.persist();
      this.prompt();
      this.emit();
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
              ? `Turn ${e.turn}`
              : `${e.elapsed} ${e.segments.map((s) => s.text).join("")}`,
          )
          .join("\n"),
      );
      return;
    }
    if (cmd === "pile" && this.host && !this.menu) {
      const v = this.view();
      if (!v) return;
      const side = args[0] === "opponent" ? v.board.opponent : v.board.you;
      this.choose(
        "Discard pile",
        side.discard.map((card) => ({ label: card.name, card, run: () => {}, disabled: true })),
        side.discard.length ? "" : "No discarded cards.",
      );
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
    }
  }
  emit() {
    if (!this.active) return;
    const h = this.host;
    const v = this.view();
    this.handlers.clear();
    const rows: string[] = [];
    const art = new Map<string, string>();
    const row = (...fields: (string | number | boolean)[]) =>
      rows.push(encodeFields(fields.map(String)));
    let token = 0;
    const option = (kind: string, o: SimOption) => {
      const id = String(++token);
      if (!o.disabled) this.handlers.set(id, o.run);
      row(kind, id, o.label, o.colour ?? "blue", !!o.disabled, !!o.selected, o.card?.cardId ?? "");
      if (o.card?.hasImage) art.set(o.card.cardId, cardImageUrl(o.card.cardId, "high"));
    };
    const title = v?.outcome
      ? v.outcome.result === "tie"
        ? "Draw"
        : `${v.outcome.winner === "you" ? h?.names[h.viewerSeat] : h?.names[otherSeat(h.viewerSeat)]} wins`
      : v?.phase.kind === "setup:chooseFirst"
        ? "Choose who goes first"
        : v?.phase.kind === "setup:place"
          ? "Place your Pokemon"
          : v?.phase.kind === "turn:action"
            ? "Your turn"
            : "Choose your next move";
    row(
      ++this.revision,
      h ? "ready" : "empty",
      h?.names[h.viewerSeat] ?? "",
      h ? h.names[otherSeat(h.viewerSeat)] : "",
      v?.turn ?? 0,
      v?.phase.kind ?? "",
      this.message,
      title,
      h?.turnIndex ?? 0,
      h?.turns.length ?? 0,
    );
    if (v) {
      for (const owner of ["you", "opponent"] as const) {
        const side = v.board[owner];
        row("S", owner, side.deckCount, side.prizesRemaining, side.hand.length);
        const cardRow = (c: RedactedCard, zone: string, index: number) => {
          const b = (c as RedactedInPlay).battle;
          const a = (c as RedactedInPlay).attached;
          row(
            "C",
            c.id,
            c.cardId,
            c.name,
            owner,
            zone,
            index,
            c.cardId === "hidden",
            b?.hp ?? "",
            b?.damage ?? 0,
            a?.energies.length ?? 0,
            b
              ? [
                  b.conditions.rotation !== "none" ? b.conditions.rotation : "",
                  b.conditions.poisonDamage > 0 ? "Poisoned" : "",
                  b.conditions.burned ? "Burned" : "",
                ]
                  .filter(Boolean)
                  .join(", ")
              : "",
          );
          if (c.hasImage) art.set(c.cardId, cardImageUrl(c.cardId, "high"));
        };
        side.hand.forEach((c, i) => cardRow(c, "hand", i));
        if (side.active) cardRow(side.active, "active", 0);
        side.bench.forEach((c, i) => cardRow(c, "bench", i));
        for (const prize of side.faceUpPrizes) cardRow(prize.card, "prize", prize.index);
        const topDiscard = side.discard.at(-1);
        if (topDiscard) cardRow(topDiscard, "discard", 0);
      }
      if (v.board.stadium) {
        const c = v.board.stadium;
        row("C", c.id, c.cardId, c.name, "global", "stadium", 0, false, "", 0, 0, "");
        if (c.hasImage) art.set(c.cardId, cardImageUrl(c.cardId, "high"));
      }
      if (v.outcome?.result === "win") row("N", GAME_OVER_DETAIL[v.outcome.reason]);
    }
    if (!this.menu) for (const o of this.sidebar()) option("A", o);
    if (this.menu) {
      row("M", this.menu.title, this.menu.note ?? "", !!this.menu.mandatory, this.menuId);
      for (const o of this.menu.options) option("O", o);
      for (const o of this.menu.footer ?? []) option("F", o);
    }
    this.images([...art].slice(0, 60).map(([id, url]) => ({ id, url })));
    this.publish(rows.join("\n"));
  }
}
