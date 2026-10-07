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
}) {
  const { label, endpoint, body, disabledReason } = props;
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
        className="rounded-md border border-model bg-gradient-to-b from-model-bright to-model px-4 py-2 text-body font-medium leading-5 text-bg transition duration-fast ease-out hover:-translate-y-px hover:brightness-105 active:translate-y-px active:brightness-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
      >
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
