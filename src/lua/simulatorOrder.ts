import { readPersisted, writePersisted } from "../lib/persistedState";

type Seat = "p1" | "p2";
export type OrderedZone = "hand" | "bench";
const KEY = "colorless:simulator:card-order";
type Orders = Partial<Record<`${Seat}:${OrderedZone}`, string[]>>;

/** Cosmetic order, independent of engine indices and gameplay history. Bench
 * keys are the bottom card of each evolution stack, so evolving keeps its place.
 * An unsaved order (online) lives in memory only. */
export class SimulatorOrder {
  private orders: Orders = {};
  constructor(
    private readonly startedAt: number,
    private readonly stored = true,
  ) {
    if (!stored) return;
    this.orders = readPersisted(
      KEY,
      (raw) => {
        const saved = JSON.parse(raw);
        if (saved?.startedAt !== startedAt || !saved.orders) return;
        const orders: Orders = {};
        for (const seat of ["p1", "p2"] as const) {
          for (const zone of ["hand", "bench"] as const) {
            const key = `${seat}:${zone}` as const;
            const ids = saved.orders[key];
            if (Array.isArray(ids) && ids.every((id) => typeof id === "string"))
              orders[key] = [...new Set<string>(ids)];
          }
        }
        return orders;
      },
      {},
    );
  }
  sorted(seat: Seat, zone: OrderedZone, keys: string[]): string[] {
    const present = new Set(keys);
    const saved = this.orders[`${seat}:${zone}`] ?? [];
    const known = new Set(saved);
    return [...saved.filter((key) => present.has(key)), ...keys.filter((key) => !known.has(key))];
  }
  move(seat: Seat, zone: OrderedZone, keys: string[], key: string, index: number): void {
    const ordered = this.sorted(seat, zone, keys);
    const from = ordered.indexOf(key);
    if (from < 0 || !Number.isInteger(index) || index < 0 || index >= ordered.length) return;
    ordered.splice(from, 1);
    ordered.splice(index, 0, key);
    const slot = `${seat}:${zone}` as const;
    const present = new Set(keys);
    this.orders[slot] = [...ordered, ...(this.orders[slot] ?? []).filter((id) => !present.has(id))];
    if (this.stored)
      writePersisted(KEY, JSON.stringify({ startedAt: this.startedAt, orders: this.orders }));
  }
}
