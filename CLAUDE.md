# CreditScout

A decision-support agent for commercial credit analysts investigating DSCR covenant exceptions. It recommends; a human analyst always decides.

**Read `docs/HANDOFF.md` before doing anything.** It carries the design reasoning, environment state, and the traps. Then read the spec.

| | |
|---|---|
| Spec (source of truth, owner-owned) | `docs/superpowers/specs/2026-10-01-creditscout-design.md` |
| Plan 1 of 3 — deterministic core | `docs/superpowers/plans/2026-10-02-creditscout-deterministic-core.md` |
| Full handoff | `docs/HANDOFF.md` |

## The idea that settles most design questions

> A reasoning layer decides what evidence to inspect next. A calculation layer never guesses. A human always approves.

The model never produces a number. Every figure in an explanation must trace to a logged calculation or a verbatim quote from a cited document, or the guardrail forces the recommendation to `abstain`.

## Stack

n8n Cloud orchestrates (Claude Opus 5.5; retrieval sub-agents on Claude Sonnet 5.5). Supabase Postgres + pgvector for data, vectors and memory. Azure AI Foundry for evaluations only. Vite + React analyst UI, run locally. Node 24, no test framework — `node:test` only.

## Hard constraints

- **`calc/dscr.js` and `guardrails/*.js` must be zero-dependency and import-free.** Their text is pasted into n8n Code nodes and spec §8.3 requires the copies to be byte-identical. Each ends with a guarded `module.exports`. **Never add imports to these files.**
- **No test framework.** `node:test` + `node:assert/strict`. Run with `npm test`.
- **The calculator never defaults a missing value to zero and never infers.** Missing input, denominator ≤ 0, and unknown component names return `{error}`.
- **`dscr` rounds half-up to 2dp**, not banker's rounding.
- **`calc_id` is injected by the caller**, never generated inside the pure function.
- **Embeddings are 1536-dimensional** (`text-embedding-3-small`). The schema's `vector(1536)` columns depend on it.
- **Supabase must be cloud, never local** — n8n Cloud is remote and cannot reach localhost. This is load-bearing; don't "optimise" it.
- **Synthetic data only.** Every generated document carries the literal marker `SYNTHETIC — FOR DEMONSTRATION`. Borrower names are fictional. No real bank data, ever.
- **`.env` is gitignored.** Never commit it. `.env.example` lists what's needed.

## Execution

Plans run **subagent-driven** (`superpowers:subagent-driven-development`) — the owner chose this; don't re-ask per plan. Commit after every task, conventional prefixes.

## Working with the owner

- The owner owns the spec. Propose changes; don't rewrite it unasked.
- Ask precisely, recommend precisely, bullets over paragraphs, avoid jargon.
- Don't frame work around the deadline — focus on the deliverable.
- Warn before a long stretch with no visible output.
- Confirm before anything destructive or billable: deleting cloud resources, deploying a model, making this repo public.
- Label estimates as estimates. Don't present arithmetic as measurement.

## Known trap

A guardrail that only accepts *calculated* numbers will abstain on every well-formed explanation, because legitimate explanations quote figures from the covenant ("requires 1.25x"). The zero-false-resolve metric would read perfect while the product did nothing. Quoted figures are valid; compare numbers after normalisation, not as text. See the plan's Review Focus section.
