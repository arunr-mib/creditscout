import Link from "next/link";
import { AgentTag } from "./AgentTag";
import { InvestigateButton } from "./InvestigateButton";
import { barGeometry, type PipelineCard as Card } from "./pipelineModel";

const dscr = (v: number | null): string => (v == null ? "—" : `${v.toFixed(2)}x`);

/** The one button style on a card: mint, forest text. Mint marks "you can act", never a status. */
const ACTION_LINK =
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-mint px-3 py-2 text-body font-medium leading-5 text-text transition-colors duration-fast ease-out hover:bg-mint-hover";

/**
 * One loan in a lane: the borrower, its computed DSCR against its own minimum,
 * and at most one action. A decided card is quieter — the work is over.
 */
export function PipelineCard({ card }: { card: Card }) {
  const decided = card.status === "decided";
  const bar = barGeometry(card.ours, card.required);
  const below = card.ours != null && card.required != null && card.ours < card.required;
  const casefileHref = card.casefileId ? `/casefiles/${card.casefileId}` : null;

  const figureTone = decided ? "text-text-muted" : below ? "text-danger" : "text-text";
  const fillTone = decided ? "bg-border-strong" : below ? "bg-danger" : "bg-text";
  const reference = [
    card.required != null ? `min ${dscr(card.required)}` : null,
    card.theirs != null ? `reported ${dscr(card.theirs)}` : null,
  ].filter((p): p is string => p != null);

  const body = (
    <div className="space-y-2">
      <p className="truncate text-body font-medium text-text" title={card.borrower}>
        {card.borrower}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className={`text-figure-sm tabular-nums ${figureTone}`}>{dscr(card.ours)}</span>
        {/* Code-provenance: only when the figure exists. Amber means code computed this. */}
        {card.ours != null && (
          <span className="text-label text-code">
            <span aria-hidden="true">⟡ </span>computed
          </span>
        )}
      </p>
      {bar && (
        <div
          role="img"
          aria-label={`Computed DSCR ${dscr(card.ours)} against a minimum of ${dscr(card.required)}`}
          className="relative h-2 rounded-sm bg-surface-raised"
        >
          <div className={`h-2 rounded-sm ${fillTone}`} style={{ width: `${bar.fillPct}%` }} />
          <div aria-hidden="true" className="absolute inset-y-0 w-px bg-text" style={{ left: `${bar.minPct}%` }} />
        </div>
      )}
      {reference.length > 0 && <p className="text-label tabular-nums text-text-muted">{reference.join(" · ")}</p>}
      {card.note && <p className="text-label text-text-secondary">{card.note}</p>}
      {decided && <p className="text-label text-text-muted">Decision recorded</p>}
      {card.recommendationLabel && (
        <p className="flex flex-wrap items-center gap-2 text-label text-text-secondary">
          <AgentTag>CreditScout</AgentTag>
          <span>
            recommends <b className="font-semibold text-text">{card.recommendationLabel}</b>
          </span>
        </p>
      )}
      {card.status === "investigating" && (
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-label text-text-secondary">
            <AgentTag>Investigating</AgentTag>
            <span className="tabular-nums">{card.stepCount > 0 ? `Step ${card.stepCount}` : "Starting"}</span>
          </p>
          {card.steps.length > 0 && (
            <ul className="space-y-1 text-label text-text-secondary">
              {card.steps.map((s, i) => (
                <li key={`${i}-${s}`} className="truncate">
                  {s}
                </li>
              ))}
            </ul>
          )}
          <p className="text-label text-text-muted">Runs while its casefile is open</p>
        </div>
      )}
    </div>
  );

  const paused = card.status === "investigation_paused";
  const shell = "block rounded-xl border border-border bg-surface p-3";

  // A whole-card link when the card's only action is to open the casefile.
  // A paused card is the exception: it needs a visible Resume, not just a link.
  if (card.action === "open" && casefileHref && !paused) {
    return (
      <Link href={casefileHref} className={`${shell} transition-colors duration-fast hover:border-border-strong`}>
        {body}
      </Link>
    );
  }

  return (
    <div className={`${shell} space-y-3`}>
      {body}
      {card.action === "investigate" && card.exceptionId && (
        <InvestigateButton exceptionId={card.exceptionId} status={card.exceptionStatus ?? "new"} hasCasefile={card.casefileId != null} />
      )}
      {paused && casefileHref && (
        <Link href={casefileHref} className={ACTION_LINK}>
          Resume
        </Link>
      )}
      {card.action === "review" && casefileHref && (
        <Link href={casefileHref} className={ACTION_LINK}>
          Review
        </Link>
      )}
    </div>
  );
}
