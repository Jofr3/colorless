/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Content-Security-Policy for the production HTML only. It's injected at build
// time (not kept in index.html) so it can't strangle the dev server, whose HMR
// needs inline scripts, eval and a websocket. Allowlist: our own origin; the
// Scrydex image CDN (card faces, loaded as <img> and Pixi textures); Google
// Fonts (stylesheet on googleapis, files on gstatic); data:/blob: for the SVG
// favicon, procedural card-back data-URLs and Pixi's bitmap decode. Inline
// styles are load-bearing (every animated transform is a style attribute), so
// style-src keeps 'unsafe-inline'; scripts do not (the build emits one external
// module, no inline script), so script-src stays tight.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://images.scrydex.com",
  "connect-src 'self' https://images.scrydex.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "html-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin()],
  test: {
    // Default to the fast Node environment for the pure-logic suites (reducers,
    // deck/z-index math, parsing). Component/DOM tests opt into jsdom per file
    // with a `// @vitest-environment jsdom` docblock — see the *.dom.test.tsx
    // files (React Testing Library), so the many pure tests keep the lean env.
    environment: "node",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "apps/*/src/**/*.{test,spec}.{ts,tsx}",
      "packages/*/src/**/*.{test,spec}.{ts,tsx}",
    ],
  },
  build: {
    // Match the TypeScript target so output isn't down-levelled further than needed.
    target: "es2022",
    // Emit source maps but don't reference them from the bundles ("hidden"), so
    // production stack traces stay resolvable (error reporting) without shipping
    // a //# sourceMappingURL that exposes source in end-users' devtools.
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        // Split the large, rarely-changing vendor libs into their own chunks so
        // an app-code edit doesn't bust the Pixi/GSAP/React cache entries.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/pixi.js")) return "pixi";
          if (id.includes("/gsap")) return "gsap";
          if (id.includes("/react") || id.includes("/scheduler")) return "react";
          return undefined;
        },
      },
    },
  },
});
