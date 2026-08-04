import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
import { BACK_ARROW_ICON, GLASS_GHOST_BUTTON, GLASS_ICON_TILE } from "../lib/glass";
import { AppBackdrop } from "./AppBackdrop";
import { ArrowLeftIcon } from "./icons";

/** Stand-in for routes that are wired up in the menu but not yet built. */
export function PlaceholderPage({
  title,
  Icon,
}: {
  title: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <AppBackdrop>
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
        <div className={`h-20 w-20 ${GLASS_ICON_TILE}`}>
          <Icon className="h-9 w-9" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">{title}</h1>
          <p className="text-sm text-muted">This page is coming soon.</p>
        </div>
        <Link
          to="/"
          className={`group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`}
        >
          <ArrowLeftIcon className={BACK_ARROW_ICON} />
          Back to home
        </Link>
      </main>
    </AppBackdrop>
  );
}
