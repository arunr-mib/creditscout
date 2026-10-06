# CreditScout — Handoff

**For:** whoever picks this up next, human or agent, with no prior context.
**Written:** 2026-10-02 · **Rewritten against current state:** 2026-10-05 · **Updated:** 2026-10-06
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

Build sequence is `docs/engineering/engineering-doc.md` §9 — ten stages, each producing something runnable. Commits are tagged `feat(stage-N):`. **323 tests green**, `tsc` clean, `next build` passes.

| Stage | What | State |
|---|---|---|
| 0 | Supabase schema + RLS | ✅ live on cloud, anon-write verified blocked |
| 1 | `calc/dscr.js`, `guardrails/*.js` + tests | ✅ reviewed, seven findings fixed |
| 2 | Synthetic documents F1/F3/F5 + expected-values template | ✅ 16 documents, seeded, twist live |
| 3 | Next.js scaffold + design tokens + Supabase clients | ✅ builds, serves, no key leaks |
| 4 | `/api/ingest` + chunking + embeddings | ✅ **98 chunks live**, facility isolation proved over 360 calls |
| 5 | Agent tool routes + OpenAPI | ✅ S-2 closed, fail-closed auth, `calc_id` chain intact |
| 6 | Covenant setup — propose + approve | ◐ **6a backend in fix round 4**; 6b screen briefed, not started |
| 7 | Flow B part 1 — `/api/tests/run`, code only | ⬜ |
| 8 | Flow B part 2 — investigation, guardrail, policy | ⬜ |
| 9 | UI screens + review + memory | ⬜ |
| 10 | Deploy to Vercel + eval run | ⬜ |

**Stage 7 produces a working product with no agent at all** — ingest, approved terms, deterministic calculation, exception detection. If everything downstream collapses, that is still a demonstrable system, and it is what the kill switch degrades to in production.

### What is live in the cloud database

3 facilities · 16 documents · 98 `doc_chunks` · 3 **approved v1** `covenant_terms` · 1 stray `proposed` v2 on F3 from verification (governs nothing) · 1 stray `calc_log` row from verification (no casefile) · `doc_chunks` and memory search both callable.

**Both of F1's and F5's Amendment No. 2 are on file as documents with no matching terms row.** That is the covenant boarding lag, and it is the twist the whole demo rests on. Nothing — not the seed, not a fixture, not a verification script — may approve a v2 for those two facilities.

### Security findings

| # | State |
|---|---|
| **S-1** covenant terms unverified against their citations | **Closed in substance** by the provenance gate in `lib/terms.ts` + `guardrails/guardrail.js`; one residual scope hole in fix round 4 (see §9.2) |
| **S-2** `CREDITSCOUT_TOOL_KEY` fail-open | ✅ **Closed.** Fails closed on unset, empty and short keys; SHA-256 digests compared with `timingSafeEqual`; all three tool routes check before reading the body |
| S-3 / S-4 | Still unassessable until deploy. **`/security-foundation` must be re-run before stage 10.** |

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
| Azure chat models | ✅ `gpt-4.1-mini` and `gpt-5-mini` deployed; Connected Agents round trip spiked green |
| CLIs | ✅ `az` 2.90 (+ `ml` ext), `supabase` 2.119, `uv`, `gh`, `docker`, Node 24.8 (`engines` requires ≥22.18 — the `.ts` files run directly) |
| Supabase **CLI** token | ❌ **`SUPABASE_ACCESS_TOKEN` is dead** and regenerating it fails with the same `FGA Authentication Error`. Not blocking: migrations go to the owner as SQL for the dashboard editor, and everything else uses the service-role key. |
| Migrations | 0001–0005 applied at stage 0; **0006** `match_lessons` applied via the Management API before the token died; **0007** `covenant_terms_one_approved_per_facility` applied by the owner through the dashboard, 2026-10-06. 0006 and 0007 may not appear in `supabase_migrations.schema_migrations`. |

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
- **The owner's ruling on model-supplied terms:** the calculator tool accepts terms the model supplies, because the F1 twist requires the agent to re-map them mid-investigation. The guardrail compares the terms a calculation was logged against with the stored approved version and **flags any difference as a note on the casefile** — it does not block. The analyst sees "this number was computed on terms that differ from the boarded version" beside the recommendation.
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

1. **Do the three twists ring true?** (§5 above.) The documents exist now — read `data/facilities/F1|F3|F5/` and react to the real text rather than the description. This is the one thing no agent can judge.
2. **Expected DSCR values** — fill and sign off `data/expected-values-template.csv`. Five rows, both expected columns empty, every row `NO`. Computed in a spreadsheet, not copied from anything this code produces. The eval runner must refuse to run while any row says `NO`.
3. **The sixth eval case.** Five fall out of the quarterly tests the data produces; the parking lot allows six. A documents-missing variation is the candidate, since nothing else in the cut-down set reaches `abstain`.
4. **The eval labels**, once drafted (spec §14.2).
5. **`SUPABASE_ACCESS_TOKEN`** — dead, and regenerating it fails on Supabase's side. Only needed for CLI work; the SQL-editor route replaces it. Retry whenever, no rush.
6. **Whether `max_steps: 8` is right.** Now a `policy` row, so changing it is a database update, not a redeploy.
7. **Whether full `gpt-4.1` gets deployed** for the judge. Billable.
8. **Making the repo public.** Not decided.
9. **How four-eyes is described in the pitch** (§6). It is recorded, not enforced, and that distinction is worth stating before someone asks.

## 12. Working notes for agents

- **The owner owns the spec.** Propose changes; don't rewrite it unasked. Every spec edit so far was explicitly approved.
- **Execution is subagent-driven** (`superpowers:subagent-driven-development`) — the owner chose it; don't re-ask per plan.
- **Don't frame work around the calendar.** The owner has said directly that deadline-framing everything isn't helpful.
- **Warn before long silent stretches.** Prefer visible increments.
- **Ask precisely, recommend precisely, use bullets, avoid jargon.**
- **Confirm before anything destructive or billable.**
- **Report honestly.** Where a number is an estimate rather than a measurement, say so.
