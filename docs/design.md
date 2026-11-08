# CreditScout — Design System

**The single source of truth for everything visual.** Read this before building
any screen. Never work from memory, and never invent a colour, spacing value or
radius that isn't here.

**Date:** 2026-11-07 · **Stack:** Next.js + Tailwind CSS

> **Rewritten 2026-11-07 for the "Forest" redesign.** Sections 1–5 are the
> current truth. The analyst workspace moved from a graphite rail and one teal
> accent to a forest header, a portfolio rail and a sky colour for the agent.
> §9 records what changed and why. The spec is
> `docs/superpowers/specs/2026-11-07-forest-redesign-design.md`; the mockups are
> in `docs/design-mockups/2026-11-07-forest/`.
>
> **`/welcome` and `/login` were not redesigned.** They keep the classic
> neutrals, the teal and the `night-*` tokens, and render exactly as before.
> Everything below describes the signed-in workspace.

---

## 1. The one rule that makes this product legible

> **Hue carries meaning. It is never decoration.**

CreditScout's claim is that a reasoning layer decides, a calculation layer
computes and a human approves. An analyst has to see which is which **without
reading a word**. That is what the colour system is for.

The organising idea is two layers: **land** and **sky**.

- **Land** is the bank's facts. Computed figures, approved terms, decisions and
  navigation. Forest green, white and mist surfaces, mint for things you can
  click, red for a breach.
- **Sky** is the CreditScout Agent's work. A soft blue-to-aqua gradient and a
  blue "CreditScout" tag with a dot.

| Hue | Means | Never used for |
|---|---|---|
| **Sky** (gradient, or the blue agent tag) | The CreditScout Agent produced this, or is producing it | A status; a quoted document clause; a chip on the Lessons page |
| **Mint** | You can act here. Primary buttons, the active tab, the avatar | A status. Not a pass, not a "done". Never text on white |
| **Amber** | **Code did this**: a calculation, a guardrail, a policy decision | Decoration, warnings, "highlights" |
| **Forest / mist / white** | The bank's facts, a human, navigation | System output |
| **Red** | A breach, a failure, an escalation | General emphasis |
| **Green** | A verified pass or a recorded resolution | Branding, success toasts, a screen state |

**Sky appears in exactly four places:**

- the "CreditScout working" lane on the pipeline;
- behind a recommendation (the recommendation card);
- on agent and specialist steps in the live trace;
- the CreditScout tag, on any text the agent produced.

Current uses of the tag: the recommendation eyebrow, specialist trace steps,
"Proposed by CreditScout", the "CreditScout Agent" tag on the covenant-setup
ProposeTrace, the seen-similar badge, the pipeline card's "CreditScout"
recommendation tag, and the pipeline card's "Investigating" tag.

The "not a lesson chip" rule means the chips on the **Lessons page**. The
seen-similar badge on a casefile is agent content (prior cases the agent
retrieved), so it keeps the tag.

A quoted clause from a filed document is **not** sky. The agent retrieved it; it
is the bank's evidence, so it stays on land.

If you catch yourself reaching for amber because a number "feels important",
stop. Amber means *a deterministic function produced this value and it is logged
under a `calc_id`*. If you reach for mint to say "good", stop: mint is
"clickable", and green is the only "good".

**Every calculated figure in the UI carries its provenance**, e.g.
`1.31 ⟡ computed by code · calc_a3f9`. A figure without provenance is a bug, not
a style choice.

---

## 2. Colour tokens

**The sources are `lib/ui/palette.ts` and `app/globals.css`.** `palette.ts`
holds the values as plain data; `tailwind.config.ts` reads the brand set from it,
and `globals.css` mirrors the neutrals as CSS variables. `lib/ui/palette.test.js`
fails if the two drift apart, and it checks contrast. If this page and
`palette.ts` ever disagree, `palette.ts` wins and this page is stale.

### Neutrals are CSS variables

The eight neutrals are `--c-*` variables. `:root` holds the **classic** values
(used by `/welcome` and `/login`); the `theme-forest` class on the workspace
`<body>` switches them to the forest values. A component writes `bg-surface`
or `text-text-muted` and gets the right one for its page.

| Token | Forest (workspace) | Classic (`/welcome`, `/login`) | Use |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#F7F9FA` | Page background |
| `surface` | `#FFFFFF` | `#FFFFFF` | Cards, panels, table bodies |
| `surface-raised` | `#EEF3EF` (mist) | `#F1F4F6` | Portfolio rail, pipeline lanes, table headers, quiet panels |
| `border` | `#DCE6DF` | `#C7D3DA` | Hairlines |
| `border-strong` | `#BFD0C5` | `#94A6B0` | A panel's own edge; dividers that must read |
| `text` | `#0F2B22` (forest) | `#19282F` | Headings, primary values |
| `text-secondary` | `#3E5A50` | `#52646D` | Body copy |
| `text-muted` | `#566D61` | `#6B7C85` | Labels, captions, metadata (12px floor) |

**Muted text is `#566D61`, not the mockups' `#6E8679`.** The mockup value
measured 3.93:1 on white and fails WCAG AA. `#566D61` clears 4.5:1. This was
decided during the build.

### Brand set (the forest header, mint, the agent)

| Token | Hex | Use, and only this |
|---|---|---|
| `brand` | `#0F2B22` | The header band; the selected loan in the rail; the active stepper dot |
| `brand-on` | `#FFFFFF` | Text on `brand` |
| `brand-on-2` / `brand-on-3` | `#CFE3D6` / `#A9C7B5` | Secondary and tertiary text on `brand` |
| `brand-danger` | `#FFB4A8` | A breach figure on `brand` (the selected rail row) |
| `mint` | `#9BE7A9` | A **fill** for interactive things, with forest `text` on it. Hover `mint-hover` `#86DC97` |
| `agent` | `#3D7FD6` | The dot on the agent tag; the left rule on an agent trace step |
| `agent-ink` | `#123A6B` | Text on the agent tag, and agent purpose lines in the trace |
| `agent-bg` | `#DCEBFF` | The agent tag's background |
| `bg-sky` | `linear-gradient(160deg,#D6E8FF 0%,#C9ECEB 55%,#E4F6EE 100%)` | The agent surfaces in §1, nowhere else |

### Semantic (unchanged by the redesign)

| Token | Hex | Bg pair | Meaning |
|---|---|---|---|
| `code` | `#B45309` | `code-bg` `#FFFBEB` | **Deterministic computation**, and the one unresolved review item |
| `code-bright` | `#92400E` | — | Calculation headings, `calc_id` badges |
| `human` | `#334155` | `human-bg` `#F1F5F9` | Approval, review, analyst action |
| `danger` | `#C81E1E` | `danger-bg` `#FBE3E3` | Breach, failed test, escalate |
| `danger-strong` | `#A31A1A` | — | **Solid fill** of the escalate mark |
| `success` | `#15803D` | `success-bg` `#E8F7EE` | Compliant, passing |
| `success-strong` | `#156B37` | — | **Solid fill** of the resolve mark |

The `-bg` tints are contrast-bound, not taste: `success` on `success-bg` is badge
text with about 0.3 of headroom over 4.5:1, and darkening the tints for looks
took the success badge to 4.10 and the danger badge to 4.29. The `-strong` pair
exists for the one element that carries no small text, the outcome mark on the
recommendation card, where white reads 6.6:1 and 7.7:1.

### Retired in the workspace

- **Teal (`model`, `model-bright`, `model-bg`, `model-night`, `model-night-bg`)
  is retired.** Its two meanings split: *interactive* became **mint**, *the
  agent did this* became **sky**.
- **The dark shell (`sunken`, `night-*`) is retired from the workspace.** The
  tokens still exist in `tailwind.config.ts` for `/welcome`, `/login` and
  `components/Logo.tsx`, and nowhere else.
- `components/workspaceTokens.test.js` fails if a retired class (`model*`,
  `sunken`, `night*`) appears in workspace code.

### Accessibility

- Body text must hit **4.5:1** against its surface; UI elements and large text
  **3:1**. `palette.test.js` checks the pairs it knows about; re-check any new
  combination by hand.
- Mint is a fill with forest text on it (about 10:1). It is never text on white.
- **Never encode meaning in colour alone.** Every status is a dot **plus a
  word**; amber values carry `computed by code`; breaches carry the word
  *breach*; agent content carries the CreditScout tag. A colour-blind analyst
  must read the same information.
- Focus ring: `2px` ring, offset `2px`. In the workspace it is forest (`text`).
  On the forest header band it is mint, with a forest offset. Visible on every
  interactive element. Do not remove it.

---

## 3. Typography

Three faces, each with one job. A narrow scale, and nothing off it: the Tailwind
`fontSize` scale is **replaced**, so an off-scale class does not exist.

| Face | Where | Why |
|---|---|---|
| **Bricolage Grotesque** (`next/font`) | All UI text and display in the workspace; the wordmark (800); figures and dates | The brand face. Headings 800 with slightly negative tracking; body 400/500 |
| **JetBrains Mono** | Identifiers only | Things you would retype |
| **Inter** | `/welcome` and `/login` only | Those pages were not redesigned |

| Role | Token | Size / Line | Weight |
|---|---|---|---|
| Display (landing hero **only**) | `text-display` | 56 / 58 | 600 |
| Big figure (DSCR on a casefile) | `text-figure` | 34 / 38 | 800 |
| Compact figure (DSCR on a card) | `text-figure-sm` | 24 / 28 | 800 |
| Page title | `text-title` | 28 / 34 | 700 |
| Section heading | `text-section` | 20 / 28 | 600 |
| Card title | `text-card` | 16 / 24 | 600 |
| Wordmark | `text-wordmark` | 19 / 24 | 800 |
| Body | `text-body` | 14 / 22 | 400 |
| Numeric value | `text-num` | 14 / 20 | 500 |
| Quoted clause | `text-quote` | 13 / 21 | 400 |
| Label / caption | `text-label` | 12 / 16 | 500 |
| Badge | `text-badge` | 11 / 16 | 500 |

**The numeral rule, updated 2026-11-07:**

1. **Every financial figure and date is set in Bricolage Grotesque with
   `tabular-nums`.** The spec asked the builder to verify that Bricolage's
   tabular figures work; they were checked in the browser and every digit has the
   same width, so columns align. (In the workspace, `.tabular-nums` switches the
   font to `--font-figure`, which is Bricolage.) The fallback to Inter was not
   needed. The 2026-10-14 rule still holds: figures are never monospace.
2. **Monospace is reserved for things you would retype**: `calc_id`, citations
   (`CA §7.11`), rule names, field paths (`numerator.addbacks[0].cap`), tool
   names, credentials, a key cap.
3. **A verbatim clause quote is NOT monospace.** It is prose, `text-quote`, with
   the cited span highlighted.

## 4. Spacing, radius, elevation

**4px base scale.** The Tailwind `spacing` scale is **replaced**, so only these
exist: `0, px, 1 (4px), 2 (8px), 3 (12px), 4 (16px), 6 (24px), 8 (32px),
12 (48px), 16 (64px)`. `h-10`, `mt-10` and `gap-10` are not classes. They fail
silently at render, which is the single most common mistake made in this
codebase.

### Shapes

| Radius | Value | Use |
|---|---|---|
| `sm` | 4px | Badges, chips, the headroom bar |
| `md` | 8px | Inputs, small buttons |
| `lg` | 12px | Buttons, modals, side panels |
| `xl` | 14px | Cards, selected rail rows |
| `2xl` | 18px | Pipeline lanes, the recommendation card, dialogs |

- **No pill tags for status.** Status is a coloured **dot plus a word**.
  (The header tabs and avatar are fully round because they are controls.)
- **Depth comes from tone** (mist against white) and hairlines, not shadows.

### Elevation

| Token | Use |
|---|---|
| `shadow-card` | A panel that needs to lift off the page. `0 1px 2px / 0 1px 3px` at 4–6% |
| `shadow-raised` | Menus, the command palette, modals and popovers only |

The scale is two steps. A big diffuse shadow is half of the generated-template
look. There is no third step and there will not be one.

Layout: 1280px max content width (`max-w-content`), 24–32px page gutter, 16px
grid gap. Fixed sizes added to the config: `w-rail` 260px, `w-rail-collapsed`
44px, `h-header` 52px.

---

## 5. The shell and its components

### 5.0 The shell (every signed-in screen)

```
┌──────── forest header: wordmark · tabs · search · avatar ────────┐
├────────────┬─────────────────────────────────────────────────────┤
│ Portfolio  │                                                     │
│ rail       │  page content                                       │
│ (collapses)│                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

The dark left nav rail is gone; its items became the header tabs.

**Header** (`components/TopBar.tsx`)

- 52px, full width, `brand` forest, with faint survey-map contour lines behind
  the content (`lib/ui/contours.ts`; decoration only, `aria-hidden`).
- Left: the wordmark **CreditScout** (Bricolage 800) and "Bank of Stoic" small.
- Then the **section tabs**: Exceptions · Documents · Covenant terms · Lessons ·
  Governance. The active tab is a mint fill with forest text. A small count may
  sit on a tab. Below `md` the tabs scroll sideways.
- Right: the search field (opens the command palette, ⌘K) and the avatar (a mint
  circle with the analyst's initials, which opens the account menu).

**Portfolio rail** (`components/PortfolioRail.tsx`, `components/railModel.ts`)

- About 260px, `surface-raised` mist. Heading "Portfolio · Q2 2026 · N loans",
  then every loan: status dot, borrower, computed DSCR (red when under that
  loan's own minimum) and a second line ("Breach · min 1.25x", "Pass · min
  1.35x", "Breach · decided", "Terms awaiting approval"). "+ New borrower" sits at
  the bottom. The selected loan is a solid forest row with white text.
- Status dot, always read with its words: red is an open breach, green is a pass,
  grey is decided, **slate** (`human`) is terms awaiting approval (a person must
  act, so not amber, which means code did something), a hollow grey ring is not
  tested. On the selected (forest) row the dots use light variants; a pass keeps
  its green.
- **Clicking a loan** opens its current casefile; if it has none, its covenant
  setup. On **Documents** and **Covenant terms** it instead filters that page to
  the loan (`?loan=`), and "All loans" at the top clears the filter.
- **Collapse rules.** A control collapses the rail to a 44px strip with one dot
  per loan (hover shows name and DSCR). The **`[` key** toggles it, except while
  typing in a text field. The analyst's choice is remembered in `localStorage`
  (`cs.rail.collapsed`) and, once set, **overrides the per-tab defaults**.
  Defaults: open on Exceptions, Documents, Covenant terms, casefiles, onboarding
  and covenant setup; collapsed on Lessons and Governance. Below `md` the rail is
  always the strip.

### 5.0.1 The pipeline (Exceptions, `/`)

(`components/Pipeline.tsx`, `PipelineCard.tsx`, `pipelineModel.ts`.) Replaces the
old queue table. Four lanes, left to right, driven by the existing
`portfolioModel` statuses:

| Lane | Holds | Card action |
|---|---|---|
| **Needs investigating** | `breach_investigate` (a reopened one keeps its marker) | Investigate |
| **CreditScout working** (the **sky** lane) | `investigating`, `investigation_paused` | Running: none; the whole card links to its casefile, where the live run is driven, and shows the latest steps. Paused: the paused notice and a mint **Resume** link to the casefile |
| **Awaiting your decision** | `in_review`; `awaiting_docs`, labelled "Held for borrower documents" | Review |
| **Decided** | `decided` | Opens the casefile, card quieter |

- A card shows the borrower, the computed DSCR large (red when under the loan's
  own minimum) with a small amber "⟡ computed" mark beside it (code-provenance;
  shown only when the figure exists), a **headroom bar** with a tick at that loan's own minimum, "min X
  · reported Y", and **one** next action. In *Awaiting your decision* the card
  also carries the CreditScout tag with the recommendation in plain words
  (Resolve, Escalate, Request documents, No recommendation). A *Decided* card
  says "Decision recorded" and shows no agent recommendation. A running card
  shows the Investigating tag, "Step n" and "Runs while its casefile is open".
- The bar puts the minimum at its midpoint, so a fill short of the tick is a
  breach whatever the minimum is. It is never a constant.
- Compliant and not-tested loans are **not** in the pipeline. They live in the
  rail only.
- An empty lane is a dashed outline and one plain sentence.
- While any card is genuinely running (`investigating`; a paused card does not
  count) the page re-reads its data every few seconds, and stops when none is.
  Four columns from `lg`, two at `md`, one below.

### 5.1 Recommendation badge

| Recommendation | Colour | Icon |
|---|---|---|
| `resolve` | `success` | ✓ |
| `request` | `human` | ? |
| `escalate` | `danger` | ↑ |
| `abstain` | `text-muted` | — |

12px uppercase, letter-spacing 0.5px. **`abstain` is deliberately grey, not
red**: abstaining is correct behaviour, not a failure.

### 5.2 Calculated value

```
┌──────────────────────────────────┐
│  DSCR   1.31  ⟡ code · calc_a3f9 │   ← amber value, badge
└──────────────────────────────────┘
```
Value in `code-bright`, Bricolage with `tabular-nums`; badge in `code` on
`code-bg` at 11px, with the `calc_id` in monospace. The `calc_id` is clickable
and opens the calculation log for that computation.

### 5.3 Citation chip

Inline, `radius-sm`, 12px, **monospace** (a citation is an identifier): `CA §7.11
↗`. It is interactive, so it takes forest ink on a strong hairline border; when
selected it fills `surface-raised`. Clicking opens the clause panel. **A claim
without a chip must not render**; a missing citation shows a red `no citation`
chip instead.

### 5.4 Clause panel

Right-hand drawer, 480px (`max-w-panel`), `surface-raised`, `radius-lg`.
Document title and section as header; full chunk text in `text-quote` (prose, not
code); the quoted span highlighted. The analyst's job here is a two-second
verification, so the highlight is the whole point. The clause is the bank's
evidence, so it is **not** sky.

### 5.5 Step trace

Vertical timeline, one row per step, polled every 1s.

```
 ①  definition_agent        sky       2.3s
 │   mapped DSCR terms from CA §1.01
 ②  dscr_calculator         AMBER     0.1s
 │   1.12 — below 1.25 threshold
 ③  research_agent          sky       4.1s
 │   found Amendment No. 2 §3(a)
 ④  dscr_calculator         AMBER     0.1s
     1.31 — passes
```

Agent and specialist steps take the sky treatment: a left rule in `agent`, the
CreditScout tag, purpose lines in `agent-ink`. Calculator steps are amber.
**The alternation is the product demo.** It shows reasoning and computation
interleaving. Completed steps settle to `text-secondary`. Amber on the live
investigation screen still means exactly one thing: the calculation cannot
proceed.

### 5.6 Guardrail notice

An amber callout with a 4px left border (`border-code` on `code-bg`):

> **⟡ Guardrail · forced abstain** — "1.47" appears in the explanation but
> matches no calculation in this casefile and no quoted figure.

Amber because **a guardrail is code**. Always visible, never collapsed by
default.

### 5.7 Buttons

| Variant | Fill | Text | Use |
|---|---|---|---|
| Primary | `mint` (hover `mint-hover`) | forest `text` | Approve, Investigate, Run test |
| Secondary | transparent, `border-strong` | `text` | Override, Request docs |
| Danger | transparent, `danger` border | `danger` | Escalate |

`radius-lg`, 14px/500, 8px × 12–16px padding. Disabled: 40% opacity,
`cursor: not-allowed`.

**Mint is "you can click this", never "this is good".** There is one primary
button per next action. Where a table column holds one action per row, give the
cell a fixed width and stretch every child to fill it. A button wrapped for a
disabled-reason tooltip needs the wrapper stretched too.

### 5.8 Data table

`surface` background, `border` row dividers. Column headers are 12px uppercase
`text-muted` on `surface-raised`. Numeric columns **right-aligned, Bricolage,
`tabular-nums`**. Hover `surface-raised`. Status via dot and word, never via row
tint.

### 5.9 Locked policy value

```
require_human_review   true   🔒 locked
```
`text-muted` with a lock glyph and `cursor: not-allowed`. **Renders as
structurally impossible to change, not merely disabled**: this is a regulatory
boundary and the UI should say so.

### 5.10 The CreditScout tag

(`components/AgentTag.tsx`.) A small chip: `agent-bg` background, `agent-ink`
text, an `agent` dot, `radius-sm`, 11px. It marks what the CreditScout Agent (or
a specialist it called) did or said: "CreditScout recommends", "Investigating",
"Proposed by CreditScout", "Specialist model", the seen-similar count.
"Investigating" marks the agent as the actor on a running case; it is not a
test status (the status is the lane and the dot-and-word). The tag is never a
status and never a control.

---

## 6. Motion

| Interaction | Duration | Easing |
|---|---|---|
| Hover / focus | 120ms | `ease-out` |
| Panel open | 200ms | `cubic-bezier(0.16,1,0.3,1)` |
| New trace step | 240ms fade + 8px rise | `ease-out` |

Nothing animates longer than 240ms. **No skeleton shimmer on the trace** — a
running investigation shows real steps arriving; faking progress with a shimmer
would misrepresent what the system is doing, which is the one thing this product
cannot do.

Respect `prefers-reduced-motion`: drop transforms, keep opacity.

---

## 7. Screen layouts

Every screen sits in the shell of §5.0. The rail is open by default except on Lessons and Governance.

| Screen | Layout |
|---|---|
| **Exceptions** (`/`) | The shell (§5.0) → period line, **Run covenant tests**, the counts summary and the document drop zone → the four-lane **pipeline** (§5.0.1). Each card carries exactly one next action |
| **Live investigation** | Breadcrumb *← Pipeline* → title + ONE status badge → "Original test result" strip (calculated / minimum / shortfall / terms version) → amber notice naming the single blocking issue → 65/35 split: investigation timeline left, pending recommendation + evidence right |
| **Casefile review** | Breadcrumb *← Pipeline* → identity line (period · terms version · state; **no loan id**, the schema has no short loan code) → borrower → **recommendation card on the sky** with the CreditScout tag (eyebrow + mark + headline + one sentence; three facts; one outstanding line; the agent's reasoning) → 2/3 findings + 1/3 evidence and outstanding items → *Record your decision* |
| **Covenant terms review** | Header names the decision and the version → *What this proposal changes* (Term / Approved vN / Proposed vN+1 / Source) → review checklist grouped by consequence → proposed terms left, source clause right → compact approval bar |
| **Documents** | Search → borrower and type filters → *Upload documents*. Table: document, borrower, type, **relevant date** (named for the type), terms review state. A title opens the indexed document |
| **Onboarding** | Stepper (Borrower & documents → Review terms → Complete). Step 1 carries the name fields **and** the uploader, with one primary action that creates the borrower and uploads in a single gesture |
| **Lessons** | Rail collapsed by default |
| **Governance** | Rail collapsed by default. Investigation limits + enforcement rules + eval scoreboard (cold vs warm, with the run's date and n) |

## 8. Writing style in the UI

- **Never say "AI thinks" or "AI believes".** Say what happened: "Agent retrieved
  CA §7.11", "Code computed 1.31".
- Recommendations are recommendations. Never "Resolved" — always "Recommends
  resolve".
- Numbers never appear without provenance.
- Empty states state the next action: "No exceptions this quarter. Upload a
  package to run the next test."
- Errors state what failed and what to do: "Investigation failed at step 4 —
  Foundry run timed out. Retry."

---

## 9. What not to do

- Don't use amber for anything that isn't code output **or the one unresolved
  review item**. On the live investigation screen amber means exactly one
  thing: the calculation cannot proceed.
- Don't introduce a new hue. If something needs emphasis, use weight or size.
- Don't hide guardrail notices behind a disclosure.
- Don't render a number without its `calc_id` or its quote.
- Don't reach past the two-step shadow scale.
- Don't animate longer than 240ms, and don't fake progress.
- Don't set a figure, a date or a clause in monospace (§3).
- Don't use green for a screen state. Green is a verified pass or a recorded
  resolution; "ready for analyst decision" is neutral.
- Don't use a spacing or type class that is not in §3/§4 — the scales are
  replaced, so it will silently not exist.
- Don't use sky for a status, a quoted document clause or a lesson chip. Sky is
  the CreditScout Agent's own content (§1).
- Don't use mint as a status or as text on white. It means "you can click this".
- Don't bring teal (`model*`) or the dark shell (`sunken`, `night*`) back into
  the workspace. `components/workspaceTokens.test.js` will fail.
- Don't hard-code a neutral hex. Use the token, so the page's theme applies.

### Superseded 2026-10-13

> *"Don't add a light theme. There is no light theme in the MVP."*

The workspace IS the light theme now. *(Updated 2026-11-07: the `night-*` set no
longer serves a nav rail. It survives for `/welcome`, `/login` and the logo.)*

### Change log

**2026-11-07 — the "Forest" redesign.** What changed:

- **Teal retired.** "Teal = a model did this, and = interactive" split in two:
  interactive became **mint**, the agent became **sky** (the land / sky rule, §1).
- **The dark graphite nav rail is gone.** A forest header band with section tabs,
  plus a collapsible portfolio rail, replaced it (§5.0).
- **The queue table is now a four-lane pipeline** (§5.0.1).
- **Type moved to Bricolage Grotesque**, including figures and dates (checked: its
  tabular figures align). Inter stays only on `/welcome` and `/login`. JetBrains
  Mono stays for identifiers (§3).
- **Neutrals became CSS variables** so the workspace and the two public pages
  can differ. `lib/ui/palette.ts` is the source; `palette.test.js` keeps it and
  `globals.css` in step.
- **Muted text darkened to `#566D61`** (the mockup's `#6E8679` was 3.93:1).
- **Shapes** gained 14px and 18px radii; status is a dot and a word, not a pill.

**Why:** after a demo, the owner's manager said the functionality was good but the
UI "looks like a usual vibe-coded app". The old look (dark left rail, one teal
accent, Inter, rounded white cards, pill badges) is the default of most AI-built
dashboards. The redesign had to look designed for a bank while keeping every
behaviour and every traceability rule.

**What did not change:** the amber, red and green meanings; the replaced
spacing / font-size / shadow scales; provenance on every figure; and
`/welcome` and `/login`. Production is unchanged until the owner signs off the
Vercel Preview walkthrough.

---

## 10. Tokenisation report

*Produced by `/frontend-setup`, 2026-10-05. Which rules in this file are
enforced by `tailwind.config.ts`, and which are not expressible as tokens and
must therefore be enforced by `/design-system` at review time.*

### Enforced by the config

| Rule | How |
|---|---|
| Colour palette | Every colour is a named token. Neutrals are `--c-*` CSS variables switched by `theme-forest`; the brand set comes from `lib/ui/palette.ts`. A raw hex in a component is a review failure. |
| Type scale | `fontSize` is **replaced**, not extended: `title`, `section`, `card`, `body`, `label`, `num`, `quote`, `badge`, plus `figure`, `figure-sm` and `wordmark` — each with its line height and weight baked in. |
| Spacing scale | `spacing` is **replaced** with only `4,8,12,16,24,32,48,64` (plus `0`/`px`). An off-scale value fails to compile a class. |
| Shadows | `boxShadow` is replaced with `none`, `card` and `raised`. `shadow-lg` does not exist. |
| Radii | `sm`/`md`/`lg`/`xl`/`2xl` = 4/8/12/14/18px. |
| Motion durations | `fast`/`panel`/`step` = 120/200/240ms, plus the panel easing curve. |
| Tabular figures | `.font-mono` sets `font-variant-numeric: tabular-nums` in `globals.css`; in the workspace `.tabular-nums` also switches to the figure face. |
| Focus rings | Global `:focus-visible` rule (forest in the workspace, mint on the header); cannot be dropped per-component without overriding it visibly. |
| Retired tokens | `components/workspaceTokens.test.js` fails on `model*`, `sunken` or `night*` in workspace code. |
| Palette and contrast | `lib/ui/palette.test.js` keeps `palette.ts` and `globals.css` in step and checks contrast. |
| Reduced motion | Global `@media (prefers-reduced-motion)` block. |

### NOT expressible as tokens — must be caught at review

These five are behavioural contracts. `tailwind.config.ts` cannot enforce any of
them, which is exactly why `/design-system` runs on every component:

1. **Hue carries meaning.** Nothing stops a developer writing `text-code` on a
   model-produced value. Only review catches a semantic misuse.
2. **Every calculated value shows provenance** (`⟡ computed by code · calc_id`).
   A component contract, not a style.
3. **A claim without a citation chip must not render.** Conditional-render logic.
4. **Contrast ratios** (4.5:1 body, 3:1 UI). Token pairs are compliant *as
   designed*, but a new combination can fail. Needs measuring, not declaring.
5. **No skeleton shimmer on the step trace.** A product-honesty rule — faking
   progress misrepresents what the system is doing.

**Nothing in §1–§9 failed to tokenise for technical reasons.** The five above are
rules about *meaning and behaviour*, which no config can express.

---

## 11. Calculated value — the error state

*Added by a `/design-system audit`, 2026-10-05. The audit found that §5.2
specified how a calculated value looks when it succeeds, and said nothing about
what renders when it does not — despite the calculator refusing to compute being
a **first-class product behaviour** (PRD §2.3 behaviours 6–10).*

When `computeDscr()` returns `{error}` — missing input, denominator ≤ 0, unknown
component name — the UI must render the refusal, not a blank and never a zero:

```
DSCR   —   ⟡ not computed · missing input: cash_interest
```

| Element | Token | Why |
|---|---|---|
| Value | `text-text-muted`, an em dash | **Never `0.00`.** A zero is a number, and the whole point is that no number exists. |
| Badge | `text-danger` on `bg-danger-bg` | Rose, not amber. Amber means *code produced a value*; here code **declined** to. |
| Reason | The error string verbatim | The analyst needs to know which input is missing to go and find it. |

**The rule this encodes:** a missing figure is missing evidence, not zero. The
calculator never defaults, so the UI must never imply that it did.

The `⟡` glyph is decorative and carries `aria-hidden="true"` — the meaning is in
the words *computed by code* / *not computed*, which is what a screen reader
announces. This satisfies §2's rule that meaning is never carried by colour or
icon alone.

---

## 12. Component specifications — the remaining set

*Added after a `/design-system audit` found 15 components named in
`implementation-specs.md` with no visual spec. Every one below uses named tokens
only. Where a component carries a product rule, the rule is stated with it —
those are the ones that get invented wrongly under time pressure.*

> **Updated 2026-11-07.** The product rules below stand. The token names were
> written for the teal system and are translated like this: `model` / teal for
> *interactive* is now **forest ink or mint** (§5.3, §5.7); `model` for *the
> agent* is now **sky and the CreditScout tag** (§5.10); and "mono" on a figure
> now means Bricolage with `tabular-nums` (§3). Monospace stays on identifiers.
> `model*` classes must not appear in workspace code.

### 12.1 `TestResultCard` — one quarterly test

`surface` card, `rounded-md`, `border-border`. The spine of the portfolio screen.

```
Harbor Logistics · Q2 2026
OUR DSCR  1.12 ⟡ computed by code · calc_7b2     THEIRS  1.12     Δ 0.00
┌─ BREACH ─ below 1.25 threshold by 0.13
```

| Element | Token | Rule |
|---|---|---|
| **Our** DSCR | `text-code-bright` tabular + provenance badge | Always first, always left of theirs. **Ours decides; theirs is evidence.** |
| Their DSCR | `text-text-secondary` tabular | Never amber — a borrower is not our calculation |
| Verdict · compliant | `text-success` | |
| Verdict · variance | `text-text` + `VarianceBadge` | Not an alarm. The conclusion stands. |
| Verdict · breach | `text-danger`, `border-danger` left edge 3px | |
| Verdict · not computed | `text-text-muted`, em dash | Per §11. **Never `0.00`.** |

**Rule:** when our number and theirs disagree, the card shows **both**, never just ours. Hiding the disagreement hides the product's value.

### 12.2 `VarianceBadge`

Inline pill, `rounded-sm`, `text-badge` tabular. Shows the **signed** delta.

| State | Token | Shows |
|---|---|---|
| Within tolerance | `text-text-muted` | `Δ 0.02` |
| Beyond tolerance | `text-code` on `bg-code-bg` | `Δ +0.09 variance logged` |
| No borrower figure | not rendered | — |

**Rule:** the sign is never dropped. `+` means the borrower overstated, which is the direction that matters.

### 12.3 `SeenSimilarBadge`

The CreditScout tag (§5.10): `rounded-sm`, `text-badge`. The lessons come from analyst reviews the agent was shown, so it is agent content. Reads `seen similar · 2 prior cases`.

**Rule:** renders only when at least one lesson matched. **Never renders empty or as "0 prior cases"** — an empty memory badge implies the feature is broken rather than new.

### 12.4 `UploadPackage`

Dropzone, `border-strong` dashed, `rounded-md`, `p-6`.

| State | Visual |
|---|---|
| Idle | `text-text-muted`, "Drop the quarterly package" |
| Dragover | border → `border-text`, bg → `bg-surface-raised` |
| Uploading | step-duration progress, no shimmer |
| Success | slate toast, `12 sections indexed` — **not green**; green means *compliant* |
| Rejected | `text-danger` with the reason, e.g. "scanned PDF — text-based only" |

### 12.5 `DocumentList`

Table: title · type · effective date · boarded?

**Rule — this one carries the F1 mechanic.** An amendment whose `effective_date` is not reflected in the approved `covenant_terms` must render a **`not boarded`** flag in `text-code` on `bg-code-bg`. That lag is the thing the agent is about to catch, and an analyst should be able to see it too.

### 12.6 `TermRow`

One executable covenant term. Label `text-label text-text-muted` · value `text-num tabular-nums text-text` · `CitationChip`.

| State | Visual |
|---|---|
| Proposed | default |
| Analyst-corrected | `border-l-2 border-human`, label suffix `edited` |
| **Missing citation** | `text-danger` chip reading `no citation` |

**Rule:** a term with no citation blocks approval. It must look wrong, not merely incomplete.

### 12.7 `TermsReview` · 12.8 `CovenantSetup`

Split pane: terms left (60%), `ClausePanel` right (40%). Clicking a `CitationChip` highlights the quote in the right pane, `bg-surface-raised` with a 2px `border-text` left edge. `CovenantSetup` is the page wrapper: `DocumentList` → `TermsReview` → `ApproveBar`.

### 12.9 `ApproveBar`

Pinned footer, `bg-surface-raised`, `border-t border-border-strong`.

**Rule:** the Approve button is **disabled until every term carries a citation**, and the disabled state says why — `3 terms need a citation` — rather than being silently greyed. This is the four-eyes gate; it must explain itself.

### 12.10 `RunTestButton`

Primary (`bg-mint`, forest `text-text`). Disabled when the facility has no approved terms, with the reason inline: `approve covenant terms first`.

**Rule:** never silently disabled. A dead button with no explanation is how an analyst concludes the product is broken.

### 12.11 `ReviewActions`

Approve (primary) · Override (secondary) · Request docs (secondary). `gap-3`, pinned bottom of `CasefileView`.

### 12.12 `OverrideDialog`

Modal, `surface-raised`, `rounded-lg`, `max-w-content/2`. Three required fields in order: **reason** (textarea) → **confirm the suggested tag** → **corrected outcome**.

**Rule:** submit is disabled until the reason is non-empty. **The reason is stored verbatim and becomes the lesson** — it is the product's learning input, not an audit nicety. The dialog should say so: *"Your reasoning is retained and retrieved on similar cases."*

### 12.13 `CasefileView`

Vertical stack: `RecommendationBadge` → explanation (`text-body`) → `CalcTable` → claims with `CitationChip`s → `GuardrailNotice`s → `ReviewActions`.

**Rule:** guardrail notices render **above** the actions and are never collapsed. They are the strongest evidence the system polices itself.

### 12.14 `CalcTable`

Rows of calculation components. Numeric column right-aligned, `tabular-nums`.

| Column | Token |
|---|---|
| Component name | `text-text-secondary` |
| Value · computed by code | `text-code-bright` tabular |
| Value · quoted from a document | `text-text` tabular — **never amber** |
| Source | `CitationChip` (quoted figure) or `calc_id` badge (computed) |

**Rule:** every row shows whether the figure was **quoted** or **computed**, and
**the Value colour carries that distinction**: amber only when code produced the
number; a quoted document figure is evidence the agent retrieved, not a code
output, so it is plain `text-text` (§1, §12.1, §9 — amber is never used for
anything that isn't code output). That distinction is the guardrail's entire
basis and the analyst should see it too.

*(Corrected 2026-10-06: the original line specified `text-code-bright` for the
whole Value column, which contradicted §1/§12.1 for the quoted-input rows a calc
table necessarily contains. Resolved toward the hard semantic rule.)*

### 12.15 `TraceStep`

One row of the step trace. Number · tool name · duration · one-line summary.

| Step type | Token |
|---|---|
| Agent / specialist | Sky: `border-agent` left rule, the CreditScout tag, `text-agent-ink` purpose line |
| **Calculator** | `text-code`, amber left rule |
| Active | Agent step stays sky; subtle pulse |
| Complete | settles to `text-text-secondary` |

**Rule:** the sky/amber alternation **is** the demo. It must come from the step's actual type, never be styled by hand.

### 12.16 `Scoreboard`

Metric rows: name · target · actual. Actual `text-success` when met, `text-danger` when missed. Cold and warm columns side by side.

**Rule:** the false-resolve row renders `0` in `text-success` or any non-zero in `text-danger` **with no softening**. It is a gate, not a trend.

### 12.17 `GovernancePanel`

Read-only policy table. `text-label` keys, `tabular-nums` values.

### 12.18 `LockedPolicyValue`

Its own component — promoted out of `GovernancePanel` because a regulatory boundary should not be a styling detail.

```
require_human_review   true   🔒 locked
```

`text-text-muted`, lock glyph `aria-hidden` with `aria-label="locked, cannot be changed"`, `cursor-not-allowed`, no interactive affordance at all.

**Rule:** renders as **structurally impossible to change**, not merely disabled. There is no edit control to grey out — there is no edit control.
