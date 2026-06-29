import type { ReactNode } from "react";
import { CardImage } from "../../../components/CardImage";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ImportExportIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
} from "../../../components/icons";
import { ScrollArea } from "../../../components/ScrollArea";
import { FOCUS_RING, FOCUS_RING_INSET } from "../../../lib/glass";
import { type BuilderCard, cardImageUrl, type Format, SUPERTYPES } from "../cards";
import { countsBySupertype, type Deck, type DeckValidation } from "../deckMath";
import { cardSetLabel } from "../decklistText";

export interface DeckPanelProps {
  deckName: string;
  onRename: (name: string) => void;
  deck: Deck;
  validation: DeckValidation;
  format: Format;
  /** Copies still addable for a card (0 = at the cap). */
  remainingOf: (card: BuilderCard) => number;
  onAdd: (card: BuilderCard) => void;
  onRemove: (card: BuilderCard) => void;
  onClear: () => void;
  onImportExport: () => void;
}

type Status = "legal" | "error" | "building";

const STATUS_COLOR: Record<Status, string> = {
  legal: "#5fcf80",
  error: "#ff5d73",
  building: "#cfcfda",
};

function deckStatus(validation: DeckValidation): Status {
  if (validation.legal) return "legal";
  if (validation.issues.some((i) => i.level === "error")) return "error";
  return "building";
}

/** Small round +/- control used on each deck line. */
function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/75 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS_RING_INSET}`}
    >
      {children}
    </button>
  );
}

function DeckLine({
  card,
  quantity,
  canAdd,
  onAdd,
  onRemove,
}: {
  card: BuilderCard;
  quantity: number;
  canAdd: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-white/[0.04]">
      <div className="aspect-[2.5/3.5] w-7 shrink-0 overflow-hidden rounded ring-1 ring-inset ring-white/10">
        <CardImage fill imageUrl={cardImageUrl(card.cardId)} alt={card.name} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white/90">{card.name}</p>
        <p className="truncate text-[11px] text-white/55">{cardSetLabel(card)}</p>
      </div>
      <div className="flex items-center gap-1">
        <StepButton label={`Remove one ${card.name}`} onClick={onRemove}>
          {quantity === 1 ? <TrashIcon className="h-3 w-3" /> : <MinusIcon className="h-3.5 w-3.5" />}
        </StepButton>
        <span className="w-5 text-center text-sm font-bold tabular-nums text-white">{quantity}</span>
        <StepButton label={`Add one ${card.name}`} onClick={onAdd} disabled={!canAdd}>
          <PlusIcon className="h-3.5 w-3.5" />
        </StepButton>
      </div>
    </li>
  );
}

/** The Pokémon / Trainer / Energy split. */
function DeckStats({ deck }: { deck: Deck }) {
  const counts = countsBySupertype(deck);

  return (
    <div className="grid grid-cols-3 gap-2">
      {SUPERTYPES.map((s) => (
        <div
          key={s}
          className="rounded-lg bg-white/[0.04] px-2 py-1.5 text-center ring-1 ring-inset ring-white/10"
        >
          <p className="text-base font-bold tabular-nums text-white">{counts[s]}</p>
          <p className="text-[10px] uppercase tracking-wide text-white/55">{s}</p>
        </div>
      ))}
    </div>
  );
}

/** Legality feedback condensed to a single status icon beside the deck count:
    a green check when the deck is legal, otherwise an alert icon whose hover /
    keyboard-focus popup lists the outstanding error/warning messages (which
    used to sit inline under the header). */
function DeckStatusBadge({ validation, format }: { validation: DeckValidation; format: Format }) {
  const status = deckStatus(validation);
  const Icon = validation.legal ? CheckCircleIcon : AlertTriangleIcon;

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={
          validation.legal
            ? `Legal ${format.name} deck`
            : `Deck issues: ${validation.issues.map((i) => i.message).join("; ")}`
        }
        className={`inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full transition-colors hover:bg-white/10 ${FOCUS_RING}`}
        style={{ color: STATUS_COLOR[status] }}
      >
        <Icon className="h-4 w-4" />
      </button>

      {/* Hover / keyboard-focus popup. Right-aligned so it never spills past the
          panel's right edge. */}
      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 w-max max-w-[15rem] origin-top-right scale-95 rounded-lg bg-[#14141c]/95 p-2.5 text-xs opacity-0 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/10 backdrop-blur-xl transition duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-within:scale-100 group-focus-within:opacity-100"
      >
        {validation.legal ? (
          <p className="flex items-center gap-1.5 font-medium text-[#7fe39c]">
            <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />
            Legal {format.name} deck
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {validation.issues.map((issue) => (
              <li
                key={issue.message}
                className={`flex items-start gap-1.5 ${
                  issue.level === "error" ? "text-[#ff8a9b]" : "text-amber-300/80"
                }`}
              >
                <AlertTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </span>
  );
}

const PANEL_BUTTON =
  "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium bg-white/[0.05] text-white/75 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.09] hover:text-white/90 active:scale-95";

/** The right pane: deck title, completeness, stats, validation, the grouped
    decklist, and the import/export + clear actions. */
export function DeckPanel({
  deckName,
  onRename,
  deck,
  validation,
  format,
  remainingOf,
  onAdd,
  onRemove,
  onClear,
  onImportExport,
}: DeckPanelProps) {
  const status = deckStatus(validation);
  const fill = Math.min(1, validation.total / validation.deckSize);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header: editable name + count out of the deck size. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <input
            value={deckName}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Deck name"
            placeholder="Untitled Deck"
            className={`min-w-0 flex-1 truncate rounded-md bg-transparent text-lg font-semibold text-white outline-none transition-colors placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06] focus:ring-1 focus:ring-inset focus:ring-white/30 ${FOCUS_RING}`}
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-sm font-bold tabular-nums text-white/80">
              <span style={{ color: STATUS_COLOR[status] }}>{validation.total}</span>
              <span className="text-white/45"> / {validation.deckSize}</span>
            </span>
            <DeckStatusBadge validation={validation} format={format} />
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${fill * 100}%`, backgroundColor: STATUS_COLOR[status] }}
          />
        </div>
      </div>

      <DeckStats deck={deck} />

      {/* The grouped decklist scrolls; everything above and the footer stay put. */}
      <ScrollArea className="-mr-1 pr-1" outerClassName="mt-0.5">
        {deck.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 pb-10 pt-16 text-center">
            <PlusIcon className="h-5 w-5 text-white/20" />
            <p className="text-sm text-white/55">Click cards to add them to your deck</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {SUPERTYPES.map((supertype) => {
              const group = deck.filter((e) => e.card.supertype === supertype);
              if (group.length === 0) return null;
              const subtotal = group.reduce((sum, e) => sum + e.quantity, 0);
              return (
                <section key={supertype}>
                  <p className="mb-1 flex items-baseline justify-between px-1 text-[0.7rem] font-semibold uppercase tracking-wider text-white/50">
                    {supertype}
                    <span className="tabular-nums text-white/45">{subtotal}</span>
                  </p>
                  <ul className="flex flex-col">
                    {group.map(({ card, quantity }) => (
                      <DeckLine
                        key={card.cardId}
                        card={card}
                        quantity={quantity}
                        canAdd={remainingOf(card) > 0}
                        onAdd={() => onAdd(card)}
                        onRemove={() => onRemove(card)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Footer actions. */}
      <div className="flex shrink-0 items-center gap-2 pt-1">
        <button type="button" onClick={onImportExport} className={`${PANEL_BUTTON} ${FOCUS_RING}`}>
          <ImportExportIcon className="h-4 w-4" />
          Import / Export
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={deck.length === 0}
          aria-label="Clear deck"
          className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/[0.05] text-white/65 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.09] hover:text-white/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS_RING}`}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
