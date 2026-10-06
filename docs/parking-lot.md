# CreditScout — Parking Lot

**Everything deferred, in one place.** Nothing here is dropped; it is parked with
a reason and a trigger for picking it back up.

**Opened:** 2026-10-05 · **Last updated:** 2026-10-05

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
| 3.1 | 🔴 **Validate the three facility twists** (F1 Harbor Logistics, F3 Northgate Foods, F5 Coastal Marine) for credit realism | **Owner** | Before synthetic document generation |
| 3.2 | 🔴 **Compute and sign off 3 expected DSCR values** in a spreadsheet. The eval runner refuses to run while any row says `NO`. | **Owner** | Before the eval runs — *not* before the build starts |
| 3.3 | 🔴 **Does Foundry Connected Agents (preview) work reliably here?** Fallback is demoting the three specialists to plain OpenAPI tools. | Claude | **First hour of the build** |
| 3.4 | 🟠 Copy the cohort HHH evaluation spreadsheet and link it into PRD §6.1 | Owner | Before submission |

---

## 4. Post-MVP backlog — first things to restore

Cut to protect the demo build. Ordered by what I'd restore first.

| # | Item | Why it was safe to cut |
|---|---|---|
| 4.1 | 🟡 **Facilities F2, F4, F6** | F1/F3/F5 already cover resolve, escalate and the memory effect. F2 (period mismatch) and F4 (missing waiver) are the two that exercise `abstain`/`request` — restore these first, they carry a headline metric. |
| 4.2 | 🟡 **Eval set 6 → 24 cases** | 6 is enough to measure and catch regressions. We report 6 as 6 and never claim 24. |
| 4.3 | ✅ **Covenant setup approval screen** | **Resolved 2026-10-05: being built, not pre-seeded.** The four-eyes control is a headline of the design and the owner chose to show it. |
| 4.4 | 🟡 **Governance & evals page** (4th screen, editable) | A static read-only panel carries the governance story. |
| 4.5 | 🟡 **Foundry groundedness judge** | Local metrics carry the trust claim. Independent scoring is stronger but not load-bearing. |
| 4.6 | 🟡 **Email intake** (US-011) | Workflow convenience; proves nothing about reasoning. |
| 4.7 | 🟡 **Policy editing in the UI** | Defaults live in the `policy` table; editing it is a DB update for now. |
| 4.8 | ⚪ Upgrade eval judge `gpt-4.1-mini` → full `gpt-4.1` | Billable, owner's call. A judge's credibility matters when the score is the evidence. |

---

## 5. Open product decisions

| # | Decision | Current position | Revisit when |
|---|---|---|---|
| 5.1 | ⚪ **Is $5/borrower/month under-priced?** | At ~6× ROI there's clear headroom; $8–12 would still land at 2.5–4×. Flat $5 is a deliberate land-and-expand choice. | After measured usage with a design partner |
| 5.2 | ⚪ **Volume tiering and a platform minimum** | Parked — premature before anyone has used the product. | With 5.1 |
| 5.3 | ⚪ **`max_steps: 8`** | Reasoned from 2–6 step expected paths. Now a `policy` row, so changing it is an update, not a redeploy. | After the first real investigations |
| 5.4 | ✅ **Orchestrator model** | **Resolved 2026-10-05: `gpt-5-mini` everywhere.** No new deployment, no new billable resource. | Post-demo — see 6.1 |
| 5.5 | ⚪ **Does a chat interface belong in CreditScout?** | No. The unit of work is an investigation, not a conversation. Raised and set aside. | If analysts ask for follow-up Q&A on a casefile |

---

## 6. Experiments worth running (and reporting)

| # | Experiment | Why it's worth the cost |
|---|---|---|
| 6.1 | 🟡 **Does a stronger orchestrator beat `gpt-5-mini`?** The MVP runs mini everywhere (owner decision, 2026-10-05), so the experiment is now "does paying more buy accuracy?" rather than "can the cheap one cope?" | A negative result — mini holds accuracy because the guardrail is code — is the more interesting finding, and it is a model-selection artifact most people never produce |
| 6.2 | 🟡 **Guardrail ablation** — run the eval with guardrails disabled | Quantifies how many false resolves the code layer actually catches. **This is the single most persuasive number for the pitch** and it isn't currently planned into the run. |
| 6.3 | ⚪ Memory ablation (cold vs warm) | Already built into every eval run — no extra work |

---

## 7. Technical debt and known issues

| # | Item | Status |
|---|---|---|
| 7.1 | 🔴 **Plan 1 Task 2 cannot pass as written** — `calc/dscr.js` uses a guarded CommonJS export while the test imports it as ESM under `"type": "module"`. | Fix during build: plain ESM `export`. Files stay zero-dependency and import-free. |
| 7.2 | 🟠 **Spec §3 and §4 still describe n8n.** `docs/eng.md` §11 lists the exact amendments; owner approval outstanding. | Fold in during the build rather than stopping to re-document |
| 7.3 | 🟠 **Spec §8.3 sync check is obsolete** (byte-identical n8n copy). | Delete with 7.2 |
| 7.4 | ⚪ **Connected Agents is a preview feature** carrying the learning goal. | Fallback documented (plain tools). Decide after the first working run. |
| 7.5 | ⚪ Supabase free-plan database sleeps after ~1 week idle | Daily use avoids it; Pro removes it for ~$25 |
| 7.6 | ⚪ Vercel function duration ceiling | Designed around — Foundry holds the long-running work |

---

## 8. Housekeeping

| # | Item |
|---|---|
| 8.1 | ⚪ Validate the new `/prd` skill against skill-authoring conventions (`superpowers:writing-skills`) |
| 8.2 | ⚪ Review the one-pager "as an engineer, as a designer, as a skeptic" — the `/prd` skill offers this |
| 8.3 | ⚪ Making the GitHub repo public — **owner decision, not made** |
| 8.4 | ⚪ Add a Stage 6 "Impact Review" section to the PRD after the demo, per the `/prd` skill's lifecycle |
