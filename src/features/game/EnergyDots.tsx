import type { BasicEnergyType } from "@luminous/schema";
import { ENERGY_COLORS } from "../../lib/energyPalette";

// The printed energy-cost pips shown on an attack row — shared by the local
// hot-seat HUD (GameHud) and the online turn HUD (features/online), both of
// which render a card's `attack.cost` the same way. One source so the two
// surfaces can't drift.

type CostSymbol = BasicEnergyType | "Colorless";
const ENERGY_DOT_COLORS: Record<CostSymbol, string> = {
  Grass: ENERGY_COLORS.Grass,
  Fire: ENERGY_COLORS.Fire,
  Water: ENERGY_COLORS.Water,
  Lightning: ENERGY_COLORS.Lightning,
  Psychic: ENERGY_COLORS.Psychic,
  Fighting: ENERGY_COLORS.Fighting,
  Darkness: ENERGY_COLORS.Darkness,
  Metal: ENERGY_COLORS.Metal,
  Fairy: ENERGY_COLORS.Fairy,
  Colorless: ENERGY_COLORS.Colorless,
};

/** Cost symbols arrive as free strings (schema `attack.cost`); an unknown
    one (future symbol, bad data) falls back to the neutral Colorless tint. */
function dotColor(symbol: string): string {
  return Object.hasOwn(ENERGY_DOT_COLORS, symbol)
    ? ENERGY_DOT_COLORS[symbol as CostSymbol]
    : ENERGY_COLORS.Colorless;
}

export function EnergyDots({ cost }: { cost: readonly string[] }) {
  if (cost.length === 0) {
    return <span className="text-[10px] uppercase tracking-wide text-white/40">free</span>;
  }
  return (
    <span className="flex items-center gap-1" aria-label={`cost: ${cost.join(", ")}`}>
      {cost.map((symbol, index) => (
        <span
          key={index}
          title={symbol}
          style={{ backgroundColor: dotColor(symbol) }}
          className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/30"
        />
      ))}
    </span>
  );
}
