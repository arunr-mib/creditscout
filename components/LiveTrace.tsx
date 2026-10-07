"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pollInvestigation } from "@/app/casefiles/actions";
import { pollDecision, type LiveTraceView } from "./traceModel";
import { SeenSimilarBadge } from "./SeenSimilarBadge";
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
 */

const DRIVE_GAP_MS = 1000;
const DISPLAY_GAP_MS = 1500;

export function LiveTrace(props: { casefileId: string; borrower: string; period: string; trace: LiveTraceView }) {
  const { casefileId, borrower, period, trace } = props;
  const router = useRouter();
  const [view, setView] = useState<LiveTraceView>(trace);
  const [phase, setPhase] = useState<"starting" | "running">(trace.steps.length > 0 ? "running" : "starting");
  const [elapsed, setElapsed] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

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
  }, [casefileId, router]);

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
            const data = (await res.json()) as { status: string; view: LiveTraceView };
            setView(data.view);
            if (data.status !== "investigating") {
              router.refresh(); // concluded — hand off to the recommendation
              return;
            }
          }
        } catch {
          if (cancelled) return; // transient; keep watching
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

  // A real elapsed clock, so the running indicator is honest.
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { steps } = view;

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-label text-text-muted">Investigation</p>
        <h1 className="text-title text-text">
          {borrower} <span className="font-normal text-text-secondary">· {period}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <SeenSimilarBadge count={view.lessons} />
          {view.ranWithoutMemory && (
            <span className="inline-flex rounded-sm border border-border-strong px-2 py-px text-badge text-text-muted" title={view.memoryNote ?? undefined}>
              ran without memory
            </span>
          )}
        </div>
      </header>

      <section aria-label="Investigation trace" aria-live="polite" className="space-y-4 rounded-md border border-border-strong bg-surface p-4">
        <TraceArc steps={steps} />
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
            {phase === "starting" && steps.length === 0
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
