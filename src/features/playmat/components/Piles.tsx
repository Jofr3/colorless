import { useState, type ReactNode } from "react";
import { CardImage } from "../../../components/CardImage";
import { useTiltJuice } from "../../../components/useTiltJuice";
import { FOCUS_RING_INSET } from "../../../lib/glass";
import { DiscardPileDialog } from "./DiscardPileDialog";
import { CARD_SIZE_STYLE, CARD_SLOT_STYLE, FRAME_CLASS, PRIZE_GRID_STYLE } from "../constants";
import type { CardBackSize, CardBackTone, CardModel, FaceUpPrize, PlayerId } from "../types";
import { PRIZE_COLUMNS, PRIZE_ROWS, deckBackId, prizeBackId, prizeSlotFaces } from "../utils/piles";

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
  faceUpName,
}: {
  tone: CardBackTone;
  size?: CardBackSize;
  anchorId: string;
  /** 🆕🆕🆕 D551 — a prize slot turned FACE UP (Crescent Purge): the SAME anchor (the id the
      Pixi view is keyed by stays `prizeBackId(owner, slot)`, so the view flips in place),
      marked `data-prize-face="up"` and named. Absent on every back. */
  faceUpName?: string;
}) {
  return (
    <div
      className={`card-back card-back--${size}`}
      data-card-anchor="true"
      data-card-id={anchorId}
      data-card-back-tone={tone}
      {...(faceUpName === undefined
        ? {}
        : { "data-prize-face": "up", "data-card-name": faceUpName })}
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
    <div className="relative inline-block" data-card-pile="deck" data-card-owner={owner}>
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

function DiscardTopCard({
  card,
  label,
  open,
  onOpen,
}: {
  card: CardModel;
  label: string;
  open: boolean;
  onOpen: () => void;
}) {
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLButtonElement>({
      idle: true,
    });

  return (
    <div
      className="relative z-[61]"
      style={CARD_SIZE_STYLE}
      data-card-id={card.id}
      data-discard-card="true"
    >
      <div ref={juiceLayerRef} className="h-full w-full" style={juiceStyle}>
        <button
          ref={tiltRef}
          type="button"
          className={`h-full w-full cursor-pointer rounded-[9px] ${FOCUS_RING_INSET}`}
          style={tiltStyle}
          {...handlers}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={onOpen}
        >
          <CardImage
            fill
            imageUrl={card.imageUrl}
            alt={`Discard pile, top card ${card.name}`}
            className="h-full w-full rounded-[9px] object-cover"
          />
        </button>
      </div>
    </div>
  );
}

export function DiscardPile({ owner, discard }: { owner: PlayerId; discard?: CardModel[] }) {
  const [open, setOpen] = useState(false);
  const title = owner === "you" ? "Your discard pile" : "Opponent's discard pile";
  const label = `View ${title.toLowerCase()}`;
  // The top (newest) discard animates in the DOM above the Pixi canvas;
  // discard cards are not board zones. Mock (prop absent) keeps the empty frame.
  const top = discard === undefined ? undefined : discard[discard.length - 1];
  return (
    <div className="relative inline-block">
      <PileFrame>
        {top === undefined ? (
          discard === undefined ? (
            <div style={CARD_SIZE_STYLE} />
          ) : (
            <button
              type="button"
              className={`relative z-[61] block cursor-pointer rounded-[9px] ${FOCUS_RING_INSET}`}
              style={CARD_SIZE_STYLE}
              aria-label={label}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            />
          )
        ) : (
          <DiscardTopCard
            key={top.id}
            card={top}
            label={label}
            open={open}
            onOpen={() => setOpen(true)}
          />
        )}
      </PileFrame>
      {discard !== undefined && <PileCountChip count={discard.length} />}
      {open && discard !== undefined && (
        <DiscardPileDialog title={title} cards={discard} onDismiss={() => setOpen(false)} />
      )}
    </div>
  );
}

export function PrizeGrid({
  owner,
  remaining,
  tone,
  flipped = false,
  faceUp,
}: {
  owner: PlayerId;
  remaining: number;
  tone: CardBackTone;
  flipped?: boolean;
  /** 🆕🆕🆕 D551 — this side's face-up prizes (`PlayerBoard.faceUpPrizes`), by LIVE row index.
      Placed ONLY through `prizeSlotFaces`, the one row-index -> grid-slot mapping. */
  faceUp: readonly FaceUpPrize[];
}) {
  const slots = prizeSlotFaces(remaining, faceUp, flipped);

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
              .map((face, columnIndex) => {
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
                    {face !== null && (
                      <CardBack
                        tone={tone}
                        size="prize"
                        anchorId={prizeBackId(owner, slotIndex)}
                        faceUpName={face === "back" ? undefined : face.card.name}
                      />
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
