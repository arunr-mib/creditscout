# CreditScout — Design System

**The single source of truth for everything visual.** Read this before building
any screen. Never work from memory, and never invent a colour, spacing value or
radius that isn't here.

**Date:** 2026-10-14 · **Stack:** Next.js + Tailwind CSS

> **Rewritten 2026-10-13/14.** The workspace went from dark-native to a lit,
> graphite-and-teal surface, and figures moved off monospace. Sections 2, 3 and
> 4 below are the current truth; §9 records what changed and why.

---

## 1. The one rule that makes this product legible

> **Hue carries meaning. It is never decoration.**

CreditScout's entire claim is that a reasoning layer decides and a calculation
layer computes. An analyst has to be able to see which is which **without
reading a word**. That is what the colour system is for.

| Hue | Means | Never used for |
|---|---|---|
| **Teal** | A model did this — an agent step, a retrieved quote, a judgment. Also the product's one interaction colour | Anything deterministic; anything that means *compliant* |
| **Amber** | **Code did this** — a calculation, a guardrail, a policy decision | Decoration, warnings, "highlights" |
| **Slate / white** | A human did this, or must | System output |
| **Red** | A breach, a failure, an escalation | General emphasis |
| **Green** | Compliant, passing | Success toasts (use slate) |

If you catch yourself reaching for amber because a number "feels important",
stop. Amber means *a deterministic function produced this value and it is logged
under a `calc_id`*. Diluting it breaks the product's core affordance.

**Every calculated figure in the UI carries its provenance**, e.g.
`1.31 ⟡ computed by code · calc_a3f9`. A figure without provenance is a bug, not
a style choice.

---

## 2. Colour tokens

**The analyst workspace is LIGHT.** It was dark-native through 2026-10-12; the
rooms commercial credit analysts work in are lit, and the dark build read as a
developer tool. The marketing pages and the nav rail stay dark on purpose and
carry their own `night-*` set — they are light-on-dark surfaces and cannot
borrow the tokens below.

### Surfaces — the workspace

| Token | Hex | Use |
|---|---|---|
| `bg` | `#F7F9FA` | Page background |
| `surface` | `#FFFFFF` | Cards, panels, table bodies |
| `surface-raised` | `#F1F4F6` | Table headers, hovered rows, inset blocks |
| `border` | `#C7D3DA` | Hairlines inside a panel |
| `border-strong` | `#94A6B0` | A panel's own edge, and dividers that must read |

Borders were two steps lighter until 2026-10-14. At `#DCE4E8` on `#F7F9FA` a
card edge all but vanished and panels read as floating text.

### Surfaces — the dark shell

| Token | Hex | Use |
|---|---|---|
| `sunken` | `#182126` | The nav rail |
| `night` | `#141C21` | Landing and login background |
| `night-raised` | `#26373D` | Chips and counts on the rail |
| `night-hover` | `#223136` | Hovered rail rows |
| `night-text` / `night-secondary` / `night-muted` | `#F8FAFC` / `#CBD5E1` / `#9AAAB2` | Foregrounds on dark |
| `night-border` / `night-border-strong` | `#2C3B41` / `#3E4F56` | Edges on dark |

### Text

| Token | Hex | Use | On white |
|---|---|---|---|
| `text` | `#19282F` | Headings, primary values | 15.2:1 |
| `text-secondary` | `#52646D` | Body copy | 7.0:1 |
| `text-muted` | `#6B7C85` | Labels, captions, metadata (12px floor) | 4.7:1 |

### Semantic

| Token | Hex | Bg pair | Meaning |
|---|---|---|---|
| `model` | `#146C67` | `model-bg` `#E8F2F1` | Agent / model step — **and every interactive affordance** |
| `model-bright` | `#105A56` | — | Model text on a light surface, links |
| `model-night` | `#5EC2BA` | `model-night-bg` `#10302E` | The accent ON the dark shell |
| `code` | `#B45309` | `code-bg` `#FFFBEB` | **Deterministic computation**, and the one unresolved review item |
| `code-bright` | `#92400E` | — | Calculation headings, `calc_id` badges |
| `human` | `#334155` | `human-bg` `#F1F5F9` | Approval, review, analyst action |
| `danger` | `#C81E1E` | `danger-bg` `#FBE3E3` | Breach, failed test, escalate |
| `danger-strong` | `#A31A1A` | — | **Solid fill** of the escalate mark |
| `success` | `#15803D` | `success-bg` `#E8F7EE` | Compliant, passing |
| `success-strong` | `#156B37` | — | **Solid fill** of the resolve mark |

Every value is re-derived for a light page, not inverted. The old dark `model`
reads 2.98:1 on white, `code` 2.15, `success` 1.40 — all three would have
failed.

**The `-bg` tints are contrast-bound, not taste.** `success` on `success-bg` is
badge text with about 0.3 of headroom over 4.5:1; darkening those tints for
looks took the success badge to 4.10 and the danger badge to 4.29. They sit as
deep as AA allows. The `-strong` pair exists for the one element that carries no
small text — the outcome mark on the recommendation card — where white reads
6.6:1 and 7.7:1.

**Teal is interaction AND model.** Green is reserved for a verified pass or a
recorded resolution; a screen state such as "ready for analyst decision" is
neutral, never green, or it reads as *compliant*.

### Accessibility

- Body text must hit **4.5:1** against its surface; UI elements and large text
  **3:1**. The pairs above clear it, but re-check any new combination.
- **Never encode meaning in colour alone.** Every semantic colour is paired with
  an icon or a text label — teal steps carry an agent name, amber values carry
  `computed by code`, breaches carry the word *breach*. A colour-blind analyst
  must read the same information.
- Focus ring: `2px solid` `model` (`#146C67`), `offset 2px`, and on the dark
  shell `model-night` (`#5EC2BA`). Visible on every interactive
  element. Do not remove it.

---

## 3. Typography

One family, Inter, across the product. A narrow scale, and nothing off it — the
Tailwind `fontSize` scale is **replaced**, so an off-scale class does not exist.

| Role | Token | Size / Line | Weight |
|---|---|---|---|
| Display (landing hero **only**) | `text-display` | 56 / 58 | 600 |
| Page title | `text-title` | 28 / 34 | 700 |
| Section heading | `text-section` | 20 / 28 | 600 |
| Card title | `text-card` | 16 / 24 | 600 |
| Body | `text-body` | 14 / 22 | 400 |
| Numeric value | `text-num` | 14 / 20 | 500 |
| Quoted clause | `text-quote` | 13 / 21 | 400 |
| Label / caption | `text-label` | 12 / 16 | 500 |
| Badge | `text-badge` | 11 / 16 | 500 |

**The numeral rule, rewritten 2026-10-14:**

1. **Every financial figure and date is set in Inter with `tabular-nums`.**
   Columns still align — that is what tabular numerals are for — without the
   product looking like a terminal. A covenant figure in monospace reads as a
   machine's output, which is the opposite of what this screen claims.
2. **Monospace is reserved for things you would retype**: `calc_id`, citations
   (`CA §7.11`), rule names, field paths (`numerator.addbacks[0].cap`), tool
   names, credentials, a key cap.
3. **A verbatim clause quote is NOT monospace.** It is prose — `text-quote`,
   with the cited span highlighted. Setting a covenant in the same face as a
   stack trace made the one artifact an analyst must actually read look like a
   log.

Before this pass the app ran 90 `font-mono` usages against 14 `tabular-nums`,
split by screen: queue DSCRs monospace, casefile DSCRs proportional.

## 4. Spacing, radius, elevation

**4px base scale.** The Tailwind `spacing` scale is **replaced**, so only these
exist: `0, px, 1 (4px), 2 (8px), 3 (12px), 4 (16px), 6 (24px), 8 (32px),
12 (48px), 16 (64px)`. `h-10`, `mt-10` and `gap-10` are not classes — they fail
silently at render, which is the single most common mistake made in this
codebase.

| Radius | Value | Use |
|---|---|---|
| `sm` | 4px | Badges, chips |
| `md` | 8px | Cards, inputs, buttons |
| `lg` | 12px | Modals, side panels |

**Elevation is a border first, a hairline shadow second.** On the old dark page
shadows read as mud and the scale was `none`. On a lit page a 1px border alone
reads flat, so the scale came back — deliberately small, two steps:

| Token | Use |
|---|---|
| `shadow-card` | Every panel. `0 1px 2px / 0 1px 3px` at 4–6% |
| `shadow-raised` | Modals and popovers only |

A big diffuse shadow is the other half of the generated-template look. There is
no third step and there will not be one.

Layout: 1280px max content width, 24px page gutter, 16px grid gap.

---

## 5. Components

### 5.1 Recommendation badge

| Recommendation | Colour | Icon |
|---|---|---|
| `resolve` | `success` | ✓ |
| `request` | `human` | ? |
| `escalate` | `danger` | ↑ |
| `abstain` | `text-muted` | — |

Pill, `radius-sm`, 12px uppercase, letter-spacing 0.5px. **`abstain` is
deliberately grey, not red** — abstaining is correct behaviour, not a failure,
and colouring it as an error would train analysts to see caution as malfunction.

### 5.2 Calculated value

```
┌──────────────────────────────────┐
│  DSCR   1.31  ⟡ code · calc_a3f9 │   ← amber value, mono, badge
└──────────────────────────────────┘
```
Value in `code-bright`, Inter with `tabular-nums`; badge in `code` on `code-bg` at 11px. The
`calc_id` is clickable and opens the calculation log for that computation.

### 5.3 Citation chip

Inline, `model` on `model-bg`, `radius-sm`, 12px, **monospace** — a citation is
an identifier: `CA §7.11 ↗`. Clicking opens the clause panel. **A claim without a chip must not render** —
if the data lacks a citation that is a guardrail failure and should surface as
one, not render silently.

### 5.4 Clause panel

Right-hand drawer, 480px, `surface-raised`, `radius-lg`. Document title and
section as header; full chunk text in **Inter** (`text-quote`) — a covenant is
prose, not code; **the quoted span highlighted with `model-bg` and a 2px `model`
left border**. The analyst's job here
is a two-second verification — the highlight is the whole point.

### 5.5 Step trace

Vertical timeline, one row per step, polled every 1s.

```
 ①  definition_agent        teal        2.3s
 │   mapped DSCR terms from CA §1.01
 ②  dscr_calculator         AMBER     0.1s
 │   1.12 — below 1.25 threshold
 ③  research_agent          teal        4.1s
 │   found Amendment No. 2 §3(a)
 ④  dscr_calculator         AMBER     0.1s
     1.31 — passes
```

Agent steps teal, calculator steps amber. **The alternation is the product
demo** — it shows reasoning and computation interleaving, which is the thesis
made visible. Active step pulses `model-bright`; completed steps settle to
`text-secondary`.

### 5.6 Guardrail notice

`code`-bordered callout with a 3px left border on `#3B2A0A`:

> **⟡ Guardrail · forced abstain** — "1.47" appears in the explanation but
> matches no calculation in this casefile and no quoted figure.

Amber because **a guardrail is code**. Always visible, never collapsed by
default. These are the moments that prove the system polices itself — hiding
them would be hiding the best evidence the product has.

### 5.7 Buttons

| Variant | Fill | Text | Use |
|---|---|---|---|
| Primary | `model` `#146C67` | `bg` | Approve, Investigate, Run test |
| Secondary | transparent, `border-strong` | `text` | Override, Request docs |
| Danger | transparent, `danger` border | `danger` | Escalate |

Height 36px, padding 16px, `radius-md`, 14px/500. Disabled: 40% opacity,
`cursor: not-allowed`.

**Two button colours in a row of actions, and they mean something.** Teal
(`model`) is reserved for *doing work* — Run test, Investigate. Beige
(`human`) is for *opening something* — Review, View decision, Review terms. A
third colour in the same column would make the distinction decorative. Where a
table column holds one action per row, give the cell a fixed width and stretch
every child to fill it: actions of different widths read as different weights.
Note that a button wrapped for a disabled-reason tooltip needs the wrapper
stretched too, not just the `<button>`.

### 5.8 Data table

`surface` background, `border` row dividers, 40px rows. Column headers are
12px in `model-bright` on a `model-bg/50` wash — the header row is the one
element that repeats on every screen, so it is where the brand accent earns its
keep. Numeric columns **right-aligned, Inter, `tabular-nums`**. Hover
`surface-raised`. Status via badge, never via row tint.

### 5.9 Locked policy value

```
require_human_review   true   🔒 locked
```
`text-muted` with a lock glyph and `cursor: not-allowed`. **Renders as
structurally impossible to change, not merely disabled** — this is a regulatory
boundary and the UI should say so.

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

| Screen | Layout |
|---|---|
| **Credit Analysis Queue** | Period line → title + two actions → summary strip → filter tabs + search → one table, 64px rows. Columns: borrower (+ industry, terms version), computed DSCR, reported DSCR, minimum, covenant test result, review status, **next action** (exactly one button). The uploader sits below the table |
| **Live investigation** | Breadcrumb + *Back to queue* → title + ONE status badge → "Original test result" strip (calculated / minimum / shortfall / terms version) → amber notice naming the single blocking issue → 65/35 split: investigation timeline left, pending recommendation + evidence right |
| **Casefile review** | Breadcrumb → title + one neutral status pill → **recommendation card in four bands** (eyebrow + mark + headline + one sentence; three facts; one outstanding line; the agent's reasoning) → 2/3 findings + 1/3 evidence and outstanding items → *Record your decision* |
| **Covenant terms review** | Header names the decision and the version → *What this proposal changes* (Term / Approved vN / Proposed vN+1 / Source) → review checklist grouped by consequence → proposed terms left, source clause right → compact approval bar |
| **Documents** | Search → borrower and type filters → *Upload documents*. Table: document, borrower, type, **relevant date** (named for the type), terms review state. A title opens the indexed document |
| **Onboarding** | Stepper (Borrower & documents → Review terms → Complete). Step 1 carries the name fields **and** the uploader, with one primary action that creates the borrower and uploads in a single gesture |
| **Governance** | Investigation limits + enforcement rules + eval scoreboard (cold vs warm, with the run's date and n) |

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

### Superseded 2026-10-13

> *"Don't add a light theme. There is no light theme in the MVP."*

The workspace IS the light theme now. The dark tokens survive as the `night-*`
set for the nav rail and the marketing pages, and nothing else.

---

## 10. Tokenisation report

*Produced by `/frontend-setup`, 2026-10-05. Which rules in this file are
enforced by `tailwind.config.ts`, and which are not expressible as tokens and
must therefore be enforced by `/design-system` at review time.*

### Enforced by the config

| Rule | How |
|---|---|
| Colour palette | All 18 colours are named tokens. A raw hex in a component is a review failure. |
| Type scale | `fontSize` is **replaced**, not extended: `title`, `section`, `card`, `body`, `label`, `num`, `quote`, `badge` — each with its line height and weight baked in. |
| Spacing scale | `spacing` is **replaced** with only `4,8,12,16,24,32,48,64` (plus `0`/`px`). An off-scale value fails to compile a class. |
| No shadows | `boxShadow` is replaced with `{ none }`. `shadow-lg` no longer exists. |
| Radii | `sm`/`md`/`lg` = 4/8/12px. |
| Motion durations | `fast`/`panel`/`step` = 120/200/240ms, plus the panel easing curve. |
| Monospace tabular figures | `.font-mono` sets `font-variant-numeric: tabular-nums` in `globals.css`. |
| Focus rings | Global `:focus-visible` rule; cannot be dropped per-component without overriding it visibly. |
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

### 12.1 `TestResultCard` — one quarterly test

`surface` card, `rounded-md`, `border-border`. The spine of the portfolio screen.

```
Harbor Logistics · Q2 2026
OUR DSCR  1.12 ⟡ computed by code · calc_7b2     THEIRS  1.12     Δ 0.00
┌─ BREACH ─ below 1.25 threshold by 0.13
```

| Element | Token | Rule |
|---|---|---|
| **Our** DSCR | `text-code-bright` mono + provenance badge | Always first, always left of theirs. **Ours decides; theirs is evidence.** |
| Their DSCR | `text-text-secondary` mono | Never amber — a borrower is not our calculation |
| Verdict · compliant | `text-success` | |
| Verdict · variance | `text-text` + `VarianceBadge` | Not an alarm. The conclusion stands. |
| Verdict · breach | `text-danger`, `border-danger` left edge 3px | |
| Verdict · not computed | `text-text-muted`, em dash | Per §11. **Never `0.00`.** |

**Rule:** when our number and theirs disagree, the card shows **both**, never just ours. Hiding the disagreement hides the product's value.

### 12.2 `VarianceBadge`

Inline pill, `rounded-sm`, `text-badge` mono. Shows the **signed** delta.

| State | Token | Shows |
|---|---|---|
| Within tolerance | `text-text-muted` | `Δ 0.02` |
| Beyond tolerance | `text-code` on `bg-code-bg` | `Δ +0.09 variance logged` |
| No borrower figure | not rendered | — |

**Rule:** the sign is never dropped. `+` means the borrower overstated, which is the direction that matters.

### 12.3 `SeenSimilarBadge`

Teal pill: `text-model` on `bg-model-bg`, `rounded-sm`, `text-badge`. Reads `seen similar · 2 prior cases`.

**Rule:** renders only when at least one lesson matched. **Never renders empty or as "0 prior cases"** — an empty memory badge implies the feature is broken rather than new.

### 12.4 `UploadPackage`

Dropzone, `border-strong` dashed, `rounded-md`, `p-6`.

| State | Visual |
|---|---|
| Idle | `text-text-muted`, "Drop the quarterly package" |
| Dragover | border → `border-model`, bg → `bg-model-bg` |
| Uploading | step-duration progress, no shimmer |
| Success | slate toast, `12 sections indexed` — **not green**; green means *compliant* |
| Rejected | `text-danger` with the reason, e.g. "scanned PDF — text-based only" |

### 12.5 `DocumentList`

Table: title · type · effective date · boarded?

**Rule — this one carries the F1 mechanic.** An amendment whose `effective_date` is not reflected in the approved `covenant_terms` must render a **`not boarded`** flag in `text-code` on `bg-code-bg`. That lag is the thing the agent is about to catch, and an analyst should be able to see it too.

### 12.6 `TermRow`

One executable covenant term. Label `text-label text-text-muted` · value `font-mono text-num text-text` · `CitationChip`.

| State | Visual |
|---|---|
| Proposed | default |
| Analyst-corrected | `border-l-2 border-human`, label suffix `edited` |
| **Missing citation** | `text-danger` chip reading `no citation` |

**Rule:** a term with no citation blocks approval. It must look wrong, not merely incomplete.

### 12.7 `TermsReview` · 12.8 `CovenantSetup`

Split pane: terms left (60%), `ClausePanel` right (40%). Clicking a `CitationChip` highlights the quote in the right pane, `bg-model-bg` with a 2px `border-model` left edge. `CovenantSetup` is the page wrapper: `DocumentList` → `TermsReview` → `ApproveBar`.

### 12.9 `ApproveBar`

Pinned footer, `bg-surface-raised`, `border-t border-border-strong`.

**Rule:** the Approve button is **disabled until every term carries a citation**, and the disabled state says why — `3 terms need a citation` — rather than being silently greyed. This is the four-eyes gate; it must explain itself.

### 12.10 `RunTestButton`

Primary (`bg-model`, `text-bg`). Disabled when the facility has no approved terms, with the reason inline: `approve covenant terms first`.

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

Rows of calculation components. Numeric column right-aligned, `font-mono`, `tabular-nums`.

| Column | Token |
|---|---|
| Component name | `text-text-secondary` |
| Value · computed by code | `text-code-bright` mono |
| Value · quoted from a document | `text-text` mono — **never amber** |
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
| Agent / specialist | `text-model`, teal left rule |
| **Calculator** | `text-code`, amber left rule |
| Active | `text-model-bright`, subtle pulse |
| Complete | settles to `text-text-secondary` |

**Rule:** the teal/amber alternation **is** the demo. It must come from the step's actual type, never be styled by hand.

### 12.16 `Scoreboard`

Metric rows: name · target · actual. Actual `text-success` when met, `text-danger` when missed. Cold and warm columns side by side.

**Rule:** the false-resolve row renders `0` in `text-success` or any non-zero in `text-danger` **with no softening**. It is a gate, not a trend.

### 12.17 `GovernancePanel`

Read-only policy table. `text-label` keys, `font-mono` values.

### 12.18 `LockedPolicyValue`

Its own component — promoted out of `GovernancePanel` because a regulatory boundary should not be a styling detail.

```
require_human_review   true   🔒 locked
```

`text-text-muted`, lock glyph `aria-hidden` with `aria-label="locked, cannot be changed"`, `cursor-not-allowed`, no interactive affordance at all.

**Rule:** renders as **structurally impossible to change**, not merely disabled. There is no edit control to grey out — there is no edit control.
