import type { RedactedCard } from "@colorless/schema";
import type { SimOption } from "./simulatorTypes";

export type TrayOrder = "none" | "type" | "name";

/** Match-scoped display preferences for card-picker and discard-pile modals. */
export interface TrayViewState {
  showAll: boolean;
  group: boolean;
  order: TrayOrder;
}

export function defaultTrayView(): TrayViewState {
  return { showAll: false, group: false, order: "none" };
}

const ORDER_CYCLE: readonly TrayOrder[] = ["none", "type", "name"];

const ORDER_LABELS: Record<TrayOrder, string> = {
  none: "Order: None",
  type: "Order: Card type",
  name: "Order: Name",
};

export function nextTrayOrder(order: TrayOrder): TrayOrder {
  return ORDER_CYCLE[(ORDER_CYCLE.indexOf(order) + 1) % ORDER_CYCLE.length] ?? "none";
}

const CATEGORY_RANK: Record<string, number> = {
  Pokemon: 0,
  Trainer: 1,
  Energy: 2,
};

const STAGE_RANK: Record<string, number> = {
  Basic: 0,
  Stage1: 1,
  Stage2: 2,
};

const TRAINER_RANK: Record<string, number> = {
  Supporter: 0,
  Item: 1,
  Tool: 2,
  Stadium: 3,
};

function subtypeRank(
  card: RedactedCard | undefined,
  energyTypeOf?: (cardId: string) => string | null | undefined,
): number {
  if (!card) return 99;
  if (card.category === "Pokemon") return STAGE_RANK[card.stage ?? ""] ?? 3;
  if (card.category === "Trainer") return TRAINER_RANK[card.trainerType ?? ""] ?? 4;
  if (card.category === "Energy") return energyTypeOf?.(card.cardId) === "Special" ? 1 : 0;
  return 99;
}

export interface TrayViewConfig {
  view: TrayViewState;
  /** Full searched zone in zone order; "Show all cards" appears only when it adds non-candidates. */
  pool?: readonly RedactedCard[];
  onChange: () => void;
  energyTypeOf?: (cardId: string) => string | null | undefined;
  /** Extra discriminator keeping non-interchangeable prints in separate groups (e.g. host Pokémon). */
  groupKeyOf?: (option: SimOption) => string;
}

interface Entry {
  option: SimOption;
  poolOnly: boolean;
  index: number;
}

/**
 * Apply the card-tray toolbar (Show all cards, Group cards, Order by) to a list of card options.
 * When grouped, identical copies collapse into one counted option; once any copy in a group is
 * selected, that group expands in place so additional copies can be picked or deselected.
 */
export function applyTrayView(
  options: readonly SimOption[],
  config: TrayViewConfig,
): { header: SimOption[]; options: SimOption[] } {
  const { view, pool, onChange, energyTypeOf, groupKeyOf } = config;
  const byUid = new Map<string, SimOption>();
  for (const o of options) {
    if (o.uid) byUid.set(o.uid, o);
  }
  const hasExtraPool = !!pool && pool.some((c) => !byUid.has(c.id));

  const header: SimOption[] = [];
  if (hasExtraPool) {
    header.push({
      label: "Show all cards",
      colour: view.showAll ? "green" : "profile",
      selected: view.showAll,
      run: () => {
        view.showAll = !view.showAll;
        onChange();
      },
    });
  }
  header.push({
    label: "Group cards",
    colour: view.group ? "green" : "profile",
    selected: view.group,
    run: () => {
      view.group = !view.group;
      onChange();
    },
  });
  header.push({
    label: ORDER_LABELS[view.order],
    colour: view.order === "none" ? "profile" : "blue",
    run: () => {
      view.order = nextTrayOrder(view.order);
      onChange();
    },
  });

  let entries: Entry[];
  if (hasExtraPool && view.showAll && pool) {
    entries = pool.map((card, index) => {
      const candidate = byUid.get(card.id);
      if (candidate) return { option: candidate, poolOnly: false, index };
      return {
        option: { label: card.name, card, uid: card.id, disabled: true, run: () => {} },
        poolOnly: true,
        index,
      };
    });
  } else {
    entries = options.map((option, index) => ({ option, poolOnly: false, index }));
  }

  if (view.order !== "none") {
    const byType = view.order === "type";
    entries = [...entries].sort((a, b) => {
      const ca = a.option.card;
      const cb = b.option.card;
      if (byType) {
        const catDiff =
          (CATEGORY_RANK[ca?.category ?? ""] ?? 3) - (CATEGORY_RANK[cb?.category ?? ""] ?? 3);
        if (catDiff !== 0) return catDiff;
        const subDiff = subtypeRank(ca, energyTypeOf) - subtypeRank(cb, energyTypeOf);
        if (subDiff !== 0) return subDiff;
      }
      const nameA = (ca?.name ?? a.option.label).toLowerCase();
      const nameB = (cb?.name ?? b.option.label).toLowerCase();
      if (nameA !== nameB) return nameA < nameB ? -1 : 1;
      const idA = ca?.cardId ?? "";
      const idB = cb?.cardId ?? "";
      if (idA !== idB) return idA < idB ? -1 : 1;
      return a.index - b.index;
    });
  }

  if (!view.group) {
    return { header, options: entries.map((e) => e.option) };
  }

  const buckets: Entry[][] = [];
  const bucketIndex = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as Entry;
    const cardId = entry.option.card?.cardId;
    const key =
      cardId && cardId !== "hidden" && cardId !== "empty"
        ? `${entry.poolOnly ? "1" : "0"}:${cardId}:${groupKeyOf ? groupKeyOf(entry.option) : ""}`
        : `single:${i}`;
    const existing = bucketIndex.get(key);
    if (existing !== undefined) {
      buckets[existing]?.push(entry);
    } else {
      bucketIndex.set(key, buckets.length);
      buckets.push([entry]);
    }
  }

  const grouped: SimOption[] = [];
  for (const members of buckets) {
    if (members.length === 1) {
      const only = members[0] as Entry;
      grouped.push(only.option);
    } else if (members.some((m) => m.option.selected)) {
      for (const m of members) grouped.push(m.option);
    } else {
      const lead = (members.find((m) => !m.option.disabled) ?? members[0]) as Entry;
      grouped.push({ ...lead.option, count: members.length });
    }
  }

  return { header, options: grouped };
}
