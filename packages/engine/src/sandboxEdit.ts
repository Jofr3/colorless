import type { Card } from "@colorless/schema";
import type {
  ApplyResult,
  Rejection,
  SandboxDestination,
  SandboxEdit,
  SandboxEditAction,
} from "./actions";
import { err, ok } from "./actions";
import { cardOfUid, topUid } from "./cards";
import { benchLimitOf } from "./continuous";
import type { GameEvent, SandboxZone } from "./events";
import { FOSSIL_IDS } from "./fossils";
import { turnGate, isBenchIndex, isPokemonTarget } from "./turn";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "./types";
import {
  clearedAttackEffects,
  evolveOnto,
  makeInPlay,
  noConditions,
  stackUids,
  withSide,
  without,
} from "./types";

// The local table's edit mode: the acting seat rewrites its own side (and the shared Stadium)
// outside the rules. No turn limits, costs or evolution rules apply, and nothing resolves a Knock
// Out or an empty board. The online match withholds the action.

type PileZone = "deck" | "hand" | "discard" | "prizes";
type BenchTarget = Extract<PokemonTarget, { spot: "bench" }>;

/** Where a uid sits on the acting seat's side. */
type Location =
  | { at: "pile"; zone: PileZone }
  | { at: "stadium" }
  | { at: "attached"; target: PokemonTarget; slot: "energy" | "tools" }
  | { at: "body"; target: PokemonTarget }
  | { at: "underStack" };

const PILES: readonly PileZone[] = ["deck", "hand", "discard", "prizes"];
const DESTINATION_ZONES: ReadonlySet<string> = new Set([
  ...PILES,
  "active",
  "bench",
  "stadium",
  "onto",
]);

const NULLABLE_STRINGS = [
  "setId",
  "localId",
  "image",
  "illustrator",
  "rarity",
  "regulationMark",
  "stage",
  "evolveFrom",
  "trainerType",
  "energyType",
  "effect",
] as const;
const NULLABLE_NUMBERS = ["hp", "retreat"] as const;
const NULLABLE_ARRAYS = ["types", "abilities", "attacks", "weaknesses", "resistances"] as const;

export function sandboxEdit(state: GameState, action: SandboxEditAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const edit = parseEdit(action.edit);
  if (edit === null) return err("EDIT_BAD_SHAPE", "the edit is malformed");
  const seat = action.seat;
  switch (edit.kind) {
    case "add":
      return addCard(state, seat, edit.card, edit.to);
    case "move":
      return moveCard(state, seat, edit.uid, edit.to);
    case "remove":
      return removeCard(state, seat, edit.uid);
    case "flipPrize":
      return flipPrize(state, seat, edit.uid);
    case "hidePrizes":
      return hidePrizes(state, seat);
  }
}

function parseEdit(value: unknown): SandboxEdit | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "add": {
      const card = sanitizedCard(value.card);
      const to = parseDestination(value.to);
      return card === null || to === null ? null : { kind: "add", card, to };
    }
    case "move": {
      const to = parseDestination(value.to);
      return typeof value.uid !== "string" || to === null
        ? null
        : { kind: "move", uid: value.uid, to };
    }
    case "remove":
    case "flipPrize":
      return typeof value.uid === "string" ? { kind: value.kind, uid: value.uid } : null;
    case "hidePrizes":
      return { kind: "hidePrizes" };
    default:
      return null;
  }
}

function parseDestination(value: unknown): SandboxDestination | null {
  if (!isRecord(value)) return null;
  const zone = value.zone;
  if (typeof zone !== "string" || !DESTINATION_ZONES.has(zone)) return null;
  if (zone !== "onto") return { zone } as SandboxDestination;
  const target = value.target;
  if (!isPokemonTarget(target)) return null;
  if (target.spot === "active") return { zone, target: { spot: "active" } };
  return isBenchIndex(target.index)
    ? { zone, target: { spot: "bench", index: target.index } }
    : null;
}

/**
 * A catalog card off the wire, or null. Every nullable column a reader may touch must be its type
 * or null, so an absent one is filled with null rather than read as undefined later.
 */
function sanitizedCard(value: unknown): Card | null {
  if (!isRecord(value)) return null;
  const { id, name, category } = value;
  if (typeof id !== "string" || id === "" || id === "__proto__" || typeof name !== "string") {
    return null;
  }
  if (category !== "Pokemon" && category !== "Trainer" && category !== "Energy") return null;
  const card: Record<string, unknown> = { ...value, id, name, category };
  const fill = (key: string, ok: (field: unknown) => boolean): boolean => {
    const field = card[key];
    if (field === undefined || field === null) {
      card[key] = null;
      return true;
    }
    return ok(field);
  };
  for (const key of NULLABLE_STRINGS) if (!fill(key, (f) => typeof f === "string")) return null;
  for (const key of NULLABLE_NUMBERS) if (!fill(key, Number.isFinite)) return null;
  for (const key of NULLABLE_ARRAYS) if (!fill(key, Array.isArray)) return null;
  if (!fill("variants", isRecord)) return null;
  if (!isRecord(card.legal)) card.legal = { standard: false, expanded: false };
  if (typeof card.setId !== "string") card.setId = "";
  if (typeof card.localId !== "string") card.localId = "";
  return card as unknown as Card;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addCard(state: GameState, seat: Seat, card: Card, to: SandboxDestination): ApplyResult {
  const uid = mintUid(state, seat);
  const pooled = Object.hasOwn(state.cardPool, card.id);
  // New objects rather than writes: cards.ts memoises faces against these two objects' identity.
  const minted: GameState = {
    ...state,
    cardIdByUid: { ...state.cardIdByUid, [uid]: card.id },
    cardPool: pooled ? state.cardPool : { ...state.cardPool, [card.id]: card },
  };
  const events: GameEvent[] = [];
  const placed = placeLoose(minted, seat, uid, to, events);
  if ("ok" in placed) return placed;
  events.unshift({
    type: "SANDBOX_EDIT",
    seat,
    edit: "add",
    uid,
    uids: [uid],
    from: null,
    ...placed.to,
  });
  return ok(placed.state, events);
}

function mintUid(state: GameState, seat: Seat): string {
  let n = 0;
  while (Object.hasOwn(state.cardIdByUid, `${seat}#e${n}`)) n++;
  return `${seat}#e${n}`;
}

function locate(state: GameState, seat: Seat, uid: string): Location | null {
  const side = state.players[seat];
  for (const zone of PILES) if (side[zone].includes(uid)) return { at: "pile", zone };
  if (state.stadium?.uid === uid) return { at: "stadium" };
  for (const [target, body] of bodiesOf(side)) {
    if (topUid(body) === uid) return { at: "body", target };
    if (body.stack.includes(uid)) return { at: "underStack" };
    if (body.energy.includes(uid)) return { at: "attached", target, slot: "energy" };
    if (body.tools.includes(uid)) return { at: "attached", target, slot: "tools" };
  }
  return null;
}

function bodiesOf(side: PlayerSide): [PokemonTarget, InPlayPokemon][] {
  const bench = side.bench.map((body, index): [PokemonTarget, InPlayPokemon] => [
    { spot: "bench", index },
    body,
  ]);
  return side.active === null ? bench : [[{ spot: "active" }, side.active], ...bench];
}

function located(
  state: GameState,
  seat: Seat,
  uid: string,
): Exclude<Location, { at: "underStack" }> | Rejection {
  const where = locate(state, seat, uid);
  if (where === null) return err("EDIT_UNKNOWN_UID", `${uid} is not on ${seat}'s side`);
  if (where.at === "underStack") {
    return err("EDIT_NOT_TOP", "only the top card of an in-play Pokémon moves its stack");
  }
  return where;
}

function moveCard(state: GameState, seat: Seat, uid: string, to: SandboxDestination): ApplyResult {
  const where = located(state, seat, uid);
  if ("ok" in where) return where;
  if (where.at === "body") return moveBody(state, seat, uid, where.target, to);
  const owner = state.stadium?.owner;
  if (where.at === "stadium" && owner !== undefined && owner !== seat) {
    return discardOpponentStadium(state, seat, uid, owner, to);
  }
  const taken = takeLoose(state, seat, uid, where);
  const events: GameEvent[] = [];
  const placed = placeLoose(taken.state, seat, uid, to, events);
  if ("ok" in placed) return placed;
  events.unshift({
    type: "SANDBOX_EDIT",
    seat,
    edit: "move",
    uid,
    uids: [uid],
    from: taken.from,
    ...placed.to,
  });
  return ok(placed.state, events);
}

function removeCard(state: GameState, seat: Seat, uid: string): ApplyResult {
  const where = located(state, seat, uid);
  if ("ok" in where) return where;
  if (where.at === "body") {
    const side = state.players[seat];
    const body = bodyAtTarget(side, where.target);
    const next = withSide(state, seat, vacate(side, where.target));
    return ok(next, [
      {
        type: "SANDBOX_EDIT",
        seat,
        edit: "remove",
        uid,
        uids: stackUids(body),
        from: where.target.spot,
        to: null,
      },
    ]);
  }
  const taken = takeLoose(state, seat, uid, where);
  return ok(taken.state, [
    { type: "SANDBOX_EDIT", seat, edit: "remove", uid, uids: [uid], from: taken.from, to: null },
  ]);
}

function flipPrize(state: GameState, seat: Seat, uid: string): ApplyResult {
  const side = state.players[seat];
  if (!side.prizes.includes(uid)) return err("EDIT_NOT_A_PRIZE", `${uid} is not a Prize card`);
  const faceUp = !side.faceUpPrizes.includes(uid);
  const faceUpPrizes = faceUp ? [...side.faceUpPrizes, uid] : without(side.faceUpPrizes, uid);
  return ok(withSide(state, seat, { ...side, faceUpPrizes }), [
    {
      type: "SANDBOX_EDIT",
      seat,
      edit: "flipPrize",
      uid,
      uids: [uid],
      from: "prizes",
      to: "prizes",
      faceUp,
    },
  ]);
}

function hidePrizes(state: GameState, seat: Seat): ApplyResult {
  const side = state.players[seat];
  const uids = side.faceUpPrizes;
  const first = uids[0];
  if (first === undefined) return err("EDIT_NO_OP", "no Prize card is face up");
  return ok(withSide(state, seat, { ...side, faceUpPrizes: [] }), [
    {
      type: "SANDBOX_EDIT",
      seat,
      edit: "hidePrizes",
      uid: first,
      uids: [...uids],
      from: "prizes",
      to: "prizes",
      faceUp: false,
    },
  ]);
}

/**
 * The shared Stadium is the one card of the opponent's an edit may touch: it may only go to its
 * owner's discard pile (or leave the game), never into the acting seat's zones.
 */
function discardOpponentStadium(
  state: GameState,
  seat: Seat,
  uid: string,
  owner: Seat,
  to: SandboxDestination,
): ApplyResult {
  if (to.zone !== "discard") {
    return err("EDIT_NOT_YOURS", "the opponent's Stadium can only be discarded or removed");
  }
  const side = state.players[owner];
  const next = withSide(state, owner, { ...side, discard: [...side.discard, uid] });
  return ok({ ...next, stadium: null }, [
    {
      type: "SANDBOX_EDIT",
      seat,
      edit: "move",
      uid,
      uids: [uid],
      from: "stadium",
      to: "discard",
      owner,
    },
  ]);
}

function takeLoose(
  state: GameState,
  seat: Seat,
  uid: string,
  where: Exclude<Location, { at: "body" } | { at: "underStack" }>,
): { state: GameState; from: SandboxZone } {
  const side = state.players[seat];
  switch (where.at) {
    case "pile":
      return {
        state: withSide(state, seat, {
          ...side,
          [where.zone]: without(side[where.zone], uid),
          ...(where.zone === "prizes" ? { faceUpPrizes: without(side.faceUpPrizes, uid) } : {}),
        }),
        from: where.zone,
      };
    case "stadium":
      return { state: { ...state, stadium: null }, from: "stadium" };
    case "attached": {
      const body = bodyAtTarget(side, where.target);
      const stripped = { ...body, [where.slot]: without(body[where.slot], uid) };
      return {
        state: withSide(state, seat, replaceBody(side, where.target, stripped)),
        from: "attached",
      };
    }
  }
}

/** Puts a loose card at a destination: the new state and the event's destination fields. */
function placeLoose(
  state: GameState,
  seat: Seat,
  uid: string,
  to: SandboxDestination,
  events: GameEvent[],
):
  | { state: GameState; to: { to: SandboxZone; target?: PokemonTarget; host?: string } }
  | Rejection {
  const side = state.players[seat];
  const card = cardOfUid(state, uid);
  if (card === undefined) return err("UNKNOWN_CARD", `no catalog card for uid ${uid}`);
  switch (to.zone) {
    case "deck":
      return {
        state: withSide(state, seat, { ...side, deck: [uid, ...side.deck] }),
        to: { to: "deck" },
      };
    case "hand":
    case "discard":
    case "prizes":
      return {
        state: withSide(state, seat, { ...side, [to.zone]: [...side[to.zone], uid] }),
        to: { to: to.zone },
      };
    case "active":
      if (!isPokemonCard(card)) return err("EDIT_BAD_DESTINATION", `${card.name} is not a Pokémon`);
      if (side.active !== null) return err("EDIT_SPOT_OCCUPIED", "the Active Spot is occupied");
      return {
        state: withSide(state, seat, { ...side, active: makeInPlay(uid, state.turn) }),
        to: { to: "active" },
      };
    case "bench": {
      if (!isPokemonCard(card)) return err("EDIT_BAD_DESTINATION", `${card.name} is not a Pokémon`);
      const limit = benchLimitOf(state, seat);
      if (side.bench.length >= limit) {
        return err("BENCH_FULL", `the bench holds at most ${limit} Pokémon`);
      }
      return {
        state: withSide(state, seat, {
          ...side,
          bench: [...side.bench, makeInPlay(uid, state.turn)],
        }),
        to: { to: "bench" },
      };
    }
    case "stadium": {
      if (card.category !== "Trainer" || card.trainerType !== "Stadium") {
        return err("EDIT_BAD_DESTINATION", `${card.name} is not a Stadium`);
      }
      let next = state;
      const old = state.stadium;
      if (old !== null) {
        // §7.3: a replaced Stadium goes to its owner's discard pile.
        const owner = state.players[old.owner];
        next = withSide(next, old.owner, { ...owner, discard: [...owner.discard, old.uid] });
        events.push({
          type: "STADIUM_DISCARDED",
          seat: old.owner,
          uid: old.uid,
          cause: "replaced",
        });
      }
      return { state: { ...next, stadium: { uid, owner: seat } }, to: { to: "stadium" } };
    }
    case "onto":
      return placeOnto(state, seat, uid, card, to.target);
  }
}

function placeOnto(
  state: GameState,
  seat: Seat,
  uid: string,
  card: Card,
  target: PokemonTarget,
): { state: GameState; to: { to: SandboxZone; target: PokemonTarget; host: string } } | Rejection {
  const side = state.players[seat];
  const body = target.spot === "active" ? side.active : side.bench[target.index];
  const host = body === null || body === undefined ? undefined : topUid(body);
  if (body === null || body === undefined || host === undefined) {
    return err("NO_TARGET", "there is no Pokémon in that spot");
  }
  const to = { to: "attached" as const, target, host };
  if (card.category === "Pokemon") {
    // §10's placement clears (Special Conditions, effects of attacks), without its legality checks;
    // the POKEMON_EVOLVED row is dropped since the edit row describes the move.
    const evolved = evolveOnto(
      state,
      { seat, target, body, bodyUid: host },
      uid,
      noConditions(),
      [],
    );
    return { state: evolved.state, to };
  }
  const slot =
    card.category === "Energy"
      ? "energy"
      : card.category === "Trainer" && card.trainerType === "Tool"
        ? "tools"
        : null;
  if (slot === null) {
    return err("EDIT_BAD_DESTINATION", `${card.name} cannot be attached to a Pokémon`);
  }
  const attached = { ...body, [slot]: [...body[slot], uid] };
  return { state: withSide(state, seat, replaceBody(side, target, attached)), to };
}

/** An Antique Fossil is played as a Basic Pokémon, so it may take a spot too. */
function isPokemonCard(card: Card): boolean {
  return card.category === "Pokemon" || FOSSIL_IDS.has(card.id);
}

function moveBody(
  state: GameState,
  seat: Seat,
  uid: string,
  from: PokemonTarget,
  to: SandboxDestination,
): ApplyResult {
  const side = state.players[seat];
  const body = bodyAtTarget(side, from);
  const cards = stackUids(body);
  const row = (fields: { to: SandboxZone; target?: PokemonTarget; swappedWith?: string }) =>
    ({
      type: "SANDBOX_EDIT",
      seat,
      edit: "move",
      uid,
      uids: cards,
      from: from.spot,
      ...fields,
    }) satisfies GameEvent;
  switch (to.zone) {
    case "deck":
    case "hand":
    case "discard":
    case "prizes": {
      const emptied = vacate(side, from);
      const pile =
        to.zone === "deck" ? [...cards, ...emptied.deck] : [...emptied[to.zone], ...cards];
      return ok(withSide(state, seat, { ...emptied, [to.zone]: pile }), [row({ to: to.zone })]);
    }
    case "active":
      if (from.spot === "active") return err("EDIT_NO_OP", "that Pokémon is already Active");
      if (side.active !== null) return err("EDIT_SPOT_OCCUPIED", "the Active Spot is occupied");
      return ok(withSide(state, seat, { ...vacate(side, from), active: promoted(state, body) }), [
        row({ to: "active" }),
      ]);
    case "bench": {
      if (from.spot === "bench") {
        const rest = side.bench.filter((_, index) => index !== from.index);
        return ok(withSide(state, seat, { ...side, bench: [...rest, body] }), [
          row({ to: "bench" }),
        ]);
      }
      const limit = benchLimitOf(state, seat);
      if (side.bench.length >= limit) {
        return err("BENCH_FULL", `the bench holds at most ${limit} Pokémon`);
      }
      return ok(
        withSide(state, seat, {
          ...side,
          active: null,
          bench: [...side.bench, benched(state, body)],
        }),
        [row({ to: "bench" })],
      );
    }
    case "stadium":
      return err("EDIT_BAD_DESTINATION", "a Pokémon in play cannot become the Stadium");
    case "onto": {
      const target = to.target;
      if (sameSpot(target, from)) {
        return err("EDIT_NO_OP", "a Pokémon cannot swap with itself");
      }
      const other = target.spot === "active" ? side.active : side.bench[target.index];
      const otherUid = other === null || other === undefined ? undefined : topUid(other);
      if (other === null || other === undefined || otherUid === undefined) {
        return err("NO_TARGET", "there is no Pokémon in that spot");
      }
      const swapped = swapBodies(state, side, from, body, target, other);
      return ok(withSide(state, seat, swapped), [
        row({ to: target.spot, target, swappedWith: otherUid }),
      ]);
    }
  }
}

function swapBodies(
  state: GameState,
  side: PlayerSide,
  a: PokemonTarget,
  bodyA: InPlayPokemon,
  b: PokemonTarget,
  bodyB: InPlayPokemon,
): PlayerSide {
  if (a.spot === "bench" && b.spot === "bench") {
    const bench = side.bench.map((body, index) =>
      index === a.index ? bodyB : index === b.index ? bodyA : body,
    );
    return { ...side, bench };
  }
  const [index, incoming, outgoing] =
    a.spot === "bench" ? [a.index, bodyA, bodyB] : [(b as BenchTarget).index, bodyB, bodyA];
  return {
    ...side,
    active: promoted(state, incoming),
    bench: side.bench.map((body, i) => (i === index ? benched(state, outgoing) : body)),
  };
}

/** Leaving the Active Spot ends Special Conditions and the effects of attacks (as `switchInto`). */
function benched(state: GameState, body: InPlayPokemon): InPlayPokemon {
  return {
    ...body,
    benchedTurn: state.turn,
    conditions: noConditions(),
    ...clearedAttackEffects(),
  };
}

function promoted(state: GameState, body: InPlayPokemon): InPlayPokemon {
  return { ...body, promotedTurn: state.turn };
}

function sameSpot(a: PokemonTarget, b: PokemonTarget): boolean {
  return a.spot === "active" ? b.spot === "active" : b.spot === "bench" && a.index === b.index;
}

function bodyAtTarget(side: PlayerSide, target: PokemonTarget): InPlayPokemon {
  const body = target.spot === "active" ? side.active : side.bench[target.index];
  // `locate` found the body at this target in this same state.
  return body as InPlayPokemon;
}

function replaceBody(side: PlayerSide, target: PokemonTarget, body: InPlayPokemon): PlayerSide {
  return target.spot === "active"
    ? { ...side, active: body }
    : { ...side, bench: side.bench.map((each, index) => (index === target.index ? body : each)) };
}

/** The side with the spot emptied; the bench stays dense. */
function vacate(side: PlayerSide, target: PokemonTarget): PlayerSide {
  return target.spot === "active"
    ? { ...side, active: null }
    : { ...side, bench: side.bench.filter((_, index) => index !== target.index) };
}
