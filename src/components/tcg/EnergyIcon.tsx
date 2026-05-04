export type EnergyType =
  | "grass"
  | "fire"
  | "water"
  | "lightning"
  | "psychic"
  | "fighting"
  | "darkness"
  | "metal"
  | "fairy"
  | "dragon"
  | "colorless";

const STYLE: Record<EnergyType, { bg: string; fg: string; glyph: string }> = {
  grass:     { bg: "#6aae3f", fg: "#1f3d14", glyph: "✿" },
  fire:      { bg: "#e85a2a", fg: "#4a1405", glyph: "🔥" },
  water:     { bg: "#3a8cd8", fg: "#0d2a4a", glyph: "💧" },
  lightning: { bg: "#f5c63b", fg: "#3d2e05", glyph: "⚡" },
  psychic:   { bg: "#a85bb2", fg: "#2e0f33", glyph: "◉" },
  fighting:  { bg: "#b5683a", fg: "#3a1d0d", glyph: "✊" },
  darkness:  { bg: "#2a2830", fg: "#d8d4e0", glyph: "◆" },
  metal:     { bg: "#9aa2ad", fg: "#2a2e35", glyph: "⚙" },
  fairy:     { bg: "#e68fb5", fg: "#4a1a32", glyph: "✦" },
  dragon:    { bg: "#c59a30", fg: "#3a2806", glyph: "▲" },
  colorless: { bg: "#e5e3dc", fg: "#3a3834", glyph: "★" },
};

export interface EnergyIconProps {
  type: EnergyType;
  size?: number;
}

export default function EnergyIcon({ type, size = 20 }: EnergyIconProps) {
  const s = STYLE[type];
  return (
    <span
      className="inline-flex items-center justify-center rounded-full ring-1 ring-black/30 shadow-sm select-none"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,.35), transparent 55%), ${s.bg}`,
        color: s.fg,
        fontSize: Math.round(size * 0.55),
        lineHeight: 1,
      }}
      title={type}
    >
      <span className="translate-y-[-1px]">{s.glyph}</span>
    </span>
  );
}
