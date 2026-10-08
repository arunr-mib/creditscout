# CreditScout — Mental Model & User Flows

**Current state of the built product.** Date: 2026-10-07 (supersedes the
2026-10-05 pre-build version). Live at `https://credit-scout.vercel.app`.

---

## 1. The mental model

### 1.1 Three layers, one rule each

| Layer | Who | The one rule |
|---|---|---|
| **Reasoning** | The model — shown in the product as the **Credit-scout Agent** | Decides what evidence to look at next. **Never produces a number.** |
| **Calculation** | Code | Produces every number. **Never decides anything.** |
| **Approval** | The human | Decides. **Always.** |

If you are ever unsure where a piece of behaviour belongs, ask which of those
three sentences it violates.

### 1.2 Maker-checker, twice

The industry control for covenant work is the four-eyes principle — one person
prepares, a second approves. CreditScout applies it at **both** points where an
error would propagate:

| | Maker | Checker | What breaks without it |
|---|---|---|---|
| **Loan onboarding** | Agent extracts executable terms from the agreement + amendments, each with a citation | **Analyst approves** | A setup error silently corrupts *every future quarter's* test |
| **Quarterly outcome** | Agent investigates and recommends | **Analyst approves or overrides** | The system makes a credit decision, which it must never do |

### 1.3 The borrower's number is evidence, not truth

This is the most important idea in the product.

- **Old:** read the borrower's reported DSCR → is it below threshold? → if yes, investigate.
- **Ours:** compute the DSCR ourselves from approved terms + financials → is *our* number below threshold? → if yes, investigate. The borrower's figure is then **reconciled against ours**.

A borrower whose arithmetic is wrong in their own favour is invisible under the
old model and caught under ours (F3 Northgate is exactly that case).

### 1.4 The seven nouns

Everything in the system is one of these, and they always move left to right:

```
Document → Terms → Test → Exception → Casefile → Decision → Lesson
            │                                                  │
            └──────────── approved once, reused ───────────────┘
                     Lesson feeds the next Casefile
```

| Noun | What it is | Who creates it |
|---|---|---|
| **Document** | Agreement, amendment, waiver, certificate, financials | Analyst uploads (onboarding wizard or quarterly package) |
| **Terms** | The executable covenant — threshold, add-backs, caps, period. Versioned, effective-dated. | Agent proposes, **analyst approves** |
| **Test** | One quarterly calculation for one loan | **Code** |
| **Exception** | A test our calculation failed | **Code** |
| **Casefile** | The investigation: trace, claims, citations, recommendation | Agent, **policed by code** |
| **Decision** | Approve / override / request docs | **Human** |
| **Lesson** | The analyst's reasoning, retrievable on later cases | Human's words, stored verbatim |

**Vocabulary note.** The database and code say `facility`; every screen says
**loan** (the owner's call — analysts say "loan"). Same noun.

### 1.5 Two gates, both made of code

```
   Agent output ──▶ [ GUARDRAIL ]  ──▶ [ POLICY ]  ──▶ Human
                    every number       variance,
                    traceable?         breach depth,
                    every quote        prohibited
                    verbatim?          actions
                         │                  │
                      else ABSTAIN      else ESCALATE
```

Neither gate is a prompt. Both are unit-tested functions. That is what makes
the "0 false resolves" claim mean something. **Verified live:** on a re-run of
Harbor, the agent attempted `resolve` without a logged passing calculation and
the guardrail downgraded it to `escalate`, with the reason shown on screen.

### 1.6 Where the agent actually lives

One agent object exists: the **Credit-scout Agent**, an Azure AI Foundry Agent
Service orchestrator (`gpt-4.1-mini`). It carries **six function tools**:

| Tool | Kind | What it does |
|---|---|---|
| `search_documents` | HTTP route (code) | Semantic search over the loan's own chunks, never another borrower's |
| `dscr_calculator` | HTTP route (**code**) | The only thing in the product that produces a number |
| `search_past_cases` | HTTP route (memory) | Top lessons from prior casefiles for a similar exception |
| `definition_agent` | Specialist, in-process (`gpt-5-mini`) | Maps the definitions article + amendments to executable terms, with citations |
| `research_agent` | Specialist, in-process (`gpt-5-mini`) | Explains a gap between our number and the borrower's |
| `document_agent` | Specialist, in-process (`gpt-5-mini`) | Quotes facts from the documents, with citation |

The specialists were Foundry **Connected Agents** in the original design. That
was dropped during the build: a connected agent's inner run cannot carry a
function tool, so a specialist could not retrieve for itself and every
delegation was a step spent re-reading text the orchestrator already held. As
in-process tools, each specialist retrieves for itself. The trace labels every
specialist step "delegated by the Credit-scout Agent", so the orchestration is
visible, not implied.

---

## 2. Flow A — Loan onboarding (covenant setup)

**Runs once per loan, and again whenever an amendment arrives.** Built as a
four-step, route-driven wizard; entry is **"+ New borrower"** on the Portfolio.

```
 STEP   ANALYST                      SYSTEM                        OUTPUT
 ────   ───────                      ──────                        ──────

  1     New borrower:          ──▶  create the loan row            /borrowers/[id]
        name, industry

  2     Upload ALL documents   ──▶  extract text, chunk by         chunks + embeddings,
        in one place:               section, embed                 filed under this loan
        · loan agreement (req.,
          effective date req.)
        · amendment(s) (date req.)
        · financials, certificate
        "Continue" unlocks once the agreement is indexed

  3     "The Credit-scout      ──▶  definition tool reads the       proposed Terms v1,
         Agent is extracting        definitions article +           each line with a
         the covenant terms         amendments → executable         citation + verbatim
         from your loan             terms; code verifies every      quote; uncited
         agreement"                 cited quote is really there     clauses flagged

  4     Review side-by-side    ──▶  edit a term, or
        with the source clause      APPROVE (four-eyes)        ──▶  Terms v1 APPROVED,
                                                                    effective-dated,
                                                                    reused every quarter
 Done   Loan appears on the Portfolio as "Not tested" until the quarter runs
```

**Why the approval step exists:** an error here is silent and compounding — it
would corrupt every future test for that loan. This is the step that makes
"validated covenant specifications" a real asset rather than a claim.

**How "agentic" step 3 is — honestly.** The extraction is a **single-shot
retrieval-and-extract** call over a fixed set of queries, backstopped by three
deterministic checks (threshold provenance, citation-quote verification,
drift warnings) and the human approval. It is reliable and auditable, but it
does not decide what to read next. Making it a true agentic loop (base
definition → the amendment that restates it → re-extract) is backlog item 4.9
in `docs/parking-lot.md`; the *investigation* in Flow B is where the agentic
retrieval already lives.

**Amendment handling:** a new amendment produces **Terms v2** with its own
effective date. v1 is never overwritten, because a Q1 test must run against
the terms that were in force in Q1.

---

## 3. Flow B — Quarterly monitoring

**Runs for every loan, every quarter.** This is the end-to-end loop.

```
 ANALYST                 SYSTEM                              OUTPUT
 ───────                 ──────                              ──────

 Upload quarterly  ──▶  Ingest: extract, chunk, embed
 package
 (certificate +            │
  financials)              ▼
 "Run Q{N}"         Load APPROVED terms
                    in force for this period
                           │
                           ▼
                    ┌──────────────────────┐
                    │  DSCR CALCULATOR     │   CODE
                    │  our own number      │   never the model
                    └──────────┬───────────┘
                               │
                 ┌─────────────┼─────────────────┐
                 ▼             ▼                 ▼
          Our DSCR ≥      Our DSCR ≥        Our DSCR <
          threshold       threshold         threshold
          variance OK     variance > tol         │
                 │             │                 │
                 ▼             ▼                 ▼
            Log compliant  LOG VARIANCE      EXCEPTION
            No action      No investigation       │
                           (their maths is        │
                            off, conclusion       │
                            still right)          │
                                                  ▼
                                   ┌──────────────────────────┐
                                   │  CREDIT-SCOUT AGENT      │ MODEL (Foundry)
                                   │   ├ search_documents ────┼─ CODE
                                   │   ├ dscr_calculator ─────┼─ CODE
                                   │   ├ search_past_cases ───┼─ memory
                                   │   ├ definition_agent     │ specialist
                                   │   ├ research_agent       │ specialist
                                   │   └ document_agent       │ specialist
                                   └──────────┬───────────────┘
                                              │  live trace, each step
                                              │  annotated with its purpose
                                              ▼
                                   ┌──────────────────────────┐
                                   │ GUARDRAIL → POLICY       │ CODE
                                   └──────────┬───────────────┘
                                              ▼
                                       Cited casefile
                                       · resolve / request
                                         / escalate / abstain
                                       · explanation ≤150 words
                                       · every claim cited
                                       · every number traced
                                              │
 Review  ◀────────────────────────────────────┘
    │
    ├── APPROVE ────────▶ closed
    ├── OVERRIDE ───────▶ reason stored verbatim ──▶ LESSON
    └── REQUEST DOCS ───▶ awaiting docs
                                                        │
                                   next similar case ◀──┘
                                   starts informed
```

### The three outcomes of a quarterly test

| Our number | Borrower's number | Result | Portfolio status |
|---|---|---|---|
| Passes | Agrees with ours | Log compliant, no action | Compliant |
| Passes | Differs beyond tolerance | **Log the variance.** No investigation — their arithmetic is off but the conclusion stands | Compliant (variance noted) |
| **Fails** | Anything | **Exception → full investigation** | Needs action → Investigating → Pending review → **Decided** |

Row 3 is the one the old design could not reach when the borrower reported a
passing number. A decided breach reads **"Decided"**, never "Compliant".

### What the casefile screen leads with

The casefile is **governing-first**: the top banner states the test period's
figure under the terms that *governed* that period (the approved version), and
a separate **amendment panel** says whether an amendment on file is boarded,
unboarded, or superseded. Any narrative that depends on an unboarded amendment
is labelled **provisional** until the analyst boards it. A credit analyst
reviewer asked for exactly this ordering: the governing number first, the story
second.

---

## 4. The demo portfolio

The lender in every synthetic document is **Bank of Stoic** (fictional). Every
document carries `SYNTHETIC — FOR DEMONSTRATION`.

### 4.1 The six seeded loans — three with a twist, three performing

| Loan | Period | Borrower reports | **We compute** | Mechanism | Expected path | Outcome |
|---|---|---|---|---|---|---|
| **F1 Harbor Logistics** | Q2 2026 | 1.12 | **1.12** (agree, both fail) | Approved terms are **v1**; Amendment No. 2 (effective 2026-04-01) is **on file but not yet boarded** | terms → calc (fail) → research → spots the unboarded amendment → re-map → calc (pass, 1.28) | **Resolve + re-board as v2** |
| **F3 Northgate Foods** | Q2 2026 | **1.31 — compliant** | **1.08 — breach** | Borrower took an add-back with **no basis** in the agreement or any amendment. An unexecuted waiver *request* letter is on file, dated after the period, unsigned by the lender. | calc (fail) → research → finds the request letter → a requested waiver is not a granted waiver | **Escalate** (`true_breach`) |
| **F5 Coastal Marine** | Q4 2025 | 1.41 | 1.41 | Agree | code only, no agent | **Compliant, no action** |
| **F5 Coastal Marine** | Q1 2026 | **1.38** | **1.29** | Borrower took the full $900k dry-dock add-back; the covenant **caps it at $500k**. Both still clear 1.25. | code only, no agent | **Variance logged, not investigated** |
| **F5 Coastal Marine** | Q2 2026 | 1.30 | 1.12 | Same unboarded-amendment pattern as F1 (fuel-hedging add-back lives only in unboarded v2) | memory lesson → check amendments first → calc (pass, 1.30) | **Resolve** in fewer steps (warm memory) |

**F3 is the headline case.** The borrower reports *compliant*; nobody would have
investigated. We compute a breach because we applied their actual covenant.

#### The performing loans

The three above are the cases worth investigating, and for a while they were the
whole seeded book — which made the portfolio read as though every loan were a
problem and every covenant were set at 1.25x. Three performing loans carry the
rest of the book:

| Loan | Minimum | Borrower reports | **We compute** | Outcome |
|---|---|---|---|---|
| **F7 Dokusign Inc** | **1.40x** | 1.54 | 1.54 | Compliant, no action |
| **F8 Peat's Coffee Company** | **1.10x** | 1.19 | 1.19 | Compliant, thin headroom |
| **F9 Costko Wholesale** | **1.35x** | 1.59 | 1.59 | Compliant, no action |

They are deliberately dull — one boarded version, no add-back, no amendment,
reported equals computed — and they do two jobs. They show what the code-only
path looks like when nothing is wrong, and they make the minimum legible as a
**term negotiated per loan** rather than a constant. The number the agent reads
comes from that loan's own §7.11; nothing in the product hard-codes 1.25.

They raise no exception, produce no casefile and appear in **no oracle row**, so
no eval metric counts them.

**Covenant boarding lag is the F1/F5 mechanism, and it is realistic** — setup
accuracy is a recurring loan-review audit finding, which is also why Flow A
requires four-eyes approval. Any seed or fixture that boards the amendment
dissolves the twist.

F1 and F5 together are the memory beat: **the same problem, solved twice, the
second time faster because a human taught it something.**

### 4.2 Five onboarding loans — the "new borrower" packages

These exist as **upload packages only** (`data/facilities/<ID>/`), never
seeded, so onboarding genuinely creates the loan live. Each has an agreement,
financials and a certificate; Zhatsapp also has an amendment notice.

| Loan | Threshold | Borrower reports | **We compute** (Q3 2026) | Outcome |
|---|---|---|---|---|
| **Zhatsapp Inc** | 1.25 | 1.37 | **1.37** | Compliant |
| **Marcus Tech** | 1.15 | 1.42 | **1.42** | Compliant |
| **Orion Medical Supply** | 1.20 | 1.46 | **1.46** | Compliant |
| **Petworks LLC** | 1.25 | 1.39 | **1.39** | Compliant |
| **Vantage Print Works** | 1.30 | 1.13 | **1.13** | **Breach → escalate** (`true_breach`) |

Four clean passes and one honest breach: enough to show that onboarding a loan
leads straight into the same quarterly loop, and that the agent investigates
*from the documents the analyst just uploaded*, not from anything it was told.

---

## 5. Demo storyboard (3 minutes)

The pitch objective is to show the **power of the Credit-scout Agent as an
orchestrator**. Beats are prioritised **A (orchestration) → C (memory) →
B (guardrail)**.

| Time | What's on screen | The point being made |
|---|---|---|
| 0:00–0:30 | Portfolio triage table — a quarter closing, statuses at a glance | Rules flag the breach; the investigation is the hard part |
| 0:30–0:55 | **Flow A** — "+ New borrower", upload the package, *"The Credit-scout Agent is extracting the covenant terms…"*, approve side-by-side with the clause | The agent's source is the analyst's own documents; four-eyes control |
| 0:55–1:10 | "Run Q2" — the calculator runs on every loan; F1 fails, F3 fails *despite reporting compliant* | *We* compute it, not the borrower |
| 1:10–1:55 | **Beat A** — F1 investigation: the trace reads as an orchestration plan; each step annotated; the agent delegates to a specialist, finds Amendment No. 2, recomputes, resolves. Click a citation → the clause, quote highlighted | The agent decides what to read next; the code calculates; every claim checkable |
| 1:55–2:15 | **Beat C** — analyst approves with a reason → F5 runs → "seen similar", fewer steps | The system learns from the human |
| 2:15–2:35 | **Beat B** — Governance: the HHH scoreboard — 0 false resolves, 100% calculation accuracy, cold vs warm steps; the guardrail downgrade shown on a casefile | The trust claim, as a number |
| 2:35–3:00 | Pricing, market, roadmap | It's a business, not a demo |

---

## 6. How the expected DSCR values work — and where they stand

**Status: done.** The oracle is `data/expected-values-template.csv` —
**10 cases, every row `owner_signed_off = YES`** (signed 2026-10-07): the five
F1/F3/F5 quarterly tests plus the five onboarding loans. Each row carries the
six calculator inputs, the add-backs with their caps and *which terms version
permits them*, the expected DSCR **as tested** (under the boarded terms) and
**remapped** (under the unboarded amendment, where one exists), the expected
outcome and the expected pattern tag.

**Why the owner and not the code:** if the thing grading the calculator was
written by the same author as the calculator, the tests only prove it agrees
with itself. The owner's independent computation is what makes "100%
calculation accuracy" a measurement instead of a tautology. The eval runner
refuses to run while any row is unsigned.

**Where the evals run — hybrid, by design:**

| Layer | Where | Produces |
|---|---|---|
| Oracle grading (false-resolve gate, calc accuracy, outcome accuracy, memory effect) | **Node, local/CI** — `evals/run.mjs`, deterministic code against the signed key | `results.csv`, `report.md`, an `eval_runs` row that lights up the Governance scoreboard |
| The investigations being graded | **Azure** — the real Credit-scout Agent, cold pass (memory cleared) and warm pass (lessons loaded) | the recommendations the oracle grades |
| Groundedness (does every figure trace to a cited source) | **Azure AI Foundry Evaluations**, LLM judge | consumes the `foundry.jsonl` the harness writes |

The safety numbers are computed by code against a human-signed key — not
judged by another model. Only groundedness, which is a language judgment, goes
to the judge. The scoreboard is grouped **Honest / Harmless / Helpful** (the
cohort's HHH frame): Honest = calculation accuracy + citation + groundedness;
Harmless = false resolves (the gate) + correct abstain/request; Helpful =
outcome accuracy + the memory effect.

---

## 7. What is on screen

| Screen | Route | What it is for |
|---|---|---|
| Landing | `/welcome` | The one-line thesis; shared-credential demo gate |
| **Portfolio** | `/` | Triage table of every loan with status badges, "Needs action" filter, KPI band, **+ New borrower**, **Run Q{N}** |
| **Onboarding wizard** | `/borrowers/new`, `/borrowers/[id]/onboarding` | Flow A, steps 1–4 (§2) |
| Covenant setup | `/facilities/[id]/covenant-setup` | Review/approve proposed terms (also embedded as wizard step 4) |
| **Casefile** | `/casefiles/[id]` | Two-column canvas: decision + governing figure + amendment status on the left; persistent **Source \| Trace** pane on the right; retry on a failed run |
| Governance | `/governance` | The Risk Officer's policy (human review locked) + the eval scoreboard |
| Documents / Terms / Lessons | `/documents`, `/terms`, `/lessons` | Browse what is on file, every terms version, every lesson |
| Global search | left rail | Borrowers, casefiles, documents, terms, lessons, pages |

---

## 8. What we are deliberately not building now

Backlog, not out of scope forever. Full list with reasons: `docs/parking-lot.md` §4.

| Deferred | Why it's safe to defer |
|---|---|
| Agentic covenant-term extraction (parking-lot 4.9) | Single-shot extraction + provenance checks + approval holds; the investigation already shows agentic retrieval |
| Memory and guardrail **trace beats** (C and B as first-class trace annotations) | Orchestration (A) is the pitch priority; memory and the guardrail are already visible on the casefile |
| Facilities F2, F4, F6 | F1/F3/F5 + the five onboarding loans cover resolve, escalate, compliant and variance. F2/F4 would exercise `abstain`/`request` — the one metric the current set leaves unmeasured |
| Email intake | Workflow convenience; proves nothing about reasoning |
| Governance page (editable) | Built read-only; editing the policy is a DB update |
| Live-agent eval run + Foundry groundedness judge | Billable; run on the owner's say-so once the harness is in |
| Auth, dual-control approval, other covenants, OCR, integrations | Never in MVP scope |
