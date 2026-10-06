# CreditScout — Mental Model & User Flows

**For review before build starts.** Date: 2026-10-05

---

## 1. The mental model

### 1.1 Three layers, one rule each

| Layer | Who | The one rule |
|---|---|---|
| **Reasoning** | The model | Decides what evidence to look at next. **Never produces a number.** |
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
| **Covenant setup** | Agent extracts executable terms from the agreement + amendments, each with a citation | **Analyst approves** | A setup error silently corrupts *every future quarter's* test |
| **Quarterly outcome** | Agent investigates and recommends | **Analyst approves or overrides** | The system makes a credit decision, which it must never do |

### 1.3 The borrower's number is evidence, not truth

This is the change from the original design and it is the most important idea in
the product.

- **Old:** read the borrower's reported DSCR → is it below threshold? → if yes, investigate.
- **New:** compute the DSCR ourselves from approved terms + financials → is *our* number below threshold? → if yes, investigate. The borrower's figure is then **reconciled against ours**.

A borrower whose arithmetic is wrong in their own favour is invisible under the
old model and caught under the new one.

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
| **Document** | Agreement, amendment, waiver, certificate, financials | Analyst uploads |
| **Terms** | The executable covenant — threshold, add-backs, caps, period. Versioned, effective-dated. | Agent proposes, **analyst approves** |
| **Test** | One quarterly calculation for one borrower | **Code** |
| **Exception** | A test our calculation failed | **Code** |
| **Casefile** | The investigation: trace, claims, citations, recommendation | Agent, **policed by code** |
| **Decision** | Approve / override / request docs | **Human** |
| **Lesson** | The analyst's reasoning, retrievable on later cases | Human's words, stored verbatim |

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

Neither gate is a prompt. Both are unit-tested functions. That is what makes the
"0 false resolves" claim mean something.

---

## 2. Flow A — Covenant setup

**Runs once per facility, and again whenever an amendment arrives.**

```
 ANALYST                    SYSTEM                          OUTPUT
 ───────                    ──────                          ──────

 Upload credit      ──▶  Extract text, chunk
 agreement               by section, embed
 + amendment
                            │
                            ▼
                    ┌───────────────────────┐
                    │ definition_agent      │   MODEL
                    │ reads the definitions │
                    │ article + amendments  │
                    └───────────┬───────────┘
                                │
                                ▼
                         Executable terms
                         · threshold 1.25x        ← each line
                         · EBITDA basis             carries a
                         · permitted add-backs      citation +
                         · caps                     verbatim
                         · denominator parts        quote
                         · effective dates
                                │
                                ▼
 Review side-by-side  ◀──  Present terms next
 with the source           to the source clause
 clause
       │
       ├── Edit a term ──▶ corrected
       │
       └── APPROVE ──────────────────────▶  Terms v1, effective
            (four-eyes                       2026-04-01, LIVE
             checkpoint)                     Reused every quarter
```

**Why the approval step exists:** an error here is silent and compounding — it
would corrupt every future test for that borrower. This is the step that makes
"validated covenant specifications" a real asset rather than a claim.

**Amendment handling:** a new amendment produces **Terms v2** with its own
effective date. v1 is never overwritten, because a Q1 test must run against the
terms that were in force in Q1.

---

## 3. Flow B — Quarterly monitoring

**Runs for every borrower, every quarter.** This is the end-to-end loop.

```
 ANALYST                 SYSTEM                              OUTPUT
 ───────                 ──────                              ──────

 Upload quarterly  ──▶  Ingest: extract, chunk, embed
 package
 (certificate +            │
  financials)              ▼
                    Load APPROVED terms
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
                                   │  ORCHESTRATOR AGENT      │ MODEL
                                   │   ├ document_agent       │
                                   │   ├ definition_agent     │
                                   │   ├ research_agent       │
                                   │   ├ dscr_calculator ─────┼─ CODE
                                   │   └ search_past_cases ───┼─ memory
                                   └──────────┬───────────────┘
                                              │  live step trace
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

| Our number | Borrower's number | Result |
|---|---|---|
| Passes | Agrees with ours | Log compliant, no action |
| Passes | Differs beyond tolerance | **Log the variance.** No investigation — their arithmetic is off but the conclusion stands |
| **Fails** | Anything | **Exception → full investigation** |

Row 3 is the one the old design could not reach when the borrower reported a
passing number.

---

## 4. The MVP: three facilities

| Facility | Twist | Expected path | Outcome |
|---|---|---|---|
| **F1 Harbor Logistics** | Amendment No. 2 permits a one-time restructuring add-back. Borrower reports 1.12. | definition → calc (fail) → research → finds Amd 2 → re-map terms → calc (pass) → resolve | **Resolve** (~6 steps) |
| **F3 Northgate Foods** | A genuine breach. Nothing in the file explains it. | definition → calc (fail) → research (nothing found) → escalate | **Escalate** (~4 steps) |
| **F5 Coastal Marine** | Same amendment pattern as F1, a quarter later. | memory lesson → check amendments first → calc (pass) → resolve | **Resolve** (~3 steps, warm memory) |

F1 and F5 together are the demo: **the same problem, solved twice, the second
time in half the steps because a human taught it something.**

### F5 carries two extra quarters, so all three outcomes are shown

The exception path is only one of the three quarterly outcomes. Without these,
the demo never shows what happens to the other ~90% of borrowers.

| Period | F5 scenario | Outcome |
|---|---|---|
| Q4 2025 | We compute 1.41 · borrower reports 1.41 · agree | **1 — compliant, no action** |
| Q1 2026 | We compute 1.38 · borrower reports **1.29** (they omitted a permitted add-back) · both clear 1.25 | **2 — variance logged, not investigated** |
| Q2 2026 | We compute 1.12 pre-amendment → exception → memory from F1 → resolves | **3 — breach → investigate** |

Two extra financials + certificate pairs, no new facility. Q1 2026 is the one
that earns the end-to-end redesign: **the borrower's arithmetic is wrong and
their conclusion is still right** — invisible under the old design, and the
cheapest possible proof that we compute independently.

---

## 5. Demo storyboard (3 minutes)

| Time | What's on screen | The point being made |
|---|---|---|
| 0:00–0:35 | Problem — the queue of facilities, a quarter closing | Rules flag the breach; the investigation is the hard part |
| 0:35–0:55 | **Flow A** — agent extracts executable terms from the agreement, analyst approves | The hardest part, with four-eyes control |
| 0:55–1:15 | **Flow B** — quarterly package uploaded, calculator runs on all three borrowers, F1 fails | *We* compute it, not the borrower |
| 1:15–1:55 | F1 investigation: live trace, agent finds Amendment No. 2, recomputes, resolves. Click a citation → source clause with the quote highlighted | The agent reasons; the code calculates; every claim is checkable |
| 1:55–2:15 | Analyst overrides with a reason → F5 runs → resolves in 3 steps with "seen similar" | The system learns from the human |
| 2:15–2:40 | Scoreboard: 0 false resolves, 100% calculation accuracy, steps cold vs warm | The trust claim, as a number |
| 2:40–3:00 | Pricing, market, roadmap | It's a business, not a demo |

---

## 6. How the expected DSCR values work *(answering "how do I do this?")*

**You do not need these to start — they are needed before the eval runs, not
before the build starts.**

**The sequence:**

1. I generate the three synthetic facilities, with the covenant terms and the six
   financial figures printed as labeled lines.
2. I generate `data/expected-values-template.csv` — one row per case, pre-filled
   with everything *except* the answer:

   | case_id | facility | period | threshold | ebitda | addbacks | capex | taxes | principal | interest | **expected_dscr** | **owner_signed_off** |
   |---|---|---|---|---|---|---|---|---|---|---|---|
   | F1-Q2 | Harbor Logistics | 2026-06-30 | 1.25 | 4,250,000 | 500,000 | … | … | … | … | *(you fill)* | NO |

3. **You open it in Excel and compute the DSCR yourself** — the normal formula,
   your own arithmetic. Three rows. ~15 minutes.
4. You change `owner_signed_off` to `YES` per row.
5. The eval runner **refuses to run** while any row says `NO`.

**Why you and not me:** if the thing grading the calculator was written by the
same author as the calculator, the tests only prove it agrees with itself. Your
independent computation is what makes "100% calculation accuracy" a measurement
instead of a tautology.

**How it shows up in the demo:** the spreadsheet itself isn't on screen. What's
on screen at 2:15 is the scoreboard line — **"100% calculation accuracy against
independently computed expected values"** — and in the Q&A or the deck appendix
you can say the oracle was computed by a credit professional in a spreadsheet,
separately from the code. That sentence is the reason the number is believable.

---

## 7. What we are deliberately not building now

All of this moves to the backlog as post-MVP, not out of scope forever:

| Deferred | Why it's safe to defer |
|---|---|
| Facilities F2, F4, F6 | F1/F3/F5 already cover resolve, escalate, and the memory effect |
| 24 eval cases → 6 | Enough to measure; we report 6 as 6, never claim 24 |
| Email intake | Workflow convenience; proves nothing about reasoning |
| Governance page (editable) | Static read-only panel carries the governance story |
| Foundry groundedness judge | Local metrics carry the trust claim; add the judge after |
| Covenant setup **screen** | If time runs out, terms are pre-approved in the database and the demo narrates it. Flow A survives; only the visual is lost. |
| Other covenants, OCR, integrations, auth | Never in MVP scope |
