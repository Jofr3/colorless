import { BASIC_ENERGY_TYPES } from "@luminous/schema";
import type { Attack, Card } from "@luminous/schema";
import type { ApplyResult } from "./actions";
import { err } from "./actions";
// TYPE-ONLY, and it must stay that way: effects.ts imports no engine module at
// runtime (only `import type { StatusName } from "./events"`), and events.ts in
// turn imports `type { DamageModifier }` back from here — so the cycle
// cards → effects → events → cards exists in the TYPE graph and is erased
// wholesale by `import type`. A value import along any of those three edges
// would make it a real one.
import type { CardFilter } from "./effects";
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

/** Prizes the KOing player takes for this Pokémon (§8.1): 3 for a VMAX, 2 for
    any other rule box (ex / V / VSTAR / GX), 1 for a plain Pokémon. The class is
    read off `pokemonSuffixOf` — the printed rule-box marker the NAME still
    carries after ingest drops tcgdex's `suffix` field — so no schema/ingest/DB
    change was needed to make an ex worth its two Prizes. The feared blast radius
    (the win condition + "almost every KO test") never landed: every existing KO
    test knocks out a plain body, so the whole suite stayed green; the new
    behaviour is pinned by prizeValue.test.ts (the KO→count wiring) and the unit
    cases in cards.test.ts. Both prize read sites clamp `count` to the Prizes that
    remain (flow.ts's takePrizes handler + the §14 tie-guard slice), so a 2-Prize
    KO with one Prize left takes the last one and wins rather than over-drawing. */
export function prizeValueOf(card: Card): number {
  const suffix = pokemonSuffixOf(card);
  if (suffix === null) return 1;
  return suffix === "VMAX" ? 3 : 2;
}

/** The printed rule-box SUFFIX of a Pokémon — the "V" / "VMAX" / "VSTAR" /
    "ex" / "GX" marker following the species name — or null for a plain Pokémon
    or a non-Pokémon. tcgdex drops its dedicated `suffix` field at ingest, but
    the marker is ALSO part of the card NAME (a Pokémon V is literally printed
    "<Species> V"), and the name IS persisted — so the datum survives, encoded
    in `name` rather than a lost column. Read LITERALLY: "V" does not match
    "VMAX"/"VSTAR" (each is its own suffix, none a space-then-"V"), which is
    exactly the distinction Choice Belt draws — "…Active Pokémon V" boosts a V,
    never a VMAX or VSTAR. The live catalog's Pokémon GO set (swsh10.5) IS an
    ingested prior-era set — it holds 13 Pokémon V, 2 VMAX and 5 VSTAR — so Choice
    Belt's gate is LIVE against those V, and Mewtwo VSTAR "Psy Purge" (swsh10.5-031)
    is the first authored VSTAR (D97). The SV-era sets alone hold none, which is
    why the gate lay dormant until swsh10.5 was ingested. */
export type PokemonSuffix = "ex" | "V" | "VMAX" | "VSTAR" | "GX";
export function pokemonSuffixOf(card: Card): PokemonSuffix | null {
  if (card.category !== "Pokemon") return null;
  const { name } = card;
  if (name.endsWith(" VMAX")) return "VMAX";
  if (name.endsWith(" VSTAR")) return "VSTAR";
  if (name.endsWith(" V")) return "V";
  if (name.endsWith(" ex")) return "ex";
  if (name.endsWith(" GX")) return "GX";
  return null;
}

/** Is this Pokémon an "ex" or a "V" — the two rule-box classes Mimikyu
    "Safeguard" prevents all damage from ("…your opponent's Pokémon ex and
    Pokémon V")? NOT VMAX/VSTAR/GX: the print names ex and V only, so this is
    narrower than `hasRuleBox` (which also matches VMAX/VSTAR/GX and Radiant).
    Read off the name-derived `pokemonSuffixOf`; non-Pokémon are always false. */
export function isExOrV(card: Card): boolean {
  const suffix = pokemonSuffixOf(card);
  return suffix === "ex" || suffix === "V";
}

/** Does this Pokémon have a Rule Box (§ the reminder text Artazon prints:
    "Pokémon ex, Pokémon V, etc. have Rule Boxes.")? — the negated predicate of
    Artazon "Basic Pokémon that doesn't have a Rule Box". A Rule Box is the grey
    banner behind the rules text of the special-mechanic Pokémon: the suffix
    families (ex / V / VMAX / VSTAR / GX, off `pokemonSuffixOf`) PLUS Radiant
    Pokémon, whose marker is a NAME PREFIX ("Radiant Greninja") rather than a
    trailing suffix — the same name-encoded datum, read the other end. LIMITATION
    like `pokemonSuffixOf`: this is name-derived because tcgdex's structured
    markers are dropped at ingest, so any future Rule-Box family that is neither
    a known suffix nor the Radiant prefix would read as no-Rule-Box until named
    here (ACE SPEC is a Trainer subtype, so it never reaches this Pokémon-only
    check). Non-Pokémon are always false. */
export function hasRuleBox(card: Card): boolean {
  if (card.category !== "Pokemon") return false;
  return pokemonSuffixOf(card) !== null || card.name.startsWith("Radiant ");
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

export function matchesFilter(card: Card | undefined, filter: CardFilter): boolean {
  if (card === undefined) return false;
  switch (filter.kind) {
    case "basicPokemon":
      // `noRuleBox` (Artazon) drops the ex/V/…/Radiant Rule-Box Pokémon; a plain
      // `basicPokemon` (Nest Ball) takes any Basic.
      return isBasicPokemon(card) && (filter.noRuleBox !== true || !hasRuleBox(card));
    case "anyPokemon":
      return card.category === "Pokemon";
    case "evolutionPokemon":
      // An Evolution Pokémon (Jacq) — one that evolves from another Pokémon.
      // `evolveFromOf` returns null for non-Pokémon and for a Basic, so a
      // non-null result is the exact complement of `basicPokemon`.
      return evolveFromOf(card) !== null;
    case "toolCard":
      // A Pokémon Tool card (Town Store) — the attachTool discriminant.
      return card.category === "Trainer" && card.trainerType === "Tool";
    case "basicEnergy":
      return (
        isEnergyCard(card) &&
        card.energyType === "Normal" &&
        (filter.energyType === undefined || energyProvidesOf(card) === filter.energyType)
      );
    case "byName":
      return card.name === filter.name;
    case "supporter":
      return card.category === "Trainer" && card.trainerType === "Supporter";
    case "pokemonOrBasicEnergy":
      // A basic Energy is `energyType: "Normal"` (Special is excluded, matching
      // Super Rod's "Basic Energy"); a Pokémon is any category "Pokemon".
      return card.category === "Pokemon" || (isEnergyCard(card) && card.energyType === "Normal");
    case "anyEnergy":
      // Any Energy card — Basic OR Special (Poppy moves "up to 2 Energy").
      return isEnergyCard(card);
    case "specialEnergy":
      // A SPECIAL Energy only (Giacomo / Mawile) — the exact complement of
      // `basicEnergy` inside `anyEnergy`, off the catalog's own tag.
      return isSpecialEnergy(card);
    case "providesEnergy":
      // FALSE, always — and deliberately, not as a gap. This function scans
      // cards in a DECK, HAND or DISCARD PILE (searchDeck / lookAtTopN /
      // discardPileRetrieval), and provision is a while-ATTACHED property ("As
      // long as this card is attached to a Pokémon, it provides…"): a card in a
      // pile is attached to nothing and provides nothing. The in-play scanner
      // `matchesAttached` is where this filter is answered, with the host it
      // needs. So authoring `providesEnergy` into a pile-scanning op yields an
      // empty candidate set — a loud no-op, never a wrong card — where guessing
      // "a Basic Energy of that type" would silently take the wrong print
      // (Decidueye's "Basic {G} Energy card from your hand" is the row that
      // really wants `basicEnergy`, and it says CARD for exactly this reason).
      return false;
  }
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
