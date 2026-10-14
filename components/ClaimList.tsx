import { chipCitation, type ClaimView } from "./casefileModel";
import { CitationChip } from "./CitationChip";

/**
 * The claims the explanation rests on. Every claim renders, and every claim
 * shows its citation chip. A claim with NO citation is not hidden and not drawn
 * as sound: it gets the danger "no citation" chip, a danger rule and a
 * sentence saying it is unsupported (design.md 5.3, 10 rule 3; I-6). Claims are
 * the model's, so the supported ones carry the teal rule.
 */
export function ClaimList(props: {
  claims: ClaimView[];
  selectedKey: string | null;
  onSelect: (key: string, citation: string, quote: string, claimText: string) => void;
}) {
  const { claims, selectedKey, onSelect } = props;
  if (claims.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-4 text-body text-text-muted">
        The agent made no cited claims. Read the explanation and the trace before deciding.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {claims.map((c, i) => {
        const key = `claim:${i}`;
        return (
          <li key={key} className={`rounded-md border-l-2 bg-surface p-3 ${c.cited ? "border-model" : "border-danger"}`}>
            <p className={`text-body ${c.cited ? "text-text-secondary" : "text-text-muted"}`}>{c.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CitationChip
                citation={chipCitation(c.citation)}
                selected={selectedKey === key}
                onSelect={() => onSelect(key, c.citation, c.quote, c.text)}
              />
              {!c.cited && <span className="text-label text-danger">Unsupported: nothing here can be checked against a document.</span>}
            </div>
            {c.cited && c.quote && <p className="mt-2 text-quote text-text-secondary">&ldquo;{c.quote}&rdquo;</p>}
          </li>
        );
      })}
    </ul>
  );
}
