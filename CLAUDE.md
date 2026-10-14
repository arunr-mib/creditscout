# CreditScout

A decision-support agent for commercial credit analysts investigating DSCR covenant exceptions. It recommends; a human analyst always decides.

**Start with `docs/HANDOFF.md` §0** — the current state (2026-10-08), what is left, and how to run things. Then the spec, then the engineering doc. The product is **built and deployed** at `https://credit-scout.vercel.app`; the next open item is the billable live eval run (HANDOFF §0.3).

| | |
|---|---|
| Current state + next actions | `docs/HANDOFF.md` §0 (§1–§5 design reasoning, §8–§9 gotchas and lessons — still true) |
| Spec (source of truth, owner-owned) | `docs/superpowers/specs/2026-10-01-creditscout-design.md` |
| Onboarding wizard spec (stage 11) | `docs/superpowers/specs/2026-10-07-onboarding-flow-design.md` |
| Architecture (HLD) + build sequence (stages 0–11) | `docs/engineering/engineering-doc.md` §9 |
| File-by-file blueprint (LLD, features F0–F11) | `docs/engineering/implementation-specs.md` |
| Product docs | `docs/prd.md`, `docs/prd-onepager.md`, `docs/mental-model.md` (flows, storyboard, screen inventory) |
| Everything deferred, with reasons | `docs/parking-lot.md` |
| Design tokens (no shadows — dark-native depth) | `docs/design.md` |
| Diagrams — user flow + architecture | `docs/diagrams/` — **generated**; edit `generate.py` and re-run, never the SVG |
| Eval harness + signed oracle | `evals/run.mjs`, `evals/grade.mjs`, `data/expected-values-template.csv` |
| Original plan 1 (stale: six facilities, n8n, CommonJS) | `docs/superpowers/plans/2026-10-02-creditscout-deterministic-core.md` |

## The idea that settles most design questions

> A reasoning layer decides what evidence to inspect next. A calculation layer never guesses. A human always approves.

The model never produces a number. Every figure in an explanation must trace to a logged calculation or a verbatim quote from a cited document, or the guardrail forces the recommendation to `abstain`.

CreditScout computes **every** quarterly test itself from human-approved terms. The borrower's reported figure is evidence to reconcile against, never the trigger.

## Stack

Azure AI Foundry Agent Service runs one orchestrator — the **CreditScout Agent** (`gpt-4.1-mini`, forced by the platform: `gpt-5-mini` cannot carry its tool set) — with six function tools: three HTTP routes (search_documents, dscr_calculator, search_past_cases) and three specialists (`definition_agent`, `research_agent`, `document_agent`, `gpt-5-mini`) serviced **in-process** by `lib/agent/specialists.ts`. Connected Agents was tried and dropped 2026-10-06 (a connected agent cannot carry a function tool — parking-lot 7.4). Next.js App Router on Vercel serves the analyst UI, the analyst API and the OpenAPI tool routes the agent calls. Supabase Postgres + pgvector for data, vectors and memory. Azure AI Foundry Evaluations for groundedness. Node 24; no test framework — `node:test` only.

## Hard constraints

- **`calc/dscr.js` and `guardrails/*.js` must be zero-dependency and import-free**, ending in a plain ESM `export`. They are the calculation and enforcement layer; nothing they do may depend on a package. **Never add imports to these files.** (The old byte-identical-to-n8n rule is dead — n8n was dropped 2026-10-05.)
- **No test framework.** `node:test` + `node:assert/strict`. Run with `npm test`.
- **The calculator never defaults a missing value to zero and never infers.** Missing input, denominator ≤ 0, and unknown component names return `{error}`.
- **`dscr` rounds half-up to 2dp**, not banker's rounding.
- **The minimum DSCR is per loan, never a constant.** It is read from the governing terms (`threshold.min_dscr`) and printed into that loan's agreement by the generator. A test that pins 1.25 is wrong.
- **`calc_id` is injected by the caller**, never generated inside the pure function.
- **Embeddings are 1536-dimensional** (`text-embedding-3-small`). The schema's `vector(1536)` columns depend on it.
- **Supabase is cloud, never local.** Foundry and Vercel are both remote and cannot reach localhost.
- **Covenant terms are versioned, effective-dated and analyst-approved.** Only `status = approved` terms may govern a test; an amendment creates `version + 1` and supersedes — it never overwrites.
- **Synthetic data only.** Every generated document carries the literal marker `SYNTHETIC — FOR DEMONSTRATION`. Borrower names are fictional. No real bank data, ever.
- **Six seeded facilities.** Three carry a twist and are evaluated — F1 Harbor Logistics, F3 Northgate Foods, F5 Coastal Marine. Three are performing loans carried so the book is not made only of exceptions, each boarded at its own minimum — F7 Dokusign Inc (1.40x), F8 Peat's Coffee Company (1.10x), F9 Costko Wholesale (1.35x). The performing three raise no exception, appear in no casefile and are in **no oracle row**: `EVALUATED_FACILITIES` is what the CSV covers, so eval denominators stay at 5 quarterly cases. **F2/F4/F6 stay reserved** for the abstain/request cases (`docs/parking-lot.md` §4.1) — do not spend those ids. The **five onboarding borrowers** (Zhatsapp Inc, Marcus Tech, Orion Medical Supply, Petworks LLC, Vantage Print Works) exist only as upload packages under `data/facilities/` and are **never seeded** — onboarding must create them live. Lender name everywhere: **Bank of Stoic**.
- **User-facing vocabulary:** the reasoning agent is the **"CreditScout Agent"**; screens say **"loan"**, never "facility" (the schema keeps `facility`).
- **The eval oracle is owner-signed and owner-owned.** `data/expected-values-template.csv` — never regenerate or edit its expected columns; `generate()` refuses to overwrite it. The eval runner refuses to run on any unsigned row. Unmeasured metrics are `null` → "—", never 0.
- **The live eval is billable** (`npm run eval -- --live`): confirm with the owner before running; needs a local `npm run dev` for the agent's tool self-calls. Deterministic `npm run eval` is free.
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
- **`lib/supabase/server.ts` imports `server-only`**, which throws outside Next. Scripts that import `lib/*` from Node (the eval harness) run with `--conditions=react-server` and pass an explicit `client` in `deps`.
- **Never `git stash` bare** in this worktree — the stash is shared across worktrees. Prefer a WIP commit.
