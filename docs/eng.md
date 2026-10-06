# CreditScout — Engineering Document (HLD)

**Date:** 2026-10-05
**Status:** Proposal for owner review — this is the Step-4 Review gate
**Author:** Claude Code (engineering)
**Owner:** Arun Rajendiran (product, credit domain, all sign-offs)

**Input:** `docs/superpowers/specs/2026-10-01-creditscout-design.md` (the spec — owner-owned, source of truth)
**Output:** this document, then `docs/spec.md` (LLD)
**Method:** spec-driven development, Week 5 Cohort 10 lab workflow —
PRD → Design → **HLD → Review** → Frontend Setup → LLD → Review → Implement → Deploy → Maintain

> **This document does not change the spec.** It proposes a runtime change and
> lists precisely which spec sections would need owner approval to amend
> (§13). Nothing here is applied to the spec until the owner says so.

---

## 1. What this document is for

The spec answers *what CreditScout does*. It also fixes a runtime — n8n Cloud —
in §3 and §4. Two things have changed since that choice was made:

1. The owner wants a **deployed application**, not a locally-run Vite app. Spec
   §2 lists deployment as out of scope and §3 puts the UI on localhost.
2. The owner has adopted **spec-driven development** from the Week 5 lab, whose
   per-feature blueprint (Database Schema → Database Tasks → Helper Functions →
   API Routes → State Management → Components → Edge Cases → Testing Checklist)
   describes a codebase, not a workflow export.

This HLD resolves the runtime question against those two changes and then
restates the architecture in a form the LLD can be written from.

The product thesis is untouched and governs every decision below:

> A reasoning layer decides what evidence to inspect next. A calculation layer
> never guesses. A human always approves.

---

## 2. Decision: orchestration moves into the application

**Recommendation: Next.js on Vercel. The agent loop is TypeScript in the
application. Claude models are called directly through the Anthropic SDK.
Supabase stays exactly as specced. Azure AI Foundry stays evaluations-only.
n8n is dropped.**

This is the middle option, and it is deliberately *not* "move orchestration to
Azure AI Foundry Agent Service". The three candidates:

| | n8n Cloud (as specced) | Foundry Agent Service | **Application-hosted (recommended)** |
|---|---|---|---|
| Orchestrator model | Claude Opus 5.5 | Azure OpenAI models | Claude Opus 5.5 |
| Sub-agent models | Claude Sonnet 5.5 | Azure OpenAI models | Claude Sonnet 5.5 |
| Loop control | Node iteration cap | Service-managed | Explicit, per-step |
| Deployed app | No (UI local) | Needs one anyway | Yes, Vercel |
| Blocking unknown | n8n Cloud plan licensing (§14.3) | Claude unavailable | None |
| Spec sections to amend | — | §3, §4, §13 (models) | §3, §4 |

### 2.1 Why not Foundry Agent Service

This is the option that looks most aligned with the course, and it is the wrong
one for CreditScout, for a reason that is a constraint rather than a preference.

Foundry Agent Service orchestrates Azure-hosted models. The spec's model split
is load-bearing in two places: §13 ties the choice of Claude to the Anthropic
certification track, and §4.2 puts Claude Opus 5.5 on the orchestrator
specifically because *the evidence-sufficiency judgement is the headline
zero-false-resolve metric*. Moving the loop into Foundry means either discarding
that split, or calling Anthropic from inside Foundry tools — which is a worse
architecture than calling it directly.

Handoff §4.1 already reached the right answer here and it still holds:
**Foundry's honest role in this project is evaluation.** Spec §8.2 runs Foundry
Evaluations with an LLM judge over `foundry.jsonl`. That is a real Azure
artifact, it is on the critical path for the trust metrics in the demo (§10),
and it does not bet the build on relearning an orchestration layer.

Spec §3's production path — "orchestrator on Microsoft Foundry Agent Service
inside the bank's Azure tenant" — stays the roadmap. It gets *more* credible
under this proposal, because a TypeScript tool-calling loop ports to Foundry far
more honestly than an n8n workflow export does.

### 2.2 Why not n8n

Handoff §4.1 chose n8n for good reasons: owner familiarity, a visual execution
trace for the demo, owner editability, and the course's own n8n + Foundry evals
pairing. Three of those four have weakened:

- **The HTTP surface is no longer a cost unique to the alternative.** §4.1
  counted "an HTTP surface for three webhooks" against hand-written
  orchestration. A deployed frontend needs a deployed backend regardless, so
  that surface now gets written either way. It stopped being a differentiator.
- **"Hand-writing the orchestrator" is a much smaller job than it was.** The
  Week 5 lab is a worked example of this exact shape — Next.js frontend, Next.js
  API routes, Supabase, deploy — and the owner has now built it once.
- **The visual trace is already a product feature.** Spec §7.2 specifies a live
  step trace polling `casefiles.trace` every second, and §10 builds the demo
  around comparing F1's and F5's traces side by side. That view is in the
  product, not in the tooling. An n8n canvas is a weaker version of something
  the spec already requires us to build.
- **Owner editability survives intact**, because it never depended on n8n. Spec
  §6.2 puts the Risk Officer's levers in the `policy` table, editable without
  code, surfaced on the Governance page.

What this decision additionally *closes*:

| Closed | Where it was open |
|---|---|
| Does the n8n Cloud plan include the AI Agent and Supabase Vector Store nodes? | Spec §14.3, handoff §7 — the highest-value open question, and a hard blocker |
| Generated n8n JSON needs node-version fixes | Spec §12 risk row 1 |
| Calculator source in n8n JSON must be byte-identical to `calc/dscr.js` | Spec §8.3 sync check |
| Anthropic node settings must be re-verified in Cloud | Handoff §7 |

Four risks and one blocking unknown retire together. That is the strongest
argument in this document.

**What is genuinely lost:** the owner's n8n fluency stops being an asset, and
the Week 4 multi-agent lab tie-in (§3) is replaced by the Week 5 one. The Week 4
tie-in is preserved in substance — three specialist sub-agents under an
orchestrator is still multi-agent, just expressed in code.

### 2.3 Vercel, not Netlify

Vercel. The deck uses Netlify, but nothing in the lab depends on it:

- Next.js is Vercel's own framework and has first-class support there.
- The owner already has projects and an account on Vercel.
- Netlify would mean a second hosting account for no capability gain.

One constraint Vercel imposes, addressed in §5.3: a serverless invocation has a
duration ceiling, and an eight-step investigation will not fit inside one
request. The design below never asks it to.

### 2.4 Cost posture

Roughly neutral, and plausibly cheaper. Same models, same token volume, prompt
caching preserved (§5.4). The n8n Cloud dependency goes away, which may remove a
subscription cost depending on the owner's plan. Vercel's free tier covers this
app's traffic. Handoff §4.5's estimate of **$15–25 per full eval cycle is
unchanged** — and it remains *an estimate derived from the spec, not a
measurement*. Recalculate it from the first real investigation.

---

## 3. System architecture

```
                         ┌──────────────────────────────┐
                         │   Analyst (browser)          │
                         └───────────────┬──────────────┘
                                         │
                    ┌────────────────────▼─────────────────────┐
                    │  Next.js on Vercel                       │
                    │                                          │
                    │  App Router pages                        │
                    │   · Exception queue  · Investigation     │
                    │   · Casefile review  · Governance/evals  │
                    │                                          │
                    │  Route handlers (/api)                   │
                    │   · ingest    · investigate              │
                    │   · advance   · review                   │
                    │                                          │
                    │  Agent runtime (TypeScript)              │
                    │   · orchestrator loop                    │
                    │   · 5 tools  · guardrail  · policy       │
                    └──┬──────────────┬────────────────────┬───┘
                       │              │                    │
          ┌────────────▼───┐  ┌───────▼────────┐  ┌────────▼──────────┐
          │ Anthropic API  │  │ Supabase       │  │ Azure AI Foundry  │
          │ Opus 5.5 orch. │  │ Postgres       │  │ Evaluations only  │
          │ Sonnet 5.5 sub │  │ pgvector       │  │ gpt-4.1 judge     │
          │ caching 1h     │  │ Storage        │  │ (offline, JSONL)  │
          └────────────────┘  └────────────────┘  └───────────────────┘
                                      ▲
                       deterministic core, imported directly
                       calc/dscr.js · guardrails/*.js
```

### 3.1 Layer responsibilities

| Layer | Technology | Responsibility | Course tie-in |
|---|---|---|---|
| Analyst UI | Next.js App Router, React Server + Client Components | Four screens (spec §7) | Wk 5 lab |
| API surface | Next.js route handlers | Replaces the three n8n webhooks | Wk 5 lab |
| Orchestration | TypeScript loop, Anthropic SDK, `claude-opus-5-5` | Decides what evidence to inspect next | Wk 4 multi-agent, in code |
| Specialist sub-agents | Anthropic SDK, `claude-sonnet-5-5` | Read and quote; never judge | Wk 2/4 |
| Retrieval | Supabase pgvector, section-level chunks, 1536-dim | Facility-filtered clause search | Wk 2 RAG |
| Deterministic calculation | `calc/dscr.js`, imported | All arithmetic | mentor: "calc tool" |
| Guardrails and policy | `guardrails/*.js`, imported | Forced downgrades, policy enforcement | — |
| Memory and records | Supabase Postgres | Casefiles, lessons, calc log | Wk 3–5 |
| Evaluation | `evals/run.mjs` + Azure AI Foundry Evaluations | Scoring, groundedness judge | Wk 3 Lab 3.2 |
| Hosting | Vercel | One deployed app, frontend + backend | Wk 5 lab |

### 3.2 The agentic/deterministic boundary is unchanged

Spec §3's boundary table is the heart of the design and this proposal does not
move a single row. The model still never produces a number. Every figure in an
explanation still traces to a logged calculation or a verbatim quote from a
cited document, or the guardrail forces `abstain`. The only change is *where the
loop runs*.

---

## 4. Component inventory and file structure

Mapped so the LLD can be written per-feature against it.

```
app/
  layout.tsx                     shell, dark navy theme
  page.tsx                       1. portfolio / exception queue
  investigations/[id]/page.tsx   2. live investigation trace
  casefiles/[id]/page.tsx        3. casefile review
  governance/page.tsx            4. policy + eval scoreboard
  api/
    ingest/route.ts              POST  multipart → documents, chunks, exception
    investigate/route.ts         POST  {exception_id} → {casefile_id}, kicks off
    investigate/advance/route.ts POST  {casefile_id} → runs exactly one step
    review/route.ts              POST  {casefile_id, decision, ...}

lib/
  agent/
    orchestrator.ts              the loop: one step per call, resumable
    prompt.ts                    system prompt assembly, cache-breakpointed
    tools/
      index.ts                   tool registry + JSON schemas
      document-agent.ts          Sonnet sub-agent + vector search
      definition-agent.ts        Sonnet sub-agent → terms JSON, schema-validated
      dscr-calculator.ts         thin wrapper: calls calc/, writes calc_log
      research-agent.ts          Sonnet sub-agent, gap hypotheses
      search-past-cases.ts       Supabase similarity over lessons
  deterministic.ts               ESM re-export of calc/ and guardrails/
  memory.ts                      exception profile, lesson retrieval (top 3)
  retrieval.ts                   embed + facility-filtered pgvector query
  supabase/
    server.ts                    service-role client (server only)
    browser.ts                   anon client, read-only
  pdf.ts                         text extraction + section chunking

calc/
  dscr.js                        zero-dependency pure calculator
  dscr.test.js
guardrails/
  casefile-schema.js             output shape validation
  guardrail.js                   the five §6.1 checks
  policy.js                      the §6.2 levers
  *.test.js
supabase/migrations/             schema (plan 1 task 1, unchanged)
data/facilities/F1..F6/          synthetic documents (plan 1 task 6, unchanged)
evals/run.mjs                    eval runner (plan 3)
docs/
  eng.md                         this file
  spec.md                        LLD, next
```

### 4.1 The deterministic core keeps its constraints, loses one test

`calc/dscr.js` and `guardrails/*.js` stay **zero-dependency and import-free.**
That costs nothing and keeps them portable — to an MCP server (spec §3
"optional"), to a Foundry tool on the production path, or back into an n8n Code
node if the owner ever wants one. It also keeps them trivially unit-testable,
which is the whole reason plan 1 is the cheapest place to build confidence.

Two consequences:

- **Spec §8.3's byte-identical sync check is deleted.** It existed solely to
  police the pasted n8n copy. With no copy, there is nothing to police. The
  other three §8.3 test groups stay.
- **The export form must change, and this fixes a latent bug in plan 1.**
  Plan 1's Global Constraints specify a guarded CommonJS export
  (`if (typeof module !== 'undefined' && module.exports)`), while Task 2's test
  does `import { computeDscr, CALCULATOR_VERSION } from './dscr.js'`. With
  `"type": "module"` in `package.json`, `calc/dscr.js` is parsed as ESM, `module`
  is undefined, the guard never fires, and the named import throws
  `SyntaxError: ... does not provide an export named 'computeDscr'`. **Plan 1
  Task 2 cannot pass as written.** The fix under this proposal is to end each
  file with a plain ESM `export { ... }` instead of the guarded CommonJS block.
  `export` is not an `import`, so the no-dependency, no-import property is
  preserved; only the n8n-paste compatibility is given up, which this proposal
  gives up anyway.

This bug is worth noting independently of the architecture decision: it would
have stopped the first implementation task under the n8n plan too, and would
have needed a `.cjs` rename or a `createRequire` shim to fix.

---

## 5. Orchestration runtime

The part that genuinely replaces n8n.

### 5.1 One step per invocation

An investigation is a resumable state machine over the `casefiles` row:

```
investigating ──step──▶ investigating ──▶ guardrail ──▶ policy ──▶ pending_review
      │                                                                │
      └────────────── error ──▶ failed (retryable, §6.3) ──────────────┘
                      step cap reached ──▶ abstain (§6.1)
```

`POST /api/investigate` creates the casefile, returns `{casefile_id}`
immediately — exactly as spec §4.2 requires — and schedules the first advance.
`POST /api/investigate/advance` runs **exactly one orchestrator turn**: one model
call, at most one tool execution, one persisted step. If the state is not
terminal it schedules the next advance and returns.

Each advance persists before scheduling the next:

- append `{n, tool, input_summary, output_summary, ts}` to `casefiles.trace`
- increment `casefiles.steps_count`
- update `casefiles.agent_messages` with the running Anthropic message history
- stamp `casefiles.last_step_at`

### 5.2 Why this shape

It is not a workaround; it is better than the n8n node on three counts the spec
cares about.

- **The step cap is enforced by code, not by a node setting.** `policy.max_steps`
  is read from the `policy` table on every advance, so the Risk Officer's lever
  in §6.2 is live rather than baked into a workflow export. Open item 5 in the
  handoff — "whether `max_steps: 8` is right" — becomes a row update, not a
  re-export.
- **Crash recovery is free.** A casefile stuck in `investigating` with a stale
  `last_step_at` is resumable by re-firing advance, which is precisely the Retry
  action spec §6.3 already requires.
- **The live trace is a side effect of the design.** Spec §7.2's 1-second poll
  reads a row that is written once per step by construction.

### 5.3 The Vercel duration ceiling

A Vercel serverless invocation has a maximum duration, and the current ceiling
differs by plan — **confirm the number for the owner's plan before deploying**,
as it has changed over time. The relevant fact is directional and safe: a single
Opus turn with a large cached prompt and adaptive thinking takes seconds, while
eight of them plus sub-agent calls plausibly runs into minutes. *That range is an
estimate from the spec's step counts, not a measurement.*

The one-step-per-invocation design makes the ceiling irrelevant: each invocation
contains one model call. The chain is driven by the platform's
continue-after-response primitive (`waitUntil`) so the scheduling fetch is not
killed when the handler returns, and `/advance` is protected by an internal
shared secret so it is not externally invokable.

If a step ever does exceed the ceiling, the casefile is mid-flight and
resumable — the failure mode is a delay, never a lost investigation and never a
half-formed recommendation presented as a result (§6.3).

### 5.4 Prompt caching

Handoff §7 identified n8n's `Prompt Caching: 1h` as the main cost lever. The
Anthropic API exposes the same capability directly with finer control: explicit
cache breakpoints after the system prompt, the memory lessons, and the retrieved
agreement text — the three blocks that repeat on every step of an investigation.
This is a strict improvement over a single node-level toggle. Thinking mode is
set per request rather than per node.

### 5.5 Tools

The five tools from spec §4.2 are unchanged in contract. Only the host changes.

| Tool | Implementation | Returns |
|---|---|---|
| `document_agent` | Sonnet 5.5 + facility-filtered pgvector | facts with `{citation, quote}` |
| `definition_agent` | Sonnet 5.5 + pgvector, output schema-validated | `terms` JSON with citations |
| `dscr_calculator` | wrapper over `calc/dscr.js`; `calc_id` injected here | `{calc_id, components, dscr, threshold, pass, margin}`, logged to `calc_log` |
| `research_agent` | Sonnet 5.5 + pgvector | findings with citations |
| `search_past_cases` | Supabase similarity query | lessons / casefile summaries |

`calc_id` is generated in the wrapper and passed into the pure function, never
generated inside it — the constraint that keeps the calculator's tests
deterministic.

**Forced tool choice stays off.** Handoff §7 found both models reject forced
`tool_choice` with a hard 400. In code this is simply a parameter we do not set,
which is one fewer setting to get wrong than the n8n option was.

---

## 6. API surface

Replaces the three n8n webhooks one-for-one, plus the internal advance.

| Route | Method | Body | Returns | Spec |
|---|---|---|---|---|
| `/api/ingest` | POST | multipart: PDF, `facility_id`, `doc_type` | `{document_id, exception_id?}` | §4.1 |
| `/api/investigate` | POST | `{exception_id}` | `{casefile_id}` immediately | §4.2 |
| `/api/investigate/advance` | POST | `{casefile_id}` + internal secret | `{status, steps_count}` | new, §5.1 |
| `/api/review` | POST | `{casefile_id, decision, reason?, corrected_outcome?, confirmed_tag?}` | `{status}` | §4.4 |

Reads do not go through the API. Spec §7's design — the browser reads Supabase
directly with the anon key under RLS read policies, all writes go through the
backend — is preserved exactly. It gives the 1-second trace poll for nearly
nothing. Supabase Realtime would remove the polling entirely and is noted as an
optional simplification, not a dependency.

The Gmail trigger (spec §4.5, optional/stretch) becomes a scheduled Vercel cron
route rather than an n8n trigger. It stays droppable without impact.

---

## 7. Data model

**Unchanged from spec §5**, with one addition required by §5.1.

| Change | Table | Reason |
|---|---|---|
| Add `agent_messages jsonb` | `casefiles` | The running Anthropic message history, so an investigation resumes across invocations. Under n8n this state lived inside the agent node and was never persisted. |
| Add `last_step_at timestamptz` | `casefiles` | Detect a stalled investigation and drive the §6.3 Retry action. |

Both are additive, both are in plan 1 Task 1 territory, and neither affects any
other table. Embeddings stay **1536-dimensional** (`text-embedding-3-small`) —
the `vector(1536)` columns depend on it.

Everything else — `facilities`, `documents`, `doc_chunks`, `exceptions`,
`calc_log`, `reviews`, `policy`, `eval_runs`, the six fixed pattern tags, and
`run_id` separating eval runs from demo data — is as specced.

---

## 8. Guardrails and policy

**No logic changes.** Spec §6.1's five ordered checks and §6.2's five policy
levers move from Code nodes to imported modules and run in the same order at the
same point: after the orchestrator returns its final output, before the casefile
reaches `pending_review`. Every forced change is still recorded in
`guardrail_notes` and shown in the UI.

The trap the handoff and plan 1 both single out stays the single most important
behaviour in the system, and it is a *guardrail* property, not a runtime one:

> A number in the explanation that came from a verbatim quote rather than a
> calculation **must be allowed**. "The covenant requires 1.25x" is a legitimate
> figure. A guardrail that accepts only calculated numbers abstains on every
> well-formed explanation — the zero-false-resolve metric would read perfect
> while the product did nothing. Compare numbers after normalisation, never as
> text: `1,250,000` ≡ `1250000`, `1.25` ≡ `1.25x`, `$4.25m` ≡ `4250000`.

Plan 1 Task 4 owns this, with tests. Nothing in this document changes it.

---

## 9. Frontend architecture

The deck's Step 4 is "Frontend Setup", and it sits *before* the LLD for a
reason: the component and state decisions constrain what the LLD can specify.

- **Next.js App Router**, TypeScript, React Server Components for the queue and
  governance reads; Client Components only where there is live state (the trace
  poll, the review actions, the upload form).
- **Four screens exactly as spec §7** — exception queue with KPI strip, live
  investigation trace, casefile review with citation side panel, governance and
  evals. No login, no multi-user, no mobile layout; spec §2 keeps those out.
- **Visual language from spec §7**, which is already a design system in
  miniature and should be written down as one per the deck's bonus step: dark
  navy surface, **teal = model steps, amber = code steps** labelled "computed by
  code · calc_id". That colour rule is doing real product work — it is how an
  analyst sees the agentic/deterministic boundary at a glance — so it belongs in
  tokens, not in ad-hoc class names.
- **Citation chips** open a side panel with the exact clause text and the
  highlighted quote. This is the component that makes the product's central
  claim visible, and the demo (§10) clicks it on camera.

Accessibility and contrast are worth a pass on the dark theme, since teal and
amber on navy are easy to get wrong.

---

## 10. Evaluation and observability

**Evaluation is unchanged** (spec §8). `evals/run.mjs` now POSTs to
`/api/investigate` on the deployed app instead of an n8n webhook — a base-URL
change. Two passes, cold and warm. The 6-case development subset stays the
default; all 24 cases run twice only for reportable numbers. Outputs stay
`results.csv`, `report.md`, `foundry.jsonl`, and an `eval_runs` row.

**Azure AI Foundry keeps its §8.2 role**: groundedness evaluation over the
uploaded JSONL with an LLM judge. Handoff §4.4 flags that the judge is currently
`gpt-4.1-mini` and should be upgraded to full `gpt-4.1` before final numbers are
reported, since a judge's credibility matters when the score is the evidence.
Deploying that model is billable and is the owner's call.

**Observability** comes from `casefiles.trace` and `calc_log`, which the spec
already requires and the UI already renders. The Week 5 lab's Step 8 — watching
traces in the Foundry portal — is replaced by watching them in the product,
which is the better artifact for a 3-minute pitch. Vercel's own logs cover
infrastructure-level debugging.

**The open measurement in handoff §4.4 survives and gets easier:** whether
Sonnet 5.5 can orchestrate without hurting accuracy is now a one-line model-id
change plus an eval run, rather than a workflow edit. If it holds, it halves
cost *and* produces a model-selection finding — a strong portfolio artifact.

---

## 11. Risks

| Risk | Mitigation | Status |
|---|---|---|
| Vercel invocation ceiling vs. multi-step investigation | One model call per invocation; resumable casefile (§5.1, §5.3) | Designed around |
| Hand-written loop has bugs an agent node would not | Guardrail and policy are post-hoc and independently unit-tested; step cap enforced from the `policy` table | Accepted |
| Spec §3/§4 rewrite consumes owner review time | This HLD is the proposal; §13 lists the exact edits so review is bounded | Owner's call |
| Agent path too uniform, looks like a pipeline | Unchanged from spec §12: facility twists force different paths; F1 vs F5 trace comparison in the demo | Unchanged |
| Model hallucinated figures or quotes | Unchanged: code guardrails force abstain, tested with fabricated outputs | Unchanged |
| Supabase free-plan database sleeps after ~1 week idle | Daily use avoids it; Pro removes it for ~$25 and is the owner's call | Unchanged |
| Internal `/advance` route abused | Shared secret; route rejects requests without it | Designed |
| ~~n8n Cloud plan may lack required nodes~~ | Retired by this decision | **Closed** |
| ~~Generated n8n JSON needs node-version fixes~~ | Retired by this decision | **Closed** |
| ~~Calculator copy drifts from n8n copy~~ | Retired by this decision | **Closed** |

---

## 12. What this means for the three plans

| Plan | Covers | Effect of this decision |
|---|---|---|
| **1 — Deterministic core** | Schema, DSCR calculator, casefile validator, guardrail, policy engine, synthetic facilities | **Survives almost entirely.** Three edits: two additive columns in Task 1 (§7), ESM exports instead of guarded CommonJS (§4.1), and the §8.3 sync check dropped. Tasks 2–6 are otherwise untouched. |
| **2 — Orchestration** | Was: n8n Ingest/Investigate/Review workflows. Now: API routes, agent loop, tools, retrieval | **Rewritten.** Becomes the LLD's main body, in the deck's 12-item blueprint format. |
| **3 — UI and evals** | Analyst screens, eval runner | **Mostly survives.** Vite + React becomes Next.js App Router; screens, data reads and eval logic unchanged. |

Plan 1 was always the cheapest place to build confidence and it still is. It
needs no model calls, no network beyond the schema migration, and now no
runtime decision either.

---

## 13. Spec amendments this proposal requires — owner approval needed

The spec is owner-owned. These are proposed edits, not applied ones.

| § | Current | Proposed |
|---|---|---|
| §2 Scope | "deployment (runs locally; n8n is on n8n Cloud)" out of scope | Deployment to Vercel is **in** scope. Auth, multi-user, roles and mobile stay out. |
| §3 Architecture | Orchestration = n8n Cloud AI Agent node; UI = Vite + React, local | Orchestration = TypeScript loop in Next.js route handlers, Anthropic SDK; UI = Next.js on Vercel. Model split, retrieval, calculation, memory and evaluation rows unchanged. |
| §3 "Why n8n for the MVP" | Paragraph justifying n8n | Replaced by §2 of this document. |
| §4 Workflows (n8n) | §4.1–§4.5 expressed as n8n nodes | Re-expressed as API routes and the agent loop. **All behaviour preserved** — same steps, same tool contracts, same `terms` schema, same calculator contract, same async-response pattern. §4.5 Gmail becomes a cron route, still optional. |
| §4.2 Anthropic node settings | n8n node option names | Anthropic API parameters: cache breakpoints, adaptive thinking, no forced tool choice, `max_steps` read from `policy`. |
| §5 Data model | `casefiles` columns | Add `agent_messages jsonb`, `last_step_at timestamptz`. |
| §7 Analyst UI | "Vite + React … local" | Next.js App Router on Vercel. Four screens, visual language and read/write split unchanged. |
| §8.3 Engineering tests | Sync check: n8n JSON byte-identical to `calc/dscr.js` | Removed. Other three test groups unchanged. |
| §12 Risks | Two n8n rows | Replaced by the Vercel-duration row (§11). |
| §13 Decisions log | "n8n Cloud orchestrator over Azure Foundry agent" | Amended with this decision and its reasoning. **Foundry Agent Service remains the stated production path.** |
| §14.3 Open items | "confirm the n8n Cloud plan includes the AI Agent node and the Supabase Vector Store node" | Closed — no longer applicable. |

**Explicitly unchanged:** the problem statement, success criteria and all seven
metrics (§1), the agentic/deterministic boundary table (§3), the `terms` schema
and DSCR calculator contract (§4.2), expected investigation paths (§4.3), review
semantics and memory (§4.4), every guardrail check (§6.1), every policy lever
(§6.2), error handling (§6.3), the eval set and runner (§8.1–§8.2), synthetic
data rules (§9), and the demo structure (§10).

---

## 14. Open items for the owner

Carried forward from handoff §11, re-scored against this proposal.

1. **Approve or reject this HLD** (§13). Everything downstream waits on it. The
   LLD is written against whichever answer comes back.
2. **§14.1 — do the six borrower twists ring true?** Unaffected by this
   decision, still gates plan 1 Task 6, still the thing most worth your credit
   experience. Draft-then-react is fine.
3. **Expected DSCR values.** Still yours to compute in a spreadsheet, still
   signed off per row, and the eval runner must still refuse to run while any
   row says `NO`. The reason is unchanged: if the thing that grades the
   calculator shares an author with the calculator, the tests only prove it
   agrees with itself.
4. **§14.2 — the 24 eval labels**, once drafted.
5. **`max_steps: 8`.** Now a `policy` row rather than a code change, so this got
   cheaper to revisit.
6. **Whether full `gpt-4.1` gets deployed for the judge.** Billable, your call.
7. ~~**n8n Cloud plan node availability.**~~ Closed by this proposal.
8. **Confirm the Vercel plan's function duration ceiling** before first deploy
   (§5.3). Does not change the design; worth knowing the number.

---

## 15. Recommended next step

If §13 is approved, the LLD (`docs/spec.md`) is written next, feature by
feature, in the Week 5 blueprint format — Product & UX, Data & Backend, Frontend
& QA — with plan 1 folded in as the already-planned deterministic core.

Plan 1 Tasks 1–5 can start in parallel with LLD review, because they contain no
runtime decision: the schema, the calculator, the casefile validator, the
guardrail and the policy engine are identical under every option considered in
§2.
