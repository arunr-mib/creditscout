"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pollInvestigation } from "@/app/casefiles/actions";
import { pollDecision, type LiveTraceView } from "./traceModel";
import { SeenSimilarBadge } from "./SeenSimilarBadge";
import { TraceStep } from "./TraceStep";

/**
 * The screen the analyst watches while an investigation runs (design.md §7, §12).
 *
 * It does two things. It DRIVES the run, one bounded slice at a time, through
 * the `pollInvestigation` Server Action — which holds the shared tool key
 * server-side and never hands it to the browser. And it REFRESHES the server
 * component on a ~1s heartbeat so the real steps `syncRun` mirrors into
 * `casefiles.trace` arrive on screen as they happen. No shimmer, no faked
 * progress: what is drawn is what was recorded (design.md §6, §10).
 *
 * When the casefile leaves `investigating` the loop stops; the refresh then
 * re-renders the page, which hands off to F9b's `CasefileView` for the concluded
 * recommendation (or the failed state). One URL per casefile.
 */

const POLL_INTERVAL_MS = 1000;

export function LiveTrace(props: { casefileId: string; borrower: string; period: string; trace: LiveTraceView }) {
  const { casefileId, borrower, period, trace } = props;
  const router = useRouter();
  const [phase, setPhase] = useState<"starting" | "running">(trace.steps.length > 0 ? "running" : "starting");
  const [elapsed, setElapsed] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

  // The driver: advance the run, surface its state, refresh, and keep going
  // until the casefile is no longer `investigating`. A transient fetch error is
  // not a conclusion — it keeps polling.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function drive() {
      while (!cancelled) {
        try {
          const state = await pollInvestigation(casefileId);
          if (cancelled) return;
          const decision = pollDecision(state);
          setSyncError(state.error);
          if (decision.action === "stop") {
            router.refresh(); // hand off to the concluded view
            return;
          }
          setPhase(decision.phase);
        } catch {
          if (cancelled) return;
          // Transient. Keep the loop alive rather than reading a blip as failure.
        }
        router.refresh();
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, POLL_INTERVAL_MS);
        });
      }
    }

    drive();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [casefileId, router]);

  // A real elapsed clock, so the running indicator is honest rather than a timed
  // bar ticking off steps that have not happened.
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { steps } = trace;

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-label text-text-muted">Investigation</p>
        <h1 className="text-title text-text">
          {borrower} <span className="font-normal text-text-secondary">· {period}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <SeenSimilarBadge count={trace.lessons} />
          {trace.ranWithoutMemory && (
            <span className="inline-flex rounded-sm border border-border-strong px-2 py-px text-badge text-text-muted" title={trace.memoryNote ?? undefined}>
              ran without memory
            </span>
          )}
        </div>
      </header>

      <section aria-label="Investigation trace" aria-live="polite" className="rounded-md border border-border-strong bg-surface p-4">
        {steps.length === 0 ? (
          <p role="status" className="text-body text-text-secondary">
            {phase === "starting" ? "Investigation starting…" : "The agent is working. The first step will appear here as it completes."}
          </p>
        ) : (
          <ol className="space-y-4">
            {steps.map((step) => (
              <TraceStep key={step.n} step={step} />
            ))}
          </ol>
        )}

        {/* The running indicator: a real "still going" signal, not a step ticked
            off on a timer. Under prefers-reduced-motion the pulse is stilled by
            the global rule, and the words carry the meaning regardless. */}
        <p className="mt-4 flex items-center gap-3 border-t border-border pt-4 text-label text-text-muted">
          <span className="inline-block h-2 w-2 rounded-sm bg-model motion-safe:animate-pulse" aria-hidden="true" />
          <span>
            {phase === "starting"
              ? "Starting the investigation…"
              : "Investigation running — a reasoning step (teal) chooses the next evidence or calculation (amber)."}
          </span>
          <span className="ml-auto font-mono">{elapsed}s</span>
        </p>
      </section>

      {syncError && (
        <p role="status" className="text-label text-text-muted">
          {syncError} Still watching for the next step.
        </p>
      )}

      <p className="text-label text-text-muted">
        This runs server-side across several steps. When it concludes, this screen shows the recommendation for an analyst to decide.
      </p>
    </article>
  );
}
