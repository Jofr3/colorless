# Pokémon TCG — Engine-Oriented Ruleset

Condensed, mechanical rules reference for building a **deterministic game engine**
(state machine + card-effect system). This favors precise, checkable rules over
flavor. Rules reflect the **current Standard-era rules** (Sword & Shield / Scarlet &
Violet framework). Where a rule is version-dependent, it is flagged **[current]**.

Damage is always tracked in **damage counters of 10 HP each**. All "damage" numbers
below are HP; the engine may store them as counters (`hp / 10`).

---

## 1. Core objects (data model)

### 1.1 Card categories

- **Pokémon card** — has: name, stage (Basic / Stage 1 / Stage 2 / special: V, VMAX,
  VSTAR, ex, etc.), HP, one Pokémon type (energy color), 0–2 attacks, optional
  Ability, Weakness, Resistance, retreat cost, `evolvesFrom`, and an optional
  **Rule Box** (marks ex / V / VMAX / VSTAR / GX / Radiant, etc.).
- **Energy card** — **Basic Energy** (one of the 9 types) or **Special Energy**
  (provides energy + has rules text/effects).
- **Trainer card** — subtype: **Item**, **Supporter**, **Stadium**, or **Pokémon
  Tool** (Tool is technically an Item subtype but has distinct attach rules).

### 1.2 "Pokémon in play" (a stacked in-play unit)

An in-play Pokémon is a **stack**, not a single card. Model it as an object:

```
InPlayPokemon {
  cards:            [evolution stack, bottom = basic ... top = highest stage]
  attachedEnergy:   [Energy cards]
  attachedTools:    [Pokémon Tool cards]
  damage:           int (HP of damage taken; KO when damage >= currentHP)
  specialConditions: set (see §12)
  markers:          effect markers (e.g. "cannot attack next turn", "cannot retreat")
  turnPlaced:       turn index it entered play / last evolved
  position:         ACTIVE | BENCH[0..4]
}
```

The **top card of the stack** defines the current name, HP, attacks, Ability,
Weakness/Resistance, retreat cost, and prize value. Damage counters, attached
Energy, and attached Tools **persist through evolution**; Special Conditions and
most temporary markers **do not** (see §10, §12).

---

## 2. Zones / areas of play

Per player. Visibility matters for hidden-information handling and networking.

| Zone | Max size | Ordered? | Visibility |
|---|---|---|---|
| **Deck** | 60 at start | yes (top matters) | **hidden** (face-down) |
| **Hand** | unbounded | no | **hidden** (private to owner) |
| **Discard pile** | unbounded | yes (order preserved) | **public**, any player may look |
| **Prize cards** | 6 at start | slots | **hidden** (face-down; owner picks which to take) |
| **Active spot** | exactly 1 (while player has Pokémon) | — | **public** |
| **Bench** | **max 5** | slots | **public** |
| **Lost Zone** | unbounded | no | **public**; cards here are removed from the game (cannot return by normal means) |
| **Stadium** | 0 or 1 (**shared**, one in play total) | — | **public** |

Notes:
- **Deck** is shuffled; only "look at / search" effects reveal it, and only as the
  effect specifies. Searching the deck ⇒ **shuffle afterward** unless told otherwise.
- **Prizes** are face-down; a player who KOs an opponent's Pokémon chooses which of
  **their own** prize cards to take and reveals it to hand.
- **Stadium** is a single shared zone — only one Stadium is in play at a time for
  the whole game (see §8.3).
- **Lost Zone** is a one-way removal zone (distinct from discard).

---

## 3. Game setup (deterministic sequence)

1. **Deck legality**: exactly **60 cards**. (Standard also enforces a 4-copy limit
   per card name except Basic Energy — a deck-build constraint, not a runtime one.)
2. Each player shuffles their deck.
3. **Determine turn order**: flip a coin (or rock-paper-scissors in some rules); the
   **winner decides who takes the first turn**. Engine: single random bit + a choice.
4. Each player draws an **opening hand of 7 cards**.
5. **Mulligan check**: a player whose opening hand contains **no Basic Pokémon** must
   reveal the hand, shuffle it back, and draw a new 7. Repeat until they have ≥1 Basic.
   - **Mulligan compensation**: for **each** time a player mulligans, their **opponent**
     **may draw 1 extra card** (their choice) after both players have a valid hand.
     Engine must count mulligans per player.
   - **Mulliganing yourself does NOT forfeit the compensation you are owed** — the
     counts are independent, so if both players mulligan, **both** draw (each off the
     other's count). *(Corrected 2026-07-14: this section previously said "the
     non-mulliganing player", which reads as an exemption that does not exist; the
     P3-M1 engine implemented the wrong rule from it before the review caught it.)*
6. Both players place **1 Basic Pokémon face-down as their Active Pokémon**.
7. Each player **may** place up to 5 additional Basic Pokémon face-down on their
   **Bench** (Basics only — no evolutions during setup).
8. Each player sets aside the **top 6 cards of their deck face-down as Prize cards**.
9. Both players flip their Active (and Bench) Pokémon face-up. Resolve any
   "when placed at setup" effects if present, then the first player begins.

Deck-out safety at setup: if a player literally cannot set prizes / has issues, that
is handled by legality, not runtime — assume 60-card legal decks.

---

## 4. First-turn restrictions **[current]**

Let **P1** = player taking the first turn, **P2** = second.

- **P1 draws a card** at the start of turn 1 (the normal start-of-turn draw is **not**
  skipped in the current rules).
- **P1 may NOT attack** on their first turn.
- **P1 may NOT play a Supporter card** on their first turn. **[current — in effect
  since the Sword & Shield rules, Feb 2020]**
- **Neither player may evolve** on their **first turn** (their own turn-1). (This
  follows from the general "can't evolve a Pokémon the turn it came into play" rule,
  §10 — every Pokémon in play at setup arrived this turn.)
- P1 **may** play Items, play Basics to Bench, attach 1 Energy, retreat, use Abilities,
  play a Stadium, and attach Tools on turn 1 — only Supporter + attacking are barred.
- **P2 has no such restrictions**: P2 may attack and play a Supporter on their first
  turn (still cannot evolve on their own turn-1). This offsets the first-turn advantage.

---

## 5. Turn structure & phases

A turn is: **Start-of-turn** → **Action phase** → **Attack (optional, ends turn)** →
**Between-turns / Pokémon Checkup** (§13).

### 5.1 Start of turn
1. Resolve any "at the start of your turn" effects.
2. **Draw step**: draw 1 card from the top of the deck.
   - If the deck is **empty and the player must draw**, they **lose** (§14, deck-out).
     This check happens at draw time.

### 5.2 Action phase — do the following **in any order, any number of times unless capped**:

| Action | Limit per turn | Notes |
|---|---|---|
| Play a **Basic Pokémon** to the Bench | any number | Bench cap 5 |
| **Evolve** a Pokémon | any number (each Pokémon once) | §10 timing rules |
| **Attach 1 Energy** from hand to one of your Pokémon | **exactly 1 total** | §7 |
| Play an **Item** | any number | §8.1 |
| Play a **Supporter** | **1 per turn** | §8.2; P1 not on turn 1 |
| Play a **Stadium** | **1 per turn** | §8.3; replaces existing |
| Attach a **Pokémon Tool** | any number (1 Tool per Pokémon at a time) | §8.4 |
| **Retreat** the Active Pokémon | **1 per turn** | §11 |
| Use an **Ability** | per the Ability's own limit | §9; some once-per-turn, some passive |

### 5.3 Attack step (optional; ends the turn)
- The player **may** declare **one attack** with their **Active Pokémon** (see §9).
- Declaring an attack **ends the action phase**; after the attack resolves, the turn
  ends (proceed to Between-turns). A player may also **end the turn without attacking**.
- P1 cannot attack on turn 1 (§4).

---

## 6. Energy

### 6.1 Types **[current]**
Nine energy types: **Grass (G), Fire (R), Water (W), Lightning (L), Psychic (P),
Fighting (F), Darkness (D), Metal (M), Dragon (N)**, plus **Colorless (C)** as a cost
symbol. **Fairy (Y) was discontinued** in the Sword & Shield era.
- There is **no Basic Dragon Energy**; Dragon-cost attacks are paid with a mix of
  other basic energy as printed.

### 6.2 Attaching
- **One Energy attachment per turn** from your hand (to any one of your Pokémon,
  Active or Benched). Energy-acceleration card effects can add *extra* attachments
  beyond this base 1 — those come from card text, not the base rule.
- Attached Energy stays on the Pokémon until discarded (KO, retreat cost, effect).

### 6.3 Basic vs Special Energy
- **Basic Energy**: provides exactly **1 unit** of its type. Deck-build 4-copy limit
  does **not** apply to Basic Energy (unlimited copies).
- **Special Energy**: provides energy (sometimes multiple units / specific types) and
  may carry rules text or ongoing effects. It is still an Energy card and occupies the
  Energy-attach for the turn. Engine models it as: `provides: {type: count}` +
  optional attached-effect hooks.

### 6.4 Colorless
- **Colorless (C) cost** in an attack or retreat cost can be paid by **any type** of
  energy (1 energy = 1 Colorless requirement). Typed requirements (e.g. `W`) must be
  paid by that type (Basic of that type, or a Special/effect that counts as it).

### 6.5 "An {X} Energy" in card TEXT = an Energy that **provides** {X}
When a card's *effect* names a type — "Discard a {L} Energy from this Pokémon"
(Kilowattrel), "move a {R} Energy from 1 of your Benched Pokémon" (Armarouge) — it
means an Energy that **provides that type while attached**, NOT a Basic Energy card
of that type. Consequences:
- A **Special Energy that provides {L} counts** as a {L} Energy; one that provides
  only {C} does not, whatever its name or art.
- A **wildcard** provider ("provides every type of Energy but only 1 at a time" —
  Luminous Energy) counts as **every** type, so it satisfies any such reference.
- The answer is read **on the host, at that moment**: provision is a while-attached
  property ("As long as this card is attached to a Pokémon, it provides…"), and some
  Special Energy changes what it provides according to the holder's other
  attachments (Luminous provides {C} instead "if the Pokémon this card is attached
  to has any other Special Energy attached"). The same physical card can therefore
  be a {L} Energy on one board and not on another.
- It is the SAME reading §6.4 uses to pay a typed cost, which is the practical
  test: an Energy that can pay a card's {L} cost is exactly one its "{L} Energy"
  text can take. A card in a **deck, hand or discard pile provides nothing** —
  it is attached to nothing — so this phrasing only ever addresses Energy in play.
- Contrast the deliberately different wording "a **Basic {G} Energy card** from your
  hand" (Decidueye), which really is about the printed card and not about provision.

---

## 7. Trainer cards (by type)

Trainer cards are played from hand, take effect, then go to the **discard pile**
(exceptions: Stadium and Tool stay in play; some cards have other destinations).

### 7.1 Item — **any number per turn**
- No per-turn cap. Resolve effect, then discard.

### 7.2 Supporter — **one per turn**
- At most one Supporter per turn. **P1 cannot play a Supporter on turn 1** (§4).
- Resolve effect, then discard.

### 7.3 Stadium — **one per turn**, single shared zone
- Only **one Stadium in play** at a time (shared by both players).
- Playing a Stadium while a **different-named** Stadium is in play **discards the old
  one** and replaces it. You **cannot** play a Stadium with the **same name** as the
  one already in play (no self-replacing to reset it, unless a card says otherwise).
- Stadium effects are **continuous** and apply to **both players** while in play.
- Limit: **one Stadium play per turn**.

### 7.4 Pokémon Tool — attach to a Pokémon
- A Tool is attached to **one of your Pokémon** and **stays in play** as long as that
  Pokémon is in play. **One Tool per Pokémon** at a time (unless a card grants more).
- Attaching Tools is **not** capped per turn (you may attach several, to different
  Pokémon), and does **not** consume the Supporter/Stadium/Energy allowances.
- If the Pokémon leaves play (KO), the Tool is discarded with it.

### 7.5 Costs paid **from hand** to make a play legal

Some cards charge a **cost out of the hand** before they do anything. It prints in
three wordings that are one rule — two of them differ only by *where the paying
card sits*, and the third does not use the word "cost" at all:

| Printed on | Wording | Examples |
|---|---|---|
| **Trainers** (the card is in the hand it pays from) | "You can use this card only if you discard 2 **other** cards from your hand." / "…**another** card…" | Ultra Ball, Earthen Vessel, Superior Energy Retrieval |
| **Abilities** (the card is on the board) | "You **must** discard a card from your hand **in order to use** this Ability." | Tinkaton, Revavroom, Meowscarada ex, Radiant Blastoise |
| **The payment that is not a discard** | "Put a card from your hand on the bottom of your deck. **If you do**, …  (If you have no **other** cards in your hand, you can't use this card.)" | Dendra |

- **The destination is not what makes it a cost — the "if you do" is.** Dendra
  discards nothing, yet every clause of the rule is present: a card leaves the hand
  first, the benefit is conditional on it, and the parenthetical states the same
  play gate the Trainers open with, written as its contrapositive. A card put on
  the bottom of the deck is *not* in the discard pile: it stays in the deck, and a
  short deck can draw it straight back the same turn.

- **"Other" / "another" excludes the card being played, and only Trainers say it** —
  because only a Trainer is *in* the hand it pays out of. Ultra Ball with itself
  plus one other card in hand **cannot be played**: it needs two cards besides
  itself. An Ability's cost has no such word and none is implied.
- **It is a cost, not a condition.** Unlike "You can use this card only if you have
  more Prize cards remaining than your opponent" (§14, a board condition that reads
  public state and changes nothing), this **spends cards out of a hidden zone**. The
  opponent cannot evaluate it in advance, and paying it changes the game state.
- **Unpayable ⇒ the play is illegal**, and nothing happens: the card is not played,
  the Ability is not used, and no part of the effect resolves. This is the card's
  own printed rule, which is a different thing from "this play would have no
  effect" (§7's no-legal-target principle) — a cost is a stated precondition, so it
  vetoes even when the rest of the card would have done something.
- **The cost is paid FIRST, and the order is observable.** Revavroom's "discard an
  Energy card … then draw cards until you have 6 cards in your hand" draws to six
  counting the card already paid, so a hand of five pays one and draws **two**. The
  cards you discard also cannot be cards you are about to draw.
- **Exactly the printed number, and no decline.** The only decision is *which*
  cards; a player who can pay must pay in full to make the play. (The general form
  of that rule — a printed number is a floor as well as a ceiling — is §9.1.)
- A card whose own effect then reaches the discard pile may explicitly **exclude
  what it just paid** — Superior Energy Retrieval's "(You can't choose a card you
  discarded with the effect of this card.)" — so the cost and the effect are not
  independent for every card in the family.

---

## 8. Attacking & damage resolution

Order of operations for a declared attack:

1. **Legality**: attacker is the Active Pokémon; not prevented (Asleep, Paralyzed,
   or an effect forbidding attacking); it is not P1's turn 1.
2. **Pay the attack cost**: the Active Pokémon must have **attached Energy meeting the
   attack's cost** (typed symbols + Colorless). Attacking does **not** discard the
   energy unless the attack text says to. (Cost is only a *check*, not a payment,
   unless the attack states an energy discard.)
3. **Confusion check** (if Confused): flip a coin; **tails ⇒ attack fails**, place
   **30 damage (3 counters) on the attacker**, and the turn ends (§12).
4. **Resolve attack text** in printed order — base damage, then any additional
   effects/conditions (coin flips, energy discards, status infliction, etc.).
5. **Compute damage to the Defending (opponent's Active) Pokémon**:
   - Start with the attack's **base damage** (plus any "+X" modifiers from the
     attack/effects that add to base damage *before* Weakness).
   - **Weakness**: if the Defender has Weakness to the attacker's type, **multiply by
     the printed multiplier — currently ×2** (Defenders print `×2`; if only a symbol
     with no number, treat as ×2). **[current: ×2]**
   - **Resistance**: if the Defender has Resistance to the attacker's type, **subtract
     the printed value — currently −30** (`-30`). **[current: −30]**
   - Apply other **damage modifiers** (effects that add/reduce final damage, damage
     reduction from Tools/Abilities, "prevent all damage", etc.).
   - Damage cannot go below 0. Order: **base (+base modifiers) → ×Weakness → −Resistance
     → ±final modifiers**. Weakness/Resistance apply **only to the Active/Defending
     Pokémon**, never to Bench damage.
6. **Place damage counters** on the Defender (and on any other Pokémon the attack
   targets — e.g. "damage to Benched Pokémon", which ignore Weakness/Resistance).
7. **Knock Out check** (see §8.1). Then the turn ends → Between-turns (§13).

### 8.1 Knock Out (KO) & taking prizes
- A Pokémon is **Knocked Out** when its **damage ≥ its current HP**.
- On KO: the entire stack (all cards, attached Energy, Tools) goes to its owner's
  **discard pile** (unless an effect sends it elsewhere, e.g. Lost Zone).
- The player **who KO'd** the Pokémon **takes prize card(s)**:
  - **1 prize** for a normal Pokémon.
  - **Rule-box Pokémon give extra prizes** — the KO'd Pokémon's printed rule box
    determines it: **Pokémon ex / V / VSTAR / GX → 2 prizes**, **VMAX → 3 prizes**
    (historically). Model as a per-Pokémon `prizeValue` (default 1) read from the
    **top card** of the stack. **[current: ex = 2]**
  - If **multiple Pokémon are KO'd simultaneously** (e.g. self + defender), the
    attacking player takes prizes for the opponent's KO'd Pokémon; each player then
    resolves their own between-turns. Prizes are taken for each KO.
- Taking a prize = pick one of **your own** face-down prize cards into your hand.
- If a KO empties a player's Active spot, that player must **promote** a Benched
  Pokémon to Active — this is done **during the Between-turns / after damage
  resolution**, before the next turn (§13). If they have **no Bench Pokémon** to
  promote, they lose (§14).

### 8.6 "Do as much as you can" (partial effect resolution)
An effect that names a quantity it cannot fully reach still resolves **as far as
it can**, rather than failing outright: "Discard 2 Energy from this Pokémon" with
one Energy attached discards that one. This applies to any effect whose quantity
outruns the board — a discard, a search for N cards, a heal-each. The exception
is text that makes the shortfall an explicit condition of the effect happening at
all ("If you can't, this attack does nothing"), which must be printed to apply.

The corroboration is printed on the cards themselves: Sandaconda (sv01-120) reads
*"Discard 2 Energy from this Pokémon. **If you discarded any Energy in this way**,
…"* — a rider that would be meaningless if a partial discard were illegal.

Engine note: this is why `discardEnergy`'s forced-pick rule auto-resolves whenever
the collapsed offer is ≤ the count — the no-choice rule and this one are the same
line of code (see D41/D43, `interpreter.ts forcedDiscards`).

---

## 9. Abilities vs. Attacks

- **Attacks** cost energy, are used **only from the Active spot**, and (with rare
  exceptions) **end the turn**. Only **one attack per turn**.
- **Abilities** are **not attacks**:
  - They do **not** cost energy and do **not** end the turn.
  - Many can be used from the **Bench** as well as Active (per the Ability's text).
  - Types the engine must support:
    - **Activated** (player triggers during their turn; often **once per turn** —
      track a per-Pokémon "used this turn" flag).
    - **Passive/continuous** (always on while in play — modify stats, damage, costs).
    - **Triggered** (fire on a condition — "when this Pokémon is KO'd", "between
      turns", "when you play this Pokémon", etc.).
  - Abilities can be **shut off** by effects ("Pokémon can't use Abilities"), so the
    engine needs an ability-enabled check.
- A given card may have **both** an Ability and attacks.

### 9.1 "Choose N" is not "up to N" — and "you may" is all-or-nothing

A printed number in a *choose* clause is **exact**: a card that allows a smaller
answer says so, in the words "**up to**". This is the same rule §7.5 states for a
hand cost, generalized to every choice a card asks for, and §8.6 is its only
softening: with fewer legal targets than the number, you choose as many as you can.

- "Put 3 damage counters on **1** of your opponent's Benched Pokémon"
  (Meowscarada ex, Radiant Blastoise) — exactly one. There is no answer "none",
  and it matters most where these cards live: the Ability's hand cost has already
  been paid and cannot be taken back.
- "**Choose 2** of your opponent's Benched Pokémon and put 1 damage counter on each"
  (Hawlucha) — exactly two, when two are there to choose.
- "Search your deck for **up to 2** Basic Energy cards" (Earthen Vessel) — one, two,
  or none, all legal.

A printed "**you may**" adds the *empty* answer, and only that one: it makes the
whole clause optional, not its number negotiable. Hawlucha's "**you may** choose 2"
is therefore **2 or none** — never 1 of 2 — and the "may" of an *activated* Ability
("Once during your turn, you **may** …") is spent by choosing to use the Ability at
all, so it adds nothing to the choice that follows.

One more exception rides the ZONE, not the number: a **search of a hidden zone**
("search your deck for …") may be **failed on purpose**, even when a match is
sitting there — the zone is private, and no one can force you to prove otherwise.
So a deck-search pick is declinable even where its printed count has no "up to"
(Pawmot's "search your deck for **a** Basic {L} Energy card"): the decline is the
printed right to fail the search, not a smaller answer to the number.

### 9.2 A clause can refer to what an earlier clause of the SAME card did

Most printed clauses are answerable from the board. Some are not: they ask what
*this card's own earlier sentence* actually did a moment ago, and the board cannot
tell you, because the board after the effect looks the same whether a card got
there by this effect or was already sitting there. Three wordings, one idea:

- "If you shuffled any cards into your deck **in this way**, draw 3 cards."
  (Miriam) — the benefit is conditional on the earlier clause having moved
  *something*. Declining an "up to" is a legal answer, and then this is false.
- "**If you do**, draw cards until you have 5 cards in your hand." (Dendra) — the
  same conditional, printed as the family's opening words. §7.5's play gate
  usually makes the false arm unreachable, but the sentence still says it.
- "(You can't choose a card you discarded with **the effect of this card**.)"
  (Superior Energy Retrieval) — the earlier clause's *specific cards* are barred
  from the later clause's choice. Here the board genuinely cannot answer: the
  cards paid and the cards already in the pile are the same kind of card in the
  same zone, and only the history distinguishes them.

A fourth wording asks the same question about a **subset** of what the earlier
clause did:

- "If you attached Energy to your **Active** Pokémon **in this way**, it is now
  Poisoned." (Janine's Secret Art) — the earlier clause may have attached two
  Energy and put neither on the Active, and then this is false. "Did the earlier
  clause do anything" is the wrong question; "did it reach *this* Pokémon" is the
  right one. Note the consequence for the player: the poison is theirs to take or
  avoid, decided by where they put the Energy, so a resolution that fired it on
  any attach at all would be removing a choice the card grants.

Three consequences worth stating separately, because each is a rule the engine
has to get right:

1. **It is the cards, not the kind.** Superior Energy Retrieval bars the two
   Energy *you just discarded*, not "Energy like the ones you discarded" — a
   second copy of the identical print already in the pile stays choosable.
2. **The clause need not be adjacent to the one it refers to.** Janine's Secret
   Art prints "… Then, **shuffle your deck**. If you attached Energy to your
   Active Pokémon **in this way**, it is now Poisoned" — a whole sentence stands
   between the action and the clause about it. Miriam's two sentences *are*
   adjacent on the card, but they stop being adjacent in any engine that models
   "shuffle N cards into your deck" as a move followed by a shuffle, which is the
   natural decomposition. Either way, "the previous thing that happened" is not a
   workable reading of "in this way".
3. **What the clause asks about can be narrower than what the earlier clause
   did.** Janine again: two Energy attached, both to the Bench, satisfies "you
   attached Energy" and fails "you attached Energy **to your Active Pokémon**".
   So the record of what happened is not enough on its own — the later clause may
   also need to know *where* it happened, which for an attach is a fact the board
   still holds.

**Ordering.** "Shuffle X into your deck" is one clause and the shuffle is *part of
it*: the cards go in and the deck is randomised before anything later reads it. A
resolution that put the cards back and drew before shuffling would leave them in a
**known position** — bottom of deck, in the order they were picked — which is
exactly what the printed word "shuffle" denies. (Miriam is the case in scope: the
draw that follows must come off a shuffled deck.)

### 9.3 "This Pokémon" resolves to the effect's own source

Text saying "**this Pokémon**" on an Ability, attack, or trigger means the
Pokémon whose printed text is running — wherever it sits, and **not** "your
Active" (Pawmot's "Electrogenesis" attaches to a benched Pawmot using it). A
Trainer card has no "this Pokémon". Engine: `EffectContext.sourceUid` (D50),
read so far by `attachFromDeck.toSelf`.

- The source is tracked as the **top card of its stack**. A source **evolved
  over** is no longer "this Pokémon" — the body the sentence pointed at has a
  new top card, and an effect aimed at the old one has no target. Likewise a
  source that has **left play** (KO'd, bounced). Either way the clause simply
  does nothing (§8.6's spirit), and the rest of the card still resolves.
- A Pokémon that leaves play and later **returns is a NEW Pokémon** — effects
  do not follow it. *Engine note (latent):* nothing in the current op
  vocabulary can return an in-play card to the board mid-program, so the
  resolver has never had to distinguish "still there" from "came back"; the
  first revival/self-recovery op must make it.

### 9.4 A card can put a decision on the player who did not play it

Almost every printed effect is decided by the player resolving it, even when it
reaches across the table: "choose a card from your opponent's hand", "put their
Benched Pokémon into the Active Spot" — the *target* is theirs, the *choice* is
yours. A small family inverts that, and the wording is the tell: **"your
opponent may …"**.

- "… your opponent **may** draw a card." (Ortega) — the draw is optional and the
  option is *theirs*. Nobody else can take it or refuse it for them.

This is not the same as an effect that merely affects the opponent (Judge
shuffles their hand; they decide nothing), nor the same as an "up to" you
decline on their behalf. It is a genuine second decider inside one card's
resolution, and the two decisions can be **interleaved with the turn**: the
turn does not pass, the game does not pause between turns — the player whose
turn it is simply waits while their opponent answers, and then their turn
continues.

Two consequences an engine has to get right:

1. **The controller and the answerer are different seats, and both matter.**
   The controller still owns the turn (allowances, the Supporter already spent,
   where control returns when the program finishes); the answerer owns only this
   question. Collapsing them either way is wrong: let the controller answer and
   you have given them a choice the card gave their opponent; hand the turn to
   the answerer and the board says it is their turn when it is not.
2. **A "may" whose answers are indistinguishable is not a decision.** Drawing
   from an empty deck moves nothing, so both answers leave the same game state
   and there is nothing to ask — the same rule that auto-resolves a forced pick
   (§8.6 and the "a choice with no choice in it" doctrine). Note this is about
   the *state*, not about kindness: a deck with one card is still a real
   question, and Ortega reaches exactly that case, since the card it just put on
   the bottom may be the only card there.

*Engine note:* `opponentMayDraw` (D52) parks with a `decider`; the phase carries
an `answerer` beside its controller `seat`, and only that seat's `resolveEffect`
is accepted. Whether the DECLINE should be visible to the controller is a
presentation question, not a rules one — no printed card makes anything depend
on it.

---

## 10. Evolution

- Evolution chain: **Basic → Stage 1 → Stage 2**. You evolve by placing the evolution
  card (whose `evolvesFrom` matches the current top card's name) **on top of** the
  in-play Pokémon.
- **Timing rules:**
  - You **cannot evolve a Pokémon on the turn it came into play** (was played to Bench,
    or was itself evolved this turn — one evolution step per Pokémon per turn).
  - You **cannot evolve on your first turn of the game** (§4).
  - There is **no per-turn cap** on how many *different* Pokémon you evolve — each
    Pokémon may be evolved once per turn.
  - Evolution can be done to Active **or** Benched Pokémon.
- **Carry-over on evolve**: damage counters, attached Energy, and attached Tools
  **remain**. **Special Conditions are removed** (§12). Most temporary "until end of
  turn / next turn" markers and effects tied to the pre-evolution card are **removed**
  (evolving is a common way to clear Sleep/Paralysis/Confusion/Poison/Burn).
- **Rare Candy** (Item exception): lets you evolve a **Basic directly into a Stage 2**,
  skipping Stage 1. Constraints: the Basic must have been in play **since your previous
  turn** (i.e., not placed this turn — same "not the turn it came into play" rule), and
  **not on your first turn**. Rare Candy only goes **Basic → Stage 2** (not Stage 1 →
  Stage 2). **[current]**
- **Devolution** (some effects): removes the top evolution card; excess damage past the
  now-lower HP causes a KO. Not a normal action — only via card effects.

---

## 11. Retreat

- **Once per turn.** Only the **Active Pokémon** retreats.
- **Retreat cost** = the number of **Colorless symbols** printed. To retreat: **discard
  attached Energy from that Pokémon equal to the retreat cost** (any energy counts, as
  the cost is Colorless). Cost 0 (free) = no discard.
- After paying, move the Active to an **open Bench slot** and **promote one of your
  Benched Pokémon** to Active (player's choice).
- **Retreating removes all Special Conditions** from the retreating Pokémon (it moves
  to the Bench).
- Cannot retreat if **Asleep or Paralyzed**, or if an effect prevents retreat, or if
  the Bench is empty (nothing to promote).
- Card effects can grant **additional** retreats or a **free/cost-reduced** retreat;
  these are separate from the base one-per-turn allowance.

---

## 12. Special Conditions

Only the **Active Pokémon** can have Special Conditions; **Benched Pokémon are immune**
(and lose conditions upon being benched). Conditions are **removed** when the Pokémon:
**retreats / moves to Bench, evolves, devolves, or by card effect**.

**Stacking / coexistence** (engine invariant):
- **Asleep, Paralyzed, Confused are mutually exclusive** — applying one **replaces**
  any of the other two (represented by *rotating* the card; only one rotation state).
- **Poisoned and Burned** are separate markers and **can coexist with each other and
  with** one of {Asleep, Paralyzed, Confused}.
- So the condition state is: `{ rotation ∈ {none, Asleep, Paralyzed, Confused},
  poisoned: bool (+ counters/checkup), burned: bool }`.

| Condition | Effect during the turn | At Pokémon Checkup (§13) | How cured (besides bench/evolve) |
|---|---|---|---|
| **Asleep** | Cannot **attack** or **retreat** | Flip a coin: **heads ⇒ wake up** (remove Asleep); tails stays Asleep | coin flip, card effect |
| **Burned** | No action restriction | Place **2 damage counters (20)**, then flip a coin: **heads ⇒ remove Burn** | coin flip, card effect |
| **Confused** | When it **attacks**, flip a coin: **tails ⇒ attack fails, 30 damage (3 counters) placed on itself, turn ends**. (Retreat/other actions still allowed.) | No checkup effect | card effect |
| **Paralyzed** | Cannot **attack** or **retreat** | Removed during the Checkup **after the affected player's own turn** (i.e., recovers for "the player who just finished their turn") | automatic (lasts ~1 turn), card effect |
| **Poisoned** | No action restriction | Place **1 damage counter (10)** on it (some effects poison for more) | card effect |

Notes:
- **Amount of Poison/Burn** can be increased by card effects (e.g. "this Pokémon is
  now Poisoned; put 2 damage counters instead of 1"). Model poison as a per-condition
  counter amount, default 10.
- **Paralysis timing** is the subtle one. The official rule (current rulebook:
  "after its owner's next turn, it recovers during Pokémon Checkup"; SWSH precise
  wording: remove Paralyzed during the between-turns step **if your Pokémon was
  Paralyzed since the beginning of your last turn**) makes the recovery
  **conditional**: it recovers at the Checkup after its owner's next turn — i.e.
  it is cleared for the seat whose turn just ended **only if it was Paralyzed since
  the beginning of that turn**. Opponent-inflicted paralysis always satisfies this
  (it was applied before the owner's turn began); paralysis **self-inflicted during
  the owner's own turn** (e.g. by their own attack, at their turn's end) does
  **not** — it must survive the immediately-following Checkup and last through the
  owner's whole next turn.
- **Engine stance**: the engine clears Paralysis unconditionally for the ended
  seat's Active — a simplification that is correct for **every opponent-inflicted
  case**. The one wrong case (self-inflicted at the owner's own turn end) is kept
  unreachable instead: the effect deriver (effects.ts) refuses "This Pokémon is now
  Paralyzed." and leaves it on the loud ATTACK_EFFECT_SKIPPED path. Recording an
  applied-this-turn stamp on the condition — which would let both cases run — is
  future work.

---

## 13. Pokémon Checkup (between-turns sequence)

Runs **between turns** — after the current player's turn ends, before the next player's
turn starts. Both players' Active Pokémon are processed. **Order [current]:**

1. **Poisoned** — each player places **1 damage counter (10)** on their Active if
   Poisoned (or the poison's counter amount).
2. **Burned** — each player places **2 damage counters (20)** on their Active if
   Burned, then flips a coin; **heads ⇒ remove Burn**.
3. **Asleep** — each player with an Asleep Active flips a coin; **heads ⇒ wake up**.
4. **Paralyzed** — the Active of the **player who just finished their turn** recovers
   from Paralysis (Paralysis removed for that player only), **only if it was
   Paralyzed since the beginning of that turn**: opponent-inflicted paralysis always
   was; paralysis self-inflicted during the turn that just ended survives this
   Checkup and clears after the owner's *next* turn (see the §12 timing note — the
   engine makes the self-inflicted case unreachable rather than modeling the
   condition's application turn).

Additional rules:
- All Special-Condition checks are conceptually resolved **as one batch**; other
  "between turns" effects/Abilities (e.g. "between turns, heal 10") also resolve here.
  If ordering between a condition and another between-turns effect matters, the player
  whose turn is starting typically chooses order — but the four condition checks above
  keep their fixed relative order.
- After the checkup damage is applied, **resolve any Knock Outs** (take prizes,
  promote a new Active from Bench). A player forced to promote with an **empty Bench**
  loses. Check win/loss (§14) **before** the next turn begins.
- Then the next player's turn starts (§5.1).

---

## 14. Win / loss conditions

A player **wins** (equivalently, the opponent loses) as soon as **any** of these is true.
Checks happen at the natural trigger points: after KOs/prizes, at start-of-turn draw,
and after promotion.

1. **Prizes taken**: you take your **last Prize card** (all 6). → you win.
2. **No Pokémon in play**: your opponent has **no Pokémon in play** (their Active was
   KO'd and they have no Benched Pokémon to promote). → you win. Checked whenever a
   Pokémon is KO'd / promotion is required.
3. **Deck-out**: your opponent **cannot draw** a card at the **start of their turn**
   because their deck is empty. → you win. Checked at the draw step.

**Simultaneous / tie handling:** if both players would win at the same instant (e.g.
both empty their Bench from one attack, or both take their last prize), the official
tournament rule breaks the tie via a **sudden-death game** (in casual play, treat as a
draw). Engine: surface a `TIE` / `SUDDEN_DEATH` outcome rather than silently picking.

---

## 15. What the engine must model (effect taxonomy)

The card-effect system must be able to represent, at minimum, these effect categories.
Design them as composable, data-driven **effect atoms** with a shared context (source
card, targets, the game state, RNG for coin flips):

**A. Attack effects**
- Base damage (fixed).
- Conditional / variable damage (coin flips, energy count, damage on self, number of
  Benched Pokémon, opponent state, "×N" scaling).
- Additional damage to **Bench** Pokémon (ignores Weakness/Resistance).
- Self-damage / recoil.
- Attack-imposed **Special Conditions** on the Defender.
- Energy discard as part of an attack cost or effect.
- "This Pokémon can't attack next turn," "can't use this attack next turn," etc.
  (per-Pokémon / per-attack markers).

**B. Damage modification (pipeline hooks)**
- Weakness (×2) and Resistance (−30) computation stage. **[current values]**
- Add/subtract to incoming or outgoing damage (Tools, Abilities, Stadiums).
- Prevent all / reduce damage; "no effect of attacks (including damage)".
- Redirect / spread damage; move damage counters; heal (remove counters).

**C. Abilities**
- Activated (once-per-turn or unlimited), passive/continuous, triggered
  (on-KO, on-play, between-turns, on-evolve, on-damaged).
- Ability-lock (disable opponents'/own Abilities).

**D. Trainer effects**
- Item (unbounded), Supporter (1/turn), Stadium (continuous, shared, replace-on-play),
  Tool (attach, 1/Pokémon, persistent).
- Effects that read/modify hand, deck, discard, prizes, or board.

**E. Search / shuffle / draw / deck manipulation**
- Draw N; search deck for a card matching a predicate; reveal; move between zones;
  shuffle; put cards on top/bottom of deck; look at prizes; discard from deck/hand.
- **"…in any way you like"** (Electric Generator, Hydreigon "Tri Howl", Charizard ex
  "Infernal Reign", Dragonite VSTAR "Draconic Star"): when an effect distributes
  several cards over several Pokémon, each card is assigned **independently** — any
  split is legal, including putting all of them on one Pokémon. It is not "one
  each", and the count taken is still capped by the printed "up to N" / unbounded
  for "any number" (both of which also permit taking **none**).
- **"For each of those Pokémon…"** is the OTHER distribution rule, and it is the
  one that makes the phrase above load-bearing rather than decorative. Janine's
  Secret Art — "Choose up to 2 of your {D} Pokémon. For each of those Pokémon,
  search your deck for a Basic {D} Energy card and attach it to **that** Pokémon"
  — distributes **one apiece to distinct Pokémon**; stacking both on one is not a
  legal answer. A card prints "in any way you like" exactly when the split is free,
  so the absence of that phrase is not silence, it is the other rule.
- **A per-target rule can make the printed maximum unreachable.** With one eligible
  Pokémon, Janine's "up to 2" is a hard 1, and no rule is violated — this is §8.6
  "do as much as you can" arriving from the target side rather than the card side.
- **Searching your deck vs. looking at the top N.** Both are hidden zones the
  controller is shown, and the cards taken become public while the rest stay
  hidden — but a search sees the WHOLE deck, so the two differ in what a client may
  reach and in how many candidates a real list produces. Where the cards taken are
  interchangeable (any Basic Energy of one type — the catalog prints each under
  several ids), *which* copy is taken is not a decision at all, and a resolution
  that asked would be asking a question the game does not contain.
- **The leftovers clause is part of the effect.** A look-at-the-top-N whose final
  sentence says "Shuffle the other cards back into your deck" or "**Discard** the
  other cards" performs that sentence **whether or not anything was taken** — a
  whiffed look and a declined one both pay it. The two are not interchangeable:
  the shuffle can be modelled as an independent following step (the cards never
  left the deck, and a shuffle destroys order anyway), while the discard must name
  exactly the looked-at cards that were not taken.
- Only the cards actually TAKEN become public (they are revealed, or land on the
  board / in the discard pile). The ones returned to the deck stay hidden — which
  is why the shuffle matters: it removes what the controller learned about the
  deck's order.

**F. Energy effects**
- Attach from hand (base 1/turn) or accelerate (extra attachments from effects).
- Special Energy: provides typed/colorless units; ongoing rules text; conditions for
  which Pokémon it can attach to; discard-on-condition.
- Cost checking: typed + Colorless matching against attached energy.

**G. Board / positioning**
- Play Basic to Bench (cap 5), evolve/devolve (stack management, carry-over rules),
  retreat (pay cost, promote), forced switch (gust / promote opponent's Bench to
  Active), swap Active/Bench, bounce to hand, put on top of deck.

**H. Special Conditions & status**
- Apply/replace (rotation exclusivity), poison/burn counter amounts, cure on
  bench/evolve/retreat, checkup processing (§13).

**I. Prizes & win-state**
- Per-Pokémon `prizeValue` (rule-box extra prizes), take-prize on KO, extra/fewer
  prize effects, win-condition evaluation (all-prizes / no-Pokémon / deck-out / tie).

**J. Turn & phase control**
- Per-turn allowance counters (Energy attach, Supporter, Stadium, retreat, per-Ability
  once-per-turn flags) — reset each turn.
- First-turn restriction flags (no attack / no Supporter / no evolve for P1 turn 1;
  no evolve for either player's own turn 1).
- End-the-turn on attack; between-turns hook.

**K. Randomness (must be deterministic/seedable)**
- Coin flips (single, multi, "until tails"), shuffles, and any random choice must run
  off a **seeded RNG** so games are reproducible/replayable.

---

## 15b. Quantifiers over an EMPTY set — what the rules say (nothing) and what this engine does (D373)

**⚠️ THIS SECTION EXISTS BECAUSE THE ANSWER IS AN ABSENCE.** A printed condition that
quantifies over a set the player may have none of — *"if **all** of your Benched Pokémon
…"*, *"if **none** of your Pokémon …"*, *"if **any** of your Benched Pokémon …"* — has to
be answered on an empty set, and **no published rule settles the positive universal.**
Four instruments were checked at D373 and all four are silent:

| Instrument | Answer |
|---|---|
| This file's own ruleset (§1–§16) | no quantifier rule at all |
| Official **Pokémon TCG glossary** (pokemon.com) | defines neither *"all"* nor *"each"* |
| **Pokémon Rulings Compendium** | nothing on a universal antecedent over an empty Bench — its Bench/Attacks rulings cover *"do as much as you can"* for **EFFECTS**, which is a different question |
| **Official Japanese card page** for the one printing that raises it (ジジーロン / Drampa, SV5M 060) | **no Q&A entry at all** |

So the engine has to **choose**, and a choice must be written down as a choice.

### The three cases, and only ONE of them is a choice

* **`∃` (existential — *"any of your Benched Pokémon …"*)** → **FALSE** on an empty set.
  **Forced by logic**, not chosen. `yourBenchDamaged`.
* **`¬∃` (negated existential — *"none of your Pokémon have any Energy attached"*)** →
  **TRUE** on an empty set. **Also forced by logic** — it is the negation of the line
  above. `noEnergyOnYourPokemon`.
* **`∀` (positive universal — *"all of your Benched Pokémon have at least 1 damage
  counter on them"*)** → **THE ONLY REAL QUESTION.** Classical logic says TRUE
  (vacuously); ordinary English says the phrase *presupposes* that you have some, and the
  Japanese printing says it harder (「ベンチポケモン**全員**に」 — *all members*).

🛑 **DO NOT READ THE FIRST TWO AS PRECEDENTS FOR THE THIRD.** They are each other's
negation and carry no information about a positive universal. D369 read
`noEnergyOnYourPokemon`'s vacuous TRUE as a chosen convention and deferred a slice on
that basis; D373 corrected it.

### THE ENGINE'S CHOICE: a positive universal is FALSE on an empty set

`yourBenchAllDamaged` is `bench.length > 0 && bench.every(…)`. Two tie-breaks, and they
agree:

1. **The pay-out is asymmetric.** A wrong TRUE silently ADDS damage on a board the
   attacker did nothing to earn; a wrong FALSE withholds a bonus a player can see is
   missing and dispute. An engine that must guess should guess toward **not paying**.
2. **The printed clause has to do work.** Under the vacuous reading the cheapest way to
   satisfy a condition about your Bench is **to have no Bench** — the condition would be
   satisfied by *ignoring* it.

**It also buys an invariant:** with the guard, `∀ ⟹ ∃` holds on **every** board. Without
it, the empty set is the one board where a TRUE universal sits above a FALSE existential.

**WHAT WOULD FALSIFY THIS AND FLIP IT:** an official Q&A on the printing, a Rulings
Compendium entry, or PTCG Live observed paying the bonus with an empty Bench. The remedy
is one deleted clause in `conditionHolds` and one inverted expectation in
`benchAllDamagedBonus.test.ts` §2.

⚠️ **AND THIS IS ABOUT *CONDITIONS*, NOT *EFFECTS*.** An EFFECT over an empty set is
already settled by the game's *"do as much as you can"* rule and does nothing — that is
not in dispute and is not what this section is about.

---

## 16. Suggested state-machine phases

A minimal phase enumeration for the engine loop:

```
SETUP → (per turn) [ TURN_START → DRAW → ACTION (loop) → ATTACK? → TURN_END ]
      → BETWEEN_TURNS (Pokémon Checkup) → [next player's TURN_START] ...
      → GAME_OVER
```

- **SETUP**: coin flip, deal hands, mulligans + compensation, place Active/Bench,
  set 6 prizes.
- **TURN_START**: reset per-turn counters; resolve start-of-turn triggers.
- **DRAW**: draw 1 (deck-out ⇒ GAME_OVER for that player).
- **ACTION**: process player actions in any order under the per-turn caps (§5.2).
- **ATTACK**: optional single attack; declaring it exits ACTION; resolve §8; then
  TURN_END. (P1 turn 1 may not enter ATTACK.)
- **TURN_END → BETWEEN_TURNS**: run Pokémon Checkup (§13), KO/promote resolution,
  win-check.
- **GAME_OVER**: emit winner / tie.

Interrupt points where the acting player must make a **choice** (search selections,
which prize to take, which Pokémon to promote, coin-flip-dependent branches, targeting)
must be modeled as explicit engine "await decision" states for both hotseat and
networked play.

---

## Sources

- Official Pokémon TCG Rulebook (Paradox Rift), pokemon.com —
  <https://www.pokemon.com/static-assets/content-assets/cms2/pdf/trading-card-game/rulebook/par_rulebook_en.pdf>
- Official Pokémon TCG Rulebook (151), pokemon.com —
  <https://www.pokemon.com/static-assets/content-assets/cms2/pdf/trading-card-game/rulebook/mew_rulebook_en.pdf>
- Official Pokémon TCG Quick Start Rules —
  <https://tcg.pokemon.com/assets/img/learn-to-play/getting-started/quick-start-rules/en-us/quick_start_rulebook.pdf>
- Bulbapedia — Pokémon Checkup —
  <https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Checkup>
- Bulbapedia — Special Condition (TCG) —
  <https://bulbapedia.bulbagarden.net/wiki/Special_Condition_(TCG)>
- Pokémon TCG Archive — First Turn Rules (Full history) —
  <https://ptcgarchive.com/first-turn-rules-full/>
- PokeCardHQ — First Turn Rules —
  <https://www.pokecardhq.com/pokemon-tcg-first-turn-rules/>
- Pokémon Rulings Compendium — Weakness and Resistance —
  <https://compendium.pokegym.net/category/7-gameplay/weakness-and-resistance/>
- Pokémon Rulings Compendium — Rare Candy —
  <https://compendium.pokegym.net/category/5-trainers/rare-candy-trainer/>
- TheGamer — Weakness & Resistance explained —
  <https://www.thegamer.com/pokemon-tcg-weakness-resistance-faq-explained/>
- §15b (D373) — Drampa, Temporal Forces #138/#184, "Raging Cannon" —
  <https://limitlesstcg.com/cards/TEF/138>
- §15b (D373) — the same printing on the OFFICIAL Japanese site, ジジーロン SV5M 060,
  checked for a card Q&A and carrying NONE —
  <https://www.pokemon-card.com/card-search/details.php/card/45277>
- §15b (D373) — official Pokémon TCG glossary, checked for "all"/"each" and defining
  neither — <https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-glossary>

<!-- Rules current as of the Scarlet & Violet Standard era (verified 2026-07). Values
flagged [current] (first-player no-Supporter/no-attack, Weakness ×2, Resistance −30,
ex = 2 prizes, 9 energy types / no Fairy) are the version-dependent ones to revisit if
targeting a different era. -->
