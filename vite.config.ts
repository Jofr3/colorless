/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";

// Content-Security-Policy for the production HTML only. It's injected at build
// time (not kept in index.html) so it can't strangle the dev server, whose HMR
// needs inline scripts and a websocket. Allowlist: our own origin (the page,
// the bundled bridge and the love.js runtime under /love/); the api origin
// (card images fetched for the Lua artwork cache, the api client, and its
// ws(s) twin for the lobby WebSocket); 'wasm-unsafe-eval' to compile
// love.wasm; data:/blob: for the SVG favicon and the runtime's decoded
// images and audio. Scripts stay tight: the build emits external scripts
// only, no inline script or handler. The api origin mirrors
// src/lib/apiOrigin.ts: `VITE_API_ORIGIN` (from the environment or a .env
// file such as .env.production, via loadEnv), falling back to wrangler dev's
// default port.
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

// index.html is the love.js host page. `bun run build:lua` generates the
// runtime, game package and host script/styles into public/love/, which Vite
// serves at /love/ in dev and copies into dist/love/ on build; the page's one
// module script (src/lua/bridge.ts) is bundled with the configured api origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const apiOrigin = (env.VITE_API_ORIGIN ?? "http://localhost:8787").replace(/\/+$/, "");
  return {
    plugins: [cspPlugin(buildCsp(apiOrigin))],
    test: {
      // Every suite is pure logic (adapters, reducers, parsing), so the fast
      // Node environment covers them all.
      environment: "node",
      include: [
        "src/**/*.{test,spec}.ts",
        "apps/*/src/**/*.{test,spec}.ts",
        "packages/*/src/**/*.{test,spec}.ts",
      ],
    },
    build: {
      // Match the TypeScript target so output isn't down-levelled further than needed.
      target: "es2022",
      // Emit source maps but don't reference them from the bundles ("hidden"), so
      // production stack traces stay resolvable (error reporting) without shipping
      // a //# sourceMappingURL that exposes source in end-users' devtools.
      // public/.assetsignore keeps the maps out of the deployed assets.
      sourcemap: "hidden",
      // The page has one module script, the bridge, and it bundles the whole
      // rules engine for local play (~780 kB, ~195 kB gzipped). There is no
      // other entry to split it against, so the default 500 kB warning is noise.
      chunkSizeWarningLimit: 1000,
    },
  };
});
