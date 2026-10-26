/** The page-level contract between the love.js host script (frontend/lua/web/host.js) and the
 * bridge module (src/lua/bridge.ts). The host script runs first and defines
 * `window.colorlessHost`; the bridge connects to it before window load, when Love() starts. */

export type BridgeScreen = "library" | "builder" | "sandbox" | "simulator" | "online" | "account";

export interface ArtRequest {
  id: string;
  url: string;
}

export interface AuthRequest {
  mode: "login" | "register";
  email: string;
  password: string;
  name: string;
}

/** The artwork store the host reads card art and transition art from. */
export interface HostArtworkCache {
  get(id: string): Promise<Blob | null>;
  put(id: string, blob: Blob): Promise<boolean>;
  pick(): Promise<{ id: string; blob: Blob } | null>;
  markShown(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** The page the router settled on, with its document title and canvas label. */
export interface PageView {
  page: string;
  id: string;
  title: string;
  label: string;
}

/** What the bridge hands the host when it connects. */
export interface ColorlessBridge {
  command(screen: BridgeScreen, raw: string): void;
  navigate(page: string): void;
  authenticate(request: AuthRequest): void;
  artwork: HostArtworkCache;
}

export interface ColorlessHost {
  connect(bridge: ColorlessBridge): void;
  /** A screen's snapshot for Lua. */
  publish(screen: BridgeScreen, snapshot: string): void;
  showPage(view: PageView): void;
  /** Ends any text edit, publishing its last value. */
  finishInputs(): void;
  /** Card art in priority order. */
  wantArt(cards: readonly ArtRequest[]): void;
}

declare global {
  interface Window {
    colorlessHost: ColorlessHost;
  }
}
