# CreditScout — Design Spec

**Date:** 2026-10-01
**Owner:** Arun Rajendiran (product) · Claude Code (engineering)
**Status:** Draft for owner review
**Context:** Keystone project, Maven "Master Agentic AI for PMs and FDEs" Cohort 10. Pitch Day Oct 9–10, 2026 (3-minute pre-recorded video). Doubles as an AI PM portfolio piece on GitHub.

---

## 1. Problem and goal

Commercial credit analysts monitor 30+ borrower facilities and investigate potential covenant exceptions every reporting cycle. A rules engine can flag that a reported ratio is below threshold, but the investigation that follows is unstructured: the analyst must find the effective covenant definition across a long credit agreement and its amendments/waivers, recompute the ratio on the right basis, explain any gap with the borrower's own calculation, and decide whether the evidence is sufficient to resolve, escalate, or request more information.

**CreditScout** is a decision-support agent for that investigation. Its principle: *a reasoning layer that decides what evidence to inspect next, and a calculation layer that never guesses.* The model reads, investigates, and judges; deterministic code does all arithmetic, thresholds and policy; a human credit analyst always approves or overrides, and overrides become memory for future cases.

**It never makes a credit decision.** It recommends; humans act.

### Success criteria (MVP)

| Metric | Target |
|---|---|
| False-resolve rate (recommends *resolve* when expected outcome is not resolve) | 0 |
| Calculation accuracy (DSCR matches independently computed expected value, 2 dp) | 100% |
| Outcome accuracy | ≥ 85% |
| Correct abstain/request on incomplete-evidence cases | ≥ 90% |
| Citation hit rate (expected key clause cited) | ≥ 90% |
| Groundedness (Azure AI Foundry, gpt-4.1 judge) | reported |
| Memory effect (avg steps, cold vs warm memory) | visible reduction |

### Users

- **Primary:** commercial credit analyst (bank / commercial lender, SMB and startup borrowers).
- **Governance:** Credit Risk Officer — represented as a policy configuration, not a separate user.
- **Out of scope:** relationship managers, borrowers, credit committee.

---

## 2. Scope

**In scope**
- One covenant: **DSCR**, tested quarterly on a trailing-twelve-month (TTM) basis.
- 6 synthetic facilities, each with: credit agreement (~15–20 pp text PDF), one amendment or waiver (2–3 pp), quarterly financials, borrower compliance certificate.
- Text-based PDFs ingested via n8n.
- Manual upload of documents; optional Gmail trigger for incoming compliance certificates.
- Investigation agent, deterministic DSCR calculator, guardrails, policy, casefile memory, analyst review, eval harness, analyst web UI with governance/eval page.

**Out of scope**
- Other covenants (leverage, fixed charge coverage, liquidity).
- Scanned/image PDFs (OCR); complex table extraction from audited statements (SpreadSense's domain).
- Auth, multi-user, roles, mobile layout, deployment (runs locally; n8n is on n8n Cloud).
- Editing facility terms in the UI.
- Any real bank data. All documents are synthetic.

---

## 3. Architecture

| Layer | Technology | Course tie-in |
|---|---|---|
| Orchestration (reasoning layer) | **n8n Cloud** AI Agent node, Anthropic Claude chat model | Wk 4 multi-agent (Lab 4.5) |
| Specialist tools | n8n AI Agent tool sub-agents + Code nodes | Wk 2/4 |
| Retrieval | **Supabase Vector Store** (pgvector), section-level chunks | Wk 2 RAG |
| Deterministic calculation | n8n **Code node** (JavaScript); identical source file in repo with unit tests | mentor: "calc tool" |
| Memory & records | **Supabase** Postgres | Wk 3–5 |
| Analyst UI | Vite + React app built with Claude Code, local | Lab 1.2 / 2.3.1 |
| Evaluation | Local eval runner + **Azure AI Foundry Evaluations** (JSONL upload) | Wk 3 Lab 3.2 |
| Optional | Gmail trigger; n8n MCP Server exposing the DSCR calculator | Wk 5 MCP |

**Production path (roadmap, not built):** orchestrator on Microsoft Foundry Agent Service inside the bank's Azure tenant; Postgres on Azure Database for PostgreSQL; documents from the bank's loan document system (e.g., nCino). Nothing in the MVP depends on Supabase-specific features (no Supabase auth, edge functions, or browser-side writes).

**Why n8n for the MVP:** fastest path the owner already knows, visual execution trace for the demo, editable by the owner, and n8n + Foundry evals is the course's own pairing (Lab 3.2). Trade-off accepted: less fine-grained loop control than hand-written code, compensated by post-agent guardrail and policy nodes and the agent node's iteration cap.

### Agentic vs deterministic boundary

| Responsibility | Owner |
|---|---|
| Flagging a potential exception (reported DSCR < threshold) | Code |
| Deciding what to inspect next | Model (orchestrator) |
| Reading agreement, amendments, waivers, certificate | Model |
| Mapping the DSCR definition into structured terms (add-backs, period, threshold, amendment precedence) | Model, schema-validated |
| All arithmetic, comparisons, rounding | Code |
| Forming and testing hypotheses for a gap | Model |
| Judging evidence sufficiency → recommendation | Model, bounded by guardrails + policy |
| Writing the cited explanation | Model |
| Guardrails, policy enforcement | Code |
| Final decision | Human analyst, always |

The investigation path must genuinely vary by case (see §4.3); this is what distinguishes the agent from a pipeline.

---

## 4. Workflows (n8n)

All workflows are exported as JSON into `n8n/` in the repo. The owner imports them into n8n Cloud and attaches credentials (Anthropic, Supabase, optionally Gmail).

### 4.1 Ingest

Trigger: webhook `POST /ingest` (multipart: PDF, `facility_id`, `doc_type`) — or the Gmail trigger (§4.5).

1. Insert `documents` row.
2. Extract from File (PDF → text).
3. Code: split text into section chunks using section headings (`§`, `Section`, `ARTICLE`); attach metadata `{facility_id, document_id, doc_type, section, doc_title}`.
4. Supabase Vector Store insert (embeddings model: whichever embeddings credential the owner has; OpenAI embeddings as in the labs).
5. If `doc_type = compliance_certificate`: run **Certificate check**:
   - Model extracts `{borrower_name, test_period_end, reported_dscr, required_dscr_stated}` into a fixed schema (validated; failure → `needs_filing`).
   - Code compares `reported_dscr` to the facility's threshold as stated on the certificate. Below → insert `exceptions` row (`status = new`). Otherwise → log "compliant, no action".
6. Respond with document id and, if created, exception id.

Note: page numbers are not preserved by PDF extraction; citations are by **document + section**.

### 4.2 Investigate

Trigger: webhook `POST /investigate` `{exception_id}`. Responds immediately with `casefile_id`; work continues asynchronously and is written to Supabase as it progresses.

1. Create `casefiles` row (`status = investigating`).
2. **Load memory:** facility's prior exceptions/casefiles; build an *exception profile* string (reported vs required DSCR, document types on file, industry); similarity search over past casefile summaries and review lessons; take top 3 lessons.
3. **CreditScout Orchestrator** (AI Agent node, Claude, max iterations from `policy.max_steps`). System prompt contains role, rules (never compute numbers, cite everything, abstain when unsupported, prohibited actions), the exception, and the memory lessons. Tools:

| Tool | Type | Purpose | Returns |
|---|---|---|---|
| `document_agent` | AI Agent tool + vector store (filtered to facility) | Retrieve clauses / facts | facts with `{citation, quote}` |
| `definition_agent` | AI Agent tool + vector store | Map DSCR definition + amendments into structured terms | `terms` JSON (schema below) with citations |
| `dscr_calculator` | Code node tool | Deterministic DSCR from `terms` + financial inputs | `{calc_id, components, dscr, threshold, pass, margin}`; logged to `calc_log` |
| `research_agent` | AI Agent tool + vector store | Investigate a gap: amendment, period mismatch, add-back, borrower calc error, our mapping error | findings with citations |
| `search_past_cases` | Supabase query tool | Agent-initiated memory search | matching lessons / casefile summaries |

   Every tool call appends a step `{n, tool, input_summary, output_summary, ts}` to `casefiles.trace` (for the live UI).
4. **Guardrail** (Code node) — §6.1.
5. **Policy** (Code node) — §6.2.
6. Update casefile: final fields, `status = pending_review` (or `failed`).

**`terms` schema** (definition_agent output):
```json
{
  "test_period": {"basis": "TTM", "period_end": "2026-06-30"},
  "threshold": {"min_dscr": 1.25, "citation": "CA §7.11"},
  "numerator": {
    "base": "Consolidated EBITDA",
    "addbacks": [{"name": "restructuring charges", "amount_source": "financials", "cap": 500000, "citation": "Amd 2 §3(a)"}],
    "deductions": ["unfinanced_capex", "cash_taxes"]
  },
  "denominator": {"components": ["scheduled_principal", "cash_interest"], "citation": "CA §1.01"},
  "effective_amendments": [{"doc": "Amendment No. 2", "effective": "2026-04-01", "citation": "Amd 2 §1"}]
}
```

**DSCR calculator contract** (pure function, no I/O except calc_log write in the n8n wrapper):
- Inputs: `terms` + `financials {ebitda, addback_amounts{}, unfinanced_capex, cash_taxes, scheduled_principal, cash_interest}`.
- Applies add-back caps, deductions; `dscr = numerator / denominator`, rounded half-up to 2 dp.
- Errors (never defaults): missing input, denominator ≤ 0, unknown component name → returns `{error}`; agent must treat as missing evidence.
- Returns `calc_id` (uuid), all intermediate components, `dscr`, `threshold`, `pass`, `margin = dscr − threshold`, `calculator_version`.

### 4.3 Expected investigation paths (agentic variation)

| Facility | Twist | Expected path | Outcome |
|---|---|---|---|
| F1 Harbor Logistics | Amendment No. 2 permits one-time restructuring add-back; reported 1.12 → actual 1.31 | definition → calc (fail) → research → finds Amd 2 → re-map terms → calc (pass) → resolve | **Resolve** (~6 steps) |
| F2 Pinecrest Dental | Certificate uses wrong test period | read certificate → period mismatch detected → request; no calc on bad inputs | **Request** corrected certificate (~2) |
| F3 Northgate Foods | Genuine breach, nothing explains it | definition → calc (fail) → research (nothing) → escalate | **Escalate** (~4) |
| F4 Alder Software | Certificate cites a waiver not in file | certificate → search waiver → not found → abstain | **Abstain / request waiver** (~3) |
| F5 Coastal Marine | Same pattern as F1 | memory lesson → check amendments first → calc (pass) → resolve | **Resolve** (~3, warm memory) |
| F6 Ridge Ag Supply | Borrower omitted a permitted add-back | calc → differs from reported → determine borrower error → resolve with note | **Resolve** with note (~4) |

Owner to validate realism of these twists from credit experience (open item).

### 4.4 Review

Trigger: webhook `POST /review` `{casefile_id, decision: approve|override|request_docs, reason?, corrected_outcome?, confirmed_tag?}`.

- `approve` → casefile `approved`; casefile summary embedded as a confirmed lesson.
- `override` → requires `reason`, `corrected_outcome`, `confirmed_tag` (model-suggested, analyst-confirmed); insert `reviews`; embed lesson text = analyst reason verbatim + tag + one-line case summary; casefile `overridden`.
- `request_docs` → casefile `awaiting_docs`; when a document is ingested for that facility, the UI offers "Re-run investigation".

### 4.5 Gmail trigger (optional, stretch)

Dedicated demo Gmail account (created by owner; never personal or work mail). On new email with PDF attachments: save attachments → model identifies borrower + test period from the certificate → code matches to `facilities` by borrower name with sender domain as cross-check → confident match runs Ingest; otherwise `needs_filing` queue. Never guesses the facility. Dropped without impact if OAuth or matching is unreliable.

---

## 5. Data model (Supabase Postgres + pgvector)

| Table | Key columns |
|---|---|
| `facilities` | `id`, `borrower_name`, `industry`, `sender_domain`, `created_at` |
| `documents` | `id`, `facility_id`, `doc_type` (agreement, amendment, waiver, compliance_certificate, financials), `title`, `effective_date`, `source` (upload, email), `created_at` |
| `doc_chunks` | `id`, `content`, `embedding`, `metadata` jsonb `{facility_id, document_id, doc_type, section, doc_title}` |
| `exceptions` | `id`, `facility_id`, `test_period_end`, `reported_dscr`, `required_dscr`, `status` (new, investigating, pending_review, closed, needs_filing), `created_at` |
| `casefiles` | `id`, `exception_id`, `status` (investigating, pending_review, approved, overridden, awaiting_docs, failed), `trace` jsonb, `terms` jsonb, `recommendation`, `explanation`, `claims` jsonb, `calc_ids` uuid[], `missing_evidence` jsonb, `suggested_tag`, `guardrail_notes` jsonb, `steps_count`, `summary`, `summary_embedding`, `run_id`, `created_at` |
| `calc_log` | `calc_id`, `casefile_id`, `inputs` jsonb, `outputs` jsonb, `calculator_version`, `created_at` |
| `reviews` | `id`, `casefile_id`, `decision`, `reason`, `corrected_outcome`, `pattern_tag`, `lesson_text`, `lesson_embedding`, `created_at` |
| `policy` | `key`, `value` jsonb, `updated_at` |
| `eval_runs` | `id`, `mode` (cold, warm), `metrics` jsonb, `created_at` |

Pattern tags (fixed list): `amendment_addback`, `period_mismatch`, `missing_waiver`, `borrower_calc_error`, `true_breach`, `other`.

`run_id` on casefiles separates eval runs from demo data so memory can be reset per eval pass.

---

## 6. Guardrails and policy

### 6.1 Casefile schema and guardrails

Orchestrator must return:
```
recommendation:     resolve | request | escalate | abstain
confidence_basis:   string
explanation:        string (≤150 words)
claims[]:           {text, citation, quote}
calculations[]:     {calc_id}
missing_evidence[]: string
suggested_tag:      pattern tag
```

Code guardrail checks, in order; every forced change is recorded in `guardrail_notes` and shown in the UI:

| Check | On failure |
|---|---|
| Output matches schema | one retry; then **abstain** ("malformed output") |
| Every number in `explanation`/`claims` matches a value in a `calc_log` output from this casefile, or a figure quoted verbatim in a cited chunk | **abstain** ("unverified figure") |
| Every claim's `quote` appears verbatim in a chunk of the cited document/section | claim removed; if recommendation depended on it → **abstain** |
| `resolve` requires ≥1 passing calc and cited effective terms | downgrade to **escalate** |
| Step cap reached | **abstain** ("investigation incomplete") |

### 6.2 Risk Officer policy (`policy` table, editable without code)

| Key | Default | Effect |
|---|---|---|
| `variance_tolerance` | 0.05 | If |our DSCR − reported DSCR| > tolerance, the gap must be explained by a cited finding before `resolve` |
| `escalate_if_breach_margin_over` | 0.15 | True breach deeper than this always escalates |
| `prohibited_actions` | waive covenant, amend terms, contact borrower | Any recommendation text proposing these → **escalate** with note |
| `max_steps` | 10 | Agent iteration cap |
| `require_human_review` | true (locked) | Displayed as locked in Governance page |

### 6.3 Errors

n8n, model, or Supabase failure → casefile `failed` with error message and a Retry action. A failure is never presented as a recommendation.

---

## 7. Analyst web UI

Vite + React (SpreadSense conventions), local. Reads Supabase for display (read-only anon key, RLS read policies); all writes go through n8n webhooks. Visual language matches the architecture diagram: dark navy, teal = model steps, amber = code steps ("computed by code · calc_id").

1. **Portfolio / exception queue** — table (borrower, period, reported vs required DSCR, status, "seen similar" badge); KPI strip (open exceptions, pending review, avg steps per case); Upload quarterly package; facility documents view.
2. **Investigation** — live step trace (poll `casefiles.trace` every 1s) and casefile placeholder.
3. **Casefile review** — recommendation badge, explanation, calc table, citation chips → side panel with exact clause text and highlighted quote, guardrail notices; actions Approve / Override (reason → confirm suggested tag → corrected outcome) / Request docs (upload).
4. **Governance & evals** — policy values (human review locked on); latest eval scoreboard (cold vs warm) from `eval_runs`.

Not included: login, multi-user, mobile.

---

## 8. Evaluation and testing

### 8.1 Labeled eval set

24 cases = 6 facilities × 4 variations (quarter, figures, documents present/missing). Each case: inputs (document set, certificate figures) and expected `{outcome, dscr (2 dp, computed independently in a spreadsheet), key_citation, pattern_tag}`. Claude drafts; **owner reviews and signs off every label** before they are called expert-validated.

### 8.2 Runner

`evals/run.mjs` (Node, same toolchain as the calculator tests): for each case → set up documents → POST `/investigate` → poll until terminal → score. Two passes: **cold** (memory cleared for the eval `run_id`) and **warm** (lessons from scripted analyst overrides loaded). Outputs: `results.csv`, `report.md`, `foundry.jsonl` (`query`, `response`, `context`, `ground_truth`) for upload to Azure AI Foundry Evaluations (groundedness, gpt-4.1 judge), and an `eval_runs` row for the in-app scoreboard.

### 8.3 Engineering tests

- DSCR calculator unit tests: all facility expected values; caps; deductions; rounding; errors on missing inputs, zero/negative denominator, unknown component.
- Sync check: calculator source in exported n8n workflow JSON is byte-identical to `calc/dscr.js`.
- Guardrail unit tests with fabricated agent outputs (untraceable number, fake quote, resolve without passing calc) → must force the correct downgrade.
- Workflow JSON exported to repo after every change.

---

## 9. Synthetic data

Generated by script into `data/facilities/F1..F6/` as text-based PDFs with realistic structure (definitions article, financial covenants article with DSCR in §7.11-style section, events of default, notices; amendment with effective date and amended definitions; compliance certificate in a standard borrower form). Clearly marked "SYNTHETIC — FOR DEMONSTRATION". Borrower names fictional. Expected DSCR values computed in a separate spreadsheet (not by the calculator under test).

---

## 10. Demo (≤ 3:00 video)

| Time | Content |
|---|---|
| 0:00–0:40 | Problem (owner's credit-systems experience), who, why now, solution, moat (validated covenant specs, deterministic calc with citations, eval harness, lender-specific memory) |
| 0:40–2:10 | Live: certificate arrives (upload or email) → F1 flagged → live trace → cited casefile, click citation → override with reason → F5 resolves in ~3 steps with "seen similar" → split view F1 vs F5 traces |
| 2:10–2:35 | Trust: scoreboard — 0 false resolves, 100% calc accuracy, outcome accuracy, abstain rate, Foundry groundedness, memory effect |
| 2:35–3:00 | Pricing (per-facility monthly, analyst-hours ROI), GTM (mid-market lenders), roadmap (Foundry in bank tenant, more covenants, SpreadSense → CreditScout integration, email intake) |

Backup: a recorded run is the deliverable itself; record by Wed Oct 7, submit by Thu Oct 8.

---

## 11. Schedule

| Day | Work |
|---|---|
| Thu Oct 1 | Spec + plan approved; Supabase schema; synthetic data generator started |
| Fri Oct 2 | Synthetic PDFs + expected values; DSCR calculator + tests |
| Sat Oct 3 | Ingest + Investigate workflows (tools, orchestrator) |
| Sun Oct 4 | Guardrail, policy, Review workflow, memory |
| Mon Oct 5 | UI; 9am mentor office hours with a working build; optional Gmail trigger |
| Tue Oct 6 | Eval set sign-off, runner, Foundry run; deck; mentor session |
| Wed Oct 7 | Record video |
| Thu Oct 8 | Re-record if needed; submit; README/GitHub prep (push only with owner approval) |

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Generated n8n JSON needs node-version fixes | Build and test one workflow at a time; owner imports, Claude reads executions and fixes |
| Agent path too uniform (looks like a pipeline) | Facility twists designed to force different paths; F1 vs F5 trace comparison in demo |
| Model hallucinated figures or quotes | Code guardrails force abstain; tested with fabricated outputs |
| Eval run slow or flaky | 24 cases, retries per case, runner resumable |
| Time | Gmail trigger and MCP are stretch; cut order: MCP → Gmail → Foundry upload (keep local metrics) |
| Credentials / privacy | Owner enters all keys; dedicated demo Gmail only; synthetic data only |

---

## 13. Decisions log

- New standalone repo `~/Documents/projects/creditscout`; unrelated to atomic_helper.
- n8n Cloud orchestrator over Azure Foundry agent (time, owner familiarity, course pairing); Foundry used for evals; Foundry Agent Service is the stated production path.
- Claude as agent model (aligned with Anthropic certification track).
- Supabase (plain Postgres + pgvector) for data, vectors, memory.
- Text PDFs in scope; OCR out. Citations by document + section.
- Pattern tag: model suggests, analyst confirms.
- Policy defaults as in §6.2.
- Governance & eval page lives in the app.
- Claude writes all code and workflow JSON; owner owns spec, policy, twist realism, eval labels, pitch, credentials.
- GitHub publication later, only with owner approval.

## 14. Open items for owner

1. Validate realism of the six facility twists (§4.3).
2. Review and sign off the 24 eval labels (§8.1) once drafted.
3. Confirm Supabase project to use (new `creditscout` project recommended) and n8n Cloud plan supports the needed nodes.
4. Anthropic API key available for n8n; embeddings credential (OpenAI as in labs).
