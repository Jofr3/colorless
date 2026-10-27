// GET /cards/index against GET /cards: the builder answers name and rules-text searches from the
// index in the browser (@colorless/schema `searchCardIndex`), so every query below must find the
// same cards in the same order, and each index row must read back as the brief GET /cards serves.

import {
  type CardBrief,
  type CardIndexPayload,
  cardIndexBrief,
  cardsQuerySchema,
  prepareCardIndex,
  searchCardIndex,
} from "@colorless/schema";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { CACHE_STATUS_HEADER } from "../httpCache";
import app from "../index";
import { useTestD1 } from "../testing/d1";
import { fakeRateLimit } from "../testing/rateLimit";
import { cardIndexStatements } from "./cardIndex";

type Row = {
  id: string;
  name: string;
  category: "Pokemon" | "Trainer" | "Energy";
  rarity?: string;
  types?: string[];
  hp?: number;
  mark?: string;
  stage?: string;
  trainerType?: string;
  energyType?: string;
  suffix?: string;
  illustrator?: string;
  legal?: [standard: 0 | 1, expanded: 0 | 1];
  effective?: [standard: 0 | 1, expanded: 0 | 1];
  abilities?: object[];
  attacks?: object[];
  effect?: string;
  image?: false;
};

const ROWS: Row[] = [
  {
    id: "sv01-001",
    name: "Charmander",
    category: "Pokemon",
    rarity: "Common",
    types: ["Fire"],
    hp: 70,
    mark: "G",
    stage: "Basic",
    illustrator: "Ryo Ueda",
    attacks: [{ cost: ["Fire"], name: "Ember", damage: 30, effect: "Discard an Energy." }],
  },
  {
    id: "sv01-010",
    name: "Charizard ex",
    category: "Pokemon",
    rarity: "Double Rare",
    types: ["Fire"],
    hp: 330,
    mark: "G",
    stage: "Stage2",
    suffix: "ex",
    illustrator: "PLANETA",
    abilities: [
      {
        type: "Ability",
        name: "Infernal Reign",
        effect: 'Search your deck for up to 3 Basic {R} Energy cards and "attach" them.',
      },
    ],
    attacks: [{ cost: ["Fire", "Fire"], name: "Burning Darkness", damage: "180+" }],
  },
  {
    id: "sv01-011",
    name: "Charmeleon",
    category: "Pokemon",
    rarity: "Uncommon",
    types: ["Fire"],
    hp: 90,
    mark: "G",
    stage: "Stage1",
    attacks: [{ name: "Combustion", damage: 50 }],
  },
  {
    id: "sv01-009",
    name: "Flabébé",
    category: "Pokemon",
    rarity: "Common",
    types: ["Psychic"],
    hp: 40,
    mark: "G",
    stage: "Basic",
    illustrator: "Ｆullwidth",
    attacks: [{ name: "Flower Sign" }],
  },
  {
    id: "sv01-100",
    name: "Rare Candy",
    category: "Trainer",
    rarity: "Uncommon",
    trainerType: "Item",
    mark: "G",
    legal: [0, 1],
    effective: [1, 1],
    effect: "Choose 1 of your Basic Pokémon in play.",
  },
  {
    id: "sv01-101",
    name: "Boss's Orders",
    category: "Trainer",
    rarity: "Rare",
    trainerType: "Supporter",
    mark: "G",
    effect: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
  },
  {
    id: "sv01-102",
    name: "Antique Dome Fossil",
    category: "Trainer",
    rarity: "Common",
    trainerType: "Item",
    hp: 60,
    mark: "H",
    effect: "Play this card as if it were a 60-HP Basic {C} Pokémon.",
  },
  {
    id: "sv01-200",
    name: "Basic Fire Energy",
    category: "Energy",
    energyType: "Normal",
    image: false,
  },
  {
    id: "sv01-201",
    name: "Jet Energy",
    category: "Energy",
    rarity: "Uncommon",
    energyType: "Special",
    mark: "G",
    effect: "As long as this card is attached to a Pokémon, it provides 1 {C} Energy.",
  },
  {
    id: "sv02-005",
    name: "Charmander",
    category: "Pokemon",
    rarity: "Common",
    types: ["Fire"],
    hp: 60,
    mark: "H",
    stage: "Basic",
    legal: [0, 1],
    attacks: [{ cost: ["Colorless"], name: "Heat Tackle", damage: 20, effect: "Heal 10 damage." }],
  },
  {
    id: "sv02-050",
    name: "Pikachu ex",
    category: "Pokemon",
    rarity: "Ultra Rare",
    types: ["Lightning"],
    hp: 200,
    mark: "H",
    stage: "Basic",
    suffix: "ex",
    illustrator: "𝒜 Astral",
    abilities: [{ type: "Ability", name: "Resolute Heart", effect: "It is not Knocked Out." }],
  },
  {
    id: "sv02-051",
    name: "Poké Ball 100%",
    category: "Trainer",
    rarity: "None",
    trainerType: "Item",
    mark: "H",
    effect: "Flip a coin. If heads, search your deck for a Pokémon.",
  },
  {
    id: "sv02-052",
    name: "Under_score",
    category: "Trainer",
    trainerType: "Supporter",
    mark: "H",
    effect: "Draw 2 cards.",
  },
  {
    id: "swsh1-001",
    name: "Snorlax",
    category: "Pokemon",
    rarity: "None",
    types: ["Colorless"],
    hp: 150,
    mark: "D",
    stage: "Basic",
    legal: [0, 1],
    attacks: [{ cost: ["Colorless"], name: "Thunderous Snore", damage: "120×" }],
  },
  {
    id: "swsh1-002",
    name: "Zacian V",
    category: "Pokemon",
    rarity: "Rare Holo V",
    types: ["Metal"],
    hp: 220,
    mark: "D",
    stage: "Basic",
    suffix: "V",
    legal: [0, 1],
    abilities: [{ type: "Ability", name: "Intrepid Sword", effect: "Attach Metal Energy." }],
  },
  {
    id: "swsh1-003",
    name: "Lightning Energy",
    category: "Energy",
    energyType: "Normal",
    image: false,
    legal: [1, 1],
  },
  {
    // tcgdex tags some Special Energy "Normal"; the brief calls it Special, the filter does not.
    id: "swsh1-004",
    name: "Double Colorless Energy",
    category: "Energy",
    energyType: "Normal",
    legal: [0, 1],
    effect: "Provides {C}{C} Energy.",
  },
];

async function seed(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      "INSERT INTO series (id, name) VALUES ('sv', 'Scarlet & Violet'), ('swsh', 'Sword')",
    ),
    db.prepare(
      `INSERT INTO sets (id, serie_id, name, release_date, count_total, count_official,
        legal_standard, legal_expanded) VALUES ('sv01', 'sv', 'SV', '2023-03-31', 1, 1, 1, 1),
        ('sv02', 'sv', 'PAL', '2023-06-09', 1, 1, 1, 1),
        ('swsh1', 'swsh', 'SSH', '2020-02-07', 1, 1, 0, 1)`,
    ),
    ...ROWS.map((row) =>
      db
        .prepare(
          `INSERT INTO cards (id, set_id, local_id, name, category, rarity, types_json, hp,
            regulation_mark, stage, trainer_type, energy_type, suffix, illustrator, legal_standard,
            legal_expanded, legal_standard_effective, legal_expanded_effective, abilities_json,
            attacks_json, effect, image_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.id.split("-")[0],
          // Text collector numbers, so "100" sorts before "11" as SQLite sorts them.
          String(Number(row.id.split("-")[1])),
          row.name,
          row.category,
          row.rarity ?? null,
          row.types ? JSON.stringify(row.types) : null,
          row.hp ?? null,
          row.mark ?? null,
          row.stage ?? null,
          row.trainerType ?? null,
          row.energyType ?? null,
          row.suffix ?? null,
          row.illustrator ?? null,
          ...(row.legal ?? [1, 1]),
          ...(row.effective ?? [null, null]),
          row.abilities ? JSON.stringify(row.abilities) : null,
          row.attacks ? JSON.stringify(row.attacks) : null,
          row.effect ?? null,
          row.image === false ? null : `https://assets.tcgdex.net/en/${row.id}`,
        ),
    ),
  ]);
}

const d1 = useTestD1(seed);

async function cardIndex(): Promise<CardIndexPayload> {
  const res = await app.request("/cards/index", {}, d1().env());
  expect(res.status).toBe(200);
  return (await res.json()) as CardIndexPayload;
}

/** Every page of a GET /cards query: its briefs in order and the total it reported. */
async function allPages(search: string): Promise<{ items: CardBrief[]; total: number }> {
  const items: CardBrief[] = [];
  for (let page = 1; ; page++) {
    const res = await app.request(`/cards?${search}&pageSize=5&page=${page}`, {}, d1().env());
    expect(res.status, search).toBe(200);
    const body = (await res.json()) as { items: CardBrief[]; total: number };
    items.push(...body.items);
    if (body.items.length < 5) return { items, total: body.total };
  }
}

const QUERIES = [
  "",
  "sort=name",
  "sort=hp-desc",
  "category=Trainer",
  "name=char",
  "name=CHAR",
  "name=charizard%20ex",
  "name=%C3%A9",
  "name=%C3%89",
  "name=%25",
  "name=_",
  "name=a",
  "name=zzz",
  "name=%20",
  "nameExact=charmander",
  "nameExact=CHARIZARD%20EX",
  "nameExact=flab%C3%A9b%C3%A9",
  "nameExact=FLAB%C3%89B%C3%89",
  "text=energy",
  "text=ENERGY",
  "text=cost",
  "text=damage",
  "text=heal",
  "text=%22",
  "text=%7BR%7D",
  "text=pok%C3%A9mon",
  "text=POK%C3%89MON",
  "text=180%2B",
  "text=%5C",
  "name=a&sort=name",
  "name=a&sort=hp-desc",
  "text=energy&sort=name",
  "text=e&sort=hp-desc",
  "name=char&category=Pokemon",
  "name=a&type=Fire&type=Lightning",
  "name=a&type=fire",
  "text=e&rarity=Common&rarity=None",
  "name=e&stage=Basic",
  "name=e&suffix=ex",
  "name=e&suffix=EX",
  "text=a&trainerType=Item",
  "name=energy&energyType=Special",
  "name=energy&energyType=Normal",
  "name=a&set=sv02",
  "name=a&serie=swsh",
  "name=a&illustrator=PLANETA",
  "name=a&illustrator=%F0%9D%92%9C%20Astral",
  "text=a&regulationMark=G",
  "name=a&hpMin=100",
  "name=a&hpMax=60",
  "name=a&hpMin=50&hpMax=200&sort=hp-desc",
  "name=a&legal=standard",
  "name=a&legal=expanded",
  "name=r&id=sv01-100&id=sv01-010",
];

describe("GET /cards/index", () => {
  it("finds what GET /cards finds, in its order, for every filter and sort", async () => {
    const index = prepareCardIndex(await cardIndex());
    expect(index.cards).toHaveLength(ROWS.length);
    for (const search of QUERIES) {
      const server = await allPages(search);
      // A repeated param becomes an array, as hono hands it to the API's validator.
      const params = new URLSearchParams(search);
      const query = cardsQuerySchema.parse(
        Object.fromEntries(
          [...new Set(params.keys())].map((key) => {
            const values = params.getAll(key);
            return [key, values.length > 1 ? values : values[0]];
          }),
        ),
      );
      const found = searchCardIndex(index, query);
      expect(
        found.map((row) => row[0]),
        search,
      ).toEqual(server.items.map((item) => item.id));
      expect(found.length, search).toBe(server.total);
    }
  });

  it("serves each card as GET /cards does, with the stored Energy subtype and Energy text", async () => {
    const payload = await cardIndex();
    const { items } = await allPages("");
    const briefs = new Map(payload.cards.map((row) => [row[0], cardIndexBrief(row)]));
    for (const item of items) {
      const { energyType, effect, ...rest } = briefs.get(item.id) ?? expect.fail(item.id);
      const stored = ROWS.find((row) => row.id === item.id);
      expect(rest, item.id).toEqual(omit(item));
      expect(energyType, item.id).toBe(stored?.energyType ?? null);
      expect(effect, item.id).toBe(item.category === "Energy" ? (stored?.effect ?? null) : null);
    }
    // The brief keeps the served Special subtype; the index keeps the stored one for the filter.
    expect(items.find((item) => item.id === "swsh1-004")?.energyType).toBe("Special");
    expect(briefs.get("swsh1-004")?.energyType).toBe("Normal");
    expect(briefs.get("sv02-051")?.rarity).toBeNull();
  });

  it("is one KV entry, read back on the next request", async () => {
    const first = await app.request("/cards/index", {}, d1().env());
    expect(first.headers.get(CACHE_STATUS_HEADER)).toBe("miss");
    expect(first.headers.get("Cache-Control")).toContain("max-age");
    const body = await first.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await app.request("/cards/index", {}, d1().env());
    expect(second.headers.get(CACHE_STATUS_HEADER)).toBe("hit");
    expect(await second.text()).toBe(body);
    expect((await d1().kv.list()).keys.map((key) => key.name)).toEqual([
      expect.stringMatching(/:\/cards\/index$/),
    ]);
  });

  it("spends the search budget on a KV miss only", async () => {
    const limiter = fakeRateLimit(1);
    const env = () => d1().env({ CATALOG_SEARCH_LIMIT: limiter.binding });
    expect((await app.request("/cards/index", {}, env())).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await app.request("/cards/index", {}, env())).status).toBe(200);
    expect(limiter.keys).toHaveLength(1);
    await d1().kv.delete((await d1().kv.list()).keys[0]?.name ?? "");
    const refused = await app.request("/cards/index", {}, env());
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
  });

  it("is not answered as a card id", async () => {
    const payload = await cardIndex();
    expect(payload.version).toBe(1);
    expect(payload.series).toEqual({ sv01: "sv", sv02: "sv", swsh1: "swsh" });
  });

  it("reads the table once and stays within D1's value cap per set", async () => {
    const [bySet, series] = await drizzle(d1().db).batch(cardIndexStatements(drizzle(d1().db)));
    expect(bySet).toHaveLength(3);
    expect(series).toHaveLength(1);
    const { meta } = await d1()
      .db.prepare(cardIndexStatements(drizzle(d1().db))[0].toSQL().sql)
      .all();
    expect(meta.rows_read).toBeLessThanOrEqual(ROWS.length * 2);
  });
});

/** A brief without the Energy subtype, which the index serves stored rather than judged. */
function omit(item: CardBrief): Omit<CardBrief, "energyType"> {
  const { energyType: _, ...rest } = item;
  return rest;
}
