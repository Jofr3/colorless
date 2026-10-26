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
  }

  interface LoveModuleConfig {
    arguments: string[];
    locateFile(path: string): string;
    INITIAL_MEMORY: number;
    canvas: HTMLCanvasElement;
    preRun: ((module: LoveRuntime) => void)[];
    print(message: string): void;
    printErr(message: string): void;
    setStatus(message: string): void;
    onAbort(): void;
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
