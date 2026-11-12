import { BASIC_ENERGY_TYPES } from "@colorless/schema/constants";
import type { Attack, Card } from "@colorless/schema";
import type { Rejection } from "./actions";
import { isBasicEnergy, isBasicPokemon, isSpecialEnergy } from "./cardClasses";
import { err } from "./actions";
import { type Banner, bannerOf } from "./banners";
import { normalizedFace } from "./cardText";
import { FOSSIL_IDS, fossilPokemonCard } from "./fossils";
import type { CardFilter, PokemonSuffix } from "./effectTypes";
import type { GameState, InPlayPokemon, Seat } from "./types";
import { SEATS } from "./types";

export type { PokemonSuffix };

// The engine reads catalog data only through these accessors. An Antique Fossil uid in an in-play
// stack reads as its synthesized 60-HP Basic {C} Pokémon face, and as the catalog Item elsewhere.
// Every face is read through the markup normaliser, so a persisted raw face reads the same as a
// re-ingested one. A game keeps its `cardIdByUid` and `cardPool` objects from state to state, so
// every other uid's face is remembered against them, and nothing may write into either once the
// engine has read it; a fossil's face depends on its zone and is not remembered.
export function cardOfUid(state: GameState, uid: string): Card | undefined {
  const faces = facesOf(state);
  const known = faces.get(uid);
  if (known !== undefined) return known;
  const id = Object.hasOwn(state.cardIdByUid, uid) ? state.cardIdByUid[uid] : undefined;
  if (id === undefined) return undefined;
  const pooled = Object.hasOwn(state.cardPool, id) ? state.cardPool[id] : undefined;
  const card = pooled === undefined ? undefined : normalizedFace(pooled);
  if (card === undefined) return undefined;
  if (!FOSSIL_IDS.has(id)) {
    faces.set(uid, card);
    return card;
  }
  return uidInPlayStack(state, uid) ? fossilPokemonCard(card) : card;
}

const FACES_BY_UID = new WeakMap<
  GameState["cardIdByUid"],
  { pool: GameState["cardPool"]; faces: Map<string, Card> }
>();

function facesOf(state: GameState): Map<string, Card> {
  const known = FACES_BY_UID.get(state.cardIdByUid);
  if (known !== undefined && known.pool === state.cardPool) return known.faces;
  const faces = new Map<string, Card>();
  FACES_BY_UID.set(state.cardIdByUid, { pool: state.cardPool, faces });
  return faces;
}

/**
 * Is `uid` one of the cards of an in-play stack (either seat)? Attached Energy and Tools are not
 * stack cards.
 */
function uidInPlayStack(state: GameState, uid: string): boolean {
  for (const seat of SEATS) {
    const side = state.players[seat];
    if (side.active?.stack.includes(uid) === true) return true;
    if (side.bench.some((body) => body.stack.includes(uid))) return true;
  }
  return false;
}

/**
 * Is `pokemon`'s top card an Antique Fossil? Top card only: an evolved fossil is no longer a
 * fossil.
 */
export function isFossilTop(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = pokemon.stack[pokemon.stack.length - 1];
  const id = uid === undefined ? undefined : state.cardIdByUid[uid];
  return id !== undefined && FOSSIL_IDS.has(id);
}

export function handHasBasic(state: GameState, seat: Seat): boolean {
  return state.players[seat].hand.some((uid) => {
    const card = cardOfUid(state, uid);
    return card !== undefined && isBasicPokemon(card);
  });
}

/**
 * Is `card` a Stage 1 Pokémon (§10)? Reads the printed stage word, since a VSTAR or VMAX is an
 * Evolution but not a Stage 1.
 */
export function isStage1Pokemon(card: Card): boolean {
  return card.category === "Pokemon" && card.stage === "Stage1";
}

/**
 * Is `card` a Stage 2 Pokémon (§10)? Reads the printed stage word rather than counting the chain,
 * so a VSTAR is not a Stage 2.
 */
export function isStage2Pokemon(card: Card): boolean {
  return card.category === "Pokemon" && card.stage === "Stage2";
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

/**
 * Is `card` an Evolution Pokémon (§10)? Uses `evolveFrom` rather than `!isBasicPokemon`, which
 * would also be true of Trainers and Energy. A VMAX counts as an Evolution.
 */
export function isEvolutionPokemon(card: Card): boolean {
  return evolveFromOf(card) !== null;
}

/** Basic and Special energy both occupy the one attach per turn (§6.3). */
export function isEnergyCard(card: Card): boolean {
  return card.category === "Energy";
}

/**
 * The provided unit for "any one type of Energy" (§6.4): a wildcard that pays any single typed or
 * Colorless symbol. Distinct from a provided "Colorless", which pays only Colorless slots.
 */
export const ANY_ENERGY = "Any";

/**
 * Prefix of a constrained provided unit (§6.4): one unit that pays any one of a fixed set of types,
 * or a Colorless slot (Team Rocket's Energy: "provides 2 in any combination of {P} Energy and {D}
 * Energy"). Built and parsed only by the two functions below.
 */
const CONSTRAINED_PREFIX = "OneOf:";

/** The provided unit "one of `types`"; members are sorted so one set has one spelling. */
export function constrainedEnergyUnit(types: readonly string[]): string {
  return `${CONSTRAINED_PREFIX}${[...types].sort().join(",")}`;
}

/** The member types of a constrained unit, or `null` for any other unit. */
export function constrainedEnergyTypes(unit: string): readonly string[] | null {
  return unit.startsWith(CONSTRAINED_PREFIX)
    ? unit.slice(CONSTRAINED_PREFIX.length).split(",")
    : null;
}

/**
 * §6.4 cost matching. Typed symbols need that type; Colorless slots take whatever is left.
 * Wildcards are allocated to typed shortfalls first, then everything left pays Colorless.
 */
export function costMet(cost: readonly string[], provided: readonly string[]): boolean {
  const needed = new Map<string, number>();
  let colorless = 0;
  for (const symbol of cost) {
    if (symbol === "Colorless") colorless++;
    else needed.set(symbol, (needed.get(symbol) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  const constrained = new Map<string, number>();
  let wild = 0;
  for (const unit of provided) {
    if (unit === ANY_ENERGY) wild++;
    else if (constrainedEnergyTypes(unit) !== null)
      constrained.set(unit, (constrained.get(unit) ?? 0) + 1);
    else counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }
  // Three passes, narrowest unit first: concrete units, then each constrained set against its
  // members' shortfall, then wildcards. Greedy is exact because the sets are laminar (nested or
  // disjoint), processed smallest first; two overlapping non-nested sets would break it.
  const shortfalls = new Map<string, number>();
  let typedNeeds = 0;
  for (const [type, count] of needed) {
    typedNeeds += count;
    const shortfall = count - (counts.get(type) ?? 0);
    if (shortfall > 0) shortfalls.set(type, shortfall);
  }
  const sets = [...constrained.entries()]
    .map(([unit, count]) => ({ members: constrainedEnergyTypes(unit) ?? [], count }))
    .sort((a, b) => a.members.length - b.members.length);
  for (const set of sets) {
    let budget = set.count;
    for (const type of set.members) {
      const short = shortfalls.get(type) ?? 0;
      const paid = Math.min(short, budget);
      if (paid > 0) shortfalls.set(type, short - paid);
      budget -= paid;
    }
  }
  for (const shortfall of shortfalls.values()) {
    if (shortfall > 0) {
      // Cover the typed shortfall with wildcards; run out and the cost is unmet.
      if (shortfall > wild) return false;
      wild -= shortfall;
    }
  }
  // Each typed need consumed exactly one unit; everything else (surplus typed
  // units, leftover wildcards, Colorless-provided units) pays the Colorless.
  return provided.length - typedNeeds >= colorless;
}

/** Printed retreat cost; null (nothing printed / non-Pokémon) = free (§11). */
export function retreatCostOf(card: Card): number {
  return card.retreat ?? 0;
}

/**
 * Printed max HP, or null for a non-Pokémon or a non-positive value (a data gap, not 0 HP); the KO
 * check skips null. The category check matters because Trainer rows can carry a printed `hp`
 * (Antique Fossil).
 */
export function hpOf(card: Card): number | null {
  return card.category === "Pokemon" && card.hp !== null && card.hp > 0 ? card.hp : null;
}

/**
 * Printed attacks; [] for non-Pokémon and attackless Pokémon. The category check matters because
 * Trainer rows can carry attacks (Technical Machines grant them to a holder).
 */
export function attacksOf(card: Card): readonly Attack[] {
  return card.category === "Pokemon" ? (card.attacks ?? []) : [];
}

/**
 * Prizes the knocking-out player takes (§8.1): 3 for a VMAX or a Mega Evolution Pokémon ex, 2 for
 * any other rule box, 1 otherwise. Read from the name suffix. This is the base count that prize
 * modifiers adjust and callers clamp to the Prizes left.
 */
export function prizeValueOf(card: Card): number {
  const suffix = pokemonSuffixOf(card);
  if (suffix === null) return 1;
  return suffix === "VMAX" || isMegaEvolutionPokemonEx(card) ? 3 : 2;
}

/**
 * Is this a Mega Evolution Pokémon ex? Read from the name ("Mega <Species> ex") because the catalog
 * suffix tag is unreliable. Both the "Mega " prefix with its space (not Meganium) and the ` ex`
 * suffix are needed. It otherwise behaves as a normal Pokémon ex; evolving does not end the turn.
 */
export function isMegaEvolutionPokemonEx(card: Card): boolean {
  return pokemonSuffixOf(card) === "ex" && card.name.startsWith("Mega ");
}

/**
 * The rule-box suffix of a Pokémon, or null. Read from the card name: the `Card` face carries no
 * suffix, and the catalog's `suffix` column spells a Pokémon ex "EX" in some sets. Matched
 * literally, so "V" does not match "VMAX" or "VSTAR".
 */
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

/**
 * §8.5: the rule-box class of attacker a prevention aura names ("…from your opponent's Pokémon ex",
 * "…Basic Pokémon ex"). A record rather than a union so each axis can grow independently. An absent
 * `stage` means any stage; `suffix` is required so "prevent all damage from any attack" cannot be
 * expressed by omission.
 */
export interface PreventedAttackerClass {
  /** The printed rule-box SUFFIX ("…your opponent's Pokémon **ex**"), read through
      `pokemonSuffixOf`. Required — see above. */
  readonly suffix: PokemonSuffix;
  /** The printed STAGE word ("…your opponent's **Basic** Pokémon ex"), ABSENT when
      the sentence prints none. One member, and `switch`ed at the read rather than
      compared, for `attackerMatchesStage`'s reason (continuous.ts): that is what
      makes "closed vocabulary" a compiler fact instead of a comment. */
  readonly stage?: "basic";
}

/**
 * §8.5: is `attacker` in one of the rule-box classes a prevention aura names? Stage uses
 * `isBasicPokemon` on the top card, so an evolved Basic ex is no longer covered. The suffix is an
 * exact match, not `isExOrV`, since these cards name ex only. `undefined` is false (protects less).
 */
export function preventsAttackerClass(
  classes: readonly PreventedAttackerClass[],
  attacker: Card | undefined,
): boolean {
  if (classes.length === 0 || attacker === undefined) return false;
  const suffix = pokemonSuffixOf(attacker);
  if (suffix === null) return false;
  return classes.some(
    (cls) =>
      cls.suffix === suffix && (cls.stage === undefined || matchesStage(attacker, cls.stage)),
  );
}

/** The stage conjunct alone, split out so the `switch` can be the whole BODY of a
    `boolean` function — continuous.ts `attackerMatchesStage`'s shape verbatim, and
    for its reason: that is what makes exhaustiveness a compiler fact (a new `stage`
    member leaves the function with a code path returning `undefined`). Folded inline
    it would merely fall out of the switch and answer `true`, which is the silent-
    WIDENING failure this family must not have. */
function matchesStage(
  attacker: Card,
  stage: NonNullable<PreventedAttackerClass["stage"]>,
): boolean {
  switch (stage) {
    case "basic":
      return isBasicPokemon(attacker);
  }
}

/**
 * Does this Pokémon have a Rule Box? The suffix families plus Radiant Pokémon (a name prefix).
 * Name-derived, so a new Rule Box family would need adding here. Non-Pokémon are false.
 */
export function hasRuleBox(card: Card): boolean {
  if (card.category !== "Pokemon") return false;
  return pokemonSuffixOf(card) !== null || card.name.startsWith("Radiant ");
}

/** Is `card` a Tera Pokémon? Read from the id-keyed banner table. `undefined` is false. */
export function isTeraPokemon(card: Card | undefined): boolean {
  return card !== undefined && card.category === "Pokemon" && bannerOf(card) === "Tera";
}

/**
 * Does `attacker` carry one of the banners a prevention names (Milotic ex "Sparkling Scales":
 * "…from your opponent's Tera Pokémon")? Read off the attacker's top card; `undefined` is false; an
 * empty list short-circuits.
 */
export function preventsAttackerBanner(
  banners: readonly Banner[],
  attacker: Card | undefined,
): boolean {
  if (banners.length === 0 || attacker === undefined) return false;
  const banner = bannerOf(attacker);
  return banner !== undefined && banners.includes(banner);
}

/**
 * Does this Pokémon have an Ability ("…your opponent's Pokémon that have an Ability")? Reads the
 * printed card, not the board: an Ability turned off by a lock is still had. `undefined` is false.
 * The category check matters because a fossil Item's catalog row carries its Ability.
 */
export function hasPrintedAbility(card: Card | undefined): boolean {
  return card?.category === "Pokemon" && (card.abilities ?? []).length > 0;
}

/**
 * What one attached Energy card provides toward a cost (§6.3). Basic Energy carries no `types`, so
 * the type is parsed from the name ("Fire Energy", "Basic Darkness Energy"). Anything unparseable
 * provides 1 Colorless; authored Special Energy provides through its registry program instead.
 */
export function energyProvidesOf(card: Card): string {
  const named = /^(?:Basic )?(.+) Energy$/.exec(card.name)?.[1];
  if (
    isBasicEnergy(card) &&
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
    case "basicPokemon": {
      // `noRuleBox` (Artazon) excludes Rule Box Pokémon. `maxHp` is a printed HP threshold
      // (Buddy-Buddy Poffin). A null HP is refused explicitly because `null <= 70` is true in
      // JavaScript.
      const hp = hpOf(card);
      return (
        isBasicPokemon(card) &&
        (filter.noRuleBox !== true || !hasRuleBox(card)) &&
        (filter.maxHp === undefined || (hp !== null && hp <= filter.maxHp))
      );
    }
    case "anyPokemon":
      // `noRuleBox` (Lana's Aid) excludes Rule Box Pokémon at any stage.
      return card.category === "Pokemon" && (filter.noRuleBox !== true || !hasRuleBox(card));
    case "evolutionPokemon":
      // An Evolution Pokémon (Jacq) — one that evolves from another Pokémon.
      // `evolveFromOf` returns null for non-Pokémon and for a Basic, so a
      // non-null result is the exact complement of `basicPokemon`.
      return evolveFromOf(card) !== null;
    case "stagePokemon":
      // A printed stage ordinal ("your Stage 1 Pokémon"). Not the Evolution arm narrowed: a VSTAR
      // or VMAX evolves but is neither ordinal.
      return filter.stage === "Stage1" ? isStage1Pokemon(card) : isStage2Pokemon(card);
    case "typedPokemon": {
      // A Pokémon of a printed type ("a Basic {G} Pokémon"). Uses `includes` so dual-type Pokémon
      // match. Optional stage (Basic or Evolution) and HP threshold, with null HP refused as for
      // `basicPokemon`.
      const typedHp = hpOf(card);
      return (
        card.category === "Pokemon" &&
        (card.types ?? []).includes(filter.pokemonType) &&
        (filter.stage === undefined ||
          (filter.stage === "basic" ? isBasicPokemon(card) : evolveFromOf(card) !== null)) &&
        (filter.maxHp === undefined || (typedHp !== null && typedHp <= filter.maxHp))
      );
    }
    case "anyOf":
      // "Your {G} Pokémon and {R} Pokémon" names a union, so `.some`; an empty list is false.
      return filter.filters.some((inner) => matchesFilter(card, inner));
    case "abilityPokemon":
      // A Pokémon that has an Ability (Team Rocket's Arbok "Potent Glare"). A §9 Ability lock
      // silences an Ability but does not remove it, so this reads the printed card.
      return hasPrintedAbility(card);
    case "attackNamePokemon":
      // A Pokémon that has a printed attack of that name ("your Pokémon in play that has the Round
      // attack"). Membership, not `attacks[0]`, because a card may print two attacks; exact
      // equality because the printed name asks for nothing else.
      return attacksOf(card).some((attack) => attack.name === filter.attack);
    case "pokemonNameContaining":
      // "Pokémon in play that has "Koffing" or "Weezing" in its name": unanchored, case-sensitive
      // containment, deliberately not `startsWith`, since the fragment can sit at a non-zero offset
      // (an owner possessive). The optional rule-box conjunct (Ogre's Mask's "a Pokémon ex that has
      // "Ogerpon" in its name") is checked first.
      if (filter.suffix !== undefined && pokemonSuffixOf(card) !== filter.suffix) return false;
      return matchesFilter(card, { kind: "anyPokemon" }) && card.name.includes(filter.fragment);
    case "bannerPokemon":
      // A Pokémon printing the named banner ("a Tera Pokémon"), by printing id through
      // `banners.ts`, never by name: two Pikachu ex disagree.
      return card.category === "Pokemon" && bannerOf(card) === filter.banner;
    case "bannerCard":
      // A card of any category printing the named banner ("each Ancient card in your discard
      // pile"). Paradox banners are printed on Trainers too, so `bannerPokemon` would undercount.
      return bannerOf(card) === filter.banner;
    case "suffixPokemon":
      // A Pokémon of a printed rule-box class ("your opponent's Pokémon ex in play"). Deliberately
      // not `isExOrV`, which would widen "Pokémon ex" to count Pokémon V; `pokemonSuffixOf` returns
      // null for a non-Pokémon.
      return pokemonSuffixOf(card) === filter.suffix;
    case "megaEvolutionEx":
      // "A Mega Evolution Pokémon ex" (Mega Signal, Jett).
      return isMegaEvolutionPokemonEx(card);
    case "ownerPokemon":
      // An owner-prefixed subgroup Pokémon (Cynthia's Gabite "Champion's Call"). The category check
      // matters because Team Rocket's Energy carries the prefix; the prefix includes its trailing
      // space and is exact-case; the stage word, when printed, is re-read here.
      return (
        card.category === "Pokemon" &&
        card.name.startsWith(`${filter.owner}'s `) &&
        (filter.stage === undefined ||
          (filter.stage === "basic" ? isBasicPokemon(card) : evolveFromOf(card) !== null))
      );
    case "toolCard":
      // A Pokémon Tool card (Town Store) — the attachTool discriminant.
      return card.category === "Trainer" && card.trainerType === "Tool";
    case "basicEnergy":
      return (
        isBasicEnergy(card) &&
        (filter.energyType === undefined || energyProvidesOf(card) === filter.energyType)
      );
    case "byName":
      return card.name === filter.name;
    case "supporter":
      return card.category === "Trainer" && card.trainerType === "Supporter";
    case "toolNameContaining":
      // TM Machine's "Pokémon Tool cards that have "Technical Machine" in their name": unanchored,
      // case-sensitive containment.
      return matchesFilter(card, { kind: "toolCard" }) && card.name.includes(filter.fragment);
    case "itemNameContaining":
      // Fossil Quarry's "Item cards that have "Antique" in their name".
      return matchesFilter(card, { kind: "item" }) && card.name.includes(filter.fragment);
    case "supporterNameContaining":
      // "Supporter card that has "Team Rocket" in its name". The Supporter check matters because
      // Team Rocket Items and Tools exist. Containment, deliberately not `startsWith`: an owner
      // possessive can put the fragment at a non-zero offset.
      return matchesFilter(card, { kind: "supporter" }) && card.name.includes(filter.fragment);
    case "item":
      // An Item Trainer. A Pokémon Tool is not one: they are separate printed subtypes.
      return card.category === "Trainer" && card.trainerType === "Item";
    case "stadium":
      return card.category === "Trainer" && card.trainerType === "Stadium";
    case "trainerCard":
      // The printed "a Trainer card": the category, not a disjunction of the subtypes, so a new
      // subtype is admitted automatically.
      return card.category === "Trainer";
    case "anyCard":
      // The printed uncategorised "a card". True for every real card; the guard at the top keeps a
      // dangling uid out.
      return true;
    case "pokemonOrBasicEnergy":
      // A basic Energy is "Normal" with no rules text (Special is excluded, matching Super Rod's
      // "Basic Energy").
      return card.category === "Pokemon" || isBasicEnergy(card);
    case "anyEnergy":
      // Any Energy card — Basic OR Special (Poppy moves "up to 2 Energy").
      return isEnergyCard(card);
    case "pokemonWithResistance":
      // "Pokémon with {F} Resistance": the printed resistance entry's type. `resistances` is null
      // on Trainers and Energy.
      return (
        card.category === "Pokemon" &&
        (card.resistances ?? []).some((entry) => entry.type === filter.type)
      );
    case "specialEnergy":
      // A Special Energy only (Giacomo / Mawile), the complement of `basicEnergy` inside
      // `anyEnergy`.
      return isSpecialEnergy(card);
    case "providesEnergy":
      // Always false, deliberately: this function scans cards in a deck, hand or discard pile, and
      // provision is a while-attached property. `matchesAttached` answers this filter for in-play
      // cards.
      return false;
  }
}

/**
 * Does the printed noun name its card? A `byName` noun, a name fragment, or an `anyOf` of only such
 * nouns. A card that names the Pokémon it puts onto the Bench may put an Evolution card there.
 * Reading a name fragment as naming its card is unruled.
 */
export function namesItsCard(filter: CardFilter): boolean {
  if (filter.kind === "byName" || filter.kind === "pokemonNameContaining") return true;
  return filter.kind === "anyOf" && filter.filters.length > 0 && filter.filters.every(namesItsCard);
}

/**
 * `matchesFilter` for a card an effect puts onto the Bench (§7: only Basic Pokémon unless the card
 * says otherwise). A non-Basic Pokémon is refused unless the noun names its card; a Trainer is
 * allowed only with an in-play Pokémon face (`FOSSIL_IDS`). Read off the filter rather than a new
 * op field so persisted programs keep the same permission.
 */
export function benchMatches(card: Card | undefined, filter: CardFilter): boolean {
  if (card === undefined || !matchesFilter(card, filter)) return false;
  if (card.category === "Trainer") return FOSSIL_IDS.has(card.id);
  return card.category !== "Pokemon" || card.stage === "Basic" || namesItsCard(filter);
}

export interface ParsedDamage {
  /** The numeric part — the printed base damage. */
  base: number;
  /** The printed marker ("+", "×", "?") when the number is not the whole
      story; the rest of that story is an effect op (simulator.md, "Where a
      card's behaviour comes from"). Null = the number IS the whole story. */
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

/**
 * §8.5 Weakness: how the defender's Weakness modifies the damage when it names any of the
 * attacker's types. Null = not weak. `rewrite` is applied first and replaces the printed entries
 * with one ×2 entry of that type (so a defender with no Weakness gains one); `retype` then replaces
 * only the type of the first entry, keeping its amount.
 */
export function weaknessOf(
  attacker: Card,
  defender: Card,
  retype: string | null = null,
  rewrite: string | null = null,
): DamageModifier | null {
  const printed = rewrite === null ? (defender.weaknesses ?? []) : [{ type: rewrite, value: "×2" }];
  const entries =
    retype === null ? printed : printed.slice(0, 1).map((entry) => ({ ...entry, type: retype }));
  return weakResModifier(attacker, entries, { op: "multiply", amount: 2 });
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

/**
 * The "a Basic Pokémon out of your own hand" check shared by the two setup placements and the
 * in-turn bench play (§3.6–§3.7, §5.2). Returns the rejection, or null when the play is legal.
 */
export function basicFromHandError(state: GameState, seat: Seat, uid: string): Rejection | null {
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
