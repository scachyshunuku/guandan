"use client";

// Error boundary for everything under the root layout (Next.js App Router
// convention, IMPLEMENTATION.md Task 5.6 "Root layout with providers" >
// "Error boundary"): catches render/data errors thrown by any page or
// nested layout, since nothing in app/ overrides it with a more specific
// error.tsx of its own. It does NOT catch errors thrown by app/layout.tsx
// itself (e.g. Providers) - only global-error.tsx can, since error.tsx is
// rendered *inside* the root layout it's meant to protect against.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-100 px-6 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-md text-sm text-slate-600">{error.message}</p>
      <button
        type="button"
        data-testid="error-retry-button"
        onClick={reset}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}
