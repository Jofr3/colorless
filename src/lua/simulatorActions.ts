import type { GameAction, PokemonTarget } from "@colorless/engine";
import type { RedactedCard, RedactedGame } from "@colorless/schema";
import type { SimCardAction, SimMenu, SimOption, ThemeColour } from "./simulatorTypes";

/** How a built option reaches the table: the gate that greys it out, and the send behind it. */
export interface ActionHost {
  allowed(action: GameAction): boolean;
  dispatch(action: GameAction): void;
  /** Opens Retreat's first step, the Benched Pokémon to switch in. */
  retreat?(): void;
}

export function actionOption(
  host: ActionHost,
  label: string,
  action: GameAction,
  colour: ThemeColour = "blue",
): SimOption {
  return { label, colour, disabled: !host.allowed(action), run: () => host.dispatch(action) };
}

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

/** The viewer's in-play Pokémon, each with the target that names it. */
function ownTargets(v: RedactedGame): { card: RedactedCard; target: PokemonTarget }[] {
  const active = v.board.you.active;
  return [
    ...(active ? [{ card: active, target: { spot: "active" } as PokemonTarget }] : []),
    ...v.board.you.bench.map((card, index) => ({
      card,
      target: { spot: "bench", index } as PokemonTarget,
    })),
  ];
}

/** Every action a card offers right now, keyed by its uid (own hand and
 * in-play cards, plus the Stadium's ability). A staged Rare Candy offers only
 * its evolutions, and Cancel on the Candy itself. */
export function cardActions(
  v: RedactedGame,
  host: ActionHost,
  staged: { uid: string; cancel: () => void } | null,
): Map<string, SimCardAction[]> {
  const out = new Map<string, SimCardAction[]>();
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
  ) => push(uid, { ...actionOption(host, label, action, colour), ...extra });
  if (staged && p.kind === "turn:action") {
    for (const option of p.rareCandy) {
      for (const evolution of option.stage2) {
        act(
          evolution.uid,
          `Evolve ${option.basicName}`,
          {
            type: "rareCandy",
            seat,
            uid: staged.uid,
            target: option.target,
            evolutionUid: evolution.uid,
          },
          "green",
          { targetUid: option.basicUid, group: "evolve" },
        );
      }
    }
    push(staged.uid, { label: "Cancel", colour: "orange", run: staged.cancel });
    return out;
  }
  const targets = ownTargets(v);
  for (const card of v.board.you.hand) {
    const uid = card.id;
    if (p.kind === "setup:place") {
      act(uid, "Place Active", { type: "setupPlaceActive", seat, uid });
      act(uid, "Place on Bench", { type: "setupPlaceBench", seat, uid });
    } else if (p.kind === "turn:action") {
      if (card.category === "Pokemon") {
        act(uid, "Bench", { type: "playBasicToBench", seat, uid });
        for (const { card: targetCard, target } of targets)
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
          for (const { card: targetCard, target } of targets)
            act(
              uid,
              `Attach to ${targetCard.name}`,
              { type: "attachTool", seat, uid, target },
              "blue",
              { targetUid: targetCard.id, group: "tool" },
            );
        } else act(uid, "Play", { type: "playTrainer", seat, uid });
      } else if (card.category === "Energy") {
        for (const { card: targetCard, target } of targets)
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
    for (const { card, target } of targets) {
      const uid = card.id;
      for (const a of p.abilities)
        if (JSON.stringify(a.target) === JSON.stringify(target))
          push(uid, {
            label: a.abilityName,
            colour: "red",
            group: "ability",
            disabled: a.disabled,
            run: () =>
              host.dispatch({
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
        // The keyboard's way to retreat; a pointer can also drag the Active onto the Bench.
        const retreat = p.retreat;
        push(uid, {
          label: "Retreat",
          colour: "blue",
          group: "retreat",
          disabled: !retreat?.can,
          cost: Array<string>(retreat?.cost ?? 0).fill("Colorless"),
          run: () => host.retreat?.(),
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
        run: () => host.dispatch({ type: "useStadiumAbility", seat }),
      });
  }
  return out;
}

/** Retreat's first step: the Benched Pokémon to switch in, picked on the table. */
export function retreatBenchMenu(v: RedactedGame, pick: (bench: number) => void): SimMenu {
  const cost = v.phase.kind === "turn:action" ? (v.phase.retreat?.cost ?? 0) : 0;
  return {
    kind: "board",
    title: "Retreat to which Pokémon?",
    options: v.board.you.bench.map((c, i) => ({
      label: c.name,
      uid: c.id,
      card: c,
      run: () => pick(i),
    })),
    note: cost ? `Retreat cost: ${cost} Energy.` : "Retreating is free.",
    mandatory: false,
  };
}

/** The retreat to `bench` when the Energy it discards is no choice: free, every
 * attached Energy, or all of it the same card (paid from the first ones). */
export function forcedRetreat(v: RedactedGame, bench: number): GameAction | null {
  if (v.phase.kind !== "turn:action") return null;
  const cost = v.phase.retreat?.cost ?? 0;
  const energies = v.board.you.active?.attached?.energies ?? [];
  const allAlike = energies.every((c) => c.cardId === energies[0]?.cardId);
  if (cost !== 0 && energies.length > cost && !allAlike) return null;
  return {
    type: "retreat",
    seat: v.seat,
    discardEnergy: energies.slice(0, cost).map((c) => c.id),
    promoteBenchIndex: bench,
  };
}

/** Retreat's Energy picker: the attached Energy as a card row, then Discard
 * once exactly the cost is picked. */
export function retreatEnergyMenu(
  v: RedactedGame,
  bench: number,
  picked: ReadonlySet<string>,
  toggle: (uid: string) => void,
  host: ActionHost,
): SimMenu {
  const cost = v.phase.kind === "turn:action" ? (v.phase.retreat?.cost ?? 0) : 0;
  const energies = v.board.you.active?.attached?.energies ?? [];
  return {
    kind: "cards",
    title: "",
    note: `Choose ${cost} Energy to discard.`,
    options: energies.map((c) => ({
      label: c.name,
      card: c,
      uid: c.id,
      selected: picked.has(c.id),
      run: () => toggle(c.id),
    })),
    footer: [
      {
        label: "Discard",
        colour: "blue",
        disabled: picked.size !== cost,
        run: () =>
          host.dispatch({
            type: "retreat",
            seat: v.seat,
            discardEnergy: [...picked],
            promoteBenchIndex: bench,
          }),
      },
    ],
  };
}

/** A Knocked Out Active's replacement, picked on the table. */
export function promoteMenu(v: RedactedGame, host: ActionHost): SimMenu {
  return {
    kind: "board",
    title: "Choose your new Active Pokémon",
    note: "Click a Benched Pokémon.",
    mandatory: true,
    hideTargetOutline: true,
    options: v.board.you.bench.map((c, i) => ({
      ...actionOption(host, c.name, { type: "promote", seat: v.seat, benchIndex: i }),
      uid: c.id,
      card: c,
    })),
  };
}
