# CreditScout — case study

## The problem

A commercial credit analyst investigating a DSCR covenant exception spends most of their time doing the same four things: pulling the governing loan terms, recomputing the ratio by hand, reconciling it against what the borrower reported, and tracing any gap back to a specific line item. None of that requires judgment — the judgment is in deciding what to do about a breach. CreditScout automates the first four and leaves the decision to the analyst.

## The decision that shaped everything else

> A reasoning layer decides what evidence to inspect next. A calculation layer never guesses. A human always approves.

Early on I had to decide how much to trust the model. The obvious design — ask the LLM to read the financials and state the DSCR — is also the wrong one for a regulated lending workflow: it's fast, but nobody can audit *why* the number is what it is, and a hallucinated figure in a covenant decision is a real liability, not a UX nit.

So I split the system into two layers that don't trust each other by default. `calc/dscr.js` and the guardrails are zero-dependency, import-free, pure functions — nothing in them can call an LLM, a database, or the network. They take approved loan terms and reconciled financials and produce a number, or an explicit `{error}` if any input is missing. The model's only job is deciding *what evidence to inspect next* (which document, which period, which add-back) and writing the explanation. If an explanation contains a figure that doesn't trace to a logged `calc_id` or a verbatim quote from a cited document, the guardrail forces the recommendation to `abstain` rather than let an ungrounded number reach an analyst.

## The guardrail that almost shipped wrong

The first version of the groundedness guardrail only accepted calculated numbers — anything else in the explanation got abstained. This looked perfect in testing (zero false resolves) and was actually broken: real explanations legitimately quote the covenant itself ("requires 1.25x"), and that guardrail abstained on every one of them. The eval metric would have read as a flawless product while the system did nothing useful. The fix was to compare *numbers after normalization*, not text — a quoted threshold and a calculated ratio are both valid, they just need to agree once compared as values, not strings. This is the kind of bug that a product metric can hide rather than reveal, which is why the eval harness and the guardrail logic had to be built and read together, not in isolation.

## Why the minimum DSCR is never a constant

Every seeded loan has its own minimum covenant ratio, read from that loan's governing terms and printed into its own agreement — never a hardcoded 1.25x. This wasn't a hypothetical edge case: three of the six seeded facilities carry a deliberate "covenant boarding lag" twist, where an amendment is on file but not yet boarded into the system of record. If the minimum were a constant, or if any seed script "helpfully" boarded the amendment early, there would be nothing left to investigate — the exception the whole product exists to catch would disappear. Protecting that twist meant writing it into the hard constraints, not just the test data, so it couldn't be silently fixed away by a future change.

## What I'd do differently

The agent runs on `gpt-4.1-mini` because the platform (Azure AI Foundry's Connected Agents) couldn't carry `gpt-5-mini`'s tool set in a connected-agent topology — a platform constraint discovered mid-build, not a design choice. I ended up running the three specialist agents in-process instead of as genuinely separate connected agents. It works, and the separation of concerns held, but it's a case of the deployment platform shaping the architecture more than I'd have liked, and I'd scope that compatibility question earlier next time.
