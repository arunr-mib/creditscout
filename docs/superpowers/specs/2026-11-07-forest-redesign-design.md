# CreditScout redesign — "Forest" (post-login screens)

**Date:** 2026-11-07 · **Status:** draft for owner approval · **Owner:** Arun Rajendiran
**Mockups (open in a browser):** `docs/design-mockups/2026-11-07-forest/`
- `forest-sky-pipeline-and-case.html` — **the approved direction**: home (idle), home (investigation running), case open
- `layout-flip.html` — the layout, incl. the rejected side-panel alternative (screen 3)
- `header-patterns.html` — the header pattern; **#5 Contour lines** is the one chosen

---

## 1. Why

After a demo, the owner's manager said the functionality is good but the UI "looks like a usual Claude-Code vibe-coded app" — the style and colour theme looked familiar. The current shell (dark graphite left rail, light workspace, one teal accent, Inter, rounded white cards, pill badges) is the default look of most AI-built dashboards.

The redesign must make CreditScout look **designed for a bank**, not generated — while keeping every behaviour, every rule about traceability, and every test that exists today.

## 2. Goals, non-goals, anti-goals

**Goals**
- A visual identity that is recognisably CreditScout's own: forest green, survey-map contours, a "sky" that marks the AI agent's work.
- A layout built around the analyst's job: the portfolio always at hand on the left, sections across the top, a **deal pipeline** instead of a spreadsheet-style queue.
- Every post-login screen restyled consistently.
- Shipped first to a **Vercel Preview (test) site**, walked end-to-end by the owner, and only then promoted to production.

**Non-goals**
- The public landing page (`/welcome`) and the sign-in page (`/login`) are **not** redesigned. *(Sign-in excluded is the designer's reading of "start from the post-login screen" — owner may override.)*
- No change to the agent, `calc/dscr.js`, `guardrails/*.js`, the schema, the API routes, the eval harness or the oracle.
- No new product features (due dates, defer — parking-lot §7c stay parked).

**Anti-goals — the redesign has failed, even if it "works", if:**
- It reads as Claude's own look: warm cream page + serif headlines + soft rounded cards.
- It reads as the generic AI dashboard: dark left sidebar, Inter-only, teal/indigo/purple accent, pill tags, purple gradients.
- An analyst can no longer tell at a glance **what code computed** vs **what the agent said** vs **what a human decided**.
- Green can be mistaken for "passing" when it is only branding.

## 3. The look

### 3.1 Two layers: land and sky
The organising idea. **Land** is the bank's facts; **sky** is the agent's reasoning.

| Layer | Carries | Visual |
|---|---|---|
| **Land** | Computed figures, approved terms, decisions, navigation | Forest green, white surfaces, mint for actions, red for breach |
| **Sky** | Anything the CreditScout Agent produced or is producing | A soft blue→aqua gradient + a blue "CreditScout" tag with a dot |

Sky appears **only** in: the "CreditScout working" pipeline lane, behind a recommendation, on agent steps in the live trace, and as the tag on any agent-produced text. Nowhere else.

### 3.2 Colour
| Role | Value | Use — and only this |
|---|---|---|
| Forest | `#0F2B22` | Header band; selected loan in the portfolio list; headings/ink |
| Forest ink 2 / 3 | `#3E5A50` / `#566D61` (the mockups' `#6E8679` fails AA at 3.93:1) | Body copy / labels and captions |
| Mist | `#EEF3EF` | Portfolio rail background, pipeline lanes, quiet panels |
| Line | `#DCE6DF` (hairline), `#BFD0C5` (strong) | Borders |
| Mint | `#9BE7A9` on forest text | **Interactive only**: primary buttons, the active top tab, the avatar. Never a status. |
| Sky gradient | `linear-gradient(160deg,#D6E8FF 0%,#C9ECEB 55%,#E4F6EE 100%)` | Agent surfaces (see 3.1) |
| Agent tag | bg `#DCEBFF`, text `#123A6B`, dot `#3D7FD6` | "CreditScout" / "Investigating" / "CreditScout recommends" |
| Red | `#C2271F` (text), `#FFB4A8` (on forest) | Breach, failed test, escalate — unchanged meaning |
| Pass green | today's `success` `#15803D` | Verified pass / recorded resolution only — unchanged meaning |
| Amber | today's `code` `#B45309` | Code computed this — unchanged meaning; on the live investigation screen still means exactly "the calculation cannot proceed" |

Contrast: every text/background pair must clear WCAG AA (4.5:1 body, 3:1 large). Mint is a fill with forest text, never text on white.

**Rule changes this implies (docs/design.md and CLAUDE.md must be updated as part of the work):**
- Today `model` (teal) means *both* "a model did this" *and* "interactive". That splits: **interactive → mint**, **agent → sky**. Teal is retired.
- Amber keeps "code computed this". Red, pass-green and the human/slate meanings are unchanged.

### 3.3 Header band
- Height ~52px, full width, forest `#0F2B22`.
- **Survey-map contour lines**: ~14 faint lines in mint at ~18% opacity, drawn as an SVG background (see `header-patterns.html` #5 for the exact generator: summed sines per line). Purely decorative, `aria-hidden`.
- Left: wordmark **CreditScout** (Bricolage Grotesque 800, ~19px) + "Bank of Stoic" small at 65% opacity.
- Then the **section tabs** (3.5). Right: search field (⌘K, opens the existing command palette) and the user avatar (mint circle, forest initials).

### 3.4 Type
- **UI and display:** Bricolage Grotesque (Google font, via `next/font`). Headings 800 with slight negative tracking; body 400/500.
- **Figures and dates:** must keep `tabular-nums`. **Builder must verify** Bricolage Grotesque supports the `tnum` feature; if it does not, figures and dates stay in Inter with `tabular-nums` (current rule). Either way, columns of figures must align.
- **Identifiers** (`calc_id`, citations, field paths, tool names): monospace, as today (JetBrains Mono).
- A verbatim clause is prose, not code — unchanged.
- Big figures (DSCR on cards and casefile): ~24–34px, weight 800.

### 3.5 Shape and depth
- Corners: ~14px on cards and selected rows, ~12px on buttons, 16–18px on lanes. No pill tags for status — status is a coloured **dot + word**.
- Depth from tone (mist vs white) and hairlines, not shadows — consistent with the current no-`boxShadow` rule, except the slide-in menus/palette which may use the existing `shadow-raised`.

## 4. The layout ("the flip")

### 4.1 Shell (every post-login screen)
```
┌──────────────────────── forest header: wordmark · tabs · search · avatar ────────────────────────┐
├──────────────┬────────────────────────────────────────────────────────────────────────────────────┤
│ Portfolio    │                                                                                    │
│ rail         │  page content                                                                      │
│ (collapsible)│                                                                                    │
└──────────────┴────────────────────────────────────────────────────────────────────────────────────┘
```
- **The dark left nav rail (`NavRail`) is removed.** Its items move to the header tabs.
- **Top tabs:** Exceptions · Documents · Covenant terms · Lessons · Governance. Active tab = mint fill. Counts that the rail shows today (e.g. pending reviews) may appear as a small number on the tab.
- **Portfolio rail (left, ~260px):** header "Portfolio · Q2 2026 · N loans", then every loan: status dot, borrower name, computed DSCR (red if below its own minimum), and a second line ("Breach · min 1.25x", "Pass · min 1.35x", "Breach · decided", "Terms awaiting approval"). "+ New borrower" at the bottom. Selected loan = solid forest row, white text.
  - Status dot: red = breach (open), green = pass, grey = decided, amber = terms awaiting approval, hollow grey ring = not tested.
- **Collapsible, always.** A control collapses it to a ~44px strip showing one status dot per loan (hover = name + DSCR). Keyboard `[` toggles. The analyst's choice is remembered (localStorage).
- **Default state per tab:** open on Exceptions, Documents, Covenant terms (and casefile, onboarding, covenant setup); collapsed on Lessons and Governance. A remembered user choice overrides the default.
- **Clicking a loan in the rail:** opens that loan's current casefile if it has one; otherwise its covenant setup / terms; on Documents and Covenant terms it **filters** that page to the loan, with "All loans" at the top of the rail to clear.

### 4.2 Exceptions (home, `/`) — the deal pipeline
Replaces `PortfolioTable`. Four lanes, left to right:

| Lane | Contains (`PortfolioStatus`) | Card action |
|---|---|---|
| **Needs investigating** | `breach_investigate` (incl. reopened — keep the "reopened" marker) | **Investigate** (existing `InvestigateButton` behaviour) |
| **CreditScout working** — *sky lane* | `investigating`, `investigation_paused` | none while running; card shows the latest step summaries from the casefile's `trace` and "Step n of up to 8" (`steps_count`); paused shows the existing paused notice and a resume/re-run. While any card is in this lane the page refreshes its data every few seconds (reuse the casefile page's polling approach or `router.refresh`) and stops when the lane empties |
| **Awaiting your decision** | `in_review`, and `awaiting_docs` labelled "Held for borrower documents" | **Review** → opens casefile |
| **Decided** | `decided` | opens casefile (read-only), card faded |

- Card: borrower, big computed DSCR (red when below minimum), a headroom bar with a tick at the loan's own minimum, "min X · reported Y", the agent tag + one-line recommendation when one exists, one action. **One next action per card** (existing rule).
- `compliant` and `not_tested` loans do **not** appear in the pipeline — only in the portfolio rail.
- Above the lanes keep what the queue has today that is not per-loan: the quarter, **Run covenant tests**, the counts summary, the document drop zone. Their placement is the builder's call within the look.
- Empty lane: dashed outline + one plain sentence ("Nothing running. Investigations move here live.").
- The decided/held/`awaiting_docs` placement of `awaiting_docs` is a designer's call (§8).

### 4.3 Casefile (`/casefiles/[id]`) — opens in the middle
- The pipeline is replaced by the casefile; the loan is highlighted in the rail; breadcrumb **"← Pipeline / Borrower"**.
- Order: identity line (loan id · period · terms version · state) → borrower name → the three figures (Computed DSCR · Borrower reported · Minimum) → **recommendation card on the sky** with the "CreditScout recommends" tag → decision buttons (Accept · Record a different decision · Hold for documents) → findings, evidence, documents, as today.
- All existing content, guardrail notices, provenance (`calc_id`, citations), the governing-first rules and the amendment-status panel stay — restyled, not removed.
- **Live investigation** plays out on this same page (as today): agent steps get the sky treatment; amber still means only "the calculation cannot proceed"; the connection-health line stays separate from run state.
- The **side-panel alternative** (layout-flip screen 3) was considered and **rejected**: the evidence must be read before a decision, and only the full page has room for it.

### 4.4 The other screens — restyle within the shell
Same content and behaviour as today; new shell, colours, type and shapes.

| Route | Screen | Notes |
|---|---|---|
| `/documents`, `/documents/[id]` | Document library / document view | Rail open; rail selection filters to that loan |
| `/terms` | Covenant terms list | Rail open; filters by loan |
| `/facilities/[id]/covenant-setup` | Terms review & approval | Rail open; the diff table, checklist and approve bar restyled |
| `/lessons` | Lessons | Rail collapsed by default |
| `/governance` | Governance / scoreboard | Rail collapsed by default; "—" for unmeasured stays |
| `/borrowers/new`, `/borrowers/[id]/onboarding` | Onboarding wizard | Rail open; stepper restyled |
| Command palette (⌘K) | Search | Restyled to the new tokens |

## 5. Constraints (from CLAUDE.md and the codebase — all still apply)
- **Tailwind's `spacing`, `fontSize`, `boxShadow` scales are replaced, not extended.** New sizes must be added to the config, not assumed (`h-10` etc. do not exist).
- Figures/dates `tabular-nums`; monospace only for identifiers.
- Green = verified pass or recorded resolution, never a screen state. Mint is not green-for-pass and must never be used as a status.
- Every calculated figure keeps its provenance.
- User-facing vocabulary unchanged: "CreditScout Agent", "loan" (never "facility").
- `npm test`, `tsc --noEmit` and `npm run build` stay green. View-model tests (`*Model.test.js`) keep passing; the pipeline should be driven by the existing `portfolioModel` statuses rather than new logic.
- No new runtime dependencies beyond the Google font via `next/font`.
- `docs/design.md` is rewritten to match this document (it is the source of truth for visuals); CLAUDE.md's visual rules (Inter, teal) updated accordingly.
- **Keep the `night-*` tokens and the landing/login styling intact** — `/welcome` and `/login` are out of scope and must render exactly as today. The root layout's `bare` branch stays.

## 6. Delivery — test site before production
1. Build on a branch; a push creates a **Vercel Preview** deployment (production deploys only via explicit `vercel --prod`).
2. **Before the first preview:** the Preview environment is missing 8 variables production has — `FOUNDRY_ORCHESTRATOR_AGENT_ID`, `DEMO_USERNAME`, `DEMO_PASSWORD`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET` (and `PUBLIC_BASE_URL` if the agent's tool calls must hit the preview host). Copy them to Preview **with the owner's go-ahead**.
3. The preview shares production's Supabase database and Foundry agent (synthetic data only). An investigation run on the preview appears on the live site too. Accepted by default; owner may ask for isolation.
4. Owner walks the full flow on the preview: sign in → pipeline → investigate (watch it move through the sky lane) → casefile → decide → documents → terms approval → onboarding → lessons → governance.
5. Only after sign-off: `vercel --prod`.

## 7. Acceptance
- Every post-login route renders in the new shell; no `NavRail` remains.
- Side-by-side with the anti-goals (§2): no cream+serif, no dark sidebar, no teal.
- On the pipeline and a casefile, a reviewer can point to: what code computed (figures, amber provenance), what the agent said (sky + tag), what a human decided — without reading labels.
- The portfolio rail collapses/expands with the control and `[`, remembers the choice, and follows per-tab defaults.
- All tests, typecheck and build pass; the full flow works on the Preview URL; owner signs off.

## 8. Calls made by the designer (owner: check these)
- Sign-in page excluded with the landing page.
- `awaiting_docs` ("Held for borrower documents") sits in the **Awaiting your decision** lane, labelled, rather than a fifth lane.
- `investigation_paused` sits in the sky lane with the existing paused notice.
- Clicking a loan in the rail opens its current casefile; with none, its terms.
- Status dots keep amber for "terms awaiting approval" (amber = code/terms machinery, consistent with today).
- If Bricolage lacks `tnum`, figures stay in Inter.

## 9. Left to the builder
Component breakdown (e.g. `TopBar`, `PortfolioRail`, `Pipeline`, `PipelineCard`), token names in `tailwind.config`, exact spacing, responsive behaviour below `md` (suggest: rail collapsed by default, tabs scroll horizontally), placement of Run-tests / summary / drop zone on the home page, and how the contour SVG is generated (static file vs inline).
