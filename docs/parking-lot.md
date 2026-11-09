# CreditScout — Parking Lot

**Everything deferred, in one place.** Nothing here is dropped; it is parked with
a reason and a trigger for picking it back up.

**Opened:** 2026-10-05 · **Last updated:** 2026-10-07

| Status key | |
|---|---|
| 🔴 | Blocks the build or the demo |
| 🟠 | Needed before the pitch / submission |
| 🟡 | Post-MVP, first things to restore |
| ⚪ | Discuss when there's time |

---

## 1. Evidence and research gaps

> **Parked at the owner's request.** The `/prd` skill flags "no customer
> evidence" as the single biggest red flag in a PRD. The position below is
> deliberate and documented rather than hidden — but it is a real weakness and
> should be closed before anyone treats this as a fundable product rather than a
> course MVP.

| # | Item | Why it's parked | Owner | Revisit when |
|---|---|---|---|---|
| 1.1 | 🟠 **No analyst interviews.** `[NEED: 5 interviews with credit analysts at regional banks / credit unions]` | Can't be done inside the build window. Fabricating them was the only alternative, and that's worse. | Owner | Before design-partner outreach |
| 1.2 | 🟠 **No verbatim customer quotes.** `[NEED: 3+ quotes on covenant investigation pain]` | Same. Even three real quotes would move the PRD from opinion to evidence. | Owner | Before Launch gate |
| 1.3 | ⚪ **Domain input is n=1, and the author is also the product owner.** | The weakest form of user research. Stated plainly in PRD §1.3 rather than papered over. | Owner | When a second practitioner can review the twists and the labels |
| 1.4 | 🟠 **"Why now" claim unsupported.** `[NEED: SMB / middle-market delinquency trend data]` | Written as a mechanism ("exception volume rises when credit quality softens"), not as a measured trend. Do not assert it as fact in the pitch without data. | Owner | Before the pitch |
| 1.5 | ⚪ **No usage or support-ticket data.** | Structurally unavailable pre-launch. | — | After a design partner is live |
| 1.6 | ⚪ **Vendor benchmarks are marketing claims**, not independent studies. | Used directionally and labeled as such throughout. | — | If an independent study surfaces |

---

## 2. Unconfirmed numbers in the PRD

These are placeholders doing real work in the business case. Each is labeled as
an estimate in the document.

| # | Figure | Placeholder | What it drives | Owner |
|---|---|---|---|---|
| 2.1 | 🟠 Fully-loaded analyst cost per hour | **$60** | The ROI ratio. Conclusion holds from $40 (4×) to $80 (8×), so this is precision, not direction. | Owner |
| 2.2 | 🟠 Analyst hours per contested exception | **2.5** | North Star baseline. **Probably too low** — §9.7 derives a 4.3-hour *average* cycle, and a contested case should exceed the average. | Owner |
| 2.3 | 🟠 Target time-to-decision | **< 30 min** | The North Star target itself | Owner |
| 2.4 | ⚪ Share of US credit analysts at non-money-centre institutions | **~40%** | US SAM | Owner |
| 2.5 | ⚪ India domestic lender market (banks, NBFCs) | **Not sized** | §9.4 completeness. Deliberately left blank rather than guessed — needs primary research on Indian covenant practice. | Owner |
| 2.6 | ⚪ UK/EU/APAC scaling ratio | **~1.5–2× US** | Global SAM. Scaling assumption, not researched. | Owner |

---

## 3. Blocking the build or the demo

| # | Item | Owner | When |
|---|---|---|---|
| 3.1 | ✅ **Validate the three facility twists** (F1 Harbor Logistics, F3 Northgate Foods, F5 Coastal Marine) for credit realism. **Resolved 2026-10-05.** | **Owner** | Done |
| 3.2 | ✅ **Verify and sign off the expected DSCR values.** **Resolved 2026-10-07** — 10 rows signed (F1/F3/F5 + the five onboarding loans); the deterministic eval matches all 12 figures and is recorded in `eval_runs`. The runner still refuses to run on any unsigned row, and `generate()` refuses to overwrite a signed oracle. | **Owner** | Done |
| 3.5 | ✅ **Run the live cold + warm eval passes.** **Run twice 2026-10-08** (owner's go, billable). Exit 0 both times — **zero false resolves across all four passes**, calc accuracy 100%. Latest: outcome accuracy **60% cold / 60% warm** (target ≥85%); avg steps **7.0 cold / 8.0 warm**, so the **memory effect is negative and now cleanly measured** (run 2 had no cap deaths to confound it). Five onboarding cases skipped (never seeded, by design). The step-cap fix worked; rule 8 fixed the mechanism but not F1's outcome. Full numbers, fix verdicts and per-case causes: HANDOFF §0.6. Follow-ups: 7.7, 7.9–7.11. | Claude | Done |
| 3.3 | ✅ **Does Foundry Connected Agents work here?** **Resolved 2026-10-05 — yes, spiked live.** Orchestrator must be `gpt-4.1-mini`; `gpt-5-mini` is rejected for `connected_agent` tools. Delegation shows as a discrete run step, which is the trace the UI needs. Fallback not required. | Claude | Done |
| 3.4 | 🟠 Copy the cohort HHH evaluation spreadsheet and link it into PRD §6.1 | Owner | Before submission |

---

## 4. Post-MVP backlog — first things to restore

Cut to protect the demo build. Ordered by what I'd restore first.

| # | Item | Why it was safe to cut |
|---|---|---|
| 4.1 | 🟡 **Facilities F2, F4, F6** (ids still reserved; F7/F8/F9 were added 2026-10-08 as performing loans and deliberately did **not** take these ids) | F1/F3/F5 already cover resolve, escalate and the memory effect. F2 (period mismatch) and F4 (missing waiver) are the two that exercise `abstain`/`request` — restore these first, they carry a headline metric. |
| 4.2 | 🟡 **Eval set 10 → 24 cases** | 10 signed cases (5 quarterly tests + 5 onboarding loans) are enough to measure and catch regressions. We report 10 as 10 and never claim 24. F2/F4 would add the `abstain`/`request` cases the current set cannot measure. |
| 4.3 | ✅ **Covenant setup approval screen** | **Resolved 2026-10-05: being built, not pre-seeded.** The four-eyes control is a headline of the design and the owner chose to show it. |
| 4.4 | 🟡 **Governance & evals page** (4th screen, editable) | A static read-only panel carries the governance story. |
| 4.5 | 🟡 **Foundry groundedness judge** | Local metrics carry the trust claim. Independent scoring is stronger but not load-bearing. |
| 4.6 | 🟡 **Email intake** (US-011) | Workflow convenience; proves nothing about reasoning. |
| 4.7 | 🟡 **Policy editing in the UI** | Defaults live in the `policy` table; editing it is a DB update for now. |
| 4.8 | ⚪ Upgrade eval judge `gpt-4.1-mini` → full `gpt-4.1` | Billable, owner's call. A judge's credibility matters when the score is the evidence. |
| 4.9 | 🟡 **Make covenant-term extraction agentic (brainstorm first)** | Today onboarding's extraction (`proposeTerms` / the definition tool) is **single-shot RAG** over a fixed query set, backstopped by deterministic provenance checks + human approval — defensible, but not agentic. Brainstorm converting it to an **agent-driven retrieval loop** (decide what to read next: base definition → the amendment that restates it → re-extract), i.e. true agentic RAG *for setup*. Safe to cut for MVP: the verified single-shot extraction holds, and the orchestrator already demonstrates agentic RAG in the *investigation*. **At minimum, do the brainstorming** before building. |
| 4.10 | 🟡 **Memory and guardrail trace beats** (C and B) as first-class trace annotations — the "seen similar" lesson and the guardrail downgrade shown *inside* the orchestration arc, not only on the casefile. | Beat A (orchestration) was the pitch priority and is built; memory and the guardrail are already visible on the casefile and the review screen. |
| 4.11 | 🟡 **Onboard the five synthetic borrowers into the eval** — the harness skips a loan that is not in the database; onboarding Vantage Print Works live turns its breach into a fifth investigated case. | Deliberate: the packages stay un-seeded so onboarding genuinely creates the loan in the demo. |
| 4.12 | ⚪ **Citation hit rate** — add an `expected_key_citation` column to the oracle (owner-signed) so the metric can be measured; today it reads "—". | Not load-bearing for the gate; needs the owner to name the clause per case. |
| 4.13 | 🟡 **Keyboard-first triage on the Exceptions queue** (`J`/`K` move selection, `Enter` open, `E`/`V` decide, `U` re-run, `Z` undo ~5s, `?` shortcut sheet) | Owner's call, 2026-11-08, when the table redesign (`docs/superpowers/specs/2026-11-08-queue-redesign-design.md` §4.6) shipped. The UX research backs it well and it stays the natural next step once the table exists, but deciding a case still means clicking a button in `ReviewActions` for this round — no key listener, no undo mechanism, no auto-advance were built. |

---

## 5. Open product decisions

| # | Decision | Current position | Revisit when |
|---|---|---|---|
| 5.1 | ⚪ **Is $5/borrower/month under-priced?** | At ~6× ROI there's clear headroom; $8–12 would still land at 2.5–4×. Flat $5 is a deliberate land-and-expand choice. | After measured usage with a design partner |
| 5.2 | ⚪ **Volume tiering and a platform minimum** | Parked — premature before anyone has used the product. | With 5.1 |
| 5.3 | ⚪ **`max_steps: 8`** | Reasoned from 2–6 step expected paths. Now a `policy` row, so changing it is an update, not a redeploy. | After the first real investigations |
| 5.4 | ✅ **Orchestrator model** | **Resolved: `gpt-4.1-mini` as orchestrator (platform-forced — `gpt-5-mini` cannot carry the tool set), `gpt-5-mini` specialists.** No new deployment, no new billable resource. | Post-demo — see 6.1 |
| 5.5 | ⚪ **Does a chat interface belong in CreditScout?** | No. The unit of work is an investigation, not a conversation. Raised and set aside. | If analysts ask for follow-up Q&A on a casefile |

---

## 6. Experiments worth running (and reporting)

| # | Experiment | Why it's worth the cost |
|---|---|---|
| 6.1 | 🟡 **Does a stronger orchestrator beat `gpt-4.1-mini`?** **Owner decision 2026-10-06: parked, revisit after the demo.** The MVP runs `gpt-4.1-mini` as orchestrator (platform-forced) with specialists demoted to plain tools. Live evidence now exists to design the experiment against: F1 resolves in 7 of 8 steps; F3 needed ~10 under delegation and hit the cap in all four attempts. | A negative result — a cheap orchestrator holds accuracy because the guardrail is code — is the more interesting finding, and it is a model-selection artifact most people never produce. There is now a measured baseline to compare against rather than an assumption. |
| 6.2 | 🟡 **Guardrail ablation** — run the eval with guardrails disabled | Quantifies how many false resolves the code layer actually catches. **This is the single most persuasive number for the pitch** and it isn't currently planned into the run. |
| 6.3 | ⚪ Memory ablation (cold vs warm) | Already built into every eval run — no extra work |

---

## 7. Technical debt and known issues

| # | Item | Status |
|---|---|---|
| 7.1 | ✅ **Plan 1 Task 2 cannot pass as written** — `calc/dscr.js` used a guarded CommonJS export while the test imports it as ESM. | **Resolved during the build:** plain ESM `export`. Files stay zero-dependency and import-free. |
| 7.2 | ✅ **Spec §3 and §4 still describe n8n.** **Resolved 2026-10-06** — the amendments were applied and the last factual leftovers swept. |
| 7.3 | ✅ **Spec §8.3 sync check is obsolete** (byte-identical n8n copy). **Resolved** — removed with 7.2. |
| 7.4 | ✅ **Connected Agents is a preview feature** carrying the learning goal. | **Decided 2026-10-06 after the first working runs: take the fallback.** Not because the preview failed — `connected_agent` behaved exactly as the spike showed — but because **a connected agent cannot carry a function tool** (the parent run hangs). Specialists therefore cannot retrieve, so the orchestrator fetches evidence and pastes it, and each delegation spends a step asking for an opinion on text the orchestrator already holds. `gpt-4.1-mini` burnt 2–4 of its 8 steps that way and F3 hit the cap in all four attempts. Specialists demoted to plain tools on the orchestrator. |
| 7.7 | 🟠 **Outcome accuracy is 60% cold / 60% warm against a ≥85% target, and the memory effect runs backwards.** Measured twice (2026-10-08). Warm improved 40% → 60% after the step-cap raise; cold is unchanged at 60%. Every miss is conservative — abstain or request where resolve or escalate was wanted — so no false resolve and nothing unsafe. **The memory result is now clean:** steps rose 7.0 → 8.0 with **no cap deaths in run 2**, so the earlier cap confound is gone and the conclusion stands — warm memory adds roughly a step rather than saving one, and on F1 it actively degrades the answer (cold `request` → warm `abstain`). **The "memory shortens investigations" line must not be used.** Remaining causes are split out as 7.9 (3 of 4 misses), 7.10 and 7.11. | 🟠 Open, measured twice |
| 7.8 | ✅ **`resolve_requires_evidence` blocked a correct resolve on F1 — agent-side fix applied and now verified.** The agent reasoned correctly but ended its calculator sequence on the failing as-tested figure, and the guardrail judges "the last one logged" **by design** (`guardrails/guardrail.js` documents F1's shape as the case it means to allow). The guardrail was left untouched and the prompt fixed instead: ordering became its own **rule 8**, stating the consequence and the one-step remedy. **Run 2 confirms the mechanism is fixed — `resolve_requires_evidence` appears in none of the six casefiles, where it was F1's cause twice in run 1.** F1 still misses, but for unrelated reasons now tracked as 7.9 and 7.10. | ✅ Fixed, verified |
| 7.9 | ✅ **`figure_traceable` abstained on figures that are facts but not calculations. Fixed 2026-10-13.** The provenance was already stored — `runTest` records the quote and citation behind every figure on the originating calculation — it just was not passed to the guardrail. `chunksForCalcProvenance` now resolves those citations and `enforce.ts` adds them to the evidence set. Supplies the provenance rather than relaxing the check; pinned by a test that the same answer abstains without it and survives with it. **Not yet measured in a live eval.** Original diagnosis:  It caused **3 of run 2's 4 misses**: F3 in *both* passes on the borrower's reported **1.31**, and F1-warm on **620000** (the restructuring-charge amount). `exceptions.reported_dscr` is a database fact the runner injects into the query prompt ("the borrower reports 1.31"), but the guardrail only accepts a logged calculation or a verbatim quote from a cited document — so an agent that correctly *discusses* the figure is abstained for it. This is the CLAUDE.md known trap one layer out. **Fix by making the reported figure traceable (it has a provenance — the compliance certificate), not by relaxing the check.** The `620000` sub-case is different and needs its own answer: a document figure the agent paraphrased instead of quoting. | 🔴 Open — highest leverage |
| 7.10 | 🟠 **F1-cold chose `request` with no guardrail involvement.** Run 2, 7 steps, and the only `guardrail_notes` entry is a `schema` retry — nothing downgraded it. The agent reached `request` on its own judgement where the oracle wants `resolve`. Distinct from 7.8 (which was enforcement) and from 7.9 (which is traceability): this is a genuine prompt/judgement gap about when asking for documents beats resolving on the evidence already held. Needs prompt work on the `request` vs `resolve` boundary, and ideally an oracle case that *should* be `request` so the distinction is measurable at all (today `abstain_accuracy` reads "—" for exactly this reason). | 🟠 Open |
| 7.11 | 🟡 **Schema retries burn a step in 1 of 3 investigations.** Run 2 logged two: `calculations` returned as a non-array (F1-cold) and `suggested_tag` returned as `"unsupported_addback"`, outside the enum (F3-warm). The guardrail's `schema` check retries once on the same thread, which is the right behaviour, but each retry costs a step and partly explains why avg steps rose to 7.0/8.0. Cheapest fix is to name the `suggested_tag` enum values and the `calculations` array shape more forcefully in the prompt's output contract — not to widen the enum. | 🟡 Open |
| 7.12 | 🟡 **Covenant setup: the uncited-clause list removed from the proposal screen for the demo.** Owner call, 2026-10-08. *Clauses retrieved but not cited* was removed from the proposal flow only; the `not_found` screen keeps it, because reading those clauses is that screen's entire purpose. The approve bar's uncited counters went with it (`uncited` / `neverShown` / `opened` are gone from `OmissionCounts`), so the completeness caveat now rests on the loose-paragraph marks in the clause panel alone. **Restore or redesign after the demo** — `uncitedClauses()` in `components/termsReview.ts` and `components/UncitedClauses.tsx` are both untouched and still tested. ("Propose again" was briefly hidden too and then kept at the owner's call: it is the same button that reads "Extract covenant terms" on the onboarding path.) | 🟡 Deferred — restore after demo |
| 7.5 | ⚪ Supabase free-plan database sleeps after ~1 week idle | Daily use avoids it; Pro removes it for ~$25 |
| 7.6 | ⚪ Vercel function duration ceiling | Designed around — Foundry holds the long-running work |

---

## 7a. Security findings — `/security-foundation`, 2026-10-05

Run at build stage 3. Three of six areas had no code yet, so **this audit must be
re-run before deploy** (tracked as 8.5).

| # | Finding | Severity | Status |
|---|---|---|---|
| **S-1** | 🔴 **Covenant terms have no code guardrail — human review only.** A casefile's numbers are verified in code against `calc_log` or a verbatim quote. A *covenant term's* numbers are not verified at all: `validateTerms()` checks shape, and Approve only requires that a citation **exists**, not that the value appears in it. A term with a real citation and a wrong value passes. **Blast radius is every future test for that borrower**, silently, not one casefile. | **High** | Open — fix in F6 |
| **S-2** | 🟠 **`CREDITSCOUT_TOOL_KEY` can fail open.** The var is empty in `.env.example` with no generation step. A naive `header !== process.env.KEY` comparison **passes when both are undefined**. The tool routes would be publicly callable. | **Medium** | Open — fix in F5 |
| S-3 | ⚪ RLS, tool endpoints and file upload were unassessable — no code at stage 3 | Info | Re-run before deploy |
| S-4 | ⚪ "No Client Component imports the server client" passes **vacuously** — no Client Components exist yet | Info | Re-check at stage 9 |

**S-1 fix:** reuse `normaliseNumber()` from `guardrails/guardrail.js` — every
numeric value in `terms` must appear in its own `source_citations` quote. This is
the same check the casefile guardrail already performs, applied one layer
earlier, and it closes the asymmetry where the higher-blast-radius artifact has
the weaker defence.

**S-2 fix:** the route must **fail closed** — reject when `CREDITSCOUT_TOOL_KEY`
is unset, not only when the header mismatches.

---

## 7b. Agent findings — stage 8a, 2026-10-06

| # | Finding | Severity | Status |
|---|---|---|---|
| **A-1** | 🔴 **A false resolve the policy engine structurally cannot catch.** In a live diagnostic run, F3's orchestrator reproduced the borrower's unauthorised add-back to reach 1.31 and called the case resolved. `applyPolicy` judges the **last** calculation, whose margin is positive, so the deep-breach rule never fires. A prompt rule suppressed it — but a prompt is not a control, and this is the zero-false-resolve metric failing. | **High** | Fix in 8b: a calculation whose terms are not backed by a quoted clause must **block** (abstain/escalate), not merely flag |
| A-2 | 🟠 **`/api/investigate` is unauthenticated and now spends orchestration tokens per call.** An unauthenticated endpoint that costs money per request is a different class of problem from one that only reads. | Medium | Open — close before deploy |
| A-3 | ⚪ Agent output arrives **doubly escaped** (`\\u00a77.11`) and citations are sometimes composite (`"Fin Q2 2026 §1 and §2"`), neither of which the guardrail's verbatim matching or `resolveCitation` will accept as-is. | Info | 8b absorbs |

---

## 7c. Control review — 2026-10-14

Audited against the owner's five criteria (hierarchy, traceability, control,
density, operational trust). **Product decisions, not clean-ups — none of these
are bugs, and none were taken without a decision.**

| # | Finding | Why it is not just a UI fix |
|---|---|---|
| **7c.1** | 🟠 **No due date anywhere.** Nothing on the queue carries a deadline, an age or an "as of" — `exceptions` has `created_at` and no reporting deadline. An analyst cannot tell which of three breaches is oldest or what is overdue | Needs a field with an owner: a covenant certificate due date is a contractual term, so it belongs in `covenant_terms`, which means an extraction change and a re-approval |
| **7c.2** | 🟠 **No defer action.** Approve, override and hold-for-documents exist; there is no way to park a case to a date | Depends on 7c.1 — a defer with no date to defer *to* is a hidden backlog |
| **7c.3** | 🟡 **"Hold for borrower documents" takes no reason code**, where override requires a pattern tag, a corrected outcome and a rationale | The asymmetry is deliberate today (hold is reversible, override is the decision of record); if holds are to be audited they need the same treatment |
| 7c.4 | ⚪ **No confidence score, deliberately.** The product shows the *basis* instead — terms version, citation count, calculation count | A number nobody can calibrate invites exactly the deference the product exists to prevent. Recorded here so the absence is a decision, not an omission |
| 7c.5 | ⚪ The covenant is never **named** per queue row — it is implied by the `COMPUTED DSCR` column | Fine while DSCR is the only covenant; breaks the moment a second type lands |
| 7c.6 | ⚪ **Citation → highlighted passage** exists on the terms screen (clause panel) but not on the casefile, where a citation opens a claim list | The last substantive item from the 2026-10-13 briefs |

---

## 7d. Fixed 2026-10-14 — recorded so they are not re-found

Twelve code-review findings, all fixed in `3145c44`. The two that mattered:

- 🔴 **The session gate exempted `/api/*` wholesale**, leaving four
  browser-facing routes open on the deployed demo. Now an explicit list of the
  agent's key-gated routes, with a test that fails if one is added without
  `requireToolKey`. Verified in production.
- 🔴 **Open redirect on sign-in** — `safeNext` admitted `/\evil.com`, which
  browsers normalise to `//evil.com`.

And the one worth remembering: **the false-resolve gate read `cold ?? warm`**,
so a warm-pass false resolve exited 0 whenever cold was 0. The product's one
hard gate, satisfied by the run that did not fail.

---

## 8. Housekeeping

| # | Item |
|---|---|
| 8.1 | ⚪ Validate the new `/prd` skill against skill-authoring conventions (`superpowers:writing-skills`) |
| 8.2 | ⚪ Review the one-pager "as an engineer, as a designer, as a skeptic" — the `/prd` skill offers this |
| 8.3 | ⚪ Making the GitHub repo public — **owner decision, not made** |
| 8.4 | ⚪ Add a Stage 6 "Impact Review" section to the PRD after the demo, per the `/prd` skill's lifecycle |
| 8.5 | 🟠 **Re-run `/security-foundation` before deploy** — RLS, tool endpoints and file upload could not be assessed at stage 3. *Partly answered 2026-10-14: the route/auth surface was audited and fixed (7d); RLS and the upload path were not re-assessed.* |
