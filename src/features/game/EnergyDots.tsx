import type { BasicEnergyType } from "@luminous/schema";
import { ENERGY_COLORS } from "../../lib/energyPalette";

// The energy-cost pips shown on an attack row — shared by the local hot-seat HUD
// (GameHud) and the online turn HUD (features/online). One source so the two
// surfaces can't drift.
//
// ⚠️ THE COST HANDED IN IS THE EFFECTIVE ONE, NOT THE PRINTED ONE, and the two
// callers reach it differently: GameHud has the full state and computes
// `effectiveAttackCost` itself; the online panel has only the wire snapshot and
// reads `attack.effectiveCost ?? attack.cost`. Both are the array the §8.2
// payability gate charged, which is the point — the button's enabled/disabled
// state is derived from exactly these symbols, and drawing the PRINTED cost beside
// it (as both surfaces did until the seam gained a discount) means the dots and
// the button can disagree.

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
