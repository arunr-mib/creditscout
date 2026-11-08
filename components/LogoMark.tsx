/**
 * The CreditScout icon alone: the same reticle-over-evidence-points geometry
 * as `Logo.tsx`, without its baked-in "CreditScout" text — the forest header
 * already prints the wordmark in `font-brand`, so repeating it inside the SVG
 * would duplicate it in the wrong typeface. Sits to the left of that text.
 *
 * RECOLOURED for the forest band (`bg-brand`, `#0F2B22`), not for the dark
 * shell `Logo.tsx` was built for — teal is retired from the workspace. The
 * structure (brackets) is quiet; the one accent colour left is mint:
 *
 *   brackets (structure)        -> brand-on-2  #CFE3D6
 *   bar + outer evidence points -> mint        #9BE7A9
 *   centre point + stem         -> mint-hover  #86DC97 (the one that matters)
 *
 * `Logo.tsx` itself is untouched and keeps its original dark-surface teal
 * mapping — it still runs on /welcome and /login, which are out of scope.
 *
 * Size it with a height class and let the width follow — `h-6 w-6` (the
 * spacing scale is replaced to a short fixed list; `h-7`/`w-7` do not exist
 * and fail silently, which is exactly how this rendered oversized the first
 * time round).
 */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 112 112" className={className} role="img" aria-hidden="true">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M39 20h-9a10 10 0 0 0-10 10v9M73 20h9a10 10 0 0 1 10 10v9M92 73v9a10 10 0 0 1-10 10h-9M20 73v9a10 10 0 0 0 10 10h9"
          stroke="#CFE3D6"
          strokeWidth="6.5"
        />
        <path d="M37 56h38" stroke="#9BE7A9" strokeWidth="4.5" />
        <circle cx="39" cy="56" r="4.5" fill="#9BE7A9" stroke="none" />
        <circle cx="56" cy="56" r="6" fill="#86DC97" stroke="none" />
        <circle cx="74" cy="56" r="4.5" fill="#9BE7A9" stroke="none" />
        <path d="M56 44v-7" stroke="#86DC97" strokeWidth="3.5" />
      </g>
    </svg>
  );
}
