// Starting OAuth means navigating to the api's /auth/oauth/:provider, which redirects to the
// provider, but without provider secrets the api answers with a 503 JSON body. So probe first with
// `redirect: "manual"`: a redirect comes back as an `opaqueredirect` (status 0). The probe has the
// api calls' deadline, so a stalled one cannot leave the account form busy.

import type { OAuthProvider } from "@colorless/schema";
import { oauthStartUrl, REQUEST_TIMEOUT_MS, withDeadline } from "./api";

export type OAuthStartOutcome =
  /** Provider configured — window.location has been pointed at the flow. */
  | "redirected"
  /** The api answered 503: the provider's secrets aren't installed yet. */
  | "unconfigured"
  /** Network failure, no answer in time, or an unexpected status. */
  | "failed";

/** Probe the OAuth start url and navigate to it only if it actually
    redirects. Never rejects — outcomes are values so the form can map them
    to aria-live copy. `navigate` is injectable for tests. */
export async function startOAuth(
  provider: OAuthProvider,
  navigate: (url: string) => void = (url) => {
    window.location.href = url;
  },
  redirect = "/",
): Promise<OAuthStartOutcome> {
  const url = oauthStartUrl(provider, redirect);
  try {
    const response = await withDeadline(REQUEST_TIMEOUT_MS, (signal) =>
      fetch(url, { redirect: "manual", credentials: "include", signal }),
    );
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
