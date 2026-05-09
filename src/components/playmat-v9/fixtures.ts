// Static mock data for the playmat scene. Lives in a leaf module so the
// orchestrator only re-renders these as constants and so individual
// component files (Hand, Bench, GameLog) can read them without a circular
// dependency on Body.tsx.

import type { BoardState, LogEntry, PokeState, TurnInfo } from "./types";

const opponentActive: PokeState = {
  id: "opponent-active-mega-zygarde",
  name: "Mega Zygarde ex",
  hp: 340,
  type: "fighting",
  damage: 40,
  cardId: "me3-47",
};

const opponentBench: PokeState[] = [
  { id: "opponent-bench-yveltal", name: "Yveltal ex", hp: 270, type: "darkness", cardId: "me3-53" },
  { id: "opponent-bench-meowth", name: "Meowth ex", hp: 200, type: "colorless", cardId: "me3-62" },
];

const playerActive: PokeState = {
  id: "you-active-mega-starmie",
  name: "Mega Starmie ex",
  hp: 300,
  type: "water",
  damage: 20,
  cardId: "me3-21",
};

const playerBench: PokeState[] = [
  { id: "you-bench-decidueye", name: "Decidueye ex", hp: 280, type: "grass", cardId: "sv3-15" },
  { id: "you-bench-yveltal", name: "Yveltal ex", hp: 270, type: "darkness", cardId: "me3-53" },
  { id: "you-bench-meowth", name: "Meowth ex", hp: 200, type: "colorless", cardId: "me3-62" },
];

const initialStadium: PokeState = {
  id: "stadium-lumiose-city",
  name: "Lumiose City",
  cardId: "me3-111",
};

const playerHand: PokeState[] = [
  { id: "hand-decidueye", cardId: "sv3-15", name: "Decidueye ex" },
  { id: "hand-meowth", cardId: "me3-62", name: "Meowth ex" },
  { id: "hand-rosa-1", cardId: "me3-123", name: "Rosa's Encouragement" },
  { id: "hand-core-memory", cardId: "me3-70", name: "Core Memory" },
  { id: "hand-yveltal", cardId: "me3-53", name: "Yveltal ex" },
  { id: "hand-rosa-2", cardId: "me3-123", name: "Rosa's Encouragement" },
];

export const initialBoard: BoardState = {
  hand: playerHand,
  stadium: initialStadium,
  you: {
    active: playerActive,
    bench: playerBench,
    prizesRemaining: 4,
  },
  opponent: {
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
