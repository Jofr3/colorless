import { cardOfUid, topUid } from "./cards";
import type { PokemonRef } from "./effectPrompt";
import type { AttachTargetRiders, CardFilter, OpOf } from "./effectTypes";
import type { SearchDeckMax } from "./effectTargets";
import { refPokemon, targetTypeNames } from "./effectTargets";
import type { GameState, Seat } from "./types";
import { HP_PER_COUNTER } from "./types";

// The captions a parked op shows: pure functions from an op (and the clamped numbers) to the text
// of its prompt, in the answerer's voice.

/** Acerola's Mischief dialog caption: the printed sentence with the class spelled as printed. */
export function chosenAttackShieldNote(op: OpOf<"installChosenAttackShield">): string {
  const noun = {
    ex: "Pokémon ex",
    basic: "Basic Pokémon",
    ancient: "Ancient Pokémon",
    burned: "Burned Pokémon",
    evolution: "Evolution Pokémon",
    hasAbility: "Pokémon that have an Ability",
  }[op.fromClass.stage];
  return `Choose 1 of your Pokémon in play. During your opponent's next turn, prevent all damage from and effects of attacks done to that Pokémon by your opponent's ${noun}.`;
}

/** The choosePokemonMulti prompt string. For the put-counter snipe, counters are
    the printed unit, so the HP `amount` reads back as counters (one counter = 10
    HP, §12); for a `deals` hit (Wo-Chien "Covetous Ivy") the printed unit is
    damage. The heading quotes the card: a bare "Choose 2" for the exact pick every
    consumer prints, and "you may" only where the card says it (an optional trigger,
    whose decline the dialog offers as taking none). Never "up to". */
export function snipeNote(
  amount: number,
  count: number,
  optional: boolean,
  op: Pick<
    OpOf<"damageChosen">,
    | "deals"
    | "target"
    | "damagedOnly"
    | "filter"
    | "perDamageCounterOnTarget"
    | "perHeadsInPlay"
    | "specialEnergyOnly"
  >,
): string {
  const deals = op.deals === true;
  // `yourAny` is unreachable today because that op is `count: "all"` and takes the forced branch,
  // but the caption must read correctly once a park reaches it.
  const target = op.target;
  // `damagedOnly` and `specialEnergyOnly` narrow the offer, so the caption names exactly that set.
  const damagedOnly = op.damagedOnly === true;
  const specialEnergyOnly = op.specialEnergyOnly === true;
  // The caption names the narrowed candidate class via `retrieveNoun`, writing the zone word once
  // ("Benched Pokémon ex or Pokémon V").
  const narrowing = op.filter;
  // The amount depends on the unchosen body, so the caption quotes the rule ("20 damage for each
  // damage counter on it") instead of a number.
  const perDamageCounterOnTarget = op.perDamageCounterOnTarget === true;
  // Coins are flipped after the pick, so the caption quotes the rule ("50 damage for each heads").
  const perHeads = op.perHeadsInPlay !== undefined;
  const verb = optional ? "You may choose" : "Choose";
  const each = deals
    ? `${amount} damage`
    : `${Math.round(amount / HP_PER_COUNTER)} damage counter${Math.round(amount / HP_PER_COUNTER) === 1 ? "" : "s"}`;
  // `opponentAny` offers the Active too, so the heading drops "Benched".
  const noun = narrowing === undefined ? "Pokémon" : retrieveNoun(narrowing).plural;
  // `yourAny` drops "Benched" like `opponentAny`: the candidate set includes the Active.
  const zone = target === "opponentAny" || target === "yourAny" ? noun : `Benched ${noun}`;
  // The heading names whose Pokémon they are, since `yourBench` and `yourAny` offer the attacker's
  // own bodies.
  const owner = target === "yourBench" || target === "yourAny" ? "your" : "your opponent's";
  // The window follows the noun, as printed. Singular only: the clause is only accepted with a
  // count of 1.
  const window = damagedOnly
    ? " that has any damage counters on it"
    : specialEnergyOnly
      ? " that has any Special Energy attached"
      : "";
  if (perDamageCounterOnTarget) {
    // `each` rather than `${amount} damage`: a placement (Spiritomb "Spiritual End") quotes
    // counters per counter already there.
    return `${verb} ${count} of ${owner} ${zone}${window} (${each} for each damage counter on it).`;
  }
  if (perHeads)
    return `${verb} ${count} of ${owner} ${zone}${window} (${amount} damage for each heads).`;
  return `${verb} ${count} of ${owner} ${zone}${window} (${each} each).`;
}

/**
 * The heading for healChosen's "up to N" park, quoting the card, with `max` already clamped to the
 * board (§8.6). The heading must describe the candidates it was built from.
 */
export function healUpToNote(amount: number | "all", max: number, zoneWord: string): string {
  const what = amount === "all" ? "all damage" : `${amount} damage`;
  return `Choose up to ${max} of your ${zoneWord}Pokémon and heal ${what} from each of them.`;
}

/** Mr. Mime "Look-Alike Show"'s second sentence, used as the park heading. */
export const LOOK_ALIKE_SHOW_NOTE =
  "You may use the effect of a Supporter card you find there as the effect of this attack.";

export function ownDevolveNote(op: OpOf<"devolveChosen">): string {
  const typed = op.pokemonType === undefined ? "" : `${op.pokemonType} `;
  return `Devolve which of your evolved ${typed}Pokémon? Its Evolution cards go into your hand, and it can't evolve this turn.`;
}

export function devolveChosenNote(seat: Seat, candidates: readonly PokemonRef[]): string {
  const ownSide = candidates.length > 0 && candidates.every((ref) => ref.seat === seat);
  const owner = ownSide ? "your" : "your opponent's";
  return (
    `Devolve 1 of ${owner} evolved Pokémon by putting the highest Stage Evolution ` +
    `card on it into ${owner} hand.`
  );
}

/** The `returnBenched` pick prompt, in the printed card's own words minus its
    anaphora — the `retrieveNoun` rule (one phrasing per printed shape, never a
    guessed one). The DESTINATION picks the verb because the printings do:
    nothing in this pool "shuffles" into a hand or "puts" into a deck. */
export function returnBenchedNote(op: OpOf<"returnBenched">): string {
  // Reversing Gust: Active included.
  if (op.whose === "opponent" && op.includeActive === true) {
    return "Shuffle which of your opponent's Pokémon and all attached cards into their deck?";
  }
  if (op.whose === "opponent") {
    return "Shuffle which of your opponent's Benched Pokémon into their deck?";
  }
  // Scoop Up Cyclone: Active included.
  if (op.includeActive === true)
    return "Put which of your Pokémon and all attached cards into your hand?";
  return op.dest === "deck"
    ? "Shuffle which of your Benched Pokémon into your deck?"
    : "Put which of your Benched Pokémon into your hand?";
}

/** Prompt for `returnBenchedRest`: names the bodies that stay. Uses the printed number. */
export function returnBenchedRestNote(op: OpOf<"returnBenchedRest">): string {
  return `Choose ${op.keep} of your opponent's Benched Pokémon to leave in play.`;
}

/**
 * Prompt for `returnBenchedChosen`. Uses the prompt's `min`/`max` rather than `op.count` so the
 * caption matches what the dialog accepts on a clamped Bench.
 */
export function returnBenchedChosenNote(count: number): string {
  return `Choose ${count} of your opponent's Benched Pokémon to shuffle into their deck.`;
}

/** The pick prompt's printed sentence — the whole clause, since the op IS the
    whole clause (the payFromHandNote rule). Grown one printed form per card
    (the retrieveNoun rule): bare = Ortega's, `supporter` = Greavard's. An
    unphrased future filter gets the bare form's structure with no guessed
    noun — "a card" is never a lie, merely less than the card prints. */
export function bottomFromOpponentHandNote(op: OpOf<"bottomFromOpponentHand">): string {
  // Check the destination before the filter, since it changes the verb.
  if (op.dest === "bench") {
    // One printed form per card, so the caption matches the card text: Lickitung's "up to" and
    // Lillie's Ribombee's "any number" are separate sentences.
    if (op.upTo === "any") {
      return `Your opponent reveals their hand, and you put any number of ${retrieveNoun(op.filter ?? { kind: "anyCard" }).plural} you find there onto their Bench.`;
    }
    if (op.upTo !== undefined) {
      return `Your opponent reveals their hand. Put up to ${op.upTo} ${retrieveNoun(op.filter ?? { kind: "anyCard" }).plural} you find there onto your opponent's Bench.`;
    }
    return `Your opponent reveals their hand, and you put ${retrieveNoun(op.filter ?? { kind: "anyCard" }).singular} you find there onto your opponent's Bench.`;
  }
  // Discard destination, checked before the filter. Eri's "up to" form is a separate, narrower
  // branch.
  if (op.dest === "discard" && typeof op.upTo === "number") {
    return `Your opponent reveals their hand, and you discard up to ${op.upTo} ${retrieveNoun(op.filter ?? { kind: "anyCard" }).plural} you find there.`;
  }
  if (op.dest === "discard") {
    return "Your opponent reveals their hand. Discard a card you find there.";
  }
  // Watchog "Snap Inspection"'s per-heads clause.
  if (op.dest === "deck") {
    return "Your opponent reveals their hand. Choose a card you find there and shuffle it into your opponent's deck.";
  }
  if (op.filter?.kind === "supporter") {
    return "Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck.";
  }
  // Energy Swatter: "an Energy card" in place of "a card".
  if (op.filter?.kind === "anyEnergy") {
    return "Your opponent reveals their hand, and you choose an Energy card you find there and put it on the bottom of their deck.";
  }
  return "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.";
}

/** The mayDraw prompt speaks to its ANSWERER — the opponent of the seat that
    played the card — so the printed "your opponent may draw a card" turns
    around into the second person, the way it is said across a table. */
export function mayDrawNote(op: OpOf<"opponentMayDraw">): string {
  return op.count === 1 ? "You may draw a card." : `You may draw ${op.count} cards.`;
}

/**
 * Caption for the opponent-chooses hand discard, in the answerer's voice rather than the printed
 * sentence, since the reader is the opponent. The printed count is safe because the op only parks
 * when the hand exceeds it.
 */
export function opponentDiscardNote(op: OpOf<"opponentDiscardsFromHand">): string {
  // Xerosic's Machinations, phrased for the player holding the hand.
  if (op.untilHandSize !== undefined) {
    return `Discard cards from your hand until you have ${op.untilHandSize} cards in your hand.`;
  }
  // The caption follows the destination: the deck arm says shuffle, not discard.
  if (op.to === "deck") {
    return op.count === 1
      ? "Shuffle a card from your hand into your deck."
      : `Shuffle ${op.count} cards from your hand into your deck.`;
  }
  return op.count === 1
    ? "Discard a card from your hand."
    : `Discard ${op.count} cards from your hand.`;
}

/** How a hand cost reads as a printed noun phrase — "2 other cards", "another
    card", "an Energy card", "a Basic Grass Energy card". `other` spells the word
    the TRAINERS carry and the Abilities do not, which is not a stylistic split:
    a Trainer is in the very hand it pays out of, an Ability's card is on the
    board (see effects.ts). Shared by the prompt heading (`other: false` — by then
    the played card has already left the hand, so every offered card IS another
    one) and by both rejection messages (`other` as printed). */
export function handCostPhrase(op: OpOf<"payFromHand">, other: boolean): string {
  const { singular, plural } =
    op.filter === undefined ? { singular: "a card", plural: "cards" } : retrieveNoun(op.filter);
  // The declinable arm's caption prints its ceiling, always plural; Naveen's uncapped arm prints
  // "any number of cards".
  if (op.count === "any" && op.cap === "any")
    return `any number of ${other ? "other " : ""}${plural}`;
  if (op.count === "any") return `up to ${op.cap} ${other ? "other " : ""}${plural}`;
  if (op.count > 1) return `${op.count} ${other ? "other " : ""}${plural}`;
  // "a card" → "another card"; no printed card pairs `other` with a filter, but
  // the article strip keeps it reading correctly if one ever does.
  return other ? `another ${singular.replace(/^an? /, "")}` : singular;
}

/** The whole printed cost clause — the noun phrase above under the VERB its
    destination prints: "discard 2 other cards from your hand" (Ultra Ball) /
    "put another card from your hand on the bottom of your deck" (Dendra). One
    string for the three readers that must agree on the wording: the park's
    heading, both rejection messages (cardplay.ts) and the HUD's disabled-card
    hint. Lower-case and verb-first, so a caller can say "can only be used if you
    …", "Only if you …" or capitalize it into a sentence of its own. */
export function handCostAction(op: OpOf<"payFromHand">, other: boolean): string {
  const phrase = handCostPhrase(op, other);
  // Evidence Gathering's printed verb, ahead of the plain top-of-deck payment.
  if (op.swapWithTop === true)
    return `switch ${phrase} from your hand with the top card of your deck`;
  // Academy at Night's "on top of their deck" and Perrin's "put them into your deck" use their own
  // printed verbs.
  if (op.to === "deckTop") return `put ${phrase} from your hand on top of your deck`;
  if (op.count === "any" && op.to === "deckBottom") {
    return `reveal ${phrase} in your hand and put them into your deck`;
  }
  return op.to === "deckBottom"
    ? `put ${phrase} from your hand on the bottom of your deck`
    : `discard ${phrase} from your hand`;
}

/** The park's heading — the cost clause as an instruction ("Discard a card from
    your hand." / "Put a card from your hand on the bottom of your deck."). The
    played Trainer has already left the hand by the time this is asked, so every
    offered card IS another one and the printed "other" is not repeated here. */
export function payFromHandNote(op: OpOf<"payFromHand">): string {
  const action = handCostAction(op, false);
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}.`;
}

/** The printed noun for `knockOutChosen` candidates, matching the set offered. */
export function knockOutChosenNote(op: OpOf<"knockOutChosen">): string {
  // Bring Down's own sentence.
  if (op.target === "anyExceptSelf") {
    return "Choose a Pokémon in play (yours or your opponent's) that has the least HP remaining, except for this Pokémon, and it is Knocked Out.";
  }
  const scope = op.target === "opponentBench" ? "Benched " : "";
  const stage = op.basicOnly === true ? "Basic " : "";
  // The window rides AFTER the noun because that is where the print puts it, and
  // the counter word is pluralised rather than hard-coded: the anchor captures the
  // number, so a printing at 1 must not read "1 damage counters".
  const window =
    op.damageCountersExactly === undefined
      ? ""
      : ` that has exactly ${op.damageCountersExactly} damage counter${
          op.damageCountersExactly === 1 ? "" : "s"
        } on it`;
  return `Knock Out 1 of your opponent's ${scope}${stage}Pokémon${window}.`;
}

/** The printed noun for `gust` candidates, matching the set `gustTargets` offers. */
export function gustTargetNoun(op: OpOf<"gust">): string {
  const stage = op.basicOnly === true ? "Basic " : "";
  // The remaining-HP window goes after the noun, as printed.
  const window =
    op.remainingHpAtMost === undefined
      ? ""
      : ` that has ${op.remainingHpAtMost} HP or less remaining`;
  return `Gust up which of the opponent's Benched ${stage}Pokémon${window}?`;
}

/** The printed noun for `healChosen` candidates, matching the set `healChosenTargets` offers. */
export function healTargetNoun(op: OpOf<"healChosen">): string {
  const zoneWord = op.zone === "bench" ? "Benched " : "";
  const window =
    op.remainingHpAtMost === undefined
      ? ""
      : ` that has ${op.remainingHpAtMost} HP or less remaining`;
  // The filter's plural noun, or "Pokémon".
  const noun = op.filter === undefined ? "Pokémon" : retrieveNoun(op.filter).plural;
  // `recoverHealed` (Pokémon Center Lady): the pick also decides whether conditions clear.
  const rider = op.recoverHealed === true ? " It also recovers from all Special Conditions." : "";
  // `energyToHandFromHealed` (Wally's Compassion): the pick also decides whose Energy moves.
  const toHand =
    op.energyToHandFromHealed === true
      ? " If it heals any damage, all its Energy goes into your hand."
      : "";
  return `Heal which of your ${zoneWord}${noun}${window}?${rider}${toHand}`;
}

/** The card question's caption, naming the body the cards go onto. */
export function energyPickNote(state: GameState, ref: PokemonRef, take: number): string {
  const body = refPokemon(state, ref);
  const top = body === undefined ? undefined : topUid(body);
  const name = top === undefined ? undefined : cardOfUid(state, top)?.name;
  const what =
    take === 1
      ? "Which Energy card do you want to attach"
      : `Which ${take} Energy cards do you want to attach`;
  return name === undefined ? `${what}?` : `${what} to ${name}?`;
}

/**
 * The `discardTools` prompt string, reproducing the printed sentence. The number is the printed
 * ceiling, not the board-clamped one; the clamp lives on `scope.max`.
 */
export function toolDiscardNote(op: OpOf<"discardTools">): string {
  // Tool Scrapper's printed sentence when the offer spans both boards. `"all"` never parks; the
  // branch exists for totality.
  const count = op.count === "all" ? "all" : `up to ${op.count}`;
  if (op.sides === "both") {
    return `Choose ${count} Pokémon Tools attached to Pokémon (yours or your opponent's) and discard them.`;
  }
  return `Discard ${count} Pokémon Tools from your opponent's Pokémon.`;
}

/**
 * `searchDeckOrElse`'s caption, keeping the printed "or". Both nouns use the plural column with the
 * printed digit.
 */
export function searchOrElseNote(
  filter: CardFilter,
  max: number,
  alternative: { filter: CardFilter; max: number },
  dest: OpOf<"searchDeck">["dest"],
): string {
  return `Search your deck for up to ${max} ${retrieveNoun(filter).plural} or ${alternative.max} ${
    retrieveNoun(alternative.filter).plural
  } ${SEARCH_DEST_PHRASE[dest]}.`;
}

/**
 * A deck search's place phrase, keyed as a total record on `dest`. Prints "your deck" rather than
 * the card's "it", since a heading has no antecedent.
 */
const SEARCH_DEST_PHRASE: Record<OpOf<"searchDeck">["dest"], string> = {
  bench: "onto your Bench",
  hand: "into your hand",
  deckTop: "on top of your deck",
  discard: "and discard them",
  attachToSelf: "and attach it to this Pokémon",
};

/**
 * The chooseCards note for a deck search: "Search your deck for [up to N] {noun} [onto your Bench |
 * into your hand]", with nouns from the shared `retrieveNoun` table.
 */
export function searchNote(
  /**
   * The printed group maxes, not the resolved ones, so a quantifier with no digit ("any number",
   * "up to the number of your Benched Pokémon") is captioned in the card's words. The clamped total
   * is a separate parameter.
   */
  groups: readonly { filter: CardFilter; max: SearchDeckMax }[],
  max: number,
  op: Pick<
    OpOf<"searchDeck">,
    | "dest"
    | "exact"
    | "distinctEnergyTypes"
    | "typedAsAttachedBasicEnergy"
    | "sameNameAsOpponentInPlay"
  >,
): string {
  const where = SEARCH_DEST_PHRASE[op.dest];
  // `exact` drops "up to" so the caption matches a Confirm button that refuses fewer.
  const exact = op.exact === true;
  // "Of different types" lets the player see why a duplicate type is refused.
  const distinctEnergyTypes = op.distinctEnergyTypes === true;
  // These two quote the printed rule, not the resolved types or names: Love Ball's on the singular
  // noun, the typed-as-attached one on the plural only.
  const typedAsAttachedBasicEnergy = op.typedAsAttachedBasicEnergy === true;
  const sameNameAsOpponentInPlay = op.sameNameAsOpponentInPlay === true;
  // Reads the clamped `max`, so a bench search cut by `benchSpace` captions the number the dialog
  // accepts.
  const first = groups[0];
  if (first === undefined) return `Search your deck ${where}.`;
  if (groups.length === 1) {
    const { singular: printedSingular, plural: printedPlural } = retrieveNoun(first.filter);
    const singular = sameNameAsOpponentInPlay
      ? `${printedSingular} with the same name as 1 of your opponent's Pokémon in play`
      : printedSingular;
    // "That are the same type as any Basic Energy attached to this Pokémon", on the plural noun
    // only, using the printed group's noun rather than the resolved types.
    const plural = typedAsAttachedBasicEnergy
      ? `${printedPlural} that are the same type as any Basic Energy attached to this Pokémon`
      : printedPlural;
    // "Of different types" rides only the plural noun: the constraint is vacuous for a one-card
    // take.
    const many = distinctEnergyTypes ? `${plural} of different types` : plural;
    // Printed quantifiers with no digit ("any number of", "up to the number of your Benched
    // Pokémon") are captioned in words; printing the clamped number would also leak the hidden deck
    // size.
    if (first.max === "yourBenchCount")
      return `Search your deck for a number of ${many} up to the number of your Benched Pokémon ${where}.`;
    if (first.max === "any") return `Search your deck for any number of ${many} ${where}.`;
    // An exact take drops "up to" and keeps the number.
    if (exact)
      return max > 1
        ? `Search your deck for ${max} ${many} ${where}.`
        : `Search your deck for ${singular} ${where}.`;
    return max > 1
      ? `Search your deck for up to ${max} ${many} ${where}.`
      : `Search your deck for ${singular} ${where}.`;
  }
  // Multiple groups join as a serial list with the printed Oxford comma; two nouns join with a bare
  // "and". Each group keeps its own number; the flat `max` is the sum and is deliberately not used.
  // The quantifier words are spelled for hand-authored registry ops.
  const phrase = (g: { filter: CardFilter; max: SearchDeckMax }) => {
    const { singular, plural } = retrieveNoun(g.filter);
    return g.max === "yourBenchCount"
      ? `a number of ${plural} up to the number of your Benched Pokémon`
      : g.max === "any"
        ? `any number of ${plural}`
        : g.max > 1
          ? `up to ${g.max} ${plural}`
          : singular;
  };
  const parts = groups.map(phrase);
  const last = parts[parts.length - 1] ?? "";
  const head = parts.slice(0, -1);
  const what = head.length === 1 ? `${head[0]} and ${last}` : `${head.join(", ")}, and ${last}`;
  return `Search your deck for ${what} ${where}.`;
}

/**
 * The chooseCards note for a discard-pile retrieval, reproducing the printed verb ("Put" /
 * "Shuffle") and noun. Nouns are spelled per kind so "Pokémon" stays invariant. `excluded`
 * reproduces Superior Energy Retrieval's parenthetical, since the cards just paid are visible in
 * the discard pile but not offered.
 */
export function retrieveNote(
  filter: CardFilter,
  dest: "hand" | "deck" | "bench",
  max: number,
  excluded: boolean,
): string {
  const { singular, plural } = retrieveNoun(filter);
  // A Bench destination uses "Put" like the hand; only the deck destination uses "Shuffle".
  const verb = dest === "deck" ? "Shuffle" : "Put";
  const where =
    dest === "hand" ? "into your hand" : dest === "bench" ? "onto your Bench" : "into your deck";
  const note =
    max > 1
      ? `${verb} up to ${max} ${plural} from your discard pile ${where}.`
      : `${verb} ${singular} from your discard pile ${where}.`;
  return excluded
    ? `${note} (You can't choose a card you discarded with the effect of this card.)`
    : note;
}

/**
 * The `orderCards` caption, naming whose deck it is. The printed window size is not spelled since a
 * short deck offers fewer cards. The bottom fork (Kofu) says "on the bottom of your deck" rather
 * than "back", since those cards came from the hand. There is no opponent-bottom caption because no
 * card prints it.
 */
export function reorderNote(op: OpOf<"reorderTop">): string {
  // One card is not "these cards … in any order": a one-card window parks only when a printed
  // alternative exists (Inkay), so the caption names the two answers. Checked before `side`.
  if (op.n === 1) {
    return op.side === "opponent"
      ? "Look at the top card of your opponent's deck — put it back, or have your opponent shuffle their deck."
      : "Look at the top card of your deck — put it back on top.";
  }
  if (op.side === "opponent") {
    return "Put these cards back on top of your opponent's deck in any order.";
  }
  return op.from === "bottom"
    ? "Put these cards on the bottom of your deck in any order."
    : "Put these cards back on top of your deck in any order.";
}

/**
 * The chooseCards note for a lookAtTopN (Great Ball, Pokégear 3.0): "Look at the top N cards … and
 * put a {noun} into your hand." `also` joins with the printed "and" rather than `anyOf`'s "or",
 * each half keeping its own number. `exact` drops "up to" and nothing else.
 */
export function lookNote(
  filter: CardFilter,
  n: number,
  max: number | "any",
  dest?: "bench" | "discard",
  also?: { filter: CardFilter; max: number },
  exact = false,
  /** Dusk Ball's "Look at the bottom 7 cards"; absent is the top. */
  from?: "bottom",
  /** Accompanying Flute's "your opponent's deck" / "their Bench". */
  whose?: "opponent",
): string {
  const { singular, plural } = retrieveNoun(filter);
  // The destination is the prompt's, so the caption matches where the answer actually goes.
  const where =
    dest === "bench"
      ? whose === "opponent"
        ? "onto their Bench"
        : "onto your Bench"
      : dest === "discard"
        ? "in the discard pile"
        : "into your hand";
  // `"any"` is captioned as the card's "any number of", never the resolved number. `exact` is per
  // group because it describes only the first group's sentence.
  const phrase = (
    m: number | "any",
    noun: { singular: string; plural: string },
    isExact: boolean,
  ) =>
    m === "any"
      ? `any number of ${noun.plural}`
      : m > 1
        ? `${isExact ? "" : "up to "}${m} ${noun.plural}`
        : noun.singular;
  const first = phrase(max, { singular, plural }, exact);
  const what =
    also === undefined
      ? first
      : `${first} and ${phrase(also.max, retrieveNoun(also.filter), false)}`;
  return `Look at the ${from === "bottom" ? "bottom" : "top"} ${n} cards of ${whose === "opponent" ? "your opponent's" : "your"} deck and put ${what} ${where}.`;
}

/**
 * The printed noun phrase for an attach's eligible targets ("your Benched {L} Pokémon"), built from
 * the same riders as the candidate set so the caption never names a wider set than the rows. Word
 * order follows the print. `basicOnly` and `notIfKO` are deliberately not spelled.
 */
export function attachTargetNoun(riders: AttachTargetRiders): string {
  const printedZone = riders.benchOnly === true ? "Benched " : "";
  // The printed "their Pokémon" (Grafaiai): the caption names the opponent's board so it matches
  // the offered rows.
  const zone = riders.whose === "opponent" ? `opponent's ${printedZone}` : printedZone;
  // The banner word goes where the owner prefix does ("your Tera Pokémon"); no printing has both.
  const owner =
    riders.targetBanner === undefined ? ownerNoun(riders.ownerPokemon) : `${riders.targetBanner} `;
  const types = targetTypeNames(riders.targetType);
  // The printed stage word ("1 of your Stage 2 Pokémon", Rosa's Encouragement); no printing pairs
  // it with a type or owner.
  if (riders.stage2Only === true) return `${zone}Stage 2 Pokémon`;
  // No type: the bare noun.
  if (types.length === 0) return `${zone}${owner}Pokémon`;
  // Multiple types repeat the noun as the card does ("your {P} Pokémon and {M} Pokémon").
  return types.map((type) => `${zone}${type} ${owner}Pokémon`).join(" and ");
}

/**
 * The printed possessive of an owner-prefixed subgroup (`"Team Rocket"` → `"Team Rocket's "`,
 * absent → `""`). The trailing "'s " is load-bearing: without it the caption names a subgroup no
 * card prints.
 */
export function ownerNoun(owner: string | undefined): string {
  return owner === undefined ? "" : `${owner}'s `;
}

/**
 * The printed noun for a `switchActive`'s eligible bench targets; it must name exactly the set
 * `switchActiveTargets` offers. An unmarked op reads "Benched Pokémon".
 */
export function switchTargetNoun(op: OpOf<"switchActive">): string {
  const type = op.targetType === undefined ? "" : `${op.targetType} `;
  const except = op.exceptNamed === undefined ? "" : `, except any ${op.exceptNamed}`;
  return `Benched ${type}${ownerNoun(op.ownerPokemon)}Pokémon${except}`;
}

/**
 * The attachCards prompt string (Electric Generator, Hydreigon "Tri Howl"), built from the op. "You
 * find there" tells the player the rows are the window, and "in any way you like" signals that
 * several Energy may go on one Pokémon.
 */
export function attachNote(op: OpOf<"attachFromTop">): string {
  const { plural } = retrieveNoun(op.filter);
  const how = op.max === "any" ? "any number of" : `up to ${op.max}`;
  const where = attachTargetNoun(op);
  return `Look at the top ${op.n} cards of your deck and attach ${how} ${plural} you find there to your ${where} in any way you like.`;
}

/**
 * The attachCards prompt for a deck search (Charizard ex "Infernal Reign", Janine's Secret Art),
 * built from the op. `toSelf` prints "attach it to this Pokémon". Without `maxPerTarget` the
 * caption says "in any way you like" (several Energy may go on one Pokémon, §15.E); with it, that
 * phrase would contradict the validator, so Janine's "for each of those Pokémon" is used.
 */
export function attachFromDeckNote(op: OpOf<"attachFromDeck">): string {
  const { singular, plural } = retrieveNoun(op.filter);
  if (op.toSelf === true) {
    return op.max > 1
      ? `Search your deck for up to ${op.max} ${plural} and attach them to this Pokémon.`
      : `Search your deck for ${singular} and attach it to this Pokémon.`;
  }
  const where = attachTargetNoun(op);
  // Overflowing Wishes' per-body sentence; its shuffle is left to the next op.
  if (op.each === true) {
    return `For each of your ${where}, search your deck for ${singular} and attach it to that Pokémon.`;
  }
  if (op.maxPerTarget !== undefined) {
    // "attach 1 to each", not "attach a Basic Darkness Energy card to each" —
    // the noun is already in the first clause, and repeating it there produced a
    // sentence long enough that the per-target rule stopped being the thing the
    // reader noticed, which is the one thing this branch exists to say.
    const each = op.maxPerTarget === 1 ? "1" : `up to ${op.maxPerTarget}`;
    return `Search your deck for up to ${op.max} ${plural} and attach ${each} to each of up to ${op.max} of your ${where}.`;
  }
  // "attach them to 1 of your Pokémon": "in any way you like" would contradict a validator that
  // refuses a second body. There is no `max === 1` branch because the op omits the rider there.
  if (op.oneTarget === true) {
    return `Search your deck for up to ${op.max} ${plural} and attach them to 1 of your ${where}.`;
  }
  // "of different types" (Prism Charge) rides the plural noun.
  const many = op.distinctEnergyTypes === true ? `${plural} of different types` : plural;
  return op.max > 1
    ? `Search your deck for up to ${op.max} ${many} and attach them to your ${where} in any way you like.`
    : `Search your deck for ${singular} and attach it to your ${where}.`;
}

/** Glass Trumpet's caption: the printed sentence with the brace code written out. */
export function attachFromDiscardNote(op: OpOf<"attachFromDiscard">, ceiling: number): string {
  const { singular, plural } = retrieveNoun(op.filter);
  // Tail Generator's printed sentence, with the resolved ceiling.
  if (op.max === "opponentEnergyInPlay") {
    return `Choose up to ${ceiling} ${plural} from your discard pile (the amount of Energy attached to all of your opponent's Pokémon) and attach them to your ${attachTargetNoun(op)} in any way you like.`;
  }
  return `Choose up to ${op.max} of your ${attachTargetNoun(op)} and attach ${singular} from your discard pile to each of them.`;
}

/**
 * Reboot Pod's caption. Any body left without a card is topped up at apply time
 * (`eachAttachTopUp`).
 */
export function attachEachFromDiscardNote(op: OpOf<"attachFromDiscard">): string {
  const { singular } = retrieveNoun(op.filter);
  return `Attach ${singular} from your discard pile to each of your ${attachTargetNoun(op)}.`;
}

/**
 * The attachCards prompt for a hand attach (Alolan Exeggutor ex "Tropical Frenzy"). "from your
 * hand" distinguishes it from a deck window, and "in any way you like" signals every card may go on
 * one Pokémon (§15.E). There is no "up to N" because the op carries no `max`; the printed "You may"
 * is dropped because the prompt itself is the offer.
 */
export function attachFromHandNote(op: OpOf<"attachFromHand">): string {
  // The printed "to this Pokémon": a single target row cannot convey that the destination is not a
  // choice, and "in any way you like" would describe a split the validator cannot produce.
  if (op.toSelf === true) {
    return `Attach any number of ${retrieveNoun(op.filter).plural} from your hand to this Pokémon.`;
  }
  // Lethargic Charge's singular sentence; `attachTargetNoun` has no Active word, so the zone is
  // spelled here.
  if (op.one === true) {
    return `Attach ${retrieveNoun(op.filter).singular} from your hand to your ${op.activeOnly === true ? "Active " : ""}${ownerNoun(op.ownerPokemon)}Pokémon.`;
  }
  // Pleasing Present's "up to N", addressed to whichever player answers it.
  if (op.max !== undefined) {
    return `Attach up to ${String(op.max)} ${retrieveNoun(op.filter).plural} from your hand to your ${attachTargetNoun({})} in any way you like.`;
  }
  return `Attach any number of ${retrieveNoun(op.filter).plural} from your hand to your ${attachTargetNoun({})} in any way you like.`;
}

/**
 * The moveEnergy prompt (Energy Switch / Poppy): "Move [up to N] {noun} from [1 of] your Pokémon to
 * another of your Pokémon". The "1 of" comes from `anySource`.
 */
export function moveNote(op: OpOf<"moveEnergy">): string {
  const noun = energyNoun(op.filter);
  // "1 of" marks single-source coupling: every coupled printing says "from 1 of your …", while N's
  // Plan says "from your Benched Pokémon".
  const one = op.anySource === true ? "" : "1 of ";
  // The opponent-board sentences share no clause with the own-board ones, so they override the
  // chain below rather than joining it.
  let where =
    op.route === "benchToActive"
      ? `from ${one}your Benched Pokémon to your Active Pokémon`
      : op.route === "koedActiveToToolHolder"
        ? // Exp. Share's printed second half; the prompt is the only thing naming this card to the player, since a Tool emits no ABILITY_TRIGGERED row.
          "from that Pokémon to the Pokémon this card is attached to"
        : op.route === "selfToBench"
          ? // The printed second half. This route has one source by construction (the attacker), so the "1 of" sits on the destination; `anyDest` replaces exactly the destination clause, as Kilowattrel's print does.
            op.anyDest === true
            ? "from this Pokémon to your Benched Pokémon in any way you like"
            : "from this Pokémon to 1 of your Benched Pokémon"
          : op.route === "othersToSelf"
            ? // Iron Leaves ex's printed second half; this route is always `anySource`, so `one` is empty.
              `from ${one}your other Pokémon to this Pokémon`
            : // The free route's destination clause: `anyDest` is "to your other Pokémon in any way you like", otherwise Energy Switch's "to another of your Pokémon".
              op.anyDest === true
              ? `from ${one}your Pokémon to your other Pokémon in any way you like`
              : `from ${one}your Pokémon to another of your Pokémon`;
  // Opponent-board sentences. `selfToBench` names its source by the spot, so it takes no article.
  // The printed "You may" is dropped as elsewhere; it is not a claim that `moveFloor` honours
  // declining.
  if (op.side === "opponent") {
    where =
      op.route === "selfToBench"
        ? "from your opponent's Active Pokémon to 1 of their Benched Pokémon"
        : `from ${one}your opponent's Pokémon to another of their Pokémon`;
  }
  // A record-pinned destination: the park carries exactly one destination (the body the search just
  // benched), so the inherited "to 1 of your Benched Pokémon" would promise a choice that is not
  // offered. It wins over the `side` override, which is unreachable here because the record is
  // filed by the controller's own ops.
  if (op.destRecorded !== undefined) where = "from this Pokémon to the new Benched Pokémon";
  // Scramble Switch's printed endpoints.
  if (op.sourceRecorded !== undefined) {
    where = "from the Pokémon you moved to your Bench to the new Active Pokémon";
  }
  // "an Energy", "a Basic Energy", "a Fire Energy" — the article follows the noun,
  // the same rule discardNote applies. Unreachable at max 1 today (the only
  // `anyEnergy` mover is Poppy at max 2, which takes the "up to" branch), which is
  // precisely why it read "Move a Energy" unnoticed.
  const article = noun === "Energy" ? "an" : "a";
  // "any amount" is spelled rather than resolved to the clamp, so the caption does not show a
  // number the card does not print.
  if (op.max === "any") return `Move any amount of ${noun} ${where}.`;
  // Castform's printed "all" is spelled for the same reason; the pick cannot be shortened.
  if (op.max === "all") return `Move all ${noun} ${where}.`;
  return op.max > 1
    ? `Move up to ${op.max} ${noun} ${where}.`
    : `Move ${article} ${noun} ${where}.`;
}

/**
 * How a filter's Energy reads inside a prompt sentence; unspelled filters read "Energy". A typed
 * one reads as its full type name ("a Fire Energy"), not the brace code, so the heading matches the
 * card names the player clicks.
 */
function energyNoun(filter: CardFilter): string {
  if (filter.kind === "specialEnergy") return "Special Energy";
  if (filter.kind === "providesEnergy") return `${filter.energyType} Energy`;
  // `basicEnergy` must read "Basic Energy"; falling through to the wider "Energy" would misdescribe
  // the pick.
  if (filter.kind === "basicEnergy") {
    return filter.energyType === undefined ? "Basic Energy" : `Basic ${filter.energyType} Energy`;
  }
  return "Energy";
}

/** The discardEnergy prompt string — reproduced from the printed sentence, so
    the dialog's heading IS the card's own instruction (Crushing Hammer "…from 1
    of your opponent's Pokémon", Giacomo "…from each of…", Mawile "…from your
    opponent's Active Pokémon", Corviknight "Discard 2 Energy from this Pokémon").
    Only the two filters those cards use are spelled; any other reads as the
    generic "an Energy". `count: "all"` never reaches here — that arm asks
    nothing, so it has no prompt to caption. */
export function discardNote(op: OpOf<"discardEnergy">): string {
  const noun = energyNoun(op.filter);
  // A numeric count is printed as the bare number ("Discard 2 Energy…"), one as
  // the article ("Discard an Energy…"), and `"any"` as the printed "any amount
  // of" (Chien-Pao ex "Hail Blade") — or "up to N" when it carries a cap (Mewtwo
  // VSTAR "Psy Purge": "Discard up to 3 Psychic Energy…").
  const what =
    op.count === "any"
      ? op.cap !== undefined
        ? `up to ${op.cap} ${noun}`
        : `any amount of ${noun}`
      : typeof op.count === "number" && op.count > 1
        ? `${op.count} ${noun}`
        : `${noun === "Energy" ? "an" : "a"} ${noun}`;
  // The caption names the destination, because that is the consequence of the pick ("Discard an
  // Energy…" versus "Put an Energy… into their hand").
  const putBack = op.to === "hand";
  // The deck and hand destinations each have their own caption flag, read by the arms that can
  // reach them.
  const shuffleBack = op.to === "deck";
  switch (op.from) {
    case "opponentActive":
      return putBack
        ? `Put ${what} attached to your opponent's Active Pokémon into their hand.`
        : `Discard ${what} from your opponent's Active Pokémon.`;
    case "opponentChosen":
      return putBack
        ? `Put ${what} attached to 1 of your opponent's Pokémon into their hand.`
        : `Discard ${what} from 1 of your opponent's Pokémon.`;
    case "attacker":
      // The printed noun (Shell Spikes, Counterattacking Pincer).
      return `Discard ${what} from the Attacking Pokémon.`;
    case "opponentEach":
      return `Discard ${what} from each of your opponent's Pokémon.`;
    case "yourActive":
      // The printed attack sentence; "this Pokémon" is the Active (§8). The hand and deck arms use
      // the printed verbs ("Put … into your hand", "shuffle … into your deck") so the caption
      // matches where the card goes.
      return putBack
        ? `Put ${what} attached to this Pokémon into your hand.`
        : shuffleBack
          ? `Shuffle ${what} attached to this Pokémon into your deck.`
          : `Discard ${what} from this Pokémon.`;
    case "self":
      // Same printed words for the same subject; the members differ only in how they resolve it (a
      // spot versus a uid). For Super Potion the engine-written `bodyUid` is the healed body, not
      // the card running.
      if (op.bodyUid !== undefined) return `Discard ${what} from that Pokémon.`;
      return `Discard ${what} from this Pokémon.`;
    case "yours":
      // The printed "from your Pokémon" — the whole own board (Hail Blade).
      return `Discard ${what} from your Pokémon.`;
    case "yourBench":
      // The printed "from your Benched Pokémon"; the `what` half already carries the ceiling, and
      // "You may" is dropped.
      return `Discard ${what} from your Benched Pokémon.`;
  }
}

/**
 * The noun phrase (singular / plural) each filter reads as in a retrieval note. Exported within the
 * module so log.ts renders nouns through this switch.
 */
export function retrieveNoun(filter: CardFilter): { singular: string; plural: string } {
  switch (filter.kind) {
    case "anyPokemon":
      // The printed "Pokémon that don't have a Rule Box" (Lana's Aid); the singular uses "doesn't".
      return filter.noRuleBox === true
        ? {
            singular: "a Pokémon that doesn't have a Rule Box",
            plural: "Pokémon that don't have a Rule Box",
          }
        : { singular: "a Pokémon", plural: "Pokémon" };
    case "supporter":
      return { singular: "a Supporter card", plural: "Supporter cards" };
    case "supporterNameContaining":
      // The printed "Supporter card that has "Team Rocket" in its name". The quotation marks are
      // printed; dropping them would read as a whole card name. The plural changes both verb and
      // possessive.
      return {
        singular: `a Supporter card that has "${filter.fragment}" in its name`,
        plural: `Supporter cards that have "${filter.fragment}" in their names`,
      };
    case "toolNameContaining":
      // TM Machine's noun; the plural is the print's "in their name", not "names".
      return {
        singular: `a Pokémon Tool card that has "${filter.fragment}" in its name`,
        plural: `Pokémon Tool cards that have "${filter.fragment}" in their name`,
      };
    case "itemNameContaining":
      // Fossil Quarry's noun ("Item cards that have "Antique" in their name").
      return {
        singular: `an Item card that has "${filter.fragment}" in its name`,
        plural: `Item cards that have "${filter.fragment}" in their name`,
      };
    case "item":
      // "an Item card" / "Item cards": spelled per kind because the article varies.
      return { singular: "an Item card", plural: "Item cards" };
    case "stadium":
      return { singular: "a Stadium card", plural: "Stadium cards" };
    case "trainerCard":
      // This phrase is also the filter's row in effects.ts `HAND_SEARCH_NOUNS`, whose strings must
      // equal this function's output.
      return { singular: "a Trainer card", plural: "Trainer cards" };
    case "anyCard":
      // The uncategorised noun, matching `handCostPhrase` for a filterless cost.
      return { singular: "a card", plural: "cards" };
    case "pokemonOrBasicEnergy":
      return {
        singular: "a Pokémon or Basic Energy card",
        plural: "Pokémon or Basic Energy cards",
      };
    case "anyEnergy":
      return { singular: "an Energy card", plural: "Energy cards" };
    case "pokemonWithResistance":
      // Fletchling "Chirp"'s noun, type written out, invariant in number.
      return {
        singular: `a Pokémon with ${filter.type} Resistance`,
        plural: `Pokémon with ${filter.type} Resistance`,
      };
    case "specialEnergy":
      return { singular: "a Special Energy card", plural: "Special Energy cards" };
    case "byName": {
      // A non-Pokémon name carries "cards" ("up to 2 Arven's Sandwich cards"); a Pokémon name
      // prints bare and invariant ("up to 3 Flamigo"). The singular article is computed from the
      // name ("an Ethan's Adventure card").
      const article = /^[AEIOU]/.test(filter.name) ? "an" : "a";
      return filter.cardNoun === true
        ? { singular: `${article} ${filter.name} card`, plural: `${filter.name} cards` }
        : { singular: filter.name, plural: filter.name };
    }
    case "basicPokemon":
      // The printed HP threshold ("a Basic Pokémon with 70 HP or less"); the number varies per
      // card. The `noRuleBox` and HP riders are tested in sequence because no printing combines
      // them.
      if (filter.maxHp !== undefined && filter.noRuleBox !== true)
        return {
          singular: `a Basic Pokémon with ${filter.maxHp} HP or less`,
          plural: `Basic Pokémon with ${filter.maxHp} HP or less`,
        };
      return filter.noRuleBox === true
        ? {
            singular: "a Basic Pokémon that doesn't have a Rule Box",
            plural: "Basic Pokémon that don't have a Rule Box",
          }
        : { singular: "a Basic Pokémon", plural: "Basic Pokémon" };
    case "evolutionPokemon":
      return { singular: "an Evolution Pokémon", plural: "Evolution Pokémon" };
    case "stagePokemon": {
      // The printed stage ordinal ("a Stage 1 Pokémon"), invariant in number; the article is always "a" because both stages spell "Stage".
      const ordinal = filter.stage === "Stage1" ? "Stage 1" : "Stage 2";
      return { singular: `a ${ordinal} Pokémon`, plural: `${ordinal} Pokémon` };
    }
    case "typedPokemon": {
      // The caption writes the type out instead of the printed brace code, so it matches the card
      // names the player clicks; that is why brace-coded nouns are not in `HAND_SEARCH_NOUNS`. The
      // stage word is the printed one ("Evolution {M} Pokémon"), and the HP threshold rides at the
      // end.
      const noun = `${filter.stage === undefined ? "" : filter.stage === "basic" ? "Basic " : "Evolution "}${filter.pokemonType} Pokémon${filter.maxHp === undefined ? "" : ` with ${filter.maxHp} HP or less`}`;
      // The article is always "a": no Pokémon type begins with a vowel (pinned by
      // `typedPokemonNounsTakeNoVowelArticle`).
      return { singular: `a ${noun}`, plural: noun };
    }
    case "ownerPokemon": {
      // The printed noun phrase, whole: "a Cynthia's Pokémon", "up to 2 Basic
      // Hop's Pokémon", "an Evolution Team Rocket's Pokémon". The stage word sits
      // INSIDE the phrase, before the owner, which is the concrete reason the
      // stage rides on this filter instead of composing with `basicPokemon`:
      // there is no way to build this string out of two independent nouns.
      const noun = `${filter.stage === undefined ? "" : filter.stage === "basic" ? "Basic " : "Evolution "}${filter.owner}'s Pokémon`;
      // "an Ethan's Pokémon" / "an Evolution …" — the printed article (Arven's
      // Pokéblock prints "is an Arven's Pokémon"). With a stage word the article
      // is decided by THAT word, not by the owner: "a Basic Ethan's Pokémon".
      const article = /^[AEIOU]/.test(noun) ? "an" : "a";
      return { singular: `${article} ${noun}`, plural: noun };
    }
    // The printed "Pokémon that has an Ability" (Team Rocket's Arbok); exists because the switch is
    // exhaustive over `CardFilter`.
    case "abilityPokemon":
      return { singular: "a Pokémon that has an Ability", plural: "Pokémon that have an Ability" };
    case "attackNamePokemon":
      // The printed "Pokémon … that has the Round attack", with the attack name interpolated; the
      // phrase always opens with "Pokémon", so the article is "a".
      return {
        singular: `a Pokémon that has the ${filter.attack} attack`,
        plural: `Pokémon that have the ${filter.attack} attack`,
      };
    case "pokemonNameContaining":
      // The printed "Pokémon … that has "Koffing" in its name". The quotation marks are printed;
      // the plural changes verb and possessive; the "or" is joined by the `anyOf` arm. `suffix`
      // rides the head noun as printed ("a Pokémon ex … that has "Ogerpon" in its name").
      if (filter.suffix !== undefined) {
        return {
          singular: `a Pokémon ${filter.suffix} that has "${filter.fragment}" in its name`,
          plural: `Pokémon ${filter.suffix} that have "${filter.fragment}" in their names`,
        };
      }
      return {
        singular: `a Pokémon that has "${filter.fragment}" in its name`,
        plural: `Pokémon that have "${filter.fragment}" in their names`,
      };
    case "megaEvolutionEx":
      // "a Mega Evolution Pokémon ex", invariant in number.
      return { singular: "a Mega Evolution Pokémon ex", plural: "Mega Evolution Pokémon ex" };
    case "bannerPokemon":
      // "a Tera Pokémon", invariant in number.
      return { singular: `a ${filter.banner} Pokémon`, plural: `${filter.banner} Pokémon` };
    case "bannerCard":
      // The article follows the banner's first letter ("an Ancient", "a Future").
      return {
        singular: `${filter.banner === "Ancient" ? "an" : "a"} ${filter.banner} card`,
        plural: `${filter.banner} cards`,
      };
    case "suffixPokemon":
      // The printed rule-box class ("a Pokémon ex"), invariant in number with article "a". The pair
      // "Pokémon ex and Pokémon V" is an `anyOf`, joined by that arm.
      return { singular: `a Pokémon ${filter.suffix}`, plural: `Pokémon ${filter.suffix}` };
    case "toolCard":
      return { singular: "a Pokémon Tool card", plural: "Pokémon Tool cards" };
    case "basicEnergy": {
      const kind = filter.energyType === undefined ? "Basic" : `Basic ${filter.energyType}`;
      return { singular: `a ${kind} Energy card`, plural: `${kind} Energy cards` };
    }
    case "anyOf": {
      // The combinator's caption joins its members' phrases with " or " where cards print "and",
      // deliberately: the predicate is a union, and "and" would read as a conjunction.
      const parts = filter.filters.map((inner) => retrieveNoun(inner));
      return {
        singular: parts.map((p) => p.singular).join(" or "),
        plural: parts.map((p) => p.plural).join(" or "),
      };
    }
    case "providesEnergy":
      // Unreachable through a pile-scanning op (matchesFilter rejects this
      // filter there, so such an op offers nothing to caption). Spelled anyway:
      // the phrase is what the note builders below want, and an exhaustive
      // switch that throws would be a worse answer than a correct sentence.
      return {
        singular: `a ${filter.energyType} Energy`,
        plural: `${filter.energyType} Energy`,
      };
  }
}
