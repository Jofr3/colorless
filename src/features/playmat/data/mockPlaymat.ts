import type { BoardState, CardModel, CardType, LogEntry, TurnInfo } from "../types";

const cardCatalog = {
  "me3-21": { type: "pokemon" },
  "me3-47": { type: "pokemon" },
  "me3-53": { type: "pokemon" },
  "me3-62": { type: "pokemon" },
  "me3-70": { type: "trainer" },
  "me3-86": { type: "energy" },
  "me3-87": { type: "energy" },
  "me3-88": { type: "energy" },
  "me3-111": { type: "stadium" },
  "me3-123": { type: "trainer" },
  "sv1-169": { type: "tool" },
  "sv1-174": { type: "tool" },
  "sv2-173": { type: "tool" },
  "sv3-15": { type: "pokemon" },
  "sve-7": { type: "energy" },
} as const satisfies Record<string, { type: CardType }>;

type RemoteCardId = keyof typeof cardCatalog;

function remoteImage(cardId: RemoteCardId) {
  return `https://images.scrydex.com/pokemon/${cardId}/large`;
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

const opponentCards = {
  active: remoteCard("opponent-active-mega-zygarde", "me3-47", "Mega Zygarde ex"),
  bench: [
    remoteCard("opponent-bench-yveltal", "me3-53", "Yveltal ex"),
    remoteCard("opponent-bench-meowth", "me3-62", "Meowth ex"),
  ],
  hand: [
    remoteCard("opponent-hand-telepathic-psychic-energy", "me3-88", "Telepathic Psychic Energy"),
    remoteCard("opponent-hand-basic-darkness-energy", "sve-7", "Basic Darkness Energy"),
    remoteCard("opponent-hand-defiance-band", "sv1-169", "Defiance Band"),
    remoteCard("opponent-hand-core-memory", "me3-70", "Core Memory"),
  ],
};

const playerCards = {
  active: remoteCard("you-active-mega-starmie", "me3-21", "Mega Starmie ex"),
  bench: [
    remoteCard("you-bench-decidueye", "sv3-15", "Decidueye ex"),
    remoteCard("you-bench-yveltal", "me3-53", "Yveltal ex"),
    remoteCard("you-bench-meowth", "me3-62", "Meowth ex"),
  ],
  hand: [
    remoteCard("hand-decidueye", "sv3-15", "Decidueye ex"),
    remoteCard("hand-meowth", "me3-62", "Meowth ex"),
    remoteCard("hand-rosa-1", "me3-123", "Rosa's Encouragement"),
    remoteCard("hand-core-memory", "me3-70", "Core Memory"),
    remoteCard("hand-yveltal", "me3-53", "Yveltal ex"),
    remoteCard("hand-rosa-2", "me3-123", "Rosa's Encouragement"),
    remoteCard("hand-growing-grass-energy", "me3-86", "Growing Grass Energy"),
    remoteCard("hand-rocky-fighting-energy", "me3-87", "Rocky Fighting Energy"),
    remoteCard("hand-bravery-charm", "sv2-173", "Bravery Charm"),
    remoteCard("hand-exp-share", "sv1-174", "Exp. Share"),
  ],
};

export const initialBoard: BoardState = {
  stadium: remoteCard("stadium-lumiose-city", "me3-111", "Lumiose City"),
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
