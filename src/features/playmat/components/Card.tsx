import type { CSSProperties, ReactNode } from "react";
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
  const tools = card.attached?.tools ?? [];
  const energies = card.attached?.energies ?? [];

  return (
    <div
      className="relative select-none"
      aria-label={card.name}
      style={{ width: "var(--card-w)" }}
      data-card-anchor="true"
      data-card-id={card.id}
    >
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
      {tools.map((tool) => (
        <div
          key={tool.id}
          className="playmat-card__attached playmat-card__attached--tool"
          data-card-anchor="true"
          data-card-id={tool.id}
          data-card-rotation={-Math.PI / 2}
          aria-hidden="true"
        />
      ))}
      {energies.map((energy, index) => (
        <div
          key={energy.id}
          className="playmat-card__attached playmat-card__attached--energy"
          data-card-anchor="true"
          data-card-id={energy.id}
          data-card-rotation={Math.PI / 2}
          aria-hidden="true"
          style={{ "--attached-stack": String(index) } as CSSProperties}
        />
      ))}
    </div>
  );
}
