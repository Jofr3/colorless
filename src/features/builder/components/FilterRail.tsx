import type { ReactNode } from "react";
import { FOCUS_RING } from "../../../lib/glass";
import {
  ENERGY_TYPE_META,
  ENERGY_TYPES,
  ENERGY_SUBTYPES,
  type EnergyType,
  type Format,
  FORMATS,
  POKEMON_STAGES,
  type Supertype,
  SUPERTYPES,
  TRAINER_SUBTYPES,
} from "../cards";
import { type Filters, filtersActive, type SortKey } from "../poolFilter";

export interface FilterRailProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  format: Format;
  onFormatChange: (id: string) => void;
  onReset: () => void;
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "hp-desc", label: "HP" },
  { value: "set", label: "Set" },
];

/** Dark vs light glyph for a coloured pip, by perceived luminance. */
function readableInk(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0e0e14" : "#ffffff";
}

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
      className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${FOCUS_RING} ${
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
      style={{ backgroundColor: meta.color, color: readableInk(meta.color) }}
      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[11px] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition ${FOCUS_RING} ${
        selected
          ? "ring-2 ring-white ring-offset-2 ring-offset-[#15151d]"
          : "opacity-60 ring-1 ring-inset ring-black/30 hover:opacity-100"
      }`}
    >
      {meta.code}
    </button>
  );
}

/** The contextual subtypes for the chosen supertype (none when "all"). */
function subtypeOptions(supertype: "all" | Supertype): readonly string[] {
  if (supertype === "Pokémon") return POKEMON_STAGES;
  if (supertype === "Trainer") return TRAINER_SUBTYPES;
  if (supertype === "Energy") return ENERGY_SUBTYPES;
  return [];
}

/** The deck builder's left rail: format, card type, energy type, subtype and
    sort. Pure-presentational — every change flows up through `onChange`. */
export function FilterRail({ filters, onChange, format, onFormatChange, onReset }: FilterRailProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const toggleType = (type: EnergyType) =>
    set({
      types: filters.types.includes(type)
        ? filters.types.filter((t) => t !== type)
        : [...filters.types, type],
    });

  const toggleSubtype = (subtype: string) =>
    set({
      subtypes: filters.subtypes.includes(subtype)
        ? filters.subtypes.filter((s) => s !== subtype)
        : [...filters.subtypes, subtype],
    });

  // Switching supertype clears subtypes that no longer apply.
  const setSupertype = (supertype: "all" | Supertype) => {
    const valid = new Set(subtypeOptions(supertype));
    set({ supertype, subtypes: filters.subtypes.filter((s) => valid.has(s)) });
  };

  const subtypes = subtypeOptions(filters.supertype);

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
        {format.legalRegulationMarks && (
          <button
            type="button"
            role="switch"
            aria-checked={filters.legalOnly}
            onClick={() => set({ legalOnly: !filters.legalOnly })}
            className={`mt-2.5 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-1 text-sm text-white/70 transition-colors hover:text-white/90 ${FOCUS_RING}`}
          >
            <span>{format.name}-legal only</span>
            <span
              aria-hidden
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                filters.legalOnly ? "bg-accent" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
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
          {ENERGY_TYPES.map((type) => (
            <TypePip
              key={type}
              type={type}
              selected={filters.types.includes(type)}
              onToggle={() => toggleType(type)}
            />
          ))}
        </div>
      </div>

      {subtypes.length > 0 && (
        <div>
          <SectionLabel>{filters.supertype === "Pokémon" ? "Stage" : "Subtype"}</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {subtypes.map((s) => (
              <Chip key={s} selected={filters.subtypes.includes(s)} onClick={() => toggleSubtype(s)}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="h-px bg-white/10" />

      <div>
        <SectionLabel>Sort by</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <Chip key={s.value} selected={filters.sort === s.value} onClick={() => set({ sort: s.value })}>
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
            className={`w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-sm text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white/85 ${FOCUS_RING}`}
          >
            Reset filters
          </button>
        </>
      )}
    </div>
  );
}
