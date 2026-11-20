# CreditScout, case study

## The problem

A commercial credit analyst investigating a DSCR covenant exception spends most of their time doing the same four things: pulling the governing loan terms, recomputing the ratio by hand, reconciling it against what the borrower reported, and tracing any gap back to a specific line item. None of that requires judgment. The judgment is in deciding what to do about a breach. CreditScout automates the first four and leaves the decision to the analyst.

## The decision that shaped everything else

> A reasoning layer decides what evidence to inspect next. A calculation layer never guesses. A human always approves.

Early on I had to decide how much to trust the model. The obvious design, ask the LLM to read the financials and state the DSCR, is also the wrong one for a regulated lending workflow: it's fast, but nobody can audit *why* the number is what it is, and a hallucinated figure in a covenant decision is a real liability, not a UX nit.

So I split the system into two layers that don't trust each other by default. `calc/dscr.js` and the guardrails are zero-dependency, import-free, pure functions. Nothing in them can call an LLM, a database, or the network. They take approved loan terms and reconciled financials and produce a number, or an explicit `{error}` if any input is missing. The model's only job is deciding *what evidence to inspect next* (which document, which period, which add-back) and writing the explanation. If an explanation contains a figure that doesn't trace to a logged `calc_id` or a verbatim quote from a cited document, the guardrail forces the recommendation to `abstain` rather than let an ungrounded number reach an analyst.

## The guardrail that almost shipped wrong

The first version of the groundedness guardrail only accepted calculated numbers. Anything else in the explanation got abstained. This looked perfect in testing (zero false resolves) and was actually broken: real explanations legitimately quote the covenant itself ("requires 1.25x"), and that guardrail abstained on every one of them. The eval metric would have read as a flawless product while the system did nothing useful. The fix was to compare *numbers after normalization*, not text. A quoted threshold and a calculated ratio are both valid; they just need to agree once compared as values, not strings. This is the kind of bug that a product metric can hide rather than reveal, which is why the eval harness and the guardrail logic had to be built and read together, not in isolation.

## Why the minimum DSCR is never a constant

Every seeded loan has its own minimum covenant ratio, read from that loan's governing terms and printed into its own agreement, never a hardcoded 1.25x. This wasn't a hypothetical edge case. Three of the six seeded loans carry a deliberate twist, and two of them (Harbor Logistics, and Coastal Marine in Q2 2026) are a "covenant boarding lag": an amendment is on file but not yet boarded into the system of record. The third, Northgate Foods, is a true breach hidden behind a borrower certificate that reports compliance. If the minimum were a constant, or if any seed script "helpfully" boarded the amendment early, there would be nothing left to investigate. The exception the whole product exists to catch would disappear. Protecting that twist meant writing it into the hard constraints, not just the test data, so it couldn't be silently fixed away by a future change.

## Measured results

Live eval, 2026-11-13, code at commit `46f368c`, which includes the `chunksForCalcProvenance` fix from October. Orchestrator `gpt-4.1-mini`, specialists `gpt-5-mini`. Run ids `eval-20261113T161940Z-cold` and `eval-20261113T162519Z-warm`. The cold pass has no past decisions to draw on; the warm pass reviews each case before the next, so later cases can retrieve earlier lessons.

| Metric | Target | Cold | Warm |
|---|---|---|---|
| False resolves (hard gate) | 0 | **0** | **0** |
| Calculation accuracy | 100% | **100%** (12/12 signed figures) | **100%** (12/12) |
| Outcome accuracy | ≥ 85% | **60%** (3/5), miss | **80%** (4/5), miss |
| Avg steps per agent investigation | visible reduction warm vs cold | 8.7 | 7.3 |
| Citation hit rate | ≥ 90% | not measured | not measured |
| Correct abstain / request | ≥ 90% | not measured | not measured |
| Groundedness (LLM judge) | reported | not measured | not measured |
| Cases counted | | 5 of 10 | 5 of 10 |

Five of the ten owner-signed cases count per pass: three the agent investigates and two that code decides alone. The other five are onboarding borrowers not yet in the database, so the harness skips them.

Both hard gates held: zero false resolves and 100% calculation accuracy. Outcome accuracy did not: 60% cold and 80% warm against an 85% target. Every miss went the cautious way. Cold, Harbor Logistics escalated and Coastal Marine abstained at the 12-step cap, both where the key says resolve; warm, Harbor Logistics abstained where the key says resolve. No loan in breach was waved through, but it is not a number I would ship. In October, three of four misses were the guardrail rejecting figures that are facts but not calculations, such as Northgate's own reported 1.31 DSCR. I fixed that on 2026-10-13 (`chunksForCalcProvenance`), and in this run Northgate escalated correctly in both passes.

On memory: in this run warm beat cold on outcome accuracy (80% vs 60%) and average steps (7.3 vs 8.7). I keep memory as a v1 feature, but that is one run on five cases, and earlier runs were mixed (an October run scored 60% in both passes, with 7.0 steps cold vs 8.0 warm), so I don't treat the effect as established. One detail from the traces: warm Harbor is the first case in the pass and had no lessons to load, while warm Coastal loaded 2 lessons before resolving correctly in 8 steps. That is consistent with memory helping, but one case cannot show it.

The bigger finding is the noise. Earlier the same day, a first cold pass on identical input scored 5/5 at 6.3 steps before its warm pass was lost to a network failure, and the October runs swung between 60% and 100% cold. With five cases, one case is 20 points, and run-to-run variance is larger than any cold/warm difference. So this is a smoke test, not a benchmark. Getting to a real one means onboarding the five skipped borrowers so all ten signed cases count, growing the signed set to 100+ cases, repeating each case several times and reporting a range, and adding the LLM-judged groundedness score.

### Why it missed

I read the stored casefile traces for the three misses.

- **Harbor Logistics, cold** (casefile `14dce14b`, escalate, expected resolve). The agent found Amendment No. 2's restructuring add-back (cap $500,000) but called the calculator with 500,000 as the restructuring amount. The calculator refused: "Fin Q2 2026 §2 states 620000 on its 'Restructuring charges' line, not 500000". The tool takes the document's figure and applies the cap itself. The agent did not retry with 620,000, fell back to the boarded-terms result of 1.12 and escalated, tagging `true_breach`.
- **Harbor Logistics, warm** (casefile `6ff3e27f`, abstain, expected resolve). The same wrong input, sent twice and refused twice. The agent then answered resolve, stating a DSCR of 1.28 and a `calc_id` that was never logged for the case. The guardrail flagged the unknown `calc_id` and the untraceable figures (620000, 1.28) and replaced the answer with abstain. The right verdict was reached by an unverified route, and the guardrail correctly refused to let it through.
- **Coastal Marine Q2 2026, cold** (casefile `077a393a`, abstain, expected resolve). The agent sent the calculator figures that did not match the Q2 2026 financials, then figures from the Q1 2026 statement. The calculator refused both ("is from Financials Q1 2026, not the test period's Financials Q2 2026"). It got a valid calculation only at step 11 and hit the 12-step cap before answering, so policy forced abstain.

The answer key is not the problem. In the earlier same-day cold pass and in the warm pass for Coastal, the agent passed the right figures and reached the signed answers (1.28 for Harbor in the earlier pass, 1.30 for Coastal warm). The misses are tool-input errors by the model, and they vary run to run.

What worked: in all three misses the calculator refused figures that did not match the source document, and the guardrail blocked an unverified resolve, so the errors surfaced as cautious outcomes, not false resolves.

What I plan to fix next (not done yet): make the calculator's refusal message and tool description say explicitly to pass the document's figure and let the tool apply the cap; stop the agent repeating an identical refused call; filter financials retrieval to the test period; then re-measure.

## What analysts said

Nothing yet. Conversations with working credit analysts are planned and have not happened, so nothing here quotes or paraphrases one.

## What I'd do differently

The agent runs on `gpt-4.1-mini` because the platform (Azure AI Foundry's Connected Agents) couldn't carry `gpt-5-mini`'s tool set in a connected-agent topology, a platform constraint discovered mid-build, not a design choice. I ended up running the three specialist agents in-process instead of as genuinely separate connected agents. It works, and the separation of concerns held, but it's a case of the deployment platform shaping the architecture more than I'd have liked, and I'd scope that compatibility question earlier next time.

I'd also have a clearer bar for moving the orchestrator to Claude. Two things would need to be true: tool-calling parity on the same six-tool set, verified by the same eval harness with zero false resolves, and hosting a bank would approve, for example Claude served through a cloud tenant the bank already controls.
