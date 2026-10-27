// Stand-ins for Workers Rate Limiting bindings in route tests.

/** A binding allowing `limit` calls per key, recording each key it is asked for. */
export function fakeRateLimit(limit: number): { binding: RateLimit; keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const binding = {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
  return { binding, keys };
}

/** A binding whose every call fails, as when the rate-limit service is unavailable. */
export const brokenRateLimit: RateLimit = {
  limit: () => Promise.reject(new Error("limiter unavailable")),
};
