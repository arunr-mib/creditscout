import Link from "next/link";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

function nextParam(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  return value && value.startsWith("/") && !value.startsWith("//") ? `?next=${encodeURIComponent(value)}` : "";
}

/**
 * The public landing page (the only page, with /login, reachable without the
 * demo credential).
 *
 * Owner direction: the workspace design system is deliberately NOT applied
 * here. A landing page is allowed atmosphere, display type and pill controls
 * that would all be wrong inside an analyst's tool. It stays on the app's navy
 * and teal rather than borrowing the reference's indigo, so clicking through
 * to the workspace is continuous rather than a jump cut.
 *
 * The preview under the hero is the headline's argument, not decoration: it is
 * Coastal Marine's actual seeded case — 1.12 against a 1.25 floor on the
 * approved terms, 1.30 once an amendment already on file is applied. That is
 * precisely "or did they?".
 *
 * Every nav item points at a section on this page, and both CTAs resolve:
 * "Explore the demo" enters through the real sign-in route (carrying ?next= so
 * a deep link survives), "See how it works" scrolls to the workflow.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const signInHref = `/login${nextParam(next)}`;

  // No `overflow-hidden` on <main>: it would make it a scroll container and the
  // sticky bar would stop sticking. The glow is inset-x-0 and fades to
  // transparent, so there is nothing to clip.
  return (
    <main className="relative min-h-screen bg-night">
      {/* ------------------------------------------------------------- bar */}
      {/* A defined band rather than a nav floating over the hero: its own
          translucent surface, a bottom edge, and the destinations grouped
          beside the logo. Sticky so the demo stays one click away at any
          scroll depth. */}
      <header className="sticky top-0 z-20 border-b border-night-border bg-night/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-content items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-8">
            <Logo className="h-12 w-auto" />
            {/* Hidden on narrow widths rather than wrapped: a two-line sticky
                bar eats the viewport. The sections are sequential below, so
                scrolling still reaches them. */}
            <nav aria-label="Landing" className="hidden items-center gap-6 md:flex">
              <a href="#how-it-works" className="text-body text-night-secondary transition-colors duration-fast hover:text-night-text">
                How it works
              </a>
              <a href="#oversight" className="text-body text-night-secondary transition-colors duration-fast hover:text-night-text">
                Evidence &amp; oversight
              </a>
            </nav>
          </div>
          {/* shrink-0: flex children may shrink below their content width, and
              without it the pill was squeezed narrower than its own label. */}
          <div className="flex shrink-0 items-center gap-4">
            <Link href={signInHref} className="whitespace-nowrap text-body text-night-secondary transition-colors duration-fast hover:text-night-text">
              Sign in
            </Link>
            <Link
              href={signInHref}
              className="whitespace-nowrap rounded-full bg-model-night px-6 py-2 text-body font-medium text-night transition-opacity duration-fast hover:opacity-90"
            >
              Explore the demo
            </Link>
          </div>
        </div>
      </header>

      {/* The atmosphere. Decorative only, so it is hidden from assistive tech
          and never intercepts a click. design.md bans shadows for ELEVATION;
          this is a background field, not a raised surface. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[1200px]"
        style={{
          background: [
            "radial-gradient(1100px 620px at 18% -8%, rgba(129,140,248,0.18), transparent 62%)",
            "radial-gradient(980px 680px at 88% -4%, rgba(99,102,241,0.20), transparent 60%)",
            "radial-gradient(1200px 700px at 55% 22%, rgba(30,41,59,0.55), transparent 72%)",
          ].join(","),
        }}
      />

      <div className="relative mx-auto max-w-content px-6">
        {/* ----------------------------------------------------------- hero */}
        {/* Arbitrary paddings on purpose: the spacing scale tops out at 64px
            (`pt-16`), which is not enough air for a hero. This page is the one
            place the system is waived. */}
        <section className="pt-[56px] pb-[24px] md:pt-[80px]">
          <p className="text-label uppercase tracking-[0.18em] text-model-night">Commercial credit intelligence</p>
          <h1 className="mt-6 max-w-[22ch] text-[40px] font-semibold leading-[1.05] tracking-tight text-night-text sm:text-display">
            A borrower just missed a loan covenant.{" "}
            {/* Its own line, always. The question is the whole pitch; letting it
                wrap up beside "covenant." buries it. */}
            <span className="mt-2 block text-model-night">Or did they?</span>
          </h1>
          {/* This replaced a description that said the same thing in different
              words — both named the analyst, the agreement and amendments, the
              independent calculation and the human decision. Two paragraphs
              making one point is weaker than one. */}
          <p className="mt-4 max-w-[66ch] text-[17px] leading-relaxed text-night-secondary">
            CreditScout is an AI assistant for commercial credit analysts. It reads the loan agreement, every
            amendment, and the borrower&rsquo;s financials. The agent performs independent calculations, identifies
            covenant breaches, and investigates DSCR exceptions.
          </p>
          <p className="mt-4 text-[22px] font-semibold leading-tight tracking-tight text-night-text">
            Our agent recommends. <span className="text-model-night">Your analyst decides.</span>
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={signInHref}
              className="rounded-full bg-model-night px-6 py-3 text-body font-medium text-night transition-opacity duration-fast hover:opacity-90"
            >
              Explore the demo
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-full border border-night-border-strong bg-night-raised/50 px-6 py-3 text-body text-night-text backdrop-blur transition-colors duration-fast hover:border-model-night"
            >
              <span aria-hidden="true" className="text-model-night">↓</span>
              See how it works
            </a>
          </div>
          <p className="mt-4 text-label text-night-muted">            Built around DSCR covenant monitoring. Demo uses synthetic documents and fictional borrowers.
          </p>
        </section>

        {/* -------------------------------------------------------- preview */}
        <CasefilePreview />


        {/* ------------------------------------------------------- workflow */}
        <section id="how-it-works" aria-labelledby="how-heading" className="mt-16 scroll-mt-[96px] border-t border-night-border pt-12">
          <h2 id="how-heading" className="max-w-prose text-section text-night-text">
            From approved terms to an informed decision.
          </h2>
          <p className="mt-3 max-w-prose text-body text-night-secondary">
            Trace the terms, verify the calculations, and investigate covenant exceptions.
          </p>
          {/* An editorial sequence, not three notification cards. The coloured
              left rules made every panel look like an alert, and implied a
              status difference between steps that does not exist — they are
              stages of one process, not three states. One accent throughout,
              with thin connectors standing in for the rules. */}
          <ol className="mt-8 grid gap-12 md:grid-cols-3 md:gap-6">
            <ProcessStep
              step="01"
              head="Establish the terms"
              body="Review covenant definitions against their source clauses. Approve versioned, effective-dated terms for future tests."
              icon="document"
            />
            <ProcessStep
              step="02"
              head="Test the covenants"
              body="Calculate results against approved terms and reconcile borrower-reported figures."
              icon="calculator"
            />
            <ProcessStep
              step="03"
              head="Investigate exceptions"
              body="Review cited findings and a recommendation for analyst decision."
              icon="investigation"
              last
            />
          </ol>
        </section>

        {/* ------------------------------------------------------ oversight */}
        <section id="oversight" aria-labelledby="oversight-heading" className="mt-16 scroll-mt-[96px] border-t border-night-border pt-12">
          <h2 id="oversight-heading" className="text-section text-night-text">A recommendation you can inspect.</h2>
          <dl className="mt-8 grid gap-6 md:grid-cols-2">
            <Point head="Open the source" body="Move from a finding to the exact clause and quoted passage behind it." />
            <Point head="Follow the calculation" body="Review the inputs and calculation supporting the tested ratio." />
            <Point
              head="See what remains unresolved"
              body="Identify missing documents, amendment gaps, and validation issues before recording your decision."
            />
            <Point
              head="Keep human judgment in control"
              body="Approve or override recommendations. Preserve the analyst’s reasoning with the casefile."
            />
          </dl>
        </section>

        {/* -------------------------------------------------------- closing */}
        <section aria-labelledby="closing-heading" className="mt-16 border-t border-night-border pt-12">
          <h2 id="closing-heading" className="text-section text-night-text">Put the exception in context.</h2>
          <p className="mt-3 max-w-prose text-body text-night-secondary">
            Explore a synthetic credit case: from the covenant test to the evidence behind the recommendation.
          </p>
          <Link
            href={signInHref}
            className="mt-6 inline-block rounded-full bg-model-night px-6 py-3 text-body font-medium text-night transition-opacity duration-fast hover:opacity-90"
          >
            Explore the demo
          </Link>
        </section>

        {/* --------------------------------------------------------- footer */}
        <footer className="mt-16 space-y-1 border-t border-night-border pb-16 pt-6">
          <Logo className="h-8 w-auto" />
          <p className="pt-1 text-label text-night-muted">Decision support for commercial credit analysts.</p>
          <p className="text-label text-night-muted">
            CreditScout supports covenant investigation. It does not make credit decisions.
          </p>
          <p className="pt-2 text-label text-night-muted">
            Synthetic data only. Every document is marked &ldquo;SYNTHETIC — FOR DEMONSTRATION&rdquo;. No real bank
            data.
          </p>
        </footer>
      </div>
    </main>
  );
}

/**
 * The headline's argument, in the product's own shapes.
 *
 * Coastal Marine's seeded case, told straight: the approved terms produce a
 * breach, an amendment already on file produces a pass, and a person decides
 * which governs. The figures are the ones the app computes for that borrower,
 * so this page and the demo behind it cannot contradict each other.
 *
 * A still, not a live read — it is the public page, so it must never touch the
 * database. It will drift if that case changes.
 */
function CasefilePreview() {
  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-night-border-strong bg-night-raised/80 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-night-border px-6 py-4">
        <div>
          <p className="text-label text-night-muted">Casefile review</p>
          <p className="text-card text-night-text">
            Coastal Marine <span className="font-normal text-night-secondary">· Q2 2026</span>
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-success bg-success-bg px-3 py-1 text-label text-success">
          <span aria-hidden="true">✓</span> Recommends resolve · awaiting your approval
        </span>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3">
        <Figure label="Computed on approved terms" value="1.12" note="below the 1.25 floor" tone="text-danger" />
        <Figure label="With the amendment on file" value="1.30" note="clears the floor" tone="text-success" />
        <Figure label="Borrower reported" value="1.30" note="evidence, not the trigger" tone="text-night-secondary" />
      </div>

      <div className="space-y-3 border-t border-night-border-strong px-6 py-4">
        <p className="max-w-prose text-body text-night-secondary">
          Amendment No. 2 permits a fuel-hedging add-back capped at $800,000. It is on file and effective for this
          period, but the approved terms do not yet reflect it. A person decides which governs.
        </p>
        <div className="flex flex-wrap gap-2">
          <Chip>CA §7.11(a)</Chip>
          <Chip>Amd 2 §3</Chip>
          <Chip>Fin Q2 2026 §1</Chip>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className="bg-night-raised px-6 py-4">
      <p className="text-label text-night-muted">{label}</p>
      <p className={`mt-1 text-title tabular-nums ${tone}`}>{value}</p>
      <p className="mt-1 text-label text-night-muted">{note}</p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-model-night/40 bg-model-night-bg px-2 py-px font-mono text-label text-model-night">
      {children}
    </span>
  );
}

/**
 * One stage of the process.
 *
 * Deliberately NOT a card. The previous version gave each step a coloured left
 * rule — slate, amber, teal — which made three stages of one workflow look like
 * three alerts of differing severity, and suggested a status distinction the
 * steps do not carry. Open columns, one accent, a thin connector.
 */
function ProcessStep({
  step,
  head,
  body,
  icon,
  last = false,
}: {
  step: string;
  head: string;
  body: string;
  icon: "document" | "calculator" | "investigation";
  last?: boolean;
}) {
  return (
    <li className="relative">
      <div className="flex items-center">
        <StepIcon kind={icon} />
        {/* Desktop only: the connector implies sequence, which stacking already
            does on a narrow screen. */}
        {!last && (
          <span aria-hidden="true" className="ml-4 hidden h-px flex-1 bg-night-border-strong md:block" />
        )}
      </div>
      <p className="mt-6 text-label text-model-night">{step}</p>
      <h3 className="mt-2 text-card text-night-text">{head}</h3>
      <p className="mt-2 max-w-[34ch] text-body text-night-secondary">{body}</p>
    </li>
  );
}

/** Line icons at a consistent weight, drawn rather than imported — no icon dependency. */
function StepIcon({ kind }: { kind: "document" | "calculator" | "investigation" }) {
  const common = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.5 };
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0" role="img" aria-hidden="true">
      {kind === "document" && (
        <g {...common}>
          <path d="M12 6h16l8 8v28H12z" stroke="#E8EDF0" />
          <path d="M28 6v8h8" stroke="#E8EDF0" />
          <path d="M18 22h12M18 28h12M18 34h7" stroke="#5EC2BA" />
        </g>
      )}
      {kind === "calculator" && (
        <g {...common}>
          <rect x="12" y="6" width="24" height="36" rx="3" stroke="#E8EDF0" />
          <rect x="17" y="12" width="14" height="6" rx="1" stroke="#5EC2BA" />
          <path d="M18 25h3M23.5 25h3M29 25h3M18 31h3M23.5 31h3" stroke="#5EC2BA" />
          <path d="M29 31v5" stroke="#5EC2BA" />
        </g>
      )}
      {kind === "investigation" && (
        <g {...common}>
          <path d="M12 6h16l8 8v28H12z" stroke="#E8EDF0" />
          <path d="M28 6v8h8" stroke="#E8EDF0" />
          <path d="M18 20h10M18 26h7" stroke="#E8EDF0" />
          <circle cx="28" cy="32" r="6" stroke="#5EC2BA" />
          <path d="M32.5 36.5 37 41" stroke="#5EC2BA" />
        </g>
      )}
    </svg>
  );
}

/** One oversight capability. A definition list: the claim, then what it means. */
function Point({ head, body }: { head: string; body: string }) {
  return (
    <div className="border-l-2 border-night-border-strong pl-4">
      <dt className="text-card text-night-text">{head}</dt>
      <dd className="mt-2 max-w-prose text-body text-night-secondary">{body}</dd>
    </div>
  );
}
