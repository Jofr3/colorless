import type { ReactNode } from "react";
import { CardImage } from "../../../components/CardImage";
import { CARD_SIZE_STYLE, CARD_SLOT_STYLE, FRAME_CLASS, PRIZE_GRID_STYLE } from "../constants";
import type { CardBackSize, CardBackTone, CardModel, PlayerId } from "../types";
import { PRIZE_COLUMNS, PRIZE_ROWS, deckBackId, prizeBackId, prizeSlots } from "../utils/piles";

/** Card-count badge on a pile frame. Purely visual (aria-hidden): as an
    <output> it was an implicit polite live region, announcing four bare
    numbers on every draw/discard — the accessible deck/discard counts live in
    BoardSummary instead. z-[61] floats it above the Pixi canvas (z-60); it
    sits OUTSIDE its frame so no slot styling can trap it below. */
function PileCountChip({ count }: { count: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute -bottom-1.5 left-1/2 z-[61] -translate-x-1/2 rounded-full bg-[#16161f]/90 px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums text-white/80 ring-1 ring-inset ring-white/15"
    >
      {count}
    </span>
  );
}

function CardBack({
  tone,
  size = "card",
  anchorId,
}: {
  tone: CardBackTone;
  size?: CardBackSize;
  anchorId: string;
}) {
  return (
    <div
      className={`card-back card-back--${size}`}
      data-card-anchor="true"
      data-card-id={anchorId}
      data-card-back-tone={tone}
      aria-hidden="true"
      style={{
        width: size === "prize" ? "var(--prize-w)" : "var(--card-w)",
        height: size === "prize" ? "var(--prize-h)" : "var(--card-h)",
      }}
    />
  );
}

function PileFrame({ children }: { children: ReactNode }) {
  return (
    <div className={FRAME_CLASS} style={CARD_SLOT_STYLE}>
      {children}
    </div>
  );
}

export function DeckPile({
  owner,
  tone,
  count,
}: {
  owner: PlayerId;
  tone: CardBackTone;
  /** Real deck size (game page). Absent = mock: back always shown, no chip.
      At 0 the anchor is not rendered, which hides the synthetic Pixi back
      (measureCards hides any view whose DOM anchor is gone). */
  count?: number;
}) {
  return (
    <div className="relative inline-block">
      <PileFrame>
        {count === 0 ? (
          <div style={CARD_SIZE_STYLE} />
        ) : (
          <CardBack tone={tone} anchorId={deckBackId(owner)} />
        )}
      </PileFrame>
      {count !== undefined && <PileCountChip count={count} />}
    </div>
  );
}

export function DiscardPile({ discard }: { discard?: CardModel[] }) {
  // The top (newest) discard renders as a plain DOM image above the Pixi
  // canvas — discard cards are not board zones, so the animation layer never
  // draws them. Mock (prop absent) keeps the empty frame.
  const top = discard === undefined ? undefined : discard[discard.length - 1];
  return (
    <div className="relative inline-block">
      <PileFrame>
        {top === undefined ? (
          <div style={CARD_SIZE_STYLE} />
        ) : (
          <div className="relative z-[61]" style={CARD_SIZE_STYLE}>
            <CardImage
              fill
              imageUrl={top.imageUrl}
              alt={`Discard pile, top card ${top.name}`}
              className="h-full w-full rounded-[9px] object-cover"
            />
          </div>
        )}
      </PileFrame>
      {discard !== undefined && <PileCountChip count={discard.length} />}
    </div>
  );
}

export function PrizeGrid({
  owner,
  remaining,
  tone,
  flipped = false,
}: {
  owner: PlayerId;
  remaining: number;
  tone: CardBackTone;
  flipped?: boolean;
}) {
  const slots = prizeSlots(remaining, flipped);

  return (
    <div className={FRAME_CLASS} style={PRIZE_GRID_STYLE}>
      <div className="flex flex-col">
        {Array.from({ length: PRIZE_ROWS }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex"
            style={{ marginTop: rowIndex === 0 ? 0 : "var(--prize-gap-y)" }}
          >
            {slots
              .slice(rowIndex * PRIZE_COLUMNS, rowIndex * PRIZE_COLUMNS + PRIZE_COLUMNS)
              .map((present, columnIndex) => {
                const slotIndex = rowIndex * PRIZE_COLUMNS + columnIndex;
                return (
                  <div
                    key={columnIndex}
                    style={{
                      marginLeft: columnIndex === 0 ? 0 : "var(--prize-gap-x)",
                      zIndex: slotIndex,
                      width: "var(--prize-w)",
                      height: "var(--prize-h)",
                    }}
                  >
                    {present && (
                      <CardBack tone={tone} size="prize" anchorId={prizeBackId(owner, slotIndex)} />
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
