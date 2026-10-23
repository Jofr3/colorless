import type { GameState, PlayerSide, Seat, SpecialConditions } from "../index";
import { makeInPlay, withActive } from "../types";

/** Merge `patch` into `seat`'s side. */
export function patchSide(state: GameState, seat: Seat, patch: Partial<PlayerSide>): GameState {
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], ...patch } } };
}

/** The first `count` copies of `cardId` in `seat`'s deck, and the deck without them. */
export function takeFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): { uids: string[]; rest: string[] } {
  const deck = state.players[seat].deck;
  const uids = deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return { uids, rest: deck.filter((uid) => !taken.has(uid)) };
}

function takeOneFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
): { uid: string; rest: string[] } {
  const deck = state.players[seat].deck;
  const uid = deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  return { uid, rest: deck.filter((u) => u !== uid) };
}

export function setActiveFromDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const { uid, rest } = takeOneFromDeck(state, seat, cardId);
  const benched = side.active === null ? side.bench : [...side.bench, side.active];
  if (benched.length > 5) throw new Error("no bench room to displace the current Active");
  return patchSide(state, seat, { deck: rest, active: makeInPlay(uid, 0), bench: benched });
}

export function benchFromDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const { uid, rest } = takeOneFromDeck(state, seat, cardId);
  if (side.bench.length >= 5) throw new Error("no bench room");
  return patchSide(state, seat, { deck: rest, bench: [...side.bench, makeInPlay(uid, 0)] });
}

export function clearBench(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const returned = side.bench.flatMap((p) => [...p.stack, ...p.energy, ...p.tools]);
  return patchSide(state, seat, { bench: [], deck: [...side.deck, ...returned] });
}

/** Set bench[index]'s damage outright (setDamage's bench twin). */
export function setBenchDamage(
  state: GameState,
  seat: Seat,
  index: number,
  damage: number,
): GameState {
  const side = state.players[seat];
  if (side.bench[index] === undefined)
    throw new Error(`${seat} has no benched Pokémon at ${index}`);
  return patchSide(state, seat, {
    bench: side.bench.map((pokemon, i) => (i === index ? { ...pokemon, damage } : pokemon)),
  });
}

export function attachFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  const { uids, rest } = takeFromDeck(state, seat, cardId, count);
  return patchSide(state, seat, {
    deck: rest,
    active: { ...active, energy: [...active.energy, ...uids] },
  });
}

export function attachToolFromDeck(
  state: GameState,
  seat: Seat,
  target: "active" | number,
  cardId: string,
): GameState {
  const side = state.players[seat];
  const { uid, rest } = takeOneFromDeck(state, seat, cardId);
  if (target === "active" && side.active === null) throw new Error(`${seat} has no Active Pokémon`);
  if (target !== "active" && side.bench[target] === undefined) {
    throw new Error(`${seat} has no benched Pokémon at ${target}`);
  }
  return patchSide(state, seat, {
    deck: rest,
    active:
      target === "active" && side.active !== null
        ? { ...side.active, tools: [...side.active.tools, uid] }
        : side.active,
    bench:
      target === "active"
        ? side.bench
        : side.bench.map((pokemon, i) =>
            i === target ? { ...pokemon, tools: [...pokemon.tools, uid] } : pokemon,
          ),
  });
}

export function attachBenchFromDeck(
  state: GameState,
  seat: Seat,
  index: number,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  if (side.bench[index] === undefined)
    throw new Error(`${seat} has no benched Pokémon at ${index}`);
  const { uids, rest } = takeFromDeck(state, seat, cardId, count);
  return patchSide(state, seat, {
    deck: rest,
    bench: side.bench.map((pokemon, i) =>
      i === index ? { ...pokemon, energy: [...pokemon.energy, ...uids] } : pokemon,
    ),
  });
}

export function handFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const { uids, rest } = takeFromDeck(state, seat, cardId, count);
  return patchSide(state, seat, { deck: rest, hand: [...state.players[seat].hand, ...uids] });
}

export function discardFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const { uids, rest } = takeFromDeck(state, seat, cardId, count);
  return patchSide(state, seat, {
    deck: rest,
    discard: [...state.players[seat].discard, ...uids],
  });
}

export function toDeckTop(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  const { uids, rest } = takeFromDeck(state, seat, cardId, count);
  return patchSide(state, seat, { deck: [...uids, ...rest] });
}

export function trimDeckTo(state: GameState, seat: Seat, size: number): GameState {
  const side = state.players[seat];
  const keep = Math.max(0, size);
  if (side.deck.length <= keep) return state;
  return patchSide(state, seat, {
    deck: side.deck.slice(0, keep),
    discard: [...side.discard, ...side.deck.slice(keep)],
  });
}

export function handToDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const moved = side.hand.filter((uid) => state.cardIdByUid[uid] === cardId);
  if (moved.length === 0) return state;
  const movedSet = new Set(moved);
  return patchSide(state, seat, {
    hand: side.hand.filter((uid) => !movedSet.has(uid)),
    deck: [...side.deck, ...moved],
  });
}

/** Make sure a copy of `id` is in `seat`'s deck: from hand first, else swapped
    out of the prizes for the deck's last card. */
export function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    return patchSide(state, seat, {
      hand: side.hand.filter((u) => u !== held),
      deck: [...side.deck, held],
    });
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  return patchSide(state, seat, {
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  });
}

/** Swap every prize whose card id is in `keep` for a deck card that is not. */
export function unprize(state: GameState, seat: Seat, keep: Iterable<string>): GameState {
  const side = state.players[seat];
  const kept = new Set(keep);
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!kept.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !kept.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return patchSide(state, seat, { prizes, deck });
}

export function setConditions(
  state: GameState,
  seat: Seat,
  conditions: Partial<SpecialConditions>,
): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return withActive(state, seat, {
    ...active,
    conditions: { ...active.conditions, ...conditions },
  });
}

/** Set the Active's damage outright. */
export function setDamage(state: GameState, seat: Seat, damage: number): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return withActive(state, seat, { ...active, damage });
}

export function setPrizes(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  return patchSide(state, seat, {
    prizes: side.prizes.slice(0, count),
    deck: [...side.deck, ...side.prizes.slice(count)],
  });
}
