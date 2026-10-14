import type { CSSProperties, ReactNode } from "react";
import { DieCube } from "../../game/DieCube";
import { CardImage } from "../../../components/CardImage";
import { ACTIVE_SLOT_CLASS, CARD_RENDER_WIDTH, CARD_SLOT_STYLE, FRAME_CLASS } from "../constants";
import type { BattleConditions, BattleState, CardBackTone, CardModel, SidePosition } from "../types";

/** Compact pills for Special Conditions. */
const CHIP_CLASS =
  "flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/25";

/** Seed the angles by card and die so re-renders and movement keep the same pose. */
function diceTilt(seed: string, maxDegrees: number) {
  let hash = 0x811c9dc5;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return `${(((hash >>> 0) / 0xffffffff * 2 - 1) * maxDegrees).toFixed(1)}deg`;
}

/** One pip is one damage counter (10 HP); fill each die to six before adding
    another. BoardSummary supplies the accessible damage and HP description. */
export function DamageDice({
  battle,
  cardId,
  tone,
}: {
  battle: BattleState;
  cardId: string;
  tone: CardBackTone;
}) {
  if (battle.damage <= 0) return null;
  const counters = Math.ceil(battle.damage / 10);
  const dice = Array.from({ length: Math.ceil(counters / 6) }, (_, index) =>
    Math.min(6, counters - index * 6),
  );
  return (
    <div
      className="damage-dice"
      aria-hidden="true"
      data-damage-dice="true"
      data-damage-total={battle.damage}
      data-card-badge-for={cardId}
    >
      <div
        className="damage-dice__stack"
        style={{ "--damage-stack-tilt": diceTilt(`${cardId}:stack`, 8) } as CSSProperties}
      >
        {dice.map((value, index) => (
          <div
            key={`${index}:${value}`}
            className="tabletop-die damage-die"
            data-tone={tone}
            data-value={value}
            data-damage-value={value * 10}
            style={{ "--damage-die-tilt": diceTilt(`${cardId}:die:${index}`, 14) } as CSSProperties}
          >
            <div className="tabletop-die-shadow" />
            <DieCube value={value} />
          </div>
        ))}
      </div>
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

/** Special-condition markers for an in-play Pokémon, with the same
    stacking rules as damage dice (sibling of the frame,
    z-[61], no stacking-context ancestors). Anchored per slot via `className`
    on the upper-left corner, clear of the dice on the card face.
    aria-hidden like the damage dice — BoardSummary is the
    accessible surface, and the chips would be drag-and-drop noise in a live
    region; the plain text labels (SLP/PAR/CNF/PSN/BRN) stay readable in DOM. */
export function StatusChips({
  conditions,
  cardId,
  className,
}: {
  conditions: BattleConditions;
  cardId: string;
  className: string;
}) {
  const chips = statusChipsOf(conditions);
  if (chips.length === 0) return null;
  return (
    <div
      className={`pointer-events-none absolute z-[61] flex flex-col items-start gap-1 ${className}`}
      aria-hidden="true"
      data-status-chips="true"
      data-card-badge-for={cardId}
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

export function energyStepForStackSize(cardCount: number) {
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
      {tools.map((tool, index) => {
        const isBehind = toolAttachmentPlacement === "behind";
        return (
          <div
            key={tool.id}
            // 🆕🆕🆕 D643 — a second Tool (Rotom ex "Multi Adapter") steps off the first.
            style={{ "--attached-stack": String(index) } as CSSProperties}
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
