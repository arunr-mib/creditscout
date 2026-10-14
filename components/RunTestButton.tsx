"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * design.md §12.10 — the primary run control. It runs the quarter (or a single
 * facility) through an API route that holds the service-role client, then
 * refreshes the screen.
 *
 * The one rule that matters: it is NEVER silently disabled. When a facility has
 * no approved terms the button is disabled and says why inline
 * ("Approve covenant terms first"), rather than sitting dead — a greyed button
 * with no explanation is how an analyst concludes the product is broken.
 */
export function RunTestButton(props: {
  label: string;
  endpoint: string;
  body: Record<string, unknown>;
  disabledReason?: string | null;
  /** The play mark. Off by default: in a table cell the label wraps around it. */
  showPlay?: boolean;
  /** Row actions are chips, not slabs: outline, denser, no play glyph. */
  compact?: boolean;
}) {
  const { label, endpoint, body, disabledReason, showPlay = false, compact = false } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const disabled = disabledReason != null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((data && typeof data.error === "string" && data.error) || `The run failed (${res.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={disabled || busy}
        aria-describedby={disabled ? reasonId : undefined}
        className={
          compact
            ? "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-model bg-surface px-3 py-2 text-body font-medium leading-5 text-model transition-colors duration-fast ease-out hover:bg-model-bg disabled:cursor-not-allowed disabled:opacity-40"
            : "inline-flex items-center justify-center gap-2 rounded-md border border-model bg-model px-4 py-2 text-body font-medium leading-5 text-bg transition-colors duration-fast ease-out hover:bg-model-bright disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        {/* The mark says this one RUNS something, which is the distinction the
            colour already carries — a click here spends work, the beige ones
            only open a record. Hidden from assistive tech: the label says it. */}
        {showPlay && <span aria-hidden="true">{busy ? "⟳" : "▶"}</span>}
        {busy ? "Running…" : label}
      </button>
      {disabled && (
        <span id={reasonId} className="text-label text-text-muted">
          {disabledReason}
        </span>
      )}
      {error && (
        <span role="alert" className="text-label text-danger">
          <span aria-hidden="true">✕ </span>
          {error}
        </span>
      )}
    </span>
  );
}
