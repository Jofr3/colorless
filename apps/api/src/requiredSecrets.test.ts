import { describe, expect, it } from "vitest";
import { missingSecrets, REQUIRED_SECRETS, secretNamesOf } from "./requiredSecrets";

const listing = (...names: string[]) =>
  JSON.stringify(
    names.map((name) => ({ name, type: "secret_text" })),
    null,
    2,
  );

describe("the release gate's secrets listing", () => {
  it("requires the password pepper and the log tag key", () => {
    expect(REQUIRED_SECRETS).toEqual(["PASSWORD_PEPPER", "LOG_TAG_KEY"]);
  });

  it("names nothing missing when production holds both", () => {
    expect(
      missingSecrets(
        listing("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "LOG_TAG_KEY", "PASSWORD_PEPPER"),
      ),
    ).toEqual([]);
  });

  it("names each missing secret, in order", () => {
    expect(missingSecrets(listing("GOOGLE_CLIENT_ID"))).toEqual(["PASSWORD_PEPPER", "LOG_TAG_KEY"]);
    expect(missingSecrets(listing("LOG_TAG_KEY"))).toEqual(["PASSWORD_PEPPER"]);
    expect(missingSecrets("[]")).toEqual(["PASSWORD_PEPPER", "LOG_TAG_KEY"]);
    // Only a whole name counts.
    expect(missingSecrets(listing("PASSWORD_PEPPER_PREVIOUS", "LOG_TAG_KEY"))).toEqual([
      "PASSWORD_PEPPER",
    ]);
  });

  it("reads past warning lines wrangler prints first", () => {
    const output = `▲ [WARNING] A newer version of wrangler is available\n\n${listing("PASSWORD_PEPPER", "LOG_TAG_KEY")}\n`;
    expect(secretNamesOf(output)).toEqual(["PASSWORD_PEPPER", "LOG_TAG_KEY"]);
    expect(secretNamesOf(`[WARNING] old config\n${listing("LOG_TAG_KEY")}`)).toEqual([
      "LOG_TAG_KEY",
    ]);
  });

  it("refuses output it cannot read rather than passing it", () => {
    for (const output of ["", "Not logged in.", "[not json]", '{"name":"PASSWORD_PEPPER"}']) {
      expect(() => missingSecrets(output)).toThrow(/no JSON list/);
    }
    expect(() => missingSecrets('[{"type":"secret_text"}]')).toThrow(/without a name/);
  });
});
