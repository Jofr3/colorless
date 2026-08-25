import * as effects from "./effects";

// 0.189.0 — D274, THE CENSUS'S LAST UNGUARDED COLUMN: the committed corpus that
// makes `BUILT.attack` derivable at test time.
//
// 🛑 WHY THIS FILE EXISTS. D273 took the three NON-ATTACK columns of
// `censusAtHead.test.ts`'s `BUILT` live — the pool comes off `registryCardIds()`
// on every run and the catalog facts are a recorded four-way PARTITION, so adding
// a registry row REDDENS the suite by name. It left `BUILT.attack` alone and said
// so: *"the same defect, one column over"*. That constant was the seven-reader
// sweep's number plus 4, and NOTHING RE-RAN THE SWEEP — the readers could be
// widened, narrowed or broken outright and 1115 would sit there being green.
//
// ⚠️ THE OBSTACLE, AND THE SHAPE THAT GETS AROUND IT. The sweep's population is a
// CATALOG fact (the legal attack column) and this suite deliberately has no
// catalog. So the population is COMMITTED here and the READERS are run LIVE
// against it — the same division of labour D273 used for the non-attack columns
// (pool live, catalog facts recorded), with the halves swapped: there the pool was
// live and the classification recorded; here the classification (which sentences
// resolve) is live and the population is recorded.
//
// ⚠️ PROVENANCE — the exact statement, run against remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-08:
//
//     SELECT COUNT(*) AS n, json_extract(j.value,'$.effect') AS s
//       FROM cards c, json_each(c.attacks_json) j
//      WHERE c.legal_standard = 1
//        AND json_extract(j.value,'$.effect') NOT IN ('')
//      GROUP BY s ORDER BY s;
//
// It returns **640 rows / 1,732 units / 60,467 characters of distinct sentence
// text** — the identical triple `censusAtHead.test.ts` has quoted since D233, which
// is the transcription's own check: the three totals are asserted there and a
// dropped or doubled line moves at least one of them.
//
// ⚠️ THE POPULATION IS `legal_standard = 1` AND NOTHING ELSE. It is the
// denominator `POPULATION.attackUnits` (1,732) already names, so the corpus and
// that constant are two spellings of one query and the suite ties them together.
//
// ⚠️ FORMAT: one record per line, `<legal printings> <the printed sentence>`,
// split at the FIRST space. No sentence in the catalog begins with a digit and none
// carries a leading or trailing space (checked at parse time below), so the split
// is unambiguous. Sorted by sentence, so a diff to this file reads as a catalog
// diff rather than a reshuffle.
//
// 🛑 THIS FILE IS DATA AND MUST NOT BE HAND-EDITED TO MAKE A TEST PASS. It is the
// measured catalog; if it disagrees with the suite, the suite is what moved. The
// one legitimate edit is a RE-RUN of the statement above when the sets rotate, and
// that edit moves `POPULATION` and `BUILT.attack` with it.

/** The whole `legal_standard = 1` attack column, grouped by sentence. */
const CORPUS = `
1 At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards.
3 At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon.
2 Attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon.
2 Attach a Basic Energy card from your hand to 1 of your Pokémon.
2 Attach a Basic Energy card from your hand to this Pokémon.
2 Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.
2 Attach a Basic {F} Energy card from your discard pile to this Pokémon.
3 Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal all damage from that Pokémon.
1 Attach a Basic {M} Energy card from your discard pile to this Pokémon.
1 Attach a Basic {R} Energy card from your discard pile to 1 of your {N} Pokémon.
1 Attach an Energy card from your discard pile to this Pokémon.
1 Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.
2 Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.
1 Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.
2 Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon.
1 Attach up to 2 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like.
2 Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like.
1 Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.
1 Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.
1 Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing.
5 Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.
1 Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon. If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.
1 Both Active Pokémon are Knocked Out.
1 Both Active Pokémon are now Asleep. During your next turn, attacks used by this Pokémon do 100 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).
4 Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.
3 Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.
3 Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.
1 Choose 1 of your opponent's Active Tera Pokémon's attacks and use it as this attack.
2 Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.
3 Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.
1 Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.
2 Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck.
5 Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck.
1 Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.
1 Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.
3 Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.
1 Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing.
20 Discard 2 Energy from this Pokémon.
1 Discard 2 Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).
2 Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
3 Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
5 Discard 3 Energy from this Pokémon.
2 Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.
1 Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing.
4 Discard a Special Energy from your opponent's Active Pokémon.
4 Discard a Stadium in play.
1 Discard a Stadium in play. If you can't, this attack does nothing.
3 Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards.
1 Discard a card from your hand. If you do, draw 2 cards.
1 Discard a card from your hand. If you do, draw 3 cards.
1 Discard a card from your hand. If you do, your opponent discards a card from their hand.
8 Discard a random card from your opponent's hand.
2 Discard a {G} Energy from this Pokémon.
1 Discard a {R} Energy from this Pokémon.
2 Discard a {R} Energy from your opponent's Active Pokémon.
3 Discard all Energy from this Pokémon, and take a Prize card.
2 Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)
15 Discard all Energy from this Pokémon.
2 Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.
3 Discard all Energy from this Pokémon. During your opponent's next turn, they can't play any Item cards from their hand.
1 Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
2 Discard all Energy from this Pokémon. This attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.
2 Discard all Special Energy from all of your opponent's Pokémon.
2 Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.
1 Discard all {M} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.
1 Discard all {R} Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
24 Discard an Energy from this Pokémon.
1 Discard an Energy from your opponent's Active Pokémon ex.
6 Discard an Energy from your opponent's Active Pokémon.
3 Discard the top 2 cards of your opponent's deck.
1 Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way.
2 Discard the top 3 cards of your deck.
3 Discard the top 3 cards of your opponent's deck.
1 Discard the top 7 cards of your deck, and this attack does 70 damage for each Misty's Pokémon that you discarded in this way.
2 Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.
1 Discard the top card of your deck, and if that card is a Pokémon that doesn't have a Rule Box, choose 1 of its attacks and use it as this attack. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)
2 Discard the top card of your deck.
7 Discard the top card of your opponent's deck.
2 Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.
2 Discard this Pokémon and all attached cards.
2 Discard up to 2 Pokémon Tools from your opponent's Pokémon.
2 Discard up to 2 {M} Energy from this Pokémon. This attack does 120 damage for each card you discarded in this way.
2 Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 Discard up to 3 {G} Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way.
1 Discard up to 5 {R} Energy from this Pokémon. This attack does 70 damage for each card you discarded in this way.
7 Discard your hand and draw 6 cards.
9 Draw 2 cards.
1 Draw 3 cards from the bottom of your deck.
2 Draw 3 cards.
2 Draw 4 cards.
22 Draw a card.
1 Draw cards until you have 7 cards in your hand.
1 During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).
1 During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards.
2 During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).
58 During your next turn, this Pokémon can't attack.
3 During your next turn, this Pokémon can't use Boss Headbutt.
4 During your next turn, this Pokémon can't use Brave Slash.
1 During your next turn, this Pokémon can't use Cyber Drive.
3 During your next turn, this Pokémon can't use Dirty Headbutt.
4 During your next turn, this Pokémon can't use Flare Strike.
2 During your next turn, this Pokémon can't use Giant Wave.
3 During your next turn, this Pokémon can't use Haymaker.
1 During your next turn, this Pokémon can't use Impact Blow.
1 During your next turn, this Pokémon can't use Ogre's Hammer.
2 During your next turn, this Pokémon can't use Slashing Strike.
1 During your next turn, this Pokémon can't use Zap Cannon.
1 During your next turn, this Pokémon can't use Zen Blade.
4 During your next turn, this Pokémon can't use attacks.
3 During your next turn, this Pokémon's Echoed Voice attack does 80 more damage (before applying Weakness and Resistance).
2 During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.
2 During your next turn, this Pokémon's Meteor Mash attack does 60 more damage (before applying Weakness and Resistance).
1 During your next turn, this Pokémon's Tornado Rush attack does 100 more damage (before applying Weakness and Resistance).
1 During your next turn, your Pokémon can't attack. (This includes new Pokémon that come into play.)
1 During your opponent's next turn, Pokémon that have 2 or less Energy attached can't attack. (This includes new Pokémon that come into play.)
1 During your opponent's next turn, attacks used by the Defending Pokémon cost {C} more, and its Retreat Cost is {C} more.
5 During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance).
1 During your opponent's next turn, attacks used by the Defending Pokémon do 20 less damage (before applying Weakness and Resistance).
1 During your opponent's next turn, attacks used by the Defending Pokémon do 30 less damage (before applying Weakness and Resistance).
1 During your opponent's next turn, attacks used by the Defending Pokémon do 40 less damage (before applying Weakness and Resistance).
2 During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.
1 During your opponent's next turn, if they attach an Energy card from their hand to the Defending Pokémon, their turn ends.
5 During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put 8 damage counters on the Attacking Pokémon.
1 During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.
2 During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.
1 During your opponent's next turn, prevent all damage done to each of your Future Pokémon by attacks from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this effect ends.
1 During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.
1 During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.
7 During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic non-{C} Pokémon.
2 During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 40 or less.
1 During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 60 or less.
3 During your opponent's next turn, the Defending Pokémon can't attack.
35 During your opponent's next turn, the Defending Pokémon can't retreat.
4 During your opponent's next turn, the Defending Pokémon can't use attacks.
3 During your opponent's next turn, they can't play any Item cards from their hand.
1 During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon.
3 During your opponent's next turn, this Pokémon has no Weakness.
5 During your opponent's next turn, this Pokémon takes 10 less damage from attacks (after applying Weakness and Resistance).
4 During your opponent's next turn, this Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance).
10 During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).
2 During your opponent's next turn, this Pokémon takes 40 less damage from attacks (after applying Weakness and Resistance).
7 During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance).
1 During your opponent's next turn, this Pokémon takes 60 less damage from attacks (after applying Weakness and Resistance).
1 Each player draws 3 cards.
1 Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon.
1 Flip 2 coins. For each heads, discard the top card of your opponent's deck.
2 Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself.
5 Flip 2 coins. This attack does 10 damage for each heads.
2 Flip 2 coins. This attack does 100 damage for each heads.
7 Flip 2 coins. This attack does 20 damage for each heads.
2 Flip 2 coins. This attack does 30 damage for each heads.
3 Flip 2 coins. This attack does 30 more damage for each heads.
4 Flip 2 coins. This attack does 40 damage for each heads.
2 Flip 2 coins. This attack does 50 more damage for each heads.
1 Flip 2 coins. This attack does 70 damage for each heads.
2 Flip 2 coins. This attack does 80 damage for each heads.
3 Flip 2 coins. This attack does 90 damage for each heads.
1 Flip 2 coins. This attack does 90 damage for each heads. If both of them are tails,  your opponent's Active Pokémon is now Confused.
2 Flip 2 coins. This attack does 90 damage for each heads. If either of them is heads, your opponent's Active Pokémon is now Paralyzed.
1 Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.
1 Flip 3 coins. For each heads, discard a random card from your opponent's hand.
1 Flip 3 coins. For each tails, discard an Energy from this Pokémon.
1 Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 50 more damage. If all of them are heads, this attack does 80 more damage.
2 Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.
4 Flip 3 coins. This attack does 10 damage for each heads.
2 Flip 3 coins. This attack does 120 damage for each heads.
3 Flip 3 coins. This attack does 20 damage for each heads.
2 Flip 3 coins. This attack does 30 damage for each heads.
2 Flip 3 coins. This attack does 50 damage for each heads.
1 Flip 4 coins. This attack does 10 damage for each heads.
2 Flip 4 coins. This attack does 100 damage for each heads.
1 Flip 4 coins. This attack does 30 damage for each heads.
1 Flip 4 coins. This attack does 60 damage for each heads. If at least 2 of them are heads, your opponent's Active Pokémon is now Paralyzed.
1 Flip 4 coins. This attack does 70 damage for each heads.
1 Flip 4 coins. This attack does 80 damage for each heads.
1 Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads.
1 Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.
2 Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads.
1 Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.
2 Flip a coin until you get tails. This attack does 10 damage for each heads.
1 Flip a coin until you get tails. This attack does 100 damage for each heads.
1 Flip a coin until you get tails. This attack does 20 more damage for each heads.
4 Flip a coin until you get tails. This attack does 30 more damage for each heads.
1 Flip a coin until you get tails. This attack does 40 damage for each heads.
3 Flip a coin until you get tails. This attack does 50 damage for each heads.
1 Flip a coin until you get tails. This attack does 50 more damage for each heads.
1 Flip a coin until you get tails. This attack does 70 damage for each heads.
1 Flip a coin until you get tails. This attack does 90 damage for each heads.
4 Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.
1 Flip a coin. If heads, choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.
2 Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon. Shuffle that Pokémon and all attached cards into their deck.
12 Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.
4 Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.
15 Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.
1 Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't attack.
2 Flip a coin. If heads, this attack does 10 more damage.
1 Flip a coin. If heads, this attack does 100 more damage.
20 Flip a coin. If heads, this attack does 20 more damage.
1 Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.
3 Flip a coin. If heads, this attack does 30 more damage.
5 Flip a coin. If heads, this attack does 40 more damage.
1 Flip a coin. If heads, this attack does 50 more damage.
5 Flip a coin. If heads, this attack does 60 more damage.
1 Flip a coin. If heads, this attack does 80 more damage.
2 Flip a coin. If heads, your opponent's Active Pokémon is now Burned.
1 Flip a coin. If heads, your opponent's Active Pokémon is now Confused and Poisoned.
1 Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned.
2 Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.
2 Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.
27 Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.
1 Flip a coin. If tails, during your next turn, this Pokémon can't attack.
16 Flip a coin. If tails, this attack does nothing.
2 Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.
4 For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.
1 Heal 10 damage from each of your Pokémon.
9 Heal 10 damage from this Pokémon.
1 Heal 100 damage from 1 of your Benched Ancient Pokémon.
2 Heal 100 damage from each of your Basic Pokémon.
2 Heal 100 damage from each of your Benched Pokémon.
2 Heal 20 damage from each of your Pokémon.
7 Heal 20 damage from this Pokémon.
2 Heal 30 damage from 1 of your Pokémon.
3 Heal 30 damage from each of your Pokémon.
13 Heal 30 damage from this Pokémon.
1 Heal 40 damage from 1 of your Pokémon.
3 Heal 40 damage from this Pokémon.
4 Heal 50 damage from each of your Pokémon.
2 Heal 50 damage from this Pokémon.
1 Heal 50 damage from this Pokémon. During your next turn, this Pokémon can't retreat.
2 Heal 60 damage from this Pokémon. During your next turn, this Pokémon can't retreat.
6 Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon.
1 If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.
1 If Beldum and Metang are on your Bench, this attack does 150 more damage.
2 If Durant is on your Bench, this attack does 20 more damage.
1 If Illumise is on your Bench, this attack does 60 more damage.
1 If Mightyena is on your Bench, this attack does 90 more damage.
1 If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.
1 If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.
1 If a Stadium is in play, this attack does 70 more damage.
2 If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.
1 If any of your Benched Cubone have any damage counters on them, this attack does 120 more damage.
1 If any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage.
2 If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, this attack does 120 more damage.
1 If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 60 more damage.
2 If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 80 more damage.
2 If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 90 more damage.
1 If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.
1 If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage.
1 If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 If there are 3 or fewer cards in your deck, this attack does 200 more damage.
2 If there is no Stadium in play, this attack does nothing.
1 If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.
1 If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 120 more damage.
1 If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage.
1 If this Pokémon evolved from Misty's Staryu during this turn, this attack does 80 more damage.
1 If this Pokémon has 2 or more {G} Energy attached, this attack does 120 more damage.
2 If this Pokémon has a Pokémon Tool attached, this attack does 40 more damage.
2 If this Pokémon has any Special Energy attached, this attack does 100 more damage.
2 If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.
1 If this Pokémon has any damage counters on it, this attack can be used for {F}.
2 If this Pokémon has any {F} Energy attached, this attack does 20 more damage.
1 If this Pokémon has any {L} Energy attached, this attack does 80 more damage.
2 If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 100 more damage.
3 If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.
1 If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.
3 If this Pokémon has no damage counters on it, this attack does 120 more damage.
3 If this Pokémon is Poisoned, this attack does 130 more damage.
1 If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.
2 If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage.
3 If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 90 more damage.
1 If this Pokémon used Form Ranks during your last turn, this attack does 90 more damage.
1 If this Pokémon used Pervasive Gas during your last turn, this attack does 120 more damage.
2 If this Pokémon was healed during this turn, this attack does 100 more damage.
2 If you don't have Uxie and Azelf on your Bench, this attack does nothing.
2 If you don't have exactly 3 cards in your hand, this attack does nothing.
2 If you don't have the same number of cards in your hand as your opponent, this attack does nothing.
2 If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.
1 If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.
7 If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.
2 If you have 10 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage.
1 If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.
4 If you have 4 or fewer Benched Pokémon, this attack does nothing.
1 If you have any Tera Pokémon on your Bench, this attack does 100 more damage.
2 If you have any {M} Pokémon on your Bench, this attack does 80 more damage.
1 If you have at least 3 {D} Energy in play, this attack does 50 more damage.
1 If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed.
2 If you have more Prize cards remaining than your opponent, this attack does 90 more damage.
2 If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.
1 If you played a Future Supporter card from your hand during this turn, this attack does 100 more damage.
1 If you use this attack when you have exactly 1 Prize card remaining, you win this game.
1 If your Benched Pokémon have any damage counters on them, this attack does 120 more damage.
1 If your Benched Pokémon have any damage counters on them, this attack does 80 more damage.
1 If your Benched Pokémon have any damage counters on them, this attack does 90 more damage.
1 If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing.
2 If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.
1 If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.
2 If your opponent has 4 or fewer Prize cards remaining, this attack does 70 more damage.
1 If your opponent has 5 or fewer cards in their hand, this attack does 60 more damage.
1 If your opponent has any Future Pokémon in play, this attack does 120 more damage.
1 If your opponent has any {W} Pokémon in play, this attack does 120 more damage.
1 If your opponent's Active Pokémon already has any damage counters on it, this attack does 100 more damage.
3 If your opponent's Active Pokémon already has any damage counters on it, this attack does 60 more damage.
1 If your opponent's Active Pokémon already has any damage counters on it, this attack does 80 more damage.
2 If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.
1 If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out.
2 If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.
2 If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage.
1 If your opponent's Active Pokémon is Burned, this attack does 40 more damage.
1 If your opponent's Active Pokémon is Confused, this attack does 90 more damage.
1 If your opponent's Active Pokémon is Poisoned, this attack does 100 more damage.
2 If your opponent's Active Pokémon is Poisoned, this attack does 60 more damage.
2 If your opponent's Active Pokémon is Poisoned, this attack does 90 more damage.
2 If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.
3 If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 110 more damage.
1 If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 120 more damage.
1 If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 80 more damage.
1 If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 90 more damage.
4 If your opponent's Active Pokémon is a Pokémon ex, this attack does 100 more damage.
1 If your opponent's Active Pokémon is a Pokémon ex, this attack does 40 more damage.
1 If your opponent's Active Pokémon is a Pokémon ex, this attack does 50 more damage.
2 If your opponent's Active Pokémon is a Pokémon ex, this attack does 70 more damage.
1 If your opponent's Active Pokémon is a Pokémon ex, this attack does 80 more damage.
1 If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage.
1 If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.
2 If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.
1 If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage.
1 If your opponent's Active Pokémon is a {D} Pokémon, this attack does 100 more damage.
2 If your opponent's Active Pokémon is a {N} Pokémon, it is now Paralyzed.
2 If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.
8 If your opponent's Active Pokémon is affected by a Special Condition, this attack does 120 more damage.
5 If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.
1 If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.
2 If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 80 more damage.
1 If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 90 more damage.
1 If your opponent's Active Pokémon isn't Burned, this attack does nothing.
2 If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.
2 Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it.
1 Look at 1 of your opponent's face-down Prize cards.
2 Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.
3 Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.
1 Look at the top 4 cards of your deck and put them back in any order.
3 Look at the top 5 cards of your opponent's deck and put them back in any order.
2 Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.
3 Look at the top card of your deck. You may discard that card.
1 Look at the top card of your opponent's deck. You may have your opponent shuffle their deck.
3 Move 3 Energy from this Pokémon to 1 of your Benched Pokémon.
2 Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon.
2 Move all Energy from this Pokémon to 1 of your Benched Pokémon.
1 Move all Energy from this Pokémon to your Benched Pokémon in any way you like.
1 Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.
2 Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.
2 Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.
2 Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon.
8 Move an Energy from this Pokémon to 1 of your Benched Pokémon.
2 Put 1 of your Benched Pokémon and all attached cards into your hand.
3 Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.
1 Put 2 damage counters on 1 of your opponent's Pokémon.
1 Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.
1 Put 2 damage counters on each of your opponent's Pokémon.
3 Put 2 damage counters on your opponent's Benched Pokémon in any way you like.
1 Put 4 damage counters on your opponent's Pokémon in any way you like.
1 Put 6 damage counters on each Pokémon that has an Ability (both yours and your opponent's).
4 Put 6 damage counters on your opponent's Benched Pokémon in any way you like.
1 Put a Basic {G} Energy card from your discard pile into your hand.
1 Put a Pokémon from your discard pile into your hand.
3 Put a Supporter card from your discard pile into your hand.
1 Put a Trainer card from your discard pile into your hand.
5 Put an Energy attached to this Pokémon into your hand.
2 Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.
1 Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.
2 Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.
1 Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.
1 Put this Pokémon and all attached cards into your hand.
2 Put up to 2 Pokémon from your discard pile into your hand.
3 Put up to 3 Duskull from your discard pile onto your Bench.
3 Put up to 3 {W} Pokémon from your discard pile onto your Bench.
1 Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.
3 Reveal the top 10 cards of your opponent's deck. You may choose an attack from a Pokémon you find there and use it as this attack. Shuffle the revealed cards into your opponent's deck.
2 Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck.
1 Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order.
2 Search your deck for a Basic Energy card and attach it to this Pokémon. Then, shuffle your deck.
1 Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.
7 Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.
1 Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck. If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon.
1 Search your deck for a Basic {F} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.
1 Search your deck for a Basic {G} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.
2 Search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.
1 Search your deck for a Basic {M} Energy card and attach it to this Pokémon. Then, shuffle your deck.
1 Search your deck for a Basic {R} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.
1 Search your deck for a Basic {W} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.
1 Search your deck for a Pikachu and put it onto your Bench. Then, shuffle your deck.
1 Search your deck for a Pokémon Tool card, reveal it, and put it into your hand. Then, shuffle your deck.
3 Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.
1 Search your deck for a Stadium card, reveal it, and put it into your hand. Then, shuffle your deck.
3 Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.
2 Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.
4 Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.
1 Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck.
4 Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.
2 Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.
2 Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.
2 Search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.
5 Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.
7 Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.
1 Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck.
3 Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.
2 Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.
1 Search your deck for up to 2 Basic {L} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.
1 Search your deck for up to 2 Basic {P} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.
2 Search your deck for up to 2 Basic {W} Energy cards and attach them to this Pokémon. Then, shuffle your deck.
1 Search your deck for up to 2 Froakie and put them onto your Bench. Then, shuffle your deck.
1 Search your deck for up to 2 Grubbin and put them onto your Bench. Then, shuffle your deck.
1 Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto your Bench. Then, shuffle your deck.
1 Search your deck for up to 2 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.
3 Search your deck for up to 3 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.
1 Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.
1 Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.
1 Search your deck for up to 3 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.
2 Search your deck for up to 3 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.
1 Search your deck for up to 3 Basic {G} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.
1 Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck.
2 Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.
1 Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.
2 Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.
2 Search your deck for up to 3 {D} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.
1 Search your deck for up to 4 Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.
1 Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.
2 Shuffle 1 of your Benched Pokémon and all attached cards into your deck.
1 Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck.
1 Shuffle your hand into your deck. Then, draw 6 cards.
1 Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand.
2 Switch in 1 of your opponent's Benched Pokémon to the Active Spot.
1 Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 120 damage to the new Active Pokémon. If you didn't play Xerosic's Machinations from your hand during this turn, this attack does nothing.
2 Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 20 damage to the new Active Pokémon.
2 Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.
2 Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 40 damage to the new Active Pokémon.
1 Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 70 damage to the new Active Pokémon.
10 Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)
1 Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.
7 Switch this Pokémon with 1 of your Benched Pokémon.
1 Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.
1 Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)
1 Switch this Pokémon with 1 of your Benched {L} Pokémon.
1 This Pokémon also does 10 damage to itself for each damage counter on it.
21 This Pokémon also does 10 damage to itself.
11 This Pokémon also does 20 damage to itself.
13 This Pokémon also does 30 damage to itself.
4 This Pokémon also does 40 damage to itself.
6 This Pokémon also does 50 damage to itself.
3 This Pokémon also does 60 damage to itself.
1 This Pokémon also does 70 damage to itself.
2 This Pokémon also does 80 damage to itself.
5 This Pokémon can't use Blaze Blitz again until it leaves the Active Spot.
1 This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out.
2 This Pokémon is now Asleep. Heal 30 damage from it.
3 This Pokémon is now Confused.
2 This Pokémon recovers from all Special Conditions.
1 This attack also does 10 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)
3 This attack also does 10 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
3 This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
3 This attack also does 130 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
15 This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 30 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 30 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 40 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack also does 50 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
3 This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon. This attack's damage isn't affected by Weakness.
4 This attack does 10 damage for each damage counter on this Pokémon.
1 This attack does 10 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
2 This attack does 10 less damage for each damage counter on this Pokémon.
2 This attack does 10 more damage for each Ancient card in your discard pile.
1 This attack does 10 more damage for each damage counter on all of your opponent's Pokémon.
6 This attack does 10 more damage for each damage counter on this Pokémon.
2 This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.
2 This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon.
3 This attack does 100 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
2 This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance.
3 This attack does 180 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
3 This attack does 20 damage for each Energy attached to your opponent's Active Pokémon.
1 This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.
2 This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.
2 This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon.
7 This attack does 20 damage for each damage counter on this Pokémon.
3 This attack does 20 damage for each damage counter on your opponent's Active Pokémon.
1 This attack does 20 damage for each of your Basic Pokémon in play.
3 This attack does 20 damage for each of your Benched Pokémon.
2 This attack does 20 damage for each of your Pokémon in play that has the Round attack.
1 This attack does 20 damage for each of your Pokémon in play.
1 This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
2 This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
5 This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).
2 This attack does 20 more damage for each Energy card in your discard pile.
3 This attack does 20 more damage for each of your Benched Pokémon.
4 This attack does 20 more damage for each of your opponent's Benched Pokémon.
1 This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon.
1 This attack does 20 more damage for each {M} Energy attached to this Pokémon.
2 This attack does 30 damage for each Basic Energy card in your opponent's discard pile.
5 This attack does 30 damage for each Energy attached to this Pokémon.
2 This attack does 30 damage for each Item card in your opponent's discard pile.
5 This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon.
1 This attack does 30 damage for each card in your opponent's hand.
2 This attack does 30 damage for each of your Ancient Pokémon in play.
2 This attack does 30 damage for each of your Team Rocket's Pokémon in play.
2 This attack does 30 damage for each of your opponent's Benched Pokémon.
2 This attack does 30 damage for each of your {G} Pokémon in play.
1 This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.
1 This attack does 30 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
2 This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
2 This attack does 30 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.
8 This attack does 30 more damage for each Energy attached to both Active Pokémon.
4 This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.
3 This attack does 30 more damage for each Prize card your opponent has taken.
2 This attack does 30 more damage for each damage counter on your opponent's Active Pokémon.
1 This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.
4 This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.
1 This attack does 40 damage for each Basic Energy attached to this Pokémon.
1 This attack does 40 damage for each Energy attached to all of your opponent's Pokémon.
3 This attack does 40 damage for each Energy attached to this Pokémon.
2 This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent's).
1 This attack does 40 damage for each Special Energy attached to all of your opponent's Pokémon.
2 This attack does 40 damage for each of your Pokémon in play that has the Round attack.
1 This attack does 40 damage for each of your Stage 1 Pokémon in play.
1 This attack does 40 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
2 This attack does 40 more damage for each Energy attached to your opponent's Active Pokémon.
2 This attack does 40 more damage for each Stage 2 Pokémon on your Bench.
2 This attack does 40 more damage for each damage counter on your opponent's Active Pokémon.
2 This attack does 40 more damage for each of your Evolution Pokémon in play.
2 This attack does 40 more damage for each {D} Energy attached to this Pokémon.
1 This attack does 40 more damage for each {L} Energy attached to this Pokémon.
1 This attack does 50 damage for each Energy attached to this Pokémon.
2 This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack does 50 damage for each of your Pokémon that has any damage counters on it.
1 This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.
3 This attack does 50 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
3 This attack does 50 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
6 This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.
1 This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
3 This attack does 50 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 This attack does 50 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.
2 This attack does 50 more damage for each Energy attached to this Pokémon.
1 This attack does 50 more damage for each Energy attached to your opponent's Active Pokémon.
4 This attack does 50 more damage for each Prize card your opponent has taken. Discard an Energy from this Pokémon.
4 This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself.
1 This attack does 50 more damage for each damage counter on your opponent's Active Pokémon.
5 This attack does 50 more damage for each {W} Energy attached to this Pokémon.
2 This attack does 60 damage for each Energy attached to all of your opponent's Pokémon.
5 This attack does 60 damage for each Prize card your opponent has taken.
1 This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play.
2 This attack does 60 damage for each of your opponent's Pokémon ex in play.
2 This attack does 60 damage for each {R} Energy attached to all of your opponent's Pokémon.
1 This attack does 60 damage to 1 of your opponent's Benched Pokémon ex or Benched Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)
2 This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.
2 This attack does 60 more damage for each Ethan's Adventure card in your discard pile.
2 This attack does 70 damage for each Special Energy card attached to this Pokémon.
2 This attack does 70 damage for each of your Pokémon in play that has the Round attack.
2 This attack does 70 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.
2 This attack does 70 more damage for each damage counter on this Pokémon.
1 This attack does 80 more damage for each of your Benched Charjabug.
1 This attack does 80 more damage for each {R} Energy attached to this Pokémon.
1 This attack does 90 more damage for each Energy attached to your opponent's Active Pokémon.
9 This attack's damage isn't affected by Resistance.
8 This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon.
2 This attack's damage isn't affected by Weakness or Resistance.
15 This attack's damage isn't affected by any effects on your opponent's Active Pokémon.
1 Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)
1 You can use this attack only if this Pokémon used Rollout during your last turn.
1 You can use this attack only if you go second, and only during your first turn. Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.
2 You can use this attack only if you go second, and only during your first turn. Your opponent can't play any Supporter cards from their hand during their next turn.
4 You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.
2 You may discard a Stadium in play.
2 You may discard a Stadium in play. If you do, this attack does 140 more damage.
6 You may discard any amount of Basic Energy from your Pokémon. This attack does 70 damage for each card you discarded in this way.
2 You may discard up to 2 Basic Energy from your Benched Pokémon. This attack does 90 more damage for each card you discarded in this way.
6 You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.
1 You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage.
1 You may do 100 more damage. If you do, during your next turn, this Pokémon can't attack.
1 You may do 120 more damage. If you do, shuffle this Pokémon and all attached cards into your deck.
2 You may do 120 more damage. If you do, this Pokémon also does 50 damage to itself.
1 You may do 30 more damage. If you do, this Pokémon also does 30 damage to itself.
2 You may draw 5 cards.
10 You may draw cards until you have 6 cards in your hand.
3 You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.
1 You may move any amount of Energy from your Pokémon to your other Pokémon in any way you like.
1 You may move any amount of {M} Energy from your Pokémon to your other Pokémon in any way you like.
1 You may move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon.
2 You may put 2 Energy attached to your opponent's Active Pokémon into their hand.
1 You may put 2 Energy attached to your opponent's Active Stage 2 Pokémon into their hand.
1 You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage.
1 You may put an Energy attached to your opponent's Active Pokémon into their hand.
4 You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)
3 You may search your deck for a card and put it into your hand. Then, shuffle your deck.
1 You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.
2 You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck.
1 You may search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.
3 You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.
5 You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)
1 You may shuffle this Pokémon and all attached cards into your deck.
2 You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)
3 You may switch this Pokémon with 1 of your Benched Pokémon.
2 You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)
1 Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.
4 Your opponent discards 2 cards from their hand.
2 Your opponent discards a card from their hand.
1 Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.
1 Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.
1 Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.
7 Your opponent reveals their hand.
2 Your opponent reveals their hand. Discard a card you find there.
1 Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.
2 Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench.
3 Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.
1 Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.
15 Your opponent's Active Pokémon is now Asleep.
3 Your opponent's Active Pokémon is now Burned and Confused.
2 Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.
14 Your opponent's Active Pokémon is now Burned.
2 Your opponent's Active Pokémon is now Burned. During your opponent's next turn, that Pokémon can't retreat.
1 Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.
31 Your opponent's Active Pokémon is now Confused.
2 Your opponent's Active Pokémon is now Confused. During your opponent's next turn, that Pokémon can't retreat.
1 Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.
1 Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.
14 Your opponent's Active Pokémon is now Poisoned.
1 Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 2 damage counters on that Pokémon instead of 1.
4 Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 8 damage counters on that Pokémon instead of 1.
1 Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon.
3 Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.
1 Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, the Defending Pokémon can't retreat.
`;

/** The parsed corpus: `[legal printings, printed sentence]`, one entry per DISTINCT
    sentence. Parsed on every call rather than at module load so a malformed record
    fails inside the test that reads it, with the offending line in the message. */
export function legalAttackCorpus(): readonly (readonly [number, string])[] {
  return CORPUS.split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const cut = line.indexOf(" ");
      const units = Number(line.slice(0, cut));
      const sentence = line.slice(cut + 1);
      // ⚠️ The three ways this format can rot, each its own throw: a record with no
      // space, a count that is not a positive integer, and a sentence whose own
      // edges carry whitespace (which would make the split silently lossy).
      if (cut < 1 || !Number.isInteger(units) || units < 1) {
        throw new Error(`census corpus: malformed record ${JSON.stringify(line)}`);
      }
      if (sentence.length === 0 || sentence !== sentence.trim()) {
        throw new Error(`census corpus: padded sentence ${JSON.stringify(line)}`);
      }
      return [units, sentence] as const;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕 D418 — THE READER SURFACE, DERIVED ONCE, HERE.
//
// 🛑 WHY THIS LIVES IN THIS FILE, AND THE MEASUREMENT THAT DECIDED IT. **FORTY**
// test files carry a hand-maintained `READERS` array — a literal list of
// `deriveAttack*` imports, several claiming in their own doc blocks to be *"the
// same set `censusAtHead.test.ts` uses"*. At D418's head **THIRTY-EIGHT OF THE
// FORTY WERE STALE**: twenty-five were NINE long (since D381, 2026-08-21 — 179
// commits) and thirteen were ELEVEN long (since D417, the day before). Only
// `censusAtHead.test.ts` and `precociousEvolution.test.ts` were current, and they
// are precisely the two that carry a module-surface guard.
//
// ⚠️ **THE COUNT OF STALE COPIES AND THE COUNT OF WRONG NUMBERS ARE DIFFERENT
// NUMBERS, and D418 fixed the second set.** Eight of the thirty-eight asserted a
// WHOLE-CORPUS figure through their own copy — `benchNamedBonus`, `exOnlyActive`,
// `retreatCostBonus`, `sameEnergyBonus`, `sawkRequirementSplit` (nine-long) and
// `inPlayTypeBonus`, `moreEnergyBonus`, `opponentBenchCount` (eleven-long) — and
// **ten published figures were wrong**. The truth over `legalAttackCorpus()` is
// **412 sentences / 1,364 printings resolved, residue 228 / 368**; a nine-reader
// view reads 406 / 1,347 / 234 / 385 and an eleven-reader view 411 / 1,363 / 229 /
// 369. Those eight now call the predicate below.
//
// ⚠️ **AND THE REMAINING THIRTY ARE NOT HARMLESS, WHICH IS D418's OTHER FINDING.**
// They run their stale unions over NARROWER populations, so no whole-corpus total
// is involved — but three of them assert REFUSALS that the module already
// contradicts: `stadiumDiscard.test.ts` (§1's `[4, 9]`, truly `[5, 10]`, and two
// §6 rungs), `stadiumPresence.test.ts` (two rungs) and `exactHandSize.test.ts`
// (one). All six turn on ONE sentence — *"Discard a Stadium in play. If you can't,
// this attack does nothing."*, Eternatus `sv08-141` — which is exactly what D417's
// `deriveAttackCancelRequirement` was built to claim. They are left for their own
// slices rather than swept in here.
//
// 🛑🛑 **AND THIS HAS HAPPENED BEFORE, ON THE RECORD, AND WAS DECLINED.**
// `exactHandSize.test.ts`'s own doc block describes D385 building a sentence that
// file's `READERS` array could not see, leaving a refusal rung *"green and
// false"* — and then says: *"THE NINE-READER ARRAY IS NOT A BUG AND IS NOT WIDENED
// HERE… adding a tenth reader to it would move numbers this slice has nothing to
// do with."* ⚠️ **THAT REASONING IS WHY THE DRIFT REACHED 179 COMMITS.** It is
// locally correct — widening a list DOES move a neighbouring figure — and it makes
// every individual slice the wrong place to fix it, which leaves no place at all.
// The way out is not to widen thirty-eight lists but to stop the figures depending
// on lists.
//
// ⚠️ **THE STALENESS WAS THE SYMPTOM; THE DUPLICATION WAS THE DEFECT.** D417
// diagnosed the missing GUARD and added one — to one file. A guard per copy is
// forty guards to keep, and the fortieth is the one nobody adds. So the surface is
// derived from the MODULE, once, in the non-test `src` module all 40 census files
// already import `legalAttackCorpus()` from, and the copies become callers.
//
// ⚠️⚠️ **THE KNOWN LIMIT, in `precociousEvolution.test.ts`'s own words**: it keys
// on the `deriveAttack` NAME PREFIX, which is the naming convention all twelve
// follow; *a reader added under a different name is still invisible here, and
// that limit is why this is a tripwire and not a proof.*

type Reader = (text: string) => unknown;

/** The surface, resolved ONCE on first use. ⚠️ A cache is not a loss of liveness
    here and the distinction is worth stating: a module's export set is fixed at
    load, so this is the same answer `Object.entries` would give on every call — it
    is `legalAttackCorpus()`'s 640 sentences × the callers that walk them that make
    recomputing it wasteful. The hand-kept lists this replaces were stale because
    a HUMAN had to update them, not because anything was cached. */
let SURFACE: readonly (readonly [string, Reader])[] | null = null;

function surface(): readonly (readonly [string, Reader])[] {
  if (SURFACE === null) {
    const found: [string, Reader][] = [];
    for (const [name, value] of Object.entries(effects)) {
      // ⚠️ BOTH HALVES OF THE TEST MATTER. The prefix is the naming convention (see
      // the block above for its limit); the `typeof` keeps a non-function export
      // that happens to be named `deriveAttack…` from being called as one.
      if (name.startsWith("deriveAttack") && typeof value === "function") {
        found.push([name, value as unknown as Reader]);
      }
    }
    found.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    SURFACE = found;
  }
  return SURFACE;
}

/** The `deriveAttack`-prefixed reader surface, taken from the MODULE rather than
    from a list, sorted by name. See the block above for the prefix limit. */
export function attackReaderSurface(): readonly string[] {
  return surface().map(([name]) => name);
}

/** "Does any LIVE reader claim this sentence whole?" — the census's resolution
    predicate, run off the module surface so it can never fall behind the way a
    hand-kept list can.

    ⚠️ The readers are held as FUNCTIONS rather than looked up by name at call
    time. A name lookup that missed would yield `undefined`, and `undefined !== null`
    is TRUE — so a typo'd or renamed reader would make this predicate claim EVERY
    sentence and every census figure in the repo would move at once, upward, with
    nothing naming the cause. There is no lookup to miss. */
export function resolvedByAnyReader(text: string): boolean {
  return surface().some(([, read]) => read(text) !== null);
}
