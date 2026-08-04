import type { Card } from "@luminous/schema";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { CardImage } from "../../../components/CardImage";
import { XIcon } from "../../../components/icons";
import { ScrollArea } from "../../../components/ScrollArea";
import { cardImageUrl, getCard } from "../../../lib/api";
import { GHOST_ICON_BUTTON, GLASS_DIALOG_PANEL, GLASS_GHOST_BUTTON } from "../../../lib/glass";
import { type BuilderCard, type EnergyType, ENERGY_TYPE_META, ENERGY_TYPES } from "../cards";
import { EnergyGlyph } from "./EnergyGlyph";

// The card-detail modal answers TWO questions in one surface — "which card is
// this?" (the seed BuilderCard the grid already holds) and "what does it do?"
// (the full Card, fetched on open) — and it must never let the second question
// blank out the first. So the header name comes straight from the seed and
// shows the instant the dialog opens, while the body swaps loading → ready as
// getCard resolves. The fetch is GUARDED against staleness: reopening on a
// different card (or closing) re-runs the effect, and a `cancelled` flag makes
// the previous in-flight promise a no-op so a slow response can't overwrite a
// newer one. The seed is retained through the close (the parent keeps `card`
// set), so the content doesn't flash empty on the way out.

export interface CardDetailDialogProps {
  open: boolean;
  /** The card to show — retained during the close so content doesn't blank out.
      Null before the first open. */
  card: BuilderCard | null;
  onClose: () => void;
}

/** The ten type names the {@link EnergyGlyph} set can draw — anything outside
    it (an unmodelled type string on an odd print) falls back to a text chip. */
const GLYPH_TYPES = new Set<string>(ENERGY_TYPES);

/** True when a type-name string is one the energy glyph set covers, narrowing
    it to {@link EnergyType} so it can be handed to {@link EnergyGlyph}. Pure and
    exported so it's unit-testable on its own. */
export function isGlyphType(type: string): type is EnergyType {
  return GLYPH_TYPES.has(type);
}

type DetailState = { status: "loading" } | { status: "ready"; data: Card } | { status: "error" };

export function CardDetailDialog({ open, card, onClose }: CardDetailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [detail, setDetail] = useState<DetailState>({ status: "loading" });
  // Bumped by the error state's Retry to re-run the fetch effect below.
  const [retryNonce, setRetryNonce] = useState(0);

  // Native <dialog> driven by `open`, exactly like CoverDialog: focus move-in,
  // focus trapping, Escape and focus restoration for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Hydrate the full card only while open. Keyed on the card id (and the retry
  // nonce) so reopening a different card refetches; a `cancelled` flag drops a
  // resolved promise whose effect run is no longer current, so a stale response
  // can't clobber a newer card's details. Closing returns early and leaves the
  // last-loaded content in place, so it doesn't blank during the close.
  const cardId = card?.cardId ?? null;
  useEffect(() => {
    // retryNonce has no value of its own — reading it here is what lets the
    // error state's Retry re-run this effect.
    void retryNonce;
    if (!open || cardId === null) return;
    let cancelled = false;
    setDetail({ status: "loading" });
    getCard(cardId).then(
      (data) => {
        if (!cancelled) setDetail({ status: "ready", data });
      },
      () => {
        if (!cancelled) setDetail({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, cardId, retryNonce]);

  const hasImage = card?.hasImage ?? false;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native <dialog> handles Escape; this onClick only adds backdrop click-to-dismiss for pointer users.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click whose target is the dialog itself landed on the ::backdrop.
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto border-0 bg-transparent p-0 text-white [&::backdrop]:bg-black/60 [&::backdrop]:backdrop-blur-sm"
    >
      <div className={`w-[min(46rem,calc(100vw-2rem))] ${GLASS_DIALOG_PANEL}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-lg font-semibold text-white/90">
              {card?.name ?? "Card"}
            </h2>
            {detail.status === "ready" && <HeaderChips data={detail.data} />}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`flex h-8 w-8 shrink-0 ${GHOST_ICON_BUTTON}`}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {card && (
          <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,11.5rem)_minmax(0,1fr)]">
            {/* The big scan — from the seed, so it's up the instant the dialog
                opens, independent of the getCard fetch below. */}
            <div className="mx-auto w-full max-w-[11.5rem] sm:mx-0">
              <div className="aspect-[2.5/3.5] w-full overflow-hidden rounded-xl ring-1 ring-inset ring-white/10">
                <CardImage
                  fill
                  priority
                  imageUrl={hasImage ? cardImageUrl(card.cardId, "high") : undefined}
                  alt={card.name}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            <ScrollArea className="max-h-[26rem] pr-1" fadeBottom={20} maskRadius={12}>
              {detail.status === "loading" && <LoadingBody />}
              {detail.status === "error" && (
                <ErrorBody onRetry={() => setRetryNonce((n) => n + 1)} />
              )}
              {detail.status === "ready" && <ReadyBody data={detail.data} />}
            </ScrollArea>
          </div>
        )}
      </div>
    </dialog>
  );
}

/** The chips beside the name: category always, then HP (Pokémon), rarity and
    regulation mark when the card carries them. */
function HeaderChips({ data }: { data: Card }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Chip>{data.category}</Chip>
      {data.hp !== null && <Chip>{data.hp} HP</Chip>}
      {data.rarity && <Chip>{data.rarity}</Chip>}
      {data.regulationMark && <Chip>{data.regulationMark}</Chip>}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-medium text-white/70 ring-1 ring-inset ring-white/10">
      {children}
    </span>
  );
}

/** A section with a small uppercase label — omit the whole thing by not
    rendering it (callers guard on the data). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One type symbol — the glyph when the set covers it, else an honest text
    chip for a type string outside the ten glyph keys. */
function TypePip({ type, className = "h-5 w-5" }: { type: string; className?: string }) {
  if (isGlyphType(type)) {
    return <EnergyGlyph type={type} fill={ENERGY_TYPE_META[type].color} className={className} />;
  }
  return (
    <span className="inline-flex items-center rounded bg-white/[0.08] px-1 py-0.5 text-[10px] font-medium leading-none text-white/70">
      {type}
    </span>
  );
}

function LoadingBody() {
  return (
    <div>
      <div className="space-y-2" aria-hidden>
        <div className="h-3 w-24 rounded bg-white/[0.06]" />
        <div className="h-3 w-full rounded bg-white/[0.05]" />
        <div className="h-3 w-5/6 rounded bg-white/[0.05]" />
        <div className="h-3 w-2/3 rounded bg-white/[0.05]" />
      </div>
      <p className="pt-3 text-sm text-white/45">Loading…</p>
    </div>
  );
}

function ErrorBody({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-1">
      <p className="text-sm text-white/60">Couldn't load card details</p>
      <button
        type="button"
        onClick={onRetry}
        className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${GLASS_GHOST_BUTTON}`}
      >
        Retry
      </button>
    </div>
  );
}

/** The resolved card: types, attacks, abilities, the weakness/resistance/retreat
    stat row, Trainer/Energy rules text, then footer meta. Every block is guarded
    so a Trainer (no types/attacks) or an odd print just omits what it lacks. */
function ReadyBody({ data }: { data: Card }) {
  const types = data.types ?? [];
  const attacks = data.attacks ?? [];
  const abilities = data.abilities ?? [];
  const weaknesses = data.weaknesses ?? [];
  const resistances = data.resistances ?? [];
  const hasStatRow = weaknesses.length > 0 || resistances.length > 0 || data.retreat !== null;

  return (
    <div>
      {types.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {types.map((type, i) => (
            <TypePip key={`${type}-${i}`} type={type} />
          ))}
        </div>
      )}

      {abilities.length > 0 && (
        <Section title="Abilities">
          <div className="space-y-2.5">
            {abilities.map((ability, i) => (
              <div key={i}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                    {ability.type ?? "Ability"}
                  </span>
                  <span className="font-medium text-white/90">{ability.name}</span>
                </div>
                {ability.effect && (
                  <p className="mt-0.5 text-xs leading-relaxed text-white/55">{ability.effect}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {attacks.length > 0 && (
        <Section title="Attacks">
          <div className="space-y-2.5">
            {attacks.map((attack, i) => (
              <div key={i}>
                <div className="flex items-baseline gap-2">
                  {attack.cost && attack.cost.length > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      {attack.cost.map((cost, j) => (
                        <TypePip key={`${cost}-${j}`} type={cost} className="h-4 w-4" />
                      ))}
                    </span>
                  )}
                  <span className="min-w-0 font-medium text-white/90">{attack.name}</span>
                  {attack.damage !== undefined && (
                    <span className="ml-auto shrink-0 font-semibold tabular-nums text-white/90">
                      {String(attack.damage)}
                    </span>
                  )}
                </div>
                {attack.effect && (
                  <p className="mt-0.5 text-xs leading-relaxed text-white/55">{attack.effect}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {hasStatRow && (
        <Section title="Combat">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {weaknesses.length > 0 && (
              <StatItem label="Weakness">
                {weaknesses.map((w, i) => (
                  <span key={`${w.type}-${i}`} className="inline-flex items-center gap-0.5">
                    <TypePip type={w.type} className="h-4 w-4" />
                    {w.value && <span className="text-white/80">{w.value}</span>}
                  </span>
                ))}
              </StatItem>
            )}
            {resistances.length > 0 && (
              <StatItem label="Resistance">
                {resistances.map((r, i) => (
                  <span key={`${r.type}-${i}`} className="inline-flex items-center gap-0.5">
                    <TypePip type={r.type} className="h-4 w-4" />
                    {r.value && <span className="text-white/80">{r.value}</span>}
                  </span>
                ))}
              </StatItem>
            )}
            {data.retreat !== null && (
              <StatItem label="Retreat">
                {data.retreat > 0 ? (
                  <span className="flex items-center gap-0.5">
                    {Array.from({ length: data.retreat }, (_, i) => (
                      <EnergyGlyph
                        key={i}
                        type="Colorless"
                        fill={ENERGY_TYPE_META.Colorless.color}
                        className="h-4 w-4"
                      />
                    ))}
                  </span>
                ) : (
                  <span className="text-white/80">Free</span>
                )}
              </StatItem>
            )}
          </div>
        </Section>
      )}

      {data.category !== "Pokemon" && data.effect && (
        <Section title="Effect">
          <p className="whitespace-pre-line text-sm leading-relaxed text-white/70">{data.effect}</p>
        </Section>
      )}

      <FooterMeta data={data} />
    </div>
  );
}

function StatItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-white/40">{label}</span>
      {children}
    </div>
  );
}

/** Illustrator + set/number + evolves-from — kept minimal and honest: the set
    name isn't carried in the card payload, so we print the raw set id, not a
    lookup that would guess. */
function FooterMeta({ data }: { data: Card }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-3 text-[11px] text-white/40">
      {data.evolveFrom && <span>Evolves from {data.evolveFrom}</span>}
      {data.illustrator && <span>Illus. {data.illustrator}</span>}
      <span className="tabular-nums">
        {data.localId} · {data.setId}
      </span>
    </div>
  );
}
