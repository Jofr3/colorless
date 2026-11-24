import type { PokemonRef } from "@colorless/engine";
import type { RedactedEffectPrompt } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { effectMenu, type MenuHost, UPDATE_NOTE, UPDATE_TITLE } from "./simulatorChoices";
import type { SimMenu } from "./simulatorTypes";

const you = (spot: "active" | number) =>
  ({
    seat: "p1",
    spot: spot === "active" ? { spot: "active" } : { spot: "bench", index: spot },
  }) as PokemonRef;
const view = {
  seat: "p1",
  board: {
    you: {
      active: {
        id: "a",
        name: "Pikachu",
        attached: { energies: [{ id: "e1", name: "Grass" }], tools: [] },
      },
      bench: [
        { id: "b", name: "Eevee", attached: { energies: [{ id: "e2", name: "Fire" }], tools: [] } },
      ],
    },
    opponent: { active: { id: "o", name: "Snorlax" }, bench: [] },
  },
};

function open(
  prompt: RedactedEffectPrompt,
  source: { invokedBy?: string; abilityName?: string } = {},
) {
  const sim = {
    menu: null as SimMenu | null,
    sent: [] as unknown[],
    staged: [] as unknown[],
    stageAttach: (staged: unknown) => sim.staged.push(staged),
    view: () => ({ ...view, phase: { kind: "effect:choose", prompt, ...source } }),
    action: (label: string, action: { choice: unknown }, colour: string) => ({
      label,
      colour,
      action,
      run: () => sim.sent.push(action.choice),
    }),
    emit: () => {},
  };
  sim.menu = effectMenu(sim as unknown as MenuHost, prompt);
  return sim;
}
const choiceOf = (option: unknown) => (option as { action: { choice: unknown } }).action.choice;
const energy = (id: string, cardId: string) =>
  ({ id, cardId, name: cardId, category: "Energy" }) as never;
const labels = (sim: ReturnType<typeof open>) => sim.menu?.footer?.map((o) => o.label);

describe("effect menus", () => {
  it("falls back to the cycling tray when a movable Energy is not on the board", () => {
    const sim = open({
      kind: "moveEnergy",
      movable: [
        { uid: "e1", from: you("active") },
        { uid: "gone", from: you("active") },
      ],
      destinations: [you("active"), you(0)],
      max: 1,
      note: "",
    } as never);
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

  it("attaches by dropping offered cards, within the prompt's limits, and sends the full attach", () => {
    const sim = open({
      kind: "attachCards",
      candidates: [
        { id: "x", name: "Grass", category: "Energy" },
        { id: "y", name: "Fire", category: "Energy" },
        { id: "z", name: "Water", category: "Energy" },
      ] as never,
      targets: [you("active"), you(0)],
      max: 2,
      maxPerTarget: 1,
      note: "",
    });
    expect(sim.menu?.kind).toBe("attach");
    expect(sim.menu?.options.map((o) => o.uid)).toEqual(["a", "b"]);
    expect(sim.menu?.attach?.cards.map((c) => c.id)).toEqual(["x", "y", "z"]);
    expect(sim.menu?.footer?.map((o) => o.label)).toEqual(["Skip"]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({ kind: "attachCards", assignments: [] });
    expect(sim.menu?.attach?.assign("x", "o")).toMatch(/can take it/);
    expect(sim.menu?.attach?.assign("x", "a")).toBe("");
    expect(sim.menu?.footer?.map((o) => o.label)).toEqual(["Done"]);
    expect([...(sim.menu?.attach?.assigned ?? [])]).toEqual([["x", "a"]]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({
      kind: "attachCards",
      assignments: [{ uid: "x", to: you("active") }],
    });
    expect(sim.menu?.attach?.assign("y", "a")).toMatch(/each Pokémon/);
    expect(sim.sent).toEqual([]);
    expect(sim.menu?.attach?.assign("y", "b")).toBe("");
    expect(sim.sent).toEqual([
      {
        kind: "attachCards",
        assignments: [
          { uid: "x", to: you("active") },
          { uid: "y", to: you(0) },
        ],
      },
    ]);
  });

  it("answers Crispin's two-type split by which Energy is dropped, with no buttons", () => {
    const sim = open({
      kind: "confirm",
      note: "Which Energy do you want to attach?",
      labels: { yes: "Attach Fire Energy", no: "Attach Psychic Energy" },
      cards: {
        yes: { id: "f", name: "Fire Energy", category: "Energy" },
        no: { id: "p", name: "Psychic Energy", category: "Energy" },
      } as never,
      targets: [you("active"), you(0)],
    });
    expect(sim.menu?.kind).toBe("attach");
    expect(sim.menu?.footer).toEqual([]);
    sim.menu?.attach?.assign("p", "b");
    expect(sim.sent).toEqual([{ kind: "confirm", yes: false, target: you(0) }]);
  });

  it("lets a one-type Crispin keep its Energy in hand, or attach it on the drop", () => {
    const sim = open({
      kind: "confirm",
      note: "Which Energy do you want to attach?",
      labels: { yes: "Attach Fire Energy", no: "Keep it in your hand" },
      cards: { yes: { id: "f", name: "Fire Energy", category: "Energy" } } as never,
      targets: [you("active")],
    });
    expect(sim.menu?.footer?.map((o) => o.label)).toEqual(["Keep it in your hand"]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({ kind: "confirm", yes: false });
    sim.menu?.attach?.assign("f", "a");
    expect(sim.sent).toEqual([{ kind: "confirm", yes: true, target: you("active") }]);
  });

  it("wraps the amount picker and sends it with the chosen Pokémon", () => {
    const sim = open({ kind: "choosePokemon", candidates: [you(0)], upTo: 2, note: "" });
    expect(sim.menu?.footer?.[0]?.label).toBe("Amount: 2");
    sim.menu?.footer?.[0]?.run();
    expect(sim.menu?.footer?.[0]?.label).toBe("Amount: 1");
    expect(choiceOf(sim.menu?.options[0])).toEqual({ kind: "pokemon", ref: you(0), take: 1 });
  });

  it("places damage counters with one click per target only when the prompt says counters", () => {
    const snipe: RedactedEffectPrompt = {
      kind: "choosePokemonMulti",
      candidates: [you(0)],
      min: 1,
      max: 1,
      declinable: false,
      note: "",
    };
    const counters = open({ ...snipe, unit: "counters" });
    expect(counters.menu?.title).toBe("Place damage counters");
    expect(counters.menu?.hideTargetOutline).toBe(true);
    expect(choiceOf(counters.menu?.options[0])).toEqual({ kind: "pokemonMulti", refs: [you(0)] });
    const damage = open(snipe);
    expect(damage.menu?.title).toBe("Choose Pokémon (0/1)");
    expect(damage.menu?.hideTargetOutline).toBe(false);
  });

  it("asks about an Ability by the name the effect phase carries", () => {
    const prompt = { kind: "confirm", note: "Draw?" } as const;
    expect(open(prompt, { invokedBy: "ability", abilityName: "Drive Off" }).menu?.title).toBe(
      "Do you want to use Drive Off?",
    );
    expect(open(prompt, { invokedBy: "ability" }).menu?.title).toBe(
      "Do you want to use this Ability?",
    );
    expect(open(prompt, { invokedBy: "item" }).menu?.title).toBe("Draw?");
  });

  it("confirms with the selected target", () => {
    const sim = open({ kind: "confirm", note: "Heal?", targets: [you("active"), you(0)] });
    sim.menu?.options[1]?.run();
    expect(sim.menu?.options.map((o) => o.selected)).toEqual([false, true]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({ kind: "confirm", yes: true, target: you(0) });
  });

  it("shows a prompt kind this page does not know as a reload note, without throwing", () => {
    const prompt = { kind: "chooseFutureThing", note: "Pick one" } as unknown;
    const sim = open(prompt as RedactedEffectPrompt);
    expect(sim.menu).toMatchObject({
      title: UPDATE_TITLE,
      note: UPDATE_NOTE,
      options: [],
      mandatory: true,
    });
  });

  it("offers no Skip on a mandatory attach, and Done once a card is dropped", () => {
    const sim = open({
      kind: "attachCards",
      candidates: [energy("x", "w"), energy("y", "w")],
      targets: [you("active"), you(0)],
      max: 1,
      mandatory: true,
      note: "",
    });
    expect(labels(sim)).toEqual([]);
    expect(sim.menu?.attach?.assign("x", "a")).toBe("");
    expect(sim.sent).toEqual([
      { kind: "attachCards", assignments: [{ uid: "x", to: you("active") }] },
    ]);
  });

  it("answers an Energy attach's target by the drop, showing one card per print", () => {
    const sim = open({
      kind: "choosePokemon",
      candidates: [you("active"), you(0)],
      attachPile: [energy("w1", "water"), energy("w2", "water"), energy("f1", "fire")],
      note: "",
    });
    expect(sim.menu?.kind).toBe("attach");
    expect(sim.menu?.note).toBe("");
    expect(sim.menu?.attach?.cards.map((c) => c.id)).toEqual(["w1", "f1"]);
    expect(labels(sim)).toBeUndefined();
    expect(sim.menu?.attach?.assign("f1", "o")).toMatch(/can take it/);
    expect(sim.menu?.attach?.assign("f1", "b")).toBe("");
    expect(sim.sent).toEqual([{ kind: "pokemon", ref: you(0) }]);
    expect(sim.staged).toEqual([{ cards: [energy("f1", "fire")], targetUid: "b" }]);
  });

  it("takes as many as are dropped on one Pokémon, up to the ceiling, or skips", () => {
    const sim = open({
      kind: "choosePokemon",
      candidates: [you("active"), you(0)],
      upTo: 2,
      attachPile: [energy("w1", "water"), energy("w2", "water"), energy("w3", "water")],
      note: "",
    });
    expect(sim.menu?.attach?.cards.map((c) => c.id)).toEqual(["w1", "w2"]);
    expect(labels(sim)).toEqual(["Skip"]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({ kind: "pokemon" });
    expect(sim.menu?.attach?.assign("w1", "a")).toBe("");
    expect(labels(sim)).toEqual(["Done"]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({
      kind: "pokemon",
      ref: you("active"),
      take: 1,
    });
    expect(sim.menu?.attach?.assign("w2", "b")).toMatch(/same Pokémon/);
    expect(sim.menu?.attach?.assign("w2", "a")).toBe("");
    expect(sim.sent).toEqual([{ kind: "pokemon", ref: you("active"), take: 2 }]);
    expect(sim.staged).toEqual([
      { cards: [energy("w1", "water"), energy("w2", "water")], targetUid: "a" },
    ]);
  });

  it("picks the card for a known Pokémon by dropping it there, or skips an optional one", () => {
    const sim = open({
      kind: "chooseCards",
      candidates: [{ id: "t1", cardId: "tool", name: "Tool", category: "Trainer" }] as never,
      min: 0,
      max: 1,
      dest: "attach",
      onto: you(0),
      note: "",
    });
    expect(sim.menu?.kind).toBe("attach");
    expect(sim.menu?.options.map((o) => o.uid)).toEqual(["b"]);
    expect(labels(sim)).toEqual(["Skip"]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({ kind: "cards", uids: [] });
    expect(sim.menu?.attach?.assign("t1", "a")).toMatch(/can take it/);
    expect(sim.menu?.attach?.assign("t1", "b")).toBe("");
    expect(sim.sent).toEqual([{ kind: "cards", uids: ["t1"] }]);
  });

  it("spreads a short pile one card per Pokémon, naming them in drop order", () => {
    const sim = open({
      kind: "choosePokemonMulti",
      candidates: [you("active"), you(0)],
      min: 1,
      max: 1,
      declinable: false,
      attachPile: [energy("w1", "water")],
      note: "",
    });
    expect(sim.menu?.kind).toBe("attach");
    expect(sim.menu?.attach?.assign("w1", "b")).toBe("");
    expect(sim.sent).toEqual([{ kind: "pokemonMulti", refs: [you(0)] }]);
  });

  it("moves Energy by dropping it on a destination; back on its own Pokémon it stays", () => {
    const sim = open({
      kind: "moveEnergy",
      movable: [{ uid: "e1", from: you("active") }],
      destinations: [you(0)],
      max: 1,
      note: "",
    });
    expect(sim.menu?.kind).toBe("attach");
    expect(sim.menu?.attach?.cards.map((c) => c.id)).toEqual(["e1"]);
    expect(sim.menu?.counterSourceUid).toBe("a");
    expect(labels(sim)).toEqual(["Skip"]);
    expect(choiceOf(sim.menu?.footer?.[0])).toEqual({ kind: "moveEnergy", picks: [] });
    expect(sim.menu?.attach?.assign("e1", "o")).toMatch(/this effect allows/);
    expect(sim.menu?.attach?.assign("e1", "a")).toBe("");
    expect(sim.sent).toEqual([]);
    expect(sim.menu?.attach?.assign("e1", "b")).toBe("");
    expect(sim.sent).toEqual([{ kind: "moveEnergy", picks: [{ uid: "e1", dest: you(0) }] }]);
  });

  it("keeps a move to one source, one destination and its ceiling, and holds Done below its floor", () => {
    const sim = open({
      kind: "moveEnergy",
      movable: [
        { uid: "e1", from: you("active") },
        { uid: "e2", from: you(0) },
      ],
      destinations: [you("active"), you(0), { seat: "p2", spot: { spot: "active" } }],
      max: 2,
      min: 2,
      anyDest: true,
      note: "",
    });
    expect(sim.menu?.counterSourceUid).toBeUndefined();
    expect([...(sim.menu?.attach?.from ?? [])]).toEqual([
      ["e1", "a"],
      ["e2", "b"],
    ]);
    expect(labels(sim)).toEqual(["Done"]);
    expect(sim.menu?.footer?.[0]?.disabled).toBe(true);
    expect(sim.menu?.attach?.assign("e1", "b")).toBe("");
    expect([...(sim.menu?.attach?.assigned ?? [])]).toEqual([["e1", "b"]]);
    expect(sim.menu?.footer?.[0]?.disabled).toBe(true);
    expect(sim.menu?.attach?.assign("e2", "o")).toMatch(/same Pokémon/);
    const single = open({
      kind: "moveEnergy",
      movable: [{ uid: "e1", from: you("active") }],
      destinations: [you(0), { seat: "p2", spot: { spot: "active" } }],
      max: 3,
      note: "",
    });
    expect(single.menu?.attach?.assign("e1", "b")).toBe("");
    expect(single.sent).toEqual([{ kind: "moveEnergy", picks: [{ uid: "e1", dest: you(0) }] }]);
  });

  it("offers one copy of each Basic Energy type, as the engine treats prints of one type alike", () => {
    const sim = {
      menu: null as SimMenu | null,
      sent: [] as unknown[],
      view: () => ({ ...view, phase: { kind: "effect:choose", prompt } }),
      action: (label: string, action: { choice: unknown }) => ({
        label,
        run: () => sim.sent.push(action.choice),
      }),
      emit: () => {},
      stageAttach: () => {},
      pileKeyOf: (cardId: string) => (cardId.startsWith("psy") ? "basic:Psychic" : cardId),
    };
    const prompt: RedactedEffectPrompt = {
      kind: "choosePokemon",
      candidates: [you("active")],
      attachPile: [energy("p1", "psyA"), energy("p2", "psyB"), energy("x1", "special")],
      note: "",
    } as never;
    sim.menu = effectMenu(sim as unknown as MenuHost, prompt);
    expect(sim.menu.attach?.cards.map((c) => c.id)).toEqual(["p1", "x1"]);
  });
});
