import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CardImage } from "../../../components/CardImage";
import { XIcon } from "../../../components/icons";
import { useTiltJuice } from "../../../components/useTiltJuice";
import { GLASS_DIALOG_PANEL, GHOST_ICON_BUTTON } from "../../../lib/glass";
import type { CardModel } from "../types";

function DiscardCard({ card }: { card: CardModel }) {
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } = useTiltJuice<HTMLDivElement>({
    idle: true,
  });

  return (
    <li className="relative min-w-0 hover:z-10" data-discard-id={card.id}>
      <div ref={juiceLayerRef} style={juiceStyle}>
        <div ref={tiltRef} style={tiltStyle} {...handlers}>
          <CardImage
            fill
            imageUrl={card.imageUrl}
            alt={card.name}
            className="aspect-[2.5/3.5] w-full rounded-xl object-cover shadow-lg ring-1 ring-white/10"
          />
        </div>
      </div>
    </li>
  );
}

export function DiscardPileDialog({
  title,
  cards,
  onDismiss,
}: {
  title: string;
  cards: CardModel[];
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Render outside the playmat so its native pointer handlers cannot pick up
  // a board card underneath a gallery card.
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: native dialog handles Escape; this click handler dismisses the backdrop.
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClose={onDismiss}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
      className="leave-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div
        className={`flex max-h-[88svh] w-[min(54rem,calc(100vw-2rem))] flex-col leading-normal ${GLASS_DIALOG_PANEL}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-white/55">
              {cards.length} {cards.length === 1 ? "card" : "cards"} · Newest first
            </p>
          </div>
          <button
            type="button"
            aria-label="Close discard pile"
            className={`flex h-8 w-8 shrink-0 ${GHOST_ICON_BUTTON}`}
            onClick={onDismiss}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        {cards.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/55">No discarded cards yet.</p>
        ) : (
          <ul className="mt-3 grid min-h-0 grid-cols-2 gap-4 overflow-x-hidden overflow-y-auto overscroll-contain p-5 sm:grid-cols-3 md:grid-cols-4">
            {[...cards].reverse().map((card) => (
              <DiscardCard key={card.id} card={card} />
            ))}
          </ul>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
