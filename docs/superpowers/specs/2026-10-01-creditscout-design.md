# CreditScout — Design Spec

**Date:** 2026-10-01
**Owner:** Arun Rajendiran (product) · Claude Code (engineering)
**Status:** Current — amended 2026-10-05 (orchestration, deployment, end-to-end monitoring)
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
- Text-based PDFs ingested via the application.
- **Covenant setup:** the agent maps the agreement + amendments into executable terms, **a human analyst approves them**, and approved terms are versioned and effective-dated.
- **Independent quarterly testing of every borrower** — CreditScout computes the DSCR itself from approved terms and the financials. The borrower's reported figure is reconciled against ours, not used as the trigger.
- Manual upload of documents; optional Gmail trigger for incoming compliance certificates.
- Investigation agent, deterministic DSCR calculator, guardrails, policy, casefile memory, analyst review, eval harness, analyst web UI with governance/eval page.

**Out of scope**
- Other covenants (leverage, fixed charge coverage, liquidity).
- Scanned/image PDFs (OCR); complex table extraction from audited statements (SpreadSense's domain).
- Auth, multi-user, roles, mobile layout. **Deployment is now in scope** — the app is deployed to Vercel.
- Editing facility terms in the UI.
- Any real bank data. All documents are synthetic.

---

## 3. Architecture

| Layer | Technology | Course tie-in |
|---|---|---|
| Orchestration (reasoning layer) | **Azure AI Foundry Agent Service**, Connected Agents, `gpt-5-mini` | Wk 4 multi-agent · Wk 5 lab |
| Specialist sub-agents | Foundry **connected agents** (`document_agent`, `definition_agent`, `research_agent`), `gpt-5-mini` | Wk 2/4 |
| Application + API | **Next.js (App Router) on Vercel** — screens, analyst routes, and the OpenAPI tool endpoints the agent calls | Wk 5 lab |
| Retrieval | **Supabase Vector Store** (pgvector), section-level chunks | Wk 2 RAG |
| Deterministic calculation | `calc/dscr.js`, zero-dependency, imported by the app and exposed to the agent as an OpenAPI tool | mentor: "calc tool" |
| Memory & records | **Supabase** Postgres | Wk 3–5 |
| Analyst UI | **Next.js + React on Vercel**, design system in `docs/design.md` | Lab 1.2 / 2.3.1 / Wk 5 |
| Evaluation | Local eval runner + **Azure AI Foundry Evaluations** (JSONL upload) | Wk 3 Lab 3.2 |
| Optional | Gmail intake as a scheduled route; MCP server exposing the DSCR calculator | Wk 5 MCP |

**Production path:** the orchestrator now **runs on** Microsoft Foundry Agent Service — what remains for production is moving it inside the bank's own Azure tenant; Postgres on Azure Database for PostgreSQL; documents from the bank's loan document system (e.g., nCino). Nothing in the MVP depends on Supabase-specific features (no Supabase auth, edge functions, or browser-side writes).

**Why Foundry Agent Service (amended 2026-10-05):** it runs the loop natively with Connected Agents, so the orchestrator-to-specialist delegation is visible and traceable in the Foundry portal — which is both the course's week-5 path and a stated learning objective. It also closes the unresolved n8n Cloud licensing question, removes the node-version and byte-identical-copy risks, and makes §3's production path the thing actually built rather than a roadmap slide. Full reasoning: `docs/engineering/engineering-doc.md`. Trade-off accepted: Connected Agents is a preview feature; the fallback is demoting the three specialists to plain OpenAPI tools, which changes nothing else.

### Agentic vs deterministic boundary

| Responsibility | Owner |
|---|---|
| Computing the DSCR independently each quarter, for every borrower | **Code** |
| Flagging an exception (**our** DSCR < threshold) | **Code** |
| Approving the executable covenant terms before they govern any test | **Human analyst, always** |
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

## 4. Workflows

Implemented as Next.js route handlers plus Foundry agent definitions. Agent definitions live in `n8n/` no longer; see `docs/engineering/implementation-specs.md` for the file-by-file blueprint.

### 4.1 Ingest

Trigger: webhook `POST /ingest` (multipart: PDF, `facility_id`, `doc_type`) — or the Gmail trigger (§4.5).

1. Insert `documents` row.
2. Extract from File (PDF → text).
3. Code: split text into section chunks using section headings (`§`, `Section`, `ARTICLE`); attach metadata `{facility_id, document_id, doc_type, section, doc_title}`.
4. Supabase Vector Store insert (embeddings model: whichever embeddings credential the owner has; OpenAI embeddings as in the labs).
5. If `doc_type = compliance_certificate`: extract `{borrower_name, test_period_end, reported_dscr, required_dscr_stated}` into a fixed schema (validated; failure → `needs_filing`). **This figure is stored as evidence. It does not decide anything** — see §4.1b.
6. Respond with document id and, if created, exception id.

Note: page numbers are not preserved by PDF extraction; citations are by **document + section**.

### 4.1a Covenant setup (four-eyes)

Runs once per facility, and again whenever an amendment arrives.

1. `definition_agent` reads the definitions article, amendments and waivers, and proposes executable `terms` — **every line carrying a citation and a verbatim quote**.
2. Terms are written to `covenant_terms` with `status = proposed`.
3. **The analyst reviews each term beside its source clause and approves.** Approval records `approved_by` and `approved_at`.
4. Approved terms are **versioned and effective-dated**. An amendment creates `version + 1` and supersedes the previous row; it never overwrites, because a Q1 test must remain reproducible against the terms in force in Q1.
5. **Only `status = approved` terms may govern a test.**

Maker-checker (the four-eyes principle) is the standard control for covenant boarding, and a setup error here would silently corrupt every future test for that borrower.

### 4.1b Quarterly test — every borrower, every quarter

1. Load the **approved** terms in force for the test period. No approved terms → refuse to run.
2. Read the six financial figures from the facility's financials document, each quoted and cited.
3. **Code computes the DSCR** and compares it to the threshold. Three outcomes:

| Our number | Borrower's number | Result |
|---|---|---|
| Passes | Agrees within `variance_tolerance` | Log compliant, no action |
| Passes | **Overstates** — theirs higher, beyond tolerance | **Log the variance. No investigation.** Their arithmetic is off; the conclusion stands. |
| Passes | **Reports a failure** | **Investigate.** A borrower self-reporting a breach is significant — they may know something the documents do not yet show. |
| **Fails** | Anything | **Exception → Investigate (§4.2)** |

4. Every test writes a `tests` row and a `calc_log` row, whether or not it fails.

A missing or uncitable financial input produces `calc_error` and a NULL DSCR — **never a zero and never an exception**.

**Why this changed (2026-10-05):** the original design read the borrower's reported DSCR and investigated only when *that* figure was below threshold. A borrower whose arithmetic was wrong in their own favour was therefore invisible. CreditScout now computes independently for every borrower, and the reported figure becomes evidence to reconcile against.

### 4.2 Investigate

Trigger: webhook `POST /investigate` `{exception_id}`. Responds immediately with `casefile_id`; work continues asynchronously and is written to Supabase as it progresses.

1. Create `casefiles` row (`status = investigating`).
2. **Load memory:** facility's prior exceptions/casefiles; build an *exception profile* string (reported vs required DSCR, document types on file, industry); similarity search over past casefile summaries and review lessons; take top 3 lessons.
3. **CreditScout Orchestrator** (Foundry Agent Service, `gpt-5-mini`, step cap from `policy.max_steps`). The three specialists are Foundry **connected agents** (`document_agent`, `definition_agent`, `research_agent`), also `gpt-5-mini` — they read and quote rather than judge, and every quote they return is verified by the §6.1 guardrail. System prompt contains role, rules (never compute numbers, cite everything, abstain when unsupported, prohibited actions), the exception, and the memory lessons. Tools:

| Tool | Type | Purpose | Returns |
|---|---|---|---|
| `document_agent` | AI Agent tool + vector store (filtered to facility) | Retrieve clauses / facts | facts with `{citation, quote}` |
| `definition_agent` | AI Agent tool + vector store | Map DSCR definition + amendments into structured terms | `terms` JSON (schema below) with citations |
| `dscr_calculator` | Code node tool | Deterministic DSCR from `terms` + financial inputs | `{calc_id, components, dscr, threshold, pass, margin}`; logged to `calc_log` |
| `research_agent` | AI Agent tool + vector store | Investigate a gap: amendment, period mismatch, add-back, borrower calc error, our mapping error | findings with citations |
| `search_past_cases` | Supabase query tool | Agent-initiated memory search | matching lessons / casefile summaries |

   Every tool call appends a step `{n, tool, input_summary, output_summary, ts}` to `casefiles.trace` (for the live UI).

   **Agent configuration:** the calculator, document search and past-case search are **OpenAPI 3.0 tools served by the application** and authenticated with a shared header key. Forced tool choice stays off. The step cap is read from `policy.max_steps` on every sync, so the Risk Officer's lever is live rather than baked into a deployment.
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
- **Source of `financials`:** the agent reads these six figures from the facility's financials document, where they appear as plain labeled lines (§9), and passes them in. Each figure must be quoted verbatim from a cited chunk, so the §6.1 guardrail can verify it. The calculator itself does no extraction and never infers a missing figure — a figure the agent cannot cite is missing evidence.
- Applies add-back caps, deductions; `dscr = numerator / denominator`, rounded half-up to 2 dp.
- Errors (never defaults): missing input, denominator ≤ 0, unknown component name → returns `{error}`; agent must treat as missing evidence.
- Returns `calc_id` (uuid), all intermediate components, `dscr`, `threshold`, `pass`, `margin = dscr − threshold`, `calculator_version`.

### 4.3 Expected investigation paths (agentic variation)

| Facility | Period | Borrower reports | **We compute** | Mechanism | Expected path | Outcome |
|---|---|---|---|---|---|---|
| **F1 Harbor Logistics** | Q2 2026 | 1.12 | **1.12** (agree, both fail) | Approved terms are **v1**; Amendment No. 2 (effective 2026-04-01) is **on file but not yet boarded** | terms → calc (fail) → research → spots the unboarded amendment → re-map → calc (pass) | **Resolve + re-board as v2** (~6 steps) |
| **F3 Northgate Foods** | Q2 2026 | **1.31 — compliant** | **1.08 — breach** | Borrower took an add-back with **no basis** in the agreement or any amendment. An unexecuted waiver *request* letter is on file, dated after the period, unsigned by the lender. | calc (fail) → research → finds the request letter → determines a requested waiver is not a granted waiver | **Escalate** (~4 steps) |
| **F5 Coastal Marine** | Q4 2025 | 1.41 | 1.41 | Agree | code only, no agent | **Compliant, no action** |
| **F5 Coastal Marine** | Q1 2026 | **1.38** | **1.29** | Borrower took the full $900k add-back; the amendment **caps it at $500k**. Both still clear 1.25. | code only, no agent | **Variance logged, not investigated** |
| **F5 Coastal Marine** | Q2 2026 | 1.30 | 1.12 | Same unboarded-amendment pattern as F1 | memory lesson → check amendments first → calc (pass) | **Resolve in ~3 steps** (warm memory) |

**F3 is the headline case.** The borrower reports *compliant*; nobody would have
investigated. We compute a breach because we applied their actual covenant. This
is the case the exception-triage design structurally could not reach.

**Covenant boarding lag is the F1/F5 mechanism, and it is realistic** — setup
accuracy is a recurring loan-review audit finding, which is also why §4.1a
requires four-eyes approval.

Facilities F2, F4 and F6 are deferred to the post-MVP backlog
(`docs/parking-lot.md` §4.1); F2 and F4 exercise `request` and `abstain` and are
first to restore.

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
| `covenant_terms` | `id`, `facility_id`, `version`, `effective_from`, `effective_to`, `terms` jsonb, `source_citations` jsonb, `status` (proposed, approved, superseded), `approved_by`, `approved_at`, `created_at` |
| `tests` | `id`, `facility_id`, `covenant_terms_id`, `test_period_end`, `computed_dscr`, `reported_dscr`, `threshold`, `passed`, `variance`, `variance_flagged`, `calc_id`, `calc_error`, `created_at` |
| `exceptions` | `id`, `facility_id`, `test_id`, `test_period_end`, `reported_dscr`, `required_dscr`, `status` (new, investigating, pending_review, closed, needs_filing), `created_at` |
| `casefiles` | `id`, `exception_id`, `status` (investigating, pending_review, approved, overridden, awaiting_docs, failed), `trace` jsonb, `terms` jsonb, `recommendation`, `explanation`, `claims` jsonb, `calc_ids` uuid[], `missing_evidence` jsonb, `suggested_tag`, `guardrail_notes` jsonb, `steps_count`, `summary`, `summary_embedding`, `run_id`, `foundry_thread_id`, `foundry_run_id`, `last_step_at`, `created_at` |
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
| `max_steps` | 8 | Agent iteration cap. Expected paths (§4.3) run 2–6 steps, so 8 leaves headroom while capping runaway cases. |
| `require_human_review` | true (locked) | Displayed as locked in Governance page |

### 6.3 Errors

n8n, model, or Supabase failure → casefile `failed` with error message and a Retry action. A failure is never presented as a recommendation.

---

## 7. Analyst web UI

**Next.js (App Router) + React, deployed to Vercel.** Reads Supabase directly for display (read-only anon key, RLS read policies); all writes go through the application's API routes. The design system is `docs/design.md`. Visual language matches the architecture diagram: dark navy, teal = model steps, amber = code steps ("computed by code · calc_id").

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

`evals/run.mjs` (Node, same toolchain as the calculator tests): for each case → set up documents → POST `/investigate` → poll until terminal → score. Two passes: **cold** (memory cleared for the eval `run_id`) and **warm** (lessons from scripted analyst overrides loaded). During development the runner is used against a **6-case subset** (one per facility) — enough to catch regressions; all 24 cases run twice only when producing reportable numbers. Outputs: `results.csv`, `report.md`, `foundry.jsonl` (`query`, `response`, `context`, `ground_truth`) for upload to Azure AI Foundry Evaluations (groundedness, gpt-4.1 judge), and an `eval_runs` row for the in-app scoreboard.

### 8.3 Engineering tests

- DSCR calculator unit tests: all facility expected values; caps; deductions; rounding; errors on missing inputs, zero/negative denominator, unknown component.
- Guardrail unit tests with fabricated agent outputs (untraceable number, fake quote, resolve without passing calc) → must force the correct downgrade.
- Foundry agent definitions and the OpenAPI tool spec committed to the repo after every change.

---

## 9. Synthetic data

Generated by script into `data/facilities/F1..F6/` as text-based PDFs with realistic structure (definitions article, financial covenants article with DSCR in §7.11-style section, events of default, notices; amendment with effective date and amended definitions; compliance certificate in a standard borrower form). Clearly marked "SYNTHETIC — FOR DEMONSTRATION". Borrower names fictional. The financials document states each of the six calculator inputs as its own labeled line (e.g. `Consolidated EBITDA: 4,250,000`), so the agent can read and cite them without table extraction — this is what keeps statement extraction out of scope (§2) while still supplying §4.2. Expected DSCR values computed in a separate spreadsheet **by the owner** (not by the calculator under test, and not by Claude) — Claude supplies a template listing each case's covenant terms and the six financial inputs; the owner fills in the expected DSCR and signs it off. This keeps the test oracle independent of both the implementation and its author.

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
| Connected Agents is a preview feature | Fallback: demote the three specialists to plain OpenAPI tools on the orchestrator. Same behaviour, no preview dependency. |
| Agent path too uniform (looks like a pipeline) | Facility twists designed to force different paths; F1 vs F5 trace comparison in demo |
| Model hallucinated figures or quotes | Code guardrails force abstain; tested with fabricated outputs |
| Agent tool endpoints are publicly reachable | Shared header key on every `/api/tools/*` route; `search-documents` filters by `facility_id` inside the database function so a caller cannot omit it |
| Covenant terms approved with an error corrupt every later test | Four-eyes approval (§4.1a); terms versioned and effective-dated so a correction supersedes rather than overwrites |
| Eval run slow or flaky | 24 cases, retries per case, runner resumable; 6-case subset during development |
| Time | Gmail trigger and MCP are stretch; cut order: MCP → Gmail → Foundry upload (keep local metrics) |
| Credentials / privacy | Owner enters all keys; dedicated demo Gmail only; synthetic data only |

---

## 13. Decisions log

- New standalone repo `~/Documents/projects/creditscout`; unrelated to atomic_helper.
- ~~n8n Cloud orchestrator over Azure Foundry agent~~ — **reversed 2026-10-05.** Azure AI Foundry Agent Service runs the loop with Connected Agents; Foundry also provides traces and evals; the app and its tool endpoints are Next.js on Vercel. Reasoning in `docs/engineering/engineering-doc.md`.
- **End-to-end covenant monitoring, not exception triage (2026-10-05).** CreditScout computes every covenant test itself from human-approved terms; the borrower's reported figure is evidence, not the trigger.
- **Covenant terms require analyst approval** (four-eyes) and are versioned and effective-dated.
- **A variance between our number and the borrower's, where both clear the threshold, is logged and not investigated.**
- **Models (2026-10-05, amended after a live spike):** orchestrator `gpt-4.1-mini`, specialists `gpt-5-mini`. The orchestrator model is **forced by the platform** — `gpt-5-mini` cannot carry `connected_agent` tools on the Assistants API. Both are already deployed, so there is still no new billable resource. Original owner decision was `gpt-5-mini` throughout. Already deployed, so no new billable resource, and one prompt surface to tune. The guardrail is code, so a weaker model cannot produce an unverifiable number. Whether a *stronger* orchestrator buys enough accuracy to justify its cost is the post-demo experiment — a negative result is the more interesting finding.
- Supabase (plain Postgres + pgvector) for data, vectors, memory.
- Text PDFs in scope; OCR out. Citations by document + section.
- Pattern tag: model suggests, analyst confirms.
- Policy defaults as in §6.2.
- Governance & eval page lives in the app.
- Financial figures are printed as labeled lines in the synthetic financials document and read + cited by the agent; the calculator never extracts or infers them.
- Claude writes all code and workflow JSON; owner owns spec, policy, twist realism, eval labels, pitch, credentials.
- Supabase: reuse existing project `rngsejqplndmygrozasc` rather than create a new one (free-plan project cap); cloud-hosted, never local, because n8n Cloud cannot reach localhost.
- Private GitHub repo `arunr-mib/creditscout` created 2026-10-02 for version control; making it public remains a separate decision requiring owner approval.

## 14. Open items for owner

1. Validate realism of the six facility twists (§4.3).
2. Review and sign off the 24 eval labels (§8.1) once drafted.
3. ~~Confirm Supabase project to use~~ — **resolved 2026-10-02:** reusing existing Supabase project `rngsejqplndmygrozasc` (region ca-central-1, org "House of Credit"); free plan caps the org at 2 projects, so no new project was created. `vector` 0.8.2 enabled. ~~Still open: confirm the n8n Cloud plan…~~ — **closed 2026-10-05**, n8n is no longer used.
4. ~~Anthropic API key available for n8n~~ — **closed.** Azure credentials already verified; `text-embedding-3-small` deployed at 1536 dimensions.
