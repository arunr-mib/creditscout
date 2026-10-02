# CreditScout — Handoff

**For:** whoever picks this up next, human or agent, with no prior context.
**Written:** 2026-10-02
**Repo:** `arunr-mib/creditscout` (private) — `git@github.com:arunr-mib/creditscout.git`
**Owner:** Arun Rajendiran (product, credit domain, all credentials, all sign-offs)

Read this file, then the spec. Don't start coding until you've read both.

---

## 1. What this is

CreditScout is a decision-support agent for commercial credit analysts investigating covenant exceptions.

A rules engine can already tell an analyst that a reported ratio is below its threshold. What it can't do is the investigation that follows: find the covenant definition that's actually in force across a long credit agreement and its amendments, recompute the ratio on the right basis, explain any gap against the borrower's own figure, and judge whether the evidence is good enough to resolve, escalate, or ask for more.

That investigation is what CreditScout does. The scope is deliberately one covenant — **DSCR**, tested quarterly on a trailing-twelve-month basis — across six synthetic borrower facilities.

**It never makes a credit decision.** It recommends; a human analyst approves or overrides, and overrides become memory for later cases.

**Why it exists:** keystone project for the Maven "Master Agentic AI for PMs and FDEs" course, Cohort 10, and an AI PM portfolio piece. Pitch is a 3-minute pre-recorded video.

---

## 2. The one idea that explains every design decision

> **A reasoning layer decides what evidence to inspect next. A calculation layer never guesses. A human always approves.**

Everything below follows from that split. When you hit an ambiguous design question, resolve it by asking which side of that line the thing belongs on.

| Responsibility | Owner |
|---|---|
| Deciding what to inspect next | Model |
| Reading agreements, amendments, waivers, certificates | Model |
| Mapping the DSCR definition into structured terms | Model, schema-validated |
| **All arithmetic, comparisons, rounding** | **Code** |
| Forming hypotheses for a gap | Model |
| Judging evidence sufficiency | Model, bounded by code guardrails |
| **Guardrails, policy enforcement** | **Code** |
| **Final decision** | **Human, always** |

The spec's §3 has the full table. The practical consequence: the model is never allowed to produce a number. Every figure in an explanation must trace to a logged calculation or a verbatim quote from a cited document, or the guardrail forces the whole recommendation to `abstain`.

---

## 3. Key documents

| Path | What it is |
|---|---|
| `docs/superpowers/specs/2026-10-01-creditscout-design.md` | **The spec. Source of truth.** 14 sections. The owner owns this file. |
| `docs/superpowers/plans/2026-10-02-creditscout-deterministic-core.md` | Implementation plan 1 of 3. 6 tasks, 38 test-first steps, full code in every step. |
| `.env.example` | Every credential and endpoint the project needs. |
| `.env` | The real values. **Gitignored. Never commit it.** |

---

## 4. Decisions and the reasoning behind them

These were argued through rather than defaulted into. If you want to change one, you need to beat the reasoning, not just prefer something else.

### 4.1 n8n Cloud orchestrates, not Azure AI Foundry

The owner genuinely debated this — Foundry would have been better for learning Azure and for interviews. It was rejected for this build because:

- The owner already knows n8n; the whole of spec §4 is expressed as n8n nodes
- Foundry Agent Service would mean hand-writing the orchestrator, five function tools, retrieval, and an HTTP surface for three webhooks
- The Azure CLI accelerates *provisioning*, not *authoring* — there is no `az` command that writes a tool-calling loop. This was a misconception worth correcting early.
- **The spec already delivers the Azure credential through §8.2**, which runs Azure AI Foundry Evaluations with an LLM judge. That's a real, honest Azure artifact without betting the build on relearning the orchestration layer.

**Deferred, not dropped:** a Foundry Agent Service version of the same spec is planned *after* submission, as a second portfolio piece with better learning conditions.

### 4.2 Supabase must be cloud-hosted, never local

**This one is load-bearing — don't "optimise" it.**

n8n Cloud is remote SaaS. It cannot reach a Supabase running on the owner's laptop. Since the vector store and all persistence sit behind n8n nodes, the database has to be publicly reachable. Local Supabase is fine for offline schema work; it can never be what n8n talks to.

### 4.3 Reusing an existing Supabase project

Project `rngsejqplndmygrozasc` (region `ca-central-1`, org "House of Credit"). The org is on the **free plan, which caps it at 2 projects, and both slots were already used**. Rather than delete anything, we reused the `contract-review-feedback` project. Its leftover 2-row `feedback` table was deliberately left in place — it's harmless.

The project name in the Supabase dashboard still says `contract-review-feedback`. That's cosmetic; the underlying address doesn't change if it's renamed.

**Known risk:** free-plan databases sleep after roughly a week idle. Daily use avoids it. If a demo matters more than $25, Pro removes the risk.

### 4.4 Model split

| Role | Model | Reasoning |
|---|---|---|
| Orchestrator | `claude-opus-5-5` | This layer makes the "is this evidence sufficient" call, which *is* the headline zero-false-resolve metric. Don't economise here. |
| `document_agent`, `definition_agent`, `research_agent` | `claude-sonnet-5-5` | They read and quote rather than judge, every quote is code-verified anyway, and this is where most calls happen — so it's where the saving is real. |
| Eval judge | `gpt-4.1-mini` on Azure | Interim. Full `gpt-4.1` is available with ample quota; upgrade before reporting final numbers, since a judge's credibility matters when the score is the evidence. |

**Open measurement worth doing:** whether Sonnet 5.5 can orchestrate without hurting accuracy. Run the eval on both and compare — if it holds, that halves costs *and* produces a model-selection finding, which is a strong portfolio artifact that most people never produce.

### 4.5 Cost posture

The owner is cost-sensitive. Quote costs with reduction levers attached, never as a bare figure.

Agreed levers: a **6-case development subset** (all 24 twice only for reportable numbers), **step cap 8**, and **prompt caching**. Rough landing estimate $15–25 for a full eval cycle — *estimated from the spec, not measured*. Recalculate from the first real investigation.

### 4.6 Financial figures are printed as labeled lines

The spec required six financial inputs for the calculator but put statement extraction out of scope (that's SpreadSense's domain). That was a genuine hole.

**Resolution:** the synthetic financials document states each input as its own labeled line — `Consolidated EBITDA: 4,250,000`. The agent reads and cites them; the calculator never extracts or infers. This keeps extraction out of scope while still supplying §4.2, and it keeps the agent doing visible work.

### 4.7 The owner computes the expected DSCR values

Not Claude, not the calculator. Plan 1 Task 6 generates `data/expected-values-template.csv` with an empty `expected_dscr` column; the owner fills it from a spreadsheet and flips `owner_signed_off` to `YES`.

**Why it matters:** if the thing that grades the calculator is written by the same author as the calculator, the tests only prove it agrees with itself. The eval runner must refuse to run while any row says `NO`.

### 4.8 Private repo; publication is a separate decision

The spec says push only with owner approval. A private repo was created for version control. **Making it public is a decision the owner has not made** — don't make it for them.

---

## 5. Environment state

Everything below is verified with live calls, not assumed.

| Thing | State |
|---|---|
| Private GitHub repo | ✅ `arunr-mib/creditscout` |
| Supabase project | ✅ `rngsejqplndmygrozasc`, `vector` 0.8.2 enabled in schema `extensions` |
| Supabase service key | ✅ read and write both confirmed |
| Anthropic key | ✅ responds |
| Azure Foundry project | ✅ `creditscout` under account `contractreviewagent-resource`, resource group `AI_Learning`, eastus2 |
| Azure embeddings | ✅ `text-embedding-3-small`, **1536 dimensions** (the schema depends on this number) |
| Azure chat model | ✅ `gpt-4.1-mini` responds |
| CLIs | ✅ `az` 2.90 (+ `ml` ext), `supabase` 2.119, `n8n` 2.41.6, `uv`, `gh`, `docker`, Node 24.8 |

**Not set up, deliberately:** Vercel (UI runs locally per §2), local Supabase (see 4.2), Docker-based n8n (n8n is Cloud), Azure Functions tools (not needed on this path).

---

## 6. Machine gotchas that will waste your time

These are real and were hit during setup.

1. **Homebrew cannot install new formulae on the owner's Mac.** macOS 27.0.1 is not a Homebrew Tier 1 configuration, so there are no prebuilt bottles, and the fallback source build fails because Command Line Tools are 16.4 where Xcode 27 wants 27.x. `azure-cli`, `supabase` and `uv` all failed this way.
   **Work around it** with prebuilt binaries into `~/.local/bin` (already first on PATH): GitHub release tarballs, vendor install scripts, or `uv tool install` for Python CLIs. Permanent fix if ever wanted: `sudo rm -rf /Library/Developer/CommandLineTools && sudo xcode-select --install`.

2. **Don't run several `brew install` commands in parallel** — they fight over Homebrew's portable Ruby and fail with "Another `brew vendor-install ruby` process is already running."

3. **Azure CLI installed via `uv` can't add extensions until pip is injected.** `az extension add` shells out to pip, and uv tool venvs ship without it. The error is a useless "Pip failed with status code 1"; the real cause appears only under `--debug`.
   Fix: `uv pip install --python ~/.local/share/uv/tools/azure-cli/bin/python pip`, or install with `uv tool install azure-cli --with pip`.

4. **The Supabase dashboard has two different keys that are easy to confuse.** `sbp_...` is a personal access token for the CLI. The database service key is a JWT starting `eyJ` (or `sb_secret_...`). Both are now in `.env` under the right names.

---

## 7. n8n findings — verified against node definitions

Read from the **locally installed n8n 2.41.6** node definitions. The owner's n8n **Cloud** version may differ, so confirm in the actual instance.

| Finding | Detail |
|---|---|
| **Prompt caching is supported** | The Anthropic node has a `promptCaching` option: `disabled` / `5m` / `1h`. Use `1h`. This is the main cost lever. |
| **Model IDs can be typed** | The model field takes `mode: 'list'` or `mode: 'id'`. The node default is `claude-sonnet-5`, so set `claude-opus-5-5` / `claude-sonnet-5-5` via **By ID**. A stale dropdown is not a blocker. |
| **Forced tool choice is opt-in and off by default** | ⚠️ There is a `Force Tool Call on First Iteration` option, default `false`. **Leave it off.** Both chosen models reject forced `tool_choice` with a 400 — not a graceful fallback, a hard error. |
| **Thinking and effort are exposed** | `thinkingMode`: `disabled`/`adaptive`/`manual`; `effort`: `low`→`max` for Opus. Set adaptive; effort only appears once you do. |

**Still unverified, needs the owner:** whether their n8n Cloud **plan** includes the AI Agent node and the Supabase Vector Store node. That's licensing, not code — and if either is missing, the orchestration design changes. **Check this before building workflows.**

---

## 8. Implementation plans

Split into three because the subsystems don't need each other to be proven.

| Plan | Covers | Status |
|---|---|---|
| **1 — Deterministic core** | Schema, DSCR calculator, casefile validator, guardrail, policy engine, synthetic facilities | **Written**, not implemented |
| **2 — n8n workflows** | Ingest, Investigate, Review (§4.1, §4.2, §4.4) | Not written. Depends on plan 1 tasks 1 and 2. |
| **3 — UI and evals** | Analyst screens (§7), eval runner (§8) | Not written. Depends on 1 and 2. |

**Plan 1 needs no model calls, no n8n, and no network beyond the schema migration.** It's the cheapest place to build confidence, and it's where test-first genuinely pays.

**Execution method: subagent-driven** — the owner chose this. A fresh subagent implements each task, a fresh reviewer checks it before the next starts, then a whole-branch review. Use `superpowers:subagent-driven-development`. Don't re-ask per plan.

### The traps plan 1 exists to catch

The plan's **Review Focus** section lists five input classes the spec implies but doesn't pin down. Two of them are genuinely dangerous:

- **An add-back with no `cap` field means uncapped.** Read as zero and facility F1 flips from a correct resolve to a false escalation.
- **A number in the explanation that came from a quote, not a calculation, must be allowed.** A guardrail that only accepts calculated figures abstains on everything — the zero-false-resolve metric would read perfect while the product did nothing useful. This is the subtlest failure mode in the whole design.

---

## 9. What exists in the repo right now

```
.env.example                  every credential the project needs
.gitignore                    .env is excluded; verify before any commit
calc/                         empty — plan 1 task 2 fills it
guardrails/                   not yet created — plan 1 tasks 3-5
data/facilities/              empty — plan 1 task 6
n8n/                          empty — plan 2 (exported workflow JSON lives here)
ui/                           empty — plan 3
evals/                        empty — plan 3
supabase/config.toml          CLI config; migrations go in supabase/migrations/
docs/superpowers/specs/       the spec
docs/superpowers/plans/       plan 1
package.json                  npm test wired to node --test, no dependencies
```

**No application code has been written yet.** Nothing is half-finished.

Commit history is linear on `main`, one logical change per commit. The spec's own change history is worth reading:

```bash
git log --oneline -- docs/superpowers/specs/2026-10-01-creditscout-design.md
git diff 2b6005d HEAD -- docs/superpowers/specs/2026-10-01-creditscout-design.md
```

---

## 10. Hard constraints for anyone writing code here

- `calc/dscr.js` and `guardrails/*.js` must be **zero-dependency, import-free single files**. Their full text is pasted into n8n Code nodes, and spec §8.3 requires the n8n copy to be byte-identical to the repo copy. Each ends with a guarded `module.exports` so Node can load it and n8n ignores it. **Do not add imports to these files.**
- No test framework. `node:test` and `node:assert/strict` only.
- The calculator **never defaults a missing value to zero** and never infers. Missing input, denominator ≤ 0, and unknown component names all return `{error}`.
- `dscr` rounds **half-up** to 2dp. Not banker's rounding. The plan explains why a naive `value * 100` gets this wrong.
- `calc_id` is injected by the caller, never generated inside the pure function — that's what makes the tests deterministic.
- Embeddings are **1536-dimensional**. The schema's `vector(1536)` columns depend on it.
- Synthetic documents must carry the literal marker `SYNTHETIC — FOR DEMONSTRATION`. Borrower names are fictional. No real bank data, ever.
- Commit after every task. Conventional prefixes.

---

## 11. Open items — only the owner can close these

1. **§14.1 — do the six borrower twists ring true?** Plan 1 task 6 builds documents around them, so settle this before executing that task. Draft-then-react is fine; discovering they're unrealistic after generating six facilities' documents is not.
2. **n8n Cloud plan** — does it include the AI Agent and Supabase Vector Store nodes? Highest-value open question; it can change the design rather than just fill a blank.
3. **Expected DSCR values** — fill `data/expected-values-template.csv` once plan 1 task 6 generates it, and sign off each row.
4. **§14.2 — the 24 eval labels**, once drafted.
5. **Whether `max_steps: 8` is right.** Reasoned from §4.3's 2–6 step paths, but F1 is "~6 steps" and a re-mapping loop could plausibly need more. One-line change if it's too tight.
6. **Whether full `gpt-4.1` gets deployed** for the judge. Available, ample quota, bills per use only.

---

## 12. Working notes for agents

- **The owner owns the spec.** Propose changes; don't rewrite it unasked. Every spec edit so far was explicitly approved.
- **Don't frame work around the calendar.** The owner has said directly that deadline-framing everything isn't helpful. Focus on the deliverable.
- **Warn before long silent stretches.** Writing the 2,100-line plan in one go with no intermediate output drew a "why is this taking so long?" — reasonably. Prefer visible increments.
- **Ask precisely, recommend precisely, use bullets, avoid jargon.** A stated preference.
- **Confirm before anything destructive or billable.** Deleting a Supabase project, deploying a model, making the repo public — all the owner's calls.
- **Report honestly.** Where a number is an estimate rather than a measurement, say so. Several figures in this document are estimates and are labeled as such.
