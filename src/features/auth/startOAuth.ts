// Kicking off an OAuth flow means assigning window.location to the api's
// /auth/oauth/:provider url (it 302s to the provider). But until the
// provider's secrets are installed the api answers that url with a 503 JSON
// body — and a plain navigation would dump the user on a raw JSON page. So
// we PROBE first with `redirect: "manual"`: in a cross-origin fetch a
// redirect comes back as an unreadable `opaqueredirect` (status 0), which
// is exactly the "provider is configured" signal, while the 503 stays
// readable (the api's CORS middleware covers /auth, credential echo and
// all — verified against wrangler dev).

import { oauthStartUrl } from "../../lib/api";

export type OAuthProvider = "discord" | "google";

export type OAuthStartOutcome =
  /** Provider configured — window.location has been pointed at the flow. */
  | "redirected"
  /** The api answered 503: the provider's secrets aren't installed yet. */
  | "unconfigured"
  /** Network failure or an unexpected status. */
  | "failed";

/** Probe the OAuth start url and navigate to it only if it actually
    redirects. Never rejects — outcomes are values so the form can map them
    to aria-live copy. `navigate` is injectable for tests. */
export async function startOAuth(
  provider: OAuthProvider,
  navigate: (url: string) => void = (url) => {
    window.location.href = url;
  },
): Promise<OAuthStartOutcome> {
  const url = oauthStartUrl(provider);
  try {
    const response = await fetch(url, { redirect: "manual", credentials: "include" });
    // Cross-origin: a redirect is an opaqueredirect (status 0). Same-origin
    // setups would see the 3xx itself, so accept that shape too.
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      navigate(url);
      return "redirected";
    }
    if (response.status === 503) return "unconfigured";
    return "failed";
  } catch {
    return "failed";
  }
}
