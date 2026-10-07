import { noticeHeading, noticesOf, type Notice } from "./casefileModel";

/**
 * design.md 5.6 / 12.13. Amber, because a guardrail is code. A 3px left border
 * on the code background, one per note. Always visible and never collapsible:
 * these are the moments the system polices itself, and hiding them would hide
 * the best evidence the product has. There is deliberately no disclosure and no
 * dismiss. No notes renders nothing, not an empty box.
 */
export function GuardrailNotices({ notes }: { notes: unknown }) {
  const list = noticesOf(notes);
  if (list.length === 0) return null;
  return (
    <section aria-label="Guardrail notices" className="space-y-2">
      {list.map((n, i) => (
        <GuardrailNotice key={i} notice={n} />
      ))}
    </section>
  );
}

export function GuardrailNotice({ notice }: { notice: Notice }) {
  return (
    <div role="note" className="rounded-md border-l-4 border-code bg-code-bg p-3">
      <p className="text-body text-text-secondary">
        <strong className="font-semibold text-code-bright">
          <span aria-hidden="true">⟡ </span>
          {noticeHeading(notice)}
        </strong>
        {notice.detail ? <> — {notice.detail}</> : null}
      </p>
      {notice.check && (
        <p className="mt-1 text-badge text-text-muted">
          Rule <span className="font-mono text-code">{notice.check}</span>
        </p>
      )}
    </div>
  );
}
