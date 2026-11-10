/**
 * Shared status glyphs for the Exceptions queue: the filter-pill bar and the
 * portfolio rail's collapsed strip both draw from these, so a status reads as
 * the same shape wherever it appears.
 *
 * Colour comes from the caller, never from here. Each glyph strokes with
 * `currentColor`, so wrap it in a `text-*` class (`text-danger`, `text-ok`,
 * …) to tint it. Size it with `className` (`h-4 w-4` by default, matching
 * `LogoMark`).
 *
 * Refined 2026-11-10 (owner's call: the first pass read as a generic
 * default icon set). Every glyph now sits in the same family — a circle,
 * a rounded triangle or a rounded rectangle, never a bare unbounded
 * stroke — at a lighter `strokeWidth` (1.75, was 2.2) for a less heavy,
 * more current look. `BreachIcon`'s triangle now has rounded corners
 * instead of three sharp miters, matching the rounded-rect container the
 * other three glyphs already sit in.
 *
 * Always decorative: `aria-hidden` is set, so the call site must pair each
 * glyph with visible text or a tooltip. It is never the only label.
 */

export function BreachIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.6 4.3a1.6 1.6 0 0 1 2.8 0l8 14A1.6 1.6 0 0 1 20 21H4a1.6 1.6 0 0 1-1.4-2.7z" />
      <path d="M12 9.5v4M12 16.8h.01" />
    </svg>
  );
}

export function DecidedIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3v18" />
      <path d="M5 4.5h10.5a1 1 0 0 1 .8 1.6l-1.9 2.4 1.9 2.4a1 1 0 0 1-.8 1.6H5" />
    </svg>
  );
}

export function ComplianceIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8.3 12.3l2.5 2.5 5-5.2" />
    </svg>
  );
}

export function TermsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8.5z" />
      <path d="M14 3v4.5a1 1 0 0 0 1 1H19" />
      <path d="M9 13.2h6M9 16.8h4" />
    </svg>
  );
}

export function AllLoansIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  );
}

export function NeedsReviewIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.8v5M12 16.2h.01" />
    </svg>
  );
}
