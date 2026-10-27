import type { Card, RedactedGame } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameState, PokemonTarget, RngState } from "./index";
import { applyAction, cardOfUid, redactGame, topUid, turnGate } from "./index";
import { CATALOG_MANIFEST } from "./catalogManifest";
import {
  ANY_SNIPE_DECK,
  AURA_NARROWING_DECK,
  BOARD_CONDITION_DECK,
  FIXTURE_POOL,
  HAIL_BLADE_DECK,
  PER_ATTACK_LOCK_DECK,
  PROMOTED_CLAUSE_DECK,
  RARE_CANDY_DECK,
  SPHERICAL_SHIELD_DECK,
  STADIUM_ABILITY_DECK,
  STADIUM_TOOL_DECK,
  candidateActions,
  deckOf,
  drbgSeed,
  mustCreate,
  trainerCard,
  inAttackAgainWindow,
  walkGame,
} from "./testFixtures";

type TurnPhase = Extract<RedactedGame["phase"], { kind: "turn:action" }>;

/** One redacted affordance, and "ok" or the engine's rejection code for the action behind it. */
interface Check {
  kind: string;
  what: string;
  flagged: boolean;
  verdict: string;
}

const spotKey = (t: PokemonTarget) => (t.spot === "active" ? "active" : `bench${t.index}`);

/** Every turn affordance the redactor computes for the actor, paired with the engine's verdict. */
function flagChecks(state: GameState): Check[] {
  if (state.phase.kind !== "turn:action") return [];
  const seat = state.phase.seat;
  const view = redactGame(state, seat);
  const p = view.phase as TurnPhase;
  const verdicts = new Map<string, string>();
  const verdict = (a: GameAction) => {
    const key = JSON.stringify(a);
    let v = verdicts.get(key);
    if (v === undefined) {
      const result = applyAction(state, a);
      v = result.ok ? "ok" : result.error.code;
      verdicts.set(key, v);
    }
    return v;
  };
  /** "ok" when any of `actions` is accepted, else the first one's rejection. */
  const anyVerdict = (actions: GameAction[]) =>
    actions.some((a) => verdict(a) === "ok")
      ? "ok"
      : actions[0] === undefined
        ? "NONE"
        : verdict(actions[0]);
  const id = (uid: string) => cardOfUid(state, uid)?.id ?? uid;
  const side = state.players[seat];
  const bodyAt = (t: PokemonTarget) => (t.spot === "active" ? side.active : side.bench[t.index]);
  const topIdAt = (t: PokemonTarget) => {
    const body = bodyAt(t);
    const uid = body ? topUid(body) : undefined;
    return uid === undefined ? "?" : id(uid);
  };
  const candidates = candidateActions(state, seat);
  const legal = candidates.filter((a) => verdict(a) === "ok");
  const out: Check[] = [];
  const check = (kind: string, what: string, flagged: boolean, v: string) =>
    out.push({ kind, what: `${kind} ${what}`, flagged, verdict: v });

  const activeId = topIdAt({ spot: "active" });
  for (const row of p.attacks)
    check(
      "attack",
      `${activeId}#${row.index}`,
      row.playable,
      verdict({ type: "attack", seat, index: row.index }),
    );
  for (const a of legal)
    if (a.type === "attack" && !p.attacks.some((r) => r.index === a.index))
      check("attack unlisted", `${activeId}#${a.index}`, false, "ok");

  check(
    "retreat",
    activeId,
    !!p.retreat?.can,
    anyVerdict(candidates.filter((a) => a.type === "retreat")),
  );

  for (const row of p.abilities)
    check(
      "ability",
      `${topIdAt(row.target)} ${row.abilityName}`,
      !row.disabled,
      verdict({ type: "useAbility", seat, target: row.target, abilityName: row.abilityName }),
    );
  for (const a of legal)
    if (
      a.type === "useAbility" &&
      !p.abilities.some(
        (r) => spotKey(r.target) === spotKey(a.target) && r.abilityName === a.abilityName,
      )
    )
      check("ability unlisted", `${topIdAt(a.target)} ${a.abilityName}`, false, "ok");

  // Rows are deduplicated per card, so every copy in hand must share its row's verdict.
  const handTrainers = side.hand.filter((uid) => cardOfUid(state, uid)?.category === "Trainer");
  for (const uid of handTrainers) {
    const row = p.trainers.find((t) => id(t.uid) === id(uid));
    const v = row?.rareCandy
      ? anyVerdict(candidates.filter((a) => a.type === "rareCandy" && a.uid === uid))
      : verdict({ type: "playTrainer", seat, uid });
    check(row ? "trainer" : "trainer unlisted", id(uid), !!row && !row.disabled, v);
  }

  // The pairings stand behind an enabled Rare Candy row; without one they offer nothing.
  const candy = p.trainers.find((t) => t.rareCandy && !t.disabled);
  if (candy !== undefined) {
    const offered = new Set<string>();
    for (const o of p.rareCandy)
      for (const s of o.stage2) {
        offered.add(`${spotKey(o.target)}:${s.uid}`);
        check(
          "rare candy",
          `${id(s.uid)} onto ${id(o.basicUid)}`,
          true,
          verdict({
            type: "rareCandy",
            seat,
            uid: candy.uid,
            target: o.target,
            evolutionUid: s.uid,
          }),
        );
      }
    for (const a of legal)
      if (a.type === "rareCandy" && !offered.has(`${spotKey(a.target)}:${a.evolutionUid}`))
        check(
          "rare candy unlisted",
          `${id(a.evolutionUid)} onto ${topIdAt(a.target)}`,
          false,
          "ok",
        );
  }

  const stadiumUid = state.stadium?.uid;
  check(
    "stadium",
    stadiumUid === undefined ? "none" : id(stadiumUid),
    !!p.stadiumAbility && !p.stadiumAbility.disabled,
    verdict({ type: "useStadiumAbility", seat }),
  );

  const mainPhase = turnGate(state, { type: "playBasicToBench", seat });
  check("main phase", "", !p.attackAgain, mainPhase === null ? "ok" : mainPhase.error.code);

  const fossils = new Set(p.discardable.map((d) => spotKey(d.target)));
  for (const a of candidates)
    if (a.type === "discardFromPlay")
      check("discard", topIdAt(a.target), fossils.has(spotKey(a.target)), verdict(a));

  for (const card of view.board.you.hand) {
    if (card.category !== "Pokemon") continue;
    const flagged = new Set(card.evolutionTargetIds ?? []);
    for (const a of candidates) {
      if (a.type !== "evolve" || a.uid !== card.id) continue;
      const body = bodyAt(a.target);
      const top = body ? topUid(body) : undefined;
      if (top !== undefined)
        check("evolve", `${card.cardId} onto ${id(top)}`, flagged.has(top), verdict(a));
    }
  }
  return out;
}

const FOSSIL_RULE =
  "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.";

function fossil(id: string, name: string): Card {
  const face = CATALOG_MANIFEST.trainerFaces[id];
  if (face === undefined) throw new Error(`no catalog face for ${id}`);
  return { ...trainerCard(id, "Item", FOSSIL_RULE), name, hp: face.hp, abilities: face.abilities };
}

const FOSSIL_POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  "sv07-129": fossil("sv07-129", "Antique Cover Fossil"),
  "sv07-130": fossil("sv07-130", "Antique Root Fossil"),
};

const FOSSIL_DECK = deckOf({
  "sv07-129": 6,
  "sv07-130": 6,
  "fix-basic-1": 16,
  "sv01-181": 4,
  "fix-energy": 28,
});

/** Decks whose walks between them reach every kind of turn affordance, offered and greyed. */
const WALKS: [string, string[], Record<string, Card>][] = [
  ["stadium tool", STADIUM_TOOL_DECK, FIXTURE_POOL],
  ["per-attack lock", PER_ATTACK_LOCK_DECK, FIXTURE_POOL],
  ["rare candy", RARE_CANDY_DECK, FIXTURE_POOL],
  ["promoted clause", PROMOTED_CLAUSE_DECK, FIXTURE_POOL],
  ["stadium ability", STADIUM_ABILITY_DECK, FIXTURE_POOL],
  ["board condition", BOARD_CONDITION_DECK, FIXTURE_POOL],
  ["any snipe", ANY_SNIPE_DECK, FIXTURE_POOL],
  ["hail blade", HAIL_BLADE_DECK, FIXTURE_POOL],
  ["spherical shield", SPHERICAL_SHIELD_DECK, FIXTURE_POOL],
  ["aura narrowing", AURA_NARROWING_DECK, FIXTURE_POOL],
  ["fossils", FOSSIL_DECK, FOSSIL_POOL],
];

const KINDS = [
  "attack",
  "retreat",
  "ability",
  "trainer",
  "stadium",
  "evolve",
  "discard",
  "main phase",
];

describe("redacted turn flags agree with the engine, inside and outside the window", () => {
  const reached = new Set<string>();

  // Each walk runs on the legacy generator and on ChaCha20, which every real game uses (MI1).
  it.each(
    WALKS.flatMap(([name, deck, pool]) => [
      [name, deck, pool, 7],
      [`${name} (ChaCha20)`, deck, pool, drbgSeed(7)],
    ]) as [string, string[], Record<string, Card>, RngState][],
  )("on every state of a seeded %s walk", (name, deck, pool, seed) => {
    const drift = new Map<string, number>();
    walkGame(mustCreate(seed, { p1: deck, p2: deck }, pool).state, 11, (state) => {
      for (const board of [state, inAttackAgainWindow(state)]) {
        if (board === null) continue;
        for (const c of flagChecks(board)) {
          reached.add(`${c.kind}:${c.flagged}`);
          if (c.flagged === (c.verdict === "ok")) continue;
          const d = `${c.what}: ${c.flagged ? `offered, refused ${c.verdict}` : "greyed, legal"}`;
          if (!drift.has(d)) drift.set(d, board.turn);
        }
      }
    });
    expect([...drift].map(([d, turn]) => `${d} (${name} turn ${turn})`)).toEqual([]);
  });

  it("and the walks reach every kind of affordance, offered and greyed", () => {
    for (const kind of KINDS)
      for (const flagged of [true, false]) expect(reached).toContain(`${kind}:${flagged}`);
    expect(reached).toContain("rare candy:true");
  });
});
