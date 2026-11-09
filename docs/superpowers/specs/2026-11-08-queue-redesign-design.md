# CreditScout Exceptions queue — table redesign

**Date:** 2026-11-08 · **Status:** Approved 2026-11-09, mockups reviewed · **Owner:** Arun Rajendiran
**Supersedes, on the Exceptions screen only:** the four-lane kanban pipeline built
2026-11-08 (`components/Pipeline.tsx`, `PipelineCard.tsx`, `PipelineAutoRefresh.tsx`,
`pipelineModel.ts`) — kept, not deleted, as a secondary view (§4).
**Research this argues from:** owner-supplied UX research,
`.context/attachments/0lUddb/CreditScout Queue UX Research.html` (8 Nov 2026,
~25 sourced findings across finance vendors and non-finance triage products).
This document uses that research's *findings*, not its visual design — the
screen below is built in CreditScout's own tokens (forest, mint, sky, Inter),
not the research artifact's own palette or Spectral serif.

---

## 1. Why

Two complaints drove this, in order:

1. **"This looks like a usual vibe-coded app"** (the manager, 2026-11-07) — answered
   by the Forest redesign already shipped: forest header, Inter, no teal, no
   coloured stripes.
2. **"This kanban style doesn't look user-friendly for credit analysts"** (the
   owner, 2026-11-08) — this document answers that one. The owner then
   commissioned research rather than guess, and the research's headline finding
   is blunt: **no credible finance vendor was found shipping a kanban as the
   covenant queue.** The pattern the literature converges on — in finance and
   in the best non-finance triage products (Linear, FICO Falcon, Sentry, AML
   desks, hospital inboxes) — is a dense table, sorted by risk, with the
   selected item's full investigation opening in place beneath it, worked
   keyboard-first.

## 2. Goals, non-goals, anti-goals

**Goals**
- The Exceptions screen's default view is a dense table: one row per loan,
  computed · reported · minimum shown side by side, never one DSCR alone.
- Selecting a row opens that loan's existing `/casefiles/[id]` page —
  **unchanged from today, owner's call 2026-11-08.** An earlier draft of this
  document proposed an inline master-detail panel (the casefile opening
  under the table, same page, no navigation); the owner reviewed a mockup of
  it and asked for the full-page behaviour kept exactly as built instead.
  Nothing about `CasefileView`, `ReviewActions`, or the casefile route
  changes because of this redesign — only what links to it does (a table
  row instead of a pipeline card).
- Sort by risk by default: shortfall first, then drift, then the
  reported-vs-computed gap — not recency, not alphabetical.
- Filters live as pills directly above the table (All / Needs review /
  Breaches / In compliance / Untested), each a plain count, not a second
  navigation surface.
- Kanban survives as a second **lens** on the same data (a view toggle, same
  filters, same rows) — the owner's own idea, and the research's "Lens only"
  verdict agrees with it. It is no longer the default.
- Every rule already in CLAUDE.md still holds: amber = code computed this,
  sky = the agent, mint = interactive, green = verified pass, no coloured
  stripes, Inter everywhere, the replaced spacing/fontSize/boxShadow scales.

**Non-goals**
- No change to the agent, the calculator, the guardrails, the schema, the
  API routes, or the eval harness.
- No top-nav rename. The research argues for "Queue / Portfolio / Loans /
  Reports" over today's "Exceptions / Documents / Covenant terms / Lessons /
  Governance," calling data-model navigation a generic-AI tell. **Owner's
  call, recorded 2026-11-08: keep today's five tabs.** The duplicate-rail
  problem the research is really pointing at is solved by §3 below without
  touching navigation; revisit the rename separately if it still rankles
  once the rail stops duplicating the table.
- No bulk actions. At 7 loans, the research's own verdict is "Defer" —
  bulk Resolve/Escalate risks the book for seconds saved. Bulk is at most a
  later addition to Re-run/Assign, out of scope here.
- Documents, Covenant terms, Lessons, Governance are **not** rebuilt. Their
  existing `?loan=` filtering (Task 8) is unaffected — see §3 for what
  replaces the rail's per-loan rows there.
- **No keyboard triage this round** — owner's call, 2026-11-08. The research
  makes a strong case for `J`/`K`/`Enter`/`E`/`V`/`U`/`Z`/auto-advance, and it
  stays in the research and in §4.6 below as a recorded direction, but
  nothing about it ships in this build: no new key-listener, no undo
  mechanism, no auto-advance. Deciding a case still means clicking a button
  in the panel, exactly as `ReviewActions` already works today. Worth a
  `docs/parking-lot.md` entry when this plan lands, so the research isn't
  lost, only deferred.
- **No separate icon rail.** The owner's original "icons instead of colour
  dots" idea is satisfied by §4.2's filter pills, which each carry a small
  meaning-bearing icon already — there is no second, rail-shaped version of
  this to also build.

**Anti-goals — this has failed even if it "works" if:**
- A breach row's status is ever carried by colour alone (sign + chip + text,
  always — the research names this as a named AML anti-pattern, and it is
  already CreditScout's own rule).
- A trend line is fabricated anywhere for a loan with only one quarter on
  file. **Checked against real data (2026-11-08): only Coastal Marine has
  more than one quarter of tests (1.41× → 1.29× → 1.12×, Q4 2025 → Q2 2026).
  Every other seeded loan has exactly one.** Drift is shown only when ≥2
  quarters exist for that loan; otherwise the trend element is simply absent,
  never a flat or empty chart.
- A single unexplained "risk score" appears anywhere. The research calls
  this out by name (the AML anti-pattern it documents): if a score is shown,
  it must decompose into the three things that built it on click. This build
  skips a composite score entirely and sorts directly on the three real
  numbers instead — nothing to decompose because nothing is hidden.
- *(Keyboard triage is deferred this round — §4.6 — so its own anti-goal
  about firing inside a text field moves with it, for whenever it's built.)*

## 3. The duplicate-rail problem, resolved without a nav rename

The research's real complaint is narrower than "rename the nav": **a rail
that lists the same loans a table lists is two homes for one thing.**
`components/PortfolioRail.tsx` currently does exactly that on Documents and
Covenant terms (Task 8 wired `?loan=` filtering through it) and, until this
document, was about to grow a second redundant list (the owner's earlier
"category filters" ask) on top of the kanban it was already duplicating.

**Resolution:**
- **On Exceptions:** the rail's job is replaced outright by the filter pills
  above the table (§4.2). The rail does not render a competing list on this
  screen. *(Implementation note: the simplest correct behaviour is for the
  rail to render nothing additional on `/` beyond what it already shows —
  decide in the plan whether that means hiding the loan-list portion of the
  rail on this one route, or collapsing it by default there the way it
  already defaults to collapsed on Lessons/Governance.)*
- **On Documents and Covenant terms:** these pages still need a way to pick
  one loan — that is what `?loan=` filtering is *for*, and the research's own
  rule 3 endorses a rail here explicitly: "if the team insists on a rail
  later, it holds views only, ≤200px, collapsible, and filters this same
  table — it never navigates away from it." That is precisely what the
  existing per-loan rail rows already do on these two pages. **They are
  unaffected by this document** — `railItems(rows, { filterPath })` keeps
  working exactly as Task 8 built it.
- Net effect: the rail stops being a second, competing version of the
  Exceptions queue, while continuing to do the one job the research itself
  blesses elsewhere.

## 4. The Exceptions screen

### 4.1 Shell
Unchanged: forest header, the five tabs, the portfolio rail per §3. Only the
page body (today `<Pipeline lanes={...} />` in `app/page.tsx`) changes.

### 4.2 Filter bar
Pills, directly above the table, each a count from the existing
`queueCounts()` (`components/portfolioModel.ts`) plus one new field:

| Pill | Count source |
|---|---|
| All loans | `counts.total` |
| Needs review | `counts.readyForReview` (status `in_review`) |
| Breaches | `counts.awaitingInvestigation` **+** `in_review` **+** `investigating` **+** `investigation_paused` **+** `awaiting_docs` — every *open* exception. **Decided breaches are excluded, owner's call 2026-11-08** — a decided loan belongs under Decided (reachable via All loans), not under a pill that reads as "still needs something." This is a deliberate departure from the research's own prototype, which counts a decided breach under Breaches too; the owner reviewed that difference and chose to exclude it. |
| In compliance | **new**: `rows.filter(r => r.status === "compliant").length` — `queueCounts` does not expose this yet; add it the same way `termsApprovalNeeded` already exists, with a test. |
| Terms approval | `counts.termsApprovalNeeded` |

**Corrected 2026-11-09, researching the plan for this document** — the row
above read "Untested | `counts.untested`" in an earlier draft, from before
the pill was finalized in the mockup as "Terms approval." The mockup
(`docs/design-mockups/2026-11-08-queue-redesign/`), the rail's own existing
`RailDot` naming (`"terms"`, already in `railModel.ts`), and the owner's own
recorded decision all agree on "Terms approval"; the table row now matches.

**Resolved 2026-11-08 — the owner's "icons, not dots" idea lives here, not in
a separate rail.** Each pill carries a small meaning-bearing icon beside its
label (a warning mark for Needs review, a check for Decided/In compliance, a
document mark for Terms approval, a stack mark for All loans) — the same
"diagrammatic, not a colour dot" principle the owner's reference image
showed, applied to the filter bar instead of a second list. No separate
icon rail; §3's resolution (the rail renders no competing list on `/`)
stands as written, simplified further: there is nothing left for a rail to
duplicate here even as an idea.

Active pill is mint-filled (interactive, per the existing rule); the rest are
plain bordered chips, icon + label + count. A loan search box sits at the
filter bar's right edge, client-side only, same behaviour as the deleted
`PortfolioTable.tsx` had.

### 4.3 The table
Columns, left to right: **Borrower** (+ industry, + terms version) ·
**Computed** · **Reported** · **Minimum** · **Headroom** · **Result** (chip) ·
**Status** (+ the agent's suggestion, muted, under it) · **Next action**.

- Right-aligned, `tabular-nums`, Inter — no monospace on a figure (standing
  rule).
- **Headroom** is new: `computed - required`, signed, `+0.24x` in `success`
  ink or `-0.13x` in `danger` ink. Reuses the exact formula
  `components/pipelineModel.ts`'s `barGeometry` already computes; this screen
  wants the signed number, not the bar.
- **Result** chip: reuse `testResultOf()` + `TEST_RESULT_LABEL` + the
  deleted table's `RESULT_TONE`/`RESULT_GLYPH` maps verbatim — both already
  encode "never colour alone."
- **Status**: reuse `reviewStatusOf()` exactly as the deleted table did —
  it already returns a label, a `detail` (the agent's suggestion, worded
  "Recommendation: Resolve" etc.), and a tone.
- **Next action**: reuse the deleted table's `RowAction` switch on
  `row.status` almost verbatim (§6 lists the one wording change needed: its
  button classes used retired `model*` tokens — becomes mint, per every
  other restyle this session).
- Row click opens that loan's existing casefile page (§4.4) — the browser
  navigates, exactly as a click on the old table or a kanban card already
  does today.
- Default sort: **risk** — breach shortfall ascending (most negative
  headroom first) among open exceptions, then by how much a loan has
  drifted (§4.5), then by |reported − computed|. Compliant and untested
  rows sort after every open exception, by shortfall/headroom too (a
  comfortable loan above a thin one). *(Owner's call during the plan,
  flagged by the research itself: whether a large reported-vs-computed gap
  should instead rank by "this is probably a data error, re-run it" rather
  than "this is probably a dispute, escalate it." The research proposes
  shortfall → drift → gap and says to confirm before shipping — recorded
  here as still open.)*
- Empty state: "No loans match that filter," same wording the deleted table
  used.

### 4.4 Opening a case — full page, as built today

**Dropped 2026-11-08, owner's call, after seeing a mockup of the
alternative.** The inline master-detail panel described in earlier drafts of
this document is not built. Every row's "Next action" does exactly what the
deleted `PortfolioTable.tsx`'s `RowAction` already did — `breach_investigate`
starts an investigation and navigates to `/casefiles/[id]`; `in_review`,
`investigating`, `investigation_paused`, `awaiting_docs`, and `decided` each
link to that casefile; `compliant`/`not_tested` get Re-run or Review terms.
Nothing about `CasefileView`, `ReviewActions`, `LiveTrace`, or the casefile
route is touched by this redesign — the table is a new way to reach that
page, not a new page itself. This also removes every open question the
builder-check raised about embedding `LiveTrace` or fetching casefile data
on selection (§6, earlier draft) — they no longer apply.

### 4.5 The kanban lens
A view switch (`Table` / `Kanban lens`) beside the filter bar, mint-filled on
the active one — not a route change, same filtered rows. The existing
`Pipeline`/`PipelineCard` components are reused, with one fix the research
names directly as the board's "blind spot": **compliant and untested loans
currently vanish from the kanban entirely.** Add a fifth, low-emphasis lane —
*"Also in the book"* — listing them, muted, no action required, so the board
stops silently hiding four of seven loans. `PipelineAutoRefresh` keeps
working as built (Task 12's final-review fixes: polls only while a card is
`investigating`, not paused).

### 4.6 Keyboard triage

**Deferred past this round — owner's call, 2026-11-08.** Nothing in this
section is built now. It is kept here, not deleted, because the research
backs it well and it is the natural next step once the table and the inline
panel exist. Recorded for whenever that round comes:

| Key | Would have done |
|---|---|
| `J` / `K` or `↓`/`↑` | Move the selection one row |
| `Enter` | Open the selected row's casefile |
| `E` | Record a different decision |
| `V` | Approve the recommendation |
| `U` | Re-run the covenant test |
| `Z` | Undo the last single decision, ~5s window |
| `?` | A shortcut sheet |

Add a one-line entry to `docs/parking-lot.md` for this when the plan for
this document is written, so the direction survives even though the build
doesn't include it.

### 4.7 Decision record and the two outcomes
No change from today. `ReviewActions`'s three buttons — Approve, Record a
different decision, Hold for borrower documents — are reused exactly as
built, in the inline pane and on the full casefile page alike. No new
policy, no new keys, no undo: the existing `reviewCasefile` action, its
outcome handling, and `humanReviewNotice` are reused as-is.

## 5. What stays exactly as built today
- Every design token, font, and the no-stripes rule (CLAUDE.md, 2026-11-08
  entries).
- `/welcome`, `/login`.
- Documents, Covenant terms, Lessons, Governance — screens and rail
  behaviour unchanged (§3).
- `components/portfolioModel.ts`, `components/casefileModel.ts`,
  `components/traceModel.ts` — this is a presentation change; the pure
  data-shaping layer is reused, extended only where §4.2/§4.3 note a new
  field.
- The agent, the calculator, the guardrails, the schema, the eval harness.

## 6. Left to the builder (plan-time decisions)
- Risk-sort tie-break: shortfall → drift → reported-vs-computed gap is the
  proposed order (drift as a sort key only, per the owner — no visible trend
  element this round). Still open, flagged by the research itself: whether a
  large reported-vs-computed gap should instead push a row toward "re-run it,
  this looks like a data problem" rather than "escalate it, this looks like a
  dispute." Confirm the ordering reflects whichever reading is right before
  shipping.
- Whether the fifth kanban lane (§4.5) needs its own test coverage beyond
  `pipelineModel.test.js`'s existing shape.
- **Corrected 2026-11-09, researching this plan — the earlier "always
  collapsed on Exceptions" resolution above was wrong and is replaced by
  this one.** It assumed expanding the rail would show the same five
  category filters as the pills. It would not: `railItems()` has always
  rendered one row **per loan** (name, figure, a jump link to that loan's
  own casefile or setup page), never per category — that is a different,
  genuinely useful feature from the pills (which filter the table), not a
  duplicate of them. **No special-case change to the rail's behaviour on
  Exceptions is needed at all.** `railDefaultCollapsed(pathname)` today
  does not include `/`, so the rail already defaults to expanded there,
  exactly as on Documents and Covenant terms, and that is correct —
  leave it. The only rail change this document makes anywhere is §4.2's
  icon fix to the **collapsed strip's** glyphs, which already applies
  uniformly on every route through the one shared `PortfolioRail`
  component; nothing route-specific is required.
