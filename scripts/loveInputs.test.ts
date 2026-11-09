import { describe, expect, it } from "vitest";
import { LOVE_JS, type LoveJsFile, loveJsProblems, sourceCommit } from "./love-inputs";

const PINNED = { ...LOVE_JS.sha256 } as Record<LoveJsFile, string | undefined>;
const COMMIT = "f01aba9fde0d3f8d48fb6daf0aec1c6de5a19e39";

describe("loveJsProblems", () => {
  it("accepts love.js 11.4.1 with every pinned hash", () => {
    expect(LOVE_JS.version).toBe("11.4.1");
    expect(loveJsProblems("11.4.1", PINNED)).toEqual([]);
  });

  it("refuses another version, naming both", () => {
    expect(loveJsProblems("11.5.0", PINNED)).toEqual(["love.js is 11.5.0, not 11.4.1"]);
    expect(loveJsProblems(undefined, PINNED)).toEqual(["love.js is missing a version, not 11.4.1"]);
  });

  it("names each file whose hash differs, or that is missing", () => {
    const wasm = "0".repeat(64);
    expect(
      loveJsProblems("11.4.1", { ...PINNED, "src/compat/love.wasm": wasm, "index.js": undefined }),
    ).toEqual([
      "love.js has no index.js",
      `love.js's src/compat/love.wasm has sha256 ${wasm}, not the pinned ${LOVE_JS.sha256["src/compat/love.wasm"]}`,
    ]);
  });
});

describe("sourceCommit", () => {
  /** A fake `git -C <source>`: each command's stdout, or undefined for a failing one. */
  const git =
    (answers: Record<string, string | undefined>) =>
    (args: readonly string[]): string | undefined =>
      answers[args.join(" ")];

  it("records the commit, and clean resources", () => {
    expect(
      sourceCommit(
        git({
          "rev-parse --show-prefix": "\n",
          "rev-parse HEAD": `${COMMIT}\n`,
          "status --porcelain -- resources": "",
        }),
      ),
    ).toEqual({ commit: COMMIT, resourcesClean: true });
  });

  it("says when the resources differ from the commit", () => {
    expect(
      sourceCommit(
        git({
          "rev-parse --show-prefix": "\n",
          "rev-parse HEAD": COMMIT,
          "status --porcelain -- resources": " M resources/sounds/win.ogg\n",
        }),
      ),
    ).toEqual({ commit: COMMIT, resourcesClean: false });
  });

  it("records nothing outside a checkout, or inside another repository", () => {
    expect(sourceCommit(git({}))).toBeNull();
    expect(
      sourceCommit(
        git({ "rev-parse --show-prefix": "vendor/balatro/\n", "rev-parse HEAD": COMMIT }),
      ),
    ).toBeNull();
  });
});
