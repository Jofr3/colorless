// Static mock data for the playmat scene. Lives in a leaf module so the
// orchestrator only re-renders these as constants and so individual
// component files (Hand, Bench, GameLog) can read them without a circular
// dependency on Body.tsx.

import type { BoardState, CardKind, LogEntry, PokeState, TurnInfo } from "./types";

const apiCardImages = {
  "me3-70": "https://images.scrydex.com/pokemon/me3-70/large",
  "me3-86": "https://images.scrydex.com/pokemon/me3-86/large",
  "me3-87": "https://images.scrydex.com/pokemon/me3-87/large",
  "me3-88": "https://images.scrydex.com/pokemon/me3-88/large",
  "sv1-169": "https://images.pokemontcg.io/sv1/169_hires.png",
  "sv1-174": "https://images.pokemontcg.io/sv1/174_hires.png",
  "sv2-173": "https://images.pokemontcg.io/sv2/173_hires.png",
  "sve-7": "https://images.pokemontcg.io/sve/7_hires.png",
} as const;

function apiCard(id: string, cardId: keyof typeof apiCardImages, name: string, cardType: CardKind): PokeState {
  return {
    id,
    cardId,
    name,
    cardType,
    imageUrl: apiCardImages[cardId],
  };
}

const opponentActive: PokeState = {
  id: "opponent-active-mega-zygarde",
  name: "Mega Zygarde ex",
  cardType: "pokemon",
  hp: 340,
  type: "fighting",
  damage: 40,
  cardId: "me3-47",
};

const opponentBench: PokeState[] = [
  {
    id: "opponent-bench-yveltal",
    name: "Yveltal ex",
    cardType: "pokemon",
    hp: 270,
    type: "darkness",
    cardId: "me3-53",
  },
  {
    id: "opponent-bench-meowth",
    name: "Meowth ex",
    cardType: "pokemon",
    hp: 200,
    type: "colorless",
    cardId: "me3-62",
  },
];

const opponentHand: PokeState[] = [
  apiCard("opponent-hand-telepathic-psychic-energy", "me3-88", "Telepathic Psychic Energy", "energy"),
  apiCard("opponent-hand-basic-darkness-energy", "sve-7", "Basic Darkness Energy", "energy"),
  apiCard("opponent-hand-defiance-band", "sv1-169", "Defiance Band", "tool"),
  apiCard("opponent-hand-core-memory", "me3-70", "Core Memory", "tool"),
];

const playerActive: PokeState = {
  id: "you-active-mega-starmie",
  name: "Mega Starmie ex",
  cardType: "pokemon",
  hp: 300,
  type: "water",
  damage: 20,
  cardId: "me3-21",
};

const playerBench: PokeState[] = [
  {
    id: "you-bench-decidueye",
    name: "Decidueye ex",
    cardType: "pokemon",
    hp: 280,
    type: "grass",
    cardId: "sv3-15",
  },
  {
    id: "you-bench-yveltal",
    name: "Yveltal ex",
    cardType: "pokemon",
    hp: 270,
    type: "darkness",
    cardId: "me3-53",
  },
  {
    id: "you-bench-meowth",
    name: "Meowth ex",
    cardType: "pokemon",
    hp: 200,
    type: "colorless",
    cardId: "me3-62",
  },
];

const initialStadium: PokeState = {
  id: "stadium-lumiose-city",
  name: "Lumiose City",
  cardType: "stadium",
  cardId: "me3-111",
};

const playerHand: PokeState[] = [
  { id: "hand-decidueye", cardId: "sv3-15", name: "Decidueye ex", cardType: "pokemon" },
  { id: "hand-meowth", cardId: "me3-62", name: "Meowth ex", cardType: "pokemon" },
  { id: "hand-rosa-1", cardId: "me3-123", name: "Rosa's Encouragement", cardType: "supporter" },
  { id: "hand-core-memory", cardId: "me3-70", name: "Core Memory", cardType: "tool" },
  { id: "hand-yveltal", cardId: "me3-53", name: "Yveltal ex", cardType: "pokemon" },
  { id: "hand-rosa-2", cardId: "me3-123", name: "Rosa's Encouragement", cardType: "supporter" },
  apiCard("hand-growing-grass-energy", "me3-86", "Growing Grass Energy", "energy"),
  apiCard("hand-rocky-fighting-energy", "me3-87", "Rocky Fighting Energy", "energy"),
  apiCard("hand-bravery-charm", "sv2-173", "Bravery Charm", "tool"),
  apiCard("hand-exp-share", "sv1-174", "Exp. Share", "tool"),
];

export const initialBoard: BoardState = {
  stadium: initialStadium,
  you: {
    hand: playerHand,
    active: playerActive,
    bench: playerBench,
    prizesRemaining: 4,
  },
  opponent: {
    hand: opponentHand,
    active: opponentActive,
    bench: opponentBench,
    prizesRemaining: 5,
  },
};

export const turnInfo: TurnInfo = {
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
    segments: [
      { text: "played " },
      { text: "Rosa's Encouragement", tone: "strong" },
    ],
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
    segments: [
      { text: "retreated " },
      { text: "Yveltal ex", tone: "strong" },
    ],
  },
  {
    kind: "action",
    who: "system",
    elapsed: "+01:24",
    segments: [
      { text: "Lillie", tone: "strong" },
      { text: " drew a prize card" },
    ],
  },
];
