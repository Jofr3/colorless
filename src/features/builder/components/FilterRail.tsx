import { type ReactNode, useMemo } from "react";
import { StatusSpinner } from "../../../components/StatusPanel";
import { FOCUS_RING } from "../../../lib/glass";
import {
  ENERGY_TYPE_META,
  ENERGY_TYPES,
  type EnergyType,
  type Format,
  FORMATS,
  type Supertype,
  SUPERTYPES,
} from "../cards";
import { kindOptions, suffixOptions } from "../catalog";
import type { CatalogOptions } from "../catalogOptions";
import { type Filters, filtersActive, type SortKey } from "../poolFilter";
import { EnergyGlyph } from "./EnergyGlyph";

export interface FilterRailProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  format: Format;
  onFormatChange: (id: string) => void;
  onReset: () => void;
  /** Session catalog vocabularies feeding the option-driven dimensions
      (kinds, rarity, regulation mark, set/serie, illustrator). While they
      load — or if they fail — those sections hide behind a hint; everything
      vocabulary-free keeps working. */
  options: CatalogOptions;
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "hp-desc", label: "HP" },
  { value: "set", label: "Set" },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-0.5 pb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-white/50">
      {children}
    </p>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors motion-reduce:transition-none ${FOCUS_RING} ${
        selected
          ? "bg-accent text-zinc-950 ring-accent"
          : "bg-white/[0.05] text-white/70 ring-white/10 hover:bg-white/[0.09] hover:text-white/90"
      }`}
    >
      {children}
    </button>
  );
}

function TypePip({
  type,
  selected,
  onToggle,
}: {
  type: EnergyType;
  selected: boolean;
  onToggle: () => void;
}) {
  const meta = ENERGY_TYPE_META[type];
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={meta.type}
      title={meta.type}
      onClick={onToggle}
      style={{ backgroundColor: meta.color }}
      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition motion-reduce:transition-none ${FOCUS_RING} ${
        selected
          ? "ring-2 ring-white ring-offset-2 ring-offset-[#15151d]"
          : "opacity-60 ring-1 ring-inset ring-black/30 hover:opacity-100"
      }`}
    >
      <EnergyGlyph type={type} className="h-4 w-4" />
    </button>
  );
}

// Glass select for the long-list pickers (set/serie/illustrator) — a native
// <select> (searchable by typing) in the Settings page's select styling,
// full-width for the rail.
const SELECT_CLASS =
  "w-full cursor-pointer rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-sm text-white/80 outline-none ring-1 ring-inset ring-white/10 transition-colors motion-reduce:transition-none hover:bg-white/[0.09] hover:text-white/90 focus-visible:ring-2 focus-visible:ring-white/50";

function RailSelect({
  label,
  value,
  onChange,
  anyLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The empty-value option's label, e.g. "All sets". */
  anyLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="" className="bg-surface text-white">
        {anyLabel}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-surface text-white">
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Glass text/number input for the rail's small free-text fields (HP bounds,
// ability/attack text) — GLASS_INPUT's paint at chip scale, spinners hidden.
const RAIL_INPUT_CLASS =
  "w-full rounded-lg bg-white/[0.045] px-2.5 py-1.5 text-sm text-white/90 ring-1 ring-inset ring-white/10 transition-colors motion-reduce:transition-none placeholder:text-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** The deck builder's left rail: format, card type, energy type, kind,
    rarity, regulation mark, HP range, set/serie, illustrator, ability/attack
    text and sort. Pure-presentational — every change flows up through
    `onChange`; the option vocabularies arrive via `options`. */
export function FilterRail({
  filters,
  onChange,
  format,
  onFormatChange,
  onReset,
  options,
}: FilterRailProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const facets = options.facets;

  const toggleType = (type: EnergyType) =>
    set({
      types: filters.types.includes(type)
        ? filters.types.filter((t) => t !== type)
        : [...filters.types, type],
    });

  const toggleKind = (kind: string) =>
    set({
      subtypes: filters.subtypes.includes(kind)
        ? filters.subtypes.filter((s) => s !== kind)
        : [...filters.subtypes, kind],
    });

  const toggleSuffix = (suffix: string) =>
    set({
      suffixes: filters.suffixes.includes(suffix)
        ? filters.suffixes.filter((s) => s !== suffix)
        : [...filters.suffixes, suffix],
    });

  const toggleRarity = (rarity: string) =>
    set({
      rarities: filters.rarities.includes(rarity)
        ? filters.rarities.filter((r) => r !== rarity)
        : [...filters.rarities, rarity],
    });

  // Switching supertype clears the contextual selections that no longer
  // apply — card kinds, and rule-box markers when the new supertype has none
  // (they exist on Pokémon only). Without the second clear a hidden "ex" chip
  // would keep riding on the wire under `category=Trainer` and empty the grid
  // with nothing on screen to explain it.
  const setSupertype = (supertype: "all" | Supertype) => {
    const validKinds = new Set(kindOptions(supertype, facets));
    const validSuffixes = new Set(suffixOptions(supertype, facets));
    set({
      supertype,
      subtypes: filters.subtypes.filter((s) => validKinds.has(s)),
      suffixes: filters.suffixes.filter((s) => validSuffixes.has(s)),
    });
  };

  // Narrowing to a serie drops a set pick that falls outside it.
  const setSerie = (serieId: string) => {
    const setStillValid =
      serieId === "" || options.sets.some((s) => s.id === filters.setId && s.serieId === serieId);
    set({ serieId, setId: setStillValid ? filters.setId : "" });
  };

  const kinds = kindOptions(filters.supertype, facets);
  // Printed rule-box markers (ex / V / VMAX / …). Empty until an ingest fills
  // `cards.suffix`, so today this section never renders — see suffixOptions.
  const suffixes = suffixOptions(filters.supertype, facets);
  // The pips draw from the client-owned palette (colour + glyph per type);
  // facets narrow them to the types actually ingested. No facets → the full
  // wheel (an over-offer beats an empty section for a filter this central).
  const energyTypes = facets ? ENERGY_TYPES.filter((t) => facets.types.includes(t)) : ENERGY_TYPES;
  // The long option lists are memoised — the rail re-renders on every
  // keystroke in its free-text fields, and these only depend on the session
  // vocabularies (plus the serie narrowing the set list).
  const visibleSets = useMemo(
    () =>
      filters.serieId === ""
        ? options.sets
        : options.sets.filter((s) => s.serieId === filters.serieId),
    [options.sets, filters.serieId],
  );
  const serieOptions = useMemo(
    () => options.series.map((s) => ({ value: s.id, label: s.name })),
    [options.series],
  );
  const setOptions = useMemo(
    () => visibleSets.map((s) => ({ value: s.id, label: s.name })),
    [visibleSets],
  );
  const illustratorOptions = useMemo(
    () => (facets?.illustrators ?? []).map((name) => ({ value: name, label: name })),
    [facets],
  );

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white/[0.045] p-3.5 ring-1 ring-inset ring-white/10 backdrop-blur-md">
      <div>
        <SectionLabel>Format</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {FORMATS.map((f) => (
            <Chip key={f.id} selected={format.id === f.id} onClick={() => onFormatChange(f.id)}>
              {f.name}
            </Chip>
          ))}
        </div>
        {/* Offered whenever the format has a server legality flag (both do) —
            the query sends `legal=<flag>`, mirroring validateDeck. */}
        {format.legalFlag && (
          <button
            type="button"
            role="switch"
            aria-checked={filters.legalOnly}
            onClick={() => set({ legalOnly: !filters.legalOnly })}
            className={`mt-2.5 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-1 text-sm text-white/70 transition-colors motion-reduce:transition-none hover:text-white/90 ${FOCUS_RING}`}
          >
            <span>{format.name}-legal only</span>
            <span
              aria-hidden
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors motion-reduce:transition-none ${
                filters.legalOnly ? "bg-accent" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all motion-reduce:transition-none ${
                  filters.legalOnly ? "left-4 bg-zinc-900" : "left-0.5 bg-white/70"
                }`}
              />
            </span>
          </button>
        )}
      </div>

      <div className="h-px bg-white/10" />

      <div>
        <SectionLabel>Card type</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          <Chip selected={filters.supertype === "all"} onClick={() => setSupertype("all")}>
            All
          </Chip>
          {SUPERTYPES.map((s) => (
            <Chip key={s} selected={filters.supertype === s} onClick={() => setSupertype(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Energy type</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {energyTypes.map((type) => (
            <TypePip
              key={type}
              type={type}
              selected={filters.types.includes(type)}
              onToggle={() => toggleType(type)}
            />
          ))}
        </div>
      </div>

      {kinds.length > 0 && (
        <div>
          <SectionLabel>{filters.supertype === "Pokémon" ? "Pokémon" : "Subtype"}</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((kind) => (
              <Chip
                key={kind}
                selected={filters.subtypes.includes(kind)}
                onClick={() => toggleKind(kind)}
              >
                {kind}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {suffixes.length > 0 && (
        <div>
          <SectionLabel>Rule box</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {/* Values verbatim from /facets — a chip's label IS its wire
                value, so the filter and the vocabulary can't drift. */}
            {suffixes.map((suffix) => (
              <Chip
                key={suffix}
                selected={filters.suffixes.includes(suffix)}
                onClick={() => toggleSuffix(suffix)}
              >
                {suffix}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {/* The option-fed sections below need the session vocabularies; until
          they arrive (or if they never do) a spinner/hint stands in and the
          sections hide rather than render empty. */}
      {options.status === "loading" && (
        <StatusSpinner label="Loading filter options" className="flex justify-center py-1" />
      )}
      {options.status === "error" && (
        <div className="flex flex-col items-start gap-1.5 rounded-lg bg-white/[0.04] p-2.5 ring-1 ring-inset ring-white/10">
          <p className="text-xs text-white/55">Some filter options couldn't load.</p>
          <button
            type="button"
            onClick={options.retry}
            className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium bg-white/[0.05] text-white/70 ring-1 ring-inset ring-white/10 transition-colors motion-reduce:transition-none hover:bg-white/[0.09] hover:text-white/90 ${FOCUS_RING}`}
          >
            Retry
          </button>
        </div>
      )}

      {facets !== null && facets.rarities.length > 0 && (
        <div>
          <SectionLabel>Rarity</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {facets.rarities.map((r) => (
              <Chip key={r} selected={filters.rarities.includes(r)} onClick={() => toggleRarity(r)}>
                {r}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {facets !== null && facets.regulationMarks.length > 0 && (
        <div>
          <SectionLabel>Regulation mark</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {/* Single-select — GET /cards takes ONE exact mark. */}
            <Chip
              selected={filters.regulationMark === ""}
              onClick={() => set({ regulationMark: "" })}
            >
              All
            </Chip>
            {facets.regulationMarks.map((mark) => (
              <Chip
                key={mark}
                selected={filters.regulationMark === mark}
                onClick={() => set({ regulationMark: mark })}
              >
                {mark}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>HP range</SectionLabel>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={filters.hpMin}
            onChange={(e) => set({ hpMin: e.target.value })}
            placeholder="Min"
            aria-label="Minimum HP"
            className={RAIL_INPUT_CLASS}
          />
          <span aria-hidden className="text-xs text-white/40">
            –
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={filters.hpMax}
            onChange={(e) => set({ hpMax: e.target.value })}
            placeholder="Max"
            aria-label="Maximum HP"
            className={RAIL_INPUT_CLASS}
          />
        </div>
      </div>

      {(options.series.length > 0 || options.sets.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Set & serie</SectionLabel>
          {options.series.length > 0 && (
            <RailSelect
              label="Serie"
              value={filters.serieId}
              onChange={setSerie}
              anyLabel="All series"
              options={serieOptions}
            />
          )}
          {visibleSets.length > 0 && (
            <RailSelect
              label="Set"
              value={filters.setId}
              onChange={(setId) => set({ setId })}
              anyLabel="All sets"
              options={setOptions}
            />
          )}
        </div>
      )}

      {facets !== null && facets.illustrators.length > 0 && (
        <div>
          <SectionLabel>Illustrator</SectionLabel>
          <RailSelect
            label="Illustrator"
            value={filters.illustrator}
            onChange={(illustrator) => set({ illustrator })}
            anyLabel="All illustrators"
            options={illustratorOptions}
          />
        </div>
      )}

      <div>
        {/* Honest label: the server matches ability/attack names + text only
            (Trainer/Energy rules text isn't covered). */}
        <SectionLabel>Ability/attack text</SectionLabel>
        <input
          type="search"
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="e.g. discard"
          aria-label="Ability/attack text"
          className={RAIL_INPUT_CLASS}
        />
      </div>

      <div className="h-px bg-white/10" />

      <div>
        <SectionLabel>Sort by</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <Chip
              key={s.value}
              selected={filters.sort === s.value}
              onClick={() => set({ sort: s.value })}
            >
              {s.label}
            </Chip>
          ))}
        </div>
      </div>

      {filtersActive(filters) && (
        <>
          <div className="h-px bg-white/10" />
          <button
            type="button"
            onClick={onReset}
            className={`w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-sm text-white/55 transition-colors motion-reduce:transition-none hover:bg-white/[0.07] hover:text-white/85 ${FOCUS_RING}`}
          >
            Reset filters
          </button>
        </>
      )}
    </div>
  );
}
