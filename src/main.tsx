import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./index.css";
import { router } from "./App";

// Seed the glow layout before first paint so the home page doesn't slide in
// from the default; RootLayout keeps it in sync on later navigations.
document.body.dataset.glow = window.location.pathname === "/" ? "sides" : "stacked";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
