/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // The current suites cover pure logic (the board reducer, prize math), so
    // the fast Node environment is enough. Switch to "jsdom" (and add the dep)
    // when component/DOM tests are introduced.
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  build: {
    // Match the TypeScript target so output isn't down-levelled further than needed.
    target: "es2022",
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
