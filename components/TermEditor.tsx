"use client";

import { useId, useState } from "react";
import { getAt, type Edit, type FieldSpec, type Row, type Scalar, type Terms } from "./termsReview";

/**
 * Edits one field of one term. An edit is held to the same standard as the
 * model's proposal: it carries its own citation and a verbatim quote, and the
 * server checks the value against that quote when the analyst approves.
 *
 * Lists are editable as lists. A gate that can refuse a deduction list but only
 * repair single numbers is a dead end, not a control.
 */
export function TermEditor(props: {
  row: Row;
  /** The terms as they stand now, edits included: the form starts from what is on screen. */
  terms: Terms;
  existing: Record<string, Edit>;
  /** Citations of the clauses on file, offered as suggestions only. */
  knownCitations: string[];
  /** The clause open in the right pane, for "use selected text". */
  panelCitation: string | undefined;
  onSave: (edit: Edit) => void;
  onCancel: () => void;
}) {
  const { row, terms, existing, knownCitations, panelCitation, onSave, onCancel } = props;
  const listId = useId();
  const [spec, setSpec] = useState<FieldSpec>(row.fields[0]);
  const prior = existing[spec.field];

  const current = getAt(terms, spec.field);
  const [raw, setRaw] = useState<string>(initialText(current));
  const [uncapped, setUncapped] = useState<boolean>(current === null);
  const [picked, setPicked] = useState<string[]>(Array.isArray(current) ? (current as string[]) : []);
  const [citation, setCitation] = useState(prior?.citation ?? "");
  const [quote, setQuote] = useState(prior?.quote ?? "");

  // Changing which field is edited reloads the form from that field's current value.
  const choose = (field: string) => {
    const next = row.fields.find((f) => f.field === field);
    if (!next) return;
    const cur = getAt(terms, next.field);
    setSpec(next);
    setRaw(initialText(cur));
    setUncapped(cur === null);
    setPicked(Array.isArray(cur) ? (cur as string[]) : []);
    setCitation(existing[next.field]?.citation ?? "");
    setQuote(existing[next.field]?.quote ?? "");
  };

  const value = parseValue(spec, { raw, uncapped, picked });
  const problems: string[] = [];
  if (value.error) problems.push(value.error);
  if (citation.trim() === "") problems.push("Name the clause this value comes from.");
  if (quote.trim() === "") problems.push("Paste the verbatim words that state this value.");

  const useSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const inPanel = sel?.anchorNode && document.getElementById("clause-panel-text")?.contains(sel.anchorNode);
    if (!text || !inPanel) return;
    setQuote(text);
    if (panelCitation) setCitation(panelCitation);
  };

  return (
    <form
      className="mt-3 space-y-3 rounded-md border border-border-strong bg-bg p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length > 0 || value.error) return;
        onSave({ field: spec.field, value: value.value as Scalar | Scalar[], citation: citation.trim(), quote });
      }}
    >
      {row.fields.length > 1 && (
        <label className="block text-label text-text-muted">
          Field
          <select
            value={spec.field}
            onChange={(e) => choose(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-body text-text"
          >
            {row.fields.map((f) => (
              <option key={f.field} value={f.field}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {spec.kind === "list" ? (
        <fieldset>
          <legend className="text-label text-text-muted">{spec.label} (tick every one the clause names)</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {(spec.vocabulary ?? []).map((name) => (
              <label key={name} className="flex items-center gap-2 font-mono text-num text-text">
                <input
                  type="checkbox"
                  checked={picked.includes(name)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, name] : picked.filter((n) => n !== name))}
                />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <div>
          <label className="block text-label text-text-muted">
            {spec.label}
            <input
              type="text"
              value={raw}
              disabled={spec.kind === "nullable-number" && uncapped}
              inputMode={spec.kind === "number" || spec.kind === "nullable-number" ? "decimal" : undefined}
              placeholder={spec.kind === "date" ? "YYYY-MM-DD" : undefined}
              onChange={(e) => setRaw(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-2 py-1 font-mono text-num text-text disabled:opacity-40"
            />
          </label>
          {spec.kind === "nullable-number" && (
            <label className="mt-2 flex items-center gap-2 text-body text-text-secondary">
              <input type="checkbox" checked={uncapped} onChange={(e) => setUncapped(e.target.checked)} />
              No cap: the clause states no limit (stored as uncapped, not as zero)
            </label>
          )}
        </div>
      )}

      <label className="block text-label text-text-muted">
        Cited clause
        <input
          type="text"
          list={listId}
          value={citation}
          onChange={(e) => setCitation(e.target.value)}
          className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-2 py-1 font-mono text-num text-text"
        />
        <datalist id={listId}>
          {knownCitations.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>

      <label className="block text-label text-text-muted">
        Verbatim quote
        <textarea
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-2 py-1 font-mono text-quote text-text"
        />
      </label>
      <button
        type="button"
        onClick={useSelection}
        className="rounded-md border border-border-strong px-3 py-1 text-label text-text hover:bg-surface-raised"
      >
        Use the text I selected in the clause panel
      </button>

      <p className="text-label text-text-muted">
        The server checks this value against this quote when you approve, exactly as it checks the model&rsquo;s. Nothing
        is checked until then.
      </p>
      {problems.length > 0 && (
        <ul className="list-inside list-disc text-label text-text-secondary">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={problems.length > 0}
          className="h-8 rounded-md border border-border-strong px-4 text-body text-text hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply edit
        </button>
        <button type="button" onClick={onCancel} className="h-8 px-4 text-body text-text-muted hover:text-text">
          Cancel
        </button>
      </div>
    </form>
  );
}

function initialText(v: unknown): string {
  return v === null || v === undefined || Array.isArray(v) ? "" : String(v);
}

/** What the form currently says, or why it does not yet say a value. Nothing is defaulted. */
function parseValue(
  spec: FieldSpec,
  form: { raw: string; uncapped: boolean; picked: string[] },
): { value?: Scalar | Scalar[]; error?: string } {
  if (spec.kind === "list") return { value: form.picked };
  if (spec.kind === "nullable-number" && form.uncapped) return { value: null };
  const text = form.raw.trim();
  if (text === "") return { error: `Enter the ${spec.label}.` };
  if (spec.kind === "number" || spec.kind === "nullable-number") {
    const plain = text.replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(plain)) return { error: `${spec.label} must be a plain number.` };
    return { value: Number(plain) };
  }
  return { value: text };
}
