import type { MAILBOXES } from "./mailboxes";

/** The page-level contract between the love.js host script (frontend/lua/web/host.js) and the
 * bridge module (src/lua/bridge.ts). The host script runs first and defines
 * `window.colorlessHost`; the bridge connects to it before window load, when Love() starts. */

export interface ArtRequest {
  id: string;
  url: string;
}

/** The artwork store the host reads card art and transition art from. */
export interface HostArtworkCache {
  get(id: string): Promise<Blob | null>;
  put(id: string, blob: Blob): Promise<boolean>;
  pick(): Promise<{ id: string; blob: Blob } | null>;
  markShown(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** `stalled`: the boot has made no download progress for a while and the overlay offers Reload,
 * still waiting. `recovered`: progress again after a stall. `failed`: the failure overlay is up (a
 * Lua error, lost graphics, an abort, a browser without WebGL or WebAssembly) and nothing can play
 * on, so live online links close as a closed tab's would. */
export type DegradedState = "stalled" | "failed" | "recovered";

/** What the bridge hands the host when it connects. */
export interface ColorlessBridge {
  /** Every `COLORLESS:` print from Lua; the host handles a few of them itself first. */
  onPrint(message: string): void;
  /** The boot or the runtime went wrong, or a stalled boot moved again; see `DegradedState`. Told
   * once per change, and on connect when the page was already stalled or failed. */
  onDegraded(state: DegradedState): void;
  artwork: HostArtworkCache;
  /** How many card scans the host keeps staged, evicting the least recently wanted beyond it: the
   * adapters' cap on a wanted list (LUA_ART_SLOTS), so a list that fits is never evicted. */
  artSlots: number;
  mailboxes: typeof MAILBOXES;
}

export interface ColorlessHost {
  connect(bridge: ColorlessBridge): void;
  /** Replaces a mailbox file's text. Writes made before the runtime exists land in preRun. */
  writeMailbox(file: string, text: string): void;
  /** Card art in priority order. */
  wantArt(cards: readonly ArtRequest[]): void;
}

declare global {
  interface Window {
    colorlessHost: ColorlessHost;
  }
}
