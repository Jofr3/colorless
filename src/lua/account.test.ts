import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetch } from "../test/fetchStub";
import { USER } from "../test/fixtures";
import { encodeFields, LuaAccount } from "./account";

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
  it("does not load decks or submit a favourite-deck change", async () => {
    const { impl, calls } = stubFetch({
      "GET /auth/me": () => json({ ...USER, favouriteDeckId: "existing-deck" }),
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
  it("round-trips delimiters and unicode without allowing extra mailbox fields", () => {
    const values = ["name\twith\nlines", "Zoë % ", ""];
    expect(encodeFields(values).split("\t").map(decodeURIComponent)).toEqual(values);
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
    expect(new URL(String(impl.mock.calls[0]?.[0])).searchParams.get("redirect")).toBe(
      "/?account",
    );
    expect(account.message).toBe("Google sign-in is not set up yet.");
    expect(account.busy).toBe(false);
  });
});
