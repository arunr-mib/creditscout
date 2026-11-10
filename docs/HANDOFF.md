# CreditScout — Handoff

**For:** whoever picks this up next, human or agent, with no prior context.
**Written:** 2026-10-02 · **Rewritten against current state:** 2026-10-05 · **Updated:** 2026-10-06, 2026-10-08 · **Current-state handoff (§0):** 2026-10-14, with a 2026-11-07 redesign entry and a 2026-11-10 queue-redesign entry at the top
**Repo:** `arunr-mib/creditscout` (public as of 2026-11-10) — `git@github.com:arunr-mib/creditscout.git` · **Live:** `https://credit-scout.vercel.app`
**Owner:** Arun Rajendiran (product, credit domain, all credentials, all sign-offs)

**Start at §0.B.** It is the most current state. §0.A and §0.0 below it are
each still-true records of their own moment; §1–§5 are the design reasoning
(still true), §8–§9 are the gotchas and lessons (still true), and §0.1–§0.6
are the 2026-10-08 build-out record, still accurate on the agent, the evals
and the data.

---

## 0. Current state — 2026-10-14 — START HERE

### 0.B Queue redesign + casefile UI pass — 2026-11-08 to 2026-11-10 (UI only)

The Exceptions home screen (renamed **Credit Analysis Queue** on-page; every
nav tab, breadcrumb and internal reference still says "Exceptions") moved
from a kanban-only board to a dense, risk-sorted table by default, with
kanban kept as a toggle over the same rows. Built subagent-driven from
`docs/superpowers/specs/2026-11-08-queue-redesign-design.md` and
`docs/superpowers/plans/2026-11-08-queue-redesign.md`, then taken through two
further rounds of owner review directly against a live Preview. **Nothing
about the agent, the calculator, the guardrails, the schema or the eval
harness changed** — this is the analyst-facing surface only.

| What | State |
|---|---|
| Where it is | Branch `arunr-mib/creditscout`, commits `5bb2b44`..`fede842` |
| **Production** | **Unchanged** — still runs the 2026-11-07 Forest look. Waits on an explicit `vercel --prod`, the owner's call |
| **Preview** | **Live**, auto-updating on every push via Vercel's git integration: `https://creditscout-nrb7-git-arunr-mib-f7de81-arun-rajendirans-projects.vercel.app` — bookmark this one, not a one-off `vercel deploy` URL, which goes stale the moment a newer deploy lands |
| Spec | `docs/superpowers/specs/2026-11-08-queue-redesign-design.md` |
| Plan | `docs/superpowers/plans/2026-11-08-queue-redesign.md` |

**What changed for the analyst**

- **Table is the default view.** Risk-sorted — worst headroom (`computed − required`, labelled "Variance") first, a declining-DSCR tie-break second, then by how far the borrower's own reported figure strays from the computed one. Kanban is one click away via a Table/Kanban toggle, same filtered rows either way.
- **The five status filters live in the portfolio rail**, not the table body — a left-nav list of All loans/Needs review/Breaches/In compliance/Terms approval with icons and counts, driven by `?filter=` on the URL so the rail and the table stay in sync across the layout boundary. This applies only on the Exceptions page itself; Documents, Covenant terms, and casefile pages keep the rail's original per-loan list.
- **Kanban gained a fifth lane**, "Also in the book," so compliant and untested loans stop silently vanishing from the board — the deal pipeline used to hide 4 of 7 loans.
- **The casefile's recommendation card is leaner.** The Computed/Reported/Minimum DSCR header strip (and its `calc_id` citation badge) is gone — the page goes straight from the borrower name into the recommendation. The card's own facts row carries Test result and Reporting period instead. Decision buttons read "Approve" / "Override" / "Hold for borrower documents," no mandatory-signoff caption beneath them; the re-run control moved into that same card's header.
- **Findings layout rebalanced.** Investigation findings and Supporting evidence sit side by side; Outstanding review items is its own full-width row below both, not stacked under Supporting evidence where it used to run far taller than the findings column beside it.
- **Filter-category icons redrawn** — lighter stroke, consistent circle/rounded-square containers, replacing a first pass that read as a generic default icon set.
- **Covenant terms**: the version-history link sits inline next to the borrower name now, not on its own line below it.

**Decided during the build** (state these as settled)

- `Escalate` keeps `danger` (red) ink in the table's status column; `Resolve` stays neutral. The project's color rule bars *green* from claiming an unrecorded resolution — it says nothing against red flagging urgency, which is what danger ink already means everywhere else on that row.
- "Policy-directed recommendation" (not "CreditScout recommends") is correct, not a bug, whenever a code guardrail overrode the agent's own draft answer — the eyebrow states who is actually responsible for the recommendation shown.
- The `calc_id` provenance citation under a DSCR figure, and the kanban's "computed by code" badge, are intentionally retained elsewhere even though the casefile header's copy was removed — they're the product's visible proof that a number traces to a logged calculation, not decorative chrome.

**Still open — two owner calls from the plan's final review, not yet decided:**

- Whether a *decided* breach should rank above open exceptions in the risk sort (today it does, by raw headroom, same as everything else — a deliberate, tested choice during the build, but in tension with how a risk-sorted triage queue reads).
- Which direction the final sort tie-break (`|reported − computed|`) should favor — the original research flagged this explicitly as needing confirmation before shipping and it was never resolved either way.

**Next (owner)**

- Decide the two open sort-order questions above, if either matters before more people see this.
- `vercel --prod` when ready — Preview has had two full rounds of owner review plus a fresh `npm test`/`tsc`/`npm run build` pass, all clean.

---

### 0.A Forest redesign — 2026-11-07 (UI only)

After a demo, the owner's manager said the functionality was good but the UI
"looks like a usual vibe-coded app". The signed-in workspace was restyled and
re-laid-out. **Nothing about the agent, the calculator, the guardrails, the
schema, the API routes, the eval harness or the oracle changed.** The rest of §0
below (dated 2026-10-14) is still true except where it describes the look: the
"Palette", "Typography" and "Queue" rows of §0.0 are superseded by this entry.

| What | State |
|---|---|
| Where it is | Built on branch `arunr-mib/creditscout`, the build tasks in the plan, commits `docs(redesign)` / `feat(redesign)` / `fix(redesign)` |
| **Production** | **Unchanged.** `https://credit-scout.vercel.app` still runs the old look. Production only changes on an explicit `vercel --prod`, and that waits for the owner to sign off the walkthrough below |
| **Preview** | **Deployed and live**, all 8 of production's extra env vars copied across (4 of them Vercel "sensitive" — write-only, owner supplied the values). URL changes on every redeploy; ask if it's not at hand |
| Spec | `docs/superpowers/specs/2026-11-07-forest-redesign-design.md` |
| Plan | `docs/superpowers/plans/2026-11-07-forest-redesign.md` |
| Mockups | `docs/design-mockups/2026-11-07-forest/` (open in a browser). `forest-sky-pipeline-and-case.html` is the approved direction |
| Design system | `docs/design.md` rewritten (§1–§5, change log in §9) |

**What changed for the analyst**

- **Header band + tabs replace the dark left rail.** Tabs: Exceptions, Documents, Covenant terms, Lessons, Governance. Search (⌘K) and the avatar menu sit on the right. A logo mark sits left of the wordmark, added 2026-11-08.
- **A collapsible portfolio rail** lists every loan with a status dot, its computed DSCR and a second line. `[` toggles it (not inside text fields); the choice is remembered in `localStorage` (`cs.rail.collapsed`) and overrides the per-tab defaults. On Documents and Covenant terms a click filters to the loan.
- **The queue table is now a four-lane deal pipeline**: Needs investigating, CreditScout working (sky), Awaiting your decision, Decided. An `investigating` card links to its casefile, because the live run is driven by that page.
- **Land and sky.** Sky (the gradient and the blue CreditScout tag) marks only what the agent produced. Mint marks only what you can click. Neither is a status. Amber, red and green keep their old meanings.
- **Type, revised 2026-11-08: one face, Inter, everywhere** — UI, headings, the wordmark, figures and dates (`tabular-nums`), on `/welcome` and `/login` too. Bricolage Grotesque was tried for one day and retired after the owner compared it against the pre-redesign screen; `font-brand` is now an alias for `font-sans`. JetBrains Mono stays for identifiers.
- **No coloured left-border accent stripes** on notice/alert cards, removed 2026-11-08 as the most recognisable "generated dashboard" tell. Status carries by text and an icon only.
- **The casefile's decision block sits directly under the recommendation card**, not after the findings — accepting or overriding no longer needs a scroll past the evidence.
- **Rail wording:** "Pass" → "In compliance".

**Decided during the build** (state these as settled)

- Muted text is `#566D61`. The mockups' `#6E8679` fails WCAG AA (3.93:1).
- Neutrals are CSS variables (`--c-*`). `theme-forest` on the workspace `<body>` switches them; `/welcome` and `/login` keep the classic values and teal. `lib/ui/palette.test.js` keeps `palette.ts` and `globals.css` in step and checks contrast.
- The casefile identity line shows no loan id; the schema has no short loan code.
- `components/workspaceTokens.test.js` fails if a retired teal or dark-shell class (`model*`, `sunken`, `night*`) appears in workspace code.
- **A trap caught live:** the logo's first cut used `h-7 w-7`. `7` is not in the replaced spacing scale, so it silently compiled to nothing and the SVG rendered unconstrained. `h-6 w-6` is correct — see CLAUDE.md's warning on this exact failure mode.

**Next (owner)**

- Continue the Preview walkthrough: sign in, pipeline, investigate (watch it cross the sky lane), casefile, decide, documents, terms approval, onboarding, lessons, governance.
- Then, and only then, `vercel --prod`.
- The preview shares production's database and Foundry agent, so an investigation run there also appears on the live site.

---

### 0.0 What changed since 2026-10-08

Nothing about the agent, the calculator, the guardrails, the schema or the
oracle changed. **Everything in this section is the analyst-facing surface, one
security fix, and the docs.**

| Area | State |
|---|---|
| Tests | **1,139 / 1,139** `npm test`, `tsc --noEmit` clean, `npm run build` clean |
| Live | `https://credit-scout.vercel.app`, deployed from `arunr-mib/creditscout` via explicit `vercel --prod` |
| **Palette** | **Light workspace, graphite shell, one deep-teal accent.** Dark-native was dropped 2026-10-13 — the rooms analysts work in are lit, and the dark build read as a developer tool. The `night-*` tokens survive for the nav rail and the marketing pages. `docs/design.md` §2 is the truth |
| **Typography** | One family. **Figures and dates are Inter with `tabular-nums`; monospace is reserved for identifiers** (`calc_id`, citations, field paths, tool names). A verbatim clause is prose, not code. `docs/design.md` §3 |
| **Queue** | One table, 64px rows, exactly one *next action* per row; summary strip; filter tabs. `COMPUTED DSCR` / `REPORTED DSCR` / `MINIMUM` / `COVENANT TEST RESULT` / `REVIEW STATUS` / `NEXT ACTION` |
| **Casefile** | Rebuilt to the owner's reference composition. Recommendation card **381px → 174px** in one header row; the duplicate metric strip deleted; findings as rows, not a numbered timeline; **supporting evidence is the documents themselves**, each linking to its indexed source; whole page ~1300px → **1000px** |
| **Live investigation** | Exception-context strip; per-activity state (Completed / Needs input / In progress); **one amber notice that distinguishes the three recovery cases** (input omitted from the request · passage absent from filed documents · document never uploaded); connection health reported separately from run state |
| **Covenant terms** | *What this proposal changes* — Term / Approved vN / Proposed vN+1 / Source, aligned **by name** not index; review checklist grouped by consequence; approval states its effect and offers (never prefills) the signed-in name |
| **Documents** | A document title opens it. The uploaded FILE is not retained — the preview is reconstructed from indexed chunks, in order, via `doc_chunks.metadata.chunk_index`, and the page says so |
| **Onboarding** | Step 1 is **borrower details AND documents on one screen**; one primary button creates the borrower and uploads in a single gesture, so an abandoned form no longer leaves an empty borrower behind |
| **Uploads** | One row per file, each with its own type, date and state (Not uploaded → Uploading and indexing → Ready / Failed), per-file retry, real 10 MB limit stated up front |
| **SECURITY — fixed 2026-10-14** | The session gate exempted `/api/*` wholesale, leaving `/api/tests/run`, `/api/tests/run-quarter`, `/api/covenant-terms/propose` and `/api/casefiles/[id]/trace` **open on the deployed demo**. The exemption is now an explicit list of the agent's own key-gated routes, with a test that fails if one is added without `requireToolKey`. `/api/review` was on that list with no key and now has one. Verified in production: `/api/tests/run` → 307, `/api/review` → 401 |
| **SECURITY — fixed 2026-10-14** | `safeNext` admitted `/\evil.com`, which browsers normalise to `//evil.com` — an open redirect on sign-in. One hardened implementation in `lib/auth/gate.ts`, shared by the action and the page |
| Code review | 12 findings raised 2026-10-14, **all 12 fixed** in `3145c44` with 10 new tests |
| Diagrams | Regenerated 2026-10-14 (teal, the session/key boundary, `chunk_index`, the one-screen onboarding step) |

**What did NOT change, and is still the 2026-10-08 record below:** the agent and
its six tools, `calc/dscr.js`, `guardrails/*.js`, the schema, the six seeded
loans, the signed oracle, and every eval number in §0.6.

**Still open, unchanged:** outcome accuracy 60% against a ≥85% target
(parking-lot 7.7), blocker 7.10, and the eval has **not** been re-measured live
since `chunksForCalcProvenance` landed (~$0.20, billable, owner's call).

**New, from the 2026-10-14 control review** — product decisions, not clean-ups:
no **due date** exists anywhere in the data model or the queue; there is no
**defer** action; and *Hold for borrower documents* records a state with **no
reason code**, where override requires one.

---

### 0.1 What was done by 2026-10-08

The product is **built, deployed and verified live** at `https://credit-scout.vercel.app`
(one Vercel project, deploys `main`; shared-credential demo gate,
credentials on the sign-in page). Production deploys from branch
`arunr-mib/creditscout`, but **only via an explicit `vercel --prod`** — the
project's production branch is `main`, so a push to this branch builds a
Preview and nothing else.

| Area | State |
|---|---|
| Stages 0–10 (schema → deploy) | ✅ built. Engineering doc §9. |
| Stage 11 — **loan onboarding wizard** | ✅ built 2026-10-07, verified live with the five synthetic packages. Spec: `docs/superpowers/specs/2026-10-07-onboarding-flow-design.md`. |
| Investigation live on the deploy | ✅ Harbor re-run streamed real Foundry steps; the guardrail downgraded an unearned `resolve` to `escalate`; "seen similar" memory shown on Coastal. |
| Eval oracle | ✅ `data/expected-values-template.csv` — **10 cases, every row owner-signed 2026-10-07**. |
| Eval harness | ✅ `evals/run.mjs` + `evals/grade.mjs` (17 tests). `npm run eval` · `--write` · `--live`. |
| Deterministic eval pass | ✅ **run and recorded** — calculation accuracy **100%** (12/12 signed figures), code path 100%; `eval_runs` row (`mode: cold`, `pass: "deterministic"`) → the Governance scoreboard shows it, everything agent-level reads "—". |
| Live cold + warm eval passes | ✅ **run twice 2026-10-08** (owner's go; billable). Latest: `eval-20261008T041142Z-cold` + `eval-20261008T041702Z-warm`, exit 0. **Zero false resolves across all four passes.** Calc accuracy 100%. Outcome accuracy **60% cold, 60% warm** (target ≥85%); avg steps **7.0 cold, 8.0 warm** — the memory effect is **negative and now cleanly measured**. The step-cap fix worked; rule 8 half-worked. See §0.6. |
| Tests | 1,010/1,010 at 2026-10-08. **1,139 as of 2026-10-14.** |
| Docs | Swept 2026-10-08, and again **2026-10-14** (design system, HLD, LLD, mental model, PRD, one-pager, parking lot, diagrams). |
| **Seeded book (2026-10-08)** | ✅ **6 loans.** F1/F3/F5 carry the twists; **F7 Dokusign Inc (1.40x), F8 Peat's Coffee Company (1.10x), F9 Costko Wholesale (1.35x)** are performing loans added so the book is not made only of exceptions and the minimum reads as per-loan, not a constant. Not evaluated — no oracle rows, no eval denominator moved. |
| **UI sweep (2026-10-08)** | ✅ Indigo brand accent throughout; queue, casefile, Lessons, Governance and Documents rebuilt on the owner's mockups. **Superseded 2026-10-13 by the light/teal palette — see §0.0.** |

### 0.2 Key decisions since 2026-10-06 (all owner-approved)

| Decision | Why | Where recorded |
|---|---|---|
| **Connected Agents dropped; specialists are in-process function tools** | A connected agent's inner run cannot carry a function tool, so specialists could not retrieve for themselves; delegations burnt 2–4 of 8 steps. One agent object remains: the orchestrator with six function tools. | parking-lot 7.4, HLD §4.1, `lib/agent/foundry.ts` |
| **"CreditScout Agent"** is the orchestrator's name in every user-facing surface; **"loan"** not "facility" on screens (schema unchanged) | Owner's wording; analysts say loan. | PRD scope-changes table |
| **Trace redesigned to foreground orchestration** — arc header, per-step purpose annotations, decision markers, "delegated by the CreditScout Agent" tags. Priority of pitch beats **A (orchestration) → C (memory) → B (guardrail)**; C and B trace beats parked (4.10). | The pitch objective is to show the orchestrator's power. | `components/traceModel.ts`, `TraceArc.tsx` |
| **Portfolio triage table** + "+ New borrower" + **dark-native depth, no shadows** (design.md bans `boxShadow`) | Borrowed from Covenant IQ's triage-at-a-glance; owner chose option A over shadows. | `components/PortfolioTable.tsx`, `portfolioModel.ts` |
| **Governing-first casefile** (test-period figure under the governing terms, amendment-status panel, *provisional* label on amendment-dependent narrative) | A credit-analyst reviewer asked for the governing number first. | `components/CasefileView.tsx`, `casefileModel.ts` |
| **Onboarding wizard**: route-driven, all documents uploaded in one step, review embedded in the wizard chrome (B), **effective date required** for agreement/amendment | Without the date, extraction 422s ("Cannot determine an effective date"). | onboarding spec §8, `components/UploadPackage.tsx` |
| **Lender renamed "Bank of Stoic"**; onboarding borrowers **Zhatsapp Inc, Marcus Tech, Orion Medical Supply, Petworks LLC, Vantage Print Works**; F1/F3/F5 keep their old names | The prior lender name resembled a real bank. | `data/facilities.js` |
| **The five onboarding packages are never seeded** | Onboarding must genuinely create the loan live. The eval harness therefore *skips* them until onboarded (4.11). | onboarding spec §5 |
| **Eval set is 10 signed cases, reported as 10** (not 24); scoreboard grouped **Honest / Harmless / Helpful**; evals are **hybrid** — grading is deterministic Node code against the signed key, the investigations run on Azure, only groundedness goes to the Foundry judge | The safety numbers must not be judged by a model. | PRD §5.1/§6.1, HLD §11 |
| `generate()` **refuses to overwrite a signed oracle**; the drift test compares generator-owned columns only | `npm run generate:data` would otherwise erase the owner's values. | `data/generate.mjs`, `data/generate.test.js` |
| One Vercel project serving **`credit-scout.vercel.app`**; the duplicate project and its `*.vercel.app` host were deleted; deploy auth via service principal with the **"Foundry User"** role ("Azure AI User" does not exist in this subscription) | Two projects were both auto-deploying `main`. Refer to the deploy by its live host, never by a project slug — the slug is cosmetic and has already changed once. | `docs/engineering/deploy-runbook.md` |

### 0.3 What is left — in order

1. ~~**Run the live eval passes**~~ — ✅ **run twice 2026-10-08.** Numbers,
   fix verdicts and per-case causes in §0.6. Exit 0 both times, zero false
   resolves, calc accuracy 100%. Four `eval_runs` rows; the Governance
   scoreboard has cold + warm columns.
   To re-run: `npm run dev` (background; `PUBLIC_BASE_URL` is unset in `.env`
   so the agent's tool calls default to `http://localhost:3000` — confirm with
   `curl -s localhost:3000/api/tools/openapi | head -c 200`), `az` already
   logged in, then `npm run eval -- --live`. `--only F1-2026Q2` smokes one case.
   Exit 2 = false-resolve gate failed; 3 = calc accuracy < 100%.
   **The open follow-ups, re-ranked after run 2:**
   - **Outcome accuracy is 60% cold / 60% warm against a ≥85% target.** Every
     miss is conservative (abstain/request where resolve or escalate was
     wanted), so nothing unsafe shipped — but the Helpful pillar does not meet
     its target. Parking-lot 7.7.
   - **The memory effect is negative and now cleanly measured** (7.0 → 8.0
     steps, with no cap deaths to confound it). The "memory shortens
     investigations" line must not be used. Parking-lot 7.7.
   - **Parking-lot 7.9 is now the top fix: `figure_traceable` abstains on
     figures that are facts but not calculations.** It caused 3 of run 2's 4
     misses (F3 both passes on the reported `1.31`; F1-warm on `620000`).
   - **F1-cold chose `request` with no guardrail involvement** — a prompt and
     judgement gap about when `request` beats `resolve`. New; parking-lot 7.10.
   - **Schema retries in 2 of 6 investigations** (`calculations` not an array,
     `suggested_tag` outside the enum). Each burns a step. Parking-lot 7.11.
   - Known leftover: an aborted first attempt left one casefile `investigating`
     under `eval-20261008T031237Z-cold`. Ignore it; do not delete it.
2. **Groundedness — built, run once, now STALE.** `npm run eval:groundedness`
   (`scripts/foundry-groundedness.mjs`: uploads each pass's `foundry-*.jsonl` as
   a Foundry dataset, then runs the built-in groundedness evaluator). The judged
   numbers in §0.6 are over **run 1's** jsonl, which **run 2 has overwritten** —
   so they no longer describe the current agent. **Re-running is billable and
   needs the owner's go.** Run 2 has no cap deaths, so the empty-context row
   that made cold undefined should now be a real answer and cold should finally
   be measurable. API gotchas are commented in the script and in §0.6.
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
| Tests | `npm test` (**1,139**) · `npx tsc --noEmit` · `npm run build` |
| Deterministic eval | `npm run eval` (free) · `npm run eval -- --write` (records the row) |
| Live eval | `npm run dev` (background) then `npm run eval -- --live` (billable; see 0.3) |
| Groundedness | `npm run eval:groundedness` (billable; `--dry-run` is free, `--mode cold\|warm` for one pass). Needs a completed `--live` run first. |
| Regenerate synthetic docs | `npm run generate:data` — safe: will not touch the signed oracle |
| Reset the demo queue | `node --env-file=.env scripts/reset-demo.mjs` — Coastal back to *Investigate*, strays removed; **reports** Harbor rather than writing `pending_review` (only `lib/agent/enforce.ts` may) |
| Regenerate the diagrams | `python3 docs/diagrams/generate.py` — never hand-edit the SVGs |
| Deploy | `git push origin HEAD` then **`npx vercel --prod --yes`** — this branch is not the project's production branch, so a push alone builds a Preview. Confirm with `npx vercel ls creditscout-nrb7 --prod`. Runbook: `docs/engineering/deploy-runbook.md` |
| DB | Supabase project `rngsejqplndmygrozasc` (cloud only); service-role key in `.env`; Supabase MCP for SQL. **Ask before any DELETE.** |

### 0.5b Credentials that expire — check before they bite (verified 2026-10-13)

The agent authenticates to Azure AI Foundry with a service principal. Its
client secret has an expiry date, and when it lapses **every investigation
fails with a 401/403 while the rest of the product keeps working** — covenant
tests, the calculator, the queue and the casefile are all Supabase and our own
code, so the failure looks like "the agent broke", not "the app broke".

| What | Value |
|---|---|
| Entra app registration | **Credit Scout** — `6ebe7212-d966-4777-b347-9447078f944e` |
| Secret in use (Vercel `AZURE_CLIENT_SECRET`) | `creditscout-vercel` — **expires 2027-04-05** |
| Second secret on the same app | `creditscout-smoky` — expires 2027-10-07, named after the Vercel project that was deleted; probably dead weight |
| Tenant | `caa90f16-e00a-440e-a28e-8c07f6bee4a5` |

To check: `az ad app credential list --id 6ebe7212-d966-4777-b347-9447078f944e --query "[].{name:displayName, expires:endDateTime}" -o json`

To rotate: create a new secret on that app registration, update
`AZURE_CLIENT_SECRET` in the Vercel project's Production environment, redeploy.
Environment variables are baked in at build time, so a redeploy is required —
changing the value alone does nothing.

**Locally there is no service principal**: `AZURE_CLIENT_ID` is unset in `.env`
and the SDK falls back to your `az login`. So local work can keep succeeding
long after production's secret has expired. Do not use local success as
evidence that production is fine.

**Microsoft 365 is unrelated.** The M365 Business Standard + Copilot
subscription was cancelled 2026-10-13 and nothing broke: M365 licences and the
Azure subscription are separate products on separate billing, and cancelling
M365 does not delete the Entra tenant the service principal lives in. Verified
the same day — Foundry auth returned the orchestrator with all six tools, and
all three model deployments responded.

### 0.6a Live eval — THREE runs, and the number is noisy (2026-10-08)

Read this before quoting an outcome-accuracy figure. §0.6 below is runs 1–2 and
is kept for the fix-verdict evidence; this is the current picture.

| Run | What changed | Cold | Warm | Avg steps |
|---|---|---|---|---|
| 2 | baseline | 60% | 60% | 7.0 / 8.0 |
| 3 | + prompt rule 9 (the brief is not a citation) | **100%** | 80% | 7.0 / 9.0 |
| 4 | + citation example, + `normaliseCitations` fold | 60% | 80% | **6.7 / 6.7** |

**Do not quote 100%.** Cold went 60 → 100 → 60 while fixes were only ever added.
Five gradeable cases means one case is 20 points, so the metric is coarse and the
model is nondeterministic. The defensible statement is **"60–100% across three
runs, against an 85% target — it does not reliably meet it."**

**What IS stable, and is the real result of run 4:**

- **F5 Coastal Marine resolves every time.** 4 of 4 since the fold fix (two
  standalone runs at 10 and 5 steps, then cold and warm at 6 each). Before it,
  it hit the step cap and abstained three runs running. This is the demo path.
- **Avg steps 6.7 / 6.7** — the lowest recorded, and the memory effect is
  **neutral** for the first time rather than negative. Still not a reduction, so
  "memory shortens investigations" remains unsupported.
- **Zero false resolves** in every pass of every run, without exception.
- Calculation accuracy 100% (12/12) in every run.

**Run 4's two cold misses, from `guardrail_notes`:**

| Case | Pass | Got | Why |
|---|---|---|---|
| F1 | cold | `abstain` | **No guardrail note at all** — the agent's own judgement (7.10) |
| F3 | cold | `abstain` | `figure_traceable` on **1.31** in `confidence_basis` — rule 9 did not take this run |
| F1 | warm | `abstain` | `figure_traceable` on **620000**, paraphrased not quoted |

Rule 9 reduces the 1.31 abstain but does not eliminate it: the agent sometimes
cites the compliance certificate and sometimes does not. Making the reported
figure traceable in CODE — injecting it with its certificate citation rather than
as a bare number in the brief — is the next fix, and is the one that would
actually close 7.9.

### 0.6 Live eval results — two runs, 2026-10-08 — read this before quoting any number

`npm run eval -- --live`, exit code 0 both times (the false-resolve gate passed
and calc accuracy was 100%). Four `eval_runs` rows recorded. Latest report in
`evals/out/report.md`.

**Run 2 is the current number.** It was taken after the step-cap raise and
prompt rule 8 landed, so it measures them. Run 1 is kept beside it because the
comparison is the only evidence either fix worked.

| Pillar | Metric | Target | R1 cold | R1 warm | **R2 cold** | **R2 warm** |
|---|---|---|---|---|---|---|
| Honest | Calculation accuracy | 100% | 100% | 100% | **100%** (12/12) | **100%** |
| Honest | Citation hit rate | ≥ 90% | — | — | — | — |
| Honest | Groundedness (judge) | reported | unstable | 5.0 / 5 | **stale — see below** | **stale** |
| Harmless | Zero false resolves | 0 | 0 | 0 | **0** | **0** |
| Harmless | Correct abstain / request | ≥ 90% | — | — | — | — |
| Helpful | Outcome accuracy | ≥ 85% | 60% | 40% | **60%** | **60%** |
| Helpful | Avg steps / case | visible reduction | 6.3 | 7.3 | **7.0** | **8.0** |

Run 2 ids: `eval-20261008T041142Z-cold`, `eval-20261008T041702Z-warm`.
"—" is not measured, never a measured zero. Outcome accuracy is over the 5
gradeable cases (3 investigated + 2 code-only F5 periods), not over 10.

**Skipped, by design, in both runs:** all five onboarding cases (ZHATSAPP,
MARCUS, ORION, PETWORKS, VANTAGE). The packages are deliberately never seeded
so onboarding has to create the loan live (onboarding spec §5). Not a failure;
parking-lot 4.11 covers onboarding Vantage into the eval. ZHATSAPP skips for a
different reason — it *is* in the database but has no approved terms in force.

#### Did the two fixes work? One yes, one partial.

| Fix | Verdict | Evidence |
|---|---|---|
| Step cap **8 → 12** | ✅ **Worked** | **Zero cap deaths in run 2** (three in run 1). F5-2026Q2 now resolves correctly in *both* passes at exactly **8 steps** — precisely where the old cap killed it. Warm outcome accuracy 40% → 60% is entirely this. |
| Prompt **rule 8** (governing calc last) | ⚠️ **Mechanism fixed, outcome not** | `resolve_requires_evidence` appears in **none** of run 2's six casefiles; it was F1's cause twice in run 1. The agent no longer ends on the wrong calculation. But F1 still does not resolve — it now misses for entirely different reasons (below). |

Net: outcome accuracy **60/40 → 60/60**. Still far below the ≥85% target.

**The memory result is now clean, and it is negative.** Steps went *up* again,
7.0 → 8.0. In run 1 this was confounded by cap deaths; in run 2 **nothing hit
the cap**, so the comparison is honest and the conclusion stands: warm memory
adds about a step rather than saving one. On F1 it is actively harmful — cold
reached `request`, warm degraded to `abstain`. The pitch line "visible step
reduction from memory" is **not supported by two runs** — do not assert it.

**Run 2 per-case causes (from `casefiles.guardrail_notes`, not inference):**

| Case | Pass | Got | Want | Why |
|---|---|---|---|---|
| F1-2026Q2 | cold | `request` | resolve | **No guardrail downgrade at all** — only a `schema` retry ("calculations must be an array"). The agent chose `request` on its own judgement. This is now a prompt/judgement gap, not an enforcement artefact. |
| F1-2026Q2 | warm | `abstain` | resolve | `figure_traceable`: unverified figure **620000** — the restructuring-charge amount, discussed without a logged calc or a verbatim cited quote. Also `calc_id_unknown`: it cited `b627df4f…`, which is not logged for this casefile. Warm is *worse* than cold here. |
| F3-2026Q2 | cold | `abstain` | escalate | `figure_traceable`: unverified figure **1.31** (the borrower's reported DSCR) in `confidence_basis`. **This is 7.9.** |
| F3-2026Q2 | warm | `abstain` | escalate | `figure_traceable`: **1.31** again, this time in `explanation`. Plus a `schema` retry — `suggested_tag` came back `"unsupported_addback"`, which is not in the enum. **7.9 again.** |
| F5-2026Q2 | cold | `resolve` ✓ | resolve | Correct. `terms_differ_from_approved` flagged the Amd 2 fuel-hedging add-back as drift from boarded terms — informational, as designed. |
| F5-2026Q2 | warm | `resolve` ✓ | resolve | Correct. Same terms-drift flag, plus `quote_verbatim` removed one claim ("no chunk supplied for citation Fin Q2 2026 §§1, 2"). |

**Ranked remaining blockers, by how often they actually bit:**

> **7.9 was fixed 2026-10-13** (`chunksForCalcProvenance`, commit `1794d76`) — the
> figures we hand the agent in its brief are now in the evidence the guardrail
> checks against. **Not yet re-measured in a live eval**, so every number in
> §0.6/§0.6a still predates the fix. Expect F3 to stop abstaining on 1.31 and
> F1-warm on 620000; F1-cold is 7.10 and is untouched.

1. **7.9 — `figure_traceable` on figures that are facts but not calculations.**
   Caused **3 of run 2's 4 misses** (F3 both passes on `1.31`, F1-warm on
   `620000`). Reproducible across both runs. Single highest-leverage fix left.
2. **F1-cold picked `request` unprompted.** No guardrail involved, so no
   enforcement fix applies — this needs prompt work on when `request` is right
   versus `resolve`.
3. **Schema retries in 2 of 6 investigations** (`calculations` not an array;
   `suggested_tag` outside the enum). Each costs a step and partly explains why
   avg steps rose.

**The guardrail is still visibly doing real work:** across run 2's six
investigations it abstained three times and let two true resolves through, with
one claim removed and terms drift flagged twice. **Zero false resolves across
four passes and two runs.** The zero is earned, not vacuous.

**Groundedness is STALE.** The numbers below were judged over **run 1's**
`evals/out/foundry-*.jsonl`, which run 2 has since overwritten. Re-run
`npm run eval:groundedness` (billable) before quoting anything.

- **Run 1 warm: 5.0 / 5, `groundedness_passed` 1.0** across all three rows —
  every claim judged supported by its retrieved context.
- **Run 1 cold: do not quote a number.** Two runs over *identical* data and
  config returned mean 3.67 with 2/3 passed, then mean 5.0 with a 0.67 binary
  aggregate and no `groundedness_passed` key. A mean of 5 beside a 0.67 pass
  rate is self-contradictory — a row is dropped from the mean and counted in
  the aggregate.
- **The cause was F3-cold, and it was our data, not the judge:** the step-cap
  non-answer with an **empty context array**. Run 2 has no cap deaths, so that
  row is now a real answer and cold should finally be measurable.
- Per-row `instance_results.jsonl` is not reachable over REST (`/credential`
  and `/listSecrets` both 404) — read it in the Foundry portal under
  Evaluations.

**Fixes applied 2026-10-08 and already measured by run 2:** step cap 8 → 12
(migration `0011_raise_step_cap.sql`, applied live, `DEFAULT_POLICY.max_steps`)
and prompt rule 8 (`lib/agent/prompt.ts`, pushed to the live Foundry agent,
same id). Also landed, unrelated to the eval: the agent's base URL is now
derived from the platform (`lib/agent/openapi.ts`), and `PUBLIC_BASE_URL` was
deleted from Vercel production.

**Run 1 per-case causes are superseded** by the table above; they are preserved
in git history at commit `1a4929d` if the comparison is ever needed.

---

## 1. What this is

CreditScout is a decision-support agent for commercial credit analysts monitoring covenant compliance.

A rules engine can tell an analyst that a *reported* ratio is below its threshold. What it can't do is the work either side of that: compute the ratio independently from the covenant that is actually in force, and then run the investigation when the numbers disagree — find the definition across a long credit agreement and its amendments, recompute on the right basis, explain the gap against the borrower's own figure, and judge whether the evidence is good enough to resolve, escalate, or ask for more.

The scope is deliberately one covenant — **DSCR**, tested quarterly on a trailing-twelve-month basis — across six synthetic borrower facilities, three of which carry a twist worth investigating.

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

### 4.7 Six facilities — three evaluated, three performing

F1 Harbor Logistics, F3 Northgate Foods and F5 Coastal Marine carry the twists and are the evaluated cases. F7 Dokusign Inc (1.40x), F8 Peat's Coffee Company (1.10x) and F9 Costko Wholesale (1.35x) were added 2026-10-08: performing loans with no twist, no amendment and reported equal to computed. They exist because a book made only of exceptions is not a book, and because three loans all boarded at 1.25 made the minimum look like a constant rather than a term negotiated per loan.

The performing three raise no exception, produce no casefile and sit in **no oracle row** — `renderCsv` covers `EVALUATED_FACILITIES`, so no eval denominator moves. **F2, F4 and F6 stay reserved** in `docs/parking-lot.md` §4.1: they are the two that exercise `request` and `abstain`, they are first to restore, and the performing loans deliberately did not take their ids. **Report the eval set as what it is. Ten cases is ten cases, never twenty-four.**

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
| 2 | Synthetic documents + expected-values template | ✅ 25 documents seeded across 6 facilities, twist live; oracle **signed** (10 rows, incl. the 5 onboarding loans) — the 3 performing loans add documents but no oracle rows |
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

6 seeded facilities — Harbor, Northgate, Coastal (twists) and Dokusign, Peat's Coffee, Costko (performing) — plus any loans onboarded live through the wizard · their documents and `doc_chunks` (lender text "Bank of Stoic") · **approved v1** `covenant_terms` on all six · demo-run `tests`/`exceptions`/`casefiles`/`reviews` from the live demo · `eval_runs` rows. Eval passes use `eval-*` run_ids and never touch the `demo` run.

Cleaned out 2026-10-08 (all owner-approved): the stray "Summit Freight Co." facility, two duplicate "Marcus"/"Marcus Tech" rows and an empty "Zhatsapp Inc" row — all leftovers from onboarding test runs, none carrying an exception or casefile. The database now holds exactly the six seeded loans, so the queue reads "6 of 6 tested" with no stray "Not tested" row.

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
