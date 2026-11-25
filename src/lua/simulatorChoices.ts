import type { EffectChoice, GameAction, PokemonRef } from "@colorless/engine";
import type { RedactedEffectPrompt, RedactedCard, RedactedGame } from "@colorless/schema";
import { applyTrayView, defaultTrayView, type TrayViewState } from "./simulatorTray";
import type { SimAttach, SimMenu, SimOption, StagedAttach, ThemeColour } from "./simulatorTypes";

/** What an effect menu reads and rewrites as its picks change. */
export interface MenuHost {
  view(): RedactedGame | null;
  action(label: string, action: GameAction, colour?: ThemeColour): SimOption;
  menu: SimMenu | null;
  emit(): void;
  trayView?: TrayViewState;
  energyTypeOf?: (cardId: string) => string | null | undefined;
  /** What makes copies interchangeable to the engine: a Basic Energy's type, else its print. */
  pileKeyOf?: (cardId: string) => string;
  /** Remembers cards dropped on a target whose card question the engine asks next. */
  stageAttach?: (staged: StagedAttach) => void;
}

type PromptKind = RedactedEffectPrompt["kind"];
type PromptOf<K extends PromptKind> = Extract<RedactedEffectPrompt, { kind: K }>;

/** Per-menu picks that survive each rebuild of the menu. */
interface MenuState {
  selected: string[];
  assignments: Map<string, number>;
  amount: number;
  target: number;
  sourceSelected: boolean;
  showHand: boolean;
}

interface MenuContext {
  state: MenuState;
  trayView: TrayViewState;
  energyTypeOf?: (cardId: string) => string | null | undefined;
  pileKeyOf: (cardId: string) => string;
  placingCounters: boolean;
  invokedBy: string | undefined;
  abilityName: string | undefined;
  transfer: PromptOf<"choosePokemon">["counterTransfer"];
  refName: (ref: PokemonRef) => string;
  refUid: (ref: PokemonRef) => string;
  card: (uid: string) => RedactedCard | undefined;
  confirm: (choice: EffectChoice, label?: string, colour?: ThemeColour) => SimOption;
  pick: (id: string, label: string, face?: RedactedCard, uid?: string) => SimOption;
  refresh: () => void;
  stageAttach: (staged: StagedAttach) => void;
}

type MenuBuilder<P extends RedactedEffectPrompt> = (
  menu: SimMenu,
  prompt: P,
  ctx: MenuContext,
) => void;

const mayDraw: MenuBuilder<PromptOf<"mayDraw">> = (menu, prompt, { confirm }) => {
  menu.title = "Draw cards";
  menu.options = [
    confirm({ kind: "mayDraw", draw: true }, `Draw ${prompt.count}`),
    confirm({ kind: "mayDraw", draw: false }, "Skip", "red"),
  ];
};

/**
 * The drag-to-attach stage: `assignments` maps a card uid to its target's index. Past `max` a drop
 * is refused, except that a one-card attach swaps the earlier pick back to the hand. The drop that
 * fills the attach (`max` cards, or every offered card) submits it.
 */
function attachStage(
  cards: readonly RedactedCard[],
  targets: readonly PokemonRef[],
  limits: { max: number; maxPerTarget?: number; oneTarget?: true },
  ctx: MenuContext,
  submit: (assignments: ReadonlyMap<string, number>) => void,
): SimAttach {
  const { assignments } = ctx.state;
  const assigned = new Map<string, string>();
  for (const [uid, i] of assignments) {
    const to = targets[i];
    if (to) assigned.set(uid, ctx.refUid(to));
  }
  return {
    cards,
    assigned,
    showHand: ctx.state.showHand,
    toggleHand: () => {
      ctx.state.showHand = !ctx.state.showHand;
      ctx.refresh();
    },
    assign: (uid, targetUid) => {
      const to = targets.findIndex((t) => ctx.refUid(t) === targetUid);
      if (to < 0) return "Drop it on a Pokémon that can take it.";
      if (!cards.some((c) => c.id === uid)) return "That card is not part of this attach.";
      let next = new Map(assignments).set(uid, to);
      if (next.size > limits.max) {
        if (limits.max !== 1) return `You can attach up to ${limits.max} cards.`;
        next = new Map([[uid, to]]);
      }
      const perTarget = limits.maxPerTarget;
      if (perTarget !== undefined && [...next.values()].filter((i) => i === to).length > perTarget)
        return `Up to ${perTarget} card${perTarget === 1 ? "" : "s"} can go on each Pokémon.`;
      if (limits.oneTarget && new Set(next.values()).size > 1)
        return "Attach them all to the same Pokémon.";
      assignments.clear();
      for (const [k, v] of next) assignments.set(k, v);
      if (next.size >= Math.min(limits.max, cards.length)) submit(next);
      else ctx.refresh();
      return "";
    },
  };
}

/** Board options naming the targets, so Lua marks them; a drop, not a click, assigns. */
function attachTargets(targets: readonly PokemonRef[], ctx: MenuContext): SimOption[] {
  return targets.map((ref) => ({ label: ctx.refName(ref), uid: ctx.refUid(ref), run: () => {} }));
}

/**
 * At most `max` interchangeable copies (`pileKeyOf`), so a pile reads as its choices: the engine
 * asks no card question between them and takes the first.
 */
function collapsePile(
  cards: readonly RedactedCard[],
  max: number,
  pileKeyOf: (cardId: string) => string,
): RedactedCard[] {
  const seen = new Map<string, number>();
  return cards.filter((c) => {
    const key = pileKeyOf(c.cardId);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n < max;
  });
}

/** `option` with `before` run first, as when a footer button stages its drops. */
function first(option: SimOption, before: () => void): SimOption {
  return {
    ...option,
    run: () => {
      before();
      option.run();
    },
  };
}

/** The attachCards answer for `assignments`, each card paired with its target. */
function attachChoice(
  assignments: ReadonlyMap<string, number>,
  targets: readonly PokemonRef[],
): EffectChoice {
  return {
    kind: "attachCards",
    assignments: [...assignments].flatMap(([uid, i]) => {
      const to = targets[i];
      return to ? [{ uid, to }] : [];
    }),
  };
}

/**
 * Crispin's split: both Energy wait in the hand, and the dropped card says yes or no. A prompt with
 * one card (the wire allows it; Crispin no longer asks one) gets a button that declines instead.
 */
const confirmAttach = (
  menu: SimMenu,
  prompt: PromptOf<"confirm">,
  cards: { yes: RedactedCard; no?: RedactedCard },
  targets: readonly PokemonRef[],
  ctx: MenuContext,
) => {
  const { confirm } = ctx;
  const faces = cards.no === undefined ? [cards.yes] : [cards.yes, cards.no];
  menu.kind = "attach";
  menu.title = prompt.note || "Attach Energy";
  menu.note = "";
  menu.options = attachTargets(targets, ctx);
  menu.attach = attachStage(faces, targets, { max: 1 }, ctx, (assignments) => {
    const [picked] = [...assignments];
    const target = picked && targets[picked[1]];
    if (picked && target)
      confirm({ kind: "confirm", yes: picked[0] === cards.yes.id, target }).run();
  });
  menu.footer =
    cards.no === undefined
      ? [
          confirm(
            { kind: "confirm", yes: false },
            prompt.labels?.no ?? "Keep it in your hand",
            "red",
          ),
        ]
      : [];
};

const confirmPrompt: MenuBuilder<PromptOf<"confirm">> = (menu, prompt, ctx) => {
  const { state, confirm, refName, refUid } = ctx;
  const targets = prompt.targets ?? [];
  if (prompt.cards && targets.length) {
    confirmAttach(menu, prompt, prompt.cards, targets, ctx);
    return;
  }
  menu.title =
    ctx.invokedBy === "ability"
      ? `Do you want to use ${ctx.abilityName ?? "this Ability"}?`
      : prompt.note || "Confirm";
  menu.note = targets.length ? "Choose a Pokémon, then confirm." : prompt.note;
  menu.kind = targets.length ? "board" : "list";
  menu.options = targets.map((ref, i) => ({
    label: refName(ref),
    uid: refUid(ref),
    selected: state.target === i,
    run: () => {
      state.target = i;
      ctx.refresh();
    },
  }));
  const chosen = targets[state.target];
  menu.footer = [
    confirm(
      { kind: "confirm", yes: true, ...(chosen ? { target: chosen } : {}) },
      prompt.labels?.yes ?? "Yes",
      "green",
    ),
    confirm({ kind: "confirm", yes: false }, prompt.labels?.no ?? "No", "red"),
  ];
};

const guessHp: MenuBuilder<PromptOf<"guessHp">> = (menu, prompt, { state, confirm, refresh }) => {
  menu.title = `Guess ${prompt.name}'s HP`;
  menu.options = [
    {
      label: `HP: ${state.amount}  (-10)`,
      run: () => {
        state.amount = Math.max(0, state.amount - 10);
        refresh();
      },
    },
    {
      label: `HP: ${state.amount}  (+10)`,
      run: () => {
        state.amount += 10;
        refresh();
      },
    },
  ];
  menu.footer = [confirm({ kind: "hpGuess", hp: state.amount })];
};

const chooseAttack: MenuBuilder<PromptOf<"chooseAttack">> = (menu, prompt, { confirm }) => {
  menu.title = "Choose an attack";
  menu.options = prompt.candidates.map((c) =>
    confirm({ kind: "attack", index: c.index }, c.name, "red"),
  );
};

const choosePrize: MenuBuilder<PromptOf<"choosePrize">> = (menu, prompt, { confirm }) => {
  menu.kind = "prizes";
  menu.title = "Choose a Prize";
  menu.note = prompt.note || "Click one of your Prize cards.";
  menu.options = prompt.indices.map((index) => ({
    ...confirm({ kind: "prize", index }, `Prize ${index + 1}`),
    uid: `prize:${index}`,
  }));
};

/**
 * An Energy attach's target question with its pile shown: one drop answers which Pokémon and, with
 * `upTo`, how many (the cards dropped on it). The dropped cards are staged, so the card question
 * that may follow is answered by the same drop.
 */
const attachPokemon = (
  menu: SimMenu,
  prompt: PromptOf<"choosePokemon">,
  pile: readonly RedactedCard[],
  ctx: MenuContext,
) => {
  const { confirm } = ctx;
  const targets = prompt.candidates;
  const upTo = prompt.upTo;
  const cards = collapsePile(pile, upTo ?? 1, ctx.pileKeyOf);
  menu.kind = "attach";
  menu.title = "Attach Energy";
  menu.note = "";
  menu.options = attachTargets(targets, ctx);
  const answer = (assignments: ReadonlyMap<string, number>): EffectChoice => {
    const [picked] = assignments.values();
    const ref = picked === undefined ? undefined : targets[picked];
    if (!ref) return { kind: "pokemon" };
    return { kind: "pokemon", ref, ...(upTo ? { take: assignments.size } : {}) };
  };
  const stage = (assignments: ReadonlyMap<string, number>) => {
    const [picked] = assignments.values();
    const ref = picked === undefined ? undefined : targets[picked];
    if (!ref) return;
    ctx.stageAttach({
      cards: cards.filter((c) => assignments.has(c.id)),
      targetUid: ctx.refUid(ref),
    });
  };
  const limits = upTo ? { max: upTo, oneTarget: true as const } : { max: 1 };
  menu.attach = attachStage(cards, targets, limits, ctx, (assignments) =>
    first(confirm(answer(assignments)), () => stage(assignments)).run(),
  );
  const { assignments } = ctx.state;
  if (upTo)
    menu.footer = [
      assignments.size === 0
        ? confirm({ kind: "pokemon" }, "Skip", "red")
        : first(confirm(answer(assignments), "Done", "green"), () => stage(assignments)),
    ];
};

const choosePokemon: MenuBuilder<PromptOf<"choosePokemon">> = (menu, prompt, ctx) => {
  const { state, transfer, confirm, refName, refUid } = ctx;
  if (prompt.attachPile && !transfer) {
    attachPokemon(menu, prompt, prompt.attachPile, ctx);
    return;
  }
  menu.kind = "board";
  menu.title = "Choose a Pokémon";
  if (transfer) {
    menu.counterTransfer = true;
    if (state.sourceSelected && transfer.from) menu.counterSourceUid = refUid(transfer.from);
    menu.title =
      state.sourceSelected && transfer.from ? "Move damage counters" : "Choose a damaged Pokémon";
    if (!state.sourceSelected && transfer.from) {
      menu.note = `Choose your Pokémon to move up to ${transfer.upTo} damage counters from.`;
      menu.options = [
        {
          label: refName(transfer.from),
          uid: refUid(transfer.from),
          run: () => {
            state.sourceSelected = true;
            ctx.refresh();
          },
        },
      ];
      return;
    }
  }
  menu.options = prompt.candidates.map((ref) => ({
    ...confirm(
      { kind: "pokemon", ref, ...(prompt.upTo ? { take: state.amount } : {}) },
      refName(ref),
    ),
    uid: refUid(ref),
  }));
  if (prompt.upTo)
    menu.footer = [
      {
        label: `Amount: ${state.amount}`,
        run: () => {
          state.amount = (state.amount % (prompt.upTo ?? 1)) + 1;
          ctx.refresh();
        },
      },
      confirm({ kind: "pokemon" }, "Skip", "red"),
    ];
};

const choosePokemonMulti: MenuBuilder<PromptOf<"choosePokemonMulti">> = (menu, prompt, ctx) => {
  const { state, confirm, refName, refUid } = ctx;
  if (prompt.attachPile) {
    // A short spread: one card each onto the Pokémon it is dropped on.
    const targets = prompt.candidates;
    menu.kind = "attach";
    menu.title = "Attach Energy";
    menu.note = "";
    menu.options = attachTargets(targets, ctx);
    menu.attach = attachStage(
      prompt.attachPile,
      targets,
      { max: prompt.max, maxPerTarget: 1 },
      ctx,
      (assignments) =>
        confirm({
          kind: "pokemonMulti",
          refs: [...assignments.values()].flatMap((i) => {
            const ref = targets[i];
            return ref ? [ref] : [];
          }),
        }).run(),
    );
    return;
  }
  menu.kind = "board";
  if (ctx.placingCounters && prompt.max === 1) {
    menu.title = "Place damage counters";
    menu.options = prompt.candidates.map((ref) => ({
      ...confirm({ kind: "pokemonMulti", refs: [ref] }, refName(ref)),
      uid: refUid(ref),
    }));
    if (prompt.declinable)
      menu.footer = [confirm({ kind: "pokemonMulti", refs: [] }, "Skip", "red")];
    return;
  }
  menu.title = `Choose Pokémon (${state.selected.length}/${prompt.max})`;
  menu.options = prompt.candidates.map((ref, i) => ({
    ...ctx.pick(String(i), refName(ref)),
    uid: refUid(ref),
  }));
  menu.footer = [
    confirm({
      kind: "pokemonMulti",
      refs: state.selected.flatMap((i) => {
        const ref = prompt.candidates[Number(i)];
        return ref ? [ref] : [];
      }),
    }),
  ];
};

/** A card pick onto one known Pokémon (the Energy for a picked target, a Tool onto itself). */
const attachOnto = (
  menu: SimMenu,
  prompt: PromptOf<"chooseCards">,
  onto: PokemonRef,
  ctx: MenuContext,
) => {
  const { confirm } = ctx;
  const targets = [onto];
  const answer = (assignments: ReadonlyMap<string, number>): EffectChoice => ({
    kind: "cards",
    uids: [...assignments.keys()],
  });
  menu.kind = "attach";
  menu.title = "Attach cards";
  menu.note = "";
  menu.options = attachTargets(targets, ctx);
  menu.attach = attachStage(
    collapsePile(prompt.candidates, prompt.max, ctx.pileKeyOf),
    targets,
    { max: prompt.max },
    ctx,
    (assignments) => confirm(answer(assignments)).run(),
  );
  const { assignments } = ctx.state;
  menu.footer =
    assignments.size === 0
      ? prompt.min === 0
        ? [confirm({ kind: "cards", uids: [] }, "Skip", "red")]
        : []
      : [
          ...(assignments.size >= prompt.min
            ? [confirm(answer(assignments), "Done", "green")]
            : []),
        ];
};

const chooseCards: MenuBuilder<PromptOf<"chooseCards" | "orderCards">> = (menu, prompt, ctx) => {
  if (prompt.kind === "chooseCards" && prompt.dest === "attach" && prompt.onto) {
    attachOnto(menu, prompt, prompt.onto, ctx);
    return;
  }
  const { selected } = ctx.state;
  menu.kind = "cards";
  menu.title = prompt.kind === "orderCards" ? "Choose card order" : "";
  if (prompt.kind === "chooseCards") menu.note = undefined;
  const options = prompt.candidates.map((c) =>
    ctx.pick(
      c.id,
      `${prompt.kind === "orderCards" && selected.includes(c.id) ? `${selected.indexOf(c.id) + 1}. ` : ""}${c.name}`,
      c,
      c.id,
    ),
  );
  if (prompt.kind === "chooseCards") {
    const view = applyTrayView(options, {
      view: ctx.trayView,
      pool: prompt.pool,
      onChange: ctx.refresh,
      energyTypeOf: ctx.energyTypeOf,
    });
    menu.header = view.header;
    menu.options = view.options;
  } else {
    menu.options = options;
  }
  menu.footer = [
    ctx.confirm(
      {
        kind: prompt.kind === "orderCards" ? "orderCards" : "cards",
        uids: [...selected],
      },
      prompt.kind === "chooseCards" ? `${selected.length}/${prompt.max}` : "Confirm",
    ),
  ];
};

const discardAttached: MenuBuilder<PromptOf<"discardEnergy" | "discardTools">> = (
  menu,
  prompt,
  ctx,
) => {
  const { card, refName } = ctx;
  menu.kind = "cards";
  menu.title = prompt.kind === "discardTools" ? "Discard Tools" : "Discard Energy";
  const options = prompt.discardable.map((c) =>
    ctx.pick(c.uid, `${card(c.uid)?.name ?? "Card"} — ${refName(c.from)}`, card(c.uid), c.uid),
  );
  const view = applyTrayView(options, {
    view: ctx.trayView,
    onChange: ctx.refresh,
    energyTypeOf: ctx.energyTypeOf,
    groupKeyOf: (o) => o.label,
  });
  menu.header = view.header;
  menu.options = view.options;
  menu.footer = [ctx.confirm({ kind: prompt.kind, uids: [...ctx.state.selected] })];
};

/** Attach from hand, deck, discard or the deck's top: the offered cards replace the hand. */
const attachCards: MenuBuilder<PromptOf<"attachCards">> = (menu, prompt, ctx) => {
  menu.kind = "attach";
  menu.title = "Attach cards";
  menu.note = prompt.note;
  menu.options = attachTargets(prompt.targets, ctx);
  menu.attach = attachStage(prompt.candidates, prompt.targets, prompt, ctx, (assignments) =>
    ctx.confirm(attachChoice(assignments, prompt.targets)).run(),
  );
  // Short of a full attach, "Done" attaches what was dropped. A mandatory attach cannot be
  // skipped, since the engine would attach a card anyway.
  const { assignments } = ctx.state;
  menu.footer =
    assignments.size > 0
      ? [ctx.confirm(attachChoice(assignments, prompt.targets), "Done", "green")]
      : prompt.mandatory
        ? []
        : [ctx.confirm(attachChoice(assignments, prompt.targets), "Skip", "red")];
};

/**
 * The drag-to-move stage: the movable Energy is lifted into the hand strip, and dropping one on a
 * destination moves it there; dropped on its own Pokémon, it stays. The prompt's couplings
 * (one source, one destination, `max`) refuse a drop with a message.
 */
function moveStage(
  menu: SimMenu,
  prompt: PromptOf<"moveEnergy">,
  cards: readonly RedactedCard[],
  ctx: MenuContext,
) {
  const { assignments } = ctx.state;
  const targets = prompt.destinations;
  const from = new Map(prompt.movable.map((m) => [m.uid, ctx.refUid(m.from)]));
  const assigned = new Map<string, string>();
  for (const [uid, i] of assignments) {
    const to = targets[i];
    if (to) assigned.set(uid, ctx.refUid(to));
  }
  const answer = (moves: ReadonlyMap<string, number>): EffectChoice => ({
    kind: "moveEnergy",
    picks: [...moves].flatMap(([uid, i]) => {
      const dest = targets[i];
      return dest ? [{ uid, dest }] : [];
    }),
  });
  const { max } = prompt;
  menu.kind = "attach";
  menu.title = "Move Energy";
  menu.note = "";
  menu.options = attachTargets(targets, ctx);
  const sources = new Set(from.values());
  if (sources.size === 1) menu.counterSourceUid = [...sources][0];
  menu.attach = {
    cards,
    assigned,
    from,
    showHand: ctx.state.showHand,
    toggleHand: () => {
      ctx.state.showHand = !ctx.state.showHand;
      ctx.refresh();
    },
    assign: (uid, targetUid) => {
      const source = from.get(uid);
      if (source === undefined) return "That card is not part of this move.";
      if (targetUid === source) {
        assignments.delete(uid);
        ctx.refresh();
        return "";
      }
      const to = targets.findIndex((t) => ctx.refUid(t) === targetUid);
      if (to < 0) return "Move it onto one of the Pokémon this effect allows.";
      let next = new Map(assignments).set(uid, to);
      if (next.size > max) {
        if (max !== 1) return `You can move up to ${max} Energy.`;
        next = new Map([[uid, to]]);
      }
      if (!prompt.anySource && new Set([...next.keys()].map((u) => from.get(u))).size > 1)
        return "Move them all from the same Pokémon.";
      if (!prompt.anyDest && new Set(next.values()).size > 1)
        return "Move them all to the same Pokémon.";
      assignments.clear();
      for (const [k, v] of next) assignments.set(k, v);
      if (next.size >= Math.min(max, cards.length)) ctx.confirm(answer(next)).run();
      else ctx.refresh();
      return "";
    },
  };
  const floor = prompt.min ?? 0;
  menu.footer =
    assignments.size === 0 && floor === 0
      ? [ctx.confirm({ kind: "moveEnergy", picks: [] }, "Skip", "red")]
      : [
          {
            ...ctx.confirm(answer(assignments), "Done", "green"),
            ...(assignments.size < Math.max(floor, 1) ? { disabled: true } : {}),
          },
        ];
}

const moveEnergy: MenuBuilder<PromptOf<"moveEnergy">> = (menu, prompt, ctx) => {
  const cards = prompt.movable.map((c) => ctx.card(c.uid));
  if (cards.length > 0 && cards.every((c) => c !== undefined)) {
    moveStage(menu, prompt, cards as RedactedCard[], ctx);
    return;
  }
  moveTray(menu, prompt, ctx);
};

/** The card tray a move falls back to when a movable card is not on the board (mid-KO). */
const moveTray: MenuBuilder<PromptOf<"moveEnergy">> = (menu, prompt, ctx) => {
  const { assignments } = ctx.state;
  const targets = prompt.destinations;
  const cards = prompt.movable.map((c) => ctx.card(c.uid)).filter((c): c is RedactedCard => !!c);
  menu.kind = "cards";
  menu.title = "Move Energy";
  menu.note = `${prompt.note ?? ""}\nClick each card to cycle its destination; unselected cards stay put.`;
  const options = cards.map((c) => {
    const to = targets[assignments.get(c.id) ?? -1];
    return {
      label: `${c.name}: ${to ? ctx.refName(to) : "stays"}`,
      card: c,
      uid: c.id,
      selected: assignments.has(c.id),
      disabled: !assignments.has(c.id) && prompt.max <= 0,
      dimmed: !assignments.has(c.id) && assignments.size >= prompt.max,
      run: () => {
        if (!assignments.has(c.id)) {
          if (prompt.max <= 0) return;
          if (targets.length && assignments.size >= prompt.max) {
            const oldest = assignments.keys().next().value;
            if (oldest !== undefined) assignments.delete(oldest);
          }
        }
        const next = (assignments.get(c.id) ?? -1) + 1;
        if (next >= targets.length) assignments.delete(c.id);
        else assignments.set(c.id, next);
        ctx.refresh();
      },
    };
  });
  const sourceByUid = new Map(prompt.movable.map((m) => [m.uid, ctx.refUid(m.from)]));
  const view = applyTrayView(options, {
    view: ctx.trayView,
    onChange: ctx.refresh,
    energyTypeOf: ctx.energyTypeOf,
    groupKeyOf: (o) => sourceByUid.get(o.uid ?? "") ?? "",
  });
  menu.header = view.header;
  menu.options = view.options;
  const pairs = [...assignments].flatMap(([uid, i]) => {
    const to = targets[i];
    return to ? [{ uid, to }] : [];
  });
  menu.footer = [
    ctx.confirm({ kind: "moveEnergy", picks: pairs.map((p) => ({ uid: p.uid, dest: p.to })) }),
  ];
};

const BUILDERS: { [K in PromptKind]: MenuBuilder<PromptOf<K>> } = {
  mayDraw,
  confirm: confirmPrompt,
  guessHp,
  chooseAttack,
  choosePrize,
  choosePokemon,
  choosePokemonMulti,
  chooseCards,
  orderCards: chooseCards,
  discardEnergy: discardAttached,
  discardTools: discardAttached,
  attachCards,
  moveEnergy,
};

export const UPDATE_TITLE = "Reload to update";
export const UPDATE_NOTE = "This choice needs a newer version of the page.";

/** Shared engine prompt shapes, rendered by Lua as button lists, real card
 * rows (the pack picker), board targets or prize slots. Board/prize menus name
 * the top-card uid / prize slot so the table itself becomes the picker. */
export function effectMenu(
  sim: MenuHost,
  prompt: RedactedEffectPrompt,
  selectedCounterSource?: PokemonRef,
): SimMenu {
  const view = sim.view();
  if (!view) return { kind: "list", title: "No game", options: [] };
  const seat = view.seat;
  const phase = view.phase.kind === "effect:choose" ? view.phase : undefined;
  const placingCounters = prompt.kind === "choosePokemonMulti" && prompt.unit === "counters";
  // The redacted board names each in-play top card and its attachments by uid.
  const body = (ref: PokemonRef) => {
    const side = ref.seat === seat ? view.board.you : view.board.opponent;
    return ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  };
  const refName = (ref: PokemonRef) =>
    `${ref.seat === seat ? "You" : "Opponent"}: ${body(ref)?.name ?? "Pokemon"}`;
  const refUid = (ref: PokemonRef) => body(ref)?.id ?? "";
  const attached = [view.board.you, view.board.opponent]
    .flatMap((side) => [side.active, ...side.bench])
    .flatMap((p) => [...(p?.attached?.energies ?? []), ...(p?.attached?.tools ?? [])]);
  const transfer = prompt.kind === "choosePokemon" ? prompt.counterTransfer : undefined;
  const state: MenuState = {
    selected: [],
    assignments: new Map(),
    amount: prompt.kind === "choosePokemon" ? (prompt.upTo ?? 1) : 100,
    target: 0,
    showHand: false,
    // The engine forces a lone damaged source. Still let the player identify it
    // before presenting destinations, just as when several sources are eligible.
    sourceSelected:
      !transfer?.from ||
      (!!selectedCounterSource && refUid(selectedCounterSource) === refUid(transfer.from)),
  };
  const { selected } = state;
  const nextSelection = (id: string): string[] | null => {
    if (selected.includes(id)) return selected.filter((uid) => uid !== id);
    let max = Number.POSITIVE_INFINITY;
    if (prompt.kind === "chooseCards" || prompt.kind === "choosePokemonMulti") {
      max = prompt.max;
    }
    if (prompt.kind === "discardEnergy" || prompt.kind === "discardTools") {
      if (prompt.scope.kind === "total") max = prompt.scope.count;
      if (prompt.scope.kind === "upTo") max = prompt.scope.max;
    }
    if (max <= 0) return null;
    // Selection order is insertion order, independent of the grid's card order.
    const next = [...selected];
    while (next.length >= max) next.shift();
    next.push(id);
    if (prompt.kind === "chooseCards") {
      if (prompt.caps?.some((cap) => next.filter((uid) => cap.uids.includes(uid)).length > cap.max))
        return null;
      if (
        prompt.capsAnyOf &&
        !prompt.capsAnyOf.some(
          (cap) => next.length <= cap.max && next.every((uid) => cap.uids.includes(uid)),
        )
      )
        return null;
    }
    if (prompt.kind === "discardEnergy" || prompt.kind === "discardTools") {
      const scope = prompt.scope;
      if (scope.kind === "each") {
        const source = prompt.discardable.find((c) => c.uid === id)?.from;
        if (source)
          return next.filter(
            (uid) =>
              uid === id ||
              !prompt.discardable.some((c) => c.uid === uid && refUid(c.from) === refUid(source)),
          );
      }
    }
    return next;
  };
  const trayView = sim.trayView ?? defaultTrayView();
  const ctx: MenuContext = {
    state,
    trayView,
    energyTypeOf: sim.energyTypeOf,
    pileKeyOf: sim.pileKeyOf ?? ((cardId) => cardId),
    placingCounters,
    invokedBy: phase?.invokedBy,
    abilityName: phase?.abilityName,
    transfer,
    refName,
    refUid,
    card: (uid) => attached.find((c) => c.id === uid),
    confirm: (choice, label = "Confirm", colour = "blue") =>
      sim.action(label, { type: "resolveEffect", seat, choice }, colour),
    pick: (id, label, face, uid = "") => ({
      label,
      card: face,
      uid,
      selected: selected.includes(id),
      disabled: nextSelection(id) === null,
      dimmed: !selected.includes(id) && (nextSelection(id)?.length ?? 0) <= selected.length,
      run: () => {
        const next = nextSelection(id);
        if (!next) return;
        selected.splice(0, selected.length, ...next);
        ctx.refresh();
      },
    }),
    refresh: () => {
      sim.menu = build();
      sim.emit();
    },
    stageAttach: (staged) => sim.stageAttach?.(staged),
  };
  const build = (): SimMenu => {
    const menu: SimMenu = {
      kind: "list",
      title: "Choose",
      note: prompt.note,
      options: [],
      mandatory: true,
      hideTargetOutline:
        placingCounters || (prompt.kind === "choosePokemon" && !!prompt.counterTransfer),
    };
    // A prompt kind from a server newer than this page (backend-data.md §3.7.1).
    const builder = BUILDERS[prompt.kind] as MenuBuilder<RedactedEffectPrompt> | undefined;
    if (builder === undefined) return { ...menu, title: UPDATE_TITLE, note: UPDATE_NOTE };
    builder(menu, prompt, ctx);
    return menu;
  };
  return build();
}
