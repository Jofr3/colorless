// @vitest-environment jsdom
// 🆕🆕🆕 D566 — THE WIRE HALF OF THE TWO NEW `chooseCards` SHAPES, AT THE ONLINE CLIENT.
//
// ⑴ `capsAnyOf` (Brock's Scouting's "up to 2 Basic Pokémon OR 1 Evolution Pokémon"). zod STRIPS a
// key its object schema does not name, so without `packages/schema`'s new optional key the online
// client would receive the prompt WITHOUT its disjunction and afford a mixed answer the engine
// refuses — invisibly: the parse succeeds either way. The rung parses a prompt carrying it and
// asserts the key SURVIVED, which is the only assertion that can see the strip.
// ⑵ `dest: "swap"` (Ogre's Mask's second question). A value the enum did not name would FAIL the
// parse and drop the frame; the verb record renders "Switch in" (a TOTAL record — D542).
//
// Hand-built wire snapshots, like every sibling online suite: the online client only ever holds a
// `RedactedGame`. The shapes are the ones `trainerBundleD566.test.ts` asserts the engine parks.

import type { RedactedGame } from "@luminous/schema";
import { redactedEffectPromptSchema } from "@luminous/schema";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const EMPTY_SIDE: RedactedGame["board"]["you"] = {
  hand: [],
  active: null,
  bench: [],
  prizesRemaining: 6,
  faceUpPrizes: [],
  deckCount: 53,
  discard: [],
};

function card(id: string, name: string) {
  return { id, cardId: id, name, category: "Pokemon" as const, trainerType: null, hasImage: false };
}

type Prompt = Extract<
  NonNullable<Extract<RedactedGame["phase"], { kind: "effect:choose" }>["prompt"]>,
  { kind: "chooseCards" }
>;

function gameWith(prompt: Prompt): RedactedGame {
  return {
    seat: "p1",
    turn: 3,
    phase: { kind: "effect:choose", prompt },
    board: { stadium: null, you: EMPTY_SIDE, opponent: EMPTY_SIDE },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

const SCOUTING: Prompt = {
  kind: "chooseCards",
  candidates: [card("b1", "Basic One"), card("b2", "Basic Two"), card("e1", "Evolution One")],
  min: 0,
  max: 2,
  dest: "hand",
  capsAnyOf: [
    { uids: ["b1", "b2"], max: 2 },
    { uids: ["e1"], max: 1 },
  ],
  note: "Search your deck for up to 2 Basic Pokémon or 1 Evolution Pokémon into your hand.",
};

const MASK: Prompt = {
  kind: "chooseCards",
  candidates: [card("o1", "Teal Mask Ogerpon ex"), card("o2", "Hearthflame Mask Ogerpon ex")],
  min: 1,
  max: 1,
  dest: "swap",
  note: 'Switch in which card from your discard pile (a Pokémon ex that has "Ogerpon" in its name)?',
};

describe("🛑 the D566 chooseCards wire shapes survive the schema", () => {
  it("🛑 `capsAnyOf` is KEPT by the parse (zod strips an unnamed key; the parse would still succeed)", () => {
    const parsed = redactedEffectPromptSchema.parse(SCOUTING);
    expect(parsed).toEqual(SCOUTING);
    if (parsed.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parsed.capsAnyOf).toEqual(SCOUTING.capsAnyOf);
  });

  it("`dest: \"swap\"` parses, and an unknown dest still does not", () => {
    expect(redactedEffectPromptSchema.parse(MASK)).toEqual(MASK);
    expect(redactedEffectPromptSchema.safeParse({ ...MASK, dest: "teleport" }).success).toBe(false);
  });

  it("the online dialog renders the swap pick with the \"Switch in\" verb under the engine's heading", () => {
    render(<OnlineHud game={gameWith(MASK)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    expect(screen.getByText(MASK.note)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Switch in 0\/1/ })).toBeTruthy();
  });
});
