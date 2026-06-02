import type { PointerEvent, ReactNode } from "react";
import "./appBackdrop.css";

// Mirrors the playmat's cursor spotlight (see features/playmat/Playmat.tsx):
// track the pointer in CSS custom properties so `.app-backdrop::after` — a
// patch of brighter dots — follows it on the GPU compositor. Parked off-screen
// until the pointer is over the backdrop.
const HIDDEN_CURSOR_POSITION = -9999;

function setCursorPosition(element: HTMLElement, x: number, y: number) {
  element.style.setProperty("--cursor-x", `${x}px`);
  element.style.setProperty("--cursor-y", `${y}px`);
}

function updateCursorPosition(event: PointerEvent<HTMLDivElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  setCursorPosition(event.currentTarget, event.clientX - rect.left, event.clientY - rect.top);
}

function hideCursorSpotlight(event: PointerEvent<HTMLDivElement>) {
  setCursorPosition(event.currentTarget, HIDDEN_CURSOR_POSITION, HIDDEN_CURSOR_POSITION);
}

/** Themed page shell shared by the home dashboard and placeholder pages. */
export function AppBackdrop({ children }: { children: ReactNode }) {
  return (
    <div
      className="app-backdrop text-white"
      onPointerMove={updateCursorPosition}
      onPointerLeave={hideCursorSpotlight}
    >
      {children}
    </div>
  );
}
