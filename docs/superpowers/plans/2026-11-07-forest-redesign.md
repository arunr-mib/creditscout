# Forest Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every post-login screen of CreditScout to the owner-approved "Forest" design — forest header with survey-map contours, sections as top tabs, a collapsible portfolio rail, a deal pipeline replacing the queue table, and a "sky" layer reserved for the CreditScout Agent — then ship it to a Vercel Preview for the owner's walkthrough before production.

**Architecture:** Neutral colours and the UI font become CSS variables, so the workspace switches palette with one `theme-forest` class on `<body>` while `/welcome` and `/login` keep rendering exactly as today. All new behaviour (rail items, rail collapse rules, tab matching, pipeline lanes, headroom bars) lives in pure `*Model.ts` files tested with `node:test`; components stay thin. The shared portfolio query moves out of `app/page.tsx` into a cached loader used by both the layout (rail) and the home page (pipeline).

**Tech Stack:** Next.js App Router, React, Tailwind (replaced `spacing`/`fontSize`/`boxShadow` scales), `next/font/google` (Bricolage Grotesque, Inter, JetBrains Mono), Supabase anon reader, Node 24 `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-07-forest-redesign-design.md` · mockups in `docs/design-mockups/2026-11-07-forest/` (`forest-sky-pipeline-and-case.html` is the approved picture).

## Global Constraints

- Out of scope and must render exactly as today: `/welcome`, `/login` (`app/welcome/**`, `app/login/**`), and the `bare` branch of `app/layout.tsx`. Keep every `model*` and `night-*` token they use.
- No change to `calc/`, `guardrails/`, `lib/agent/`, API routes, schema, `evals/`, `data/`.
- No test framework: `node:test` + `node:assert/strict`; tests import `.ts` directly (Node 24 type stripping), as `components/portfolioModel.test.js` does.
- Tailwind `spacing`, `fontSize`, `boxShadow` are REPLACED scales — any new size goes into `tailwind.config.ts` first. No arbitrary values (`w-[260px]`) in components.
- Colours, verbatim from the spec: forest `#0F2B22`; mint `#9BE7A9` (interactive fills only, forest text on it, never a status, never text on white); sky `linear-gradient(160deg,#D6E8FF 0%,#C9ECEB 55%,#E4F6EE 100%)`; agent tag bg `#DCEBFF`, text `#123A6B`, dot `#3D7FD6`; red/pass-green/amber keep today's tokens and meanings.
- Muted text is `#566D61`, not the mockup's `#6E8679` (which fails AA: 3.93:1 on white). Every text pair must clear 4.5:1.
- Sky (gradient or agent tag) appears ONLY on: the "CreditScout working" lane, the recommendation card, agent steps in the live trace, and the "CreditScout" tag on agent-produced text.
- Amber on the live investigation screen still means exactly one thing: the calculation cannot proceed. Green still means only a verified pass or recorded resolution.
- Figures and dates keep `tabular-nums`; monospace (JetBrains Mono) only for identifiers.
- User-facing words: "CreditScout Agent", "loan" (never "facility"). Tabs read exactly: `Exceptions` · `Documents` · `Covenant terms` · `Lessons` · `Governance`.
- `npm test`, `npx tsc --noEmit` and `npm run build` pass at the end of every task.
- Commit after every task, prefix `feat(redesign):` / `docs(redesign):` / `chore(redesign):`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `git stash` bare.
- Visual checks run against `npm run dev` (Supabase is cloud; `.env` present). Sign in at `/login` with `analyst` / `creditscout2026`. Save screenshots under `.context/`.

## Review Focus

- `[` typed inside a text field (override rationale, search, onboarding inputs) must type the character, not toggle the rail — test in Task 3 (`isRailToggleKey`).
- `localStorage` missing or throwing (private mode, SSR) must fall back to the tab's default, never crash — test in Task 3 (`readRailPref`).
- A loan with no computed DSCR (untested, or a calculator error) shows "—", is never red and draws no headroom bar — tests in Task 3 (`railItems`) and Task 5 (`barGeometry`).
- A loan whose last investigation failed (no live casefile, exception back to `new`) belongs in "Needs investigating" with an Investigate action — test in Task 5.
- Long borrower names and a book of many loans: names truncate with a `title`, the rail scrolls on its own, lanes grow downward — visual check in Task 4 and Task 6 (add a temporary long name in devtools, not in data).

---

### Task 1: Theme foundation — palette, CSS variables, fonts, theme class

**Files:**
- Create: `lib/ui/palette.ts`, `lib/ui/palette.test.js`
- Modify: `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`

**Interfaces:**
- Produces:
  - `CLASSIC: Record<NeutralKey,string>` — today's neutral hex values (`bg #F7F9FA`, `surface #FFFFFF`, `surface-raised #F1F4F6`, `border #C7D3DA`, `border-strong #94A6B0`, `text #19282F`, `text-secondary #52646D`, `text-muted #6B7C85`).
  - `FOREST: Record<NeutralKey,string>` — `bg #FFFFFF`, `surface #FFFFFF`, `surface-raised #EEF3EF`, `border #DCE6DF`, `border-strong #BFD0C5`, `text #0F2B22`, `text-secondary #3E5A50`, `text-muted #566D61`.
  - `BRAND` — `brand #0F2B22`, `brand-on #FFFFFF`, `brand-on-2 #CFE3D6`, `brand-on-3 #A9C7B5`, `brand-danger #FFB4A8`, `mint #9BE7A9`, `mint-hover #86DC97`, `agent #3D7FD6`, `agent-ink #123A6B`, `agent-bg #DCEBFF`.
  - `SKY: string` (the gradient above). `NeutralKey` union of the eight keys.
  - `contrast(a: string, b: string): number` (WCAG 2.x ratio) and `rgbTriplet(hex: string): string` (`"#0F2B22"` → `"15 43 34"`).
  - Tailwind classes later tasks use: `bg-brand text-brand-on text-brand-on-2 text-brand-on-3 text-brand-danger bg-mint hover:bg-mint-hover bg-agent text-agent-ink bg-agent-bg bg-sky`, plus the neutral classes unchanged (`bg-bg`, `text-text`, …); `text-figure` (34/38/800), `text-figure-sm` (24/28/800), `text-wordmark` (19/24/800); `rounded-xl` 14px, `rounded-2xl` 18px; `w-rail` 260px, `w-rail-collapsed` 44px, `h-header` 52px; `font-brand`.

- [ ] **Step 1: Write the failing tests** in `lib/ui/palette.test.js`:
  - `rgbTriplet('#0F2B22') === '15 43 34'`.
  - Every FOREST text token (`text`, `text-secondary`, `text-muted`) has `contrast ≥ 4.5` on both `FOREST.bg` and `FOREST['surface-raised']`.
  - `contrast(BRAND.brand, BRAND.mint) ≥ 4.5` and `contrast(BRAND.brand, BRAND['mint-hover']) ≥ 4.5`; `contrast(BRAND['agent-ink'], BRAND['agent-bg']) ≥ 4.5`; `brand-on`, `brand-on-2`, `brand-on-3`, `brand-danger` each `≥ 4.5` on `BRAND.brand`; `agent-ink` `≥ 4.5` on `#C9ECEB` (the sky's mid stop).
  - Drift guard: parse `app/globals.css`; the `:root` block declares `--c-<key>: <rgbTriplet(CLASSIC[key])>;` and the `.theme-forest` block declares `--c-<key>: <rgbTriplet(FOREST[key])>;` for all eight keys.
- [ ] **Step 2: Run** `node --test lib/ui/palette.test.js` — expected FAIL (module not found).
- [ ] **Step 3: Implement `lib/ui/palette.ts`** with the exports above (no imports — plain data and two pure functions).
- [ ] **Step 4: Wire CSS variables.** In `app/globals.css` add `:root { --c-<key>: …CLASSIC… ; --font-ui: var(--font-inter); --font-figure: var(--font-inter); }` and `.theme-forest { --c-<key>: …FOREST… ; --font-ui: var(--font-brand); --font-figure: var(--font-brand); }`. Add `.theme-forest :focus-visible { @apply ring-text ring-offset-bg; }` and `.theme-forest .tabular-nums { font-family: var(--font-figure); }`. Leave the existing `:focus-visible` rule (login/welcome still use it).
- [ ] **Step 5: Tailwind.** In `tailwind.config.ts`, `import { BRAND, SKY } from "./lib/ui/palette"`; change the eight neutral colours to `rgb(var(--c-<key>) / <alpha-value>)`; add the BRAND colours, `backgroundImage: { sky: SKY }`, the three fontSizes, radii, widths/height above; `fontFamily.sans: ["var(--font-ui)", "system-ui", "sans-serif"]`, `fontFamily.brand: ["var(--font-brand)", "sans-serif"]`. Keep every existing token.
- [ ] **Step 6: Fonts + theme class.** In `app/layout.tsx` load `Bricolage_Grotesque` from `next/font/google` (`variable: "--font-brand"`, weights 400/500/600/800) and add its variable to `<html>`. Add `theme-forest` to `<body>` in the non-`bare` branch only.
- [ ] **Step 7: Verify tabular figures.** Run `npm run dev`, sign in, and in devtools set a test element to `font-family: var(--font-brand); font-variant-numeric: tabular-nums` with lines `1.11x` / `1.88x` / `10.00x`. If the digits align in columns, keep `--font-figure: var(--font-brand)`; if not, set `.theme-forest { --font-figure: var(--font-inter); }` and note it in the commit message.
- [ ] **Step 8: Run** `npm test && npx tsc --noEmit && npm run build` — all pass. Load `/login` and confirm it looks unchanged (screenshot `.context/t1-login.png`).
- [ ] **Step 9: Commit** `feat(redesign): forest palette as CSS variables, brand font, theme class`.

---

### Task 2: Survey-map contour generator

**Files:**
- Create: `lib/ui/contours.ts`, `lib/ui/contours.test.js`

**Interfaces:**
- Produces: `contourSvg(opts?: { width?: number; height?: number; lines?: number; color?: string; opacity?: number }): string` and `contourDataUri(opts?): string`. Defaults: width 1400, height 52, lines 14, color `#9BE7A9`, opacity 0.18.

- [ ] **Step 1: Write the failing tests:** default output contains exactly 14 `<path` elements; two calls return identical strings (deterministic); the SVG has `viewBox="0 0 1400 52"` and `preserveAspectRatio="none"`; `contourDataUri()` starts with `data:image/svg+xml,` and contains no raw `#`, `<` or `>` (encoded as `%23`, `%3C`, `%3E`); `lines: 3` yields 3 paths.
- [ ] **Step 2: Run** `node --test lib/ui/contours.test.js` — FAIL.
- [ ] **Step 3: Implement.** Each line `k` (0-based) is a polyline sampled every 8px of x from 0 to width, with
  `y = (-26 + 7k) + 9·sin(x/90 + 0.3k) + 5·sin(x/37 + 0.7k) + 10·sin(x/260)`
  (coordinates rounded to 1 decimal), stroke = color at the given opacity, width 0.8, no fill. This is the generator behind mockup `header-patterns.html` #5.
- [ ] **Step 4: Run** the test — PASS.
- [ ] **Step 5: Commit** `feat(redesign): survey-map contour generator for the header band`.

---

### Task 3: Shared portfolio loader and rail model

**Files:**
- Create: `lib/portfolio-data.ts`, `components/railModel.ts`, `components/railModel.test.js`
- Modify: `app/page.tsx` (use the loader; no visual change yet)

**Interfaces:**
- Consumes: `portfolioRows`, `currentCasefiles`, `queueCounts`, `PortfolioRow`, `PortfolioStatus` from `components/portfolioModel.ts`; `quarterLabel` from `lib/tests/extract-financials`.
- Produces:
  - `loadPortfolio(): Promise<PortfolioData>` wrapped in React `cache()` so the layout and the page share one read per request. `PortfolioData = { rows: PortfolioRow[]; facilities: { id: string; borrower_name: string; industry: string | null }[]; targetPeriod: string; targetLabel: string; counts: ReturnType<typeof queueCounts>; traceByCasefile: Map<string, unknown> }`. `traceByCasefile` holds `trace` only for casefiles whose status is `investigating` (second query, `.eq("status","investigating")`). Same queries, filters and `latestCompleteQuarterEnd` fallback as today's `app/page.tsx`.
  - `type RailDot = "breach" | "pass" | "decided" | "terms" | "untested"`.
  - `interface RailItem { facilityId: string; borrower: string; dscrText: string; belowMinimum: boolean; dot: RailDot; subline: string; href: string }`.
  - `railItems(rows: PortfolioRow[], opts?: { filterPath?: "/documents" | "/terms" }): RailItem[]` — keeps row order.
  - `TABS: readonly { href: string; label: string }[]` (the five tabs, in order) and `activeTab(pathname: string): string`.
  - `selectedFacility(pathname: string, loanParam: string | null, rows: PortfolioRow[]): string | null`.
  - `railDefaultCollapsed(pathname: string): boolean`.
  - `RAIL_PREF_KEY = "cs.rail.collapsed"`; `readRailPref(storage: { getItem(k: string): string | null } | null | undefined): boolean | null`.
  - `isRailToggleKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; targetTag?: string; targetEditable?: boolean }): boolean`.

- [ ] **Step 1: Write the failing tests** in `components/railModel.test.js` (build rows as plain objects with the `PortfolioRow` fields):
  - Open breach (`status: "breach_investigate"`, ours 1.12, required 1.25) → `{ dot: "breach", dscrText: "1.12x", belowMinimum: true, subline: "Breach · min 1.25x" }`; the same for `in_review`, `investigating`, `investigation_paused`, `awaiting_docs`.
  - `decided` → `dot "decided"`, `subline "Breach · decided"`. `compliant` (1.59 / 1.35) → `dot "pass"`, `subline "Pass · min 1.35x"`, `belowMinimum false`.
  - `not_tested` with `hasApprovedTerms: false` → `dot "terms"`, `subline "Terms awaiting approval"`, `dscrText "—"`, `belowMinimum false`. `not_tested` with terms and required 1.40 → `dot "untested"`, `subline "Not tested · min 1.40x"`; with required null → `"Not tested"`.
  - ours null with required 1.25 → `dscrText "—"`, `belowMinimum false`.
  - href: with `casefileId "c1"` → `/casefiles/c1`; without → `/facilities/F7/covenant-setup`; with `{ filterPath: "/documents" }` → `/documents?loan=F7` regardless of casefile.
  - `activeTab`: `/` and `/casefiles/x` → `/`; `/borrowers/new`, `/borrowers/F1/onboarding` → `/`; `/documents/abc` → `/documents`; `/terms` and `/facilities/F1/covenant-setup` → `/terms`; `/lessons` → `/lessons`; `/governance` → `/governance`.
  - `selectedFacility`: `/casefiles/c1` with a row whose `casefileId` is `c1` → that row's `facilityId`; `/facilities/F3/covenant-setup` → `F3`; `/documents` with loanParam `F5` → `F5`; `/` → `null`.
  - `railDefaultCollapsed`: true for `/lessons`, `/governance`; false for `/`, `/casefiles/x`, `/documents`, `/terms`, `/facilities/F1/covenant-setup`, `/borrowers/new`.
  - `readRailPref`: `"1"` → true; `"0"` → false; null → null; storage null/undefined → null; a storage whose `getItem` throws → null.
  - `isRailToggleKey`: `{ key: "[" }` → true; with `metaKey`/`ctrlKey`/`altKey` → false; `targetTag: "INPUT"` / `"TEXTAREA"` / `"SELECT"` → false; `targetEditable: true` → false; `{ key: "]" }` → false.
- [ ] **Step 2: Run** `node --test components/railModel.test.js` — FAIL.
- [ ] **Step 3: Implement `components/railModel.ts`.** Figures format as `n.toFixed(2) + "x"`. Open statuses = `breach_investigate | in_review | investigating | investigation_paused | awaiting_docs`.
- [ ] **Step 4: Implement `lib/portfolio-data.ts`** by moving the queries and row-building out of `app/page.tsx`; change `app/page.tsx` to call `loadPortfolio()` and render exactly what it renders today.
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit && npm run build` — PASS; `/` in dev looks unchanged.
- [ ] **Step 6: Commit** `feat(redesign): shared portfolio loader and rail model`.

---

### Task 4: The shell — forest header, top tabs, collapsible portfolio rail

**Files:**
- Create: `components/TopBar.tsx`, `components/PortfolioRail.tsx`
- Modify: `app/layout.tsx`, `lib/nav-data.ts` (now owns `export interface NavCounts`), `components/CommandPalette.tsx` (restyle trigger and dialog to the forest tokens)
- Delete: `components/NavRail.tsx`

**Interfaces:**
- Consumes: `contourDataUri` (Task 2); `loadPortfolio` (Task 3); `TABS`, `activeTab`, `railItems`, `selectedFacility`, `railDefaultCollapsed`, `readRailPref`, `RAIL_PREF_KEY`, `isRailToggleKey` (Task 3); `loadNavData`, `NavCounts`; `signOut` from `app/login/actions`; `demoUser()`.
- Produces:
  - `TopBar({ counts, search, user, contourUri }: { counts: NavCounts; search: SearchItem[]; user: { name: string; role: string }; contourUri: string })` — client.
  - `PortfolioRail({ rows, periodLabel }: { rows: PortfolioRow[]; periodLabel: string })` — client.

- [ ] **Step 1: TopBar.** `<header>` `h-header bg-brand` with the contour data URI as `background-image` (`aria-hidden` decoration, no layout impact). Left: wordmark `CreditScout` (`font-brand text-wordmark text-brand-on`) + `Bank of Stoic` (`text-label text-brand-on-2`), linking to `/`. Then `<nav aria-label="Sections">` rendering `TABS`; the active tab (`activeTab(pathname)`) is `bg-mint text-text font-semibold rounded-full` with `aria-current="page"`, the rest `text-brand-on-2 hover:text-brand-on`; show the NavRail's counts as a small number on Exceptions (`queue`), Documents, Covenant terms, Lessons when > 0. Right: the restyled `CommandPalette` trigger (translucent field on forest, `⌘K` hint) and an avatar button (`bg-mint text-text`, initials) that opens a small menu with the user's name, role and a Sign out `<form action={signOut}>`. Focus rings on the header are mint (`focus-visible:ring-mint ring-offset-brand`).
- [ ] **Step 2: PortfolioRail.** `<aside aria-label="Portfolio">` — expanded `w-rail bg-surface-raised border-r border-border`, own vertical scroll. Header row `Portfolio · {periodLabel}` / `{n} loans` in `text-label uppercase text-text-muted`. On `/documents*` or `/terms*`, first item "All loans" linking to the bare path, and items built with `railItems(rows, { filterPath })`; otherwise `railItems(rows)`. Each item: dot (breach `bg-danger`, pass `bg-success`, decided `bg-text-muted`, terms `bg-code`, untested hollow `ring-1 ring-text-muted`), borrower (truncate, `title` = full name), `dscrText` right-aligned `tabular-nums` (`text-danger` when `belowMinimum`), `subline` below in `text-label text-text-muted`. Selected (`selectedFacility(pathname, searchParams.get("loan"), rows)`) = `bg-brand text-brand-on rounded-xl`, its subline `text-brand-on-3`, its red figure `text-brand-danger`. Footer link `+ New borrower` → `/borrowers/new`.
- [ ] **Step 3: Collapse.** State starts at `railDefaultCollapsed(pathname)`; on mount, `readRailPref(window.localStorage)` (guarded — `localStorage` access itself in a try) overrides when non-null. A toggle button (`aria-expanded`, `aria-controls`) and a `keydown` listener using `isRailToggleKey({ key, metaKey, ctrlKey, altKey, targetTag: target.tagName, targetEditable: target.isContentEditable })` flip it and write `"1"`/`"0"` under `RAIL_PREF_KEY` (write also guarded). Collapsed = `w-rail-collapsed` strip of dots only, each a link with `title="{borrower} · {dscrText}"` and an `aria-label`.
- [ ] **Step 4: Layout.** In the non-`bare` branch of `app/layout.tsx`: load `loadNavData()` and `loadPortfolio()` in parallel (a portfolio failure renders the rail empty, mirroring `loadNavData`'s catch); render `<TopBar …contourUri={contourDataUri()} />` then a flex row of `<PortfolioRail rows periodLabel={targetLabel} />` and `<main className="min-w-0 flex-1 px-6 py-8 md:px-8">` (keep the `max-w-content` wrapper). Delete `components/NavRail.tsx`; move `NavCounts` into `lib/nav-data.ts`. Below `md`, the rail starts collapsed and the tab row scrolls horizontally.
- [ ] **Step 5: Verify.** `npm test && npx tsc --noEmit && npm run build` pass. In dev: every tab highlights correctly (including `/casefiles/<id>` → Exceptions, covenant setup → Covenant terms); `[` toggles the rail, but typing `[` into the ⌘K search does not; collapsed state survives a reload; Lessons opens collapsed by default; the "Review Focus" long-name check. Screenshots `.context/t4-shell-open.png`, `.context/t4-shell-collapsed.png`. `/login` and `/welcome` unchanged.
- [ ] **Step 6: Commit** `feat(redesign): forest header, top tabs and collapsible portfolio rail`.

---

### Task 5: Pipeline model

**Files:**
- Create: `components/pipelineModel.ts`, `components/pipelineModel.test.js`

**Interfaces:**
- Consumes: `PortfolioRow`, `isReopened` (`portfolioModel.ts`); `activityTitle` (`traceModel.ts`).
- Produces:
  - `type LaneKey = "investigate" | "working" | "decision" | "decided"`.
  - `LANES: readonly { key: LaneKey; title: string; empty: string }[]` = Needs investigating / "Nothing waiting."; CreditScout working / "Nothing running. Investigations move here live."; Awaiting your decision / "Nothing waiting for you."; Decided / "Nothing decided this quarter yet."
  - `interface PipelineCard { facilityId: string; borrower: string; ours: number | null; theirs: number | null; required: number | null; status: PortfolioStatus; casefileId: string | null; exceptionId: string | null; exceptionStatus: string | null; recommendation: string | null; note: string | null; action: "investigate" | "review" | "open" | null; reopened: boolean; steps: string[] }`.
  - `pipelineLanes(rows: PortfolioRow[], stepsByCasefile?: Map<string, string[]>): { key: LaneKey; title: string; empty: string; cards: PipelineCard[] }[]` — always four lanes, in `LANES` order.
  - `barGeometry(ours: number | null, required: number | null): { fillPct: number; minPct: 50 } | null`.
  - `latestSteps(trace: unknown, n?: number): string[]` (default n 3).
  - `PIPELINE_REFRESH_MS = 5000`.

- [ ] **Step 1: Write the failing tests:**
  - Lane mapping: `breach_investigate` → investigate, `action "investigate"`; `investigating` → working, `action null`; `investigation_paused` → working, `note "Investigation paused"`, `action "open"`; `in_review` → decision, `action "review"`; `awaiting_docs` → decision, `note "Held for borrower documents"`, `action "review"`; `decided` → decided, `action "open"` with a casefile and `null` without.
  - `compliant` and `not_tested` rows appear in no lane; with only those rows all four lanes exist with empty `cards`.
  - A failed-investigation case (`status "breach_investigate"`, `casefileId null`, `exceptionStatus "new"`) → investigate lane, `action "investigate"`, `reopened false`; with `casefileId "c9"` and `exceptionStatus "new"` → `reopened true`.
  - `stepsByCasefile` = `Map([["c1", ["a","b"]]])` fills `steps` for the working card with `casefileId "c1"`; other cards get `[]`.
  - `barGeometry(1.12, 1.25)` → `{ fillPct: 44.8, minPct: 50 }`; `(1.59, 1.35)` → `fillPct 58.9`; `(4, 1.25)` → `fillPct 100`; `(null, 1.25)`, `(1.1, null)`, `(1.1, 0)` → `null`.
  - `latestSteps` of a three-entry trace `[{tool:"search_documents"},{tool:"dscr_calculator"},{tool:"search_past_cases"}]` with `n: 2` returns the `activityTitle` of the last two tools, newest last; non-array input → `[]`.
- [ ] **Step 2: Run** `node --test components/pipelineModel.test.js` — FAIL.
- [ ] **Step 3: Implement.** `fillPct = clamp(round1(ours / (2 * required) * 100), 0, 100)` — the loan's own minimum always sits at the bar's midpoint.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(redesign): pipeline lanes and headroom bar model`.

---

### Task 6: Exceptions home — the deal pipeline

**Files:**
- Create: `components/Pipeline.tsx`, `components/PipelineCard.tsx`, `components/PipelineAutoRefresh.tsx`
- Modify: `app/page.tsx`, `components/InvestigateButton.tsx`, `components/RunTestButton.tsx`, `components/UploadPackage.tsx` (token migration only)
- Delete: `components/PortfolioTable.tsx` (keep every `portfolioModel.ts` export — its tests use them)

**Interfaces:**
- Consumes: `loadPortfolio` (Task 3); `pipelineLanes`, `barGeometry`, `latestSteps`, `PIPELINE_REFRESH_MS`, `LANES` (Task 5); `InvestigateButton({ exceptionId, status, hasCasefile })` unchanged in behaviour (it still navigates to the casefile, which drives the live run).
- Produces: `Pipeline({ lanes })`, `PipelineCard({ card })`, `PipelineAutoRefresh({ active }: { active: boolean })` (client; while `active`, `router.refresh()` every `PIPELINE_REFRESH_MS`, cleared on unmount or when inactive).

- [ ] **Step 1: Page.** `app/page.tsx`: eyebrow `Covenant monitoring · {targetLabel}`, `<h1>` **Exceptions**, `RunTestButton` (same props as today), the `SummaryStrip` restyled, then `<Pipeline lanes={pipelineLanes(rows, steps)} />` where `steps` maps each `traceByCasefile` entry through `latestSteps`, then the upload section. Remove the header "+ Add borrower" link (the rail carries "+ New borrower"). Render `<PipelineAutoRefresh active={lanes working-lane has cards} />`. Keep `dynamic` and `maxDuration`.
- [ ] **Step 2: Lanes.** Four columns (`grid-cols-4`, stacking to one column below `md`); lane `bg-surface-raised rounded-2xl p-3`, heading row `title` + count. The working lane uses `bg-sky`. Empty lane: dashed `border-border-strong rounded-xl` box with the lane's `empty` sentence.
- [ ] **Step 3: Card.** `bg-surface border border-border rounded-xl p-3`: borrower (truncate + title); `text-figure-sm tabular-nums`, `text-danger` when below minimum; headroom bar from `barGeometry` (track `bg-surface-raised`, fill `bg-danger` below / `bg-text` at-or-above, a `bg-text` tick at `minPct`), omitted when null; `min {required}x · reported {theirs}x` (`text-label text-text-muted`, parts omitted when null); `note` when set; when `recommendation` is set, the agent tag (`bg-agent-bg text-agent-ink rounded-sm`, a `bg-agent` dot, text "CreditScout") followed by `recommends <b>{recommendation}</b>`; working-lane cards list `steps` with an "Investigating" agent tag; one action — `investigate` → `InvestigateButton` (restyled `bg-mint text-text hover:bg-mint-hover rounded-lg`), `review` → link "Review" styled the same to `/casefiles/{id}`, `open` → whole card links to the casefile; decided cards render at reduced emphasis (`text-text-muted` figures, grey bar). Keep the "reopened" marker from `InvestigateButton`.
- [ ] **Step 4: Migrate tokens** in `InvestigateButton.tsx`, `RunTestButton.tsx`, `UploadPackage.tsx`: primary `bg-model … hover:bg-model-bright` → `bg-mint text-text hover:bg-mint-hover`; `text-model-bright` links → `text-text underline decoration-border-strong hover:decoration-text`; `border-model` → `border-text`; `bg-model-bg` → `bg-surface-raised`.
- [ ] **Step 5: Verify.** Tests, typecheck, build pass. In dev with the seeded book: Coastal Marine in Needs investigating, Harbor Logistics in Awaiting your decision with the agent tag, Northgate Foods in Decided; Costko, Dokusign, Peat's absent from the pipeline but present in the rail. Click Investigate on a breach → the casefile opens and runs; return to `/` while it runs → the card sits in the sky lane and its steps update without a manual reload. Screenshot `.context/t6-pipeline.png`. `grep -nE "(bg|text|border|ring)-model" app/page.tsx components/{Pipeline,PipelineCard,InvestigateButton,RunTestButton,UploadPackage}.tsx` returns nothing.
- [ ] **Step 6: Commit** `feat(redesign): deal pipeline replaces the queue table`.

> **Billing note:** a live investigation spends Foundry tokens (cents). One run to verify Step 5 is fine; do not loop it.

---

### Task 7: Casefile and live investigation

**Files:**
- Modify: `app/casefiles/[id]/page.tsx`, `components/CasefileView.tsx`, `components/CasefileFindings.tsx`, `components/RecommendationCard.tsx`, `components/RecommendationBadge.tsx`, `components/ReviewActions.tsx`, `components/ReviewNotices.tsx`, `components/OverrideDialog.tsx`, `components/ReinvestigateButton.tsx`, `components/GuardrailNotice.tsx`, `components/LiveTrace.tsx`, `components/TraceStep.tsx`, `components/TraceArc.tsx`, `components/ClaimList.tsx`, `components/CitationChip.tsx`, `components/CalcTable.tsx`, `components/CalcValue.tsx`, `components/SeenSimilarBadge.tsx`, `components/TestResultCard.tsx`, `components/VarianceBadge.tsx`, `components/FinishClosing.tsx`

**Interfaces:**
- Consumes: Task 1 tokens. No model or data changes — `casefileModel.ts`, `traceModel.ts`, `enforcementModel.ts`, `noticeGroups.ts` and their tests are untouched.

- [ ] **Step 1: Breadcrumb.** Replace the "Credit Analysis Queue / {borrower}" breadcrumb with `← Pipeline / {borrower}` (link to `/`). `grep -rn "Credit Analysis Queue" app components` and update any remaining user-facing copy to "Exceptions".
- [ ] **Step 2: Header block.** Identity line `Loan {id} · {period} · Terms v{n} · {state}` in `text-label uppercase text-text-muted`; borrower `text-title font-brand`; the three figures (Computed DSCR · Borrower reported · Minimum) as `text-figure tabular-nums` with labels above, computed in `text-danger` when below minimum. Provenance (`calc_id`, amber code marker) stays.
- [ ] **Step 3: Recommendation card.** `bg-sky rounded-2xl`; eyebrow is the agent tag "CreditScout recommends" (`bg-agent-bg text-agent-ink`, `bg-agent` dot); headline in `font-brand` 800; basis line (citations · calculations · terms vN) in `text-text-secondary`. The outcome mark keeps its `success`/`danger`/`human` colours. Decision buttons below: Accept = `bg-mint text-text`; "Record a different decision" and "Hold for borrower documents" = bordered `rounded-lg border-border-strong bg-surface`.
- [ ] **Step 4: Live trace.** Steps by the CreditScout Agent or a specialist (`traceStepKind` agent/specialist kinds) get the agent tag and an `agent` left edge; calculator and guardrail steps keep amber (`code`), with amber still reserved on this screen for "the calculation cannot proceed"; the connection-health line stays separate. The "seen similar" memory badge uses the agent tag. Retire every `model*` class: interactive → mint/text rules from Task 6 Step 4; agent provenance → `agent`, `agent-ink`, `agent-bg`.
- [ ] **Step 5: Verify.** Tests, typecheck, build pass. `grep -nE "(bg|text|border|ring)-model" <every file in this task>` returns nothing. In dev: open Harbor Logistics (pending review) and Northgate Foods (decided); open a failed or paused casefile if one exists. Screenshots `.context/t7-casefile.png`, `.context/t7-decided.png`.
- [ ] **Step 6: Commit** `feat(redesign): casefile and live trace on the forest/sky system`.

---

### Task 8: Documents and Covenant terms, with the rail as a loan filter

**Files:**
- Create: `components/loanFilter.ts`, `components/loanFilter.test.js`
- Modify: `app/documents/page.tsx`, `app/documents/[id]/page.tsx`, `app/terms/page.tsx`, `components/DocumentLibrary.tsx`, `components/DocumentList.tsx`, `components/TermsList.tsx`, `components/TermRow.tsx`

**Interfaces:**
- Produces: `filterByLoan<T extends { facility_id: string }>(items: T[], loan: string | null | undefined): T[]` and `loanParam(searchParams: Record<string, string | string[] | undefined>): string | null`.

- [ ] **Step 1: Failing tests:** `filterByLoan(items, null)` and `(items, "")` return all items; `(items, "F5")` returns only `facility_id === "F5"`; an unknown id returns `[]`. `loanParam({ loan: "F5" })` → `"F5"`; `{ loan: ["F5","F7"] }` → `"F5"`; `{}` → `null`.
- [ ] **Step 2: Run** `node --test components/loanFilter.test.js` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Pages.** `/documents` and `/terms` read `searchParams` (async in this Next version — follow the existing page's pattern), apply `filterByLoan`, and show the borrower's name in the heading when filtered ("Documents · Coastal Marine") with a "Show all loans" link. Restyle the library, list, terms list and rows to the new tokens; migrate every `model*` class as in Task 6 Step 4.
- [ ] **Step 6: Verify.** Tests, typecheck, build pass; grep for `model` classes in the task's files returns nothing. In dev, clicking a loan in the rail on Documents filters the list and highlights the loan; "All loans" clears it. Screenshot `.context/t8-documents-filtered.png`.
- [ ] **Step 7: Commit** `feat(redesign): documents and terms restyled, rail filters by loan`.

---

### Task 9: Covenant setup and onboarding

**Files:**
- Modify: `app/facilities/[id]/covenant-setup/page.tsx`, `app/borrowers/new/page.tsx`, `app/borrowers/[id]/onboarding/page.tsx`, `components/CovenantSetup.tsx`, `components/TermsDiffTable.tsx`, `components/TermEditor.tsx`, `components/ApproveBar.tsx`, `components/ClausePanel.tsx`, `components/UncitedClauses.tsx`, `components/ProposeTrace.tsx`, `components/LockedPolicyValue.tsx`, `components/NewBorrowerForm.tsx`, `components/OnboardingStepper.tsx`

- [ ] **Step 1: Restyle** to the new tokens: approve bar primary = `bg-mint text-text`; the "What this proposal changes" diff keeps its semantic colours; the clause panel uses `rounded-2xl`, `shadow-raised` allowed (it slides in); the onboarding stepper's current step = `bg-brand text-brand-on`, done steps = `text-text` with a check, future = `text-text-muted`. `ProposeTrace` agent steps (term extraction is model work) get the agent tag. Migrate every `model*` class as in Task 6 Step 4.
- [ ] **Step 2: Verify.** Tests, typecheck, build pass; grep for `model` classes in these files returns nothing. In dev: open `/facilities/<F7 id>/covenant-setup` and `/borrowers/new` (do not submit — onboarding creates real rows). Screenshots `.context/t9-setup.png`, `.context/t9-onboarding.png`.
- [ ] **Step 3: Commit** `feat(redesign): covenant setup and onboarding on the forest system`.

---

### Task 10: Lessons, Governance, and the retired-token guard

**Files:**
- Create: `components/workspaceTokens.test.js`
- Modify: `app/lessons/page.tsx`, `app/governance/page.tsx`, `components/LessonList.tsx`, `components/Scoreboard.tsx`, `components/GovernancePanel.tsx`, `components/GovernanceView.tsx`, `components/DocumentList.tsx` if still flagged, and any file the new test flags

- [ ] **Step 1: Write the guard test:** walk every `.ts`/`.tsx` under `app/` and `components/`, excluding `app/welcome/**`, `app/login/**` and `components/Logo.tsx`; assert no match for `/\b(bg|text|border|ring|from|to|fill|stroke|outline|decoration|divide)-(model|sunken|night)(-[a-z-]+)?\b/`. On failure, list `file:line` of every hit.
- [ ] **Step 2: Run** `node --test components/workspaceTokens.test.js` — expect FAIL listing the Lessons/Governance files (and anything earlier tasks missed).
- [ ] **Step 3: Restyle** Lessons and Governance (scoreboard pillars Honest/Harmless/Helpful keep "—" for unmeasured; figures `tabular-nums`) and fix every hit the test lists.
- [ ] **Step 4: Run** `npm test` — PASS (the guard included). Typecheck and build pass. Screenshots `.context/t10-lessons.png`, `.context/t10-governance.png` (rail collapsed by default on both).
- [ ] **Step 5: Commit** `feat(redesign): lessons and governance restyled; guard against retired tokens`.

---

### Task 11: Documentation

**Files:**
- Modify: `docs/design.md`, `CLAUDE.md`, `docs/HANDOFF.md`, `docs/mental-model.md` (screen inventory only)

- [ ] **Step 1: `docs/design.md`.** Rewrite §1–§5 to the spec: the land/sky rule replaces "teal = model"; the colour table from `lib/ui/palette.ts` (state that `palette.ts` and `globals.css` are the source and the test keeps them in step); type (Bricolage for UI, the Task 1 tnum decision for figures, JetBrains Mono for identifiers); the shell (header, tabs, rail, collapse rules); the pipeline; shapes. Record in §9 (change log) what changed on 2026-11-07 and why (manager feedback: "looks vibe-coded"). Keep a short note that `/welcome` and `/login` still use the classic tokens.
- [ ] **Step 2: `CLAUDE.md`.** Update the hard-constraint lines: "Figures and dates are Inter …" → the Task 1 outcome; add "**Sky means the CreditScout Agent; mint means interactive; neither is a status.**"; keep the green and amber rules verbatim; replace "light workspace, graphite shell, one teal accent" in the docs table with "forest header, portfolio rail, sky for the agent".
- [ ] **Step 3: `docs/HANDOFF.md` §0** — add a dated (2026-11-07) entry: the redesign, where the spec/plan/mockups live, and that production is unchanged until the owner signs off the Preview. **`docs/mental-model.md`** — screen inventory: "Credit Analysis Queue (table)" → "Exceptions (pipeline)", NavRail → header tabs + portfolio rail.
- [ ] **Step 4: Commit** `docs(redesign): design system, CLAUDE.md and handoff updated for Forest`.

---

### Task 12: Preview deployment, owner walkthrough, production

Gated: steps marked **OWNER** need the owner's explicit go-ahead in chat. Do not proceed past a gate without it.

- [ ] **Step 1: Final local gate.** `npm test && npx tsc --noEmit && npm run build` — all pass. Record the test count.
- [ ] **Step 2: OWNER — copy settings to Preview.** Ask the owner to approve copying these Production variables to Preview: `FOUNDRY_ORCHESTRATOR_AGENT_ID`, `DEMO_USERNAME`, `DEMO_PASSWORD`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`. On approval: `vercel env pull .context/prod.env --environment=production`, then for each name `printf %s "$VALUE" | vercel env add NAME preview`, then `rm .context/prod.env`. Confirm with `vercel env ls` that each now lists `Preview`. (The agent's tool calls keep going to the production host via its existing `PUBLIC_BASE_URL`; tool routes are unchanged by this redesign, and both share the synthetic database.)
- [ ] **Step 3: Deploy a preview.** `git push` the branch, then `vercel deploy` (no `--prod`); capture the Preview URL from its output.
- [ ] **Step 4: Smoke the preview.** `curl -s -o /dev/null -w "%{http_code}" <url>/` returns 307 or 200 (or 401 if Vercel deployment protection is on — then the owner opens it while signed in to Vercel). Hand the URL to the owner.
- [ ] **Step 5: OWNER — walkthrough.** The owner signs in and walks: pipeline → Investigate a breach (watch it run; return to the pipeline mid-run and see the sky lane) → casefile → decide → Documents (filter by a loan) → Covenant terms → covenant setup → `/borrowers/new` → Lessons → Governance → collapse/expand the rail. Fix anything raised, as new commits, redeploy the preview, repeat until the owner signs off.
- [ ] **Step 6: OWNER — production.** Only on explicit sign-off: `vercel --prod`. Verify `https://credit-scout.vercel.app/login` renders, sign in, the pipeline loads, and `curl` of `/api/tests/run` still returns 307 (session gate intact).
- [ ] **Step 7: Commit** any final fixes; note the production deploy (date, commit) in `docs/HANDOFF.md` §0.
