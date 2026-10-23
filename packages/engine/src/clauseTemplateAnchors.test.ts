import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackDamageBonus } from "./effects";
import type { BoardCondition } from "./index";

const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

type Template = {
  /** The pattern constant's name in `effects.ts` — this file cannot import it
      (they are module-private, deliberately) so the name is carried as a label
      and the BEHAVIOUR is what gets asserted. */
  readonly pattern: string;
  readonly head: string;
  readonly token: string;
  readonly tail: string;
  readonly per: number;
  readonly printings: number;
  readonly cond: BoardCondition | null;
};

const TEMPLATES: readonly Template[] = [
  {
    pattern: "SELF_ENERGY_ATTACHED_CLAUSE",
    head: "this Pokémon has any ",
    token: "{L}",
    tail: " Energy attached",
    per: 80,
    printings: 1,
    cond: { kind: "yourActiveHasEnergyAttached", energy: "Lightning" },
  },
  {
    pattern: "OPPONENT_ACTIVE_TYPE_CLAUSE",
    head: "your opponent's Active Pokémon is a ",
    token: "{P}",
    tail: " Pokémon",
    per: 30,
    printings: 2,
    cond: { kind: "opponentActiveHasType", type: "Psychic" },
  },
  {
    pattern: "YOUR_BENCH_TYPE_CLAUSE",
    head: "you have any ",
    token: "{M}",
    tail: " Pokémon on your Bench",
    per: 80,
    printings: 2,
    cond: { kind: "yourBenchHasType", type: "Metal" },
  },
  {
    pattern: "OPPONENT_ACTIVE_RESISTANCE_CLAUSE",
    head: "your opponent's Active Pokémon has ",
    token: "{F}",
    tail: " Resistance",
    per: 50,
    printings: 2,
    cond: { kind: "opponentActiveHasResistance", type: "Fighting" },
  },
  {
    pattern: "OPPONENT_IN_PLAY_TYPE_CLAUSE",
    head: "your opponent has any ",
    token: "{W}",
    tail: " Pokémon in play",
    per: 120,
    printings: 1,
    cond: { kind: "opponentInPlayHasType", type: "Water" },
  },
];

const clauseOf = (t: Template): string => `${t.head}${t.token}${t.tail}`;

/** The bonus skeleton around a clause, spelled here rather than imported for
    `benchNamedBonus.test.ts`'s reason: the reader's own pattern is
    module-private and the point is to build the sentence from OUTSIDE it. */
const sentence = (clause: string, per: number): string =>
  `If ${clause}, this attack does ${per} more damage.`;

describe("§1 — every template answers its OWN printed sentence, and the fifth now has one", () => {
  it("each row's clause is PRINTED, at the stated number of legal printings", () => {
    for (const t of TEMPLATES) {
      const text = sentence(clauseOf(t), t.per);
      expect(
        corpus().filter(([, s]) => s === text),
        t.pattern,
      ).toHaveLength(1);
      expect(units(corpus().filter(([, s]) => s === text)), t.pattern).toBe(t.printings);
    }
    expect(TEMPLATES.reduce((sum, t) => sum + t.printings, 0)).toBe(8);
  });

  it("resolves to its OWN member — which is what 'no earlier pattern shadows it' means", () => {
    for (const t of TEMPLATES) {
      const got = deriveAttackDamageBonus(sentence(clauseOf(t), t.per));
      if (t.cond === null) {
        expect(got, t.pattern).toBeNull();
      } else {
        expect(got, t.pattern).toEqual({
          per: t.per,
          count: { kind: "boardCondition", cond: t.cond },
        });
      }
    }
  });

  it("the built rows land on FIVE DISTINCT members — no two shapes collapse", () => {
    const kinds = TEMPLATES.flatMap((t) => (t.cond === null ? [] : [t.cond.kind]));
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toHaveLength(5);
    expect(TEMPLATES).toHaveLength(5);
  });
});

describe("§2 — THE CROSS PRODUCT: no pattern's head reaches another pattern's tail", () => {
  it("refuses every head×tail hybrid — the four comments' invariant, executed", () => {
    let pairs = 0;
    for (const from of TEMPLATES) {
      for (const to of TEMPLATES) {
        if (from.pattern === to.pattern) continue;
        pairs += 1;
        const hybrid = `${from.head}${from.token}${to.tail}`;
        expect(deriveAttackDamageBonus(sentence(hybrid, from.per)), hybrid).toBeNull();
        // …and the hybrid is a CONSTRUCTED sentence, never a printed one, so a
        // refusal here can never be refusing something the catalog actually
        // prints (the failure mode a hand-written near-miss list has).
        expect(
          corpus().some(([, s]) => s === sentence(hybrid, from.per)),
          hybrid,
        ).toBe(false);
      }
    }
    expect(pairs).toBe(TEMPLATES.length * (TEMPLATES.length - 1));
    expect(pairs).toBe(20);
  });

  it("keeps the outer sentence anchors on every shape, not just on the ones with tests", () => {
    for (const t of TEMPLATES) {
      const clause = clauseOf(t);
      for (const text of [
        // Lowercase leading "if" — the matcher has no /i.
        `if ${clause}, this attack does ${String(t.per)} more damage.`,
        // No trailing period is not the whole sentence.
        `If ${clause}, this attack does ${String(t.per)} more damage`,
        // A real trailing clause pins `$`.
        `If ${clause}, this attack does ${String(t.per)} more damage. Then, draw a card.`,
        // Leading text pins `^`.
        `Flip a coin. If ${clause}, this attack does ${String(t.per)} more damage.`,
      ]) {
        expect(deriveAttackDamageBonus(text), text).toBeNull();
      }
    }
  });
});

describe("§3 — the MAP is the vocabulary, and the two maps do not leak into each other", () => {
  it("refuses a token that resolves in the OTHER token map", () => {
    for (const [clause, why] of [
      ["this Pokémon has any Colorless Energy attached", "a type name in the ENERGY clause"],
      ["this Pokémon has any {C} Energy attached", "the fallback code, kept out of the energy map"],
      ["this Pokémon has any Dragon Energy attached", "a type with no Basic Energy behind it"],
      ["your opponent's Active Pokémon is a Special Pokémon", "an energy CLASS as a body type"],
      ["you have any Special Pokémon on your Bench", "the same, one zone over"],
      ["your opponent's Active Pokémon has Special Resistance", "the same, one column over"],
      ["your opponent has any Special Pokémon in play", "the same, on D390's shape"],
    ] as const) {
      expect(deriveAttackDamageBonus(sentence(clause, 90)), why).toBeNull();
    }
  });

  it("refuses the catalog's OWN traps — real printed sentences, refused at the map", () => {
    for (const [text, cond] of [
      [
        "If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage.",
        { kind: "opponentActiveIsBanner", banner: "Tera" },
      ],
      [
        "If you have any Tera Pokémon on your Bench, this attack does 100 more damage.",
        { kind: "yourBannerPokemonOnBench", banner: "Tera" },
      ],
      [
        "If your opponent has any Future Pokémon in play, this attack does 120 more damage.",
        { kind: "opponentBannerPokemonInPlay", banner: "Future" },
      ],
      [
        "If you played a Future Supporter card from your hand during this turn, this attack does 100 more damage.",
        { kind: "yourPlayedBannerSupporterThisTurn", banner: "Future" },
      ],
      [
        "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.",
        { kind: "yourOtherBannerPokemonAttackedLastTurn", banner: "Ancient" },
      ],
    ] as const) {
      expect(
        corpus().some(([, s]) => s === text),
        text,
      ).toBe(true);
      expect(deriveAttackDamageBonus(text)?.count, text).toEqual({ kind: "boardCondition", cond });
    }
    for (const text of [
      "If 1 of your other Future Pokémon used an attack during your last turn, this attack does 150 more damage.",
    ]) {
      expect(
        corpus().some(([, s]) => s === text),
        text,
      ).toBe(false);
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });
});

describe("§4 — the LITERAL table is the one place ORDER decides something", () => {
  it("a clause a template ALSO matches still lands on its literal row", () => {
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsStage1" } },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.",
      ),
    ).toEqual({
      per: 140,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsStage2" } },
    });
    // Both are printed, so this rung is about the catalog and not about a
    // constructed collision.
    expect(
      units(
        corpus().filter(
          ([, s]) =>
            s ===
            "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
        ),
      ),
    ).toBe(1);
  });
});
