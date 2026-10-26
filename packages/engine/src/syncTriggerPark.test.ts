import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effectTypes";
import { runSyncProgram } from "./interpreter";
import { OP_TRAITS } from "./ops/traits";
import type { TriggeredAbility } from "./programTypes";
import { programFor, registryCardIds } from "./registry";
import { driveSetup, walkProgram } from "./testFixtures";
import { runsSynchronously } from "./triggers";

// A program on a sync-routed timing runs through `runSyncProgram`, which throws on a park. This
// audit keeps every authored row on such a timing free of any op that could park.

/** Every op in `program`, gates and riders included, that can leave the run parked. */
function parkingOps(program: readonly EffectOp[]): string[] {
  return walkProgram(program)
    .filter((op) => OP_TRAITS[op.op].parks !== false)
    .map((op) => op.op);
}

function triggeredRows(): { where: string; ability: TriggeredAbility }[] {
  return registryCardIds().flatMap((id) =>
    (programFor(id)?.triggered ?? []).map((ability) => ({
      where: `${id} ${ability.name} (${ability.trigger})`,
      ability,
    })),
  );
}

describe("sync-routed triggers never park", () => {
  it("no authored program on a sync-routed timing contains an op that can park", () => {
    const sync = triggeredRows().filter(({ ability }) => runsSynchronously(ability));
    expect(sync.length).toBeGreaterThan(0);
    const offenders = sync
      .map(({ where, ability }) => ({ where, ops: parkingOps(ability.program) }))
      .filter(({ ops }) => ops.length > 0);
    expect(offenders).toEqual([]);
  });

  it("the same predicate does flag parking programs on the other timings", () => {
    const parked = triggeredRows().filter(
      ({ ability }) => !runsSynchronously(ability) && parkingOps(ability.program).length > 0,
    );
    expect(parked.length).toBeGreaterThan(0);
  });

  it("counts a coin flip as parking and looks inside every gate and rider", () => {
    const flip: EffectOp = { op: "coinFlipGate", ops: [{ op: "drawCards", count: 1 }] };
    expect(parkingOps([flip])).toEqual(["coinFlipGate"]);
    expect(
      parkingOps([
        {
          op: "conditionGate",
          cond: { kind: "yourBenchAtLeast", count: 1 },
          ops: [{ op: "drawCards", count: 1 }],
          otherwise: [{ op: "recordGate", slot: "moved", ops: [flip] }],
        },
      ]),
    ).toEqual(["coinFlipGate"]);
    expect(
      parkingOps([{ op: "optional", note: "You may.", ops: [{ op: "drawCards", count: 1 }] }]),
    ).toEqual(["optional"]);
    expect(parkingOps([{ op: "recoverOneStatus" }])).toEqual(["recoverOneStatus"]);
    expect(parkingOps([{ op: "drawCards", count: 1 }, { op: "shuffleDeck" }])).toEqual([]);
  });

  it("routes by timing and by watch direction", () => {
    const row = (
      trigger: TriggeredAbility["trigger"],
      opponentAction?: true,
    ): TriggeredAbility => ({
      name: "Row",
      trigger,
      program: [],
      ...(opponentAction === undefined ? {} : { opponentAction }),
    });
    expect(runsSynchronously(row("betweenTurns"))).toBe(true);
    expect(runsSynchronously(row("onEnergyAttach"))).toBe(true);
    expect(runsSynchronously(row("onActiveMovedToBench"))).toBe(true);
    expect(runsSynchronously(row("onEvolve", true))).toBe(true);
    expect(runsSynchronously(row("onEvolve"))).toBe(false);
    expect(runsSynchronously(row("onPlayToBench"))).toBe(false);
    expect(runsSynchronously(row("onKnockOut"))).toBe(false);
  });
});

describe("runSyncProgram", () => {
  it("returns the finished state of a program that does not park", () => {
    const state = driveSetup(5);
    const before = state.players.p1.hand.length;
    const after = runSyncProgram(state, [{ op: "drawCards", count: 1 }], { seat: "p1" }, []);
    expect(after.players.p1.hand).toHaveLength(before + 1);
  });

  it("throws instead of dropping a park", () => {
    const state = driveSetup(5);
    const program: EffectOp[] = [
      { op: "optional", note: "You may draw a card.", ops: [{ op: "drawCards", count: 1 }] },
    ];
    expect(() => runSyncProgram(state, program, { seat: "p1" }, [])).toThrow(/parked on optional/);
  });
});
