import type { TraceKind, TraceStepView } from "./traceModel";

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
      <p className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-label text-text-muted" aria-hidden="true">
          {step.n}
        </span>
        <span className={`${step.calculator ? "text-card" : "text-body"} font-mono ${NAME[step.kind]}`}>{step.tool}</span>
        {step.kind === "code" && (
          <span className="rounded-sm bg-code-bg px-1 py-px text-badge uppercase tracking-wider text-code">code</span>
        )}
        {step.kind === "model" && (
          <span className="rounded-sm bg-model-bg px-1 py-px text-badge uppercase tracking-wider text-model">agent</span>
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
    </li>
  );
}
