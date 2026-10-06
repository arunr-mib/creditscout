import { extractText as unpdfExtractText, getDocumentProxy } from "unpdf";

/**
 * Fewer non-whitespace characters than this, from a PDF that parsed cleanly,
 * means it is a scan: pages are images with no text layer. A real document of
 * even one short page carries several times this. OCR is out of scope (spec §2).
 */
export const MIN_TEXT_CHARS = 50;

/**
 * A rejection the uploader can act on, with the HTTP status the route should
 * answer with. Anything that is not a DocumentError is our fault and a 5xx.
 */
export class DocumentError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "DocumentError";
    this.status = status;
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

const isPdf = (b: Uint8Array) => PDF_MAGIC.every((byte, i) => b[i] === byte);

/**
 * Text of a document. PDF bytes are parsed; anything else is treated as UTF-8
 * text and passed through unchanged (the CLI ingests `.txt`, and it keeps the
 * demo workable if a PDF misbehaves). `filename` is only used in error messages.
 */
export async function extractText(
  buffer: Buffer | Uint8Array,
  filename = "document",
): Promise<string> {
  // Copy into a plain Uint8Array: pdf.js detaches the buffer it is given, and
  // a Node Buffer may be a view into a shared pool.
  const bytes = Uint8Array.from(buffer);

  if (!isPdf(bytes)) {
    if (bytes.includes(0)) {
      throw new DocumentError(`${filename} is neither a PDF nor a text file.`);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    ({ text } = await unpdfExtractText(pdf, { mergePages: true }));
  } catch (err) {
    throw new DocumentError(
      `${filename} could not be read as a PDF (${err instanceof Error ? err.message : "unknown error"}).`,
    );
  }

  if (text.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
    throw new DocumentError(
      `${filename} has no extractable text. It looks like a scanned or image-only PDF; CreditScout does not OCR. Upload a text-based PDF.`,
    );
  }
  return text;
}
