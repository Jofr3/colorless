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
  /** §11/§15.B — INSTALL a damage/effect block on the CONTROLLER's own Active for
      the opponent's next turn:

        "Flip a coin. If heads, during your opponent's next turn, prevent all
         damage FROM AND EFFECTS OF attacks done to this Pokémon."  (11 printings)
        "Flip a coin. If heads, during your opponent's next turn, prevent all
         damage done to this Pokémon by attacks."                   ( 2 printings)

      `preventRetreat`'s mirror image, and deliberately shaped like it: same
      printed duration, same absent `target` field, same not-a-§12-condition
      argument. The mirror is the DIRECTION — that one is installed ON THE
      DEFENDER by the attacker, this one on the ATTACKER's own body — and the
      direction is why it needed a turn STAMP rather than that op's reuse of the
      §13.4 paralysis clock (types.ts `AttackBlock` spells the failure out).

      NO `target` FIELD, by D104's minimal shape: every one of the nineteen
      printings in the pool that installs a block of this family says "this
      Pokémon", never the Defending one. If one ever says otherwise, that is the
      warrant for the field, with two readings in hand rather than one guessed at.

      `effects` IS A FIELD, NOT A SECOND MEMBER — D131's widen-don't-add rule
      applied and PASSING, the D139 case rather than the D138 one. The two printed
      spellings differ in the words "from and effects of", and EVERYTHING
      downstream of that phrase is byte-identical: same install site, same holder,
      same stamp, same event, same expiry, same three early clears. The whole
      difference is one extra set of read sites consulting one boolean, which is
      precisely what a field is for; two members would be two copies of one
      installation told apart by how much they refuse.

      OPTIONAL, AND THE POLARITY IS DELIBERATE (D135's `zone?: "bench"` read from
      the other end): the printed words WIDEN the block, so the field is present
      exactly when they are printed, and a producer that forgets it blocks LESS
      rather than more. An over-blocking default would silently make an opponent's
      whole attack do nothing; an under-blocking one loses a rider on one body.

      NOT WIDENED TO A `damage` FLAG, and the condition that would warrant it is
      written down (D130 → D131's precedent). Palafin sv03-145 prints the THIRD
      reading — "During your opponent's next turn, prevent all EFFECTS of attacks
      used by your opponent's Pokémon done to this Pokémon. (Damage is not an
      effect.)" — effects WITHOUT damage, on ONE printing, on a different sentence
      (no coin, an "used by your opponent's Pokémon" clause, and that parenthetical).
      Mapping it is what warrants turning `effects?: true` into a two-flag cover;
      inventing the flag now would be a second axis guessed at from a sentence
      nothing reads. Its parenthetical is nonetheless the SPEC for both readings
      here, and it is the reason a placed damage COUNTER falls on the effects side.

      Runs at `attack.ts`'s TAIL like every other `EffectOp`, and that placement is
      free rather than lucky (D125's rule): the block's entire effect is in the
      FUTURE, so nothing about it needs to precede the §8.5 pipeline the way a
      cancel or a coin bonus does. Never parks, consumes no rng, and is idempotent
      — installing twice in one turn writes the same stamp. */
  | { op: "preventDamage"; effects?: true }
  /** §8/§11 (D143) — LOCK the CONTROLLER's own Active out of attacking on the
      controller's NEXT turn:

        "During your next turn, this Pokémon can't attack."          (20 printings)
        "Put {N} damage counters on 1 of your opponent's Pokémon.
         During your next turn, this Pokémon can't attack."          ( 2 printings)

      The DRAWBACK half of a big-damage attack, and the pool's most re-printed
      durated rider after D112's retreat lock: Miraidon ex / Koraidon ex ×4 each,
      Dragonite VSTAR ×2, Alomomola, Clawitzer, Steelix, Kilowattrel, Tinkatuff,
      Victini ex, Crabominable, Umbreon, Probopass, Golbat — plus Ninetales
      sv03-029/-199 "Nine-Tailed Dance", where it rides behind a counter PUT.

      `preventRetreat`'s MIRROR, and shaped like it deliberately: bare, no fields,
      the holder resolved from `ctx` rather than carried. The mirror is the
      DIRECTION on both axes at once — that op locks the OPPONENT's Active out of
      RETREATING during the opponent's next turn; this one locks the CONTROLLER's
      own Active out of ATTACKING during the controller's next turn.

      ⚠️ NO `target` FIELD, AND THE WARRANT FOR ONE ALREADY EXISTS — which is why
      the refusal is written down rather than assumed (D104's minimal shape, D138's
      no-fields-at-all call, D131's widen-don't-add rule as a TEST). The pool DOES
      print the defender-side reading: Eiscue ex sv03-042/-210/-222 "Scalding
      Block" ("Discard an Energy from this Pokémon. During your opponent's next
      turn, the Defending Pokémon can't attack.") and Houndoom ex sv03-134 "Evil
      Claw" ("If the Defending Pokémon is a Basic Pokémon, it can't attack during
      your opponent's next turn.") — 4 printings across 2 sentences, both still
      LOUD. It is NOT a one-token widening, and that is the finding: a `target`
      would have to carry a DIFFERENT STAMP as well as a different holder (the
      defender-side window is `state.turn + 1`, this one is `state.turn + 2`), so
      the field is two axes rather than one and is worth exactly one printing's
      guess less than it looks. Map one of those sentences and the field is earned
      with two readings in hand.

      ⚠️ IT LOCKS THE POKÉMON, NOT THE ATTACK, and the pool prints the other
      reading too: eight printings say "this Pokémon can't use {AttackName}"
      (Munkidori ex ×3 "Dirty Headbutt", Lucario sv01-114, Radiant Charizard
      swsh10.5-011, Radiant Blastoise swsh10.5-018, Skarmory sv03-142, Greedent ex
      sv03-179). Those name ONE attack and leave the card's other attack legal, so
      they need a per-attack lock this field cannot express; all eight stay LOUD.
      A fixture pins the difference from the inside — Alomomola sv01-048's index-0
      "Surf" is refused by the lock its index-1 "Aqua Slash" installed.

      Runs at `attack.ts`'s TAIL like every other `EffectOp`, and — as with
      `preventDamage` — that placement is free rather than lucky (D125's rule):
      the lock's entire effect is in the FUTURE. Never parks, consumes no rng, and
      is idempotent (installing twice in one turn writes the same stamp). */
  | { op: "preventAttack" }
  /** Heal `amount` HP from the CONTROLLER's own Active Pokémon — the printed
      "this Pokémon" / "it" of a self-heal, resolved at `ctx.seat` by the
      interpreter rather than carried in the op (which is why `target` has one
      member and not two: no pool printing heals the DEFENDER). CLAMPED to the
      damage actually present, so it can never drive damage below 0 and never
      heals past what is there; a whiff — an undamaged Active, or an `amount`
      the board has no use for — is SILENT, emitting no HEALED row rather than a
      row saying nothing happened. Never parks: "this Pokémon" is not a choice.
      THREE readers produce it: the compound `SELF_SLEEP_HEAL` ("This Pokémon is
      now Asleep. Heal {N} damage from it.", since 0.x), the bare `SELF_HEAL`
      sentence (since 0.83.0, D132) and — since 0.85.0 — `FLIP_SELF_HEAL`
      ("Flip a coin. If heads, heal {N} damage from this Pokémon.", D134), which
      wraps this very op in a `coinFlipGate` and changes nothing about it. */
  | { op: "heal"; target: "self"; amount: number }
  /** Heal `amount` HP from EACH of the controller's own in-play Pokémon — the
      ACTIVE and the whole Bench, which is what the printed "each of your
      Pokémon" means (the Active is one of your Pokémon; only the printed word
      "Benched" would exclude it). Each heal is CLAMPED to that Pokémon's own
      damage independently, so one healthy body cannot eat another's heal, and a
      whiff is SILENT per Pokémon. No target choice, so it never parks; one
      HEALED per Pokémon that actually healed. Two readers produce it: Garganacl
      "Blessed Salt" (a between-turns triggered Ability, since 0.x) and — since
      0.84.0 — the bare `OWN_BOARD_HEAL` attack sentence (D133). */
  | { op: "healEach"; amount: number }
  /** Heal `amount` HP from EVERY in-play Pokémon on BOTH boards (Picnic Basket
      "Heal 30 damage from each Pokémon (both yours and your opponent's)"). The
      seat-blind twin of `healEach` — the whole table heals, not just the
      controller's side. No target choice, so it never parks; one HEALED per
      Pokémon that actually healed, tagged with that Pokémon's OWN seat. */
  | { op: "healEachAll"; amount: number }
  /** Place `amount` HP of damage on the OPPONENT's Active Pokémon. A COUNTER
      placement, not attack damage: no Weakness/Resistance (§8.5) and no
      `damageReductionAfterWR` passive. Never parks; can KO — the caller sweeps
      (the Checkup's KO sweep for a triggered Ability, the attack epilogue's
      two-seat one for an attack, both in flow.ts).

      `amount` IS HP, NOT COUNTERS, and that is the one place a reader of this op
      can be off by a factor of ten. Every printed sentence that produces it
      counts COUNTERS ("put 1 damage counter", "Put 7 damage counters"), so the
      × 10 (§12: one counter = 10 HP) belongs at the PRODUCER — the registry row
      and the deriver arm each do it once, at the site that reads the number, so
      the interpreter never has to know which unit it was handed. The same
      conversion `DEFENDER_POISON_N` makes for `applyStatus.poisonDamage`.

      TWO PRODUCERS AND TWO PROVENANCES, WHICH IS WHY `source` IS A FIELD:
        • `"ability"` — Trevenant sv03-012 "Forest Miasma", a between-turns
          triggered Ability placing 1 counter (since 0.x).
        • `"attack"` — the bare `COUNTER_PUT_ON_DEFENDER` attack sentence
          "Put {N} damage counters on your opponent's Active Pokémon."
          (Mimikyu sv02-097 "Ghost Eye" 7, Polteageist sv03-098 "Pour Tea" 5;
          since 0.88.0, D139).
      It rides the OP rather than being inferred downstream because the
      interpreter has no notion of provenance at all: `EffectContext` is WHO the
      program runs for (seat + the source body), deliberately not WHAT invoked it,
      and putting the answer there would mean a field on every park's serialized
      continuation for the benefit of one op.

      D131's WIDEN-DON'T-ADD RULE APPLIED AND PASSING — the contrast with D138,
      where the same rule was applied and FAILED. It licenses a field when
      everything downstream of the varying token is byte-identical, and here that
      is literally everything: same target, same flatness, same raise-only
      contract, same event, same `seat`. The whole difference is one enum value in
      the row's provenance, which is exactly what a field is for. A second op
      would have been two copies of five lines told apart by a log label. */
  | { op: "damageActive"; amount: number; source: "ability" | "attack" }
  /** "Move all damage counters from 1 of your Benched Pokémon to your opponent's
      Active Pokémon." — Dedenne ex sv02-093/-239 "Tail Swap" (D138). ONE printed
      action with a CHOICE in front of it and two halves behind it:
        1. the controller picks 1 of their own BENCHED Pokémon — the park, over
           `ownBenchRefs` through `parkOrForce`, which is byte-for-byte the
           candidate set `healChosen`'s `zone: "bench"` offers (D135). Undamaged
           bodies are OFFERED: the printed sentence carries no damaged
           restriction, so hiding them would be a rule the card does not print
           (the Potion doctrine), and picking one whiffs SILENTLY.
        2. EVERY damage counter on the pick comes off (its damage goes to 0, one
           HEALED carrying what actually moved) and the SAME number lands on the
           opponent's Active (one COUNTERS_PLACED source "moved").
      The two rows carry the same `amount` on purpose — that equality IS the word
      "move", and it is what a log reader can check.

      A PLACED COUNTER, NOT ATTACK DAMAGE — `damageActive`'s rule verbatim: no
      Weakness/Resistance (§8.5) and no `damageReductionAfterWR` passive, because
      Bouffalant's "Bouffer" reduces *damage from attacks* and a moved counter is
      not that. So a Psychic-weak defender takes exactly what came off the Bench.

      IT CAN KNOCK THE DEFENDER OUT, and like every op it does not do the Knock
      Out itself: the attack epilogue's TWO-seat sweep (flow.ts `finishAttack`)
      reads the post-effect board, prizes to the attacker and promotes — whether
      the op resolved inline or after a park, since `settleProgram(...,
      { resumeTail: true })` leaves `attackEpilogue` sitting on `state.pending`
      until the choice lands (D135).

      NO FIELDS, AND THE MINIMAL SHAPE IS DELIBERATE (D104, and D130's
      `discardOpponentDeckTop` is the precedent for putting the direction in the
      NAME). Exactly one sentence in the pool has this shape; the neighbouring
      counter-MOVE text is two ABILITIES, and each differs on a different axis —
      Munkidori sv06.5-072 "Adrena-Brain" moves *up to 3* counters from 1 of your
      Pokémon (any zone) to 1 of your opponent's Pokémon (a second choice), and
      Slowbro sv01-043 "Strange Behavior" moves *1* counter from 1 of your OTHER
      Pokémon to THIS one (your own side as the destination). Fielding an
      `amount` / `from` / `to` now would be a three-axis guess made from one
      printing. **THE CONDITION THAT WARRANTS THE WIDENING** (D131's rule — when
      you decline a widening, write down what would earn it): a second ATTACK
      printing of a counter move, at which point the two readings are in hand and
      this op gains the field they actually differ on, exactly as D131 turned
      `discardOpponentDeckTop` into `discardDeckTop { whose, count }`.

      NOT A FIELD ON `healChosen`, and that is D131's widen-don't-add rule
      APPLIED AND FAILING rather than skipped. That rule licenses a field when
      everything downstream of picking the candidate set is byte-identical; here
      the pick is the ONLY thing the two share. This op emits a second event, on
      the OTHER seat's board, which can end the game — an op named `heal` that
      placed damage would be the misnaming D128's provenance rule exists to
      prevent. */
  | { op: "moveCountersToDefender" }
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
      "Bouquet Magic" — 1 × 3 counters; Ting-Lu ex sv02-127 "Land Scoop" — 1 × 2
      counters, the first ATTACK printing, D140). "Put damage counters" is NOT attack
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
      is paid), so their pick is mandatory.

      `source` IS REQUIRED, AND IT IS THE SAME FIELD `damageActive` GREW AT D139,
      with the same two members and for the same reason. On the placement path this
      op emits `COUNTERS_PLACED`, whose `seat` OWNS the DAMAGED Pokémon (never the
      actor) and whose `"ability"` log arm prints the literal word **Ability** — so
      the row's provenance is something only the PRODUCER knows, and hardcoding it
      inside `placeSnipe` was D136's finding 1 waiting for a second producer. It
      had exactly that shape until 0.89.0.

      ⚠️ A FIELD RATHER THAN A DERIVATION OFF `deals`, BECAUSE THAT DERIVATION IS
      NOT TOTAL. `deals: true` routes to `DAMAGE_DEALT`, which carries no
      provenance at all; `deals` ABSENT is the counter path — and that path is
      taken by BOTH the three Ability producers AND, since 0.89.0, by an ATTACK
      (Ting-Lu ex sv02-127 "Land Scoop"). One flag value, two honest labels: there
      is nothing there to read the answer off. Nor can it ride `EffectContext`
      (D139's argument, and STRONGER here): the context is WHO a program runs for,
      not WHAT invoked it, and unlike `damageActive` this op PARKS — so a
      provenance field there would be a wire-shape change on every serialized
      `EffectContinuation`.

      REQUIRED RATHER THAN OPTIONAL-WITH-A-DEFAULT, and that is the whole answer to
      "an explicit field a producer must remember": the compiler remembers. A
      `source?: "attack"` defaulting to `"ability"` is precisely the shape D136 and
      D139 each caught once — a new producer silently inherits a label that is
      false about it and nothing fails. On the `deals` arm the value is UNREAD but
      still TRUE (attack damage can only come from an attack), so it is a fact
      about the op rather than a field that means nothing on one arm — D135's trap,
      avoided rather than re-entered. The guard is ASSERTED, not relied on:
      counterBenchPut.test.ts sweeps every op the deriver produces from the whole
      fixture pool and refuses `"ability"` on any of them.

      ⚠️ AND BECAUSE THIS OP PARKS, THE FIELD IS PERSISTED — it rides
      `GameState.phase.cont.pendingOp` while the pick is open, so adding it as a
      REQUIRED field cost `MATCH_RECORD_VERSION` 2 → 3 (match.ts). D139 added the
      identical field to `damageActive` and correctly bumped nothing, that op never
      parking. Any future required field on a PARKING op owes the same check. */
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
      /** What is placing these counters — the provenance the `COUNTERS_PLACED`
          row may honestly print (see the block above). `"ability"` for the three
          registry rows (Hawlucha, Meowscarada ex, Radiant Blastoise), `"attack"`
          for every derived arm. Read only on the placement path; on the `deals`
          arm it is unread and still true. */
      source: "ability" | "attack";
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
      them"), clamped to each pick's damage.

      `zone` is the printed word "Benched" and NOTHING ELSE (D135). Absent — the
      unmarked printing — the candidates are ALL the controller's Pokémon, Active
      included, because §1.1 says the Active is one of your Pokémon; `"bench"` is
      the printed "1 of your BENCHED Pokémon" and drops the Active from the
      candidate set, which is the whole content of the word (D120: honour the
      printed zone word, and only that word). It is a FIELD rather than a second
      op member because everything downstream of picking the candidate set is
      byte-identical — the same park, the same choice shape, the same heal, the
      same HEALED event (D131's widen-don't-add rule, applied to the op that
      already carries `upTo` the same way). An EMPTY Bench is not an error: zero
      candidates is `parkOrForce`'s silent no-op, the same ending an undamaged
      pick takes. */
  | { op: "healChosen"; amount: number | "all"; zone?: "bench"; upTo?: number }
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
  /** MILL: move the top `count` cards of `whose` deck into that same player's
      discard pile, in deck order (top first — the order the pile gains them, §2).
      D130's op, widened by D131; the third producer of `DECK_TOP_DISCARDED` (the
      others are `attachFromTop`'s `discardRest` above and, since D131, this op on
      either side); the event's `seat` is the deck's OWNER on all of them.

      Deterministic in the strongest sense the op vocabulary has: it consumes NO
      `rngState` (the cards are taken in the order they already sit in), it never
      PARKS (there is no choice in "the top N"), and it never prompts. That is what
      lets it be repeated N times at the flip site — D130 expands "For each heads,
      X" into `heads` copies of X — where an op that parked would owe N sequential
      continuations across a serialized state, and one that drew from `rngState`
      would make the expansion's step count depend on the faces twice over.

      CLAMPED TO THE DECK, never an error: a shallower deck discards all of it and
      the op reports what actually moved (§8.6 "do as much as you can"). And
      MILLING TO ZERO DOES NOT END THE GAME — §14.3 deck-out is a turn-START rule,
      checked at the draw (flow.ts `startTurn`), exactly as `drawCards` short-draws
      rather than losing on the spot. A player milled out loses at their next draw
      step and not one instant earlier, which is a rule about WHERE the loss is
      owed, not a leniency.

      `whose` IS A WIDENED FIELD, NOT A SECOND MEMBER (D131, D128's provenance rule
      applied in the small): the printed sentences differ in exactly one word — "your
      deck" against "your opponent's deck" — and everything downstream of picking the
      seat is byte-identical. D130 deliberately shipped this op opponent-only, saying
      the first slice to map the own-deck reading should widen it "with two readings
      in hand rather than one guessed at"; D131 is that slice, and the two readings
      are 16 printings split 7/9. Gyarados swsh10.5-022 prints BOTH on one card —
      "Wreak Havoc" mills the opponent behind a coin, "Wild Splash" mills its own
      deck for 5 — which is the sharpest possible evidence that the direction is a
      FIELD of one action rather than two actions.

      STILL COUNT-ONLY, by D104's minimal-shape rule: no printing in the pool filters
      what it mills, so there is no `CardFilter` here.

      MILLING YOUR OWN DECK IS A REAL COST, NOT A BUG — Tyranitar's "Dread Mountain"
      (230 for {D}{D}) pays 4 cards off its own deck for the number, and §14.3
      deck-out is checked at the DRAW, so the self-mill's danger lands on the
      attacker's NEXT turn. That asymmetry is entirely in the rule, not in this op:
      the two directions run the same code.

      Naming the uids on the event leaks nothing: the discard pile is PUBLIC, so a
      redact.ts arm would hide from the opponent exactly what the opponent can pick
      up and read.

      THREE readers produce it: D130's per-heads expansion (`programPerHeads`, at
      the flip site), D131's bare `DECK_TOP_MILL` sentence and — since 0.85.0 —
      `FLIP_DECK_TOP_MILL` ("Flip a coin. If heads, discard the top card of your
      opponent's deck.", D134), which wraps the singular opponent-side reading in a
      `coinFlipGate` and changes nothing about the op. */
  | { op: "discardDeckTop"; whose: "self" | "opponent"; count: number }
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
  | {
      op: "discardEnergy";
      from: "opponentEach";
      filter: CardFilter;
      count?: never;
      recordAs?: never;
    }
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
// The BARE self-heal (D132) — "Heal {N} damage from this Pokémon.", the whole
// printed effect, 18 printings across 4 distinct clauses (N = 10, 20, 30, 50):
// Horsea sv06.5-010/-067 + Slowpoke swsh10.5-019 "Hold Still", Slowbro sv01-043 +
// Azumarill sv02-045 + Marill sv02-044/-204 "Bubble Drain", Brambleghast sv02-024
// + Shroomish sv01-003 + Smoliv sv03-019 + Ariados swsh10.5-007 "Absorb",
// Ceruledge sv02-098 "Life Sucker", Dolliv sv03-020 "Sunny Wind", Tropius
// sv02-007/-195 "Leaf Drain", Bramblin sv02-023/-198 "Blot", Natu swsh10.5-032
// "Nap". Twelve of the eighteen also carry printed damage, which needs nothing:
// ops run at attack.ts's TAIL, after the §8.5 pipeline (D125).
//
// SEPARATE FROM `SELF_SLEEP_HEAL` ABOVE, NOT A LOOSENING OF IT. That sentence
// heals "from IT", bound by its own first clause to the Pokémon it just put to
// Sleep; this one names "this Pokémon" outright and has no first clause at all.
// Neither anchor can claim the other's string (this one starts at `^Heal`, which
// the compound never does), so the family's one-anchored-reader-per-printed-
// string invariant holds by construction rather than by ordering.
//
// No /i, for the standing reason (see TYPED_SELF_DISCARD below): the capitalised
// first word plus `^…$` is the WHOLE guard, and it is what keeps a mid-sentence
// clause — Fuecoco sv02-035's "Flip a coin. If heads, heal 30 damage from this
// Pokémon." — off this path and on the loud one where it belongs.
const SELF_HEAL = /^Heal (\d+) damage from this Pokémon\.$/;
// The OWN-BOARD heal (D133) — "Heal {N} damage from each of your Pokémon.", the
// whole printed effect, 7 printings across 2 distinct clauses (N = 20, 30):
// Skeledirge ex sv02-037/-233/-258/-272 "Vitality Song" (30, WITH a printed 50),
// Steenee sv03-017 "Aromatherapy" (30, no damage), Cresselia sv06.5-021/-071
// "Healing Pirouette" (20, no damage). D132 again, and for the same reason: the
// op it derives to — `healEach` — has shipped since 0.x behind Garganacl's
// "Blessed Salt" Ability, so the slice is a READER and nothing else. No new op,
// no new event, no interpreter diff.
//
// "EACH OF YOUR POKÉMON" INCLUDES THE ACTIVE, and that is the one substantive
// reading in the sentence rather than a detail of the regex. `healEach` already
// heals `side.active` then `side.bench` in index order (interpreter.ts), which
// is the rule (§1.1: the Active is one of your Pokémon) — it had simply never
// been reached from an ATTACK before, only from a Checkup trigger, so the
// reading is asserted end-to-end in boardHeal.test.ts rather than inherited.
// Only the printed word "Benched" excludes the Active, and no printing of THIS
// sentence carries it (the pool's Benched heals are all `1 of your Benched`,
// a different op entirely and still unmapped).
//
// SEPARATE FROM `SELF_HEAL` ABOVE, and disjoint from it by construction: both
// are `^…$`-anchored on a differing middle, so neither can claim the other's
// string and the ordering of the two arms is immaterial. That is the same
// argument SELF_HEAL makes against SELF_SLEEP_HEAL, and it is why this family
// keeps costing one regex per sentence with no dispatch table.
//
// No /i, for the standing reason: the capitalised first word plus `^…$` is the
// WHOLE guard, and it is what keeps a mid-sentence clause — Saguaro sv02-187's
// "Choose up to 2 of your Pokémon and heal 50 damage from each of them." — off
// this path. (That one is a Supporter and never reaches this reader anyway, but
// the guard should not depend on which reader a card happens to route through.)
const OWN_BOARD_HEAL = /^Heal (\d+) damage from each of your Pokémon\.$/;
// The CHOSEN heal (D135) — "Heal {N|all} damage from 1 of your [Benched]
// Pokémon.", the whole printed effect, 10 printings across 7 distinct clauses
// and the third heal shape the pool prints. Census run 2026-08-01 against the
// local D1 over the WHOLE effect string (978 cards); NOT ONE of the ten carries
// a printed `damage` field, so the heal is the entire visible result every time:
//   • ANY-ZONE, 5 printings / 3 clauses — Nacli sv02-121/-220 "Salt Coating"
//     (20), Smoliv sv01-021 "Nutrients" (30), Vespiquen ex sv03-096/-212
//     "Healing Pheromone" (60).
//   • BENCH-ONLY, 5 printings / 4 clauses — Combee sv03-008 "Share" (20),
//     Chansey swsh10.5-051 "Delicious Egg" (30), Tropius sv01-007
//     "Fresh-Picked Fruit" (60), Blissey swsh10.5-052 "Enriching Egg" and
//     Arboliva sv03-021 "Healing Fruit" (both "all").
//
// ONE REGEX, TWO CAPTURES, ONE OP — the D131 shape exactly. Both varying tokens
// land in FIELDS of a single `healChosen` (`amount`, `zone`), not in rows of a
// lookup table, so D119 does not govern and the two readings differ downstream
// by exactly which refs the park offers. That is also why this is NOT a D120
// template: a template needs a varying token with a CLOSED reading and a table
// to look it up in; here there is no table, and "Benched " is a one-bit presence.
//
// "ALL" IS A SPELLING OF THE AMOUNT, NOT A SEPARATE SENTENCE. `healChosen.amount`
// has taken `number | "all"` since 0.x (Arboliva's "Enriching Oil" Ability prints
// it), so the two Blissey/Arboliva printings cost this arm one alternation branch
// and nothing else. The cross product is deliberately UNFILTERED: "Heal all
// damage from 1 of your Pokémon." is unprinted today and this anchor accepts it,
// because it is unambiguous and the op expresses it exactly — the same call
// `DECK_TOP_MILL` makes for the unprinted "the top 1 cards" (D131). A refusal
// would be a claim about the ingest, not about the game.
//
// THE ONLY NEW VOCABULARY IS THE ZONE FIELD, and the interpreter diff is one
// ternary over `ownBenchRefs` — a helper `switchActive` and `gust` have used
// since 0.x. The PARK is not new either: an attack tail has parked on a
// choosePokemon since the derived snipes (`damageChosen`) and the derived
// self-discard cost, through the same `settleProgram(..., {resumeTail: true})`
// that trainers use minus the flag. So the "first parking op the ATTACK deriver
// emits" this slice was priced as is nothing of the sort — see D135.
//
// No /i, for the standing reason (see TYPED_SELF_DISCARD): the capitalised first
// word plus `^…$` is the WHOLE guard. It is what keeps Floette sv01-092's
// "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage
// from this Pokémon." and Saguaro sv02-187's "Choose up to 2 of your Pokémon and
// heal 50 damage from each of them." off this path — both print the mapped words
// mid-sentence behind something this arm cannot express.
const CHOSEN_HEAL = /^Heal (\d+|all) damage from 1 of your (Benched )?Pokémon\.$/;
// ── The FLIP-GATED OP family (D134) ──────────────────────────────────────────
// "Flip a coin. If heads, <an action this reader already performs>." — 3
// printings / 2 distinct clauses, and the two are taken TOGETHER on purpose:
//   • Fuecoco sv02-035/-201 "Spacing Out" — `heal 30 damage from this Pokémon`,
//     the gated twin of `SELF_HEAL` (D132). 2 printings, so D121's warrant is
//     met on its own.
//   • Wiglett sv01-056 "Dig a Little" — `discard the top card of your
//     opponent's deck`, the gated twin of `DECK_TOP_MILL`'s singular
//     opponent-side branch (D131). ONE printing, so alone it would NOT clear
//     D121's warrant; beside Fuecoco it is a second member of a shape the
//     engine already reads a third instance of (`FLIP_DEFENDER_NOW`,
//     `FLIP_OPPONENT_ACTIVE_DISCARD`), which is what makes it defensible.
//
// LITERAL ARMS, NOT A TEMPLATE, and this is the D120 precondition failing
// rather than a preference. The token that varies between these two anchors is
// the WHOLE CONSEQUENT — an open-ended vocabulary of everything an `EffectOp`
// can express — where D120 only licenses a template when the varying token has
// a CLOSED reading (the five status words, the nine energy codes). So the gate
// prefix is spelled out once per consequent, exactly as the family's two
// existing members already spell it, and the file now carries four copies of
// "Flip a coin. If heads, " on purpose.
//
// THE CONSEQUENT IS LOWERCASE, which is the whole reason the standing "no /i"
// rule (see TYPED_SELF_DISCARD) has teeth here: `SELF_HEAL` starts at `^Heal`
// and `DECK_TOP_MILL` at `^Discard`, so neither can claim these strings even
// without the anchor — the capital is a second, independent guard. Adding /i
// anywhere in this file would collapse both guards to one at once.
//
// NEITHER NEEDS A NEW OP. `heal { target: "self" }` and `discardDeckTop` both
// already exist, and `coinFlipGate` has spliced a branch into the work queue
// since 0.x — so each of these is a regex and an arm, and the derived program's
// `then` is BYTE-IDENTICAL to what the bare anchor derives for the same clause.
// That identity is the family's checkable claim (D132's inventory rule, third
// slice running), and flipGatedOp.test.ts asserts it in both directions.
const FLIP_SELF_HEAL = /^Flip a coin\. If heads, heal (\d+) damage from this Pokémon\.$/;
// DELIBERATELY NARROWER THAN `DECK_TOP_MILL`, whose body reads both a plural
// count and either deck. Exactly one printing exists and it is the SINGULAR,
// OPPONENT-side one; widening the gated form to "the top N cards" or to "your
// deck" would invent three readings the ingest has never produced, which is the
// same guess this file refuses everywhere else ("all of your Pokémon", "Remove
// N damage counters"). When a printing of a wider gated mill appears, widen the
// body then — the bare anchor is the precedent for how (D131), and the singular
// branch there is likewise a spelling rather than an optional digit.
const FLIP_DECK_TOP_MILL =
  /^Flip a coin\. If heads, discard the top card of your opponent['’]s deck\.$/;
// The GATED PREVENT clause (D142) — the biggest un-taken count in D134's gated
// census, and the pool's TWO printed spellings of one installation:
//
//   • 11 printings say "prevent all damage FROM AND EFFECTS OF attacks done to
//     this Pokémon" — Joltik sv06.5-001 + Hoppip sv02-001 "Splashing Dodge",
//     Wiglett sv01-055/-206 "Twisting Strike", Aipom swsh10.5-056 "Bustle",
//     Nymble sv02-019 "Slight Splash", Cufant sv02-109/-219 "Hit and Hide",
//     Scyther sv03-004 "Agility", Dugtrio sv03-104 "Dig", Barboach sv03-108
//     "Hide";
//   • 2 say "prevent all damage done to this Pokémon by attacks" — Glimmet
//     sv03-121 "Iron Defense", Togedemaru sv03-151 "Defense Curl".
//
// TWO SPELLINGS ARE NOT ONE SENTENCE SPELLED TWICE. The census the resume point
// carried counted them together (11 + 2 = "13 printings / 2 spellings"), which
// is true as a count and misleading as a description: they are two READINGS, and
// the words "from and effects of" are the entire difference. That is what the
// `effects` field carries, and both anchors are written out in full rather than
// folded into one optional group — the shorter one is not a prefix of the longer
// (`damage done to this Pokémon by attacks` vs `damage from and effects of
// attacks done to this Pokémon`), so there is no group to make optional.
//
// SIX COPIES OF THE GATE PREFIX NOW, on D134's argument unchanged: the varying
// token is the whole consequent, an OPEN vocabulary, so D120's template
// precondition fails and the prefix is spelled per consequent on purpose.
//
// THE 6 UNGATED / OTHERWISE-GATED PRINTINGS OF THIS FAMILY STAY LOUD, and each is
// refused by a property of the WHOLE-SENTENCE anchor rather than by luck:
//   • "During your opponent's next turn, prevent all damage done to this Pokémon
//     by attacks from Basic Pokémon." (3 — Fletchling sv01-150 "Tailspin Away",
//     Bombirdier sv02-153/-246 "Covert Flight") and "…from Ancient Pokémon."
//     (1 — Iron Moth sv06.5-009 "Anachronism Repulsor") narrow the block by the
//     ATTACKER's class, which is a field and a predicate this op does not have;
//   • "If your opponent's Pokémon is Knocked Out by damage from this attack, …"
//     (1 — Grimmsnarl sv02-148 "Accelerate") gates on the attack's own RESULT,
//     the §9.2 channel Iron Moth "Suction" and Camerupt want;
//   • "Flip a coin. If tails, this attack does nothing. If heads, …" (1 —
//     Squawkabilly sv01-162 "Fly") carries a SECOND consequent on the same flip.
// Each is a separate warrant, written down here so the next slice inherits the
// list rather than re-censusing for it.
const FLIP_PREVENT_DAMAGE_AND_EFFECTS =
  /^Flip a coin\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;
const FLIP_PREVENT_DAMAGE =
  /^Flip a coin\. If heads, during your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks\.$/;
// The COUNTER MOVE (D138) — "Move all damage counters from 1 of your Benched
// Pokémon to your opponent's Active Pokémon.", the whole printed effect. TWO
// printings, both Dedenne ex "Tail Swap" (sv02-093 Double rare / sv02-239 Ultra
// Rare — one attack in two rarities), so D121's second-printing warrant is met by
// the card and not by a family argument. Neither printing carries a `damage`
// field, so the move is the entire visible result of the declaration.
//
// ⚠️ THE ATTACK IS NAMED "Tail Swap". Three remainder lists called it
// "Dedechange" and no printing of that name exists in this pool at all — checked
// against the local D1 while censusing (conventions.md: verify a doc reference
// against the source before relying on it, and D137's own correction of a resume
// point that named two symbols that did not exist).
//
// CENSUS (local D1, 2026-08-02, whole effect string, 978 cards). Every attack
// effect containing "damage counter" is 56 printings / 31 distinct clauses; the
// ones that MOVE rather than PUT are this sentence and nothing else. The whole
// counter-move neighbourhood in the pool is three clauses, and the other two are
// ABILITIES on a different reader:
//   • Munkidori sv06.5-072 "Adrena-Brain" — "…you may move up to 3 damage
//     counters from 1 of your Pokémon to 1 of your opponent's Pokémon." (1)
//   • Slowbro sv01-043 "Strange Behavior" — "…you may move 1 damage counter from
//     1 of your other Pokémon to this Pokémon." (1)
// Both differ from this anchor on THREE axes at once (a bounded amount, a source
// zone that includes the Active, and a destination that is chosen or is your own
// side), which is why the op takes no fields — see its doc block for the
// condition that would earn them.
//
// A WHOLE-SENTENCE ANCHOR, and the near misses it must refuse are all real
// catalog rows that share its opening noun phrase: "Put N damage counters on your
// opponent's Active Pokémon." (Mimikyu sv02-097, Polteageist sv03-098) PUTS
// counters from nowhere rather than moving them off your own board — read since
// 0.88.0 by `COUNTER_PUT_ON_DEFENDER` below, a SEPARATE anchor on a separate op —
// and "Put damage counters on your opponent's Active Pokémon until its remaining
// HP is 10." (Alolan Raticate swsh10.5-042) reads a number off the TARGET and is
// still unmapped. None of them starts with "Move", which is the one word that
// separates the family.
//
// The possessive carries the `['’]` class every sibling on this noun phrase does
// (D136/D137) — "your opponent's Active Pokémon" is the pool's single most
// re-printed phrase, and a slot classed here cannot be un-derived by a re-ingest
// that normalises punctuation. No /i, for the standing reason (see
// TYPED_SELF_DISCARD): the capitalised first word plus `^…$` is the WHOLE guard,
// and it is what keeps Munkidori's and Slowbro's lowercase mid-sentence "move"
// off this path.
const COUNTER_MOVE_TO_DEFENDER =
  /^Move all damage counters from 1 of your Benched Pokémon to your opponent['’]s Active Pokémon\.$/;
// The PUT on the defender (D139) — "Put {N} damage counters on your opponent's
// Active Pokémon.", the whole printed effect. TWO printings / TWO distinct
// clauses, on two different cards: Mimikyu sv02-097 "Ghost Eye" ({P}{C}, N = 7)
// and Polteageist sv03-098 "Pour Tea" ({P}, N = 5, attack INDEX 1). D121's
// second-printing warrant is met by two independent cards rather than by one card
// in two rarities, which is the stronger form of it. NEITHER carries a printed
// `damage` field, so the placement is the entire visible result of the
// declaration and there is no D125 tail-order question to answer.
//
// THE SIBLING OF `COUNTER_MOVE_TO_DEFENDER`, ONE WORD APART AT THE FRONT. That
// anchor's own near-miss list named both of these printings; this is the slice
// that maps them, and the two anchors stay disjoint by their first word exactly
// as `SELF_HEAL` and `DECK_TOP_MILL` do.
//
// CENSUS (local D1, 2026-08-02, whole effect string, 978 cards; D138's sweep,
// re-read for the PUT half rather than re-run). Attack effects containing
// "damage counter" — 56 printings / 31 distinct clauses. Of those, the ones whose
// ACTION is putting counters — 24 printings / 15 clauses; the ones aimed at
// "your opponent's Active Pokémon" — 4 printings / 4 clauses, and this anchor
// takes 2 of them. The other two read their amount off the TARGET rather than off
// the text ("…until its remaining HP is 10." — Alolan Raticate swsh10.5-042 bare,
// Claydol sv03-095 with a self-damage rider), which is a different mechanism and
// no capture can express it.
//
// THE QUANTITY SLOT IS A BARE `(\d+)` AND THEREFORE NOT A D120 TEMPLATE. That
// rule licenses a lookup TABLE only when the varying token has a CLOSED
// vocabulary to be rejected against (the five status words, the nine energy
// codes); a count is an open integer with nothing to reject it with, so the
// number lands in a FIELD of one op, as D131's two captures and D135's amount do.
// The cross product it accepts is deliberately UNFILTERED beyond `>= 1`: "Put 1
// damage counters …" is unprinted and ungrammatical but unambiguous, and the op
// expresses it exactly. Refusing it would be a claim about the INGEST, not about
// the GAME — the identical call D131 made for "the top 1 cards" and D135 for the
// unprinted "Heal all damage from 1 of your Pokémon."
//
// AND THE SINGULAR IS NOT A BRANCH, which is where this differs from D131. There
// the pool printed BOTH spellings ("the top card" / "the top N cards"), so the
// singular earned its own alternation. Here every ATTACK printing is the plural;
// the pool's only singular is Trevenant sv03-012's ABILITY ("put 1 damage counter
// on your opponent's Active Pokémon"), which is lowercase, mid-sentence, behind a
// Checkup clause, and already carries a registry row producing this very op. A
// singular branch would therefore invent a reading nothing prints.
//
// The possessive carries the `['’]` class (D136/D137), and no /i for the standing
// reason (see TYPED_SELF_DISCARD): the capitalised "Put" plus `^…$` is what keeps
// Dusknoir sv06.5-020's and Meowscarada ex sv02-015's lowercase mid-sentence
// "put … damage counters on 1 of your opponent's Pokémon" — both ABILITIES — off
// this path.
const COUNTER_PUT_ON_DEFENDER =
  /^Put (\d+) damage counters on your opponent['’]s Active Pokémon\.$/;
// "Put {N} damage counters on 1 of your opponent's Benched Pokémon." — the BENCH
// half of the same printed action, and the ONE clause it has (D140). Ting-Lu ex
// sv02-127/-243/-263/-275 "Land Scoop" ({F}{F}{F}, 2 counters) — FOUR printings of
// one card, all four beside a printed `damage` of 150, so this is also the family's
// first sentence that shares its attack with real §8.5 damage (D125's tail).
//
// D132's INVENTORY RULE FOR THE FIFTH TIME: the op is `damageChosen` with
// `target: "opponentBench"`, `count: 1`, no `deals` — the shape Meowscarada ex
// sv02-015's "Bouquet Magic" registry row has authored since M4 slice 8, at a
// different amount (3 counters → 30). What was missing was a READER for the same
// action printed as an ATTACK, so there is no new op, no new prompt and no new
// park; the `count: 1` pick over `oppBenchRefs` is the one the two Ability rows
// already take.
//
// CENSUS (local D1, 2026-08-02, whole effect string, 978 cards — D139's PUT census
// re-read for the BENCH target rather than re-run; that census is CLOSED). Of the
// 24 printings / 15 clauses whose ACTION is putting counters, the ones aimed at
// "1 of your opponent's Benched Pokémon" are EXACTLY THESE FOUR, on ONE clause,
// and they are the whole set an attack-side reader can reach: the pool's other
// three printings of this noun phrase are the ABILITIES this anchor refuses by
// case alone (Meowscarada ex ×4 and Radiant Blastoise swsh10.5-018, both
// lowercase and mid-sentence).
//
// THE TARGET IS THE WHOLE DIFFERENCE FROM `COUNTER_PUT_ON_DEFENDER` and the two
// anchors are one noun phrase apart, so both are whole-sentence `^…$` and each
// keeps deriving its own op — asserted in both directions rather than reasoned
// about. The near neighbours a looser pattern would swallow are all real rows:
// Ninetales sv03-029/-199's any-zone "on 1 of your opponent's Pokémon." (no
// "Benched", plus a second sentence), Vespiquen ex sv03-096/-212's "each of your
// opponent's Benched Pokémon that has any damage counters on it.", and the
// self-aimed "1 of your Benched Pokémon" of the heal family.
//
// The count is a bare `(\d+)` for D139's reason — not a D120 template, since a
// count has no CLOSED vocabulary to be rejected against — and the cross product is
// unfiltered above zero for D131's. ONE apostrophe slot, not two: the sentence
// carries TWO possessives ("your" and "opponent's") but only the second one is
// written with a mark, so `['’]` (D136/D137) belongs in exactly one place and the
// D137 hazard (classing one slot and not the other) cannot arise here. No /i, for
// the standing reason: the capitalised "Put" plus `^…$` is the entire mechanism
// keeping the five lowercase Ability printings of this same sentence off this path.
const COUNTER_PUT_ON_OPPONENT_BENCH =
  /^Put (\d+) damage counters on 1 of your opponent['’]s Benched Pokémon\.$/;
// The SELF-LOCK (D143) — "During your next turn, this Pokémon can't attack.", the
// whole printed effect on TWENTY printings, and the same sentence again as the
// SECOND half of Ninetales sv03-029/-199 "Nine-Tailed Dance" (the compound anchor
// below). It is the drawback half of a big-damage attack and the pool's most
// re-printed durated rider after D112's retreat lock.
//
// CENSUS (local D1, 2026-08-02, whole effect string, 978 cards — a NEW census,
// run for THIS question rather than read off D142's duration table, per that
// slice's own rule that a census run for one purpose is a FLOOR for every other).
// "can't attack" appears on 38 printings in all: 33 in `attacks_json`, 2 in
// `abilities_json` (Slaking V swsh10.5-058/-077 "Kinda Lazy" — a Prize-count
// CONDITION with no duration at all) and 3 on a TRAINER (Geeta sv03-188/-218/-226
// — "During THIS turn, YOUR POKÉMON can't attack", a different turn and a whole
// board). Inside `attacks_json`, the SELF-lock family is 29 printings across FIVE
// sentences and this anchor takes 20 of them; the compound below takes 2 more.
// The five, and why the other three sentences stay LOUD:
//   • "During your next turn, this Pokémon can't attack."                   (20) ✅
//   • "Put {N} damage counters … . During your next turn, …can't attack."   ( 2) ✅
//   • "Flip a coin. If tails, during your next turn, this Pokémon can't
//     attack." (5 — Oinkologne sv01-157, Oinkologne ex sv01-158/-234, Paldean
//     Clodsire ex sv02-130/-244) — a TAILS gate, and `coinFlipGate` runs its
//     body on HEADS only, so the gate is a field or an op this engine has not
//     got. The cheapest widening of THIS slice.
//   • "You may do 100 more damage. If you do, during your next turn, this
//     Pokémon can't attack." (1 — Copperajah sv06.5-042) — an OPTIONAL damage
//     bonus whose acceptance installs the lock: a player decision in front of the
//     §8.5 pipeline, which is a park the damage fold cannot express today.
//   • "Flip a coin. If heads, this attack does 140 more damage. If tails, during
//     your next turn, this Pokémon can't attack." (1 — Dragonite ex sv03-159) —
//     TWO consequents on ONE flip, D142's Squawkabilly refusal in another family.
// The neighbouring OPPONENT-side lock is 4 printings across 2 sentences (Eiscue
// ex sv03-042/-210/-222 "Scalding Block", Houndoom ex sv03-134 "Evil Claw") and
// is refused on the printed subject; the per-ATTACK lock ("this Pokémon can't use
// {AttackName}") is 8 printings across 6 sentences and is refused on the verb.
// Both are written into the op's doc block as the conditions that would earn it
// fields, rather than guessed at from one printing.
//
// A WHOLE-SENTENCE ANCHOR with NO CAPTURE — nothing in it varies. Both apostrophe
// slots carry `['’]` (D136/D137): "can't" is a CONTRACTION rather than a
// possessive, which is exactly the slot D137 found `ATTACK_REQUIREMENT_CLAUSES`
// exposed on, so the class belongs here for the same reason. No /i, for the
// standing reason (see TYPED_SELF_DISCARD): the capitalised "During" plus `^…$`
// is the whole guard, and it is what keeps the five gated printings — whose
// "during" is lowercase and mid-sentence — off this path.
const SELF_CANT_ATTACK_NEXT_TURN = /^During your next turn, this Pokémon can['’]t attack\.$/;
// …and the COMPOUND (D143) — Ninetales sv03-029/-199 "Nine-Tailed Dance"
// ({R}{R}, attack INDEX 1, 9 counters, NO printed `damage`), 2 printings of one
// card in two rarities. TWO SENTENCES IN ONE ANCHOR, which is D125's two-consequent
// question answered the way `DEFENDER_POISON_CANT_RETREAT` answered it: one
// whole-string `^…$` pattern deriving TWO ops in PRINTED ORDER. Matching the two
// halves independently would mean matching a PREFIX, and the family's whole
// safety property is that an unrecognised remainder stays LOUD — a reader that
// swallowed sentence one and dropped sentence two would silently ship an attack
// with no drawback, which is strictly worse than not reading it at all.
//
// Sentence one is the ANY-ZONE counter PUT, one noun phrase away from D140's
// `COUNTER_PUT_ON_OPPONENT_BENCH` ("1 of your opponent's Pokémon" rather than "1
// of your opponent's BENCHED Pokémon") and thus `damageChosen { target:
// "opponentAny" }` — the op `CHOSEN_ANY_TARGET` has produced since 0.x, but with
// `deals` ABSENT, which is the combination nothing had ever produced: see
// `placeSnipe`'s Active arm (interpreter.ts), which had to be written for it.
// It is NOT printed as a standalone sentence ANYWHERE in the pool — every other
// printing of that noun phrase is an ABILITY (Dusclops sv06.5-019/-069 and
// Dusknoir sv06.5-020/-070 "Cursed Blast"), refused by the capitalised "Put"
// plus `^…$` exactly as D139/D140's anchors refuse theirs. So the compound is the
// ONLY form this sentence takes, which is why there is no bare any-zone anchor.
//
// THREE apostrophe slots, all classed (D136/D137): the possessive "opponent's"
// and the contraction "can't", plus the one inside the reused half — and the
// D137 hazard here is real rather than theoretical, since classing the possessive
// and not the contraction is precisely the half-fix that reads like a whole one.
const COUNTER_PUT_ANY_THEN_SELF_LOCK =
  /^Put (\d+) damage counters on 1 of your opponent['’]s Pokémon\. During your next turn, this Pokémon can['’]t attack\.$/;
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
// D131 — the UNCONDITIONAL MILL, both directions on ONE anchor: "Discard the top
// [N cards|card] of your [opponent's] deck." 16 printings / 7 distinct clauses
// (censused against the local D1 2026-08-01), split 7 opponent-side (Chi-Yu ex
// sv02-040/-234/-259, Garganacl sv02-123, Diggersby sv03-113, Paldean Clodsire
// sv03-128, Skwovet sv03-178) and 9 own-side (Fraxure sv06.5-045/-077, Haxorus
// sv06.5-046, Gyarados swsh10.5-022 "Wild Splash", Tyranitar sv02-135/-222,
// Tyranitar ex sv03-066/-211, Diglett sv03-103).
//
// TWO TOKENS VARY AND IT IS STILL ONE PATTERN, which does not contradict D119 —
// that rule is about the clause TABLE, where a row is a lookup key and a
// two-token row is really N rows in a trench coat. Here both tokens land in
// FIELDS of one op (`count`, `whose`), each has a CLOSED reading, and the
// sentence they sit in is a single printed action. D119's test — "if two things
// vary it is not one token" — is a test for whether you have one CLAUSE, and a
// regex with two captures is honest about having two.
//
// THE SINGULAR IS A SEPARATE BRANCH, NOT `(\d+)?`, because the two are two printed
// SPELLINGS and not one with an optional part: "the top card" (7 printings) carries
// no digits at all, "the top N cards" (9) always carries one, and "the top cards"
// — plural with no number — is neither and has no reading. The undefined capture
// means one, invented at the site. The branch is about spelling and does NOT filter:
// "the top 1 cards" is not English and no card prints it, but `\d+` accepts it and
// reads it as one, which is the only reading it could have.
//
// The near-misses are all real catalog rows and every one is refused by the
// anchors alone: Wiglett sv01-056 ("Flip a coin. If heads, discard…" — gated),
// Wugtrio sv01-057 / Gyarados swsh10.5-022 index 0 (D130's per-heads programs),
// Whiscash sv03-109 ("For each {F} Energy attached to this Pokémon, discard…" —
// a board-counted amount, and the sentence Krookodile's warning above is about),
// and Camerupt sv03-032 ("Discard the top card of EACH PLAYER'S deck. This attack
// does 100 more damage for each Energy card discarded in this way." — two decks
// AND a damage bonus that reads what was discarded; a genuinely different slice
// that must land loudly). No /i, for the family's stated reason.
const DECK_TOP_MILL = /^Discard the top (?:(\d+) cards|card) of your (opponent['’]s )?deck\.$/;
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
// apostrophes are ASCII in the catalog (verified against the D1 rows) and both
// slots carry the `['’]` class anyway, and `Pokémon` carries the real é — a
// lookalike é would silently fall off the path.
//
// ⚠️ THESE TWO WERE THE LAST STRAIGHT-ONLY PATTERNS IN THE FILE, found by D137's
// census and fixed there. D136's review named three; it did not look for a
// sentence carrying TWO possessives, and this pair carries the only ones in the
// pool ("your opponent's Active Pokémon's Retreat Cost"). The class is applied to
// BOTH slots, because a re-ingest that normalised punctuation would change them
// together and half a fix reads exactly like the whole one until it does not.
const RETREAT_COST_SCALE =
  /^This attack does (\d+) more damage for each \{C\} in your opponent['’]s Active Pokémon['’]s Retreat Cost\.$/;
const RETREAT_COST_MULTIPLY =
  /^This attack does (\d+) damage for each \{C\} in your opponent['’]s Active Pokémon['’]s Retreat Cost\.$/;
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
    apostrophe is ASCII, both verified against the local D1 rows; a lookalike é
    would silently un-map the clause. A curly apostrophe no longer does — five of
    these rows spell `opponent's`, and since D137 the lookup retries a miss with
    U+2019 folded to U+0027 (`literalClauseRow`), which is the literal-table
    equivalent of the `['’]` class the regexes carry. The KEYS stay ASCII, because
    they record what the catalog actually prints. `Poisoned`, `Special Condition`,
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
  ["your opponent's Active Pokémon is an Evolution Pokémon", { kind: "opponentActiveIsEvolution" }],
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
const OPPONENT_ACTIVE_TYPE_CLAUSE = /^your opponent['’]s Active Pokémon is a (.+) Pokémon$/;
const CLAUSE_POKEMON_TYPES: ReadonlyMap<string, PokemonType> = new Map(
  POKEMON_TYPES.map((type) => [type, type] as [string, PokemonType]),
);

/** THE APOSTROPHE FOLD (D137) — the LITERAL-TABLE half of the hardening D136 gave
    the regexes, and the ONE site every exact lookup on printed text goes through.

    D136 gave three patterns the `['’]` class that every sibling reading the same
    noun phrase already carried, so a catalog re-ingest normalising straight
    apostrophes to U+2019 could not silently un-derive their sentences. The
    LITERAL tables carry the identical exposure — SEVEN of their twenty-one rows
    spell a possessive or a contraction ("your opponent's Active Pokémon is
    Poisoned", "this Pokémon didn't move from the Bench to the Active Spot this
    turn", and five more) — and a Map key CANNOT carry a character class: it is
    one exact string of bytes or it is nothing. So the hardening has to move off
    the KEY and onto the LOOKUP, which is this function.

    THE FOLD IS A FALLBACK, NOT A NORMALISATION PASS. The clause as printed is
    tried FIRST and always wins; only when that misses is U+2019 folded to U+0027
    and the table asked a second time. That ordering is what makes the change
    provably conservative — it can turn a MISS into a hit and can never turn a hit
    into a DIFFERENT hit, so no clause any row already owns is re-interpreted —
    and it leaves a future row keyed with a curly apostrophe reachable by its own
    bytes rather than shadowed by the fold.

    IT FOLDS THE APOSTROPHE AND NOTHING ELSE. No lowercasing, no trimming beyond
    what the readers already do, and emphatically no Unicode normalisation of the
    é in `Pokémon`: the tables' own doc blocks commit to a REAL U+00E9 and to a
    matcher with no /i, and those commitments are load-bearing (`Poisoned`,
    `Special Condition`, `Benched`, `Active` and `Evolution` are CAPITALISED as
    printed and told apart from ordinary words by nothing else). A wider fold
    would be a different and much larger design call, because it would owe a
    row-by-row argument that no two distinct printed clauses COLLIDE under it. The
    apostrophe needs no such survey: U+2019 and U+0027 are the same punctuation
    mark in two encodings, no printed clause in the pool is distinguished from
    another by which one it uses, and the pool holds zero U+2019 today —
    re-verified against the local D1 at D137, 0 of 978 rows in `effect`,
    `attacks_json`, `abilities_json` and `name`, against 359 cards carrying the
    straight form in `attacks_json`.

    THE TEMPLATE PASS IS DELIBERATELY NOT ROUTED THROUGH HERE. The anchored
    patterns (SELF_ENERGY_ATTACHED_CLAUSE, OPPONENT_ACTIVE_TYPE_CLAUSE and every
    skeleton above them) carry `['’]` in their own source and match the RAW
    clause. Folding before them would be harmless but redundant; folding INSTEAD
    of the class would move a documented, greppable property of each regex into a
    caller the regex cannot see. Two mechanisms, one per pass, each visible at the
    site where it applies. What reaches THIS function out of a template is the
    CAPTURE — an energy token, a type name — which is why the two token maps are
    routed through it as well even though their closed, schema-derived
    vocabularies can never hold an apostrophe: the rule is "every exact lookup on
    printed text", not "every exact lookup that needs it today", so a table added
    by a later slice INHERITS the hardening instead of having to remember it.

    Four tables, five call sites, and that is the whole census. The only exact
    lookup on printed text that does not come through here is
    `deriveAttackEffect`'s ENERGY_TYPE_BY_CODE / ENERGY_TYPE_BY_NAME pair, which
    are `Record`s rather than Maps and are indexed with a capture from
    TYPED_SELF_DISCARD — a regex whose alternation IS those two key sets, so an
    apostrophe cannot reach them by construction. */
const CURLY_APOSTROPHE = "’";
const STRAIGHT_APOSTROPHE = "'";
function literalClauseRow<T>(table: ReadonlyMap<string, T>, clause: string): T | undefined {
  const exact = table.get(clause);
  if (exact !== undefined) return exact;
  // The `includes` guard is not an optimisation: it states that the second lookup
  // exists ONLY for text carrying a curly apostrophe, so a clause that misses for
  // any other reason misses exactly once and stays LOUD.
  return clause.includes(CURLY_APOSTROPHE)
    ? table.get(clause.replaceAll(CURLY_APOSTROPHE, STRAIGHT_APOSTROPHE))
    : undefined;
}

/** The printed clause between the leading "If " and the ", this attack does" →
    a `BoardCondition`, or null when nothing claims it (which keeps the sentence
    on the loud ATTACK_EFFECT_SKIPPED path — never a silent 0).

    Two passes, in this order and no other: the LITERAL table first, then the
    parameterised patterns. Literals win by construction, so adding a template
    can never re-interpret a clause a row already owns.

    Every exact lookup below goes through `literalClauseRow` (D137), which retries
    a miss with U+2019 folded to U+0027 — the literal-table equivalent of the
    `['’]` class the two patterns carry in their own source. The patterns
    themselves are handed the RAW clause on purpose; see that function. */
function boardConditionForClause(clause: string): BoardCondition | null {
  const literal = literalClauseRow(CONDITIONAL_DAMAGE_CLAUSES, clause);
  if (literal !== undefined) return literal;
  const selfEnergy = SELF_ENERGY_ATTACHED_CLAUSE.exec(clause);
  if (selfEnergy !== null) {
    const energy = literalClauseRow(CLAUSE_ENERGY_TOKENS, selfEnergy[1] ?? "");
    if (energy !== undefined) return { kind: "yourActiveHasEnergyAttached", energy };
  }
  const activeType = OPPONENT_ACTIVE_TYPE_CLAUSE.exec(clause);
  if (activeType !== null) {
    const type = literalClauseRow(CLAUSE_POKEMON_TYPES, activeType[1] ?? "");
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
    pool holds zero U+2019, re-verified at D137). `Pokémon` carries a real U+00E9.
    BOTH rows carry an apostrophe — the contraction in one, the possessive in the
    other — so both are read through `literalClauseRow`, which retries a miss with
    U+2019 folded to U+0027 (D137). The keys themselves stay ASCII: they record
    what the catalog prints, not what the lookup will tolerate. */
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
    vocabularies, no crossover.

    It shares the LOOKUP HELPER, though, and that is not a crossover: D137's
    `literalClauseRow` takes the table as an argument, so the two vocabularies
    stay disjoint while the U+2019 fold is written once. There is no choke point
    ABOVE this — the disjointness above is deliberate and each consequent owns its
    own reader — so "the fold lives in the helper every table is read through" is
    the only placement that a future third consequent inherits for free. */
export function deriveAttackRequirement(text: string): BoardCondition | null {
  const nothing = ATTACK_DOES_NOTHING.exec(text.trim());
  if (nothing === null) return null;
  return literalClauseRow(ATTACK_REQUIREMENT_CLAUSES, nothing[1] ?? "") ?? null;
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
//   • "Flip a coin until you get tails. …" — an UNBOUNDED number of flips, refused
//     by the literal `^Flip a coin\.` and read two patterns down instead (D129);
//   • "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."
//     (16 printings) — a different consequent entirely, and one `deriveAttackEffect`
//     ALREADY reads as a `coinFlipGate` program. It must never be read here too,
//     or the attack would flip twice; the consequent anchor is what prevents it.
// All of them stay on the loud ATTACK_EFFECT_SKIPPED path, which is where they
// belong.
const ATTACK_COIN_BONUS = /^Flip a coin\. If heads, this attack does (\d+) more damage\.$/;
const ATTACK_COIN_CANCEL = /^Flip a coin\. If tails, this attack does nothing\.$/;

// The MULTI-FLIP COUNT FOLD (D127) — "Flip N coins. This attack does D damage for
// each heads." — 22 printings on ONE regex, N ∈ {2 (12 prints), 3 (9), 4 (1)},
// D ∈ {10, 20, 30, 40, 50, 60, 70, 80, 100}. The SAME seam D126 built, with a
// bounded LOOP where D126 took a single draw, and it needs neither a new event nor
// a new site: N flips are announced as N `ATTACK_EFFECT_COIN_FLIP` rows in order
// (the event already carries exactly one `CoinFace`, so a sequence of them is the
// only reading that does not invent an aggregate the wire cannot express).
//
// IT IS A MULTIPLY PRINTING, NOT AN ADDITIVE ONE. Every one of the 22 carries a
// printed "D×" damage marker whose digits ARE the per-heads D — so `attack.ts`
// must DROP the printed base exactly as it does for `deriveAttackDamageMultiplier`,
// or a 2-heads "30×" Double Hit would deal 30 + 60 instead of 60. The word that
// tells the two families apart is "more", and the pool's two "more" variants are
// live near-misses this regex must refuse: Melmetal swsh10.5-046 ("Flip 2 coins.
// This attack does 90 more damage for each heads.", base "30+") and Bouffalant
// sv03-174 ("Flip a coin until you get tails. This attack does 30 more damage for
// each heads.", base "50+"). A substring matcher would score both wrong.
//
// AND YET IT IS NOT A `DamageCountSource` (D126's rule, applied not re-derived):
// the count comes from the flips, not from the board, so nothing in the state
// answers it and `scaledAttackDamage` must stay pure. It belongs in the coin union
// with its siblings, at the coin site, for the same reason they do.
//
// The shapes it refuses at the leading sentence: "Flip a coin for each {R} Energy
// attached to this Pokémon. …" (3 prints — the BOARD-counted flip count, built one
// pattern down by D128) and "Flip a coin until you get tails. …" (8 prints, an
// UNBOUNDED fold, built two patterns down by D129 — a genuinely different risk
// from either of these two, since it has no bound from the text OR from the
// board and had to buy a termination argument instead of a ceiling).
const ATTACK_COIN_MULTI = /^Flip (\d+) coins\. This attack does (\d+) damage for each heads\.$/;

// The BOARD-COUNTED FLIP COUNT (D128) — "Flip a coin for each [{X}] Energy attached
// to this Pokémon. This attack does D damage for each heads." — 3 printings, and
// the shape where the board vocabulary finally earns its place in the coin family.
// Census (2026-08-01, `attacks_json`, 978 cards): Torkoal sv01-035 "Concentrated
// Fire" (`80×`, the TYPED `{R}` reading and the pool's ONLY coin effect containing
// a brace token), Ambipom swsh10.5-057 "Full Tilt Fling" (`60×`) and Bellossom
// sv03-003 "Powerful Dance" (`90×`) — the UNTYPED reading, two printings, so D121's
// warrant for one shared shape is satisfied rather than assumed. Nothing else in
// the pool counts anything at all with "flip a coin for each": the counted thing is
// ALWAYS self-attached Energy, and the only variation is the optional type filter.
//
// THE DAMAGE COUNT STILL COMES FROM THE FLIPS — D126's rule is untouched, and this
// is NOT a `DamageCountSource`. What is a board fact here is the number of FLIPS,
// which is the one number the board can answer and the coin cannot. So the slice is
// a widened `flips`, not a new consequent: the fold, the loop, the event sequence
// and the dropped printed base are all D127's, verbatim.
//
// BOTH NOTATIONS, for D118's reason and through D118's map. The pool prints energy
// types two ways, split cleanly by set (sv* brace-code, swsh10.5 spelled-out), and
// today all three printings of THIS sentence happen to sit on the side that needs
// neither — Torkoal brace-codes, the other two carry no filter at all. Resolving
// the token through `CLAUSE_ENERGY_TOKENS` rather than a local `{R}`-only lookup
// costs nothing and means a swsh-era reprint reading "for each Water Energy" is
// admitted by construction instead of silently skipped.
const ATTACK_COIN_PER_ENERGY =
  /^Flip a coin for each (?:(.+) )?Energy attached to this Pokémon\. This attack does (\d+) damage for each heads\.$/;

// The UNBOUNDED FOLD (D129) — "Flip a coin until you get tails. This attack does
// D [more] damage for each heads." — the LAST damaging coin shape, and the only
// one whose flip count is bounded by NEITHER the text NOR the board. Census
// (2026-08-01, `attacks_json`, 809 cards with attacks): 8 printings say "until you
// get tails", 5 of them damaging and read here —
//   • MULTIPLY (4): Growlithe sv01-030 "Relentless Flames" (30×), Rellor sv02-026
//     "Ball Roll" (30×), Forretress sv01-139 "Continuous Spin" (50×), Chansey
//     sv01-144 "Egg Rolling" (60×) — printed base DROPPED, like D127/D128.
//   • ADDITIVE (1): Bouffalant sv03-174 "Damage Rush" ("This attack does 30 MORE
//     damage for each heads.", base "50+") — printed base KEPT.
// The other 3 print "For each heads, <effect>." and run an EffectOp per heads
// rather than folding a number; they stay on the loud skipped path (D129).
//
// TWO REGEXES BECAUSE THE CONSEQUENT DIFFERS, and this is D128's question asked
// and answered the other way round. D128 widened a field because the consequent
// was untouched; here the word "more" moves the printed base between kept and
// dropped, which is the one difference the coin union already spends two members
// on (`bonusOnHeads` keeps, `perHeads` drops). So the additive form is
// `bonusOnHeads` and the multiply form is `perHeads` — the SAME two members, now
// reached by a second flip count. Reading the marker at `scaledBase` instead
// would have made the base a property of the printing rather than of the shape,
// and `bonusOnHeads`/`perHeads` would have stopped meaning anything.
//
// AND THAT IS WHY `bonusOnHeads` GREW A `flips` FIELD. It was "one flip, add per
// heads"; Bouffalant is the same consequent over an unbounded count, so only the
// SOURCE of the number moved — D128's rule exactly, applied to the other member.
// Its D126 printings now derive `flips: { kind: "printed", count: 1 }`, which is
// what they always were implicitly.
//
// Anchored and disjoint from all four siblings by the leading sentence: "Flip a
// coin until you get tails." denies `^Flip a coin\.` its literal period and
// `^Flip (\d+) coins\.` its digits. The two patterns here are disjoint from EACH
// OTHER by "more" — `(\d+) damage` cannot span "30 more damage" — which is the
// same word that separates the whole additive family from the multiply one, and
// the same near-miss D127's regex was built to refuse (it named Bouffalant by
// name). Order between them is therefore free; "more" is tested first only
// because it is the narrower sentence.
const ATTACK_COIN_UNTIL_TAILS_BONUS =
  /^Flip a coin until you get tails\. This attack does (\d+) more damage for each heads\.$/;
const ATTACK_COIN_UNTIL_TAILS_MULTI =
  /^Flip a coin until you get tails\. This attack does (\d+) damage for each heads\.$/;

// The PER-HEADS PROGRAM (D130) — "Flip {N} coins|a coin until you get tails. For
// each heads, discard the top {M} cards of your opponent's deck." — the coin
// family's first consequent that is NOT a number. Census (2026-08-01,
// `attacks_json`, 809 cards with attacks): FOUR printings say "For each heads,",
// and exactly TWO of them mill the opponent's deck — Wugtrio sv01-057 "Undersea
// Tunnel" (idx 1, {C}{C}{C}, top 3) and Gyarados swsh10.5-022 "Wreak Havoc"
// (idx 0, {C}, top 2). Neither prints a `damage` field at all.
//
// TWO REGEXES BECAUSE THE FLIP COUNT IS PRINTED TWO WAYS, and that is the whole
// reason this is a slice rather than a one-off: one consequent reached by two
// members of `AttackFlipCount` is exactly the independence D128's doc block
// claims, demonstrated. The consequent is byte-identical between them (only the
// count `M` varies), so the two patterns differ ONLY in their leading sentence —
// the same split D129's pair carries, and disjoint from all five siblings for the
// same reason: "until you get tails." denies `^Flip a coin\.` its literal period
// and `^Flip (\d+) coins\.` its digits, while "For each heads," denies all five
// of them their "This attack does" consequent.
//
// THE PLURAL `cards` IS LOAD-BEARING, and Wiglett sv01-056 "Dig a Little" is the
// live near-miss that proves it: "Flip a coin. If heads, discard the top card of
// your opponent's deck." is the SAME game action on the SAME zone, printed by the
// pre-evolution of one of this slice's own two cards — and the anchor refuses it
// on THREE separate counts. Its count is singular ("the top card", no digits at
// all, so `the top (\d+) cards` cannot span it); its flip count is the bare "Flip
// a coin." D126 reads; and its consequent is a GATE ("If heads, …", one flip, one
// conditional run) rather than a repeat ("For each heads, …", N flips, N runs).
// One of those three would be enough; all three is what makes the refusal an
// argument instead of an accident. A regex that admitted it would silently turn a
// `coinFlipGate` into a per-heads loop over a sentence that has only one flip.
//
// The other TWO "For each heads," printings are refused by the same `$`, and
// deliberately: Krookodile sv01-117 discards an Energy (a `discardEnergy` that
// PARKS on a choice, so N heads is N sequential parks across a serialized
// continuation) and Masquerain sv03-007 discards a RANDOM card from the hand
// (which would be the first EffectOp in the engine to consume `state.rngState`).
// Both are real slices with costs of their own; neither is this one. Oinkologne
// sv03-184 "Flip 3 coins. Put a number of cards up to the number of heads from
// your discard pile into your hand." shares the opening and not the shape at all
// — a heads COUNT read as an "up to" ceiling by ONE op, not a repeat.
//
// No /i, for the family's standing reason: a capitalised first word is half of
// what keeps a mid-sentence clause off the derived path and the anchors are the
// other half.
// `['’]` on "opponent's", per the convention at the top of this block: these
// read the SAME noun phrase as DECK_TOP_MILL / FLIP_DECK_TOP_MILL, and a class
// on one but not the other is worse than neither — a re-ingest normalising to
// U+2019 would keep the unconditional mills deriving while these two silently
// dropped to the loud-skip path, which reads as a two-card regression rather
// than as punctuation.
const ATTACK_COIN_MILL_PRINTED =
  /^Flip (\d+) coins\. For each heads, discard the top (\d+) cards of your opponent['’]s deck\.$/;
const ATTACK_COIN_MILL_UNTIL_TAILS =
  /^Flip a coin until you get tails\. For each heads, discard the top (\d+) cards of your opponent['’]s deck\.$/;

/** The most flips a printed attack may call for before this deriver refuses the
    sentence. The pool's maximum is 4 (Unfezant swsh10.5-063, the family's only
    one); the ceiling exists because the digits are read out of THIRD-PARTY
    ingested text, and an unbounded `\d+` would let one malformed row spin the
    resolution loop for an arbitrarily long time. A refusal is LOUD — the attack
    lands on the ATTACK_EFFECT_SKIPPED path — where a hang is not.

    D128 — this ceiling is owed to the `printed` member ALONE, and deliberately
    does not travel to `attachedEnergy`. A bound is owed to the SOURCE of the
    number, not to the loop it feeds: printed digits come from third-party text
    and have no upper bound but this one, while an attached-Energy count is read
    off the engine's own state and is bounded by the deck that produced it. Adding
    a second ceiling there would refuse a legal board rather than a malformed row,
    which is the opposite of what this constant is for. */
const MAX_PRINTED_FLIPS = 10;

/** HOW MANY times an attack's printed sentence calls for the coin to be flipped
    (D128). Three members, because the pool prints the count three ways and only
    one of them is a number the deriver can read:
      • `printed` — the literal N of "Flip N coins." (D127), known at derivation.
      • `attachedEnergy` — "for each [{X}] Energy attached to this Pokémon", a
        BOARD fact resolved at the flip site. `energy` is the printed type filter,
        or null for the unfiltered form.
      • `untilTails` — "Flip a coin until you get tails." (D129). NOT A NUMBER AT
        ALL, at derivation OR at the flip site: the count is a property of the
        FACES, known only once they have been drawn. This is why the resolution
        side returns a sequence of faces rather than computing a count and then
        looping it — a "how many flips" reader cannot answer for this member, and
        widening it to return one would have meant flipping to find out how many
        times to flip. See `flipUntilTails`/`MAX_UNTIL_TAILS_FLIPS` in rng.ts for
        the termination argument, which is this member's real cost.

    The two readings of `energy` are not the same tally and the difference is the
    whole reason the field is nullable rather than defaulted. A FILTERED count is
    read by PROVISION (`providesEnergyType`, the D118 rule): an Energy that can pay
    a `{R}` cost is exactly an Energy a `{R}` clause counts, so a wildcard Luminous
    Energy is one for as long as it provides every type. An UNFILTERED count is
    read by CARD: "each Energy attached" counts attached Energy CARDS, and a
    Special Energy that provides nothing typed is still one of them. Collapsing
    null into "the type filter that matches everything" would quietly make the
    second question the first one, and get Ambipom wrong on any board holding a
    demoted Special. */
export type AttackFlipCount =
  | { kind: "printed"; count: number }
  | { kind: "attachedEnergy"; energy: BasicEnergyType | "special" | null }
  | { kind: "untilTails" };

/** What the pre-damage coin flip printed on an attack DOES with its faces. A
    union rather than a record, because a printing is exactly one of these and
    never two:
      • `bonusOnHeads` — `flips` flips; each heads adds `per` HP to the attack's
        own damage (folded alongside the count-scaling clauses' `scaled`, i.e.
        BEFORE Weakness and Resistance) and the printed base is KEPT (these are
        "D+" printings); tails adds nothing and the attack resolves normally.
      • `cancelOnTails` — one flip; tails cancels the whole attack (no damage, no
        W/R, no effect ops, and the turn still ends); heads resolves normally.
      • `perHeads` — `flips` flips; the damage is `per` × the number of heads and
        the printed base is DROPPED (these are "D×" printings, where D is `per`).
    `cancelOnTails` is "flip once, then take the printed branch", with the other
    face the plain resolution; the other two are folds over the faces, differing
    ONLY in what happens to the printed base. What the union buys is that
    `attack.ts` matches ONE value, so "an attack takes at most one printed flip
    DECISION" stays structural rather than a rule it must keep — D127 widened that
    from "at most one flip" without weakening it.

    D128 widened `perHeads.flips` from a number to an `AttackFlipCount`, which is
    where the board-counted printings land, and D129 widened `bonusOnHeads` the
    same way (its D126 printings are `{ kind: "printed", count: 1 }`, which is what
    they always were implicitly). Both are widenings of CARDINALITY only: the
    members still mean what they meant, still emit one row per flip, and still
    resolve at the same site. THE UNION HAS STAYED THREE MEMBERS ACROSS FOUR
    SHAPES because the flip COUNT and the flip CONSEQUENT are independent axes —
    a member per (count × consequent) pair would be six members and five copies of
    the same fold.

    `bonusOnHeads` is NOT folded into `perHeads`, even though the arithmetic
    coincides (`heads × per` is right for both, and `attack.ts` computes them with
    one expression on purpose). They differ in the one place that is not
    arithmetic: the printed marker. "+" keeps the base, "×" drops it, and collapsing
    the members would hide that behind a flag. D129 is the proof that the split was
    load-bearing rather than incidental: "Flip a coin until you get tails." prints
    BOTH ways, so one flip count reaches both members and the marker is the only
    thing telling Bouffalant's "50+" from Growlithe's "30×".

    D130 ADDS A FOURTH MEMBER AND IT IS NOT A FOLD AT ALL:
      • `programPerHeads` — `flips` flips; the `ops` PROGRAM runs once PER HEADS,
        and no number is folded (`per` would have nothing to multiply). "For each
        heads, discard the top N cards of your opponent's deck." is literally that
        op repeated `heads` times, so the flip site EXPANDS it — `attack.ts`
        appends `heads` copies onto the attack's `program` and the existing tail
        runs them. Named for the contrast with `perHeads`, which folds a NUMBER.
    It carries no `per`, KEEPS the printed base (there is no damage marker to
    consume — both printings print no `damage` field at all), and explains no
    `+`/`×` modifier, which is the one place `attack.ts` has to name it explicitly
    rather than let it ride the "not cancelOnTails" default.

    IT REUSES `AttackFlipCount` WHOLESALE — that union is UNCHANGED by this slice,
    and the fact that its two printings use two DIFFERENT members of it (Wugtrio
    sv01-057 is `printed 3`, Gyarados swsh10.5-022 is `untilTails`) is the point:
    count and consequent really are independent axes, which the doc above has
    claimed since D128 and which two printings on one op now demonstrate rather
    than assert. A member per (count × consequent) pair would now be eight.

    ONE READER OWNS THE SENTENCE. The `ops` live on the coin member rather than
    being produced by `deriveAttackEffect` off the same string, so there is no
    invariant to hold between two derivers reading one printing ("whenever THIS
    coin member appears, THAT deriver must have produced exactly these ops") — the
    kind of invariant nothing can enforce and every future arm can break. The
    string is read once, by `deriveAttackCoinFlip`, and hands back both halves of
    what the sentence says. */
export type AttackCoinFlip =
  | { kind: "bonusOnHeads"; flips: AttackFlipCount; per: number }
  | { kind: "cancelOnTails" }
  | { kind: "perHeads"; flips: AttackFlipCount; per: number }
  | { kind: "programPerHeads"; flips: AttackFlipCount; ops: EffectOp[] };

/** The coin flip an attack's printed text calls for, or null when the text is not
    one of the six recognised whole sentences — null keeps the attack on the loud
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
    return per >= 1 ? { kind: "bonusOnHeads", flips: { kind: "printed", count: 1 }, per } : null;
  }
  const multi = ATTACK_COIN_MULTI.exec(effect);
  if (multi !== null) {
    const flips = Number(multi[1]);
    const per = Number(multi[2]);
    // `flips >= 2` because the regex's own "coins" is PLURAL: the one-flip form is
    // printed "Flip a coin." and is read by the two patterns above, so "Flip 1
    // coins." is not English and not in the pool. Refusing it (rather than quietly
    // treating it as one flip) keeps the grammar of the sentence and the shape of
    // the value in agreement. `per >= 1` is the same guard every scaling arm
    // carries; `flips <= MAX_PRINTED_FLIPS` is the ingested-text ceiling.
    return flips >= 2 && flips <= MAX_PRINTED_FLIPS && per >= 1
      ? { kind: "perHeads", flips: { kind: "printed", count: flips }, per }
      : null;
  }
  const perEnergy = ATTACK_COIN_PER_ENERGY.exec(effect);
  if (perEnergy !== null) {
    const token = perEnergy[1];
    const per = Number(perEnergy[2]);
    // `token === undefined` is the UNFILTERED sentence ("for each Energy attached"),
    // which is a real reading and resolves to `energy: null`. An unresolvable token
    // resolves to null TOO — so the two are told apart by the token, not by the
    // lookup, and a `{C}`/`{N}`/garbage filter falls through to the loud skipped
    // path instead of quietly counting every attached card. (Colorless is absent
    // from `ENERGY_TYPE_BY_CODE` on purpose: it is the conservative provision
    // fallback for every unauthored Special Energy, so a `{C}` filter would match
    // cards nobody meant — see that map.) `per >= 1` is the same guard every arm
    // of this family carries; there is no flip ceiling here, because the count is
    // read off the board and the board is bounded by the deck.
    if (token !== undefined) {
      // Through D137's helper like every other exact lookup on printed text, even
      // though a brace code and a spelled-out energy name can never hold an
      // apostrophe: the rule is the SITE, not the need.
      const energy = literalClauseRow(CLAUSE_ENERGY_TOKENS, token);
      return energy !== undefined && per >= 1
        ? { kind: "perHeads", flips: { kind: "attachedEnergy", energy }, per }
        : null;
    }
    return per >= 1
      ? { kind: "perHeads", flips: { kind: "attachedEnergy", energy: null }, per }
      : null;
  }
  // D129 — the two unbounded arms. `untilTails` carries no payload to validate
  // (there is no count and no filter), so `per >= 1` — the guard every arm of this
  // family carries — is the whole check, and there is NO ceiling: the bound that
  // makes this terminate belongs to the RNG that produces the faces, not to the
  // sentence that asks for them (`MAX_UNTIL_TAILS_FLIPS`, rng.ts). Reaching for
  // `MAX_PRINTED_FLIPS` here would answer a question nobody asked — the digits in
  // these sentences are the DAMAGE, and they are already bounded like every other
  // `per`.
  const untilBonus = ATTACK_COIN_UNTIL_TAILS_BONUS.exec(effect);
  if (untilBonus !== null) {
    const per = Number(untilBonus[1]);
    return per >= 1 ? { kind: "bonusOnHeads", flips: { kind: "untilTails" }, per } : null;
  }
  const untilMulti = ATTACK_COIN_UNTIL_TAILS_MULTI.exec(effect);
  if (untilMulti !== null) {
    const per = Number(untilMulti[1]);
    return per >= 1 ? { kind: "perHeads", flips: { kind: "untilTails" }, per } : null;
  }
  // D130 — the two PROGRAM arms. They produce the same `ops` off two different
  // flip counts, which is the slice: `AttackFlipCount` is reused wholesale and the
  // consequent does not know which member fed it.
  const millPrinted = ATTACK_COIN_MILL_PRINTED.exec(effect);
  if (millPrinted !== null) {
    const flips = Number(millPrinted[1]);
    const count = Number(millPrinted[2]);
    // The SAME two guards the `perHeads` printed arm carries, for the same two
    // reasons: `flips >= 2` because the regex's own "coins" is PLURAL (the one-flip
    // form is printed "Flip a coin." and is read above, so "Flip 1 coins." is not
    // English and not in the pool), and `flips <= MAX_PRINTED_FLIPS` because the
    // digits come from THIRD-PARTY ingested text — an unbounded `\d+` would let one
    // malformed row spin the flip loop, and now the EXPANSION too, since the program
    // grows one copy per heads. `count >= 1` is this arm's own `per >= 1`: a "discard
    // the top 0 cards" printing would spend the flips to move nothing.
    return flips >= 2 && flips <= MAX_PRINTED_FLIPS && count >= 1
      ? {
          kind: "programPerHeads",
          flips: { kind: "printed", count: flips },
          ops: [{ op: "discardDeckTop", whose: "opponent", count }],
        }
      : null;
  }
  const millUntil = ATTACK_COIN_MILL_UNTIL_TAILS.exec(effect);
  if (millUntil !== null) {
    const count = Number(millUntil[1]);
    // No ceiling here, D129's rule verbatim: the bound that makes an unbounded
    // sequence terminate belongs to the RNG that produces the faces
    // (`MAX_UNTIL_TAILS_FLIPS`, rng.ts), not to the sentence that asks for them. The
    // mill count is the only payload there is to validate.
    return count >= 1
      ? {
          kind: "programPerHeads",
          flips: { kind: "untilTails" },
          ops: [{ op: "discardDeckTop", whose: "opponent", count }],
        }
      : null;
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
    return [
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "preventRetreat" },
    ];
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
          // Attack damage, so this never reaches the COUNTERS_PLACED path — but
          // the field is REQUIRED and the value is true regardless (D140).
          source: "attack",
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
      return [
        { op: "damageChosen", target: "opponentBench", amount, count: 1, source: "attack", deals: true },
      ];
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
        ? [
            {
              op: "damageChosen",
              target: "opponentAny",
              amount,
              count: 1,
              source: "attack",
              deals: true,
            },
          ]
        : [
            {
              op: "damageChosen",
              target: "opponentAny",
              amount,
              count: 1,
              source: "attack",
              deals: true,
              ignoreWR: true,
            },
          ];
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
    return [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ];
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
      match[2] === undefined ? ENERGY_TYPE_BY_NAME[match[3] ?? ""] : ENERGY_TYPE_BY_CODE[match[2]];
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

  // 15. "Discard the top [N cards|card] of your [opponent's] deck." — D131's
  //     UNCONDITIONAL MILL, the biggest single mapping this reader has taken (16
  //     printings). It needed NO new op and NO new mechanism: D130 built the
  //     action for the coin family and predicted this exact slice would widen it
  //     with `whose`, so all that was missing was a reader for the bare sentence.
  //     Runs at `attack.ts`'s TAIL like every op here, which is right for both
  //     directions — nine of these printings carry printed damage (Haxorus's 230,
  //     Tyranitar ex's 120) and the mill is what the attack does AFTER it.
  match = DECK_TOP_MILL.exec(effect);
  if (match !== null) {
    // The singular branch leaves group 1 undefined and means exactly one card.
    const count = match[1] === undefined ? 1 : Number(match[1]);
    const whose = match[2] === undefined ? "self" : "opponent";
    // `count >= 1` is the guard every arm here carries: a printed "top 0 cards" is
    // not a real card and would derive to a silent no-op. No ceiling — the count
    // is CLAMPED to the deck by the op (§8.6), so a malformed 999 mills a deck and
    // stops, which is a legal board state rather than a runaway loop.
    if (count >= 1) return [{ op: "discardDeckTop", whose, count }];
  }

  // 16. "Heal {N} damage from this Pokémon." — D132's BARE SELF-HEAL, 18
  //     printings across 4 clauses (N = 10, 20, 30, 50) and the cheapest slice
  //     this reader has taken: NO new op, NO new event, NO new mechanism. The
  //     `heal` op has existed since 0.x, produced by the compound
  //     `SELF_SLEEP_HEAL` arm above; all that was ever missing was a reader for
  //     the sentence printed on its own. Twelve of the eighteen printings carry
  //     printed damage (Ceruledge sv02-098's 50, Slowbro sv01-043's 60) and the
  //     tail placement (D125) resolves them in the printed order for free.
  match = SELF_HEAL.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries: a printed "Heal 0
    // damage" is not a real card and would derive to a silent no-op — an attack
    // reporting a simulated effect that moved nothing. Leave it loud. No CEILING
    // and no clamp, by contrast: the interpreter clamps the heal to the damage
    // actually present (`healSelf`, Math.min), so a malformed large amount heals
    // an Active to full and stops, which is a legal board state.
    if (amount >= 1) return [{ op: "heal", target: "self", amount }];
  }

  // 17. "Heal {N} damage from each of your Pokémon." — D133's OWN-BOARD HEAL, 7
  //     printings across 2 clauses (N = 20, 30), and D132's shape a second time:
  //     the op (`healEach`) has existed since 0.x, produced by Garganacl's
  //     between-turns "Blessed Salt" Ability, so this is a reader for the same
  //     action printed as an ATTACK and the interpreter does not change. Four of
  //     the seven printings carry printed damage (Skeledirge ex's 50) and the
  //     tail placement (D125) resolves them in the printed order for free.
  //     `healEach` heals the ACTIVE and the Bench — see the anchor's note.
  match = OWN_BOARD_HEAL.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries: a printed "Heal 0
    // damage" is not a real card and would derive to a whole board's worth of
    // silent no-ops. No CEILING, same as the bare self-heal: the interpreter
    // clamps PER POKÉMON to the damage actually present, so a malformed large
    // amount heals the board to full and stops — a legal state.
    if (amount >= 1) return [{ op: "healEach", amount }];
  }

  // 18/19. "Flip a coin. If heads, <action>." — D134's FLIP-GATED OP family, the
  //        gated twins of two sentences this reader already reads bare. Both
  //        consequents existed before the slice (`heal` since 0.x, `discardDeckTop`
  //        since D130) and so did the gate, so each is a regex and an arm with NO
  //        interpreter diff — the third slice running on D132's inventory rule.
  //
  //        THE GATE IS NOT A MODIFIER ON THE OP, it is an op that OWNS a program:
  //        `coinFlipGate` flips once, emits ATTACK_EFFECT_COIN_FLIP either way, and
  //        splices `then` into the work queue only on heads. That is why the derived
  //        `then` is byte-identical to the bare anchor's whole program — there is one
  //        action here, printed twice, and the flip is procedure in front of it.
  //        A tails flip is therefore NOT a skipped effect: the sentence was read, the
  //        coin decided, and the loud ATTACK_EFFECT_SKIPPED row would be a lie.
  match = FLIP_SELF_HEAL.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries, and it sits OUTSIDE the
    // gate on purpose: a printed "heal 0" would derive to an attack that flips a
    // coin and then does nothing on either face, which is worse than an unread
    // sentence because the flip makes it look like something happened.
    if (amount >= 1) {
      return [
        {
          op: "coinFlipGate",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "heal", target: "self", amount }],
        },
      ];
    }
  }
  if (FLIP_DECK_TOP_MILL.test(effect)) {
    // No capture at all — the one printing is the SINGULAR, and the `count: 1` is
    // invented at the site exactly as `DECK_TOP_MILL`'s singular branch invents it.
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
      },
    ];
  }
  // 19b. The GATED PREVENT clause (D142) — 13 printings across the family's two
  //      printed readings, and the largest single mapping left in D134's census.
  //      Two `test` arms and no capture: nothing in either sentence varies, the
  //      duration is the printed words "during your opponent's next turn" and the
  //      holder is the printed words "this Pokémon", so the only token that
  //      differs between the two anchors — "from and effects of" — lands in a
  //      FIELD (D131), not a second op and not a table row.
  //
  //      Both wrap `preventDamage` in the SAME `coinFlipGate` the two arms above
  //      use, so the gate is procedure in front of one action here as it is there,
  //      and a TAILS is a resolved attack rather than a skipped effect.
  if (FLIP_PREVENT_DAMAGE_AND_EFFECTS.test(effect)) {
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "preventDamage", effects: true }],
      },
    ];
  }
  if (FLIP_PREVENT_DAMAGE.test(effect)) {
    // The `effects` key is ABSENT, not `false`: the printed sentence does not say
    // "from and effects of", so the narrower reading is what the card prints and
    // the op carries no claim about the wider one (D135's absent-`zone` rule).
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "preventDamage" }],
      },
    ];
  }

  // 20. "Heal {N|all} damage from 1 of your [Benched] Pokémon." — D135's CHOSEN
  //     heal, 10 printings across 7 clauses and the heal family's third and last
  //     shape. The op (`healChosen`) has existed since 0.x behind Potion; what is
  //     new is ONE FIELD on it (`zone`) for the printed word "Benched", and one
  //     reader. The two captures land in two fields of one op (D131's shape), so
  //     the Bench and any-zone readings share every line downstream of the park.
  //
  //     THIS IS THE FIRST DERIVED ATTACK EFFECT THAT PARKS ON A HEAL, but not the
  //     first that parks: `damageChosen` (the snipes) and `discardEnergy` (the
  //     printed self-discard cost) have parked from an attack tail for many
  //     slices, through the same `settleProgram(..., { resumeTail: true })` that
  //     keeps `attackEpilogue` on `state.pending` until the choice lands. So the
  //     KO sweep, the prizes and §5.3's turn end all still happen AFTER the heal,
  //     in that order, with no attack.ts diff.
  match = CHOSEN_HEAL.exec(effect);
  if (match !== null) {
    const raw = match[1] as string;
    const amount = raw === "all" ? "all" : Number(raw);
    // `amount >= 1` is the guard every arm here carries: a printed "Heal 0
    // damage" would derive to a PROMPT that heals nothing — worse than an unread
    // sentence, because parking a player on a decision with no possible outcome
    // is a lie the loud path never tells. "all" is exempt by construction: it is
    // not a number and cannot be zero, and it whiffs only on an undamaged pick,
    // silently (the single-arm rule). No CEILING, same as the two heal arms
    // above — the interpreter clamps to the damage actually present.
    if (amount === "all" || amount >= 1) {
      // The zone field is OMITTED rather than set to undefined when the printing
      // does not carry the word: the derived op is compared by value against
      // hand-authored registry rows (Potion's `{ op: "healChosen", amount: 30 }`),
      // and an explicit `zone: undefined` key is not `toEqual`-identical to an
      // absent one under the suite's stricter comparisons.
      return [
        match[2] === undefined
          ? { op: "healChosen", amount }
          : { op: "healChosen", amount, zone: "bench" },
      ];
    }
  }

  // 21. "Move all damage counters from 1 of your Benched Pokémon to your
  //     opponent's Active Pokémon." — D138's COUNTER MOVE, 2 printings on one
  //     card (Dedenne ex sv02-093/-239 "Tail Swap"). NO CAPTURE AT ALL: every
  //     varying part of the neighbouring sentences is fixed here — the amount is
  //     the printed word "all", the source zone is the printed word "Benched",
  //     and the destination is spelled out — so the op takes no fields and this
  //     arm is a `test`, exactly as `FLIP_DECK_TOP_MILL`'s is.
  //
  //     THE FIRST DERIVED ATTACK OP THAT HEALS ONE BOARD AND DAMAGES THE OTHER,
  //     which is why it is a new member rather than a field on `healChosen`
  //     (D131's rule applied and failing — see the op's doc block). The CHOICE
  //     half genuinely was free: `ownBenchRefs` + `parkOrForce` is the candidate
  //     set D135 built for `zone: "bench"`, unchanged.
  if (COUNTER_MOVE_TO_DEFENDER.test(effect)) {
    // No `amount >= 1` guard, because there is no printed amount to guard: "all"
    // is not a number and cannot be zero. The degenerate case — a pick with no
    // counters on it — is a SILENT whiff at run time (the single-arm rule), not
    // a derivation failure, exactly as `CHOSEN_HEAL`'s "all" branch is.
    return [{ op: "moveCountersToDefender" }];
  }

  // 22. "Put {N} damage counters on your opponent's Active Pokémon." — D139's PUT
  //     on the defender, 2 printings across 2 clauses (Mimikyu sv02-097 "Ghost
  //     Eye" at 7, Polteageist sv03-098 "Pour Tea" at 5). D132's INVENTORY RULE
  //     for the fourth time: `damageActive` has shipped since 0.x behind
  //     Trevenant's between-turns "Forest Miasma", and what was missing was a
  //     READER for the same action printed as an ATTACK — so there is no new op,
  //     no new mechanism and no new park.
  //
  //     WHAT IT DID COST is the op's `source` field and one `COUNTERS_PLACED`
  //     enum member, because the ROW's provenance moved even though the ACTION
  //     did not: `COUNTERS_PLACED.seat` owns the DAMAGED Pokémon — here the
  //     attacker's opponent — and the "ability" arm prints the literal word
  //     Ability, which on an attack is D136's finding 1 written in at the source.
  //     D138 refused exactly that for the counter MOVE; this arm inherits the
  //     refusal rather than re-deriving it.
  match = COUNTER_PUT_ON_DEFENDER.exec(effect);
  if (match !== null) {
    // ⚠️ COUNTERS → HP (one counter = 10, §12). `damageActive.amount` is HP and
    // the printed number is COUNTERS, so this line is the entire factor-of-ten
    // risk in the slice — the same conversion the `DEFENDER_POISON_N` arm above
    // makes for `poisonDamage`, and the same one Trevenant's registry row makes
    // by hand when it writes `amount: 10` for its printed 1 counter.
    const counters = Number(match[1]);
    // `counters >= 1` is the guard every arm here carries: a printed "Put 0
    // damage counters" is not a real card and would derive to a silent no-op —
    // an attack reporting a simulated effect that moved nothing. Leave it loud.
    // No CEILING: the op only RAISES damage and the epilogue's sweep resolves
    // whatever it Knocks Out, so a malformed 999 counters KOs the defender and
    // stops, which is a legal board state rather than a runaway.
    if (counters >= 1) {
      return [{ op: "damageActive", amount: counters * 10, source: "attack" }];
    }
  }

  // 23. "Put {N} damage counters on 1 of your opponent's Benched Pokémon." —
  //     D140's PUT on the BENCH, 4 printings across 1 clause (Ting-Lu ex
  //     sv02-127/-243/-263/-275 "Land Scoop" at 2 counters). D132's INVENTORY RULE
  //     FOR THE FIFTH TIME: `damageChosen { target: "opponentBench", count: 1 }`
  //     has been authored since M4 slice 8 by Meowscarada ex sv02-015's "Bouquet
  //     Magic" registry row at a different amount, so this arm buys a READER and
  //     nothing else — no new op, no new prompt, no new park, and no
  //     `attack.ts`/`flow.ts`/`continuous.ts`/`rng.ts` diff.
  //
  //     ⚠️ IT MUST NOT SET `deals`. These are PLACED COUNTERS, not attack damage —
  //     `damageActive`'s rule verbatim (no Weakness/Resistance, no
  //     `damageReductionAfterWR`), and §8.5 makes Weakness moot on the Bench
  //     anyway, so the flag would change the EVENT (DAMAGE_DEALT instead of
  //     COUNTERS_PLACED) and re-admit the reduction passive. That absence is
  //     exactly what routes this op onto `placeSnipe`'s counter path, which is
  //     why this is the arm that had to resolve D139's latent label.
  //
  //     THE PRINTED 150 RIDES THE ATTACK'S OWN `damage` FIELD, so this is the
  //     family's first sentence whose declaration produces BOTH a §8.5 hit and a
  //     placement: D125's tail order is damage → program → epilogue sweep, which
  //     the suite drives end to end rather than assuming.
  match = COUNTER_PUT_ON_OPPONENT_BENCH.exec(effect);
  if (match !== null) {
    // ⚠️ COUNTERS → HP (one counter = 10, §12), at the PRODUCER — the same place
    // arm 22 above, Trevenant's registry row and `DEFENDER_POISON_N` all do it,
    // and the same place Meowscarada's row does it by hand (3 counters → 30). The
    // interpreter never sees the printed unit and cannot convert twice.
    const counters = Number(match[1]);
    // `counters >= 1` is the guard every arm here carries: a printed "Put 0 damage
    // counters" would PARK the attacker on a choice with no possible outcome,
    // which is worse than an unread sentence. Leave it loud.
    if (counters >= 1) {
      return [
        {
          op: "damageChosen",
          target: "opponentBench",
          amount: counters * 10,
          // EXACT, not a ceiling: the printed "1 of" carries no "up to" (the op's
          // own doc block), so the park asks for one on the nose and §8.6 is the
          // only thing that softens it — an empty Bench places nothing.
          count: 1,
          // D140 — the provenance the COUNTERS_PLACED row may honestly print. It
          // is the whole reason this arm is not a one-liner: `placeSnipe`
          // hardcoded "ability", which was true of its three Ability producers and
          // is false of this one.
          source: "attack",
        },
      ];
    }
  }

  // 24. "During your next turn, this Pokémon can't attack." — D143's SELF-LOCK,
  //     TWENTY printings on ONE sentence and the largest single count this family
  //     has mapped in one arm. A `test`, not an `exec`: nothing in the sentence
  //     varies, the duration is the printed words "during your next turn" and the
  //     holder is the printed words "this Pokémon", so there is nothing to capture
  //     and the op takes no fields (D138's shape).
  //
  //     THE MIRROR OF ARM 5b, and it lands one op away from it: that one reads
  //     "During your OPPONENT's next turn, the DEFENDING Pokémon can't RETREAT"
  //     and this one flips both the holder and the window. What it does NOT flip
  //     is the mechanism — D142 built the durated stamp, and this rider is one
  //     more stamped field on the same body read at a different gate.
  if (SELF_CANT_ATTACK_NEXT_TURN.test(effect)) {
    return [{ op: "preventAttack" }];
  }

  // 25. "Put {N} damage counters on 1 of your opponent's Pokémon. During your next
  //     turn, this Pokémon can't attack." — Ninetales sv03-029/-199 "Nine-Tailed
  //     Dance" ({R}{R}, INDEX 1, 9 counters, no printed `damage`), 2 printings.
  //     TWO SENTENCES, TWO OPS, IN PRINTED ORDER — `DEFENDER_POISON_CANT_RETREAT`
  //     (arm 5c) is the precedent and the reason this is one anchored pattern
  //     rather than two: the family's safety property is that an unrecognised
  //     remainder stays LOUD, and a prefix match would ship the counters without
  //     the drawback.
  //
  //     The ORDER is load-bearing twice over. It is the printed order, and it is
  //     also the only order that reads right in a log — sentence one can Knock the
  //     target Out, and a lock row wedged in front of a KO would describe the
  //     attacker's future while the defender's present was still unresolved. It
  //     also means the counters PARK (the pick is a real decision whenever the
  //     opponent has a Bench) and the lock installs on the RESUMED tail, which is
  //     the first time this family has put an op BEHIND a park.
  match = COUNTER_PUT_ANY_THEN_SELF_LOCK.exec(effect);
  if (match !== null) {
    // ⚠️ COUNTERS → HP (one counter = 10, §12), at the PRODUCER — arms 22 and 23
    // above, Trevenant's registry row and `DEFENDER_POISON_N` all convert here,
    // and the interpreter never sees the printed unit.
    const counters = Number(match[1]);
    // `counters >= 1`, the guard every arm carries: a printed 0 would park the
    // attacker on a choice with no possible outcome AND install a drawback for
    // nothing. Leave it loud.
    if (counters >= 1) {
      return [
        {
          op: "damageChosen",
          // "1 of your opponent's POKÉMON" — the Active OR a Bench, so the
          // candidate set is `oppAnyRefs` and never empty during an attack. This
          // is the first producer of `opponentAny` WITHOUT `deals`, i.e. a chosen
          // PLACEMENT rather than a chosen hit: the counters stay FLAT even on the
          // Active, because a placed counter is not attack damage (D138/D139) and
          // being printed on an attack does not make it one.
          target: "opponentAny",
          amount: counters * 10,
          // EXACT, not a ceiling: no "up to" is printed.
          count: 1,
          // D140's field — the provenance the COUNTERS_PLACED row prints.
          source: "attack",
        },
        { op: "preventAttack" },
      ];
    }
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
