import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-6xl font-bold text-accent">404</p>
      <h1 className="text-xl font-medium">This page doesn&apos;t exist</h1>
      <Link
        to="/"
        className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-fg transition-colors motion-reduce:transition-none hover:border-accent hover:text-accent"
      >
        Back to home
      </Link>
    </main>
  );
}
