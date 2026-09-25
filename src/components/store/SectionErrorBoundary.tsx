"use client";

import { useEffect, type ReactNode } from "react";
import { catchError, type ErrorInfo } from "next/error";

interface SectionErrorBoundaryProps {
  /** Name of the section, displayed in the fallback UI (e.g. "Featured Bundle") */
  sectionName: string;
  /**
   * Renders a single-line fallback sized for a narrow inline slot
   * (e.g. the wallet in the page header) instead of the full-width card.
   */
  compact?: boolean;
}

/**
 * SectionErrorBoundary — isolates render errors per store section.
 *
 * Wraps each <Suspense> streaming section in the store page so that
 * a failure in one section (e.g. Bundle fetch error) does not take
 * down the Daily Shop or Night Market sections.
 *
 * Built from `catchError` so the framework owns recovery: its `retry`
 * refreshes the segment inside a transition before clearing the error
 * state, which re-fetches the async Server Components inside. Clearing
 * the state alone would replay the same rejected payload. It also
 * re-throws router control-flow errors (redirect, notFound) so they
 * reach the boundary that handles them.
 */
function SectionErrorFallback(
  { sectionName, compact }: SectionErrorBoundaryProps,
  { error, retry }: ErrorInfo,
): ReactNode {
  useEffect(() => {
    console.error(`[SectionErrorBoundary: ${sectionName}]`, error);
  }, [sectionName, error]);

  if (compact) {
    return (
      <div className="angular-card-sm bg-void-surface/50 flex items-center gap-2 h-10 px-3">
        <span className="text-red-500 font-bold leading-none">!</span>

        <span className="text-zinc-400 text-xs font-display uppercase tracking-wider">
          {sectionName} Unavailable
        </span>

        <button
          onClick={() => retry()}
          className="text-zinc-300 hover:text-white text-xs font-display uppercase tracking-wider underline underline-offset-2 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="angular-card bg-void-surface/50 flex flex-col items-center justify-center py-12 px-6 space-y-4">
      {/* Error icon */}
      <div className="w-12 h-12 flex items-center justify-center border border-red-500/30 angular-card-sm">
        <span className="text-2xl text-red-500 font-bold">!</span>
      </div>

      <h3 className="text-zinc-300 text-lg font-display uppercase tracking-wider">
        {sectionName} Unavailable
      </h3>

      <p className="text-zinc-500 text-sm text-center max-w-sm leading-relaxed">
        This section encountered an error. Other sections are unaffected.
      </p>

      {process.env.NODE_ENV === "development" && error instanceof Error && (
        <pre className="text-left text-xs text-red-400/80 bg-void-deep p-3 overflow-auto max-h-20 max-w-lg w-full angular-card-sm">
          {error.message}
        </pre>
      )}

      <button
        onClick={() => retry()}
        className="angular-btn px-5 py-2.5 bg-brand text-void-deep font-display uppercase tracking-wider text-sm hover:bg-brand/85 transition-colors"
      >
        Retry Section
      </button>
    </div>
  );
}

export const SectionErrorBoundary = catchError(SectionErrorFallback);
