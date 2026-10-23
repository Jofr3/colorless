import type { PokemonRef } from "@colorless/engine";
import type { RedactedEffectPrompt } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { LuaSimulator, SimMenu } from "./simulator";
import { effectMenu } from "./simulatorChoices";

const you = (spot: "active" | number) =>
  ({
    seat: "p1",
    spot: spot === "active" ? { spot: "active" } : { spot: "bench", index: spot },
  }) as PokemonRef;
const view = {
  seat: "p1",
  board: {
    you: { active: { id: "a", name: "Pikachu" }, bench: [{ id: "b", name: "Eevee" }] },
    opponent: { active: { id: "o", name: "Snorlax" }, bench: [] },
  },
};

function open(prompt: RedactedEffectPrompt) {
  const sim = {
    menu: null as SimMenu | null,
    view: () => view,
    source: { effectContext: () => ({ placingCounters: false }) },
    action: (label: string, action: unknown, colour: string) => ({
      label,
      colour,
      action,
      run: () => {},
    }),
    emit: () => {},
  };
  sim.menu = effectMenu(sim as unknown as LuaSimulator, prompt);
  return sim;
}
const choiceOf = (option: unknown) => (option as { action: { choice: unknown } }).action.choice;

describe("effect menus", () => {
  it("cycles each attached card through the targets and back to staying put", () => {
    const sim = open({
      kind: "attachCards",
      candidates: [{ id: "x", name: "Grass" }] as never,
      targets: [you("active"), you(0)],
      max: 1,
      note: "",
    });
    const labels = [sim.menu?.options[0]?.label];
    for (let i = 0; i < 3; i++) {
      sim.menu?.options[0]?.run();
      labels.push(sim.menu?.options[0]?.label);
    }
    expect(labels).toEqual([
      "Grass: stays",
      "Grass: You: Pikachu",
      "Grass: You: Eevee",
      "Grass: stays",
    ]);
  });

  it("wraps the amount picker and sends it with the chosen Pokémon", () => {
    const sim = open({ kind: "choosePokemon", candidates: [you(0)], upTo: 2, note: "" });
    expect(sim.menu?.footer?.[0]?.label).toBe("Amount: 2");
    sim.menu?.footer?.[0]?.run();
    expect(sim.menu?.footer?.[0]?.label).toBe("Amount: 1");
    expect(choiceOf(sim.menu?.options[0])).toEqual({ kind: "pokemon", ref: you(0), take: 1 });
  });

  it("confirms with the selected target", () => {
    const sim = open({ kind: "confirm", note: "Heal?", targets: [you("active"), you(0)] });
    sim.menu?.options[1]?.run();
    expect(sim.menu?.options.map((o) => o.selected)).toEqual([false, true]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({ kind: "confirm", yes: true, target: you(0) });
  });
});
