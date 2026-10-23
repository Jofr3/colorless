/** Expand `{ id: count }` into a flat deck list. */
export function deckOf(counts: Record<string, number>): string[] {
  const ids: string[] = [];
  for (const [id, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) ids.push(id);
  }
  return ids;
}

export const PRE_DAMAGE_TOOL_DECK = deckOf({
  "fix-toolstrip": 4,
  "sv01-096": 2,
  "fix-chestwall": 4, // {F}, 300 HP — Rock Chestplate's holder
  "fix-charmwall": 4, // Basic, 100 HP — Bravery Charm's holder
  "sv01-192": 4, // Rock Chestplate (Tool) — 30 less after W/R on an {F} holder
  "sv02-173": 4, // Bravery Charm (Tool) — +50 HP on a Basic holder
  "sv01-197": 2, // Vitality Band (Tool) — an ATTACKER-side bonus: the null-effect control
  "fix-titan": 8, // 340 HP, no attacks — filler and the no-Tool control defender
  "fix-energy": 28, // Colorless Basic — every cost on this list
});

export const PRE_DAMAGE_FAMILY_DECK = deckOf({
  "fix-preseam": 6,
  "fix-seamwall": 6, // {F}, 300 HP — wears Tool + Special Energy + Basic at once
  "sv01-192": 4, // Rock Chestplate (Tool) — 30 less after W/R on an {F} holder
  "sv01-197": 4,
  "sv01-193": 4, // Rocky Helmet (Tool) — 20 counters back on the attacker, on the DEFENDER
  "sv02-193": 2, // Therapeutic Energy (Special) — the §12 Paralysis immunity control
  "fix-mist-energy": 2, // Mist Energy (Special) — the §11 "prevent all effects" control
  "fix-titan": 4, // 340 HP, no attacks — filler and the bare defender
  "fix-energy": 28, // Colorless Basic — every cost here, and the class control
});

export const SELF_HEAL_DEALT_DECK = deckOf({
  "fix-suction": 4, // the attacker — indices 0 (50), 1 (200), 2 (no damage)
  "fix-drainwall": 4, // 300 HP, no W/R — the dealt-50 control
  "fix-drainweak": 4, // 300 HP ×2 Fire — the dealt-100 board
  "sv02-113": 3, // Hariyama — seat-wide −10 after W/R: the dealt-40 board
  "fix-imperviousshell": 3, // 340 HP, prevents ≥200 — the dealt-0 board
  "fix-wall": 4, // 120 HP, no attacks — the body a 200 Knocks Out
  "fix-titan": 12, // 340 HP neutral Basic, NO attacks — filler and clean defender
  "fix-energy": 26, // Colorless Basic — every {C} slot on this list
});

export const CROSS_SEAT_DISCARD_DECK = deckOf({
  "fix-crossseatdiscard": 4,
  "fix-bigbody": 4, // 200 HP — survives everything, so no KO tail interferes
  "fix-basic-1": 4, // a second body for the opponent's Bench
  "fix-basic-2": 4,
  "fix-special": 4,
  "fix-special-2": 4,
  "fix-fire-energy": 6,
  "fix-fire-energy-alt": 4,
  "fix-water-energy": 4,
  "fix-energy": 18,
  "sv02-191": 4, // Luminous — provides every type while it is alone
});

export const EX_ONLY_DECK = deckOf({
  "fix-exonly": 4,
  "fix-bigbody": 8,
  "fix-pokemon-v": 4,
  "fix-pokemon-vmax": 2,
  "sv06.5-036": 4,
  "fix-special": 4,
  "fix-energy": 34,
});

export const OPPONENT_TOOL_DECK = deckOf({
  "fix-oppotool": 4,
  "sv01-152": 4,
  "fix-tool": 4,
  "sv01-197": 4,
  "fix-benchfiller": 4,
  "fix-bigbody": 12,
  "fix-energy": 28,
});

export const BENCH_TYPE_DECK = deckOf({
  "fix-benchtype": 4,
  "fix-metalbody": 4,
  "fix-dualbody": 4,
  "fix-fairybody": 4,
  "fix-benchfiller": 4,
  "fix-bigbody": 12,
  "fix-energy": 28,
});

export const OPPONENT_RESISTANCE_DECK = deckOf({
  "fix-oppresist": 4,
  "fix-oppresist-f": 4,
  "fix-fightresist": 8,
  "fix-grassresist": 4,
  "fix-dualresist": 4,
  "fix-fightweak": 4,
  "fix-bigbody": 8,
  "fix-energy": 24,
});

export const SAME_ENERGY_DECK = deckOf({
  "fix-sameenergy": 4,
  "fix-sameenergy-120": 4,
  "fix-energyholder": 8,
  "fix-basic-1": 8,
  "fix-blend": 8,
  "fix-energy": 28,
});

export const MORE_ENERGY_DECK = deckOf({
  "fix-moreenergy": 4,
  "fix-energyholder": 8,
  "fix-basic-1": 8,
  "fix-blend": 8,
  "fix-energy": 32,
});

export const BENCH_ALL_DAMAGED_DECK = deckOf({
  "fix-benchall": 4,
  "fix-basic-1": 24,
  "fix-bigbody": 8,
  "fix-energy": 24,
});

export const TYPE_SHARE_DECK = deckOf({
  "fix-typeshare": 4,
  "fix-bigfairy": 8,
  "fix-fairybody": 8,
  "fix-dualbody": 8,
  "fix-water-basic": 4,
  "fix-metalbody": 4,
  "fix-benchfiller": 4,
  "fix-bigbody": 8,
  "fix-energy": 12,
});

export const EXACT_HAND_SIZE_DECK = deckOf({
  "fix-triocheehoo": 4, // Alolan Dugtrio — "Trio-Cheehoo" (120, no cost): yourHandExactly 3, the CANCEL
  "sv03-135": 4, // Absol ex — "Cursed Slug" (100+): opponentHandAtMost 3, the WRONG-SEAT near miss
  "fix-energy": 6, // Basic {C} — the ordinary attachment the organic case spends
  "fix-dark-energy": 6, // Basic {D} — pays Cursed Slug's three typed symbols
  "fix-bigbody": 40, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the clean defender, the shed
});

export const STADIUM_DISCARD_DECK = deckOf({
  "fix-blazedestruct": 4, // Hisuian Growlithe — "Blazing Destruction" (free, no damage): the bare op
  "fix-knockover": 4, // Wooloo/Dubwool — "Knock Over" (30): the same op behind "You may"
  "sv01-167": 6, // Beach Court — the Stadium, played from EITHER seat and then discarded
  "fix-energy": 8, // Basic {C} — pays Knock Over's two Colorless symbols
  "fix-bigbody": 38, // 200 HP neutral Basic, retreat 1 — starter, both Actives, the clean defender
});

export const OPTIONAL_COST_BOOST_DECK = deckOf({
  "fix-crushpress": 4, // Cetitan ex — "Crushing Press" ({W}{W}{W}{C}, 140+)
  "sv01-167": 6, // Beach Court — the NEUTRAL Stadium, played from EITHER seat
  "sv06.5-060": 6, // Neutralization Zone — the Stadium that makes the ORDER observable
  "fix-water-energy": 6, // {W}{W}{W} of Crushing Press's cost
  "fix-energy": 4, // the one {C} of it
  "fix-titan": 4, // 340 HP, no attacks, no Rule Box — the defender that survives 280
  "fix-bigbody": 30, // 200 HP neutral Basic — mulligan-free starter and bench filler
});

export const PURGING_STRIKE_DECK = deckOf({
  "fix-purging": 4, // Veluza ex — "Purging Strike" ({W}{W}{C}, 120+)
  "fix-titan": 4, // 340 HP, no attacks — the defender that survives the boosted 240
  "fix-water-energy": 6, // {W}{W} of Purging Strike's cost
  "fix-energy": 4, // the one {C} of it
  "fix-bigbody": 42, // 200 HP neutral Basic — mulligan-free starter and bench filler
});

export const HEALED_THIS_TURN_DECK = deckOf({
  "fix-lively": 4, // Maractus — "Lively Needles" ({G}, 20+): the healed-this-turn bonus
  "sv01-188": 6, // Potion — heal 30 from 1 of your Pokémon (`healChosen`)
  "sv01-184": 4, // Picnic Basket — heal 30 from EVERY Pokémon, both boards (`healEachAll`)
  "fix-grass-energy": 6, // the one {G} of Lively Needles
  "fix-bigbody": 40, // 200 HP neutral Basic — starter, bench filler, and the defender
});

export const STAGE1_BONUS_DECK = deckOf({
  "fix-spirited": 4, // Paldean Tauros — "Spirited Tackle" ({R}{C}{C}, 90+): the +90
  "fix-bigbody": 8, // 200 HP neutral BASIC — starter, bench filler, the FALSE arm, the evolve base
  "fix-stage1-big": 4, // 220 HP STAGE 1 — the TRUE arm, and it evolves from fix-bigbody
  "fix-stage2": 4, // 140 HP STAGE 2 — an Evolution that is not a Stage 1
  "fix-vstar-big": 4, // 260 HP VSTAR — an Evolution that is neither Basic, Stage 1 nor Stage 2
  "fix-fire-energy": 12, // Basic {R} — the one typed symbol of Spirited Tackle
  "fix-energy": 24, // Basic {C} — the two Colorless symbols
});

export const RETREAT_COST_BONUS_DECK = deckOf({
  "fix-aerochase": 4, // Talonflame — "Aero Chase" ({C}{C}, 110+): the +110
  "fix-retreat1-titan": 6, // 340 HP, printed {C} — FALSE bare, TRUE under either ADDITIVE term
  "fix-retreat2-titan": 6, // 340 HP, printed {C}{C} — TRUE bare (the threshold exactly), FALSE under Beach Court
  "sv02-175": 4, // Calamitous Wasteland — the Stadium term (+1 on Basic non-{F})
  "sv01-019": 4, // Spidops ex — the AURA term (+1 across the table, from the Bench)
  "sv01-167": 4, // Beach Court — the SUBTRACTIVE term (-1 on Basic), the mirror
  "fix-energy": 12, // Basic {C} — the two Colorless symbols of Aero Chase
  "fix-titan": 20, // 340 HP neutral Basic, NO attacks — DOMINANT starter and bench filler
});

export const OPPONENT_BENCH_COUNT_DECK = deckOf({
  "fix-deletingslash": 4, // Iron Crown — "Deleting Slash" ({M}{C}, 40+): the +80
  "fix-benchfiller": 12, // 60 HP — the countable body, enough for a full Bench on both seats
  "fix-bigbody": 8, // 200 HP — survives the boosted 120, so no KO tail interferes
  "fix-metal-energy": 8, // Basic {M} — the first symbol of Deleting Slash
  "fix-energy": 28, // Basic {C} — the second
});

export const IN_PLAY_BODIES_DECK = deckOf({
  "fix-inplaybodies": 4, // the EIGHT-attack holder: any / Basic / TR's / {G} / Evolution / Round / their ex / their ex+V
  "fix-grass-stage1": 4, // Grass AND Evolution — the body two filters share
  "fix-stage1": 4, // Colorless Evolution — the Evolution that is not Grass
  "fix-grass-basic": 4, // Grass Basic — the Grass that is not an Evolution
  "fix-benchfiller": 4, // Colorless Basic — matches only `anyPokemon` / `basicPokemon`, and carries NO attacks
  "fix-tr-stage1": 4, // "Team Rocket's Persian" — the second prefixed body
  "fix-titan": 8,
  "fix-roundbody": 4, // attack NAMED "Round" — the `attackNamePokemon` positive
  "fix-attacker-ex": 4, // "Fixmon ex" — the suffix positive AND the has-attacks near-miss
  "fix-pokemon-v": 4, // "Fixmon V" — in for the pair, out for the bare ex
  "fix-pokemon-vmax": 4,
  "fix-stage2body": 4, // Stage 2 AND an Evolution — the ordinal that is not `evolutionPokemon`
  "fix-energy": 8, // Basic {C} — the one printed symbol of all nine attacks
});

export const BENCH_NOUN_DECK = deckOf({
  "fix-benchnoun": 4, // the attacker — two attacks, one per counting axis
  "fix-fighting-1": 4, // {F} Basic — the counter filter's positive
  "fix-benchfiller": 4, // Colorless Basic, no attacks — the counter filter's negative
  "fix-charjabug": 4, // "Charjabug", a STAGE 1 — the `byName` positive
  "fix-duskull": 4, // "Duskull", a BASIC — the `byName` negative
  "fix-stage1": 4, // Colorless Evolution — the Evolution that is NOT a Charjabug
  "fix-titan": 8, // 340 HP, no attacks — the opener and the defender
  "fix-energy": 28, // Basic {C} — the one printed symbol of both attacks
});

export const DISCARD_PILE_COUNT_DECK = deckOf({
  "fix-discardpile": 4, // the four-attack holder: your Energy / your Ethan's Adventure / their Basic Energy / their Items
  "fix-titan": 12, // 340 HP, no attacks — the defender, the only opener, and the pile's non-card-class control
  "fix-energy": 10, // Basic {C} Energy — the printed cost, and `anyEnergy` + `basicEnergy` in the pile
  "fix-fire-energy": 8, // Basic {R} Energy — the UNTYPED-`basicEnergy` control
  "fix-special": 8, // SPECIAL Energy — `anyEnergy` YES, `basicEnergy` NO (the printed word "Basic")
  "fix-item": 8, // Item Trainer — `item` YES, and NOT a Pokémon Tool
  "fix-ethansadv": 5, // the Supporter NAMED "Ethan's Adventure" — `byName` YES
  "fix-ethansadventure": 5, // a Supporter named otherwise — `byName` NO, `supporter` YES
});

export const PILE_ATTACK_NAME_DECK = deckOf({
  "fix-pilewings": 4, // the holder of the one printed sentence
  "fix-wingsbody": 12, // attack NAMED "United Wings" — the positive, in both piles and in play
  "fix-roundbody": 8, // attack NAMED "Round" — the NAME near-miss
  "fix-attacker-ex": 6, // has attacks, none of them named — the `attacksOf().length > 0` control
  "fix-benchfiller": 6, // a Pokémon with NO attacks — the other negative
  "fix-item": 6, // an Item Trainer — `attacksOf` is null, and the pile-LENGTH control
  "fix-titan": 10, // 340 HP, no attacks — the defender, the opener, the third negative
  "fix-energy": 8, // Basic {C} — the one printed symbol of the one attack
});

export const PILE_NAME_FRAGMENT_DECK = deckOf({
  "fix-pilerocket": 4, // the holder of the one printed sentence
  "fix-trsupporter": 14, // Supporter, fragment at offset 0 — the positive, in BOTH piles
  "fix-trgrunt": 8, // Supporter, fragment at a NON-ZERO offset — the `startsWith` control
  "fix-trtransceiver": 8, // an ITEM carrying the fragment — the HEAD-NOUN control
  "fix-ethansadventure": 8, // a Supporter carrying NO fragment — the FRAGMENT control
  "fix-titan": 10, // 340 HP, no attacks — the defender, the opener, the non-card-class control
  "fix-energy": 8, // Basic {C} — the one printed symbol of the one attack
});

export const IN_PLAY_NAME_FRAGMENT_DECK = deckOf({
  "fix-inplaynames": 4, // the holder of the one printed sentence — NEITHER fragment
  "fix-weezingwall": 8, // 340 HP "Weezing" — the defender's Active, the ACTIVE and PREFIX axes
  "fix-galarweezing": 14, // "Galarian Weezing" — the fragment at a NON-ZERO offset
  "fix-darkkoffing": 8, // "Dark Koffing" — the OTHER printed fragment
  "fix-benchfiller": 8, // a Pokémon carrying NEITHER fragment — the filter control
  "fix-titan": 8, // 340 HP, no attacks — the ZERO board's defending Active and the opener
  "fix-energy": 6, // Basic {C} — the one printed symbol of the one attack
  "fix-weezingcanister": 4, // an ITEM carrying a fragment — in the deck, never in play
});

export const IN_PLAY_TYPE_DECK = deckOf({
  "fix-shortcircuit": 4, // Electivire — "Short-Circuit Knuckle" ({C}{C}, 40+): the +120
  "fix-waterbody": 8, // 60 HP Water — the body the clause reads, on EITHER seat
  "fix-inplaydual": 4, // ["Fire","Water"] — Water at index 1, the `.includes` board
  "fix-fairybody": 4, // 60 HP Fairy — a real type that is not Water, the FALSE case
  "fix-bigbody": 8, // 200 HP Colorless — survives the boosted 160, and arms nothing
  "fix-lightning-energy": 4, // Basic {L} — the two Lightning symbols of the control
  "fix-energy": 28, // Basic {C} — the printed cost of "Short-Circuit Knuckle"
});

export const TYPED_ENERGY_THRESHOLD_DECK = deckOf({
  "fix-frozenwood": 4, // Abomasnow — "Frozen Wood" ({W}{W}{W}{C}, 120+) at index 1: the +120
  "fix-titan": 20, // 340 HP, no attacks — survives the boosted 240, and the only Basic
  "fix-water-energy": 12, // Basic {W} — the three typed symbols of the printed cost
  "fix-grass-energy": 12, // Basic {G} — the type the clause counts
  "fix-grassdouble": 4, // Special {G}{G} — ONE card, TWO units: the cards-vs-units board
  "fix-energy": 8, // Basic {C} — the printed Colorless symbol, and a NON-Grass filler
});

export const EXTRA_ENERGY_DECK = deckOf({
  "fix-powerpress": 4, // {P}{C}, cost 2 — the +80 sentence at Jellicent ex's recorded cost
  "fix-highvoltage": 4, // {L}{L}{C}, cost 3 — the +100 sentence at Electivire ex's recorded cost
  "fix-extraprobe": 4, // {C}{C} — the all-Colorless PROBE, for the cards-vs-units boards
  "fix-titan": 12, // 340 HP, no attacks — survives the boosted 120, and arms nothing
  "fix-grassdouble": 4, // Special {G}{G} — ONE card, TWO units: the cards-vs-units board
  "fix-psychic-energy": 8, // Basic {P} — the typed symbol of "Power Press"
  "fix-lightning-energy": 8, // Basic {L} — the two typed symbols of "High-Voltage Press"
  "fix-energy": 12, // Basic {C} — every Colorless slot, and the untyped filler
  "sv03-192": 2, // Pokémon League Headquarters — the STADIUM surcharge, Basics only
  "sv03-052": 2, // Seismitoad "Quaking Zone" — the stage-agnostic opposing surcharge
});

export const BENCH_NAME_SUBSTRING_DECK = deckOf({
  "fix-loveimpact": 3, // TR Nidoqueen — "Love Impact" ({D}, 60+) at index 0: the +120
  "fix-trnidoking": 4, // "Team Rocket's Nidoking ex" — CONTAINS the fragment, does not equal it
  "fix-nidoking": 4, // "Nidoking" — the name the two readings AGREE on
  "fix-benchfiller": 4, // no name of consequence — the FALSE case under every reading
  "fix-titan": 25, // 340 HP, no attacks — survives the boosted 180, and the dominant starter
  "fix-dark-energy": 12, // Basic {D} — the printed cost of both attacks
  "fix-energy": 8, // Basic {C} — a non-Darkness filler that pays nothing here
});

export const DECK_SIZE_BONUS_DECK = deckOf({
  "fix-counterturn": 4, // Rabsca — "Counterturn" ({G}, 40+) at index 1: the +200
  "fix-titan": 36, // 340 HP, no attacks — survives the boosted 240, and the dominant starter
  "fix-grass-energy": 20, // Basic {G} — "Counterturn"'s printed cost, and any Energy pays "Triple Draw"'s {C}
});

export const CONDITIONAL_BENCH_SNIPE_DECK = deckOf({
  "fix-hazardousgreed": 4, // Wo-Chien — "Hazardous Greed" ({G}{C}, 20) at index 0: the gated 120 × 2
  "fix-titan": 36, // 340 HP, no attacks — the Defender, every bench body, and the dominant starter
  "fix-grass-energy": 20, // Basic {G} — pays both printed costs, and any Energy pays a {C}
});

export const FILTERED_BENCH_SNIPE_DECK = deckOf({
  "fix-filteredsnipe": 4,
  "fix-titan": 24, // 340 HP, no attacks — the Defender, every ordinary bench body, the starter
  "fix-teaparty": 4,
  "fix-drainwall": 4,
  "fix-drainweak": 4,
  "fix-energy": 20, // Basic {C} — pays all three printed {C} costs
});

export const BENCH_NAMED_DAMAGED_DECK = deckOf({
  "fix-bonevengeance": 4, // Marowak — "Bone Vengeance" ({C}{C}, 60+) at index 1: the +120
  "fix-cubone": 4, // "Cubone" — the name the clause carries, and the attacker's pre-evolution
  "fix-benchfiller": 4, // no name of consequence — the FALSE case however damaged it is
  "fix-titan": 24, // 340 HP, no attacks — survives the boosted 180, and the dominant starter
  "fix-energy": 16, // Basic {C} — "Bone Vengeance"'s printed {C}{C}
  "fix-fighting-energy": 8, // Basic {F} — "Growl"'s printed cost, so the control attack is payable
});

export const EVOLVED_FROM_DECK = deckOf({
  "fix-strikeitrich": 4, // Gholdengo — "Strike It Rich" ({M}, 30+) at index 0: the +90
  "fix-gimmighoul": 4, // "Gimmighoul" — the card Gholdengo's clause names
  "fix-abruptflash": 4, // Misty's Starmie — "Abrupt Flash" ({W}, 60+) at index 0: the +80
  "fix-mistystaryu": 4, // "Misty's Staryu" — the card Misty's Starmie's clause names
  "fix-titan": 20, // 340 HP, no attacks — survives the boosted 120, and the dominant starter
  "fix-metal-energy": 12, // Basic {M} — "Strike It Rich"'s printed cost
  "fix-water-energy": 12, // Basic {W} — "Abrupt Flash"'s printed cost
});

export const USED_ATTACK_DECK = deckOf({
  "fix-alloutattack": 4, // Falinks — "Form Ranks" (idx 0) then "All-Out Attack" (30+): the +90
  "fix-crazyblast": 4, // Weezing — "Pervasive Gas" (idx 0) then "Crazy Blast" (50+): the +120
  "fix-titan": 16, // 340 HP, no attacks — survives the boosted 170, and the dominant starter
  "fix-basic-1": 8, // plain Basics for "Form Ranks" to find, and legal openings
  "fix-victim": 4, // 30 HP — OHKO'd by "Pervasive Gas"'s printed 30, so a KO can PARK
  "fix-dark-energy": 12, // Basic {D} — pays "Pervasive Gas" and half of "Crazy Blast"
  "fix-energy": 12, // Basic {C} — pays both Falinks costs and "Crazy Blast"'s {C}
});

export const STADIUM_PRESENCE_DECK = deckOf({
  "fix-mountaindrop": 4, // Probopass — "Mountain Drop" (70+): stadiumInPlay, +70
  "fix-assaultland": 4, // Fan Rotom — "Assault Landing" (70): stadiumInPlay, the CANCEL
  "sv02-096": 4, // Palossand — "Earthen Power" (80+): the OWNERSHIP reading, the near miss
  "sv01-167": 4, // Beach Court — the Stadium, played from EITHER seat
  "fix-psychic-energy": 6, // Basic {P} — pays Earthen Power's typed slot
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 30, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the clean defender
});

export const CROSS_BOARD_STATUS_DECK = deckOf({
  "fix-charbreath": 4, // Centiskorch — "Singe" (the Burn source) + "Charring Breath" (the cancel)
  "fix-roastheat": 4, // Slugma — "Roasting Heat" (10+): opponentActiveBurned, +40
  "fix-mindcrush": 4, // Tapu Lele — "Perplex" (the Confusion source) + "Mental Crush" (90+), +90
  "fix-fire-energy": 8, // Basic {R} — pays Singe, Charring Breath and Roasting Heat
  "fix-psychic-energy": 6, // Basic {P} — pays Mental Crush's typed slot
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 26, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the clean defender
});

export const BASIC_ENERGY_DISCARD_DECK = deckOf({
  "fix-emberpillar": 4,
  "fix-bigbody": 4,
  "fix-basic-1": 8,
  "fix-fire-energy": 18,
  "fix-fire-energy-alt": 6,
  "fix-water-energy": 6,
  "sv02-191": 4, // Luminous — provides every type IN PLAY, and nothing at all in a pile
  "fix-special": 4,
  "fix-energy": 6,
});

export const TR_ENERGY_DECK = deckOf({
  "fix-trbonus": 4,
  "fix-tr-energy": 8,
  "fix-tr-other-energy": 8,
  "fix-not-tr-energy": 8,
  "fix-special": 4,
  "fix-basic-1": 8,
  "fix-bigbody": 8,
  "fix-energy": 12,
});

export const SAWK_SPLIT_DECK = deckOf({
  "fix-sawk": 4,
  "fix-bigbody": 8,
  "fix-pokemon-v": 4,
  "sv06.5-036": 4,
  "fix-fighting-energy": 8,
  "fix-energy": 32,
});

export const REQUIREMENT_FLOOR_DECK = deckOf({
  "fix-ironboulder": 3,
  "fix-cramorant": 3,
  "fix-mesprit": 3,
  "fix-uxie": 2,
  "fix-azelf": 2,
  "fix-lakebystander": 3,
  "fix-bigbody": 8,
  "fix-psychic-energy": 12,
  "fix-energy": 24,
});

export const BENCH_COUNT_DECK = deckOf({
  "fix-victini": 3,
  "fix-benchfiller": 8,
  "fix-bigbody": 8,
  "fix-fire-energy": 12,
  "fix-energy": 29,
});

export const BENCH_NAMED_DECK = deckOf({
  "fix-durant": 3,
  "fix-mightyena": 3,
  "fix-illumise": 3,
  "fix-beldum": 3,
  "fix-metang": 3,
  "fix-benchfiller": 4,
  "fix-bigbody": 8,
  "fix-stage1": 2,
  "fix-stage2": 2,
  "fix-dark-energy": 12,
  "fix-energy": 17,
});

export const ALL_BASIC_DECK = deckOf({ "fix-basic-1": 60 });

/** One Basic in 60 — mulligans are near-certain, used with searched seeds. */
export const ONE_BASIC_DECK = deckOf({ "fix-basic-1": 1, "fix-energy": 59 });

export const MIXED_DECK = deckOf({
  "fix-basic-0": 8,
  "fix-basic-1": 20,
  "fix-basic-2": 8,
  "fix-stage1": 4,
  "fix-energy": 16,
  "fix-item": 4,
});

export const EVOLVE_DECK = deckOf({
  "fix-basic-1": 24,
  "fix-stage1": 12,
  "fix-stage2": 8,
  "fix-energy": 16,
});

export const TRAINER_DECK = deckOf({
  "fix-basic-1": 20,
  "sv01-189": 2,
  "sv01-181": 2,
  "sv02-172": 2,
  "sv01-194": 2,
  "sv01-188": 2,
  "sv01-172": 2,
  "fix-water-energy": 20,
  "fix-energy": 8,
});

export const STADIUM_TOOL_DECK = deckOf({
  "fix-attacker": 12,
  "fix-basic-1": 8,
  "fix-stage1": 4,
  "fix-victim": 2,
  "fix-weak": 2,
  "fix-wall": 2,
  "sv01-167": 3,
  "sv03-192": 3,
  "sv01-197": 3,
  "sv02-173": 3,
  "fix-stadium": 1,
  "fix-tool": 1,
  "fix-energy": 16,
});

export const STADIUM_ABILITY_DECK = deckOf({
  "fix-bigbody": 30,
  "sv02-171": 3, // Artazon
  "sv01-178": 3, // Mesagoza
  "sv03-196": 3, // Town Store
  "sv01-167": 3, // Beach Court — a CONTINUOUS-only Stadium (no activated ability)
  "fix-basic-0": 3, // no-Rule-Box Basic — Artazon takes it
  "sv02-061": 3, // Chien-Pao ex — a Basic WITH a Rule Box — Artazon drops it
  "fix-tool": 6, // a Pokémon Tool — Town Store takes it
  "fix-energy": 6,
});

export const DEFIANCE_DECK = deckOf({
  "fix-attacker": 30,
  "fix-wall": 4,
  "fix-weak": 4,
  "sv01-169": 6,
  "fix-energy": 16,
});

export const CHOICE_DECK = deckOf({
  "fix-attacker": 28,
  "fix-pokemon-v": 4,
  "fix-pokemon-v-weak": 2,
  "fix-pokemon-vmax": 2,
  "fix-wall": 2,
  "sv02-176": 6,
  "fix-energy": 16,
});

export const PRIZE_DECK = deckOf({
  "fix-attacker": 32,
  "fix-pokemon-v": 4,
  "fix-pokemon-vmax": 4,
  "fix-victim": 4,
  "fix-energy": 16,
});

export const KNOCKOUT_DECK = deckOf({
  "fix-sniper": 10,
  "fix-victim": 8,
  "fix-weak": 4,
  "fix-wall": 2,
  "fix-basic-1": 8,
  "fix-stage1": 4,
  "sv02-173": 4,
  "sv03-174": 2, // Bouffalant — passive "Bouffer" reduces spread on the bench too
  "fix-energy": 18,
});

export const SPECIAL_ENERGY_DECK = deckOf({
  "fix-attacker": 8,
  "fix-basic-1": 12,
  "fix-victim": 4,
  "sv02-190": 6,
  "sv02-191": 6,
  "fix-special": 2,
  "fix-fire-energy": 6,
  "fix-energy": 16,
});

export const TRIGGER_DECK = deckOf({
  "fix-basic-1": 16,
  "sv02-170": 6,
  "sv01-023": 3,
  "sv02-123": 3,
  "sv03-012": 3,
  "fix-victim": 4,
  "sv03-174": 2, // Bouffalant — "Bouffer" reduces ATTACK damage only, NOT counters
  "fix-energy": 23,
});

export const RARE_CANDY_DECK = deckOf({
  "fix-basic-1": 16,
  "fix-basic-2": 2,
  "fix-stage1": 4,
  "fix-stage2": 6,
  "fix-stage2-frail": 2,
  "sv01-191": 4,
  "sv02-173": 2, // Bravery Charm — the evolve-below-HP mid-turn KO tool
  "fix-energy": 24,
});

export const SNIPE_DECK = deckOf({
  "fix-basic-1": 14,
  "sv01-118": 6,
  "sv02-015": 4,
  "swsh10.5-018": 2,
  "fix-victim": 6,
  "fix-grass-energy": 6,
  "fix-water-energy": 4,
  "fix-energy": 18,
});

export const ONKO_DECK = deckOf({
  "fix-attacker": 8,
  "sv02-126": 4,
  "fix-onko": 4,
  "fix-basic-1": 12,
  "fix-victim": 4,
  "fix-energy": 28,
});

export const ATTACH_DECK = deckOf({
  "sv01-054": 3,
  "sv02-060": 3,
  "fix-attacher": 3,
  "fix-basic-1": 12,
  "fix-water-energy": 20,
  "fix-fire-energy": 6,
  "fix-energy": 13,
});

export const GARDEVOIR_DECK = deckOf({
  "sv01-086": 3,
  "fix-psychic-1": 8,
  "fix-basic-1": 8,
  "fix-psychic-energy": 20,
  "fix-energy": 21,
});

export const KORAIDON_DECK = deckOf({
  "sv01-125": 3,
  "fix-fighting-1": 6,
  "fix-fighting-evo": 2,
  "fix-basic-1": 6,
  "fix-fighting-energy": 20,
  "fix-energy": 23,
});

export const DISCARD_RETRIEVAL_DECK = deckOf({
  "fix-basic-1": 12,
  "sv01-171": 3,
  "sv01-182": 3,
  "sv02-188": 3,
  "sv01-189": 4,
  "fix-item": 2,
  "fix-fire-energy": 8,
  "fix-water-energy": 8,
  "fix-energy": 17,
});

export const LOOK_AT_TOP_DECK = deckOf({
  "fix-basic-1": 16,
  "fix-basic-2": 4,
  "sv02-183": 3,
  "sv01-186": 3,
  "sv01-189": 4,
  "fix-item": 2,
  "fix-energy": 28,
});

export const MOVE_ENERGY_DECK = deckOf({
  "fix-basic-1": 12,
  "fix-basic-2": 4,
  "sv01-173": 3,
  "sv03-193": 3,
  "fix-energy": 20,
  "fix-fire-energy": 6,
  "fix-water-energy": 6,
  "fix-special": 6,
});

export const HAND_REFRESH_DECK = deckOf({
  "fix-basic-1": 8,
  "sv01-198": 3, // Youngster
  "sv01-176": 3, // Judge
  "sv03-187": 3, // Brassius
  "sv01-177": 3, // Katy
  "sv02-185": 3, // Iono
  "fix-energy": 37,
});

export const BOARD_CONDITION_DECK = deckOf({
  "fix-basic-1": 8,
  "sv02-181": 3, // Fighting Au Lait
  "sv02-180": 3, // Falkner
  "sv02-184": 3, // Grusha
  "sv01-167": 3, // Beach Court (Stadium)
  "fix-condgate": 3, // FIXTURE — a parking op inside each gate arm
  "fix-gateorder": 3, // FIXTURE — gate timing, splice order, surviving tail
  "fix-gatedsup": 3, // FIXTURE — a gated Supporter (the §7.2 allowance ordering)
  "fix-energy": 31,
});

export const DISCARD_ENERGY_DECK = deckOf({
  "fix-basic-1": 6,
  "fix-basic-2": 4, // distinct bench bodies, so the opponent's board can hold several
  "sv01-168": 3, // Crushing Hammer
  "sv02-182": 3, // Giacomo
  "sv03-143": 4, // Mawile — Special Eater
  "fix-hammer": 3, // FIXTURE — the opponentChosen arm, no coin gate
  "fix-special": 6,
  "fix-special-2": 6,
  "fix-energy": 25,
});

export const ATTACK_PARK_DECK = deckOf({
  "sv02-028": 4, // Paldean Tauros — Blaze Dash
  "sv01-039": 4, // Charcadet — Ember
  "fix-alldiscard": 3,
  "fix-victim": 3, // 30 HP — OHKO'd, so the epilogue's KO sweep runs
  "fix-bigbody": 5, // 200 HP — survives, so the plain turn-end tail runs
  "fix-basic-1": 3,
  "fix-fire-energy": 14, // pays Blaze Dash's {R}{R} and Ember's {R}
  "fix-fire-energy-alt": 4, // a second Fire print — same type, different id
  "fix-special": 3, // a Special Energy, so the two identity spaces can be split
  "fix-energy": 17, // a DIFFERENT print, so a mixed attach is a real choice
});

export const SELF_DAMAGE_DECK = deckOf({
  "sv01-038": 4, // Skeledirge — Blazing Shout (190 + 30 self)
  "fix-victim": 4, // 30 HP — OHKO'd by the 190
  "fix-bigbody": 4, // 200 HP — survives the 190, isolating a self-KO
  "fix-basic-1": 20, // Basics for setup + the bench bodies a KO promotes
  "fix-fire-energy": 20, // pays Blazing Shout's {R}{R}
  "fix-energy": 8, // Colorless for the {C}
});

export const SCALED_DAMAGE_DECK = deckOf({
  "fix-attacker": 4, // Rage (index 3, base 10) — the default scaling attacker
  "sv02-028": 4, // Paldean Tauros — Raging Horns (index 0, base 20)
  "sv03-125": 4, // Charizard ex — Burning Darkness (opponentPrizesTaken, base 180); 330 HP mirror wall
  "sv03-030": 4,
  "sv01-068": 4,
  "fix-wall": 4, // 120 HP — survives the self-counter attackers' hits here
  "fix-weak": 4, // 60 HP, ×2 Fire — the scaling × weakness defender
  "fix-bigbody": 4, // 200 HP, no Weakness — survives Entei's fold and Pachirisu's base 10
  "fix-basic-1": 10, // Basics for setup + the bench bodies a KO promotes
  "fix-fire-energy": 10, // pays every {C}/{R}/{F} cost here; ≥3 for Entei's {C}{C}{C}
  "fix-lightning-energy": 8, // Pachirisu's {L}{C} — Fire cannot pay the {L}; 8 so no seed strands it
});

export const MULTIPLY_DAMAGE_DECK = deckOf({
  "sv06.5-039": 4, // Pecharunt ex — Irritated Outburst (opponentPrizesTaken, per 60)
  "sv01-109": 4, // Annihilape — Rage Fist (opponentPrizesTaken, per 70)
  "fix-bigbody": 4, // 200 HP — survives 60×2 / 70×2, isolating the damage math
  "fix-basic-1": 16, // Basics for setup + the bench bodies a KO promotes
  "fix-dark-energy": 16, // pays Pecharunt's {D}{D}
  "fix-fighting-energy": 16, // pays Rage Fist's {F}
});

export const BENCH_BODY_DECK = deckOf({
  "fix-benchcount": 4, // the three body-count sentences, indices 0-2 (+ an unsimulated 3)
  "fix-oppenergy": 4, // the four opponent-Energy sentences, indices 0-3
  "fix-titan": 20, // 340 HP — Bench filler on both sides AND the neutral defender
  "fix-energy": 12, // Colorless provision — pays every {C} cost, counts as untyped Energy
  "fix-fire-energy": 8, // {R} — what "Flare Scan" filters FOR
  "fix-water-energy": 8, // {W} — what "Flare Scan" must refuse
  "fix-pokemon-v-weak": 4, // 210 HP, ×2 Fire — the pre-W/R ordering witness
});

export const DAMAGE_SUPPRESSION_DECK = deckOf({
  "fix-suppressor": 4, // the four sentences at indices 0-3 + the no-effect control at 4
  "fix-azureseas": 4, // "Azure Seas" — the ability half, on an attack with NO text
  "fix-suppresswall": 4, // 300 HP, ×2 Fire, −30 after W/R (registry) — the order witness
  "fix-resistwall": 4, // 300 HP, −30 Fire, −30 after W/R (registry)
  "fix-weak-tough": 4, // 120 HP, ×2 Fire AND −30 Fire — synthetic, no catalog twin
  "sv03-030": 4, // Entei — "Pressure" (−20 BEFORE W/R, source = the opponent's Active)
  "sv01-099": 4, // Dachsbun — "Well-Baked Body" (prevents ALL damage from a {R} attacker)
  "sv02-113": 4, // Hariyama — the seat-wide −10 the clause splits rather than nulls
  "sv02-089": 4, // Spiritomb — "Fettered in Misfortune", the §9 gate on the ability half
  "fix-bigbody": 4, // 200 HP, no modifiers — the neutral Active a benched Hariyama shields
  "sv06.5-060": 4, // Neutralization Zone — the OFF-TARGET rule the clause must NOT reach
  "fix-basic-1": 8, // setup Actives + the bodies a KO promotes
  "fix-fire-energy": 8, // pays every {C} cost in the suite
});

export const SELF_ENERGY_DECK = deckOf({
  "fix-selfenergy": 4,
  "fix-special": 4,
  "fix-bothactives": 4, // bothActivesEnergyCount — index 0, plus two printed refusals
  "fix-oppenergy": 2,
  "fix-benchcount": 2,
  "fix-titan": 12, // 340 HP — the neutral defender AND the Bench filler (5 a side + 1)
  "fix-pokemon-v-weak": 4, // 210 HP, ×2 Fire — the pre-W/R ordering witness
  "fix-energy": 4, // Colorless provision — the "what pays is not what counts" card
  "fix-fire-energy": 12, // {R} — what "Flare Draw" filters FOR
  "fix-water-energy": 12, // {W} — what "Flare Draw" must refuse
});

export const COVETOUS_IVY_DECK = deckOf({
  "sv02-027": 4, // Wo-Chien ex — Covetous Ivy (opponentPrizesTaken, per 60, benched)
  "fix-bramble": 4, // the per-40 benched-snipe probe (attacker)
  "fix-bigbody": 6, // 200 HP — a benched target that survives the scaled hit
  "fix-victim": 4, // 30 HP — a benched target a scaled hit KOs
  "sv03-174": 2, // Bouffalant — "Bouffer" (−20 after W/R): the benched reduction target
  "fix-basic-1": 20, // setup Actives + Bench filler so the count-1 pick is real
  "fix-grass-energy": 20, // pays Covetous Ivy's {G}{G}{C} and Bramble's {C}
});

export const ALSO_SNIPE_DECK = deckOf({
  "sv01-080": 4, // Miraidon — Lightning Laser (90 + a flat 30 benched rider)
  "sv03-076": 4, // Tadbulb — Shake and Discharge (20 + a flat 10 benched rider)
  "fix-bigbody": 32, // 200 HP — DOMINANT so BOTH setup Actives pin to it; also the survivor bench targets
  "fix-victim": 4, // 30 HP — the benched body the rider KOs
  "fix-lightning-energy": 16, // pays {L}{L}{C} / {L}{C}
});

export const ANY_SNIPE_DECK = deckOf({
  "sv01-069": 4, // Rotom — Linear Attack (opponentAny, 20, Lightning)
  "sv06.5-038": 4, // Fezandipiti ex — Cruel Arrow (opponentAny, 100, Darkness)
  "fix-lightning-weak": 30, // ×2 Lightning, 130 HP — DOMINANT pinned Active (the W/R target) + bench targets
  "fix-victim": 4, // 30 HP — the body a snipe KOs
  "sv01-197": 2, // Vitality Band — the attacker's pre-W/R +10 (an Active-snipe bonus witness)
  "fix-lightning-energy": 16, // pays Cruel Arrow's {C}{C}{C} and Linear Attack's {C}
});

export const FEINT_DECK = deckOf({
  "fix-feint": 4, // synthetic {L} Feint Attack — the ignoreWR witness (opponentAny, 50)
  "fix-lightning-weak": 34, // ×2 Lightning, 130 HP — DOMINANT pinned Active (the W/R target) + bench targets
  "sv03-174": 4, // Bouffalant — "Bouffer" (−20 after W/R): the reduction ignoreWR SKIPS
  "sv01-197": 2, // Vitality Band — the attacker's pre-W/R +10 (an Active-snipe bonus witness)
  "fix-lightning-energy": 16, // pays Feint Attack's {C}
});

export const TWIN_SNIPE_DECK = deckOf({
  "fix-twinsnipe": 4, // count-2 flat snipe (opponentAny, 50) — W/R APPLIES on the Active pick
  "fix-twinfeint": 4, // count-2 ignoreWR snipe (opponentAny, 50) — W/R nulled on BOTH picks
  "fix-lightning-weak": 32, // ×2 Lightning, 130 HP — DOMINANT pinned Active + bench targets
  "sv03-174": 4, // Bouffalant — "Bouffer" (−20 after W/R): the reduction ignoreWR SKIPS
  "fix-lightning-energy": 16, // pays both {C} costs
});

export const SCALED_SNIPE_DECK = deckOf({
  "fix-scaledsnipe": 4, // the scaled any-target snipe at 20 and 30, + two controls
  "fix-lightning-weak": 30, // ×2 Lightning, 130 HP — DOMINANT pinned Active + bench targets
  "sv01-197": 2, // Vitality Band — the attacker's pre-W/R +10 through the SCALED amount
  "fix-lightning-energy": 20, // pays the {C} cost AND is the thing being counted
  "fix-energy": 4,
});

export const COUNTER_PUT_CHOSEN_DECK = deckOf({
  "fix-counterput": 4, // the two printed word orders + the deals:true control
  "fix-lightning-weak": 30, // ×2 Lightning, 130 HP — DOMINANT pinned Active + bench targets
  "sv03-078": 4, // Bellibolt — prevents all DAMAGE from {L}, and NOT a placed counter
  "fix-unaware": 4, // prevents all EFFECTS — and a placed counter IS one
  "sv03-197": 2,
  "fix-lightning-energy": 16, // pays the {C} cost AND arms Bellibolt's {L} clause
});

export const COUNTER_FOLD_DECK = deckOf({
  "fix-counterfold": 4, // the three printed folds + the printed-damage §11 control
  "fix-bigbody": 26, // 200 HP, NO printed Ability — the filter's negative witness
  "fix-idlebody": 8, // 200 HP WITH one — the filter's positive witness, both seats
  "fix-lightning-weak": 4, // ×2 Lightning, 130 HP — the flat-placement witness
  "sv03-078": 4, // Bellibolt — prevents all DAMAGE from {L}, and NOT a placed counter
  "fix-unaware": 4, // prevents all EFFECTS — and a placed counter IS one
  "sv03-197": 2,
  "fix-lightning-energy": 8, // pays the {C} cost AND arms Bellibolt's {L} clause
});

export const COUNTER_UNTIL_HP_DECK = deckOf({
  "fix-hptarget": 4, // the three printed destinations + the printed-damage §11 control
  "fix-bigbody": 26, // 200 HP, Colorless — DOMINANT (mulligan-free) and the arithmetic body
  "fix-lightning-weak": 8, // 130 HP ×2 Lightning — the below-target floor and the flatness witness
  "sv02-173": 4, // Bravery Charm — +50 HP: `effectiveMaxHp` vs the printed `hpOf`
  "sv03-078": 4, // Bellibolt — prevents all DAMAGE from {L}, and NOT a placed counter
  "fix-unaware": 4, // prevents all EFFECTS — and a placed counter IS one
  "fix-lightning-energy": 10, // pays the {C} cost AND arms Bellibolt's {L} clause
});

export const COST_SNIPE_DECK = deckOf({
  "fix-costsnipe": 4, // "Discard 2 Energy…" + a count-2 snipe — PARKS TWICE
  "fix-allsnipe": 4, // "Discard all Energy…" + a count-3 snipe — the ZERO-park control
  "fix-bigbody": 28, // 200 HP neutral — DOMINANT (mulligan-free) + the pinned Active
  "fix-lightning-weak": 8, // ×2 Lightning, 130 HP — the Bench targets, and the KO rung's Active
  "fix-lightning-energy": 8, // Basic {L} — one of the two distinguishable prints
  "fix-energy": 8, // Basic {C} — the other, which is what makes the cost a DECISION
});

export const HAND_DRAW_DECK = deckOf({
  "fix-handdraw": 4, // "Discard your hand and draw 6 cards." — the whole sentence
  "fix-bigbody": 40, // 200 HP neutral — DOMINANT (mulligan-free), and the deck's bulk
  "fix-item": 8, // a plain Item — hand bulk with no program of its own to interfere
  "fix-energy": 8, // Basic {C} — pays the printed cost
});

export const TOOL_COUNT_DECK = deckOf({
  "fix-toolscaler": 4, // "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."
  "fix-tool": 12, // the unauthored Tool — the resource this whole suite counts
  "fix-bigbody": 36, // 200 HP neutral — DOMINANT (mulligan-free), the Bench bodies and the defender
  "fix-energy": 8, // Basic {C} — pays the printed {C}, and the Energy a Tool count must ignore
});

export const BOARD_ENERGY_DECK = deckOf({
  "fix-boardgrass": 4, // "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."
  "fix-grass-energy": 16, // Basic {G} — the resource this whole suite counts
  "fix-energy": 6, // Basic {C} — pays the printed {C}, and the Energy the {G} filter must refuse
  "sv02-191": 4, // Luminous — the wildcard, and the reason the read is PROVISION
  "fix-special": 4, // the unauthored Special — {C} only, and what DEMOTES the wildcard
  "fix-bigbody": 26, // 200 HP neutral — DOMINANT (mulligan-free), the Bench bodies and the defender
});

export const SELF_ENERGY_HAND_DECK = deckOf({
  "fix-selfenergyhand": 4, // "Put an Energy attached to this Pokémon into your hand."
  "sv01-039": 2, // Charcadet "Ember" — the BARE self-discard, the caption CONTROL
  "fix-bigbody": 26, // 200 HP neutral — DOMINANT (mulligan-free), and the deck's bulk
  "fix-energy": 8, // Basic {C} — pays the printed {C} cost, and one side of the pick
  "fix-lightning-energy": 8, // Basic {L} — the second print, which makes the pick a DECISION
  "fix-special": 8, // Special {C} — the third print, and the proof the filter is `anyEnergy`
  "fix-fire-energy": 4, // Basic {R} — pays Ember's printed cost, and nothing else
});

export const BENCH_BOOST_DECK = deckOf({
  "fix-benchboost": 4, // "…up to 2 Energy from your Benched Pokémon… 60 more…" — the bare noun
  "fix-benchbasicboost": 4, // the same sentence at `basicEnergy` and 90 — the filter's other side
  "fix-psychic-resist-big": 4, // 200 HP, −30 Psychic — the ONE body where a split hit reads differently
  "fix-bigbody": 24, // 200 HP neutral — DOMINANT (mulligan-free), the Bench holders, the plain defender
  "fix-energy": 8, // Basic {C} — pays both costs, and fuel for BOTH filters
  "fix-lightning-energy": 8, // Basic {L} — the second print, which is what makes the pick a DECISION
  "fix-special": 8, // Special {C} — fuel for the bare noun, refused by the Basic one
});

export const DISCARD_SCALED_DECK = deckOf({
  "fix-allscale": 4, // "Discard all {L} Energy…" — the inline, no-park, `count: "all"` arm
  "fix-basicscale": 4, // "You may discard any amount of Basic Energy…" — the declinable arm
  "fix-bigbody": 28, // 200 HP neutral — DOMINANT (mulligan-free) + the pinned Active
  "fix-lightning-energy": 8, // Basic {L} — the ONLY fuel the typed filter takes
  "fix-energy": 8, // Basic {C} — pays both costs, Basic fuel, never {L} fuel
  "fix-special": 8, // Special {C} — pays a cost, and is fuel for NEITHER filter
});

export const HAIL_BLADE_DECK = deckOf({
  "sv02-061": 4, // Chien-Pao ex — Hail Blade (the attacker, and the ex defender)
  "fix-water-weak": 4, // ×2 Water, 200 HP — the Weakness the damage doubles into
  "fix-bigbody": 28, // 200 HP neutral — DOMINANT (mulligan-free) + the plain defender
  "fix-water-energy": 16, // pays {W}{W} and IS the discardable {W}
  "fix-energy": 8, // plain Colorless Basic Energy — never offered by the {W} filter
});

export const PSY_PURGE_DECK = deckOf({
  "swsh10.5-031": 4, // Mewtwo VSTAR — Psy Purge (attacker AND the 280 HP defender)
  "fix-psychic-weak": 4, // ×2 Psychic, 200 HP — the Weakness the damage doubles into
  "fix-bigbody": 28, // 200 HP neutral Basic — DOMINANT (mulligan-free) starting Active
  "fix-psychic-energy": 16, // pays {P}{C} and IS the discardable {P}
  "fix-energy": 8, // plain Colorless Basic Energy — never offered by the {P} filter
});

export const DAMAGE_ATTACKER_DECK = deckOf({
  "sv01-005": 4, // Cacnea — Counterattack Quills (30 recoil)
  "sv01-006": 4, // Cacturne — Counterattack Quills (same 30)
  "sv03-112": 4, // Stunfisk — Custom Trap (50 recoil, requires a Tool)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0)
  "sv01-197": 3, // Vitality Band — the inert Tool for the Custom Trap gate
  "fix-bigbody": 29, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

export const ROCKY_HELMET_DECK = deckOf({
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0)
  "sv01-193": 4, // Rocky Helmet — the recoil TOOL (2 counters = 20 HP)
  "fix-bigbody": 40, // 200 HP neutral Basic — DOMINANT setup + the holder + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

export const COUNTERATTACK_DECK = deckOf({
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "sv03-112": 4, // Stunfisk — Custom Trap (50, ONLY while a Pokémon Tool is attached)
  "sv01-005": 4, // Cacnea — Counterattack Quills (30, ungated)
  "sv01-006": 4, // Cacturne — Counterattack Quills (the same 30, 130 HP)
  "sv01-193": 4,
  "fix-bigbody": 28, // 200 HP neutral Basic — DOMINANT setup + the bare Tool holder + promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

export const CORNERSTONE_DECK = deckOf({
  "fix-cornerstone": 4, // the holder — "Cornerstone Stance" (preventDamageFromHasAbility)
  "fix-abilitybody": 4, // Ability, NO rule box — the positive, and all four read sites
  "fix-attacker-ex": 4, // an ex with NO Ability — the gate-separating negative
  "fix-attacker": 4, // neither — the flat control
  "fix-abilityv": 3, // Basic Pokémon V with an Ability — Spiritomb's lockable attacker
  "sv02-089": 3, // Spiritomb — "Fettered in Misfortune" (§9 from the BENCH)
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 as the ATTACKER)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and promote target
  "fix-energy": 10, // Colorless Basic — every cost in this deck
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const MIGHTY_SHELL_DECK = deckOf({
  "fix-mightyshell": 4, // the holder — "Mighty Shell" (preventDamageAndEffectsFromSpecialEnergy)
  "fix-shellcracker": 4, // the attacker — six attacks, all five read sites
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 as the ATTACKER)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and promote target
  "fix-special": 4, // an UNAUTHORED Special Energy — the gate's positive
  "sv02-191": 2, // Luminous Energy — an AUTHORED Special, the same positive by class
  "fix-energy": 18, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const CURIOUS_TEA_PARTY_DECK = deckOf({
  "fix-teaparty": 4, // the holder — "Curious Tea Party" (preventDamageAndEffectsWhileBenched)
  "fix-shellcracker": 4,
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 from the ATTACKING seat)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and promote target
  "fix-energy": 24, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const SPHERICAL_SHIELD_DECK = deckOf({
  "fix-spherical": 4, // the holder — "Spherical Shield" (preventBenchDamageAndEffects)
  "fix-shellcracker": 4,
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 from the ATTACKING seat)
  "sv03-070": 3, // Thundurus — "Adverse Weather" (the OTHER field on the same scan)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and the shielded teammate
  "fix-energy": 23, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const TRAINER_SHIELD_DECK = deckOf({
  "fix-unnerve": 4, // the HOLDER rule — "Unnerve" (preventTrainerEffects)
  "fix-widewall": 4, // the SEAT rule — "Wide Wall" (preventSupporterEffectsWhileActive)
  "fix-hammer": 4, // fixture ITEM — discardEnergy from:"opponentChosen", no coin gate
  "sv02-172": 4, // Boss's Orders — the SUPPORTER, gust off the opponent's Bench
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, from the seat playing the Trainer)
  "fix-titan": 5, // 340 HP, no attacks — bench filler and the UNSHIELDED teammate
  "fix-energy": 18, // Colorless Basic — the discard fodder, not a cost
  "fix-bigbody": 18, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const ATTACK_EFFECT_SHIELD_DECK = deckOf({
  "fix-unaware": 4, // the HOLDER rule — "Unaware" (preventAttackEffects)
  "fix-repellingveil": 4, // the GROUP rule — "Repelling Veil" (preventAttackEffectsForGroup)
  "fix-tr-body": 4, // "Team Rocket's Meowth" — the shielded NON-holder group member
  "fix-not-tr-body": 4, // "Rival of Team Rocket's Meowth" — the PREFIX negative
  "fix-tr-stage1": 3, // "Team Rocket's Persian" — the STAGE negative
  "fix-shellcracker": 4, // the ATTACKER — Bite (damage), Yawn + Clutch (two effect ops)
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, from the ATTACKING seat)
  "fix-energy": 14, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const SPECIAL_ENERGY_SEAM_DECK = deckOf({
  "fix-mist-energy": 4,
  "fix-enriching-energy": 4,
  "fix-special": 3, // the UNAUTHORED Special — reaches both seams, contributes to neither
  "sv02-190": 3, // Jet Energy — the OTHER onAttach arm, for the discrimination
  "fix-unaware": 3,
  "fix-shellcracker": 4, // the ATTACKER — Bite (damage), Yawn + Clutch (two effect ops)
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, from the ATTACKING seat)
  "fix-titan": 4, // 340 HP, no attacks — bench filler and the UNSHIELDED neighbour
  "fix-energy": 12, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const NEO_UPPER_ENERGY_DECK = deckOf({
  "fix-neo-upper-energy": 6,
  "fix-neo-stage1": 6, // the NON-Stage-2 holder, and the evolve source
  "fix-neo-stage2": 6, // the Stage 2 holder, and the evolve target
  "fix-basic-1": 12, // the bottom of the line, and the BASIC holder control
  "sv02-191": 3, // Luminous — the OTHER conditional provision
  "sv02-190": 3, // Jet — a plain {C} Special, for "another Special attached"
  "fix-special": 2, // the UNAUTHORED Special — reaches the funnel, promotes nothing
  "fix-victim": 2, // 30 HP — the body the §8.2 drive hits
  "fix-energy": 4, // Colorless Basic — pays the {C} half and arms NOTHING
  "fix-bigbody": 16, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const PRISM_ENERGY_DECK = deckOf({
  "fix-prism-energy": 6,
  "fix-prism-basic": 8, // the BASIC holder, and the evolve source
  "fix-prism-stage1": 6, // the NON-Basic holder, and the evolve target
  "fix-neo-stage2": 4, // a STAGE 2 — the wrong-predicate discrimination
  "fix-neo-upper-energy": 4, // the OTHER stage word on the SAME field
  "sv02-191": 3, // Luminous — the OTHER conditional provision
  "sv02-190": 3, // Jet — a plain {C} Special, for "another Special attached"
  "fix-special": 2, // the UNAUTHORED Special — reaches the funnel, promotes nothing
  "fix-victim": 2, // 30 HP — the body the §8.2 drive hits
  "fix-energy": 4, // Colorless Basic — pays the {C} half and arms NOTHING
  "fix-bigbody": 18, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const REVERSAL_ENERGY_DECK = deckOf({
  "fix-reversal-energy": 6,
  "fix-reversal-basic": 8, // the BASIC holder, and the evolve source
  "fix-reversal-stage1": 6, // the no-Rule-Box EVOLUTION — the only promoting body
  "fix-reversal-ex": 3, // its RULE-BOX twin — the `noRuleBox` denial
  "fix-neo-stage2": 4, // a STAGE 2 — the body Neo Upper promotes on, for the cross
  "fix-neo-upper-energy": 4, // the OTHER carrier of the same field, unrider'd
  "sv02-191": 3, // Luminous — the OTHER conditional provision
  "fix-special": 2, // the UNAUTHORED Special — reaches the funnel, promotes nothing
  "fix-victim": 2, // 30 HP — the body the §8.2 drive hits
  "fix-energy": 4, // Colorless Basic — pays the {C} half and arms NOTHING
  "fix-bigbody": 18, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const PREVENTED_CLASS_DECK = deckOf({
  "fix-safeguardex": 4, // holder — "…your opponent's Pokémon ex" (PREVENT_FROM_EX)
  "fix-armortail": 4, // holder — "…Basic Pokémon ex" (PREVENT_FROM_BASIC_EX); IS an ex
  "fix-exbasic": 4, // Basic ex, four attacks — prevented by BOTH holders
  "fix-exstage1": 4, // Stage 1 ex, same four — the sentences' one disagreement
  "fix-abilityv": 3, // Basic Pokémon V — the `preventDamageFromExV` separator
  "fix-attacker": 3, // no rule box — the flat control
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 as the ATTACKER)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and promote target
  "fix-energy": 10, // Colorless Basic — every cost in this deck
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const FLOWER_CURTAIN_DECK = deckOf({
  "fix-flowercurtain": 4, // the holder — "Flower Curtain" (preventBenchDamageNoRuleBox)
  "fix-shellcracker": 4,
  "fix-exbasic": 4, // "Fixbase ex" — the RULE-BOX benched body the sentence EXCLUDES
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 from the ATTACKING seat)
  "sv03-070": 3, // Thundurus — "Adverse Weather" (the FIRST field on the same scan)
  "fix-titan": 3, // 340 HP, no attacks, no Rule Box — the SHIELDED teammate
  "fix-attacker-vmax": 2, // "Bigmon VMAX" — a Rule Box the PARENTHETICAL does not name
  "fix-energy": 17, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const IMPERVIOUS_SHELL_DECK = deckOf({
  "fix-imperviousshell": 4, // the holder — "Impervious Shell" (preventDamageAtOrAbove: 200)
  "fix-imperviousweak": 4, // the same holder, {G} Weakness ×2 — the post-W/R witness
  "fix-crusher": 4, // the attacker — eight attacks, one per read site
  "sv01-192": 3, // Rock Chestplate (Tool) — {F}-gated −30: the post-REDUCTION witness
  "fix-titan": 4, // 340 HP, no Ability — the ATTRIBUTION control
  "sv01-096": 4, // Klefki — "Mischievous Lock" (§9 from the ATTACKING seat)
  "fix-energy": 17, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const COIN_FLIP_SHIELD_DECK = deckOf({
  "fix-experthider": 4, // the ungated holder — "Expert Hider"
  "fix-adrenapheromone": 4, // the {D}-gated holder — "Adrena-Pheromone"
  "fix-crusher": 4,
  "fix-dark-energy": 4, // Basic {D} — what arms "Adrena-Pheromone"
  "fix-titan": 4, // 340 HP, no Ability — the ATTRIBUTION control
  "sv01-096": 4, // Klefki — "Mischievous Lock": the §9 gate, and the no-coin witness
  "fix-energy": 12, // Colorless Basic — pays every {C} AND is the {D} conjunct's negative
  "fix-bigbody": 24, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const SAFEGUARD_DECK = deckOf({
  "sv02-097": 4, // Mimikyu — Safeguard (the preventDamageFromExV defender)
  "fix-attacker-ex": 4, // ex attacker — Bite ({C} 30, idx 0) + Spread Shot (idx 1)
  "fix-attacker-v": 4, // V attacker — Bite ({C} 30)
  "fix-attacker-vmax": 4, // VMAX attacker — Bite ({C} 30): the ex/V-only gate's negative
  "fix-attacker": 4, // plain attacker — Bite ({C} 30): the not-prevented control
  "fix-sniper": 4, // plain spread attacker — Spread Shot: the spread not-prevented control
  "fix-energy": 8, // Colorless Basic Energy — pays every Bite/Spread Shot {C}
  "fix-bigbody": 28, // 200 HP neutral Basic — DOMINANT starter + the P2 Active over a benched Mimikyu
});

export const LUNAR_ZONE_DECK = deckOf({
  "sv03-082": 4, // Clefable ex — Lunar Zone (the noRetreatCostAura source; retreat 2 itself)
  "fix-retreat2": 4, // retreat-2 neutral Basic — the beneficiary and the no-aura control
  "fix-psychic-energy": 8, // Basic {P} — satisfies the aura's requiresEnergyType clause
  "fix-energy": 8, // Basic {C} — the wrong-type negative (attached, still pays full cost)
  "sv02-191": 3, // Luminous Energy (ANY) — the wildcard-provision witness
  "sv01-167": 3, // Beach Court — the ± Basic discount the set-to-zero must beat
  "sv01-096": 3, // Klefki — Mischievous Lock: the §9 gate's (structurally negative) witness
  "fix-bigbody": 27, // 200 HP neutral Basic — DOMINANT mulligan-free starter + bench body
});

export const CALAMITOUS_WASTELAND_DECK = deckOf({
  "sv02-175": 3, // Calamitous Wasteland — the surcharge Stadium
  "sv01-167": 3, // Beach Court — the ± twin it replaces in the shared zone
  "fix-retreat2": 4, // non-{F} Basic, retreat 2 — the surcharged body
  "fix-fighting-1": 4, // {F} Basic, retreat 1 — the type exemption
  "fix-basic-0": 4, // retreat-0 Basic — a free retreater pushed to 1
  "fix-stage1": 4, // Colorless Stage 1, retreat 2 — the Basic-only negative
  "sv03-082": 2, // Clefable ex — the set-to-zero that still wins
  "fix-psychic-energy": 4, // Basic {P} — satisfies Lunar Zone's clause
  "fix-energy": 8, // Basic {C} — pays the surcharged retreat
  "fix-bigbody": 24, // 200 HP neutral Basic — DOMINANT starter + bench body
});

export const RETREAT_SCALING_DECK = deckOf({
  "sv01-002": 4, // Heracross — "Superpowered Throw" 10+, the additive arm
  "sv03-172": 4, // Stoutland — "Chomp Chomp Panic" 50×, the multiply arm
  "fix-retreat2": 4, // retreat-2 Basic — the main defender
  "fix-fighting-1": 4, // retreat-1 {F} Basic — the Calamitous exemption, read through
  "fix-basic-0": 4, // retreat-0 Basic — the multiply arm's 0-damage case
  "sv01-167": 3, // Beach Court — the discount the readers must see
  "sv02-175": 3, // Calamitous Wasteland — the surcharge the readers must see
  "fix-grass-energy": 6, // Basic {G} — pays Superpowered Throw
  "fix-energy": 8, // Basic {C} — pays Chomp Chomp Panic
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT starter + bench body
});

export const TRAP_TERRITORY_DECK = deckOf({
  "sv01-019": 4, // Spidops ex — Trap Territory (the aura) + Wire Hang (the reader)
  "fix-retreat2": 4, // retreat-2 Basic — the surcharged body
  "fix-basic-0": 4, // retreat-0 Basic — a free retreater the surcharge lifts to 1
  "sv03-082": 3, // Clefable ex — the NON-Basic target + Lunar Zone's set-to-zero
  "fix-psychic-energy": 4, // Basic {P} — arms Lunar Zone's clause
  "sv01-167": 3, // Beach Court — the −1 the +1 aura composes with (both reachable)
  "sv01-096": 3, // Klefki — Mischievous Lock: the §9 gate's negative witness
  "fix-grass-energy": 6, // Basic {G} — pays Wire Hang's {G}
  "fix-energy": 8, // Basic {C} — pays Wire Hang's {C} and the surcharged retreat
  "fix-bigbody": 21, // 200 HP neutral Basic — DOMINANT starter + bench body
});

export const RETREAT_LOCK_DECK = deckOf({
  "sv02-016": 4,
  "sv03-128": 3,
  "fix-retreat2": 4, // retreat-2 Basic — the locked body (a retreat it could pay)
  "fix-basic-1": 4, // retreat-1 Basic — the locked body on the EVOLVE clear path
  "fix-stage1": 3, // evolves from fix-basic-1 — §10 sheds the block
  "sv01-194": 3, // Switch — the leaving-the-Active-Spot clear
  "fix-grass-energy": 6, // Basic {G} — pays Bind Down
  "fix-dark-energy": 6, // Basic {D} — pays Poison Ring
  "fix-energy": 10, // Basic {C} — pays the locked body's retreat cost
  "fix-bigbody": 17, // 200 HP neutral Basic — DOMINANT starter + bench body
});

export const BLOCK_DECK = deckOf({
  "swsh10.5-055": 4, // Snorlax — "Block": the continuous retreat lock
  "fix-retreat2": 4, // retreat-2 Basic — the blocked body (a retreat it could pay)
  "sv01-096": 4, // Klefki — "Mischievous Lock": the §9 gate's POSITIVE witness
  "fix-attacker": 4, // Bite ({C}, 30) — the blocked body that still attacks
  "fix-energy": 12, // Basic {C} — pays the blocked body's retreat cost and Bite
  "fix-bigbody": 32, // 200 HP neutral Basic — DOMINANT starter + both pinned Actives
});

export const PUNK_OUT_DECK = deckOf({
  "swsh10.5-025": 4, // Wimpod — "Punk Out": the holder (retreat 3)
  "fix-attacker-v": 2, // Guardmon V — the cross-board trigger (Active or Bench)
  "fix-attacker-vmax": 2, // Bigmon VMAX — the V-only negative
  "fix-attacker-ex": 2, // Fixmon ex — the other rule-box negative
  "sv01-096": 2, // Klefki — "Mischievous Lock": the §9 gate's POSITIVE witness
  "sv01-167": 2, // Beach Court — the ± Stadium the set-to-zero must beat
  "fix-retreat2": 2, // retreat-2 Basic — the SELF-only control (it still pays)
  "fix-energy": 12, // Basic {C} — pays the control's retreat
  "fix-bigbody": 32, // 200 HP neutral Basic — DOMINANT starter + both pinned Actives
});

export const CONDITIONAL_DAMAGE_DECK = deckOf({
  "sv02-096": 3, // Palossand — "Earthen Power" (80+): the Stadium clause + an Evolution body
  "sv02-043": 3, // Gyarados — "Revengeful Storm" (80+): the Prize clause + an Evolution body
  "sv01-045": 3, // Gyarados ex — "Tyrannical Tail" (180+): the "already damaged" clause
  "sv02-137": 3, // Seviper — "Cross-Cut" (50+): the Evolution clause
  "sv01-167": 3, // Beach Court — the Stadium the ownership case needs on EITHER side
  "fix-water-energy": 8, // Basic {W} — Tyrannical Tail alone wants three
  "fix-psychic-energy": 4, // Basic {P} — pays Earthen Power
  "fix-dark-energy": 4, // Basic {D} — pays Cross-Cut
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 21, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the Basic defender
});

export const CONDITION_CLAUSE_DECK = deckOf({
  "sv02-030": 3, // Talonflame — "Fiery Breeze" (70+): yourActiveDamaged, +90
  "sv03-035": 3, // Darmanitan — "Damage Counterpunch" (60+): the same clause, +60
  "sv03-066": 3, // Tyranitar ex — "Lightning Rampage" (150+): yourBenchDamaged
  "sv01-128": 3, // Seviper — "Venoshock" (60+): opponentActivePoisoned, and its own Poison setter
  "sv02-136": 3, // Sableye — "Unseen Claw" (20+): the ANY-condition clause, and its Asleep setter
  "fix-fire-energy": 6, // Basic {R} — pays Fiery Breeze and Damage Counterpunch
  "fix-fighting-energy": 6, // Basic {F} — pays Lightning Rampage's {F}{F}
  "fix-dark-energy": 6, // Basic {D} — pays Venoshock and Unseen Claw
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 19, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the bench body
});

export const CLAUSE_TABLE_DECK = deckOf({
  "sv06.5-036": 3, // Okidogi ex — "Chain-Crazed" (130+): yourActivePoisoned, and an ex target
  "sv02-098": 3, // Ceruledge — "Fighting Sword" (100+): opponentActiveIsExOrV
  "sv01-128": 3, // Seviper — "Spit Poison": the only in-game route to a Poisoned OWN Active
  "fix-pokemon-v": 2, // 210 HP Fixmon V — the other half of the printed "ex or V"
  "fix-pokemon-vmax": 2, // 330 HP Fixmon VMAX — the body the clause does NOT name
  "fix-dark-energy": 6, // Basic {D} — pays Chain-Crazed and Spit Poison
  "fix-psychic-energy": 6, // Basic {P} — pays Fighting Sword's {P}
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 27, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the clean control
});

export const ENERGY_CLAUSE_DECK = deckOf({
  "sv01-029": 3, // Scovillain — "Super Spicy Breath" (90+): the {R} clause, +90
  "sv06.5-002": 3, // Galvantula — "Shocking Web" (50+): the {L} clause, +80
  "sv02-055": 3, // Cetitan — "Special Horn" (80+): the Special CLASS clause, +140
  "sv02-105": 3, // Tinkaton — "Special Hammer" (90+): the same clause, +90, on a Stage 2
  "fix-psychic-weak": 2, // 200 HP, ×2 Psychic — the Weakness defender for the fold-order pair
  "fix-grass-energy": 3, // Basic {G} — pays Super Spicy Breath and Shocking Web
  "fix-fire-energy": 3, // Basic {R} — ARMS Scovillain's clause; never pays its cost
  "fix-lightning-energy": 3, // Basic {L} — ARMS Galvantula's clause; never pays its cost
  "fix-water-energy": 4, // Basic {W} — Special Horn alone wants two
  "fix-psychic-energy": 3, // Basic {P} — pays Special Hammer
  "fix-energy": 5, // Basic {C} — pays every Colorless symbol in the cast
  "sv02-191": 4, // Luminous Energy — the WILDCARD Special: provides every type, alone
  "sv02-190": 4, // Jet Energy — the second Special that DEMOTES Luminous to {C}
  "fix-bigbody": 17, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the bench body
});

export const PUBLIC_COUNT_DECK = deckOf({
  "sv03-135": 4, // Absol ex — "Cursed Slug" (100+): opponentHandAtMost 3, +120. A 2-PRIZE body.
  "sv03-145": 4, // Bronzong — "Extrasensory" (70+): handSizesEqual, +90
  "sv01-116": 4, // Krokorok — "Payback" (30+): opponentPrizesRemaining [1], +90; and the KO swing
  "sv03-101": 4, // Houndstone — "Two Four-ocious" (80+): opponentPrizesRemaining [2, 4], +120
  "fix-psychic-weak": 4, // 200 HP, ×2 Psychic — the Weakness defender for the fold-order pair
  "fix-dark-energy": 6, // Basic {D} — pays Cursed Slug's {D}{D}{C} on its own
  "fix-metal-energy": 5, // Basic {M} — pays Extrasensory
  "fix-fighting-energy": 5, // Basic {F} — pays Payback and Corkscrew Punch
  "fix-psychic-energy": 6, // Basic {P} — pays Two Four-ocious's {P}{C}{C} on its own
  "fix-bigbody": 18, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the control
});

export const TYPE_NAME_DECK = deckOf({
  "sv02-119": 6, // Falinks — "Reckless Charge Together" (70+): yourBenchHasNamed, +90. Needs TWO at once.
  "swsh10.5-035": 4, // Sylveon — "Wonder Flash" (90+): opponentActiveHasType Dragon, +90
  "sv03-161": 4, // Drampa — the pool's DRAGON body (120 HP, no Weakness): the armed defender
  "fix-fighting-weak": 3, // 200 HP, ×2 Fighting — the Weakness defender for the fold-order pair
  "fix-psychic-energy": 6, // Basic {P} — pays Souvenir, and two of Reckless Charge Together's {C}{C}
  "fix-fighting-energy": 6, // Basic {F} — pays Reckless Charge Together's {F}, and two of Wonder Flash's {C}{C}{C}
  "fix-bigbody": 31, // 200 HP neutral Colorless Basic — DOMINANT pinned starter, the non-Dragon control
});

export const ENERGY_IN_PLAY_DECK = deckOf({
  "sv06.5-030": 4, // Absol — "Darkfall" (20+): yourEnergyInPlayAtLeast Darkness ×3, +50
  "fix-darkness-energy": 12, // Basic {D} — the counted card
  "sv02-191": 4, // Luminous Energy — the wildcard-provision witness + the demotion pair
  "fix-energy": 6, // Basic {C} — pays Darkfall's cost while counting ZERO
  "fix-darkness-weak": 3, // 200 HP, ×2 Darkness — the Weakness defender for the fold-order pair
  "fix-bigbody": 31, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holders
});

export const TOOL_CLAUSE_DECK = deckOf({
  "sv01-152": 4, // Greedent — "Enhanced Fang" (80+) at index 1: yourActiveHasToolAttached, +80
  "sv02-173": 6, // Bravery Charm — the SILENT arm (basicHpBonus, inert on a Stage 1)
  "sv01-197": 3, // Vitality Band — the LOUD arm (+10 in the same pre-W/R step)
  "fix-energy": 9, // Basic {C} — pays Enhanced Fang's {C}{C}{C}
  "fix-colorless-weak": 3, // 200 HP, ×2 Colorless — the Weakness defender for the fold-order pair
  "fix-bigbody": 35, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holder
});

export const SUPPORTER_CLAUSE_DECK = deckOf({
  "swsh10.5-027": 4, // Pikachu — "Buddy Bolt" (30+): youPlayedSupporterThisTurn, +30
  "sv01-180": 4, // Nemona (Supporter, "Draw 3 cards.") — the ONLY thing that arms the clause
  "fix-lightning-energy": 6, // Basic {L} — pays Buddy Bolt's typed symbol
  "fix-energy": 6, // Basic {C} — pays Buddy Bolt's two generic symbols
  "fix-lightning-weak": 7, // 130 HP, ×2 Lightning — the Weakness defender for the fold-order pair
  "fix-bigbody": 33, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holder
});

export const PROMOTED_CLAUSE_DECK = deckOf({
  "sv06.5-015": 4, // Revavroom ex — "Accelerator Flash" (20+) at index 0: yourActivePromotedThisTurn, +120
  "sv06.5-043": 3, // Varoom — the pre-evolution the evolution-SURVIVES-it case retreats in and evolves
  "swsh10.5-026": 3, // Golisopod — the SAME clause at +90, the proof the fold reads the captured amount
  "sv02-172": 4, // Boss's Orders (Supporter, gust) — the switchInto route on the OPPONENT's board
  "sv01-194": 3, // Switch (Item, switchActive) — the switchInto route on YOUR OWN board
  "fix-metal-energy": 5, // Basic {M} — pays Accelerator Flash's single typed symbol
  "fix-water-energy": 3, // Basic {W} — pays First Impression's single typed symbol
  "fix-energy": 5, // Basic {C} — pays the retreat cost (§11: any Energy) that arms the clause
  "fix-lightning-weak-big": 3, // 320 HP, ×2 Lightning — the Weakness defender for the fold-order pair
  "fix-bigbody": 27, // 200 HP neutral Colorless Basic — DOMINANT pinned starter, the retreater, the promote target
});

export const ATTACK_REQUIREMENT_DECK = deckOf({
  "sv03-062": 4, // Palafin — "Justice Kick" (210) at index 1: requires yourActivePromotedThisTurn
  "sv03-061": 3, // Finizen — the pre-evolution the evolution-SURVIVES-it case retreats in and evolves
  "sv03-117": 4, // Lycanroc — "Finishing Fang" (90) at index 0: requires opponentActiveDamaged;
  //                "Slashing Claw" (100) at index 1 is the no-effect-key negative AND the real damage source
  "sv01-194": 3, // Switch (Item, switchActive) — the SECOND route that arms Justice Kick
  "sv02-172": 3, // Boss's Orders (Supporter, gust) — promotes on the OPPONENT's board: the seat-asymmetry case
  "fix-water-energy": 6, // Basic {W} — pays Justice Kick's {W}{W}
  "fix-fighting-energy": 4, // Basic {F} — pays Finishing Fang's {F} and Slashing Claw's first symbol
  "fix-energy": 6, // Basic {C} — Slashing Claw's two generic symbols, and the retreat (§11) that arms Palafin
  "fix-lightning-weak-big": 4, // 320 HP — the only body in the pool that survives 210 (its Weakness is inert here)
  "fix-bigbody": 23, // 200 HP neutral Colorless Basic — DOMINANT pinned starter, the retreater, the promote target
});

export const COIN_FLIP_DECK = deckOf({
  "sv01-018": 4, // Tarountula — "Surprise Attack" (30) at index 0: cancelOnTails
  "sv03-036": 4, // Litwick — "Firebreathing" (10+) at index 0: bonusOnHeads, per 10
  "fix-grass-energy": 6, // Basic {G} — pays Surprise Attack's single symbol
  "fix-fire-energy": 6, // Basic {R} — pays Firebreathing's single symbol
  "fix-weak": 4, // 60 HP, ×2 FIRE — the pre-Weakness fold defender for Litwick's heads
  "fix-bigbody": 36, // 200 HP neutral Colorless Basic — DOMINANT pinned starter and the neutral defender
});

export const MULTI_COIN_FLIP_DECK = deckOf({
  "sv01-160": 4, // Tandemaus — "Double Hit" (30×) at index 0: perHeads, flips 2, per 30
  "sv06.5-048": 4, // Meowth — "Fury Swipes" (20×) at index 0: perHeads, flips 3, per 20
  "fix-energy": 8, // Basic {C} — pays both attacks' two generic symbols
  "fix-colorless-weak-big": 4, // 200 HP, ×2 COLORLESS — the pre-Weakness fold defender
  "fix-bigbody": 40, // 200 HP neutral Colorless Basic — DOMINANT pinned starter and the neutral defender
});

export const COIN_BONUS_DECK = deckOf({
  "fix-coinbonus": 4, // both printed sentences, indices 0 and 1, base "20+"
  "fix-energy": 12, // Basic {C} — pays both attacks' two generic symbols
  "fix-bigbody": 44, // 200 HP neutral Basic — DOMINANT pinned starter and the defender
});

export const PER_ENERGY_FLIP_DECK = deckOf({
  "sv01-035": 4, // Torkoal — "Concentrated Fire" (80×) at index 1: perHeads, attachedEnergy {R}, per 80
  "sv03-003": 4, // Bellossom — "Powerful Dance" (90×) at index 1: perHeads, attachedEnergy null, per 90
  "fix-flip-filter": 4, // CONSTRUCTED — {C} cost, {W} filter: the only route to a ZERO count
  "fix-fire-energy": 8, // Basic {R} — Torkoal's filter AND the {R} of its own cost
  "fix-water-energy": 8, // Basic {W} — pays Torkoal's two {C} while its {R} filter ignores them
  "fix-grass-energy": 6, // Basic {G} — pays Powerful Dance, and one type of its mixed pile
  "sv02-191": 3, // Luminous Energy — the WILDCARD Special (counts for every type, one CARD)
  "fix-special": 3, // an UNAUTHORED Special — Colorless by fallback, typed by nothing
  "fix-pokemon-v-weak": 2, // 210 HP, ×2 FIRE — the pre-Weakness fold defender for Torkoal
  "fix-titan": 18, // 340 HP neutral Basic — the pinned Active on both sides, and it survives 270
});

export const UNTIL_TAILS_FLIP_DECK = deckOf({
  "sv01-030": 4, // Growlithe — "Relentless Flames" (30×) at index 0: perHeads, untilTails, per 30
  "sv01-144": 4, // Chansey — "Egg Rolling" (60×) at index 1: perHeads, untilTails, per 60
  "sv03-174": 4, // Bouffalant — "Damage Rush" (50+) at index 0: bonusOnHeads, untilTails, per 30
  "sv01-117": 3,
  "fix-fire-energy": 4, // Basic {R} — pays Relentless Flames' single symbol
  "fix-fighting-energy": 3, // Basic {F} — pays Chomp Chomp Bite's single symbol, and nothing else
  "fix-energy": 8, // Basic {C} — pays Damage Rush's {C}{C} and Egg Rolling's {C}{C}{C}
  "fix-titan": 30, // 340 HP neutral Basic — the pinned Active on both sides, and no total here KOs it
});

export const COIN_THRESHOLD_DECK = deckOf({
  "fix-threshflip": 4, // all three printed sentences, at indices 0, 1 and 2
  "fix-energy": 8, // Basic {C} — pays every one of the three {C}{C} costs
  "sv02-193": 4, // Therapeutic Energy — the §12 immunity control on the DEFENDER
  "fix-titan": 44, // 340 HP neutral Basic — DOMINANT starter and the never-KO'd defender
});

export const SCOPED_HEAL_DECK = deckOf({
  "fix-scopedheal": 4, // both printed sentences, at indices 0 and 1 — the BASIC attacker
  "fix-scopedheal-evo": 4, // the same two attacks on a Stage 1 — the evolved body/attacker
  "fix-energy": 8, // Basic {C} — pays both {C}{C} costs
  "fix-titan": 44, // 340 HP neutral BASIC — dominant starter, bench filler, defender
});

export const PER_HEADS_PROGRAM_DECK = deckOf({
  "sv01-057": 4, // Wugtrio — "Undersea Tunnel" at index 1: programPerHeads, printed 3, mill 3
  "swsh10.5-022": 4, // Gyarados — "Wreak Havoc" at index 0: programPerHeads, untilTails, mill 2
  "fix-energy": 8, // Basic {C} — pays Undersea Tunnel's {C}{C}{C} and Wreak Havoc's {C}
  "fix-water-energy": 4, // Basic {W} — pays Wugtrio's index-0 "Headbutt" control, and nothing else
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

export const DECK_TOP_MILL_DECK = deckOf({
  "sv03-178": 4, // Skwovet — "Nicked Nibble" at idx 0: discardDeckTop, opponent, count 1 (singular)
  "swsh10.5-022": 4, // Gyarados — "Wild Splash" at idx 1: discardDeckTop, self, count 5, after 230 damage
  "fix-energy": 8, // Basic {C} — Skwovet's two attacks, and Wild Splash's {C}{C}
  "fix-water-energy": 6, // Basic {W} — Wild Splash's {W}{W}, and nothing else
  "fix-titan": 38, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

export const SELF_HEAL_DECK = deckOf({
  "sv02-098": 4, // Ceruledge — "Life Sucker" at idx 0: heal 30, AFTER a printed 50
  "swsh10.5-032": 4, // Natu — "Nap" at idx 0: heal 20, NO printed damage at all
  "fix-energy": 12, // Basic {C} — pays Life Sucker's {C}{C} and Nap's {C}
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides
});

export const BOARD_HEAL_DECK = deckOf({
  "sv02-037": 4, // Skeledirge ex — "Vitality Song" at idx 0: heal 30 each, AFTER a printed 50
  "sv06.5-021": 4, // Cresselia — "Healing Pirouette" at idx 0: heal 20 each, NO printed damage
  "fix-fire-energy": 6, // Basic {R} — pays Vitality Song's single Fire, and nothing else
  "fix-psychic-energy": 6, // Basic {P} — pays Healing Pirouette's single Psychic, and nothing else
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active BOTH sides + every bench body
});

export const FLIP_GATED_OP_DECK = deckOf({
  "sv02-035": 4, // Fuecoco — "Spacing Out" at idx 0: gated heal 30; "Flare" at idx 1: {R}{C} for 30
  "sv01-056": 4, // Wiglett — "Dig a Little" at idx 0: gated mill 1; "Ram" at idx 1: {C}{C} for 20
  "fix-energy": 10, // Basic {C} — pays both gated attacks' {C} and Ram's {C}{C}
  "fix-fire-energy": 4, // Basic {R} — pays Flare's Fire, and nothing else
  "fix-titan": 38, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

export const CHOSEN_HEAL_DECK = deckOf({
  "sv02-121": 4, // Nacli — "Salt Coating" at idx 0: heal 20, ANY zone; "Tackle" at idx 1: {F}{F} for 30
  "sv01-007": 4, // Tropius — "Fresh-Picked Fruit" at idx 0: heal 60, BENCH only; "Razor Leaf" at idx 1
  "fix-allheal": 4, // FIXTURE — Blissey/Arboliva's real "all" sentence on an invented Basic body
  "fix-fighting-energy": 5, // Basic {F} — pays Salt Coating's single Fighting (and Tackle's two)
  "fix-grass-energy": 5, // Basic {G} — pays Fresh-Picked Fruit's single Grass (and Razor Leaf's first)
  "fix-energy": 4, // Basic {C} — pays fix-allheal's {C}{C} line and Razor Leaf's second symbol
  "fix-titan": 34, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + every candidate body
});

export const COUNTER_MOVE_DECK = deckOf({
  "sv02-093": 4, // Dedenne ex — "Tail Swap" at idx 0 (the move, no damage); "Wondrous Shot" at idx 1 ({P}×3, 170)
  "fix-psychic-energy": 8, // Basic {P} — two pay Tail Swap, three pay Wondrous Shot
  "fix-psychic-weak-big": 4, // 200 HP ×2 Psychic, NO attacks — the flat-placement defender
  "fix-titan": 44, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + every bench candidate
});

export const COUNTER_PUT_DECK = deckOf({
  "sv02-097": 4, // Mimikyu — "Ghost Eye" at idx 0 ({P}{C}, 7 counters, no damage); Safeguard is a REGISTRY passive
  "sv03-098": 4, // Polteageist — "Antique Collecting" at idx 0 (loud), "Pour Tea" at idx 1 ({P}, 5 counters)
  "fix-psychic-energy": 6, // Basic {P} — two pay Ghost Eye ({P}{C}), one pays Pour Tea
  "fix-psychic-weak-big": 3, // 200 HP ×2 Psychic, NO attacks — the flat-placement defender, high side
  "fix-psychic-resist-big": 3, // 200 HP Psychic −30, NO attacks — the flat-placement defender, low side
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + the promote target
});

export const COUNTER_BENCH_PUT_DECK = deckOf({
  "sv02-127": 4, // Ting-Lu ex — "Land Scoop" at idx 0 ({F}{F}{F}, 150 damage + 2 counters); Cursed Land is a REGISTRY passive
  "fix-fighting-energy": 12, // Basic {F} — three pay each Land Scoop
  "sv03-174": 3, // Bouffalant — "Bouffer" (−20 after W/R): the reduction a placement must SKIP
  "sv02-097": 3, // Mimikyu — "Safeguard": the ex-prevention a placement must SKIP
  "fix-fighting-weak": 3, // 200 HP ×2 Fighting, inert — the Weakness a placement must SKIP
  "fix-titan": 35, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + the plain bench candidate
});

export const COUNTER_SPREAD_DECK = deckOf({
  "fix-spread-bench": 4, // Hex Hurl at idx 0 ({C}{C}{C}, 90 damage + 2 counters, opponentBench)
  "fix-spread-any": 4, // Cursed Drop at idx 0 ({G}, NO damage + 4 counters, opponentAny)
  "fix-grass-energy": 6, // Basic {G} — one pays Cursed Drop
  "fix-victim": 4, // 30 HP — the body three counters KO, and the stability witness
  "fix-titan": 42, // 340 HP neutral Basic, NO attacks — pinned Active both sides + bench filler
});

export const SCORCHING_ARMOR_DECK = deckOf({
  "sv03-044": 4, // Armarouge — Scorching Armor (onDamagedByAttack → Burn the attacker)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "fix-bigbody": 40, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

export const COUNTERATTACKING_PINCER_DECK = deckOf({
  "sv03-120": 4, // Klawf ex — Counterattacking Pincer (onDamagedByAttack → PARKING discard)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "fix-bigbody": 30, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 9, // Colorless Basic Energy — pays Bite's {C}, one discard candidate
  "fix-fire-energy": 9, // Fire Basic Energy — the SECOND, DIFFERENT candidate that forces a PARK
});

export const ABILITY_LOCK_DECK = deckOf({
  "sv01-096": 2, // Klefki — Mischievous Lock (Basic, both sides, Active-only)
  "sv02-089": 2, // Spiritomb — Fettered in Misfortune (Basic V, both sides, from the bench too)
  "sv02-127": 2, // Ting-Lu ex — Cursed Land (opponent's damaged non-ex, Active-only)
  "sv02-061": 2, // Chien-Pao ex — "Shivery Chill" (an activated, Active-only Ability)
  "sv02-105": 2, // Tinkaton — "Gather Materials" (a STAGE 2 activated Ability)
  "sv02-150": 2, // Copperajah ex — "Bronze Body" (a passive, and Ting-Lu's ex exemption)
  "sv03-044": 2, // Armarouge — "Scorching Armor" (a triggered Ability)
  "sv03-174": 2, // Bouffalant — "Bouffer" (−20 after W/R, the passive read site)
  "fix-pokemon-v": 2, // Fixmon V — Spiritomb's target
  "fix-pokemon-vmax": 2, // Fixmon VMAX — the suffix near-miss Spiritomb must skip
  "fix-stage1": 2, // a NON-Basic target (Klefki/Spiritomb exclude it by stage)
  "sv01-197": 2, // Vitality Band — the Tool a locked Pokémon keeps
  "fix-attacker": 4, // the plain-damage attacker (Bite = {C} 30, index 0)
  "fix-energy": 6, // Colorless Basic Energy — pays Bite's {C}
  "fix-water-energy": 4,
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT setup Active + the displaced body
});

export const REMOVE_WEAKNESS_DECK = deckOf({
  "sv01-093": 3, // Florges — Blooming Garden (the removeWeakness aura source)
  "fix-attacker": 3, // Fire attacker — Bite ({C}, 30), fix-weak's Fire weakness doubles it
  "fix-weak": 3, // 60 HP ×2 Fire defender — the main-hit weakness witness
  "sv02-061": 3, // Chien-Pao ex (Water) — "Hail Blade" drives the snipeActive path
  "fix-water-weak": 3, // 200 HP ×2 Water defender — the snipeActive weakness witness
  "sv02-127": 3, // Ting-Lu ex — Cursed Land (locks a damaged Florges: the §9-gating witness)
  "fix-fire-energy": 8, // pays Bite's {C} and colours fix-attacker's hit
  "fix-water-energy": 8, // pays Hail Blade's {W}{W} and is its discard fuel
  "fix-bigbody": 26, // 200 HP neutral Basic — DOMINANT mulligan-free starter + displaced body
});

export const ATTACK_DISCARD_DECK = deckOf({
  "sv02-072": 4, // Pincurchin — Needle Crush
  "sv03-050": 4, // Tympole — Screw Tail (coin-gated)
  "sv06.5-026": 4, // Slither Wing — Smashing Wing (discard 2)
  "sv01-124": 4, // Koraidon — Rampaging Fang (discard 3)
  "fix-discard4": 3, // FIXTURE — discard 4 for a [C] cost, the short-board path
  "fix-victim": 2, // 30 HP — OHKO'd by every attack here
  "fix-bigbody": 3, // 200 HP — survives all of it
  "fix-lightning-energy": 6, // pays Needle Crush's [L][L][L]
  "fix-water-energy": 4, // pays Screw Tail's [W]
  "fix-fighting-energy": 10, // pays the two {F} costs
  "fix-fighting-energy-alt": 4, // a second {F} print — same provision, different id
  "fix-special": 4, // a Special Energy — a distinct identity in the same pick
  "fix-energy": 8, // basic Colorless — the "different print" a mixed board needs
});

export const PROVIDES_ENERGY_DECK = deckOf({
  "sv01-079": 3, // Kilowattrel — Thunder Blast (a {L} Energy)
  "sv01-032": 3, // Arcanine ex — Bright Flame (2 {R} Energy)
  "swsh10.5-009": 3, // Charmeleon — Flamethrower (a Fire Energy, spelled out)
  "swsh10.5-010": 3, // Charizard — Flare Blitz (all Fire Energy, spelled out)
  "sv01-041": 3, // Armarouge — Fire Off (the moveEnergy consumer)
  "fix-basic-1": 4, // plain bodies: bench sources for Fire Off, setup Basics
  "fix-titan": 5, // 340 HP — survives every printed damage here
  "fix-typeddiscard": 2, // FIXTURE — discards a type its own cost does not need
  "fix-pilescan": 2, // FIXTURE — the filter in a DECK search: matches nothing
  "fix-blend": 2, // FIXTURE — a Special providing TWO distinct types
  "fix-lightning-energy": 4, // pays Thunder Blast's {L}
  "fix-fire-energy": 8, // pays the three Fire costs
  "fix-fire-energy-alt": 2, // a second Fire print — same provision, different id
  "fix-water-energy": 3, // a typed NON-match, to be left attached
  "fix-energy": 5, // basic Colorless — pays the {C} slots, never typed
  "sv02-191": 4, // Luminous Energy — the WILDCARD: provides every type
  "sv02-190": 2, // Jet Energy — a second Special, which demotes Luminous to {C}
  "fix-special": 2, // an UNAUTHORED Special — the Colorless fallback, never typed
});

export const ATTACH_FROM_TOP_DECK = deckOf({
  "sv01-170": 4, // Electric Generator (Item)
  "sv02-140": 4, // Hydreigon — Tri Howl
  "fix-lightning-1": 8, // the {L} bodies Electric Generator may attach to
  "fix-basic-1": 8, // Colorless bodies — bench targets the {L} filter excludes
  "fix-lightning-energy": 10, // the only Basic {L}: Electric Generator's candidates
  "fix-fire-energy": 8, // a Basic of the WRONG type
  "fix-energy": 6, // basic Colorless — a near-miss for the typed filter
  "fix-special": 6, // a Special Energy — anyEnergy takes it, basicEnergy does not
  "fix-item": 6, // non-Energy filler: window padding + Tri Howl's leftovers
});

export const HAND_COST_DECK = deckOf({
  "sv01-196": 4, // Ultra Ball (Item) — discard 2 OTHER cards
  "sv06.5-096": 4, // Earthen Vessel (Item) — discard ANOTHER card
  "sv01-142": 4, // Revavroom — Rumbling Engine (an Energy card → draw to 6)
  "sv02-105": 4, // Tinkaton — Gather Materials (a card → draw 3)
  "swsh10.5-018": 2, // Radiant Blastoise — Pump Shot (a Basic {W} → 2 counters)
  "sv02-015": 2, // Meowscarada ex — Bouquet Magic (a Basic {G} → 3 counters)
  "fix-basic-1": 12, // bodies, and what Ultra Ball's search looks for
  "fix-grass-energy": 8, // Meowscarada's Basic {G}
  "fix-water-energy": 8, // Radiant Blastoise's Basic {W}
  "fix-special": 6, // a SPECIAL Energy — anyEnergy only
  "fix-item": 6, // non-Energy filler for the unfiltered costs
});

export const DECK_BOTTOM_DECK = deckOf({
  "sv02-179": 4, // Dendra (Supporter) — pay 1 to the bottom, draw to 5
  "sv01-151": 4, // Skwovet — Nest Stash (the whole hand to the bottom, draw 1)
  "fix-attacker": 4, // an opponent body / a second Pokémon in hand
  "fix-basic-1": 12, // interchangeable bulk
  "fix-item": 12, // more interchangeable bulk — the unfiltered cost's usual payer
  "fix-grass-energy": 8, // a distinguishable class the pick can prefer
  "fix-water-energy": 8, // a second one, so a hand can hold three classes
  "fix-energy": 8, // Colorless basics — the filler that fills a deck out
});

export const ATTACH_FROM_DECK_DECK = deckOf({
  "sv06.5-059": 4, // Janine's Secret Art (Supporter)
  "sv03-125": 4, // Charizard ex — Infernal Reign (onEvolve)
  "fix-stage1": 4, // what Charizard ex evolves from in this pool
  "fix-basic-1": 8, // Colorless bodies: the chain's base, and non-{D} attach targets
  "fix-dark-1": 6, // the {D} bodies Janine's targetType admits
  "fix-dark-energy": 8, // Janine's Basic {D}
  "fix-dark-energy-alt": 4, // a SECOND print of it — the collapse crosses ids
  "fix-fire-energy": 8, // Charizard's Basic {R}, and a near-miss for Janine
  "fix-energy": 10, // Colorless basics — near-misses for both typed filters
  "fix-special": 4, // a Special Energy — `basicEnergy` admits none of them
});

export const SOURCE_UID_DECK = deckOf({
  "sv01-076": 4, // Pawmot — Electrogenesis
  "sv01-209": 1, // Pawmot (reprint)
  "sv02-170": 4, // Flamigo — Insta-Flock (onPlayToBench park)
  "sv01-181": 3, // Nest Ball (a parking Trainer)
  "fix-basic-1": 12,
  "fix-lightning-energy": 6,
  "fix-lightning-energy-alt": 4, // the second print — the collapse crosses ids
  "fix-energy": 26,
});

export const HEAL_UPTO_DECK = deckOf({
  "sv02-187": 3, // Saguaro
  "sv02-255": 2, // Saguaro (reprint)
  "sv02-270": 2, // Saguaro (reprint)
  "sv01-188": 2, // Potion — the exact-1 single arm, unchanged
  "fix-basic-1": 12,
  "fix-energy": 39,
});

export const PICNIC_BASKET_DECK = deckOf({
  "sv01-184": 4, // Picnic Basket
  "fix-basic-1": 20, // bodies for BOTH boards (Active + bench each)
  "fix-energy": 36,
});

export const JACQ_DECK = deckOf({
  "fix-basic-1": 24, // reliable Basic Active + Basic non-candidates
  "fix-stage1": 12, // Evolution Pokémon candidates
  "fix-stage2": 8, // more Evolution Pokémon candidates
  "sv01-175": 4, // Jacq — pulled into hand post-setup
  "fix-energy": 12, // non-Pokémon filler (rejected)
});

export const REVEAL_BOTTOM_DECK = deckOf({
  "sv03-190": 3, // Ortega
  "sv03-219": 2, // Ortega (reprint)
  "sv01-105": 4, // Greavard — Underworld Stroll (the derived attack twin)
  "sv01-179": 3, // Miriam — a second Supporter class for Greavard's pick
  "fix-attacker": 4, // the body that attacks / an opponent Active
  "fix-basic-1": 8, // interchangeable non-Supporter bulk
  "fix-item": 8, // more same-id bulk — the collapse's plainest case
  "fix-grass-energy": 6, // a distinguishable class
  "fix-dark-energy": 6, // Basic {D}, print one…
  "fix-dark-energy-alt": 4, // …and print two: the collapse crosses ids in a HAND
  "fix-psychic-energy": 2, // the {P} Greavard's SECOND attack costs — the plain one
  "fix-energy": 10, // Colorless filler
});

export const OP_RECORD_DECK = deckOf({
  "fix-basic-1": 10,
  "fix-basic-2": 4,
  "sv01-179": 4, // Miriam (Supporter)
  "sv02-189": 4, // Superior Energy Retrieval (Item)
  "fix-item": 6,
  "fix-fire-energy": 12,
  "fix-water-energy": 8,
  "fix-energy": 12,
});

export const COVERAGE_DECK = deckOf({
  "fix-attacker": 8,
  "sv01-185": 4,
  "sv01-187": 4,
  "sv01-180": 4,
  "sv02-150": 3,
  "sv01-121": 3,
  "fix-basic-1": 11,
  "fix-energy": 23,
});

export const EMERGENCY_DECK = deckOf({
  "fix-emergencyevolution": 4,
  "fix-unfezant": 4,
  "fix-unfezant-ex": 4,
  "fix-tranquill": 4,
  "sv02-173": 4,
  "fix-bigbody": 16,
  "fix-energy": 24,
});

export const ABILITY_DECK = deckOf({
  "sv02-061": 4,
  "sv03-174": 4,
  "fix-basic-1": 12,
  "fix-water-energy": 24,
  "fix-energy": 16,
});

export const PREVENT_BLOCK_DECK = deckOf({
  "sv03-004": 4, // Scyther — "Agility" idx 0 ({C}, 10 + the WIDE install), "Cut" idx 1 (control)
  "sv03-151": 4, // Togedemaru — "Defense Curl" idx 0 ({C}, the NARROW install), "Rolling Tackle" idx 1
  "sv02-072": 4, // Pincurchin — "Needle Crush" ({L}{L}{L}, 70 + an Energy discard off the defender)
  "sv02-016": 4, // Tarountula — "Bind Down" ({G}, 10 + the retreat-lock rider)
  "sv02-097": 4, // Mimikyu — "Ghost Eye" ({P}{C}, 7 counters): the PUT, an effect and not damage
  "fix-attacker": 4, // Bite ({C}, 30) and Yawn (costless, Asleep on the defender)
  "fix-sniper": 2, // "Spread Shot" ({C}, 30 + 20 to EACH benched) — "done to THIS Pokémon" in one hit
  "fix-basic-1": 2, // an evolvable Basic — the §10 clear, which no legal sequence can reach
  "fix-stage1": 2, // …and what it evolves into
  "sv03-012": 2, // Trevenant — "Forest Miasma": the SAME damageActive op as an ATTACK, as an ABILITY
  "fix-hammer": 2, // fixture Item — the SAME discardEnergy op as an ATTACK, played as a TRAINER
  "sv02-172": 2, // Boss's Orders — the gust that drags a shielded body off the Active Spot
  "fix-energy": 6, // Colorless Basic — pays every {C} in the deck
  "fix-lightning-energy": 6, // {L}{L}{L} — two Needle Crushes' worth
  "fix-grass-energy": 3, // {G} — Bind Down
  "fix-psychic-energy": 4, // {P} — two Ghost Eyes' worth (the {C} half comes off fix-energy)
  "fix-metal-energy": 2, // {M} — Rolling Tackle's typed half
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — the bench filler and promote target
});

export const ATTACK_LOCK_DECK = deckOf({
  "sv01-048": 4, // Alomomola — "Surf" idx 0 (control + the refused sibling), "Aqua Slash" idx 1
  "sv03-029": 4, // Ninetales — "Will-O-Wisp" idx 0 (control), "Nine-Tailed Dance" idx 1
  "fix-mola-stage1": 3, // evolves from Alomomola — the §10 clear as a played line
  "sv01-194": 3, // Switch (Item) — retreat out, switch back, attack: the lock is GONE
  "sv02-172": 2, // Boss's Orders — the opponent dragging a locked body off the spot
  "fix-attacker": 3, // Bite ({C}, 30) and Yawn (costless, Asleep) — the §12 control
  "fix-basic-1": 2, // a plain evolvable Basic — the promote/bench body with a chain
  "fix-stage1": 2, // …what fix-basic-1 evolves into
  "fix-water-energy": 12, // {W}{W} for Aqua Slash and Bubble; the {C} comes off fix-energy
  "fix-fire-energy": 8, // {R}{R} — two Nine-Tailed Dances' worth
  "fix-energy": 12, // Colorless Basic — pays every {C} in the deck
  "fix-titan": 5, // 340 HP neutral Basic, NO attacks — bench filler and promote target
});

export const TAILS_GATE_DECK = deckOf({
  "sv01-157": 4, // Oinkologne — "Ram" idx 0 (control + refused sibling), "Leg Stomp" idx 1
  "sv02-130": 4, // Paldean Clodsire ex — "Needle Bone" idx 0, the family's OTHER index
  "sv01-048": 4,
  "fix-mola-stage1": 2, // evolves from Alomomola — the §10 clear as a played line
  "sv01-194": 3, // Switch (Item) — retreat out, switch back, attack: the lock is GONE
  "sv02-172": 2, // Boss's Orders — the opponent dragging a locked body off the spot
  "fix-attacker": 3, // Bite ({C}, 30) and Yawn (costless, Asleep) — the §12 control
  "fix-dark-energy": 6, // {D} — Needle Bone's typed third; the rest is Colorless
  "fix-water-energy": 8, // {W}{W} — Aqua Slash and Bubble
  "fix-energy": 19, // Colorless Basic — pays every {C}, and Leg Stomp wants three
  "fix-titan": 5, // 340 HP neutral Basic, NO attacks — bench filler and promote target
});

export const TAILS_SELF_COST_DECK = deckOf({
  "sv02-063": 4, // Pikachu ex — "Pika Punch" idx 0 (control), "Dynamic Bolt" idx 1 (the discard)
  "sv03-054": 4, // Beartic — "Icicle Punch" idx 0 (control), "Frost Purge" idx 1 (the same sentence)
  "sv03-183": 4, // Oinkologne — "Confounding Cologne" idx 0 (a different arm), "High-Impact Kick" idx 1
  "sv02-097": 2, // Mimikyu — Safeguard is a REGISTRY passive: the prevented-main-hit defender
  "fix-colorless-weak-big": 2, // 200 HP ×2 Colorless — the recoil's flatness witness
  "fix-basic-1": 2, // a plain Basic — the lone bench body a self-KO promotes
  "fix-lightning-energy": 8, // Basic {L} — Dynamic Bolt's two typed symbols, and the surplus "all" strips
  "fix-water-energy": 8, // Basic {W} — Frost Purge's two typed symbols, and Icicle Punch's one
  "fix-energy": 14, // Colorless Basic — every {C}, and High-Impact Kick's whole {C}{C}{C}
  "fix-titan": 12, // 340 HP neutral Basic, NO attacks — the pinned Active both sides
});

export const DAMAGE_REDUCTION_DECK = deckOf({
  "sv03-169": 4, // Swablu — "Fluffy Guard" idx 0 ({C}, no damage): the 20
  "sv06.5-043": 2, // Varoom — "Rigidify" idx 0 ({M}, no damage): a 30 ALREADY in the pool
  "sv01-001": 4, // Pineco — "Guard Press" idx 0 ({C}{C}, 10): the 30, and Forretress's pre-evolution
  "sv01-139": 4, // Forretress — "Rolling Shell" idx 1 ({M}{C}{C}, 90): the 50 and the INDEX control
  "sv02-048": 4, // Eiscue — "Frigid Block" idx 1 ({W}{W}{W}, 100): the 100, COMPOUND
  "fix-attacker": 3, // Fire — Bite ({C}, 30) and Flame ({F}{C}, 60), the main-hit attacker
  "sv01-069": 2, // Rotom — "Linear Attack" ({C}, opponentAny 20, deals): the snipeActive site
  "fix-sniper": 2, // "Spread Shot" ({C}, 30 + 20 to each benched): the spreadDamage site
  "fix-bramble": 2, // the per-40 benched `deals` snipe: placeSnipe's damage arm
  "sv02-172": 2, // Boss's Orders — the reachable §10 clear
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-energy": 14, // Colorless — every {C} slot in the deck
  "fix-fire-energy": 4, // {F} — Flame's typed half
  "fix-metal-energy": 4, // {M} — Rolling Shell's typed half
  "fix-water-energy": 6, // {W}{W}{W} — two Frigid Blocks' worth
});
export const TYPED_CLASS_BLOCK_DECK = deckOf({
  "fix-crown": 4, // the installer — idx 0 excluded, idx 1 not
  "fix-attacker": 4, // Fire BASIC — matched, prevented
  "fix-colorless-brawler": 4, // Colorless BASIC — excluded, lands full
  "fix-dual-colorless": 3, // Fire+Colorless BASIC — the `includes` probe
  "fix-stage1-brawler": 3, // Fire STAGE 1 — the stage conjunct's negative
  "fix-titan": 8, // 340 HP neutral Basic, NO attacks — bench filler
  "fix-energy": 34, // Colorless — every cost in this deck is {C}
});
export const DAMAGE_CAP_BLOCK_DECK = deckOf({
  "fix-carapace": 4, // the installer — idx 0 caps at 40, idx 1 at 60
  "fix-carapace-tough": 3, // …the same, with a printed −30 (the reduction witness)
  "fix-attacker": 4, // Fire BASIC — Bite 30 doubles to 60 into the Weakness
  "fix-colorless-brawler": 4, // Colorless BASIC — Cheap Shot 40, the exact boundary
  "fix-heavy": 4, // Colorless BASIC — Slam 70, over both caps
  "fix-titan": 7, // 340 HP neutral Basic, NO attacks — bench filler
  "fix-energy": 34, // Colorless — every cost in this deck is {C}
});
export const CLASS_BLOCK_DECK = deckOf({
  "sv01-150": 4, // Staraptor — "Tailspin Away" idx 0 (the filter), "Power Blast" idx 1 (180, Stage 2)
  "sv02-153": 4, // Noivern ex — "Covert Flight" idx 0 (the filter), "Dominating Echo" idx 1 (LOUD)
  "sv02-072": 3, // Pincurchin — BASIC {L}{L}{L} 70 + the defender-side Energy discard
  "sv02-097": 3, // Mimikyu — BASIC {P}{C}, 7 counters PLACED (an effect, not damage)
  "sv03-098": 3, // Polteageist — STAGE 1 {P}, 5 counters on the same op as Ghost Eye
  "fix-attacker": 3, // BASIC Bite ({C}, 30) and Yawn (costless, Asleep)
  "fix-sniper": 2, // BASIC "Spread Shot" ({C}, 30 + 20 to each benched)
  "sv02-172": 2, // Boss's Orders — the reachable §10 clear
  "fix-basic-1": 2, // a plain evolvable Basic — the §10 evolve clear
  "fix-stage1": 2, // …what it evolves into
  "fix-energy": 14, // Colorless Basic — both installs, Power Blast, Bite, Spread Shot, Ghost Eye's {C}
  "fix-lightning-energy": 8, // {L}{L}{L} — two Needle Crushes' worth
  "fix-psychic-energy": 5, // {P} — Ghost Eye's typed half, Pour Tea, and Dominating Echo's half
  "fix-dark-energy": 2, // {D} — the other half of Dominating Echo, the LOUD witness's cost
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
});

export const DEFENDER_LOCK_DECK = deckOf({
  "sv03-042": 4, // Eiscue ex — "Scalding Block" idx 0: the compound, and it PARKS
  "sv03-134": 4, // Houndoom ex — "Evil Claw" idx 0 (the gate), "Hound's Fang" idx 1 (control)
  "sv01-048": 4, // Alomomola — the BASIC victim: "Surf" idx 0, "Aqua Slash" idx 1 (self-lock)
  "fix-mola-stage1": 3, // evolves from Alomomola — the §10 clear AND the non-Basic victim
  "sv01-194": 3, // Switch (Item) — the victim's other route out of the window
  "sv02-172": 2, // Boss's Orders — the installer dragging a Basic up before Evil Claw
  "fix-attacker": 3, // Bite ({C}, 30) and Yawn (costless, Asleep) — the §12 control
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-water-energy": 12, // {W}{W}{W} for Scalding Block; {W} for Surf, Aqua Slash and Bubble
  "fix-dark-energy": 8, // {D}{D} for Evil Claw, {D}{D}{D} for Hound's Fang
  "fix-energy": 13, // Colorless Basic — every {C} in the deck
});

export const BARE_ATTACK_LOCK_DECK = deckOf({
  "fix-lockplural": 4, // "During your next turn, this Pokémon can't use attacks." at INDEX 1
  "fix-deflock": 4, // the defender lock in BOTH verbs — "can't attack" idx 0, "can't use attacks" idx 1
  "fix-attacker": 4, // the victim: costless "Yawn" (idx 2) and "Bite" (idx 0), so a refusal is the LOCK
  "fix-energy": 16, // Basic {C} — pays every printed cost in this deck
  "fix-titan": 32, // 340 HP neutral Basic, NO attacks — DOMINANT (mulligan-free), filler and promote target
});

export const COMPOUND_COMPOSE_DECK = deckOf({
  "fix-compound": 8,
  "fix-attacker": 4, // "Bounty" (idx 5) prints the LEADING clause of two of them ALONE
  "fix-energy": 16,
  "fix-fire-energy": 4, // Basic {R} — pays {C} too, so it costs the boards nothing
  "fix-titan": 28, // 340 HP neutral Basic, NO attacks — DOMINANT (mulligan-free) filler
});

export const ATTACK_DEBUFF_DECK = deckOf({
  "sv02-062": 4, // Pikachu — "Growl" idx 0 (the 20) AND "Pika Bolt" idx 1 (the main-hit attacker)
  "swsh10.5-061": 4, // Pidove — "Growl" idx 0 (the 20 again), ×2 Lightning / −30 Fighting
  "sv01-093": 2, // Florges — "Moonblast" idx 0 (the 30), and Blooming Garden
  "sv06.5-008": 4, // Houndoom — "Snarl" idx 1 (the 100), ×2 Water, "Bite" idx 0
  "sv01-048": 4,
  "fix-mola-stage1": 2, // evolves from Alomomola — the §10 evolve clear as a played line
  "sv03-030": 2, // Entei — 130 HP, "Blaze Ball", and the always-on member kept LOUD
  "sv01-069": 2, // Rotom — "Linear Attack": the snipeActive site
  "fix-sniper": 2, // "Spread Shot" (30 + 20 to each benched): the spreadDamage site
  "fix-bramble": 2, // the per-40 benched `deals` snipe: placeSnipe's damage arm
  "sv01-193": 2, // Rocky Helmet (Tool) — the `dealt > 0` boundary, from both sides
  "sv01-194": 2, // Switch (Item) — the victim's own route out of the window
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-energy": 13, // Colorless — every {C} slot in the deck
  "fix-fire-energy": 3, // {R} — Snarl's typed half
  "fix-water-energy": 4, // {W} — Surf, Aqua Slash and the evolution's Bubble
  "fix-lightning-energy": 3, // {L} — Pika Bolt's typed half
  "fix-psychic-energy": 2, // {P} — Moonblast's typed half
});

export const PRESSURE_DECK = deckOf({
  "sv03-030": 2, // Entei — "Pressure" (the aura) and "Blaze Ball" idx 0 ({C}{C}{C}, 60+)
  "sv02-062": 2,
  "sv01-048": 2, // Alomomola — "Surf" idx 0 ({W}{C}, 30): the ×2-Water board
  "sv02-127": 2, // Ting-Lu ex — "Cursed Land" (the §9 lock) + "Land Scoop" idx 0
  "sv01-069": 2, // Rotom — "Linear Attack" idx 0 ({C}, opponentAny 20): snipeActive
  "fix-feint": 2, // "Feint Attack" idx 0 ({C}, 50, ignoreWR): the coincident-body site
  "fix-sniper": 2, // "Spread Shot" ({C}, 30 + 20 to each benched): spreadDamage
  "fix-bramble": 4, // the per-40 benched `deals` snipe: placeSnipe's damage arm
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-energy": 28, // Colorless — every {C} slot in the deck
  "fix-fighting-energy": 5, // {F} — Land Scoop's three
  "fix-lightning-energy": 3, // {L} — Pika Bolt's typed half
  "fix-water-energy": 3, // {W} — Surf's typed half
});

export const INSTALLED_RECOIL_DECK = deckOf({
  "sv02-117": 3, // Lycanroc ex — "Scary Fangs" idx 1 (the armer), "Rock Throw" idx 0
  "fix-attacker": 4, // "Bite" ({C}, 30); 120 HP = the armed 100 + Rocky Helmet's 20
  "sv01-193": 2, // Rocky Helmet (Tool) — the CATALOG half of the §9 sum
  "sv01-005": 2, // Cacnea — Counterattack Quills (3 counters), the always-on control
  "sv02-062": 2, // Pikachu — "Growl" idx 0 (no printed damage): the outer gate
  "sv02-172": 2, // Boss's Orders — the opponent's §10 leave-Active route
  "sv01-194": 2, // Switch (Item) — the holder's own route, outside the window
  "sv01-048": 2, // Alomomola — a real pre-evolution, for the §10 EVOLVE clear
  "fix-mola-stage1": 2,
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-energy": 28, // Colorless — every {C} slot in the deck
  "fix-fighting-energy": 6, // {F} — Scary Fangs's and Rock Throw's typed half
  "fix-lightning-energy": 2, // {L} — Pika Bolt's typed half
});

export const PER_ATTACK_LOCK_DECK = deckOf({
  "sv03-142": 3, // Skarmory — "Slashing Steel" idx 1 (the bar), "Peck" idx 0 (still legal)
  "sv06.5-037": 2, // Munkidori ex — "Dirty Headbutt" idx 0: the ONE-attack control
  "sv03-179": 2, // Greedent ex — "Slip 'n' Roll" idx 1: the apostrophe capture
  "sv01-114": 2,
  "swsh10.5-018": 2, // Radiant Blastoise — "Torrential Cannon" idx 0: the uncatalogued one
  "fix-skarm-stage1": 2, // evolves from Skarmory — the §10 EVOLVE clear, on one attack
  "sv03-042": 2,
  "sv01-194": 2, // Switch (Item) — the holder's own §10 leave-Active route
  "sv02-172": 2, // Boss's Orders — the opponent's route into the same clear
  "fix-attacker": 2, // "Bite" ({C}, 30) — the opponent's plain swing
  "fix-curly-barrer": 2, // the U+2019 RE-INGEST, as a card — the install-side fold's witness
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-metal-energy": 6, // {M}{M} for Slashing Steel
  "fix-dark-energy": 4, // {D}{D} for Dirty Headbutt
  "fix-fighting-energy": 3, // {F} for Accelerating Stab and Avenging Knuckle
  "fix-water-energy": 6, // {W}{W}{W} for Scalding Block, {W}{W} for Torrential Cannon
  "fix-energy": 14, // Colorless Basic — every {C} in the deck
});

export const RADIANT_LOCK_DECK = deckOf({
  "swsh10.5-011": 4,
  "fix-titan": 10, // 340 HP neutral Basic, NO attacks — P2's Active and the bench filler
  "fix-fire-energy": 10, // {R} — Combustion Blast's first symbol
  "fix-energy": 36, // Colorless Basic — the {C}{C}{C}{C} behind it
});

export const PER_ATTACK_BUFF_DECK = deckOf({
  "sv03-052": 3,
  "fix-echoer": 3, // the constructed two-attack witness — the per-INDEX claim
  "fix-echoer-stage1": 2, // evolves from fix-echoer — the §10 EVOLVE clear, on one attack
  "sv02-037": 4, // Skeledirge ex — 340 HP, ×2 Water: the pre-W/R ORDER board
  "sv03-142": 2,
  "sv01-194": 2, // Switch (Item) — the holder's own §10 leave-Active route
  "sv02-172": 4, // Boss's Orders — the opponent's route into the same clear
  "sv01-197": 2, // Vitality Band (Tool) — the CATALOG half of the same `bonus` field
  "fix-booster-ability": 2, // a §9-SUPPRESSIBLE printed +30: the fold-vs-second-term board
  "sv02-127": 2, // Ting-Lu ex — "Cursed Land", the §9 Ability lock that switches it off
  "fix-curly-booster": 2,
  "fix-attacker": 3, // "Bite" ({C}, 30) — the opponent's plain swing, and the damage source
  "fix-titan": 6, // 340 HP neutral Basic, NO attacks — bench filler and KO boundary
  "fix-water-energy": 16, // {W}{W} for Echoed Voice and Echo Chorus, ×3 for the retreat
  "fix-energy": 7, // Colorless Basic — every {C} in the deck
});

export const OPPONENT_ATTACK_LOCK_DECK = deckOf({
  "sv02-094": 3, // Oranguru — "Plotter's Command" idx 0 (the barrer), "Super Psy Bolt" idx 1
  "sv01-111": 2,
  "fix-attacker": 4, // FOUR attacks — the park, and the body the headline boards bar
  "fix-echoer": 3, // TWO attacks — the park's floor, and the §10 EVOLVE route's base
  "fix-echoer-stage1": 2, // evolves from fix-echoer — ONE attack: the FORCED ending
  "sv01-194": 3, // Switch (Item) — the VICTIM's own §10 leave-Active route
  "sv02-172": 3, // Boss's Orders — the INSTALLER's route into the same clear
  "fix-titan": 6, // 340 HP, NO attacks — the SILENT ending, bench filler, promote target
  "fix-psychic-energy": 8, // {P} for Plotter's Command and Super Psy Bolt
  "fix-fighting-energy": 4, // {F} for Acu-Punch-Ture
  "fix-water-energy": 8, // {W}{W} for Echo Tap / Echo Chorus / Ripple
  "fix-energy": 14, // Colorless Basic — every {C} in the deck
});

export const VENGEFUL_PUNCH_DECK = deckOf({
  "sv03-197": 4,
  "sv01-193": 2, // Rocky Helmet — the DAMAGE-conditioned sibling, at the other read site
  "fix-attacker": 4, // "Bite" ({C}, 30) idx 0; "Yawn" idx 2 (no damage) — 120 HP
  "fix-sniper": 3, // "Spread Shot" ({C}, 30 + 20 to each bench) idx 0 — the BENCH KO
  "fix-wall": 6, // 120 HP, no attacks — the holder, on the Active spot or the bench
  "fix-bigbody": 24, // 200 HP — DOMINANT setup Basic, the surviving holder, promote target
  "fix-titan": 3,
  "fix-trainerops": 2,
  "fix-energy": 12, // Colorless Basic Energy — pays Bite's, Spread Shot's and Slip Away's {C}
});

export const MUNKIDORI_DECK = deckOf({
  "sv06.5-037": 4,
  "sv06.5-039": 3, // Pecharunt ex — the printed board condition, matched by NAME
  "sv02-126": 2, // Glimmora — the on-KO sibling that must NOT acquire the cause gate
  "sv01-118": 2, // Hawlucha — "Flying Entry": the MID-TURN, NON-ATTACK KO vehicle
  "fix-koprize": 2, // FIXTURE — the same reduction on a 1-Prize body (the clamp)
  "fix-attacker": 4, // "Bite" ({C}, 30) idx 0; "Yawn" idx 2 (no damage) — 120 HP
  "fix-sniper": 3, // "Spread Shot" ({C}, 30 + 20 to each bench) idx 0 — the BENCH KO
  "fix-bigbody": 24, // 200 HP — DOMINANT setup Basic, promote target, spread-proof
  "fix-titan": 4, // 340 HP, no attacks — bench filler a 20 spread cannot KO
  "fix-energy": 12, // Colorless Basic Energy — pays Bite's and Spread Shot's {C}
});

export const EXP_SHARE_DECK = deckOf({
  "sv01-174": 4,
  "sv01-193": 2, // Rocky Helmet — a Tool with a `passive` and no trigger: the scan's negative
  "sv01-096": 2, // Klefki — "Mischievous Lock": a §9 aura that must NOT reach a Tool
  "fix-victim": 4, // 30 HP, no attacks — the DYING ACTIVE that Bite one-shots
  "fix-attacker": 4, // "Bite" ({C}, 30) idx 0; "Yawn" idx 2 (no damage) — 120 HP
  "fix-sniper": 2, // "Spread Shot" ({C}, 30 + 20 each bench) — kills the Active AND hurts the holder
  "sv02-097": 2, // Mimikyu — "Ghost Eye": NO printed damage, 7 counters. The seed-gate witness
  "fix-titan": 4, // 340 HP, no attacks — bench filler / a second holder
  "fix-special": 4, // Special Energy — what the printed "a Basic Energy" refuses
  "fix-fire-energy": 4, // a SECOND Basic Energy type, so the pick is a real choice
  "fix-psychic-energy": 4, // {P} — Ghost Eye's typed half
  "fix-energy": 12, // Colorless Basic Energy — pays Bite's and Spread Shot's {C}
  "fix-bigbody": 12, // 200 HP — DOMINANT setup Basic, the Tool HOLDER, promote target
});

export const LEGACY_PRIZE_DECK = deckOf({
  "fix-legacy-energy": 4, // Legacy Energy — the wildcard + the capped reduction
  "fix-lillies-pearl": 4, // Lillie's Pearl — the same reduction on a TOOL
  "fix-lillie-body": 4, // "Lillie's Clefairy", 70 HP, 1 Prize — the gated holder
  "fix-legacy-ex": 4, // "Lillie's Clefable ex", 260 HP, 2 Prizes — the decrement
  "fix-pearl-nobody": 4, // "Clefairy", 70 HP — the owner gate's near miss
  "sv02-126": 2, // Glimmora — the on-KO Prize GUARD this must compose with
  "sv06.5-037": 2,
  "sv06.5-039": 2, // Pecharunt ex — Munkidori's printed board clause, by NAME
  "sv01-193": 2, // Rocky Helmet — the ONLY way to kill the ATTACKER on its own
  //   sweep, which is the board the printed possessive ("from your OPPONENT'S
  //   Pokémon") is the whole content of: `finishAttack` passes BOTH seats.
  "fix-attacker": 4, // "Bite" ({C}, 30) idx 0; "Yawn" idx 2 (no damage) — 120 HP
  "fix-titan": 2, // 340 HP, no attacks — bench filler
  "fix-energy": 12, // Colorless Basic Energy — pays Bite's {C}
  "fix-bigbody": 14, // 200 HP — DOMINANT setup Basic, promote target
});

export const ATTACKER_FILTER_DECK = deckOf({
  "sv01-099": 3, // Dachsbun — "Well-Baked Body" ({R}); its Burn-immunity clause stays LOUD
  "sv03-078": 3, // Bellibolt — "Insulator" ({L})
  "sv03-201": 2, // Bellibolt (Illustration rare) — the reprint, for the id-keyed claim
  "sv03-070": 3, // Thundurus — "Adverse Weather" (Active shields the BENCH)
  "sv06.5-060": 4, // Neutralization Zone (Stadium, ACE SPEC) — both boards, no Rule Box, ex/V
  "fix-attacker": 3, // FIRE, no rule box — Dachsbun's match / Bellibolt's + the Stadium's miss
  "sv02-063": 3, // Pikachu ex — LIGHTNING *and* an ex: Bellibolt's match + the Stadium's attacker
  "fix-attacker-ex": 3, // FIRE ex — "Spread Shot" idx 1 reaches the whole opposing board
  "fix-attacker-vmax": 2, // a rule box that is NOT ex/V — the predicate-separating board
  "fix-sniper": 3, // FIRE, no rule box — the spread Thundurus's shield answers
  "fix-feint": 3, // LIGHTNING, `ignoreWR` — the on-target / off-target pair, one attack
  "sv06.5-038": 3, // Fezandipiti ex — the only ex with an `opponentAny` snipe
  "sv01-069": 3, // Rotom — its LIGHTNING, no-rule-box counterpart
  "sv02-127": 3, // Ting-Lu ex — "Cursed Land" (§9) and an ex, on one body
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 4, // 200 HP neutral Basic — the no-Rule-Box body the Stadium protects
  "fix-fighting-energy": 5, // {F}{F}{F} — Land Scoop's cost, and nothing else in the deck
  "fix-energy": 7, // Colorless Basic — every other cost here
});

export const ALWAYS_ON_REDUCTION_DECK = deckOf({
  "sv02-113": 4, // Hariyama — "Arm Thrust Practice" (10 seat-wide); {F}, Stage 1, ×2 Psychic
  "sv01-192": 4, // Rock Chestplate (Tool) — 30, gated on the HOLDER's {F}
  "sv01-139": 3, // Forretress — "Rolling Shell" idx 1 ({M}{C}{C}, 90): the INSTALLED 50, ×2 Fire, METAL
  "fix-attacker": 3, // FIRE — Bite idx 0 ({C}, 30) and Flame idx 1 ({R}{C}, 60): the main hit
  "fix-sniper": 3, // "Spread Shot" idx 0 ({C}, 30 + 20 each benched): the spreadDamage site
  "sv01-069": 3, // Rotom — "Linear Attack" idx 0 ({C}, opponentAny 20, deals): both snipe arms
  "fix-feint": 3, // "Feint Attack" idx 0 ({C}, opponentAny 50, ignoreWR): the per-board split
  "sv02-127": 3, // Ting-Lu ex — "Cursed Land" (§9) and "Land Scoop" idx 0 ({F}{F}{F}, 150)
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 3, // 200 HP neutral Basic — a Colorless body the seat aura still protects
  "fix-fighting-energy": 6, // {F}{F}{F} — Land Scoop, and Rocket Slap's typed half
  "fix-fire-energy": 3, // {R} — Flame's typed half
  "fix-metal-energy": 3, // {M} — Rolling Shell's typed half
  "fix-energy": 16, // Colorless Basic — every other cost in the deck
});

export const SELF_SCALING_PENALTY_DECK = deckOf({
  "sv01-060": 4,
  "sv02-037": 4, // Skeledirge ex — "Burning Voice" idx 1 (TEN), and the ×2 Water 340 HP defender
  "sv03-030": 2, // Entei — "Pressure": the other source of the same `debuff` field
  "sv02-127": 2, // Ting-Lu ex — "Cursed Land", the §9 lock an attack's own text escapes
  "sv01-197": 2, // Vitality Band (Tool) — the ADDING half inside the same clamp
  "fix-attacker": 2, // "Rage" idx 3 / "Fury" idx 4 — the MORE twin on the same count source
  "fix-titan": 10, // 340 HP neutral Basic, NO attacks — starter, bench filler, clean defender
  "fix-water-energy": 8, // {W} — Sweeping Tackle's typed symbol
  "fix-fire-energy": 8, // {R}{R} — Burning Voice
  "fix-energy": 18, // Colorless Basic — every {C} in the deck
});

export const SELF_COUNTER_MULTIPLY_DECK = deckOf({
  "sv01-089": 4,
  "swsh10.5-036": 4,
  "sv01-060": 2, // Cetitan — "Sweeping Tackle": the LESS twin on the same count source
  "fix-attacker": 2, // "Rage" idx 3 / "Fury" idx 4 — the MORE twin on the same count source
  "fix-psychic-weak": 2, // 200 HP, ×2 Psychic — the pre-W/R ORDER board for Balloon Blast
  "fix-titan": 12, // 340 HP neutral Basic, NO attacks — starter, bench filler, clean defender
  "fix-psychic-energy": 8, // {P}{P} — Balloon Blast
  "fix-fighting-energy": 8, // {F}{F} — Raging Swing's typed symbols
  "fix-water-energy": 4, // {W} — Sweeping Tackle's typed symbol
  "fix-energy": 14, // Colorless Basic — every {C} in the deck
});

export const OPPONENT_COUNTER_DECK = deckOf({
  "sv01-095": 4,
  "sv03-086": 4, // Espeon — "Psychic Assault" idx 0: the SAME sentence, second card
  "sv06.5-025": 4, // Bloodmoon Ursaluna — "Mad Bite" idx 0: the THIRTY-per-counter one
  "sv03-066": 3, // Tyranitar ex — 340 HP ×2 Fighting: the pre-W/R ORDER witness
  "fix-titan": 10, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-psychic-energy": 8, // {P} — Second Bite, Psychic Assault, Psy Bolt
  "fix-fighting-energy": 8, // {F}{F} — Mad Bite's typed half
  "fix-energy": 19, // Colorless Basic — every {C} in the deck
});

export const OWN_BENCH_SPREAD_DECK = deckOf({
  "fix-tremor": 4, // the 10, both possessives, indices 0 and 1
  "sv01-117": 3, // Krookodile — "Earthquake" idx 1 ({F}{F}, 180 + 30 own bench)
  "swsh10.5-043": 3, // Tyranitar — "Earthquake" idx 1 ({D}{D}{C}{C}, 180 + 20 own bench)
  "fix-fighting-weak": 6, // 200 HP ×2 Fighting — the W/R witness and its Active control
  "fix-titan": 14, // 340 HP neutral Basic, NO attacks — filler, defender, un-KO-able body
  "fix-fighting-energy": 6, // {F}{F} — Krookodile's whole cost
  "fix-darkness-energy": 6, // {D}{D} — Tyranitar's typed half
  "fix-energy": 18, // Colorless — every {C} slot on this list
});

export const OWN_BENCH_SNIPE_DECK = deckOf({
  "fix-pinpoint": 4, // the three printed sentences, indices 0, 1 and 2
  "fix-fighting-weak": 6, // 200 HP ×2 Fighting — the W/R witness and its Active control
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — filler, defender, un-KO-able body
  "fix-onko": 6, // 30 HP — the body index 1's 40 Knocks Out in one hit, on either bench
  "fix-energy": 28, // Colorless — every {C} slot on this list
});

export const BENCH_COUNTER_DECK = deckOf({
  "swsh10.5-043": 4, // Tyranitar — "Raging Crash" idx 0: the whole family
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, damaged bench, clean defender
  "fix-darkness-weak": 3, // 200 HP ×2 Darkness — the base-drop-through-W/R board
  "fix-darkness-energy": 8, // {D}{D} — Earthquake's typed half, and nothing else
  "fix-energy": 29, // Colorless Basic — Raging Crash's whole cost, and every other {C}
});

export const STATUS_IMMUNITY_DECK = deckOf({
  "sv01-068": 3, // Pachirisu — "Electricity Pouches" ("can't be Paralyzed")
  "sv01-208": 2, // Pachirisu (Illustration rare) — the reprint, for the id-keyed claim
  "sv01-099": 3, // Dachsbun — "Well-Baked Body" ("can't be Burned" + the {R} prevention)
  "sv01-029": 3, // Scovillain — "Hot Bite" (idx 0, {C}, 20): the SEED-FREE Burn
  "fix-statuser": 4, // Hypnosis / Confuse Ray / Numbing Bolt / Toxic on one body
  "sv03-044": 3, // Armarouge — "Scorching Armor": the Burn that lands on the ATTACKER
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, Basic, both sides, Active-only)
  "sv02-127": 3, // Ting-Lu ex — "Cursed Land" (§9, damaged, opponent, Active-only)
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 17, // 200 HP neutral Basic — the NON-IMMUNE control, and the setup starter
  "fix-fighting-energy": 5, // {F}{F}{F} — Land Scoop's cost, and nothing else in the deck
  "fix-psychic-energy": 3, // {P} — Dachsbun's own "Headbutt Bounce" ({P}{C}{C}), the Armarouge board
  "fix-energy": 7, // Colorless Basic — Hot Bite, and Headbutt Bounce's two {C}
});

export const THERAPEUTIC_ENERGY_DECK = deckOf({
  "sv02-193": 4,
  "fix-statuser": 4, // Hypnosis / Confuse Ray / Numbing Bolt / Toxic on one body
  "sv01-029": 3, // Scovillain — "Hot Bite" ({C}, 20 + Burn): the condition NOT named
  "sv01-068": 3, // Pachirisu — the §9-SUPPRESSIBLE immunity, beside the exempt one
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, Basic, both sides, Active-only)
  "sv02-190": 2, // Jet Energy — the other on-attach Special, for the ordering claim
  "sv03-193": 2, // Poppy — the ONLY program that can MOVE a Special Energy (anyEnergy)
  "sv01-174": 2, // Exp. Share — a Tool with NO passive: the §7.4 moment, isolated
  "sv02-123": 2, // Garganacl "Blessed Salt" — a betweenTurns program, for the Checkup moment
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 24, // 200 HP neutral Basic — the control, and the setup starter
  "fix-energy": 7, // Colorless Basic — Hot Bite's cost, and the control attach
});

export const CLEAR_STATUS_DECK = deckOf({
  "sv01-086": 3, // Gardevoir ex — "Miracle Force" (idx 0, {P}{P}{C}, 190): the ATTACK half
  "sv01-228": 2, // Gardevoir ex (Ultra Rare) — the reprint, DRIVEN not just pinned
  "sv01-245": 2, // Gardevoir ex (Special illustration rare) — the second reprint
  "sv01-145": 3, // Blissey — "Busybody Nurse": the ABILITY half, benchable
  "fix-statuser": 4, // Hypnosis / Confuse Ray / Numbing Bolt / Overheat / Toxic on one body
  "sv01-096": 2, // Klefki — "Mischievous Lock" (§9, Basic, both sides, Active-only)
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 22, // 200 HP neutral Basic — the control, and the setup starter
  "fix-psychic-energy": 10, // Basic {P} — Miracle Force's {P}{P}
  "fix-energy": 8, // Colorless Basic — Miracle Force's {C}
});

export const KO_SURVIVAL_DECK = deckOf({
  "fix-sturdy": 6, // THE demonstrator — 120 HP Basic, the printed sentence
  "fix-sturdytiny": 2, // 20 HP twin — the CHECKUP-boundary witness
  "fix-koblast": 4, // the attacker: one attack per write site + the counter control
  "sv03-197": 3, // Vengeful Punch — damageAttackerOnKo: must go SILENT on a clamp
  "sv01-193": 3, // Rocky Helmet — damageAttacker: must STILL FIRE on the same hit
  "sv02-173": 2, // Bravery Charm — +50 HP on a Basic: the effectiveMaxHp witness
  "sv01-096": 2, // Klefki — Mischievous Lock: the §9 answer, driven not read
  "fix-titan": 3, // 340 HP, no attacks — bench filler
  "fix-bigbody": 22, // 200 HP — the dominant Basic, promote target, no-Ability control
  "fix-energy": 13, // Colorless Basic — every fix-koblast attack costs one {C}
});

export const COUNTER_MOVE_CHOSEN_DECK = deckOf({
  "fix-cofagrigus": 4, // THE attacker — both sentences, one index apart
  "fix-titan": 28, // 340 HP, no attacks — interchangeable bench filler, both seats
  "fix-bigbody": 8, // 200 HP — the NAMED destination whose damage is read
  "fix-victim": 4, // 30 HP — the destination a moved stack can KO
  "fix-energy": 16, // Colorless Basic — every fix-cofagrigus attack costs one {C}
});

export const TRAINER_OPS_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-basic-1": 14, // both Benches — the self-switch's and the gust's
  "fix-bigbody": 16, // 200 HP control body / setup starter
  "fix-energy": 24, // Colorless Basic — every attack here costs {C}
});

export const NEW_ACTIVE_DAMAGE_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-colorless-weak": 7, // 200 HP ×2 Colorless — the promoted body under W/R
  "fix-basic-1": 7,
  "fix-bigbody": 16, // 200 HP control body / setup starter
  "fix-energy": 24, // Colorless Basic — every attack here costs {C}
});

export const SELF_ENERGY_MOVE_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-basic-1": 14,
  "fix-bigbody": 16, // 200 HP control body / setup starter
  "fix-energy": 20, // Colorless Basic — every attack here costs {C}
  "fix-special": 4, // the `basicEnergy` filter's only discriminator
});

export const SPREAD_ENERGY_MOVE_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-basic-1": 14,
  "fix-bigbody": 16, // 200 HP control body / setup starter
  "fix-energy": 16, // Colorless Basic — every attack here costs {C}
  "fix-metal-energy": 8, // the `providesEnergy {Metal}` filter's only discriminator
});

export const OPPONENT_ENERGY_MOVE_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-basic-1": 18, // the Bench population on BOTH boards — sources and destinations
  "fix-bigbody": 12, // 200 HP control body / setup starter, both seats
  "fix-energy": 18, // Colorless Basic — every attack here costs {C}, and the Energy that moves
  "fix-mist-energy": 6, // the §11 shield, and a movable {C} Energy in its own right
});

export const BENCH_SEARCH_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-charjabug": 6, // the `byName` arm's only candidates — and NOT Basic
  "fix-basic-1": 18, // the `basicPokemon` arm's candidates and the Bench population
  "fix-bigbody": 12, // 200 HP control body / setup starter
  "fix-energy": 18, // Colorless Basic — every attack here costs {C}
});

export const HAND_SEARCH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 14, // `anyPokemon`'s candidates and the setup starters
  "fix-energy": 16, // Colorless Basic — `basicEnergy` AND `anyEnergy`
  "fix-special": 4, // `anyEnergy` ONLY — the pair that separates the two
  "fix-item": 6, // `item`'s only candidates
  "fix-tool": 6, // `toolCard` — and what `item` must refuse
  "fix-gatedsup": 4, // `supporter`
  "fix-stadium": 4, // `stadium`
});

export const OPPONENT_HAND_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 18, // the setup starters and the Bench population
  "fix-energy": 20, // Colorless Basic — every attack here costs {C}
  "fix-item": 4, // the four lines below exist to be TOLD APART in a hand
  "fix-tool": 4,
  "fix-gatedsup": 4,
  "fix-stadium": 4,
});

export const DISCARD_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 16, // the setup starters and the Benched targets
  "sv03-161": 2, // Drampa — the ONLY Dragon body, for the {N} destination
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — every attack's cost AND the untyped pile
  "fix-fighting-energy": 8, // {F} — Regi Charge's filter
  "fix-fire-energy": 4, // {R} — Dragon's Fury's filter
  "fix-water-energy": 4, // the type BOTH typed filters must refuse
});

export const DECK_SEARCH_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 16, // the setup starters and the Benched targets
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — every attack's cost AND the untyped searches
  "fix-water-energy": 6, // {W} — Aqua Supply's and Water Draw's filter
  "fix-lightning-energy": 6, // {L} — Zap Charge's and Bench Charge's filter
  "fix-darkness-energy": 6, // {D} — Toxic Reserve's filter, and NOTHING else's
});

export const TWO_NOUN_SEARCH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 16, // the setup starters and the Benched targets
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — the attack's cost, and NEITHER noun's filter
  "fix-grass-energy": 6, // {G} — Split Harvest's FIRST printed noun
  "fix-lightning-energy": 6, // {L} — Split Harvest's SECOND printed noun
  "fix-water-energy": 6, // {W} — named by NEITHER noun, so the filters are falsifiable
});

export const HAND_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 16, // the setup starters and the Benched targets
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — every attack's cost AND the untyped attaches
  "fix-psychic-energy": 9, // {P} — Full Heart's filter
  "fix-grass-energy": 9, // {G} — Leaflet Blessings' filter, and NOTHING else's
});

export const DERIVED_RETRIEVAL_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 8, // the setup starters and the Bench population (5 seatable)
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 8, // Colorless Basic — every attack's cost, and `energyType`'s near miss
  "fix-duskull": 7, // Duskull — the `byName` target, deep enough to bench three
  "fix-charjabug": 3,
  "fix-water-basic": 4, // Basic {W} — "up to 3 {W} Pokémon", deep enough to bench three
  "fix-dual-basic": 3, // ["Fire","Water"] — the `includes`-not-`types[0]===` witness
  "fix-grass-energy": 4, // Basic {G} — "a Basic {G} Energy card"
  "fix-water-energy": 3, // Basic {W} — a typed Energy of the WRONG type, beside the Colorless one
  "fix-gatedsup": 3, // Supporter — one of the four Trainer subtypes
  "fix-item": 3, // Item
  "fix-tool": 3, // Pokémon Tool
  "fix-stadium": 3, // Stadium — with the three above, `trainerCard` has 4 subtypes
});

export const DERIVED_LOOK_TOP_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 19, // the Bench population, the starters, and the attach window's non-Energy
  "fix-bigbody": 3, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 16, // Colorless Basic — every attack's cost, `anyEnergy`'s basic half, and
  //                   the bench window's NON-Pokémon filler
  "fix-special": 8,
  "fix-duskull": 8, // a second named Pokémon line, so "any number of Pokémon" is not one id
});

export const FIRST_TURN_SUPPORTER_DECK = deckOf({
  "fix-carmine": 4,
  "sv01-180": 4, // Nemona — the ordinary Supporter, the control
  "fix-bigbody": 20,
  "fix-energy": 32,
});

export const NS_PLAN_DECK = deckOf({
  "fix-nsplan": 4,
  "sv03-193": 4, // Poppy — the single-source control, same op, same max
  "fix-basic-1": 12,
  "fix-basic-2": 8,
  "fix-energy": 16,
  "fix-fire-energy": 8,
  "fix-water-energy": 8,
});

export const SEAT_AURA_DECK = deckOf({
  "fix-regalcheer": 8,
  "fix-cynthia-aura": 8,
  "fix-cynthia-body": 8,
  "fix-hop-aura": 8,
  "fix-plain-body": 8,
  "sv01-096": 4,
  "fix-basic-1": 8,
  "fix-energy": 8,
});

export const BENCH_SWITCH_DECK = deckOf({
  "fix-rapidvernier": 8,
  "fix-showtime": 8,
  "fix-switch-ally": 8,
  "fix-plain-body": 8,
  "fix-othersmove": 4, // the CONSTRUCTED demonstrator that separates othersToSelf from benchToActive
  "sv01-096": 4,
  "fix-basic-1": 8,
  "fix-energy": 8,
  "fix-special": 4, // the SPECIAL Energy that makes `anyEnergy` distinguishable from `basicEnergy`
});

export const AURA_NARROWING_DECK = deckOf({
  "fix-sunnyday": 6,
  "fix-victorycheer": 6,
  "fix-primalknowledge": 5,
  "fix-grass-attacker": 5,
  "fix-fire-stage1": 5,
  "fix-grass-stage1": 5,
  "fix-plain-body": 5,
  "fix-metallicsignal": 5,
  "fix-metal-stage1": 5,
  "sv01-096": 3,
  "fix-basic-1": 5,
  "fix-energy": 5,
});

export const ROW14_DECK = deckOf({
  "fix-powersaver": 8,
  "fix-tr-body": 12,
  "fix-not-tr-body": 8,
  "fix-seasoned": 6,
  "fix-tr-energy": 6,
  "sv01-096": 3, // Klefki — "Mischievous Lock": the §9 witness the CHANNEL claim needs
  "fix-basic-1": 9,
  "fix-energy": 8,
});

export const GATED_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 14, // the setup starters and the bodies the switch offers
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — every attack's cost, and the typed filter's near miss
  "fix-lightning-energy": 12, // {L} — Return Charge's printed filter
  "fix-special": 8, // the SPECIAL Energy only the printed bare noun can reach
});

export const ANY_NUMBER_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 14, // the setup starters and the three Bench bodies the attach may reach
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 22, // Colorless Basic — the attack's cost AND the cards the attach offers
  "fix-special": 8, // the SPECIAL Energy the printed "Basic" must NOT offer
  "fix-tool": 8, // a non-Energy the hand can hold, so the filter has a second near miss
});

export const CAPTIVATING_INVITATION_DECK = deckOf({
  "fix-captivatinginvitation": 6, // the Ability holder — benched AND active boards
  "fix-invitee": 6, // the opponent's Bench body the gust drags up
  "fix-incumbent": 6, // the opponent's starting Active, which must stay unconfused
  "fix-trainersearch": 6, // the Supporter under test
  "fix-tool": 6, // a Trainer the search MUST offer (Tool)
  "fix-item": 6, // a Trainer the search MUST offer (Item)
  "fix-basic-1": 12, // the setup starters, and a NON-Trainer the search must refuse
  "fix-energy": 12, // Colorless Basic — attack costs, and the other non-Trainer
});

export const LISIAS_APPEAL_DECK = deckOf({
  "fix-lisiasappeal": 6, // the Supporter under test
  "sv02-172": 6, // Boss's Orders — the SAME gust with no rider (attribution control)
  "fix-invitee": 6, // the BASIC on the opponent's Bench — must be offered
  "fix-evolvedinvitee": 6, // the STAGE 1 beside it — must NOT be offered
  "fix-incumbent": 6, // the opponent's starting Active, which must stay unconfused
  "fix-basic-1": 12, // the setup starters for both seats
  "fix-plain-body": 6, // p1's own board, so no seat runs short of bodies
  "fix-energy": 12, // Colorless Basic — attack costs and retreat
});

export const DRAYTON_WINDOW_DECK = deckOf({
  "fix-drayton": 6, // the Supporter under test
  "sv02-183": 6, // Great Ball — the SAME look with no `also` (attribution control)
  "fix-basic-1": 12, // Pokémon #1 — window fodder AND both seats' setup starters
  "fix-basic-2": 6, // Pokémon #2 — the second admissible Pokémon the cap must refuse
  "fix-item": 6, // Trainer #1 (Item)
  "sv01-189": 6, // Trainer #2 (Supporter) — the second Trainer the cap must refuse
  "fix-energy": 18, // NEITHER kind — what the union itself has to refuse
});

export const ROTO_STICK_DECK = deckOf({
  "fix-rotostick": 6, // the Item under test
  "sv01-186": 6, // Pokégear 3.0 — the SAME filter at a NUMERIC cap (attribution control)
  "sv01-189": 12, // a Supporter — what the filter admits, and the window fodder
  "fix-item": 6, // a Trainer that is NOT a Supporter — the filter's refusal witness
  "fix-basic-1": 12, // both seats' setup starters, and a non-Trainer in the window
  "fix-energy": 18, // neither a Trainer nor a Supporter
});

export const BUG_CATCHING_DECK = deckOf({
  "fix-bugcatchingset": 6, // the Item under test
  "sv02-183": 6, // Great Ball — the same look, a WIDER filter (attribution control)
  "fix-grass-basic": 6, // {G} Pokémon, Basic — admitted
  "fix-grass-stage1": 6, // {G} Pokémon, STAGE 1 — admitted; the printed noun has no stage
  "fix-grass-energy": 6, // Basic {G} Energy — admitted
  "fix-basic-1": 12, // COLORLESS Pokémon — refused by `{G}`; also both seats' starters
  "fix-energy": 6, // Basic COLORLESS Energy — refused by `{G}` on the other member
  "fix-special": 6, // SPECIAL Energy — refused by the printed "Basic"
  "fix-item": 6, // neither kind — what the union itself refuses
});

export const ETHANS_ADVENTURE_DECK = deckOf({
  "fix-ethansadventure": 6, // the Supporter under test
  "sv01-172": 6, // Energy Search — the same op, an UNTYPED Energy filter (attribution control)
  "fix-ethans-cyndaquil": 6, // Ethan's Pokémon, BASIC — admitted
  "fix-ethans-typhlosion": 6, // Ethan's Pokémon, STAGE 2 — admitted; the printed noun has no stage
  "fix-ethans-pichu": 6, // Ethan's Pokémon, {L} — admitted; the noun is owner-narrowed, not type-narrowed
  "fix-fire-energy": 6, // Basic {R} Energy — admitted
  "fix-plain-cyndaquil": 6, // {R} Pokémon, NO prefix — refused by "Ethan's"; also a setup starter
  "fix-grass-energy": 6, // Basic {G} Energy — refused by the printed {R}
  "fix-special": 6, // SPECIAL Energy — refused by the printed "Basic"
  "fix-tr-energy": 6, // an owner-prefixed NON-Pokémon — refused by BOTH members
});

export const EXPLORERS_GUIDANCE_DECK = deckOf({
  "fix-explorersguidance": 6, // the Supporter under test
  "sv02-183": 6, // Great Ball — the same op, all four fields different (attribution control)
  "fix-basic-1": 12, // Pokémon — both seats' starters, and Great Ball's ONLY candidates
  "sv01-189": 6, // a Supporter — a non-Pokémon `anyCard` admits
  "fix-item": 6, // an Item — a third card class in the window
  "fix-energy": 24, // Energy — the fourth class, and the tail the no-shuffle case reads
});

export const LEFTOVERS_DESTINATION_DECK = deckOf({
  "fix-drakloak": 4, // Drakloak "Recon Directive" — the ABILITY under test
  "fix-rika": 4, // Rika — the Supporter under test
  "sv02-183": 4, // Great Ball — no leftovers clause, and it DOES shuffle (control)
  "fix-explorersguidance": 4, // Explorer's Guidance — the OTHER `restTo` value (control)
  "fix-basic-1": 12, // Pokémon — both seats' starters, and Great Ball's only candidates
  "sv01-189": 4, // a Supporter — a non-Pokémon `anyCard` admits
  "fix-item": 4, // an Item — a third card class in the window
  "fix-energy": 24, // Energy — the fourth class, and the readable tail
});

export const MULTI_NOUN_SEARCH_DECK = deckOf({
  "fix-larrysskill": 4, // Larry's Skill — the THREE-noun Supporter under test
  "fix-secretbox": 4, // Secret Box — the FOUR-noun Item under test
  "sv06.5-096": 4, // Earthen Vessel — the SAME op with no `also` (attribution control), and Item #2
  "fix-basic-1": 12, // Pokémon #1 — a noun BOTH caps, and both seats' setup starters
  "fix-basic-2": 4, // Pokémon #2 — the second admissible Pokémon Larry's cap must refuse
  "sv01-189": 4,
  "fix-item": 4, // Item #1 — Secret Box's first noun
  "fix-tool": 4, // the Pokémon Tool — Secret Box's second noun
  "fix-stadium": 4, // the Stadium — Secret Box's fourth noun
  "fix-energy": 12, // Basic Energy #1 — Larry's third noun, plus attack costs and retreat
  "fix-fire-energy": 4, // Basic Energy #2 — the second admissible Energy Larry's cap must refuse
});

export const UNDAMAGED_BONUS_DECK = deckOf({
  "fix-mabosstiff": 4,
  "fix-damagedbonus": 4,
  "fix-benchfiller": 4,
  "fix-bigbody": 8,
  "fix-dark-energy": 12,
  "fix-energy": 28,
});

export const UNTIL_LEAVES_ACTIVE_DECK = deckOf({
  "fix-gougingfire": 4, // "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot." at INDEX 1
  "fix-gouging-stage1": 2, // the evolve route's Stage 1 — ONE attack, so a stale index points at nothing
  "sv01-194": 3, // Switch (Item, switchActive) — the switchInto route on the holder's OWN board
  "fix-fire-energy": 10, // Basic {R} — {R}{R} of Blaze Blitz, {R} of Heat Blast, and the retreat
  "fix-energy": 13, // Basic {C} — the {C} of both costs, and the retreat
  "fix-titan": 28, // 340 HP neutral Basic, NO attacks — DOMINANT (mulligan-free), filler and promote target
});

export const OPPONENT_COUNTER_MULTIPLY_DECK = deckOf({
  "fix-glalie": 4, // "Damage Beat" idx 0 ({W}, "20×") — the sentence under test
  "fix-flapple": 4, // "Acidic Spit" idx 0 ({C}, "20×") — the SAME sentence, second card
  "sv01-095": 4, // Dedenne "Second Bite" — the ADDITIVE twin on the same count source
  "fix-water-weak": 2, // 200 HP, ×2 Water — the pre-W/R ORDER board for Damage Beat
  "fix-titan": 22, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-water-energy": 8, // {W} — Damage Beat, and the typed symbol of Crazy Headbutt
  "fix-psychic-energy": 4, // {P} — Second Bite's typed symbol
  "fix-grass-energy": 3, // {G} — Speed Dive's first symbol
  "fix-fire-energy": 3, // {R} — Speed Dive's second symbol
  "fix-energy": 6, // Colorless Basic — every {C} in the deck
});

export const DEFENDER_STATUS_TRIPLE_DECK = deckOf({
  "fix-oxford": 4, // the Oxford list — idx 0 (50), idx 1 (no damage), idx 2 (loud control)
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-energy": 40, // Colorless Basic — every cost here is {C}-only
});

export const FLIP_STATUS_ENERGY_DISCARD_DECK = deckOf({
  "fix-oxford": 4,
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — a clean defender that survives
  "fix-energy": 30, // Colorless Basic — every cost here is {C}-only
  "fix-water-energy": 10, // {W} — the SECOND distinguishable Energy, so the discard can park
});

export const SELF_DAMAGE_PER_COUNTER_DECK = deckOf({
  "fix-recoil-scale": 4,
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-energy": 40, // Colorless Basic — both costs here are {C}-only
});

export const DEFENDER_STATUS_PAIR_DECK = deckOf({
  "fix-ninetales": 4, // the bare pair — {R}{R} for 90
  "fix-tr-houndoom": 4, // the bare pair on a second body — {R}, no damage
  "fix-ekans": 4, // the flip pair — Confused+Poisoned
  "fix-glimmora": 4, // the flip pair — Paralyzed+Poisoned
  "fix-accelgor": 4, // the composed compound — pair + switch tail
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-fire-energy": 8, // {R} — Eerie Glow, Cruel Coal, Scorching Fire
  "fix-dark-energy": 4, // {D} — Poison Blend and Bite
  "fix-grass-energy": 4, // {G} — Poisonous Ploy's typed symbol
  "fix-fighting-energy": 2, // {F} — Venoshock's typed symbol
  "fix-energy": 6, // Colorless Basic — Stun Poison's {C} and Poisonous Ploy's
});

export const TAKE_PRIZE_DECK = deckOf({
  "fix-prizewheel": 8, // the attacker — indices 0 (30), 1 (130), 2 (none), 3 (skip control)
  "fix-wall": 4, // 120 HP, no attacks — the body index 1's 130 Knocks Out
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, bench, clean defender
  "fix-energy": 28, // Colorless Basic — every cost here, plus the surgery slack
  "fix-fire-energy": 4, // {R} — the SECOND energy type index 4 needs to PARK on a choice
});

export const NO_WEAKNESS_DECK = deckOf({
  "fix-nowk": 8, // the installer — idx 0 (the sentence), 1 (one-axis control), 2 (skip control)
  "fix-nowk-stage1": 4, // evolves from fix-nowk — the §10 EVOLVE clear
  "fix-bolt": 8, // {L}, printed 50 — the MAIN-HIT witness (100 unbarred / 50 barred)
  "sv01-069": 4, // Rotom "Linear Attack" ({C}, opponentAny 20, deals) — the snipeActive witness
  "sv01-194": 4, // Switch (Item) — the §10 FORCED-SWITCH clear, `interpreter.ts`'s literal
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, bench, clean defender
  "fix-energy": 16, // Colorless Basic — every cost here, plus the surgery slack
});

export const RETREAT_COST_PENALTY_DECK = deckOf({
  "fix-retreatless": 4, // the demonstrator — idx 0 (30 per {C}), 1 (50 per {C}), 2 (flat), 3 (loud)
  "fix-retreat0-titan": 3, // 340 HP, printed {} — the base-KEPT rung the multiply fold fails
  "fix-retreat1-titan": 3, // 340 HP, printed {C} — the rung a flat `per` is green on
  "fix-retreat2-titan": 3, // 340 HP, printed {C}{C} — the rung a hardcoded 2 is green on
  "fix-retreat3-titan": 3, // 340 HP, printed {C}{C}{C} — the rung that separates them
  "sv02-175": 2, // Calamitous Wasteland — the fold's ADDITIVE term (+1 on Basic non-{F})
  "sv01-167": 2, // Beach Court — the fold's SUBTRACTIVE term (-1 on Basic), the mirror
  "sv01-002": 2, // Heracross "Superpowered Throw" (10+, 30 MORE per {C}) — the additive twin
  "sv03-172": 2, // Stoutland "Chomp Chomp Panic" (50×) — the multiply twin, a Stage 2 (surgery)
  "fix-grass-energy": 4, // {G} — the first symbol of Superpowered Throw's cost, and nothing else
  "fix-energy": 16, // Colorless Basic — every other cost here, plus the surgery slack
  "fix-titan": 16, // 340 HP, printed retreat 4 — DOMINANT starter, bench filler, the FLOOR board
});
