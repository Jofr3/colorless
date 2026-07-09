import { describe, expect, it } from "vitest";
import {
  generateLobbyCode,
  isValidLobbyCode,
  LOBBY_CODE_ALPHABET,
  LOBBY_CODE_LENGTH,
  normalizeLobbyCode,
} from "./lobbyCode";

describe("generateLobbyCode", () => {
  it("produces a code of the fixed length from the alphabet", () => {
    const code = generateLobbyCode();
    expect(code).toHaveLength(LOBBY_CODE_LENGTH);
    for (const ch of code) expect(LOBBY_CODE_ALPHABET).toContain(ch);
  });

  it("is deterministic given a deterministic random source", () => {
    // Always the first symbol.
    expect(generateLobbyCode(() => 0)).toBe(
      LOBBY_CODE_ALPHABET.charAt(0).repeat(LOBBY_CODE_LENGTH),
    );
  });

  it("never indexes past the alphabet when random returns ~1", () => {
    const nearlyOne = () => 0.999999;
    const last = LOBBY_CODE_ALPHABET.charAt(LOBBY_CODE_ALPHABET.length - 1);
    expect(generateLobbyCode(nearlyOne)).toBe(last.repeat(LOBBY_CODE_LENGTH));
  });
});

describe("normalizeLobbyCode", () => {
  it("upper-cases and strips separators", () => {
    expect(normalizeLobbyCode("ab cd")).toBe("ABCD");
    expect(normalizeLobbyCode("a-b-c-d")).toBe("ABCD");
  });

  it("drops look-alike characters not in the alphabet", () => {
    // O, I, L, 0, 1 are excluded from the alphabet.
    expect(normalizeLobbyCode("O1IL")).toBe("");
  });

  it("caps the length", () => {
    expect(normalizeLobbyCode("ABCDEFGH")).toHaveLength(LOBBY_CODE_LENGTH);
  });
});

describe("isValidLobbyCode", () => {
  it("accepts a well-formed code", () => {
    expect(isValidLobbyCode("ABCD")).toBe(true);
  });

  it("rejects the wrong length or stray characters", () => {
    expect(isValidLobbyCode("ABC")).toBe(false);
    expect(isValidLobbyCode("ABCDE")).toBe(false);
    expect(isValidLobbyCode("AB-D")).toBe(false);
    expect(isValidLobbyCode("abcd")).toBe(false);
  });
});
