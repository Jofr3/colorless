import { describe, expect, it } from "vitest";
import type { GameState, InPlayPokemon } from "./index";
import { clearDepartedAbilityUses } from "./stateChecks";
import { MIXED_DECK, driveSetup } from "./testFixtures";
import { coinRedoKey } from "./types";

interface Uids {
  active: string;
  tool: string;
  hand: string;
}

/** A started game with p1's Active wearing a Tool, and `used` spent this turn. */
function spent(used: (uids: Uids) => string[]): { state: GameState; uids: Uids } {
  const base = driveSetup(5, { p1: MIXED_DECK, p2: MIXED_DECK }, { first: "p1" });
  const side = base.players.p1;
  const active = side.active as InPlayPokemon;
  const tool = side.deck[0] as string;
  const uids = { active: active.stack.at(-1) as string, tool, hand: side.hand[0] as string };
  const state: GameState = {
    ...base,
    players: {
      ...base.players,
      p1: { ...side, deck: side.deck.slice(1), active: { ...active, tools: [tool] } },
    },
    allowances: { ...base.allowances, abilitiesUsed: used(uids) },
  };
  return { state, uids };
}

describe("§9.3: a once-per-turn use leaves play with its card (COR-P0E)", () => {
  it("drops the uses of a card no longer in play, and keeps in-play, Tool and by-name keys", () => {
    const { state, uids } = spent((u) => [
      `${u.active}:Probe`,
      `${u.hand}:Probe`,
      coinRedoKey(u.tool, "Backtrack Badge"),
      "*:Flip the Script",
    ]);
    const cleared = clearDepartedAbilityUses(state);
    expect(cleared.allowances.abilitiesUsed).toEqual([
      `${uids.active}:Probe`,
      coinRedoKey(uids.tool, "Backtrack Badge"),
      "*:Flip the Script",
    ]);
  });

  it("returns the state itself when every use is still held in play", () => {
    const { state } = spent((u) => [`${u.active}:Probe`, "*:Flip the Script"]);
    expect(clearDepartedAbilityUses(state)).toBe(state);
  });
});
