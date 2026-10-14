import { ACTOR_LABEL, activityTitle, type TraceKind, type TraceStepView } from "./traceModel";

/**
 * design.md §5.5 / §12.15. One row of the live trace: step number, the
 * tool/specialist name, the input→output summaries, and a timestamp. The colour
 * comes from `kind`, which comes from `tool` alone — the teal/amber alternation
 * IS the demo, so it is never styled by hand.
 *
 *   model   a specialist reasoned     → teal left rule, teal name
 *   code    a tool computed           → amber left rule, amber name
 *   unknown an unattributable step    → neutral rule (never amber; amber is code)
 *
 * The calculator (`dscr_calculator`) is given weight: its summary is the one the
 * demo reads out loud, and it already carries the figure with its `calc_id`, so
 * its output renders in amber mono — a computed figure with its provenance, never
 * a bare number.
 */

const RULE: Record<TraceKind, string> = {
  model: "border-model",
  code: "border-code",
  marker: "border-border-strong",
  unknown: "border-border-strong",
};

const NAME: Record<TraceKind, string> = {
  model: "text-model-bright",
  code: "text-code-bright",
  marker: "text-text-muted",
  unknown: "text-text-secondary",
};

function clock(ts: string): string {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

export function TraceStep({ step }: { step: TraceStepView }) {
  const time = clock(step.ts);
  return (
    <li className={`border-l-2 ${RULE[step.kind]} pl-3`}>
      {/* The orchestrator's turn that led here, read from the sequence. Teal: it
          is the reasoning layer deciding, not a tool computing. */}
      {step.decision && (
        <p className="mb-2 flex items-start gap-2 text-label text-model-bright">
          <span aria-hidden="true">↳</span>
          {step.decision}
        </p>
      )}
      <p className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-label text-text-muted" aria-hidden="true">
          {step.n}
        </span>
        {/* THE ACTIVITY LEADS, not the function name. A column of identical
            `search_documents` rows each badged CODE read as a developer log,
            and implied no reasoning happened — when in fact the agent chose
            every one of these calls. The identifier moves to the technical
            details below. */}
        <span className={`${step.calculator ? "text-card" : "text-body"} ${NAME[step.kind]}`}>
          {activityTitle(step.tool)}
        </span>
        {step.kind === "model" && (
          <span className="rounded-sm bg-model-bg px-1 py-px text-badge uppercase tracking-wider text-model">
            specialist model
          </span>
        )}
        {time && <span className="ml-auto font-mono text-label text-text-muted">{time}</span>}
      </p>
      {step.role && <p className="mt-1 text-label text-text-muted">{step.role}</p>}
      {step.input && (
        <p className="mt-1 text-body text-text-secondary">
          <span className="text-text-muted">in · </span>
          {step.input}
        </p>
      )}
      {step.output && (
        <p className={`mt-1 ${step.calculator ? "font-mono text-code-bright" : "text-body text-text-secondary"}`}>
          <span className="font-sans text-text-muted">out · </span>
          {step.output}
        </p>
      )}

      {/* Tool name, actor and timestamp: true, and not what an analyst reads
          first. Collapsed by default. */}
      <details className="mt-1">
        <summary className="cursor-pointer list-none text-label text-text-muted underline-offset-2 hover:underline marker:content-['']">
          Technical details
        </summary>
        <dl className="mt-1 grid gap-x-4 gap-y-px sm:grid-cols-[max-content_1fr]">
          <dt className="text-label text-text-muted">Tool</dt>
          <dd className="font-mono text-label text-text-secondary">{step.tool}</dd>
          {ACTOR_LABEL[step.kind] && (
            <>
              <dt className="text-label text-text-muted">Ran in</dt>
              <dd className="text-label text-text-secondary">{ACTOR_LABEL[step.kind]}</dd>
            </>
          )}
          {time && (
            <>
              <dt className="text-label text-text-muted">At</dt>
              <dd className="font-mono text-label text-text-secondary">{time}</dd>
            </>
          )}
        </dl>
      </details>
    </li>
  );
}
