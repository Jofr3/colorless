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

<!-- Rules current as of the Scarlet & Violet Standard era (verified 2026-07). Values
flagged [current] (first-player no-Supporter/no-attack, Weakness ×2, Resistance −30,
ex = 2 prizes, 9 energy types / no Fairy) are the version-dependent ones to revisit if
targeting a different era. -->
