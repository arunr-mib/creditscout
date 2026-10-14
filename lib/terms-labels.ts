/**
 * The words the product uses for covenant-term state, in one place.
 *
 * "Boarded" is our word, not an analyst's, and it was appearing in two screens
 * with two different phrasings. These strings are shared by the documents
 * library and the covenant-terms screen so the two cannot drift apart.
 */

export const TERMS_PENDING = "Terms update pending";
export const TERMS_INCLUDED = "Included in approved terms";
export const NOT_BOARDED_TOOLTIP = "This amendment is on file but is not reflected in approved covenant terms.";

/** `covenant_terms.status` as an analyst reads it. */
export const TERMS_STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  proposed: "Pending approval",
  superseded: "Superseded",
};

/**
 * "Apr 1, 2026" for prose and for a column people read rather than sort.
 *
 * Parsed as UTC on purpose: `new Date("2026-04-01")` is already UTC midnight,
 * so formatting it in a western timezone renders the day before — an
 * effective date that is wrong by a day is a real error on a credit screen.
 * A value that will not parse is returned untouched rather than guessed at.
 */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ------------------------------------------- the terms themselves, readable

/**
 * The covenant as an analyst reads it, from the stored `terms` JSON.
 *
 * The Covenant terms screen showed version numbers, statuses and effective
 * dates — everything ABOUT a version and nothing IN it. An analyst could not
 * see the minimum, the permitted add-backs or their caps without opening
 * another screen, on a page titled "Covenant terms".
 *
 * Pure and defensive: the JSON is whatever was approved, possibly from an older
 * shape, so every field is read optionally and a missing one is omitted rather
 * than rendered as "undefined".
 */
export interface TermLine {
  label: string;
  value: string;
  /** The clause it came from, when the stored terms carry one. */
  citation: string | null;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 500000 -> "$500,000". Caps are money; the ratio is not. */
export const money = (n: number): string => `$${n.toLocaleString("en-US")}`;

/** A list of snake_case component names as prose. */
const names = (v: unknown): string | null => {
  if (!Array.isArray(v) || v.length === 0) return null;
  const parts = v.filter((x): x is string => typeof x === "string").map((x) => x.replace(/_/g, " "));
  return parts.length > 0 ? parts.join(", ") : null;
};

export function summariseTerms(terms: unknown): TermLine[] {
  const t = obj(terms);
  if (!t) return [];
  const out: TermLine[] = [];

  const threshold = obj(t.threshold);
  const min = num(threshold?.min_dscr);
  if (min != null) out.push({ label: "Minimum DSCR", value: `${min.toFixed(2)}x`, citation: str(threshold?.citation) });

  const period = obj(t.test_period);
  const basis = str(period?.basis);
  if (basis) out.push({ label: "Measurement basis", value: basis, citation: null });

  const numerator = obj(t.numerator);
  const base = str(numerator?.base);
  if (base) out.push({ label: "Numerator base", value: base, citation: null });

  // An add-back with no cap is UNCAPPED. Reading a missing cap as zero is the
  // documented trap that flips a correct resolve into a false escalation, so
  // the screen says "uncapped" rather than leaving it blank.
  const addbacks = Array.isArray(numerator?.addbacks) ? numerator.addbacks : [];
  for (const a of addbacks) {
    const row = obj(a);
    const name = str(row?.name);
    if (!name) continue;
    const cap = num(row?.cap);
    out.push({
      label: "Permitted add-back",
      value: cap == null ? `${name} — uncapped` : `${name} — capped at ${money(cap)}`,
      citation: str(row?.citation),
    });
  }
  if (addbacks.length === 0) out.push({ label: "Permitted add-backs", value: "None", citation: null });

  const deductions = names(numerator?.deductions);
  if (deductions) out.push({ label: "Deductions", value: deductions, citation: null });

  const denominator = obj(t.denominator);
  const components = names(denominator?.components);
  if (components) out.push({ label: "Debt service", value: components, citation: str(denominator?.citation) });

  const amendments = Array.isArray(t.effective_amendments) ? t.effective_amendments : [];
  if (amendments.length > 0) {
    const titles = amendments
      .map((a) => str(obj(a)?.doc))
      .filter((x): x is string => x !== null);
    if (titles.length > 0) out.push({ label: "Amendments applied", value: titles.join(", "), citation: null });
  }

  return out;
}

// ------------------------------------------- what a document's date MEANS

/**
 * The label for a document's date, which differs by document.
 *
 * Every row said "Effective date". For an agreement or an amendment that is
 * right — it is the date the terms take force. For a financial statement the
 * same column holds the END OF THE PERIOD REPORTED, and for a compliance
 * certificate the period being certified. Calling those "effective" is simply
 * the wrong word for the fact, and on a screen whose job is helping an analyst
 * find the right evidence, the wrong word costs a click or a mistake.
 */
export const DATE_LABEL: Record<string, string> = {
  agreement: "Effective date",
  amendment: "Effective date",
  waiver: "Dated",
  financials: "Period ended",
  compliance_certificate: "Reporting period",
};

export const dateLabel = (docType: string | null | undefined): string =>
  DATE_LABEL[docType ?? ""] ?? "Date";

/** The column heading when one table mixes document types. */
export const MIXED_DATE_HEADING = "Relevant date";

// ------------------------------------------------- what counts as "pending"

/**
 * Whether a loan has a covenant update waiting on someone.
 *
 * ONE DEFINITION, used by the count and by the row. The chip counted only
 * unboarded amendments while the row ALSO showed "v3 awaiting approval" for a
 * proposed version, so the header said 2 while three rows said otherwise. A
 * count that disagrees with the list under it teaches an analyst to distrust
 * both.
 *
 * Two different things, both genuinely pending: a version proposed and not yet
 * approved, and an amendment on file that the approved version does not carry.
 */
export function hasPendingUpdate(card: {
  unboarded: readonly string[];
  versions: readonly { status: string }[];
}): boolean {
  return card.unboarded.length > 0 || card.versions.some((v) => v.status === "proposed");
}

export const countPendingUpdates = (
  cards: readonly { unboarded: readonly string[]; versions: readonly { status: string }[] }[],
): number => cards.filter(hasPendingUpdate).length;
