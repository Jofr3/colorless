import { existsSync, readFileSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";

// Content-Security-Policy for the production HTML only, injected at build time so it does not break
// the dev server's HMR (inline scripts and a websocket).
function buildCsp(apiOrigin: string): string {
  const apiWsOrigin = apiOrigin.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    `img-src 'self' data: blob: ${apiOrigin}`,
    "media-src 'self' data: blob:",
    `connect-src 'self' ${apiOrigin} ${apiWsOrigin}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function cspPlugin(csp: string): Plugin {
  return {
    name: "html-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

// The /love/ files keep fixed names (love.js and game.js locate their
// siblings by name), so they are versioned by query string instead:
// `build:lua` writes public/love/versions.json, and this appends each file's
// hash to index.html's /love/ references (host.js versions the rest itself).
// Production serves /love/* as immutable (public/_headers), so the build
// refuses a reference it can't version; dev only warns, since a missing file
// there just means `build:lua` hasn't run. CI bundles without the Lua build
// (it needs Balatro's source), so LOVE_VERSIONS_OPTIONAL=1 makes the build warn too.
function loveVersionsPlugin(): Plugin {
  const manifest = "public/love/versions.json";
  let strict = false;
  return {
    name: "love-versions",
    configResolved(config) {
      strict = config.command === "build" && process.env.LOVE_VERSIONS_OPTIONAL !== "1";
    },
    transformIndexHtml(html) {
      const versions: Record<string, string> = existsSync(manifest)
        ? JSON.parse(readFileSync(manifest, "utf8"))
        : {};
      return html.replace(/(src|href)="\/love\/([^"?]+)"/g, (match, attribute, name) => {
        const version = versions[name];
        if (version) return `${attribute}="/love/${name}?v=${version}"`;
        const problem = `no content hash for /love/${name} in ${manifest}; run \`bun run build:lua\``;
        if (strict) throw new Error(problem);
        console.warn(problem);
        return match;
      });
    },
  };
}

// index.html is the love.js host page. `bun run build:lua` generates the
// runtime, game package and host script/styles into public/love/, which Vite
// serves at /love/ in dev and copies into dist/love/ on build; the page's one
// module script (src/lua/bridge.ts) is bundled with the configured api origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const apiOrigin = (env.VITE_API_ORIGIN ?? "http://localhost:8787").replace(/\/+$/, "");
  return {
    plugins: [loveVersionsPlugin(), cspPlugin(buildCsp(apiOrigin))],
    build: {
      // Match the TypeScript target so output isn't down-levelled further than needed.
      target: "es2022",
      // Emit source maps but don't reference them from the bundles ("hidden"), so
      // production stack traces stay resolvable (error reporting) without shipping
      // a //# sourceMappingURL that exposes source in end-users' devtools.
      // public/.assetsignore keeps the maps out of the deployed assets.
      sourcemap: "hidden",
      // The rules engine loads as one lazy chunk with the game table (~620 kB,
      // ~150 kB gzipped); it splits no further, so the default 500 kB warning is noise.
      chunkSizeWarningLimit: 1000,
    },
  };
});
