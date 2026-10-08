import Link from "next/link";

export const dynamic = "force-dynamic";

function nextParam(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  return value && value.startsWith("/") && !value.startsWith("//") ? `?next=${encodeURIComponent(value)}` : "";
}

/**
 * The public landing page (the only page, with /login, reachable without the
 * demo credential). Its copy is the spec's own framing: a reasoning layer that
 * decides what to inspect, a calculation layer that never guesses, a human who
 * always approves.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const signInHref = `/login${nextParam(next)}`;

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-content px-6 py-16 md:py-24">
        <header className="flex items-center justify-between">
          <span className="text-card text-text">CreditScout</span>
          <Link
            href={signInHref}
            className="rounded-md border border-border-strong px-3 py-2 text-body text-text transition-colors hover:border-model"
          >
            Sign in
          </Link>
        </header>

        <section className="mt-16 max-w-content space-y-6 md:mt-24">
          <p className="text-label text-model-bright">Decision support for commercial credit analysts</p>
          <h1 className="text-title text-text">
            A reasoning layer decides what evidence to inspect next. A calculation layer never guesses. A human always
            approves.
          </h1>
          <p className="max-w-content text-body text-text-secondary">
            Analysts monitor dozens of borrower loans and investigate covenant exceptions every reporting cycle.
            CreditScout runs that investigation for DSCR: it finds the covenant definition across the credit agreement
            and its amendments, recomputes the ratio on the right basis, reconciles it against the borrower&rsquo;s
            reported figure, and recommends — resolve, escalate, or request more. It never makes the decision.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href={signInHref}
              className="rounded-md bg-model-bg px-4 py-2 text-card text-model-bright transition-opacity hover:opacity-90"
            >
              Enter the workspace
            </Link>
            <span className="text-label text-text-muted">Demo credentials are shown on the sign-in page.</span>
          </div>
        </section>

        <section className="mt-16 grid gap-4 md:grid-cols-3">
          <Principle
            tone="model"
            head="The model reasons"
            body="It chooses what to read next and judges the evidence — but it never produces a number."
          />
          <Principle
            tone="code"
            head="The code computes"
            body="Every DSCR, threshold and policy is deterministic. A figure with no logged calculation does not pass."
          />
          <Principle
            tone="human"
            head="The human decides"
            body="An analyst approves or overrides every recommendation, and overrides become memory for later cases."
          />
        </section>

        <footer className="mt-16 border-t border-border pt-6">
          <p className="text-label text-text-muted">
            Synthetic data only — every document is marked “SYNTHETIC — FOR DEMONSTRATION”. No real bank data.
          </p>
        </footer>
      </div>
    </main>
  );
}

function Principle({ tone, head, body }: { tone: "model" | "code" | "human"; head: string; body: string }) {
  const accent = tone === "model" ? "text-model-bright" : tone === "code" ? "text-code-bright" : "text-human";
  const rule = tone === "model" ? "border-l-model" : tone === "code" ? "border-l-code" : "border-l-border-strong";
  return (
    <div className={`rounded-md border border-border border-l-2 ${rule} bg-surface p-4`}>
      <h2 className={`text-card ${accent}`}>{head}</h2>
      <p className="mt-2 text-body text-text-secondary">{body}</p>
    </div>
  );
}
