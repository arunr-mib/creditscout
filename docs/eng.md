# CreditScout — Engineering Document (HLD)

**Date:** 2026-10-05
**Status:** Proposal for owner review — the Step-4 Review gate
**Author:** Claude Code (engineering)
**Owner:** Arun Rajendiran (product, credit domain, all sign-offs)

**Input:** `docs/superpowers/specs/2026-10-01-creditscout-design.md` (the spec — owner-owned, source of truth)
**Output:** this document, then `docs/spec.md` (LLD)
**Method:** spec-driven development, Week 5 Cohort 10 lab workflow —
PRD → Design → **HLD → Review** → Frontend Setup → LLD → Review → Implement → Deploy → Maintain

> This document proposes changes to the spec's §3 and §4. It does not apply
> them. §11 lists the exact edits for the owner to approve or reject.

---

## 1. What we are building, in one page

CreditScout is an MVP for a 6-week cohort course, not a production system. Two
goals drive every choice below, and where they conflict, the second wins:

1. **Demonstrate the product thesis** — a reasoning layer decides what evidence
   to inspect; a calculation layer never guesses; a human always approves.
2. **Be a good vehicle for learning how multi-agent orchestration actually
   works** — the owner needs to *see* an orchestrator agent delegate to
   specialist agents and watch the workflow run.

The owner's decision, 2026-10-05: **Azure AI Foundry Agent Service runs the
agent loop.** Model choice is open to anything available on Azure.

### The shape of the system

```
          Analyst (browser)
                 │
   ┌─────────────▼──────────────────────────┐
   │  Next.js app on Vercel                 │
   │  4 analyst screens + API routes        │
   └──┬──────────────────────────────┬──────┘
      │ start investigation          │ tool calls come back in
      ▼                              │
   ┌─────────────────────────────────┴──────┐
   │  Azure AI Foundry Agent Service        │   ← the loop runs HERE
   │                                         │
   │   CreditScout Orchestrator (main)       │
   │     ├─ connected agent: document_agent  │
   │     ├─ connected agent: definition_agent│
   │     ├─ connected agent: research_agent  │
   │     ├─ tool: dscr_calculator      ──────┼──┐
   │     ├─ tool: search_documents     ──────┼──┤ OpenAPI calls
   │     └─ tool: search_past_cases    ──────┼──┘ back to Vercel
   └─────────────────┬───────────────────────┘
                     │ run completes
                     ▼
   ┌────────────────────────────────────────┐
   │  Guardrail + Policy (our code, Vercel) │   ← can force `abstain`
   └─────────────────┬──────────────────────┘
                     ▼
   ┌────────────────────────────────────────┐
   │  Supabase — casefiles, calc_log,       │
   │  documents, vectors, memory, policy    │
   └────────────────────────────────────────┘
```

**Why this satisfies both goals.** Foundry runs the loop, so the owner sees the
orchestrator delegate to three specialist agents and can replay every step in
the Foundry portal — that is the learning goal, met natively. But the calculator
and the guardrails stay in our own code, called as tools and run after the
agent respectively, so the model still never produces a number and code still
has the last word before a human sees anything. The thesis survives intact.

---

## 2. The tech stack

| Layer | Choice | Notes |
|---|---|---|
| **Frontend** | Next.js (App Router), React, TypeScript | Four analyst screens from spec §7 |
| **Database & Auth** | Supabase — Postgres + pgvector | Auth out of scope for MVP; available when wanted |
| **AI** | Azure OpenAI models (see §3) | Orchestrator + 3 specialist agents + eval judge |
| **Deployment** | **Vercel** | Owner already has an account and projects |
| **Build tool** | Next.js built-in (Turbopack) | Replaces Vite; no separate build tool |
| **AI Agent Platform** | **Azure AI Foundry Agent Service** | Runs the loop, Connected Agents, traces |
| Language / runtime | TypeScript, Node 24 | |
| Testing | `node:test` + `node:assert/strict` | No test framework, per project constraints |
| Deterministic core | Plain JavaScript, zero dependencies | `calc/dscr.js`, `guardrails/*.js` |
| Evaluation | `evals/run.mjs` + Foundry Evaluations | Spec §8, unchanged |

Everything here except the AI rows is unchanged from the previous proposal.

---

## 3. Models

Verified live against the owner's Azure account on 2026-10-05.

**Already deployed** in `contractreviewagent-resource` (resource group
`AI_Learning`, region `eastus2`):

| Deployment | Model | SKU | Capacity |
|---|---|---|---|
| `gpt-5-mini` | gpt-5-mini (2025-08-07) | GlobalStandard | 50 |
| `gpt-4.1-mini` | gpt-4.1-mini (2025-04-14) | GlobalStandard | 100 |
| `text-embedding-3-small` | text-embedding-3-small v1 | Standard | 120 |

**Also available to deploy in `eastus2`** — the catalog is wide: the full GPT-5.x
and GPT-6 families, `claude-opus-5-5`, `claude-sonnet-5-5`, Grok, Llama, Mistral,
DeepSeek, Cohere. Model choice costs no new infrastructure, only a deployment.

### Recommended assignment

| Role | Model | Why |
|---|---|---|
| Orchestrator | `gpt-5.4` | Makes the evidence-sufficiency judgement, which drives the headline zero-false-resolve metric. Don't economise here. |
| `document_agent`, `definition_agent`, `research_agent` | **`gpt-5-mini`** | They read and quote rather than judge, every quote is code-verified anyway, and this is where most calls happen. **Already deployed — zero setup.** |
| Eval judge (§8.2) | `gpt-4.1` | Deliberately a different family/generation from the agents, so the judge is not grading its own kind. |
| Embeddings | `text-embedding-3-small` | **1536 dimensions** — the schema's `vector(1536)` columns depend on this number. Already deployed. |

**These are starting points, not commitments.** Each is a deployment name in
config; changing one is a config edit plus an eval run, which is exactly the
kind of comparison worth reporting in the pitch.

**On dropping Claude.** The spec's §13 reasoning for Claude was the Anthropic
certification track and the orchestrator's judgement quality. The owner has
decided model choice is open. Worth knowing: `claude-opus-5-5` and
`claude-sonnet-5-5` *are* available in `eastus2` at standard rates, so this
stays reversible — and remains a good independent eval judge if a non-OpenAI
grader is ever wanted. Nothing in the design depends on which family wins.

**The open measurement in handoff §4.4 survives and improves.** "Can the cheaper
model orchestrate without hurting accuracy?" is now a one-line deployment-name
change plus an eval run. If a mini model holds accuracy, that halves cost *and*
produces a model-selection finding — a strong portfolio artifact most people
never generate.

---

## 4. How the agents are wired

### 4.1 Connected Agents — the multi-agent pattern

Foundry's **Connected Agents** lets a main agent delegate to specialist agents in
natural language, with no router to hand-write. That maps onto spec §4.2 exactly:

| Spec §4.2 tool | Becomes | Job |
|---|---|---|
| `document_agent` | Connected agent | Retrieve clauses and facts; return `{citation, quote}` |
| `definition_agent` | Connected agent | Map the DSCR definition + amendments into the `terms` JSON |
| `research_agent` | Connected agent | Investigate a gap: amendment, period mismatch, add-back, borrower error, our mapping error |
| `dscr_calculator` | OpenAPI tool → Vercel | Deterministic calculation. **Never a model.** |
| `search_past_cases` | OpenAPI tool → Vercel | Memory search over past lessons |

Plus one tool the sub-agents need:

| Tool | Type | Job |
|---|---|---|
| `search_documents` | OpenAPI tool → Vercel | Facility-filtered vector search over `doc_chunks` in Supabase |

**This is the learning payoff.** The Foundry portal shows the orchestrator
deciding, delegating to a named specialist, receiving its answer, and choosing
what to do next — the thing the owner wants to watch. It is genuinely a
multi-agent system, not a pipeline with a model in it.

### 4.2 How tools reach our code

Foundry agents call **OpenAPI 3.0 specified tools** over HTTP. Our Next.js app
on Vercel publishes those endpoints, so there is one codebase and no Azure
Functions to maintain:

```
Foundry agent ──HTTPS + API key──▶ Vercel /api/tools/dscr-calculator
                                        └─▶ imports calc/dscr.js  (pure, zero-dep)
                                        └─▶ writes calc_log row
```

Same shape for `search_documents` and `search_past_cases`, which read Supabase.

This is the detail that keeps the product thesis true under Option B: **the
model can ask for a calculation, but it cannot perform one.** The number comes
back from our code with a `calc_id`, and the guardrail later checks every figure
in the explanation against that log.

### 4.3 Where the guardrails run

Unchanged in logic, and deliberately **outside** the agent. When a Foundry run
completes, our code — not the model — runs spec §6.1's five ordered checks and
§6.2's policy levers before the casefile ever reaches `pending_review`.

The single most important behaviour in the system is a guardrail property, and
nothing about Foundry changes it:

> A number in the explanation that came from a **verbatim quote** rather than a
> calculation **must be allowed**. "The covenant requires 1.25x" is legitimate.
> A guardrail that accepts only calculated numbers abstains on every well-formed
> explanation — the zero-false-resolve metric would read perfect while the
> product did nothing. Compare numbers after normalisation, never as text:
> `1,250,000` ≡ `1250000`, `1.25` ≡ `1.25x`, `$4.25m` ≡ `4250000`.

Plan 1 Task 4 owns this, with tests.

---

## 5. How an investigation runs

1. Analyst clicks **Investigate**. The browser calls `POST /api/investigate`.
2. Vercel creates the `casefiles` row, loads memory (the facility's prior cases
   plus the top 3 lessons), creates a Foundry **thread**, starts a **run**, and
   stores `foundry_thread_id` / `foundry_run_id` on the casefile.
3. It returns `{casefile_id}` **immediately** — as spec §4.2 requires.
4. Foundry runs the loop: the orchestrator delegates to specialists and calls our
   tools. Tool calls arrive at Vercel as ordinary HTTPS requests.
5. Vercel polls the run and mirrors each completed step into `casefiles.trace`,
   so the live UI trace (spec §7.2) and the Foundry portal show the same work.
6. On completion, guardrail → policy → `status = pending_review`.
7. The analyst approves or overrides. An override becomes a lesson in memory.

**This fits Vercel's serverless model cleanly.** No request has to stay open
while the agent thinks — Foundry holds the long-running work, and our side is
only short reads and writes. The duration-ceiling problem from the previous
proposal disappears.

**Failure is never presented as a result** (spec §6.3). A failed or abandoned run
leaves the casefile `failed` with a Retry action, never a half-formed
recommendation.

---

## 6. Data model

**Unchanged from spec §5**, with two additive columns on `casefiles`:

| Column | Why |
|---|---|
| `foundry_thread_id text` | Links the casefile to its Foundry thread, so traces can be fetched and replayed |
| `foundry_run_id text` | Same, for the specific run |

Everything else is as specced: `facilities`, `documents`, `doc_chunks`,
`exceptions`, `calc_log`, `reviews`, `policy`, `eval_runs`, the six fixed pattern
tags, and `run_id` separating eval runs from demo data. Embeddings stay
**1536-dimensional**.

---

## 7. Observability — the owner's question, answered

Three layers, each answering a different question:

| Layer | Question it answers | Where |
|---|---|---|
| **In-product trace** | "What did the agent do on *this* case? Let me click that citation." | Our UI, reading `casefiles.trace` |
| **Agent traces** | "Replay the whole reasoning chain. Which specialist did what? Where was the latency?" | **Foundry portal** (Application Insights) |
| **Token usage & cost** | "What did this investigation cost? Which agent burned the tokens?" | Foundry / Azure Monitor metrics |

Under Option B all three come largely for free, because Foundry instruments the
run itself. This is the lab's Step 8, met natively rather than reconstructed.

The in-product trace still matters and is still built: the demo (§10) clicks
through it on camera, and no dashboard substitutes for showing an analyst the
agent's work inside the product.

---

## 8. Evaluation

**Unchanged from spec §8.** `evals/run.mjs` POSTs to `/api/investigate` on the
deployed app instead of an n8n webhook — a base-URL change. Two passes, cold and
warm. The 6-case development subset stays the default; all 24 cases run twice
only for reportable numbers. Outputs stay `results.csv`, `report.md`,
`foundry.jsonl`, and an `eval_runs` row for the in-app scoreboard.

Azure AI Foundry Evaluations keeps its §8.2 role for groundedness with an LLM
judge. Handoff §4.4's point stands: upgrade the judge from `gpt-4.1-mini` to full
`gpt-4.1` before reporting final numbers, because a judge's credibility matters
when the score is the evidence. Deploying it is billable and is the owner's call.

The owner still computes the expected DSCR values independently, and the runner
must still refuse to run while any row says `NO`. Reason unchanged: if the thing
grading the calculator shares an author with the calculator, the tests only prove
it agrees with itself.

---

## 9. What this means for the three plans

| Plan | Covers | Effect |
|---|---|---|
| **1 — Deterministic core** | Schema, DSCR calculator, casefile validator, guardrail, policy engine, synthetic facilities | **Survives almost entirely.** Two additive columns in Task 1 (§6), ESM exports instead of guarded CommonJS (§10.1), §8.3's sync check dropped. Tasks 2–6 otherwise untouched. |
| **2 — Agents and tools** | Foundry agent definitions, connected agents, OpenAPI tool endpoints, retrieval, memory | **Rewritten** around Foundry. Becomes the LLD's main body. |
| **3 — UI and evals** | Analyst screens, eval runner | **Mostly survives.** Vite + React becomes Next.js; screens, data reads and eval logic unchanged. |

Plan 1 remains the cheapest place to build confidence — no model calls, no
network beyond the schema migration, and now no platform dependency either.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Connected Agents is a preview feature.** Preview features change and can be flaky — and this one is load-bearing for the learning goal. | Fallback: demote the three specialists from connected agents to plain OpenAPI tools on the orchestrator. Same behaviour, less elegant, no preview dependency. Decide after the first working run, not before. |
| Foundry Agent Service adds platform-specific learning time | That is the point of the exercise, and the course taught it in Week 5 |
| Agent path too uniform, looks like a pipeline | Unchanged from spec §12: the six facility twists force different paths; the F1 vs F5 trace comparison is in the demo |
| Model hallucinated figures or quotes | Unchanged: code guardrails force abstain, tested against fabricated outputs |
| Step cap enforcement differs from an n8n node setting | Enforced by our polling layer against `policy.max_steps`; see §12 open item 4 |
| Supabase free-plan database sleeps after ~1 week idle | Daily use avoids it; Pro removes it for ~$25 — owner's call |
| Tool endpoints on Vercel are publicly reachable | Shared secret in a header; Foundry sends it on every tool call |
| ~~n8n Cloud plan may lack required nodes~~ | **Closed** — n8n dropped |
| ~~Generated n8n JSON needs node-version fixes~~ | **Closed** |
| ~~Calculator copy must stay byte-identical to n8n's~~ | **Closed** |

### 10.1 A bug in plan 1 that must be fixed either way

Plan 1's Global Constraints specify a guarded CommonJS export
(`if (typeof module !== 'undefined' && module.exports)`), but Task 2's test does
`import { computeDscr } from './dscr.js'` and `package.json` sets
`"type": "module"`. The file is therefore parsed as ESM, `module` is undefined,
the guard never fires, and the import throws. **Plan 1 Task 2 cannot pass as
written.**

Fix: end each deterministic file with a plain ESM `export { ... }`. The files stay
zero-dependency and import-free — only the n8n-paste compatibility is given up,
which this proposal gives up anyway. This would have bitten the first
implementation task under any of the options considered.

---

## 11. Spec amendments — owner approval needed

The spec is owner-owned. Proposed, not applied.

| § | Current | Proposed |
|---|---|---|
| §2 Scope | "deployment (runs locally; n8n is on n8n Cloud)" out of scope | Deployment to Vercel is **in** scope. Auth, multi-user, roles, mobile stay out. |
| §3 Architecture | Orchestration = n8n Cloud AI Agent node, Claude Opus 5.5; UI = Vite + React, local | Orchestration = **Azure AI Foundry Agent Service** with Connected Agents; UI = **Next.js on Vercel**. Retrieval, calculation, memory and evaluation rows unchanged. |
| §3 "Why n8n for the MVP" | Paragraph justifying n8n | Replaced by §1 of this document. |
| §3 Production path | "Foundry Agent Service inside the bank's tenant" is roadmap | Becomes **what is actually built**, minus the bank tenant. Strengthens the story. |
| §4 Workflows (n8n) | §4.1–§4.5 expressed as n8n nodes | Re-expressed as API routes, Foundry agents and OpenAPI tools. **All behaviour preserved** — same steps, same tool contracts, same `terms` schema, same calculator contract, same immediate-response pattern. §4.5 Gmail becomes a cron route, still optional. |
| §4.2 Anthropic node settings | n8n node option names | Foundry agent + run configuration. |
| §4.2 / §13 Models | Claude Opus 5.5 orchestrator, Claude Sonnet 5.5 sub-agents | Azure-hosted models per §3. Reversible; Claude remains available on Azure. |
| §5 Data model | `casefiles` columns | Add `foundry_thread_id text`, `foundry_run_id text`. |
| §7 Analyst UI | "Vite + React … local" | Next.js on Vercel. Four screens, visual language, read/write split unchanged. |
| §8.3 Engineering tests | Sync check: n8n JSON byte-identical to `calc/dscr.js` | Removed. The other three test groups unchanged. |
| §12 Risks | Two n8n rows | Replaced by §10 above. |
| §14.3 Open items | "confirm the n8n Cloud plan includes the AI Agent node and Supabase Vector Store node" | **Closed** — no longer applicable. |

**Explicitly unchanged:** the problem statement, success criteria and all seven
metrics (§1), the agentic/deterministic boundary table (§3), the `terms` schema
and DSCR calculator contract (§4.2), expected investigation paths (§4.3), review
semantics and memory (§4.4), every guardrail check (§6.1), every policy lever
(§6.2), error handling (§6.3), the eval set and runner (§8.1–§8.2), synthetic data
rules (§9), and the demo structure (§10).

---

## 12. Open items for the owner

1. **Approve or reject this HLD** (§11). The LLD is written against the answer.
2. **§14.1 — do the six borrower twists ring true?** Unaffected by the platform
   decision, still gates plan 1 Task 6, still the item most worth the owner's
   credit experience. Draft-then-react is fine.
3. **Expected DSCR values** — owner-computed in a spreadsheet, signed off per row.
4. **`max_steps: 8`** — still a `policy` row; confirm how it maps onto a Foundry
   run once the first run exists.
5. **§14.2 — the 24 eval labels**, once drafted.
6. **Whether full `gpt-4.1` gets deployed for the judge.** Billable, owner's call.
7. **Confirm the orchestrator model.** `gpt-5.4` is the recommendation; the
   catalog is wide and nothing depends on it.

---

## 13. Recommended next step

If §11 is approved, write the LLD (`docs/spec.md`) feature by feature in the Week
5 blueprint format — Product & UX, Data & Backend, Frontend & QA.

Plan 1 Tasks 1–5 can start in parallel with LLD review: the schema, calculator,
casefile validator, guardrail and policy engine contain no platform decision and
are identical under every option considered.
