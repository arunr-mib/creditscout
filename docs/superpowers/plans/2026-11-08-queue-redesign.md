# Queue Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Exceptions home page's four-lane kanban with a dense, risk-sorted table as the default view (kanban survives as a toggleable second lens, with its "compliant/untested loans vanish" blind spot fixed), add meaning-bearing icons to the filter pills above the table and to the portfolio rail's collapsed strip, and leave every other part of the product — the casefile page, the rail's expanded per-loan list, the header — untouched.

**Architecture:** Two small new pure-function modules (`driftModel.ts`, `queueFilterModel.ts`) extend the existing `portfolioModel.ts`/`pipelineModel.ts` layer with no behavioural change to what already exists; a new client orchestrator (`ExceptionsQueue.tsx`) owns the filter/search/lens UI state and renders either the new `QueueTable.tsx` or the existing `Pipeline.tsx`, both fed by the same filtered, sorted `PortfolioRow[]`. No navigation changes — a row's next action does exactly what the deleted `PortfolioTable.tsx`'s `RowAction` already did, linking to the same existing `/casefiles/[id]` page.

**Tech Stack:** Next.js App Router, React, Tailwind (replaced `spacing`/`fontSize`/`boxShadow`/`width` scales — check `tailwind.config.ts` before using any size class), `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-08-queue-redesign-design.md` (read the whole thing — it carries the owner's reasoning and every rejected alternative, including the inline master-detail panel that was built, mocked up, and dropped). Project-wide rules: `CLAUDE.md`.

## Global Constraints

- Tailwind `spacing` is `0, px, 1(4px), 2(8px), 3(12px), 4(16px), 6(24px), 8(32px), 12(48px), 16(64px)` — no other size exists and an off-scale class fails silently at render (the single most common mistake in this codebase, and the exact mistake already made once this session on `h-7`/`w-7`). `width` is additionally extended with `rail: 260px`, `rail-collapsed: 44px`, `menu: 192px` — no others.
- One font, Inter, everywhere; figures and dates `tabular-nums`; monospace only for identifiers.
- Sky/the agent tag mark only the CreditScout Agent's own content; mint is interactive-only, never a status; no coloured left-border accent stripes on cards; green only a verified pass or recorded resolution; amber on the live investigation screen means exactly "the calculation cannot proceed."
- `components/workspaceTokens.test.js` fails the build on any `model*`/`sunken`/`night*` class outside `app/welcome/`, `app/login/`, `components/Logo.tsx` — none of this plan's files are exempt.
- The existing status→colour mapping in `components/PortfolioRail.tsx`'s `DOT` constant is binding and must not be reinvented: `breach → bg-danger`, `pass → bg-success`, `decided → bg-text-muted`, `terms → bg-human` (not amber — amber is reserved for code/calculation states), `untested → ring-1 ring-text-muted`. The matching `-bg` tint tokens that exist today: `danger-bg #FBE3E3`, `success-bg #E8F7EE`, `human-bg #F1F5F9`, plus the neutral `surface-raised` for "decided." `code`/`code-bg` (amber) must not appear on any of this plan's new icons.
- No test framework beyond `node:test`. Every pure-function module gets a sibling `*.test.js`. Presentational components (`QueueTable.tsx`, `QueueFilterBar.tsx`, `ExceptionsQueue.tsx`, `queueIcons.tsx`) get none, consistent with `Pipeline.tsx`/`PipelineCard.tsx` today — their correctness lives in the model tests plus the manual verification in the final task.
- `npm test`, `npx tsc --noEmit`, `npm run build` must all pass before the final task's deploy step.
- No change to `calc/`, `guardrails/`, `lib/agent/`, API routes, schema, `evals/`, `data/`, `/welcome`, `/login`, or `CasefileView.tsx`/`ReviewActions.tsx`/`LiveTrace.tsx` (the casefile page is explicitly out of scope — §4.4 of the spec).
- Commit after every task, conventional prefixes (`feat(queue):` / `fix(queue):`), trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Never `git stash` bare.
- Local dev: kill any stray `next dev`/`next-server` process and confirm port 3000 is free before starting one (`lsof -i :3000 -t`) — two earlier sessions this build lost time to exactly this.

## Review Focus

- A loan with `ours`/`required` null (untested, or no approved terms) must show "—" for headroom and sort to the bottom without the sort comparator crashing on a null subtraction.
- Two loans with **identical** headroom (the real book has this: Coastal Marine and Harbor Logistics are both −0.13x) must tie-break deterministically on drift, not flip order between renders.
- A facility with only one quarter of `tests` rows — every seeded loan except Coastal Marine — must never show a drift flag; `hasDrift` must not throw on fewer than 2 points.
- The "Breaches" filter pill must **exclude** a loan whose breach is already decided (owner's explicit, research-departing call) — a loan at `status: "decided"` must not be counted even though `testResultOf` would call it `below_minimum`.
- The rail's existing `[`-key toggle and its `targetTag`/`targetEditable` guard (`isRailToggleKey` in `railModel.ts`) must still correctly ignore the new loan-search `<input>` this plan adds to the page — confirmed by manual test in the final task, since the guard itself is unchanged code.

---

### Task 1: Drift — per-facility quarter-over-quarter signal

**Files:**
- Create: `components/driftModel.ts`, `components/driftModel.test.js`
- Modify: `lib/portfolio-data.ts`

**Interfaces:**
- Produces: `interface QuarterPoint { period: string; computed: number | null }`; `hasDrift(points: QuarterPoint[]): boolean`; `driftByFacility(tests: { facility_id: string; test_period_end: string; computed_dscr: number | null }[]): Map<string, boolean>`.
- Consumes (in `lib/portfolio-data.ts`): the `tests` array already fetched by `loadPortfolio()` — no new Supabase query. Adds `drift: Map<string, boolean>` to the exported `PortfolioData` interface, returned from `loadPortfolio()`.

- [ ] **Step 1: Write the failing tests** in `components/driftModel.test.js`:
  - `hasDrift([])` and `hasDrift([{period:"2026-06-30",computed:1.12}])` → `false` (fewer than 2 points).
  - `hasDrift` with points unsorted in the input, computed values `[{period:"2025-12-31",computed:1.41},{period:"2026-06-30",computed:1.12},{period:"2026-03-31",computed:1.29}]` → `true` (sorts by period internally; latest 1.12 < earliest 1.41).
  - `hasDrift` with `[{period:"2026-03-31",computed:1.10},{period:"2026-06-30",computed:1.20}]` → `false` (latest ≥ earliest — improving, not drifting).
  - `hasDrift` with a `null` computed value in either the earliest or latest position after sorting → `false` (never crash, never treat a missing figure as a decline).
  - `driftByFacility` with the real shape — Coastal Marine's three rows (`619d51ba...`-style id, periods `2025-12-31`/`2026-03-31`/`2026-06-30`, computed `1.41`/`1.29`/`1.12`) plus one single-quarter row for a different `facility_id` — returns a `Map` where Coastal Marine's id → `true` and the other facility's id → `false`.
- [ ] **Step 2: Run** `node --test components/driftModel.test.js` — expected FAIL (module not found).
- [ ] **Step 3: Implement `driftModel.ts`.** `hasDrift`: sort a copy of `points` by `period` ascending, take the first and last entries; if either is missing a non-null `computed`, or fewer than 2 points exist, return `false`; else return `last.computed < first.computed`. `driftByFacility`: group the input by `facility_id` into `QuarterPoint[]` (`period: test_period_end`, `computed: computed_dscr`), call `hasDrift` per group, return the `Map`.
- [ ] **Step 4: Run** `node --test components/driftModel.test.js` — PASS.
- [ ] **Step 5: Wire into the loader.** In `lib/portfolio-data.ts`: import `driftByFacility`; after the existing `tests` array is built, compute `const drift = driftByFacility(tests);`; add `drift: Map<string, boolean>` to the `PortfolioData` interface; include `drift` in the object `loadPortfolio` returns.
- [ ] **Step 6: Run** `npm test && npx tsc --noEmit` — both clean. (`npm run build` is not required per-task; the final task runs it once over the whole branch.)
- [ ] **Step 7: Commit** `feat(queue): drift signal from existing quarterly test history`.

---

### Task 2: Queue counts, filter, headroom, risk sort

**Files:**
- Modify: `components/portfolioModel.ts`, `components/portfolioModel.test.js`
- Create: `components/queueFilterModel.ts`, `components/queueFilterModel.test.js`

**Interfaces:**
- Consumes: `PortfolioRow`, `PortfolioStatus`, `testResultOf` from `portfolioModel.ts` (unchanged); `Map<string, boolean>` drift shape from Task 1.
- Produces:
  - `queueCounts()`'s return type gains two fields: `compliant: number` (`status === "compliant"`) and `breaches: number` (status in `{breach_investigate, in_review, investigating, investigation_paused, awaiting_docs}` — **excludes `decided`**, per the Review Focus item above).
  - `type QueueFilter = "all" | "needs_review" | "breaches" | "compliant" | "terms"`.
  - `QUEUE_FILTERS: readonly { key: QueueFilter; label: string }[]` in this exact order and these exact labels: `all`/"All loans", `needs_review`/"Needs review", `breaches`/"Breaches", `compliant`/"In compliance", `terms`/"Terms approval".
  - `applyQueueFilter(rows: PortfolioRow[], filter: QueueFilter, query: string): PortfolioRow[]` — `query` matches case-insensitively against `row.borrower`, applied after the status filter. `"all"` applies no status filter.
  - `headroomOf(ours: number | null, required: number | null): { text: string; tone: "pos" | "neg" } | null` — `null` when either input is `null`; else `ours - required`, `text` formatted `"+0.24x"` / `"-0.13x"` (always signed, 2dp), `tone: "pos"` when `≥ 0` else `"neg"`.
  - `sortByRisk(rows: PortfolioRow[], drift: Map<string, boolean>): PortfolioRow[]` — a new array, does not mutate the input.

- [ ] **Step 1: Write the failing tests** in `components/portfolioModel.test.js` (extend, do not replace, the existing `queueCounts` describe block):
  - Add `compliant: 0, breaches: 2` to the existing `deepEqual` fixture at the "tested is a ratio of the book" test (2× `in_review`, 1× `decided`, 2× `not_tested` — `breaches` counts only the two `in_review` rows, `compliant` is 0).
  - A new test: rows with one of each of `investigating`, `investigation_paused`, `awaiting_docs`, plus one `decided` (`status: "decided"`) that would read `below_minimum` under `testResultOf` — `queueCounts(rows).breaches === 3`, explicitly asserting the decided row is excluded.
  - A new test: two `compliant` rows and one of everything else → `queueCounts(rows).compliant === 2`.
- [ ] **Step 2: Run** `node --test components/portfolioModel.test.js` — FAIL (new fields absent / assertions fail).
- [ ] **Step 3: Implement** the two new `queueCounts` fields in `components/portfolioModel.ts`, alongside the existing ones.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Write the failing tests** in `components/queueFilterModel.test.js`:
  - `QUEUE_FILTERS` has exactly 5 entries in the order and labels above.
  - `applyQueueFilter`: a 4-row fixture (one each `breach_investigate`, `decided`, `compliant`, `not_tested`/no terms) — `"all"` returns all 4; `"needs_review"` returns only `in_review` rows (fixture needs one — add a 5th row); `"breaches"` returns `breach_investigate` + the `in_review` row, not `decided`; `"compliant"` returns only the compliant row; `"terms"` returns only the no-terms row. A `query` of a substring of one borrower's name (any case) narrows to that row regardless of which status filter is active; a query matching nothing returns `[]`.
  - `headroomOf(1.12, 1.25)` → `{ text: "-0.13x", tone: "neg" }`; `headroomOf(1.59, 1.35)` → `{ text: "+0.24x", tone: "pos" }`; `headroomOf(null, 1.25)` and `headroomOf(1.1, null)` → `null`.
  - `sortByRisk`: a fixture matching the real book's shape — Northgate (`decided`, ours 1.08, required 1.25), Coastal Marine (`breach_investigate`, ours 1.12, required 1.25, drift `true`), Harbor Logistics (`in_review`, ours 1.12, required 1.25, drift `false`), Peat's (`compliant`, ours 1.19, required 1.10), testqq (`not_tested`, ours `null`) — asserts the output order is exactly `[Northgate, Coastal Marine, Harbor Logistics, Peat's, testqq]`: worst headroom first (Northgate −0.17), equal headroom (−0.13) broken by drift (Coastal before Harbor), positive headroom last among the computed rows, no-figure rows last of all.
  - `sortByRisk` does not mutate its input array (compare the input array's own order unchanged after the call, or assert the returned array is a different reference).
- [ ] **Step 6: Run** `node --test components/queueFilterModel.test.js` — FAIL.
- [ ] **Step 7: Implement `queueFilterModel.ts`.** `sortByRisk`: copy the array; comparator computes `headroomOf` for each side (missing figure sorts last — treat as `+Infinity`), compares by signed headroom value ascending, then by `drift.get(row.facilityId) ? -1 : 1` relative ordering (drift-true ranks before drift-false at equal headroom) as the tie-break, then by `Math.abs((row.theirs ?? 0) - (row.ours ?? 0))` descending as the final tie-break (larger reported-vs-computed gap first).
- [ ] **Step 8: Run** — PASS.
- [ ] **Step 9: Run** `npm test && npx tsc --noEmit` — both clean.
- [ ] **Step 10: Commit** `feat(queue): filter, search, headroom and risk-sort model`.

---

### Task 3: Shared status icons

**Files:**
- Create: `components/queueIcons.tsx`

**Interfaces:**
- Produces: `BreachIcon`, `DecidedIcon`, `ComplianceIcon`, `TermsIcon` — each `(props: { className?: string }) => JSX.Element`, a small inline `<svg>` with `stroke="currentColor"` (so the caller's text-colour class drives the colour — never a hard-coded hex), `fill="none"`, `aria-hidden="true"` (these are always paired with visible text or a tooltip at the call site, never the sole label).

- [ ] **Step 1: Implement**, one `viewBox="0 0 24 24"` each, `stroke-width="2.2"`:
  - `BreachIcon`: a warning triangle with an exclamation mark (paths: `M12 3l9 16H3z` outline, `M12 10v4M12 17h.01` mark) — the exact shape already used in this session's approved mockups.
  - `DecidedIcon`: a flag (paths: `M5 3v18M5 4h11l-2 4 2 4H5`) — the exact shape from the approved mockup, not the plain checkmark an earlier draft of this feature mistakenly repeated for both "decided" and "in compliance."
  - `ComplianceIcon`: a checkmark (`M20 6L9 17l-5-5`).
  - `TermsIcon`: a document (`M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z`, `M14 3v6h6`).
- [ ] **Step 2: Verify** `npx tsc --noEmit` is clean (no test for a pure presentational file, consistent with `LogoMark.tsx`).
- [ ] **Step 3: Commit** `feat(queue): shared breach/decided/compliance/terms icons`.

---

### Task 4: The queue table

**Files:**
- Create: `components/QueueTable.tsx`
- Reference (read, do not modify): `/tmp/old-table.tsx` no longer exists on disk — it was the pre-Forest `PortfolioTable.tsx`, retrievable via `git show 58524b3^:components/PortfolioTable.tsx`. Its `RowAction` switch (one action per `PortfolioRow.status`) is the exact behaviour to reuse; only the styling changed in this project's later Forest restyle (mint fills, not the teal `model*` classes that version had — see Global Constraints).

**Interfaces:**
- Consumes: `PortfolioRow` (`components/portfolioModel.ts`); `testResultOf`, `TEST_RESULT_LABEL`, `reviewStatusOf` (`components/portfolioModel.ts`, unchanged); `headroomOf` (Task 2); `BreachIcon`/`ComplianceIcon` or plain chip styling for the Result column (reuse the existing `RESULT_TONE`/`RESULT_GLYPH`-equivalent — define locally in this file, mint/danger/success tokens only, no `model*`); `InvestigateButton`, `RunTestButton` (existing, unchanged).
- Produces: `QueueTable({ rows, targetPeriod, targetLabel }: { rows: PortfolioRow[]; targetPeriod: string; targetLabel: string })` — presentational; `rows` arrives already filtered, searched, and sorted by the caller (Task 5).

- [ ] **Step 1: Implement.** Columns, left to right: Borrower (+ industry, + terms version, matching the deleted table's cell exactly) · Computed · Reported · Minimum · Headroom (new — `headroomOf`, `text-success`/`text-danger` by `tone`) · Result (chip, `testResultOf`/`TEST_RESULT_LABEL`) · Status (`reviewStatusOf`'s label + muted `detail` line) · Next action (one button/link per `row.status`, ported from the deleted table's `RowAction`: `breach_investigate` → `InvestigateButton`; `in_review`/`awaiting_docs`/`investigating`/`investigation_paused`/`decided` → a `Link` to `/casefiles/${row.casefileId}` (label per status: "Review" / "Watch live" / "Resume" / "View decision", matching the deleted table); `compliant`/`not_tested` with approved terms → `RunTestButton` re-run; `not_tested` with no approved terms → a `Link` to `/facilities/${row.facilityId}/covenant-setup` labelled "Review terms"). All figures `tabular-nums`, right-aligned, Inter (no monospace). Mint for the one primary action per row (`breach_investigate`'s Investigate, `in_review`'s Review), bordered neutral for the rest — matching `components/PipelineCard.tsx`'s existing button treatment. Per §4.3/§4.4 of the spec, the row itself also navigates: every `<tr>` for a row that has a `casefileId` gets an `onClick` (or a wrapping wholesale click target, consistent with how the deleted table did it) pushing to `/casefiles/${row.casefileId}` — same destination as its own Next-action link — so a click anywhere on the row behaves like a click on the old table or a kanban card does today; a row with no `casefileId` yet (`not_tested`) has no row-level navigation, only its Next-action cell's own link/button. The Next-action cell's own button/link must stop row-click propagation (`e.stopPropagation()`) so its specific label/behaviour (e.g. "Watch live" vs the row's default casefile link) is never shadowed by the row handler. Empty state (`rows.length === 0`): "No loans match that filter."
- [ ] **Step 2: Verify** `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** `feat(queue): dense table replacing the deleted pre-Forest PortfolioTable`.

---

### Task 5: Filter bar and the client orchestrator

**Files:**
- Create: `components/QueueFilterBar.tsx`, `components/ExceptionsQueue.tsx`

**Interfaces:**
- Consumes: `QUEUE_FILTERS`, `applyQueueFilter`, `sortByRisk` (Task 2); `queueCounts` (`portfolioModel.ts`, now carrying `compliant`/`breaches`); the four icons (Task 3); `QueueTable` (Task 4); existing `Pipeline`, `PipelineAutoRefresh`, `pipelineLanes`, `hasRunningInvestigation`, `latestSteps`, `traceStepCount` (`components/pipelineModel.ts`/`Pipeline.tsx`/`PipelineAutoRefresh.tsx`, all unchanged by this plan except Task 6's new lane).
- Produces:
  - `QueueFilterBar({ counts, active, onFilter, query, onQuery, lens, onLens }: { counts: ReturnType<typeof queueCounts>; active: QueueFilter; onFilter: (f: QueueFilter) => void; query: string; onQuery: (q: string) => void; lens: "table" | "kanban"; onLens: (l: "table" | "kanban") => void })` — the 5 pills (icon + label + count, mint-filled when `active`), a borrower search `<input type="search">`, and the Table/Kanban lens toggle.
  - `ExceptionsQueue({ rows, drift, targetPeriod, targetLabel, traceByCasefile }: { rows: PortfolioRow[]; drift: Map<string, boolean>; targetPeriod: string; targetLabel: string; traceByCasefile: Map<string, unknown> })` — `"use client"`; owns `filter`, `query`, `lens` state (`useState`, local, no URL sync — not required by the spec); derives `const filtered = applyQueueFilter(rows, filter, query)`, `const sorted = sortByRisk(filtered, drift)`; renders `<QueueFilterBar .../>` then, by `lens`: `<QueueTable rows={sorted} .../>` or the existing kanban (`pipelineLanes`/`Pipeline`/`PipelineAutoRefresh`, computed from `sorted` the same way `app/page.tsx` computes them today — see Task 8).

- [ ] **Step 1: Implement `QueueFilterBar.tsx`.** Pills in `QUEUE_FILTERS` order; each pill's count comes from `counts[f.key === "all" ? "total" : f.key === "needs_review" ? "readyForReview" : f.key === "terms" ? "termsApprovalNeeded" : f.key]` (map the 5 filter keys onto the `queueCounts` fields named in Task 2/existing code — `all→total`, `needs_review→readyForReview`, `breaches→breaches`, `compliant→compliant`, `terms→termsApprovalNeeded`). Icon per pill: `all` → no icon or a plain neutral mark (owner's call, not specified — a sensible default is fine); `needs_review` → none specified by the spec (keep neutral); `breaches` → `BreachIcon`; `compliant` → `ComplianceIcon`; `terms` → `TermsIcon`. Active pill: `bg-mint text-text`; inactive: bordered neutral (`border-border-strong`, `text-text-secondary`). Search input styled like the deleted table's (`rounded-md border border-border-strong bg-surface px-3 py-2`). Lens toggle: two buttons in a pill-shaped container, active one `bg-brand text-brand-on` (matching `components/TopBar.tsx`'s own active-state treatment for consistency, not a new pattern).
- [ ] **Step 2: Implement `ExceptionsQueue.tsx`.** For the kanban branch, compute `lanes`/`steps`/`stepCounts`/`anyWorking` from `sorted` and `traceByCasefile` exactly as `app/page.tsx` does today (Task 8 moves that logic here verbatim — see its Interfaces block for the exact calls).
- [ ] **Step 3: Run** `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** `feat(queue): filter bar and the table/kanban orchestrator`.

---

### Task 6: Kanban's fifth lane — the board's blind spot, fixed

**Files:**
- Modify: `components/pipelineModel.ts`, `components/pipelineModel.test.js`

**Interfaces:**
- No change to `PipelineCard`'s shape or to `components/PipelineCard.tsx` (it already renders a card with `action: null` correctly — no button, no stray "Decision recorded" text for a non-decided status).

- [ ] **Step 1: Write the failing tests** in `components/pipelineModel.test.js`:
  - `LANES` has 5 entries; the 5th has `key: "also"`, `title: "Also in the book"`.
  - `pipelineLanes` with one `compliant` row and one `not_tested` row (no terms) → both land in the lane keyed `"also"`, `action` is `null` for both, and no other lane (`investigate`/`working`/`decision`/`decided`) gains a card.
  - A `breach_investigate`/`decided`/etc. row's lane placement (existing tests) is unaffected.
- [ ] **Step 2: Run** `node --test components/pipelineModel.test.js` — FAIL.
- [ ] **Step 3: Implement.** Add `"also"` to `LaneKey`; append `{ key: "also", title: "Also in the book", empty: "Nothing else on the book." }` to `LANES`; add `compliant: "also", not_tested: "also"` to `LANE_OF`. `actionOf`'s `default: return null` already covers both statuses correctly — no change needed there.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** `fix(queue): kanban lens stops hiding compliant and untested loans`.

---

### Task 7: Rail collapsed-strip icons

**Files:**
- Modify: `components/PortfolioRail.tsx`

**Interfaces:**
- Consumes: the four icons (Task 3); existing `RailDot` type and `DOT`/`DOT_SELECTED` colour maps (`railModel.ts`/`PortfolioRail.tsx`, unchanged — see Global Constraints for the binding colour-per-dot mapping, including that `terms` is slate/`human`, not amber).

- [ ] **Step 1: Add an icon map** in `PortfolioRail.tsx` (or a small local constant) from `RailDot` to the matching icon component: `breach → BreachIcon`, `decided → DecidedIcon`, `pass → ComplianceIcon`, `terms → TermsIcon`. `untested` has no dedicated glyph in Task 3 — keep its existing `ring-1 ring-text-muted` empty-circle treatment unchanged (it already reads as "nothing to show" distinctly from the other four).
- [ ] **Step 2: In the collapsed strip only** (the `<div className={collapsed ? "flex flex-col items-center gap-1 py-2" : ...}>` block, **not** the expanded list's small leading dot, which this plan does not touch — see the spec's corrected §6 resolution), replace the bare `<span aria-hidden="true" className="h-2 w-2 rounded-full ...">` with: for `breach`/`decided`/`pass`/`terms`, a small tinted square containing the mapped icon (`h-6 w-6 rounded-md` background tint from Global Constraints' token table, icon itself `h-4 w-4` using `currentColor`, wrapped in a `text-{danger|text-muted|success|human}` class to colour it); for `untested`, keep the existing ring-only treatment, just sized to match (`h-6 w-6 rounded-full ring-1 ring-text-muted`). Keep the surrounding `<Link>`'s existing `h-8 w-8` touch target and `title`/`aria-label` text unchanged.
- [ ] **Step 3: Run** `npx tsc --noEmit` clean; confirm `node --test components/workspaceTokens.test.js` still passes (no retired token introduced).
- [ ] **Step 4: Commit** `fix(queue): collapsed rail shows meaning-bearing icons, not colour dots`.

---

### Task 8: Wire the home page

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `ExceptionsQueue` (Task 5); `loadPortfolio` (now returning `drift`, Task 1).

- [ ] **Step 1: Replace** the `Pipeline`/`PipelineAutoRefresh`/`pipelineLanes` usage in the `<section aria-label="Loans">` block with `<ExceptionsQueue rows={rows} drift={drift} targetPeriod={targetPeriod} targetLabel={targetLabel} traceByCasefile={traceByCasefile} />`. Destructure `drift` from `loadPortfolio()`'s result alongside the existing fields. Remove the now-unused direct imports (`Pipeline`, `PipelineAutoRefresh`, `hasRunningInvestigation`, `latestSteps`, `pipelineLanes`, `traceStepCount`) from `app/page.tsx` — they move into `ExceptionsQueue.tsx` (Task 5). Everything else in the file (`SummaryStrip`, the upload section, the header, `RunTestButton`) is unchanged.
- [ ] **Step 2: Run** `npm test && npx tsc --noEmit && npm run build` — all clean. This is the first point the whole chain (Tasks 1–8) compiles and builds together.
- [ ] **Step 3: Commit** `feat(queue): table is the Exceptions default; kanban is a toggle`.

---

### Task 9: Thorough testing, then the test site — gated, owner walkthrough after

Per the owner's own instruction: full testing by the builder first, *then* the test site is made ready — not the other way round.

- [ ] **Step 1: Automated gate.** `npm test` (note the pass count), `npx tsc --noEmit`, `npm run build` — all clean.
- [ ] **Step 2: Start exactly one local dev server.** `lsof -i :3000 -t` first; kill any process found; `rm -rf .next`; start `npm run dev`; confirm `curl localhost:3000/login` returns 200 before proceeding.
- [ ] **Step 3: Manual walkthrough, signed in as the demo analyst** (every item below against the real seeded book — Coastal Marine, Harbor Logistics, Northgate Foods, Costko Wholesale, Dokusign Inc, Peat's Coffee Company, and whatever is currently in `not_tested`):
  - Table is the default view on `/`. Row order matches `sortByRisk`: worst headroom first; confirm Coastal Marine (has drift) ranks above Harbor Logistics (no drift) despite equal headroom.
  - Headroom column: signed, red below zero, green at or above.
  - Each filter pill's count matches the book; clicking a pill narrows the table to exactly that status set; "Breaches" excludes any loan already decided even if its headroom is negative.
  - The borrower search box narrows further, combined with whichever pill is active; clearing it restores the pill's full set.
  - Typing in the search box does **not** trigger the rail's `[`-toggle (Review Focus item).
  - Every row's Next-action button/link does the right thing: Investigate starts a run and lands on the real casefile page (this one step is billable, a few cents — run it once); Review/Watch live/Resume/View decision links to the right casefile; Re-run and Review terms behave as today.
  - Kanban lens toggle: the existing 4 lanes render as before, plus the new "Also in the book" 5th lane listing every compliant and untested loan, muted, no action buttons.
  - Collapsed rail strip (resize below `md`, or toggle it): four distinct icon shapes, no two different categories sharing a shape; colours match Global Constraints' table, including slate (not amber) for terms-awaiting-approval.
  - Rail's **expanded** view, on `/` and on Documents/Covenant terms: unchanged, still one row per loan — confirm this plan did not touch it.
  - `/welcome` and `/login` render unchanged.
- [ ] **Step 4: Stop the dev server.**
- [ ] **Step 5: OWNER GATE — push and deploy.** Confirm with the owner before this step if any doubt remains from Step 3. Then: `git push origin arunr-mib/creditscout`; `vercel deploy` (never `--prod`); capture the Preview URL from the output.
- [ ] **Step 6: Smoke the preview.** `curl -s -o /dev/null -w "%{http_code}" <preview-url>/` — 307 (redirect to sign-in) or 200 is healthy; a Vercel SSO redirect (302 to `vercel.com/login`) is also expected and not a failure — the owner's own browser session will pass through it.
- [ ] **Step 7: Hand the preview URL to the owner** with a short summary of what changed, for their own walkthrough. Do not deploy to production (`vercel --prod`) — that is the owner's call, after they've tested, per every prior round this session.
