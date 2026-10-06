---
name: frontend-setup
description: Scaffold the CreditScout Next.js app with the design system baked in from the first commit — Tailwind tokens from docs/design.md, folder structure, Supabase clients with the service-role key kept server-side. Use once, before any screen is built.
---

# Frontend Setup

## Purpose

Create the empty shell of the application with the design system already wired
in, so no screen is ever built against invented colours or spacing. Run this
once, before the first screen.

## Inputs

- `docs/design.md` — **read this first.** Colour tokens, type scale, spacing
  scale, radii, component specs. Every token goes into the Tailwind config.
- `docs/engineering/engineering-doc.md` §4 — the file structure
- `docs/engineering/implementation-specs.md` — if it exists
- `.env.example` — which environment variables exist

## Instructions

1. **Scaffold Next.js** with the App Router, TypeScript and Tailwind.

2. **Translate `docs/design.md` into `tailwind.config.ts` as named tokens**, not
   hex values scattered through components. The semantic names must survive:
   `model`, `code`, `human`, `danger`, `success`, plus the surface and text
   scale. A component should read `text-code` and never `text-[#F59E0B]`.

3. **Wire both fonts** — Inter for UI, JetBrains Mono for numeric values and
   clause quotes. Enable `tabular-nums` on the mono face; analysts scan columns
   of ratios and misalignment costs real time.

4. **Create the folder structure** from the engineering document so every future
   file has an obvious home:
   ```
   app/            page routes + api/ route handlers
   lib/agent/      orchestrator, tools
   lib/supabase/   server.ts (service role) and browser.ts (anon)
   components/     shared UI
   calc/ guardrails/   the deterministic core — plain JS, zero dependencies
   ```

5. **Two Supabase clients, and keep them apart.**
   - `lib/supabase/server.ts` — service role. **Server-only.** Must never be
     imported by a Client Component.
   - `lib/supabase/browser.ts` — anon key, read-only under RLS.
   - The service-role key must never appear in a `NEXT_PUBLIC_` variable. If it
     does, stop and fix it before continuing.

6. **Build one reference component** that exercises the semantic colour rule —
   a calculated-value chip showing `1.31 ⟡ computed by code · calc_a3f9` in
   amber monospace. It proves the tokens work and sets the pattern.

7. **Do not build any feature screens.** This skill produces a styled, empty,
   runnable shell. Nothing more.

## Output

- A running Next.js app (`npm run dev` serves a styled shell)
- `tailwind.config.ts` with every token from `docs/design.md`
- `app/layout.tsx` with fonts and the base theme
- `lib/supabase/server.ts` and `lib/supabase/browser.ts`
- The folder structure above
- One reference component demonstrating the model/code colour rule

Report any token in `docs/design.md` that could not be expressed in Tailwind.
