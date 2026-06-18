import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { GlowRenderer } from "./glowRenderer";
import "./glowBackground.css";

// Mounts the WebGL background glow behind every route. It persists across
// navigations (rendered in RootLayout outside the keyed route wrapper), so the
// layout transition tween isn't interrupted when the page changes. The same
// signals that drive the CSS fallback drive this:
//   - layout (sides/stacked) from the pathname, mirroring RootLayout
//   - perspective flip from <body data-perspective>, set imperatively by Playmat
export function GlowBackground() {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GlowRenderer | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const host = mountRef.current;
    if (!host) {
      return undefined;
    }
    const renderer = new GlowRenderer();
    rendererRef.current = renderer;
    void renderer.mount(host);
    return () => {
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  // Home is the only `sides` route; everything else stacks.
  useEffect(() => {
    rendererRef.current?.setLayout(pathname === "/" ? "sides" : "stacked");
  }, [pathname]);

  // Playmat sets/clears body[data-perspective] per active player; observe it so
  // the opponent's turn flips the glow top-to-bottom.
  useEffect(() => {
    const apply = () => {
      rendererRef.current?.setPerspective(
        document.body.dataset.perspective === "opponent" ? -1 : 1,
      );
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-perspective"],
    });
    return () => observer.disconnect();
  }, []);

  return <div ref={mountRef} className="glow-bg" aria-hidden="true" />;
}
