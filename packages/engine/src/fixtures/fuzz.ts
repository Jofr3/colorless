// Shared by the hostile-action fuzz (`actionFuzz.test.ts`, synthetic fixture decks) and the
// real-card fuzz (`actionFuzzReal.test.ts`, the bench decks): the hostile action generators, and the
// checks an accepted action's result must pass.

import type { EffectPrompt, PokemonRef } from "../effectPrompt";
import type { GameAction, GameEvent, GameState, InPlayPokemon, Seat } from "../index";
import { BENCH_CEILING, PRIZE_COUNT, SEATS, isRngState, logFromEvents, redactGame } from "../index";
import { candidateActions } from "./walk";

/** Values a hostile client puts where a field belongs: prototype keys, wrong types, huge and
    fractional numbers, numeric and NaN strings, and malformed spots. */
const JUNK: readonly unknown[] = [
  null,
  true,
  -1,
  1e9,
  Number.MAX_SAFE_INTEGER,
  1.5,
  "",
  "0",
  "NaN",
  "Infinity",
  "-0",
  "__proto__",
  "constructor",
  "prototype",
  "length",
  "toString",
  "hasOwnProperty",
  [],
  [null],
  ["__proto__"],
  {},
  JSON.parse('{"__proto__":{"polluted":1}}'), // an own `__proto__` key, as a parsed frame carries
  { spot: "bench", index: 99 },
  { spot: "bench", index: -1 },
  { spot: "bench", index: "0" },
  { spot: "bench", index: "__proto__" },
  { spot: "nope" },
  { seat: "p1", spot: { spot: "active" } },
  { seat: "zz", spot: { spot: "active" } },
  { seat: "__proto__", spot: { spot: "active" } },
];

/** Every action type the engine knows, plus names it does not. */
const TYPES: readonly string[] = [
  "chooseFirstPlayer",
  "setupDrawExtra",
  "setupPlaceActive",
  "setupPlaceBench",
  "setupReady",
  "reorderBench",
  "attachEnergy",
  "playBasicToBench",
  "evolve",
  "attachTool",
  "playTrainer",
  "useAbility",
  "useStadiumAbility",
  "rareCandy",
  "concede",
  "attack",
  "takePrizes",
  "promote",
  "retreat",
  "resolveEffect",
  "endTurn",
  "discardFromPlay",
  "bogus",
  "__proto__",
  "constructor",
];

/** The fields actions carry, so a crafted action can put junk in any of them. */
const FIELDS: readonly string[] = [
  "uid",
  "index",
  "target",
  "first",
  "count",
  "abilityName",
  "evolutionUid",
  "prizeIndices",
  "benchIndex",
  "discardEnergy",
  "promoteBenchIndex",
  "choice",
];

/** Effect choice kinds, for junk answers to whatever prompt is parked. */
const CHOICE_KINDS: readonly string[] = [
  "mayDraw",
  "hpGuess",
  "confirm",
  "orderCards",
  "pokemon",
  "pokemonMulti",
  "moveEnergy",
  "discardEnergy",
  "discardTools",
  "cards",
  "attach",
  "attack",
  "prize",
  "bogus",
  "__proto__",
];

export type Rng = () => number;

/** mulberry32: a small seeded rng, so every run sends the same actions. */
export function rngFrom(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

/** `action` with the value at one of its fields (nested ones included) replaced by junk, or
    removed. `type` and `seat` stay: `seat` is overwritten on the way in anyway. */
function mutate(rng: Rng, action: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(action)) as Record<string, unknown>;
  const paths: string[][] = [];
  const visit = (obj: Record<string, unknown>, path: string[]) => {
    for (const [key, value] of Object.entries(obj)) {
      if (path.length === 0 && (key === "type" || key === "seat")) continue;
      paths.push([...path, key]);
      if (value !== null && typeof value === "object" && !Array.isArray(value))
        visit(value as Record<string, unknown>, [...path, key]);
    }
  };
  visit(copy, []);
  const path = paths.length === 0 ? [pick(rng, FIELDS)] : pick(rng, paths);
  let holder = copy;
  for (const key of path.slice(0, -1)) holder = holder[key] as Record<string, unknown>;
  const last = path[path.length - 1] as string;
  const roll = rng();
  if (roll < 0.1) delete holder[last];
  else if (roll < 0.2 && Array.isArray(holder[last]))
    holder[last] = [...(holder[last] as unknown[]), ...(holder[last] as unknown[])];
  else if (roll < 0.3) holder[last] = [pick(rng, JUNK)];
  else holder[last] = pick(rng, JUNK);
  return copy;
}

/** A made-up action: any type, any seat, and a few fields of junk. */
function crafted(rng: Rng, seat: Seat): Record<string, unknown> {
  const action: Record<string, unknown> = { type: pick(rng, TYPES), seat };
  const fields = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < fields; i++) action[pick(rng, FIELDS)] = pick(rng, JUNK);
  return action;
}

/** A junk answer to the parked prompt: a real or made-up kind with junk in every field. */
function junkChoice(rng: Rng, seat: Seat): Record<string, unknown> {
  const choice: Record<string, unknown> = { kind: pick(rng, CHOICE_KINDS) };
  for (const key of ["uids", "ref", "refs", "index", "moves", "attachments", "hp", "yes", "draw"])
    if (rng() < 0.5) choice[key] = pick(rng, JUNK);
  return { type: "resolveEffect", seat, choice };
}

/** The turn-1 crafted attack MI3 names, aimed at whichever seat is acting. */
function prototypeAttacks(state: GameState): Record<string, unknown>[] {
  if (state.phase.kind !== "turn:action") return [];
  const seat = state.phase.seat;
  return ["__proto__", "constructor", "length", "toString"].map((index) => ({
    type: "attack",
    seat,
    index,
  }));
}

/** The actions sent at `state`: each seat's candidates sent as either seat (out of turn and for
    the opponent), a mutated copy of each, made-up actions, and junk prompt answers. */
export function hostileActionsAt(rng: Rng, state: GameState): { action: unknown; seat: Seat }[] {
  const out: { action: unknown; seat: Seat }[] = [];
  for (const owner of SEATS) {
    for (const candidate of candidateActions(state, owner)) {
      const asRecord = candidate as unknown as Record<string, unknown>;
      out.push({ action: candidate, seat: pick(rng, SEATS) });
      out.push({ action: mutate(rng, asRecord), seat: owner });
    }
  }
  for (const seat of SEATS) {
    for (let i = 0; i < 8; i++) out.push({ action: crafted(rng, seat), seat });
    if (state.phase.kind === "effect:choose")
      for (let i = 0; i < 8; i++) out.push({ action: junkChoice(rng, seat), seat });
    for (const action of prototypeAttacks(state)) out.push({ action, seat });
  }
  return out;
}

/** Every card uid in a zone, sorted: an accepted action moves cards, never mints or loses them. */
export function zoneUids(state: GameState): string[] {
  const body = (p: InPlayPokemon | null) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools];
  const uids = SEATS.flatMap((seat) => {
    const side = state.players[seat];
    return [
      ...side.deck,
      ...side.hand,
      ...side.discard,
      ...side.prizes,
      ...body(side.active),
      ...side.bench.flatMap(body),
    ];
  });
  if (state.stadium !== null) uids.push(state.stadium.uid);
  return uids.sort();
}

/** The path to the first value JSON cannot carry (a non-finite number, undefined in an array, a
    function), or null. Storage and the wire are JSON, so such a value silently becomes null. */
function nonJsonAt(value: unknown, path = "state"): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : path;
  if (typeof value === "function" || typeof value === "bigint" || typeof value === "symbol")
    return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === undefined) return `${path}[${i}]`;
      const bad = nonJsonAt(value[i], `${path}[${i}]`);
      if (bad !== null) return bad;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const bad = nonJsonAt(item, `${path}.${key}`);
      if (bad !== null) return bad;
    }
  }
  return null;
}

/** What the lobby does with an accepted action's result: log the events, redact for each seat
    and for spectators, and persist. Returns the first problem, or null. */
export function afterAccept(
  before: GameState,
  after: GameState,
  events: GameEvent[],
): string | null {
  logFromEvents(events, { names: { p1: "a", p2: "b" }, state: after, elapsed: "+00:00" });
  redactGame(after, "p1");
  redactGame(after, "p2");
  redactGame(after, "p1", true);
  const bad = nonJsonAt(after);
  if (bad !== null) return `non-JSON value at ${bad}`;
  const [was, now] = [zoneUids(before), zoneUids(after)];
  if (was.join() !== now.join()) return `card count ${String(was.length)} -> ${String(now.length)}`;
  // A game keeps its generator: a ChaCha20 game never falls back to a guessable number.
  if (!isRngState(after.rngState) || typeof after.rngState !== typeof before.rngState)
    return "rngState left its generator";
  return null;
}

/** Whether the condition `reason` names holds for `seat`'s win at the end of a game. */
function winConditionMet(state: GameState, seat: Seat, reason: string): boolean {
  const opponent = state.players[seat === "p1" ? "p2" : "p1"];
  if (reason === "prizesTaken") return state.players[seat].prizes.length === 0;
  if (reason === "noPokemon") return opponent.active === null && opponent.bench.length === 0;
  if (reason === "deckOut") return opponent.deck.length === 0;
  return true;
}

/** Board rules every accepted action keeps (beyond `afterAccept`'s card count): no uid in two
    zones, at most six Prizes and the Bench ceiling, damage in whole counters, no empty body, face-up
    Prizes among the Prizes, the turn never going back, and a game over naming a condition that
    holds. Returns the broken rules. */
export function boardViolations(before: GameState, after: GameState): string[] {
  const out: string[] = [];
  const uids = zoneUids(after);
  if (new Set(uids).size !== uids.length) out.push("a uid is in two zones");
  for (const seat of SEATS) {
    const side = after.players[seat];
    if (side.prizes.length > PRIZE_COUNT) out.push(`${seat} holds ${side.prizes.length} Prizes`);
    if (side.bench.length > BENCH_CEILING) out.push(`${seat} benches ${side.bench.length}`);
    for (const body of [side.active, ...side.bench]) {
      if (body === null) continue;
      if (!(body.damage >= 0) || body.damage % 10 !== 0)
        out.push(`${seat} body has damage ${body.damage}`);
      if (body.stack.length === 0) out.push(`${seat} body has no card`);
    }
    for (const uid of side.faceUpPrizes)
      if (!side.prizes.includes(uid)) out.push(`${seat} face-up ${uid} is not a Prize`);
  }
  if (after.turn < before.turn) out.push("the turn went back");
  if (after.phase.kind === "gameOver") {
    const outcome = after.phase.outcome;
    const held =
      outcome.result === "win"
        ? winConditionMet(after, outcome.winner, outcome.reason)
        : SEATS.every((seat) => winConditionMet(after, seat, outcome.reasons[seat]));
    if (!held) out.push(`game over names a condition that does not hold: ${stable(outcome)}`);
  }
  return out;
}

const stable = (value: unknown) => JSON.stringify(value);

/** Whether `items` has no repeats, by JSON identity (refs are objects). */
function distinct(items: readonly unknown[]): boolean {
  return new Set(items.map(stable)).size === items.length;
}

function within(items: readonly unknown[], offered: readonly unknown[]): boolean {
  const allowed = new Set(offered.map(stable));
  return items.every((item) => allowed.has(stable(item)));
}

/** The answer kind each prompt kind takes. */
const ANSWER_KIND: Record<EffectPrompt["kind"], string> = {
  chooseCards: "cards",
  choosePokemon: "pokemon",
  choosePokemonMulti: "pokemonMulti",
  moveEnergy: "moveEnergy",
  discardEnergy: "discardEnergy",
  discardTools: "discardTools",
  attachCards: "attachCards",
  mayDraw: "mayDraw",
  guessHp: "hpGuess",
  chooseAttack: "attack",
  choosePrize: "prize",
  confirm: "confirm",
  orderCards: "orderCards",
};

/** What an accepted answer to `prompt` broke: it is the prompt's answer kind and names only
    offered options, each once, within the prompt's ceiling. Returns the broken rules. */
function answerViolations(prompt: EffectPrompt, choice: Record<string, unknown>): string[] {
  if (choice.kind !== ANSWER_KIND[prompt.kind])
    return [`a ${String(choice.kind)} answer to a ${prompt.kind} prompt`];
  const out: string[] = [];
  const list = (key: string) => (Array.isArray(choice[key]) ? (choice[key] as unknown[]) : null);
  const subset = (
    what: string,
    items: unknown[] | null,
    offered: readonly unknown[],
    max = 1e9,
  ) => {
    if (items === null) return out.push(`${what} is not a list`);
    if (!distinct(items)) out.push(`${what} repeats an option`);
    if (!within(items, offered)) out.push(`${what} names an option not offered`);
    if (items.length > max) out.push(`${what} takes ${items.length} of at most ${max}`);
  };
  const refs = (candidates: readonly PokemonRef[]) => candidates as readonly unknown[];
  switch (prompt.kind) {
    case "chooseCards":
      subset("cards", list("uids"), prompt.candidates, prompt.max);
      break;
    case "discardEnergy":
    case "discardTools":
      subset(
        prompt.kind,
        list("uids"),
        prompt.discardable.map((d) => d.uid),
      );
      break;
    case "orderCards": {
      const uids = list("uids") ?? [];
      if (uids.length > 0 && stable([...uids].sort()) !== stable([...prompt.candidates].sort()))
        out.push("orderCards is not a permutation of the candidates");
      break;
    }
    case "choosePokemon":
      if (choice.ref !== undefined && !within([choice.ref], refs(prompt.candidates)))
        out.push("pokemon names a body not offered");
      break;
    case "choosePokemonMulti":
      subset("pokemonMulti", list("refs"), refs(prompt.candidates), prompt.max);
      break;
    case "attachCards": {
      const assignments = (list("assignments") ?? []) as { uid?: unknown; to?: unknown }[];
      subset(
        "attachCards",
        assignments.map((a) => a.uid),
        prompt.candidates,
        prompt.max,
      );
      if (
        !within(
          assignments.map((a) => a.to),
          refs(prompt.targets),
        )
      )
        out.push("attachCards names a target not offered");
      break;
    }
    case "moveEnergy": {
      const picks = (list("picks") ?? []) as { uid?: unknown; dest?: unknown }[];
      subset(
        "moveEnergy",
        picks.map((p) => p.uid),
        prompt.movable.map((m) => m.uid),
        prompt.max,
      );
      if (
        !within(
          picks.map((p) => p.dest),
          refs(prompt.destinations),
        )
      )
        out.push("moveEnergy names a destination not offered");
      break;
    }
    case "chooseAttack":
      if (!prompt.candidates.some((c) => c.index === choice.index))
        out.push("attack names an index not offered");
      break;
    case "choosePrize":
      if (!prompt.indices.includes(choice.index as number))
        out.push("prize names a slot not offered");
      break;
    case "confirm":
      if (typeof choice.yes !== "boolean") out.push("confirm is not a boolean");
      if (choice.target !== undefined && !within([choice.target], refs(prompt.targets ?? [])))
        out.push("confirm names a target not offered");
      break;
    case "mayDraw":
      if (typeof choice.draw !== "boolean") out.push("mayDraw is not a boolean");
      break;
    case "guessHp":
      if (!Number.isInteger(choice.hp) || (choice.hp as number) < 0)
        out.push("hpGuess is not a whole number");
      break;
  }
  return out;
}

/** What an accepted Prize take or prompt answer broke: the right seat answered, and it named only
    what was offered (`answerViolations`). Every other action passes. */
export function promptViolations(state: GameState, action: GameAction): string[] {
  const phase = state.phase;
  if (action.type === "takePrizes" && phase.kind === "ko:takePrizes") {
    const indices = action.prizeIndices as unknown[];
    const slots = state.players[phase.seat].prizes.map((_, i) => i);
    const out: string[] = [];
    if (action.seat !== phase.seat) out.push(`${action.seat} took ${phase.seat}'s Prizes`);
    if (!Array.isArray(indices)) return [...out, "prizeIndices is not a list"];
    if (!distinct(indices)) out.push("prizeIndices repeats a slot");
    if (!within(indices, slots)) out.push("prizeIndices names a slot that does not exist");
    if (indices.length > phase.count) out.push(`took ${indices.length} of ${phase.count} Prizes`);
    return out;
  }
  if (action.type === "resolveEffect" && phase.kind === "effect:choose") {
    const answerer = phase.answerer ?? phase.seat;
    const out = action.seat === answerer ? [] : [`${action.seat} answered ${answerer}'s prompt`];
    return [...out, ...answerViolations(phase.prompt, action.choice as Record<string, unknown>)];
  }
  return [];
}
