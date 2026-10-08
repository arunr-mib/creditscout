# CreditScout — Implementation Specs (LLD)

**Date:** 2026-10-05 · **Input:** `docs/engineering/engineering-doc.md` · **Format:** Week 5 blueprint (Product & UX · Data & Backend · Frontend & QA)

Every feature below carries all twelve blueprint items. Where an item genuinely
does not apply it says **N/A** with a reason — never silently skipped.

Features are numbered by **build-sequence stage**, so F0 is built first.

---

## Integration points

Where two features touch. These are where silent breakage happens.

| # | Features | Shared thing | What breaks if it drifts |
|---|---|---|---|
| I-1 | F1 ↔ F5, F7, F8 | `computeDscr()` signature and its `{error}` shape | A caller treating `{error}` as a number fabricates a breach |
| I-2 | F0 ↔ all | `covenant_terms.terms` jsonb schema | Agent writes one shape, calculator reads another |
| I-3 | F6 ↔ F7 | Only `status='approved'` terms may be used by a test | A proposed-but-unapproved term silently governs a test — the four-eyes control is bypassed |
| I-4 | F7 ↔ F8 | `exceptions.test_id` | An investigation with no originating test can't show *our* number |
| I-5 | F5 ↔ F8 | `calc_log.calc_id` written by the tool, read by the guardrail | The guardrail can't verify figures and abstains on everything |
| I-6 | F8 ↔ F9 | `casefiles.trace` append shape `{n, tool, input_summary, output_summary, ts}` | The live trace renders blank |
| I-7 | F9 ↔ F10 | `reviews.lesson_embedding` written on override, read by `search-past-cases` | The memory effect — the demo centrepiece — silently does nothing |
| I-8 | F3 ↔ F9 | Tailwind token names from `docs/design.md` | Screens drift; amber stops meaning "code" |
| I-9 | F5 ↔ F8 | **Orchestrator model must carry the six-function-tool set** — `gpt-4.1-mini`; `gpt-5-mini` is rejected at agent-creation time. *(Revised 2026-10-06: specialists are now function tools serviced in-process, not `connected_agent` entries — the constraint moved with them.)* | Changing the orchestrator model to a non-compatible one breaks the whole multi-agent design at startup, not at runtime. |
| I-10 | F7 ↔ F10 | ~~**`tests` has no `run_id`**~~ **Resolved:** `tests.run_id` and `casefiles.run_id` exist (default `demo`); the eval harness uses `eval-<stamp>-<mode>` run_ids, and lessons are retrieved per run_id. | An eval pass never pollutes the demo portfolio; a cold pass never sees warm lessons. |
| I-11 | F8 ↔ F1 | The guardrail needs the cited chunks to verify quotes | `applyGuardrail(casefile, calcLogEntries, citedChunks)` — the **sync route** must fetch chunks for every citation the agent returned before calling it. If it passes an empty array, every claim fails verification and everything abstains. |

---

# F0 — Database schema and RLS

*Stage 0 · depends on nothing*

### Product & UX
- **Description:** The eleven tables from engineering-doc §6, with RLS so the browser can read but never write.
- **User flow:** N/A — no user-facing surface.
- **Placement:** N/A.
- **Design:** N/A.

### Data & Backend
- **Database schema:** All tables per engineering-doc §6.1–§6.11. Enable `extensions.vector`. `doc_chunks.embedding vector(1536)`, `casefiles.summary_embedding vector(1536)`, `reviews.lesson_embedding vector(1536)`.
- **Database tasks:**
  1. `supabase/migrations/0001_schema.sql` — tables, FKs, CHECK constraints, `UNIQUE (facility_id, version)` on `covenant_terms`, `UNIQUE (facility_id, test_period_end)` on `tests`.
  2. `0002_rls.sql` — `ENABLE ROW LEVEL SECURITY` on all eleven; one `FOR SELECT TO anon USING (true)` policy each; **no** anon write policy.
  3. `0003_policy_seed.sql` — the five `policy` rows at their defaults.
  4. `0004_indexes.sql` — `ivfflat` on all three vector columns; btree on `tests(facility_id, test_period_end)`, `casefiles(exception_id)`, `covenant_terms(facility_id, status)`.
- **Helper functions:** `match_doc_chunks(query_embedding vector(1536), facility_id uuid, match_count int)` — a Postgres function doing cosine similarity **with the facility filter inside the function**, so a caller cannot forget it. This is the cross-facility leakage defence.
- **API routes:** N/A — migrations run via CLI.

### Frontend & QA
- **State management:** N/A.
- **Components:** N/A.
- **Edge cases:** Re-running a migration must be idempotent (`IF NOT EXISTS`). The pre-existing 2-row `feedback` table in this Supabase project is left untouched.
- **Testing checklist:**
  - [ ] `supabase db push` succeeds on a clean project
  - [ ] Anon key can `SELECT` from every table
  - [ ] Anon key **cannot** `INSERT` into any table — verify, don't assume
  - [ ] `match_doc_chunks` returns only chunks for the requested facility
  - [ ] All five `policy` rows present with correct defaults

---

# F1 — Deterministic core

*Stage 1 · depends on F0 · **the thesis, and testable with no model and no network***

### Product & UX
- **Description:** The DSCR calculator, casefile schema validator, guardrail and policy engine. Code that produces every number and polices every model output.
- **User flow:** Invisible to the user; surfaces as amber values and guardrail notices.
- **Placement:** `calc/`, `guardrails/`.
- **Design:** N/A — but its outputs are always rendered amber per `docs/design.md`.

### Data & Backend
- **Database schema:** Writes nothing directly. Its output is persisted by callers into `calc_log`.
- **Database tasks:** N/A — pure functions, no I/O.
- **Helper functions:**

```
calc/dscr.js
  computeDscr(terms, financials, options) → result
    terms      : {test_period, threshold:{min_dscr}, numerator:{base, addbacks[], deductions[]}, denominator:{components[]}}
    financials : {ebitda, addback_amounts:{}, unfinanced_capex, cash_taxes, scheduled_principal, cash_interest}
    options    : {calcId}   ← REQUIRED. Never generated inside.
    result     : {calc_id, components, dscr, threshold, pass, margin, calculator_version}
               | {error: string}        ← never a defaulted number
  roundHalfUp(value, dp) → number        ← half-up, NOT banker's rounding
  CALCULATOR_VERSION : string

guardrails/casefile-schema.js
  validateCasefileOutput(obj) → {valid: boolean, errors: string[]}
  RECOMMENDATIONS, PATTERN_TAGS

guardrails/guardrail.js
  applyGuardrail(casefile, calcLogEntries, citedChunks) → {casefile, notes[]}
  normaliseNumber(text) → number|null    ← "1,250,000" "1.25x" "$4.25m" → number

  verifyTermsProvenance(terms, sourceCitations, chunks) → {valid, violations[]}
    SECURITY FIX S-1. Every numeric value in `terms` must appear — after
    normalisation — in the quote that term cites. A citation that merely EXISTS
    is not evidence; a threshold of 0.85 citing a clause that says 1.25 must be
    rejected. Blocks approval in F6.

guardrails/policy.js
  applyPolicy(casefile, policy, calcs) → {casefile, notes[]}
  DEFAULT_POLICY
```

**Hard constraints:** zero dependencies, no `import`, no `require`. End each file with a plain ESM `export { ... }` — **not** a guarded `module.exports`, which cannot be imported under `"type": "module"` and is why the existing plan's Task 2 fails as written.

- **API routes:** N/A — imported directly.

### Frontend & QA
- **State management:** N/A — pure functions.
- **Components:** N/A.
- **Edge cases:** PRD §2.3 behaviours 1–10 and 18–24, in full.
- **Testing checklist** (`node:test` + `node:assert/strict`):
  - [ ] Computes DSCR from terms + financials (happy path)
  - [ ] Rounds **half-up**: 1.2549 → 1.25, 1.2550 → 1.26
  - [ ] Applies an add-back cap (800k against a 500k cap → 500k)
  - [ ] **Absent `cap` and `cap: null` both mean uncapped** — F1 flips to a false escalation otherwise
  - [ ] Negative EBITDA returns a negative DSCR, not an error
  - [ ] Denominator 0 or negative → `{error}`
  - [ ] Missing financial input → `{error}`, **never zero**
  - [ ] Add-back in `terms` with no matching figure → `{error}`
  - [ ] Unknown deduction / denominator component name → `{error}`
  - [ ] Missing `calcId` → `{error}`
  - [ ] Does not mutate its inputs
  - [ ] Guardrail: untraceable number → forced `abstain`
  - [ ] **Guardrail: a figure quoted verbatim from a cited clause is ACCEPTED** — the subtlest failure in the design
  - [ ] Guardrail: `1,250,000` ≡ `1250000`, `1.25` ≡ `1.25x`, `$4.25m` ≡ `4250000`
  - [ ] Guardrail: quote absent from the cited chunk → claim removed; if load-bearing → `abstain`
  - [ ] Guardrail: `resolve` with no passing calc → downgraded to `escalate`
  - [ ] Policy: prohibited action proposed → forced `escalate`
  - [ ] Policy: breach deeper than `escalate_if_breach_margin_over` → `escalate`
  - [ ] Schema: malformed output → one retry, then `abstain`
  - [ ] **S-1: a term whose value does not appear in its own cited quote is rejected** (threshold 0.85 citing a clause that reads 1.25)
  - [ ] S-1: a term whose value *does* appear, in any format, is accepted

---

# F2 — Synthetic facilities

*Stage 2 · depends on nothing · **gated on owner validation of the three twists***

### Product & UX
- **Description:** Three synthetic facilities — F1 Harbor Logistics (amendment add-back), F3 Northgate Foods (true breach), F5 Coastal Marine (repeat of F1's pattern) — each with agreement, amendment/waiver, quarterly financials, compliance certificate.
- **Plus two extra quarters on F5**, so the demo can show all three quarterly outcomes rather than only the third:

| Period | Borrower reports | We compute | Mechanism | Outcome shown |
|---|---|---|---|---|
| Q4 2025 | 1.41 | 1.41 | Agree | **1 — compliant, no action** |
| Q1 2026 | **1.38** | **1.29** | Borrower took the full $900k add-back; the amendment caps it at **$500k**. Both clear 1.25. | **2 — variance logged, no investigation** |
| Q2 2026 | 1.30 | 1.12 | Approved terms are v1; Amendment No. 2 on file **unboarded** | **3 — breach → investigate**, resolves in ~3 steps on F1's lesson |

  Two extra financials + certificate pairs, no new facility.

**The two mechanisms the synthetic data must support:**

1. **Covenant boarding lag (F1, F5 Q2).** The amendment PDF exists in the
   document set with an `effective_date` inside the test period, but the approved
   `covenant_terms` row is v1 and predates it. The agent's job is to notice the
   gap. **Do not board the amendment during seed** — the lag *is* the twist.
2. **Unsupported add-back (F3).** The borrower's certificate shows an add-back
   that appears **nowhere** in the agreement or any amendment, so their 1.31
   becomes our 1.08. An unexecuted waiver *request* letter sits in the file,
   dated after the period and unsigned by the lender — the agent must determine
   that a requested waiver is not a granted waiver.
- **User flow:** The analyst uploads these during the demo.
- **Placement:** `data/facilities/F1|F3|F5/`.
- **Design:** Documents look like credit agreements — definitions article, financial covenants article with DSCR at a `§7.11`-style section, events of default, notices.

### Data & Backend
- **Database schema:** N/A — produces files.
- **Database tasks:** A seed script inserts the three `facilities` rows.
- **Helper functions:** `data/generate.mjs` — writes text-based PDFs. Financials print each of the six calculator inputs as **its own labeled line** (`Consolidated EBITDA: 4,250,000`), which is what keeps statement extraction out of scope while still supplying the calculation.
- **API routes:** N/A.

### Frontend & QA
- **State management / Components:** N/A.
- **Edge cases:** Every document carries the literal marker `SYNTHETIC — FOR DEMONSTRATION`. Borrower names fictional. Amendment effective dates must fall **inside** the test period they are meant to govern, or F1's path is unreachable.
- **Testing checklist:**
  - [ ] Each document is text-extractable (not an image)
  - [ ] The marker string is present in every file
  - [ ] All six financial inputs appear as labeled lines in each financials doc
  - [ ] `data/expected-values-template.csv` generated with `expected_dscr` blank and `owner_signed_off = NO`
  - [ ] F1's amendment is dated within the test period
  - [ ] F5 Q4-2025 produces outcome 1 (compliant, variance within tolerance)
  - [ ] F5 Q1-2026 produces outcome 2 — `variance_flagged = true`, `passed = true`, **no exception row**
  - [ ] F5 Q2-2026 produces outcome 3 (exception)
  - [ ] **F3's certificate reports 1.31 (compliant) while the agreement supports only 1.08** — the false-compliant catch
  - [ ] F1 and F5-Q2 amendments are present as documents but **not** boarded into `covenant_terms` by the seed
  - [ ] F3's waiver request letter is unsigned and dated after the test period

---

# F3 — App shell and design tokens ✅ BUILT 2026-10-05

*Stage 3 · depends on F0 · built via `/frontend-setup`*

**As-built notes:** `package.json` keeps `"type": "module"` so `calc/*.js` and
`guardrails/*.js` can use plain ESM `export`. Next.js config files are `.mjs`.
`tsconfig.json` **excludes** `calc`, `guardrails` and `evals` — they are plain
JavaScript run by `node --test` and must not be type-checked as app code.

### Product & UX
- **Description:** Styled, empty, runnable Next.js shell with the design system compiled in.
- **User flow:** N/A.
- **Placement:** `app/`, `lib/`, `components/`.
- **Design:** `docs/design.md`, translated to `tailwind.config.ts` as **named tokens** — `model`, `code`, `human`, `danger`, `success`, plus surface and text scales.

### Data & Backend
- **Database schema:** N/A.
- **Database tasks:** N/A.
- **Helper functions:** `lib/supabase/server.ts` (service role, server-only) · `lib/supabase/browser.ts` (anon, read-only).
- **API routes:** None yet.

### Frontend & QA
- **State management:** None — Server Components by default.
- **Components:** `app/layout.tsx` (fonts, theme) · `components/CalcValue.tsx` as the reference component proving the amber/provenance pattern.
- **Edge cases:** The service-role key must never reach the client. `lib/supabase/server.ts` must not be imported by any Client Component.
- **Testing checklist:**
  - [x] `npx next build` passes
  - [x] Service-role key **absent** from `.next/static` — verified by grep, not assumed
  - [x] No `NEXT_PUBLIC_*` service key anywhere
  - [x] No raw hex colour in `app/` or `components/` — all via named tokens
  - [x] `CalcValue` renders `1.31 ⟡ computed by code · calc_a3f9` in amber mono
  - [x] Inter and JetBrains Mono load; `.font-mono` sets `tabular-nums`

---

# F4 — Ingest

*Stage 4 · depends on F0, F2, F3*

### Product & UX
- **Description:** Upload a PDF; it is parsed, split by legal section, embedded, and stored.
- **User flow:** Analyst drags a file onto the upload area → progress → "12 sections indexed".
- **Placement:** Upload control on the portfolio queue and on the covenant-setup screen.
- **Design:** Dropzone on `surface`, dashed `border-strong`; success as a slate toast (not green — green means *compliant*).

### Data & Backend
- **Database schema:** Writes `documents`, `doc_chunks`.
- **Database tasks:** Insert document row → insert chunk rows with `metadata = {facility_id, document_id, doc_type, section, doc_title}`.
- **Helper functions:**
  - `lib/pdf.ts` → `extractText(buffer): Promise<string>`
  - `lib/chunk.ts` → `chunkBySection(text, meta): Chunk[]` — splits on `§`, `Section`, `ARTICLE`
  - `lib/embed.ts` → `embed(texts: string[]): Promise<number[][]>` — Azure `text-embedding-3-small`, **1536 dims**
- **API routes:** `POST /api/ingest` — multipart `{file, facility_id, doc_type}` → `{document_id, chunks_created}`.

### Frontend & QA
- **State management:** Local component state for upload progress; revalidate the server component on success.
- **Components:** `UploadPackage`, `DocumentList`.
- **Edge cases:**
  - Scanned/image PDF → reject with a reason, do not OCR (PRD §2.3 #25)
  - Parse failure → no partial `documents` row (transaction)
  - File > 10MB or non-PDF content type → reject before parsing
  - A document with no recognisable sections → one chunk for the whole document, flagged
- **Testing checklist:**
  - [ ] Upload an agreement → `doc_chunks` rows with correct `facility_id` in metadata
  - [ ] Embeddings are length 1536
  - [ ] Image-only PDF is rejected with a readable message
  - [ ] Oversized / wrong-type file rejected before parsing
  - [ ] Failed parse leaves no orphan `documents` row

---

# F5 — Agent tool endpoints

*Stage 5 · depends on F1, F4 · **spiked and GREEN 2026-10-05***

**Spike result — verified live against the owner's Foundry project:**

| Verified | Result |
|---|---|
| Agent calls a function tool rather than computing | ✅ Called `dscr_calculator` with correct args; did **not** compute the ratio itself |
| Agent reports the tool's number verbatim | ✅ Returned 1.31 / threshold 1.25 / margin 0.06 exactly as supplied |
| `connected_agent` delegation works | ✅ Orchestrator delegated to a specialist; delegation is a discrete entry in the run-steps API |
| Run steps are usable as the UI trace | ✅ `GET /threads/{tid}/runs/{rid}/steps` returns `tool_calls` with the tool name |

**Platform constraint found — this is binding.** `gpt-5-mini` **cannot** carry
the orchestrator's tool set: the Assistants API rejects agent creation with
*"This model only supports Responses API compatible tools."* The orchestrator
must therefore run **`gpt-4.1-mini`**. Specialists stay on `gpt-5-mini`. Both
already deployed.

**Revised 2026-10-06 — specialists are in-process function tools.** The
`connected_agent` delegation verified above was dropped after the first working
runs: a connected agent's inner run cannot carry a function tool, so a
specialist could not retrieve for itself. `lib/agent/foundry.ts`
`specialistTools()` declares `definition_agent` / `research_agent` /
`document_agent` as plain function tools, and `lib/agent/specialists.ts`
services them in our polling layer. Decision record: parking-lot 7.4.

**API surface confirmed:** base `${AZURE_AI_PROJECT_ENDPOINT}`,
`api-version=2025-05-01`, bearer token from
`az account get-access-token --resource https://ai.azure.com`. Agents are
`POST /assistants`; a run is `POST /threads/runs`; a function tool pauses the run
at `status: requires_action` and resumes via
`POST /threads/{tid}/runs/{rid}/submit_tool_outputs`.

### Product & UX
- **Description:** Three HTTPS endpoints the Foundry agent calls. This is where the model requests a calculation it cannot perform itself.
- **User flow:** Invisible — called by the agent mid-investigation.
- **Placement:** `app/api/tools/`.
- **Design:** N/A.

### Data & Backend
- **Database schema:** `dscr-calculator` writes `calc_log`.
- **Database tasks:** Insert one `calc_log` row per calculation, with `calc_id` generated **in the wrapper**.
- **Helper functions:** `lib/agent/tools/*.ts`, one per tool, each importing from `calc/` or `lib/retrieval.ts`.
- **API routes:**

| Route | Body | Returns |
|---|---|---|
| `POST /api/tools/dscr-calculator` | `{terms, financials, casefile_id?}` | `{calc_id, components, dscr, threshold, pass, margin}` \| `{error}` |
| `POST /api/tools/search-documents` | `{facility_id, query, doc_types?, k?}` | `[{content, citation, section, doc_title, score}]` |
| `POST /api/tools/search-past-cases` | `{facility_id, exception_profile, k?}` | `[{lesson_text, pattern_tag, case_summary}]` |

All three require `X-CreditScout-Tool-Key`; 401 without it.

**SECURITY FIX S-2 — fail closed.** The check must reject when
`process.env.CREDITSCOUT_TOOL_KEY` is **unset or empty**, not only when the
header mismatches. `header !== process.env.KEY` passes when both are
`undefined`, which would leave these routes publicly callable.

```ts
const expected = process.env.CREDITSCOUT_TOOL_KEY;
if (!expected || expected.length < 32) return unauthorized();   // fail closed
if (req.headers.get("x-creditscout-tool-key") !== expected) return unauthorized();
```
An OpenAPI 3.0 document at `app/api/tools/openapi.json` is what Foundry registers.

### Frontend & QA
- **State management:** Stateless.
- **Components:** N/A.
- **Edge cases:**
  - Missing or wrong tool key → 401, no information leaked in the body
  - `search-documents` **must** filter by `facility_id` — cross-facility leakage is the worst available bug here
  - Calculator returns `{error}` → returned as a 200 with an error body so the agent can reason about it, **not** a 5xx
  - Malformed `terms` → validation error naming the field
- **Testing checklist:**
  - [ ] Request without the tool key → 401
  - [ ] **S-2: request succeeds against an unset `CREDITSCOUT_TOOL_KEY` → must still 401** (fail closed, not open)
  - [ ] `search-documents` with facility A never returns facility B's chunks
  - [ ] Calculator tool writes exactly one `calc_log` row per call
  - [ ] `calc_id` returned matches the row written
  - [ ] Missing financial input → `{error}` body, HTTP 200
  - [x] **Spike gate passed:** a Foundry agent called the calculator and received a number
  - [ ] OpenAPI tool variant works server-side (the spike used a function tool, which pauses the run; OpenAPI tools are called by Foundry directly — **confirm before relying on it**)

---

# F6 — Covenant setup (Flow A)

*Stage 6 · depends on F4, F5 · **the four-eyes control***

### Product & UX
- **Description:** The agent reads the agreement and amendments and proposes executable terms, each line cited. The analyst reviews each term beside its source clause and approves.
- **User flow:** Facility page → *Set up covenant* → agent proposes (spinner with live status) → split view: terms left, source clause right → Edit or **Approve** → terms go live, versioned and effective-dated.
- **Placement:** `app/facilities/[id]/covenant-setup/page.tsx`.
- **Design:** Split pane. Each term row: label (`text-muted`), value (mono), citation chip (teal). Clicking a chip highlights the quote in the right pane. Approve is the primary (teal) button; it is **disabled until every term has a citation**.

### Data & Backend
- **Database schema:** Writes `covenant_terms`.
- **Database tasks:** `propose` inserts `status='proposed'`. `approve` sets `status='approved'`, `approved_by`, `approved_at`; sets the previous version's `effective_to` and marks it `superseded`; assigns `version = max(version)+1`.
- **Helper functions:**
  - `lib/agent/tools/definition-agent.ts` → `proposeTerms(facilityId): Promise<{terms, source_citations}>`
  - `lib/terms.ts` → `validateTerms(terms)` (shape), `supersede(facilityId, newVersion)`
  - **`verifyTermsProvenance()` from `guardrails/guardrail.js` runs before approval is offered.** Shape validation is not provenance validation — see S-1.
- **API routes:** `POST /api/covenant-terms/propose` · `POST /api/covenant-terms/approve`.

### Frontend & QA
- **State management:** Client Component. Local state for edits; optimistic highlight on chip click; `router.refresh()` after approval.
- **Components:** `CovenantSetup`, `TermsReview`, `TermRow`, `ClausePanel`, `ApproveBar`.
- **Edge cases:**
  - Agreement with no recognisable DSCR definition → "not found", analyst resolves manually; **never invent a threshold** (PRD §2.3 #27)
  - A term without a citation → Approve stays disabled
  - **A term whose value is absent from its own cited quote → Approve stays disabled**, with the offending term flagged. A real citation carrying a wrong number is the dangerous case, because it looks correct.
  - Analyst edits a term → the edit is stored and the citation marked `analyst-corrected`
  - Approving when an approved version already exists → creates v+1, supersedes the old; **never overwrites**
  - Two approvals racing → `UNIQUE (facility_id, version)` rejects the second
- **Testing checklist:**
  - [ ] Propose returns a term per required field, each with citation and verbatim quote
  - [ ] Every quote appears verbatim in the cited chunk
  - [ ] Approve writes `approved_by` and `approved_at`
  - [ ] A second approval creates v2 and sets v1 `effective_to` and `superseded`
  - [ ] **A test run for a past period still resolves to the version in force then**
  - [ ] Approve disabled while any term lacks a citation
  - [ ] **Approve disabled while any term's value is absent from its cited quote**
  - [ ] Agreement without a DSCR definition does not fabricate one

---

# F7 — Quarterly test (Flow B, part 1)

*Stage 7 · depends on F1, F6 · **pure code — no agent involved***

### Product & UX
- **Description:** For a borrower and a period, load the approved terms, compute **our** DSCR, compare to threshold, reconcile against the borrower's reported figure. Three outcomes.
- **User flow:** Upload quarterly package → *Run test* → result card: our number, their number, variance, verdict.
- **Placement:** `app/facilities/[id]/page.tsx`; results on the portfolio queue.
- **Design:** `TestResultCard` — our DSCR in amber mono with provenance; reported DSCR in `text-secondary`; variance badge; verdict as compliant (green) / variance logged (slate + amber badge) / **breach (rose)**.

### Data & Backend
- **Database schema:** Writes `tests`, `calc_log`, and `exceptions` when failing.
- **Database tasks:** Insert `tests` row (unique on facility + period + **`run_id`**); insert `calc_log`; on `passed=false` insert `exceptions` with `test_id`. `run_id` defaults to `'demo'`; the eval runner passes its own.
- **Helper functions:**
  - `lib/tests/run.ts` → `runTest(facilityId, periodEnd): Promise<TestResult>`
  - `lib/tests/extract-financials.ts` → `readLabeledFigures(facilityId, periodEnd)` — reads the six labeled lines **and returns the citation for each**
  - `lib/tests/certificate.ts` → `readReportedDscr(facilityId, periodEnd)`
- **API routes:** `POST /api/tests/run` → `{test_id, computed_dscr, passed, variance_flagged, exception_id?}`.

### Frontend & QA
- **State management:** Server Component reads `tests`; the run action is a Server Action with `revalidatePath`.
- **Components:** `TestResultCard`, `VarianceBadge`, `RunTestButton`.
- **Edge cases:**
  - **No approved terms for the period → refuse to run**, with "Approve covenant terms first". Never fall back to proposed terms (I-3).
  - A financial input missing → `tests.calc_error`, `computed_dscr` NULL, **no exception raised, no zero substituted**
  - Reported DSCR absent from the certificate → test still runs on our number; variance NULL
  - Ours passes, borrower **overstates** beyond tolerance → **log only, no investigation** (owner decision)
  - Ours passes, borrower **reports a failure** → **investigate** — a borrower self-reporting a breach may know something the documents do not yet show (resolves the PRD §2.3 #16 / spec §4.1b conflict; owner-approved 2026-10-05)
  - Re-running the same period → updates the existing row, does not duplicate
- **Testing checklist:**
  - [ ] F1 computes below threshold on the pre-amendment terms → exception raised
  - [ ] F3 computes below threshold → exception raised
  - [ ] A compliant borrower produces a `tests` row and **no** exception
  - [ ] Borrower overstating beyond tolerance sets `variance_flagged` **without** creating an exception
  - [ ] Borrower reporting a failure while we pass **does** create an exception
  - [ ] **F3: our 1.08 raises an exception even though the certificate says 1.31**
  - [ ] Missing financial input → `calc_error` set, `computed_dscr` NULL, no exception
  - [ ] Running without approved terms is refused
  - [ ] Our number, not the reported number, decides `passed`
  - [ ] Re-run is idempotent

---

# F8 — Investigation (Flow B, part 2)

*Stage 8 · depends on F5, F7*

### Product & UX
- **Description:** The orchestrator investigates an exception, delegating to three specialist agents and calling the calculator, then code polices the result.
- **User flow:** Exception → *Investigate* → casefile id returned immediately → live trace fills → guardrail + policy → `pending_review`.
- **Placement:** `app/investigations/[id]/page.tsx`.
- **Design:** Step trace — teal for agent steps, **amber for calculator steps**. The alternation is the demo.

### Data & Backend
- **Database schema:** Writes `casefiles`; updates `exceptions.status`.
- **Database tasks:** Create casefile `investigating` with `foundry_thread_id`/`foundry_run_id`; append each completed step to `trace`; on completion write recommendation, claims, calc_ids, guardrail_notes and set `pending_review` or `failed`.
- **Helper functions:**
  - `lib/agent/orchestrator.ts` → `startInvestigation(exceptionId): Promise<{casefileId: string}>`, `syncRun(casefileId): Promise<RunStatus>`
  - `lib/agent/foundry.ts` → `createAgents()`, `startRun(agentId, context)`, `getRunSteps(threadId, runId)` — orchestrator on `gpt-4.1-mini`, specialists on `gpt-5-mini` (see F5)
  - `lib/agent/trace.ts` → `mapRunStepsToTrace(steps): TraceEntry[]` — converts Foundry run steps into `{n, tool, input_summary, output_summary, ts}`. **`connected_agent` steps map to the specialist's name**, so the UI alternation (teal agent / amber calculator) falls out of the data.
  - `lib/agent/prompt.ts` → system prompt assembly with the rule set and memory lessons
  - `lib/memory.ts` → `buildExceptionProfile(exceptionId)`, `topLessons(facilityId, profile, 3)`
- **API routes:** `POST /api/investigate` → `{casefile_id}` immediately · `POST /api/investigate/sync` (internal, shared secret) — polls Foundry, mirrors steps, runs guardrail then policy.

### Frontend & QA
- **State management:** Client Component polling `casefiles` via the anon client every 1s until status is terminal.
- **Components:** `StepTrace`, `TraceStep`, `CasefileView`.
- **Edge cases:**
  - Step cap reached → `abstain` ("investigation incomplete") (PRD §2.3 #17)
  - Foundry run fails or stalls → `casefiles.status = failed` with a Retry action; **never rendered as a recommendation**
  - Guardrail forces abstain → notice shown, not hidden
  - Agent proposes a prohibited action → policy forces `escalate`
  - Malformed agent output → one retry, then `abstain`
  - An exception already under investigation → return the existing casefile, don't start a second
  - **A recomputation during an investigation never amends the originating `tests` row.** The test records what the *approved* terms produced — that is the audit fact. Re-boarding creates `covenant_terms` v2; re-running then produces a new `tests` row.
- **Testing checklist:**
  - [ ] `/api/investigate` returns `{casefile_id}` without waiting for the run
  - [ ] Each completed step appends one `trace` entry in order
  - [ ] F1 reaches `resolve` citing the **unboarded** Amendment No. 2, with two calculations logged, and recommends re-boarding as v2
  - [ ] F3 reaches `escalate`, having found the waiver **request** and determined it is not a granted waiver
  - [ ] The investigation context contains the approved terms version **and** the document inventory — without both, F1's path is unreachable
  - [ ] The originating `tests` row is unchanged after an investigation recomputes
  - [ ] A fabricated figure in the explanation forces `abstain`
  - [ ] A quoted covenant figure does **not** force abstain
  - [ ] Step cap → `abstain`, not a guess
  - [ ] Foundry failure → `failed` + Retry, never a recommendation
  - [ ] Investigating twice returns the same casefile

---

# F9 — Review, memory and screens

*Stage 9 · depends on F8*

### Product & UX
- **Description:** The analyst approves, overrides with a reason, or requests documents. An override becomes a retrievable lesson, and the next similar case resolves faster.
- **User flow:** Casefile → read recommendation, explanation, calculation table, claims → click a citation chip to verify → Approve / Override / Request docs. Override: reason → confirm suggested tag → corrected outcome.
- **Placement:** `app/casefiles/[id]/page.tsx`; queue at `app/page.tsx`; governance at `app/governance/page.tsx`.
- **Design:** Per `docs/design.md` §5 and §7. Guardrail notices always visible. `require_human_review` renders **locked**.

### Data & Backend
- **Database schema:** Writes `reviews`; updates `casefiles.status`.
- **Database tasks:** Insert review; on override embed `lesson_text` into `lesson_embedding`; on approve embed the casefile summary as a confirmed lesson.
- **Helper functions:** `lib/review.ts` → `submitReview(...)` · `lib/memory.ts` → `storeLesson(...)`
- **API routes:** `POST /api/review`.

### Frontend & QA
- **State management:** Server Components for reads; Server Action for submit; `revalidatePath` after.
- **Components:** `CasefileView`, `RecommendationBadge`, `CalcTable`, `CalcValue`, `CitationChip`, `ClausePanel`, `GuardrailNotice`, `ReviewActions`, `OverrideDialog`, `SeenSimilarBadge`, `GovernancePanel`, `Scoreboard`.
- **Edge cases:**
  - Override without a reason → blocked; the reason **is** the lesson
  - Reviewing an already-reviewed casefile → read-only
  - `request_docs` → `awaiting_docs`; uploading a document for that facility offers "Re-run investigation"
  - A claim with no citation must not render (I-6)
  - No lessons yet → `SeenSimilarBadge` hidden, not shown empty
- **Testing checklist:**
  - [ ] Approve sets `approved` and writes a review row
  - [ ] Override requires reason, corrected outcome and confirmed tag
  - [ ] Override reason is stored **verbatim** and embedded
  - [ ] Citation chip opens the clause panel with the quote highlighted
  - [ ] Guardrail notices render and cannot be collapsed
  - [ ] `require_human_review` renders locked
  - [ ] **F5 after an F1 override resolves in measurably fewer steps than F1**

---

# F10 — Deploy and evaluate ✅ DEPLOYED 2026-10-06 · HARNESS BUILT 2026-10-07

*Stage 10 · depends on F9 · live at `https://credit-scout.vercel.app` (one Vercel project, deploys `main`; runbook: `deploy-runbook.md`)*

### Product & UX
- **Description:** Public Vercel deployment behind a shared-credential demo gate, and the eval scoreboard.
- **User flow:** Governance page shows the latest cold/warm scoreboard, grouped Honest / Harmless / Helpful.
- **Placement:** `app/governance/page.tsx`.
- **Design:** `Scoreboard` — metric rows with target vs actual; the false-resolve row is a gate (0 = success, anything else danger); an unreported metric is an em dash, never 0.

### Data & Backend
- **Database schema:** Writes `eval_runs` (`mode` cold|warm, `metrics` jsonb).
- **Database tasks:** One row per pass; `metrics` carries the scoreboard keys (`components/scoreboardModel.ts` is the contract) plus `pass`, `run_id` and per-case detail.
- **Helper functions:** `evals/grade.mjs` — pure grading (`loadOracle`, `gradeCalculation`, `gradeLive`, `summariseCalculation`, `summariseLive`, renderers). `evals/run.mjs` — the CLI: `npm run eval` (deterministic), `--write` (record the row), `--live` (cold + warm through the real agent; billable), `--only A,B`.
- **Live pass mechanics:** imports `runTest` → `startInvestigation` → `syncRun` loop → `submitReview` (warm only) directly from `lib/`, passing an explicit service-role client; run under `--conditions=react-server` so `server-only` resolves to its empty build. Each pass has its own `eval-<stamp>-<mode>` run_id.

### Frontend & QA
- **State management:** Server Component read.
- **Components:** `Scoreboard`.
- **Edge cases:**
  - **The runner refuses to start while any `owner_signed_off` is `NO`** — non-negotiable; and `generate()` refuses to overwrite a signed oracle
  - A loan the oracle names that is not in the database is **skipped and reported**, never scored
  - A casefile that ends `failed` is an outcome miss, not a false resolve; a case still `investigating` after 15 minutes aborts the run with the casefile id
  - Cold and warm are **separate run_ids** — lessons are retrieved per run_id, so cold never sees warm's reviews and nothing clears globally
- **Testing checklist:**
  - [x] Runner aborts with a clear message on an unsigned expected-values row (`evals/grade.test.js`)
  - [x] Calculation accuracy is 100% against the owner's values — 12/12 figures, recorded in `eval_runs`
  - [x] Outputs `results.csv`, `report.md`, and an `eval_runs` row (`foundry-<mode>.jsonl` on a live pass)
  - [x] Deployed URL serves all screens; no service-role key in the client bundle
  - [ ] Live cold and warm passes run (billable — owner's go)
  - [ ] **False-resolve count is 0** on the live passes
  - [ ] Warm pass shows fewer mean steps than cold

---

## Ambiguities found in the engineering document

**All six resolved 2026-10-05.** Kept as a record of what was decided and why.

| # | Ambiguity | Why it matters | Resolution |
|---|---|---|---|
| **A-1** ✅ | **Who triggers a quarterly test?** §7 defines `POST /api/tests/run` taking one `facility_id` + `test_period_end`, but never says whether the analyst runs it per borrower or runs a whole quarter at once. | The portfolio screen needs one button or many, and the demo reads very differently: "run the quarter" shows all three outcomes at once, which is the point of end-to-end. | **Add `POST /api/tests/run-quarter {test_period_end}`** that loops every facility with approved terms. Keeps the per-facility route for re-runs. |
| **A-2** ✅ | **`tests` has no `run_id`.** `casefiles` has one to separate eval runs from demo data; `tests` does not. | An eval pass would write `tests` rows into the demo portfolio and trip the `UNIQUE (facility_id, test_period_end)` constraint against demo data. | **Add `run_id text` to `tests`** and include it in the unique constraint. Small schema change, better caught now than during the eval. |
| **A-3** ✅ | **Does ingesting a certificate auto-trigger a test?** The certificate carries its own `test_period_end`. | Determines whether the demo is "upload → test runs" or "upload, then click run". | Keep them separate. Explicit is better on camera, and auto-running hides the independent-computation moment. |
| **A-4** ✅ | **Who owns the `exceptions.status` transition** vs `casefiles.status`? Both carry `investigating` and `pending_review`. | Two sources of truth drift. | **`casefiles.status` is authoritative**; `exceptions.status` mirrors it. Or drop the overlapping values from `exceptions`. |
| **A-5** ✅ | **Foundry thread reuse on retry** — same thread or a new one? | A retry on the same thread inherits the failed context, which may re-fail the same way. | New thread per attempt; keep `foundry_thread_id` as the latest. |
| **A-6** ✅ | **`reported_dscr` when no certificate exists.** | §6.5 allows NULL but §4.1b's outcome table assumes a borrower figure. | NULL `reported_dscr` → `variance` NULL, `variance_flagged` false. The test still runs on our number. Already specified in F7; the engineering doc should say it too. |

---

## Build order checklist

- [x] **F0** Schema + RLS — `supabase db push` green
- [x] **F1** Deterministic core — `npm test` green, no model, no network
- [x] **F2** Synthetic facilities + expected-values template — oracle signed 2026-10-07 (10 cases)
- [x] **F3** App shell + design tokens — build passes, no key leaks, tokens only
- [x] **F4** Ingest — chunks land in the database
- [x] **F5** Agent tools — spike passed; routes built; specialists revised to in-process function tools
- [x] **F6** Covenant setup — terms proposed, cited, approved, versioned
- [x] **F7** Quarterly test — all three facilities tested; F1 and F3 raise exceptions
- [x] **F8** Investigation — F1 resolves, F3 escalates; guardrail downgrade verified live
- [x] **F9** Review + memory + screens — F1 override makes F5 faster ("seen similar" verified live)
- [~] **F10** Deploy + eval — public URL ✓, scoreboard ✓, calc accuracy 100% recorded ✓; **live cold/warm passes pending (billable)**
- [x] **F11** Loan onboarding wizard — spec `docs/superpowers/specs/2026-10-07-onboarding-flow-design.md`; verified live with the five synthetic packages

**Status 2026-10-07:** F0–F11 built and deployed. The remaining open box is the
billable live eval. Backlog in `docs/parking-lot.md` §4.

**F7 is the floor.** If everything after it collapses, F0–F7 is still a working
product: ingest, human-approved covenant terms, deterministic quarterly testing,
exception detection. That is also exactly what the kill switch degrades to in
production.
