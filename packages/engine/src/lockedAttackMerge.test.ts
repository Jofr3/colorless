import { describe, expect, it } from "vitest";
import { lockedAttackIndexes } from "./continuous";
import { applyAction, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  OPPONENT_ATTACK_LOCK_DECK,
  PER_ATTACK_LOCK_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.110.0 → 0.111.0 — REVIEW FIX (D165): `InPlayPokemon.lockedAttack` has ONE
// READER and TWO WRITERS, and neither merged.
//
// Not a card slice. `/code-review` ran at D164 over `git diff origin/backend...HEAD`
// (11 commits, D154–D164) and returned exactly ONE finding — this one — and it is a
// CORRECTNESS bug on a played line, which is the first the reviewer has returned on
// this branch (D136 and D153 both returned none).
//
// ⚠️ THE DEFECT, IN ONE SENTENCE. `preventAttackUse` (D154, self-side) stamps
// `state.turn + 2` and `lockDefenderAttack` (D157, opponent-side) stamps
// `state.turn + 1`. From ADJACENT turns those are the SAME turn — and both wrote the
// one `lockedAttack` slot with a bare overwrite, guarded only by an early return on
// "same turn AND same index". So an opponent-installed bar DELETED a live
// self-installed one, and the §8 gate then let a player use the very attack their own
// card bars, on the very turn it bars it, with the `ATTACK_LOCKED` row promising
// otherwise still standing in the log.
//
// ⚠️ AND THE IRONY IS THE MOST TRANSFERABLE THING ABOUT IT. D157 shared the field on
// the ground that `lockedAttackIndex` is its ONLY READER — which was true, is still
// true, and is not the question. It never asked how many WRITERS it has.
// `types.ts`'s `LockedAttack` block refuses a DIFFERENT merge (with D148's
// `attackLockedTurn`) on exactly this ground — *"they are REACHABLE TOGETHER and mean
// different things … one record could hold only the later write"* — so the repo had
// already written down the argument that condemned its own field, one column to the
// left. **The test is not "do these two records mean the same thing" but "how many
// writers does this slot have, and can any two of them stamp the same turn".**
//
// ⚠️ THE SHAPE: A LIST, NOT A SECOND FIELD. `InPlayPokemon.lockedAttacks:
// LockedAttack[]`, `MATCH_RECORD_VERSION` 10 → 11, one shared merge rule
// (`addLockedAttack`, interpreter.ts) and one plural reader (`lockedAttackIndexes`,
// continuous.ts). A second stamped field fixes today's collision and pushes the same
// defect out by exactly one writer, on a bound nothing proves — see the argument at
// `types.ts InPlayPokemon.lockedAttacks`, and D150's rule about assumed bounds.
//
// ⚠️ AND IT IS THE ENUMERATING CALLER §D152/§D154/§D157 EACH FORECAST AND DECLINED,
// arriving from the direction none of them watched: not a UNION the read site must
// dispatch on, but a MULTIPLICITY it must enumerate. With two bars live,
// `redactedAttacksOf` and `GameHud` must grey EVERY barred row and neither knows in
// advance which. The `attackBlock` union stays declined — nothing here dispatches,
// because every entry in this list means one thing.
//
// SEED-FREE: no printing this file touches carries a coin.

const SEED = 13;

/** Skarmory sv03-142's two indices — the body that carries both bars. */
const SLASHING_STEEL = 1;
const PECK = 0;

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

function render(
  events: GameEvent[],
  state: GameState,
  names: Record<Seat, string> = { p1: "Ember", p2: "Tide" },
): { who: string; text: string }[] {
  const ctx: LogContext = { names, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The error code a declaration comes back with, or `null` when it applies. */
function refusal(state: GameState, seat: Seat, index: number): string | null {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
}

/** TEST SURGERY: write the list straight onto a seat's Active, for the cases the
    prune rule reaches and no line of play does (an entry stamped for a turn
    already played). Said so rather than skipped, per the family's standing rule. */
function setLocks(state: GameState, seat: Seat, locks: InPlayPokemon["lockedAttacks"]): GameState {
  const side = state.players[seat];
  const active = must0(side.active);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, lockedAttacks: locks } } },
  };
}

/** THE COLLISION BOARD, PLAYED END TO END — the permanent regression pin.
 *
 * P2 opens and passes, so P1's turn 2 carries no §4 restriction.
 *   turn 2 (P1) — Skarmory sv03-142 declares "Slashing Steel" (index 1). Its own
 *                 printed drawback stamps `2 + 2 = 4`, the holder's own next turn;
 *   turn 3 (P2) — Oranguru sv02-094 declares "Plotter's Command" and CHOOSES the
 *                 same Skarmory's "Peck" (index 0). That stamps `3 + 1 = 4`, the
 *                 victim's next turn. SAME BODY, SAME TURN, DIFFERENT INDEX;
 *   turn 4 (P1) — both bars are live and both must bite.
 *
 * ⚠️ THE TWO DECKS ARE THE TWO SUITES', ONE PER SEAT, AND THAT IS DELIBERATE. The
 * collision needs a self-side barrer facing an opponent-side one, and each deck holds
 * exactly its own slice's cast. Mixing them at the seats costs no new 60 and moves no
 * seeded board in either predecessor (`driveSetup` deals each seat off its own list).
 *
 * ⚠️ AND P2's ACTIVE IS SWAPPED BETWEEN THE TWO DECLARATIONS RATHER THAN STANDING
 * THROUGH BOTH, because "Slashing Steel" deals a printed 120 and Oranguru has exactly
 * 120 HP: an Oranguru that stood there on turn 2 would be Knocked Out and the board
 * would end in `ko:takePrizes` before the second install. fix-titan (340 HP, no
 * attacks) takes the hit, and the promotion is a surgery so that no Prize, no
 * promotion prompt and no §14 speculation sits between the two writes the case is
 * about. */
function collision(names?: Record<Seat, string>): {
  state: GameState;
  log: { who: string; text: string }[];
} {
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: PER_ATTACK_LOCK_DECK, p2: OPPONENT_ATTACK_LOCK_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "sv03-142");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-metal-energy", 2);
  state = attachFromDeck(state, "p1", "fix-energy", 1);

  const self = mustApply(state, { type: "attack", seat: "p1", index: SLASHING_STEEL });
  let p2 = setActiveFromDeck(self.state, "p2", "sv02-094");
  p2 = attachFromDeck(p2, "p2", "fix-psychic-energy", 1);
  p2 = attachFromDeck(p2, "p2", "fix-energy", 1);
  const parked = mustApply(p2, { type: "attack", seat: "p2", index: 0 });
  if (parked.state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${parked.state.phase.kind}`);
  }
  const imposed = mustApply(parked.state, {
    type: "resolveEffect",
    seat: "p2",
    choice: { kind: "attack", index: PECK },
  });
  return {
    state: imposed.state,
    log: [
      ...render(self.events, self.state, names),
      ...render(parked.events, parked.state, names),
      ...render(imposed.events, imposed.state, names),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT: the played board, and what it used to do.
// ─────────────────────────────────────────────────────────────────────────────

describe("two writers, one body, one turn — the board /code-review found", () => {
  it("keeps BOTH bars and refuses BOTH indices", () => {
    const { state } = collision();
    expect(state.turn).toBe(4);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(must0(state.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: SLASHING_STEEL },
      { turn: 4, attackIndex: PECK },
    ]);
    // ⚠️ THE SECOND OF THESE IS THE BUG. Before D165 the opponent's write deleted
    // the self-installed record, `lockedAttackIndexes` answered [0] alone, and
    // "Slashing Steel" was legal on the very turn Skarmory's own card bars it.
    expect(refusal(state, "p1", PECK)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p1", SLASHING_STEEL)).toBe("ATTACK_PREVENTED");
    expect(lockedAttackIndexes(state, must0(state.players.p1.active))).toEqual([
      SLASHING_STEEL,
      PECK,
    ]);
  });

  it("…and the board is not simply dead — the CONTROL that keeps the case honest", () => {
    // The same board with the list emptied offers BOTH declarations, so neither
    // refusal above can be passing because Skarmory could not attack anyway (the
    // energy is attached, the §4 first-turn ban is long past, and nothing else on
    // this body is locked).
    const { state } = collision();
    const free = setLocks(state, "p1", []);
    expect(refusal(free, "p1", PECK)).toBeNull();
    expect(refusal(free, "p1", SLASHING_STEEL)).toBeNull();
  });

  it("the two bars EXPIRE together and by arithmetic, with nothing clearing them", () => {
    // Both entries are stamped 4, so turn 6 answers nothing — and the records are
    // still on the body, which is this family's expiry rule (`attackLocked`'s)
    // unchanged by the list.
    const { state } = collision();
    let later = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(6);
    expect(must0(later.players.p1.active).lockedAttacks).toHaveLength(2);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([]);
  });

  it("the SELF bar survives an opponent's bar naming the SAME index — idempotently", () => {
    // The other half of the merge on the same played board: had P2 chosen index 1
    // rather than 0, the two writes name the same pair and the second must add
    // nothing at all — one entry, one live bar, and no second ATTACK_LOCKED row
    // telling the victim about a bar they already had.
    let state = must(
      applyAction(
        driveSetup(
          SEED,
          { p1: PER_ATTACK_LOCK_DECK, p2: OPPONENT_ATTACK_LOCK_DECK },
          { first: "p2" },
        ),
        { type: "endTurn", seat: "p2" },
      ),
    );
    state = setActiveFromDeck(state, "p1", "sv03-142");
    state = setActiveFromDeck(state, "p2", "fix-titan");
    state = attachFromDeck(state, "p1", "fix-metal-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const self = mustApply(state, { type: "attack", seat: "p1", index: SLASHING_STEEL });
    let p2 = setActiveFromDeck(self.state, "p2", "sv02-094");
    p2 = attachFromDeck(p2, "p2", "fix-psychic-energy", 1);
    p2 = attachFromDeck(p2, "p2", "fix-energy", 1);
    const parked = mustApply(p2, { type: "attack", seat: "p2", index: 0 });
    const same = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "attack", index: SLASHING_STEEL },
    });
    expect(must0(same.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: SLASHING_STEEL },
    ]);
    expect(types(same.events)).not.toContain("ATTACK_LOCKED");
    // …and "Peck" is legal, which is the whole difference from D148's lock and is
    // the assertion a merge rule that silently kept both spellings would pass.
    expect(refusal(same.state, "p1", PECK)).toBeNull();
    expect(refusal(same.state, "p1", SLASHING_STEEL)).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE MERGE RULE: three rules, one function, one place a mutation reaches it.
// ─────────────────────────────────────────────────────────────────────────────

describe("addLockedAttack — the ONE merge rule both writers share", () => {
  it("PRUNES entries whose turn is already behind, so the list cannot grow", () => {
    // The garbage rule, and it is NOT the expiry rule: expiry is the reader's turn
    // comparison (pinned above), which is what makes a bar stop biting. This keeps
    // a body that never leaves the Active Spot from accumulating one dead entry per
    // bar over a long match. Driven with a surgery because a played board cannot
    // stack more than the two bars a turn can install.
    const { state } = collision();
    const stale = setLocks(state, "p1", [
      { turn: 2, attackIndex: PECK },
      { turn: 3, attackIndex: SLASHING_STEEL },
      { turn: 4, attackIndex: SLASHING_STEEL },
    ]);
    // P1 declares nothing here — the prune happens on the next WRITE, which is
    // P2's opponent-side bar on the turn after this one.
    // P2's Oranguru is still Active with its energy attached from the board above.
    const passed = must(applyAction(stale, { type: "endTurn", seat: "p1" }));
    expect(passed.turn).toBe(5);
    const parked = mustApply(passed, { type: "attack", seat: "p2", index: 0 });
    const written = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "attack", index: PECK },
    });
    // Turn 5 was the writing turn, so `{ turn: 4 }` and everything older is gone
    // and the new `{ turn: 6 }` entry stands alone.
    expect(must0(written.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 6, attackIndex: PECK },
    ]);
  });

  it("keeps an entry stamped for a turn NOT YET REACHED — pruning is by the past only", () => {
    // The sharp edge of the prune: a bar stamped for a LATER turn is a bar the
    // body has not reached, and dropping it would be D165's own deletion moved one
    // turn out. The self-side stamp is `+ 2` and the opponent-side one `+ 1`, so
    // this is the ordinary shape of the pair rather than a constructed one — it is
    // what P1's own turn-4 declaration would produce beside a live turn-4 bar.
    const { state } = collision();
    const mixed = setLocks(state, "p1", [
      { turn: 4, attackIndex: PECK },
      { turn: 6, attackIndex: SLASHING_STEEL },
    ]);
    // The turn-4 bar bites now and the turn-6 one does not…
    expect(lockedAttackIndexes(mixed, must0(mixed.players.p1.active))).toEqual([PECK]);
    // …and two turns on they have swapped, with nothing having written anything.
    let later = must(applyAction(mixed, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(6);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([SLASHING_STEEL]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // D166 — THE PRUNE'S OWN BOUNDARY. `lock.turn >= now`, and the `>=` is the
  // whole of this pair of cases.
  //
  // ⚠️ WHY THEY EXIST. D165's mutation pass was INTERRUPTED here and the slice was
  // committed with the boundary unwitnessed. Re-running that pass at D166 found
  // FIVE survivors, not the two the handoff recorded, and every one of them is the
  // SAME off-by-one written five ways: `>= now` → `> now`; `>= now` → `>= now + 1`;
  // `>= now` → `>= turn` (prune against the NEW stamp); and each writer passing
  // `turn` rather than `state.turn` as `now`. All five DELETE A BAR THAT IS STILL
  // BITING — which is D165's own defect relocated out of the merge rule and into
  // the garbage rule, and is why the boundary is witnessed rather than argued away.
  //
  // ⚠️ THE TWO WRITERS DO NOT REACH IT ALIKE, AND THE ARGUMENT IS PARITY. Both
  // stamp the HOLDER's own next turn (`+ 2` from the holder's turn, `+ 1` from the
  // opponent's), so every entry on a body carries that seat's turn parity.
  // `preventAttackUse` writes on its OWN Active during its own turn, so
  // `lock.turn === now` is REACHABLE and is driven below as a played line.
  // `lockDefenderAttack` writes on the OPPONENT's Active during the actor's turn,
  // so `now` is never one of the victim's turns and the equal case is UNREACHABLE
  // by parity — driven by SURGERY, said rather than skipped, exactly as the prune
  // case above is.
  // ───────────────────────────────────────────────────────────────────────────

  it("keeps an entry that is LIVE ON THE TURN OF THE WRITE — a PLAYED line, self-side", () => {
    // The board differs from `collision()` in one step: P1 installs NOTHING on turn
    // 2, so the only bar is the one P2 imposes on turn 3 for turn 4. On turn 4 P1
    // then declares the attack that is still legal — "Slashing Steel" — whose own
    // printed drawback writes `4 + 2 = 6` while the imposed `{ turn: 4 }` entry is
    // LIVE. The two prune cases above both write on a turn where every existing
    // entry is strictly PAST or strictly FUTURE, so neither can see the equal case.
    //
    // THE KO IS DELIBERATE: "Slashing Steel" deals exactly Oranguru's 120, so the
    // board stops at `ko:takePrizes` with `state.turn` STILL 4 and the READER can be
    // asked on the writing turn. Let the turn roll to 5 instead and the entry is
    // dead by arithmetic, and only the record's shape would be observable.
    let state = must(
      applyAction(
        driveSetup(
          SEED,
          { p1: PER_ATTACK_LOCK_DECK, p2: OPPONENT_ATTACK_LOCK_DECK },
          { first: "p2" },
        ),
        { type: "endTurn", seat: "p2" },
      ),
    );
    state = setActiveFromDeck(state, "p1", "sv03-142");
    state = setActiveFromDeck(state, "p2", "sv02-094");
    state = attachFromDeck(state, "p1", "fix-metal-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-psychic-energy", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    // turn 2 (P1) — installs nothing at all.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    // turn 3 (P2) — "Plotter's Command" parks, and P2 picks "Peck": `3 + 1 = 4`.
    const parked = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const imposed = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "attack", index: PECK },
    });
    // turn 4 (P1) — ONE bar, live, and it is not the index P1 is about to use.
    expect(imposed.state.turn).toBe(4);
    expect(must0(imposed.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: PECK },
    ]);
    expect(lockedAttackIndexes(imposed.state, must0(imposed.state.players.p1.active))).toEqual([
      PECK,
    ]);
    const after = mustApply(imposed.state, { type: "attack", seat: "p1", index: SLASHING_STEEL });
    expect(after.state.turn).toBe(4);
    expect(after.state.phase.kind).toBe("ko:takePrizes");
    // The write KEPT the live entry and appended its own…
    expect(must0(after.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: PECK },
      { turn: 6, attackIndex: SLASHING_STEEL },
    ]);
    // …and the READER still answers it on the very turn the write landed, which is
    // the fact every one of the five prune mutants throws away.
    expect(lockedAttackIndexes(after.state, must0(after.state.players.p1.active))).toEqual([PECK]);
  });

  it("…and the OPPONENT-SIDE writer keeps it too — CONSTRUCTED, because parity bars the played line", () => {
    // `lockDefenderAttack` writes on the victim's body during the ACTOR's turn, so
    // `lock.turn === now` would need an entry on P1's body stamped for one of P2's
    // turns — which neither writer can produce (both stamp the holder's own next
    // turn). The surgery says so rather than leaving the writer's half of the
    // boundary unwitnessed, and it is the same allowance `setLocks`' doc block
    // makes for the prune case above.
    //
    // It is not decoration: `addLockedAttack` is ONE function with ONE contract, and
    // this is the case that fails if a future writer — or a stamp rule that stops
    // alternating — breaks the parity the paragraph above leans on.
    const { state } = collision();
    const surgery = setLocks(state, "p1", [{ turn: 5, attackIndex: PECK }]);
    const passed = must(applyAction(surgery, { type: "endTurn", seat: "p1" }));
    expect(passed.turn).toBe(5);
    // P2's Oranguru is still Active with its energy attached from `collision()`.
    const parked = mustApply(passed, { type: "attack", seat: "p2", index: 0 });
    const written = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "attack", index: SLASHING_STEEL },
    });
    // `now` is 5 and the entry is stamped 5, so it stays; the new bar is `5 + 1`.
    expect(must0(written.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 5, attackIndex: PECK },
      { turn: 6, attackIndex: SLASHING_STEEL },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOTH PAYABILITY PROJECTIONS, under TWO live bars.
// ─────────────────────────────────────────────────────────────────────────────

describe("the projections mark EVERY barred index — the enumerating caller", () => {
  it("`redactedAttacksOf` greys both rows, and agrees with the §8 gate on both", () => {
    // ⚠️ THIS IS THE PROJECTION HALF OF THE DEFECT AND IT IS THE HALF A PLAYER
    // SEES. Before D165 the panel offered "Slashing Steel" — a live button the
    // server rejects with ATTACK_PREVENTED — on a board where the player's own card
    // says it should not be there. `redactedAttacksOf` reads the set once, outside
    // its map, and asks MEMBERSHIP per row: it does not know which indices are
    // barred until it is handed the set, which is exactly the enumeration D154 and
    // D157 each said would earn a collection.
    const { state } = collision();
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[PECK]?.name).toBe("Peck");
    expect(view.attacks[PECK]?.playable).toBe(false);
    expect(view.attacks[SLASHING_STEEL]?.name).toBe("Slashing Steel");
    expect(view.attacks[SLASHING_STEEL]?.playable).toBe(false);
    // …and the CONTROL: the same board with the list emptied offers both rows, so
    // "both false" cannot be passing because the panel was unpayable anyway.
    const free = redactGame(setLocks(state, "p1", []), "p1").phase;
    if (free.kind !== "turn:action") throw new Error("expected turn:action");
    for (const attack of free.attacks) expect(attack.playable, attack.name).toBe(true);
  });

  it("the OPPONENT's view still carries nothing — two bars leak no more than one", () => {
    // `redactedAttacksOf` returns [] for anyone but the turn owner. Re-asserted on
    // the two-bar board because the projection now publishes a fact assembled from
    // TWO installs by TWO seats, and the seat that imposed one of them must not be
    // able to read the other off the wire.
    const { state } = collision();
    const view = redactGame(state, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE: two rows, rendered under both seats and READ.
// ─────────────────────────────────────────────────────────────────────────────

describe("the log does not lie when two bars are live", () => {
  it("prints one row per install, each NAMING its own attack, both under the BARRED seat", () => {
    // ⚠️ THE ROW WAS ALREADY RIGHT AND THE ENGINE WAS WRONG, WHICH IS THE UNUSUAL
    // SHAPE OF THIS FIX. D154 made `ATTACK_LOCKED` name the attack because "can't
    // attack next turn" is FALSE on a body whose other attack is legal; D162 found
    // the inverse on a one-attack body. Here BOTH rows were already honest and the
    // FIELD threw one of the facts away — so before D165 the log promised a bar the
    // engine had deleted, which is the worst available failure: a player reading
    // their own log was told the truth by the row and lied to by the state.
    //
    // NO NEW ARM IS OWED, and that is checked rather than assumed: the two rows are
    // installed on two different TURNS, so no row ever has to say "and also".
    //
    // ⚠️ AND THIS IS THE CELL D157 NAMED AS UNVERIFIED, NOW FILLED. `seat` owns the
    // BARRED Pokémon (D136's finding 1), so the first row is the actor's own body
    // (p1 installing on p1) and the second is the VICTIM's (p2 installing on p1) —
    // two paths whose relation between actor and seat DIFFERS, rendered side by
    // side on ONE body for the first time. Both file under p1 and both are true.
    const { log } = collision();
    expect(log).toEqual([
      { who: "p1", text: "Skarmory used Slashing Steel" },
      { who: "p1", text: "dealt 120 damage to fix-titan" },
      { who: "p1", text: "Skarmory can't use Slashing Steel next turn" },
      { who: "p1", text: "ended their turn" },
      { who: "p2", text: "drew a card" },
      { who: "p2", text: "Oranguru used Plotter's Command" },
      { who: "p2", text: "dealt 30 damage to Skarmory" },
      { who: "p1", text: "Skarmory can't use Peck next turn" },
      { who: "p2", text: "ended their turn" },
      { who: "p1", text: "drew a card" },
    ]);
  });

  it("…and BOTH rows read identically with the seat NAMES swapped", () => {
    // The wording carries no player name — "next turn" means the NAMED player's own
    // next turn under this family's seat rule, and the named player is whoever the
    // row files under — so swapping the display names must move nothing at all.
    // Driven rather than argued, because this family has got the mirrored render
    // wrong once already (D148's bare wording is false under the other seat) and
    // because two bars from two seats is the shape most likely to tempt a wording
    // that names the installer.
    const straight = collision().log;
    const swapped = collision({ p1: "Tide", p2: "Ember" }).log;
    expect(swapped).toEqual(straight);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10: the clears shed the WHOLE list, with two bars live.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 sheds every entry, never one of them", () => {
  it("EVOLVING inside the shared window frees BOTH attacks — a played line", () => {
    // The window is the holder's own turn, so this is a line a player takes. And
    // the failure it rules out is sharper with a list than with a record: a clear
    // written as a FILTER (drop the entries this body installed, keep the imposed
    // ones) would leave the evolved card carrying an index off the card it came
    // from. The evolved body has ONE attack, so a surviving index 1 would point at
    // nothing at all.
    const { state } = collision();
    const held = handFromDeck(state, "p1", "fix-skarm-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-skarm-stage1"),
      target: { spot: "active" },
    });
    expect(must0(evolved.players.p1.active).lockedAttacks).toEqual([]);
    // …and the evolved body attacks on the same turn, which is §10's rule and not
    // a leniency.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("RETREATING inside the shared window sheds both — the holder's own route", () => {
    // The agency is MIXED on this board and that is the point: one bar is the
    // holder's own drawback and one was imposed by the opponent, and §10 sheds them
    // together. A clear that kept the imposed one would invert the counterplay a
    // retreat is supposed to buy.
    const { state } = collision();
    const active = must0(state.players.p1.active);
    const { state: retreated } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      // Skarmory's printed retreat is 1.
      discardEnergy: active.energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    expect(retreated.players.p1.bench.at(-1)?.lockedAttacks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The SWEEP this fix owes: the OTHER durated address record.
// ─────────────────────────────────────────────────────────────────────────────

describe("the writer sweep — what else could have this shape", () => {
  it("`boostedAttack` is SINGLE-WRITER, which is why it is not a list too", () => {
    // ⚠️ D153's LESSON RE-RUN: a review's account can be UNDERSTATED (it named one
    // wrong path and there were three). So the sweep was made rather than assumed,
    // and its result is the opposite: the finding is EXACT.
    //
    // `lockedAttack` has TWO writers — `preventAttackUse` (D154) and
    // `lockDefenderAttack` (D157). `boostedAttack` has ONE, `boostAttack` (D155),
    // and the pool prints its sentence on exactly one card. Its own "different
    // index replaces" rule is therefore unreachable as a deletion today, because
    // one body installs at most one buff per turn and a re-install always stamps a
    // later turn — the very argument that was TRUE of `preventAttackUse` about
    // itself and FALSE about its field.
    //
    // ⚠️ THE TRAP IS WRITTEN DOWN RATHER THAN BUILT AGAINST. The day a SECOND
    // writer of `boostedAttack` lands — an opponent-side buff, or any op stamping
    // `+ 1` where this one stamps `+ 2` — it inherits this exact defect, and the
    // fix is this file's. What is asserted here is the PREMISE that keeps it
    // single-writer, so the day it stops holding this case goes red.
    //
    // The assertion is structural: `boostAttack` is the only op that writes the
    // field, and `preventChosenAttack`/`preventAttackUse` never touch it. Driven
    // off the collision board, where BOTH lock writers have run.
    const { state } = collision();
    expect(must0(state.players.p1.active).boostedAttack).toBeNull();
    expect(must0(state.players.p2.active).boostedAttack).toBeNull();
    // …and the list did move on the same body, so this is not passing because
    // nothing ran.
    expect(must0(state.players.p1.active).lockedAttacks).toHaveLength(2);
  });

  it("D148's `attackLockedTurn` is untouched — a different field, one writer, no address", () => {
    // The third record in the neighbourhood, and the one `LockedAttack`'s doc block
    // has always refused to merge with. It carries no index, so it has nothing to
    // collide ON: two whole-Pokémon locks stamping one turn are the same fact, and
    // `Math.max`/overwrite is the whole of its merge. Asserted on the two-bar board
    // so a future reader can see the three fields separated at once.
    const { state } = collision();
    expect(must0(state.players.p1.active).attackLockedTurn).toBeNull();
    expect(must0(state.players.p1.active).lockedAttacks).toHaveLength(2);
  });
});
