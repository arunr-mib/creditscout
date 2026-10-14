"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pollInvestigation } from "@/app/casefiles/actions";
import {
  CONNECTION_INTERRUPTED,
  PRIOR_CASES_NOTE,
  activityState,
  activitySummary,
  evidenceGathered,
  freshnessLabel,
  investigationIssue,
  pollDecision,
  type EvidenceLink,
  type ExceptionFacts,
  type LiveTraceView,
} from "./traceModel";
import { STALLED_NOTICE } from "./traceModel";
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
 * What is drawn is always what was recorded — no shimmer, no faked progress and
 * no percentage, which this system cannot measure (design.md §6, §10). When the
 * casefile leaves `investigating` the page hands off to F9b's `CasefileView`.
 *
 * THE HIERARCHY, after the 2026-10-13 review:
 *
 *   1. WHAT IS BEING INVESTIGATED. The screen opened with a borrower name and
 *      nothing else; the figures that raised the exception — calculated,
 *      minimum, shortfall, the terms version used — were a page away. They are
 *      now the first thing under the title, labelled as the ORIGINAL test so
 *      nothing the investigation finds can be mistaken for them.
 *   2. WHAT IS IN THE WAY, if anything, in one amber notice that distinguishes
 *      an input the agent omitted from a document nobody uploaded.
 *   3. WHAT HAPPENED, as an investigation timeline with explicit states.
 *   4. WHAT COMES NEXT — a compact pending recommendation and the evidence
 *      gathered so far, not a half-screen of outcome definitions.
 */

const DRIVE_GAP_MS = 1000;
const DISPLAY_GAP_MS = 1500;

/** What the agent may inspect. Mirrors the `documents.doc_type` enum, minus waiver. */
const INSPECTABLE = ["Loan agreement", "Amendments", "Financials", "Compliance certificate"];

const OUTCOMES: { label: string; detail: string }[] = [
  { label: "Resolve", detail: "Evidence supports resolving the flagged exception, subject to analyst approval." },
  { label: "Escalate", detail: "Findings warrant further credit review." },
  { label: "Abstain", detail: "Available evidence does not support a reliable recommendation." },
];

const mmss = (s: number): string => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const x = (v: number): string => `${v.toFixed(2)}x`;

export interface LiveTraceProps {
  casefileId: string;
  borrower: string;
  period: string;
  trace: LiveTraceView;
  /** The test that raised the exception. Read from `exceptions`, never recomputed. */
  facts: ExceptionFacts;
  /** `documents.doc_type` for this borrower — what the agent could possibly have found. */
  docTypesOnFile: string[];
  /** Citation -> document, resolved on the server so the browser gets no corpus. */
  evidence: EvidenceLink[];
}

export function LiveTrace(props: LiveTraceProps) {
  const { casefileId, borrower, period, trace, facts, docTypesOnFile } = props;
  const router = useRouter();
  const [view, setView] = useState<LiveTraceView>(trace);
  const [phase, setPhase] = useState<"starting" | "running">(trace.steps.length > 0 ? "running" : "starting");
  const [elapsed, setElapsed] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  /** Seconds since the last successful read, so "updated" is a measurement. */
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

  // Real clocks, so both the elapsed time and the freshness are honest.
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
  const running = syncError === null;
  const issue = investigationIssue(steps, docTypesOnFile);
  const summary = activitySummary(steps);
  // Only the citations THIS run retrieved, among those the server resolved.
  const retrieved = evidenceGathered(steps);
  const evidence = props.evidence.filter((e) => retrieved.includes(e.citation));
  const pastCases = steps.find((s) => s.tool === "search_past_cases") ?? null;

  return (
    <article className="space-y-6">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="text-label text-text-muted">
          <Link href="/" className="underline-offset-2 hover:text-text-secondary hover:underline">
            Credit Analysis Queue
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-text-secondary">{borrower}</span>
        </nav>
        {/* Quiet, and deliberately not reassuring: the run advances while this
            page drives it (Vercel caps a function below the time a full
            investigation needs), so "it continues without you" would be false. */}
        <Link
          href="/"
          className="rounded-md border border-border-strong bg-surface px-3 py-1 text-label text-text-secondary hover:bg-surface-raised"
        >
          Back to queue
        </Link>
      </div>

      <header className="space-y-2">
        <p className="text-label uppercase tracking-[0.14em] text-text-muted">DSCR exception investigation</p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-title text-text">
            {borrower} <span className="font-normal text-text-secondary">· {period}</span>
          </h1>
          <StatusBadge started={started} running={running} phase={phase} />
        </div>
        <p className="max-w-prose text-body text-text-secondary">
          Investigating the covenant exception across available agreements, amendments, and financials.
        </p>
      </header>

      {/* ------------------------------------------- what raised the exception */}
      {(facts.computed !== null || facts.required !== null) && (
        <section aria-label="Original test result" className="rounded-lg border border-border bg-surface shadow-card">
          <header className="border-b border-border px-4 py-2">
            <h2 className="text-label uppercase tracking-wide text-text-muted">Original test result</h2>
          </header>
          <dl className="grid gap-4 px-4 py-3 sm:grid-cols-4">
            <Fact label="Calculated DSCR" value={facts.computed !== null ? x(facts.computed) : "—"} />
            <Fact label="Minimum" value={facts.required !== null ? x(facts.required) : "—"} />
            <Fact
              label="Shortfall"
              value={facts.shortfall !== null && facts.shortfall > 0 ? x(facts.shortfall) : "—"}
              tone={facts.shortfall !== null && facts.shortfall > 0 ? "text-danger" : undefined}
            />
            <Fact label="Terms used" value={facts.termsVersion !== null ? `v${facts.termsVersion}` : "—"} />
          </dl>
          <p className="border-t border-border px-4 py-2 text-label text-text-muted">
            The figures that raised this exception. Anything the investigation finds appears below, separately.
          </p>
        </section>
      )}

      {/* ----------------------------------------------- what is in the way */}
      {issue && (
        <section
          role="note"
          aria-label="Current issue"
          className="rounded-lg border border-code bg-code-bg px-4 py-3 shadow-card"
        >
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="text-code-bright">
              ▲
            </span>
            <div>
              <p className="text-card text-code-bright">{issue.title}</p>
              <p className="mt-1 max-w-prose text-body text-text">{issue.detail}</p>
              {/* The recovery, named. A missing calculator input is NOT a
                  request for documents, and the two were one message. */}
              <p className="mt-1 max-w-prose text-label text-text-secondary">{issue.next}</p>
            </div>
          </div>
        </section>
      )}

      {/* ----------------------------------- connection health, said separately */}
      {syncError && (
        <div role="status" className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface p-4 shadow-card">
          <div>
            <p className="text-card text-text">{CONNECTION_INTERRUPTED}</p>
            <p className="mt-1 max-w-prose text-body text-text-secondary">{STALLED_NOTICE}</p>
            <p className="mt-1 text-label text-text-muted">
              {reconnecting ? "Reconnecting…" : "Trying to reconnect…"} Reconnecting retrieves this investigation. It
              does not start a new one.
            </p>
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

      {/* ----------------------------------------------- timeline + what's next */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section aria-label="Investigation progress" className="rounded-lg border border-border bg-surface shadow-card">
          <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-section text-text">Investigation progress</h2>
              {summary && <p className="mt-px text-label text-text-secondary">{summary}</p>}
            </div>
            <span className="text-label text-text-muted">
              {started ? freshnessLabel(sinceUpdate) : `Elapsed · ${mmss(elapsed)}`}
            </span>
          </header>

          <div className="space-y-4 p-4">
            {started ? (
              <ol className="space-y-0">
                {steps.map((step, i) => (
                  <TraceStep
                    key={step.n}
                    step={step}
                    state={activityState(step, { last: i === steps.length - 1, running })}
                    last={i === steps.length - 1}
                    links={props.evidence}
                  />
                ))}
              </ol>
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

            {/* The wait explained, rather than a spinner — now collapsed, so it
                is available to a first-time analyst without taking the space
                the timeline needs. */}
            <details className="border-t border-border pt-4">
              <summary className="cursor-pointer list-none text-label text-text-muted underline-offset-2 hover:underline marker:content-['']">
                <span aria-hidden="true">▸ </span>How the investigation works
              </summary>
              <p className="mt-2 max-w-prose text-body text-text-secondary">
                The agent selects which evidence to inspect next and requests calculations as needed. It never produces
                a figure itself.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {INSPECTABLE.map((d) => (
                  <li key={d} className="rounded-md border border-border px-3 py-1 text-label text-text-secondary">
                    {d}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-label text-text-muted">Document types the agent may inspect.</p>
            </details>
          </div>
        </section>

        <div className="space-y-4">
          <section aria-label="Recommendation" className="rounded-lg border border-border bg-surface shadow-card">
            <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="text-section text-text">Recommendation</h2>
              <span className="rounded border border-border-strong px-2 py-px text-label text-text-muted">
                Not yet available
              </span>
            </header>
            <div className="space-y-4 p-4">
              <p className="text-body text-text-secondary">
                CreditScout will present a recommendation with supporting calculations, cited evidence, and any
                unresolved issues when the investigation finishes.
              </p>

              {/* EVIDENCE, not definitions. The outcome glossary used to occupy
                  this space while the retrieved passages had none. */}
              <div className="border-t border-border pt-4">
                <h3 className="text-label uppercase tracking-wide text-text-muted">Evidence gathered</h3>
                {evidence.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {evidence.map((e) => (
                      <li key={e.citation} className="text-body">
                        {e.href ? (
                          <Link href={e.href} className="text-model-bright underline-offset-2 hover:underline">
                            {e.citation}
                          </Link>
                        ) : (
                          <span className="text-text">{e.citation}</span>
                        )}
                        {e.docTitle && <span className="ml-2 text-label text-text-muted">{e.docTitle}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-body text-text-muted">No passages retrieved yet.</p>
                )}
              </div>

              {/* Prior cases inform; they never govern. Collapsed, and the note
                  travels with them. */}
              {(view?.lessons ?? 0) > 0 && (
                <details className="border-t border-border pt-4">
                  <summary className="cursor-pointer list-none text-body text-model-bright underline-offset-2 hover:underline marker:content-['']">
                    <span aria-hidden="true">▸ </span>
                    {view.lessons} related prior case{view.lessons === 1 ? "" : "s"}
                  </summary>
                  {pastCases && (
                    <dl className="mt-2 grid gap-x-4 gap-y-px sm:grid-cols-[max-content_1fr]">
                      <dt className="text-label text-text-muted">Retrieved for</dt>
                      <dd className="text-label text-text-secondary">{pastCases.input || "this exception profile"}</dd>
                      <dt className="text-label text-text-muted">Found</dt>
                      <dd className="text-label text-text-secondary">{pastCases.output}</dd>
                    </dl>
                  )}
                  <p className="mt-2 text-label text-text-muted">{PRIOR_CASES_NOTE}</p>
                </details>
              )}

              {view?.ranWithoutMemory && (
                <p className="border-t border-border pt-4 text-label text-text-muted" title={view.memoryNote ?? undefined}>
                  Ran without memory — the lesson search was unavailable, so no prior cases informed this
                  investigation.
                </p>
              )}

              {/* The outcomes are still named BEFORE one is reached, so the
                  recommendation arrives as one of a known set — just not at the
                  cost of the evidence above it. */}
              <details className="border-t border-border pt-4">
                <summary className="cursor-pointer list-none text-label text-text-muted underline-offset-2 hover:underline marker:content-['']">
                  <span aria-hidden="true">▸ </span>About recommendation outcomes
                </summary>
                <dl className="mt-2 space-y-2">
                  {OUTCOMES.map((o) => (
                    <div key={o.label}>
                      <dt className="text-body text-text">{o.label}</dt>
                      <dd className="text-label text-text-muted">{o.detail}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
          </section>
        </div>
      </div>

      <p className="text-label text-text-muted">The agent recommends. You make the final decision.</p>
    </article>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-label text-text-muted">{label}</dt>
      <dd className={`mt-px text-num tabular-nums ${tone ?? "text-text"}`}>{value}</dd>
    </div>
  );
}

/**
 * The run's state, as far as the server has confirmed it. When the updates stop,
 * this does NOT keep saying "in progress" — that is the one claim an
 * investigation screen must not make on its own authority.
 */
function StatusBadge({ started, running, phase }: { started: boolean; running: boolean; phase: string }) {
  if (!running) {
    return (
      <span className="rounded border border-border-strong px-2 py-px text-label text-text-muted">Status unavailable</span>
    );
  }
  const label = started ? "Investigation in progress" : phase === "starting" ? "Starting investigation" : "Investigation in progress";
  return (
    <span className="inline-flex items-center gap-2 rounded border border-model bg-model-bg px-2 py-px text-label text-model-bright">
      <span aria-hidden="true">●</span>
      {label}
    </span>
  );
}
