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
| 3.5 | ✅ **Run the live cold + warm eval passes.** **Done 2026-10-08** (owner's go, billable). Exit 0 — **zero false resolves in both passes**, calc accuracy 100%/100%. Outcome accuracy **60% cold / 40% warm** (target ≥85%); avg steps **6.3 cold / 7.3 warm**, so the **memory effect is negative, not a reduction**. Five onboarding cases skipped (never seeded, by design). Full numbers and per-case causes: HANDOFF §0.6. Follow-ups split out as 7.7–7.9. | Claude | Done |
| 3.3 | ✅ **Does Foundry Connected Agents work here?** **Resolved 2026-10-05 — yes, spiked live.** Orchestrator must be `gpt-4.1-mini`; `gpt-5-mini` is rejected for `connected_agent` tools. Delegation shows as a discrete run step, which is the trace the UI needs. Fallback not required. | Claude | Done |
| 3.4 | 🟠 Copy the cohort HHH evaluation spreadsheet and link it into PRD §6.1 | Owner | Before submission |

---

## 4. Post-MVP backlog — first things to restore

Cut to protect the demo build. Ordered by what I'd restore first.

| # | Item | Why it was safe to cut |
|---|---|---|
| 4.1 | 🟡 **Facilities F2, F4, F6** | F1/F3/F5 already cover resolve, escalate and the memory effect. F2 (period mismatch) and F4 (missing waiver) are the two that exercise `abstain`/`request` — restore these first, they carry a headline metric. |
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
| 7.7 | 🟠 **Outcome accuracy is 60% cold / 40% warm against a ≥85% target, and the memory effect runs backwards** (6.3 → 7.3 avg steps; 2 of 3 warm cases hit the 8-step cap). Every miss is conservative — escalate/abstain where a resolve was wanted — so no false resolve and nothing unsafe. **Two fixes applied 2026-10-08, not yet measured:** the step cap is raised 8 → 12 (migration `0011`, live) and prompt rule 8 now makes the governing-calculation ordering explicit. **A fresh `npm run eval -- --live` is needed to see whether they land** — until then the 60/40 figures stand as the measured numbers and **the "memory shortens investigations" line must still not be used.** The cap raise also confounds the memory question: warm may have looked worse only because the cap bit it harder. | 🟠 Fixes in, re-run pending |
| 7.8 | ✅ **`resolve_requires_evidence` blocked a correct resolve on F1 — agent-side fix applied 2026-10-08.** The agent reasoned correctly (found Amendment No. 2, capped $620k restructuring charges at $500k) but ended its calculator sequence on the failing as-tested figure, and the guardrail judges "the last one logged" **by design** (`guardrails/guardrail.js` documents F1's shape as the case it means to allow). So the guardrail was left untouched and the prompt was fixed instead: rule 7 already said "must be the LAST one you ran" mid-sentence and `gpt-4.1-mini` ignored it twice, so ordering is now its own **rule 8**, states the consequence, and gives the one-step remedy (re-run the governing calc last). Reinforced in the work plan (step 5) and at the point of decision. Pushed to the live Foundry agent, same id. **Effect unmeasured until the next live eval.** | ✅ Fixed, re-run pending |
| 7.9 | 🟠 **`figure_traceable` abstains on the borrower's own reported DSCR.** `exceptions.reported_dscr` is a database fact the runner injects into the query prompt ("the borrower reports 1.31"), but the guardrail only accepts a logged calculation or a quote from a cited document — so F3-warm was abstained for correctly discussing it, despite otherwise exactly-right reasoning. This is the CLAUDE.md known trap one layer out. Fix by treating the reported figure as traceable, not by relaxing the check. | 🟠 Open |
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

## 8. Housekeeping

| # | Item |
|---|---|
| 8.1 | ⚪ Validate the new `/prd` skill against skill-authoring conventions (`superpowers:writing-skills`) |
| 8.2 | ⚪ Review the one-pager "as an engineer, as a designer, as a skeptic" — the `/prd` skill offers this |
| 8.3 | ⚪ Making the GitHub repo public — **owner decision, not made** |
| 8.4 | ⚪ Add a Stage 6 "Impact Review" section to the PRD after the demo, per the `/prd` skill's lifecycle |
| 8.5 | 🟠 **Re-run `/security-foundation` before deploy** — RLS, tool endpoints and file upload could not be assessed at stage 3 |
