---
name: design-system
description: Enforce CreditScout's visual rules on any screen or component being built or changed — colours, type, spacing, and the semantic rule that teal means model and amber means code. Use every time UI is written or reviewed.
---

# Design System

## Purpose

Keep every screen consistent with every other screen. This is the skill used most
often: run it whenever a component is built or changed, so the app reads as
designed rather than assembled.

## Inputs

- `docs/design.md` — **read it at the start of every session. Never work from
  memory.** It is the single source of truth for anything visual.
- The component or screen being built or reviewed

## Instructions

1. **Read `docs/design.md` first, every time.** Memory drifts; the file does not.

2. **Enforce the semantic colour rule — this is the one that matters:**
   - **Teal** = a model did this: agent steps, retrieved quotes, judgments
   - **Amber** = **code did this**: calculations, guardrails, policy decisions
   - **Slate / white** = a human did this or must
   - **Rose** = breach, failure, escalation · **Green** = compliant

   Amber is not an emphasis colour. If a number is amber, a deterministic
   function produced it and it has a `calc_id`. Reject any use of amber for
   decoration or warnings — diluting it breaks the product's core affordance.

3. **Use named tokens only.** `text-code`, never `text-[#F59E0B]`. If a value
   isn't in `docs/design.md`, do not invent it — either reuse the nearest token
   or propose an addition to the file and say why.

4. **Check these every time:**
   - Every financial figure, ratio and `calc_id` is monospace with `tabular-nums`
   - Every verbatim clause quote is monospace, visually distinct from model prose
   - Every calculated value shows provenance — `⟡ computed by code · calc_xxxx`
   - Every claim renders a citation chip; a claim without one must not render
   - Guardrail notices are visible, never collapsed behind a disclosure
   - `require_human_review` renders as locked, not merely disabled
   - Spacing is from the 4px scale: `4, 8, 12, 16, 24, 32, 48, 64`
   - Elevation is borders, never shadows
   - Focus rings are present on every interactive element

5. **Accessibility is not optional.** Body text 4.5:1, UI 3:1. Meaning is never
   carried by colour alone — every semantic colour is paired with an icon or
   label. Honour `prefers-reduced-motion`.

6. **Motion:** nothing longer than 240ms. **No skeleton shimmer on the step
   trace** — a running investigation shows real steps arriving, and faking
   progress misrepresents what the system is doing.

## Output

The component or screen, conforming to `docs/design.md`.

Report any rule you had to break and why, and any token you think
`docs/design.md` is missing — do not silently invent one.
