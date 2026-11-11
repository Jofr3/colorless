// @ts-check
import { createHash } from "node:crypto";

// love.js stamps game.js with a random `package_uuid` on every build. Its loader keeps game.data in
// IndexedDB under the package's name and reuses that copy only while the stored uuid equals
// game.js's; the file table (names, offsets) is always read from game.js. So a uuid derived from
// game.data's bytes reuses the cache exactly when those bytes are unchanged, and the build is
// reproducible.

/** game.data's uuid: the first 128 bits of its sha256, spelled 8-4-4-4-12.
    @param {Uint8Array} gameData */
export const packageUuid = (gameData) => {
  const hex = createHash("sha256").update(gameData).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

const STAMP = /"package_uuid":"[^"]*"/g;

/** game.js with its one `package_uuid` replaced by game.data's; throws unless it occurs exactly once.
    @param {string} gameJs @param {Uint8Array} gameData */
export const withPackageUuid = (gameJs, gameData) => {
  const found = gameJs.match(STAMP)?.length ?? 0;
  if (found !== 1)
    throw new Error(
      `love.js's game.js has ${found} "package_uuid" stamps where exactly one was expected; update frontend/lua/packageUuid.mjs`,
    );
  return gameJs.replace(STAMP, `"package_uuid":"${packageUuid(gameData)}"`);
};
