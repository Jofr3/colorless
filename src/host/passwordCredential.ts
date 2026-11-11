/** Offering a password sign-in to the browser's password manager. The auth fields are
 * hidden proxies and the sign-in is a fetch, not a form navigation, so a browser's own heuristics
 * may never offer to save; the Credential Management API asks it directly. Chromium has it;
 * Firefox and Safari have no PasswordCredential and are left to their heuristics. */

interface PasswordCredentialData {
  id: string;
  password: string;
  name?: string;
}
type PasswordCredentialConstructor = new (data: PasswordCredentialData) => unknown;
interface CredentialStore {
  store?(credential: unknown): Promise<unknown>;
}

/** Hands `email` and `password` to the browser after a sign-in or registration succeeded. True when
 * it was offered; it never throws, and a refused or failed store is ignored. */
export function storePasswordCredential(email: string, password: string, name: string): boolean {
  try {
    const PasswordCredential = (
      globalThis as { PasswordCredential?: PasswordCredentialConstructor }
    ).PasswordCredential;
    const credentials = (globalThis.navigator as { credentials?: CredentialStore } | undefined)
      ?.credentials;
    if (!email || !password || typeof PasswordCredential !== "function" || !credentials?.store)
      return false;
    const credential = new PasswordCredential({ id: email, password, name: name || email });
    void Promise.resolve(credentials.store(credential)).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
