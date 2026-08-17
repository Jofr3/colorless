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
// D297 — the ONE value import this file takes from `types.ts`, and it is the
// §4 Bench ceiling used as a printed-number guard (see
// `ATTACK_REVEAL_AND_BENCH_UP_TO`). No runtime cycle: `types.ts`'s only
// non-type import is `@luminous/schema`.
import { BENCH_MAX, type PokemonTarget } from "./types";

/** A declarative card predicate for deck searches (§15.E). Deliberately tiny
    — the representative cards need only "a Basic Pokémon", "any Pokémon", "a
    Basic Energy [of a type]" and "a card named X"; the union grows one entry
    per new shape. */
export type CardFilter =
  /** A Basic Pokémon. `noRuleBox` narrows it to one WITHOUT a Rule Box —
      Artazon's "a Basic Pokémon that doesn't have a Rule Box" (cards.ts
      `hasRuleBox`), the same optional-refinement shape as `basicEnergy`'s
      `energyType`.

      🆕 **D265 — `maxHp` IS THE PRINTED HP THRESHOLD**, *"a Basic Pokémon **with
      70 HP or less**"*: Buddy-Buddy Poffin `sv05-144`/`sv06-223`/`sv08.5-101` (3
      legal, `searchDeck`) and Alomomola `sv10.5b-024`/`-108` "Gentle Fin" (2
      legal, `discardPileRetrieval`). 5 printings on 2 sentences across TWO ops —
      which is the whole point of putting it on the FILTER rather than on either
      op: the two ops share nothing but this vocabulary.

      🛑 **IT IS A CARD READ OF `Card.hp`, AND THE CLASSIFICATION IS WHAT DECIDES
      THE YIELD.** The legal pool prints the phrase *"HP or less"* on **15
      printings / 6 sentences** (remote D1 `luminous`, 2026-08-07, all three text
      columns, `legal_standard = 1`), and they split by KIND: **9 / 4 are this
      CARD read** (the two above plus Fan Rotom `sv07-118`/`sv08.5-085` and
      Mandibuzz `sv10.5w-064`/`-145`, both blocked on other machinery) and **6 / 2
      are a BOARD read** — Bianca's Devotion (3) and Ledian (3) print *"HP or less
      **remaining**"*, current HP against a body in play, which no `CardFilter`
      can express at any width because `matchesFilter` never sees an
      `InPlayPokemon`. D264 found the old work order counting Bianca's toward this
      rider's price; the corrected yield is 5, not 8. **Classify a predicate by
      KIND before you count what it buys.**

      ⚠️ **THE RIDER IS BOTH A PREDICATE RIDER AND A CAPTION RIDER**, unlike
      D264's `cardNoun` (caption only) and unlike `noRuleBox` on `anyPokemon`
      (both, but on a boolean). It narrows the candidate set in `cards.ts
      matchesFilter` AND changes the printed noun in `interpreter.ts
      retrieveNoun`, so a board assertion and a note assertion kill different
      mutants and both are owed.

      ⚠️ **A NULL `hp` IS REFUSED RATHER THAN ADMITTED, AND THE ARM SAYS SO.**
      `cards.ts hpOf` returns null for a non-Pokémon and for a non-positive
      printed value (a data gap), and `null <= 70` is `true` in JavaScript — so an
      unguarded comparison would offer every Trainer in the pile to a sentence
      that names a Pokémon. The conjunct rides `hpOf` and treats null as NOT
      satisfying the threshold: an unknown HP is not "70 HP or less".

      ⚠️ **IT DOES NOT GO ON `anyPokemon` "FOR SYMMETRY".** Both printings spell
      *"a **Basic** Pokémon with…"*, which is D264's own lesson pointed the other
      way — that slice needed the stage-free noun because Lana's Aid prints one,
      and no sentence in the legal pool prints a stage-free HP threshold. Fan
      Rotom's is *"{C} Pokémon with 100 HP or less"*, a `typedPokemon` noun; when
      that row is unblocked the rider is owed THERE and not here. */
  | { kind: "basicPokemon"; noRuleBox?: true; maxHp?: number }
  /** Any Pokémon card. `noRuleBox` narrows it to one WITHOUT a Rule Box — Lana's
      Aid's *"Pokémon that don't have a Rule Box"* (sv06-155/-207/-219, 3 legal).

      🛑 **D264 — THE RIDER ALREADY EXISTED ON THE NEIGHBOUR AND THAT IS EXACTLY
      WHY IT LOOKED BUILT.** `basicPokemon.noRuleBox` (Artazon) has spelled this
      axis since D159, so the vocabulary NAMED the property this sentence asks
      about — and could not EXPRESS it, because Artazon's noun is *"a Basic
      Pokémon"* and Lana's is *"Pokémon"*, unrestricted by stage. Authoring the
      Basic-only filter here would have silently refused every Stage 1 / Stage 2
      in the pile, which is the quiet-wrong-answer direction. **Read the ARMS, not
      the field name.**

      The predicate is `cards.ts hasRuleBox` NEGATED, the same call one member up,
      so the two nouns agree by construction on every card in the catalog. The
      printed parenthetical *"(Pokémon ex, Pokémon V, etc. have Rule Boxes.)"* is
      that helper's own definition and is not a second clause to build. */
  | { kind: "anyPokemon"; noRuleBox?: true }
  /** An Evolution Pokémon — one that evolves from another Pokémon (Jacq's
      "search your deck for up to 2 Evolution Pokémon"). The discriminant is
      cards.ts `evolveFromOf(card) !== null`: a non-null `evolveFrom` marks a
      Stage 1 / Stage 2 (or VMAX/VSTAR) card, and the helper already returns null
      for non-Pokémon, so this is the exact complement of `basicPokemon` inside
      `anyPokemon`. */
  | { kind: "evolutionPokemon" }
  /** A Pokémon of a printed TYPE — the brace-coded *"{W} Pokémon"*, *"up to 3 {D}
      Pokémon"*, *"a Basic {G} Pokémon"* (D238).

      **THE PREDICATE IS `Card.types`, AND IT IS A MEMBERSHIP TEST RATHER THAN AN
      EQUALITY.** The ingested column is an ARRAY (`types: z.array(z.string())`)
      and dual-type Pokémon are printed — so *"{R} Pokémon"* must admit a card
      whose `types` are `["Fire","Grass"]`. An `=== type` read would silently drop
      them, which is the quiet-wrong-answer shape rather than a loud one.

      🛑 **IT IS NOT `targetType`, AND THE TWO ARE A DIFFERENT AXIS RATHER THAN A
      WIDER VERSION OF ONE.** `targetType` is a BOARD rider on the ops that choose
      an in-play body (*"1 of your Benched {L} Pokémon"*); this is the CARD
      vocabulary, answered against a deck / hand / discard pile, and the two
      populations are disjoint by construction (`matchesFilter` never sees an
      `InPlayPokemon`). The census says so too: of the 32 Standard-legal ATTACK
      printings carrying a brace-coded Pokémon noun, only **6** are this — the rest
      are board targets, damage scalers and conditional-damage clauses that three
      other readers already own. *Separate the two before pricing either.*

      **`stage` RIDES HERE RATHER THAN COMPOSING, WHICH IS `ownerPokemon`'s
      ARGUMENT RE-READ AND NOT A NEW ONE.** The printed noun is *"a Basic {G}
      Pokémon"* — the stage word sits INSIDE the phrase, before the type — so
      `retrieveNoun` owes ONE phrase ("a Basic Grass Pokémon") that is not the
      concatenation of "a Basic Pokémon" and "a Grass Pokémon", and both read
      sites must branch on the type regardless. Absent = the unmarked printing,
      any stage. There is no `"evolution"` value here, unlike `ownerPokemon`'s:
      **no printing spells one** (measured over all 3,786 catalog rows), and this
      union is authored off the bytes rather than off the symmetry.

      ⚠️ **`pokemonType` IS A `PokemonType`, NOT A BARE STRING** — `Dragon` and
      `Colorless` are real printed types with no Basic Energy behind them, so this
      vocabulary is `POKEMON_TYPES` and NOT `BasicEnergyType`. The deriver
      resolves the printed code through `POKEMON_TYPE_BY_CODE` (D234's map, built
      here for the attach family's destination and re-used whole), so an unmapped
      code is a REFUSAL rather than a mistyped filter.

      ⚠️ **D245 — `stage` NOW ADMITS `"evolution"`, AND THE CLAIM ABOVE THAT IT
      NEVER COULD WAS A CENSUS THAT ROTTED.** D238 wrote *"There is no `evolution`
      value here, unlike `ownerPokemon`'s: **no printing spells one** (measured
      over all 3,786 catalog rows)"*. Re-measured at HEAD (2026-08-06, remote D1
      `luminous`, `json_each` over all three text columns, `legal_standard = 1`,
      `LIKE '%evolution {%'`), the printed idiom returns **2 sentences / 4 legal
      printings**: Victini `sv08-021` *"Attacks used by your **Evolution {R}**
      Pokémon do 10 more damage…"* (1) and Genesect ex `sv10.5b-067`/`-161`/`-169`
      *"…search your deck for up to 2 **Evolution {M}** Pokémon, reveal them, and
      put them into your hand."* (3). 🆕 **A "NO PRINTING SPELLS THIS" IS A COUNT
      WITH A ZERO IN IT, AND IT ROTS EXACTLY LIKE THE OTHER COUNTS ON THIS PAGE.**
      The two riders now agree by construction, which is the second half of what
      the backlog row asked: they DISAGREED, and `typedPokemon` was the wrong one.

      ⚠️ **THE DERIVER IS DELIBERATELY NOT WIDENED.** `TYPED_NOUN` still spells
      `(?:a )?(Basic )?\{X\} (Pokémon|Energy cards?)` and no anchor reads an
      "Evolution" stage word, because BOTH of the printings above are ABILITIES
      and this repo has no ability deriver. Widening the pattern would be an arm
      no sentence drives, which is the rule that keeps the anchors honest.

      🆕 **D275 — `maxHp` IS D265's RIDER, ARRIVING WHERE ITS OWN DOC BLOCK SAID
      IT WAS OWED.** That block ends *"Fan Rotom's is «{C} Pokémon with 100 HP or
      less», a `typedPokemon` noun; when that row is unblocked the rider is owed
      THERE and not here"* — and this is that row: Fan Rotom `sv07-118` /
      `sv08.5-085` "Fan Call" (2 legal printings, 1 sentence). Same semantics
      BYTE FOR BYTE as `basicPokemon.maxHp`: a CARD read of the printed
      `Card.hp`, a null HP REFUSED rather than admitted (`null <= 100` is `true`
      in JavaScript), a predicate rider in `cards.ts matchesFilter` AND a caption
      rider in `interpreter.ts retrieveNoun`.

      ⚠️ **IT IS A WIDENING OF THIS MEMBER, NOT A NEW MEMBER, AND NOT A FIELD ON
      `searchDeck`.** D265 put the threshold on the FILTER precisely so the next
      noun to print it would cost one optional property; the two ops that read it
      (`searchDeck` here, `discardPileRetrieval` for Alomomola) still share
      nothing but the vocabulary. The rider now spans TWO members and THREE
      sentences / 7 legal printings, which is the yield a per-row price could not
      see. */
  | {
      kind: "typedPokemon";
      pokemonType: PokemonType;
      stage?: "basic" | "evolution";
      maxHp?: number;
    }
  /** D245 — a DISJUNCTION of filters: the printed *"your **{G} Pokémon and {R}
      Pokémon**"* (Lilligant `sv09-007` "Sunny Day"). The union's first
      COMBINATOR, and the first member whose payload is `CardFilter` itself.

      🛑 **THE PRINTED CONJUNCTION IS "and" AND THE PREDICATE IS AN "or", WHICH IS
      NOT A TRANSLATION ERROR.** *"Attacks used by your {G} Pokémon and {R}
      Pokémon"* names a SET — the union of two subgroups — and each individual
      attacker is asked one yes/no question, so a card that is only `{G}` is in it.
      Reading the "and" as an intersection would make the sentence name only
      dual-type Grass/Fire bodies, of which the whole Standard pool has none, i.e.
      the aura would pay nobody. **That is the mutant this member ships with**
      (`anyOf` → `every`): it is green on a board with no dual-type body and red
      the moment a `{G}`-only attacker is asked, which is exactly the board the
      test constructs.

      ⚠️ **A FLAT LIST, NOT A BINARY PAIR, AND NOT AN `allOf`'s SIBLING.** The
      printed sentences that need this are all N-ary unions of the SAME axis
      (`pokemonOrBasicEnergy` is the hand-rolled precedent, one axis over), and
      there is no printed sentence in the legal pool demanding an INTERSECTION —
      `basicPokemon.noRuleBox`, `basicEnergy.energyType` and both `stage` riders
      are the conjunctions this vocabulary needs, and each is spelled where it is
      printed. So `allOf` is not built: it would be a combinator no card drives.

      ⚠️ **IT IS RECURSIVE, SO EVERY EXHAUSTIVE READER OWES ONE ARM AND ONE OF
      THEM MUST RECURSE.** `matchesFilter` recurses (`.some`); `retrieveNoun`
      joins its members' phrases with " or ". Nothing in this union nests today
      beyond one level, and nothing forbids it. */
  | { kind: "anyOf"; filters: readonly CardFilter[] }
  /** A Pokémon in a printed OWNER-PREFIXED SUBGROUP — the SV-era mechanic whose
      whole vocabulary is a name prefix: *"a Cynthia's Pokémon"*, *"up to 2 Basic
      Hop's Pokémon"*, *"an Evolution Team Rocket's Pokémon"*. `sv01`–`sv08` print
      none of it; `sv09`/`sv10` print it across abilities, attacks, Items,
      Supporters, Tools, Stadiums and one Special Energy.

      **THE PREDICATE READS THE CARD NAME, AND THERE IS NO OTHER FIELD TO READ.**
      The catalog carries no owner/subgroup column — the ingested row has `name`,
      `category`, `stage`, `evolveFrom` and nothing else that could mark
      membership — so the datum is the printed prefix, exactly as `hasRuleBox`
      reads `"Radiant "` and `pokemonSuffixOf` reads `" ex"` off the same field.
      Measured against the live D1 (3,786 rows / 20 sets, 2026-08-04): every
      Pokémon named in one of these sentences has a name beginning `<owner>'s `,
      the match is EXACT-CASE and the trailing space is load-bearing, and the only
      two apostrophe-bearing names in the whole catalog that are NOT a possessive
      prefix — `Farfetch'd` and `Billy & O'Nare` — carry `'d` / `'N`, so neither
      can collide with any `'s ` prefix.

      **`category` IS PART OF THE PREDICATE, NOT A REDUNDANT GUARD, AND ONE REAL
      CARD PROVES IT.** `Team Rocket's Energy` (sv10-182) is a Special Energy
      whose name begins `Team Rocket's `, and the sentence printed ON IT is *"This
      card can only be attached to a Team Rocket's Pokémon."* — so a name-only
      predicate would make that Energy a legal target for itself. The prefix names
      a FAMILY; the class word after it ("Pokémon") is the other half of the noun
      phrase, and every one of the 46 distinct legal sentences spells one. Across
      the eleven owners that have Pokémon at all, 32 of the 214 prefixed printings
      are a Trainer or that Energy, so this is a wide near-miss, not a corner.

      **`stage` IS THE SECOND PRINTED AXIS AND IT RIDES HERE RATHER THAN
      COMPOSING**, because there is no conjunction in this union to compose with:
      `pokemonOrBasicEnergy` is a bespoke DISJUNCTION member, `basicPokemon`'s
      `noRuleBox` and `basicEnergy`'s `energyType` are bespoke RIDERS, and nothing
      is an `allOf`. Absent = the unmarked printing, "a Cynthia's Pokémon", any
      stage. `"basic"` is the printed word (Hop's Bag "up to 2 Basic Hop's
      Pokémon"), `"evolution"` its complement (Team Rocket's Great Ball "an
      Evolution Team Rocket's Pokémon") — the same two predicates the sibling
      members `basicPokemon` / `evolutionPokemon` carry, deliberately re-read here
      rather than referenced, because THE READ SITES WOULD NOT SHARE ANYTHING IF
      THEY WERE SPLIT. Both of them (`matchesFilter` and interpreter.ts
      `retrieveNoun`) must branch on `owner` regardless, and `retrieveNoun` owes
      ONE noun phrase — "a Basic Hop's Pokémon" — which is not the concatenation
      of "a Basic Pokémon" and "a Hop's Pokémon". Three members would cost those
      two switches six arms with the owner logic copied three times, where the
      rider costs two; the standing "when they cost the read site the same, the
      members win" test is therefore NOT met, and the rider wins on its own terms.

      **`owner` IS A PARAMETER AND NOT A MEMBER PER OWNER** for the mirror reason:
      the owner set is OPEN (0 owners through `sv08`, 11 with Pokémon by `sv10`,
      one more every set) and every read site's code is byte-identical across
      them, so members would be N copies of one line that grows with the catalog.
      It is a bare `string` — and unlike `basicEnergy.energyType`'s bare string
      (which `providesEnergy` above calls a hole) that is SAFE here rather than
      merely untidy: a misspelled owner matches the empty set, which is a loud
      no-op (`searchDeck` whiffs and shuffles), never a wrong card. No string can
      match a Pokémon it does not name.

      **IT IS A CARD PREDICATE, SO IT REACHES ZONES AND NOT THE BOARD.** Every
      consumer of `CardFilter` scans a deck / hand / discard pile, or an Energy
      attached to a named host (`matchesAttached`). The IN-PLAY target sentences —
      "1 of your Benched Iono's Pokémon" (5 printings), "1 of your Benched N's
      Pokémon", "your Active Team Rocket's Pokémon" — are selected by the
      op-specific `targetType` / `benchOnly` / `zone` riders, which take a type
      name and a boolean and no filter at all. This member cannot reach them, and
      widening those ops is a separate piece (D199 flagged it first). */
  | { kind: "ownerPokemon"; owner: string; stage?: "basic" | "evolution" }
  /** §7.5/§10 (D285) — a Pokémon that HAS an Ability ("your opponent can't play
      any Pokémon **that has an Ability** from their hand" — Team Rocket's Arbok
      `sv10-113` "Potent Glare", 1 legal printing).

      ⚠️ **ZERO NEW PREDICATE**: the conjunct is `cards.ts hasPrintedAbility`,
      D251's function, which already answers this exact noun for the 5-printing
      attacker-property prevent — so the PRINTED-CARD reading (a §9 lock silences
      an Ability without removing it) is inherited rather than re-decided here,
      and the two sites can never disagree about a card whose Ability is off.

      ⚠️ **NO `noRuleBox`/`stage` RIDER AND NO OWNER RIDER.** The sole printing
      pairs this noun with an EXCEPTION (*"except for Team Rocket's Pokémon"*),
      which is a set SUBTRACTED from this one rather than a conjunct added to it —
      `preventOpponentPokemonPlay.except` (registry.ts) carries it as a filter of
      its own, so this member stays the bare noun it is printed as. */
  | { kind: "abilityPokemon" }
  /** A Pokémon Tool card (Town Store's "a Pokémon Tool card" — read off the
      catalog's `trainerType: "Tool"`, the same discriminant attachTool uses). */
  | { kind: "toolCard" }
  /** A basic Energy card; `energyType` narrows it to one type (Chien-Pao's
      "Basic {W} Energy"), else any basic energy.

      ⚠️ **`BasicEnergyType` SINCE D238, AND NOT MERELY TIDINESS.** It was a bare
      `string` — a hole `providesEnergy`'s own doc names one member down — and it
      stopped being safe on the commit a DERIVER started authoring it: D238 reads
      the printed *"Basic {G} Energy card"* and resolves the code through
      `ENERGY_TYPE_BY_CODE`, so the value now comes from a map rather than from a
      human who was looking at the card. A bare string would have let a mistyped
      map row compile into a filter that matches nothing, which is the silent
      direction. Nine BASIC_ENERGY_TYPES; `Dragon` and `Colorless` are
      UNREPRESENTABLE here rather than merely wrong (§6.1 — neither has a Basic
      Energy card to find), the same call `providesEnergy.energyType` already
      made. Cost: zero — every registry row and every test already spelled a real
      type, so the narrowing compiled clean at HEAD. */
  | { kind: "basicEnergy"; energyType?: BasicEnergyType }
  /** A card matched by exact NAME (Flamigo's "Insta-Flock" searches its own
      copies — "search your deck for up to 3 Flamigo").

      ⚠️ **D264 — `cardNoun` IS A CAPTION RIDER AND NOT A PREDICATE RIDER.** It
      changes nothing about which cards match; it changes only `retrieveNoun`'s
      phrase, because the printed noun differs by what KIND of card the name
      names. A Pokémon name is invariant and prints bare — *"up to 3 Flamigo"* —
      while a Trainer or Energy name prints the word "cards" after it: *"up to 2
      **Arven's Sandwich cards** from your discard pile"* (Arven's Greedent
      sv10-159/-205, 2 legal). Absent = the bare Pokémon printing.

      🛑 **IT IS NOT DERIVED FROM THE MATCHED CARD'S `category`, AND THAT IS
      DELIBERATE.** `retrieveNoun` is handed a FILTER and no board — the phrase
      has to exist before anything matches (a whiffed retrieval still captions its
      empty prompt), and a named card that is absent from the catalog would leave
      the caption with nothing to read. The datum is therefore the PRINT, spelled
      by the author who is looking at the print, exactly as `item`'s "an" article
      is spelled per kind rather than computed. */
  | { kind: "byName"; name: string; cardNoun?: true }
  /** A Supporter Trainer card (Pal Pad shuffles Supporters from the discard
      pile back into the deck). */
  | { kind: "supporter" }
  /** An ITEM Trainer card — the catalog's `trainerType: "Item"`, read exactly as
      `supporter` and `toolCard` read theirs one field over (D231).

      ⚠️ **IT IS DISJOINT FROM `toolCard`, AND THAT IS THE CATALOG'S OWN
      CLASSIFICATION RATHER THAN THIS SLICE'S SIMPLIFICATION.** In the XY era a
      Pokémon Tool really was a kind of Item; since SM they are separate printed
      subtypes ("Trainer — Item" / "Trainer — Pokémon Tool"), and the ingested
      column agrees: 116 rows carry `Item`, 60 carry `Tool`, and no row carries
      both. So "Search your deck for an Item card" must NOT offer a Tool, which is
      driven on a board where all four subtypes sit in one deck. */
  | { kind: "item" }
  /** A STADIUM Trainer card — the catalog's `trainerType: "Stadium"` (41 rows),
      the fourth and last of the printed Trainer subtypes (D231). Taken with
      `item` because the two complete a CLOSED enum the other two members already
      half-covered: with these, every noun phrase the catalog spells for a Trainer
      subtype resolves, and a future one cannot silently fall into a neighbour. */
  | { kind: "stadium" }
  /** ANY Trainer card — the printed *"a Trainer card"*, i.e. the UNION of the
      four subtypes above (D237).

      🛑 **IT IS A MEMBER RATHER THAN "the absence of a subtype" BECAUSE THE
      PRINT DRAWS THE LINE THAT WAY.** `supporter` / `item` / `stadium` /
      `toolCard` each read `trainerType`; this one reads `category` alone and
      says nothing about the subtype, which is exactly the sentence Wailord
      `sv08-087` prints (*"Put a Trainer card from your discard pile into your
      hand."*). Expressing it as a disjunction of the four would be a claim that
      the enum is CLOSED — it is closed today at four, and a fifth printed
      subtype would silently narrow this filter on the day it is ingested, where
      the `category` read stays right by construction.

      ⚠️ **IT IS A STRICT SUPERSET OF ALL FOUR, AND THAT IS DRIVEN.** A board
      where the discard pile holds one of each subtype must offer FOUR cards to
      this filter and ONE to each of the others; the near-miss that makes the
      difference observable is `supporter`, whose printed sentence sits on the
      same anchor two rows over.

      **`retrieveNoun` OWES IT A PHRASE** (interpreter.ts) — "a Trainer card" /
      "Trainer cards" — and that phrase is also its row in `HAND_SEARCH_NOUNS`,
      because the shared table's contract is that its two strings ARE
      `retrieveNoun`'s output for the filter. */
  | { kind: "trainerCard" }
  /** ANY card at all — the printed uncategorised *"a card"* / *"cards"* (D231).

      🛑 **IT IS THE FILTER THE `reveal` RIDER NEEDS TO STAY HONEST.** D225
      measured that every printed search sentence carrying NO *"reveal it/them"*
      searches for uncategorised cards, and every revealing one names a category —
      so without this member a to-hand search deriver reads only sentences that
      reveal, its optional reveal group has no printed witness that omits the
      clause, and a build that hard-coded `reveal: true` would be
      indistinguishable from a correct one. The member is what makes the rider
      falsifiable, which is the reason it is worth a union member for a predicate
      that is literally `true`.

      **`card === undefined` IS STILL FALSE**, decided one level up in
      `matchesFilter`'s guard: this filter means "any real card", not "any uid".
      A dangling uid is a bug in the caller, not a candidate. */
  | { kind: "anyCard" }
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
    is that player's OWN prizes, and a Prize count is public, so it leaks nothing).

    🛑 **`perSeat` IS THE ONE MEMBER THAT IS NOT ONE ANSWER FOR EVERY AFFECTED
    SEAT — D270, and it is a WIDENING of this union rather than a fourth `who`.**
    The printed sentence is *"…**you** draw 5 cards, and **your opponent** draws 3
    cards."* (Harlequin `sv10.5w-083`/`-163`, and unbuilt-but-same-shape Unfair
    Stamp `sv06-165` 5/2 and Team Rocket's Archer `sv10-170`/`-223` 5/3). The
    SEATS it reaches are exactly `who: "both"`'s — every one of those cards opens
    *"Each player shuffles their hand into their deck"* — so nothing about the
    seat funnel, the zones or the events is new. What is new is that the COUNT is
    a function of WHICH seat, and that is a fact about the draw, not about the
    membership. Hence a member here and NOT a `who: "asymmetric"`: `who` answers
    *whose hand goes back*, `draw` answers *how many they then take*, and this
    sentence is asymmetric on the second question only.

    ⚠️ **CONTROLLER-RELATIVE, LIKE EVERY OTHER FIELD IN THIS VOCABULARY.** `you`
    is the seat that played the card and `opponent` is the other one — the same
    reading `who: "you" | "opponent"` and `disableAbilities.side` already use — so
    a program is never authored against `p1`/`p2` and the same object is correct
    for either seat playing it. On `who: "you"` or `who: "opponent"` only ONE of
    the two numbers is ever consulted; that is representable and no printed card
    uses it, the same authoring caution the op's own riders carry. */
export type HandRefreshDraw =
  | { kind: "fixed"; count: number }
  | { kind: "handPlus"; delta: number }
  | { kind: "prizeCount" }
  | { kind: "perSeat"; you: number; opponent: number };

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

/** §11 (D146, widened D239) — the printed ATTACKER CLASS a `preventDamage` block
    narrows itself to: the class named after *"…by attacks from"*. It is the
    stored form of a printed NOUN PHRASE, and it is a RECORD rather than a token
    because the phrase is a CONJUNCTION of two independently printed facts:

      "…by attacks from **Basic** Pokémon."            (1 legal — Dipplin sv07-013)
      "…by attacks from **Basic non-{C}** Pokémon."    (7 legal — Terapagos ex
                                                        `svp-165` + 6 reprints,
                                                        "Crown Opal", INDEX 1)

    🛑 **WHY A RECORD AND NOT A SECOND STRING MEMBER, and it is two independent
    arguments rather than one preference.**
      • **The VOCABULARY argument.** A flat `"Basic" | "BasicNonColorless"` is a
        CROSS PRODUCT of the two printed axes: a second stage word or a second
        excluded type multiplies the union instead of adding to it, and the
        11-code notation map one screen down means the type axis is eleven wide
        the moment a `non-{D}` printing lands. The record SUBSUMES the older
        member (`{ stage: "basic" }` IS D146's `"Basic"`) rather than sitting
        beside it, which is D131's widen-don't-add read on the field instead of
        on the op.
      • **The READ-SITE argument.** `attackerMatchesClass` (continuous.ts) has to
        answer TWO questions of the attacker — `isBasicPokemon` and a `types`
        read. Under a flat union each cross-product member re-spells BOTH
        conjuncts in its own `switch` arm, and the day a third member lands the
        two conjuncts are written three times and can disagree. That is exactly
        conventions.md's D222 shape (*"a `switch` over the union goes red when a
        member is added; a conjunction goes quiet"*) read one level down: the
        record keeps ONE spelling of each conjunct.

    `stage` is a one-member closed vocabulary and stays a `switch` at the read
    site for D146's original reason — widen it and tsc demands the predicate.
    `excludingType` is ABSENT rather than `null` when the sentence prints no
    exclusion (D135's absent-key rule), so D146's records read back unchanged in
    meaning. ⚠️ It is a `PokemonType` and NOT a `BasicEnergyType`: the printed
    code is `{C}`, and `Colorless` has no Basic Energy at all. */
/** §7 (D283/D284) — the classes of hand card a seat can be barred from playing,
    and the vocabulary of the ONE question `handPlayBarred` (continuous.ts) asks.
    A SUBSET of `Card.trainerType` and spelled in ITS words, so `cardplay.ts` and
    both HUD mirrors compare the card's own field against this key with no
    translation table in between — the `AttackerClass` lesson one block down,
    where the printed code `{C}` had to be a `PokemonType` and not a
    `BasicEnergyType`.

    🆕 ⚠️ **`"Tool"` IS A D284 MEMBER AND IT IS NOT A `StampedHandPlayClass`** —
    the two types below are the two SOURCES of a bar, and only one of them
    persists. Jellicent ex `sv10.5w-045`/`-160`/`-168` prints *"Item cards **or
    Pokémon Tool cards**"*, so the CONTINUOUS source reaches a third
    `Card.trainerType` value that no printed ATTACK names. Widening this union
    and leaving `GameState.handPlayLockedTurn` keyed by the narrow one is what
    keeps the persisted shape — and therefore `MATCH_RECORD_VERSION` — still.

    🆕 ⚠️ **`"Stadium"` IS A D287 MEMBER ON THE SAME TERMS, AND THE UNION IS NOW
    EXACTLY `Card.trainerType`.** Copperajah `sv06.5-042` "Massive Body" prints
    *"As long as this Pokémon is in the Active Spot, your opponent can't play any
    **Stadium** cards from their hand."* — `DAUNTING_GAZE`'s sentence with one
    noun changed. D284 refused it and its refusal note said why: the CLASS was
    already spellable, and the READ was missing (`playTrainer` dispatches to
    `playStadium` on the line ABOVE its gate). D287 built that read.
    ⚠️ **MEASURED, NOT INHERITED — the attack column still cannot name it.**
    Remote D1 `luminous` `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 2026-08-08,
    `legal_standard = 1`, one row of `SUM(instr(col,…)>0)`: `'any Stadium cards'`
    → ability **1** / attack **0** / effect **0**; and the same 1/0/0 for the
    MECHANISM rather than the sentence (`'play any Stadium'`, and
    `'Stadium'` AND `"can't play"` in the same column). Unfiltered by legality the
    catalog holds **exactly one row** (`sv06.5-042`, `legal_standard = 1`), so
    there is no reprint. `StampedHandPlayClass` below is therefore unchanged and
    this union's FOURTH member costs ZERO persisted bytes — D284's argument
    re-run against the catalog rather than re-cited from the decision row.
    🛑 **THE UNION BEING SATURATED IS NOT THE SAME AS THE FAMILY BEING DONE**:
    Genesect `sv06.5-040` bars ACE SPEC, a RARITY axis orthogonal to this one, so
    it stays refused and cannot ever become a fifth member here. */
export type HandPlayClass = "Item" | "Supporter" | "Tool" | "Stadium";

/** §7 (D283) — the strict subset of `HandPlayClass` that a printed ATTACK can
    STAMP for a turn (`EffectOp` `preventHandPlay`, `GameState.handPlayLockedTurn`).

    ⚠️ ONLY THE TWO CLASSES A PRINTED ATTACK ACTUALLY BARS, measured rather than
    assumed: a `"Stadium"` or `"Tool"` key on the persisted record would be one
    no writer could ever set, and a value no board can make true is a line that
    cannot go red, which conventions.md forbids. **THAT ARGUMENT IS ABOUT THE
    FIELD, NOT ABOUT THE QUESTION** — which is exactly why D284 could add `"Tool"`
    to `HandPlayClass` above without touching a single persisted byte, and why
    D287 could add `"Stadium"` on identical terms.

    🆕 ⚠️ **THE `"Stadium"` HALF OF THE SENTENCE ABOVE WAS A FORECAST AT D283 AND
    IS A MEASUREMENT AT D287.** D283 named `"Stadium"` as a key no writer could
    set at a time when no Stadium bar existed at all — true, and unfalsifiable on
    that tree. The attack-column census quoted on `HandPlayClass` is the same
    claim with a number behind it. **A GUESS AND A MEASUREMENT CAN AGREE, AND
    ONLY ONE OF THEM CAN BE CITED.** */
export type StampedHandPlayClass = Extract<HandPlayClass, "Item" | "Supporter">;

/** §7.5/§10 (D285) — the ACTS by which a POKÉMON card leaves a hand and reaches
    the board, and the vocabulary of the one question `pokemonPlayBarred`
    (continuous.ts) asks. **A SECOND UNION AND NOT A WIDENING OF
    `HandPlayClass`** — that one is a strict subset of `Card.trainerType` and is
    compared against the card's own field with no translation table in between,
    so an `"evolve"` member there would break the very invariant that makes it
    safe. Neither printed noun here is a `trainerType` value at all:

      • `"evolve"` — *"they can't play any Pokémon from their hand **to evolve**
        their Pokémon"* (Bronzong `sv05-069` "Evolution Jammer", turn.ts
        `evolve`);
      • `"bench"` — the §7.5 placement half, which only the CONTINUOUS source
        reaches (turn.ts `playBasicToBench`).

    🛑 **TWO MEMBERS AND NOT ONE, BECAUSE ONE PRINTED SENTENCE NAMES EXACTLY ONE
    OF THEM.** Bronzong's rider is *"to evolve their Pokémon"* — a Basic dropped
    on the Bench is untouched by it — while Arbok `sv10-113` bars the play
    itself and so reaches both acts. A single `"pokemon"` member would let
    Bronzong bar a bench placement its sentence does not mention, which is
    `HandPlayClass`'s own per-class argument (D283) one surface over.

    ⚠️ **RARE CANDY IS NOT AN ACT HERE AND THAT IS A RULES CALL** — its printed
    text *"**put** that card onto the Basic Pokémon to evolve it"* makes the
    Stage 2 a card the ITEM's effect puts, not one the player plays from hand.
    A bar on the PLAY therefore misses it; the bar that does reach Rare Candy is
    the `"Item"` one, on the card itself (cardplay.ts `rareCandy`). */
export type PokemonPlayAct = "evolve" | "bench";

/** §10 (D285) — the strict subset of `PokemonPlayAct` a printed ATTACK can STAMP
    for a turn, `StampedHandPlayClass`'s exact counterpart one surface over and
    for its exact reason: `"bench"` is reachable only from the CONTINUOUS source,
    so a `"bench"` key on the persisted record would be one no writer could ever
    set. Measured, not assumed — the whole Standard population of the Pokémon
    play bar is 2 printings and only Bronzong's is turn-scoped. */
export type StampedPokemonPlayAct = Extract<PokemonPlayAct, "evolve">;

/** §7.1/§7.2/§10 (D285) — the KEY SET of `GameState.handPlayLockedTurn`, i.e.
    everything a resolved attack can stamp for a turn, across BOTH surfaces.

    🛑 **THE FIELD IS WIDENED AND THE QUESTIONS ARE NOT.** The two surfaces ask
    different questions with different arities — `handPlayBarred(state, seat,
    HandPlayClass)` and `pokemonPlayBarred(state, seat, PokemonPlayAct, card)`,
    the second of which needs the CARD because Arbok's sentence narrows the noun
    — but the STAMP is one rule with one window, one writer, one `state.turn + 1`
    arithmetic and one §10 non-clear invariant. Two records would duplicate all
    of that so that a reader could tell apart two things no reader asks about.
    D284's split is the same discipline pointed the other way: a source that
    persists and one that does not are two vocabularies, and only the persisting
    one is a record key — here BOTH `"Item"`/`"Supporter"` and `"evolve"`
    persist, so they are one key set. `"Tool"` and `"bench"`, the two members
    reachable only from a passive, are excluded from it by construction. */
export type StampedPlayLockKey = StampedHandPlayClass | StampedPokemonPlayAct;

export interface AttackerClass {
  /** The printed STAGE word. One member, and `switch`ed rather than compared. */
  readonly stage: "basic";
  /** The printed *"non-{X}"* exclusion, resolved through `POKEMON_TYPE_BY_CODE`.
      ABSENT = the sentence excluded nothing. */
  readonly excludingType?: PokemonType;
}

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
  /** Your opponent's Active Pokémon is a BASIC Pokémon — Houndoom ex sv03-134
      "Evil Claw" ("If the Defending Pokémon is a Basic Pokémon, it can't attack
      during your opponent's next turn."), and the exact COMPLEMENT of the member
      one line up. `isBasicPokemon` (cards.ts) verbatim, which is the same reuse
      D146's `attackerMatchesClass` is under and the same claim §3.6/§5.2 make
      about a card in hand: one reading of "Basic", one implementation (D131).
      Read off the TOP card (§1.2, its current identity) — a Basic that has
      EVOLVED is a Stage 1 and no longer satisfies this, which is what the printed
      word means and is what makes the §10 evolve clear a real line of play rather
      than a rule written for symmetry.

      ⚠️ NAMED FOR WHAT IT READS, NOT FOR THE PRINTED PRONOUN (D116). The one
      printing says "the Defending Pokémon", which is §8 step 5's term of art for
      the opponent's Active — but "Defending" is meaningless on the play-gate path
      (`trainerPlayableIf` shares this union and no attack is being resolved), so
      the sentence's noun phrase is resolved by the ANCHOR that reads it and the
      member names the board fact.

      ⚠️ IT IS EVALUATED AT INSTALL TIME, WHICH IS THE OPPOSITE OF D146. That
      slice had to defer its identical `isBasicPokemon` predicate to the four
      damage READ SITES, because the class was a fact about an ATTACKER who had
      not declared anything yet. Here the class is a fact about the DEFENDER, who
      is on the board in front of the attack that is resolving — so the question is
      answerable now, the gate runs now, and nothing about the class is stored.
      Same predicate, opposite resolution site, and the thing that decides it is
      WHICH BODY the sentence asks about. False with no Active. */
  | { kind: "opponentActiveIsBasic" }
  /** 🆕 **D296 — your opponent's Active Pokémon is a **STAGE 2** Pokémon.** The
      restricting adjective in Paldean Tauros `sv08-039` "Upthrusting Horns":
      *"You may put 2 Energy attached to your opponent's Active **Stage 2**
      Pokémon into their hand."* — the ONE legal printing (measured: remote D1,
      `legal_standard = 1`, `attacks_json LIKE '%Active Stage 2 Pok%'` returns
      **1**).

      🛑 **A THIRD SIBLING AND NOT A WIDENING OF THE TWO ABOVE, AND D262 ALREADY
      WROTE THE ARGUMENT.** `opponentActiveIsEvolution` reads `evolveFromOf(...)
      !== null`, which a Stage 1 satisfies exactly as a Stage 2 does, so it
      cannot be narrowed into this by a rider; `opponentActiveIsBasic` is its
      complement and is further still. `isStage2Pokemon` (cards.ts, D262) is
      REUSED VERBATIM for `opponentActiveIsBasic`'s own reason: writing the
      `stage === "Stage2"` comparison a second time here would be a second
      reading of a printed word, free to disagree with Neo Upper Energy's.

      ⚠️ **IT READS THE PRINTED `stage` STRING, SO A VSTAR IS NOT A STAGE 2** —
      D262's clause verbatim, and it is the one mistake this adjective invites
      (a VSTAR sits two evolutions deep and would pass a chain count).

      Read off the TOP card (§1.2, its current identity) and FALSE with an empty
      Active Spot, exactly as the two members above — the attack gate guarantees
      a Defending Pokémon at the live read site, so the null arm covers a
      directly-invoked edge only. */
  | { kind: "opponentActiveIsStage2" }
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
      (+120, `[2, 4]`). The member is set MEMBERSHIP and NOT a threshold ENCODING
      — `[2, 4]` is deliberately not "2 to 4", and the case that catches the
      confusion is 3 Prizes reading FALSE between two true values.

      ⚠️ AMENDED BY D207. This block used to justify the membership reading with
      "the printed word is 'exactly'", and that is no longer true of the pool it
      serves. The catalog prints the clause BOTH ways: "exactly 2 Prize cards
      remaining" (Briar sv07-132/-163/-171, sv08.5-100 — unbuilt, see registry.ts)
      and "**3 or fewer** Prize cards remaining" (Lacey ×5 and Emcee's Hype ×2,
      both AUTHORED, as `counts: [0, 1, 2, 3]`). Enumerating the satisfying set is
      how this union spells an inequality, and that is behaviourally EXACT over a
      count bounded at 6 — but "exactly" is now a fact about two of the four
      sentences, not about the member. What stays true is the SHAPE claim: the
      fold is `counts.includes(…)`, so a caller must enumerate rather than compare,
      and `[2, 4]` remains unrepresentable as any threshold.

      The parameter is a LIST rather than a number because the pool prints the
      clause with one value, with two, with three (on an Ability, Slaking V
      swsh10.5-058/-077) and — since D207 — with four; one member covers every
      arity, and a single-valued list is the degenerate case rather than a second
      member.

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
      and the only sentence in 978 cards / 6 sets that contains the word "Dragon" at all.

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
  /** D279 — You have a Pokémon named `name` ANYWHERE IN PLAY, Active Spot
      INCLUDED — Karrablast `sv10.5b-009`/`-094` and Shelmet `sv10.5w-008`/`-093`
      "Stimulated Evolution" (*"If you have Shelmet in play, this Pokémon can
      evolve during your first turn or the turn you play it."*), **4 Standard-legal
      printings on TWO sentences**, the two names being each other's.

      🛑 **THIS IS NOT A WIDER READING OF `yourBenchHasNamed` ONE MEMBER UP, AND
      THE READ SITES ARE WHY.** D131 says widen before you add, so this was
      priced that way first and the answer is NO: that member's only consumer is
      Falinks `sv02-119` "Reckless Charge Together" (*"If **Falinks** is on your
      Bench, this attack does 90 more damage."*) — an attack whose OWN attacker is
      a Falinks in the Active Spot. Widening the member to include the Active Spot
      would make that clause satisfy itself off the attacker, turning a
      conditional +90 into an unconditional one on every board with no second
      Falinks. **The printed words are different ("Bench" vs "in play") and the
      one printing that reads the narrow word depends on it being narrow**, so
      these are two members. (⚠️ The Falinks printing is `sv02-119`; an inherited
      note said `sv06-160`, which is a different card entirely.)

      Named-card, not by class or suffix: `yourBenchHasNamed`'s reading verbatim —
      exact match against the catalog `name`, no normalisation, and read through
      the stack TOP (§1.2), so evolving your Shelmet into Accelgor stops
      satisfying a partner's clause, which is the right answer.

      ACTIVE + BENCH and nothing else: "in play" excludes hand, deck, discard and
      Prizes, and it is YOUR side only ("you have"). An empty board is false.
      Names are public the moment a Pokémon is in play, so the union's
      public-state invariant holds.

      ⚠️ **THE POOL SAYS THIS FAMILY GROWS AND THE NEXT MEMBER OF IT WILL WANT A
      CONJUNCTION.** Outside Standard the same sentence prints on Lunatone
      `sv03-092` (Solrock), Nidoking `sv03.5-034`/`-174` (Nidoqueen), Minun
      `sv04-061`/`-194` (Plusle) and — the shape to watch — Simisage/Simisear/
      Simipour `sv04-005`/`-021`/`-042`, *"If you have Simisage, Simisear, and
      Simipour in play"*, which is THREE names at once and which `BoardCondition`
      still cannot spell (it has no `allOf`). Single-name only, deliberately: the
      8 non-legal printings are not a licence to invent the conjunction. */
  | { kind: "yourNamedPokemonInPlay"; name: string }
  /** You have AT LEAST `count` Energy of `energy` in play — Absol sv06.5-030
      "Darkfall" (+50, `3` × `Darkness`), and in 978 cards / 6 sets that is the entire
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
      ingested 978 cards / 6 sets — one printing, one card, no reprint, and the pool's only
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
  | { kind: "yourActivePromotedThisTurn" }
  /** D242 — "you have **4 or more Team Rocket's Pokémon** in play" (Team Rocket's
      Mewtwo ex `svp-205`/`-216`/`sv10-081`/`-213`/`-231`/`-240` "Power Saver",
      six legal printings, the biggest reprint group in the ABILITY column that
      this vocabulary could not answer).

      ⚠️ **AN AT-LEAST COUNT OVER AN OWNER-PREFIXED SUBGROUP, AND EVERY PIECE OF
      IT IS BORROWED.** The subgroup predicate is D200's `CardFilter`
      `{ kind: "ownerPokemon", owner }`, called through `matchesFilter` on each
      in-play body's TOP card — the same call `searchDeck`'s filter, D204's
      board-side `AttachTargetRiders.ownerPokemon` and D241's `attachFromTop`
      already make, so a fifth prefix printing is admitted the day it is ingested
      and this member never learns a card name.

      ⚠️ **`count` IS A FLOOR AND NOT A LIST, WHICH IS THE ONE PLACE IT DIVERGES
      FROM `opponentPrizesRemaining`.** That member carries `counts: number[]`
      because its printings enumerate exact remainders ("if your opponent has
      exactly 1 or 2 Prize cards left"); this one's printed words are "**N or
      more**", a threshold, and a `>=` is the whole of it. Storing the floor as a
      one-element list would make the two members look alike and read differently.

      ⚠️ **"IN PLAY" IS ACTIVE + BENCH, TOP CARDS ONLY.** An evolved stack is ONE
      Pokémon in play (§4), so the count reads `topCardOf` and never the buried
      cards — which is also why a Team Rocket's Basic under a non-prefixed
      Evolution stops counting, the printed reading.

      ⚠️ **SEAT-RELATIVE AND SELF-SIDE.** "you have" is the asking seat's own
      board; the opponent's Team Rocket's Pokémon are invisible to it. This is
      the fifth self-side member and it needs no cross-board arm — no printing in
      the legal pool counts the opponent's owner-prefixed bodies.

      Public: every in-play Pokémon is face-up on the table, so the union's
      public-state invariant holds. */
  | { kind: "yourOwnerPokemonInPlayAtLeast"; owner: string; count: number }
  /** §8.1 — ANY of YOUR Pokémon were Knocked Out during your opponent's LAST
      turn: Unfair Stamp `sv06-165` (Item) and Hassel `sv06-151`/`-205`
      (Supporter), both opening *"You can use this card only if any of your
      Pokémon were Knocked Out during your opponent's last turn."* — three legal
      printings on ONE sentence, and the only two consumers whose second half this
      engine can already spell.

      🛑 **THE FOURTH MEMBER TO READ A TURN EVENT, AND THE FIRST TO ASK ABOUT A
      WINDOW THAT HAS ALREADY CLOSED.** `youPlayedSupporterThisTurn`,
      `yourActivePromotedThisTurn` and the durated `InPlayPokemon` stamps all ask
      about the turn IN PROGRESS, which is why they cost either nothing
      (`allowances`, cleared by `freshAllowances`) or a per-body stamp compared
      against `state.turn`. This one asks about the turn BEFORE — so no allowance
      bag can hold it (the bag is wiped at every `startTurn`, which is exactly the
      boundary this sentence looks across) and no `InPlayPokemon` field can hold
      it either (the body the sentence is about has LEFT PLAY; that is what "were
      Knocked Out" means). It needed a datum on `GameState` itself, and it got
      one: `lastKoTurn` (types.ts), stamped by `knockOut` (flow.ts).

      ⚠️ **"YOUR OPPONENT'S LAST TURN" IS SPELLED AS "THE TURN BEFORE THIS ONE",
      AND THAT IS A DERIVATION RATHER THAN AN APPROXIMATION.** Turns strictly
      alternate by construction — `turnTail` queues `startTurn(otherSeat(seat))`
      and `startTurn` does `turn + 1` — so turn `n − 1` belongs to the opponent of
      turn `n`'s owner and there is no seat comparison to get wrong. The predicate
      is `koedDuringOpponentsLastTurn` (types.ts), one line, one reader.

      ⚠️ NAMED FOR WHAT IT READS, NOT FOR THE PRINTED POSSESSIVE (D116): the
      sentence's "your opponent's last turn" is a way of SAYING "the previous
      turn", and the fact the member actually reads is whose Pokémon died and
      when. Both printings are the controller's own board, so no owner prefix is
      involved.

      🆕 **D326 TOOK THE SECOND MECHANISM D271 PRICED AND DECLINED HERE, AND IT
      IS TWO OPTIONAL NARROWINGS ON THIS ONE MEMBER RATHER THAN NEW MEMBERS.**
      Both narrow the KO SET rather than the window, both read the per-body
      record `GameState.lastKoMarks` that D271 said the prefix "would want the
      stamp to become", and BOTH ARE PRINTED ON ONE CARD AT ONCE (Ethan's Pinsir
      `sv10-001`), which is what settles them as two fields on one member instead
      of two members: a union could not have spelled the conjunction.

        · `owner` — *"any of your **Team Rocket's** Pokémon were Knocked Out…"*
          (Team Rocket's Archer `sv10-170`/`-223`), the D200/D267 owner
          vocabulary applied to the KO SET. The BARE subgroup name, exactly as
          `CardFilter.ownerPokemon` takes it, so one spelling of the subgroup
          serves the filter and the gate.
        · `byAttack` — *"…were Knocked Out **by damage from an attack** during
          your opponent's last turn"* (Iron Leaves `sv06-019`, Revavroom
          `sv06-125`, Alolan Marowak `sv09-057`, Terrakion `sv10.5w-054`/`-135`,
          Ethan's Pinsir `sv10-001`). A CAUSE, and NOT a new discrimination —
          `collectKnockOuts` has taken `attackerSeat` since D164.

      🛑 **ABSENT MEANS UNNARROWED, SO THE THREE EXISTING PRINTINGS ARE
      BYTE-ZERO.** Unfair Stamp, Hassel ×2 and Fezandipiti ex ×3 keep the bare
      `{ kind }` object they have carried since D271, and every `toEqual` on them
      still holds. A narrowing can only ever make this member's answer SMALLER
      (it filters a list the bare gate already had to admit), so a narrowed gate
      is TRUE on a strict subset of the boards the bare one is.

      PUBLIC — both players watched the Knock Out and both can count turns — so
      the union's public-state invariant holds. FALSE on turn 1 by construction
      (nothing has been Knocked Out and `null` matches no turn number), which is
      the right answer rather than a guarded edge. */
  | { kind: "yourPokemonKoedOnOpponentsLastTurn"; owner?: string; byAttack?: true }
  /** §4 — the turn in progress is YOUR OWN FIRST turn: Fan Rotom `sv07-118` /
      `sv08.5-085` "Fan Call", *"Once during your **first** turn, you may search
      your deck for up to 3 {C} Pokémon with 100 HP or less…"* — 2 legal
      printings on 1 sentence.

      🛑 **THIS MEMBER'S POPULATION IS 2 AND THE PHRASE'S IS 36 — D277's CENSUS
      CORRECTED A CLAIM THAT USED TO SIT ON THIS LINE.** D275 wrote that these 2
      printings were *"the whole population of `%during your first turn%` this
      engine can spell"*, having measured the phrase only far enough to find its
      own row. The full ladder (remote D1 `luminous`, `legal_standard = 1`, all
      three text columns, 2026-08-08) returns **ability 15 / attack 13 / effect 8
      = 36 printings on 15 names and 10 distinct first-turn CLAUSES**, and the
      bare-`%your first turn%` rung returns **ZERO**, so 36 is the whole phrase.
      **NOT ONE OF THE OTHER 34 CAN USE THIS MEMBER**, and the reason is a
      POLARITY rather than a gap in the vocabulary: this member is a REFUSAL and
      the rest are PERMISSIONS, going-order conjuncts or reminders. The 34
      account for themselves EXACTLY — an enumeration that does not add up is not
      a census: Carmine + Team Rocket's Proton **6** LIFT the §4 Supporter lock
      (`trainerFirstTurnExempt`); Meloetta ex **3** LIFTS the §4 attack ban
      (`PassiveEffects.attackFirstTurnExempt`, D277); Eevee + Karrablast + Shelmet
      **7** LIFT the §4/§10 evolve ban — **ALL SEVEN NOW BUILT**
      (`PassiveEffects.evolveEarlyExempt`: Eevee's 3 at D278 under a ZONE gate,
      the partner-gated 4 at D279 under `yourNamedPokemonInPlay`, the member two
      up, which `yourBenchHasNamed` could not supply because it is Bench-only by
      construction — see both doc blocks); Volbeat + Exeggcute **3** LIFT
      it for ONE ATTACK (a per-index licence, not this shape); Terapagos ex **7**
      and Illumise + Scream Tail ex + Call Bell + Chill Teaser Toy **5** qualify
      the phrase with a GOING-ORDER conjunct no member spells; Eevee ex **3** are
      reminder text. 6+3+7+3+7+5+3 = **34**, plus Fan Rotom's own 2 = **36**.
      `conditionHolds` can only NARROW what may be done, so a licence has no home
      here by construction. **A "whole population" claim about a PHRASE, made by a
      slice that queried until it found its own row, is a claim about the row.**
      The sentence-by-sentence split with a named refusal per group is in
      `debutPerformance.test.ts`'s header.

      🛑 **THE FIFTH MEMBER TO READ A TURN EVENT, AND THE FIRST THAT COSTS NO
      STATE AT ALL — NOT AN ALLOWANCE, NOT A STAMP, NOT A `GameState` FIELD.**
      Rank the four before it by what they had to store: `lastKoTurn` needed a
      `GameState` field (the window has closed and the body has left play),
      `yourActivePromotedThisTurn` needed a per-body stamp, `youPlayedSupporter‐
      ThisTurn` reused an allowance bag that already existed, and this one reuses
      ARITHMETIC. `turn` is 1-based, turns strictly alternate and the odd ones
      belong to `firstPlayer`, so "your first turn" is `turn === 1` for the
      going-first seat and `turn === 2` for the other — a total function of two
      fields `GameState` has carried since M1. **The predicate is
      `isFirstTurnOf` (types.ts), the same one §4's evolve / Rare Candy ban has
      called since D275, so the printed Ability gate and the rules ban cannot
      drift apart.**

      ⚠️ **SEAT-RELATIVE AND NOT TURN-OWNER-RELATIVE, WHICH IS WHY IT NEEDS NO
      `activeSeat` GUARD.** `youPlayedSupporterThisTurn` reads a single bag owned
      by whoever holds the turn, so it must first prove `seat` owns it; this
      reads `seat` ITSELF against `firstPlayer` and answers correctly for either
      seat at any moment — including from a `conditionGate` parked under the
      opponent's turn, where the honest answer is simply FALSE (turn 3 is nobody's
      first).

      ⚠️ IT IS THE ORDINAL, NOT "EARLY". `turn === 1 || turn === 2` would make
      the going-first seat's Ability usable on the opponent's opening turn, which
      is the quiet-wrong-answer direction: the printed word is *"your"*.

      PUBLIC — both players watched the coin flip and both can count turns — so
      the union's public-state invariant holds. FALSE during setup (`turn` is 0)
      by the same arithmetic, with no guard spelled. */
  | { kind: "yourFirstTurn" }
  /** D280 — YOU are the player who GOES SECOND, i.e. `state.firstPlayer` is your
      opponent. A SEAT-ASSIGNMENT fact, true on every turn of the game from the
      moment the flip is resolved; NOT a fact about which turn it is.

      🛑 **IT IS NOT `yourFirstTurn`, AND THE TWO ARE PRINTED SIDE BY SIDE**, so
      the confusion is available in the source text rather than only in the head:
      Call Bell `sv08-165` prints *"only if you go **second**, and only during
      your **first turn**"* — two clauses, two members, one `allOf`. A build that
      answered the going-order clause with `isFirstTurnOf` would be right on the
      one board the card is played on and wrong on every other turn of the game,
      and the whole conjunction would collapse to its second conjunct.

      🛑 **A BARE TAG AND *NOT* A PARAMETERISED `{ order: "first" | "second" }`,
      AND THE CENSUS IS THE REASON.** D118's rule admits a parameter when the
      printed sentence varies on exactly one token, and this one does: the
      Standard pool prints *"you go first"* on **12** printings and *"you go
      second"* on **12** (D280's rung 1, all three text columns, `legal_standard
      = 1`, 24 printings on 9 names). But **every one of the 12 "go first"
      printings is a §4-BAN LICENCE whose clause is DESCRIPTIVE, not a gate** —
      Carmine `sv06-145`/`-204`/`-217`/`sv08.5-103` and Team Rocket's Proton
      `sv10-177`/`-227` (`trainerFirstTurnExempt`, D223), Meloetta ex
      `sv10.5b-044`/`-159`/`-167` (`attackFirstTurnExempt`, D277), Volbeat
      `sv06-009` and Exeggcute `sv08-001`/`-192` (the per-index licence, unbuilt).
      Turn 1 IS the going-first player's turn by construction, so the going-second
      seat can never reach the ban those sentences lift and none of them needs a
      `BoardCondition` at all — registry.ts's `attackFirstTurnExempt` doc block
      makes exactly this argument and D223's made it first. **An `order: "first"`
      value would therefore be a value the pool cannot ask for**, which is D135's
      "an API nobody calls" one level down from the `not` refusal below. If a
      printing ever gates on going FIRST, that is the warrant to parameterise, and
      the widening is a one-line change with a compiler behind it.

      `state.firstPlayer` is the operand and it is NULLABLE — null through setup,
      when nobody has gone anywhere. FALSE for BOTH seats there, which is
      `yourFirstTurn`'s own reading of the same moment (`turn` is 0) and the
      honest answer to "do you go second" before the flip.

      PUBLIC — both players watched the flip — so the union's public-state
      invariant holds. Unlike `yourStadiumInPlay` this does not widen the P4 gap:
      the going-order assignment is on the wire already. */
  | { kind: "youGoSecond" }
  /** D280 — every one of `conditions` holds for the reading seat. The
      vocabulary's FIRST COMBINATOR and its first RECURSIVE member, bought by
      Call Bell `sv08-165`'s *"You can use this card only if you go second, and
      only during your first turn."* — one printed sentence, two independent board
      facts, neither of which is derivable from the other.

      🛑 **AND IT IS THE EXACT SHAPE `ATTACK_REQUIREMENT_CLAUSES` REFUSED FOR
      `not`, ADMITTED HERE ON THE ONE GROUND THAT SEPARATES THEM: POPULATION.**
      That refusal (this file, D125) is unchanged and stays unchanged — see its
      block. Its stated cost was recursion arms owed by consumers, and D280
      MEASURED that cost rather than inheriting it: the note says *"five
      consumers (`conditionHolds`, `conditionNote`, `redact.ts`, `cardplay.ts`'s
      playability descent, `registry.ts`) each owing a recursion arm"*, and that
      is **TWO**, not five. `redact.ts` (`redactedTrainersOf`) and `cardplay.ts`
      (`playTrainer`, `useAbility`) consume a condition OPAQUELY, through
      `conditionHolds`/`conditionNote`, and `registry.ts` only AUTHORS values; the
      only exhaustive `switch (cond.kind)` statements in the repo are the two in
      interpreter.ts (`grep -rn 'case "yourFirstTurn"'`, whole repo, `src/`
      included — 2 source arms, the rest are registry rows and test literals).
      **The refusal's CONCLUSION is right and its REASON was inflated 2.5×**, and
      a slice that had priced `allOf` off that sentence would have refused a
      combinator the pool asks for at a price it does not cost.

      **A LIST, AND A LIST THAT CANNOT BE SHORTER THAN TWO.** The tuple type
      makes the two degenerate spellings UNREPRESENTABLE rather than merely
      discouraged: an EMPTY `allOf` is vacuously TRUE and notes as the empty
      string (a play gate that reads *"X can only be used if "*), and a
      ONE-element `allOf` is a second spelling of a value that already exists, so
      two authored programs meaning the same thing would compare unequal by
      `toEqual` — the same objection D135's absent-key rule raises against an
      explicit `false`. Arity 3 is left open because the pool prints it: the
      Simisage / Simisear / Simipour triple `sv04-005`/`-021`/`-042` (*"If you
      have Simisage, Simisear, and Simipour in play"*) is three
      `yourNamedPokemonInPlay` conjuncts, **0 legal printings** and therefore NOT
      built — but its arity is free here and would have cost a member under a
      PAIR spelling.

      ⚠️ **NESTING IS ALLOWED BY THE TYPE AND ASKED FOR BY NOTHING.** `conditions`
      is `BoardCondition[]`, so an `allOf` may contain an `allOf`; no printed
      sentence in the pool nests, the fold and the note are both correct if one
      ever does, and no reader flattens. Do not author a nested one to be clever —
      a flat list is the printed shape.

      The public-state invariant is INHERITED rather than restated: a conjunction
      of public facts is a public fact, and there is no member this can wrap that
      would make it otherwise. */
  | { kind: "allOf"; conditions: readonly [BoardCondition, BoardCondition, ...BoardCondition[]] };

/** The riders that narrow which of the controller's own in-play Pokémon may
    RECEIVE an attach. Spelled once and read once (`attachEnergyTargets`,
    interpreter.ts) because "is this Pokémon an eligible attach target" is ONE
    rule with two op-shaped readers — `attachEnergyFrom` (hand / discard source)
    and `attachFromTop` (the deck top). Each op declares only the riders its
    printed cards use, and is structurally an `AttachTargetRiders`; an absent
    rider is no restriction, so the base shape is "every own in-play Pokémon".

    ⚠️ **THIS INTERFACE IS THE ENGINE'S IN-PLAY TARGET FILTER (D204), AND SAYING
    SO IS THE ANSWER TO A DESIGN QUESTION THAT LOOKED OPEN.** D200 landed
    `CardFilter.ownerPokemon`, measured its yield at six printings, and named the
    reason: `CardFilter` is the CARD vocabulary — it answers *does this card
    match* for a deck / hand / discard scan — and no op took a predicate for a
    body ON THE BOARD, so the sentences that point at the board were unreachable.
    The obvious two repairs were both priced and both REFUSED:

      • **`filter?: CardFilter` here.** It buys `ownerPokemon` free and admits
        SEVEN of `CardFilter`'s thirteen members that are FALSE for every board
        top card by construction (`basicEnergy`, `anyEnergy`, `specialEnergy`,
        `providesEnergy`, `supporter`, `toolCard`, `pokemonOrBasicEnergy` — and
        `providesEnergy`'s own doc above says a card-only read answers false).
        Authoring one yields an op whose candidate set is permanently empty,
        which `programPlayable` turns into a card that can never be played: a
        silent dead print, the exact "wrong-but-plausible program" the
        exact-map-or-flag doctrine exists to forbid. It also gives TWO ways to
        say "Basic" on one object (`basicOnly` and `{kind:"basicPokemon"}`), and
        STILL cannot say "is the Active", "has damage on it" or "has an Energy
        attached" — board facts a card predicate has no field for.
      • **A separate `TargetFilter` union.** A THIRD vocabulary beside an
        interface that already does this job, which would have to re-express
        `targetType` / `basicOnly` / `benchOnly` or leave them here (two
        vocabularies on one object either way) — and whose whole gain is room for
        board axes that NO legal printing narrows a target by. Speculative
        surface bought with a duplicate one.

    The standing rule decides it: **the unit of sharing is decided by the READ
    SITE, the unit of storage by the WRITE SITES.** The read site
    (`attachEnergyTargets`'s `eligible`) does not read a CARD — it reads a BOARD
    BODY, and it already pulls both kinds of fact off one as FLAT RIDERS: two
    card facts (`targetType`, `basicOnly`) and two board facts (`benchOnly`,
    `notIfKO`). So the missing piece is one more rider, not a vocabulary. What IS
    shared is the PREDICATE, not the type — `ownerPokemon` below is answered by
    calling `matchesFilter`'s own `ownerPokemon` arm, so the deck half and the
    board half can never disagree about who is an "Iono's Pokémon". */
export interface AttachTargetRiders {
  /** Only Pokémon whose TOP card is this type — Gardevoir ex's "your {P}
      Pokémon", Electric Generator's "your Benched {L} Pokémon".

      🆕🆕 **D354 — A LIST IS THE PRINTED UNION OF TYPES**, and a body qualifies
      if its TOP card carries ANY of them: Steven's Metagross ex `sv10-145`
      "X-Boot" — *"attach them to your **{P} Pokémon and {M} Pokémon** in any way
      you like"* — the ONE printing in the catalog whose attach target is two
      types, over all three text columns (`legal_standard = 1`).

      🛑 **THE UNION IS WHAT THE CARD PRINTS, AND THAT WAS SETTLED FROM THE PRINT
      BEFORE IT WAS PRICED** (D353's instruction). The rival reading — that the
      {P} Energy is PAIRED to a {P} body and the {M} to a {M} body, which two ops
      with two single-string `targetType`s would spell for FREE — is refused by
      two censuses of the catalog rather than by an argument about the engine:
      • **THE TEMPLATE.** *"attach them to `<NOUN>` in any way you like"* is **31
        printings**, and the `<NOUN>` slot holds **exactly one set description**
        in every one of them — "your Pokémon" ×24, "your Future Pokémon" ×2,
        "your Benched Pokémon", "your Marnie's Pokémon", "your Tera Pokémon", and
        X-Boot's. **NO PAIRING FORM EXISTS ANYWHERE IN THE CATALOG** — nothing of
        the shape *"attach the {P} Energy to … and the {M} Energy to …"*. The
        pairing reading needs this one template slot to mean something different
        in 1 of its 31 instances.
      • **THE CONSTRUCTION.** *"your {X} Pokémon and {Y} Pokémon"* occurs on
        exactly **two** cards: this one and Lilligant `sv09-007` (*"Attacks used
        by your {G} Pokémon and {R} Pokémon do 20 more damage"*), whose sentence
        admits **no pairing reading at all**. That is the catalog's own gloss on
        the construction: one set, membership by either type.
      And the syntax agrees — *"them"* is ONE plural referent for a set built from
      a three-way disjunction, landing in ONE noun phrase. There is no hook for a
      pair.

      **A WIDENED KEY RATHER THAN A SECOND ONE**, and that is this repo's standing
      rule rather than a preference: `attachFromTop.restTo`'s doc refuses a second
      key on one axis because *"two keys on one axis can be set to contradict each
      other and no reading of the print says what the contradiction means"*
      (D335/D352). A `targetTypes?: string[]` beside this would be exactly that
      state. The precedent for ONE key widened to carry a second reading is in
      this same op family — `attachFromTop.max: number | "any"`.

      Read through `targetTypeNames` (interpreter.ts), which normalises both
      spellings to a list ONCE for the two readers that need it — the eligibility
      gate and the prompt caption — for the reason `attachEnergyTargets` itself
      was factored out: a caption that named a wider set than the gate allows is
      the dialog contradicting its own validator. A bare `string` is not sugar for
      a one-element list: it is what every other printing prints, and it stays the
      spelling those rows keep. */
  targetType?: string | readonly string[];
  /** Only BASIC Pokémon (Koraidon ex's "your Basic {F} Pokémon"). */
  basicOnly?: true;
  /** Only Pokémon in the printed OWNER-PREFIXED SUBGROUP — Iono's Bellibolt ex's
      *"1 of your **Iono's** Pokémon"*, N's PP Up's *"1 of your Benched **N's**
      Pokémon"*, Marnie's Grimmsnarl ex's *"your **Marnie's** Pokémon"*. The value
      is the BARE owner name (`"Iono"`, `"N"`, `"Marnie"`), the same string
      `CardFilter.ownerPokemon.owner` takes, because it goes into the same
      predicate: `attachEnergyTargets` answers this rider with
      `matchesFilter(topCard, { kind: "ownerPokemon", owner })` rather than
      re-implementing the three conjuncts D200 measured against the live catalog
      (`category === "Pokemon"`, the exact-case name prefix with its load-bearing
      trailing space, and the stage word).

      A bare `string` for D200's reason, and the reason is STRONGER on this side:
      a misspelled owner matches the empty set, and here that is not merely a loud
      whiff but a `programPlayable` refusal on the ops that are gated — the card
      simply stops being offered, which is the loudest failure this engine has.
      No string can name a Pokémon it does not name.

      NO `stage` COUNTERPART, and that is the print rather than an omission: not
      one of the eight legal printings this rider unlocks narrows an IN-PLAY
      target by stage, and `basicOnly` beside it already carries the Basic half if
      one ever does. The rider is added when a card prints it (D200's own rule for
      the filter's own `stage`), not in advance. */
  ownerPokemon?: string;
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
  /** §12 (D177) — the DISCRETE recovery: the CONTROLLER's own Active recovers
      from every Special Condition it is carrying, at the moment the op runs.

        "This Pokémon recovers from all Special Conditions."
              (Gardevoir ex sv01-086/-228/-245 "Miracle Force" — an ATTACK)
        "Once during your turn, you may use this Ability. Your Active Pokémon
         recovers from all Special Conditions."
              (Blissey sv01-145 "Busybody Nurse" — an activated ABILITY)

      FOUR PRINTINGS / TWO SENTENCES over the whole local D1 (978 cards / 6 sets,
      re-derived 2026-08-04 across all three text columns and a WIDENED verb set —
      see `SELF_RECOVERS_ALL` below for the SQL and for the near-miss the widening
      turned up). Both entry points, one op: D169's ± pair shape, and the reason the
      two halves are not two ops is that the SUBJECT resolves identically. "This
      Pokémon" in an attack program is the attacker's Active, and an attack is
      declared by its own Active; "Your Active Pokémon" in an Ability program is
      `ctx.seat`'s Active. Both are `state.players[ctx.seat].active`, which is why
      the interpreter arm reads `ctx.seat` and nothing else.

      ⚠️ NO `target` FIELD, ON D104's MINIMAL-SHAPE RULE — and here the absence is
      load-bearing rather than merely economical. Neither sentence in this pool
      recovers anything but the controller's own Active, and the ONE shape a field
      would have to admit ("your opponent's Active Pokémon recovers…") is a
      sentence no card would ever print: recovery is upside. A `target` guessed at
      from one reading is exactly D104's failure mode.

      ⚠️ AND IT IS NOT `statusRecovery`, WHICH IS THE WHOLE DESIGN QUESTION AND WAS
      PRICED RATHER THAN ASSUMED (the reasoning lives at the interpreter arm,
      `clearStatus`, because that is where the alternative would have been spent).
      Short form: that field is CONTINUOUS — a catalog value read live by
      `passivesOf`, swept by flow.ts `recoverStatuses` at the four moments a source
      newly covers a body. This is DISCRETE: it fires once, at a moment the printed
      text names, and there is no source to be live afterwards. A discrete effect
      expressed as a continuous field would have to be written onto the board and
      then taken off again, which is a durated buff pretending to be an instant.

      ALL FIVE CONDITIONS, NOT A LIST. "all Special Conditions" is the printed
      quantifier over the closed `StatusName` union, so the op carries no
      `statuses` field the way `PassiveEffects.statusRecovery` must: sv02-193 NAMES
      three and these two name none, which is the difference between a set the card
      chose and the universe. Runs at `attack.ts`'s TAIL like every other
      `EffectOp` (D125's rule: the recovery's whole effect is on the ATTACKER, so
      nothing in the §8.5 pipeline reads it), never parks, consumes no rng, and is
      idempotent — a body with nothing to recover from resolves silently. */
  | { op: "clearStatus" }
  /** §11 — hold the Defending Pokémon in place for the opponent's next turn
      ("During your opponent's next turn, the Defending Pokémon can't retreat.").
      No `target` field: every print of this clause in the pool locks the
      DEFENDER, so the shape stays bare until a self-locking one exists (D104).
      Not an `applyStatus` variant — `StatusName` is a closed five-value union
      pinned by two exhaustive `Record`s, the wire condition schema and the
      playmat's status chips; the block is none of those things. */
  | { op: "preventRetreat" }
  /** §7.1/§7.2/§10 (D283, WIDENED BY D285) — bar the OPPONENT from playing `bars`
      from their hand for exactly their next turn. **9 legal printings on 4 printed
      sentences, two Trainer classes and one Pokémon ACT**:

        "Your opponent can't play any Supporter cards from their hand during
         their next turn."                                          (2, Supporter)
        "During your opponent's next turn, they can't play any Item cards from
         their hand."                                               (3, Item)
        "Discard all Energy from this Pokémon. During your opponent's next turn,
         they can't play any Item cards from their hand."            (3, Item)
        "During your opponent's next turn, they can't play any Pokémon from
         their hand to evolve their Pokémon."                        (1, evolve)

      🆕 🛑 **THE FIELD IS `bars: StampedPlayLockKey` AND IT WAS `cards:
      StampedHandPlayClass` UNTIL D285 — THE RENAME IS THE POINT OF THE WIDENING.**
      Bronzong `sv05-069` "Evolution Jammer" stamps the same window with the same
      arithmetic on the same record, but what it bars is an ACT and not a class of
      card, and a field called `cards` holding `"evolve"` is precisely the silent
      mis-classification `handPlayClassOf` exists to prevent. Renaming makes tsc
      visit every construction and every read, so the widening is audited by the
      compiler rather than by a grep.

      **`bars` IS A REAL PARAMETER AND NOT A `target`-SHAPED PLACEHOLDER**, which
      is the distinction D104 drew at `preventRetreat` one member up: that op stays
      bare because every printing of its clause locks the defender, and this one
      carries a field because the pool prints BOTH values of it. Two members would
      have been two ops that differ in one string.

      **NO `target` FIELD, FOR D104's ACTUAL REASON.** Every printing bars the
      OPPONENT — the subject is "your opponent"/"they" in all three sentences —
      so a `target: "self"` arm would be a value no board can produce.

      🛑 **THE SUBJECT IS A SEAT, WHICH IS WHY §11 DOES NOT GATE IT.**
      `preventRetreat`, `preventAttack` and `weakenDefenderAttacks` all call
      `effectRefused` because each is an effect of an attack done TO THE DEFENDING
      POKÉMON, and a "prevent all effects of attacks done to this Pokémon" block
      refuses exactly those. This one is done to the PLAYER: it touches no
      `InPlayPokemon`, and a block installed on a body cannot shield its
      controller's hand. Asking anyway would be a conjunct no printed block can
      make false — and worse, a WRONG one, since the bar would survive the §11
      refusal in the real rules.

      NOT AN `InPlayPokemon` STAMP, for the reason the field's own note gives
      (types.ts `handPlayLockedTurn`): the barred seat's Active may be Knocked Out,
      retreated or evolved between the attack and the play, and none of that lifts
      a bar printed on the PLAYER. Stamping a body would make every §10 clear a
      silent escape hatch. */
  | { op: "preventHandPlay"; bars: StampedPlayLockKey }
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
      written down (D130 → D131's precedent). Bronzong sv03-145 prints the THIRD
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
      — installing twice in one turn writes the same stamp.

      ⚠️ `fromClass` IS THE SECOND FIELD AND THE SECOND AXIS (D146). It narrows
      WHOSE attacks the block refuses, where `effects` widens WHAT it refuses:

        "During your opponent's next turn, prevent all damage done to this
         Pokémon by attacks from Basic Pokémon."             (1 legal printing)
        "During your opponent's next turn, prevent all damage done to this
         Pokémon by attacks from Basic non-{C} Pokémon."     (7 legal, D239)

      UNGATED — no coin is printed on it, so this is the first producer of this op
      that is not wrapped in a `coinFlipGate`, and the third printed reading of one
      installation rather than a second mechanism (D131's widen-don't-add rule
      applied a second time to the same op: strip the field and the derived program
      is byte-identical to the narrow gated one's body).

      ABSENT means "every attacker", which is what D142's two spellings print and
      is why the key is optional rather than a `fromClass: "any"` member (D135's
      absent-key rule). The predicate lives at the READ sites — `attackBlockOf`
      (continuous.ts) — because the attacker is not knowable when the block is
      installed; see `AttackerClass` above for why the stored form is a RECORD and
      types.ts `AttackBlock.fromClass` for which of the pool's class tokens stay
      LOUD and why. */
  | { op: "preventDamage"; effects?: true; fromClass?: AttackerClass; maxDamage?: number }
  /** §8.5/§11 (D147) — INSTALL a durated DAMAGE REDUCTION on the controller's own
      Active:

        "During your opponent's next turn, this Pokémon takes {N} less damage
         from attacks (after applying Weakness and Resistance)."       (12 printings)
        "Discard all Energy from this Pokémon. During your opponent's next turn,
         this Pokémon takes 100 less damage from attacks (after applying Weakness
         and Resistance)."                                             ( 2 printings)

      `preventDamage`'s NEIGHBOUR rather than its sibling: same holder resolution
      ("this Pokémon" is `ctx.seat`'s Active, so no `target` field and no park),
      same `state.turn + 1` window, same three §10 early clears, same tail
      placement — and a completely different answer at the read sites. That op
      NULLS the result and supersedes the pipeline; this one is a NUMBER
      subtracted inside it, at the step the printed parenthetical names.

      ⚠️ `amount` IS THE PRINTED HP, AND THE MECHANISM FOR SPENDING IT ALREADY
      EXISTED. Four printings in this pool print this exact sentence without the
      duration prefix, as an always-on Ability — Bouffalant sv03-174 "Bouffer"
      (20), Stonjourner sv01-121 "Exoskeleton" (20), Copperajah ex sv02-150/-245
      "Bronze Body" (30) — and they have been simulated since 0.x as
      `PassiveEffects.damageReductionAfterWR`, read at four damage sites. So the
      installed number is SUMMED into that aggregate rather than given a channel
      of its own (continuous.ts `installedReductionOf`), which is what makes the
      read-site diff one `+` per site and inherits the clamp and the `ignoreWR`
      bypass for free.

      FOUR AMOUNTS ON ONE CAPTURE, deliberately (D120/D131). The varying token is
      a NUMBER, which is closed by its type — unlike the open consequent
      vocabularies that earn one anchor each — so `(\d+)` in the anchor and one
      field here is the whole of "four amounts", and four rows would be four
      copies of one sentence.

      Runs at `attack.ts`'s TAIL like every other `EffectOp`, and — as with
      `preventDamage` and `preventAttack` — that placement is free rather than
      lucky (D125's rule): the reduction's entire effect is in the FUTURE, so
      nothing about it needs to precede the §8.5 pipeline. Never parks, consumes
      no rng, and is idempotent (installing twice in one turn keeps the larger
      number — see the interpreter for why MAX and not a sum). */
  | { op: "reduceDamage"; amount: number }
  /** §8.5/§11 (D149) — INSTALL a durated ATTACK-DAMAGE DEBUFF on the DEFENDING
      Pokémon, i.e. weaken what the opponent's Active DEALS on its own next turn:

        "During your opponent's next turn, the Defending Pokémon's attacks do
         {20|30} less damage (before applying Weakness and Resistance)."    (3)
        "During your opponent's next turn, attacks used by the Defending Pokémon
         do 100 less damage (before applying Weakness and Resistance)."     (2)

      `reduceDamage`'s MIRROR ON BOTH AXES AT ONCE, which is the whole slice: that
      op writes a number onto the CONTROLLER's own Active to be subtracted AFTER
      Weakness and Resistance from what that body TAKES; this one writes a number
      onto the OPPONENT's Active to be subtracted BEFORE them from what that body
      DEALS. Same window (`state.turn + 1`), same `{ turn, amount }` record shape,
      same three §10 clears, same no-park, same `Math.max` merge — opposite body,
      opposite step, and the printed sentences differ by ONE WORD inside the
      parenthetical.

      ⚠️ NO `target` FIELD, AND THAT IS D131 RATHER THAN AN OMISSION. D148 gave
      `preventAttack` a `target` because the pool prints that op's sentence on
      BOTH seats and one field determined the stamp for both. This op has no self
      arm: every one of the five printings installs on the Defending Pokémon, and
      the always-on member the pool prints (Entei sv03-030 "Pressure") is an
      Ability that debuffs the opponent's Active too. A field with one reachable
      value is a second way to say what the op's name already says.

      ⚠️ IT IS AN EFFECT OF AN ATTACK DONE TO THE DEFENDING POKÉMON, so a §11
      block that refuses "effects of attacks" refuses THIS — `preventRetreat`'s
      and D148's `preventAttack` check verbatim, and REACHABLE off printed cards
      (the defender installs `{ effects: true }` on their turn, its window is the
      installer's very next turn, and that is the turn this debuff would land on).
      Classified `blocked` in `preventBlock.test.ts`'s §11 table AND driven under a
      live wide block, because that table forces a verdict without checking one
      (D148's own finding, measured there and answered here for this op).

      Runs at `attack.ts`'s TAIL like every other `EffectOp`, and — as with
      `preventDamage`, `preventAttack` and `reduceDamage` — that placement is FREE
      rather than lucky (D125's rule): the debuff's entire effect is in the future,
      so nothing about it needs to precede the §8.5 pipeline that hits the very
      body it is written onto. Never parks, consumes no rng, and is idempotent
      (installing twice in one turn keeps the LARGER number — the interpreter says
      why MAX and not a sum, `reduceDamage`'s argument on the other seat). */
  | { op: "weakenDefenderAttacks"; amount: number }
  /** §9/§11 (D152) — ARM a durated REACTIVE RECOIL on the controller's own Active
      ("During your opponent's next turn, if this Pokémon is damaged by an attack
      (even if it is Knocked Out), put 10 damage counters on the Attacking
      Pokémon." — 2 printings, Lycanroc ex sv02-117/-241 "Scary Fangs").

      `reduceDamage`'s SIBLING and not its mirror: same holder ("this Pokémon"),
      same `state.turn + 1` window, same absence of a `target` field, same no-park,
      same `Math.max` idempotence. The one difference is which number the stamp
      feeds — that one is subtracted at §8.5 step 5, this one is added at the §9
      reactive recoil, the site that already sums `passivesOf().damageAttacker`.

      ⚠️ `amount` IS HP, NOT COUNTERS. The printed sentence says "10 damage
      counters"; the deriver multiplies by 10 once (effects.ts
      `SELF_INSTALLED_RECOIL`) so this op speaks the same unit as the registry's
      four always-on printings of the same clause, which is what makes the two
      halves summable at one read site instead of two.

      ⚠️ IT NEEDS NO CONDITION FIELD FOR "if this Pokémon is damaged by an attack".
      That clause is not a gate the op evaluates — it is the description of the
      READ SITE, which fires on `dealt > 0` and has done since 0.x for Counterattack
      Quills. An op field would be a second spelling of a condition the site owns.

      Placed AFTER the damage like every other durated rider in this family — the
      whole effect is in the future, so nothing about it needs to precede the §8.5
      pipeline. Never parks, consumes no rng, refusable by no §11 block (it writes
      to the actor's own body — `reduceDamage`'s verdict verbatim, and the §11
      classification table drives it). */
  | { op: "installRecoil"; amount: number }
  /** §8/§11 (D143, widened D148) — LOCK a Pokémon out of attacking on ITS OWN
      controller's NEXT turn. Four printed sentences, on both sides of the table:

        "During your next turn, this Pokémon can't attack."          (20 printings)
        "Put {N} damage counters on 1 of your opponent's Pokémon.
         During your next turn, this Pokémon can't attack."          ( 2 printings)
        "Discard an Energy from this Pokémon. During your opponent's
         next turn, the Defending Pokémon can't attack."             ( 3 printings)
        "If the Defending Pokémon is a Basic Pokémon, it can't attack
         during your opponent's next turn."                          ( 1 printing )

      The first two are the DRAWBACK half of a big-damage attack, and the pool's
      most re-printed durated rider after D112's retreat lock: Miraidon ex /
      Koraidon ex ×4 each, Dragonite VSTAR ×2, Alomomola, Clawitzer, Steelix,
      Kilowattrel, Tinkatuff, Victini ex, Crabominable, Umbreon, Probopass, Golbat
      — plus Ninetales sv03-029/-199 "Nine-Tailed Dance", where it rides behind a
      counter PUT. The last two are the OFFENSIVE reading, and both are compounds:
      Eiscue ex sv03-042/-210/-222 "Scalding Block" ({W}{W}{W}, INDEX 0, printed
      160) buys it with a self-discard, and Houndoom ex sv03-134 "Evil Claw"
      ({D}{D}, INDEX 0, printed 90) gates it on the defender's STAGE.

      `preventRetreat`'s MIRROR, and shaped like it deliberately — except on the
      one axis that now varies. That op locks the OPPONENT's Active out of
      RETREATING; the `target: "defender"` arm here is its exact sibling, and the
      absent-key arm is that sibling pointed the other way.

      ⚠️ `target` IS ONE AXIS AND NOT TWO — WHICH IS THE SLICE'S FINDING, and it
      overturns what this doc block said at 0.92.0–0.96.0. The refusal written here
      was that a `target` "would have to carry a DIFFERENT STAMP as well as a
      different holder (the defender-side window is `state.turn + 1`, this one is
      `state.turn + 2`), so the field is two axes rather than one". The two numbers
      are real. They are not INDEPENDENT: there is exactly ONE rule —

          the window is the LOCKED POKÉMON's controller's NEXT turn

      — and the two numbers are that one rule evaluated on the two seats, because
      DECLARING AN ATTACK ENDS THE TURN (§5.3). The installer's own next turn is
      `+ 2`; the defender's is `+ 1`. So the stamp is a pure FUNCTION of the
      holder, the printed wording differs ("your next turn" / "your opponent's next
      turn") for exactly the same reason, and one field determines both. D131's
      widen-don't-add test, passed on the second reading rather than guessed at
      from the first — which is what D143 said to wait for.

      ABSENT means "self" (D135's absent-key rule, and D144's `onTails` shape): the
      22 self-lock printings derive the bare op unchanged, every registry row and
      every persisted `EffectContinuation` written before this slice stays a valid
      inhabitant of the new type, and it reads back as precisely what it meant.

      ⚠️ NO CLASS FIELD, THOUGH ONE PRINTING IS CLASS-GATED. Houndoom ex's "If the
      Defending Pokémon is a Basic Pokémon" is a BOARD CONDITION, and this engine
      has had a board-condition branch since M4 — so that printing derives to
      `conditionGate { cond: { kind: "opponentActiveIsBasic" }, then: [this op] }`
      and the `then` is byte-identical to the other compound's second op. A field
      here would be a SECOND way to say something the gate already says generally
      (D131 again), and it would say it for one op where the gate says it for all.

      ⚠️ IT LOCKS THE POKÉMON, NOT THE ATTACK, and the pool prints the other
      reading too — ✅ MAPPED at D154 by `preventAttackUse`, a SEPARATE op for the
      reason its own doc block gives (D131's widen-don't-add test, run and FAILED).
      Six catalogued printings say "this Pokémon can't use {AttackName}" (Munkidori
      ex sv06.5-037/-083/-091 "Dirty Headbutt", Lucario sv01-114 "Accelerating
      Stab", Skarmory sv03-142 "Slashing Steel", Greedent ex sv03-179 "Slip 'n'
      Roll"), plus Radiant Blastoise swsh10.5-018 "Torrential Cannon", which is
      FIELDED but has no catalog row at all — the local D1 holds no swsh10.5 SET
      (D154's census; the older "eight printings" count named it and Radiant
      Charizard swsh10.5-011, which is in neither the catalog nor the pool).
      TWO MORE do it to the OPPONENT and STAY LOUD — Medicham sv01-111
      "Acu-Punch-Ture" and Oranguru sv02-094 "Plotter's Command", "Choose 1 of your
      opponent's Active Pokémon's attacks. During your opponent's next turn, that
      Pokémon can't use that attack." — because CHOOSING the attack is a park on
      top of the address, which is the one thing D154 did not build.
      A fixture pins the difference from the inside — Alomomola sv01-048's index-0
      "Surf" is refused by the lock its index-1 "Aqua Slash" installed, and
      Alomomola refused SURF by a Houndoom ex across the table is the same
      assertion from the other seat.

      Runs at `attack.ts`'s TAIL like every other `EffectOp`, and — as with
      `preventDamage` — that placement is free rather than lucky (D125's rule):
      the lock's entire effect is in the FUTURE. Never parks, consumes no rng, and
      is idempotent (a re-install writing the same stamp is silent). */
  | { op: "preventAttack"; target?: "defender" }
  /** §8/§11 (D154) — BAR ONE NAMED ATTACK on the controller's own Active for the
      holder's next turn ("During your next turn, this Pokémon can't use
      {AttackName}.", 6 catalogued printings across 4 names plus 1 fielded
      uncatalogued printing — see `SELF_CANT_USE_ATTACK` below for the census).
      `attack` is the printed PROPER NOUN, verbatim off the sentence.

      ⚠️ A SEPARATE OP RATHER THAN A FIELD ON `preventAttack`, AND D131's
      WIDEN-DON'T-ADD TEST IS WHAT DECIDES IT — run in the direction that says no,
      which is the point of running it. That test asks whether stripping the new
      key yields the previous arm BYTE FOR BYTE. It does not: `preventAttack`
      writes `attackLockedTurn` and bars the Pokémon; strip `attack` from a
      hypothetical `preventAttack { attack }` and you get a DIFFERENT rule writing
      a DIFFERENT field. Contrast D148's `target`, which passes the test exactly —
      same field, same rule, the other seat. A key that selects a different
      behaviour is a different op, and the compiler is what makes that checkable:
      two ops mean two `stepOp` arms and two §11 verdicts, where one op with an
      optional key would admit `{ target: "defender", attack: "…" }` — an
      inhabitant no printing produces and no site reads.

      ⚠️ THE NAME IS RESOLVED AT THE INSTALL, NOT HERE AND NOT AT THE READ SITES.
      The op carries the printed token because that is what the sentence says; the
      interpreter looks it up in the holder's `attacks` and stamps an INDEX
      (`InPlayPokemon.lockedAttack`), because all three read sites — attack.ts's
      §8 gate, `redactedAttacksOf` and GameHud — address attacks by index. A name
      that matches nothing on the holder installs NOTHING and emits no row: a lock
      on an attack the card does not have is inert, and announcing it would tell a
      player about a drawback that cannot bite.

      THE STAMP IS `state.turn + 2` — D143's number, not D142's. The sentence
      prints "During YOUR next turn", declaring an attack ENDS the turn (§5.3), so
      the holder's own next turn is two away. See `LockedAttack` (types.ts) for why
      this is a second field beside `attackLockedTurn` rather than a key on it.

      NO `target` FIELD, and the pool's reason is written down rather than assumed:
      the OPPONENT-side twin of this sentence exists (Medicham sv01-111
      "Acu-Punch-Ture" and Oranguru sv02-094 "Plotter's Command" — "Choose 1 of
      your opponent's Active Pokémon's attacks. During your opponent's next turn,
      that Pokémon can't use that attack.") and is NOT reachable by adding one,
      because it CHOOSES the attack: the address is a park, not a printed noun, so
      the op would need a candidate set and a prompt as well as a seat. It stays
      LOUD (attackLock.test.ts).

      Runs at `attack.ts`'s TAIL like every other `EffectOp`, and that placement is
      free rather than lucky (D125's rule): the lock's entire effect is in the
      FUTURE. Never parks, consumes no rng, and is idempotent (a re-install writing
      the same turn AND the same index is silent). */
  | { op: "preventAttackUse"; attack: string }
  /** §8.5/§11 (D155) — BUY ONE NAMED ATTACK on the controller's own Active a flat
      pre-W/R DAMAGE BONUS for the holder's next turn ("During your next turn, this
      Pokémon's {AttackName} attack does {N} more damage (before applying Weakness
      and Resistance).", 1 printing — Seismitoad sv03-052 "Echoed Voice"; the
      census is on `SELF_ATTACK_BOOST` below). `attack` is the printed PROPER NOUN,
      verbatim off the sentence; `amount` is HP.

      `preventAttackUse`'s OPPOSITE VERB AT THE SAME ADDRESS, and written directly
      beneath it so the pair reads as one design: same holder ("this Pokémon"),
      same `state.turn + 2` window, same printed-noun capture resolved by the same
      helper at the same site, same three §10 clears, same no-park. What differs is
      the consequent — that op BARS the named attack, this one PAYS it — and that
      is the whole reason they are two ops and two fields rather than one of each
      (types.ts `BoostedAttack`).

      ⚠️ THE AMOUNT IS A SECOND TERM AT THE READ SITE, NOT A SIGNED SIBLING OF
      D149's. The two are the same step of §8.5 pointed in opposite directions, and
      only ONE of D149's three grounds for keeping its number out of
      `attackerPreWRBonus` applies here — the CATALOG fold is §9-suppressible and
      an attack installation must not be — but one is enough, and the other two
      failing is what makes this number REPORTABLE in the row's existing `bonus`
      field where the debuff needed one of its own (events.ts).

      ⚠️ NO `target` FIELD, AND NO PRINTING TO EARN ONE. The sentence names "this
      Pokémon" on its only printing, and the pool prints no opponent-side buff at
      all (censused on the anchor). A field with one reachable value is a second
      way to say what the op's name already says — `weakenDefenderAttacks`'s
      refusal, on the other seat.

      Runs at `attack.ts`'s TAIL like every other `EffectOp`, and that placement is
      free rather than lucky (D125's rule): the bonus's entire effect is in the
      FUTURE, so it cannot reach the very hit that installs it. Never parks,
      consumes no rng, and is idempotent (a re-install writing the same turn, index
      and amount is silent; a larger amount on the same address wins by `Math.max`
      — the interpreter says why). */
  | { op: "boostAttack"; attack: string; amount: number }
  /** §8/§11 (D157) — BAR ONE **CHOSEN** ATTACK on the OPPONENT's Active for that
      Pokémon's next turn ("Choose 1 of your opponent's Active Pokémon's attacks.
      During your opponent's next turn, that Pokémon can't use that attack.", 2
      catalogued printings — Medicham sv01-111 "Acu-Punch-Ture" and Oranguru
      sv02-094 "Plotter's Command"; the census is on `OPPONENT_CHOSEN_ATTACK_LOCK`
      below). `preventAttackUse`'s twin ACROSS THE TABLE, and the whole of what
      differs is where the ADDRESS comes from:

      | | `preventAttackUse` (D154) | this (D157) |
      |---|---|---|
      | Holder  | `ctx.seat`'s Active     | the DEFENDER            |
      | Address | a printed PROPER NOUN   | a PLAYER's CHOICE       |
      | Stamp   | `state.turn + 2`        | `state.turn + 1`        |
      | Install | synchronous             | **PARKS** on a prompt   |
      | State   | `lockedAttack`          | `lockedAttack`          |

      ⚠️ NO FIELDS AT ALL, WHICH IS THE SHAPE THE ADDRESS FORCES. Every sibling in
      this family carries the thing it addresses (`attack`, `amount`); this one
      addresses nothing until a player answers, so the op is a bare tag and the
      INDEX arrives on the `EffectChoice`. A `target` field would be the second way
      to say what the op's name already says — `weakenDefenderAttacks`'s refusal
      (D149), on the other seat — because the SELF direction of this sentence is
      not this op's other arm, it is `preventAttackUse`, a different reading of a
      different printed string.

      ⚠️ A THIRD OP RATHER THAN A `target` ON `preventAttackUse`, AND D131's
      WIDEN-DON'T-ADD TEST SAYS SO IN THE DIRECTION THAT MATTERS. That test asks
      whether stripping the new key yields the previous arm BYTE FOR BYTE. It does
      not, and it cannot: `preventAttackUse` REQUIRES its printed noun, so
      `{ target: "defender" }` with no `attack` is not that op minus a key — it is
      a different rule with a different (empty) payload. D148's `target` on
      `preventAttack` passes the same test exactly, and the contrast is the point:
      there the two arms were one rule about two bodies, here they are two ways of
      LEARNING an address. One op would also admit `{ target: "defender", attack:
      "…" }` and `{ attack: undefined }`, two inhabitants no printing produces.
      **And the compiler could not tell them apart where it matters most**: this op
      returns a `park` from `stepOp` where that one returns a `done`, so a single
      op would make "does this install ask a question?" a runtime property of a
      field rather than a fact about the case.

      ⚠️ THE FIELD *IS* SHARED, THOUGH, AND THAT IS D148's ANSWER RE-RUN AT THE
      ADDRESS. `InPlayPokemon.lockedAttack` is reused UNCHANGED — no new stamped
      field, no `MATCH_RECORD_VERSION` bump — because "which of this body's attacks
      is barred, and on which turn" is ONE question about ONE body, and whose
      attack wrote the answer is a fact about the OP. The ground is the READ, which
      is the axis D155 separated its own record on: `lockedAttackIndex` is the ONE
      reader, and it REFUSES the index it returns whichever op wrote it. D155
      refused a shared record because its two consumers disagreed about the index;
      this one shares it because they are the SAME consumer.

      THE STAMP IS `state.turn + 1` — D142/D148's number, not D143's. The sentence
      prints "During your OPPONENT's next turn", and declaring an attack ENDS the
      turn (§5.3), so the very next turn belongs to the locked seat. One rule (the
      window is the LOCKED Pokémon's controller's next turn) evaluated on the other
      seat, exactly as D148 established.

      ⚠️ IT PARKS, AND THE CANDIDATES ARE A NEW KIND OF THING. The prompt is
      `chooseAttack` (interpreter.ts) — the first whose candidates are neither
      cards nor Pokémon but ROWS OF A POKÉMON's printed attack list. The M1
      doctrine still governs the endings: an Active with NO attacks is a silent
      no-op, exactly ONE attack auto-resolves without a prompt, and two or more
      park. Both degenerate endings are REACHABLE off the printed cards (a
      one-attack defender is an ordinary board), so neither is constructed.

      Runs at `attack.ts`'s TAIL like every other `EffectOp` (D125's placement
      rule): the lock's entire effect is in the FUTURE. Consumes no rng, and is
      idempotent — a re-install writing the same turn AND the same index is
      silent, `preventAttackUse`'s early return verbatim. */
  | { op: "preventChosenAttack" }
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
      0.84.0 — the bare `OWN_BOARD_HEAL` attack sentence (D133).

      `pokemonType` (0.182.0, D266) is the printed TYPE GATE — Clemont's Quick
      Wit's *"Heal 60 damage from each of your {L} Pokémon."* ABSENT is the
      ungated sentence (Fennel, Garganacl) and is NOT the same as a gate on
      `Colorless`: an untyped-in-the-printing "each of your Pokémon" heals a
      {L} body too, so the two spellings must not collapse.

      ⚠️ **IT IS A `PokemonType`, NOT A `BasicEnergyType`** — `POKEMON_TYPES` has
      eleven members and `Dragon` / `Colorless` are printed Pokémon types with no
      Basic Energy behind them. That is the vocabulary whose NAME matches the
      axis AND whose MEMBERS can express it; a `BasicEnergyType` field would be
      unable to spell a hypothetical *"each of your {N} Pokémon"*.

      ⚠️ **AND IT IS A BOARD READ, NOT A CARD READ.** The gate walks the seat's
      IN-PLAY bodies and compares their TOP card's `types`, which is why it is a
      field on the op beside `attachEnergyTargets`' `targetType` rider and NOT a
      `CardFilter` member — `typedPokemon` is the deck/hand/discard half of the
      same axis and would be the wrong instrument here. */
  | { op: "healEach"; amount: number; pokemonType?: PokemonType }
  /** Heal `amount` HP from EVERY in-play Pokémon on BOTH boards (Picnic Basket
      "Heal 30 damage from each Pokémon (both yours and your opponent's)"). The
      seat-blind twin of `healEach` — the whole table heals, not just the
      controller's side. No target choice, so it never parks; one HEALED per
      Pokémon that actually healed, tagged with that Pokémon's OWN seat. */
  | { op: "healEachAll"; amount: number }
  /** 🆕 **D340 — PUT `amount` HP OF DAMAGE COUNTERS ON EVERY IN-PLAY BODY ON BOTH
      BOARDS THAT MATCHES `filter`.** Froslass `sv06-053`/`sv06-174`/`svp-117`
      "Freezing Shroud": *"During Pokémon Checkup, put 1 damage counter on each
      Pokémon that has an Ability (both yours and your opponent's), except any
      Froslass."* — **3 Standard-legal printings on ONE sentence**, and the whole
      legal population of the sentence (remote D1 `luminous`, 2026-08-15).

      🛑 **IT IS `healEachAll`'s COUNTER TWIN, AND THE PARENTHETICAL IS THE PROOF
      THAT THE SEAT-BLIND SHAPE IS THE RIGHT ONE.** Picnic Basket prints *"each
      Pokémon **(both yours and your opponent's)**"* and this card prints the same
      six words; both are therefore a `SEATS` walk rather than a `ctx.seat` one,
      and modelling this as a seat-scoped op with a "both" boolean would put the
      printed subject of the sentence into a modifier (`gust`/`opponentSwitchOut`'s
      lesson, one op family over).

      ⚠️ **`amount` IS HP, NOT COUNTERS.** The printed *"1 damage counter"* is
      converted at the REGISTRY, exactly as `TREVENANT`'s `amount: 10` is (§12), so
      this helper never sees the printed unit and cannot convert twice.

      🛑 **NEVER KOs, AND THAT IS A DELEGATION RATHER THAN AN OMISSION.** It only
      raises `damage`; the Checkup's own KO sweep (flow.ts) resolves any Knock Out a
      placed counter caused, which is the identical contract `damageActive` has
      carried since Trevenant. The bench LENGTH is therefore stable across the walk
      — `runCheckupTriggers`' stated precondition — because nothing is removed here.

      • `filter` — the printed noun, REQUIRED. Froslass's is *"each Pokémon that has
        an Ability"*, which is `abilityPokemon`, **a `CardFilter` member that
        already exists** (D285 built it for the play-bar); so the noun costs no new
        vocabulary and the op takes the whole union rather than a bespoke boolean.
        Asked of the TOP card through `matchesFilter`, the one membership test every
        card-shaped noun in this engine asks. A body whose top card cannot be
        resolved fails the filter — `matchesFilter`'s conservative direction,
        `undefined` is false — so an unresolvable body is skipped, never counted.
        ⚠️ **REQUIRED AND NOT OPTIONAL** on D104's minimal-shape rule: the pool
        prints exactly one sentence here and it carries a noun, so an absent field
        would be a state no card can author (D222's closed-world lesson).

      • `exceptNamed` — the printed *"except any Froslass"*, **D273's rider spelling
        reused verbatim** from `switchActive.exceptNamed` and not a new idea.
        🛑 **IT IS A RIDER AND NOT A `CardFilter` NEGATION MEMBER, AND THAT WAS
        RE-PRICED AT D340 RATHER THAN INHERITED.** The backlog carried this axis as
        *"no filter negates — a genuine engine addition"*; the engine has in fact
        negated by rider **twice** and on purpose since D273/D285
        (`switchActive.exceptNamed`, `preventOpponentPokemonPlay.only`/`except`).
        `switchActive.exceptNamed`'s own doc states the refusal in full — a
        `notNamed` member would need `allOf` (the printed noun is an INTERSECTION
        and this union's only combinator is `anyOf`) plus a `retrieveNoun` arm no
        printing drives. **Two union members and a dead caption arm, to say what one
        string field says** — and that argument is not weaker here, it is stronger:
        this op has no caption at all.
        ⚠️ **THE NAME IS THE SOURCE CARD'S OWN AND IS SPELLED OUT ANYWAY**, D273's
        reasoning verbatim: `matchesFilter` is handed a CARD and never a source, so a
        self-referential rider would be a mechanism whose only witness is the
        coincidence that the printed name matches. The card prints a NAME; the field
        holds it. Exact-case equality on `Card.name`, the field `ownerPokemon`'s
        prefix test reads.
        ⚠️ **AND IT SUBTRACTS RATHER THAN CONJOINS.** `filter` must HOLD and
        `exceptNamed` must NOT match, read in the printed order — a Froslass, which
        HAS an Ability and therefore satisfies the noun, escapes counters it
        otherwise earns. `preventOpponentPokemonPlay`'s two riders are the same
        subtraction one file over, and the suite drives that exact body: an `&&` of
        both would counter every Froslass on the table. */
  | { op: "counterEachAll"; amount: number; filter: CardFilter; exceptNamed?: string }
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

      THE DIRECTION IS IN THE NAME (D104's minimal shape, and D130's
      `discardOpponentDeckTop` is the precedent), and it STAYS there. D138 wrote
      down what would earn a widening — *"a second ATTACK printing of a counter
      move, at which point the two readings are in hand and this op gains the
      field they actually differ on"* — and named the two ABILITY near-misses it
      refused to guess from: Munkidori sv06.5-072 "Adrena-Brain" moves *up to 3*
      counters from 1 of your Pokémon (any zone) to 1 of your OPPONENT's Pokémon
      (a second choice), and Slowbro sv01-043 "Strange Behavior" moves *1*
      counter from 1 of your OTHER Pokémon to THIS one (your own side as the
      destination).

      ⚠️ **D205 IS THAT SECOND ATTACK PRINTING, AND IT DIFFERS ON EXACTLY ONE
      AXIS — THE SOURCE'S SUBGROUP, NOT THE AMOUNT AND NOT THE DESTINATION.**
      Team Rocket's Wobbuffet sv10-082/svp-203 "Rocket Mirror" prints *"Move all
      damage counters from 1 of your Benched **Team Rocket's** Pokémon to your
      opponent's Active Pokémon."* — Dedenne ex "Tail Swap" word for word with
      one possessive inserted. So the widening D138 licensed is taken at exactly
      the width the second printing measures: ONE optional rider on the SOURCE
      candidate set. `amount` and `from`-zone and `to` are STILL not fielded,
      because both attack printings agree on all three, and the two Abilities
      above still differ on axes no attack has printed.

      `ownerPokemon` is answered by `matchesFilter(topCard, { kind:
      "ownerPokemon", owner })` — D200's arm, D204's board-side reuse, a THIRD
      read site for one predicate — so "a Team Rocket's Pokémon" cannot come to
      mean one thing to a deck search and another to a counter move.

      NOT A FIELD ON `healChosen`, and that is D131's widen-don't-add rule
      APPLIED AND FAILING rather than skipped. That rule licenses a field when
      everything downstream of picking the candidate set is byte-identical; here
      the pick is the ONLY thing the two share. This op emits a second event, on
      the OTHER seat's board, which can end the game — an op named `heal` that
      placed damage would be the misnaming D128's provenance rule exists to
      prevent. */
  | {
      op: "moveCountersToDefender";
      /** Only Benched Pokémon in the printed owner-prefixed subgroup may be the
          SOURCE — Team Rocket's Wobbuffet's *"1 of your Benched **Team
          Rocket's** Pokémon"* (D205). Absent = every Benched body, which is
          Dedenne ex's unmarked print and what this op meant before D205. The
          value is the BARE owner name (`"Team Rocket"`), the same string
          `CardFilter.ownerPokemon.owner` and `AttachTargetRiders.ownerPokemon`
          take, because all three go into the one predicate. */
      ownerPokemon?: string;
    }
  /** The counter move whose DESTINATION is a second decision — *"Move all damage
      counters from 1 of your Benched Pokémon to **1 of your opponent's
      Pokémon**."* (Cofagrigus sv10.5w-040/-123 "Extended Damagriiigus", **2
      legal**). D138's sentence with its fixed destination replaced by a choice,
      and the axis `moveCountersToDefender`'s doc block above refused to guess at
      three separate slices (D138, D205, D206).

      **A SECOND OP RATHER THAN A `to` RIDER ON `moveCountersToDefender`, AND
      D131's WIDEN-DON'T-ADD RULE IS WHAT DECIDES IT — TWICE OVER.** That rule
      licenses a field when everything downstream of the shared part is
      byte-identical. Here the SOURCE pick is byte-identical (the same
      `subgroupRefs(ownBenchRefs(...))` candidate set), and everything after it
      is not: this op asks a whole second question, parks a second time, and its
      §11 gate is CONDITIONAL on where the counters land, where the fixed-
      destination op's is unconditional. And the alternative — renaming
      `moveCountersToDefender` so one op could honestly carry both — is not
      available at any price a slice can pay: `pendingOp.op` is a PERSISTED
      literal riding `GameState.phase.cont` into the match record, so renaming it
      would owe a `MATCH_RECORD_VERSION` bump. A name that lies or a bump that is
      not this slice's to take; the third door is a new inhabitant, which is what
      `optional` was at D186 and costs neither.

      **`fromBench` IS THE ANSWER TO THE FIRST QUESTION, CARRIED ON THE OP
      ITSELF, AND IT IS NEVER AUTHORED.** The deriver emits this op WITHOUT it;
      the interpreter re-emits it WITH it once the source is known (inline when
      the Bench forces the pick, spliced by `resumeProgram` when it parks — see
      `continuationOps` there). Absent = "the source is still unknown, ask for
      it"; present = "the source is that Bench index, ask where the counters go".
      One op, two questions, one park each.

      ⚠️ **THE CHANNEL IS THE OP AND DELIBERATELY NOT `EffectRecord`, WHICH IS
      THE OTHER MECHANISM THAT COULD CARRY IT.** The standing rule — the unit of
      SHARING is decided by the READ SITE, the unit of STORAGE by the WRITE SITES
      — answers this cleanly: there is exactly ONE reader (this op's own second
      question) and exactly ONE writer (its own first answer), so nothing is
      being shared and a shared bus is the wrong home. And the record would be
      the wrong home even if it were free, on MEANING: `EffectRecord` holds *what
      MOVED* (`paid` / `moved` / `discarded`), and `recordGate` — the printed "if
      you do" / "in this way" — reads it. Filing a source that has been NAMED but
      not yet emptied would make that gate answer true for an action that has not
      happened, which is precisely the "half of a printed action" failure
      `moveCountersToDefender`'s own doc block names on the other side of the
      engine.

      **`fromBench` IS AN INDEX AND NOT A `PokemonRef`, D104's minimal shape.**
      The printed source is *"1 of your **Benched** Pokémon"* — the seat is
      `ctx.seat` and the zone is the printed word, so a ref would be two thirds
      constant. A printing whose source could be the Active (Munkidori's *"1 of
      your Pokémon"*) is what would widen this to a `PokemonTarget`, and that
      printing is not reachable for a second reason anyway (below).

      **WHAT THE FAMILY COSTS BEYOND THIS OP, MEASURED RATHER THAN GUESSED**
      (remote D1, 2026-08-04, all three text columns via `json_each`, `GLOB`).
      The chosen-destination counter move is **8** Standard-legal printings over
      4 surfaces, not D206's 7 — and this op reaches 2 of them:
        • ✅ Cofagrigus sv10.5w-040/-123 "Extended Damagriiigus" (attack, 2).
        • ⏹️ Munkidori sv06-095/sv06.5-072/sv08.5-044 "Adrena-Brain" (ability, 3)
          — *"move **up to 3** damage counters"* is a THIRD decision, and a
          how-many prompt is a shape no `EffectPrompt` kind has. That is a WIRE
          change (`packages/schema` + the HUD dialog), not an engine one.
        • ⏹️ Team Rocket's Orbeetle sv10-089/-198 "Rocket Brain" (ability, 2) —
          *"**As often as you like** during your turn"* is an unbounded repeat the
          phase model has no shape for, and its destination is the controller's
          OWN board.
        • ⏹️ Alakazam sv06-082 "Strange Hacking" (attack, 1) — *"any number …
          **in any way you like**"* is a many-to-many assignment, `attachCards`'
          shape rather than this one, and both ends sit on the opponent's board.
      The three refused rows are refused on a MECHANISM each, none of which this
      op could approximate — the D138 rule (take the width the printing measures)
      pointed the other way. */
  | {
      op: "moveCountersChosen";
      /** The Bench index the counters come OFF, once the first question has been
          answered. Never authored — see the doc block above.

          ⚠️ **THE OP HAS NO `ownerPokemon` RIDER AND THAT IS A MEASUREMENT.**
          `moveCountersToDefender` grew one at D205 because a printing measured
          it; the sweep above says NO chosen-destination printing carries a
          possessive, in either scope, so a rider here would be a reading nothing
          prints — D138's own rule (take the width the printing measures), which
          this op's whole family is built on. The two ops still share the SOURCE
          candidate helper (`ownBenchRefs`), which is the part that could drift;
          `subgroupRefs` is the narrowing D205's printing bought and this one did
          not. */
      fromBench?: number;
    }
  /** Spread damage (§8.5): place `amount` HP of damage on EACH of the
      opponent's Benched Pokémon. Weakness/Resistance NEVER apply to Benched
      Pokémon, so this is flat. A SECONDARY damage clause, distinct from the
      attack's main numeric damage; the interpreter only PLACES it (one
      DAMAGE_DEALT per benched Pokémon) — the Knock Out check runs afterwards in
      the attack epilogue (attack.ts finishAttack), which sweeps the whole
      board, so the interpreter still never KOs or touches the flow tail. This
      is what the M4 KO generalization off the Active exists to reach. */
  | { op: "spreadDamage"; target: "opponentBench"; amount: number }
  /** 🆕 D319 — Put `amount` HP of damage counters on **THAT POKÉMON**: the body
      the WATCHED action was just performed on, carried as `EffectContext.subjectUid`.
      Team Rocket's Ampharos sv10-074 "Darkest Impulse" (*"…put 4 damage counters on
      that Pokémon."*) and Gengar ex sv05-104/-193 "Gnawing Curse" (*"…put 2 damage
      counters on that Pokémon."*) — one op for both, because the two sentences differ
      only in the AMOUNT and in which moment their trigger watches.

      🛑 THE PRONOUN IS WHY THIS IS NOT `damageActive` AND NOT `damageChosen`.
      `damageActive` names the opponent's ACTIVE, and the evolved / newly-attached
      body is as often Benched; `damageChosen` opens a CHOICE, and this sentence
      offers none — the referent was fixed by the opponent's own action before this
      Ability got a say. So the target is neither a spot nor a pick but a UID, which
      is also what makes it survive a Jet Energy switching the body Active between
      the attach and this op.

      A PLACED COUNTER, NOT ATTACK DAMAGE — `damageActive`'s rule verbatim: no
      Weakness/Resistance (§8.5), no reduction passive, emitted as COUNTERS_PLACED
      source "ability". Like every op it only RAISES damage and never KOs: the
      Knock Out is the CALLER's (turn.ts, through `resolveMidTurnKnockOuts`), which
      is a mid-turn KO on the ACTING seat's own board during the acting seat's turn.

      ⚠️ NO-OP WITHOUT A SUBJECT. A program that reaches this op outside a watched
      action has no `subjectUid` and whiffs SILENTLY — the same ending `sourceUid`'s
      readers take for a Trainer, and the reason the field is optional rather than a
      second required member of `EffectContext`. */
  | { op: "damageSubject"; amount: number }
  /** 🆕 D356 — HEAL `amount` HP from the body the watched action was performed
      ON — the pronoun half of `damageSubject`, for the SELF direction of the same
      sweep. Magearna `sv09-107` "Auto Heal": *"…whenever you attach an Energy
      card from your hand to 1 of your Pokémon, **heal 90 damage from that
      Pokémon**."*

      🛑 THE SEAT COMES OFF THE PRINTED POSSESSIVE, NOT OFF THE SCAN DIRECTION,
      and that is the one thing that makes this a second op rather than a `target`
      field on the first. `damageSubject` reads `otherSeat(ctx.seat)` because
      Gengar ex prints *"1 of **their** Pokémon"*; this reads `ctx.seat` because
      Magearna prints *"1 of **your** Pokémon"*. Both are watched triggers where
      `ctx.seat` is the WATCHER, so a shared "look wherever the uid is" helper
      would have made the two sentences' possessives unreadable from the op — and
      would have silently let a future *"their"* sentence heal across the table.

      CLAMPED to the damage actually present, `healSelf`'s rule verbatim: it can
      never drive damage below 0 and never heals past what is there, and a whiff —
      an undamaged subject, or an `amount` the board has no use for — is SILENT,
      emitting no HEALED row rather than a row saying nothing happened.

      ⚠️ NO-OP WITHOUT A SUBJECT, `damageSubject`'s ending verbatim. A program that
      reaches this op outside a watched action has no `subjectUid` and whiffs
      silently, which is why the field is optional on `EffectContext` rather than a
      second required member. */
  | { op: "healSubject"; amount: number }
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
  | { op: "damageDefender"; per: number; count: EffectSlot; amount?: never }
  /** 🆕 D316 — THE SAME HIT WITH A **FLAT** AMOUNT, and the second answer to the
      paragraph above rather than a second op. *"You may do {N} more damage. If you
      do, …"* (5 legal printings, `deriveAttackOptionalBoost`) is the OTHER kind of
      "an attack whose number depends on a mid-attack choice": the choice is not
      how many cards were discarded but whether the player took the boost, so there
      is no §9.2 slot to count and the amount is decided when the program is built
      — printed base, or printed base + the printed bonus.

      🛑 **A FIELD ON THIS OP AND NOT A NEW ONE, BECAUSE `programDamage` READS THE
      OP NAME.** attack.ts drops the printed base when the program owns the damage,
      and it tests `step.op === "damageDefender"`; a `damageDefenderFlat` would have
      been a second name for the same §8.5 hit that the base-suppression rule could
      not see, which is D228's asymmetry INVERTED — that op is a second hit on a
      body the main one never touched and must NOT claim the base, this one IS the
      main hit and must.

      ⚠️ **THE TWO ARMS ARE MUTUALLY UNREPRESENTABLE (`amount?: never` above,
      `per?: never`/`count?: never` here), `discardEnergy`'s idiom**: an op carrying
      both would make the interpreter pick one and ignore the other silently, and
      the union is where that is refused rather than in a runtime guard. */
  | { op: "damageDefender"; per?: never; count?: never; amount: number }
  /** D228 — a FLAT §8.5 hit on whoever is the opponent's Active **at the moment
      this op runs**: *"This attack does {N} damage to the new Active Pokémon."*
      — **8 Standard-legal printings** across five sentences, every one of them
      the SECOND clause of a sentence whose first clause promoted the body
      (`sv05-112`, `sv10-091` 30; `sv10.5b-027`/`-111` 20; `sv08-153`/`-214` 40;
      `sv06-127` 70; `sv07-096` 160 behind a printed *"If you do"*).

      🛑 **"THE NEW ACTIVE POKÉMON" NEEDS NO ADDRESSING MACHINERY, AND THAT IS THE
      WHOLE FINDING OF THE SLICE.** The backlog priced this as *"a second §8.5 hit
      against a body that is not the captured defender … the pipeline lives in
      `attack.ts` in front of the interpreter with no channel back"*, and asked
      whether the fold gets RE-ENTERED per promoted body or the interpreter gains
      an op `attack.ts` resolves. **Neither: the interpreter has re-entered that
      pipeline since D96.** `snipeActive` reads `activeTop(state, opponent)` off
      the LIVE state and runs base → attacker pre-W/R bonus → debuff → Weakness →
      Resistance → reduction → the §11 blocks → the §8.1 KO-survival clamp. An op
      that runs AFTER the promotion therefore addresses the promoted body by
      simply asking who is Active, and every modifier the printed clause is owed
      arrives for free. `damageDefender` (Hail Blade) proved the channel; this op
      is that channel with the count taken off the printed sentence instead of a
      §9.2 slot.

      ⚠️ **SO WHY NOT WIDEN `damageDefender` INSTEAD (D131's widen-don't-add
      rule)?** Because the rule's own test fails on the UPSTREAM side. Everything
      DOWNSTREAM is byte-identical — the same `snipeActive` call — but `attack.ts`
      reads the op list before the program runs and DROPS the printed base when it
      finds a `damageDefender` (`programDamage`), on the ground that Hail Blade's
      printed "60×" IS the per-unit the op deals. That is false here: this clause
      is an ADDITIONAL number on a body the main hit never touched, so a printing
      that carried both would owe both. Widening would have made the two meanings
      one word apart at a read site in another file — the exact shape D222 was
      bitten by. **All 8 printings print NO base damage at all** (measured: every
      `damage` field is absent), so no board in this pool can tell the two apart —
      which is why the branch is written from the rule rather than from what a
      test would notice (D130's precedent, verbatim).

      **NOT `damageActive`, EITHER, AND NOT A NEAR MISS.** That op PLACES damage
      counters (its own doc: *"an effect, not damage"*), which under §11 and §8.5
      is a different thing — no Weakness, no Resistance, no reduction passive, a
      `COUNTERS_PLACED` row rather than `DAMAGE_DEALT`. Grimmsnarl's 160 into a
      Weakness is 320, and a counter build would have quietly printed 160.

      🛑 **THE WHIFF IS THE PRINTED SENTENCE'S, NOT THIS OP'S — the two families
      answer differently and that difference is the `recordGate`, not a field
      here.** Grimmsnarl prints *"**If you do,** this attack does 160 damage…"*,
      so its program gates on the switch-out actually having happened; the four
      "Drag Off" sentences print NO conditional, so their damage lands on whoever
      is in the Active Spot even when an empty opponent Bench made the gust a
      no-op. Reading them as one program is the compound-eaten-as-its-first-clause
      failure this repo keeps pinning, and the two are DRIVEN apart on an
      empty-Bench board in `derivedNewActiveDamage.test.ts`. This op is the same
      op in both; what differs is what wraps it. */
  | { op: "damageNewActive"; amount: number }
  /** "Flip a coin. If heads, …" — `then` runs on the winning face only. The other
      gate is `conditionGate` (below, deterministic); both are spliced by runProgram.

      ⚠️ `onTails` FLIPS WHICH FACE WINS (D144), and it is a FIELD rather than a
      sibling op because EVERYTHING DOWNSTREAM OF THE FACE IS BYTE-IDENTICAL
      (D131's test, applied and passing). The coin is taken either way, the same
      `ATTACK_EFFECT_COIN_FLIP` row is emitted either way, the branch is spliced
      into the same work queue by the same line, and a parking op inside `then`
      parks the same. The whole difference is which `CoinFace` unshifts the branch
      — one comparison in `runProgram`, and there is no second reader of this op to
      keep in step: `attack.ts` NEVER READS IT (its coin family is
      `deriveAttackCoinFlip`'s own union — `bonusOnHeads` / `cancelOnTails` /
      `perHeads` / `programPerHeads` — read at a different site, in FRONT of the
      §8.5 pipeline, and D130's `programPerHeads` expansion lives with it there;
      the three mentions of this op in that file are comments explaining the
      disjointness). `cardplay.ts`'s `programPlayable` descends into `then` and its
      argument is FACE-AGNOSTIC by construction — exactly one branch runs, and
      D269 kept that true by making the descent read BOTH arms when `otherwise` is
      present (a two-armed gate is playable if EITHER arm is) — which is asserted
      rather than left to read (tailsGatedOp.test.ts).

      ABSENT rather than `false` on the heads form (D135's absent-field rule): the
      derived op is compared by value against hand-authored registry rows
      (`{ op: "coinFlipGate", then: [{ op: "gust" }] }` — Pokémon Catcher), and an
      explicit `onTails: undefined` key is not `toEqual`-identical to an absent one.

      An OPTIONAL field is a WIDENING (D125's distinction), so it costs no
      `MATCH_RECORD_VERSION` bump even though a gate sitting behind a parking op
      rides `EffectContinuation` into a persisted record: an old continuation
      simply lacks the key, which reads as "heads wins" and reproduces the
      pre-slice behaviour exactly.

      THE POOL'S TAILS-GATED SHAPE IS 8 PRINTINGS ACROSS 3 SENTENCES, AND SINCE
      D145 THIS OP READS ALL THREE — `FLIP_TAILS_SELF_CANT_ATTACK` (5),
      `FLIP_TAILS_SELF_DISCARD_ALL` (2) and `FLIP_TAILS_SELF_DAMAGE` (1). See the
      first for the face census and the last two for the CONSEQUENT censuses.
      **The bare tails-gated family is CLOSED**: the remaining 20 tails printings
      are refused by their SHAPE (11 are `deriveAttackCoinFlip`'s `cancelOnTails`,
      already simulated by the other reader; 4 make the OPPONENT flip on their own
      turn; 5 carry TWO consequents on one flip — `otherwise` below), and NONE of
      them is brought closer by a FACE, so the next tails printing this op can
      express is one this pool does not print.

      ⚠️ D269 — `otherwise` IS THE PRINTED "**If tails, …**", the SECOND
      consequent, and it is a different axis from `onTails` entirely: `onTails`
      picks WHICH FACE runs the one branch there is, `otherwise` adds a SECOND
      branch, and a card may want either, both or neither. `conditionGate` one
      member over has carried this exact field, name and type since M4 (Grusha's
      printed "instead"), and this is that field with a COIN for a condition
      rather than a board read — WIDEN, DON'T COPY, so the arm is one `?? []` at
      the same `unshift`, not a second op and not two sequential gates (two gates
      would take two coins and be a different card).

      🛑 IT DOES NOT CHANGE THE EVENT. The flip is taken and
      `ATTACK_EFFECT_COIN_FLIP` is emitted BEFORE either branch is consulted, so a
      two-armed gate emits exactly the one row a one-armed gate does; what the
      losing face means is the only thing that moved, from "nothing" to
      "`otherwise`, or nothing if absent". Optional, so it is a WIDENING (D125)
      and costs no `MATCH_RECORD_VERSION` bump: a persisted `EffectContinuation`
      authored before this slice simply lacks the key.

      THE 9 NON-ATTACK `%If tails%` PRINTINGS (measured 2026-08-07,
      `legal_standard = 1`, `abilities_json` + `effect`; 36 over all three text
      columns) FALL 3 / 6 ACROSS THIS FIELD. This field ALONE lands Picnicker
      `svp-114` and Drasna `sv08-173`/`-231`. The other 6 each want a SECOND
      piece and are refused here: Lucian `sv06-157`/`-208` flips PER SEAT inside
      one sentence; Harlequin `sv10.5w-083`/`-163` needs a per-seat DRAW on
      `handRefresh` (🆕 **BUILT AT D270 — `HandRefreshDraw.perSeat`, so the residue
      on this field's census is now 5 on 3 rather than 6 on 4, and this gate is what
      unblocked it: the two draw pairs are its two arms**); Team Rocket's Great Ball
      `sv10-175` needs an owner-prefixed
      Evolution/Basic `CardFilter` pair; and Team Rocket's Venture Bomb
      `sv10-179` needs a damage-counter op aimed at *"1 of your opponent's
      Pokémon"*, which the seven damage ops in this union do not include
      (`damageActive` names the Active, not a CHOSEN body). */
  /** 🆕 D355 — `coins` IS HOW MANY COINS THE SENTENCE PRINTS, and the branch runs
      when they come up UNANIMOUS on the winning face. *"**Flip 2 coins. If both
      of them are heads,** search your deck for a Basic Energy card and attach it
      to 1 of your Pokémon."* (Energy Coin `sv10.5b-081`, an Item).

      ABSENT means ONE (D104/D135's minimal shape — `coins: 1` is never spelled,
      because the one-coin sentence is printed *"Flip a coin."* and means exactly
      what the missing key means). So every gate authored before this slice reads
      identically, byte for byte, and the field is a WIDENING rather than a new
      shape.

      🛑 IT IS ONE KEY AND NOT TWO, on this repo's standing rule (`attachFromTop.
      restTo`, D335/D352): a `coins: 2` paired with a `requireAllHeads: true`
      could be set to contradict itself — `coins: 1, requireAllHeads: true` — and
      no reading of any print says what that means. The all-heads reading is not a
      MODE this field selects; it is what the two-coin sentence in these columns
      says, in every printing of it. The precedent for one key widened to carry a
      second reading is on this very op twice over (`onTails`, `otherwise`) and in
      the attach family (`attachFromTop.max: number | "any"`,
      `AttachTargetRiders.targetType: string | readonly string[]`).

      ⚠️ AND THE COMPOSITION WITH `onTails` IS A PRINTED TEMPLATE RATHER THAN A
      SPELLING ACCIDENT. `coins: 2` + `onTails: true` reads *"Flip 2 coins. If
      **both of them are tails**, …"*, which the catalog prints on THREE
      Standard-legal cards (`sv06-090`, `sv10-148`, `sv10-202`, measured over all
      three text columns 2026-08-16). All three are ATTACK text, so this op cannot
      be pointed at them today — they are out of reach by COLUMN, not because the
      sentence does not exist. The field does not legalise an outcome the pool
      does not print.

      ⚠️ THE COMPLEMENT IS DELIBERATELY NOT EXPRESSIBLE. *"If **either** of them
      is tails"* — the ANY-tails clause — is a different predicate over the same
      flips, and it is **3 printings / 0 Standard-legal** (`sv02-162`, `sv03-160`,
      `sv03.5-117`), every one of them attack or Checkup text. A second predicate
      key would be bought for nothing this pool prints (D331's speculative-field
      rule), so unanimity is the only reading and needs no selector.

      ⚠️ NO CEILING IS OWED HERE, and that is D128's own rule rather than an
      omission. `MAX_PRINTED_FLIPS = 10` bounds `deriveAttackCoinFlip`'s `printed`
      count because *"a bound is owed to the SOURCE of the number"* and those
      digits are read out of THIRD-PARTY INGESTED TEXT by a regex. `coins` is a
      hand-authored literal on a registry row — the same source as every other
      count in `registry.ts`, reviewed the same way — so a ceiling here would
      refuse nothing that can exist.

      🛑 NO `MATCH_RECORD_VERSION` BUMP, and the question was ASKED rather than
      inherited: this is D144's shape exactly. A `coinFlipGate` sitting behind a
      parking op DOES ride `EffectContinuation` into `phase.cont` and therefore
      into a persisted record — but an OPTIONAL field is a WIDENING (D125), and a
      continuation authored before this slice simply LACKS the key, which reads as
      one coin and reproduces the pre-slice behaviour exactly. */
  | { op: "coinFlipGate"; then: EffectOp[]; otherwise?: EffectOp[]; onTails?: true; coins?: number }
  // — Trainer / Ability ops (M4), controller-relative. —
  /** Draw `count` from the top of the controller's deck (short-draws when the
      deck is shallower — §14.3 deck-out is a turn-START rule only).

      🆕 **D311 — `recordAs` FILES THE CARDS THIS OP ACTUALLY DREW**, so a later
      `recordGate` can ask the printed *"if you drew any cards **in this way**"*
      (Dudunsparce `sv05-129`/`sv08.5-080` "Run Away Draw"). It is the same rider
      eleven other ops in this union already carry, on the one op whose result was
      previously invisible to §9.2.

      🛑 **AND IT IS NOT THE SAME QUESTION AS "IS THE DECK NON-EMPTY", WHICH IS WHY
      IT IS A RECORD AND NOT A `conditionGate`.** The two agree today — a draw takes
      nothing only when the deck is empty — but a board condition is evaluated
      BEFORE the draw and would answer about a deck this very op is about to
      shorten, so the equality is an accident of ordering rather than a fact about
      the sentence. The printed words are about what HAPPENED, and `recordGate`'s
      own doc block says exactly that ("the printed *in this way* / *if you do*").
      A short draw is the case that separates them from any op that draws twice. */
  | { op: "drawCards"; count: number; recordAs?: EffectSlot }
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
      this PARKS on a card choice unless the deck holds no candidate.

      ⚠️ **D225 — `reveal` IS THE PRINTED CLAUSE, AND IT IS NOT IMPLIED BY
      `dest`.** Until D225 four registry rows asserted that *"reveal it/them"*
      needs no op because "a search that ends in the hand is public by
      construction (D42)". D224 measured that and it is **false for
      `dest: "hand"` and true for `dest: "bench"`** — a benched card enters play
      face up and is in both snapshots, while a searched card that lands in the
      HAND is withheld from the opponent (`redact.ts`), the `chooseCards` prompt
      goes to the ANSWERER alone, and the only thing crossing the wire was a
      **count-only** `DECK_SEARCHED` log row. So the whole debt lived on one
      destination, and this rider pays it: set it and the log row NAMES the
      cards; leave it off and the row stays a count.

      **IT IS A PROPERTY OF THE SENTENCE, WHICH IS WHY IT IS A FIELD RATHER THAN
      A DERIVATION FROM `dest`.** Standard-legal census (remote D1, 2026-08-05,
      all three text columns via `json_each`): **100 printings / 55 distinct
      sentences** search a deck into hand, of which **15 printings / 8 sentences
      print NO reveal** — Cassiopeia ×3, Amulet of Hope, Thwackey ×2, Eldegoss,
      Scrafty, Greninja ex ×3, Noctowl, Serperior ex ×3. Naming the cards
      whenever `dest === "hand"` would make all fifteen lie, and they are the
      ones where a reveal is a REAL leak.

      ⚠️ **AND THE CORRELATION THAT IS NOT THE RULE: all 8 no-reveal sentences
      search for uncategorised *"card"/"cards"*, every revealing one names a
      category.** That is the paper rule showing through (you reveal so the
      opponent can verify the card was a legal find; when anything is legal there
      is nothing to verify) — but it is a fact about today's 55 sentences, not
      about the next one, and deriving `reveal` from "the filter is narrow" would
      be inferring one printed clause from a different printed clause. Authored
      per row, from the bytes.

      ABSENT rather than `false` when the print carries no reveal (D135's rule) —
      these ops are compared by value against hand-authored rows, and an explicit
      `false` would make two spellings of the same program unequal. */
  | {
      op: "searchDeck";
      filter: CardFilter;
      /** 🆕 **D342 — `"deckTop"` IS THE THIRD DESTINATION, AND IT IS A PURE
          DESTINATION: the picks are put back on TOP of the deck they came out
          of, in the order the answer names them.** Ciphermaniac's Codebreaking
          `sv05-145`/`-198`/`sv08.5-104` (Supporter, 3 legal) and Dialga
          `sv08-135` "Time Manipulation" (1 legal) — *"Search your deck for 2
          cards, shuffle your deck, then put those cards on top of it in any
          order."* — **4 legal printings, ONE byte-identical sentence, TWO
          columns.**

          🛑 **THE SHUFFLE IS *NOT* IN HERE, AND KEEPING IT OUT IS THE WHOLE
          DESIGN.** The print reads search → shuffle → place, so the shuffle
          falls BETWEEN the removal and the placement and cannot be the usual
          trailing `{ op: "shuffleDeck" }`. Both readers therefore emit it
          **FIRST**, ahead of the park — which is not a re-ordering of the
          sentence but a proof about it: this search's answer is a SET of cards
          and never a set of POSITIONS, so `shuffle(deck) minus picks` and
          `shuffle(deck minus picks)` are the same distribution (a uniform
          permutation restricted to a subset is uniform on that subset). Folding
          the shuffle into this member instead would buy the identical board and
          cost the day a card prints *"…then put those cards on top of it"* with
          no shuffle at all: a destination that also shuffles cannot spell it.

          ⚠️ **AND IT IS A `dest` RATHER THAN A NEW OP, WHICH IS THE PRICE
          DIFFERENCE THE ROW TURNED ON.** The ordering half is `reorderTop`
          (D341), already shipped; the only thing a `searchDeckToTop` op would
          add over this is a second row in every op-keyed auditor table in the
          repo. The CHANNEL from the search's answer to the ordering prompt is
          **the deck itself** — once the picks are on top, `reorderTop { n }`'s
          candidates are `deck.slice(0, n)`, which ARE the picked cards by
          construction. Nothing has to be carried across the park, so this row
          needs no `continuationOps` member and no new prompt.

          🛑 **AND IT IS WHY `exact` BELOW IS A CORRECTNESS FIELD.** See there. */
      dest: "bench" | "hand" | "deckTop";
      max: number;
      /** 🆕 **D342 — THE PRINTED TAKE WITH NO *"up to"*, `lookAtTopN.exact`
          (D334) one op over and the same field name deliberately.** Absent on
          every producer before this row, where the search is the standing
          declinable *"up to"* and the park is `min: 0`.

          🛑 **ON THE `"deckTop"` ROW IT IS NOT A CAPTION FIX, IT IS THE THING
          THAT KEEPS THE SECOND PARK HONEST.** The two ops are coupled through
          the deck: `reorderTop { n: 2 }` orders whatever the top two cards ARE.
          Left declinable, a player who takes 1 of the 2 — or declines outright
          — is then handed an ordering window containing a card they never
          searched for and were never shown, which is an information gain and a
          re-ordering the print does not grant. With the floor set, the window
          is exactly the picks; and a deck too short to fill it collapses on
          `reorderTop`'s own `top.length < 2` guard rather than here, which is
          why the floor is clamped to the candidate count and not to `max`.

          ⚠️ **AND THE PRINT AGREES WITH THE CORRECTNESS ARGUMENT** — *"Search
          your deck for **2 cards**"* prints no *"up to"* and no *"you may"*,
          exactly like Explorer's Guidance's *"put **2 of them** into your
          hand"*. The field is therefore authored from the bytes and merely
          happens to also be load-bearing, which is the order D334 wrote it in.

          ABSENT rather than `false` (D135) — these ops are compared by value. */
      exact?: true;
      /** The printed *"reveal it/them"* — the found cards are named in the log
          (`DECK_SEARCHED`). Only meaningful with `dest: "hand"`; a bench search
          is public without it, and no printed bench search carries the word. */
      reveal?: true;
      /** 🆕 **D336 — THE THREE- AND FOUR-NOUN SEARCH.** Larry's Skill
          `sv08.5-115`/`-139` (Supporter, 2 legal): *"Discard your hand and search
          your deck for **a Pokémon, a Supporter card, and a Basic Energy card**,
          reveal them, and put them into your hand. Then, shuffle your deck."* —
          and Secret Box `sv06-163` (Item, 1 legal) with FOUR: *"an Item card, a
          Pokémon Tool card, a Supporter card, and a Stadium card"*.

          🛑 **IT IS A LIST WHERE `lookAtTopN.also` IS A SINGLE PAIR, AND THE
          CENSUS IS THE WHOLE REASON.** D332 gave the sibling op an arity-EXACTLY-2
          `also` under D331's rule (ship the arity the printing spells), and D333's
          note there predicted this slice would want a list. Re-measured at this
          head against remote D1 `luminous` (2026-08-14), the multi-noun
          `searchDeck` conjunction is **8 printings / 3 legal** — the query is
          `instr(col,'earch your deck for') > 0 AND instr(col,' and a ') > 0` over
          all three text columns, which is the WIDENED form of the resume point's
          `instr(col,', and a ') > 0` and finds five printings that literal cannot
          see:

          | arity | printings | legal | cards |
          |---|---|---|---|
          | 2 | 5 | **0** | Arven `sv01-166`/`-235`/`-249`, `sv03-186`, `sv04.5-235` |
          | 3 | 2 | 2 | Larry's Skill `sv08.5-115`/`-139` |
          | 4 | 1 | 1 | Secret Box `sv06-163` |

          `5 + 2 + 1 = 8` and `0 + 2 + 1 = 3` ✅. **So the arity axis starts at TWO
          and its 2 is OUT OF STANDARD** — Arven is measured and deliberately NOT
          built, D187's rule that a registry row is keyed by card id and legality
          is a hard filter on it. A field spelled as a second `also` object, or as
          a fixed triple, would be the D331 shape upside-down: it would refuse the
          FOUR the catalog actually prints in Standard.

          🛑 **AND IT IS A NEW AXIS RATHER THAN A VALUE OF AN EXISTING KEY**, which
          is the test D335 made standing. It is not a value of `filter`: `anyOf`
          (D245) yields this candidate set for free and has since before any of
          this, and it buys exactly ONE flat cap. It is not a value of `max`:
          `max` is a `number` and a DISTRIBUTION over kinds is not a number — under
          a flat `max: 3` a client answers Larry's Skill with three Pokémon and the
          printed conjunction is gone, because `validateChoice` (cardplay.ts)
          enforces one flat total shared by all six `chooseCards` producers. The
          new dimension is *how the take is split across the nouns*, and the first
          group stays `filter` + `max` so no existing row moves.

          ⚠️ **THE PROMPT HALF REALLY WAS FREE AND THE CAPTION HALF REALLY WAS NOT.**
          `chooseCards.caps` is `readonly {uids; max}[]` (D332) and both readers of
          it are arity-blind — `validateChoice`'s `for (const cap of prompt.caps ??
          [])` and `GameHud`'s `cappedOut` — so a third and a fourth group cost
          them nothing, and `packages/schema` gains no key. But `searchNote`
          (interpreter.ts) took ONE filter and ONE number and had **no join at
          all**, where `lookNote` was given its two-noun join at D332. The op field
          feeds a PREDICATE and a STRING, and D334's rule is that such a field owes
          BOTH arms: without the caption Larry's Skill's dialog would have read
          *"Search your deck for up to 3 Pokémon into your hand."* — the flat total
          against the FIRST group's noun, with the printed conjunction deleted.
          **AND THE SERIAL COMMA IS ITS OWN CLAUSE**: `lookNote`'s join is `A and
          B`, which cannot spell `A, B, and C`.

          ⚠️ **THE GROUPS MAY OVERLAP AND THE CAP RULE IS THE CONSERVATIVE ONE**,
          `lookAtTopN.also`'s rule transferred rather than re-decided: a uid
          matching two filters counts against BOTH caps. Every printed group here
          is disjoint by construction (a Pokémon is not a Supporter card is not a
          Basic Energy card; an Item is not a Tool is not a Supporter is not a
          Stadium), so no printed board can tell the readings apart — the
          conservative one is chosen because it can only refuse an answer the print
          did not promise, never admit one it did not.

          ⚠️ **`MATCH_RECORD_VERSION` DOES NOT MOVE FOR THIS.** `searchDeck` parks,
          so its literal is persisted inside `EffectContinuation.pendingOp`; but an
          old record carries NO `also`, this build reads that as `undefined`, and
          `undefined` is the single-group search those records already meant. That
          is D125's test — *"would an old record MEAN something else"* — answered
          NO, exactly as D333's widened `max` and D334's added optional `exact`
          answered it on the sibling op, and unlike D335's RENAME, which had to
          bump because a v19 `discardRest: true` kept its type and lost its
          meaning. */
      also?: readonly { filter: CardFilter; max: number }[];
    }
  /** 🆕 **D307 — "Search your deck for a card that evolves from this Pokémon and
      put it onto this Pokémon to evolve it. Then, shuffle your deck."** The
      EVOLVE-FROM-DECK family: Eevee `sv06-135`/`-188` "Ascension", Dwebble
      `sv10-011` "Ascension", Team Rocket's Pupitar `sv10-095` "Explosive
      Ascension" (Stage 1, `damage: 30`) and — behind D282's gate split — Exeggcute
      `sv08-001`/`-192` "Precocious Evolution". **6 legal printings on 4 cards and
      ONE effect string**, re-queried against remote D1 `luminous` on 2026-08-09
      (`instr(attacks_json,'that evolves from this') > 0`, whole column read, every
      arm): 4 on the bare sentence, 2 on the licensed one, plus 4 rows at
      `legal_standard = 0` (Glimmet `sv02-124`/`sv04.5-179`, and Finizen
      `sv03-060`/`sv04.5-123`, whose *"Switch this Pokémon … If you do, search…"*
      is a COMPOUND this anchor must and does refuse).

      🛑 **IT IS ITS OWN OP RATHER THAN A `searchDeck` `dest`, AND THAT IS THE
      DECISION THE SLICE TURNED ON.** Every `searchDeck` names a ZONE and takes a
      `CardFilter`; this sentence names an in-play BODY — *the same body running
      the program* — and its candidate set is not expressible as a filter at any
      width, because `matchesFilter` never sees the board. The predicate is
      "`evolveFromOf(card)` equals the NAME of `sourceRef`'s top card", which is
      `evolve`'s own §10 match (turn.ts) asked of the deck instead of the hand. So
      the op carries **NO FIELDS AT ALL**: the printed sentence has no number, no
      noun and no rider, and all four cards print it identically.

      🛑 **THE PLACEMENT IS `placeEvolution`'s BODY WITHOUT ITS TWO TAILS, AND THE
      TAILS ARE THE WHOLE PRICE THIS ROW WAS REFUSED FOR (D306).** `stepOp` hands
      back a bare `GameState` or a prompt, so an op cannot return a phase — and
      `placeEvolution` ends in `resolveMidTurnKnockOuts` (seeds `pending`,
      → `ko:takePrizes`) or `runBoardTrigger(…,"onEvolve",…)` (→ `effect:choose`).
      Both are answered rather than channelled:

        • **THE TRIGGER TAIL IS UNREACHABLE FROM A DECK-SOURCED PLACEMENT, WHICH
          IS A CATALOG FACT AND NOT A SIMPLIFICATION.** Every printed on-evolve
          Ability says *"When you play this Pokémon **from your hand** to evolve…"*
          — all EIGHT `onEvolve` rows in `registry.ts`, and over the whole legal
          catalog the query `instr(abilities_json,'to evolve') > 0 AND
          instr(abilities_json,'from your hand to evolve') = 0` returns exactly
          TWO rows, NEITHER of them a trigger: Pidove `sv05-133` (this same
          placement printed as an on-demand Ability) and Team Rocket's Ampharos
          `sv10-074` (the OPPONENT's evolve). A card that never was in hand did not
          satisfy the printed antecedent, so `turn.ts evolveOnto` is called
          WITHOUT the trigger — the source zone, not a park inside a park.
        • **THE KO TAIL IS SWEPT BY THE ATTACK EPILOGUE.** §8.1 `finishAttack`
          (flow.ts) sweeps BOTH boards, the ATTACKER's own Active included, and the
          only op this program runs after the placement is the trailing
          `shuffleDeck`. So an evolution that LOWERS effective max HP (a Bravery
          Charm's Basic-only +50 dropping off) Knocks the attacker out at the end
          of its own attack, prizes to the defender. **DRIVEN on a board where the
          evolve is lethal AND the attack continues**, which is the doubt D306
          flagged against its own claim.

      "Up to" like every pile-scanning op: it PARKS at `min: 0` whenever ≥1
      candidate, so declining is a legal answer and the trailing `shuffleDeck`
      fires on the decline and on the whiff alike. `max` is 1 — the printed
      article, `ATTACK_DRAW`'s reading — and the prompt's `dest` is the new
      `"evolve"` member, because *"onto this Pokémon"* is not a zone and a client
      told `"bench"` would name the wrong place in its own words.

      🆕 ⚠️ **D308 — ONE OPTIONAL FIELD, AND IT IS THE ONLY THING THE ITERATED
      SENTENCE NEEDED.** The field names a body to evolve INSTEAD of the body
      running the program. Absent (every D307 printing) the subject is
      `ctx.sourceUid` exactly as before. ⚠️ **NO PRINTED SENTENCE AUTHORS IT
      DIRECTLY** — only the two ops below write it, which is why the deriver arm
      for the bare sentence still emits `{ op: "evolveFromDeck" }` with nothing in
      it.

      🆕 🛑 **D309 — THE FIELD WAS `ontoBench?: number` AND IS NOW
      `onto?: PokemonTarget`. THE REVERSAL IS DELIBERATE AND IS RECORDED RATHER
      THAN MADE QUIETLY** (`conventions.md`: *don't reverse one silently*). D308
      chose a bench INDEX and gave a good reason — *"For each of your **Benched**
      Pokémon"*, so *an op field spells what the catalog spells*, and
      `moveCountersChosen.fromBench`'s shape verbatim. What changed is that a
      SECOND printed sentence now writes the same field: Duosion `sv10.5b-038`/
      `-119` says *"a card that evolves from **1 of your Pokémon**"*, and the
      Active qualifies. **The union of what the two sentences spell IS a target**,
      and `moveCountersChosen`'s own doc block predicted this exact widening one
      op over (*"a printing whose source could be the Active … is what would widen
      this to a `PokemonTarget`"*). The bench case loses nothing — it is
      `{ spot: "bench", index }` — and the alternative, a second optional field
      beside the first, is two spellings of one thing and four states of which one
      is nonsense (D222's closed-world lesson). 🛑 **AND THE RENAME IS NOT
      PERSISTED-SAFE: `MATCH_RECORD_VERSION` MOVES 17 → 18 FOR IT.** `pendingOp`
      and `cont.rest` ride `GameState.phase` into the match record, so this is
      exactly the class of change D125's condition is about — and unlike D307's
      and D308's it comes out a BUMP rather than a SKIP. **D308's engine is
      `0.214.0`, its own released minor**, it authors `{ op: "evolveFromDeck",
      ontoBench: n }` at version 17, and this deploy reads that key as nothing:
      `onto` is `undefined`, the offer falls back to `sourceRef`, and the
      ATTACKER is evolved instead of the named benched body. A RENAME is the one
      shape that is not a widening — an older record can hold the OLD spelling,
      which is the direction the constant exists to gate. Driven both ways in
      `evolveBodyChoice.test.ts` §5. ⚠️ An earlier draft of this block argued the
      SKIP on the premise that both ops *"landed in the same unreleased engine
      minor"*; they did not — D308 bumped `0.213.0 → 0.214.0` in its own
      `feat(engine)` commit, so 0.214.0 IS a deploy and D309 is 0.215.0. The
      premise was checkable off `git log -- packages/engine/package.json` and was
      never checked.

      🆕 🛑 **D310 — `names` IS NOT A NARROWING OF THE CANDIDATE SET. IT REPLACES
      THE PREDICATE, AND ANY OTHER READING MAKES THE CARD UNPLAYABLE FOREVER.**
      Pidove `sv05-133` "Emergency Evolution" prints *"search your deck for an
      Unfezant or Unfezant ex and put it onto this Pidove to evolve it"*. The
      standing predicate is `evolveFromOf(card) === <this body's top card>.name` —
      §10's own chain match, asked of the deck (D307). For a **Pidove** body that
      set is **Tranquill**. The card the sentence NAMES is **Unfezant**, whose
      `evolve_from` is **`Tranquill`** and not `Pidove` — measured against remote
      D1 `luminous` on 2026-08-10: all four `Unfezant` printings are `Stage2`
      evolving from `Tranquill`, and `sv05-133` is a `Basic`. **So the intersection
      of the chain predicate and the printed name is EMPTY ON EVERY BOARD THAT WILL
      EVER EXIST.** A `names` filter ANDed onto the chain is the exact defect
      `conventions.md` names in the abstract — *"a predicate over a banner no column
      CLASSIFIES yields a permanently empty candidate set, which `programPlayable`
      turns into a card that can never be played"* (D207) — reached here from the
      opposite direction, since both halves are individually right.

      ⚠️ **WHAT THE PRINT IS ACTUALLY LICENSING IS A SKIPPED STAGE — RARE CANDY'S
      SHAPE, ON AN ABILITY.** The sentence puts a **Stage 2 straight onto a Basic**,
      and it may do that because the printed sentence, not §10's chain, is the
      authority for this placement. `evolveOnto` already imposes no chain check of
      its own (it appends to the stack and sheds §10's effects), so nothing else
      has to move. **PRESENT ⇒ the candidate set is the NAME SET; ABSENT ⇒ the
      chain.** The two are alternatives and never conjuncts, which is why this is
      one branch and not a second `filter` call.

      ⚠️ **AND ONE OF THE TWO NAMES HAS ZERO PRINTINGS IN THE ENTIRE CATALOG.**
      `instr(name,'Unfezant') > 0` over all 3,786 rows returns four `Unfezant` and
      **no `Unfezant ex` at all**. Both names are carried anyway, because a
      registry row is an EXACT MAP of the print (D190b) and transcribing beats
      interpolating (D306): the unreachable half costs nothing, and the day the
      catalog gains an `Unfezant ex` the row is already right. **A name in this
      array is a claim about the CARD, never about the catalog.**

      🛑 **AND IT IS A WIDENING, SO `MATCH_RECORD_VERSION` DOES NOT MOVE FOR IT.**
      Classify before copying either paragraph (D309's rule): this is a new
      OPTIONAL field, not a rename and not a re-key. A version-18 deploy authors
      `{ op: "evolveFromDeck", onto }` with no `names` and cannot author one; this
      deploy reads `names === undefined` and takes the chain predicate, which is
      **exactly what that record meant**. The inversion that forced D309's bump —
      an older record holding an older SPELLING — has no instance here. **18
      stays 18**, and the skip is a classification rather than a copied formula. */
  | { op: "evolveFromDeck"; onto?: PokemonTarget; names?: readonly string[] }
  /** 🆕 **D308 — "For each of your Benched Pokémon, search your deck for a card
      that evolves from that Pokémon and put it onto that Pokémon to evolve it.
      Then, shuffle your deck."** **4 legal printings on 2 cards and ONE effect
      string**, re-queried against remote D1 `luminous` on 2026-08-09
      (`instr(attacks_json,'deck for a card that evolves') > 0 AND
      legal_standard = 1`, whole column read, every arm): Vivillon `sv08-007`/
      `-193` "Evo-Powder" (Stage 2, second attack "Cutting Wind" {G} `damage: 90`)
      and Reuniclus `sv10.5b-039`/`svp-212` "Cellular Ascension" (Stage 2, second
      attack "Evo-Lariat" `damage "40+"`). The two cards print the sentence
      BYTE-IDENTICALLY, which is why one corpus record carries all 4 units.

      🛑 **IT NEEDS NO PARK OF ITS OWN, AND THAT IS THE FINDING RATHER THAN A
      SHORTCUT.** D307 priced this remainder as *"a body-CHOICE stage in front of
      the card choice — a second park on an op that already parks once"*. That is
      true of the Duosion sentence and FALSE of this one: *"for each"* is not a
      choice, so this op asks nothing at all. It resolves synchronously to
      **D216's `schedule`** — one `{ op: "evolveFromDeck", ontoBench }` per
      occupied bench slot — and `runProgram` unshifts them onto the queue, where
      each parks in turn like any other op. **A PROGRAM has parked many times
      since D186** (Koraidon "Dino Cry"); what cannot happen is ONE op parking
      twice, and no op here does.

      ⚠️ **THE INDICES ARE TAKEN ONCE, UP FRONT, AND THE STALE ONES FALL OUT
      SILENTLY.** Each scheduled op re-reads the bench when IT runs, and
      `evolveFromDeckOffer` already returns `undefined` for a body that is no
      longer there — a "this Pokémon" op's standing answer. So a Bench that
      changes mid-program (it cannot today: the placement evolves in place and
      §8.1 sweeps KOs after the attack) degrades to a no-op on that slot rather
      than to a mis-aimed placement.

      ⚠️ **THE TRAILING SHUFFLE IS ONE, NOT N.** The printed *"Then, shuffle your
      deck."* is a single sentence after the whole iteration, and `schedule`
      unshifts AHEAD of the remaining queue, so the deriver's trailing
      `shuffleDeck` runs after every placement — which is also why it is not part
      of what this op schedules.

      NO FIELDS: the printed sentence has no number, no noun and no rider, and
      the subject *"your Benched Pokémon"* is the whole Bench. */
  | { op: "evolveFromDeckEachBenched" }
  /** 🆕 **D309 — "Search your deck for a card that evolves from 1 of your Pokémon
      and put it onto that Pokémon to evolve it. Then, shuffle your deck."**
      **2 legal printings on ONE card and ONE effect string**, re-queried against
      remote D1 `luminous` on 2026-08-09 (`instr(attacks_json,'evolves from 1 of
      your') > 0`, whole column read, every arm): Duosion `sv10.5b-038`/`-119`
      "Cellular Evolution" ({C}, no damage; second attack "Spray Fluid" {C}
      `damage: 30`). ⚠️ A THIRD printing of the identical sentence is
      `legal_standard = 0` — Indeedee `sv01-153` "Expert Nurturer" — so this arm
      buys 2 units today and 3 the day that set rotates back, which is
      `conventions.md`'s *an arm transfers across sets* with a witness.

      🛑 **THIS IS THE ONE THAT REALLY DOES NEED THE SECOND PARK, AND SAYING SO IS
      D308's FINDING HOLDING RATHER THAN FAILING.** *"For each"* is not a choice
      and needed nothing; *"1 of your Pokémon"* IS a choice, so this sentence asks
      a question BEFORE the card question. One op gets one park (the standing
      statement of the blocker, D216), so the body question and the card question
      are two ops — and the channel from the first answer to the second is
      `continuationOps`, which gains its **THIRD** member here after `optional`
      (D186) and `moveCountersChosen` (D216).

      **NO FIELDS, AND THAT IS THE DIFFERENCE FROM `moveCountersChosen`.** D216
      carried its first answer on the op ITSELF (`fromBench`) because the same op
      asks the second question. Here the second question is a DIFFERENT op that
      already exists and already parks — `evolveFromDeck` — so the answer is
      carried on THAT op's `onto`, and this one is a pure asker: it holds nothing,
      files nothing and moves nothing. `applyChoice`'s arm for it returns the state
      untouched, which is the honest spelling of *"the answer buys an op"*.

      ⚠️ **THE CANDIDATE SET IS NARROWED TO BODIES WITH A MATCHING DECK CARD, AND
      THAT IS THE SLICE'S REAL WORK.** *"1 of your Pokémon"* is the whole own board
      (Active included — the printed word is not *"Benched"*), but a body with no
      evolution in the deck is a choice that whiffs: the player spends the only
      decision the sentence offers and gets nothing. `attachFromTopOffer`'s doc
      makes the same argument one file over. ⚠️ **`programPlayable` IS NOT THE
      PLACE FOR IT** — it never reads the deck, so the ALL-WHIFF board is a legal
      declaration that resolves to nothing (the silent ending `searchDeck` and
      `evolveFromDeck` both already take) and the trailing `shuffleDeck` still
      fires.

      ⚠️ **A SINGLE ELIGIBLE BODY IS FORCED, NOT PROMPTED** (M1's no-choice
      doctrine): the op schedules the rewritten `evolveFromDeck` inline through
      D216's `schedule` rather than raising a prompt with one candidate — the same
      two endings on one question `moveCountersChosen` has, through the SAME
      helper, so a board of one and a board of two resolve the printed sentence
      identically. It is deliberately NOT `parkOrForce`: that helper's forced arm
      applies a `(ref) => GameState`, which is exactly the shape that cannot ask a
      second question. */
  | { op: "evolveFromDeckChosen" }
  /** 🆕 **D315 — "Choose up to 2 of your {D} Pokémon. For each of those Pokémon,
      search your deck for a card that evolves from that Pokémon and put it onto
      that Pokémon to evolve it. Then, shuffle your deck."** **ONE legal printing
      on ONE card and ONE effect string**, queried against remote D1 `luminous` on
      2026-08-10 (`instr(<col>,'For each of those') > 0` over all three text
      columns, whole column read, every arm): Team Rocket's Nidorina `sv10-115`
      "Dark Awakening" ({D}, no damage; second attack "Scratch" {D}{D}
      `damage: 50`). It is the family's FIFTH and LAST sentence and it CLOSES the
      evolve-from-deck row at 5 of 5 / 13 of 13 legal printings.

      🛑 **THE SENTENCE IS D308's ITERATION WITH A CHOICE IN FRONT OF IT, AND THAT
      IS WHY IT IS ONE OP AND NOT TWO.** *"For each of those Pokémon"* is
      `evolveFromDeckEachBenched`'s verb over a **CHOSEN** list rather than over
      the Bench, so the only thing this op does that its sibling does not is ASK
      which bodies. One op gets one park (D216's blocker), the park is that
      question, and the answer buys the same `{ op: "evolveFromDeck", onto }` per
      body that D308 schedules and D309 hands over — **`continuationOps` gains its
      FOURTH member, and it is the FIRST whose answer buys `N` ops rather than
      one.**

      🛑 **AND IT IS THE FIRST MEMBER OF THAT SEAM TO ANSWER A `pokemonMulti`.**
      `optional` (D186) answers a `confirm`, `moveCountersChosen` (D216) and
      `evolveFromDeckChosen` (D309) each answer a single `pokemon`. Every existing
      `choosePokemonMulti` answer in this engine — `damageChosen`, `healChosen`'s
      `upTo` arm — is applied in `applyChoice` and buys BOARD CHANGES. This one
      buys OPS, which `applyChoice` cannot reach; its arm there returns the state
      untouched, D309's honest spelling of *"the answer buys an op"*.

      🛑 **NO FORCED-SINGLE AUTO-RESOLVE, AND THE REASON IS THE PRINTED ARTICLE
      RATHER THAN THE CANDIDATE COUNT.** `evolveFromDeckChosen` forces a board of
      one because *"1 of your Pokémon"* is MANDATORY: with one eligible body there
      is no decision left to take. *"Choose **up to** 2"* keeps a decision on every
      board — taking fewer, including NONE, is a printed answer — so this op parks
      whenever ≥1 candidate exists, exactly as `searchDeck` and `healChosen.upTo`
      do. ⚠️ **THE TWO OPS DIFFER ON THIS FIELD FOR A REASON THAT IS ABOUT THE
      PRINT, NOT ABOUT HOUSE STYLE**, and a reading that forced the single here
      would silently delete the decline.

      **TWO FIELDS, AND THEY ARE THE TWO THINGS THE SENTENCE SPELLS THAT ITS THREE
      SIBLINGS DO NOT.** `max` is the printed *"up to 2"* — clamped to the
      candidate count when the board is smaller (§8.6, `healChosen.upTo`'s rule) —
      and `pokemonType` is the printed `{D}`. Both are REQUIRED rather than
      optional: the pool prints exactly one sentence here and it carries both, so
      an absent field would be a state no card can author (D104's minimal shape,
      and D222's closed-world lesson about union members nobody spells).

      ⚠️ **THE CANDIDATE SET IS THREE PREDICATES AT ONCE — OWN BOARD, TYPED, AND
      DECK-NARROWED — AND ONLY THE TYPE HALF IS NEW.** D309 established the
      deck-narrowing (*a body with no evolution in the deck spends the only
      decision the sentence offers on a guaranteed whiff*), and the typed own-board
      read already exists twice over in `attachEnergyTargets`' and
      `switchBenchNarrowing`'s `targetType` riders. `evolvableOwnRefs`
      (interpreter.ts) is the ONE builder both this op and `evolveFromDeckChosen`
      now ask, so the two can never disagree about who is eligible.

      ⚠️ **THE TYPE IS ASKED OF THE TOP CARD AND ADMITS A DUAL TYPE**, through
      `matchesFilter`'s `typedPokemon` arm — the membership rule stated once in
      `cards.ts` that every brace-coded noun in this engine asks (`switchActive`'s
      own rider states it in full).

      **NO `programPlayable` GATE**, for D309's reason verbatim: the narrowing
      reads the DECK and `programPlayable` never does, so an all-whiff board is a
      legal declaration that resolves to nothing and the trailing `shuffleDeck`
      still fires. */
  | { op: "evolveFromDeckEachChosen"; max: number; pokemonType: PokemonType }
  /** Switch the controller's Active with one of their Benched Pokémon (§G).
      PARKS on the bench choice unless exactly one is benched.

      ⚠️ **D206 — THE TWO RIDERS ARE THE TWO HALVES OF "SWITCH … . IF YOU DO, …",
      AND NEITHER IS NEW VOCABULARY.** The catalog prints that sentence on five
      Standard-legal TRAINERS and two attacks; three of the Trainer printings put
      an owner-prefixed subgroup on BOTH ends of the switch. `ownerPokemon` is
      D200's predicate at its FOURTH read site (deck search → attach target →
      counter-move source → here) and `recordAs` is §9.2's existing slot at a new
      op: no slot name, no gate and no prompt kind is invented.

      `ownerPokemon` NARROWS BOTH ENDS WITH ONE FIELD, because the printing spells
      one owner twice: *"Switch your Active **Team Rocket's** Pokémon with 1 of
      your Benched **Team Rocket's** Pokémon"* (Team Rocket's Giovanni
      `sv10-174/-225/-238`). A board whose Active is not in the subgroup has no
      "your Active <owner>'s Pokémon" to switch, so the whole op is a no-op there
      — the candidate set is emptied rather than the Active being swapped out of
      turn, which is `parkOrForce`'s existing silent ending. Taking it at ONE
      field is D138's rule (take the width the printing measures): no printed card
      narrows the two ends differently, and a card that did would be asking for
      two fields, not for this one read twice.

      ⚠️ **A SECOND NARROWING AXIS EXISTS AND THIS FIELD IS NOT IT.** Vikavolt
      `sv07-053` "Volt Switch" prints *"1 of your Benched **{L}** Pokémon"* — an
      ENERGY-TYPE subgroup, on the attack surface, which `ownerPokemon` must
      refuse rather than approximate (asserted in `switchSeam.test.ts`).

      `recordAs` files the uid of the Pokémon that ACTUALLY BECAME ACTIVE, and
      files `[]` when the switch did not happen — which is exactly what the
      printed *"If you do"* asks, so `recordGate` needs no arm. The empty filing
      matters more here than on the ops that already record: `switchInto` returns
      the state UNCHANGED on a board it refuses (no Active, an empty subgroup, a
      bench index that is not there), and a slot filled from the CHOSEN ref rather
      than from the RESULT would let Giovanni's gust fire off a switch that never
      occurred — the "half of a printed action" failure `moveCountersToDefender`'s
      doc names on the other side of the engine.

      ⚠️ **D244 — `fromSource` PINS THE BENCH END TO THE BODY THE SENTENCE IS
      PRINTED ON, AND IT IS THE FIRST THING ON THIS OP THAT IS NOT A CANDIDATE
      NARROWING.** `ownerPokemon` shrinks a set the player still picks from; this
      REPLACES the pick, because the printed subject is a pronoun and not a
      choice: Iron Leaves ex's *"you may switch **it** with your Active Pokémon"*
      (`svp-128`/`sv05-025`/`-186`/`-203`/`-213`/`sv08.5-176`, **6 legal**) and
      Meowscarada `sv09-018`'s *"if this Pokémon is on your Bench, you may switch
      **it** with your Active Pokémon"* (**1 legal**) both name ONE body — the one
      that just arrived on the Bench, and the one whose Ability is being used.
      Resolved through `sourceRef` (the `ctx.sourceUid` question every other
      "this Pokémon" op asks), so the candidate list is at most one entry and
      `parkOrForce` forces it: no prompt, because there was never a choice.

      ⚠️ **AND THE PRINTED *"if this Pokémon is on your Bench"* COSTS NOTHING,
      WHICH IS A CLAIM RATHER THAN AN OMISSION.** `sourceRef` answers with the
      body's CURRENT spot, and `switchActiveTargets` keeps only BENCH refs — a
      Pokémon may not switch with itself — so a source sitting in the Active Spot
      empties the candidate set and `programPlayable` refuses the activation. The
      gate and the printed clause are the same test, which is why Meowscarada
      needs no benched-only flag beside `activeOnly`. ⚠️ That refusal is the
      reason `switchActiveTargets` grew a `sourceUid` parameter: without it the
      gate would answer about the wrong Pokémon (D222's rule at a second op).

      ⚠️ **NOT COMBINABLE WITH `ownerPokemon` IN ANY PRINTED SENTENCE**, and the
      combination is representable rather than blocked — the `anySource`-on-the-
      free-route precedent. A pronoun is already the narrowest possible subject,
      so an owner prefix on top of it would narrow a one-element set. */
  | {
      op: "switchActive";
      ownerPokemon?: string;
      /** 🆕 **D273 — THE SECOND NARROWING AXIS, WHICH THIS OP'S OWN DOC NAMED
          THREE SLICES BEFORE IT WAS BUILT.** The note above still reads *"A
          SECOND NARROWING AXIS EXISTS AND THIS FIELD IS NOT IT … an ENERGY-TYPE
          subgroup, which `ownerPokemon` must refuse rather than approximate"*.
          Pecharunt ex `sv06.5-039`/`-085`/`-093`/`-095`/`sv08.5-163` prints it on
          the ABILITY surface — *"switch 1 of your Benched **{D}** Pokémon … with
          your Active Pokémon"*, **5 Standard-legal printings on ONE sentence** —
          so the axis is now a card rather than a hypothetical.

          ⚠️ **A `PokemonType`, NOT A `BasicEnergyType`, AND IT ROUTES THROUGH
          `matchesFilter`.** `switchActiveTargets` asks `typedPokemon` (D238) —
          the same membership test over the card's `types` ARRAY that every other
          brace-coded noun in this engine asks — rather than a fresh `=== type`
          comparison that would silently drop dual-type bodies.

          ⚠️ **IT NARROWS THE BENCH END ONLY, WHERE `ownerPokemon` NARROWS BOTH.**
          The printed sentence puts the type on the destination noun and leaves
          the Active unqualified ("with your Active Pokémon"), which is the exact
          opposite of Giovanni's *"Switch your Active Team Rocket's Pokémon"* —
          so reading this one at both ends would empty the candidate set on every
          board whose Active is not `{D}`, refusing a switch the card offers. */
      targetType?: PokemonType;
      /** 🆕 **D273 — THE PRINTED EXCLUSION BY NAME**: *"1 of your Benched {D}
          Pokémon, **except any Pecharunt ex**"*. A negated exact-case read of
          `Card.name`, the same field `ownerPokemon`'s prefix test reads.

          🛑 **IT IS A RIDER AND NOT A `CardFilter` MEMBER, AND THAT WAS PRICED
          RATHER THAN ASSUMED.** A `notNamed` filter member is the tidier-looking
          answer and it costs an arm in `retrieveNoun` that NO printing drives —
          "a card not named Pecharunt ex" is not a search noun and never will be,
          and this repo's own rule for that exhaustive switch is *"grow it one
          case per card"*. It would also need `allOf`, because the printed noun is
          an INTERSECTION (`{D}` AND not-Pecharunt-ex) and the union's only
          combinator is `anyOf`. Two union members and a dead caption arm, to say
          what one string field says. **The riders on this op are the house shape
          for a BOARD narrowing** — `attachEnergy`, `moveEnergy`, `attachFromTop`,
          `attachFromDeck` and `moveCounters` all carry a bare `targetType` beside
          a bare `ownerPokemon` for exactly this reason.

          ⚠️ **THE NAME IS THE SOURCE CARD'S OWN, AND IT IS SPELLED OUT ANYWAY.**
          Every printing of this sentence is on a card called "Pecharunt ex", so
          "except any <me>" would read the same on all five — but `matchesFilter`
          and this op are handed a CARD and never a source, and a self-referential
          rider would be a mechanism whose only witness is the coincidence that
          the printed name matches. The card prints a NAME; the field holds it. */
      exceptNamed?: string;
      /** The printed pronoun: the bench end is `ctx.sourceUid`'s body, not a
          pick. Absent = the free switch every other printing spells. */
      fromSource?: true;
      recordAs?: EffectSlot;
    }
  /** Gust: switch one of the OPPONENT's Benched Pokémon into their Active spot
      (Boss's Orders). PARKS on the opponent-bench choice unless forced.

      ⚠️ **D206 — `recordAs` IS THE MIRROR OF `switchActive`'s, AND THE CATALOG
      PRINTS THE SEAM BOTH WAYS ROUND.** Team Rocket's Giovanni switches and THEN
      gusts; Prime Catcher `sv05-157`/`sv08.5-119` (2 legal, ACE SPEC Item) gusts
      and THEN switches — *"Switch in 1 of your opponent's Benched Pokémon to the
      Active Spot. **If you do,** switch your Active Pokémon with 1 of your
      Benched Pokémon."* — which is Giovanni's two ops in the opposite order with
      neither end narrowed. The two ops are ONE move (`switchInto`) on two seats
      and share one recording helper, so a §9.2 seam on one and not the other
      would be an asymmetry no printing asks for.

      The filed uid is the OPPONENT's newly promoted body, which is not a novelty
      of this op: `bottomFromOpponentHand` already files uids off the opponent's
      side into the same three slots.

      🆕 **D331 — `basicOnly` IS THE FIRST NARROWING THIS OP HAS EVER TAKEN, AND
      IT ARRIVES WITH A FUNNEL RATHER THAN AS A FIELD.** Lisia's Appeal
      `sv08-179`/`-234`/`-246` (3 legal, Supporter) prints *"Switch in 1 of your
      opponent's Benched **Basic** Pokémon to the Active Spot. If you do, the new
      Active Pokémon is now Confused."* — Boss's Orders' sentence with one
      adjective in it, and that adjective is the whole engine diff.

      🛑 **THE ADJECTIVE IS NOT THE EXPENSIVE HALF; THE AGREEMENT IS.** The
      handoff priced this row as *"one Basic rider on `gust`'s candidate scan,
      shared with `programPlayable`'s empty-Bench refusal, so the whiff arm
      follows for free"*, and the second clause was **false at this head**:
      `programPlayable` refused a gust by reading
      `state.players[otherSeat(seat)].bench.length === 0` — a raw BENCH LENGTH
      that never touched `oppBenchRefs` and therefore could not see a rider. A
      rider added to the scan alone would have made this Supporter PLAYABLE into
      an opponent Bench holding nothing but Evolutions, parked a prompt with zero
      candidates, and spent the turn's one Supporter (§7.2) on it. **That is
      D206's finding one op over**, and D206's own note at that gate
      (cardplay.ts) describes the repair it did not then apply to this case: the
      op's own candidate function answers, *"so the refusal and the offer can
      never disagree"*. Hence `gustTargets` (interpreter.ts), exported for
      cardplay.ts on `switchActiveTargets`' precedent and for its stated reason —
      a gate that recomputed the set would be a second copy of the printed rule,
      free to drift.

      ⚠️ **`basicOnly?: true` AND NOT A `stage` OR A `CardFilter`, MEASURED
      RATHER THAN CHOSEN.** Over remote D1 `luminous` (2026-08-13) the whole
      *"Switch in 1 of your opponent's…"* family is 10 rows on `effect` (5 legal)
      and 18 on `attacks_json` (10 legal), and **exactly three of those 28 print a
      stage word at all** — these three, and the word is "Basic". No attack
      prints `Benched Basic … Active Spot` (0 rows). A `stage?: "basic" |
      "evolution"` would have shipped an `"evolution"` value no printing spells,
      and a `CardFilter` rider a whole union no sentence asks this op for.
      Narrow it, do not widen it.

      🆕🛑 **D349 — `remainingHpAtMost` IS THIS OP'S SECOND NARROWING, AND IT IS
      A BOARD READ WHERE `basicOnly` IS A CARD READ.** Ledian `svp-133`/
      `sv07-003`/`sv07-144` "Glittering Star Pattern" (**3 legal printings on ONE
      sentence**) prints *"…switch in 1 of your opponent's Benched Pokémon **that
      has 90 HP or less remaining** to the Active Spot."* — Hop's Dubwool's
      `DEFIANT_HORN` sentence with one relative clause on it, and that clause is
      the whole engine diff on this op.

      🛑 **A NUMBER ON THE OP AND NOT A `CardFilter`, AND THE REASON IS THE ONE
      D181 MEASURED RATHER THAN A PREFERENCE.** `matchesFilter` is handed a
      `Card` and never an `InPlayPokemon`, so *current* HP is unreachable from
      that union AT ANY WIDTH — which is exactly why D181's `basicPokemon.maxHp`
      rider (a CARD read of printed HP) could not serve these printings and why
      that slice recorded the split as **9 / 4 card-read vs 6 / 2 board-read**.
      This is the board-read half, re-derived at this head over all three text
      columns: *"HP or less remaining"* as a CANDIDATE narrowing is **6 legal
      printings on 2 legal sentences** — this one and Bianca's Devotion
      `sv05-142`/`-197`/`-209` on `healChosen` — plus Vanilluxe `sv06-039`
      (1 printing, NOT legal, and a can't-attack aura rather than a narrowing).
      **The two live sentences are two different ops, which is why the shared
      thing is the PREDICATE (`remainingHpWithin`, continuous.ts) and not a
      field**: D181's own finding that "a vocabulary item's yield is not bounded
      by the row that prompted it", arriving on a predicate instead of a filter.

      ⚠️ **READ IN `gustTargets` AND THEREFORE AT BOTH READERS AT ONCE.** D331
      built that funnel precisely so `programPlayable` (cardplay.ts) and the
      interpreter's park cannot disagree, and this rider inherits the agreement
      for free — a Boss's-Orders-shaped Ability offered into an opponent Bench of
      nothing but full-HP bodies is refused rather than parked empty. It is also
      why the rider needed no second line anywhere: the funnel was the price, and
      D331 paid it.

      ⚠️ **BEHAVIOUR-PRESERVING WHEN ABSENT**, `basicOnly`'s contract verbatim:
      the funnel returns `oppBenchRefs` unfiltered, so Boss's Orders, Pokémon
      Catcher, Prime Catcher, Giovanni's consequent, Florges' coin-gated gust and
      Lisia's Appeal all keep their exact candidate sets. */
  | { op: "gust"; recordAs?: EffectSlot; basicOnly?: true; remainingHpAtMost?: number }
  /** D227 — the OPPONENT-CHOSEN switch-out: *"Switch out your opponent's Active
      Pokémon to the Bench. **(Your opponent chooses the new Active Pokémon.)**"*
      — **10 Standard-legal bare printings**, 13 across the whole family
      (`sv05-106`, `sv07-121`, `sv09-009`, `sv10-002`, `sv10-105`, `sv10-183`,
      `sv10.5w-007`, `sv10.5w-075`, `sv10.5w-092`, `sv10.5w-155`; remote D1
      `luminous`, 2026-08-05, over `json_each(attacks_json)`).

      🛑 **THE BOARD MOVE IS `gust`'s, BYTE FOR BYTE — `switchInto` on the
      opponent's seat. THE WHOLE DIFFERENCE IS WHO ANSWERS.** That is why this is
      a second op rather than a `chosenBy` field on `gust`: a field would be read
      by the interpreter, and nothing else in the engine dispatches on it, but the
      two ops are *different printed sentences with different candidate OWNERS* —
      Boss's Orders drags the body YOU want up, this one lets THEM keep their
      best. Modelling it as one op told apart by a boolean would put the printed
      subject of the sentence into a modifier, and `programPlayable`'s existing
      `gust` refusal (an empty opponent Bench makes Boss's Orders unplayable)
      would then silently answer for a sentence it was never written about.

      ⚠️ **THE PARK CARRIES A `decider`, AND IT IS THE SECOND OP EVER TO DO SO**
      (`opponentMayDraw` is the first, since 0.x). `settleProgram` files it as
      `phase.answerer`, `resolveEffect` accepts only that seat's answer,
      `phaseViewOf` moves `waitingSeat` to it and WITHHOLDS the prompt from the
      controller, and both HUDs already route a `choosePokemon` to whichever seat
      is acting — so the cross-seat path is INHERITED WHOLE and this op adds no
      client code. ⚠️ It is also the first cross-seat park with **candidates**:
      `mayDraw` carries no references at all, so `redactedRefOf`'s ABSOLUTE `seat`
      is load-bearing here for the first time (the answerer sees their own bodies,
      unbadged, because `ref.seat === seat` for them).

      ⚠️ **`recordAs` ARRIVED AT D228, AND D227 SAID EXACTLY WHEN IT WOULD.** This
      doc used to read *"NO `recordAs`, DELIBERATELY … no printing puts this op on
      the ANTECEDENT side of an 'If you do' … left out until a printing asks"* —
      and the printing that asks is the one D227 fielded UNREAD on the very next
      fixture index: Grimmsnarl `sv07-096` *"Switch out your opponent's Active
      Pokémon to the Bench. (…) **If you do,** this attack does 160 damage to the
      new Active Pokémon."* The field is `switchActive`'s and `gust`'s verbatim,
      filed through the same `switchRecording` helper off the same
      `POKEMON_SWITCHED` row, at BOTH of this op's arms (the forced apply and the
      resumed pick) — an omission at either would file nothing on exactly the
      boards where the park is the interesting half. **The deferral was right and
      so was the trigger**: a slot no gate could read stayed out for one slice and
      landed with its first reader, which is what "until a printing asks" is for.

      §11: **untouched** by a wide `{ effects: true }` block, for `gust`'s reason
      and no other — the printed subject is the opponent's BENCHED body coming up,
      not the shielded Active. Classified and DRIVEN in `preventBlock.test.ts`. */
  | { op: "opponentSwitchOut"; recordAs?: EffectSlot }
  /** 🆕 **D299 — TAKE ONE BENCHED POKÉMON OFF THE BOARD, WITH EVERYTHING
      ATTACHED TO IT, AND PUT THE WHOLE PILE INTO ITS OWNER'S `dest`.** The first
      op in this engine that unmakes an in-play body outside the KO path, and it
      is the mechanism four handoffs (D294–D297) refused Illumise `sv06-010` for.

      `whose` is the printed possessive ("1 of **your opponent's** Benched
      Pokémon" against "1 of **your** Benched Pokémon") and picks the CANDIDATE
      BOARD; `dest` is the printed destination, and it also fixes the printed
      VERB — every "into … deck" printing says *Shuffle* and every "into … hand"
      printing says *Put*, because a hand is not shuffled. So the deck arm ends
      in a real shuffle of the OWNER's deck (with its own SHUFFLE row) and the
      hand arm does not, which is the whole behavioural content of the field.

      🛑 **THE OWNER IS THE REF'S SEAT, NEVER `ctx.seat`, AND THAT IS WHY THIS IS
      ONE OP RATHER THAN TWO.** The printed destination is always the chosen
      body's OWN library zone — Illumise shuffles the opponent's Pokémon into
      *their* deck, Chimecho shuffles its controller's into *your* deck — so the
      cross-seat case is not a special reader, it is the same sentence read off
      the other bench. `searchMove`/`retrieveMove` hard-code `ctx.seat`'s zones
      (which is what the old refusal actually named); this op reads the zone off
      the target, so no `dest` union anywhere else has to learn a new word.

      ⚠️ **THE OPPONENT ARM RUNS THROUGH `unshieldedRefs` AND THE OWN ARM DOES
      NOT**, on `gust`'s precedent exactly: shuffling an opponent's body away is
      an effect done TO that body, so a shielded one is simply not offered and a
      Bench where every body is shielded whiffs — while an effect you aim at your
      OWN board asks nobody's permission (no printed shield in this pool guards
      its controller against its controller).

      ⚠️ **PARKS THROUGH `parkOrForce`, so a one-body Bench is forced and an EMPTY
      Bench is a silent no-op** — Illumise attacks on the first turn going second,
      when an empty opposing Bench is the ordinary board rather than an edge case.

      **THE POPULATION IS 5 PRINTINGS ON 3 SENTENCES, PLUS ILLUMISE BEHIND D282's
      SPLIT** (remote D1 `luminous`, `legal_standard = 1`, 2026-08-09,
      `instr(attacks_json,'and all attached cards into') > 0` — 27 rows, 15 of
      them legal):
        • *"Shuffle 1 of your Benched Pokémon and all attached cards into your
          deck."* — Chimecho `sv06-085`/`-179` (2).
        • *"Put 1 of your Benched Pokémon and all attached cards into your
          hand."* — Swoobat `sv10.5w-037`/`-120` (2).
        • *"Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon.
          Shuffle that Pokémon and all attached cards into their deck."* —
          Sylveon `svp-172`/`sv06.5-022` (2), through `coinFlipGate`.
        • *"…Shuffle 1 of your opponent's Benched Pokémon and all attached cards
          into their deck."* — Illumise `sv06-010` (1), whose gate clause D282's
          `splitAttackGateClause` takes off the front first.

      🛑 **AND THE LEGAL PRINTINGS THIS OP DELIBERATELY DOES NOT REACH, each
      refused on a DIFFERENT missing piece rather than on this vocabulary**:
        • Sylveon ex `sv08-086`/`sv08.5-041`/`-156` (3) — *"Choose **2** of your
          opponent's Benched Pokémon…"* plus a *"If 1 of your Pokémon used
          Angelite during your last turn, this attack can't be used"* rider. A
          COUNT and a per-attack-name history stamp: Lickitung's refusal (see
          `bottomFromOpponentHand`) and D277's, on one card.
        • The SELF-removal family, which names **this Pokémon** rather than a
          chosen one and is therefore `returnSelf`'s population, not this op's —
          see the block below it.

      🆕 🛑 **D311 — THE CENSUS QUOTED ABOVE WAS TWO PRINTINGS SHORT AND THE LIST
      DIRECTLY BELOW IT WAS THREE, AND BOTH FAILURES ARE THE SAME FAILURE MEASURED
      TWICE.** The quoted statement sweeps `attacks_json` **alone**, which is
      `conventions.md`'s own rule ignored verbatim (*"sweep all three text columns —
      D205's sweep read attacks only, and undersized one flag 2 → 7 printings"*);
      D310 re-ran it across `abilities_json` too and found **Dudunsparce
      `sv05-129`/`sv08.5-080`**, which no list on this page had ever named.
      **D311 re-ran it again and the corrected column set was STILL SHORT, because
      the LITERAL is as narrow as the columns were**: `'this Pokémon and all
      attached cards'` cannot see the PRONOUN spelling, and *"…you may shuffle
      **it** and all attached cards into your deck"* is **Abra `sv06-080`**
      ("Teleporter"). ⚠️ **A CENSUS IS AS NARROW AS *BOTH* THE COLUMNS ITS QUERY
      NAMES *AND* THE LITERAL IT MATCHES — WIDENING ONE PROVES NOTHING ABOUT THE
      OTHER.**

      🆕 🛑 **D312 — AND THE CORRECTED LITERAL WAS *STILL* SHORT, FOR A THIRD
      REASON NEITHER EARLIER FIX COULD REACH: THE WORD ORDER.** D312 re-swept all
      three columns at FOUR widths. `'attached cards'` — wider than anything above
      — returns 54 rows / **29 legal**, and the three it adds over D311's
      `'and all attached cards'` are all the SAME unrelated mechanism (Palafin
      `sv06-060`, Ogre's Mask `sv06-159`/`sv08.5-118`: *"Any attached cards, damage
      counters … remain on the new Pokémon"*), so the widest NOUN-ORDER literal
      buys nothing. Reversing the order does. `'cards attached'` returns **Team
      Rocket's Crobat ex `sv10-122`/`-217`/`-234`/`-242` (4 legal)** —
      *"You may put this Pokémon into your hand. (Discard all cards attached to
      this Pokémon.)"* — which **no literal containing the substring `attached
      cards` can see at any column width whatsoever**. ⚠️ **A CENSUS IS AS NARROW
      AS ITS COLUMNS, ITS LITERAL *AND ITS WORD ORDER*, AND THE THIRD IS THE ONE NO
      AMOUNT OF SHORTENING FIXES — ONLY RE-READING THE PRINTED SENTENCE DOES.**
      🆕 And Crobat ex is a new MECHANISM as well as a new spelling: the body goes
      to the HAND while its attachments go to the **DISCARD**, a SPLIT destination
      neither Lillie's Comfey (all → hand) nor Revavroom ex (all → discard) has.
      **The family is THIRTEEN legal printings.**

      **THE SELF-REMOVAL FAMILY, RE-DERIVED 2026-08-10** (remote D1 `luminous`,
      `legal_standard = 1`, `attacks_json` + `abilities_json` + `effect`, the union
      of `'this Pokémon and all attached cards'`, `'it and all attached cards'` and
      `'cards attached to this Pokémon'`) — **THIRTEEN legal printings**, of which
      D311 built TWO and D312 builds TWO more:
        • ✅ *"…shuffle this Pokémon and all attached cards into your deck."* —
          **Dudunsparce `sv05-129`/`sv08.5-080`** (2), an **ABILITY** with **no
          Active-Spot clause**, BUILT at D311 as `returnSelf`.
        • ✅ *"Once during your turn, if this Pokémon is in the Active Spot, you
          may shuffle **it** and all attached cards into your deck."* — Abra
          `sv06-080` (1), an ABILITY that PRINTS `activeOnly`. **BUILT at D312 as
          a registry row and nothing else** (`TELEPORTER`), which CLOSES this
          family's Ability half at **3 of 3**.
        • ✅ *"You may shuffle this Pokémon and all attached cards into your
          deck."* — Gholdengo `sv08-131` idx 1 (1). **BUILT at D312** as a registry
          ATTACK row (`SURF_BACK`, an `optional` over this op) once `finishAttack`
          learned the SAME §8.1 promotion seam D311 gave `resolveMidTurnKnockOuts`.
        • ✅ 🆕 *"Put this Pokémon and all attached cards into your deck. If you
          do, search your deck for up to 3 cards and put them into your hand.
          Then, shuffle your deck."* — Eldegoss `sv07-011` (1). **BUILT at D314**
          as a registry ATTACK row (`BREEZY_GIFT`) of THREE EXISTING OPS —
          `returnSelf` + `searchDeck` + `shuffleDeck` — and **it cost no new op
          field at all.** 🛑 **THE PRICE THREE HANDOFFS CARRIED ("a `recordAs` on
          `returnSelf` itself") WAS WRONG, AND THE REASON IS WORTH KEEPING**: the
          printed *"If you do"* has NO SEPARATING BOARD on this card. This op's
          three refusals are all unreachable from an attack program (§8 declares
          the attack off the attacker's own Active body, and "Breezy Gift" deals
          no damage), so a `recordGate` here would be D310's *"a FILTER may be a
          SUBSTITUTION"* — green, dead and unkillable. **A §9.2 SLOT IS EARNED BY
          A BOARD, NOT BY THE WORDS *"IF YOU DO"*.** ⚠️ It is also the only
          printing in this family whose verb is **PUT** rather than *shuffle*, so
          it is the one that emits TWO `SHUFFLE` rows for one printed shuffle —
          driven rather than papered over, because the log reports what the engine
          did. And it is the FIRST program in this engine that **PARKS** after
          emptying its own Active Spot: `searchDeck` asks its question while the
          spot stands empty, and the §8.1 promotion is queued only on the answer.
        • ✅ 🆕 *"You may do 120 more damage. If you do, shuffle this Pokémon and
          all attached cards into your deck."* — Poliwrath `sv06-043` (1), **THE
          THIRTEENTH, AND IT CLOSES THIS FAMILY AT 13 OF 13.** **BUILT at D316**
          by `deriveAttackOptionalBoost`, and it is NOT a registry row: it shares
          its antecedent with three other sentences and an arm serves all four.
          🛑 **THE TWO EARLIER PRICINGS WERE BOTH WRONG AND THEY WERE WRONG IN
          OPPOSITE DIRECTIONS.** D314 priced it as *"a `recordGate` slot on the
          damage step"*, as if a slot were the cost; D315 corrected that and
          then over-corrected, writing *"closing it is a change to the damage
          pipeline"*. **The premise both shared is true and the conclusion does
          not follow**: `attack.ts` really does fold the printed damage before
          the program runs, so nothing inside a program can ADD to a hit that has
          landed — but it has DROPPED the printed base since Hail Blade whenever
          the program OWNS the damage, and `damageDefender` re-enters the whole
          §8.5 pipeline from inside. So the hit moves into the gate, the base is
          suppressed, and the pipeline is untouched. What it cost instead was one
          FIELD on each of two existing shapes: `optional.otherwise` (the arm the
          three other gates already had) and this op's flat `amount`.
        • ✅ *"Put this Pokémon and all attached cards into your hand."* —
          Lillie's Comfey `sv09-068` (1): the `dest: "hand"` printing, BUILT at
          D313 on a card that ALREADY carried a registry attack at index 0.
        • *"Discard this Pokémon and all attached cards."* — Revavroom ex
          `sv06.5-015`/`-081` (2): a DISCARD destination, which is a third zone
          neither op writes.
        • 🆕 *"You may put this Pokémon into your hand. (Discard all cards attached
          to this Pokémon.)"* — **Team Rocket's Crobat ex `sv10-122`/`-217`/
          `-234`/`-242` (4)**, the printings D312's word-order sweep found. A
          **SPLIT** destination — body to the hand, attachments to the discard —
          so it is not `dest: "hand"` and not `dest: "discard"` either, and it is
          the LARGEST unbuilt group in this family by printings.

      ⚠️ **AND FOUR MORE MECHANISMS SHARE THE STRING WITHOUT SHARING THE
      SENTENCE**, which is why the wider `'and all attached cards'` sweep (51 rows /
      **26 legal**) is not this family: Milotic `sv06-050` is a PREVENTION aura
      (*"…can't be put into your opponent's hand"*), Scoop Up Cyclone
      `sv06-162`/`sv08.5-128` is a TRAINER naming *1 of your Pokémon* (a CHOICE
      over both spots), and Team Rocket's Grimer `sv10-123` / Moltres ex
      `sv10-031`/`-208`/`-229` DISCARD the opponent's Active. */
  | { op: "returnBenched"; whose: "self" | "opponent"; dest: "deck" | "hand" }
  /** 🆕 **D311 — TAKE THE PROGRAM'S OWN BODY OFF THE BOARD WITH EVERY CARD
      ATTACHED TO IT AND SHUFFLE THE WHOLE PILE INTO ITS CONTROLLER'S DECK.**
      *"…shuffle **this Pokémon** and all attached cards into your deck."*
      (Dudunsparce `sv05-129`/`sv08.5-080` "Run Away Draw", 2 legal printings.)

      🛑 **IT IS `returnBenched`'s SUBJECT THAT DIFFERS, NOT ITS DESTINATION, AND
      THAT IS WHY IT IS A SECOND OP RATHER THAN A THIRD `whose`.** `whose` picks a
      CANDIDATE BOARD and every value of it ends in a pick; this sentence names no
      candidate at all — the subject is `ctx.sourceUid`, resolved through
      `sourceRef` exactly as every other printed *"this Pokémon"* in this
      vocabulary. There is nothing to choose, so the op never parks, and folding it
      into `returnBenched` would have put a `whose` value on that op for which its
      whole `parkOrForce` body is dead code.

      🛑 **AND IT REACHES THE ACTIVE SPOT, WHICH `returnBenched` REFUSES BY REF
      GUARD.** That refusal was never about the zone — it was about the §8.1
      PROMOTION the board owes once the Active spot goes empty, and the block above
      recorded it as *"missing CODE"*. **D311 supplies the code, and it is a
      QUEUEING SEAM rather than a stage**: `PendingStage {kind:"promote"}` already
      pops on an occupied spot, auto-resolves a one-body Bench, and falls into the
      §14.2 loss on an empty one — so `resolveMidTurnKnockOuts` (flow.ts) now sweeps
      for an EMPTY ACTIVE SPOT beside its Knock Outs, and a controller who shuffles
      away their last Pokémon loses with no new code at all.

      🆕 🛑 **AND D312 PUT THE SAME SEAM AT THE *SECOND* SITE, WHICH IS WHAT MADE
      THIS OP REACHABLE FROM AN ATTACK.** `finishAttack` (flow.ts) calls
      `collectKnockOuts` DIRECTLY and never passes through
      `resolveMidTurnKnockOuts`, so until D312 an attack that removed its own actor
      handed the turn over with an empty Active Spot. **The second site cost the
      same six lines as the first** — the same filter, the same `.map`, the same
      already-total `promote` stage — and the ONE thing that differs is the tail the
      stages are spliced in front of: `resumeTurn` there because the actor keeps
      playing, `turnTail` here because §8.1's promotion is owed BEFORE the turn
      ends. **Two sites, one seam, no stage** is the third consecutive slice to
      answer D307's third question the same way.

      🆕 🛑 **D313 — THE DESTINATION IS NOW TWO FIELDS, AND IT IS AUTHORED OVER ALL
      FOUR PRINTED SPELLINGS AT ONCE BECAUSE THAT IS THE ONLY WAY IT COULD BE
      AUTHORED HONESTLY.** D311 refused a `dest` because it had ONE member; D312
      refused it again and wrote down the reason, which is the useful one — a
      three-member enum authored over the three destinations then known **would not
      have fitted Crobat ex's SPLIT**, and the field would have had to be widened or
      re-read the moment the fourth spelling surfaced. **The census stopped moving at
      D312/D313 (thirteen printings, confirmed on a fourth axis), so the field is
      now knowable**, and the four printed combinations are:

        body → deck    · attachments → deck      Dudunsparce ×2, Abra, Gholdengo,
                                                 Poliwrath, Eldegoss   (6 printings)
        body → hand    · attachments → hand      Lillie's Comfey       (1 printing )
        body → discard · attachments → discard   Revavroom ex ×2       (2 printings)
        body → hand    · attachments → DISCARD   T.R.'s Crobat ex ×4   (4 printings)

      🛑 **THREE OF THE FOUR AGREE AND ONE SPLITS, SO THE SHAPE IS ONE ZONE PLUS AN
      OVERRIDE — NOT TWO INDEPENDENT ZONES.** Two free `"deck" | "hand" | "discard"`
      fields would author **NINE** combinations to serve **FOUR** printed ones, and
      the five that no card prints would be exactly the "green and dead" widening
      D310's lesson is about. `dest` is the BODY's zone; `attachmentsTo` is the ONE
      printed departure from it, and its ABSENCE is the positive statement *the
      attachments follow the body* rather than a default nobody chose.

      ⚠️ **`dest` IS OPTIONAL FOR A WIRE REASON AND NOT AN AUTHORING ONE.** Every
      registry row spells it (driven: no `returnSelf` in `REGISTRY` omits it), but a
      **version-18 match record** can hold a bare `{op:"returnSelf"}` inside a parked
      `optional` — Gholdengo's row is exactly that shape — so `undefined` has to
      read as `"deck"`, which is what every v18 authoring site meant. That is what
      keeps `MATCH_RECORD_VERSION` at 18 through this slice, and the arm is DRIVEN
      rather than argued.

      ⚠️ **AND THE SPLIT SEAM IS ONE `stackUids` ALREADY CONCATENATES.** *"(Discard
      all cards attached to this Pokémon.)"* is not a discard of the whole pile: the
      EVOLUTION STACK follows the body to the hand (§8's bounce rule — a Crobat ex
      returned to hand takes its Golbat and Zubat with it) and only `energy` +
      `tools` are "attached". `stackUids` is `[...stack, ...energy, ...tools]`, so
      the printed parenthetical cuts it at the join it was already built on — the
      op needs no new extraction to honour a sentence written eleven sets later.

      ⚠️ **A SILENT NO-OP WHEN `sourceRef` IS EMPTY**, `sourceRef`'s own contract:
      the body was evolved over, bounced or Knocked Out earlier in the same program,
      and "this Pokémon" then points at nothing. Every other source-reading op in
      this file whiffs the same way rather than throwing. */
  | { op: "returnSelf"; dest?: "deck" | "hand" | "discard"; attachmentsTo?: "discard" }
  /** 🆕 D345 — THE PRINTED SELF-KNOCK-OUT COST. *"**If you use this Ability, this
      Pokémon is Knocked Out.**"* — Dusclops `sv06.5-019`/`-069`/`sv08.5-036` and
      Dusknoir `sv06.5-020`/`-070`/`sv08.5-037` "Cursed Blast", plus Magneton
      `svp-153`/`svp-159`/`sv08-059` "Overvolt Discharge".
      🆕 **D346 — ALL NINE PRINTINGS OF THE CLAUSE ARE NOW BUILT, AND THE THIRD
      SENTENCE COST NOTHING.** This doc said Magneton "owes a SECOND mechanism and
      is refused"; it owed none. Its *"in any way you like"* half is THREE
      `attachEnergyFrom` ops (D263's `ASSEMBLE_ALLOY` reading at a third unit), so
      the op D345 authored for two sentences turned out to license all three the
      moment it landed. **An op's producer count is a measurement and rots like
      one** — this line named 6 of the 9 printings its own clause reaches.

      🛑 **A FIELD-FREE OP, AND THE ABSENCE OF FIELDS IS THE MEASUREMENT.** The
      clause is byte-identical across all three sentences that print it — the
      three-column census on remote D1 `luminous` (2026-08-15) returns
      `effect` 0 + `abilities_json` **9 printings / 9 legal / 3 sentences** +
      `attacks_json` 0 for `instr(<col>, 'If you use this Ability, this Pokémon is
      Knocked Out') > 0` — so there is nothing for a field to vary over. D104's
      minimal-shape rule: a rider nobody prints is green and dead.

      🛑 **IT IS THE CONSEQUENCE OF *USING*, NOT A CONDITION ON THE EFFECT.** The
      printed "If you use this Ability" is satisfied the moment the player takes
      the option — the Knock Out is owed even when the effect in front of it
      whiffed (an opponent's board of one still eats the counters; a board that
      somehow offered nothing still costs the host). So the op sits LAST in the
      program and carries no gate, which is the printed sentence order and not a
      simplification.

      ⚠️ **"IS KNOCKED OUT" IS NOT DAMAGE, AND THE IMPLEMENTATION HAS TO SAY SO.**
      It is not routed through `damageSubject` — no Weakness/Resistance, no
      `damageReductionAfterWR` passive, no prevention, and no `DAMAGED` event. The
      op marks the host lethal against `effectiveMaxHp` AS IT STANDS and hands the
      body to §8.1: `resolveMidTurnKnockOuts` (flow.ts) is already the sweep every
      settled program passes through, so the Prize, the discard of the whole stack,
      the `KNOCKED_OUT` event and the §8.1 promotion all come for free — the same
      seam `returnSelf` above rides for the same reason.

      ⚠️ **A SILENT NO-OP WHEN `sourceRef` IS EMPTY**, `returnSelf`'s contract
      verbatim: the host was evolved over, bounced or Knocked Out earlier in the
      same program and "this Pokémon" points at nothing.

      ⚠️ **NO `MATCH_RECORD_VERSION` BUMP.** The op never parks (there is no
      decision in it), so no `PendingStage` inhabitant is added; it carries no
      field, so no persisted union gains a member; and the Knock Out is rendered
      through the EXISTING `KNOCKED_OUT` event rather than a new one. */
  | { op: "knockOutSelf" }
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
      pick takes.

      🆕🛑 **D349 — `remainingHpAtMost` IS THE PRINTED RELATIVE CLAUSE, AND IT IS
      THE FIRST NARROWING THIS OP HAS EVER TAKEN THAT IS NOT THE ZONE WORD.**
      Bianca's Devotion `sv05-142`/`sv05-197`/`sv05-209` (**3 legal printings,
      Supporter, ONE sentence**): *"Heal all damage from 1 of your Pokémon **that
      has 30 HP or less remaining**."* — Potion's op at `amount: "all"` with one
      relative clause on the candidate set. Shares its whole meaning with
      `gust.remainingHpAtMost` one family over through `remainingHpWithin`
      (continuous.ts); the two ops name two different SUBJECTS for one predicate,
      which is why the shared thing is the predicate.

      🛑 **AND IT IS THE FIELD THAT FORCED THIS OP'S FIRST `programPlayable`
      LINE — D331's DEFECT, ARRIVING ON A SECOND OP EIGHTEEN DECISIONS LATER.**
      Before this slice `healChosen` had NO playability gate at all, and it did
      not need one: unnarrowed, its candidates are every own in-play Pokémon, a
      set §1.1 makes non-empty at every legal board, so "could only whiff" was
      unreachable. Narrowed, it is reachable on the FIRST printing — a board
      whose bodies are all above the window — and this printing is a **SUPPORTER**,
      so afford-then-reject would spend the turn's one Supporter (§7.2) on a
      prompt with nothing in it. `healChosenTargets` (interpreter.ts) is the
      funnel, exported for cardplay.ts exactly as `gustTargets` and
      `snipeTargets` are, so the refusal and the offer cannot disagree.

      ⚠️ **THE WINDOW IS NOT A DAMAGE TEST.** A 30-HP body with no damage has 30
      remaining and IS a candidate; it heals 0 and emits nothing, which is the
      same silent ending this op's own doc gives an undamaged pick above. The
      printed clause narrows by REMAINING HP and says nothing about damage, and
      inventing the stronger reading would author a card (D120). */
  | {
      op: "healChosen";
      amount: number | "all";
      zone?: "bench";
      upTo?: number;
      remainingHpAtMost?: number;
    }
  /** Attach Basic Energy from a SOURCE zone (the controller's hand or discard
      pile) to a CHOSEN own in-play Pokémon — the §6 energy-acceleration Ability
      family (Quaquaval "Energy Carnival" from hand; Baxcalibur "Super Cold" a
      {W} from hand). `energyType` restricts it to a Basic Energy of that type
      (undefined = any Basic Energy). Same-type Basic Energy cards are fungible,
      so the ONLY decision is the TARGET: this PARKS on a choosePokemon unless
      exactly one Pokémon is in play, and a source holding no matching Energy is
      a no-op (programPlayable also blocks activating an Ability that could only
      whiff). The deck-search / look-at-top-N sources layer later ops on this
      primitive.

      ⚠️ **`count` IS THE DIFFERENCE BETWEEN "N ENERGY" AND "N ENERGY ONTO ONE
      BODY", AND UNTIL D205 THE ENGINE COULD ONLY SPELL THE FIRST.** The doc here
      used to say multi-attach "is just N of these ops in one program" — true for
      Koraidon "Dino Cry"'s printed *"in any way you like"*, where each Energy is
      an independent decision and N ops each parking on their OWN target is the
      exact reading. It is FALSE for a print that pins the whole batch to one
      Pokémon: Ethan's Ho-Oh ex "Golden Flame" says *"attach up to 2 Basic {R}
      Energy cards from your hand to **1 of** your Benched Ethan's Pokémon"*, and
      two ops there let a player split them across two bodies — a legal-looking
      program that plays a rule the card does not print. So the ops-in-sequence
      model stays for the "in any way you like" family and `count` is the
      SAME-TARGET one: ONE decision, `min(count, available)` Energy onto the body
      it named. Absent = 1, which is every pre-D205 program's meaning unchanged.

      "up to N" is AUTO-MAXED in both models and for one reason — attaching is
      pure upside, so the take-fewer right is not a decision worth a prompt (the
      auto-take doctrine; a source holding fewer than `count` simply attaches
      what it has, exactly as a later op in the sequential model no-ops).

      Riders: `targetType` restricts the eligible targets to the controller's own
      Pokémon whose top card is that type ({P}/{F}); `basicOnly` further requires
      the target be a Basic Pokémon (Koraidon's "your Basic {F} Pokémon");
      `bonusCounters` puts that many HP of damage counters on the Pokémon just
      attached to (Gardevoir's 2 = 20); `notIfKO` excludes any target the
      bonusCounters would Knock Out ("can't use on a Pokémon that would be Knocked
      Out"), so the placed counters are always non-lethal — this op never KOs.

      ⚠️ **`toSelf` AND `recordAs` ARE D221's PAIR, AND NEITHER IS A CONVENIENCE
      — THEY ARE THE TWO PIECES D190 REFUSED TO BUILD TEAL DANCE WITHOUT.** Teal
      Mask Ogerpon ex prints *"Once during your turn, you may attach a Basic {G}
      Energy card from your hand to **this Pokémon**. If you attached Energy to a
      Pokémon in this way, draw a card."* — 8 Standard-legal printings, the best
      printings-per-edit row left in `coverage-backlog-legal.md`, and that census
      priced BOTH of these as already existing. Neither did. `targetType`/
      `basicOnly`/`ownerPokemon` all pick out a CLASS of the controller's own
      Pokémon, so on a board with two {G} bodies a class rider lets the player
      attach to the WRONG one; *"this Pokémon"* is a UID question. And the op
      recorded NOTHING, so the §9.2 `recordGate` the second sentence needs had
      nothing to read. */
  | {
      op: "attachEnergyFrom";
      source: "hand" | "discard";
      energyType?: string;
      /** How many matching Basic Energy this ONE decision attaches to the ONE
          chosen body — the printed *"attach up to 2 … to **1 of** your Benched
          Ethan's Pokémon"* (Ethan's Ho-Oh ex "Golden Flame", D205). Absent = 1,
          the single-attach every program before D205 meant, so the field is
          OMITTED rather than written as 1 on those rows.

          ⚠️ NOT the same field as "N of these ops in a program", and the
          difference is the whole reason it exists: N ops park N times and may
          land on N different bodies (Koraidon "Dino Cry"'s printed *"in any way
          you like"*), where `count` parks ONCE and pins the batch. A print is
          one or the other, never both — `maxPerTarget` on `attachFromDeck` is
          the same distinction already drawn on the deck-search side.

          `min(count, available)` is what actually lands: a hand holding one {R}
          attaches one, silently, because the print says "UP TO". */
      count?: number;
      /** ⚠️⚠️ D246 — THE PRINTED BARE NOUN, *"attach **an Energy card** from your
          hand/discard pile to this Pokémon"* (Snorlax `sv06-136` "But First,
          Food"; Landorus `sv08-110` "Fist of Focus" — **2 legal attack printings,
          one per source zone**). Absent — every other printing in the family —
          the noun is *"a Basic Energy card"* and only Basic Energy is reachable.

          🛑 **IT IS A FIELD ON THIS OP RATHER THAN A `CardFilter`, AND THAT IS
          THE ONE DESIGN CALL THIS SLICE MAKES.** The engine already spells "any
          Energy card" as `{ kind: "anyEnergy" }` — `discardEnergy`,
          `attachFromTop` and `searchDeck` all take a `CardFilter` — but this op
          does not take one and never has: its narrowing is `energyType`, a bare
          type NAME read by `attachableEnergies`. Giving it a filter would mean
          two ways to say "a Basic {L} Energy card" on one op, which is the
          vocabulary split D131's widen-don't-add rule exists to refuse. So the
          printed word is a BOOLEAN on the axis the op already has: `energyType`
          says WHICH type, `anyEnergy` says whether SPECIAL Energy is in reach.

          ⚠️ **THE TWO NEVER CO-OCCUR AND THE CATALOG IS WHY**, not the type
          system: every printing that names a type also prints "Basic" (a
          `{L}`-coded Special Energy is not a thing the game prints), so no
          sentence spells "an {L} Energy card". The two fields are therefore left
          independently readable rather than welded into one union — a weld would
          be a rule about the catalog dressed up as a rule about the op.

          ⚠️ **READ AT `attachableEnergies` (interpreter.ts) AND THEREFORE AT ALL
          FOUR OF ITS CONSUMERS** — the park guard in `applyEffectOp`, the apply
          in `attachEnergyFrom`, `firstAttachableEnergy`, and through THAT last
          one `programPlayable` (cardplay.ts) and both HUD row-lighting mirrors
          that call it. Greppped, not inferred: one helper is the whole read
          surface, which is exactly why the narrowing lives there and not at each
          call site. */
      anyEnergy?: true;
      /** ⚠️⚠️ D353 — THE PRINTED PROPER NAME, *"attach up to 2 **Spiky Energy**
          cards from your discard pile to this Pokémon"* (Lycanroc `sv09-085`/
          `sv09-166` "Spike-Clad", **2 legal Ability printings on ONE sentence**).
          The value is the EXACT card name, and it is answered by the CardFilter
          predicate the engine already has: `matchesFilter(card, { kind: "byName",
          name })`. Absent — every other printing on this op — the noun is a
          CATEGORY (*"a Basic {F} Energy card"*, *"an Energy card"*) and
          `energyType`/`anyEnergy` are the whole narrowing.

          🛑 **A BARE `string` ANSWERED BY AN EXISTING PREDICATE, NOT A
          `CardFilter` FIELD — AND THAT IS D246's OWN CALL, ONE FIELD LATER.**
          Giving this op a `filter` would give it two ways to say "a Basic {L}
          Energy card", which is the vocabulary split D131's widen-don't-add rule
          refuses and which D246 already refused HERE by name. The precedent for
          the shape is one interface over: `AttachTargetRiders.ownerPokemon` is
          also a bare `string` that `attachEnergyTargets` answers with
          `matchesFilter(topCard, { kind: "ownerPokemon", owner })` rather than
          re-implementing anything. So the ADDITION is one field and the
          PREDICATE is zero.

          🛑 **THE NAME SUBSUMES THE BASIC/SPECIAL TEST, AND THAT IS THE ONE
          DESIGN CALL THIS SLICE MAKES.** Spiky Energy `sv09-159`/`sv09-190` is
          `energy_type = 'Special'`, which `attachableEnergies` has excluded at
          the OP since M5; a co-authored `anyEnergy: true` beside the name would
          be a second field the FIRST one already decides, because a proper name
          picks out exactly one printed card and cannot disagree with itself
          about what kind of Energy that card is. ⚠️ **AND THE CATALOG DOES NOT
          VARY IT**: the only OTHER by-name attach sentence in the whole catalog
          is Wigglytuff `sv02-084`/`sv04.5-147` *"attach a **Therapeutic Energy**
          card from your hand"* (both ROTATED), and Therapeutic Energy is Special
          too — so on 4 printings out of 4 the name names a Special. The other
          reading is installed and killed as `D353-named-energy-still-demands-basic`.

          ⚠️ **NOT CO-AUTHORED WITH `energyType`, AND FOR A STRONGER REASON THAN
          `anyEnergy`'s.** `anyEnergy` and `energyType` are left independently
          readable because the CATALOG never crosses them; here the cross is
          incoherent rather than merely unprinted — a named card HAS a type, so a
          disagreeing `energyType` beside a name could only ever match nothing.
          The two are therefore not welded and not refereed: no printing spells
          both, and a program that spelled both would whiff loudly.

          ⚠️ **READ AT `attachableEnergies` (interpreter.ts) AND THEREFORE AT ALL
          FOUR OF ITS CONSUMERS**, exactly as `anyEnergy` is and for the reason
          D246 wrote down: the park guard in `applyEffectOp`, the apply in
          `attachEnergyFrom`, `firstAttachableEnergy`, and through THAT last one
          `programPlayable` (cardplay.ts) and both HUD row-lighting mirrors that
          call it. A gate that still meant "any Basic {C}" would offer an Ability
          whose printed Energy is not in the pile.

          🛑 **AND A MISSPELLED NAME MATCHES THE EMPTY SET** — `AttachTargetRiders.
          ownerPokemon`'s recorded risk, and here it is the LOUD one rather than
          the quiet one: `programPlayable` refuses an Ability whose attach could
          only whiff, so the card simply stops being offered. */
      energyName?: string;
      targetType?: string;
      basicOnly?: true;
      /** The owner-prefixed subgroup the attach may land on — Iono's Bellibolt
          ex's "1 of your **Iono's** Pokémon", N's PP Up's "1 of your **Benched
          N's** Pokémon" (D204, with `benchOnly` for the zone word). See
          `AttachTargetRiders` for why this is a rider rather than a `CardFilter`
          or a new `TargetFilter`. */
      ownerPokemon?: string;
      /** Only BENCHED Pokémon — N's PP Up's printed "Benched". Shared with
          `attachFromTop`/`attachFromDeck` through `AttachTargetRiders`; this op
          simply had no printed card that needed the word until D204. */
      benchOnly?: true;
      bonusCounters?: number;
      notIfKO?: true;
      /** The printed "attach it to **this Pokémon**" (Teal Mask Ogerpon ex
          "Teal Dance", D221): the sole target is the Pokémon whose effect this
          is (`ctx.sourceUid`), wherever it sits — the Ability carries no Active
          clause, so a BENCHED Ogerpon feeds itself. `attachFromDeck.toSelf` is
          the same field one op over and shares its reader (`sourceRef`), so
          "this Pokémon" means the same body to both attach routes.

          ⚠️ AUTHORED ALONE, exactly as `attachFromDeck.toSelf` is: a print that
          names its own body prints no other target rule, so this member IGNORES
          `targetType`/`basicOnly`/`ownerPokemon`/`benchOnly` rather than
          refereeing a co-authored one. It is also why `cardplay.ts`'s
          would-only-whiff gate needs no `toSelf` arm — that gate reads the
          UN-narrowed `attachEnergyTargets`, and on a `toSelf` row (no class
          riders) the set is every own Pokémon, which CONTAINS the host by
          construction. Co-author a class rider and the gate would start
          answering a different op's question.

          A `toSelf` attach can offer AT MOST ONE target, so `parkOrForce` always
          forces and this op never parks under it — which is why the park's
          caption has no `toSelf` wording (an unreachable branch is removed, not
          worded: D205's `count <= 1`). */
      toSelf?: true;
      /** ⚠️⚠️ D248 — THE SPREAD WITH NO DECISION IN IT: *"Attach a Basic {F}
          Energy card from your discard pile to **each of** your Benched
          Pokémon."* (Mudsdale `sv05-092`/`sv05-175` "Mud Stock" — **2 legal
          attack printings on 1 sentence**, remote D1 `luminous`, 2026-08-06).
          Present = the attach runs once against EVERY eligible target this op's
          riders admit, in `attachEnergyTargets` order, and **asks nothing**.

          🛑 **IT IS `toEach`, NOT `toEachBench`, AND THAT IS THE ONE DESIGN CALL
          THIS SLICE MAKES.** The printed word *"Benched"* already has a spelling
          on this op — `benchOnly`, shared with `attachFromTop`/`attachFromDeck`
          through `AttachTargetRiders` — so the sentence is `benchOnly: true` +
          `toEach: true`, TWO orthogonal fields, rather than one welded flag.
          Welding the zone into the distribution word would be the vocabulary
          split D131's widen-don't-add rule refuses (the same argument
          `anyEnergy` carries one field up): it would give the op two ways to say
          "Benched", and they could disagree. **The evidence the other way is
          real and is recorded rather than glossed**: the catalog prints this
          distribution ONLY over the Bench today (the rotated Glass Trumpet
          `sv07-135`/`sv08.5-110` *"…to each of them"* and Reboot Pod
          `sv05-158` *"…to each of your Future Pokémon"* are both TRAINERS, and
          the `Future` one is ingest-blocked by D243's finding), so a welded flag
          would be observationally identical on every printing that exists. It is
          installed as the mutant `D248-toEach-implies-bench` and killed by a
          case that spreads over an UN-narrowed target set.

          🛑 **AND IT IS A DISTRIBUTION AXIS, NOT A TARGET RIDER — SO IT NEVER
          PARKS.** `anyWay` (N separate ops, each parking on its own body) and
          `count` (one park, batch pinned to the chosen body) are the other two
          members of that axis; this one has no park at all, because "each"
          names the whole eligible set and leaves the player nothing to answer.
          A print is exactly one of the three.

          ⚠️ **THE FOLD RE-FINDS THE ENERGY PER BODY, WHICH IS WHY THIS IS A
          FLAG AND NOT A NEW OP.** `attachEnergyFrom`'s apply resolves its cards
          through `attachableEnergies(state, …)` at apply time, so folding it
          across N refs over the EVOLVING state consumes N distinct cards
          without any bookkeeping here — and it stops attaching when the pile
          runs dry, which is the printed "do as much as you can" outcome rather
          than an all-or-nothing one.

          ⚠️ **`count` AND `toEach` DO NOT CO-OCCUR AND THE DERIVER REFUSES THE
          CROSS**: *"attach up to 2 … to each of them"* is genuinely ambiguous in
          print (2 per body, or 2 shared out?) and no catalog sentence spells it,
          so `attachFromZoneProgram` returns null rather than picking a reading.
          At the OP level the field is still readable — the apply attaches
          `count ?? 1` per body — so a registry program may spell it deliberately
          the day a card prints one. */
      toEach?: true;
      /** File the Energy uids ACTUALLY attached (§9.2), for a following
          `recordGate` to read — Teal Dance's *"If you attached Energy to a
          Pokémon in this way, draw a card."* A whiff (no matching Energy in the
          source, no target) files nothing, which `recorded()` answers as `[]`
          and `recordGateHolds` reads as false: the same answer an explicit empty
          filing would give, so no whiff path spells one.

          ⚠️ NOT IN `recordSlotOf`, and that is a reachability fact rather than
          an oversight. That list feeds `withConsequence`, which describes what a
          PARK's answer buys — and the only authored row carrying this field also
          carries `toSelf`, which never parks. A future recording row WITHOUT
          `toSelf` must add this op there, or its dialog will describe half the
          card. */
      recordAs?: EffectSlot;
      /** ⚠️⚠️ D236 — HEAL THE BODY THIS OP JUST ATTACHED TO: the printed *"…
          to 1 of your Benched Pokémon. **If you do, heal all damage from that
          Pokémon.**"* (**Leafeon** `svp-170`/`sv06-011`/`sv08.5-005` "Leaflet
          Blessings", 3 legal attack printings — ⚠️ **D356 CORRECTED THE CARD NAME
          HERE: this comment said "Lilligant", and D1 says all three ids are
          Leafeon.** `sv09-007` IS a Lilligant ("Sunny Day"), a different card this
          same file cites correctly elsewhere, which is exactly how the two got
          crossed. **A CARRIED CARD NAME ROTS EXACTLY LIKE A CARRIED ID** —
          `testFixtures.ts` had it right the whole time). `"all"` clears the damage; a number heals that much,
          clamped to what is there.

          **IT IS `bonusCounters`' EXACT MIRROR AND THAT IS THE WHOLE ARGUMENT
          FOR IT BEING A FIELD.** That rider already puts damage counters on "the
          Pokémon just attached to" — a body this op knows and nothing downstream
          does. Fires ONCE PER OP, not once per card, for the same reason and by
          the same code path.

          🛑 **NOT `recordGate` → `healChosen`, AND THE DIFFERENCE IS A RULE THE
          CARD DOES NOT PRINT.** `recordAs` files the ENERGY uids, never the
          body, so the only heal a §9.2 gate can reach is `healChosen` — which
          PARKS and lets the controller heal a DIFFERENT Pokémon than the one
          they just fed. On a board with two damaged Benched bodies that is a
          strictly better card than the one printed, and it passes every "was
          something healed" assertion. The printed word is *"THAT Pokémon"*: one
          body, already chosen, no second decision.

          ⚠️ **BOTH VALUES ARE PRINTED AND LEGAL (D231's falsifiability test),
          in two different COLUMNS**: `"all"` on the 3 attack printings above,
          and `30` on the four-printing Ability *"…attach a Basic {G} Energy card
          from your hand to 1 of your Pokémon. If you attached Energy to a
          Pokémon in this way, heal 30 damage from that Pokémon."*
          (`sv07-014`/`-156`/`-167`/`sv08.5-011`) that backlog row 12 names as the
          cheapest registry program left in the pool. Only the `"all"` arm has a
          DERIVER path today; the number arm is driven at the op level, where its
          consumer will be. */
      healTarget?: number | "all";
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
      something to ask about.

      ⚠️⚠️ **D237 — `dest: "bench"`, THE THIRD DESTINATION, AND IT IS THE ATTACK
      COLUMN THAT PRINTS IT.** Backlog row 13 is titled *"the discard pile into
      the hand or onto the Bench"* and the Bench half is real: *"Put up to 3
      Duskull from your discard pile onto your Bench."* (3 legal) and *"Put a
      Pokémon from your discard pile onto your Bench."* (3 catalog printings, 0
      legal). The cards enter play stamped with the current turn, exactly as
      `searchDeck`'s own bench arm does — the two ops are the same move on two
      source zones, so the destination vocabulary that differed between them was
      an accident of which cards had been authored, not a fact about the zones.

      **THE BENCH-SPACE CLAMP IS `searchDeck`'s, RE-READ RATHER THAN REPEATED IN
      SPIRIT**: `Math.min(op.max, benchSpace(...))` narrows the prompt BEFORE
      anything leaves the pile, so a full Bench makes the whole op a silent no-op
      and never strands a card in neither zone. Hand and deck keep `max` as
      printed — neither has a capacity.

      🛑 **THERE IS NO INTERPRETER GUARD THAT THE FILTER NAMES A POKÉMON, AND
      THAT IS `searchDeck`'s PRECEDENT RATHER THAN AN OVERSIGHT.** A `dest:
      "bench"` retrieval whose filter admitted a Supporter would bench a
      Supporter. The guard lives where the printed sentence does — the deriver
      refuses a Bench destination for every noun that is not a Pokémon noun (see
      `BENCHABLE_RETRIEVAL_KINDS`) — and the registry authors none. Naming it
      here so the next author of a `discardPileRetrieval` row knows the check is
      upstream of them and not under them. */
  | {
      op: "discardPileRetrieval";
      filter: CardFilter;
      dest: "hand" | "deck" | "bench";
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
      as a whiffed search does. Reuses resolveEffect's chooseCards validation (the
      candidate set is the top-`n` matches, so a client cannot reach a deeper card)
      and the one vetted `shuffleDeck`.

      ⚠️ **D225 — `reveal` IS THE SAME RIDER AS `searchDeck`'s, AND THE ARM HAD
      THE SAME DEBT ONE STEP FURTHER ALONG.** This doc block used to say flatly
      that "the taken cards are revealed (public) — the printed 'reveal' — so
      naming them (DECK_TOP_REVEALED) leaks nothing"; the log row then named
      nothing at all and was a count, so the comment described a reveal the
      engine did not perform. Worse, the premise was **also** wrong, and the
      event's own NAME is what hid it: of the Standard-legal look-at-the-top-then-
      to-hand printings (remote D1, 2026-08-05, all three text columns), **7
      printings / 3 sentences print no reveal** — Explorer's Guidance ×3, Hassel
      ×2 and Drakloak ×2, every one of them searching the looked-at cards for
      uncategorised *"cards"*, exactly like `searchDeck`'s fifteen. Hassel
      (*"look at the top 8 … put up to 3 of them into your hand. Shuffle the
      other cards back"*) is this op with an unfiltered filter and today's
      trailing `shuffleDeck`, so it is one filter kind away from being authorable
      — hard-coding the reveal here would have shipped a leak with it.

      **`DECK_TOP_REVEALED` KEEPS ITS NAME**: it records the LOOK (the top `n`
      was revealed to its owner, which is what makes the pick legal), and the
      rider records the printed reveal to the OPPONENT. Renaming a persisted
      event literal would owe a `MATCH_RECORD_VERSION` bump for a spelling.

      ⚠️⚠️ **D241 — `dest` IS A WIDENING AND D131's TEST IS WHAT ADMITS IT.** Strip
      the key and you get the previous arm BYTE FOR BYTE: same op, same candidate
      set, same prompt, same event, cards into the HAND. That is D148's `target`
      shape (one rule, another place) and not D154's `attack` shape (a key that
      selects a DIFFERENT rule) — the two printings this slice reads put the
      looked-at cards onto the BENCH ("Look at the top 10 cards of your deck. You
      may put any number of Pokémon you find there onto your Bench.", Tatsugiri
      ex / Reuniclus, 4 legal) and into the DISCARD ("Look at the top card of your
      deck. You may discard that card.", Rockruff / Litwick, 3 legal). Both are
      `searchDeck`'s own reading of the same axis, one source zone over.

      🛑 **THE BENCH VALUE CARRIES NO FILTER CHECK HERE, AND THAT IS UPSTREAM BY
      DESIGN** — `searchDeck`'s precedent, restated by D237 on
      `discardPileRetrieval`: nothing downstream re-checks that a benched card is
      a Pokémon, so the DERIVER owes the guard (`BENCHABLE_RETRIEVAL_KINDS`,
      shared rather than copied). A hand-authored row that benched a Supporter
      would be a registry bug, exactly as it already would be on `searchDeck`.

      🛑 **AND THE DISCARD VALUE IS THIS OP'S EVENT, NOT `DECK_TOP_DISCARDED`'s.**
      That event's other producers (the `attachFromTop` leftovers, this op's own
      `restTo: "discard"` below, and the mill) all describe cards that LEFT the deck
      without anyone deciding about them one at a time; here the discard IS the
      printed decision, and the row has to carry the LOOK that made it. One op,
      one event — `log.ts` renders the destination instead.

      🆕 🛑 **D334 — AND THE TWO DISCARDS ON THIS ONE OP ARE THE SHARPEST CASE THAT
      RULE HAS.** `dest: "discard"` and `restTo: "discard"` both end with cards in
      the pile and they ride DIFFERENT events, because the sentence above is the
      whole test: Rockruff's *"You may discard that card"* is a card the player CHOSE
      to discard (this op's `DECK_TOP_REVEALED`, `dest: "discard"`), and Explorer's
      Guidance's *"Discard the other cards"* is every card the player did NOT
      choose (`DECK_TOP_DISCARDED`). **One op, one printing, two discards, two
      events — and the split is by whether a decision was made about the card,
      never by where it ended up.**

      🆕 🛑 **D335 — AND THE SAME TEST IS WHY `restTo`'s OTHER TWO VALUES RIDE NO
      EVENT AT ALL.** `"bottom"` and `"shuffledBottom"` end with cards that never
      left the deck, so the qualifying test refuses them exactly as it admits the
      discard — **two axes, `dest` and `restTo`, and BOTH are settled by asking
      what happened rather than where the card ended up.** */
  | {
      op: "lookAtTopN";
      n: number;
      filter: CardFilter;
      /** 🆕 **D333 — `"any"` IS THE PRINTED "any number of", AND IT REVERSES A
          PINNED D241 DECISION ON PURPOSE.** Roto-Stick `sv08.5-127` (Item, **1
          Standard-legal printing**): *"Look at the top 4 cards of your deck. You
          may reveal **any number of** Supporter cards you find there and put them
          into your hand. Shuffle the other cards back into your deck."*

          🛑 **THE OLD ANSWER WAS `max: n` AND IT WAS RIGHT ABOUT THE PREDICATE
          AND WRONG ABOUT THE WORDS.** D241's derived bench arm spelled *"any
          number of"* as `max: n`, under a test literally named *"'any number of'
          is the WINDOW, not a new union member"*, and its reasoning is sound as
          far as it goes: the candidate set is a subset of the top `n`, so `max: n`
          is a bound that cannot bind. But `lookNote` reads the SAME field, and
          `max > 1` captions *"up to N"* — so the engine printed a number in front
          of a sentence that prints none. That is exactly the call D244 made one
          op over for `moveEnergy.max` (*"'any amount' is the PRINTED words and is
          spelled rather than resolved to the clamp"*) and D295's `discardEnergy.
          count`, and `attachFromTop.max` has carried the same member since M5.
          **A VALUE THAT IS EQUIVALENT AS A PREDICATE IS NOT NECESSARILY
          EQUIVALENT AS A CAPTION** — and the caption is a printed fact.

          So D241's arm is RE-POINTED to `"any"` rather than left beside this
          member: one op with two spellings of one printed phrase is the shape
          this file refuses everywhere else, and re-pointing it makes four more
          legal printings caption their own sentence.

          **NO WIRE SHAPE MOVES FOR IT.** The park resolves `"any"` against the
          group's own candidate count before anything reaches `prompt.max`, which
          stays a `number` — `moveCap`'s stated reason, verbatim, one op over.
          `also.max` stays a bare `number` because no printing spells an unbounded
          SECOND noun (D331's rule against shipping a value no card reaches). */
      max: number | "any";
      /** Where the taken cards go. ABSENT means the HAND (D135's rule — these
          rows are compared by value against hand-authored registry ones, and an
          explicit `"hand"` would make two spellings of Great Ball unequal). */
      dest?: "bench" | "discard";
      /** 🆕 **D332 — A SECOND filter/cap PAIR OVER THE SAME WINDOW.** Drayton
          `sv08-174`/`-232`/`-244`/`sv08.5-172` (Supporter, **4 Standard-legal
          printings and they are the whole population** — `instr(effect,'a Pokémon
          and a Trainer card') > 0` returns exactly these 4 rows of 3,786, all
          legal, and the same literal over `attacks_json` / `abilities_json`
          returns 0, as does the reversed word order *"a Trainer card and a
          Pokémon"*; remote D1 `luminous`, 2026-08-14): *"Look at the top 7 cards
          of your deck. You may reveal **a Pokémon and a Trainer card** you find
          there and put them into your hand."*

          **TWO SEQUENTIAL OPS CANNOT EXPRESS IT, AND THE REASON IS THE PARK'S OWN
          FIRST LINE.** The window is `deck.slice(0, op.n)` recomputed per op, so a
          second `lookAtTopN` looks at a deck a card has already left — the card at
          index `n` slides INTO the window and becomes takeable though nobody
          looked at it. Narrowing the second op to `n - 1` fixes the take-one path
          and breaks the DECLINE: this sentence is *"you may"*, so taking no
          Pokémon must still leave all 7 reachable for the Trainer, and a `n: 6`
          second look cannot see index 6. One shared window, or a wrong one.

          🛑 **AND THE PIECE IS THE CAP, NOT THE FILTER — WHICH IS THE HALF THE
          WORK ORDER PRICED WRONG.** The `DROPPED` row read *"One op field or a
          second `max`"*. A second `max` on the OP buys nothing on its own:
          `max` is forwarded straight to `prompt.max`, and `validateChoice`
          (cardplay.ts) enforces one FLAT total shared by all six `chooseCards`
          producers — under a total of 2 a client takes TWO Pokémon and the printed
          conjunction is gone. The candidate SET was always free (`anyOf` has been
          in `CardFilter` since D245); what was never free is a per-kind cap the
          wire validator can see, so this field is paired with `chooseCards.caps`
          (interpreter.ts) and neither half is useful alone.

          **ARITY IS EXACTLY TWO BECAUSE TWO IS WHAT THE PRINTING SPELLS**, D331's
          rule about not shipping a union value no card reaches. The wider family is
          REAL and sits one op over: `searchDeck` prints three nouns (Larry's Skill
          `sv08.5-115`/`-139`, *"a Pokémon, a Supporter card, and a Basic Energy
          card"*, 2 legal) and four (Secret Box `sv06-163`, 1 legal) — 3 legal
          printings measured by `instr(col,', and a ') > 0` over all three text
          columns. That slice will want a LIST, and it will find the prompt half
          already a list: `caps` is `readonly {…}[]` for exactly that reason, so the
          second consumer buys only its own op field. One rule, two ops — the shape
          `attachEnergyTargets` and `gustTargets` are already written in.

          ⚠️ **THE TWO GROUPS MAY OVERLAP AND THE CAP RULE IS THE CONSERVATIVE
          ONE**: a uid matching both filters counts against BOTH caps. Drayton's
          two are disjoint by construction (a Pokémon is not a Trainer), so no
          printed board can tell the readings apart; the conservative rule is
          chosen because it can only ever refuse an answer the print did not
          promise, never admit one it did not. */
      also?: { filter: CardFilter; max: number };
      /** The printed *"you may reveal a … and put it into your hand"* — the
          taken cards are named in the log (`DECK_TOP_REVEALED`). Absent rather
          than `false` (D135), exactly like `searchDeck`'s. */
      reveal?: true;
      /** 🆕 **D334 — `max` IS THE PRINTED EXACT NUMBER, NOT A CEILING.** Explorer's
          Guidance `sv05-147`/`sv05-200`/`sv08.5-107` (Supporter, **3
          Standard-legal printings on one byte-identical 95-char `effect`**):
          *"Look at the top 6 cards of your deck and **put 2 of them** into your
          hand. Discard the other cards."*

          **EVERY OTHER `chooseCards` PRODUCER ON THIS OP IS A PRINTED "up to" AND
          THIS ONE IS NOT.** There is no *"you may"*, no *"up to"*, and no filter —
          the player looks at six cards and takes two, full stop. The park has
          hard-coded `min: 0` since M5 under the comment *"'up to' — taking none is
          a legal answer"*, and that is a claim about the PRINT which this sentence
          falsifies.

          🛑 **A BOOLEAN AND NOT A `min: number`, BY D331's RULE.** Every mandatory
          printing of this shape in the catalog has min === max: Explorer's
          Guidance takes exactly 2 of 6, Drakloak `sv06-129`/`sv08.5-072` *"Recon
          Directive"* exactly 1 of 2 (2 legal, on `abilities_json`), Rika
          `sv04-172`/`-241`/`-258` exactly 2 of 4 (3 printings, all out of
          Standard). A `min: number` would admit a *"pick at least 1 of up to 3"*
          no card prints. **The arm therefore transfers to 8 printings / 5 legal
          across two text columns where the registry row it lands is 3** — D187's
          rule that an arm crosses sets and a row does not.

          🛑 **AND IT IS TWO CONSUMERS, NOT ONE, WHICH IS THE HALF A "the field
          already exists" PRICE MISSES.** `chooseCards.min` is a required wire
          field with two non-zero producers already (`payFromHand`'s `op.count`,
          `bottomFromOpponentHand`'s unridden 1), so the VALIDATOR half is free.
          But `lookNote` reads `max` too and captions `max > 1` as *"up to 2
          cards"* — the exact defect D333 repaired one field over on `"any"`. **A
          FIELD THAT FEEDS BOTH A PREDICATE AND A STRING OWES BOTH ARMS**, so this
          one re-spells the caption as *"put 2 cards into your hand."*

          ⚠️ **THE FLOOR IS CLAMPED TO THE CANDIDATE COUNT AT THE PARK, AND IT IS
          THE FIRST `chooseCards` FLOOR THAT HAS TO BE.** `payFromHand`'s and
          `bottomFromOpponentHand`'s floors are gated upstream on a zone that holds
          the cards; a top-6 window on a 1-card deck offers ONE candidate against a
          printed take of 2, and an unclamped `min: 2` there is a prompt with no
          legal answer. `max` never needed this — a ceiling above the candidate
          count simply never binds. */
      exact?: true;
      /** 🆕🆕 **D335 — WHERE THE LEFTOVERS GO, AND IT IS AN AXIS RATHER THAN A
          FLAG.** D334 shipped this as `discardRest?: true` for Explorer's Guidance's
          printed *"**Discard** the other cards"*; the family's other half prints two
          MORE destinations for the very same cards, so the boolean is **RENAMED AND
          WIDENED** rather than joined by a second key:

          • `"discard"` — *"Discard the other cards."* (Explorer's Guidance
            `sv05-147`/`sv05-200`/`sv08.5-107`, 3 legal). D334's value, unchanged in
            meaning.
          • `"bottom"` — *"Put the other card on the bottom of your deck."*
            (Drakloak *"Recon Directive"* `sv06-129`/`sv08.5-072`, 2 legal, on
            `abilities_json`). One card, no order to decide, no rng.
          • `"shuffledBottom"` — *"**Shuffle** the other cards and put them on the
            bottom of your deck."* (Rika `sv04-172`/`-241`/`-258`, 3 printings, out
            of Standard). A SECOND printed decision on the same cards, and the only
            value that spends `rngState`.

          🛑 **A SECOND BOOLEAN BESIDE THE FIRST WOULD BE A STATE WITH NO MEANING**
          — `oncePerTurn`'s doc in registry.ts states that rule for exactly this
          shape: two keys on one axis can be set to contradict each other, and no
          reading of the print says what `discardRest: true` beside a bottom flag
          means. One field, one value, and D131's widening test passes cleanly:
          strip the key and you get the pre-D334 arm byte for byte.

          🛑🛑 **AND THE RENAME IS WHY `MATCH_RECORD_VERSION` MOVES, 19 → 20.**
          `EffectContinuation.pendingOp` is an `EffectOp` persisted inside
          `GameState.phase` (types.ts), and this op PARKS — so a v19 record can hold
          `lookAtTopN{…, discardRest: true}`, which under this deploy reads as
          `restTo === undefined` and silently leaves four cards on top of the deck
          that the card printed *"Discard the other cards"* about. That is not a
          widening (D125): it is **D309's rename case, the one exception**, and the
          record is refused rather than misread.

          🛑 **`attachFromTop.discardRest` IS DELIBERATELY LEFT A BOOLEAN**, and the
          restraint is D331's rule rather than an oversight. Its printed population
          today is one value — Hydreigon "Tri Howl"'s discard. ⚠️ **IT IS NOT ONE
          VALUE FOR LONG, AND THE CARD IS MEASURED:** Metang *"Metal Maker"*
          `sv05-114`/`svp-090` (**2 Standard-legal printings**, on `abilities_json`)
          prints *"…attach any number of Basic {M} Energy cards you find there to
          your Pokémon in any way you like. **Shuffle the other cards and put them on
          the bottom of your deck.**"* — this exact clause, one op over, with MORE
          legal printings than Rika has. Widening that op today would ship a union
          value no card reaches; widening it the day Metang is authored costs the
          field and nothing else, because the apply below is shared in shape.

          ✅✅ **SPENT AT D352 — THE HEADER ABOVE IS NO LONGER TRUE AND IS KEPT
          ANYWAY.** `attachFromTop.discardRest` is `restTo?: "discard" |
          "shuffledBottom"` as of D352; Metang was authored and the widening cost
          the field, the fork in `attachFromTopApply`, and — the one thing this
          paragraph did NOT price — `MATCH_RECORD_VERSION` 20 → 21, for the same
          persistence reason the block two paragraphs up gives for 19 → 20.
          **Annotated as SPENT rather than overwritten**: a prediction that came
          true is evidence, and rewriting it to describe the world after it landed
          would destroy the only proof this method works. "The apply below is
          shared in shape" was correct to the line.

          🛑 **THE TWO NEW VALUES EMIT NO EVENT, AND THAT IS THE FILE'S OWN RULE
          RATHER THAN A SAVING.** `DECK_TOP_DISCARDED` states its qualifying test —
          cards that LEFT THE DECK without anyone deciding about them — and a card
          put UNDER the deck never left it; this doc block and `attachFromTop`'s have
          both said since M5 that *"Shuffle the other cards back into your deck"*
          emits nothing of its own for precisely that reason. `CARD_TO_BOTTOM_OF_DECK`
          refuses on three counts at once (it is SINGULAR, it is HAND-sourced, and it
          names its card only because the whole hand had just been revealed in the
          open). And `shuffledBottom` does not push `SHUFFLE` either: that row claims
          the DECK was shuffled, where this randomizes a two-to-four card tail —
          `handRefresh.toBottom` (Iono) is the precedent, and it emits its own
          count-only row and no `SHUFFLE`. What a viewer is owed here is the LOOK,
          and `DECK_TOP_REVEALED` already carries it on every path.

          **NO TRAILING `shuffleDeck` ON ANY OF THE THREE, AND THE ABSENCE IS
          PRINTED.** The sibling clause *"Shuffle the other cards back into your
          deck"* is a trailing op precisely because those cards stay where they are
          (Great Ball, Pokégear, Hassel, Roto-Stick, Drayton, Bug Catching Set) and a
          whole-deck shuffle gets it right. None of these three can be spelled that
          way: `"discard"` and `"bottom"` move the window somewhere a shuffle cannot
          put it, and `"shuffledBottom"` randomizes the WINDOW and not the deck.

          Runs on EVERY path, including the whiff (a window shorter than `n`, or a
          filter that matched nothing) and the short take — `attachFromTopApply`'s
          rule transferred rather than re-invented, and the reason the empty branch
          of the park is routed through the one apply instead of returning early. */
      restTo?: "discard" | "bottom" | "shuffledBottom";
    }
  /** 🆕🆕 **D341 — LOOK AT THE TOP `n` AND PUT THEM BACK **IN ANY ORDER**.** The
      first op in this engine whose whole content is an ORDER: no card changes
      zone, no card changes owner, and the only thing that happens is that the
      looker learns a deck top and then decides what sequence it is left in.

      🛑 **A NEW OP RATHER THAN A `lookAtTopN` RIDER, AND THE REASON IS THAT OP's
      OWN FIRST LINE.** `lookAtTopN` is about TAKING — every field it has
      (`filter`, `max`, `dest`, `also`, `exact`, `restTo`) describes which cards
      come out of the window and where the rest go. This sentence takes nothing,
      so riding it would mean `max: 0` plus a seventh `restTo` value naming a
      destination the leftovers already occupy, i.e. a state whose two halves
      contradict each other — `oncePerTurn`'s recorded rule, and the same call
      D335 made when it REFUSED to put a second boolean beside `discardRest`.

      🛑 **`side` IS THE FIRST TIME A DECK-TOP OP HAS LOOKED AT THE OTHER SEAT's
      DECK, AND IT IS WHY THE EVENT CARRIES AN `actor`.** `DECK_TOP_REVEALED`'s
      doc block priced exactly this in advance — *"Every `lookAtTopN` printing
      reads the controller's OWN deck, so `actor === seat` on every path today and
      the field would have no observable meaning (D135's rule). Row 11's 'Look at
      the top 5 cards of your **opponent's** deck and put them back in any order'
      is what buys it"* — and this slice is that purchase. The field is bought on
      `DECK_TOP_REORDERED` rather than retrofitted onto `DECK_TOP_REVEALED`,
      because no `lookAtTopN` printing has gained a second seat and D135's rule
      still refuses a field with no observable meaning on THAT row.

      ⚠️ **ABSENT IS THE CONTROLLER's OWN DECK** (D135's rule again — Iron Valiant
      `sv05-080` and the three opponent-deck printings must derive to rows that
      differ in exactly the printed possessive and nothing else).

      🛑 **THE DEGENERATE WINDOWS RESOLVE INLINE AND DO NOT PARK** — M1's
      no-choice doctrine, and here it is arithmetic rather than judgement: a
      window of 0 or 1 card admits exactly ONE ordering, so a park would be a
      prompt with one legal answer. The LOOK still happened on the 1-card path, so
      the event fires either way; a 0-card window (an empty deck) fires it with
      `count: 0`, which is `DECK_TOP_REVEALED`'s D241 rule transferred — *"a look
      is a transfer of INFORMATION, not of cards"* — and is the row that tells the
      opponent their deck top was read.

      ⚠️ **NO TRAILING `shuffleDeck`, AND THE ABSENCE IS PRINTED.** The sibling
      clause *"Shuffle the other cards back into your deck"* exists precisely
      where the print says the knowledge is spent; here the print says the
      opposite — the looker KEEPS the knowledge and sets the order with it, which
      is the whole card. A shuffle would delete the effect.

      🆕🆕 **D343 — `from: "bottom"` MOVES THE WINDOW TO THE OTHER END, AND IT IS A
      FIELD FOR THE REASON `side` IS ONE.** `side` forked WHOSE deck; this forks
      WHICH END of it. Both are one printed sentence — *"put them back in any
      order"* — resolved over a different window, and D341's own argument for
      keeping `side` off a second op applies unchanged: one op, one park, one
      printed decision. Absent means the TOP, so every construction site written
      before this slice keeps its exact shape and its exact meaning.

      🛑 **WHAT BOUGHT IT: KOFU `sv07-138`/`-165`, AND THE CHANNEL IS STILL THE
      BOARD.** D342's finding was that the zone between two ops is a channel —
      `searchDeck{dest:"deckTop"}` puts the picks on top and `reorderTop` reads
      the top, so the second park's candidates ARE the first park's answer by
      construction. Kofu's destination is the BOTTOM, and the handoff recorded
      that as "the trick is not available here". **THE TRICK WAS AVAILABLE; THE
      READER WAS NOT.** `payFromHand { count: 2, to: "deckBottom" }` appends the
      paid cards to the deck, so after it they ARE the last two cards — the same
      by-construction guarantee, at the other end of the same channel. What the
      row actually cost is **one WINDOW FORK, not one CHANNEL**.

      ⚠️ **THE FLOOR/DOMAIN COUPLING IS D342's `exact`, ONE ZONE OVER, AND THE
      GUARANTEE IS WEAKER — WHICH IS WHY IT IS WRITTEN DOWN RATHER THAN ASSUMED.**
      D342's rule: when two ops are coupled through a zone, the first one's FLOOR
      is the second one's DOMAIN. Here the domain is `n` and the floor is
      `payFromHand`'s `min(handSize, count)`. `searchDeck.exact` made that pair
      self-sufficient — the op itself refuses a short pick. This pair is NOT
      self-sufficient: the two agree only because `handCostUnmet` (cardplay.ts, a
      DIFFERENT FILE) refuses the play unless the full cost is payable. The
      registry program therefore sits the ordering inside the `recordGate` that
      already guards the draw, so a program run directly against a hand that
      cannot pay opens no window at all — but a future author pairing this fork
      with an op that has no such play gate owes the `exact` treatment, not this
      one. */
  | {
      op: "reorderTop";
      n: number;
      side?: "opponent";
      /** WHICH END of the deck the window sits at. Absent = the TOP (every
          printing D341 and D342 built). `"bottom"` is Kofu's, and it is the end
          the printed verb put the cards at. */
      from?: "bottom";
      /** 🆕🆕 **D344 — THE PRINTED `, or …`: A SECOND ARM THE PLAYER MAY TAKE
          INSTEAD OF ORDERING, RUN WHEN THE ORDERING ANSWER IS EMPTY.** Deduction
          Kit `sv08-171` (1 legal, `effect`, Item): *"Look at the top 3 cards of
          your deck and put them back in any order, **or** shuffle them and put
          them on the bottom of your deck."*

          🛑 **WHY THE ARM HANGS OFF THIS OP RATHER THAN OFF `optional`, WHICH IS
          THE CHEAP READING AND IS WRONG.** `optional { then, otherwise }` is a
          two-armed branch on a human answer and has been since D316 — but its
          park is `{ kind: "confirm", note }` and a `confirm` **CARRIES NO
          CANDIDATES**. The print hands the information over FIRST: *"**Look at
          the top 3 cards** of your deck **and** put them back in any order, or
          …"*. A confirm ahead of the ordering park would make the player choose
          **BLIND**, which is not a caption difference — it is the loss of the one
          thing the sentence gives before it asks. **THE PROMPT THAT ASKS THE `or`
          HAS TO BE THE PROMPT THAT DELIVERS THE LOOK**, and only `orderCards`
          resolves a window to the answerer alone (`redactPrompt`).

          🛑 **AND NO NEW PROMPT KIND IS OWED, BECAUSE `confirm`'s OWN DOC ALREADY
          SETTLED THE MEANING.** It records that *"a confirm answer means run
          `then` … a fact about the program"*, where a `mayDraw` answer is a fact
          about cards. A binary answer that picks between two printed arms is
          therefore a MEANING this engine already has; what `orderCards` lacked
          was a way to SAY the second arm. D341's rule — **a prompt kind is a
          claim about what an answer MEANS** — is what licenses reusing the kind,
          the same rule that refused `chooseCards` an ordering.

          **THE ANSWER SHAPE IS THE EMPTY ORDERING**, and it reads as the print
          does: *none of these cards is being put back on top*. `validateChoice`
          refuses an empty `orderCards` answer everywhere else (it demands a
          permutation of a window that is never smaller than 2), so `[]` is a
          value this prompt could not previously hold — it is given a meaning
          here rather than taken away from one.

          ⚠️ **A FLAT `EffectOp[]`, AND THAT IS CORRECTNESS RATHER THAN STYLE.**
          `subPrograms` (testFixtures.ts) discovers sub-programs by a NEGATIVE
          predicate over an op's own ARRAY-VALUED properties, and its doc names
          the one thing it cannot see: *"a program reached through a field that is
          NOT an `EffectOp[]`"*. Nesting these ops inside an object (`{ note, ops
          }`) would hide them from `walkProgram` and open a fourth instance of the
          population defect D341, D342 and D343 each repaired. The name is the
          four gates' own (`coinFlipGate` / `conditionGate` / `recordGate` /
          `optional`), so the carrier pin reads in the vocabulary it already has.

          ⚠️ **THE M1 GUARD NEEDS NO SECOND ARM AND THAT IS ARITHMETIC, NOT LUCK.**
          The park is refused at `top.length < 2`, and `top.length` is `min(n,
          deck.length)` — so for any `n ≥ 2` that refusal is EXACTLY "both arms
          are the same state": with 0 or 1 cards in the deck, shuffling the window
          onto the bottom of what is left of it changes nothing. The only board
          that separates the two tests is `n === 1` over a long deck, and no
          printed sentence offers an alternative to ordering ONE card. */
      otherwise?: EffectOp[];
      /** The printed second arm's own words, rendered as the alternative's
          button. REQUIRED-in-practice beside `otherwise` and optional in the
          type for the reason `optional.note` is authored rather than derived: a
          describer over the arm's ops would have to invent wording for every op
          it might ever hold, and the sentence is already sitting in the registry
          row. The pairing is asserted from outside rather than encoded here. */
      otherwiseNote?: string;
    }
  /** 🆕🆕 **D344 — "…**shuffle them and put them on the bottom of your deck**."
      THE TOP OF THE DECK MOVING UNDER IT, SHUFFLED.** Deduction Kit `sv08-171`'s
      second printed arm, and the only op in this union that moves cards from one
      end of a deck to the other.

      **`n` IS THE PRINTED WINDOW AND THE MOVE IS CLAMPED TO THE DECK**, exactly
      as every deck-top op here clamps: a deck shorter than `n` moves what it has.
      Nothing parks — *"shuffle them"* is precisely the ABSENCE of a decision
      about their order, which is the whole difference between this arm and the
      `reorderTop` it is printed against.

      🛑 **THE SHUFFLE IS OVER THE WINDOW ALONE AND NOT OVER THE DECK, AND THE
      DIFFERENCE IS THE WHOLE CARD.** `shuffleDeck` would destroy the deck order
      the player just declined to disturb; Iono's `handRefresh { toBottom }` is
      the precedent in the other direction and states the same rule — *"shuffle
      the HAND ALONE and append it UNDER the deck, leaving the deck's own order
      … untouched"*.

      ⚠️ **IT IS AN RNG CONSUMER, WHICH ONLY ONE OTHER `EffectOp` IN THIS UNION
      IS.** `shuffleDeck` advances `rngState`; so does this. That is why the arm
      cannot be spelled as a `reorderTop` with a forced answer: the print says
      the player does NOT choose. */
  | { op: "bottomDeckTop"; n: number }
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

      `restTo` is the LEFTOVERS DESTINATION — 🆕🆕 **D352 renamed it from
      `discardRest?: true`, which is the purchase the block below priced in
      advance and the reason it was written down.** Two printed values:
      `"discard"` is Hydreigon's *"**Discard** the other cards"* and
      `"shuffledBottom"` is Metang's *"**Shuffle** the other cards and put them on
      the bottom of your deck."*
      Its sibling clause "**Shuffle** the other cards back into your deck"
      (Electric Generator) is NOT a field: those cards never left the deck, so a
      trailing `shuffleDeck` op — which knows nothing about the window — gets it
      exactly right, the same Nest Ball search-then-shuffle pattern lookAtTopN
      and searchDeck follow. A DISCARD cannot be expressed that way, because it
      must name exactly the looked-at cards that were NOT attached, and only this
      op knows which those were: after k are attached the window holds n − k, and
      a "discard the top 3" op would eat k cards deeper in the deck. The
      asymmetry is forced by what the two clauses have to know, not chosen.

      🆕 🛑 **D335 — AND THIS FIELD IS ONE PRINTED CARD AWAY FROM BEING THE `restTo`
      UNION `lookAtTopN` NOW CARRIES.** Metang *"Metal Maker"* `sv05-114`/`svp-090`
      (**2 Standard-legal printings**, `abilities_json`; `instr(abilities_json,
      'Shuffle the other cards and put') > 0` is exactly these 2 rows of 3,786, both
      legal, and the same literal over `effect` returns only Rika's 3 out-of-Standard
      printings while `attacks_json` returns 0 — remote D1 `luminous`, 2026-08-14)
      prints *"…attach any number of Basic {M} Energy cards you find there to your
      Pokémon in any way you like. **Shuffle the other cards and put them on the
      bottom of your deck.**"* — the third leftovers destination, on THIS op. It is
      left a boolean today only because no AUTHORED row reaches a second value
      (D331), and the day Metang lands the field becomes
      `restTo?: "discard" | "shuffledBottom"` — narrower than `lookAtTopN`'s by one
      member, since no printing puts an unshuffled attach leftover under the deck.
      **The reason this is written down rather than left to be re-derived is that
      those two ids have sat in census row 11's `abilityIds` since D241 under the
      assumption that the ATTACH was what blocked them, and it never was.**

      ✅✅ **SPENT AT D352, TO THE LETTER AND FOR THE STATED PRICE.** Metang landed;
      the field is `restTo?: "discard" | "shuffledBottom"`, exactly the two members
      this paragraph named, and `attachFromTopApply` gained the fork below and
      nothing else. **The paragraph is annotated rather than rewritten** — its
      claim was true, it was cashed, and the record of a price that HELD is worth
      more than the space it costs. ⚠️ **The one thing it did NOT price is the
      `MATCH_RECORD_VERSION` bump** (20 → 21): this op PARKS, so a v20 record can
      hold `attachFromTop{…, discardRest: true}`, which under this deploy reads as
      `restTo === undefined` and silently leaves on top of the deck the cards Tri
      Howl printed *"Discard the other cards"* about. That is D309's rename case,
      and it is the SAME consequence one op over that D335 paid for itself — the
      pre-price named the field and missed the constant the field's persistence
      implies. **A PRICE THAT NAMES A FIELD HAS NOT THEREBY NAMED WHAT PERSISTS IT.**
      🆕 **And the census re-run at D352 makes the population sharper than D335
      could:** `instr(txt,'look at the top') AND instr(txt,'attach')` over all three
      columns is **4 sentences / 7 printings / 2 legal**, and BOTH legal printings
      are Metang. Tri Howl `sv02-140` is `legal_standard = 0`. So this op's entire
      Standard-legal population is the card that bought the field.

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
      /** The owner-prefixed subgroup (D204). No legal printing pairs this op with
          one yet — it is declared for the same reason the other riders are, that
          the op is structurally an `AttachTargetRiders` and the eligibility rule
          it reads is shared; an op that silently DROPPED the rider would be the
          drift `attachEnergyTargets` was factored out to prevent. */
      ownerPokemon?: string;
      /** 🆕🆕 **D352 — WAS `discardRest?: true`.** The leftovers destination, two
          printed values and no third:
          • `"discard"` — *"**Discard** the other cards."* (Hydreigon "Tri Howl"
            `sv02-140`, `legal_standard = 0`.)
          • `"shuffledBottom"` — *"**Shuffle** the other cards and put them on the
            bottom of your deck."* (Metang "Metal Maker" `svp-090`/`sv05-114`,
            **2 legal printings** — this op's whole Standard-legal population.)

          🛑 **NARROWER THAN `lookAtTopN`'s BY ONE MEMBER, AND THE ABSENCE IS
          D135's RULE RATHER THAN AN OVERSIGHT.** That op carries `"bottom"` for
          Drakloak's single unshuffled leftover; no printing puts an UNSHUFFLED
          attach leftover under the deck, so the value would have no observable
          meaning here and is refused (D331's speculative-field rule).

          🛑 **A SECOND KEY BESIDE `discardRest` WOULD HAVE BEEN A STATE WITH NO
          MEANING** — the call D335 made one op over, applied here rather than
          re-argued: two keys on one axis can be set to contradict each other and
          no reading of the print says what the contradiction means. */
      restTo?: "discard" | "shuffledBottom";
    }
  /** MILL: move the top `count` cards of `whose` deck into that same player's
      discard pile, in deck order (top first — the order the pile gains them, §2).
      D130's op, widened by D131; one of the event's THREE push sites (the others
      are `attachFromTop`'s `restTo: "discard"` above and `lookAtTopN`'s `restTo:
      "discard"`, added by D334 and renamed by D335 — 🆕 and the ATTACH one renamed
      the same way by D352, so the two ops now spell one axis with one key),
      and the one that supplies two of its FOUR paths — `whose` is a fork, not a
      parameter. The event's `seat` is the deck's OWNER on all four; its `actor` is
      the player whose card did it (D153), so `whose: "self"` sits with Tri Howl and
      Explorer's Guidance on `actor === seat` and only `whose: "opponent"` is the
      case where the two differ. That comparison, not the op boundary, is what
      log.ts's voice hangs off — and D334 is why it is stated that way: a third op
      joined the event and the renderer needed no arm.

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
      /** 🆕🆕 **D354 — WIDENED TO `string | readonly string[]` ON THIS OP ALONE**,
          because this op alone has the printing: Steven's Metagross ex `sv10-145`
          "X-Boot" is the catalog's ONE two-type attach target. `attachFromTop`
          and `attachEnergyFrom` keep the bare `string` — D331's speculative-field
          rule, the same one that keeps `restTo` to two members — and both stay
          assignable to the widened `AttachTargetRiders`, which is where the rule
          and its proof live. */
      targetType?: string | readonly string[];
      benchOnly?: true;
      /** The owner-prefixed subgroup the attach may land on — Marnie's Grimmsnarl
          ex's "attach them to your **Marnie's** Pokémon in any way you like"
          (D204). Declared here as well as on `attachEnergyFrom` because each op
          spells only the riders its printed cards use while being structurally an
          `AttachTargetRiders`; the RULE is still spelled once there and read once
          in `attachEnergyTargets`, which is what keeps the two ops from ever
          disagreeing about who is eligible. ⚠️ IGNORED under `toSelf`, exactly as
          `targetType`/`benchOnly` are — the source ref is not filtered. */
      ownerPokemon?: string;
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
  /** ⚠️⚠️ D247 — ATTACH **ANY NUMBER** OF ENERGY OUT OF YOUR **HAND**, each card
      naming its own destination: Alolan Exeggutor ex `sv08-133`/`-225`/`-242`/
      `-248` "Tropical Frenzy" — *"You may attach **any number of** Basic Energy
      cards **from your hand** to your Pokémon **in any way you like**."*
      (4 legal attack printings on ONE sentence, backlog row 12's largest).

      🛑 **THIS IS THE ZONE AXIS ON THE COMPOUND-PARK FAMILY, AND THAT IS THE ONE
      DESIGN CALL THIS SLICE MAKES.** The obvious reading — that this is a rider
      on `attachEnergyFrom`, which already carries `source: "hand"` — is wrong,
      and the printed sentence says which words make it wrong:

      * *"in any way you like"* means each card names its OWN destination, so the
        answer is a MAP from card to Pokémon. `attachEnergyFrom` parks on a single
        `pokemon` ref and its `count` pins a whole batch onto that ONE body (D205);
        the map is the `attachCards` prompt, which `attachFromTop` and
        `attachFromDeck` already produce and this op is the THIRD producer of.
      * *"any number"* names no unit, so D205's other model — N SEPARATE
        `attachEnergyFrom` ops, one per printed unit, which is how
        `DISCARD_ATTACH_DESTINATIONS`' `anyWay: true` rows are read at a printed
        count — cannot be built either: there is no N to unroll, and the player
        must be able to answer "how many" as part of the same decision.

      So what this printing needs is `attachFromDeck`'s shape over a different
      candidate ZONE, which is exactly the axis that already separates
      `attachFromTop` (a window on the deck) from `attachFromDeck` (the whole
      deck). **A third zone is a third op, not a fourth field**, for the reason
      D234 wrote down one op over: two ops disagree about what a destination
      phrase can MEAN, and welding a compound park onto `attachEnergyFrom` would
      give that op two answer shapes chosen by a field value.

      ⚠️ **NO `max` FIELD, AND THE ABSENCE IS THE PRINT.** `attachFromTop` and
      `attachFromDeck` both carry one because both have printings that spell "up
      to N"; every sentence THIS op reads spells "any number", so the cap is the
      candidate set and a `max` here would be vocabulary no board reads (the
      standing rule, and D135's "absent rather than written out"). The two legal
      printings that DO spell a hand-source count with "in any way you like"
      (`sv08-079`/`-204`, *"Attach up to 2 Basic {P} Energy cards from your hand
      to your Pokémon in any way you like."*) are NOT re-homed here: they are
      already built, as 2 separate `attachEnergyFrom` ops, and the sequential
      model is observably equivalent at a printed count — each op parks on its own
      target, so the same splits are reachable. ⚠️ **FLAGGED ASSUMPTION**: the two
      models differ in that the sequential one asks N questions in sequence where
      this asks one compound question, so a player cannot revise an early pick.
      Evidence for leaving them: D205 chose the sequential model deliberately and
      four suites assert it. Evidence against: a compound park is strictly better
      UX and would make one reading of "in any way you like" instead of two.
      Pinned by `D247-any-number-rehomes-the-printed-count`, which installs the
      other reading and must be killed by the arm refusing a printed digit.

      `filter` is the printed noun — `basicEnergy` for "Basic Energy cards",
      `basicEnergy` + `energyType` for `sv04.5-067`'s "Basic {M} Energy cards"
      (0 legal, read anyway: an arm transfers across sets, D180/D187). NEVER
      `providesEnergy` — a card in the hand provides nothing (§6.5), the same call
      `attachFromTop`'s doc makes for the same reason.

      ⚠️ **NO TARGET RIDER IS DECLARED, AND THAT IS THE PRINT.** Every sentence
      this op reads spells the bare *"to your Pokémon"* — no zone word, no type,
      no owner prefix — so the op carries none of `AttachTargetRiders`' fields
      (D135: a field with no printing behind it is a branch no test can witness,
      and `attachFromTop`'s speculative `ownerPokemon` is the counter-example this
      slice declines to copy). The RULE is still the shared one: the eligible
      targets come from `attachEnergyTargets`, the single reader all four attach
      ops go through, so the un-narrowed set here cannot drift from the narrowed
      sets there. The day a printing spells "your Benched {W} Pokémon", the field
      and the argument at `attachFromHandOffer` are the whole edit.

      **NO `programPlayable` GATE, and here the reason is NOT `attachFromTop`'s.**
      That op is ungated because every carrier prints a leftovers clause that
      always resolves; this one prints no second clause at all. It needs no gate
      because `programPlayable` is only ever asked of a TRAINER play or an ABILITY
      use (cardplay.ts — three call sites, all of them card plays), and every
      printing of this sentence is an ATTACK, whose effect is never vetoed for
      whiffing. A future Ability printing would want the gate and would be the
      first card in the family to earn one.

      Never damages, so it never KOs; and it is not the §6.3 manual attach, so no
      allowance is touched. */
  | {
      op: "attachFromHand";
      filter: CardFilter;
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
          ✅ **COLLECTED AT D222 — the paragraph above is kept verbatim (D178:
          provenance is annotated, never overwritten) and its last clause is now
          FALSE.** Iono's Kilowattrel prints exactly that card, so the arm it
          predicted is the `self` member below, and it reads `ctx.sourceUid`
          through the reader that paragraph named;
        • **`self`** — the ONE Pokémon the program is printed on, resolved by
          UID rather than by spot: *"You must discard a Basic {L} Energy from
          **this Pokémon** in order to use this Ability"* (Iono's Kilowattrel).
          The difference from `yourActive` is the whole reason it exists — that
          member means "this Pokémon" only inside an ATTACK, where §8 makes the
          actor the Active; an ABILITY carries no such clause, so a benched host
          would pay its cost off whichever body happened to be Active and would
          be usable while holding no matching Energy itself. Reads `sourceRef`,
          the same 0-or-1 ref list `attachFromDeck.toSelf` and
          `attachEnergyFrom.toSelf` read, so "this Pokémon" cannot come to mean
          three things on three ops. An empty answer (no source uid — a Trainer —
          or a host that is no longer a board TOP) is the op's ordinary whiff.

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
          Active.

          `self` — the program's OWN Pokémon by uid (D222), which is the printed
          "this Pokémon" everywhere §8 does not already make it the Active. The
          three own-board members are therefore a spot (`yourActive`), a side
          (`yours`) and a body (`self`), and they are NOT interchangeable: on a
          board where the host is benched, `yourActive` strips a different
          Pokémon and `yours` offers six. */
      from: "opponentActive" | "opponentChosen" | "yourActive" | "yours" | "self";
      filter: CardFilter;
      /** 🆕 **D295 — WHERE THE ENERGY LANDS, AS ONE OPTIONAL FIELD ON THE OP THAT
          ALREADY TAKES IT OFF.** ABSENT = the DISCARD PILE, which is what this
          op's NAME says and what every printing before this slice does. `"hand"`
          = the VICTIM'S OWN HAND — Chill Teaser Toy `sv08-166` (Item): *"Put an
          Energy attached to 1 of your opponent's Pokémon into their hand."*

          🛑 **THE DESTINATION IS THE VICTIM'S ZONE, NOT THE ACTOR'S, AND THAT IS
          WHY IT IS ONE FIELD AND NOT A SEAT.** `discardEnergyApply` already
          resolves EVERY zone it writes against `discardVictimSeat` — the hammer
          family discards to the OPPONENT'S OWN pile, never to the actor's — so
          the seat question was answered before this field existed and the only
          open question is WHICH of that seat's zones. Contrast D294's
          `bottomFromOpponentHand.dest`, where the op's source is the opponent
          and the destination genuinely CROSSES seats. **THE BACKLOG GROUPED
          THESE TWO CARDS AS ONE "CROSS-SEAT ZONE" ROW AND ONLY ONE OF THEM
          CROSSES A SEAT.**

          ⚠️ **A FIELD ON THE OP RATHER THAN A SECOND OP** for D294's reason
          verbatim: the offer, the §11 refusal, the shield filter, the
          interchangeable collapse, the park and the §9.2 record are all
          destination-independent — only the last statement of the apply and the
          caption branch. A twin op would have copied six behaviours to change
          one, and a `preventDamage`-style reader would then have had to learn
          two names for one action.

          ⚠️ **NOT AVAILABLE ON THE `opponentEach` ARM BELOW**, whose `count?:
          never` shape exists to make an unrepresentable combination
          unrepresentable rather than merely undocumented; no printed sweep puts
          Energy back into a hand, and inventing the pairing would be authoring a
          card. */
      to?: "hand";
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
      /** D295 — unrepresentable here for `count`'s reason: no printed sweep
          returns Energy to a hand, and the apply's caption would have to invent
          a sentence no card prints. */
      to?: never;
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
      on-evolve flick) layers on later.

      `koedActiveToToolHolder` (D171) is Exp. Share sv01-174's "move a Basic Energy
      from that Pokémon [your Active, being Knocked Out] to the Pokémon this card is
      attached to" — the FIRST route whose destination is pinned by UID rather than
      by SPOT. Sources are the controller's ACTIVE alone; the sole destination is the
      in-play Pokémon carrying `ctx.sourceUid` (the TOOL's own uid — a Tool's printed
      subject is "the Pokémon this card is attached to", which is not the `sourceRef`
      "this Pokémon" every other op means). One decision survives (WHICH Energy), so
      it parks on the very same compound prompt and the wire validator, the dialog and
      `moveEnergyApply` all stay untouched. The Active is EXCLUDED as a destination:
      a self-attached Exp. Share has no second Pokémon to name and moves nothing.

      `anySource` (D226) RELAXES THE SINGLE-SOURCE COUPLING, and it is a rider on
      the COUPLING rather than a third `route` because it answers a different
      question: a `route` fixes WHICH ENDPOINTS are offered, `anySource` says HOW
      MANY of the offered sources ONE ANSWER may draw from. N's Plan
      (`sv10.5b-083`/`-163`/`-170`, 3 Standard-legal printings) is `benchToActive`
      PLUS `anySource` — "Move up to 2 Energy from your Benched **Pokémon** to your
      Active Pokémon", PLURAL, so one Energy off each of two benched bodies is a
      legal paper play. Without the rider `validateChoice` refuses exactly that
      answer ("every Energy must come from the same Pokémon"), which would leave
      the card legal-and-unanswerable rather than merely unbuilt.

      ⚠️ IT RIDES THE PROMPT AS WELL AS THE OP, AND THAT IS THE WHOLE PRICE OF IT.
      The wire validator, the wire schema and BOTH HUD dialogs read the PROMPT and
      never the op, so a rider the prompt does not carry is a rider nothing
      downstream can honour — D222's and D223's lesson applied before the fact: a
      field is cheap, a field its readers cannot see is not.

      Every other endpoint rule is untouched. A Pokémon still may not move Energy
      onto ITSELF: with one source that test is "source ≠ destination", and with
      many it is the SAME test per pick — the generalisation, not a waiver. And
      `moveEnergyApply` emits one `ENERGY_MOVED` PER SOURCE, so the event's promise
      that all of its `uids` came off the one `from` survives verbatim.

      AUTHORING NOTE: the rider is independent of `route`, so `anySource` on the
      FREE route is representable and matches no printed card — a three-column
      `json_each` census of the remote D1 `luminous` on 2026-08-05 finds exactly
      ONE multi-source move sentence in 3,786 rows, and it is N's Plan's. The
      registry is the only author, so this is a caution, not a hole (the
      `handRefresh` note's reasoning, verbatim).

      `selfToBench` (D229) is `benchToActive` READ BACKWARDS — "Move an Energy
      from **this Pokémon** to 1 of your Benched Pokémon", 13 Standard-legal attack
      printings over three sentences (Iron Thorns ex "Volt Cyclone", Volcanion ex
      "Scorching Cyclone", Yanmega ex "Jet Cyclone", Tornadus "Hurricane", …). The
      sources are the ATTACKER and the destinations are that seat's Bench, so
      source and destination are disjoint by construction and ONE destination is
      enough — `benchToActive`'s argument with the endpoints swapped.

      ⚠️ ITS SOURCES ARE **THE ACTIVE**, AND THAT IS A CLAIM ABOUT THE PRINTINGS
      RATHER THAN A SHORTCUT. "This Pokémon" is a UID question everywhere else in
      this engine (`discardEnergy { from: "self" }`, `attachEnergyFrom`'s SELF
      target), and it is answered here by the SPOT because **every one of the 13 is
      ATTACK text**: §8 lets only the Active declare an attack, so `sourceRef` and
      "the Active" name the same body on every board this route can reach. Resolving
      it through `ctx.sourceUid` instead would be a distinction NO board can
      witness — an unkillable line, which conventions.md says to write down rather
      than to write. The day a benched body's ABILITY prints this sentence, the
      route grows a uid and `moveEnergyPlayable` grows the parameter with it.

      ⚠️ AND THE FAMILY'S OTHER THREE LEGAL PRINTINGS ARE **NOT** THIS ROUTE'S, for
      reasons about `max` rather than about the endpoints:
        • "Move **all** Energy from this Pokémon to 1 of your Benched Pokémon."
          (`sv08-020`/`-195` Castform, 2 legal) — `max` is a NUMBER and a deriver
          has no board, so "all" has no value to write. (`attachFromTop` already
          spells the answer — `max: "any"`, clamped to the candidate count at the
          moment the op runs — so this is a shape the engine knows and not a new
          idea; it is simply a second reader's worth of change on an op whose
          prompt four surfaces read, for two printings.)
        • "Move all Energy from this Pokémon to **your Benched Pokémon in any way
          you like**." (`sv08-067` Kilowattrel, 1 legal) — that, plus the
          destination-side mirror of `anySource`: one answer spread over MANY
          destinations, which the compound prompt (one `dest`) cannot say.

      ⚠️ WHAT THIS ROUTE INHERITS AND DOES NOT FIX: the whole family is
      DECLINABLE, so "Move 3 Energy" is offered as *up to* 3 and the player may
      move none. That is the op's standing approximation (Energy Switch prints a
      bare "Move a Basic Energy…" and has been declinable since M4), not something
      this slice introduces — but it is written down here because the three
      sentences above are the first where a `max > 1` makes the gap visible in the
      PROMPT, which says "Move up to 3 Energy" where the card says "Move 3".

      `othersToSelf` (D244) is `selfToBench` READ BACKWARDS AND WIDENED AT BOTH
      ENDS — Iron Leaves ex's *"you may move **any amount** of Energy from your
      **other** Pokémon to **this** Pokémon"* (6 legal ABILITY printings). Sources
      are every own in-play body EXCEPT the source, the sole destination is the
      source, and the printed plural "your other Pokémon" makes it `anySource` as
      well, so ONE answer may sweep the whole board onto one target.

      🛑 **A FLAGGED EQUIVALENCE, MEASURED AND WRITTEN DOWN RATHER THAN GLOSSED:
      ON ALL SIX PRINTED BOARDS THIS ROUTE'S ENDPOINTS COINCIDE WITH
      `benchToActive` + `anySource`.** The tail sits behind a `recordGate` on the
      switch, so it only ever runs AFTER the source became the Active — and at
      that moment "every own body except the source" IS the Bench and "the source"
      IS the Active. The two readings are equal on every board Iron Leaves can
      reach, which is the `selfToBench` situation exactly (its doc: an unkillable
      distinction is a line to write DOWN, not to write).

      ⚠️ **IT IS STILL SPELLED AS ITS OWN ROUTE, FOR TWO REASONS AND NOT ONE.**
      (1) `moveNote` needs a distinguishing token whatever happens — the printed
      words are "from your other Pokémon to this Pokémon", not "from your Benched
      Pokémon to your Active Pokémon" — so the choice is between this route and a
      wording field that means the same thing less honestly. (2) The equality is a
      fact about a SENTENCE ORDER, not about a rule: the day a card prints this
      tail WITHOUT a switch in front of it, `benchToActive` silently moves Energy
      onto the wrong body, where this route follows the uid. **The separating
      board is constructed and driven** (`fix-othersmove`, a bare `othersToSelf`
      used from the BENCH — sources include the Active, the destination is a
      benched body), and the other reading is installed as a mutant, so the
      equivalence is pinned rather than assumed.

      ⚠️ **ITS DESTINATION IS `ctx.sourceUid`, NOT A SPOT, AND THAT IS THE LINE
      `selfToBench`'s DOC SAID WOULD COME** — *"the day a benched body's ABILITY
      prints this sentence, the route grows a uid"*. `sourceRef` re-reads the
      CURRENT board, so it is right whether the body is benched (the constructed
      case) or Active (every printed one).

      ⚠️ **`max: "any"` IS "ANY AMOUNT", AND IT IS `attachFromTop`'s SPELLING
      RATHER THAN A NEW IDEA** — clamped to the candidate count at the moment the
      op runs, so the PROMPT still carries a number and no wire shape moves.
      `selfToBench`'s doc names Castform's *"Move **all** Energy"* as blocked on
      exactly this; that sentence is now representable (it is `max: "any"` with a
      mandatory-vs-declinable question left standing) and stays unbuilt because
      the declinability gap, not the number, is what it is waiting on. */
  | {
      op: "moveEnergy";
      filter: CardFilter;
      /** `"any"` is the printed "any amount" — clamped to the movable count when
          the prompt is built, exactly as `attachFromTop` clamps to its window. */
      max: number | "any";
      route?: "benchToActive" | "koedActiveToToolHolder" | "selfToBench" | "othersToSelf";
      /** Let ONE answer take Energy off SEVERAL of the offered sources (N's Plan's
          printed "from your Benched Pokémon", plural). Absent = the single-source
          coupling every other printed member of this family carries. */
      anySource?: true;
    }
  /** Put the affected player(s)' whole hand back into their deck, then draw — the
      Iono/Judge hand-refresh Supporter family. `who: "you"` affects the controller
      only (Youngster: draw 5; Katy: draw 8; Brassius: draw hand+1); `who: "both"`
      affects BOTH players (Judge: "Each player shuffles their hand into their deck
      and draws 4"; Iono) — the ops that reach the OPPONENT's hand/deck; and
      `who: "opponent"` affects the OTHER seat ALONE (D268, Gothitelle "Distorted
      Future": *"…you may have your opponent shuffle their hand into their deck and
      draw 3 cards"* — the disruption without the controller paying for it). `draw`
      is how many each affected player then draws, measured off THAT player's OWN
      pre-move hand (handPlus) or Prize count (prizeCount) — or, since D270, read
      out of a printed PAIR by whether that player is the CONTROLLER (perSeat).

      ⚠️ **ONE `draw` FIELD FOR EVERY AFFECTED SEAT — BUT SINCE D270 THAT FIELD CAN
      ANSWER PER SEAT.** Three of its four members are one number for everybody
      (`fixed`) or one RULE evaluated per seat against that seat's own board
      (`handPlus`, `prizeCount`); `perSeat` is the ASYMMETRIC printing — *"you draw
      5 cards, and your opponent draws 3 cards"* (Harlequin `sv10.5w-083`/`-163`,
      inside a coin gate that swaps the pair on tails). ⚠️ **THE WIDENING WENT ON
      `draw` AND NOT ON `who`**, and the reason is that Harlequin, Unfair Stamp
      (5/2) and Team Rocket's Archer (5/3) ALL open *"Each player shuffles their
      hand into their deck"* — the seat set is `"both"`, unchanged; only the count
      splits. `who: "opponent"` still must not be authored onto any of them.
      ⚠️ Unfair Stamp `sv06-165` and Team Rocket's Archer `sv10-170`/`-223` are
      STILL unbuilt after D270, and NOT for this reason: both print *"You can use
      this card only if any of your Pokémon were Knocked Out during your opponent's
      last turn"*, a play gate no `BoardCondition` spells and `GameState` carries no
      datum for (grepped at D270 — there is no last-turn-KO field). Their DRAW is
      now expressible; their GATE is not.

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
      /** Which seats' hands go back. `"you"` is the controller alone (Youngster,
          Brassius, Katy); `"both"` is every seat (Judge, Iono); `"opponent"` is
          the OTHER seat alone — D268, Gothitelle "Distorted Future": *"…you may
          have your opponent shuffle their hand into their deck and draw 3
          cards."* The third member is a NARROWING of `"both"`, not a new
          mechanism: the executor already walks a seat LIST and every event it
          emits is already per-seat and count-only, which is what made the
          opponent's hand reachable in the first place (Judge, D-M5). The spelling
          copies `disableAbilities.side: "both" | "opponent"` in `registry.ts` —
          the same axis, already named, one interface over. */
      who: "you" | "both" | "opponent";
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
      paying card sits, and the printed wordings MOSTLY agree: the Trainers in the
      family say "other"/"another" and the Abilities say neither, because a
      Trainer is IN THE HAND it is about to pay out of and an Ability's card is on
      the board.

      🆕🛑 **D343 — KOFU IS THE COUNTEREXAMPLE, AND IT WAS ALREADY IN THE REGISTRY
      WHEN THIS PARAGRAPH SAID "EVERY".** `sv07-138`/`-165` is a SUPPORTER whose
      gate prints *"(If you can't put 2 cards **from your hand** on the bottom of
      your deck, you can't use this card.)"* — no "other", no "another". The
      ENGINE is right about it either way (the played uid is excluded at the gate
      because playTrainer has already committed the card, so Kofu cannot pay
      itself), and the RULING is right too — a card being played is not in the
      hand it is being played from. What was wrong was the stated CORRELATION, and
      it was wrong at the head that wrote it rather than rotted into wrongness
      later. **A DOC THAT SAYS "EVERY PRINTING" IS AN ASSERTION ABOUT THE CATALOG,
      AND IT OWES THE SAME RE-DERIVATION A COUNT DOES** — the census that would
      have caught it (`instr(effect,'from your hand on the bottom of your deck')`)
      is one query and returns six rows.

      Dendra is the correlation's third witness and the sharpest, since
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
      /** 🆕 **D294 — WHERE THE CHOSEN CARD GOES, AND THE OP'S FIRST DESTINATION
          FIELD.** Absent = the bottom of the OWNER's deck, which is what this op
          has meant since M5 and what its NAME still says. `"bench"` is Mandibuzz
          `sv10.5w-064`/`-145` "Look for Prey" — *"Your opponent reveals their
          hand, and you put a Basic Pokémon with 70 HP or less that you find there
          onto your opponent's Bench."*

          🛑 **A WIDENING OF THIS OP RATHER THAN A NEW ONE, AND THE ARGUMENT IS
          THAT THE FIRST THREE QUARTERS OF THE SENTENCE ARE THE SAME SENTENCE.**
          Reveal the whole hand FIRST, then pick ONE card matching a printed
          filter out of the OPPONENT's hand, then move it into a zone THEY own.
          Ortega/Greavard and Mandibuzz differ in exactly one noun — the zone —
          and every other part (the reveal's ordering, the interchangeable-class
          collapse in the offer, the live-hand re-read in the apply, the
          one-representative park, `recordAs`) is shared line for line. A second
          op would have been three copies of that machinery for one word.

          ⚠️ **THE NAME IS NOW WIDER THAN THE OP AND IT IS KEPT ANYWAY.** Renaming
          it (`fromOpponentHand`) would touch the union, two interpreter arms,
          `recordSlotOf`, the §9.2 gate phrase, the registry, the deriver arm and
          every mutant row anchored on the word — a rename whose only product is a
          better noun. The DEFAULT is what the name describes, so a reader who
          knows only the name reads the unmarked op correctly; the marked one
          announces itself in the data.

          🛑 **IT IS AN OPTIONAL FIELD ON AN OP THAT PARKS, WHICH IS THE ONE SHAPE
          THAT HAS TO BE ARGUED AGAINST `MATCH_RECORD_VERSION`.** A parked
          `bottomFromOpponentHand` rides `phase.cont`, which IS persisted. But the
          test this repo applies is *"can the PREVIOUS deploy's RECORD hold the new
          TYPE"* (apps/api/src/lobby/match.ts): a version-16 continuation carries
          NO `dest`, this build reads that as `undefined`, and `undefined` is the
          bottom-of-deck the old record was written under. The old bytes mean in
          this deploy exactly what they meant in the last one, so the version does
          NOT move — and D294 DRIVES that round trip in both directions with a
          literal key anchor rather than asserting it.

          ⚠️ **NO `"hand"` MEMBER.** *"…put it into their hand"* is Chill Teaser
          Toy's sentence and it moves an ATTACHED ENERGY, not a hand card — a
          different source, a different op (`discardEnergy`'s `from:
          "opponentChosen"`) and refused by D294 by name. A member no printing
          reaches is an arm no board drives. */
      dest?: "bench";
      /** 🆕 **D297 — THE PRINTED "UP TO N", AND THE FIRST TIME THIS OP'S PICK IS
          NEITHER EXACTLY-ONE NOR MANDATORY.** Absent = the M5 shape every earlier
          printing spells: *"you choose **a** card"* / *"you put **a** Basic
          Pokémon"* — one card, and the pick is compulsory. Present = Lickitung
          `sv05-124`/`-180` "Tongue Pull" (**2 legal printings**, the whole
          population of the phrase): *"Your opponent reveals their hand. Put up to
          **2** Basic Pokémon you find there onto your opponent's Bench."*

          🛑 **ONE FIELD AND NOT TWO, BECAUSE "UP TO" IS ONE PRINTED PHRASE.** It
          carries the COUNT *and* the DECLINE together: the park reads
          `min: 0, max: upTo` where the unmarked op reads `min: 1, max: 1`. A bare
          `max?: number` (which is what four handoffs predicted) would have been
          the worse name for a reason this op has and `searchDeck` /
          `discardPileRetrieval` / `lookAtTopN` do not — on THOSE three the park's
          `min` is 0 unconditionally, so `max` alone is the whole story, whereas
          here `max: 1` would be indistinguishable from the mandatory M5 pick while
          meaning something else entirely. The field is falsifiable in D231's
          sense: both branches are printed, on 5 legal printings and 2.

          🛑 **AND IT REACHES TWO PLACES THAT ARE NOT THE PARK.** (1) The offer
          collapses interchangeable cards to ONE representative per class, which is
          sound only while one card is taken — DRIVEN at D297 rather than argued:
          an opponent hand of TWO copies of one printed Basic offers ONE candidate
          today, so *"up to 2"* over it could put at most one body on the Bench and
          the second copy is unreachable. The offer therefore keeps `upTo`
          representatives per class (`interchangeableCandidates`' `cap`, the same
          rule one file-screen away). (2) The one-candidate AUTO-RESOLVE has to
          stop: an offer of size 1 under a declinable pick must still be ASKED, or
          the effect resolves without the controller ever being able to say no —
          and on the same-copies board above that auto-resolve was ALSO what
          silently robbed the opponent. Both are conditioned on this field, so the
          five printings that do not print "up to" keep every line they had.

          🆕 🛑 **D350 — THE THIRD PRINTED FORM, `"any"`, AND THE WHOLE PRICE OF
          THE ROW.** Lillie's Ribombee `sv09-067`/`sv09-164`/`svp-183` "Inviting
          Wink" (**3 legal printings on one byte-identical sentence**, the largest
          of this mechanism's three legal sentences): *"…you may have your opponent
          reveal their hand and you put **any number of** Basic Pokémon you find
          there onto their Bench."* The field's three values are now exactly the
          three the catalog prints — ABSENT (Mandibuzz's "a Basic Pokémon", Erika's
          Invitation's, 0 legal), a NUMBER (Lickitung's "up to 2", 2 legal) and
          `"any"` (3 legal) — which closes the mechanism at **3 of 3 legal
          sentences / 7 of 7 legal printings** over all three text columns (remote
          D1 `luminous`, 2026-08-15: `reveal…hand` AND `onto their Bench` OR `onto
          your opponent's Bench` returns 4 sentences / 10 printings / 7 legal).

          🛑 **THE NO-NEW-VOCABULARY REFUTATION, RUN FROM SOURCE, FAILED ON THE
          CAPTION AND NOT ON BEHAVIOUR — AND THE DISTINCTION IS THE ARGUMENT FOR
          THE MEMBER.** `BENCH_MAX` is 5 and the park already clamps to the live
          `benchSpace`, so `upTo: 5` would BEHAVE identically at every legal board:
          a numeric cap of 5 can never bind. It is refused because this op's note
          is grown ONE PRINTED FORM PER CARD and round-trips to the catalog text
          (interpreter.ts `bottomFromOpponentHandNote`) — `upTo: 5` captions the
          card with a number it does not print, and makes it indistinguishable from
          a future card that DOES print *"up to 5"*. **A behaviourally-equal
          spelling that lies in the dialog is not a saving.**

          ⚠️ **IT IS `discardEnergy.count`'s OWN `"any"`, NOT A NEW IDEA** — that
          union has carried the member since M5 for the identical printed word
          ("you may discard **any amount**", Chien-Pao ex), with the identical
          consequence: 0 up to every match, so the pick is ALWAYS declinable and
          the op always parks on a non-empty offer. One printed word, one spelling,
          on the second op that prints it.

          ⚠️ **IT REACHES THE SAME TWO NON-PARK PLACES THE NUMBER DOES, AND NO
          OTHERS.** The offer's per-class `cap` becomes `BENCH_MAX` (the true
          ceiling of what can land — the offer already returns EMPTY on a full
          opponent Bench, so nothing wider could ever be picked), and the park's
          `max` becomes the OFFER's own size clamped by `benchSpace`, because a
          sentence with no number has no other ceiling. `min` and the
          auto-resolve guard are untouched: both test `upTo === undefined`, which
          `"any"` is not, so the declinable branch they already had is the branch
          this member wants. */
      upTo?: number | "any";
    }
  /** ⚠️⚠️ D232 — THE OPPONENT'S HAND GOES FACE UP AND NOTHING ELSE HAPPENS.
      "Your opponent reveals their hand." is the WHOLE printed effect on **7
      Standard-legal attack printings** (Hoothoot `sv05-126`, Shinx `sv06-066`,
      Drowzee `sv06.5-016`, Espurr `sv08-084`, Pidove `sv10.5b-071`/`-148`, Yanma
      `svp-185`), and until now the reveal existed only INSIDE
      `bottomFromOpponentHand` — an op that also asks a question and moves a card.
      This is that op's first half, standing alone.

      NO FIELDS, AND THAT IS THE POINT: the sentence has no noun, no number and no
      filter, so the op has nothing to carry. It never parks (a reveal is not a
      decision), it moves no card, and it emits exactly one `HAND_REVEALED` naming
      every uid — the same event `bottomFromOpponentHand` emits, through the same
      `revealHand` helper, so the two producers cannot drift (D222's rule about
      two readers of one fact).

      **WHERE THE INFORMATION GOES, WHICH IS THE ONLY INTERESTING QUESTION HERE.**
      Nowhere in the redacted state — `redactedSideOf` hides the opponent's hand
      UNCONDITIONALLY, and correctly: the printed reveal is INSTANTANEOUS (the
      cards go back face-down the moment it is over), so a build that opened the
      hand in the projection would be lying about every later turn. The reveal is
      a LOG fact, and `log.ts`'s `HAND_REVEALED` row — the one hand row that names
      cards — is the whole channel. So this op costs `redact.ts` ZERO, which is
      the opposite of what the backlog row predicted, and it is DRIVEN rather than
      argued (`opponentHandFamily.test.ts`).

      AN EMPTY HAND REVEALS HONESTLY AS ZERO UIDS rather than resolving silently.
      That is NOT the M1 no-choice rule — there is no choice here to retire — and
      the log's "revealed their hand — no cards" row has existed (unreached from
      an attack) since M5. */
  | { op: "revealOpponentHand" }
  /** ⚠️⚠️ D232 — ONE CARD TAKEN AT RANDOM OUT OF THE OPPONENT'S HAND, and the
      FIRST op in this engine whose OUTCOME is drawn from `rngState` rather than
      read off the board. Two printed sentences, one op, told apart by `to`:
        · `discard` — "Discard a random card from your opponent's hand." (**8
          legal**: Mienfoo `sv07-083`, Espeon ex `sv08.5-034`/`-155`/`svp-175`,
          Tyranitar ex `sv08.5-064`, Team Rocket's Chingling `sv10-085`, Liepard
          `sv10.5w-056`/`-137`).
        · `deck` — "Choose a random card from your opponent's hand. Your opponent
          reveals that card and shuffles it into their deck." (**5 legal**:
          Snorunt `sv06-051`, Rotom `sv10-077`/`-197`, Team Rocket's Meowth
          `sv10-149`/`-203`).
      ONE FIELD, TWO VALUES, BOTH PRINTED — the falsifiability test D231 wrote
      down: a `to` with only one reachable value would be an unkillable mutant.

      **NO `count`.** Every Standard-legal printing takes exactly one card; the
      only "Choose 2 random cards…" printing in the whole 3,786-row catalog is
      ROTATED. D104's minimal-shape rule: a field no printing can set is a field
      whose absent branch nothing drives.

      **NEVER PARKS, AND THAT IS WHAT "RANDOM" MEANS.** Nobody chooses — not the
      controller (they may not even know what is in there) and not the owner. The
      engine picks, which is why this op and not a `chooseCards` prompt is the
      right shape: `bottomFromOpponentHand` reveals FIRST precisely so its pick
      can be made in the open, and this one must not, because a reveal-then-pick
      would be a different card's text.

      **THE SEED DISCIPLINE, ASKED BEFORE THE OP WAS WRITTEN.** The pick is
      `randomIndex` over the owner's live hand, threaded through `state.rngState`
      like every shuffle and flip — so the same seed and the same actions replay
      to the same card, and `MatchRecord` (which persists the whole `GameState`,
      `rngState` included) needs NO `MATCH_RECORD_VERSION` move. An
      `Math.random()` here would have broken online replay silently; the rule
      rng.ts's own header states is what makes this a null result rather than a
      version bump.

      **THE CARD IS NAMED EITHER WAY** (`RANDOM_CARD_TAKEN` carries the uid), and
      for two different printed reasons: `discard` lands it in the §2 public
      discard pile, and `deck` prints "Your opponent reveals that card" outright.
      `deck` then shuffles the owner's deck — a real `SHUFFLE` event on their
      seat, so the position the card went to is lost exactly as at a table.

      AN EMPTY OPPONENT HAND TAKES NO CARD, EMITS NOTHING **AND ADVANCES NO
      RNG** — the last clause is the load-bearing one (a build that burned a draw
      on the whiff would desync two otherwise identical replays), and the three
      are held by TWO SEPARATE GUARDS rather than one; see the interpreter helper,
      whose own comment was corrected by a mutant that turned out equivalent. */
  | { op: "randomFromOpponentHand"; to: "discard" | "deck" }
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
    }
  /** THE PRINTED "**You may** …" AS A GATE WHOSE CONDITION IS A HUMAN ANSWER.
      `then` runs when the controller says yes, and nothing runs when they say no
      — the FOURTH GATE, and mechanically the same one runProgram already builds
      three times: `coinFlipGate` splices on a coin, `conditionGate` on the board,
      `recordGate` on what an earlier op filed, and this one on the answer to a
      `confirm` prompt. Not a rider on the inner op, because the inner op is
      whatever the sentence prints after the words: "You may draw 5 cards." and
      "You may draw cards until you have 6 cards in your hand." are two different
      ops behind ONE wrapper, and thirty more sentences are waiting behind ops
      that do not exist yet.

      `note` is the WHOLE printed sentence, addressed to the seat that answers it
      (the controller — unlike `opponentMayDraw`, this park files no `decider`).
      It is REQUIRED rather than derived from `then`, for `damageChosen.source`'s
      reason: a describer over `then` would have to guess wording for every op it
      might ever wrap, and the sentence is already sitting in the deriver's own
      match.

      ⚠️ **NOT EVERY PRINTED "you may" NEEDS THIS OP, AND MOST DO NOT.** The
      catalog's "You may …" wrapper gates 78 legal printings, and 34 of them are
      ALREADY free: `searchDeck`, `discardEnergy {kind:"upTo"}`, `attachCards` and
      `moveEnergy` each park with a legal EMPTY answer, so the decline the wrapper
      grants is a decline their own prompt already offers, and wrapping one would
      ask the same question twice. This op is for the inner op that has NO empty
      answer — `drawCards`, `drawUntilHandSize` — where "no" has nowhere else to
      live.

      ⚠️ **DECLINING RUNS NOTHING, AND THAT IS THE DEFECT THIS OP CAN HAVE.** The
      splice lives in `resumeProgram` (one expression, beside the `applyChoice`
      whose result it feeds) rather than in an `applyChoice` arm, because an apply
      arm returns a `GameState` and has no access to `rest` — the ops after the
      park — which is the only thing a gate needs to touch. `applyChoice`'s own
      `optional` arm therefore returns the state UNCHANGED on both answers, and
      the yes/no difference is entirely the splice.

      🆕 🛑 **D316 — `otherwise` IS THAT DEFECT CLOSED, AND IT IS THE FIELD THE
      THREE OTHER GATES HAVE HAD ALL ALONG.** `coinFlipGate` (D269),
      `conditionGate` and `recordGate` each carry a second arm for the printed
      *"If tails, …"* / *"…instead"*; this gate is the FOURTH and was the only one
      without one, which is exactly what made *"a decline buys nothing"* a property
      of the op rather than of the sentences it had. **The resume point priced this
      as an `else`-shaped field; the field already had a name, three times over.**
      Optional, so it is a WIDENING (D125): every existing producer omits it and
      reads identically, and a v18 match record cannot hold one.

      ⚠️ **THE PRODUCER THAT NEEDED IT IS THE ONE WHOSE TWO ANSWERS ARE BOTH
      DAMAGE.** *"You may do {N} more damage. If you do, …"* moves the attack's
      WHOLE hit inside this gate (attack.ts drops the printed base), so a decline
      that spliced nothing would deal ZERO where the card prints its base — the
      first sentence in the pool for which "nothing runs" is not a legal reading
      of the printed no. Every earlier producer's decline is still the absence of
      a splice, and still correct: `then` alone remains the shape.

      ⚠️ **NO PRODUCER AT D186, BY DESIGN — AND TWO SINCE D202.** The mechanism and
      both dialogs landed first and alone, because a park of a prompt kind one
      surface cannot render is a soft-lock; the surfaces answered the question
      before anything could ask it. **D202 is the asking**: `deriveAttackEffect`
      anchors 33–34 read "You may draw (N) cards." and "You may draw cards until
      you have (N) cards in your hand." — 12 legal printings — and wrap the two
      draw ops the bare anchors above them already produce. `optionalConfirm.test.ts`'s
      pinned absences were RE-POINTED to name those readers, not deleted. */
  | { op: "optional"; note: string; then: EffectOp[]; otherwise?: EffectOp[] };

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
// local D1 over the WHOLE effect string (978 cards / 6 sets); NOT ONE of the ten carries
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
//     Nymble sv02-019 "Slight Splash", Sudowoodo sv02-109/-219 "Hit and Hide",
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
// THE 3 REMAINING UNGATED / OTHERWISE-GATED PRINTINGS OF THIS FAMILY STAY LOUD,
// and each is refused by a property of the WHOLE-SENTENCE anchor rather than by
// luck:
//   • "…by attacks from ANCIENT Pokémon." (1 — Iron Moth sv06.5-009
//     "Anachronism Repulsor", attack INDEX 1) narrows the block by a class token
//     the CATALOG DOES NOT CARRY — see `PREVENT_DAMAGE_FROM_CLASS` below, where
//     its Basic-spelled sibling is mapped and the whole finding is written out;
//   • "If your opponent's Pokémon is Knocked Out by damage from this attack, …"
//     (1 — Corviknight sv02-148 "Accelerate", attack INDEX 0) gates on the
//     attack's own RESULT,
//     the §9.2 channel Iron Moth "Suction" and Camerupt want;
//   • "Flip a coin. If tails, this attack does nothing. If heads, …" (1 —
//     Squawkabilly sv01-162 "Fly") carries a SECOND consequent on the same flip.
// Each is a separate warrant, written down here so the next slice inherits the
// list rather than re-censusing for it.
//
// ⚠️ THE 3 BASIC-FILTERED PRINTINGS MOVED OFF THAT LIST AT D146, AND THEIR CARD
// NAMES WERE WRONG ON IT. D142 wrote "Fletchling sv01-150" and "Bombirdier
// sv02-153/-246"; the local D1 (2026-08-02, 978 cards / 6 sets) says sv01-150 is
// **STARAPTOR** (Stage 2 from Staravia, "Tailspin Away") and sv02-153/-246 is
// **NOIVERN ex** (Stage 1 from Noibat, "Covert Flight"). Fletchling sv02-163 and
// Bombirdier sv01-138/-219/sv02-147 are real cards in this pool and print none of
// this text — the same class of error D137 and D138 each corrected once, and the
// reason a slice checks an inherited id by QUERY rather than by recognition.
const FLIP_PREVENT_DAMAGE_AND_EFFECTS =
  /^Flip a coin\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;
const FLIP_PREVENT_DAMAGE =
  /^Flip a coin\. If heads, during your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks\.$/;
// The ATTACKER-CLASS filter (D146) — the same installation as `FLIP_PREVENT_DAMAGE`
// above with two printed differences and no coin:
//
//   "During your opponent's next turn, prevent all damage done to this Pokémon by
//    attacks from Basic Pokémon."
//
// THREE printings on TWO cards from TWO sets, so D121's second-printing warrant is
// met in D139's stronger form: Staraptor sv01-150 "Tailspin Away" ({C}{C}, 60,
// attack INDEX 0) and Noivern ex sv02-153/-246 "Covert Flight" ({C}{C}, 70, INDEX
// 0). Verbatim off the local D1, ids/names/costs/damage AND the index checked per
// printing (D144's rule — an index is a per-printing fact).
//
// ⚠️ THE POOL PRINTS A FOURTH PRINTING OF THIS SENTENCE AND IT IS NOT MAPPED —
// Iron Moth sv06.5-009 "Anachronism Repulsor" ({R}{R}{C}, 120, attack INDEX 1)
// says "…from ANCIENT Pokémon.". That token is not a stage, a rule box or a name
// marker: "Ancient" is a BANNER printed on the card face by Paradox Rift (sv04)
// onward, and it appears in NO column of the persisted catalog and in NO field of
// tcgdex's own card model — verified upstream against Roaring Moon ex sv04-124,
// the canonical Ancient print, whose payload carries `suffix: "ex"` for its rule
// box and nothing whatsoever for the banner. So this is not "a predicate nobody
// has written yet": there is no datum to write one over, and the fix is an INGEST
// change, not an engine one.
//
// A SPECIES LIST WOULD BE WRONG, WHICH IS WHY THE SENTENCE STAYS LOUD RATHER THAN
// GETTING A TABLE. The banner is a per-PRINTING fact (D135's rule): Great Tusk ex
// sv01-123/-230/-246 is the same species as the sv04 Ancient prints and carries no
// banner at all, so any name-keyed table answers three real cards wrongly with no
// failure anywhere — the outcome this family refuses. An unreadable class token
// therefore falls through to ATTACK_EFFECT_SKIPPED, which is the loud answer.
//
// ONE ANCHOR PER PRINTED STRING, so this is a THIRD regex rather than an optional
// `(?:Basic|Ancient)` group: a group would map the Ancient sentence to a token the
// engine cannot resolve, and the `fromClass` union has exactly one member so that
// the attempt does not even typecheck (continuous.ts `attackerMatchesClass`).
//
// ⚠️⚠️ D239 WIDENS THIS ANCHOR BY AN OPTIONAL BRACE-CODED EXCLUSION, AND THE
// PARAGRAPH ABOVE STILL HOLDS WORD FOR WORD — which is the point of keeping it.
// The re-derivation at HEAD (remote D1, `legal_standard = 1`, 2026-08-06,
// `GLOB '*[Pp]revent all damage*by attacks from*'` over `json_each` + all three
// text columns, GROUPED BY SENTENCE) returns attack **10 / 4 sentences** ·
// ability 8 / 4 · effect 1 / 1. One attack sentence was already read (the bare
// "Basic" above, 1 legal printing); the four are:
//
//   • "…by attacks from Basic non-{C} Pokémon."   — **7 legal, TAKEN HERE**.
//     ALL SEVEN ARE ONE CARD: Terapagos ex "Crown Opal" ({G}{W}{L}, 180, attack
//     INDEX 1) as `svp-165` / `sv07-128` / `-170` / `-173` / `sv08.5-092` /
//     `-169` / `-180`. ⚠️ Terapagos ex is itself a COLORLESS Basic, so the
//     printing cannot block its own mirror — the datum is real on both sides;
//   • "…by attacks from Basic Pokémon."           — 1 legal, Dipplin `sv07-013`
//     "Coated Attack" ({G}, 20, INDEX 0). ⚠️ A **STAGE 1**, so D146's two
//     rotated fixtures are no longer this sentence's live printing;
//   • "…by attacks from Ancient Pokémon."         — 1 legal, Iron Moth
//     `sv06.5-009`, STILL LOUD for the reason written out above, unchanged;
//   • "…prevent all damage done to **each of your Future Pokémon** by attacks
//     from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this
//     effect ends." — 1 legal, Miraidon `sv08-069` "C.O.D.E.: Protect"
//     ({L}{C}, 40, INDEX 0), and REFUSED FOR A REASON THAT IS NOT ITS CLASS
//     TOKEN. `Pokémon ex` is answerable today (`pokemonSuffixOf`); what this
//     sentence cannot spell is its TARGET — a block installed on a SET of bodies
//     ("each of your Future Pokémon") rather than on "this Pokémon", over a
//     SECOND demand-only banner (`Future`, D204/D205), plus a trailing
//     leave-the-spot terminator `AttackBlock`'s turn stamp does not carry. Three
//     mechanisms, none of them the class. Written down so the next slice prices
//     the NOUN and not the token.
//
// THE EXCLUSION IS A CAPTURE READ THROUGH `POKEMON_TYPE_BY_CODE` (D234's map)
// rather than a literal `non-\{C\}`, and that is D118's parameterisation rule
// rather than an invented reading: the type has to be STORED either way (the
// predicate is a `types` read), so spelling the code literally would hard-code
// `"Colorless"` beside a notation map that is TOTAL over the vocabulary and
// already answers the question. A total map cannot rot the way a hand-kept
// alternation does — that is its own doc's warrant — and the widening is bounded
// at eleven codes, every one of which has a `types_json` datum on real rows
// (measured: 975 legal Basic Pokémon, 134 of them Colorless, so the predicate's
// candidate set is 841 and neither empty nor total — this is NOT the demand-only
// trap `Ancient` is).
//
// ⚠️ THE CAPTURE IS `([A-Z])`, A SINGLE-CHARACTER CLASS AND NOT `(.+)`. Every
// code in the map is one uppercase letter, and a greedy dot would let the anchor
// swallow a whole clause between the braces — the mistake this file's anchors are
// audited for. An unknown letter returns null (LOUD) rather than defaulting.
const PREVENT_DAMAGE_FROM_CLASS =
  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks from Basic (?:non-\{([A-Z])\} )?Pokémon\.$/;
// The DAMAGE CAP (D240) — backlog row 17, and a row that exists only because row
// 15's PROSE claimed these three printings while row 15's own GLOB could not see
// them (they never contain "by attacks from"). Re-derived at HEAD before the
// first regex — remote D1, `legal_standard = 1`, 2026-08-06,
// `GLOB '*if that damage is*'` over `json_each` + all three text columns, GROUPED
// BY SENTENCE, run BARE rather than under row 17's own narrower pattern:
//
//   • "During your opponent's next turn, prevent all damage done to this Pokémon
//      by attacks if that damage is 40 or less."   — 2 legal, TAKEN HERE:
//     Shuckle `sv10.5w-046` and `sv10.5w-127` ("Sturdy Shell");
//   • "…if that damage is 60 or less."             — 1 legal, TAKEN HERE:
//     Skarmory `sv09-002` ("Metal Coat");
//   • "Prevent all damage done to this Pokémon by attacks from your opponent's
//      Pokémon if that damage is 200 **or more**." — 1 legal, **Drednaw**
//     `sv07-044` — NOT TAKEN HERE, and BUILT at D257 on the OTHER channel
//     (`passivesOf.preventDamageAtOrAbove`); see the polarity note below.
//
// attack **3 / 2 sentences** · ability **1 / 1** · effect **0 / 0**. The row's
// `3 = 3 (2 sentences) · 1 · 0` is exact on every figure: **3 = 3**, the SEVENTH
// row running to survive re-derivation. ⚠️ AND THE VERB WAS SWEPT WIDER THAN THE
// ROW, on D239's own finding: `'*damage*'` AND (`'*or less*'` OR `'*or more*'`)
// over the same three columns returns eleven more sentences and every one of them
// is a damage SCALER ("if you have 3 or more Energy in play, this attack does 70
// more damage") or a heal filter — no fourth cap printing anywhere in the pool.
//
// ONE ANCHOR AND ONE NUMERIC CAPTURE, not two `test` arms: 40 and 60 differ in a
// NUMBER and nothing else, which is D118's parameterisation precondition met
// exactly (the same warrant `SELF_DAMAGE_REDUCTION` below is under with three
// amounts). Contrast `FLIP_PREVENT_DAMAGE_AND_EFFECTS` two anchors up, which is
// spelled out separately because its difference is a PHRASE, not a digit.
//
// ⚠️ THE COMPARATOR IS CAPTURED AND CHECKED, NOT ASSUMED — and this anchor is the
// worked example of why. The pool prints the OPPOSITE polarity on the very same
// clause (`sv07-044`, "200 or more"), so an anchor that spelled `or less` as part
// of its literal text would still be CORRECT today and would silently mis-read
// the sentence the day someone folded the two together. Instead `(less|more)` is
// a capture and the arm REFUSES anything but `less`, falling through to the loud
// path. The refusal is a live, driven code path rather than a comment: a
// constructed "or more" attack sentence derives to null.
// ⚠️ AND THE ABILITY PRINTING COULD NOT RIDE THIS RECORD EVEN WITH THE COMPARATOR
// STORED. It is an always-on ABILITY, so it is a `passivesOf` CATALOG aura and not
// an `AttackBlock` INSTALLATION — the aura/installation distinction continuous.ts
// draws — and it carries a second unread narrowing besides ("from your opponent's
// Pokémon"). Two mechanisms, neither of them the direction word. Written down so
// the next slice prices the CHANNEL and not the token.
//
// ⚠️ THE CAPTURE IS `(\d+)`, A DIGIT CLASS AND NOT `(.+)`. Both printed amounts
// are multiples of 10 and the digit class is what stops the anchor swallowing a
// clause; the `\.$` terminator is load-bearing on top of it (a sentence that
// continued past the cap carries a second consequent this op cannot install), and
// a dropped `$` is a declared mutant.
const PREVENT_DAMAGE_UP_TO_CAP =
  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks if that damage is (\d+) or (less|more)\.$/;
// The DURATED DAMAGE REDUCTION (D147) — the largest single count left in this
// tail, and the family's first durated rider that is a NUMBER rather than a flag:
//
//   "During your opponent's next turn, this Pokémon takes {N} less damage from
//    attacks (after applying Weakness and Resistance)."
//
// TWELVE printings on ONE anchor across THREE amounts (local D1, 2026-08-02,
// 978 cards / 6 sets, whole effect string, checked PER PRINTING — ids, names, costs, printed
// damage and INDEX, D144's rule extended to NAMES by D146):
//
// ⚠️ THAT SCOPE WAS WRONG IN THIS FILE UNTIL D161, AND THE COMMENT CONTRADICTED
// ITSELF THREE LINES DOWN. D156's mechanical pass tagged this census
// "890 cards / 5 sets" — the population it measured that day — but this census is dated
// 2026-08-02, BEFORE the outage, and its own attacker-side list below names Pidove
// `swsh10.5-061`, a card the five-set catalog does not hold. D156's own
// reconstruction uses exactly that fact as its proof that the set was present on
// 2026-08-02. So the scope tag, not the count, was the defect: **a census owes its
// scope, and a scope tag owes the DATE of the query it labels.** D161 re-ran the
// whole neighbourhood against the restored 978 / 6 and every number below held.
//
//   20 — Swablu sv03-169 "Fluffy Guard" ({C}, no printed damage, INDEX 0)
//   30 — Pineco sv01-001 "Guard Press" ({C}{C}, 10, INDEX 0)
//        Fidough sv01-098/-213 "Springy" ({P}, no damage, INDEX 0)
//        Forretress ex sv02-005/-230 "Guard Press" ({G}{G}, 120, INDEX 0)
//        Shuckle sv03-005 "Guard Press" ({C}{C}, 30, INDEX 1)
//        Revavroom ex sv03-156/-216/-224 "Wild Drift" ({M}{M}{C}, 170, INDEX 0)
//        Varoom sv06.5-043 "Rigidify" ({M}, no damage, INDEX 0)
//   50 — Forretress sv01-139 "Rolling Shell" ({M}{C}{C}, 90, INDEX 1)
//
// ⚠️ THE INDEX IS NOT CONSTANT ACROSS THE FAMILY (Shuckle and Forretress print it
// at 1, the other ten at 0), which is why each was read separately — the same
// trap D144 found and D146 sharpened.
//
// ⚠️ ONE CAPTURE FOR FOUR AMOUNTS, SAID DELIBERATELY (D120's precondition, met).
// D120 spells a varying token per row when its vocabulary is OPEN, because a
// template over an open set maps sentences no card prints. A NUMBER is closed by
// its type: `(\d+)` cannot admit a token the engine has no reading for, and the
// only guard it owes is the `amount >= 1` every arm here carries. Four rows would
// be four copies of one sentence with one character changed.
//
// ⚠️ THE PARENTHETICAL IS THE SPEC, AND IT IS INSIDE THE ANCHOR. "(after applying
// Weakness and Resistance)" pins WHERE in §8 step 5 the number lands, and the pool
// prints the OTHER parenthetical on six printings of a different mechanism —
// "attacks used by the Defending Pokémon do {N} less damage (BEFORE applying
// Weakness and Resistance)" (Houndoom sv06.5-008/-066, Pikachu sv02-062, Pidove
// swsh10.5-061, Florges sv01-093) plus Entei sv03-030's always-on Ability. Those
// are an ATTACKER-side debuff read at a different step on a different body, so
// the words are load-bearing rather than decorative and the anchor carries them.
const SELF_DAMAGE_REDUCTION =
  /^During your opponent['’]s next turn, this Pokémon takes (\d+) less damage from attacks \(after applying Weakness and Resistance\)\.$/;
// …and the COMPOUND printing, the other 2 of the family's 14 — Eiscue sv02-048
// (Common) / sv02-205 (Illustration rare) "Frigid Block" ({W}{W}{W}, printed 100,
// attack INDEX 1), which prints the rider as a SECOND sentence behind a cost:
//
//   "Discard all Energy from this Pokémon. During your opponent's next turn,
//    this Pokémon takes 100 less damage from attacks (after applying Weakness and
//    Resistance)."
//
// TWO SENTENCES, TWO OPS, IN PRINTED ORDER — Ninetales' `COUNTER_PUT_ANY_THEN_SELF_LOCK`
// (arm 25) and `DEFENDER_POISON_CANT_RETREAT` (arm 5c) are the precedents, and the
// reason this is one anchored pattern rather than a prefix match: the family's
// safety property is that an unrecognised remainder stays LOUD, and a prefix would
// ship the cost without the protection it buys.
//
// ⚠️ IT COSTS ONE REGEX AND NOTHING ELSE, WHICH IS WHY IT IS TAKEN HERE. The first
// half has derived to `discardEnergy { from: "yourActive", filter: anyEnergy,
// count: "all" }` since 0.x (`SELF_DISCARD_ALL`, arm 9), and D145's discard census
// flagged this exact printing as one of the four COMPOUNDS that anchor keeps out.
// It is also the ONLY printing of the 100 amount, so the bare anchor above sees
// three amounts and this one sees the fourth — and the two are mutually exclusive
// in BOTH directions by the capitalised first word plus `^…$`, before their bodies
// are even compared. Both directions are asserted (damageReduction.test.ts), and
// `SELF_DISCARD_ALL`'s own `$` is what keeps this sentence off the bare discard
// path — the live guard D145 said would matter the day this family landed.
const SELF_DISCARD_ALL_THEN_REDUCTION =
  /^Discard all Energy from this Pokémon\. During your opponent['’]s next turn, this Pokémon takes (\d+) less damage from attacks \(after applying Weakness and Resistance\)\.$/;
// The ATTACKER-SIDE DEBUFF (D149) — the OTHER parenthetical, and D147's mirror on
// both axes at once: a number installed on the DEFENDER's body and subtracted at
// the ATTACKER's PRE-Weakness/Resistance step.
//
// FIVE printings across TWO SENTENCES (local D1, 2026-08-02, 978 cards / 6 sets, whole
// effect string, checked PER PRINTING — ids, NAMES, costs, printed damage and
// INDEX, D144's rule extended to NAMES by D146):
//
//   "…the Defending Pokémon's attacks do {N} less damage (before applying …)."
//     20 — Pikachu sv02-062 "Growl" ({C}, no printed damage, INDEX 0)
//          Pidove swsh10.5-061 "Growl" ({C}, no printed damage, INDEX 0)
//     30 — Florges sv01-093 "Moonblast" ({P}{C}{C}, 120, INDEX 0)
//   "…attacks used by the Defending Pokémon do {N} less damage (before applying …)."
//    100 — Houndoom sv06.5-008 (Common) / sv06.5-066 (Illustration rare) "Snarl"
//          ({R}{C}{C}, 100, INDEX 1) — one attack in two rarities, so D121's
//          second-printing warrant is met by the card
//
// ⚠️ TWO SENTENCES, NOT ONE — AND THE RESUME LIST QUOTED ONLY THE SECOND. Three
// of the five printings say "the Defending Pokémon'S ATTACKS DO", two say
// "ATTACKS USED BY the Defending Pokémon DO". Same mechanism, same amount slot,
// same parenthetical, different subject noun phrase — so one anchored
// whole-sentence pattern per PRINTED STRING (D136/D137), exactly as D148's pair
// was two patterns rather than an alternation. An `(?:…|…)` here would be two
// patterns wearing one name, and it would put the majority spelling behind an
// alternation branch nothing names.
//
// ⚠️ THE INDEX IS NOT CONSTANT (Houndoom prints it at 1, the other three at 0),
// read separately per printing — the trap D144 found, D146 sharpened and D147 hit
// again on the mirror family.
//
// ⚠️ THE PARENTHETICAL IS THE SPEC AND IT IS INSIDE BOTH ANCHORS. "(before
// applying Weakness and Resistance)" is the ONLY thing separating these five
// printings from the twenty that say "(after applying …)" and mean the opposite
// thing on the opposite body (SELF_DAMAGE_REDUCTION above). Trimming it would
// cross the two families — which is the census's headline, restated on the arm.
//
// ⚠️ NO /i AND NO BARE-SUBJECT VARIANT: the capitalised first word plus `^…$` is
// the whole guard, and the pool prints no compound in front of either sentence
// (censused — unlike D145's discard, where four compounds were live).
const DEFENDER_ATTACKS_WEAKENED =
  /^During your opponent['’]s next turn, the Defending Pokémon['’]s attacks do (\d+) less damage \(before applying Weakness and Resistance\)\.$/;
const ATTACKS_BY_DEFENDER_WEAKENED =
  /^During your opponent['’]s next turn, attacks used by the Defending Pokémon do (\d+) less damage \(before applying Weakness and Resistance\)\.$/;
// The DURATED REACTIVE RECOIL (D152) — the §9 family's attack-INSTALLED member,
// and `SELF_DAMAGE_REDUCTION`'s sibling on the other side of the damage step:
//
//   "During your opponent's next turn, if this Pokémon is damaged by an attack
//    (even if it is Knocked Out), put 10 damage counters on the Attacking
//    Pokémon."
//
// TWO printings on ONE anchor at ONE amount (local D1, 2026-08-02, 978 cards / 6 sets,
// whole effect string, checked PER PRINTING — ids, NAMES, costs, printed damage
// and INDEX, D144's rule extended to NAMES by D146):
//
//   10 counters — Lycanroc ex sv02-117 (Double rare) / sv02-241 (Special
//                 illustration rare) "Scary Fangs" ({F}{C}{C}, 140, INDEX 1)
//
// One attack in two rarities, so D121's second-printing warrant is met by the
// card rather than by a family count.
//
// ⚠️ THE CAPTURE IS IN DAMAGE COUNTERS AND THE OP CARRIES HP, converted once here
// (`× 10`). Every other anchor in this tail captures HP directly because every
// other printed sentence says "damage"; this family says "damage counters", which
// is the pool's other unit (§8.5 — a counter is 10 HP). The registry's four
// always-on printings already store HP for the same printed clause
// (`damageAttacker: { amount: 30 }` for Cacnea's THREE counters), so converting
// at the deriver is what makes the two halves summable at all.
//
// ⚠️ "(even if it is Knocked Out)" IS INSIDE THE ANCHOR AND NEEDS NO OP FIELD.
// It is the printed restatement of an ordering the §9 site has had since 0.x —
// the recoil runs before finishAttack's §8.1 sweep — so a reader that dropped the
// words would still be right and a reader that captured them would carry a field
// nothing reads. It stays in the pattern because a whole-sentence anchor is the
// family's safety property (an unrecognised remainder stays LOUD), not because
// anything downstream consumes it.
//
// ⚠️ AND THE NEIGHBOURING SENTENCE IS DELIBERATELY LEFT LOUD. Mabosstiff sv02-143
// "Comeuppance" prints this sentence with "10 damage counters" replaced by
// "damage counters … equal to the damage done to this Pokémon" — the same
// duration, the same body, the same read site, and an AMOUNT this anchor's
// `(\d+)` structurally cannot admit, because it is not a number but a channel
// from the §8.5 result (the resume point's item 5). `^…$` refuses it in both
// directions and counterattack.test.ts pins it still-null.
const SELF_INSTALLED_RECOIL =
  /^During your opponent['’]s next turn, if this Pokémon is damaged by an attack \(even if it is Knocked Out\), put (\d+) damage counters on the Attacking Pokémon\.$/;
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
// CENSUS (local D1, 2026-08-02, whole effect string, 978 cards / 6 sets). Every attack
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
//
// ⚠️ **D205 WIDENED THIS ANCHOR BY EXACTLY ONE OPTIONAL CAPTURE — THE SOURCE'S
// OWNER-PREFIXED SUBGROUP — AND THE CENSUS THAT SIZED IT ALSO FOUND THE TWO
// SENTENCES IT MUST REFUSE.** Remote D1 (735f0fb5-cdc3-494d-8b97-74a8ade0124a;
// 3,786 rows / 20 sets, 2,021 `legal_standard = 1`), swept 2026-08-04 with GLOB
// and never LIKE over `attacks_json` for `'Move all damage counters*'`. EIGHT
// printings / FIVE distinct clauses, and D138's own two printings are BOTH
// rotated out:
//
//   ✅ TAKEN — "…from 1 of your Benched **Team Rocket's** Pokémon to your
//      opponent's Active Pokémon." Team Rocket's Wobbuffet sv10-082 / svp-203
//      "Rocket Mirror", **2 legal**. Dedenne ex's sentence with one possessive
//      inserted: same amount ("all"), same source zone ("Benched"), same fixed
//      destination. The optional capture below is the whole diff.
//   ✅ NO LONGER REFUSED, AND IT IS THE SIBLING ANCHOR BELOW RATHER THAN A
//      CAPTURE HERE — "…from 1 of your Benched Pokémon **to 1 of your opponent's
//      Pokémon**." Cofagrigus sv10.5w-040/-123 "Extended Damagriiigus",
//      **2 legal**. D205 called this "a second CHOICE (a second park, on the
//      opponent's board) rather than a predicate on the first — a different op
//      shape, not a rider", and that reading held: D216 built the op
//      (`moveCountersChosen`) and left this anchor untouched, because an
//      alternation here would put two op SHAPES behind one regex. The two
//      anchors stay disjoint on their TAIL, exactly as `COUNTER_MOVE_TO_DEFENDER`
//      and `COUNTER_PUT_ON_DEFENDER` stay disjoint on their first word.
//   ⏹️ REFUSED, AND IT CANNOT BE TAKEN AT ALL — "…from 1 of your Benched
//      **Ancient** Pokémon to your opponent's Active Pokémon." Flutter Mane
//      sv08-096 "Perplexing Transfer", **1 legal**. It is one adjective away
//      from the row above and it has **no datum**: the Ancient/Future banner is
//      printed on the card FACE and appears in NO ingested column (D146's
//      finding, re-checked here against Roaring Moon ex sv04-124). A subgroup
//      the catalog cannot answer is not a rider this anchor can grow — which is
//      exactly why the capture below requires the POSSESSIVE `'s` rather than
//      any capitalised word, and why "Ancient Pokémon" falls through it.
//   ⏹️ Out of scope for legality — Dedenne ex sv02-093/-239 (the printings that
//      bought this anchor) and Liepard sv04-115 are all `legal_standard = 0`.
//      The anchor's own printings are rotated OUT; Wobbuffet is the reason it
//      has legal work at all.
//
// The capture is `([A-Z][A-Za-z ]*)['’]s ` — a capitalised first letter, letters
// and spaces only ("Team Rocket" has one), then the POSSESSIVE, matched
// case-sensitively like every conjunct of the predicate it feeds. `Pokémon`'s
// `é` is outside `[A-Za-z]`, so the unmarked Dedenne sentence cannot be misread
// as an owner named "Pok" — the group simply does not match and, being optional,
// drops out, leaving D138's exact literal.
const COUNTER_MOVE_TO_DEFENDER =
  /^Move all damage counters from 1 of your Benched (?:([A-Z][A-Za-z ]*)['’]s )?Pokémon to your opponent['’]s Active Pokémon\.$/;
// D216 — THE SAME SENTENCE WITH A CHOSEN DESTINATION. "Move all damage counters
// from 1 of your Benched Pokémon to 1 of your opponent's Pokémon." Cofagrigus
// sv10.5w-040/-123 "Extended Damagriiigus", **2 legal**, and the ONLY printing
// of this tail in either scope (remote D1, 2026-08-04, all three text columns
// through `json_each`, GLOB and never LIKE).
//
// A SEPARATE ANCHOR AND NOT AN ALTERNATION IN THE ONE ABOVE, because the two
// tails select different OP SHAPES rather than different field values. Every
// capture this file grows lands in a field of ONE op (D131's rule); a tail that
// picks the op is a different anchor, which is why `COUNTER_MOVE_TO_DEFENDER`
// and `COUNTER_PUT_ON_DEFENDER` are two regexes over one printed noun phrase.
//
// ⚠️ AND IT CARRIES NO OWNER CAPTURE, WHICH IS THE MEASUREMENT AND NOT AN
// OVERSIGHT. The sweep above ran over all three text columns in BOTH scopes and
// found no chosen-destination printing with a possessive: D205's capture exists
// because Team Rocket's Wobbuffet prints one, and copying it here would derive a
// reading no card has — the same call D139's anchor made about a singular "1
// damage counter" and D131 made about "the top 1 cards", one field over. The day
// such a printing exists, this anchor gains the group and the op gains the
// rider, together, and the census line above is what says so.
const COUNTER_MOVE_TO_CHOSEN =
  /^Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent['’]s Pokémon\.$/;
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
// CENSUS (local D1, 2026-08-02, whole effect string, 978 cards / 6 sets; D138's sweep,
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
// 🆕 D345 — **AND BOTH ARE NOW BUILT, WHICH DOES NOT WEAKEN THE CLAIM ABOVE BY A
// WORD.** Dusknoir's sentence is a REGISTRY row (`CURSED_BLAST_13`) as of this
// slice, exactly as Meowscarada ex has been since M4: what this anchor refuses is
// the ATTACK reading, and an Ability authored by hand is the other surface
// entirely. The witness is kept BUILT rather than re-pointed here because the
// refusal is about the CASE and the POSITION, not about the card being unreachable
// — `counterPut.test.ts`'s `NEAR_MISSES` is the list whose standing note says an
// unread sentence needs a live witness, and that one WAS re-pointed.
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
// CENSUS (local D1, 2026-08-02, whole effect string, 978 cards / 6 sets — D139's PUT census
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
// 🆕 D348 — THE COUNTER **SPREAD**: "Put {N} damage counters on your opponent's
// [Benched] Pokémon **in any way you like**." The THIRD anchor on this noun phrase,
// and the one the other two are told apart from by a single missing determiner:
// arm 23's sentence says "on **1 of** your opponent's Benched Pokémon" (ONE body,
// N counters) and this one drops the "1 of" and adds the distribution tail (N
// counters, each naming its OWN body).
//
// CENSUS (remote D1 `luminous` 735f0fb5-…, 2026-08-15, grouped through `json_each`
// so the unit is a SENTENCE and not a JSON blob — D347's unit defect, refused by
// construction). `instr(<col>,'in any way you like') > 0 AND
// instr(<col>,'damage counters') > 0` over ALL THREE text columns:
//   • `effect`          — **0**
//   • `abilities_json`  — **0**
//   • `attacks_json`    — **8 legal printings on 3 sentences**, out of **15
//     printings on 7 sentences** unfiltered by legality, which this anchor reads
//     ALL of.
//     ⚠️ **THE UNFILTERED PAIR WAS RE-DERIVED AND BOTH HALVES WERE WRONG.** This
//     line first read *"13 printings on 8 sentences"*. The **8** counted the
//     `instr` FILTER's population, which includes a sentence this anchor cannot
//     read at all — Munkidori `sv06-082`'s *"Your opponent's Active Pokémon is now
//     Confused. You may **move** any number of damage counters…"*, a MOVE behind a
//     status clause — so a filter count was wearing an anchor count's name. That is
//     D347's unit defect exactly, one family over. The **13** matched nothing at
//     all. Re-queried through `json_each` on remote D1 2026-08-15.
//       ✅ "Put 6 …on your opponent's Benched Pokémon…" — Dragapult ex sv06-130 /
//          sv06-200 / sv08.5-073 / sv08.5-165 "Phantom Dive", **4 legal**.
//       ✅ "Put 2 …on your opponent's Benched Pokémon…" — Flutter Mane svp-097 /
//          sv05-078 / sv08.5-043 "Hex Hurl", **3 legal**.
//       ✅ "Put 4 …on your opponent's Pokémon…" — Sinistcha sv06-022 "Cursed Drop",
//          **1 legal**, and the printing that buys the optional capture: it drops
//          the word *Benched*, so its zone includes the Active.
// The **SEVEN** rotated-out printings, on **FOUR** sentences, are the same two
// shapes at other numbers and are read by the same anchor — a bare `(\d+)` for
// D139's reason, since a count has no CLOSED vocabulary to be rejected against:
// 8 counters ×2 (`sv01-090`/`sv04.5-156`), 5 Benched ×2 (`sv04-076`/`sv04-224`),
// 3 ×2 (`sv03.5-122`/`sv03.5-179`) and 3 Benched ×1 (`sv03.5-094`).
// ⚠️ This line first read *"The five rotated-out printings (8/5/3/3 counters)"* —
// **`8/5/3/3` is the four SENTENCES, and "five" is neither count.** The same unit
// defect as the pair above, in the same doc block, on the complementary half of the
// same population; `counterSpread.test.ts` now pins BOTH halves against the live
// corpus so neither can rot silently again.
//
// 🛑 **AND THE READING IS N REPEATED OPS, NOT A NEW PROMPT KIND — WHICH IS THIS
// ROW'S WHOLE FINDING.** The handoff priced this family as *"`damageChosen` places
// on ONE body and `moveCountersChosen` moves between two; neither can express a
// many-to-many DISTRIBUTION, which is `attachCards` for counters"* — a NEW prompt
// kind. That is the price D346 already paid and refuted one family over:
// **"in any way you like" at a PRINTED COUNT is N independent ops; the compound
// `attachCards` MAP exists for "any NUMBER", which has no N to unroll.** 6, 2 and 4
// are printed counts, so the op sequence IS the sentence, and `attachEnergyFrom`'s
// own doc block has said so in words since D205: *"the ops-in-sequence model stays
// for the 'in any way you like' family and `count` is the SAME-TARGET one."*
//
// ⚠️ **THE UNROLL IS EXACT RATHER THAN CLOSE, AND THAT WAS CHECKED IN THE
// INTERPRETER RATHER THAN REASONED ABOUT.** The printed placement is simultaneous;
// N sequential picks are only the same thing if the candidate set cannot change
// between them. Two facts make it identical:
//   1. `snipeTargets` applies **no HP filter** — it is `oppBenchRefs`/`oppAnyRefs`
//      flat, so a body already at lethal is still a candidate.
//   2. A program op **never sweeps Knock Outs**; the sweep is the attack epilogue
//      (interpreter.ts, "the KO it may cause is swept by the attack epilogue, like
//      every [other]"), so no body leaves the board mid-sequence.
// Stacking all N on one body is therefore legal, spreading them is legal, and the
// board after N picks is the board the card prints. **A DISTRIBUTION PROMPT WOULD
// HAVE BOUGHT A DIFFERENT UX AND THE SAME RULE.**
//
// The optional `(Benched )?` capture is the ZONE and nothing else: present →
// `opponentBench`, absent → `opponentAny`. It is D239's shape (one optional group,
// no new regex) and it is EARNED — Sinistcha is a real legal printing that omits
// the word, so the branch has a producer rather than being a reading nothing
// prints (D104's minimal-shape rule).
//
// THE NEAR MISSES IT MUST REFUSE all share this opening noun phrase and are all
// real catalog rows: "Put N damage counters on **1 of** your opponent's Benched
// Pokémon." (arm 23 — the determiner), "Put N damage counters on **each of** your
// opponent's Pokémon that has any damage counters on it." (a per-target FILTER and
// a fold, no pick at all), "Put damage counters on your opponent's Active Pokémon
// **until its remaining HP is 10**." (a number read off the TARGET), and every
// lowercase mid-sentence ABILITY printing of the same action — kept off by the
// capitalised "Put" plus `^…$`, with no /i anywhere, exactly as its two siblings.
// The possessive carries the `['’]` class (D136/D137) in its ONE marked slot.
const COUNTER_SPREAD_ON_OPPONENT =
  /^Put (\d+) damage counters on your opponent['’]s (Benched )?Pokémon in any way you like\.$/;
// The SELF-LOCK (D143) — "During your next turn, this Pokémon can't attack.", the
// whole printed effect on TWENTY printings, and the same sentence again as the
// SECOND half of Ninetales sv03-029/-199 "Nine-Tailed Dance" (the compound anchor
// below). It is the drawback half of a big-damage attack and the pool's most
// re-printed durated rider after D112's retreat lock.
//
// CENSUS (local D1, 2026-08-02, whole effect string, 978 cards / 6 sets — a NEW census,
// run for THIS question rather than read off D142's duration table, per that
// slice's own rule that a census run for one purpose is a FLOOR for every other).
// "can't attack" appears on 38 printings in all: 33 in `attacks_json`, 2 in
// `abilities_json` (Slaking V swsh10.5-058/-077 "Kinda Lazy" — a Prize-count
// CONDITION with no duration at all) and 3 on a TRAINER (Geeta sv03-188/-218/-226
// — "During THIS turn, YOUR POKÉMON can't attack", a different turn and a whole
// board). Inside `attacks_json`, the SELF-lock family is 29 printings across FIVE
// sentences and this anchor takes 20 of them; the compound below takes 2 more.
// The five and where each one is read — 🆕 **28 of the 29 printings are BUILT
// after D316, and the ONE that stays LOUD is `legal_standard = 0`**:
//   • "During your next turn, this Pokémon can't attack."                   (20) ✅
//   • "Put {N} damage counters … . During your next turn, …can't attack."   ( 2) ✅
//   • "Flip a coin. If tails, during your next turn, this Pokémon can't
//     attack." (5 — Oinkologne sv01-157, Oinkologne ex sv01-158/-234, Paldean
//     Clodsire ex sv02-130/-244, all `legal_standard = 0` today; the LEGAL
//     printing of this sentence is Nosepass sv06-101) ✅ **BUILT at D144** by
//     arm 26 (`coinFlipGate` + `onTails`).
//     🆕 🛑 **THIS BULLET SAID THE OPPOSITE UNTIL D316, AND IT HAD BEEN FALSE FOR
//     A HUNDRED AND SEVENTY-TWO SLICES.** D143 wrote *"a TAILS gate, and
//     `coinFlipGate` runs its body on HEADS only, so the gate is a field or an op
//     this engine has not got — the cheapest widening of THIS slice"*, and D144
//     took exactly that widening the very next slice. Nothing went red, because a
//     stale census bullet is prose. ⚠️ **IT WAS FOUND BY REFUSING TO COPY A NUMBER
//     OUT OF IT**: D316 was about to close the family at "23 of 29" off this list
//     and re-derived it instead, which cost one `git grep`. **A NUMBER YOU COPY
//     FROM A DOC BLOCK IS A NUMBER YOU HAVE NOT MEASURED.**
//   • "You may do 100 more damage. If you do, during your next turn, this
//     Pokémon can't attack." (1 — Copperajah sv06.5-042) ✅ 🆕 **BUILT at D316**,
//     by `deriveAttackOptionalBoost` + this arm's own op — an OPTIONAL damage
//     bonus whose acceptance installs the lock. D143 called it "a park the damage
//     fold cannot express today" and that was true of the FOLD and false of the
//     PROGRAM: the whole hit moves inside the `optional`, the printed base is
//     suppressed exactly as Hail Blade's is, and the lock is this same op reached
//     through a lowercase-verb consequent anchor. 🛑 **THE FAMILY IS NOW 28 OF 29
//     ACROSS FIVE SENTENCES, AND THE 29TH IS ROTATED** — Dragonite ex `sv03-159`'s
//     two-consequent flip is `legal_standard = 0` (re-queried 2026-08-10), so this
//     family is CLOSED at every printing that is legal and the remaining sentence
//     is priced at ZERO for the same reason the seven rotated registry attack ids
//     are (`censusAtHead.test.ts`).
//   • "Flip a coin. If heads, this attack does 140 more damage. If tails, during
//     your next turn, this Pokémon can't attack." (1 — Dragonite ex sv03-159) —
//     TWO consequents on ONE flip, D142's Squawkabilly refusal in another family.
// The neighbouring OPPONENT-side lock is 4 printings across 2 sentences (Eiscue
// ex sv03-042/-210/-222 "Scalding Block", Houndoom ex sv03-134 "Evil Claw") and is
// refused HERE on the printed subject — ✅ MAPPED at D148 by the two anchors below,
// which is what earned `preventAttack` its `target` field. The per-ATTACK lock
// ("… can't use {AttackName}") is refused on the VERB — ✅ MAPPED at D154 by
// `SELF_CANT_USE_ATTACK` below, whose census puts the SELF side at 6 catalogued
// printings across 4 names (the older "8 across 6" counted two swsh10.5 ids, a set
// the local D1 does not contain). The OPPONENT-side twin stays LOUD: Medicham
// sv01-111 "Acu-Punch-Ture" and Oranguru sv02-094 "Plotter's Command" print
// "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's
// next turn, that Pokémon can't use that attack." — it needs a PARK as well as an
// attack address, and D154 built the address only.
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
// printing of that noun phrase is an ABILITY (Dusclops sv06.5-019/-069/sv08.5-036
// and Dusknoir sv06.5-020/-070/sv08.5-037 "Cursed Blast" — **SIX printings, not
// the four this line said until D345**; the Prismatic Evolutions reprints had been
// missing from every prose enumeration of this family in the repo, and a prose
// count rots exactly like an asserted one), refused by the capitalised "Put"
// plus `^…$` exactly as D139/D140's anchors refuse theirs. So the compound is the
// ONLY form this sentence takes, which is why there is no bare any-zone anchor.
//
// THREE apostrophe slots, all classed (D136/D137): the possessive "opponent's"
// and the contraction "can't", plus the one inside the reused half — and the
// D137 hazard here is real rather than theoretical, since classing the possessive
// and not the contraction is precisely the half-fix that reads like a whole one.
const COUNTER_PUT_ANY_THEN_SELF_LOCK =
  /^Put (\d+) damage counters on 1 of your opponent['’]s Pokémon\. During your next turn, this Pokémon can['’]t attack\.$/;
// …and the TAILS-GATED form (D144) — the same rider D143 mapped bare, behind the
// LOSING face of a coin: 5 printings on ONE sentence, and the third and last
// self-lock sentence whose consequent this engine already owns.
//
//   • Oinkologne sv01-157 "Leg Stomp"  ({C}{C}{C}, INDEX 1, printed 130)
//   • Oinkologne ex sv01-158/-234 "Heavy Stomp" ({C}{C}{C}, INDEX 1, printed 210)
//   • Paldean Clodsire ex sv02-130/-244 "Needle Bone" ({D}{C}{C}, INDEX 0, 200)
//
// ⚠️ THE INDEX IS NOT CONSTANT ACROSS THE FAMILY — 1 on the three Oinkologne
// printings and 0 on the two Clodsire ones — which is D139/D143's habit paying
// off a third time: a suite that assumed either number would simulate the wrong
// attack on two of the five. Every printing carries a FLAT printed `damage` (130 /
// 210 / 200) and no "+"/"×" marker, so `modifierSimulated` (attack.ts) is
// untouched by this arm and the drawback really is the whole effect text.
//
// CENSUS — THE TAILS SHAPE AS ITS OWN QUESTION (local D1, 2026-08-02, 978 cards / 6 sets),
// run because D143's census counted these 5 as REFUSALS of the "can't attack"
// question and therefore says nothing about how the tails FACE generalises.
// `attacks_json LIKE '%if tails%'` returns 26 printings / 8 sentences, plus 2 on a
// Trainer (`effect`) and 0 on any Ability — 28 in all. Of those, exactly THREE
// sentences are a bare "Flip a coin. If tails, <one consequent>.", the shape this
// field buys, and they are 8 printings:
//   • "…during your next turn, this Pokémon can't attack."          (5) ✅ HERE
//   • "…discard all Energy from this Pokémon."                      (2) ✅ D145,
//     `FLIP_TAILS_SELF_DISCARD_ALL` below — Pikachu ex sv02-063 "Dynamic Bolt"
//     (INDEX 1, 220), Beartic sv03-054 "Frost Purge" (INDEX 1, 170);
//   • "…this Pokémon also does 60 damage to itself."                (1) ✅ D145,
//     `FLIP_TAILS_SELF_DAMAGE` below — Oinkologne sv03-183 "High-Impact Kick"
//     (INDEX 1, 160), a THIRD Oinkologne and a different card from sv01-157.
// **So the tails gate GENERALISED, and it generalised onto ops that already
// exist** — which was the argument for the FIELD over a sibling op member, made
// on the census rather than on taste, and D145 spent it one slice later at one
// regex and one arm apiece. **THE BARE TAILS-GATED FAMILY IS NOW CLOSED**: all 3
// sentences / 8 printings are read, and the remaining 20 printings are refused by
// their SHAPE and not by any arm's spelling. Each is a warrant written down:
//   • "Flip a coin. If tails, this attack does nothing." (11) — already SIMULATED,
//     and by a different reader: `deriveAttackCoinFlip`'s `cancelOnTails` (D126),
//     which runs in FRONT of the §8.5 pipeline because it retracts damage. That is
//     the engine's OTHER tails reading, and the two are disjoint by consequent
//     exactly as the heads pair is;
//   • "During your opponent's next turn, if the Defending Pokémon tries to attack,
//     your opponent flips a coin. If tails, that attack doesn't happen." (4 —
//     Dolliv sv01-022/-200 "Apply Oil", Quaxly sv02-049/-206 "Apply Gel") — a
//     DURATED gate that makes the OPPONENT flip on their OWN turn: not a
//     `coinFlipGate` at all, and the only tails-gated attack LOCK in the pool that
//     this op could not express even with the field;
//   • "Flip a coin. If heads, this attack does 140 more damage. If tails, during
//     your next turn, this Pokémon can't attack." (1 — Dragonite ex sv03-159
//     "Mighty Meteor") and "Flip a coin. If tails, this attack does nothing. If
//     heads, …prevent all damage…" (1 — Squawkabilly sv01-162 "Fly") — TWO
//     consequents on ONE flip. ⚠️ D269 GAVE THE OP THAT SHAPE (`otherwise`) AND
//     THESE THREE ARE STILL REFUSED, which is the honest correction to D142's
//     wording: the op could now HOLD them, but nothing READS them here. These are
//     ATTACK sentences and the attack path is `deriveAttackEffect`'s text arms —
//     none of which matches a two-consequent flip — so what stands between the
//     engine and these cards is a DERIVER arm, not a union field. The refusal
//     survives; only its reason changed;
//   • "Flip a coin. If heads, search your deck for a card… If tails, discard a card
//     from your hand." (1 — Slowpoke sv02-085 "Tail-Fishing") and Egg Incubator
//     swsh10.5-066/-087 (2, a TRAINER) — the same two-consequent shape again.
//
// A WHOLE-SENTENCE ANCHOR WITH NO CAPTURE: nothing varies. The consequent is
// LOWERCASE ("during"), which is what keeps `SELF_CANT_ATTACK_NEXT_TURN`'s `^During`
// off this string and this pattern off that one — the two are mutually exclusive by
// the capital alone, before the anchors are considered, and adding /i anywhere in
// this file would collapse both guards at once. Both apostrophe slots would be one
// (`can't`), and it carries `['’]` for D136/D137's reason like every sibling.
const FLIP_TAILS_SELF_CANT_ATTACK =
  /^Flip a coin\. If tails, during your next turn, this Pokémon can['’]t attack\.$/;
// ── D154: the PER-ATTACK lock, the same rider narrowed to ONE named attack ──
//
// "During your next turn, this Pokémon can't use {AttackName}." — the whole
// printed effect, and the sentence `SELF_CANT_ATTACK_NEXT_TURN` above has refused
// on the VERB for four slices while three remainder lists carried it as the
// largest unread count in the tail.
//
// CENSUS — RE-RUN AT D162 AGAINST THE RESTORED CATALOG (local D1, 2026-08-03,
// 978 cards / 6 sets; sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24,
// swsh10.5 88). Run as its OWN question rather than inherited from §D148's table
// — D142's floor rule, eleventh payout. `LIKE '%can''t use%'` across ALL THREE
// text columns returns **37 rows**; exactly **EIGHT across SIX NAMES** are this
// sentence, and every other match is a different mechanism the `^During` plus
// `^…$` refuses on sight (the once-per-turn Ability limiters — "You can't use
// more than 1 {Ability} each turn" on Fezandipiti ex / Pecharunt ex / Squawkabilly
// ex / Pidgeot ex; the swsh-era "You can't use more than 1 VSTAR Power in a game"
// on Mewtwo VSTAR swsh10.5-031/-079/-086 and Dragonite VSTAR swsh10.5-050/-081;
// Gardevoir ex's "on a Pokémon that would be Knocked Out"; Rare Candy's — in both
// its printings — and Dendra's play gates; and the OPPONENT-side twin below). The
// eight, with every field checked PER PRINTING (id, NAME, cost, printed damage and
// INDEX — D144's rule extended to NAMES by D146):
//
//   "Dirty Headbutt"     — Munkidori ex sv06.5-037 (Double rare) / sv06.5-083
//                          (Ultra Rare) / sv06.5-091 (Special illustration rare),
//                          {D}{D}{C}, 190, INDEX 0 — one attack in three rarities
//   "Accelerating Stab"  — Lucario sv01-114, {F}{C}{C}, 120, INDEX 1
//   "Slashing Steel"     — Skarmory sv03-142, {M}{M}{C}, 120, INDEX 1
//   "Slip 'n' Roll"      — Greedent ex sv03-179, {C}{C}{C}, 210, INDEX 1
//   "Torrential Cannon"  — Radiant Blastoise swsh10.5-018, {W}{W}{C}, 170, INDEX 0
//   "Combustion Blast"   — Radiant Charizard swsh10.5-011, {R}{C}{C}{C}{C}, 250,
//                          INDEX 0 — the card's ONLY attack
//
// ⚠️ THE PARAGRAPH THAT USED TO SIT HERE SAID THE EIGHTH PRINTING AND ITS WHOLE
// SET DID NOT EXIST, AND IT WAS AN ARTEFACT OF A DATABASE OUTAGE. D154 ran this
// query on 2026-08-03 against a local D1 that had silently dropped all 88
// `swsh10.5` rows to an uncheckpointed WAL, got 29 rows and 6 printings across 4
// names, and corrected §D143's inherited "8 printings / 6 sentences" DOWNWARD on
// what looked like the strongest possible evidence. D160 re-ingested the set and
// checkpointed it (`PRAGMA wal_checkpoint(TRUNCATE)` → `0|0|0`); the re-run above
// returns §D143's figure exactly. Both Radiant printings are catalogued and both
// are fielded — swsh10.5-018 throughout (as a printing of FIXTURE-POOL provenance
// while its row was missing), swsh10.5-011 since D162.
//
// D154's lesson survives and gains a second half. First: **a query cannot see a
// set the database does not have, and nothing about its result says so — a census
// owes its SCOPE, not only its count.** Second, which is what the reversal teaches:
// **a query returning fewer rows than a predecessor is evidence about the DATABASE
// before it is evidence about the predecessor.** Three slices in a row (D154, D155)
// corrected an inherited number downward during the outage and all of those
// corrections are now reversed by measurement; the one slice that refused to
// correct and built a manifest instead (D156) was right on every count.
//
// ⚠️ THE CAPTURE IS A PROPER NOUN, AND IT IS THE FIRST IN THIS FAMILY. Every other
// anchor in this tail captures a NUMBER, which D120's precondition closes by type.
// A name is closed by nothing — so the capture is validated where the datum lives:
// `preventAttackUse` resolves it against the HOLDER's printed attacks at the
// install and writes NOTHING if it does not match one (interpreter.ts). D120's
// "does exactly one token VARY?" is answered YES by four distinct names across the
// six printings, so it is one anchor with one capture rather than four rows — and
// the alternative (an op meaning "the attack being declared", with no capture at
// all) is refused because it would read a sentence the pool does not print: it
// happens to be true that all six name their OWN attack, and an anchor that could
// not tell the difference would silently mis-map the first printing that does not.
//
// `(.+?)` is LAZY so the trailing `\.$` cannot be swallowed by a name; the anchors
// do the rest. Greedent ex's "Slip 'n' Roll" carries TWO apostrophes INSIDE the
// captured name, which is why the capture is a free class rather than a word
// pattern — and why `['’]` (D136/D137) is spelled only on the sentence's own
// contraction ("can't"), the one slot the PATTERN owns. Every printing in the D1
// uses the STRAIGHT apostrophe (checked: the pool contains no U+2019 at all in any
// text column), so the class is D136/D137's standing insurance rather than a
// reading of this data.
//
// No /i, for the standing reason (see TYPED_SELF_DISCARD): the capitalised
// "During" plus `^…$` is the whole guard, and it is what keeps the thirteen
// lowercase mid-sentence "you can't use…" Ability limiters off this path.
const SELF_CANT_USE_ATTACK = /^During your next turn, this Pokémon can['’]t use (.+?)\.$/;
// ── D155: the PER-ATTACK BUFF, the same address with the opposite verb ──
//
// "During your next turn, this Pokémon's {AttackName} attack does {N} more damage
// (before applying Weakness and Resistance)." — the whole printed effect, and the
// sentence that sits at the intersection of D154's addressing and D149's read
// step. One anchor, TWO captures (the NAME and the amount).
//
// ⚠️ THE CENSUS NAMES ITS POPULATIONS, WHICH IS D154's LESSON APPLIED — AND THE
// EPISODE BELOW IS THE REASON THAT LESSON NEEDED A SECOND HALF. D155 wrote here
// that "the catalog holds 890 rows, not 978", against a file it had just queried,
// and corrected §D149's and §D151's counts downward to match. **The 890 was real
// and the correction was wrong.** The local D1 had silently lost all 88
// `swsh10.5` rows to a write-ahead log that was never checkpointed, somewhere
// between 2026-08-02 and 2026-08-03; D156 refused to accept the downward
// corrections and built a manifest instead; D160 re-ingested the set, checkpointed
// it (`PRAGMA wal_checkpoint(TRUNCATE)` → `0|0|0`) and re-ran the queries. The
// catalog is whole again —
//
//   select set_id, count(*) from cards group by set_id;
//   sv01|258  sv02|279  sv03|230  sv06.5|99  sve|24  swsh10.5|88   -- 978, SIX sets
//
// — and all three downward corrections REVERSE. So the defect was never a wrong
// number: it was a number with NO SCOPE, which is what let one population's
// measurement read as another's fiction. 890/5 and 978/6 are both true, of the
// outage window and of the catalog either side of it.
//
// ⚠️ THE RULE THAT COMES OUT OF IT, AND IT IS THE ONE TO CARRY: **a query that
// returns fewer rows than a predecessor is evidence about the DATABASE before it
// is evidence about the predecessor.** Verify by QUERY, never by recognition —
// and then ask what the query could not see.
//
// Every census comment in this file says `978 cards / 6 sets`, naming the catalog
// it queried; `catalogManifest.ts` records the outage as `history` (the dates,
// what the restored set contributes to each count, and D156's committed census of
// the shrunken pool, reconciled by SUBTRACTION on four independent axes); and
// `catalogManifest.test.ts` FAILS on any three-or-four-digit "N cards" in the
// engine sources that is neither a measured number nor a listed exception, AND on
// any catalog row count quoted without its set count. Regenerate the manifest
// with `bun run scripts/catalog-manifest.ts`.
//
// ⚠️ AND D160 CLOSED IT — THE PARAGRAPHS ABOVE ARE HISTORY, NOT THE CURRENT
// STATE, AND THIS NOTE IS WHAT KEEPS THEM FROM READING AS THE LATTER. `swsh10.5`
// was re-ingested on 2026-08-03 and the WAL CHECKPOINTED (the step whose absence
// lost it), so the local D1 is **978 cards / 6 sets** again — sv01 258, sv02 279,
// sv03 230, sv06.5 99, sve 24, swsh10.5 88 — and every `978 cards / 6 sets` scope
// tag in this file is correct once more. What does NOT self-correct is a comment
// written while the rows were gone: every census dated 2026-08-03 ran against the
// shrunken population and is a FLOOR until re-run. D160 re-ran three of them and
// ALL THREE downward corrections REVERSED — §D149's "5 printings" and §D151's "six
// rows" were EXACT (Pidove `swsh10.5-061` is a real catalogued card), and D154's
// per-attack lock census is 8 rows across 6 names. **The generalisation: a count a
// query cannot reproduce is not thereby WRONG — the query owes its SCOPE, and a
// query that returns fewer rows than a predecessor is evidence about the DATABASE
// before it is evidence about the predecessor.**
//
// CENSUS (local D1, 2026-08-03, ALL THREE text columns — `effect`, `attacks_json`,
// `abilities_json`) — run against the shrunken 890 rows / 5 sets, and RE-RUN by
// D160 against the restored 978 cards / 6 sets with the SAME answer:
//
//   LIKE '%more damage (before applying%'                     → 1 row
//   LIKE '%During your next turn, this Pokémon''s%'           → 1 row
//
// Both are the SAME row, and there is exactly one printing — **unchanged by the
// restore**, which is the useful half of re-running a census that does not move:
//
//   100 — Seismitoad sv03-052 "Echoed Voice" ({W}{W}, printed 120, INDEX 0)
//
// checked field by field off the row (id, NAME, cost, printed damage and INDEX —
// D144's rule extended to NAMES by D146). It is the card's ONLY attack, and the
// card also prints a "Quaking Zone" Ability ("As long as this Pokémon is in the
// Active Spot, attacks used by your opponent's Active Pokémon cost {C} more") —
// which the attack-cost ± slice AUTHORED as a registry passive
// (`opponentActiveAttackCostSurcharge`, read by continuous.ts
// `opposingAttackCostSurcharge`). It reaches no arm of this file: it is an ABILITY,
// and no Ability string ever reaches `deriveAttackEffect`.
//
// ⚠️ AND `FIXTURE_POOL` WAS SWEPT SEPARATELY, WHICH IS THE HALF D154's FINDING
// MAKES MANDATORY: no fixture in the pool carries "more damage (before applying"
// on any attack, so unlike the per-attack LOCK there is no fielded-but-uncatalogued
// printing here. ONE printing means ONE, in both populations.
//
// THE MIRROR FAMILY IS WHAT THIS ANCHOR MUST NOT CROSS, and it is where the
// reversal is visible. `less damage (before applying …)` returns **SIX rows** in
// the same query, re-run at D162 against 978 / 6 — five ATTACK riders (Pikachu
// sv02-062, Florges sv01-093, Houndoom sv06.5-008/-066, **Pidove swsh10.5-061**)
// and one ABILITY (Entei sv03-030). So §D149's "five printings" is EXACT (arm 19f
// reads attack effects, and five of the six are attacks) and §D151's "six rows" is
// EXACT; D155's corrections to four and five were the missing set speaking, and
// Pidove is a real catalogued card rather than a fixture-only one. The
// parenthetical separates the two directions and the VERB separates this sentence
// from theirs; both are inside `^…$` for D149's reason verbatim.
//
// ⚠️ TWO CAPTURES, AND THEY ARE CLOSED BY DIFFERENT THINGS. The amount is a NUMBER
// (D120's precondition, closed by its type) and the name is a PROPER NOUN closed by
// nothing — so the name is validated where the datum lives: `boostAttack` resolves
// it against the HOLDER's printed attacks at the install and writes nothing if it
// matches none (interpreter.ts), which is `preventAttackUse`'s contract verbatim
// and the reason the two ops share one resolver.
//
// `(.+?)` is LAZY so the trailing " attack does" cannot be swallowed by a name.
// The possessive slot carries `['’]` (D136/D137) — the same class its neighbour
// spells on a CONTRACTION — and the capture is apostrophe-FOLDED at the arm for
// D154's reason, so the derived VALUE is stable under a punctuation-normalising
// re-ingest. No printing exercises that fold (the one attack name is "Echoed
// Voice"), so it is pinned by a constructed sentence rather than by a card: the
// install-side half of the same fold already has a card witness (`fix-curly-barrer`,
// D154) and now reaches this op through the shared resolver.
//
// No /i, for the standing reason (see TYPED_SELF_DISCARD): the capitalised
// "During" plus `^…$` is the whole guard.
const SELF_ATTACK_BOOST =
  /^During your next turn, this Pokémon['’]s (.+?) attack does (\d+) more damage \(before applying Weakness and Resistance\)\.$/;
// ── D157: the PER-ATTACK lock pointed ACROSS THE TABLE, with the address CHOSEN ──
//
// "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's
// next turn, that Pokémon can't use that attack." — the whole printed effect, and
// the last unread member of the per-attack neighbourhood. Three remainder lists
// carried it; D154 built the ADDRESS (an index on `InPlayPokemon`) and said in so
// many words that the address does not foreclose this, D155 built the second
// reader of that address, and what neither built is the PARK that produces one.
//
// CENSUS — RE-RUN AT D162 AGAINST THE RESTORED CATALOG (local D1, 2026-08-03,
// **978 cards / 6 sets** — sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24,
// swsh10.5 88 — across ALL THREE text columns `effect`, `attacks_json` and
// `abilities_json`; run as its OWN question rather than inherited from §D154's
// table, D142's floor rule). ⚠️ D157 ran it against the 890 / 5 catalog of the
// outage window, so its count was a FLOOR; the re-run says the floor was the
// total. **`can't use that attack` returns 2 rows against the whole six-set
// catalog — the restored `swsh10.5` contributes NOTHING to this family**, which is
// the outcome a re-census most often has and the one nobody writes down:
//
//   LIKE '%can''t use that attack%'      → 2 rows  (unchanged: 2 → 2)
//   LIKE '%Choose 1 of your opponent%'   → 3 rows (the third is a different card)
//   LIKE '%Pokémon''s attacks%'          → 6 rows (four are D149's debuff family)
//
// The two, with every field checked PER PRINTING (id, NAME, cost, printed damage
// and INDEX — D144's rule extended to NAMES by D146):
//
//   "Acu-Punch-Ture"    — Medicham sv01-111, {F}, 30, INDEX 0 (Stage 1 off
//                         Meditite, 90 HP, ×2 Psychic, no Resistance)
//   "Plotter's Command" — Oranguru sv02-094, {P}{C}, 30, INDEX 0 (Basic, 120 HP,
//                         ×2 Darkness, −30 Fighting)
//
// and the two effect strings are BYTE-IDENTICAL (asserted by the D1 itself:
// `json_extract(attacks_json,'$[0].effect')` compares equal across the two rows),
// which is why this is ONE anchor for two printings rather than D121's
// second-printing warrant being met by two similar sentences.
//
// ⚠️ AND `FIXTURE_POOL` WAS SWEPT SEPARATELY, WHICH IS THE HALF D154's FINDING
// MAKES MANDATORY AND D156 MADE UNSKIPPABLE: the pool is a DIFFERENT POPULATION
// from the D1 — thirteen `swsh10.5` fixtures since D162, every one of which now
// HAS a catalog row again, so the two populations answer different questions
// rather than the same question at different sizes. No fixture carried this
// sentence before this slice, so TWO printings means two in both populations —
// unlike D154, which found a fifth printing fielded and (for the length of the
// outage) uncatalogued. The two ids are also swept repo-wide for a misnamed
// comment or test title (D146/D147's rule, D149's habit): nothing found, and that
// is the FIFTH clean sweep running.
//
// ⚠️ THE THIRD `Choose 1 of your opponent` ROW IS THE ONE WORTH NAMING, because it
// is what the `^…$` anchor is holding off: Sylveon sv06.5-022's "Mystical Return"
// prints "Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon…" —
// a lowercase mid-sentence "choose", a different noun ("Benched Pokémon") and a
// coin in front of it. The capitalised `^Choose` plus the whole-sentence anchor
// refuses it before any of that is considered.
//
// A WHOLE-SENTENCE ANCHOR WITH **NO CAPTURE**, and the absence is the finding
// rather than a saving. Its two siblings above capture the attack's printed NAME
// because the card names it; this sentence names nothing — "that attack" is
// ANAPHORIC, pointing at a choice the player has not made yet — so there is no
// token to capture and D120's "does exactly one token VARY?" is answered by a
// sentence in which nothing varies at all. The address is produced by the PARK
// and arrives as an INDEX on the answer, which is exactly the value D154's record
// already stores.
//
// THREE apostrophe slots, all carrying `['’]` (D136/D137): two POSSESSIVES
// ("opponent's", "Pokémon's") and one CONTRACTION ("can't"). It is the first
// sentence in this file to expose all three at once — D154's exposes the
// contraction, D155's the possessive on "Pokémon" — so it is the row that fails
// hardest if the class is dropped anywhere, and `clauseApostrophe.test.ts` sweeps
// it off the two fixtures.
//
// No /i, for the standing reason (see TYPED_SELF_DISCARD): the capitalised
// "Choose" plus `^…$` is the whole guard, and it is what keeps Sylveon's
// heads-gated sentence and the thirteen lowercase "you can't use…" Ability
// limiters (D154's census) off this path.
const OPPONENT_CHOSEN_ATTACK_LOCK =
  /^Choose 1 of your opponent['’]s Active Pokémon['’]s attacks\. During your opponent['’]s next turn, that Pokémon can['’]t use that attack\.$/;
// ── D148: the OPPONENT-side lock, the same rider pointed across the table ──
//
// THE ENERGY-COST COMPOUND — Eiscue ex sv03-042 (Double rare) / sv03-210 (Ultra
// Rare) / sv03-222 (Special illustration rare) "Scalding Block" ({W}{W}{W}, attack
// INDEX 0, printed 160), 3 printings of ONE attack in three rarities, so D121's
// second-printing warrant is met by the card rather than by a family argument.
// Every field re-queried per printing against the local D1 (2026-08-02,
// 978 cards / 6 sets — the same mis-scoped tag D161 corrected on the D147 census
// above; this query also predates the outage, `history.lastSeen` being 2026-08-02):
// identical name, cost, index, damage and effect string on all three.
// ⚠️ RE-RUN AND CLOSED AT D173 against the restored 978 / 6 catalog, and it moved
// in NEITHER direction: still exactly THREE printings of "Scalding Block", still
// {W}{W}{W} / index 0 / 160 / one byte-identical effect string on all three, and
// the sentence returns those same three rows across all three text columns. The
// tag was the only thing ever wrong here and D161 had already fixed it — so this
// re-run is a CONFIRMATION, which is the outcome D161 named when it said the way
// to tell a floor from a total is to read the DATE before the number. It is
// recorded rather than left implicit so a fifth pass does not re-own it.
//
// ⚠️ THERE IS NO BARE ANCHOR, AND THAT IS A CENSUS RESULT RATHER THAN A CHOICE —
// exactly as it was for `COUNTER_PUT_ANY_THEN_SELF_LOCK`'s first sentence one
// slice back. "During your opponent's next turn, the Defending Pokémon can't
// attack." is printed NOWHERE in the pool as a standalone attack sentence; the
// compound is the only form it takes. So a bare pattern would map a sentence no
// card prints (D120), and this anchor is the whole reading.
//
// TWO SENTENCES, TWO OPS, IN PRINTED ORDER — `DEFENDER_POISON_CANT_RETREAT` (arm
// 5c), `COUNTER_PUT_ANY_THEN_SELF_LOCK` (arm 25) and `SELF_DISCARD_ALL_THEN_REDUCTION`
// (D147) are the precedents, and the reason this is one anchored pattern rather
// than a prefix match: the family's safety property is that an unrecognised
// remainder stays LOUD, and a prefix would ship the COST without the effect it
// buys — an attack the catalog does not print, which is strictly worse than
// leaving the card unread.
//
// ⚠️ THE FIRST HALF IS ALREADY BUILT AND IT PARKS. "Discard an Energy from this
// Pokémon." has derived to `discardEnergy { from: "yourActive", filter: anyEnergy }`
// since 0.x (`SELF_DISCARD_ONE`, arm 7) and it is the family's oldest PARKING op —
// with two different Energy attached, which one goes is a real decision. So this
// is the second sentence in the tail to put a durated install BEHIND a park
// (Ninetales was the first), and the first to put an OPPONENT-side one there.
// `SELF_DISCARD_ONE`'s own `^…$` is what keeps this string off the bare discard
// path, in the direction D145 said would matter the day this family landed.
//
// THREE apostrophe slots, all classed (D136/D137): the possessive "opponent's" and
// the contraction "can't" — the asymmetry D137 found, and classing one and not the
// other is precisely the half-fix that reads like a whole one. No /i, for the
// standing reason (see TYPED_SELF_DISCARD): the capitalised "Discard" plus `^…$`
// is the whole guard.
const SELF_DISCARD_ONE_THEN_DEFENDER_LOCK =
  /^Discard an Energy from this Pokémon\. During your opponent['’]s next turn, the Defending Pokémon can['’]t attack\.$/;
// …and the CLASS-GATED form — Houndoom ex sv03-134 "Evil Claw" ({D}{D}, attack
// INDEX 0, printed 90), 1 printing. THE SAME LOCK behind a printed condition, and
// the family's first sentence whose DURATION sits at the END rather than at the
// front.
//
// ⚠️ TWO REGEXES AND NOT ONE, AND THE DURATION PLACEMENT IS ONLY THE SECOND
// REASON. The family's rule is ONE anchored whole-sentence regex per PRINTED
// STRING (D136/D137), and these two strings share four words. There is no shape
// an alternation could take here that would not be two patterns wearing one name:
// they differ in the first clause, in whether there is a gate at all, in the
// subject's noun phrase ("the Defending Pokémon" vs "it") and in where the four
// duration words sit. What they share is the ACTION, and the action is shared as
// an OP rather than as a pattern — which is the family's checkable claim (D134's
// on the heads face, D144/D145's on tails): this anchor's `then` is the OTHER
// anchor's second op, byte for byte.
//
// ⚠️ THE GATE IS AN EXISTING MECHANISM, WHICH IS WHY THE CLASS COSTS NO FIELD.
// `conditionGate { cond, then }` has spliced a deterministic branch into the work
// queue since M4, and `BoardCondition` is the union its `cond` comes from — so the
// printed "If the Defending Pokémon is a Basic Pokémon" is ONE new member
// (`opponentActiveIsBasic`, the exact complement of `opponentActiveIsEvolution`
// which has been in that union since D115) and nothing else. D132's inventory rule
// with the gate, the op and the predicate all pre-existing.
//
// "Basic" IS HARD-CODED RATHER THAN CAPTURED, which is D146's call one slice back
// on the same word: that anchor spells `by attacks from Basic Pokémon` and lets
// the pool's other class token (Ancient) stay LOUD, and the vocabulary is closed
// where the READING is (there, the `fromClass` union; here, `BoardCondition`).
// A `(.+)` here would have to reject "an Evolution Pokémon" and eleven type names
// through a table nothing in the pool asks for — D120's precondition (does exactly
// one token VARY across printings?) is answered NO by a one-printing sentence
// whose sibling readings live on different skeletons entirely.
//
// TWO apostrophe slots, both classed: the contraction "can't" and the possessive
// "opponent's". No /i — the capitalised "If" plus `^…$` is the guard, and it is
// what keeps this pattern off `deriveAttackRequirement`'s own `^If` sentences,
// whose consequent is "this attack does nothing" (attack.ts's disjointness note).
const DEFENDER_BASIC_CANT_ATTACK =
  /^If the Defending Pokémon is a Basic Pokémon, it can['’]t attack during your opponent['’]s next turn\.$/;
// …and the LAST TWO members of that shape (D145), which CLOSE the bare
// tails-gated family: the same gate over the two consequents whose ops this
// engine has owned since 0.x, so each is ONE regex and ONE arm with no
// mechanism, no op, no event, no park and no interpreter diff at all.
//
//   • "Flip a coin. If tails, discard all Energy from this Pokémon."
//       Pikachu ex sv02-063 "Dynamic Bolt" (INDEX 1, {L}{L}{C}, printed 220)
//       Beartic    sv03-054 "Frost Purge"  (INDEX 1, {W}{W}{C}, printed 170)
//   • "Flip a coin. If tails, this Pokémon also does 60 damage to itself."
//       Oinkologne sv03-183 "High-Impact Kick" (INDEX 1, {C}{C}{C}, printed 160)
//
// ⚠️ ALL THREE ARE AT INDEX 1, verified PRINTING BY PRINTING against the local D1
// (2026-08-02) rather than once for the family — D144 found an index that is not
// constant WITHIN one family (1 on the Oinkologne printings, 0 on the Clodsire
// ones), so an index is a per-printing fact for good. sv03-183 is a THIRD
// Oinkologne and a DIFFERENT CARD from D144's sv01-157 (D135's Arboliva finding:
// a registry row for one id is not a second printing of another).
//
// CONSEQUENT CENSUS 1 — "discard all Energy from this Pokémon" (local D1,
// 2026-08-02, 978 cards / 6 sets), run because D144's census was run for the FACE and a
// census run for one purpose is a FLOOR for every other (D142's rule). The verb
// matters: `%all Energy from this%` returns 14 attack printings, and FOUR of them
// say MOVE rather than discard (Blissey sv01-145, Tropius sv02-007/-195, Darkrai
// sv03-136 — `moveEnergy`, a different op entirely). The ten DISCARD printings
// split three ways, and the split is what fixes this anchor's width:
//   • BARE, the whole printed effect (4) — Pawmot sv01-076/-209 "Electro Paws",
//     Raichu sv02-064/-211 "Thunderbolt". ✅ `SELF_DISCARD_ALL` since 0.x;
//   • TAILS-GATED (2) — the two printings above. ✅ HERE;
//   • COMPOUND, a SECOND SENTENCE after the discard (4) ❌ LOUD — Weavile
//     sv06.5-014 "Hail Claw" (+ a Paralyze), Kyurem sv06.5-047 "Trifrost" (+ a
//     three-target snipe), Eiscue sv02-048/-205 "Frigid Block" (+ a durated
//     "takes 100 less damage", which is item 4 of D144's remainder list).
// ⚠️ SO A WIDER ANCHOR WOULD SWALLOW FOUR REAL CARDS AND SHIP HALF OF EACH. The
// whole-sentence `^…$` is the entire guard, and the hazard is LIVE rather than
// theoretical: the day the `takes {N} less damage` family lands, Eiscue's two
// halves both derive and the compound still must not match here. 0 Abilities and
// 0 Trainers print this clause at all, so there is no lowercase twin to fear and
// the capital "Discard" is the family's second guard rather than the first.
//
// A `test`, not an `exec`: nothing varies. NO apostrophe slot anywhere in the
// sentence — the first member of this family with none — so there is no
// D136/D137 exposure to class, which is stated rather than left to be re-checked.
const FLIP_TAILS_SELF_DISCARD_ALL =
  /^Flip a coin\. If tails, discard all Energy from this Pokémon\.$/;
// CONSEQUENT CENSUS 2 — "This Pokémon also does {N} damage to itself." (same D1,
// same day). **48 printings, and 47 of them are BARE** — the recoil rider is one
// of the pool's most reprinted sentences (Skeledirge sv01-038 "Blazing Shout",
// Magneton, Great Tusk ex, Koraidon ex, Wild Charge/Take Down/Reckless Charge on
// a dozen lines, …), all ✅ `SELF_DAMAGE` since 0.x. **Exactly ONE is gated**, and
// it is this one. There is no heads-gated printing, no other gate, no Ability and
// no Trainer print — so the only reading a wider anchor could invent is one the
// ingest has never produced.
//
// ⚠️ IT IS A ONE-PRINTING SENTENCE, AND D134's RULE IS WHAT LICENSES IT: when a
// one-printing sentence is an INSTANCE of a shape the engine already reads, the
// warrant is owed by the SHAPE, not by the printing. It is an instance on BOTH
// axes at once — the gate has been read on 5 printings since D144, and the
// consequent on 47 since 0.x — so it is the eighth member of a family rather
// than a bespoke row for one card. (The neighbouring sentence above clears D121
// on its own, in D139's stronger form: TWO cards from TWO sets.)
//
// THE AMOUNT IS CAPTURED, exactly as `FLIP_SELF_HEAL`'s is, and NOT narrowed to
// the printed 60 the way `FLIP_DECK_TOP_MILL` was narrowed. The narrowing there
// was about TWO axes (a plural count AND either deck) where widening would have
// invented three readings; here one number varies, the bare anchor already reads
// any N, and the capture is what keeps the derived `then` byte-identical to the
// bare anchor's own output for every N rather than for one. Worth noting: 60 is
// an amount NO bare printing carries (the 47 print 10/20/30/50/90), so a literal
// would have been right today and blind to why.
//
// The `(\d+)` and the `>= 1` guard below are the bare arm's, verbatim: a printed
// 0 is not a real card and would derive to a silent no-op. NO apostrophe slot
// here either. No /i, for the family's standing reason — the capitalised "Flip"
// plus `^…$` is the whole guard, and the consequent's lowercase "this" is what
// keeps `SELF_DAMAGE`'s own `^This` off this string in the other direction.
const FLIP_TAILS_SELF_DAMAGE =
  /^Flip a coin\. If tails, this Pokémon also does (\d+) damage to itself\.$/;
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
// §7.1/§7.2 (D283) — the TURN-SCOPED IMPOSED HAND-PLAY LOCK, `preventHandPlay`.
// **8 legal printings on 3 printed sentences**, and they are THREE anchors for
// D136/D137's reason and not one loose one: the pool prints the same rule with
// the window LEADING (Budew sv08.5-004, Frillish sv10.5w-044/-126), with the
// window TRAILING (Scream Tail ex sv06-094/-197), and BEHIND A PRINTED COST
// (Galvantula ex sv07-051/-159/-168). Three sentences, three `^…$` patterns.
//
// ⚠️ THE CLASS IS A CAPTURE AND NOT A THIRD PAIR OF ANCHORS, which is the one
// place this family deviates from D136/D137's "a different noun is a different
// sentence" rule — and the deviation is principled: `Item` and `Supporter` sit in
// the SAME grammatical slot of the SAME sentence, so the two readings are one
// string with one hole, exactly as `DEFENDER_POISON_N`'s `(\d+)` is. Anchoring
// them separately would be two regexes differing in one word.
// ⚠️ AND THE ALTERNATION IS CLOSED (`Item|Supporter`, never `\w+`): a future
// *"they can't play any Pokémon from their hand"* (Bronzong sv05-069's clause,
// which bars an EVOLVE and not a play) must stay on the loud
// ATTACK_EFFECT_SKIPPED path rather than deriving into a bar the engine cannot
// honour — the exact false-positive `handPlayBarred` has no gate for.
const OPPONENT_CANT_PLAY =
  /^During your opponent['’]s next turn, they can['’]t play any (Item|Supporter) cards from their hand\.$/;
const OPPONENT_CANT_PLAY_TRAILING =
  /^Your opponent can['’]t play any (Item|Supporter) cards from their hand during their next turn\.$/;
// The COMPOUND, and it is `SELF_DISCARD_ALL_THEN_REDUCTION`'s exact twin one
// family over: the same printed cost, the same `^…$` mutual exclusion against
// arm 9's bare `SELF_DISCARD_ALL`, and the same reason for existing at all —
// matching the lock clause alone would silently swallow the discard, which is
// `DEFENDER_POISON_CANT_RETREAT`'s stated ground two lines up.
const SELF_DISCARD_ALL_THEN_HAND_LOCK =
  /^Discard all Energy from this Pokémon\. During your opponent['’]s next turn, they can['’]t play any (Item|Supporter) cards from their hand\.$/;

// §10 (D285) — the POKÉMON-SURFACE spelling of the same window, and the FOURTH
// sentence of this family. Bronzong `sv05-069` "Evolution Jammer", 1 legal
// printing (the whole Standard population of a turn-scoped Pokémon play bar,
// measured against the remote D1 on 2026-08-08).
//
// 🛑 IT IS ITS OWN ANCHOR AND NOT A WIDENED ALTERNATION OF `OPPONENT_CANT_PLAY`.
// That pattern captures a `(Item|Supporter)` word and hands it to
// `handPlayClassOf`; this sentence has no class word at all and instead carries
// a TRAILING RIDER — "to evolve their Pokémon" — which is the entire difference
// between it and a bar on every Pokémon play. Folding it in would mean an
// alternation whose capture is sometimes a class and sometimes nothing, with the
// rider optional; a printing that dropped the rider would then silently parse as
// this one. Two `^…$` anchors, mutually exclusive by construction.
const OPPONENT_CANT_EVOLVE_FROM_HAND =
  /^During your opponent['’]s next turn, they can['’]t play any Pokémon from their hand to evolve their Pokémon\.$/;

/** The captured class word → the `StampedHandPlayClass` key `preventHandPlay`
    carries.
    Written once for the three anchors above rather than spelled at each `exec`
    (the EXTRACT rule): a widened alternation that forgot one site would be a
    silent mis-classification, and here it is a compile error instead. Both arms
    are reachable off printed text — `Supporter` from Scream Tail ex, `Item` from
    the other six printings — so neither is a branch no board can take. */
function handPlayClassOf(word: string | undefined): StampedHandPlayClass {
  return word === "Supporter" ? "Supporter" : "Item";
}
// §12 (D177) — the DISCRETE recovery, ATTACK half. Gardevoir ex sv01-086 / -228 /
// -245 "Miracle Force" ({P}{P}{C}, 190) prints this as its WHOLE effect on all
// three printings, byte-identical, which is why one anchored pattern covers the
// family and the two reprints need no registry row: the seam is TEXT-keyed, not
// id-keyed (attack.ts consults `programFor(...).attack` first and finds nothing).
//
// ⚠️ THE CENSUS, AND ITS PREDICATE IS THE POINT (D174's standing warning, paid).
// Local D1, 978 cards / 6 sets (sv01 258 / sv02 279 / sv03 230 / sv06.5 99 / sve
// 24 / swsh10.5 88), re-derived 2026-08-04 over ALL THREE text columns:
//
//   select id, name from cards
//    where lower(coalesce(effect,'')) like '%recovers from%'
//       or lower(coalesce(abilities_json,'')) like '%recovers from%'
//       or lower(coalesce(attacks_json,'')) like '%recovers from%';
//   -- sv01-086, sv01-228, sv01-245 Gardevoir ex | sv01-145 Blissey
//   --                                           | sv02-193 Therapeutic Energy
//
// FIVE rows, FOUR of them this family: the fifth is sv02-193, which prints
// "recovers from BEING Asleep, Confused, or Paralyzed" — a NAMED set and a
// CONTINUOUS effect, built at D174 as `PassiveEffects.statusRecovery` and NOT
// reachable by this anchor (its text is an Energy `effect`, never an attack).
// Sweeping `%special condition%` returns those five plus three unrelated readers
// (Vivillon sv01-010 chooses one to inflict, Sableye sv02-136 scales damage off
// one, Muk sv01-127 below), and eight other verb spellings — "is cured", "cured
// of", "removes all Special", "no longer affected", … — return ZERO rows. So the
// family is CLOSED at four printings on this catalog.
//
// ⚠️ THE NEAR-MISS THE WIDER VERB TURNED UP, AND IT IS A DIFFERENT MECHANISM.
// Muk sv01-127 "Poison Sacs": "Your opponent's Poisoned Pokémon don't recover
// from that Special Condition when they evolve or devolve." That is the NEGATIVE
// form — a modifier on §10's evolution clear (turn.ts, `reason: "evolved"`),
// carrying no op and no moment of its own — and it is DELIBERATELY NOT BUILT
// here: it would be a rule about a clear this op never performs. Named rather
// than left, on D171's Corviknight rule, so the next census greps the repo and
// finds it already counted.
//
// No /i, on the family's standing reason: the capitalised "This" plus `^…$` is
// what keeps a mid-sentence clause off the derived path. No apostrophe slot —
// the sentence carries none in either direction.
const SELF_RECOVERS_ALL = /^This Pokémon recovers from all Special Conditions\.$/;
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
// D145 — the "all" form is also printed BEHIND A TAILS on two more cards, and
// that anchor (`FLIP_TAILS_SELF_DISCARD_ALL`) derives THIS arm's exact op inside
// a `coinFlipGate`. The two are mutually exclusive by the capital "Discard" plus
// `^…$`, before the anchors are even considered. The whole-sentence anchor here
// is also what keeps FOUR compound printings LOUD (Weavile sv06.5-014, Kyurem
// sv06.5-047, Eiscue sv02-048/-205), each of which prints a second sentence after
// the discard — see that anchor's census.
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
// 🆕 D296 — THE "PUT IT BACK IN THEIR HAND" TWIN OF THE LINE ABOVE, DECLINABLE
// AND OPTIONALLY STAGE-GATED. Four legal printings on three sentences: Octillery
// `sv09-034` "Aqua Wash" (an), Unfezant `sv05-135` "Opposing Winds" + Slowking
// `sv08.5-019` "Wash the Slate Clean" (2), Paldean Tauros `sv08-039`
// "Upthrusting Horns" (2, Stage 2).
//
// 🛑 **"You may " IS REQUIRED AND IS NOT AN OPTIONAL GROUP.** The catalog prints
// the MANDATORY twin too — Omanyte `sv03.5-138`/`-180` "Tentacular Return":
// *"Put an Energy attached to your opponent's Active Pokémon into their hand."*
// — and BOTH printings are `legal_standard = 0` (queried, remote D1). Loosening
// the leading words into `(?:You may )?` would derive a sentence with no legal
// printing behind it, i.e. author a card; the bare form stays on the loud
// skipped path and `aquaWash.test.ts` pins it there.
//
// The apostrophe class is the D136/D137 hardening every sibling on this same
// noun phrase carries — a re-ingest changing only punctuation must not silently
// un-derive the sentence.
const MAY_PUT_OPPONENT_ACTIVE_ENERGY_TO_HAND =
  /^You may put (an|\d+) Energy attached to your opponent['’]s Active (Stage 2 )?Pokémon into their hand\.$/;
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
// D145 — CENSUSED: this sentence is printed BARE on 47 of its 48 printings (the
// pool's most reprinted recoil rider by a distance), and the 48th is behind a
// TAILS — Oinkologne sv03-183 "High-Impact Kick", read by
// `FLIP_TAILS_SELF_DAMAGE` into this arm's exact op inside a `coinFlipGate`. The
// two anchors are mutually exclusive by the capital "This" plus `^…$`; the gated
// string's "this" is lowercase and mid-sentence, which is the same second guard
// the rest of this file leans on.
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
// taken." — Pecharunt ex sv06.5-039 60×, Annihilape sv01-109 70×; and, since D167,
// "… for each damage counter on this Pokémon." — Drifloon sv01-089 30×, Onix
// swsh10.5-036 50×, the no-adjective twin of the very line below). That is a
// DISTINCT fold, not a `count` member, so it has its OWN regex + reader
// (SELF_COUNTER_MULTIPLY / OPPONENT_PRIZES_MULTIPLY /
// deriveAttackDamageMultiplier below) — the parse is
// the same `{per, count}` shape (the count evaluator is reused UNCHANGED), only
// attack.ts's fold differs. Each additive regex must therefore REFUSE its
// no-"more" twin (the multiply reader owns it), and vice versa. The anchored
// whole-sentence match and the capital `This` are the rest of the guard. No /i,
// for the family's stated reason: the anchors and the capital first word are what
// keep a mid-sentence clause off this path.
const SELF_COUNTER_SCALE =
  /^This attack does (\d+) more damage for each damage counter on this Pokémon\.$/;
// D163 — THE SIGN-FLIPPED TWIN OF THE LINE ABOVE, and the THIRD fold this family
// has. "This attack does {10|20} less damage for each damage counter on this
// Pokémon." — 5 printings / 2 sentences, measured against the local D1
// (2026-08-03, 978 cards / 6 sets) across all three text columns, and all five
// rows are `attacks_json`: Skeledirge ex sv02-037/-233/-258/-272 "Burning
// Voice" (idx 1, {R}{R}, printed "270-", 10 per counter — four rarities of ONE
// attack) and Cetitan sv01-060 "Sweeping Tackle" (idx 1, {W}{C}{C}, printed
// "200-", 20 per counter). It is the WHOLE of what §D147's `less damage` census
// (31 printings / 14 sentences) had left unread.
//
// ⚠️ IT IS A THIRD READER RATHER THAN A `count` MEMBER OR A NEGATIVE `per`, AND
// THE GROUND IS THE FOLD, WHICH IS WHAT ALREADY SPLITS THIS FAMILY. The additive
// and multiply readers are two functions over ONE `{per, count}` interface and one
// count evaluator, "differing ONLY in attack.ts's fold" — `+` onto a printed base
// versus `×` with the base dropped. A subtraction is a THIRD fold (keep the base,
// subtract), so it is a third reader by the rule the file already runs on. The two
// dodges were priced and both are refused by a CONSUMER (D155's test):
//   • a NEGATIVE `per` returned from `deriveAttackDamageBonus` would flow into
//     `DAMAGE_DEALT.scaled`, whose presence guard is `scaledTotal > 0` (so the
//     number would vanish from the row) and whose log crumb hard-codes the sign
//     (` · scaled +${n}` — it would render "+-40"). The record is
//     direction-committed at BOTH consumers; and
//   • a `direction` discriminator ON the shared interface would be paid by
//     `deriveAttackDamageMultiplier`'s consumers, which have no direction to
//     declare — a `×` fold is neither more nor less.
// The `{per, count}` interface and `scaledAttackDamage`'s count evaluator (FOUR
// members when this was written, five since D168)
// ARE reused, whole and unchanged: only one member is printed with this
// sign, and inventing a second answer to "how many counters are on the attacker"
// is the thing D159's rule forbids.
//
// The near-misses on the SAME count source are all real catalog rows and all
// refused by the anchors alone. ⚠️ THE FIRST OF THEM IS NO LONGER UNREAD: D167 put
// the MULTIPLY twin — "This attack does {30|50} damage for each damage counter on
// this Pokémon.", no adjective at all (Drifloon sv01-089 idx 1 "Balloon Blast"
// 30×, Onix swsh10.5-036 idx 1 "Raging Swing" 50×) — on the line below, exactly
// where this block predicted it ("one regex away in the multiply reader"). What
// remains unread (see the census in selfScalingPenalty.test.ts) is the
// opponent-side count "…for each damage counter on your opponent's Active
// Pokémon." (Dedenne sv01-095, Espeon sv03-086, Bloodmoon Ursaluna sv06.5-025 —
// ✅ NO LONGER UNREAD: D168 gave it OPPONENT_COUNTER_SCALE below and the fifth
// `DamageCountSource`, `damageCountersOnOpponentActive`, so the "still unread"
// above no longer covers this clause), the bench-wide count (Tyranitar
// swsh10.5-043 — ✅ ALSO NO LONGER UNREAD: D170 gave it BENCH_COUNTER_MULTIPLY
// below and the sixth `DamageCountSource`, `damageCountersOnYourBench`) and
// Annihilape ex sv02-242's two-sentence compound, which is the ONLY row of this
// neighbourhood still unread. No /i, whole-sentence anchored
// and a capital `This`, for the family's stated reason.
const SELF_COUNTER_PENALTY =
  /^This attack does (\d+) less damage for each damage counter on this Pokémon\.$/;
// D167 — THE THIRD ADJECTIVE, which is NO ADJECTIVE: the `×`/multiply twin of the
// two lines above, on the very same count source. "This attack does {30|50} damage
// for each damage counter on this Pokémon." — 2 printings / 2 sentences, measured
// against the local D1 (2026-08-03, 978 cards / 6 sets) across all three text
// columns, and both rows are `attacks_json`: Drifloon sv01-089 "Balloon Blast"
// (idx 1, {P}{P}, printed "30×") and Onix swsh10.5-036 "Raging Swing" (idx 1,
// {F}{F}{C}{C}, printed "50×"). One `(\d+)` capture spans both, which is the whole
// of this rule.
//
// ⚠️ IT IS A THIRD REGEX AND **NOT** A THIRD READER, AND THAT IS THE POINT: the
// split in this family is by FOLD, and this sentence's fold ALREADY EXISTS.
// `deriveAttackDamageMultiplier` is the `×` fold — `per × count` is the whole
// damage and attack.ts drops the printed "N×" base — and it has held two count
// sources since 0.35.0 (the opponent's taken Prizes, the defender's effective
// Retreat Cost). This printing is a THIRD SOURCE on that same fold, and the source
// it names (`damageCountersOnSelf`) is not new either: the union member and
// `scaledAttackDamage`'s arm for it have been live since M2 for the ADDITIVE twin.
// So the price is one regex and one `if` — no new `DamageCountSource`, no new
// evaluator arm, no new fold, no branch in attack.ts, and D159's rule ("do not
// invent a second answer to a question the engine already answers") is what makes
// reuse mandatory rather than merely available.
//
// It is placed FIRST in the reader, mirroring `deriveAttackDamageBonus`'s arm order
// (self counters, then Prizes, then Retreat Cost), so the two readers over one
// `{per, count}` interface read the same way down the page. The order is not
// observable — the three regexes are whole-sentence anchored and mutually
// exclusive — which is exactly why it should be the legible one.
//
// Refuses BOTH of its adjectived twins by the missing word (the additive reader
// owns "more", the subtractive one "less"), and every near-miss the two blocks
// above enumerate by the anchors. No /i, whole-sentence anchored and a capital
// `This`, for the family's stated reason.
const SELF_COUNTER_MULTIPLY =
  /^This attack does (\d+) damage for each damage counter on this Pokémon\.$/;
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
// D168 — the OPPONENT-SIDE damage-counter count, and the first count source this
// family reads off the DEFENDING body's own `damage` field. "This attack does
// {10|30} more damage for each damage counter on your opponent's Active Pokémon."
// — 3 printings / 2 distinct sentences, measured against the local D1
// (2026-08-03, 978 cards / 6 sets) across all three text columns, and all three
// rows are `attacks_json`: Dedenne sv01-095 "Second Bite" (idx 0, {P}{C}, printed
// "30+", 10 per counter), Espeon sv03-086 "Psychic Assault" (idx 0, {P}, printed
// "30+", 10 per counter — the SAME sentence on a second printing) and Bloodmoon
// Ursaluna sv06.5-025 "Mad Bite" (idx 0, {F}{F}{C}, printed "100+", 30 per
// counter). One `(\d+)` capture spans both amounts.
//
// ⚠️ IT IS A `count` MEMBER RATHER THAN A READER, AND THAT IS THE INVERSE OF D163's
// ANSWER ON A SENTENCE ONE WORD AWAY. The split in this family is by FOLD (D163):
// `+` keeps the printed base, `×` drops it, `−` keeps it and subtracts. This
// sentence carries "more", so its fold is the one `deriveAttackDamageBonus`
// already performs, byte for byte — what is new is only WHICH RESOURCE gets
// tallied, and that is exactly what `DamageCountSource` is. A fourth reader would
// have duplicated a fold to vary a count; a fifth member varies the count and
// reuses the fold, which is the axis the type was built on.
//
// ⚠️ AND IT IS DISJOINT FROM BOTH SELF-COUNTER PATTERNS BY THEIR LITERAL TAIL, IN
// BOTH DIRECTIONS. SELF_COUNTER_SCALE and SELF_COUNTER_PENALTY are the only other
// patterns in the file carrying the words "damage counter", both are `^…$`-anchored
// and both end in the LITERAL `on this Pokémon\.` — so neither can match this
// sentence and this one cannot match theirs, without either side needing a
// negative lookahead. Asserted rather than argued (opponentCounterScaling.test.ts
// sweeps the whole pool for a double answer).
//
// The possessive carries the `['’]` class per D137's fix, exactly like the
// RETREAT_COST_* pair two lines up: all three catalog rows print the ASCII `0x27`
// today (hex-verified on the D1 rows, not eyeballed), and the class is insurance
// against a re-ingest that normalises punctuation — half a fix reads exactly like
// the whole one until it does not. `Pokémon` carries the real é (U+00E9, `C3A9` on
// the wire); a lookalike would fall off the path silently. No /i, whole-sentence
// anchored with a required trailing period and a capital `This`, for the family's
// stated reason.
//
// The near-miss worth naming is Trevenant sv03-012's Ability "Forest Miasma" —
// "During Pokémon Checkup, if this Pokémon is in the Active Spot, put 1 damage
// counter on your opponent's Active Pokémon." — the ONLY other catalog row in any
// text column carrying this possessive beside a damage counter. It is refused
// three times over (leading text, a PLACEMENT rather than a scaling clause, and an
// Ability, which this deriver is never handed).
const OPPONENT_COUNTER_SCALE =
  /^This attack does (\d+) more damage for each damage counter on your opponent['’]s Active Pokémon\.$/;
// D170 — the BENCH-WIDE damage-counter count, and the FIRST count source in this
// family that tallies over a ZONE rather than off a single body. "This attack
// does 10 damage for each damage counter on all of your Benched Pokémon." — ONE
// printing / ONE sentence, measured against the local D1
// (2026-08-03, 978 cards / 6 sets) across all three text columns, and the row is `attacks_json`: Tyranitar
// swsh10.5-043 "Raging Crash" (idx 0, {C}{C}, printed "10×"). The `(\d+)` capture
// is spanned by a single printed amount today, which is stated rather than hidden:
// this family's second-printing warrant (D121) is met by the OTHER members, and
// the capture is here because every sibling pattern has one, not because two rows
// exercise it.
//
// ⚠️ IT IS A `count` MEMBER ON AN OLD FOLD — D168's answer, on the other seat.
// The sentence carries NO adjective, so its fold is the `×` one
// `deriveAttackDamageMultiplier` has performed since 0.35.0 (the printed "10×"
// base IS the per-unit and attack.ts drops it); what is new is only WHICH
// RESOURCE is tallied. That buys the SIXTH `DamageCountSource` and one evaluator
// arm, not a fourth reader.
//
// ⚠️ AND IT IS THE FIRST MEMBER WHOSE ZONE IS THE ATTACKER'S OWN BENCH, WHICH IS
// THE SEAT THE OTHER COUNTER MEMBERS DO NOT READ. `damageCountersOnSelf` reads
// the attacking Active, `damageCountersOnOpponentActive` (D168) the defending
// one; this reads neither Active and every body on the ATTACKER's Bench —
// `scaledAttackDamage` gets there through `attackerSeat`, in scope since 0.66.0
// for the `boardCondition` indicator, so the signature takes no diff.
//
// DISJOINT FROM ALL THREE "damage counter" PATTERNS ABOVE BY THE LITERAL TAIL, IN
// BOTH DIRECTIONS: the two self ones end in `on this Pokémon\.`, D168's in
// `Active Pokémon\.`, this one in `on all of your Benched Pokémon\.`, and all four
// are `^…$`-anchored — so no side needs a negative lookahead. Driven both ways
// (benchCounterMultiply.test.ts) rather than argued.
//
// The near-misses are real catalog rows and all refused by the anchors alone:
// Oinkologne ex sv01-158/-234 "Maddening Scent" and Tyranitar sv02-135/-222
// "Rout" both print "This attack does 30 more damage for each of your opponent's
// Benched Pokémon." — the opponent's Bench, counted as BODIES rather than
// counters, with a "more"; and Tyranitar swsh10.5-043's OWN index-1 "Earthquake"
// ("This attack also does 20 damage to each of your Benched Pokémon. (Don't apply
// Weakness and Resistance for Benched Pokémon.)") names the same zone in the same
// card and is a SPREAD, not a scaling clause — UNSIMULATED, and deliberately left
// so. No /i, whole-sentence anchored with a required trailing period and a capital
// `This`, and `Pokémon` carries the real é (U+00E9) — the family's stated reason.
const BENCH_COUNTER_MULTIPLY =
  /^This attack does (\d+) damage for each damage counter on all of your Benched Pokémon\.$/;
// D193 — THE BENCH COUNTED AS BODIES, the mirror-image question to the line
// directly above and the first thing this family tallies that is not a damage
// counter, a Prize, a Retreat Cost or a 0-or-1 indicator. Two sentences, three
// patterns, re-measured against the D1 (2026-08-04) across all three text columns
// over the LEGAL pool (`legal_standard = 1`, 2,021 of 3,786) rather than the
// six-set census, and every row is `attacks_json`:
//
//   BOTH BENCHES, ADDITIVE — "This attack does 20 more damage for each Benched
//   Pokémon (both yours and your opponent's)." — 5 printings, 5 LEGAL, 0 in the
//   six-set census. Two printed bases over one sentence (`20+` and `60+`), which
//   is what earns the `(\d+)` capture rather than a literal.
//
//   ⚠️ AND IT IS ADD-ONLY BY MEASUREMENT, NOT BY GUESS. The pool holds NO
//   no-adjective twin of this sentence in any text column — the only other row
//   carrying the parenthetical beside a "for each" is "Shuffle your hand into
//   your deck. Then, draw a card for each Benched Pokémon (both yours and your
//   opponent's)." (1 printing, 0 legal), which draws cards and is not a damage
//   clause at all. So `bothSidesBenchCount` is reachable from ONE reader, and
//   that absence is pinned by a test rather than left to be re-discovered.
//
//   THE OPPONENT'S BENCH, BOTH FOLDS — "This attack does 20 more damage for each
//   of your opponent's Benched Pokémon." (5 printings, 4 LEGAL, `20+`) and "This
//   attack does 30 damage for each of your opponent's Benched Pokémon." (2
//   printings, 2 LEGAL, `30×`). 6 legal printings across the two folds.
//
// ⚠️ THE 30-MORE PRINTING D170's BLOCK NAMES IS NOW ZERO-LEGAL, AND THAT IS THE
// CORRECTION. BENCH_COUNTER_MULTIPLY's near-miss note above cites Oinkologne ex
// sv01-158/-234 "Maddening Scent" and Tyranitar sv02-135/-222 "Rout" printing
// "This attack does 30 more damage for each of your opponent's Benched Pokémon."
// That sentence is 9 printings and **0 legal** — it has rotated out entirely. The
// `20 more` sibling is what carries the additive fold in the legal pool today.
// The note above is left standing because it is still TRUE of the six-set
// population it was measured on; it is simply no longer the reason this pattern
// exists. Both are admitted by the one `(\d+)` capture either way.
//
// The adjective, not the noun, picks the fold — "more" keeps the printed base,
// bare drops it — which is why the two opponent-Bench patterns differ by exactly
// that word and the `damage` column corroborates (`20+` versus `30×`).
//
// DISJOINT FROM BENCH_COUNTER_MULTIPLY AND FROM EACH OTHER: that pattern requires
// the literal `damage counter on all of your` before its Bench noun, these three
// have no "damage counter" at all, and all four are `^…$`-anchored — so no side
// needs a negative lookahead. Driven both ways rather than argued. The
// possessive carries the `['’]` class per D137's fix and `Pokémon` the real é
// (U+00E9); the parentheses are escaped literals. No /i, whole-sentence anchored
// with a required trailing period and a capital `This`, for the family's stated
// reason.
const BOTH_BENCH_SCALE =
  /^This attack does (\d+) more damage for each Benched Pokémon \(both yours and your opponent['’]s\)\.$/;
const OPPONENT_BENCH_SCALE =
  /^This attack does (\d+) more damage for each of your opponent['’]s Benched Pokémon\.$/;
const OPPONENT_BENCH_MULTIPLY =
  /^This attack does (\d+) damage for each of your opponent['’]s Benched Pokémon\.$/;
// D282 — THE ATTACKER'S OWN BENCH, COUNTED AS BODIES, on BOTH folds. The exact
// mirror of the two patterns directly above with one word changed ("of your" for
// "of your opponent's"), and the third face of the noun `bothSidesBenchCount`
// spans — so the family that D193 left at "your opponent's" and "both" is closed
// by the one side it never had. Re-measured against the remote D1 `luminous`
// (2026-08-08) with `json_each` over `attacks_json`, GLOB `*for each of your
// Benched Pok*`, GROUPED BY SENTENCE before anything was priced:
//   • "This attack does (20) more damage for each of your Benched Pokémon."
//     — **3 legal** (`sv09-051`, `sv10.5b-076`, `sv10.5b-153`), ADDITIVE
//   • "This attack does (20) damage for each of your Benched Pokémon."
//     — **3 legal** (`sv06-018`, `sv06-170`, `sv08.5-010`), MULTIPLY
//   • "If you go second, you can't use this attack during your first turn. This
//     attack does 30 damage for each of your Benched Pokémon."
//     — **7 legal** (Terapagos ex ×7), MULTIPLY **behind a D281 gate clause**, and
//     reachable only through `splitAttackGateClause` below.
// **13 legal printings on ONE new count source across TWO folds** — so unlike
// `bothSidesBenchCount` (ADD-only by legality) and `opponentBenchCount`'s
// lopsided 6/4, this member arrives with both folds carried by legal rows and
// neither has to be pinned as an absence.
//   ⚠️ TWO PRINTINGS ARE POOL-ONLY AND NEITHER IS AN ARM: `svp-027`'s "10 more"
//   is this exact additive sentence at `legal_standard = 0` (so the arm is not
//   *reached* by it), and `sv03-022`/`sv04.5-005`/`-213`'s "…for each of your
//   Benched Pokémon **that has any {G} Energy attached**." is a PREDICATE-narrowed
//   noun (3 printings, 0 legal) — `ownerPrefix.test.ts` has named that exact
//   refusal since D186 and it stays named: these patterns end the noun at the
//   period, so the narrowed sentence falls to the loud ATTACK_EFFECT_SKIPPED path
//   rather than being read as the unfiltered total.
// DISJOINT from BENCH_COUNTER_MULTIPLY (which requires the literal `damage counter
// on all of your` before its Bench noun) and from the two opponent patterns (which
// require the possessive `opponent's`), and all `^…$`-anchored — driven both ways
// in `benchBodySelfScaling.test.ts` rather than argued.
const YOUR_BENCH_SCALE = /^This attack does (\d+) more damage for each of your Benched Pokémon\.$/;
const YOUR_BENCH_MULTIPLY = /^This attack does (\d+) damage for each of your Benched Pokémon\.$/;
// D193 — THE OPPONENT'S ATTACHED ENERGY, over two zones and with an OPTIONAL type
// filter: the first member of this family whose payload is not a condition, and
// the first whose count is already answered elsewhere in the engine (continuous.ts
// `countEnergyInPlay`, §6.3) so that no second answer is invented here. Re-measured
// against the D1 (2026-08-04) across all three text columns over the LEGAL pool;
// every row is `attacks_json`, and no ability or trainer text in the pool prints a
// "This attack does … for each … Energy attached" sentence at all.
//
//   ACTIVE ZONE, BOTH FOLDS — 11 legal printings, all UNTYPED:
//     additive (8) — "This attack does {30|40|50|90} more damage for each Energy
//                    attached to your opponent's Active Pokémon." (4 / 2 / 1 / 1
//                    legal; printed bases `30+`, `10+`, `80+`, `40+`, `20+`)
//     multiply (3) — "This attack does 20 damage for each Energy attached to your
//                    opponent's Active Pokémon." (`20×`)
//
//   BOARD ZONE, MULTIPLY ONLY — 6 legal printings, and the ONLY place a type
//   filter is legal-printed on this side:
//     "This attack does {60|40} damage for each Energy attached to all of your
//      opponent's Pokémon."            (2 + 1 legal, UNTYPED, `60×` / `40×`)
//     "This attack does 60 damage for each {R} Energy attached to all of your
//      opponent's Pokémon."            (2 legal)
//     "This attack does 40 damage for each Special Energy attached to all of your
//      opponent's Pokémon."            (1 legal — `Special` resolves through
//                                       CLAUSE_ENERGY_TOKENS like every other
//                                       token, so it costs this pattern nothing)
//
// ⚠️ THE ADDITIVE PATTERN IS ACTIVE-ONLY, AND THAT IS A MEASUREMENT AND NOT AN
// OVERSIGHT. "This attack does N more damage for each Energy attached to all of
// your opponent's Pokémon." is UNPRINTED — not merely zero-legal, absent from the
// pool in every text column. Widening OPPONENT_ENERGY_SCALE to admit the board
// zone would buy nothing but an unprinted sentence and a `zone` value no reader
// can produce, so the additive arm can only ever answer `zone: "active"`. That
// asymmetry is pinned by a test, because the next author to see `zone` on the
// type will assume both readers reach both values.
//
// ⚠️ AND THE TYPE FILTER IS OPTIONAL IN BOTH, THOUGH ONLY ONE FOLD PRINTS ONE.
// `(?:(.+) )?` is ATTACK_COIN_PER_ENERGY's exact shape (D128) and resolves through
// D118's `CLAUSE_ENERGY_TOKENS`, so both notations are admitted by construction:
// an absent token is the UNTYPED reading (`energyType: null`, every attached card)
// and an UNRESOLVABLE one falls through to the loud ATTACK_EFFECT_SKIPPED path
// rather than quietly counting everything. That distinction is the whole guard —
// `{C}` is deliberately absent from ENERGY_TYPE_BY_CODE (it is the conservative
// provision fallback for unauthored Special Energy), and "Basic Energy" is a card
// CATEGORY rather than a type and resolves to nothing at all, which is correct:
// "This attack does 40 damage for each Basic Energy attached to this Pokémon."
// (1 legal) asks a question `countEnergyInPlay` does not answer.
//
// THE ZONE IS THE PRINTED NOUN PHRASE, CAPTURED WHOLE. Both alternatives are
// complete printed phrases rather than a cross-product of optional fragments, so
// the pattern cannot admit "all of your opponent's Active Pokémon" or "your
// opponent's Pokémon" — neither of which is printed. `Pokémon` carries the real é
// (U+00E9) in every slot and both possessives carry the `['’]` class per D137. No
// /i, whole-sentence anchored with a required trailing period and a capital
// `This`, for the family's stated reason.
//
// The near-misses are real catalog rows and all refused by the anchors alone:
// the SNIPE shape "This attack does {20|30} damage to 1 of your opponent's
// Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and
// Resistance for Benched Pokémon.)" (3 legal) names a CHOSEN target and routes
// through `damageChosen`, never this fold; "Flip a coin for each Energy attached
// to this Pokémon. …" (D128) is served by `AttackFlipCount.attachedEnergy`; and
// "This attack does 30 more damage for each Energy attached to BOTH Active
// Pokémon." (10 printings, 8 legal) names a third zone that spans the table —
// ✅ NO LONGER UNREAD: D196 gave it SELF_ENERGY_BOTH_ACTIVES_SCALE below, and the
// SNIPE row above is still refused by both this pattern and that one.
const OPPONENT_ENERGY_SCALE =
  /^This attack does (\d+) more damage for each (?:(.+) )?Energy attached to your opponent['’]s Active Pokémon\.$/;
const OPPONENT_ENERGY_MULTIPLY =
  /^This attack does (\d+) damage for each (?:(.+) )?Energy attached to (your opponent['’]s Active Pokémon|all of your opponent['’]s Pokémon)\.$/;
// D196 — THE ATTACKER'S OWN ATTACHED ENERGY, the MIRROR of the two patterns
// directly above and the LARGEST member of this whole family: 38 printings / 21
// LEGAL across both folds, bigger than D193's three new members combined. Its
// sentence has been printed on this engine's board since 0.35.0 as the canonical
// UNSIMULATED-"+" witness (Entei sv03-030 "Blaze Ball"), which is why building it
// is a re-homing job and not just a reader — see the block above
// SELF_ENERGY_BOTH_ACTIVES_SCALE and `scaledDamage.test.ts`.
//
// Re-measured against the D1 (2026-08-04) over the LEGAL pool (`legal_standard =
// 1`, 2,021 of 3,786) across all three text columns. Every buildable row is
// `attacks_json`; the only ability row that names this noun ("… put 2 damage
// counters on the Attacking Pokémon for each {M} Energy attached to this
// Pokémon.", 2 printings / 2 legal) places COUNTERS rather than scaling damage and
// is refused by the anchor.
//
//   ADDITIVE — 26 printings, 12 LEGAL. Seven distinct legal sentences over five
//   type filters and one untyped: "This attack does {50} more damage for each {W}
//   Energy attached to this Pokémon." (3 + 2 legal, printed `50+` and `10+` — two
//   bases on ONE sentence, which is what earns the `(\d+)` capture), "{50} more …
//   for each Energy …" (2, UNTYPED, `30+`), "{40} more … {D}" (2, `20+`), "{80}
//   more … {R}" (1, `40+`), "{40} more … {L}" (1, `40+`), "{20} more … {M}" (1,
//   `100+`).
//
//   MULTIPLY — 12 buildable printings, 9 LEGAL, ALL UNTYPED: "This attack does
//   {30|40|50} damage for each Energy attached to this Pokémon." (5 + 3 + 1
//   legal, `30×` / `40×` / `50×`).
//
// ⚠️ TWO LEGAL ROWS ARE COUNTED BY THE RAW SENTENCE SWEEP AND ARE NOT BUILDABLE,
// which is the whole difference between the 23 an earlier recon reported and the
// 21 here. "This attack does 40 damage for each Basic Energy attached to this
// Pokémon." (1 legal) filters on a card CATEGORY — `Basic` is not in
// CLAUSE_ENERGY_TOKENS and resolves to nothing, so the reader stays LOUD rather
// than quietly scoring the unfiltered total. And "This attack does 30 damage for
// each {W} Energy attached to this Pokémon. Before doing damage, you may attach
// any number of Basic {W} Energy cards from your hand to this Pokémon." (1 legal)
// is a TWO-SENTENCE printing whose second half attaches Energy mid-attack; the
// whole-sentence anchor refuses it, and that refusal is load-bearing rather than
// incidental — the second sentence is the one thing in this family that could make
// "read at DECLARATION" observable.
//
// The type filter is OPTIONAL in both folds and both really print it (additive) or
// really do not (multiply), so `(?:(.+) )?` is not speculative on either arm — it
// is ATTACK_COIN_PER_ENERGY's exact shape (D128), resolved through
// `attachedEnergyFilter` so that "no filter printed" (`null`, count every attached
// card) and "a filter I could not read" (`undefined`, stay LOUD) never collapse.
// Spelled-out energy words reach it too (D118's dual notation: "… for each Water
// Energy attached to this Pokémon.", 3 printings / 0 LEGAL) — inside the 38 and
// outside the 21, and still not load-bearing.
//
// DISJOINT FROM THE TWO OPPONENT PATTERNS ABOVE BY TAIL ALONE, and from the SNIPE
// shape by head: "This attack does 20 damage TO 1 OF your opponent's Pokémon for
// each Energy attached to this Pokémon. (Don't apply …)" (5 printings / 3 legal)
// puts a target between the amount and the "for each", so `(\d+) damage for each`
// never lines up; it routes through `damageChosen` and is asserted to. "Flip a coin
// for each Energy attached to this Pokémon. …" (5 printings / 1 legal, D128) fails
// the capital-`This` head, and "For each {F} Energy attached to this Pokémon,
// discard the top card of your opponent's deck." (1 / 0) fails it too. No /i,
// whole-sentence anchored with a required trailing period, `Pokémon` with the real
// é (U+00E9) — the family's stated reason.
const SELF_ENERGY_SCALE =
  /^This attack does (\d+) more damage for each (?:(.+) )?Energy attached to this Pokémon\.$/;
const SELF_ENERGY_MULTIPLY =
  /^This attack does (\d+) damage for each (?:(.+) )?Energy attached to this Pokémon\.$/;
// D196 — THE THIRD ZONE, and the first thing this family counts that BOTH SEATS
// contribute to: the Energy attached to the two Active Pokémon, added together.
// `OpponentEnergyZone` deliberately does not reach it (D193 said so), and no
// `side` on any member could express it either — it is the `bothSidesBenchCount`
// argument one resource up.
//
// ONE VERBATIM SENTENCE, re-derived against the D1 (2026-08-04) across all three
// text columns: "This attack does 30 more damage for each Energy attached to both
// Active Pokémon." — 10 printings, 8 LEGAL, printed base `30+` on every row, and
// `attacks_json` only. Larger than two of D193's three new members put together.
//
// ⚠️ ADD-ONLY, AND BY LEGALITY RATHER THAN BY ABSENCE — which is the opposite
// answer to `bothSidesBenchCount` above and so worth stating rather than assuming.
// The no-adjective twin IS printed ("This attack does 30 damage for each Energy
// attached to both Active Pokémon.", `30×`) but it is 1 printing and **0 LEGAL**,
// so a MULTIPLY reader would buy an evaluator arm and a regex for a sentence no
// legal deck can play. It is refused and stays LOUD, and that refusal is pinned by
// a test rather than left to be re-discovered as an oversight.
//
// ⚠️ AND THERE IS NO TYPE FILTER, deliberately. The pool prints no typed spelling
// of this sentence in any column, so `(?:(.+) )?` here would buy an `energyType`
// no reader could ever produce a non-`null` value for — the mirror of D193's
// refusal to give OPPONENT_ENERGY_SCALE a zone capture it can never vary. The
// literal `for each Energy` is therefore the pattern, and a typed printing would
// correctly stay LOUD.
//
// The near-miss is one row and it is a COIN sentence: "Flip a coin for each Energy
// attached to both Active Pokémon. This attack does 60 damage for each heads." (1
// printing, 1 LEGAL) — the same noun counted as FLIPS rather than damage, which is
// D128's family and NOT `AttackFlipCount.attachedEnergy` either (that member reads
// "attached to this Pokémon"). It is refused here by the capital-`This` head and
// asserted to stay unread on both sides.
//
// No possessive and so no `['’]` class is needed — this is the only sentence in the
// neighbourhood that names neither seat. `Pokémon` carries the real é (U+00E9); no
// /i, whole-sentence anchored with a required trailing period and a capital `This`.
const SELF_ENERGY_BOTH_ACTIVES_SCALE =
  /^This attack does (\d+) more damage for each Energy attached to both Active Pokémon\.$/;
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
  // "at least" and "Energy in play" are each a hapax in 978 cards / 6 sets, so a template
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
  // 🆕 D326 — the "revenge" clause, and the family's first that reads a window
  // which has CLOSED rather than the board in front of the attacker: Iron Leaves
  // sv06-019 "Avenging Edge" (100+, +60), Revavroom sv06-125 "Rally Back"
  // (30+, +90), Alolan Marowak sv09-057 "Retaliate" (30+, +90) and Terrakion
  // sv10.5w-054/-135 "Retaliate" (50+, +80) — **FIVE printings on ONE row**, the
  // two Terrakion being byte-identical in rules text.
  //
  // 🛑 **`byAttack` IS LOAD-BEARING AND IS NOT DECORATION.** D271's bare gate
  // (Unfair Stamp, Hassel) says only that this seat lost a Pokémon during the
  // previous turn; these five print "by damage from an attack", and a Pokémon
  // that died to Checkup poison on the opponent's turn satisfies the bare gate
  // and NOT this clause. Reusing the bare member here would have scored a
  // revenge bonus off a burn, on a board the suite would have had to be looking
  // for to notice.
  //
  // ⚠️ THESE WERE INVISIBLE TO THE CENSUS THAT PRICED THIS FAMILY. D271 swept
  // `%were Knocked Out during%` and got 8 printings, all Trainer/Ability; the
  // literal cannot see these because "by damage from an attack" sits between the
  // verb and the "during". The bare-noun sweep `%Pokémon were Knocked Out%`
  // returns 14 legal, and the difference set is exactly these six.
  [
    "any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true },
  ],
  // Ethan's Pinsir sv10-001 "Rallying Horn" (70+, +100) — the SIXTH printing of
  // the clause above and the row that proves `owner` is an open parameter rather
  // than a Team Rocket special case: it prints BOTH narrowings at once, which is
  // why they are two optional fields on one `BoardCondition` member instead of
  // two members (a union could not have spelled the conjunction).
  //
  // A SECOND LITERAL ROW rather than a template over the owner, for
  // CONDITIONAL_DAMAGE_CLAUSES' standing reason (rows are matched FIRST): the
  // pool prints this clause with an owner exactly once, so a template would be
  // parameterising over a population of one, and the day a second owner prints
  // it can still be added over both without re-interpreting either.
  [
    "any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Ethan", byAttack: true },
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
/** ⚠️ D234 — THE BRACE CODE READ AS A **POKÉMON TYPE** RATHER THAN AS A PAYABLE
    ENERGY, and the two are a different axis rather than a wider version of the
    same one (§6.1, `POKEMON_TYPES`' own doc). Built FROM `ENERGY_TYPE_BY_CODE` so
    the nine shared codes cannot drift, plus the two the energy map deliberately
    omits:

    * **`N` → `Dragon`.** There is no Basic Dragon Energy, which is exactly why the
      energy map has no `N` — but a Pokémon is very much allowed to BE one, and 64
      Standard-legal rows are. Druddigon `sv09-115` "Dragon's Fury" prints
      *"…to 1 of your **{N}** Pokémon"*, the pool's only printed brace-coded
      ATTACH destination, and it is what this map exists for.
    * **`C` → `Colorless`.** Present here and absent there for the same reason
      read the other way round: `{C}` as an ENERGY is the conservative provision
      fallback for every unauthored Special Energy, so admitting it to a *provision*
      filter would silently match cards nobody meant — while `{C}` as a printed
      TYPE on a body is unambiguous, and 100 rows carry it. **No printing in the
      attach family spells it today**; it is here because a notation map that is
      total over its vocabulary cannot rot the way a hand-kept alternation does
      (`ENERGY_TYPE_BY_NAME`'s and `CLAUSE_POKEMON_TYPES`' rule), and
      `pokemonTypeCodesAreCanonical` pins it against `POKEMON_TYPES`. */
export const POKEMON_TYPE_BY_CODE: Readonly<Record<string, PokemonType>> = {
  ...ENERGY_TYPE_BY_CODE,
  N: "Dragon",
  C: "Colorless",
};
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
/** D154 — the SAME fold, applied to a CAPTURE rather than to a table lookup, and
    exported because the site that consumes the capture is in another file.

    ⚠️ THE THIRD PLACE THE APOSTHROPE RULE LIVES, AND THE FIRST WHERE THE PRINTED
    TEXT IS THE VALUE RATHER THAN THE KEY. D136/D137 built two mechanisms: `['’]`
    inside every anchored pattern (the sentence's own punctuation) and
    `literalClauseRow` below (an exact lookup in a table). `preventAttackUse`
    (D154) captures an attack's NAME out of the sentence and carries it in the op —
    so the punctuation now travels INTO a derived value, and D137's contract ("the
    two spellings must produce the SAME value, never merely a non-null one") is
    only true if the capture is normalised. Greedent ex sv03-179's "Slip 'n' Roll"
    is the one printing in the pool that makes the difference visible: under a
    punctuation-normalising re-ingest the sentence and the attack's own `name`
    would BOTH curl, so the op must fold and so must the site that matches it
    against the card (interpreter.ts). Folding one and not the other is the
    half-fix D137 warned about, wearing a proper noun.

    The catalog prints ZERO curly apostrophes today (re-verified at D154 against
    the local D1: 0 of 978 rows across `effect`, `attacks_json` and
    `abilities_json`), so this is the same standing insurance the class is — and
    `clauseApostrophe.test.ts` drives it on the one sentence that can show it. */
export function foldApostrophes(text: string): string {
  return text.includes(CURLY_APOSTROPHE)
    ? text.replaceAll(CURLY_APOSTROPHE, STRAIGHT_APOSTROPHE)
    : text;
}
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
// does not supply — to buy a spelling nothing in 978 cards / 6 sets asks for. If a card
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
//   • "Flip a coin. If tails, this attack does nothing." (11 printings — this said
//     12 until D144 re-censused the tails face for its own question and counted
//     them: Tarountula sv01-018, Medicham sv01-111, Lechonk sv01-156, Alolan
//     Rattata swsh10.5-041, Nymble sv02-020, Shinx sv02-069, Surskit sv03-006,
//     Darumaka sv03-034, Froakie sv03-056, Houndour sv03-131/-204) — the coin-flip
//     mechanism, and the flip sentence in front already denies it `^If`;
//   • "If you can't, this attack does nothing." (3 printings) — ANAPHORIC, its
//     "can't" pointing back at a cost sentence this reader cannot see;
//   • Malamar sv06.5-034's "If you didn't play Xerosic's Machinations from your
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
// Census (2026-08-01, `attacks_json`, 978 cards / 6 sets): Torkoal sv01-035 "Concentrated
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

// ── D181: the TRAINER-PATH OPS, printed as ATTACK text. ─────────────────────
//
// Four families the engine has executed since M4 on the Trainer path and had no
// ATTACK reader for. Nothing new is built at all — every op, every park, every
// event and the gate itself already exist and are already tested; the deriver
// simply had no arm. D132's inventory rule for the fourth family running, and it
// is why these are anchors and `return`s rather than a slice.
//
// ⚠️ **THE CENSUS WAS RE-DERIVED AND EVERY BACKLOG FIGURE HELD EXACT** — over
// `json_each(attacks_json)`, scoped `set_id in ('sv01','sv02','sv03','sv06.5',
// 'sve')`, i.e. the **890 cards / 5 sets** the local D1's documented numbers are
// measured against. Draw **12 printings / 2 sentences**; draw-until **3 / 1**;
// self-switch **9 / 3**; gust **4 / 2**. The per-sentence counts are on the
// anchors below and pinned in `derivedDrawAndGust.test.ts`.
//
// ⚠️ **SCOPE, WHICH THIS BLOCK OWES (D154).** The queryable catalog this session
// reached is the REMOTE D1 — 19 sets / 3,698 rows — and it **does not hold
// `swsh10.5`**, the local D1's sixth set. So these counts are the FIVE-SET
// figures: exact against every documented census, and a FLOOR against the
// six-set local file. The local sqlite itself is `.wrangler` dev state and is
// absent from a fresh clone (see `docs/reference/coverage-backlog.md`).
//
// ⚠️ TWO REAL FINDINGS THE RE-DERIVATION PRODUCED, both of which move a number
// the backlog generalised rather than measured:
//   • **The draw family's two sentences are "Draw a card." (×7) and "Draw 2
//     cards." (×5)** — the backlog wrote them as "Draw a card." / "Draw N
//     cards.", and no printing in this pool draws any other count.
//   • **The draw-until family's N is ALWAYS 7** (×3). "Draw cards until you have
//     N cards in your hand." is a generalisation of one printed number. The arm
//     stays parameterised anyway — Grusha and Dendra already print 5 on the
//     TRAINER path, so the shape is real even where the attack pool is uniform.
//
// ⚠️ AND THE NEAR-MISSES ARE WHY EVERY ONE OF THESE IS WHOLE-STRING ANCHORED.
// The same sweep returned seven real sentences that CONTAIN one of these clauses
// and mean something else — five printings of "Switch this Pokémon with 1 of
// your Benched Pokémon. **If you do, switch out your opponent's Active Pokémon
// to the Bench.**", two of "Switch in 1 of your opponent's Benched Pokémon to the
// Active Spot. **This attack does 30 damage to the new Active Pokémon.**", and
// the variable-size "Draw cards until you have **the same number of cards in
// your hand as your opponent**." Every one is refused by the `^…$` anchoring
// alone, and every one is asserted in the suite: an unanchored build reads a
// compound attack as its first clause and drops the rest silently.
//
// SINGULAR AND PLURAL IN ONE ANCHOR, following `DECK_TOP_MILL`'s alternation
// rather than D136's one-regex-per-string rule: the two spellings differ only in
// whether the count is WRITTEN, and the singular branch invents its `1` at the
// site exactly as the mill's does. A printed "Draw 0 cards." is refused by the
// site's `>= 1` guard, like every arm in this reader.
const ATTACK_DRAW = /^Draw (?:(\d+) cards|a card)\.$/;
const ATTACK_DRAW_UNTIL = /^Draw cards until you have (\d+) cards in your hand\.$/;
// ⚠️⚠️ THE SELF-SWITCH FAMILY WAS NOT HERE AT D181, AND ITS ABSENCE WAS THAT
// SLICE'S REAL FINDING — D189 PAID THE PRICE AND BUILT TWO OF ITS THREE
// SENTENCES. The backlog priced "Switch this Pokémon with 1 of your Benched
// Pokémon." (9 six-set printings / 3 sentences) at ONE REGEX AND ONE `return`, on
// the ground that `switchActive` already exists. It does. **The op was not the
// price**, and the record of what the price actually was is kept here rather than
// deleted now that it is paid:
//
//   • **THE BARE + FLIP-GATED PRINTINGS BROKE AN INVARIANT `finishAttack` RELIED
//     ON.** That function addressed the Attacking Pokémon as
//     `players[attackerSeat].active` — sound only because NOTHING between the
//     §8.5 hit and the epilogue could swap the attacker's Active. `switchActive`
//     is the one op that can, and it had lived in exactly one `trainer:` program
//     (Switch `sv01-194`) which no attack could invoke. Deriving it from ATTACK
//     text makes the attacker leave the spot mid-attack, and the §8.1
//     KO-conditioned recoil (Vengeful Punch `sv03-197`) would then land its
//     counters on the body that was just PROMOTED rather than on the one that
//     attacked. ⚠️ THIS WAS NOT A DEDUCTION: `vengefulPunch.test.ts` SWEEPS it
//     ("no attack program — derived OR authored — can move its own actor off the
//     spot"), predicted in writing which line would have to change, and D189
//     turned it red on purpose before touching it. **D189 made the change the
//     sweep named**: `finishAttack` takes the attacker's UID, carried on a
//     REQUIRED field of the `attackEpilogue` `PendingStage` — a shape that rides
//     `GameState.pending` and is therefore PERSISTED, at a cost of
//     `MATCH_RECORD_VERSION` **11 → 12**. `preventBlock.test.ts`'s total op
//     classification is the second, independent enforcement of the same claim and
//     now carries a `switchActive` verdict + probe.
//   • **AND THE THIRD PRINTING STILL NEEDS A MECHANISM THAT DOES NOT EXIST** —
//     "**You may** switch this Pokémon with 1 of your Benched Pokémon." (2 six-set
//     printings, **3 Standard-legal**). `switchActive` parks a `choosePokemon`, a
//     prompt shape with no `declinable` field, and `parkOrForce` auto-applies at
//     one candidate, so there is nowhere for a decline to live. The only optional
//     pick that exists (`damageChosen.optional`) rides `choosePokemonMulti` — a
//     different prompt kind with a different answer shape — and
//     `TriggeredAbility.optional` governs whether a TRIGGER fires, not whether a
//     pick may be declined. Still queued as its own slice (**D186**), still
//     PINNED loud in `derivedDrawAndGust.test.ts` against a fixture that fields
//     it. D189 deliberately left it unbuilt: it is a vocabulary slice, not this
//     one's persistence slice.
//
// The GUST is the mirror sentence and has NO such problem: it moves the
// OPPONENT's Active, which `finishAttack` does not address by spot (the defender
// is captured by uid before the program runs — attack.ts). Both apostrophes
// accepted, deliberately: the catalog is all-straight today
// (`curlyApostropheAnywhere === 0`), so the curly arm exists against a future
// re-ingest rather than against today's bytes — the arrangement `DECK_TOP_MILL`
// and the discard family already carry.
const ATTACK_GUST = /^Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\.$/;
const ATTACK_FLIP_GUST =
  /^Flip a coin\. If heads, switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\.$/;
// ⚠️ D189 — THE SELF-SWITCH, WHOSE PRICE WAS PAID BEFORE THESE TWO LINES WERE
// WRITTEN. D181 refused to add them precisely because the op is not the price:
// `finishAttack` addressed the Attacking Pokémon as `players[attackerSeat].active`
// and an attack-derived `switchActive` is the one thing that can make that
// address wrong. That is fixed FIRST (a required `uid` on the `attackEpilogue`
// `PendingStage`, `MATCH_RECORD_VERSION` 11 → 12), and only then do these two
// anchors land. Read D181's block above for the analysis; this is its repair.
//
// NO APOSTROPHE CLASS, unlike the two gust anchors directly above — and that is a
// measured difference rather than an oversight. The gust sentence contains
// "opponent's"; neither self-switch sentence contains an apostrophe at all
// (asserted in `derivedDrawAndGust.test.ts`), so there is no character for a
// re-ingest to curl.
//
// THE COUNT IS LITERAL (`1 of`) in both, exactly as the gust anchors' is: every
// printing prints 1, and `switchActive` parks a single-pick `choosePokemon`, so a
// printed 2 would be a different op rather than a different number.
/** ⚠️⚠️ D246 — THE SELF-SWITCH SENTENCE, EXTRACTED, BECAUSE FOUR ANCHORS NOW
    SPELL IT AND THREE OF THEM WERE SPELLING IT SEPARATELY. D189 wrote it twice,
    D227 a third time as the antecedent of Iron Bundle's compound, and D246 needs
    it a fourth as the antecedent of Kilowattrel ex's. Four hand-maintained copies
    of one printed sentence is four places for a re-ingest — or a typo — to make
    two anchors disagree about what the catalog says, with nothing red.

    ⚠️ NO APOSTROPHE CLASS, and that is measured rather than inherited: this
    sentence contains no apostrophe at all (asserted in
    `derivedDrawAndGust.test.ts`), so there is no character for a re-ingest to
    curl — unlike the gust and switch-out sentences 60 lines up, which contain
    "opponent's" and therefore carry `['’]`.

    ⚠️ THE COUNT IS LITERAL (`1 of`): every printing prints 1, and `switchActive`
    parks a single-pick `choosePokemon`, so a printed 2 would be a different op
    rather than a different number.

    ⚠️ THE VERB IS SPELLED AT EACH CALL SITE and is NOT part of this constant —
    the same rule `attachFromZoneClause` follows one family over, and for the same
    reason. Two of the four anchors print a capital "Switch" and two a lowercase
    "switch" (after "If heads," and after "If you do,"); folding that into a
    `[Ss]` class would let a sentence that merely BEGINS mid-clause derive as a
    whole-string match, and this reader commits to case (`clauseApostrophe.test.ts`
    pins that). */
const SELF_SWITCH_CLAUSE = "this Pokémon with 1 of your Benched Pokémon\\.";
const ATTACK_SELF_SWITCH = new RegExp(`^Switch ${SELF_SWITCH_CLAUSE}$`);
const ATTACK_FLIP_SELF_SWITCH = new RegExp(
  `^Flip a coin\\. If heads, switch ${SELF_SWITCH_CLAUSE}$`,
);
// ⚠️⚠️ D227 — THE OPPONENT-CHOSEN SWITCH-OUT, AND ITS PARENTHETICAL IS PART OF THE
// ANCHOR RATHER THAN NOISE TRIMMED OFF THE END. "(Your opponent chooses the new
// Active Pokémon.)" is printed reminder text, but it is the ONLY thing that tells
// this sentence apart from a gust in the catalog's own bytes — the move is
// identical and the chooser is the whole difference — so it is matched, not
// skipped. A build that anchored on the first sentence alone would still be
// correct today (no printing drops the parenthetical: measured, 0 rows of 33) and
// would be reading the wrong thing for the right answer.
//
// THE CENSUS, over the remote D1 `luminous` (3,786 rows / 20 sets, 2,021
// `legal_standard = 1`) on 2026-08-05, `json_each(attacks_json)` +
// `json_extract(value,'$.effect')`, GLOB (case-SENSITIVE — SQLite's LIKE is not),
// and swept over ALL THREE text columns because a two-column sweep has cost this
// repo a census twice:
//   • BARE — 19 printings, **10 legal** (`sv05-106` Mightyena "Kick Away",
//     `sv07-121` Fletchling "Send Back", `sv09-009` Karrablast "Push Down",
//     `sv10-002`/`-183` Yanma "Whirlwind", `sv10-105` Hippopotas "Push Down",
//     `sv10.5w-007`/`-092` Sawsbuck "Push Down", `sv10.5w-075`/`-155` Herdier
//     "Roar").
//   • "You may …" — 3 printings, **2 legal** (`sv10-160` Squawkabilly "Push Down",
//     `svp-178` Kyogre ex "Winding Waves").
//   • THE COMPOUND — 8 printings, **1 legal** (`sv06-062` Iron Bundle "Interjet").
//   • The DAMAGE RIDER — 1 printing, **1 legal** (`sv07-096` Grimmsnarl
//     "Goad 'n' Grab") — **NOT BUILT; see the block below the arms.**
// 14 legal attack printings, of which these three anchors read **13**.
//
// ⚠️ AND THE SWEEP FOUND TWO LEGAL PRINTINGS THE BACKLOG ROW DID NOT COUNT,
// BECAUSE THE ROW CENSUSED ATTACK TEXT ONLY: `sv10.5w-023`/`-107` print the
// ABILITY twin of Iron Bundle's compound — "Once during your turn, you may switch
// your Active Pokémon with 1 of your Benched Pokémon. If you do, switch out your
// opponent's Active Pokémon to the Bench. (…)". They are REGISTRY rows, not arms,
// and are deliberately left for their own slice: an activated Ability is a card
// PLAY, so it goes through `programPlayable` — which has no arm for this op and
// must not get a speculative one (a gate no printing reaches is the vacuous guard
// conventions.md forbids). Recorded in `coverage-backlog-legal.md`.
//
// ⚠️⚠️ BOTH APOSTROPHES ON ALL THREE, LIKE THE TWO GUST ANCHORS 40 LINES UP AND
// UNLIKE THE TWO SELF-SWITCH ANCHORS DIRECTLY ABOVE — AND THE FIRST DRAFT GOT
// THIS WRONG IN WRITING BEFORE `clauseApostrophe.test.ts` TURNED RED ON IT.
// The draft reasoned from D189's call ("no apostrophe class") and from a measured
// zero (`*witch out your opponent’s*` returns 0 catalog rows), and BOTH facts are
// true and NEITHER is the rule. D189 could drop the class because its sentences
// **contain no apostrophe at all**; these contain "opponent's", and this repo's
// standing invariant is that every apostrophe-bearing sentence a fixture prints
// derives IDENTICALLY under a U+2019 re-ingest. The curly arm therefore exists
// against a future re-ingest rather than against today's bytes — the arrangement
// `DECK_TOP_MILL`, the discard family and the gust anchors all carry.
// **A measured zero in the catalog is not a reason to narrow a PARSER.**
const ATTACK_OPPONENT_SWITCH_OUT =
  /^Switch out your opponent['’]s Active Pokémon to the Bench\. \(Your opponent chooses the new Active Pokémon\.\)$/;
// The "You may" sibling — a SEPARATE whole-string anchor rather than an optional
// `(?:You may )?` group, following the four draw anchors' rule exactly: the bare
// sentence starts "Switch" and this one "switch", so the shared body is not
// shared BYTES and folding them would need an `/i` these readers deliberately do
// not have (`clauseApostrophe.test.ts` pins that they commit to case).
const ATTACK_MAY_OPPONENT_SWITCH_OUT =
  /^You may switch out your opponent['’]s Active Pokémon to the Bench\. \(Your opponent chooses the new Active Pokémon\.\)$/;
// Iron Bundle `sv06-062` "Interjet" — the COMPOUND, and the first attack sentence
// whose two clauses are two PARKS on two different seats joined by a printed
// "If you do". It is `switchActive { recordAs: "moved" }` + `recordGate` —
// Prime Catcher's registry program with this op in place of the gust — so the
// whole arm is a composition of three pieces that already exist.
//
// ⚠️ THE ANTECEDENT IS THE SELF-SWITCH, WHOSE PRICE D189 PAID: an attack that
// moves its own actor off the Active Spot needs `finishAttack`'s uid addressing,
// which is why this sentence could not have been built before 0.123.0 whatever
// the op situation was.
// ⚠️ D246 — THE ANTECEDENT IS `SELF_SWITCH_CLAUSE` NOW, shared with D189's two
// anchors and with this slice's gated attach, so no two of the four can drift
// into disagreeing about what the printed self-switch says.
const ATTACK_SELF_SWITCH_THEN_OPPONENT_SWITCH_OUT = new RegExp(
  `^Switch ${SELF_SWITCH_CLAUSE} If you do, switch out your opponent['’]s Active Pokémon to the Bench\\. \\(Your opponent chooses the new Active Pokémon\\.\\)$`,
);
// ⚠️⚠️ D228 — THE DAMAGE RIDER ON A PROMOTED BODY, IN ITS **TWO** PRINTED SHAPES,
// AND THE WHOLE REASON THEY ARE TWO ANCHORS IS THAT THEY ARE TWO PROGRAMS.
//
// The clause is the same in both — "This attack does {N} damage to the new Active
// Pokémon." — but the FIRST half differs in the op it promotes with AND in whether
// the damage is CONDITIONAL on the promotion:
//   • THE GUST FORM has no conditional at all, so the damage lands on whoever
//     holds the Active Spot when the op runs — including an unchanged Active when
//     an empty opponent Bench made the gust a no-op.
//   • GRIMMSNARL's prints "If you do,", which is a §9.2 `recordGate` over the
//     switch-out's own slot, and on that same empty Bench it deals NOTHING.
// Folding them into one anchor with an optional "(?:If you do, )?" would compile,
// pass a test written against either sentence, and be wrong about one of the two
// on every board where the promotion whiffs.
//
// THE COUNT IS CAPTURED (`\d+`) rather than alternated over the four printed
// numbers, exactly as D147's reduction family is: the amount is the only thing
// that varies across 30/20/40/70, `damageNewActive` takes it as a number, and an
// alternation would have to be edited by the next reprint that prints 50.
//
// THE CENSUS, re-derived (not inherited from D227, per conventions.md) against the
// remote D1 `luminous` — 3,786 rows / 20 sets, 2,021 `legal_standard = 1` — on
// 2026-08-05, over `json_each(attacks_json)` + `json_extract(value,'$.effect')`
// with GLOB (SQLite's LIKE is ASCII case-INSENSITIVE and has cost this repo a
// census), swept over all three text columns:
//   • GUST + 30 — 4 printings, **2 legal** (`sv05-112` Mawile "Invite and Strike",
//     `sv10-091` Primeape "Drag Off"; `sv01-147`/`sv03-037` rotated).
//   • GUST + 20 — 2 printings, **2 legal** (`sv10.5b-027`/`-111` Cryogonal).
//   • GUST + 40 — 2 printings, **2 legal** (`sv08-153`/`-214` Braviary).
//   • GUST + 70 — 1 printing,  **1 legal** (`sv06-127` Dipplin "Syrup Catcher").
//   • THE GATED FORM — 1 printing, **1 legal** (`sv07-096` Grimmsnarl).
// **8 legal printings**, which is D227's split-out row EXACTLY and its only
// figure this slice did not have to correct.
//
// ⚠️ AND ALL EIGHT PRINT **NO BASE DAMAGE** — every `damage` field is absent, so
// the rider IS the attack's whole number. That is measured rather than assumed,
// and it is load-bearing twice: it is why this op does not join `programDamage`'s
// base-suppression list in `attack.ts` (see the op's doc), and it is why D227's
// `Goad 'n' Grab` fixture had to be CORRECTED by this slice — it carried an
// invented `damage: 130` under a comment claiming the number was the card's own.
//
// ⚠️ THE RESIDUAL IS 1 LEGAL PRINTING AND IT IS NAMED: Malamar `sv06.5-034`
// "Colluding Tentacles" prints the gated form followed by a SECOND sentence
// ("If you didn't play Xerosic's Machinations from your hand during this turn,
// this attack does nothing."), which wants the trailing-requirement COMPOSITION
// seam D192's block already defers and a "played this card this turn" fact the
// engine does not keep. Two more sentences in the family are rotated and unread
// (`sv03-069` Eelektross' flip-and-Paralyze compound, and the two "is now Asleep"
// riders, 0 legal between them). Pinned in `derivedNewActiveDamage.test.ts`.
//
// BOTH APOSTROPHES ON BOTH, for the gust anchors' reason 60 lines up and D227's
// rule verbatim: these sentences CONTAIN "opponent's", so a re-ingest that curls
// it must derive the same program. `clauseApostrophe.test.ts` sweeps both the day
// their fixtures land.
const ATTACK_GUST_THEN_DAMAGE_NEW_ACTIVE =
  /^Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\. This attack does (\d+) damage to the new Active Pokémon\.$/;
const ATTACK_OPPONENT_SWITCH_OUT_THEN_DAMAGE_NEW_ACTIVE =
  /^Switch out your opponent['’]s Active Pokémon to the Bench\. \(Your opponent chooses the new Active Pokémon\.\) If you do, this attack does (\d+) damage to the new Active Pokémon\.$/;
// ⚠️⚠️ D229 — THE ATTACKER'S OWN ENERGY, ONTO ITS OWN BENCH: row 5 of
// `coverage-backlog-legal.md`, and the FIRST derived arms the `moveEnergy` family
// has ever had. Every printing before this one is a REGISTRY row (Energy Switch,
// Poppy, Armarouge, Exp. Share, N's Plan), so the op has never had to survive a
// text parser — which is why the near-miss block below is longer than the anchors.
//
// THE CENSUS, re-derived (never inherited — the backlog row's own figure is
// corrected below) against the remote D1 `luminous` — 3,786 rows / 20 sets, 2,021
// `legal_standard = 1` — on 2026-08-05, over `json_each(attacks_json)` +
// `json_extract(value,'$.effect')` with GLOB (SQLite's LIKE is ASCII
// case-INSENSITIVE and has cost this repo a census), swept over ALL THREE text
// columns. `abilities_json` and `effect` return **ZERO** rows for this shape, so
// the whole family is attack text and the two anchors below are the whole family:
//   • "Move an Energy …"       — 13 printings, **8 legal** (`sv05-118` Iron Treads
//     "Wheel Pass", `sv06-077`/`-196` + `sv08.5-032` Iron Thorns ex "Volt Cyclone",
//     `sv08.5-087` Shaymin "Reflect Energy", `sv09-031`/`-171`/`-182` Volcanion ex
//     "Scorching Cyclone").
//   • "Move 3 Energy …"        — 3 printings, **3 legal** (`sv10-003`/`-206`/`-228`
//     Yanmega ex "Jet Cyclone").
//   • "Move a Basic Energy …"  — 2 printings, **2 legal** (`svp-210` +
//     `sv10.5w-078` Tornadus "Hurricane").
//   • "Move **all** Energy … to 1 of your Benched Pokémon."  — 5 printings,
//     **2 legal** (`sv08-020`/`-195` Castform) — **NOT BUILT**, see the op's doc.
//   • "Move all Energy … to your Benched Pokémon **in any way you like**." —
//     3 printings, **1 legal** (`sv08-067` Kilowattrel) — **NOT BUILT**, ditto.
// **16 legal printings, of which these two anchors read 13.**
//
// 🛑 AND THE BACKLOG ROW SAID **19 PRINTINGS FOR ~7 ARMS**. Both halves are wrong
// and in OPPOSITE directions, which is the fourth `needs` cell on this branch to
// misprice and the first to over-count: the family is **16** legal (the row never
// says which population its 19 came from), and it is **2 anchors**, not 7 — the
// numeric and article forms are one alternation (`ATTACK_DRAW`'s precedent, 60
// lines up), and the `all` sentences are not arms at all. ⚠️ A count without a
// population and a legality is not a fact, and neither is an edit estimate
// without the anchors written out.
//
// ⚠️ THE NUMERIC ALTERNATION IS `(?:(\d+)|an)` AND THE NOUN IS **BARE**, WHICH IS
// THE WHOLE GUARD AGAINST THE FAMILY'S REAL NEAR MISS. "Move 2 {D} Energy from
// this Pokémon to 1 of your Benched Pokémon." (2 printings, **0 legal**) is the
// same sentence with a TYPED noun, and it wants a filter these arms do not build
// (`basicEnergy` narrows the CATEGORY, not the type). A `(\d+)[^.]*Energy` shape
// would swallow it and quietly move any Energy at all; the bare noun refuses it on
// its own bytes. It is a REAL catalog row rather than a constructed tail, so the
// `$`-witness problem D228 hit does not arise here — but the trailing-clause case
// is still constructed and says so in the suite.
//
// NO APOSTROPHE ON EITHER ANCHOR, and that is the printed bytes rather than D189's
// call: these three sentences contain no apostrophe at all, so there is nothing for
// a U+2019 re-ingest to curl. `clauseApostrophe.test.ts`'s census is unmoved by
// this slice (88 before, 88 after) — which is a prediction, and it is asserted.
const ATTACK_MOVE_ENERGY_SELF_TO_BENCH =
  /^Move (?:(\d+)|an) Energy from this Pokémon to 1 of your Benched Pokémon\.$/;
// The BASIC-filtered sibling — a separate anchor rather than an optional
// `(?:Basic )?` group, because the article moves with the noun ("an Energy" vs
// "a Basic Energy") and folding them would need the two to share bytes they do
// not. Same rule the two draw anchors and D227's three follow.
const ATTACK_MOVE_BASIC_ENERGY_SELF_TO_BENCH =
  /^Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon\.$/;
// ⚠️⚠️ D202 — THE FIRST TWO PRODUCERS OF `optional`, AND THE `You may` PREFIX IS
// THE WHOLE DIFFERENCE FROM THE TWO BARE DRAW ANCHORS 70 LINES ABOVE. D186 landed
// the op, the `confirm` prompt, the wire arm, the redact arm, the projection arm
// and BOTH dialogs with deliberately NOTHING that constructs one — a park of a
// prompt kind a surface cannot render is a soft-lock, so the surfaces answered the
// question before anything could ask it. These two lines are the asking.
//
// THE CENSUS, RE-DERIVED against the remote D1 (3,786 rows / 20 sets, 2,021
// `legal_standard = 1`) on 2026-08-04, over `json_each(attacks_json)` +
// `json_extract(value,'$.effect')`, and BOTH figures held EXACT:
//   • "You may draw cards until you have 6 cards in your hand." — 10 printings,
//     10 legal (Blissey ex sv06-134/-201, Lumineon sv07-036, Cynthia's Garchomp ex
//     sv10-104/-215/-232/-241 + svp-204, Audino sv10.5b-074/-151).
//   • "You may draw 5 cards." — 2 printings, 2 legal (Cyclizar ex sv08-159/-228).
// Twelve legal printings, and the sweep's own NEGATIVE result: those are the ONLY
// two "you may draw" sentences in the catalog's whole attack column. ⚠️ The sweep
// was run with `GLOB '*[Yy]ou may draw*'` (CASE-SENSITIVE — SQLite's `LIKE` is
// ASCII case-insensitive and cost D200 a census) and re-run with the
// case-insensitive `LIKE '%you may draw%'`: SAME TWO ROWS, so no case variant
// exists and the anchors need no `/i` they could not afford anyway.
//
// ⚠️ THE NUMBER IS CAPTURED, NOT LITERAL, ON BOTH — the opposite call from the two
// self-switch anchors directly above, and for the reason those state in reverse.
// There, `1 of` is literal because a printed 2 would be a DIFFERENT OP (a
// single-pick park cannot take two). Here the number is the inner op's own
// parameter: `drawUntilHandSize 6` and `drawCards 5` differ from their built
// siblings (`7`, `1`, `2`, `3`) by nothing but that integer, and the TRAINER path
// already prints others through the same ops. An anchor keyed to today's constant
// is an anchor that breaks on the next print.
//
// ⚠️ AND THE `You may` PREFIX IS THE ONLY DIFFERENCE FROM THE BARE ANCHORS, WHICH
// IS WHY THESE ARE FOUR SEPARATE WHOLE-STRING REGEXES RATHER THAN ONE OPTIONAL
// GROUP. A `/^(?:You may )?Draw …/` would be shorter and WRONG in the way this
// repo cares about: the printed sentences are "You may draw" (lowercase d) and
// "Draw" (capital), so the shared body is not shared bytes, and folding them would
// need an /i the anchors deliberately do not have (`clauseApostrophe.test.ts` pins
// that the readers commit to case). Four anchors, four arms, and the `then` each
// produces is asserted BYTE-IDENTICAL to its bare sibling's whole program —
// D134/D181's inventory equality, which is what a shared group would have bought
// by construction and this buys by test instead.
const ATTACK_MAY_DRAW = /^You may draw (\d+) cards\.$/;
const ATTACK_MAY_DRAW_UNTIL = /^You may draw cards until you have (\d+) cards in your hand\.$/;

// ⚠️⚠️ D230 — THE DECK SEARCH ONTO YOUR OWN BENCH: row 6 of
// `coverage-backlog-legal.md`, the biggest single count this reader has taken since
// D131's mill, and the FIRST derived arm whose program is TWO OPS (`searchDeck`
// then `shuffleDeck` — the Nest Ball authoring pattern, read off text instead of
// authored per card).
//
// THE CENSUS, re-derived (never inherited — the backlog row's own figures are
// corrected below) against the remote D1 `luminous` — 3,786 rows / 20 sets, 2,021
// `legal_standard = 1` — on 2026-08-05, over `json_each` + `GLOB` (SQLite's LIKE is
// ASCII case-INSENSITIVE and has cost this repo a census), swept over ALL THREE
// text columns and GROUPED BY SENTENCE before anything was priced:
//   • "…a Basic Pokémon and put it…"            **7 legal** (`svp-200`/`-202` Eevee,
//     `sv05-130` Skitty, `sv06-036`, `sv07-066`, `sv07-113`, `sv08-005` Scatterbug)
//   • "…up to 2 Basic Pokémon and put them…"    **7 legal** (`sv07-088` Falinks,
//     `sv08-104`, `sv09-065`, `sv09-077`, `sv09-165`, `sv10.5b-029`, `sv10.5b-112`)
//   • "…up to 3 Basic Pokémon and put them…"    **2 legal** (`sv05-132` Chatot,
//     `sv05-181`)
//   • "…up to 3 Charjabug…" / "…up to 2 Grubbin…" / "…up to 2 Froakie…" /
//     "…a Pikachu…"                             **4 legal** (`sv07-052`, `sv05-018`,
//     `sv06-056`, `svp-085`) — the NAMED noun, the same anchor's second capture
// **20 legal printings on ONE anchor.** Four more legal printings of the same
// family are NOT read and each is named below.
//
// 🛑 AND THE BACKLOG ROW SAID **22 PRINTINGS FOR ~9 ARMS**. Both halves are wrong,
// which is the FIFTH `needs` cell on this branch to misprice and the second to miss
// in both directions at once: the family is **25 legal printings over 12 distinct
// sentences** in the attack column (the row never says which population its 22 came
// from), and it is **ONE** anchor, not nine — every sentence above is the same
// sentence with a different noun phrase and a different number, so grouping the
// census BY SENTENCE before counting arms (D229's lesson, applied as instructed)
// collapses nine into one.
//
// ⚠️ AND THE 25 IS THE SECOND NUMBER THIS SLICE MEASURED, not the first: the sweep
// that produced 24 used `GLOB '*Search your deck*'` and structurally could not see
// Lillie's Comfey `sv09-068`, whose sentence begins *"**You may** search…"*. The
// suite's own arithmetic row went red on the difference before a line shipped. **A
// case-sensitive census is a floor exactly as a single-column one is** — the D200
// lesson from the other direction, where `LIKE` was too WIDE.
//
// ⚠️ THE ABILITY COLUMN IS **ONE ROW** AND THE ANSWER TO "does this go through
// `programPlayable`" IS **NO**. `abilities_json` returns exactly one legal row —
// Koffing `sv10-125`, whose sentence is a §9 TRIGGER ("If this Pokémon is in the
// Active Spot and is damaged by an attack…") over a noun no `CardFilter` spells
// (*Pokémon that have "Koffing" in their name*). A triggered program is not played,
// so it never reaches that gate; and `searchDeck` carries NO `programPlayable` arm
// at all today, deliberately — a deck search is "playable enough" because the deck
// is not public knowledge (ruling/284), and the BENCH-SPACE question the backlog
// row wanted priced is already answered ONE LEVEL DOWN, in the interpreter, where
// `Math.min(op.max, benchSpace(...))` clamps before anything leaves the deck. So
// the read site is **zero code**, and that is measured rather than assumed.
//
// ⚠️ THE NOUN IS TWO CAPTURES AND NEITHER IS A WILDCARD, WHICH IS THE WHOLE GUARD
// AGAINST THIS FAMILY'S NEAR MISSES — and unlike D229's, three of them are LEGAL
// and one of them is BUILT:
//   • "…up to 2 Basic **Steven's** Pokémon…" (`sv10-083`, 1 legal) — an
//     owner-narrowed noun, ALREADY BUILT as a registry row (`SUMMONING_SIGN`). A
//     `(.+)` noun would swallow it, and because the registry wins on that one card
//     the damage would be invisible until the next owner-prefixed printing arrives
//     with no row — a search for "any Basic Pokémon" where the card names a family.
//   • "…up to 2 **in any combination of** Maushold and Maushold ex…" (`sv08-158`,
//     1 legal) — a DISJUNCTION of two names, ALREADY BUILT at D339 as a registry
//     row (`FAMILIAL_MARCH`), exactly as the two owner-narrowed nouns above are.
//     A `(.+)` noun would swallow it, and because the registry wins on this card
//     the damage would be invisible here too.
//     ⚠️ **THE REASON THIS LINE USED TO GIVE WAS STALE AND IS REPAIRED HERE.** It
//     said the disjunction was one "which `CardFilter` has no member for" — but
//     `anyOf` IS that member: it shipped at D337 on the Trainer surface, ran on the
//     ATTACK surface at D338, and takes this sentence at D339. An out-of-date
//     REASON in this file is how a successor re-derives a piece that already exists
//     (D330's mispricing, exactly), which is why it was fixed in the building
//     commit rather than left for a tidying pass.
//     It is printed as a disjunction at all because `byName` is exact: "Maushold ex"
//     is a different card name from "Maushold", and the card says so in so many
//     words — the half of this note that was always true and still is.
//   • "…a Basic **{G}** Pokémon…" (1 printing, 0 legal) — a TYPE-narrowed noun,
//     D229's `{D}` near miss one op over.
//   • "…up to 2 Basic Pokémon **with 70 HP or less**…" (3 legal, all TRAINERS) —
//     an HP predicate no filter spells. Out of this reader's reach anyway, and
//     named because a `[^.]*` noun would have reached it.
// The literal alternative is matched as its own group so the dispatch never has to
// look at the matched TEXT (`DAMAGE_SUPPRESSION`'s rule), and the NAME group is a
// SINGLE capitalised word: every named printing in the family prints one, and a
// hyphenated / spaced / apostrophised name falls through to the loud
// ATTACK_EFFECT_SKIPPED path rather than being approximated.
//
// ⚠️ FIVE LEGAL PRINTINGS ARE LEFT ACROSS THREE BULLETS (`3 + 1 + 1 = 5`), AND EACH
// IS DEFERRED ON SOMETHING THAT IS NOT THIS SENTENCE (all five pinned
// derived-to-null in `derivedBenchSearch.test.ts`):
//   • `sv10-083`, `sv09-068` and 🆕 `sv08-158` are ALREADY BUILT as registry rows —
//     **3 legal** that this arm must refuse rather than re-read, which is why they
//     are in the near miss list above and not in the count. ⚠️ **`sv08-158` JOINED
//     THIS BULLET AT D339 AND WAS NOT DELETED FROM THE BLOCK**, because "built" and
//     "refused by this deriver" are different claims (D314) and the refusal is
//     exactly what keeps the registry summand disjoint from the raw one.
//   • `sv06-009` Volbeat "Quick Sign" — 1 legal — prints the §4 licence *"If you go
//     first, you can use this attack during your first turn."* in front of the
//     sentence. That is `trainerFirstTurnExempt`'s ATTACK twin: attack.ts refuses
//     every attack on turn 1 (`state.turn === 1`), so the clause needs a field AND
//     that gate to read it, which is a slice rather than a rider.
//   • `sv06-046` Jynx "Inviting Kiss" — 1 legal — prints a §9.2 tail (*"If you put
//     any Pokémon onto your Bench in this way, move an Energy from this Pokémon to
//     the new Benched Pokémon."*) whose destination is *the body this program just
//     benched*. `searchDeck` files no record and `moveEnergy` carries no
//     "whatever the last op put there" destination; both are real additions.
//
// NO APOSTROPHE ON THE ANCHOR, and that is the printed bytes rather than D189's
// call: the sentence contains none, so a U+2019 re-ingest has nothing to curl.
// `clauseApostrophe.test.ts`'s census is unmoved by this slice (88 before, 88
// after) — a prediction, and it is asserted.
// ⚠️⚠️ D238 — THE PRINTED BRACE CODE, AND IT IS **ONE MECHANISM SERVING THREE
// ANCHORS**: the deck search onto the Bench (D230), the deck search into the hand
// (D231) and the discard-pile retrieval (D237) each print a type-narrowed noun
// and each pinned it derived-to-null. This block is the whole fix.
//
// ✅ THE COUNT, RE-DERIVED (never inherited) against the remote D1 `luminous` —
// 3,786 rows / 20 sets, 2,021 `legal_standard = 1` — on 2026-08-06, `json_each` +
// `json_extract(value,'$.effect')`, GROUPED BY SENTENCE, over ALL THREE text
// columns:
//
//   WHERE t GLOB '*{[GRWLPFDMYNC]} Pok*'
//   -- attack 32 / 16 · ability 28 / 12 · effect 25 / 15
//
// 🛑 **AND THE CEILING IS NOT THE YIELD — 6 OF THOSE 32 ARE THIS.** The other 26
// are BOARD targets ("1 of your Benched {L} Pokémon"), damage scalers ("30 damage
// for each of your {G} Pokémon in play") and conditional-damage clauses, which
// `targetType` and three other readers already own and which `matchesFilter`
// cannot reach by construction. The resume point that priced this row said so and
// it is confirmed rather than assumed: **separate the CARD predicate from the
// BOARD rider before pricing either**, or the row repeats D232's mistake with a
// bigger number.
//
// THE READABLE SET IS **8 LEGAL / 12 CATALOG PRINTINGS ON 8 SENTENCES**, and the
// legal figure is the fifth row running to re-derive to the digit that the
// backlog page named:
//   · "Put up to 3 {W} Pokémon from your discard pile onto your Bench."      3 / 3
//   · "Put a Basic {G} Energy card from your discard pile into your hand."   1 / 1
//   · "…for up to 3 {D} Pokémon, reveal them, and put them into your hand…"  2 / 2
//   · "…for up to 2 {L} Pokémon, reveal them, and put them into your hand…"  1 / 1
//   · "…for up to 3 Basic {G} Energy cards, reveal them, …into your hand…"   1 / 1
//   · "Put up to 3 Basic {W} Energy cards from your discard pile into your hand." 0 / 2
//   · "Put up to 2 Basic {M} Energy cards from your discard pile into your hand." 0 / 1
//   · "Search your deck for a Basic {G} Pokémon and put it onto your Bench…"  0 / 1
// ⚠️ **THE LAST THREE ARE ROTATED-ONLY AND TWO OF THEM WERE NAMED BY NO PAGE IN
// THIS REPO.** Three suites' residue tables between them listed ONE rotated
// printing; the catalog-wide sweep on the same anchors returns FOUR. A residue
// table is a census of what its own slice measured, not of what an arm will
// serve — *an arm transfers across sets and a registry row does not* (D180/D187).
//
// 🛑 THE DECISION THE RESUME POINT OWED, AND IT IS **NEITHER** OF THE TWO IT
// NAMED. It asked whether `HAND_SEARCH_NOUNS` gains a THIRD COLUMN (printed
// phrase ≠ caption phrase) or the anchors grow a brace-code CAPTURE GROUP. The
// answer is a SECOND, DISJOINT RESOLUTION PATH — this pattern plus its resolver —
// and the two rejected options fail for two different reasons:
//   · **A third column breaks the table's contract by weakening it.** Its two
//     strings ARE `retrieveNoun`'s output, which is a ROUND TRIP asserted from
//     both sides; a third column that no round trip checks would be an unpinned
//     string sitting in a table whose whole point is that its strings are pinned.
//   · **A capture group cannot be the answer either, because the phrases are not
//     an ENUMERATION.** Eleven types × three noun shapes × two grammatical
//     numbers is 66 rows of a table (or 66 alternatives) where one pattern and
//     two closed CODE maps say the same thing and cannot drift from §6.1.
//   · ⚠️ **And a brace phrase could not go in that table anyway**: the table's
//     phrases are asserted to be letters, spaces and "é" precisely because a
//     regex metacharacter in a row would silently change what
//     `ATTACK_DISCARD_RETRIEVAL` reads, and `{` `}` are metacharacters.
//
// THE CODE MAPS ARE D234's, RE-USED WHOLE AND NOT RE-LISTED. `POKEMON_TYPE_BY_CODE`
// (all eleven printed types, `{N}` → Dragon and `{C}` → Colorless included) and
// `ENERGY_TYPE_BY_CODE` (the NINE that have a Basic Energy) already exist, and the
// difference between them is exactly the difference between the two nouns here: a
// Pokémon may BE a Dragon, and there is no Basic Dragon Energy to search for. So
// "Basic {N} Energy cards" resolves to `undefined` and stays on the loud
// ATTACK_EFFECT_SKIPPED path — a refusal by CONSTRUCTION rather than by a
// hand-kept exclusion list.
//
// ⚠️ THE ENERGY HALF NEEDS **NO** NEW FILTER: `basicEnergy.energyType` has carried
// a type since Chien-Pao. Only the Pokémon half is a new `CardFilter` member. The
// resume point priced "a type-narrowed Pokémon `CardFilter`" and was right about
// that; what it did not name is that HALF THE PRINTINGS were already spellable and
// blocked on the anchor alone.
/** A printed noun phrase carrying a brace TYPE CODE, resolved to its filter.
    `undefined` for anything else — including a code neither map spells, which is
    the refusal that keeps "{N} Energy" from becoming a filter for a card that
    does not exist.

    `plural` welds the grammatical NUMBER, which the Energy noun marks and the
    Pokémon noun does not ("Pokémon" is invariant in print and in this code). The
    ARTICLE is optional because the three anchors disagree about where it lives:
    `ATTACK_DISCARD_RETRIEVAL`'s singular group carries it (its table's strings
    do), and `ATTACK_BENCH_SEARCH`'s noun group does not (its anchor spells the
    "a" outside). Both forms are printed, so neither branch is decoration. */
const TYPED_NOUN = /^(?:a )?(Basic )?\{([A-Z])\} (Pokémon|Energy cards?)$/;
function typedNounFilter(phrase: string, plural: boolean): CardFilter | undefined {
  const match = TYPED_NOUN.exec(phrase);
  if (match === null) return undefined;
  const basic = match[1] !== undefined;
  const code = match[2] ?? "";
  if (match[3] === "Pokémon") {
    const pokemonType = POKEMON_TYPE_BY_CODE[code];
    return pokemonType === undefined
      ? undefined
      : { kind: "typedPokemon", pokemonType, ...(basic ? { stage: "basic" as const } : {}) };
  }
  // 🛑 "Basic" IS REQUIRED ON THE ENERGY NOUN AND IS NOT A PRINTED FLOURISH. An
  // unqualified "{R} Energy card" would be a PROVISION phrase (`providesEnergy`,
  // a while-attached property `matchesFilter` answers FALSE for in every pile) —
  // a different filter for a different question — so a build that dropped the
  // word would search a deck for something no card in it can be.
  if (!basic || match[3] !== (plural ? "Energy cards" : "Energy card")) return undefined;
  const energyType = ENERGY_TYPE_BY_CODE[code];
  return energyType === undefined ? undefined : { kind: "basicEnergy", energyType };
}
/** The same phrases as a regex FRAGMENT, per grammatical number and per anchor.
    Three constants rather than one because each anchor spells the article in a
    different place, and welding the article to the number is what stops the
    crossed forms no card prints from matching (`ATTACK_HAND_SEARCH`'s rule, and
    the attach family's before it).

    ⚠️ THE ARTICLE IS A LITERAL "a" AND NOT `an?`. Every one of these phrases
    opens with a brace, which is read aloud as its type name — and no printed
    Pokémon type begins with a vowel — so an "an" alternative would be a branch no
    catalog row can reach and no mutant can kill. Same call as `retrieveNoun`'s,
    made in both files for the same reason. */
const TYPED_NOUN_SINGULAR = "a (?:Basic )?\\{[A-Z]\\} Pokémon|a Basic \\{[A-Z]\\} Energy card";
const TYPED_NOUN_PLURAL = "(?:Basic )?\\{[A-Z]\\} Pokémon|Basic \\{[A-Z]\\} Energy cards";
/** The BENCH anchor's form: no article (the anchor spells it), and no Energy —
    a Bench holds Pokémon, so "Basic {G} Energy card" has no business in a group
    whose every match is benched. The alternative is `stage: "basic"`'s only
    printed witness in the whole catalog, which is why this 0-legal / 1-catalog
    sentence is read rather than deferred: without it the rider would be a field
    no printing drives, and this repo does not ship those. */
const BENCH_TYPED_NOUN = "Basic \\{[A-Z]\\} Pokémon";
const BENCH_SEARCH_NOUN = `(?:(Basic Pokémon)|(${BENCH_TYPED_NOUN})|([A-Z][a-zé]+))`;
const BENCH_SEARCH_TAIL = " onto your Bench\\. Then, shuffle your deck\\.$";
const ATTACK_BENCH_SEARCH = new RegExp(
  `^Search your deck for (?:a ${BENCH_SEARCH_NOUN} and put it|up to (\\d+) ${BENCH_SEARCH_NOUN} and put them)${BENCH_SEARCH_TAIL}`,
);

// ⚠️⚠️ D231 — THE DECK SEARCH INTO YOUR OWN HAND: row 8 of
// `coverage-backlog-legal.md`, D230's sibling one word over (`dest: "hand"`
// rather than `"bench"`, the same trailing `shuffleDeck`), and the BIGGEST
// single count this reader has ever taken.
//
// THE CENSUS, re-derived (never inherited) against the remote D1 `luminous` —
// 3,786 rows / 20 sets, 2,021 `legal_standard = 1` — on 2026-08-06, over
// `json_each` + `GLOB '*[Ss]earch your deck*'` (case class on the opening verb:
// D230's first sweep was case-SENSITIVE and undercounted by one), all three text
// columns, and GROUPED BY SENTENCE before anything was priced.
//
// 🛑 **THE ATTACK COLUMN HOLDS 42 LEGAL PRINTINGS OVER 23 DISTINCT SENTENCES —
// THE ROW SAID 25 — AND IT IS ONE ANCHOR, NOT "~15 ARMS".** That is the SIXTH
// `needs` cell on this branch to misprice, the third running to miss in BOTH
// directions at once, and the first to under-count the population by more than a
// third. Twenty of the 23 sentences are the same sentence with a different NOUN
// PHRASE, a different NUMBER, an optional leading *"You may"* and an optional
// printed *"reveal it/them"*. D230's lesson holds a second time: **an arm count
// is a count of sentence SHAPES, not of strings.**
//
// ⚠️ AND THE 42 CORRECTS A FIGURE THIS REPO ALREADY WROTE DOWN. D230's own file
// says *"(41 legal printings search into the HAND)"* while refusing a `dest`
// rewrite; 41 is the **`effect` (Trainer) column**, and the ATTACK column — the
// only one this reader can reach — is 42. Two different denominators one word
// apart, which is the "every count carries a POPULATION" rule biting inside a
// single family. The parenthetical is corrected in place.
//
// WHAT THIS ANCHOR READS — 28 of the 42, by noun phrase (legal printings):
//   • "a card" / "up to N cards"        **7** — `anyCard`, and the ONLY no-reveal
//     printings in the whole family (`sv06-106`/`-198`/`-214`,
//     `sv10.5b-003`/`-156`/`-164`, `sv05-127`)
//   • "a/up to N Basic Energy card(s)"  **7** (`svp-123`, `sv06-024`, `sv08-097`,
//     `sv10.5b-068`/`-145`, `sv06-087`, `sv05-026`)
//   • "an Item card"                    **4** (`sv05-047`, `sv10-072`,
//     `sv10.5w-072`/`-152`) — the new `item` member
//   • "a / up to N Pokémon"             **4** (`sv06-126`/`-185`, `sv08-047`,
//     `sv06.5-011`)
//   • "a Supporter card"                **3** (`sv06.5-027`, `sv10-127`/`-200`)
//   • "a Pokémon Tool card"             **1** (`sv07-103`)
//   • "a Stadium card"                  **1** (`sv09-086`) — the new `stadium`
//   • "up to 4 Energy cards"            **1** (`sv08-155`)
// Fourteen legal printings are NOT read and every one of them is named in
// `derivedHandSearch.test.ts`, each deferred on a NOUN this vocabulary cannot
// spell rather than on this sentence.
//
// 🛑 THE `reveal` RIDER IS THE REAL WORK, IT IS PER-SENTENCE, AND THE `anyCard`
// MEMBER IS WHAT MAKES IT FALSIFIABLE. D225 measured that 15 of 100 legal
// to-hand search printings print no reveal at all and every one searches for
// uncategorised *"cards"*; an anchor that folded the clause in wholesale would
// make all fifteen lie in `DECK_SEARCHED`. So the clause is an OPTIONAL CAPTURE
// GROUP whose PRESENCE (never its text) sets the rider — and because `anyCard` is
// in the table, seven legal printings drive the ABSENT branch. Without that
// member every sentence this arm read would reveal, and a hard-coded
// `reveal: true` would be an unkillable mutant.
//
// THE NOUN IS CAPTURED WHOLE AND RESOLVED THROUGH A CLOSED TABLE, which is
// `OPPONENT_ENERGY_SCALE`'s `CLAUSE_ENERGY_TOKENS` shape (D128/D118) rather than
// D230's group-per-noun: eight nouns over two grammatical numbers would be
// SIXTEEN capture groups, and the table keeps `DAMAGE_SUPPRESSION`'s guarantee
// anyway — an UNRESOLVABLE phrase yields `undefined` and falls through to the
// loud ATTACK_EFFECT_SKIPPED path, so the dispatch never approximates a noun it
// cannot name. The `[^,.]` class is what stops the capture at the reveal clause
// and at the sentence end, and it is why the table can be consulted with a whole
// printed phrase.
//
// ⚠️ THE FOURTEEN LEFT ARE ALL NOUNS, AND THE TABLE REFUSES EVERY ONE (asserted,
// not listed): "up to 3 {D} Pokémon" (2) and "up to 2 {L} Pokémon" (1) want a
// TYPE-narrowed Pokémon filter; "up to 3 Misty's Pokémon" (2) is `ownerPokemon`
// behind a possessive capture; "up to 3 in any combination of {R} Pokémon and
// Basic {R} Energy cards" (2) is a typed DISJUNCTION; "any number of Fennel
// cards" (2) is `byName` at an UNBOUNDED max the `(\d+)` group cannot spell;
// "up to 3 Basic {G} Energy cards" (1) wants the brace code resolved;
// "up to 3 Basic Energy cards of different types" (1) is a distinctness
// constraint; "up to 5 Pokémon that are the same type as any Basic Energy
// attached to this Pokémon" (1) is board-dependent; "a number of cards up to the
// number of your Benched Pokémon" (1) is a DYNAMIC max; and `sv07-011`'s
// "Put this Pokémon and all attached cards into your deck. If you do, …" (1) is a
// §9.2 leading clause. **The last one is also the anchor's leading-`^` witness,
// printed and legal** — D230 had to find one for its family too.
// 🆕 ⚠️ **D314 BUILT `sv07-011` AS A REGISTRY ROW AND THIS REFUSAL IS UNCHANGED**,
// which is the distinction worth keeping: the ANCHOR still cannot read that
// sentence (reading it would mean swallowing a prefix, the one thing this
// family's safety property forbids), so the printing leaves `BUILT.attack`'s
// UNBUILT side through the REGISTRY summand and this reader's reach is exactly
// what it was. **"Refused by the deriver" and "unbuilt" have never been the same
// claim, and this is the first printing in this family to make them come apart.**
//
// NO APOSTROPHE ON ANY OF THE EIGHT SENTENCES (D189/D137's class is not owed
// here), and `clauseApostrophe.test.ts`'s census is predicted UNMOVED at 88.
/** The printed noun phrases this reader can name, singular and plural, each with
    the filter it means. ⚠️ **THE TWO STRINGS ARE `retrieveNoun`'s OWN OUTPUT FOR
    THAT FILTER** (interpreter.ts) — deliberately, and asserted by driving each
    sentence and reading the prompt back: the `chooseCards` note a search parks
    with is built by `searchNote` out of `retrieveNoun`, so a table row that
    disagreed with it would caption the player's dialog with a different noun from
    the one the card prints. The two live in different files because effects.ts
    cannot import from interpreter.ts, so the round trip is a TEST rather than a
    shared constant, and it goes red from either side. */
const HAND_SEARCH_NOUNS: readonly (readonly [string, string, CardFilter])[] = [
  ["a card", "cards", { kind: "anyCard" }],
  ["a Pokémon", "Pokémon", { kind: "anyPokemon" }],
  ["an Item card", "Item cards", { kind: "item" }],
  ["a Supporter card", "Supporter cards", { kind: "supporter" }],
  ["a Stadium card", "Stadium cards", { kind: "stadium" }],
  ["a Pokémon Tool card", "Pokémon Tool cards", { kind: "toolCard" }],
  // ⚠️ D237 — the UNION of the four subtypes above, added for backlog row 13's
  // `sv08-087` ("Put a Trainer card from your discard pile into your hand.", 1
  // legal). It is in the SHARED table rather than in a retrieval-only one for the
  // reason the table exists: its two strings are `retrieveNoun`'s output, and a
  // second table would let the two families caption the same filter differently.
  // ⚠️ IT EXPIRES A CONTROL ONE FAMILY OVER, RE-HOMED RATHER THAN DELETED —
  // `derivedHandSearch.test.ts` pinned "Search your deck for a Trainer card…"
  // derived-to-null on the grounds that the table had no row. It now has one, so
  // the deck search reads that sentence too: ZERO printings today (measured over
  // all 3,786 catalog rows), which is the "an arm transfers" trade this file
  // takes every slice.
  ["a Trainer card", "Trainer cards", { kind: "trainerCard" }],
  ["a Basic Energy card", "Basic Energy cards", { kind: "basicEnergy" }],
  ["an Energy card", "Energy cards", { kind: "anyEnergy" }],
];
const HAND_SEARCH_SINGULAR = new Map(HAND_SEARCH_NOUNS.map(([one, , filter]) => [one, filter]));
const HAND_SEARCH_PLURAL = new Map(HAND_SEARCH_NOUNS.map(([, many, filter]) => [many, filter]));
// Groups: 1 the singular noun phrase WITH its article, 2 the singular reveal
// clause, 3 the printed count, 4 the plural noun phrase, 5 the plural reveal
// clause. The pronoun is welded to the number on both halves ("a … put it" /
// "up to N … put them"), so the crossed forms no card prints cannot match.
const ATTACK_HAND_SEARCH = new RegExp(
  "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
    "|up to (\\d+) ([^,.]+?)(, reveal them,)? and put them)" +
    " into your hand\\. Then, shuffle your deck\\.$",
);

/** 🆕 D307 — THE EVOLVE-FROM-DECK FAMILY, and the anchor is the WHOLE printed
    sentence with not one capture in it. There is nothing to capture: the four
    cards print byte-identical text (D1, 2026-08-09), the noun is a pronoun and
    the count is the article.

    ⚠️ **THE `^…$` IS DOING REAL WORK HERE RATHER THAN BEING HOUSE STYLE.** The
    catalog prints this exact clause as the SECOND half of a compound — Finizen
    `sv03-060`/`sv04.5-123` *"Switch this Pokémon with 1 of your Benched Pokémon.
    **If you do,** search your deck for a card that evolves from this Pokémon…"* —
    and that sentence must stay on the loud `ATTACK_EFFECT_SKIPPED` path, because
    simulating its tail without its head would evolve a body the engine never
    switched. Both printings are `legal_standard = 0` today, so this is the
    unusual case where the anchor's refusal is checkable against real bytes rather
    than against a hypothetical; `evolveFromDeck.test.ts` §1 pins it.

    ⚠️ Exeggcute's licensed printing reaches this anchor through D282's SPLIT and
    not through a second alternative: `attack.ts` rebinds `effect` to
    `splitAttackGateClause(printed).body` when the attacking body's program
    carries a gate at this index, so the two summands stay disjoint and the
    licence keeps being a PRECONDITION rather than text. */
const ATTACK_EVOLVE_FROM_DECK =
  /^Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it\. Then, shuffle your deck\.$/;

/** 🆕 D308 — the ITERATED half of the same family: Vivillon `sv08-007`/`-193`
    "Evo-Powder" and Reuniclus `sv10.5b-039`/`svp-212` "Cellular Ascension", 4
    legal printings on ONE corpus record. `^…$` and NO CAPTURES for the same two
    reasons the anchor above has them: the sentence carries no number and no noun,
    and Team Rocket's Nidorina `sv10-115` prints this exact clause behind a
    LEADING *"Choose up to 2 of your {D} Pokémon."* which is a different mechanism
    (a type-filtered multi-body choice) and must be refused whole.
    🆕 **D315 BUILT THAT SENTENCE ON ITS OWN ANCHOR BELOW AND THIS REFUSAL IS
    UNCHANGED** — which is the point of writing it here rather than deleting it.
    The `$` is what keeps Nidorina out of THIS arm; the `^` is what keeps it from
    being read as a bare suffix. Both still hold, and `evolveEachChosen.test.ts`
    §1 asserts the separation in both directions. */
const ATTACK_EVOLVE_FROM_DECK_EACH_BENCHED =
  /^For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it\. Then, shuffle your deck\.$/;

/** 🆕 D309 — the BODY-CHOICE half: Duosion `sv10.5b-038`/`-119` "Cellular
    Evolution", 2 legal printings on ONE card and ONE corpus record (plus the
    rotated Indeedee `sv01-153`, which prints it byte-identically).

    `^…$` and NO CAPTURES, for the family's two standing reasons — the sentence
    carries no number and no noun, *"1 of"* being the printed article rather than a
    count. ⚠️ **AND THE ANCHOR IS LOAD-BEARING IN BOTH DIRECTIONS HERE, WHICH THE
    OTHER TWO ARMS CANNOT SAY.** This sentence and D307's differ by **eleven bytes
    in the MIDDLE** — *"this Pokémon"* against *"1 of your Pokémon"* — and share
    both head and tail, so an unanchored pattern over either end matches both and
    the wrong-row failure (D207) is a substring away rather than a set away. */
const ATTACK_EVOLVE_FROM_DECK_BODY_CHOICE =
  /^Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it\. Then, shuffle your deck\.$/;

/** 🆕 D315 — the MULTI-BODY half, and the family's LAST sentence: Team Rocket's
    Nidorina `sv10-115` "Dark Awakening", 1 legal printing on ONE corpus record.

    🛑 **THE FIRST ANCHOR IN THIS FAMILY WITH CAPTURES, AND THE FAMILY'S OWN
    STATED REASON IS WHAT GIVES IT THEM.** All three siblings above say *"NO
    CAPTURES … the sentence carries no number and no noun"*; this one carries
    BOTH — the printed *"up to 2"* is a real count (not `ATTACK_DRAW`'s absent
    article) and the printed `{D}` is a real noun — so the same rule that kept
    them bare requires two groups here.

    ⚠️ **THE HEAD IS SHARED WITH A CARD THAT IS ALREADY BUILT AND MUST NOT BE
    TOUCHED.** Janine's Secret Art `sv06.5-059`/`-088`/`sv08.5-112`/`-173` prints
    *"Choose up to 2 of your {D} Pokémon. For each of those Pokémon, …"*
    BYTE-IDENTICALLY and then attaches Energy instead of evolving; it is authored
    as `attachFromDeck { maxPerTarget: 1 }`, where the body pick COLLAPSED into the
    `attachCards` map because Energy of one type are fungible. Evolution cards are
    not fungible — the card determines which body it may go onto — so this sentence
    cannot collapse the same way, and the two readings must stay apart. The
    CONSEQUENT is what separates them and it is inside the anchor, so no widening
    of the head can reach Janine (whose text is a Trainer `effect` besides).

    ⚠️ **AND THE `^…$` IS LOAD-BEARING AT BOTH ENDS FOR THE FAMILY'S REASON**: this
    sentence CONTAINS `ATTACK_EVOLVE_FROM_DECK_EACH_BENCHED`'s consequent almost
    whole (*"For each of those Pokémon"* against *"For each of your Benched
    Pokémon"*), so an unanchored pattern over either sibling is a substring away
    from the wrong-row failure (D207). */
const ATTACK_EVOLVE_FROM_DECK_EACH_CHOSEN =
  /^Choose up to (\d+) of your \{(\w)\} Pokémon\. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it\. Then, shuffle your deck\.$/;

// ⚠️⚠️ D232 — THE OPPONENT-HAND FAMILY (backlog row 7), AND THE FIRST ROW ON THAT
// PAGE WHOSE SENTENCES GENUINELY DO NOT COLLAPSE INTO ONE ANOTHER. Rows 5/6/8
// each turned out to be ONE anchor wearing many nouns; these are three verbs
// (reveal / discard-at-random / choose-at-random-and-shuffle-back) taking two
// ops, which is what the row's "2 ops" said and the only half of it that held.
//
// Re-derived (never inherited) against the remote D1 `luminous` — 3,786 rows /
// 20 sets, 2,021 `legal_standard = 1` — on 2026-08-06, `json_each` +
// `json_extract(value,'$.effect')`, GROUPED BY SENTENCE, over ALL THREE text
// columns. **The attack column holds 20 legal printings on these three
// sentences** (8 / 7 / 5), and the row's **35** is a count with no column and no
// grouping behind it: sweeping the whole family's verbs the attack column reaches
// 31 (17 reveal-compounds, 9 random-discard, 5 shuffle-back) and adding the
// ability (6) and Trainer (6) columns reaches 43. **NEITHER of those is 35**, and
// neither is what a deriver could read — 11 of the 31 attack printings are
// COMPOUNDS whose second sentence is a whole other slice (see the deferred table
// in `opponentHandFamily.test.ts`).
//
// NO `['’]` NEEDED AND IT IS THERE ANYWAY. Two of the three sentences carry
// "opponent's"; a sweep of the whole 3,786-row catalog for the U+2019 spelling of
// either returns ZERO rows, so the class is D137's insurance against a re-ingest
// and not a live population — recorded here so the mutant that deletes it is a
// DECLARED survivor rather than a mystery.
const ATTACK_REVEAL_OPPONENT_HAND = /^Your opponent reveals their hand\.$/;
const ATTACK_RANDOM_DISCARD_FROM_HAND = /^Discard a random card from your opponent['’]s hand\.$/;
// The one sentence in this family printed as TWO sentences, and it is still one
// op: the "reveals that card" is the `RANDOM_CARD_TAKEN` event naming the uid and
// the "shuffles it into their deck" is the route — see the op's doc for why the
// pair cannot be split without inventing a card nobody prints.
const ATTACK_RANDOM_SHUFFLE_FROM_HAND =
  /^Choose a random card from your opponent['’]s hand\. Your opponent reveals that card and shuffles it into their deck\.$/;
// ⚠️ A FOURTH SENTENCE THE CENSUS TURNED UP AND NO PAGE IN THIS REPO NAMED:
// N's Purrloin `sv09-096` "Thieving Swipe" (1 legal) prints **Ortega's Trainer
// text, verbatim, as an ATTACK** — the UNFILTERED reveal-and-bottom. The op has
// existed since M5 with `filter` OPTIONAL, and Greavard `sv01-105`'s derived twin
// has read the SUPPORTER-narrowed spelling since then, so the bare one was one
// anchor away the whole time and nothing had looked. It costs no op, no field and
// no interpreter line — and its prompt note is already this card's printed
// sentence character-for-character (`bottomFromOpponentHandNote`'s bare form),
// which is a round trip neither file could have checked alone.
const ATTACK_REVEAL_AND_BOTTOM =
  /^Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck\.$/;
// 🆕 **D297 — THE FIFTH SENTENCE IN THIS FAMILY, AND THE FIRST WITH A NUMBER IN
// IT.** Lickitung `sv05-124`/`-180` "Tongue Pull" — *"Your opponent reveals their
// hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench."*
// **2 legal printings and that is the WHOLE population of the phrase**: the
// remote D1 `luminous` sweep `instr(attacks_json, 'you find there onto your
// opponent') > 0` returns exactly these two rows, both `legal_standard = 1`, mark
// H, attack INDEX 0, cost {C}, and the two `attacks_json` blobs are BYTE-IDENTICAL
// (re-queried 2026-08-09, one flat `WHERE id IN`).
//
// 🛑 **A SEPARATE ANCHOR RATHER THAN A WIDENING OF THE ONE ABOVE, AND THE REASON
// IS THE PUNCTUATION.** D232's rule says a family collapses to one arm when the
// sentences differ in a NOUN and splits when they differ in a VERB. These differ
// in NEITHER — they differ in SENTENCE COUNT. Ortega/Greavard/Purrloin print one
// joined clause ("Your opponent reveals their hand, **and you** choose…") and
// Mandibuzz's Ability prints the same joint; Lickitung prints two sentences with
// an imperative second ("… their hand**. Put** up to 2…"). An alternation wide
// enough to hold both would have to make the comma, the conjunction, the pronoun
// AND the verb form optional together, which is a pattern that matches strings no
// set prints.
//
// ⚠️ **THE CAPTURE IS A NUMBER AND IT IS THE FIRST ONE THIS FAMILY HAS OWED.**
// D232 wrote "NO CAPTURE GROUP ON ANY OF THE THREE, AND NONE IS OWED: no printed
// Standard-legal sentence in this family carries a number" — true then, false now,
// and the honest response is a capture with the printed-number guard every other
// numeric arm in this file carries rather than a welded `2`. The ceiling is
// `BENCH_MAX`, not the attach family's 10: this number sizes a BENCH, and a
// printing that asked for more bodies than a Bench holds would be a malformed row
// rather than a card. (The park clamps to the live `benchSpace` on top of this —
// the guard refuses the DATA, the clamp answers the BOARD.)
const ATTACK_REVEAL_AND_BENCH_UP_TO =
  /^Your opponent reveals their hand\. Put up to (\d+) Basic Pokémon you find there onto your opponent['’]s Bench\.$/;

// ⚠️⚠️ D234 — ATTACH FROM THE DISCARD PILE (backlog row 9), AND THE ROW'S OWN
// PREDICTION HELD: **ONE anchor, twelve printed sentences.** The row wrote the
// prediction down so a successor could falsify it — "the sentences vary in the
// NOUN (energy type, count) and in the DESTINATION, not in the VERB, so D232's
// rule says this collapses to one arm" — and it is the first prediction on that
// page to survive contact rather than be corrected by it.
//
// RE-DERIVED (never inherited) against the remote D1 `luminous` — 3,786 rows /
// 20 sets, 2,021 `legal_standard = 1` — on 2026-08-06, `json_each` +
// `json_extract(value,'$.effect')`, GROUPED BY SENTENCE, over ALL THREE text
// columns:
//
//   SELECT col, COUNT(*) printings, COUNT(DISTINCT t) sentences FROM u
//     WHERE t GLOB '*[Aa]ttach*Energy card*from your*discard pile*' GROUP BY col;
//   -- attack 17 / 12 · ability 13 / 6 · effect 6 / 4
//
// **The row's `17 (12 sentences) · 12 · 5` is EXACT** — the ability and Trainer
// figures are the 13 and 6 above minus the one printing each that is already
// authored (`sv09-024`, and N's PP Up `sv09-153`). Four rows running carried a
// count nobody could reproduce; this one reproduces to the digit.
//
// 🛑 **THIS ARM READS 12 OF THE 17, AND THE 5 IT REFUSES ARE REFUSED FOR FOUR
// SEPARATE REASONS, NOT ONE** — each pinned derived-to-null in
// `derivedDiscardAttach.test.ts` rather than described here. ✅ **D246 THEN TOOK
// THE BARE NOUN AND D248 TOOK THE SPREAD, SO THE ARM NOW READS 15 OF THE 17 AND
// TWO REASONS ARE LEFT:**
//   · ✅ ~~"…to **each of** your Benched Pokémon." (2)~~ — **BUILT AT D248, AND
//     AT ZERO COST TO THE ANCHOR.** The destination is a `([^.]+)` capture, so
//     this phrase was ALWAYS matched and was refused only because
//     `DISCARD_ATTACH_DESTINATIONS` had no key for it: the whole slice is ONE
//     MAP ROW, one op field (`toEach`) and one interpreter fold. 🆕 **A ROW
//     THAT LOOKS LIKE A MISSING ARM CAN BE A MISSING MAP KEY**, which is what a
//     table-driven capture buys and what nothing on the backlog page priced.
//   · ✅ ~~"Attach **an** Energy card…" (1)~~ — BUILT at D246 (`anyEnergy`).
//     `attachableEnergies` used to admit
//     `energyType === "Normal"` only, so a Special Energy is out of reach of the
//     op, not of the anchor.
//   · "…from your **opponent's** discard pile to **their** Pokémon…" (1) — the op's
//     `source` names a ZONE, never a SEAT, and every target it can produce is
//     `ctx.seat`'s.
//   · "**Flip 3 coins.** Attach a number … up to the number of heads…" (1) — a
//     `programPerHeads` over a PARKING op, which nothing in the pool has yet
//     printed and which `deriveAttackCoinFlip` (a different reader) would own.
//
// ⚠️ AND THE ARM IS DELIBERATELY WIDER THAN THE LEGAL POOL. "1 of your Pokémon"
// has **5 catalog printings and 0 legal** — every one rotated — and it is read
// anyway, because *an arm transfers across sets and a registry row does not*
// (D180/D187): the sentence recurs, so the arm serves the H/I reprint the day one
// is ingested. Over the whole 3,786-row catalog the same GLOB returns **43
// printings on 26 sentences** and this anchor reads **37 of them on 21**. The
// five it refuses there are the four legal ones above plus a rotated-only fifth,
// "**Choose up to 2 of your Benched Pokémon and** attach a Basic {R} Energy card
// … **to each of them**" — the "each of" case again, wearing a leading clause.
//
// ⚠️ THE ONE FIELD WHOSE TWO VALUES ARE BOTH PRINTED **AND BOTH LEGAL** is the
// one this arm could most easily get wrong, so it is named here (D231's
// falsifiability test): `count: 2` pins the whole batch onto ONE chosen body
// ("up to 2 … to **1 of** your Benched Pokémon", 2 legal) where the printed "in
// any way you like" is TWO SEPARATE OPS that may land on two different bodies
// ("up to 2 … to **your Benched Pokémon in any way you like**", 1 legal). That is
// D205's `count`-versus-N-ops distinction, arriving from the deriver for the first
// time — Koraidon ex "Dino Cry" is the registry-authored precedent for the
// expansion and this arm emits exactly its shape.
const MAX_PRINTED_ATTACH_COUNT = 10;
/** The largest deck-top WINDOW this engine will believe off a printed `\d+`
    (D241, backlog row 11) — the ceiling `MAX_PRINTED_ATTACH_COUNT` is for the
    attach family's count, asked at the other end of the same sentence.

    🛑 **A SEPARATE CONSTANT BECAUSE IT IS A DIFFERENT QUANTITY, AND THE CATALOG
    SAYS SO LOUDLY.** The attach ceiling of 10 bounds how many cards may be
    MOVED; this one bounds how deep a LOOK reaches, and Lapras ex's "Look at the
    top **20** cards of your deck" would fail the attach ceiling outright — the
    three printings would derive to null and nobody would have been told why.
    Sharing the number would have been the cheap read and it is measurably wrong.

    **20 IS THE PRINTED MAXIMUM AND 30 IS THE GUARD**, the same margin the attach
    ceiling takes over its own printed 5: the constant exists to refuse a
    malformed third-party row that sizes a prompt, not to re-assert the catalog. */
const MAX_PRINTED_LOOK_WINDOW = 30;
/** The printed DESTINATION phrases this family spells, each with the
    `AttachTargetRiders` it means and whether the printed "in any way you like"
    makes the batch N SEPARATE decisions.

    A `Map` for D115's reason: the key is arbitrary PRINTED text, and an object
    lookup on arbitrary text can hit `Object.prototype` and hand back something
    that is not a destination at all. An UNRESOLVABLE phrase yields `undefined`
    and falls through to the loud ATTACK_EFFECT_SKIPPED path, which is what lets
    the anchor capture a whole phrase with `([^.]+)` and still refuse "their
    Pokémon in any way you like" by NAME rather than by a negative lookahead
    nobody can read.

    🆕 **D248 — AND THE CONVERSE IS THE FINDING OF THAT SLICE: A MISSING KEY HERE
    LOOKS EXACTLY LIKE A MISSING ARM FROM THE BACKLOG PAGE.** *"each of your
    Benched Pokémon"* sat in this doc as an example of a REFUSED phrase for
    fourteen slices, and it was never one regex away — it was one MAP ROW away,
    because the capture had been matching it the whole time. Price a table-driven
    destination by asking which KEY is missing before asking which ANCHOR is.

    ⚠️ THE CLASS IS `[^.]` RATHER THAN `.`, AND IT IS THE `$` MUTANT THAT SAID SO.
    A greedy `(.+)` backtracks past a trailing clause to the LAST period in the
    sentence, so it captures "1 of your Benched Pokémon. Draw a card" — an
    unresolvable phrase, which means the anchor refuses a trailing clause **by
    accident** and a build with no `$` at all behaves identically. The mutant
    SURVIVED, which is the harness doing its job on a claim this file had already
    written down: stopping the capture at the sentence boundary is what makes the
    `$` observable, and it is also what `ATTACK_HAND_SEARCH`'s own `[^,.]` class
    is for.

    The brace-coded rows are generated FROM `POKEMON_TYPE_BY_CODE` rather than
    listed, so a type in the schema is admitted here by construction — the same
    rule `CLAUSE_POKEMON_TYPES` follows one axis over. */
interface DiscardAttachDestination {
  readonly riders: { toSelf?: true; benchOnly?: true; targetType?: PokemonType };
  readonly anyWay: boolean;
  /** ⚠️⚠️ D248 — THE THIRD MEMBER OF THE DISTRIBUTION AXIS, beside `anyWay` and
      the builder's `count`, and it sits HERE rather than in `riders` on purpose.
      `riders` answers "WHICH bodies may receive"; this answers "how many
      DECISIONS the print asks for" — and the printed *"each of"* asks none. A
      destination is exactly one of the three, which is why they are three
      separate map ROWS and not three co-authorable flags. */
  readonly toEach?: true;
}
const DISCARD_ATTACH_DESTINATIONS: ReadonlyMap<string, DiscardAttachDestination> = new Map<
  string,
  DiscardAttachDestination
>([
  // "to this Pokémon" — the UID question (D221's `toSelf`), never a class rider:
  // on a board with two {F} bodies a class rider would let the attach land on the
  // wrong one.
  ["this Pokémon", { riders: { toSelf: true }, anyWay: false }],
  // Un-narrowed: every own in-play Pokémon. 0 legal, 5 catalog — see the note above.
  ["1 of your Pokémon", { riders: {}, anyWay: false }],
  ["1 of your Benched Pokémon", { riders: { benchOnly: true }, anyWay: false }],
  ["your Pokémon in any way you like", { riders: {}, anyWay: true }],
  ["your Benched Pokémon in any way you like", { riders: { benchOnly: true }, anyWay: true }],
  // ⚠️⚠️ D248 — THE SPREAD (Mudsdale `sv05-092`/`sv05-175` "Mud Stock", 2 legal).
  // `anyWay: false` because there is no distribution CHOICE, and `toEach` rather
  // than a count because the print names no number: the eligible set IS the
  // count. The zone word rides `benchOnly`, the same field the singular row above
  // uses, so the two spellings of "Benched" cannot drift.
  ["each of your Benched Pokémon", { riders: { benchOnly: true }, anyWay: false, toEach: true }],
  // ⚠️ THE UN-NARROWED SPREAD IS READ THOUGH NO CARD PRINTS IT YET — 0 catalog,
  // measured — for the reason "1 of your Pokémon" (0 legal, 5 catalog) is read:
  // an arm transfers across sets (D180/D187). It is also what makes the
  // `D248-toEach-implies-bench` mutant killable, since a welded flag and an
  // orthogonal one are observationally identical on every BENCH row.
  ["each of your Pokémon", { riders: {}, anyWay: false, toEach: true }],
  ...Object.entries(POKEMON_TYPE_BY_CODE).map(
    ([code, type]) =>
      [`1 of your {${code}} Pokémon`, { riders: { targetType: type }, anyWay: false }] as [
        string,
        DiscardAttachDestination,
      ],
  ),
]);
// Groups: 1 the SINGULAR branch's brace code, 2 the printed count, 3 the PLURAL
// branch's brace code, 4 the destination phrase. The article is welded to the
// grammatical number on both halves ("a … Energy **card**" / "up to N … Energy
// **cards**"), so the crossed forms no card prints cannot match — the same weld
// `ATTACK_HAND_SEARCH`'s pronoun carries. The code class is built FROM
// `ENERGY_TYPE_BY_CODE`'s keys, so the regex cannot admit a code the map will not
// resolve; the noun is a Basic Energy CARD in a pile, which is why the type is a
// code on the print rather than a `providesEnergy` question (§6.5 — a card in a
// pile provides nothing).
/** The SOURCE-side phrase, named so the one word that separates this family from
    backlog row 12 (the HAND) is a constant rather than a byte buried in an
    alternation — and so a mutant on it has somewhere to land. */
const SOURCE_ZONE_PHRASE = " from your discard pile";
/** D236 — the SAME phrase one zone over. Row 12 of `coverage-backlog-legal.md`,
    and the reason the constant above was extracted at D234 in the first place. */
const HAND_SOURCE_ZONE_PHRASE = " from your hand";
/** ⚠️⚠️ D236 — ONE ANCHOR, TWO PRINTED SOURCE ZONES, BUILT BY A FACTORY RATHER
    THAN COPIED. D234 named `SOURCE_ZONE_PHRASE` so that "the hand family is this
    family one word over" could be checked; a second hand-maintained `new RegExp`
    would have made that claim PROSE again — the two could drift on the article
    weld, on the `[^.]` class or on the `$` and nothing would say so.

    `zonePhrase` is the printed source. `tail` is what may follow the
    destination's period: EMPTY for the discard side (no printing in that family
    carries a clause, measured at D234) and the optional heal group for the hand
    side. Both anchors therefore share, byte for byte:

    * the ARTICLE/NUMBER weld ("a … Energy **card**" / "up to N … Energy
      **cards**"), so neither can read a grammatical cross no card prints;
    * the `[^.]` destination class — a greedy `(.+)` backtracks past a trailing
      clause to the LAST period, which is what made D234's dropped-`$` mutant
      survive until the class was narrowed;
    * the terminal `$`, which is now ONE byte covered by ONE mutant for both
      families rather than two bytes and a hope.

    ⚠️ THE TAIL RIDES THE SECOND TEMPLATE LITERAL rather than a third plain
    string, and that is a lint fact rather than a style one: Biome's
    `useTemplate` refuses a string concatenated onto a template, and its
    `noUnusedTemplateLiteral` refuses a template with nothing to interpolate — so
    a third segment can satisfy neither. Every segment here interpolates. */
/** ⚠️⚠️ D246 — THE CLAUSE WITHOUT ITS CAPITAL, EXTRACTED SO A **LEADING** CLAUSE
    CAN WEAR IT. D234 named the source zone so "row 12 is row 9 one word over"
    could be checked; this splits one step further, because Kilowattrel ex
    `sv08-068` prints this family's whole sentence as the CONSEQUENT of a §9.2
    gate — *"Switch this Pokémon with 1 of your Benched Pokémon. If you do,
    **attach up to 2 Basic {L} Energy cards from your hand to this Pokémon**."*
    — with one byte different: the verb's capital.

    A second hand-maintained `new RegExp` for that would have made "the gated
    printing is this family behind a switch" PROSE again, and the two could drift
    on the article weld, the `[^.]` class or the bare-noun branch with nothing
    saying so. So the BODY (everything after the verb) is one string, and each
    anchor spells its own verb — capital `Attach` for the two bare imperatives,
    lowercase `attach` after the printed "If you do,". ⚠️ THE CASE IS SPELLED AT
    THE CALL SITE RATHER THAN FOLDED INTO A `[Aa]` CLASS: this reader commits to
    case (`clauseApostrophe.test.ts` pins that), and a class here would let a
    sentence that merely BEGINS "attach…" derive as a whole-string match.

    Groups, and they are the same 1-5 for every anchor built from this:
      1 the BARE-NOUN marker ("an"), 2 the SINGULAR branch's brace code, 3 the
      printed count, 4 the PLURAL branch's brace code, 5 the destination phrase.
    Any `tail` groups follow at 6+.

    ⚠️⚠️ **THE BARE NOUN IS A THIRD ALTERNATIVE AND NOT AN OPTIONAL "Basic ",
    BECAUSE THE ARTICLE MOVES WITH IT.** The catalog prints *"**a** Basic Energy
    card"* and *"**an** Energy card"*; an optional `(Basic )?` under `an?` would
    admit "an Basic Energy card" and "a Energy card", two crosses no card prints
    — the article weld this family has carried since D234, one noun over. And the
    marker is CAPTURED rather than inferred, because the bare noun is a real
    narrowing difference and not a spelling one: "a Basic Energy card" excludes
    Special Energy and "an Energy card" does not (see `attachEnergyFrom.anyEnergy`).

    ⚠️ THE TAIL RIDES THE SECOND TEMPLATE LITERAL rather than a third plain
    string, and that is a lint fact rather than a style one: Biome's
    `useTemplate` refuses a string concatenated onto a template, and its
    `noUnusedTemplateLiteral` refuses a template with nothing to interpolate — so
    a third segment can satisfy neither. Every segment here interpolates. */
function attachFromZoneClause(zonePhrase: string, tail: string): string {
  return (
    `(?:(an) Energy card|a Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy card` +
    `|up to (\\d+) Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy cards)` +
    `${zonePhrase} to ([^.]+)\\.${tail}`
  );
}
function attachFromZoneAnchor(zonePhrase: string, tail: string): RegExp {
  return new RegExp(`^Attach ${attachFromZoneClause(zonePhrase, tail)}$`);
}
const DISCARD_ATTACH = attachFromZoneAnchor(SOURCE_ZONE_PHRASE, "");

// ⚠️⚠️ D235 — THE DECK SEARCH THAT **ATTACHES** (backlog row 10), THE BIGGEST
// ATTACK-COLUMN COUNT LEFT ON THE D233 PAGE, AND THE FIRST PREDICTION ON THAT
// PAGE TO BE GRADED **PART WRONG**. That is the finding, and it is worth more
// than the printings.
//
// ✅ THE COUNT RE-DERIVES TO THE DIGIT — the second row running, and the whole
// 33, not just the half this arm takes. Remote D1 `luminous`, `legal_standard =
// 1`, `json_each` over `attacks_json`/`abilities_json` PLUS the bare `effect`
// column, GLOB (never LIKE), GROUPED BY SENTENCE, on 2026-08-06:
//
//   WHERE t GLOB '*[Ss]earch your deck for*Energy card*attach*' GROUP BY col;
//   -- attack 28 / 17 · ability 5 / 3 · effect 5 / 2
//
// The row says **28 (17 sentences) · 4 · 1**: the ability and Trainer halves are
// the 5 and 5 above MINUS what is already authored (`sv10-136` Marnie's
// Grimmsnarl ex; the four-printing Janine's Secret Art sentence). 5−1 = 4 and
// 5−4 = 1. **33 = 33.**
//
// 🛑 THE PREDICTION, WRITTEN BEFORE THE FIRST REGEX, AND ITS GRADE.
//   • *"ONE anchor plus ONE optional trailing group, not seventeen arms"* —
//     ✅ **CORRECT**, and it is what this file is: the sentences vary in the NOUN
//     (brace code, count) and in the DESTINATION, never in the verb, so D232's
//     rule collapses them; the one sentence with a §9.2 tail rides an optional
//     group on the SAME anchor rather than a second arm.
//   • *"23 of the 28 legal printings"* — 🛑 **WRONG. It is 20**, and the reason
//     is the transferable half: **A DESTINATION TABLE IS NOT PORTABLE BETWEEN TWO
//     OPS JUST BECAUSE ITS KEYS ARE.** D234's `DISCARD_ATTACH_DESTINATIONS` spells
//     every phrase this family prints, so the table read as free — but the op
//     underneath expresses a DIFFERENT set of target rules. `attachEnergyFrom`
//     has `count`, which pins a whole batch onto ONE chosen body (D205); its
//     deck-searching sibling has no such field, because its park is the compound
//     `attachCards` prompt whose answer is a MAP from card to target. So
//     *"attach **them** to **1 of** your Pokémon"* — 3 legal printings on 2
//     sentences — is UNREPRESENTABLE here at count > 1, and it is representable
//     one op over. **The phrase was priced off the wrong op's vocabulary.**
//
// That asymmetry is the whole reason `batch` exists in the table below rather
// than `anyWay` (D234's flag): on THIS op "in any way you like" and "1 of your
// Pokémon" emit the *same* program at count 1 and only the first is expressible
// at count > 1, so the axis that matters is not how the cards are distributed —
// it is whether the destination admits a batch at all.
//
// 🛑 20 OF THE 28, AND THE 8 LEFT ARE FOUR SEPARATE BLOCKERS — each pinned
// derived-to-null in `derivedDeckSearchAttach.test.ts` and written back to the
// backlog as a measured sub-row, never as "the rest of row 10". Two of the four
// were priced by the row up front (a Future/Tera SUBGROUP rider, 3 printings; a
// "of different types" distinctness `CardFilter`, 1 — and they overlap on
// `sv08-161`, which needs both); **two were not** — the batch-onto-one-body gap
// above (3) and a SECOND printed noun, *"up to 2 Basic {G} … **and** up to 2
// Basic {L} …"* (2), which is a different sentence SHAPE and therefore its own
// arm by D232's rule.
//
// ✅ EVERY READ SITE PRICED BY GREPPING THE FIELDS, NOT THE OPS. `programPlayable`
// is ZERO by the op's own doc (cardplay.ts:759 — `attachFromDeck` is deliberately
// ungated, every carrier prints a shuffle); `redact.ts`, `log.ts`, both HUD
// mirrors and `projection.ts` are ZERO because the park is the EXISTING
// `attachCards` prompt Charizard ex has produced since M5;
// `counterBenchPut.test.ts` (the guard D234 was surprised by) is ZERO because
// this op carries no `source` field at all. **`preventBlock.test.ts`'s §11 table
// is NOT zero** — `attachFromDeck` was absent from it, and both the verdict and
// its driven probe land in this slice.
//
// ⚠️ NO APOSTROPHE ON ANY OF THE FOURTEEN SENTENCES; `clauseApostrophe.test.ts`'s
// census is predicted UNMOVED at 88, and it is asserted.
/** The printed §9.2 tail this family's one gated sentence carries, ALREADY
    REGEX-ESCAPED because it goes straight into the anchor's optional group —
    Sandy Shocks / Skuntank-shaped ("Search your deck for up to 2 Basic {D}
    Energy cards and attach them to this Pokémon. Then, shuffle your deck. **If
    you attached Energy to a Pokémon in this way, this Pokémon is now
    Poisoned.**", `sv06.5-036`/`-082`/`-090`, 3 legal).

    It is an OPTIONAL GROUP rather than a second anchor because the clause
    modifies the SAME attach — Janine's Secret Art is the registry-authored
    precedent for the exact op triple (`attachFromDeck.recordAs` → `shuffleDeck`
    → `recordGate`), and the only difference here is that the gate is the PLAIN
    one: the print says "to **a** Pokémon", not "to your **Active** Pokémon", so
    no `contains` narrowing is owed. */
const DECK_SEARCH_POISON_TAIL =
  "If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned\\.";
/** The printed DESTINATION phrases this family spells, each with the
    `attachFromDeck` riders it means and whether a batch of MORE THAN ONE card
    may land there.

    ⚠️ **DELIBERATELY NOT `DISCARD_ATTACH_DESTINATIONS`, THOUGH ITS KEYS ARE VERY
    NEARLY THE SAME SET.** See the block comment above: the two ops disagree about
    what a destination phrase can MEAN, so sharing the table would import
    `attachEnergyFrom`'s vocabulary into an op that cannot honour it. The `Map`
    (never an object — D115: the key is arbitrary printed text and an object
    lookup on arbitrary text can hit `Object.prototype`) and the generated
    brace-coded rows are D234's shape and are copied on purpose.

    `batch: false` is the "attach **them** to **1 of** your …" rule: every card
    in the batch lands on ONE chosen body, which `attachFromDeck` cannot say. At
    count 1 the distinction is not observable — one card has one destination
    either way — so those phrases are read at the singular and REFUSED at the
    plural, rather than being dropped from the table and losing 4 legal printings
    that are perfectly expressible.

    `toSelf` is `batch: true` because the op resolves it to a 0-or-1 ref list
    (`sourceRef`): a batch aimed at "this Pokémon" has exactly one body to land
    on by construction, so the field the plural phrases want is the field this
    one already has. */
interface DeckSearchAttachDestination {
  readonly riders: { toSelf?: true; benchOnly?: true; targetType?: PokemonType };
  readonly batch: boolean;
}
const DECK_SEARCH_ATTACH_DESTINATIONS: ReadonlyMap<string, DeckSearchAttachDestination> = new Map<
  string,
  DeckSearchAttachDestination
>([
  ["this Pokémon", { riders: { toSelf: true }, batch: true }],
  ["1 of your Pokémon", { riders: {}, batch: false }],
  ["1 of your Benched Pokémon", { riders: { benchOnly: true }, batch: false }],
  ["your Pokémon in any way you like", { riders: {}, batch: true }],
  ["your Benched Pokémon in any way you like", { riders: { benchOnly: true }, batch: true }],
  // Generated from the schema's own type table rather than listed, so a type
  // added there is admitted here by construction (D234's rule, one op over).
  // Both forms, because the family prints both shapes of every other phrase —
  // 0 legal printings today and read anyway: *an arm transfers across sets and a
  // registry row does not* (D180/D187).
  ...Object.entries(POKEMON_TYPE_BY_CODE).flatMap(
    ([code, type]) =>
      [
        [`1 of your {${code}} Pokémon`, { riders: { targetType: type }, batch: false }],
        [
          `your {${code}} Pokémon in any way you like`,
          { riders: { targetType: type }, batch: true },
        ],
      ] as [string, DeckSearchAttachDestination][],
  ),
]);
// Groups: 1 the SINGULAR branch's brace code, 2 the printed count, 3 the PLURAL
// branch's brace code, 4 the destination phrase, 5 the §9.2 poison tail. The
// PRONOUN is welded to the grammatical number on both halves ("a … Energy card
// and attach **it**" / "up to N … Energy cards and attach **them**"), so the
// crossed forms no card prints cannot match — `ATTACK_HAND_SEARCH`'s and
// `DISCARD_ATTACH`'s weld, for the third time. The code class is built FROM
// `ENERGY_TYPE_BY_CODE`'s keys so the regex cannot admit a code the map will not
// resolve.
//
// ⚠️ THE DESTINATION CLASS IS `[^.]` AND THE TRAILING `$` IS SEPARATELY
// LOAD-BEARING — which is D234's surviving-mutant lesson applied rather than
// re-learned. Here the capture is bounded on BOTH sides (the literal ". Then,
// shuffle your deck." follows it), so the class is not what makes `$` observable;
// the optional tail group is. Without `$`, "…to 1 of your Pokémon. Then, shuffle
// your deck. Draw a card." would derive — the group simply would not match and
// the unread clause would be silently dropped. A dropped-`$` mutant is driven.
const DECK_SEARCH_ATTACH = new RegExp(
  `^Search your deck for (?:a Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy card and attach it` +
    `|up to (\\d+) Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy cards and attach them)` +
    ` to ([^.]+)\\. Then, shuffle your deck\\.(?: (${DECK_SEARCH_POISON_TAIL}))?$`,
);

// ⚠️⚠️ D236 — ATTACH FROM THE **HAND** (backlog row 12), THE EXACT MIRROR OF
// D234'S ANCHOR ONE WORD OVER, AND THE **CONTROL** FOR D235'S OWN FINDING. That
// is what this arm is for, and its printings are the smaller half of what it
// bought.
//
// ✅ THE COUNT RE-DERIVES TO THE DIGIT, AND FOR THE THIRD ROW RUNNING THE WHOLE
// ROW DOES. Remote D1 `luminous`, `legal_standard = 1`, `json_each` over
// `attacks_json`/`abilities_json` PLUS the bare `effect` column, GLOB (never
// LIKE), GROUPED BY SENTENCE, on 2026-08-06:
//
//   WHERE t GLOB '*ttach*Energy card*from your hand*' GROUP BY col;
//   -- attack 16 / 8 · ability 29 / 8 · effect 0 / 0
//
// The row says **16 (8 sentences) · 10 · 0**. The attack half is EXACT on both
// figures; the ability half is 29 minus the 19 already authored (Teal Dance's
// 8-printing sentence, Iono's 5, Ethan's 4, and the two `sv10.5w` reprints), and
// the Trainer column is genuinely empty — the first row on the page whose third
// figure is a measured ZERO rather than a subtraction. **26 = 26.**
//
// 🛑 D235'S PREDICTION, GRADED — AND IT IS THE REASON THIS ROW WAS TAKEN NEXT.
// D235 found that *"a destination table is not portable between two ops just
// because its keys are"*, and wrote row 12 down as the control: SAME op, so the
// table SHOULD be portable. It is:
//
//   • ✅ `DISCARD_ATTACH_DESTINATIONS` is reused **VERBATIM** — not one new key,
//     not one changed rider, and the destination this family prints that D234's
//     own pool never legally printed ("1 of your Pokémon", 0 legal there, **2
//     legal here**) works on the first run. **The rule survives as stated: the
//     blocker was the OP, never the phrases.**
//   • 🛑 …and the PORTABILITY BOUGHT ALMOST NOTHING, which is the finding this
//     slice adds. **A SOURCE-ZONE MIRROR TRANSFERS THE ANCHOR, NOT THE FAMILY.**
//     D234 read 12 of 17 with this shape; the same shape reads **6 of 16** here,
//     because the two zones are printed in DIFFERENT GRAMMAR: the discard side
//     spells bare imperatives, and the hand side wraps them in *"You may …"*,
//     *"any number of"*, *"Before doing damage, …"* and *"Switch this Pokémon
//     … If you do, …"*. Six of this row's sixteen printings are blocked by a
//     LEADING CLAUSE or an UNBOUNDED COUNT — categories the discard side does
//     not print at all. **The ratio a family earned in one zone does not
//     transfer with its anchor.**
//   • ✅ The third clause of the prediction — *"the residue is about the NOUN,
//     not the destination"* — holds exactly: every one of the seven printings
//     this arm refuses names a destination the table already spells.
//   • 🛑 The prediction's *"`count` covers every plural '1 of' printing"* is
//     **VACUOUSLY** true and is recorded as such: no attack printing in this
//     family spells "up to N … to 1 of your …" at all, so the field that was
//     D235's whole blocker has nothing to do here. **A control can be
//     unexercised as well as wrong**, and reporting that is the difference
//     between grading a prediction and confirming one.
//
// 🛑 AND THIS SLICE'S OWN PREDICTION WAS PART WRONG THE OTHER WAY: it said
// "1 anchor + 1 optional trailing group, ZERO new op FIELDS", for **9 of 16**.
// The count and the arms held; **the field did not.** The heal tail is NOT free
// — see `attachEnergyFrom.healTarget` for why `recordGate` → `healChosen` plays
// a rule the card does not print — so this row costs ONE new op field, the first
// in three slices. Two slices in a row have now over-predicted freeness by
// exactly one mechanism.
//
// ⚠️ THE READ-SITE PRICE, GREPPED RATHER THAN INHERITED:
//   · `programPlayable` (cardplay.ts) — ZERO for this slice, but NOT for the
//     reason D234/D235 gave. `attachEnergyFrom` IS gated there, and the hand is
//     a zone the gate can genuinely find empty; it prices at zero only because
//     §8 says an attack is already declared and paid for. The row's ABILITY half
//     is 10 card plays and does not get this for free. Driven both directions.
//   · `preventBlock.test.ts` §11 — ZERO, confirmed by grep: `attachEnergyFrom`
//     was classified at D234 and `healTarget` heals the CONTROLLER's own body,
//     which no §11 shield addresses.
//   · `counterBenchPut.test.ts` — already partitioned at D234 (this op's
//     `source` is a ZONE, not an actor), and `"hand"` is the same shape as
//     `"discard"`. Re-checked, not assumed.
//   · `redact.ts` / `log.ts` / both HUD row-lighting mirrors / `projection.ts` —
//     ZERO: no new prompt, no new event (the heal emits the `HEALED` row those
//     sites have carried since M3), no new op.
/** The printed §9.2 tail on the hand side, kept as a constant for
    `DECK_SEARCH_POISON_TAIL`'s reason: it is the one part of the anchor a mutant
    can delete without breaking the sentence, so it needs somewhere to land.

    ⚠️ NOT A `recordGate`. The clause names *"**that** Pokémon"* — the body the
    attach already chose — and the record files ENERGY uids, so a gate could only
    reach `healChosen`, which asks a SECOND question. See
    `attachEnergyFrom.healTarget`. */
/** ⚠️⚠️ D246 WIDENED IT TWICE, AND BOTH WIDENINGS ARE MEASURED RATHER THAN
    ANTICIPATED. The whole `*If you do, heal*` family is TWO sentences and 4
    legal printings (remote D1 `luminous`, all three text columns, GLOB, grouped
    by sentence, 2026-08-06) — D236's three Lilligant printings and Snorlax
    `sv06-136` *"Attach an Energy card from your hand to this Pokémon. **If you
    do, heal 60 damage from this Pokémon.**"*. So the two axes this tail now
    carries are exactly the two the catalog spells and no more:

      • **the AMOUNT** — `all` or a printed number. `healTarget` has taken
        `number | "all"` since D236, where the numeric arm was driven at the OP
        level only because no DERIVER path reached it. This is that path.
      • **the PRONOUN** — "that Pokémon" or "this Pokémon", CAPTURED and then
        CHECKED, which is the one part of this widening that is a rule rather
        than a spelling.

    🛑 **"THIS" AND "THAT" ARE NOT SYNONYMS HERE, AND CONFLATING THEM WOULD BE A
    SILENT WRONG-BODY BUG.** *"that Pokémon"* corefers with the body the ATTACH
    just chose; *"this Pokémon"* is the attacker (§8). They name the same body
    only when the attach itself was aimed at the attacker — the printed *"to this
    Pokémon"*, i.e. `toSelf`. On `sv06-136` they do coincide, which is why the
    numeric printing is readable at all. A printing that said *"…to 1 of your
    Benched Pokémon. If you do, heal 60 damage from **this** Pokémon."* would heal
    the ATTACKER while the engine healed the Bench body, and every "was something
    healed" assertion would still pass. So the pronoun is refereed against the
    destination in the arm and the crossed form is REFUSED to the loud
    ATTACK_EFFECT_SKIPPED path (0 printings today; the guard is what keeps a
    future one from deriving a rule nobody printed).

    ⚠️ NO CEILING CONSTANT ON THE `\d+`, UNLIKE `MAX_PRINTED_ATTACH_COUNT` ONE
    CLAUSE OVER, and the difference is what the number SIZES. The attach count
    sizes a program (the `anyWay` branch emits one op per unit) and a prompt; a
    heal amount sizes neither — `healChosen` clamps it to the damage actually on
    the body, so a malformed third-party 9,999 heals exactly what is there and
    then stops. A guard here would refuse a printing to re-assert a clamp that
    already holds.

    ⚠️ STILL NOT A `recordGate`. The clause names ONE already-chosen body, and
    the record files ENERGY uids, so a gate could only reach `healChosen`, which
    asks a SECOND question. See `attachEnergyFrom.healTarget`. */
const HAND_ATTACH_HEAL_TAIL = "If you do, heal (?:all|(\\d+)) damage from (that|this) Pokémon\\.";
const HAND_ATTACH = attachFromZoneAnchor(
  HAND_SOURCE_ZONE_PHRASE,
  `(?: (${HAND_ATTACH_HEAL_TAIL}))?`,
);
/** ⚠️⚠️ D247 — ALOLAN EXEGGUTOR EX "TROPICAL FRENZY", backlog row 12's largest
    single sentence and the last thing that row owed apart from its two-mechanism
    outlier. *"You may attach **any number of** Basic Energy cards from your hand
    to your Pokémon in any way you like."* — **4 legal printings on 1 sentence**
    (`sv08-133`/`-225`/`-242`/`-248`; remote D1 `luminous`, 2026-08-06).

    🛑 **A SEPARATE ANCHOR RATHER THAN A THIRD BRANCH IN `attachFromZoneClause`,
    AND THE REASON IS THAT IT EMITS A DIFFERENT OP.** The factory's three branches
    ("an Energy card" / "a Basic {X} Energy card" / "up to N Basic {X} Energy
    cards") all feed `attachFromZoneProgram`, which builds `attachEnergyFrom` —
    one op per printed unit on the `anyWay` destinations, one `count`-pinned op
    otherwise. Both readings need a printed N. **"Any number" names none**, so a
    fourth branch would have to return `null` from that builder for every match it
    made, which is a branch that exists to be refused. This sentence's op is
    `attachFromHand` and its own anchor is what says so.

    ⚠️ **THE `You may ` OPENER IS REQUIRED, NOT OPTIONAL, AND THAT IS MEASURED.**
    Every catalog sentence pairing "any number" with the hand prints it
    (`sv08-133`'s four and `sv04.5-067`, rotated); the bare-imperative form is
    never printed, and admitting it would let the arm read a sentence whose
    mandatory/optional distinction the print never draws. A decline is legal
    either way — the park is declinable by construction — so the word costs the
    player nothing and buys the reader falsifiability.

    ⚠️ THE DESTINATION IS A `([^.]+)` CAPTURE RESOLVED THROUGH
    `DISCARD_ATTACH_DESTINATIONS`, and it is the FIRST reuse of that table by an
    op that is not `attachEnergyFrom`. That is the exact pricing error D235 made
    in reverse, so it is argued rather than assumed: the table's `riders` are
    `AttachTargetRiders`, which every attach op shares, and its `anyWay` flag
    means *"the cards may land on different bodies"* — a claim about the PRINT,
    true on both ops, which the two merely ENCODE differently (N ops there, one
    compound park here). What is NOT portable is the `anyWay: false` half: those
    phrases name ONE body, and a compound park over an unbounded count aimed at a
    single Pokémon is a question no card asks. They are **refused** here rather
    than reinterpreted — `toSelf`, "1 of your Pokémon" and the brace-coded
    singulars all derive to null, and each is driven.

    ⚠️ THE `$` IS LOAD-BEARING AND THE `[^.]` CLASS IS WHAT MAKES IT OBSERVABLE
    (D234's dropped-`$` mutant, inherited a third time): with the class narrowed
    to the sentence, a build with no `$` MATCHES a trailing printed clause and
    silently drops it, so the mutant dies on a driven near-miss rather than
    surviving. Group 1 is the brace code, group 2 the destination phrase. */
const ATTACK_HAND_ANY_NUMBER_ATTACH = new RegExp(
  `^You may attach any number of Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy cards${HAND_SOURCE_ZONE_PHRASE} to ([^.]+)\\.$`,
);
/** ⚠️⚠️ D246 — KILOWATTREL EX `sv08-068` "RETURN CHARGE", AND THE FIRST ANCHOR IN
    THIS FAMILY WHOSE SENTENCE DOES NOT START WITH THE VERB. *"Switch this Pokémon
    with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy
    cards from your hand to this Pokémon."* — **1 legal printing, 1 sentence**
    (remote D1 `luminous`, 2026-08-06; the same antecedent carries 3 further
    sentences, one legal and BUILT at D227 — Iron Bundle — and two rotated).

    ✅ **THE BACKLOG CELL'S "EVERY OP IT NEEDS EXISTS" SURVIVES**, which is the
    first time that sentence has been right in five printings of it on that page.
    `switchActive {recordAs}` → `recordGate` → `attachEnergyFrom {count, toSelf}`
    is D206's authored shape verbatim with the consequent swapped, so this arm
    buys ZERO ops and ZERO op fields — and the fields were checked rather than the
    NAMES (D245's lesson): `toSelf` reads `sourceRef`, which finds the attacker
    **wherever it sits**, and that is load-bearing here in a way it has never been
    before. Every previous `toSelf` printing feeds a body that has not moved. This
    one SWITCHES ITSELF TO THE BENCH FIRST and then attaches to itself there, so
    the printed "this Pokémon" and the Active Spot are different things for the
    length of one program. Driven, not argued.

    ⚠️ THE ANTECEDENT IS `ATTACK_SELF_SWITCH`'s SENTENCE, spelled here as a
    constant shared with it so the two cannot drift into disagreeing about what
    the self-switch says — and with NO apostrophe class, for D189's measured
    reason: neither self-switch sentence contains an apostrophe at all.

    ⚠️ AND THE GATE IS LOAD-BEARING RATHER THAN DECORATION, exactly as Iron
    Bundle's is: an attacker with an EMPTY BENCH cannot switch, `switchActive`
    files nothing, `recordGateHolds` reads the empty slot as false, and NO ENERGY
    IS ATTACHED. Pricing the two ops and not the gate — which both `needs` cells
    this slice was handed did — builds a card that accelerates on a board where
    the printed one does nothing.

    ⚠️ NO HEAL TAIL, and that is measured: the `*If you do, heal*` family is two
    sentences, both bare imperatives. An empty `tail` is the same argument D234's
    discard side carries. */
const ATTACK_SELF_SWITCH_THEN_HAND_ATTACH = new RegExp(
  `^Switch ${SELF_SWITCH_CLAUSE} If you do, attach ${attachFromZoneClause(HAND_SOURCE_ZONE_PHRASE, "")}$`,
);
/** ⚠️⚠️ D246 — THE ONE READER FOR EVERY ANCHOR `attachFromZoneClause` BUILDS,
    EXTRACTED THE MOMENT THERE WERE THREE OF THEM. D234 wrote this body once and
    D236 copied it one zone over; a third copy for the gated printing would have
    been the point at which "the three anchors emit the same program" stopped
    being checkable. The clause is ONE string and this is ONE reader of it, so a
    field added to either reaches all three by construction — which is how the
    bare noun below reaches the DISCARD side for free.

    Returns `null` for anything the clause matched but this reader cannot resolve
    — an unspellable destination, an unmapped brace code, a printed count outside
    the ingested-text guard, or a crossed heal pronoun — and every one of those
    falls through to the loud ATTACK_EFFECT_SKIPPED path rather than deriving a
    half-read program.

    `heal` is the caller's already-parsed tail: `undefined` for the two anchors
    that carry none, and `{ amount, pronoun }` for the hand anchor's optional
    group. It is refereed HERE rather than at the call site because the check it
    needs is the DESTINATION, which only this function resolves. */
function attachFromZoneProgram(
  match: RegExpExecArray,
  source: "hand" | "discard",
  heal?: { amount: number | "all"; pronoun: string },
): EffectOp[] | null {
  const destination = DISCARD_ATTACH_DESTINATIONS.get(match[5] ?? "");
  // Exactly one of the three branches matched, so at most one code group is set.
  const code = match[2] ?? match[4];
  const energyType = code === undefined ? undefined : ENERGY_TYPE_BY_CODE[code];
  // The printed bare noun — "an Energy card" rather than "a Basic Energy card"
  // (D246). The marker is the article the print welds to the noun, so its
  // presence IS the narrowing question and nothing has to be inferred from the
  // absence of a brace code (which the untyped Basic branch also lacks).
  const anyEnergy = match[1] !== undefined;
  // The absent count IS the article — `ATTACK_DRAW`'s reading, and D205's
  // "absent = 1" on the field, which is why a singular printing emits the op
  // with NO `count` rather than with `count: 1`: those rows are compared by
  // value against hand-authored registry ones.
  const count = match[3] === undefined ? 1 : Number(match[3]);
  if (destination === undefined) return null;
  if (code !== undefined && energyType === undefined) return null;
  // A printed 0 is not a real card and would derive to a silent no-op; the
  // ceiling is the ingested-text guard `MAX_PRINTED_FLIPS` carries one reader
  // over, and it is load-bearing on the `anyWay` branch specifically — that
  // branch grows the PROGRAM one op per printed unit, so an unbounded `\d+`
  // would let one malformed third-party row build an arbitrarily long program.
  // Applied to every branch so the three anchors cannot disagree about what
  // counts as a printed number.
  if (count < 1 || count > MAX_PRINTED_ATTACH_COUNT) return null;
  // 🛑 THE TWO CONDITIONS THAT ARE ABOUT THE PROGRAM RATHER THAN THE TEXT.
  //   • The heal names ONE body. A distribution is N independent decisions
  //     landing on N bodies, so a tail on one would have to pick which — a
  //     question the sentence does not ask (D236).
  //   • And the printed PRONOUN must corefer with the body the attach chose
  //     (D246): "that Pokémon" always does; "this Pokémon" is the ATTACKER, so
  //     it does only when the attach was aimed at the attacker in the first
  //     place — the printed "to this Pokémon", i.e. `toSelf`. The crossed form
  //     would heal a different body than the one it fed, and would pass every
  //     "was something healed" assertion while doing it.
  // Both refuse to the loud ATTACK_EFFECT_SKIPPED path (0 printings today; the
  // guards are what keep a future one from deriving a rule nobody printed).
  if (heal !== undefined && destination.anyWay && count > 1) return null;
  if (heal !== undefined && heal.pronoun === "this" && destination.riders.toSelf !== true) {
    return null;
  }
  // 🛑 D248 — THE TWO CROSSES THE **SPREAD** DESTINATION REFUSES, and they are
  // refusals about the PRINT rather than about the code (both are expressible at
  // the op level, and a registry program may spell either deliberately).
  //   • "attach **up to N** … to each of them" is AMBIGUOUS IN PRINT — N per
  //     body, or N shared out across them? No catalog sentence spells it (the
  //     rotated Glass Trumpet prints "a … card", singular, behind a leading
  //     "Choose up to 2 of your Benched {C} Pokémon"), so the deriver picks
  //     NEITHER reading and falls to the loud ATTACK_EFFECT_SKIPPED path.
  //   • A heal tail is `destination.anyWay`'s refusal one distribution over and
  //     for the identical reason: "that Pokémon" names ONE body, and a spread
  //     fed N of them, so the pronoun has no referent. `anyWay` is checked at
  //     `count > 1` because at count 1 it degenerates to a single op; a spread
  //     does NOT degenerate — it is N bodies even at count 1 — so this guard
  //     carries no count clause, which is the one byte separating the two.
  if (destination.toEach === true && count > 1) return null;
  if (destination.toEach === true && heal !== undefined) return null;
  const base: Extract<EffectOp, { op: "attachEnergyFrom" }> = {
    op: "attachEnergyFrom",
    source,
    ...(energyType === undefined ? {} : { energyType }),
    ...(anyEnergy ? { anyEnergy: true as const } : {}),
    ...destination.riders,
    ...(destination.toEach === true ? { toEach: true as const } : {}),
    ...(heal === undefined ? {} : { healTarget: heal.amount }),
  };
  // "in any way you like" → N ops, each parking on its OWN target (Koraidon ex
  // "Dino Cry"'s authored shape, verbatim); otherwise ONE op whose `count`
  // pins the whole batch to the single body the print names. A print is one or
  // the other, never both (D205).
  return destination.anyWay
    ? Array.from({ length: count }, () => ({ ...base }))
    : [count === 1 ? base : { ...base, count }];
}

// ⚠️⚠️ D237 — THE DISCARD PILE INTO THE **HAND** OR ONTO THE **BENCH** (backlog
// row 13), and the FOURTH row running whose count re-derives to the digit — but
// the FIRST whose *edit estimate* was short by a whole op destination.
//
// RE-DERIVED (never inherited) against the remote D1 `luminous` — 3,786 rows /
// 20 sets, 2,021 `legal_standard = 1` — on 2026-08-06, `json_each` +
// `json_extract(value,'$.effect')`, GROUPED BY SENTENCE, over ALL THREE text
// columns:
//
//   SELECT col, COUNT(*) printings, COUNT(DISTINCT t) sentences FROM u
//     WHERE t GLOB '*[Pp]ut*from your discard pile*' GROUP BY col;
//   -- attack 16 / 8 · ability 4 / 2 · effect 8 / 5
//
// **The row's `16 (8 sentences) · 4 · 3` is EXACT**: the attack half on BOTH
// figures, the ability half raw, and the Trainer half the 8 above minus the 5
// already authored (`sv06.5-061`/`sv08-251`, `sv08.5-116`, `sv08-183`,
// `sv10.5w-082`). **23 = 23**, four rows running.
//
// 🛑 THE PREDICTION, WRITTEN BEFORE THE FIRST REGEX, AND ITS GRADE. The resume
// point left one so a successor could falsify it: *"printed grammar is a
// property of the ZONE, so this row's residue should look like row 9's (bare
// imperatives, blockers in the OP) rather than row 12's (leading clauses,
// unbounded counts) — the arm reaches ≥ 12 of the 16 and every blocker is a NOUN
// the table cannot name."*
//   • 🛑 **THE ≥ 12 CLAUSE LOSES. The arm reads 10 of the 16**, and no arm could
//     have reached 12: even a build that also spelled the brace codes stops at
//     14, because 2 of the 16 are a leading "Flip 3 coins." that
//     `deriveAttackCoinFlip` — a different reader — would own.
//   • ✅ **THE "every blocker is a NOUN" CLAUSE HOLDS FOR 4 OF THE 6**: the {W}
//     Pokémon (3) and the Basic {G} Energy (1) are both the printed BRACE CODE,
//     which is one blocker wearing two nouns and is SHARED with
//     `derivedHandSearch`'s own residue one family over.
//   • 🛑 **AND THE UNDERLYING CLAIM IS FALSE AS D236 STATED IT.** D236 wrote that
//     the leading-clause and unbounded-count categories are ones *"the discard
//     side does not print even once"*. The discard side prints one of them TWICE,
//     in both verbs: *"**Flip 3 coins.** Put a number of cards up to the number
//     of heads from your discard pile into your hand."* here, and *"**Flip 3
//     coins.** Attach a number of Basic {L} Energy cards up to the number of
//     heads from your discard pile…"* in D234's own residue table. 🆕 **So the
//     leading clause is a property of NEITHER the zone NOR the verb — it is a
//     property of the per-heads FOLD, which recurs across both** and is the same
//     unanswered `attack.ts` question D234 named and did not answer.
//
// WHAT THIS ANCHOR READS — 10 of the 16 legal printings, on 5 of the 8 sentences:
//   • "Put a Supporter card … into your hand."            **3** (`sv06-055`,
//     `sv06-175`, `sv09-124`)
//   • "Put up to 3 Duskull … onto your Bench."            **3** (`sv06.5-018`,
//     `sv06.5-068`, `sv08.5-035`) — the NAME group AND the new destination
//   • "Put up to 2 Pokémon … into your hand."             **2** (`sv06-019`,
//     `sv08-010`)
//   • "Put a Pokémon … into your hand."                   **1** (`sv07-057`)
//   • "Put a Trainer card … into your hand."              **1** (`sv08-087`) —
//     the new `trainerCard` member
// The six it refuses are pinned derived-to-null in `derivedDiscardRetrieval.test.ts`
// with the reason, and written back to the backlog as a measured residue row.
//
// ⚠️ AND THE ARM IS FAR WIDER THAN THE LEGAL POOL — **26 of the family's 39
// CATALOG printings, on 12 of its 18 sentences** (same GLOB, `legal_standard`
// dropped). The twelve are the five above plus seven that differ only in a table
// NOUN or a count: "an Item card" (5), "a Pokémon … onto your Bench" (3), "up to
// 2 Item cards" (2), "up to 2 Basic Energy cards" (2), "a Basic Energy card" (2),
// "up to 4 Pokémon" (1) and "up to 3 Basic Energy cards" (1). *An arm transfers
// across sets and a registry row does not* (D180/D187), and this is the widest
// legal-to-catalog spread any row on the D233 page has shown: **10 legal, 26
// catalog.** ⚠️ **THE BENCH DESTINATION IS NOT A ONE-SENTENCE FIELD EITHER** —
// "Put a Pokémon from your discard pile onto your Bench." is 3 catalog printings
// with a TABLE noun rather than a name, so the two axes are independent in print
// and not only in this code.
//
// 🛑 THE ONE THING THE ROW'S EDIT ESTIMATE MISSED, AND IT IS AN OP FIELD RATHER
// THAN AN ANCHOR. The row said *"~1 anchor + a noun table"*. The noun table was
// already BUILT — `HAND_SEARCH_NOUNS` (D231) is exactly it, one row short — so
// the estimate over-counted there and under-counted by a whole
// `discardPileRetrieval.dest` member, its `retrieveMove` arm, its bench-space
// clamp, its `DISCARD_RETRIEVED` event value and the `log.ts` row that would
// otherwise have rendered a Bench put as *"shuffled … into their deck"*. **Two
// slices running have now under-priced by exactly one mechanism** (D236's
// `healTarget`), and both were found by building rather than by reading.
//
// ⚠️ READ SITES, PRICED BY GREP RATHER THAN INHERITED (the row's own claim
// re-measured and CONFIRMED: `discardPileRetrieval` appears in none of
// `cardplay.ts`, `preventBlock.test.ts` or `log.ts` by name):
//   • `programPlayable` — **ZERO, and for §8's reason rather than the row's.**
//     The row priced an arm here because *"its Ability printings can genuinely
//     whiff on an empty discard pile"*; that is true and it is about the row's
//     ABILITY half, which this slice does not take. Attacks never consult the
//     gate (§8: the attack is declared and paid for), so the attack half pays
//     nothing — the same reading D234 and D236 each priced correctly.
//   • `preventBlock.test.ts` §11 — **owes a row and a driven probe**, because
//     the table is TOTAL over the ops the deriver can emit. `untouched`: the
//     zones are the ACTOR's own discard pile, hand and Bench, and a §11 block
//     protects a body from what an attack does TO it.
//   • `log.ts` — **owes a THIRD arm, and it is a live mis-render rather than a
//     latent one**: the existing row is a binary `dest === "hand" ? … : …`, so a
//     Bench put would have announced itself as a shuffle into the deck.
//   • `redact.ts` — **ZERO**: the `chooseCards` prompt is redacted by kind, and
//     its own `dest` union has spelled `"bench"` since `searchDeck`.
//   • both HUD row-lighting mirrors and `projection.ts` — **ZERO** (neither reads
//     this op; measured by grep).
//   • `counterBenchPut.test.ts` — **ZERO**: its sweep is over ops carrying a
//     string `source`, and this op has none. (D234 paid that one by surprise.)
/** The printed DESTINATION phrases this family spells, each with the op `dest`
    it means. TWO ROWS, AND THE ABSENT THIRD IS THE MEASUREMENT: the op also
    carries `dest: "deck"` (Pal Pad, Super Rod) and **no attack sentence in the
    catalog spells it** — those are printed as *"Shuffle … into your deck"*, a
    different verb and therefore a different family (D232's rule). The table is
    authored off the bytes, not off the union.

    A `Map` for D115's reason (the key is arbitrary PRINTED text, and an object
    lookup on arbitrary text can hit `Object.prototype`), and consulted with a
    whole captured phrase so an UNRESOLVABLE destination yields `undefined` and
    falls through to the loud ATTACK_EFFECT_SKIPPED path. */
const DISCARD_RETRIEVAL_DESTINATIONS: ReadonlyMap<string, "hand" | "bench"> = new Map([
  ["into your hand", "hand" as const],
  ["onto your Bench", "bench" as const],
]);
/** The `CardFilter` kinds a BENCH destination may carry — the guard that keeps a
    printed noun the Bench cannot hold out of a program that would put it there.

    🛑 **IT LIVES HERE RATHER THAN IN THE INTERPRETER, WHICH IS `searchDeck`'s
    PRECEDENT AND IS NAMED ON THE OP.** Nothing downstream checks that a benched
    card is a Pokémon; `searchDeck` has had `dest: "bench"` since M5 and relies on
    the same upstream discipline. What is new here is that a DERIVER — not a human
    author — now picks the destination out of printed text, so the check has to be
    mechanical: every sentence that benches names a Pokémon noun, and a
    constructed "Put a Supporter card from your discard pile onto your Bench."
    must derive to NULL rather than to a program that benches a Supporter.

    `byName` is in the set and is the one member that is not PROVABLY a Pokémon:
    the printed named sentences are all Pokémon ("up to 3 Duskull"), and a name is
    a name. That is the same width `searchDeck`'s own bench arm takes. */
const BENCHABLE_RETRIEVAL_KINDS: ReadonlySet<CardFilter["kind"]> = new Set<CardFilter["kind"]>([
  "anyPokemon",
  "basicPokemon",
  "evolutionPokemon",
  "ownerPokemon",
  // ⚠️ D238 — and this row is what the guard was WAITING FOR rather than a
  // widening of it. Until now every benched sentence this arm read carried a
  // noun a human had already put in the set; "Put up to 3 {W} Pokémon … onto
  // your Bench." (3 legal, the row's largest single sentence) is the first one
  // whose filter the DERIVER builds out of a code, and forgetting this line is
  // the mistake that costs those 3 printings silently — the arm would match, the
  // guard would refuse, and the card would land on the skipped path looking
  // exactly like an unread sentence.
  "typedPokemon",
  "byName",
]);
/** The two printed noun ALTERNATIONS, built FROM `HAND_SEARCH_NOUNS` rather than
    listed beside it — so a row added to that table is admitted here by
    construction and the two families cannot drift apart on a noun.

    ⚠️ **THE TABLE PHRASE IS AN ALTERNATIVE IN THE REGEX, NOT A `[^,.]+?` CAPTURE
    RESOLVED AFTERWARDS, AND THAT IS WHAT MAKES THE `byName` GROUP POSSIBLE.**
    `ATTACK_HAND_SEARCH` can afford the lazy capture because it has ONE noun
    group; this anchor needs TWO on the plural branch (a table phrase, or a proper
    NAME) and a lazy `[^,.]+?` would swallow "Duskull" before the name branch was
    ever tried. Ordering the alternatives table-first is what keeps "Pokémon" —
    which also matches the name class — a `anyPokemon` rather than a card called
    Pokémon. So the dispatch is on WHICH GROUP MATCHED (`DAMAGE_SUPPRESSION`'s
    rule) and the table lookup only resolves a phrase the regex already admitted.

    Every phrase in the table is letters, spaces and "é" — asserted, because a row
    carrying a regex metacharacter would silently change what this anchor reads
    rather than fail to compile.

    ⚠️ **D238 APPENDS THE BRACE-CODED FRAGMENT RATHER THAN MORE TABLE ROWS**, and
    the ORDER is load-bearing in the same direction as everything else here: the
    table's literal phrases are tried first, so a printed "Pokémon" is still
    `anyPokemon` and the pattern only ever sees text no row claimed. The fragment
    is APPENDED rather than interleaved because a table phrase can never be a
    prefix of a brace phrase (every brace phrase opens with "{" or "Basic {") —
    asserted, not assumed. */
const RETRIEVAL_SINGULAR_ALT = `${HAND_SEARCH_NOUNS.map(([one]) => one).join("|")}|${TYPED_NOUN_SINGULAR}`;
const RETRIEVAL_PLURAL_ALT = `${HAND_SEARCH_NOUNS.map(([, many]) => many).join("|")}|${TYPED_NOUN_PLURAL}`;
/** Groups: 1 the SINGULAR noun phrase (article included, as the table spells it),
    2 the printed count, 3 the PLURAL table phrase, 4 the plural PROPER NAME, 5
    the destination phrase.

    The ARTICLE is welded to the grammatical number exactly as the attach family's
    is — the singular branch's phrases all carry "a"/"an" because the table's
    strings do, and the plural branch carries a count — so the crossed forms no
    card prints cannot match.

    ⚠️ THE NAME GROUP IS A SINGLE CAPITALISED WORD, `ATTACK_BENCH_SEARCH`'s
    `([A-Z][a-zé]+)` re-read rather than re-invented: every named printing in
    either family spells one, and a hyphenated / spaced / apostrophised name falls
    through to the loud skip path rather than being approximated.

    ⚠️ THE DESTINATION CLASS IS `[^.]` AND THE `$` IS LOAD-BEARING — D234's
    dropped-`$` mutant, re-inherited. `[^.]` cannot cross the sentence boundary,
    so a trailing clause leaves the destination capture intact and ONLY the `$`
    refuses it; a greedy `(.+)` would refuse a trailing clause by accident and the
    build with no `$` at all would behave identically. */
const ATTACK_DISCARD_RETRIEVAL = new RegExp(
  `^Put (?:(${RETRIEVAL_SINGULAR_ALT})` +
    `|up to (\\d+) (?:(${RETRIEVAL_PLURAL_ALT})|([A-Z][a-zé]+)))` +
    // ⚠️ `SOURCE_ZONE_PHRASE` IS D234's OWN CONSTANT, SHARED RATHER THAN
    // RE-TYPED. Two families now weld the same printed zone — the attach one
    // verb over and this one — and a re-ingest that changed those bytes must
    // move both or neither. It also keeps every segment of this concatenation
    // INTERPOLATING, which is the only way to satisfy Biome's `useTemplate` and
    // `noUnusedTemplateLiteral` at once (the trap D236 documented).
    `${SOURCE_ZONE_PHRASE} ([^.]+)\\.$`,
);

// ⚠️⚠️ D241 — LOOK AT THE TOP N, backlog row 11. THE COUNT RE-DERIVED TO THE
// DIGIT FOR THE EIGHTH ROW RUNNING, and this time the row's own figure was the
// one under test rather than a fresh one: the doc says **15 attack printings on
// 7 sentences** and the query returns 15 on 7.
//
//   ```sql
//   -- remote D1 `luminous`, legal_standard = 1, 2026-08-06, GROUPED BY SENTENCE
//   SELECT json_extract(j.value,'$.effect') AS s, COUNT(*) n, GROUP_CONCAT(c.id)
//     FROM cards c, json_each(c.attacks_json) j
//    WHERE c.legal_standard = 1
//      AND json_extract(j.value,'$.effect') GLOB '*[Ll]ook at the top*'
//    GROUP BY s ORDER BY n DESC;
//   -- 3 · 3 · 3 · 2 · 2 · 1 · 1 = 15 printings on 7 sentences
//   ```
//
// ⚠️ AND THE VERB WAS SWEPT WIDER THAN THE ROW (D239's rule, paid for the third
// slice running): the same sweep re-run for `'*top card of your deck*'`,
// `'*top card of your opponent*'`, `'*[Rr]eveal*deck*'` and `'*top * cards of*'`
// with the row's own GLOB EXCLUDED returns 32 further sentences, and **not one
// of them is this family**. They are the MILL (`discardDeckTop`, arm 15 —
// "Discard the top N cards of your [opponent's] deck", 20 printings), the deck
// SEARCH's printed reveal (`searchDeck`, ~33 printings), row 16's copy-an-attack
// ("Reveal the top 10 cards of your opponent's deck…", 3) and two damage SCALERS
// over a revealed window. **"Look at" and "Reveal" are different verbs and they
// select different ops** — D232's noun-vs-verb rule holding on the other side.
//
// WHAT THESE THREE ANCHORS READ — **10 of the 15 legal printings, on 4 of the 7
// sentences**:
//   • "…and attach any number of Energy cards you find there to your Pokémon in
//     any way you like."                       **3** (Lapras ex `svp-164`,
//     `sv07-032`, `sv07-158`) — `attachFromTop`, an op that has run since M5
//   • "…You may put any number of Pokémon you find there onto your Bench."
//                                              **4** (Reuniclus `sv05-072`,
//     `sv05-171` at the top 8; Tatsugiri ex `sv08-142`, `sv08-226` at the top 10)
//   • "Look at the top card of your deck. You may discard that card."
//                                              **3** (Rockruff `sv09-084`,
//     Litwick `sv10.5w-016`, `sv10.5w-101`)
//
// 🛑 THE FIVE IT REFUSES ARE ONE MECHANISM, NOT FIVE, AND THAT MECHANISM IS A
// PROMPT KIND: "put them back in any order" (4 printings — 3 on the OPPONENT's
// deck, 1 on your own) needs an ORDERED answer, and every prompt this engine has
// answers with a SET; and "You may have your opponent shuffle their deck" (1) is
// a second seat's deck under a "you may". Both are written back to the backlog as
// a measured residue row rather than approximated here.
// 🆕🆕 **D341 TOOK THE FIRST OF THE TWO — ALL FOUR PRINTINGS — AND THIS PARAGRAPH
// IS WHY IT COULD.** The residue was recorded as a MECHANISM with its riders named
// ("an ORDERED answer"; "a `whose` fork and the event's `actor` field arrive with
// those printings and not before"), and four decisions later the slice that spent
// it changed none of that: `reorderTop` + `orderCards` + `side` + `actor`, in that
// order. **A RESIDUE NOTE THAT NAMES THE MECHANISM IS A PRICE A LATER SLICE CAN
// SPEND; THE ONES THAT ROT NAME A CARD.** What is left of this row's refusal is
// the shuffle-consent sentence alone — 1 legal printing (Inkay `sv06.5-033`).
//
// ⚠️ READ SITES, PRICED BY GREP RATHER THAN INHERITED — and the row's own
// predictions lost twice:
//   • `programPlayable` — **ZERO, deliberately.** `lookAtTopN` is not gated and
//     must not be, for `attachFromTop`'s recorded reason (ruling/284): every
//     printing here carries a leftovers clause that always resolves, so "no
//     match up there" is never "no effect". Attacks never consult the gate
//     anyway (§8).
//   • `preventBlock.test.ts` §11 — **owes a row and a driven probe** (the table
//     is TOTAL over the ops the deriver can emit). `untouched`: every zone this
//     op reads or writes is the ACTOR's own deck, Bench, hand and discard pile,
//     and a §11 block protects a BODY from what an attack does to it.
//   • `log.ts` — **NON-ZERO, and a live mis-render rather than a latent one**:
//     the existing arm hard-codes "in hand", so a benched look would have
//     announced itself as a card put in hand. Plus the EMPTY row (the debt).
//   • `redact.ts` — **ZERO, and this is the prediction that LOST.** The resume
//     point predicted non-zero *"for the first time in eight slices"*, on the
//     argument that a deck-top look is a hidden-zone read D232's ruling did not
//     cover. Measured: the `chooseCards` prompt is redacted BY KIND, its `dest`
//     union has spelled `"bench"` and `"discard"` since `payFromHand`, and
//     `redactedPromptOf` resolves candidate identities to the ANSWERER ALONE. The
//     looked-at cards are the controller's own and go back under a shuffle, so
//     there is nothing for the opponent's projection to hold. **D232's precedent
//     transfers to the deck top intact; what did NOT transfer was the log's
//     COVERAGE, and that is where the debt actually was.**
//   • both HUD row-lighting mirrors and `projection.ts` — **ZERO** (neither reads
//     this op or this event; measured by grep).
//   • `MATCH_RECORD_VERSION` — **NO BUMP.** Both diffs are ADDITIONS of optional
//     keys (`EffectOp.dest`, `GameEvent.dest`), events are not persisted at all,
//     and a version-13 record holds every inhabitant it could hold before.
/** "Look at the top {N} cards of your deck. You may put any number of Pokémon you
    find there onto your Bench. Shuffle the other cards back into your deck."

    ⚠️ THE WINDOW IS A `\d+` AND NOT A `.+`, AND THE REASON IS `Number`'s GRAMMAR
    (D240's surviving mutant, inherited): `Number("4e1")` is 40, `Number("0x28")`
    is 40 and `Number("4.5")` is 4.5, so a capture that feeds `Number` and admits
    anything but digits sizes a deck window off a string no printing contains.

    ⚠️ AND THE `$` IS LOAD-BEARING (D234's dropped-`$` mutant, re-inherited). The
    whole sentence is literal after the count, so there is no `[^.]` class to do
    the work here — the anchors at both ends are the ONLY thing refusing a
    trailing printed clause. */
const ATTACK_LOOK_TOP_BENCH =
  /^Look at the top (\d+) cards of your deck\. You may put any number of Pokémon you find there onto your Bench\. Shuffle the other cards back into your deck\.$/;
/** "Look at the top {N} cards of your deck and attach any number of Energy cards
    you find there to your Pokémon in any way you like. Shuffle the other cards
    back into your deck." — `attachFromTop`, which has run since M5 (Electric
    Generator, Hydreigon "Tri Howl") and needed a READER and nothing else.

    ⚠️ **"to your Pokémon" IS THE UNNARROWED TARGET SET AND THE ABSENCE OF THE
    RIDERS IS THE MEASUREMENT.** Electric Generator prints "your **Benched {L}**
    Pokémon" and carries `benchOnly` + `targetType`; this sentence prints neither
    word, so the program carries neither field — D135's rule, and here it is what
    keeps the derived row byte-equal to what a human author would write. */
const ATTACK_LOOK_TOP_ATTACH =
  /^Look at the top (\d+) cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like\. Shuffle the other cards back into your deck\.$/;
/** "Look at the top card of your deck. You may discard that card."

    A `test`, not an `exec`: the window is the printed word "card" (singular), the
    filter is the printed absence of a noun, and the destination is the printed
    verb — nothing varies, so nothing is captured (D138's shape, arm 24's
    precedent).

    🛑 **THE ONE SENTENCE IN THIS FAMILY WHERE THE LOOK IS THE WHOLE POINT**, and
    the reason D241's fidelity fix is not cosmetic: the player looks at one card,
    and the printed "**you may**" means DECLINING is a real, common answer. Before
    this slice that decline emitted no event and no log row at all — an attack
    that resolved, taught its controller the top of their deck, and left no trace
    the opponent could see. */
const ATTACK_LOOK_TOP_DISCARD = /^Look at the top card of your deck\. You may discard that card\.$/;

/** 🆕 **D341 — "Look at the top {N} cards of your [opponent's] deck and put them
    back in any order."** ONE alternation, TWO capture groups, one per printed
    possessive — `RETURN_BENCHED`'s capture-per-arm shape, here for a smaller
    version of its reason: `['’]` cannot live in a map key either, and the two
    sentences differ in nothing else, so a second constant would be two spellings
    of one grammar (the shape this file refuses everywhere else).

    **THE CENSUS THIS ARM IS SIZED BY** (remote D1 `luminous`, 2026-08-15,
    `instr(attacks_json,'deck and put them back in any order') > 0`): **6
    printings, 4 legal.**
      • YOUR deck — Iron Valiant `sv05-080` "Calculation", top **4**. 1 legal.
      • Your OPPONENT's deck — Team Rocket's Dottler `sv10-088` "Disruptive
        Radar" and Gothorita `sv10.5w-042`/`-125` "Fortunate Eye", top **5**.
        3 legal.
      • REFUSED, and by the anchors rather than by a guard: Absol ex `sv03-135`/
        `-214` "Future Sight" prints *"the top 3 cards of **either player's**
        deck"* — a printed SIDE CHOICE, which is a prompt this op does not have
        and a second decision before the ordering one. Both printings are
        `legal_standard = 0`, so building it would be D331's speculative field.

    🛑 **THE WIDER SWEEP, RUN BECAUSE D239's RULE SAYS THE VERB IS SWEPT WIDER
    THAN THE ROW.** `instr(<col>,'in any order') > 0` over ALL THREE text columns
    returns **15 printings / 11 legal / 7 sentences**, of which these 6 are the
    only ones this arm may read. The other five sentences are three different
    mechanisms and NOT this one:
      • *"Search your deck for 2 cards, shuffle your deck, then put those cards on
        top of it in any order."* — Ciphermaniac's Codebreaking `sv05-145`/`-198`/
        `sv08.5-104` (3 legal, `effect`) and Dialga `sv08-135` "Time Manipulation"
        (1 legal, `attacks_json`). A SEARCH, not a look: the ordered cards come out
        of the whole deck and land on a top that was just shuffled.
      • *"Put 2 cards from your hand on the bottom of your deck in any order."* —
        Kofu `sv07-138`/`-165` (2 legal, `effect`). The ordered cards come out of
        the HAND and go UNDER the deck.
      • *"Look at the top 3 cards of your deck and put them back in any order, **or**
        shuffle them and put them on the bottom of your deck."* — Deduction Kit
        `sv08-171` (1 legal, `effect`). **THIS ARM's OWN SENTENCE PLUS A PRINTED
        TWO-ARMED CHOICE**, and the `or` was the whole remaining cost.
        ✅ **PAID AT D344** — `const DEDUCTION_KIT` in `registry.ts`, on
        `reorderTop.otherwise` / `.otherwiseNote` plus one op, and **this list is
        now four sentences built of seven with the two survivors both
        `legal_standard = 0`: the family is CLOSED on Standard.**
      • *"Look at the top 5 cards of your deck and discard any number of them. Put
        the other cards back in any order."* — Raifort `sv06-161`/`sv08.5-142`
        (0 legal). A `lookAtTopN` and a reorder of its LEFTOVERS, in one sentence.
    **The ORDERED ANSWER is the shared piece of all seven; the other four
    sentences each owe a second mechanism on top of it, and this one owes none.**

    ⚠️ THE WINDOW IS A `\d+` AND NOT A `.+`, D240's surviving mutant inherited
    unchanged: `Number("4e1")` is 40 and `Number("0x28")` is 40.
    ⚠️ AND THE `$` IS LOAD-BEARING (D234's dropped-`$` mutant): the whole sentence
    is literal after the count, so the anchors are the only thing refusing a
    trailing printed clause — and here that refusal is LOAD-BEARING RATHER THAN
    HYGIENIC, because Deduction Kit's sentence is this one plus `, or …` and
    Raifort's contains it as a tail. A dropped `$` reads BOTH as this arm and
    silently drops a printed alternative on one and a printed discard on the
    other. */
const ATTACK_REORDER_TOP = new RegExp(
  "^Look at the top (?:" +
    "(\\d+) cards of your deck" +
    `|(\\d+) cards of your opponent['’]s deck` +
    ") and put them back in any order\\.$",
);

/** 🆕🆕 **D342 — "Search your deck for N cards, shuffle your deck, then put
    those cards on top of it in any order."** The BIGGEST remaining member of the
    *"in any order"* family, and the one D341's census ranked first: **4 legal
    printings, ONE byte-identical sentence, TWO columns** — Ciphermaniac's
    Codebreaking `sv05-145`/`-198`/`sv08.5-104` (Supporter, `effect`, registry
    rows) and Dialga `sv08-135` "Time Manipulation" (`attacks_json`, THIS
    anchor). Re-derived at this head rather than inherited: `instr(<col>,'on top
    of it')` over all three text columns returns exactly those 4 rows, all
    `legal_standard = 1`; `instr(<col>,'then put those cards on top')` returns
    the same 4; and `instr(<col>,'on top of your deck')` returns **ZERO** — there
    is no possessive spelling of this destination anywhere in the catalog, so the
    family is CLOSED at four and no wider anchor is being left on the table.

    🛑 **THE PROGRAM IS THREE OPS AND NOT ONE, AND ALL THREE ALREADY EXISTED
    EXCEPT FOR A `dest` INHABITANT.** `shuffleDeck` + `searchDeck { dest:
    "deckTop", exact: true }` + `reorderTop { n }`. The second park is free: a
    PROGRAM has parked twice since D186 (`resumeProgram` → `runProgram(rest)`),
    and the channel between the two answers is the DECK, not a carried field —
    see `searchDeck.dest`'s own doc block for why that dissolves the "a prompt
    whose candidates are the previous answer" price the backlog quoted.

    ⚠️ **THE SHUFFLE IS EMITTED FIRST AND THE PRINT SAYS SECOND** — the argument
    is on the op's `dest` member and it is a proof, not a convenience: the
    search's answer is a set of CARDS, so shuffling before or after removing them
    is the same distribution. Written here as well because a reader of this
    anchor alone would otherwise read a transposed sentence.

    ⚠️ **THE WINDOW IS A `\d+` AND NOT A `.+`**, `ATTACK_REORDER_TOP`'s inherited
    warning: `Number("4e1")` is 40 and `Number("0x28")` is 40, and the shared
    `MAX_PRINTED_LOOK_WINDOW` guard below is what refuses them.
    ⚠️ **AND THE `$` IS LOAD-BEARING RATHER THAN HYGIENIC HERE TOO.** The whole
    sentence is literal after the count, so the anchors are the only thing
    refusing a trailing printed clause — and this family's neighbours are exactly
    the sentences that would be silently swallowed: Kofu's *"…in any order. If
    you put 2 cards…"* and Deduction Kit's *"…in any order, or shuffle them…"*
    each CONTAIN a prefix of the ordered-answer grammar and each owe a second
    mechanism. A dropped `$` reads one of them as this arm and drops a printed
    draw or a printed alternative on the floor. */
const ATTACK_SEARCH_TOP_ORDER = new RegExp(
  "^Search your deck for (\\d+) cards, shuffle your deck, " +
    "then put those cards on top of it in any order\\.$",
);

/** 🆕🆕 **D342 — THE PROGRAM BOTH COLUMNS OF THAT ONE SENTENCE COMPILE TO.**
    Exported and shared rather than transcribed twice, because the sentence is
    printed on an ATTACK (Dialga `sv08-135`, read by the anchor above) and on a
    SUPPORTER (Ciphermaniac's Codebreaking ×3, an authored registry row) — and
    D334's rule about a field owing both of its arms has a twin here: **a
    sentence printed in two columns owes ONE reading.** Two hand-written copies
    are two things that can drift, and nothing in this repo would go red if they
    did; one shared factory cannot drift at all, and the suite still asserts the
    two entry points agree so the sharing is observable from outside.

    🛑 **`shuffleDeck` LEADS.** The print reads *search → shuffle → place*, and
    this list reads *shuffle → search-and-place*. The transposition is sound and
    the argument lives on `searchDeck.dest`: the answer is a SET of cards, so
    shuffling before or after their removal is the same distribution. What it
    BUYS is that `"deckTop"` stays a destination and nothing else — the placement
    op does not secretly shuffle, so the day a printing spells this sentence
    without the middle clause it is expressible by dropping one op.

    🛑 **AND `reorderTop` IS A SEPARATE OP RATHER THAN A RIDER ON THE SEARCH.**
    One op gets one park (D216's correction of D206); two printed decisions —
    *which* cards, then *in what order* — are therefore two ops by the
    architecture's own rule, and the second one's candidates are read off the
    deck the first one just rebuilt. */
export function searchTopOrderProgram(n: number): EffectOp[] {
  return [
    { op: "shuffleDeck" },
    {
      op: "searchDeck",
      // The printed noun is the uncategorised *"cards"* — every card in the deck
      // is a legal find, which is `anyCard`, the same member the no-reveal
      // half of `searchDeck`'s own census correlates with (and the reason NO
      // `reveal` rider appears here: this sentence prints none, and D135 says
      // absent rather than `false`).
      filter: { kind: "anyCard" },
      max: n,
      // 🛑 THE FLOOR, AND IT IS LOAD-BEARING RATHER THAN COSMETIC — see the
      // field's own doc block. Without it a declined or short pick hands the
      // next op an ordering window over cards the player never searched.
      exact: true,
      dest: "deckTop",
    },
    // The printed *"in any order"*, which is `reorderTop`'s whole sentence
    // (D341). `n` and not a fresh number: the window is exactly what the search
    // just placed, and deriving it twice is how the two could disagree.
    { op: "reorderTop", n },
  ];
}

/** 🆕 D299 — THE FOUR PRINTED SPELLINGS OF `returnBenched`, as ONE
    whole-sentence alternation with one capture group per spelling.

    ⚠️ **THE CAPTURE-PER-ARM SHAPE IS `DAMAGE_SUPPRESSION`'s, AND IT IS HERE FOR
    THE SAME REASON**: the possessive apostrophe needs `['’]` (D136/D137) and a
    map key cannot hold a character class, so a captured object plus a literal
    lookup would need `literalClauseRow`. Four groups put the two spellings of
    "opponent's" on ONE arm by construction rather than by a second table.

    ⚠️ **AND UNLIKE `DAMAGE_SUPPRESSION`, ORDER IS *NOT* BEHAVIOUR HERE — because
    every arm is a WHOLE sentence.** That file's ordering note is about a compound
    that CONTAINS its own prefix; `^…$` around a closed alternation makes these
    four mutually exclusive by their first three words, so a reordering is a
    refactor and not a change. Stated rather than assumed, because the next arm
    added here could easily not have that property.

    🛑 **NO `/i` AND NO FLOATING MATCH**, the standing policy of every deriver in
    this file. It is what keeps the FOUR "…this Pokémon and all attached cards…"
    printings (Poliwrath, Gholdengo, Eldegoss, Lillie's Comfey) and Sylveon ex's
    two-target compound OFF this path: each of them contains one of these clauses
    as a fragment, and each needs a mechanism this op does not have. */
const RETURN_BENCHED = new RegExp(
  "^(?:" +
    `(Shuffle 1 of your opponent['’]s Benched Pokémon and all attached cards into their deck)` +
    "|(Shuffle 1 of your Benched Pokémon and all attached cards into your deck)" +
    "|(Put 1 of your Benched Pokémon and all attached cards into your hand)" +
    `|(Flip a coin\\. If heads, choose 1 of your opponent['’]s Benched Pokémon\\. ` +
    "Shuffle that Pokémon and all attached cards into their deck)" +
    ")\\.$",
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

  // 5b-i. §7.1/§7.2 (D283) — THE TURN-SCOPED IMPOSED HAND-PLAY LOCK, in its three
  //       printed spellings. The whole effect on 5 of its 8 printings, none of
  //       which needs a registry row, exactly as 5b's retreat lock rides 15.
  //
  //       ⚠️ THE TRAILING FORM IS REACHED ONLY THROUGH `splitAttackGateClause`
  //       (D282). Scream Tail ex prints it BEHIND a gate sentence ("You can use
  //       this attack only if you go second, and only during your first turn."),
  //       so the raw string this deriver is handed on that card is the compound
  //       and it is REFUSED here — attack.ts re-runs the seven readers over the
  //       split remainder, and that remainder is what this anchor claims. The
  //       anchor is `^…$` like every other one; nothing was loosened to reach it.
  match = OPPONENT_CANT_PLAY.exec(effect);
  if (match !== null) {
    return [{ op: "preventHandPlay", bars: handPlayClassOf(match[1]) }];
  }
  match = OPPONENT_CANT_PLAY_TRAILING.exec(effect);
  if (match !== null) {
    return [{ op: "preventHandPlay", bars: handPlayClassOf(match[1]) }];
  }
  // 5b-i-b. §10 (D285) — the same window on the POKÉMON surface, Bronzong
  //         `sv05-069` "Evolution Jammer". The whole effect on its 1 printing, so
  //         no registry row; the `"evolve"` key is a `StampedPokemonPlayAct` and
  //         reaches turn.ts's evolve gate, NOT `playTrainer`.
  if (OPPONENT_CANT_EVOLVE_FROM_HAND.test(effect)) {
    return [{ op: "preventHandPlay", bars: "evolve" }];
  }
  // 5b-ii. The same lock behind the printed COST (Galvantula ex "Fulgurite"), ops
  //        in PRINTED ORDER for `SELF_DISCARD_ALL_THEN_REDUCTION`'s stated reason:
  //        the discard is paid now and the bar is what it buys, so a log that
  //        announced the bar first would describe the card backwards. The discard
  //        half is byte-identical to arm 9's bare program (D132's inventory rule).
  match = SELF_DISCARD_ALL_THEN_HAND_LOCK.exec(effect);
  if (match !== null) {
    return [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "preventHandPlay", bars: handPlayClassOf(match[1]) },
    ];
  }

  // 5d. "This Pokémon recovers from all Special Conditions." (Gardevoir ex
  //     sv01-086 / -228 / -245 "Miracle Force" — the whole effect on 3 printings,
  //     none of which needs a registry row, exactly as 5b's retreat lock rides 15).
  //     ⚠️ THE SUBJECT IS THE ATTACKER AND THE OP KNOWS IT WITHOUT BEING TOLD:
  //     `clearStatus` reads `ctx.seat`'s Active, and an attack program's `ctx.seat`
  //     IS the attacker's seat — so this is the one §12 sentence in the deriver
  //     that needs no `target`, where its three `applyStatus` neighbours above all
  //     carry one.
  match = SELF_RECOVERS_ALL.exec(effect);
  if (match !== null) {
    return [{ op: "clearStatus" }];
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
        {
          op: "damageChosen",
          target: "opponentBench",
          amount,
          count: 1,
          source: "attack",
          deals: true,
        },
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

  // 🆕 12b (D296). "You may put an|N Energy attached to your opponent's Active
  //     [Stage 2 ]Pokémon into their hand." — 4 legal printings on 3 sentences,
  //     and the whole row is ASSEMBLY out of vocabulary that already existed.
  //
  // 🛑 **D295 REFUSED ALL FOUR AND TYPED THE BLOCKER AS "MISSING: CODE — the
  //     only word is 'may', and `discardEnergy` is MANDATORY BY CONSTRUCTION".
  //     THERE WAS NO MISSING CODE.** The decline it wanted is not a rider on
  //     this op at all: it is `optional` (D186's FOURTH GATE, producers since
  //     D202), whose own doc block names `discardEnergy` in the list of ops the
  //     wrapper must NOT double up on — and names exactly the mode that must
  //     not, `{kind:"upTo"}`, which is the one mode these sentences do not
  //     print. The paragraph D295 read ("the only decision is WHICH Energy,
  //     never whether — so unlike searchDeck / moveEnergy this park has NO
  //     decline") is TRUE of this op and says nothing about a wrapper one union
  //     member away. A CONTRACT WRITTEN ON ONE OP IS NOT A CONTRACT ABOUT THE
  //     SENTENCE.
  //
  // ⚠️ **WHY THE WRAPPER AND NOT `count: "any", cap: N`.** For Octillery's
  //     "an" the two would offer the identical choice set (0..1) — but for the
  //     three "2 Energy" printings `{count:"any", cap:2}` would legalise a pick
  //     of **ONE**, which the card does not print: "you may put 2" is a decline
  //     or a pair, never a single. The wrapper keeps the inner op EXACT (and
  //     keeps its interchangeable collapse, which the `upTo` mode deliberately
  //     switches off), so all four printings derive through one shape.
  //
  // ⚠️ **THE STAGE CLAUSE GATES *OUTSIDE* THE "may", WHICH INVERTS THE PRINTED
  //     WORD ORDER ON PURPOSE.** "Stage 2" is a fact about the board that is
  //     settled before anybody is asked anything, so gating inside the wrapper
  //     would park a Yes/No whose YES is a guaranteed no-op on every board the
  //     adjective excludes. The player's decision is offered exactly where the
  //     sentence has something to do.
  match = MAY_PUT_OPPONENT_ACTIVE_ENERGY_TO_HAND.exec(effect);
  if (match !== null) {
    const amount = match[1];
    // "an" is the printed article and derives to the op's absent-count default
    // of one; anything else is the numeric capture. A printed 0 is not a real
    // card and would derive to a silent no-op behind a real prompt — the `>= 1`
    // guard every sibling numeric arm in this function carries.
    const count = amount === "an" ? undefined : Number(amount);
    if (count === undefined || count >= 1) {
      const put: EffectOp = {
        op: "discardEnergy",
        from: "opponentActive",
        filter: { kind: "anyEnergy" },
        to: "hand",
        // Spread rather than set to `undefined`, so the "an" program is
        // byte-identical to the countless one the bare arm above produces.
        ...(count === undefined ? {} : { count }),
      };
      // `note` is the MATCHED STRING (the whole `^…$` sentence), which is D202's
      // rule verbatim: the question the player reads is byte-identical to the
      // printed one by construction rather than by a template that could drift.
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      const ask: EffectOp = { op: "optional", note: effect, then: [put] };
      // 🛑 THE STAGE GATE IS THE **OUTER** OP, WHICH INVERTS THE PRINTED WORD
      //    ORDER ("You may put 2 Energy … Active **Stage 2** Pokémon …") AND IS
      //    THE ONE DESIGN CALL IN THIS ARM. Read the other way round the program
      //    parks a Yes/No on EVERY board and then discovers, after the answer,
      //    that the adjective excluded this defender — a decision whose two
      //    branches reach the identical board, which is exactly the prompt the
      //    M1 no-choice rule refuses. "Stage 2" is settled before anybody is
      //    asked anything; "may" is the only thing left to ask.
      return match[2] === undefined
        ? [ask]
        : [
            {
              op: "conditionGate",
              cond: { kind: "opponentActiveIsStage2" },
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
              then: [ask],
            },
          ];
    }
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
  // 19c. The ATTACKER-CLASS filter (D146, widened D239) — 8 legal printings, and
  //      the family's first UNGATED producer of this op. No `coinFlipGate` wrapper
  //      because no coin is printed: the sentence installs unconditionally, so the
  //      derived program is the bare op and the whole gate/consequent shape above
  //      simply does not apply. `effects` stays ABSENT (the sentence never says
  //      "from and effects of"), `fromClass` is PRESENT because the sentence names
  //      a class — the two optional fields read off two different printed phrases,
  //      and stripping `fromClass` yields the arm one line up byte for byte, which
  //      is the widen-don't-add test (D131) rather than the widen-don't-add habit.
  //
  //      D239: the optional `non-{X}` group is the SECOND printed fact inside one
  //      noun phrase, so it lands as a key on ONE record rather than as a second
  //      op or a second union member (`AttackerClass`). An unresolvable code
  //      falls THROUGH to the loud path — it is not defaulted to "no exclusion",
  //      which would install a strictly WIDER block than the card prints.
  match = PREVENT_DAMAGE_FROM_CLASS.exec(effect);
  if (match !== null) {
    const code = match[1];
    if (code === undefined) return [{ op: "preventDamage", fromClass: { stage: "basic" } }];
    const excludingType = POKEMON_TYPE_BY_CODE[code];
    if (excludingType !== undefined) {
      return [{ op: "preventDamage", fromClass: { stage: "basic", excludingType } }];
    }
  }
  // 19c-bis. The DAMAGE CAP (D240) — 3 legal printings on 2 sentences, backlog
  //      row 17, and the family's THIRD narrowing axis. UNGATED like arm 19c and
  //      for the same printed reason (no coin appears on either sentence), so the
  //      derived program is the bare op.
  //
  //      `maxDamage` is PRESENT because the sentence names an amount; `effects`
  //      and `fromClass` are both ABSENT because it names neither "from and
  //      effects of" nor a class — and stripping `maxDamage` yields arm 19b's
  //      consequent byte for byte, which is the widen-don't-add test (D131) met a
  //      second time on this one op. Three optional keys now, read off three
  //      different printed phrases, and no printing in the pool carries two.
  //
  //      🛑 THE COMPARATOR IS A GUARD AND NOT A DECORATION. `or more` reaches this
  //      arm off a constructed sentence and is REFUSED — it falls through to the
  //      loud path — because `AttackBlock.maxDamage` is an UPPER bound by name and
  //      by read (continuous.ts `<=`), and installing a "200 or more" printing as
  //      a 200-cap would invert the card. This is the same polarity discipline arm
  //      19c is under one screen up: an unreadable narrowing is never defaulted
  //      away, because dropping it installs a strictly WIDER block than the card
  //      prints.
  match = PREVENT_DAMAGE_UP_TO_CAP.exec(effect);
  if (match !== null && match[2] === "less") {
    const maxDamage = Number(match[1]);
    // `>= 1` is arm 19d's guard verbatim and for its reason: a printed cap of 0
    // would install a record that refuses an attack doing no damage at all — a
    // protection that protects against nothing, announced in the log as though it
    // did. Leave it LOUD rather than record it.
    if (maxDamage >= 1) return [{ op: "preventDamage", maxDamage }];
  }
  // 19d. The DURATED DAMAGE REDUCTION (D147) — 12 printings on one anchor across
  //      three amounts, and the largest single count this tail had left. An `exec`
  //      rather than a `test`, and the ONLY capture is the amount: the duration is
  //      the printed words "during your opponent's next turn", the holder is the
  //      printed words "this Pokémon", and the step is the printed parenthetical.
  //
  //      UNGATED like arm 19c and for the same reason — no coin is printed on any
  //      of the fourteen — so the derived program is the bare op.
  match = SELF_DAMAGE_REDUCTION.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries: a printed "takes 0 less
    // damage" would install a record that changes no arithmetic anywhere and emit
    // a row announcing it, which is worse than an unread sentence — it claims a
    // protection that does not exist. Leave it LOUD.
    if (amount >= 1) return [{ op: "reduceDamage", amount }];
  }
  // 19e. …and its COMPOUND printing — Eiscue sv02-048/-205 "Frigid Block" ({W}{W}{W},
  //      INDEX 1, printed 100), the other 2 of the family's 14 and the only printing
  //      of the 100 amount. TWO SENTENCES, TWO OPS, IN PRINTED ORDER, the shape arm
  //      25 (Ninetales) and arm 5c already carry.
  //
  //      THE ORDER IS THE PRINTED ORDER AND IT IS ALSO THE ONLY ONE THAT READS
  //      RIGHT: the discard is a COST paid now and the reduction is the protection
  //      it buys for the opponent's turn, so a log that announced the shield before
  //      the payment would describe the card backwards. Neither op parks, so the two
  //      resolve inline in sequence.
  match = SELF_DISCARD_ALL_THEN_REDUCTION.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    if (amount >= 1) {
      return [
        // Byte-identical to arm 9's bare `SELF_DISCARD_ALL` program — the inventory
        // rule (D132) with nothing left over on this half.
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
        { op: "reduceDamage", amount },
      ];
    }
  }
  // 19f. The ATTACKER-SIDE DEBUFF (D149) — 5 printings across TWO anchors, the
  //      OTHER parenthetical, and D147's mirror on both axes at once. Two `exec`s
  //      rather than one alternation because they are two printed strings
  //      (D136/D137): the subject noun phrase differs ("the Defending Pokémon's
  //      attacks do" / "attacks used by the Defending Pokémon do"), which is a
  //      different sentence and not a different token.
  //
  //      WHAT THEY SHARE IS THE OP, and it is shared as an op rather than as a
  //      regex — the family's checkable claim (D148's move on its own pair,
  //      D134's on the heads face). The suite asserts the two programs are
  //      byte-identical at a common amount.
  //
  //      UNGATED like arms 19c–19e and for the same reason: no coin is printed on
  //      any of the five, so the derived program is the bare op.
  match = DEFENDER_ATTACKS_WEAKENED.exec(effect) ?? ATTACKS_BY_DEFENDER_WEAKENED.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries: a printed "do 0 less
    // damage" would install a record that changes no arithmetic anywhere and emit
    // a row announcing a drawback that does not exist. Leave it LOUD.
    if (amount >= 1) return [{ op: "weakenDefenderAttacks", amount }];
  }
  // 19g. The DURATED REACTIVE RECOIL (D152) — 2 printings on ONE anchor at ONE
  //      amount, and the §9 family's first attack-INSTALLED member. An `exec`
  //      rather than a `test`, and the ONLY capture is the counter count: the
  //      duration is the printed words "during your opponent's next turn", the
  //      holder is the printed words "this Pokémon", and the trigger is the
  //      printed words "if this Pokémon is damaged by an attack" — which is the
  //      §9 site's own `dealt > 0` gate and therefore needs no field.
  //
  //      ⚠️ THE ONLY ARM IN THIS TAIL THAT CONVERTS ITS CAPTURE. The sentence
  //      counts DAMAGE COUNTERS and every consumer downstream speaks HP, so the
  //      `× 10` happens once, here, and the op is HP like `damageAttacker`'s four
  //      always-on printings in the registry. Converting at the read site instead
  //      would put a unit check on a line whose whole job is a sum.
  //
  //      UNGATED like arms 19c–19f and for the same reason — no coin is printed
  //      on either printing — so the derived program is the bare op.
  match = SELF_INSTALLED_RECOIL.exec(effect);
  if (match !== null) {
    const counters = Number(match[1]);
    // `counters >= 1` is the guard every arm here carries: a printed "put 0
    // damage counters" would arm a trap that changes no arithmetic anywhere and
    // emit a row announcing it, which is worse than an unread sentence — it
    // claims a threat that does not exist. Leave it LOUD.
    if (counters >= 1) return [{ op: "installRecoil", amount: counters * 10 }];
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

  // 21b. "Move all damage counters from 1 of your Benched Pokémon to 1 of your
  //      opponent's Pokémon." — D216's CHOSEN-DESTINATION counter move,
  //      Cofagrigus sv10.5w-040/-123 "Extended Damagriiigus", **2 legal**.
  //      Numbered as a sibling of 21 rather than appended, because it is the SAME
  //      printed action reading its destination out of a decision instead of out
  //      of the text. Both anchors open `^Move all damage counters from 1 of your
  //      Benched …` and part only at the TAIL, and as written they are mutually
  //      exclusive — no string matches both.
  //
  //      ⚠️ **IT IS TRIED BEFORE 21, AND THAT ORDER IS LOAD-BEARING IN EXACTLY ONE
  //      DIRECTION — CHOSEN BY MUTATION RATHER THAN BY TASTE.** With 21 first, a
  //      LOOSENED tail here (`to (?:1 of )?your opponent's (?:Active )?Pokémon`)
  //      is unobservable: arm 21 has already returned for D138's sentence, so the
  //      slop never shows. Running this arm first makes that mutant fatal — the
  //      fixed-destination sentence would derive `moveCountersChosen` and three
  //      assertions go red. The mirror hazard is real and is stated rather than
  //      hidden: a loosened tail on 21 is now the masked one, and 21 is the older
  //      anchor with its own refusal suite (ownerTargetOps.test.ts) around it.
  //
  //      `fromBench` is deliberately ABSENT from the derived op: the deriver
  //      emits the question, not its answer (see the op's doc block). With no
  //      owner capture either (the anchor's own block says why), the arm has
  //      nothing to branch on and the op is FIELD-LESS — which is what D138's arm
  //      looked like before a printing bought it a rider.
  if (COUNTER_MOVE_TO_CHOSEN.test(effect)) return [{ op: "moveCountersChosen" }];

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
  match = COUNTER_MOVE_TO_DEFENDER.exec(effect);
  if (match !== null) {
    // No `amount >= 1` guard, because there is no printed amount to guard: "all"
    // is not a number and cannot be zero. The degenerate case — a pick with no
    // counters on it — is a SILENT whiff at run time (the single-arm rule), not
    // a derivation failure, exactly as `CHOSEN_HEAL`'s "all" branch is.
    //
    // ⚠️ D205 — the owner key is OMITTED rather than set to `undefined` when the
    // printing carries no possessive. `CHOSEN_HEAL`'s `zone` arm above states the
    // reason and it is the same one: derived ops are compared BY VALUE against
    // hand-authored registry rows, and `{ ownerPokemon: undefined }` is not
    // `toEqual`-identical to an absent key under this suite's comparisons. So
    // Dedenne ex's sentence still derives to the byte-identical op D138 shipped.
    return [
      match[1] === undefined
        ? { op: "moveCountersToDefender" }
        : { op: "moveCountersToDefender", ownerPokemon: match[1] },
    ];
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

  // 23a. "Put {N} damage counters on your opponent's [Benched] Pokémon in any way
  //      you like." — 🆕 D348's SPREAD, **8 legal printings on 3 sentences** and the
  //      largest single count this family has mapped in one arm since D143's twenty.
  //      Arm 23's sentence with the determiner dropped and a distribution tail
  //      added, and it is a LETTERED sub-arm for the reason 21b and 24a/b/c are:
  //      the anchors are one noun phrase apart and belong beside each other.
  //
  //      🛑 **N REPEATED OPS, AND THE OP IS THE ONE ARM 23 ALREADY EMITS.** D132's
  //      INVENTORY RULE AGAIN: `damageChosen { count: 1 }` has existed since M4
  //      slice 8, `target: "opponentAny"` since D143, and `source: "attack"` since
  //      D140 — so this arm buys a READER and NOTHING else. **No new op, no new op
  //      FIELD, no new prompt kind, no new park, and no `MATCH_RECORD_VERSION`
  //      move.** The handoff priced it at one new distribution prompt; the anchor's
  //      doc block above records why that price is wrong and how it was checked.
  //
  //      ⚠️ IT MUST NOT SET `deals`, for arm 23's reason verbatim: these are PLACED
  //      counters, not attack damage. That absence is what routes the ops onto
  //      `placeSnipe`'s counter path — and on the `opponentAny` branch it is what
  //      keeps Sinistcha's Active target FLAT, through `damageActive` rather than
  //      `snipeActive`, which is D143's Ninetales ruling (a placed counter is not
  //      attack damage, so §8.5 never runs over it) reached by a second producer.
  //
  //      THE PRINTED 200 / 90 RIDE THE ATTACK'S OWN `damage` FIELD — Phantom Dive
  //      and Hex Hurl both declare real §8.5 damage beside the placement, so this
  //      is arm 23's D125 tail (damage → program → epilogue sweep) at N picks
  //      instead of one. Sinistcha's "Cursed Drop" declares NO damage at all, so
  //      the family now has a producer at both ends of that split.
  match = COUNTER_SPREAD_ON_OPPONENT.exec(effect);
  if (match !== null) {
    // ⚠️ COUNTERS → HP (one counter = 10, §12), at the PRODUCER — the same place
    // arms 22 and 23 do it, and the same place Meowscarada's registry row does it
    // by hand. The interpreter never sees the printed unit and cannot convert
    // twice. **The conversion is per OP and the count is the LENGTH**, which is the
    // one place this arm could have gone wrong in the other direction: `amount: 10`
    // on N ops, never `amount: counters * 10` on one.
    const counters = Number(match[1]);
    // `counters >= 1` is the guard every arm here carries: a printed "Put 0 damage
    // counters" would emit an EMPTY program — an attack silently reporting an
    // effect that moved nothing. Leave it loud.
    if (counters >= 1) {
      // The ZONE is the optional capture and nothing else. `opponentAny` offers the
      // Active TOO (Sinistcha, which omits the word "Benched"); `opponentBench` is
      // Dragapult ex's and Flutter Mane's printed restriction.
      const target = match[2] === undefined ? "opponentAny" : "opponentBench";
      return Array.from({ length: counters }, () => ({
        op: "damageChosen" as const,
        target,
        // ONE counter per op — the distribution IS the sequence, so the per-op
        // amount is the §12 unit and never the printed total.
        amount: 10,
        // EXACT at 1, not a ceiling: each placement is mandatory (no printed "up
        // to", no "you may"), and §8.6 is the only thing that softens it — an empty
        // candidate set places nothing, N times over, which is the printed reading
        // on a board with no legal target.
        count: 1,
        source: "attack" as const,
      }));
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

  // 24a. "During your next turn, this Pokémon can't use {AttackName}." — D154's
  //      PER-ATTACK lock, 6 catalogued printings across 4 names (plus Radiant
  //      Blastoise swsh10.5-018, fielded but uncatalogued — see the anchor). Arm
  //      24's sentence narrowed from the POKÉMON to ONE of its attacks, and it
  //      sits directly beneath it because the two are told apart by the verb
  //      alone.
  //
  //      AN `exec`, AND THE FIRST CAPTURE IN THIS TAIL THAT IS NOT A NUMBER. The
  //      duration is the printed words "during your next turn" and the holder is
  //      the printed words "this Pokémon"; what varies is the attack's NAME, so
  //      the op carries the proper noun verbatim and the INTERPRETER resolves it
  //      against the holder's printed attacks (a lock naming nothing installs
  //      nothing). D152's `× 10` made the same call from the other side: the
  //      translation belongs at the site that owns the printed token.
  //
  //      ⚠️ THERE IS NO `amount >= 1`-STYLE GUARD, AND THE ABSENCE WAS MEASURED
  //      RATHER THAN ASSUMED. Every neighbouring arm refuses a degenerate capture
  //      (a printed 0), and one was written here for the empty name — then
  //      mutation-checking showed removing it failed NOTHING, because `(.+?)`
  //      already cannot match an empty string and `^…$` leaves nowhere for one to
  //      hide. A guard that cannot fire is worse than no guard: it reads like a
  //      refusal somebody checked. The refusal is the QUANTIFIER, and the suite
  //      asserts the empty sentence returns null so the claim stays pinned where
  //      it actually lives.
  //
  //      ⚠️ AND THE CAPTURE IS FOLDED (`foldApostrophes`), WHICH IS D137's RULE
  //      REACHING A VALUE FOR THE FIRST TIME. Greedent ex sv03-179's attack is
  //      named "Slip 'n' Roll" — two apostrophes INSIDE the captured noun — so a
  //      punctuation-normalising re-ingest would change the derived op and not
  //      only the sentence that produced it. D137's contract is that the two
  //      spellings produce the SAME VALUE, so the fold belongs here as well as on
  //      the pattern, and the install site folds the card's own `name` to match.
  match = SELF_CANT_USE_ATTACK.exec(effect);
  if (match !== null) {
    return [{ op: "preventAttackUse", attack: foldApostrophes(match[1] ?? "") }];
  }

  // 24b. "During your next turn, this Pokémon's {AttackName} attack does {N} more
  //      damage (before applying Weakness and Resistance)." — D155's PER-ATTACK
  //      BUFF, 1 printing (Seismitoad sv03-052 "Echoed Voice"). Arm 24a's address
  //      with arm 19f's read step, and it sits beneath 24a because the two share
  //      the capture, the holder, the window and the resolver, and differ in the
  //      verb alone.
  //
  //      AN `exec` WITH TWO CAPTURES — the NAME and the amount — where every
  //      neighbouring arm has one of either. The duration is the printed words
  //      "during your next turn", the holder is the printed words "this Pokémon",
  //      and the STEP is the printed parenthetical, which is the one token
  //      separating this sentence from the five that SUBTRACT at the same step
  //      (arm 19f) and from the twenty that subtract at the other one (arm 19d).
  //
  //      UNGATED like arms 19c–19g and for the same reason — no coin is printed on
  //      the one printing — so the derived program is the bare op.
  match = SELF_ATTACK_BOOST.exec(effect);
  if (match !== null) {
    const amount = Number(match[2]);
    // `amount >= 1` is the guard every arm in this neighbourhood carries: a
    // printed "does 0 more damage" would install a record that changes no
    // arithmetic anywhere and emit a row announcing a bonus that does not exist,
    // which is worse than an unread sentence. Leave it LOUD. (Arm 24a has no
    // twin guard on its NAME capture, and that absence was measured rather than
    // assumed — `(.+?)` already cannot match an empty string.)
    if (amount >= 1) {
      return [{ op: "boostAttack", attack: foldApostrophes(match[1] ?? ""), amount }];
    }
  }

  // 24c. "Choose 1 of your opponent's Active Pokémon's attacks. During your
  //      opponent's next turn, that Pokémon can't use that attack." — D157's
  //      OPPONENT-side per-attack lock, 2 printings (Medicham sv01-111
  //      "Acu-Punch-Ture", Oranguru sv02-094 "Plotter's Command"). Arm 24a's rule
  //      pointed across the table, and it sits beneath 24a/24b because the three
  //      share a state field, a reader and a §10 clear set, and differ in WHERE
  //      the address comes from.
  //
  //      A `test` RATHER THAN AN `exec`, AND IT IS THE ONLY ONE IN THIS
  //      NEIGHBOURHOOD. Both siblings capture a printed proper noun; this sentence
  //      has none to capture — "that attack" points at a decision the player has
  //      not taken yet — so the whole sentence is the reading and the ADDRESS is
  //      produced by the park (interpreter.ts `preventChosenAttack`).
  //
  //      TWO SENTENCES IN ONE ANCHOR, and it is NOT the two-op shape arm 25 and
  //      `DEFENDER_POISON_CANT_RETREAT` use. Those anchors read two INDEPENDENT
  //      consequents and derive one op each; here sentence one is the ANTECEDENT
  //      of sentence two — "that attack" has no referent without "Choose 1 …" — so
  //      the pair is one rule spelled over two full stops and derives ONE op. A
  //      prefix reader that took the first sentence alone would offer a choice
  //      that bought nothing, which is strictly worse than leaving the card LOUD.
  //
  //      UNGATED like arms 19c–19g and 24a/24b: no coin is printed on either
  //      printing, so the derived program is the bare op.
  if (OPPONENT_CHOSEN_ATTACK_LOCK.test(effect)) {
    return [{ op: "preventChosenAttack" }];
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

  // 26. "Flip a coin. If tails, during your next turn, this Pokémon can't attack."
  //     — D144's TAILS GATE, 5 printings on one sentence, and the third form of
  //     arm 24's rider (bare, behind a counter PUT, and now behind the LOSING face
  //     of a coin). A `test`, not an `exec`: nothing varies.
  //
  //     D132'S INVENTORY RULE ON BOTH HALVES AT ONCE, which is what makes this the
  //     cheapest arm in the tail. The consequent (`preventAttack`) is D143's, the
  //     gate (`coinFlipGate`) has spliced a branch since 0.x, and the ONLY thing
  //     that did not exist is which FACE unshifts the branch. So this is one
  //     optional field, one regex and this arm — no new op, no new mechanism, no
  //     new event, no new park, and no `attack.ts` / `continuous.ts` / `redact.ts`
  //     / `turn.ts` / `types.ts` diff at all.
  //
  //     ⚠️ THE `then` IS BYTE-IDENTICAL TO ARM 24's WHOLE PROGRAM, which is the
  //     family's checkable claim (D134's, on the other face): there is ONE action
  //     here, printed three ways, and the coin is procedure in front of it. A TAILS
  //     is therefore a RESOLVED attack and not a skipped effect — and here that
  //     reading has teeth the heads family's never did, because on this sentence
  //     the LOSING face is the one that does something: a build that dropped the
  //     field would install the drawback on exactly the printings that did not earn
  //     it, silently, on a board where nothing looks wrong.
  if (FLIP_TAILS_SELF_CANT_ATTACK.test(effect)) {
    return [
      {
        op: "coinFlipGate",
        // The field, ABSENT on every heads sibling and `true` here — never
        // `false`, so a heads-gated program stays `toEqual`-identical to the
        // registry rows it is compared against (D135's absent-field rule).
        onTails: true,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "preventAttack" }],
      },
    ];
  }

  // 26b/26c (D148). The SAME rider pointed at the OTHER side of the table — 4
  //     printings across 2 sentences, and the two arms that earn `preventAttack`
  //     its `target` field:
  //
  //       "Discard an Energy from this Pokémon. During your opponent's next turn,
  //        the Defending Pokémon can't attack."   (3 — Eiscue ex sv03-042/-210/-222
  //                                                "Scalding Block", {W}{W}{W},
  //                                                INDEX 0, printed 160)
  //       "If the Defending Pokémon is a Basic Pokémon, it can't attack during
  //        your opponent's next turn."             (1 — Houndoom ex sv03-134 "Evil
  //                                                Claw", {D}{D}, INDEX 0, 90)
  //
  //     ⚠️ BOTH ARE COMPOUNDS AND NEITHER SECOND OP IS NEW. Sentence one of the
  //     first is `SELF_DISCARD_ONE`'s own output byte for byte (arm 7), and the
  //     gate on the second is `conditionGate`, spliced by `runProgram` since M4.
  //     What this slice added is the `target` field and one `BoardCondition`
  //     member; the lock itself, its stamp convention, its §8 gate, its three §10
  //     early clears, its event, its log arm and BOTH payability projections are
  //     D143's and are reused with no diff at all.
  //
  //     ⚠️ THE STAMP IS DERIVED FROM `target`, NOT CARRIED BESIDE IT. See the op's
  //     doc block: one rule ("the locked Pokémon's controller's next turn") read
  //     on two seats gives `+ 1` here and `+ 2` on the self arm, because declaring
  //     an attack ends the turn. That is why this is ONE field and not two.
  match = SELF_DISCARD_ONE_THEN_DEFENDER_LOCK.exec(effect);
  if (match !== null) {
    return [
      // The PARK, and it comes first because it is printed first: with two
      // different Energy attached the pick is a real decision, so the lock behind
      // it installs on the RESUMED tail (Ninetales' compound is the precedent, and
      // this is the first time an OPPONENT-side install has sat behind a park).
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
      { op: "preventAttack", target: "defender" },
    ];
  }
  if (DEFENDER_BASIC_CANT_ATTACK.test(effect)) {
    return [
      {
        op: "conditionGate",
        // "the Defending Pokémon" is §8 step 5's term of art for the opponent's
        // Active, resolved HERE — the layer that knows the sentence came off an
        // attack — rather than in the member's name (D116's rule, verbatim).
        cond: { kind: "opponentActiveIsBasic" },
        // BYTE-IDENTICAL to the second op of the arm above, which is the family's
        // checkable claim on this pair: there is ONE action here, printed two ways,
        // and the gate is a condition in front of it.
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ];
  }

  // 27/28. "Flip a coin. If tails, discard all Energy from this Pokémon." (2) and
  //        "Flip a coin. If tails, this Pokémon also does {N} damage to itself."
  //        (1) — D145, and the arms that CLOSE the bare tails-gated family. Both
  //        are D132's INVENTORY RULE with nothing left over: the gate is 0.x's,
  //        the field is D144's, and each consequent op has been read off its BARE
  //        printing since 0.x (arm 9's `SELF_DISCARD_ALL`, arm 14's `SELF_DAMAGE`).
  //        No new op, no new field, no new event, no new park, no new error code,
  //        and no `interpreter.ts` / `attack.ts` / `types.ts` / `continuous.ts` /
  //        `flow.ts` / `log.ts` / `events.ts` / `redact.ts` / `registry.ts` diff.
  //
  //        ⚠️ EACH `then` IS THE BARE ANCHOR'S OWN OUTPUT, BYTE FOR BYTE — the
  //        family's checkable claim on its third and fourth sentences (D134's on
  //        the heads face, D144's on this one). There is ONE action per sentence,
  //        printed two ways, and the coin is procedure in front of it.
  //
  //        ⚠️ AND THE TAIL PLACEMENT IS THE WHOLE READING OF THE PRINTED "ALSO".
  //        An `EffectOp` runs at `attack.ts`'s TAIL, strictly after the §8.5
  //        pipeline (D125), so the main hit lands FIRST and this is what the
  //        attack does after it — which is exactly what "this Pokémon ALSO does
  //        60 damage to itself" says. Two consequences worth writing down because
  //        neither is obvious from the sentence: the recoil is FLAT (it never
  //        re-enters §8.5, so no Weakness, no Resistance and no reduction touches
  //        it — the confusion-self-hit model `damageSelf` was built on), and the
  //        program runs even when the main hit dealt ZERO because the defender
  //        PREVENTED it (§11 nulls the damage, not the attack) — so a Pikachu ex
  //        that hits a Safeguard still pays its Energy on a tails. What does NOT
  //        run it is a CANCELLED attack: D125's requirement gate and D126's
  //        `cancelOnTails` both return in FRONT of the program, and neither of
  //        these three printings carries either sentence (the anchors are
  //        whole-string, so a card can only print one).
  if (FLIP_TAILS_SELF_DISCARD_ALL.test(effect)) {
    return [
      {
        op: "coinFlipGate",
        onTails: true,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
        ],
      },
    ];
  }
  match = FLIP_TAILS_SELF_DAMAGE.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // The bare arm's guard, verbatim: a printed 0 would derive to a silent no-op,
    // so it stays on the loud ATTACK_EFFECT_SKIPPED path.
    if (amount >= 1) {
      return [
        {
          op: "coinFlipGate",
          onTails: true,
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "damageSelf", amount }],
        },
      ];
    }
  }

  // 29–32 (D181). THE TRAINER-PATH OPS, PRINTED AS ATTACK TEXT — see the anchors'
  //     block above for the re-derived census, the near-misses, and the ONE family
  //     of the four that is deliberately not here. FOUR arms, three ops that have
  //     run since M4, and NO interpreter, park, prompt, event, log, redact or
  //     registry diff: the ops, their parks and the gate all exist, and what was
  //     missing was a reader. 19 printings of the family's 28.
  //
  //     ⚠️ TWO OF THE FOUR PARK, AND THAT IS INHERITED RATHER THAN NEW. `gust`
  //     parks a `choosePokemon` over the OPPONENT's Bench, ANSWERED BY THE
  //     CONTROLLER (you choose which of theirs comes up — Boss's Orders' own
  //     reading, so the park needs no `answerer`), and `parkOrForce` auto-takes at
  //     one candidate and no-ops at zero. A derived attack effect has been able to
  //     park since arm 7.
  //
  //     ⚠️ AND THE TAIL PLACEMENT IS LOAD-BEARING FOR THE GUST, in a way it is not
  //     for the draws. An `EffectOp` runs at attack.ts's TAIL — after §8.5, before
  //     `finishAttack`'s §8.1 Knock Out sweep (D125) — so a gust that follows a
  //     LETHAL hit switches the dying body to the Bench and the sweep then Knocks
  //     it Out THERE. That is the printed order (damage, then the attack's effect,
  //     then Knock Outs) rather than an accident of staging, and it is pinned in
  //     the suite rather than left to be discovered.
  match = ATTACK_DRAW.exec(effect);
  if (match !== null) {
    // The singular branch leaves group 1 undefined and means exactly one card —
    // `DECK_TOP_MILL`'s arrangement, and the only place either arm invents a
    // number instead of reading one.
    const count = match[1] === undefined ? 1 : Number(match[1]);
    // `count >= 1` is the guard every arm here carries: a printed "Draw 0 cards."
    // would derive to an attack that reports a simulated effect and moves
    // nothing. No CEILING — `drawToHand` short-draws on a shallow deck (§14.3
    // deck-out is a turn-START rule), so a malformed large count empties a deck
    // and stops, which is a legal board state.
    if (count >= 1) return [{ op: "drawCards", count }];
  }
  match = ATTACK_DRAW_UNTIL.exec(effect);
  if (match !== null) {
    const size = Number(match[1]);
    // Same guard, and here it refuses something slightly different: "until you
    // have 0 cards in your hand" is not a small draw, it is a sentence whose op
    // never draws at all (`drawUntilHandSize` NEVER TRIMS a bigger hand), so
    // admitting it would file an effect that is a no-op by construction.
    if (size >= 1) return [{ op: "drawUntilHandSize", size }];
  }

  // 33–34 (D202). THE PRINTED "**You may** …", AND THE FIRST TWO PRODUCERS OF THE
  //     `optional` OP. D186 built the fourth gate — the op, the `confirm` prompt,
  //     the choice kind, the wire check, the redact arm, the projection arm and
  //     both dialogs — and deliberately shipped NO PRODUCER, so that no park of a
  //     kind a surface could not render could exist. Both surfaces answer it now
  //     (and D201 gave the online router a `never` floor), so these two arms are
  //     the asking. **12 legal printings**, the whole buildable prize behind the
  //     wrapper today; the anchors' block above carries the re-derived census.
  //
  //     ⚠️ THE `note` IS THE MATCHED STRING, NOT A REBUILT ONE. `effect` is what
  //     the regex just consumed whole (`^…$`), so the note the player reads is
  //     BYTE-IDENTICAL to the printed sentence by construction rather than by a
  //     template that could drift from it — and the op's doc requires exactly
  //     that ("`note` is the WHOLE printed sentence"). Both HUDs render it as the
  //     dialog's only prose (`<h2>{prompt.note}</h2>` over Yes / No), so the
  //     printed sentence IS the question, and a paraphrase would be this slice
  //     inventing wording for a card.
  //
  //     ⚠️ THE `>= 1` GUARD IS THE BARE ARMS' GUARD, VERBATIM, AND IT MATTERS
  //     MORE HERE. A "You may draw 0 cards." would park a real decision whose YES
  //     branch moves nothing — the player is asked a question, answers it, and the
  //     board is identical either way, which is exactly the prompt the M1
  //     no-choice rule exists to refuse. `drawUntilHandSize 0` is worse still (the
  //     op NEVER TRIMS, so it is a no-op at that size by construction).
  //     Unwrapped, those two strings derive to null; wrapped, they must too.
  match = ATTACK_MAY_DRAW.exec(effect);
  if (match !== null) {
    const count = Number(match[1]);
    if (count >= 1) {
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      return [{ op: "optional", note: effect, then: [{ op: "drawCards", count }] }];
    }
  }
  match = ATTACK_MAY_DRAW_UNTIL.exec(effect);
  if (match !== null) {
    const size = Number(match[1]);
    if (size >= 1) {
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      return [{ op: "optional", note: effect, then: [{ op: "drawUntilHandSize", size }] }];
    }
  }

  // No capture in either gust arm — nothing in either sentence varies. The gated
  // program's `then` is BYTE-IDENTICAL to the bare arm's whole program, which is
  // this family's checkable claim (D134's shape, and here it reaches further:
  // both also equal the REGISTRY programs printed on the same actions — Boss's
  // Orders `sv02-172`, Pokémon Catcher `sv01-187` — so one action is read off one
  // string by two different seams and the suite asserts the equalities).
  //
  // ⚠️ AND `gust` IS ONE `otherSeat` AWAY FROM `switchActive` AT THE INTERPRETER,
  // WHICH IS THE SHARPEST MUTANT IN THE SLICE. The two take the same prompt kind,
  // emit the same events, and differ only in which seat `switchInto` is called
  // for. A build that crossed them would switch the ATTACKER out where the card
  // drags the DEFENDER up — a legal-looking board with the opposite effect, and
  // nothing but the seat to see it by. It would ALSO trip the `finishAttack`
  // addressing described on the anchors above, which is the second reason this is
  // a literal anchor rather than an alternation over a captured possessive.
  if (ATTACK_GUST.test(effect)) {
    return [{ op: "gust" }];
  }
  if (ATTACK_FLIP_GUST.test(effect)) {
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "gust" }],
      },
    ];
  }
  // D189 — the SELF-switch, the mirror of the two arms directly above and the
  // first attack-derived op that moves the ATTACKER off the Active Spot. Its
  // precondition (a required `uid` on the `attackEpilogue` stage, so the §8.1
  // recoil follows the body rather than the spot) is paid in `types.ts` /
  // `flow.ts` / `attack.ts`; these two lines are what D181 correctly refused to
  // write without it.
  //
  // ⚠️ THE SEAM IS `switchActive`'s AND IT HAS THREE EARLY RETURNS, EACH NOW
  // OWNED BY A DIFFERENT TERM — enumerated rather than assumed, because widening
  // a seam that served exactly one printing (the Switch Item `sv01-194`) is where
  // this repo has twice been bitten:
  //   • `parkOrForce`'s EMPTY-candidate return (`{ done: state }`) was
  //     UNREACHABLE from the Trainer path — `programPlayable` (cardplay.ts)
  //     refuses to play a `switchActive` Trainer with an empty Bench, so the Item
  //     could never run into it. It is REACHABLE HERE and it is CORRECT here:
  //     `programPlayable` governs card PLAYS only and an attack is declared
  //     against its Energy cost (§8), never against whether its effect can do
  //     anything, so an attacker with an empty Bench uses the attack and the
  //     switch does as much as it can, i.e. nothing. That difference is the arm's
  //     newly reachable case and is driven, not argued.
  //   • `parkOrForce`'s ONE-candidate return (auto-apply) and its ≥2 PARK are
  //     shared unchanged with the Item; the park now rides an `attackEpilogue`
  //     with `resumeTail`, which is arm 7's inherited machinery.
  //   • `switchInto`'s three guards (non-bench ref / missing incoming / missing
  //     top uid) stay owned by the WIRE — every one is unreachable from a park
  //     `validateChoice` accepted, on either seam.
  if (ATTACK_SELF_SWITCH.test(effect)) {
    return [{ op: "switchActive" }];
  }
  if (ATTACK_FLIP_SELF_SWITCH.test(effect)) {
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "switchActive" }],
      },
    ];
  }
  // ⚠️⚠️ D227 — THE THIRD SWITCH FAMILY, AND THE ONE THAT IS NEITHER OF THE OTHER
  // TWO. `switchActive` moves the ATTACKER's Active, `gust` moves the DEFENDER's
  // and the ATTACKER picks; this moves the defender's and THE DEFENDER PICKS. The
  // board move is `gust`'s exactly — one `switchInto` on the opponent's seat — so
  // the only thing these three lines buy is the seat that answers, which is
  // precisely why `derivedOpponentSwitchOut.test.ts` drives WHO the park belongs
  // to on every board rather than only what moved.
  if (ATTACK_OPPONENT_SWITCH_OUT.test(effect)) {
    return [{ op: "opponentSwitchOut" }];
  }
  // The printed "You may", wrapped exactly as the two MAY-DRAW arms above are —
  // and this is the FIRST `optional` whose inner op parks for the OTHER seat, so
  // the two questions are asked of two different people in order: the controller
  // consents, then the opponent chooses. Both parks are `resumeTail` parks behind
  // the same `attackEpilogue`, which is what makes the sequence work at all.
  if (ATTACK_MAY_OPPONENT_SWITCH_OUT.test(effect)) {
    return [
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "optional", note: effect, then: [{ op: "opponentSwitchOut" }] },
    ];
  }
  // Iron Bundle `sv06-062` "Interjet" — self-switch, then the §9.2 gate, then the
  // opponent's own choice. THREE existing pieces and no new mechanism: the shape
  // is Prime Catcher's registry program (`gust {recordAs}` → `recordGate` →
  // `switchActive`) with the two ends swapped and the consequent chosen by the
  // other seat.
  //
  // ⚠️ THE GATE IS LOAD-BEARING AND NOT DECORATION: an attacker with an EMPTY
  // Bench cannot switch, `switchActive` files nothing, `recordGateHolds` reads the
  // empty slot as false, and the opponent is never asked — which is the printed
  // "If you do" and the FIRST board on which `parkOrForce`'s zero-candidate
  // ending is OBSERVABLE rather than merely reachable (D189 made it reachable;
  // nothing until now could see the difference).
  if (ATTACK_SELF_SWITCH_THEN_OPPONENT_SWITCH_OUT.test(effect)) {
    return [
      { op: "switchActive", recordAs: "moved" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "moved", then: [{ op: "opponentSwitchOut" }] },
    ];
  }
  // ⚠️⚠️ D228 — THE DAMAGE RIDER, WHICH D227 PRICED AS A SECOND §8.5 PIPELINE AND
  // WHICH TURNED OUT TO BE AN OP. Both arms are the promotion op the family
  // already had, followed by `damageNewActive` — and the answer to D227's open
  // question ("is the fold re-entered per promoted body, or does the interpreter
  // gain an op attack.ts resolves?") is NEITHER: `snipeActive` has re-entered the
  // §8.5 pipeline from inside a program since D96, and it addresses its target by
  // asking who is Active RIGHT NOW. A body promoted one op earlier is that body.
  //
  // THE TWO ARMS DIFFER BY THE `recordGate` AND BY NOTHING ELSE, which is the
  // printed "If you do" and the whole reason there are two anchors — see the
  // anchor block for the argument and `derivedNewActiveDamage.test.ts` for the
  // empty-Bench board that tells them apart.
  match = ATTACK_GUST_THEN_DAMAGE_NEW_ACTIVE.exec(effect);
  if (match !== null) {
    return [{ op: "gust" }, { op: "damageNewActive", amount: Number(match[1]) }];
  }
  // ⚠️ AND THIS ARM IS WHY `opponentSwitchOut` GREW A `recordAs` — the field its
  // own doc deferred "until a printing asks", asked for by the printing D227
  // fielded unread one fixture index later. The antecedent files the promoted uid;
  // the gate reads the slot's LENGTH, so an opponent with an empty Bench (nothing
  // promoted, nothing filed) takes no damage, exactly as the printed conditional
  // says and unlike the gust arm above it.
  match = ATTACK_OPPONENT_SWITCH_OUT_THEN_DAMAGE_NEW_ACTIVE.exec(effect);
  if (match !== null) {
    return [
      { op: "opponentSwitchOut", recordAs: "moved" },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "damageNewActive", amount: Number(match[1]) }],
      },
    ];
  }
  // ⚠️⚠️ D229 — THE ATTACKER'S OWN ENERGY ONTO ITS OWN BENCH, and the family's
  // FIRST derived arms: every `moveEnergy` printing before this one is a registry
  // row, so nothing has ever handed this op a sentence. NO NEW OP AND NO NEW
  // FIELD — one `route` value, which is `benchToActive` with the endpoints
  // swapped, and the whole cost of the slice is that value plus these two lines.
  //
  // THE MISSING `an` IS NOT A DEFAULT, IT IS THE ARTICLE: the alternation captures
  // the number when the sentence prints one ("Move 3 Energy", Yanmega ex) and
  // matches the article when it does not ("Move an Energy", 8 printings), so the
  // absent group IS `max: 1`. `ATTACK_DRAW`'s reading of "Draw a card", verbatim.
  match = ATTACK_MOVE_ENERGY_SELF_TO_BENCH.exec(effect);
  if (match !== null) {
    return [
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: match[1] === undefined ? 1 : Number(match[1]),
        route: "selfToBench",
      },
    ];
  }
  // Tornadus `svp-210`/`sv10.5w-078` "Hurricane" — the same move with the noun
  // narrowed. `basicEnergy` is the filter Energy Switch already carries, so the
  // two arms differ by that one word in the op exactly as they do in print.
  if (ATTACK_MOVE_BASIC_ENERGY_SELF_TO_BENCH.test(effect)) {
    return [{ op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1, route: "selfToBench" }];
  }
  // ⚠️⚠️ D230 — THE DECK SEARCH ONTO YOUR OWN BENCH, and the FIRST derived arm
  // whose program is TWO OPS. Both have existed since M4 (`NEST_BALL` is
  // `searchDeck` + `shuffleDeck` and nothing else); what was missing was a reader
  // for the sentence printed as an ATTACK, so this arm buys 20 legal printings for
  // no new op, no new op field, no interpreter diff and no `CardFilter` member.
  //
  // THE TRAILING `shuffleDeck` IS AN OP AND NOT A FLAG, which is the registry's
  // standing shape rather than this slice's choice: it fires on the WHIFF and on
  // the decline alike (the search parks at `min: 0`, and an empty candidate set
  // returns the state untouched), so the printed "Then, shuffle your deck." is
  // simulated even on the boards where nothing was found. A `shuffle?: true` rider
  // on `searchDeck` would have to re-derive that, and 16 authored rows already
  // spell it this way.
  //
  // THE MISSING `up to` GROUP IS NOT A DEFAULT, IT IS THE ARTICLE — `ATTACK_DRAW`'s
  // and D229's reading a third time: the alternation captures the number when the
  // sentence prints one and matches "a … put it" when it does not, so the absent
  // group IS `max: 1`. The NOUN is dispatched on WHICH GROUP MATCHED and never on
  // the matched text.
  match = ATTACK_BENCH_SEARCH.exec(effect);
  if (match !== null) {
    // Groups: 1/5 the literal "Basic Pokémon", 2/6 the brace-coded "Basic {G}
    // Pokémon" (D238), 3/7 the proper NAME — singular half then plural half of
    // the alternation — and 4 the printed count.
    const max = match[4] === undefined ? 1 : Number(match[4]);
    const typed = match[2] ?? match[6];
    const name = match[3] ?? match[7];
    // `max >= 1` is the guard every arm here carries: a printed "up to 0" would
    // derive to a search the interpreter turns into a silent no-op that still
    // shuffles — an attack reporting a simulated effect that moved nothing.
    if (max >= 1) {
      // Still dispatched on WHICH GROUP MATCHED and never on the matched text —
      // D230's rule, now over three alternatives. The typed group is the one
      // exception that then reads its own text, and it reads it as a KEY into a
      // closed map: an unmapped code yields `undefined` and falls through to the
      // loud skip path rather than to a wider filter.
      const filter: CardFilter | undefined =
        typed !== undefined
          ? typedNounFilter(typed, match[6] !== undefined)
          : name !== undefined
            ? { kind: "byName", name }
            : { kind: "basicPokemon" };
      if (filter !== undefined) {
        return [{ op: "searchDeck", filter, dest: "bench", max }, { op: "shuffleDeck" }];
      }
    }
  }
  // ⚠️⚠️ D231 — THE DECK SEARCH INTO YOUR OWN HAND. D230's arm one word over, and
  // the arithmetic is on `ATTACK_HAND_SEARCH` above: 28 of the family's 42 legal
  // attack printings, on one anchor and one closed noun table.
  //
  // THE NOUN COMES FROM A TABLE, NOT FROM A GROUP, and the dispatch still never
  // reads the matched TEXT as a value: it uses it as a KEY into a closed map and
  // takes the miss as a refusal. That is the same guarantee D230's
  // group-per-alternative bought, at a fraction of the pattern — sixteen groups
  // would be needed to spell eight nouns over two grammatical numbers — and it is
  // the shape `OPPONENT_ENERGY_SCALE` already uses for its energy token.
  //
  // THE `reveal` RIDER IS SET FROM THE PRESENCE OF ITS GROUP, never from `dest`
  // and never from how narrow the filter is (D225). ABSENT rather than `false`
  // when the print carries no clause — D135's rule, and these ops are compared by
  // value against hand-authored registry rows.
  //
  // "You may search…" DERIVES TO THE SAME PROGRAM AS "Search…", and that is a
  // fact about the op rather than a shortcut: `searchDeck` parks at `min: 0`, so
  // declining is already a legal answer to every printing here and an `optional`
  // wrapper would ask the same question twice. It is why the leading alternative
  // is not a capture — nothing downstream could use it.
  match = ATTACK_HAND_SEARCH.exec(effect);
  if (match !== null) {
    const one = match[1];
    const many = match[4];
    // ⚠️ D238 — THE TABLE IS CONSULTED FIRST AND THE BRACE PATTERN ONLY EVER SEES
    // A PHRASE NO ROW CLAIMED, which is `CONDITIONAL_DAMAGE_CLAUSES`' ordering
    // rule one family over. **This anchor needed NO regex change at all**: its
    // `[^,.]+?` capture has always admitted a brace phrase, and the table's
    // silence was the whole refusal — so the fix here is one `??` and the pattern
    // that answers it.
    const filter =
      one === undefined
        ? (HAND_SEARCH_PLURAL.get(many ?? "") ?? typedNounFilter(many ?? "", true))
        : (HAND_SEARCH_SINGULAR.get(one) ?? typedNounFilter(one, false));
    // The absent count IS the article, `ATTACK_DRAW`'s reading for the fourth
    // slice running; `max >= 1` keeps a printed "up to 0" (unspelled by any card)
    // on the loud path rather than deriving a search that moves nothing and
    // shuffles anyway.
    const max = match[3] === undefined ? 1 : Number(match[3]);
    const revealed = (match[2] ?? match[5]) !== undefined;
    if (filter !== undefined && max >= 1) {
      return [
        { op: "searchDeck", filter, dest: "hand", max, ...(revealed ? { reveal: true } : {}) },
        { op: "shuffleDeck" },
      ];
    }
  }
  // ⚠️⚠️ 🆕 D307 — THE DECK SEARCH THAT PUTS THE CARD ON *THIS POKÉMON*, i.e. the
  // family D277 first refused and D305/D306 priced. D230's two-op shape at a third
  // destination — and the destination is what made it a new op rather than a third
  // `dest` word: a zone can be named in a `CardFilter` + a union member, a BODY
  // cannot (see `evolveFromDeck`'s own doc block above for the whole argument, the
  // catalog fact that removes the on-evolve trigger, and the §8.1 sweep that
  // removes the KO stage).
  //
  // 🛑 SIX LEGAL PRINTINGS FOR ONE ARM, LANDING IN **TWO DIFFERENT SUMMANDS** OF
  // `BUILT.attack` — and saying which is the whole of D306's lesson. The RAW
  // summand is `legalAttackCorpus().filter(resolvedByAnyReader)` (censusAtHead's
  // D274 block), keyed on the READER over the whole legal corpus with `programFor`
  // nowhere in the addition, so this line collects Eevee ×2, Dwebble and Team
  // Rocket's Pupitar **without a registry row between them** (1136 → 1140). The
  // SPLIT summand is keyed on the same reader applied to the SPLIT string, so
  // Exeggcute's two licensed printings arrive there (11 → 13, CLOSING that term at
  // 5 of 5). The `+4` REGISTRY summand does not move at all.
  //
  // ⚠️ AND THAT IS WHY NO REGISTRY ROW IS AUTHORED FOR THE OTHER FOUR CARDS. The
  // handoff asked for four; a row would move no summand, and `conventions.md`'s
  // standing rule — *an arm transfers across sets; a registry row does not* — cuts
  // the other way: the arm already serves Glimmet and Finizen the day they rotate
  // back in. `precociousEvolution.test.ts` §4 therefore stays GREEN and correctly
  // still reads "not in the registry"; §2's refusal rung is the tripwire that trips.
  if (ATTACK_EVOLVE_FROM_DECK.test(effect)) {
    return [{ op: "evolveFromDeck" }, { op: "shuffleDeck" }];
  }
  // ⚠️⚠️ 🆕 D308 — THE ITERATED HALF OF THE SAME FAMILY, and the row D307 priced
  // LAST turns out to be the cheapest and the biggest. `censusAtHead.test.ts`'s
  // row 0 held 13 legal printings, D307 took 6, and of the 7 that remained this
  // sentence is **4** — Vivillon `sv08-007`/`-193`, Reuniclus `sv10.5b-039`/
  // `svp-212`, one byte-identical corpus record.
  //
  // 🛑 D307's HANDOFF SAID THIS REMAINDER NEEDED "A BODY-CHOICE STAGE IN FRONT OF
  // THE CARD CHOICE — A SECOND PARK ON AN OP THAT ALREADY PARKS ONCE". That is
  // right about the Duosion sentence and wrong about this one: *"for each"* is
  // not a choice. The op below asks NOTHING and resolves synchronously into
  // D216's `schedule`, one already-parking `evolveFromDeck` per occupied bench
  // slot, and `runProgram` unshifts them onto the queue exactly as the three
  // gates splice their branches. **ONE blocker, THREE different surcharges** —
  // and D307's own DOUBT TWO said so while its headline did not.
  //
  // SAME D230 TWO-OP SHAPE, and the trailing `shuffleDeck` is deliberately ONE:
  // the printed "Then, shuffle your deck." follows the whole iteration, and
  // `schedule` unshifts AHEAD of the rest of the queue, so it lands after every
  // placement without the scheduler having to carry it.
  //
  // ⚠️ THIS MOVES THE **RAW** SUMMAND OF `BUILT.attack` AND ONLY THAT ONE
  // (1140 → 1144, sentences 301 → 302). Raw is keyed on the READER over the whole
  // legal corpus with `programFor` nowhere in the addition, so the arm collects
  // both Vivillon and both Reuniclus printings with NO registry row between them;
  // the `+4` registry summand is registry-keyed and does not move, and the SPLIT
  // summand is keyed on the split string and stays CLOSED at 13 (this sentence
  // carries no gate clause).
  if (ATTACK_EVOLVE_FROM_DECK_EACH_BENCHED.test(effect)) {
    return [{ op: "evolveFromDeckEachBenched" }, { op: "shuffleDeck" }];
  }
  // ⚠️⚠️ 🆕 D309 — THE BODY-CHOICE HALF, AND THE ROW D307 DESCRIBED CORRECTLY WHILE
  // NAMING THE WRONG SENTENCE AS ITS EXEMPLAR. Duosion `sv10.5b-038`/`-119` (2
  // legal printings, ONE corpus record) prints *"...a card that evolves from **1 of
  // your Pokémon**..."*, which IS a choice — so this is the second park D307 priced
  // and D308 found it did not owe: ONE asker op, ONE `continuationOps` member, and
  // the existing `evolveFromDeck` doing the card half with its subject supplied.
  //
  // SAME D230 TWO-OP SHAPE. The trailing `shuffleDeck` is the deriver's own second
  // op, so it sits BEHIND both parks and fires on the whiff, on the decline and on
  // the placement alike — one printed sentence, one shuffle.
  //
  // ⚠️ THIS MOVES THE **RAW** SUMMAND OF `BUILT.attack` AND ONLY THAT ONE
  // (1144 → 1146, sentences 302 → 303). Raw is keyed on the READER over the whole
  // legal corpus with `programFor` nowhere in the addition, so the arm collects both
  // Duosion printings with NO registry row between them; the `+4` registry summand
  // is registry-keyed and does not move, and the SPLIT summand stays CLOSED at 13
  // (this sentence carries no gate clause). ⚠️ NO REGISTRY ROW IS AUTHORED, for
  // D307's reason verbatim — and here the arm's transfer value is on the record
  // rather than hypothetical: Indeedee `sv01-153` prints the identical sentence and
  // is `legal_standard = 0` today.
  if (ATTACK_EVOLVE_FROM_DECK_BODY_CHOICE.test(effect)) {
    return [{ op: "evolveFromDeckChosen" }, { op: "shuffleDeck" }];
  }
  // ⚠️⚠️ 🆕 D315 — THE MULTI-BODY HALF, WHICH CLOSES THE FAMILY. Team Rocket's
  // Nidorina `sv10-115` "Dark Awakening" (1 legal printing, ONE corpus record)
  // prints D308's ITERATION over a list the player CHOOSES: *"Choose up to 2 of
  // your {D} Pokémon. For each of those Pokémon, …"*.
  //
  // 🛑 THE HANDOFF PRICED THIS AS A REGISTRY ROW AND IT IS AN ARM, WHICH IS THE
  // ONE THING A PRICE CANNOT GET WRONG WITHOUT MOVING THE WRONG NUMBER.
  // `BUILT.attack`'s raw summand is keyed on the READER over the whole legal
  // corpus with `programFor` nowhere in the addition (censusAtHead's D274 block),
  // so an authored row for Nidorina would buy ZERO printings while this line buys
  // one. `conventions.md`'s *an arm transfers across sets* points the same way,
  // and the three siblings above are all arms.
  //
  // ⚠️ TWO CAPTURES, THREADED RATHER THAN HARD-CODED. The count is the printed
  // "up to 2"; the brace code goes through `POKEMON_TYPE_BY_CODE` — the same table
  // every other brace-coded noun in this reader asks — and an unrecognised code
  // falls to the LOUD path rather than to a default type, which is the standing
  // rule for a parameterised anchor whose vocabulary is schema-derived.
  //
  // SAME D230 TWO-OP SHAPE, and the trailing `shuffleDeck` is deliberately ONE:
  // the printed "Then, shuffle your deck." follows the whole iteration, and the
  // continuation unshifts the per-body ops AHEAD of it exactly as D308's
  // `schedule` does — so the sentence's one printed shuffle stays one shuffle
  // across the decline, the whiff and two placements alike.
  //
  // ⚠️ THIS MOVES THE **RAW** SUMMAND OF `BUILT.attack` AND ONLY THAT ONE
  // (1146 → 1147, sentences 303 → 304). The `+13` REGISTRY summand is
  // registry-keyed and does not move — NO registry row is authored — and the
  // SPLIT summand stays CLOSED at 13 (this sentence carries no gate clause).
  const eachChosen = ATTACK_EVOLVE_FROM_DECK_EACH_CHOSEN.exec(effect);
  if (eachChosen !== null) {
    const max = Number(eachChosen[1]);
    const pokemonType = POKEMON_TYPE_BY_CODE[eachChosen[2] ?? ""];
    // `max >= 1` keeps an unprinted "up to 0" on the loud path rather than
    // deriving a program that chooses nothing and shuffles anyway —
    // `ATTACK_HAND_SEARCH`'s guard one family over, at its second site.
    if (pokemonType !== undefined && max >= 1) {
      return [{ op: "evolveFromDeckEachChosen", max, pokemonType }, { op: "shuffleDeck" }];
    }
  }
  // ⚠️⚠️ D232 — THE OPPONENT-HAND FAMILY, backlog row 7. Three anchors, two ops,
  // 20 legal printings; the census and the arithmetic are on the constants above
  // and in `opponentHandFamily.test.ts`.
  //
  // THREE ARMS AND NOT ONE, WHICH IS A FINDING RATHER THAN A CONCESSION. The
  // previous four slices on this page each collapsed a "~N arms" estimate into a
  // single anchor because their sentences differed only in a NOUN. These differ
  // in the VERB — reveal / discard / choose-and-shuffle — and a verb is what
  // selects the op, so an alternation over the three would have to dispatch on
  // which branch matched, i.e. would be these three arms with the reader's job
  // moved somewhere harder to read.
  //
  // NO CAPTURE GROUP ON ANY OF THE THREE, AND NONE IS OWED: no printed
  // Standard-legal sentence in this family carries a number ("Choose 2 random
  // cards…" exists and is ROTATED), a noun ("a random CARD" is uncategorised on
  // every printing) or an owner. The two ops therefore take one field between
  // them, and that field's two values are both printed — which is the whole test
  // for whether a field is falsifiable (D231).
  if (ATTACK_REVEAL_OPPONENT_HAND.test(effect)) {
    return [{ op: "revealOpponentHand" }];
  }
  if (ATTACK_RANDOM_DISCARD_FROM_HAND.test(effect)) {
    return [{ op: "randomFromOpponentHand", to: "discard" }];
  }
  if (ATTACK_RANDOM_SHUFFLE_FROM_HAND.test(effect)) {
    return [{ op: "randomFromOpponentHand", to: "deck" }];
  }
  // The fourth arm, and the ONLY one in this slice that costs nothing but itself:
  // an op that has been in the union since M5, reached by a sentence nobody had
  // read. NO `filter` — the printed noun is the bare "a card", and D135's rule
  // says an absent field means what the sentence means (contrast Greavard's arm
  // above, whose `supporter` is a printed word).
  if (ATTACK_REVEAL_AND_BOTTOM.test(effect)) {
    return [{ op: "bottomFromOpponentHand" }];
  }
  // 🆕 D297 — the FIFTH arm, Lickitung's "up to 2". ONE op field (`upTo`), no new
  // op, no new prompt kind, no new choice kind and NO registry row: this is a
  // deriver-only sentence, so `raw.length` and the non-attack pool move by ZERO.
  // The `filter` is the printed noun with NO `maxHp` rider — Mandibuzz's 70 is
  // that card's word and this sentence does not carry it (D135: an absent field
  // means what the sentence means).
  match = ATTACK_REVEAL_AND_BENCH_UP_TO.exec(effect);
  if (match !== null) {
    const upTo = Number(match[1]);
    if (upTo >= 1 && upTo <= BENCH_MAX) {
      return [
        { op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench", upTo },
      ];
    }
  }
  // ⚠️⚠️ D234 — the discard-pile attach, backlog row 9. ONE arm for twelve printed
  // sentences and 12 of the row's 17 legal printings; the census, the five it
  // refuses and the count-versus-expansion split are on the constants above.
  //
  // **ZERO NEW OP FIELDS AND ZERO INTERPRETER LINES.** `attachEnergyFrom` has
  // carried `source: "discard"` since M5, `targetType`/`benchOnly` since D204 and
  // `toSelf`/`count` since D205/D221 — this arm is a text parser over fields six
  // registry rows already set, which is the whole reason the row ranked where it
  // did. It is also the first time an ATTACK produces the op at all: every prior
  // producer is a registry Ability, so `programPlayable`'s would-only-whiff gate
  // (cardplay.ts) prices at **zero** here — attacks never consult it (§8: the
  // attack is already declared and paid for), and the row's own ability half is a
  // separate decision precisely because those printings ARE card plays.
  //
  // ⚠️ D246 — THE BODY OF THIS ARM IS NOW `attachFromZoneProgram`, SHARED WITH
  // THE OTHER TWO ANCHORS THE SAME CLAUSE BUILDS. It is also how this arm gained
  // a printing without a line of its own: Landorus `sv08-110` "Fist of Focus"
  // prints the BARE noun ("Attach **an** Energy card from your discard pile to
  // this Pokémon.", 1 legal), and the clause the hand side needed for Snorlax
  // reaches this zone by construction. **A widened NOUN transfers across every
  // zone the factory serves** — which is the exact converse of D236's finding
  // that a widened ZONE transfers the anchor and not the family.
  match = DISCARD_ATTACH.exec(effect);
  if (match !== null) {
    const program = attachFromZoneProgram(match, "discard");
    if (program !== null) return program;
  }
  // ⚠️⚠️ D236 — the same attach from the HAND, backlog row 12. ONE arm plus one
  // optional trailing group for four printed sentences and 9 of the row's 16
  // legal attack printings; the census, D235's graded prediction, this slice's
  // own part-wrong one and the read-site pricing are on the constants above.
  //
  // THE ANCHOR IS D234'S, BUILT BY THE SAME FACTORY WITH THE ZONE PHRASE AND THE
  // TAIL AS ARGUMENTS — so "row 12 is row 9 one word over" is a fact about the
  // source rather than a claim about it. The DESTINATION TABLE is D234's too,
  // reused verbatim, which is exactly what D235's finding predicted would be
  // possible here and impossible one op over.
  //
  // ⚠️ D246 — THE TAIL IS NOW TWO AXES WIDE (an AMOUNT and a PRONOUN) and the
  // body is `attachFromZoneProgram`, shared with the discard anchor and with the
  // gated one below. The heal's `"all"` is the ABSENT numeric group — the same
  // "the absent form is the printed one" reading `count` takes at the other end
  // of the sentence — so a printed 60 and a printed "all" reach `healTarget`'s
  // two authored value shapes without a branch of their own.
  match = HAND_ATTACH.exec(effect);
  if (match !== null) {
    const program = attachFromZoneProgram(
      match,
      "hand",
      // Group 6 is the whole optional tail; 7 its number and 8 its pronoun. The
      // tail's PRESENCE is group 6, not group 7 — "heal all damage" spells no
      // number, so keying off the number would read every "all" printing as
      // having no tail at all.
      match[6] === undefined
        ? undefined
        : { amount: match[7] === undefined ? "all" : Number(match[7]), pronoun: match[8] ?? "" },
    );
    if (program !== null) return program;
  }
  // ⚠️⚠️ D247 — ALOLAN EXEGGUTOR EX "TROPICAL FRENZY", backlog row 12's largest
  // sentence: the UNBOUNDED count out of the HAND. ONE new op
  // (`attachFromHand`), ZERO new prompt kinds and ZERO wire-schema fields — the
  // park is the compound `attachCards` prompt two ops have produced since M5.
  //
  // ⚠️ CHECKED BEFORE THE THREE ARMS ABOVE WOULD EVER SEE IT, and the order is
  // free rather than load-bearing: `HAND_ATTACH` demands a printed article or an
  // "up to N", so "any number of" cannot reach it. Placed here anyway because
  // reading the arms top-to-bottom should walk the same sentence from its
  // narrowest form to its widest.
  match = ATTACK_HAND_ANY_NUMBER_ATTACH.exec(effect);
  if (match !== null) {
    const destination = DISCARD_ATTACH_DESTINATIONS.get(match[2] ?? "");
    // 🛑 THE ONE CONDITION THAT IS ABOUT THE PROGRAM RATHER THAN THE TEXT, and
    // the whole reason the destination table can be shared with an op that does
    // not build the same program: only the `anyWay` phrases mean "the cards may
    // land on different bodies", which is the single question this op's compound
    // park asks. A phrase naming ONE body ("to this Pokémon", "to 1 of your
    // Benched Pokémon") pins an UNBOUNDED batch to a single target — a shape no
    // card prints and `attachEnergyFrom.count` could not express either, since
    // that field is a number. Refused to the loud ATTACK_EFFECT_SKIPPED path
    // (0 printings today), never reinterpreted.
    // 🛑 AND THE SECOND CONDITION IS THE ONE A BUILD THAT ONLY READ `anyWay`
    // WOULD GET SILENTLY WRONG. "your **Benched** Pokémon in any way you like" is
    // an `anyWay` row too, and its riders carry `benchOnly` — a field
    // `attachFromHand` does not have, because no printing of THIS sentence spells
    // the zone word. Reading that phrase would drop the narrowing and offer the
    // Active, an over-wide attach that passes every "how many landed" assertion.
    // So the arm refuses any destination carrying a rider it cannot express,
    // rather than trusting that the two tables happen to line up. 0 legal
    // printings today; driven as a near-miss, and the day one is printed the op
    // gains the field and this test starts admitting it.
    if (destination?.anyWay === true && Object.keys(destination.riders).length === 0) {
      const energyType = match[1] === undefined ? undefined : ENERGY_TYPE_BY_CODE[match[1]];
      // The brace code resolves through the SAME map its character class was
      // built from, so an unresolvable code is unreachable by construction; the
      // `undefined` guard is the type system's, not a catalog claim.
      if (match[1] === undefined || energyType !== undefined) {
        return [
          {
            op: "attachFromHand",
            // "Basic Energy cards" — never `anyEnergy`: the printed adjective
            // excludes Special Energy, and never `providesEnergy`, because a card
            // in the hand provides nothing (§6.5).
            filter:
              energyType === undefined
                ? { kind: "basicEnergy" }
                : { kind: "basicEnergy", energyType },
            // NO target riders: the print says the bare "your Pokémon", and
            // `destination.riders` is empty on both `anyWay` rows. Spreading it
            // would spell a field the op does not have.
          },
        ];
      }
    }
  }
  // ⚠️⚠️ D246 — KILOWATTREL EX `sv08-068` "RETURN CHARGE": the same clause as a
  // §9.2 CONSEQUENT. `switchActive {recordAs: "moved"}` → `recordGate` → the
  // attach the two arms above already build, which is Iron Bundle's D227 program
  // with the consequent swapped and D206's authored Prime Catcher shape under
  // both. ZERO new ops, ZERO new op fields, and the ONE interpreter line it costs
  // is a `describeBranch` case — the park the switch raises has to say what the
  // answer buys, and without the arm it would announce the switch and stay silent
  // about the Energy.
  //
  // ⚠️ THE GATE IS THE CLAUSE NEITHER `needs` CELL PRICED, AND IT IS THE WHOLE
  // CARD ON ONE BOARD: an attacker with an EMPTY BENCH cannot switch,
  // `switchActive` files nothing, `recordGateHolds` reads the empty slot as
  // false, and NOTHING IS ATTACHED. Building the two ops without it accelerates
  // on a board where the printed card does nothing at all.
  match = ATTACK_SELF_SWITCH_THEN_HAND_ATTACH.exec(effect);
  if (match !== null) {
    const program = attachFromZoneProgram(match, "hand");
    if (program !== null) {
      return [
        { op: "switchActive", recordAs: "moved" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        { op: "recordGate", slot: "moved", then: program },
      ];
    }
  }
  // ⚠️⚠️ D235 — the deck search that ATTACHES, backlog row 10. ONE arm plus one
  // optional trailing group for fourteen printed sentences and 20 of the row's 28
  // legal attack printings; the census, the prediction's grade, the eight it
  // refuses and the read-site pricing are on the constants above.
  //
  // ZERO NEW OPS AND ZERO NEW OP FIELDS: `attachFromDeck` has carried
  // `filter`/`max`/`targetType`/`benchOnly`/`toSelf`/`recordAs` since M5-D50, and
  // `recordGate` + `applyStatus` have carried the §9.2 tail since Janine's Secret
  // Art. The one interpreter line this slice adds is a DESCRIBER case, not a
  // behaviour (see `describeBranch`) — without it the park would announce the
  // attach and stay silent about the poison it buys.
  //
  // ⚠️ THE ORDER MATTERS AND IS NOT ARBITRARY: this arm sits AFTER
  // `ATTACK_HAND_SEARCH` and `ATTACK_BENCH_SEARCH`, which claim the same opening
  // five words. Neither can swallow these sentences (they weld "into your hand" /
  // "onto your Bench" to the pronoun) — but the census's own CASE chain is the
  // order the counts were derived in, so this reader answers where the query
  // said it answers.
  match = DECK_SEARCH_ATTACH.exec(effect);
  if (match !== null) {
    const destination = DECK_SEARCH_ATTACH_DESTINATIONS.get(match[4] ?? "");
    // Exactly one of the two branches matched, so at most one code group is set.
    const code = match[1] ?? match[3];
    const energyType = code === undefined ? undefined : ENERGY_TYPE_BY_CODE[code];
    // The absent count IS the article — `ATTACK_DRAW`'s reading for the sixth
    // slice running.
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (
      destination !== undefined &&
      (code === undefined || energyType !== undefined) &&
      // A printed 0 derives to a search that moves nothing and shuffles anyway;
      // the ceiling is the ingested-text guard `DISCARD_ATTACH` carries, shared
      // rather than re-picked so the two attach families cannot disagree about
      // what counts as a printed number.
      count >= 1 &&
      count <= MAX_PRINTED_ATTACH_COUNT &&
      // 🛑 THE BATCH RULE, AND THE ONE CONDITION IN THIS ARM THAT IS ABOUT THE OP
      // RATHER THAN THE TEXT: "attach them to 1 of your Pokémon" pins every card
      // onto ONE chosen body, and `attachFromDeck`'s `attachCards` park hands back
      // a MAP from card to target — so at count > 1 the program would silently
      // permit a split the card does not print. Refused to the loud
      // ATTACK_EFFECT_SKIPPED path instead (3 legal printings, measured).
      (destination.batch || count === 1)
    ) {
      const attach: Extract<EffectOp, { op: "attachFromDeck" }> = {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", ...(energyType === undefined ? {} : { energyType }) },
        max: count,
        ...destination.riders,
        // The §9.2 filing exists ONLY when the gate that reads it does — an
        // unread `recordAs` would be a field with no observable meaning, and
        // these rows are compared by value against hand-authored registry ones
        // (D135).
        ...(match[5] === undefined ? {} : { recordAs: "moved" as const }),
      };
      // "Then, shuffle your deck" is the trailing op on every printing in this
      // family, and it runs on the whiff and the decline alike — the Nest Ball
      // pattern, read off text rather than authored per card.
      return match[5] === undefined
        ? [attach, { op: "shuffleDeck" }]
        : [
            attach,
            { op: "shuffleDeck" },
            {
              op: "recordGate",
              slot: "moved",
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
              then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
            },
          ];
    }
  }
  // ⚠️⚠️ D237 — the discard pile into the HAND or onto the BENCH, backlog row 13.
  // ONE anchor for five printed sentences and 10 of the row's 16 legal attack
  // printings (26 of the family's 39 CATALOG printings); the census, the graded
  // prediction, the six it refuses and the read-site pricing are on the constants
  // above.
  //
  // ONE NEW `CardFilter` MEMBER (`trainerCard`) AND ONE NEW OP `dest` VALUE
  // (`"bench"`), and the NOUN TABLE the backlog row priced was already built —
  // `HAND_SEARCH_NOUNS` (D231), shared rather than copied, which is why a row
  // added for this family is admitted by the deck search on the same commit.
  //
  // ⚠️ THE TWO AXES ARE INDEPENDENT AND BOTH ARE PRINTED ON BOTH VALUES, which is
  // what makes this one arm rather than five: the NOUN varies over the table (and
  // over a proper NAME), the DESTINATION varies over hand and Bench, and the
  // catalog prints a table noun onto the Bench ("Put a Pokémon … onto your
  // Bench.", 3 printings) as well as a name. Neither axis can be inferred from
  // the other.
  match = ATTACK_DISCARD_RETRIEVAL.exec(effect);
  if (match !== null) {
    const dest = DISCARD_RETRIEVAL_DESTINATIONS.get(match[5] ?? "");
    // Exactly one of the three noun groups matched. The singular branch resolves
    // through the SINGULAR map, the plural branch through the PLURAL map, and the
    // NAME group is `byName` without a map at all — its "table" is the catalog.
    // ⚠️ D238 — each table lookup falls through to the brace pattern, never the
    // other way round, so a literal row always wins and the pattern only sees
    // what no row claimed.
    const filter: CardFilter | undefined =
      match[1] !== undefined
        ? (HAND_SEARCH_SINGULAR.get(match[1]) ?? typedNounFilter(match[1], false))
        : match[3] !== undefined
          ? (HAND_SEARCH_PLURAL.get(match[3]) ?? typedNounFilter(match[3], true))
          : match[4] === undefined
            ? undefined
            : { kind: "byName", name: match[4] };
    // The absent count IS the article — `ATTACK_DRAW`'s reading for the eighth
    // slice running, and here it is the op's `max` rather than a rider, so a
    // singular printing emits `max: 1` outright (there is no absent-means-one
    // field to leave off: `max` is REQUIRED on this op).
    const max = match[2] === undefined ? 1 : Number(match[2]);
    if (
      dest !== undefined &&
      filter !== undefined &&
      // The same printed-number guard the three attach anchors carry, shared
      // rather than re-picked: a printed 0 derives to a silent no-op and an
      // unbounded `\d+` lets one malformed third-party row size a prompt.
      max >= 1 &&
      max <= MAX_PRINTED_ATTACH_COUNT &&
      // 🛑 THE ONE CONDITION IN THIS ARM THAT IS ABOUT THE PROGRAM RATHER THAN THE
      // TEXT: a Bench destination may only carry a POKÉMON noun. Nothing
      // downstream re-checks it (`searchDeck`'s precedent, named on the op), and
      // a derived "Put a Supporter card from your discard pile onto your Bench."
      // would otherwise put a Supporter into play. 0 printings today — refused to
      // the loud ATTACK_EFFECT_SKIPPED path, and driven as a near-miss.
      (dest !== "bench" || BENCHABLE_RETRIEVAL_KINDS.has(filter.kind))
    ) {
      // NO `recordAs` and NO `exclude`: no printing in this family carries a §9.2
      // tail or Superior Energy Retrieval's parenthetical (measured over all 18
      // catalog sentences), and an unread field would be one with no observable
      // meaning (D135). NO trailing `shuffleDeck` either — that op belongs to the
      // `dest: "deck"` printings, which this family's attack column never spells.
      return [{ op: "discardPileRetrieval", filter, dest, max }];
    }
  }

  // ⚠️⚠️ D241 — LOOK AT THE TOP N, backlog row 11. THREE anchors for 10 of the
  // row's 15 legal attack printings; the re-derived census, the wider verb sweep,
  // the five refusals and the read-site pricing are on the constants above.
  //
  // ONE NEW OP FIELD (`lookAtTopN.dest`, a WIDENING by D131's test), no new op,
  // no new prompt kind, no new park, no `attack.ts`/`flow.ts`/`rng.ts` diff and
  // no `MATCH_RECORD_VERSION` bump.
  match = ATTACK_LOOK_TOP_BENCH.exec(effect);
  if (match !== null) {
    const n = Number(match[1]);
    // The same printed-number guard every arm here carries, shared rather than
    // re-picked: a printed 0 derives to a window nobody looks at, and an
    // unbounded `\d+` lets one malformed third-party row size a prompt. The
    // ceiling is the attach family's, because it is the same question (how large
    // a printed window this engine will believe) and the largest printing in
    // EITHER family is Lapras ex's 20.
    if (n >= 1 && n <= MAX_PRINTED_LOOK_WINDOW) {
      return [
        {
          op: "lookAtTopN",
          n,
          // 🛑 `anyPokemon` IS IN `BENCHABLE_RETRIEVAL_KINDS`, WHICH IS THE GUARD
          // THIS ARM DOES NOT HAVE TO RUN. D237's arm needs the check because its
          // noun comes out of a TABLE and could be a Supporter; here the noun is
          // the literal printed word "Pokémon", welded into the pattern, so the
          // filter cannot be anything else. Asserted from the outside in
          // `derivedLookAtTop.test.ts` rather than left to this comment.
          filter: { kind: "anyPokemon" },
          // 🆕 D333 — THE PRINTED "any number of", RE-POINTED FROM `max: n`.
          // D241's reading was right about the PREDICATE (the candidate set is a
          // subset of the top `n`, so `max: n` is a bound that cannot bind) and
          // wrong about the WORDS: `lookNote` reads this same field and captions
          // `max > 1` as "up to N", so these four printings said "put up to 8
          // Pokémon onto your Bench" over a sentence that prints no number at
          // all. `"any"` is now a member of the op (see its doc block), the park
          // resolves it against the candidate count, and the caption reproduces
          // the print. The BENCH is what really caps the take, and
          // `revealFromTop` clamps there (§4's five) exactly as before.
          max: "any",
          dest: "bench",
        },
        // "Shuffle the other cards back into your deck" — the trailing op, off
        // the printed text, running on the whiff and the decline alike (the Nest
        // Ball pattern this op has followed since M5).
        { op: "shuffleDeck" },
      ];
    }
  }
  match = ATTACK_LOOK_TOP_ATTACH.exec(effect);
  if (match !== null) {
    const n = Number(match[1]);
    if (n >= 1 && n <= MAX_PRINTED_LOOK_WINDOW) {
      return [
        {
          op: "attachFromTop",
          n,
          // "Energy cards" — Basic OR Special, so `anyEnergy` and never
          // `basicEnergy`; the op's own doc block makes exactly this call for
          // Hydreigon's identical noun. NEVER `providesEnergy`: provision is a
          // while-ATTACHED property and a card in the deck provides nothing.
          filter: { kind: "anyEnergy" },
          // The printed "any number of", which on THIS op is a real union member
          // rather than a bound — the candidate set is the cap, and a card may
          // not be attached twice.
          max: "any",
          // NO `discardRest`: the leftovers clause here is "**Shuffle** the other
          // cards back into your deck", which is the trailing op below. The op's
          // doc records why the two clauses are not symmetric.
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  // 🆕🆕 D341 — "…and put them back IN ANY ORDER", backlog row 11's ordered-answer
  // residue. ONE anchor for 4 of the 6 printings in its own grammar, and the two
  // it refuses are refused by the pattern rather than by a guard (see the
  // constant). ONE new op, ONE new prompt kind, ONE new choice kind, no
  // `attack.ts`/`flow.ts`/`rng.ts` diff and NO `MATCH_RECORD_VERSION` bump — the
  // prompt and the choice are ADDED INHABITANTS of persisted unions, which is
  // `confirm`'s recorded rule (D125's widening test, not D309's rename case).
  match = ATTACK_REORDER_TOP.exec(effect);
  if (match !== null) {
    // Exactly one of the two groups is defined — the alternation is closed and
    // the arms are mutually exclusive by their fifth word. `side` is derived from
    // WHICH group matched rather than from a re-scan of the text, so the reading
    // and the possessive cannot drift apart.
    const own = match[1];
    const n = Number(own ?? match[2]);
    // The shared printed-number guard, unchanged from the three arms above.
    if (n >= 1 && n <= MAX_PRINTED_LOOK_WINDOW) {
      return [
        own === undefined ? { op: "reorderTop", n, side: "opponent" } : { op: "reorderTop", n },
      ];
    }
  }
  // 🆕🆕 D342 — "Search your deck for N cards, shuffle your deck, then put those
  // cards on top of it in any order." Dialga `sv08-135` "Time Manipulation", the
  // `attacks_json` half of a 4-printing sentence whose other three are Supporter
  // registry rows (`CIPHERMANIACS_CODEBREAKING`). The two halves are the SAME
  // three ops in the same order and are asserted equal to each other in
  // `derivedSearchTopOrder.test.ts` — one sentence must not get two readings
  // because it is printed in two columns.
  match = ATTACK_SEARCH_TOP_ORDER.exec(effect);
  if (match !== null) {
    const n = Number(match[1]);
    // The shared printed-number guard, the same one the three look arms above
    // carry: the ordering window this program ends in is `n` cards deep, so the
    // bound that protects `reorderTop` protects this too.
    if (n >= 1 && n <= MAX_PRINTED_LOOK_WINDOW) {
      return searchTopOrderProgram(n);
    }
  }
  if (ATTACK_LOOK_TOP_DISCARD.test(effect)) {
    return [
      {
        op: "lookAtTopN",
        // The printed singular "the top card" — one, not a captured number.
        n: 1,
        // The printed sentence names NO noun ("that card"), so the filter admits
        // everything in the window. `anyCard` is the existing member D231's noun
        // table already spells; this arm invents nothing.
        filter: { kind: "anyCard" },
        max: 1,
        dest: "discard",
      },
      // NO trailing `shuffleDeck`, and the absence is printed rather than
      // forgotten: this sentence has no leftovers clause because a one-card
      // window has no leftovers. Adding one would shuffle a deck the print
      // leaves alone — and on the DECLINE it would scramble a top the player
      // deliberately kept, which is the opposite of what the card offers.
    ];
  }

  // 42. "Shuffle 1 of your [opponent's] Benched Pokémon and all attached cards
  //     into (their|your) deck." / "Put 1 of your Benched Pokémon and all
  //     attached cards into your hand." / the coin-gated third-person spelling —
  //     D299's `returnBenched`, 5 printings on 3 sentences here plus Illumise
  //     `sv06-010` behind D282's split (the op's doc block carries the census).
  match = RETURN_BENCHED.exec(effect);
  if (match !== null) {
    // The OWN-BOARD arms read `whose: "self"`; the two opponent spellings read
    // `"opponent"`. `dest` is not derived from the verb — the verb is derived
    // from the destination (see the op), so each arm states its destination and
    // the interpreter decides whether that implies a shuffle.
    if (match[2] !== undefined) return [{ op: "returnBenched", whose: "self", dest: "deck" }];
    if (match[3] !== undefined) return [{ op: "returnBenched", whose: "self", dest: "hand" }];
    const shuffleAway: EffectOp = { op: "returnBenched", whose: "opponent", dest: "deck" };
    // Sylveon's printed "Flip a coin. If heads, …" — the SAME op behind D126's
    // existing gate, not a fourth member. The `choose` verb its sentence spells
    // out loud is what every other arm here leaves to the park, so those three
    // opponent-side words add no field.
    if (match[4] !== undefined) {
      return [
        {
          op: "coinFlipGate",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [shuffleAway],
        },
      ];
    }
    return [shuffleAway];
  }

  return null;
}

/** A count-scaled damage clause — `per × (a counted resource)`, the parsed shape
    ALL THREE scaling families produce (the additive "+" reader
    `deriveAttackDamageBonus`, the "×"/multiply reader
    `deriveAttackDamageMultiplier` and — since D163 — the subtractive "−" reader
    `deriveAttackDamagePenalty`). Deliberately NOT an
    `EffectOp`: it is PRE-damage math the caller computes (attack.ts), NOT a step
    the interpreter runs — every `deriveAttackEffect` op instead reads a sentence
    that runs AFTER damage, so the scaling derivers are disjoint from the op deriver
    and a card carries at most one (the whole-sentence anchor means a scaling
    sentence never also derives an op). The three families differ ONLY in
    attack.ts's fold — additive folds `per × count` onto the printed base (Paldean
    Tauros "Raging Horns" — 10 per damage counter on the attacker), multiply makes
    it the WHOLE damage with no base (Pecharunt ex "Irritated Outburst"), and the
    subtractive one KEEPS the base and takes `per × count` off it at the same
    pre-W/R step (Skeledirge ex "Burning Voice", Cetitan "Sweeping Tackle") — so
    they share this interface and the `count` evaluator. `count` is a union of REAL
    readers — the attacker's own damage counters, since 0.35.0 the opponent's TAKEN
    Prizes, since 0.61.0 the opponent's Active RETREAT COST and since 0.113.0 the
    damage counters on the opponent's ACTIVE — a member each, not a second
    interface (plus D115's degenerate 0-or-1 `boardCondition` indicator).

    ⚠️ AND THE THREE FOLDS ARE NOT THREE PARTITIONS OF THE COUNT SOURCES: D167 put
    the attacker's own damage counters on the MULTIPLY fold too (Drifloon sv01-089
    "Balloon Blast" 30×, Onix swsh10.5-036 "Raging Swing" 50×), so that one source
    is now read by all three readers, told apart by the adjective alone — "more",
    "less", or nothing. That is precisely what an interface shared by fold rather
    than by source buys: the third arrival cost a regex and an `if`, and no arm of
    the evaluator below moved.

    ⚠️ `per` IS ALWAYS POSITIVE, IN ALL THREE. The direction is carried by WHICH
    READER answered, never by the sign of this number, because the only place a
    direction is observable is `DAMAGE_DEALT` — and that row reports one number per
    STEP AND DIRECTION (D155), with an ADDING field (`scaled`) whose presence guard
    and log crumb are both committed to the sign. A negative `per` here would be
    dropped from the row by `scaledTotal > 0` and rendered "+-40" by log.ts. */
export interface AttackDamageBonus {
  per: number;
  count: DamageCountSource;
}
/** The resource an `AttackDamageBonus` counts. Six members: the attacker's OWN
    damage counters (Paldean Tauros "Raging Horns"), the opponent's TAKEN Prizes
    (Charizard ex "Burning Darkness"), — since 0.61.0 — the {C} in the opponent's
    Active Pokémon's RETREAT COST (Heracross "Superpowered Throw" and its three
    siblings), — since 0.66.0 — a `boardCondition` INDICATOR, — since 0.113.0 —
    the damage counters on the OPPONENT'S ACTIVE (Dedenne "Second Bite", Espeon
    "Psychic Assault", Bloodmoon Ursaluna "Mad Bite"), and — since 0.115.0 — the
    damage counters on ALL OF THE ATTACKER'S OWN BENCHED Pokémon (Tyranitar
    swsh10.5-043 "Raging Crash"),
    each read by its own anchored
    sentence. The third is the only count source that is DERIVED rather than read
    off a field: attack.ts evaluates it through continuous.ts
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
    knew only the defender's).

    ⚠️ THE FIFTH IS THE FIRST MEMBER THAT IS THE MIRROR OF ANOTHER MEMBER (D168).
    `damageCountersOnSelf` and `damageCountersOnOpponentActive` tally the SAME
    resource — `InPlayPokemon.damage ÷ 10` — off two different bodies, and they are
    two members rather than one member with a `side` field because every consumer
    of this union dispatches on `kind` and nothing else: a `side` would have to be
    read by `scaledAttackDamage` anyway, and the three members that have no side at
    all would then carry a field they must ignore. It needs NO new argument —
    `scaledAttackDamage` already takes `state` and `defenderSeat` for the Prize and
    retreat-cost members — which is the whole of its evaluator cost.

    ⚠️ THE SIXTH IS THE FIRST THAT TALLIES OVER A ZONE RATHER THAN OFF ONE BODY
    (D170). `damageCountersOnYourBench` sums `damage ÷ 10` across every Pokémon on
    the ATTACKER's Bench — the same resource the two Active members read, over a
    LIST instead of a single body, so an empty Bench and a pristine Bench are the
    same 0 and neither Active is ever consulted. It is also the first counter
    member that reads the attacker's seat rather than an Active spot, and it needs
    no new argument either: `scaledAttackDamage` has taken `attackerSeat` since
    0.66.0 for the `boardCondition` indicator.

    ⚠️ THE SEVENTH AND EIGHTH COUNT BODIES RATHER THAN COUNTERS (D193), which is
    the first time this union tallies the Pokémon THEMSELVES. `opponentBenchCount`
    is the number of bodies on the DEFENDER's Bench and `bothSidesBenchCount` the
    number on BOTH Benches — neither reads `damage` at all, so they are the exact
    mirror-image mistake of `damageCountersOnYourBench` one line up: same zone
    walk, different question. Two members rather than one with a `side`, by D168's
    rule — and `bothSidesBenchCount` could not carry a `side` anyway, because its
    answer spans both.

    ⚠️ THE NINTH IS THE FIRST MEMBER WITH A PAYLOAD THAT IS NOT A CONDITION
    (D193). `energyOnOpponent` carries `{zone, energyType}`: WHICH opponent bodies
    to walk (the Active alone, or every Pokémon they have in play) and WHICH
    Energy to admit (`null` = every attached card, a `BasicEnergyType` = the
    provision filter, `"special"` = Special Energy cards). It is ONE member with a
    `zone` rather than two members for the reason D168 gives for the opposite
    answer: the two zones would each have to carry `energyType`, and duplicating
    the field that answers "which Energy counts" is precisely the second answer to
    one question D159 forbids. `boardCondition`'s `cond` is the precedent that a
    single member may carry its own payload without the side-less members paying
    for it.

    ⚠️ THE TENTH IS THE MIRROR OF THE NINTH, AND THE ONE THAT WAS BLOCKED (D196).
    `energyOnSelf` tallies the Energy attached to the ATTACKING body — the same
    resource `energyOnOpponent` reads off the other end of the table, and two
    members rather than one member with a `side` for D168's reason. It carries
    `energyType` and NOT a `zone`: the pool prints no board-wide spelling of "…
    attached to all of YOUR Pokémon", so a zone here would be a field no reader
    could ever vary — the same measurement `energyOnOpponent`'s ADDITIVE arm makes
    in the other direction, in the other axis.

    It is the LARGEST member of the family (21 legal printings, 38 catalog) and it
    arrived LAST, because its sentence was load-bearing as a NEGATIVE: Entei
    sv03-030 "Blaze Ball" was this engine's canonical unsimulated-"+" witness from
    0.35.0 until D196 re-homed that role onto Pachirisu sv01-068 "Everyone
    Discharge". D193 built this member, measured the assertions it turns red, and
    REVERTED rather than silently retire a fixture four suites depend on — the
    re-homing had to come first, which is why the biggest member is the tenth.

    ⚠️ THE TWELFTH CLOSES THE BENCH-BODY TRIO, AND IT IS THE ONLY MEMBER OF THIS
    UNION WHOSE ARRIVAL WAS BLOCKED BY SOMETHING THAT IS NOT ITS OWN ARITHMETIC
    (D282). `yourBenchCount` tallies the bodies on the ATTACKER's Bench — the
    third face of the noun `opponentBenchCount` and `bothSidesBenchCount` already
    read at the other two, and three members rather than one with a `side` for
    D168's reason (the both-sides answer is not about a seat at all, so it could
    never have been a value of that field). It reads `attackerSeat`, which
    `scaledAttackDamage` has taken since 0.66.0, so its evaluator cost is one
    `case` — and it is the ONLY member whose printed sentence was already
    fully spellable by an existing arm's arithmetic and STILL absent, because 7 of
    its 13 legal printings print the sentence BEHIND a D281 gate clause and every
    reader in this file is whole-sentence anchored. See `splitAttackGateClause`.

    ⚠️ THE ELEVENTH IS THE FIRST WHOSE ANSWER BOTH SEATS CONTRIBUTE TO (D196).
    `bothActivesEnergyCount` sums the Energy attached to the attacker's Active AND
    the defender's — the span `bothSidesBenchCount` has over the two Benches, one
    resource up, and so the same reason it cannot be a `side` on `energyOnSelf`:
    its answer is not about a seat at all. It carries NO payload, because the pool
    prints exactly one sentence for it and that sentence has no type filter (see
    SELF_ENERGY_BOTH_ACTIVES_SCALE). ADD-only, and by LEGALITY rather than by
    absence — unlike `bothSidesBenchCount`, its bare twin IS printed; it is simply
    0 legal. */
export type DamageCountSource =
  | { kind: "damageCountersOnSelf" }
  | { kind: "opponentPrizesTaken" }
  | { kind: "opponentActiveRetreatCost" }
  | { kind: "boardCondition"; cond: BoardCondition }
  | { kind: "damageCountersOnOpponentActive" }
  | { kind: "damageCountersOnYourBench" }
  | { kind: "bothSidesBenchCount" }
  | { kind: "opponentBenchCount" }
  | { kind: "yourBenchCount" }
  | {
      kind: "energyOnOpponent";
      zone: OpponentEnergyZone;
      energyType: BasicEnergyType | "special" | null;
    }
  | { kind: "energyOnSelf"; energyType: BasicEnergyType | "special" | null }
  | { kind: "bothActivesEnergyCount" };

/** WHICH of the opponent's bodies an `energyOnOpponent` count walks (D193). The
    two are printed as two whole noun phrases — "your opponent's Active Pokémon"
    and "all of your opponent's Pokémon" — and the difference is observable
    whenever the defender's Bench holds any Energy at all, so the discriminator is
    the printed phrase and never an inference from the amount.

    ⚠️ `"board"` IS ACTIVE + BENCH, not the Bench alone: "all of your opponent's
    Pokémon" includes the one in the Active Spot, so `active` is a strict SUBSET
    of `board` rather than its complement. `countEnergyInPlay` already reads "in
    play" that way (§6.3) and is what this arm delegates to, so the two readings
    of the same printed noun cannot drift. */
export type OpponentEnergyZone = "active" | "board";

/** Parse a printed additive damage-scaling sentence into its `per` amount and
    count source, or null when the text is anything but one of the five anchored
    sentence shapes this reads (self damage counters, the opponent's taken Prizes,
    the opponent's Active Retreat Cost, the damage counters on the opponent's ACTIVE
    (D168), and the leading-`If` conditional flat bonus
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
  // D168 — the OPPONENT-SIDE damage-counter count. Same fold, same `per >= 1`
  // guard, a different body: the only thing that separates this arm from the
  // first one above is the literal tail of its anchored sentence.
  const opponentCounters = OPPONENT_COUNTER_SCALE.exec(effect);
  if (opponentCounters !== null) {
    const per = Number(opponentCounters[1]);
    if (per >= 1) return { per, count: { kind: "damageCountersOnOpponentActive" } };
  }
  // D193 — the two BODY counts, both on this fold because both sentences carry
  // "more". Same `per >= 1` guard, a different resource: these tally Pokémon, not
  // the counters on them.
  const bothBench = BOTH_BENCH_SCALE.exec(effect);
  if (bothBench !== null) {
    const per = Number(bothBench[1]);
    if (per >= 1) return { per, count: { kind: "bothSidesBenchCount" } };
  }
  const opponentBench = OPPONENT_BENCH_SCALE.exec(effect);
  if (opponentBench !== null) {
    const per = Number(opponentBench[1]);
    if (per >= 1) return { per, count: { kind: "opponentBenchCount" } };
  }
  // D282 — the ATTACKER's own Bench as BODIES, placed directly after the two arms
  // it completes so the trio reads down the page in the order its noun is
  // printed. Same `per >= 1` guard, same shape; the seat is the only difference
  // and it is settled in the evaluator, not here.
  const yourBench = YOUR_BENCH_SCALE.exec(effect);
  if (yourBench !== null) {
    const per = Number(yourBench[1]);
    if (per >= 1) return { per, count: { kind: "yourBenchCount" } };
  }
  // D193 — the opponent's attached Energy, ACTIVE ZONE ONLY on this fold: the
  // board-zone spelling carries no "more" anywhere in the pool, so this arm
  // hard-codes `zone: "active"` rather than capturing a zone it can never vary.
  // An unresolvable type token falls through to `return null` and stays LOUD,
  // exactly as ATTACK_COIN_PER_ENERGY's does — the missing token and the
  // unrecognised one are told apart HERE, by the token, not by the lookup.
  const opponentEnergy = OPPONENT_ENERGY_SCALE.exec(effect);
  if (opponentEnergy !== null) {
    const per = Number(opponentEnergy[1]);
    const energyType = attachedEnergyFilter(opponentEnergy[2]);
    if (per >= 1 && energyType !== undefined) {
      return { per, count: { kind: "energyOnOpponent", zone: "active", energyType } };
    }
  }
  // D196 — the ATTACKER'S OWN attached Energy, the mirror of the arm directly
  // above and structurally identical to it: same `per >= 1` guard, same
  // `attachedEnergyFilter` so that an absent token is the UNTYPED reading and an
  // unresolvable one ("Basic Energy", "{C}") falls through to `return null` and
  // stays LOUD. The only thing separating the two arms is the literal tail of the
  // anchored sentence — "this Pokémon" instead of "your opponent's Active
  // Pokémon". No zone: the board-wide spelling of the attacker's own Energy is
  // unprinted (see SELF_ENERGY_SCALE).
  const selfEnergy = SELF_ENERGY_SCALE.exec(effect);
  if (selfEnergy !== null) {
    const per = Number(selfEnergy[1]);
    const energyType = attachedEnergyFilter(selfEnergy[2]);
    if (per >= 1 && energyType !== undefined) {
      return { per, count: { kind: "energyOnSelf", energyType } };
    }
  }
  // D196 — BOTH Actives' attached Energy. On this fold ONLY: the no-adjective twin
  // is printed but 0 legal, so `deriveAttackDamageMultiplier` deliberately has no
  // matching arm and that absence is pinned by a test. No type token to resolve —
  // the sentence prints none — so this arm needs no `attachedEnergyFilter` and
  // carries the `per >= 1` guard alone.
  const bothActivesEnergy = SELF_ENERGY_BOTH_ACTIVES_SCALE.exec(effect);
  if (bothActivesEnergy !== null) {
    const per = Number(bothActivesEnergy[1]);
    if (per >= 1) return { per, count: { kind: "bothActivesEnergyCount" } };
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

/** Parse a printed SUBTRACTIVE damage-scaling sentence — "This attack does {N}
    less damage for each damage counter on this Pokémon." (D163) — into the same
    `{per, count}` shape as its two siblings, `per` POSITIVE and the direction
    carried by which reader answered, or null for anything else. The one sentence
    this family prints with this sign; `count` is therefore always
    `damageCountersOnSelf` today, and the type is the shared one because the count
    evaluator is shared (`scaledAttackDamage`) rather than because the other four
    members are reachable from here.

    THE THIRD FOLD. The additive reader adds `per × count` to the printed base and
    the multiply reader makes it the whole damage; this one KEEPS the printed base
    (Cetitan's "200-" really is 200 at zero counters) and SUBTRACTS — which is why
    attack.ts routes it into the pre-W/R `debuff` term beside D149's installed
    weakener and D151's aura rather than into `scaled`. See SELF_COUNTER_PENALTY
    above for why a negative `per` on the additive reader is refused.

    Refuses its "more" twin (the additive reader owns it) and its no-adjective
    multiply twin (Drifloon sv01-089, Onix swsh10.5-036 — READ since D167 by
    `deriveAttackDamageMultiplier`, where this block always said it belonged), a
    lowercased "this", a missing trailing period and any leading/trailing text: all
    stay on the loud ATTACK_EFFECT_SKIPPED path. Disjoint from `deriveAttackEffect` for the
    reason both siblings are — the whole-sentence anchor means a scaling sentence
    never also derives an op. */
export function deriveAttackDamagePenalty(text: string): AttackDamageBonus | null {
  const selfCounters = SELF_COUNTER_PENALTY.exec(text.trim());
  if (selfCounters === null) return null;
  // A printed 0 subtracts nothing — the guard every arm in this family carries,
  // and it keeps such a printing on the loud ATTACK_EFFECT_SKIPPED path rather
  // than silently claiming to simulate a sentence that does nothing.
  const per = Number(selfCounters[1]);
  return per >= 1 ? { per, count: { kind: "damageCountersOnSelf" } } : null;
}

/** Parse a printed "×"/multiply damage-scaling sentence — "This attack does N
    damage for each damage counter on this Pokémon." (D167) / "… for each Prize
    card your opponent has taken." / "… for each {C} in your opponent's Active
    Pokémon's Retreat Cost." (NO "more", NO "less") — into the same
    `{per, count}` shape as the additive reader, or null for anything else.
    The two share the count evaluator; they differ only in
    attack.ts's fold: the additive reader's `per × count` adds to a printed base,
    THIS family's IS the whole damage (the printed "N×" base is the per-unit, so
    attack.ts drops it — count 0 → 0 damage, and no DAMAGE_DEALT at all). Refuses
    the additive "more" twin and the subtractive "less" one (those readers own
    them), Wo-Chien ex's benched-target print and Chien-Pao ex's
    discarded-Energy count (both a different shape), a lowercased "this", a missing
    trailing period, and any leading/trailing text — all stay on the loud
    ATTACK_EFFECT_SKIPPED path. Disjoint from `deriveAttackEffect` for the same
    reason the additive reader is (attack.ts owns the fold).

    FOUR count sources, ONE fold — and the third arrived (D167) as a regex and an
    `if`, because both halves of it already existed: the `×` fold here, and
    `damageCountersOnSelf` in `scaledAttackDamage`, live since M2 for the "more"
    twin. The fourth (D170, Tyranitar swsh10.5-043's bench-wide count) cost one
    more: the fold was here but the SOURCE was not, so it also bought a
    `DamageCountSource` member and an evaluator arm — the same shape D168 paid on
    the additive reader. The arms are ordered to mirror `deriveAttackDamageBonus`
    rather than by the order they were written; the regexes are mutually exclusive,
    so the order is legibility, not behaviour. */
export function deriveAttackDamageMultiplier(text: string): AttackDamageBonus | null {
  const effect = text.trim();
  // A printed 0 does nothing — left loud, the guard every arm in both families
  // carries.
  const selfCounters = SELF_COUNTER_MULTIPLY.exec(effect);
  if (selfCounters !== null) {
    const per = Number(selfCounters[1]);
    if (per >= 1) return { per, count: { kind: "damageCountersOnSelf" } };
  }
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
  // D170 — the BENCH-WIDE damage-counter count. Same `×` fold, same `per >= 1`
  // guard, a different ZONE: the only thing separating this arm from the first
  // one above is the literal tail of its anchored sentence.
  const benchCounters = BENCH_COUNTER_MULTIPLY.exec(effect);
  if (benchCounters !== null) {
    const per = Number(benchCounters[1]);
    if (per >= 1) return { per, count: { kind: "damageCountersOnYourBench" } };
  }
  // D193 — the opponent's Bench counted as BODIES. Placed after the counter arm
  // it mirrors, so the two readers over one `{per, count}` interface read the same
  // way down the page; the patterns are whole-sentence anchored and mutually
  // exclusive, so this is legibility and not behaviour.
  const opponentBench = OPPONENT_BENCH_MULTIPLY.exec(effect);
  if (opponentBench !== null) {
    const per = Number(opponentBench[1]);
    if (per >= 1) return { per, count: { kind: "opponentBenchCount" } };
  }
  // D282 — the ATTACKER's own Bench as BODIES on the `×` fold, the mirror of the
  // additive arm one reader up and placed at the same point in the chain, which is
  // what keeps the two readers over one `{per, count}` interface legible together.
  // 3 legal printings reach it on the RAW sentence and 7 more (Terapagos ex)
  // reach it only after `splitAttackGateClause` has taken the printed gate clause
  // off the front — this arm never sees the clause and must not.
  const yourBench = YOUR_BENCH_MULTIPLY.exec(effect);
  if (yourBench !== null) {
    const per = Number(yourBench[1]);
    if (per >= 1) return { per, count: { kind: "yourBenchCount" } };
  }
  // D193 — the opponent's attached Energy, BOTH ZONES on this fold. The zone is
  // the whole printed noun phrase (capture 3), never inferred from the amount;
  // the type filter is optional and an unresolvable token stays LOUD.
  const opponentEnergy = OPPONENT_ENERGY_MULTIPLY.exec(effect);
  if (opponentEnergy !== null) {
    const per = Number(opponentEnergy[1]);
    const energyType = attachedEnergyFilter(opponentEnergy[2]);
    const zone: OpponentEnergyZone =
      opponentEnergy[3]?.startsWith("all of ") === true ? "board" : "active";
    if (per >= 1 && energyType !== undefined) {
      return { per, count: { kind: "energyOnOpponent", zone, energyType } };
    }
  }
  // D196 — the ATTACKER'S OWN attached Energy, `×` fold. Placed after the arm it
  // mirrors, so both readers over one `{per, count}` interface read the same way
  // down the page. The legal rows here are ALL UNTYPED (9 of 9), but the optional
  // token is kept rather than dropped: the additive twin really does print five
  // different type filters, and one pattern per fold that admits both spellings
  // is what stops "for each {W} Energy attached to this Pokémon." (printed, 0
  // legal on this fold) being read as the unfiltered total if it ever comes back.
  //
  // ⚠️ NO both-Actives arm here, and that is MEASURED. "This attack does 30 damage
  // for each Energy attached to both Active Pokémon." is 1 printing and 0 LEGAL,
  // so the member is reachable from the additive reader only — pinned by a test,
  // exactly as `bothSidesBenchCount`'s one-reader shape is.
  const selfEnergy = SELF_ENERGY_MULTIPLY.exec(effect);
  if (selfEnergy !== null) {
    const per = Number(selfEnergy[1]);
    const energyType = attachedEnergyFilter(selfEnergy[2]);
    if (per >= 1 && energyType !== undefined) {
      return { per, count: { kind: "energyOnSelf", energyType } };
    }
  }
  return null;
}

/** WHICH of the §8.5 damage modifiers the MAIN HIT is printed to ignore (D192) —
    the parsed shape of "This attack's damage isn't affected by …". THREE
    independent booleans, deliberately not one and not two, each absent rather
    than `false` when the sentence does not name it.

    ⚠️ **THE THREE-WAY SPLIT IS DECIDED BY THE PRINTED OBJECTS, AND ONLY TWO OF THE
    THREE PROVE THEMSELVES INSIDE THE BUILT SET.** Measured against the remote D1
    `luminous` (3,786 rows / 20 sets, 2,021 `legal_standard = 1`) on 2026-08-04,
    the four FULLY ANCHORED printings of this sentence are

      "…by any effects on your opponent's Active Pokémon."         29 rows, 15 legal
      "…by Resistance."                                            17 rows,  9 legal
      "…by Weakness or Resistance, or by any effects on your
        opponent's Active Pokémon."                                10 rows,  8 legal
      "…by Weakness or Resistance."                                 2 rows,  2 legal

    so `targetEffects` occurs ALONE (15 legal) and `resistance` occurs ALONE
    (9 legal) — neither can share a field with anything. `weakness` does NOT occur
    alone in the built set: it is printed only in the two compounds, always beside
    `resistance`. It is still its own field, for a reason that is a measurement and
    not a preference: the legal pool DOES print "This attack's damage isn't
    affected by Weakness." alone, on 2 legal RIDER-ON-COMPOUND printings this slice
    DEFERS (see attack.ts), and it is read at a DIFFERENT §8.5 STEP from
    `resistance` — the Weakness ternary already carries a null path
    (`seatRemovesWeakness`) that the Resistance one does not. Folding the two into
    one field would have to be undone by the first of those riders to land.

    ⚠️ **NOT `damageChosen.ignoreWR`, AND THAT WAS CHECKED RATHER THAN ASSUMED.**
    That field is an OP member (one writer — `CHOSEN_ANY_TARGET`'s group 2, Umbreon
    "Feint Attack" sv03-130; two read paths — `placeSnipe`'s bench arm and
    `snipeActive`) and the main hit HAS NO OP: this sentence is the whole printed
    effect of an attack whose damage is its `damage` field. It is also ONE boolean
    where three are needed — Feint Attack prints all three objects at once, so a
    shared field could never express "Resistance only". SIBLING, not shared. */
export interface AttackDamageSuppression {
  weakness?: true;
  resistance?: true;
  targetEffects?: true;
}

/** The four printed sentences as ONE anchored alternation over the OBJECT of
    "isn't affected by", with a capture group per printed object so the dispatch
    below never has to look at the matched TEXT.

    ⚠️ THE CAPTURE-PER-ARM SHAPE IS WHAT KEEPS D137's FOLD OUT OF THE DISPATCH. A
    single capture plus a literal lookup would need `literalClauseRow`, because the
    captured object carries `opponent['’]s` and a map key cannot hold a character
    class. Four groups make the apostrophe a matter for the PATTERN alone, where
    the class already lives, and the two spellings land on the same arm by
    construction rather than by a second table.

    Order matters and is behaviour, not legibility: JS alternation is
    leftmost-first, so the W/R+effects compound must precede its "Weakness or
    Resistance" prefix or the longer sentence could never match. Refuses a
    lowercased "this", a missing trailing period, and ANY leading or trailing text
    — the +5 legal rider-on-compound printings stay on the loud
    ATTACK_EFFECT_SKIPPED path, exactly as every other fully-anchored deriver in
    this file leaves them. */
const DAMAGE_SUPPRESSION = new RegExp(
  `^This attack['’]s damage isn['’]t affected by ` +
    `(?:(Weakness or Resistance, or by any effects on your opponent['’]s Active Pokémon)` +
    "|(Weakness or Resistance)" +
    "|(Resistance)" +
    `|(any effects on your opponent['’]s Active Pokémon))\\.$`,
);

/** Parse the printed main-hit damage-modifier suppression sentence into the three
    booleans it sets, or null for anything else (D192).

    THE FOURTH READER of the same effect text, beside `deriveAttackDamageBonus` /
    `…Multiplier` / `…Penalty`, and disjoint from all three by CONSEQUENT: those
    three parse `per × count` arithmetic and this one parses which §8.5 STEPS are
    skipped, so a card carries at most one. Disjoint from `deriveAttackEffect` for
    the reason every scaling reader is — this sentence runs INSIDE the pipeline,
    never after damage — and attack.ts owns the read site. */
export function deriveAttackDamageSuppression(text: string): AttackDamageSuppression | null {
  const match = DAMAGE_SUPPRESSION.exec(text.trim());
  if (match === null) return null;
  if (match[1] !== undefined) return { weakness: true, resistance: true, targetEffects: true };
  if (match[2] !== undefined) return { weakness: true, resistance: true };
  if (match[3] !== undefined) return { resistance: true };
  return { targetEffects: true };
}

/** 🆕 D316 — THE PRINTED *"You may do {N} more damage. If you do, …"*: the
    attack's own extra damage, and the ops its ACCEPTANCE buys.

    **THE CENSUS — 5 legal printings on 4 distinct sentences**, re-queried against
    the remote D1 on 2026-08-10 at two widths (`'more damage. If you do'` and the
    shorter `'may do '`) across `attacks_json` + `abilities_json` + `effect`, both
    returning the same five with NO `legal_standard = 0` row anywhere:
      • Poliwrath `sv06-043` "Jumping Uppercut" (`120+`, bonus 120) — *"…shuffle
        this Pokémon and all attached cards into your deck."*
      • Gurdurr `sv06-104` "Superpower" (`50+`, bonus 30) — *"…this Pokémon also
        does 30 damage to itself."*
      • Dondozo ex `sv10-066`/`-211` "Dynamic Dive" (`120+`, bonus 120, 2
        printings) — *"…this Pokémon also does 50 damage to itself."*
      • Copperajah `sv06.5-042` "Nasal Lariat" (`130+`, bonus 100) — *"…during
        your next turn, this Pokémon can't attack."*
    🛑 **THREE CONSEQUENTS, ALL THREE ALREADY BUILT, ONE SHARED ANTECEDENT THAT IS
    THE WHOLE COST.** The consequents are `returnSelf` (the self-removal family,
    D311–D314), `damageSelf` (the recoil rider, 48 bare printings since 0.x) and
    `preventAttack` (`SELF_CANT_ATTACK_NEXT_TURN`, 20 bare printings) — so this
    reader authors no behaviour at all beyond deciding a number, and every op it
    emits is byte-identical to the one its BARE sibling emits.

    🛑 **WHY THIS IS ITS OWN READER AND NOT AN ARM OF `deriveAttackEffect`: THE
    AMOUNT IS NOT IN THE TEXT.** The printed base lives in the attack's `damage`
    field (`"120+"` → base 120 + modifier `"+"`), which this file never sees. So
    the reading crosses to attack.ts as a BONUS plus a CONSEQUENT and the program
    is assembled there, where the base is known — D130's `programPerHeads`
    precedent verbatim (*"the value that crosses the gap is the program itself"*),
    and the SECOND program in this engine that hangs off a READING rather than off
    an `EffectOp` (`walkProgram` cannot find either from a program root; both are
    fed to it separately, which `programWalk.test.ts` says out loud).

    🛑 **AND WHY THE WHOLE HIT MOVES INSIDE THE GATE RATHER THAN THE BONUS ALONE:
    §8.5 IS APPLIED ONCE PER DAMAGE OP, SO THE AMOUNT MUST BE DECIDED BEFORE THE
    SINGLE HIT.** Landing the base pre-program and the bonus from inside it is two
    hits, and the pipeline is not distributive over them: Weakness is (2×120 +
    2×120 = 2×240), but Resistance and the defender's reduction are SUBTRACTIONS
    applied once per hit, so a −30 Resistance would be paid twice, the §8.1
    survival clamp would be asked twice, and the log would carry two
    `DAMAGE_DEALT` rows for one printed number. `damageDefender`'s own doc block
    already states the rule this obeys — *"an attack whose number depends on a
    mid-attack choice cannot use the pre-W/R fold"* — and this is that sentence's
    other kind of choice: not how many cards were discarded, but whether the
    player took the boost.

    THE ANCHOR HAS TWO CAPTURES and the second is DISPATCHED, never interpreted:
    the consequent is matched whole against three `^…$` anchors, so an
    unrecognised one returns null and the ENTIRE sentence stays on the loud
    `ATTACK_EFFECT_SKIPPED` path. Never a prefix match — a reader that swallowed
    the antecedent and dropped the consequent would ship an attack whose drawback
    silently vanished, which is strictly worse than not reading it at all
    (`SELF_CANT_ATTACK_NEXT_TURN`'s compound states the same rule).

    ⚠️ **THE THREE CONSEQUENT VERBS ARE SPELLED LOWERCASE, AT THE ANCHOR, AND NOT
    AS A `[Tt]` CLASS** — D246's rule (the clause without its capital, so a leading
    clause can wear it) and `FLIP_TAILS_SELF_DAMAGE`'s precedent: the capital
    `This`/`During` on the bare anchors is exactly what keeps a whole-sentence
    reader off a mid-sentence clause, and a case class here would give that up in
    both directions at once. The `can['’]t` slot carries the apostrophe class its
    bare sibling carries (D136/D137); the other two anchors have no apostrophe to
    class.

    ⚠️ **THE RECOIL AMOUNT IS CAPTURED, NOT PINNED** — `FLIP_TAILS_SELF_DAMAGE`'s
    reasoning inherited whole: the bare anchor already reads any N, so capturing is
    what keeps the gated output byte-identical to the bare one for EVERY N rather
    than for the two the catalog happens to print (30 and 50). The `>= 1` guard
    rides along for its usual reason — a printed 0 is not a real card and would
    derive to a silent no-op — and the BONUS carries the same guard, since *"You
    may do 0 more damage"* is a decision with no stake. */
export interface AttackOptionalBoost {
  /** The printed extra damage a "yes" adds to the attack's own base. */
  bonus: number;
  /** What the printed "If you do," buys, in printed order. Named `ops` rather
      than `then` for `programPerHeads.ops`'s reason: it is a program reached
      through a READING, not a branch hanging off a gate op. */
  ops: EffectOp[];
}

const OPTIONAL_DAMAGE_BOOST = /^You may do (\d+) more damage\. If you do, (.+)$/;
const BOOST_RETURN_SELF = /^shuffle this Pokémon and all attached cards into your deck\.$/;
const BOOST_SELF_DAMAGE = /^this Pokémon also does (\d+) damage to itself\.$/;
const BOOST_CANT_ATTACK = /^during your next turn, this Pokémon can['’]t attack\.$/;

/** Parse the optional damage boost into its bonus and its consequent's ops, or
    null for anything else.

    THE EIGHTH READER of the same effect text, and disjoint from all seven by its
    LEADING WORDS: *"You may do"* denies `deriveAttackEffect`'s whole-sentence
    anchors, both scaling readers' `^This attack does` / `^If`, the coin family's
    `^Flip a coin`, the requirement family's `^If` and the suppression family's
    `^This attack's damage`. attack.ts owns the read site, beside the coin
    reader's. */
export function deriveAttackOptionalBoost(text: string): AttackOptionalBoost | null {
  const match = OPTIONAL_DAMAGE_BOOST.exec(text.trim());
  if (match === null) return null;
  const bonus = Number(match[1]);
  const consequent = match[2] ?? "";
  if (bonus < 1) return null;
  if (BOOST_RETURN_SELF.test(consequent)) {
    return { bonus, ops: [{ op: "returnSelf", dest: "deck" }] };
  }
  const recoil = BOOST_SELF_DAMAGE.exec(consequent);
  if (recoil !== null) {
    const amount = Number(recoil[1]);
    return amount >= 1 ? { bonus, ops: [{ op: "damageSelf", amount }] } : null;
  }
  if (BOOST_CANT_ATTACK.test(consequent)) return { bonus, ops: [{ op: "preventAttack" }] };
  return null;
}

/** 🆕 D318 — D316's PROGRAM, MOVED OUT OF ITS CALL SITE. Byte-for-byte the
    `optional` `attack.ts` assembled inline from D316 to D317; nothing about the
    shape changed, only WHERE it is built.

    🛑 WHY THE MOVE IS THE WHOLE POINT, AND IT IS NOT A TIDINESS ARGUMENT. A
    program assembled at its call site is invisible to every structural auditor in
    this repo. `programWalk.test.ts` builds its corpus from `deriveAttackEffect`
    over `FIXTURE_POOL` plus the registry plus the readings that are FED to it, and
    it can only be fed a reading-borne program if that program can be BUILT outside
    the file that runs it. D316's `optional.otherwise` was real, shipped and
    unreachable by that sweep for two slices, which is why the suite's carrier pin
    read `["optional", ["then"]]` while the op carried two arms — a pin measuring
    what the sweep can REACH, reported as what the union HAS.

    D317 hit the identical wall on the next sentence over and did not inherit it:
    it exported `bonusConsequentProgram` and its `coinFlipGate.otherwise` became
    the first producer that pin had seen in forty-eight slices. This is the same
    repair applied backwards, and it is `programPerHeads.ops`'s lesson (D150) at
    its fourth site. 🛑 THE OPERATIONAL FORM: IF A READING NEEDS A VALUE ONLY ONE
    FILE HAS — here the attack's printed `base`, which lives in the `damage` field
    — MAKE THE ASSEMBLER A PURE EXPORTED FUNCTION OF THAT VALUE.

    ⚠️ AND EXPORTING IT IS NECESSARY AND NOT SUFFICIENT, WHICH IS THE HALF THAT
    IS EASY TO SHIP GREEN AND DEAD. `FIXTURE_POOL` printed the sentence ZERO times
    (measured before the move, not after), so the sweep would have had nothing to
    build and the pin would have stood still with every line of this function
    covered. `fix-optionalboost` — Gurdurr `sv06-104` "Superpower"'s printed text,
    verbatim off the remote D1 — is the other half. */
export function optionalBoostProgram(
  reading: AttackOptionalBoost,
  base: number,
  note: string,
): EffectOp[] {
  const [then, otherwise] = boostedArms(base, reading.bonus, reading.ops);
  return [
    {
      op: "optional",
      // The WHOLE printed sentence, the op's own contract — it is what the confirm
      // dialog shows, and the player is being asked to agree to the drawback as
      // much as to the damage.
      note,
      then,
      otherwise,
    },
  ];
}

/** 🆕 D318 — THE TWO ARMS *"{decider}, this attack does {N} more damage, and
    {consequent}"* HAS IN EVERY SPELLING, BUILT ONCE.

    🛑 THIS EXISTS BECAUSE `precheck` REFUSED THE DUPLICATE, AND THE REFUSAL WAS
    RIGHT. `optionalBoostProgram` (above) and `bonusConsequentProgram` (below) are
    the SAME program with three different deciders — a confirm, a board condition
    and a coin — so both were about to spell the boosted `damageDefender` and the
    consequent splice byte for byte, and the mutation corpus reported it
    immediately: two D317 rows whose `find` had occurred exactly once went `2×`.
    **That is D317's own lesson arriving from the direction it did not predict** —
    it recorded *"a one-line `find` is only unique until somebody writes the same
    line"* about a line duplicated by accident, and here the duplicate was about to
    be written on purpose. ⚠️ THE FIX IS THE ONE THE CORPUS WAS ASKING FOR AND NOT
    THE ONE THAT WOULD HAVE SILENCED IT: widening the two rows' anchors would have
    kept two copies of one arm and pinned an ADJACENCY claim on top of them;
    sharing the construction leaves one occurrence, which is unique for the reason
    a mutation row wants — there is only one of it.

    🛑 AND THE FIRST DRAFT OF THIS DOC BLOCK QUOTED THOSE TWO LINES VERBATIM, WHICH
    PUT THE ANCHOR BACK — IN A COMMENT. `precheck` went quiet, because the row was
    at `1×` again and `1×` is the passing state; the occurrence was simply in the
    wrong place, and the mutant would have edited prose and SURVIVED. **`precheck`
    reports `0×` and `2×` and is structurally blind to `1×` AT THE WRONG SITE** —
    D210's finding (a doc comment spelling an action as a double-quoted literal
    satisfied a source-scan guard) in the one tool built to prevent it. The rule
    that falls out: **DESCRIBE CODE IN A DOC BLOCK, DO NOT REPRODUCE IT AT ITS OWN
    INDENTATION.**

    ⚠️ A TUPLE AND NOT AN OBJECT, WHICH IS NOT A STYLE CHOICE. Returning
    `{ then, otherwise }` would put an explicit `then:` KEY in this file and trip
    `lint/suspicious/noThenProperty`; destructuring a tuple gives both callers a
    LOCAL named `then`, which they splice by SHORTHAND, which the rule does not
    fire on. That is D317's measured trick, and it is what keeps three gate
    literals across two functions free of a suppression each.

    🛑 THE DECLINE ARM IS THE PRINTED BASE, NOT NOTHING — the one piece of
    behaviour this helper carries. Every printing of every spelling has a real
    printed base (`120+`, `50+`, `130+`, `140+`, `30+`), so an absent second arm
    would silently delete the whole attack on a "no", a tails or an un-evolved
    Active. */
function boostedArms(
  base: number,
  bonus: number,
  ops: readonly EffectOp[],
): [EffectOp[], EffectOp[]] {
  return [
    [{ op: "damageDefender", amount: base + bonus }, ...ops],
    [{ op: "damageDefender", amount: base }],
  ];
}

/** 🆕 D317 — *"…this attack does {N} more damage, and {consequent}"*: ONE
    decision buying BOTH a bigger hit and a second effect. SIX legal printings on
    TWO sentences (remote D1, `instr(attacks_json, 'more damage, and ') > 0`, whole
    column read, 2026-08-10 — 14 rows, 6 of them `legal_standard = 1`):

    * Hearthflame Mask Ogerpon ex `sv06-040`/`-192`/`-212`/`sv08.5-017`/`-148`
      (**5**, one card in five rarities) "Dynamic Blaze" (`140+`, index 1) —
      *"If your opponent's Active Pokémon is an Evolution Pokémon, this attack
      does 140 more damage, and discard all Energy from this Pokémon."*
    * Floragato `sv09-017` (**1**) "Magical Leaf" (`30+`) — *"Flip a coin. If
      heads, this attack does 30 more damage, and heal 30 damage from this
      Pokémon."*

    ⚠️ **THE WIDTH WAS SWEPT BEFORE THE ARM WAS WRITTEN AND IT IS EXACTLY TWO
    SENTENCES.** `'more damage, and '` returns nothing in `effect` or
    `abilities_json`; the comma-less spelling (`'more damage and '`) returns
    nothing in any column; and the reversed order (`'and this attack does '`)
    returns five rows that are a DIFFERENT family entirely (a cost paid up front
    and then a flat hit — Armarouge `sv08-034`, Bombirdier `sv09-101`, Zeraora
    `sv10-078`, Quagsire `svp-156`, Misty's Gyarados `sv10-049`), none of them
    carrying "more". The other 8 rows of the family are `legal_standard = 0`
    (Floette `sv01-092` prints Floragato's sentence byte-identically; Beedrill
    `sv03.5-015`, Tapu Koko ex `sv04-068`/`-222`/`-247` and Conkeldurr V
    `swsh10.5-040`/`-073`/`-074` print four more antecedent/consequent pairs), so
    the reach of this shape is wider than its census value of 6 — which is why
    both halves are CAPTURED rather than pinned.

    🛑 **THE NINTH READER, AND IT IS D316's SHAPE WITH THE DECIDER CHANGED.** That
    slice read *"You may do {N} more damage. If you do, …"* — a CONFIRM buying a
    bonus and a drawback. This is the same sentence with the player taken out of
    it: a BOARD FACT decides it on Ogerpon, a COIN on Floragato. The reading is
    therefore the same triple (a decider, a bonus, a consequent) and the program
    is the same gate, which is exactly why the two sentences are ONE arm and not
    two slices.

    🛑 **WHY THE WHOLE HIT MOVES INSIDE THE GATE — AND WHY THE OTHER ROUTE IS NOT
    MERELY UGLIER BUT WRONG ON FLORAGATO.** The tempting cheaper build is to leave
    the bonus in the pre-W/R fold (where `deriveAttackDamageBonus` already puts the
    BARE form of Ogerpon's antecedent, at 50/80/90 on three sibling printings) and
    hang the consequent off a separate gate program. It fails, for two reasons of
    different weight:

    * **THE COIN CANNOT BE FLIPPED TWICE.** `deriveAttackCoinFlip`'s
      `bonusOnHeads` takes its flip in attack.ts, in FRONT of §8.5; a
      `coinFlipGate` program takes its own at the interpreter's tail. One printed
      coin would become two draws, two `ATTACK_EFFECT_COIN_FLIP` rows and two
      independent answers — a board on which the bonus lands and the heal does
      not. There is no arrangement of two readers that makes one printed coin one
      flip, because the two sites are on opposite sides of the pipeline.
    * **AND IT NEEDS ONE SENTENCE READ BY TWO READERS**, which every doc block in
      this file denies out loud (*"at most one of the four ever fires on a given
      attack"*). That invariant is not decoration: it is what makes attack.ts's
      simulated-flags SUMS rather than choices.

    So the decision is taken ONCE, by one reader, and both arms deal ONE
    `damageDefender` through the full §8.5 pipeline — the yes arm at
    `base + bonus` with the consequent behind it, the no arm at the bare printed
    base. §8.5 is applied once per damage op (D316's argument, inherited whole and
    still the reason): Weakness DISTRIBUTES over a split hit, but Resistance and
    the defender's reduction are SUBTRACTIONS paid once per hit, the §8.1 survival
    clamp would be asked twice, and one printed number would emit two
    `DAMAGE_DEALT` rows.

    ⚠️ **WHAT ROUTE 1 GIVES UP, NAMED RATHER THAN GLOSSED.** `snipeActive` folds
    the attacker's pre-W/R bonus, the installed debuff, the always-on debuff,
    Weakness, Resistance and the target's reduction — but NOT
    `boostedAttackDamage`, D155's per-INDEX installed boost, which attack.ts reads
    at a site that has `index` in scope and the interpreter structurally does not.
    Unreachable on these six printings (the boost is installed by the attacker's
    OWN previous attack, and neither Ogerpon's "Wrathful Hearth" nor Floragato's
    only attack installs one), and it is the same price D316 paid at the same seam
    — recorded here so a future printing that CAN reach it is a known cost rather
    than a surprise.

    ⚠️ **THE CONSEQUENT IS DISPATCHED, NEVER INTERPRETED** — D316's rule verbatim.
    Both halves are matched whole against `^…$` anchors, so an unrecognised
    consequent returns null and the ENTIRE sentence stays on the loud
    `ATTACK_EFFECT_SKIPPED` path. Never a prefix match: a reader that swallowed the
    damage and dropped the discard would ship an Ogerpon whose printed cost
    silently vanished, which is strictly worse than not reading the card at all.

    ⚠️ **THE TWO CONSEQUENT VERBS ARE SPELLED LOWERCASE AT THE ANCHOR AND NOT AS A
    `[Dd]` / `[Hh]` CLASS** — D246's rule and D316's precedent one reader up: the
    capital on a bare anchor is exactly what keeps a whole-sentence reader off a
    mid-sentence clause, and a case class here would give that up in both
    directions at once. Neither consequent has an apostrophe slot to class; the
    ANTECEDENT does, and it carries the class through `boardConditionForClause`'s
    `literalClauseRow` fold (D136/D137), which is the site rather than a copy. */
export interface AttackBonusConsequent {
  /** What decides BOTH halves — a board fact read at declaration, or one coin
      taken by the gate the program carries. Never both, and never neither: the
      union is closed by the two anchors below. */
  decider: { kind: "boardCondition"; cond: BoardCondition } | { kind: "coinFlip" };
  /** The printed extra damage the YES arm adds to the attack's own printed base. */
  bonus: number;
  /** What the printed ", and …" buys on the YES arm, in printed order. Named
      `ops` for `AttackOptionalBoost.ops`'s reason: it is a program reached through
      a READING, not a branch hanging off an `EffectOp` a walk can find. */
  ops: EffectOp[];
}

const BONUS_CONSEQUENT_CONDITION = /^If (.+), this attack does (\d+) more damage, and (.+)$/;
const BONUS_CONSEQUENT_COIN =
  /^Flip a coin\. If heads, this attack does (\d+) more damage, and (.+)$/;
const CONSEQUENT_DISCARD_ALL_SELF_ENERGY = /^discard all Energy from this Pokémon\.$/;
const CONSEQUENT_HEAL_SELF = /^heal (\d+) damage from this Pokémon\.$/;

/** The consequent half, dispatched over its closed anchor list — the ops the
    printed ", and …" buys, or null for a consequent this engine does not read.
    Both ops already shipped: `discardEnergy {from:"yourActive", count:"all"}` is
    `FLIP_TAILS_SELF_DISCARD_ALL`'s own op and `heal {target:"self"}` has run since
    0.x, so what this slice actually buys is a NUMBER — which of two amounts the
    single §8.5 hit uses — exactly as D316's did. */
function bonusConsequentOps(consequent: string): EffectOp[] | null {
  if (CONSEQUENT_DISCARD_ALL_SELF_ENERGY.test(consequent)) {
    return [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ];
  }
  const heal = CONSEQUENT_HEAL_SELF.exec(consequent);
  if (heal !== null) {
    const amount = Number(heal[1]);
    // A printed 0 heals nothing — the guard every captured amount in this file
    // carries, and it keeps such a printing LOUD rather than silently claiming to
    // simulate a sentence with a no-op in it.
    return amount >= 1 ? [{ op: "heal", target: "self", amount }] : null;
  }
  return null;
}

/** Parse the bonus-plus-consequent sentence into its decider, its bonus and its
    consequent's ops, or null for anything else.

    THE NINTH READER of the same effect text, and disjoint from all eight. The
    COIN form is denied to `deriveAttackCoinFlip` by its consequent (that reader's
    `bonusOnHeads` anchor ends at *"more damage."*, so the trailing *", and …"*
    refuses it) and to `deriveAttackEffect` for the same reason from the other
    side. The CONDITION form is denied to `deriveAttackDamageBonus` by
    `CONDITIONAL_DAMAGE_BONUS`'s own `\.$`. Every one of those refusals is
    ASSERTED rather than assumed — see `bonusConsequent.test.ts` §1, which runs all
    eight over both printed sentences and requires null from each.

    ⚠️ THE COIN ANCHOR IS TRIED FIRST AND THE ORDER IS NOT ARBITRARY: the
    condition anchor's `If (.+)` would otherwise claim *"heads"* out of the coin
    sentence's second clause and hand it to `boardConditionForClause`, which would
    return null and REFUSE the whole thing — a silent loss of Floragato rather than
    a wrong answer, but a loss. Anchoring the coin form at `^Flip a coin\.` is what
    makes the two mutually exclusive; testing it first is what makes that
    independent of the condition anchor's greed. */
export function deriveAttackBonusConsequent(text: string): AttackBonusConsequent | null {
  const effect = text.trim();
  const coin = BONUS_CONSEQUENT_COIN.exec(effect);
  if (coin !== null) {
    const bonus = Number(coin[1]);
    // A printed 0 adds nothing — the guard every arm of the damage-bonus family
    // carries, and here it is the whole reason the decision is worth taking.
    if (bonus < 1) return null;
    const ops = bonusConsequentOps(coin[2] ?? "");
    return ops === null ? null : { decider: { kind: "coinFlip" }, bonus, ops };
  }
  const condition = BONUS_CONSEQUENT_CONDITION.exec(effect);
  if (condition === null) return null;
  // An UNMAPPED clause falls through to null and stays LOUD — `CONDITIONAL_DAMAGE_
  // BONUS`'s own rule, and the reason this reader shares that table rather than
  // carrying a second copy of the vocabulary: a clause meaning "does 140 more
  // damage if X" must mean the same thing here as it does one reader over.
  const cond = boardConditionForClause(condition[1] ?? "");
  if (cond === null) return null;
  const bonus = Number(condition[2]);
  if (bonus < 1) return null;
  const ops = bonusConsequentOps(condition[3] ?? "");
  return ops === null ? null : { decider: { kind: "boardCondition", cond }, bonus, ops };
}

/** 🆕 D317 — assemble the reading into the gate that carries it, given the
    attack's PRINTED BASE.

    🛑 **EXPORTED, AND THAT IS THE POINT OF IT.** `base` lives on the attack and
    is in scope only inside attack.ts, which is where D316 assembled its `optional`
    — and the consequence is that `programWalk.test.ts`'s pool sweep, which builds
    its corpus from `deriveAttackEffect` + the registry + the `programPerHeads`
    reading fed in by hand, **structurally cannot see the program at all**. D316's
    `optional.otherwise` is invisible there to this day, which is why that suite's
    carrier pin still reads `["optional", ["then"]]` at HEAD while the op has
    carried a second arm for a slice.

    Splitting the ASSEMBLY out of the call site is what fixes that: attack.ts calls
    this with the parsed base, and the sweep calls it with the same, so the shape
    the engine actually runs is the shape the auditor actually walks. That is the
    same repair `programPerHeads.ops` got when D150 found the identical hole the
    hard way — a program reached through a READING has to be fed in, and it can
    only be fed in if it can be BUILT outside the file that runs it. */
export function bonusConsequentProgram(reading: AttackBonusConsequent, base: number): EffectOp[] {
  // ⚠️ THE `biome-ignore lint/suspicious/noThenProperty` LINE EVERY OTHER GATE
  // LITERAL IN THIS FILE CARRIES IS DELIBERATELY ABSENT HERE, AND THE ABSENCE IS
  // MEASURED RATHER THAN GUESSED: the rule fires on an explicit `then:` KEY, and
  // both object literals below use the SHORTHAND for this local — so the
  // suppression would be an UNUSED one, which `biome lint --error-on-warnings`
  // rejects just as loudly as the violation would be. Naming the arm as a local
  // is what buys that, and it is also what lets the two gate shapes share it.
  //
  // 🆕 D318 — THE TWO ARMS COME FROM `boostedArms` NOW, AND THE REASON IS IN THAT
  // HELPER'S DOC BLOCK: D316's `optional` assembler moved into this file beside
  // this one and was about to spell the same two lines byte for byte, which
  // `precheck` reported as two of this decision's rows going `1× → 2×`. The
  // destructured tuple is what keeps the local named `then` and the shorthand
  // splice below unchanged.
  const [then, otherwise] = boostedArms(base, reading.bonus, reading.ops);
  return reading.decider.kind === "coinFlip"
    ? [{ op: "coinFlipGate", then, otherwise }]
    : [{ op: "conditionGate", cond: reading.decider.cond, then, otherwise }];
}

/** D282 — THE THREE PRINTED SPELLINGS OF THE D281 TIMING GATE, as a LEADING
    clause. Anchored at `^` and at the sentence break (`. `), never floating: the
    clause is the FIRST sentence or this is not a split.

    ⚠️ THE LIST IS CLOSED AND IT IS THE CENSUS, NOT A GUESS. `attackIndexGate.ts`'s
    population is 13 legal printings in exactly these three shapes (7 BAN + 3 GATE
    + 3 LICENCE), the pool-wide query returns 15 (the 2 extra are Bombirdier ex
    `sv04-156`/`-234`, `legal_standard = 0`, and print the BAN shape), and there is
    no fourth spelling in the catalog. Re-derived 2026-08-08. */
const ATTACK_GATE_CLAUSES: readonly string[] = [
  "If you go second, you can't use this attack during your first turn.",
  "If you go first, you can use this attack during your first turn.",
  "You can use this attack only if you go second, and only during your first turn.",
];

/** 🛑 D282 — THE SPLIT ANCHOR: take a printed timing-gate clause off the FRONT of
    an attack's effect text and hand back the body sentence behind it, or `null`
    when the text does not open with one.

    ⚠️ **THIS IS NOT A LOOSENING OF THE SEVEN READERS AND MUST NEVER BECOME ONE.**
    Every deriver in this file is `^…$` anchored by deliberate policy, and the five
    "rider-on-compound" printings attack.ts pins are the standing proof that a
    search-style pattern would silently claim half a sentence it cannot resolve.
    This function does not widen any anchor: it produces a DIFFERENT STRING and
    the readers run over that string whole, so a body they refuse is still refused
    loudly and the residue is still reported.

    🛑 **AND THE CALLER MUST HAVE ACCOUNTED FOR THE CLAUSE ALREADY.** Dropping a
    printed sentence is exactly the "too loose" failure D278/D279 cost two slices
    to learn. The one call site (attack.ts) splits ONLY when the attacking body's
    `CardProgram.attackGate` carries an entry at THIS attack index — i.e. only when
    the clause this function removes is already represented and enforced at the §8
    declaration seam. With no gate authored, the whole printed string goes to the
    readers unchanged and an unread clause stays loud, which is the pre-D282
    behaviour byte for byte.

    ⚠️ **THE POPULATION IS 13 AND THAT IS SMALLER THAN THE CASE FOR A GENERIC
    SENTENCE-LIST COMPOSER, WHICH IS WHY THIS IS NOT ONE.** Re-queried before a
    line shipped (remote D1, 2026-08-08): 1,732 legal attack units, 613
    multi-sentence, and of those only 16 open with `If ` at all — 10 of the 16 are
    this gate family, 3 more are its `You can use this attack only if…` spelling,
    and the remaining 6 are sentences whose leading `If` IS the substance (Chi-Yu
    `sv06-039`, Sandy Shocks `sv05-098`, Sawk `sv10.5w-049`/`-130`, Ting-Lu
    `sv06-110`, Wo-Chien `sv08-015`), 5 of which attack.ts already pins as deferred
    riders on a DIFFERENT mechanism. So the leading-clause population a split can
    serve is **exactly the 13 gates and not one printing more**, and a generic
    composer would be scaffolding for a family of one. Build the narrow thing.

    Returns the clause and the body separately rather than the body alone, so a
    caller that wants to assert WHICH clause it accounted for can. */
export function splitAttackGateClause(text: string): { clause: string; body: string } | null {
  const trimmed = text.trim();
  for (const clause of ATTACK_GATE_CLAUSES) {
    if (!trimmed.startsWith(`${clause} `)) continue;
    const body = trimmed.slice(clause.length + 1).trim();
    // A clause with nothing behind it is not a split — there is no body to read,
    // and returning `{body: ""}` would make the caller's "is there a remainder"
    // question depend on an empty string rather than on this answer. No legal
    // printing is clause-only today (all 13 carry a body), so this is a guard
    // against a future one rather than a live path, and it is the safe direction:
    // the whole printed string goes to the readers unchanged.
    return body === "" ? null : { clause, body };
  }
  return null;
}

/** The optional `{X}`/spelled-out type filter on an "…for each [<token>] Energy
    attached to…" sentence, resolved through D118's `CLAUSE_ENERGY_TOKENS` — `null`
    for the UNTYPED reading (no token printed: every attached card counts) and
    `undefined` for a token that resolves to nothing, which the callers turn into
    the loud ATTACK_EFFECT_SKIPPED path.

    ⚠️ THE TWO NULLISH ANSWERS ARE NOT THE SAME ANSWER, which is the whole reason
    this is a helper rather than a `?? null` at each call site. "no filter" and "a
    filter I could not read" differ by exactly the failure that matters: the first
    must count everything, the second must count NOTHING and say so. Collapsing
    them would make "for each {C} Energy attached…" or "for each Basic Energy
    attached…" quietly score the unfiltered total — the mistake
    ATTACK_COIN_PER_ENERGY spells out inline (D128) and this shares rather than
    re-derives. Through `literalClauseRow` for D137's reason: the rule is the SITE
    of an exact lookup on printed text, not the need. */
function attachedEnergyFilter(
  token: string | undefined,
): BasicEnergyType | "special" | null | undefined {
  return token === undefined ? null : literalClauseRow(CLAUSE_ENERGY_TOKENS, token);
}

/** The matched status word, lowercased into the event vocabulary. The regex
    alternation guarantees the word; the fallback only satisfies
    noUncheckedIndexedAccess. */
function statusOf(word: string | undefined): StatusName {
  return STATUS_OF_WORD[(word ?? "Asleep") as StatusWord];
}
