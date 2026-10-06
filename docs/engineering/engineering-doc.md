# CreditScout — Engineering Document (HLD)

**Date:** 2026-10-05
**Status:** Proposal for owner review — the Step-4 Review gate
**Author:** Claude Code (engineering)
**Owner:** Arun Rajendiran (product, credit domain, all sign-offs)

**Input:** `docs/superpowers/specs/2026-10-01-creditscout-design.md` (the spec — owner-owned, source of truth)
**Output:** this document, then `docs/spec.md` (LLD)
**Method:** spec-driven development, Week 5 Cohort 10 lab workflow —
PRD → Design → **HLD → Review** → Frontend Setup → LLD → Review → Implement → Deploy → Maintain

> This document proposes changes to the spec's §3 and §4. It does not apply
> them. §11 lists the exact edits for the owner to approve or reject.

---

## 1. What we are building, in one page

CreditScout is an MVP for a 6-week cohort course, not a production system. Two
goals drive every choice below, and where they conflict, the second wins:

1. **Demonstrate the product thesis** — a reasoning layer decides what evidence
   to inspect; a calculation layer never guesses; a human always approves.
2. **Be a good vehicle for learning how multi-agent orchestration actually
   works** — the owner needs to *see* an orchestrator agent delegate to
   specialist agents and watch the workflow run.

The owner's decision, 2026-10-05: **Azure AI Foundry Agent Service runs the
agent loop.** Model choice is open to anything available on Azure.

### The shape of the system

```
          Analyst (browser)
                 │
   ┌─────────────▼──────────────────────────┐
   │  Next.js app on Vercel                 │
   │  4 analyst screens + API routes        │
   └──┬──────────────────────────────┬──────┘
      │ start investigation          │ tool calls come back in
      ▼                              │
   ┌─────────────────────────────────┴──────┐
   │  Azure AI Foundry Agent Service        │   ← the loop runs HERE
   │                                         │
   │   CreditScout Orchestrator (main)       │
   │     ├─ connected agent: document_agent  │
   │     ├─ connected agent: definition_agent│
   │     ├─ connected agent: research_agent  │
   │     ├─ tool: dscr_calculator      ──────┼──┐
   │     ├─ tool: search_documents     ──────┼──┤ OpenAPI calls
   │     └─ tool: search_past_cases    ──────┼──┘ back to Vercel
   └─────────────────┬───────────────────────┘
                     │ run completes
                     ▼
   ┌────────────────────────────────────────┐
   │  Guardrail + Policy (our code, Vercel) │   ← can force `abstain`
   └─────────────────┬──────────────────────┘
                     ▼
   ┌────────────────────────────────────────┐
   │  Supabase — casefiles, calc_log,       │
   │  documents, vectors, memory, policy    │
   └────────────────────────────────────────┘
```

**Rule — a mid-investigation recomputation never amends the `tests` row.** The
test records what the *approved* terms produced; that is the audit fact. A
recomputation on re-mapped terms is evidence inside the casefile. Re-boarding
creates `covenant_terms` v2, and re-running the test then produces a **new**
`tests` row.

**Why this satisfies both goals.** Foundry runs the loop, so the owner sees the
orchestrator delegate to three specialist agents and can replay every step in
the Foundry portal — that is the learning goal, met natively. But the calculator
and the guardrails stay in our own code, called as tools and run after the
agent respectively, so the model still never produces a number and code still
has the last word before a human sees anything. The thesis survives intact.

---

## 2. The tech stack

| Layer | Choice | Notes |
|---|---|---|
| **Frontend** | Next.js (App Router), React, TypeScript | Four analyst screens from spec §7 |
| **Database & Auth** | Supabase — Postgres + pgvector | Auth out of scope for MVP; available when wanted |
| **AI** | Azure OpenAI models (see §3) | Orchestrator + 3 specialist agents + eval judge |
| **Deployment** | **Vercel** | Owner already has an account and projects |
| **Build tool** | Next.js built-in (Turbopack) | Replaces Vite; no separate build tool |
| **AI Agent Platform** | **Azure AI Foundry Agent Service** | Runs the loop, Connected Agents, traces |
| Language / runtime | TypeScript, Node 24 | |
| Testing | `node:test` + `node:assert/strict` | No test framework, per project constraints |
| Deterministic core | Plain JavaScript, zero dependencies | `calc/dscr.js`, `guardrails/*.js` |
| Evaluation | `evals/run.mjs` + Foundry Evaluations | Spec §8, unchanged |

Everything here except the AI rows is unchanged from the previous proposal.

---

## 3. Models

Verified live against the owner's Azure account on 2026-10-05.

**Already deployed** in `contractreviewagent-resource` (resource group
`AI_Learning`, region `eastus2`):

| Deployment | Model | SKU | Capacity |
|---|---|---|---|
| `gpt-5-mini` | gpt-5-mini (2025-08-07) | GlobalStandard | 50 |
| `gpt-4.1-mini` | gpt-4.1-mini (2025-04-14) | GlobalStandard | 100 |
| `text-embedding-3-small` | text-embedding-3-small v1 | Standard | 120 |

**Also available to deploy in `eastus2`** — the catalog is wide: the full GPT-5.x
and GPT-6 families, `claude-opus-5-5`, `claude-sonnet-5-5`, Grok, Llama, Mistral,
DeepSeek, Cohere. Model choice costs no new infrastructure, only a deployment.

### Recommended assignment

| Role | Model | Why |
|---|---|---|
| **Orchestrator** | **`gpt-4.1-mini`** | **Forced by a platform constraint, verified live 2026-10-05.** `gpt-5-mini` **cannot** be used with `connected_agent` tools — the Assistants API rejects it with *"This model only supports Responses API compatible tools."* Connected Agents is how the orchestrator delegates to the three specialists, so the orchestrator must run a compatible model. `gpt-4.1-mini` works and is **already deployed**, so this is still no new billable resource. |
| `document_agent`, `definition_agent`, `research_agent` | **`gpt-5-mini`** | Specialists hold no `connected_agent` tool, so the constraint does not apply. They read and quote rather than judge, and every quote is code-verified. Owner's choice preserved. |
| Eval judge (§8.2) | `gpt-4.1` | Deliberately a different family/generation from the agents, so the judge is not grading its own kind. |
| Embeddings | `text-embedding-3-small` | **1536 dimensions** — the schema's `vector(1536)` columns depend on this number. Already deployed. |

**These are starting points, not commitments.** Each is a deployment name in
config; changing one is a config edit plus an eval run, which is exactly the
kind of comparison worth reporting in the pitch.

**On dropping Claude.** The spec's §13 reasoning for Claude was the Anthropic
certification track and the orchestrator's judgement quality. The owner has
decided model choice is open. Worth knowing: `claude-opus-5-5` and
`claude-sonnet-5-5` *are* available in `eastus2` at standard rates, so this
stays reversible — and remains a good independent eval judge if a non-OpenAI
grader is ever wanted. Nothing in the design depends on which family wins.

**The open measurement in handoff §4.4 survives and improves.** "Can the cheaper
model orchestrate without hurting accuracy?" is now a one-line deployment-name
change plus an eval run. If a mini model holds accuracy, that halves cost *and*
produces a model-selection finding — a strong portfolio artifact most people
never generate.

---

## 4. How the agents are wired

### 4.1 Connected Agents — the multi-agent pattern

Foundry's **Connected Agents** lets a main agent delegate to specialist agents in
natural language, with no router to hand-write. That maps onto spec §4.2 exactly:

| Spec §4.2 tool | Becomes | Job |
|---|---|---|
| `document_agent` | Connected agent | Retrieve clauses and facts; return `{citation, quote}` |
| `definition_agent` | Connected agent | Map the DSCR definition + amendments into the `terms` JSON |
| `research_agent` | Connected agent | Investigate a gap: amendment, period mismatch, add-back, borrower error, our mapping error |
| `dscr_calculator` | OpenAPI tool → Vercel | Deterministic calculation. **Never a model.** |
| `search_past_cases` | OpenAPI tool → Vercel | Memory search over past lessons |

Plus one tool the sub-agents need:

| Tool | Type | Job |
|---|---|---|
| `search_documents` | OpenAPI tool → Vercel | Facility-filtered vector search over `doc_chunks` in Supabase |

**This is the learning payoff.** The Foundry portal shows the orchestrator
deciding, delegating to a named specialist, receiving its answer, and choosing
what to do next — the thing the owner wants to watch. It is genuinely a
multi-agent system, not a pipeline with a model in it.

### 4.2 How tools reach our code

Foundry agents call **OpenAPI 3.0 specified tools** over HTTP. Our Next.js app
on Vercel publishes those endpoints, so there is one codebase and no Azure
Functions to maintain:

```
Foundry agent ──HTTPS + API key──▶ Vercel /api/tools/dscr-calculator
                                        └─▶ imports calc/dscr.js  (pure, zero-dep)
                                        └─▶ writes calc_log row
```

Same shape for `search_documents` and `search_past_cases`, which read Supabase.

This is the detail that keeps the product thesis true under Option B: **the
model can ask for a calculation, but it cannot perform one.** The number comes
back from our code with a `calc_id`, and the guardrail later checks every figure
in the explanation against that log.

### 4.3 Where the guardrails run

Unchanged in logic, and deliberately **outside** the agent. When a Foundry run
completes, our code — not the model — runs spec §6.1's five ordered checks and
§6.2's policy levers before the casefile ever reaches `pending_review`.

The single most important behaviour in the system is a guardrail property, and
nothing about Foundry changes it:

> A number in the explanation that came from a **verbatim quote** rather than a
> calculation **must be allowed**. "The covenant requires 1.25x" is legitimate.
> A guardrail that accepts only calculated numbers abstains on every well-formed
> explanation — the zero-false-resolve metric would read perfect while the
> product did nothing. Compare numbers after normalisation, never as text:
> `1,250,000` ≡ `1250000`, `1.25` ≡ `1.25x`, `$4.25m` ≡ `4250000`.

Plan 1 Task 4 owns this, with tests.

---

## 5. How an investigation runs

1. Analyst clicks **Investigate**. The browser calls `POST /api/investigate`.
2. Vercel creates the `casefiles` row and assembles the investigation context,
   then creates a Foundry **thread**, starts a **run**, and stores
   `foundry_thread_id` / `foundry_run_id` on the casefile.

   **The context must contain all four of these.** The first two were already
   specified; the last two are required for the agent to detect a covenant
   boarding lag, which is F1's and F5's entire path:

   | Loaded | Why |
   |---|---|
   | The exception, with our number and the borrower's | The thing being investigated |
   | Top 3 memory lessons for this facility | Warm-memory speed-up |
   | **The approved `covenant_terms` version in force**, with its `effective_from` | The agent must know what it was tested against |
   | **The document inventory** — every document on file with `doc_type` and `effective_date` | Without it the agent cannot notice that an amendment exists which the approved terms do not reflect |
3. It returns `{casefile_id}` **immediately** — as spec §4.2 requires.
4. Foundry runs the loop: the orchestrator delegates to specialists and calls our
   tools. Tool calls arrive at Vercel as ordinary HTTPS requests.
5. Vercel polls the run and mirrors each completed step into `casefiles.trace`,
   so the live UI trace (spec §7.2) and the Foundry portal show the same work.
6. On completion, guardrail → policy → `status = pending_review`.
7. The analyst approves or overrides. An override becomes a lesson in memory.

**This fits Vercel's serverless model cleanly.** No request has to stay open
while the agent thinks — Foundry holds the long-running work, and our side is
only short reads and writes. The duration-ceiling problem from the previous
proposal disappears.

**Failure is never presented as a result** (spec §6.3). A failed or abandoned run
leaves the casefile `failed` with a Retry action, never a half-formed
recommendation.

---

## 6. Data models

Eleven tables. Two are **new** and exist only because of the end-to-end change —
`covenant_terms` (Flow A) and `tests` (Flow B). Everything else is spec §5.

All ids are `uuid` with `default gen_random_uuid()` unless stated. All timestamps
are `timestamptz default now()`.

### 6.1 `facilities` — the borrower

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `borrower_name` | text NOT NULL | Fictional. Used for certificate matching. |
| `industry` | text | |
| `sender_domain` | text | Cross-check for the optional email intake |
| `created_at` | timestamptz | |

### 6.2 `documents` — what was uploaded

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `facility_id` | uuid FK → `facilities` | ON DELETE CASCADE |
| `doc_type` | text CHECK | `agreement` \| `amendment` \| `waiver` \| `compliance_certificate` \| `financials` |
| `title` | text NOT NULL | |
| `effective_date` | date | Drives amendment precedence |
| `source` | text | `upload` \| `email` |
| `created_at` | timestamptz | |

### 6.3 `doc_chunks` — the vector store

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `document_id` | uuid FK → `documents` | ON DELETE CASCADE |
| `content` | text NOT NULL | The chunk text — the UI reads this for the citation panel |
| `embedding` | **vector(1536)** | `text-embedding-3-small`. The dimension is load-bearing. |
| `metadata` | jsonb NOT NULL | `{facility_id, document_id, doc_type, section, doc_title}` |

**Index:** `ivfflat (embedding vector_cosine_ops)`. **Always filtered by
`metadata->>'facility_id'`** — one borrower's agreement must never be cited in
another borrower's casefile.

### 6.4 `covenant_terms` — NEW. Flow A output, versioned and effective-dated

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `facility_id` | uuid FK → `facilities` | |
| `version` | int NOT NULL | 1, 2, 3… |
| `effective_from` | date NOT NULL | |
| `effective_to` | date NULL | NULL = currently in force |
| `terms` | jsonb NOT NULL | The executable terms (spec §4.2 schema) |
| `source_citations` | jsonb NOT NULL | One `{field, citation, quote}` per term line |
| `status` | text CHECK | `proposed` \| `approved` \| `superseded` |
| `approved_by` | text NULL | Analyst identifier — the four-eyes record |
| `approved_at` | timestamptz NULL | |
| `created_at` | timestamptz | |

**Constraint:** `UNIQUE (facility_id, version)`.
**Rule:** an amendment **never** mutates an existing row. It creates
`version + 1`, sets the previous row's `effective_to`, and marks it
`superseded`. A Q1 test must remain reproducible against the terms in force in Q1.
**Rule:** only `status = 'approved'` rows may be used by a test.

### 6.5 `tests` — NEW. Flow B output, one row per borrower per quarter

This table is what makes the product end-to-end. It exists for **every** borrower
every quarter, not only for the ones that fail.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `facility_id` | uuid FK → `facilities` | |
| `covenant_terms_id` | uuid FK → `covenant_terms` | Which approved version was used |
| `test_period_end` | date NOT NULL | |
| `computed_dscr` | numeric(10,4) NULL | **Our** number. NULL when the calculator errored. |
| `reported_dscr` | numeric(10,4) NULL | The borrower's number — evidence, not trigger |
| `threshold` | numeric(10,4) NOT NULL | |
| `passed` | boolean NULL | Against `computed_dscr`, never `reported_dscr` |
| `variance` | numeric(10,4) NULL | `computed − reported` |
| `variance_flagged` | boolean DEFAULT false | `abs(variance) > policy.variance_tolerance` |
| `calc_id` | uuid FK → `calc_log` | |
| `calc_error` | text NULL | Populated when inputs were missing — never defaulted to zero |
| `run_id` | text NOT NULL DEFAULT `'demo'` | **A-2.** Separates eval runs from demo data, matching `casefiles.run_id`. Without it an eval pass writes into the demo portfolio *and* collides on the unique constraint below. |
| `created_at` | timestamptz | |

**Constraint:** `UNIQUE (facility_id, test_period_end, run_id)` — the `run_id` is
part of the key, so an eval can re-test the same borrower and period without
touching demo data.
**The three outcomes** are derived, not stored as an enum: `passed = true` and
`variance_flagged = false` → compliant; `passed = true` and `variance_flagged =
true` → logged variance; `passed = false` → an `exceptions` row is written.

### 6.6 `exceptions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `facility_id` | uuid FK | |
| `test_id` | uuid FK → `tests` | **New** — every exception now traces to a test we ran |
| `test_period_end` | date | |
| `computed_dscr` | numeric(10,4) | |
| `reported_dscr` | numeric(10,4) | |
| `required_dscr` | numeric(10,4) | |
| `status` | text CHECK | `new` \| `investigating` \| `pending_review` \| `closed` \| `needs_filing`. **A-4: `casefiles.status` is authoritative** once a casefile exists; this column mirrors it. One writer only — the sync route. |
| `created_at` | timestamptz | |

### 6.7 `casefiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `exception_id` | uuid FK → `exceptions` | |
| `status` | text CHECK | `investigating` \| `pending_review` \| `approved` \| `overridden` \| `awaiting_docs` \| `failed` |
| `trace` | jsonb DEFAULT `'[]'` | `[{n, tool, input_summary, output_summary, ts}]` — the live UI reads this |
| `terms` | jsonb | The terms the agent actually reasoned over |
| `recommendation` | text CHECK | `resolve` \| `request` \| `escalate` \| `abstain` |
| `confidence_basis` | text | |
| `explanation` | text | ≤ 150 words |
| `claims` | jsonb | `[{text, citation, quote}]` |
| `calc_ids` | uuid[] | |
| `missing_evidence` | jsonb | |
| `suggested_tag` | text CHECK | The six fixed pattern tags |
| `guardrail_notes` | jsonb | Every forced change, shown in the UI |
| `steps_count` | int DEFAULT 0 | |
| `summary` | text | |
| `summary_embedding` | vector(1536) | |
| `run_id` | text | Separates eval runs from demo data |
| `foundry_thread_id` | text | **New** — links to the Foundry thread for trace replay |
| `foundry_run_id` | text | **New** |
| `last_step_at` | timestamptz | Detects a stalled run; drives Retry |
| `created_at` | timestamptz | |

### 6.8 `calc_log` — every calculation, ever

| Column | Type | Notes |
|---|---|---|
| `calc_id` | uuid PK | **Injected by the caller**, never generated inside the pure function |
| `casefile_id` | uuid FK NULL | NULL for quarterly tests outside an investigation |
| `test_id` | uuid FK NULL | |
| `inputs` | jsonb NOT NULL | |
| `outputs` | jsonb NOT NULL | |
| `calculator_version` | text NOT NULL | |
| `created_at` | timestamptz | |

Every number in any explanation must match a value in this table or a verbatim
quote. This table is the evidence base for the whole trust claim.

### 6.9 `reviews` — the human decision, and the lesson

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `casefile_id` | uuid FK | |
| `decision` | text CHECK | `approve` \| `override` \| `request_docs` |
| `reason` | text | Required on override. Stored **verbatim** — it becomes the lesson. |
| `corrected_outcome` | text | Required on override |
| `pattern_tag` | text | Model suggests, analyst confirms |
| `lesson_text` | text | |
| `lesson_embedding` | vector(1536) | |
| `created_at` | timestamptz | |

**Append-only.** A wrong lesson is superseded, never deleted — the audit trail
is the product.

### 6.10 `policy` — the Risk Officer's levers

| Key | Default | Effect |
|---|---|---|
| `variance_tolerance` | `0.05` | Above this, a passing test still logs a variance |
| `escalate_if_breach_margin_over` | `0.15` | A deep breach always escalates |
| `prohibited_actions` | `["waive covenant","amend terms","contact borrower"]` | Proposing one forces escalate |
| `max_steps` | `8` | Agent iteration cap |
| `require_human_review` | `true` | **Locked.** Displayed as locked in the UI. |

### 6.11 `eval_runs`

| Column | Type |
|---|---|
| `id` uuid PK · `mode` text (`cold`\|`warm`) · `metrics` jsonb · `created_at` timestamptz |

### 6.12 Relationships

```
facilities 1─────* documents 1─────* doc_chunks
    │
    ├──────* covenant_terms (versioned, effective-dated)
    │              │
    │              ▼
    └──────* tests ────* exceptions ──1 casefiles ──* reviews
                 │                          │
                 └──────* calc_log *────────┘
```

### 6.13 Row Level Security

**This matters because the browser reads Supabase directly with the anon key.**

| Role | Grant |
|---|---|
| `anon` (browser) | **SELECT only**, on every table. No INSERT, UPDATE or DELETE anywhere. |
| `service_role` (API routes, server-side only) | Full access. The key never reaches the client. |

```sql
ALTER TABLE <each_table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON <each_table> FOR SELECT TO anon USING (true);
-- deliberately no INSERT / UPDATE / DELETE policy for anon
```

Three consequences, stated explicitly because they are easy to get wrong:

1. **Every write goes through an API route** using the service-role client. There
   is no browser-side write path, which is why `USING (true)` on read is
   acceptable here.
2. **`USING (true)` is correct only because this is single-tenant with synthetic
   data.** Multi-tenant requires a `lender_id` on every table and
   `USING (lender_id = auth.jwt() ->> 'lender_id')`. That is a Launch-gate
   change, noted so nobody mistakes the demo policy for a production one.
3. **The service-role key must never appear in a `NEXT_PUBLIC_` variable** or in
   a Client Component. Only `lib/supabase/server.ts` may read it.

---

## 7. API design

Four analyst-facing routes, three tool routes called by the Foundry agent, and
one internal route.

### 7.1 Analyst-facing

| Route | Method | Body | Returns | Auth |
|---|---|---|---|---|
| `/api/ingest` | POST | multipart: `file`, `facility_id`, `doc_type` | `{document_id, chunks_created}` | service-role, server-side |
| `/api/covenant-terms/propose` | POST | `{facility_id}` | `{terms_id, terms, source_citations}` — status `proposed` | service-role |
| `/api/covenant-terms/approve` | POST | `{terms_id, approved_by, edits?}` | `{terms_id, version, effective_from}` — status `approved` | service-role |
| `/api/tests/run` | POST | `{facility_id, test_period_end, run_id?}` | `{test_id, computed_dscr, passed, variance_flagged, exception_id?}` | service-role |

**A-1 — the analyst triggers a test per borrower.** There is deliberately no
"run the whole quarter" route. The analyst picks a borrower and a period. It
costs three clicks in the demo instead of one, and it keeps the human visibly in
control of when a covenant gets tested, which is the posture the whole product
takes.

**A-3 — ingesting a certificate does not auto-trigger a test.** Upload and test
stay separate actions. Auto-running would hide the independent-computation
moment, which is the thing worth seeing.

**A-6 — no certificate on file:** `reported_dscr` is NULL, `variance` NULL,
`variance_flagged` false. **The test still runs on our number.** We do not need
the borrower's figure to determine compliance; we only need it to reconcile.
| `/api/investigate` | POST | `{exception_id}` | `{casefile_id}` **immediately** — work continues in Foundry | service-role |
| `/api/review` | POST | `{casefile_id, decision, reason?, corrected_outcome?, confirmed_tag?}` | `{status}` | service-role |

**Reads do not go through the API.** The browser queries Supabase directly with
the anon key under the RLS read policies above. This is what makes the
1-second trace poll cheap.

### 7.2 Tool routes — called by the Foundry agent over HTTPS

Published to Foundry as an OpenAPI 3.0 specification. **Every one requires the
`X-CreditScout-Tool-Key` header**; a request without it is rejected with 401.

| Route | Method | Body | Returns |
|---|---|---|---|
| `/api/tools/dscr-calculator` | POST | `{terms, financials, casefile_id}` | `{calc_id, components, dscr, threshold, pass, margin}` or `{error}` |
| `/api/tools/search-documents` | POST | `{facility_id, query, doc_types?, k?}` | `[{content, citation, section, doc_title, score}]` |
| `/api/tools/search-past-cases` | POST | `{facility_id, exception_profile, k?}` | `[{lesson_text, pattern_tag, case_summary}]` |

`dscr-calculator` is the one that matters: it imports `calc/dscr.js`, **generates
the `calc_id` in the wrapper**, writes the `calc_log` row, and returns. The model
can request a calculation; it cannot perform one.

### 7.3 Internal

| Route | Method | Purpose |
|---|---|---|
| `/api/investigate/sync` | POST | Polls the Foundry run, mirrors completed steps into `casefiles.trace`, and on completion runs guardrail → policy → `pending_review`. Shared-secret protected. |

---

## 8. Feature breakdown

Every PRD user story mapped to the components, tables and routes that implement
it. **A story with no route here will silently fail to exist.**

| Story | Components | Tables written | Routes |
|---|---|---|---|
| **US-000** Covenant setup with analyst approval | `CovenantSetup`, `TermsReview`, `CitationPanel` | `covenant_terms`, `documents`, `doc_chunks` | `/api/ingest`, `/api/covenant-terms/propose`, `/api/covenant-terms/approve` |
| **US-001** Independent quarterly computation | `UploadPackage`, `TestResultCard` | `tests`, `calc_log`, `exceptions` | `/api/ingest`, `/api/tests/run` |
| **US-001b** Variance logged when both pass | `TestResultCard` (variance badge) | `tests.variance_flagged` | `/api/tests/run` |
| **US-002** Agent investigation → recommendation | `InvestigationPage`, `CasefileView` | `casefiles` | `/api/investigate`, `/api/investigate/sync`, all three tool routes |
| **US-003** Every number traceable | `CalcTable`, `GuardrailNotice` | `calc_log`, `casefiles.guardrail_notes` | guardrail runs inside `/api/investigate/sync` |
| **US-004** Citation chips → clause text | `CitationChip`, `ClausePanel` | — (reads `doc_chunks`) | none — direct Supabase read |
| **US-005** Live step trace | `StepTrace` (1s poll) | `casefiles.trace` | none — direct Supabase read |
| **US-006** Approve / override → memory | `ReviewActions`, `OverrideDialog` | `reviews`, `casefiles.status` | `/api/review` |
| **US-007** Request / abstain on missing evidence | `CasefileView` (missing-evidence list) | `casefiles.missing_evidence` | guardrail |
| **US-008** Memory speeds a later case | `SeenSimilarBadge` | reads `reviews.lesson_embedding` | `/api/tools/search-past-cases` |
| **US-009** Governance panel | `GovernancePanel` | — (reads `policy`) | none — direct read |
| **US-010** Eval scoreboard | `Scoreboard` | — (reads `eval_runs`) | none — direct read |
| **US-011** Email intake *(backlog)* | — | `documents` | cron → `/api/ingest` |

**Coverage check:** every P0 story has at least one route and one table. US-004,
US-005, US-009 and US-010 are read-only by design — no route needed, which is
intentional and not an omission.

---

## 9. Build sequence

Nine stages. **Each produces something you can actually run** — that is the test
of whether the sequence is right.

| Stage | Build | Runnable proof | Depends on |
|---|---|---|---|
| **0** | Supabase schema + RLS migration | `supabase db push`; tables visible in the dashboard | — |
| **1** | `calc/dscr.js`, `guardrails/*.js` + unit tests | **`npm test` green.** No model, no network, no UI. Behaviours 1–10 and 18–24 of PRD §2.3 all covered. | 0 |
| **2** | Synthetic documents for F1, F3, F5 + `expected-values-template.csv` | Three facilities of PDFs on disk, each marked `SYNTHETIC — FOR DEMONSTRATION`; owner can fill the template | — |
| **3** | Next.js scaffold + `docs/design.md` tokens + Supabase clients | `npm run dev` serves a styled empty shell | 0 |
| **4** | `/api/ingest` + chunking + embeddings | Upload an agreement, see rows in `doc_chunks` | 0, 2, 3 |
| **5** | **Foundry spike** — one agent, one tool route, round trip | Agent calls `/api/tools/dscr-calculator` and gets a number back. **Highest-risk stage; run it first in wall-clock terms even though it depends on 1 and 4.** | 1, 4 |
| **6** | Flow A — propose + approve covenant terms | Terms proposed with citations, analyst approves, row goes `approved` | 4, 5 |
| **7** | Flow B part 1 — `/api/tests/run`, code-only | All three facilities tested quarterly; F1 and F3 raise exceptions. **No agent involved — pure code.** | 1, 6 |
| **8** | Flow B part 2 — investigation, guardrail, policy | F1 resolves, F3 escalates, with cited casefiles | 5, 7 |
| **9** | UI screens + review + memory | F1 → override → F5 resolves in fewer steps | 8 |
| **10** | Deploy to Vercel + eval run | Public URL; scoreboard with 6 cases, cold and warm | 9 |

**Two sequencing notes that matter:**

- **Stage 5 is the real risk and is ordered by dependency, not by priority.** In
  wall-clock terms it is spiked first, with a throwaway agent, before stages 6–8
  are built on the assumption that Connected Agents works. If it fights back, the
  fallback — demoting the three specialists to plain OpenAPI tools — changes
  stage 8 only.
- **Stage 7 produces a working product without any agent at all.** Ingest,
  approved terms, deterministic calculation, exception detection. If everything
  downstream collapses, that is still a demonstrable system, and it is the same
  thing the kill switch degrades to in production.

---

## 10. Observability — the owner's question, answered

Three layers, each answering a different question:

| Layer | Question it answers | Where |
|---|---|---|
| **In-product trace** | "What did the agent do on *this* case? Let me click that citation." | Our UI, reading `casefiles.trace` |
| **Agent traces** | "Replay the whole reasoning chain. Which specialist did what? Where was the latency?" | **Foundry portal** (Application Insights) |
| **Token usage & cost** | "What did this investigation cost? Which agent burned the tokens?" | Foundry / Azure Monitor metrics |

Under Option B all three come largely for free, because Foundry instruments the
run itself. This is the lab's Step 8, met natively rather than reconstructed.

The in-product trace still matters and is still built: the demo (§10) clicks
through it on camera, and no dashboard substitutes for showing an analyst the
agent's work inside the product.

---

## 11. Evaluation

**Unchanged from spec §8.** `evals/run.mjs` POSTs to `/api/investigate` on the
deployed app instead of an n8n webhook — a base-URL change. Two passes, cold and
warm. The 6-case development subset stays the default; all 24 cases run twice
only for reportable numbers. Outputs stay `results.csv`, `report.md`,
`foundry.jsonl`, and an `eval_runs` row for the in-app scoreboard.

Azure AI Foundry Evaluations keeps its §8.2 role for groundedness with an LLM
judge. Handoff §4.4's point stands: upgrade the judge from `gpt-4.1-mini` to full
`gpt-4.1` before reporting final numbers, because a judge's credibility matters
when the score is the evidence. Deploying it is billable and is the owner's call.

The owner still computes the expected DSCR values independently, and the runner
must still refuse to run while any row says `NO`. Reason unchanged: if the thing
grading the calculator shares an author with the calculator, the tests only prove
it agrees with itself.

---

## 12. What this means for the three plans

| Plan | Covers | Effect |
|---|---|---|
| **1 — Deterministic core** | Schema, DSCR calculator, casefile validator, guardrail, policy engine, synthetic facilities | **Survives almost entirely.** Two additive columns in Task 1 (§6), ESM exports instead of guarded CommonJS (§10.1), §8.3's sync check dropped. Tasks 2–6 otherwise untouched. |
| **2 — Agents and tools** | Foundry agent definitions, connected agents, OpenAPI tool endpoints, retrieval, memory | **Rewritten** around Foundry. Becomes the LLD's main body. |
| **3 — UI and evals** | Analyst screens, eval runner | **Mostly survives.** Vite + React becomes Next.js; screens, data reads and eval logic unchanged. |

Plan 1 remains the cheapest place to build confidence — no model calls, no
network beyond the schema migration, and now no platform dependency either.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| ~~**Connected Agents may not work**~~ | **RETIRED 2026-10-05 — spiked and verified live.** An orchestrator on `gpt-4.1-mini` delegated to a `gpt-5-mini` specialist via a `connected_agent` tool, and the delegation appears as a discrete step in the run-steps API — which is also the trace the UI renders. A separate spike confirmed a function-tool round trip: the agent called `dscr_calculator`, did **not** compute the ratio itself, and reported back exactly the number the tool returned. |
| **Connected Agents is a preview feature.** Preview features change and can be flaky — and this one is load-bearing for the learning goal. | Fallback: demote the three specialists from connected agents to plain OpenAPI tools on the orchestrator. Same behaviour, less elegant, no preview dependency. Decide after the first working run, not before. |
| Foundry Agent Service adds platform-specific learning time | That is the point of the exercise, and the course taught it in Week 5 |
| Agent path too uniform, looks like a pipeline | Unchanged from spec §12: the six facility twists force different paths; the F1 vs F5 trace comparison is in the demo |
| Model hallucinated figures or quotes | Unchanged: code guardrails force abstain, tested against fabricated outputs |
| Step cap enforcement differs from an n8n node setting | Enforced by our polling layer against `policy.max_steps`; see §12 open item 4 |
| Supabase free-plan database sleeps after ~1 week idle | Daily use avoids it; Pro removes it for ~$25 — owner's call |
| Tool endpoints on Vercel are publicly reachable | Shared secret in a header; Foundry sends it on every tool call |
| ~~n8n Cloud plan may lack required nodes~~ | **Closed** — n8n dropped |
| ~~Generated n8n JSON needs node-version fixes~~ | **Closed** |
| ~~Calculator copy must stay byte-identical to n8n's~~ | **Closed** |

### 10.1 A bug in plan 1 that must be fixed either way

Plan 1's Global Constraints specify a guarded CommonJS export
(`if (typeof module !== 'undefined' && module.exports)`), but Task 2's test does
`import { computeDscr } from './dscr.js'` and `package.json` sets
`"type": "module"`. The file is therefore parsed as ESM, `module` is undefined,
the guard never fires, and the import throws. **Plan 1 Task 2 cannot pass as
written.**

Fix: end each deterministic file with a plain ESM `export { ... }`. The files stay
zero-dependency and import-free — only the n8n-paste compatibility is given up,
which this proposal gives up anyway. This would have bitten the first
implementation task under any of the options considered.

---

## 14. Spec amendments — APPLIED 2026-10-05

**Applied to `docs/superpowers/specs/2026-10-01-creditscout-design.md` on
2026-10-05 at the owner's instruction ("keep it latest").** The spec is now
current; this table is the record of what changed. 27 edits across §2, §3, §4,
§5, §7, §8.3, §12, §13 and §14 — plus two new subsections, §4.1a covenant setup
and §4.1b the quarterly test.

| § | Current | Proposed |
|---|---|---|
| §2 Scope | "deployment (runs locally; n8n is on n8n Cloud)" out of scope | Deployment to Vercel is **in** scope. Auth, multi-user, roles, mobile stay out. |
| §3 Architecture | Orchestration = n8n Cloud AI Agent node, Claude Opus 5.5; UI = Vite + React, local | Orchestration = **Azure AI Foundry Agent Service** with Connected Agents; UI = **Next.js on Vercel**. Retrieval, calculation, memory and evaluation rows unchanged. |
| §3 "Why n8n for the MVP" | Paragraph justifying n8n | Replaced by §1 of this document. |
| §3 Production path | "Foundry Agent Service inside the bank's tenant" is roadmap | Becomes **what is actually built**, minus the bank tenant. Strengthens the story. |
| §4 Workflows (n8n) | §4.1–§4.5 expressed as n8n nodes | Re-expressed as API routes, Foundry agents and OpenAPI tools. **All behaviour preserved** — same steps, same tool contracts, same `terms` schema, same calculator contract, same immediate-response pattern. §4.5 Gmail becomes a cron route, still optional. |
| §4.2 Anthropic node settings | n8n node option names | Foundry agent + run configuration. |
| §4.2 / §13 Models | Claude Opus 5.5 orchestrator, Claude Sonnet 5.5 sub-agents | Azure-hosted models per §3. Reversible; Claude remains available on Azure. |
| §5 Data model | `casefiles` columns | Add `foundry_thread_id text`, `foundry_run_id text`. |
| §7 Analyst UI | "Vite + React … local" | Next.js on Vercel. Four screens, visual language, read/write split unchanged. |
| §8.3 Engineering tests | Sync check: n8n JSON byte-identical to `calc/dscr.js` | Removed. The other three test groups unchanged. |
| §12 Risks | Two n8n rows | Replaced by §10 above. |
| §14.3 Open items | "confirm the n8n Cloud plan includes the AI Agent node and Supabase Vector Store node" | **Closed** — no longer applicable. |

**Explicitly unchanged:** the problem statement, success criteria and all seven
metrics (§1), the agentic/deterministic boundary table (§3), the `terms` schema
and DSCR calculator contract (§4.2), expected investigation paths (§4.3), review
semantics and memory (§4.4), every guardrail check (§6.1), every policy lever
(§6.2), error handling (§6.3), the eval set and runner (§8.1–§8.2), synthetic data
rules (§9), and the demo structure (§10).

---

## 15. Open items for the owner

1. **Approve or reject this HLD** (§11). The LLD is written against the answer.
2. **§14.1 — do the six borrower twists ring true?** Unaffected by the platform
   decision, still gates plan 1 Task 6, still the item most worth the owner's
   credit experience. Draft-then-react is fine.
3. **Expected DSCR values** — owner-computed in a spreadsheet, signed off per row.
4. **`max_steps: 8`** — still a `policy` row; confirm how it maps onto a Foundry
   run once the first run exists.
5. **§14.2 — the 24 eval labels**, once drafted.
6. **Whether full `gpt-4.1` gets deployed for the judge.** Billable, owner's call.
7. ~~**Confirm the orchestrator model.**~~ **Resolved 2026-10-05:** `gpt-5-mini`
   everywhere for the MVP. No new model deployment, no new billable resource.

---

## 16. Recommended next step

If §11 is approved, write the LLD (`docs/spec.md`) feature by feature in the Week
5 blueprint format — Product & UX, Data & Backend, Frontend & QA.

Plan 1 Tasks 1–5 can start in parallel with LLD review: the schema, calculator,
casefile validator, guardrail and policy engine contain no platform decision and
are identical under every option considered.
