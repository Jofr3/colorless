import { energyProvidesOf, otherSeat } from "@colorless/engine";
import type {
  Card,
  RedactedCard,
  RedactedGame,
  RedactedGameOverReason,
  RedactedInPlay,
} from "@colorless/schema";
import { cardImageUrl } from "../lib/api";
import type { SimCardAction, SimMenu, SimOption } from "./simulator";
import type { SimulatorOrder } from "./simulatorOrder";
import type { TableSource } from "./tableSource";
import { encodeFields, pixelText } from "./wire";

/** Why the game ended, as one line. A total `Record`, so a new reason is a compile error here. */
const GAME_OVER_DETAIL: Record<RedactedGameOverReason, string> = {
  prizesTaken: "All prize cards taken.",
  noPokemon: "No Pokémon left in play.",
  deckOut: "No cards left to draw.",
  conceded: "The match was forfeited.",
  // A card's printed win condition (N's Sigilyph "Victory Symbol").
  cardEffect: "A card's effect won the game.",
};

const RS = "\x1e";
const US = "\x1f";
const HINTS = {
  "setup:chooseFirst": "Choose who goes first.",
  "setup:place": "Drag a Basic Pokémon to your Active spot, then fill your Bench and press Ready.",
  "turn:action": "Attach Energy, play Trainers and Pokémon, then attack or end your turn.",
  "ko:takePrizes": "Take your Prize cards.",
  "ko:promote": "Choose a new Active Pokémon from your Bench.",
  "effect:choose": "Resolve the card effect.",
  gameOver: "The game is over.",
} as const;

/** What the simulator holds when it emits; the row builders read nothing else. */
export interface EmitState {
  src: TableSource | null;
  view: RedactedGame | null;
  names: { you: string; opponent: string } | undefined;
  online: boolean;
  turns: { index: number; count: number } | undefined;
  message: string;
  pendingRareCandy: string | null;
  knockedOut: readonly string[];
  menu: SimMenu | null;
  menuId: number;
  cardOrder: SimulatorOrder;
  now: number;
}

/** One-shot events an emit takes, so each reaches Lua exactly once. */
export interface EmitEvents {
  /** "you" / "opponent" / "both" / "". */
  shuffled: string;
}

/** The staged Items/Supporters and the rest of each discard. */
export type TablePiles = Record<
  "you" | "opponent",
  { played: RedactedCard[]; discard: RedactedCard[] }
>;

/** One emit's rows with the handlers, artwork and info cards they mention.
 * The builders below write into a fresh frame and touch nothing else. */
export class EmitFrame {
  readonly rows: string[] = [];
  readonly handlers = new Map<string, () => void>();
  readonly art = new Map<string, string>();
  readonly menuArt: ([string, string] | null)[] = [];
  readonly infoIds = new Set<string>();
  private token = 0;
  row(...fields: (string | number | boolean)[]) {
    this.rows.push(encodeFields(fields.map((f) => pixelText(String(f)))));
  }
  register(o: { run: () => void; disabled?: boolean }) {
    const id = String(++this.token);
    if (!o.disabled) this.handlers.set(id, o.run);
    return id;
  }
  noteArt(c: RedactedCard | undefined) {
    if (!c || c.cardId === "hidden" || c.cardId === "empty") return;
    this.infoIds.add(c.cardId);
    if (c.hasImage) this.art.set(c.cardId, cardImageUrl(c.cardId, "high"));
  }
  option(kind: "O" | "F", o: SimOption) {
    this.row(
      kind,
      this.register(o),
      o.label,
      o.colour ?? "blue",
      !!o.disabled,
      !!o.selected,
      o.card?.cardId ?? "",
      o.uid ?? "",
      !!o.dimmed,
    );
    if (kind === "O") {
      const c = o.card;
      this.menuArt.push(
        c?.hasImage && c.cardId !== "hidden" && c.cardId !== "empty"
          ? [c.cardId, cardImageUrl(c.cardId, "high")]
          : null,
      );
      if (c && c.cardId !== "hidden" && c.cardId !== "empty") this.infoIds.add(c.cardId);
    } else this.noteArt(o.card);
  }
}

/** The header's outcome key, title and hint for the viewer's current phase. */
export function headerText(
  v: RedactedGame | null,
  names: { you: string; opponent: string } | undefined,
  online: boolean,
  rareCandyPending: boolean,
) {
  const outcome = v?.outcome
    ? v.outcome.result === "tie"
      ? "tie"
      : v.outcome.winner === "you"
        ? "win"
        : "loss"
    : "";
  let title = v?.outcome
    ? v.outcome.result === "tie"
      ? "Draw"
      : `${v.outcome.winner === "you" ? names?.you : names?.opponent} wins`
    : v?.phase.kind === "setup:chooseFirst"
      ? "Choose who goes first"
      : v?.phase.kind === "setup:place"
        ? "Place your Pokémon"
        : v?.phase.kind === "turn:action"
          ? "Your turn"
          : "Choose your next move";
  let hint = v ? (HINTS[v.phase.kind as keyof typeof HINTS] ?? "") : "Choose two decks to start.";
  if (v?.phase.kind === "setup:drawExtra") hint = "Drawing mulligan bonus cards.";
  if (v?.phase.kind === "ko:takePrizes")
    hint = `Take ${v.phase.count} Prize card${v.phase.count === 1 ? "" : "s"}.`;
  if (v?.phase.kind === "effect:choose" && v.phase.prompt?.note) hint = v.phase.prompt.note;
  if (v?.phase.kind === "gameOver" && v.outcome?.result === "win")
    hint = GAME_OVER_DETAIL[v.outcome.reason];
  if (online && v && names && !v.outcome) {
    const them = names.opponent;
    // Online, only a rematch's loser chooses; a first game's order is the coin's.
    if (v.phase.kind === "setup:chooseFirst" && v.waitingOn !== "you")
      hint = `${them} lost the last game and is choosing who goes first.`;
    else if (v.phase.kind === "setup:chooseFirst")
      hint = "You lost the last game. Choose who goes first.";
    else if (v.phase.kind === "setup:place" && v.phase.ready.you)
      hint = `Waiting for ${them} to finish placing.`;
    else if (v.waitingOn === "opponent") hint = `Waiting for ${them}...`;
    if (v.phase.kind === "turn:action" && v.activePlayer === "opponent") title = `${them}'s turn`;
  }
  if (rareCandyPending) hint = "Drag a Stage 2 onto its Basic Pokemon. Escape cancels Rare Candy.";
  return { outcome, title, hint };
}

export function headerRow(f: EmitFrame, s: EmitState, revision: number, events: EmitEvents) {
  const { src, view: v, names } = s;
  const { outcome, title, hint } = headerText(v, names, s.online, !!s.pendingRareCandy);
  const allow = src?.allowances();
  f.row(
    revision,
    src ? "ready" : "empty",
    names?.you ?? "",
    names ? names.opponent : "",
    v?.turn ?? 0,
    v?.phase.kind ?? "",
    s.message,
    title,
    hint,
    s.turns?.index ?? 0,
    s.turns?.count ?? 0,
    v?.waitingOn ?? "",
    v?.activePlayer ?? "",
    v?.seat ?? "",
    allow?.energy ? 1 : 0,
    allow?.supporter ? 1 : 0,
    allow?.retreated ? 1 : 0,
    outcome,
    v?.outcome?.result === "win"
      ? GAME_OVER_DETAIL[v.outcome.reason]
      : outcome === "tie"
        ? "Both players ran out of options."
        : "",
    events.shuffled,
    src?.matchId() ?? "",
  );
}

/** `L`: the table's mode and presence; `R`: a pending Rare Candy; `D`: knock-outs. */
export function tableRows(f: EmitFrame, s: EmitState) {
  const { src } = s;
  if (src) {
    const life = src.lifecycle();
    const away = life.opponentAway;
    // awayMs: the forfeit clock at emit time (Lua counts down from receipt),
    // -1 away with no clock, '' present.
    f.row(
      "L",
      src.mode,
      src.spectating,
      away?.name ?? "",
      !away ? "" : away.forfeitAt === null ? -1 : Math.max(0, away.forfeitAt - s.now),
      life.flags.join(","),
      s.online ? "partial" : "full",
    );
  }
  if (s.pendingRareCandy) f.row("R", s.pendingRareCandy);
  for (const uid of s.knockedOut) f.row("D", uid);
}

/** `S` per side, then `C` for every visible card and the Stadium. */
export function boardRows(
  f: EmitFrame,
  s: EmitState,
  v: RedactedGame,
  src: TableSource,
  piles: TablePiles,
) {
  const candy = s.pendingRareCandy;
  const isViewerTurn = v.phase.kind === "turn:action" && v.activePlayer === "you";
  const canDragHand = v.phase.kind === "setup:place" || isViewerTurn;
  const candyEvolutions = new Set(
    v.phase.kind === "turn:action" && candy
      ? v.phase.rareCandy.flatMap((option) => option.stage2.map((e) => e.uid))
      : [],
  );
  for (const owner of ["you", "opponent"] as const) {
    const side = v.board[owner];
    const hand = side.hand.filter((c) => owner !== "you" || c.id !== candy);
    const seat = owner === "you" ? v.seat : otherSeat(v.seat);
    const benchKeys = side.bench.map((c, i) => src.benchKey(owner, i) || c.id);
    const handOrder = s.cardOrder.sorted(
      seat,
      "hand",
      hand.map((c) => c.id),
    );
    const benchOrder = s.cardOrder.sorted(seat, "bench", benchKeys);
    f.row(
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
      const full = c.cardId === "hidden" ? undefined : src.face(c);
      // Attached cards travel as "type|uid|cardId" so Lua can draw the
      // real Energy card tucked behind the Pokémon.
      const energies = (a?.energies ?? []).map((e) => {
        const ec = src.face(e);
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
        (!candy || (zone === "hand" && candyEvolutions.has(c.id))) &&
        ((zone === "hand" && canDragHand) ||
          (zone === "bench" && (v.phase.kind === "setup:place" || isViewerTurn)) ||
          (zone === "active" && isViewerTurn));
      f.row(
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
      f.noteArt(c);
      for (const e of a?.energies ?? []) f.noteArt(e);
      for (const t of a?.tools ?? []) f.noteArt(t);
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
    f.row(
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
      "",
      "",
      "",
      false,
      0,
    );
    f.noteArt(c);
  }
}

/** `K`: the buttons attached to each card. */
export function cardActionRows(f: EmitFrame, actions: Map<string, SimCardAction[]>) {
  for (const [uid, list] of actions)
    for (const a of list)
      f.row(
        "K",
        f.register(a),
        uid,
        a.label,
        a.colour ?? "blue",
        !!a.disabled,
        a.targetUid ?? "",
        a.group ?? "",
        (a.cost ?? []).join(","),
        a.damage ?? "",
        a.cost !== undefined,
      );
}

/** `A`: the sidebar, kept behind a dialog without registering its actions. */
export function sidebarRows(f: EmitFrame, options: SimOption[], menuOpen: boolean) {
  for (const o of options)
    f.row(
      "A",
      menuOpen ? "" : f.register(o),
      o.label,
      o.colour ?? "blue",
      !!o.disabled,
      o.slot ?? "minor",
    );
}

/** `M` and its `O` options and `F` footer. */
export function menuRows(f: EmitFrame, menu: SimMenu, menuId: number) {
  f.row(
    "M",
    menu.kind,
    menu.title,
    menu.note ?? "",
    !!menu.mandatory,
    menuId,
    !!menu.hideTargetOutline,
    menu.counterSourceUid ?? "",
    !!menu.counterTransfer,
  );
  for (const o of menu.options) f.option("O", o);
  for (const o of menu.footer ?? []) f.option("F", o);
}

/** `I`: the catalogue text of every card the frame mentions. */
export function infoRows(f: EmitFrame, src: TableSource) {
  for (const id of f.infoIds) {
    const card = src.card(id);
    if (card) f.rows.push(infoRow(card));
  }
}

function infoRow(card: Card): string {
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
