import { Suspense, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { GlowBackground } from "../features/background/GlowBackground";
import { SettingsButton } from "./SettingsButton";

// Persistent shell around every route. It maps the current path to the
// `data-glow` layout on <body> — `sides` on the home dashboard, `stacked`
// (top/bottom) everywhere else. The WebGL GlowBackground renders the shared
// blue/red glow (the `data-glow` attribute still drives the index.css gradient
// kept as a no-WebGL fallback). The keyed wrapper replays the content fade-in
// on each navigation.
export function RootLayout() {
  const { pathname } = useLocation();

  // Layout effect (not useEffect) so the new layout attribute is set before
  // paint — the glow transition starts on the first frame, with no extra delay.
  useLayoutEffect(() => {
    document.body.dataset.glow = pathname === "/" ? "sides" : "stacked";
  }, [pathname]);

  return (
    <>
      {/* Shared blue/red glow, behind every route and persistent across them. */}
      <GlowBackground />
      {/* Keyed wrapper replays the fade-in on each navigation. The Suspense
          boundary covers the lazily-loaded route leaves (Playmat, Decks); the
          glow behind it stays visible while a route chunk loads. */}
      <div key={pathname} className="route-view">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
      {/* Persistent across navigations; redundant on the settings page itself. */}
      {pathname !== "/settings" && <SettingsButton />}
    </>
  );
}
