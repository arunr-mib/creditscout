/**
 * Three steps, not four. Borrower details is two fields — a name and an
 * optional industry — which does not warrant a screen of its own, and splitting
 * it from the upload made onboarding feel like paperwork before the work.
 *
 * `borrower` and `documents` both map to the first step so existing links and
 * the derived-step logic keep working.
 */
const STEPS: { key: "borrower" | "documents" | "terms" | "done"; label: string }[] = [
  { key: "documents", label: "Borrower & documents" },
  { key: "terms", label: "Review terms" },
  { key: "done", label: "Complete" },
];

export function OnboardingStepper({ current }: { current: "borrower" | "documents" | "terms" | "done" }) {
  // "borrower" is the same step as "documents" now.
  const key = current === "borrower" ? "documents" : current;
  const idx = STEPS.findIndex((s) => s.key === key);
  return (
    <ol className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3">
      {STEPS.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "todo";
        const tone = state === "current" ? "text-text" : state === "done" ? "text-model-bright" : "text-text-muted";
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-sm border text-badge ${state === "current" ? "border-model text-model-bright" : "border-border-strong text-text-muted"}`}>
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className={`text-label ${tone}`}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="px-1 text-text-muted" aria-hidden="true">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
