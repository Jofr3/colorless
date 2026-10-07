import { DialogScrollArea } from "../../components/DialogScrollArea";
import type { CSSProperties } from "react";
import { CardImage } from "../../components/CardImage";
import { CheckIcon } from "../../components/icons";
import { useTiltJuice } from "../../components/useTiltJuice";
import { FOCUS_RING_INSET } from "../../lib/glass";
import {
  ATTACHED_CARD_SCALE,
  DEFAULT_ATTACHED_VISIBLE_STICK,
  CROWDED_BENCH_ATTACHED_ENERGY_STICK,
  DEFAULT_BENCH_LIMIT,
} from "../playmat/constants";
import { energyStepForStackSize } from "../playmat/components/Card";
import { shouldCollapseBenchAttachments } from "../playmat/utils/benchLayout";
import type { CardModel } from "../playmat/types";

export const POKEMON_CHOICE_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] items-start gap-4 p-5";

export function PokemonChoices({
  cards,
  benchLimit = DEFAULT_BENCH_LIMIT,
  selectedIndex,
  onSelect,
}: {
  cards: readonly CardModel[];
  benchLimit?: number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const collapsed = shouldCollapseBenchAttachments([...cards], benchLimit);
  const energyStick = collapsed
    ? CROWDED_BENCH_ATTACHED_ENERGY_STICK
    : DEFAULT_ATTACHED_VISIBLE_STICK;
  const hasTools = cards.some((card) => (card.attached?.tools.length ?? 0) > 0);
  const hasEnergy = cards.some((card) => (card.attached?.energies.length ?? 0) > 0);
  // Reserve the same side strips as the bench, keeping every Pokémon the same size.
  const left =
    hasTools && !collapsed ? 1.4 * ATTACHED_CARD_SCALE * DEFAULT_ATTACHED_VISIBLE_STICK : 0;
  const right = hasEnergy ? 1.4 * ATTACHED_CARD_SCALE * energyStick : 0;
  const width = 1 + left + right;
  const spacing: CSSProperties = {
    paddingLeft: `${(left / width) * 100}%`,
    paddingRight: `${(right / width) * 100}%`,
    paddingTop: hasTools && collapsed ? `${((1.4 * 0.12) / width) * 100}%` : undefined,
  };

  return (
    <DialogScrollArea contentClassName={POKEMON_CHOICE_GRID_CLASS} trackInset={20}>
      {cards.map((card, index) => (
        <PokemonChoice
          key={card.id}
          card={card}
          selected={selectedIndex === index}
          onSelect={() => onSelect(index)}
          collapsed={collapsed}
          energyStick={energyStick}
          spacing={spacing}
        />
      ))}
    </DialogScrollArea>
  );
}

/** A promotion preview uses the board's rotated and fanned attachment layout. */
function PokemonChoice({
  card,
  selected,
  onSelect,
  collapsed,
  energyStick,
  spacing,
}: {
  card: CardModel;
  selected: boolean;
  onSelect: () => void;
  collapsed: boolean;
  energyStick: number;
  spacing: CSSProperties;
}) {
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLButtonElement>({ idle: true, pulse: selected ? 1 : null });
  const tools = card.attached?.tools ?? [];
  const energies = card.attached?.energies ?? [];
  const energyStep = energyStepForStackSize(energies.length);
  const previewStyle = {
    ...tiltStyle,
    containerType: "inline-size",
    "--card-w": "100cqi",
    "--card-h": "calc(var(--card-w) * 1.4)",
  } as CSSProperties;

  return (
    <li className="relative min-w-0 hover:z-10 focus-within:z-10" data-pokemon-choice={card.id}>
      <div ref={juiceLayerRef} style={{ ...juiceStyle, ...spacing }}>
        <button
          ref={tiltRef}
          type="button"
          {...handlers}
          style={previewStyle}
          aria-label={card.name}
          aria-pressed={selected}
          onClick={onSelect}
          className={`block w-full cursor-pointer rounded-xl text-left ${FOCUS_RING_INSET}`}
        >
          <span className="relative isolate block aspect-[2.5/3.5]">
            {tools.map((tool, index) => (
              <span
                key={tool.id}
                className={`playmat-card__attached ${collapsed ? "playmat-card__attached--tool-behind playmat-card__attached--tool-behind-bottom" : "playmat-card__attached--tool"}`}
                style={{
                  visibility: "visible",
                  transform: collapsed ? undefined : "rotate(-90deg)",
                  zIndex: index,
                }}
                title={tool.name}
              >
                <CardImage
                  fill
                  imageUrl={tool.imageUrl}
                  alt={`Attached ${tool.name}`}
                  className="h-full w-full rounded-[9px] object-cover shadow-md"
                />
              </span>
            ))}
            {energies.map((energy, index) => (
              <span
                key={energy.id}
                className="playmat-card__attached playmat-card__attached--energy"
                style={
                  {
                    visibility: "visible",
                    transform: "rotate(90deg)",
                    zIndex: tools.length + index,
                    "--attached-stack": String(index),
                    "--attached-energy-step": energyStep,
                    "--attached-stick": String(energyStick),
                  } as CSSProperties
                }
                title={energy.name}
              >
                <CardImage
                  fill
                  imageUrl={energy.imageUrl}
                  alt={`Attached ${energy.name}`}
                  className="h-full w-full rounded-[9px] object-cover shadow-md"
                />
              </span>
            ))}
            <span
              className={`relative block h-full w-full overflow-hidden rounded-xl shadow-lg ring-2 ${selected ? "ring-accent" : "ring-white/10"}`}
              style={{ zIndex: tools.length + energies.length }}
            >
              <CardImage
                fill
                imageUrl={card.imageUrl}
                alt={card.name}
                className="h-full w-full object-cover"
              />
              {selected && (
                <span
                  aria-hidden
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-zinc-950 shadow-lg"
                >
                  <CheckIcon className="h-4 w-4" />
                </span>
              )}
              {(card.battle?.damage ?? 0) > 0 && (
                <span className="absolute bottom-2 left-2 rounded-full bg-rose-600 px-2 py-1 text-xs font-bold text-white shadow-lg">
                  {card.battle?.damage} dmg
                </span>
              )}
            </span>
          </span>
        </button>
      </div>
    </li>
  );
}
