// Constants with no zod behind them. The engine imports them as `@colorless/schema/constants`, so
// it never evaluates the package's schemas.

/** The nine types Basic Energy cards have been printed for, in the canonical
    wheel order — the one basic-energy vocabulary of the monorepo (the engine
    derives energy provision from it, the deck builder its type palette).
    Fairy is retired (Sword & Shield era) but its prints remain in the pool.
    Dragon and Colorless are deliberately NOT here: both appear as cost/type
    entries, but Dragon has no Basic Energy and Colorless is a cost symbol,
    not an attachable basic type. */
export const BASIC_ENERGY_TYPES = [
  "Grass",
  "Fire",
  "Water",
  "Lightning",
  "Psychic",
  "Fighting",
  "Darkness",
  "Metal",
  "Fairy",
] as const;
export type BasicEnergyType = (typeof BASIC_ENERGY_TYPES)[number];

/** The cardId a hidden (face-down) card carries instead of a catalog id, and
    the id for an (engine-impossible) empty in-play slot. Shared by the engine
    redactor and the web adapter so the sentinels can't drift. */
export const HIDDEN_CARD_ID = "hidden";
export const HIDDEN_CARD_NAME = "Face-down card";
export const EMPTY_CARD_ID = "empty";
export const EMPTY_CARD_NAME = "Empty slot";
