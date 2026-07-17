import type { CSSProperties, ReactNode } from "react";
import { CardImage } from "../../../components/CardImage";
import { ACTIVE_SLOT_CLASS, CARD_RENDER_WIDTH, CARD_SLOT_STYLE, FRAME_CLASS } from "../constants";
import type { CardModel, CardStatus, SidePosition } from "../types";

/** Damage badge for an in-play Pokémon: "30" (+ "/70" max HP when known).
    DOM-level on purpose (D17 wire-up: no Pixi involvement) — z-[61] floats it
    just above the Pixi card canvas (z-60, playmat.css). Slot owners render it
    as a SIBLING of the frame/card subtree, never inside it: no ancestor up to
    the playmat section may create a stacking context (element backdrop-filter,
    positioned z-index), or the z-[61] resolves too low and the canvas covers
    it. `className` carries the placement offsets (they differ by anchor box).
    Rendered only when damaged; aria-hidden — BoardSummary is the accessible
    surface. */
export function DamageChip({ status, className }: { status: CardStatus; className: string }) {
  if (status.damage <= 0) return null;
  return (
    <div
      className={`pointer-events-none absolute z-[61] flex items-center rounded-full bg-rose-600/95 px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/25 ${className}`}
      aria-hidden="true"
      data-damage-chip="true"
    >
      {status.damage}
      {status.hp !== null && (
        <span className="ml-0.5 font-semibold text-white/75">/{status.hp}</span>
      )}
    </div>
  );
}

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

const BASE_ATTACHED_ENERGY_STEP = 0.2;
const ATTACHED_ENERGY_STEP_SHRINK = 0.03;
const MIN_ATTACHED_ENERGY_STEP = 0.07;
const MAX_ATTACHED_ENERGY_SPREAD = 0.42;

function energyStepForStackSize(cardCount: number) {
  const denseStep = Math.max(
    MIN_ATTACHED_ENERGY_STEP,
    BASE_ATTACHED_ENERGY_STEP - Math.max(0, cardCount - 2) * ATTACHED_ENERGY_STEP_SHRINK,
  );
  const containedStep = cardCount > 1 ? MAX_ATTACHED_ENERGY_SPREAD / (cardCount - 1) : denseStep;
  return Math.min(denseStep, containedStep).toFixed(3);
}

type ToolAttachmentPlacement = "side" | "behind";

export function PlaymatCard({
  card,
  priority = false,
  toolAttachmentPlacement = "side",
  toolAttachmentSide = "bottom",
  energyAttachmentStick,
}: {
  card: CardModel;
  priority?: boolean;
  toolAttachmentPlacement?: ToolAttachmentPlacement;
  toolAttachmentSide?: SidePosition;
  energyAttachmentStick?: number;
}) {
  const tools = card.attached?.tools ?? [];
  const energies = card.attached?.energies ?? [];
  const energyStep = energyStepForStackSize(energies.length);

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
            imageUrl={card.imageUrl}
            renderedWidth={CARD_RENDER_WIDTH}
            alt={card.name}
            priority={priority}
            className="static-card__image"
          />
        </div>
      </div>
      {tools.map((tool) => {
        const isBehind = toolAttachmentPlacement === "behind";
        return (
          <div
            key={tool.id}
            className={`playmat-card__attached ${
              isBehind
                ? `playmat-card__attached--tool-behind playmat-card__attached--tool-behind-${toolAttachmentSide}`
                : "playmat-card__attached--tool"
            }`}
            data-card-anchor="true"
            data-card-id={tool.id}
            data-card-rotation={isBehind ? 0 : -Math.PI / 2}
            aria-hidden="true"
          />
        );
      })}
      {energies.map((energy, index) => {
        const style = {
          "--attached-stack": String(index),
          "--attached-energy-step": energyStep,
          ...(energyAttachmentStick == null
            ? {}
            : { "--attached-stick": String(energyAttachmentStick) }),
        } as CSSProperties;

        return (
          <div
            key={energy.id}
            className="playmat-card__attached playmat-card__attached--energy"
            data-card-anchor="true"
            data-card-id={energy.id}
            data-card-rotation={Math.PI / 2}
            aria-hidden="true"
            style={style}
          />
        );
      })}
    </div>
  );
}
