// jsdom doesn't implement these; components probe them on mount (tilt/scroll
// hooks want matchMedia + ResizeObserver, native <dialog>s want showModal).
// Every assignment is guarded in case a newer jsdom grows them. Call from a
// beforeAll in files tagged `// @vitest-environment jsdom`.

/** Install the matchMedia / ResizeObserver / <dialog> shims this app's
    components touch. Idempotent. */
export function installDomShims(): void {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof window.ResizeObserver;
  }
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
  }
}
