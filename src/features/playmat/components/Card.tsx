import type { ReactNode } from "react";
import { ACTIVE_SLOT_CLASS, CARD_RENDER_WIDTH, CARD_SLOT_STYLE, FRAME_CLASS } from "../constants";
import type { CardModel } from "../types";
import { CardImage } from "./CardImage";

export function CardSlot({
  children,
  highlighted = false,
}: {
  children: ReactNode;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`${FRAME_CLASS} ${highlighted ? ACTIVE_SLOT_CLASS : ""}`}
      style={CARD_SLOT_STYLE}
    >
      {children}
    </div>
  );
}

export function EmptyCardSpace() {
  return <div style={{ width: "var(--card-w)", height: "var(--card-h)" }} />;
}

export function PlaymatCard({
  card,
  priority = false,
}: {
  card: CardModel;
  priority?: boolean;
}) {
  return (
    <div className="relative select-none" aria-label={card.name} style={{ width: "var(--card-w)" }}>
      <div className="static-card w-full">
        <div className="static-card__surface">
          <CardImage
            cardId={card.cardId}
            imageUrl={card.imageUrl}
            renderedWidth={CARD_RENDER_WIDTH}
            alt={card.name}
            priority={priority}
            className="static-card__image"
          />
        </div>
      </div>
    </div>
  );
}
