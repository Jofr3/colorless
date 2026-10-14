import { useState } from "react";
import { CardImage } from "../../../components/CardImage";
import { useTiltJuice } from "../../../components/useTiltJuice";
import type { CardModel, PlayerId } from "../types";
import { CardGalleryDialog } from "./CardGalleryDialog";

function UsedTrainerCard({
  card,
  index,
  count,
}: { card: CardModel; index: number; count: number }) {
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } = useTiltJuice<
    HTMLSpanElement,
    HTMLSpanElement
  >({ idle: true, juiceOnMount: true });

  return (
    <span
      className="used-trainers__card"
      data-used-trainer-id={card.id}
      style={{ left: `calc((100% - var(--card-w)) * ${count === 1 ? 0.5 : index / (count - 1)})` }}
    >
      <span ref={juiceLayerRef} className="used-trainers__juice" style={juiceStyle}>
        <span ref={tiltRef} className="used-trainers__surface" style={tiltStyle} {...handlers}>
          <CardImage
            fill
            imageUrl={card.imageUrl}
            alt={card.name}
            className="h-full w-full rounded-[inherit] object-cover"
          />
        </span>
      </span>
    </span>
  );
}

export function UsedTrainers({ cards, owner }: { cards: CardModel[]; owner: PlayerId }) {
  const [open, setOpen] = useState(false);
  if (cards.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="used-trainers"
        data-used-trainers-drop-zone="true"
        data-card-drop-zone="true"
        data-card-owner={owner}
        data-card-zone="playmat"
        aria-label={`View ${cards.length} Trainer ${cards.length === 1 ? "card" : "cards"} used this turn`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="used-trainers__cards" aria-hidden="true">
          {cards.map((card, index) => (
            <UsedTrainerCard
              key={`${card.id}-${index}`}
              card={card}
              index={index}
              count={cards.length}
            />
          ))}
        </span>
      </button>
      {open && (
        <CardGalleryDialog
          title="Trainer cards used this turn"
          cards={cards}
          closeLabel="Close used Trainer cards"
          emptyMessage="No Trainer cards used this turn."
          showHeading={false}
          onDismiss={() => setOpen(false)}
        />
      )}
    </>
  );
}
