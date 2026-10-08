# CreditScout — Handoff

**For:** whoever picks this up next, human or agent, with no prior context.
**Written:** 2026-10-02 · **Rewritten against current state:** 2026-10-05 · **Updated:** 2026-10-06 · **Current-state handoff (§0):** 2026-10-08
**Repo:** `arunr-mib/creditscout` (private) — `git@github.com:arunr-mib/creditscout.git` · **Live:** `https://credit-scout.vercel.app`
**Owner:** Arun Rajendiran (product, credit domain, all credentials, all sign-offs)

**Start at §0.** It is the current state and the next actions. §1–§5 are the
design reasoning (still true), §8–§9 are the gotchas and lessons (still true),
and the rest has been refreshed to 2026-10-08.

---

## 0. Current state — 2026-10-08 — START HERE

### 0.1 What is done

The product is **built, deployed and verified live** at `https://credit-scout.vercel.app`
(one Vercel project, deploys `main`; shared-credential demo gate,
credentials on the sign-in page). `main` = `b43abe5` at the time of writing.

| Area | State |
|---|---|
| Stages 0–10 (schema → deploy) | ✅ built. Engineering doc §9. |
| Stage 11 — **loan onboarding wizard** | ✅ built 2026-10-07, verified live with the five synthetic packages. Spec: `docs/superpowers/specs/2026-10-07-onboarding-flow-design.md`. |
| Investigation live on the deploy | ✅ Harbor re-run streamed real Foundry steps; the guardrail downgraded an unearned `resolve` to `escalate`; "seen similar" memory shown on Coastal. |
| Eval oracle | ✅ `data/expected-values-template.csv` — **10 cases, every row owner-signed 2026-10-07**. |
| Eval harness | ✅ `evals/run.mjs` + `evals/grade.mjs` (17 tests). `npm run eval` · `--write` · `--live`. |
| Deterministic eval pass | ✅ **run and recorded** — calculation accuracy **100%** (12/12 signed figures), code path 100%; `eval_runs` row (`mode: cold`, `pass: "deterministic"`) → the Governance scoreboard shows it, everything agent-level reads "—". |
| Live cold + warm eval passes | ✅ **run 2026-10-08** (owner's go; billable). `eval-20261008T031627Z-cold` + `eval-20261008T032008Z-warm`, exit 0. **Zero false resolves in both passes.** Calc accuracy 100%/100%; outcome accuracy **60% cold, 40% warm**; avg steps **6.3 cold, 7.3 warm**. The memory effect is **negative** — see §0.6. |
| Tests | 971/971 `npm test`, `tsc --noEmit` clean. |
| Docs | PRD, one-pager, mental model, HLD, LLD, parking lot, `CLAUDE.md` all refreshed to the built state (commits `9c18ebf`, `cf076c0`). |

### 0.2 Key decisions since 2026-10-06 (all owner-approved)

| Decision | Why | Where recorded |
|---|---|---|
| **Connected Agents dropped; specialists are in-process function tools** | A connected agent's inner run cannot carry a function tool, so specialists could not retrieve for themselves; delegations burnt 2–4 of 8 steps. One agent object remains: the orchestrator with six function tools. | parking-lot 7.4, HLD §4.1, `lib/agent/foundry.ts` |
| **"Credit-scout Agent"** is the orchestrator's name in every user-facing surface; **"loan"** not "facility" on screens (schema unchanged) | Owner's wording; analysts say loan. | PRD scope-changes table |
| **Trace redesigned to foreground orchestration** — arc header, per-step purpose annotations, decision markers, "delegated by the Credit-scout Agent" tags. Priority of pitch beats **A (orchestration) → C (memory) → B (guardrail)**; C and B trace beats parked (4.10). | The pitch objective is to show the orchestrator's power. | `components/traceModel.ts`, `TraceArc.tsx` |
| **Portfolio triage table** + "+ New borrower" + **dark-native depth, no shadows** (design.md bans `boxShadow`) | Borrowed from Covenant IQ's triage-at-a-glance; owner chose option A over shadows. | `components/PortfolioTable.tsx`, `portfolioModel.ts` |
| **Governing-first casefile** (test-period figure under the governing terms, amendment-status panel, *provisional* label on amendment-dependent narrative) | A credit-analyst reviewer asked for the governing number first. | `components/CasefileView.tsx`, `casefileModel.ts` |
| **Onboarding wizard**: route-driven, all documents uploaded in one step, review embedded in the wizard chrome (B), **effective date required** for agreement/amendment | Without the date, extraction 422s ("Cannot determine an effective date"). | onboarding spec §8, `components/UploadPackage.tsx` |
| **Lender renamed "Bank of Stoic"**; onboarding borrowers **Zhatsapp Inc, Marcus Tech, Orion Medical Supply, Petworks LLC, Vantage Print Works**; F1/F3/F5 keep their old names; the stray "Summit" facility in the DB stays (owner: "I won't touch it in the demo") | The prior lender name resembled a real bank. | `data/facilities.js` |
| **The five onboarding packages are never seeded** | Onboarding must genuinely create the loan live. The eval harness therefore *skips* them until onboarded (4.11). | onboarding spec §5 |
| **Eval set is 10 signed cases, reported as 10** (not 24); scoreboard grouped **Honest / Harmless / Helpful**; evals are **hybrid** — grading is deterministic Node code against the signed key, the investigations run on Azure, only groundedness goes to the Foundry judge | The safety numbers must not be judged by a model. | PRD §5.1/§6.1, HLD §11 |
| `generate()` **refuses to overwrite a signed oracle**; the drift test compares generator-owned columns only | `npm run generate:data` would otherwise erase the owner's values. | `data/generate.mjs`, `data/generate.test.js` |
| One Vercel project serving **`credit-scout.vercel.app`**; the duplicate project and its `*.vercel.app` host were deleted; deploy auth via service principal with the **"Foundry User"** role ("Azure AI User" does not exist in this subscription) | Two projects were both auto-deploying `main`. Refer to the deploy by its live host, never by a project slug — the slug is cosmetic and has already changed once. | `docs/engineering/deploy-runbook.md` |

### 0.3 What is left — in order

1. ~~**Run the live eval passes**~~ — ✅ **done 2026-10-08.** Numbers and
   per-case causes in §0.6. Exit 0, zero false resolves, calc accuracy 100%.
   Two `eval_runs` rows; the Governance scoreboard has cold + warm columns.
   To re-run: `npm run dev` (background; `PUBLIC_BASE_URL` is unset in `.env`
   so the agent's tool calls default to `http://localhost:3000` — confirm with
   `curl -s localhost:3000/api/tools/openapi | head -c 200`), `az` already
   logged in, then `npm run eval -- --live`. `--only F1-2026Q2` smokes one case.
   Exit 2 = false-resolve gate failed; 3 = calc accuracy < 100%.
   **The open follow-ups this run created are the real next items:**
   - **Outcome accuracy is 60% cold / 40% warm against a ≥85% target**, and the
     memory effect is negative (6.3 → 7.3 steps). Both misses are conservative,
     so nothing unsafe shipped — but the Helpful pillar does not currently meet
     its target and the "memory shortens investigations" line must not be used.
   - Three of six investigations ended at the **8-step cap**. Raising the cap,
     or spending fewer steps on retrieval, is the single highest-leverage fix.
   - F1 ends its calc sequence on the failing as-tested figure, so
     `resolve_requires_evidence` blocks a correct resolve. Either the agent
     should recompute-last under the amended terms, or the guardrail should
     consider the governing calc rather than the last-logged one. **Owner's
     call — this one touches a guardrail, so don't just loosen it.**
   - `figure_traceable` abstains on the borrower's own reported DSCR (see §0.6).
   - Known leftover: an aborted first attempt left one casefile `investigating`
     under `eval-20261008T031237Z-cold`. Ignore it; do not delete it.
2. ~~**Groundedness**~~ — ✅ **run 2026-10-08** via `npm run eval:groundedness`
   (`scripts/foundry-groundedness.mjs`: uploads each pass's `foundry-*.jsonl` as
   a Foundry dataset, then runs the built-in groundedness evaluator). **Warm
   scored 5.0/5 with 100% passed; cold is undefined** because its F3 row is the
   step-cap non-answer with empty context — full detail and the API gotchas in
   §0.6. Re-run after the next live eval, when F3-cold should be a real answer.
   Upgrading the judge to full `gpt-4.1` is parking-lot 4.8, billable, owner's call.
3. Parking-lot §4 in restore order (4.9 agentic extraction brainstorm, 4.10 trace beats, 4.11 onboard Vantage into the eval, 4.12 citation column).
4. Owner-only items in §11.

### 0.4 Files touched in the 2026-10-07 stretch (where to look)

| Area | Files |
|---|---|
| Evals | `evals/run.mjs`, `evals/grade.mjs`, `evals/grade.test.js`, `data/expected-values-template.csv` (signed), `data/generate.mjs` (+test), `package.json` (`eval`, test glob) |
| Onboarding | `app/borrowers/new/page.tsx`, `app/borrowers/[id]/onboarding/page.tsx`, `app/actions.ts` (`createLoan`), `lib/onboarding.ts` (+test), `lib/covenant-setup-data.ts`, `components/OnboardingStepper.tsx`, `NewBorrowerForm.tsx`, `UploadPackage.tsx`, `CovenantSetup.tsx`, `ProposeTrace.tsx` |
| Trace / casefile / portfolio | `components/traceModel.ts`, `TraceStep.tsx`, `TraceArc.tsx`, `LiveTrace.tsx`, `CasefileEvidence.tsx`, `CasefileView.tsx`, `casefileModel.ts`, `CalcValue.tsx`, `portfolioModel.ts`, `PortfolioTable.tsx`, `app/page.tsx`, `ReinvestigateButton.tsx` |
| Data | `data/facilities.js` (`LENDER_NAME`, `ONBOARDING_DEMO_FACILITIES`), `data/facilities/<ID>/` packages |
| Docs | `docs/prd.md`, `prd-onepager.md`, `mental-model.md`, `engineering/engineering-doc.md`, `engineering/implementation-specs.md`, `parking-lot.md`, `CLAUDE.md`, this file |

### 0.5 How to run things

| | |
|---|---|
| Tests | `npm test` (971) · `npx tsc --noEmit` |
| Deterministic eval | `npm run eval` (free) · `npm run eval -- --write` (records the row) |
| Live eval | `npm run dev` (background) then `npm run eval -- --live` (billable; see 0.3) |
| Groundedness | `npm run eval:groundedness` (billable; `--dry-run` is free, `--mode cold\|warm` for one pass). Needs a completed `--live` run first. |
| Regenerate synthetic docs | `npm run generate:data` — safe: will not touch the signed oracle |
| Deploy | push `main`; `vercel ls --prod` (run from the repo — `.vercel/` is linked); runbook in `docs/engineering/deploy-runbook.md` |
| DB | Supabase project `rngsejqplndmygrozasc` (cloud only); service-role key in `.env`; Supabase MCP for SQL. **Ask before any DELETE.** |

### 0.6 Live eval results — 2026-10-08 — read this before quoting any number

Run: `npm run eval -- --live`, exit code 0 (the false-resolve gate passed and
calc accuracy was 100%). Two `eval_runs` rows recorded; the Governance
scoreboard shows cold beside warm. Report in `evals/out/report.md`.

| Pillar | Metric | Target | Cold | Warm |
|---|---|---|---|---|
| Honest | Calculation accuracy | 100% | **100%** (12/12) | **100%** |
| Honest | Citation hit rate | ≥ 90% | — | — |
| Honest | Groundedness (judge) | reported | **unstable — see below** | **5.0 / 5, 100% passed** |
| Harmless | Zero false resolves | 0 | **0** | **0** |
| Harmless | Correct abstain / request | ≥ 90% | — | — |
| Helpful | Outcome accuracy | ≥ 85% | **60%** | **40%** |
| Helpful | Avg steps / case | visible reduction | **6.3** | **7.3** |

"—" is not measured, never a measured zero. Outcome accuracy is over the 5
gradeable cases (3 investigated + 2 code-only F5 periods), not over 10.

**Skipped, by design:** all five onboarding cases (ZHATSAPP, MARCUS, ORION,
PETWORKS, VANTAGE) — "not in the database". The packages are deliberately never
seeded so onboarding has to create the loan live (onboarding spec §5). Not a
failure; parking-lot 4.11 covers onboarding Vantage into the eval.

**Two things to be straight about.**

1. **Outcome accuracy is far below the ≥85% target**, and warm is worse than
   cold. Every miss is in the *conservative* direction — escalate or abstain
   where the oracle wanted resolve, or abstain where it wanted escalate. None
   is a false resolve. The safety claim holds; the helpfulness claim does not.
2. **The memory effect ran backwards.** Steps went *up* 6.3 → 7.3 and two of
   three warm cases hit the 8-step cap. The pitch line "visible step reduction
   from memory" is **not supported by this run** — do not assert it. The warm
   context appears to add work rather than shortcut it.

**Per-case causes (from `casefiles.guardrail_notes`, not inference):**

| Case | Pass | Got | Why |
|---|---|---|---|
| F1-2026Q2 | cold + warm | `escalate` | Guardrail `resolve_requires_evidence`: the agent asked to resolve, but **the last calculation logged is the failing as-tested one**, so "an earlier pass does not earn it". Its reasoning was *correct* — it found Amendment No. 2 and capped the $620k restructuring charges at $500k. It just ended its calc sequence on the wrong figure. Cold additionally hallucinated a `calc_id` (`f9f8e2b5…`, flagged `calc_id_unknown`). **This is not the uncapped-add-back trap — the cap was read correctly.** |
| F3-2026Q2 | cold | `abstain` | Policy `step_cap`: hit 8 steps before producing any answer. Pure budget exhaustion. |
| F3-2026Q2 | warm | `abstain` | Guardrail `figure_traceable`: unverified figure **1.31** — the borrower's reported DSCR. Its reasoning was otherwise exactly right (no add-backs permitted, the $530k "Owner compensation normalization" disallowed, waiver unexecuted). See the gap below. |
| F5-2026Q2 | cold | `resolve` ✓ | Correct, with a real `calc_id` for the remapped 1.30 and terms-drift flagged. |
| F5-2026Q2 | warm | `abstain` | Policy `step_cap` at 8 steps. It had the right answer and three logged calcs; it ran out of budget before emitting the final answer. |

**Groundedness — run 2026-10-08** (`npm run eval:groundedness`, judge
`gpt-4.1-mini`, built-in Foundry evaluator over `evals/out/foundry-*.jsonl`):

- **Warm: 5.0 / 5, `groundedness_passed` 1.0** across all three rows. Clean and
  internally consistent — every claim in all three explanations was judged
  supported by its retrieved context. This is the number to quote.
- **Cold: do not quote a number.** Two runs over *identical* data with an
  *identical* config returned mean 3.67 with 2/3 passed, then mean 5.0 with a
  0.67 binary aggregate and no `groundedness_passed` key at all. A mean of 5
  alongside a 0.67 pass rate is self-contradictory, so a row is being dropped
  from the mean but counted in the aggregate.
- **The cause is F3-cold, and it is our data, not the judge.** That row is the
  step-cap non-answer ("The investigation reached its step cap…") with an
  **empty context array** — there is nothing for groundedness to be measured
  against, so the evaluator has no defined answer and the aggregation differs
  run to run. The raised step cap should turn that row into a real answer; once
  it does, cold becomes measurable. Until then cold groundedness is undefined,
  not low.
- Per-row `instance_results.jsonl` is not reachable through the REST API
  (`/credential` and `/listSecrets` both 404) — read it in the Foundry portal
  under Evaluations.

**Fixes applied 2026-10-08, after the run and therefore NOT reflected in the
numbers above:**

| Fix | Where | Why |
|---|---|---|
| Step cap **8 → 12** | migration `0011_raise_step_cap.sql` (applied live), `DEFAULT_POLICY.max_steps` | Three of six investigations died at the cap and two already held the right answer. We were failing cases we had solved. |
| Prompt **rule 8** — the governing calculation must be the last one logged, with the one-step remedy | `lib/agent/prompt.ts`, pushed to the live Foundry agent (same id) | F1's miss, twice. The guardrail's "last one logged" rule is deliberate, so the agent was fixed rather than the guardrail. |
| Base URL derived from the platform | `lib/agent/openapi.ts` | Unrelated to the eval; removes a stale-hostname failure class. `PUBLIC_BASE_URL` deleted from Vercel production. |

**The next live eval re-measures everything in the table above.** The cap raise
also confounds the memory question — warm may have scored worse only because
the cap bit it harder — so treat cold-vs-warm as unsettled until it re-runs.

**A real gap this surfaced** (candidate for the parking lot, owner's call):
`exceptions.reported_dscr` is a *database fact* the runner injects into the
query prompt ("the borrower reports 1.31"), but `figure_traceable` only accepts
a logged calculation or a quote from a cited document. So an agent that
correctly discusses the borrower's own figure gets abstained for it. This is
the CLAUDE.md known-trap one layer out: the fix is to treat the reported figure
as traceable, not to loosen the guardrail.

**The guardrail is visibly doing real work:** across six investigations it
intervened three times (2× `resolve_requires_evidence` → escalate, 1×
`figure_traceable` → abstain) and let one true resolve through. The zero is
earned, not vacuous.

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
| `docs/engineering/engineering-doc.md` | Architecture (HLD) and the **build sequence, stages 0–11** (§9). The thing to read second. |
| `docs/engineering/implementation-specs.md` | File-by-file blueprint (LLD), features F0–F11, keyed to the build stages. |
| `docs/superpowers/specs/2026-10-07-onboarding-flow-design.md` | The loan onboarding wizard (stage 11 / F11). |
| `docs/parking-lot.md` | **Everything deferred, with a reason and a trigger.** Includes the security findings and the live-eval item (3.5). |
| `docs/design.md` | Design tokens. Teal = model step, amber = code step. **No shadows** — depth is dark-native. |
| `docs/prd.md`, `docs/prd-onepager.md`, `docs/mental-model.md` | Product framing for the pitch; the mental model carries the flow diagrams, demo storyboard and screen inventory. |
| `evals/run.mjs`, `evals/grade.mjs`, `data/expected-values-template.csv` | The eval harness and the owner-signed oracle. |
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

*(Refreshed 2026-10-08 — §0 is the summary; this is the per-stage detail.)*
Build sequence is `docs/engineering/engineering-doc.md` §9 — eleven stages, each producing something runnable. Commits are tagged `feat(stage-N):` / `feat(onboarding):` / `feat(ux):`. **971 tests green**, `tsc` clean, `next build` passes, deployed.

| Stage | What | State |
|---|---|---|
| 0 | Supabase schema + RLS | ✅ live on cloud, anon-write verified blocked |
| 1 | `calc/dscr.js`, `guardrails/*.js` + tests | ✅ |
| 2 | Synthetic documents F1/F3/F5 + expected-values template | ✅ 16 documents seeded, twist live; oracle **signed** (10 rows, incl. the 5 onboarding loans) |
| 3 | Next.js scaffold + design tokens + Supabase clients | ✅ |
| 4 | `/api/ingest` + chunking + embeddings | ✅ facility isolation proved |
| 5 | Agent tool routes + OpenAPI | ✅ fail-closed auth; specialists revised to in-process function tools (§0.2) |
| 6 | Covenant setup — propose + approve | ✅ propose/approve routes + screen; provenance gate (S-1) |
| 7 | Flow B part 1 — `/api/tests/run`, `run-quarter`, code only | ✅ |
| 8 | Flow B part 2 — investigation, guardrail, policy | ✅ verified live: unearned `resolve` → `escalate` |
| 9 | UI screens + review + memory | ✅ portfolio, casefile (two-column, governing-first), governance, documents/terms/lessons, global search, landing + demo gate |
| 10 | Deploy to Vercel + eval | ✅ deployed; harness built; deterministic pass recorded; **live passes pending (§0.3)** |
| 11 | Loan onboarding wizard | ✅ verified live with the 5 synthetic packages |

**Stage 7 produces a working product with no agent at all** — ingest, approved terms, deterministic calculation, exception detection. If everything downstream collapses, that is still a demonstrable system, and it is what the kill switch degrades to in production.

### What is live in the cloud database

3 seeded facilities (Harbor, Northgate, Coastal) + a stray "Summit" facility (owner: leave it) + any loans onboarded live through the wizard · their documents and `doc_chunks` (lender text updated to "Bank of Stoic") · **approved v1** `covenant_terms` on the seeded three · demo-run `tests`/`exceptions`/`casefiles`/`reviews` from the live demo · 1 `eval_runs` row (deterministic). Eval passes use `eval-*` run_ids and never touch the `demo` run.

**Both of F1's and F5's Amendment No. 2 are on file as documents with no matching terms row.** That is the covenant boarding lag, and it is the twist the whole demo rests on. Nothing — not the seed, not a fixture, not a verification script — may approve a v2 for those two facilities.

### Security findings

| # | State |
|---|---|
| **S-1** covenant terms unverified against their citations | **Closed in substance** by the provenance gate in `lib/terms.ts` + `guardrails/guardrail.js`; one residual scope hole in fix round 4 (see §9.2) |
| **S-2** `CREDITSCOUT_TOOL_KEY` fail-open | ✅ **Closed.** Fails closed on unset, empty and short keys; SHA-256 digests compared with `timingSafeEqual`; all three tool routes check before reading the body |
| S-3 / S-4 | Deploy-time findings. The deploy gates `/api/ingest`, `/api/investigate`, `/api/investigate/sync` and `/api/covenant-terms/approve` behind the tool key or Server Actions; the UI sits behind the shared-credential demo gate. A full `/security-foundation` re-run on the deploy is still worth doing before anything public. |

Known, deliberate limitation: **four-eyes is recorded, not enforced.** `approved_by` is a self-asserted string, nothing records who proposed, and the routes have no user auth, so nothing stops a proposer approving their own proposal. Auth is out of scope per spec §2. Say this plainly in the demo — maker-checker is a governance control, and claiming enforcement the code does not have is the kind of thing a credit risk officer probes first.

## 7. Environment state

Verified with live calls, not assumed.

| Thing | State |
|---|---|
| Private GitHub repo | ✅ `arunr-mib/creditscout` |
| Supabase project | ✅ `rngsejqplndmygrozasc`, `vector` 0.8.2 in schema `extensions`, 5 migrations applied |
| Supabase service key | ✅ read and write confirmed |
| Azure Foundry project | ✅ `creditscout` under account `contractreviewagent-resource`, resource group `AI_Learning`, eastus2 |
| Azure embeddings | ✅ `text-embedding-3-small`, **1536 dimensions** (the schema depends on this number) |
| Azure chat models | ✅ `gpt-4.1-mini` (orchestrator) and `gpt-5-mini` (specialists) deployed; Connected Agents spiked green then dropped (§0.2) |
| Vercel | ✅ one project serving `credit-scout.vercel.app`, deploys `main`; CLI logged in as `arunrmib-3989`; agent env vars incl. SP creds and `FOUNDRY_ORCHESTRATOR_AGENT_ID`. `PUBLIC_BASE_URL` no longer needs setting — the app reads Vercel's own production host, so a renamed project cannot strand the agent's tool calls |
| Local `.env` | ✅ Supabase + Azure OpenAI + tool key set; **`PUBLIC_BASE_URL` and the SP vars are unset** on purpose — locally the `az` CLI authenticates Foundry and tool self-calls go to `localhost:3000` (so a live eval needs `npm run dev` running) |
| CLIs | ✅ `az` 2.90 (+ `ml` ext), `supabase` 2.119, `uv`, `gh`, `docker`, Node 24.8 (`engines` requires ≥22.18 — the `.ts` files run directly) |
| Supabase **CLI** token | ❌ **`SUPABASE_ACCESS_TOKEN` is dead** and regenerating it fails with the same `FGA Authentication Error`. Not blocking: migrations go to the owner as SQL for the dashboard editor, and everything else uses the service-role key. |
| Migrations | 0001–0005 applied at stage 0; **0006** `match_lessons` applied via the Management API before the token died; **0007** `covenant_terms_one_approved_per_facility` applied by the owner through the dashboard, 2026-10-06. 0006 and 0007 may not appear in `supabase_migrations.schema_migrations`. |

**Not set up, deliberately:** local Supabase (see 4.3), n8n (dropped).

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

## 9. What the build has taught — do not relearn these

### 9.1 The guardrail fails in both directions, and the second one is invisible

The documented trap is a guardrail that accepts only *calculated* figures: it abstains on every well-formed explanation, because legitimate explanations quote figures from the covenant. The zero-false-resolve metric then reads perfect while the product does nothing.

Stage 6 produced one error of each kind in consecutive rounds. A fix for a false accept (`1.00` passing as the threshold for "not less than 1.25 to 1.00") introduced a false abstain ("EBITDA fell from 2,400,000 to 1,900,000" lost the leading `1` and abstained on a phantom `900000`). **Every rule in `guardrails/guardrail.js` must state in a comment what it refuses and what it must keep allowing, and cover both with tests.** A rule with only negative tests is half-tested.

### 9.2 Whoever chooses the scope defines the truth

The provenance gate asks "does this term's value appear in the evidence?" — and the answer depends entirely on what counts as the evidence. Three rounds each narrowed that scope, and the same bug reappeared one level up:

| Judged against | How it leaked |
|---|---|
| the quote | the proposer truncates its quote |
| the enclosing sentence | legal prose defeats sentence detection — `;`, `"Inc."`, first-occurrence matching |
| the cited chunk | the proposer picks the chunk |

**The model is the thing being checked; it must not select the evidence it is checked against.** Round 4's fix is for the server to locate the defining clause itself. If you are tempted to add one more special case to a scope heuristic, that is the signal the scope is wrong.

### 9.3 An approval gate that refuses correct work is worse than the bug it prevents

If the gate blocks terms that are right, the analyst cannot board a covenant at all, and the pressure moves to editing terms until the checker is satisfied — corrupting the artefact four-eyes exists to protect. Always test the refusal path **and** the acceptance path against the real corpus. A gate also needs a repair path: terms refused for a list-shaped reason could not be fixed, because the edit path only changed single values.

### 9.4 Carried into stage 8 — read before writing the casefile guardrail

- **Citations are matched by exact trimmed string**, not through `resolveCitation`. A claim citing `Amd 2 §3(a)` against a chunk returned as `Amd 2 §3` is dropped and forces an abstain — correct work, thrown away. Compare through the resolver.
- **Parenthesised figures are read as negatives**, so `"minimum (1.25x)"` abstains and `"(1.25 to 1.00)"` yields no figures. Same false-abstain class, predates stage 6.
- **Model-supplied terms — READ BOTH HALVES.** The calculator tool accepts terms the model supplies, because the F1 twist requires the agent to re-map them mid-investigation. The owner ruled that the guardrail **compares** the terms a calculation was logged against with the stored approved version and **flags a difference as a note**, rather than blocking — so the analyst sees "this number was computed on terms that differ from the boarded version" beside the recommendation.
  **Refined 2026-10-06 after a live run, and this half is not optional.** A difference that is **provenance-verified** — every value backed by a quoted clause — is flagged, as the owner decided. A difference that is **not** backed by a quoted clause must **block**: abstain or escalate, never flag. The reason is not theoretical: in a live diagnostic run the orchestrator reproduced the borrower's unauthorised add-back to reach 1.31 and called the case resolved, and `applyPolicy` could not catch it because it judges the *last* calculation, whose margin is positive. A prompt rule suppressed it — a prompt is not a control. Flagging alone permits the zero-false-resolve metric to fail silently.
- **Document search must pass `doc_types` for definition lookups.** Without it F1's compliance certificate outranks the credit agreement for "debt service coverage ratio minimum", and the definition agent reads the borrower's own figure instead of the covenant.
- **`resolveCitation` returns a null document for a citation with no prefix.** Never fall back to matching on section alone.
- **Memory search crosses facilities; document search never does.** A lesson is the lender's own judgement; document text is one borrower's confidential agreement. Memory also filters on `run_id`, or a cold eval pass sees warm lessons and the memory-effect metric measures nothing.

### 9.5 Process notes that saved real time

- **Stale docs mislead reviewers, repeatedly.** Three separate reviewers acted on n8n references after n8n was dropped; one instructed a fix be re-pasted into a Code node that had not existed for a day. Swept in `78ba2ed`; plan 1 now carries a stale banner because its code skeletons read well enough that people kept implementing from it.
- **Reviewers earn their cost here.** Every stage so far has had at least one finding that mattered, found by *reproducing* rather than reasoning — a 200-and-approved where a 422 was claimed, a test that passed because the model was never called, a regression introduced by the previous round's fix.
- **Live verification must not mutate the demo.** Propose-only against the cloud; the approve path is proved against an in-memory fake client that enforces the same unique index.

## 10. Hard constraints for anyone writing code here

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

## 11. Open items — only the owner can close these

1. ~~Do the three twists ring true?~~ **Done 2026-10-05.**
2. ~~Expected DSCR values~~ **Done 2026-10-07** — 10 rows signed; deterministic eval matches all 12 figures.
3. **An `abstain`/`request` eval case.** Nothing in the signed set reaches `abstain`, so that metric reads "—". A documents-missing variation (parking-lot 4.1 F2/F4) is the candidate.
4. ~~The eval labels~~ **Done** — in the same 10 rows.
5. **`SUPABASE_ACCESS_TOKEN`** — dead, and regenerating it fails on Supabase's side. Only needed for CLI work; the SQL-editor / MCP route replaces it. Retry whenever, no rush.
6. **Whether `max_steps: 8` is right.** A `policy` row; revisit with the live-eval step counts.
7. **Whether full `gpt-4.1` gets deployed** for the judge. Billable (parking-lot 4.8).
8. **Making the repo public.** Not decided.
9. **How four-eyes is described in the pitch** (§6). It is recorded, not enforced, and that distinction is worth stating before someone asks.
10. **The Vercel project slug** is cosmetic and is not recorded anywhere in the repo or docs on purpose — identify the deploy by its live host, `credit-scout.vercel.app`.
11. **Transcribe the oracle + HHH mapping into the cohort's evals spreadsheet** (parking-lot 3.4) before submission.

## 12. Working notes for agents

- **The owner owns the spec.** Propose changes; don't rewrite it unasked. Every spec edit so far was explicitly approved.
- **Execution is subagent-driven** (`superpowers:subagent-driven-development`) — the owner chose it; don't re-ask per plan.
- **Don't frame work around the calendar.** The owner has said directly that deadline-framing everything isn't helpful.
- **Warn before long silent stretches.** Prefer visible increments.
- **Ask precisely, recommend precisely, use bullets, avoid jargon.**
- **Confirm before anything destructive or billable.**
- **Report honestly.** Where a number is an estimate rather than a measurement, say so.
