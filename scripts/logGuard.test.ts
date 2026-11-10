import { describe, expect, it } from "vitest";
import { logGuardReport } from "./log-guard";

const RUNBOOK = [
  "#### 3.7.3 Backup",
  '| `evt = "sweep"` | `ignored` |',
  "#### 3.7.4 Monitoring",
  "| Query | What it finds |",
  '| `evt = "auth"` | `login_ok`, `binding_error` and `oauth_linked` (`claimed`). |',
  '| `evt = "lobby"` | Lobby events, and `rate_limited`. |',
  "| `kind` | Fields | When |",
  "| `hello_refused` *t* | `cause` | A hello claimed no seat. |",
  "| `handoff_failed`, `forfeit` | `cause` | A match could not start. |",
  "#### 3.7.5 Next",
  '| `evt = "late"` | `after_the_section` |',
].join("\n");

const report = (path: string, text: string, runbook = RUNBOOK) =>
  logGuardReport([{ path, text }], runbook);
const failure = (path: string, text: string) => {
  const result = report(path, text);
  expect(result.ok).toBe(false);
  return result.lines.join("\n");
};

describe("log-guard", () => {
  it("passes documented lines with counts, tags and spreads", () => {
    const text = [
      "// console.log(body) stays out",
      'const note = "console.warn";',
      'logInfo("auth", "login_ok", { method: "password", account, rehashed });',
      'logEventThrottled("lobby", "rate_limited", { route, ...errorFields(error), sessions: 3 });',
      'logInfo("auth", "oauth_linked", { claimed, ...(claimed ? { sessionsRevoked: 2 } : {}) });',
      'logEventThrottledBy(type, "lobby", "hello_refused", { code: 1013, cause: "full" });',
      'await bindingRefuses(c.env.AUTH_LIMIT, key, "auth", scope);',
      "const other = { email, ip };",
    ].join("\n");
    expect(report("auth/routes.ts", text)).toEqual({
      ok: true,
      lines: [
        "1 API files log only through http/log.ts with no denied field; 5 evt/kind pairs, all in the runbook",
      ],
    });
  });

  it("reads the lobby's own log methods as evt lobby, and its forwarders", () => {
    const text = [
      'await this.log("handoff_failed", { cause, error });',
      'await this.info("forfeit", { seat, cause });',
      'logEvent("lobby", kind, line);',
    ].join("\n");
    expect(report("lobby/lobbyDO.ts", text).ok).toBe(true);
    expect(failure("lobby/lobbyDO.ts", 'await this.log("seat_orphaned", { seats: 1 });')).toContain(
      "apps/api/src/lobby/lobbyDO.ts:1: `lobby` `seat_orphaned` is not in",
    );
    expect(failure("auth/routes.ts", 'logEvent("lobby", kind, line);')).toContain(
      "evt and kind must be string literals",
    );
  });

  it("lets log.ts alone call console", () => {
    expect(
      report("http/log.ts", "console.warn(JSON.stringify({ evt, kind, ...fields }));").ok,
    ).toBe(true);
    expect(failure("decks/routes.ts", "\nconsole.log(body);")).toContain(
      "apps/api/src/decks/routes.ts:2: a console call",
    );
    expect(failure("ingest/run.ts", 'console["error"](error);')).toContain("a console call");
  });

  it.each([
    ["an email", 'logInfo("auth", "login_ok", { account, email: body.email });', "email"],
    ["a shorthand key", 'logEvent("auth", "login_ok", { displayName });', "displayName"],
    ["a quoted key", 'logEvent("auth", "login_ok", { "userId": user.id });', "userId"],
    [
      "a key that only contains a word",
      'logEvent("auth", "login_ok", { userEmail });',
      "userEmail",
    ],
    ["an address", 'logEvent("auth", "login_ok", { clientIp: ip });', "clientIp"],
    ["a name", 'logEvent("auth", "login_ok", { name: deck.name });', "name"],
    [
      "a spread literal",
      'logInfo("auth", "login_ok", { ...(a ? { sessionToken: t } : {}) });',
      "sessionToken",
    ],
    ["a lobby line", 'await this.log("forfeit", { seat, deckName });', "deckName"],
  ])("fails %s", (_label, text, key) => {
    expect(failure("lobby/lobbyDO.ts", text)).toContain(`log field \`${key}\``);
  });

  it("reads the fields a LogFields helper returns", () => {
    const text =
      "export function fieldsOf(user: User): LogFields {\n  return { session: user.session };\n}";
    expect(failure("http/errors.ts", text)).toContain(
      "apps/api/src/http/errors.ts:2: log field `session`",
    );
  });

  it("reads only the Monitoring section of the runbook", () => {
    expect(failure("x.ts", 'logEvent("late", "after_the_section");')).toContain("is not in");
    expect(failure("x.ts", 'logEvent("sweep", "ignored");')).toContain("is not in");
    expect(failure("x.ts", 'logEvent("auth", "logout");')).toContain("`auth` `logout` is not in");
    expect(report("x.ts", "", "#### 3.7.5 Other\n").lines.join("\n")).toContain(
      'has no "#### 3.7.4 " section',
    );
  });
});
