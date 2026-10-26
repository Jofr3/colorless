// @colorless/engine/rules: deck construction rules, card classes and table constants without the
// rules interpreter, for code that judges decks but never plays a game (the web app's eager
// screens). Everything here is also exported from the package root.

export { isBasicEnergy, isBasicPokemon, isSpecialEnergy } from "./cardClasses";
export {
  ACE_SPEC_LIMIT,
  contentReasons,
  copyLimitReason,
  DEFAULT_FORMAT,
  FORMATS,
  formatById,
  isAceSpec,
  isLegalInFormat,
  isPrismStar,
  isRadiantPokemon,
  PRISM_STAR_LIMIT,
  RADIANT_LIMIT,
  savedDeckReasons,
  validateDeck,
} from "./deckRules";
export type { DeckRuleCard, DeckRuleEntry, Format } from "./deckRules";
export { DECK_SIZE } from "./types";
