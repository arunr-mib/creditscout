import { CalcBadge } from "./CalcValue";
import { chipCitation, formatFigure, type CalcRowView, type CalcSection } from "./casefileModel";
import { CitationChip } from "./CitationChip";

/** `calc_` and the first eight characters of the uuid: enough to recognise, not to retype. */
export const shortCalcId = (id: string): string => `calc_${id.slice(0, 8)}`;

/**
 * design.md 12.14. One row per component of each logged calculation. The last
 * column says where the figure came from, and that is the point of the table:
 * COMPUTED (the amber calc_id badge, code produced it) or QUOTED (a teal
 * citation chip, read from a document). That distinction is the guardrail's
 * entire basis, so the analyst sees it row by row.
 *
 * An input with no citation in the log is drawn with the "no citation" chip,
 * not quietly as if it were sourced. Numeric column: right-aligned, mono.
 */
export function CalcTable(props: {
  sections: CalcSection[];
  selectedKey: string | null;
  onSelect: (key: string, citation: string, quote: string) => void;
}) {
  const { sections, selectedKey, onSelect } = props;

  if (sections.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface p-4 text-body text-text-muted">
        <span className="font-mono text-num">—</span> No calculation was logged for this casefile, so there are no
        computed figures to show. Open the investigation trace to see what ran.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border-strong">
            <th scope="col" className="px-3 py-2 text-label uppercase tracking-wide text-text-muted">Component</th>
            <th scope="col" className="px-3 py-2 text-right text-label uppercase tracking-wide text-text-muted">Value</th>
            <th scope="col" className="px-3 py-2 text-label uppercase tracking-wide text-text-muted">Source</th>
          </tr>
        </thead>
        {sections.map((s) => (
          <tbody key={s.calcId} className="border-t border-border-strong">
            <tr>
              <th scope="colgroup" colSpan={3} className="px-3 py-2 text-left text-label text-text-muted">
                {s.title}
                {s.governing ? " · governing: the policy judged this one" : ""} · <span className="font-mono">{shortCalcId(s.calcId)}</span>
              </th>
            </tr>
            {s.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-2 text-body text-text-muted">
                  <span className="font-mono text-num">—</span> This calculation's log row holds no components to show.
                </td>
              </tr>
            )}
            {s.rows.map((r) => (
              <Row key={r.key} row={r} rowKey={`${s.calcId}:${r.key}`} selectedKey={selectedKey} onSelect={onSelect} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Row(props: {
  row: CalcRowView;
  rowKey: string;
  selectedKey: string | null;
  onSelect: (key: string, citation: string, quote: string) => void;
}) {
  const { row, rowKey, selectedKey, onSelect } = props;
  const computed = row.source.kind === "computed";
  return (
    <tr className="border-t border-border hover:bg-surface-raised">
      <td className="px-3 py-2 text-body text-text-secondary">
        {row.label}
        {row.note && <span className={`ml-2 text-label ${row.note === "breach" ? "text-danger" : "text-text-muted"}`}>{row.note}</span>}
      </td>
      {/* Amber is for what code produced. A document figure or an approved covenant
          term is evidence, not code, so it stays plain text — never amber. */}
      <td className={`px-3 py-2 text-right font-mono text-num tabular-nums ${computed ? "text-code-bright" : "text-text"}`}>
        {formatFigure(row.value, row.format)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {row.source.kind === "computed" ? (
          <CalcBadge calcId={shortCalcId(row.source.calcId)} />
        ) : row.source.kind === "term" ? (
          // A human-approved covenant term, not a code output: plain, never amber, never a "no citation" chip.
          <span className="text-label text-text-muted">approved term</span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="text-label text-text-muted">quoted</span>
            <CitationChip
              citation={row.source.kind === "quoted" ? chipCitation(row.source.citation) : undefined}
              selected={selectedKey === rowKey}
              onSelect={() => row.source.kind === "quoted" && onSelect(rowKey, row.source.citation, row.source.quote)}
            />
          </span>
        )}
      </td>
    </tr>
  );
}
