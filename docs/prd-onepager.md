# CreditScout one-pager

**Author:** Arun Rajendiran · **Date:** 2026-11-13 (revised from 2026-10-14) · **Status:** Built and deployed at `https://credit-scout.vercel.app`

> The companion to `docs/prd.md`. That document is the full nine-section cohort
> PRD. **This is the version for someone who will not read it:** leadership, a
> mentor, a design partner. If the two ever disagree, the full PRD wins.

---

## Hypothesis

**We believe that independently recomputing every covenant test from
human-approved, citation-backed terms, instead of trusting the borrower's
reported figure, will let a credit analyst close a covenant exception in under
30 minutes instead of ~2.5 hours, with zero false resolutions.**

---

## Problem

**Who:** Credit analysts at regional banks, commercial lenders and credit unions,
monitoring 30+ borrowers. Often executed from India-based GCCs. Not large banks.

**How bad:** Covenant monitoring is **20 to 30% of their time**: ~520 hours a year,
~4.3 hours per test cycle. Published benchmarks put the DSCR recomputation alone
at 30 to 40 minutes; the document archaeology around it takes longer.

**How they solve it today:** Spreadsheets, email, the loan document system, and
institutional memory. The workaround *is* the process.

**What breaks:** The investigation after a flag can't be written as rules. The
answer lives across a 60-page agreement, its amendments, a waiver, and a
borrower-prepared certificate. A rules engine flags the breach and stops.

**Evidence quality, stated honestly:** Market data and practitioner experience,
**not user research**. `[NEED: 5 analyst interviews]` (Owner, before
design-partner outreach.) No analyst conversations have happened yet, and no
quotes have been invented to fill the gap.

---

## Strategic fit

**Why now:** 1M-token context windows make amendment-precedence reasoning
tractable; managed multi-agent orchestration (Foundry Agent Service) means a
small team can build it; exception volume rises as credit quality softens.

**Competitive gap:** Origination platforms (nCino, Baker Hill) route work.
Covenant trackers (CovenantFlow, Covaleyo, Cardo AI) track the calendar.
Spreading tools produce inputs. **None does the reasoning step.** A general LLM
chat has no facility history, no governed calculation, no audit trail, and no
safe abstain.

**Moat:** Validated covenant specifications · deterministic calculation with
citations · an eval harness that produces a number competitors can't ·
lender-specific memory of past decisions. Memory is a v1 feature, but its
effect is not established: in the 2026-11-13 run warm beat cold (80% vs 60%
outcome accuracy, 7.3 vs 8.7 avg steps), and that is one run on five cases
after mixed October runs.

---

## Non-Goals

- **NOT** making credit decisions. Human review is locked, not configurable.
- **NOT** other covenants in V1: DSCR only, quarterly, TTM.
- **NOT** OCR, and **NOT** extracting figures from statement tables.
- **NOT** scoring creditworthiness. We check a contractual ratio against
  contractual terms, which keeps this out of fair-lending model territory.
- **NOT** investigating a variance when both numbers clear the threshold; we log it.
- **NOT** selling to large money-centre banks first.
- **NOT** using real bank data. 100% synthetic.

---

## Solution

Two flows. Diagrams and the screen inventory: `docs/mental-model.md`.

**A. Loan onboarding** *(once per loan, re-runs on amendment)*: a four-step
wizard from **"+ New borrower"**: create the loan → upload **all** its documents
in one place → *"The CreditScout Agent is extracting the covenant terms from
your loan agreement"*, every term with a citation and verbatim quote, every
quote code-verified → **analyst approves beside the source clause** → terms are
versioned and effective-dated → reused every quarter.

*Four-eyes control, because a setup error silently corrupts every future test.*

**B. Quarterly monitoring** *(every loan, every quarter)*
Upload package → "Run Q{N}" → load the approved terms in force → **code computes our DSCR** →

| Our number | Borrower's | Result |
|---|---|---|
| Passes | Agrees | Log compliant |
| Passes | Differs beyond tolerance | Log the variance, no investigation |
| **Fails** | Anything | **Exception → agent investigation** |

Investigation → the **CreditScout Agent** (one Foundry orchestrator, six
tools) decides what to read next, delegates to three specialists, calls the
deterministic calculator, searches past cases; the trace reads as its
orchestration plan, each step annotated → **code guardrail** forces `abstain`
on any untraceable number → **analyst approves or overrides** → the override
is stored as a lesson later cases can retrieve (measured effect so far: see
Success metrics).

**The architecture in one line:** the model decides what to look at and never
produces a number; code produces every number and never decides; a human always
approves.

---

## Success metrics

Measured column: live eval 2026-11-13 (`eval-20261113T161940Z-cold`,
`eval-20261113T162519Z-warm`), shown as cold / warm.

| Metric | Type | Baseline | Target | Measured (cold / warm) |
|---|---|---|---|---|
| Time-to-decision | **North Star** | ~2.5 hrs *(estimate)* | **< 30 min** | not measured |
| **False-resolve rate** | **Primary, hard gate** | n/a | **0** | **0 / 0** |
| Calculation accuracy | Primary | manual, error-prone | **100%** | **100% / 100%** (12/12 figures) |
| Outcome accuracy | Primary | n/a | **≥ 85%** | 60% / 80%, both miss |
| Memory effect (avg steps, cold vs warm) | Secondary | n/a | visible reduction | 8.7 / 7.3, one run, not established |
| Citation hit rate | Secondary | n/a | ≥ 90% | not measured |

Five signed cases count per pass (3 agent investigations, 2 code-only); one
case is 20 points. Two cold passes on identical input the same day scored 100%
and 60%, so this is a smoke test, not a benchmark. Every miss was cautious
(escalate or abstain where the key says resolve).

**Guardrails, what must not get worse:**
**Abstain rate ≤ 25%** (a system that abstains on everything scores a perfect
zero false resolves while delivering nothing; this is the metric that keeps the
headline honest) · cost per investigation ≤ $1 · steps ≤ 8. Abstain rate and
cost are not measured yet; cold averaged 8.7 steps, above the 8-step line.

---

## Rollout & rollback

**Rollout:** Internal measurement: 6 seeded loans (3 carrying a covenant twist,
3 performing) + 5 onboarding loans, **10 owner-signed eval cases**; **calculation
accuracy 100% measured** (12/12 figures); live cold + warm passes run, outcome
accuracy still below target → Beta (full eval over all ten cases, then 100+)
→ design-partner pilot on real documents. Each gate requires **0 false
resolves**, not a low rate. Scoreboard is grouped Honest / Harmless / Helpful.

**Rollback:** Prompts, policy thresholds and model choice are all config, revertible
in minutes without a deploy. **Kill switch:** stop creating investigations.
Quarterly testing still runs, because calculation and guardrails are pure code.
The product degrades to automated covenant testing, not to nothing.

---

## Business

**Price:** **$5 per monitored borrower per month.** Flat, because tiering is
premature before measured usage. Per-borrower, not per-seat (per-seat penalises
adding reviewers) and not per-investigation (that bills most when borrowers are
most distressed).

**ROI:** ~182 analyst-hours saved per year against $1,800, **~6×**, holding
between 4× and 8× across the plausible loaded-rate range. Modelled at ~35%
reduction in covenant-monitoring time; vendors in the category advertise 50 to 75%.

**Market:** US SAM ~$36M/yr · SOM ~$700K ARR over 3 years at 25 to 30 accounts.
TAM (loan compliance monitoring) ~$2.87B in 2026.

---

## Open questions

| Question | Owner | By |
|---|---|---|
| ~~Validate the three facility twists~~ | Owner | **Done 2026-10-05** |
| ~~Verify + sign off the expected DSCR values~~ | Owner | **Done 2026-10-07**, 10 rows signed |
| ~~Does Foundry Connected Agents (preview) work reliably?~~ | Claude | **Resolved:** works, but a specialist cannot carry a tool; specialists run as in-process function tools instead |
| ~~Run the live cold + warm eval passes (billable)~~ | Owner | **Done 2026-10-08**: zero false resolves, calc accuracy 100%, outcome accuracy between 40% and 100% across the October passes |
| ~~Re-measure the live eval after the provenance fix (billable)~~ | Owner | **Done 2026-11-13**: zero false resolves, calc accuracy 100%, outcome accuracy 60% cold / 80% warm |
| Turn the smoke test into a benchmark: onboard the five skipped borrowers, grow the signed set to 100+ cases, repeat each case several times and report a range, add the LLM-judged groundedness score | Owner | Open |
| Does a covenant **due date** belong in `covenant_terms`? It is a contractual term, so adding it is an extraction change and a re-approval, and nothing in the product can age or prioritise work without it | Owner | Open (parking-lot 7c.1) |
| Should *hold for borrower documents* require a reason code, as override does? | Owner | Open (parking-lot 7c.3) |
| 5 analyst interviews + 3 customer quotes | Owner | Launch gate |
| Loaded analyst cost/hr; hours per contested exception | Owner | Before the pitch |
