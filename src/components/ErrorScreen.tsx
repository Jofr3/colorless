import type { ReactNode } from "react";

/** Shared full-screen error panel for both the router's {@link RouteError}
    boundary and the top-level ErrorBoundary. Presentational — the caller
    supplies the detail line and the recovery action. */
export function ErrorScreen({
  detail,
  action,
}: {
  detail: ReactNode;
  action: { label: string; onClick: () => void };
}) {
  return (
    <main className="flex h-full min-h-svh flex-col items-center justify-center gap-4 text-center">
      <p className="text-6xl font-bold text-accent">!</p>
      <h1 className="text-xl font-medium">Something went wrong</h1>
      <p className="max-w-md text-sm text-fg/60">{detail}</p>
      <button
        type="button"
        onClick={action.onClick}
        className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-fg transition-colors motion-reduce:transition-none hover:border-accent hover:text-accent"
      >
        {action.label}
      </button>
    </main>
  );
}
