// The caller's address as a rate-limit key part (auth/rateLimit.ts, http/ipRateLimit.ts).

import type { Context } from "hono";

/**
 * Cloudflare's CF-Connecting-IP (set on every request, wrangler dev included), reduced to the
 * unit one caller controls: an IPv4 address as is, an IPv6 address as its /64 prefix, since a
 * single host is usually handed a whole /64 and could otherwise mint a fresh key per request.
 */
export function clientIpKey(c: Context): string {
  return ipKey(c.req.header("cf-connecting-ip") ?? "unknown");
}

export function ipKey(ip: string): string {
  if (!ip.includes(":")) {
    return ip;
  }
  const [head = "", tail] = ip.toLowerCase().split("::", 2);
  const groups = head === "" ? [] : head.split(":");
  if (tail !== undefined) {
    const tailGroups = tail === "" ? [] : tail.split(":");
    groups.push(...Array<string>(Math.max(8 - groups.length - tailGroups.length, 0)).fill("0"));
    groups.push(...tailGroups);
  }
  const prefix = groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}
