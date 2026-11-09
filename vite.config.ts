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

// Link previews need absolute URLs, so the production HTML's og:url and og:image get the site's
// origin; the dev server keeps index.html's root-relative ones.
function shareUrlsPlugin(siteOrigin: string): Plugin {
  return {
    name: "share-urls",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        /(<meta property="og:(?:url|image)" content=")\//g,
        (_match, start: string) => `${start}${siteOrigin}/`,
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

// The npm packages the page's bundle may carry: the production dependencies of the page (the root)
// and of the two packages it imports, the ones scripts/third-party-notices.ts prints licences for
// (its WEB_WORKSPACES; dependency audit TRN4). A bundle with any other package, such as a dev
// dependency one value import away, fails the build until it is declared, and so credited.
const NOTICED_WORKSPACES = [".", "packages/engine", "packages/schema"];
const PACKAGE = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//;
function noticedPackagesPlugin(): Plugin {
  const declared = new Set(
    NOTICED_WORKSPACES.flatMap((dir) => {
      const manifest = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
      return Object.entries<string>(manifest.dependencies ?? {})
        .filter(([, spec]) => !spec.startsWith("workspace:"))
        .map(([name]) => name);
    }),
  );
  return {
    name: "noticed-packages",
    apply: "build",
    generateBundle(_options, bundle) {
      const bundled = new Set<string>();
      for (const chunk of Object.values(bundle))
        if (chunk.type === "chunk")
          for (const id of chunk.moduleIds) {
            const name = PACKAGE.exec(id)?.[1];
            if (name !== undefined) bundled.add(name);
          }
      const foreign = [...bundled].filter((name) => !declared.has(name)).sort();
      if (foreign.length > 0)
        this.error(
          `the page bundles ${foreign.join(", ")}, not a production dependency of ${NOTICED_WORKSPACES.join(", ")}; declare it there so THIRD-PARTY-NOTICES.txt carries its licence`,
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
  const siteOrigin = (env.VITE_SITE_ORIGIN ?? "http://localhost:5175").replace(/\/+$/, "");
  return {
    plugins: [
      loveVersionsPlugin(),
      cspPlugin(buildCsp(apiOrigin)),
      shareUrlsPlugin(siteOrigin),
      noticedPackagesPlugin(),
    ],
    server: {
      // The dev server's root is the repo root, so without this it serves any file in it, such as
      // apps/api/.dev.vars (OAuth secret) and the local D1 database under .wrangler/. Setting
      // `deny` replaces Vite's defaults, so the first four entries repeat them.
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          ".dev.vars*",
          "**/.wrangler/**",
          "**/tmp/**",
          "**/apps/**",
        ],
      },
    },
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
