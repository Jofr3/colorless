import {
  ATTACHED_CARD_SCALE,
  BENCH_LIMIT,
  CROWDED_BENCH_ATTACHED_ENERGY_STICK,
  CROWDED_BENCH_THRESHOLD,
  DEFAULT_ATTACHED_VISIBLE_STICK,
  FRAME_CLASS,
} from "../constants";
import type { CardModel, PlayerId, SidePosition } from "../types";
import { PlaymatCard } from "./Card";

// Mirrors the visible-strip math in playmat.css `.playmat-card__attached`
// (card-h * scale * stick). Kept here so we can reserve the same width as
// inter-slot margin when a bench card has an attachment that would
// otherwise be covered by its neighbour.
const ATTACHED_STRIP = `calc(var(--card-h) * ${ATTACHED_CARD_SCALE} * ${DEFAULT_ATTACHED_VISIBLE_STICK})`;
const CROWDED_BENCH_ENERGY_STRIP = `calc(var(--card-h) * ${ATTACHED_CARD_SCALE} * ${CROWDED_BENCH_ATTACHED_ENERGY_STICK})`;

export function Bench({
  cards,
  owner,
  side,
}: {
  cards: CardModel[];
  owner: PlayerId;
  side: SidePosition;
}) {
  const isCrowdedBench = cards.length > CROWDED_BENCH_THRESHOLD;
  const crowdedBenchOverlap = `calc(var(--card-h) * ${ATTACHED_CARD_SCALE} * -${CROWDED_BENCH_ATTACHED_ENERGY_STICK})`;

  return (
    <div
      className={FRAME_CLASS}
      style={{
        width: `calc(var(--card-w) * ${BENCH_LIMIT} + var(--slot-gap) * ${BENCH_LIMIT - 1} + 12px)`,
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
      data-card-drop-zone="true"
      data-card-owner={owner}
      data-card-zone="bench"
    >
      <div
        className="relative flex h-full w-full items-center justify-center"
        style={{ gap: "var(--slot-gap)" }}
      >
        {cards.map((card, index) => {
          const hasTool = (card.attached?.tools.length ?? 0) > 0;
          const hasEnergy = (card.attached?.energies.length ?? 0) > 0;
          const previousHasEnergy = (cards[index - 1]?.attached?.energies.length ?? 0) > 0;
          const toolBehind = hasTool && isCrowdedBench;
          const energyStrip = isCrowdedBench ? CROWDED_BENCH_ENERGY_STRIP : ATTACHED_STRIP;
          // Only widen the gap when there's actually a neighbour on that
          // side that would otherwise cover the attached strip — the first
          // card has nothing to its left, the last nothing to its right.
          // Crowded benches tuck tools vertically behind the Pokémon and let
          // the next Pokémon overlap the previous energy strip instead of
          // shrinking the bench cards.
          const needsLeftGap = hasTool && !toolBehind && index > 0;
          const needsRightGap = hasEnergy && index < cards.length - 1;
          const overlapPreviousEnergy = isCrowdedBench && previousHasEnergy;
          return (
            <div
              key={card.id}
              style={{
                position: "relative",
                width: "var(--card-w)",
                zIndex: cards.length - index,
                marginLeft: overlapPreviousEnergy
                  ? crowdedBenchOverlap
                  : needsLeftGap
                    ? ATTACHED_STRIP
                    : undefined,
                marginRight: needsRightGap ? energyStrip : undefined,
              }}
              data-card-drop-zone="true"
              data-card-owner={owner}
              data-card-zone="bench"
              data-card-index={index}
            >
              <PlaymatCard
                card={card}
                toolAttachmentPlacement={toolBehind ? "behind" : "side"}
                toolAttachmentSide={side}
                energyAttachmentStick={
                  isCrowdedBench ? CROWDED_BENCH_ATTACHED_ENERGY_STICK : undefined
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
