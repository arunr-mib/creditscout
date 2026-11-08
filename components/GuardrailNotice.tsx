import { NOTICE_WEIGHT_LABEL, groupNotices, noticeHeading, noticesOf, type Notice } from "./casefileModel";

/**
 * design.md 5.6 / 12.13. Amber, because a guardrail is code — carried by the
 * heading text and the rule name, not by a coloured stripe or a tinted
 * background (a left-accent bar reads as decorative, generated-dashboard
 * styling; status here is a word, same rule as everywhere else in the app).
 * One note per card. Always visible and never collapsible: these are the
 * moments the system polices itself, and hiding them would hide
 * these are the moments the system polices itself, and hiding them would hide
 * the best evidence the product has. There is deliberately no disclosure and no
 * dismiss. No notes renders nothing, not an empty box.
 */
export function GuardrailNotices({ notes }: { notes: unknown }) {
  const list = noticesOf(notes);
  if (list.length === 0) return null;
  // Grouped by what each one DEMANDS. Flat, a rule that changed the
  // recommendation read exactly like an informational flag, and an analyst had
  // to infer the difference from the wording.
  const groups = groupNotices(list);
  return (
    <section aria-label="Validation notices" className="space-y-4">
      {groups.map((g) => (
        <div key={g.weight} className="space-y-2">
          <h3 className="text-label uppercase tracking-wide text-text-muted">
            {NOTICE_WEIGHT_LABEL[g.weight]} · {g.notices.length}
          </h3>
          {g.notices.map((n, i) => (
            <GuardrailNotice key={i} notice={n} />
          ))}
        </div>
      ))}
    </section>
  );
}

export function GuardrailNotice({ notice }: { notice: Notice }) {
  return (
    <div role="note" className="rounded-md border border-border-strong bg-surface p-3">
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
