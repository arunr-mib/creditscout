# CreditScout — Product Requirements Document

**PRD Template for AI Products · Maven "Master Agentic AI for PMs and FDEs", Cohort 10**

| | |
|---|---|
| **Product** | CreditScout — an AI work assistant for credit analysts in commercial lending |
| **Author** | Arun Rajendiran |
| **Mentor POC** | Yashshree |
| **Date** | 2026-10-05 |
| **Status** | Draft for review |
| **Companion docs** | `docs/eng.md` (HLD) · `docs/spec.md` (LLD) · `docs/superpowers/specs/2026-10-01-creditscout-design.md` (design spec) |

> **One line:** A reasoning layer decides what evidence to inspect next. A
> calculation layer never guesses. A human always approves.

### How this PRD responds to pitch review

Yashshree's feedback on the original pitch is incorporated rather than
appended. For traceability:

| Feedback | What changed |
|---|---|
| "Narrow it to one covenant type" | Scope is **DSCR only**, tested quarterly on a TTM basis (§2, §3) |
| "Treat the Risk Officer as a config file rather than a second user" | The Credit Risk Officer is a **policy table**, not a persona with screens (§1.2, §2.2) |
| "5–10 synthetic facilities, each with one amendment or waiver" | **6 synthetic facilities**, each with an amendment or waiver (§7) |
| "Build 20–30 expert-labeled test cases" | **24 labeled cases** = 6 facilities × 4 variations, owner-signed (§5) |
| "Make analyst-override memory the centerpiece of the demo" | F1 → F5 memory effect is the demo's centerpiece and a tracked metric (§1.5, §6) |
| "Regulatory exposure: must stay decision support" | Hard-coded: `require_human_review` is a **locked** policy value (§8) |
| "Monetization and go-to-market aren't stated" | §9 — pricing model, TAM/SAM, revenue scenarios, directional pricing |
| "Real loan files won't be available" | **100% synthetic data**, every document marked `SYNTHETIC — FOR DEMONSTRATION` (§7) |

---

# Week 1

# Section 1. PROBLEM DEFINITION

## 1.0 Hypothesis

> **We believe that independently recomputing every covenant test from
> human-approved, citation-backed terms — instead of trusting the borrower's
> reported figure — will let a credit analyst at a regional bank, commercial
> lender or credit union close a covenant exception in under 30 minutes instead
> of ~2.5 hours, with zero false resolutions, because the evidence that resolves
> an exception is scattered across an agreement, its amendments and a
> certificate that no rules engine can read.**

Three things make this testable rather than aspirational:

| Claim | How it fails |
|---|---|
| Under 30 minutes | Measured time-to-decision stays above 30 min on the eval set |
| Zero false resolutions | A single `resolve` on a case whose expected outcome is not resolve |
| Independent recomputation adds value | No eval case exists where our number fails while the borrower's passes |

The third is the one worth watching. If it never fires, the end-to-end
redesign bought nothing over exception triage, and we should say so.

## 1.1 What problem is this solving?

Commercial credit analysts monitor portfolios of 30+ borrower facilities and
test financial covenants every reporting cycle. When a borrower's reported
ratio comes in below its threshold, a rules engine can flag it. What the rules
engine cannot do is the **investigation that follows**.

That investigation requires the analyst to:

1. Find the covenant definition **actually in force** — which means reading a
   60-page credit agreement *and* every amendment and waiver layered on top of
   it, and working out which one governs this test period.
2. Recompute the ratio on the right basis — the correct EBITDA definition, the
   permitted add-backs, the caps on those add-backs, the right denominator
   components, the right trailing period.
3. Explain the gap between that number and the borrower's own reported figure.
4. Judge whether the evidence is good enough to **resolve** the exception,
   **escalate** it, or **request** more information — and defend that judgment
   in a credit file that an auditor may read years later.

Today this is unstructured work done under deadline pressure, against documents
that arrive in inconsistent formats, with the answer buried across four or five
of them.

**The job to be done:**

> *"A covenant looks breached. Tell me whether it really is, show me the
> evidence it's based on, and tell me what to do next — before my review is
> due."*

**What CreditScout is not:** it never makes a credit decision. It produces a
cited recommendation; a human analyst approves or overrides it, and that
override becomes memory for later cases.

## 1.2 Who are you solving this problem for?

**Primary persona — the commercial credit analyst**

| Attribute | Detail |
|---|---|
| Role | Credit analyst / portfolio monitoring analyst |
| Institution type | **Regional banks, commercial lenders, and credit unions.** Explicitly **not** the large money-centre banks — they have internal platform teams and multi-year procurement cycles. |
| Industry served | Commercial lending to SMB borrowers and startups |
| **Where they sit** | **Onshore (US/UK) and offshore.** A large share of covenant monitoring for Western lenders is performed from **India-based global capability centres** — India hosts 130+ BFSI GCCs employing 537,000+ professionals. The persona is as likely to be in Bengaluru as in Charlotte, which has product consequences: asynchronous handoffs between offshore preparation and onshore approval, and a reviewer who may never have spoken to the borrower. |
| Portfolio | 30+ borrowers under active monitoring |
| **Share of their time on covenant monitoring** | **20–30%** *(owner's figure, from credit-systems experience)* — this is the slice of the job CreditScout addresses |
| Workflow | Quarterly covenant testing cycles driven by borrower compliance certificates; periodic full credit reviews |
| Inputs they work from | Credit agreements, amendments, waivers, compliance certificates, borrower financial statements, prior credit notes |
| Measured on | Timely, accurate reviews; defensible credit files; no missed breaches |
| Pain | The investigation behind a single contested exception consumes hours. Published vendor figures put the DSCR recomputation alone at **30–40 minutes manual vs. under 3 minutes AI-assisted**; the document archaeology around it takes longer still. |
| Current tooling | Spreadsheets, email, the loan document system, and institutional memory |

**Why not large banks.** They are the obvious-looking buyer and the wrong first
customer: long procurement, internal build-vs-buy bias, and existing platform
investments. Regional banks, commercial lenders and credit unions have the same
covenant obligations and the same analyst constraints, with none of the internal
engineering capacity — which is exactly the gap a product fills.

**Secondary "persona" — the Credit Risk Officer, implemented as configuration**

Per mentor feedback, the Risk Officer is **not a second user with screens**. The
governance function is represented as a `policy` table the Risk Officer owns:
variance tolerance, escalation thresholds, prohibited actions, step cap, and a
**locked** human-review requirement. This is visible read-only on a Governance
page. Treating governance as config rather than a user keeps the MVP honest
about what is actually being built.

**Explicitly out of scope as users:** relationship managers, borrowers, and the
credit committee.

## 1.3 Why is this problem worth solving?

**Quantified pain**

- Credit teams "rely on spreadsheets, emails, and manual reviews to track
  covenant compliance, a process that is resource-intensive, prone to errors,
  and difficult to scale across hundreds or thousands of loans."
- Analysts spend time "renaming files, rekeying figures, checking formulas, and
  reconciling periods before they can even begin the credit review."
- Vendor-reported benchmarks claim **~75% reduction in manual covenant review
  effort** and **50%+ analyst time reduction** from automation, with DSCR
  calculation specifically dropping from **30–40 minutes to under 3 minutes**.
- **Covenant monitoring consumes 20–30% of a commercial credit analyst's time**
  *(owner's figure, from credit-systems experience)*. That is the addressable
  slice — not a sliver of the job, but a quarter of it.
- There were **73,200 credit analysts employed in the US** as of May 2023 (BLS),
  **33,550** of them in Credit Intermediation and Related Activities — the
  segment containing commercial banks and credit unions.
- The target institution base is large and fragmented: **4,214 federally insured
  credit unions** (NCUA, June 2026) plus roughly **4,600 FDIC-insured banks**,
  of which only a few dozen are money-centre institutions. Fragmentation is the
  opportunity — none of these can build this themselves.

*Note on the vendor figures above: these are supplier-published claims, not
independent studies. They are directionally useful for sizing the pain, and are
treated as marketing claims rather than measurements throughout this PRD.*

**Customer evidence — the weakest part of this PRD, stated plainly**

A PRD without customer evidence is built on assumptions. Here is exactly what we
have and what we don't:

| Evidence type | Status |
|---|---|
| Practitioner domain input | **Have** — the author has commercial credit-systems experience. Legitimate, but it is **n=1 and the author is also the product owner**, which is the weakest possible form of user research. |
| Published market data | **Have** — BLS headcount, category sizing, institution counts (cited below) |
| Vendor benchmarks | **Have, discounted** — supplier marketing, treated as directional only |
| **Analyst interviews** | **`[NEED: 5 interviews with credit analysts at regional banks / credit unions]`** — Owner · before design-partner outreach |
| **Support tickets / usage data** | **`[NEED: n/a pre-launch]`** — unavailable until a design partner is live |
| **Direct customer quotes** | **`[NEED: 3+ verbatim quotes on covenant investigation pain]`** — Owner · before Launch gate |

**This is not fabricated and will not be.** No invented quotes, no invented
survey percentages. The honest position for a course MVP is that the problem is
grounded in practitioner experience and market data, and that primary user
research is a Launch gate, not an MVP gate.

> **Parked for discussion — see `docs/parking-lot.md` §1.** The owner has
> deliberately deferred closing this gap rather than letting it block the build.

**Why now**

Three things that were not simultaneously true 18 months ago:

1. **Frontier models can now hold a full credit agreement plus amendments in one
   context** (1M-token windows), which is what makes amendment-precedence
   reasoning tractable at all.
2. **Tool-calling and multi-agent orchestration became managed infrastructure**
   (Azure AI Foundry Agent Service, Connected Agents) rather than something each
   team hand-rolls — so a small team can build this.
3. **Covenant exception volume rises when credit quality softens**, precisely
   when regional lenders are least able to add analyst headcount.
   `[NEED: current SMB/middle-market delinquency trend data to support this]` —
   Owner · before the pitch. Stated as a mechanism, not yet as a measured trend.

**The market gap**

Existing categories each solve a neighbouring problem and stop short of this one:

| Category | Examples | What it does | What it does not do |
|---|---|---|---|
| Loan origination / servicing | nCino, Baker Hill | Workflow, approvals, servicing | Does not read agreements to determine effective terms |
| Covenant tracking | CovenantFlow, Covaleyo, Cardo AI | Tracks *that* a covenant was tested, dates, status | Tracks the calendar, not the investigation |
| Spreading tools | SpreadSense and peers | Extracts financial statements into standard templates | Produces inputs, not conclusions |
| General LLM chat | ChatGPT, Claude, Copilot | Summarises a document you paste in | No facility history, no governed calculation, no audit trail, no safe abstain |

The **Loan Compliance Monitoring market is valued at ~$2.87B in 2026, growing to
~$5.14B by 2030 (15.7% CAGR)** — so the budget line exists. What is missing is a
product that does the *reasoning* step rather than the tracking step.

**MOAT — four compounding sources**

1. **Validated covenant specifications.** Agreements and amendments mapped into
   executable, schema-validated terms. This mapping — amendment precedence,
   custom EBITDA definitions, capped add-backs — is the hard part, and it
   accumulates per lender.
2. **Deterministic calculation with citations.** Covenant math runs outside the
   LLM in versioned code. Every conclusion cites source documents. This is what
   makes the output auditable, which is what makes it usable in a regulated
   credit file.
3. **Evaluation harness with expert-validated test cases.** We can measure
   whether CreditScout identified the right terms, calculated correctly, cited
   sufficient evidence, and chose the right outcome. Competitors shipping LLM
   wrappers cannot produce this number.
4. **Lender-specific learning.** Amendments, prior exceptions, analyst overrides
   and resolved casefiles become proprietary retrieval context. Each cycle
   starts informed by how similar cases resolved at *this* lender. This is the
   compounding asset and the thing a generic chatbot structurally cannot build.

**Differentiation from ChatGPT / Claude / Copilot / Co-Work**

A general assistant can summarise a credit agreement you paste into it. It
cannot: maintain facility-level history across quarters, retrieve the right
records from the credit file, run a governed calculation whose inputs and
outputs are logged under a calculation ID, enforce a Risk Officer's policy,
measure its own repeatable performance against a labeled set, or **safely
abstain when the evidence is incomplete**. CreditScout's value is the
workflow and the grounding around the model, not the model call.

## 1.4 Why Agentic AI?

**What is deterministic here — and should stay that way.** A rules engine is the
right tool for covenant formulas, thresholds, approval limits, reporting dates
and workflow status. If a reported DSCR is below its stated threshold, a rule
flags it. We keep that. CreditScout does not replace the rules engine; it starts
where the rules engine stops.

**What unstructured data is involved**

| Source | Why it defeats rules |
|---|---|
| Credit agreements (40–80pp) | Definitions articles phrase the same concept a dozen ways across lenders and vintages |
| Amendments and waivers | Modify definitions by reference; precedence depends on effective dates and scope |
| Compliance certificates | Borrower-prepared, non-standard forms, occasionally wrong |
| Borrower financial statements | Inconsistent line-item naming and presentation |
| Prior credit notes | Free-text analyst reasoning from earlier cycles |

**Why rule-based systems fail at the investigation.** A fixed rule set would have
to enumerate every document variation, every amendment pattern, every exception
type and every investigation path. Even assuming you could write it, it would be
brittle: a single counterparty phrasing "Consolidated EBITDA" as "Adjusted
EBITDA (as defined herein)" breaks a keyword rule. And rules cannot *explain* —
they can flag a hit, not tell an analyst why a gap exists.

**Why an agent, and not just an LLM call.** The investigation is genuinely
path-dependent. The evidence that resolves facility F1 (an amendment permitting
a restructuring add-back) is not the evidence that resolves F2 (a certificate
computed on the wrong test period). An agent decides what to inspect *next*
based on what it has already found. The loop is:

```
potential exception
   → retrieve and verify the effective covenant terms
   → calculate deterministically  (CODE — never the model)
   → investigate the discrepancy and its drivers
   → judge whether the evidence is sufficient
   → explain, with citations, and recommend an action
   → HUMAN REVIEW  (always)
```

**The division of labour — the idea that settles every design question**

| Responsibility | Owner |
|---|---|
| Flagging a potential exception | **Code** |
| Deciding what to inspect next | Model |
| Reading agreements, amendments, waivers, certificates | Model |
| Mapping the DSCR definition into structured terms | Model, schema-validated |
| **All arithmetic, comparisons, rounding** | **Code** |
| Forming and testing hypotheses for a gap | Model |
| Judging evidence sufficiency | Model, bounded by code guardrails |
| Writing the cited explanation | Model |
| **Guardrails, policy enforcement** | **Code** |
| **Final decision** | **Human analyst, always** |

The practical consequence: **the model is never allowed to produce a number.**
Every figure in an explanation must trace to a logged calculation or a verbatim
quote from a cited document, or a code guardrail forces the recommendation to
`abstain`.

## 1.5 How will you know the problem is solved? — Core Metrics

**North Star Metric**

| Metric | Baseline | Target | How tracked |
|---|---|---|---|
| **Time-to-decision** — median analyst time from exception flagged to analyst-approved outcome | ~2–3 hours per contested exception *(estimate from owner's credit-systems experience, consistent with the 30–40 min DSCR-recomputation figure plus document review; not a measurement)* | **< 30 minutes** | Timestamp delta between `exceptions.created_at` and the `reviews` row, from application logs |

**Primary metrics** — these decide whether the product is trustworthy

| Metric | Baseline | Target | How tracked |
|---|---|---|---|
| **False-resolve rate** — recommends `resolve` when the expected outcome is not resolve | n/a (no tool today) | **0** — non-negotiable gate | Eval harness over 24 labeled cases |
| **Calculation accuracy** — DSCR matches independently computed expected value to 2dp | Manual, error-prone | **100%** | Unit tests + eval harness, against owner-computed spreadsheet values |
| **Outcome accuracy** — recommended outcome matches expected outcome | n/a | **≥ 85%** | Eval harness |

**Secondary / supporting metrics**

| Metric | Target | How tracked |
|---|---|---|
| Correct abstain/request on incomplete-evidence cases | ≥ 90% | Eval harness (cases F2, F4) |
| Citation hit rate — expected key clause actually cited | ≥ 90% | Eval harness |
| Groundedness | Reported | Azure AI Foundry Evaluations, LLM judge |
| **Memory effect** — avg steps per investigation, cold vs. warm memory | Visible reduction (target: F5 resolves in ~3 steps vs. F1's ~6) | `casefiles.steps_count`, compared across eval runs |
| Cost per investigation | < $1 | Azure usage metrics per run |
| Analyst override rate | Tracked, not targeted | `reviews.decision` distribution |

**Guardrail metrics — what must not get worse**

Targets tell you what to chase. Guardrails stop you chasing one metric off a
cliff. Each of these has a ceiling, and breaching one blocks a release even if
every target above is met.

| Guardrail | Ceiling | Why it exists |
|---|---|---|
| **Abstain rate** | **≤ 25% of cases** | **The most important guardrail in the product.** A system that abstains on everything scores a perfect 0 false resolves while delivering nothing. Without a ceiling, the headline metric can be gamed by cowardice. |
| `request` rate | ≤ 25% of cases | Same failure in a different costume — endlessly asking for documents instead of concluding |
| Cost per investigation | ≤ $1 | Runaway agent loops; also the lever that keeps gross margin honest |
| Steps per investigation | ≤ `policy.max_steps` (8) | Caps cost and latency; breaching it forces abstain rather than a guess |
| Guardrail-forced abstain rate | ≤ 15% of cases | A high rate means the *prompt* is broken, not that the model is dangerous |
| Calculation errors returned | 0 unexplained | The calculator erroring is correct behaviour on missing input; an error with complete inputs is a defect |

**Why false-resolve is the gate and not just a metric.** A product that
escalates too often wastes analyst time. A product that resolves a real breach
creates regulatory and credit exposure. Those failures are not symmetric, so the
system is tuned to abstain under uncertainty and the metric is a hard zero.

**The trap this metric hides, and how we avoid it.** A guardrail that accepts
*only* calculated numbers would force `abstain` on every well-formed
explanation — because legitimate explanations quote figures from the covenant
("the covenant requires 1.25x"). False-resolve rate would read a perfect 0 while
the product did nothing useful. Quoted figures are therefore valid evidence, and
numbers are compared after normalisation rather than as text. This is tested
explicitly.

---

## 1.6 Non-Goals

Stated before the solution, deliberately — this is the cheapest defence against
scope creep, and several of these have already been argued once.

**We are NOT:**

- **Making credit decisions.** Ever. `require_human_review` is a locked policy
  value, not a setting. This is a regulatory boundary, not a product choice.
- **Building other covenants in V1.** DSCR only, quarterly, trailing-twelve-month.
  Leverage, fixed-charge coverage and liquidity are MVP-1 at the earliest.
- **Doing OCR.** Text-based PDFs only. A scanned agreement is rejected, not
  guessed at.
- **Extracting financials from statement tables.** That is a spreading problem
  and a different product. Our synthetic financials print each figure as a
  labeled line, and the agent cites it.
- **Scoring borrower creditworthiness.** We check whether a contractual ratio was
  met against contractual terms. We never touch protected characteristics —
  which is what keeps this out of fair-lending model territory.
- **Replacing the rules engine.** It still flags thresholds. We start where it
  stops.
- **Building auth, multi-user, roles or mobile** in the MVP.
- **Selling to large money-centre banks** as the first customer. Long
  procurement, build-vs-buy bias, existing platform investment.
- **Investigating a variance when both numbers clear the threshold.** We log it.
  Investigations are reserved for real exceptions — a deliberate cost choice.
- **Using real bank data.** 100% synthetic, every document marked
  `SYNTHETIC — FOR DEMONSTRATION`.

**Considered and cut, with reasons:**

| Cut | Why |
|---|---|
| n8n Cloud as orchestrator | Unresolvable licensing unknown; replaced by Foundry Agent Service, which also gives traces and matches the production story |
| Per-seat pricing | Penalises adding reviewers — the opposite of the oversight behaviour the product depends on |
| Per-investigation pricing | Charges most in the quarters when borrowers are most distressed, which is when the tool matters most |
| Volume pricing tiers | Premature before measured usage; flat $5 until there is evidence |
| Facilities F2, F4, F6 | F1/F3/F5 already cover resolve, escalate and the memory effect |

---

# Section 2. SOLUTION DEFINITION

## 2.1 User Flows

### The flow at a glance

```
INPUT                     PROCESSING                        OUTPUT
─────                     ──────────                        ──────

Quarterly package    ┌─► Ingest: extract text,          Exception appears
(certificate,        │   chunk by section,              in the analyst's
financials,          │   embed, store                   queue with reported
agreement,           │                                  vs. required DSCR
amendment)      ─────┤
                     │   Certificate check:
                     └─► reported DSCR vs. threshold
                         → below? create exception

Analyst clicks       ┌─► Load memory: prior cases
"Investigate"   ─────┤   + top 3 lessons
                     │
                     ├─► ORCHESTRATOR AGENT loop ──┐    Live step trace,
                     │     ├ document_agent        │    updating as the
                     │     ├ definition_agent      │    agent works
                     │     ├ dscr_calculator (CODE)│
                     │     ├ research_agent        │
                     │     └ search_past_cases     │
                     │   ◄──────────────────────────┘
                     │
                     ├─► GUARDRAIL (code): every
                     │   number traces? every quote
                     │   verbatim? → else ABSTAIN
                     │
                     └─► POLICY (code): variance
                         tolerance, breach depth,
                         prohibited actions

                                                    Cited casefile:
                                                    recommendation,
                                                    explanation, calc
                                                    table, citation chips

Analyst reviews  ────► Approve / Override / Request  Outcome recorded;
                       docs                          override becomes a
                                                     lesson in memory
```

> **Visual diagram:** `docs/diagrams/creditscout-user-flow.svg` — deck-ready,
> colour-coded (teal = model, amber = code, white = human), showing Flow A
> (covenant setup, with the four-eyes approval checkpoint) and Flow B (quarterly
> monitoring, with all three test outcomes). The conceptual framing behind it is
> in `docs/mental-model.md`.

**Note — the flow below describes end-to-end monitoring.** Earlier drafts of
this PRD started the loop at "the borrower reported a figure below threshold".
That was too narrow: it meant the system only ever checked borrowers whose own
arithmetic had already raised a flag, and a borrower wrong in their own favour
was invisible. The flow now **computes independently for every borrower every
quarter**, and treats the borrower's reported figure as evidence to reconcile
against rather than as the trigger.

### Detailed flow

1. **Input.** The analyst uploads a borrower's quarterly package — compliance
   certificate, financials, and (first time) the credit agreement and any
   amendment or waiver. Text-based PDFs. An optional email intake path can
   receive certificates automatically.
2. **Ingest.** Documents are split into section-level chunks using legal
   headings (`§`, `Section`, `ARTICLE`), embedded, and stored with metadata
   tying each chunk to its facility, document and section. Citations are by
   **document + section**, because PDF text extraction does not preserve page
   numbers reliably.
3. **Exception detection (code).** For a compliance certificate, the model
   extracts a fixed schema — borrower, test period, reported DSCR, stated
   requirement — and **code** compares the reported figure to the threshold.
   Below threshold creates an exception. This step is deliberately deterministic.
4. **Investigation (agent).** The orchestrator loads memory, then decides what
   to inspect. It delegates to three specialist agents and calls a deterministic
   calculator. Every tool call appends a step to a live trace. The loop is capped
   by `policy.max_steps`.
5. **Output.** A casefile containing: a recommendation (`resolve` / `request` /
   `escalate` / `abstain`), an explanation under 150 words, a list of claims each
   with citation and verbatim quote, the calculation IDs behind every number,
   any missing evidence, and a suggested pattern tag.
6. **Human review.** The analyst approves, overrides (with a reason and a
   corrected outcome), or requests documents. Overrides are embedded as lessons
   and retrieved on later cases.

### How AI drawbacks are addressed

| Drawback | Mitigation |
|---|---|
| **Hallucinated numbers** | The model cannot produce a number. Every figure in the explanation must match a value in this casefile's calculation log, or a figure quoted verbatim in a cited chunk — compared after normalisation. Otherwise the recommendation is forced to `abstain`. |
| **Hallucinated quotes** | Every claim's quote must appear verbatim in a chunk of the document and section it cites. Non-matching claims are removed; if the recommendation depended on one, it is forced to `abstain`. |
| **Overconfidence** | `resolve` requires at least one passing calculation **and** cited effective terms. Without both, it is downgraded to `escalate`. |
| **Runaway cost / looping** | A step cap from the policy table. Reaching it forces `abstain` with "investigation incomplete" — never a guess. |
| **Explainability** | The analyst sees the full step trace, a calculation table with each component and its calculation ID, and citation chips that open the exact clause text with the quote highlighted. Every forced guardrail change is shown, not hidden. |
| **Automation bias** | Human review is a **locked** policy value. The product is positioned as decision support; the UI never presents a recommendation as a decision. |
| **Silent failure** | A platform, model or database failure marks the casefile `failed` with a Retry action. A failure is never rendered as a recommendation. |

## 2.2 Functional Requirements

### User stories

| ID | User story | Acceptance criteria | Priority |
|---|---|---|---|
| **US-000** | As an analyst, I want the agent to extract the covenant from the credit agreement into executable terms that **I approve**, so every future quarter is tested against terms a human has signed off | Agent proposes threshold, EBITDA basis, add-backs, caps, denominator components and effective dates, **each with a citation and verbatim quote**; analyst reviews each beside its source clause and approves or edits; approved terms are versioned and effective-dated; an amendment creates a new version rather than overwriting | **P0** |
| **US-001** | As an analyst, I want the system to **independently compute** the covenant each quarter for every borrower, so a borrower whose arithmetic is wrong in their own favour is still caught | Accepts text PDFs; loads the approved terms in force for the test period; **code computes DSCR from the financials and compares it to the threshold** — the borrower's reported figure is reconciled against ours, not used as the trigger; failing calculation creates an exception | **P0** |
| **US-001b** | As an analyst, I want to be told when our number and the borrower's disagree even though both pass, so I know their reporting is unreliable before it matters | Variance beyond `variance_tolerance` is **logged against the facility**; no investigation is started (deliberate — investigations are reserved for real exceptions) | **P1** |
| **US-002** | As an analyst, I want the agent to investigate a flagged exception and produce a recommendation, so I don't have to do the document archaeology myself | Returns `resolve` / `request` / `escalate` / `abstain` with explanation ≤150 words, claims, calculation IDs, missing evidence and a suggested tag | **P0** |
| **US-003** | As an analyst, I want every number in the explanation to be traceable, so I can defend the conclusion in the credit file | Each figure matches a logged calculation output or a verbatim quote in a cited chunk; untraceable figures force `abstain` with a visible note | **P0** |
| **US-004** | As an analyst, I want to see each clause the agent relied on, so I can verify it myself in seconds | Citation chips open a side panel with the exact clause text and the quote highlighted | **P0** |
| **US-005** | As an analyst, I want to watch the investigation as it runs, so I can tell whether it is reasoning sensibly | Live step trace updates roughly once per second, showing tool, input summary and output summary per step | **P0** |
| **US-006** | As an analyst, I want to approve or override the recommendation and have my reasoning retained, so the system learns from me | Override requires a reason, a corrected outcome and a confirmed pattern tag; the reason is embedded verbatim as a lesson | **P0** |
| **US-007** | As an analyst, I want the system to ask for a missing document rather than guess, so an incomplete file never produces a false resolution | Missing cited evidence produces `request` or `abstain` with the specific document named in `missing_evidence` | **P0** |
| **US-008** | As an analyst, I want a later similar case to benefit from what was learned earlier, so repeat patterns get faster | A facility with a matching prior lesson reaches its outcome in measurably fewer steps; the queue shows a "seen similar" badge | **P0** |
| **US-009** | As a Risk Officer, I want the governance levers visible and the human-review requirement locked, so oversight is auditable | Governance page shows current policy values; `require_human_review` renders as locked | **P1** |
| **US-010** | As an analyst, I want to see how accurate the system has been, so I know how much to trust it | Governance page shows the latest eval scoreboard, cold vs. warm | **P1** |
| **US-011** | As an analyst, I want compliance certificates to arrive by email without manual upload | Email with PDF attachment matched to a facility with high confidence runs ingest; ambiguous matches go to a `needs_filing` queue and never guess the facility | **P2** |

P0 = required to prove the hypothesis · P1 = ship if possible · P2 = stretch

### Agent capabilities and system behaviour

| Agent / component | Input | Output | Autonomy | Human-in-loop trigger |
|---|---|---|---|---|
| **Ingest & chunking** | Uploaded PDF | Section-level chunks with metadata | Fully autonomous | Extraction failure → document rejected with a reason |
| **Certificate check** | Certificate text | `{borrower, test_period_end, reported_dscr, required_dscr_stated}` | Autonomous, schema-validated | Schema failure → `needs_filing` queue |
| **Orchestrator** | Exception + memory lessons | Casefile: recommendation, explanation, claims, calc IDs | **Suggests; never decides** | **Always** — every casefile goes to a human |
| `document_agent` | Question + facility scope | Facts with `{citation, quote}` | Autonomous, quote-verified downstream | — |
| `definition_agent` | Agreement + amendments | `terms` JSON, schema-validated, with citations | Autonomous, quote-verified downstream | Mapping failure → missing evidence |
| **`dscr_calculator`** | `terms` + six financial figures | `{calc_id, components, dscr, threshold, pass, margin}` | **Deterministic code — no model** | Missing input, denominator ≤ 0, or unknown component → returns an error, never a default |
| `research_agent` | A gap to explain | Findings with citations | Autonomous | Nothing found → `escalate` |
| `search_past_cases` | Exception profile | Matching lessons from prior casefiles | Autonomous | — |
| **Guardrail** | Draft casefile | Validated casefile + guardrail notes | **Deterministic code** | Any forced downgrade is displayed to the analyst |
| **Policy** | Validated casefile | Final recommendation | **Deterministic code** | Prohibited action proposed → forced `escalate` |

## 2.3 AI behaviour specification

Twenty behaviours that define correct operation. **This table is the source for
the eval cases and the guardrail unit tests** — it is a build artifact, not
documentation.

### A. Calculation layer — code, must be exactly right

| # | Input / situation | Expected output | Why it matters |
|---|---|---|---|
| 1 | Terms + all six financial figures present and valid | `{calc_id, components, dscr, threshold, pass, margin}` | The happy path |
| 2 | DSCR computes to 1.2549 | **1.25** (half-up to 2dp) | Half-up, not banker's rounding — 1.2549 → 1.25, but 1.2550 → **1.26** |
| 3 | Add-back of 800,000 against a cap of 500,000 | Add-back applied as **500,000** | Caps are contractual limits, not suggestions |
| 4 | Add-back with **no `cap` field**, or `cap: null` | Treated as **uncapped** | Reading absent-as-zero flips F1 from a correct resolve to a false escalation |
| 5 | EBITDA is **negative** | Returns a **negative DSCR**, `pass: false` | A struggling borrower is a legitimate result, not an error |
| 6 | Denominator is **0** or negative | `{error}` — never a number | Division by zero must never silently produce Infinity |
| 7 | A required financial figure is **missing** | `{error: missing input}` | **Never defaults to zero.** Defaulting understates the numerator and fabricates a breach |
| 8 | Terms name an add-back absent from the financials | `{error}` | Silent zero would understate the numerator |
| 9 | Unknown component name in `terms.denominator` | `{error: unknown component}` | Refuse rather than guess what the drafter meant |
| 10 | `calcId` not supplied by the caller | `{error}` | The pure function never generates its own id — that is what makes tests deterministic |

### B. Agent layer — judgment, must be well-bounded

| # | Input / situation | Expected behaviour | Why it matters |
|---|---|---|---|
| 11 | Our DSCR fails; an amendment permits an add-back that fixes it | Find the amendment, **re-map terms, recompute**, then `resolve` with both calculations cited | F1 — the core investigation |
| 12 | Our DSCR fails; nothing in the file explains it | `escalate` — do **not** keep searching to manufacture a reason | F3. Finding nothing is a valid finding |
| 13 | Certificate cites a waiver that is not in the document set | `abstain` + `missing_evidence: ["Waiver referenced in certificate §3"]` | Never infer the contents of a document you cannot read |
| 14 | A near-identical case was resolved last quarter | Retrieve the lesson, **check amendments first**, resolve in fewer steps | F5 — the memory effect, and the demo's centrepiece |
| 15 | Our number passes, borrower's number passes, they differ by more than tolerance | **Log the variance. Do not investigate.** | Investigations are reserved for real exceptions |
| 16 | Our number **passes**, borrower reported a **failure** | Investigate — the borrower may have mis-stated their own compliance | The mirror image of the case the old design missed |
| 17 | Step cap reached before a conclusion | `abstain` ("investigation incomplete") | Never a guess because time ran out |

### C. Rejection criteria — what the guardrail must refuse

| # | Agent produces | Guardrail response | Why it matters |
|---|---|---|---|
| 18 | A figure in the explanation matching **no** calculation and **no** quote | Force **`abstain`** ("unverified figure") | The core trust claim |
| 19 | A figure quoted verbatim from a cited clause — e.g. *"the covenant requires 1.25x"* | **ACCEPT** | **The subtlest failure mode in the design.** A guardrail accepting only *calculated* numbers abstains on every well-formed explanation — scoring a perfect 0 false resolves while the product does nothing |
| 20 | Same figure in a different format — `1,250,000` vs `1250000`, `1.25` vs `1.25x`, `$4.25m` | **ACCEPT** — compare after normalisation | Naive string matching would false-abstain on correct work |
| 21 | A claim whose quote does **not** appear in the cited chunk | Remove the claim; if the recommendation depended on it, force `abstain` | Fabricated citations are worse than no citation |
| 22 | `resolve` with no passing calculation, or without cited effective terms | Downgrade to **`escalate`** | Confidence must be earned by evidence |
| 23 | Explanation proposing to waive a covenant, amend terms, or contact the borrower | Force **`escalate`** with a note | Prohibited actions — a regulatory boundary |
| 24 | Output that fails the casefile schema | One retry, then **`abstain`** ("malformed output") | Never render a broken response as a recommendation |

### D. Malformed and unexpected input

| # | Input | Expected behaviour |
|---|---|---|
| 25 | Scanned/image PDF | Rejected at ingest with a reason. **Not** OCR'd, not guessed |
| 26 | Certificate whose borrower name matches no facility | Routed to `needs_filing`. **Never** guesses the facility |
| 27 | Agreement with no recognisable DSCR definition | Covenant setup returns "not found" for the analyst to resolve — no invented threshold |
| 28 | Model, platform or database failure mid-run | Casefile `failed` with the error and a Retry action. **A failure is never presented as a recommendation** |

**Coverage note:** behaviours 1–10 and 18–24 are unit-testable with no model call
at all, which is why the deterministic core is the cheapest place to build
confidence. Behaviours 11–17 need the eval set.

---

# Week 2

# Section 3. PRIORITIZATION

## 3.1 Breaking the agentic workflow into components

```
 1. Document          2. Certificate      3. Covenant
    ingestion      →     check &       →     definition
    & chunking           exception           mapping
                         detection           (terms)
                            ↓                   ↓
 8. Memory          ←  6. Evidence   ←   4. Deterministic
    (lessons)            sufficiency         DSCR
       ↓                 judgment            calculation
       ↓                    ↑                   ↓
       └──────────►  5. Gap research  ←─────────┘
                            ↓
                     7. Guardrail &
                        policy
                        enforcement
                            ↓
                      Human review
```

## 3.2 Component risk assessment

### Summary matrix — all eight components

| # | Component | Is ML necessary? | Data to train/eval? | Meets accuracy bar? | Scales? | Explainable? | Easy to judge? | **Risk** |
|---|---|---|---|---|---|---|---|---|
| 1 | Ingestion & chunking | **NO** | PASS | PASS | PASS | PASS | PASS | **Low** |
| 2 | Certificate check & exception detection | PARTIAL | PASS | PASS | PASS | PASS | PASS | **Low** |
| 3 | Covenant definition mapping | **YES** | FAIL → mitigated | PASS | PASS | PASS | PASS | **High** |
| 4 | Deterministic DSCR calculation | **NO** | PASS | PASS | PASS | PASS | PASS | **Low** |
| 5 | Gap research | **YES** | PARTIAL | PASS | PASS | PASS | PARTIAL | **Medium** |
| 6 | Evidence sufficiency judgment | **YES** | FAIL → mitigated | PASS | PASS | PASS | PARTIAL | **High** |
| 7 | Guardrail & policy enforcement | **NO** | PASS | PASS | PASS | PASS | PASS | **Low** |
| 8 | Memory / lessons | PARTIAL | PASS | PASS | PASS | PASS | PASS | **Medium** |

### Deep dive — the three components that carry the risk

#### Component 3: Covenant definition mapping *(highest complexity, per mentor review)*

| Check | Result | Explanation |
|---|---|---|
| Is ML necessary? | **PASS** | Rule-based extraction cannot handle the variation: "Consolidated EBITDA", "Adjusted EBITDA (as defined)", "EBITDA as modified by Amendment No. 2". Determining *which amendment governs this test period* requires reading effective dates and scope, not pattern matching. |
| Do you have data to train/evaluate? | **FAIL** | No public labeled dataset of covenant-term mappings exists, and real loan files are unavailable. **Mitigation:** generate 6 synthetic facilities with known ground-truth terms, owner-validated for realism before generation. |
| ML feasibility | PASS | Structured extraction from legal text into a fixed JSON schema is a well-established LLM task. |
| Meets accuracy requirements? | PASS | Output is schema-validated and every term carries a citation that is independently quote-verified. A mis-mapping that cites nothing is caught by the guardrail. |
| Scales? | PASS | Stateless per-document retrieval and extraction. |
| Feedback speed | PASS | Immediate — a wrong mapping produces a wrong DSCR, which the eval set catches. |
| Applicable laws | PASS | No direct regulation of the mapping step; outputs feed a human-reviewed credit decision. |
| Bias | PASS (caveat) | Synthetic documents follow US/UK commercial-lending drafting conventions. Other legal traditions are out of scope and flagged in §8. |
| Explainability | PASS | Every mapped term shows its source clause and verbatim quote. |
| Easy to judge good vs. bad? | PASS | The mapped terms either produce the expected DSCR or they don't — the owner-computed spreadsheet is the oracle. |

#### Component 6: Evidence sufficiency judgment *(the headline metric)*

| Check | Result | Explanation |
|---|---|---|
| Is ML necessary? | **PASS** | Deciding "is this enough to resolve?" is contextual reasoning over heterogeneous evidence. No fixed rule expresses it. |
| Do you have data to train/evaluate? | **FAIL** | "Sufficient evidence" is a judgment call. **Mitigation:** 24 cases with expected outcomes, **signed off by the owner** (a credit domain expert) before being called expert-validated. |
| ML feasibility | PASS | Within reach for a frontier model given cited evidence and a bounded output schema. |
| Meets accuracy requirements? | PASS, conditionally | ≥85% outcome accuracy is the target; **0 false resolves** is the gate. The system is biased toward abstaining — an over-cautious agent is recoverable, a falsely confident one is not. |
| Scales? | PASS | Per-case, stateless apart from retrieved memory. |
| Feedback speed | PASS | Analyst approve/override is immediate labeled signal. |
| Applicable laws | **PASS, with a hard constraint** | This must remain decision support. Banking regulators require human accountability for credit decisions. `require_human_review` is locked; the agent cannot waive a covenant, amend terms, or contact a borrower. |
| Bias | PASS (caveat) | Risk of systematically under-escalating for patterns well represented in memory. Tracked via the override-rate metric. |
| Explainability | PASS | `confidence_basis` is a required output field; the full trace and all guardrail interventions are shown. |
| Easy to judge good vs. bad? | **PARTIAL** | Credit judgment has genuine gray areas. Evaluation relies on the owner's signed labels, not an objective truth — and this is stated rather than papered over. |

#### Component 8: Memory / lessons

| Check | Result | Explanation |
|---|---|---|
| Is ML necessary? | PARTIAL | Similarity search over past casefiles needs embeddings; the retrieval policy itself is code. |
| Do you have data to train/evaluate? | PASS | Generated by the system's own use; eval runs are separated from demo data by a run identifier so memory can be reset cleanly per pass. |
| Meets accuracy requirements? | PASS | Measured directly as the memory effect metric — steps taken, cold vs. warm. |
| Scales? | PASS | pgvector similarity over a small per-lender corpus. |
| Applicable laws | PASS | Lessons are analyst reasoning, not borrower personal data. |
| **Bias** | **Caveat — the real risk here** | A wrong lesson propagates. A single bad override teaches the system a bad pattern. **Mitigation:** lessons record the analyst's reason verbatim and are attributable to a named reviewer; they inform retrieval, never override a calculation or a guardrail. |
| Explainability | PASS | The UI shows which lesson was retrieved and the case it came from. |
| Easy to judge good vs. bad? | PASS | Cold vs. warm eval comparison measures it directly. |

### Workflow-level risk summary

| Component | Risk | Mitigation |
|---|---|---|
| 1. Ingestion & chunking | Low | Text PDFs only; OCR explicitly out of scope |
| 2. Certificate check | Low | Schema-validated extraction; **code**, not the model, does the comparison |
| 3. Covenant definition mapping | **High** | Owner-validated synthetic facilities; schema validation; citation + quote verification on every term |
| 4. DSCR calculation | Low | Pure function, unit-tested, never defaults a missing value, errors instead of guessing |
| 5. Gap research | Medium | Findings must cite; nothing found → escalate, never invent |
| 6. Evidence sufficiency | **High** | Owner-signed labels; guardrail downgrades; 0-false-resolve gate; locked human review |
| 7. Guardrail & policy | Low | Pure functions, unit-tested against deliberately fabricated agent outputs |
| 8. Memory | Medium | Lessons are attributable and advisory only; never override code |

## 3.3 Prioritised stories and MVP scope

| Story | Title | Priority | Points | Rationale |
|---|---|---|---|---|
| US-001 | Ingest & exception detection | P0 | 5 | Entry point — nothing else runs without it |
| US-002 | Agent investigation → recommendation | P0 | 13 | The core hypothesis |
| US-003 | Every number traceable | P0 | 8 | The trust claim; without it this is just a chatbot |
| US-004 | Citation chips with clause text | P0 | 5 | Makes verification a two-second action |
| US-005 | Live step trace | P0 | 5 | Shows the agent reasoning — the demo's spine |
| US-006 | Approve / override → memory | P0 | 8 | Closes the learning loop; the demo centerpiece |
| US-007 | Request / abstain on missing evidence | P0 | 5 | Safety behaviour; drives the abstain metric |
| US-008 | Memory speeds a later similar case | P0 | 5 | Proves the compounding moat |
| US-009 | Governance page | P1 | 3 | Makes oversight visible; low cost |
| US-010 | Eval scoreboard in-app | P1 | 3 | Turns the trust claim into a number on screen |
| US-011 | Email intake | P2 | 5 | Workflow convenience; cut first if time is short |

**MVP scope rationale.** US-001 through US-008 prove the hypothesis: *an analyst
can take a flagged covenant exception and reach a defensible, cited outcome in
under 30 minutes, with zero false resolutions.* US-009 and US-010 make the
governance and accuracy story visible and are cheap. US-011 is deliberately
deferred — email intake adds workflow convenience but proves nothing about
whether the agent reasons correctly.

**Deliberately excluded from MVP:** other covenants (leverage, fixed-charge
coverage, liquidity), scanned/OCR documents, financial statement table
extraction, authentication and multi-user, mobile layout, and editing facility
terms in the UI.

---

# Section 4. ROADMAP

| Release | Features | Duration |
|---|---|---|
| **MVP (demo build)** | End-to-end flow: covenant setup with analyst approval → independent quarterly calculation for every borrower → exception → investigation → cited casefile → approve/override → memory. **3 synthetic facilities** (F1, F3, F5), **6 labeled eval cases**, 3 screens, deterministic calculator, guardrails, policy, deployed on Vercel | **Course build** |
| **Post-MVP backlog** *(cut from the demo build to protect scope — first things to restore)* | Facilities **F2, F4, F6**; eval set **6 → 24 cases**; the **4th screen** (Governance & evals) as an editable page rather than a static panel; **Foundry groundedness judge** for independent scoring; **covenant setup approval screen** if it was pre-seeded in the demo; **email intake** (US-011); policy editing in the UI | Immediately after the demo |
| **MVP 1** | Second covenant (fixed-charge coverage); multi-quarter trend view; PDF export of the casefile for the credit file; analyst-configurable notification rules | Months 2–4 |
| **Launch** | Authentication and multi-user teams; role separation for the Risk Officer; real-document pilot with one design partner under NDA; OCR for scanned agreements; audit-log export; SOC 2 readiness | Months 5–9 |
| **Iteration** | Remaining covenant types; integration with loan document systems (e.g. nCino); integration with spreading tools for financial inputs; fine-tuned term-mapping model once correction volume justifies it; portfolio-level early-warning view | Ongoing |

**Roadmap linked back to priorities and risks**

- MVP contains every **High**-risk component (3 and 6) deliberately — they carry
  the hypothesis, and deferring them would prove nothing.
- OCR sits in Launch, not MVP, because component 1 is Low risk only *while*
  inputs are text PDFs.
- Real documents wait for Launch because the mentor review correctly noted that
  synthetic documents may not capture how messy real amendments are. The MVP
  proves the mechanism; a design-partner pilot proves the mess.
- Fine-tuning waits for Iteration because there is no correction data yet.

**Dependencies**

| Dependency | Blocks | Status |
|---|---|---|
| Owner validates the six facility twists for realism | Synthetic document generation | **Open** |
| Owner computes expected DSCR values in a spreadsheet and signs off each row | Eval harness can run | **Open** |
| Owner signs off the 24 eval labels | Reportable accuracy numbers | **Open** |
| Azure AI Foundry project with model deployments | Agent build | Done |
| Supabase project with pgvector | Schema, retrieval, memory | Done |

---

# Week 3

# Section 5. IMPLEMENTATION PLAN

## 5.1 Evaluation strategy

### Establishing ground truth — and keeping it independent

The eval set is **24 cases = 6 facilities × 4 variations** (quarter, figures,
documents present or missing). Each case specifies inputs and an expected
`{outcome, dscr, key_citation, pattern_tag}`.

Three rules keep the oracle honest:

1. **The expected DSCR values are computed by the owner in a spreadsheet** — not
   by the calculator under test, and not by the AI. If the thing grading the
   calculator shares an author with the calculator, the tests only prove it
   agrees with itself. The build produces a template listing each case's covenant
   terms and six financial inputs; the owner fills in the expected DSCR.
2. **The eval runner refuses to run while any row is unsigned.** Sign-off is a
   per-row flag, not a blanket claim.
3. **The AI drafts the outcome labels; the owner reviews and signs every one**
   before they are described as expert-validated.

### Evaluation plan

| Eval type | Method | Target | Cadence |
|---|---|---|---|
| Calculation accuracy | DSCR vs. owner-computed value, 2dp | **100%** | Every commit (unit tests) |
| False-resolve rate | Count of `resolve` where expected ≠ resolve | **0** | Every eval run |
| Outcome accuracy | Recommended vs. expected outcome | ≥ 85% | Every eval run |
| Abstain correctness | Correct `abstain`/`request` on incomplete-evidence cases | ≥ 90% | Every eval run |
| Citation hit rate | Expected key clause present in claims | ≥ 90% | Every eval run |
| Groundedness | Azure AI Foundry Evaluations, LLM judge, over exported JSONL | Reported | Per milestone |
| Memory effect | Mean `steps_count`, cold vs. warm | Visible reduction | Per eval run |
| Guardrail efficacy | Fabricated agent outputs (untraceable number, fake quote, resolve without a passing calc) | 100% correctly downgraded | Every commit (unit tests) |

**Two passes per run:** **cold** (memory cleared for that run) and **warm**
(lessons from scripted analyst overrides loaded). The delta is the memory-effect
metric and the demo's centerpiece.

**Development subset:** a 6-case subset (one per facility) runs during
development — enough to catch regressions. All 24 run twice only when producing
reportable numbers. This is a deliberate cost control.

### Monitoring AI performance over time

- Unit tests on the calculator and guardrails run on every commit and block a
  merge on failure.
- The eval harness runs at each milestone; a drop below the false-resolve gate
  is a hard stop, not a warning.
- Per-run traces, token usage and cost are captured in Azure AI Foundry
  observability, so a regression can be traced to the step that caused it.
- Post-launch (future): override rate by pattern tag is the leading indicator —
  a rising override rate on one tag means the agent has learned something wrong.

## 5.2 Model requirements

| Criteria | Requirement | Rationale |
|---|---|---|
| Open vs. closed source | **Closed, hosted on Azure** | No ML infrastructure team; the course and the production story are both Azure-based; hosted models carry the lowest operational burden |
| Context window | **128K+** | A credit agreement plus amendments plus retrieved chunks plus memory lessons must fit in one request |
| Modalities | **Text only** | Scanned documents and OCR are explicitly out of MVP scope |
| Tool / function calling | **Required** | Non-negotiable — the model must be able to call the deterministic calculator and the retrieval tools; this is the whole architecture |
| Multi-agent support | **Required** | The orchestrator delegates to three specialist agents; this is a learning objective as well as a design choice |
| Structured output | **Required** | The casefile and the `terms` mapping are schema-validated JSON |
| Fine-tuning | **Not required at MVP** | Prompting plus retrieval plus code guardrails should meet the targets; revisit once correction data exists |
| Latency | **Medium priority** | Investigations run asynchronously and the analyst watches a live trace; sub-second response is not required |
| Accuracy | **High priority** | A regulated credit context makes errors costly; accuracy is prioritised over cost |
| Cost | **Managed, not minimised** | Target under $1 per investigation via a cheaper model for the retrieval agents and prompt caching |
| Time to market | **High** | 6-week course build |

### Model selection

| Role | Model | Rationale |
|---|---|---|
| Orchestrator | `gpt-5.4` | Makes the evidence-sufficiency judgment, which drives the headline metric. Not the place to economise. |
| `document_agent`, `definition_agent`, `research_agent` | **`gpt-5-mini`** | They read and quote rather than judge, every quote is code-verified anyway, and this is where most calls happen. Already deployed. |
| Eval judge | `gpt-4.1` | Deliberately a different generation from the agents, so the judge is not grading its own kind. |
| Embeddings | `text-embedding-3-small` | **1536 dimensions** — the vector schema depends on this. Already deployed. |

**Justification and alternatives considered.** A single frontier model for every
role was rejected on cost: the three retrieval agents account for most calls and
do not make judgments. A single small model throughout was rejected on risk: the
sufficiency judgment is the metric. Claude Opus 5.5 and Sonnet 5.5 are available
in the same Azure region at standard rates and remain a live alternative — the
model assignment is configuration, and **"can the cheaper model orchestrate
without hurting accuracy?" is itself a planned experiment** whose answer is
worth reporting either way.

---

# Section 6. EVALUATIONS

## 6.1 HHH evaluation

| Pillar | Strength | Risk | Mitigation |
|---|---|---|---|
| **Helpful** | Turns hours of document archaeology into a cited casefile the analyst can verify in minutes; memory makes repeat patterns progressively faster | Over-abstaining produces a system that is safe but useless — it hands everything back to the analyst | Abstain rate is tracked as a metric in both directions, not just as a safety number. Quoted figures count as valid evidence precisely so the system is not forced to abstain on well-formed answers. |
| **Honest** | Every figure traces to a logged calculation or a verbatim quote; every claim's quote is verified against the cited chunk; every guardrail intervention is shown to the analyst, not hidden | The model could construct a plausible narrative from genuinely cited pieces that is still wrong in aggregate | Human review is mandatory and locked. `resolve` requires a passing calculation *and* cited effective terms. The step trace lets the analyst audit the reasoning path, not just the conclusion. |
| **Harmless** | Cannot make a credit decision. Cannot waive a covenant, amend terms, or contact a borrower — these are prohibited actions that force escalation. All data is synthetic. | Worst case: an analyst over-trusts a `resolve` and a real breach goes unescalated, creating credit and regulatory exposure | **0 false resolves** is a hard gate, not a target. Deep breaches always escalate regardless of what the agent concluded. Human review cannot be disabled. The product is positioned and labelled as decision support throughout. |

**Evaluation spreadsheet:** *[Owner to create from the cohort HHH template and
link here]* — minimum columns: Case ID | Facility | Variation | Expected outcome
| Expected DSCR | Expected key citation | Expected tag | Actual outcome | Actual
DSCR | Citations returned | Steps | Pass/Fail | Notes.

## 6.2 Launch plan

| Launch stage | Helpful | Honest | Harmless | Go criteria |
|---|---|---|---|---|
| **Measurement (internal, 6-case subset)** | Produces a complete casefile end-to-end on all 6 facilities | Calculation accuracy 100% on unit tests | 0 false resolves on the subset | Full flow runs with no P0 defects; guardrail tests all pass |
| **Beta (full 24-case eval, cold + warm)** | Median time-to-decision < 30 min; measurable memory effect | Outcome accuracy ≥ 85%; citation hit rate ≥ 90% | **0 false resolves**; correct abstain ≥ 90% | All metrics met across two consecutive runs; owner has signed every eval label |
| **Launch (design-partner pilot, real documents)** | Analyst reports the output usable without rework in ≥ 70% of cases | Groundedness reported from an independent judge; override rate stable | **0 false resolves sustained**; security review complete; audit log in place | All Beta criteria sustained on real documents; legal review of positioning and disclaimers complete |

**Experimentation plan**

- **Model comparison:** run the full eval with the orchestrator on the frontier
  model vs. the mini model. Measures whether judgment quality justifies the cost
  difference. A publishable finding either way.
- **Memory ablation:** cold vs. warm on identical cases, already built into
  every run. Isolates the value of the learning loop.
- **Guardrail ablation:** run the eval with guardrails disabled to quantify how
  many false resolves the code layer is actually catching. This is the number
  that proves the architecture, and it is the single most persuasive metric for
  the pitch.
- **Prompt versioning:** orchestrator system prompts are versioned; changes are
  A/B'd against the eval set before adoption.

### Rollback plan

Every layer can be reverted independently, and none of them requires a redeploy
except the last.

| What went wrong | How to undo it | Time to revert |
|---|---|---|
| A prompt change degraded outcome accuracy | Revert to the previous pinned prompt version | Minutes — config, no deploy |
| A policy threshold is mis-tuned (too many escalations, tolerance too tight) | Update the `policy` table row | Immediate — the Risk Officer's lever, by design |
| A model change made judgment worse | Revert the deployment name in config | Minutes — no code change |
| Covenant terms were approved with an error | Terms are **versioned and effective-dated** — supersede with a corrected version; prior tests remain reproducible against the terms actually in force | Minutes, and auditable |
| The agent is producing unusable output generally | **Kill switch:** stop creating investigations. Quarterly testing still runs — ingest, calculate, compare, flag — because that path is pure code. The lender keeps compliance testing and loses only the investigation | Immediate |
| A bad release reaches users | Revert the deployment; casefiles are persisted, so in-flight investigations resume rather than being lost | One deploy cycle |

**The kill switch is the important row.** Because calculation and guardrails are
deterministic code rather than model behaviour, the product degrades to "automated
covenant testing without investigation" rather than to nothing. That is a real
fallback, not a theoretical one.

**What is explicitly not rollback-able:** an analyst decision already recorded.
Decisions and their lessons are append-only — a wrong lesson is superseded by a
new one, never deleted, because the audit trail is the product.

---

# Week 4

# Section 7. DATA REQUIREMENTS

| Area | Description |
|---|---|
| **Model fine-tuning** | **Not planned for MVP.** Prompting + retrieval + schema validation + code guardrails are expected to meet the targets. Fine-tuning the term-mapping component is revisited once there is real correction data — the trigger is a sustained mapping-correction rate above 5% with enough labeled examples to justify training and re-evaluation. |
| **Data preparation** | Used for **evaluation** (ground truth) and as the **RAG knowledge base**, not for training. Six synthetic facilities are generated by script, each with: a credit agreement (~15–20pp, with a definitions article, a financial covenants article, events of default and notices), one amendment or waiver (2–3pp, with an effective date and amended definitions), quarterly financials, and a borrower compliance certificate in a standard form. |
| **Data quantity** | 6 facilities × ~4 documents = ~24 documents; 24 labeled eval cases. Sized against the mentor's "5–10 facilities, 20–30 test cases" guidance and against what one owner can genuinely validate — a larger set that nobody has checked is worse than a smaller set that has been signed off. |
| **Iterative data collection** | Every analyst override is captured with a verbatim reason, a corrected outcome and a confirmed pattern tag, and becomes a retrievable lesson. This is both the learning loop and the future training corpus. |
| **Iterative fine-tuning** | Not active. Future trigger as above. |
| **Knowledge base (RAG)** | Section-level chunks of each facility's own documents, embedded at 1536 dimensions, filtered by facility at query time so one borrower's agreement can never be cited in another borrower's casefile. Plus casefile summaries and analyst lessons as a second retrieval surface. |

**Why the financial figures are printed as labeled lines.** The calculator needs
six inputs (EBITDA, add-back amounts, unfinanced capex, cash taxes, scheduled
principal, cash interest), but financial-statement table extraction is
explicitly out of scope. The synthetic financials document therefore states each
input as its own labeled line — `Consolidated EBITDA: 4,250,000`. The agent
reads and **cites** each figure; the calculator never extracts or infers one.
This keeps extraction out of scope while still supplying the calculation, and
keeps every input traceable.

**Data quality and compliance**

- **Synthetic only. No real bank data, ever.** Every generated document carries
  the literal marker `SYNTHETIC — FOR DEMONSTRATION`. Borrower names are
  fictional.
- Real borrower documents would be commercially confidential and
  personal-data-bearing; they are excluded from the MVP by design, not by
  accident.
- Credentials are owner-held and environment-scoped; the secrets file is
  excluded from version control.
- At pilot stage, real documents require a design-partner NDA, data residency
  commitments, and a defined retention and deletion process — gating Launch, not
  MVP.

## 7.1 Prompt strategy

| Task | Technique | Rationale |
|---|---|---|
| Certificate extraction | **Few-shot + strict output schema** | Borrower certificate forms vary; a fixed schema makes failure explicit rather than silent |
| Covenant definition mapping | **Few-shot + chain-of-thought + schema-validated JSON** | Amendment precedence requires step-by-step reasoning; the schema stops the reasoning leaking into the output |
| Orchestration / next-step decision | **ReAct-style tool-calling with an explicit rule set** | The system prompt states the rules the agent cannot break: never compute a number, cite everything, abstain when unsupported, never propose a prohibited action |
| Gap research | **Chain-of-thought with hypothesis enumeration** | The agent is prompted with the five known gap classes — amendment, period mismatch, add-back, borrower calculation error, our own mapping error — so it tests rather than guesses |
| Explanation writing | **Constrained generation** | ≤150 words, every claim carrying a citation and verbatim quote |
| Memory retrieval | **Conditional** — retrieve first, let relevance decide | Lessons inform the opening approach without dictating the conclusion |

**Output format constraints**

```
Casefile output (schema-validated):
  recommendation:     "resolve" | "request" | "escalate" | "abstain"
  confidence_basis:   string
  explanation:        string, ≤ 150 words
  claims[]:           { text, citation, quote }
  calculations[]:     { calc_id }
  missing_evidence[]: string
  suggested_tag:      one of six fixed pattern tags

Terms mapping output:
  test_period, threshold{min_dscr, citation}, numerator{base, addbacks[], deductions[]},
  denominator{components[], citation}, effective_amendments[]

Calculator output (code, not model):
  { calc_id, components{}, dscr, threshold, pass, margin, calculator_version }
```

**Prompt improvement plan**

- Prompts are versioned in the repository with a logged rationale per change.
- Each version is run against the eval set before adoption; a version that
  reduces outcome accuracy or introduces a single false resolve is rejected.
- Guardrail interventions are logged per casefile; a rising rate of a specific
  intervention is a prompt defect signal, and the specific `guardrail_notes`
  reason points at which prompt to fix.
- Analyst override reasons are read as a qualitative error-analysis source each
  cycle.

---

# Section 8. RESPONSIBLE AI RISKS & MITIGATION

> *How do we make sure we are not the AI story in the trade press for the wrong
> reasons?* The short answer: the system cannot make a credit decision, cannot
> produce an unsourced number, and cannot run without a human approving the
> outcome. Those are enforced in code, not in policy documents.

## Accountability

| Question | Answer |
|---|---|
| What are the efficacy and limitations of the product? | **Effective at:** investigating DSCR covenant exceptions on text-based English-language commercial credit agreements, where the governing terms are discoverable in the documents on file. **Not effective at:** other covenants, scanned documents, extracting figures from financial statement tables, novel structures outside the evaluated set, or any situation calling for legal interpretation. It is explicitly **not** a credit decision system. |
| What compliance and policies apply? | Banking supervisory expectations for model risk management (SR 11-7-style model documentation, validation and ongoing monitoring); fair lending considerations at portfolio level; data protection for borrower information at pilot stage. The MVP sidesteps data protection entirely by using synthetic data. |
| How will sensitive data be managed? | MVP: no real data exists. At pilot: encryption in transit and at rest, facility-scoped access, configurable retention with customer-initiated deletion, and no cross-customer data sharing. Analyst lessons stay within the lender's own tenant — that is the point of the moat, and also the privacy boundary. |
| Human oversight and control? | **`require_human_review` is a locked policy value.** Every casefile requires analyst approval or override. The analyst can override any recommendation with a recorded reason. Prohibited actions — waiving a covenant, amending terms, contacting the borrower — force escalation if the agent so much as proposes them. A complete audit trail links every recommendation to its steps, calculations and citations. |

## Transparency

| Question | Answer |
|---|---|
| Direct and indirect use cases? | **Direct:** covenant exception investigation for commercial credit analysts. **Indirect/plausible misuse:** treating a `resolve` as approval to close an exception without review (prevented by locked human review); extending the output to covenants it was never evaluated on (prevented by scope, and the agent abstains on unknown component names). |
| How are results generated — what happens at each step? | Ingest → chunk → retrieve → map terms → **deterministic calculation** → research the gap → judge sufficiency → **code guardrail** → **code policy** → human review. Every step is visible in the trace. |
| What benchmarks must be shared? | Outcome accuracy, calculation accuracy, false-resolve rate, abstain correctness, citation hit rate — published in-app on the Governance page, not just in a deck. The methodology (24 owner-signed cases, cold and warm passes) is stated alongside the numbers. |
| What disclosure is required? | Every casefile is labeled as an AI-generated recommendation requiring human approval. Guardrail interventions are displayed, including when the system was forced to abstain and why. Calculated values are visually distinguished from quoted values in the UI — code-produced figures are badged with their calculation ID. |

## Fairness

| Question | Answer |
|---|---|
| Which groups or cases will be underrepresented? | Non-English agreements; non-US/UK drafting conventions and legal traditions; bespoke or heavily negotiated structures unlike the six evaluated patterns; borrowers whose financials are presented in formats the labeled-line assumption does not hold for. Smaller or less sophisticated borrowers may file messier certificates and therefore trigger more `request` outcomes — a service-quality asymmetry worth watching. |
| Why don't they work, and how will the gap close? | The evaluated corpus is six synthetic facilities on common-law commercial lending conventions. Closing the gap requires real documents from a design partner, prioritised by observed demand — which is why real-document piloting is a Launch gate rather than a nice-to-have. |
| What feedback loop identifies poorly-served segments? | Outcome distribution and override rate segmented by facility, industry and document completeness. A segment with a disproportionate `request`/`abstain` rate or override rate is a fairness signal, not just a quality signal. At pilot, this becomes a standing review. |
| Fair lending specifically | CreditScout never evaluates a borrower's creditworthiness, never scores an applicant, and never touches protected characteristics. It investigates whether a contractual ratio was met, against contractual terms. This is a deliberate scope boundary that keeps the product out of fair-lending model territory. |

## Reliability and safety

| Question | Answer |
|---|---|
| What is a reliable experience, and what error rates are acceptable? | **False resolve: 0. Not "low" — zero.** Calculation accuracy: 100%. Outcome accuracy: ≥85%, because a wrong escalation costs analyst time while a wrong resolution costs credit exposure. Over-escalation is an acceptable failure mode; over-confidence is not. |
| What are the consequences of bad input, and what can go wrong? | A certificate with a wrong test period, a missing amendment, or an uncited figure. Each is handled by refusing to proceed rather than by assuming: the calculator **errors** on a missing input rather than defaulting it to zero; an uncitable figure becomes missing evidence; a referenced-but-absent waiver produces `abstain`, not a guess. |
| What is the recovery plan when the system fails? | A platform, model or database failure marks the casefile `failed` with the error and a Retry action. **A failure is never rendered as a recommendation.** An investigation interrupted mid-run is resumable from its last persisted step. Policy values are editable without a deployment, so a mis-tuned threshold is a configuration fix. |
| How is health monitored and how are users told? | Per-run traces, token usage and latency in Azure AI Foundry observability; infrastructure logs on the hosting platform; the in-app eval scoreboard as the user-facing accuracy signal. At pilot: alerting on failure rate and on any false resolve detected in audit, with direct notification to the lender. |
| The specific failure mode we most want to avoid | A guardrail so strict it abstains on everything would show a **perfect** false-resolve score while delivering nothing — the metric would look ideal and the product would be worthless. This is tested directly: well-formed explanations quoting covenant figures must pass. Measuring abstain rate alongside false-resolve rate is what keeps the headline metric honest. |

---

# Week 5

# Section 9. PRICING

## 9.1 Cost and accuracy tradeoffs

| # | Item | What we used | Why | Trade-offs |
|---|---|---|---|---|
| 1 | Agent platform | **Azure AI Foundry Agent Service** (Connected Agents) | Managed multi-agent orchestration; traces and token accounting built in; matches the production story of running inside a bank's own Azure tenant | Less fine-grained loop control than hand-written orchestration; Connected Agents is a preview feature |
| 2 | LLM for inference | `gpt-5.4` orchestrator + `gpt-5-mini` specialists | Capability where judgment happens, economy where retrieval happens | A two-model split means two behaviours to tune and evaluate |
| 3 | Deterministic layer | Plain JavaScript, zero dependencies, unit-tested | The calculator and guardrails must be auditable and independently testable | Hand-written rather than inherited from a library; more code we own |
| 4 | User interface | Next.js + React on Vercel | One codebase for UI and API; the tool endpoints the agent calls live beside the screens | Server-side execution limits shaped the async design |
| 5 | Vector database | Supabase pgvector | Vectors, relational data and memory in one managed Postgres; no second system | Not a specialised vector store; fine at this scale, would be revisited at portfolio scale |
| 6 | Hosting / repo | Vercel + private GitHub | Free tiers cover the MVP; owner already uses both | Free-tier database sleeps when idle |
| 7 | Dev editor | Claude Code | Spec-driven development with the plan and spec as source of truth | — |

## 9.2 Development costs — what this MVP actually cost

*Infrastructure, actual and estimated:*

| # | Item | Cost |
|---|---|---|
| 1 | Supabase (free tier — Postgres + pgvector) | **$0** (Pro tier $25/mo optional, removes idle sleep) |
| 2 | Vercel hosting (hobby tier) | **$0** |
| 3 | GitHub private repository | **$0** |
| 4 | Azure AI Foundry project | **$0** (no standing charge; pay per use) |
| 5 | Model usage — development and eval cycles | **~$15–25 per full 24-case eval cycle** *(estimate derived from the spec's step counts and token volumes, not a measurement — recalculate from the first real run)* |
| 6 | Embeddings for ~24 synthetic documents | **< $1** |
| 7 | Claude Code subscription | Existing |
| | **Total MVP infrastructure** | **Under $100** |

*Manpower — this build:*

| # | Role | Cost |
|---|---|---|
| 1 | Product Manager (owner) — spec, domain validation, eval labels, expected values, pitch | 6 weeks part-time |
| 2 | AI coding assistant — implementation | Subscription |
| | **Total** | Owner's time plus an existing subscription |

*Manpower — what a production build would cost (estimate, for comparison):*

| # | Role | Annual, fully loaded |
|---|---|---|
| 1 | Product Manager | ~$180K |
| 2 | Backend / AI engineer ×2 | ~$400K |
| 3 | Frontend engineer | ~$180K |
| 4 | Credit domain expert (part-time, for covenant specs and labels) | ~$90K |
| | **Total year one** | **~$850K** *(estimate, US rates)* |

## 9.3 Operational costs (at scale)

| Item | Driver | Estimate |
|---|---|---|
| Model inference | Per investigation | **< $1 per investigation** (target; prompt caching and the mini-model split are the levers) |
| Embeddings | Per document ingested | Negligible — fractions of a cent per agreement |
| Database | Facilities, documents, casefiles, vectors | ~$25–100/mo at single-lender scale |
| Hosting | Request volume | ~$20–100/mo at single-lender scale |
| Observability | Trace retention | ~$50/mo |
| Support and customer success | Per lender account | The dominant cost at scale, not inference |

**The structural point:** inference is not the cost driver. A lender with 500
monitored borrowers, at the owner's **10% contested-exception rate**, generates
~50 investigations per quarter — under $50 of inference, against $2,500/month of
revenue at $5 per borrower. Gross margin is not the constraint; distribution is.
The business is priced on the analyst time it saves, not the tokens it burns.

## 9.4 Market size

**TAM — Loan Compliance Monitoring software**

**~$2.87B (2026), growing to ~$5.14B by 2030 at 15.7% CAGR.** This is the
category budget line CreditScout competes within.

**SAM — bottom-up, US regional banks / commercial lenders / credit unions**

| Input | Value | Source |
|---|---|---|
| Credit analysts in Credit Intermediation (US) | 33,550 | BLS, May 2023 |
| Less those at money-centre banks (out of segment) | ~40% | *Owner-directed segmentation; share is an estimate* |
| **Analysts at target institutions** | **~20,000** | Derived |
| Borrowers monitored per analyst | ~30 | Persona |
| **Addressable monitored borrowers (US)** | **~600,000** | Derived |
| At **$5 per borrower per month** | **~$36M/year** | Derived |

**US SAM: ~$36M/year.** Applying comparable ratios to UK, EU and APAC commercial
lending puts global SAM at roughly **$90–110M/year** *(scaling assumption, not
researched — flagged as an open item rather than presented as a finding)*.

**On India, and why it is not simply additive**

India matters here, but it belongs in two different places and conflating them
would overstate the market:

1. **As a user base, already counted.** A large share of covenant monitoring for
   Western lenders is executed from India-based GCCs — 130+ BFSI GCCs employing
   537,000+ professionals. Those analysts use seats that the *lender* buys, and
   that lender is already in the US/UK SAM above. **Not additive to revenue** —
   but it changes the product (offshore preparation, onshore approval, async
   handoff) and it widens the user base per account.
2. **As a separate buyer market, not yet sized.** Indian domestic banks and
   NBFCs are their own buyers with their own covenant practices. This is a real
   second market and **this PRD does not size it** — doing so honestly needs
   primary research on Indian commercial lending covenant practice, which hasn't
   been done. Noted as an open item rather than estimated.

**SOM — realistic 3-year obtainable share**

Regional banks, commercial lenders and credit unions: enough covenant exposure
to need this, no engineering capacity to build it. Capturing **~2% of the US SAM
≈ $700K ARR** within three years, roughly **25–30 lender accounts**. Sales cycles
in regulated lending are long — the mentor review flagged this correctly — so
this assumes a design-partner-led motion, not outbound sales.

## 9.5 Revenue potential

| Scenario | Accounts | Avg. borrowers | Price / borrower / mo | ARR |
|---|---|---|---|---|
| **Conservative** | 8 lenders | 300 | $5 | **$144K** |
| **Base** | 20 lenders | 400 | $5 | **$480K** |
| **Optimistic** | 45 lenders | 600 | $5 | **$1.6M** |

*All three are scenarios built on the pricing assumption below, not forecasts.
They hold price flat at $5 deliberately — the owner's view is that tiering above
$5 is premature until the value is measured with real users.*

## 9.6 Pricing models considered

| Model | Fit | Verdict |
|---|---|---|
| **Per monitored borrower / month** | Scales with the thing that generates work; predictable for the lender; easy to forecast | **Chosen** |
| Per facility / month | Finer-grained, but one borrower often has several facilities tested on the same certificate — charging per facility bills twice for one review | **Rejected** — the unit of work is the borrower, so the unit of price should be too |
| Per seat (per analyst) | Simple, familiar | **Rejected** — penalises a lender for adding reviewers, which is the opposite of the oversight behaviour we want |
| Per investigation (usage-based) | Closest to value delivered | **Rejected as primary** — unpredictable budgeting, and it charges most in the quarters when borrowers are most distressed, which is when the tool matters most |
| Outcome-based (share of analyst hours saved) | Compelling narrative | **Rejected** — unmeasurable without deep instrumentation and a long, contentious sales conversation |
| Freemium | Standard SaaS motion | **Rejected** — enterprise banking buyers do not self-serve, and credit documents cannot sit in a free tier |

**Why per-borrower wins:** it aligns price with portfolio size, is predictable
for a credit department's budget, grows naturally as the lender grows, matches
the unit of work (one borrower, one certificate, one review), and does not
disincentivise the human review the product depends on.

## 9.7 Directional pricing

**$5 per monitored borrower per month.** Flat, no tiering, no platform minimum
for now.

Volume tiering and a floor are **deliberately parked** until there is measured
value from real users. Introducing a price ladder before anyone has used the
product is designing a pricing page, not a business.

### The ROI argument, with every assumption on the table

Modelled per analyst, covering 30 borrowers:

| Input | Value | Basis |
|---|---|---|
| Fully-loaded analyst cost | ~$60/hour → ~$125K/year | ⚠️ *Still an estimate — not confirmed by the owner* |
| Borrowers per analyst | 30 | Persona |
| Covenant monitoring as a share of analyst time | **20–30%, modelled at 25%** → ~520 hrs/year | **Owner's figure** |
| Share of borrowers raising a contested exception per quarter | **10%** | **Owner's figure** |
| Analyst time per contested exception today | ~2.5 hours | ⚠️ *Still an estimate — not confirmed by the owner* |
| Time per contested exception with CreditScout | ~0.5 hours | Target from the North Star metric |

**Deriving the unit of work.** 520 hours ÷ 120 test cycles per year (30
borrowers × 4 quarters) = **~4.3 hours per covenant test cycle.** This is the
anchor, and it is derived from the owner's time-share figure rather than guessed.
It is corroborated by the published vendor benchmark putting **DSCR
recomputation alone at 30–40 minutes** — the arithmetic is a fraction of the
cycle; the document work around it is the bulk.

**Where those 4.3 hours go, and what the MVP touches:**

| Activity in a test cycle | ~Hours | Addressed by MVP? |
|---|---|---|
| Chase and receive the compliance certificate | 0.7 | Partly — email intake is P2 |
| Read the certificate, cross-check against the agreement and amendments | 1.2 | **Yes — this is the core product** |
| Rekey figures, recompute the ratio, check the formula | 0.8 | **Yes — deterministic calculator** |
| Update the covenant tracker, write the monitoring note, file it | 0.9 | **Yes — the casefile is the record** |
| Internal discussion, judgment, approvals routing | 0.7 | Partly — human review is retained by design |
| **Total** | **~4.3** | |

*The split within the cycle is an estimate; the 4.3-hour total is derived from
the owner's figure.*

**Reduction estimate**

| Scope | Covenant-monitoring time reduction | Basis |
|---|---|---|
| **MVP** — one covenant, manual upload, text PDFs | **30–40%** | The three fully-addressed rows (~2.9 hrs) are the bulk of the cycle, but manual upload and single-covenant scope cap the realisable share |
| **Full product** — all covenants, email intake, system integrations | **50–65%** | Consistent with the 50–75% range vendors in this category advertise |

**ROI at the MVP figure (35% midpoint):**

| | |
|---|---|
| Hours saved per analyst per year | 520 × 35% = **~182 hrs** |
| **Value per analyst per year** | 182 × $60 = **~$10,900** |
| **Price per analyst per year** | 30 borrowers × $5 × 12 = **$1,800** |
| **ROI** | **~6×** |

**Three observations:**

- **This supersedes an earlier, wrong estimate in this document's history.** A
  first pass modelled routine testing at 20 minutes per cycle and produced ~10%
  reduction and 1.8× ROI. That was a modelling error — it treated the document
  handling, cross-checking and write-up as unaddressable when they are precisely
  what the product does. The figures above are derived from the owner's
  time-share rather than assumed.
- **It is still sensitive to the unconfirmed loaded rate.** At $40/hour the ROI
  falls to ~4×; at $80/hour it rises to ~8×. The conclusion holds across the
  range, which is what makes it safe to present.
- **$5 per borrower may be under-priced.** At ~6× ROI there is clear headroom —
  the earlier $8–12 range would still have landed at 2.5–4×. Pricing low is a
  defensible land-and-expand choice in a new category with long sales cycles,
  but it is a choice, not a constraint, and worth revisiting once there is
  measured usage.

**The offshore case, corrected.** At an India GCC loaded rate of roughly
$20–25/hour, 182 hours is worth ~$3,600–4,500 against a $1,800 price — so the
labour case **does** work offshore, at roughly a third of the onshore ratio.
Positioning there should still lead with accuracy, auditability and capacity
rather than cost savings, because that is where the margin of advantage is
largest — but the savings argument is no longer loss-making, as an earlier draft
of this section wrongly implied.

**What the time-saving arithmetic does not capture:**

1. **Avoided loss.** A single missed covenant breach that should have escalated
   can cost orders of magnitude more than the annual contract.
2. **Audit defensibility.** A cited, logged, reproducible casefile for every
   exception has real value at examination time — and more so for a regional
   bank or credit union without a large model-risk function.
3. **Capacity rather than headcount.** The same team covers a growing portfolio
   without hiring. This is how credit departments actually buy, and it is the
   argument that works onshore and offshore alike.

---

## Appendix A — PRD self-evaluation checklist

| Checklist item | Status | Where |
|---|---|---|
| **Week 1 — Problem definition** | | |
| Problem and job-to-be-done clearly articulated | ✅ | §1.1 |
| Customer persona with role, industry, needs | ✅ | §1.2 |
| Problem validated with data or market research | ✅ | §1.3 — BLS, market sizing, vendor benchmarks, each labeled by source quality |
| Why worth solving, for this user | ✅ | §1.3 |
| Clear and defensible MOAT | ✅ | §1.3 — four compounding sources |
| Agentic AI justified over rule-based | ✅ | §1.4 |
| Unstructured data types listed, ML need explained | ✅ | §1.4 |
| Differentiated from ChatGPT / copilots / Claude | ✅ | §1.3 |
| North Star metric defined | ✅ | §1.5 — time-to-decision |
| 1–2 primary metrics | ✅ | §1.5 — false-resolve rate, calculation accuracy, outcome accuracy |
| Secondary / supporting metrics | ✅ | §1.5 |
| Metrics measurable and trackable over time | ✅ | §1.5, §5.1 |
| **Week 1 — Solution definition** | | |
| Visual user flow (input → processing → output) | ⚠️ | §2.1 — ASCII flow present; **a visual diagram is still needed for the deck** |
| AI drawbacks addressed | ✅ | §2.1 |
| Functional requirements as user stories | ✅ | §2.2 — 11 stories with acceptance criteria |
| Agent capabilities and system behaviour described | ✅ | §2.2 |
| **Week 2 — Prioritisation** | | |
| Workflow broken into components | ✅ | §3.1 — eight components |
| Risk assessment per component | ✅ | §3.2 |
| ML feasibility, data availability, accuracy, explainability specified | ✅ | §3.2 |
| Features prioritised by risk, cost, value | ✅ | §3.3 |
| Scope narrowed to an MVP with rationale | ✅ | §3.3 |
| **Week 2 — Roadmap** | | |
| Phases: MVP, MVP1, Launch, Iteration | ✅ | §4 |
| Feature sets and durations per phase | ✅ | §4 |
| Roadmap linked to priorities and risks | ✅ | §4 |
| **Week 3 — Implementation** | | |
| Model selection criteria listed | ✅ | §5.2 |
| Chosen models justified against alternatives | ✅ | §5.2 |
| **Week 3 — Evaluation** | | |
| How AI performance is evaluated over time | ✅ | §5.1 |
| Datasets / ground-truth sources identified | ✅ | §5.1 — owner-computed values, owner-signed labels |
| Accuracy thresholds / HHH scores defined | ✅ | §5.1, §6.1 |
| Evaluation spreadsheet link or plan | ⚠️ | §6.1 — column structure defined; **owner to create the sheet and link it** |
| Launch criteria and go/no-go framework | ✅ | §6.2 |
| Experimentation / A-B plan | ✅ | §6.2 |
| Post-launch monitoring | ✅ | §5.1 |
| **Week 4 — Data and prompts** | | |
| Data strategy: sources, formats, pipelines | ✅ | §7 |
| Data quality, availability, compliance constraints | ✅ | §7 |
| Few-shot / CoT / conditional prompting described | ✅ | §7.1 |
| Prompt constraints and output formats per task | ✅ | §7.1 |
| Prompt improvement plan from feedback and error analysis | ✅ | §7.1 |
| **Week 4 — Responsible AI** | | |
| Accountability, Transparency, Fairness, Reliability assessed | ✅ | §8 |
| Human-in-the-loop and fallback paths | ✅ | §8 |
| Sensitive use cases and mitigations | ✅ | §8 |
| Bias, hallucination, safe failure modes | ✅ | §8 |
| **Week 5 — Pricing** | | |
| Accuracy / cost tradeoffs explained | ✅ | §9.1 |
| Development costs (infra + manpower) | ✅ | §9.2 |
| Ongoing operational costs | ✅ | §9.3 |
| Market size (TAM, SAM) | ✅ | §9.4 |
| Revenue scenarios | ✅ | §9.5 |
| Pricing model selected with rationale | ✅ | §9.6 |
| Directional pricing recommendation | ✅ | §9.7 |

**Two items are not closed and both need the owner:** a visual user-flow diagram
for the deck, and a copy of the cohort HHH evaluation spreadsheet linked from
§6.1.

## Appendix B — Sources

- [Financial Analysts / Credit Analysts — US Bureau of Labor Statistics, OES](https://www.bls.gov/oes/2023/may/oes132041.htm)
- [Loan Compliance Monitoring Market Size Report, 2026–2033 — Grand View Research](https://www.grandviewresearch.com/industry-analysis/loan-compliance-monitoring-market-report)
- [Loan Compliance Monitoring Market Report 2026 — Research and Markets](https://www.researchandmarkets.com/reports/6231278/loan-compliance-monitoring-market-report)
- [Covenant Monitoring Best Practices for Commercial Lenders — aLoan](https://aloan.ai/guides/covenant-monitoring-best-practices)
- [The Complete Guide to Commercial Loan Covenant Monitoring — CovenantFlow](https://www.covenantflow.ai/guides/covenant-monitoring)
- [Automated financials and covenant monitoring — Cardo AI](https://cardoai.com/automated-financials-and-covenant-monitoring/)
- [Manual Loan Monitoring vs. Automated Software — Covaleyo](https://covaleyo.com/blog/manual-loan-monitoring-vs-automated-software-which-protects-your-portfolio-best)
- [Loan Covenant Monitoring Software: Automate Portfolio Risk — Crediflow](https://www.crediflow.ai/blog/automate-loan-covenant-monitoring)
- [Quarterly Credit Union Data Summary 2026 Q2 — NCUA](https://espanol.ncua.gov/files/publications/analysis/quarterly-data-summary-2026-Q2.pdf)
- [NCUA Releases First Quarter 2026 Credit Union System Performance Data](https://ncua.gov/newsroom/press-release/2026/ncua-releases-first-quarter-2026-credit-union-system-performance-data)
- [Top 10 GCCs in Banking & Financial Services India (2026) — Gladwin International](https://www.gladwininternational.com/intelligence/gccs/top-gccs-bfsi)
- [The India GCC Index 2026 — Astravise Services](https://astraviseservices.com/insights/the-india-gcc-index-2026-companies-cities-sectors-and-functions/)
- [BFSI Hiring Trends 2026 — Taggd](https://taggd.in/blogs/bfsi-hiring-trends/)

*Vendor-published performance claims above are treated as marketing claims, not
independent measurements, and are labeled as such wherever used.*

### Owner-supplied figures (not sourced externally)

These come from the owner's commercial credit-systems experience and are the
backbone of the business case. They are stated here so a reader knows which
numbers rest on domain judgment rather than published data:

| Figure | Value | Used in |
|---|---|---|
| Covenant monitoring as a share of a credit analyst's time | 20–30% | §1.2, §1.3, §9.7 |
| Share of borrowers raising a contested exception per quarter | 10% | §9.3, §9.7 |
| Pricing unit and level | $5 per borrower per month | §9.5, §9.6, §9.7 |
| Target segment | Regional banks, commercial lenders, credit unions — not large banks | §1.2, §9.4 |

### Open questions — with owners and deadlines

| # | Question | Owner | Deadline | Blocks |
|---|---|---|---|---|
| 1 | Validate the three facility twists (F1, F3, F5) for realism | **Owner** | Before synthetic doc generation | The build |
| 2 | Compute and sign off 3 expected DSCR values | **Owner** | Before the eval runs | The scoreboard, not the build |
| 3 | `[NEED: 5 analyst interviews]` — primary user research | **Owner** | Before design-partner outreach | Launch gate, not MVP |
| 4 | `[NEED: 3+ verbatim customer quotes]` | **Owner** | Before Launch gate | Credibility of §1.3 |
| 5 | `[NEED: SMB/middle-market delinquency trend data]` for "why now" | **Owner** | Before the pitch | One claim in §1.3 |
| 6 | Fully-loaded analyst cost per hour | **Owner** | Before the pitch | ROI precision, not direction |
| 7 | Analyst hours per contested exception | **Owner** | Before the pitch | North Star baseline |
| 8 | Does Foundry **Connected Agents** (preview) work reliably here? | Claude | **First hour of the build** | The whole agent design — fallback is plain tools |
| 9 | India domestic lender market size | **Owner** | Post-MVP | §9.4 completeness |
| 10 | Copy the cohort HHH evals spreadsheet and link it | **Owner** | Before submission | Checklist item |

### Still unconfirmed figures — flagged, not assumed away

| Figure | Placeholder in use | Why it matters |
|---|---|---|
| Fully-loaded analyst cost per hour | ~$60 | Drives the ROI ratio (§9.7), though the conclusion holds from $40 to $80 |
| Analyst hours per contested exception today | ~2.5 | Drives the North Star baseline (§1.5). **Likely too low** — §9.7 derives an average test cycle of ~4.3 hours from the owner's time-share figure, and a *contested* exception should exceed the average, not sit below it. Worth correcting. |
| Target time-to-decision with the product | < 30 min | The North Star target itself (§1.5) |
| India domestic lender market size | Not sized | §9.4 — needs primary research, deliberately left blank |
