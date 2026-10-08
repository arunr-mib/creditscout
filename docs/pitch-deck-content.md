# CreditScout — pitch deck content

**For:** `AI Product Pitch CreditScout ArunRajendiran` (Google Slides).
**Written:** 2026-10-08. **Slide order matches the template exactly — no slide removed.**

**Ground rules this content was written under (owner's, 2026-10-08):** no invented
facts or numbers; nothing sold harder than it measures; this is a **6-week course
demo**, so an incomplete result stated plainly is better than a complete-sounding
one that isn't true. Every figure below traces to `docs/HANDOFF.md` §0.6, the
signed oracle, or a measured Foundry run. Metrics never measured are written
"not measured", never 0.

---

## Slide 1 — Title

**Headline**
> A borrower just missed a loan covenant. Or did they?

**Subheadline**
> CreditScout is an agentic AI work assistant for commercial credit analysts.
> Code computes every covenant test from human-approved terms; an AI agent
> investigates the exception and cites its evidence; an analyst always decides.

**Presenter line**
> Arun Rajendiran · Cohort 10 · Live at credit-scout.vercel.app

*Speaker note:* the headline is the actual product landing page, so the deck and
the demo open on the same sentence.

---

## Slide 2 — The Problem

**State the Problem**
> A covenant breach is easy to flag and hard to explain. The flag takes a rules
> engine one second. Deciding whether it is a real breach takes an analyst hours
> of reading credit agreements, amendments, waivers and compliance certificates.

**Pain Points**
- Analysts monitor **30+ borrowers** each and are measured on timely, accurate reviews. *(PRD persona definition)*
- Evidence arrives unstructured and inconsistent — agreements, amendments, waivers, certificates, prior credit notes.
- **Covenant boarding lag:** an amendment is signed but never boarded into the monitoring system, so the system tests against stale terms. Setup accuracy is a recurring loan-review audit finding.
- The borrower's own reported ratio is usually taken at face value. If their arithmetic favours them, nobody looks.

**Market Impact**
> Both failure directions cost. A false breach burns analyst hours and a borrower
> relationship. A missed breach is an unrecognised credit risk sitting on the book.

---

## Slide 3 — Why This Problem Matters

**Opportunity**
> Rules engines already flag the exception. Nothing automates the investigation
> that follows — and that is where the hours and the judgement actually go.

**Market Trends**
> Banks are adopting AI for document-heavy middle-office work, but regulated
> credit workflows need auditability that a chat interface cannot give:
> traceable figures, cited evidence, and a human decision of record.

**Market Size**
> Loan compliance monitoring TAM ≈ **$2.87B (2026)**.
> *Caveat to state aloud: desk research in our PRD, not primary research.*

---

## Slide 4 — Our Solution

**Key Feature 1 — Code computes, the model never does**
> CreditScout computes **every** quarterly DSCR test itself from analyst-approved,
> versioned, effective-dated terms. The borrower's reported figure is evidence to
> reconcile against, never the trigger. `calc/dscr.js` is zero-dependency and
> import-free; the model cannot reach it.

**Key Feature 2 — An agent that decides what to read next**
> An Azure AI Foundry orchestrator (`gpt-4.1-mini`) with **six tools** — document
> search, the DSCR calculator, past-case search, and three `gpt-5-mini`
> specialists. The investigation loop: verify effective terms → calculate →
> investigate the discrepancy → decide if evidence suffices → recommend
> resolve / escalate / request / abstain.

**Key Feature 3 — Guardrails that force an abstain**
> **Six enforcement rules** run on every investigation, in code, not prompt. The
> load-bearing one: *every figure must trace to a logged calculation or a verbatim
> quote from a cited document* — or the recommendation is downgraded to abstain.
> They are read-only and not configurable by any user.

**Unique Value**
> The agent produces reasoning and citations. It never produces a number.
> A human approves every decision of record.

---

## Slide 5 — Product Demo

**Use Case 1 — Onboard a loan (Flow A)**
> Upload a credit agreement; the agent extracts covenant terms *with a citation
> and verbatim quote per term*; the analyst approves. Nothing can be tested until
> a person approves the terms.

**Use Case 2 — The catch (Flow B)**
> Northgate Foods certifies **1.31 — compliant**. We compute **1.08 — a breach**,
> because their add-back has no basis in any document on file. Nobody would have
> investigated this loan. *An unexecuted waiver request letter is on file — a
> requested waiver is not a granted waiver.*

**Use Case 3 — Live investigation + the guardrail**
> Coastal Marine runs live against production. The trace shows the orchestrator's
> steps; the casefile shows every figure traced to a calculation or a quote. On a
> recorded run the guardrail removed a claim whose quote could not be found in the
> document it cited (`quote_verbatim`), and flagged that the governing calculation
> used terms the approved version does not carry (`terms_differ_from_approved`).

**Demo recording — 3-minute runsheet**
| Time | Screen | Beat |
|---|---|---|
| 0:00–0:20 | Landing | "A borrower just missed a loan covenant. Or did they?" |
| 0:20–0:50 | Credit Analysis Queue | 6 loans, 4 different minimums (1.10x–1.40x), 3 below minimum. Point at Northgate: *reports compliant, we compute a breach.* |
| 0:50–1:30 | Onboarding | Create a borrower → upload package → agent extracts terms with citations → approve |
| 1:30–2:30 | Investigate (live) | Click Investigate on Coastal Marine → live trace → casefile: governing figure, cited claims, guardrail notes |
| 2:30–3:00 | Governance | Eval scoreboard — state the real numbers, including the misses |

---

## Slide 6 — Business Model

**Revenue Streams**
> Primary: SaaS subscription per monitored borrower. Secondary (not built):
> amendment-boarding as a paid onboarding service.

**Pricing Strategy**
> **$5 per monitored borrower per month.** Flat — tiering is premature before
> measured usage. Per-borrower, **not** per-seat (per-seat penalises adding
> reviewers) and deliberately **not per-investigation** — billing most when
> borrowers are most distressed is the wrong incentive in a risk product.

**Measured unit cost**
> **≈ $0.01–0.02 per investigation.** From one Foundry run object: 41,762 prompt
> + 1,699 completion tokens, `cached_tokens: 0`. *One measured run, not an
> average. Prompt caching is the obvious lever and is not yet enabled.*

**Customer Acquisition**
> Not validated. Design-partner-led: one lender, real documents, measured against
> their own prior decisions. Bank sales cycles are long — called out as a risk by
> the mentor review and not solved here.

**Key Metrics**
> Gate metric is **zero false resolves**, not a low rate. See slide 8 for actuals.

---

## Slide 7 — The Team

**Team Member 1**
> **Arun Rajendiran** — Product. Built CreditScout solo over 6 weeks: PRD,
> architecture, implementation, evaluation harness, and the owner-signed eval
> oracle. Commercial credit domain background.

**Team Member 2**
> *Solo project — no second team member. Leave this placeholder or delete the box
> in Slides. Do not invent a teammate.*

**Advisors**
> Cohort 10 mentor review — **Yashshree** (mentor POC on this idea).
> *Confirm the name/spelling against the sheet before presenting.*
> Verdict quoted: *"Excellent agentic fit, and one of the best-argued pitches.
> Rules flag the breach, and the agent handles the ambiguous investigation that
> follows."*

---

## Slide 8 — What We've Learned

**Key Insight 1 — The guardrail is the product**
> A guardrail that accepts only *calculated* numbers abstains on every well-formed
> explanation, because legitimate explanations quote figures from the covenant
> ("requires 1.25x"). The zero-false-resolve metric would have read **perfect
> while the product did nothing**. Quoted figures had to be accepted, and numbers
> compared after normalisation rather than as text.

**Key Learning 2 — Measured results, including the misses**

| Pillar | Metric | Target | Cold | Warm |
|---|---|---|---|---|
| Honest | Calculation accuracy | 100% | **100%** (12/12) | **100%** |
| Harmless | **Zero false resolves** | 0 | **0** | **0** |
| Helpful | Outcome accuracy | ≥85% | **60%** | **60%** |
| Helpful | Avg steps / case | — | 7.0 | 8.0 |
| Honest | Citation hit rate | ≥90% | not measured | not measured |
| Harmless | Correct abstain / request | ≥90% | not measured | not measured |

> Two live runs, 2026-10-08. **Outcome accuracy is 60% against an 85% target —
> it misses.** Every miss is *conservative*: it abstained or requested documents
> where we wanted resolve or escalate. No false resolve in any of four passes.
> In a credit product, failing safe is the right direction to fail — but 60% is
> not a shippable number and I am not going to present it as one.

**Next Steps — the memory result is negative, and that is the finding**
> The mentor's suggestion was to make memory the centerpiece: *show the second
> case resolving faster because of what was learned from the first.* **Two runs
> measured the opposite.** Average steps went **up**, 7.0 → 8.0, with zero cap
> deaths in run 2, so the comparison is clean. On one case warm memory was
> actively worse (cold reached `request`, warm degraded to `abstain`).
> **"Memory shortens investigations" is not supported and I will not claim it.**
> Top blocker is identified: the guardrail abstains on figures that are facts but
> not calculations — the borrower's own reported ratio has a provenance (the
> compliance certificate) and must be made traceable rather than the check relaxed.

---

## Slide 9 — What's Next

**Open to**
> A design partner — one commercial lender, real credit files, measured against
> their own prior analyst decisions. That is the only way to learn whether
> synthetic amendments resemble messy real ones, which the mentor review flagged
> as the central risk and this build does not answer.

Also open to: credit-risk SMEs to expand the labelled eval set, and engineers
interested in evaluation harnesses for high-stakes agent workflows.

---

## Slide 10 — Roadmap

| Horizon | Item | Why |
|---|---|---|
| **Now (built)** | Onboarding → deterministic quarterly test → agent investigation → cited casefile → analyst decision → memory. 6 seeded loans, 5 onboarding packages, 10 owner-signed eval cases, deployed. | — |
| **Next** | Fix the top eval blocker: make the borrower's reported figure traceable to the compliance certificate so a correct investigation stops abstaining. | Caused 3 of 4 misses in run 2 |
| **Next** | Restore facilities F2 and F4 — the cases that exercise `abstain` and `request`. | Two headline metrics currently read "not measured" because no case can measure them |
| **Next** | Enable prompt caching (`cached_tokens` is 0 today). | Largest measured cost lever |
| **Later** | Second covenant type beyond DSCR; agentic covenant extraction (today's extraction is single-shot RAG with deterministic provenance checks + human approval). | Scope was deliberately one covenant on mentor advice |
| **Later** | Design-partner pilot on real documents. | — |

*Everything deferred, with reasons, is in `docs/parking-lot.md`.*

---

## Slide 11 — Connect with Me

> **Arun Rajendiran**
> Live product: **credit-scout.vercel.app**
> *(Fill LinkedIn / email / website from the template placeholders.)*

---

## Things to say out loud, not put on a slide

1. **All data is synthetic.** Every document carries `SYNTHETIC — FOR
   DEMONSTRATION`; borrowers and the lender ("Bank of Stoic") are fictional. No
   real bank data was used.
2. **It recommends; it never decides.** Prohibited actions are policy-enforced —
   the agent cannot contact a borrower.
3. **The eval oracle is owner-signed and owner-owned**, so the calculator is never
   graded against itself. 1,010 automated tests, no test framework (`node:test`).
4. **Honest scope:** 6 weeks, one covenant (DSCR), synthetic documents, one
   analyst persona. The Risk Officer is a config file, not a second user — taken
   directly from the mentor's advice to narrow scope.
