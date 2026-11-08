/**
 * Citation chip, docs/design.md §5.3. Interactive, so it takes the
 * forest ink rather than a status colour; clicking it loads the clause beside
 * the term. Monospace because a citation is an identifier.
 *
 * A claim without a chip must not render as sound. When there is no citation
 * the chip says so, in words and in the danger colour, rather than vanishing:
 * the absence is the finding.
 */
export function CitationChip(props: {
  citation: string | undefined;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { citation, selected = false, onSelect } = props;

  if (!citation) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-danger-bg px-2 py-px text-label text-danger">
        <span aria-hidden="true">✕</span>
        no citation
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title="Read this clause with the quote highlighted"
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-px font-mono text-label text-text transition-colors duration-fast ease-out hover:bg-surface-raised ${
        selected ? "border-text bg-surface-raised" : "border-border-strong"
      }`}
    >
      {citation}
      <span aria-hidden="true">↗</span>
    </button>
  );
}
