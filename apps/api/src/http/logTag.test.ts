import { describe, expect, it } from "vitest";
import { accountTag, logTag, UNTAGGED } from "./logTag";

const env = { LOG_TAG_KEY: "test-log-tag-key" };
const USER = "4a1f2a8e-0c55-4bd6-9a4e-6b7a3f0e9d21";

describe("logTag", () => {
  it("reads UNTAGGED without a key, never the value itself", async () => {
    for (const missing of [undefined, {}, { LOG_TAG_KEY: "" }]) {
      expect(await accountTag(missing, USER)).toBe(UNTAGGED);
    }
  });

  it("is a stable 12-character base64url MAC of the value under the key", async () => {
    const tag = await accountTag(env, USER);
    expect(tag).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await accountTag(env, USER)).toBe(tag);
    expect(tag).not.toContain(USER.slice(0, 8));
    expect(await accountTag(env, "another-user")).not.toBe(tag);
    expect(await accountTag({ LOG_TAG_KEY: "another-key" }, USER)).not.toBe(tag);
  });

  it("keeps an account and a network apart even for the same text", async () => {
    expect(await logTag(env, "net", USER)).not.toBe(await logTag(env, "account", USER));
  });
});
