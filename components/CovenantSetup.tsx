"use client";

import { useMemo, useState } from "react";
import { approveTerms } from "@/app/actions";
import { ApproveBar, type ApprovalState, type OmissionCounts } from "./ApproveBar";
import { ClausePanel } from "./ClausePanel";
import { ProposeTrace } from "./ProposeTrace";
import { ReviewNotices } from "./ReviewNotices";
import { TermEditor } from "./TermEditor";
import { TermRow } from "./TermRow";
import { TermsDiffTable } from "./TermsDiffTable";
import { UncitedClauses, clauseKeyOf } from "./UncitedClauses";
import {
  amendmentDocs,
  amendmentsNotBoarded,
  applyLocalEdits,
  blockers as computeBlockers,
  clauseFor,
  clausesOnFile,
  entryFor,
  quotesForClause,
  readRefusal,
  reviewRows,
  splitWarnings,
  uncitedClauses,
  unrestedParagraphs,
  type Citation,
  type Clause,
  type Edit,
  type Terms,
  type Violation,
  type Warning,
} from "./termsReview";

export interface DocumentRow {
  id: string;
  title: string;
  doc_type: string;
  effective_date: string | null;
}

export interface HistoryRow {
  version: number;
  status: string;
  effective_from: string;
  approved_by: string | null;
  approved_at: string | null;
  /** The amendment documents these terms carry (`effective_amendments[].doc`). */
  boarded_docs: string[];
}

export interface Proposal {
  termsId: string;
  version?: number;
  effectiveFrom?: string;
  terms: Terms;
  citations: Citation[];
  violations: Violation[];
  /** null: the server gave no list, which is not the same as an empty one. */
  warnings: Warning[] | null;
  warningsNote?: string;
  /** The clauses the model was shown, or null when that was not stored with the proposal. */
  shown: Clause[] | null;
  /** Loaded from the database rather than just proposed. */
  stored: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "proposing" }
  | { kind: "proposal" }
  | { kind: "not_found"; reason: string; shown: Clause[] };

type Selection = { kind: "term"; rowId: string } | { kind: "clause"; clause: Clause } | null;

const SOURCE_TYPES = ["agreement", "amendment"];

/**
 * The covenant setup review: the one place a person takes responsibility for
 * what will govern every future test of a borrower.
 *
 * The agent proposes, a clause stands behind each line, and the analyst reads
 * each term beside its clause. Reads arrive from the server page; the only
 * writes are the two API routes, and the server is the control on both.
 */
export function CovenantSetup(props: {
  facility: { id: string; borrower_name: string };
  documents: DocumentRow[];
  history: HistoryRow[];
  clauses: Clause[];
  initial: Proposal | null;
  /** The terms in force. The proposal is a change TO this, and the screen says what changes. */
  approved: { version: number; terms: Terms } | null;
  /** The signed-in analyst, offered as the approver name — never recorded unless chosen. */
  signedInAs: string | null;
}) {
  const { facility, documents, history, clauses } = props;

  const [phase, setPhase] = useState<Phase>(props.initial ? { kind: "proposal" } : { kind: "idle" });
  const [proposal, setProposal] = useState<Proposal | null>(props.initial);
  const [violations, setViolations] = useState<Violation[]>(props.initial?.violations ?? []);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [stale, setStale] = useState<ReadonlySet<string>>(new Set());
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [sel, setSel] = useState<Selection>(props.initial ? { kind: "term", rowId: "threshold" } : null);
  const [editing, setEditing] = useState<string | null>(null);
  const [approver, setApprover] = useState("");
  const [approval, setApproval] = useState<ApprovalState>({ kind: "idle" });
  // A failed propose must not take away what the analyst was already reviewing.
  // Clauses the analyst has opened from the uncited list. Opening is not reading, and the screen says "opened".
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [proposeError, setProposeError] = useState<{ status: number; message: string } | null>(null);

  const approved = approval.kind === "approved";
  const sourceDocs = documents.filter((d) => SOURCE_TYPES.includes(d.doc_type)).map((d) => d.title);

  // ---------------------------------------------------------------- derived

  const review = useMemo(
    () =>
      proposal
        ? reviewRows({ terms: proposal.terms, citations: proposal.citations, violations, edits, staleFields: stale, warnings: proposal.warnings })
        : null,
    [proposal, violations, edits, stale],
  );

  const effectiveTerms = useMemo(() => (proposal ? applyLocalEdits(proposal.terms, edits) : null), [proposal, edits]);

  const notRunKeys = useMemo(() => {
    if (!proposal) return [];
    if (proposal.warnings === null) return ["all"];
    return splitWarnings(proposal.warnings).notRun.map((w) => w.field ?? "all");
  }, [proposal]);

  const blockerList = useMemo(
    () =>
      review
        ? computeBlockers({
            views: review.views,
            stray: review.stray,
            approver,
            unconfirmed: notRunKeys.filter((k) => !confirmed.has(k)),
          })
        : [],
    [review, approver, notRunKeys, confirmed],
  );

  const allCitations = useMemo(() => [...(proposal?.citations ?? []), ...Object.values(edits)], [proposal, edits]);

  // The universe is everything the server holds for the facility, never only what retrieval returned.
  const uncited = useMemo(() => {
    if (phase.kind === "not_found") return uncitedClauses([], clauses, phase.shown);
    if (!proposal) return [];
    return uncitedClauses(allCitations, clauses, proposal.shown);
  }, [phase, proposal, allCitations, clauses]);

  const shownKnown = phase.kind === "not_found" ? true : proposal?.shown != null;
  const loose = useMemo(() => unrestedParagraphs(allCitations, clauses), [allCitations, clauses]);

  const panel = useMemo((): { clause: Clause | null; quote?: string; quotes?: string[]; reason?: string; unresolved?: string } => {
    if (!sel || !review) {
      return sel?.kind === "clause" ? { clause: sel.clause, reason: "Not cited by any term" } : { clause: null };
    }
    if (sel.kind === "clause") return { clause: sel.clause, reason: "Not cited by any term" };
    const view = review.views.find((v) => v.row.id === sel.rowId);
    if (!view?.row.citeField) return { clause: null };
    const entry = entryFor(view.row.citeField, proposal?.citations ?? [], edits);
    if (!entry) return { clause: null };
    const clause = clauseFor(entry.citation, clauses);
    if (!clause) return { clause: null, unresolved: entry.citation };
    return { clause, quote: entry.quote, quotes: quotesForClause(clause, allCitations), reason: `Cited for ${view.row.label}` };
  }, [sel, review, proposal, edits, clauses, allCitations]);

  // ---------------------------------------------------------------- actions

  function startProposal(p: Proposal) {
    setProposal(p);
    setViolations(p.violations);
    setEdits({});
    setStale(new Set());
    setConfirmed(new Set());
    setOpened(new Set());
    setEditing(null);
    setApproval({ kind: "idle" });
    setPhase({ kind: "proposal" });
    setSel({ kind: "term", rowId: "threshold" });
  }

  async function propose() {
    const resume: Phase = proposal ? { kind: "proposal" } : { kind: "idle" };
    const fail = (status: number, message: string) => {
      setProposeError({ status, message });
      setPhase(resume);
      if (proposal) setSel({ kind: "term", rowId: "threshold" });
    };
    setProposeError(null);
    setPhase({ kind: "proposing" });
    setSel(null);
    let res: Response;
    try {
      res = await fetch("/api/covenant-terms/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facility_id: facility.id }),
      });
    } catch {
      fail(0, "The server could not be reached. Check that it is running, then propose again.");
      return;
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || body === null) {
      fail(res.status, typeof body?.error === "string" ? body.error : `The server answered ${res.status} without saying why.`);
      return;
    }
    const excerpts = (Array.isArray(body.excerpts) ? body.excerpts : []) as Clause[];
    if (body.found === false) {
      setProposal(null);
      setPhase({ kind: "not_found", reason: String(body.reason ?? "No reason was given."), shown: excerpts });
      setOpened(new Set());
      return;
    }
    const provenance = (body.provenance ?? {}) as { violations?: Violation[] };
    startProposal({
      termsId: String(body.terms_id),
      version: typeof body.version === "number" ? body.version : undefined,
      effectiveFrom: typeof body.effective_from === "string" ? body.effective_from : undefined,
      terms: body.terms as Terms,
      citations: (body.source_citations ?? []) as Citation[],
      violations: provenance.violations ?? [],
      warnings: Array.isArray(body.warnings) ? (body.warnings as Warning[]) : null,
      shown: excerpts,
      stored: false,
    });
  }

  async function approve() {
    if (!proposal) return;
    setApproval({ kind: "sending" });
    let res: { status: number; body: Record<string, unknown> };
    try {
      res = await approveTerms({
        terms_id: proposal.termsId,
        approved_by: approver,
        ...(Object.keys(edits).length > 0 ? { edits: Object.values(edits) } : {}),
      });
    } catch {
      setApproval({
        kind: "refused",
        refusal: { status: 0, message: "The request did not reach the server. Nothing was approved. Your edits are still here.", violations: [], errors: [] },
      });
      return;
    }
    const body = res.body;
    if (res.status === 200 && body && typeof body === "object") {
      const b = body as { version: number; effective_from: string };
      setApproval({ kind: "approved", version: b.version, effectiveFrom: b.effective_from, by: approver.trim() });
      setEditing(null);
      return;
    }
    const refusal = readRefusal(res.status, body);
    if (res.status === 409) {
      setApproval({ kind: "conflict", message: refusal.message });
      return;
    }
    if (refusal.violations.length > 0) {
      // The server's word replaces ours: these describe the terms as edited.
      setViolations(refusal.violations);
      setStale(new Set());
    }
    setApproval({ kind: "refused", refusal });
  }

  function saveEdit(edit: Edit) {
    setEdits((e) => ({ ...e, [edit.field]: edit }));
    setStale((s) => new Set(s).add(edit.field));
    setEditing(null);
    if (approval.kind === "refused") setApproval({ kind: "idle" });
  }

  function undoEdit(field: string) {
    setEdits((e) => {
      const next = { ...e };
      delete next[field];
      return next;
    });
    // The server's earlier refusal of the original value applies to it again.
    setStale((s) => {
      const next = new Set(s);
      next.delete(field);
      return next;
    });
  }

  function openClause(clause: Clause) {
    setSel({ kind: "clause", clause });
    setOpened((o) => new Set(o).add(clauseKeyOf(clause)));
  }

  function openCitation(citation: string) {
    const clause = clauseFor(citation, clauses);
    if (clause) openClause(clause);
  }

  // ----------------------------------------------------------------- render

  const busy = phase.kind === "proposing";
  const totalOnFile = clausesOnFile(clauses);
  const knownCitations = [...new Set(clauses.map((c) => c.citation))];

  // After an approval the page must not contradict the footer: the versions and the
  // boarding flags are recomputed from what was just approved.
  const approvedRow: HistoryRow | null =
    approval.kind === "approved" && effectiveTerms
      ? {
          version: approval.version,
          status: "approved",
          effective_from: approval.effectiveFrom,
          approved_by: approval.by,
          approved_at: null,
          boarded_docs: amendmentDocs(effectiveTerms),
        }
      : null;
  const shownHistory: HistoryRow[] = approvedRow
    ? [
        ...history
          .filter((h) => !(h.status === "proposed" && (h.version === approvedRow.version || h.version === proposal?.version)))
          .map((h) => (h.status === "approved" ? { ...h, status: "superseded" } : h)),
        approvedRow,
      ].sort((a, b) => a.version - b.version)
    : history;
  const governing = shownHistory.find((h) => h.status === "approved");
  const boardedTitles = new Set(governing ? governing.boarded_docs : []);
  const unboarded = amendmentsNotBoarded(documents, boardedTitles);
  const proposedDocs = new Set(effectiveTerms ? amendmentDocs(effectiveTerms) : []);
  const boarding = approved || !proposal ? [] : unboarded.map((d) => ({ title: d.title, effectiveDate: d.effective_date, inTerms: proposedDocs.has(d.title) }));
  const omission: OmissionCounts = {
    notes: proposal?.warnings ? splitWarnings(proposal.warnings).notes.length : 0,
    looseClauses: loose.clauses,
    looseParagraphs: loose.paragraphs,
    looseWhere: loose.where,
    unboarded: unboarded.length,
  };

  const onFile = (
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="What is on file">
        {/* min-w-0: a grid child defaults to min-width:auto, so the wide
            table below forced the whole track — and the page — wider. */}
        <div className="min-w-0 rounded-md border border-border bg-surface p-3">
          <h2 className="text-card text-text">Documents on file</h2>
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-body">
            <thead>
              <tr className="text-label uppercase tracking-wide text-model-bright">
                <th className="pb-1 font-medium">Title</th>
                <th className="pb-1 font-medium">Type</th>
                <th className="pb-1 font-medium">Effective</th>
                <th className="pb-1 font-medium">Boarded</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="py-1 pr-2 text-text-secondary">{d.title}</td>
                  <td className="py-1 pr-2 text-text-muted">
                    {d.doc_type.replace("_", " ")}
                    {!SOURCE_TYPES.includes(d.doc_type) && " (cannot be a source of terms)"}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-2 font-mono text-text-muted">{d.effective_date ?? "—"}</td>
                  <td className="py-1">
                    {d.doc_type !== "amendment" ? (
                      <span className="text-text-muted">—</span>
                    ) : boardedTitles.has(d.title) ? (
                      <span className="text-text-muted">boarded</span>
                    ) : (
                      <span className="whitespace-nowrap rounded-sm bg-code-bg px-1 py-px font-mono text-badge text-code">
                        <span aria-hidden="true">⟡ </span>not boarded
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <div className="min-w-0 rounded-md border border-border bg-surface p-3">
          <h2 className="text-card text-text">Versions</h2>
          {shownHistory.length === 0 ? (
            <p className="mt-2 text-body text-text-secondary">No covenant terms exist for this loan yet. No test can run until a person approves some.</p>
          ) : (
            <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-body">
              <thead>
                <tr className="text-label uppercase tracking-wide text-model-bright">
                  <th className="pb-1 font-medium">Version</th>
                  <th className="pb-1 font-medium">Status</th>
                  <th className="pb-1 font-medium">Effective from</th>
                  <th className="pb-1 font-medium">Approved by</th>
                </tr>
              </thead>
              <tbody>
                {shownHistory.map((h) => (
                  <tr key={h.version} className="border-t border-border">
                    <td className="py-1 pr-2 font-mono text-text-secondary">v{h.version}</td>
                    <td className="py-1 pr-2 text-text-secondary">{h.status}</td>
                    <td className="whitespace-nowrap py-1 pr-2 font-mono text-text-muted">{h.effective_from}</td>
                    <td className="py-1 text-text-muted">{h.approved_by ?? "not approved"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          {governing && (
            <p className="mt-2 text-label text-text-muted">
              Version {governing.version} is the one in force. A new proposal changes nothing until it is approved.
            </p>
          )}
          {unboarded.length > 0 && (
            <p className="mt-2 text-label text-code">
              <span aria-hidden="true">⟡ </span>by code · {unboarded.map((d) => d.title).join(", ")} on file and not part of the terms in force
            </p>
          )}
        </div>
      </section>
  );

  return (
    // pb-16 so the last section can scroll clear of the sticky approve bar
    // rather than sitting permanently underneath it.
    <div className="space-y-6 pb-16">
      {/* The screen is a REVIEW, and it is of a specific version. "Covenant
          setup · Coastal Marine" named a place in the app; this names the
          decision and the thing being decided. */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-title text-text">Review covenant terms</h1>
          {proposal && !approved && (
            <span className="rounded border border-code bg-code-bg px-2 py-px text-label text-code-bright">
              Pending analyst approval
            </span>
          )}
        </div>
        <p className="text-body text-text-secondary">
          {facility.borrower_name}
          {proposal?.version ? ` · Proposed v${proposal.version}` : ""}
          {props.approved ? ` · Approved v${props.approved.version} in force` : " · No approved version yet"}
        </p>
        <p className="text-body text-text-secondary">
          Compare the proposed terms with the source documents before approving this version. Nothing governs a test
          until a person approves it.
        </p>
      </header>

      {!approved && (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={propose}
            disabled={busy}
            className={
              proposal
                ? "h-8 rounded-md border border-border-strong px-4 text-body text-text hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
                : "h-8 rounded-md bg-model px-4 text-body font-medium text-bg disabled:cursor-not-allowed disabled:opacity-40"
            }
          >
            {proposal || phase.kind === "not_found" || proposeError ? "Re-extract terms" : "Extract covenant terms"}
          </button>
          <p className="text-label text-text-muted">
            {busy
              ? "The CreditScout Agent is extracting the covenant terms from your loan agreement"
              : proposal
              ? "Reads the documents again and REPLACES the draft below, including any edits you have made here. The approved version is untouched."
              : "The agent reads the agreement and any amendments. The proposal is saved but governs nothing until a person approves it."}
          </p>
        </div>
      )}

      {phase.kind === "proposing" && <ProposeTrace borrower={facility.borrower_name} documents={sourceDocs} />}

      {proposeError && (
        <div role="alert" className="rounded-md border-2 border-danger bg-danger-bg p-4">
          <p className="text-card text-danger">Proposing failed{proposeError.status ? ` (${proposeError.status})` : ""}. Nothing was approved.</p>
          <p className="mt-1 text-body text-text-secondary">{proposeError.message}</p>
          {/0008/.test(proposeError.message) && (
            <p className="mt-1 text-body text-text-secondary">
              This is a setup gap, not a problem with the agreement: a database migration has not been applied.
            </p>
          )}
        </div>
      )}

      {phase.kind === "not_found" && (
        <>
          <section role="alert" className="rounded-md border-2 border-border-strong bg-surface-raised p-4">
            <h2 className="text-section text-text">No DSCR definition was found</h2>
            <p className="mt-2 text-body text-text-secondary">
              The agent did not find a definition of the Debt Service Coverage Ratio, or a minimum, in the documents on
              file. Its reason:
            </p>
            <p className="mt-2 border-l-2 border-model pl-3 text-body text-text">{phase.reason}</p>
            <p className="mt-3 text-body text-text-secondary">
              No terms were created, and none are suggested: a value offered here could be accepted without being read.
              Resolve this manually. Check whether the agreement or an amendment is missing from the file, and read the
              clauses the agent was shown below.
            </p>
          </section>
          <div className="grid grid-cols-5 items-start gap-4">
            <div className="col-span-3">
              <UncitedClauses
                uncited={uncited}
                totalOnFile={totalOnFile}
                shownKnown
                warnings={[]}
                opened={opened}
                selectedKey={sel?.kind === "clause" ? clauseKeyOf(sel.clause) : null}
                onOpen={openClause}
              />
            </div>
            <div className="col-span-2">
              <h2 className="mb-3 text-section text-text">Source clause</h2>
              <ClausePanel clause={panel.clause} reason={panel.reason} />
            </div>
          </div>
        </>
      )}

      {phase.kind !== "proposal" && onFile}

      {phase.kind === "proposal" && proposal && review && effectiveTerms && (
        <>
          <div className="rounded-md border border-border bg-surface p-3">
            {/* No version and no storage state. "Stored proposal · version 3"
                answered questions an analyst never asked — where we held it,
                and a number that means nothing until they open the history. */}
            <p className="text-label uppercase tracking-wide text-text-muted">Proposed covenants</p>
            {approval.kind === "approved" ? (
              <p className="mt-1 text-body text-text-secondary">
                <span className="rounded-sm bg-human-bg px-1 py-px text-badge text-human">approved by {approval.by}</span> A
                person approved these terms. The agent proposed them; the name was typed, not verified.
              </p>
            ) : (
              <p className="mt-1 text-body text-text-secondary">
                <span className="rounded-sm bg-model-bg px-1 py-px text-badge text-model">model proposed</span> Extracted
                by the agent from loan documents. Effective if you approve.
              </p>
            )}
          </div>

          <TermsDiffTable
            approved={props.approved}
            proposedVersion={proposal.version}
            proposedTerms={effectiveTerms}
            onOpenTerm={(field) => {
              const entry = entryFor(field, proposal.citations, edits);
              if (entry) openCitation(entry.citation);
            }}
          />

          <ReviewNotices
            warnings={proposal.warnings}
            note={proposal.warningsNote}
            boarding={boarding}
            confirmed={confirmed}
            locked={approved}
            onConfirm={(k, on) =>
              setConfirmed((c) => {
                const next = new Set(c);
                if (on) next.add(k);
                else next.delete(k);
                return next;
              })
            }
            onOpenCitation={openCitation}
          />

          <div className="grid grid-cols-5 items-start gap-4">
            <div className="col-span-3 space-y-6">
              <section aria-labelledby="terms-title">
                <h2 id="terms-title" className="mb-3 text-section text-text">
                  {approved ? "Approved terms" : "Proposed terms"}
                </h2>
                <ul className="space-y-3">
                  {review.views.map((view) => (
                    <TermRow
                      key={view.row.id}
                      view={view}
                      selected={sel?.kind === "term" && sel.rowId === view.row.id}
                      editable={!approved && view.row.fields.length > 0}
                      editing={editing === view.row.id}
                      editedFields={Object.keys(edits)}
                      approvedBy={approval.kind === "approved" ? approval.by : undefined}
                      onSelect={() => setSel({ kind: "term", rowId: view.row.id })}
                      onEdit={() => setEditing(view.row.id)}
                      onUndo={undoEdit}
                    >
                      {editing === view.row.id && (
                        <TermEditor
                          row={view.row}
                          terms={effectiveTerms}
                          existing={edits}
                          knownCitations={knownCitations}
                          panelCitation={panel.clause?.citation}
                          onSave={saveEdit}
                          onCancel={() => setEditing(null)}
                        />
                      )}
                    </TermRow>
                  ))}
                </ul>
              </section>

            </div>
            {/* The heading sits OUTSIDE the panel so it shares a baseline with
                "Proposed terms" opposite. With the left heading bare and the
                right one inside its card, the two columns started at different
                heights and did not read as a pair. */}
            <div className="col-span-2">
              <h2 id="source-title" className="mb-3 text-section text-text">Source clause</h2>
              <ClausePanel clause={panel.clause} quote={panel.quote} quotes={panel.quotes} reason={panel.reason} unresolved={panel.unresolved} />
            </div>
          </div>

          {onFile}

          <ApproveBar
            version={proposal.version}
            effectiveFrom={proposal.effectiveFrom}
            signedInAs={props.signedInAs}
            approver={approver}
            onApprover={setApprover}
            blockers={approved ? [] : blockerList}
            state={approval}
            editCount={Object.keys(edits).length}
            omission={omission}
            uncheckedLists={notRunKeys}
            onApprove={approve}
            onReload={() => window.location.reload()}
          />
        </>
      )}
    </div>
  );
}
