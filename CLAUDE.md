# CreditScout

A decision-support agent for commercial credit analysts investigating DSCR covenant exceptions. It recommends; a human analyst always decides.

**Read the spec first, then the engineering doc.** `docs/HANDOFF.md` carries the original design reasoning and the machine gotchas, but it was written 2026-10-02 and pre-dates the 2026-10-05 amendments — treat it as history, not as current state.

| | |
|---|---|
| Spec (source of truth, owner-owned) | `docs/superpowers/specs/2026-10-01-creditscout-design.md` |
| Architecture + build sequence (stages 0–10) | `docs/engineering/engineering-doc.md` §9 |
| File-by-file blueprint (features F0–F10) | `docs/engineering/implementation-specs.md` |
| Everything deferred, with reasons | `docs/parking-lot.md` |
| Design tokens | `docs/design.md` |
| Original plan 1 (stale: six facilities, n8n, CommonJS) | `docs/superpowers/plans/2026-10-02-creditscout-deterministic-core.md` |

## The idea that settles most design questions

> A reasoning layer decides what evidence to inspect next. A calculation layer never guesses. A human always approves.

The model never produces a number. Every figure in an explanation must trace to a logged calculation or a verbatim quote from a cited document, or the guardrail forces the recommendation to `abstain`.

CreditScout computes **every** quarterly test itself from human-approved terms. The borrower's reported figure is evidence to reconcile against, never the trigger.

## Stack

Azure AI Foundry Agent Service runs one orchestrator — the **Credit-scout Agent** (`gpt-4.1-mini`, forced by the platform: `gpt-5-mini` cannot carry its tool set) — with six function tools: three HTTP routes (search_documents, dscr_calculator, search_past_cases) and three specialists (`definition_agent`, `research_agent`, `document_agent`, `gpt-5-mini`) serviced **in-process** by `lib/agent/specialists.ts`. Connected Agents was tried and dropped 2026-10-06 (a connected agent cannot carry a function tool — parking-lot 7.4). Next.js App Router on Vercel serves the analyst UI, the analyst API and the OpenAPI tool routes the agent calls. Supabase Postgres + pgvector for data, vectors and memory. Azure AI Foundry Evaluations for groundedness. Node 24; no test framework — `node:test` only.

## Hard constraints

- **`calc/dscr.js` and `guardrails/*.js` must be zero-dependency and import-free**, ending in a plain ESM `export`. They are the calculation and enforcement layer; nothing they do may depend on a package. **Never add imports to these files.** (The old byte-identical-to-n8n rule is dead — n8n was dropped 2026-10-05.)
- **No test framework.** `node:test` + `node:assert/strict`. Run with `npm test`.
- **The calculator never defaults a missing value to zero and never infers.** Missing input, denominator ≤ 0, and unknown component names return `{error}`.
- **`dscr` rounds half-up to 2dp**, not banker's rounding.
- **`calc_id` is injected by the caller**, never generated inside the pure function.
- **Embeddings are 1536-dimensional** (`text-embedding-3-small`). The schema's `vector(1536)` columns depend on it.
- **Supabase is cloud, never local.** Foundry and Vercel are both remote and cannot reach localhost.
- **Covenant terms are versioned, effective-dated and analyst-approved.** Only `status = approved` terms may govern a test; an amendment creates `version + 1` and supersedes — it never overwrites.
- **Synthetic data only.** Every generated document carries the literal marker `SYNTHETIC — FOR DEMONSTRATION`. Borrower names are fictional. No real bank data, ever.
- **Three facilities, not six.** F1 Harbor Logistics, F3 Northgate Foods, F5 Coastal Marine. F2/F4/F6 are parked (`docs/parking-lot.md` §4.1).
- **`.env` is gitignored.** Never commit it. `.env.example` lists what's needed.

## Execution

Plans run **subagent-driven** (`superpowers:subagent-driven-development`) — the owner chose this; don't re-ask per plan. Commit after every task, conventional prefixes, `feat(stage-N):` where a build stage applies.

## Working with the owner

- The owner owns the spec. Propose changes; don't rewrite it unasked.
- Ask precisely, recommend precisely, bullets over paragraphs, avoid jargon.
- Don't frame work around the deadline — focus on the deliverable.
- Warn before a long stretch with no visible output.
- Confirm before anything destructive or billable: deleting cloud resources, deploying a model, making this repo public.
- Label estimates as estimates. Don't present arithmetic as measurement.

## Known traps

- A guardrail that only accepts *calculated* numbers abstains on every well-formed explanation, because legitimate explanations quote figures from the covenant ("requires 1.25x"). The zero-false-resolve metric would read perfect while the product did nothing. Quoted figures are valid; compare numbers after normalisation, not as text.
- **An add-back with no `cap` field, or `cap: null`, means uncapped.** Read as zero and F1 flips from a correct resolve to a false escalation.
- **Covenant boarding lag is the F1/F5 twist.** The amendment is on file but deliberately *not* boarded into `covenant_terms`. Any seed or fixture that boards it dissolves the twist and there is nothing left to investigate.
