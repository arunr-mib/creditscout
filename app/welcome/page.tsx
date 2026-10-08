import Link from "next/link";

export const dynamic = "force-dynamic";

function nextParam(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  return value && value.startsWith("/") && !value.startsWith("//") ? `?next=${encodeURIComponent(value)}` : "";
}

/**
 * The public landing page (the only page, with /login, reachable without the
 * demo credential).
 *
 * Copy is the review's (§8). Its warm-light surface is NOT: the app behind this
 * page is dark, there is no light token set to build on, and a light landing
 * cutting to a dark workspace is a jarring transition. Staying on the existing
 * dark tokens keeps the two continuous.
 *
 * No casefile preview graphic. The review asks for one and also forbids
 * "floating dashboard collages" — a mocked-up preview is the thing it warns
 * against, and a real one belongs in the product, a click away.
 *
 * Every nav item points at a section that exists on this page, and both CTAs
 * resolve: "Explore the demo" enters through the real sign-in route (carrying
 * ?next= so a deep link survives), "See how it works" scrolls to the workflow.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const signInHref = `/login${nextParam(next)}`;

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-content px-6 py-8 md:py-12">
        {/* ------------------------------------------------------------ nav */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <span className="text-card text-text">CreditScout</span>
          <nav aria-label="Landing" className="flex flex-wrap items-center gap-6">
            <a href="#how-it-works" className="text-body text-text-secondary transition-colors duration-fast hover:text-text">
              How it works
            </a>
            <a href="#oversight" className="text-body text-text-secondary transition-colors duration-fast hover:text-text">
              Evidence &amp; oversight
            </a>
            <Link
              href={signInHref}
              className="rounded-md border border-border-strong px-3 py-2 text-body text-text transition-colors duration-fast hover:border-model"
            >
              Sign in
            </Link>
          </nav>
        </header>

        {/* ----------------------------------------------------------- hero */}
        <section className="mt-12 md:mt-16">
          <p className="text-label uppercase tracking-wide text-model-bright">Commercial credit intelligence</p>
          <h1 className="mt-3 max-w-prose text-title text-text">
            Investigate covenant exceptions.
            <br />
            See the evidence behind every recommendation.
          </h1>
          <p className="mt-4 max-w-prose text-body text-text-secondary">
            CreditScout helps commercial credit analysts investigate DSCR exceptions across loan agreements,
            amendments, and borrower reporting — with independent calculations, cited findings, and a recommendation
            for human review.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={signInHref}
              className="rounded-md bg-model px-4 py-2 text-body font-medium text-bg transition-opacity duration-fast hover:opacity-90"
            >
              Explore the demo
            </Link>
            <a
              href="#how-it-works"
              className="rounded-md border border-border-strong px-4 py-2 text-body text-text transition-colors duration-fast hover:border-model"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-label text-text-muted">
            Built around DSCR covenant monitoring. Demo uses synthetic documents and fictional borrowers.
          </p>
        </section>

        {/* ------------------------------------------------------- workflow */}
        <section id="how-it-works" aria-labelledby="how-heading" className="mt-16 scroll-mt-8 border-t border-border pt-12">
          <h2 id="how-heading" className="max-w-prose text-section text-text">
            The borrower&rsquo;s ratio is the starting point. Verification is the work.
          </h2>
          <p className="mt-3 max-w-prose text-body text-text-secondary">
            A covenant exception rarely lives in one document. CreditScout brings the terms, calculations, and
            supporting evidence together so you can assess what the numbers mean.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Step
              tone="human"
              step="01"
              head="Establish the terms"
              body="Review proposed covenant definitions beside their source clauses. Approve versioned, effective-dated terms for future tests."
            />
            <Step
              tone="code"
              step="02"
              head="Compute independently"
              body="Test DSCR against approved terms and reconcile the result with the borrower’s reported figure."
            />
            <Step
              tone="model"
              step="03"
              head="Investigate the exception"
              body="Follow the evidence across agreements and amendments. Review cited findings, missing information, and the resulting recommendation."
            />
          </div>
        </section>

        {/* ------------------------------------------------------ oversight */}
        <section id="oversight" aria-labelledby="oversight-heading" className="mt-16 scroll-mt-8 border-t border-border pt-12">
          <h2 id="oversight-heading" className="text-section text-text">A recommendation you can inspect.</h2>
          <dl className="mt-8 grid gap-6 md:grid-cols-2">
            <Point
              head="Open the source"
              body="Move from a finding to the exact clause and quoted passage behind it."
            />
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
        <section aria-labelledby="closing-heading" className="mt-16 border-t border-border pt-12">
          <h2 id="closing-heading" className="text-section text-text">Put the exception in context.</h2>
          <p className="mt-3 max-w-prose text-body text-text-secondary">
            Explore a synthetic credit case — from the covenant test to the evidence behind the recommendation.
          </p>
          <Link
            href={signInHref}
            className="mt-6 inline-block rounded-md bg-model px-4 py-2 text-body font-medium text-bg transition-opacity duration-fast hover:opacity-90"
          >
            Explore the demo
          </Link>
        </section>

        {/* --------------------------------------------------------- footer */}
        <footer className="mt-16 space-y-1 border-t border-border pt-6">
          <p className="text-body text-text">CreditScout</p>
          <p className="text-label text-text-muted">Decision support for commercial credit analysts.</p>
          <p className="text-label text-text-muted">
            CreditScout supports covenant investigation. It does not make credit decisions.
          </p>
          <p className="pt-2 text-label text-text-muted">
            Synthetic data only — every document is marked &ldquo;SYNTHETIC — FOR DEMONSTRATION&rdquo;. No real bank
            data.
          </p>
        </footer>
      </div>
    </main>
  );
}

/** One numbered workflow step. The tone rule still holds: slate human, amber code, teal model. */
function Step({ tone, step, head, body }: { tone: "model" | "code" | "human"; step: string; head: string; body: string }) {
  const accent = tone === "model" ? "text-model-bright" : tone === "code" ? "text-code-bright" : "text-human";
  const rule = tone === "model" ? "border-l-model" : tone === "code" ? "border-l-code" : "border-l-border-strong";
  return (
    <div className={`rounded-md border border-border border-l-2 ${rule} bg-surface p-4`}>
      <p className={`font-mono text-label ${accent}`}>{step}</p>
      <h3 className="mt-2 text-card text-text">{head}</h3>
      <p className="mt-2 text-body text-text-secondary">{body}</p>
    </div>
  );
}

/** One oversight capability. A definition list: the claim, then what it means. */
function Point({ head, body }: { head: string; body: string }) {
  return (
    <div className="border-l-2 border-border-strong pl-4">
      <dt className="text-card text-text">{head}</dt>
      <dd className="mt-2 max-w-prose text-body text-text-secondary">{body}</dd>
    </div>
  );
}
