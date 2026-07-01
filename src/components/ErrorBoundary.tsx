import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorScreen } from "./ErrorScreen";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// A last-resort boundary above the router. RouteError only catches throws inside
// a route's subtree, so an error in the app shell — FontProvider, the router
// itself, or the very first render — would otherwise blank the screen with no
// recovery path. This catches those and offers a reload.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("App error boundary caught:", error, info);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorScreen
          // Never leak an Error's raw message (may carry internals) in production.
          detail={import.meta.env.DEV ? this.state.error.message : "An unexpected error occurred."}
          action={{ label: "Reload", onClick: () => window.location.reload() }}
        />
      );
    }
    return this.props.children;
  }
}
