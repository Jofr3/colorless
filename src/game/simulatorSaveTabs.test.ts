import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { candidateActions, drbgSeed, MIXED_DECK, mustCreate } from "@colorless/engine/testing";
import { memoryStorage } from "../test/storageStub";

const SAVE_KEY = "colorless:simulator:game";
const TAKEN = "Another tab took over the save. This game is no longer saved.";

/** One browser: a storage every tab shares, whose writes reach each other tab as a storage
    event, as the browser sends them. */
let tabs: EventTarget[];
let acting: EventTarget | undefined;
let values: Map<string, string>;

beforeEach(() => {
  tabs = [];
  acting = undefined;
  const storage = memoryStorage();
  values = storage.values;
  const tell = (key: string, newValue: string | null) => {
    for (const tab of tabs)
      if (tab !== acting) tab.dispatchEvent(Object.assign(new Event("storage"), { key, newValue }));
  };
  vi.stubGlobal("localStorage", {
    ...storage,
    getItem: storage.getItem,
    setItem: (key: string, value: string) => {
      storage.setItem(key, value);
      tell(key, value);
    },
    removeItem: (key: string) => {
      storage.removeItem(key);
      tell(key, null);
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A tab of its own: its own copy of the save module, the table and the sandbox launch. */
async function openTab() {
  vi.resetModules();
  const save = await import("./simulatorSave");
  const { LocalTableSource } = await import("../lua/tableSource");
  const { launchSandbox } = await import("../lua/sandboxLaunch");
  const window = new EventTarget();
  tabs.push(window);
  const inTab = <T>(fn: () => T): T => {
    acting = window;
    vi.stubGlobal("window", window);
    try {
      return fn();
    } finally {
      acting = undefined;
    }
  };
  return { save, LocalTableSource, launchSandbox, inTab };
}
type Tab = Awaited<ReturnType<typeof openTab>>;

const setup = (seed: number, startedAt: number) => {
  const created = mustCreate(drbgSeed(seed), { p1: MIXED_DECK, p2: MIXED_DECK });
  return {
    state: created.state,
    events: created.events,
    names: { p1: "One", p2: "Two" },
    startedAt,
  };
};
/** A new match on a table in `tab`, saved and shown. */
const play = (tab: Tab, seed: number, startedAt: number) =>
  tab.inTab(() => {
    const table = new tab.LocalTableSource(setup(seed, startedAt));
    const changes = vi.fn();
    const close = table.subscribe(changes);
    expect(table.persist()).toBe(true);
    return { table, changes, close };
  });
/** The match a reload of any tab resumes. */
const resumes = async () => {
  const tab = await openTab();
  return tab.inTab(() => tab.save.loadSimulatorSave()?.startedAt);
};

it("keeps the save of the match another tab started since, refusing this tab's moves and saying so", async () => {
  const a = await openTab();
  const b = await openTab();
  const first = play(a, 1, 1_000);
  expect(first.table.lifecycle().warning).toBeUndefined();
  const second = play(b, 2, 2_000);
  expect(first.changes).toHaveBeenCalled();
  expect(first.table.lifecycle().warning).toBe(TAKEN);
  expect(a.inTab(() => first.table.persist())).toBe(false);
  expect(second.table.lifecycle().warning).toBeUndefined();
  expect(b.inTab(() => second.table.persist())).toBe(true);
  expect(await resumes()).toBe(2_000);
});

it("keeps another tab's save, its table closed, when this tab's Choose decks clears", async () => {
  const a = await openTab();
  const b = await openTab();
  play(a, 1, 1_000);
  play(b, 2, 2_000).close();
  a.inTab(() => a.save.clearSimulatorSave());
  expect(await resumes()).toBe(2_000);
});

it("saves a tab's match again once the tab that took the slot removes its own save", async () => {
  const a = await openTab();
  const b = await openTab();
  const first = play(a, 1, 1_000);
  play(b, 2, 2_000);
  expect(first.table.lifecycle().warning).toBe(TAKEN);
  b.inTab(() => b.save.clearSimulatorSave());
  expect(first.table.lifecycle().warning).toBeUndefined();
  expect(await resumes()).toBe(1_000);
});

it("gives a save two tabs resumed to the one that moves first, and tells the other", async () => {
  const opener = await openTab();
  play(opener, 1, 1_000);
  const a = await openTab();
  const b = await openTab();
  const resume = (tab: Tab) =>
    tab.inTab(() => {
      const host = tab.save.loadSimulatorSave();
      if (!host) throw new Error("The save did not restore");
      const table = new tab.LocalTableSource(host);
      table.subscribe(() => {});
      return table;
    });
  const ta = resume(a);
  const tb = resume(b);
  b.inTab(() => tb.leave());
  expect(ta.lifecycle().warning).toBeUndefined();
  const move = candidateActions(ta.host.game, ta.host.viewerSeat).find(
    (action) => action.type !== "concede" && ta.allowed(action),
  );
  if (!move) throw new Error("No move to make");
  a.inTab(() => ta.send(move));
  expect(ta.lifecycle().warning).toBeUndefined();
  expect(tb.lifecycle().warning).toBe(TAKEN);
  const kept = values.get(SAVE_KEY);
  expect(b.inTab(() => tb.persist())).toBe(false);
  expect(values.get(SAVE_KEY)).toBe(kept);
});

it("lets a new sandbox game take the slot from another tab's match, which is told", async () => {
  const a = await openTab();
  const b = await openTab();
  const first = play(a, 1, 1_000);
  const navigate = vi.fn();
  b.inTab(() => b.launchSandbox(setup(2, 2_000), navigate));
  expect(navigate).toHaveBeenCalled();
  expect(first.table.lifecycle().warning).toBe(TAKEN);
  expect(await resumes()).toBe(2_000);
});

it("lets New game in a tab that lost the slot take it back, and tells the other tab", async () => {
  const a = await openTab();
  const b = await openTab();
  const first = play(a, 1, 1_000);
  const second = play(b, 2, 2_000);
  expect(a.inTab(() => first.table.restart())).toBeNull();
  expect(first.table.lifecycle().warning).toBeUndefined();
  expect(second.table.lifecycle().warning).toBe(TAKEN);
  expect(await resumes()).toBe(first.table.host.startedAt);
});

it("stops listening for other tabs once the table is let go", async () => {
  const a = await openTab();
  const b = await openTab();
  const table = a.inTab(() => new a.LocalTableSource(setup(1, 1_000)));
  const stop = a.inTab(() => table.subscribe(() => {}));
  a.inTab(() => table.persist());
  stop();
  play(b, 2, 2_000);
  expect(table.lifecycle().warning).toBeUndefined();
});
