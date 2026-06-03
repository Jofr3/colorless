import { useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";

// Persistent shell around every route. It maps the current path to the
// `data-glow` layout on <body> — `sides` on the home dashboard, `stacked`
// (top/bottom) everywhere else — so the shared glow defined in index.css
// slides between layouts as you navigate. The keyed wrapper replays the
// content fade-in on each navigation.
export function RootLayout() {
  const { pathname } = useLocation();

  // Layout effect (not useEffect) so the new layout attribute is set before
  // paint — the glow transition starts on the first frame, with no extra delay.
  useLayoutEffect(() => {
    document.body.dataset.glow = pathname === "/" ? "sides" : "stacked";
  }, [pathname]);

  return (
    <div key={pathname} className="route-view">
      <Outlet />
    </div>
  );
}
