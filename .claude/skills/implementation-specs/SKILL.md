---
name: implementation-specs
description: Turn the CreditScout engineering document into a file-by-file build blueprint — exact paths, function signatures, integration points, edge cases and a testing checklist per feature. Use before writing implementation code.
---

# Implementation Specs

## Purpose

Convert the architecture into a blueprint an engineer with no prior context can
execute. Every file named, every signature stated, every integration point
flagged — so nothing is discovered by accident halfway through the build.

## Inputs

- `docs/engineering/engineering-doc.md` — architecture, data models, API design,
  build sequence. This is the primary input.
- `docs/prd.md` — especially **§2.3 AI behaviour specification**, which is the
  source for edge cases and the testing checklist
- `docs/design.md` — the design system; every component spec must reference its
  tokens rather than inventing values
- `docs/superpowers/plans/2026-10-02-creditscout-deterministic-core.md` — the
  existing deterministic-core plan, which already contains full code
- `CLAUDE.md` — hard constraints

## Instructions

1. Work **feature by feature**, following the build sequence in the engineering
   document. Do not reorder it without saying why.

2. For each feature, produce all twelve blueprint items, grouped:

   **Product & UX** — description · user flow · placement · design
   **Data & Backend** — database schema · database tasks · helper functions · API routes
   **Frontend & QA** — state management · components · edge cases · testing checklist

3. **Name every file by exact path.** `lib/agent/tools/dscr-calculator.ts`, not
   "the calculator wrapper". Vague references produce inconsistent results.

4. **State function signatures with types**, including what the function returns
   on the error path. For CreditScout the error path is the product: the
   calculator returns `{error}` rather than a defaulted number.

5. **Flag every integration point** where two features touch — shared tables,
   shared types, a route one feature calls that another owns. These are where
   silent breakage happens.

6. **Derive edge cases from PRD §2.3.** Behaviours 1–10 and 18–24 are
   unit-testable with no model call; they belong in the testing checklist of the
   feature that owns the code. Behaviours 11–17 need the eval set.

7. **Testing checklist per feature** uses `node:test` and `node:assert/strict`
   only. No test framework.

8. Where the deterministic-core plan already contains working code, **reference
   it rather than rewriting it**, and note the one known fix: the files must use
   plain ESM `export`, not a guarded CommonJS export, or the tests cannot import
   them under `"type": "module"`.

## Output

`docs/engineering/implementation-specs.md`, with one section per feature in build
order, each carrying all twelve blueprint items, plus:

- An **integration points** table — which features touch which
- A **build order** checklist mirroring the engineering document's stages

Report any place where the engineering document was ambiguous, rather than
guessing.
