import type { EffectChoice, GameAction, PokemonRef } from "@colorless/engine";
import type { RedactedEffectPrompt, RedactedCard, RedactedGame } from "@colorless/schema";
import type { SimMenu, SimOption, ThemeColour } from "./simulatorTypes";

/** What an effect menu reads and rewrites as its picks change. */
export interface MenuHost {
  view(): RedactedGame | null;
  action(label: string, action: GameAction, colour?: ThemeColour): SimOption;
  menu: SimMenu | null;
  emit(): void;
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
}

interface MenuContext {
  state: MenuState;
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

const confirmPrompt: MenuBuilder<PromptOf<"confirm">> = (menu, prompt, ctx) => {
  const { state, confirm, refName, refUid } = ctx;
  const targets = prompt.targets ?? [];
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

const choosePokemon: MenuBuilder<PromptOf<"choosePokemon">> = (menu, prompt, ctx) => {
  const { state, transfer, confirm, refName, refUid } = ctx;
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

const chooseCards: MenuBuilder<PromptOf<"chooseCards" | "orderCards">> = (menu, prompt, ctx) => {
  const { selected } = ctx.state;
  menu.kind = "cards";
  menu.title = prompt.kind === "orderCards" ? "Choose card order" : "";
  if (prompt.kind === "chooseCards") menu.note = undefined;
  menu.options = prompt.candidates.map((c) =>
    ctx.pick(
      c.id,
      `${prompt.kind === "orderCards" && selected.includes(c.id) ? `${selected.indexOf(c.id) + 1}. ` : ""}${c.name}`,
      c,
      c.id,
    ),
  );
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
  menu.options = prompt.discardable.map((c) =>
    ctx.pick(c.uid, `${card(c.uid)?.name ?? "Card"} — ${refName(c.from)}`, card(c.uid), c.uid),
  );
  menu.footer = [ctx.confirm({ kind: prompt.kind, uids: [...ctx.state.selected] })];
};

const assignCards: MenuBuilder<PromptOf<"attachCards" | "moveEnergy">> = (menu, prompt, ctx) => {
  const { assignments } = ctx.state;
  const targets = prompt.kind === "attachCards" ? prompt.targets : prompt.destinations;
  const cards =
    prompt.kind === "attachCards"
      ? prompt.candidates
      : prompt.movable.map((c) => ctx.card(c.uid)).filter((c): c is RedactedCard => !!c);
  menu.kind = "cards";
  menu.title = prompt.kind === "attachCards" ? "Attach cards" : "Move Energy";
  menu.note = `${prompt.note ?? ""}\nClick each card to cycle its destination; unselected cards stay put.`;
  menu.options = cards.map((c) => {
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
  const pairs = [...assignments].flatMap(([uid, i]) => {
    const to = targets[i];
    return to ? [{ uid, to }] : [];
  });
  menu.footer = [
    ctx.confirm(
      prompt.kind === "attachCards"
        ? { kind: "attachCards", assignments: pairs }
        : { kind: "moveEnergy", picks: pairs.map((p) => ({ uid: p.uid, dest: p.to })) },
    ),
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
  attachCards: assignCards,
  moveEnergy: assignCards,
};

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
  const ctx: MenuContext = {
    state,
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
    (BUILDERS[prompt.kind] as MenuBuilder<RedactedEffectPrompt>)(menu, prompt, ctx);
    return menu;
  };
  return build();
}
