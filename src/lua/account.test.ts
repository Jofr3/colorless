import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetch } from "../test/fetchStub";
import { USER } from "../test/fixtures";
import { LuaAccount, SESSION_CHECK_MAX_AGE_MS } from "./account";
import { messageWidth } from "./builder";
import { encodeFields } from "./wire";

afterEach(() => vi.unstubAllGlobals());
const setup = () => {
  const publish = vi.fn();
  return { account: new LuaAccount(publish), publish };
};
const session = { "GET /auth/me": () => json(USER) };

describe("Lua account adapter", () => {
  it("distinguishes anonymous sessions from a failed connection", async () => {
    stubFetch({ "GET /auth/me": () => json({}, 401) });
    const { account } = setup();
    await account.refresh();
    expect(account.status).toBe("anonymous");
    stubFetch({ "GET /auth/me": () => json({}, 503) });
    await account.refresh();
    expect(account.status).toBe("error");
    expect(account.busy).toBe(false);
  });
  it("answers navigation refreshes from a recent session check", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { calls } = stubFetch({ ...session, "POST /auth/logout": () => json({}) });
      const { account } = setup();
      const navigate = () => account.command(encodeFields(["refresh"]));
      await account.refresh();
      await navigate();
      expect(calls).toEqual(["GET /auth/me"]);
      vi.advanceTimersByTime(SESSION_CHECK_MAX_AGE_MS);
      await navigate();
      expect(calls).toEqual(["GET /auth/me", "GET /auth/me"]);
      await account.refresh();
      expect(calls).toHaveLength(3);
      await account.command(encodeFields(["logout"]));
      await navigate();
      expect(account.status).toBe("anonymous");
      expect(calls.at(-1)).toBe("POST /auth/logout");
    } finally {
      vi.useRealTimers();
    }
  });
  it("checks again after a failed session check", async () => {
    const { calls } = stubFetch({ "GET /auth/me": () => json({}, 503) });
    const { account } = setup();
    await account.refresh();
    await account.command(encodeFields(["refresh"]));
    expect(calls).toEqual(["GET /auth/me", "GET /auth/me"]);
  });
  it("shows a failed Google sign-in once, on the next anonymous refresh", async () => {
    stubFetch({ "GET /auth/me": () => json({}, 401) });
    const { account } = setup();
    account.noteAuthError("email-in-use");
    await account.refresh();
    expect(account.message).toBe("That email already has an account. Sign in with your password.");
    await account.refresh();
    expect(account.message).toBe("");
    account.noteAuthError("constructor");
    await account.refresh();
    expect(account.message).toBe("Google sign-in failed. Try again.");
  });
  it("saves only the display name using the shared credentialed client", async () => {
    const { impl } = stubFetch({
      ...session,
      "PATCH /auth/me": () => json({ ...USER, displayName: "Zoë" }),
    });
    const { account, publish } = setup();
    await account.refresh();
    await account.command(encodeFields(["save", " Zoë "]));
    const call = impl.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      displayName: "Zoë",
    });
    expect(call?.[1]?.credentials).toBe("include");
    expect(account.message).toBe("Saved.");
    const fields = String(publish.mock.lastCall?.[0]).split("\t").map(decodeURIComponent);
    expect(fields[5]).toBe("Zoë");
  });
  it("saves without loading decks", async () => {
    const { impl, calls } = stubFetch({
      "GET /auth/me": () => json(USER),
      "PATCH /auth/me": () => json(USER),
    });
    const { account } = setup();
    await account.refresh();
    await account.save("Ashley");
    expect(calls).toEqual(["GET /auth/me", "PATCH /auth/me"]);
    const call = impl.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ displayName: "Ashley" });
  });
  it("rejects invalid names without a write", async () => {
    const { impl } = stubFetch(session);
    const { account } = setup();
    await account.refresh();
    await account.save(" ");
    await account.save("a".repeat(65));
    await account.save("Ash\nCOLORLESS:auth:submit");
    expect(account.message).toBe("Names cannot have hidden characters.");
    expect(impl.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
  it("turns an expired save into signed-out state", async () => {
    stubFetch({ ...session, "PATCH /auth/me": () => json({}, 401) });
    const { account } = setup();
    await account.refresh();
    await account.save("Ashley");
    expect(account.status).toBe("anonymous");
    expect(account.user).toBeNull();
  });
  it("retains the account if sign-out fails, and clears it when the session is gone", async () => {
    stubFetch({ ...session, "POST /auth/logout": () => json({}, 503) });
    const { account } = setup();
    await account.refresh();
    await account.signOut();
    expect(account.user?.id).toBe(USER.id);
    expect(account.message).toContain("Could not sign out");
    stubFetch({ "POST /auth/logout": () => json({}, 401) });
    await account.signOut();
    expect(account.user).toBeNull();
    expect(account.status).toBe("anonymous");
  });
  it("ignores duplicate saves while a request is pending", async () => {
    let settle: (response: Response) => void = () => {};
    const { impl } = stubFetch({
      ...session,
      "PATCH /auth/me": () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    });
    const { account } = setup();
    await account.refresh();
    const pending = account.save("Ashley");
    await account.save("Another name");
    settle(json(USER));
    await pending;
    expect(impl.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  });
});

describe("Lua authentication", () => {
  it("signs in through the shared client without publishing credentials", async () => {
    const { impl } = stubFetch({ "POST /auth/login": () => json(USER) });
    const { account, publish } = setup();
    await account.authenticate("login", " ash@example.com ", "private-test-password", "");
    expect(account.status).toBe("authenticated");
    expect(account.user).toEqual(USER);
    expect(JSON.parse(String(impl.mock.calls[0]?.[1]?.body))).toEqual({
      email: USER.email,
      password: "private-test-password",
    });
    expect(impl.mock.calls[0]?.[1]?.credentials).toBe("include");
    expect(JSON.stringify(publish.mock.calls)).not.toContain("private-test-password");
  });
  it("creates an account with an optional trimmed display name", async () => {
    const { impl } = stubFetch({ "POST /auth/register": () => json(USER, 201) });
    const { account } = setup();
    await account.authenticate("register", USER.email, "test-password", " Ash ");
    expect(JSON.parse(String(impl.mock.calls[0]?.[1]?.body)).displayName).toBe("Ash");
    await account.authenticate("register", USER.email, "test-password", " ");
    expect(JSON.parse(String(impl.mock.calls[1]?.[1]?.body))).not.toHaveProperty("displayName");
  });
  it("validates email and registration password before contacting the server", async () => {
    const { impl } = stubFetch({});
    const { account } = setup();
    await account.authenticate("login", "bad", "test-password", "");
    expect(account.message).toContain("email");
    await account.authenticate("register", USER.email, "short", "");
    expect(account.message).toContain("8 characters");
    await account.authenticate("login", USER.email, "", "");
    expect(account.message).toBe("Enter your password.");
    await account.authenticate("login", USER.email, "x".repeat(257), "");
    expect(account.message).toBe("Password is too long.");
    await account.authenticate("register", USER.email, "test-password", "x".repeat(65));
    expect(account.message).toContain("characters for your name");
    await account.authenticate("register", USER.email, "test-password", "Bad\u202EName");
    expect(account.message).toBe("Names cannot have hidden characters.");
    expect(impl).not.toHaveBeenCalled();
  });
  it.each([
    [401, "Wrong email or password."],
    [409, "That email already has an account."],
    [429, "Too many attempts. Wait a moment."],
    [503, "Could not connect. Please try again."],
  ])("reports HTTP %s inline and enables retry", async (status, message) => {
    stubFetch({ "POST /auth/login": () => json({}, status) });
    const { account } = setup();
    await account.authenticate("login", USER.email, "test-password", "");
    expect(account.message).toBe(message);
    expect(account.busy).toBe(false);
    expect(account.user).toBeNull();
  });
  it("ignores a second submit while sign-in is pending", async () => {
    let resolve: (response: Response) => void = () => {};
    const { impl } = stubFetch({
      "POST /auth/login": () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    });
    const { account } = setup();
    const pending = account.authenticate("login", USER.email, "test-password", "");
    await account.authenticate("register", USER.email, "test-password", "Ash");
    resolve(json(USER));
    await pending;
    expect(impl).toHaveBeenCalledTimes(1);
  });
  it("returns Google to the account tab and handles an unconfigured provider", async () => {
    const { impl } = stubFetch({ "GET /auth/oauth/google": () => json({}, 503) });
    const { account } = setup();
    await account.google();
    expect(new URL(String(impl.mock.calls[0]?.[0])).searchParams.get("redirect")).toBe("/?account");
    expect(account.message).toBe("Google sign-in is not set up yet.");
    expect(account.busy).toBe(false);
  });
});

describe("Lua account deletion", () => {
  const fields = (publish: ReturnType<typeof setup>["publish"]) =>
    String(publish.mock.lastCall?.[0]).split("\t").map(decodeURIComponent);

  it("tells Lua whether the account has a password to ask for", async () => {
    stubFetch({ "GET /auth/me": () => json({ ...USER, hasPassword: false }) });
    const { account, publish } = setup();
    await account.refresh();
    expect(fields(publish)[7]).toBe("0");
    stubFetch(session);
    await account.refresh();
    expect(fields(publish)[7]).toBe("1");
  });
  it("deletes with the password and ends signed out", async () => {
    const { impl } = stubFetch({
      ...session,
      "DELETE /auth/me": () => new Response(null, { status: 204 }),
    });
    const { account, publish } = setup();
    await account.refresh();
    await account.deleteAccount("private-test-password", "ash@example.com");
    const call = impl.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ password: "private-test-password" });
    expect(call?.[1]?.credentials).toBe("include");
    expect(account.user).toBeNull();
    expect(account.status).toBe("anonymous");
    expect(account.message).toBe("Account deleted.");
    expect(JSON.stringify(publish.mock.calls)).not.toContain("private-test-password");
  });
  it("sends the typed email, and no password, for an OAuth-only account", async () => {
    const { impl } = stubFetch({
      "GET /auth/me": () => json({ ...USER, hasPassword: false }),
      "DELETE /auth/me": () => new Response(null, { status: 204 }),
    });
    const { account } = setup();
    await account.refresh();
    await account.deleteAccount("", " Ash@Example.com ");
    const call = impl.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ confirmEmail: "Ash@Example.com" });
    expect(account.status).toBe("anonymous");
  });
  it("asks for the password, or the account's email, before contacting the server", async () => {
    const { calls } = stubFetch(session);
    const { account } = setup();
    await account.refresh();
    await account.deleteAccount("", "ash@example.com");
    expect(account.message).toBe("Enter your password.");
    expect(calls).toEqual(["GET /auth/me"]);
    const oauthOnly = stubFetch({ "GET /auth/me": () => json({ ...USER, hasPassword: false }) });
    await account.refresh();
    await account.deleteAccount("", " ");
    expect(account.message).toBe("Type your email to confirm.");
    await account.deleteAccount("", "misty@example.com");
    expect(account.message).toBe("That is not this account's email.");
    expect(oauthOnly.calls).toEqual(["GET /auth/me"]);
    expect(account.status).toBe("authenticated");
  });
  it("keeps an OAuth-only account the server refuses to delete", async () => {
    stubFetch({
      "GET /auth/me": () => json({ ...USER, hasPassword: false }),
      "DELETE /auth/me": () => json({ error: "email confirmation mismatch" }, 403),
    });
    const { account } = setup();
    await account.refresh();
    await account.deleteAccount("", "ash@example.com");
    expect(account.message).toBe("That is not this account's email.");
    expect(account.status).toBe("authenticated");
  });
  it("keeps the account on a wrong password or a limit, and signs out a gone session", async () => {
    let answer = () => json({ error: "invalid password" }, 401);
    stubFetch({ ...session, "DELETE /auth/me": () => answer() });
    const { account } = setup();
    await account.refresh();
    await account.deleteAccount("wrong", "");
    expect(account.message).toBe("Wrong password.");
    expect(account.status).toBe("authenticated");
    answer = () => json({ error: "too many attempts" }, 429);
    await account.deleteAccount("wrong", "");
    expect(account.message).toBe("Too many attempts. Wait a moment.");
    expect(account.user?.id).toBe(USER.id);
    answer = () => json({ error: "unauthorized" }, 401);
    await account.deleteAccount("right", "");
    expect(account.message).toBe("Your session expired. Sign in again.");
    expect(account.status).toBe("anonymous");
    expect(account.busy).toBe(false);
  });
  it("signs out everywhere, keeping the account if that fails", async () => {
    let answer = () => json({ error: "unavailable" }, 503);
    const { calls } = stubFetch({ ...session, "POST /auth/logout-all": () => answer() });
    const { account } = setup();
    await account.refresh();
    await account.command(encodeFields(["logout-all"]));
    expect(account.message).toBe("Could not sign out everywhere. Try again.");
    expect(account.user?.id).toBe(USER.id);
    answer = () => json({});
    await account.command(encodeFields(["logout-all"]));
    expect(calls.filter((call) => call === "POST /auth/logout-all")).toHaveLength(2);
    expect(account.status).toBe("anonymous");
    expect(account.user).toBeNull();
    expect(account.message).toBe("Signed out on every device.");
  });
  it("says so when signing out everywhere finds this session already gone", async () => {
    stubFetch({ ...session, "POST /auth/logout-all": () => json({ error: "unauthorized" }, 401) });
    const { account } = setup();
    await account.refresh();
    await account.signOut(true);
    expect(account.status).toBe("anonymous");
    expect(account.message).toBe("Your session expired. Sign in again.");
  });
  it("explains a Google email that Google has not verified", async () => {
    stubFetch({ "GET /auth/me": () => json({}, 401) });
    const { account } = setup();
    account.noteAuthError("email-unverified");
    await account.refresh();
    expect(account.message).toBe("Google has not verified that email address.");
  });
  it("fits each new account message on one line of the portrait account tab", async () => {
    // The tab draws messages at size 17 across 384 px in portrait; messageWidth measures size 14.
    const limit = (384 * 14) / 17;
    const messages = [
      "Google has not verified that email address.",
      "Signing out everywhere...",
      "Signed out on every device.",
      "Could not sign out everywhere. Try again.",
    ];
    for (const message of messages) expect(messageWidth(message), message).toBeLessThan(limit);
  });
});
