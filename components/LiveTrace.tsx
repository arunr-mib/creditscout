"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pollInvestigation } from "@/app/casefiles/actions";
import { pollDecision, type LiveTraceView } from "./traceModel";
import { TraceArc } from "./TraceArc";
import { TraceStep } from "./TraceStep";

/**
 * The screen the analyst watches while an investigation runs (design.md §7, §12).
 *
 * Two independent loops:
 *
 *  - DRIVE (`pollInvestigation`, a Server Action): advances the Foundry run one
 *    bounded ~25s slice at a time, holding the shared tool key server-side. It
 *    never hands the key to the browser.
 *  - DISPLAY (a plain GET to `/api/casefiles/[id]/trace`): reads the steps
 *    `syncRun` mirrors into `casefiles.trace` and renders them from state, on a
 *    fast interval. It is deliberately NOT a Server Action — Next serialises
 *    those, so a display poll would queue behind the long drive slice and the
 *    steps would only appear when the slice returned (~25s). A normal HTTP
 *    request runs concurrently, so steps show up as they happen.
 *
 * What is drawn is always what was recorded — no shimmer, no faked progress
 * (design.md §6, §10). When the casefile leaves `investigating` the page hands
 * off to F9b's `CasefileView` for the concluded recommendation (or failed state).
 *
 * THE WAIT IS PART OF THE SCREEN. An investigation takes a minute or more, and
 * a lone spinner for that long reads as broken. The empty state explains what
 * the agent is doing and what it may conclude, so the time is spent telling the
 * analyst something true rather than nothing.
 */

const DRIVE_GAP_MS = 1000;
const DISPLAY_GAP_MS = 1500;

/** What the agent may inspect. Mirrors the `documents.doc_type` enum, minus waiver. */
const INSPECTABLE = ["Loan agreement", "Amendments", "Financials", "Compliance certificate"];

const OUTCOMES: { icon: string; label: string; detail: string }[] = [
  { icon: "✓", label: "Resolve", detail: "Evidence supports closing the exception" },
  { icon: "→", label: "Escalate", detail: "Further assessment is needed" },
  { icon: "–", label: "Abstain", detail: "Evidence is insufficient or unverified" },
];

const mmss = (s: number): string => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

export function LiveTrace(props: { casefileId: string; borrower: string; period: string; trace: LiveTraceView }) {
  const { casefileId, borrower, period, trace } = props;
  const router = useRouter();
  const [view, setView] = useState<LiveTraceView>(trace);
  const [phase, setPhase] = useState<"starting" | "running">(trace.steps.length > 0 ? "running" : "starting");
  const [elapsed, setElapsed] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  /** Seconds since the last successful read, so "last received" is a measurement. */
  const [sinceUpdate, setSinceUpdate] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const nudge = useRef(0);

  // DRIVE: advance the run until the casefile is no longer `investigating`. A
  // transient fetch error is not a conclusion — it keeps polling.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function drive() {
      while (!cancelled) {
        try {
          const state = await pollInvestigation(casefileId);
          if (cancelled) return;
          setSyncError(state.error);
          setReconnecting(false);
          const decision = pollDecision(state);
          if (decision.action === "stop") {
            router.refresh(); // hand off to the concluded view
            return;
          }
          setPhase(decision.phase);
        } catch {
          if (cancelled) return; // transient; keep driving
        }
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, DRIVE_GAP_MS);
        });
      }
    }
    drive();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [casefileId, router, nudge]);

  // DISPLAY: read the trace as it is written and render it live. Concurrent with
  // the drive, so steps appear as they happen rather than in a 25s batch.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function watch() {
      while (!cancelled) {
        try {
          const res = await fetch(`/api/casefiles/${casefileId}/trace`, { cache: "no-store" });
          if (cancelled) return;
          if (res.ok) {
            // The route answers `{ status, view }` — the trace is NESTED. Storing
            // the envelope instead of `.view` leaves `steps` undefined and the
            // render dies on `steps.length`.
            const data = (await res.json()) as { status: string; view: LiveTraceView };
            if (cancelled) return;
            if (data.view) {
              setView(data.view);
              setSinceUpdate(0);
            }
            if (data.status !== "investigating") {
              router.refresh(); // concluded — hand off to the recommendation
              return;
            }
          }
        } catch {
          if (cancelled) return; // transient; the drive loop reports the error
        }
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, DISPLAY_GAP_MS);
        });
      }
    }
    watch();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [casefileId, router]);

  // Real clocks, so both the elapsed time and "last received" are honest.
  useEffect(() => {
    const t = setInterval(() => {
      setElapsed((s) => s + 1);
      setSinceUpdate((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /**
   * Re-enter the drive loop. It RETRIEVES this investigation — it does not start
   * a second one, which would spend a second run's tokens on the same exception.
   */
  const reconnect = useCallback(() => {
    setReconnecting(true);
    setSyncError(null);
    nudge.current += 1;
    router.refresh();
  }, [router]);

  // Defensive: the render must not die on a malformed payload. A screen that
  // crashes mid-investigation loses the run from the analyst's view entirely.
  const steps = view?.steps ?? [];
  const started = steps.length > 0;

  return (
    <article className="space-y-6">
      {/* ------------------------------------------------------------ header */}
      <nav aria-label="Breadcrumb" className="text-label text-text-muted">
        <Link href="/" className="underline-offset-2 hover:text-text-secondary hover:underline">
          Credit Analysis Queue
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-text-secondary">{borrower}</span>
      </nav>

      <header className="space-y-2">
        <p className="text-label uppercase tracking-[0.14em] text-model-bright">DSCR exception investigation</p>
        <h1 className="text-title text-text">
          {borrower} <span className="font-normal text-text-secondary">· {period}</span>
        </h1>
        <p className="max-w-prose text-body text-text-secondary">
          Investigating the flagged DSCR breach and gathering evidence for your review.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {(view?.lessons ?? 0) > 0 && (
            <span className="rounded-sm bg-model-bg px-2 py-px text-label text-model-bright">
              {view.lessons} similar case{view.lessons === 1 ? "" : "s"} found
            </span>
          )}
          {view?.ranWithoutMemory && (
            <span
              className="inline-flex rounded-sm border border-border-strong px-2 py-px text-badge text-text-muted"
              title={view.memoryNote ?? undefined}
            >
              ran without memory
            </span>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------- interruption */}
      {syncError && (
        <div role="status" className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface shadow-card shadow-card p-4">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="text-card text-code-bright">
              ⚠
            </span>
            <div>
              <p className="text-card text-text">Live updates interrupted</p>
              <p className="mt-1 max-w-prose text-body text-text-secondary">
                We couldn&rsquo;t retrieve the latest status. The investigation may still be running.
              </p>
              <p className="mt-1 text-label text-text-muted">
                {reconnecting ? "Reconnecting…" : "Trying to reconnect…"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={reconnect}
            className="shrink-0 rounded-md border border-model px-4 py-2 text-body font-medium text-model-bright transition-colors duration-fast hover:bg-model-bg"
          >
            Reconnect to updates
          </button>
        </div>
      )}

      {/* ------------------------------------------------- activity + outcome */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-label="Agent activity" className="rounded-lg border border-border bg-surface shadow-card shadow-card lg:col-span-2">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-card text-text">CreditScout Agent activity</h2>
            <span className="font-mono text-label text-text-muted">
              {started ? `Last received · ${mmss(sinceUpdate)}` : `Elapsed · ${mmss(elapsed)}`}
            </span>
          </header>

          <div className="space-y-4 p-4">
            {started ? (
              <>
                <TraceArc steps={steps} />
                <ol className="space-y-4">
                  {steps.map((step) => (
                    <TraceStep key={step.n} step={step} />
                  ))}
                </ol>
              </>
            ) : (
              <div className="py-8 text-center">
                <p className="text-card text-text">
                  {phase === "starting" ? "Starting the investigation" : "Waiting for the first activity update"}
                </p>
                <p className="mx-auto mt-2 max-w-prose text-body text-text-secondary">
                  The agent&rsquo;s actions and findings will appear here as updates become available.
                </p>
              </div>
            )}

            {/* The wait explained, rather than a spinner. Stays below the steps
                once they start, where it reads as a legend for them. */}
            <div className="border-t border-border pt-4">
              <p className="text-label uppercase tracking-wide text-text-muted">How the investigation works</p>
              <p className="mt-2 max-w-prose text-body text-text-secondary">
                The agent selects which evidence to inspect next and requests calculations as needed.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {INSPECTABLE.map((d) => (
                  <li key={d} className="rounded-md border border-border px-3 py-2 text-label text-text-secondary">
                    {d}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-label text-text-muted">Document types the agent may inspect.</p>
            </div>
          </div>
        </section>

        {/* The outcomes are named BEFORE one is reached, so the recommendation
            arrives as one of a known set rather than a verdict out of nowhere. */}
        <section aria-label="Recommendation" className="rounded-lg border border-border bg-surface shadow-card shadow-card">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-card text-text">Recommendation</h2>
            <span className="rounded border border-border-strong px-3 py-px text-label text-text-muted">Pending</span>
          </header>
          <div className="space-y-4 p-4">
            <div>
              <p className="text-card text-text">Evidence before an outcome</p>
              <p className="mt-2 text-body text-text-secondary">
                Once the investigation completes, review the recommendation, supporting calculations, and cited
                evidence.
              </p>
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-label uppercase tracking-wide text-text-muted">Possible outcomes</p>
              <ul className="mt-3 space-y-3">
                {OUTCOMES.map((o) => (
                  <li key={o.label} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border-strong text-label text-text-muted"
                    >
                      {o.icon}
                    </span>
                    <div>
                      <p className="text-body text-text">{o.label}</p>
                      <p className="text-label text-text-muted">{o.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>

      {syncError && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-label text-text-muted">
          <span aria-hidden="true">ⓘ </span>
          Reconnecting retrieves this investigation. It does not start a new one.
        </p>
      )}

      <p className="text-label text-text-muted">The agent recommends. You make the final decision.</p>
    </article>
  );
}
