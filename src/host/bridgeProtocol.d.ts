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

/** What the bridge hands the host when it connects. */
export interface ColorlessBridge {
  /** Every `COLORLESS:` print from Lua; the host handles a few of them itself first. */
  onPrint(message: string): void;
  /** The boot or the runtime went wrong, or a stalled boot moved again. "stalled": the download
   * stopped moving before ready; "recovered": it moved again; "failed": the page shows its failure
   * overlay (a Lua error, lost graphics, an abort), so nothing can play on and live online links
   * close as a closed tab's would. */
  onDegraded(state: "stalled" | "failed" | "recovered"): void;
  artwork: HostArtworkCache;
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
