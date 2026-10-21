/** Compressed, already resized PNGs live on disk; only metadata is scanned
 * when choosing a transition. No bulk decoding or WASM preload is needed. */
interface Entry {
  id: string;
  bytes: number;
  touched: number;
  shownCycle: number;
}
interface Shuffle {
  cycle: number;
  lastId?: string;
}
const STORES = ["images", "entries", "state"];
const DEFAULT_BUDGET = 128 * 1024 * 1024;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class ArtworkCache {
  private database: Promise<IDBDatabase | null>;

  constructor(
    name = "luminous-lua-artwork-v1",
    private maxBytes = DEFAULT_BUDGET,
    factory: IDBFactory | undefined = globalThis.indexedDB,
  ) {
    this.database = new Promise<IDBDatabase | null>((resolve) => {
      if (!factory) {
        resolve(null);
        return;
      }
      let settled = false;
      try {
        const opening = factory.open(name, 1);
        opening.onupgradeneeded = () => {
          const db = opening.result;
          db.createObjectStore("images");
          db.createObjectStore("entries", { keyPath: "id" });
          db.createObjectStore("state");
        };
        opening.onsuccess = () => {
          const db = opening.result;
          db.onversionchange = () => db.close();
          if (settled) db.close();
          else {
            settled = true;
            resolve(db);
          }
        };
        opening.onerror = opening.onblocked = () => {
          settled = true;
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }

  private async run<T>(work: (tx: IDBTransaction) => Promise<T>): Promise<T | null> {
    const db = await this.database;
    if (!db) return null;
    try {
      // A single transaction makes eviction and shuffle state coherent even
      // when several image downloads finish together or another tab is open.
      const tx = db.transaction(STORES, "readwrite");
      const completed = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => {}; // The abort handler handles failed requests.
      });
      // Install a rejection handler before awaiting an individual request.
      void completed.catch(() => {});
      try {
        const result = await work(tx);
        await completed;
        return result;
      } catch {
        try {
          tx.abort();
        } catch {
          /* Already completed/aborted. */
        }
        await completed.catch(() => {});
        return null;
      }
    } catch {
      return null;
    }
  }

  async get(id: string): Promise<Blob | null> {
    return this.run(async (tx) => {
      const entries = tx.objectStore("entries");
      const entry = await request<Entry | undefined>(entries.get(id));
      if (!entry) return null;
      const blob = await request<Blob | undefined>(tx.objectStore("images").get(id));
      if (!blob) {
        entries.delete(id);
        return null;
      }
      entries.put({ ...entry, touched: Date.now() });
      return blob;
    });
  }

  async put(id: string, blob: Blob): Promise<boolean> {
    if (!id || !blob.size || blob.size > this.maxBytes || blob.type !== "image/png") return false;
    return (
      (await this.run(async (tx) => {
        const entries = tx.objectStore("entries");
        const images = tx.objectStore("images");
        const all = await request<Entry[]>(entries.getAll());
        const previous = all.find((entry) => entry.id === id);
        let total =
          all.reduce((sum, entry) => sum + entry.bytes, 0) - (previous?.bytes ?? 0) + blob.size;
        all.sort((a, b) => a.touched - b.touched);
        for (const entry of all) {
          if (total <= this.maxBytes) break;
          if (entry.id === id) continue;
          entries.delete(entry.id);
          images.delete(entry.id);
          total -= entry.bytes;
        }
        entries.put({
          id,
          bytes: blob.size,
          touched: Date.now(),
          shownCycle: previous?.shownCycle ?? 0,
        });
        images.put(blob, id);
        return true;
      })) ?? false
    );
  }

  async pick(): Promise<{ id: string; blob: Blob } | null> {
    return this.run(async (tx) => {
      const entries = tx.objectStore("entries");
      const state = tx.objectStore("state");
      const all = await request<Entry[]>(entries.getAll());
      if (!all.length) return null;
      const shuffle = (await request<Shuffle | undefined>(state.get("shuffle"))) ?? { cycle: 1 };
      let available = all.filter((entry) => entry.shownCycle < shuffle.cycle);
      if (!available.length) {
        shuffle.cycle++;
        state.put(shuffle, "shuffle");
        available = all;
      }
      if (available.length > 1)
        available = available.filter((entry) => entry.id !== shuffle.lastId);
      // A missing blob must not strand the selection on a broken entry.
      while (available.length) {
        const entry = available.splice(Math.floor(Math.random() * available.length), 1)[0];
        if (!entry) break;
        const blob = await request<Blob | undefined>(tx.objectStore("images").get(entry.id));
        if (blob) return { id: entry.id, blob };
        entries.delete(entry.id);
      }
      return null;
    });
  }

  async markShown(id: string): Promise<void> {
    await this.run(async (tx) => {
      const entries = tx.objectStore("entries");
      const state = tx.objectStore("state");
      const entry = await request<Entry | undefined>(entries.get(id));
      const shuffle = (await request<Shuffle | undefined>(state.get("shuffle"))) ?? { cycle: 1 };
      if (entry) entries.put({ ...entry, shownCycle: shuffle.cycle });
      state.put({ ...shuffle, lastId: id }, "shuffle");
    });
  }

  async remove(id: string): Promise<void> {
    await this.run(async (tx) => {
      tx.objectStore("images").delete(id);
      tx.objectStore("entries").delete(id);
    });
  }

  async close(): Promise<void> {
    (await this.database)?.close();
  }
}

declare global {
  interface Window {
    luminousArtworkCache?: ArtworkCache;
  }
}
