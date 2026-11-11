// frontend/lua/packageUuid.mjs: the Lua build's game.js names its package by a uuid derived from
// game.data, which love.js's loader compares with the one stored beside its IndexedDB copy. It
// lives here for the Node types.

import { describe, expect, it } from "vitest";
import { repoPath } from "./lib/repo";

/** The module's exports, as this suite (a .ts file without allowJs) types them. */
type PackageUuid = {
  packageUuid: (gameData: Uint8Array) => string;
  withPackageUuid: (gameJs: string, gameData: Uint8Array) => string;
};
const { packageUuid, withPackageUuid }: PackageUuid = await import(
  repoPath("frontend/lua/packageUuid.mjs")
);

const bytes = (text: string) => new TextEncoder().encode(text);
/** The shape of love.js 11.4.1's game.js around its one stamp. */
const gameJs = (uuid: string) =>
  `    var PACKAGE_UUID = metadata.package_uuid;\n  loadPackage({"package_uuid":"${uuid}","remote_package_size":3,"files":[]});\n`;
const RANDOM = "65310af7-655b-4be7-a6f3-9f7ee67ebb91";

describe("packageUuid", () => {
  it("is sha256(game.data)'s first 128 bits as 8-4-4-4-12", () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(packageUuid(bytes("abc"))).toBe("ba7816bf-8f01-cfea-4141-40de5dae2223");
  });

  it("is the same for the same bytes and differs when one byte changes", () => {
    expect(packageUuid(bytes("game data"))).toBe(packageUuid(bytes("game data")));
    expect(packageUuid(bytes("game data"))).not.toBe(packageUuid(bytes("game datb")));
  });
});

describe("withPackageUuid", () => {
  it("replaces love.js's random stamp with game.data's uuid and nothing else", () => {
    const data = bytes("abc");
    expect(withPackageUuid(gameJs(RANDOM), data)).toBe(gameJs(packageUuid(data)));
  });

  it("gives one game.js for two random stamps over the same game.data", () => {
    const data = bytes("abc");
    expect(withPackageUuid(gameJs(RANDOM), data)).toBe(
      withPackageUuid(gameJs("00000000-0000-4000-8000-000000000000"), data),
    );
  });

  it("refuses a game.js without the stamp, or with two", () => {
    const data = bytes("abc");
    expect(() => withPackageUuid("loadPackage({});", data)).toThrow(/0 "package_uuid" stamps/);
    expect(() => withPackageUuid(gameJs(RANDOM) + gameJs(RANDOM), data)).toThrow(
      /2 "package_uuid" stamps/,
    );
  });
});
