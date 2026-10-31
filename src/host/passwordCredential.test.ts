import { afterEach, describe, expect, it, vi } from "vitest";
import { storePasswordCredential } from "./passwordCredential";

afterEach(() => vi.unstubAllGlobals());

/** Node's process, which the browser-typed tests do not declare. */
const node = (
  globalThis as unknown as {
    process: {
      on(event: "unhandledRejection", listener: () => void): void;
      off(event: "unhandledRejection", listener: () => void): void;
    };
  }
).process;

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
    // A plain function: a vi.fn would watch the promise it returns, which handles the rejection.
    vi.stubGlobal("navigator", {
      credentials: { store: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
    vi.stubGlobal(
      "PasswordCredential",
      class {
        constructor(readonly data: unknown) {}
      },
    );
    const unhandled = vi.fn();
    node.on("unhandledRejection", unhandled);
    try {
      expect(storePasswordCredential("ash@example.com", "pikachu123", "")).toBe(true);
      await new Promise((done) => setTimeout(done, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      node.off("unhandledRejection", unhandled);
    }
  });

  it("stores nothing without both an email and a password", () => {
    const { store } = credentialApi();
    expect(storePasswordCredential("", "pikachu123", "")).toBe(false);
    expect(storePasswordCredential("ash@example.com", "", "")).toBe(false);
    expect(store).not.toHaveBeenCalled();
  });
});
