import {
  ATTACHED_CARD_SCALE,
  BENCH_EXTRA_CARD_WIDTH,
  CROWDED_BENCH_ATTACHED_ENERGY_STICK,
  DEFAULT_ATTACHED_VISIBLE_STICK,
  FRAME_CLASS,
} from "../constants";
import type { CardModel, PlayerId, SidePosition } from "../types";
import { shouldCollapseBenchAttachments } from "../utils/benchLayout";
import { DamageChip, PlaymatCard, StatusChips } from "./Card";

// Mirrors the visible-strip math in playmat.css `.playmat-card__attached`
// (card-h * scale * stick). Kept here so we can reserve that space in
// layout margins while there is enough fixed bench room.
const ATTACHED_STRIP = `calc(var(--card-h) * ${ATTACHED_CARD_SCALE} * ${DEFAULT_ATTACHED_VISIBLE_STICK})`;
const CROWDED_BENCH_ENERGY_STRIP = `calc(var(--card-h) * ${ATTACHED_CARD_SCALE} * ${CROWDED_BENCH_ATTACHED_ENERGY_STICK})`;

export function Bench({
  cards,
  owner,
  side,
  benchLimit,
}: {
  cards: CardModel[];
  owner: PlayerId;
  side: SidePosition;
  benchLimit: number;
}) {
  const shouldCollapseAttachments = shouldCollapseBenchAttachments(cards, benchLimit);
  const collapsedBenchOverlap = `calc(var(--card-h) * ${ATTACHED_CARD_SCALE} * -${CROWDED_BENCH_ATTACHED_ENERGY_STICK})`;

  return (
    <div
      className={FRAME_CLASS}
      style={{
        width: `calc(var(--card-w) * (${benchLimit} + ${BENCH_EXTRA_CARD_WIDTH}) + var(--slot-gap) * ${benchLimit - 1} + 12px)`,
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
          const toolBehind = hasTool && shouldCollapseAttachments;
          const energyStrip = shouldCollapseAttachments
            ? CROWDED_BENCH_ENERGY_STRIP
            : ATTACHED_STRIP;
          // Reserve layout space for side attachments while the fixed bench
          // has natural room. Once it runs out, tuck tools behind Pokémon and
          // overlap energy strips instead of resizing the bench.
          const needsLeftGap = hasTool && !toolBehind;
          const needsRightGap =
            hasEnergy && (!shouldCollapseAttachments || index < cards.length - 1);
          const overlapPreviousEnergy = shouldCollapseAttachments && previousHasEnergy;
          const battle = card.battle;
          return (
            // Outer wrapper carries the slot's layout (width + attachment
            // margins) but NO z-index, so the damage chip's z-[61] resolves
            // in the playmat section's stacking context, above the Pixi
            // canvas (z-60). The chip must stay a sibling of the z-indexed
            // drop wrapper below — inside it, the slot z would cap the chip.
            <div
              key={card.id}
              className="relative"
              style={{
                width: "var(--card-w)",
                marginLeft: overlapPreviousEnergy
                  ? collapsedBenchOverlap
                  : needsLeftGap
                    ? ATTACHED_STRIP
                    : undefined,
                marginRight: needsRightGap ? energyStrip : undefined,
              }}
            >
              <div
                style={{
                  position: "relative",
                  // Earlier slots hit-test above later ones where collapsed
                  // energy strips overlap the next slot (elementFromPoint
                  // follows paint order). Every visible face is Pixi-drawn,
                  // so this orders nothing visual.
                  zIndex: cards.length - index,
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
                    shouldCollapseAttachments ? CROWDED_BENCH_ATTACHED_ENERGY_STICK : undefined
                  }
                />
              </div>
              {battle !== undefined && (
                <DamageChip battle={battle} className="-right-1.5 -top-1.5" />
              )}
              {battle?.conditions !== undefined && (
                <StatusChips conditions={battle.conditions} className="-left-1.5 -top-1.5" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
