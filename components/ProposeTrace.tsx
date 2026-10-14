"use client";

import { useEffect, useState } from "react";

/**
 * Live status while the definition agent reads. The house idiom is the step
 * trace (docs/design.md §5.5), whose rule is that it shows real steps arriving
 * and never fakes progress.
 *
 * The propose route answers once, at the end, so this screen cannot see which
 * step the agent is on. It says exactly that much: the one step that is
 * running, with a real elapsed clock, and what has NOT started is shown as not
 * started. No bar, no shimmer, no step ticked off on a timer.
 */
export function ProposeTrace(props: { borrower: string; documents: string[] }) {
  const { borrower, documents } = props;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <section aria-label="Proposing terms" aria-live="polite" className="rounded-md border border-border-strong bg-surface p-4">
      <h2 className="text-card text-text">The CreditScout Agent is extracting the covenant terms from your loan agreement</h2>
      <ol className="mt-3 space-y-3">
        <li className="border-l-2 border-model pl-3">
          <p className="flex items-baseline gap-3">
            <span className="text-body text-model-bright">definition_agent</span>
            <span className="text-label tabular-nums text-text-muted">running · {seconds}s</span>
          </p>
          <p className="text-body text-text-secondary">
            Reading {documents.length > 0 ? documents.join(", ") : "the agreement and any amendments on file"}, finding the
            definition of the Debt Service Coverage Ratio, and mapping it into structured terms with a quote behind each.
          </p>
        </li>
        <li className="border-l-2 border-border-strong pl-3">
          <p className="text-body text-text-muted">Not started: automated check</p>
          <p className="text-body text-text-muted">
            When the agent returns, code checks every value against the clause it cites. The proposal is saved, but it governs nothing until you approve it.
          </p>
        </li>
      </ol>
      <p className="mt-3 text-label text-text-muted">This takes several seconds. The agent reports once, when it finishes.</p>
    </section>
  );
}
