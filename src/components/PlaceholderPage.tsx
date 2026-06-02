import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
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
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/[0.05] text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_30px_rgba(0,0,0,0.40)] ring-1 ring-inset ring-white/10">
          <Icon className="h-9 w-9" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">{title}</h1>
          <p className="text-sm text-muted">This page is coming soon.</p>
        </div>
        <Link
          to="/"
          className="group inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-4 py-2 text-sm font-medium text-white/75 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-white/90 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-95"
        >
          <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Back to home
        </Link>
      </main>
    </AppBackdrop>
  );
}
