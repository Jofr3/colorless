import {
  ATTACHED_CARD_SCALE,
  BENCH_EXTRA_CARD_WIDTH,
  DEFAULT_ATTACHED_VISIBLE_STICK,
} from "../constants";
import type { CardModel } from "../types";

const CARD_HEIGHT_TO_WIDTH_RATIO = 1.4;
const SLOT_GAP_CARD_WIDTH_ESTIMATE = 0.06;
const ATTACHED_STRIP_CARD_WIDTH =
  CARD_HEIGHT_TO_WIDTH_RATIO * ATTACHED_CARD_SCALE * DEFAULT_ATTACHED_VISIBLE_STICK;

export function visibleBenchSideAttachmentCount(cards: Pick<CardModel, "attached">[]) {
  return cards.reduce((count, card) => {
    const toolCount = (card.attached?.tools.length ?? 0) > 0 ? 1 : 0;
    const energyCount = (card.attached?.energies.length ?? 0) > 0 ? 1 : 0;
    return count + toolCount + energyCount;
  }, 0);
}

export function shouldCollapseBenchAttachments(
  cards: Pick<CardModel, "attached">[],
  benchLimit: number,
) {
  if (cards.length === 0) return false;

  const naturalWidth =
    cards.length +
    Math.max(0, cards.length - 1) * SLOT_GAP_CARD_WIDTH_ESTIMATE +
    visibleBenchSideAttachmentCount(cards) * ATTACHED_STRIP_CARD_WIDTH;
  const fixedBenchWidth =
    benchLimit +
    Math.max(0, benchLimit - 1) * SLOT_GAP_CARD_WIDTH_ESTIMATE +
    BENCH_EXTRA_CARD_WIDTH;

  return naturalWidth > fixedBenchWidth;
}
