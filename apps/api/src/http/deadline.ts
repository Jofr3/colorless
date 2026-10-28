// A deadline for a request to another server. A Worker's handler has no wall-clock limit while its
// client stays connected, so an upstream that never answers would hold the response for good.

export type Deadline = {
  /** Aborts once the time is up, for the fetch to pass on. */
  signal: AbortSignal;
  /** `work`, or a rejection with a TimeoutError once the time is up, whichever comes first, so a
      body read or a fetch that ignores its signal is bounded too. */
  within<T>(work: Promise<T>): Promise<T>;
  /** Stops the clock once the work is done. */
  clear(): void;
};

export function deadline(ms: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`no answer within ${ms} ms`, "TimeoutError")),
    ms,
  );
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
      once: true,
    });
  });
  // Raced by `within` only; nothing else waits on it.
  expired.catch(() => {});
  return {
    signal: controller.signal,
    within: (work) => Promise.race([work, expired]),
    clear: () => clearTimeout(timer),
  };
}
