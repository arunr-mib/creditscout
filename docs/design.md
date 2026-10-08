# CreditScout — Design System

**The single source of truth for everything visual.** Read this before building
any screen. Never work from memory, and never invent a colour, spacing value or
radius that isn't here.

**Date:** 2026-10-05 · **Stack:** Next.js + Tailwind CSS

---

## 1. The one rule that makes this product legible

> **Hue carries meaning. It is never decoration.**

CreditScout's entire claim is that a reasoning layer decides and a calculation
layer computes. An analyst has to be able to see which is which **without
reading a word**. That is what the colour system is for.

| Hue | Means | Never used for |
|---|---|---|
| **Indigo** | A model did this — an agent step, a retrieved quote, a judgment | Anything deterministic |
| **Amber** | **Code did this** — a calculation, a guardrail, a policy decision | Decoration, warnings, "highlights" |
| **Slate / white** | A human did this, or must | System output |
| **Rose** | A breach, a failure, an escalation | General emphasis |
| **Green** | Compliant, passing | Success toasts (use slate) |

If you catch yourself reaching for amber because a number "feels important",
stop. Amber means *a deterministic function produced this value and it is logged
under a `calc_id`*. Diluting it breaks the product's core affordance.

**Every calculated figure in the UI carries its provenance**, e.g.
`1.31 ⟡ computed by code · calc_a3f9`. A figure without provenance is a bug, not
a style choice.

---

## 2. Colour tokens

Dark theme only. There is no light theme in the MVP — don't build one.

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `sunken` | `#060E1A` | The nav rail — one step *below* the page, so it recedes |
| `bg` | `#0A1628` | Page background |
| `surface` | `#11243D` | Cards, panels |
| `surface-raised` | `#1E293B` | Modals, popovers, hovered rows |
| `border` | `#1E293B` | Default borders |
| `border-strong` | `#334155` | Dividers that must read |

### Text

| Token | Hex | Use | Min size |
|---|---|---|---|
| `text` | `#F8FAFC` | Headings, primary values | — |
| `text-secondary` | `#CBD5E1` | Body copy | — |
| `text-muted` | `#94A3B8` | Labels, captions, metadata | 12px |

### Semantic

| Token | Hex | Bg pair | Meaning |
|---|---|---|---|
| `model` | `#818CF8` | `#1E1B4B` | Agent / model step |
| `model-bright` | `#A5B4FC` | — | Model headings, active trace step |
| `code` | `#F59E0B` | `#3B2A0A` | **Deterministic computation** |
| `code-bright` | `#FBBF24` | — | Calculation headings, `calc_id` badges |
| `human` | `#E2E8F0` | `#1E293B` | Approval, review, analyst action |
| `danger` | `#F87171` | `#3F1D1D` | Breach, failed test, escalate |
| `success` | `#86EFAC` | `#0F3B2A` | Compliant, passing |

### Accessibility

- Body text must hit **4.5:1** against its surface; UI elements and large text
  **3:1**. The pairs above clear it, but re-check any new combination.
- **Never encode meaning in colour alone.** Every semantic colour is paired with
  an icon or a text label — indigo steps carry an agent name, amber values carry
  `computed by code`, breaches carry the word *breach*. A colour-blind analyst
  must read the same information.
- Focus ring: `2px solid #A5B4FC`, `offset 2px`. Visible on every interactive
  element. Do not remove it.

---

## 3. Typography

| Role | Font | Size / Line | Weight |
|---|---|---|---|
| Display (landing hero **only**) | Inter | 56 / 58 | 600 |
| Page title | Inter | 28 / 34 | 700 |
| Section heading | Inter | 20 / 28 | 600 |
| Card title | Inter | 16 / 24 | 600 |
| Body | Inter | 14 / 22 | 400 |
| Label / caption | Inter | 12 / 16 | 500, `text-muted` |
| **Numeric values** | **JetBrains Mono** | 14 / 20 | 500 |
| **Clause quotes** | **JetBrains Mono** | 13 / 21 | 400 |

**Two rules that aren't negotiable:**

1. **Every financial figure, ratio and `calc_id` is monospace.** Tabular figures
   so columns align; an analyst scans columns of ratios and misalignment costs
   real time.
2. **Every verbatim clause quote is monospace**, so a quote is visually distinct
   from the model's prose about it. This is how the eye separates *evidence*
   from *interpretation*.

---

## 4. Spacing, radius, elevation

**4px base scale.** Use only: `4, 8, 12, 16, 24, 32, 48, 64`. No arbitrary values.

| Radius | Value | Use |
|---|---|---|
| `sm` | 4px | Badges, chips |
| `md` | 8px | Cards, inputs, buttons |
| `lg` | 12px | Modals, side panels |

**Elevation is borders, not shadows.** On a dark background shadows read as mud.
Depth comes from surface lightness plus a `border-strong` edge.

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
Value in `code-bright` monospace; badge in `code` on `#3B2A0A` at 11px. The
`calc_id` is clickable and opens the calculation log for that computation.

### 5.3 Citation chip

Inline, indigo, `radius-sm`, 12px: `CA §7.11 ↗`. Clicking opens the clause panel.
Hover raises background to `#1E1B4B`. **A claim without a chip must not render** —
if the data lacks a citation that is a guardrail failure and should surface as
one, not render silently.

### 5.4 Clause panel

Right-hand drawer, 480px, `surface-raised`, `radius-lg`. Document title and
section as header; full chunk text in monospace; **the quoted span highlighted
with `#1E1B4B` background and a 2px `model` left border**. The analyst's job here
is a two-second verification — the highlight is the whole point.

### 5.5 Step trace

Vertical timeline, one row per step, polled every 1s.

```
 ①  definition_agent        indigo      2.3s
 │   mapped DSCR terms from CA §1.01
 ②  dscr_calculator         AMBER     0.1s
 │   1.12 — below 1.25 threshold
 ③  research_agent          indigo      4.1s
 │   found Amendment No. 2 §3(a)
 ④  dscr_calculator         AMBER     0.1s
     1.31 — passes
```

Agent steps indigo, calculator steps amber. **The alternation is the product
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
| Primary | `#818CF8` | `#0A1628` | Approve, Investigate, Run test |
| Secondary | transparent, `border-strong` | `text` | Override, Request docs |
| Danger | transparent, `danger` border | `danger` | Escalate |

Height 36px, padding 16px, `radius-md`, 14px/500. Disabled: 40% opacity,
`cursor: not-allowed`.

### 5.8 Data table

`surface` background, `border` row dividers, 40px rows, 12px uppercase muted
headers. Numeric columns **right-aligned, monospace, tabular-nums**. Hover
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
| **Portfolio queue** | KPI strip (4 tiles) → data table of borrowers. Columns: borrower, period, **our DSCR**, reported DSCR, variance, status, "seen similar" badge |
| **Covenant setup** | Split: proposed terms left, source clause right. Approve / Edit footer, pinned |
| **Investigation** | Step trace left (60%), casefile placeholder right (40%), filling as it completes |
| **Casefile review** | Recommendation badge → explanation → calculation table → claims with citation chips → guardrail notices → action bar pinned bottom |
| **Governance** | Policy table (read-only, human-review locked) + eval scoreboard, cold vs warm |

---

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

- Don't add a light theme.
- Don't use amber for anything that isn't code output.
- Don't introduce a new hue. If something needs emphasis, use weight or size.
- Don't hide guardrail notices behind a disclosure.
- Don't render a number without its `calc_id` or its quote.
- Don't use shadows for elevation.
- Don't animate longer than 240ms, and don't fake progress.

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

Indigo pill: `text-model` on `bg-model-bg`, `rounded-sm`, `text-badge`. Reads `seen similar · 2 prior cases`.

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
| Agent / specialist | `text-model`, indigo left rule |
| **Calculator** | `text-code`, amber left rule |
| Active | `text-model-bright`, subtle pulse |
| Complete | settles to `text-text-secondary` |

**Rule:** the indigo/amber alternation **is** the demo. It must come from the step's actual type, never be styled by hand.

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
