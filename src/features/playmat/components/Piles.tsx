import type { ReactNode } from "react";
import { CARD_SIZE_STYLE, CARD_SLOT_STYLE, FRAME_CLASS, PRIZE_GRID_STYLE } from "../constants";
import type { CardBackSize, CardBackTone, PlayerId } from "../types";
import { PRIZE_COLUMNS, PRIZE_ROWS, deckBackId, prizeBackId, prizeSlots } from "../utils/piles";

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

export function DeckPile({ owner, tone }: { owner: PlayerId; tone: CardBackTone }) {
  return (
    <div className="relative inline-block">
      <PileFrame>
        <CardBack tone={tone} anchorId={deckBackId(owner)} />
      </PileFrame>
    </div>
  );
}

export function DiscardPile() {
  return (
    <div className="relative inline-block">
      <PileFrame>
        <div style={CARD_SIZE_STYLE} />
      </PileFrame>
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
