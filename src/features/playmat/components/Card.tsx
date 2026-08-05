import type { CSSProperties, ReactNode } from "react";
import { CardImage } from "../../../components/CardImage";
import { ACTIVE_SLOT_CLASS, CARD_RENDER_WIDTH, CARD_SLOT_STYLE, FRAME_CLASS } from "../constants";
import type { BattleConditions, BattleState, CardModel, SidePosition } from "../types";

/** The shared chip/pill look of every battle badge (damage + statuses). */
const CHIP_CLASS =
  "flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/25";

/** Damage badge for an in-play Pokémon: "30" (+ "/70" max HP when known).
    DOM-level on purpose (D17 wire-up: no Pixi involvement) — z-[61] floats it
    just above the Pixi card canvas (z-60, playmat.css). Slot owners render it
    as a SIBLING of the frame/card subtree, never inside it: no ancestor up to
    the playmat section may create a stacking context (element backdrop-filter,
    positioned z-index), or the z-[61] resolves too low and the canvas covers
    it. `className` carries the placement offsets (they differ by anchor box).
    Rendered only when damaged; aria-hidden — BoardSummary is the accessible
    surface. */
export function DamageChip({ battle, className }: { battle: BattleState; className: string }) {
  if (battle.damage <= 0) return null;
  return (
    <div
      className={`pointer-events-none absolute z-[61] bg-rose-600/95 ${CHIP_CLASS} ${className}`}
      aria-hidden="true"
      data-damage-chip="true"
    >
      {battle.damage}
      {battle.hp !== null && (
        <span className="ml-0.5 font-semibold text-white/75">/{battle.hp}</span>
      )}
    </div>
  );
}

/** One rendered condition marker: label + its hue in the chip palette. */
interface StatusChipModel {
  status: "asleep" | "paralyzed" | "confused" | "poisoned" | "burned";
  label: string;
  className: string;
}

const ROTATION_CHIPS = {
  asleep: { label: "SLP", className: "bg-sky-700/95" },
  paralyzed: { label: "PAR", className: "bg-amber-600/95" },
  confused: { label: "CNF", className: "bg-fuchsia-600/95" },
} as const;

/** The chips a condition set renders, in tick order (§13: poison before
    burn), rotation first — empty when nothing afflicts the Pokémon. Poison
    shows its per-Checkup HP when an effect raised it above the default 10. */
function statusChipsOf(conditions: BattleConditions): StatusChipModel[] {
  const chips: StatusChipModel[] = [];
  if (conditions.rotation !== "none") {
    chips.push({ status: conditions.rotation, ...ROTATION_CHIPS[conditions.rotation] });
  }
  if (conditions.poisonDamage > 0) {
    chips.push({
      status: "poisoned",
      // 10 mirrors the engine's DEFAULT_POISON_DAMAGE (packages/engine) — the playmat keeps zero engine imports, so keep this gate in sync if that default changes.
      label: conditions.poisonDamage > 10 ? `PSN ${conditions.poisonDamage}` : "PSN",
      className: "bg-violet-600/95",
    });
  }
  if (conditions.burned) {
    chips.push({ status: "burned", label: "BRN", className: "bg-orange-600/95" });
  }
  return chips;
}

/** Special-condition markers for an in-play Pokémon — the DamageChip's twin,
    same chip language and the same stacking rules (sibling of the frame,
    z-[61], no stacking-context ancestors). Anchored per slot via `className`
    on the OPPOSITE corner from the damage chip, stacking downward, so the
    two never collide. aria-hidden like the damage chip — BoardSummary is the
    accessible surface, and the chips would be drag-and-drop noise in a live
    region; the plain text labels (SLP/PAR/CNF/PSN/BRN) stay readable in DOM. */
export function StatusChips({
  conditions,
  className,
}: {
  conditions: BattleConditions;
  className: string;
}) {
  const chips = statusChipsOf(conditions);
  if (chips.length === 0) return null;
  return (
    <div
      className={`pointer-events-none absolute z-[61] flex flex-col items-start gap-1 ${className}`}
      aria-hidden="true"
      data-status-chips="true"
    >
      {chips.map((chip) => (
        <div
          key={chip.status}
          className={`${chip.className} ${CHIP_CLASS}`}
          data-status-chip={chip.status}
        >
          {chip.label}
        </div>
      ))}
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
