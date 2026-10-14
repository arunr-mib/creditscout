/**
 * The CreditScout wordmark: a precision reticle over three evidence points,
 * then the name.
 *
 * Inlined rather than served from /public so it can carry the design tokens and
 * the app's font, and so it costs no extra request on the first paint of the
 * landing page.
 *
 * RECOLOURED for dark surfaces. The supplied artwork sets "Credit" and the
 * reticle in #163E3C — a near-black teal built for a light page, which on our
 * #0A1628 background sits at roughly 1.4:1 and disappears. The structure is
 * unchanged; only the palette is mapped onto our tokens:
 *
 *   "Credit"            #163E3C -> text        #F8FAFC
 *   "Scout"             #208C7B -> model-bright #5EC2BA   (teal = a model did this)
 *   reticle brackets    #163E3C -> night-border-strong #3E4F56 (structure, not subject)
 *   bar + outer points  #8BB7AF -> model        #2E9D94
 *   centre + stem       #208C7B -> model-bright #5EC2BA
 *
 * The original's hierarchy survives: the outer evidence points stay quieter
 * than the one in the middle.
 *
 * Still mapped for DARK surfaces after the 2026-10-13 light flip: the only
 * places it appears are the nav rail and the marketing pages, both of which
 * stayed dark. If it is ever placed on a light surface it needs the inverse.
 *
 * Size it with a height class and let the width follow — `h-8 w-auto`.
 */
export function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 540 112" className={className} role="img" aria-label="CreditScout">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M39 20h-9a10 10 0 0 0-10 10v9M73 20h9a10 10 0 0 1 10 10v9M92 73v9a10 10 0 0 1-10 10h-9M20 73v9a10 10 0 0 0 10 10h9"
          stroke="#334155"
          strokeWidth="6.5"
        />
        <path d="M37 56h38" stroke="#2E9D94" strokeWidth="4.5" />
        <circle cx="39" cy="56" r="4.5" fill="#2E9D94" stroke="none" />
        <circle cx="56" cy="56" r="6" fill="#5EC2BA" stroke="none" />
        <circle cx="74" cy="56" r="4.5" fill="#2E9D94" stroke="none" />
        <path d="M56 44v-7" stroke="#5EC2BA" strokeWidth="3.5" />
      </g>
      <text
        x="128"
        y="72"
        fontFamily="var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif"
        fontSize="47"
        letterSpacing="-1.8"
      >
        <tspan fill="#F8FAFC" fontWeight="500">
          Credit
        </tspan>
        <tspan fill="#5EC2BA" fontWeight="650">
          Scout
        </tspan>
      </text>
    </svg>
  );
}
