/**
 * Foundry run steps -> the live trace the analyst watches.
 *
 * The alternation IS the product claim. A `connected_agent` step carries the
 * specialist's own name (`document_agent`, `definition_agent`,
 * `research_agent`) and a `function` step carries the tool's name
 * (`dscr_calculator`, `search_documents`, `search_past_cases`), so the UI
 * colours teal-for-model / amber-for-code from `tool` alone. Nothing downstream
 * has to infer which layer produced a step, which is exactly the inference that
 * would quietly start colouring a model step amber.
 *
 * Pure. No network, no database, no clock — the whole file is a function of its
 * argument, which is why it is the part of stage 8 worth unit-testing hardest.
 */

export interface TraceEntry {
  /** 1-based position in the investigation, in the order the work happened. */
  n: number;
  /** The specialist's name, or the tool's. Never a step type. */
  tool: string;
  input_summary: string;
  output_summary: string;
  /** ISO 8601. When the step finished, falling back to when it started. */
  ts: string;
}

/** A trace is a live view, not a transcript. Past this, nobody reads it. */
export const SUMMARY_MAX = 240;

/** The calculator. Named here because its summary is the one the demo reads out loud. */
export const CALCULATOR_TOOL = "dscr_calculator";

/**
 * A step this application recorded, not one the agent took.
 *
 * `memory_unavailable` means the lesson search failed and the investigation ran
 * with no past lessons at all. It is a STABLE NAME, not prose, because the
 * cold-versus-warm comparison has to filter on it: a warm run whose memory
 * search failed is not a warm run, and counting it as one would corrupt a
 * number we intend to report. Stage 10's runner matches this constant.
 */
export const MEMORY_UNAVAILABLE_STEP = "memory_unavailable";

/**
 * Trace entries written by us rather than mapped from a Foundry run step.
 *
 * `mapRunStepsToTrace` is a pure function of the run's steps, so mirroring
 * overwrites the whole array; anything in this set has to survive that, or a
 * degradation recorded before the run started would be erased by the first
 * sync.
 */
export const LOCAL_TRACE_TOOLS: readonly string[] = [MEMORY_UNAVAILABLE_STEP];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Collapse whitespace, then cut to SUMMARY_MAX with an ellipsis that counts toward the limit. */
export function truncate(text: string, max: number = SUMMARY_MAX): string {
  const t = collapse(text);
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** Tool arguments and outputs arrive as JSON strings. A non-JSON string is still useful text. */
function asJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const text = (raw: unknown): string => (typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : JSON.stringify(raw));

const num = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? Number(v).toLocaleString("en-US") : "?");

/** Enough of a uuid to recognise in a trace, not enough to retype from a screenshot. */
const shortId = (v: unknown): string => (typeof v === "string" && v.length >= 8 ? v.slice(0, 8) : "?");

// ------------------------------------------------------------- summarisers

/**
 * The add-back line is written with the uncapped case first because that is the
 * documented trap: no `cap` field, or `cap: null`, means UNCAPPED. A summary
 * that printed `cap 0` would make a correct calculation look like a wrong one.
 */
function addbackLine(addbacks: unknown): string {
  if (!Array.isArray(addbacks) || addbacks.length === 0) return "none";
  return addbacks
    .map((a) => {
      const row = isObj(a) ? a : {};
      const name = typeof row.name === "string" ? row.name : "unnamed";
      return row.cap === undefined || row.cap === null ? `${name} (uncapped)` : `${name} (cap ${num(row.cap)})`;
    })
    .join(", ");
}

function calculatorInput(args: unknown): string {
  if (!isObj(args)) return text(args);
  const terms = isObj(args.terms) ? args.terms : {};
  const threshold = isObj(terms.threshold) ? terms.threshold.min_dscr : undefined;
  const numerator = isObj(terms.numerator) ? terms.numerator : {};
  const financials = isObj(args.financials) ? args.financials : {};
  return `threshold ${typeof threshold === "number" ? threshold : "?"} · EBITDA ${num(financials.ebitda)} · add-backs: ${addbackLine(numerator.addbacks)}`;
}

function calculatorOutput(out: unknown): string {
  if (!isObj(out)) return text(out);
  // An error is evidence ("this input is missing"), not an outage, and it has no
  // calc_id — so it must not read like a figure.
  if (typeof out.error === "string") return `no calculation: ${out.error}`;
  const verdict = out.pass === true ? "pass" : out.pass === false ? "fail" : "?";
  return `DSCR ${typeof out.dscr === "number" ? out.dscr : "?"} vs ${typeof out.threshold === "number" ? out.threshold : "?"} — ${verdict} (calc_id ${shortId(out.calc_id)})`;
}

function searchDocumentsInput(args: unknown): string {
  if (!isObj(args)) return text(args);
  const types = Array.isArray(args.doc_types) && args.doc_types.length > 0 ? ` in ${args.doc_types.join(", ")}` : "";
  return `"${text(args.query)}"${types}`;
}

function searchDocumentsOutput(out: unknown): string {
  if (isObj(out) && typeof out.error === "string") return `search failed: ${out.error}`;
  if (!Array.isArray(out)) return text(out);
  if (out.length === 0) return "no matching text";
  const cites = out.map((h) => (isObj(h) && typeof h.citation === "string" ? h.citation : "?"));
  return `${out.length} chunk${out.length === 1 ? "" : "s"}: ${[...new Set(cites)].join(", ")}`;
}

function pastCasesOutput(out: unknown): string {
  if (isObj(out) && typeof out.error === "string") return `search failed: ${out.error}`;
  if (!Array.isArray(out)) return text(out);
  if (out.length === 0) return "no lessons on file";
  const tags = out.map((h) => (isObj(h) && typeof h.pattern_tag === "string" ? h.pattern_tag : "untagged"));
  return `${out.length} lesson${out.length === 1 ? "" : "s"}: ${tags.join(", ")}`;
}

/** A specialist is invoked with free text, so show the text rather than its JSON wrapper. */
function delegationInput(args: unknown): string {
  if (typeof args === "string") return args;
  if (!isObj(args)) return text(args);
  const first = Object.values(args).find((v) => typeof v === "string" && v.trim() !== "");
  return typeof first === "string" ? first : text(args);
}

type Summariser = (parsed: unknown, raw: unknown) => string;

const INPUT_SUMMARISERS: Record<string, Summariser> = {
  [CALCULATOR_TOOL]: calculatorInput,
  search_documents: searchDocumentsInput,
  search_past_cases: (parsed, raw) => (isObj(parsed) ? text(parsed.exception_profile) : text(raw)),
};

const OUTPUT_SUMMARISERS: Record<string, Summariser> = {
  [CALCULATOR_TOOL]: calculatorOutput,
  search_documents: searchDocumentsOutput,
  search_past_cases: pastCasesOutput,
};

function summarise(tool: string, raw: unknown, table: Record<string, Summariser>, fallback: Summariser): string {
  const parsed = asJson(raw);
  const fn = table[tool] ?? fallback;
  // A tool-aware summariser is a convenience; it must never be the reason a
  // step is missing from the trace. Anything it throws degrades to raw text.
  try {
    return truncate(fn(parsed === undefined ? raw : parsed, raw));
  } catch {
    return truncate(text(raw));
  }
}

// ------------------------------------------------------------------ mapping

interface ToolCallView {
  tool: string;
  args: unknown;
  output: unknown;
}

/** One Foundry tool call, whichever of the two shapes it arrived in. */
function readToolCall(call: unknown): ToolCallView | null {
  if (!isObj(call)) return null;
  // A connected agent IS the specialist: its own name is the trace's `tool`,
  // which is what makes the teal/amber alternation a property of the data.
  const detail = isObj(call.connected_agent) ? call.connected_agent : isObj(call.function) ? call.function : null;
  if (detail && typeof detail.name === "string" && detail.name !== "") {
    return { tool: detail.name, args: detail.arguments, output: detail.output };
  }
  // A tool type we have never seen still earns a visible step. Silence here
  // would mean work the analyst cannot see happened.
  if (typeof call.type === "string" && call.type !== "") {
    return { tool: call.type, args: undefined, output: isObj(call[call.type]) ? call[call.type] : undefined };
  }
  return null;
}

const seconds = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function stampOf(step: Record<string, unknown>): string {
  const at = seconds(step.completed_at) ?? seconds(step.created_at);
  return at === null ? new Date(0).toISOString() : new Date(at * 1000).toISOString();
}

/**
 * Every COMPLETED tool call, oldest first, numbered from 1.
 *
 * Three things it deliberately does:
 *
 *   - sorts by `created_at`. Foundry's /steps returns newest first by default,
 *     and a trace in reverse would show the calculator being consulted before
 *     the document it was consulted about.
 *   - drops steps that are not `completed`. A step still running has no output,
 *     and an in-flight step rendered as a finished one is a false impression.
 *   - drops `message_creation`. Spec 4.2 counts TOOL CALLS as steps, the step
 *     cap is measured in them, and a transcript of the model narrating itself
 *     is not what the trace is for.
 */
export function mapRunStepsToTrace(steps: unknown): TraceEntry[] {
  const list = Array.isArray(steps) ? steps : [];
  const ordered = list
    .map((step, index) => ({ step, index }))
    .filter((s): s is { step: Record<string, unknown>; index: number } => isObj(s.step))
    .sort((a, b) => {
      const ta = seconds(a.step.created_at);
      const tb = seconds(b.step.created_at);
      if (ta !== null && tb !== null && ta !== tb) return ta - tb;
      return a.index - b.index;
    });

  const out: TraceEntry[] = [];
  for (const { step } of ordered) {
    if (step.status !== "completed") continue;
    if (step.type !== "tool_calls") continue;
    const details = isObj(step.step_details) ? step.step_details : {};
    const calls = Array.isArray(details.tool_calls) ? details.tool_calls : [];
    const ts = stampOf(step);
    for (const call of calls) {
      const view = readToolCall(call);
      if (!view) continue;
      out.push({
        n: out.length + 1,
        tool: view.tool,
        input_summary: summarise(view.tool, view.args, INPUT_SUMMARISERS, delegationInput),
        output_summary: summarise(view.tool, view.output, OUTPUT_SUMMARISERS, (parsed, raw) => text(parsed ?? raw)),
        ts,
      });
    }
  }
  return out;
}

// --------------------------------------------------- locally recorded steps

const isEntry = (v: unknown): v is TraceEntry =>
  isObj(v) && typeof v.tool === "string" && typeof v.input_summary === "string" && typeof v.output_summary === "string";

/**
 * The entry that says this investigation had no memory available to it.
 *
 * Not an error and not a failure: the agent can work cold, and losing a whole
 * investigation to a memory hiccup would trade a small loss for a total one.
 * What it must not be is SILENT — the memory effect is a reported metric, so a
 * run that quietly fell back to cold would still be measured as warm, which is
 * a confident-looking record of something that did not happen.
 */
export function memoryUnavailableEntry(reason: string, at: Date): TraceEntry {
  return {
    n: 1,
    tool: MEMORY_UNAVAILABLE_STEP,
    input_summary: "top 3 lessons for this facility",
    output_summary: truncate(`memory search failed: ${reason} \u2014 this investigation ran with no past lessons`),
    ts: at.toISOString(),
  };
}

/** The locally recorded entries already stored on a casefile, in order. */
export function localEntries(trace: unknown): TraceEntry[] {
  const list = Array.isArray(trace) ? trace : [];
  return list.filter(isEntry).filter((e) => LOCAL_TRACE_TOOLS.includes(e.tool));
}

/**
 * Locally recorded entries first, then the run's steps, renumbered from 1.
 *
 * Still idempotent, which is what lets two syncs race harmlessly: the result is
 * a pure function of its two inputs, so both produce the same array rather than
 * a doubled one. Local entries come first because they are recorded before the
 * run starts.
 */
export function mergeTrace(local: TraceEntry[], mapped: TraceEntry[]): TraceEntry[] {
  return [...local, ...mapped].map((entry, index) => ({ ...entry, n: index + 1 }));
}

/**
 * Did this investigation run without memory?
 *
 * The question stage 10 asks of every casefile before counting it as a warm
 * run. Exported so the eval runner matches a constant rather than guessing at a
 * string.
 */
export function ranWithoutMemory(trace: unknown): boolean {
  const list = Array.isArray(trace) ? trace : [];
  return list.some((e) => isObj(e) && e.tool === MEMORY_UNAVAILABLE_STEP);
}
