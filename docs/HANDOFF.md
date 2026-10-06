# CreditScout — Handoff

**For:** whoever picks this up next, human or agent, with no prior context.
**Written:** 2026-10-02 · **Rewritten against current state:** 2026-10-05
**Repo:** `arunr-mib/creditscout` (private) — `git@github.com:arunr-mib/creditscout.git`
**Owner:** Arun Rajendiran (product, credit domain, all credentials, all sign-offs)

Read this file, then the spec. Don't start coding until you've read both.

---

## 1. What this is

CreditScout is a decision-support agent for commercial credit analysts monitoring covenant compliance.

A rules engine can tell an analyst that a *reported* ratio is below its threshold. What it can't do is the work either side of that: compute the ratio independently from the covenant that is actually in force, and then run the investigation when the numbers disagree — find the definition across a long credit agreement and its amendments, recompute on the right basis, explain the gap against the borrower's own figure, and judge whether the evidence is good enough to resolve, escalate, or ask for more.

The scope is deliberately one covenant — **DSCR**, tested quarterly on a trailing-twelve-month basis — across three synthetic borrower facilities.

**It never makes a credit decision.** It recommends; a human analyst approves or overrides, and overrides become memory for later cases.

**Why it exists:** keystone project for the Maven "Master Agentic AI for PMs and FDEs" course, Cohort 10, and an AI PM portfolio piece. Pitch is a 3-minute pre-recorded video.

---

## 2. The one idea that explains every design decision

> **A reasoning layer decides what evidence to inspect next. A calculation layer never guesses. A human always approves.**

When you hit an ambiguous design question, resolve it by asking which side of that line the thing belongs on.

| Responsibility | Owner |
|---|---|
| Computing the DSCR independently each quarter, for every borrower | **Code** |
| Flagging an exception (**our** DSCR < threshold) | **Code** |
| Approving the executable covenant terms before they govern any test | **Human analyst, always** |
| Deciding what to inspect next | Model |
| Reading agreements, amendments, waivers, certificates | Model |
| Mapping the DSCR definition into structured terms | Model, schema-validated |
| **All arithmetic, comparisons, rounding** | **Code** |
| Forming hypotheses for a gap | Model |
| Judging evidence sufficiency | Model, bounded by code guardrails |
| **Guardrails, policy enforcement** | **Code** |
| **Final decision** | **Human, always** |

The practical consequence: the model is never allowed to produce a number. Every figure in an explanation must trace to a logged calculation or a verbatim quote from a cited document, or the guardrail forces the whole recommendation to `abstain`.

---

## 3. Key documents

| Path | What it is |
|---|---|
| `docs/superpowers/specs/2026-10-01-creditscout-design.md` | **The spec. Source of truth.** The owner owns this file. |
| `docs/engineering/engineering-doc.md` | Architecture and the **10-stage build sequence** (§9). The thing to read second. |
| `docs/engineering/implementation-specs.md` | File-by-file blueprint, features F0–F10, keyed to the build stages. |
| `docs/parking-lot.md` | **Everything deferred, with a reason and a trigger.** Includes the open security findings. |
| `docs/design.md` | Design tokens. Teal = model step, amber = code step. |
| `docs/prd.md`, `docs/prd-onepager.md` | Product framing for the pitch. |
| `docs/superpowers/plans/2026-10-02-creditscout-deterministic-core.md` | Plan 1 of the original three. **Stale** — six facilities, n8n, CommonJS. Useful code skeletons only. |
| `.env.example` / `.env` | Credentials. `.env` is gitignored. **Never commit it.** |

---

## 4. Decisions and the reasoning behind them

If you want to change one, you need to beat the reasoning, not just prefer something else.

### 4.1 Azure AI Foundry Agent Service orchestrates — reversed from n8n on 2026-10-05

The original build used n8n Cloud. That was reversed after a live spike. Foundry runs the loop natively with Connected Agents, so orchestrator-to-specialist delegation is visible and traceable in the Foundry portal; it closes the unresolved n8n Cloud licensing question; it removes the node-version and byte-identical-copy risks; and it makes the spec's production path the thing actually built rather than a roadmap slide.

**Everything n8n is dead:** the byte-identical Code-node copy rule, the Anthropic node settings, the prompt-caching lever, the AI Agent node licensing question. If you find a doc that still says n8n, it is out of date — fix it or flag it.

**Connected Agents is a preview feature.** Fallback if it misbehaves: demote the three specialists to plain OpenAPI tools on the orchestrator. Same behaviour, changes stage 8 only.

### 4.2 Models

| Role | Model | Reasoning |
|---|---|---|
| Orchestrator | `gpt-4.1-mini` | **Forced by the platform.** `gpt-5-mini` is rejected at agent-creation time for `connected_agent` tools — confirmed by live spike, not inference. |
| `document_agent`, `definition_agent`, `research_agent` | `gpt-5-mini` | They read and quote rather than judge, and every quote is code-verified anyway. |
| Eval judge | `gpt-4.1-mini` on Azure | Interim. Full `gpt-4.1` is available; upgrade before reporting final numbers, since a judge's credibility matters when the score is the evidence. Billable — owner's call. |

Both MVP models were already deployed, so neither is a new billable resource. Whether a *stronger* orchestrator buys enough accuracy to justify its cost is the post-demo experiment (`docs/parking-lot.md` §6.1) — a negative result is the more interesting finding.

### 4.3 Supabase must be cloud-hosted, never local

**Load-bearing — don't "optimise" it.** Foundry and Vercel are both remote and cannot reach a database on the owner's laptop. Local Supabase is fine for offline schema work; it can never be what the deployed system talks to.

### 4.4 Reusing an existing Supabase project

Project `rngsejqplndmygrozasc` (region `ca-central-1`, org "House of Credit"). The org is on the **free plan, which caps it at 2 projects, and both slots were already used**. Rather than delete anything, we reused the `contract-review-feedback` project; its leftover 2-row `feedback` table is harmless and was deliberately left in place. The dashboard name is cosmetic.

**Known risk:** free-plan databases sleep after roughly a week idle. Daily use avoids it. Pro removes the risk for ~$25 if a demo matters more.

### 4.5 End-to-end monitoring, not exception triage

Decided 2026-10-05. The original design read the borrower's reported DSCR and investigated only when *that* was below threshold — so a borrower whose arithmetic was wrong in their own favour was invisible. CreditScout now computes every test itself from approved terms, and the reported figure is evidence to reconcile against. This is what makes F3 reachable at all.

### 4.6 Covenant terms are approved by a human, versioned and effective-dated

Four-eyes. A setup error here would silently corrupt every future test for that borrower, and setup accuracy is a recurring loan-review audit finding. An amendment creates `version + 1` and supersedes; it never overwrites, because a Q1 test must stay reproducible against the terms in force in Q1.

### 4.7 Three facilities, not six

F1 Harbor Logistics, F3 Northgate Foods, F5 Coastal Marine. F2, F4 and F6 are parked in `docs/parking-lot.md` §4.1 — they are the two that exercise `request` and `abstain`, and they are first to restore. **Report the eval set as what it is. Six cases is six cases, never twenty-four.**

### 4.8 Financial figures are printed as labeled lines

Statement extraction is out of scope (SpreadSense's domain), but the calculator needs six inputs. Resolution: the synthetic financials document states each input as its own labeled line — `Consolidated EBITDA: 4,020,000`. The agent reads and cites them; the calculator never extracts or infers.

### 4.9 The owner computes the expected DSCR values

Not Claude, not the calculator. Stage 2 generates `data/expected-values-template.csv` with the expected columns empty; the owner fills them from a spreadsheet and flips `owner_signed_off` to `YES`. If the thing that grades the calculator is written by the same author as the calculator, the tests only prove it agrees with itself. **The eval runner must refuse to run while any row says `NO`.**

### 4.10 Private repo; publication is a separate decision

The owner has not decided to make it public. Don't decide for them.

---

## 5. The twists — what the synthetic data has to prove

| Facility | Period | Borrower reports | We compute | Mechanism | Outcome |
|---|---|---|---|---|---|
| **F1 Harbor Logistics** | Q2 2026 | 1.12 | **1.12** (agree, both fail) | Approved terms are v1; Amendment No. 2 (2026-04-01) is **on file but not boarded** | Resolve + re-board as v2, ~6 steps |
| **F3 Northgate Foods** | Q2 2026 | **1.31 — compliant** | **1.08 — breach** | Add-back with **no basis** anywhere in the documents. An unexecuted waiver *request* letter is on file, dated after the period, unsigned by the lender. | Escalate, ~4 steps |
| **F5 Coastal Marine** | Q4 2025 | 1.41 | 1.41 | Agree | Compliant, no action |
| **F5 Coastal Marine** | Q1 2026 | **1.38** | **1.29** | Borrower took the full $900k add-back; the agreement caps it at $500k. Both clear 1.25. | Variance logged, **not** investigated |
| **F5 Coastal Marine** | Q2 2026 | 1.30 | 1.12 | Same unboarded-amendment pattern as F1 | Resolve in ~3 steps on warm memory |

**F3 is the headline case.** The borrower reports compliant; nobody would have investigated. We compute a breach because we applied their actual covenant. Exception triage structurally could not reach it.

**Covenant boarding lag is the F1/F5 mechanism** and it is realistic — which is also why §4.1a requires four-eyes approval.

**Two traps live in this data:**

- **An add-back with no `cap` field, or `cap: null`, means uncapped.** Read as zero and F1 flips from a correct resolve to a false escalation.
- **Nothing may board F1's or F5's amendment** — not the fixture, not the generator, not the seed. Boarding it dissolves the twist and leaves nothing to investigate.

---

## 6. Where the build stands

Build sequence is `docs/engineering/engineering-doc.md` §9 — ten stages, each producing something runnable. Commits are tagged `feat(stage-N):`.

| Stage | What | State |
|---|---|---|
| 0 | Supabase schema + RLS | ✅ live on cloud, anon-write verified blocked |
| 1 | `calc/dscr.js`, `guardrails/*.js` + tests | ✅ 49 tests green, no model, no network |
| 2 | Synthetic documents F1/F3/F5 + expected-values template | ⏳ **next** |
| 3 | Next.js scaffold + design tokens + Supabase clients | ✅ builds, serves, no key leaks |
| 4 | `/api/ingest` + chunking + embeddings | ⬜ |
| 5 | Foundry agent + tool routes | ◐ spike passed; route handlers pending |
| 6 | Flow A — propose + approve covenant terms | ⬜ |
| 7 | Flow B part 1 — `/api/tests/run`, code only | ⬜ |
| 8 | Flow B part 2 — investigation, guardrail, policy | ⬜ |
| 9 | UI screens + review + memory | ⬜ |
| 10 | Deploy to Vercel + eval run | ⬜ |

**Stage 7 produces a working product with no agent at all** — ingest, approved terms, deterministic calculation, exception detection. If everything downstream collapses, that is still a demonstrable system, and it is what the kill switch degrades to in production.

**Two security findings are open** (`docs/parking-lot.md` §7a): S-1, covenant terms have no code guardrail — fix in F6, reusing `verifyTermsProvenance`; S-2, `CREDITSCOUT_TOOL_KEY` can fail open when unset — the route must reject rather than compare two undefineds. `/security-foundation` must be re-run before deploy; three of its six areas had no code to assess.

---

## 7. Environment state

Verified with live calls, not assumed.

| Thing | State |
|---|---|
| Private GitHub repo | ✅ `arunr-mib/creditscout` |
| Supabase project | ✅ `rngsejqplndmygrozasc`, `vector` 0.8.2 in schema `extensions`, 5 migrations applied |
| Supabase service key | ✅ read and write confirmed |
| Azure Foundry project | ✅ `creditscout` under account `contractreviewagent-resource`, resource group `AI_Learning`, eastus2 |
| Azure embeddings | ✅ `text-embedding-3-small`, **1536 dimensions** (the schema depends on this number) |
| Azure chat models | ✅ `gpt-4.1-mini` and `gpt-5-mini` deployed; Connected Agents round trip spiked green |
| CLIs | ✅ `az` 2.90 (+ `ml` ext), `supabase` 2.119, `uv`, `gh`, `docker`, Node 24.8 |

**Not set up, deliberately:** local Supabase (see 4.3), n8n (dropped). Vercel deployment is in scope but not yet done — stage 10.

---

## 8. Machine gotchas that will waste your time

These are real and were hit during setup.

1. **Homebrew cannot install new formulae on the owner's Mac.** macOS 27.0.1 is not a Homebrew Tier 1 configuration, so there are no prebuilt bottles, and the fallback source build fails because Command Line Tools are 16.4 where Xcode 27 wants 27.x. `azure-cli`, `supabase` and `uv` all failed this way.
   **Work around it** with prebuilt binaries into `~/.local/bin` (already first on PATH): GitHub release tarballs, vendor install scripts, or `uv tool install` for Python CLIs. Permanent fix if ever wanted: `sudo rm -rf /Library/Developer/CommandLineTools && sudo xcode-select --install`.

2. **Don't run several `brew install` commands in parallel** — they fight over Homebrew's portable Ruby.

3. **Azure CLI installed via `uv` can't add extensions until pip is injected.** `az extension add` shells out to pip, and uv tool venvs ship without it. The error is a useless "Pip failed with status code 1"; the real cause appears only under `--debug`.
   Fix: `uv pip install --python ~/.local/share/uv/tools/azure-cli/bin/python pip`, or `uv tool install azure-cli --with pip`.

4. **The Supabase dashboard has two different keys that are easy to confuse.** `sbp_...` is a personal access token for the CLI. The database service key is a JWT starting `eyJ` (or `sb_secret_...`). Both are in `.env` under the right names.

---

## 9. Hard constraints for anyone writing code here

`CLAUDE.md` carries the authoritative list and is loaded automatically. In short:

- `calc/dscr.js` and `guardrails/*.js` are **zero-dependency and import-free**, ending in a plain ESM `export`. Never add imports.
- No test framework. `node:test` + `node:assert/strict`. `npm test`.
- The calculator **never defaults a missing value to zero** and never infers. Missing input, denominator ≤ 0, unknown component → `{error}`.
- `dscr` rounds **half-up** to 2dp. Not banker's rounding.
- `calc_id` is injected by the caller, never generated inside the pure function.
- Embeddings are **1536-dimensional**.
- Synthetic documents carry the literal marker `SYNTHETIC — FOR DEMONSTRATION`. Fictional borrowers. No real bank data, ever.
- Commit after every task, conventional prefixes.

---

## 10. Open items — only the owner can close these

1. **Do the three twists ring true?** (§5 above, spec §14.1.) Stage 2 builds documents around them. Draft-then-react is the agreed approach — react to the generated documents.
2. **Expected DSCR values** — fill and sign off `data/expected-values-template.csv` once stage 2 generates it. The eval runner refuses to run while any row says `NO`.
3. **The eval labels**, once drafted (spec §14.2).
4. **The sixth eval case.** Five come from the quarterly tests the data produces; the parking lot allows six. The obvious candidate is a documents-missing variation that exercises `abstain`, which nothing else in the cut-down set reaches.
5. **Whether `max_steps: 8` is right.** Now a `policy` row, so changing it is a database update, not a redeploy.
6. **Whether full `gpt-4.1` gets deployed** for the judge. Billable.
7. **Making the repo public.** Not decided.

---

## 11. Working notes for agents

- **The owner owns the spec.** Propose changes; don't rewrite it unasked. Every spec edit so far was explicitly approved.
- **Execution is subagent-driven** (`superpowers:subagent-driven-development`) — the owner chose it; don't re-ask per plan.
- **Don't frame work around the calendar.** The owner has said directly that deadline-framing everything isn't helpful.
- **Warn before long silent stretches.** Prefer visible increments.
- **Ask precisely, recommend precisely, use bullets, avoid jargon.**
- **Confirm before anything destructive or billable.**
- **Report honestly.** Where a number is an estimate rather than a measurement, say so.
