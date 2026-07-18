import { BASIC_ENERGY_TYPES } from "@luminous/schema";
import type { Attack, Card } from "@luminous/schema";
import type { ApplyResult } from "./actions";
import { err } from "./actions";
import type { GameState, InPlayPokemon, Seat } from "./types";

// The engine reads catalog data only through these accessors, so the exact
// Card surface it depends on (category, stage, retreat, hp, attacks,
// weakness/resistance, the energy name) stays one small, auditable module.

export function cardOfUid(state: GameState, uid: string): Card | undefined {
  const id = state.cardIdByUid[uid];
  return id === undefined ? undefined : state.cardPool[id];
}

/** `stage` uses the tcgdex vocabulary ("Basic" | "Stage1" | "Stage2" | …). */
export function isBasicPokemon(card: Card): boolean {
  return card.category === "Pokemon" && card.stage === "Basic";
}

/** The NAME of the Pokémon this card evolves from (§10 — the evolution goes
    on top of an in-play Pokémon whose top card has this name), or null when
    the card is a Basic / non-Pokémon and therefore evolves nothing. This is
    the discriminant for "is this an Evolution card": a non-null result. The
    `stage` field is not consulted — `evolveFrom` is the operative datum, and
    it is the one the ingest persists per catalog row. */
export function evolveFromOf(card: Card): string | null {
  return card.category === "Pokemon" ? (card.evolveFrom ?? null) : null;
}

/** Basic and Special energy both occupy the one attach per turn (§6.3). */
export function isEnergyCard(card: Card): boolean {
  return card.category === "Energy";
}

/** A Special Energy (§6.1) — the catalog tags them `energyType: "Special"`
    (basic energies are "Normal"). Special energies carry rules text (provision,
    on-attach effects, holder conditions), authored in the registry
    (registry.ts EnergyProgram); an unauthored one degrades to a plain
    Colorless provider (continuous.ts providedEnergy) rather than a loud reject,
    since an energy always provides SOMETHING. */
export function isSpecialEnergy(card: Card): boolean {
  return card.category === "Energy" && card.energyType === "Special";
}

/** The provided-unit token for "any one type of Energy" (§6.4) — a WILDCARD
    that can pay any single typed OR Colorless cost symbol (Luminous Energy's
    "provides every type of Energy but only 1 at a time"). Distinct from
    "Colorless" as a PROVIDED unit, which pays only Colorless slots. No basic
    energy type is named this, so it is a safe sentinel in a provided list
    (costMet in attack.ts is the only reader). */
export const ANY_ENERGY = "Any";

/** Printed retreat cost; null (nothing printed / non-Pokémon) = free (§11). */
export function retreatCostOf(card: Card): number {
  return card.retreat ?? 0;
}

/** Printed max HP. Null is a DATA GAP (non-Pokémon / a bad row), not "0 HP":
    the KO check skips rather than insta-KOs — like retreatCostOf's null, the
    real fix belongs at ingest. A non-positive printed value is the same gap
    (schema/ingest let 0 through), so it reads as null too: any hp the KO
    check sees is > 0. */
export function hpOf(card: Card): number | null {
  return card.hp !== null && card.hp > 0 ? card.hp : null;
}

/** Printed attacks; [] for Trainers/Energy and attackless Pokémon. */
export function attacksOf(card: Card): readonly Attack[] {
  return card.attacks ?? [];
}

/** Prizes the KOing player takes for this Pokémon (§8.1). SHOULD be 2 for an
    ex/V/GX rule box and 3 for VMAX — but the canonical Card carries no
    suffix/rule-box field (tcgdex's `suffix: "ex"` is dropped at ingest), so
    every KO is worth 1 until ingest persists it. The single point of change
    once the column lands; the M2 prize flow already takes `count` prizes. */
export function prizeValueOf(_card: Card): number {
  return 1;
}

/** What one attached Energy card provides toward a cost (§6.3). Catalog
    basic energies carry no `types` — the NAME is the datum, and real prints
    spell it both ways: "Fire Energy" and "Basic Darkness Energy"
    (sv06.5-098). The vocabulary is the shared BASIC_ENERGY_TYPES (§6.1,
    @luminous/schema) — INGEST DEBT: provision should become Card data at
    ingest; until then the name parse lives here. Anything unparseable
    (a special energy's fancy name) conservatively provides 1 Colorless: it can
    pay colorless slots, never typed ones (§6.4). This is the FALLBACK for an
    UNAUTHORED special energy — an authored one provides through its registry
    EnergyProgram instead (continuous.ts providedEnergy). */
export function energyProvidesOf(card: Card): string {
  const named = /^(?:Basic )?(.+) Energy$/.exec(card.name)?.[1];
  if (
    card.energyType === "Normal" &&
    named !== undefined &&
    (BASIC_ENERGY_TYPES as readonly string[]).includes(named)
  ) {
    return named;
  }
  return "Colorless";
}

export interface ParsedDamage {
  /** The numeric part — what M2 applies. */
  base: number;
  /** The printed marker ("+", "×", "?") when the number is not the whole
      story; the rest of that story is an M4 effect op (simulator.md: the
      damage field encodes an op). Null = the number IS the whole story. */
  modifier: string | null;
}

/** An attack's `damage` is a number, a marker string ("60+", "20×", "?"),
    or absent (pure-effect attacks). */
export function parseAttackDamage(damage: Attack["damage"]): ParsedDamage {
  if (damage === undefined) return { base: 0, modifier: null };
  if (typeof damage === "number") return { base: damage, modifier: null };
  // [\s\S] keeps the fallback TOTAL: an interior newline must still split as
  // (digits, marker-rest) and flag a modifier, not silently parse as 0.
  const parsed = /^(\d*)([\s\S]*)$/.exec(damage.trim());
  const digits = parsed?.[1] ?? "";
  const marker = (parsed?.[2] ?? "").trim();
  return { base: digits === "" ? 0 : Number(digits), modifier: marker === "" ? null : marker };
}

/** How a printed weakness/resistance value modifies attack damage (§8.5),
    kept structured so the DAMAGE_DEALT event can hand an animator the exact
    math: modern weakness multiplies ("×2"), older eras printed additive
    weakness ("+20" — e.g. dp5-4), resistance subtracts ("-30"/"−30"). */
export interface DamageModifier {
  op: "multiply" | "add" | "subtract";
  amount: number;
}

/** The shared weakness/resistance lookup: find the first entry naming any of
    the attacker's types and parse its printed value into an operation. A
    value matching NO printed format — genuinely unknown garble now that all
    three prints parse — falls back to the caller's modern-era default
    (×2 weakness / −30 resistance [current]). Null = no matching entry. */
function weakResModifier(
  attacker: Card,
  entries: Card["weaknesses"],
  fallback: DamageModifier,
): DamageModifier | null {
  const types = attacker.types ?? [];
  for (const entry of entries ?? []) {
    if (!types.includes(entry.type)) continue;
    const parsed = /^([×xX+\-−])(\d+)$/.exec(entry.value?.trim() ?? "");
    const amount = parsed?.[2] === undefined ? undefined : Number(parsed[2]);
    if (parsed === null || amount === undefined) return fallback;
    if (parsed[1] === "+") return { op: "add", amount };
    if (parsed[1] === "-" || parsed[1] === "−") return { op: "subtract", amount };
    return { op: "multiply", amount };
  }
  return null;
}

/** §8.5 Weakness: how the Defender's printed weakness modifies the damage
    when it names any of the attacker's types. Null = not weak. */
export function weaknessOf(attacker: Card, defender: Card): DamageModifier | null {
  return weakResModifier(attacker, defender.weaknesses, { op: "multiply", amount: 2 });
}

/** §8.5 Resistance: how the Defender's printed resistance modifies the
    damage when it names any of the attacker's types. Null = no resistance. */
export function resistanceOf(attacker: Card, defender: Card): DamageModifier | null {
  return weakResModifier(attacker, defender.resistances, { op: "subtract", amount: 30 });
}

/** Apply one parsed modifier at its §8.5 pipeline step. Flooring at 0 is the
    pipeline's job (attack.ts), not the modifier's. */
export function applyDamageModifier(damage: number, modifier: DamageModifier | null): number {
  if (modifier === null) return damage;
  switch (modifier.op) {
    case "multiply":
      return damage * modifier.amount;
    case "add":
      return damage + modifier.amount;
    case "subtract":
      return damage - modifier.amount;
  }
}

/** The top of the stack defines the Pokémon's identity (§1.2). Stacks are
    never empty, but indexing has to admit undefined. */
export function topUid(pokemon: InPlayPokemon): string | undefined {
  return pokemon.stack[pokemon.stack.length - 1];
}

export function topCardOf(state: GameState, pokemon: InPlayPokemon): Card | undefined {
  const uid = topUid(pokemon);
  return uid === undefined ? undefined : cardOfUid(state, uid);
}

/** A seat's Active with its stack-top uid and catalog card resolved in one
    go, or null when the spot is empty (or the stack/catalog has a gap —
    structurally impossible for engine-built states, but indexing has to
    admit it). The one helper for the `active === null ? undefined :
    topUid(active)` guard chain every Active-reading site was spelling out. */
export function activeTop(
  state: GameState,
  seat: Seat,
): { active: InPlayPokemon; uid: string; card: Card } | null {
  const active = state.players[seat].active;
  if (active === null) return null;
  const uid = topUid(active);
  if (uid === undefined) return null;
  const card = cardOfUid(state, uid);
  if (card === undefined) return null;
  return { active, uid, card };
}

/** The "a Basic Pokémon out of your own hand" check shared by the two setup
    placements and the in-turn bench play (§3.6–§3.7, §5.2). Returns the
    rejection, or null when the play is legal. M2's evolution play adds its
    own timing rules on top of the same hand/uid resolution. */
export function basicFromHandError(state: GameState, seat: Seat, uid: string): ApplyResult | null {
  if (!state.players[seat].hand.includes(uid)) {
    return err("CARD_NOT_IN_HAND", `${uid} is not in ${seat}'s hand`);
  }
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${uid}`);
  }
  if (!isBasicPokemon(card)) {
    return err("NOT_A_BASIC_POKEMON", `${card.name} is not a Basic Pokémon`);
  }
  return null;
}
