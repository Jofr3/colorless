// The hot catalog reads against the migrated schema: each must walk an index in its own order
// (no full scan, no sort pass), and read about one page of rows, not the table.

import { type CardsQuery, cardsQuerySchema } from "@colorless/schema";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { useTestD1 } from "../testing/d1";
import {
  cardsCountedPageStatement,
  cardsPageStatements,
  facetsStatement,
  setCardsStatement,
} from "./routes";

const SET_IDS = ["sv01", "sv02", "sv03", "sv04", "sv05", "sv06"];
const CARDS_PER_SET = 120;
const NAMES = Array.from({ length: 40 }, (_, index) => `Pokemon ${String(index).padStart(2, "0")}`);
const TOTAL_CARDS = SET_IDS.length * CARDS_PER_SET;

async function seedCatalog(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO series (id, name) VALUES ('sv', 'Scarlet & Violet')"),
    ...SET_IDS.map((setId, index) =>
      db
        .prepare(
          `INSERT INTO sets (id, serie_id, name, release_date, count_total, count_official,
            legal_standard, legal_expanded) VALUES (?, 'sv', ?, ?, ?, ?, 1, 1)`,
        )
        .bind(setId, setId, `2023-0${index + 1}-01`, CARDS_PER_SET, CARDS_PER_SET),
    ),
    // Local ids count down so that insertion order is not collector order.
    db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i + 1 < ${CARDS_PER_SET})
        INSERT INTO cards (id, set_id, local_id, name, category, legal_standard, legal_expanded)
        SELECT s.id || '-' || printf('%03d', ${CARDS_PER_SET} - n.i), s.id,
          printf('%03d', ${CARDS_PER_SET} - n.i),
          json_extract(?, '$[' || (n.i % ${NAMES.length}) || ']'), 'Pokemon', 1, 1
        FROM sets AS s, n`,
      )
      .bind(JSON.stringify(NAMES)),
    db.prepare("ANALYZE"),
  ]);
}

const d1 = useTestD1(seedCatalog);
const db = () => drizzle(d1().db);

type Statement = { toSQL(): { sql: string; params: unknown[] } };

async function planOf(statement: Statement): Promise<string> {
  const { sql, params } = statement.toSQL();
  const { results } = await d1()
    .db.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return results.map((row) => row.detail).join("\n");
}

async function rowsRead(statement: Statement): Promise<number> {
  const { sql, params } = statement.toSQL();
  const { meta } = await d1()
    .db.prepare(sql)
    .bind(...params)
    .all();
  return meta.rows_read;
}

function cardsQuery(search: string): CardsQuery {
  return cardsQuerySchema.parse(Object.fromEntries(new URLSearchParams(search)));
}

describe("catalog query plans", () => {
  it("pages the default collector order straight off the (set, local id) index", async () => {
    const [page, total] = cardsPageStatements(db(), cardsQuery(""));
    const plan = await planOf(page);
    expect(plan).toContain("USING INDEX cards_set_local_idx");
    expect(plan).not.toContain("TEMP B-TREE");
    expect(await rowsRead(page)).toBeLessThanOrEqual(50);
    expect(await planOf(total)).toContain("COVERING INDEX");
  });

  it("pages sort=name off the (name, set, local id) index", async () => {
    const [page] = cardsPageStatements(db(), cardsQuery("sort=name"));
    const plan = await planOf(page);
    expect(plan).toContain("USING INDEX cards_name_set_local_idx");
    expect(plan).not.toContain("TEMP B-TREE");
    expect(await rowsRead(page)).toBeLessThanOrEqual(50);
  });

  it("pages sort=hp-desc off the Pokémon-HP expression index", async () => {
    const [page] = cardsPageStatements(db(), cardsQuery("sort=hp-desc"));
    const plan = await planOf(page);
    expect(plan).toContain("USING INDEX cards_pokemon_hp_idx");
    expect(plan).not.toContain("TEMP B-TREE");
    expect(await rowsRead(page)).toBeLessThanOrEqual(50);
  });

  it("finds an exact name through the lower(name) index, in collector order", async () => {
    const [page, total] = cardsPageStatements(
      db(),
      cardsQuery("nameExact=pokemon 07&pageSize=100"),
    );
    const plan = await planOf(page);
    expect(plan).toContain("SEARCH cards USING INDEX cards_name_lower_idx");
    expect(plan).not.toContain("TEMP B-TREE");
    expect(await planOf(total)).toMatch(
      /SEARCH cards USING (COVERING )?INDEX cards_name_lower_idx/,
    );
    const matches = TOTAL_CARDS / NAMES.length;
    expect(await rowsRead(page)).toBeLessThanOrEqual(matches + 1);
    expect(await rowsRead(total)).toBeLessThanOrEqual(matches + 1);
  });

  it("pages one set by searching the (set, local id) index", async () => {
    const [page, total] = cardsPageStatements(db(), cardsQuery("set=sv03"));
    const plan = await planOf(page);
    expect(plan).toContain("SEARCH cards USING INDEX cards_set_local_idx (set_id=?)");
    expect(plan).not.toContain("TEMP B-TREE");
    expect(await rowsRead(page)).toBeLessThanOrEqual(50);
    expect(await planOf(total)).toContain("SEARCH cards USING COVERING INDEX cards_set_local_idx");
    expect(await rowsRead(total)).toBeLessThanOrEqual(CARDS_PER_SET + 1);
  });

  it("counts a free-text page in its page statement, one walk of the sort's index", async () => {
    const indexes = { name: "cards_name_set_local_idx", set: "cards_set_local_idx" };
    for (const [sort, index] of Object.entries(indexes)) {
      // A sparse term, so filling the page walks the whole index: the pair would read it twice.
      const query = cardsQuery(`name=pokemon 07&legal=standard&sort=${sort}&pageSize=24`);
      const statement = cardsCountedPageStatement(db(), query);
      const plan = await planOf(statement);
      expect(plan).toContain(`SCAN cards USING INDEX ${index}`);
      expect(plan).not.toContain("TEMP B-TREE");
      const matches = TOTAL_CARDS / NAMES.length;
      // The walk, plus each match written to the window buffer and read back from it.
      expect(await rowsRead(statement)).toBeLessThanOrEqual(TOTAL_CARDS + 2 * matches + 1);
      const [page, total] = cardsPageStatements(db(), query);
      expect(await rowsRead(page)).toBe(TOTAL_CARDS);
      expect(await rowsRead(total)).toBe(TOTAL_CARDS);
    }
  });

  it("feeds the hp-desc window off the Pokémon-HP expression index", async () => {
    const statement = cardsCountedPageStatement(db(), cardsQuery("name=pokemon&sort=hp-desc"));
    const plan = await planOf(statement);
    expect(plan).toContain("USING INDEX cards_pokemon_hp_idx");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("reads every facet in one pass over the table", async () => {
    const statement = facetsStatement(db());
    expect((await planOf(statement)).match(/SCAN cards/g)).toHaveLength(1);
    expect(await rowsRead(statement)).toBeLessThanOrEqual(TOTAL_CARDS);
  });

  it("lists a set's cards for /sets/:id without a sort pass", async () => {
    const statement = setCardsStatement(db(), "sv05");
    const plan = await planOf(statement);
    expect(plan).toContain("SEARCH cards USING INDEX cards_set_local_idx (set_id=?)");
    expect(plan).not.toContain("TEMP B-TREE");
    expect(await rowsRead(statement)).toBeLessThanOrEqual(CARDS_PER_SET + 1);
  });
});
