import { afterEach, describe, expect, it, vi } from "vitest";
import { storePasswordCredential } from "./passwordCredential";

afterEach(() => vi.unstubAllGlobals());

/** A browser with the Credential Management API: PasswordCredential and navigator.credentials. */
function credentialApi(store = vi.fn(async () => {})) {
  class PasswordCredential {
    constructor(readonly data: { id: string; password: string; name?: string }) {}
  }
  vi.stubGlobal("PasswordCredential", PasswordCredential);
  vi.stubGlobal("navigator", { credentials: { store } });
  return { store, PasswordCredential };
}

describe("storePasswordCredential (audit BR7)", () => {
  it("offers the signed-in email and password to the browser's password manager", async () => {
    const { store, PasswordCredential } = credentialApi();
    expect(storePasswordCredential("ash@example.com", "pikachu123", "Ash")).toBe(true);
    expect(store).toHaveBeenCalledOnce();
    const [credential] = store.mock.calls[0] as unknown as [
      InstanceType<typeof PasswordCredential>,
    ];
    expect(credential).toBeInstanceOf(PasswordCredential);
    expect(credential.data).toEqual({ id: "ash@example.com", password: "pikachu123", name: "Ash" });
  });

  it("names the credential by its email when no display name was typed", () => {
    const { store } = credentialApi();
    storePasswordCredential("ash@example.com", "pikachu123", "");
    const [credential] = store.mock.calls[0] as unknown as [{ data: { name: string } }];
    expect(credential.data.name).toBe("ash@example.com");
  });

  it("does nothing where the browser has no PasswordCredential, or no store", () => {
    vi.stubGlobal("navigator", { credentials: { store: vi.fn() } });
    expect(storePasswordCredential("ash@example.com", "pikachu123", "")).toBe(false);
    vi.stubGlobal("PasswordCredential", class {});
    vi.stubGlobal("navigator", {});
    expect(storePasswordCredential("ash@example.com", "pikachu123", "")).toBe(false);
  });

  it("never throws, whether the constructor throws or the store rejects", async () => {
    vi.stubGlobal(
      "PasswordCredential",
      class {
        constructor() {
          throw new TypeError("bad credential");
        }
      },
    );
    vi.stubGlobal("navigator", { credentials: { store: vi.fn() } });
    expect(storePasswordCredential("ash@example.com", "pikachu123", "")).toBe(false);
    const rejected = vi.fn(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    credentialApi(rejected);
    expect(storePasswordCredential("ash@example.com", "pikachu123", "")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("stores nothing without both an email and a password", () => {
    const { store } = credentialApi();
    expect(storePasswordCredential("", "pikachu123", "")).toBe(false);
    expect(storePasswordCredential("ash@example.com", "", "")).toBe(false);
    expect(store).not.toHaveBeenCalled();
  });
});
