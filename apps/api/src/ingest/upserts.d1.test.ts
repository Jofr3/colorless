// The generated ingest SQL against the migrated schema: a rerun over unchanged upstream data
// writes nothing, and a changed row is still rewritten.

import { tcgdexCardSchema, tcgdexSerieSchema, tcgdexSetSchema } from "@colorless/schema";
import cardPokemonAbility from "@colorless/schema/tcgdex-fixtures/card-pokemon-ability-sv01-081.json";
import cardTrainer from "@colorless/schema/tcgdex-fixtures/card-trainer-sv01-181.json";
import serieFull from "@colorless/schema/tcgdex-fixtures/serie-full-sv.json";
import setFull from "@colorless/schema/tcgdex-fixtures/set-full-sv01.json";
import { describe, expect, it } from "vitest";
import { useTestD1 } from "../testing/d1";
import { type CardRow, mapCard, mapSerie, mapSet } from "./map";
import { cardsUpsertSql, reprintLegalitySql, seriesUpsertSql, setsUpsertSql } from "./upserts";

const d1 = useTestD1();

const pokemon = mapCard(tcgdexCardSchema.parse(cardPokemonAbility));
const trainer = mapCard(tcgdexCardSchema.parse(cardTrainer));
/** A reprint of the trainer that tcgdex lists as Standard-legal while the original is not. */
const legalReprint: CardRow = { ...trainer, id: "sv01-999", localId: "999", legalStandard: true };
const rotatedTrainer: CardRow = {
  ...trainer,
  legalStandard: false,
  legalStandardEffective: false,
};

async function run(sql: string): Promise<number> {
  const { meta } = await d1().db.prepare(sql).run();
  return meta.rows_written;
}

async function effectiveStandard(id: string): Promise<number | null> {
  return d1()
    .db.prepare("SELECT legal_standard_effective FROM cards WHERE id = ?")
    .bind(id)
    .first<number | null>("legal_standard_effective");
}

async function seedSet(): Promise<void> {
  await run(seriesUpsertSql([mapSerie(tcgdexSerieSchema.parse(serieFull))]));
  await run(setsUpsertSql([mapSet(tcgdexSetSchema.parse(setFull))]));
}

describe("ingest upserts on D1", () => {
  it("writes nothing when rerun over unchanged rows, and rewrites a changed one", async () => {
    await seedSet();
    await run(cardsUpsertSql([pokemon, rotatedTrainer]));

    expect(await run(seriesUpsertSql([mapSerie(tcgdexSerieSchema.parse(serieFull))]))).toBe(0);
    expect(await run(setsUpsertSql([mapSet(tcgdexSetSchema.parse(setFull))]))).toBe(0);
    expect(await run(cardsUpsertSql([pokemon, rotatedTrainer]))).toBe(0);

    expect(await run(cardsUpsertSql([{ ...pokemon, hp: (pokemon.hp ?? 0) + 10 }]))).toBeGreaterThan(
      0,
    );
    const hp = await d1()
      .db.prepare("SELECT hp FROM cards WHERE id = ?")
      .bind(pokemon.id)
      .first<number>("hp");
    expect(hp).toBe((pokemon.hp ?? 0) + 10);
  });

  it("writes only changed reprint verdicts, and an unchanged rerun keeps them", async () => {
    await seedSet();
    await run(cardsUpsertSql([rotatedTrainer, legalReprint]));
    expect(await run(reprintLegalitySql())).toBeGreaterThan(0);
    expect(await effectiveStandard(rotatedTrainer.id)).toBe(1);

    expect(await run(reprintLegalitySql())).toBe(0);
    expect(await run(cardsUpsertSql([rotatedTrainer, legalReprint]))).toBe(0);
    expect(await effectiveStandard(rotatedTrainer.id)).toBe(1);
  });

  it("keeps a reprint-raised verdict when its print is re-upserted", async () => {
    await seedSet();
    await run(cardsUpsertSql([rotatedTrainer, legalReprint]));
    await run(reprintLegalitySql());
    // A real upstream change rewrites the row; its own flag must not reset the raised verdict.
    await run(cardsUpsertSql([{ ...rotatedTrainer, illustrator: "Someone Else" }]));
    expect(await effectiveStandard(rotatedTrainer.id)).toBe(1);
  });

  it("settles a new print's verdict with the set-scoped pass alone", async () => {
    await seedSet();
    // Catalog rows outlive each test here, so the new print takes an id no other test wrote.
    const newPrint: CardRow = { ...rotatedTrainer, id: "sv01-998", localId: "998" };
    await run(cardsUpsertSql([legalReprint]));
    await run(cardsUpsertSql([newPrint]));
    expect(await effectiveStandard(newPrint.id)).toBe(0);
    expect(await run(reprintLegalitySql(newPrint.setId))).toBeGreaterThan(0);
    expect(await effectiveStandard(newPrint.id)).toBe(1);
  });

  it("does not rewrite a row whose only change is tcgdex's updated stamp", async () => {
    await seedSet();
    await run(cardsUpsertSql([pokemon]));
    expect(await run(cardsUpsertSql([{ ...pokemon, updated: "2099-01-01T00:00:00Z" }]))).toBe(0);
  });
});
