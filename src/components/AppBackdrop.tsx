import type { ReactNode } from "react";
import "./appBackdrop.css";

/** Themed page shell shared by the home dashboard and placeholder pages. */
export function AppBackdrop({ children }: { children?: ReactNode }) {
  return <div className="app-backdrop text-white">{children}</div>;
}
