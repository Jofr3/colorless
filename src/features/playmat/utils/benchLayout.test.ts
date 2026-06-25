import { describe, expect, it } from "vitest";
import { DEFAULT_BENCH_LIMIT } from "../constants";
import type { CardModel } from "../types";
import { shouldCollapseBenchAttachments, visibleBenchSideAttachmentCount } from "./benchLayout";

const card = (id: string): CardModel => ({ id, name: id, cardId: id, type: "energy" });
const slot = (tools = 0, energies = 0): Pick<CardModel, "attached"> => ({
  attached: {
    tools: Array.from({ length: tools }, (_, i) => card(`t${i}`)),
    energies: Array.from({ length: energies }, (_, i) => card(`e${i}`)),
  },
});
const bare = (): Pick<CardModel, "attached"> => ({ attached: undefined });

describe("visibleBenchSideAttachmentCount", () => {
  it("counts at most one tool side and one energy side per card", () => {
    expect(visibleBenchSideAttachmentCount([slot(1, 1)])).toBe(2);
    expect(visibleBenchSideAttachmentCount([slot(3, 0)])).toBe(1); // multiple tools → 1 side
    expect(visibleBenchSideAttachmentCount([slot(0, 4)])).toBe(1); // multiple energies → 1 side
    expect(visibleBenchSideAttachmentCount([bare()])).toBe(0);
  });

  it("sums across cards", () => {
    expect(visibleBenchSideAttachmentCount([slot(1, 1), slot(0, 1), bare()])).toBe(3);
  });
});

describe("shouldCollapseBenchAttachments", () => {
  // Regression guards (not a spec): the threshold is a tuning value, so these
  // assert clearly-separated cases rather than the exact boundary.
  it("never collapses an empty bench", () => {
    expect(shouldCollapseBenchAttachments([], DEFAULT_BENCH_LIMIT)).toBe(false);
  });

  it("does not collapse a sparse bench with no attachments", () => {
    expect(shouldCollapseBenchAttachments([bare(), bare(), bare()], DEFAULT_BENCH_LIMIT)).toBe(
      false,
    );
  });

  it("collapses a full bench heavy with attachments", () => {
    const crowded = Array.from({ length: DEFAULT_BENCH_LIMIT }, () => slot(1, 1));
    expect(shouldCollapseBenchAttachments(crowded, DEFAULT_BENCH_LIMIT)).toBe(true);
  });
});
