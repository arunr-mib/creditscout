import { MAX_K, searchDocuments } from "../retrieval.ts";

/**
 * Reads the calculator's inputs from a facility's financials document, and
 * returns the citation for each.
 *
 * The documents are ones we generate, so this is string work, not judgement.
 * A figure that cannot be read AND cited is missing evidence, however legible
 * it looks: stage 8's guardrail verifies every number against a logged
 * calculation or a cited quote, and a number with no citation has nothing to be
 * verified against. So nothing here guesses:
 *
 *   - a label that is absent                    -> reported as a problem
 *   - a label that appears twice with two values -> reported as a problem
 *   - a value that is not a plain number          -> reported as a problem
 *
 * A problem leaves the figure OUT of the result. It is never zero, and the
 * caller (run.ts) turns an absent figure into `calc_error`, not a breach.
 */

/** The five labeled lines in the financials' "Debt Service Coverage Inputs" section. */
export const INPUT_LABELS = {
  ebitda: "Consolidated EBITDA",
  unfinanced_capex: "Unfinanced Capital Expenditures",
  cash_taxes: "Cash Taxes Paid",
  scheduled_principal: "Scheduled Principal Payments",
  cash_interest: "Cash Interest Paid",
} as const;

export type InputName = keyof typeof INPUT_LABELS;

/** A figure and where it came from: `citation` in the existing vocabulary ("Fin Q2 2026 §1"), `quote` the verbatim line. */
export interface Figure {
  value: number;
  citation: string;
  quote: string;
}

/** Something that could not be read. `field` is an input name, or an add-back's normalised label. */
export interface Problem {
  field: string;
  reason: string;
}

export interface LabeledFigures {
  /** The title of the document read, e.g. "Financials — Q2 2026". */
  documentTitle: string;
  inputs: Partial<Record<InputName, Figure>>;
  /** Every labeled add-back item in the document, keyed by `normaliseLabel`. The TERMS decide which of them count. */
  addbacks: Record<string, Figure>;
  problems: Problem[];
}

export interface ReaderDeps {
  search?: typeof searchDocuments;
}

// ------------------------------------------------------------------ periods

/** "2026-06-30" -> "Q2 2026". Fiscal year is the calendar year. */
export function quarterLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  return `Q${Math.ceil(m / 3)} ${y}`;
}

const QUARTER_ENDS = new Set(["03-31", "06-30", "09-30", "12-31"]);

/**
 * Documents are filed by quarter, so a date that is not a quarter end would
 * silently pick up the neighbouring quarter's financials.
 */
export function isQuarterEnd(periodEnd: string): boolean {
  return QUARTER_ENDS.has(periodEnd.slice(5));
}

export const financialsTitle = (periodEnd: string): string => `Financials — ${quarterLabel(periodEnd)}`;

// ------------------------------------------------------------------ parsing

/** Case and spacing never distinguish two labels. */
export function normaliseLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "4,020,000" and "-120,000" and "1250.50"; nothing else. "(120,000)", "$4M" and "n/a" are not guessed at. */
const AMOUNT = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

export function parseAmount(raw: string): number | null {
  if (!AMOUNT.test(raw)) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

interface Line {
  label: string;
  raw: string;
  quote: string;
  citation: string;
  /** True when the line sits under an "Add-Back Items" heading. */
  addback: boolean;
}

const LABELED_LINE = /^([^:]+):\s*(\S.*)$/;
const ADDBACK_HEADING = /add-?back/i;

/**
 * Every `Label: value` line in the chunks of the one document asked for. A line
 * is identified by its citation and text, so the same document ingested twice
 * does not make every figure ambiguous, while two different values still do.
 */
export function labeledLines(hits: readonly { content: string; citation: string }[]): Line[] {
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const hit of hits) {
    const lines = hit.content.split("\n").map((l) => l.trim());
    const addback = ADDBACK_HEADING.test(lines[0] ?? "");
    for (const quote of lines.slice(1)) {
      const m = LABELED_LINE.exec(quote);
      if (!m) continue;
      const key = `${hit.citation}\n${quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: m[1], raw: m[2].trim(), quote, citation: hit.citation, addback });
    }
  }
  return out;
}

/** Exactly one distinct readable value, or a reason there is not. */
function single(candidates: readonly Line[], field: string, where: string): { figure?: Figure; problem?: Problem } {
  if (candidates.length === 0) return { problem: { field, reason: `not found in ${where}` } };
  if (candidates.length > 1) return { problem: { field, reason: `appears ${candidates.length} times in ${where}, so the figure is ambiguous` } };
  const [line] = candidates;
  const value = parseAmount(line.raw);
  if (value === null) return { problem: { field, reason: `"${line.raw}" is not a plain number (${line.citation})` } };
  return { figure: { value, citation: line.citation, quote: line.quote } };
}

// ------------------------------------------------------------------ reading

const QUERY =
  "Consolidated EBITDA, unfinanced capital expenditures, cash taxes paid, scheduled principal payments, cash interest paid, add-back items";

/**
 * The five inputs, and every labeled add-back item, from the facility's
 * financials document for the period.
 *
 * The facility filter lives inside `searchDocuments`; the period is picked here
 * by exact document title. The search asks for the maximum `k`, because a
 * facility holds a handful of financials chunks and what is wanted is all of one
 * document's, not the nearest few. If a very long history ever pushed a chunk
 * out of the window, the figure would read as not found, which fails safe.
 */
export async function readLabeledFigures(
  facilityId: string,
  periodEnd: string,
  deps: ReaderDeps = {},
): Promise<LabeledFigures> {
  const documentTitle = financialsTitle(periodEnd);
  const search = deps.search ?? searchDocuments;
  const hits = (await search({ facilityId, query: QUERY, docTypes: ["financials"], k: MAX_K })).filter(
    (h) => h.doc_title === documentTitle,
  );

  const result: LabeledFigures = { documentTitle, inputs: {}, addbacks: {}, problems: [] };

  if (hits.length === 0) {
    const reason = `no "${documentTitle}" document on file`;
    for (const name of Object.keys(INPUT_LABELS)) result.problems.push({ field: name, reason });
    return result;
  }

  const lines = labeledLines(hits);

  for (const [name, label] of Object.entries(INPUT_LABELS) as [InputName, string][]) {
    const wanted = normaliseLabel(label);
    const { figure, problem } = single(
      lines.filter((l) => !l.addback && normaliseLabel(l.label) === wanted),
      name,
      documentTitle,
    );
    if (figure) result.inputs[name] = figure;
    if (problem) result.problems.push(problem);
  }

  const inputLabels = new Set(Object.values(INPUT_LABELS).map(normaliseLabel));
  const byLabel = new Map<string, Line[]>();
  for (const l of lines) {
    if (!l.addback || inputLabels.has(normaliseLabel(l.label))) continue;
    const key = normaliseLabel(l.label);
    byLabel.set(key, [...(byLabel.get(key) ?? []), l]);
  }
  for (const [key, candidates] of byLabel) {
    const { figure, problem } = single(candidates, key, documentTitle);
    if (figure) result.addbacks[key] = figure;
    if (problem) result.problems.push(problem);
  }

  return result;
}
