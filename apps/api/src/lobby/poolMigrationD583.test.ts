import {
  applyAction,
  formatElapsed,
  type GameAction,
  type GameState,
  logFromEvents,
  redactGame,
} from "@colorless/engine";
import { type Card, tcgdexCardSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import cardTrainerFossil from "../../../../packages/schema/src/tcgdex/__fixtures__/card-trainer-fossil-sv07-129.json";
import cardTrainerTm from "../../../../packages/schema/src/tcgdex/__fixtures__/card-trainer-tm-sv08-188.json";
import { type CardRow, mapCardRow } from "../catalog/map";
import { mapCard } from "../ingest/map";
import {
  loadMatchRecord,
  MATCH_RECORD_VERSION,
  type MatchRecord,
  type MatchSlot,
  MIGRATABLE_MATCH_RECORD_VERSION,
  migratablePoolIdsOf,
  migrateMatchRecord,
  readMatchRecord,
  startMatch,
} from "./match";

function catalogFace(payload: unknown): Card {
  return mapCardRow(mapCard(tcgdexCardSchema.parse(payload)) as CardRow);
}

const TM = "sv08-188";
const FOSSIL = "sv07-129";
const BODY = "d583-body";

const FRESH_TM = catalogFace(cardTrainerTm);
const FRESH_FOSSIL = catalogFace(cardTrainerFossil);
const STALE_TM: Card = { ...FRESH_TM, hp: null, abilities: null, attacks: null };
const STALE_FOSSIL: Card = { ...FRESH_FOSSIL, hp: null, abilities: null, attacks: null };

const BODY_CARD: Card = {
  ...FRESH_TM,
  id: BODY,
  setId: "test",
  localId: "1",
  name: "D583 Body",
  category: "Pokemon",
  hp: 900,
  stage: "Basic",
  types: ["Colorless"],
  retreat: 1,
  abilities: null,
  attacks: [{ cost: [], name: "Tap", damage: "10" }],
  trainerType: null,
  effect: null,
};

const DECK = [...Array.from({ length: 56 }, () => BODY), TM, TM, FOSSIL, FOSSIL];
const NAMES = { p1: "Ana", p2: "Bo" } as const;

function v41Record(seed = 5830): MatchRecord {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [TM]: STALE_TM, [FOSSIL]: STALE_FOSSIL, [BODY]: BODY_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  const log = logFromEvents(created.events, {
    names: NAMES,
    state: created.state,
    elapsed: formatElapsed(0),
  });
  return { version: 41, seed, startedAt: 1_000, names: NAMES, state: created.state, log };
}

function must(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

/** Setup through the real action API, then p1's first main phase with a TM attached to its Active. */
function tmOnActive(start: GameState): GameState {
  let state = start;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" });
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] });
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === BODY);
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(state, { type: "setupPlaceActive", seat: s, uid });
  }
  for (const s of ["p1", "p2"] as const) state = must(state, { type: "setupReady", seat: s });
  state = must(state, { type: "endTurn", seat: "p2" });
  const side = state.players.p1;
  const zone = (["hand", "deck", "prizes"] as const).find((z) =>
    side[z].some((u) => state.cardIdByUid[u] === TM),
  );
  if (zone === undefined) throw new Error("p1 has no TM");
  const tm = side[zone].find((u) => state.cardIdByUid[u] === TM) as string;
  const filler = side.deck.find((u) => u !== tm) as string;
  state = {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        hand: [...side.hand.filter((u) => u !== tm), tm],
        deck: side.deck.filter((u) => u !== tm && (zone !== "prizes" || u !== filler)),
        prizes: zone === "prizes" ? side.prizes.map((u) => (u === tm ? filler : u)) : side.prizes,
      },
    },
  };
  return must(state, { type: "attachTool", seat: "p1", uid: tm, target: { spot: "active" } });
}

function attackNames(state: GameState): string[] {
  const view = redactGame(state, "p1");
  if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
  return view.phase.attacks.map((a) => a.name);
}

describe("D583 — the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 42 ( 43 since D621; 44 since D630; 45 since D636; 46 since D637; 47 since D640; 48 since D643; 49 since D646) and the one migratable version is 41 ( D621 (D539): the one POOL-refreshed version; v42 is migrated with no D1 read, sideStateMigrationD621.test.ts; D630: v43 too, recordKeysMigrationD630.test.ts; D636: v44 too, lockKeysMigrationD636.test.ts; D637: v45 too, fossilsMigrationD637.test.ts; D640: v46 too, prizeStageMigrationD640.test.ts; D646: v47 and v48 too, toolTrimMigrationD643.test.ts and coinRedoMigrationD646.test.ts)", () => {
    expect(MATCH_RECORD_VERSION).toBe(49);
    expect(MIGRATABLE_MATCH_RECORD_VERSION).toBe(41);
  });

  it("a v41 record is NOT read as-is: readMatchRecord refuses it, the migration takes it", () => {
    const old = v41Record();
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)?.sort()).toEqual([BODY, FOSSIL, TM].sort());
    const migrated = migrateMatchRecord(old, {
      [TM]: FRESH_TM,
      [FOSSIL]: FRESH_FOSSIL,
      [BODY]: BODY_CARD,
    });
    expect(migrated?.version).toBe(49);
    expect(readMatchRecord(migrated)).not.toBeNull();
  });

  it("every other version is neither read nor migrated (v40, v42, v43, none) ( D621 (D539): v40, v44 and none; v42 IS migrated now, v43 is this build's own) ( D630 (D539): v40, v45 and none; v43 IS migrated now, v44 is this build's own) ( D636 (D539): v40, v46 and none; v44 IS migrated now, v45 is this build's own) ( D637 (D539): v40, v47 and none; v45 IS migrated now, v46 is this build's own) ( D640 (D539): v40, v48 and none; v46 IS migrated now, v47 is this build's own) ( D646 (D539): v40, v50 and none; v47 and v48 ARE migrated now, v49 is this build's own)", () => {
    const old = v41Record();
    for (const version of [40, 50]) {
      expect(readMatchRecord({ ...old, version })).toBeNull();
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, {})).toBeNull();
    }
    expect(migratablePoolIdsOf({ ...old, version: 42 })).toEqual([]);
    expect(migrateMatchRecord({ ...old, version: 42 }, {})?.version).toBe(49);
    expect(migratablePoolIdsOf({ ...old, version: 43 })).toEqual([]);
    expect(readMatchRecord({ ...old, version: 43 })).toBeNull();
    expect(migratablePoolIdsOf({ ...old, version: 44 })).toEqual([]);
    expect(readMatchRecord({ ...old, version: 44 })).toBeNull();
    expect(migratablePoolIdsOf({ ...old, version: 45 })).toEqual([]);
    expect(readMatchRecord({ ...old, version: 45 })).toBeNull();
    expect(migratablePoolIdsOf({ ...old, version: 46 })).toEqual([]);
    expect(readMatchRecord({ ...old, version: 46 })).toBeNull();
    expect(migratablePoolIdsOf({ ...old, version: 47 })).toEqual([]);
    expect(readMatchRecord({ ...old, version: 47 })).toBeNull();
    expect(migratablePoolIdsOf({ ...old, version: 48 })).toEqual([]);
    expect(readMatchRecord({ ...old, version: 48 })).toBeNull();
    expect(readMatchRecord({ ...old, version: 49 })).not.toBeNull();
    const { version: _version, ...unversioned } = old;
    expect(migratablePoolIdsOf(unversioned)).toBeNull();
    for (const raw of [null, undefined, 41, "x"]) expect(migratablePoolIdsOf(raw)).toBeNull();
  });

  it("a v41 record failing readMatchRecord's own shape checks is not migrated", () => {
    const old = v41Record();
    expect(migrateMatchRecord({ ...old, log: undefined }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, names: { p1: "Ana" } }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, state: { ...old.state, cardPool: null } }, {})).toBeNull();
  });
});

describe("D583 — what the migration writes", () => {
  it("replaces each stale Trainer face with its D1 row, and nothing else", () => {
    const old = v41Record();
    const otherBody: Card = { ...BODY_CARD, hp: 10 };
    const migrated = migrateMatchRecord(old, {
      [TM]: FRESH_TM,
      [FOSSIL]: FRESH_FOSSIL,
      [BODY]: otherBody,
    });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.state.cardPool[TM]).toEqual(FRESH_TM);
    expect(migrated.state.cardPool[FOSSIL]).toEqual(FRESH_FOSSIL);
    // A Pokémon face is kept as persisted, whatever D1 holds now.
    expect(migrated.state.cardPool[BODY]).toBe(old.state.cardPool[BODY]);
    // Every other byte of the record is the v41 one.
    const { cardPool: _a, ...restNew } = migrated.state;
    const { cardPool: _b, ...restOld } = old.state;
    expect(restNew).toEqual(restOld);
    expect([migrated.seed, migrated.startedAt, migrated.names, migrated.log]).toEqual([
      old.seed,
      old.startedAt,
      old.names,
      old.log,
    ]);
  });

  it("keeps the persisted face when D1 has no row, or a row of another category", () => {
    const old = v41Record();
    const migrated = migrateMatchRecord(old, {
      [FOSSIL]: { ...FRESH_FOSSIL, category: "Pokemon" },
    });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.state.cardPool[TM]).toBe(old.state.cardPool[TM]);
    expect(migrated.state.cardPool[FOSSIL]).toBe(old.state.cardPool[FOSSIL]);
  });

  it("does not touch the record it was given", () => {
    const old = v41Record();
    const before = JSON.stringify(old);
    migrateMatchRecord(old, { [TM]: FRESH_TM });
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("D583 — on a board: the v41 record's TM grants its attack after the load", () => {
  it("the stale pool offers no Fluorite; the migrated one offers it after the printed Tap", () => {
    const old = v41Record();
    expect(old.state.cardPool[TM]?.attacks).toBeNull();
    expect(attackNames(tmOnActive(old.state))).toEqual(["Tap"]);
    const migrated = migrateMatchRecord(old, {
      [TM]: FRESH_TM,
      [FOSSIL]: FRESH_FOSSIL,
      [BODY]: BODY_CARD,
    });
    if (migrated === null) throw new Error("not migrated");
    expect(attackNames(tmOnActive(migrated.state))).toEqual(["Tap", "Fluorite"]);
  });
});

// ── THE DO's READ: `loadMatchRecord` (lobbyDO.ts `peekMatch` is this call), over a fake slot ──

/** A storage slot holding `value`, recording every write. */
function fakeSlot(value: unknown) {
  const slot = { value, puts: [] as MatchRecord[] };
  const api: MatchSlot = {
    get: async () => slot.value,
    put: async (record) => {
      slot.puts.push(record);
      slot.value = record;
    },
  };
  return { slot, api };
}

const FRESH_POOL = { [TM]: FRESH_TM, [FOSSIL]: FRESH_FOSSIL, [BODY]: BODY_CARD };

describe("D583 — the DO's read migrates a v41 record, writes it back, and re-reads after the D1 load", () => {
  it("a v41 record: D1 is asked for its pool ids, the v42 ( v43 since D621; v44 since D630; v45 since D636; v46 since D637; v47 since D640; v48 since D643; v49 since D646) record is written once, and its TM grants Fluorite", async () => {
    const { slot, api } = fakeSlot(v41Record());
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return FRESH_POOL;
    });
    expect(asked).toEqual([[BODY, FOSSIL, TM].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(MATCH_RECORD_VERSION);
    expect(slot.puts).toEqual([load.record]);
    expect(attackNames(tmOnActive(load.record.state))).toEqual(["Tap", "Fluorite"]);
    const again = await loadMatchRecord(api, async () => {
      throw new Error("D1 asked twice");
    });
    expect(again.kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });

  it("a v42 ( D621: v43 — the migrated record; D630: v44; D636: v45; D637: v46; D640: v47; D643: v48; D646: v49) record is read as-is; a v40 record is stale; an empty slot is none — D1 never asked, nothing written", async () => {
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const v41 = v41Record();
    const v42 = migrateMatchRecord(v41, FRESH_POOL);
    for (const [value, kind] of [
      [v42, "ok"],
      [{ ...v41, version: 40 }, "stale"],
      [undefined, "none"],
    ] as const) {
      const { slot, api } = fakeSlot(value);
      expect((await loadMatchRecord(api, never)).kind).toBe(kind);
      expect(slot.puts).toEqual([]);
    }
  });

  it("another event migrated or advanced the match during the D1 load: that record wins, nothing is written", async () => {
    const v41 = v41Record();
    const theirs = migrateMatchRecord(v41, { [TM]: FRESH_TM });
    if (theirs === null) throw new Error("not migrated");
    const { slot, api } = fakeSlot(v41);
    const load = await loadMatchRecord(api, async () => {
      slot.value = theirs;
      return FRESH_POOL;
    });
    expect(load).toEqual({ kind: "ok", record: theirs });
    expect(slot.puts).toEqual([]);
  });

  it("the match ended during the D1 load: none, nothing is written", async () => {
    const { slot, api } = fakeSlot(v41Record());
    const load = await loadMatchRecord(api, async () => {
      slot.value = undefined;
      return FRESH_POOL;
    });
    expect(load).toEqual({ kind: "none" });
    expect(slot.puts).toEqual([]);
  });

  it("a failed D1 load rejects and leaves the v41 record untouched for the next read", async () => {
    const v41 = v41Record();
    const { slot, api } = fakeSlot(v41);
    await expect(
      loadMatchRecord(api, async () => {
        throw new Error("D1 down");
      }),
    ).rejects.toThrow("D1 down");
    expect(slot.puts).toEqual([]);
    expect(slot.value).toBe(v41);
  });
});
