import type { BoardState, CardModel, LogEntry, TurnInfo } from "../types";

const remoteCardImages = {
  "me3-86": "https://images.scrydex.com/pokemon/me3-86/large",
  "me3-87": "https://images.scrydex.com/pokemon/me3-87/large",
  "me3-88": "https://images.scrydex.com/pokemon/me3-88/large",
  "sv1-169": "https://images.pokemontcg.io/sv1/169_hires.png",
  "sv1-174": "https://images.pokemontcg.io/sv1/174_hires.png",
  "sv2-173": "https://images.pokemontcg.io/sv2/173_hires.png",
  "sve-7": "https://images.pokemontcg.io/sve/7_hires.png",
} as const;

type RemoteCardId = keyof typeof remoteCardImages;

function card(id: string, cardId: string, name: string): CardModel {
  return { id, cardId, name };
}

function remoteCard(id: string, cardId: RemoteCardId, name: string): CardModel {
  return { ...card(id, cardId, name), imageUrl: remoteCardImages[cardId] };
}

const opponentCards = {
  active: card("opponent-active-mega-zygarde", "me3-47", "Mega Zygarde ex"),
  bench: [
    card("opponent-bench-yveltal", "me3-53", "Yveltal ex"),
    card("opponent-bench-meowth", "me3-62", "Meowth ex"),
  ],
  hand: [
    remoteCard("opponent-hand-telepathic-psychic-energy", "me3-88", "Telepathic Psychic Energy"),
    remoteCard("opponent-hand-basic-darkness-energy", "sve-7", "Basic Darkness Energy"),
    remoteCard("opponent-hand-defiance-band", "sv1-169", "Defiance Band"),
    card("opponent-hand-core-memory", "me3-70", "Core Memory"),
  ],
};

const playerCards = {
  active: card("you-active-mega-starmie", "me3-21", "Mega Starmie ex"),
  bench: [
    card("you-bench-decidueye", "sv3-15", "Decidueye ex"),
    card("you-bench-yveltal", "me3-53", "Yveltal ex"),
    card("you-bench-meowth", "me3-62", "Meowth ex"),
  ],
  hand: [
    card("hand-decidueye", "sv3-15", "Decidueye ex"),
    card("hand-meowth", "me3-62", "Meowth ex"),
    card("hand-rosa-1", "me3-123", "Rosa's Encouragement"),
    card("hand-core-memory", "me3-70", "Core Memory"),
    card("hand-yveltal", "me3-53", "Yveltal ex"),
    card("hand-rosa-2", "me3-123", "Rosa's Encouragement"),
    remoteCard("hand-growing-grass-energy", "me3-86", "Growing Grass Energy"),
    remoteCard("hand-rocky-fighting-energy", "me3-87", "Rocky Fighting Energy"),
    remoteCard("hand-bravery-charm", "sv2-173", "Bravery Charm"),
    remoteCard("hand-exp-share", "sv1-174", "Exp. Share"),
  ],
};

export const initialBoard: BoardState = {
  stadium: card("stadium-lumiose-city", "me3-111", "Lumiose City"),
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
