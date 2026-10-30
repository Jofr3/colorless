/** The slice of the love.js (Emscripten) runtime the host script uses. */

export {};

declare global {
  interface LoveRuntime {
    FS_createDataFile(
      parent: string,
      name: string,
      data: string | Uint8Array,
      canRead: boolean,
      canWrite: boolean,
    ): void;
    FS_unlink(path: string): void;
    FS_createPath(parent: string, path: string, canRead: boolean, canWrite: boolean): string;
  }

  /** The Network Information API's Save-Data hint (Chromium only; absent elsewhere). */
  interface Navigator {
    readonly connection?: { readonly saveData?: boolean };
  }

  interface LoveModuleConfig {
    arguments: string[];
    locateFile(path: string): string;
    INITIAL_MEMORY: number;
    canvas: HTMLCanvasElement;
    preRun: ((module: LoveRuntime) => void)[];
    print(message: string): void;
    printErr(message: string): void;
    onAbort(): void;
    /** The game package's download, which build.mjs routes here from game.js's loader; `receive`
     * gets the unpacked package. */
    fetchPackage(url: string, receive: (bytes: ArrayBuffer) => void): void;
    /** Emscripten's hook for instantiating the runtime itself; returns `{}` when asynchronous. */
    instantiateWasm?(
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ): object;
  }

  /** game.js reads this global while it parses, so it must exist before that script runs. */
  var Module: LoveModuleConfig;
  /** love.js's MODULARIZE factory; defined once love.js has run. */
  var Love: ((module: LoveModuleConfig) => Promise<LoveRuntime>) | undefined;
}
