import { displayNameField, LOBBY_CODE_ALPHABET } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { generateHandle, HANDLE_PREFIX } from "./handle";

describe("generateHandle", () => {
  it("is Trainer- and four lobby-alphabet characters, a valid display name", () => {
    const pattern = new RegExp(`^${HANDLE_PREFIX}[${LOBBY_CODE_ALPHABET}]{4}$`);
    for (let i = 0; i < 200; i++) {
      const handle = generateHandle();
      expect(handle).toMatch(pattern);
      expect(displayNameField.parse(handle)).toBe(handle);
    }
  });

  it("varies", () => {
    const handles = new Set(Array.from({ length: 50 }, generateHandle));
    expect(handles.size).toBeGreaterThan(45);
  });
});
