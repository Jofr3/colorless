import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { ErrorScreen } from "./ErrorScreen";

// Rendered by the router whenever a route element throws during render (or an
// effect in its subtree throws). Without this, an uncaught error unmounts the
// whole app to a blank screen with no recovery path. The router installs this
// as an error boundary around every route via `errorElement` on the root route.
export function RouteError() {
  const error = useRouteError();

  // A route response (404 etc.) is safe to show; a thrown Error's raw message may
  // carry internals, so only surface it in dev — generic message in production.
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : import.meta.env.DEV && error instanceof Error
      ? error.message
      : "An unexpected error occurred.";

  if (import.meta.env.DEV) {
    console.error("Route error boundary caught:", error);
  }

  return (
    <ErrorScreen
      detail={detail}
      action={{
        label: "Back to home",
        onClick: () => {
          window.location.href = "/";
        },
      }}
    />
  );
}
