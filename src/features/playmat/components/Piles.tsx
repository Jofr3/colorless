import type { ReactNode } from "react";
import { CARD_SIZE_STYLE, CARD_SLOT_STYLE, FRAME_CLASS, PRIZE_GRID_STYLE } from "../constants";
import type { CardBackSize, CardBackTone } from "../types";

const PRIZE_COUNT = 6;
const PRIZE_COLUMNS = 2;
const PRIZE_ROWS = 3;

function CardBack({
  tone,
  size = "card",
}: {
  tone: CardBackTone;
  size?: CardBackSize;
}) {
  return (
    <div
      className={`card-back card-back--${size}`}
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

function prizeSlots(remaining: number, flipped: boolean) {
  const taken = Math.max(0, Math.min(PRIZE_COUNT, PRIZE_COUNT - remaining));
  return Array.from({ length: PRIZE_COUNT }, (_, index) =>
    flipped ? index >= taken : index < PRIZE_COUNT - taken,
  );
}

export function DeckPile({ tone }: { tone: CardBackTone }) {
  return (
    <div className="relative inline-block">
      <PileFrame>
        <CardBack tone={tone} />
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
  remaining,
  tone,
  flipped = false,
}: {
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
              .map((present, columnIndex) => (
                <div
                  key={columnIndex}
                  style={{
                    marginLeft: columnIndex === 0 ? 0 : "var(--prize-gap-x)",
                    zIndex: rowIndex * PRIZE_COLUMNS + columnIndex,
                    width: "var(--prize-w)",
                    height: "var(--prize-h)",
                  }}
                >
                  {present && <CardBack tone={tone} size="prize" />}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
