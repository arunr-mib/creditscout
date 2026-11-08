import Link from "next/link";

import { AgentTag } from "./AgentTag";
import {
  ACTIVITY_STATE_LABEL,
  activityResult,
  ACTOR_LABEL,
  activityTitle,
  searchCitations,
  type ActivityState,
  type EvidenceLink,
  type TraceStepView,
} from "./traceModel";

/**
 * One activity in the investigation timeline.
 *
 * TWO THINGS THIS SCREEN MUST NOT DO, both of which it used to:
 *
 *  1. Describe a calculation ATTEMPT as a completed calculation. A calculator
 *     step that returned `missing input: …` rendered identically to one that
 *     returned a ratio. Every row now carries an explicit state — Completed,
 *     Needs input, In progress — decided by `activityState`, never by styling.
 *
 *  2. Spend amber on routine work. On the live screen amber means ONE thing:
 *     the calculation cannot proceed. A column of amber rules on successful
 *     searches made a working investigation look like a page of warnings, and
 *     left nothing to say the real issue with.
 *
 * Attribution survives in WORDS, which is where it belongs on a screen that
 * also has to signal state: the actor is named on the row ("Specialist model" /
 * "Deterministic code"). The one colour it takes is the AGENT's: a step a
 * specialist model performed, and the orchestrator's reasoning line above a
 * step, carry the agent tag and an agent left edge. Calculator and retrieval
 * steps are code, not the agent, and take neither.
 */

/**
 * Three states, three treatments.
 *
 * `completed` is SLATE, filled — not green. Green in this product means a
 * verified pass or a recorded resolution, and a finished retrieval step is
 * neither: an investigation can complete every one of its steps and still
 * escalate. Colouring the steps green would let an analyst read "all green" as
 * "all clear", which is the one inference this screen must not invite.
 *
 * Slate is the human/settled tone and carries the weight the owner asked for —
 * a filled chip at 10:1 rather than a grey outline that read as disabled.
 */
const DOT: Record<ActivityState, { icon: string; ring: string; ink: string }> = {
  completed: { icon: "✓", ring: "border-human bg-human-bg", ink: "text-human" },
  needs_input: { icon: "!", ring: "border-code bg-code-bg", ink: "text-code-bright" },
  in_progress: { icon: "◌", ring: "border-border-strong bg-surface-raised", ink: "text-text-secondary" },
};

const STATE_CHIP: Record<ActivityState, string> = {
  completed: "border-human bg-human-bg font-medium text-human",
  needs_input: "border-code bg-code-bg font-medium text-code-bright",
  in_progress: "border-border-strong bg-surface-raised font-medium text-text-secondary",
};

/**
 * In progress takes the agent's colours only on a step the agent (a specialist
 * model) is performing. A calculator or retrieval step is code: it stays neutral
 * while it runs, and amber stays reserved for "the calculation cannot proceed".
 */
const AGENT_IN_PROGRESS = {
  dot: { icon: "◌", ring: "border-agent bg-agent-bg", ink: "text-agent-ink" },
  chip: "border-agent bg-agent-bg font-medium text-agent-ink",
};

function clock(ts: string): string {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

export function TraceStep({
  step,
  state = "completed",
  last = false,
  links = [],
}: {
  step: TraceStepView;
  state?: ActivityState;
  /** The last item draws no connector below it. */
  last?: boolean;
  /** Citation -> document, so a retrieved passage is reachable from the row itself. */
  links?: readonly EvidenceLink[];
}) {
  const time = clock(step.ts);
  // A specialist model's step is the agent's own work (see `agentStep` below).
  const agentStep = step.kind === "model";
  const agentRunning = agentStep && state === "in_progress";
  const dot = agentRunning ? AGENT_IN_PROGRESS.dot : DOT[state];
  const chip = agentRunning ? AGENT_IN_PROGRESS.chip : STATE_CHIP[state];
  const hits = state === "completed" ? searchCitations(step.output) : null;

  return (
    <li className="relative pl-8">
      {/* A connected vertical timeline: one rail, not a stack of left borders. */}
      {!last && <span aria-hidden="true" className="absolute bottom-0 left-3 top-6 w-px bg-border" />}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-px inline-flex h-6 w-6 items-center justify-center rounded-md border text-label ${dot.ring} ${dot.ink}`}
      >
        {dot.icon}
      </span>

      <div className={`${last ? "" : "pb-6"} ${agentStep ? "border-l-2 border-agent pl-3" : ""}`}>
        {/* The orchestrator's turn that led here, read from the sequence. Agent
            ink: it is the reasoning layer deciding, not a tool computing. */}
        {step.decision && (
          <p className="mb-2 flex items-start gap-2 text-label text-agent-ink">
            <span aria-hidden="true">↳</span>
            {step.decision}
          </p>
        )}

        <p className="flex flex-wrap items-baseline gap-3">
          {/* THE ACTIVITY LEADS, not the function name. A column of identical
              `search_documents` rows each badged CODE read as a developer log,
              and implied no reasoning happened — when in fact the agent chose
              every one of these calls. The identifier moves to the technical
              details below. */}
          <span className={`${step.calculator ? "text-card" : "text-body"} text-text`}>{activityTitle(step.tool)}</span>
          <span className={`inline-flex rounded border px-2 py-px text-badge ${chip}`}>
            {ACTIVITY_STATE_LABEL[state]}
          </span>
          {agentStep && <AgentTag>Specialist model</AgentTag>}
          {time && <span className="ml-auto text-label tabular-nums text-text-muted">{time}</span>}
        </p>

        {step.role && <p className="mt-1 text-label text-text-muted">{step.role}</p>}

        {/* The RESULT, concise and in the page's own typeface. Only a computed
            figure keeps mono — it is an identifier-bearing figure, not prose. */}
        {hits ? (
          // The passages it found, reachable from here. Burying a citation in
          // technical details makes the analyst take the agent's word for it.
          <p className="mt-1 flex flex-wrap items-baseline gap-2 text-body text-text-secondary">
            <span>
              Found {hits.count} {hits.count === 1 ? "passage" : "passages"}:
            </span>
            {hits.citations.map((c) => {
              const href = links.find((l) => l.citation === c)?.href ?? null;
              return href ? (
                <Link key={c} href={href} className="text-text underline decoration-border-strong underline-offset-2 hover:decoration-text">
                  {c}
                </Link>
              ) : (
                <span key={c} className="text-text">
                  {c}
                </span>
              );
            })}
          </p>
        ) : (
          step.output && (
            <p
              className={`mt-1 text-body ${
                state === "needs_input" ? "text-code-bright" : step.calculator ? "tabular-nums text-text" : "text-text-secondary"
              }`}
            >
              {activityResult(step)}
            </p>
          )
        )}

        {/* Tool name, the query, the actor and the timestamp: true, and not
            what an analyst reads first. Collapsed by default. */}
        <details className="mt-1">
          <summary className="cursor-pointer list-none text-label text-text-muted underline-offset-2 hover:underline marker:content-['']">
            <span aria-hidden="true">▸ </span>Technical details
          </summary>
          <dl className="mt-1 grid gap-x-4 gap-y-px sm:grid-cols-[max-content_1fr]">
            {state === "needs_input" && (
              <>
                <dt className="text-label text-text-muted">Returned</dt>
                <dd className="font-mono text-label text-code-bright">{step.output}</dd>
              </>
            )}
            <dt className="text-label text-text-muted">Tool</dt>
            <dd className="font-mono text-label text-text-secondary">{step.tool}</dd>
            {step.input && (
              <>
                <dt className="text-label text-text-muted">Request</dt>
                <dd className="font-mono text-label text-text-secondary">{step.input}</dd>
              </>
            )}
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
      </div>
    </li>
  );
}
