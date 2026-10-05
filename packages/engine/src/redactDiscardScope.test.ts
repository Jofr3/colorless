import { redactedDiscardScopeSchema, redactedEffectPromptSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { DiscardScope, EffectContinuation, EffectPrompt } from "./interpreter";
import { engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import { redactGame } from "./redact";
import { MIXED_DECK, driveSetup } from "./testFixtures";

// 🆕🆕🆕 D543 PART 0 — THE `upTo` DISCARD SCOPE, WHICH THE WIRE NEVER HAD.
//
// 🛑 **NO RUNG AT HEAD CROSSED AN `upTo` SCOPE THROUGH THE REDACTOR, AND THAT IS
// EXACTLY WHY THE DEFECT SHIPPED.** `redact.test.ts` pins one discard prompt and
// one scope — `{ kind: "total", count: 1 }` — which is a case that never broke.
// `redactedScopeOf` was a two-arm TERNARY: `total` got its own branch and
// EVERYTHING ELSE returned `{ kind: "each" }`. So D359's `upTo` — the one
// DECLINABLE discard scope, shipped in the engine since D359 and produced live by
// Chien-Pao ex "Hail Blade" and Mewtwo VSTAR "Psy Purge" — crossed the wire as a
// MANDATORY one-per-Pokémon pick. The remote dialog then demanded an exact answer
// to a declinable question, and the server refused whatever it sent.
//
// 🛑 **THE `satisfies DiscardScope` ON THAT TERNARY WAS THE CAMOUFLAGE, AND THE
// GENERALISATION IS THE POINT OF THIS FILE.** It typed the two-arm expression's
// OUTPUT against the ENGINE union. A `satisfies` on a RESULT can say only *"this
// value inhabits that type"*: it cannot say *"every input was considered"* (that is
// a `never` floor) and it cannot say *"this is the WIRE shape"* (that is the
// annotated return type). Both mandatory members are structurally legal
// `RedactedDiscardScope`s, so the assertion was GREEN on a value that had already
// lost the information the wire needed. **A `satisfies` against the SOURCE union is
// not an exhaustiveness check.**
//
// 🛑 **AND THE WIRE HALF IS THE HALF NO ENGINE ASSERTION CAN SEE.** Even a correct
// redactor could not have sent an `upTo`, because `redactedDiscardScopeSchema` had
// two of the engine's three members. Every rung below that calls `safeParse` is
// driving the SCHEMA, not the engine — the seam `packages/engine` cannot reach on
// its own.

const CONT: EffectContinuation = {
  pendingOp: { op: "opponentMayDraw", count: 1 },
  rest: [],
  ctx: { seat: "p1" },
};

function baseState(): GameState {
  return driveSetup(20260923, { p1: MIXED_DECK, p2: MIXED_DECK });
}

function withPrompt(prompt: EffectPrompt): GameState {
  return { ...baseState(), phase: { kind: "effect:choose", seat: "p1", prompt, cont: CONT } };
}

function promptFor(prompt: EffectPrompt, seat: Seat) {
  const phase = redactGame(withPrompt(prompt), seat).phase;
  if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  return phase.prompt;
}

const P1_ACTIVE = { seat: "p1", spot: { spot: "active" } } as const;
const P2_ACTIVE = { seat: "p2", spot: { spot: "active" } } as const;
const P2_BENCH0 = { seat: "p2", spot: { spot: "bench", index: 0 } } as const;

/** All THREE engine members, named once. The `satisfies` here is doing the job the
    one in `redactedScopeOf` could not: it is on a LIST of inputs, so a fourth
    `DiscardScope` member leaves this array short and every rung below under-drives
    — which is why §1 also asserts the length against a literal. */
const EVERY_SCOPE = [
  { kind: "total", count: 2 },
  { kind: "each" },
  { kind: "upTo", max: 3 },
] as const satisfies readonly DiscardScope[];

const energyPrompt = (scope: DiscardScope): EffectPrompt => ({
  kind: "discardEnergy",
  discardable: [
    { uid: "e1", from: P2_ACTIVE },
    { uid: "e2", from: P2_BENCH0 },
  ],
  scope,
  note: "Discard Energy.",
});

const toolPrompt = (scope: DiscardScope): EffectPrompt => ({
  kind: "discardTools",
  discardable: [
    { uid: "t1", from: P2_ACTIVE },
    { uid: "t2", from: P2_BENCH0 },
  ],
  scope,
  note: "Discard up to 2 Pokémon Tools from your opponent's Pokémon.",
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 — EVERY MEMBER CROSSES, AND THE MEMBER COUNT IS PINNED ON BOTH SIDES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the scope union crosses whole, in both prompts", () => {
  it("🛑 the ENGINE union has THREE members and the WIRE union now has three too", () => {
    // Pinned on BOTH sides rather than on one: a wire member with no engine twin is
    // a shape nothing can produce, and an engine member with no wire twin is what
    // this slice found. The wire count is read off the schema LIVE.
    expect(EVERY_SCOPE).toHaveLength(3);
    const wireKinds = redactedDiscardScopeSchema.options.map((o) => o.shape.kind.value);
    expect([...wireKinds].sort()).toEqual([...EVERY_SCOPE.map((s) => s.kind)].sort());
  });

  it("🛑 EVERY scope round-trips through the redactor UNCHANGED — the table", () => {
    // The whole table, both prompt kinds. The `upTo` row is the one that was red
    // before Part 0 and the `each` row is the one that would go red if the fix had
    // over-corrected — neither is a spot check.
    for (const scope of EVERY_SCOPE) {
      for (const make of [energyPrompt, toolPrompt]) {
        const prompt = make(scope);
        expect(promptFor(prompt, "p1"), `${prompt.kind}/${scope.kind}`).toEqual(prompt);
      }
    }
  });

  it("🛑 THE SCHEMA ACCEPTS the `upTo` wire value — the half no engine rung can see", () => {
    const sent = promptFor(toolPrompt({ kind: "upTo", max: 3 }), "p1");
    const parsed = redactedEffectPromptSchema.safeParse(sent);
    expect(parsed.success).toBe(true);
    // …and the scope schema on its own, so a failure names the member rather than
    // the prompt around it.
    expect(redactedDiscardScopeSchema.safeParse({ kind: "upTo", max: 3 }).success).toBe(true);
    // The CEILING is spelled `max` and not `count`: a shared spelling would let a
    // client read "discard exactly N" off a prompt that means "0 up to N".
    expect(redactedDiscardScopeSchema.safeParse({ kind: "upTo", count: 3 }).success).toBe(false);
    expect(redactedDiscardScopeSchema.safeParse({ kind: "upTo" }).success).toBe(false);
  });

  it("🛑 THE COLLAPSE IS VISIBLE: an `upTo` prompt does NOT cross as `each`", () => {
    // The mutant `D543-wire-scope-collapses-upto` restores the ternary. This is the
    // assertion that dies, stated as the NEGATIVE it actually is — `toEqual` on the
    // whole prompt would also pass if `max` merely drifted.
    const sent = promptFor(toolPrompt({ kind: "upTo", max: 3 }), "p1");
    if (sent === null || sent.kind !== "discardTools") throw new Error("expected the prompt");
    expect(sent.scope.kind).toBe("upTo");
    expect(sent.scope).toEqual({ kind: "upTo", max: 3 });
    const energy = promptFor(energyPrompt({ kind: "upTo", max: 1 }), "p1");
    if (energy === null || energy.kind !== "discardEnergy") throw new Error("expected the prompt");
    expect(energy.scope.kind).toBe("upTo");
    expect(energy.scope).toEqual({ kind: "upTo", max: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE NO-ALIAS PURITY CONTRACT, on the NEW member.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the redactor's no-alias purity contract reaches the new member", () => {
  it("🛑 the wire scope is a FRESH object, never the engine prompt's own", () => {
    // Every branch of `redactPrompt` copies by value so no wire frame holds a
    // reference into live game state. A `switch` arm that returned `scope` itself
    // would satisfy every `toEqual` above and break this one alone.
    const scope: DiscardScope = { kind: "upTo", max: 2 };
    const prompt = toolPrompt(scope);
    const sent = promptFor(prompt, "p1");
    if (sent === null || sent.kind !== "discardTools") throw new Error("expected the prompt");
    expect(sent.scope).toEqual(scope);
    expect(sent.scope).not.toBe(scope);
    // …and the same for the two mandatory members, so the contract is a property of
    // the function and not of one arm.
    for (const s of EVERY_SCOPE) {
      const out = promptFor(energyPrompt(s), "p1");
      if (out === null || out.kind !== "discardEnergy") throw new Error("expected the prompt");
      expect(out.scope, s.kind).not.toBe(s);
    }
  });

  it("the offers are fresh too — array, entries and each entry's `from` ref", () => {
    const prompt = toolPrompt({ kind: "upTo", max: 2 });
    if (prompt.kind !== "discardTools") throw new Error("unreachable");
    const sent = promptFor(prompt, "p1");
    if (sent === null || sent.kind !== "discardTools") throw new Error("expected the prompt");
    expect(sent.discardable).not.toBe(prompt.discardable);
    expect(sent.discardable[0]).not.toBe(prompt.discardable[0]);
    expect(sent.discardable[0]?.from).not.toBe(prompt.discardable[0]?.from);
    expect(sent.discardable[0]?.from).toEqual(P2_ACTIVE);
  });

  it("MUTATING the wire scope leaves the engine prompt untouched", () => {
    // The consequence the identity rungs above exist for, driven rather than
    // inferred: a client that edits what it was sent cannot reach game state.
    const scope: DiscardScope = { kind: "upTo", max: 2 };
    const prompt = toolPrompt(scope);
    const sent = promptFor(prompt, "p1");
    if (sent === null || sent.kind !== "discardTools") throw new Error("expected the prompt");
    (sent.scope as { max: number }).max = 99;
    expect(scope).toEqual({ kind: "upTo", max: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ANSWERER GATE, and the version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the gate the new prompt rides, and the version", () => {
  it("both discard prompts are CONTROLLER-answered — the opponent gets null", () => {
    for (const make of [energyPrompt, toolPrompt]) {
      expect(promptFor(make({ kind: "upTo", max: 2 }), "p2"), make.name).toBeNull();
      expect(promptFor(make({ kind: "upTo", max: 2 }), "p1"), make.name).not.toBeNull();
    }
    // …and an OWN-SIDE offer crosses too: a discard prompt may legitimately name the
    // controller's own body (a §8 self-discard cost), so the `seat` on a ref is
    // ABSOLUTE and is not rewritten by the redactor.
    const ownSide: EffectPrompt = {
      kind: "discardEnergy",
      discardable: [{ uid: "e1", from: P1_ACTIVE }],
      scope: { kind: "upTo", max: 1 },
      note: "Discard any amount of Energy from this Pokémon.",
    };
    const own = promptFor(ownSide, "p1");
    if (own === null || own.kind !== "discardEnergy") throw new Error("expected the prompt");
    expect(own.discardable[0]?.from).toEqual(P1_ACTIVE);
  });

  it("engineVersion", () => {
    expect(engineVersion).toBe("0.464.0");
  });
});
