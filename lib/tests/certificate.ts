import { MAX_K, searchDocuments } from "../retrieval.ts";
import { labeledLines, normaliseLabel, quarterLabel, type Figure, type ReaderDeps } from "./extract-financials.ts";

/**
 * The borrower's own reported ratio, from their compliance certificate.
 *
 * It is EVIDENCE. Nothing here, and nothing that receives this figure, may let
 * it decide whether a test passed: our number decides, theirs is reconciled
 * against it. Absent, ambiguous or unreadable all return null, and a test with
 * no reported figure still runs.
 */

const QUERY = "Reported Debt Service Coverage Ratio, financial covenant, compliance status";
const LABEL = "reported debt service coverage ratio";

/** "1.30 to 1.00", with or without a trailing full stop. */
const RATIO = /^(\d+(?:\.\d+)?)\s+to\s+1(?:\.0+)?\.?$/;

export const certificateTitle = (periodEnd: string): string => `Compliance Certificate — ${quarterLabel(periodEnd)}`;

export async function readReportedDscr(
  facilityId: string,
  periodEnd: string,
  deps: ReaderDeps = {},
): Promise<Figure | null> {
  const title = certificateTitle(periodEnd);
  const search = deps.search ?? searchDocuments;
  const hits = (await search({ facilityId, query: QUERY, docTypes: ["compliance_certificate"], k: MAX_K })).filter(
    (h) => h.doc_title === title,
  );

  const candidates = labeledLines(hits).filter((l) => normaliseLabel(l.label) === LABEL);
  if (candidates.length !== 1) return null;

  const [line] = candidates;
  const m = RATIO.exec(line.raw);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return { value, citation: line.citation, quote: line.quote };
}
