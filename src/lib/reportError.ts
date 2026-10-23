/** Logs a failure the UI recovers from, so it still reaches the console. */
export function reportError(context: string, error: unknown): void {
  console.error(`[colorless] ${context}`, error);
}
