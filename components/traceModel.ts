/**
 * The live investigation trace, as pure functions. No React, no I/O: the client
 * component only draws what this decides, and `node --test` can exercise it.
 *
 * What must not be wrong on this screen:
 *   - which layer a trace step belongs to, decided from `tool` ALONE. A
 *     specialist's own name is teal (a model reasoned); a tool's name is amber
 *     (code computed). The teal/amber alternation IS the product claim, so it is
 *     a property of the data and never styled by hand (design.md §12.15).
 *   - the two app-written markers (`memory_loaded`, `memory_unavailable`) are
 *     NEITHER a model step nor a code step — they are the application speaking,
 *     and are rendered distinctly.
 *   - whether the poll loop keeps going or hands off to the concluded view, and
 *     that the 1–3s "no run yet" window reads as "still starting", not failed.
 */
import {
  CALCULATOR_TOOL,
  MEMORY_LOADED_STEP,
  MEMORY_UNAVAILABLE_STEP,
  lessonsLoaded,
  truncate,
  type TraceEntry,
} from "../lib/agent/trace.ts";
import { SPECIALIST_NAMES } from "../lib/agent/specialist-names.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const int = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

// ------------------------------------------------------------- the classifier

/**
 * The tools the agent calls over our own OpenAPI routes. Code produced their
 * output, so a step carrying one of these names is amber. `CALCULATOR_TOOL` is
 * reused from `trace.ts` rather than restrung; the other two are the stable
 * operationIds the tool routes and the summarisers in `trace.ts` already use.
 */
export const TOOL_NAMES: readonly string[] = [CALCULATOR_TOOL, "search_documents", "search_past_cases"];

/** App-written entries, not steps the agent took. Reused from `trace.ts`, never restrung. */
export const MARKER_STEPS: readonly string[] = [MEMORY_LOADED_STEP, MEMORY_UNAVAILABLE_STEP];

/**
 * teal (a model reasoned) · amber (code computed) · marker (the app speaking) ·
 * unknown (a tool type we have never seen). An unknown step is NOT coloured
 * amber: amber is reserved for code output, and painting an unattributable step
 * amber would dilute the one affordance the product leans on. It settles to a
 * neutral rule instead, still visible, never silent.
 */
export type TraceKind = "model" | "code" | "marker" | "unknown";

export function traceStepKind(tool: unknown): TraceKind {
  const name = str(tool);
  if (MARKER_STEPS.includes(name)) return "marker";
  if ((SPECIALIST_NAMES as readonly string[]).includes(name)) return "model";
  if (TOOL_NAMES.includes(name)) return "code";
  return "unknown";
}

export const isCalculatorStep = (tool: unknown): boolean => str(tool) === CALCULATOR_TOOL;

/**
 * A plain-language line saying what a step was FOR — "why it mattered" (audit
 * 3.7), so the trace reads as an investigation and not a log of opaque calls.
 *
 * This is derived from the tool/specialist name ALONE and is purely for display:
 * it adds no figure, changes no recommendation, and crucially requires no change
 * to the agent's prompt or output contract. An unknown step gets no line rather
 * than a guessed one — the same discipline the colouring already keeps (an
 * unattributable step is never dressed up as something it is not).
 */
const STEP_ROLE: Record<string, string> = {
  // specialists (a model reasoned)
  document_agent: "Reads the borrower's filing and pulls the figures and clauses that bear on the test.",
  definition_agent: "Interprets the covenant's own definition of the ratio — what the terms say counts in the numerator and denominator.",
  research_agent: "Weighs precedent and context to frame a recommendation for the analyst to decide on.",
  // tools (code computed)
  [CALCULATOR_TOOL]: "Computes the ratio itself from the approved terms — the figure the recommendation rests on, never guessed.",
  search_documents: "Retrieves the exact passage from a document so every claim can cite its source.",
  search_past_cases: "Finds how similar exceptions were decided before — to inform this one, never to decide it.",
};

export function stepRole(tool: unknown): string | null {
  return STEP_ROLE[str(tool)] ?? null;
}

// ---------------------------------------------------------------- the view

/** One row the trace draws. The colour follows `kind`, which follows `tool`. */
export interface TraceStepView {
  /** Display position among AGENT steps, renumbered from 1 (markers are not steps). */
  n: number;
  tool: string;
  kind: TraceKind;
  input: string;
  output: string;
  /** ISO 8601, or "" when the entry carried no usable stamp. */
  ts: string;
  /** The calculator's summary is the demo's headline and is given weight. */
  calculator: boolean;
  /** Plain-language "what this step was for", or null for an unattributable step. */
  role: string | null;
  /**
   * The orchestrator's decision AT this step, derived from the sequence (not from
   * any model reasoning, which Foundry does not expose): why the investigation
   * turned here. Null on a step that is not a turning point.
   */
  decision: string | null;
}

/**
 * What the live screen draws: the lessons that informed the run (for the "seen
 * similar" badge), whether it ran cold after a memory failure, and the agent
 * steps in order. Markers are pulled out of the step list — they are the
 * application speaking and belong at the top, not numbered among the agent's work.
 */
export interface LiveTraceView {
  /** From the `memory_loaded` entry's `count`; 0 when there is none (no badge). */
  lessons: number;
  /** A `memory_unavailable` marker is present: the search failed and the run went cold. */
  ranWithoutMemory: boolean;
  /** The `memory_unavailable` entry's note, verbatim, or null. */
  memoryNote: string | null;
  steps: TraceStepView[];
}

const asEntries = (trace: unknown): TraceEntry[] => {
  const list = Array.isArray(trace) ? trace : [];
  return list.filter(
    (e): e is TraceEntry => isObj(e) && typeof e.tool === "string" && typeof e.input_summary === "string" && typeof e.output_summary === "string",
  );
};

export function buildLiveTrace(trace: unknown): LiveTraceView {
  const entries = asEntries(trace);
  const unavailable = entries.find((e) => e.tool === MEMORY_UNAVAILABLE_STEP) ?? null;

  const steps: TraceStepView[] = [];
  for (const e of entries) {
    const kind = traceStepKind(e.tool);
    if (kind === "marker") continue; // the app speaking, rendered separately
    steps.push({
      n: steps.length + 1,
      tool: e.tool,
      kind,
      input: truncate(str(e.input_summary)),
      output: truncate(str(e.output_summary)),
      ts: str(e.ts),
      calculator: isCalculatorStep(e.tool),
      role: stepRole(e.tool),
      decision: null,
    });
  }

  // Second pass: the orchestrator's turning points, read from adjacency.
  steps.forEach((s, i) => {
    s.decision = decisionFor(s, steps[i - 1]);
  });

  return {
    // Reuse F9b's reader so the live badge and the concluded badge count lessons
    // the same way: the `memory_loaded` entry's `count`, never a recomputation.
    lessons: lessonsLoaded(trace),
    ranWithoutMemory: unavailable !== null,
    memoryNote: unavailable ? truncate(str(unavailable.output_summary)) : null,
    steps,
  };
}

// ------------------------------------------------------ orchestration framing

/** A calculator step whose summary says the ratio did not meet the threshold. */
function calcFailed(step: TraceStepView): boolean {
  return step.calculator && /\bfail\b/i.test(step.output);
}

/**
 * The orchestrator's decision at a step, read from the SEQUENCE alone — the spike
 * confirmed Foundry exposes no step-by-step reasoning, so this never invents a
 * motive. It only names a turning point the structure makes unambiguous: a
 * delegation right after a failing baseline, and a recalculation right after a
 * specialist returned corrected terms.
 */
function decisionFor(step: TraceStepView, prev: TraceStepView | undefined): string | null {
  if (!prev) return null;
  if (step.kind === "model" && calcFailed(prev)) {
    return "The baseline did not pass — the CreditScout Agent delegated to reinterpret the covenant rather than conclude.";
  }
  if (step.calculator && prev.kind === "model") {
    return "Recomputed on the corrected terms the specialist returned.";
  }
  return null;
}

export interface ArcView {
  searches: number;
  calculations: number;
  delegations: number;
  /** A one-line plan summary, or null when there are no steps yet. */
  summary: string | null;
}

/**
 * The investigation as a plan, in one line — so the trace reads as an
 * orchestration the agent carried out, not a log. Derived from the steps already
 * built; purely a count, never a claim about intent.
 */
export function investigationArc(steps: readonly TraceStepView[]): ArcView {
  const searches = steps.filter((s) => s.tool === "search_documents" || s.tool === "search_past_cases").length;
  const calculations = steps.filter((s) => s.calculator).length;
  const delegations = steps.filter((s) => s.kind === "model").length;
  const parts: string[] = [];
  if (searches > 0) parts.push(`${searches} evidence ${searches === 1 ? "search" : "searches"}`);
  if (calculations > 0) parts.push(`${calculations} ${calculations === 1 ? "calculation" : "calculations"}`);
  if (delegations > 0) parts.push(`${delegations} specialist ${delegations === 1 ? "delegation" : "delegations"}`);
  return { searches, calculations, delegations, summary: parts.length > 0 ? parts.join(" · ") : null };
}

// ----------------------------------------------------------- the poll reducer

/** Our status for a casefile that is still being driven forward. */
export const LIVE_STATUS = "investigating";

/** The sanitised result the poll Server Action hands the client. It NEVER carries the tool key. */
export interface SyncState {
  casefileId: string;
  /** Our status for the casefile. Anything but `investigating` is terminal for the poll. */
  casefileStatus: string;
  /** Foundry's status for the run. `starting` is the "claimed, no run yet" window (O-1). */
  runStatus: string;
  steps: number;
  maxSteps: number;
  stopped: string | null;
  error: string | null;
}

export type PollDecision =
  | { action: "poll"; phase: "starting" | "running"; status: string }
  | { action: "stop"; status: string };

/**
 * Keep polling while the casefile is `investigating`; stop and hand off to the
 * concluded view for every terminal status (`pending_review`, `awaiting_docs`,
 * `approved`, `overridden`, `failed`).
 *
 * The 1–3s "no run yet" window (O-1 / R2-4) arrives as `investigating` with run
 * status `starting`: the sync route returns it rather than failing, and this
 * reducer reads it as `phase: "starting"` — still starting, NOT failed. The poll
 * keeps going and starts nothing of its own; `syncRun`'s in-process mutex and
 * the `casefiles_one_live_per_exception` index guard against a second run.
 */
export function pollDecision(state: Pick<SyncState, "casefileStatus" | "runStatus">): PollDecision {
  if (state.casefileStatus !== LIVE_STATUS) return { action: "stop", status: state.casefileStatus };
  const phase = state.runStatus === "starting" ? "starting" : "running";
  return { action: "poll", phase, status: state.casefileStatus };
}

/** Parse a raw `/api/investigate/sync` body into a client-safe `SyncState`. No tool key, ever. */
export function toSyncState(casefileId: string, raw: unknown): SyncState {
  const d = isObj(raw) ? raw : {};
  return {
    casefileId,
    casefileStatus: str(d.casefile_status) || LIVE_STATUS,
    runStatus: str(d.run_status) || "unknown",
    steps: int(d.steps),
    maxSteps: int(d.max_steps),
    stopped: typeof d.stopped === "string" ? d.stopped : null,
    error: typeof d.error === "string" ? d.error : null,
  };
}

// ------------------------------------- what the step DID, as an activity title

/**
 * An activity title, in the words an analyst would use.
 *
 * The trace led with the tool's identifier — `search_documents`, `dscr_calculator` —
 * which reads as a developer log. Worse, every row carried the same CODE badge,
 * so a column of identical amber tags implied that no reasoning happened. The
 * opposite is true: the orchestrator chose every one of those calls and its
 * arguments. That choice is the agentic part, and it was the least visible thing
 * on the screen.
 *
 * Derived from the tool name alone. It adds no figure and changes no
 * recommendation, and an unknown tool keeps its identifier rather than being
 * given an invented title.
 */
const ACTIVITY_TITLE: Record<string, string> = {
  document_agent: "Asked a specialist to read the filing",
  definition_agent: "Asked a specialist to re-read the covenant definition",
  research_agent: "Asked a specialist to weigh the evidence",
  [CALCULATOR_TOOL]: "Calculated the ratio",
  search_documents: "Retrieved covenant and financial evidence",
  search_past_cases: "Looked up how similar exceptions were decided",
};

export function activityTitle(tool: unknown): string {
  return ACTIVITY_TITLE[str(tool)] ?? str(tool);
}

/**
 * Who performed the step — distinct from who CHOSE it.
 *
 * Every step is chosen by the orchestrator; this says what ran once it was
 * chosen. Keeping the distinction explicit is the point: "code" on a retrieval
 * step must not be read as "no model was involved in this investigation".
 */
export const ACTOR_LABEL: Record<TraceKind, string | null> = {
  model: "Specialist model",
  code: "Deterministic code",
  marker: null,
  unknown: null,
};

/**
 * One sentence over the whole activity list, so the attribution is stated once
 * rather than implied by a badge on every row.
 *
 * Says only what is true: the agent selected each call. It does NOT claim to
 * show the agent's reasoning, which Foundry does not expose.
 */
export function activityAttribution(steps: readonly { kind: TraceKind }[]): string {
  const delegations = steps.filter((s) => s.kind === "model").length;
  const base = "The CreditScout Agent chose each of these steps and its arguments.";
  if (delegations === 0) return `${base} It ran them against its own tools without delegating.`;
  return `${base} ${delegations} ${delegations === 1 ? "was a delegation" : "were delegations"} to a specialist model.`;
}

// ------------------------------------------------------- a stalled run

/**
 * How long an investigation may go without progress before it is PAUSED
 * rather than running.
 *
 * A drive slice advances the Foundry run and returns; the browser then asks for
 * the next one. If nothing asks — the tab was closed, the laptop slept, the
 * network dropped — the run stops where it is. Nothing on the server resumes
 * it: Vercel caps a function at 60s and an investigation needs 60–90s across
 * several slices, so there is no process that could carry it alone.
 *
 * Two minutes is comfortably longer than the slowest observed step (a
 * specialist delegation took 38s) and short enough that an abandoned run is
 * named quickly rather than spinning for an afternoon.
 */
export const STALL_AFTER_MS = 2 * 60 * 1000;

/**
 * Whether an `investigating` casefile is actually advancing.
 *
 * THE DEFECT THIS NAMES: a frozen run showed "Watch live" on the queue and a
 * live-looking trace on the casefile, indefinitely. The UI asserted progress
 * that had stopped — the one thing an investigation screen must not do. It is
 * not a crash and not a failure: the work is intact and resumes the moment
 * something drives it again. It is paused, and it should say so.
 */
export function investigationStalled(
  casefile: { status?: unknown; last_step_at?: unknown; created_at?: unknown },
  now: number = Date.now(),
): boolean {
  if (casefile.status !== "investigating") return false;
  const stamp =
    typeof casefile.last_step_at === "string" && casefile.last_step_at
      ? casefile.last_step_at
      : typeof casefile.created_at === "string"
        ? casefile.created_at
        : null;
  if (!stamp) return false;
  const t = Date.parse(stamp);
  if (!Number.isFinite(t)) return false;
  return now - t > STALL_AFTER_MS;
}

/** What the analyst is told, and offered, when a run is paused. */
export const STALLED_NOTICE =
  "This investigation is paused. It advances while this page is open and stops if the tab is closed — nothing is lost, and it resumes from where it stopped.";
