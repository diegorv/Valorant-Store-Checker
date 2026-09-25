"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Store Page Error Boundary
 *
 * Catches errors specifically in the /store route and provides
 * a contextual recovery UI (retry the store load).
 *
 * It does not single out an expired session: the page redirects to /login
 * before it can get here, and the error message this receives is a redacted
 * digest outside development, so it could never tell the two apart anyway.
 */
export default function StoreError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[Store Error Boundary]", error);
  }, [error]);

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="font-display text-5xl md:text-6xl uppercase font-bold text-light mb-2">
            Your Store
          </h1>
        </div>

        <div className="angular-card bg-void-surface/50 flex flex-col items-center justify-center py-20 space-y-6">
          {/* Error icon */}
          <div className="w-16 h-16 flex items-center justify-center border border-red-500/30 angular-card-sm">
            <span className="text-3xl text-red-500 font-bold">!</span>
          </div>

          <h2 className="text-zinc-300 text-xl font-display uppercase tracking-wider">
            Store Unavailable
          </h2>

          <p className="text-zinc-500 text-sm max-w-sm text-center leading-relaxed">
            We couldn&apos;t load your store right now. Please try again.
          </p>

          {process.env.NODE_ENV === "development" && (
            <pre className="text-left text-xs text-red-400/80 bg-void-deep p-3 overflow-auto max-h-24 max-w-lg w-full angular-card-sm">
              {error.message}
            </pre>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => retry()}
              className="angular-btn px-6 py-3 bg-brand text-void-deep font-display uppercase tracking-wider text-sm hover:bg-brand/85 transition-colors"
            >
              Retry
            </button>
            <Link
              href="/"
              className="angular-btn px-6 py-3 bg-void-elevated text-zinc-300 font-display uppercase tracking-wider text-sm hover:bg-void-surface transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
