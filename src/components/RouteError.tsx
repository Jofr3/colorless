import { isRouteErrorResponse, useRouteError } from "react-router-dom";

// Rendered by the router whenever a route element throws during render (or an
// effect in its subtree throws). Without this, an uncaught error unmounts the
// whole app to a blank screen with no recovery path. The router installs this
// as an error boundary around every route via `errorElement` on the root route.
export function RouteError() {
  const error = useRouteError();

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";

  if (import.meta.env.DEV) {
    console.error("Route error boundary caught:", error);
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-6xl font-bold text-accent">!</p>
      <h1 className="text-xl font-medium">Something went wrong</h1>
      <p className="max-w-md text-sm text-fg/60">{detail}</p>
      <button
        type="button"
        onClick={() => {
          window.location.href = "/";
        }}
        className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
      >
        Back to home
      </button>
    </main>
  );
}
