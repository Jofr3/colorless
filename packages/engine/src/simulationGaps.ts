import type { Card } from "@colorless/schema";
import { isSpecialEnergy } from "./cardClasses";
import { toolCardSimulated } from "./continuous";
import {
  ATTACK_READERS,
  deriveAttackCopy,
  deriveAttackEffect,
  splitAttackText,
  timingGateFromAttackText,
} from "./effects";
import type { CardProgram } from "./programTypes";
import { programFor } from "./registry";

/** A part of a card's printed text the engine does not play. */
export type SimulationGap = "trainer" | "ability" | "specialEnergy" | "attack";

/**
 * What `card` prints that the engine cannot play, in a fixed order: a Trainer it refuses
 * (`TRAINER_NOT_SIMULATED`), an Ability with no program, a Special Energy that degrades to a plain
 * {C}, or an attack whose effect text is skipped (`ATTACK_EFFECT_SKIPPED`). Empty when every part
 * is simulated.
 */
export function simulationGaps(card: Card): SimulationGap[] {
  const program = programFor(card.id);
  const gaps: SimulationGap[] = [];
  if (card.category === "Trainer" && !trainerPlayable(card, program)) gaps.push("trainer");
  if ((card.abilities ?? []).length > 0 && !programsBeyondAttacks(program)) gaps.push("ability");
  if (isSpecialEnergy(card) && program?.energy === undefined) gaps.push("specialEnergy");
  if (
    card.category === "Pokemon" &&
    (card.attacks ?? []).some(
      (attack, index) => !attackEffectSimulated(attack.effect, program, index),
    )
  ) {
    gaps.push("attack");
  }
  return gaps;
}

/** The program `playTrainer` and `attachTool` need before they accept the card. */
function trainerPlayable(card: Card, program: CardProgram | undefined): boolean {
  switch (card.trainerType) {
    case "Item":
    case "Supporter":
      return (
        program?.trainer !== undefined ||
        program?.playAsPokemon === true ||
        program?.rareCandy === true
      );
    case "Stadium":
      return program?.stadium !== undefined;
    case "Tool":
      return toolCardSimulated(card);
    default:
      return false;
  }
}

/** Abilities have no text deriver, so a printed Ability plays only through a non-attack key. */
function programsBeyondAttacks(program: CardProgram | undefined): boolean {
  return Object.keys(program ?? {}).some((key) => key !== "attack" && key !== "attackGate");
}

/** The readers whose claim plays the text; requirements and copies are read separately. */
const EFFECT_READERS = ATTACK_READERS.filter(({ role }) => role === "effect").map(
  ({ read }) => read,
);

/**
 * Whether the attack at `index` resolves its effect text, read off the printed card the way
 * `readAttackText` reads a printed attack: an authored program, a copy of another attack, or the
 * text `splitAttackText` leaves, claimed by a reader.
 */
function attackEffectSimulated(
  text: string | undefined,
  program: CardProgram | undefined,
  index: number,
): boolean {
  if (text === undefined || text === "") return true;
  if (program?.attack?.[index] !== undefined || deriveAttackCopy(text) !== null) return true;
  const gate = program?.attackGate?.[index] ?? timingGateFromAttackText(text);
  const { effect, requirement, requirementSplit, tail } = splitAttackText(text, gate !== undefined);
  if (effect === "") return true;
  if (requirement !== null && !requirementSplit) return true;
  if (EFFECT_READERS.some((read) => read(effect) !== null)) return true;
  return tail !== null && deriveAttackEffect(tail) !== null;
}
