import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./index.css";
import { router } from "./App";
import { FontProvider } from "./features/settings";

// Seed the glow layout before first paint so the home page doesn't slide in
// from the default; RootLayout keeps it in sync on later navigations.
document.body.dataset.glow = window.location.pathname === "/" ? "sides" : "stacked";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('Root element "#root" was not found in the document.');
}

createRoot(rootElement).render(
  <StrictMode>
    <FontProvider>
      <RouterProvider router={router} />
    </FontProvider>
  </StrictMode>,
);
