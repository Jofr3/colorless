import { BENCH_LIMIT, FRAME_CLASS } from "../constants";
import type { CardModel, PlayerId, SidePosition } from "../types";
import { PlaymatCard } from "./Card";

// Mirrors the visible-strip math in playmat.css `.playmat-card__attached`
// (card-h * scale * stick). Kept here so we can reserve the same width as
// inter-slot margin when a bench card has an attachment that would
// otherwise be covered by its neighbour.
const ATTACHED_STRIP = "calc(var(--card-h) * 0.92 * 0.22)";
const TOOL_BEHIND_BENCH_THRESHOLD = 5;

export function Bench({
  cards,
  owner,
  side,
}: {
  cards: CardModel[];
  owner: PlayerId;
  side: SidePosition;
}) {
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
          const toolBehind = hasTool && cards.length > TOOL_BEHIND_BENCH_THRESHOLD;
          // Only widen the gap when there's actually a neighbour on that
          // side that would otherwise cover the attached strip — the first
          // card has nothing to its left, the last nothing to its right.
          // Crowded benches tuck tools vertically behind the Pokémon instead
          // of reserving horizontal strip space.
          const needsLeftGap = hasTool && !toolBehind && index > 0;
          const needsRightGap = hasEnergy && index < cards.length - 1;
          return (
            <div
              key={card.id}
              style={{
                position: "relative",
                width: "var(--card-w)",
                zIndex: cards.length - index,
                marginLeft: needsLeftGap ? ATTACHED_STRIP : undefined,
                marginRight: needsRightGap ? ATTACHED_STRIP : undefined,
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
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
