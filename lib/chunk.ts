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

/** A citation resolved to the document it names and the section within it. Any part may be null. */
export interface ResolvedCitation {
  doc_type: string | null;
  doc_title: string | null;
  section: string | null;
}

// A section id is only unique within one document: in F1, `§1` exists in four.
// A caller must therefore match on the (document, section) pair, never on the
// section alone. The prefix vocabulary is what data/facilities.js cites with:
// "CA" is the Credit Agreement, "Amd N" is Amendment No. N. Titles match the
// `documents.title` values the seed writes, which are the `doc_title` metadata.
const DOCUMENT_PREFIXES: { pattern: RegExp; resolve: (m: RegExpExecArray) => { doc_type: string; doc_title: string } }[] = [
  {
    pattern: /^(?:CA\b|Credit Agreement\b)\s*/,
    resolve: () => ({ doc_type: "agreement", doc_title: "Credit Agreement" }),
  },
  {
    pattern: /^(?:Amd\.?|Amendment)\s*(?:No\.?\s*)?(\d+)\s*/,
    resolve: (m) => ({ doc_type: "amendment", doc_title: `Amendment No. ${m[1]}` }),
  },
];

const SECTION_AT_START = /^(?:§\s*|Section\s+)(\d+(?:\.\d+)*)/;
const ARTICLE_AT_START = /^(?:ARTICLE|Article)\s+([IVXLCDM]+)\b/;

/**
 * Resolve a citation to the document it names and its section id.
 *
 *   resolveCitation("CA §7.11(b)(i)") -> { agreement, "Credit Agreement", "§7.11" }
 *   resolveCitation("Amd 2 §3(a)")    -> { amendment, "Amendment No. 2", "§3" }
 *   resolveCitation("§7.11")          -> { null, null, "§7.11" }  (document unnamed)
 *
 * The section reference must open the string, after an optional document
 * prefix. A section mentioned mid-sentence is not a citation, so it does not
 * count ("see §7.11" resolves to nothing). An unknown prefix resolves to
 * nothing too, rather than a section with no document.
 */
export function resolveCitation(input: string): ResolvedCitation {
  let rest = input.trim();
  let doc: { doc_type: string; doc_title: string } | null = null;
  for (const { pattern, resolve } of DOCUMENT_PREFIXES) {
    const m = pattern.exec(rest);
    if (m) {
      doc = resolve(m);
      rest = rest.slice(m[0].length);
      break;
    }
  }
  const sec = SECTION_AT_START.exec(rest);
  const art = sec ? null : ARTICLE_AT_START.exec(rest);
  const section = sec ? `§${sec[1]}` : art ? `ARTICLE ${art[1]}` : null;
  return section
    ? { doc_type: doc?.doc_type ?? null, doc_title: doc?.doc_title ?? null, section }
    : { doc_type: null, doc_title: null, section: null };
}

/**
 * The section half of a citation or heading, or null.
 *
 *   normaliseSection("CA §7.11(b)(i)")     === "§7.11"
 *   normaliseSection("ARTICLE VII — X")     === "ARTICLE VII"
 *
 * The id alone does not identify a chunk; use `resolveCitation` to get the
 * document as well.
 */
export function normaliseSection(input: string): string | null {
  return resolveCitation(input).section;
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
