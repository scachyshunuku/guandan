"use client";

// Next.js App Router convention: the *only* boundary that can catch an
// error thrown by app/layout.tsx itself (error.tsx can't - it renders
// inside the root layout it would need to protect). Must render its own
// <html>/<body> since it replaces the root layout entirely when active.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-6 py-16 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
          <p className="max-w-md text-sm text-slate-600">{error.message}</p>
          <button
            type="button"
            data-testid="global-error-retry-button"
            onClick={reset}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
