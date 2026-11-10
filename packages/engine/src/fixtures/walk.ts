import type { EffectChoice, EffectPrompt, PokemonRef } from "../effectPrompt";
import type { GameAction, GameEvent, GameState, PokemonTarget, Seat } from "../index";
import { SEATS, applyAction, cardOfUid, programFor, topUid } from "../index";
import { randomIndex, shuffle } from "../rng";

const MAX_ATTACK_ROWS = 6;

function targetsOf(state: GameState, seat: Seat): PokemonTarget[] {
  const side = state.players[seat];
  return [
    ...(side.active === null ? [] : [{ spot: "active" } as const]),
    ...side.bench.map((_, index) => ({ spot: "bench" as const, index })),
  ];
}

function prefixes<T>(items: readonly T[], from: number, to: number): T[][] {
  const out: T[][] = [];
  for (let k = Math.max(0, from); k <= Math.min(to, items.length); k += 1)
    out.push(items.slice(0, k));
  return out;
}

const sameRef = (a: PokemonRef, b: PokemonRef) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A bounded set of answers to `prompt` that includes the declines, the exact-count picks and every
 * single pick. Not every legal answer, but enough to find one wherever one exists.
 */
export function choiceCandidates(prompt: EffectPrompt): EffectChoice[] {
  switch (prompt.kind) {
    case "mayDraw":
      return [
        { kind: "mayDraw", draw: true },
        { kind: "mayDraw", draw: false },
      ];
    case "guessHp":
      return [0, 60, 120].map((hp) => ({ kind: "hpGuess", hp }));
    case "confirm":
      return [
        { kind: "confirm", yes: false },
        ...(prompt.targets === undefined
          ? [{ kind: "confirm" as const, yes: true }]
          : prompt.targets.map((target) => ({ kind: "confirm" as const, yes: true, target }))),
      ];
    case "orderCards":
      return [
        { kind: "orderCards", uids: [...prompt.candidates] },
        { kind: "orderCards", uids: [...prompt.candidates].reverse() },
        ...(prompt.alt === undefined ? [] : [{ kind: "orderCards" as const, uids: [] }]),
      ];
    case "choosePokemon":
      return [
        { kind: "pokemon" },
        ...prompt.candidates.map((ref) => ({ kind: "pokemon" as const, ref })),
      ];
    case "choosePokemonMulti":
      return [
        { kind: "pokemonMulti", refs: [] },
        ...prompt.candidates.map((ref) => ({ kind: "pokemonMulti" as const, refs: [ref] })),
        ...prefixes(prompt.candidates, prompt.min, prompt.max).map((refs) => ({
          kind: "pokemonMulti" as const,
          refs,
        })),
      ];
    case "moveEnergy": {
      const picks = prompt.movable.flatMap((m) =>
        prompt.destinations
          .filter((dest) => !sameRef(dest, m.from))
          .slice(0, 1)
          .map((dest) => ({ uid: m.uid, dest })),
      );
      return [
        { kind: "moveEnergy", picks: [] },
        ...prompt.movable.flatMap((m) =>
          prompt.destinations
            .filter((dest) => !sameRef(dest, m.from))
            .map((dest) => ({ kind: "moveEnergy" as const, picks: [{ uid: m.uid, dest }] })),
        ),
        ...prefixes(picks, prompt.min ?? 0, prompt.max).map((p) => ({
          kind: "moveEnergy" as const,
          picks: p,
        })),
      ];
    }
    case "discardEnergy":
    case "discardTools": {
      const uids = prompt.discardable.map((d) => d.uid);
      const scope = prompt.scope;
      const perHost = prompt.discardable.filter(
        (d, i) => prompt.discardable.findIndex((e) => sameRef(e.from, d.from)) === i,
      );
      const sets =
        scope.kind === "total"
          ? [uids.slice(0, scope.count), uids.slice(-scope.count)]
          : scope.kind === "each"
            ? [perHost.map((d) => d.uid)]
            : [[], ...uids.map((uid) => [uid]), ...prefixes(uids, 2, scope.max)];
      return sets.map((s) => ({ kind: prompt.kind, uids: s }));
    }
    case "chooseCards": {
      const c = prompt.candidates;
      const sets = [
        ...prefixes(c, prompt.min, prompt.max),
        ...prefixes([...c].reverse(), prompt.min, prompt.max),
        ...(prompt.min <= 1 && prompt.max >= 1 ? c.map((uid) => [uid]) : []),
      ];
      return sets.map((uids) => ({ kind: "cards", uids }));
    }
    case "attachCards": {
      const first = prompt.targets[0];
      return [
        { kind: "attachCards", assignments: [] },
        ...prompt.candidates.flatMap((uid) =>
          prompt.targets.map((to) => ({
            kind: "attachCards" as const,
            assignments: [{ uid, to }],
          })),
        ),
        ...(first === undefined
          ? []
          : [
              {
                kind: "attachCards" as const,
                assignments: prompt.candidates
                  .slice(0, prompt.max)
                  .map((uid) => ({ uid, to: first })),
              },
            ]),
      ];
    }
    case "chooseAttack":
      return prompt.candidates.map((c) => ({ kind: "attack", index: c.index }));
    case "choosePrize":
      return prompt.indices.map((index) => ({ kind: "prize", index }));
  }
}

/**
 * Every action `seat` could plausibly send in `state`: each hand card against each spot it could
 * name, each attack row, each ability, each prompt answer. The engine decides which are legal.
 */
export function candidateActions(state: GameState, seat: Seat): GameAction[] {
  const side = state.players[seat];
  const phase = state.phase;
  const out: GameAction[] = [{ type: "concede", seat }];
  side.bench.forEach((body, from) => {
    const uid = topUid(body);
    if (uid !== undefined)
      for (let index = 0; index < side.bench.length; index += 1)
        if (index !== from) out.push({ type: "reorderBench", seat, uid, index });
  });
  switch (phase.kind) {
    case "setup:chooseFirst":
      for (const first of SEATS) out.push({ type: "chooseFirstPlayer", seat, first });
      return out;
    case "setup:drawExtra":
      for (let count = 0; count <= phase.owed[seat]; count += 1)
        out.push({ type: "setupDrawExtra", seat, count });
      return out;
    case "setup:place":
      for (const uid of side.hand) {
        out.push({ type: "setupPlaceActive", seat, uid });
        out.push({ type: "setupPlaceBench", seat, uid });
      }
      out.push({ type: "setupReady", seat });
      return out;
    case "ko:takePrizes": {
      const indices = side.prizes.map((_, i) => i);
      out.push({ type: "takePrizes", seat, prizeIndices: indices.slice(0, phase.count) });
      out.push({ type: "takePrizes", seat, prizeIndices: indices.slice(-phase.count) });
      return out;
    }
    case "ko:promote":
      side.bench.forEach((_, benchIndex) => {
        out.push({ type: "promote", seat, benchIndex });
      });
      return out;
    case "effect:choose":
      for (const choice of choiceCandidates(phase.prompt))
        out.push({ type: "resolveEffect", seat, choice });
      return out;
    case "gameOver":
      return out;
    case "turn:action":
      break;
  }
  const targets = targetsOf(state, seat);
  const hand = side.hand.map((uid) => ({ uid, card: cardOfUid(state, uid) }));
  const stage2s = hand.filter((h) => h.card?.category === "Pokemon" && h.card.stage === "Stage2");
  for (const { uid, card } of hand) {
    if (card === undefined) continue;
    if (card.category === "Energy")
      for (const target of targets) out.push({ type: "attachEnergy", seat, uid, target });
    if (card.category === "Pokemon") {
      out.push({ type: "playBasicToBench", seat, uid });
      for (const target of targets) out.push({ type: "evolve", seat, uid, target });
    }
    if (card.category === "Trainer") {
      out.push({ type: "playTrainer", seat, uid });
      for (const target of targets) {
        out.push({ type: "attachTool", seat, uid, target });
        for (const s2 of stage2s)
          out.push({ type: "rareCandy", seat, uid, target, evolutionUid: s2.uid });
      }
    }
  }
  for (let index = 0; index < MAX_ATTACK_ROWS; index += 1)
    out.push({ type: "attack", seat, index });
  const active = side.active;
  if (active !== null)
    for (const discardEnergy of prefixes(active.energy, 0, active.energy.length))
      side.bench.forEach((_, promoteBenchIndex) => {
        out.push({ type: "retreat", seat, discardEnergy, promoteBenchIndex });
      });
  for (const target of targets) {
    const body = target.spot === "active" ? side.active : side.bench[target.index];
    const uid = body === null || body === undefined ? undefined : topUid(body);
    const card = uid === undefined ? undefined : cardOfUid(state, uid);
    if (card === undefined) continue;
    const names = new Set([
      ...(card.abilities ?? []).map((a) => a.name),
      ...(programFor(card.id)?.abilities ?? []).map((a) => a.name),
    ]);
    for (const abilityName of names) out.push({ type: "useAbility", seat, target, abilityName });
    out.push({ type: "discardFromPlay", seat, target });
  }
  out.push({ type: "useStadiumAbility", seat });
  out.push({ type: "endTurn", seat });
  return out;
}

/** TEST SURGERY — the same board inside the attack-again window, opened for the Active's top card. */
export function inAttackAgainWindow(state: GameState): GameState | null {
  if (state.phase.kind !== "turn:action") return null;
  const active = state.players[state.phase.seat].active;
  const uid = active === null ? undefined : topUid(active);
  if (uid === undefined) return null;
  return { ...state, allowances: { ...state.allowances, attackAgainUid: uid } };
}

export interface WalkOptions {
  /** Accepted actions before the walk stops. */
  maxSteps?: number;
  /** Accepted actions within one turn before the walk ends it whenever it can. */
  turnBudget?: number;
  /** Called on every accepted action with the state it applied to and what it produced. */
  onStep?: (before: GameState, action: GameAction, events: GameEvent[], after: GameState) => void;
}

/**
 * Play `initial` forward with a seeded rng, one accepted action at a time, calling `visit` on every
 * state reached (the initial one included). Concede and bench reorders are never chosen. Stops at
 * game over, after `maxSteps`, or when no candidate is accepted.
 */
export function walkGame(
  initial: GameState,
  seed: number,
  visit: (state: GameState) => void,
  opts: WalkOptions = {},
): GameState {
  const maxSteps = opts.maxSteps ?? 400;
  const turnBudget = opts.turnBudget ?? 12;
  let rng = seed | 0;
  let state = initial;
  let turn = state.turn;
  let inTurn = 0;
  for (let step = 0; step < maxSteps; step += 1) {
    visit(state);
    if (state.phase.kind === "gameOver") return state;
    if (state.turn !== turn) {
      turn = state.turn;
      inTurn = 0;
    }
    const pool = SEATS.flatMap((seat) => candidateActions(state, seat)).filter(
      (a) => a.type !== "concede" && a.type !== "reorderBench",
    );
    let order: GameAction[];
    [order, rng] = shuffle(pool, rng);
    let roll: number;
    [roll, rng] = randomIndex(8, rng);
    const endNow = inTurn >= turnBudget || roll === 0;
    order.sort((a, b) => Number(a.type === "endTurn") - Number(b.type === "endTurn"));
    if (endNow) order.reverse();
    let next: GameState | undefined;
    for (const action of order) {
      const result = applyAction(state, action);
      if (result.ok) {
        opts.onStep?.(state, action, result.events, result.state);
        next = result.state;
        break;
      }
    }

    if (next === undefined) return state;
    state = next;
    inTurn += 1;
  }
  visit(state);
  return state;
}
