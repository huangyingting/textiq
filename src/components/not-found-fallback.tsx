import Link from "next/link";

export function NotFoundFallback() {
  return (
    <main
      aria-labelledby="not-found-title"
      className="flex flex-1 items-center justify-center bg-ds-surface-sunken px-6 py-16"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-ds-border-subtle bg-ds-surface-raised p-8 text-center shadow-sm">
        <p className="text-5xl font-semibold tracking-tight text-ds-border-strong">
          404
        </p>
        <div className="flex flex-col gap-2">
          <h1
            id="not-found-title"
            className="text-2xl font-semibold tracking-tight text-ds-text-primary"
          >
            Page not found
          </h1>
          <p className="text-sm leading-6 text-ds-text-secondary">
            The page you’re looking for doesn’t exist or may have been moved.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="flex h-12 items-center justify-center rounded-full bg-ds-control px-6 text-base font-medium text-ds-control-text transition hover:bg-ds-control-hover"
          >
            Go home
          </Link>
          <Link
            href="/app"
            className="flex h-12 items-center justify-center rounded-full border border-ds-border-subtle px-6 text-base font-medium text-ds-text-secondary transition hover:bg-ds-state-hover hover:text-ds-text-primary"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
