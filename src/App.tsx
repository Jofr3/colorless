import { useEffect, useRef, type PointerEvent } from "react";
import { PlaymatBody, WRAPPER_CLASSES } from "./components/playmat-v9/Body";

const HIDDEN_CURSOR = -9999;
const CURSOR_LAG = 0.14;

export default function App() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const hasCursorRef = useRef(false);
  const targetRef = useRef({ x: HIDDEN_CURSOR, y: HIDDEN_CURSOR });
  const currentRef = useRef({ x: HIDDEN_CURSOR, y: HIDDEN_CURSOR });

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  function writeCursorVars(x: number, y: number) {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    wrapper.style.setProperty("--cursor-x", `${x}px`);
    wrapper.style.setProperty("--cursor-y", `${y}px`);
  }

  function animateCursorLag() {
    const current = currentRef.current;
    const target = targetRef.current;
    const dx = target.x - current.x;
    const dy = target.y - current.y;

    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
      current.x = target.x;
      current.y = target.y;
      writeCursorVars(current.x, current.y);
      animationFrameRef.current = null;
      return;
    }

    current.x += dx * CURSOR_LAG;
    current.y += dy * CURSOR_LAG;
    writeCursorVars(current.x, current.y);

    animationFrameRef.current = requestAnimationFrame(animateCursorLag);
  }

  function startCursorLag() {
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(animateCursorLag);
    }
  }

  function updateCursorPosition(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    targetRef.current.x = x;
    targetRef.current.y = y;

    if (!hasCursorRef.current) {
      hasCursorRef.current = true;
      currentRef.current.x = x;
      currentRef.current.y = y;
      writeCursorVars(x, y);
    }

    startCursorLag();
  }

  function hideCursorDots() {
    hasCursorRef.current = false;
    targetRef.current.x = HIDDEN_CURSOR;
    targetRef.current.y = HIDDEN_CURSOR;
    currentRef.current.x = HIDDEN_CURSOR;
    currentRef.current.y = HIDDEN_CURSOR;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    writeCursorVars(HIDDEN_CURSOR, HIDDEN_CURSOR);
  }

  return (
    <div
      ref={wrapperRef}
      className={WRAPPER_CLASSES}
      onPointerMove={updateCursorPosition}
      onPointerLeave={hideCursorDots}
    >
      <PlaymatBody />
    </div>
  );
}
