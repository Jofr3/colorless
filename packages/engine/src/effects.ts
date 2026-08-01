// The effect-op vocabulary (D8's "primitive ops authored as data") and the
// conservative text→ops deriver. M3 shipped the first sliver — status/heal
// ops derived from exact attack sentences. M4 grows the union with the board
// and deck ops that Trainers and Abilities need (draw, search, switch, gust,
// heal-a-chosen-Pokémon) and moves EXECUTION into a shared, resumable
// interpreter (interpreter.ts) that both attacks and card plays run through.
//
// This module stays PURE data: the op union (below) plus `deriveAttackEffect`
// (printed text → ops, unchanged from M3). It knows nothing about GameState —
// interpreter.ts owns every state transition and the mid-effect decision
// parking. Registry-authored programs (registry.ts) are the same op arrays,
// just hand-written instead of text-derived, and sit ABOVE the deriver at the
// one attack call site (`programFor(id).attack ?? deriveAttackEffect(text)`).

import { BASIC_ENERGY_TYPES, type BasicEnergyType } from "@luminous/schema";
import type { StatusName } from "./events";

/** A declarative card predicate for deck searches (§15.E). Deliberately tiny
    — the representative cards need only "a Basic Pokémon", "any Pokémon", "a
    Basic Energy [of a type]" and "a card named X"; the union grows one entry
    per new shape. */
export type CardFilter =
  /** A Basic Pokémon. `noRuleBox` narrows it to one WITHOUT a Rule Box —
      Artazon's "a Basic Pokémon that doesn't have a Rule Box" (cards.ts
      `hasRuleBox`), the same optional-refinement shape as `basicEnergy`'s
      `energyType`. */
  | { kind: "basicPokemon"; noRuleBox?: true }
  | { kind: "anyPokemon" }
  /** An Evolution Pokémon — one that evolves from another Pokémon (Jacq's
      "search your deck for up to 2 Evolution Pokémon"). The discriminant is
      cards.ts `evolveFromOf(card) !== null`: a non-null `evolveFrom` marks a
      Stage 1 / Stage 2 (or VMAX/VSTAR) card, and the helper already returns null
      for non-Pokémon, so this is the exact complement of `basicPokemon` inside
      `anyPokemon`. */
  | { kind: "evolutionPokemon" }
  /** A Pokémon Tool card (Town Store's "a Pokémon Tool card" — read off the
      catalog's `trainerType: "Tool"`, the same discriminant attachTool uses). */
  | { kind: "toolCard" }
  /** A basic Energy card; `energyType` (a BASIC_ENERGY_TYPES member) narrows
      it to one type (Chien-Pao's "Basic {W} Energy"), else any basic energy. */
  | { kind: "basicEnergy"; energyType?: string }
  /** A card matched by exact NAME (Flamigo's "Insta-Flock" searches its own
      copies — "search your deck for up to 3 Flamigo"). */
  | { kind: "byName"; name: string }
  /** A Supporter Trainer card (Pal Pad shuffles Supporters from the discard
      pile back into the deck). */
  | { kind: "supporter" }
  /** A Pokémon OR a Basic Energy card — Super Rod's "any combination of Pokémon
      and Basic Energy cards" (a basic Energy is `energyType: "Normal"`; a
      Special Energy is excluded). */
  | { kind: "pokemonOrBasicEnergy" }
  /** Any Energy card — Basic OR Special (Poppy "Move up to 2 Energy", which
      unlike Energy Switch's "a Basic Energy" moves either kind). Distinct from
      `basicEnergy` (basics only) and `pokemonOrBasicEnergy` (which excludes
      Special Energy and admits Pokémon). */
  | { kind: "anyEnergy" }
  /** A SPECIAL Energy card (§6.1 — the catalog's `energyType: "Special"`), the
      exact complement of `basicEnergy` inside `anyEnergy`. The energy-removal
      family's narrow arm: Giacomo and Mawile discard "a Special Energy", where
      Crushing Hammer takes any. */
  | { kind: "specialEnergy" }
  /** An Energy that PROVIDES `energyType` (§6.3) — the printed "{L} Energy" of
      the typed energy-removal and energy-movement families (Kilowattrel
      "Discard a {L} Energy", Arcanine ex "Discard 2 {R} Energy", the swsh-era
      spelled-out "a Fire Energy"; Armarouge's "move a {R} Energy"). Two things
      make it its own kind rather than a rider on `basicEnergy`:

      **PROVISION, NOT PRINT.** "{L} Energy" is not "a Basic Lightning Energy
      card" — a Special Energy that provides {L} IS one for this purpose, and a
      Special providing only {C} is not, however Lightning-flavoured its art. So
      the predicate reads what the card GIVES on the board, which is exactly what
      §8.2's cost matcher reads (continuous.ts `providedEnergy`); the two must
      agree or a Pokémon could pay {L} with an Energy that "isn't {L}" when the
      same attack tries to discard it. A WILDCARD provider matches every type
      (Luminous Energy: "provides every type of Energy but only 1 at a time" —
      the same ANY_ENERGY unit that fills any typed cost slot).

      **IN-PLAY ONLY, and HOST-DEPENDENT.** Provision is a while-ATTACHED
      property ("As long as this card is attached to a Pokémon, it provides…"),
      and for Luminous it depends on the holder's OTHER attachments — the same
      card provides every type alone and only {C} beside another Special Energy.
      A card is therefore not enough to answer this filter: `attachedEnergies`
      (interpreter.ts) evaluates it per Energy ON ITS HOST, and the card-only
      `matchesFilter` — the deck / hand / discard scanner behind searchDeck,
      lookAtTopN and discardPileRetrieval — answers **false** for it, because a
      card in a pile is attached to nothing and provides nothing. Authoring it
      into a pile-scanning op is therefore a loud no-op, never a wrong match; use
      `basicEnergy` with an `energyType` for those (the printed "Basic {G} Energy
      CARD from your hand" really is about the print).

      `energyType` is a **`BasicEnergyType`**, not a bare string, so the one value
      this filter must never carry is UNREPRESENTABLE rather than merely forbidden
      by this comment (the `count?: never` precedent). Colorless is deliberately
      not a member (§6.1): it is a cost symbol, no card prints "discard a {C}
      Energy", and admitting it would be actively wrong — Colorless is the
      conservative provision FALLBACK for every unauthored Special Energy, so a
      `{C}` filter would quietly match cards nobody meant. The deriver cannot emit
      one, but the REGISTRY authors this filter too (Armarouge), which is exactly
      where a hand-written `"Colorless"` would otherwise have compiled.
      (`basicEnergy.energyType` beside it is still a bare string — a wider,
      pre-existing hole in a filter this slice did not touch.) */
  | { kind: "providesEnergy"; energyType: BasicEnergyType };

/** The name under which one op files WHAT IT MOVED so that a LATER op in the
    same program can read it — the interpreter's op→op data flow (the running
    record lives in `EffectContinuation.record`, interpreter.ts).

    IT EXISTS BECAUSE PRINTED SENTENCES REFER BACK TO EACH OTHER. Three wordings,
    one mechanism, and each is a clause that cannot be evaluated from the board
    alone because it asks what *this card's own earlier clause* actually did
    (rules doc §9.2):

      • "If you shuffled any cards into your deck **in this way**, draw 3 cards."
        (Miriam) — a GATE on whether the earlier op moved anything;
      • "(You can't choose a card you discarded with **the effect of this
        card**.)" (Superior Energy Retrieval) — the earlier op's uids EXCLUDED
        from a later op's candidate set;
      • "**If you do**, draw cards until you have 5." (Dendra) — the same gate as
        Miriam's, printed as the conditional the whole family opens with.

    A SLOT NAME, NOT A POSITION. The obvious cheaper design — "read the previous
    op's result" — is refuted by the very first card that needs this: Miriam
    shuffles the deck BETWEEN the retrieval and the sentence referring to it, and
    Janine's Secret Art (sv06.5-059, unauthored) prints the same shape ("Then,
    shuffle your deck. If you attached Energy … in this way, …"). A trailing
    shuffle is the single most common op in the vocabulary, so "previous op"
    would be wrong on the majority of the family.

    A CLOSED UNION so a typo is a COMPILE error rather than a silent false: an
    unrecorded slot reads as "nothing moved", which is indistinguishable from a
    real empty answer, so a mistyped `recordAs` would quietly cost Miriam its
    draw. Three members, matching the three things a program records — what it PAID
    (a `payFromHand` cost), what it MOVED (a benefit), and what it DISCARDED
    (Chien-Pao ex "Hail Blade" counts the Energy its own attack discarded "in this
    way" to scale the damage). Add a member when a card needs a fourth. */
export type EffectSlot = "paid" | "moved" | "discarded";

/** How many cards a `handRefresh` draws AFTER the hand goes into the deck.
    `fixed` draws a constant (Youngster 5, Judge 4, Katy 8); `handPlus` draws the
    pre-shuffle hand size plus `delta` (Brassius "draw that many cards plus 1" =
    delta 1), measured per affected player BEFORE their hand is shuffled in;
    `prizeCount` draws one card per Prize card that player still has left (Iono
    "each player draws a card for each of their remaining Prize cards" — the count
    is that player's OWN prizes, and a Prize count is public, so it leaks nothing). */
export type HandRefreshDraw =
  | { kind: "fixed"; count: number }
  | { kind: "handPlus"; delta: number }
  | { kind: "prizeCount" };

/** §6.1's full type wheel, exactly as the CATALOG spells it in `Card.types` —
    the nine Basic-Energy types plus the two that have no Basic Energy of their
    own. Built FROM `BASIC_ENERGY_TYPES` rather than re-listed, so the two
    vocabularies cannot drift and a type added to the schema is admitted here by
    construction (the same rule `ENERGY_TYPE_BY_NAME` follows further down).

    This is a POKÉMON type, a strictly wider thing than a payable energy type:
    `Colorless` is a cost symbol no Basic Energy prints and `Dragon` has no Basic
    Energy at all, which is exactly why both are absent from BASIC_ENERGY_TYPES —
    but a Pokémon is very much allowed to BE either, and 117 of the ingested
    pool's rows are (100 Colorless, 17 Dragon). Keep the two lists apart: a
    condition reading a Pokémon's printed type must never be typed with the
    energy vocabulary, or Sylveon's clause becomes unspellable. */
export const POKEMON_TYPES = [...BASIC_ENERGY_TYPES, "Dragon", "Colorless"] as const;
export type PokemonType = (typeof POKEMON_TYPES)[number];

/** A board predicate read for ONE seat — the vocabulary behind both the printed
    "You can use this card only if <condition>" play gates (CardProgram
    `playableIf`) and the "if <condition>, …" mid-program branches (the
    `conditionGate` op). Evaluated by `conditionHolds` (interpreter.ts) against
    the state at the moment it is asked: a play gate before the card leaves hand,
    a `conditionGate` at its own point in the program.

    INVARIANT — every member reads only PUBLIC state (Prize COUNTS, the Stadium
    zone's owner, Energy sitting face up on Pokémon). Both players can already
    derive the answer off the board, which is why a gate emits no event, unlike
    `coinFlipGate`, whose flip IS new information. Keep it that way: a condition
    over hidden state (a hand's CONTENTS, a deck) would leak through the gate.

    "Public" is about what a condition may DEPEND on, NOT about who can compute
    it: `conditionHolds` takes a `GameState`, so only a host holding raw engine
    state can run it (today's hot-seat HUD does). A P4 remote client holds a
    projection, which does NOT carry the Stadium's owner and redacts the prize
    arrays to counts — so the online client cannot evaluate these as written.
    That gap is P4's to close (see docs/workstreams/simulator.md); note that a
    redacted prize array still has a `.length`, so `morePrizesThanOpponent` would
    fail SILENTLY rather than loudly if this were shipped online unchanged. */
export type BoardCondition =
  /** §14 — you have strictly MORE Prize cards remaining than your opponent, i.e.
      you are BEHIND on Prizes taken (Fighting Au Lait's play gate; Defiance
      Band, Luxray and Reversal Energy read the same condition and layer later). */
  | { kind: "morePrizesThanOpponent" }
  /** §7.3 — the Stadium in the shared zone is YOURS (you played it). "If you
      have a Stadium in play" is about OWNERSHIP, not mere presence: the
      opponent's Stadium sitting in the zone does not satisfy Falkner. */
  | { kind: "yourStadiumInPlay" }
  /** None of your in-play Pokémon (Active or Benched) has ANY Energy attached —
      Basic or Special (Grusha's "if none of your Pokémon have any Energy
      attached"). Vacuously true with nothing in play. */
  | { kind: "noEnergyOnYourPokemon" }
  /** Your opponent's Active Pokémon ALREADY has any damage counters on it —
      Meowscarada ex sv02-015/-231/-256/-271 "Scratching Nails" and Gyarados ex
      sv01-045/-225 "Tyrannical Tail" (the D115 conditional damage-bonus family).
      Read at attack DECLARATION, i.e. BEFORE this attack's own damage lands,
      which is exactly what the printed "already" means: an undamaged defender
      cannot bootstrap the bonus with the very hit the bonus is scaling. */
  | { kind: "opponentActiveDamaged" }
  /** Your opponent's Active Pokémon is an EVOLUTION Pokémon — Seviper sv02-137
      "Cross-Cut", Houndoom sv03-133 "Daring Strike" and Toxicroak sv06.5-024
      "Clean Hit". "Evolution Pokémon" is D105's definition reused verbatim
      (`evolveFromOf(topCard) !== null`, the exact complement of `basicPokemon`),
      so the two readings can never drift apart. False with no Active. */
  | { kind: "opponentActiveIsEvolution" }
  /** YOUR Active Pokémon has any damage counters on it — Talonflame sv02-030
      "Fiery Breeze" (+90) and Darmanitan sv03-035 "Damage Counterpunch" (+60),
      whose printed clause is "If **this Pokémon** has any damage counters on
      it". D116: the member is named for what it READS (your Active), not for
      the pronoun one consumer prints, because "this Pokémon" is meaningless on
      the play-gate path — a Trainer has no self. The printed pronoun resolves to
      the Active in the CLAUSE TABLE, which is the only layer that knows the
      sentence came off an attack, and an attack is declared by the Active by
      definition (§8). False with an empty Active Spot. */
  | { kind: "yourActiveDamaged" }
  /** Any ONE of your BENCHED Pokémon has damage counters on it — Tyranitar ex
      sv03-066/-211 "Lightning Rampage" (+100), printed in the plural ("If your
      Benched Pokémon have any damage counters on them"). The plural is the
      game's usual collective phrasing for "any of them", NOT a requirement that
      every benched Pokémon be damaged; an EMPTY Bench is false. Deliberately
      excludes the Active — the printed word is "Benched", and the sibling
      `yourActiveDamaged` covers the other spot. */
  | { kind: "yourBenchDamaged" }
  /** §12 — your opponent's Active Pokémon is Poisoned: Seviper sv01-128 and
      Paldean Clodsire sv03-129, both printing "Venoshock" (+120). Poison is a
      COUNTER amount on the model rather than a flag (`poisonDamage`, which
      effects may raise), so "is Poisoned" is `> 0`. False with no Active. */
  | { kind: "opponentActivePoisoned" }
  /** §12 — your opponent's Active Pokémon is affected by ANY Special Condition:
      Sableye sv02-136 "Unseen Claw" (+70), the pool's only printing of this
      clause. Reuses `presentStatuses` verbatim — the same list the STATUS_CLEARED
      events and the status chips are built from — so "affected" can never drift
      from what the board shows. The rotation slot, Poison and Burn all count, and
      any ONE of them suffices. False with no Active. */
  | { kind: "opponentActiveHasSpecialCondition" }
  /** §12 — YOUR Active Pokémon is Poisoned: Okidogi ex sv06.5-036/-082/-090
      "Chain-Crazed" (+130), whose printed clause is "If **this Pokémon** is
      Poisoned". D116's pronoun rule applied a second time — the member is named
      for what it READS (your Active) and the CLAUSE TABLE resolves the printed
      "this Pokémon", because a Trainer play gate has no self. The exact SELF twin
      of `opponentActivePoisoned` and read the same way (`poisonDamage > 0`, as
      the Checkup reads it). False with an empty Active Spot. */
  | { kind: "yourActivePoisoned" }
  /** Your opponent's Active Pokémon is a Pokémon **ex** or a Pokémon **V** —
      Ceruledge sv02-098 "Fighting Sword" (+100), the pool's only printing.
      D107's `isExOrV` reused verbatim, so the reading can never drift from
      Mimikyu "Safeguard"'s: ex and V ONLY, NOT VMAX/VSTAR/GX (which is why this
      is narrower than `hasRuleBox`). It inherits that predicate's one limitation
      — the class is derived from the card NAME's suffix, tcgdex's structured
      markers being dropped at ingest. False with no Active. */
  | { kind: "opponentActiveIsExOrV" }
  /** §6.3 — YOUR Active Pokémon has at least one attached Energy of `energy`:
      Scovillain sv01-029/-202 "Super Spicy Breath" (+90, `{R}`), Galvantula
      sv06.5-002 "Shocking Web" (+80, `{L}`), Cetitan sv02-055 "Special Horn"
      (+140) and Tinkaton sv02-105 "Special Hammer" (+90, both `Special`).

      **The union's FIRST member carrying a PARAMETER.** Every member before it is
      a bare tag, and three flat tags would have done for today's four printings —
      but the clause is a template, not four sentences: the pool prints nine
      distinct energy codes and two rival notations for them, so the flat form
      costs a member per type per notation and the parameterised form costs
      nothing at all for the tenth printing. The parameter is the only axis the
      printed sentences actually vary on.

      `energy` is a `BasicEnergyType` (the schema's own §6.1 vocabulary — no
      `Colorless`, no `Dragon`) or the string `"special"` for the CARD-CLASS
      reading, which is a different axis from a type and deliberately not a tenth
      type. The predicate is PROVISION, not the printed name (continuous.ts
      `hasAttachedEnergy`): an Energy that can pay a `{R}` cost is exactly an
      Energy this clause counts, so a wildcard Luminous Energy satisfies `{R}`
      for as long as it provides every type — and stops the moment a second
      Special demotes it to `{C}`. Reading it any other way would let Scovillain
      pay its own cost with a card the very same sentence then refuses to see.

      D116's pronoun rule, third use: the member is named for what it READS (your
      Active) and the CLAUSE TABLE resolves the printed "this Pokémon". Attached
      Energy sits face up, so the union's public-state invariant holds. False with
      an empty Active Spot. */
  | { kind: "yourActiveHasEnergyAttached"; energy: BasicEnergyType | "special" }
  /** §3.8 — your opponent's REMAINING Prize count is one of `counts`: Krokorok
      sv01-116 "Payback" (+90, `[1]`) and Houndstone sv03-101 "Two Four-ocious"
      (+120, `[2, 4]`). The printed word is "exactly", so this is set MEMBERSHIP,
      never a threshold — `[2, 4]` is deliberately not "2 to 4" and the case that
      catches the confusion is 3 Prizes reading FALSE between two true values.

      The parameter is a LIST rather than a number because the pool prints the
      clause with one value and with two, and (on an Ability, Slaking V
      swsh10.5-058/-077) with three; one member covers every arity, and a
      single-valued list is the degenerate case rather than a second member.

      Remaining, not taken: `prizes.length` is what is still face down, exactly as
      `morePrizesThanOpponent` reads it and the opposite of `takenPrizes`. Prize
      COUNTS are public and survive redaction as counts, so — unlike
      `yourStadiumInPlay` — this member does not widen the P4 gap. */
  | { kind: "opponentPrizesRemaining"; counts: readonly number[] }
  /** Your opponent is holding AT MOST `count` cards — Absol ex sv03-135/-214
      "Cursed Slug" (+120, `3`), the pool's only "or fewer" clause of any kind.

      **The sharpest test of the union's public-state invariant so far, and it
      passes:** a hand's SIZE is public (both players watched every draw, play and
      discard that set it) while a hand's CONTENTS are not — which is the exact
      line the invariant above already draws when it names "a hand's CONTENTS" as
      the thing a condition may not depend on. redact.ts backs that reading: the
      opponent's hand ships as `hiddenHand(side.hand.length)`, face-down backs with
      a real length, so this member is evaluable online in a way a contents-reading
      one could never be.

      The threshold is a parameter for the same reason D118's energy is: it is the
      only axis the sentence varies on, and burying the 3 in the member's NAME
      would make the second printing a second member. */
  | { kind: "opponentHandAtMost"; count: number }
  /** Both players are holding the same NUMBER of cards — Bronzong sv03-145
      "Extrasensory" (+90), the pool's only printing.

      Deliberately NOT folded into `opponentHandAtMost` with a comparison mode: a
      threshold against a printed constant and an equality between the two hands
      are different comparisons over different operands, and D118's rule is "one
      TOKEN varying", not "these look similar". The two clauses share a noun and
      nothing else.

      The one member of this whole vocabulary that is SEAT-SYMMETRIC — equality
      commutes, so it reads the same from either seat, and that is asserted rather
      than assumed. Sizes only, contents never (see the sibling above). */
  | { kind: "handSizesEqual" }
  /** Your opponent's Active Pokémon is a `type` Pokémon — Sylveon swsh10.5-035
      "Wonder Flash" (+90, `Dragon`), the pool's only printing of a TYPE clause
      and the only sentence in 978 cards that contains the word "Dragon" at all.

      PARAMETERISED on one printing (D118's rule, applied where the evidence is
      thinnest): the sentence varies on exactly ONE token, that token is
      byte-identical to the value sitting in `Card.types`, and the vocabulary it
      draws from is CLOSED at eleven names. A flat `opponentActiveIsDragon` would
      cost a member and a row for every one of the other ten the day a Fire or a
      Water printing lands — D118's mistake, made in advance.

      The reading is the same one Weakness/Resistance make (`Card.types`
      `.includes`), so it cannot drift from the §8.5 pipeline running two lines
      later. `types` is null on Trainers and Energy and every Pokémon row in the
      ingested pool carries exactly one; the predicate is written for many all the
      same, since the field is an array and dual types are a real printing. False
      with an empty Active Spot. */
  | { kind: "opponentActiveHasType"; type: PokemonType }
  /** A card NAMED `name` is on YOUR Bench — Falinks sv02-119 "Reckless Charge
      Together" (+90, `Falinks`), the pool's only printing in this skeleton.

      **The union's first member reading a card IDENTITY rather than a structural
      fact** — every predicate before it asks what a Pokémon IS (damaged, Poisoned,
      an Evolution, an ex). There is precedent for the read itself (`CardFilter`'s
      `byName`, the aura's `exemptAbilityNamed`), and the deck builder keys on
      names all day, so a name is a legitimate thing for the shared vocabulary to
      carry. What it must NOT be is a TEMPLATE — see the clause table's row.

      Named-card, not another-copy-of-me: both pool printings of the shape happen
      to name their own card, but the printed sentence names a CARD, and a
      predicate reading "another copy of the attacker" would answer differently
      the day a card names a different one (Lunatone sv03-092's "If you have
      Solrock in play" is already that sentence on another skeleton). Exact match,
      no normalisation — the catalog's `name` IS the printed name.

      Your BENCH alone: the Active Spot is deliberately not consulted, exactly as
      `yourBenchDamaged` excludes it, because the printed word is "Bench". An
      empty Bench is false. Names are public the moment a Pokémon is in play, so
      the union's public-state invariant holds. */
  | { kind: "yourBenchHasNamed"; name: string }
  /** You have AT LEAST `count` Energy of `energy` in play — Absol sv06.5-030
      "Darkfall" (+50, `3` × `Darkness`), and in 978 cards that is the entire
      census: "at least" and "Energy in play" are each a HAPAX, occurring in this
      one sentence and nowhere else.

      **The board-wide twin of `yourActiveHasEnergyAttached`, and the reason it
      is a separate member rather than a scope flag on that one:** the two read
      different boards with the same noun. Every other energy clause in the pool
      says "attached" and means one Pokémon (nine printings across four cards);
      this one says "in play" and means all of them. One word separates them, and
      folding them together behind a `scope` parameter would put the choice
      between "your Active" and "your whole side" inside a value the four other
      consumers of this vocabulary would then have to author.

      PARAMETERISED but a LITERAL row (D119's corollary, second use): TWO things
      vary in principle, the count and the energy token, so D118's one-token test
      fails and the clause table takes the sentence whole. The parameters are
      still real — `conditionHolds` genuinely compares a count against a
      threshold, and burying `3` and `Darkness` in the member's name would make
      the second printing a second member for no gain.

      `energy` is D118's type verbatim (`BasicEnergyType | "special"`), because
      the predicate is D118's predicate folded over the board: the card class is
      as countable as a type, and narrowing it here would fork one question into
      two. The pool prints no "Special Energy in play" sentence today; the arm
      costs nothing and answers correctly if one lands.

      Energy in play sits face up on both sides of the table, so the union's
      public-state invariant holds — this is strictly more online-evaluable than
      `yourStadiumInPlay`. Counts CARDS, not units of provision, and reads
      provision rather than the printed name (continuous.ts `countEnergyInPlay`).
      An empty board is 0, so a printed `count` of 0 would be trivially true;
      the pool prints 3. */
  | { kind: "yourEnergyInPlayAtLeast"; energy: BasicEnergyType | "special"; count: number }
  /** §7.4 — YOUR Active Pokémon is wearing a Pokémon Tool: Greedent sv01-152
      "Enhanced Fang" (+80), whose printed clause is "If **this Pokémon** has a
      Pokémon Tool attached". The pool's only printing, and no reprint.

      A BARE TAG, and the last clause in this family that reads a field the model
      already carries: `InPlayPokemon.tools` is a uid array kept beside `energy`
      and `stack`, so the predicate is a length test and needs no continuous.ts
      helper the way the Energy clauses do. There is no provision question to
      answer — an Energy card can pay for a type it is not named after, but a Tool
      is a Tool, and `attachTool` (cardplay.ts) has already refused anything whose
      `trainerType` is not "Tool" before a uid can land in this array.

      "A Pokémon Tool", singular as printed, is still `> 0` rather than `=== 1`:
      §7.4's one-Tool-per-Pokémon rule is enforced at the attach gate, but
      Revavroom ex sv03-156's "Tune-Up" Ability raises the cap to 4, so the array
      is not bounded at one by the type system and a card that lifts the cap must
      not un-arm this clause.

      D116's pronoun rule, fourth use: the member is named for what it READS (your
      Active) and the CLAUSE TABLE resolves the printed "this Pokémon", because a
      Trainer play gate has no self. A Tool sits face up on the Pokémon it is
      attached to, so the union's public-state invariant holds; redact.ts already
      ships the tool list to both seats. False with an empty Active Spot. */
  | { kind: "yourActiveHasToolAttached" }
  /** §7.2 — YOU have already played a Supporter card from your hand THIS TURN:
      Pikachu swsh10.5-027 "Buddy Bolt" (+30), whose printed clause is "If you
      played a Supporter card from your hand during this turn". A HAPAX in the
      ingested 978 cards — one printing, one card, no reprint, and the pool's only
      other "you played" sentence is Crobat sv06.5-029's "Shadowy Envoy" Ability,
      which names a SPECIFIC card ("if you played Janine's Secret Art from your
      hand this turn") and is a different question entirely.

      THE FIRST MEMBER OF THIS VOCABULARY THAT READS A TURN EVENT RATHER THAN A
      BOARD, and it costs NO new state: §7.2's one-Supporter-per-turn cap is
      already tracked as `state.allowances.supporterPlayed`, set by `playTrainer`
      (cardplay.ts) when the played Trainer's `trainerType` is "Supporter" and
      cleared by `freshAllowances()` on every `startTurn`. "During this turn" is
      therefore not a new clock — it is the lifetime the allowances bag already
      has. A bare tag, because there is nothing left to parameterise: the sentence
      names no card, no count and no type, only the card CLASS the cap is keyed
      on.

      A BARE TAG, and the vocabulary's SECOND-cheapest member after
      `yourActiveHasToolAttached` — but the cheapness hides the one real hazard,
      which is the SEAT. `GameState.allowances` is a SINGLE bag describing whoever
      owns the current turn, not a per-seat record, while `conditionHolds` is
      SEAT-RELATIVE and has consumers where `seat` is NOT the turn owner (a
      `conditionGate` running under a koTrigger / damagedTrigger stage parks during
      the OPPONENT's turn — see the `resumeTail` note on `effect:choose` in
      types.ts). Reading the bag unguarded would answer "your OPPONENT played a
      Supporter" as "you played a Supporter", so the predicate first proves the
      seat OWNS the turn (`phaseViewOf(state, seat).activeSeat === seat`) and only
      then reads the flag. The turn owner is taken from THE one exhaustive switch
      over `Phase` and never re-derived by turn parity, which phaseView.ts's module
      header forbids for exactly the case that breaks it.

      A consequence worth naming: during a checkup-origin `ko:*` park `activeSeat`
      is null, so this reads FALSE for BOTH seats. "During this turn" is vacuous
      BETWEEN turns, which is the intended reading — no turn is in progress, so no
      turn holds a Supporter play.

      Whether a Supporter has been played this turn is PUBLIC — the card went from
      a hand to a face-up discard pile and the §7.2 cap is common knowledge — so
      the union's public-state invariant holds. */
  | { kind: "youPlayedSupporterThisTurn" }
  /** §8.1/§11 — YOUR Active Pokémon moved up from the BENCH during the current
      turn: Revavroom ex sv06.5-015/-081 "Accelerator Flash" (20+, +120) and
      Golisopod swsh10.5-026 "First Impression" (20+, +90), whose printed clause
      is "If this Pokémon moved from your Bench to the Active Spot this turn".
      THREE printings on one clause — the best printings-per-clause ratio left in
      the family when it was built, and the whole per-turn cluster's anchor.

      THE SECOND MEMBER TO READ A TURN EVENT (after `youPlayedSupporterThisTurn`)
      and the FIRST to need state that did not exist. It is per-Pokémon AND
      per-turn at once, which nothing on the model recorded: `turnPlayed` says
      when the CARD entered play, `markers` is a write-only string bag, and
      `TurnAllowances` is per-SEAT. So `InPlayPokemon` gained `promotedTurn:
      number | null` (types.ts).

      A TURN STAMP, NOT A FLAG, and that choice pays for itself three times.
      (1) There is no turn-boundary clear to write or to forget — `promotedTurn
      === state.turn` expires by arithmetic, and `startTurn` has no loop over
      in-play Pokémon to add one to. (2) It needs NO seat guard, which is the
      exact inverse of `youPlayedSupporterThisTurn` and the point worth carrying:
      D123's clause needed `activeSeat === seat` because `allowances` is a single
      bag owned by whoever's turn it is, so the STATE was seat-ambiguous — "this
      turn" was never the problem. A fact stamped on a Pokémon is not ambiguous;
      the Pokémon already knows whose it is. (3) It gets the KO case right for
      free: a promotion after a Knock Out happens during the OPPONENT's turn, so
      it stamps THEIR turn number and reads FALSE the instant the controller's
      own turn starts — which is the printed reading (§8.1's replacement is not
      the attacker's "moved up this turn").

      All three bench→Active routes stamp it and all three COUNT: a `retreat`
      (turn.ts), a forced `switchInto` (interpreter.ts — Switch/Escape Rope,
      Boss's Orders, and Jet Energy's on-attach switch), and `resolvePromotion`
      after a KO (flow.ts). Jet Energy is the one that makes this a real deck: the
      printed clause does not say "if you retreated", it says "moved", and every
      route is a move. Setup placement is NOT one — a card arriving from the hand
      never came from the Bench, so `makeInPlay` stamps `null`.

      SURVIVES EVOLUTION. `placeEvolution` spreads the whole Pokémon and clears
      only `conditions`, `retreatBlocked` and `markers` — the §10 rule is that
      evolving sheds the effects of ATTACKS, and having moved is a fact about the
      turn, not an effect on the card. So retreating a Varoom in and evolving it
      into Revavroom ex the same turn leaves the clause armed, which is both the
      printed reading and the only line on which this card is actually good.

      Where a Pokémon has been is PUBLIC — every one of those moves is announced
      (RETREATED / POKEMON_SWITCHED / POKEMON_PROMOTED) and happens face-up on the
      table — so the union's public-state invariant holds. */
  | { kind: "yourActivePromotedThisTurn" };

/** The riders that narrow which of the controller's own in-play Pokémon may
    RECEIVE an attach. Spelled once and read once (`attachEnergyTargets`,
    interpreter.ts) because "is this Pokémon an eligible attach target" is ONE
    rule with two op-shaped readers — `attachEnergyFrom` (hand / discard source)
    and `attachFromTop` (the deck top). Each op declares only the riders its
    printed cards use, and is structurally an `AttachTargetRiders`; an absent
    rider is no restriction, so the base shape is "every own in-play Pokémon". */
export interface AttachTargetRiders {
  /** Only Pokémon whose TOP card is this type — Gardevoir ex's "your {P}
      Pokémon", Electric Generator's "your Benched {L} Pokémon". */
  targetType?: string;
  /** Only BASIC Pokémon (Koraidon ex's "your Basic {F} Pokémon"). */
  basicOnly?: true;
  /** Only BENCHED Pokémon — the Active is not a target (Electric Generator's
      "your **Benched** {L} Pokémon", where the attach is the whole point of
      putting Energy somewhere the turn's manual attach cannot reach). */
  benchOnly?: true;
  /** Damage counters the attach itself places on the target (Gardevoir's 2). */
  bonusCounters?: number;
  /** Exclude any target `bonusCounters` would Knock Out ("you can't use this on
      a Pokémon that would be Knocked Out"), so the placement is never lethal. */
  notIfKO?: true;
}

/** One effect operation — the engine's instruction set (D8). Attack-derived
    programs use the first three (targets are relative to the attacker: "self"
    = the attacker's Active, "defender" = the Defending Pokémon); Trainer /
    Ability programs use the rest (targets relative to the controller — the
    seat playing the card — resolved by the interpreter). The whole union is
    JSON-safe so a parked program (interpreter.ts) serializes into the phase. */
export type EffectOp =
  // — Attack ops (M3), attacker-relative. —
  | {
      op: "applyStatus";
      target: "defender" | "self";
      status: StatusName;
      /** Only for "poisoned": HP placed per Checkup when raised above 10. */
      poisonDamage?: number;
    }
  /** §11 — hold the Defending Pokémon in place for the opponent's next turn
      ("During your opponent's next turn, the Defending Pokémon can't retreat.").
      No `target` field: every print of this clause in the pool locks the
      DEFENDER, so the shape stays bare until a self-locking one exists (D104).
      Not an `applyStatus` variant — `StatusName` is a closed five-value union
      pinned by two exhaustive `Record`s, the wire condition schema and the
      playmat's status chips; the block is none of those things. */
  | { op: "preventRetreat" }
  | { op: "heal"; target: "self"; amount: number }
  /** Heal `amount` HP from EACH of the controller's own in-play Pokémon
      (Garganacl "Blessed Salt" — a between-turns triggered Ability). No target
      choice, so it never parks; one HEALED per Pokémon that actually healed. */
  | { op: "healEach"; amount: number }
  /** Heal `amount` HP from EVERY in-play Pokémon on BOTH boards (Picnic Basket
      "Heal 30 damage from each Pokémon (both yours and your opponent's)"). The
      seat-blind twin of `healEach` — the whole table heals, not just the
      controller's side. No target choice, so it never parks; one HEALED per
      Pokémon that actually healed, tagged with that Pokémon's OWN seat. */
  | { op: "healEachAll"; amount: number }
  /** Place `amount` HP of damage on the OPPONENT's Active Pokémon (Trevenant
      "Forest Miasma" — 1 damage counter between turns). A COUNTER placement,
      not attack damage: no Weakness/Resistance (§8.5), emitted as
      COUNTERS_PLACED source "ability". Never parks; can KO — the caller sweeps
      (the Checkup's KO sweep does, flow.ts). */
  | { op: "damageActive"; amount: number }
  /** Spread damage (§8.5): place `amount` HP of damage on EACH of the
      opponent's Benched Pokémon. Weakness/Resistance NEVER apply to Benched
      Pokémon, so this is flat. A SECONDARY damage clause, distinct from the
      attack's main numeric damage; the interpreter only PLACES it (one
      DAMAGE_DEALT per benched Pokémon) — the Knock Out check runs afterwards in
      the attack epilogue (attack.ts finishAttack), which sweeps the whole
      board, so the interpreter still never KOs or touches the flow tail. This
      is what the M4 KO generalization off the Active exists to reach. */
  | { op: "spreadDamage"; target: "opponentBench"; amount: number }
  /** Place `amount` HP of SELF-damage on the attacker's own Active — the recoil
      clause "This Pokémon also does N damage to itself" (Skeledirge sv01-038
      "Blazing Shout", after its 190 to the defender). Self-damage is OUTSIDE the
      §8.5 pipeline: no Weakness/Resistance (you have no Weakness to your own
      attack) and no reduction passive — exactly the confusion self-hit's model
      (attack.ts), which is why it lands as COUNTERS_PLACED source "self" rather
      than a DAMAGE_DEALT that would imply the W/R math ran. Like every op it only
      RAISES damage and never KOs: the resulting self-KO is caught by the attack
      epilogue's TWO-seat sweep (flow.ts finishAttack), where it prizes to the
      DEFENDER (the opponent of the KO'd side, as collectKnockOuts always owes it).
      "itself" is the source, which for a §8 attack is the attacking Active — no
      single-op derived program relocates it before this runs. */
  | { op: "damageSelf"; amount: number }
  /** Put `amount` HP of damage counters on `count` CHOSEN Benched Pokémon of
      the opponent (Hawlucha "Flying Entry" — 2 × 1 counter; Meowscarada ex
      "Bouquet Magic" — 1 × 3 counters). "Put damage counters" is NOT attack
      damage: no Weakness/Resistance AND no reduction passive — a counter placed
      by an Ability is flat (the same rule damageActive / the poison-burn ticks
      follow), so this is distinct from spreadDamage (an attack's damage, which
      Bouffer reduces). PARKS on a multi-Pokémon choice (choosePokemonMulti) when
      the opponent has MORE than `count` Benched Pokémon; hits all of them when
      the Bench holds `count` or fewer (forced — "choose 2" with 2 available is
      both), and is a no-op with an empty opponent Bench. Only raises damage; the
      Knock Out check runs in the CALLER'S sweep (flow.ts settleProgram →
      resolveMidTurnKnockOuts), a MID-TURN KO that resumes the actor's turn — so
      this, like every op, never KOs or touches the flow tail.

      **`count` IS EXACT — the printed number is a floor as well as a ceiling.**
      "Put 3 damage counters on 1 of your opponent's Benched Pokémon" means one,
      not "up to one": a card prints the words "up to" when a partial answer is
      legal, and none of this op's consumers does. So the park asks for `count` on
      the nose, and the interpreter's forced branch (a Bench no bigger than
      `count`) is the same rule under §8.6 "do as much as you can". The floor is
      what stops Meowscarada ex from paying its irreversible hand cost and then
      placing nothing.

      `optional` is the printed "**you may**" — and it only ever appears on a
      TRIGGERED Ability, where the engine auto-fires the trigger (triggers.ts) and
      the decline therefore has nowhere else to live but the pick. Hawlucha is the
      one consumer: "you may choose 2 …" is all-or-nothing, so the prompt's legal
      answers are exactly `count` refs or NONE — never one of two. Meowscarada ex
      and Radiant Blastoise carry no such word on the placement (their "may" is the
      Ability's own activation, spent by choosing to use it, and by then the cost
      is paid), so their pick is mandatory. */
  | {
      op: "damageChosen";
      /** `opponentBench` — the chosen target(s) are among the opponent's Bench
          (flat, no W/R). `opponentAny` — 1 of ALL the opponent's Pokémon (Active
          OR Bench): a target that lands on the Active takes Weakness/Resistance
          (§8.5), a Benched one does not (Fezandipiti ex "Cruel Arrow", Rotom
          "Linear Attack"). */
      target: "opponentBench" | "opponentAny";
      amount: number;
      count: number;
      /** The printed "you may" of an auto-fired trigger: taking NONE is a legal
          answer, but a partial pick still is not (Hawlucha). */
      optional?: true;
      /** Wo-Chien ex "Covetous Ivy": the hit is ATTACK DAMAGE, not a placed
          counter — emit DAMAGE_DEALT and let a benched reduction passive apply
          (spreadDamage's model), where the default put-counter snipe (Hawlucha /
          Meowscarada, an Ability) emits COUNTERS_PLACED and is flat. Benched
          Pokémon still take NO Weakness/Resistance either way (§8.5). */
      deals?: true;
      /** Wo-Chien ex "Covetous Ivy": the printed "for each Prize card your
          opponent has taken" — the effective amount is `amount × the opponent's
          TAKEN Prizes`, read from state at run time (0 taken → no damage, no pick).
          The multiply "×" of the benched-snipe family, evaluated in the interpreter
          rather than folded pre-W/R (the target is benched, never the defender). */
      perTakenPrize?: true;
      /** Umbreon "Feint Attack" (sv03-130): "This attack's damage isn't affected by
          Weakness or Resistance, or by any effects on that Pokémon." — the snipe's
          hit skips BOTH the target's Weakness/Resistance AND its `damageReductionAfterWR`
          passive (the "any effects on that Pokémon" half). The ATTACKER's own pre-W/R
          bonus is an effect on the ATTACKER, not the target, so it still applies. Only
          the `opponentAny` reader sets it (Feint Attack targets any Pokémon). */
      ignoreWR?: true;
    }
  /** Deal `per × N` ATTACK damage to the DEFENDER (the opponent's Active), where
      N is how many cards an earlier op filed under the `count` §9.2 slot —
      Chien-Pao ex "Hail Blade" ("This attack does 60 damage for each card you
      discarded in this way", `per: 60`, reading the `discarded` slot its own
      leading `discardEnergy` wrote). It runs the FULL §8.5 pipeline through
      `snipeActive` (the attacker's pre-W/R bonus → Weakness → Resistance → the
      defender's reduction passive), so it IS genuine attack damage — which is why
      the card's printed "N×" base is suppressed (attack.ts) rather than dealt on
      top. A slot count of 0 (nothing discarded, or an empty board) deals nothing.
      Only RAISES damage; the resulting KO is swept by the attack epilogue, like
      every program-emitted damage op. This exists because damage runs BEFORE the
      program in §8, so an attack whose number depends on a mid-attack choice
      cannot use the pre-W/R fold (`AttackDamageBonus`, read off the board at
      declaration) — it re-enters the same W/R math from inside the program, after
      the choice is made. */
  | { op: "damageDefender"; per: number; count: EffectSlot }
  /** "Flip a coin. If heads, …" — `then` runs on heads only. The other gate is
      `conditionGate` (below, deterministic); both are spliced by runProgram. */
  | { op: "coinFlipGate"; then: EffectOp[] }
  // — Trainer / Ability ops (M4), controller-relative. —
  /** Draw `count` from the top of the controller's deck (short-draws when the
      deck is shallower — §14.3 deck-out is a turn-START rule only). */
  | { op: "drawCards"; count: number }
  /** "Draw cards until you have `size` cards in your hand" (Grusha) — draw
      `size − hand.length`, i.e. nothing at all when the hand already holds
      `size` or more (a bigger hand is never trimmed). Fully automatic like
      drawCards, and short-draws the same way on a shallow deck (§14.3 deck-out
      is a turn-START rule). Distinct from drawCards because the count is read
      off the CURRENT hand: two of these in a row is not two draws. */
  | { op: "drawUntilHandSize"; size: number }
  /** Discard the controller's whole hand (Professor's Research precedes a draw). */
  | { op: "discardHand" }
  /** Shuffle the controller's deck (the tail of every search). */
  | { op: "shuffleDeck" }
  /** Search the controller's deck for up to `max` cards matching `filter` and
      move them to `dest`. "Up to" — the player may take fewer (or none), so
      this PARKS on a card choice unless the deck holds no candidate. */
  | { op: "searchDeck"; filter: CardFilter; dest: "bench" | "hand"; max: number }
  /** Switch the controller's Active with one of their Benched Pokémon (§G).
      PARKS on the bench choice unless exactly one is benched. */
  | { op: "switchActive" }
  /** Gust: switch one of the OPPONENT's Benched Pokémon into their Active spot
      (Boss's Orders). PARKS on the opponent-bench choice unless forced. */
  | { op: "gust" }
  /** Heal from the controller's own in-play Pokémon: `amount` HP, or `"all"`
      its damage. Without `upTo` it heals ONE — the printed exact "1 of your
      Pokémon" (Potion 30; Arboliva's "Enriching Oil" all) — and PARKS on a
      choosePokemon unless only the Active is in play. `upTo` is the printed
      "up to N … each" (Saguaro: "Choose up to 2 of your Pokémon and heal 50
      damage from each of them"): it parks a choosePokemonMulti {min: 0,
      max: min(upTo, in play)} — §9.1's "up to" legalizes 0, 1, … max, so this
      is the first consumer of that prompt's min:0 end, and it parks at every
      non-empty board (a take-fewer right is a decision even over one
      candidate — the declinable-snipe rule). The candidates are ALL the
      controller's Pokémon, damaged or not: the printed choose clause has no
      damaged restriction, and picking an undamaged one heals 0 and emits
      nothing (the single-arm rule). `amount` stays per-Pokémon ("from EACH of
      them"), clamped to each pick's damage. */
  | { op: "healChosen"; amount: number | "all"; upTo?: number }
  /** Attach ONE Basic Energy from a SOURCE zone (the controller's hand or
      discard pile) to a CHOSEN own in-play Pokémon — the §6 energy-acceleration
      Ability family (Quaquaval "Energy Carnival" from hand; Baxcalibur "Super
      Cold" a {W} from hand). `energyType` restricts it to a Basic Energy of that
      type (undefined = any Basic Energy). Same-type Basic Energy cards are
      fungible, so the ONLY decision is the TARGET: this PARKS on a choosePokemon
      unless exactly one Pokémon is in play, and a source holding no matching
      Energy is a no-op (programPlayable also blocks activating an Ability that
      could only whiff). Single-energy — MULTI-attach ("attach up to N in any way
      you like", Koraidon "Dino Cry") is just N of these ops in one program: the
      interpreter parks on each attach's target in turn, and an op finding no more
      matching Energy no-ops, so the program attaches min(N, available) — the
      "may attach fewer" is auto-maxed (pure-upside, the auto-take doctrine). The
      deck-search / look-at-top-N sources layer later ops on this primitive.

      Riders: `targetType` restricts the eligible targets to the controller's own
      Pokémon whose top card is that type ({P}/{F}); `basicOnly` further requires
      the target be a Basic Pokémon (Koraidon's "your Basic {F} Pokémon");
      `bonusCounters` puts that many HP of damage counters on the Pokémon just
      attached to (Gardevoir's 2 = 20); `notIfKO` excludes any target the
      bonusCounters would Knock Out ("can't use on a Pokémon that would be Knocked
      Out"), so the placed counters are always non-lethal — this op never KOs. */
  | {
      op: "attachEnergyFrom";
      source: "hand" | "discard";
      energyType?: string;
      targetType?: string;
      basicOnly?: true;
      bonusCounters?: number;
      notIfKO?: true;
    }
  /** Retrieve up to `max` cards matching `filter` from the controller's DISCARD
      pile into `dest` (their hand or their deck) — the §7.1 recovery-Item family
      (Energy Retrieval: 2 Basic Energy → hand; Pal Pad: 2 Supporters → deck;
      Super Rod: 3 Pokémon/Basic Energy → deck). The discard-pile mirror of
      `searchDeck`: like it this is "up to" (the player may take fewer, or none),
      so it PARKS on the SAME chooseCards prompt unless the discard holds no
      candidate (then it is a no-op). `dest: "deck"` appends the returned cards to
      the deck — the printed "Shuffle … into your deck" is this op followed by a
      `shuffleDeck` op (the Nest Ball search-then-shuffle authoring pattern), so a
      whiffed retrieval still shuffles, exactly as a whiffed search does.
      `dest: "hand"` just appends to hand. Reuses resolveEffect's chooseCards
      validation and, for the deck destination, the one vetted `shuffleDeck`.

      AUTHORING NOTE: `playTrainer` discards the played card UP FRONT (before its
      program runs), so a card whose own `filter` MATCHES ITS OWN CATEGORY would
      offer ITSELF as a retrieval candidate. No card in scope does — the safety is
      that each one retrieves a category it is not a member of. It is NOT, as this
      note used to say, that "every card here is an Item retrieving
      Energy/Pokémon/Supporters": **Miriam is a Supporter on this op**, and the
      only reason it is safe is that its filter is `anyPokemon`. A Supporter
      authored with `filter: {kind:"supporter"}` would put itself in its own offer
      and needs the played uid excluded first — which is what `exclude` now
      exists to express, though the played uid is not currently recorded anywhere.

      `exclude` is Superior Energy Retrieval's parenthetical, "(You can't choose
      a card you discarded with the effect of this card.)": the uids an earlier
      op filed under that `EffectSlot` are dropped from the candidate set before
      the filter runs. It is not a nicety — SER pays its hand cost INTO the very
      pile this op then reads, so without it a player could discard 2 Basic
      Energy and take the same two straight back, which turns the cost into a
      no-op and the card into a free +2. `recordAs` is the other end of the same
      wire: Miriam files what it shuffled back so its printed "in this way" has
      something to ask about. */
  | {
      op: "discardPileRetrieval";
      filter: CardFilter;
      dest: "hand" | "deck";
      max: number;
      /** File the uids actually moved under this slot (Miriam). */
      recordAs?: EffectSlot;
      /** Drop the uids filed under this slot from the candidates (SER). */
      exclude?: EffectSlot;
    }
  /** Look at the top `n` cards of the controller's deck and put up to `max`
      matching `filter` into their HAND (Great Ball: top 7, a Pokémon; Pokégear
      3.0: top 7, a Supporter — "you may reveal … and put it into your hand").
      The top-of-deck twin of `searchDeck`: like it this is "up to" (the player
      may take fewer, or none), so it PARKS on the SAME chooseCards prompt — but
      the candidates are only the cards matching `filter` among the top `n` (in
      current deck order; index 0 is the top), NOT the whole deck. An empty top-`n`
      match is a no-op. "Shuffle the other cards back into your deck" is NOT part
      of this op — it is the trailing `shuffleDeck` op (the Nest Ball
      search-then-shuffle authoring pattern), so a whiff still shuffles, exactly
      as a whiffed search does. The taken cards are revealed (public) — the printed
      "reveal" — so naming them (DECK_TOP_REVEALED) leaks nothing the opponent
      would not see in paper. Reuses resolveEffect's chooseCards validation (the
      candidate set is the top-`n` matches, so a client cannot reach a deeper card)
      and the one vetted `shuffleDeck`. */
  | { op: "lookAtTopN"; n: number; filter: CardFilter; max: number }
  /** Look at the top `n` cards of the controller's deck and ATTACH the Energy
      among them straight onto the controller's own in-play Pokémon — the
      from-the-top variant of `attachEnergyFrom`, whose sources (hand, discard
      pile) are zones the player can already see (Electric Generator: "Look at
      the top 5 cards of your deck and attach up to 2 Basic {L} Energy cards you
      find there to your Benched {L} Pokémon in any way you like"; Hydreigon
      "Tri Howl": the top 3, any number of Energy, to your Pokémon).

      **"IN ANY WAY YOU LIKE" is what makes this its own op.** `attachEnergyFrom`
      attaches ONE fungible card and asks only where; here the cards are whatever
      the top `n` happened to hold, and each attached card names its OWN
      destination — so the answer is a MAP (card → Pokémon), not a list. That is
      the `attachCards` prompt (interpreter.ts), the first whose answer pairs each
      pick with a target of its own; moveEnergy's picks share one destination.

      `filter` scans cards sitting in the DECK, so it is about the PRINT:
      `basicEnergy` + `energyType` for Electric Generator's "Basic {L} Energy
      CARDS", `anyEnergy` for Hydreigon's "Energy cards" (Basic or Special).
      NEVER `providesEnergy` — provision is a while-ATTACHED property, so a card
      in a pile provides nothing and `matchesFilter` answers false for it (§6.5).

      `max` is the cap: a number is the printed "up to 2", `"any"` the printed
      "any number" (the cap is then the whole candidate set — a card may not be
      attached twice). Declinable EITHER way, like every "up to": attaching none
      is a legal answer, so the op parks whenever there is anything to attach and
      anywhere to put it rather than forcing a single-candidate board.

      `targetType` / `benchOnly` narrow the eligible targets ("your **Benched**
      **{L}** Pokémon"), through the same `attachEnergyTargets` reader
      `attachEnergyFrom`'s own riders use — one rule for "which of your Pokémon
      may receive an attach", two ops reading it.

      `discardRest` is the printed "**Discard** the other cards" (Hydreigon).
      Its sibling clause "**Shuffle** the other cards back into your deck"
      (Electric Generator) is NOT a field: those cards never left the deck, so a
      trailing `shuffleDeck` op — which knows nothing about the window — gets it
      exactly right, the same Nest Ball search-then-shuffle pattern lookAtTopN
      and searchDeck follow. A DISCARD cannot be expressed that way, because it
      must name exactly the looked-at cards that were NOT attached, and only this
      op knows which those were: after k are attached the window holds n − k, and
      a "discard the top 3" op would eat k cards deeper in the deck. The
      asymmetry is forced by what the two clauses have to know, not chosen.

      The leftovers clause runs on EVERY path — including the whiff (no matching
      Energy up there), the decline (attach none) and the board with no eligible
      target at all — which is the same rule as "a whiffed search still
      shuffles", except that here it is the difference between Tri Howl costing
      three cards and costing nothing.

      **NO `programPlayable` GATE, deliberately.** An earlier draft refused
      Electric Generator when the controller had no Benched {L} Pokémon, by the
      "an attach with no eligible target can only whiff" rule `attachEnergyFrom`
      follows. That was wrong, and the review that caught it is worth preserving:
      `programPlayable` is an AND over a program's ops, so vetoing on this op
      vetoes the CARD — including its second printed sentence, "Shuffle the other
      cards back into your deck", which always resolves. The ruling cardplay.ts
      quotes (ruling/284) draws exactly that line: playing a card for no effect is
      when the game state prevents ANY effect, and shuffling your deck after a
      known-bad top is an effect players deliberately buy. Two in-repo precedents
      agree — Great Ball and Pokégear (`lookAtTopN` + `shuffleDeck`) are
      unconditionally playable, and so is Nest Ball into a full Bench. The
      distinction from `attachEnergyFrom` is not the attach: it is that every card
      carrying THIS op also carries a leftovers clause that always happens, so
      "no target" is never "no effect". A future card where the attach is the
      whole effect would want a gate — and would want it as "no op in this program
      can do anything", not as a per-op veto.

      Never damages, so it never KOs; and it is not the §6.3 manual attach, so no
      allowance is touched. */
  | {
      op: "attachFromTop";
      n: number;
      filter: CardFilter;
      max: number | "any";
      targetType?: string;
      benchOnly?: true;
      discardRest?: true;
    }
  /** SEARCH the controller's whole deck for up to `max` Energy cards matching
      `filter` and ATTACH them straight onto the controller's own in-play Pokémon
      — the deck-SEARCH sibling of `attachFromTop`, which reaches only a window on
      the deck's top (Charizard ex "Infernal Reign": "search your deck for up to 3
      Basic {R} Energy cards and attach them to your Pokémon in any way you like";
      Janine's Secret Art: "Choose up to 2 of your {D} Pokémon. For each of those
      Pokémon, search your deck for a Basic {D} Energy card and attach it to that
      Pokémon").

      It shares `attachFromTop`'s answer shape — the `attachCards` MAP prompt,
      each picked card naming its OWN destination — because the printed clause is
      the same one: several cards, several places, chosen together. What differs
      is the SOURCE, and every difference below falls out of it:

      • **The candidate set is the whole deck**, so it is HIDDEN and it is BIG.
        Hidden is no new problem (the prompt goes to the controller alone, exactly
        as lookAtTopN's does, and this is the controller's OWN deck — a zone the
        printed word "search" hands them in full). Big is: a real deck holds a
        dozen Basic {R} Energy, and offering all twelve for a pick of three is one
        question wearing twelve hats. The offer is therefore COLLAPSED to at most
        `max` representatives per interchangeable class, the D42 rule the
        mandatory discards already run on — a Basic Energy keyed by what it
        PROVIDES, since the catalog prints the same Basic Fire Energy under four
        ids (sve-002/-010/-018 and sv03-230). Every distinguishable answer survives; only copies that could ONLY
        duplicate are dropped.
      • **There is no leftovers clause**, and so no `discardRest`. The cards not
        taken never left the deck and are not even a named window, so the printed
        "Then, shuffle your deck" is a trailing `shuffleDeck` op — the Nest Ball
        search-then-shuffle pattern every deck search in this vocabulary follows,
        and it runs on the whiff and the decline exactly as a whiffed search does.
      • **`n` has no meaning** — a search sees the whole deck. `max` is the
        printed "up to N", already a number (no `"any"`: no printed search says
        "any number", because a search that emptied your deck of Energy would be
        a different card).

      `maxPerTarget` is the printed "**for EACH of those Pokémon** … attach it to
      THAT Pokémon". Charizard's "in any way you like" allows every split
      including all three on one Pokémon; Janine's wording does not — its Energy
      go one apiece to distinct Pokémon, so the card is exactly "up to 2 Basic {D}
      Energy onto DISTINCT {D} Pokémon of yours". Modelling it that way (rather
      than as a choose-the-Pokémon prompt followed by a per-Pokémon search) is
      what keeps it to ONE decision: the Energy are fungible, so choosing which
      Pokémon get one and choosing which card goes where are the same choice, and
      the map prompt already expresses it. The rider is on the OP and not on
      `AttachTargetRiders` on purpose — the riders answer "which Pokémon may
      receive", a per-Pokémon question shared with `attachEnergyFrom`, while this
      is a constraint on the map as a whole.

      `toSelf` is the THIRD printed target rule — "attach it to **this Pokémon**"
      (Pawmot "Electrogenesis") — and the first op to read the context's
      `sourceUid`: the one eligible target is the Pokémon whose effect this is,
      wherever it sits (Electrogenesis is not Active-only — a benched Pawmot
      feeds itself, which is exactly what the source uid exists to say).
      Mutually exclusive with `targetType`/`benchOnly`/`maxPerTarget`: a card
      that names its own body prints no other target rule, and a per-target cap
      over one target is just `max`. With no source in the context (a Trainer
      program — the field is meaningless there) or the Pokémon no longer a board
      top, the target set is empty and the op whiffs into its trailing shuffle,
      like any other empty path.

      `filter` scans cards sitting in the DECK, so it is about the PRINT
      (`basicEnergy` + `energyType`), never `providesEnergy` — §6.5, the same rule
      `attachFromTop` states.

      `recordAs` files the uids ACTUALLY attached (§9.2), for a following
      `recordGate` to read. Janine is the consumer, through that gate's `contains:
      "yourActive"`: "If you attached Energy to your Active Pokémon in this way,
      it is now Poisoned."

      **NO `programPlayable` GATE**, for `attachFromTop`'s reason exactly: every
      card carrying this op also prints "Then, shuffle your deck", a clause that
      always resolves, so "no eligible target" is never "no effect" (ruling/284).
      Never damages, so it never KOs; and it is not the §6.3 manual attach, so no
      allowance is touched. */
  | {
      op: "attachFromDeck";
      filter: CardFilter;
      max: number;
      targetType?: string;
      benchOnly?: true;
      /** At most this many of the attached cards may land on any ONE Pokémon —
          the printed "for each of those Pokémon" (Janine's Secret Art). Absent =
          "in any way you like", no per-target limit. */
      maxPerTarget?: number;
      /** The printed "attach it to THIS Pokémon" (Pawmot "Electrogenesis"): the
          sole target is the Pokémon whose effect this is (`ctx.sourceUid`). No
          card prints it beside another target rule, and this member does not
          referee a co-authored one — it IGNORES `targetType`/`benchOnly` (the
          source ref is not filtered), while `maxPerTarget` would still cap the
          count. Authoring it alone is the rule; this doc is the enforcement. */
      toSelf?: true;
      recordAs?: EffectSlot;
    }
  /** Discard Energy attached to an in-play Pokémon — the §15 energy-removal
      ("hammer") family on the opponent's side (Crushing Hammer, Giacomo, Mawile
      "Special Eater") and the §8 self-discard attack COST on the controller's
      (Houndoom "Fire Blast", Charcadet "Ember", Pawmot "Electro Paws").
      `filter` narrows which ATTACHED Energy may be taken (`anyEnergy` /
      `specialEnergy`); the card always goes to its OWNER's discard pile.

      `from` names both the eligible Pokémon and how many are hit, spelled the way
      the cards are:
        • **`opponentActive`** — the opponent's Active alone (Mawile: "discard a
          Special Energy from your opponent's Active Pokémon");
        • **`opponentChosen`** — one Energy off ONE of the opponent's in-play
          Pokémon, the controller choosing both (Crushing Hammer: "…from 1 of your
          opponent's Pokémon"). Taking exactly one Energy collapses the two-step
          choice into one, so this is a single pick over the flat candidate list —
          picking the Energy IS picking the Pokémon;
        • **`opponentEach`** — one Energy off EVERY one of the opponent's in-play
          Pokémon that has a match (Giacomo: "…from each of your opponent's
          Pokémon"); a Pokémon holding none is simply skipped;
        • **`yourActive`** — the CONTROLLER's own Active, which for an attack
          effect is the printed "this Pokémon" (the attacker is by definition the
          Active, §8). The only arm that discards from the controller's own board,
          and the reason the discard pile is the HOST's rather than the opponent's.
          An Ability on a BENCHED Pokémon saying "this Pokémon" is NOT this member
          — it would need an arm reading `ctx.sourceUid` (which the context now
          carries — `attachFromDeck.toSelf` is its one reader), and no printed
          card wants one here yet, so that card stays unauthored.

      `count` says how many come off, and ONE is the default (absent = the printed
      "an Energy"):
        • **a number** — the exact-N discard ("Discard 2 Energy from this Pokémon"
          — Corviknight, Slither Wing; "Discard 3…" — Koraidon). Still MANDATORY,
          so N is a floor as well as a ceiling — except that a board holding fewer
          than N matching Energy gives up all of them ("do as much as you can");
        • **`"all"`** — the printed "Discard ALL Energy from this Pokémon"
          (Pawmot, Raichu): every match off every affected Pokémon, so it never
          asks anything.
      A count applies to the WHOLE pick, not per Pokémon, so pairing one with
      `opponentEach` ("one from each") is not a shape any card prints — and the
      union below makes it UNREPRESENTABLE rather than merely undocumented
      (`count?: never` on that arm): the interpreter would otherwise ignore the
      field and under-discard while the prompt captioned itself with the number.
      The deriver is the only author of a numeric count today and only ever pairs
      it with `yourActive`.

      MANDATORY, not "up to": the only decision is WHICH Energy, never whether — so
      unlike searchDeck / moveEnergy this park has NO decline. It parks only on a
      genuine choice: candidates that are the SAME printed card on the SAME
      Pokémon are interchangeable, and only as many of them survive as the pick
      could possibly want (interpreter.ts interchangeableCandidates keeps `count`
      per class) — so a Houndoom attacking with three {R} attached asks nothing,
      and neither does a Koraidon discarding 3 off four identical {F}, while two
      DIFFERENT Energy on one Pokémon do. An empty candidate set is a no-op
      (`programPlayable` also blocks a top-level discard that could only whiff —
      attacks do not consult it, since the attack was already legally declared).
      Never damages, so it never KOs. */
  | {
      op: "discardEnergy";
      /** `yours` — the CONTROLLER's WHOLE board (Active + Bench), the printed
          "from your Pokémon" (Chien-Pao ex "Hail Blade"). Distinct from
          `yourActive`'s "this Pokémon": Hail Blade may pull {W} off a benched
          Pokémon too, so its victim is the whole own side rather than the one
          Active. */
      from: "opponentActive" | "opponentChosen" | "yourActive" | "yours";
      filter: CardFilter;
      /** How many Energy the op takes in total: absent = one (the printed "an
          Energy"), a number = exactly that many, `"all"` = every match — which
          leaves no decision, so the op never parks under it — and `"any"` = the
          declinable "you may discard ANY amount" (Chien-Pao ex "Hail Blade"): 0
          up to every match, the player choosing HOW MANY as well as WHICH, so it
          ALWAYS parks on a non-empty board (the one count-mode with a decline). */
      count?: "all" | number | "any";
      /** File the discarded uids under this §9.2 slot so a later op can read how
          many came off — Hail Blade's "for each card you discarded in this way"
          (its `damageDefender` reads the count). Only the `"any"` mode records
          today; absent = record nothing, the shape every discard predating this
          parks into. */
      recordAs?: EffectSlot;
      /** Only meaningful with `count: "any"`: an upper BOUND on the declinable
          up-to — the printed "up to N" (Mewtwo VSTAR "Psy Purge": discard up to
          3). Absent = uncapped (0..every match, Chien-Pao ex "Hail Blade"). It
          narrows ONLY the ceiling: the pick is still 0..min(cap, matches) and
          still DECLINABLE, so a capped op parks identically to the uncapped one. */
      cap?: number;
    }
  /** The `opponentEach` sweep, split out so a count cannot ride it: "one from
      EACH" already fixes how many come off (one per Pokémon with a match), and
      the field would be silently ignored. Giacomo is the only printed member. */
  | { op: "discardEnergy"; from: "opponentEach"; filter: CardFilter; count?: never; recordAs?: never }
  /** Move up to `max` Energy from ONE of the controller's own in-play Pokémon
      to ANOTHER of their own in-play Pokémon — the §6 manual Energy-movement
      family (Energy Switch: a Basic Energy; Poppy: up to 2 any Energy). `filter`
      narrows which Energy may move (`basicEnergy` / `anyEnergy`). BOTH the taken
      Energy AND the destination are the player's choice, and every taken Energy
      comes from the SAME source Pokémon (the printed "from 1 of your Pokémon to
      another"), so this is the interpreter's first op with two COUPLED decisions:
      it PARKS on a compound `moveEnergy` prompt (the movable Energy tagged by its
      source Pokémon + the eligible destinations) and applies ATOMICALLY on resolve
      — a half-moved Energy (detached but not re-attached) is never a resting state,
      so it never splits across two parks. "Up to"/declinable like searchDeck: the
      player may move none. Not playable (programPlayable) when no Energy matches or
      the controller has fewer than two Pokémon in play (no distinct destination) —
      a play that could only whiff.

      `route` FIXES the endpoints instead of letting the player pick both:
      `benchToActive` is Armarouge's "move a {R} Energy from 1 of your BENCHED
      Pokémon to your ACTIVE Pokémon" — sources are the bench alone, the sole
      destination is the Active. One decision survives (WHICH Energy), so it
      parks on the very same compound prompt with a single-entry `destinations`;
      the dialog and the wire validator both read the prompt, so neither needs to
      know a route exists. Source and destination are disjoint by construction,
      which is why the "two Pokémon in play" rule relaxes here to "an Active and
      a benched source". Still own→own; the OPPONENT-side move (Mismagius's
      on-evolve flick) layers on later. */
  | { op: "moveEnergy"; filter: CardFilter; max: number; route?: "benchToActive" }
  /** Put the affected player(s)' whole hand back into their deck, then draw — the
      Iono/Judge hand-refresh Supporter family. `who: "you"` affects the controller
      only (Youngster: draw 5; Katy: draw 8; Brassius: draw hand+1); `who: "both"`
      affects BOTH players (Judge: "Each player shuffles their hand into their deck
      and draws 4"; Iono) — the ops that reach the OPPONENT's hand/deck. `draw` is
      how many each affected player then draws, measured off THAT player's OWN
      pre-move hand (handPlus) or Prize count (prizeCount).

      Two PLACEMENTS, and the difference is the whole strategic point of the family:
      by default the hand is shuffled INTO the deck (the combined pile is shuffled —
      the deck's order is destroyed, Youngster/Judge/Brassius/Katy); with
      `toBottom` the HAND ALONE is shuffled and placed UNDER the deck (Iono "shuffles
      their hand and puts it on the bottom of their deck"), so the deck's existing
      order — and therefore the next draws — survive untouched.

      `onlyIfAnyMoved` gates the DRAW on at least one affected player having actually
      moved a card (Iono: "If either player put any cards on the bottom of their deck
      in this way, each player draws…"): with every affected hand empty, nobody draws.
      It is an ALL-OR-NOTHING gate across the affected seats, which is why the moves
      for every seat happen before any draw does.

      Fully AUTOMATIC — there is no decision, so it never parks (like drawCards /
      discardHand / shuffleDeck), and it is always playable: NO `programPlayable`
      gate, deliberately. You may always put your hand back and draw, even from an
      empty hand. The one state where the play does nothing at all — `onlyIfAnyMoved`
      with EVERY affected hand empty — is left legal on purpose (see D39): the
      digital clients allow it, it is self-inflicted and cannot soft-lock, and gating
      it would have to reach into "playTrainer discards the played card up front"
      (the controller's hand still holds it when the gate runs). The rng reorder is intrinsic
      (the pile is shuffled here — there is no separate `shuffleDeck` op). Emits
      count-only events (HAND_SHUFFLED_INTO_DECK / HAND_TO_BOTTOM_OF_DECK per
      affected seat + CARDS_DRAWN from the draw): a hidden hand's cards stay hidden,
      so the opponent — and, for a both-player refresh, the controller about the
      opponent — learns only counts. "Your turn ends" (Katy) is NOT part of this op:
      it is the CardProgram `trainerEndsTurn` flag folded by settleProgram (the
      Koraidon `endsTurn` precedent, on the Trainer path).

      AUTHORING NOTE: the two riders are independent optionals, so combinations no
      printed card uses are representable (`onlyIfAnyMoved` without `toBottom` would
      reshuffle both decks and then draw nothing; `toBottom` with `handPlus` matches
      no card). The registry is the only author, so this is a caution, not a hole. */
  | {
      op: "handRefresh";
      who: "you" | "both";
      draw: HandRefreshDraw;
      /** Shuffle the HAND alone and put it UNDER the deck, leaving the deck's own
          order intact (Iono), instead of shuffling the hand into the deck. */
      toBottom?: true;
      /** Draw only if ≥1 affected player actually moved ≥1 card (Iono). */
      onlyIfAnyMoved?: true;
    }
  /** Pay a printed HAND COST: spend `count` cards out of the controller's own
      hand — `to: "discard"` into their discard pile, `to: "deckBottom"` under
      their deck — before the rest of the program runs. The §7/§9 "you can only
      do this if you pay" family, which prints in three wordings that mean one
      thing:

        • **Trainers** — "You can use this card **only if** you discard 2
          **other** cards from your hand." (Ultra Ball, Earthen Vessel's
          "**another** card", Superior Energy Retrieval);
        • **Abilities** — "You **must** discard a card from your hand **in order
          to use** this Ability." (Tinkaton "Gather Materials", Revavroom
          "Rumbling Engine", Meowscarada ex "Bouquet Magic", Radiant Blastoise
          "Pump Shot");
        • **the payment that is not a discard** — "Put a card from your hand on
          the bottom of your deck. **If you do**, draw cards until you have 5
          cards in your hand. (If you have no other cards in your hand, you can't
          use this card.)" (Dendra). Nothing is discarded and the sentence never
          says "cost", yet every clause of the mechanism is here: "if you do"
          makes the benefit conditional on the payment, and the parenthetical is
          the same printed PLAY GATE the Trainers state as "only if". The
          destination is the one thing that varies, so it is a field on the op and
          not a second op — WIDEN, DON'T COPY (the D44/D45/D46 pattern).

          "IF YOU DO" IS A `recordGate`, NOT SOMETHING THIS OP ENFORCES. The op
          pays what it can and returns; the ops after it run regardless (the
          short-hand branch below is "do as much as you can"). Dendra says the
          conditional out loud, so its program says it too — `recordAs: "paid"`
          here, and the draw inside a `recordGate` on that slot. The play gate
          already makes the unpaid case unreachable through the action path, so
          this changes no game a player can produce; it is the printed sentence
          being expressible at all, which is what a card making the payment
          optional would need.

      `filter` narrows WHICH cards may pay it — absent is the printed bare "a
      card" (Tinkaton, and every Trainer in the family), `anyEnergy` is "an
      Energy card" (Revavroom), `basicEnergy` + a type is "a Basic {G} Energy
      card" (Meowscarada, Radiant Blastoise). It scans cards sitting in a HAND,
      so like every pile-scanning op it reads the PRINT: never `providesEnergy`,
      which a card attached to nothing cannot answer (§6.5).

      **A COST, NOT A `BoardCondition`.** The printed "only if" is the same
      opening as Fighting Au Lait's `trainerPlayableIf`, and it is a different
      animal: a BoardCondition reads PUBLIC state and CHANGES NOTHING, while this
      spends cards out of a HIDDEN zone. It could not be a BoardCondition even in
      principle — that union's invariant is that both players can already derive
      the answer, and a hand's contents are exactly what they cannot.

      **AN OP, NOT A HANDLER FIELD — because it PARKS.** "Discard a card from
      your hand" with a mixed hand is a real decision, so the cost has to run
      through the interpreter. That is also why it is the FIRST op of its
      program rather than a field paid before the program starts, which is the
      shape `AbilityProgram.cost` used to have: that field could only express the
      FUNGIBLE case (Meowscarada's Basic {G} Energy, where copies are
      interchangeable so the first match is as good as any), and Tinkaton's "a
      card" is the general one. Both are this op now — one vocabulary, one
      payment, one event.

      **THE EVENT FOLLOWS THE DESTINATION'S VISIBILITY.** One event kind
      (HAND_COST_PAID) carries the payment either way, and its `to` is what a
      reader needs: cards paid to the DISCARD become public the moment they land,
      while cards put UNDER THE DECK go from one hidden zone to another and are
      never seen again. So the log names a count for both but a different verb for
      each, and P4's per-seat event filter has the destination to key on without
      re-deriving it from the op.

      **ORDER IS OBSERVABLE, and the printed sentence puts the cost first on
      every card in the family.** Revavroom is the witness: "discard an Energy
      card … then draw cards until you have 6 in your hand" off a hand of 5 draws
      TWO, because the payment happens first; paying afterwards would draw one.
      Dendra says the same thing about the other destination: the card put under
      the deck has LEFT the hand before "draw until you have 5" counts it, so a
      hand of 4 (Dendra included) pays 1 and draws 3.
      Tinkaton's is the quieter version — the card you discard comes from the
      pre-draw hand, so a card you are about to draw cannot pay for the draw.

      MANDATORY and EXACT: `count` is a floor as well as a ceiling, so unlike
      searchDeck / discardPileRetrieval this park has no decline (the prompt
      carries `min === max === count`). It parks only on a genuine choice —
      candidates that are the same card are interchangeable, and only as many of
      them survive as the pick could want (interpreter.ts `cardIdentity`), so
      Meowscarada with three Basic {G} Energy in hand asks nothing and neither
      does Revavroom holding two identical {R}. An offer no bigger than `count`
      auto-resolves.

      **THE PLAY GATE IS THE CARD'S OWN PRINTED RULE — which is why it vetoes,
      where D45's did not.** "You can use this card ONLY IF" makes paying a
      precondition for the WHOLE card, so an unpayable cost refuses the play
      (cardplay.ts, `handCostUnmet`) rather than resolving the rest for free.
      That is the opposite call from `attachFromTop`, and the difference is the
      text: there the veto was the ENGINE's guess that one op would whiff, applied
      through a `programPlayable` AND to a card whose other printed clause always
      resolves; here the card itself says the play is illegal. This gate is
      therefore NOT in `programPlayable` — it is checked beside
      `trainerPlayableIf`, the other printed-rule gate, and it needs something
      `programPlayable` does not have (below).

      **"OTHER" IS NOT A FIELD ON THIS OP** — it is a consequence of where the
      paying card sits, and the printed wordings agree exactly: every Trainer in
      the family says "other"/"another" and every Ability says neither, because a
      Trainer is IN THE HAND it is about to pay out of and an Ability's card is on
      the board. Dendra is the correlation's third witness and the sharpest, since
      it carries the word in its GATE rather than in its effect sentence — "(If you
      have no OTHER cards in your hand, you can't use this card.)" — which is
      exactly where the engine honours it. The apply never has to care (playTrainer
      moves the played card to the discard BEFORE the program runs, so it is not a
      candidate), but the GATE runs while it is still in hand — hence the played
      uid is excluded there, and that exclusion is the printed word "other".

      AUTHORING NOTE — the gate lives on the two PLAY paths (`playTrainer`,
      `useAbility`), which is where the printed sentence lives too: a cost is the
      price of *making a play*. `runProgram` has two other callers that gate
      nothing — attack.ts and the triggered-Ability scan (triggers.ts / flow.ts's
      on-KO stage) — so this op authored into an `attack` or a `triggered` program
      would be SKIPPED when it could not be paid rather than refusing anything,
      because a trigger has no play to refuse. No printed card does that (nothing
      charges a hand cost for a trigger firing), and if one ever appears it needs a
      decision about what an unpayable trigger even means, not a gate copied here. */
  | {
      op: "payFromHand";
      count: number;
      /** Where the paid cards go — the printed verb. `"discard"` is the whole
          discard family; `"deckBottom"` puts them UNDER the deck, in the order
          picked (Dendra). Required rather than optional so every author states
          it, the rule `chooseCards.min` set one slice earlier. */
      to: "discard" | "deckBottom";
      filter?: CardFilter;
      /** File the uids actually paid under this slot, for a later op to read —
          Superior Energy Retrieval excludes them from its retrieval, Dendra
          gates its draw on them ("if you do"). */
      recordAs?: EffectSlot;
    }
  /** REVEAL the opponent's hand, then the CONTROLLER chooses one card matching
      `filter` from it and puts it on the bottom of the OPPONENT's deck — the
      printed "Your opponent reveals their hand, and you choose a card you find
      there and put it on the bottom of their deck" (Ortega, unfiltered) and
      "…Choose a Supporter card you find there…" (Greavard "Underworld Stroll",
      the attack twin, DERIVED — see deriveAttackEffect). The first op to move a
      card between two zones the controller owns NEITHER of.

      THE REVEAL IS THE OP'S FIRST ACT and it is TOTAL: every uid in that hand
      goes out in one public `HAND_REVEALED` — that is what the printed word
      means at a table (both players see all of it), and it is emitted before
      the pick parks, so the event tells the story in the order it happened. An
      empty hand reveals honestly as zero uids (the HAND_DISCARDED "(0 cards)"
      precedent) — reachable only through the ATTACK twin, because the Trainer
      path is gated (programPlayable: an empty opponent hand is PUBLIC knowledge
      — the count shows — so "this can only whiff" is a fact the board states,
      the Catcher/Hammer class and not Poké Ball's; a FILTER's matches stay
      hidden knowledge, so the gate reads hand LENGTH and never the filter).

      The pick is MANDATORY and exactly one — "you choose a card", not "you
      may" — so the prompt is the second `min === max` chooseCards after the
      hand cost. It parks only when a real choice exists: the offer is the
      filtered hand COLLAPSED to one representative per interchangeable class
      (`cardIdentity` — the attachFromDeck key, because the catalog prints one
      Basic Energy under several ids), and a single-class offer resolves inline
      (the M1 doctrine). Collapsing is sound HERE where payFromHand must not:
      that offer names cards in a zone that stays hidden, so its collapse leaks
      the hand's duplicate structure — this hand was just revealed in full, so
      there is nothing left for the offer's shape to give away.

      The card lands UNDER the opponent's deck (their zone, their order —
      appended exactly as payFromHand's `deckBottom` appends) and is PUBLIC the
      whole way: everyone saw the reveal and watched the pick, so
      `CARD_TO_BOTTOM_OF_DECK` names the uid — the event follows the
      destination's VISIBILITY rule from the other side (Dendra's payment goes
      hidden → hidden and stays count-shaped; this one goes revealed → known
      bottom card).

      A whiff (no match for the filter — Greavard into a Supporter-less hand)
      files `[]` under `recordAs` like every recording op, so a §9.2 gate reads
      an honest no. */
  | {
      op: "bottomFromOpponentHand";
      /** Which cards may be chosen — absent is Ortega's bare "a card" (any).
          `supporter` is Greavard's printed narrowing. */
      filter?: CardFilter;
      /** File the uid actually moved under this slot for a later op to read —
          Ortega's "If you put a card on the bottom of your opponent's deck in
          this way" is a plain recordGate on it. */
      recordAs?: EffectSlot;
    }
  /** The OPPONENT of the controller may draw `count` cards — the printed "your
      opponent may draw a card" (Ortega), and the engine's first decision that
      belongs to the seat that did NOT make the play. The park carries a
      `decider` (interpreter.ts), settleProgram files it as the phase's
      `answerer`, and resolveEffect accepts only that seat's answer — the
      controller cannot answer for them, because at a table this "may" is the
      other player's to speak.

      A yes draws off the OPPONENT's own deck top (`drawToHand`, the standard
      contract); a no changes nothing and — like every decline in this engine
      (Saguaro's empty heal, a declined snipe) — emits NOTHING: no state moved,
      and the table saw the shrug.

      NEVER PARKS WHEN THE QUESTION DOES NOT EXIST: an empty opponent deck can
      only whiff the draw, so both answers are the same state and the op
      resolves silently (the M1 no-choice rule, same as drawCards' own empty-
      deck no-op). This is a DECISION rule, not a kindness — asking would park
      the game on a question with one answer.

      Deliberately NOT a rider on `drawCards`: that op is fully automatic and
      seat-fixed to the controller, and every one of its call sites relies on
      both. The name carries the printed words (the healChosen `upTo` rule) —
      a future self-side "you may draw" is a different sentence and gets its
      own field when a card prints it. */
  | { op: "opponentMayDraw"; count: number }
  /** A BOARD-CONDITION branch: run `then` when `cond` holds for the controller,
      else `otherwise` (nothing, if absent). The deterministic sibling of
      `coinFlipGate`, and spliced into the work queue by runProgram exactly the
      same way — so an op INSIDE a branch can still park, and a branch may hold
      any ops including further gates.

      One-armed is the common shape ("Draw 2 cards. If you have a Stadium in
      play, draw 2 MORE cards" — Falkner: a plain drawCards followed by a gated
      second one). `otherwise` exists for the printed "…instead", which is a real
      if/ELSE: Grusha draws to 7 when no Energy is on its board and to 5 when
      some is, and exactly ONE of those runs.

      Emits NO event, unlike coinFlipGate. A coin flip is new information both
      players must be told; a board condition is a fact they can already read off
      the table (see BoardCondition's public-state invariant), and the branch's
      own ops emit whatever actually happened. `cond` is evaluated against the
      state AS OF this op — after every earlier op in the program has applied. */
  | { op: "conditionGate"; cond: BoardCondition; then: EffectOp[]; otherwise?: EffectOp[] }
  /** AN OP-RESULT branch: run `then` when an earlier op in this same program
      filed at least one card under `slot`, else `otherwise` (nothing, if
      absent). The third and last gate, spliced into the work queue by runProgram
      exactly like the other two — so an op inside a branch can still park.

      This is the printed "**in this way**" / "**if you do**" (§9.2): Miriam's
      "If you shuffled any cards into your deck in this way, draw 3 cards" and
      Dendra's "If you do, draw cards until you have 5". `handRefresh`'s
      `onlyIfAnyMoved` rider is the same idea confined to ONE op, which is all
      Iono and Skwovet need because their move and their draw are the same op;
      this is that idea BETWEEN ops, and across a park.

      **WHY A THIRD GATE AND NOT A `BoardCondition` MEMBER.** `conditionGate` and
      the printed play gate (`trainerPlayableIf`) share one `BoardCondition`
      union, and that sharing is only sound because a board condition is a fact
      that exists BEFORE the card is played. An op result does not: nothing has
      run when a play gate is checked, so a `BoardCondition` member reading one
      would be answerable in one consumer and meaningless in the other. Keeping
      it out of that union is what makes the nonsense unrepresentable.

      Emits NO event, for `conditionGate`'s reason and one more: the branch turns
      on something the game has ALREADY announced (the recording op emitted its
      own DISCARD_RETRIEVED / HAND_COST_PAID / ENERGY_ATTACHED naming exactly
      these cards), so a gate event would be a second telling of one fact.

      **`contains` narrows WHICH of the filed cards counts** — the printed clause
      that asks not "did the earlier one do anything" but "did it reach a
      particular Pokémon". Janine's Secret Art is the one consumer: "If you
      attached Energy to your **Active** Pokémon in this way, it is now
      Poisoned", where the earlier op may well have attached two Energy and put
      neither on the Active. Absent = the plain "did anything move" test.

      `"yourActive"` holds when at least one filed uid is a card ATTACHED to the
      controller's Active right now. That is a read of the board rather than of
      the record, and it is deliberate: the record's values stay one kind of
      thing everywhere (the cards an op actually moved), and the question "where
      did it end up" is answered where every other board question is.

      **THE TWO READINGS ARE NOT THE SAME THING**, and the difference is worth
      stating exactly rather than waving at. "Was attached to the Active by that
      op" is history; "is on the Active now" is the board. They agree for every
      program that exists — but this vocabulary already contains three ops that
      would separate them if one were sequenced in between, and none of them is
      exotic: `switchActive` (a different Pokémon is now the Active, so the filed
      uids are on a BENCHED one), `moveEnergy` (own → own, which can take the
      filed card off the Active), and `discardEnergy`'s `yourActive` arm (the
      card is gone entirely). No printed card puts any of them between an attach
      and its "in this way" clause, and the one consumer — Janine's Secret Art —
      runs attach → shuffle → gate. So this is safe as authored and unsafe as a
      general rule: a new card that gates on a slot with ops like those between
      is the case to check, and the honest answer there is probably to file the
      HOST rather than to widen this. */
  | {
      op: "recordGate";
      slot: EffectSlot;
      contains?: "yourActive";
      then: EffectOp[];
      otherwise?: EffectOp[];
    };

type StatusWord = "Asleep" | "Burned" | "Confused" | "Paralyzed" | "Poisoned";

/** A Special Condition as the CARDS print it — capitalized, the form the deriver
    reads out of attack text and the form a prompt has to put back ("it is now
    Poisoned", Janine's Secret Art). The inverse of `STATUS_OF_WORD` below (the
    deriver's own `STATUS_WORDS` is a different thing — a regex alternation); both
    tables are exhaustive `Record`s over their key type, so a new condition is a
    compile error in two places rather than a silent gap in one, and a test pins
    them mutually inverse (the one drift the types cannot catch). */
export const STATUS_WORD_OF: Record<StatusName, StatusWord> = {
  asleep: "Asleep",
  burned: "Burned",
  confused: "Confused",
  paralyzed: "Paralyzed",
  poisoned: "Poisoned",
};

const STATUS_OF_WORD: Record<StatusWord, StatusName> = {
  Asleep: "asleep",
  Burned: "burned",
  Confused: "confused",
  Paralyzed: "paralyzed",
  Poisoned: "poisoned",
};

// The recognized sentence shapes, anchored end to end and compiled once
// (no /g flag — exec is stateless, so module scope is safe). Catalog rows use
// the straight apostrophe ("opponent's"); the character class also admits
// the typographic one so a re-ingest changing only punctuation cannot
// silently un-derive every status attack. {X} = the five status words;
// {N} = a positive integer.
const STATUS_WORDS = "Asleep|Burned|Confused|Paralyzed|Poisoned";
// SELF-inflicted statuses deliberately EXCLUDE Paralyzed. Official timing
// (ptcg-rules.md §12/§13.4): paralysis recovers at the Checkup after its
// owner's next turn — only if it was Paralyzed since the BEGINNING of that
// turn. Paralysis applied by the owner's own attack (i.e. at their own
// turn's end) must therefore SURVIVE the immediately-following Checkup, but
// the engine's §13.4 clear is unconditional for the ended seat (correct for
// every opponent-inflicted case). Until the condition carries an
// applied-this-turn stamp, self-paralyzing text derives to null and stays on
// the loud ATTACK_EFFECT_SKIPPED path.
const SELF_STATUS_WORDS = "Asleep|Burned|Confused|Poisoned";
const DEFENDER_NOW = new RegExp(`^Your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`);
const FLIP_DEFENDER_NOW = new RegExp(
  `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`,
);
const SELF_NOW = new RegExp(`^This Pokémon is now (${SELF_STATUS_WORDS})\\.$`);
const SELF_SLEEP_HEAL = /^This Pokémon is now Asleep\. Heal (\d+) damage from it\.$/;
const DEFENDER_POISON_N =
  /^Your opponent['’]s Active Pokémon is now Poisoned\. During Pokémon Checkup, put (\d+) damage counters on that Pokémon instead of 1\.$/;
// §11 retreat lock. The pool prints it two ways and BOTH are whole sentences,
// so both are anchored here rather than matched loosely: the bare rider (15
// printings / 13 names — Espathra, Bombirdier ×2, Tarountula, Talonflame,
// Corvisquire, Trevenant, Wugtrio, Houndstone ex, Stunfisk, Inkay, Sneasel,
// Dusknoir ×2, Onix), and Paldean Clodsire's two-clause "Poison Ring", whose
// "that Pokémon" is bound by the preceding sentence to the same Defending
// Pokémon. Matching the lock clause alone would silently swallow Clodsire's
// Poison, which is why the compound gets its own anchored pattern.
const DEFENDER_CANT_RETREAT =
  /^During your opponent['’]s next turn, the Defending Pokémon can['’]t retreat\.$/;
const DEFENDER_POISON_CANT_RETREAT =
  /^Your opponent['’]s Active Pokémon is now Poisoned\. During your opponent['’]s next turn, that Pokémon can['’]t retreat\.$/;
// Spread damage — the whole effect sentence, with the era's optional
// "(Don't apply Weakness and Resistance for Benched Pokémon.)" clarifier
// (§8.5 makes it true regardless). The main numeric damage rides the attack's
// own `damage` field; this clause is the secondary hit on the Bench — so the
// optional "also" ("This attack ALSO does N …", Cetoddle sv02-053 "Avalanche"
// after its 30 to the Active) is pure emphasis of that fact and derives to the
// SAME `spreadDamage` op: the only thing the word marks is that a main hit
// precedes it, which the `damage` field already carries either way. ONE rule
// for both wordings, unlike the snipe family where "1 of" vs "each of" pick
// genuinely different ops (damageChosen vs spreadDamage) — here the shape after
// "does" is identical, so a separate `ALSO_` regex would be a redundant twin.
const SPREAD_EACH_BENCH = new RegExp(
  `^This attack (?:also )?does (\\d+) damage to each of your opponent['’]s Benched Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);
// The CHOSEN-single benched hit SCALED by the opponent's taken Prizes — Wo-Chien
// ex sv02-027 "Covetous Ivy". The "×"/multiply sibling of the Prize-count family
// (Pecharunt ex, effects.ts's OPPONENT_PRIZES_MULTIPLY), but its target is one
// CHOSEN Benched Pokémon rather than the Defender, so it is a `damageChosen` op
// (count 1, `deals` + `perTakenPrize`) and not a pre-W/R damage fold. The "1 of"
// is what distinguishes it from SPREAD_EACH_BENCH's "each of"; the optional W/R
// clarifier tail is the spread family's, and true here for the same §8.5 reason.
const BENCHED_SNIPE_TAKEN_PRIZES = new RegExp(
  `^This attack does (\\d+) damage to 1 of your opponent['’]s Benched Pokémon ` +
    "for each Prize card your opponent has taken\\." +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);
// The flat, un-scaled RIDER: "This attack ALSO does N damage to 1 of your
// opponent's Benched Pokémon." — a SECONDARY snipe after the main damage (which
// rides the attack's own `damage` field). Miraidon "Lightning Laser", Pawmot,
// Bellibolt, Palafin, Decidueye ex, Tadbulb, … — one shape, any N. "also" marks
// the rider by intent, but the LOAD-BEARING separator from Covetous Ivy is the
// whole-sentence `\.$` right after "Pokémon": Covetous Ivy's clause continues
// ("… Benched Pokémon FOR EACH Prize …"), so the anchor — not the word "also" —
// keeps it off this path (and it derives via BENCHED_SNIPE_TAKEN_PRIZES anyway).
// "1 of" separates it from SPREAD_EACH_BENCH's "each of". Refuses Flamigo's "If
// Flamigo is on your Bench, …" (a board-condition gate, off the `^This` anchor),
// "2 of" (count ≠ 1), and "1 of YOUR Benched" (self-target) by the exact phrase.
const ALSO_BENCHED_SNIPE = new RegExp(
  `^This attack also does (\\d+) damage to 1 of your opponent['’]s Benched Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);
// The ANY-target snipe: "This attack does N damage to 1 of your opponent's Pokémon."
// — the WHOLE attack (no `damage` field), a chosen hit on the Active OR a Benched
// Pokémon (Fezandipiti ex "Cruel Arrow", Rotom "Linear Attack", Paldean Tauros
// "Aqua Dive", Bellibolt ex, Kilowattrel). "Pokémon" (not "Benched Pokémon") is the
// tell: the target may be the Active, where Weakness/Resistance DO apply (§8.5), so
// the op is `target: "opponentAny"`. The tail is an ALTERNATION: the SAME Benched
// clarifier (true only for a Benched pick, no op change), OR — captured as group 2 —
// Umbreon "Feint Attack"'s "This attack's damage isn't affected by Weakness or
// Resistance[, or by any effects on that Pokémon]." (sv03-130), which sets `ignoreWR`.
// The ", or by any effects on that Pokémon" clause is optional so both the modern SV
// wording and the bare classic one derive the same flag. Refuses the "Benched"-only
// snipes (that clause names the zone) and Pawmot ex / Magikarp (a leading discard
// cost / coin flip, off the `^This attack does` anchor).
const CHOSEN_ANY_TARGET = new RegExp(
  `^This attack does (\\d+) damage to 1 of your opponent['’]s Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\)` +
    `|( This attack['’]s damage isn['’]t affected by Weakness or Resistance` +
    "(?:, or by any effects on that Pokémon)?\\.))?$",
);
// The self-discard attack COST (§8): "an" leaves the player one pick per
// distinct Energy attached, "{N}" asks for exactly that many, "all" strips the
// lot. Deliberately NOT matching the TYPED variants ("Discard a {L} Energy…",
// "Discard 2 {R} Energy…", the older "Discard a Fire Energy…") — those need an
// energy-of-type filter this engine does not have yet, and "{L}" means an Energy
// that PROVIDES {L} rather than a Basic Lightning card, so a loose regex here
// would discard the wrong card on a real board. "this Pokémon" is the Active by
// §8 (only the Active attacks), which is what `from: "yourActive"` encodes.
const SELF_DISCARD_ONE = /^Discard an Energy from this Pokémon\.$/;
const SELF_DISCARD_N = /^Discard (\d+) Energy from this Pokémon\.$/;
const SELF_DISCARD_ALL = /^Discard all Energy from this Pokémon\.$/;
// The OPPONENT-side twin of the self-discard, printed on attacks rather than
// Trainers (Pincurchin "Needle Crush", Gumshoos "Crunch", Dragonite V "Hyper
// Beam") and half the time behind a flip (Dedenne "Energy Munch", Maschiff
// "Crunch", Tympole "Screw Tail", Yveltal "Destructive Beam"). Same op as
// Mawile's Ability, one filter wider: an attack takes ANY Energy, not just a
// Special one.
//
// Krookodile (sv01-117) is the trap these two must not fall into: "Flip a coin
// UNTIL you get tails. For each heads, discard an Energy from your opponent's
// Active Pokémon." — a repeat count this engine cannot express — ENDS in the
// bare pattern's exact words, and deriving it would silently discard once.
// TWO things keep it out, and it takes both: the leading `^`, and the fact that
// the clause reads lowercase "discard" mid-sentence where the pattern needs a
// capital. Neither alone is enough (dropping `^` still misses on the capital;
// adding /i still misses on the anchor) — so a future ingest that normalizes
// capitalisation would put the whole weight on the anchor. Do not add /i here.
const OPPONENT_ACTIVE_DISCARD = /^Discard an Energy from your opponent['’]s Active Pokémon\.$/;
const FLIP_OPPONENT_ACTIVE_DISCARD =
  /^Flip a coin\. If heads, discard an Energy from your opponent['’]s Active Pokémon\.$/;
// The reveal-and-bottom attack sentence (Greavard "Underworld Stroll") — the
// whole effect, anchored end to end like every rule here. Only the SUPPORTER
// narrowing is derived: Ortega's unfiltered Supporter form carries a second
// sentence (an opponent draw behind a §9.2 gate) that no attack prints, so it
// is registry-authored and this anchor must not loosen toward it.
const REVEAL_BOTTOM_SUPPORTER =
  /^Your opponent reveals their hand\. Choose a Supporter card you find there and put it on the bottom of their deck\.$/;
// The recoil clause (Skeledirge sv01-038 "Blazing Shout") — a self-damage the
// attack does IN ADDITION to its main numeric damage, hence the printed "also".
// Anchored verbatim like every rule here: a hypothetical "This Pokémon does N
// damage to itself." without the "also" (a pure-recoil attack with no defender
// damage — none in sv01–03), or a "This attack …" phrasing, stays on the loud
// skipped path. No /i, for the family's stated reason: capitalisation + the
// anchors are what keep a mid-sentence clause off the derived path.
const SELF_DAMAGE = /^This Pokémon also does (\d+) damage to itself\.$/;
// The additive damage-scaling family — "This attack does N more damage for each
// <resource>.", anchored end to end like every rule here. It is NOT a
// deriveAttackEffect op: this folds N × (a resource counted at declaration) into
// the printed base BEFORE the §8.5 W/R pipeline (attack.ts), where the deriver's
// ops all run AFTER damage — so it lives in its own reader (deriveAttackDamageBonus
// below), not the op switch. Two count sources read today, one regex each, told
// apart ONLY by the tail:
//   • the attacker's OWN damage counters (Paldean Tauros sv02-028 "Raging Horns",
//     fix-attacker "Rage"), and
//   • the opponent's TAKEN Prizes (Charizard ex sv03-125 "Burning Darkness").
// The word "more" is the DISCRIMINATOR between two sibling families that share a
// count evaluator but fold differently. With "more" it is ADDITIVE (`+`): fold
// `per × count` ONTO a printed base (the reader here). WITHOUT "more" it MULTIPLIES
// (`×`): the printed N is the PER-unit and `per × count` is the WHOLE damage, no
// base to add ("This attack does N damage for each Prize card your opponent has
// taken." — Pecharunt ex sv06.5-039 60×, Annihilape sv01-109 70×). That is a
// DISTINCT fold, not a `count` member, so it has its OWN regex + reader
// (OPPONENT_PRIZES_MULTIPLY / deriveAttackDamageMultiplier below) — the parse is
// the same `{per, count}` shape (the count evaluator is reused UNCHANGED), only
// attack.ts's fold differs. Each additive regex must therefore REFUSE its
// no-"more" twin (the multiply reader owns it), and vice versa. The anchored
// whole-sentence match and the capital `This` are the rest of the guard. No /i,
// for the family's stated reason: the anchors and the capital first word are what
// keep a mid-sentence clause off this path.
const SELF_COUNTER_SCALE =
  /^This attack does (\d+) more damage for each damage counter on this Pokémon\.$/;
const OPPONENT_PRIZES_SCALE =
  /^This attack does (\d+) more damage for each Prize card your opponent has taken\.$/;
// The "×"/multiply twin of OPPONENT_PRIZES_SCALE — the SAME Prize-count source, no
// "more": the whole damage is `per × count`, the printed base dropped (attack.ts).
// Refuses Wo-Chien ex's benched-target print ("… to 1 of your opponent's Benched
// Pokémon for each Prize …") by the mid-sentence text the anchors exclude, and
// Chien-Pao ex's discarded-Energy count ("… for each card you discarded in this
// way.") by the tail.
const OPPONENT_PRIZES_MULTIPLY =
  /^This attack does (\d+) damage for each Prize card your opponent has taken\.$/;
// The retreat-cost READER pair — the first count source that reads a DERIVED
// board value (continuous.ts effectiveRetreatCost on the DEFENDER) rather than a
// raw field. Both sentences are printed verbatim on real cards, char-for-char
// identical apart from the missing "more":
//   additive  — Heracross sv01-002 "Superpowered Throw" (10+), Spidops ex
//               sv01-019/-223/-243 "Wire Hang" (90+), Sharpedo sv03-047
//               "Aqua Impact" (10+): base + 30 per {C}.
//   multiply  — Stoutland sv03-172 "Chomp Chomp Panic" (50×): 50 per {C} and
//               NOTHING else, so a retreat-0 defender takes 0.
// `{C}` is a literal brace token in the printed text, escaped here; the
// apostrophes are ASCII (verified against the D1 rows), and `Pokémon` carries
// the real é — a lookalike would silently fall off the path.
const RETREAT_COST_SCALE =
  /^This attack does (\d+) more damage for each \{C\} in your opponent's Active Pokémon's Retreat Cost\.$/;
const RETREAT_COST_MULTIPLY =
  /^This attack does (\d+) damage for each \{C\} in your opponent's Active Pokémon's Retreat Cost\.$/;
// The CONDITIONAL flat bonus (D115) — "If <clause>, this attack does N more
// damage.", the additive family's third arithmetic shape and the first one whose
// count is not a count at all: the clause is a 0-or-1 INDICATOR, so `per × count`
// is the printed N when it holds and 0 when it does not (see
// DamageCountSource.boardCondition below). 32 distinct sentences / 43 printings in
// the ingested pool, ALL of them leading-`If` — the pool holds no "… more damage
// if …" trailing form and no "If …, this attack does N LESS damage." twin, and no
// sentence combines a leading `If` with a trailing "for each", so this bucket and
// the three scaling ones above are disjoint by construction.
//
// No /i, and anchored whole-sentence with a REQUIRED trailing period, exactly like
// its neighbours — the anchor is load-bearing here in a way it is not anywhere
// else, because it is the only thing keeping two large families off this path:
//   • "Flip a coin. If heads, this attack does 20 more damage." (26 printings) — a
//     genuinely different mechanism that must announce its flip, and one that can
//     never reach an anchored `^If` since the flip sentence always precedes it;
//   • Cresselia's "You may turn 1 of your face-down Prize cards face up. If you
//     do, this attack does 90 more damage." — a leading OPTIONAL action whose
//     "if you do" reads a choice, not the board.
// Both stay on the loud ATTACK_EFFECT_SKIPPED path, which is where they belong.
const CONDITIONAL_DAMAGE_BONUS = /^If (.+), this attack does (\d+) more damage\.$/;
/** The printed clauses this family understands, keyed CHAR-FOR-CHAR on the text
    between the leading "If " and the ", this attack does" — a Map rather than an
    object literal on purpose: the key is arbitrary PRINTED text, and an object
    lookup on arbitrary text can hit `Object.prototype` ("constructor",
    "toString", …) and hand back something that is not a `BoardCondition` at all.
    A Map has no inherited keys.

    NINETEEN entries which, with the two patterns below them, cover 23 of the
    pool's 26 distinct clauses / 41 of its 43 printings (the count moves with the
    table — it was 17/21/37 at D122 and is re-stated by each slice that adds a
    row, most recently D124's promoted-this-turn clause, which is the only row
    here carrying THREE printings). The first two reuse
    `BoardCondition` members that ALREADY existed — built in the 2026-07-21
    board-condition slice (D40) for Falkner's `conditionGate` and Fighting Au
    Lait's play gate — which makes this family the vocabulary's FOURTH consumer
    and the first to reach it through printed ATTACK text rather than a registry
    row. The rest are members added by this family itself (D115, then D116).

    THE TABLE IS WHERE THE PRINTED PRONOUN RESOLVES (D116). "this Pokémon" on an
    attack is the attacking Active — true by §8, since only the Active declares an
    attack — so it maps onto the seat-relative `yourActiveDamaged` (and, D117, onto
    `yourActivePoisoned`). That translation belongs HERE and nowhere else:
    `conditionHolds` is shared with the play gate and the HUD, where a self-pronoun
    has no referent at all. Note how little separates the two Poison rows: "this
    Pokémon is Poisoned" and "your opponent's Active Pokémon is Poisoned" are one
    possessive apart and read OPPOSITE boards, which is why the keys are whole
    printed clauses and never substrings.

    `Pokémon` carries a REAL U+00E9 é in every key that spells it and every
    apostrophe is ASCII, both verified against the local D1 rows; a lookalike
    character would silently un-map the clause. `Poisoned`, `Special Condition`,
    `Benched`, `Active` and `Evolution` are CAPITALISED as printed, and the
    matcher has no /i. The remaining printed clauses in the pool stay
    deliberately UNMAPPED and therefore LOUD (an unrecognised clause returns null
    and keeps its ATTACK_EFFECT_SKIPPED row) — each is a future one-row extension,
    and "loud" is strictly better than silently scoring the bonus at 0.

    This table holds only the LITERAL clauses. Since D118 a clause that is a
    TEMPLATE — one shape varying on a single token — is matched by an anchored
    pattern instead (SELF_ENERGY_ATTACHED_CLAUSE below); `boardConditionForClause`
    consults this table FIRST, so a literal row always wins. */
const CONDITIONAL_DAMAGE_CLAUSES = new Map<string, BoardCondition>([
  // Palossand sv02-096 "Earthen Power" (+80) and its siblings — §7.3 OWNERSHIP,
  // not mere presence: the opponent's Stadium in the shared zone does not count.
  ["you have a Stadium in play", { kind: "yourStadiumInPlay" }],
  // Gyarados sv02-043 "Revengeful Storm" (+100) — §14, the comeback clause: you
  // have MORE prizes left, i.e. you are BEHIND on prizes taken.
  ["you have more Prize cards remaining than your opponent", { kind: "morePrizesThanOpponent" }],
  // Gyarados ex sv01-045/-225 "Tyrannical Tail" (+180), Meowscarada ex
  // sv02-015/-231/-256/-271 "Scratching Nails" (+120) — "already", read at
  // declaration.
  [
    "your opponent's Active Pokémon already has any damage counters on it",
    { kind: "opponentActiveDamaged" },
  ],
  // Seviper sv02-137 "Cross-Cut" (+50), Houndoom sv03-133 "Daring Strike" (+70),
  // Toxicroak sv06.5-024 "Clean Hit" (+90) — D105's Evolution reading.
  [
    "your opponent's Active Pokémon is an Evolution Pokémon",
    { kind: "opponentActiveIsEvolution" },
  ],
  // Talonflame sv02-030 "Fiery Breeze" (+90), Darmanitan sv03-035 "Damage
  // Counterpunch" (+60) — the printed "this Pokémon" resolving to the attacker's
  // own Active (see the pronoun note above). Note the missing "already": that
  // word appears ONLY on the opponent-facing twin two rows up, and is the sole
  // lexical discriminator between the two damage-counter clauses.
  ["this Pokémon has any damage counters on it", { kind: "yourActiveDamaged" }],
  // Tyranitar ex sv03-066/-211 "Lightning Rampage" (+100) — the two printings are
  // byte-identical in rules text, so one fixture serves both ids.
  ["your Benched Pokémon have any damage counters on them", { kind: "yourBenchDamaged" }],
  // Seviper sv01-128 "Venoshock" (+120) and Paldean Clodsire sv03-129, same
  // attack NAME and same clause on two different cards. NOT the same clause as
  // Okidogi ex sv06.5-036/-082/-090's "If THIS Pokémon is Poisoned" (+130), which
  // is a different, still-unmapped member.
  ["your opponent's Active Pokémon is Poisoned", { kind: "opponentActivePoisoned" }],
  // Sableye sv02-136 "Unseen Claw" (+70) — the pool's only "is affected by"
  // clause. The setter form ("is now affected by that Special Condition",
  // Vivillon sv01-010) reads similarly and is a different sentence entirely; the
  // whole-sentence anchor is what keeps it off this path.
  [
    "your opponent's Active Pokémon is affected by a Special Condition",
    { kind: "opponentActiveHasSpecialCondition" },
  ],
  // Okidogi ex sv06.5-036/-082/-090 "Chain-Crazed" (+130) — the three printings
  // are byte-identical in rules text, so one fixture serves all three. The
  // printed "this Pokémon" resolves to the attacker's own Active here, exactly
  // as Talonflame's does four rows up; the CROSS-BOARD twin two rows up is one
  // possessive apart, and the pool prints no third reading of "is Poisoned".
  ["this Pokémon is Poisoned", { kind: "yourActivePoisoned" }],
  // Ceruledge sv02-098 "Fighting Sword" (+100) — the pool's only printing of the
  // rule-box clause, and NOT a `hasRuleBox` read: the sentence names ex and V and
  // nothing else, so a VMAX/VSTAR Active does not satisfy it.
  [
    "your opponent's Active Pokémon is a Pokémon ex or Pokémon V",
    { kind: "opponentActiveIsExOrV" },
  ],
  // Krokorok sv01-116 "Payback" (+90) and Houndstone sv03-101 "Two Four-ocious"
  // (+120) — ONE member at two values, and still two LITERAL rows rather than a
  // D118 template. Two things vary between these sentences, not one: the count
  // LIST and the grammatical number that agrees with it ("1 Prize card" vs
  // "2 or 4 Prize cards"), and a pattern loose enough to span both would also
  // accept "exactly 2 Prize card remaining", text the game does not print. The
  // printed space is bounded and tiny besides (a Prize count is 0-6, and the
  // whole pool holds three distinct lists across every use of "exactly"). Rows
  // are matched FIRST, so a template can still be added later without
  // re-interpreting either of these.
  [
    "your opponent has exactly 1 Prize card remaining",
    { kind: "opponentPrizesRemaining", counts: [1] },
  ],
  [
    "your opponent has exactly 2 or 4 Prize cards remaining",
    { kind: "opponentPrizesRemaining", counts: [2, 4] },
  ],
  // Absol ex sv03-135/-214 "Cursed Slug" (+120) — the two printings are
  // byte-identical in rules text, so one fixture serves both ids. "their hand",
  // possessive, is the cross-board half of the pair; the own-hand clause below
  // reads BOTH hands and neither reads a hand's contents.
  ["your opponent has 3 or fewer cards in their hand", { kind: "opponentHandAtMost", count: 3 }],
  // Bronzong sv03-145 "Extrasensory" (+90). Bronzor sv03-144 "Mirror Draw"
  // prints this clause's exact words ("Draw cards until you have the same number
  // of cards in your hand as your opponent.") as a DRAW effect — a substring
  // matcher would score a damage bonus off the pre-evolution; the whole-sentence
  // anchor is what keeps it off this path.
  ["you have the same number of cards in your hand as your opponent", { kind: "handSizesEqual" }],
  // Falinks sv02-119 "Reckless Charge Together" (+90) — a LITERAL row although
  // exactly one token varies, which is the one place this family departs from
  // D118. A template is safe only when the varying token has a CLOSED vocabulary
  // to fail against: the energy tokens are nine codes and nine names, the type
  // tokens eleven words, so an unknown token falls through and stays LOUD. A card
  // NAME is open-ended, and `^(.+) is on your Bench$` has nothing to reject
  // against — it would read "a Pokémon with an Ability is on your Bench" as a
  // card called "a Pokémon with an Ability" and answer FALSE forever, silently.
  // Wrong-with-no-failure is the one outcome this family refuses. So: one row per
  // printing, and the pool prints one (Flamigo sv03-185 prints the same clause
  // under a different CONSEQUENT, which the leading-If skeleton never reaches).
  ["Falinks is on your Bench", { kind: "yourBenchHasNamed", name: "Falinks" }],
  // Absol sv06.5-030 "Darkfall" (+50) — a LITERAL row although the member is
  // parameterised, which is D119's corollary rather than a departure from D118:
  // TWO tokens vary here in principle, the threshold and the energy, so there is
  // no single-token pattern to write. And there is nothing to generalise FROM —
  // "at least" and "Energy in play" are each a hapax in 978 cards, so a template
  // would be parameterising over a pool of one on both axes at once. The nearest
  // real family is the "has any <energy> Energy attached" template above, which
  // varies on one token and reads a different board. Rows are matched FIRST, so
  // the day a second threshold prints, a template can be added over both without
  // re-interpreting this one.
  [
    "you have at least 3 {D} Energy in play",
    { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 },
  ],
  // Greedent sv01-152 "Enhanced Fang" (+80) — the pool's only printing, with no
  // reprint, and the last clause in this family that reads a field the model
  // already carries. The printed "this Pokémon" resolves to the attacker's own
  // Active here exactly as Talonflame's and Okidogi ex's do. Two OTHER cards
  // print this clause's exact words under a different consequent — Genesect
  // sv06.5-040's "ACE Nullifier" Ability shares the whole prefix ("If this
  // Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC
  // cards from their hand.") and Stunfisk sv03-112's "Custom Trap" carries it as
  // a middle conjunct — so a substring matcher would score a damage bonus off two
  // Abilities. The whole-sentence anchor is what keeps them off this path.
  ["this Pokémon has a Pokémon Tool attached", { kind: "yourActiveHasToolAttached" }],
  // Pikachu swsh10.5-027 "Buddy Bolt" (+30) — the pool's only printing, with no
  // reprint, and the family's first clause that reads a TURN EVENT rather than a
  // board. It costs no new state: §7.2's one-Supporter-per-turn cap already
  // lives on `state.allowances.supporterPlayed`, whose lifetime IS "during this
  // turn". No pronoun to resolve either — the sentence says "you", so the
  // seat-relative reading is the printed one and the table translates nothing.
  // The pool's only other "you played" sentence is Crobat sv06.5-029's "Shadowy
  // Envoy" Ability, which names a SPECIFIC card ("if you played Janine's Secret
  // Art from your hand this turn") and drops the "during" — two differences, and
  // the whole-sentence anchor refuses it on either one.
  [
    "you played a Supporter card from your hand during this turn",
    { kind: "youPlayedSupporterThisTurn" },
  ],
  // Revavroom ex sv06.5-015/-081 "Accelerator Flash" (20+, +120) and Golisopod
  // swsh10.5-026 "First Impression" (20+, +90) — THREE printings on ONE row.
  // D116's pronoun rule: "this Pokémon" is the attacker, which for a damage
  // bonus is the reader's Active, so the member is named for the board fact.
  //
  // ONE ROW AND NOT A TEMPLATE, even though the pool prints it at two different
  // amounts: the amount is captured by the OUTER skeleton ("this attack does
  // (\d+) more damage"), so the clause itself is byte-identical across all
  // three printings. Nothing varies inside the clause; there is nothing to
  // parameterise (D118's rule read from the other end).
  //
  // The NEGATIVE twin is not a near-miss of this row and never reaches it:
  // Palafin sv03-062/-200 "Justice Kick" prints "If this Pokémon didn't move
  // from the Bench to the Active Spot this turn, this attack does nothing." — a
  // different CONSEQUENT (so the outer anchor refuses it before this table is
  // consulted), a different verb form, and "the Bench" without the possessive.
  // Same state underneath, and since D125 it SIMULATES, off its own skeleton and
  // its own table (ATTACK_REQUIREMENT_CLAUSES below) — deliberately not off this
  // one, so a positive clause and its negative can never be confused for each
  // other by a lookup that lost track of which consequent it came from.
  [
    "this Pokémon moved from your Bench to the Active Spot this turn",
    { kind: "yourActivePromotedThisTurn" },
  ],
]);
// The printed energy-type notations, BOTH of them: the modern brace CODE
// ("Discard a {L} Energy" — Kilowattrel, Arcanine ex) and the spelled-out name
// the swsh-era prints carry ("Discard a Fire Energy" — Charmeleon, Charizard).
// One map so the two can never drift, and so the accepted vocabulary is a
// single list rather than a regex alternation somebody edits by hand.
//
// {C} and {N} are ABSENT, matching BASIC_ENERGY_TYPES' own rule (§6.1: Colorless
// is a cost symbol, Dragon has no Basic Energy). No card prints "discard a {C}
// Energy", and admitting one would be actively wrong: Colorless is the
// conservative provision FALLBACK for every unauthored Special Energy, so a
// {C} filter would quietly match cards nobody meant. Unmapped codes fall
// through to the loud skipped path — energyTypesAreCanonical (the test) pins the
// values to BASIC_ENERGY_TYPES so a re-ingest adding a type is caught here.
export const ENERGY_TYPE_BY_CODE: Readonly<Record<string, BasicEnergyType>> = {
  G: "Grass",
  R: "Fire",
  W: "Water",
  L: "Lightning",
  P: "Psychic",
  F: "Fighting",
  D: "Darkness",
  M: "Metal",
  Y: "Fairy",
};
/** The spelled-out notation, keyed straight off BASIC_ENERGY_TYPES rather than
    re-listed — so the two notations cannot resolve to different vocabularies, and
    a type added to the schema is admitted here by construction. */
const ENERGY_TYPE_BY_NAME: Readonly<Record<string, BasicEnergyType>> = Object.fromEntries(
  BASIC_ENERGY_TYPES.map((type) => [type, type]),
);
/** The PARAMETERISED clause (D118), the conditional-damage family's first:
    "If this Pokémon has any <energy> Energy attached, this attack does N more
    damage." — Scovillain sv01-029/-202 (`{R}`, +90), Galvantula sv06.5-002
    (`{L}`, +80), Cetitan sv02-055 and Tinkaton sv02-105 (`Special`, +140/+90).

    Four printings, four sentences, ONE shape — so it does not go in
    `CONDITIONAL_DAMAGE_CLAUSES` as four literal rows. That table keys whole
    printed clauses because its clauses genuinely differ; these differ on exactly
    one TOKEN, and the pool holds nine energy codes in two rival notations, so
    the literal form costs a row (and, without a parameter, a union member) per
    type per notation forever. Anchored whole-clause all the same: the capture is
    the token alone, and the clause table is consulted FIRST, so this pattern can
    only ever see text no literal row claimed.

    The token vocabulary is a `Map`, for D115's reason one level down: the key is
    arbitrary PRINTED text and an object lookup on arbitrary text can hit
    `Object.prototype` ("constructor", "toString", …) and hand back something
    that is not an energy type at all. It is built FROM the two notation maps
    above rather than re-listed, so the three cannot drift and a type added to
    BASIC_ENERGY_TYPES is admitted here by construction.

    Both notations are carried because the pool prints both and they are split
    cleanly by SET: sv01/sv02/sv03/sv06.5 use brace codes exclusively, swsh10.5
    spells the names out exclusively ("Water Energy", "Psychic Energy") with zero
    brace codes in 25 matching cards. Today all four printings of THIS sentence
    are brace-coded, but a code-only parser would silently skip a whole set the
    moment one of its cards prints the shape.

    `Special` is the CARD CLASS, not a tenth type — a different axis, and the
    reason the parameter is `BasicEnergyType | "special"` rather than a widened
    type union. `{C}` is absent for the same reason it is absent from
    ENERGY_TYPE_BY_CODE: Colorless is the conservative provision fallback for
    every unauthored Special Energy, so a `{C}` clause would quietly match cards
    nobody meant. An unresolvable token falls through to null and stays LOUD. */
const SELF_ENERGY_ATTACHED_CLAUSE = /^this Pokémon has any (.+) Energy attached$/;
const CLAUSE_ENERGY_TOKENS: ReadonlyMap<string, BasicEnergyType | "special"> = new Map([
  ...Object.entries(ENERGY_TYPE_BY_CODE).map(
    ([code, type]) => [`{${code}}`, type] as [string, BasicEnergyType | "special"],
  ),
  ...Object.entries(ENERGY_TYPE_BY_NAME).map(
    ([name, type]) => [name, type] as [string, BasicEnergyType | "special"],
  ),
  ["Special", "special"] as [string, BasicEnergyType | "special"],
]);

/** The family's SECOND parameterised clause: "If your opponent's Active Pokémon
    is a <type> Pokémon, this attack does N more damage." — Sylveon swsh10.5-035
    "Wonder Flash" (+90, `Dragon`), and today that is the whole census.

    A template on ONE printing, deliberately. D118's test is "does exactly one
    TOKEN vary", not "are there enough rows yet to bother", and here the token is
    a type name that is byte-identical to the value in `Card.types` — so the
    pattern costs the same as the literal row would and covers the other ten
    types for free. It is the mirror-image call to the Falinks row in the table
    above, and the discriminator between them is not the printing count: it is
    whether the token has a CLOSED vocabulary to be rejected against.

    `CLAUSE_POKEMON_TYPES` is that vocabulary, a `Map` for D115's reason (an
    object lookup on arbitrary printed text can hit `Object.prototype`) built
    FROM `POKEMON_TYPES` so it cannot drift from the schema's list. An
    unresolvable token falls through to null and stays LOUD — which is what
    stops this pattern swallowing the two OTHER "is a … Pokémon" readings the
    pool prints: "is a Basic Pokémon" (sv03-134) captures `Basic`, which is not a
    type and never resolves, and "is an Evolution Pokémon" cannot even reach here
    (its "an" fails the anchor, and its literal row wins first regardless).

    The article is hard-coded to "a" because all eleven type names begin with a
    consonant; a vowel-initial type would need "an" and would break this pattern
    LOUDLY rather than silently, which is the right failure.

    Note the SET's other convention does not bite here: swsh10.5 spells energy
    names out where sv01-sv03 print brace codes (D118), but a Pokémon's TYPE is
    printed as the bare word in both eras, and the pool contains no `{D} Pokémon`
    CONDITION at all — the 17 brace-coded type sentences are all selectors and
    counters on other skeletons. When one is printed, it is a row in this map. */
const OPPONENT_ACTIVE_TYPE_CLAUSE = /^your opponent's Active Pokémon is a (.+) Pokémon$/;
const CLAUSE_POKEMON_TYPES: ReadonlyMap<string, PokemonType> = new Map(
  POKEMON_TYPES.map((type) => [type, type] as [string, PokemonType]),
);

/** The printed clause between the leading "If " and the ", this attack does" →
    a `BoardCondition`, or null when nothing claims it (which keeps the sentence
    on the loud ATTACK_EFFECT_SKIPPED path — never a silent 0).

    Two passes, in this order and no other: the LITERAL table first, then the
    parameterised patterns. Literals win by construction, so adding a template
    can never re-interpret a clause a row already owns. */
function boardConditionForClause(clause: string): BoardCondition | null {
  const literal = CONDITIONAL_DAMAGE_CLAUSES.get(clause);
  if (literal !== undefined) return literal;
  const selfEnergy = SELF_ENERGY_ATTACHED_CLAUSE.exec(clause);
  if (selfEnergy !== null) {
    const energy = CLAUSE_ENERGY_TOKENS.get(selfEnergy[1] ?? "");
    if (energy !== undefined) return { kind: "yourActiveHasEnergyAttached", energy };
  }
  const activeType = OPPONENT_ACTIVE_TYPE_CLAUSE.exec(clause);
  if (activeType !== null) {
    const type = CLAUSE_POKEMON_TYPES.get(activeType[1] ?? "");
    if (type !== undefined) return { kind: "opponentActiveHasType", type };
  }
  return null;
}

// The REQUIREMENT skeleton (D125) — "If <clause>, this attack does nothing." The
// clause family's second consequent, and the first that is not a damage bonus at
// all: nothing is added, the whole attack is CANCELLED when the clause holds.
//
// THE POLARITY LIVES HERE, IN THE SKELETON, NOT IN THE VOCABULARY. Every one of
// the pool's six distinct "does nothing" clauses is a NEGATIVE sentence —
// "didn't move", "has no damage counters", "you can't", "If tails", "you didn't
// play", "you can't shuffle" — and that is the GRAMMAR OF THE MECHANIC rather
// than an accident of this pool: a card prints "does nothing" precisely to state
// a REQUIREMENT, and English states a requirement by naming its failure. So the
// table below reads the printed NEGATIVE clause and hands back the POSITIVE
// board fact the attack requires, and `attack.ts` cancels when that fact is
// ABSENT. `BoardCondition` gains no `{ kind: "not", cond }` member: it would make
// the vocabulary recursive — five consumers (`conditionHolds`, `conditionNote`,
// `redact.ts`, `cardplay.ts`'s playability descent, `registry.ts`) each owing a
// recursion arm, and `conditionNote` owing a readable negated phrasing English
// does not supply — to buy a spelling nothing in 978 cards asks for. If a card
// ever prints a POSITIVE clause under this consequent ("If your opponent's
// Active Pokémon is a Basic Pokémon, this attack does nothing"), THAT is the
// warrant, and the cheap answer then is a second table of positive-sense rows,
// still without touching the union (D121: a shape being spellable never warrants
// spelling it; a second printing does).
//
// Anchored whole-sentence with the required trailing period, no /i, exactly like
// CONDITIONAL_DAMAGE_BONUS — and the anchor is doing the same load-bearing work.
// It admits the three sentences below and refuses the rest of the family's 19
// printings on the CLAUSE (they reach the table and miss), never on the shape:
//   • "Flip a coin. If tails, this attack does nothing." (12 printings) — the
//     coin-flip mechanism, and the flip sentence in front already denies it `^If`;
//   • "If you can't, this attack does nothing." (3 printings) — ANAPHORIC, its
//     "can't" pointing back at a cost sentence this reader cannot see;
//   • Sharpedo sv06.5-034's "If you didn't play Xerosic's Machinations from your
//     hand during this turn, …" — a specific NAMED card, and multi-sentence, so
//     the anchor refuses it twice over.
const ATTACK_DOES_NOTHING = /^If (.+), this attack does nothing\.$/;
/** The printed NEGATIVE clauses this family understands → the POSITIVE board
    fact the attack REQUIRES. Keyed char-for-char on the text between the leading
    "If " and the ", this attack does", and a Map for CONDITIONAL_DAMAGE_CLAUSES'
    reason: arbitrary printed text must not reach `Object.prototype`.

    Two rows, two cards, three printings — and note that BOTH reuse a
    `BoardCondition` member that already existed, so this slice buys no new
    vocabulary at all. Every remaining "does nothing" clause in the pool stays
    UNMAPPED and therefore LOUD.

    ⚠️ The keys are the printed negatives and their traps are real: Palafin says
    "the Bench", NOT "your Bench" (no possessive — its positive twin one table up
    DOES carry it), and "didn't" with an ASCII apostrophe (the whole 978-card
    pool holds zero U+2019). `Pokémon` carries a real U+00E9. */
const ATTACK_REQUIREMENT_CLAUSES = new Map<string, BoardCondition>([
  // Palafin sv03-062/-200 "Justice Kick" ({W}{W}, 210) — the exact NEGATIVE twin
  // of D124's promoted-this-turn row, reading the same `InPlayPokemon.promotedTurn`
  // stamp that slice bought. D116's pronoun rule: "this Pokémon" on an attack is
  // the attacking Active, so the member is `yourActivePromotedThisTurn`.
  [
    "this Pokémon didn't move from the Bench to the Active Spot this turn",
    { kind: "yourActivePromotedThisTurn" },
  ],
  // Lycanroc sv03-117 "Finishing Fang" ({F}, 90) — a HAPAX, and the row where the
  // requirement reading pays for itself: the printed trailing qualifier "before
  // this attack does damage" is DISCHARGED BY THE SITE, not by the predicate.
  // `opponentActiveDamaged`'s own doc block already commits it to being read at
  // declaration, before this attack's damage lands (that is what "already" means
  // for the D115 bonus family), and the requirement gate sits in front of the
  // §8.5 pipeline — so the qualifier is true by where the check runs, and there
  // is nothing extra to model. An undamaged defender cannot be bootstrapped into
  // satisfying the clause by the very hit the clause gates.
  [
    "your opponent's Active Pokémon has no damage counters on it before this attack does damage",
    { kind: "opponentActiveDamaged" },
  ],
]);

/** The board fact an attack REQUIRES in order to do anything, or null when the
    text is not a recognised "does nothing" sentence — null keeps the attack on
    the loud ATTACK_EFFECT_SKIPPED path, never on a silent cancel.

    Returns the POSITIVE condition: `attack.ts` cancels when it does NOT hold.
    Deliberately shares no lookup with `boardConditionForClause` — that table's
    keys are POSITIVE clauses read under a different consequent, and a clause
    meaning "the attack does 80 more damage if X" must never be reachable from a
    sentence meaning "the attack does nothing if X". Two consequents, two
    vocabularies, no crossover. */
export function deriveAttackRequirement(text: string): BoardCondition | null {
  const nothing = ATTACK_DOES_NOTHING.exec(text.trim());
  if (nothing === null) return null;
  return ATTACK_REQUIREMENT_CLAUSES.get(nothing[1] ?? "") ?? null;
}

// The PRINTED COIN FLIP (D126) — "Flip a coin. If heads, this attack does N more
// damage." (20 printings) and "Flip a coin. If tails, this attack does nothing."
// (11 printings). Two sentences, 31 printings, and the reason they are ONE slice
// is that they are ONE MECHANISM read from two ends: a single flip taken BEFORE
// the §8.5 damage pipeline, whose heads branch adds the printed N and whose tails
// branch cancels the attack outright. Splitting them would build that flip twice.
//
// THE CLAUSE IS A FIXED LITERAL, which is what makes this the cheapest slice in
// the whole derived-attack-text family. Every predecessor of the "does N more
// damage" shape had to buy a table of printed clauses and (usually) a
// `BoardCondition` member to answer one; here the clause is the word "heads" (or
// "tails") and a coin face is NOT A BOARD FACT AT ALL — no state answers it, so
// there is no table, no new `BoardCondition` member, and no new
// `DamageCountSource`. Two anchored regexes and a two-member union is the entire
// vocabulary cost. `scaledAttackDamage` stays PURE and state-only on purpose: a
// flip is drawn from `rngState` at resolution, not read off the board.
//
// A UNION, not two nullable readers, and not a record with two optional halves.
// A printing is one shape or the other and never both — the two anchors are
// mutually exclusive by their own text — so the union makes that exclusivity
// STRUCTURAL: `attack.ts` matches one value and can never flip twice.
//
// Anchored whole-sentence with the required trailing period and no /i, exactly
// like CONDITIONAL_DAMAGE_BONUS and ATTACK_DOES_NOTHING, and the anchors are
// doing heavy work here because the coin family's LONG TAIL is large and lives
// one clause away:
//   • "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage
//     from this Pokémon." (Floette sv01-092) and its siblings — a SECOND
//     consequent riding the same flip, refused by `$`;
//   • "Flip a coin. If heads, this attack does 140 more damage. If tails, during
//     your next turn, this Pokémon can't attack." (Dragonite ex sv03-159) — a
//     TAILS branch as well, refused by `$`;
//   • "Flip a coin until you get tails. …" / "Flip 2 coins. …" / "Flip 3 coins.
//     …" — a different NUMBER of flips, refused by the literal `^Flip a coin\.`;
//   • "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
//     (16 printings) — a different consequent entirely, and one `deriveAttackEffect`
//     ALREADY reads as a `coinFlipGate` program. It must never be read here too,
//     or the attack would flip twice; the consequent anchor is what prevents it.
// All of them stay on the loud ATTACK_EFFECT_SKIPPED path, which is where they
// belong.
const ATTACK_COIN_BONUS = /^Flip a coin\. If heads, this attack does (\d+) more damage\.$/;
const ATTACK_COIN_CANCEL = /^Flip a coin\. If tails, this attack does nothing\.$/;

/** What a single pre-damage coin flip printed on an attack DOES with its faces.
    A 2-member union rather than a record, because a printing is one or the other
    and never both:
      • `bonusOnHeads` — heads adds `per` HP to the attack's own damage (folded
        alongside the count-scaling clauses' `scaled`, i.e. BEFORE Weakness and
        Resistance); tails simply adds nothing and the attack resolves normally.
      • `cancelOnTails` — tails cancels the whole attack (no damage, no W/R, no
        effect ops, and the turn still ends); heads resolves normally.
    Note the asymmetry is only apparent: both are "flip once, then take the
    printed branch", and the OTHER face is always the plain resolution. */
export type AttackCoinFlip = { kind: "bonusOnHeads"; per: number } | { kind: "cancelOnTails" };

/** The coin flip an attack's printed text calls for, or null when the text is not
    one of the two recognised whole sentences — null keeps the attack on the loud
    ATTACK_EFFECT_SKIPPED path, never on a silent unflipped resolution.

    Pure in its string, like its three sibling derivers, and disjoint from all of
    them by the leading "Flip a coin." sentence (which denies the leading-`If`
    families their `^` anchor) and by the consequent (which keeps the Paralysis
    flip on `deriveAttackEffect`'s `coinFlipGate` path and off this one). */
export function deriveAttackCoinFlip(text: string): AttackCoinFlip | null {
  const effect = text.trim();
  const bonus = ATTACK_COIN_BONUS.exec(effect);
  if (bonus !== null) {
    const per = Number(bonus[1]);
    // The same `per >= 1` guard every arm of the scaling family carries: a
    // printed 0 is not a bonus, and admitting one would spend a flip (and an
    // rngState step) to add nothing. No card prints it; the guard is what keeps
    // that a fact about the pool rather than an assumption.
    return per >= 1 ? { kind: "bonusOnHeads", per } : null;
  }
  return ATTACK_COIN_CANCEL.test(effect) ? { kind: "cancelOnTails" } : null;
}

// The TYPED self-discard: "Discard a|all|{N} {type} Energy from this Pokémon."
// — the same §8 attack cost as its untyped siblings above, narrowed to one
// energy type. Both notations in one pattern, and both alternations built FROM
// the map, so the regex cannot admit a code or name the map won't resolve.
//
// The near-misses this must refuse are all real catalog rows, and every one of
// them is refused by the whole-sentence anchoring rather than by the type part:
// Pawmot ex "Discard 2 {L} Energy from this Pokémon. This attack does 220
// damage to 1 of your opponent's Pokémon." (a rider clause), Bellibolt ex "YOU
// MAY discard 2 {L} Energy…" (optional, not a cost), Mewtwo VSTAR "Discard UP TO
// 3 Psychic Energy from YOUR POKÉMON." (the whole board, and declinable), and
// Decidueye "Discard a Basic {G} Energy CARD FROM YOUR HAND." (a print in hand,
// not provision on the board — the one row where `basicEnergy` would be right).
// Do NOT add /i here, for the reason spelled out on the untyped family above: a
// capitalised first word is half of what keeps a mid-sentence clause (Krookodile's
// "…, discard an Energy…") off the derived path, and the anchors are the other
// half. No catalog row false-positives under /i today, so this is latent — which
// is exactly when a warning is worth writing down.
//
// The `all|a|\d+` ordering carries NO weight (backtracking makes `a|all` behave
// identically, since `a` must be followed by a space); it reads
// longest-first only for the human.
const TYPED_SELF_DISCARD = new RegExp(
  `^Discard (all|a|\\d+) (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\}` +
    `|(${Object.keys(ENERGY_TYPE_BY_NAME).join("|")})) Energy from this Pokémon\\.$`,
);

/** Parse printed attack text into executable ops, or null when the text is
    ANYTHING but one of the recognized whole sentences (leading/trailing
    whitespace excepted) — null keeps the attack on the skipped-effect path. */
export function deriveAttackEffect(text: string): EffectOp[] | null {
  const effect = text.trim();

  // 1. "Your opponent's Active Pokémon is now {X}."
  let match = DEFENDER_NOW.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "defender", status: statusOf(match[1]) }];
  }

  // 2. "Flip a coin. If heads, your opponent's Active Pokémon is now {X}."
  match = FLIP_DEFENDER_NOW.exec(effect);
  if (match !== null) {
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: statusOf(match[1]) }],
      },
    ];
  }

  // 3. "This Pokémon is now {X}." — {X} excludes Paralyzed (see
  //    SELF_STATUS_WORDS: the §13.4 self-paralysis timing gap).
  match = SELF_NOW.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "self", status: statusOf(match[1]) }];
  }

  // 4. "This Pokémon is now Asleep. Heal {N} damage from it."
  match = SELF_SLEEP_HEAL.exec(effect);
  if (match !== null) {
    return [
      { op: "applyStatus", target: "self", status: "asleep" },
      { op: "heal", target: "self", amount: Number(match[1]) },
    ];
  }

  // 5. "Your opponent's Active Pokémon is now Poisoned. During Pokémon
  //    Checkup, put {N} damage counters on that Pokémon instead of 1."
  match = DEFENDER_POISON_N.exec(effect);
  if (match !== null) {
    // Counters → HP (one counter = 10, §12).
    return [
      {
        op: "applyStatus",
        target: "defender",
        status: "poisoned",
        poisonDamage: Number(match[1]) * 10,
      },
    ];
  }

  // 5b. "During your opponent's next turn, the Defending Pokémon can't
  //     retreat." — the whole effect on 15 printings, none of which needs a
  //     registry row.
  match = DEFENDER_CANT_RETREAT.exec(effect);
  if (match !== null) {
    return [{ op: "preventRetreat" }];
  }

  // 5c. "Your opponent's Active Pokémon is now Poisoned. During your opponent's
  //     next turn, that Pokémon can't retreat." (Paldean Clodsire "Poison
  //     Ring") — the same lock behind a Poison clause; ops in printed order.
  match = DEFENDER_POISON_CANT_RETREAT.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "defender", status: "poisoned" }, { op: "preventRetreat" }];
  }

  // 6. "This attack (also) does {N} damage to each of your opponent's Benched
  //    Pokémon." — the spread hit that the M4 KO generalization reaches (a
  //    benched Pokémon can now be Knocked Out). `damage` is HP, not counters.
  //    The optional "also" rider (Cetoddle sv02-053 "Avalanche" — 30 to the
  //    Active, then 10 to each Bench) shares this case: the main hit rides the
  //    attack's `damage` field, this clause is its secondary bench spread.
  match = SPREAD_EACH_BENCH.exec(effect);
  if (match !== null) {
    return [{ op: "spreadDamage", target: "opponentBench", amount: Number(match[1]) }];
  }

  // 6b. "This attack does N damage to 1 of your opponent's Benched Pokémon for
  //     each Prize card your opponent has taken. (Don't apply Weakness and
  //     Resistance for Benched Pokémon.)" — Wo-Chien ex "Covetous Ivy". A CHOSEN
  //     single benched target (damageChosen's count-1 park), the amount SCALED by
  //     the opponent's TAKEN Prizes and dealt as attack damage (`deals`), not a
  //     placed counter. A printed 0-per is not a real card — left on the loud path.
  match = BENCHED_SNIPE_TAKEN_PRIZES.exec(effect);
  if (match !== null) {
    const per = Number(match[1]);
    if (per >= 1) {
      return [
        {
          op: "damageChosen",
          target: "opponentBench",
          amount: per,
          count: 1,
          deals: true,
          perTakenPrize: true,
        },
      ];
    }
  }

  // 6c. "This attack also does N damage to 1 of your opponent's Benched Pokémon.
  //     (Don't apply Weakness and Resistance for Benched Pokémon.)" — the flat
  //     RIDER (Miraidon "Lightning Laser", Tadbulb, Pawmot, Bellibolt, …): the
  //     SAME count-1 `deals` snipe as Covetous Ivy but WITHOUT `perTakenPrize`
  //     (a fixed N, not Prize-scaled). The main hit rides the `damage` field; this
  //     clause is the secondary benched snipe. A printed 0 is not a real card.
  match = ALSO_BENCHED_SNIPE.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    if (amount >= 1) {
      return [{ op: "damageChosen", target: "opponentBench", amount, count: 1, deals: true }];
    }
  }

  // 6d. "This attack does N damage to 1 of your opponent's Pokémon. (Don't apply
  //     Weakness and Resistance for Benched Pokémon.)" — the ANY-target snipe
  //     (Fezandipiti ex "Cruel Arrow", Rotom "Linear Attack"): the WHOLE attack is a
  //     chosen hit on the Active OR a Bench, `target: "opponentAny"` so a hit that
  //     lands on the Active takes W/R (§8.5). A printed 0 is not a real card. When
  //     group 2 caught Umbreon "Feint Attack"'s "…isn't affected by Weakness or
  //     Resistance, or by any effects on that Pokémon." tail, the hit sets `ignoreWR`.
  match = CHOSEN_ANY_TARGET.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    if (amount >= 1) {
      return match[2] === undefined
        ? [{ op: "damageChosen", target: "opponentAny", amount, count: 1, deals: true }]
        : [{ op: "damageChosen", target: "opponentAny", amount, count: 1, deals: true, ignoreWR: true }];
    }
  }

  // 7/8/9. "Discard an Energy from this Pokémon." / "Discard {N} Energy from this
  //        Pokémon." / "Discard all Energy from this Pokémon." — the self-discard
  //        attack cost (§8), the first DERIVED attack effect that can PARK: with
  //        two different Energy attached, which one goes is a real decision, so
  //        the attack resolves through the attackEpilogue stage (attack.ts).
  //        "all" has no decision and resolves inline.
  if (SELF_DISCARD_ONE.test(effect)) {
    return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }];
  }
  match = SELF_DISCARD_N.exec(effect);
  if (match !== null) {
    const count = Number(match[1]);
    // A printed 0 is not a real card and would derive to a silent no-op; leave
    // anything but a positive count on the loud skipped path.
    if (count >= 1) {
      return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count }];
    }
  }
  if (SELF_DISCARD_ALL.test(effect)) {
    return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" }];
  }

  // 10. "Discard a|all|{N} {type} Energy from this Pokémon." — the TYPED
  //     self-discard, the same §8 cost narrowed to one energy type. `{L}` means
  //     an Energy that PROVIDES {L}, not a Basic Lightning card, which is the
  //     whole reason this needs `providesEnergy` rather than `basicEnergy`: a
  //     Luminous Energy attached to Kilowattrel IS a {L} Energy (until another
  //     Special Energy demotes it to {C}), and the attack that just paid its
  //     {L} cost with it must be able to discard it.
  match = TYPED_SELF_DISCARD.exec(effect);
  if (match !== null) {
    // Exactly one of the two notation groups matched; an unmapped brace code
    // cannot reach here (the character class is built from the map's keys).
    const energyType =
      match[2] === undefined
        ? ENERGY_TYPE_BY_NAME[match[3] ?? ""]
        : ENERGY_TYPE_BY_CODE[match[2]];
    const amount = match[1];
    if (energyType !== undefined && amount !== undefined) {
      const filter = { kind: "providesEnergy", energyType } as const;
      if (amount === "all") {
        return [{ op: "discardEnergy", from: "yourActive", filter, count: "all" }];
      }
      if (amount === "a") {
        return [{ op: "discardEnergy", from: "yourActive", filter }];
      }
      const count = Number(amount);
      // A printed 0 is not a real card and would derive to a silent no-op —
      // the same guard the untyped exact-N rule carries.
      if (count >= 1) {
        return [{ op: "discardEnergy", from: "yourActive", filter, count }];
      }
    }
  }

  // 11/12. "Discard an Energy from your opponent's Active Pokémon.", bare and
  //        behind a coin flip — the hammer family's attack twins, the same op
  //        Mawile's Ability runs with a wider filter.
  if (OPPONENT_ACTIVE_DISCARD.test(effect)) {
    return [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }];
  }
  if (FLIP_OPPONENT_ACTIVE_DISCARD.test(effect)) {
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ];
  }

  // 13. "Your opponent reveals their hand. Choose a Supporter card you find
  //     there and put it on the bottom of their deck." — Greavard "Underworld
  //     Stroll", the attack twin of Ortega's Supporter sentence (which is
  //     registry-authored: its second sentence gates an opponent draw no attack
  //     prints). Derived rather than registry-authored because CardProgram's
  //     `attack` field is per-CARD and Greavard has a second, effect-less
  //     attack it must not leak onto.
  if (REVEAL_BOTTOM_SUPPORTER.test(effect)) {
    return [{ op: "bottomFromOpponentHand", filter: { kind: "supporter" } }];
  }

  // 14. "This Pokémon also does {N} damage to itself." — the recoil clause
  //     (Skeledirge sv01-038 "Blazing Shout"). The engine's FIRST attack that
  //     damages its OWN board: the resulting self-KO is why the attack epilogue
  //     now sweeps both seats (flow.ts finishAttack). Never parks — placing the
  //     damage is not a decision.
  match = SELF_DAMAGE.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // A printed 0 is not a real card and would derive to a silent no-op — the
    // same guard the exact-N discard rules carry; leave it on the loud path.
    if (amount >= 1) return [{ op: "damageSelf", amount }];
  }

  return null;
}

/** A count-scaled damage clause — `per × (a counted resource)`, the parsed shape
    BOTH scaling families produce (the additive "+" reader `deriveAttackDamageBonus`
    and the "×"/multiply reader `deriveAttackDamageMultiplier`). Deliberately NOT an
    `EffectOp`: it is PRE-damage math the caller computes (attack.ts), NOT a step
    the interpreter runs — every `deriveAttackEffect` op instead reads a sentence
    that runs AFTER damage, so the scaling derivers are disjoint from the op deriver
    and a card carries at most one (the whole-sentence anchor means a scaling
    sentence never also derives an op). The two families differ ONLY in attack.ts's
    fold — additive folds `per × count` onto the printed base (Paldean Tauros
    "Raging Horns" — 10 per damage counter on the attacker), multiply makes it the
    WHOLE damage with no base (Pecharunt ex "Irritated Outburst") — so they share
    this interface and the `count` evaluator. `count` is a union of two REAL readers
    — the attacker's own damage counters and, since 0.35.0, the opponent's TAKEN
    Prizes — a member each, not a second interface. */
export interface AttackDamageBonus {
  per: number;
  count: DamageCountSource;
}
/** The resource an `AttackDamageBonus` counts. Four members: the attacker's OWN
    damage counters (Paldean Tauros "Raging Horns"), the opponent's TAKEN Prizes
    (Charizard ex "Burning Darkness"), — since 0.61.0 — the {C} in the opponent's
    Active Pokémon's RETREAT COST (Heracross "Superpowered Throw" and its three
    siblings), and — since 0.66.0 — a `boardCondition` INDICATOR, each read by its
    own anchored sentence. The third is the first count source that is DERIVED
    rather than read off a field: attack.ts evaluates it through continuous.ts
    `effectiveRetreatCost`, so every retreat-cost modifier already in play (Beach
    Court's discount, Calamitous Wasteland's surcharge, Clefable ex's set-to-zero
    aura) is inside the number these attacks read.

    The fourth is honestly DEGENERATE: a `boardCondition` count is 1 when the
    condition holds for the ATTACKER's seat and 0 when it does not, so `per × count`
    is the printed flat bonus or nothing at all — "If <clause>, this attack does N
    more damage." (D115). Modelling the conditional flat bonus as a 0-or-1 count is
    what lets it reuse the additive family whole: attack.ts needs no new fold, no
    new branch in the §8.5 pipeline and no new event field, only the ATTACKER's
    seat (a `BoardCondition` is relative to whose board it reads, and `scaledAttackDamage`
    knew only the defender's). */
export type DamageCountSource =
  | { kind: "damageCountersOnSelf" }
  | { kind: "opponentPrizesTaken" }
  | { kind: "opponentActiveRetreatCost" }
  | { kind: "boardCondition"; cond: BoardCondition };

/** Parse a printed additive damage-scaling sentence into its `per` amount and
    count source, or null when the text is anything but one of the four anchored
    sentence shapes this reads (self damage counters, the opponent's taken Prizes,
    the opponent's Active Retreat Cost, and the leading-`If` conditional flat bonus
    whose clause is one of `CONDITIONAL_DAMAGE_CLAUSES`) — the "×"/multiply twins
    (no "more", owned by
    `deriveAttackDamageMultiplier`), a lowercased "this", a missing trailing
    period, and any leading/trailing text all stay on the loud ATTACK_EFFECT_SKIPPED
    path. Disjoint from `deriveAttackEffect`: this reads the SAME effect text but
    folds into the base pre-W/R rather than running after damage (attack.ts owns
    the fold). */
export function deriveAttackDamageBonus(text: string): AttackDamageBonus | null {
  const effect = text.trim();
  // A printed 0 adds nothing (either arm) — leave it on the loud
  // ATTACK_EFFECT_SKIPPED path, the guard the self-damage / exact-N discard rules
  // carry.
  const selfCounters = SELF_COUNTER_SCALE.exec(effect);
  if (selfCounters !== null) {
    const per = Number(selfCounters[1]);
    if (per >= 1) return { per, count: { kind: "damageCountersOnSelf" } };
  }
  const opponentPrizes = OPPONENT_PRIZES_SCALE.exec(effect);
  if (opponentPrizes !== null) {
    const per = Number(opponentPrizes[1]);
    if (per >= 1) return { per, count: { kind: "opponentPrizesTaken" } };
  }
  const retreatCost = RETREAT_COST_SCALE.exec(effect);
  if (retreatCost !== null) {
    const per = Number(retreatCost[1]);
    if (per >= 1) return { per, count: { kind: "opponentActiveRetreatCost" } };
  }
  // The CONDITIONAL flat bonus (D115) — "If <clause>, this attack does N more
  // damage." — last, because its clause capture is the loosest pattern here and
  // the three "for each" arms above are exact. An UNMAPPED clause deliberately
  // falls through to `return null`: an unrecognised condition must stay LOUD
  // (ATTACK_EFFECT_SKIPPED), never silently score its bonus at 0.
  const conditional = CONDITIONAL_DAMAGE_BONUS.exec(effect);
  if (conditional !== null) {
    const cond = boardConditionForClause(conditional[1] ?? "");
    if (cond !== null) {
      const per = Number(conditional[2]);
      // A printed 0 adds nothing — the guard every arm in this family carries.
      if (per >= 1) return { per, count: { kind: "boardCondition", cond } };
    }
  }
  return null;
}

/** Parse a printed "×"/multiply damage-scaling sentence — "This attack does N
    damage for each Prize card your opponent has taken." / "… for each {C} in your
    opponent's Active Pokémon's Retreat Cost." (NO "more") — into the same
    `{per, count}` shape as the additive reader, or null for anything else.
    The two share the count evaluator; they differ only in
    attack.ts's fold: the additive reader's `per × count` adds to a printed base,
    THIS family's IS the whole damage (the printed "N×" base is the per-unit, so
    attack.ts drops it — count 0 → 0 damage). Refuses the additive "more" twin
    (that reader owns it), Wo-Chien ex's benched-target print and Chien-Pao ex's
    discarded-Energy count (both a different shape), a lowercased "this", a missing
    trailing period, and any leading/trailing text — all stay on the loud
    ATTACK_EFFECT_SKIPPED path. Disjoint from `deriveAttackEffect` for the same
    reason the additive reader is (attack.ts owns the fold). */
export function deriveAttackDamageMultiplier(text: string): AttackDamageBonus | null {
  const effect = text.trim();
  const opponentPrizes = OPPONENT_PRIZES_MULTIPLY.exec(effect);
  if (opponentPrizes !== null) {
    // A printed 0 does nothing — left loud, the guard the additive rules carry.
    const per = Number(opponentPrizes[1]);
    if (per >= 1) return { per, count: { kind: "opponentPrizesTaken" } };
  }
  const retreatCost = RETREAT_COST_MULTIPLY.exec(effect);
  if (retreatCost !== null) {
    const per = Number(retreatCost[1]);
    if (per >= 1) return { per, count: { kind: "opponentActiveRetreatCost" } };
  }
  return null;
}

/** The matched status word, lowercased into the event vocabulary. The regex
    alternation guarantees the word; the fallback only satisfies
    noUncheckedIndexedAccess. */
function statusOf(word: string | undefined): StatusName {
  return STATUS_OF_WORD[(word ?? "Asleep") as StatusWord];
}
