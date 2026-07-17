import { cardImageUrl } from "../../../lib/api";
import { NO_CONDITIONS } from "../types";
import type { BattleState, BoardState, CardModel, CardType, LogEntry, TurnInfo } from "../types";

// Fixture ids in the tcgdex scheme (zero-padded set codes, e.g. "sv01-169")
// so the art resolves off the api's asset mirror — the CSP no longer allows
// the old scrydex hotlinks. Ids the catalog hasn't ingested (the me-era
// mocks) just render CardImage's neutral fallback tile; this board is mock
// data awaiting the real simulator state anyway.
const cardCatalog = {
  "me03-021": { type: "pokemon" },
  "me03-047": { type: "pokemon" },
  "me03-053": { type: "pokemon" },
  "me03-062": { type: "pokemon" },
  "me03-070": { type: "trainer" },
  "me03-086": { type: "energy" },
  "me03-087": { type: "energy" },
  "me03-088": { type: "energy" },
  "me03-111": { type: "stadium" },
  "me03-123": { type: "trainer" },
  "sv01-169": { type: "tool" },
  "sv01-174": { type: "tool" },
  "sv02-173": { type: "tool" },
  "sv03-015": { type: "pokemon" },
  "sve-007": { type: "energy" },
} as const satisfies Record<string, { type: CardType }>;

type RemoteCardId = keyof typeof cardCatalog;

function remoteImage(cardId: RemoteCardId) {
  return cardImageUrl(cardId, "high");
}

function remoteCard(id: string, cardId: RemoteCardId, name: string): CardModel {
  return {
    id,
    cardId,
    name,
    type: cardCatalog[cardId].type,
    imageUrl: remoteImage(cardId),
  };
}

/** A remoteCard with mock battle state attached — exercises the damage chip
    and the M3 status markers in the sandbox (the game page projects the real
    thing onto the same CardModel.battle slot). */
function battleCard(
  id: string,
  cardId: RemoteCardId,
  name: string,
  battle: BattleState,
): CardModel {
  return { ...remoteCard(id, cardId, name), battle };
}

const opponentCards = {
  // Damaged, Asleep AND Burned — the marker stack beside the damage chip.
  active: battleCard("opponent-active-mega-zygarde", "me03-047", "Mega Zygarde ex", {
    damage: 120,
    hp: 340,
    conditions: { rotation: "asleep", poisonDamage: 0, burned: true },
  }),
  bench: [
    remoteCard("opponent-bench-yveltal", "me03-053", "Yveltal ex"),
    remoteCard("opponent-bench-meowth", "me03-062", "Meowth ex"),
  ],
  hand: [
    remoteCard("opponent-hand-telepathic-psychic-energy", "me03-088", "Telepathic Psychic Energy"),
    remoteCard("opponent-hand-basic-darkness-energy", "sve-007", "Basic Darkness Energy"),
    remoteCard("opponent-hand-defiance-band", "sv01-169", "Defiance Band"),
    remoteCard("opponent-hand-core-memory", "me03-070", "Core Memory"),
  ],
};

const playerCards = {
  // Raised poison (20 per Checkup) — the "PSN 20" amount variant.
  active: battleCard("you-active-mega-starmie", "me03-021", "Mega Starmie ex", {
    damage: 60,
    hp: 300,
    conditions: { rotation: "none", poisonDamage: 20, burned: false },
  }),
  bench: [
    // Damage only — bench Pokémon never carry conditions (engine invariant),
    // stated explicitly now that BattleState requires the conditions object.
    battleCard("you-bench-decidueye", "sv03-015", "Decidueye ex", {
      damage: 30,
      hp: 280,
      conditions: NO_CONDITIONS,
    }),
    remoteCard("you-bench-yveltal", "me03-053", "Yveltal ex"),
    remoteCard("you-bench-meowth", "me03-062", "Meowth ex"),
  ],
  hand: [
    remoteCard("hand-decidueye", "sv03-015", "Decidueye ex"),
    remoteCard("hand-meowth", "me03-062", "Meowth ex"),
    remoteCard("hand-yveltal", "me03-053", "Yveltal ex"),
    remoteCard("hand-mega-starmie", "me03-021", "Mega Starmie ex"),
    remoteCard("hand-mega-zygarde", "me03-047", "Mega Zygarde ex"),
    remoteCard("hand-growing-grass-energy-1", "me03-086", "Growing Grass Energy"),
    remoteCard("hand-growing-grass-energy-2", "me03-086", "Growing Grass Energy"),
    remoteCard("hand-rocky-fighting-energy-1", "me03-087", "Rocky Fighting Energy"),
    remoteCard("hand-rocky-fighting-energy-2", "me03-087", "Rocky Fighting Energy"),
    remoteCard("hand-telepathic-psychic-energy-1", "me03-088", "Telepathic Psychic Energy"),
    remoteCard("hand-telepathic-psychic-energy-2", "me03-088", "Telepathic Psychic Energy"),
    remoteCard("hand-basic-darkness-energy-1", "sve-007", "Basic Darkness Energy"),
    remoteCard("hand-basic-darkness-energy-2", "sve-007", "Basic Darkness Energy"),
    remoteCard("hand-bravery-charm-1", "sv02-173", "Bravery Charm"),
    remoteCard("hand-bravery-charm-2", "sv02-173", "Bravery Charm"),
    remoteCard("hand-exp-share-1", "sv01-174", "Exp. Share"),
    remoteCard("hand-exp-share-2", "sv01-174", "Exp. Share"),
    remoteCard("hand-exp-share-3", "sv01-174", "Exp. Share"),
    remoteCard("hand-defiance-band-1", "sv01-169", "Defiance Band"),
    remoteCard("hand-defiance-band-2", "sv01-169", "Defiance Band"),
    remoteCard("hand-defiance-band-3", "sv01-169", "Defiance Band"),
  ],
};

export const initialBoard: BoardState = {
  stadium: remoteCard("stadium-lumiose-city", "me03-111", "Lumiose City"),
  you: {
    hand: playerCards.hand,
    active: playerCards.active,
    bench: playerCards.bench,
    prizesRemaining: 4,
  },
  opponent: {
    hand: opponentCards.hand,
    active: opponentCards.active,
    bench: opponentCards.bench,
    prizesRemaining: 5,
  },
};

export const initialTurn: TurnInfo = {
  turn: 7,
  activePlayer: "you",
  youName: "Jofre",
  opponentName: "Lillie",
};

export const gameLog: LogEntry[] = [
  {
    kind: "action",
    who: "you",
    elapsed: "+02:14",
    segments: [
      { text: "attached " },
      { text: "Water", tone: "energy" },
      { text: " → " },
      { text: "Mega Starmie ex", tone: "strong" },
    ],
  },
  {
    kind: "action",
    who: "you",
    elapsed: "+02:08",
    segments: [{ text: "played " }, { text: "Rosa's Encouragement", tone: "strong" }],
  },
  { kind: "turn", turn: 7 },
  {
    kind: "action",
    who: "opponent",
    elapsed: "+01:42",
    segments: [
      { text: "Mega Zygarde ex", tone: "strong" },
      { text: " used Land Crush · " },
      { text: "-60", tone: "damage" },
    ],
  },
  {
    kind: "action",
    who: "opponent",
    elapsed: "+01:30",
    segments: [{ text: "retreated " }, { text: "Yveltal ex", tone: "strong" }],
  },
  {
    kind: "action",
    who: "system",
    elapsed: "+01:24",
    segments: [{ text: "Lillie", tone: "strong" }, { text: " drew a prize card" }],
  },
];
