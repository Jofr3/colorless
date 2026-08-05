import { Suspense, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
// Module path on purpose (not the features/auth barrel): the barrel also
// exports the lazy login/register pages, and RootLayout is eager.
import { AccountButton } from "../features/auth/AccountButton";
import { GlowBackground } from "../features/background/GlowBackground";
import { SettingsButton } from "./SettingsButton";

// Persistent shell around every route. It maps the current path to the
// `data-glow` layout on <body> — `sides` on the home dashboard, `stacked`
// (top/bottom) everywhere else. The WebGL GlowBackground renders the shared
// blue/red glow (the `data-glow` attribute still drives the index.css gradient
// kept as a no-WebGL fallback). The keyed wrapper replays the content fade-in
// on each navigation.
const APP_NAME = "Luminous";

// Per-route browser/tab/screen-reader title. Home ("/") and anything unmapped
// fall back to the bare app name.
const PAGE_TITLES: Record<string, string> = {
  "/play": "Play",
  "/simulator": "Sandbox",
  "/decks": "Decks",
  "/login": "Sign in",
  "/register": "Create account",
  "/settings": "Settings",
};

// The title for a path: exact matches first, then the online lobby's dynamic
// routes (/lobby and /lobby/:code) which share the "Online" title.
function titleForPath(pathname: string): string | undefined {
  if (pathname === "/lobby" || pathname.startsWith("/lobby/")) return "Online";
  return PAGE_TITLES[pathname];
}

export function RootLayout() {
  const { pathname } = useLocation();

  // Layout effect (not useEffect) so the new layout attribute is set before
  // paint — the glow transition starts on the first frame, with no extra delay.
  useLayoutEffect(() => {
    document.body.dataset.glow = pathname === "/" ? "sides" : "stacked";
    const page = titleForPath(pathname);
    document.title = page ? `${page} · ${APP_NAME}` : APP_NAME;
  }, [pathname]);

  return (
    <>
      {/* First focusable element: lets keyboard users jump past the persistent
          corner controls straight to the route content. */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
      >
        Skip to main content
      </a>
      {/* Shared blue/red glow, behind every route and persistent across them. */}
      <GlowBackground />
      {/* Keyed wrapper replays the fade-in on each navigation. The Suspense
          boundary covers the lazily-loaded route leaves (Playmat, Decks); the
          glow behind it stays visible while a route chunk loads. */}
      <div key={pathname} id="main-content" tabIndex={-1} className="route-view outline-none">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
      {/* Persistent across navigations; redundant on the settings page itself. */}
      {pathname !== "/settings" && <SettingsButton />}
      {/* Stacked directly above the settings button; redundant on the auth
          pages themselves (they ARE the sign-in surface). */}
      {pathname !== "/login" && pathname !== "/register" && <AccountButton />}
    </>
  );
}
