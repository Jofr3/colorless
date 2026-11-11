import { describe, expect, it } from "vitest";
import { passiveLockReport, passiveReaders } from "./passive-lock-guard";

const source = (text: string) => ({ path: "continuous.ts", text });

const LOCKED = `
export function seatAura(state: GameState, uid: string): number {
  if (disabledAbilityUids(state).has(uid)) return 0;
  return programFor(uid)?.passive?.seatAura?.amount ?? 0;
}`;
const TOOL = `
export function toolDiscount(state: GameState, body: InPlayPokemon): number {
  let n = 0;
  for (const uid of toolsInEffect(state, body)) n += programFor(uid)?.passive?.discount ?? 0;
  return n;
}`;
const UNLOCKED = `
export function bare(state: GameState, uid: string): number {
  return programFor(uid)?.passive?.seatAura?.amount ?? 0;
}`;
const FOLD = `
function foldAura(out: Totals, passive: PassiveEffects): void {
  out.aura += passive.seatAura ?? 0;
}`;

describe("passive-lock-guard", () => {
  it("names each reader's passive keys and whether it calls a lock filter", () => {
    expect(passiveReaders(source(LOCKED + TOOL + UNLOCKED + FOLD))).toEqual([
      { name: "seatAura", keys: ["seatAura"], filtered: true },
      { name: "toolDiscount", keys: ["discount"], filtered: true },
      { name: "bare", keys: ["seatAura"], filtered: false },
      { name: "foldAura", keys: ["seatAura"], filtered: false },
    ]);
  });

  it("passes filtered readers and named exceptions", () => {
    const report = passiveLockReport([source(LOCKED + TOOL + FOLD)], {
      "continuous.ts foldAura": "its caller filters",
    });
    expect(report).toEqual({ ok: true, lines: ["3 passive readers, 1 unfiltered by name"] });
  });

  it("fails a reader with no filter and no named reason", () => {
    const report = passiveLockReport([source(UNLOCKED)], {});
    expect(report.ok).toBe(false);
    expect(report.lines).toContain(
      "  continuous.ts bare reads passive seatAura with no lock filter",
    );
  });

  it("fails a named exception that now filters or reads nothing", () => {
    const report = passiveLockReport([source(LOCKED)], {
      "continuous.ts seatAura": "stale",
      "continuous.ts gone": "deleted",
    });
    expect(report.ok).toBe(false);
    expect(report.lines).toContain(
      "  continuous.ts seatAura: filters now, so drop it from UNFILTERED",
    );
    expect(report.lines).toContain("  continuous.ts gone: in UNFILTERED but reads no passive key");
  });
});
