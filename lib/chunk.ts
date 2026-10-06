/**
 * Section chunking. Pure and synchronous: no I/O, no network.
 *
 * One chunk per legal section, because the guardrail later verifies every quote
 * against the chunk its citation points at. A chunk whose `section` is wrong is
 * an unverifiable quote, and that surfaces as a forced abstain far from here.
 *
 * Headings recognised are the forms the generated corpus uses (see
 * data/facilities/*): `§7.11 Title`, `§3 Title`, `Section 7.11 Title`,
 * `ARTICLE VII — TITLE`. Matching is anchored to the start of a line and
 * requires a short line, so a sentence that merely mentions "Section 7.11" is
 * never mistaken for a heading.
 */

export interface ChunkMeta {
  facility_id: string;
  document_id: string;
  doc_type: string;
  doc_title: string;
}

/**
 * Keys `match_doc_chunks` reads from `metadata` are facility_id, doc_title,
 * section and doc_type (supabase/migrations/0005). Rename none of them.
 */
export interface ChunkMetadata extends ChunkMeta {
  /** Section id alone (`§7.11`, `ARTICLE VII`), or null when the document has no headings. */
  section: string | null;
  /** The full heading line as written, or null when the document has no headings. */
  heading: string | null;
  /** Present only on a degraded chunk: the whole document, because no headings were found. */
  degraded?: "no_section_headings";
}

export interface Chunk {
  content: string;
  metadata: ChunkMetadata;
}

/** A heading line is short. Anything longer is a sentence that happens to start with "Section". */
const MAX_HEADING_LENGTH = 120;

/** Text before the first heading: marker, title, parties. The marker must survive. */
export const PREAMBLE_SECTION = "PREAMBLE";

const SECTION_NUMBER = /(?:§\s*|Section\s+)(\d+(?:\.\d+)*)/;
const ARTICLE_NUMBER = /\b(?:ARTICLE|Article)\s+([IVXLCDM]+)\b/;

/**
 * Reduce any citation or heading to its section id.
 *
 *   normaliseSection("CA §7.11(b)(i)")     === "§7.11"
 *   normaliseSection("Section 7.11")        === "§7.11"
 *   normaliseSection("Amd 2 §3(a)")         === "§3"
 *   normaliseSection("ARTICLE VII — X")     === "ARTICLE VII"
 *
 * Returns null when nothing section-like is found. The stage-5 lookup applies
 * this to the citation side so both sides of the comparison use one function.
 */
export function normaliseSection(input: string): string | null {
  const sec = SECTION_NUMBER.exec(input);
  if (sec) return `§${sec[1]}`;
  const art = ARTICLE_NUMBER.exec(input);
  if (art) return `ARTICLE ${art[1]}`;
  return null;
}

// A heading starts the line. For `§`, the number must be followed by a
// separator and an optional capitalised title (so "§7.11(b) of the Agreement"
// is rejected). The `Section` word form must have a capitalised title: PDF
// text arrives word-wrapped, and a wrapped line that begins "Section 7.11." or
// "Section 7.11 and the amount..." is the tail of a sentence, not a heading.
const HEADING_LINE =
  /^(?:§\s*\d+(?:\.\d+)*(?:\.?\s+(?=[A-Z])|\.?$)|Section\s+\d+(?:\.\d+)*\.?\s+(?=[A-Z])|ARTICLE\s+[IVXLCDM]+(?:\s|$))/;

function headingSection(line: string): string | null {
  if (line.length > MAX_HEADING_LENGTH || !HEADING_LINE.test(line)) return null;
  return normaliseSection(line);
}

const trimBlankEdges = (lines: string[]): string => lines.join("\n").replace(/^\s*\n|\s+$/g, "");

export function chunkBySection(text: string, meta: ChunkMeta): Chunk[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  type Span = { section: string | null; heading: string | null; lines: string[] };
  const spans: Span[] = [{ section: PREAMBLE_SECTION, heading: null, lines: [] }];
  let headings = 0;

  for (const line of lines) {
    const section = headingSection(line.trim());
    if (section) {
      headings += 1;
      spans.push({ section, heading: line.trim(), lines: [line] });
    } else {
      spans[spans.length - 1].lines.push(line);
    }
  }

  const whole = trimBlankEdges(lines);
  if (headings === 0) {
    if (!whole) return [];
    return [
      {
        content: whole,
        metadata: { ...meta, section: null, heading: null, degraded: "no_section_headings" },
      },
    ];
  }

  return spans
    .map((s) => ({ ...s, content: trimBlankEdges(s.lines) }))
    .filter((s) => s.content !== "")
    .map((s) => ({
      content: s.content,
      metadata: {
        ...meta,
        section: s.section,
        // The preamble has no heading line of its own; its first line after the marker is the title.
        heading: s.heading ?? firstTitleLine(s.content),
      },
    }));
}

function firstTitleLine(preamble: string): string | null {
  return preamble.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("SYNTHETIC")) ?? null;
}
